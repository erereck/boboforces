import { MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import { quantizeAxis } from '@boboforces/input';
import { BitReader, BitWriter } from '@boboforces/shared';
import { cellCenter, createTestBlocks, createWorldGrid, fillBox, makeCell, type MapSpawn } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { SIM_HZ } from './constants.ts';
import { ENTITY_FLAG, entityIndex } from './entity.ts';
import { createInputFrames } from './loop.ts';
import { createSim, type Sim, type SimMap } from './sim.ts';
import { JUGG_FIXED, juggernautHp } from './systems/party.ts';
import { ROUND, ROUND_PHASE } from './systems/rounds.ts';

/**
 * M7 (fase 0): o motor de rodadas pelo Juggernaut Fixo. Três humanos num chão plano: cada rodada, o da vez (pela ordem
 * dos controladores) é o Jugg; a compra segura todo mundo parado; o Jugg que cai entrega a rodada aos caçadores e o
 * que aguenta o tempo leva a dele; depois de 3 rodadas (uma por participante), vence quem tem mais pontos de Jugg.
 */
const blocks = createTestBlocks();
const concrete = makeCell(blocks.byKey('concrete')!.id);

function flatMap(): SimMap {
  const grid = createWorldGrid(40, 16, 80);
  fillBox(grid, 0, 0, 0, 39, 0, 79, concrete);
  const spawns: MapSpawn[] = [
    { x: cellCenter(10), y: 0.5, z: cellCenter(30), yaw: 0, team: -1 },
    { x: cellCenter(26), y: 0.5, z: cellCenter(30), yaw: 0, team: -1 },
    { x: cellCenter(18), y: 0.5, z: cellCenter(44), yaw: 0, team: -1 },
  ];
  return { grid, blocks, spawns };
}

const recipe: MatchRecipe = {
  format: MATCH_RECIPE_FORMAT,
  mode: 'juggernaut',
  map: 'test',
  seed: 5,
  match: { timeLimitS: 0, scoreLimit: 0 },
  juggernaut: { variant: 'fixed' },
  teams: [{ humans: 'all', bots: [] }, { bots: [] }],
};

const entity = (sim: Sim, c: number): number => entityIndex(sim.controllerEntity(c));
const DEAD = ENTITY_FLAG.dead;

describe('rodadas: o Juggernaut Fixo (M7 fase 0)', () => {
  it('cada um é o Jugg numa rodada; a compra congela; cair entrega a rodada; o tempo dá a rodada ao Jugg', () => {
    const sim = createSim({ recipe, map: flatMap(), humans: 3 });
    const v = sim.view();
    const r = v.rounds!;
    expect(r).not.toBeNull();
    expect(r.totalRounds).toBe(3);
    const f = createInputFrames();
    sim.step(f);
    // Rodada 1: o controlador 0 é o Jugg, com a vida de Jugg contra 2 caçadores; a largada é parada.
    expect(r.data[ROUND.round]).toBe(1);
    expect(r.data[ROUND.phase]).toBe(ROUND_PHASE.buy);
    const j0 = entity(sim, 0);
    expect(v.team[j0]).toBe(1);
    expect(v.health[j0]).toBe(juggernautHp(2));
    expect(v.team[entity(sim, 1)]).toBe(0);
    const z0 = v.position[j0 * 3 + 2]!;
    f[0]!.moveY = quantizeAxis(1);
    for (let t = 0; t < JUGG_FIXED.startS * SIM_HZ - 2; t++) sim.step(f);
    expect(r.data[ROUND.phase]).toBe(ROUND_PHASE.buy);
    expect(v.position[j0 * 3 + 2]).toBeCloseTo(z0, 5);
    for (let t = 0; t < 3; t++) sim.step(f);
    expect(r.data[ROUND.phase]).toBe(ROUND_PHASE.live);
    f[0]!.moveY = 0;
    // 2 s valendo: 2 pontos de Jugg. Depois ele cai no vazio: os caçadores levam a rodada.
    for (let t = 0; t < 2 * SIM_HZ; t++) sim.step(f);
    expect(v.points[j0]).toBe(2);
    v.position[j0 * 3 + 1] = -100;
    for (let t = 0; t < 3 && r.data[ROUND.phase] === ROUND_PHASE.live; t++) sim.step(f);
    expect(r.data[ROUND.phase]).toBe(ROUND_PHASE.over);
    expect(r.data[ROUND.winner]).toBe(0);
    expect(r.data[ROUND.wins0]).toBe(1);

    // Snapshot no meio: as rodadas vão juntas (e o hash).
    const copy = createSim({ recipe, map: flatMap(), humans: 3 });
    const w = new BitWriter(256 * 1024);
    sim.writeSnapshot(w);
    copy.readSnapshot(new BitReader(w.bytes()));
    expect(copy.stateHash()).toEqual(sim.stateHash());
    expect(copy.view().rounds!.data[ROUND.wins0]).toBe(1);
    copy.dispose();

    // Rodada 2: o controlador 1 é o Jugg e aguenta os 3 min.
    for (let t = 0; t < (JUGG_FIXED.overS + JUGG_FIXED.startS + 1) * SIM_HZ && r.data[ROUND.round]! < 2; t++) {
      sim.step(f);
    }
    expect(r.data[ROUND.round]).toBe(2);
    const j1 = entity(sim, 1);
    expect(v.team[j1]).toBe(1);
    expect(v.team[j0]).toBe(0);
    expect(v.flags[j0]! & DEAD).toBe(0);
    for (let t = 0; t < (JUGG_FIXED.startS + JUGG_FIXED.roundS + 1) * SIM_HZ && r.data[ROUND.phase] !== 2; t++) {
      sim.step(f);
    }
    expect(r.data[ROUND.winner]).toBe(1);
    expect(r.data[ROUND.wins1]).toBe(1);
    expect(v.points[j1]).toBe(JUGG_FIXED.roundS);

    // Rodada 3: o controlador 2 cai na hora; depois dela, a partida acaba com o controlador 1 na frente.
    for (let t = 0; t < (JUGG_FIXED.overS + 1) * SIM_HZ && r.data[ROUND.round]! < 3; t++) sim.step(f);
    expect(r.data[ROUND.round]).toBe(3);
    const j2 = entity(sim, 2);
    expect(v.team[j2]).toBe(1);
    for (let t = 0; t < JUGG_FIXED.startS * SIM_HZ + 1; t++) sim.step(f);
    v.position[j2 * 3 + 1] = -100;
    for (let t = 0; t < (JUGG_FIXED.overS + 2) * SIM_HZ && v.match.phase !== 'ended'; t++) sim.step(f);
    expect(v.match.phase).toBe('ended');
    expect(v.match.winnerEntity).toBe(sim.controllerEntity(1));
    sim.dispose();
  });
});
