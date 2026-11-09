import {
  GAME_ACTIONS,
  MENU_ACTIONS,
  MOVE_DIRECTIONS,
  type GameAction,
  type MenuAction,
  type MenuConfirmConvention,
  type MoveDirection,
} from './actions.ts';
import {
  isCtrlBinding,
  key,
  mouse,
  pad,
  padAxis,
  touch,
  wheel,
  type BindingSource,
  type DeviceKind,
} from './bindings.ts';
import { DEFAULT_TOUCH_LAYOUT, type TouchLayout } from './touch.ts';

export type StickId = 'left' | 'right';

/**
 * Perfil de controle de um jogador (vai no `settings@1`, por slot). Os números padrão vêm do tecnico.md §10 e da
 * arte-ux.md §7: zona morta radial 0,15/0,95, curva ~2, aceleração na borda depois de 0,3 s.
 */
export interface ControlProfile {
  readonly id: string;
  readonly device: DeviceKind;
  readonly game: Readonly<Partial<Record<GameAction, readonly BindingSource[]>>>;
  readonly menu: Readonly<Partial<Record<MenuAction, readonly BindingSource[]>>>;
  /** Movimento digital (WASD, setas, D-pad). Diagonal sai normalizada (não anda mais rápido). */
  readonly move: Readonly<Partial<Record<MoveDirection, readonly BindingSource[]>>>;
  /** Analógico que move e analógico que mira; trocar os dois é o layout canhoto. `null` = nenhum. */
  readonly moveStick: StickId | null;
  readonly lookStick: StickId | null;
  /** Mouse e toque: radianos por px de layout. Gamepad: radianos por segundo com o stick no máximo. */
  readonly lookSensitivity: number;
  /** Multiplicador da sensibilidade vertical (sensibilidade X/Y separada). */
  readonly lookSensitivityYMul: number;
  /** Multiplicador da sensibilidade durante o ADS. */
  readonly adsSensitivityMul: number;
  readonly invertY: boolean;
  readonly deadzoneInner: number;
  readonly deadzoneOuter: number;
  readonly curveExponent: number;
  /** Aceleração do giro com o stick de mira na borda: espera, rampa e multiplicador final (só no yaw). */
  readonly edgeAccelDelayS: number;
  readonly edgeAccelRampS: number;
  readonly edgeAccelMul: number;
  /** Gatilho analógico ou eixo vale como botão a partir deste valor. */
  readonly pressThreshold: number;
  /** Tempo segurando para as fontes com `hold`. */
  readonly holdS: number;
  /** Assistência de mira de 0 a 1 (Leve 0,25 / Média 0,4 / Forte 0,6, arte-ux.md §8); a regra da partida pode desligar. */
  readonly aimAssist: number;
  /** Agachar, mirar e correr como alternância em vez de segurar. */
  readonly toggleCrouch: boolean;
  readonly toggleAds: boolean;
  readonly toggleSprint: boolean;
  /** Layout do toque (só no perfil de toque). */
  readonly touch: TouchLayout | null;
}

/** Níveis da assistência de mira (arte-ux.md §8): a fração de desaceleração perto do alvo. */
export const AIM_ASSIST_LEVELS = { off: 0, light: 0.25, medium: 0.4, strong: 0.6 } as const;

/** Campos numéricos comuns aos perfis padrão. */
const COMMON = {
  lookSensitivityYMul: 1,
  adsSensitivityMul: 0.7,
  invertY: false,
  deadzoneInner: 0.15,
  deadzoneOuter: 0.95,
  curveExponent: 2,
  edgeAccelDelayS: 0.3,
  edgeAccelRampS: 0.25,
  edgeAccelMul: 1.6,
  pressThreshold: 0.5,
  holdS: 0.3,
  toggleCrouch: false,
  toggleAds: false,
  toggleSprint: false,
} as const;

/**
 * Teclado e mouse (arte-ux.md §7.1). Agachar no C, NUNCA no Ctrl (Ctrl+W fecha a aba). A pausa também vem do
 * `pointerlockchange` (o Esc com pointer lock nem chega à página), por isso o Esc aqui é só reserva sem lock.
 */
export function createKeyboardMouseProfile(): ControlProfile {
  return {
    ...COMMON,
    id: 'keyboardMouse.default',
    device: 'keyboardMouse',
    move: {
      forward: [key('KeyW')],
      back: [key('KeyS')],
      left: [key('KeyA')],
      right: [key('KeyD')],
    },
    game: {
      fire: [mouse('left')],
      ads: [mouse('right')],
      jump: [key('Space')],
      crouch: [key('KeyC')],
      sprint: [key('ShiftLeft'), key('ShiftRight')],
      reload: [key('KeyR')],
      use: [key('KeyE')],
      melee: [key('KeyV')],
      grenade: [key('KeyG')],
      ping: [mouse('middle')],
      emote: [key('KeyB')],
      slot1: [key('Digit1')],
      slot2: [key('Digit2')],
      slot3: [key('Digit3')],
      slot4: [key('Digit4')],
      nextWeapon: [wheel(1)],
      prevWeapon: [wheel(-1)],
      lastWeapon: [key('KeyQ')],
      // M2 (fase 6b): T de terceira pessoa; X troca o ombro.
      camera: [key('KeyT')],
      shoulder: [key('KeyX')],
      scoreboard: [key('Tab')],
      pause: [key('Escape'), key('KeyP')],
    },
    menu: {
      up: [key('ArrowUp'), key('KeyW')],
      down: [key('ArrowDown'), key('KeyS')],
      left: [key('ArrowLeft'), key('KeyA')],
      right: [key('ArrowRight'), key('KeyD')],
      confirm: [key('Enter'), key('NumpadEnter'), key('Space')],
      back: [key('Escape'), key('Backspace')],
      tabPrev: [key('KeyQ')],
      tabNext: [key('KeyE')],
      secondary: [key('KeyX')],
    },
    moveStick: null,
    lookStick: null,
    lookSensitivity: 0.0012,
    aimAssist: AIM_ASSIST_LEVELS.off,
    touch: null,
  };
}

/**
 * Controle genérico, por POSIÇÃO e sem marcas (arte-ux.md §7.2). `convention` decide quem confirma no menu: o botão
 * de baixo (web) ou o da direita (Switch). No jogo, o botão de baixo sempre pula.
 */
export function createGamepadProfile(convention: MenuConfirmConvention = 'bottom'): ControlProfile {
  const confirm = convention === 'right' ? pad('faceRight') : pad('faceDown');
  const back = convention === 'right' ? pad('faceDown') : pad('faceRight');
  return {
    ...COMMON,
    id: `gamepad.default.${convention}`,
    device: 'gamepad',
    move: {},
    game: {
      fire: [pad('triggerRight')],
      ads: [pad('triggerLeft')],
      jump: [pad('faceDown')],
      crouch: [pad('faceRight'), pad('stickRight')],
      sprint: [pad('stickLeft')],
      reload: [pad('faceLeft')],
      use: [pad('faceLeft', true)],
      melee: [pad('bumperLeft')],
      grenade: [pad('bumperRight')],
      nextWeapon: [pad('faceUp')],
      ping: [pad('dpadUp')],
      emote: [pad('dpadDown')],
      // M2 (fase 6b): o direcional dos lados (o de cima e o de baixo são aviso e emote).
      camera: [pad('dpadRight')],
      shoulder: [pad('dpadLeft')],
      scoreboard: [pad('select')],
      pause: [pad('start')],
    },
    menu: {
      up: [pad('dpadUp'), padAxis('leftY', -1)],
      down: [pad('dpadDown'), padAxis('leftY', 1)],
      left: [pad('dpadLeft'), padAxis('leftX', -1)],
      right: [pad('dpadRight'), padAxis('leftX', 1)],
      confirm: [confirm],
      back: [back],
      tabPrev: [pad('bumperLeft')],
      tabNext: [pad('bumperRight')],
      secondary: [pad('faceUp')],
    },
    moveStick: 'left',
    lookStick: 'right',
    lookSensitivity: 3.2,
    lookSensitivityYMul: 0.8,
    aimAssist: AIM_ASSIST_LEVELS.medium,
    touch: null,
  };
}

/**
 * Toque no celular (arte-ux.md §7.3): joystick na metade esquerda, arrastar na direita para mirar, botões na tela.
 * Menus no toque são por toque direto nos widgets (a UI testa o ponto), não por ações.
 */
export function createTouchProfile(layout: TouchLayout = DEFAULT_TOUCH_LAYOUT): ControlProfile {
  return {
    ...COMMON,
    id: 'touch.default',
    device: 'touch',
    move: {},
    game: {
      fire: [touch('fire')],
      ads: [touch('ads')],
      jump: [touch('jump')],
      crouch: [touch('crouch')],
      reload: [touch('reload')],
      grenade: [touch('grenade')],
      nextWeapon: [touch('weapon')],
      pause: [touch('pause')],
      // M2 (fase 6e).
      melee: [touch('melee')],
      camera: [touch('camera')],
    },
    menu: {},
    moveStick: null,
    lookStick: null,
    lookSensitivity: 0.006,
    aimAssist: AIM_ASSIST_LEVELS.medium,
    touch: layout,
  };
}

/** Perfil padrão de um tipo de dispositivo. */
export function defaultProfileFor(device: DeviceKind, convention: MenuConfirmConvention = 'bottom'): ControlProfile {
  if (device === 'gamepad') return createGamepadProfile(convention);
  if (device === 'touch') return createTouchProfile();
  return createKeyboardMouseProfile();
}

/** Avisos do perfil para a tela de controles (a UI traduz o código). */
export interface ProfileWarning {
  /** Ação de jogo, de menu ou direção de movimento. */
  readonly action: string;
  /** `binding.ctrlReserved`: Ctrl+W/T/N são do navegador e o jogo não consegue bloquear (tecnico.md §11.1). */
  readonly code: 'binding.ctrlReserved';
}

export function profileWarnings(profile: ControlProfile): ProfileWarning[] {
  const out: ProfileWarning[] = [];
  const check = (action: string, sources: readonly BindingSource[] | undefined): void => {
    if (sources?.some(isCtrlBinding)) out.push({ action, code: 'binding.ctrlReserved' });
  };
  for (const a of GAME_ACTIONS) check(a, profile.game[a]);
  for (const d of MOVE_DIRECTIONS) check(d, profile.move[d]);
  for (const m of MENU_ACTIONS) check(m, profile.menu[m]);
  return out;
}
