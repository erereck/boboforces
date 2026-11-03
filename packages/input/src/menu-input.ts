import { MENU_ACTION_INDEX, MENU_ACTIONS, type MenuAction, type MenuConfirmConvention } from './actions.ts';
import type { DeviceKind } from './bindings.ts';
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
}

export function createMenuInput(convention: MenuConfirmConvention = 'bottom'): MenuInput {
  const keyboard = createInputMapper({ kind: 'keyboardMouse' }, createKeyboardMouseProfile());
  const gamepadProfile = createGamepadProfile(convention);
  const pads: InputMapper[] = [];
  for (let i = 0; i < MAX_GAMEPADS; i++) pads.push(createInputMapper({ kind: 'gamepad', index: i }, gamepadProfile));
  const fired = new Uint8Array(MENU_ACTIONS.length);
  let lastDevice: DeviceKind | null = null;
  let lastGamepad = -1;

  return {
    get lastDevice(): DeviceKind | null {
      return lastDevice;
    },
    get lastGamepad(): number {
      return lastGamepad;
    },
    update(raw, dt): void {
      fired.fill(0);
      keyboard.update(raw, dt);
      if (keyboard.active) lastDevice = 'keyboardMouse';
      for (let m = 0; m < MENU_ACTIONS.length; m++) if (keyboard.menuPressed(MENU_ACTIONS[m]!)) fired[m] = 1;
      for (let i = 0; i < MAX_GAMEPADS; i++) {
        const pad = pads[i]!;
        // Desconectado também atualiza (lê zeros), para não guardar botão "preso" até reconectar.
        pad.update(raw, dt);
        if (pad.active) {
          lastDevice = 'gamepad';
          lastGamepad = i;
        }
        for (let m = 0; m < MENU_ACTIONS.length; m++) if (pad.menuPressed(MENU_ACTIONS[m]!)) fired[m] = 1;
      }
      for (let t = 0; t < MAX_TOUCHES; t++) {
        if (raw.touches[t]?.active) {
          lastDevice = 'touch';
          break;
        }
      }
    },
    pressed(action): boolean {
      return fired[MENU_ACTION_INDEX[action]] === 1;
    },
    setProfiles(keyboardProfile, padProfile): void {
      keyboard.setProfile(keyboardProfile);
      for (let i = 0; i < MAX_GAMEPADS; i++) pads[i]!.setProfile(padProfile);
    },
  };
}
