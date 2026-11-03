import { createRawInputState, keyIndex, MOUSE_BUTTON, PAD_BUTTON } from '@boboforces/input';
import { describe, expect, it } from 'vitest';
import { createWebInputSource, type WebInputEnv } from './index.ts';

/** Ambiente falso em Node: EventTarget puros no lugar de window, document e do canvas. */
function setup(opts: { gamepads?: (Gamepad | null)[]; lockSupport?: 'ok' | 'noUnadjusted' | 'refuse' } = {}) {
  const win = Object.assign(new EventTarget(), {
    devicePixelRatio: 2,
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms) as unknown as number,
    clearTimeout: (id: number) => clearTimeout(id),
  });
  const doc = Object.assign(new EventTarget(), {
    pointerLockElement: null as Element | null,
    visibilityState: 'visible' as DocumentVisibilityState,
    exitPointerLock(): void {
      doc.pointerLockElement = null;
      doc.dispatchEvent(new Event('pointerlockchange'));
    },
  });
  const lockCalls: unknown[] = [];
  // Canvas de 1280×720 px reais ocupando 640×360 px de layout (DPR 2).
  const canvas = Object.assign(new EventTarget(), {
    width: 1280,
    height: 720,
    style: { touchAction: 'auto' },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 360 }),
    setPointerCapture: (_id: number) => undefined,
    requestPointerLock(options?: { unadjustedMovement?: boolean }): Promise<void> {
      lockCalls.push(options);
      const mode = opts.lockSupport ?? 'ok';
      if (mode === 'refuse' || (mode === 'noUnadjusted' && options?.unadjustedMovement)) {
        const name = mode === 'refuse' ? 'SecurityError' : 'NotSupportedError';
        return Promise.reject(Object.assign(new Error(name), { name }));
      }
      doc.pointerLockElement = canvas as unknown as Element;
      doc.dispatchEvent(new Event('pointerlockchange'));
      return Promise.resolve();
    },
  });
  const nav = { getGamepads: () => opts.gamepads ?? [] };
  const env = { window: win, document: doc, navigator: nav } as unknown as WebInputEnv;
  const src = createWebInputSource(canvas as unknown as HTMLElement, { env });
  const raw = createRawInputState();
  return { win, doc, canvas, src, raw, lockCalls };
}

function ev(type: string, props: Record<string, unknown> = {}): Event {
  return Object.assign(new Event(type, { cancelable: true }), props);
}

describe('teclado', () => {
  it('KeyboardEvent.code → keys[], com preventDefault só nas teclas do jogo', () => {
    const { win, src, raw } = setup();
    const w = ev('keydown', { code: 'KeyW' });
    win.dispatchEvent(w);
    src.poll(raw);
    expect(raw.keys[keyIndex('KeyW')]).toBe(1);
    expect(w.defaultPrevented).toBe(true);
    win.dispatchEvent(ev('keyup', { code: 'KeyW' }));
    src.poll(raw);
    expect(raw.keys[keyIndex('KeyW')]).toBe(0);

    const ctrlW = ev('keydown', { code: 'KeyW', ctrlKey: true });
    const f5 = ev('keydown', { code: 'F5' });
    const tab = ev('keydown', { code: 'Tab' });
    win.dispatchEvent(ctrlW);
    win.dispatchEvent(f5);
    win.dispatchEvent(tab);
    expect(ctrlW.defaultPrevented).toBe(false);
    expect(f5.defaultPrevented).toBe(false);
    expect(tab.defaultPrevented).toBe(true);
  });

  it('tecla apertada e solta entre dois polls aparece uma vez', () => {
    const { win, src, raw } = setup();
    win.dispatchEvent(ev('keydown', { code: 'Space' }));
    win.dispatchEvent(ev('keyup', { code: 'Space' }));
    src.poll(raw);
    expect(raw.keys[keyIndex('Space')]).toBe(1);
    src.poll(raw);
    expect(raw.keys[keyIndex('Space')]).toBe(0);
  });

  it('digitando no input de texto o jogo não vê nem bloqueia a tecla', () => {
    const { win, src, raw } = setup();
    const e = ev('keydown', { code: 'KeyA' });
    Object.defineProperty(e, 'target', { value: { tagName: 'INPUT' } });
    win.dispatchEvent(e);
    src.poll(raw);
    expect(raw.keys[keyIndex('KeyA')]).toBe(0);
    expect(e.defaultPrevented).toBe(false);
  });

  it('perder o foco solta tudo', () => {
    const { win, canvas, src, raw } = setup();
    win.dispatchEvent(ev('keydown', { code: 'KeyD' }));
    canvas.dispatchEvent(ev('mousedown', { button: 0, clientX: 1, clientY: 1 }));
    src.poll(raw);
    win.dispatchEvent(new Event('blur'));
    src.poll(raw);
    expect(raw.keys[keyIndex('KeyD')]).toBe(0);
    expect(raw.mouseButtons).toBe(0);
  });
});

describe('mouse', () => {
  it('botões, movimento acumulado, roda em passos e ponteiro em px reais', () => {
    const { doc, win, canvas, src, raw } = setup();
    canvas.dispatchEvent(ev('mousedown', { button: 2, clientX: 320, clientY: 180 }));
    doc.dispatchEvent(ev('mousemove', { movementX: 5, movementY: -2, clientX: 330, clientY: 180 }));
    doc.dispatchEvent(ev('mousemove', { movementX: 5, movementY: -2, clientX: 340, clientY: 180 }));
    canvas.dispatchEvent(ev('wheel', { deltaY: 100, deltaMode: 0 }));
    src.poll(raw);
    expect(raw.mouseButtons).toBe(MOUSE_BUTTON.right);
    expect([raw.mouseDX, raw.mouseDY]).toEqual([10, -4]);
    expect(raw.wheel).toBe(1);
    expect([raw.pointerX, raw.pointerY, raw.pointerInside]).toEqual([680, 360, true]);
    expect([raw.surfaceWidth, raw.surfaceHeight, raw.pixelRatio]).toEqual([1280, 720, 2]);
    win.dispatchEvent(ev('mouseup', { button: 2 }));
    canvas.dispatchEvent(ev('wheel', { deltaY: 1, deltaMode: 1 }));
    src.poll(raw);
    expect(raw.mouseButtons).toBe(0);
    expect([raw.mouseDX, raw.wheel]).toEqual([0, 0]);
    canvas.dispatchEvent(ev('wheel', { deltaY: 2, deltaMode: 1 }));
    src.poll(raw);
    expect(raw.wheel).toBe(1);
  });

  it('bloqueia voltar/avançar e o menu de contexto', () => {
    const { win, canvas } = setup();
    const back = ev('mousedown', { button: 3, clientX: 0, clientY: 0 });
    const backUp = ev('mouseup', { button: 3 });
    const ctx = ev('contextmenu');
    canvas.dispatchEvent(back);
    win.dispatchEvent(backUp);
    canvas.dispatchEvent(ctx);
    expect(back.defaultPrevented && backUp.defaultPrevented && ctx.defaultPrevented).toBe(true);
  });

  it('pointer lock com unadjustedMovement, avisa a mudança e solta o tiro ao sair', async () => {
    const { doc, canvas, src, raw, lockCalls } = setup();
    const seen: boolean[] = [];
    src.onPointerLockChange((l) => seen.push(l));
    await expect(src.requestPointerLock()).resolves.toBe(true);
    expect(lockCalls).toEqual([{ unadjustedMovement: true }]);
    expect(src.pointerLocked).toBe(true);
    canvas.dispatchEvent(ev('mousedown', { button: 0, clientX: 0, clientY: 0 }));
    src.poll(raw);
    expect(raw.pointerLocked).toBe(true);
    expect(raw.pointerInside).toBe(false);
    doc.exitPointerLock();
    src.poll(raw);
    expect(seen).toEqual([true, false]);
    expect(raw.mouseButtons).toBe(0);
  });

  it('sem suporte a unadjustedMovement cai para o modo normal; recusa vira false', async () => {
    const a = setup({ lockSupport: 'noUnadjusted' });
    await expect(a.src.requestPointerLock()).resolves.toBe(true);
    expect(a.lockCalls).toEqual([{ unadjustedMovement: true }, undefined]);
    const b = setup({ lockSupport: 'refuse' });
    await expect(b.src.requestPointerLock()).resolves.toBe(false);
  });
});

describe('toque', () => {
  it('pointer de toque vira RawTouch em px reais, e o toque rápido aparece uma vez', () => {
    const { canvas, src, raw } = setup();
    const down = ev('pointerdown', { pointerType: 'touch', pointerId: 11, clientX: 100, clientY: 50 });
    canvas.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    canvas.dispatchEvent(ev('pointermove', { pointerType: 'touch', pointerId: 11, clientX: 110, clientY: 40 }));
    src.poll(raw);
    expect(raw.touches[0]).toMatchObject({ active: true, id: 11, x: 220, y: 80, startX: 200, startY: 100 });
    canvas.dispatchEvent(ev('pointerdown', { pointerType: 'touch', pointerId: 12, clientX: 500, clientY: 300 }));
    canvas.dispatchEvent(ev('pointerup', { pointerType: 'touch', pointerId: 12 }));
    src.poll(raw);
    expect(raw.touches[1]).toMatchObject({ active: true, id: 12 });
    src.poll(raw);
    expect(raw.touches[1]!.active).toBe(false);
    expect(raw.touches[0]!.active).toBe(true);
  });

  it('mouse não vira toque e a superfície recebe touch-action: none', () => {
    const { canvas, src, raw } = setup();
    expect(canvas.style.touchAction).toBe('none');
    canvas.dispatchEvent(ev('pointerdown', { pointerType: 'mouse', pointerId: 1, clientX: 1, clientY: 1 }));
    src.poll(raw);
    expect(raw.touches.every((t) => !t.active)).toBe(true);
    src.dispose();
    expect(canvas.style.touchAction).toBe('auto');
  });
});

describe('controles (Gamepad API)', () => {
  it('copia eixos e botões a cada poll; vazio = desconectado', () => {
    const button = (value: number, pressed = value > 0) => ({ value, pressed, touched: pressed });
    const gp = {
      connected: true,
      id: 'Controle genérico (STANDARD GAMEPAD)',
      mapping: 'standard',
      axes: [0.5, -1, 0, 0.25],
      buttons: Array.from({ length: 17 }, (_, i) =>
        i === PAD_BUTTON.faceDown ? button(0, true) : i === PAD_BUTTON.triggerRight ? button(0.4) : button(0),
      ),
    } as unknown as Gamepad;
    const { src, raw } = setup({ gamepads: [null, gp] });
    src.poll(raw);
    expect(raw.gamepads[0]!.connected).toBe(false);
    const pad = raw.gamepads[1]!;
    expect(pad).toMatchObject({ connected: true, kind: 'standard', id: gp.id });
    expect(Array.from(pad.axes)).toEqual([0.5, -1, 0, 0.25]);
    expect(pad.buttons[PAD_BUTTON.faceDown]).toBe(1);
    expect(pad.buttons[PAD_BUTTON.triggerRight]).toBeCloseTo(0.4, 6);
    expect(pad.buttons[17]).toBe(0);
  });
});

describe('dispose', () => {
  it('remove os ouvintes', () => {
    const { win, src, raw } = setup();
    src.dispose();
    win.dispatchEvent(ev('keydown', { code: 'KeyW' }));
    src.poll(raw);
    expect(raw.keys[keyIndex('KeyW')]).toBe(0);
  });
});
