import { builtinBotRef, levelBot, MATCH_RECIPE_FORMAT, type BotLevel, type MatchRecipe } from '@boboforces/format';
import { BUTTON, type InputFrame } from '@boboforces/input';
import { pitchToI16, yawToU16 } from '@boboforces/shared';
import {
  aimPointWorld,
  BOT_CONTROLLER_BASE,
  entityIndex,
  MAX_CONTROLLERS,
  METRICS,
  SIM_HZ,
  WEAPON_CODE,
  type AimPoint,
  type Sim,
  type SimMap,
} from '@boboforces/sim';
import {
  BLOCK_FLAG,
  cellCenter,
  createBlockRegistry,
  createWorldGrid,
  fillBox,
  makeCell,
  type WorldGrid,
} from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { burstLength } from './aim-feel.ts';
import { createHeadlessMatch } from './headless.ts';
import { BOT_PRIMARY_WEIGHTS_EASY, botPrimaries, botPrimary } from './weapons.ts';

/**
 * M12 (fase 7a): os bots percebem e miram como gente (ARCHITECTURE §23.7), em partidas headless de verdade: um humano
 * parado (controlador 0, time 0) e um bot (time 1) frente a frente num chão aberto, com o fuzil. O bot é o do nível
 * com a personalidade Equilibrada (embutido: o de nível sorteia a mistura, e o Rusher corre sem atirar).
 */

const SOLID = BLOCK_FLAG.solid | BLOCK_FLAG.blocksBullets | BLOCK_FLAG.blocksSight | BLOCK_FLAG.walkable;
const F6 = [1, 1, 1, 1, 1, 1] as const;
const blocks = createBlockRegistry([
  { key: 'concrete', shape: 'cube', faces: F6, flags: SOLID, frames: 1, stepSound: 'concrete' },
  {
    key: 'glass',
    shape: 'cube',
    faces: F6,
    flags: BLOCK_FLAG.solid | BLOCK_FLAG.translucent | BLOCK_FLAG.blocksBullets | BLOCK_FLAG.walkable,
    frames: 1,
    stepSound: 'glass',
  },
  {
    key: 'tall-grass',
    shape: 'cross',
    faces: F6,
    flags: BLOCK_FLAG.cutout | BLOCK_FLAG.swaysInWind,
    frames: 1,
    stepSound: '',
  },
]);
const CONCRETE = makeCell(blocks.byKey('concrete')!.id);
const GLASS = makeCell(blocks.byKey('glass')!.id);
const GRASS = makeCell(blocks.byKey('tall-grass')!.id);
const RIFLES: readonly number[] = new Array<number>(MAX_CONTROLLERS).fill(WEAPON_CODE.rifle);
const HUMAN_X = cellCenter(40);

interface Setup {
  /** O humano (os humanos) em z; o bot em `botZ`, olhando para +z. */
  readonly humans: readonly { x: number; z: number }[];
  readonly botZ: number;
  readonly players?: MatchRecipe['players'];
  readonly level?: BotLevel;
  readonly seed?: number;
  readonly build?: (grid: WorldGrid) => void;
}

function field(s: Setup): SimMap {
  const grid = createWorldGrid(80, 12, 200);
  fillBox(grid, 0, 0, 0, 79, 0, 199, CONCRETE);
  s.build?.(grid);
  return {
    grid,
    blocks,
    spawns: [
      ...s.humans.map((h) => ({ x: h.x, y: 0.5, z: h.z, yaw: 0, team: 0 })),
      { x: HUMAN_X, y: 0.5, z: s.botZ, yaw: Math.PI, team: 1 },
    ],
  };
}

function recipe(s: Setup): MatchRecipe {
  return {
    format: MATCH_RECIPE_FORMAT,
    mode: 'warfare.tdm',
    map: 'test',
    seed: s.seed ?? 5,
    ...(s.players !== undefined ? { players: s.players } : {}),
    teams: [{ humans: s.humans.length, bots: [] }, { bots: [{ ref: 'embedded:b', count: 1 }] }],
    embeddedBots: [{ ...levelBot(s.level ?? 'normal'), id: 'b' }],
  };
}

/** Roda `seconds` e devolve os ticks dos tiros do bot e os acertos dele em cada humano. */
function run(
  s: Setup,
  seconds: number,
  writeHumans: (frames: InputFrame[], sim: Sim) => void = (f) => {
    f[0]!.buttons = 0;
  },
): { shots: number[]; hitsOn: number[] } {
  const shots: number[] = [];
  const hitsOn = s.humans.map(() => 0);
  const match = createHeadlessMatch({
    recipe: recipe(s),
    map: field(s),
    humans: s.humans.length,
    primaries: RIFLES,
    writeHumans,
    onEvents: (events, sim) => {
      const bot = sim.controllerEntity(BOT_CONTROLLER_BASE);
      for (const ev of events) {
        if (ev.type === 'shot' && ev.shooter === bot) shots.push(ev.tick);
        if (ev.type === 'hit' && ev.shooter === bot && ev.damage > 0) {
          for (let h = 0; h < s.humans.length; h++) if (ev.target === sim.controllerEntity(h)) hitsOn[h]!++;
        }
      }
    },
  });
  match.run(Math.round(seconds * SIM_HZ));
  match.dispose();
  return { shots, hitsOn };
}

describe('M12 (fase 7a): os bots percebem como gente', () => {
  it('não mira em quem tem a proteção de spawn (a sim zera o dano dele)', () => {
    const s = (protect: number): Setup => ({
      humans: [{ x: HUMAN_X, z: 35 }],
      botZ: 20,
      players: { spawnProtectionS: protect },
    });
    expect(run(s(3), 2.5).shots.length).toBe(0);
    expect(run(s(0), 2.5).shots.length).toBeGreaterThan(0);
  });

  it('revisão: atrás de um muro opaco de 1 m (cabeça e tronco à vista), o Pela vibe atira (não contorna)', () => {
    // O muro a 1 m na frente do humano (z 35 m), de 1 m de altura (do chão de 0,5 m até 1,5 m).
    const wall = (grid: WorldGrid): void => fillBox(grid, 30, 1, 68, 50, 2, 68, CONCRETE);
    for (const seed of [1, 2, 3]) {
      const { shots } = run(
        {
          humans: [{ x: HUMAN_X, z: 35 }],
          botZ: 20,
          level: 'vibe',
          seed,
          players: { spawnProtectionS: 0, hp: 1000 },
          build: wall,
        },
        6,
      );
      expect(shots.length, `semente ${seed}`).toBeGreaterThan(20);
    }
  });

  it('não esvazia o pente no vidro: o humano numa caixa de vidro à vista não leva tiro', () => {
    const box = (grid: WorldGrid): void => {
      // Caixa de 3 × 3 m em volta do humano (x 20,5 m, z 35 m), paredes de 2,5 m.
      fillBox(grid, 38, 1, 67, 43, 5, 67, GLASS);
      fillBox(grid, 38, 1, 73, 43, 5, 73, GLASS);
      fillBox(grid, 38, 1, 67, 38, 5, 73, GLASS);
      fillBox(grid, 43, 1, 67, 43, 5, 73, GLASS);
    };
    const s = (build?: (grid: WorldGrid) => void): Setup => ({
      humans: [{ x: HUMAN_X, z: 35 }],
      botZ: 20,
      players: { spawnProtectionS: 0 },
      ...(build ? { build } : {}),
    });
    expect(run(s(box), 6).shots.length).toBe(0);
    expect(run(s(), 6).shots.length).toBeGreaterThan(0);
  });

  it('o mato esconde: agachado no capim a 55 m o bot não nota; no chão limpo, nota e atira', () => {
    const grass = (grid: WorldGrid): void => fillBox(grid, 36, 1, 146, 44, 1, 154, GRASS);
    const crouch = (f: InputFrame[]): void => {
      f[0]!.buttons = BUTTON.crouch;
    };
    const s = (build?: (grid: WorldGrid) => void): Setup => ({
      humans: [{ x: HUMAN_X, z: 75 }],
      botZ: 20,
      players: { spawnProtectionS: 0 },
      ...(build ? { build } : {}),
    });
    expect(run(s(grass), 3, crouch).shots.length).toBe(0);
    expect(run(s(), 3, crouch).shots.length).toBeGreaterThan(0);
  });

  it('revida quem bate: tomando tiro de outro inimigo mais perto, troca para ele', () => {
    // Um humano a 25 m na frente do bot (o alvo dele); o outro a 8 m do lado (fora do cone) começa a atirar no bot aos
    // 3 s. Todo mundo com 1000 de vida. O spawn pontuado escolhe quem nasce onde: o de lado é o mais perto do bot.
    const p: AimPoint = { x: 0, y: 0, z: 0 };
    const s: Setup = {
      humans: [
        { x: HUMAN_X, z: 45 },
        { x: HUMAN_X + 8, z: 20 },
      ],
      botZ: 20,
      players: { spawnProtectionS: 0, hp: 1000 },
    };
    let side = -1;
    let front = -1;
    let hitsFront = 0;
    let hitsSide = 0;
    let hitsSideBefore = 0;
    const match = createHeadlessMatch({
      recipe: recipe(s),
      map: field(s),
      humans: 2,
      primaries: RIFLES,
      writeHumans: (frames, sim) => {
        const v = sim.view();
        const bot = entityIndex(sim.controllerEntity(BOT_CONTROLLER_BASE));
        if (side < 0) {
          const a = entityIndex(sim.controllerEntity(0));
          const near = Math.abs(v.position[a * 3 + 2]! - v.position[bot * 3 + 2]!) < 1;
          side = near ? 0 : 1;
          front = 1 - side;
        }
        frames[front]!.buttons = 0;
        const sh = entityIndex(sim.controllerEntity(side));
        aimPointWorld(v, bot, false, p);
        const dx = p.x - v.position[sh * 3]!;
        const dy = p.y - (v.position[sh * 3 + 1]! + METRICS.eyeHeight);
        const dz = p.z - v.position[sh * 3 + 2]!;
        frames[side]!.yaw = yawToU16(Math.atan2(-dx, -dz));
        frames[side]!.pitch = pitchToI16(Math.atan2(dy, Math.hypot(dx, dz)));
        frames[side]!.buttons = sim.tick >= 3 * SIM_HZ && (sim.tick & 1) === 0 ? BUTTON.fire : 0;
      },
      onEvents: (events, sim) => {
        const bot = sim.controllerEntity(BOT_CONTROLLER_BASE);
        for (const ev of events) {
          if (ev.type !== 'hit' || ev.shooter !== bot || ev.damage <= 0) continue;
          if (ev.target === sim.controllerEntity(front)) hitsFront++;
          if (ev.target === sim.controllerEntity(side)) {
            hitsSide++;
            if (ev.tick < 3 * SIM_HZ) hitsSideBefore++;
          }
        }
      },
    });
    match.run(Math.round(6 * SIM_HZ));
    match.dispose();
    expect(hitsFront, `frente ${hitsFront}, lado ${hitsSide} (antes ${hitsSideBefore}), lado=${side}`).toBeGreaterThan(
      0,
    );
    expect(hitsSideBefore).toBe(0);
    expect(hitsSide).toBeGreaterThan(0);
  });

  it('rajadas de longe (triggerHold): com o fuzil a 20 m, nunca mais que 3 + 10·triggerHold tiros seguidos', () => {
    const { shots } = run({ humans: [{ x: HUMAN_X, z: 40 }], botZ: 20, players: { spawnProtectionS: 0, hp: 1000 } }, 6);
    expect(shots.length).toBeGreaterThan(20);
    let minGap = Infinity;
    for (let i = 1; i < shots.length; i++) minGap = Math.min(minGap, shots[i]! - shots[i - 1]!);
    let run1 = 1;
    let longest = 1;
    let pauses = 0;
    for (let i = 1; i < shots.length; i++) {
      const gap = shots[i]! - shots[i - 1]!;
      if (gap <= minGap + 1) run1++;
      else {
        run1 = 1;
        pauses++;
      }
      longest = Math.max(longest, run1);
    }
    expect(longest).toBeLessThanOrEqual(burstLength(0.5));
    expect(pauses).toBeGreaterThanOrEqual(3);
  });
});

describe('M12 (fase 7a): o Pela vibe e o De boa fáceis de verdade', () => {
  it('sem foguete e no máximo 5% de sniper; os outros níveis sorteiam como antes', () => {
    expect(BOT_PRIMARY_WEIGHTS_EASY.reduce((a, w) => a + w.weight, 0)).toBe(100);
    let snipers = 0;
    const n = 4000;
    for (let seed = 0; seed < 400; seed++) {
      for (let c = BOT_CONTROLLER_BASE; c < BOT_CONTROLLER_BASE + 10; c++) {
        const w = botPrimary(seed, c, true);
        expect(w).not.toBe(WEAPON_CODE.rocket);
        if (w === WEAPON_CODE.sniper) snipers++;
      }
    }
    expect(snipers / n).toBeLessThan(0.07);
    const mixed: MatchRecipe = {
      format: MATCH_RECIPE_FORMAT,
      mode: 'warfare.tdm',
      map: 'test',
      seed: 9,
      teams: [
        { bots: [{ ref: builtinBotRef('vibe'), count: 4 }] },
        { bots: [{ ref: builtinBotRef('normal'), count: 4 }] },
      ],
    };
    const list = botPrimaries(mixed, 0);
    for (let i = 0; i < 4; i++)
      expect(list[BOT_CONTROLLER_BASE + i]).toBe(botPrimary(9, BOT_CONTROLLER_BASE + i, true));
    for (let i = 4; i < 8; i++) expect(list[BOT_CONTROLLER_BASE + i]).toBe(botPrimary(9, BOT_CONTROLLER_BASE + i));
  });
});
