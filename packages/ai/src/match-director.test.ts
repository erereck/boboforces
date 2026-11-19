import { builtinBotRef, MATCH_RECIPE_FORMAT, type DirectorGoal, type MatchRecipe } from '@boboforces/format';
import { BOBO_NAV_METRICS, SIM_HZ, type SimMap, type SimView } from '@boboforces/sim';
import { buildTestNav, TEST_NAV_PATHS } from '@boboforces/sim/testing';
import { cellCenter, createTestBlocks, createWorldGrid, fillBox, makeCell } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { AI_DIRECTOR } from './config.ts';
import { createBotDirectorWithPaths } from './director.ts';
import { createHeadlessMatch } from './headless.ts';
import { MatchDirector } from './match-director.ts';
import { BOT_SKILLS, skillRoom, skillShift, type SkillRoom, type SkillShift } from './skill.ts';

/** M8 (fase 5): o Diretor de Partida (a medida, o ajuste da mira e a ligação no diretor dos bots). */

const HZ = 60;
const SAMPLE = AI_DIRECTOR.sampleS * HZ;
/** Só o controlador 0 é humano. */
const ONE = Uint8Array.from([1]);

/** Uma `SimView` mínima: o humano (controlador 0) na entidade 0 com o placar dado; um bot na 1. */
function fakeView(tick: number, kills: number, deaths: number): SimView {
  return {
    tick,
    count: 2,
    controller: Int16Array.from([0, 100]),
    kills: Uint16Array.from([kills, 50]),
    deaths: Uint16Array.from([deaths, 50]),
  } as unknown as SimView;
}

/** O placar acumulado de um teste (amostras, abates e mortes). */
interface Run {
  s: number;
  k: number;
  d: number;
}

const start = (): Run => ({ s: 0, k: 0, d: 0 });

/** Roda o Diretor por `samples` amostras com o placar crescendo `k` abates e `d` mortes por amostra. */
function drive(md: MatchDirector, run: Run, samples: number, k: number, d: number): boolean[] {
  const changes: boolean[] = [];
  for (let i = 0; i < samples; i++) {
    run.s++;
    run.k += k;
    run.d += d;
    // Os ticks entre as amostras não contam.
    expect(md.update(fakeView(run.s * SAMPLE - 1, 0, 0))).toBe(false);
    changes.push(md.update(fakeView(run.s * SAMPLE, run.k, run.d)));
  }
  return changes;
}

/** As amostras (contando de 1) em que o ajuste mudou. */
const changedAt = (changes: boolean[]): number[] => changes.flatMap((c, i) => (c ? [i + 1] : []));

describe('M8 (fase 5): a medida do Diretor de Partida', () => {
  it('um ajuste a cada 30 s (3 amostras), 1/4 de nível por vez, até ±1 nível', () => {
    // O humano morre 1 vez e mata 0 a cada 10 s: K/D 0, abaixo de qualquer faixa: os bots pioram.
    const md = new MatchDirector('balanced', HZ, ONE);
    expect(changedAt(drive(md, start(), 18, 0, 1))).toEqual([6, 9, 12, 15]);
    expect(md.shift).toBe(-AI_DIRECTOR.maxQuarters);
  });

  it('acima da faixa os bots melhoram; dentro dela, nada muda', () => {
    const hot = new MatchDirector('challenge', HZ, ONE);
    drive(hot, start(), 6, 2, 1);
    expect(hot.shift).toBe(2);
    // K/D 1,2 no Equilibrado (1–1,5): fica.
    const ok = new MatchDirector('balanced', HZ, ONE);
    drive(ok, start(), 12, 6, 5);
    expect(ok.shift).toBe(0);
    // O mesmo K/D 1,2 no Relax (2–3) é pouco: os bots pioram.
    const relax = new MatchDirector('relax', HZ, ONE);
    drive(relax, start(), 3, 6, 5);
    expect(relax.shift).toBe(-1);
  });

  it('com poucos eventos na janela, espera; a janela é de 3 min (o que ficou para trás não pesa)', () => {
    const quiet = new MatchDirector('balanced', HZ, ONE);
    // 1 evento por 30 s: na janela do 1º ajuste só há 1 (o mínimo é 4).
    for (let s = 1; s <= 3; s++) quiet.update(fakeView(s * SAMPLE, 0, s === 3 ? 1 : 0));
    expect(quiet.shift).toBe(0);
    // Um começo ruim (K/D 0 por 3 min) e depois 3 min bons (K/D 2): no fim a janela só vê os bons.
    const md = new MatchDirector('balanced', HZ, ONE);
    const run = start();
    drive(md, run, 18, 0, 1);
    expect(md.shift).toBe(-4);
    // Depois de j amostras boas, a janela tem 2j abates e 18 mortes (K/D j/9): passa de 1,5 com j = 15 e 18.
    expect(changedAt(drive(md, run, 18, 2, 1))).toEqual([15, 18]);
    expect(md.shift).toBe(-2);
  });

  it('a folga dos bots segura o ajuste (um Tryhard não fica "+1" sem mudar nada) e encolhe o que passou', () => {
    const md = new MatchDirector('challenge', HZ, ONE);
    md.setRange(1, 4);
    drive(md, start(), 9, 2, 1);
    expect(md.shift).toBe(1);
    // O nível dos bots mudou e a folga para cima acabou: o ajuste volta para 0.
    expect(md.setRange(0, 4)).toBe(true);
    expect(md.shift).toBe(0);
    expect(md.setRange(0, 4)).toBe(false);
  });

  it('quem conta mudou: a janela recomeça dos totais de agora (sem salto no K/D)', () => {
    // O placar de quem chegou (20 mortes antes) não pesa: depois do rebase, K/D 2 por 30 s no Equilibrado sobe 1/4.
    const md = new MatchDirector('balanced', HZ, ONE);
    md.rebase(fakeView(0, 0, 20));
    const run: Run = { s: 0, k: 0, d: 20 };
    expect(changedAt(drive(md, run, 3, 2, 1))).toEqual([3]);
    expect(md.shift).toBe(1);
  });

  it('sem humanos, nunca ajusta', () => {
    const md = new MatchDirector('balanced', HZ, new Uint8Array(1));
    drive(md, start(), 18, 0, 1);
    expect(md.shift).toBe(0);
  });
});

describe('M8 (fase 5): o ajuste da mira entre dois níveis', () => {
  const out: SkillShift = { reaction: 0, aimError: 0, acquire: 0, turn: 0 };
  it('sem ajuste, tudo 1 (o golden não muda)', () => {
    expect(skillShift(BOT_SKILLS.normal, 0, out)).toEqual({ reaction: 1, aimError: 1, acquire: 1, turn: 1 });
  });

  it('um nível inteiro dá a mira do vizinho; meio nível, o meio do caminho', () => {
    const n = BOT_SKILLS.normal;
    const s = BOT_SKILLS.sweaty;
    const up = skillShift(n, 4, out);
    expect(n.aimErrorDeg * up.aimError).toBeCloseTo(s.aimErrorDeg, 9);
    expect(n.reactionS * up.reaction).toBeCloseTo(s.reactionS, 9);
    expect(n.turnDegPerS * up.turn).toBeCloseTo(s.turnDegPerS, 9);
    const half = skillShift(n, -2, out);
    const c = BOT_SKILLS.chill;
    expect(n.aimErrorDeg * half.aimError).toBeCloseTo((n.aimErrorDeg + c.aimErrorDeg) / 2, 9);
    expect(n.acquireS * half.acquire).toBeCloseTo((n.acquireS + c.acquireS) / 2, 9);
  });

  it('nas pontas da tabela não há para onde ir', () => {
    expect(skillShift(BOT_SKILLS.tryhard, 2, out).aimError).toBe(1);
    expect(skillShift(BOT_SKILLS.vibe, -4, out).reaction).toBe(1);
    // Do Suado, +1 nível chega no Tryhard.
    const top = skillShift(BOT_SKILLS.sweaty, 4, out);
    expect(BOT_SKILLS.sweaty.aimErrorDeg * top.aimError).toBeCloseTo(BOT_SKILLS.tryhard.aimErrorDeg, 9);
    const room: SkillRoom = { up: 0, down: 0 };
    expect(skillRoom(BOT_SKILLS.tryhard, room)).toEqual({ up: 0, down: 16 });
    expect(skillRoom(BOT_SKILLS.vibe, room)).toEqual({ up: 16, down: 0 });
    expect(skillRoom(BOT_SKILLS.normal, room)).toEqual({ up: 8, down: 8 });
  });

  it('o bot da Oficina anda pela própria mira, não pela inteligência', () => {
    // Cérebro de Tryhard com a mira do Pela vibe: melhorar 1 nível dá a mira do De boa; piorar não tem para onde.
    const odd = { ...BOT_SKILLS.vibe, intelligence: 4 };
    const up = skillShift(odd, 4, out);
    expect(odd.aimErrorDeg * up.aimError).toBeCloseTo(BOT_SKILLS.chill.aimErrorDeg, 9);
    expect(odd.reactionS * up.reaction).toBeCloseTo(BOT_SKILLS.chill.reactionS, 9);
    expect(skillShift(odd, -4, out).aimError).toBe(1);
    // A mira fora da tabela (8°, pior que o Pela vibe) anda na proporção da ponta: 8 × 3,5/6.
    const wild = { ...BOT_SKILLS.vibe, aimErrorDeg: 8 };
    expect(wild.aimErrorDeg * skillShift(wild, 4, out).aimError).toBeCloseTo((8 * 3.5) / 6, 9);
  });
});

const blocks = createTestBlocks();
const concrete = makeCell(blocks.byKey('concrete')!.id);

/** Uma arena aberta de 32 × 32 m: o humano parado ao sul, os bots ao norte. */
function arena(): SimMap {
  const grid = createWorldGrid(32, 8, 32);
  fillBox(grid, 0, 0, 0, 31, 0, 31, concrete);
  return {
    grid,
    blocks,
    spawns: [
      { x: cellCenter(16), y: 0.5, z: 26, yaw: 0, team: 0 },
      { x: cellCenter(16), y: 0.5, z: 6, yaw: Math.PI, team: 1 },
    ],
    nav: buildTestNav({ grid, blocks }, BOBO_NAV_METRICS),
  };
}

function directed(goal: DirectorGoal | null, mode = 'warfare.tdm'): MatchRecipe {
  return {
    format: MATCH_RECIPE_FORMAT,
    mode,
    map: 'test',
    seed: 5,
    ...(goal !== null ? { director: { goal } } : {}),
    teams: [{ humans: 1, bots: [] }, { bots: [{ ref: builtinBotRef('normal'), count: 3 }] }],
  };
}

describe('M8 (fase 5): o Diretor no diretor dos bots', () => {
  it('desligado, no Zombies ou sem humanos: null', () => {
    const make = (recipe: MatchRecipe, humans = 1): number | null =>
      createBotDirectorWithPaths({ recipe, humans }, TEST_NAV_PATHS).directorShift();
    expect(make(directed(null))).toBeNull();
    expect(make(directed('relax'))).toBe(0);
    expect(make(directed('relax', 'zombies'))).toBeNull();
    expect(make(directed('relax'), 0)).toBeNull();
  });

  it('o humano parado só morre: em 75 s os bots já pioraram (e a partida segue determinística)', () => {
    const run = (): number | null => {
      const match = createHeadlessMatch({
        recipe: directed('balanced'),
        map: arena(),
        humans: 1,
        paths: TEST_NAV_PATHS,
      });
      match.run(75 * SIM_HZ);
      const shift = match.director.directorShift();
      match.dispose();
      return shift;
    };
    const a = run();
    expect(a).not.toBeNull();
    expect(a!).toBeLessThan(0);
    expect(run()).toBe(a);
  }, 30_000);
});
