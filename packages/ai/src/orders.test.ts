import { levelBot, MATCH_RECIPE_FORMAT, PERSONALITY_PRESETS, type BotRef, type MatchRecipe } from '@boboforces/format';
import { BUTTON, ORDER, withOrder, type InputFrame } from '@boboforces/input';
import { angleDelta, createRng, pitchToI16, yawToU16 } from '@boboforces/shared';
import { BOBO_NAV_METRICS, BOT_CONTROLLER_BASE, createSim, ENTITY_FLAG, SIM_HZ, type SimMap } from '@boboforces/sim';
import { buildTestNav, TEST_NAV_PATHS } from '@boboforces/sim/testing';
import { cellCenter, createTestBlocks, createWorldGrid, fillBox, makeCell } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { AI_GROUP } from './config-group.ts';
import { AiContext } from './context.ts';
import { GroupState, updateFollowSlot } from './group.ts';
import { createHeadlessMatch, type HeadlessMatch } from './headless.ts';
import { coverThreat, orderChance } from './orders.ts';
import { PathFollower, PathService } from './paths.ts';
import { SoldierBrain, SoldierTiming } from './soldier.ts';

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
    expect(answer).toMatchObject({ order: ORDER.hold, asked: 3, obeyed: 3, lowLevel: 0 });
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
    // M12 (fase 2, prints): e a resposta diz que foi pelo nível (a cena explica: De boa não segue ordens).
    expect(m.director.orderAnswer(0)).toMatchObject({ order: ORDER.attack, asked: 2, obeyed: 0, lowLevel: 2 });
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

  it('M12 (fase 7b): Vem comigo: cada um na sua vaga atrás do humano; ele para e vira, e as vagas vão para as costas dele', () => {
    // O humano anda 4 s para o norte (−Z) e para; depois olha para o sul (yaw π, a "porta") por 5 s.
    const at = 2 * SIM_HZ;
    const turn = at + 4 * SIM_HZ;
    const m = scripted(
      (t, f) => {
        f.buttons = t >= at && t < at + 6 ? withOrder(0, ORDER.follow) : 0;
        f.moveY = t > at && t < turn ? 127 : 0;
        f.yaw = yawToU16(t >= turn ? Math.PI : 0);
      },
      squad('embedded:leal', 3),
    );
    play(m, at + 1);
    expect(m.director.orderAnswer(0)).toMatchObject({ asked: 3, obeyed: 3 });
    play(m, turn - at - 2);
    // Andando: atrás do caminho (ao sul, +Z).
    const [wx, wz] = where(m, 0);
    for (let i = 0; i < 3; i++) {
      const [bx, bz] = where(m, BOT_CONTROLLER_BASE + i);
      expect(bz - wz, `bot ${i} atrás do caminho`).toBeGreaterThan(0.8);
      expect(Math.hypot(bx - wx, bz - wz), `bot ${i} vindo junto`).toBeLessThan(9);
    }
    play(m, 5 * SIM_HZ + 2);
    const [hx, hz] = where(m, 0);
    const bots = [0, 1, 2].map((i) => where(m, BOT_CONTROLLER_BASE + i));
    for (const [i, [bx, bz]] of bots.entries()) {
      // Revisão: parado e olhando para o sul, as vagas vão para as costas dele (ao norte; a de ±80° fica quase ao lado),
      // ninguém entre ele e a porta.
      expect(bz - hz, `bot ${i} fora da frente`).toBeLessThan(0.5);
      expect(Math.hypot(bx - hx, bz - hz), `bot ${i} perto`).toBeLessThan(4.5);
    }
    expect(bots.filter(([, bz]) => bz - hz < -0.8).length, 'nas costas').toBeGreaterThanOrEqual(2);
    // Uma vaga por bot: ninguém em cima do outro.
    for (let i = 0; i < 3; i++) {
      for (let j = i + 1; j < 3; j++) {
        const d = Math.hypot(bots[i]![0] - bots[j]![0], bots[i]![1] - bots[j]![1]);
        expect(d, `bots ${i} e ${j}`).toBeGreaterThan(1);
      }
    }
    // Parados, olham para fora: o humano olha para o sul, eles vigiam as costas dele (o norte), cada um no seu setor.
    const v = m.sim.view();
    for (let i = 0; i < 3; i++) {
      const e = m.sim.controllerEntity(BOT_CONTROLLER_BASE + i) & 0xffff;
      expect(Math.abs(angleDelta(v.yaw[e]!, 0)), `bot ${i} vigia`).toBeLessThan((105 * Math.PI) / 180);
    }
    m.dispose();
  }, 30_000);

  it('M12 (fase 7b): Me cobre: o bot atira em quem feriu o humano, não no inimigo mais perto', () => {
    const base = levelBot('normal');
    const shooter = {
      ...base,
      id: 'atirador',
      name: 'Atirador',
      personality: PERSONALITY_PRESETS.camper,
      rules: { ...base.rules, hp: 1000 },
    };
    const dummy = {
      ...base,
      id: 'alvo',
      name: 'Alvo',
      personality: PERSONALITY_PRESETS.dummy,
      rules: { ...base.rules, hp: 1000, damageMult: 0 },
    };
    const recipe: MatchRecipe = {
      format: MATCH_RECIPE_FORMAT,
      mode: 'warfare.tdm',
      map: 'test',
      seed: 11,
      // M12 (fase 7a): o bot não mira em quem tem a proteção de spawn; aqui a ordem é o que se mede.
      players: { hp: 1000, spawnProtectionS: 0 },
      teams: [
        { humans: 1, bots: [{ ref: 'embedded:leal', count: 1 }] },
        {
          bots: [
            { ref: 'embedded:atirador', count: 1 },
            { ref: 'embedded:alvo', count: 1 },
          ],
        },
      ],
      embeddedBots: [LOYAL, shooter, dummy],
    };
    // O humano em z = 40 m, o bot 4 m atrás dele; o atirador 28 m à frente do humano (olhando para ele) e o alvo
    // parado, que não atira, a 8,5 m do bot (o inimigo mais perto, no cone dele) e fora da linha até o atirador.
    const grid = createWorldGrid(96, 8, 96);
    fillBox(grid, 0, 0, 0, 95, 0, 95, concrete);
    const map: SimMap = {
      grid,
      blocks,
      spawns: [
        { x: 24.25, y: 0.5, z: 40, yaw: 0, team: 0 },
        { x: 24.25, y: 0.5, z: 44, yaw: 0, team: 0 },
        { x: 24.25, y: 0.5, z: 12, yaw: Math.PI, team: 1 },
        { x: 18.25, y: 0.5, z: 38, yaw: Math.PI / 2, team: 1 },
      ],
      nav: buildTestNav({ grid, blocks }, BOBO_NAV_METRICS),
    };
    const at = 2 * SIM_HZ;
    const hits = (order: boolean): { shooter: number; dummy: number; hurtAt: number } => {
      let tick = 0;
      let hurtAt = -1;
      const out = { shooter: 0, dummy: 0, hurtAt: -1 };
      const m = createHeadlessMatch({
        recipe,
        map,
        humans: 1,
        paths: TEST_NAV_PATHS,
        writeHumans: (f: InputFrame[]) => {
          f[0]!.buttons = order && tick >= at && tick < at + 6 ? withOrder(0, ORDER.cover) : 0;
          tick++;
        },
        onEvents: (events, sim) => {
          const bot = sim.controllerEntity(BOT_CONTROLLER_BASE);
          for (const ev of events) {
            if (ev.type !== 'hit') continue;
            if (ev.target === sim.controllerEntity(0) && hurtAt < 0) hurtAt = tick;
            // Do 1 s depois da ordem (e do 1º tiro no humano) em diante.
            if (ev.shooter !== bot || hurtAt < 0 || tick < Math.max(hurtAt, at) + SIM_HZ) continue;
            if (ev.target === sim.controllerEntity(BOT_CONTROLLER_BASE + 1)) out.shooter++;
            if (ev.target === sim.controllerEntity(BOT_CONTROLLER_BASE + 2)) out.dummy++;
          }
        },
      });
      play(m, at + 1);
      if (order) expect(m.director.orderAnswer(0)).toMatchObject({ order: ORDER.cover, obeyed: 1 });
      play(m, 8 * SIM_HZ);
      m.dispose();
      out.hurtAt = hurtAt;
      return out;
    };
    const covered = hits(true);
    const free = hits(false);
    expect(covered.hurtAt).toBeGreaterThan(0);
    expect(covered.shooter, JSON.stringify({ covered, free })).toBeGreaterThan(covered.dummy);
    expect(free.dummy, JSON.stringify({ covered, free })).toBeGreaterThan(free.shooter);
  }, 30_000);

  it('revisão: o Me cobre segura o alvo (histerese), não larga quem atira nele e fora do cone só ouve até 50 m', () => {
    // O humano (0), o bot leal (1) e três inimigos parados (A, B, C) numa arena aberta; as posições são postas à mão e a
    // memória de quem feriu quem, escrita direto no `AiContext`.
    const recipe: MatchRecipe = {
      format: MATCH_RECIPE_FORMAT,
      mode: 'warfare.tdm',
      map: 'test',
      seed: 11,
      teams: [
        { humans: 1, bots: [{ ref: 'embedded:leal', count: 1 }] },
        { bots: [{ ref: 'embedded:leal', count: 3 }] },
      ],
      embeddedBots: [LOYAL],
    };
    const grid = createWorldGrid(160, 8, 240);
    fillBox(grid, 0, 0, 0, 159, 0, 239, concrete);
    const sim = createSim({ recipe, map: { grid, blocks, spawns: arena().spawns }, humans: 1 });
    const v = sim.view();
    const ent = (c: number): number => sim.controllerEntity(c) & 0xffff;
    const [owner, me, a, bb, cc] = [
      0,
      BOT_CONTROLLER_BASE,
      BOT_CONTROLLER_BASE + 1,
      BOT_CONTROLLER_BASE + 2,
      BOT_CONTROLLER_BASE + 3,
    ].map(ent) as [number, number, number, number, number];
    // M12 (fase 7a): ninguém com a proteção de spawn (o Me cobre não mira nela).
    for (const e of [owner, me, a, bb, cc]) v.flags[e] = v.flags[e]! & ~ENTITY_FLAG.spawnProtected;
    const place = (e: number, x: number, z: number): void => {
      v.position[e * 3] = x;
      v.position[e * 3 + 1] = 0.5;
      v.position[e * 3 + 2] = z;
    };
    const c = new AiContext(SIM_HZ, false, 100, new PathService(TEST_NAV_PATHS, []));
    const hurt = (victim: number, attacker: number, k: number): void => {
      c.hurtBy[victim * AI_GROUP.coverAttackers + k] = sim.controllerEntity(
        attacker === a ? BOT_CONTROLLER_BASE + 1 : attacker === bb ? BOT_CONTROLLER_BASE + 2 : BOT_CONTROLLER_BASE + 3,
      );
      c.hurtTick[victim * AI_GROUP.coverAttackers + k] = v.tick;
    };
    const b = new SoldierBrain(
      0,
      BOT_CONTROLLER_BASE,
      'normal',
      createRng(1),
      new SoldierTiming(SIM_HZ),
      new PathFollower(0),
      LOYAL,
    );
    b.order = ORDER.cover;
    b.orderOwner = owner;
    b.orderOwnerGen = v.generation[owner]!;
    b.orderUntil = 1_000_000;
    // O bot em (40, 100) olhando para o sul (+Z, de costas para os inimigos ao norte); o humano ao lado. A e B feriram
    // o humano.
    b.aimYaw = Math.PI;
    place(owner, 42, 100);
    place(me, 40, 100);
    const threat = (target: number): number => {
      c.begin(v);
      hurt(owner, a, 0);
      hurt(owner, bb, 1);
      b.target = target;
      b.targetGen = target >= 0 ? v.generation[target]! : 0;
      return coverThreat(c, b, me, 40, 0.5 + 1.55, 100);
    };
    place(a, 40, 88);
    place(bb, 40, 86);
    // Sem alvo: o atacante mais perto (A, 12 m).
    expect(threat(-1)).toBe(a);
    // Com B (14 m) no alvo, A (12 m) não toma o lugar (só a menos de 70% da distância).
    expect(threat(bb)).toBe(bb);
    // A a 8 m (menos de 9,8 m): troca.
    place(a, 40, 92);
    expect(threat(bb)).toBe(a);
    // C, que feriu o próprio bot, segue no alvo (A a 16 m, não muito mais perto que C a 20 m).
    place(a, 40, 84);
    place(cc, 40, 80);
    c.begin(v);
    hurt(me, cc, 0);
    hurt(owner, a, 0);
    b.target = cc;
    b.targetGen = v.generation[cc]!;
    expect(coverThreat(c, b, me, 40, 2.05, 100)).toBe(cc);
    // Fora do cone (atrás do bot, ao norte): até 50 m ele ouve; a 60 m, não (sobra a percepção de sempre).
    place(bb, 40, 30);
    place(a, 40, 60);
    expect(threat(-1)).toBe(a);
    place(a, 40, 40);
    expect(threat(-1)).toBe(-1);
    sim.dispose();
  });

  it('revisão: a vaga não segue o pulo do líder (usa o chão dele e, sem nó bom, fica a de antes)', () => {
    const sim = createSim({ recipe: squad('embedded:leal', 1), map: arena(), humans: 1 });
    const v = sim.view();
    const owner = sim.controllerEntity(0) & 0xffff;
    const me = sim.controllerEntity(BOT_CONTROLLER_BASE) & 0xffff;
    const c = new AiContext(SIM_HZ, false, 100, new PathService(TEST_NAV_PATHS, []));
    const g = new GroupState();
    c.begin(v);
    updateFollowSlot(c, v, g, me, owner, false, 60);
    const before = [g.slotX, g.slotY, g.slotZ];
    expect(Math.hypot(before[0]! - v.position[owner * 3]!, before[2]! - v.position[owner * 3 + 2]!)).toBeGreaterThan(
      1.5,
    );
    // No ar, 2 m acima do chão (sem a marca de "no chão").
    v.position[owner * 3 + 1] = v.position[owner * 3 + 1]! + 2;
    v.flags[owner] = v.flags[owner]! & ~ENTITY_FLAG.onGround;
    c.begin(v);
    updateFollowSlot(c, v, g, me, owner, false, 60);
    expect([g.slotX, g.slotY, g.slotZ]).toEqual(before);
    sim.dispose();
  });

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
