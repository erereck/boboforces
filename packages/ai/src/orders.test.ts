import { levelBot, MATCH_RECIPE_FORMAT, PERSONALITY_PRESETS, type BotRef, type MatchRecipe } from '@boboforces/format';
import { BUTTON, ORDER, withOrder, type InputFrame } from '@boboforces/input';
import { pitchToI16, yawToU16 } from '@boboforces/shared';
import { BOBO_NAV_METRICS, BOT_CONTROLLER_BASE, SIM_HZ, type SimMap } from '@boboforces/sim';
import { buildTestNav, TEST_NAV_PATHS } from '@boboforces/sim/testing';
import { cellCenter, createTestBlocks, createWorldGrid, fillBox, makeCell } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { createHeadlessMatch, type HeadlessMatch } from './headless.ts';
import { orderChance } from './orders.ts';

/** M8 (fase 6): as ordens aos bots aliados (a lealdade, o Segura aqui, o Vem comigo e o N1 que ignora). */

describe('M8 (fase 6): a lealdade', () => {
  it('a chance de cada personalidade (pergunta Z6), com os cortes do Covarde e do Camper', () => {
    const p = PERSONALITY_PRESETS;
    expect(orderChance(p.support, ORDER.follow)).toBe(1);
    expect(orderChance(p.balanced, ORDER.attack)).toBeCloseTo(0.7, 9);
    expect(orderChance(p.rusher, ORDER.hold)).toBeCloseTo(0.4, 9);
    expect(orderChance(p.coward, ORDER.attack)).toBeCloseTo(0.5, 9);
    expect(orderChance(p.coward, ORDER.follow)).toBeCloseTo(0.7, 9);
    expect(orderChance(p.camper, ORDER.follow)).toBeCloseTo(0.3, 9);
    expect(orderChance(p.camper, ORDER.hold)).toBeCloseTo(0.7, 9);
    expect(orderChance(p.dummy, ORDER.cover)).toBe(0);
  });
});

const blocks = createTestBlocks();
const concrete = makeCell(blocks.byKey('concrete')!.id);

/** Uma arena aberta de 48 × 48 m (96 células de 0,5 m), só com o time do humano (sem inimigo: o passeio leva os bots para longe). */
function arena(): SimMap {
  const grid = createWorldGrid(96, 8, 96);
  fillBox(grid, 0, 0, 0, 95, 0, 95, concrete);
  return {
    grid,
    blocks,
    spawns: [
      { x: cellCenter(48), y: 0.5, z: 40, yaw: 0, team: 0 },
      { x: cellCenter(48), y: 0.5, z: 4, yaw: Math.PI, team: 1 },
    ],
    nav: buildTestNav({ grid, blocks }, BOBO_NAV_METRICS),
  };
}

/** Um bot Equilibrado do N2 com lealdade 100% (passeia quando está livre; o Buddy, Suporte, já segue o humano). */
const LOYAL = {
  ...levelBot('normal'),
  id: 'leal',
  name: 'Leal',
  personality: { ...PERSONALITY_PRESETS.balanced, loyalty: 1 },
};

function squad(ref: BotRef, count: number): MatchRecipe {
  return {
    format: MATCH_RECIPE_FORMAT,
    mode: 'warfare.tdm',
    map: 'test',
    seed: 11,
    teams: [{ humans: 1, bots: [{ ref, count }] }, { bots: [] }],
    embeddedBots: [LOYAL],
  };
}

/** Roda `ticks` ticks (o humano escreve o frame dele no `writeHumans` da partida). */
function play(m: HeadlessMatch, ticks: number, onTick?: () => void): void {
  for (let t = 0; t < ticks; t++) {
    m.step();
    onTick?.();
  }
}

/** Posição (x, z) da entidade do controlador. */
function where(m: HeadlessMatch, controller: number): [number, number] {
  const e = m.sim.controllerEntity(controller) & 0xffff;
  const v = m.sim.view();
  return [v.position[e * 3]!, v.position[e * 3 + 2]!];
}

function orderedMatch(ref: BotRef, count: number, order: number, at: number, walk: boolean): HeadlessMatch {
  let tick = 0;
  return createHeadlessMatch({
    recipe: squad(ref, count),
    map: arena(),
    humans: 1,
    paths: TEST_NAV_PATHS,
    writeHumans: (f: InputFrame[]) => {
      const h = f[0]!;
      h.buttons = tick >= at && tick < at + 6 ? withOrder(0, order) : 0;
      // Andando para o norte (−Z) depois da ordem.
      h.moveY = walk && tick > at ? 127 : 0;
      tick++;
    },
  });
}

describe('M8 (fase 6): as ordens na partida', () => {
  it('Segura aqui: os bots leais do N2 ficam no ponto por 20 s, sem passear e sem o Destravar', () => {
    const at = 2 * SIM_HZ;
    const m = orderedMatch('embedded:leal', 3, ORDER.hold, at, false);
    play(m, at + 1);
    const answer = m.director.orderAnswer(0);
    expect(answer).toMatchObject({ order: ORDER.hold, asked: 3, obeyed: 3 });
    const [hx, hz] = where(m, 0);
    let unstuck = 0;
    play(m, 20 * SIM_HZ, () => {
      for (let i = 0; i < 3; i++) if ((m.frames[BOT_CONTROLLER_BASE + i]!.buttons & BUTTON.unstuck) !== 0) unstuck++;
    });
    expect(unstuck).toBe(0);
    for (let i = 0; i < 3; i++) {
      const [bx, bz] = where(m, BOT_CONTROLLER_BASE + i);
      expect(Math.hypot(bx - hx, bz - hz), `bot ${i}`).toBeLessThan(5);
    }
    m.dispose();
    // O controle: sem a ordem, os mesmos bots passeiam para longe.
    const free = orderedMatch('embedded:leal', 3, ORDER.none, at, false);
    play(free, at + 1 + 20 * SIM_HZ);
    let far = 0;
    for (let i = 0; i < 3; i++) {
      const [bx, bz] = where(free, BOT_CONTROLLER_BASE + i);
      if (Math.hypot(bx - hx, bz - hz) > 5) far++;
    }
    expect(far).toBeGreaterThan(0);
    free.dispose();
  }, 30_000);

  it('Vem comigo: o humano anda 25 m e os bots leais vão atrás', () => {
    const at = 2 * SIM_HZ;
    const m = orderedMatch('embedded:leal', 2, ORDER.follow, at, true);
    play(m, at + 6 * SIM_HZ);
    const [hx, hz] = where(m, 0);
    expect(hz).toBeLessThan(30);
    for (let i = 0; i < 2; i++) {
      const [bx, bz] = where(m, BOT_CONTROLLER_BASE + i);
      expect(Math.hypot(bx - hx, bz - hz), `bot ${i}`).toBeLessThan(9);
    }
    m.dispose();
  }, 30_000);

  it('o N1 (Chill Bob) ignora: ouviram 2, ninguém obedeceu', () => {
    const at = 2 * SIM_HZ;
    // Mirando o chão uns 14 m à frente (o Ataca ali precisa de chão no ponto).
    const m = scripted(
      (t, f) => {
        f.pitch = pitchToI16(-0.11);
        f.buttons = t >= at && t < at + 6 ? withOrder(0, ORDER.attack) : 0;
      },
      squad('builtin:chill-bob', 2),
    );
    play(m, at + 2);
    expect(m.director.orderAnswer(0)).toMatchObject({ order: ORDER.attack, asked: 2, obeyed: 0 });
    m.dispose();
  }, 30_000);

  it('o aviso do humano vale para os bots N3 do time (vão conferir), sem virar marcador de bot', () => {
    const at = 2 * SIM_HZ;
    // O humano olha para o norte e um pouco para baixo: o aviso cai no chão uns 14 m à frente.
    const pitch = pitchToI16(-0.11);
    const run = (ping: boolean): number => {
      let tick = 0;
      const m = createHeadlessMatch({
        recipe: squad('builtin:sweaty-bob', 3),
        map: arena(),
        humans: 1,
        paths: TEST_NAV_PATHS,
        writeHumans: (f: InputFrame[]) => {
          f[0]!.pitch = pitch;
          f[0]!.buttons = ping && tick >= at && tick < at + 3 ? BUTTON.ping : 0;
          tick++;
        },
      });
      play(m, at + 3);
      // O ponto: à frente do humano (−Z), no chão.
      const [hx, hz] = where(m, 0);
      const out = new Float64Array(30);
      expect(m.director.pings(0, 10 * SIM_HZ, out)).toBe(0);
      let best = Infinity;
      play(m, 10 * SIM_HZ, () => {
        for (let i = 0; i < 3; i++) {
          const [bx, bz] = where(m, BOT_CONTROLLER_BASE + i);
          best = Math.min(best, Math.hypot(bx - hx, bz - (hz - 14)));
        }
      });
      m.dispose();
      return best;
    };
    const pinged = run(true);
    const free = run(false);
    expect(pinged).toBeLessThan(3);
    expect(free).toBeGreaterThan(pinged);
  }, 30_000);
});

/** Um bot do N2 com metade de lealdade (para a recusa). */
const HALF = { ...LOYAL, id: 'meio', name: 'Meio', personality: { ...PERSONALITY_PRESETS.balanced, loyalty: 0.5 } };

/** A partida com o humano escrevendo o quadro por `write(tick, frame)` (e o mapa e a receita trocáveis). */
function scripted(
  write: (tick: number, f: InputFrame) => void,
  recipe: MatchRecipe,
  map: SimMap = arena(),
): HeadlessMatch {
  let tick = 0;
  return createHeadlessMatch({
    recipe,
    map,
    humans: 1,
    paths: TEST_NAV_PATHS,
    writeHumans: (f: InputFrame[]) => {
      write(tick, f[0]!);
      tick++;
    },
  });
}

describe('M8 (fase 6, revisão): as bordas da ordem', () => {
  it('segurada 6 ticks, sai uma vez; reenviar não sorteia de novo (quem recusou segue recusando, quem obedece renova)', () => {
    const at = 2 * SIM_HZ;
    const again = at + 2 * SIM_HZ;
    const recipe = { ...squad('embedded:meio', 4), embeddedBots: [HALF] };
    const m = scripted((t, f) => {
      const on = (t >= at && t < at + 6) || (t >= again && t < again + 6);
      f.buttons = on ? withOrder(0, ORDER.hold) : 0;
    }, recipe);
    play(m, at + 1);
    const first = { ...m.director.orderAnswer(0)! };
    expect(first.asked).toBe(4);
    play(m, 10);
    // Os 6 ticks segurados não fazem uma 2ª borda.
    expect(m.director.orderAnswer(0)!.tick).toBe(first.tick);
    play(m, again - at);
    const second = m.director.orderAnswer(0)!;
    expect(second.tick).toBeGreaterThan(first.tick);
    expect(second.obeyed).toBe(first.obeyed);
    m.dispose();
  }, 30_000);

  it('Ataca ali para o céu: sem chão no ponto, ninguém ouve (o aviso pede para mirar no chão)', () => {
    const at = 2 * SIM_HZ;
    const m = scripted(
      (t, f) => {
        f.pitch = pitchToI16(1.2);
        f.buttons = t >= at && t < at + 6 ? withOrder(0, ORDER.attack) : 0;
      },
      squad('embedded:leal', 3),
    );
    play(m, at + 1);
    expect(m.director.orderAnswer(0)).toMatchObject({ order: ORDER.attack, nowhere: true, asked: 0, obeyed: 0 });
    m.dispose();
  }, 30_000);

  it('Vem comigo de costas para a parede: os bots param do lado de cá, perto de quem mandou', () => {
    // Uma parede de 3 m em z = 30 m (de x = 10 a 38 m); o time 0 nasce encostado nela, olhando para o sul (+Z).
    const grid = createWorldGrid(96, 8, 96);
    fillBox(grid, 0, 0, 0, 95, 0, 95, concrete);
    fillBox(grid, 20, 1, 60, 76, 6, 60, concrete);
    const map: SimMap = {
      grid,
      blocks,
      spawns: [
        { x: cellCenter(48), y: 0.5, z: 31, yaw: Math.PI, team: 0 },
        { x: cellCenter(48), y: 0.5, z: 4, yaw: 0, team: 1 },
      ],
      nav: buildTestNav({ grid, blocks }, BOBO_NAV_METRICS),
    };
    const at = 10 * SIM_HZ;
    const m = scripted(
      (t, f) => {
        f.yaw = yawToU16(Math.PI);
        f.buttons = t >= at && t < at + 6 ? withOrder(0, ORDER.follow) : 0;
      },
      squad('embedded:leal', 3),
      map,
    );
    play(m, at + 1);
    expect(m.director.orderAnswer(0)).toMatchObject({ asked: 3, obeyed: 3 });
    play(m, 12 * SIM_HZ);
    const [hx, hz] = where(m, 0);
    for (let i = 0; i < 3; i++) {
      const [bx, bz] = where(m, BOT_CONTROLLER_BASE + i);
      expect(bz, `bot ${i} do lado de cá`).toBeGreaterThan(30.3);
      expect(Math.hypot(bx - hx, bz - hz), `bot ${i} perto`).toBeLessThan(5);
    }
    m.dispose();
  }, 30_000);
});
