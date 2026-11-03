import {
  GAMEPAD_AXES,
  GAMEPAD_BUTTONS,
  KEY_COUNT,
  keyIndex,
  MAX_GAMEPADS,
  MAX_TOUCHES,
  MOUSE_BUTTON,
  type RawInputState,
} from '@boboforces/input';
import type { RawInputSource } from '@boboforces/platform-api';
import type { Disposable, Unsubscribe } from '@boboforces/shared';

/**
 * Adaptadores de input da web (tecnico.md §10 e §11.1). DOM só aqui (regra 12): teclado (`KeyboardEvent.code` →
 * `keyIndex`), mouse com pointer lock (`unadjustedMovement`, botões do meio/voltar/avançar bloqueados), Gamepad API
 * (`getGamepads()` a cada poll) e toque/caneta por Pointer Events. Os eventos só acumulam; `poll(out)` entrega tudo de
 * uma vez, 1x por frame, sem alocar. Tecla, clique ou toque que desce e sobe entre dois polls ainda aparece apertado
 * no poll seguinte (cliques rápidos não se perdem).
 */
export interface WebInputSource extends RawInputSource, Disposable {
  /** O pointer lock está com a superfície do jogo. */
  readonly pointerLocked: boolean;
  /**
   * Pede o pointer lock (chame dentro de um clique). Tenta `unadjustedMovement` e cai para o modo normal se o
   * navegador recusar a opção. `false` se não deu: o Chrome recusa por ~1 s depois de o jogador sair com Esc, então o
   * botão "Continuar" deve esperar e tentar de novo.
   */
  requestPointerLock(): Promise<boolean>;
  exitPointerLock(): void;
  /**
   * Mudou o pointer lock. Perder o lock no meio da partida = pausa (o Esc com lock nem chega à página): a
   * platform-web liga isto ao `lifecycle.onPause` (solo/local pausam; online abre o menu sem pausar).
   */
  onPointerLockChange(listener: (locked: boolean) => void): Unsubscribe;
}

type EventHost = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

/** Globais do navegador que o adaptador usa (injetáveis para testar em Node com objetos falsos). */
export interface WebInputEnv {
  readonly window: EventHost & {
    readonly devicePixelRatio: number;
    setTimeout(handler: () => void, timeout: number): number;
    clearTimeout(id: number): void;
  };
  readonly document: EventHost & {
    readonly pointerLockElement: Element | null;
    readonly visibilityState: DocumentVisibilityState;
    exitPointerLock(): void;
  };
  readonly navigator: { getGamepads?(): readonly (Gamepad | null)[] };
}

export interface WebInputOptions {
  readonly env?: WebInputEnv;
}

/** Teclas que o navegador continua tratando (recarregar, tela cheia, ferramentas): F1 e F3–F12. O F2 é o debug. */
const BROWSER_KEYS = new Set(['F1', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12']);

/** `MouseEvent.button` → bit de `MOUSE_BUTTON`. */
const MOUSE_BITS = [
  MOUSE_BUTTON.left,
  MOUSE_BUTTON.middle,
  MOUSE_BUTTON.right,
  MOUSE_BUTTON.back,
  MOUSE_BUTTON.forward,
];

interface TouchRecord {
  active: boolean;
  /** Soltou depois do último poll: aparece ativo uma última vez e então some. */
  releasePending: boolean;
  id: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
}

interface LockableElement {
  requestPointerLock(options?: { unadjustedMovement?: boolean }): Promise<void> | void;
}

interface HapticActuator {
  playEffect?(
    type: 'dual-rumble',
    params: { duration: number; strongMagnitude: number; weakMagnitude: number; startDelay: number },
  ): Promise<unknown>;
}

function defaultEnv(): WebInputEnv {
  return { window, document, navigator };
}

function isTextTarget(t: EventTarget | null): boolean {
  const el = t as { tagName?: unknown; isContentEditable?: unknown } | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable === true;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function createWebInputSource(target: HTMLElement, options: WebInputOptions = {}): WebInputSource {
  const env = options.env ?? defaultEnv();
  const win = env.window;
  const doc = env.document;
  const nav = env.navigator;

  const keyDown = new Uint8Array(KEY_COUNT);
  const keyLatch = new Uint8Array(KEY_COUNT);
  let mouseDown = 0;
  let mouseLatch = 0;
  let mouseDX = 0;
  let mouseDY = 0;
  let wheelAcc = 0;
  let pointerX = 0;
  let pointerY = 0;
  let pointerInside = false;
  let locked = doc.pointerLockElement === target;
  const touches: TouchRecord[] = [];
  for (let i = 0; i < MAX_TOUCHES; i++) {
    touches.push({ active: false, releasePending: false, id: -1, x: 0, y: 0, startX: 0, startY: 0 });
  }
  const lockListeners = new Set<(locked: boolean) => void>();
  const pendingLock = new Set<(ok: boolean) => void>();

  // Retângulo da superfície em px de layout; relido quando a janela muda (não a cada evento).
  let rectLeft = 0;
  let rectTop = 0;
  let rectWidth = 0;
  let rectHeight = 0;
  let rectDirty = true;
  function refreshRect(): void {
    if (!rectDirty) return;
    rectDirty = false;
    const r = target.getBoundingClientRect();
    rectLeft = r.left;
    rectTop = r.top;
    rectWidth = r.width;
    rectHeight = r.height;
  }

  /** Tamanho em px reais: o drawing buffer quando o alvo é o canvas; senão o retângulo × DPR. */
  function surfaceWidth(): number {
    const w = (target as unknown as { width?: unknown }).width;
    return typeof w === 'number' ? w : Math.round(rectWidth * win.devicePixelRatio);
  }
  function surfaceHeight(): number {
    const h = (target as unknown as { height?: unknown }).height;
    return typeof h === 'number' ? h : Math.round(rectHeight * win.devicePixelRatio);
  }
  function scaleX(): number {
    return rectWidth > 0 ? surfaceWidth() / rectWidth : win.devicePixelRatio;
  }
  function scaleY(): number {
    return rectHeight > 0 ? surfaceHeight() / rectHeight : win.devicePixelRatio;
  }

  // --- teclado ---

  function onKeyDown(e: KeyboardEvent): void {
    // Digitando no input escondido de texto (platform.textInput): o jogo não vê nem bloqueia nada.
    if (isTextTarget(e.target)) return;
    const k = keyIndex(e.code);
    // A repetição do sistema também vale: depois de um `blur` com a tecla segurada, ela volta a contar.
    if (k !== 0 && keyDown[k] === 0) {
      keyDown[k] = 1;
      keyLatch[k] = 1;
    }
    // Teclas do jogo não rolam a página nem trocam o foco. Atalhos com Ctrl/Alt/Meta e F-keys do navegador passam:
    // o Ctrl+W nem dá para bloquear, e por isso agachar fica no C (tecnico.md §11.1).
    if (k !== 0 && !e.ctrlKey && !e.altKey && !e.metaKey && !BROWSER_KEYS.has(e.code)) e.preventDefault();
  }

  function onKeyUp(e: KeyboardEvent): void {
    const k = keyIndex(e.code);
    if (k !== 0) keyDown[k] = 0;
  }

  // --- mouse ---

  function updatePointer(e: MouseEvent): void {
    refreshRect();
    const x = e.clientX - rectLeft;
    const y = e.clientY - rectTop;
    pointerInside = x >= 0 && y >= 0 && x < rectWidth && y < rectHeight;
    pointerX = x * scaleX();
    pointerY = y * scaleY();
  }

  /** Evento de mouse de compatibilidade gerado por um toque (o Chrome marca com `sourceCapabilities`). */
  function fromTouch(e: MouseEvent): boolean {
    const caps = (e as unknown as { sourceCapabilities?: { firesTouchEvents?: boolean } | null }).sourceCapabilities;
    return caps?.firesTouchEvents === true;
  }

  function onMouseMove(e: MouseEvent): void {
    if (fromTouch(e)) return;
    mouseDX += e.movementX;
    mouseDY += e.movementY;
    if (!locked) updatePointer(e);
  }

  function onMouseDown(e: MouseEvent): void {
    if (fromTouch(e)) return;
    const bit = MOUSE_BITS[e.button] ?? 0;
    mouseDown |= bit;
    mouseLatch |= bit;
    if (!locked) updatePointer(e);
    // Meio (rolagem automática) e voltar/avançar (navegação) não fazem nada na página do jogo.
    if (e.button === 1 || e.button === 3 || e.button === 4) e.preventDefault();
  }

  function onMouseUp(e: MouseEvent): void {
    const bit = MOUSE_BITS[e.button] ?? 0;
    mouseDown &= ~bit;
    if (e.button === 3 || e.button === 4) e.preventDefault();
  }

  function onAuxClick(e: MouseEvent): void {
    if (e.button === 1 || e.button === 3 || e.button === 4) e.preventDefault();
  }

  function onMouseLeave(): void {
    pointerInside = false;
  }

  function onContextMenu(e: Event): void {
    e.preventDefault();
  }

  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    // Um "passo" da roda: 100 px (Chrome/Edge), 3 linhas (Firefox) ou 1 página. Trackpad acumula frações.
    const unit = e.deltaMode === 1 ? 3 : e.deltaMode === 2 ? 1 : 100;
    wheelAcc += e.deltaY / unit;
  }

  // --- toque e caneta (Pointer Events) ---

  function findTouch(id: number): TouchRecord | null {
    for (let i = 0; i < MAX_TOUCHES; i++) {
      const t = touches[i]!;
      if (t.active && t.id === id) return t;
    }
    return null;
  }

  function onPointerDown(e: PointerEvent): void {
    if (e.pointerType === 'mouse') return;
    // Sem isto o navegador gera mousedown/mouseup de compatibilidade (cliques fantasmas) e rola/dá zoom.
    e.preventDefault();
    let slot: TouchRecord | null = null;
    for (let i = 0; i < MAX_TOUCHES && !slot; i++) if (!touches[i]!.active) slot = touches[i]!;
    if (!slot) return;
    refreshRect();
    const x = (e.clientX - rectLeft) * scaleX();
    const y = (e.clientY - rectTop) * scaleY();
    slot.active = true;
    slot.releasePending = false;
    slot.id = e.pointerId;
    slot.x = slot.startX = x;
    slot.y = slot.startY = y;
    try {
      target.setPointerCapture(e.pointerId);
    } catch {
      // Alvo sem captura (teste) ou ponteiro já solto: o pointermove do alvo ainda chega.
    }
  }

  function onPointerMove(e: PointerEvent): void {
    if (e.pointerType === 'mouse') return;
    const t = findTouch(e.pointerId);
    if (!t || t.releasePending) return;
    refreshRect();
    t.x = (e.clientX - rectLeft) * scaleX();
    t.y = (e.clientY - rectTop) * scaleY();
  }

  function onPointerUp(e: PointerEvent): void {
    if (e.pointerType === 'mouse') return;
    const t = findTouch(e.pointerId);
    if (t) t.releasePending = true;
  }

  function onGestureStart(e: Event): void {
    // Pinça do iOS (Safari não respeita touch-action para o zoom da página).
    e.preventDefault();
  }

  // --- foco, visibilidade e pointer lock ---

  /** Janela perdeu o foco ou a aba sumiu: nada fica "preso" apertado. */
  function releaseAll(): void {
    keyDown.fill(0);
    mouseDown = 0;
    for (let i = 0; i < MAX_TOUCHES; i++) if (touches[i]!.active) touches[i]!.releasePending = true;
  }

  function onVisibility(): void {
    if (doc.visibilityState === 'hidden') releaseAll();
  }

  function onResize(): void {
    rectDirty = true;
  }

  function onPointerLockChange(): void {
    const now = doc.pointerLockElement === target;
    for (const finish of pendingLock) finish(now);
    if (now === locked) return;
    locked = now;
    // Sair do lock (Esc) com o botão segurado não deixa o tiro preso.
    if (!locked) mouseDown = 0;
    for (const l of lockListeners) l(locked);
  }

  function onPointerLockError(): void {
    for (const finish of pendingLock) finish(false);
  }

  const listeners: [EventHost, string, (e: never) => void, AddEventListenerOptions | undefined][] = [
    [win, 'keydown', onKeyDown, undefined],
    [win, 'keyup', onKeyUp, undefined],
    [win, 'blur', releaseAll, undefined],
    [win, 'resize', onResize, undefined],
    [win, 'scroll', onResize, { passive: true }],
    [win, 'mouseup', onMouseUp, undefined],
    [win, 'auxclick', onAuxClick, undefined],
    [doc, 'mousemove', onMouseMove, undefined],
    [doc, 'visibilitychange', onVisibility, undefined],
    [doc, 'pointerlockchange', onPointerLockChange, undefined],
    [doc, 'pointerlockerror', onPointerLockError, undefined],
    [doc, 'gesturestart', onGestureStart, { passive: false }],
    [target, 'mousedown', onMouseDown, undefined],
    [target, 'mouseleave', onMouseLeave, undefined],
    [target, 'contextmenu', onContextMenu, undefined],
    [target, 'wheel', onWheel, { passive: false }],
    [target, 'pointerdown', onPointerDown, { passive: false }],
    [target, 'pointermove', onPointerMove, undefined],
    [target, 'pointerup', onPointerUp, undefined],
    [target, 'pointercancel', onPointerUp, undefined],
    [target, 'lostpointercapture', onPointerUp, undefined],
  ];
  for (const [host, type, fn, opts] of listeners) host.addEventListener(type, fn as EventListener, opts);

  // Toque não rola nem dá zoom na superfície (tecnico.md §11.1); o resto do CSS é do index.html.
  const style = (target as { style?: CSSStyleDeclaration }).style;
  const previousTouchAction = style?.touchAction ?? '';
  if (style) style.touchAction = 'none';

  let disposed = false;

  function pollGamepads(out: RawInputState): void {
    let list: readonly (Gamepad | null)[] | null = null;
    try {
      list = nav.getGamepads ? nav.getGamepads() : null;
    } catch {
      // Política de permissões bloqueando a Gamepad API: segue sem controles.
      list = null;
    }
    for (let i = 0; i < MAX_GAMEPADS; i++) {
      const pad = out.gamepads[i]!;
      const gp = list ? list[i] : null;
      if (!gp || !gp.connected) {
        pad.connected = false;
        pad.id = '';
        pad.kind = 'unknown';
        pad.axes.fill(0);
        pad.buttons.fill(0);
        continue;
      }
      pad.connected = true;
      pad.id = gp.id;
      // Na web só o mapeamento padrão garante a posição dos botões (layout genérico, sem detectar marca).
      pad.kind = gp.mapping === 'standard' ? 'standard' : 'unknown';
      for (let a = 0; a < GAMEPAD_AXES; a++) pad.axes[a] = gp.axes[a] ?? 0;
      for (let b = 0; b < GAMEPAD_BUTTONS; b++) {
        const btn = gp.buttons[b];
        // Alguns navegadores marcam `pressed` com `value` 0 em botões digitais.
        pad.buttons[b] = btn ? (btn.pressed && btn.value === 0 ? 1 : btn.value) : 0;
      }
    }
  }

  return {
    get pointerLocked(): boolean {
      return locked;
    },

    poll(out: RawInputState): void {
      refreshRect();
      for (let k = 0; k < KEY_COUNT; k++) out.keys[k] = keyDown[k]! | keyLatch[k]!;
      keyLatch.fill(0);
      out.mouseButtons = mouseDown | mouseLatch;
      mouseLatch = 0;
      out.mouseDX = mouseDX;
      out.mouseDY = mouseDY;
      mouseDX = 0;
      mouseDY = 0;
      const steps = Math.trunc(wheelAcc);
      out.wheel = steps;
      wheelAcc -= steps;
      out.pointerLocked = locked;
      out.pointerX = pointerX;
      out.pointerY = pointerY;
      out.pointerInside = pointerInside && !locked;
      out.surfaceWidth = surfaceWidth();
      out.surfaceHeight = surfaceHeight();
      out.pixelRatio = scaleX();
      for (let i = 0; i < MAX_TOUCHES; i++) {
        const src = touches[i]!;
        const dst = out.touches[i]!;
        dst.active = src.active;
        dst.id = src.id;
        dst.x = src.x;
        dst.y = src.y;
        dst.startX = src.startX;
        dst.startY = src.startY;
        if (src.releasePending) {
          src.active = false;
          src.releasePending = false;
          src.id = -1;
        }
      }
      pollGamepads(out);
    },

    vibrate(gamepadIndex, strong, weak, durationMs): void {
      try {
        const gp = nav.getGamepads?.()[gamepadIndex];
        const act = (gp as unknown as { vibrationActuator?: HapticActuator | null } | null)?.vibrationActuator;
        void act
          ?.playEffect?.('dual-rumble', {
            duration: Math.max(0, durationMs),
            strongMagnitude: clamp01(strong),
            weakMagnitude: clamp01(weak),
            startDelay: 0,
          })
          ?.catch(() => undefined);
      } catch {
        // Sem vibração neste navegador: silêncio.
      }
    },

    requestPointerLock(): Promise<boolean> {
      if (disposed) return Promise.resolve(false);
      if (locked) return Promise.resolve(true);
      return new Promise<boolean>((resolve) => {
        let timer = 0;
        const finish = (ok: boolean): void => {
          if (!pendingLock.delete(finish)) return;
          win.clearTimeout(timer);
          resolve(ok);
        };
        pendingLock.add(finish);
        // Navegador antigo sem promessa nem evento de erro: desiste depois de 1,5 s com o estado real.
        timer = win.setTimeout(() => finish(doc.pointerLockElement === target), 1500);
        const el = target as unknown as LockableElement;
        const plain = (): void => {
          try {
            const r = el.requestPointerLock();
            if (r && typeof r.then === 'function') r.then(undefined, () => finish(false));
          } catch {
            finish(false);
          }
        };
        try {
          const r = el.requestPointerLock({ unadjustedMovement: true });
          if (r && typeof r.then === 'function') {
            // Sem suporte a `unadjustedMovement` (Linux, macOS antigo): cai para o modo normal.
            r.then(undefined, (err: unknown) => {
              if ((err as { name?: unknown } | null)?.name === 'NotSupportedError') plain();
              else finish(false);
            });
          }
        } catch {
          plain();
        }
      });
    },

    exitPointerLock(): void {
      if (doc.pointerLockElement === target) doc.exitPointerLock();
    },

    onPointerLockChange(listener): Unsubscribe {
      lockListeners.add(listener);
      return () => {
        lockListeners.delete(listener);
      };
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const [host, type, fn, opts] of listeners) host.removeEventListener(type, fn as EventListener, opts);
      for (const finish of pendingLock) finish(false);
      lockListeners.clear();
      if (doc.pointerLockElement === target) doc.exitPointerLock();
      if (style) style.touchAction = previousTouchAction;
    },
  };
}
