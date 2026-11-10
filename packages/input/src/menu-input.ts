import { MENU_ACTION_INDEX, MENU_ACTIONS, type MenuAction, type MenuConfirmConvention } from './actions.ts';
import type { DeviceBinding, DeviceKind } from './bindings.ts';
import { createInputMapper, type InputMapper } from './mapper.ts';
import { createGamepadProfile, createKeyboardMouseProfile, type ControlProfile } from './profiles.ts';
import { MAX_GAMEPADS, MAX_TOUCHES, type RawInputState } from './raw.ts';

/**
 * Navegação de menus por AÇÕES vinda de qualquer dispositivo (regra 12: todo fluxo funciona só com D-pad + A/B).
 * Antes de existirem slots (título, menu principal), qualquer teclado ou controle navega. Cliques de mouse e toques
 * nos widgets são da UI (ela testa o ponto); aqui só entram para dizer qual foi o último dispositivo usado.
 */
export interface MenuInput {
  /** 1x por frame. */
  update(raw: Readonly<RawInputState>, dtSeconds: number): void;
  /** Algum dispositivo disparou a ação neste frame (com auto-repetição nas direções). */
  pressed(action: MenuAction): boolean;
  /** Último tipo de dispositivo usado (glifos das dicas e layout do HUD); `null` antes do primeiro input. */
  readonly lastDevice: DeviceKind | null;
  /** Índice do último controle usado (-1 se nenhum). */
  readonly lastGamepad: number;
  /** Troca os perfis (o jogador remapeou, ou a convenção de confirmar mudou). */
  setProfiles(keyboard: ControlProfile, gamepad: ControlProfile): void;
  /**
   * M3 (fase 1b): com o sofá, só o P1 navega nos menus globais (gameplay.md §10.6): `pressed`, `lastDevice` e
   * `lastGamepad` passam a ouvir só este dispositivo. `null` volta a aceitar qualquer um.
   */
  setOwner(device: DeviceBinding | null): void;
  /** M3 (fase 1b): a ação disparou neste frame NESTE dispositivo (o ◀ ▶ e o voltar de cada jogador do sofá). */
  pressedBy(device: DeviceBinding, action: MenuAction): boolean;
}

export function createMenuInput(convention: MenuConfirmConvention = 'bottom'): MenuInput {
  const keyboard = createInputMapper({ kind: 'keyboardMouse' }, createKeyboardMouseProfile());
  const gamepadProfile = createGamepadProfile(convention);
  const pads: InputMapper[] = [];
  for (let i = 0; i < MAX_GAMEPADS; i++) pads.push(createInputMapper({ kind: 'gamepad', index: i }, gamepadProfile));
  const fired = new Uint8Array(MENU_ACTIONS.length);
  let lastDevice: DeviceKind | null = null;
  let lastGamepad = -1;
  let owner: DeviceBinding | null = null;
  const listens = (kind: DeviceKind, pad = -1): boolean =>
    owner === null ||
    (owner.kind === kind && (kind !== 'gamepad' || (owner.kind === 'gamepad' && owner.index === pad)));

  return {
    get lastDevice(): DeviceKind | null {
      return lastDevice;
    },
    get lastGamepad(): number {
      return lastGamepad;
    },
    update(raw, dt): void {
      fired.fill(0);
      // Todos atualizam sempre (o `pressedBy` lê cada um); só os que o dono deixa contam para os menus globais.
      keyboard.update(raw, dt);
      if (listens('keyboardMouse')) {
        if (keyboard.active) lastDevice = 'keyboardMouse';
        for (let m = 0; m < MENU_ACTIONS.length; m++) if (keyboard.menuPressed(MENU_ACTIONS[m]!)) fired[m] = 1;
      }
      for (let i = 0; i < MAX_GAMEPADS; i++) {
        const pad = pads[i]!;
        // Desconectado também atualiza (lê zeros), para não guardar botão "preso" até reconectar.
        pad.update(raw, dt);
        if (!listens('gamepad', i)) continue;
        if (pad.active) {
          lastDevice = 'gamepad';
          lastGamepad = i;
        }
        for (let m = 0; m < MENU_ACTIONS.length; m++) if (pad.menuPressed(MENU_ACTIONS[m]!)) fired[m] = 1;
      }
      for (let t = 0; t < MAX_TOUCHES && listens('touch'); t++) {
        if (raw.touches[t]?.active) {
          lastDevice = 'touch';
          break;
        }
      }
    },
    pressed(action): boolean {
      return fired[MENU_ACTION_INDEX[action]] === 1;
    },
    setOwner(device): void {
      owner = device;
    },
    pressedBy(device, action): boolean {
      if (device.kind === 'keyboardMouse') return keyboard.menuPressed(action);
      if (device.kind === 'gamepad') return pads[device.index]?.menuPressed(action) ?? false;
      return false;
    },
    setProfiles(keyboardProfile, padProfile): void {
      keyboard.setProfile(keyboardProfile);
      for (let i = 0; i < MAX_GAMEPADS; i++) pads[i]!.setProfile(padProfile);
    },
  };
}
