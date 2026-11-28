import {
  DEFAULT_BOT_RULES,
  levelBot,
  MATCH_RECIPE_FORMAT,
  type BotDocument,
  type BotLevel,
  type MatchRecipe,
} from '@boboforces/format';
import { BUTTON } from '@boboforces/input';
import { createRng, DEG_TO_RAD, yawToU16 } from '@boboforces/shared';
import {
  BOT_CONTROLLER_BASE,
  createInputFrames,
  createSim,
  entityIndex,
  METRICS,
  SIM_HZ,
  WEAPON_CODE,
  WEAPON_SLOT,
  type Sim,
  type SimMap,
} from '@boboforces/sim';
import { BLOCK_FLAG, cellCenter, createBlockRegistry, createWorldGrid, fillBox, makeCell } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { AI_FEEL, AI_SENSES } from './config.ts';
import { AiContext } from './context.ts';
import { NAV_PATH_API, PathFollower, PathService } from './paths.ts';
import {
  applySenses,
  BULLET,
  bulletClear,
  checkBullet,
  coneCos,
  gunfireShooter,
  inPlant,
  noticeRange,
  reactionRoll,
  regain,
  seeBody,
  spreadFor,
} from './senses.ts';
import { SoldierBrain, SoldierTiming } from './soldier.ts';

/** M12 (fase 7a): a percepção com cara de gente (`senses.ts`), peça por peça, numa sim de verdade quando precisa. */

const TIMING = new SoldierTiming(SIM_HZ);
const SOLID = BLOCK_FLAG.solid | BLOCK_FLAG.blocksBullets | BLOCK_FLAG.blocksSight | BLOCK_FLAG.walkable;
const F6 = [1, 1, 1, 1, 1, 1] as const;
/** Blocos de teste: concreto, vidro (tapa a bala, não a vista) e capim alto (cruz que balança). */
const M12_BLOCKS = createBlockRegistry([
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
  {
    key: 'flowers',
    shape: 'cross',
    faces: F6,
    flags: BLOCK_FLAG.cutout | BLOCK_FLAG.swaysInWind,
    frames: 1,
    stepSound: '',
  },
]);
const CONCRETE = makeCell(M12_BLOCKS.byKey('concrete')!.id);
const GLASS = makeCell(M12_BLOCKS.byKey('glass')!.id);
const GRASS = makeCell(M12_BLOCKS.byKey('tall-grass')!.id);
const FLOWERS = makeCell(M12_BLOCKS.byKey('flowers')!.id);

function brain(level: BotLevel = 'normal', bot: BotDocument = levelBot(level), index = 0): SoldierBrain {
  return new SoldierBrain(
    index,
    BOT_CONTROLLER_BASE + index,
    level,
    createRng(7 + index),
    TIMING,
    new PathFollower(0),
    bot,
  );
}

/** Dois humanos de times diferentes: o 0 em (10,25; z0) e o 1 em (10,25; z1), olhando um para o outro. */
function twoHumans(z0: number, z1: number, build?: (grid: ReturnType<typeof createWorldGrid>) => void): Sim {
  const grid = createWorldGrid(40, 12, 320);
  fillBox(grid, 0, 0, 0, 39, 0, 319, CONCRETE);
  build?.(grid);
  const map: SimMap = {
    grid,
    blocks: M12_BLOCKS,
    spawns: [
      { x: cellCenter(20), y: 0.5, z: z0, yaw: Math.PI, team: 0 },
      { x: cellCenter(20), y: 0.5, z: z1, yaw: 0, team: 1 },
    ],
  };
  const recipe: MatchRecipe = {
    format: MATCH_RECIPE_FORMAT,
    mode: 'warfare.tdm',
    map: 'test',
    seed: 1,
    teams: [
      { humans: 1, bots: [] },
      { humans: 1, bots: [] },
    ],
  };
  const sim = createSim({ recipe, map, humans: 2 });
  sim.step(createInputFrames());
  return sim;
}

function context(sim: Sim): AiContext {
  const c = new AiContext(SIM_HZ, false, 120, new PathService(NAV_PATH_API, []), 64);
  c.begin(sim.view());
  return c;
}

describe('os sentidos pelas regras do bot (`applySenses`)', () => {
  it('as regras padrão dão a percepção de antes; o N0 ouve tiro a 25 m e nenhum passo', () => {
    const b = brain('normal');
    expect(b.viewConeCos).toBe(Math.cos((AI_SENSES.viewConeDeg / 2) * DEG_TO_RAD));
    expect(b.viewRangeMul).toBe(1);
    expect([b.hearShotM, b.hearSprintM, b.hearWalkM]).toEqual([50, 15, 6]);
    expect(b.wallhack || b.knowsArea).toBe(false);
    const vibe = brain('vibe');
    expect([vibe.hearShotM, vibe.hearSprintM, vibe.hearWalkM]).toEqual([AI_SENSES.hearShotN0M, 0, 0]);
    // O "Ajustar desafio" refaz pelo nível novo.
    vibe.setLevel('chill', TIMING);
    expect(vibe.hearShotM).toBe(50);
  });

  it('cone, alcance, audição e conhecimento do Laboratório', () => {
    const doc = levelBot('normal');
    const lab: BotDocument = {
      ...doc,
      rules: { ...DEFAULT_BOT_RULES, visionDeg: 360, visionRange: 0.5, hearing: 2, knowledge: 'wallhack' },
    };
    const b = brain('normal', lab);
    expect(b.viewConeCos).toBeCloseTo(-1, 9);
    expect(b.viewRangeMul).toBe(0.5);
    expect([b.hearShotM, b.hearSprintM, b.hearWalkM]).toEqual([100, 30, 12]);
    expect(b.wallhack).toBe(true);
    applySenses(b, { ...DEFAULT_BOT_RULES, knowledge: 'area', hearing: 0 }, 2);
    expect(b.knowsArea).toBe(true);
    expect(b.hearShotM).toBe(0);
    expect(coneCos(120)).toBeCloseTo(0.5, 12);
    // Revisão: o Olho de águia não passa do alcance da partida (o teto da plataforma, regra 19).
    applySenses(b, { ...DEFAULT_BOT_RULES, visionRange: 2 }, 2);
    expect(b.viewRangeMul).toBe(1);
  });
});

describe('a reação que varia', () => {
  it('× (1 + 0,15·N(0,1)) presa em 0,7–1,5, com média perto de 1', () => {
    const b = brain();
    let sum = 0;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < 5000; i++) {
      const m = reactionRoll(b);
      sum += m;
      lo = Math.min(lo, m);
      hi = Math.max(hi, m);
    }
    expect(lo).toBeGreaterThanOrEqual(AI_FEEL.reactionMinMul);
    expect(hi).toBeLessThanOrEqual(AI_FEEL.reactionMaxMul);
    expect(hi - lo).toBeGreaterThan(0.5);
    expect(Math.abs(sum / 5000 - 1)).toBeLessThan(0.02);
  });

  it('voltar ao alvo que sumiu > 0,35 s custa meia reação (um quarto segurando o ângulo com ele na mira)', () => {
    const sim = twoHumans(20, 40);
    const view = sim.view();
    const b = brain();
    b.target = entityIndex(sim.controllerEntity(1));
    const ex = view.position[0]!;
    const ey = view.position[1]! + METRICS.eyeHeight;
    const ez = view.position[2]!;
    // Sumiu há 0,3 s: nada muda.
    b.targetSeenTick = 1000 - Math.round(0.3 * SIM_HZ);
    b.reactionReadyTick = 0;
    regain(view, b, ex, ey, ez, 1000, TIMING);
    expect(b.reactionReadyTick).toBe(0);
    // Sumiu há 1 s: meia reação.
    b.targetSeenTick = 1000 - SIM_HZ;
    regain(view, b, ex, ey, ez, 1000, TIMING);
    expect(b.reactionReadyTick).toBe(1000 + Math.round(b.reactionTicks * 0.5));
    // Segurando o ângulo, mirando nele (yaw π olha para +z): um quarto.
    b.reactionReadyTick = 0;
    b.holdAngleUntil = 2000;
    b.aimYaw = Math.PI;
    b.aimPitch = 0;
    regain(view, b, ex, ey, ez, 1000, TIMING);
    expect(b.reactionReadyTick).toBe(1000 + Math.round(b.reactionTicks * 0.25));
    // Segurando o ângulo, mas olhando para o outro lado: meia.
    b.reactionReadyTick = 0;
    b.aimYaw = 0;
    regain(view, b, ex, ey, ez, 1000, TIMING);
    expect(b.reactionReadyTick).toBe(1000 + Math.round(b.reactionTicks * 0.5));
    sim.dispose();
  });
});

describe('o mato esconde', () => {
  it('de pé no capim: metade do alcance; agachado: um quarto com teto de 12 m; perto ou atirando, o normal', () => {
    const sim = twoHumans(20, 50, (grid) => fillBox(grid, 18, 1, 98, 22, 1, 102, GRASS));
    const view = sim.view();
    const h1 = entityIndex(sim.controllerEntity(1));
    const h0 = entityIndex(sim.controllerEntity(0));
    expect(inPlant(view, h1)).toBe(true);
    expect(inPlant(view, h0)).toBe(false);
    const tick = sim.tick + 1000;
    expect(noticeRange(view, h1, 30, 120, tick, TIMING)).toBe(60);
    expect(noticeRange(view, h1, 2, 120, tick, TIMING)).toBe(120);
    expect(noticeRange(view, h0, 30, 120, tick, TIMING)).toBe(120);
    // Agachado (segura o agachar alguns ticks).
    const frames = createInputFrames();
    for (let i = 0; i < 20; i++) {
      frames[1]!.buttons = BUTTON.crouch;
      sim.step(frames);
    }
    expect(noticeRange(view, h1, 30, 120, sim.tick + 1000, TIMING)).toBe(12);
    expect(noticeRange(view, h1, 30, 40, sim.tick + 1000, TIMING)).toBe(10);
    // Atirou agora: visto normal.
    frames[1]!.buttons = BUTTON.fire | BUTTON.crouch;
    sim.step(frames);
    expect(noticeRange(view, h1, 30, 120, sim.tick, TIMING)).toBe(120);
    sim.dispose();
    // Revisão: as flores (0,5 m) não são mato alto.
    const flowers = twoHumans(20, 50, (grid) => fillBox(grid, 18, 1, 98, 22, 1, 102, FLOWERS));
    expect(inPlant(flowers.view(), entityIndex(flowers.controllerEntity(1)))).toBe(false);
    flowers.dispose();
  });
});

describe('a bala e a vista', () => {
  it('o vidro deixa ver e tapa a bala; com "vê através", a parede não tapa a vista (nem gasta raio)', () => {
    const glass = twoHumans(20, 40, (grid) => fillBox(grid, 14, 1, 60, 26, 5, 60, GLASS));
    const c = context(glass);
    const view = glass.view();
    const b = brain();
    const ex = view.position[0]!;
    const ey = view.position[1]! + METRICS.eyeHeight;
    const ez = view.position[2]!;
    const h1 = entityIndex(glass.controllerEntity(1));
    expect(c.canSee(ex, ey, ez, h1)).toBe(true);
    b.target = h1;
    expect(bulletClear(c, b, 0)).toBe(BULLET.glass);
    // Com o alvo à vista atrás do vidro, contorna; com a faca na mão, nunca.
    b.targetVisible = true;
    checkBullet(c, b, 0, TIMING);
    expect(b.bulletBlocked).toBe(true);
    const knife = createInputFrames();
    for (let i = 0; i < 40; i++) {
      knife[0]!.weapon = WEAPON_SLOT.melee;
      glass.step(knife);
    }
    expect(view.weapon[0]).toBe(WEAPON_CODE.knife);
    c.begin(view);
    b.bulletCheckTick = 0;
    checkBullet(c, b, 0, TIMING);
    expect(b.bulletBlocked).toBe(false);
    c.raysLeft = 0;
    expect(bulletClear(c, b, 0)).toBe(BULLET.noBudget);
    glass.dispose();

    const open = twoHumans(20, 40);
    const c2 = context(open);
    b.target = entityIndex(open.controllerEntity(1));
    expect(bulletClear(c2, b, 0)).toBe(BULLET.clear);
    open.dispose();

    const wall = twoHumans(20, 40, (grid) => fillBox(grid, 0, 1, 60, 39, 6, 60, CONCRETE));
    const c3 = context(wall);
    const h = entityIndex(wall.controllerEntity(1));
    expect(seeBody(c3, b, ex, ey, ez, h)).toBe(false);
    const seer = brain('normal', { ...levelBot('normal'), rules: { ...DEFAULT_BOT_RULES, knowledge: 'wallhack' } });
    const before = c3.raysTotal;
    expect(seeBody(c3, seer, ex, ey, ez, h)).toBe(true);
    expect(c3.raysTotal).toBe(before);
    wall.dispose();
  });
});

describe('o passeio que vai ao tiroteio', () => {
  it('quem atirou há até 2 s, além do raio de audição e até 120 m; o N0 não vai', () => {
    const sim = twoHumans(20, 100);
    const c = context(sim);
    const view = sim.view();
    const h1 = entityIndex(sim.controllerEntity(1));
    const b = brain('normal');
    // Ninguém atirou.
    expect(gunfireShooter(c, b, 0, view.position[0]!, view.position[2]!, TIMING)).toBe(-1);
    const frames = createInputFrames();
    frames[1]!.buttons = BUTTON.fire;
    frames[1]!.yaw = yawToU16(0);
    sim.step(frames);
    c.begin(view);
    expect(view.lastShotTick[h1]).toBeGreaterThan(sim.tick - 3);
    expect(gunfireShooter(c, b, 0, view.position[0]!, view.position[2]!, TIMING)).toBe(h1);
    // Perto (dentro do raio de audição): vira pista pela audição, não pelo passeio.
    expect(gunfireShooter(c, b, 0, view.position[0]!, view.position[2]! + 50, TIMING)).toBe(-1);
    // Longe demais (> 120 m) e o N0.
    expect(gunfireShooter(c, b, 0, view.position[0]!, view.position[2]! - 60, TIMING)).toBe(-1);
    expect(gunfireShooter(c, brain('vibe'), 0, view.position[0]!, view.position[2]!, TIMING)).toBe(-1);
    // Passados 2 s, esqueceu.
    c.tick = view.lastShotTick[h1]! + TIMING.gunfireRecent + 1;
    expect(gunfireShooter(c, b, 0, view.position[0]!, view.position[2]!, TIMING)).toBe(-1);
    sim.dispose();
  });
});

describe('a bala na cobertura baixa (revisão)', () => {
  it('o muro opaco na frente do tronco não faz contornar: com a cabeça livre, mira nela; sem nada livre, briga', () => {
    // O muro de 1,5 m (o topo a 2 m do chão de 0,5 m) a 1 m do humano 1: tapa o centro do tronco, não o da cabeça.
    const sim = twoHumans(20, 40, (grid) => fillBox(grid, 14, 1, 78, 26, 3, 78, CONCRETE));
    const c = context(sim);
    const view = sim.view();
    const h1 = entityIndex(sim.controllerEntity(1));
    const b = brain();
    b.target = h1;
    b.targetVisible = true;
    b.aimHead = false;
    expect(bulletClear(c, b, 0)).toBe(BULLET.opaque);
    checkBullet(c, b, 0, TIMING);
    expect(b.bulletBlocked).toBe(false);
    expect(b.aimHead).toBe(true);
    expect(bulletClear(c, b, 0)).toBe(BULLET.clear);
    sim.dispose();
    // Muro alto (tapa tudo, mas o bot "vê" por outra fresta): briga como antes, sem contornar.
    const tall = twoHumans(20, 40, (grid) => fillBox(grid, 14, 1, 78, 26, 7, 78, CONCRETE));
    const c2 = context(tall);
    const t = brain();
    t.target = entityIndex(tall.controllerEntity(1));
    t.targetVisible = true;
    t.aimHead = false;
    checkBullet(c2, t, 0, TIMING);
    expect(t.bulletBlocked).toBe(false);
    expect(t.aimHead).toBe(false);
    tall.dispose();
  });
});

describe('o bot devolvido (revisão)', () => {
  it('restart: esquece o alvo, a reação e a mira velhos e reinicia como no renascer', () => {
    const b = brain();
    b.wasDead = false;
    b.target = 3;
    b.targetVisible = true;
    b.wasTargetVisible = true;
    b.reactionReadyTick = 500;
    b.estVx = 4;
    b.bulletBlocked = true;
    b.hasLastKnown = true;
    b.fireHeld = true;
    b.restart();
    expect([b.wasDead, b.target, b.targetVisible, b.wasTargetVisible]).toEqual([true, -1, false, false]);
    expect([b.reactionReadyTick, b.estVx, b.bulletBlocked, b.hasLastKnown, b.fireHeld]).toEqual([
      0,
      0,
      false,
      false,
      false,
    ]);
  });
});

describe('sem fila indiana', () => {
  it('cada bot desvia 1,5–3 m para o lado dele, perpendicular à linha, no máximo metade da distância', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 8; i++) {
      const b = brain('normal', levelBot('normal'), i);
      b.lastKnownX = 0;
      b.lastKnownZ = 20;
      spreadFor(b, 0, 0);
      const mag = Math.hypot(b.spreadX, b.spreadZ);
      expect(mag).toBeGreaterThanOrEqual(AI_FEEL.spreadMinM - 1e-9);
      expect(mag).toBeLessThanOrEqual(AI_FEEL.spreadMaxM + 1e-9);
      // Perpendicular à linha bot → ponto (aqui o eixo z).
      expect(Math.abs(b.spreadZ)).toBeLessThan(1e-9);
      seen.add(b.spreadX.toFixed(2));
      expect(b.spreadForX).toBe(0);
      expect(b.spreadForZ).toBe(20);
    }
    expect(seen.size).toBe(8);
    const near = brain('normal', levelBot('normal'), 7);
    near.lastKnownX = 2;
    near.lastKnownZ = 0;
    spreadFor(near, 0, 0);
    expect(Math.hypot(near.spreadX, near.spreadZ)).toBeCloseTo(1, 9);
  });
});
