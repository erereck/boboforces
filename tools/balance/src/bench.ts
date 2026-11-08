import { createBotDirectorWithPaths, NAV_PATH_API, type NavPathApi } from '@boboforces/ai';
import {
  builtinBotRef,
  createFigureGameTable,
  MATCH_RECIPE_FORMAT,
  type FigureGameTable,
  type MatchRecipe,
  type TeamRecipe,
} from '@boboforces/format';
import { hashToHex } from '@boboforces/shared';
import {
  BOBO_NAV_METRICS,
  createInputFrames,
  createSim,
  ENTITY_KIND,
  type SimEvent,
  type SimMap,
} from '@boboforces/sim';
import { buildNavOrTestNav, buildSyntheticConstruto, TEST_NAV_PATHS } from '@boboforces/sim/testing';

/**
 * Bench headless de sim + IA (tecnico.md §24.2, item 12): custo por tick no Node, separado em IA (`think`) e sim
 * (`step`), com média, p50, p99 e máximo, nos cenários do Teste Zero: 4 humanos + 12 bots armados (Switch na dock),
 * 1 humano + 24 bots (Switch 1P), 4 humanos + 48 bots e 4 humanos + 24 zumbis (estresse). Os humanos ficam parados
 * no spawn (são alvos e observadores do LOD da IA).
 *
 * Mapa: o Construto sintético (`@boboforces/sim/testing`) enquanto o `.bfmap` não existe. Navegação: a do `nav` se ela
 * já estiver pronta (frente mapa-nav), senão a de teste da sim; o relatório diz qual foi usada.
 */

export interface BenchScenario {
  readonly id: string;
  readonly label: string;
  readonly humans: number;
  readonly bots: number;
  readonly zombies: number;
}

export const BENCH_SCENARIOS: readonly BenchScenario[] = [
  { id: 'dock-12', label: '4 humanos + 12 bots armados (Switch dock)', humans: 4, bots: 12, zombies: 0 },
  { id: '1p-24', label: '1 humano + 24 bots armados (Switch 1P)', humans: 1, bots: 24, zombies: 0 },
  { id: 'stress-48', label: '4 humanos + 48 bots armados (estresse)', humans: 4, bots: 48, zombies: 0 },
  { id: 'zombies-24', label: '4 humanos + 24 zumbis (estresse)', humans: 4, bots: 0, zombies: 24 },
];

export interface BenchOptions {
  readonly ticks: number;
  readonly warmupTicks: number;
  readonly hz: number;
  readonly seed: number;
  /** Relógio em ms (a ferramenta passa `performance.now`; a sim e a IA nunca leem relógio). */
  readonly now: () => number;
}

export interface Stat {
  readonly mean: number;
  readonly p50: number;
  readonly p99: number;
  readonly max: number;
}

export interface BenchResult {
  readonly scenario: BenchScenario;
  readonly nav: 'nav' | 'teste';
  readonly navBuildMs: number;
  readonly ai: Stat;
  readonly sim: Stat;
  readonly total: Stat;
  readonly kills: number;
  readonly shots: number;
  readonly melees: number;
  readonly rays: number;
  /** Escolhas da mira visível dos bots (`visibleAimOffset`, teto por tick). */
  readonly visibleAims: number;
  readonly pathCalls: number;
  readonly pathsServed: number;
  /** Maior altura de pé alcançada por um bot ou zumbi (m): mostra que a rota sobe rampas e escadas. */
  readonly maxFeetY: number;
  readonly hash: string;
}

/** Estatística de uma amostra de tempos (ms). Ordena uma cópia. */
export function stat(samples: Float64Array): Stat {
  const sorted = Float64Array.from(samples).sort();
  const n = sorted.length;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += sorted[i]!;
  const at = (q: number): number => sorted[Math.min(n - 1, Math.floor(q * (n - 1)))]!;
  return { mean: n > 0 ? sum / n : 0, p50: at(0.5), p99: at(0.99), max: n > 0 ? sorted[n - 1]! : 0 };
}

interface Prepared {
  readonly map: SimMap;
  readonly paths: NavPathApi;
  readonly nav: 'nav' | 'teste';
  readonly navBuildMs: number;
  /** Tabela de jogo do boneco (#56), montada uma vez e passada a todos os cenários, como o `game` faz no loading. */
  readonly figureTable: FigureGameTable;
}

/** Mapa do bench: Construto sintético com a navegação do `nav` (se pronta) ou a de teste. */
export function prepareMap(now: () => number): Prepared {
  const { map, grid, blocks } = buildSyntheticConstruto();
  const t0 = now();
  const { nav, real } = buildNavOrTestNav({ grid, blocks }, BOBO_NAV_METRICS);
  const navBuildMs = now() - t0;
  return {
    map: { ...map, nav },
    paths: real ? NAV_PATH_API : TEST_NAV_PATHS,
    nav: real ? 'nav' : 'teste',
    navBuildMs,
    figureTable: createFigureGameTable(),
  };
}

function scenarioRecipe(s: BenchScenario, seed: number): MatchRecipe {
  const teams: TeamRecipe[] = [0, 1].map((t) => {
    const humans = t === 0 ? Math.ceil(s.humans / 2) : Math.floor(s.humans / 2);
    const bots = t === 0 ? Math.ceil(s.bots / 2) : Math.floor(s.bots / 2);
    return { humans, bots: bots > 0 ? [{ ref: builtinBotRef('normal'), count: bots }] : [] };
  });
  return { format: MATCH_RECIPE_FORMAT, mode: 'warfare.tdm', map: 'construto', seed, teams };
}

/** Roda um cenário: aquecimento (JIT) e depois `ticks` ticks cronometrados, IA e sim separados. */
export function runBench(s: BenchScenario, prepared: Prepared, o: BenchOptions): BenchResult {
  const recipe = scenarioRecipe(s, o.seed);
  const sim = createSim({
    recipe,
    map: prepared.map,
    humans: s.humans,
    hz: o.hz,
    zombies: s.zombies,
    figureTable: prepared.figureTable,
  });
  const director = createBotDirectorWithPaths(
    { recipe, humans: s.humans, hz: o.hz, zombies: s.zombies },
    prepared.paths,
  );
  const frames = createInputFrames();
  const events: SimEvent[] = [];
  const ai = new Float64Array(o.ticks);
  const st = new Float64Array(o.ticks);
  const total = new Float64Array(o.ticks);
  let kills = 0;
  let shots = 0;
  let melees = 0;
  let maxFeetY = 0;
  const view = sim.view();
  for (let t = 0; t < o.warmupTicks + o.ticks; t++) {
    const t0 = o.now();
    director.think(view, frames);
    const t1 = o.now();
    sim.step(frames);
    const t2 = o.now();
    events.length = 0;
    sim.drainEvents(events);
    const k = t - o.warmupTicks;
    if (k < 0) continue;
    ai[k] = t1 - t0;
    st[k] = t2 - t1;
    total[k] = t2 - t0;
    for (const ev of events) {
      if (ev.type === 'kill') kills++;
      else if (ev.type === 'shot') shots++;
      else if (ev.type === 'melee') melees++;
    }
    if (k % 30 === 0) {
      for (let e = 0; e < view.count; e++) {
        if (view.alive[e] === 0 || view.controller[e]! < 4) continue;
        if (view.kind[e] !== ENTITY_KIND.bobo && view.kind[e] !== ENTITY_KIND.zombie) continue;
        maxFeetY = Math.max(maxFeetY, view.position[e * 3 + 1]!);
      }
    }
  }
  const stats = director.stats();
  const hash = hashToHex(sim.stateHash());
  director.dispose();
  sim.dispose();
  return {
    scenario: s,
    nav: prepared.nav,
    navBuildMs: prepared.navBuildMs,
    ai: stat(ai),
    sim: stat(st),
    total: stat(total),
    kills,
    shots,
    melees,
    rays: stats.rays,
    visibleAims: stats.visibleAims,
    pathCalls: stats.pathCalls,
    pathsServed: stats.pathsServed,
    maxFeetY,
    hash,
  };
}

const ms = (v: number): string => v.toFixed(3);

/** Relatório em linhas `chave=valor` (mesmo estilo do bench da web) mais uma tabela legível. */
export function formatBench(results: readonly BenchResult[], o: Pick<BenchOptions, 'ticks' | 'hz' | 'seed'>): string {
  const lines: string[] = [];
  lines.push('BoboForces bench-sim 1');
  lines.push(`ticks=${o.ticks} hz=${o.hz} semente=${o.seed} mapa=construto-sintetico nav=${results[0]?.nav ?? '-'}`);
  for (const r of results) {
    lines.push(
      `cenario=${r.scenario.id} humanos=${r.scenario.humans} bots=${r.scenario.bots} zumbis=${r.scenario.zombies} ` +
        `ia_media=${ms(r.ai.mean)} ia_p99=${ms(r.ai.p99)} sim_media=${ms(r.sim.mean)} sim_p99=${ms(r.sim.p99)} ` +
        `total_media=${ms(r.total.mean)} total_p99=${ms(r.total.p99)} total_max=${ms(r.total.max)} ` +
        `abates=${r.kills} tiros=${r.shots} golpes=${r.melees} raios=${r.rays} miras=${r.visibleAims} astar_chamadas=${r.pathCalls} ` +
        `rotas=${r.pathsServed} alto_m=${r.maxFeetY.toFixed(2)} hash=${r.hash}`,
    );
  }
  lines.push('fim');
  lines.push('');
  lines.push('| Cenário | IA ms/tick (média / p99) | Sim ms/tick (média / p99) | Total (média / p99 / máx) |');
  lines.push('|---|---|---|---|');
  for (const r of results) {
    lines.push(
      `| ${r.scenario.label} | ${ms(r.ai.mean)} / ${ms(r.ai.p99)} | ${ms(r.sim.mean)} / ${ms(r.sim.p99)} | ` +
        `${ms(r.total.mean)} / ${ms(r.total.p99)} / ${ms(r.total.max)} |`,
    );
  }
  if (results[0]) lines.push(`\nnavegação: ${results[0].nav} (montada em ${results[0].navBuildMs.toFixed(0)} ms)`);
  return lines.join('\n');
}
