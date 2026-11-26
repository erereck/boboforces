import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  decodeMap,
  decodeModelPack,
  MATCH_RECIPE_FORMAT,
  parseLayerManifest,
  type MatchRecipe,
} from '@boboforces/format';
import { BUTTON, quantizeAxis } from '@boboforces/input';
import { yawToU16 } from '@boboforces/shared';
import { createInputFrames, createSim, ENTITY_FLAG, entityIndex, type SimMap } from '@boboforces/sim';
import { parseBlockDefs } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { buildMapNav, buildMapWorld, buildSimMap } from './world.ts';

/**
 * M11 (fase 1, revisão): os pulos do humano perto dos poleiros fechados do Construto e da Base Bobo, na SIM (o `.bfmap`
 * de verdade). O passe de pulos do `mapc` (`tools/mapc/src/jump-reach.ts`) só vê nós da navegação; o topo de tela, de
 * corrimão ou de prop não tem nó, e a sim deixa pousar neles por cima (o painel não é degrau nem se escala, mas dá pé). A
 * 1ª versão das telas do lance da torre acompanhava os degraus (2 m acima de cada um): quem pulava do degrau de cima
 * para baixo pousava nela, e dali ia ao telhado do Bloco Leste (visada de 66 m) e ao teto da cabine. Aqui, os roteiros
 * que acharam isso na revisão e varreduras de pulos correndo (16 direções, 2 tempos de pulo, com e sem passo de lado):
 * em volta da torre, ninguém fica em pé no telhado do Bloco Leste, no teto da cabine, no topo do contraforte, em cima
 * das telas nem acima do patamar C; na Base Bobo, em volta das pilhas que subiram para 2 m, do jipe e dos caixotes de
 * 1 m, ninguém fica acima de 2,5 m (o chão mais alto da navegação lá é o caixote de 1 m, a 2 m).
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const RUNTIME = JSON.parse(readFileSync(join(ROOT, 'assets-src', 'runtime-assets.json'), 'utf8')) as {
  files: Record<string, string>;
};
const asset = (logical: string): Uint8Array =>
  new Uint8Array(readFileSync(join(ROOT, 'assets-src', RUNTIME.files[logical] as string)));
const text = (logical: string): string => new TextDecoder().decode(asset(logical));

function loadMap(id: 'construto' | 'airbase'): SimMap {
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

interface Spot {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly ground: boolean;
}
interface Step {
  readonly yaw?: number;
  readonly moveX?: number;
  readonly moveY?: number;
  readonly jump?: boolean;
  readonly sprint?: boolean;
}

const recipe = (map: string): MatchRecipe => ({
  format: MATCH_RECIPE_FORMAT,
  mode: 'warfare.tdm',
  map,
  seed: 1,
  match: { timeLimitS: 0 },
  teams: [{ humans: 1, bots: [] }, { bots: [] }],
});

type Map3 = { readonly id: string; readonly map: SimMap };

/** Um humano que nasce em (x, y, z) e segue `plan` por `ticks`; devolve a trilha (pés e se está no chão). */
function walk(m: Map3, start: { x: number; y: number; z: number }, ticks: number, plan: (t: number, s: Spot) => Step) {
  const sim = createSim({
    recipe: recipe(m.id),
    map: { ...m.map, spawns: [{ ...start, yaw: 0, team: 0 }] },
    humans: 1,
  });
  const frames = createInputFrames();
  const frame = frames[0]!;
  const e = entityIndex(sim.controllerEntity(0));
  const v = sim.view();
  const trail: Spot[] = [];
  let now: Spot = { x: v.position[e * 3]!, y: v.position[e * 3 + 1]!, z: v.position[e * 3 + 2]!, ground: true };
  for (let t = 0; t < ticks; t++) {
    const p = plan(t, now);
    frame.moveX = quantizeAxis(p.moveX ?? 0);
    frame.moveY = quantizeAxis(p.moveY ?? 0);
    frame.yaw = yawToU16(p.yaw ?? 0);
    frame.buttons = (p.jump === true ? BUTTON.jump : 0) | (p.sprint === true ? BUTTON.sprint : 0);
    sim.step(frames);
    now = {
      x: v.position[e * 3]!,
      y: v.position[e * 3 + 1]!,
      z: v.position[e * 3 + 2]!,
      ground: (v.flags[e]! & ENTITY_FLAG.onGround) !== 0,
    };
    trail.push(now);
  }
  sim.dispose();
  return trail;
}

/**
 * Pulos correndo de cada ponto de `starts`: 16 direções, pulo no tick 9 ou 15 (depois de 1 ou 7 ticks correndo), com e
 * sem passo de lado. Devolve o 1º achado de cada motivo de `forbidden`.
 */
function sweep(m: Map3, starts: readonly { x: number; y: number; z: number }[], forbidden: (p: Spot) => string | null) {
  const found = new Map<string, string>();
  for (const s of starts) {
    for (let i = 0; i < 16; i++) {
      const yaw = (i / 16) * Math.PI * 2;
      for (const jt of [9, 15]) {
        for (const moveX of [0, 0.7, -0.7]) {
          const trail = walk(m, s, 110, (k) => (k < 8 ? {} : { yaw, moveY: 1, moveX, sprint: true, jump: k === jt }));
          for (const p of trail) {
            const why = forbidden(p);
            if (why !== null && !found.has(why)) found.set(why, `${why}: de ${at({ ...s, ground: true })} → ${at(p)}`);
          }
        }
      }
    }
  }
  return [...found.values()];
}

/** Em volta da torre do Construto: onde não se pode ficar em pé (null = em lugar nenhum disso). */
function towerForbidden(p: Spot): string | null {
  if (!p.ground) return null;
  if (p.x >= 52 && p.x <= 60 && p.z >= 42 && p.z <= 50 && p.y > 6.5) return 'telhado do Bloco Leste';
  if (p.x >= 36 && p.x <= 42 && p.z >= 36 && p.z <= 42 && p.y > 11) return 'teto da cabine';
  if (p.x >= 36 && p.x <= 42.3 && p.z >= 41.7 && p.z <= 43.8 && p.y > 5.5 && p.y < 7) return 'topo do contraforte';
  // A tela oeste (x 43,5–44) e a leste (x 46–46,5) do lance, z 39–44: em pé no lance o centro fica a 0,3 m dela.
  const onScreen = (p.x > 43.45 && p.x < 44.05) || (p.x > 45.95 && p.x < 46.6);
  if (onScreen && p.z > 38.9 && p.z < 44.1 && p.y > 4.2) return 'em cima da tela';
  if (p.y > 9.2) return 'acima do patamar C';
  return null;
}

const at = (p: Spot): string => `(${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`;

describe('M11 (fase 1): os pulos em volta da escada da torre do Construto, na sim', () => {
  const m: Map3 = { id: 'construto', map: loadMap('construto') };

  it('os roteiros da revisão: do degrau não se pousa na tela, nem no telhado do Bloco Leste, nem no teto da cabine', () => {
    // Leste: do degrau (pés a 7,5), de frente e de lado para +Z, pula no tick 3; depois corre para leste e pula.
    let reached = -1;
    const east = walk(m, { x: 45.6, y: 7.5, z: 40.82 }, 400, (k, s) => {
      if (reached < 0 && s.ground && k > 3) reached = k;
      if (reached < 0) return { yaw: -Math.PI / 2, moveY: 1, moveX: 0.8, jump: k === 3 };
      return { yaw: -Math.PI / 2, moveY: 1, sprint: true, jump: k === reached + 25 };
    });
    // Oeste: do degrau, de lado para -Z, pula no tick 3; depois pulinhos para o norte e para oeste (o teto da cabine).
    const west = walk(m, { x: 44.4, y: 7.5, z: 40.98 }, 400, (k, s) =>
      k < 60
        ? { yaw: Math.PI / 2, moveY: 1, moveX: -0.6, jump: k === 3 }
        : { yaw: Math.PI / 2, moveX: k < 200 ? 1 : 0, moveY: k < 200 ? 0 : 1, jump: s.ground && k % 30 === 0 },
    );
    for (const trail of [east, west]) {
      const bad = trail.map((p) => [towerForbidden(p), p] as const).find(([why]) => why !== null);
      expect(bad === undefined ? null : `${bad[0]} em ${at(bad[1])}`).toBeNull();
    }
  });

  it('nenhum pulo correndo do lance, dos patamares, da cabine, do maciço ou da passarela fica em pé onde não deve', () => {
    const starts: { x: number; y: number; z: number }[] = [];
    // O lance (x 44–46, z 39–44, de 4 a 9 m), 3 faixas; o patamar C (9 m, z 37–39) e a porta da cabine.
    for (let t = 0; t < 10; t++) {
      for (const x of [44.35, 45.0, 45.6]) starts.push({ x, y: 4.5 + 0.5 * t, z: Math.max(39.4, 43.75 - 0.5 * t) });
    }
    for (const x of [42.4, 43.5, 44.6, 45.3]) for (const z of [37.8, 38.6]) starts.push({ x, y: 9, z });
    starts.push({ x: 40.8, y: 9, z: 38.5 });
    // O topo do maciço do poço (4 m), o patamar A (4 m) e a passarela (4 m).
    for (const z of [39.6, 41.5, 43.5]) starts.push({ x: 42.6, y: 4, z });
    starts.push({ x: 43, y: 4, z: 44.6 }, { x: 45.3, y: 4, z: 45.4 }, { x: 43, y: 4, z: 45.5 });
    starts.push({ x: 47.5, y: 4, z: 45 }, { x: 50.5, y: 4, z: 45 });
    expect(sweep(m, starts, towerForbidden)).toEqual([]);
  }, 240_000);
});

describe('M11 (fase 1): os pulos em volta das pilhas da Base Bobo, na sim', () => {
  it('em volta das pilhas que subiram para 2 m, do jipe e dos caixotes de 1 m, ninguém fica acima de 2,5 m', () => {
    const m: Map3 = { id: 'airbase', map: loadMap('airbase') };
    const starts: { x: number; y: number; z: number }[] = [];
    // Cada pilha (centro, meia largura em x e em z): a 0,8 m de cada face, no chão.
    const piles: [number, number, number, number][] = [
      [23, 7.5, 1, 1.5], // hangar (era 1,5 m)
      [9.75, 21.75, 0.75, 0.75], // hangar, perto do portão (era 1,5 m)
      [55, 13, 1, 1], // site B (era 1,5 m)
      [65, 45, 1, 1], // rota leste (era 1,5 m)
      [11.75, 50.75, 0.75, 0.75], // rota oeste (era 1 m)
      [7, 16, 1, 1], // hangar, a de 2 m que já era
      [60, 8.5, 0.75, 1.5], // site B, a de 2 m que já era
      [50.25, 8, 1.25, 3], // o contêiner do site B (2,5 m)
      [16.25, 6.5, 1.5, 0.75], // o jipe do hangar
    ];
    for (const [cx, cz, hx, hz] of piles) {
      for (const [dx, dz] of [
        [hx + 0.8, 0],
        [-hx - 0.8, 0],
        [0, hz + 0.8],
        [0, -hz - 0.8],
      ] as const) {
        starts.push({ x: cx + dx, y: 1, z: cz + dz });
      }
    }
    // Em cima do capô do jipe (0,94 m) e dos caixotes de 1 m do hangar e do pátio de carga.
    starts.push(
      { x: 15.5, y: 1.95, z: 6.5 },
      { x: 16.5, y: 1.95, z: 6.5 },
      { x: 21.5, y: 2, z: 21 },
      { x: 51, y: 2, z: 20.75 },
    );
    expect(sweep(m, starts, (p) => (p.ground && p.y > 2.5 ? 'acima de 2,5 m' : null))).toEqual([]);
  }, 240_000);
});
