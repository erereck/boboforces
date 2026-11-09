import { BOT_FORMAT, levelBot, MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import { buildNavGrid } from '@boboforces/nav';
import { yawToU16 } from '@boboforces/shared';
import {
  BOBO_NAV_METRICS,
  BOT_CONTROLLER_BASE,
  SIM_HZ,
  WEAPON_CODE,
  WEAPON_GRENADE,
  type SimMap,
} from '@boboforces/sim';
import { createTestBlocks, createWorldGrid, fillBox, makeCell } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { createHeadlessMatch } from './headless.ts';
import { throwPitch } from './tactics2.ts';

/** M2, fase 3d: o N2 (gameplay.md §6.3): o arco da granada e a granada em quem se escondeu. */

describe('arco da granada', () => {
  it('o ângulo baixo leva a granada ao alvo (integrando o voo como a sim); longe demais, NaN', () => {
    const v = WEAPON_GRENADE.projectileSpeed;
    const g = WEAPON_GRENADE.projectileGravity;
    for (const [d, dy] of [
      [8, 0],
      [15, -1.5],
      [12, 2],
    ] as const) {
      const a = throwPitch(d, dy, v, g);
      expect(a).toBeGreaterThan(-Math.PI / 2);
      // Voo até cruzar a distância no plano: a altura bate com dy.
      const tFlight = d / (v * Math.cos(a));
      const y = v * Math.sin(a) * tFlight - 0.5 * g * tFlight * tFlight;
      expect(y).toBeCloseTo(dy, 6);
    }
    expect(Number.isNaN(throwPitch(100, 0, v, g))).toBe(true);
  });
});

describe('N2: granada', () => {
  const blocks = createTestBlocks();
  const concrete = makeCell(blocks.byKey('concrete')!.id);

  /** O humano começa à vista do bot e anda para trás de uma parede alta à direita dele. */
  function arena(): SimMap {
    const grid = createWorldGrid(40, 16, 80);
    fillBox(grid, 0, 0, 0, 39, 0, 79, concrete);
    fillBox(grid, 24, 1, 50, 36, 8, 50, concrete);
    return {
      grid,
      blocks,
      spawns: [
        { x: 11, y: 0.5, z: 28, yaw: 0, team: 0 },
        { x: 10, y: 0.5, z: 12, yaw: Math.PI, team: 1 },
      ],
      nav: buildNavGrid({ grid, blocks }, BOBO_NAV_METRICS),
    };
  }

  it('o inimigo some atrás da parede a 7–25 m: o bot N2 joga granada na última posição dele', () => {
    const base = levelBot('normal');
    const recipe: MatchRecipe = {
      format: MATCH_RECIPE_FORMAT,
      mode: 'warfare.tdm',
      map: 'test',
      seed: 4,
      teams: [{ humans: 1, bots: [] }, { bots: [{ ref: 'embedded:g', count: 1 }] }],
      embeddedBots: [
        {
          ...base,
          format: BOT_FORMAT,
          id: 'g',
          name: 'G',
          skill: { ...base.skill, grenadeUse: 1 },
          personality: { ...base.personality, patience: 0, aggression: 1 },
          rules: { ...base.rules, damageMult: 0 },
        },
      ],
    };
    let grenades = 0;
    const match = createHeadlessMatch({
      recipe,
      map: arena(),
      humans: 1,
      writeHumans: (frames, sim) => {
        // Anda para +X (yaw −90°: olhando para +X) até ficar atrás da parede (x > 13 m), e para.
        const h = sim.view();
        const e = sim.controllerEntity(0) & 0xffff;
        frames[0]!.yaw = yawToU16(-Math.PI / 2);
        frames[0]!.moveY = h.position[e * 3]! < 15 ? 127 : 0;
      },
      onEvents: (events, sim) => {
        for (const ev of events) {
          if (
            ev.type === 'projectile' &&
            ev.action === 'launch' &&
            ev.weapon === WEAPON_CODE.grenade &&
            ev.owner === sim.controllerEntity(BOT_CONTROLLER_BASE)
          ) {
            grenades++;
          }
        }
      },
    });
    match.run(12 * SIM_HZ);
    expect(grenades).toBeGreaterThanOrEqual(1);
    match.dispose();
  });
});
