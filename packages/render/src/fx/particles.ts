// Anéis de partículas do programa 5 (sem three). A partícula é escrita UMA vez ao nascer (24 floats) e o vertex shader
// faz o resto pelo relógio: nada é atualizado por frame na CPU. O anel sobrescreve a mais velha quando enche e marca a
// faixa suja para o upload parcial. Pools pré-alocados (arte-ux.md §4.1: traçantes 128, marcas de tiro 256).
import { PARTICLE_KIND } from './shader.ts';

/** Floats por partícula (6 × vec4: pA..pF em `shader.ts`). */
export const PARTICLE_FLOATS = 24;

export type ParticleKind = (typeof PARTICLE_KIND)[keyof typeof PARTICLE_KIND];

export interface ParticleRing {
  readonly capacity: number;
  readonly data: Float32Array;
  /** Próxima posição a escrever. */
  next: number;
  /** Quantas posições já foram escritas alguma vez (= `count` da malha; as mortas somem no shader). */
  written: number;
  /** Faixa escrita desde o último upload (posições; -1 = nada). */
  dirtyMin: number;
  dirtyMax: number;
  /** Relógio até quando alguma partícula ainda vive (a malha some depois disso: zero draw call). */
  aliveUntil: number;
}

export function createParticleRing(capacity: number): ParticleRing {
  return {
    capacity,
    data: new Float32Array(capacity * PARTICLE_FLOATS),
    next: 0,
    written: 0,
    dirtyMin: -1,
    dirtyMax: -1,
    aliveUntil: -1,
  };
}

export function clearParticleRing(ring: ParticleRing): void {
  ring.next = 0;
  ring.written = 0;
  ring.dirtyMin = -1;
  ring.dirtyMax = -1;
  ring.aliveUntil = -1;
}

/**
 * Rascunho de uma partícula: o chamador preenche os campos (reaproveitando o objeto) e chama `emitParticle`. Valores
 * padrão em `resetParticleSpec`.
 */
export interface ParticleSpec {
  kind: ParticleKind;
  /** Slot local dono (0..3) que NÃO vê a partícula em 1ª pessoa (clarão do próprio tiro); -1 = todos veem. */
  owner: number;
  x: number;
  y: number;
  z: number;
  size: number;
  vx: number;
  vy: number;
  vz: number;
  gravity: number;
  /** Fim do traçante ou normal do decal. */
  x1: number;
  y1: number;
  z1: number;
  rotation: number;
  spin: number;
  r: number;
  g: number;
  b: number;
  a: number;
  life: number;
  /** Tamanho no fim / tamanho no começo. */
  growth: number;
  sky: number;
  sun: number;
  emissive: number;
}

export function createParticleSpec(): ParticleSpec {
  const s = {} as ParticleSpec;
  resetParticleSpec(s);
  return s;
}

export function resetParticleSpec(s: ParticleSpec): void {
  s.kind = PARTICLE_KIND.round;
  s.owner = -1;
  s.x = s.y = s.z = 0;
  s.size = 0.1;
  s.vx = s.vy = s.vz = 0;
  s.gravity = 0;
  s.x1 = s.y1 = s.z1 = 0;
  s.rotation = 0;
  s.spin = 0;
  s.r = s.g = s.b = s.a = 1;
  s.life = 1;
  s.growth = 1;
  s.sky = 1;
  s.sun = 1;
  s.emissive = 0;
}

/** Escreve a partícula nascendo agora (`time`, relógio do passe). Devolve a posição no anel. */
export function emitParticle(ring: ParticleRing, s: Readonly<ParticleSpec>, time: number): number {
  const slot = ring.next;
  ring.next = (slot + 1) % ring.capacity;
  if (ring.written < ring.capacity) ring.written++;
  if (ring.dirtyMin < 0) {
    ring.dirtyMin = slot;
    ring.dirtyMax = slot;
  } else if (slot < ring.dirtyMax) {
    // Deu a volta no anel neste frame: sobe tudo.
    ring.dirtyMin = 0;
    ring.dirtyMax = ring.capacity - 1;
  } else {
    ring.dirtyMax = slot;
  }
  const d = ring.data;
  const o = slot * PARTICLE_FLOATS;
  d[o] = s.x;
  d[o + 1] = s.y;
  d[o + 2] = s.z;
  d[o + 3] = s.size;
  d[o + 4] = s.vx;
  d[o + 5] = s.vy;
  d[o + 6] = s.vz;
  d[o + 7] = s.gravity;
  d[o + 8] = s.x1;
  d[o + 9] = s.y1;
  d[o + 10] = s.z1;
  d[o + 11] = s.rotation;
  d[o + 12] = s.r;
  d[o + 13] = s.g;
  d[o + 14] = s.b;
  d[o + 15] = s.a;
  d[o + 16] = time;
  d[o + 17] = Math.max(1e-3, s.life);
  d[o + 18] = s.kind + 16 * (s.owner >= 0 && s.owner < 255 ? s.owner + 1 : 0);
  d[o + 19] = s.growth;
  d[o + 20] = s.sky;
  d[o + 21] = s.sun;
  d[o + 22] = s.emissive;
  d[o + 23] = s.spin;
  ring.aliveUntil = Math.max(ring.aliveUntil, time + s.life);
  return slot;
}

/** Zera a faixa suja depois do upload. */
export function markParticlesUploaded(ring: ParticleRing): void {
  ring.dirtyMin = -1;
  ring.dirtyMax = -1;
}

/** A partícula da posição `slot` ainda vive no relógio `time`? (testes e depuração) */
export function particleAlive(ring: ParticleRing, slot: number, time: number): boolean {
  if (slot >= ring.written) return false;
  const o = slot * PARTICLE_FLOATS;
  const age = time - ring.data[o + 16]!;
  return age >= 0 && age < ring.data[o + 17]!;
}

/** Posição da partícula no relógio `time` (a mesma conta do vertex shader; testes). */
export function particlePosition(ring: ParticleRing, slot: number, time: number, out: Float32Array): void {
  const d = ring.data;
  const o = slot * PARTICLE_FLOATS;
  const age = time - d[o + 16]!;
  out[0] = d[o]! + d[o + 4]! * age;
  out[1] = d[o + 1]! + d[o + 5]! * age - 0.5 * d[o + 7]! * age * age;
  out[2] = d[o + 2]! + d[o + 6]! * age;
}
