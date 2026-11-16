import { i16ToPitch, TAU } from '@boboforces/shared';
import { ENTITY_FLAG, type SimView } from '@boboforces/sim';
import type { NetFrame } from './frame.ts';
import { ENTITY_GROUP_START, ENTITY_GROUPS, ENTITY_SLOTS, PROJECTILE_FIELDS, PROJECTILE_SLOTS } from './schema.ts';

/**
 * O que o cliente mostra (M5 fase 2b/2c). Os outros bonecos ficam 100 ms atrás, entre os dois snapshots em volta do
 * "tick mostrado" (os discretos, como vida e flags, são do snapshot de antes, junto com os eventos). O próprio boneco
 * é o previsto (posição, mira e o movimento) com o resto do snapshot mais novo (vida, arma, munição, placar).
 */

const POS = ENTITY_GROUP_START[0]!;
const AIM = ENTITY_GROUP_START[1]!;
const VEL = ENTITY_GROUP_START[2]!;
/** O grupo "core" começa por `alive` e `generation`. */
const ALIVE = ENTITY_GROUP_START[4]!;
const POS_SCALE = ENTITY_GROUPS[0]!.fields[0]!.scale;
const VEL_SCALE = ENTITY_GROUPS[2]!.fields[0]!.scale;
const PROJ_POS = PROJECTILE_SLOTS.fieldStart[PROJECTILE_FIELDS.findIndex((f) => f.name === 'position')]!;
/** Teleporte (respawn): sem deslizar o caminho todo (cm²). */
const SNAP_CM2 = 300 * 300;
/** Bits de movimento que o cliente prevê (o resto das flags vem do host). */
export const PREDICTED_FLAGS =
  ENTITY_FLAG.onGround | ENTITY_FLAG.crouching | ENTITY_FLAG.sprinting | ENTITY_FLAG.sliding | ENTITY_FLAG.ads;

function lerpYaw(qa: number, qb: number, t: number): number {
  const d = ((qb - qa + 32768) & 0xffff) - 32768;
  const q = (((qa + d * t) % 65536) + 65536) % 65536;
  return (q * TAU) / 65536;
}

/**
 * Escreve na view os bonecos (menos `skip`) e projéteis entre `a` e `b` na fração `t`; `b` nulo = parado em `a`. O
 * `prev*` fica igual ao atual (o `alpha` do render é o do próprio boneco).
 */
export function interpolate(a: NetFrame, b: NetFrame | null, t: number, view: SimView, skip: number): void {
  const n = ENTITY_SLOTS.count;
  const count = Math.min(a.count, view.count);
  for (let e = 0; e < count; e++) {
    if (e === skip) continue;
    const oa = e * n;
    const ob = e * n;
    let tt = t;
    if (
      b === null ||
      e >= b.count ||
      a.ent[oa + ALIVE] !== 1 ||
      b.ent[ob + ALIVE] !== 1 ||
      a.ent[oa + ALIVE + 1] !== b.ent[ob + ALIVE + 1]
    ) {
      tt = 0;
    } else {
      const dx = b.ent[ob + POS]! - a.ent[oa + POS]!;
      const dy = b.ent[ob + POS + 1]! - a.ent[oa + POS + 1]!;
      const dz = b.ent[ob + POS + 2]! - a.ent[oa + POS + 2]!;
      if (dx * dx + dy * dy + dz * dz > SNAP_CM2) tt = 0;
    }
    const bf = tt === 0 ? a : b!;
    const e3 = e * 3;
    for (let k = 0; k < 3; k++) {
      const pa = a.ent[oa + POS + k]!;
      const p = (pa + (bf.ent[ob + POS + k]! - pa) * tt) / POS_SCALE;
      view.position[e3 + k] = p;
      view.prevPosition[e3 + k] = p;
      const va = a.ent[oa + VEL + k]!;
      view.velocity[e3 + k] = (va + (bf.ent[ob + VEL + k]! - va) * tt) / VEL_SCALE;
    }
    const yaw = lerpYaw(a.ent[oa + AIM]!, bf.ent[ob + AIM]!, tt);
    const pa = a.ent[oa + AIM + 1]!;
    const pitch = i16ToPitch(pa + (bf.ent[ob + AIM + 1]! - pa) * tt);
    view.yaw[e] = yaw;
    view.prevYaw[e] = yaw;
    view.pitch[e] = pitch;
    view.prevPitch[e] = pitch;
  }
  const pv = view.projectiles;
  const pn = PROJECTILE_SLOTS.count;
  const pcount = Math.min(a.projCount, pv.count);
  for (let p = 0; p < pcount; p++) {
    const o = p * pn;
    const both = b !== null && p < b.projCount && a.proj[o] === 1 && b.proj[o] === 1;
    const p3 = p * 3;
    for (let k = 0; k < 3; k++) {
      const qa = a.proj[o + PROJ_POS + k]!;
      const q = both ? qa + (b.proj[o + PROJ_POS + k]! - qa) * t : qa;
      pv.position[p3 + k] = q / POS_SCALE;
      pv.prevPosition[p3 + k] = q / POS_SCALE;
    }
  }
}

/** Guarda e devolve o que o `applyFrame` (atrasado) escreveria por cima do próprio boneco previsto. */
export class OwnView {
  private readonly pos = new Float64Array(9);
  private readonly aim = new Float64Array(4);
  private flags = 0;

  save(view: SimView, e: number): void {
    const e3 = e * 3;
    for (let k = 0; k < 3; k++) {
      this.pos[k] = view.position[e3 + k]!;
      this.pos[3 + k] = view.prevPosition[e3 + k]!;
      this.pos[6 + k] = view.velocity[e3 + k]!;
    }
    this.aim[0] = view.yaw[e]!;
    this.aim[1] = view.prevYaw[e]!;
    this.aim[2] = view.pitch[e]!;
    this.aim[3] = view.prevPitch[e]!;
    this.flags = view.flags[e]!;
  }

  restore(view: SimView, e: number): void {
    const e3 = e * 3;
    for (let k = 0; k < 3; k++) {
      view.position[e3 + k] = this.pos[k]!;
      view.prevPosition[e3 + k] = this.pos[3 + k]!;
      view.velocity[e3 + k] = this.pos[6 + k]!;
    }
    view.yaw[e] = this.aim[0]!;
    view.prevYaw[e] = this.aim[1]!;
    view.pitch[e] = this.aim[2]!;
    view.prevPitch[e] = this.aim[3]!;
    view.flags[e] = this.flags;
  }
}

/**
 * O próprio boneco com o snapshot mais novo em tudo o que não é movimento (vida, arma, munição, placar, caído…); nas
 * flags, os bits de movimento continuam os previstos.
 */
export function patchOwn(newest: NetFrame, view: SimView, e: number): void {
  if (e >= newest.count) return;
  const n = ENTITY_SLOTS.count;
  const o = e * n;
  const predicted = view.flags[e]! & PREDICTED_FLAGS;
  for (let gi = 3; gi < ENTITY_GROUPS.length; gi++) {
    let j = ENTITY_GROUP_START[gi]!;
    for (const field of ENTITY_GROUPS[gi]!.fields) {
      for (let k = 0; k < field.stride; k++, j++) field.write(view, e * field.stride + k, newest.ent[o + j]!);
    }
  }
  view.flags[e] = (view.flags[e]! & ~PREDICTED_FLAGS) | predicted;
}
