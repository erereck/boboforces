import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHeadlessMatch, createSteer, NAV_PATH_API, PathFollower, PathService } from '@boboforces/ai';
import {
  builtinBotRef,
  decodeMap,
  decodeModelPack,
  MATCH_RECIPE_FORMAT,
  parseLayerManifest,
  type MatchRecipe,
} from '@boboforces/format';
import { BUTTON } from '@boboforces/input';
import { buildNavGrid, NO_NAV_NODE, type NavGridImpl } from '@boboforces/nav';
import { BOBO_NAV_METRICS, ENTITY_FLAG, ENTITY_KIND, METRICS } from '@boboforces/sim';
import { parseBlockDefs } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { MAP_MODES } from '../maps.ts';
import { buildMapNav, buildMapWorld, buildSimMap } from './world.ts';

/**
 * M10 (fase 2): o CANTEIRO DE OBRAS de verdade (o `.bfmap` do `mapc`, os blocos e as props do repositório), montado
 * pelo caminho do loading (`buildMapWorld` → `buildMapNav` → `buildSimMap`). Confere as regras de layout que o
 * `mapc --check` não cobre (GDD §4.6.3 e gameplay.md §3.6): spawns contados e separados, o perfil Tático atravessando
 * tudo só com degrau, escada e rampa, o seguidor de rota da IA subindo a todos os níveis e uma partida de bots por modo
 * (TDM, FFA e Sandbox) até o fim ou 3 min: todo mundo anda, o placar sobe, ninguém fica preso e os bots usam o 1º andar.
 * O 2º andar fica de fora das partidas de propósito: o passeio dos bots sorteia um nó qualquer e desiste em 15 s, então
 * eles quase nunca escolhem subir até lá (medido: 0 amostras em 5 partidas); isso é da IA, não do mapa.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const RUNTIME = JSON.parse(readFileSync(join(ROOT, 'assets-src', 'runtime-assets.json'), 'utf8')) as {
  files: Record<string, string>;
};
const asset = (logical: string): Uint8Array =>
  new Uint8Array(readFileSync(join(ROOT, 'assets-src', RUNTIME.files[logical] as string)));
const text = (logical: string): string => new TextDecoder().decode(asset(logical));

const ID = 'construction';
/** Piso do térreo, do 1º e do 2º andar (os mesmos do script do mapa). */
const G = 1;
const L1 = 4;
const L2 = 7;

function loadWorld() {
  const manifest = parseLayerManifest(JSON.parse(text('textures/blocos16.json')) as unknown);
  const layers = new Map(manifest.layers.map((l, i) => [l.name, i] as const));
  return buildMapWorld({
    map: decodeMap(asset(`maps/${ID}.bfmap`)),
    blockDefs: parseBlockDefs(JSON.parse(text('blocks/blocks.json')) as unknown),
    blockLayer: (name) => layers.get(name),
    models: decodeModelPack(asset('models/modelos.bfmodel')).models,
  });
}

const world = loadWorld();
const map = buildSimMap(world, buildMapNav(world));
const spawns = world.map.markers.spawns;

/** Nós alcançáveis a partir dos spawns, seguindo as ligações no sentido certo (como a análise do `mapc`). */
function reachable(nav: NavGridImpl): Uint8Array {
  const seen = new Uint8Array(nav.nodeCount);
  const queue: number[] = [];
  for (const sp of spawns) {
    const n = nav.nearestNode(sp.x, sp.y, sp.z);
    if (n !== NO_NAV_NODE && seen[n] === 0) {
      seen[n] = 1;
      queue.push(n);
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const a = queue[q]!;
    for (let l = nav.linkStart[a]!; l < nav.linkStart[a + 1]!; l++) {
      const b = nav.linkTarget[l]!;
      if (seen[b] === 0) {
        seen[b] = 1;
        queue.push(b);
      }
    }
  }
  return seen;
}

/** Nós alcançáveis dentro da área jogável por faixa de piso: térreo, 1º andar (e andaimes) e 2º andar. */
function levels(nav: NavGridImpl): { ground: number; first: number; second: number } {
  const seen = reachable(nav);
  const area = world.map.markers.playArea;
  const pos = new Float64Array(3);
  const out = { ground: 0, first: 0, second: 0 };
  for (let n = 0; n < nav.nodeCount; n++) {
    if (seen[n] === 0) continue;
    nav.nodePosition(n, pos);
    if (pos[0]! < area.minX || pos[0]! > area.maxX || pos[2]! < area.minZ || pos[2]! > area.maxZ) continue;
    const y = pos[1]!;
    if (Math.abs(y - L2) < 0.3) out.second++;
    else if (Math.abs(y - L1) < 0.3) out.first++;
    else if (Math.abs(y - G) < 0.3) out.ground++;
  }
  return out;
}

describe('Canteiro de Obras (M10, fase 2): o mapa', () => {
  it('meta, área e spawns: TDM 6 + 6 no fundo das bases, 16 de FFA espalhados', () => {
    const meta = world.map.meta;
    expect([...meta.modes].sort()).toEqual([...MAP_MODES.construction].sort());
    expect(meta.maxSightLineM).toBeLessThanOrEqual(50);
    expect(meta.players).toEqual({ min: 2, ideal: 12, max: 16 });
    const area = world.map.markers.playArea;
    // Classe média (GDD §4.6.2): de 60 a 90 m de lado.
    for (const side of [area.maxX - area.minX, area.maxZ - area.minZ]) {
      expect(side).toBeGreaterThanOrEqual(60);
      expect(side).toBeLessThanOrEqual(90);
    }
    const a = spawns.filter((s) => s.team === 0);
    const b = spawns.filter((s) => s.team === 1);
    const ffa = spawns.filter((s) => s.team === -1);
    expect([a.length, b.length, ffa.length]).toEqual([6, 6, 16]);
    // As bases nas pontas: o A no sul, o B no norte, a mais de 60 m em linha reta um do outro.
    let tdm = Infinity;
    for (const p of a) for (const q of b) tdm = Math.min(tdm, Math.hypot(p.x - q.x, p.z - q.z));
    expect(tdm).toBeGreaterThan(60);
    // O FFA espalhado: nenhum par a menos de 8 m, e os 16 cobrem as 4 faixas do mapa (norte, prédio e sul) e os lados.
    let near = Infinity;
    for (let i = 0; i < ffa.length; i++) {
      for (let j = i + 1; j < ffa.length; j++) {
        near = Math.min(near, Math.hypot(ffa[i]!.x - ffa[j]!.x, ffa[i]!.y - ffa[j]!.y, ffa[i]!.z - ffa[j]!.z));
      }
    }
    expect(near).toBeGreaterThanOrEqual(8);
    expect(ffa.some((s) => s.x < 25) && ffa.some((s) => s.x > 55)).toBe(true);
    expect(ffa.some((s) => s.z < 20) && ffa.some((s) => s.z > 68)).toBe(true);
    // Todo spawn no chão de um nó da navegação.
    const nav = map.nav as NavGridImpl;
    for (const sp of spawns)
      expect(nav.nearestNode(sp.x, sp.y, sp.z), `spawn (${sp.x}, ${sp.z})`).not.toBe(NO_NAV_NODE);
  });

  it('o perfil Tático atravessa tudo: sem pulo, os mesmos andares (só degrau, escada e rampa)', () => {
    const full = levels(map.nav as NavGridImpl);
    // Sem pulo nenhum (só o degrau automático de 0,5 m): o que sobra é o que se alcança por escada e rampa.
    const steps = buildNavGrid(
      { grid: world.grid, blocks: world.registry, colliders: world.navColliders },
      { ...BOBO_NAV_METRICS, jumpHeight: METRICS.stepHeight },
    ) as NavGridImpl;
    const tactical = levels(steps);
    console.log(`[canteiro] nós por andar (Bobo / só escada): ${JSON.stringify(full)} / ${JSON.stringify(tactical)}`);
    expect(full.first).toBeGreaterThan(400);
    expect(full.second).toBeGreaterThan(150);
    // Os andares inteiros por escada; o pulo só acrescenta o topo das coberturas baixas.
    expect(tactical.first / full.first).toBeGreaterThan(0.97);
    expect(tactical.second / full.second).toBeGreaterThan(0.97);
    expect(tactical.ground / full.ground).toBeGreaterThan(0.97);
    // E todo spawn chega a todo spawn sem pular.
    const seen = reachable(steps);
    for (const sp of spawns) {
      const n = steps.nearestNode(sp.x, sp.y, sp.z);
      expect(n !== NO_NAV_NODE && seen[n] === 1, `spawn (${sp.x}, ${sp.z})`).toBe(true);
    }
  });
});

interface Played {
  readonly ticks: number;
  readonly ended: boolean;
  readonly kills: number;
  readonly unstucks: number;
  /** Menor caminho andado por um bobo (m). */
  readonly minWalked: number;
  /** Maior tempo vivo parado (menos de 1,5 m em 1 s, seguidos) de um bobo (s). */
  readonly maxStillS: number;
  /** Bobos que pisaram no 1º andar e no 2º. */
  readonly upFirst: number;
  readonly upSecond: number;
  readonly bobos: number;
}

/** Roda a partida até acabar ou `maxTicks`, medindo cada bobo uma vez por segundo. */
function play(recipe: MatchRecipe, maxTicks = 3 * 60 * 60): Played {
  let kills = 0;
  let unstucks = 0;
  const match = createHeadlessMatch({
    recipe,
    map,
    humans: 0,
    onEvents: (events) => {
      for (const ev of events) {
        if (ev.type === 'kill') kills++;
        else if (ev.type === 'unstuck') unstucks++;
      }
    },
  });
  const hz = match.sim.hz;
  const walked = new Map<number, number>();
  const still = new Map<number, number>();
  const last = new Map<number, [number, number, number]>();
  let maxStill = 0;
  const first = new Set<number>();
  const second = new Set<number>();
  let t = 0;
  for (; t < maxTicks && match.sim.view().match.phase !== 'ended'; t++) {
    match.step();
    if (t % hz !== 0) continue;
    const v = match.sim.view();
    for (let e = 0; e < v.count; e++) {
      if (v.kind[e] !== ENTITY_KIND.bobo) continue;
      const x = v.position[e * 3]!;
      const y = v.position[e * 3 + 1]!;
      const z = v.position[e * 3 + 2]!;
      const prev = last.get(e);
      last.set(e, [x, y, z]);
      if ((v.flags[e]! & ENTITY_FLAG.dead) !== 0 || prev === undefined) {
        still.set(e, 0);
        continue;
      }
      const d = Math.hypot(x - prev[0], z - prev[2]);
      // Respawn (salto grande) não conta como andar.
      if (d < 15) walked.set(e, (walked.get(e) ?? 0) + d);
      const s = d < 1.5 ? (still.get(e) ?? 0) + 1 : 0;
      still.set(e, s);
      maxStill = Math.max(maxStill, s);
      if (Math.abs(y - L1) < 0.3) first.add(e);
      if (Math.abs(y - L2) < 0.3) second.add(e);
    }
  }
  const ended = match.sim.view().match.phase === 'ended';
  match.dispose();
  return {
    ticks: t,
    ended,
    kills,
    unstucks,
    minWalked: Math.min(...walked.values()),
    maxStillS: maxStill,
    upFirst: first.size,
    upSecond: second.size,
    bobos: last.size,
  };
}

const normal = builtinBotRef('normal');
const RECIPES: Readonly<Record<string, MatchRecipe>> = {
  'warfare.tdm': {
    format: MATCH_RECIPE_FORMAT,
    mode: 'warfare.tdm',
    map: ID,
    seed: 11,
    match: { timeLimitS: 180, scoreLimit: 30 },
    teams: [{ bots: [{ ref: normal, count: 5 }] }, { bots: [{ ref: normal, count: 5 }] }],
  },
  'warfare.ffa': {
    format: MATCH_RECIPE_FORMAT,
    mode: 'warfare.ffa',
    map: ID,
    seed: 12,
    match: { timeLimitS: 180, scoreLimit: 15 },
    teams: [{ bots: [{ ref: normal, count: 8 }] }],
  },
  sandbox: {
    format: MATCH_RECIPE_FORMAT,
    mode: 'sandbox',
    map: ID,
    seed: 13,
    match: { timeLimitS: 180, scoreLimit: 40 },
    teams: [
      { bots: [{ ref: normal, count: 2 }] },
      { bots: [{ ref: normal, count: 2 }] },
      { bots: [{ ref: normal, count: 2 }] },
      { bots: [{ ref: normal, count: 2 }] },
    ],
  },
};

/**
 * Um bobo guiado pelo seguidor de rota da IA (`PathService`, o mesmo dos bots) do 1º spawn do time até (gx, gy, gz):
 * devolve em quantos segundos chegou (Infinity = não chegou em `maxS`). É o que garante que os bots conseguem subir a
 * cada nível pelas escadas do mapa.
 */
function climb(team: 0 | 1, gx: number, gy: number, gz: number, maxS = 40): number {
  const follower = new PathFollower(0);
  const service = new PathService(NAV_PATH_API, [follower]);
  service.bind(map.nav ?? null);
  const steer = createSteer();
  let tick = 0;
  let me = -1;
  let reached = Infinity;
  const teams: MatchRecipe['teams'] =
    team === 0 ? [{ humans: 'all', bots: [] }, { bots: [] }] : [{ bots: [] }, { humans: 'all', bots: [] }];
  const match = createHeadlessMatch({
    recipe: { format: MATCH_RECIPE_FORMAT, mode: 'warfare.tdm', map: ID, seed: 1, match: { timeLimitS: 0 }, teams },
    map,
    humans: 1,
    writeHumans: (frames, sim) => {
      const v = sim.view();
      if (me < 0) for (let e = 0; e < v.count; e++) if (v.kind[e] === ENTITY_KIND.bobo) me = e;
      const x = v.position[me * 3]!;
      const y = v.position[me * 3 + 1]!;
      const z = v.position[me * 3 + 2]!;
      if (reached === Infinity && Math.hypot(x - gx, z - gz) < 1.5 && Math.abs(y - gy) < 0.3) reached = tick / sim.hz;
      service.want(follower, x, y, z, gx, gy, gz, tick, 30);
      service.service();
      const f = frames[0]!;
      f.moveX = 0;
      f.moveY = 0;
      f.buttons = 0;
      if (service.steer(follower, x, y, z, true, steer)) {
        f.yaw = Math.round((Math.atan2(-steer.x, -steer.z) / (Math.PI * 2)) * 65536) & 0xffff;
        f.moveY = 127;
        if (steer.jump) f.buttons |= BUTTON.jump;
      }
      tick++;
    },
  });
  for (let t = 0; t < maxS * match.sim.hz && reached === Infinity; t++) match.step();
  match.dispose();
  return reached;
}

describe('Canteiro de Obras (M10, fase 2): a IA sobe a todos os níveis', () => {
  // O 1º andar pelo andaime oeste e pelas escadas de dentro, o 2º andar pela escada de dentro e o assoalho do 2º pela
  // torre em U do andaime leste, saindo das duas bases.
  const targets: readonly (readonly [string, number, number, number])[] = [
    ['andaime oeste', 26.5, L1, 40.5],
    ['1º andar', 34.5, L1, 52.5],
    ['2º andar', 47.5, L2, 34.5],
    ['andaime leste no 2º', 54.5, L2, 50.5],
  ];
  for (const team of [0, 1] as const) {
    it(`do spawn do time ${team}`, () => {
      const times = targets.map(([, x, y, z]) => climb(team, x, y, z));
      const msg = times.map((s, i) => `${targets[i]![0]} ${s.toFixed(1)}`).join(', ');
      console.log(`[canteiro] subidas do time ${team} (s): ${msg}`);
      for (const [i, s] of times.entries()) expect(s, targets[i]![0]).toBeLessThan(40);
    }, 120_000);
  }
});

describe('Canteiro de Obras (M10, fase 2): bots jogando cada modo até o fim ou 3 min', () => {
  for (const mode of MAP_MODES.construction) {
    it(`${mode}: todo mundo anda, o placar sobe, ninguém fica preso e os andares são usados`, () => {
      const r = play(RECIPES[mode]!);
      console.log(`[canteiro] ${mode}: ${JSON.stringify(r)}`);
      expect(r.kills, mode).toBeGreaterThanOrEqual(5);
      expect(r.minWalked, mode).toBeGreaterThan(40);
      // Parado de verdade é o Destravar; o Camper segura um ponto por até ~1 min (medido: 57 s no galpão do canto).
      expect(r.unstucks, mode).toBeLessThanOrEqual(3);
      expect(r.maxStillS, mode).toBeLessThanOrEqual(90);
      expect(r.upFirst, mode).toBeGreaterThanOrEqual(1);
    }, 120_000);
  }

  it('Sandbox: os times 2 e 3 nascem no chão, longe das bases dos times 0 e 1', () => {
    const match = createHeadlessMatch({ recipe: RECIPES['sandbox']!, map, humans: 0 });
    const v = match.sim.view();
    const center = [0, 1, 2, 3].map(() => [0, 0, 0]);
    for (let e = 0; e < v.count; e++) {
      if (v.kind[e] !== ENTITY_KIND.bobo) continue;
      expect(Math.abs(v.position[e * 3 + 1]! - G), `altura do bobo ${e}`).toBeLessThan(0.6);
      const c = center[v.team[e]!]!;
      c[0]! += v.position[e * 3]!;
      c[1]! += v.position[e * 3 + 2]!;
      c[2]!++;
    }
    match.dispose();
    const at = (t: number): [number, number] => [center[t]![0]! / center[t]![2]!, center[t]![1]! / center[t]![2]!];
    // O 2 no oeste e o 3 no leste, no meio do comprimento do mapa.
    expect(at(2)[0]).toBeLessThan(15);
    expect(at(3)[0]).toBeGreaterThan(65);
    for (const t of [2, 3]) {
      for (const o of [0, 1]) {
        const [x, z] = at(t);
        const [ox, oz] = at(o);
        expect(Math.hypot(x - ox, z - oz)).toBeGreaterThan(30);
      }
    }
  }, 60_000);
});
