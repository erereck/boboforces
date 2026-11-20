import { BOT_FORMAT, MATCH_RECIPE_FORMAT, type MatchRecipe, type TeamRecipe } from '@boboforces/format';
import { BUTTON, WEAPON_SLOT_COUNT, type InputFrame } from '@boboforces/input';
import { buildNavGrid } from '@boboforces/nav';
import { pitchToI16, yawToU16 } from '@boboforces/shared';
import { createTestBlocks, createWorldGrid, fillBox, makeCell } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { METRICS } from './config/metrics.ts';
import { BOBO_NAV_METRICS } from './config/nav-metrics.ts';
import { WEAPON_CODE } from './config/weapons.ts';
import { BOT_CONTROLLER_BASE, SIM_HZ } from './constants.ts';
import { ENTITY_FLAG, entityIndex } from './entity.ts';
import { aimPointWorld, type AimPoint } from './hitbox.ts';
import { createInputFrames } from './loop.ts';
import { createSim, navMainComponent, type Sim, type SimMap } from './sim.ts';
import { buildSyntheticConstruto } from './testing/index.ts';

/**
 * M9 (fase 2): o Bobo Sandbox na sim. Chão plano de 40 × 40 m com o time 0 no sul, o 1 no norte e 2 pontos sem time
 * (oeste e leste, que viram a casa dos times 2 e 3); os bots são pilotados aqui, sem IA.
 */
const blocks = createTestBlocks();
const concrete = makeCell(blocks.byKey('concrete')!.id);
const B = BOT_CONTROLLER_BASE;
const PAST_PROTECTION = Math.round(1.6 * SIM_HZ);
const NONE = 255;

function flatMap(): SimMap {
  const grid = createWorldGrid(80, 12, 80);
  fillBox(grid, 0, 0, 0, 79, 0, 79, concrete);
  return {
    grid,
    blocks,
    spawns: [
      { x: 20, y: 0.5, z: 34, yaw: 0, team: 0 },
      { x: 20, y: 0.5, z: 6, yaw: Math.PI, team: 1 },
      { x: 4, y: 0.5, z: 20, yaw: 0, team: -1 },
      { x: 36, y: 0.5, z: 20, yaw: 0, team: -1 },
    ],
  };
}

const bots = (count: number, extra: Partial<TeamRecipe> = {}): TeamRecipe => ({
  bots: [{ ref: 'builtin:normal-bob', count }],
  ...extra,
});

function sandbox(teams: TeamRecipe[], extra: Partial<MatchRecipe> = {}): MatchRecipe {
  return {
    format: MATCH_RECIPE_FORMAT,
    mode: 'sandbox',
    map: 'test',
    seed: 5,
    weapons: { oneShot: true },
    teams,
    ...extra,
  };
}

const ent = (sim: Sim, c: number): number => entityIndex(sim.controllerEntity(c));
const dead = (sim: Sim, c: number): boolean => (sim.view().flags[ent(sim, c)]! & ENTITY_FLAG.dead) !== 0;

function run(sim: Sim, f: InputFrame[], ticks: number): void {
  for (let i = 0; i < ticks; i++) sim.step(f);
}

/** `from` mira no tronco de `to` e atira até derrubar (com o "um tiro mata", o 1º acerto). */
function shootDown(sim: Sim, f: InputFrame[], from: number, to: number): void {
  const p: AimPoint = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < 40 && !dead(sim, to); i++) {
    const v = sim.view();
    aimPointWorld(v, ent(sim, to), false, p);
    const a = ent(sim, from);
    const dx = p.x - v.position[a * 3]!;
    const dy = p.y - (v.position[a * 3 + 1]! + METRICS.eyeHeight);
    const dz = p.z - v.position[a * 3 + 2]!;
    f[from]!.yaw = yawToU16(Math.atan2(-dx, -dz));
    f[from]!.pitch = pitchToI16(Math.atan2(dy, Math.hypot(dx, dz)));
    f[from]!.buttons = BUTTON.fire | BUTTON.ads;
    run(sim, f, 1);
    f[from]!.buttons = 0;
    run(sim, f, 20);
  }
  expect(dead(sim, to), `o controlador ${to} caiu`).toBe(true);
}

function loadout(sim: Sim, c: number): number[] {
  const k = ent(sim, c) * WEAPON_SLOT_COUNT;
  return Array.from(sim.view().loadout.subarray(k, k + WEAPON_SLOT_COUNT));
}

describe('M9 (fase 2): a vida e as armas do time', () => {
  /**
   * Time 0: o humano e um bot Normal; time 1: um bot com regra (vida 500, só faca) e um bot Normal; com o "um tiro
   * mata".
   */
  const recipe = (mode: string): MatchRecipe =>
    sandbox(
      [
        { humans: 1, hp: 250, weapons: ['shotgun'], bots: [{ ref: 'builtin:normal-bob', count: 1 }] },
        {
          hp: 40,
          weapons: ['rifle', 'knife'],
          bots: [
            { ref: 'embedded:t', count: 1 },
            { ref: 'builtin:normal-bob', count: 1 },
          ],
        },
      ],
      {
        mode,
        embeddedBots: [
          {
            ...JSON.parse(JSON.stringify({ format: BOT_FORMAT, id: 't', name: 'Teste' })),
            rules: {
              hp: 500,
              damageMult: 1,
              speed: 1,
              ammo: 'normal',
              weapons: ['knife'],
              headshotImmune: false,
              explodeOnDeath: false,
              visionDeg: 120,
              visionRange: 1,
              hearing: 1,
              knowledge: 'normal',
            },
          },
        ],
      },
    );

  it('valem para humanos e bots; a regra do próprio bot ganha da do time', () => {
    const sim = createSim({ recipe: recipe('sandbox'), map: flatMap(), humans: 1 });
    const v = sim.view();
    expect([0, B, B + 1, B + 2].map((c) => v.health[ent(sim, c)])).toEqual([250, 250, 500, 40]);
    expect(loadout(sim, 0)).toEqual([WEAPON_CODE.shotgun, NONE, NONE, NONE]);
    expect(loadout(sim, B)).toEqual([WEAPON_CODE.shotgun, NONE, NONE, NONE]);
    expect(loadout(sim, B + 1)).toEqual([NONE, NONE, WEAPON_CODE.knife, NONE]);
    expect(loadout(sim, B + 2)).toEqual([WEAPON_CODE.rifle, NONE, WEAPON_CODE.knife, NONE]);
    // O respawn refaz o loadout com a máscara do time (o humano escolheu o fuzil: fica a escopeta).
    const f = createInputFrames();
    f[0]!.primary = WEAPON_CODE.rifle + 1;
    run(sim, f, PAST_PROTECTION);
    shootDown(sim, f, B + 2, 0);
    run(sim, f, 4 * SIM_HZ);
    expect(dead(sim, 0)).toBe(false);
    expect(loadout(sim, 0)).toEqual([WEAPON_CODE.shotgun, NONE, NONE, NONE]);
    expect(sim.view().health[ent(sim, 0)]).toBe(250);
  });

  it('as armas do time se cruzam com as permitidas da partida', () => {
    const r = recipe('sandbox');
    const both = createSim({ recipe: { ...r, weapons: { allowed: ['rifle', 'shotgun'] } }, map: flatMap(), humans: 1 });
    expect(loadout(both, B + 2)).toEqual([WEAPON_CODE.rifle, NONE, NONE, NONE]);
    // Sem nada em comum, valem as da partida (como na regra do bot).
    const none = createSim({ recipe: { ...r, weapons: { allowed: ['sniper'] } }, map: flatMap(), humans: 1 });
    expect(loadout(none, B + 2)).toEqual([WEAPON_CODE.sniper, NONE, NONE, NONE]);
  });

  it('fora do Sandbox não valem (o TDM com os mesmos campos fica igual)', () => {
    const sim = createSim({ recipe: recipe('warfare.tdm'), map: flatMap(), humans: 1 });
    const v = sim.view();
    expect([0, B, B + 2].map((c) => v.health[ent(sim, c)])).toEqual([100, 100, 100]);
    expect(loadout(sim, B + 2)).toEqual([
      WEAPON_CODE.rifle,
      WEAPON_CODE.pistol,
      WEAPON_CODE.knife,
      WEAPON_CODE.grenade,
    ]);
  });
});

describe('M9 (fase 2): o objetivo do Sandbox', () => {
  it('padrões: pontos e eliminação com 10 min (ausente na receita); "nenhum" sem tempo', () => {
    const ticks = (r: MatchRecipe): number =>
      createSim({ recipe: r, map: flatMap(), humans: 0 }).view().match.ticksLeft;
    const teams = [bots(1), bots(1)];
    expect(ticks(sandbox(teams))).toBe(600 * SIM_HZ);
    expect(ticks(sandbox(teams, { sandbox: { objective: 'elimination' } }))).toBe(600 * SIM_HZ);
    expect(ticks(sandbox(teams, { sandbox: { objective: 'none' }, match: { timeLimitS: 180 } }))).toBe(-1);
    expect(ticks(sandbox(teams, { match: { timeLimitS: 0 } }))).toBe(-1);
  });

  it('eliminação com 4 times: sem respawn; acaba quando sobra 1 time de pé', () => {
    const sim = createSim({
      recipe: sandbox([bots(1), bots(1), bots(1), bots(1)], {
        sandbox: { objective: 'elimination' },
        match: { timeLimitS: 0 },
      }),
      map: flatMap(),
      humans: 0,
    });
    const f = createInputFrames();
    run(sim, f, PAST_PROTECTION);
    shootDown(sim, f, B, B + 1);
    shootDown(sim, f, B, B + 2);
    run(sim, f, 10 * SIM_HZ);
    expect([dead(sim, B + 1), dead(sim, B + 2), sim.view().match.phase]).toEqual([true, true, 'playing']);
    shootDown(sim, f, B, B + 3);
    expect([sim.view().match.phase, sim.view().match.winnerTeam]).toEqual(['ended', 0]);
    expect(Array.from(sim.view().match.teamScore)).toEqual([3, 0, 0, 0]);
  });

  it('eliminação com 3 times: o último de pé vence (um time de fora também)', () => {
    const sim = createSim({
      recipe: sandbox([bots(1), bots(1), bots(1)], { sandbox: { objective: 'elimination' } }),
      map: flatMap(),
      humans: 0,
    });
    const f = createInputFrames();
    run(sim, f, PAST_PROTECTION);
    shootDown(sim, f, B + 2, B);
    expect(sim.view().match.phase).toBe('playing');
    shootDown(sim, f, B + 2, B + 1);
    expect([sim.view().match.phase, sim.view().match.winnerTeam]).toEqual(['ended', 2]);
  });

  it('eliminação no fim do tempo: vence quem tem mais gente viva (não o placar)', () => {
    const sim = createSim({
      recipe: sandbox([bots(1), bots(1), bots(1), bots(2)], {
        sandbox: { objective: 'elimination' },
        match: { timeLimitS: 180 },
      }),
      map: flatMap(),
      humans: 0,
    });
    const f = createInputFrames();
    run(sim, f, PAST_PROTECTION);
    shootDown(sim, f, B, B + 1);
    while (sim.view().match.phase === 'playing') sim.step(f);
    expect([sim.view().match.phase, sim.view().match.winnerTeam, sim.tick]).toEqual(['ended', 3, 180 * SIM_HZ]);
    expect(sim.view().match.teamScore[0]).toBe(1);
  });

  it('pontos: acaba na meta, com respawn', () => {
    const sim = createSim({
      recipe: sandbox([bots(1), bots(1), bots(1)], { match: { scoreLimit: 2 } }),
      map: flatMap(),
      humans: 0,
    });
    const f = createInputFrames();
    run(sim, f, PAST_PROTECTION);
    shootDown(sim, f, B, B + 1);
    run(sim, f, 4 * SIM_HZ);
    expect([dead(sim, B + 1), sim.view().match.phase]).toEqual([false, 'playing']);
    shootDown(sim, f, B, B + 2);
    expect([sim.view().match.phase, sim.view().match.winnerTeam]).toEqual(['ended', 0]);
  });

  it('"nenhum" nunca acaba, mesmo com tempo e meta na receita', () => {
    const sim = createSim({
      recipe: sandbox([bots(1), bots(1)], {
        sandbox: { objective: 'none' },
        match: { timeLimitS: 180, scoreLimit: 1 },
      }),
      map: flatMap(),
      humans: 0,
    });
    const f = createInputFrames();
    run(sim, f, PAST_PROTECTION);
    shootDown(sim, f, B, B + 1);
    run(sim, f, 181 * SIM_HZ);
    expect([sim.view().match.phase, sim.view().match.teamScore[0], dead(sim, B + 1)]).toEqual(['playing', 1, false]);
    sim.finish();
    sim.step(f);
    expect([sim.view().match.phase, sim.view().match.winnerTeam]).toEqual(['ended', 0]);
  });
});

describe('M9 (fase 2): a casa dos times 2 e 3', () => {
  /** Pés de cada bot no tick 0, por time. */
  function feet(map: SimMap, perTeam: number): { team: number; x: number; z: number }[] {
    const sim = createSim({
      recipe: sandbox([bots(perTeam), bots(perTeam), bots(perTeam), bots(perTeam)]),
      map,
      humans: 0,
    });
    const v = sim.view();
    const out: { team: number; x: number; z: number }[] = [];
    for (let e = 0; e < v.count; e++) out.push({ team: v.team[e]!, x: v.position[e * 3]!, z: v.position[e * 3 + 2]! });
    sim.dispose();
    return out;
  }

  /** A menor distância (no plano) de um bot dos times 2 e 3 até um ponto de spawn dos times 0 e 1. */
  function nearestBase(map: SimMap, list: { team: number; x: number; z: number }[]): number {
    let best = Infinity;
    for (const p of list) {
      if (p.team < 2) continue;
      for (const sp of map.spawns)
        if (sp.team === 0 || sp.team === 1) best = Math.min(best, Math.hypot(sp.x - p.x, sp.z - p.z));
    }
    return best;
  }

  it('no Construto sintético com navegação: base própria longe das bases do mapa, um time de cada lado', () => {
    const { map } = buildSyntheticConstruto({ nav: true });
    const a = feet(map, 4);
    expect(feet(map, 4)).toEqual(a);
    expect(nearestBase(map, a)).toBeGreaterThan(25);
    const center = (t: number): number => {
      const xs = a.filter((p) => p.team === t).map((p) => p.x);
      return xs.reduce((s, x) => s + x, 0) / xs.length;
    };
    // O 2 a leste e o 3 a oeste (entre a base do norte e a do sul); cada um junto (a base em cruz, 2,5 m).
    expect(center(2)).toBeGreaterThan(60);
    expect(center(3)).toBeLessThan(20);
    for (const t of [2, 3]) {
      const mine = a.filter((p) => p.team === t);
      for (const p of mine) expect(Math.hypot(p.x - mine[0]!.x, p.z - mine[0]!.z)).toBeLessThan(8);
    }
    // A navegação de teste do mapa inteiro leva alguns segundos com a suíte toda rodando junto.
  }, 30_000);

  it('sem navegação: os pontos sem time mais perto da casa viram do time', () => {
    const { map } = buildSyntheticConstruto();
    expect(nearestBase(map, feet(map, 4))).toBeGreaterThan(15);
    const flat = flatMap();
    const list = feet(flat, 1);
    expect(list.map((p) => [p.team, p.x, p.z])).toEqual([
      [0, 20, 34],
      [1, 20, 6],
      [2, 4, 20],
      [3, 36, 20],
    ]);
  });

  it('fora do Sandbox, os times 2 e 3 nascem como antes (nos pontos sem time, pela ordem)', () => {
    const sim = createSim({
      recipe: { ...sandbox([bots(1), bots(1), bots(1), bots(1)]), mode: 'warfare.tdm' },
      map: flatMap(),
      humans: 0,
    });
    const v = sim.view();
    expect([v.position[2 * 3], v.position[3 * 3]]).toEqual([4, 4]);
  });
});

describe('M10 (fase 8): a casa dos times 2 e 3 no chão', () => {
  /**
   * Chão plano de 40 × 40 m (piso a 0,5 m) com o time 0 no sul e o 1 no norte, e um quebra-vistas de 6 × 5 m e 2,5 m de
   * altura bem onde cai a casa do time 2 (oeste, x 6, z 20) e outro onde cai a do 3 (leste, x 34): o alto deles entra
   * na navegação principal (dá para descer), como os muros da Base Bobo.
   */
  function wallMap(): SimMap {
    const grid = createWorldGrid(80, 12, 80);
    fillBox(grid, 0, 0, 0, 79, 0, 79, concrete);
    fillBox(grid, 6, 1, 35, 19, 5, 44, concrete);
    fillBox(grid, 60, 1, 35, 73, 5, 44, concrete);
    return {
      grid,
      blocks,
      spawns: [
        { x: 20, y: 0.5, z: 34, yaw: 0, team: 0 },
        { x: 20, y: 0.5, z: 6, yaw: Math.PI, team: 1 },
      ],
      nav: buildNavGrid({ grid, blocks }, BOBO_NAV_METRICS),
    };
  }

  it('os pontos da base ficam no chão, em volta do muro (não em cima dele)', () => {
    const map = wallMap();
    const nav = map.nav!;
    const main = navMainComponent(nav);
    // O alto do muro (3 m) é da navegação principal: sem a preferência pelo chão, a cruz cairia nele.
    for (const x of [6, 34]) {
      const top = nav.nearestNode(x, 3, 20);
      expect(top, `alto do muro em x ${x}`).toBeGreaterThanOrEqual(0);
      expect(nav.component[top]).toBe(main);
      expect(nav.floorY[top]).toBeCloseTo(3, 5);
    }
    const sim = createSim({ recipe: sandbox([bots(4), bots(4), bots(4), bots(4)]), map, humans: 0 });
    const v = sim.view();
    const homes: Record<number, { x: number; z: number }[]> = { 2: [], 3: [] };
    for (let e = 0; e < v.count; e++) {
      const t = v.team[e]!;
      if (t < 2) continue;
      expect(v.position[e * 3 + 1], `altura do bobo ${e} (time ${t})`).toBeCloseTo(0.5, 5);
      homes[t]!.push({ x: v.position[e * 3]!, z: v.position[e * 3 + 2]! });
    }
    // Juntos, perto da casa de cada um (o 2 a oeste, o 3 a leste) e longe das bases do mapa.
    for (const [t, cx] of [
      [2, 6],
      [3, 34],
    ] as const) {
      expect(homes[t]).toHaveLength(4);
      for (const p of homes[t]!) {
        expect(Math.hypot(p.x - cx, p.z - 20), `time ${t} em (${p.x}, ${p.z})`).toBeLessThan(6);
        expect(Math.min(Math.hypot(p.x - 20, p.z - 34), Math.hypot(p.x - 20, p.z - 6))).toBeGreaterThan(12);
      }
    }
    sim.dispose();
  });
});

describe('M9 (fase 2, revisão): os furos da eliminação e das casas', () => {
  it('o time que começa vazio não ganha casa nem rouba o ponto sem time do vizinho', () => {
    const sim = createSim({ recipe: sandbox([bots(1), bots(1), { bots: [] }, bots(1)]), map: flatMap(), humans: 0 });
    const v = sim.view();
    // O time 3 fica com a casa do oeste (a que o 2 vazio pegaria), não com a do leste.
    expect([v.team[2], v.position[2 * 3], v.position[2 * 3 + 2]]).toEqual([3, 4, 20]);
    sim.dispose();
  });

  it('a eliminação sempre tem tempo: o 0 da receita vira o padrão do Sandbox', () => {
    const sim = createSim({
      recipe: sandbox([bots(1), bots(1)], { match: { timeLimitS: 0 }, sandbox: { objective: 'elimination' } }),
      map: flatMap(),
      humans: 0,
    });
    expect(sim.view().match.ticksLeft).toBeGreaterThan(0);
    sim.dispose();
  });

  it('o Destravar na eliminação não cura nem protege', () => {
    const sim = createSim({
      recipe: sandbox([{ humans: 1, bots: [] }, bots(1)], { sandbox: { objective: 'elimination' } }),
      map: flatMap(),
      humans: 1,
    });
    const f = createInputFrames(B + 1);
    run(sim, f, PAST_PROTECTION);
    const e = ent(sim, 0);
    // Sem navegação, o Destravar remonta no spawn: a vida que tinha fica.
    sim.view().health[e] = 40;
    f[0]!.buttons = BUTTON.unstuck;
    run(sim, f, 1);
    f[0]!.buttons = 0;
    run(sim, f, 1);
    const v = sim.view();
    // A regeneração do TDM soma um tiquinho; o renascer daria 100.
    expect(v.health[e]).toBeLessThan(50);
    expect(v.flags[e]! & ENTITY_FLAG.spawnProtected).toBe(0);
    sim.dispose();
  });
});
