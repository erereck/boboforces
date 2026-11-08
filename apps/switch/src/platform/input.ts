import {
  GAMEPAD_AXES,
  GAMEPAD_BUTTONS,
  KEY_COUNT,
  MAX_GAMEPADS,
  MAX_TOUCHES,
  keyIndex,
  type GamepadKind,
  type RawInputState,
} from '@boboforces/input';
import type { ControllerInfo, RawInputSource } from '@boboforces/platform-api';
import { NPAD_STYLE, type NxEvent, type NxGlobals, type NxGamepad } from './nx.ts';

/**
 * Adaptador de input do Switch (tecnico.md §10): `navigator.getGamepads()` a cada frame → `RawInputState`.
 * O nx.js já entrega os botões no mapeamento padrão por POSIÇÃO (0 = baixo = B, 1 = direita = A…), igual a
 * `PAD_BUTTON`; os eixos vêm como LX, LY, RX, RY com Y positivo para baixo. Teclado USB vira `keys` pelo `code`.
 * Sem mouse e sem toque no M0. Nenhuma alocação por frame.
 */

/** Tipo do controle pelo `styleSet`. Par de Joy-Con e Pro Controller são os suportados (decisão #32). */
export function gamepadKind(styleSet: number): GamepadKind {
  if (styleSet & NPAD_STYLE.handheld) return 'handheld';
  if (styleSet & NPAD_STYLE.joyDual) return 'joyConPair';
  if (styleSet & NPAD_STYLE.fullKey) return 'switchPro';
  if (styleSet & (NPAD_STYLE.joyLeft | NPAD_STYLE.joyRight)) return 'joyConSingle';
  return 'unknown';
}

export interface SwitchInputOptions {
  readonly nx: Pick<NxGlobals, 'navigator' | 'addEventListener' | 'removeEventListener' | 'screen'>;
  /** Um controle que estava conectado sumiu (a casca pede pausa, tecnico.md §11.2). */
  readonly onDisconnect: (index: number) => void;
}

export interface SwitchInput extends RawInputSource {
  describeControllers(out: ControllerInfo[]): number;
  dispose(): void;
}

/** Controle completo para o jogo (decisão #32): par de Joy-Con, Pro Controller ou portátil. */
export function isCompleteController(kind: GamepadKind): boolean {
  return kind === 'switchPro' || kind === 'joyConPair' || kind === 'handheld';
}

/** `ControllerInfo` com campos graváveis: a casca reescreve os mesmos objetos a cada chamada (sem alocar). */
interface MutableControllerInfo {
  index: number;
  id: string;
  kind: GamepadKind;
  styleSet: number;
  deviceType: number;
  complete: boolean;
  canVibrate: boolean;
}

export function createSwitchInput(opts: SwitchInputOptions): SwitchInput {
  const { nx } = opts;
  const connected = new Uint8Array(MAX_GAMEPADS);
  const keys = new Uint8Array(KEY_COUNT);
  const infos: MutableControllerInfo[] = [];
  for (let i = 0; i < MAX_GAMEPADS; i++) {
    infos.push({
      index: i,
      id: '',
      kind: 'unknown',
      styleSet: -1,
      deviceType: -1,
      complete: false,
      canVibrate: false,
    });
  }

  const onKey = (event: NxEvent): void => {
    if (!event.code) return;
    const index = keyIndex(event.code);
    if (index > 0) keys[index] = event.type === 'keydown' ? 1 : 0;
  };
  nx.addEventListener('keydown', onKey);
  nx.addEventListener('keyup', onKey);

  const clearPad = (out: RawInputState, i: number): void => {
    const dst = out.gamepads[i];
    if (!dst) return;
    dst.connected = false;
    dst.id = '';
    dst.kind = 'unknown';
    dst.axes.fill(0);
    dst.buttons.fill(0);
  };

  const copyPad = (out: RawInputState, i: number, pad: NxGamepad): void => {
    const dst = out.gamepads[i];
    if (!dst) return;
    dst.connected = true;
    if (dst.id !== pad.id) dst.id = pad.id;
    dst.kind = gamepadKind(pad.styleSet ?? 0);
    for (let a = 0; a < GAMEPAD_AXES; a++) dst.axes[a] = pad.axes[a] ?? 0;
    for (let b = 0; b < GAMEPAD_BUTTONS; b++) {
      const button = pad.buttons[b];
      dst.buttons[b] = button ? button.value || (button.pressed ? 1 : 0) : 0;
    }
  };

  return {
    poll(out) {
      let pads: readonly (NxGamepad | null)[] = [];
      try {
        pads = nx.navigator.getGamepads();
      } catch {
        // sem controles nesta volta; o estado abaixo zera tudo
      }
      for (let i = 0; i < MAX_GAMEPADS; i++) {
        const pad = i < pads.length ? pads[i] : null;
        if (pad && pad.connected) {
          copyPad(out, i, pad);
          connected[i] = 1;
        } else {
          clearPad(out, i);
          if (connected[i]) {
            connected[i] = 0;
            opts.onDisconnect(i);
          }
        }
      }
      out.keys.set(keys);
      out.mouseDX = 0;
      out.mouseDY = 0;
      out.wheel = 0;
      out.mouseButtons = 0;
      out.pointerLocked = false;
      for (let t = 0; t < MAX_TOUCHES; t++) {
        const touch = out.touches[t];
        if (touch) touch.active = false;
      }
      out.surfaceWidth = nx.screen.width;
      out.surfaceHeight = nx.screen.height;
      // 720p fixo: 1 px da tela = 1 px de layout (tecnico.md §6.10). Sem ponteiro absoluto no Switch.
      out.pixelRatio = 1;
      out.pointerInside = false;
    },
    describeControllers(out) {
      let pads: readonly (NxGamepad | null)[] = [];
      try {
        pads = nx.navigator.getGamepads();
      } catch {
        return 0;
      }
      let n = 0;
      for (let i = 0; i < MAX_GAMEPADS && i < pads.length; i++) {
        const pad = pads[i];
        if (!pad || !pad.connected) continue;
        const info = infos[n]!;
        info.index = i;
        if (info.id !== pad.id) info.id = pad.id;
        info.styleSet = pad.styleSet ?? -1;
        info.deviceType = pad.deviceType ?? -1;
        info.kind = gamepadKind(pad.styleSet ?? 0);
        info.complete = isCompleteController(info.kind);
        info.canVibrate = !!pad.vibrationActuator;
        out[n] = info;
        n++;
      }
      out.length = n;
      return n;
    },
    vibrate(gamepadIndex, strong, weak, durationMs) {
      try {
        const pad = nx.navigator.getGamepads()[gamepadIndex];
        const actuator = pad?.vibrationActuator;
        if (!actuator) return;
        const clamp = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
        actuator
          .playEffect('dual-rumble', {
            duration: durationMs,
            strongMagnitude: clamp(strong),
            weakMagnitude: clamp(weak),
          })
          .catch(() => {});
      } catch {
        // vibração é opcional
      }
    },
    dispose() {
      nx.removeEventListener('keydown', onKey);
      nx.removeEventListener('keyup', onKey);
    },
  };
}
