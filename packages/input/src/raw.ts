import { KEY_COUNT } from './keys.ts';

/**
 * Estado bruto PADRONIZADO que cada casca preenche (web: eventos do DOM e Gamepad API; Switch: Gamepad do nx.js).
 * O código compartilhado nunca lê eventos: só este estado, 1x por frame, via `platform.input.poll(out)`.
 * Tudo é pré-alocado em `createRawInputState()`; o adaptador só sobrescreve valores (sem alocação por frame).
 */

export const MAX_GAMEPADS = 8;
export const MAX_TOUCHES = 10;
/** Eixos padronizados por controle: LX, LY, RX, RY. */
export const GAMEPAD_AXES = 4;
/** Botões do mapeamento padrão da Gamepad API (0..16) + 1 extra (captura no Switch). */
export const GAMEPAD_BUTTONS = 18;

/** Índices dos eixos. Y positivo = para baixo, como na Gamepad API. */
export const PAD_AXIS = { leftX: 0, leftY: 1, rightX: 2, rightY: 3 } as const;

/**
 * Índices dos botões no mapeamento padrão, por POSIÇÃO (não por letra): no Xbox o `faceDown` é o A; no Switch é o B.
 * Confirmar/voltar seguem a convenção de cada plataforma no perfil de controle, não aqui.
 */
export const PAD_BUTTON = {
  faceDown: 0,
  faceRight: 1,
  faceLeft: 2,
  faceUp: 3,
  bumperLeft: 4,
  bumperRight: 5,
  triggerLeft: 6,
  triggerRight: 7,
  select: 8,
  start: 9,
  stickLeft: 10,
  stickRight: 11,
  dpadUp: 12,
  dpadDown: 13,
  dpadLeft: 14,
  dpadRight: 15,
  home: 16,
  capture: 17,
} as const;

/** Bits de `RawInputState.mouseButtons` (botões 3 e 4 = voltar/avançar do mouse, que a casca bloqueia). */
export const MOUSE_BUTTON = { left: 1 << 0, right: 1 << 1, middle: 1 << 2, back: 1 << 3, forward: 1 << 4 } as const;

/** Como o adaptador reconheceu o controle: escolhe glifos e permite recusar Joy-Con avulso no Switch (decisão #32). */
export type GamepadKind = 'standard' | 'switchPro' | 'joyConPair' | 'joyConSingle' | 'handheld' | 'unknown';

export interface RawGamepad {
  connected: boolean;
  /** Identificador estável do aparelho (texto da Gamepad API ou do nx.js); vazio quando desconectado. */
  id: string;
  kind: GamepadKind;
  /** `GAMEPAD_AXES` valores em [-1, 1], sem zona morta (o perfil aplica). */
  readonly axes: Float32Array;
  /** `GAMEPAD_BUTTONS` valores em [0, 1] (gatilhos analógicos). */
  readonly buttons: Float32Array;
}

export interface RawTouch {
  active: boolean;
  /** Identificador do dedo enquanto ele estiver na tela. */
  id: number;
  /** Posição atual e inicial, em px da superfície de desenho. */
  x: number;
  y: number;
  startX: number;
  startY: number;
}

export interface RawInputState {
  /** 1 = pressionada, indexado por `KEY_CODES` (`keyIndex`). */
  readonly keys: Uint8Array;
  /** Movimento do mouse acumulado desde o último poll, em px (com pointer lock). */
  mouseDX: number;
  mouseDY: number;
  /** Rolagem acumulada desde o último poll, em passos (positivo = para baixo). */
  wheel: number;
  /** Bits de `MOUSE_BUTTON`. */
  mouseButtons: number;
  pointerLocked: boolean;
  /** `MAX_GAMEPADS` entradas fixas; desconectado = `connected: false`. */
  readonly gamepads: readonly RawGamepad[];
  /** `MAX_TOUCHES` entradas fixas; livre = `active: false`. */
  readonly touches: readonly RawTouch[];
  /** Tamanho da superfície em px, para o toque dividir a tela em metades. */
  surfaceWidth: number;
  surfaceHeight: number;
  /**
   * px da superfície por px de layout (DPR × escala de render). Os tamanhos do toque (joystick de 60 px, margem de
   * 24 px) são em px de layout e o mapeador multiplica por isto. 1 no Switch.
   */
  pixelRatio: number;
  /**
   * Ponteiro absoluto (mouse sem pointer lock), em px da superfície, para a UI acertar cliques. Com pointer lock, fica
   * no último valor. `pointerInside` = o ponteiro está sobre a superfície.
   */
  pointerX: number;
  pointerY: number;
  pointerInside: boolean;
}

export function createRawGamepad(): RawGamepad {
  return {
    connected: false,
    id: '',
    kind: 'unknown',
    axes: new Float32Array(GAMEPAD_AXES),
    buttons: new Float32Array(GAMEPAD_BUTTONS),
  };
}

export function createRawInputState(): RawInputState {
  const gamepads: RawGamepad[] = [];
  for (let i = 0; i < MAX_GAMEPADS; i++) gamepads.push(createRawGamepad());
  const touches: RawTouch[] = [];
  for (let i = 0; i < MAX_TOUCHES; i++) touches.push({ active: false, id: -1, x: 0, y: 0, startX: 0, startY: 0 });
  return {
    keys: new Uint8Array(KEY_COUNT),
    mouseDX: 0,
    mouseDY: 0,
    wheel: 0,
    mouseButtons: 0,
    pointerLocked: false,
    gamepads,
    touches,
    surfaceWidth: 0,
    surfaceHeight: 0,
    pixelRatio: 1,
    pointerX: 0,
    pointerY: 0,
    pointerInside: false,
  };
}
