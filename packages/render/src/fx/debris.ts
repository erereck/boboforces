// Cubinhos de detrito (arte-ux.md §4.1, tecnico.md §6.6): pool pré-alocado no programa 4, cor sólida por instância
// (lida pela CPU no texel atingido) e luz amostrada, quicando na grade (Verlet). Posições fixas no pool: os dados de
// cor e luz só sobem quando um cubinho nasce; por frame só as matrizes dos que se mexem. Sem three, sem alocação.
import { addTexturedBox, GeometryBuilder, type GeometryArrays } from '../actors/geometry.ts';
import { INST, INSTANCE_FLOATS, VERTEX_FLAG, writeInstanceDefaults, writeRgb01 } from '../actors/layout.ts';
import { m4Identity, m4RotateX, m4RotateY, m4Scale, m4Translate, m4Zero, MAT4 } from '../actors/math.ts';
import { verletStep, VERLET_HIT, type CollisionWorld, type VerletParams } from './verlet.ts';

/** Capacidade física do pool (o teto do PC é 500); o perfil limita com `budget` (`setDebrisBudget`). */
export const DEBRIS_CAPACITY = 512;
export const DEBRIS_PHYSICS: VerletParams = { gravity: 14, bounce: 0.35, friction: 6, drag: 0.4 };
/** Fração final da vida em que o cubinho encolhe até sumir. */
const SHRINK_FRACTION = 0.2;

export interface DebrisPool {
  readonly capacity: number;
  /** Teto ativo (perfil): o anel usa só as posições [0, budget). */
  budget: number;
  readonly pos: Float32Array;
  readonly prev: Float32Array;
  readonly size: Float32Array;
  readonly age: Float32Array;
  readonly life: Float32Array;
  /** Giro em torno de um eixo fixo por cubinho (cosmético): ângulo X e Y e velocidade. */
  readonly spin: Float32Array;
  readonly alive: Uint8Array;
  readonly resting: Uint8Array;
  /** Matrizes e dados de instância (layout do programa 4). */
  readonly matrices: Float32Array;
  readonly data: Float32Array;
  next: number;
  /** 1 + maior posição viva (= `count` da malha). */
  highWater: number;
  /** Faixa de dados (cor, luz) mudada desde o último upload. */
  dataDirtyMin: number;
  dataDirtyMax: number;
  lastDt: number;
}

export function createDebrisPool(capacity = DEBRIS_CAPACITY, budget = 200): DebrisPool {
  const pool: DebrisPool = {
    capacity,
    budget: Math.min(capacity, Math.max(0, budget)),
    pos: new Float32Array(capacity * 3),
    prev: new Float32Array(capacity * 3),
    size: new Float32Array(capacity),
    age: new Float32Array(capacity),
    life: new Float32Array(capacity),
    spin: new Float32Array(capacity * 3),
    alive: new Uint8Array(capacity),
    resting: new Uint8Array(capacity),
    matrices: new Float32Array(capacity * MAT4),
    data: new Float32Array(capacity * INSTANCE_FLOATS),
    next: 0,
    highWater: 0,
    dataDirtyMin: -1,
    dataDirtyMax: -1,
    lastDt: 1 / 60,
  };
  for (let i = 0; i < capacity; i++) writeInstanceDefaults(pool.data, i * INSTANCE_FLOATS);
  return pool;
}

export function setDebrisBudget(pool: DebrisPool, budget: number): void {
  const b = Math.min(pool.capacity, Math.max(0, Math.floor(budget)));
  // Os que ficaram fora do teto novo somem já.
  for (let i = b; i < pool.capacity; i++) {
    if (pool.alive[i]) {
      pool.alive[i] = 0;
      m4Zero(pool.matrices, i * MAT4);
    }
  }
  pool.budget = b;
  if (pool.next >= b) pool.next = 0;
}

/**
 * Nasce um cubinho em (x, y, z) com velocidade (m/s), cor 0xRRGGBB, lado (m), vida (s), luz (céu, sol, emissivo) e
 * giro. Sem espaço, sobrescreve o mais antigo do anel. Devolve a posição ou -1 se o teto do perfil é 0.
 */
export function spawnDebris(
  pool: DebrisPool,
  x: number,
  y: number,
  z: number,
  vx: number,
  vy: number,
  vz: number,
  rgb: number,
  size: number,
  life: number,
  sky: number,
  sun: number,
  emissive: number,
  spinX: number,
  spinY: number,
  spinRate: number,
): number {
  if (pool.budget <= 0) return -1;
  const i = pool.next;
  pool.next = (i + 1) % pool.budget;
  const dt = pool.lastDt > 0 ? pool.lastDt : 1 / 60;
  pool.pos[i * 3] = x;
  pool.pos[i * 3 + 1] = y;
  pool.pos[i * 3 + 2] = z;
  pool.prev[i * 3] = x - vx * dt;
  pool.prev[i * 3 + 1] = y - vy * dt;
  pool.prev[i * 3 + 2] = z - vz * dt;
  pool.size[i] = size;
  pool.age[i] = 0;
  pool.life[i] = life;
  pool.spin[i * 3] = spinX;
  pool.spin[i * 3 + 1] = spinY;
  pool.spin[i * 3 + 2] = spinRate;
  pool.alive[i] = 1;
  pool.resting[i] = 0;
  const d = i * INSTANCE_FLOATS;
  writeRgb01(pool.data, d + INST.r, rgb);
  pool.data[d + INST.sky] = sky;
  pool.data[d + INST.sun] = sun;
  pool.data[d + INST.emissive] = emissive;
  if (pool.dataDirtyMin < 0 || i < pool.dataDirtyMin) pool.dataDirtyMin = i;
  if (i > pool.dataDirtyMax) pool.dataDirtyMax = i;
  if (i + 1 > pool.highWater) pool.highWater = i + 1;
  return i;
}

/** Avança a física (Verlet contra a grade) e escreve as matrizes. Devolve quantos estão vivos. */
export function stepDebris(pool: DebrisPool, dt: number, world: CollisionWorld | null): number {
  let alive = 0;
  let high = 0;
  for (let i = 0; i < pool.budget; i++) {
    if (!pool.alive[i]) continue;
    const age = pool.age[i]! + dt;
    if (age >= pool.life[i]!) {
      pool.alive[i] = 0;
      m4Zero(pool.matrices, i * MAT4);
      continue;
    }
    pool.age[i] = age;
    const t = age / pool.life[i]!;
    if (pool.resting[i] && t <= 1 - SHRINK_FRACTION) {
      // Parado no chão e ainda sem encolher: a matriz do frame em que assentou continua valendo.
      alive++;
      high = i + 1;
      continue;
    }
    const half = pool.size[i]! * 0.5;
    if (!pool.resting[i]) {
      const hit = verletStep(pool.pos, pool.prev, i * 3, dt, pool.lastDt, half, half, half, world, DEBRIS_PHYSICS);
      if ((hit & VERLET_HIT.ground) !== 0) {
        // Assentou: para de girar e de simular quando quase parado.
        pool.spin[i * 3 + 2] = pool.spin[i * 3 + 2]! * 0.5;
        const vx = pool.pos[i * 3]! - pool.prev[i * 3]!;
        const vy = pool.pos[i * 3 + 1]! - pool.prev[i * 3 + 1]!;
        const vz = pool.pos[i * 3 + 2]! - pool.prev[i * 3 + 2]!;
        if (vx * vx + vy * vy + vz * vz < 0.08 * dt * (0.08 * dt)) pool.resting[i] = 1;
      }
      pool.spin[i * 3] = pool.spin[i * 3]! + pool.spin[i * 3 + 2]! * dt;
      pool.spin[i * 3 + 1] = pool.spin[i * 3 + 1]! + pool.spin[i * 3 + 2]! * 0.7 * dt;
    }
    const shrink = t > 1 - SHRINK_FRACTION ? (1 - t) / SHRINK_FRACTION : 1;
    const s = pool.size[i]! * shrink;
    const m = i * MAT4;
    m4Identity(pool.matrices, m);
    m4Translate(pool.matrices, pool.pos[i * 3]!, pool.pos[i * 3 + 1]!, pool.pos[i * 3 + 2]!, m);
    m4RotateY(pool.matrices, pool.spin[i * 3 + 1]!, m);
    m4RotateX(pool.matrices, pool.spin[i * 3]!, m);
    m4Scale(pool.matrices, s, s, s, m);
    alive++;
    high = i + 1;
  }
  pool.highWater = high;
  if (dt > 0) pool.lastDt = dt;
  return alive;
}

export function clearDebris(pool: DebrisPool): void {
  pool.alive.fill(0);
  pool.matrices.fill(0);
  pool.highWater = 0;
  pool.next = 0;
}

/** Cubo unitário centrado na origem, cor sólida (não amostra a camada): a escala da instância dá o lado. */
export function buildDebrisCubeGeometry(): GeometryArrays {
  const b = new GeometryBuilder();
  addTexturedBox(
    b,
    {
      min: [-0.5, -0.5, -0.5],
      size: [1, 1, 1],
      inflate: 0,
      tex: [1, 1, 1],
      uv: [0, 0],
      layerSize: 64,
      mirror: false,
    },
    { layer: 0, flags: VERTEX_FLAG.solid },
  );
  return b.build();
}
