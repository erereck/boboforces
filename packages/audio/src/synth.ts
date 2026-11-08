// Sons sintetizados em código (decisão #39, tecnico.md §12): PCM gerado em JS e posto num `AudioBuffer` com
// `createBuffer` (item 19 do Teste Zero confere se o nx.js tem). Sem OscillatorNode (regra 9): o seno e o ruído são
// contas aqui. Determinístico (ruído pelo RNG com semente, nunca `Math.random`), para o mesmo som sair igual em toda
// plataforma e nos testes.
import { createRng } from '@boboforces/shared';

/** Taxa padrão dos sons sintetizados (a mesma dos MP3 convertidos pelo tools/audioconv). */
export const SYNTH_SAMPLE_RATE = 44100;

export interface BeepOptions {
  readonly frequencyHz: number;
  readonly durationS: number;
  readonly sampleRate?: number;
  /** Pico em [0, 1]. */
  readonly peak?: number;
  /** Segunda frequência para um "blip" que sobe (glissando linear); igual à primeira = tom fixo. */
  readonly endFrequencyHz?: number;
}

/** Tom curto de interface: seno com ataque de 4 ms e queda exponencial. */
export function synthBeep(opts: BeepOptions): Float32Array {
  const rate = opts.sampleRate ?? SYNTH_SAMPLE_RATE;
  const n = Math.max(1, Math.round(opts.durationS * rate));
  const out = new Float32Array(n);
  const peak = opts.peak ?? 0.5;
  const f0 = opts.frequencyHz;
  const f1 = opts.endFrequencyHz ?? f0;
  const attack = Math.max(1, Math.round(0.004 * rate));
  const decay = 5 / opts.durationS;
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const f = f0 + ((f1 - f0) * i) / n;
    phase += (2 * Math.PI * f) / rate;
    const env = (i < attack ? i / attack : 1) * Math.exp(-decay * t);
    out[i] = Math.sin(phase) * env * peak;
  }
  return out;
}

export interface NoiseBurstOptions {
  readonly durationS: number;
  readonly sampleRate?: number;
  readonly peak?: number;
  /** Semente do ruído (mesma semente, mesmo som). */
  readonly seed?: number;
  /** Corte inicial e final do passa-baixa de um polo (Hz): o "estalo" escurece enquanto cai. */
  readonly brightHz?: number;
  readonly darkHz?: number;
}

/**
 * Estouro de ruído com queda rápida e passa-baixa que fecha: serve de tiro sintetizado (reserva do MP3 do romfs) e de
 * impacto genérico.
 */
export function synthNoiseBurst(opts: NoiseBurstOptions): Float32Array {
  const rate = opts.sampleRate ?? SYNTH_SAMPLE_RATE;
  const n = Math.max(1, Math.round(opts.durationS * rate));
  const out = new Float32Array(n);
  const rng = createRng(opts.seed ?? 1);
  const peak = opts.peak ?? 0.8;
  const bright = opts.brightHz ?? 9000;
  const dark = opts.darkHz ?? 600;
  const decay = 7 / opts.durationS;
  let low = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const cutoff = dark + (bright - dark) * Math.exp(-decay * 1.5 * t);
    const a = 1 - Math.exp((-2 * Math.PI * cutoff) / rate);
    low += a * (rng.next() * 2 - 1 - low);
    const env = i < 32 ? i / 32 : Math.exp(-decay * t);
    out[i] = low * env * peak * 2;
  }
  // Normaliza o pico (o filtro come amplitude) sem passar de `peak`.
  let max = 0;
  for (let i = 0; i < n; i++) max = Math.max(max, Math.abs(out[i]!));
  if (max > 0) {
    const k = peak / max;
    for (let i = 0; i < n; i++) out[i] = out[i]! * k;
  }
  return out;
}

/** Os sons sintetizados do M1 (teste de áudio do T0): nome lógico → PCM mono a `SYNTH_SAMPLE_RATE`. */
export const SYNTH_SOUNDS = {
  /** Confirmação de interface (bip que sobe). */
  'sintetico-bip': () => synthBeep({ frequencyHz: 880, endFrequencyHz: 1320, durationS: 0.12, peak: 0.45 }),
  /** Tiro de reserva: estouro de ruído. */
  'sintetico-tiro': () => synthNoiseBurst({ durationS: 0.35, seed: 0xb0b0, peak: 0.8 }),
} as const satisfies Readonly<Record<string, () => Float32Array>>;

export type SynthSoundName = keyof typeof SYNTH_SOUNDS;
