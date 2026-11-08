// Layout dos atributos do programa 4 (instanciado), dividido entre a CPU (escrita das instâncias) e o GLSL
// (`shader.ts`). Sem three. Um lugar só para os números: shader e CPU nunca saem de sincronia.

/**
 * Bits de `aVert.y` (por VÉRTICE). A geometria diz o que cada vértice é; a instância diz de quem é.
 * - `alphaTest`: camadas cutout de modelo (`discard` com alfa < 0,5); nas caixas do boneco vem da flag da caixa.
 * - `face`: os 4 vértices da frente do cubo das figuras (com a flag `face` da caixa, a UV vai para a célula da
 *   expressão). A folha de rostos do bobo A, que também usava este bit, saiu no passo 5 do porte.
 * - `solid`: sem textura, cor sólida da instância (cubinhos de detrito).
 * - `emissive`: camada emissiva de modelo (holofote): luz cheia, sem depender da grade de luz.
 * - `box` (#56): vértice do cubo unitário das figuras. A instância é uma CAIXA do boneco (`FIGURE_INST`): centro,
 *   tamanho, giro e UV da cruz vêm da instância, e a 4ª linha da matriz traz luz, expressão e clarão. O bit 4 era o
 *   casco do contorno de time (saiu com a #50). Nos 4 vértices da frente do cubo vai também `face`: com a flag `face`
 *   da caixa, a UV desloca para a célula da expressão.
 */
export const VERTEX_FLAG = {
  alphaTest: 1,
  face: 2,
  box: 4,
  solid: 8,
  emissive: 16,
} as const;

/**
 * `aVert.x` < 0: a camada vem da INSTÂNCIA (a 1ª camada da skin do dono: braços do viewmodel; as caixas do boneco
 * leem a camada absoluta da instância) em vez do vértice (camada do modelo, `aVert.x` ≥ 0).
 */
export const LAYER_FROM_INSTANCE = -1;

/**
 * Floats por vértice em `aVert`: camada, flags, balanço com o vento (0 base … 1 topo) e um livre (−1; era a parte do
 * bobo A no desmonte por `iPart`, que saiu no passo 5 do porte).
 */
export const VERT_COMPONENTS = 4;

/**
 * Floats por INSTÂNCIA no buffer intercalado de dados (além da matriz). Quatro `vec4` no shader:
 *   iLayer = camada (a primeira da skin, ou a do modelo; -1 = do vértice), 0, 0, slot
 *   iLight = céu, sol, emissivo (0..1), flash de dano (0..1)
 *   iColor = r, g, b (cor sólida 0..1), time (0..3; 255 = sem time; o shader não lê desde a #50, fica de registro)
 *   iPart  = 0, 0, 0, 0 (fora das caixas; era a parte do desmonte e a camada externa da skin do bobo A)
 */
export const INSTANCE_FLOATS = 16;
export const INST = {
  layer: 0,
  slot: 3,
  sky: 4,
  sun: 5,
  emissive: 6,
  flash: 7,
  r: 8,
  g: 9,
  b: 10,
  team: 11,
} as const;

/**
 * Instância de CAIXA do boneco (#56, PLANO do porte §B10): os mesmos 16 floats intercalados, com outro significado
 * (o cubo marca os vértices com `VERTEX_FLAG.box`):
 *   iLayer = camada absoluta (1ª da skin + camada da caixa), canto u0 + 64·v0, medidas w + 64·h + 4096·d (texels), slot
 *   iLight = centro da caixa no espaço do osso (px), flags da caixa (`FIGURE_BOX_FLAG`)
 *   iColor = cos rotX, sen rotX, cos rotZ, sen rotZ (giro próprio Rx·Rz; sem giro, 1, 0, 1, 0)
 *   iPart  = tamanho da caixa (px), 0
 * A luz, a expressão e o clarão vão na 4ª linha da matriz (`writeFigureRow4`): mudam por quadro sem subir dados.
 */
export const FIGURE_INST = {
  layer: 0,
  corner: 1,
  dims: 2,
  slot: 3,
  cx: 4,
  cy: 5,
  cz: 6,
  flags: 7,
  cosX: 8,
  sinX: 9,
  cosZ: 10,
  sinZ: 11,
  sx: 12,
  sy: 13,
  sz: 14,
} as const;

/** Slot "ninguém" (o 255 do `ActorBuffer.localSlot`): nunca bate com o `uHideSlot` da vista. */
export const NO_SLOT = 255;
/** Time "nenhum" (FFA, zumbi, prop). */
export const NO_TEAM = 255;

/** Valores neutros de uma instância (prop, arma solta): luz cheia, sem flash, sem time, campos livres em 0. */
export function writeInstanceDefaults(data: Float32Array, o: number): void {
  data[o + INST.layer] = LAYER_FROM_INSTANCE;
  data[o + 1] = 0;
  data[o + 2] = 0;
  data[o + INST.slot] = NO_SLOT;
  data[o + INST.sky] = 1;
  data[o + INST.sun] = 1;
  data[o + INST.emissive] = 0;
  data[o + INST.flash] = 0;
  data[o + INST.r] = 1;
  data[o + INST.g] = 1;
  data[o + INST.b] = 1;
  data[o + INST.team] = NO_TEAM;
  data[o + 12] = 0;
  data[o + 13] = 0;
  data[o + 14] = 0;
  data[o + 15] = 0;
}

/** Cor 0xRRGGBB → 3 floats 0..1 em `out[o..o+2]`. */
export function writeRgb01(out: Float32Array, o: number, rgb: number): void {
  out[o] = ((rgb >> 16) & 0xff) / 255;
  out[o + 1] = ((rgb >> 8) & 0xff) / 255;
  out[o + 2] = (rgb & 0xff) / 255;
}
