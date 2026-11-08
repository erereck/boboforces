// Tratamento do PCM antes do MP3 (puro, testável): corta o silêncio do começo, limita a duração com fade e
// normaliza o pico. Efeitos curtos e secos: sem compressão nem EQ (isso é do M2, com o áudio de verdade).

/** Abaixo disso (≈ -54 dBFS) conta como silêncio no começo do arquivo. */
export const SILENCE = 0.002;
/** Fade de saída quando o som é cortado em `maxS`. */
export const FADE_S = 0.02;

export interface ProcessOptions {
  readonly sampleRate: number;
  readonly maxS: number;
  readonly peakDb: number;
}

export interface ProcessResult {
  readonly pcm: Float32Array;
  readonly trimmedStartS: number;
  readonly cut: boolean;
  /** Pico original (dBFS). */
  readonly sourcePeakDb: number;
}

const toDb = (v: number): number => (v > 0 ? 20 * Math.log10(v) : -Infinity);

export function processPcm(input: Float32Array, opts: ProcessOptions): ProcessResult {
  let start = 0;
  while (start < input.length && Math.abs(input[start]!) < SILENCE) start++;
  if (start >= input.length) throw new Error('som vazio (só silêncio)');
  // Recua 1 ms para não comer o ataque.
  start = Math.max(0, start - Math.round(0.001 * opts.sampleRate));
  const maxLen = Math.round(opts.maxS * opts.sampleRate);
  // Fim: último trecho audível, sem passar de maxS.
  let end = input.length;
  while (end > start && Math.abs(input[end - 1]!) < SILENCE) end--;
  const cut = end - start > maxLen;
  const len = Math.min(end - start, maxLen);
  const pcm = input.slice(start, start + len);
  if (cut) {
    const fade = Math.min(len, Math.round(FADE_S * opts.sampleRate));
    for (let i = 0; i < fade; i++) pcm[len - 1 - i] = pcm[len - 1 - i]! * (i / fade);
  }
  let peak = 0;
  for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]!));
  const target = 10 ** (opts.peakDb / 20);
  if (peak > 0) {
    const k = target / peak;
    for (let i = 0; i < pcm.length; i++) pcm[i] = pcm[i]! * k;
  }
  return { pcm, trimmedStartS: start / opts.sampleRate, cut, sourcePeakDb: toDb(peak) };
}
