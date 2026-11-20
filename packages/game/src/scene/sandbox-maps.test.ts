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
import { ENTITY_FLAG, ENTITY_KIND } from '@boboforces/sim';
import { parseBlockDefs } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { mapsForMode } from '../maps.ts';
import { buildMapNav, buildMapWorld, buildSimMap } from './world.ts';

/**
 * M9 (fase 3): os mapas do Bobo Sandbox na Partida personalizada. Cada mapa da lista (`mapsForMode('sandbox')`) monta
 * 4 times de 2 bots pelo caminho do loading: os times sem ponto no mapa (o 2 e o 3) precisam de uma casa dentro da área
 * jogável, no chão e longe das bases dos times 0 e 1, e a partida anda 20 s com todo mundo se mexendo. A Base Bobo
 * ficou de fora do M9 por isso (a casa caía em cima dos quebra-vistas de 2,5 m das rotas, y 3,5); no M10 (fase 8) a casa
 * prefere os nós no chão das bases e ela entrou.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const RUNTIME = JSON.parse(readFileSync(join(ROOT, 'assets-src', 'runtime-assets.json'), 'utf8')) as {
  files: Record<string, string>;
};
const asset = (logical: string): Uint8Array =>
  new Uint8Array(readFileSync(join(ROOT, 'assets-src', RUNTIME.files[logical] as string)));
const text = (logical: string): string => new TextDecoder().decode(asset(logical));

function loadMap(id: string) {
  const manifest = parseLayerManifest(JSON.parse(text('textures/blocos16.json')) as unknown);
  const layers = new Map(manifest.layers.map((l, i) => [l.name, i] as const));
  const world = buildMapWorld({
    map: decodeMap(asset(`maps/${id}.bfmap`)),
    blockDefs: parseBlockDefs(JSON.parse(text('blocks/blocks.json')) as unknown),
    blockLayer: (name) => layers.get(name),
    models: decodeModelPack(asset('models/modelos.bfmodel')).models,
  });
  return buildSimMap(world, buildMapNav(world));
}

function sandboxRecipe(map: string): MatchRecipe {
  const bots = [{ ref: builtinBotRef('normal'), count: 2 }];
  return {
    format: MATCH_RECIPE_FORMAT,
    mode: 'sandbox',
    map,
    seed: 7,
    match: { timeLimitS: 600, scoreLimit: 75 },
    teams: [{ bots }, { bots }, { bots }, { bots }],
  };
}

describe('mapas do Bobo Sandbox (M9, fase 3)', () => {
  it('a lista: o Construto, o Ringue e (M10, fase 8) a Base Bobo', () => {
    expect(mapsForMode('sandbox')).toEqual(['construto', 'ringue', 'airbase']);
  });

  for (const id of mapsForMode('sandbox')) {
    it(`${id}: os 4 times nascem em casas separadas, no chão da área, e jogam`, () => {
      const map = loadMap(id);
      const area = map.playArea!;
      const match = createHeadlessMatch({ recipe: sandboxRecipe(id), map, humans: 0 });
      const v0 = match.sim.view();
      const start: number[] = [];
      const center: [number, number, number][] = [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ];
      // O chão das bases do mapa: os times novos nascem nele (não em cima de um telhado).
      const floor = Math.min(...map.spawns.filter((sp) => sp.team === 0).map((sp) => sp.y));
      for (let e = 0; e < v0.count; e++) {
        if (v0.kind[e] !== ENTITY_KIND.bobo) continue;
        const x = v0.position[e * 3]!;
        const z = v0.position[e * 3 + 2]!;
        expect(x, `${id}: x do bobo ${e}`).toBeGreaterThan(area.minX);
        expect(x, `${id}: x do bobo ${e}`).toBeLessThan(area.maxX);
        expect(z, `${id}: z do bobo ${e}`).toBeGreaterThan(area.minZ);
        expect(z, `${id}: z do bobo ${e}`).toBeLessThan(area.maxZ);
        // M10 (fase 8): até 1 m acima do chão das bases (o degrau de 0,75 m do Construto; o muro de 2,5 m não).
        expect(Math.abs(v0.position[e * 3 + 1]! - floor), `${id}: altura do bobo ${e}`).toBeLessThan(1);
        const c = center[v0.team[e]!]!;
        c[0] += x;
        c[1] += z;
        c[2]++;
        start.push(e, x, z);
      }
      for (const c of center) expect(c[2]).toBe(2);
      // A casa de cada time sem ponto no mapa fica longe da base de cada time com ponto (as bases do mapa).
      const base = (t: number): readonly [number, number] => {
        const own = map.spawns.filter((sp) => sp.team === t);
        return [own.reduce((a, sp) => a + sp.x, 0) / own.length, own.reduce((a, sp) => a + sp.z, 0) / own.length];
      };
      const gaps: number[] = [];
      for (const t of [2, 3]) {
        const cx = center[t]![0] / 2;
        const cz = center[t]![1] / 2;
        for (const o of [0, 1]) {
          const [bx, bz] = base(o);
          gaps.push(Math.round(Math.hypot(cx - bx, cz - bz)));
        }
      }
      // Medido (20/11): Construto 45–48 m, Ringue 20–22 m (48 m de lado), Base Bobo 36–37 m (M10, fase 8).
      expect(Math.min(...gaps), `${id}: distâncias ${gaps.join('/')}`).toBeGreaterThan(id === 'ringue' ? 15 : 30);
      for (let t = 0; t < 20 * 60; t++) match.step();
      const v = match.sim.view();
      let moved = 0;
      for (let k = 0; k < start.length; k += 3) {
        const e = start[k]!;
        if ((v.flags[e]! & ENTITY_FLAG.dead) !== 0) continue;
        if (Math.hypot(v.position[e * 3]! - start[k + 1]!, v.position[e * 3 + 2]! - start[k + 2]!) > 2) moved++;
      }
      expect(moved, `${id}: bobos que andaram`).toBeGreaterThan(3);
      match.dispose();
      // O mapa real com a navegação leva alguns segundos com a suíte toda rodando junto.
    }, 30_000);
  }
});
