import { assert } from './assert.ts';
import { fnv1a32String, hashCombine } from './hash.ts';

/**
 * RNG com semente (sfc32), um fluxo por domínio (tecnico.md §4.3): `rng.fork('match')`, `rng.fork('bot', i)`,
 * `rng.fork('loot')`. Proibido `Math.random` em sim, ai, nav, format e world.
 *
 * `fork` deriva o fluxo filho só da chave do pai e do nome (nunca do quanto o pai já foi consumido). Assim, ligar um
 * sistema novo que consome números não muda os números dos outros domínios, e o golden fica estável.
 *
 * Determinismo garantido dentro da mesma build e plataforma: `next()` usa só aritmética inteira; `gaussian()` usa
 * `Math.log`/`Math.sqrt`, que podem variar entre motores JS (aceitável, ver §4.3).
 */
export interface Rng {
  /** Chave de 32 bits deste fluxo (semente-raiz combinada com o caminho de nomes). */
  readonly key: number;
  /** Próximo inteiro sem sinal de 32 bits. */
  nextU32(): number;
  /** Real em [0, 1), com 32 bits de resolução. */
  next(): number;
  /** Real em [min, max). */
  range(min: number, max: number): number;
  /** Inteiro em [min, maxExclusive). */
  int(min: number, maxExclusive: number): number;
  /** `true` com probabilidade `p`. */
  chance(p: number): boolean;
  /** Um item da lista (não vazia). */
  pick<T>(items: readonly T[]): T;
  /** Embaralha no lugar (Fisher-Yates) e devolve a mesma lista. */
  shuffle<T>(items: T[]): T[];
  /** Normal padrão (média 0, desvio 1), pelo método polar de Marsaglia (sem trigonometria). */
  gaussian(): number;
  /** Fluxo independente e estável para um domínio. `index` distingue instâncias (ex.: bot 3). */
  fork(name: string, index?: number): Rng;
  /** Copia o estado (RNG_STATE_WORDS palavras) para snapshot/replay. */
  saveState(out: Uint32Array): void;
  /** Restaura um estado salvo com `saveState`. */
  loadState(state: Uint32Array): void;
}

/** Palavras de 32 bits do estado do sfc32. */
export const RNG_STATE_WORDS = 4;

/** Normaliza uma semente (número ou texto) para a chave de 32 bits. */
export function seedToKey(seed: number | string): number {
  if (typeof seed === 'string') return fnv1a32String(seed);
  assert(Number.isFinite(seed), 'semente precisa ser finita');
  return Math.trunc(seed) >>> 0;
}

class Sfc32 implements Rng {
  readonly key: number;
  private a = 0;
  private b = 0;
  private c = 0;
  private d = 0;

  constructor(key: number) {
    this.key = key >>> 0;
    // splitmix32 espalha a chave nas 4 palavras; depois descarta 12 saídas para misturar o estado.
    let s = this.key;
    const words = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      s = (s + 0x9e3779b9) | 0;
      let z = s;
      z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
      z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
      words[i] = (z ^ (z >>> 15)) >>> 0;
    }
    this.a = words[0]!;
    this.b = words[1]!;
    this.c = words[2]!;
    this.d = words[3]!;
    for (let i = 0; i < 12; i++) this.nextU32();
  }

  nextU32(): number {
    const a = this.a;
    const b = this.b;
    const c = this.c;
    const d = this.d;
    const t = (((a + b) | 0) + d) | 0;
    this.d = (d + 1) | 0;
    this.a = b ^ (b >>> 9);
    this.b = (c + (c << 3)) | 0;
    this.c = (((c << 21) | (c >>> 11)) + t) | 0;
    return t >>> 0;
  }

  next(): number {
    return this.nextU32() / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  int(min: number, maxExclusive: number): number {
    assert(maxExclusive > min, 'int(): intervalo vazio');
    return min + Math.floor(this.next() * (maxExclusive - min));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    assert(items.length > 0, 'pick(): lista vazia');
    return items[this.int(0, items.length)] as T;
  }

  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(0, i + 1);
      const tmp = items[i] as T;
      items[i] = items[j] as T;
      items[j] = tmp;
    }
    return items;
  }

  gaussian(): number {
    // Polar de Marsaglia; descarta o segundo valor para o estado continuar sendo só as 4 palavras.
    for (;;) {
      const u = this.next() * 2 - 1;
      const v = this.next() * 2 - 1;
      const s = u * u + v * v;
      if (s > 0 && s < 1) return u * Math.sqrt((-2 * Math.log(s)) / s);
    }
  }

  fork(name: string, index = 0): Rng {
    return new Sfc32(hashCombine(hashCombine(this.key, fnv1a32String(name)), index >>> 0));
  }

  saveState(out: Uint32Array): void {
    assert(out.length >= RNG_STATE_WORDS, 'saveState(): buffer pequeno');
    out[0] = this.a;
    out[1] = this.b;
    out[2] = this.c;
    out[3] = this.d;
  }

  loadState(state: Uint32Array): void {
    assert(state.length >= RNG_STATE_WORDS, 'loadState(): estado incompleto');
    this.a = state[0]! | 0;
    this.b = state[1]! | 0;
    this.c = state[2]! | 0;
    this.d = state[3]! | 0;
  }
}

/** Cria o RNG-raiz de uma partida/ferramenta. Textos viram chave por FNV-1a (UTF-8). */
export function createRng(seed: number | string): Rng {
  return new Sfc32(seedToKey(seed));
}
