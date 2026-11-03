/**
 * DrawList: a saída da UI (sem GL). O `render` desenha a lista em 1 ou 2 draw calls por viewport pelo programa de UI
 * (MSDF + sprites). Comandos em typed arrays pré-alocados: zero alocação por frame.
 *
 * Coordenadas em px do alvo (viewport ou tela inteira), origem no canto superior esquerdo, y para baixo.
 * Cores em 0xRRGGBBAA. `geom` tem 8 floats por comando: x, y, w, h, u0, v0, u1, v1. Em sprite/glifo os 4 últimos são
 * UV (origem no canto superior esquerdo da página). Em `rect` eles descrevem a forma, desenhada por SDF no mesmo
 * programa: u0 = chanfro de 45° no canto superior direito (px), v0 = espessura do contorno (px; 0 = cheio),
 * u1 = largura da faixa zebrada diagonal (px; 0 = sem faixa), v1 = reservado.
 */
export const DRAW_OP = {
  /** Retângulo de cor sólida, com chanfro/contorno/faixa opcionais (ver acima). */
  rect: 1,
  /** Sprite de um atlas (`textures[i]` = página do atlas de sprites). */
  sprite: 2,
  /** Glifo MSDF (`textures[i]` = camada da fonte no atlas da UI: 0 display, 1 HUD). */
  glyph: 3,
  /** Começa recorte no retângulo do comando (o render recorta os quads na CPU: não quebra o lote). */
  clipPush: 4,
  /** Termina o recorte mais recente. */
  clipPop: 5,
} as const;

export type DrawOp = (typeof DRAW_OP)[keyof typeof DRAW_OP];

export const DRAW_FLOATS_PER_COMMAND = 8;

export interface DrawList {
  readonly capacity: number;
  count: number;
  /** Tamanho do alvo em px. */
  width: number;
  height: number;
  readonly ops: Uint8Array;
  readonly geom: Float32Array;
  readonly colors: Uint32Array;
  readonly textures: Uint16Array;
  /** Comandos descartados por falta de capacidade desde o último reset (o F2 mostra). */
  overflow: number;
}

export function createDrawList(capacity = 4096): DrawList {
  return {
    capacity,
    count: 0,
    width: 0,
    height: 0,
    ops: new Uint8Array(capacity),
    geom: new Float32Array(capacity * DRAW_FLOATS_PER_COMMAND),
    colors: new Uint32Array(capacity),
    textures: new Uint16Array(capacity),
    overflow: 0,
  };
}

export function resetDrawList(list: DrawList, width: number, height: number): void {
  list.count = 0;
  list.overflow = 0;
  list.width = width;
  list.height = height;
}

function push(
  list: DrawList,
  op: DrawOp,
  x: number,
  y: number,
  w: number,
  h: number,
  u0: number,
  v0: number,
  u1: number,
  v1: number,
  color: number,
  texture: number,
): void {
  if (list.count >= list.capacity) {
    list.overflow++;
    return;
  }
  const i = list.count++;
  const g = i * DRAW_FLOATS_PER_COMMAND;
  list.ops[i] = op;
  list.geom[g] = x;
  list.geom[g + 1] = y;
  list.geom[g + 2] = w;
  list.geom[g + 3] = h;
  list.geom[g + 4] = u0;
  list.geom[g + 5] = v0;
  list.geom[g + 6] = u1;
  list.geom[g + 7] = v1;
  list.colors[i] = color >>> 0;
  list.textures[i] = texture;
}

export function pushRect(list: DrawList, x: number, y: number, w: number, h: number, color: number): void {
  push(list, DRAW_OP.rect, x, y, w, h, 0, 0, 0, 0, color, 0);
}

/**
 * Retângulo com a assinatura visual: chanfro no canto superior direito, contorno (`stroke` > 0 desenha só a borda) e
 * faixa zebrada diagonal (`stripes` = largura da faixa; a outra metade fica transparente). Tudo em px do alvo.
 */
export function pushShape(
  list: DrawList,
  x: number,
  y: number,
  w: number,
  h: number,
  color: number,
  chamfer: number,
  stroke = 0,
  stripes = 0,
): void {
  push(list, DRAW_OP.rect, x, y, w, h, chamfer, stroke, stripes, 0, color, 0);
}

export function pushSprite(
  list: DrawList,
  x: number,
  y: number,
  w: number,
  h: number,
  u0: number,
  v0: number,
  u1: number,
  v1: number,
  tint: number,
  atlasPage: number,
): void {
  push(list, DRAW_OP.sprite, x, y, w, h, u0, v0, u1, v1, tint, atlasPage);
}

export function pushGlyph(
  list: DrawList,
  x: number,
  y: number,
  w: number,
  h: number,
  u0: number,
  v0: number,
  u1: number,
  v1: number,
  color: number,
  font: number,
): void {
  push(list, DRAW_OP.glyph, x, y, w, h, u0, v0, u1, v1, color, font);
}

export function pushClip(list: DrawList, x: number, y: number, w: number, h: number): void {
  push(list, DRAW_OP.clipPush, x, y, w, h, 0, 0, 0, 0, 0, 0);
}

export function popClip(list: DrawList): void {
  push(list, DRAW_OP.clipPop, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
}
