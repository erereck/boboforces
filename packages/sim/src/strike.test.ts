import { MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import { BUTTON, type InputFrame } from '@boboforces/input';
import { BitReader, BitWriter } from '@boboforces/shared';
import { cellCenter, createTestBlocks, createWorldGrid, fillBox, makeCell, type MapSpawn } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { WEAPON_CODE, WEAPON_SLOT } from './config/weapons.ts';
import { SIM_HZ } from './constants.ts';
import { ENTITY_FLAG, entityIndex } from './entity.ts';
import { createInputFrames } from './loop.ts';
import { createSim, type Sim, type SimMap } from './sim.ts';
import { ROUND, ROUND_PHASE } from './systems/rounds.ts';
import { BOMB, STRIKE, STRIKE_BUY_BASE, STRIKE_DATA } from './systems/strike.ts';

/**
 * M7 (fase 2): o BoboStrike na sim. Um chão plano com 2 sites (A no oeste, B no leste); um atacante (o controlador 0,
 * time 0) e um defensor (o controlador 1, time 1), sem IA: as entradas e as posições são escritas aqui.
 */
const blocks = createTestBlocks();
const concrete = makeCell(blocks.byKey('concrete')!.id);
const SITE_A = { x: 10, y: 0.5, z: 15, radius: 3 };
const SITE_B = { x: 30, y: 0.5, z: 15, radius: 3 };

function flatMap(): SimMap {
  const grid = createWorldGrid(80, 16, 120);
  fillBox(grid, 0, 0, 0, 79, 0, 119, concrete);
  const spawns: MapSpawn[] = [
    { x: cellCenter(40), y: 0.5, z: cellCenter(100), yaw: 0, team: 0 },
    { x: cellCenter(44), y: 0.5, z: cellCenter(100), yaw: 0, team: 0 },
    { x: cellCenter(40), y: 0.5, z: cellCenter(20), yaw: Math.PI, team: 1 },
    { x: cellCenter(44), y: 0.5, z: cellCenter(20), yaw: Math.PI, team: 1 },
  ];
  return { grid, blocks, spawns, bombSites: [SITE_A, SITE_B] };
}

const recipe: MatchRecipe = {
  format: MATCH_RECIPE_FORMAT,
  mode: 'strike',
  map: 'test',
  seed: 3,
  teams: [
    { humans: 1, bots: [] },
    { humans: 1, bots: [] },
  ],
};

const entity = (sim: Sim, c: number): number => entityIndex(sim.controllerEntity(c));
const DEAD = ENTITY_FLAG.dead;

function put(sim: Sim, e: number, x: number, z: number): void {
  const v = sim.view();
  v.position[e * 3] = x;
  v.position[e * 3 + 1] = 0.5;
  v.position[e * 3 + 2] = z;
}

/** Roda até a fase da rodada `phase` (ou o fim da partida). */
function until(sim: Sim, f: InputFrame[], phase: number, round = -1): void {
  const r = sim.view().rounds!.data;
  for (let t = 0; t < 200 * SIM_HZ; t++) {
    if (sim.view().match.phase === 'ended') return;
    if (r[ROUND.phase] === phase && (round < 0 || r[ROUND.round] === round)) return;
    sim.step(f);
  }
  throw new Error('a rodada não chegou na fase');
}

describe('BoboStrike na sim (M7 fase 2)', () => {
  it('compra, planta, desarma e explode; a economia, o colete, a troca de lado', () => {
    const sim = createSim({ recipe, map: flatMap(), humans: 2 });
    const v = sim.view();
    const r = v.rounds!.data;
    const st = v.strike!.data;
    const atk = entity(sim, 0);
    const def = entity(sim, 1);
    const f = createInputFrames();
    sim.step(f);
    // Rodada 1, na compra: 800 de dinheiro, só a pistola, e o atacante com a Boom Box.
    expect(r[ROUND.round]).toBe(1);
    expect(r[ROUND.phase]).toBe(ROUND_PHASE.buy);
    expect(v.points[atk]).toBe(STRIKE.startMoney);
    expect(v.loadout[atk * 4 + WEAPON_SLOT.primary]).not.toBe(WEAPON_CODE.rifle);
    expect(st[STRIKE_DATA.carrier]! >>> 0).toBe(sim.controllerEntity(0));
    // O fuzil não dá (2700); o colete de 50 dá (650). A entrada repetida não compra duas vezes.
    f[0]!.primary = STRIKE_BUY_BASE + 2;
    sim.step(f);
    expect(v.points[atk]).toBe(STRIKE.startMoney);
    f[0]!.primary = STRIKE_BUY_BASE + 4;
    sim.step(f);
    sim.step(f);
    f[0]!.primary = 0;
    expect(v.armor[atk]).toBe(50);
    expect(v.points[atk]).toBe(STRIKE.startMoney - 650);

    // Valendo: o atacante vai ao site A e segura o usar 3 s: plantada.
    until(sim, f, ROUND_PHASE.live);
    put(sim, atk, SITE_A.x, SITE_A.z);
    f[0]!.buttons = BUTTON.use;
    for (let t = 0; t < STRIKE.plantS * SIM_HZ + 2 && st[STRIKE_DATA.bomb] !== BOMB.planted; t++) sim.step(f);
    f[0]!.buttons = 0;
    expect(st[STRIKE_DATA.bomb]).toBe(BOMB.planted);
    expect(st[STRIKE_DATA.site]).toBe(0);
    expect(v.points[atk]).toBe(STRIKE.startMoney - 650 + STRIKE.plantMoney);

    // Snapshot no meio: a bomba vai junto (e o hash).
    const copy = createSim({ recipe, map: flatMap(), humans: 2 });
    const w = new BitWriter(256 * 1024);
    sim.writeSnapshot(w);
    copy.readSnapshot(new BitReader(w.bytes()));
    expect(copy.stateHash()).toEqual(sim.stateHash());
    copy.dispose();

    // O defensor desarma (7 s sem kit): os defensores levam a rodada; o dinheiro das faixas.
    put(sim, def, v.strike!.pos[0]! + 0.5, v.strike!.pos[2]!);
    put(sim, atk, 40, 50);
    f[1]!.buttons = BUTTON.use;
    for (let t = 0; t < STRIKE.defuseS * SIM_HZ + 2 && r[ROUND.phase] === ROUND_PHASE.live; t++) sim.step(f);
    f[1]!.buttons = 0;
    expect(st[STRIKE_DATA.bomb]).toBe(BOMB.defused);
    expect(r[ROUND.winner]).toBe(1);
    expect(r[ROUND.wins1]).toBe(1);
    expect(v.points[def]).toBe(STRIKE.startMoney + STRIKE.winMoney);
    expect(v.points[atk]).toBe(STRIKE.startMoney - 650 + STRIKE.plantMoney + STRIKE.lossMoney);

    // Rodada 2: quem sobreviveu guarda o colete. Planta e deixa explodir com o defensor do lado: os atacantes levam.
    until(sim, f, ROUND_PHASE.live, 2);
    expect(v.armor[atk]).toBe(50);
    put(sim, atk, SITE_B.x, SITE_B.z);
    f[0]!.buttons = BUTTON.use;
    for (let t = 0; t < STRIKE.plantS * SIM_HZ + 2 && st[STRIKE_DATA.bomb] !== BOMB.planted; t++) sim.step(f);
    f[0]!.buttons = 0;
    put(sim, atk, 40, 50);
    put(sim, def, SITE_B.x + 2, SITE_B.z);
    for (let t = 0; t < (STRIKE.bombS + 1) * SIM_HZ && r[ROUND.phase] === ROUND_PHASE.live; t++) sim.step(f);
    expect(st[STRIKE_DATA.bomb]).toBe(BOMB.exploded);
    // O dano da explosão entra no tick seguinte (a fila de dano).
    sim.step(f);
    expect(v.flags[def]! & DEAD).not.toBe(0);
    expect(r[ROUND.winner]).toBe(0);
    expect(r[ROUND.wins0]).toBe(1);

    // Rodadas 3 a 6: o atacante cai no vazio na largada (os defensores levam); na 7ª, os lados trocam e o dinheiro zera.
    for (let round = 3; round <= 6; round++) {
      until(sim, f, ROUND_PHASE.live, round);
      sim.view().position[atk * 3 + 1] = -100;
      until(sim, f, ROUND_PHASE.over);
    }
    until(sim, f, ROUND_PHASE.buy, 7);
    expect(r[ROUND.swapped]).toBe(1);
    expect(r[ROUND.wins1]).toBe(5);
    expect(v.points[atk]).toBe(STRIKE.startMoney);
    expect(v.points[def]).toBe(STRIKE.startMoney);
    // O time 1 ataca agora (a bomba é do controlador 1) e nasce nos pontos do lado de ataque (o time 0 do mapa).
    expect(st[STRIKE_DATA.carrier]! >>> 0).toBe(sim.controllerEntity(1));
    expect(v.position[def * 3 + 2]).toBeGreaterThan(40);
    // Rodada 7: o novo atacante (o controlador 1) cai: os defensores (o time 0) levam; até 7 vitórias acaba.
    until(sim, f, ROUND_PHASE.live, 7);
    sim.view().position[def * 3 + 1] = -100;
    until(sim, f, ROUND_PHASE.over);
    expect(r[ROUND.wins0]).toBe(2);
    for (let round = 8; round <= 12 && v.match.phase !== 'ended'; round++) {
      until(sim, f, ROUND_PHASE.live, round);
      sim.view().position[def * 3 + 1] = -100;
      until(sim, f, ROUND_PHASE.over);
    }
    for (let t = 0; t < (STRIKE.overS + 1) * SIM_HZ && v.match.phase !== 'ended'; t++) sim.step(f);
    expect(v.match.phase).toBe('ended');
    expect(v.match.winnerTeam).toBe(0);
    sim.dispose();
  });
});

describe('BoboStrike na sim: a revisão (M7 fase 2)', () => {
  it('a compra é na borda do quadro; a bomba que cai no vazio passa a outro atacante', () => {
    const two: MatchRecipe = {
      ...recipe,
      teams: [
        { humans: 2, bots: [] },
        { humans: 1, bots: [] },
      ],
    };
    const sim = createSim({ recipe: two, map: flatMap(), humans: 3 });
    const v = sim.view();
    const st = v.strike!.data;
    const a0 = entity(sim, 0);
    const a1 = entity(sim, 1);
    const f = createInputFrames();
    // O colete de 50 pedido e deixado no quadro: compra uma vez só (a rodada seguinte não recompra sozinha).
    f[0]!.primary = STRIKE_BUY_BASE + 4;
    sim.step(f);
    sim.step(f);
    expect(v.armor[a0]).toBe(50);
    expect(v.points[a0]).toBe(STRIKE.startMoney - 650);
    // O portador cai no vazio: a bomba vai para o outro atacante (não fica lá embaixo).
    until(sim, f, ROUND_PHASE.live);
    const carrier = st[STRIKE_DATA.carrier]! >>> 0;
    const c = carrier & 0xffff;
    const other = c === a0 ? a1 : a0;
    v.position[c * 3 + 1] = -100;
    for (let t = 0; t < 3; t++) sim.step(f);
    expect(v.flags[c]! & DEAD).not.toBe(0);
    expect(st[STRIKE_DATA.bomb]).toBe(BOMB.carried);
    expect(st[STRIKE_DATA.carrier]! >>> 0).toBe(sim.controllerEntity(other === a0 ? 0 : 1));
    sim.dispose();
  });
});
