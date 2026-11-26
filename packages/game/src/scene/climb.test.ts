import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHeadlessMatch, createSteer, NAV_PATH_API, PathFollower, PathService } from '@boboforces/ai';
import {
  decodeMap,
  decodeModelPack,
  MATCH_RECIPE_FORMAT,
  parseLayerManifest,
  type MatchRecipe,
} from '@boboforces/format';
import { BUTTON, type InputFrame } from '@boboforces/input';
import { yawToU16 } from '@boboforces/shared';
import { ENTITY_FLAG, ENTITY_KIND, type Sim, type SimMap } from '@boboforces/sim';
import { parseBlockDefs } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { buildMapNav, buildMapWorld, buildSimMap } from './world.ts';

/**
 * M10 (fase 1c): o seguidor de rota da IA sobe as escadas retas do Construto de verdade (o `.bfmap` montado pelo
 * caminho do loading). Antes, o lance de 5 m da torre e os de 3 m dos Prédios de Teste 1 e 3 eram inalcançáveis: a rota
 * suavizada junta o lance num segmento só e o seguidor achava que o bot tinha caído no pé dele (dezenas de rotas
 * largadas e pedidas de novo; nenhum bot ficou no topo da torre em 3 partidas TDM). Um humano guiado pelo `PathService`
 * sai do spawn de cada time e precisa chegar sem largar a rota nenhuma vez.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const RUNTIME = JSON.parse(readFileSync(join(ROOT, 'assets-src', 'runtime-assets.json'), 'utf8')) as {
  files: Record<string, string>;
};
const asset = (logical: string): Uint8Array =>
  new Uint8Array(readFileSync(join(ROOT, 'assets-src', RUNTIME.files[logical] as string)));
const text = (logical: string): string => new TextDecoder().decode(asset(logical));

function loadMap(id: string): SimMap {
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

/** Um humano do time `team` guiado pelo `PathService` até (gx, gy, gz): quando chegou (s) e as rotas largadas. */
function climb(map: SimMap, team: 0 | 1, gx: number, gy: number, gz: number, maxS: number) {
  const f = new PathFollower(0);
  const service = new PathService(NAV_PATH_API, [f]);
  service.bind(map.nav ?? null);
  const steer = createSteer();
  const human = { humans: 1, bots: [] };
  const recipe: MatchRecipe = {
    format: MATCH_RECIPE_FORMAT,
    mode: 'warfare.tdm',
    map: 'construto',
    seed: 1,
    match: { timeLimitS: 0 },
    teams: team === 0 ? [human, { bots: [] }] : [{ bots: [] }, human],
  };
  let tick = 0;
  let me = -1;
  let reachedS = Infinity;
  let drops = 0;
  const match = createHeadlessMatch({
    recipe,
    map,
    humans: 1,
    writeHumans: (frames: InputFrame[], sim: Sim) => {
      const v = sim.view();
      if (me < 0) for (let e = 0; e < v.count; e++) if (v.kind[e] === ENTITY_KIND.bobo) me = e;
      const x = v.position[me * 3]!;
      const y = v.position[me * 3 + 1]!;
      const z = v.position[me * 3 + 2]!;
      if (reachedS === Infinity && Math.hypot(x - gx, z - gz) < 1.5 && Math.abs(y - gy) < 0.3) reachedS = tick / sim.hz;
      service.want(f, x, y, z, gx, gy, gz, tick, 30);
      service.service();
      const frame = frames[0]!;
      frame.moveX = 0;
      frame.moveY = 0;
      frame.buttons = 0;
      const before = f.hasRoute;
      const ok = service.steer(f, x, y, z, (v.flags[me]! & ENTITY_FLAG.onGround) !== 0, steer);
      if (before && !ok && !f.arrived) drops++;
      if (ok) {
        frame.yaw = yawToU16(Math.atan2(-steer.x, -steer.z));
        frame.moveY = 127;
        if (steer.jump) frame.buttons |= BUTTON.jump;
      }
      tick++;
    },
  });
  for (let t = 0; t < maxS * match.sim.hz && reachedS === Infinity; t++) match.step();
  match.dispose();
  return { reachedS, drops };
}

describe('M10 (fase 1c): os bots sobem as escadas retas do Construto', () => {
  const map = loadMap('construto');
  const targets: [name: string, x: number, y: number, z: number][] = [
    ['topo da torre (lance de 5 m)', 39, 9, 39],
    ['1º andar do Prédio de Teste 1 (lance de 3 m)', 18, 4, 16],
    ['1º andar do Prédio de Teste 3 (lance de 3 m)', 63, 4, 66],
  ];
  for (const team of [0, 1] as const) {
    for (const [name, x, y, z] of targets) {
      it(`do spawn do time ${team} ao ${name}`, () => {
        const r = climb(map, team, x, y, z, 40);
        expect(r.drops, name).toBe(0);
        expect(r.reachedS, name).toBeLessThan(30);
      });
    }
  }
});
