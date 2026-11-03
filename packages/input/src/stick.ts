/**
 * Analógicos (tecnico.md §10): zona morta RADIAL interna e externa, depois curva de resposta. Radial (não por eixo)
 * para a diagonal não "grudar" nos eixos; a curva atua na magnitude e preserva a direção.
 */

/**
 * Magnitude reescalada pela zona morta: 0 até `inner`, 1 a partir de `outer`, linear no meio. É a magnitude ANTES da
 * curva (usada para saber se o stick está na borda).
 */
export function radialDeadzone(magnitude: number, inner: number, outer: number): number {
  if (magnitude <= inner) return 0;
  if (magnitude >= outer || outer <= inner) return 1;
  return (magnitude - inner) / (outer - inner);
}

/** Curva de resposta: `t^expoente` em [0, 1] (expoente 1 = linear; ~2 dá precisão perto do centro). */
export function responseCurve(t: number, exponent: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return exponent === 1 ? t : Math.pow(t, exponent);
}

/**
 * Aplica zona morta e curva a um stick `(x, y)` em [-1, 1] e grava o vetor resultante em `out[0]`, `out[1]` (módulo
 * ≤ 1). Devolve a magnitude depois da zona morta e antes da curva. Sem alocação.
 */
export function shapeStick(
  x: number,
  y: number,
  inner: number,
  outer: number,
  exponent: number,
  out: Float64Array | number[],
): number {
  const mag = Math.sqrt(x * x + y * y);
  const scaled = radialDeadzone(mag, inner, outer);
  if (scaled === 0) {
    out[0] = 0;
    out[1] = 0;
    return 0;
  }
  const k = responseCurve(scaled, exponent) / mag;
  out[0] = x * k;
  out[1] = y * k;
  return scaled;
}

/**
 * Multiplicador da aceleração na borda: o stick parado na borda por mais de `delayS` acelera o giro até `maxMul`,
 * numa rampa de `rampS` segundos. `edgeTimeS` é quanto tempo o stick está na borda.
 */
export function edgeAcceleration(edgeTimeS: number, delayS: number, rampS: number, maxMul: number): number {
  if (edgeTimeS <= delayS || maxMul <= 1) return 1;
  const t = rampS <= 0 ? 1 : Math.min(1, (edgeTimeS - delayS) / rampS);
  return 1 + (maxMul - 1) * t;
}
