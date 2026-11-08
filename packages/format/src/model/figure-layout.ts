/**
 * Layout da skin do boneco do FutBobo (decisão #56; PLANO do porte §B7 e §C2). CONTRATO: o pintor (F2), a UV do render
 * (F3), os cubinhos e o viewmodel leem daqui. Mudou um número: o `figure-layout.test.ts` e o gêmeo da UV do render
 * acompanham.
 *
 * Duas camadas 64×64 (texels, v para baixo; 2 t/px na cabeça e no tronco):
 *
 * Camada 0, cabeça, expressões e paleta:
 *   paleta 16 amostras 4×4 (0, 0, 16, 16) · cruz da cabeça com canto (0, 0) e medidas 16³: topo (16, 0), base (32, 0),
 *   +X direita (0, 16), frente (16, 16), −X esquerda (32, 16), costas (48, 16) · livre (48, 0, 16, 16) · expressão e
 *   em (16·(e mod 4), 32 + 16·⌊e/4⌋), 16×16, na ordem de `FACE_EXPRESSIONS`.
 *
 * Camada 1, tronco, colunas dos membros e reserva (farda da decisão #58):
 *   tronco: cruz 16×24×8 com canto (0, 0) = (0, 0, 48, 32) (jaqueta, colete, cinto) · canela: coluna de 4 t
 *   (48, 0, 4, 10) + calha até a linha 11, lida em u = 50 (joelheira, calça e a barra presa na bota) · bota: mini-cruz
 *   (w 1, h 5, d 4) = 10×9 com canto (53, 1), dentro da célula (52, 0, 12, 12) pintada com a cor da bota · colunas de
 *   manga (com a braçadeira), antebraço (com o punho da luva) e coxa (48, 12, 4, 10), (52, 12, 4, 10), (56, 12, 4, 11),
 *   lidas em u = 50, 54 e 58 (o zumbi pinta nelas a roupa rasgada) · livre (60, 12, 4, 12) e (48, 24, 16, 8) · reserva
 *   do capacete (0, 32, 64, 32), a cruz de uma casca 16³ (rodada 3).
 *
 * Todo canto de região é par e as células de listra são alinhadas a 4: o nível 1 é uma caixa 2×2 e o mip fica limpo
 * até o nível 2 sem misturar partes.
 *
 * Caixas de medidas 0 (amostra de paleta, coluna de listra): o VS soma 0,5 ao canto e lê o centro do texel, no nível 0.
 */

/** Camadas 64×64 da skin de um boneco (a skin do bobo A tinha 4, `SKIN_GPU_LAYERS`, aposentada no passo 5). */
export const FIGURE_SKIN_LAYERS = 2;
/** Bytes RGBA do nível 0 das camadas de uma skin (32 KB). */
export const FIGURE_SKIN_BYTES = FIGURE_SKIN_LAYERS * 64 * 64 * 4;
/** Bytes RGBA do nível 1 (32×32 por camada; 8 KB). */
export const FIGURE_SKIN_LEVEL1_BYTES = FIGURE_SKIN_LAYERS * 32 * 32 * 4;

/**
 * Regiões de UV em texels. `u`/`v` é o canto da cruz (`boxCrossRects` girado `Ry(π)` no render); `w`/`h`/`d` são as
 * medidas da cruz. Medida 0 = coluna (manga, antebraço, coxa, canela) ou amostra. `palette` e `expressions` são grades de
 * células.
 */
export const FIGURE_LAYOUT = {
  palette: { layer: 0, u: 0, v: 0, cell: 4, cols: 4 },
  head: { layer: 0, u: 0, v: 0, w: 16, h: 16, d: 16 },
  expressions: { layer: 0, u: 0, v: 32, cell: 16 },
  torso: { layer: 1, u: 0, v: 0, w: 16, h: 24, d: 8 },
  shin: { layer: 1, u: 50, v: 0, w: 0, h: 10, d: 0 },
  boot: { layer: 1, u: 53, v: 1, w: 1, h: 5, d: 4 },
  sleeve: { layer: 1, u: 50, v: 12, w: 0, h: 10, d: 0 },
  forearm: { layer: 1, u: 54, v: 12, w: 0, h: 10, d: 0 },
  thigh: { layer: 1, u: 58, v: 12, w: 0, h: 11, d: 0 },
  helmetReserve: { layer: 1, u: 0, v: 32, w: 64, h: 32 },
} as const;

/**
 * As 16 amostras da paleta (camada 0). A mão, o cabelo e os acessórios são cor de amostra, como no FutBobo; a manga e a
 * mão também servem ao braço da 1ª pessoa. `hand` é a luva (ou a mão nua, pele −10); `sleeve`, `pants`, `vest`,
 * `vestShade` e `boots` ficam como referência das cores da farda.
 */
export const FIGURE_SWATCH = {
  hair: 0,
  hairShade: 1,
  beard: 2,
  accessory: 3,
  accessoryShade: 4,
  gold: 5,
  skin: 6,
  hand: 7,
  sleeve: 8,
  pants: 9,
  vest: 10,
  vestShade: 11,
  boots: 12,
  hairBase: 13,
  zombieGoo: 14,
  zombieBandage: 15,
} as const;

/**
 * Canto (u0, v0) da amostra `i` para uma caixa de medidas 0, empacotado como `u0 + 64·v0`. O canto fica no meio da
 * célula 4×4, em (4·(i mod 4) + 2; 4·⌊i/4⌋ + 2); com o +0,5 do VS a leitura cai no centro do texel, dentro da célula
 * até o nível 2 do mip.
 */
export function figureSwatchCorner(i: number): number {
  const cell = FIGURE_LAYOUT.palette.cell;
  const cols = FIGURE_LAYOUT.palette.cols;
  const u0 = FIGURE_LAYOUT.palette.u + cell * (i % cols) + cell / 2;
  const v0 = FIGURE_LAYOUT.palette.v + cell * Math.floor(i / cols) + cell / 2;
  return u0 + 64 * v0;
}
