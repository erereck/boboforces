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
  // M10 (fase 6): o DMR (o estalo seco do fuzil com o corpo e a cauda mais longos, entre o fuzil e a sniper) e o
  // revólver (a pistola bem mais grave e encorpada: o soco forte, "Hand Cannon"). A escopeta automática usa o tiro da
  // pump um pouco mais agudo (no `game`).
  dmr: {
    durationS: 0.66,
    seed: 0x0d01,
    crack: 0.95,
    bodyS: 0.032,
    bodyBrightHz: 9500,
    bodyDarkHz: 950,
    thumpHz: 125,
    thumpEndHz: 50,
    thumpS: 0.085,
    thump: 0.7,
    tailS: 0.22,
    tail: 0.24,
    tailHz: 1300,
    drive: 2.2,
  },
  revolver: {
    durationS: 0.56,
    seed: 0x0d02,
    crack: 0.9,
    bodyS: 0.03,
    bodyBrightHz: 7500,
    bodyDarkHz: 900,
    thumpHz: 120,
    thumpEndHz: 46,
    thumpS: 0.085,
    thump: 0.9,
    tailS: 0.18,
    tail: 0.24,
    tailHz: 1200,
    drive: 2.6,
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

/**
 * M10 (fase 8): o ricochete ("piiiu" de faroeste): um estalo curto na parede e o assobio da bala que sai torta, um
 * seno que despenca de ~4,1 kHz para ~1,5 kHz com um parcial inarmônico (1,51×, o metálico) e um tremor rápido (a bala
 * girando). Curto (0,3 s): com o Ricochete, cada tiro que bate na parede quica.
 */
export function synthRicochet(sampleRate = SYNTH_SAMPLE_RATE): Float32Array {
  const rate = sampleRate;
  const n = Math.round(0.3 * rate);
  const out = new Float32Array(n);
  const rng = createRng(0x41c0);
  let phase = 0;
  let partial = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const f = 1500 + 2600 * Math.exp(-t / 0.09);
    phase += (TAU * f) / rate;
    partial += (TAU * f * 1.51) / rate;
    const env = (t < 0.002 ? t / 0.002 : 1) * Math.exp(-t / 0.085);
    const wobble = 1 + 0.18 * Math.sin(TAU * 34 * t);
    out[i] = (Math.sin(phase) + 0.3 * Math.sin(partial)) * env * wobble + noise(rng) * 0.7 * Math.exp(-t / 0.0025);
  }
  return finish(out, 0.8, 0.6, rate);
}

/**
 * M12 (fase 4): tabelas de um período (2048 pontos e o de volta) para as notas, lidas com interpolação: um seno com
 * harmônicos custa uma leitura, sem `Math.sin`/`Math.exp` por amostra. A leitura fica escrita dentro de cada laço (sem
 * chamar função por amostra: no V8 sem JIT, e no Switch, que interpreta o JS, a chamada é o que pesa).
 */
const TABLE = 2048;
function waveTable(harmonics: readonly number[]): Float32Array {
  const t = new Float32Array(TABLE + 1);
  for (let i = 0; i <= TABLE; i++) {
    let v = 0;
    for (let k = 0; k < harmonics.length; k++) v += harmonics[k]! * Math.sin((TAU * (k + 1) * i) / TABLE);
    t[i] = v;
  }
  return t;
}
let sineTable: Float32Array | null = null;
let toyTable: Float32Array | null = null;
let hornTable: Float32Array | null = null;
/** Seno puro; o brinquedo (seno + 3ª e 5ª); a corneta (as 4 primeiras). */
const sineT = (): Float32Array => (sineTable ??= waveTable([1]));
const toyT = (): Float32Array => (toyTable ??= waveTable([1, 0, 0.22, 0, 0.08]));
const hornT = (): Float32Array => (hornTable ??= waveTable([1, 0.5, 0.3, 0.12]));

/** Tom de brinquedo (seno + 3ª e 5ª harmônicas): bipe da contagem e notas das vinhetas. */
function toyNote(out: Float32Array, startS: number, hz: number, lenS: number, level: number, rate: number): void {
  const from = Math.round(startS * rate);
  const n = Math.min(out.length - from, Math.round(lenS * rate));
  const table = toyT();
  const step = (hz * TABLE) / rate;
  const attack = Math.round(0.004 * rate);
  const d = Math.exp(-1 / (lenS * 0.45 * rate));
  let e = level;
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const k = ph | 0;
    const a = table[k]!;
    const v = a + (table[k + 1]! - a) * (ph - k);
    out[from + i] = out[from + i]! + v * e * (i < attack ? i / attack : 1);
    ph += step;
    if (ph >= TABLE) ph -= TABLE;
    e *= d;
  }
}

/** Bipe da contagem (3, 2, 1) e o do "vai". */
export function synthCountBeep(go: boolean, sampleRate = SYNTH_SAMPLE_RATE): Float32Array {
  const len = go ? 0.32 : 0.14;
  const out = new Float32Array(Math.round(len * sampleRate));
  toyNote(out, 0, go ? 1046.5 : 659.25, len, 1, sampleRate);
  return finish(out, 0.6, 0, sampleRate);
}

/**
 * Vinheta de fim de partida (M12, fase 4: de 3 s, GDD §5.10 e arte-ux §10.6). Vitória: o rufar da caixa que cresce e
 * a fanfarra de corneta (sol-dó-mi-SOL, com o prato e o baixo na nota longa). Derrota: o "uá-uá-uá-uááá" da corneta
 * que desce, a última escorregando e tremendo. Marcha de brinquedo.
 */
export function synthJingle(win: boolean, sampleRate = SYNTH_SAMPLE_RATE): Float32Array {
  const rate = sampleRate;
  if (!win) {
    const out = new Float32Array(Math.round(3 * rate));
    [392, 370, 349.2].forEach((hz, i) => hornNote(out, i * 0.48, hz, 0.42, 0.03, 0, rate));
    hornNote(out, 1.44, 329.6, 1.5, 0.12, 0.05, rate);
    return finish(out, 0.7, 0.8, rate);
  }
  const out = new Float32Array(Math.round(3 * rate));
  // Rufar: um toque de caixa a cada 1/24 s, crescendo (ruído sem o grave, com um corpo curto de 190 Hz).
  const rng = createRng(0x0e01);
  const lp: Lowpass2 = { a: 0, b: 0 };
  const k = lowpassCoef(1500, rate);
  const dSnare = Math.exp(-1 / (0.025 * rate));
  const strokes = 22;
  for (let s = 0; s < strokes; s++) {
    const from = Math.round(((s * 0.9) / strokes) * rate);
    const level = 0.25 + (0.65 * s) / (strokes - 1);
    let e = level;
    let p = 0;
    for (let i = 0; i < Math.round(0.04 * rate) && from + i < out.length; i++) {
      const w = noise(rng);
      p += (TAU * 190) / rate;
      out[from + i] = out[from + i]! + ((w - lp2(lp, w, k)) * 1.2 + Math.sin(p) * 0.4) * e;
      e *= dSnare;
    }
  }
  // Fanfarra.
  hornNote(out, 0.95, 392, 0.13, 0, 0, rate);
  hornNote(out, 1.1, 523.25, 0.13, 0, 0, rate);
  hornNote(out, 1.25, 659.25, 0.13, 0, 0, rate);
  hornNote(out, 1.4, 783.99, 1.55, 0, 0.02, rate);
  hornNote(out, 1.4, 130.81, 1.55, 0, 0, rate);
  // Prato na nota longa (1,1 s: depois disso ele já sumiu debaixo da corneta).
  const crash = Math.round(1.4 * rate);
  const dCrash = Math.exp(-1 / (0.35 * rate));
  const hp: Lowpass2 = { a: 0, b: 0 };
  const kc = lowpassCoef(4000, rate);
  let ec = 0.7;
  for (let i = crash; i < Math.min(out.length, crash + Math.round(1.1 * rate)); i++) {
    const w = noise(rng);
    out[i] = out[i]! + (w - lp2(hp, w, kc)) * ec;
    ec *= dCrash;
  }
  return finish(out, 0.7, 0.8, rate);
}

/** M12 (fase 4): o empate: duas notas neutras e iguais ("pom… pom"), sem subir nem descer. */
export function synthTie(sampleRate = SYNTH_SAMPLE_RATE): Float32Array {
  const out = new Float32Array(Math.round(1.3 * sampleRate));
  toyNote(out, 0, 440, 0.5, 0.9, sampleRate);
  toyNote(out, 0, 220, 0.5, 0.4, sampleRate);
  toyNote(out, 0.55, 440, 0.7, 0.9, sampleRate);
  toyNote(out, 0.55, 220, 0.7, 0.4, sampleRate);
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

// --- M3 (fase 6d): o Bobo Zombies ---

/**
 * Voz de bobo-zumbi: uma tabela de onda de um período feita por soma de harmônicos com formantes de "uuuh" (F1 ~450 Hz,
 * F2 ~900 Hz e um brilho em 2,5 kHz), tocada com o tom que escorrega, um tremor lento e o "ronco" (modulação rápida
 * da amplitude, a voz rouca). Barato no Switch: a tabela tem 1024 pontos e o laço é só leitura com interpolação.
 */
export interface GroanRecipe {
  readonly seed: number;
  readonly lenS: number;
  /** Tom de partida (Hz) e quanto ele cai até o fim (fração: 0,3 = 30% mais grave). */
  readonly f0: number;
  readonly fall: number;
  /** Ronco: frequência (Hz) e profundidade (0..1) da modulação da amplitude. */
  readonly growlHz: number;
  readonly growl: number;
  /** Sopro (ruído escuro) por cima da voz. */
  readonly breath: number;
}

const GROAN_TABLE = 1024;

/** Um período com os formantes de "u" para o tom `f0` (amplitude de cada harmônico pela distância aos formantes). */
function formantTable(f0: number): Float32Array {
  const table = new Float32Array(GROAN_TABLE);
  const formants = [
    [450, 160, 1],
    [900, 220, 0.55],
    [2500, 400, 0.12],
  ] as const;
  for (let k = 1; k * f0 < 4000; k++) {
    const f = k * f0;
    let amp = 0;
    for (const [fc, bw, g] of formants) amp += g * Math.exp(-(((f - fc) / bw) ** 2));
    amp = (amp + 0.04) / Math.sqrt(k);
    for (let i = 0; i < GROAN_TABLE; i++) table[i] = table[i]! + amp * Math.sin((TAU * k * i) / GROAN_TABLE);
  }
  return table;
}

export function synthGroan(r: GroanRecipe, sampleRate = SYNTH_SAMPLE_RATE): Float32Array {
  const rate = sampleRate;
  const n = Math.round(r.lenS * rate);
  const out = new Float32Array(n);
  const table = formantTable(r.f0);
  const rng = createRng(r.seed);
  const breathLp: Lowpass2 = { a: 0, b: 0 };
  const breathK = lowpassCoef(700, rate);
  const wobbleHz = 4 + (r.seed % 3);
  // M12 (fase 4): os senos do contorno, do tremor e do ronco pela tabela (nada de `Math.sin` por amostra).
  const sine = sineT();
  const wobbleStep = (wobbleHz * TABLE) / rate;
  const growlStep = (r.growlHz * TABLE) / rate;
  let wob = 0;
  let gr = 0;
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const u = t / r.lenS;
    // Tom: sobe um pouco no começo ("uu-") e cai até o fim ("-uuurgh"), com tremor.
    const cp = Math.min(1, u * 2.5) * (TABLE / 2);
    const ck = cp | 0;
    const ca = sine[ck]!;
    const wk = wob | 0;
    const wa = sine[wk]!;
    const contour = 1 + 0.08 * (ca + (sine[ck + 1]! - ca) * (cp - ck)) - r.fall * u * u;
    const f = r.f0 * contour * (1 + 0.025 * (wa + (sine[wk + 1]! - wa) * (wob - wk)));
    wob += wobbleStep;
    if (wob >= TABLE) wob -= TABLE;
    phase += (f * GROAN_TABLE) / rate;
    if (phase >= GROAN_TABLE) phase -= GROAN_TABLE;
    const i0 = phase | 0;
    const fr = phase - i0;
    const a = table[i0]!;
    const b = table[(i0 + 1) % GROAN_TABLE]!;
    const voice = a + (b - a) * fr;
    const gk = gr | 0;
    const ga = sine[gk]!;
    const growl = 1 - r.growl * (0.5 + 0.5 * (ga + (sine[gk + 1]! - ga) * (gr - gk)));
    gr += growlStep;
    if (gr >= TABLE) gr -= TABLE;
    const env = Math.min(1, t / 0.09) * Math.min(1, (r.lenS - t) / 0.18);
    out[i] = (voice * growl + lp2(breathLp, noise(rng), breathK) * r.breath * 6) * env;
  }
  return finish(out, 0.8, 1.2, rate);
}

/** As vozes dos zumbis (3, para não repetir) e o rugido do Mega Bobo. */
export const GROANS = {
  'zumbi-gemido-1': { seed: 0x0c01, lenS: 1.1, f0: 118, fall: 0.3, growlHz: 31, growl: 0.35, breath: 0.12 },
  'zumbi-gemido-2': { seed: 0x0c02, lenS: 0.8, f0: 140, fall: 0.18, growlHz: 27, growl: 0.45, breath: 0.1 },
  'zumbi-gemido-3': { seed: 0x0c03, lenS: 1.35, f0: 100, fall: 0.4, growlHz: 36, growl: 0.3, breath: 0.15 },
  'chefao-rugido': { seed: 0x0c04, lenS: 1.55, f0: 58, fall: 0.35, growlHz: 23, growl: 0.6, breath: 0.45 },
} as const satisfies Readonly<Record<string, GroanRecipe>>;

/** Cuspe do Spitter ("ptuí"): estalo molhado (ruído que escurece) e um "pop" que despenca de tom. */
export function synthSpit(sampleRate = SYNTH_SAMPLE_RATE): Float32Array {
  const rate = sampleRate;
  const n = Math.round(0.3 * rate);
  const out = new Float32Array(n);
  const rng = createRng(0x0c05);
  const wet: Lowpass2 = { a: 0, b: 0 };
  let k = 0;
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    if (i % SWEEP_STEP === 0) k = lowpassCoef(500 + 3500 * Math.exp(-t / 0.05), rate);
    const burst = lp2(wet, noise(rng), k) * Math.exp(-t / 0.07) * 2;
    phase += (TAU * (160 + 650 * Math.exp(-t / 0.025))) / rate;
    const pop = Math.sin(phase) * Math.min(1, t / 0.002) * Math.exp(-t / 0.06) * 0.8;
    out[i] = burst + pop;
  }
  return finish(out, 0.75, 1.3, rate);
}

/** Sino de brinquedo: o tom e o parcial inarmônico (2,76×) de um sininho, com queda rápida. */
function bell(out: Float32Array, startS: number, hz: number, lenS: number, level: number, rate: number): void {
  const from = Math.round(startS * rate);
  const n = Math.min(out.length - from, Math.round(lenS * rate));
  const table = sineT();
  const step = (hz * TABLE) / rate;
  const step2 = step * 2.76;
  const attack = Math.round(0.002 * rate);
  const d = Math.exp(-1 / (lenS * 0.35 * rate));
  const d2 = Math.exp(-1 / (0.05 * rate));
  let e = level;
  let e2 = 0.35;
  let ph = 0;
  let ph2 = 0;
  for (let i = 0; i < n; i++) {
    const k = ph | 0;
    const a = table[k]!;
    const k2 = ph2 | 0;
    const b = table[k2]!;
    const v = a + (table[k + 1]! - a) * (ph - k) + (b + (table[k2 + 1]! - b) * (ph2 - k2)) * e2;
    out[from + i] = out[from + i]! + v * e * (i < attack ? i / attack : 1);
    ph += step;
    if (ph >= TABLE) ph -= TABLE;
    ph2 += step2;
    while (ph2 >= TABLE) ph2 -= TABLE;
    e *= d;
    e2 *= d2;
  }
}

/** Compra ("tchan-tchin" da caixa registradora): um chiado curto e dois sininhos subindo. */
export function synthPurchase(sampleRate = SYNTH_SAMPLE_RATE): Float32Array {
  const rate = sampleRate;
  const out = new Float32Array(Math.round(0.5 * rate));
  const rng = createRng(0x0c06);
  const hi: Lowpass2 = { a: 0, b: 0 };
  const k = lowpassCoef(2500, rate);
  for (let i = 0; i < Math.round(0.05 * rate); i++) {
    const w = noise(rng);
    out[i] = (w - lp2(hi, w, k)) * Math.exp(-i / rate / 0.015) * 0.6;
  }
  bell(out, 0.03, 1567.98, 0.25, 0.8, rate);
  bell(out, 0.11, 2093, 0.38, 1, rate);
  return finish(out, 0.7, 0, rate);
}

/** Notas (Hz) da caixa de música da Caixa Misteriosa: um motivo de 8 que se repete. */
const MUSIC_BOX_NOTES = [1318.5, 1568, 2093, 1568, 1760, 1396.9, 1174.7, 1568];

/**
 * A Caixa Misteriosa girando (`ZOMBIE_BOX.rollS` = 4 s): caixa de música que começa a 9 notas por segundo e vai
 * freando no último segundo, como uma roleta parando.
 */
export function synthMusicBox(lenS = 4, sampleRate = SYNTH_SAMPLE_RATE): Float32Array {
  const rate = sampleRate;
  const out = new Float32Array(Math.round(lenS * rate));
  let t = 0;
  let k = 0;
  while (t < lenS - 0.25) {
    const slow = t > lenS - 1.3 ? 1 + ((t - (lenS - 1.3)) / 1.3) * 2.2 : 1;
    toyNote(out, t, MUSIC_BOX_NOTES[k % MUSIC_BOX_NOTES.length]!, 0.35, k % 4 === 0 ? 1 : 0.7, rate);
    t += 0.11 * slow;
    k++;
  }
  return finish(out, 0.6, 0, rate);
}

/** Nota de "corneta de brinquedo" com o tom que pode escorregar (`bend`, fração) e tremer no fim. */
function hornNote(
  out: Float32Array,
  startS: number,
  hz: number,
  lenS: number,
  bend: number,
  vibrato: number,
  rate: number,
): void {
  const from = Math.round(startS * rate);
  const n = Math.min(out.length - from, Math.round(lenS * rate));
  const table = hornT();
  const sine = sineT();
  const step = (hz * TABLE) / rate;
  const vibStep = (6 * TABLE) / rate;
  const attack = 0.02 * rate;
  const release = 0.06 * rate;
  let ph = 0;
  let vib = 0;
  for (let i = 0; i < n; i++) {
    const u = i / n;
    let f = step * (1 - bend * u);
    if (vibrato > 0) {
      const k = vib | 0;
      const a = sine[k]!;
      f *= 1 + vibrato * u * (a + (sine[k + 1]! - a) * (vib - k));
      vib += vibStep;
      if (vib >= TABLE) vib -= TABLE;
    }
    ph += f;
    while (ph >= TABLE) ph -= TABLE;
    const env = (i < attack ? i / attack : 1) * (n - i < release ? (n - i) / release : 1);
    const k = ph | 0;
    const a = table[k]!;
    out[from + i] = out[from + i]! + (a + (table[k + 1]! - a) * (ph - k)) * env;
  }
}

/** O ursinho da caixa (ela vai embora): "uá-uá-uá-uááá" de corneta que desce. */
export function synthTeddy(sampleRate = SYNTH_SAMPLE_RATE): Float32Array {
  const rate = sampleRate;
  const out = new Float32Array(Math.round(1.5 * rate));
  const notes = [392, 370, 349.2];
  notes.forEach((hz, i) => hornNote(out, i * 0.28, hz, 0.26, 0.02, 0, rate));
  hornNote(out, 0.84, 329.6, 0.62, 0.12, 0.05, rate);
  return finish(out, 0.7, 0.8, rate);
}

/** Vantagem bebida: três goles graves ("glub") e um arpejo de brinquedo subindo. */
export function synthPerk(sampleRate = SYNTH_SAMPLE_RATE): Float32Array {
  const rate = sampleRate;
  const out = new Float32Array(Math.round(1.1 * rate));
  for (let g = 0; g < 3; g++) {
    const from = Math.round(g * 0.14 * rate);
    let p = 0;
    for (let i = 0; i < Math.round(0.11 * rate); i++) {
      const t = i / rate;
      p += (TAU * (210 - 120 * (t / 0.11))) / rate;
      out[from + i] = out[from + i]! + Math.sin(p) * Math.sin((Math.PI * t) / 0.11) * 0.9;
    }
  }
  [1046.5, 1318.5, 1568].forEach((hz, i) => toyNote(out, 0.48 + i * 0.09, hz, 0.4, 0.8, rate));
  return finish(out, 0.7, 0.6, rate);
}

/** Drop pego: fanfarra curta e rápida, com dois brilhos agudos no fim. */
export function synthDropTake(sampleRate = SYNTH_SAMPLE_RATE): Float32Array {
  const rate = sampleRate;
  const out = new Float32Array(Math.round(0.75 * rate));
  [784, 1046.5, 1318.5, 1568].forEach((hz, i) => toyNote(out, i * 0.06, hz, 0.3, 0.9, rate));
  bell(out, 0.26, 2637, 0.4, 0.5, rate);
  bell(out, 0.32, 3136, 0.35, 0.4, rate);
  return finish(out, 0.65, 0, rate);
}

/** Onda limpa: três notas graves de corneta, "tã-tã-TÃÃ" (a próxima onda vem aí). */
export function synthWaveClear(sampleRate = SYNTH_SAMPLE_RATE): Float32Array {
  const rate = sampleRate;
  const out = new Float32Array(Math.round(1.3 * rate));
  hornNote(out, 0, 293.7, 0.18, 0, 0, rate);
  hornNote(out, 0.2, 349.2, 0.18, 0, 0, rate);
  hornNote(out, 0.4, 440, 0.85, 0, 0.03, rate);
  return finish(out, 0.65, 0.9, rate);
}

/**
 * M10 (fase 7): a besta disparando ("twang"): a corda solta, um tom grave que despenca (310 → 150 Hz) com a 2ª
 * harmônica curta por cima, e o clique do gatilho. Quedas por multiplicação (sem `exp` no laço: o Switch interpreta).
 */
export function synthTwang(sampleRate = SYNTH_SAMPLE_RATE): Float32Array {
  const rate = sampleRate;
  const n = Math.round(0.42 * rate);
  const out = new Float32Array(n);
  const rng = createRng(0x0d03);
  const dBend = Math.exp(-1 / (0.02 * rate));
  const dString = Math.exp(-1 / (0.1 * rate));
  const dHarm = Math.exp(-1 / (0.035 * rate));
  const dClick = Math.exp(-1 / (0.002 * rate));
  let bend = 1;
  let eString = 1;
  let eHarm = 0.4;
  let eClick = 0.7;
  let p1 = 0;
  let p2 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const f = 150 + 160 * bend;
    p1 += (TAU * f) / rate;
    p2 += (TAU * f * 2.01) / rate;
    const attack = t < 0.0015 ? t / 0.0015 : 1;
    out[i] = (Math.sin(p1) * eString + Math.sin(p2) * eHarm) * attack + noise(rng) * eClick;
    bend *= dBend;
    eString *= dString;
    eHarm *= dHarm;
    eClick *= dClick;
  }
  return finish(out, 0.85, 1.6, rate);
}

/**
 * M10 (fase 7): o lança-granadas ("bloop"): o soco oco do tubo, um seno que cai de 190 para 55 Hz, com um sopro curto
 * de ruído escuro (a granada saindo).
 */
export function synthBloop(sampleRate = SYNTH_SAMPLE_RATE): Float32Array {
  const rate = sampleRate;
  const n = Math.round(0.45 * rate);
  const out = new Float32Array(n);
  const rng = createRng(0x0d04);
  const puff: Lowpass2 = { a: 0, b: 0 };
  const puffK = lowpassCoef(700, rate);
  const dPitch = Math.exp(-1 / (0.045 * rate));
  const dBody = Math.exp(-1 / (0.12 * rate));
  const dPuff = Math.exp(-1 / (0.05 * rate));
  let ePitch = 1;
  let eBody = 1;
  let ePuff = 1.6;
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    phase += (TAU * (55 + 135 * ePitch)) / rate;
    const attack = t < 0.004 ? t / 0.004 : 1;
    out[i] = Math.sin(phase) * eBody * attack + lp2(puff, noise(rng), puffK) * ePuff;
    ePitch *= dPitch;
    eBody *= dBody;
    ePuff *= dPuff;
  }
  return finish(out, 0.9, 1.8, rate);
}

/** M10 (fase 7): o virote cravando no bloco ("tchok"): um toque seco de madeira (240 → 150 Hz) e o clique do impacto. */
export function synthThunk(sampleRate = SYNTH_SAMPLE_RATE): Float32Array {
  const rate = sampleRate;
  const n = Math.round(0.14 * rate);
  const out = new Float32Array(n);
  const rng = createRng(0x0d05);
  const dPitch = Math.exp(-1 / (0.015 * rate));
  const dBody = Math.exp(-1 / (0.03 * rate));
  const dClick = Math.exp(-1 / (0.0015 * rate));
  let ePitch = 1;
  let eBody = 1;
  let eClick = 0.8;
  let phase = 0;
  for (let i = 0; i < n; i++) {
    phase += (TAU * (150 + 90 * ePitch)) / rate;
    out[i] = Math.sin(phase) * eBody + noise(rng) * eClick;
    ePitch *= dPitch;
    eBody *= dBody;
    eClick *= dClick;
  }
  return finish(out, 0.8, 1.5, rate);
}

/** Levantou (revivido): duas notas subindo. */
export function synthRevive(sampleRate = SYNTH_SAMPLE_RATE): Float32Array {
  const rate = sampleRate;
  const out = new Float32Array(Math.round(0.5 * rate));
  toyNote(out, 0, 880, 0.2, 0.9, rate);
  toyNote(out, 0.1, 1318.5, 0.38, 1, rate);
  return finish(out, 0.6, 0, rate);
}

// --- M12 (fase 4): o refino do som ---

/** Um estalo metálico: o clique de ruído (2 ms), o toque grave que cai e o "tim" inarmônico curto. */
function clack(out: Float32Array, startS: number, hz: number, level: number, rng: Rng, rate: number): void {
  const from = Math.round(startS * rate);
  const n = Math.min(out.length - from, Math.round(0.07 * rate));
  const dClick = Math.exp(-1 / (0.0018 * rate));
  const dBody = Math.exp(-1 / (0.018 * rate));
  const dRing = Math.exp(-1 / (0.03 * rate));
  const dBend = Math.exp(-1 / (0.01 * rate));
  let eClick = 1;
  let eBody = 0.8;
  let eRing = 0.25;
  let bend = 1;
  let p = 0;
  let q = 0;
  for (let i = 0; i < n; i++) {
    p += (TAU * hz * (0.75 + 0.25 * bend)) / rate;
    q += (TAU * hz * 4.6) / rate;
    out[from + i] = out[from + i]! + (noise(rng) * eClick + Math.sin(p) * eBody + Math.sin(q) * eRing) * level;
    eClick *= dClick;
    eBody *= dBody;
    eRing *= dRing;
    bend *= dBend;
  }
}

/** O ferrolho da sniper e o pump da escopeta ("tchk-tchk"): o estalo que vai e o que volta, 0,11 s depois. */
export function synthBolt(sampleRate = SYNTH_SAMPLE_RATE): Float32Array {
  const out = new Float32Array(Math.round(0.24 * sampleRate));
  const rng = createRng(0x0e02);
  clack(out, 0, 420, 1, rng, sampleRate);
  clack(out, 0.11, 520, 0.85, rng, sampleRate);
  return finish(out, 0.8, 1.2, sampleRate);
}

/**
 * O zunido da bala que passa perto ("fiu"): uma faixa de ruído com o centro caindo de ~3,6 para ~1,1 kHz (o Doppler
 * de quem passa), em sino de 0,13 s.
 */
export function synthWhiz(sampleRate = SYNTH_SAMPLE_RATE): Float32Array {
  const rate = sampleRate;
  const len = 0.13;
  const n = Math.round(len * rate);
  const out = new Float32Array(n);
  const rng = createRng(0x0e03);
  const lo: Lowpass2 = { a: 0, b: 0 };
  const hi: Lowpass2 = { a: 0, b: 0 };
  let kHi = 0;
  let kLo = 0;
  let p = 0;
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const f = 1100 + 2500 * (1 - u) * (1 - u);
    if (i % SWEEP_STEP === 0) {
      kHi = lowpassCoef(f * 1.4, rate);
      kLo = lowpassCoef(f * 0.6, rate);
    }
    p += (TAU * f) / rate;
    const env = Math.sin(Math.PI * Math.min(1, u * 1.6)) * (1 - u);
    const w = noise(rng);
    out[i] = ((lp2(hi, w, kHi) - lp2(lo, w, kLo)) * 3 + Math.sin(p) * 0.15) * env;
  }
  return finish(out, 0.75, 0, rate);
}

/** O "tique" do pente no fim: um clique seco e baixo de 1,25 kHz (o tom sobe pelo `rate` em cada bala). */
export function synthTick(sampleRate = SYNTH_SAMPLE_RATE): Float32Array {
  const rate = sampleRate;
  const n = Math.round(0.06 * rate);
  const out = new Float32Array(n);
  const rng = createRng(0x0e04);
  const dBody = Math.exp(-1 / (0.008 * rate));
  const dClick = Math.exp(-1 / (0.0008 * rate));
  let eBody = 1;
  let eClick = 0.6;
  let p = 0;
  for (let i = 0; i < n; i++) {
    p += (TAU * 1250) / rate;
    out[i] = Math.sin(p) * eBody + noise(rng) * eClick;
    eBody *= dBody;
    eClick *= dClick;
  }
  return finish(out, 0.7, 0.8, rate);
}

/** O bipe da Boom Box (dó agudo de brinquedo, curto). */
export function synthBombBeep(sampleRate = SYNTH_SAMPLE_RATE): Float32Array {
  const out = new Float32Array(Math.round(0.09 * sampleRate));
  toyNote(out, 0, 2093, 0.09, 1, sampleRate);
  return finish(out, 0.7, 0, sampleRate);
}

/** A Boom Box plantada (três bipes subindo) e desarmada (o estalo e dois bipes descendo). */
export function synthBombState(armed: boolean, sampleRate = SYNTH_SAMPLE_RATE): Float32Array {
  const rate = sampleRate;
  const out = new Float32Array(Math.round(0.5 * rate));
  if (armed) {
    [1568, 2093, 2637].forEach((hz, i) => toyNote(out, i * 0.09, hz, i === 2 ? 0.25 : 0.08, 1, rate));
  } else {
    clack(out, 0, 380, 0.9, createRng(0x0e05), rate);
    toyNote(out, 0.08, 1568, 0.12, 0.8, rate);
    toyNote(out, 0.22, 1046.5, 0.25, 0.8, rate);
  }
  return finish(out, 0.65, 0, rate);
}

/** O ponto ganho (dois tons subindo, mi-lá) e o perdido (dois tons descendo, lá-mi, na corneta mais escura). */
export function synthPointTones(gain: boolean, sampleRate = SYNTH_SAMPLE_RATE): Float32Array {
  const rate = sampleRate;
  const out = new Float32Array(Math.round(0.5 * rate));
  if (gain) {
    toyNote(out, 0, 659.25, 0.16, 1, rate);
    toyNote(out, 0.14, 880, 0.34, 1, rate);
  } else {
    hornNote(out, 0, 440, 0.15, 0, 0, rate);
    hornNote(out, 0.16, 329.6, 0.3, 0.03, 0, rate);
  }
  return finish(out, 0.6, gain ? 0 : 0.6, rate);
}

/** A zona fechando: duas cornetas graves meio tom uma da outra (sol e lá bemol), descendo devagar. */
export function synthZoneClose(sampleRate = SYNTH_SAMPLE_RATE): Float32Array {
  const out = new Float32Array(Math.round(1 * sampleRate));
  hornNote(out, 0, 196, 0.95, 0.08, 0, sampleRate);
  hornNote(out, 0, 207.65, 0.95, 0.08, 0, sampleRate);
  return finish(out, 0.7, 1, sampleRate);
}

/** O ping do time ("plim"): dois sininhos. */
export function synthPing(sampleRate = SYNTH_SAMPLE_RATE): Float32Array {
  const out = new Float32Array(Math.round(0.4 * sampleRate));
  bell(out, 0, 1760, 0.3, 0.9, sampleRate);
  bell(out, 0.05, 2637, 0.3, 0.7, sampleRate);
  return finish(out, 0.7, 0, sampleRate);
}

/** O zumbido no ouvido depois da explosão colada: dois senos agudos que batem (3,52 e 3,61 kHz) sumindo em ~0,8 s. */
export function synthEarRing(sampleRate = SYNTH_SAMPLE_RATE): Float32Array {
  const rate = sampleRate;
  const n = Math.round(0.85 * rate);
  const out = new Float32Array(n);
  const sine = sineT();
  const d = Math.exp(-1 / (0.25 * rate));
  const sp = (3520 * TABLE) / rate;
  const sq = (3610 * TABLE) / rate;
  const attack = 0.03 * rate;
  let e = 1;
  let p = 0;
  let q = 0;
  for (let i = 0; i < n; i++) {
    const kp = p | 0;
    const kq = q | 0;
    const a = sine[kp]!;
    const b = sine[kq]!;
    const v = a + (sine[kp + 1]! - a) * (p - kp) + (b + (sine[kq + 1]! - b) * (q - kq)) * 0.7;
    out[i] = v * (i < attack ? i / attack : 1) * e;
    p += sp;
    if (p >= TABLE) p -= TABLE;
    q += sq;
    if (q >= TABLE) q -= TABLE;
    e *= d;
  }
  return finish(out, 0.6, 0, rate);
}

/** Normaliza o pico para `peak` sem o fade do fim (os laços do ambiente emendam o fim no começo). */
function normalizeLoop(out: Float32Array, peak: number): Float32Array {
  let max = 0;
  for (let i = 0; i < out.length; i++) {
    const a = out[i]! < 0 ? -out[i]! : out[i]!;
    if (a > max) max = a;
  }
  if (max > 0) {
    const k = peak / max;
    for (let i = 0; i < out.length; i++) out[i] = out[i]! * k;
  }
  return out;
}

/** M12 (fase 4): o vento do ambiente é tocado a esta velocidade (o laço de 1 s vira 4 s; sai 4× mais barato). */
export const WIND_RATE = 0.25;

/**
 * O vento do ambiente (laço): ruído escuro (o corte de 1,4 kHz vira 350 Hz tocado a `WIND_RATE`) com rajadas
 * periódicas no laço (1 e 3 por volta). A emenda do fim no começo é um cruzamento de 1/16 do laço. Ruído e filtro
 * escritos no laço (xorshift, sem chamar função: o Switch interpreta o JS).
 */
export function synthWind(sampleRate = SYNTH_SAMPLE_RATE): Float32Array {
  const rate = sampleRate;
  const n = Math.round(1 * rate);
  const x = Math.round(n / 16);
  const sine = sineT();
  const g = new Float32Array(n + x);
  const k = lowpassCoef(1400, rate);
  const s1 = TABLE / n;
  const s3 = (3 * TABLE) / n;
  let seed = 0x0e06 | 0;
  let a = 0;
  let b = 0;
  let p1 = 0;
  let p3 = TABLE / 6;
  for (let i = 0; i < g.length; i++) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    a += k * (seed / 2147483648 - a);
    b += k * (a - b);
    const i1 = p1 | 0;
    const i3 = p3 | 0;
    const gust = 0.55 + 0.25 * sine[i1]! + 0.2 * sine[i3]!;
    g[i] = b * gust;
    p1 += s1;
    if (p1 >= TABLE) p1 -= TABLE;
    p3 += s3;
    if (p3 >= TABLE) p3 -= TABLE;
  }
  const out = g.subarray(0, n);
  // A emenda: o começo cruza com o que vinha depois do fim (o laço sai sem degrau).
  for (let i = 0; i < x; i++) {
    const w = i / x;
    out[i] = g[i]! * Math.sqrt(w) + g[n + i]! * Math.sqrt(1 - w);
  }
  return normalizeLoop(out.slice(), 0.8);
}

/** Os grilos da noite (laço de 2 s): dois grilos de 4,6 e 4,9 kHz, cada cricrilar com 3 pulsos. */
export function synthCrickets(sampleRate = SYNTH_SAMPLE_RATE): Float32Array {
  const rate = sampleRate;
  const out = new Float32Array(Math.round(2 * rate));
  const sine = sineT();
  const chirps = [
    [0.05, 4600, 1],
    [0.38, 4900, 0.7],
    [0.72, 4600, 1],
    [1.1, 4900, 0.7],
    [1.4, 4600, 0.9],
    [1.62, 4900, 0.6],
  ] as const;
  const pulseLen = Math.round(0.022 * rate);
  const gap = Math.round(0.035 * rate);
  for (const [at, hz, level] of chirps) {
    const step = (hz * TABLE) / rate;
    for (let pulse = 0; pulse < 3; pulse++) {
      const from = Math.round(at * rate) + pulse * gap;
      let ph = 0;
      for (let i = 0; i < pulseLen && from + i < out.length; i++) {
        const u = i / pulseLen;
        const env = u < 0.2 ? u / 0.2 : (1 - u) / 0.8;
        const k = ph | 0;
        out[from + i] = out[from + i]! + sine[k]! * env * level;
        ph += step;
        if (ph >= TABLE) ph -= TABLE;
      }
    }
  }
  return normalizeLoop(out, 0.7);
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
  // M10 (fase 8): o quique do Ricochete.
  ricochete: () => synthRicochet(),
  'contagem-bipe': () => synthCountBeep(false),
  'contagem-vai': () => synthCountBeep(true),
  vitoria: () => synthJingle(true),
  derrota: () => synthJingle(false),
  coracao: () => synthHeartbeat(),
  deslize: () => synthSlide(),
  // M3 (fase 6d): o Bobo Zombies.
  ...Object.fromEntries(
    (Object.keys(GROANS) as (keyof typeof GROANS)[]).map((id) => [id, () => synthGroan(GROANS[id])]),
  ),
  cuspe: () => synthSpit(),
  compra: () => synthPurchase(),
  'caixa-gira': () => synthMusicBox(),
  'caixa-ursinho': () => synthTeddy(),
  vantagem: () => synthPerk(),
  'drop-pega': () => synthDropTake(),
  'onda-limpa': () => synthWaveClear(),
  levantou: () => synthRevive(),
  // M10 (fase 7): a besta, o lança-granadas e o virote cravando.
  besta: () => synthTwang(),
  'lanca-granadas': () => synthBloop(),
  'virote-crava': () => synthThunk(),
  // M12 (fase 4): o empate, o foley das armas, o zunido, o pente, os objetivos e o zumbido da explosão colada.
  empate: () => synthTie(),
  ferrolho: () => synthBolt(),
  zunido: () => synthWhiz(),
  tique: () => synthTick(),
  'bomba-bipe': () => synthBombBeep(),
  'bomba-armada': () => synthBombState(true),
  'bomba-desarmada': () => synthBombState(false),
  'ponto-ganho': () => synthPointTones(true),
  'ponto-perdido': () => synthPointTones(false),
  'zona-fecha': () => synthZoneClose(),
  ping: () => synthPing(),
  zumbido: () => synthEarRing(),
  // M12 (fase 4): o ambiente do mapa (laços).
  vento: () => synthWind(),
  grilos: () => synthCrickets(),
};

/** M12 (fase 4): os laços do ambiente (sem o fade do fim, que faria um buraco a cada volta). */
export const AMBIENT_LOOPS: readonly string[] = ['vento', 'grilos'];
