// Conta de viewports e drawing buffer, sem three (testável em Node).

/** Retângulo no drawing buffer em px reais, origem no canto INFERIOR esquerdo (convenção do GL). */
export interface GlRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function createGlRect(): GlRect {
  return { x: 0, y: 0, width: 0, height: 0 };
}

/**
 * Tamanho real do drawing buffer a partir do tamanho que a plataforma informou (px reais, já com o DPR do aparelho) e
 * do teto de DPR do perfil: com DPR 3 e teto 2, o buffer fica com 2/3 do tamanho e o CSS da casca estica.
 */
export function bufferScale(pixelRatio: number, maxPixelRatio: number): number {
  if (!(pixelRatio > 0) || !(maxPixelRatio > 0) || pixelRatio <= maxPixelRatio) return 1;
  return maxPixelRatio / pixelRatio;
}

/**
 * Converte um retângulo em px da superfície (origem no canto SUPERIOR esquerdo, como `ViewDesc` e `DrawList`) para o
 * drawing buffer do GL. Arredonda as BORDAS (não os tamanhos), assim viewports vizinhas dividem a mesma aresta sem fresta
 * nem sobreposição em qualquer escala.
 */
export function surfaceRectToGl(
  x: number,
  y: number,
  width: number,
  height: number,
  scale: number,
  bufferHeight: number,
  out: GlRect,
): GlRect {
  const x0 = Math.round(x * scale);
  const x1 = Math.round((x + width) * scale);
  const y0 = Math.round(y * scale);
  const y1 = Math.round((y + height) * scale);
  out.x = x0;
  out.width = Math.max(0, x1 - x0);
  out.y = bufferHeight - y1;
  out.height = Math.max(0, y1 - y0);
  return out;
}
