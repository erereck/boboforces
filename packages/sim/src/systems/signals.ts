import { BUTTON, frameOrder, ORDER } from '@boboforces/input';
import { BLOCK_FLAG, createRayHit, raycastGrid } from '@boboforces/world';
import type { SimContext } from '../context.ts';
import { ENTITY_FLAG, ENTITY_KIND } from '../entity.ts';
import { simEyeHeight } from '../hitbox.ts';

/**
 * M5 (fase 5d): os avisos sem texto (GDD §3.7, tecnico.md §13.5: "pings e emotes, sem chat"). O botão de aviso marca
 * o ponto onde a mira bate (para o time); o de emote mostra um dos 4 balões fixos em cima do bobo (para todos), e
 * cada aperto passa para o próximo. Passa pela sim como os outros botões: vale no sofá e no online (o evento vai aos
 * amigos como os outros). Os contadores não entram no hash nem no snapshot: só decidem quando sai um evento.
 */
export const SIGNAL_KIND = { ping: 0, firstEmote: 1, emotes: 4, firstOrder: 5 } as const;

/** Um aviso por bobo a cada tanto (apertar sem parar não enche a tela dos outros). */
export const SIGNAL_COOLDOWN_S = 0.75;
/** O ping vai até onde a mira bate, até esta distância (sem bater, fica no fim dela). */
export const PING_RANGE_M = 80;
/** Os balões saem um pouco acima da cabeça. */
const EMOTE_ABOVE_M = 0.6;

/** O estado dos avisos (fora do hash e do snapshot). */
export interface SignalState {
  readonly nextTick: Int32Array;
  readonly emote: Uint8Array;
  /** M8 (fase 6): a espera das ordens é à parte (o aviso apertado antes de abrir a roda não segura a ordem). */
  readonly orderTick: Int32Array;
}

export function createSignalState(capacity: number): SignalState {
  return { nextTick: new Int32Array(capacity), emote: new Uint8Array(capacity), orderTick: new Int32Array(capacity) };
}

const hit = createRayHit();

export function signalSystem(ctx: SimContext): void {
  const s = ctx.s;
  const st = ctx.signals;
  const cooldown = Math.max(1, Math.round(SIGNAL_COOLDOWN_S * ctx.hz));
  for (let e = 0; e < s.count; e++) {
    // M8 (fase 6): a ordem da roda (a borda do campo da ordem): o balão em cima de quem mandou e, no "Ataca ali", o
    // ping onde a mira bate. Os bots leem a ordem do frame (a IA); aqui é só o que os outros veem.
    const order = frameOrder(s.inButtons[e]!);
    if (order !== 0 && order !== frameOrder(s.prevButtons[e]!)) orderSignal(ctx, e, order);
    const pressed = s.inButtons[e]! & ~s.prevButtons[e]!;
    if ((pressed & (BUTTON.ping | BUTTON.emote)) === 0) continue;
    if (s.alive[e] === 0 || s.kind[e] !== ENTITY_KIND.bobo || (s.flags[e]! & ENTITY_FLAG.dead) !== 0) continue;
    if (ctx.tick < st.nextTick[e]!) continue;
    st.nextTick[e] = ctx.tick + cooldown;
    const e3 = e * 3;
    const x = s.position[e3]!;
    const y = s.position[e3 + 1]! + simEyeHeight(ctx, e, s.flags[e]!);
    const z = s.position[e3 + 2]!;
    if ((pressed & BUTTON.ping) !== 0) {
      pingAhead(ctx, e, x, y, z);
    } else {
      const k = SIGNAL_KIND.firstEmote + (st.emote[e]! % SIGNAL_KIND.emotes);
      st.emote[e] = (st.emote[e]! + 1) & 0xff;
      ctx.events.signal(ctx.tick, s.idOf(e), k, x, y + EMOTE_ABOVE_M, z);
    }
  }
}

/** O ping para frente da mira (yaw 0 olha para −Z; pitch positivo, para cima), até o que tapa a vista. */
function pingAhead(ctx: SimContext, e: number, x: number, y: number, z: number): void {
  const s = ctx.s;
  const yaw = s.yaw[e]!;
  const pitch = s.pitch[e]!;
  const dx = -Math.sin(yaw) * Math.cos(pitch);
  const dy = Math.sin(pitch);
  const dz = -Math.cos(yaw) * Math.cos(pitch);
  raycastGrid(ctx.grid, ctx.blocks, x, y, z, dx, dy, dz, PING_RANGE_M, BLOCK_FLAG.blocksSight, hit, ctx.colliders);
  const t = hit.hit ? hit.distance : PING_RANGE_M;
  ctx.events.signal(ctx.tick, s.idOf(e), SIGNAL_KIND.ping, x + dx * t, y + dy * t, z + dz * t);
}

/** M8 (fase 6): o balão da ordem (e o ping do "Ataca ali"), com a espera própria das ordens. */
function orderSignal(ctx: SimContext, e: number, order: number): void {
  const s = ctx.s;
  const st = ctx.signals;
  if (order > ORDER.cover) return;
  if (s.alive[e] === 0 || s.kind[e] !== ENTITY_KIND.bobo || (s.flags[e]! & ENTITY_FLAG.dead) !== 0) return;
  if (ctx.tick < st.orderTick[e]!) return;
  st.orderTick[e] = ctx.tick + Math.max(1, Math.round(SIGNAL_COOLDOWN_S * ctx.hz));
  const e3 = e * 3;
  const x = s.position[e3]!;
  const y = s.position[e3 + 1]! + simEyeHeight(ctx, e, s.flags[e]!);
  const z = s.position[e3 + 2]!;
  if (order === ORDER.attack) pingAhead(ctx, e, x, y, z);
  ctx.events.signal(ctx.tick, s.idOf(e), SIGNAL_KIND.firstOrder + order - 1, x, y + EMOTE_ABOVE_M, z);
}
