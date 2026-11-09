import { MOVE_DIRECTIONS, type GameAction, type MoveDirection } from './actions.ts';
import { TOUCH_CONTROLS, type BindingSource, type DeviceKind } from './bindings.ts';
import { KEY_CODES, KEY_COUNT, keyIndex } from './keys.ts';
import type { ControlProfile } from './profiles.ts';
import { GAMEPAD_BUTTONS, MAX_GAMEPADS, MOUSE_BUTTON, PAD_AXIS, PAD_BUTTON, type RawInputState } from './raw.ts';

/**
 * M2 (fase 4f): remapeamento ("tudo remapeável", arte-ux.md §7). O `settings@1` guarda, por dispositivo, só as ações
 * que fogem do padrão, com cada fonte em texto:
 * - `key:<KeyboardEvent.code>` · `mouse:<left|right|middle|back|forward>` · `wheel:up|down`;
 * - `pad:<posição>` (`pad:faceLeft:hold` = segurando) · `axis:<eixo>:+|-` · `touch:<controle>`.
 *
 * A pausa fica de fora (regra 16: o + e o Esc sempre pausam), assim como o Destravar (só de menu) e os menus (que
 * precisam funcionar sempre com o D-pad e confirmar/voltar).
 */
export type RemapAction = Exclude<GameAction, 'pause' | 'unstuck'> | MoveDirection;

/** Dispositivos com botões remapeáveis (no toque, os controles são desenhados na tela). */
export type RemapDevice = Exclude<DeviceKind, 'touch'>;

const REMAP_GAME: readonly RemapAction[] = [
  'fire',
  'ads',
  'jump',
  'crouch',
  'sprint',
  'reload',
  'use',
  'melee',
  'grenade',
  'nextWeapon',
  'prevWeapon',
  'lastWeapon',
  'slot1',
  'slot2',
  'slot3',
  'slot4',
  'ping',
  'emote',
  'scoreboard',
];

/** As ações de cada dispositivo, na ordem da tela (no controle, o movimento é o analógico). */
export const REMAP_ACTIONS: Readonly<Record<RemapDevice, readonly RemapAction[]>> = {
  keyboardMouse: [...MOVE_DIRECTIONS, ...REMAP_GAME],
  gamepad: REMAP_GAME,
};

function isMove(action: RemapAction): action is MoveDirection {
  return (MOVE_DIRECTIONS as readonly string[]).includes(action);
}

const MOUSE_NAMES = Object.keys(MOUSE_BUTTON) as (keyof typeof MOUSE_BUTTON)[];
const PAD_NAMES = Object.keys(PAD_BUTTON) as (keyof typeof PAD_BUTTON)[];
const AXIS_NAMES = Object.keys(PAD_AXIS) as (keyof typeof PAD_AXIS)[];

/** Fonte → texto do save. */
export function encodeBinding(s: BindingSource): string {
  switch (s.device) {
    case 'key':
      return `key:${KEY_CODES[s.key] ?? 'Unknown'}`;
    case 'mouseButton':
      return `mouse:${MOUSE_NAMES.find((n) => MOUSE_BUTTON[n] === s.button) ?? 'left'}`;
    case 'wheel':
      return s.direction > 0 ? 'wheel:down' : 'wheel:up';
    case 'padButton':
      return `pad:${PAD_NAMES.find((n) => PAD_BUTTON[n] === s.button) ?? 'faceDown'}${s.hold ? ':hold' : ''}`;
    case 'padAxis':
      return `axis:${AXIS_NAMES.find((n) => PAD_AXIS[n] === s.axis) ?? 'leftX'}:${s.direction > 0 ? '+' : '-'}`;
    case 'touchControl':
      return `touch:${s.control}`;
  }
}

/** Texto do save → fonte; texto que não se entende vira `null` (o save velho ou editado à mão não derruba nada). */
export function decodeBinding(text: string): BindingSource | null {
  const parts = text.split(':');
  const kind = parts[0];
  const name = parts[1] ?? '';
  const extra = parts[2];
  if (parts.length > 3) return null;
  switch (kind) {
    case 'key': {
      const i = keyIndex(name);
      return i > 0 && extra === undefined ? { device: 'key', key: i } : null;
    }
    case 'mouse':
      return Object.hasOwn(MOUSE_BUTTON, name) && extra === undefined
        ? { device: 'mouseButton', button: MOUSE_BUTTON[name as keyof typeof MOUSE_BUTTON] }
        : null;
    case 'wheel':
      return extra !== undefined
        ? null
        : name === 'up'
          ? { device: 'wheel', direction: -1 }
          : name === 'down'
            ? { device: 'wheel', direction: 1 }
            : null;
    case 'pad': {
      if (!Object.hasOwn(PAD_BUTTON, name)) return null;
      const button = PAD_BUTTON[name as keyof typeof PAD_BUTTON];
      if (extra === undefined) return { device: 'padButton', button };
      return extra === 'hold' ? { device: 'padButton', button, hold: true } : null;
    }
    case 'axis':
      return Object.hasOwn(PAD_AXIS, name) && (extra === '+' || extra === '-')
        ? { device: 'padAxis', axis: PAD_AXIS[name as keyof typeof PAD_AXIS], direction: extra === '+' ? 1 : -1 }
        : null;
    case 'touch':
      return (TOUCH_CONTROLS as readonly string[]).includes(name) && extra === undefined
        ? { device: 'touchControl', control: name }
        : null;
    default:
      return null;
  }
}

/** A fonte é do dispositivo? (teclado e mouse: tecla, botão, roda; controle: botão e eixo). */
function sourceFits(device: RemapDevice, s: BindingSource): boolean {
  if (device === 'keyboardMouse') return s.device === 'key' || s.device === 'mouseButton' || s.device === 'wheel';
  return s.device === 'padButton' || s.device === 'padAxis';
}

/** As fontes de uma ação no perfil. */
export function profileBindings(p: ControlProfile, action: RemapAction): readonly BindingSource[] {
  return (isMove(action) ? p.move[action] : p.game[action]) ?? [];
}

/**
 * Os botões salvos sobre o perfil padrão: cada ação salva troca a lista inteira (lista vazia = sem botão). Fonte que
 * não se entende ou de outro dispositivo é ignorada. No toque, nada muda.
 */
export function applyBindings(
  base: ControlProfile,
  bindings: Readonly<Record<string, readonly string[]>>,
): ControlProfile {
  if (base.device === 'touch') return base;
  let game = base.game;
  let move = base.move;
  let changed = false;
  for (const action of REMAP_ACTIONS[base.device]) {
    if (!Object.hasOwn(bindings, action)) continue;
    const sources: BindingSource[] = [];
    for (const text of bindings[action]!) {
      const s = decodeBinding(text);
      if (s !== null && sourceFits(base.device, s)) sources.push(s);
    }
    changed = true;
    if (isMove(action)) move = { ...move, [action]: sources };
    else game = { ...game, [action]: sources };
  }
  return changed ? { ...base, game, move } : base;
}

/** Uma fonte que o remapeamento não aceita: é da pausa (Esc e P no teclado, + no controle). */
export function isReservedSource(base: ControlProfile, source: BindingSource): boolean {
  const code = encodeBinding(source);
  return (base.game.pause ?? []).some((s) => encodeBinding(s) === code);
}

export interface RebindResult {
  /** O que vai para o save (só as ações fora do padrão). */
  readonly bindings: Record<string, string[]>;
  /** A ação que tinha a fonte nova e ficou só com ela, ou `null`. */
  readonly swapped: RemapAction | null;
  /** A ação `swapped` recebeu as fontes antigas da remapeada (troca) ou ficou sem botão. */
  readonly orphaned: boolean;
}

/**
 * Liga `action` só a `source`. Outra ação que usava a fonte perde ela; se ficar sem nada, recebe as fontes antigas da
 * ação remapeada (troca, como nos jogos do gênero).
 */
export function rebind(
  base: ControlProfile,
  bindings: Readonly<Record<string, readonly string[]>>,
  action: RemapAction,
  source: BindingSource,
): RebindResult {
  const device: RemapDevice = base.device === 'gamepad' ? 'gamepad' : 'keyboardMouse';
  const current = applyBindings(base, bindings);
  const code = encodeBinding(source);
  const lists = new Map<RemapAction, string[]>();
  for (const a of REMAP_ACTIONS[device]) lists.set(a, profileBindings(current, a).map(encodeBinding));
  const old = (lists.get(action) ?? []).filter((c) => c !== code);
  lists.set(action, [code]);
  let swapped: RemapAction | null = null;
  let orphaned = false;
  for (const [a, list] of lists) {
    if (a === action || !list.includes(code)) continue;
    const rest = list.filter((c) => c !== code);
    swapped = a;
    if (rest.length > 0) {
      lists.set(a, rest);
      orphaned = false;
    } else {
      lists.set(a, old);
      orphaned = old.length === 0;
    }
  }
  const out: Record<string, string[]> = {};
  for (const [a, list] of lists) {
    const def = profileBindings(base, a).map(encodeBinding);
    if (def.length !== list.length || def.some((c, i) => c !== list[i])) out[a] = list;
  }
  return { bindings: out, swapped, orphaned };
}

/** O que a captura viu neste frame: nada ainda, cancelou (Esc ou +) ou a fonte nova. */
export type CaptureResult = 'none' | 'cancel' | BindingSource;

/**
 * Captura da próxima tecla ou botão (a tela "Aperte o novo botão"). O que já estava apertado no começo (o confirmar
 * que abriu a captura) só vale depois de solto. Depois do resultado, `active` segue verdadeiro até tudo ser solto,
 * para o menu não receber a mesma tecla. Sem alocação por frame.
 */
export interface BindingCapture {
  readonly active: boolean;
  start(raw: Readonly<RawInputState>, device: RemapDevice): void;
  update(raw: Readonly<RawInputState>): CaptureResult;
  stop(): void;
}

const ESCAPE = keyIndex('Escape');
/** Botões do controle que a captura não liga: o + cancela; Home e Captura são do sistema. */
const PAD_SKIP = new Set<number>([PAD_BUTTON.start, PAD_BUTTON.home, PAD_BUTTON.capture]);
const PRESS = 0.5;

export function createBindingCapture(): BindingCapture {
  const keys = new Uint8Array(KEY_COUNT);
  const pads = new Uint8Array(MAX_GAMEPADS * GAMEPAD_BUTTONS);
  let mouse = 0;
  let state: 'idle' | 'listen' | 'release' = 'idle';
  let device: RemapDevice = 'keyboardMouse';

  const padDown = (raw: Readonly<RawInputState>, p: number, b: number): boolean => {
    const pad = raw.gamepads[p]!;
    return pad.connected && pad.buttons[b]! >= PRESS;
  };
  const anyHeld = (raw: Readonly<RawInputState>): boolean => {
    if (raw.mouseButtons !== 0) return true;
    for (let k = 0; k < KEY_COUNT; k++) if (raw.keys[k] === 1) return true;
    for (let p = 0; p < MAX_GAMEPADS; p++)
      for (let b = 0; b < GAMEPAD_BUTTONS; b++) if (padDown(raw, p, b)) return true;
    return false;
  };
  const finish = (r: CaptureResult): CaptureResult => {
    state = 'release';
    return r;
  };

  return {
    get active(): boolean {
      return state !== 'idle';
    },
    start(raw, dev): void {
      device = dev;
      state = 'listen';
      for (let k = 0; k < KEY_COUNT; k++) keys[k] = raw.keys[k] === 1 ? 1 : 0;
      mouse = raw.mouseButtons;
      for (let p = 0; p < MAX_GAMEPADS; p++) {
        for (let b = 0; b < GAMEPAD_BUTTONS; b++) pads[p * GAMEPAD_BUTTONS + b] = padDown(raw, p, b) ? 1 : 0;
      }
    },
    update(raw): CaptureResult {
      if (state === 'idle') return 'none';
      if (state === 'release') {
        if (!anyHeld(raw)) state = 'idle';
        return 'none';
      }
      // O que estava apertado no começo volta a valer depois de solto.
      for (let k = 0; k < KEY_COUNT; k++) if (keys[k] === 1 && raw.keys[k] !== 1) keys[k] = 0;
      mouse &= raw.mouseButtons;
      for (let p = 0; p < MAX_GAMEPADS; p++) {
        for (let b = 0; b < GAMEPAD_BUTTONS; b++) {
          const i = p * GAMEPAD_BUTTONS + b;
          if (pads[i] === 1 && !padDown(raw, p, b)) pads[i] = 0;
        }
      }
      if (raw.keys[ESCAPE] === 1 && keys[ESCAPE] === 0) return finish('cancel');
      for (let p = 0; p < MAX_GAMEPADS; p++) {
        const i = p * GAMEPAD_BUTTONS;
        if (padDown(raw, p, PAD_BUTTON.start) && pads[i + PAD_BUTTON.start] === 0) return finish('cancel');
      }
      if (device === 'keyboardMouse') {
        for (let k = 1; k < KEY_COUNT; k++) {
          if (raw.keys[k] === 1 && keys[k] === 0) return finish({ device: 'key', key: k });
        }
        const fresh = raw.mouseButtons & ~mouse;
        if (fresh !== 0) return finish({ device: 'mouseButton', button: fresh & -fresh });
        if (raw.wheel !== 0) return finish({ device: 'wheel', direction: raw.wheel > 0 ? 1 : -1 });
        return 'none';
      }
      for (let p = 0; p < MAX_GAMEPADS; p++) {
        for (let b = 0; b < GAMEPAD_BUTTONS; b++) {
          if (PAD_SKIP.has(b)) continue;
          if (padDown(raw, p, b) && pads[p * GAMEPAD_BUTTONS + b] === 0) {
            return finish({ device: 'padButton', button: b });
          }
        }
      }
      return 'none';
    },
    stop(): void {
      state = 'idle';
    },
  };
}
