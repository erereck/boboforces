import type { SimContext } from '../context.ts';
import { ENTITY_FLAG, ENTITY_KIND } from '../entity.ts';
import { finishMatch, respawn } from './life.ts';
import { juggRoundReset, juggRoundStart, juggRoundWinner } from './party.ts';

/**
 * M7 (fase 0): o motor de rodadas (o BoboStrike e o Juggernaut Fixo). Cada rodada começa com todo mundo de volta ao
 * spawn, com a vida cheia, e passa por três fases:
 * - **compra** (`buy`): ninguém anda nem atira (dá para olhar e, no BoboStrike, comprar);
 * - **valendo** (`live`): o modo decide quem venceu a rodada (o Jugg caiu, um time foi eliminado); no fim do tempo,
 *   vale o vencedor do tempo do modo;
 * - **fim** (`over`): a pausa com o resultado (ninguém anda nem atira); depois, a próxima rodada ou o fim da partida.
 * A partida acaba quando um time faz `winRounds` (se houver) ou depois de `totalRounds` (se houver); a troca de lado é
 * depois da rodada `swapAfter`. O estado inteiro mora em `data` (hash, snapshot e rede).
 */
export const ROUND_PHASE = { buy: 0, live: 1, over: 2 } as const;

/** Os índices de `RoundState.data`. */
export const ROUND = { round: 0, phase: 1, ticks: 2, wins0: 3, wins1: 4, swapped: 5, winner: 6 } as const;
export const ROUND_FIELDS = 7;
/** O vencedor da rodada ainda não saiu. */
export const ROUND_UNDECIDED = -2;

export interface RoundRules {
  readonly buyTicks: number;
  readonly liveTicks: number;
  readonly overTicks: number;
  /** Rodadas para vencer a partida (0 = joga `totalRounds`). */
  readonly winRounds: number;
  /** Teto de rodadas (0 = até alguém fazer `winRounds`). */
  readonly totalRounds: number;
  /** Troca de lado depois desta rodada (0 = nunca). */
  readonly swapAfter: number;
  /** Quem morre renasce dentro da rodada (o Jugg Fixo); sem isso, espera a próxima. */
  readonly respawn: boolean;
}

export interface RoundState {
  readonly rules: RoundRules;
  /** Rodada (1..; 0 = antes da 1ª), fase, ticks na fase, vitórias dos times 0 e 1, lados trocados e o vencedor. */
  readonly data: Int32Array;
}

export function createRoundState(rules: RoundRules): RoundState {
  const data = new Int32Array(ROUND_FIELDS);
  data[ROUND.winner] = ROUND_UNDECIDED;
  return { rules, data };
}

/** Ninguém anda nem atira (a compra e a pausa do fim da rodada). */
export function roundFrozen(ctx: SimContext): boolean {
  const r = ctx.rounds;
  // Antes da 1ª rodada a fase é a compra (zero): congela desde o 1º tick valendo.
  return r !== null && r.data[ROUND.phase] !== ROUND_PHASE.live;
}

/** A rodada está valendo (fora dela, os modos não pontuam). */
export function roundLive(ctx: SimContext): boolean {
  const r = ctx.rounds;
  return r === null || (r.data[ROUND.round]! > 0 && r.data[ROUND.phase] === ROUND_PHASE.live);
}

/** O passo das rodadas (depois dos modos, antes das regras do placar). */
export function roundsSystem(ctx: SimContext): void {
  const st = ctx.rounds;
  if (st === null || ctx.match.phase !== 'playing') return;
  const d = st.data;
  const rules = st.rules;
  if (d[ROUND.round] === 0) {
    startRound(ctx);
    return;
  }
  if (d[ROUND.ticks]! > 0) d[ROUND.ticks] = d[ROUND.ticks]! - 1;
  const phase = d[ROUND.phase];
  if (phase === ROUND_PHASE.buy) {
    if (d[ROUND.ticks] === 0) {
      d[ROUND.phase] = ROUND_PHASE.live;
      d[ROUND.ticks] = rules.liveTicks;
    }
    return;
  }
  if (phase === ROUND_PHASE.live) {
    let w = roundWinner(ctx);
    if (w === ROUND_UNDECIDED && d[ROUND.ticks] === 0) w = timeWinner(ctx);
    if (w !== ROUND_UNDECIDED) endRound(ctx, w);
    return;
  }
  if (d[ROUND.ticks]! > 0) return;
  const round = d[ROUND.round]!;
  const won = rules.winRounds > 0 && Math.max(d[ROUND.wins0]!, d[ROUND.wins1]!) >= rules.winRounds;
  if (won || (rules.totalRounds > 0 && round >= rules.totalRounds)) {
    finishMatch(ctx);
    return;
  }
  if (rules.swapAfter > 0 && round === rules.swapAfter) d[ROUND.swapped] = d[ROUND.swapped]! ^ 1;
  startRound(ctx);
}

/** A próxima rodada: todo mundo de volta ao spawn (com a vida cheia) e o modo arruma os papéis. */
function startRound(ctx: SimContext): void {
  const st = ctx.rounds!;
  const d = st.data;
  d[ROUND.round] = d[ROUND.round]! + 1;
  d[ROUND.winner] = ROUND_UNDECIDED;
  if (ctx.party.jugg !== null) juggRoundReset(ctx);
  // Cada um num ponto diferente (todos nascem juntos: a nota do spawn não serve). No Jugg, qualquer ponto, girando
  // a cada rodada; nos times, os pontos do time.
  const s = ctx.s;
  const anyPoint = ctx.party.jugg !== null;
  const round = d[ROUND.round]!;
  let n0 = 0;
  let n1 = 0;
  let n = 0;
  for (let e = 0; e < s.count; e++) {
    if (s.alive[e] !== 1 || s.kind[e] !== ENTITY_KIND.bobo) continue;
    const team = s.team[e]!;
    const k = anyPoint ? n + round : team === 1 ? n1++ : n0++;
    n++;
    respawn(ctx, e, roundSpawn(ctx, team, k, anyPoint));
  }
  if (ctx.party.jugg !== null) juggRoundStart(ctx, d[ROUND.round]!);
  const buy = st.rules.buyTicks;
  d[ROUND.phase] = buy > 0 ? ROUND_PHASE.buy : ROUND_PHASE.live;
  d[ROUND.ticks] = buy > 0 ? buy : st.rules.liveTicks;
}

/**
 * O ponto `k` (girando) para quem nasce na largada da rodada: os do time (sem nenhum, os sem time; sem esses, todos);
 * com `anyPoint`, os sem time (ou todos).
 */
function roundSpawn(ctx: SimContext, team: number, k: number, anyPoint: boolean): number {
  const sp = ctx.spawns;
  let own = 0;
  let free = 0;
  for (let i = 0; i < sp.length; i++) {
    if (!anyPoint && sp[i]!.team === team) own++;
    if (sp[i]!.team === -1) free++;
  }
  const mode = own > 0 ? 0 : free > 0 ? 1 : 2;
  const count = mode === 0 ? own : mode === 1 ? free : sp.length;
  let j = k % count;
  for (let i = 0; i < sp.length; i++) {
    const t = sp[i]!.team;
    const ok = mode === 0 ? t === team : mode === 1 ? t === -1 : true;
    if (ok && j-- === 0) return i;
  }
  return 0;
}

/** Quem venceu a rodada agora (`ROUND_UNDECIDED` = ninguém ainda): o modo, ou o time que sobrou (sem respawn). */
function roundWinner(ctx: SimContext): number {
  if (ctx.party.jugg !== null) return juggRoundWinner(ctx);
  if (ctx.rounds!.rules.respawn) return ROUND_UNDECIDED;
  const s = ctx.s;
  let alive0 = 0;
  let alive1 = 0;
  for (let e = 0; e < s.count; e++) {
    if (s.alive[e] !== 1 || s.kind[e] !== ENTITY_KIND.bobo || (s.flags[e]! & ENTITY_FLAG.dead) !== 0) continue;
    if (s.team[e] === 0) alive0++;
    else if (s.team[e] === 1) alive1++;
  }
  if (alive0 > 0 && alive1 > 0) return ROUND_UNDECIDED;
  return alive0 > 0 ? 0 : alive1 > 0 ? 1 : -1;
}

/** O vencedor quando o tempo da rodada acaba: o Jugg que aguentou (o time 1); sem regra do modo, empate. */
function timeWinner(ctx: SimContext): number {
  if (ctx.party.jugg !== null) return 1;
  return -1;
}

function endRound(ctx: SimContext, winner: number): void {
  const d = ctx.rounds!.data;
  d[ROUND.winner] = winner;
  if (winner === 0) d[ROUND.wins0] = d[ROUND.wins0]! + 1;
  else if (winner === 1) d[ROUND.wins1] = d[ROUND.wins1]! + 1;
  ctx.match.teamScore[0] = d[ROUND.wins0]!;
  ctx.match.teamScore[1] = d[ROUND.wins1]!;
  d[ROUND.phase] = ROUND_PHASE.over;
  d[ROUND.ticks] = ctx.rounds!.rules.overTicks;
}
