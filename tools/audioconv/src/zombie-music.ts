// M3 (fase 6e): a música do Bobo Zombies em 2 camadas (GDD §5.10: "Zombies em 2 camadas pela intensidade da onda";
// clima de marcha de brinquedo com percussão militar leve), composta em código e gravada em MP3 no build por
// `npm run audioconv -- --zumbis`. Provisória (#38): fica até o Erick escolher uma faixa CC0 (pergunta I3).
//
// Ré menor, 100 BPM, 8 compassos de 4/4 (19,2 s). A **calma** (entre as ondas, e a base durante a onda) é um bordão
// grave, uma caixinha de música assombrada e um "coração" no 1 e no 3. A **horda** (por cima, durante a onda) é a
// marcha: caixa clara no 2 e no 4 com rufos, um ostinato de baixo em colcheias e um surdo no 1. As duas têm o mesmo
// tamanho e tocam juntas no mesmo ponto do loop (`Mixer.setMusicLayer`). Determinístico: ruído com semente.
import { createRng, type Rng } from '@boboforces/shared';

const TAU = Math.PI * 2;

export const ZOMBIE_MUSIC = {
  sampleRate: 22050,
  bpm: 100,
  bars: 8,
  /** Pico de cada camada (as duas somadas ficam abaixo de 1,2; o canal da música começa em 0,49). */
  peak: 0.6,
  kbps: 48,
} as const;

/** Duração de uma colcheia (s) e o loop inteiro (amostras). */
export const eighthS = (): number => 60 / ZOMBIE_MUSIC.bpm / 2;
export const loopLength = (rate: number = ZOMBIE_MUSIC.sampleRate): number =>
  Math.round(ZOMBIE_MUSIC.bars * 8 * eighthS() * rate);

/** Nota (MIDI) → Hz. */
const hz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

/** Notas MIDI usadas. */
const N = {
  A1: 33,
  Bb1: 34,
  C2: 36,
  Cs2: 37,
  D2: 38,
  E2: 40,
  F2: 41,
  G2: 43,
  A2: 45,
  D4: 62,
  F4: 65,
  G4: 67,
  A4: 69,
  Bb4: 70,
  Cs5: 73,
  D5: 74,
  E5: 76,
  F5: 77,
  G5: 79,
  A5: 81,
  Bb5: 82,
} as const;

/** Escreve somando, com volta circular (o rabo de uma nota no fim do loop cai no começo: a emenda não estala). */
function add(out: Float32Array, i: number, v: number): void {
  const n = out.length;
  out[((i % n) + n) % n] = out[((i % n) + n) % n]! + v;
}

/** Caixinha de música: seno e o 4º harmônico, ataque seco e queda longa. */
function musicBox(out: Float32Array, rate: number, at: number, midi: number, level: number): void {
  const f = hz(midi);
  const n = Math.round(1.1 * rate);
  const from = Math.round(at * rate);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const env = Math.min(1, t / 0.003) * Math.exp(-t / 0.35);
    const v = Math.sin(TAU * f * t) + 0.25 * Math.sin(TAU * 4 * f * t) * Math.exp(-t / 0.08);
    add(out, from + i, v * env * level);
  }
}

/** Baixo pinçado (calma) ou "quadrado" de brinquedo (horda): seno com harmônicos ímpares e queda. */
function bass(
  out: Float32Array,
  rate: number,
  at: number,
  midi: number,
  lenS: number,
  level: number,
  odd: number,
): void {
  const f = hz(midi);
  const n = Math.round(lenS * rate);
  const from = Math.round(at * rate);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const env = Math.min(1, t / 0.004) * Math.exp(-t / (lenS * 0.45)) * Math.min(1, (lenS - t) / 0.02);
    const p = TAU * f * t;
    const v = Math.sin(p) + odd * (Math.sin(3 * p) / 3 + Math.sin(5 * p) / 6);
    add(out, from + i, v * env * level);
  }
}

/** Bumbo: seno que despenca de tom. `tom` = o surdo (mais agudo e mais longo). */
function drum(out: Float32Array, rate: number, at: number, level: number, tom: boolean): void {
  const n = Math.round((tom ? 0.35 : 0.22) * rate);
  const from = Math.round(at * rate);
  let p = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const f = (tom ? 95 : 52) + (tom ? 60 : 70) * Math.exp(-t / 0.03);
    p += (TAU * f) / rate;
    add(out, from + i, Math.sin(p) * Math.min(1, t / 0.002) * Math.exp(-t / (tom ? 0.13 : 0.09)) * level);
  }
}

/** Caixa clara: faixa de ruído (passa-baixa menos passa-baixa) com queda curta e um corpo de 190 Hz. */
function snare(out: Float32Array, rate: number, rng: Rng, at: number, level: number): void {
  const n = Math.round(0.16 * rate);
  const from = Math.round(at * rate);
  let a = 0;
  let b = 0;
  const kHi = 1 - Math.exp((-TAU * 5000) / rate);
  const kLo = 1 - Math.exp((-TAU * 900) / rate);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const w = rng.next() * 2 - 1;
    a += kHi * (w - a);
    b += kLo * (w - b);
    const body = Math.sin(TAU * 190 * t) * Math.exp(-t / 0.03) * 0.5;
    add(out, from + i, ((a - b) * 2.2 * Math.exp(-t / 0.05) + body) * Math.min(1, t / 0.001) * level);
  }
}

/** Bordão: duas notas sustentadas que respiram devagar (o loop inteiro, fechando em si mesmo). */
function drone(out: Float32Array, rate: number, notes: readonly number[], level: number): void {
  const n = out.length;
  const loopS = n / rate;
  for (const midi of notes) {
    // Frequência arredondada para fechar um número inteiro de ciclos no loop (sem degrau na emenda).
    const f = Math.round(hz(midi) * loopS) / loopS;
    for (let i = 0; i < n; i++) {
      const t = i / rate;
      const breathe = 0.75 + 0.25 * Math.sin((TAU * t * 2) / loopS);
      out[i] = out[i]! + (Math.sin(TAU * f * t) + 0.3 * Math.sin(TAU * 2 * f * t)) * breathe * level;
    }
  }
}

/** A melodia da caixinha: [colcheia no loop, nota]. */
const MELODY: readonly (readonly [number, number])[] = [
  [0, N.D5],
  [2, N.F5],
  [4, N.A5],
  [6, N.G5],
  [7, N.F5],
  [8, N.E5],
  [12, N.Cs5],
  [16, N.D5],
  [18, N.F5],
  [20, N.A5],
  [22, N.Bb5],
  [23, N.A5],
  [24, N.G5],
  [32, N.F5],
  [33, N.E5],
  [34, N.D5],
  [36, N.A4],
  [38, N.D5],
  [40, N.E5],
  [41, N.F5],
  [42, N.E5],
  [44, N.Cs5],
  [48, N.D5],
  [50, N.A4],
  [52, N.F4],
  [54, N.G4],
  [55, N.A4],
  [56, N.D4],
];

/** Fundamental do compasso (o baixo da calma no 1; o ostinato da horda gira em volta dela). */
const ROOTS = [N.D2, N.A1, N.D2, N.Bb1, N.D2, N.A1, N.G2, N.D2];

/** Normaliza o pico. */
function normalize(out: Float32Array, peak: number): Float32Array {
  let max = 0;
  for (let i = 0; i < out.length; i++) max = Math.max(max, Math.abs(out[i]!));
  if (max > 0) for (let i = 0; i < out.length; i++) out[i] = (out[i]! * peak) / max;
  return out;
}

/** A camada calma: bordão, caixinha de música e o "coração". */
export function renderCalm(rate: number = ZOMBIE_MUSIC.sampleRate): Float32Array {
  const out = new Float32Array(loopLength(rate));
  const e = eighthS();
  drone(out, rate, [N.D2, N.A2], 0.22);
  for (const [k, midi] of MELODY) musicBox(out, rate, k * e, midi, k % 8 === 0 ? 0.55 : 0.42);
  for (let bar = 0; bar < ZOMBIE_MUSIC.bars; bar++) {
    const at = bar * 8 * e;
    bass(out, rate, at, ROOTS[bar]!, 1.0, 0.5, 0);
    drum(out, rate, at, 0.55, false);
    drum(out, rate, at + 4 * e, 0.4, false);
  }
  return normalize(out, ZOMBIE_MUSIC.peak);
}

/** Desenho do ostinato em semitons a partir da fundamental (colcheias). */
const OSTINATO = [0, 0, 3, 0, 2, 0, -1, 0];

/** A camada da horda: marcha (caixa clara no 2 e 4, rufos, surdo no 1) e o ostinato do baixo. */
export function renderHorde(rate: number = ZOMBIE_MUSIC.sampleRate): Float32Array {
  const out = new Float32Array(loopLength(rate));
  const e = eighthS();
  const rng = createRng(0x2b0b1e);
  for (let bar = 0; bar < ZOMBIE_MUSIC.bars; bar++) {
    const at = bar * 8 * e;
    drum(out, rate, at, 0.7, true);
    snare(out, rate, rng, at + 2 * e, 0.6);
    snare(out, rate, rng, at + 6 * e, 0.6);
    // Notas fantasma em semicolcheias, mais fracas.
    for (let s = 0; s < 16; s++) if (s % 4 === 3) snare(out, rate, rng, at + (s * e) / 2, 0.14);
    // Rufo no fim dos compassos 4 e 8: semicolcheias crescendo.
    if (bar % 4 === 3) for (let s = 12; s < 16; s++) snare(out, rate, rng, at + (s * e) / 2, 0.25 + (s - 12) * 0.1);
    for (let k = 0; k < 8; k++) bass(out, rate, at + k * e, ROOTS[bar]! + 12 + OSTINATO[k]!, e * 0.95, 0.42, 0.8);
  }
  return normalize(out, ZOMBIE_MUSIC.peak);
}
