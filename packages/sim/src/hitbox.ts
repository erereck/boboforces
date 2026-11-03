import { HITBOXES, METRICS } from './config/metrics.ts';
import { ENTITY_FLAG } from './entity.ts';

/**
 * Hitboxes do bobo (gameplay.md §3.1): 6 caixas rígidas no espaço local da entidade, orientadas pelo yaw.
 * Local: x = direita, y = cima (a partir dos pés), z = frente. Em pé: pernas 0..0,5 m, tronco e braços 0,5..1,0 m,
 * cabeça 1,0..1,5 m. Agachado (0,95 m): a cabeça mantém os 0,5 m no topo e o resto se comprime em 0..0,45 m.
 * A forma final é aprovada por print no M1; a altura total e a cabeça de 0,5 m não mudam.
 */

/** Código da parte: 0 cabeça, 1 tronco, 2 braço, 3 perna (ver `HIT_PARTS` no context). */
const PART_CODES = [0, 1, 2, 2, 3, 3] as const;
export const HITBOX_COUNT = PART_CODES.length;

/** Por caixa: minX, minY, minZ, maxX, maxY, maxZ, código da parte. */
const STRIDE = 7;

function buildTable(crouched: boolean): Float64Array {
  const t = new Float64Array(HITBOX_COUNT * STRIDE);
  const [hw, hh, hd] = HITBOXES.head;
  const [tw, th, td] = HITBOXES.torso;
  const [aw, ah, ad] = HITBOXES.arm;
  const [lw, lh, ld] = HITBOXES.leg;
  const height = crouched ? METRICS.crouchHeight : METRICS.bodyHeight;
  const headTop = height;
  const headBottom = height - hh;
  // Fator vertical do corpo abaixo da cabeça (1 em pé; comprime agachado).
  const k = headBottom / (th + lh);
  const legTop = lh * k;
  const torsoTop = legTop + th * k;
  const armTop = legTop + ah * k;
  let i = 0;
  const put = (minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): void => {
    t[i * STRIDE] = minX;
    t[i * STRIDE + 1] = minY;
    t[i * STRIDE + 2] = minZ;
    t[i * STRIDE + 3] = maxX;
    t[i * STRIDE + 4] = maxY;
    t[i * STRIDE + 5] = maxZ;
    t[i * STRIDE + 6] = PART_CODES[i]!;
    i++;
  };
  put(-hw / 2, headBottom, -hd / 2, hw / 2, headTop, hd / 2);
  put(-tw / 2, legTop, -td / 2, tw / 2, torsoTop, td / 2);
  put(-tw / 2 - aw, legTop, -ad / 2, -tw / 2, armTop, ad / 2);
  put(tw / 2, legTop, -ad / 2, tw / 2 + aw, armTop, ad / 2);
  put(-lw, 0, -ld / 2, 0, legTop, ld / 2);
  put(0, 0, -ld / 2, lw, legTop, ld / 2);
  return t;
}

const STANDING = buildTable(false);
const CROUCHED = buildTable(true);

/** Meia-largura da caixa envolvente no plano (cobre os braços girados): fase larga do teste. */
const BROAD_RADIUS = 0.45;

/** Entrada do raio na caixa [min, max] (slab test), ou `Infinity`. Origem dentro da caixa dá 0. */
export function rayBoxEntry(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
  maxT: number,
): number {
  let tmin = 0;
  let tmax = maxT;
  if (dx > -1e-12 && dx < 1e-12) {
    if (ox < minX || ox > maxX) return Infinity;
  } else {
    const inv = 1 / dx;
    let t1 = (minX - ox) * inv;
    let t2 = (maxX - ox) * inv;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return Infinity;
  }
  if (dy > -1e-12 && dy < 1e-12) {
    if (oy < minY || oy > maxY) return Infinity;
  } else {
    const inv = 1 / dy;
    let t1 = (minY - oy) * inv;
    let t2 = (maxY - oy) * inv;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return Infinity;
  }
  if (dz > -1e-12 && dz < 1e-12) {
    if (oz < minZ || oz > maxZ) return Infinity;
  } else {
    const inv = 1 / dz;
    let t1 = (minZ - oz) * inv;
    let t2 = (maxZ - oz) * inv;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return Infinity;
  }
  return tmin;
}

/** Saída de `rayVsBobo`: parte acertada (código) e ponto, preenchidos só quando acerta. */
export interface BoboHit {
  part: number;
  t: number;
}

export function createBoboHit(): BoboHit {
  return { part: 0, t: Infinity };
}

/**
 * Raio (origem e direção unitária em metros) contra as hitboxes de um bobo com os pés em (px, py, pz), virado para
 * `yaw`. Devolve a distância de entrada (≤ `maxT`) ou `Infinity`; escreve a parte em `out`.
 */
export function rayVsBobo(
  px: number,
  py: number,
  pz: number,
  yaw: number,
  crouched: boolean,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxT: number,
  out: BoboHit,
): number {
  const height = crouched ? METRICS.crouchHeight : METRICS.bodyHeight;
  const rx = ox - px;
  const ry = oy - py;
  const rz = oz - pz;
  // Fase larga: caixa envolvente alinhada aos eixos do mundo.
  const broad = rayBoxEntry(
    rx,
    ry,
    rz,
    dx,
    dy,
    dz,
    -BROAD_RADIUS,
    0,
    -BROAD_RADIUS,
    BROAD_RADIUS,
    height,
    BROAD_RADIUS,
    maxT,
  );
  if (broad === Infinity) return Infinity;
  // Para o espaço local: x = direita (cos, -sin), z = frente (-sin, -cos).
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const lox = rx * c - rz * s;
  const loz = -rx * s - rz * c;
  const ldx = dx * c - dz * s;
  const ldz = -dx * s - dz * c;
  const table = crouched ? CROUCHED : STANDING;
  let best = Infinity;
  for (let i = 0; i < HITBOX_COUNT; i++) {
    const o = i * STRIDE;
    const t = rayBoxEntry(
      lox,
      ry,
      loz,
      ldx,
      dy,
      ldz,
      table[o]!,
      table[o + 1]!,
      table[o + 2]!,
      table[o + 3]!,
      table[o + 4]!,
      table[o + 5]!,
      maxT,
    );
    if (t < best) {
      best = t;
      out.part = table[o + 6]!;
    }
  }
  out.t = best;
  return best;
}

/** Altura (a partir dos pés) do centro da cabeça ou do tronco: o ponto que a IA mira. */
export function aimPointHeight(flags: number, head: boolean): number {
  const crouched = (flags & ENTITY_FLAG.crouching) !== 0;
  const table = crouched ? CROUCHED : STANDING;
  const o = (head ? 0 : 1) * STRIDE;
  return (table[o + 1]! + table[o + 4]!) / 2;
}

/** Altura do olho (a partir dos pés) conforme o agachamento. */
export function eyeHeightFor(flags: number): number {
  return (flags & ENTITY_FLAG.crouching) !== 0 ? METRICS.crouchEyeHeight : METRICS.eyeHeight;
}
