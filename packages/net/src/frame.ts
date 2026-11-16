import {
  MAX_ENTITIES,
  MAX_PICKUPS,
  MAX_PROJECTILES,
  type Sim,
  type SimRemoteState,
  type SimView,
} from '@boboforces/sim';
import { NO_TICK } from './protocol.ts';
import { ENTITY_SLOTS, fitCodec, PICKUP_SLOTS, PROJECTILE_SLOTS, type NetLayout, type SlotTable } from './schema.ts';

/**
 * Um snapshot quantizado: tudo o que viaja, em inteiros, na ordem do schema. O host guarda uma fila deles (a base do
 * delta de cada cliente é um destes) e o cliente reconstrói exatamente os mesmos inteiros. Invariante: os itens de
 * índice ≥ `count` (e ≥ `projCount`, ≥ `pickCount`) estão zerados, então "não existe" e "zerado" são a mesma base.
 */
export class NetFrame {
  tick = NO_TICK;
  count = 0;
  projCount = 0;
  pickCount = 0;
  ent: Int32Array = new Int32Array(0);
  proj: Int32Array = new Int32Array(0);
  pick: Int32Array = new Int32Array(0);
  readonly glob: Int32Array;

  constructor(layout: NetLayout) {
    this.glob = new Int32Array(layout.globals.length);
  }
}

/** Garante espaço para `n` itens de `slots` componentes (cresce em potência de 2; raro, fora do regime). */
function grow(a: Int32Array, n: number, slots: number): Int32Array {
  if (a.length >= n * slots) return a;
  let cap = 16;
  while (cap < n) cap *= 2;
  const out = new Int32Array(cap * slots);
  out.set(a);
  return out;
}

export function ensureEntities(f: NetFrame, n: number): void {
  f.ent = grow(f.ent, n, ENTITY_SLOTS.count);
}
export function ensureProjectiles(f: NetFrame, n: number): void {
  f.proj = grow(f.proj, n, PROJECTILE_SLOTS.count);
}
export function ensurePickups(f: NetFrame, n: number): void {
  f.pick = grow(f.pick, n, PICKUP_SLOTS.count);
}

type NumArray = Float64Array | Float32Array | Int32Array | Uint32Array | Int16Array | Uint16Array | Uint8Array;

/** Lê uma coluna quantizada e limitada (um laço por tipo de array, como `writeColumn`). */
function readColumn(
  arr: NumArray,
  out: Int32Array,
  n: number,
  s0: number,
  stride: number,
  count: number,
  scale: number,
  lo: number,
  hi: number,
): void {
  if (scale !== 0) {
    if (arr instanceof Float64Array) {
      for (let it = 0; it < count; it++) {
        for (let k = 0; k < stride; k++) {
          const q = Math.round(arr[it * stride + k]! * scale);
          out[it * n + s0 + k] = q > hi ? hi : q < lo ? lo : q;
        }
      }
    } else {
      for (let it = 0; it < count; it++) {
        for (let k = 0; k < stride; k++) {
          const q = Math.round(arr[it * stride + k]! * scale);
          out[it * n + s0 + k] = q > hi ? hi : q < lo ? lo : q;
        }
      }
    }
    return;
  }
  // Inteiros: o Int32Array guarda o u32 na representação de Int32 (o `fitCodec` faz igual).
  if (arr instanceof Uint8Array) {
    for (let it = 0; it < count; it++) {
      for (let k = 0; k < stride; k++) {
        const q = arr[it * stride + k]!;
        out[it * n + s0 + k] = q > hi ? hi : q;
      }
    }
  } else if (arr instanceof Uint16Array) {
    for (let it = 0; it < count; it++) {
      for (let k = 0; k < stride; k++) {
        const q = arr[it * stride + k]!;
        out[it * n + s0 + k] = q > hi ? hi : q;
      }
    }
  } else if (arr instanceof Int32Array) {
    for (let it = 0; it < count; it++) {
      for (let k = 0; k < stride; k++) {
        const q = arr[it * stride + k]!;
        out[it * n + s0 + k] = q > hi ? hi : q < lo ? lo : q;
      }
    }
  } else {
    for (let it = 0; it < count; it++) {
      for (let k = 0; k < stride; k++) {
        const q = arr[it * stride + k]!;
        out[it * n + s0 + k] = q > hi ? hi : q < lo ? lo : q;
      }
    }
  }
}

/**
 * Quantiza os itens [0, count) campo a campo (o mesmo array em todo o laço interno; os campos com `array` nem chamam
 * função). Limita à faixa do codec como o `fitCodec`: o Int32Array guarda o u32 na representação de Int32 e NaN vira 0.
 */
function capturePool<V>(view: V, table: SlotTable<V>, out: Int32Array, count: number): void {
  const n = table.count;
  for (let fi = 0; fi < table.fields.length; fi++) {
    const field = table.fields[fi]!;
    const s0 = table.fieldStart[fi]!;
    const stride = field.stride;
    const lo = table.lo[s0]!;
    const hi = table.hi[s0]!;
    const scale = field.scale;
    const arr = field.array === null ? null : field.array(view);
    if (arr !== null) {
      readColumn(arr, out, n, s0, stride, count, scale, lo, hi);
      continue;
    }
    for (let item = 0; item < count; item++) {
      for (let k = 0; k < stride; k++) {
        const q = field.read(view, item * stride + k);
        out[item * n + s0 + k] = q > hi ? hi : q < lo ? lo : q;
      }
    }
  }
}

/** Host: quantiza a view no `frame` (reaproveitado da fila). */
export function captureFrame(layout: NetLayout, view: SimView, frame: NetFrame): void {
  const count = view.count;
  const projCount = view.projectiles.count;
  const pickCount = view.pickups.count;
  ensureEntities(frame, count);
  ensureProjectiles(frame, projCount);
  ensurePickups(frame, pickCount);
  capturePool(view, ENTITY_SLOTS, frame.ent, count);
  if (frame.count > count) frame.ent.fill(0, count * ENTITY_SLOTS.count, frame.count * ENTITY_SLOTS.count);
  capturePool(view.projectiles, PROJECTILE_SLOTS, frame.proj, projCount);
  if (frame.projCount > projCount) {
    frame.proj.fill(0, projCount * PROJECTILE_SLOTS.count, frame.projCount * PROJECTILE_SLOTS.count);
  }
  capturePool(view.pickups, PICKUP_SLOTS, frame.pick, pickCount);
  if (frame.pickCount > pickCount) {
    frame.pick.fill(0, pickCount * PICKUP_SLOTS.count, frame.pickCount * PICKUP_SLOTS.count);
  }
  const globals = layout.globals;
  for (let k = 0; k < globals.length; k++) frame.glob[k] = fitCodec(globals[k]!.read(view), globals[k]!.codec);
  frame.tick = view.tick;
  frame.count = count;
  frame.projCount = projCount;
  frame.pickCount = pickCount;
}

/** `dst` = `src` (mantém a invariante dos zeros). */
export function copyFrame(dst: NetFrame, src: NetFrame): void {
  copyPool(dst, src, 'ent', ENTITY_SLOTS.count, dst.count, src.count);
  copyPool(dst, src, 'proj', PROJECTILE_SLOTS.count, dst.projCount, src.projCount);
  copyPool(dst, src, 'pick', PICKUP_SLOTS.count, dst.pickCount, src.pickCount);
  dst.glob.set(src.glob);
  dst.tick = src.tick;
  dst.count = src.count;
  dst.projCount = src.projCount;
  dst.pickCount = src.pickCount;
}

function copyPool(
  dst: NetFrame,
  src: NetFrame,
  key: 'ent' | 'proj' | 'pick',
  slots: number,
  dstCount: number,
  srcCount: number,
): void {
  dst[key] = grow(dst[key], srcCount, slots);
  dst[key].set(src[key].subarray(0, srcCount * slots));
  if (dstCount > srcCount) dst[key].fill(0, srcCount * slots, dstCount * slots);
}

/** Zera tudo (a base de um snapshot completo). */
export function clearFrame(f: NetFrame): void {
  f.ent.fill(0, 0, f.count * ENTITY_SLOTS.count);
  f.proj.fill(0, 0, f.projCount * PROJECTILE_SLOTS.count);
  f.pick.fill(0, 0, f.pickCount * PICKUP_SLOTS.count);
  f.glob.fill(0);
  f.tick = NO_TICK;
  f.count = 0;
  f.projCount = 0;
  f.pickCount = 0;
}

/** Componentes iguais (testes e o relatório do loopback). */
export function framesEqual(a: NetFrame, b: NetFrame): boolean {
  if (a.tick !== b.tick || a.count !== b.count || a.projCount !== b.projCount || a.pickCount !== b.pickCount) {
    return false;
  }
  const same = (x: Int32Array, y: Int32Array, n: number): boolean => {
    for (let i = 0; i < n; i++) if (x[i] !== y[i]) return false;
    return true;
  };
  return (
    same(a.ent, b.ent, a.count * ENTITY_SLOTS.count) &&
    same(a.proj, b.proj, a.projCount * PROJECTILE_SLOTS.count) &&
    same(a.pick, b.pick, a.pickCount * PICKUP_SLOTS.count) &&
    same(a.glob, b.glob, a.glob.length)
  );
}

/**
 * Acima disto, de um snapshot para o outro, o item não anda: teleportou (respawn) e o render não deve deslizar o
 * caminho todo. Um bobo correndo anda ~0,25 m entre dois snapshots a 30 Hz; um foguete, ~1,5 m.
 */
const SNAP_M2 = 3 * 3;

/** Rascunho: o "quem era" de cada item antes de escrever (geração + 1 da entidade, ou 1 = vivo). */
const before = new Uint32Array(Math.max(MAX_ENTITIES, MAX_PROJECTILES, MAX_PICKUPS));

/** Marca em `before` quem existia (`alive`) e com qual geração (0 = não existia). */
function markBefore(alive: Uint8Array, generation: Uint16Array | null, count: number, upTo: number): void {
  for (let i = 0; i < upTo; i++) before[i] = i < count && alive[i] === 1 ? (generation ? generation[i]! + 1 : 1) : 0;
}

/**
 * Escreve uma coluna (um campo de todos os itens). Um laço por tipo de array: num laço só, a escrita vê 7 tipos e fica
 * megamórfica (~3× mais lenta no V8, medido no `local/m5/medir-rede`).
 */
function writeColumn(
  arr: NumArray,
  data: Int32Array,
  n: number,
  s0: number,
  stride: number,
  count: number,
  scale: number,
): void {
  const div = scale === 0 ? 1 : scale;
  if (arr instanceof Float64Array) {
    for (let it = 0; it < count; it++)
      for (let k = 0; k < stride; k++) arr[it * stride + k] = data[it * n + s0 + k]! / div;
  } else if (arr instanceof Float32Array) {
    for (let it = 0; it < count; it++)
      for (let k = 0; k < stride; k++) arr[it * stride + k] = data[it * n + s0 + k]! / div;
  } else if (arr instanceof Uint8Array) {
    for (let it = 0; it < count; it++) for (let k = 0; k < stride; k++) arr[it * stride + k] = data[it * n + s0 + k]!;
  } else if (arr instanceof Uint16Array) {
    for (let it = 0; it < count; it++) for (let k = 0; k < stride; k++) arr[it * stride + k] = data[it * n + s0 + k]!;
  } else if (arr instanceof Int16Array) {
    for (let it = 0; it < count; it++) for (let k = 0; k < stride; k++) arr[it * stride + k] = data[it * n + s0 + k]!;
  } else if (arr instanceof Int32Array) {
    for (let it = 0; it < count; it++) for (let k = 0; k < stride; k++) arr[it * stride + k] = data[it * n + s0 + k]!;
  } else {
    for (let it = 0; it < count; it++) for (let k = 0; k < stride; k++) arr[it * stride + k] = data[it * n + s0 + k]!;
  }
}

function applyPool<V>(
  view: V,
  table: SlotTable<V>,
  data: Int32Array,
  count: number,
  alive: Uint8Array,
  generation: Uint16Array | null,
  position: Float64Array,
  prevPosition: Float64Array,
  yaw: Float64Array | null,
): void {
  const n = table.count;
  // Escreve campo a campo (como a captura) e depois decide, item a item, quem não interpola.
  for (let fi = 0; fi < table.fields.length; fi++) {
    const field = table.fields[fi]!;
    const s0 = table.fieldStart[fi]!;
    const stride = field.stride;
    const scale = field.scale;
    const arr = field.array === null ? null : field.array(view);
    if (arr !== null) {
      writeColumn(arr, data, n, s0, stride, count, scale);
      continue;
    }
    for (let item = 0; item < count; item++) {
      for (let k = 0; k < stride; k++) field.write(view, item * stride + k, data[item * n + s0 + k]!);
    }
  }
  for (let item = 0; item < count; item++) {
    const now = alive[item] === 1 ? (generation ? generation[item]! + 1 : 1) : 0;
    const p = item * 3;
    const dx = position[p]! - prevPosition[p]!;
    const dy = position[p + 1]! - prevPosition[p + 1]!;
    const dz = position[p + 2]! - prevPosition[p + 2]!;
    // Nasceu agora (ou o slot foi reaproveitado) ou teleportou: sem interpolar de onde estava.
    if (now !== before[item] || dx * dx + dy * dy + dz * dz > SNAP_M2) {
      prevPosition[p] = position[p]!;
      prevPosition[p + 1] = position[p + 1]!;
      prevPosition[p + 2] = position[p + 2]!;
      if (yaw !== null) snapAim[item] = 1;
    }
  }
}

/** Rascunho: entidades cuja mira também não interpola neste snapshot. */
const snapAim = new Uint8Array(MAX_ENTITIES);

/**
 * Cliente: escreve o snapshot na sim dele (`sim.remote`). O estado atual vira o `prev*` (o render interpola do
 * snapshot anterior para este); quem nasceu ou teleportou não desliza. `state` é rascunho de quem chama (sem alocar).
 */
export function applyFrame(layout: NetLayout, frame: NetFrame, sim: Sim, state: SimRemoteState): void {
  const view = sim.view();
  sim.remote.begin();
  markBefore(view.alive, view.generation, view.count, frame.count);
  snapAim.fill(0, 0, frame.count);
  applyPool(
    view,
    ENTITY_SLOTS,
    frame.ent,
    frame.count,
    view.alive,
    view.generation,
    view.position,
    view.prevPosition,
    view.yaw,
  );
  for (let e = 0; e < frame.count; e++) {
    if (snapAim[e] === 1) {
      view.prevYaw[e] = view.yaw[e]!;
      view.prevPitch[e] = view.pitch[e]!;
    }
  }
  const pv = view.projectiles;
  markBefore(pv.alive, null, pv.count, frame.projCount);
  applyPool(pv, PROJECTILE_SLOTS, frame.proj, frame.projCount, pv.alive, null, pv.position, pv.prevPosition, null);
  const kv = view.pickups;
  markBefore(kv.alive, null, kv.count, frame.pickCount);
  applyPool(kv, PICKUP_SLOTS, frame.pick, frame.pickCount, kv.alive, null, kv.position, kv.prevPosition, null);
  state.tick = frame.tick;
  state.count = frame.count;
  state.projCount = frame.projCount;
  state.pickCount = frame.pickCount;
  const globals = layout.globals;
  for (let k = 0; k < globals.length; k++) {
    const gs = globals[k]!;
    const q = frame.glob[k]!;
    gs.write(view, state, gs.codec.signed ? q : q >>> 0);
  }
  sim.remote.commit(state);
}

/** Rascunho do estado remoto (um por cliente). */
export function createRemoteState(): SimRemoteState {
  return {
    tick: 0,
    count: 0,
    projCount: 0,
    pickCount: 0,
    phase: 'playing',
    ticksLeft: -1,
    countdownTicks: 0,
    winnerTeam: -1,
    winnerEntity: 0,
    zombieWave: 0,
    zombiesLeft: 0,
    zombieRestTicks: -1,
    doublePointsTicks: 0,
    instaKillTicks: 0,
    lastZombie: 0,
    selfRevivesLeft: 0,
  };
}
