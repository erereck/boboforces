import { BOT_LEVELS, builtinBotRef, MATCH_RECIPE_FORMAT, type BotLevel, type MatchRecipe } from '@boboforces/format';
import { createInputFrame } from '@boboforces/input';
import {
  BOT_CONTROLLER_BASE,
  createInputFrames,
  createSim,
  ENTITY_FLAG,
  entityIndex,
  SIM_HZ,
  type SimEvent,
  type SimMap,
} from '@boboforces/sim';
import { cellCenter, createTestBlocks, createWorldGrid, fillBox, makeCell } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { createBotDirector } from './director.ts';
import { aimSkillForLevel, BOT_SKILLS, levelSkillsMatch } from './skill.ts';

const blocks = createTestBlocks();
const concrete = makeCell(blocks.byKey('concrete')!.id);

/** Corredor plano: humano parado ao norte, bot ao sul a `distance` m, os dois se olhando. */
function corridor(distance: number, wallBetween = false): SimMap {
  const grid = createWorldGrid(24, 8, 80);
  fillBox(grid, 0, 0, 0, 23, 0, 79, concrete);
  if (wallBetween) fillBox(grid, 0, 1, 20, 23, 6, 20, concrete);
  const x = cellCenter(12);
  return {
    grid,
    blocks,
    spawns: [
      { x, y: 0.5, z: 5, yaw: Math.PI, team: 0 },
      { x, y: 0.5, z: 5 + distance, yaw: 0, team: 1 },
    ],
  };
}

function humanVsBot(level: BotLevel, seed = 3): MatchRecipe {
  return {
    format: MATCH_RECIPE_FORMAT,
    mode: 'warfare.tdm',
    map: 'test',
    seed,
    teams: [{ humans: 1, bots: [] }, { bots: [{ ref: builtinBotRef(level), count: 1 }] }],
  };
}

describe('níveis rápidos', () => {
  it('seguem a tabela da gameplay.md §6.6 e melhoram a cada nível', () => {
    expect(aimSkillForLevel('normal')).toMatchObject({ reactionS: 0.45, aimErrorDeg: 2, turnDegPerS: 320 });
    for (let i = 1; i < BOT_LEVELS.length; i++) {
      const lo = BOT_SKILLS[BOT_LEVELS[i - 1]!];
      const hi = BOT_SKILLS[BOT_LEVELS[i]!];
      expect(hi.reactionS).toBeLessThan(lo.reactionS);
      expect(hi.aimErrorDeg).toBeLessThan(lo.aimErrorDeg);
      expect(hi.acquireS).toBeLessThan(lo.acquireS);
      expect(hi.turnDegPerS).toBeGreaterThan(lo.turnDegPerS);
      expect(hi.recoilControl).toBeGreaterThan(lo.recoilControl);
      expect(hi.headPreference).toBeGreaterThan(lo.headPreference);
    }
  });
});

describe('BotDirector', () => {
  it('M2 (fase 3a): a habilidade dos níveis no bot@1 (format) é a mesma da IA', () => {
    expect(levelSkillsMatch()).toBe(true);
  });

  it('M2 (fase 2e): Ajustar desafio troca o nível só do time pedido (-1 = todos)', () => {
    const recipe = {
      ...humanVsBot('normal'),
      teams: [
        { humans: 1, bots: [{ ref: builtinBotRef('vibe'), count: 2 }] },
        { bots: [{ ref: builtinBotRef('vibe'), count: 3 }] },
      ],
    } as MatchRecipe;
    const bots = createBotDirector({ recipe, humans: 1 });
    expect(bots.setLevel('tryhard', 1)).toBe(3);
    expect(bots.setLevel('chill', -1)).toBe(5);
    expect(bots.setLevel('normal', 3)).toBe(0);
  });

  it('acha o humano parado, mira e mata; não mexe no frame do humano', () => {
    const recipe = humanVsBot('normal');
    const sim = createSim({ recipe, map: corridor(15), humans: 1 });
    const bots = createBotDirector({ recipe, humans: 1 });
    expect(bots.botCount).toBe(1);
    const frames = createInputFrames();
    const human = frames[0]!;
    const events: SimEvent[] = [];
    let killer = 0;
    for (let t = 0; t < 10 * SIM_HZ && killer === 0; t++) {
      bots.think(sim.view(), frames);
      sim.step(frames);
      events.length = 0;
      sim.drainEvents(events);
      for (const ev of events) if (ev.type === 'kill') killer = ev.killer;
    }
    expect(killer).toBe(sim.controllerEntity(BOT_CONTROLLER_BASE));
    expect(human).toEqual(createInputFrame());
    expect(frames[BOT_CONTROLLER_BASE]!.seq).toBeGreaterThan(0);
  });

  it('parede no meio: o bot não vê, não atira e anda pela arena', () => {
    const recipe = humanVsBot('tryhard');
    const sim = createSim({ recipe, map: corridor(30, true), humans: 1 });
    const bots = createBotDirector({ recipe, humans: 1 });
    const frames = createInputFrames();
    const events: SimEvent[] = [];
    let shots = 0;
    const e = entityIndex(sim.controllerEntity(BOT_CONTROLLER_BASE));
    const start = sim.view().position[e * 3 + 2]!;
    let moved = 0;
    for (let t = 0; t < 5 * SIM_HZ; t++) {
      bots.think(sim.view(), frames);
      sim.step(frames);
      events.length = 0;
      sim.drainEvents(events);
      shots += events.filter((ev) => ev.type === 'shot').length;
      moved = Math.max(moved, Math.abs(sim.view().position[e * 3 + 2]! - start));
    }
    expect(shots).toBe(0);
    expect(moved).toBeGreaterThan(1);
  });

  it('bot morto escreve frame neutro; ref desconhecida vira Normal', () => {
    const recipe: MatchRecipe = {
      ...humanVsBot('normal'),
      teams: [{ humans: 1, bots: [] }, { bots: [{ ref: 'embedded:abc', count: 2 }] }],
    };
    const sim = createSim({ recipe, map: corridor(15), humans: 1 });
    const bots = createBotDirector({ recipe, humans: 1 });
    expect(bots.botCount).toBe(2);
    const frames = createInputFrames();
    bots.think(sim.view(), frames);
    // Mata o bot à força pela view (só para o teste; a view é somente leitura para todos os outros).
    const e = entityIndex(sim.controllerEntity(BOT_CONTROLLER_BASE));
    (sim.view().flags as Uint32Array)[e] = ENTITY_FLAG.dead;
    frames[BOT_CONTROLLER_BASE]!.buttons = 0xff;
    bots.think(sim.view(), frames);
    expect(frames[BOT_CONTROLLER_BASE]!.buttons).toBe(0);
    expect(frames[BOT_CONTROLLER_BASE]!.moveX).toBe(0);
    expect(() => bots.think(sim.view(), frames.slice(0, BOT_CONTROLLER_BASE))).toThrow();
  });

  it('o orçamento de raios vai para os inimigos mais próximos, não para os de índice menor', () => {
    // 4 humanos (entidades 0..3) escondidos atrás de paredes a 25 m e 1 bot inimigo (entidade 4) à vista a 10 m, todos
    // no cone do observador (entidade 5). Antes, os 4 escondidos gastavam os 4 raios e o bot à vista nunca era visto.
    const grid = createWorldGrid(40, 8, 80);
    fillBox(grid, 0, 0, 0, 39, 0, 79, concrete);
    fillBox(grid, 0, 1, 50, 15, 6, 50, concrete);
    fillBox(grid, 24, 1, 50, 39, 6, 50, concrete);
    const hidden = [4, 6, 14, 16].map((x) => ({ x, y: 0.5, z: 30, yaw: 0, team: 0 }));
    const map: SimMap = {
      grid,
      blocks,
      spawns: [...hidden, { x: 10, y: 0.5, z: 15, yaw: 0, team: 0 }, { x: 10, y: 0.5, z: 5, yaw: Math.PI, team: 1 }],
    };
    const recipe: MatchRecipe = {
      format: MATCH_RECIPE_FORMAT,
      mode: 'warfare.tdm',
      map: 'test',
      seed: 5,
      teams: [
        { humans: 4, bots: [{ ref: builtinBotRef('normal'), count: 1 }] },
        { bots: [{ ref: builtinBotRef('normal'), count: 1 }] },
      ],
    };
    const sim = createSim({ recipe, map, humans: 4 });
    const bots = createBotDirector({ recipe, humans: 4 });
    const observer = sim.controllerEntity(BOT_CONTROLLER_BASE + 1);
    expect(entityIndex(observer)).toBe(5);
    const frames = createInputFrames();
    const events: SimEvent[] = [];
    let shots = 0;
    for (let t = 0; t < 2 * SIM_HZ; t++) {
      bots.think(sim.view(), frames);
      sim.step(frames);
      events.length = 0;
      sim.drainEvents(events);
      for (const ev of events) if (ev.type === 'shot' && ev.shooter === observer) shots++;
    }
    expect(shots).toBeGreaterThan(0);
  });

  it('mesma receita, mesmos frames (determinístico)', () => {
    const run = (): string => {
      const recipe = humanVsBot('sweaty', 11);
      const sim = createSim({ recipe, map: corridor(20), humans: 1 });
      const bots = createBotDirector({ recipe, humans: 1 });
      const frames = createInputFrames();
      const trace: number[] = [];
      for (let t = 0; t < 300; t++) {
        bots.think(sim.view(), frames);
        const f = frames[BOT_CONTROLLER_BASE]!;
        trace.push(f.buttons, f.moveX, f.moveY, f.yaw, f.pitch);
        sim.step(frames);
      }
      return `${trace.join(',')}|${sim.stateHash()}`;
    };
    expect(run()).toBe(run());
  });
});

describe('cérebro de reserva do sofá (M3, fase 1c)', () => {
  it('o humano 1 com reserva: parado enquanto pilotado, a IA assume quando ele sai; o bot assumido para de pensar', () => {
    const recipe: MatchRecipe = {
      ...humanVsBot('normal'),
      teams: [{ humans: 2, bots: [] }, { bots: [{ ref: builtinBotRef('normal'), count: 1 }] }],
    };
    const sim = createSim({ recipe, map: corridor(20), humans: 2 });
    const bots = createBotDirector({ recipe, humans: 2, standby: [1] });
    // A reserva não conta como bot da receita.
    expect(bots.botCount).toBe(1);
    const frames = createInputFrames();
    for (let t = 0; t < SIM_HZ; t++) {
      bots.think(sim.view(), frames);
      sim.step(frames);
    }
    expect(frames[1]!.seq).toBe(0);
    expect(frames[BOT_CONTROLLER_BASE]!.seq).toBeGreaterThan(0);
    // O P2 sai: o cérebro dele passa a escrever o frame. O bot da receita é assumido: o frame dele para.
    bots.setHumanControlled(1, false);
    bots.setHumanControlled(BOT_CONTROLLER_BASE, true);
    const botSeq = frames[BOT_CONTROLLER_BASE]!.seq;
    for (let t = 0; t < SIM_HZ; t++) {
      bots.think(sim.view(), frames);
      sim.step(frames);
    }
    expect(frames[1]!.seq).toBeGreaterThan(0);
    expect(frames[BOT_CONTROLLER_BASE]!.seq).toBe(botSeq);
  });
});
