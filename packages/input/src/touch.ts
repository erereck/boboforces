import { TOUCH_CONTROLS, type TouchControlId } from './bindings.ts';

/**
 * Layout do toque no celular (arte-ux.md §7.3, tecnico.md §10). Tudo em px de LAYOUT; o mapeador e a UI multiplicam
 * por `RawInputState.pixelRatio`.
 * - Metade esquerda: joystick que nasce onde o dedo toca (raio 60, zona morta 8).
 * - Metade direita: arrastar para mirar; o botão de tiro também mira enquanto o dedo arrasta.
 * - Botões de pelo menos 64 px (pausa: 48, acima do alvo mínimo de 44), 12 px entre eles.
 * - Nada começa a menos de 24 px da borda (gestos de voltar e deslize do sistema).
 * - Canhoto espelha tudo na horizontal.
 */

/** Canto de referência de um botão. */
export type TouchAnchor = 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';

export interface TouchButtonDef {
  readonly control: TouchControlId;
  readonly anchor: TouchAnchor;
  /** Distância do centro até a borda vertical do canto (para dentro), px de layout. */
  readonly x: number;
  /** Distância do centro até a borda horizontal do canto (para dentro), px de layout. */
  readonly y: number;
  readonly radius: number;
  /** O dedo que começou neste botão também mira ao arrastar (o ATIRAR). */
  readonly aims: boolean;
}

export interface TouchLayout {
  readonly joystickRadius: number;
  readonly joystickDeadzone: number;
  /** Margem morta das bordas: toque que começa aqui é ignorado. */
  readonly edgeMargin: number;
  /** Folga do acerto em volta de cada botão (dedo gordo), px de layout. */
  readonly hitSlop: number;
  /** Espelha o layout (joystick à direita, botões à esquerda). */
  readonly leftHanded: boolean;
  readonly buttons: readonly TouchButtonDef[];
}

/**
 * Layout padrão, pensado para caber em 667×375 (menor paisagem testada, regra 17): todos os botões ficam na metade
 * direita, a 24 px ou mais da borda e a 12 px ou mais um do outro (o teste confere).
 */
export const DEFAULT_TOUCH_LAYOUT: TouchLayout = {
  joystickRadius: 60,
  joystickDeadzone: 8,
  edgeMargin: 24,
  hitSlop: 6,
  leftHanded: false,
  buttons: [
    { control: 'jump', anchor: 'bottomRight', x: 56, y: 56, radius: 32, aims: false },
    { control: 'crouch', anchor: 'bottomRight', x: 56, y: 132, radius: 32, aims: false },
    { control: 'grenade', anchor: 'bottomRight', x: 56, y: 208, radius: 32, aims: false },
    { control: 'fire', anchor: 'bottomRight', x: 140, y: 100, radius: 40, aims: true },
    { control: 'reload', anchor: 'bottomRight', x: 140, y: 184, radius: 32, aims: false },
    { control: 'ads', anchor: 'bottomRight', x: 224, y: 56, radius: 32, aims: false },
    { control: 'weapon', anchor: 'bottomRight', x: 224, y: 140, radius: 32, aims: false },
    { control: 'pause', anchor: 'topRight', x: 56, y: 56, radius: 24, aims: false },
  ],
};

export function touchControlIndex(control: string): number {
  return (TOUCH_CONTROLS as readonly string[]).indexOf(control);
}

/** Círculo de um botão na superfície, em px reais. */
export interface TouchButtonRect {
  control: TouchControlId;
  x: number;
  y: number;
  radius: number;
}

/** Centro e raio do botão `i` do layout numa superfície `width`×`height` (px reais). Sem alocação. */
export function placeTouchButton(
  layout: TouchLayout,
  i: number,
  width: number,
  height: number,
  pixelRatio: number,
  out: TouchButtonRect,
): TouchButtonRect {
  const b = layout.buttons[i]!;
  const right = b.anchor === 'topRight' || b.anchor === 'bottomRight';
  const bottom = b.anchor === 'bottomLeft' || b.anchor === 'bottomRight';
  const onRight = right !== layout.leftHanded;
  out.control = b.control;
  out.x = onRight ? width - b.x * pixelRatio : b.x * pixelRatio;
  out.y = bottom ? height - b.y * pixelRatio : b.y * pixelRatio;
  out.radius = b.radius * pixelRatio;
  return out;
}

/** Todos os botões posicionados (para a UI desenhar; aloca, chame quando a tela mudar de tamanho). */
export function layoutTouchButtons(
  layout: TouchLayout,
  width: number,
  height: number,
  pixelRatio: number,
): TouchButtonRect[] {
  const out: TouchButtonRect[] = [];
  for (let i = 0; i < layout.buttons.length; i++) {
    out.push(placeTouchButton(layout, i, width, height, pixelRatio, { control: 'fire', x: 0, y: 0, radius: 0 }));
  }
  return out;
}

const scratchRect: TouchButtonRect = { control: 'fire', x: 0, y: 0, radius: 0 };

/** Índice do botão do layout sob o ponto (px reais), ou -1. Com sobreposição, o mais próximo do centro ganha. */
export function hitTouchButton(
  layout: TouchLayout,
  px: number,
  py: number,
  width: number,
  height: number,
  pixelRatio: number,
): number {
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < layout.buttons.length; i++) {
    const r = placeTouchButton(layout, i, width, height, pixelRatio, scratchRect);
    const dx = px - r.x;
    const dy = py - r.y;
    const d2 = dx * dx + dy * dy;
    const reach = r.radius + layout.hitSlop * pixelRatio;
    if (d2 <= reach * reach && d2 < bestDist) {
      best = i;
      bestDist = d2;
    }
  }
  return best;
}

/** O toque começou dentro da margem morta das bordas. */
export function inTouchEdgeMargin(
  layout: TouchLayout,
  px: number,
  py: number,
  width: number,
  height: number,
  pixelRatio: number,
): boolean {
  const m = layout.edgeMargin * pixelRatio;
  return px < m || py < m || px > width - m || py > height - m;
}

/** O ponto está na metade do joystick (a esquerda; a direita no layout canhoto). */
export function inJoystickHalf(layout: TouchLayout, px: number, width: number): boolean {
  return layout.leftHanded ? px >= width / 2 : px < width / 2;
}
