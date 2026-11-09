// M2 (fase 7d): a música do menu (#38 e #63): tabela (`assets-src/audio/music.json`), corte do loop e medida do atraso
// do decodificador. Puro e testável; o `index.ts` decodifica e codifica.
//
// O loop é um número inteiro de compassos a partir de uma cabeça de compasso. Para a emenda não estalar, o começo do
// loop é misturado (curva linear, de ganho igual: os dois lados são o mesmo trecho musical alinhado no compasso, e a
// curva de potência igual somaria até +3 dB) com o que vinha logo DEPOIS do fim na música original: tocando em loop,
// o fim do recorte emenda no começo como a música emendaria nela mesma.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface MusicTrack {
  /** Nome de saída (`menu` → `generated/music/menu.mp3` e `menu.json`). */
  readonly out: string;
  readonly title: string;
  readonly author: string;
  readonly url: string;
  readonly license: string;
  readonly sha256: string;
  readonly downloaded: string;
  /** Original baixado, relativo à raiz do repositório (fica fora do git: `local/`). */
  readonly source: string;
  /** Andamento e compassos (4 tempos) do loop. */
  readonly bpm: number;
  readonly bars: number;
  /** Primeira amostra do loop no original decodificado a `sampleRate` (uma cabeça de compasso). */
  readonly startSample: number;
  readonly sampleRate: number;
  readonly crossfadeS: number;
  readonly kbps: number;
}

const str = (v: unknown, what: string): string => {
  if (typeof v !== 'string' || v === '') throw new Error(`music.json: ${what} precisa ser texto`);
  return v;
};
const num = (v: unknown, what: string, min: number, max: number): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max)
    throw new Error(`music.json: ${what} fora de ${min}..${max}`);
  return v;
};

/** Lê e valida a tabela. Só CC0 (decisão #38: música CC0 provisória). */
export function parseMusicTable(text: string): readonly MusicTrack[] {
  const raw = JSON.parse(text) as { tracks?: unknown };
  if (!Array.isArray(raw.tracks)) throw new Error('music.json: sem "tracks"');
  return (raw.tracks as Record<string, unknown>[]).map((t, i) => {
    const w = `tracks[${i}]`;
    const track: MusicTrack = {
      out: str(t['out'], `${w}.out`),
      title: str(t['title'], `${w}.title`),
      author: str(t['author'], `${w}.author`),
      url: str(t['url'], `${w}.url`),
      license: str(t['license'], `${w}.license`),
      sha256: str(t['sha256'], `${w}.sha256`),
      downloaded: str(t['downloaded'], `${w}.downloaded`),
      source: str(t['source'], `${w}.source`),
      bpm: num(t['bpm'], `${w}.bpm`, 40, 240),
      bars: num(t['bars'], `${w}.bars`, 1, 200),
      startSample: num(t['startSample'], `${w}.startSample`, 0, 1e9),
      sampleRate: num(t['sampleRate'], `${w}.sampleRate`, 8000, 96000),
      crossfadeS: num(t['crossfadeS'], `${w}.crossfadeS`, 0.005, 2),
      kbps: num(t['kbps'], `${w}.kbps`, 32, 320),
    };
    if (!/^[a-z0-9-]+$/.test(track.out)) throw new Error(`music.json: nome de saída inválido "${track.out}"`);
    if (!/CC0/.test(track.license)) throw new Error(`music.json: ${track.out} não é CC0 (decisão #38)`);
    return track;
  });
}

/** Amostras de um compasso de 4 tempos. */
export const barSamples = (t: Pick<MusicTrack, 'bpm' | 'sampleRate'>): number =>
  Math.round((240 / t.bpm) * t.sampleRate);

/** Amostras do loop inteiro. */
export const loopSamples = (t: MusicTrack): number => barSamples(t) * t.bars;

/**
 * Recorta o loop de cada canal: `length` amostras a partir de `start`, com os primeiros `fade` misturados ao que vinha
 * depois do fim (`start + length + i`), em curva linear (ganho igual). Precisa de `fade` amostras de sobra depois do fim.
 */
export function cutLoop(channel: Float32Array, start: number, length: number, fade: number): Float32Array {
  if (start < 0 || start + length + fade > channel.length) throw new Error('loop: o trecho passa do fim da música');
  const out = channel.slice(start, start + length);
  for (let i = 0; i < fade; i++) {
    const u = (i + 0.5) / fade;
    out[i] = channel[start + i]! * u + channel[start + length + i]! * (1 - u);
  }
  return out;
}

/** Folga de cada lado do loop no MP3 (4 quadros de 1.152 amostras: cobre a sobreposição do MDCT com sobra). */
export const LOOP_PAD_SAMPLES = 4 * 1152;

/**
 * O loop com folga circular: as últimas `pad` amostras dele antes e as primeiras depois. Tocado em loop, o que vem
 * antes do começo é o fim e o que vem depois do fim é o começo; codificado assim, o MP3 não borra as bordas.
 */
export function wrapPad(loop: Float32Array, pad: number): Float32Array {
  if (pad > loop.length) throw new Error('loop: folga maior que o loop');
  const out = new Float32Array(loop.length + pad * 2);
  out.set(loop.subarray(loop.length - pad), 0);
  out.set(loop, pad);
  out.set(loop.subarray(0, pad), pad + loop.length);
  return out;
}

/**
 * Atraso (em amostras) entre o áudio de referência e o mesmo áudio depois de codificado e decodificado: a correlação
 * normalizada de `window` amostras, procurando de 0 a `maxShift`. Devolve o deslocamento e a correlação (1 = igual).
 */
export function findOffset(
  reference: Float32Array,
  decoded: Float32Array,
  maxShift: number,
  window: number,
): { readonly offset: number; readonly correlation: number } {
  let best = 0;
  let bestC = -2;
  const w = Math.min(window, reference.length);
  for (let s = 0; s <= maxShift && s + w <= decoded.length; s++) {
    let num = 0;
    let da = 0;
    let db = 0;
    for (let k = 0; k < w; k++) {
      const x = reference[k]!;
      const y = decoded[s + k]!;
      num += x * y;
      da += x * x;
      db += y * y;
    }
    const c = num / Math.sqrt(da * db + 1e-12);
    if (c > bestC) {
      bestC = c;
      best = s;
    }
  }
  return { offset: best, correlation: bestC };
}

/** Confere que o original existe e bate com o SHA-256 da tabela (o arquivo fica em `local/`, fora do git). */
export function sourcePath(root: string, track: MusicTrack): string {
  const p = join(root, track.source);
  if (!existsSync(p)) throw new Error(`music.json: falta o original ${track.source} (baixado fora do git)`);
  return p;
}

export function readMusicTable(path: string): readonly MusicTrack[] {
  return parseMusicTable(readFileSync(path, 'utf8'));
}
