import { ENTITY_KIND, entityIndex, NULL_ENTITY, type SimEvent, type SimView } from '@boboforces/sim';

/**
 * M2 (fase 2e): as contas do resultado (gameplay.md §2.2; arte-ux.md §6). Os números saem dos EVENTOS da partida
 * (determinísticos), sem mexer no estado da sim: tiros e acertos por bobo (o chumbo da escopeta e o foguete contam um
 * tiro por tick), a maior sequência de abates sem morrer, quem mais matou você (Nêmesis), quem você mais matou
 * (Freguês), as quedas e mortes por conta própria. Puro, alocado uma vez por partida.
 */

export interface MatchStats {
  readonly capacity: number;
  readonly shots: Uint16Array;
  readonly hits: Uint16Array;
  readonly streak: Uint16Array;
  readonly bestStreak: Uint16Array;
  /** Mortes sem matador ou pela própria mão (queda, vazio, o próprio foguete). */
  readonly mishaps: Uint16Array;
  /** Último tick com tiro e com acerto de cada bobo (um por tick). */
  readonly shotTick: Int32Array;
  readonly hitTick: Int32Array;
  /** Quantas vezes cada bobo matou o humano, e quantas vezes o humano matou cada um. */
  readonly killedHuman: Uint16Array;
  readonly killedByHuman: Uint16Array;
}

export function createMatchStats(capacity: number): MatchStats {
  return {
    capacity,
    shots: new Uint16Array(capacity),
    hits: new Uint16Array(capacity),
    streak: new Uint16Array(capacity),
    bestStreak: new Uint16Array(capacity),
    mishaps: new Uint16Array(capacity),
    shotTick: new Int32Array(capacity).fill(-1),
    hitTick: new Int32Array(capacity).fill(-1),
    killedHuman: new Uint16Array(capacity),
    killedByHuman: new Uint16Array(capacity),
  };
}

/** Soma um evento da partida. `human` = a entidade do jogador (`NULL_ENTITY` sem humano). */
export function recordMatchEvent(st: MatchStats, ev: SimEvent, human: number): void {
  switch (ev.type) {
    case 'shot':
      countShot(st, ev.shooter, ev.tick);
      break;
    case 'projectile':
      if (ev.action === 'launch') countShot(st, ev.owner, ev.tick);
      break;
    case 'hit': {
      if (ev.shooter === NULL_ENTITY || ev.shooter === ev.target) break;
      const a = entityIndex(ev.shooter);
      if (a >= st.capacity || st.hitTick[a] === ev.tick) break;
      st.hitTick[a] = ev.tick;
      st.hits[a] = st.hits[a]! + 1;
      break;
    }
    case 'kill': {
      const v = entityIndex(ev.victim);
      if (v < st.capacity) st.streak[v] = 0;
      if (ev.killer === NULL_ENTITY || ev.killer === ev.victim) {
        if (v < st.capacity) st.mishaps[v] = st.mishaps[v]! + 1;
        break;
      }
      const k = entityIndex(ev.killer);
      if (k >= st.capacity) break;
      st.streak[k] = st.streak[k]! + 1;
      if (st.streak[k]! > st.bestStreak[k]!) st.bestStreak[k] = st.streak[k]!;
      if (human !== NULL_ENTITY && ev.victim === human) st.killedHuman[k] = st.killedHuman[k]! + 1;
      if (human !== NULL_ENTITY && ev.killer === human && v < st.capacity) {
        st.killedByHuman[v] = st.killedByHuman[v]! + 1;
      }
      break;
    }
    default:
      break;
  }
}

function countShot(st: MatchStats, shooter: number, tick: number): void {
  if (shooter === NULL_ENTITY) return;
  const i = entityIndex(shooter);
  if (i >= st.capacity || st.shotTick[i] === tick) return;
  st.shotTick[i] = tick;
  st.shots[i] = st.shots[i]! + 1;
}

/** Precisão (0..100, inteiro) de um bobo; -1 sem tiro. */
export function accuracyPct(st: MatchStats, i: number): number {
  const s = st.shots[i]!;
  return s === 0 ? -1 : Math.round((Math.min(st.hits[i]!, s) * 100) / s);
}

/** Prêmios bobos (arte-ux.md §6: até 3), na ordem em que entram. */
export const PRIZES = ['crookedAim', 'kamikaze', 'coward', 'waiter', 'immortal'] as const;
export type Prize = (typeof PRIZES)[number];

/** Mínimos para um prêmio valer (ninguém leva "Mira torta" com 3 tiros). */
export const PRIZE_RULES = { crookedAimMinShots: 20, waiterMinAssists: 3, immortalMinKills: 1 } as const;

export interface PrizeWinner {
  readonly prize: Prize;
  /** Índice da entidade. */
  readonly entity: number;
}

export type MatchOutcome = 'win' | 'loss' | 'draw';

/** O que a tela de resultado mostra (índices de entidade; os nomes saem da tabela do `game`). */
export interface MatchSummary {
  readonly outcome: MatchOutcome;
  /** TDM: pontos do seu time e do outro; FFA: seus abates e os do vencedor. */
  readonly ownScore: number;
  readonly otherScore: number;
  /** FFA: quem venceu (índice), -1 no empate e no TDM. */
  readonly winner: number;
  readonly mvp: number;
  /** Quem mais te matou e quantas vezes (-1/0 = ninguém). */
  readonly nemesis: number;
  readonly nemesisKills: number;
  /** Quem você mais matou e quantas vezes. */
  readonly victim: number;
  readonly victimKills: number;
  readonly kills: number;
  /** -1 = sem tiro. */
  readonly accuracy: number;
  readonly bestStreak: number;
  readonly prizes: readonly PrizeWinner[];
  /** Derrota feia (GDD §3.8): perdeu com metade ou menos dos pontos do outro lado; o foco vai para "Mais fácil". */
  readonly uglyLoss: boolean;
}

function isBobo(view: SimView, i: number): boolean {
  return view.alive[i] === 1 && view.kind[i] === ENTITY_KIND.bobo;
}

/** O bobo com a maior `score` (empate: a menor `tie`, depois o menor índice); -1 se nenhum passa no `ok`. */
function best(
  view: SimView,
  ok: (i: number) => boolean,
  score: (i: number) => number,
  tie: (i: number) => number,
): number {
  let pick = -1;
  for (let i = 0; i < view.count; i++) {
    if (!isBobo(view, i) || !ok(i)) continue;
    if (pick < 0 || score(i) > score(pick) || (score(i) === score(pick) && tie(i) < tie(pick))) pick = i;
  }
  return pick;
}

/** Monta o resumo no fim da partida. `human` = índice da entidade do jogador (-1 sem humano). */
export function summarizeMatch(st: MatchStats, view: SimView, human: number, ffa: boolean): MatchSummary {
  const m = view.match;
  let ownScore = 0;
  let otherScore = 0;
  let outcome: MatchOutcome = 'draw';
  let winner = -1;
  if (ffa) {
    winner = m.winnerEntity !== NULL_ENTITY ? entityIndex(m.winnerEntity) : -1;
    ownScore = human >= 0 ? view.kills[human]! : 0;
    otherScore = winner >= 0 ? view.kills[winner]! : 0;
    outcome = winner < 0 ? 'draw' : winner === human ? 'win' : 'loss';
  } else {
    const team = human >= 0 ? view.team[human]! : 0;
    ownScore = m.teamScore[team] ?? 0;
    for (let tIdx = 0; tIdx < m.teamScore.length; tIdx++) {
      if (tIdx !== team && m.teamScore[tIdx]! > otherScore) otherScore = m.teamScore[tIdx]!;
    }
    outcome = m.winnerTeam < 0 ? 'draw' : m.winnerTeam === team ? 'win' : 'loss';
  }
  const mvp = best(
    view,
    () => true,
    (i) => view.kills[i]! + view.assists[i]! * 0.5,
    (i) => view.deaths[i]!,
  );
  const nemesis =
    human >= 0
      ? best(
          view,
          (i) => st.killedHuman[i]! > 0,
          (i) => st.killedHuman[i]!,
          () => 0,
        )
      : -1;
  const victim =
    human >= 0
      ? best(
          view,
          (i) => st.killedByHuman[i]! > 0,
          (i) => st.killedByHuman[i]!,
          () => 0,
        )
      : -1;
  // Prêmios: um por bobo (quem já levou sai da disputa dos próximos), na ordem de `PRIZES`, até 3.
  const prizes: PrizeWinner[] = [];
  const free = (i: number): boolean => !prizes.some((p) => p.entity === i);
  for (const prize of PRIZES) {
    if (prizes.length >= 3) break;
    let pick: number;
    if (prize === 'crookedAim') {
      pick = best(
        view,
        (i) => free(i) && st.shots[i]! >= PRIZE_RULES.crookedAimMinShots,
        (i) => -accuracyPct(st, i),
        (i) => -st.shots[i]!,
      );
    } else if (prize === 'kamikaze') {
      pick = best(
        view,
        (i) => free(i) && st.mishaps[i]! > 0,
        (i) => st.mishaps[i]!,
        () => 0,
      );
    } else if (prize === 'coward') {
      pick = best(
        view,
        free,
        (i) => -st.shots[i]!,
        (i) => view.kills[i]!,
      );
    } else if (prize === 'waiter') {
      pick = best(
        view,
        (i) => free(i) && view.assists[i]! >= PRIZE_RULES.waiterMinAssists,
        (i) => view.assists[i]!,
        () => 0,
      );
    } else {
      pick = best(
        view,
        (i) => free(i) && view.kills[i]! >= PRIZE_RULES.immortalMinKills,
        (i) => -view.deaths[i]!,
        (i) => -view.kills[i]!,
      );
    }
    if (pick >= 0) prizes.push({ prize, entity: pick });
  }
  return {
    outcome,
    ownScore,
    otherScore,
    winner,
    mvp,
    nemesis,
    nemesisKills: nemesis >= 0 ? st.killedHuman[nemesis]! : 0,
    victim,
    victimKills: victim >= 0 ? st.killedByHuman[victim]! : 0,
    kills: human >= 0 ? view.kills[human]! : 0,
    accuracy: human >= 0 ? accuracyPct(st, human) : -1,
    bestStreak: human >= 0 ? st.bestStreak[human]! : 0,
    prizes,
    uglyLoss: outcome === 'loss' && ownScore * 2 <= otherScore,
  };
}
