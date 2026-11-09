// M2 (fase 7a): os sons do jogo sintetizados em código (decisão #39; arte-ux.md §10.5). Os tiros das 6 armas de fogo
// (perto e longe, GDD §5.10), o foguete, a faca, o "PLOC" do headshot, os bipes da contagem, o coração da vida baixa,
// as vinhetas de fim e o deslize. Saem de contas sobre ruído com semente e seno, sem OscillatorNode nem filtro do
// Web Audio (regra 9): 0 KB de download, gerados no carregamento (`Mixer.synthesize`). Determinísticos: a mesma
// receita dá o mesmo PCM em toda plataforma (os testes travam um hash por som).
import { createRng, type Rng } from '@boboforces/shared';
import { SYNTH_SAMPLE_RATE } from './synth.ts';

const TAU = Math.PI * 2;

/** Coeficiente do passa-baixa de 1 polo para o corte `hz`. */
const lowpassCoef = (hz: number, rate: number): number => 1 - Math.exp((-TAU * Math.max(10, hz)) / rate);

/** Passa-baixa de 2 polos (12 dB/oitava) sobre ruído branco, com estado próprio. */
interface Lowpass2 {
  a: number;
  b: number;
}
const lp2 = (s: Lowpass2, x: number, k: number): number => {
  s.a += k * (x - s.a);
  s.b += k * (s.a - s.b);
  return s.b;
};

/** Normaliza o pico para `peak`, satura de leve (corpo) e faz fade de 8 ms no fim (sem estalo). */
function finish(out: Float32Array, peak: number, drive: number, rate: number): Float32Array {
  let max = 0;
  for (let i = 0; i < out.length; i++) max = Math.max(max, Math.abs(out[i]!));
  if (max > 0) {
    const k = 1 / max;
    const norm = drive > 0 ? Math.tanh(drive) : 1;
    for (let i = 0; i < out.length; i++) {
      const x = out[i]! * k;
      out[i] = drive > 0 ? Math.tanh(x * drive) / norm : x;
    }
  }
  const fade = Math.min(out.length, Math.round(0.008 * rate));
  for (let i = 0; i < fade; i++) out[out.length - 1 - i] = out[out.length - 1 - i]! * (i / fade);
  max = 0;
  for (let i = 0; i < out.length; i++) max = Math.max(max, Math.abs(out[i]!));
  if (max > 0) {
    const k = peak / max;
    for (let i = 0; i < out.length; i++) out[i] = out[i]! * k;
  }
  return out;
}

const noise = (rng: Rng): number => rng.next() * 2 - 1;

/** De quantas em quantas amostras o corte que varre é recalculado (o `exp` do coeficiente é caro sem JIT). */
const SWEEP_STEP = 16;

/**
 * Tiro de arma de fogo em 4 camadas: o **estalo** (ruído branco de 1–2 ms), o **corpo** (ruído num passa-baixa que
 * escurece), o **soco** (seno grave que cai de tom) e a **cauda** (ruído escuro e longo, o eco do lugar). `far` vira a
 * amostra de longe (GDD §5.10): sem estalo, ataque mais mole, tudo mais escuro e a cauda mais presente.
 */
export interface GunshotRecipe {
  readonly durationS: number;
  readonly seed: number;
  /** Nível do estalo (0..1). */
  readonly crack: number;
  /** Queda do corpo (s, constante de tempo). */
  readonly bodyS: number;
  readonly bodyBrightHz: number;
  readonly bodyDarkHz: number;
  /** Tom do soco: começa em `thumpHz` e cai para `thumpEndHz`. */
  readonly thumpHz: number;
  readonly thumpEndHz: number;
  readonly thumpS: number;
  readonly thump: number;
  readonly tailS: number;
  readonly tail: number;
  readonly tailHz: number;
  /** Escopeta: estalos extras espalhados nos primeiros ms (os chumbos saindo). */
  readonly pellets?: number;
  /** Saturação final (0 = nenhuma; 1,5 = encorpado). */
  readonly drive?: number;
}

export function synthGunshot(r: GunshotRecipe, far = false, sampleRate = SYNTH_SAMPLE_RATE): Float32Array {
  const rate = sampleRate;
  const dur = far ? r.durationS * 1.5 : r.durationS;
  const n = Math.max(1, Math.round(dur * rate));
  const out = new Float32Array(n);
  const rng = createRng(r.seed);
  const tailRng = createRng(r.seed ^ 0x5eed);
  const body: Lowpass2 = { a: 0, b: 0 };
  const tail: Lowpass2 = { a: 0, b: 0 };
  const farLp: Lowpass2 = { a: 0, b: 0 };
  const crack = far ? 0 : r.crack;
  const attack = far ? 0.004 : 0.0004;
  const bodyS = far ? r.bodyS * 1.8 : r.bodyS;
  const thump = far ? r.thump * 0.7 : r.thump;
  const tailLevel = far ? r.tail * 1.8 : r.tail;
  const tailS = far ? r.tailS * 1.6 : r.tailS;
  const tailK = lowpassCoef(far ? r.tailHz * 0.6 : r.tailHz, rate);
  const farK = lowpassCoef(900, rate);
  const pellets = r.pellets ?? 0;
  // Quedas exponenciais como multiplicação por amostra (no Switch o JS é interpretado: nada de `exp` no laço). O
  // corte do corpo é recalculado a cada `SWEEP_STEP` amostras.
  const decay = (s: number): number => Math.exp(-1 / (s * rate));
  const dCrack = decay(0.0015);
  const dPellet = decay(0.0012);
  const dSweep = decay(bodyS * 0.8);
  const dBody = decay(bodyS);
  const dPitch = decay(0.03);
  const dThump = decay(r.thumpS);
  const dTail = decay(tailS);
  const pelletLen = Math.round(0.012 * rate);
  let eCrack = crack;
  let eSweep = 1;
  let eBody = 1;
  let ePitch = 1;
  let eThump = thump;
  let eTail = tailLevel * 3;
  let bodyK = 0;
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const w = noise(rng);
    let x = 0;
    // Estalo: um ou mais (escopeta) cliques de ruído branco muito curtos.
    if (crack > 0 && i < pelletLen * (pellets + 1)) {
      x += w * eCrack;
      for (let p = 1; p <= pellets; p++) {
        const k = i - Math.round(p * 0.0021 * rate);
        if (k >= 0 && k < pelletLen) x += w * crack * 0.6 * dPellet ** k;
      }
    }
    eCrack *= dCrack;
    // Corpo: passa-baixa que fecha do brilhante para o escuro.
    if (i % SWEEP_STEP === 0) {
      const cutoff = r.bodyDarkHz + (r.bodyBrightHz - r.bodyDarkHz) * eSweep;
      bodyK = lowpassCoef(far ? cutoff * 0.45 : cutoff, rate);
    }
    eSweep *= dSweep;
    x += lp2(body, w, bodyK) * (t < attack ? t / attack : 1) * eBody * 2.2;
    eBody *= dBody;
    // Soco: seno que cai de tom.
    phase += (TAU * (r.thumpEndHz + (r.thumpHz - r.thumpEndHz) * ePitch)) / rate;
    ePitch *= dPitch;
    x += Math.sin(phase) * (t < 0.002 ? t / 0.002 : 1) * eThump;
    eThump *= dThump;
    // Cauda: ruído escuro que cresce em 12 ms e cai devagar.
    x += lp2(tail, noise(tailRng), tailK) * (t < 0.012 ? t / 0.012 : 1) * eTail;
    eTail *= dTail;
    out[i] = far ? lp2(farLp, x, farK) : x;
  }
  return finish(out, far ? 0.8 : 0.95, r.drive ?? 2, rate);
}

/** As receitas dos tiros por arma (códigos de `WEAPON_CODE` da sim: pistola, SMG, fuzil, escopeta, sniper). */
export const GUNSHOTS = {
  pistola: {
    durationS: 0.38,
    seed: 0x0b01,
    crack: 0.7,
    bodyS: 0.022,
    bodyBrightHz: 7000,
    bodyDarkHz: 1300,
    thumpHz: 170,
    thumpEndHz: 75,
    thumpS: 0.045,
    thump: 0.5,
    tailS: 0.11,
    tail: 0.16,
    tailHz: 1600,
  },
  smg: {
    durationS: 0.28,
    seed: 0x0b02,
    crack: 0.6,
    bodyS: 0.016,
    bodyBrightHz: 8000,
    bodyDarkHz: 1600,
    thumpHz: 190,
    thumpEndHz: 95,
    thumpS: 0.032,
    thump: 0.38,
    tailS: 0.08,
    tail: 0.13,
    tailHz: 1800,
  },
  fuzil: {
    durationS: 0.48,
    seed: 0x0b03,
    crack: 0.85,
    bodyS: 0.028,
    bodyBrightHz: 9000,
    bodyDarkHz: 1000,
    thumpHz: 140,
    thumpEndHz: 60,
    thumpS: 0.065,
    thump: 0.6,
    tailS: 0.15,
    tail: 0.2,
    tailHz: 1400,
  },
  escopeta: {
    durationS: 0.62,
    seed: 0x0b04,
    crack: 0.7,
    bodyS: 0.042,
    bodyBrightHz: 6000,
    bodyDarkHz: 700,
    thumpHz: 115,
    thumpEndHz: 45,
    thumpS: 0.095,
    thump: 0.85,
    tailS: 0.2,
    tail: 0.26,
    tailHz: 1000,
    pellets: 4,
    drive: 2.4,
  },
  sniper: {
    durationS: 0.95,
    seed: 0x0b05,
    crack: 1,
    bodyS: 0.036,
    bodyBrightHz: 10000,
    bodyDarkHz: 900,
    thumpHz: 105,
    thumpEndHz: 40,
    thumpS: 0.11,
    thump: 0.8,
    tailS: 0.32,
    tail: 0.28,
    tailHz: 1200,
    drive: 2.4,
  },
} as const satisfies Readonly<Record<string, GunshotRecipe>>;

export type GunshotName = keyof typeof GUNSHOTS;

/** Foguete saindo: soco grave e um sopro de ruído cujo corte sobe e desce. */
export function synthRocket(sampleRate = SYNTH_SAMPLE_RATE): Float32Array {
  const rate = sampleRate;
  const n = Math.round(0.75 * rate);
  const out = new Float32Array(n);
  const rng = createRng(0x0b06);
  const lo: Lowpass2 = { a: 0, b: 0 };
  const hi: Lowpass2 = { a: 0, b: 0 };
  let phase = 0;
  let kHi = 0;
  let kLo = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const w = noise(rng);
    if (i % SWEEP_STEP === 0) {
      const cut = 500 + 2600 * (t < 0.12 ? t / 0.12 : Math.exp(-(t - 0.12) / 0.18));
      kHi = lowpassCoef(cut, rate);
      kLo = lowpassCoef(cut * 0.25, rate);
    }
    // Faixa: o passa-baixa no corte menos um passa-baixa bem abaixo (tira o ronco do ruído).
    const band = lp2(hi, w, kHi) - lp2(lo, w, kLo);
    const whoosh = band * (t < 0.02 ? t / 0.02 : 1) * Math.exp(-t / 0.28) * 2.5;
    phase += (TAU * (50 + 50 * Math.exp(-t / 0.04))) / rate;
    const thump = Math.sin(phase) * Math.exp(-t / 0.09) * 0.9;
    out[i] = whoosh + thump;
  }
  return finish(out, 0.9, 1.2, rate);
}

/** Faca cortando o ar: faixa de ruído em sino, com o corte subindo e voltando. */
export function synthSwing(sampleRate = SYNTH_SAMPLE_RATE): Float32Array {
  const rate = sampleRate;
  const len = 0.2;
  const n = Math.round(len * rate);
  const out = new Float32Array(n);
  const rng = createRng(0x0b07);
  const lo: Lowpass2 = { a: 0, b: 0 };
  const hi: Lowpass2 = { a: 0, b: 0 };
  let kHi = 0;
  let kLo = 0;
  for (let i = 0; i < n; i++) {
    const u = i / rate / len;
    const bell = Math.sin(Math.PI * u) ** 2;
    if (i % SWEEP_STEP === 0) {
      const cut = 900 + 3400 * Math.sin(Math.PI * Math.min(1, u * 1.2));
      kHi = lowpassCoef(cut, rate);
      kLo = lowpassCoef(cut * 0.35, rate);
    }
    const w = noise(rng);
    out[i] = (lp2(hi, w, kHi) - lp2(lo, w, kLo)) * bell;
  }
  return finish(out, 0.7, 0, rate);
}

/** "PLOC" do headshot (arte-ux §10.5): rolha estourando, um seno que despenca de tom com um clique na frente. */
export function synthPop(sampleRate = SYNTH_SAMPLE_RATE): Float32Array {
  const rate = sampleRate;
  const n = Math.round(0.13 * rate);
  const out = new Float32Array(n);
  const rng = createRng(0x0b08);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const f = 260 + 900 * Math.exp(-t / 0.018);
    phase += (TAU * f) / rate;
    const env = (t < 0.001 ? t / 0.001 : 1) * Math.exp(-t / 0.035);
    out[i] = Math.sin(phase) * env + noise(rng) * 0.5 * Math.exp(-t / 0.0015);
  }
  return finish(out, 0.9, 1.4, rate);
}

/** Tom de brinquedo (seno + 3ª e 5ª harmônicas): bipe da contagem e notas das vinhetas. */
function toyNote(out: Float32Array, startS: number, hz: number, lenS: number, level: number, rate: number): void {
  const from = Math.round(startS * rate);
  const n = Math.min(out.length - from, Math.round(lenS * rate));
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const p = TAU * hz * t;
    const env = (t < 0.004 ? t / 0.004 : 1) * Math.exp(-t / (lenS * 0.45));
    const v = Math.sin(p) + Math.sin(3 * p) * 0.22 + Math.sin(5 * p) * 0.08;
    out[from + i] = out[from + i]! + v * env * level;
  }
}

/** Bipe da contagem (3, 2, 1) e o do "vai". */
export function synthCountBeep(go: boolean, sampleRate = SYNTH_SAMPLE_RATE): Float32Array {
  const len = go ? 0.32 : 0.14;
  const out = new Float32Array(Math.round(len * sampleRate));
  toyNote(out, 0, go ? 1046.5 : 659.25, len, 1, sampleRate);
  return finish(out, 0.6, 0, sampleRate);
}

/** Vinheta curta de fim de partida: arpejo que sobe (vitória) ou desce devagar (derrota). Marcha de brinquedo. */
export function synthJingle(win: boolean, sampleRate = SYNTH_SAMPLE_RATE): Float32Array {
  const notes = win ? [523.25, 659.25, 783.99, 1046.5] : [783.99, 659.25, 523.25, 392];
  const step = win ? 0.11 : 0.17;
  const last = win ? 0.45 : 0.6;
  const out = new Float32Array(Math.round((step * (notes.length - 1) + last) * sampleRate));
  notes.forEach((hz, i) => toyNote(out, i * step, hz, i === notes.length - 1 ? last : step * 1.6, 1, sampleRate));
  return finish(out, 0.6, 0, sampleRate);
}

/** Coração da vida baixa: duas batidas graves (tum-tum). */
export function synthHeartbeat(sampleRate = SYNTH_SAMPLE_RATE): Float32Array {
  const rate = sampleRate;
  const out = new Float32Array(Math.round(0.42 * rate));
  for (const [at, level] of [
    [0, 1],
    [0.17, 0.7],
  ] as const) {
    const from = Math.round(at * rate);
    let phase = 0;
    for (let i = 0; from + i < out.length; i++) {
      const t = i / rate;
      phase += (TAU * (48 + 40 * Math.exp(-t / 0.02))) / rate;
      out[from + i] = out[from + i]! + Math.sin(phase) * level * (t < 0.003 ? t / 0.003 : 1) * Math.exp(-t / 0.045);
    }
  }
  return finish(out, 0.85, 1.3, rate);
}

/** Deslize: ruído escuro e áspero que entra rápido e some em ~0,4 s. */
export function synthSlide(sampleRate = SYNTH_SAMPLE_RATE): Float32Array {
  const rate = sampleRate;
  const len = 0.42;
  const n = Math.round(len * rate);
  const out = new Float32Array(n);
  const rng = createRng(0x0b09);
  const grit = createRng(0x0b0a);
  const lo: Lowpass2 = { a: 0, b: 0 };
  let rough = 1;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    if (i % 220 === 0) rough = 0.6 + grit.next() * 0.8;
    const env = (t < 0.03 ? t / 0.03 : 1) * Math.max(0, 1 - (t - 0.03) / (len - 0.03)) ** 1.5;
    out[i] = lp2(lo, noise(rng), lowpassCoef(1300, rate)) * env * rough;
  }
  return finish(out, 0.7, 0, rate);
}

/**
 * Os sons sintetizados do jogo: nome lógico → PCM mono a `SYNTH_SAMPLE_RATE`. `tiro-<arma>` e `tiro-<arma>-longe`
 * para cada arma de fogo; o resto pelo nome. O banco de sons do `game` diz canal, volume e prioridade de cada um.
 */
export const GAME_SYNTH_SOUNDS: Readonly<Record<string, () => Float32Array>> = {
  ...Object.fromEntries(
    (Object.keys(GUNSHOTS) as GunshotName[]).flatMap((w) => [
      [`tiro-${w}`, () => synthGunshot(GUNSHOTS[w])],
      [`tiro-${w}-longe`, () => synthGunshot(GUNSHOTS[w], true)],
    ]),
  ),
  foguete: () => synthRocket(),
  'faca-golpe': () => synthSwing(),
  ploc: () => synthPop(),
  'contagem-bipe': () => synthCountBeep(false),
  'contagem-vai': () => synthCountBeep(true),
  vitoria: () => synthJingle(true),
  derrota: () => synthJingle(false),
  coracao: () => synthHeartbeat(),
  deslize: () => synthSlide(),
};
