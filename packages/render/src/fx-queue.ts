// M1: fila de VFX do frame (arte-ux.md §4, tecnico.md §6.6), sem three. O `game` traduz os eventos da sim em pedidos
// aqui (sem alocação: SoA pré-alocada) e chama `Renderer.submitFx`; a frente "render-atores" consome no `FxPass`.
// A COR dos cubinhos o render resolve sozinho (texel do bloco pela camada da face e pela posição; texel da skin pela
// caixa atingida do boneco; `debrisColor` do modelo na prop), com RNG próprio por evento: o `game` só diz o que
// aconteceu e onde.

export const FX_KIND = {
  none: 0,
  /** Clarão do cano (sprite aditivo de 2 frames + luz ambiente da vista sobe; `ownerSlot` ≥ 0 = viewmodel). */
  muzzleFlash: 1,
  /** Traçante: quad aditivo esticado de (x0,y0,z0) a (x1,y1,z1). */
  tracer: 2,
  /** Tiro no cenário: cubinhos da cor do texel (bloco + face + ponto), poeira e marca de tiro. */
  impactBlock: 3,
  /** Tiro em bobo/zumbi: cubinhos da cor do texel da skin na parte atingida (o ator é achado pela entidade). */
  impactActor: 4,
  /** Tiro em prop: cubinhos na `debrisColor` do modelo. */
  impactProp: 5,
  /** Cubinhos de cor explícita (cápsula dourada, confete). */
  debris: 6,
  /** Morte: o boneco se desmonta (6 corpos Verlet contra a grade, somem em 4 s) + "poof" de confete. */
  death: 7,
  /** M2: explosão (foguete, granada): clarão, bola de fogo, faíscas, fumaça e cubinhos, no tamanho do raio. */
  explosion: 8,
  /** M2: rastro do foguete em voo (fumacinha + chama), um por projétil por frame. */
  trail: 9,
} as const;
export type FxKind = (typeof FX_KIND)[keyof typeof FX_KIND];

/** Floats por pedido em `FxQueue.data`. */
export const FX_STRIDE = 16;

/**
 * Pedidos de VFX do frame em SoA. `data[i·16 + k]` por tipo (os campos não citados ficam 0):
 * - muzzleFlash: 0–2 boca do cano (m), 3–5 direção, 6 slot local dono (-1 = ninguém), 7 modelo da arma
 * - tracer: 0–2 início, 3–5 fim
 * - impactBlock: 0–2 ponto, 3–5 normal, 6 id local do bloco, 7 face (`NORMAL_TABLE`), 8 cubinhos
 * - impactActor: 0–2 ponto, 3–5 direção do tiro, 6 osso atingido (`FigurePart`, 0..11), 7 cubinhos; `entity` = alvo
 * - impactProp: 0–2 ponto, 3–5 normal, 6 prop atingida (índice em `RenderMap.props` = ordem do `.bfmap`; o `game`
 *   resolve `StaticColliders.owner[ImpactEvent.prop]`), 7 cubinhos
 * - debris: 0–2 ponto, 3–5 velocidade (m/s), 6 cor 0xRRGGBB (exata em float32), 7 cubinhos, 8 espalhamento (m/s)
 * - death: 0–2 pés (m), 3 yaw, 4–6 direção do golpe, 7 força (m/s), 8 osso do golpe final, 9 camada da skin,
 *   10 escala, 11 `ACTOR_KIND`, 12 gabarito do boneco (`ActorBuffer.figure`; 255 = nenhum); `entity` = vítima
 * - explosion (M2): 0–2 centro (m), 3 raio (m)
 * - trail (M2): 0–2 posição (m), 3–5 direção de voo (unitária; a fumaça sai para trás)
 */
export interface FxQueue {
  readonly capacity: number;
  count: number;
  readonly kind: Uint8Array;
  readonly entity: Uint32Array;
  readonly data: Float32Array;
}

export function createFxQueue(capacity = 256): FxQueue {
  return {
    capacity,
    count: 0,
    kind: new Uint8Array(capacity),
    entity: new Uint32Array(capacity),
    data: new Float32Array(capacity * FX_STRIDE),
  };
}

/** Esvazia (o `game` chama depois do `submitFx`, ou no começo do frame). */
export function resetFxQueue(q: FxQueue): void {
  q.count = 0;
}

/** Reserva um pedido; devolve o deslocamento em `data` ou -1 se a fila encheu (o pedido é descartado). */
function slot(q: FxQueue, kind: FxKind, entity: number): number {
  if (q.count >= q.capacity) return -1;
  const i = q.count++;
  q.kind[i] = kind;
  q.entity[i] = entity >>> 0;
  const o = i * FX_STRIDE;
  q.data.fill(0, o, o + FX_STRIDE);
  return o;
}

function put3(d: Float32Array, o: number, a: number, b: number, c: number): void {
  d[o] = a;
  d[o + 1] = b;
  d[o + 2] = c;
}

export function pushMuzzleFlash(
  q: FxQueue,
  entity: number,
  x: number,
  y: number,
  z: number,
  dirX: number,
  dirY: number,
  dirZ: number,
  ownerSlot: number,
  weaponModel: number,
): boolean {
  const o = slot(q, FX_KIND.muzzleFlash, entity);
  if (o < 0) return false;
  put3(q.data, o, x, y, z);
  put3(q.data, o + 3, dirX, dirY, dirZ);
  q.data[o + 6] = ownerSlot;
  q.data[o + 7] = weaponModel;
  return true;
}

export function pushTracer(
  q: FxQueue,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
): boolean {
  const o = slot(q, FX_KIND.tracer, 0);
  if (o < 0) return false;
  put3(q.data, o, x0, y0, z0);
  put3(q.data, o + 3, x1, y1, z1);
  return true;
}

export function pushBlockImpact(
  q: FxQueue,
  x: number,
  y: number,
  z: number,
  nx: number,
  ny: number,
  nz: number,
  block: number,
  face: number,
  cubes: number,
): boolean {
  const o = slot(q, FX_KIND.impactBlock, 0);
  if (o < 0) return false;
  put3(q.data, o, x, y, z);
  put3(q.data, o + 3, nx, ny, nz);
  q.data[o + 6] = block;
  q.data[o + 7] = face;
  q.data[o + 8] = cubes;
  return true;
}

export function pushActorImpact(
  q: FxQueue,
  target: number,
  x: number,
  y: number,
  z: number,
  dirX: number,
  dirY: number,
  dirZ: number,
  bodyPart: number,
  cubes: number,
): boolean {
  const o = slot(q, FX_KIND.impactActor, target);
  if (o < 0) return false;
  put3(q.data, o, x, y, z);
  put3(q.data, o + 3, dirX, dirY, dirZ);
  q.data[o + 6] = bodyPart;
  q.data[o + 7] = cubes;
  return true;
}

export function pushPropImpact(
  q: FxQueue,
  x: number,
  y: number,
  z: number,
  nx: number,
  ny: number,
  nz: number,
  prop: number,
  cubes: number,
): boolean {
  const o = slot(q, FX_KIND.impactProp, 0);
  if (o < 0) return false;
  put3(q.data, o, x, y, z);
  put3(q.data, o + 3, nx, ny, nz);
  q.data[o + 6] = prop;
  q.data[o + 7] = cubes;
  return true;
}

export function pushDebris(
  q: FxQueue,
  x: number,
  y: number,
  z: number,
  vx: number,
  vy: number,
  vz: number,
  color: number,
  cubes: number,
  spread: number,
): boolean {
  const o = slot(q, FX_KIND.debris, 0);
  if (o < 0) return false;
  put3(q.data, o, x, y, z);
  put3(q.data, o + 3, vx, vy, vz);
  q.data[o + 6] = color & 0xffffff;
  q.data[o + 7] = cubes;
  q.data[o + 8] = spread;
  return true;
}

/** Dados do bobo que se desmonta (o render não precisa achar o ator: ele pode já ter saído do `ActorBuffer`). */
export interface FxDeath {
  readonly victim: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly dirX: number;
  readonly dirY: number;
  readonly dirZ: number;
  readonly force: number;
  /** Osso do golpe final (`FigurePart`, 0..11). */
  readonly bodyPart: number;
  readonly skin: number;
  readonly scale: number;
  readonly kind: number;
  /** Gabarito do boneco que se desmonta (#56; o mesmo índice de `ActorBuffer.figure`, 255 = `NO_FIGURE`, nenhum). */
  readonly figure: number;
}

/** Pede o desmonte. `d` pode ser um objeto de rascunho reaproveitado (não é guardado). */
export function pushDeath(q: FxQueue, d: Readonly<FxDeath>): boolean {
  const o = slot(q, FX_KIND.death, d.victim);
  if (o < 0) return false;
  const a = q.data;
  put3(a, o, d.x, d.y, d.z);
  a[o + 3] = d.yaw;
  put3(a, o + 4, d.dirX, d.dirY, d.dirZ);
  a[o + 7] = d.force;
  a[o + 8] = d.bodyPart;
  a[o + 9] = d.skin;
  a[o + 10] = d.scale;
  a[o + 11] = d.kind;
  a[o + 12] = d.figure;
  return true;
}

/** M2: explosão de raio `radius` (m) em (x, y, z). */
export function pushExplosion(q: FxQueue, x: number, y: number, z: number, radius: number): boolean {
  const o = slot(q, FX_KIND.explosion, 0);
  if (o < 0) return false;
  put3(q.data, o, x, y, z);
  q.data[o + 3] = radius;
  return true;
}

/** M2: rastro do foguete em (x, y, z), voando em (dirX, dirY, dirZ). */
export function pushTrail(
  q: FxQueue,
  x: number,
  y: number,
  z: number,
  dirX: number,
  dirY: number,
  dirZ: number,
): boolean {
  const o = slot(q, FX_KIND.trail, 0);
  if (o < 0) return false;
  put3(q.data, o, x, y, z);
  put3(q.data, o + 3, dirX, dirY, dirZ);
  return true;
}
