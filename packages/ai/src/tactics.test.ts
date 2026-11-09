import { BOT_FORMAT, MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import { buildNavGrid } from '@boboforces/nav';
import { BUTTON } from '@boboforces/input';
import { pitchToI16, yawToU16 } from '@boboforces/shared';
import {
  aimPointWorld,
  BOBO_NAV_METRICS,
  BOT_CONTROLLER_BASE,
  entityIndex,
  METRICS,
  SIM_HZ,
  type AimPoint,
  type SimMap,
} from '@boboforces/sim';
import {
  BLOCK_FLAG,
  createRayHit,
  createTestBlocks,
  createWorldGrid,
  fillBox,
  makeCell,
  raycastGrid,
} from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { createHeadlessMatch } from './headless.ts';

/**
 * M2, fase 3c: o N1 (gameplay.md §6.3). Um humano parado atira sem parar num bot cauteloso (Covarde, N1, 1000 de vida
 * para não morrer); entre os dois, um pouco ao lado do bot, uma mureta de 4 m. O bot tem que sair da vista do humano
 * (atrás da mureta) e ficar lá agachado.
 */

const blocks = createTestBlocks();
const concrete = makeCell(blocks.byKey('concrete')!.id);

function arena(): SimMap {
  const grid = createWorldGrid(40, 16, 80);
  fillBox(grid, 0, 0, 0, 39, 0, 79, concrete);
  // Mureta de 4 m de largura, 2,5 m de altura, em z = 24 m (do humano em z = 35 ela tapa a faixa x 8–12 atrás dela).
  fillBox(grid, 16, 1, 48, 23, 5, 48, concrete);
  return {
    grid,
    blocks,
    spawns: [
      { x: 10, y: 0.5, z: 35, yaw: 0, team: 0 },
      { x: 13.5, y: 0.5, z: 26, yaw: Math.PI, team: 1 },
    ],
    nav: buildNavGrid({ grid, blocks }, BOBO_NAV_METRICS),
  };
}

const recipe: MatchRecipe = {
  format: MATCH_RECIPE_FORMAT,
  mode: 'warfare.tdm',
  map: 'test',
  seed: 11,
  teams: [{ humans: 1, bots: [] }, { bots: [{ ref: 'embedded:sam', count: 1 }] }],
  embeddedBots: [
    {
      format: BOT_FORMAT,
      id: 'sam',
      name: 'Sam',
      look: null,
      skill: {
        reactionMs: 450,
        aimErrorDeg: 2,
        acquireS: 0.6,
        turnDegS: 320,
        recoilControl: 0.5,
        headPref: 0.2,
        grenadeUse: 0,
        combatMove: 'strafe',
        triggerHold: 0.5,
        targetSwitchS: 0.8,
      },
      intelligence: {
        level: 1,
        useCover: true,
        flank: false,
        retreat: false,
        grenades: false,
        callouts: false,
        ambush: false,
        learn: false,
        playObjective: true,
      },
      personality: {
        preset: 'coward',
        aggression: 0.2,
        caution: 0.9,
        patience: 0.6,
        preferredRangeM: 35,
        silliness: 0,
      },
      rules: {
        hp: 1000,
        damageMult: 0,
        speed: 1,
        ammo: 'normal',
        weapons: [],
        headshotImmune: false,
        explodeOnDeath: false,
        visionDeg: 120,
        visionRange: 1,
        hearing: 1,
        knowledge: 'normal',
      },
    },
  ],
};

describe('N1: cobertura', () => {
  it('tomando tiro, o bot cauteloso sai da vista de quem atira e fica atrás da mureta', () => {
    const p: AimPoint = { x: 0, y: 0, z: 0 };
    const hit = createRayHit();
    let hiddenTicks = 0;
    const match = createHeadlessMatch({
      recipe,
      map: arena(),
      humans: 1,
      writeHumans: (frames, sim) => {
        const v = sim.view();
        const h = entityIndex(sim.controllerEntity(0));
        const b = entityIndex(sim.controllerEntity(BOT_CONTROLLER_BASE));
        aimPointWorld(v, b, false, p);
        const ex = v.position[h * 3]!;
        const ey = v.position[h * 3 + 1]! + METRICS.eyeHeight;
        const ez = v.position[h * 3 + 2]!;
        const dx = p.x - ex;
        const dy = p.y - ey;
        const dz = p.z - ez;
        frames[0]!.yaw = yawToU16(Math.atan2(-dx, -dz));
        frames[0]!.pitch = pitchToI16(Math.atan2(dy, Math.hypot(dx, dz)));
        frames[0]!.buttons = (sim.tick & 1) === 0 ? BUTTON.fire : 0;
        const d = Math.hypot(dx, dy, dz);
        const blocked = raycastGrid(
          v.world,
          v.blocks,
          ex,
          ey,
          ez,
          dx / d,
          dy / d,
          dz / d,
          d,
          BLOCK_FLAG.blocksSight,
          hit,
          null,
        );
        hiddenTicks = blocked ? hiddenTicks + 1 : 0;
      },
    });
    let longestHidden = 0;
    for (let i = 0; i < 12 * SIM_HZ; i++) {
      match.step();
      longestHidden = Math.max(longestHidden, hiddenTicks);
    }
    // Ficou pelo menos 1 s seguido fora da vista (agachado atrás da mureta).
    expect(longestHidden).toBeGreaterThanOrEqual(SIM_HZ);
    match.dispose();
  });
});
