import {
  BOT_FORMAT,
  BOT_RANGES,
  builtinBot,
  builtinBotRef,
  DEFAULT_BOT_RULES,
  levelBot,
  MATCH_RECIPE_FORMAT,
  type BotDocument,
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
import { createRawInputState } from '@boboforces/input';
import { createTestBlocks, createWorldGrid, fillBox, makeCell } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import {
  beginDeath,
  controllerNames,
  controllerRules,
  countdownLine,
  createDeathState,
  deathCamAngles,
  deathCamBackoff,
  deathTexts,
  DEATH_CAM,
  deathArmed,
  DEATH_ARM_MAX_S,
  DEATH_ARM_S,
  snapshotHeld,
  stillHeld,
  fillDeathBanner,
  losingBadly,
  moveRadialCursor,
  numberRepeatedBots,
  PRIMARY_ORDER,
  primaryChoices,
  radialIndex,
  ringPick,
  RADIAL,
  rulesText,
  stepCursor,
  stepPick,
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
    // M10 (AK5): as 6 de antes e as 4 primárias novas.
    expect(PRIMARY_ORDER.length).toBe(10);
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

  it('M9 (fase 1b): o peito de quem matou na escala dele (o gigante: o triplo da altura)', () => {
    const { sim } = duel();
    const v = sim.view();
    const st = createDeathState();
    beginDeath(st, sim.controllerEntity(0), sim.controllerEntity(4), WEAPON_CODE.rifle, 0, 0);
    st.t = DEATH_CAM.turnS;
    const out = { yaw: 0, pitch: 0 };
    // Olho a 10 m do matador (pés a 0,5 m) na altura do peito normal: olhando reto; o do gigante fica acima.
    const eyeY = 0.5 + DEATH_CAM.chestM;
    deathCamAngles(st, v, 10, eyeY, 30, 1, 0, out, 1);
    expect(out.pitch).toBeCloseTo(0, 9);
    deathCamAngles(st, v, 10, eyeY, 30, 1, 0, out, 3);
    expect(out.pitch).toBeCloseTo(Math.atan2(DEATH_CAM.chestM * 2, 10), 9);
    deathCamAngles(st, v, 10, eyeY, 30, 1, 0, out, 0.5);
    expect(out.pitch).toBeCloseTo(Math.atan2(-DEATH_CAM.chestM / 2, 10), 9);
  });

  it('M9 (fase 1b): a câmera recua do gigante colado até ele caber, para antes da parede; o normal não recua', () => {
    const { sim } = duel();
    const v = sim.view();
    const st = createDeathState();
    beginDeath(st, sim.controllerEntity(0), sim.controllerEntity(4), WEAPON_CODE.rifle, 0, 0);
    const dir = { x: 0, z: 0 };
    const fovY = 1.2;
    // O matador nos pés em (10; 20); o olho a 1 m dele, em z = 21: recuar é ir para +Z.
    expect(deathCamBackoff(st, v, 10, 2, 21, 1, fovY, 1, dir)).toBe(0);
    st.t = 0;
    expect(deathCamBackoff(st, v, 10, 2, 21, 1, fovY, 3, dir)).toBe(0);
    st.t = DEATH_CAM.turnS;
    const need = (DEATH_CAM.fitM * 3) / Math.tan(fovY / 2);
    expect(deathCamBackoff(st, v, 10, 2, 21, 1, fovY, 3, dir)).toBeCloseTo(need - 1, 9);
    expect([dir.x, dir.z]).toEqual([0, 1]);
    // Já longe (mais que o necessário): nada.
    expect(deathCamBackoff(st, v, 10, 2, 20 + need + 1, 1, fovY, 3, dir)).toBe(0);
    // Sem matador: nada.
    const alone = createDeathState();
    beginDeath(alone, sim.controllerEntity(0), NULL_ENTITY, WEAPON_KILL_PLANE, 0, 0);
    alone.t = 5;
    expect(deathCamBackoff(alone, v, 10, 2, 21, 1, fovY, 3, dir)).toBe(0);
    // Uma parede em z = 23 m (célula 46, até 5 m de altura): o recuo para 0,3 m antes dela.
    fillBox(v.world, 0, 1, 46, 39, 10, 46, concrete);
    expect(deathCamBackoff(st, v, 10, 2, 21, 1, fovY, 3, dir)).toBeCloseTo(2 - DEATH_CAM.wallM, 9);
  });
});

describe('M12 (fase 7b): o mesmo bot repetido ganha número', () => {
  it('"Chill Bob", "Chill Bob 2"…, pulando o nome que já existe; o bot único e o humano ficam como estão', () => {
    const recipe: MatchRecipe = {
      format: MATCH_RECIPE_FORMAT,
      mode: 'warfare.tdm',
      map: 'construto',
      seed: 1,
      teams: [
        { humans: 1, bots: [{ ref: builtinBotRef('chill'), count: 2 }] },
        {
          bots: [
            { ref: builtinBotRef('chill'), count: 2 },
            { ref: builtinBotRef('sweaty'), count: 1 },
          ],
        },
      ],
    };
    const names = controllerNames(recipe, 1);
    const bots = names.filter((n, c) => n !== undefined && c > 0);
    expect(bots).toEqual(['Chill Bob', 'Chill Bob', 'Chill Bob', 'Chill Bob', 'Sweaty Bob']);
    // A contagem agrupa pelo nome do bot (antes do número).
    expect(countdownLine(recipe, 1, names)).toBe('Hoje: 2 × Chill Bob, 1 × Sweaty Bob');
    // O humano (online, o nome da sala) chamado "Chill Bob 2": o número pula para o 3.
    names[0] = 'Chill Bob 2';
    numberRepeatedBots(names, recipe, 1);
    expect(names.filter((n, c) => n !== undefined && c > 0)).toEqual([
      'Chill Bob',
      'Chill Bob 3',
      'Chill Bob 4',
      'Chill Bob 5',
      'Sweaty Bob',
    ]);
    expect(names[0]).toBe('Chill Bob 2');
    // A mesma conta dá os mesmos nomes (o host e o amigo online).
    const again = controllerNames(recipe, 1);
    again[0] = 'Chill Bob 2';
    numberRepeatedBots(again, recipe, 1);
    expect(again).toEqual(names);
    // Revisão: o humano da sala chamado "Sweaty Bob" (o bot único): o bot ganha número também.
    const same = controllerNames(recipe, 1);
    same[0] = 'Sweaty Bob';
    numberRepeatedBots(same, recipe, 1);
    expect(same.filter((n, c) => n !== undefined && c > 0)).toEqual([
      'Chill Bob',
      'Chill Bob 2',
      'Chill Bob 3',
      'Chill Bob 4',
      'Sweaty Bob 2',
    ]);
  });

  it('revisão: o nome numerado cabe no tamanho do nome de bot (corta o nome antes do número)', () => {
    const long: BotDocument = {
      ...levelBot('normal'),
      format: BOT_FORMAT,
      id: 'longo',
      name: 'Sargento Almondega Longa',
    };
    expect(long.name.length).toBe(BOT_RANGES.nameMaxLength);
    const recipe: MatchRecipe = {
      format: MATCH_RECIPE_FORMAT,
      mode: 'warfare.ffa',
      map: 'construto',
      seed: 1,
      teams: [{ humans: 1, bots: [{ ref: 'embedded:longo', count: 12 }] }],
      embeddedBots: [long],
    };
    const names = controllerNames(recipe, 1);
    numberRepeatedBots(names, recipe, 1);
    const bots = names.filter((n, c) => n !== undefined && c > 0);
    expect(bots[0]).toBe('Sargento Almondega Longa');
    expect(bots[1]).toBe('Sargento Almondega Lon 2');
    expect(bots[11]).toBe('Sargento Almondega Lo 12');
    for (const n of bots) expect(n.length).toBeLessThanOrEqual(BOT_RANGES.nameMaxLength);
    expect(new Set(bots).size).toBe(12);
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

describe('M9 (fase 3b): as opções do radial pelo time', () => {
  const base: MatchRecipe = {
    format: MATCH_RECIPE_FORMAT,
    mode: 'sandbox',
    map: 'construto',
    seed: 1,
    teams: [{ humans: 1, bots: [], weapons: ['rifle', 'pistol'] }, { bots: [], weapons: ['rocket'] }, { bots: [] }],
  };
  const codes = (list: number[]): number[] => list.map((i) => PRIMARY_ORDER[i]!);

  it('no Sandbox, só as primárias do time; sem lista, todas; fora do Sandbox, a lista do time não vale', () => {
    expect(codes(primaryChoices(base, 0))).toEqual([WEAPON_CODE.rifle]);
    expect(codes(primaryChoices(base, 1))).toEqual([WEAPON_CODE.rocket]);
    expect(primaryChoices(base, 2)).toHaveLength(PRIMARY_ORDER.length);
    expect(primaryChoices({ ...base, mode: 'warfare.tdm' }, 0)).toHaveLength(PRIMARY_ORDER.length);
  });

  it('cruza com o weapons.allowed da partida (sem nada em comum, fica o da partida)', () => {
    const r: MatchRecipe = { ...base, weapons: { allowed: ['smg', 'shotgun', 'rifle'] } };
    expect(codes(primaryChoices(r, 0))).toEqual([WEAPON_CODE.rifle]);
    expect(codes(primaryChoices(r, 1))).toEqual([WEAPON_CODE.rifle, WEAPON_CODE.smg, WEAPON_CODE.shotgun]);
    expect(codes(primaryChoices(r, 2))).toEqual([WEAPON_CODE.rifle, WEAPON_CODE.smg, WEAPON_CODE.shotgun]);
  });
});

describe('M10 (fases 6 e 7): as primárias novas no radial', () => {
  const tdm: MatchRecipe = {
    format: MATCH_RECIPE_FORMAT,
    mode: 'warfare.tdm',
    map: 'construto',
    seed: 1,
    teams: [{ humans: 1, bots: [] }, { bots: [] }],
  };
  const codes = (list: number[]): number[] => list.map((i) => PRIMARY_ORDER[i]!);

  it('o DMR, a escopeta automática, a besta e o lança-granadas entram ao lado da parecida; o weapons.allowed vale', () => {
    expect(PRIMARY_ORDER).toEqual([
      WEAPON_CODE.rifle,
      WEAPON_CODE.dmr,
      WEAPON_CODE.smg,
      WEAPON_CODE.shotgun,
      WEAPON_CODE.autoShotgun,
      WEAPON_CODE.sniper,
      WEAPON_CODE.crossbow,
      WEAPON_CODE.rocket,
      WEAPON_CODE.grenadeLauncher,
      WEAPON_CODE.lmg,
    ]);
    const r: MatchRecipe = { ...tdm, weapons: { allowed: ['sniper.crossbow', 'rifle.dmr', 'pistol.revolver'] } };
    expect(codes(primaryChoices(r, 0))).toEqual([WEAPON_CODE.dmr, WEAPON_CODE.crossbow]);
  });

  it('anel largo: o cursor escolhe a plaquinha na direção dele, vista do centro; no redondo, o setor de sempre', () => {
    const hit = createHudModel().primaryHit;
    // 3 plaquinhas de 20×10 em volta de (100, 100): no alto, à direita (mais para baixo) e à esquerda.
    const put = (i: number, cx: number, cy: number): void => {
      hit.rects[i * 4] = cx - 10;
      hit.rects[i * 4 + 1] = cy - 5;
      hit.rects[i * 4 + 2] = 20;
      hit.rects[i * 4 + 3] = 10;
    };
    put(0, 100, 40);
    put(1, 220, 130);
    put(2, -20, 130);
    hit.count = 3;
    hit.wide = true;
    hit.centerX = 100;
    hit.centerY = 100;
    expect(ringPick(hit, 0, 1, 3)).toBe(0);
    expect(ringPick(hit, 1, -0.2, 3)).toBe(1);
    expect(ringPick(hit, -1, -0.3, 3)).toBe(2);
    expect(ringPick(hit, 0.1, 0.1, 3)).toBe(-1);
    hit.wide = false;
    expect(ringPick(hit, 1, 0, 4)).toBe(radialIndex(1, 0, 4));
  });

  it('revisão: a loja na fileira e na linha anda um passo de cada vez, dando a volta, a partir de nenhuma', () => {
    expect([stepPick(-1, 1, 13), stepPick(-1, -1, 13)]).toEqual([0, 12]);
    expect([stepPick(12, 1, 13), stepPick(0, -1, 13), stepPick(5, 1, 13)]).toEqual([0, 12, 6]);
    expect(stepPick(3, 1, 0)).toBe(-1);
  });
});

describe('M12 (fase 2, playtest): o seletor da primária só destrava com tudo solto', () => {
  it('beginDeath trava o seletor; só o que já estava apertado na morte o segura, e ele destrava sozinho em 1,5 s', () => {
    const st = createDeathState();
    beginDeath(st, 1, 2, WEAPON_CODE.rifle, 0, 0, true);
    expect([st.armed, st.headshot]).toEqual([false, true]);
    const raw = createRawInputState();
    // Teclado: a seta que girava a mira na morte segura; uma tecla nova não.
    raw.keys[5] = 1;
    snapshotHeld(st, raw, 'keyboardMouse', 0);
    expect(stillHeld(st, raw)).toBe(true);
    raw.keys[5] = 0;
    raw.keys[6] = 1;
    expect(stillHeld(st, raw)).toBe(false);
    st.t = 0.2;
    expect(deathArmed(st, raw)).toBe(false);
    st.t = DEATH_ARM_S;
    expect(deathArmed(st, raw)).toBe(true);
    // Toque: o polegar que já estava no joystick segura, mas só até 1,5 s; um dedo novo não segura.
    raw.keys[6] = 0;
    const thumb = raw.touches[0]!;
    thumb.active = true;
    thumb.id = 7;
    snapshotHeld(st, raw, 'touch', 0);
    st.t = 1;
    expect(deathArmed(st, raw)).toBe(false);
    st.t = DEATH_ARM_MAX_S;
    expect(deathArmed(st, raw)).toBe(true);
    thumb.id = 8;
    st.t = 1;
    expect(deathArmed(st, raw)).toBe(true);
    // Controle: o analógico empurrado segura até voltar; o gatilho parado em −1 (axes[2]) não prende para sempre.
    thumb.active = false;
    const pad = raw.gamepads[0]!;
    pad.connected = true;
    pad.axes[0] = 0.9;
    pad.axes[2] = -1;
    snapshotHeld(st, raw, 'gamepad', 0);
    expect(stillHeld(st, raw)).toBe(true);
    pad.axes[0] = 0;
    // O gatilho continua em −1: ainda "segurado", até o tempo máximo.
    expect(stillHeld(st, raw)).toBe(true);
    st.t = DEATH_ARM_MAX_S;
    expect(deathArmed(st, raw)).toBe(true);
    pad.buttons[0] = 1;
    snapshotHeld(st, raw, 'gamepad', 0);
    pad.axes[2] = 0.6;
    pad.buttons[0] = 0;
    expect(stillHeld(st, raw)).toBe(false);
  });
  it('"· NA CABEÇA" na faixa só com quem matou', () => {
    const m = createHudModel();
    const st = createDeathState();
    beginDeath(st, 1, NULL_ENTITY, WEAPON_KILL_PLANE, 0, 0, true);
    const view = { count: 0 } as unknown as Parameters<typeof fillDeathBanner>[2];
    fillDeathBanner(m, st, view, [], [], deathTexts());
    expect(m.deathHead).toBe(false);
  });
});
