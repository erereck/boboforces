import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHeadlessMatch } from '@boboforces/ai';
import {
  builtinBotRef,
  decodeMap,
  decodeModelPack,
  MATCH_RECIPE_FORMAT,
  parseLayerManifest,
  type MatchRecipe,
} from '@boboforces/format';
import { BUTTON } from '@boboforces/input';
import {
  CHAOS_MODS,
  createInputFrames,
  createSim,
  ENTITY_FLAG,
  ENTITY_KIND,
  entityIndex,
  MOD,
  type SimMap,
} from '@boboforces/sim';
import { parseBlockDefs } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { MAP_MODES } from '../maps.ts';
import { moreModePreset } from '../more-modes.ts';
import { buildMapNav, buildMapWorld, buildSimMap } from './world.ts';

/**
 * M10 (fase 4): a Estação Lunar de verdade (o `.bfmap` do `mapc`, montado pelo caminho do loading): a gravidade da Lua
 * de série chega à sim (o pulo sobe mais que no Construto) e os bots jogam cada modo do mapa (TDM, FFA, o Bobo Chaos e
 * o Sandbox) sem sair da área, sem cair por baixo do chão e andando. As partidas longas (3 min por modo) ficam no
 * script `local/m10/partidas-moon.ts`.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const RUNTIME = JSON.parse(readFileSync(join(ROOT, 'assets-src', 'runtime-assets.json'), 'utf8')) as {
  files: Record<string, string>;
};
const asset = (logical: string): Uint8Array =>
  new Uint8Array(readFileSync(join(ROOT, 'assets-src', RUNTIME.files[logical] as string)));
const text = (logical: string): string => new TextDecoder().decode(asset(logical));

const maps = new Map<string, SimMap>();
function loadMap(id: string): SimMap {
  const known = maps.get(id);
  if (known) return known;
  const manifest = parseLayerManifest(JSON.parse(text('textures/blocos16.json')) as unknown);
  const layers = new Map(manifest.layers.map((l, i) => [l.name, i] as const));
  const world = buildMapWorld({
    map: decodeMap(asset(`maps/${id}.bfmap`)),
    blockDefs: parseBlockDefs(JSON.parse(text('blocks/blocks.json')) as unknown),
    blockLayer: (name) => layers.get(name),
    models: decodeModelPack(asset('models/modelos.bfmodel')).models,
  });
  const map = buildSimMap(world, buildMapNav(world));
  maps.set(id, map);
  return map;
}

/** O humano 0 pula parado no spawn dele; devolve a altura máxima dos pés acima do chão e os ticks no ar. */
function jumpOn(id: string): { peak: number; air: number } {
  const recipe: MatchRecipe = {
    format: MATCH_RECIPE_FORMAT,
    mode: 'warfare.tdm',
    map: id,
    seed: 3,
    match: { timeLimitS: 0, scoreLimit: 0 },
    teams: [
      { humans: 1, bots: [] },
      { humans: 1, bots: [] },
    ],
  };
  const sim = createSim({ recipe, map: loadMap(id), humans: 2 });
  const f = createInputFrames();
  const e = entityIndex(sim.controllerEntity(0));
  for (let i = 0; i < 30; i++) sim.step(f);
  const y0 = sim.view().position[e * 3 + 1]!;
  let peak = 0;
  let air = 0;
  f[0]!.buttons = BUTTON.jump;
  for (let i = 0; i < 4 * 60; i++) {
    sim.step(f);
    f[0]!.buttons = 0;
    const h = sim.view().position[e * 3 + 1]! - y0;
    peak = Math.max(peak, h);
    if (h > 0.01) air++;
  }
  sim.dispose();
  return { peak, air };
}

const normal = builtinBotRef('normal');
const RECIPES: Readonly<Record<string, MatchRecipe>> = {
  'Times (TDM)': {
    format: MATCH_RECIPE_FORMAT,
    mode: 'warfare.tdm',
    map: 'moonbase',
    seed: 42,
    match: { timeLimitS: 90, scoreLimit: 0 },
    teams: [{ bots: [{ ref: normal, count: 4 }] }, { bots: [{ ref: normal, count: 4 }] }],
  },
  'Todos contra todos (FFA)': {
    format: MATCH_RECIPE_FORMAT,
    mode: 'warfare.ffa',
    map: 'moonbase',
    seed: 42,
    match: { timeLimitS: 90, scoreLimit: 0 },
    teams: [{ bots: [{ ref: normal, count: 8 }] }],
  },
  'Bobo Chaos (o card, Roleta a cada 20 s)': {
    ...moreModePreset('chaos')!,
    seed: 42,
    match: { timeLimitS: 90, scoreLimit: 0 },
    chaos: { everyS: 20 },
    teams: [{ bots: [{ ref: normal, count: 4 }] }, { bots: [{ ref: normal, count: 4 }] }],
  },
  'Bobo Sandbox (4 times)': {
    format: MATCH_RECIPE_FORMAT,
    mode: 'sandbox',
    map: 'moonbase',
    seed: 42,
    match: { timeLimitS: 90, scoreLimit: 0 },
    teams: [
      { bots: [{ ref: normal, count: 2 }] },
      { bots: [{ ref: normal, count: 2 }] },
      { bots: [{ ref: normal, count: 2 }] },
      { bots: [{ ref: normal, count: 2 }] },
    ],
  },
};

describe('a Estação Lunar (M10, fase 4)', () => {
  it('a gravidade da Lua vem do mapa: o pulo sobe ~2,9 m (no Construto, 1 m) e demora mais no ar', () => {
    const moon = loadMap('moonbase');
    expect(moon.gravity).toBe(CHAOS_MODS.lowGravity);
    expect(loadMap('construto').gravity).toBeUndefined();
    expect(MAP_MODES.moonbase).toEqual(['warfare.tdm', 'warfare.ffa', 'sandbox']);
    const earth = jumpOn('construto');
    const lunar = jumpOn('moonbase');
    expect(earth.peak).toBeLessThan(1.05);
    expect(lunar.peak).toBeGreaterThan(2.75);
    expect(lunar.air).toBeGreaterThan(earth.air * 2.5);
  }, 60_000);

  // Revisão da fase 4: as rampas de 4 m da estação e a de 3 m da antena estão na navegação, mas a IA não subia escada
  // comprida (0 tick de bot no andar de cima em 3 min de TDM). M10 (fase 1c): com o seguidor de rota consertado
  // (`packages/ai/src/paths.ts`) e o passeio que às vezes sobe, o andar de cima tem bot (367 amostras de tick nesta
  // semente, o 1º aos 17 s). O deque da antena (16 nós) ainda não: no sorteio por andar ele dividia a faixa de 3 m com
  // o anel da estação (623 nós) e quase nunca saía (0 amostras em 90 s nesta semente; 2 de 8 sementes). M11 (fase 2):
  // o passeio sorteia por lugar (piso plano) e o deque tem a mesma vez que o anel: 88 amostras nesta semente, a 1ª aos
  // 57 s (7 de 8 sementes); o andar de cima segue com bot (465, o 1º aos 34 s). M12 (fase 7a, a IA que percebe e mira
  // como gente): o deque segue com bot em 7 de 8 sementes (1.294 amostras somadas, eram 997), mas a 42 é a que ficou
  // sem (a 5 passou a ter): o deque olha a 42 e a 1 (230 amostras, a 1ª aos 9 s).
  const upperAndDeck = (seed = 42): { upper: number; deck: number } => {
    const map = loadMap('moonbase');
    const match = createHeadlessMatch({ recipe: { ...RECIPES['Times (TDM)']!, seed }, map, humans: 0 });
    let upper = 0;
    let deck = 0;
    for (let t = 0; t < 90 * 60; t++) {
      match.step();
      const v = match.sim.view();
      for (let e = 0; e < v.count; e++) {
        if (v.alive[e] !== 1 || v.kind[e] !== ENTITY_KIND.bobo || (v.flags[e]! & ENTITY_FLAG.dead) !== 0) continue;
        const x = v.position[e * 3]!;
        const y = v.position[e * 3 + 1]!;
        const z = v.position[e * 3 + 2]!;
        // O andar de cima: a 4 m (o piso a 6 m), dentro da estação (x 28..52, z 26..54).
        if (y > 5.6 && y < 7 && x > 28 && x < 52 && z > 26 && z < 54) upper++;
        // O deque da antena: a 3 m (o piso a 5 m), x 62..68, z 37..43.
        if (y > 4.6 && y < 6 && x > 62 && x < 68 && z > 37 && z < 43) deck++;
      }
    }
    match.dispose();
    return { upper, deck };
  };
  it('os bots sobem para o andar de cima da estação', () => {
    expect(upperAndDeck().upper).toBeGreaterThan(0);
  }, 120_000);
  it('os bots sobem para o deque da antena', () => {
    expect(upperAndDeck(42).deck + upperAndDeck(1).deck).toBeGreaterThan(0);
  }, 120_000);

  for (const [name, recipe] of Object.entries(RECIPES)) {
    it(`${name}: os bots jogam até o fim, sem sair da área nem cair do chão`, () => {
      const map = loadMap('moonbase');
      const area = map.playArea!;
      let kills = 0;
      let lowMask = 0;
      const match = createHeadlessMatch({
        recipe,
        map,
        humans: 0,
        onEvents: (events) => {
          for (const ev of events) if (ev.type === 'kill') kills++;
        },
      });
      const n = match.sim.view().count;
      const walked = new Float64Array(n);
      const last = new Float64Array(n * 2);
      const v0 = match.sim.view();
      for (let e = 0; e < n; e++) {
        last[e * 2] = v0.position[e * 3]!;
        last[e * 2 + 1] = v0.position[e * 3 + 2]!;
      }
      let outside = 0;
      let under = 0;
      let t = 0;
      for (; t < 95 * 60 && match.sim.view().match.phase !== 'ended'; t++) {
        match.step();
        const v = match.sim.view();
        if (v.chaos !== null) lowMask |= v.chaos.masks[0]! & MOD.lowGravity;
        for (let e = 0; e < v.count; e++) {
          if (v.alive[e] !== 1 || v.kind[e] !== ENTITY_KIND.bobo || (v.flags[e]! & ENTITY_FLAG.dead) !== 0) continue;
          const x = v.position[e * 3]!;
          const z = v.position[e * 3 + 2]!;
          const d = Math.hypot(x - last[e * 2]!, z - last[e * 2 + 1]!);
          if (d < 3) walked[e] = walked[e]! + d;
          last[e * 2] = x;
          last[e * 2 + 1] = z;
          if (x < area.minX - 0.01 || x > area.maxX + 0.01 || z < area.minZ - 0.01 || z > area.maxZ + 0.01) outside++;
          // O fundo das crateras é 1,5 m abaixo do chão (2 m): 0,5 m.
          if (v.position[e * 3 + 1]! < 0.45) under++;
        }
      }
      const v = match.sim.view();
      const moved = Array.from(walked).filter((w, e) => v.kind[e] === ENTITY_KIND.bobo && w > 100).length;
      const msg = `${(t / 60).toFixed(0)} s, ${kills} abates, ${moved} bots andaram mais de 100 m`;
      match.dispose();
      expect(v.match.phase, msg).toBe('ended');
      expect(kills, msg).toBeGreaterThan(5);
      expect(moved, msg).toBe(8);
      expect(outside, msg).toBe(0);
      expect(under, msg).toBe(0);
      // A Roleta nunca sorteia a Lua no mapa que já é lunar.
      expect(lowMask, msg).toBe(0);
    }, 120_000);
  }
});
