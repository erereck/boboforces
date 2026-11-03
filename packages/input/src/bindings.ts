import { keyIndex, type KeyCode } from './keys.ts';
import { MOUSE_BUTTON, PAD_AXIS, PAD_BUTTON } from './raw.ts';

/** Que dispositivo um slot local (1 a 4) escuta. Teclado + mouse contam como UM slot. */
export type DeviceBinding =
  | { readonly kind: 'keyboardMouse' }
  | { readonly kind: 'gamepad'; readonly index: number }
  | { readonly kind: 'touch' };

export type DeviceKind = DeviceBinding['kind'];

export function sameDevice(a: DeviceBinding, b: DeviceBinding): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind !== 'gamepad' || a.index === (b as { readonly index: number }).index;
}

/** Controles de toque desenhados pelo jogo (arte-ux.md §7.3). Ordem só interna; o save guarda o nome. */
export const TOUCH_CONTROLS = ['fire', 'ads', 'jump', 'crouch', 'reload', 'grenade', 'weapon', 'pause'] as const;

export type TouchControlId = (typeof TOUCH_CONTROLS)[number];

/**
 * Uma entrada física ligada a uma ação:
 * - `key`: índice de `KEY_CODES` (o save guarda o `code` em texto e converte com `keyIndex`);
 * - `mouseButton`: bit de `MOUSE_BUTTON`;
 * - `wheel`: um passo da roda vale um toque na ação (pulso de 1 frame), mesmo rolando sem parar;
 * - `padButton`: índice de `PAD_BUTTON`;
 * - `padAxis`: índice de `PAD_AXIS` numa direção; vale como botão quando passa do limiar do perfil;
 * - `touchControl`: controle de toque desenhado pelo jogo, por id de `TOUCH_CONTROLS`.
 *
 * `hold: true` = só vale depois de segurar por `ControlProfile.holdS` (ex.: no controle, o botão da esquerda recarrega
 * no toque e interage segurando).
 */
export type BindingSource = (
  | { readonly device: 'key'; readonly key: number }
  | { readonly device: 'mouseButton'; readonly button: number }
  | { readonly device: 'wheel'; readonly direction: 1 | -1 }
  | { readonly device: 'padButton'; readonly button: number }
  | { readonly device: 'padAxis'; readonly axis: number; readonly direction: 1 | -1 }
  | { readonly device: 'touchControl'; readonly control: string }
) & { readonly hold?: boolean };

// Construtores curtos para os perfis (e para o remapeamento no M2).

export function key(code: KeyCode): BindingSource {
  return { device: 'key', key: keyIndex(code) };
}

export function mouse(button: keyof typeof MOUSE_BUTTON): BindingSource {
  return { device: 'mouseButton', button: MOUSE_BUTTON[button] };
}

export function wheel(direction: 1 | -1): BindingSource {
  return { device: 'wheel', direction };
}

export function pad(button: keyof typeof PAD_BUTTON, hold = false): BindingSource {
  return hold
    ? { device: 'padButton', button: PAD_BUTTON[button], hold }
    : { device: 'padButton', button: PAD_BUTTON[button] };
}

export function padAxis(axis: keyof typeof PAD_AXIS, direction: 1 | -1): BindingSource {
  return { device: 'padAxis', axis: PAD_AXIS[axis], direction };
}

export function touch(control: TouchControlId): BindingSource {
  return { device: 'touchControl', control };
}

/** Teclas Ctrl: o navegador reserva Ctrl+W/T/N, então o jogo avisa quando o jogador liga uma ação ao Ctrl. */
const CTRL_KEYS: readonly number[] = [keyIndex('ControlLeft'), keyIndex('ControlRight')];

export function isCtrlBinding(source: BindingSource): boolean {
  return source.device === 'key' && CTRL_KEYS.includes(source.key);
}
