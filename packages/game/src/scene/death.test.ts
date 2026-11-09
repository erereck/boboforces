import {
  builtinBot,
  builtinBotRef,
  DEFAULT_BOT_RULES,
  MATCH_RECIPE_FORMAT,
  type MatchRecipe,
} from '@boboforces/format';
import {
  createInputFrames,
  createSim,
  NULL_ENTITY,
  WEAPON_CODE,
  WEAPON_KILL_PLANE,
  WEAPON_NONE,
} from '@boboforces/sim';
import { createHudModel } from '@boboforces/ui';
import { createTestBlocks, createWorldGrid, fillBox, makeCell } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import {
  beginDeath,
  controllerNames,
  controllerRules,
  countdownLine,
  createDeathState,
  deathCamAngles,
  deathTexts,
  DEATH_CAM,
  fillDeathBanner,
  losingBadly,
  moveRadialCursor,
  PRIMARY_ORDER,
  radialIndex,
  RADIAL,
  rulesText,
  stepCursor,
} from './death.ts';

/** M2, fase 2c: a lógica pura da tela de morte (câmera, cursor do radial, faixa e derrota feia). */

const blocks = createTestBlocks();
const concrete = makeCell(blocks.byKey('concrete')!.id);

function duel(mode = 'warfare.tdm', match?: MatchRecipe['match']) {
  const grid = createWorldGrid(40, 12, 80);
  fillBox(grid, 0, 0, 0, 39, 0, 79, concrete);
  const recipe: MatchRecipe = {
    format: MATCH_RECIPE_FORMAT,
    mode,
    map: 'test',
    seed: 1,
    ...(match ? { match } : {}),
    teams:
      mode === 'warfare.ffa'
        ? [{ humans: 'all', bots: [{ ref: builtinBotRef('sweaty'), count: 1 }] }]
        : [{ humans: 1, bots: [] }, { bots: [{ ref: builtinBotRef('sweaty'), count: 1 }] }],
  };
  const spawns = [
    { x: 10, y: 0.5, z: 30, yaw: 0, team: mode === 'warfare.ffa' ? -1 : 0 },
    { x: 10, y: 0.5, z: 20, yaw: Math.PI, team: mode === 'warfare.ffa' ? -1 : 1 },
  ];
  const sim = createSim({ recipe, map: { grid, blocks, spawns }, humans: 1 });
  sim.step(createInputFrames());
  return { sim, recipe };
}

describe('cursor do menu da primária', () => {
  it('anel: a direção escolhe (alto, direita, baixo); dentro da zona morta, nada', () => {
    expect(radialIndex(0, 1, 6)).toBe(0);
    expect(radialIndex(1, 0.55, 6)).toBe(1);
    expect(radialIndex(0, -1, 6)).toBe(3);
    expect(radialIndex(-1, 0.55, 6)).toBe(5);
    expect(radialIndex(0.2, 0.2, 6)).toBe(-1);
  });

  it('o giro de mira move o cursor (para a direita = yaw negativo) e ele não sai do círculo', () => {
    const st = createDeathState();
    moveRadialCursor(st, -0.05, 0);
    expect(st.cursorX).toBeCloseTo(0.05 * RADIAL.gain, 6);
    moveRadialCursor(st, -10, 10);
    expect(Math.hypot(st.cursorX, st.cursorY)).toBeCloseTo(1, 6);
    expect(radialIndex(st.cursorX, st.cursorY, 6)).toBe(1);
  });

  it('fileira: anda uma opção a cada passo de giro, para os dois lados', () => {
    const st = createDeathState();
    const per = RADIAL.step / RADIAL.gain;
    expect(stepCursor(st, -per * 0.6)).toBe(0);
    expect(stepCursor(st, -per * 0.6)).toBe(1);
    expect(stepCursor(st, per * 1.01)).toBe(-1);
    expect(PRIMARY_ORDER[0]).toBe(WEAPON_CODE.rifle);
    expect(PRIMARY_ORDER.length).toBe(6);
  });
});

describe('câmera de morte', () => {
  it('vira em meio segundo para o peito de quem matou; sem matador, fica onde estava', () => {
    const { sim } = duel();
    const v = sim.view();
    const victim = sim.controllerEntity(0);
    const killer = sim.controllerEntity(4);
    const st = createDeathState();
    beginDeath(st, victim, killer, WEAPON_CODE.rifle, 1.2, 0.3);
    const out = { yaw: 0, pitch: 0 };
    deathCamAngles(st, v, 10, 2, 30, 1, 0, out);
    expect(out.yaw).toBeCloseTo(1.2, 9);
    expect(out.pitch).toBeCloseTo(0.3, 9);
    st.t = DEATH_CAM.turnS;
    deathCamAngles(st, v, 10, 2, 30, 1, 0, out);
    // O matador está 10 m para −Z (yaw 0), com o peito abaixo do olho.
    expect(out.yaw).toBeCloseTo(0, 3);
    expect(out.pitch).toBeLessThan(0);
    const straight = out.pitch;
    deathCamAngles(st, v, 10, 2, 30, 1, 0.1, out);
    expect(out.pitch).toBeCloseTo(straight - 0.1, 9);
    beginDeath(st, victim, NULL_ENTITY, WEAPON_KILL_PLANE, 0.7, 0);
    st.t = 5;
    deathCamAngles(st, v, 10, 2, 30, 1, 0.1, out);
    expect(out.yaw).toBe(0.7);
  });
});

describe('faixa de quem matou', () => {
  it('com matador: "ABATIDO POR" + nome do nível, arma e a vida dele; sem: só a causa', () => {
    const { sim, recipe } = duel();
    const v = sim.view();
    const names = controllerNames(recipe, 1);
    expect([names[0], names[4]]).toEqual(['P1', 'Sweaty Bob']);
    // A contagem inicial lista os bots do outro time (gameplay.md §2.2).
    expect(countdownLine(recipe, 1, names)).toBe('Hoje: 1 × Sweaty Bob');
    const tx = deathTexts();
    const weaponNames = ['Rattler', 'Pop Gun'];
    const m = createHudModel();
    const st = createDeathState();
    const victim = sim.controllerEntity(0);
    beginDeath(st, victim, sim.controllerEntity(4), WEAPON_CODE.rifle, 0, 0);
    fillDeathBanner(m, st, v, names, weaponNames, tx);
    expect([m.deathLabel, m.deathName, m.deathWeapon, m.deathHp]).toEqual([
      'ABATIDO POR',
      'Sweaty Bob',
      'Rattler',
      100,
    ]);
    beginDeath(st, victim, NULL_ENTITY, WEAPON_KILL_PLANE, 0, 0);
    fillDeathBanner(m, st, v, names, weaponNames, tx);
    expect([m.deathLabel, m.deathName, m.deathWeapon, m.deathHp]).toEqual(['', 'Caiu no vazio', '', -1]);
    beginDeath(st, victim, NULL_ENTITY, WEAPON_NONE, 0, 0);
    fillDeathBanner(m, st, v, names, weaponNames, tx);
    expect(m.deathName).toBe('Queda');
    beginDeath(st, victim, victim, WEAPON_CODE.rifle, 0, 0);
    fillDeathBanner(m, st, v, names, weaponNames, tx);
    expect([m.deathName, m.deathWeapon]).toEqual(['Foi você mesmo', 'Rattler']);
    beginDeath(st, victim, sim.controllerEntity(4), WEAPON_KILL_PLANE, 0, 0);
    fillDeathBanner(m, st, v, names, weaponNames, tx);
    expect(m.deathWeapon).toBe('Empurrão no vazio');
  });
});

describe('derrota feia (GDD §3.8)', () => {
  it('só da metade da partida em diante, perdendo por 50% ou mais', () => {
    const { sim } = duel('warfare.tdm', { timeLimitS: 600 });
    const v = sim.view();
    const e = 0;
    const total = 600 * sim.hz;
    const score = v.match.teamScore as Int32Array;
    score[1] = 10;
    score[0] = 4;
    // Começo da partida: ainda não conta.
    expect(losingBadly(v, e, false, total, 75)).toBe(false);
    // Meta do adversário a mais da metade (40 de 75): conta; empatando de perto, não.
    score[1] = 40;
    score[0] = 20;
    expect(losingBadly(v, e, false, total, 75)).toBe(true);
    score[0] = 21;
    expect(losingBadly(v, e, false, total, 75)).toBe(false);
  });
});

describe('regras ativas à vista (GDD §6.5)', () => {
  it('em texto: Jorge, Ninja e Carl; o nível rápido e o humano não têm', () => {
    expect(rulesText(builtinBot('jorge-the-immortal')!.rules)).toBe('500 de vida · só escopeta');
    expect(rulesText(builtinBot('knife-ninja')!.rules)).toBe('velocidade ×1,4 · só faca');
    expect(rulesText(builtinBot('camper-carl')!.rules)).toBe('só sniper');
    expect(rulesText(builtinBot('normal-bob')!.rules)).toBe('');
    expect(
      rulesText({
        ...DEFAULT_BOT_RULES,
        damageMult: 2,
        ammo: 'infiniteClip',
        headshotImmune: true,
        explodeOnDeath: true,
        weapons: ['smg', 'pistol'],
      }),
    ).toBe('dano ×2 · só SMG, pistola · pente infinito · imune a tiro na cabeça · explode ao morrer');
    const recipe: MatchRecipe = {
      format: MATCH_RECIPE_FORMAT,
      mode: 'warfare.tdm',
      map: 'test',
      seed: 1,
      teams: [{ humans: 1, bots: [] }, { bots: [{ ref: 'builtin:jorge-the-immortal', count: 1 }] }],
    };
    const rules = controllerRules(recipe, 1);
    expect(rules[0]).toBe('');
    expect(rules.filter((r) => r !== '')).toEqual(['500 de vida · só escopeta']);
  });

  it('a faixa de morte leva as regras de quem matou', () => {
    const { sim, recipe } = duel();
    const v = sim.view();
    const m = createHudModel();
    const st = createDeathState();
    const rules: string[] = [];
    rules[4] = '500 de vida · só escopeta';
    beginDeath(st, sim.controllerEntity(0), sim.controllerEntity(4), WEAPON_CODE.rifle, 0, 0);
    fillDeathBanner(m, st, v, controllerNames(recipe, 1), ['Rattler'], deathTexts(), rules);
    expect(m.deathRules).toBe('500 de vida · só escopeta');
    beginDeath(st, sim.controllerEntity(0), NULL_ENTITY, WEAPON_KILL_PLANE, 0, 0);
    fillDeathBanner(m, st, v, controllerNames(recipe, 1), ['Rattler'], deathTexts(), rules);
    expect(m.deathRules).toBe('');
  });
});
