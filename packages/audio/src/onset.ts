// M12 (fase 4): o silêncio do começo dos MP3 decodificados. O lamejs não grava a etiqueta "gapless" (Xing/Info) e o
// decodificador entrega o atraso do codificador (576 amostras, 13 ms a 44,1 kHz; mais 529 se o decodificador não
// compensar o dele) antes do ataque, com o pré-eco do MP3 por cima. Conta pura sobre o PCM: o mixer mede e recorta.

/** Onde está o ataque: a 1ª amostra a −20 dB do pico (o pré-eco do MP3 fica abaixo disto). */
const ATTACK_REL = 0.1;
/** Recuando do ataque, a janela de 1 ms ainda conta como ataque enquanto tiver amostra a −30 dB do pico. */
const RISE_REL = 0.0316;
const WINDOW_S = 0.001;
/** O pico e o ataque se procuram só no começo: o teto do corte mais isto (revisão: nada de varrer o som inteiro). */
const SCAN_S = 0.1;

/**
 * Quantas amostras cortar do começo do canal `data` (taxa `rate`): até `keepS` antes do ataque, recuando pela subida
 * dele em janelas de 1 ms (um som de ataque mole não perde a subida), nunca mais que `maxS`. 0 = nada a cortar. O pico
 * de referência é o dos primeiros `maxS` + 100 ms.
 */
export function leadingSilenceSamples(data: Float32Array, rate: number, maxS: number, keepS = 0.001): number {
  const limit = Math.min(data.length, Math.floor(maxS * rate));
  const scan = Math.min(data.length, limit + Math.round(SCAN_S * rate));
  let peak = 0;
  for (let i = 0; i < scan; i++) {
    const a = Math.abs(data[i]!);
    if (a > peak) peak = a;
  }
  if (peak <= 0 || limit <= 0) return 0;
  const attack = ATTACK_REL * peak;
  let onset = -1;
  for (let i = 0; i < scan; i++) {
    if (Math.abs(data[i]!) >= attack) {
      onset = i;
      break;
    }
  }
  if (onset <= 0) return 0;
  // Recua pela subida: enquanto a janela anterior tiver amostra a −30 dB do pico, ela é parte do ataque.
  const win = Math.max(1, Math.round(WINDOW_S * rate));
  const rise = RISE_REL * peak;
  let start = onset;
  while (start > 0) {
    const from = Math.max(0, start - win);
    let loud = false;
    for (let i = from; i < start && !loud; i++) loud = Math.abs(data[i]!) >= rise;
    if (!loud) break;
    start = from;
  }
  const cut = Math.min(limit, start - Math.round(keepS * rate));
  return cut > 0 ? cut : 0;
}
