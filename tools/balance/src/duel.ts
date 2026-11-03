import { createHeadlessMatch } from '@boboforces/ai';
import { BOT_LEVELS, builtinBotRef, MATCH_RECIPE_FORMAT, type BotLevel, type MatchRecipe } from '@boboforces/format';
import { BOT_CONTROLLER_BASE, SIM_HZ, type SimMap } from '@boboforces/sim';
import { cellCenter, createTestBlocks, createWorldGrid, fillBox, makeCell, type MapSpawn } from '@boboforces/world';

/**
 * Robô de balanceamento (gameplay.md §6.13), no estilo do `scripts/balance.mjs` do gamebobo: duelos de fuzil bot
 * contra bot na sim headless, sem tela e com semente fixa. No M0 ele garante a ORDEM dos 5 níveis rápidos: o K/D de
 * cada nível (somando todos os duelos) tem que ser estritamente crescente de Pela vibe a Tryhard, e o nível de cima
 * tem que ganhar mais da metade dos duelos contra o de baixo.
 */

export interface DuelOptions {
  /** Rodadas por par de níveis (metade de cada lado). */
  readonly roundsPerPair: number;
  readonly seed: number;
  /** Distâncias entre os spawns, m (as rodadas alternam). */
  readonly distances?: readonly number[];
  /** Limite de cada rodada, s (sem morte = empate). */
  readonly maxRoundS?: number;
  /** Níveis em ordem crescente (padrão: os 5). */
  readonly levels?: readonly BotLevel[];
}

export interface LevelStats {
  readonly level: BotLevel;
  rounds: number;
  wins: number;
  losses: number;
  draws: number;
  shots: number;
  hits: number;
  headshotKills: number;
  /** Soma e contagem do TTK (primeiro acerto do vencedor até a morte), s. */
  ttkSum: number;
  ttkCount: number;
}

export interface PairStats {
  readonly low: BotLevel;
  readonly high: BotLevel;
  highWins: number;
  lowWins: number;
  draws: number;
}

export interface DuelReport {
  readonly levels: readonly LevelStats[];
  readonly pairs: readonly PairStats[];
  readonly rounds: number;
  readonly ok: boolean;
  readonly problems: readonly string[];
}

const DEFAULT_DISTANCES = [10, 20, 30] as const;

/** Corredor plano de 12 m de largura com paredes de 2 m; os dois spawns se olham a `distanceM`. */
export function buildDuelMap(distanceM: number): SimMap {
  const blocks = createTestBlocks();
  const concrete = makeCell(blocks.byKey('concrete')!.id);
  const width = 24;
  const length = Math.ceil(distanceM * 2) + 20;
  const grid = createWorldGrid(width, 8, length);
  fillBox(grid, 0, 0, 0, width - 1, 0, length - 1, concrete);
  fillBox(grid, 0, 1, 0, width - 1, 4, 0, concrete);
  fillBox(grid, 0, 1, length - 1, width - 1, 4, length - 1, concrete);
  fillBox(grid, 0, 1, 0, 0, 4, length - 1, concrete);
  fillBox(grid, width - 1, 1, 0, width - 1, 4, length - 1, concrete);
  const x = cellCenter(width / 2);
  const z0 = 5;
  const spawns: MapSpawn[] = [
    { x, y: 0.5, z: z0, yaw: Math.PI, team: 0 },
    { x, y: 0.5, z: z0 + distanceM, yaw: 0, team: 1 },
  ];
  return { grid, blocks, spawns };
}

interface RoundResult {
  /** 0 ou 1 (time vencedor), -1 = empate. */
  winner: number;
  ttk: number;
  headshot: boolean;
  shots: [number, number];
  hits: [number, number];
}

function runRound(a: BotLevel, b: BotLevel, map: SimMap, seed: number, maxTicks: number): RoundResult {
  const recipe: MatchRecipe = {
    format: MATCH_RECIPE_FORMAT,
    mode: 'warfare.tdm',
    map: 'duel',
    seed,
    teams: [{ bots: [{ ref: builtinBotRef(a), count: 1 }] }, { bots: [{ ref: builtinBotRef(b), count: 1 }] }],
  };
  const result: RoundResult = { winner: -1, ttk: Number.NaN, headshot: false, shots: [0, 0], hits: [0, 0] };
  const firstHit = [-1, -1];
  let done = false;
  let ids: readonly [number, number] = [0, 0];
  const side = (id: number): number => (id === ids[0] ? 0 : id === ids[1] ? 1 : -1);
  const match = createHeadlessMatch({
    recipe,
    map,
    humans: 0,
    onEvents: (events) => {
      for (const ev of events) {
        if (ev.type === 'shot') {
          const s = side(ev.shooter);
          if (s >= 0) result.shots[s] = result.shots[s]! + 1;
        } else if (ev.type === 'hit' && ev.damage > 0) {
          const s = side(ev.shooter);
          if (s >= 0) {
            result.hits[s] = result.hits[s]! + 1;
            if (firstHit[s] === -1) firstHit[s] = ev.tick;
          }
        } else if (ev.type === 'kill' && !done) {
          const s = side(ev.killer);
          done = true;
          result.winner = s;
          result.headshot = ev.headshot;
          if (s >= 0) result.ttk = (ev.tick - firstHit[s]!) / SIM_HZ;
        }
      }
    },
  });
  ids = [match.sim.controllerEntity(BOT_CONTROLLER_BASE), match.sim.controllerEntity(BOT_CONTROLLER_BASE + 1)];
  for (let t = 0; t < maxTicks && !done; t++) match.step();
  match.dispose();
  return result;
}

function newLevelStats(level: BotLevel): LevelStats {
  return {
    level,
    rounds: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    shots: 0,
    hits: 0,
    headshotKills: 0,
    ttkSum: 0,
    ttkCount: 0,
  };
}

/** K/D do nível (abates por morte; sem mortes, o total de abates). */
export function killDeath(s: LevelStats): number {
  return s.losses === 0 ? s.wins : s.wins / s.losses;
}

/** Roda todos os pares de níveis (round-robin) e confere a ordem. Determinístico para a mesma semente. */
export function runDuels(options: DuelOptions): DuelReport {
  const levels = options.levels ?? BOT_LEVELS;
  const distances = options.distances ?? DEFAULT_DISTANCES;
  const maxTicks = Math.round((options.maxRoundS ?? 15) * SIM_HZ);
  const maps = distances.map(buildDuelMap);
  const stats = levels.map(newLevelStats);
  const pairs: PairStats[] = [];
  let rounds = 0;
  for (let i = 0; i < levels.length; i++) {
    for (let j = i + 1; j < levels.length; j++) {
      const low = levels[i]!;
      const high = levels[j]!;
      const pair: PairStats = { low, high, highWins: 0, lowWins: 0, draws: 0 };
      for (let r = 0; r < options.roundsPerPair; r++) {
        // Lados alternados: metade das rodadas cada nível nasce de cada lado.
        const swap = r % 2 === 1;
        const map = maps[Math.floor(r / 2) % maps.length]!;
        const seed = (options.seed * 1_000_003 + (i * 16 + j) * 100_003 + r) >>> 0;
        const res = runRound(swap ? high : low, swap ? low : high, map, seed, maxTicks);
        rounds++;
        const sideLow = swap ? 1 : 0;
        const sLow = stats[i]!;
        const sHigh = stats[j]!;
        sLow.rounds++;
        sHigh.rounds++;
        sLow.shots += res.shots[sideLow]!;
        sLow.hits += res.hits[sideLow]!;
        sHigh.shots += res.shots[1 - sideLow]!;
        sHigh.hits += res.hits[1 - sideLow]!;
        if (res.winner < 0) {
          pair.draws++;
          sLow.draws++;
          sHigh.draws++;
          continue;
        }
        const winner = res.winner === sideLow ? sLow : sHigh;
        const loser = winner === sLow ? sHigh : sLow;
        if (winner === sLow) pair.lowWins++;
        else pair.highWins++;
        winner.wins++;
        loser.losses++;
        if (res.headshot) winner.headshotKills++;
        if (Number.isFinite(res.ttk)) {
          winner.ttkSum += res.ttk;
          winner.ttkCount++;
        }
      }
      pairs.push(pair);
    }
  }

  const problems: string[] = [];
  for (let i = 1; i < stats.length; i++) {
    const lo = stats[i - 1]!;
    const hi = stats[i]!;
    if (!(killDeath(hi) > killDeath(lo))) {
      problems.push(
        `K/D fora de ordem: ${hi.level} (${killDeath(hi).toFixed(2)}) ≤ ${lo.level} (${killDeath(lo).toFixed(2)})`,
      );
    }
    const pair = pairs.find((p) => p.low === lo.level && p.high === hi.level);
    if (pair && !(pair.highWins > pair.lowWins)) {
      problems.push(`${hi.level} não ganha de ${lo.level}: ${pair.highWins} × ${pair.lowWins}`);
    }
  }
  return { levels: stats, pairs, rounds, ok: problems.length === 0, problems };
}

/** Nomes da interface (gameplay.md §6.6); a ferramenta não usa a tabela de textos do jogo. */
const LEVEL_NAMES: Readonly<Record<BotLevel, string>> = {
  vibe: 'Pela vibe',
  chill: 'De boa',
  normal: 'Normal',
  sweaty: 'Suado',
  tryhard: 'Tryhard',
};

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function padLeft(s: string, n: number): string {
  return s.length >= n ? s : ' '.repeat(n - s.length) + s;
}

function pct(n: number, d: number): string {
  return d === 0 ? '—' : `${((n / d) * 100).toFixed(1)}%`;
}

export function formatReport(r: DuelReport): string {
  const lines: string[] = [];
  lines.push(`Robô de balanceamento: ${r.rounds} duelos de fuzil (Rattler)`);
  lines.push('');
  lines.push(
    `${pad('Nível', 11)}${padLeft('V', 6)}${padLeft('D', 6)}${padLeft('E', 5)}${padLeft('K/D', 7)}${padLeft('Precisão', 10)}${padLeft('TTK', 8)}${padLeft('HS', 8)}`,
  );
  for (const s of r.levels) {
    const ttk = s.ttkCount > 0 ? `${(s.ttkSum / s.ttkCount).toFixed(2)} s` : '—';
    lines.push(
      `${pad(LEVEL_NAMES[s.level], 11)}${padLeft(String(s.wins), 6)}${padLeft(String(s.losses), 6)}${padLeft(String(s.draws), 5)}${padLeft(killDeath(s).toFixed(2), 7)}${padLeft(pct(s.hits, s.shots), 10)}${padLeft(ttk, 8)}${padLeft(pct(s.headshotKills, s.wins), 8)}`,
    );
  }
  lines.push('');
  lines.push('Pares (vitórias do nível de cima × de baixo, empates):');
  for (const p of r.pairs) {
    lines.push(
      `  ${pad(`${LEVEL_NAMES[p.high]} × ${LEVEL_NAMES[p.low]}`, 22)}${padLeft(String(p.highWins), 5)} × ${pad(String(p.lowWins), 5)} (${p.draws} empates, ${pct(p.highWins, p.highWins + p.lowWins)})`,
    );
  }
  lines.push('');
  lines.push(r.ok ? 'OK: a ordem dos 5 níveis é estritamente crescente.' : `FALHOU:\n  ${r.problems.join('\n  ')}`);
  return lines.join('\n');
}
