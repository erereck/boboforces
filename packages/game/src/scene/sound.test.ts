import { MAX_DISTANCE_M, type Mixer, type PlayOptions } from '@boboforces/audio';
import { builtinBotRef, MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import {
  createSim,
  ENTITY_FLAG,
  entityIndex,
  makeEntityId,
  NULL_ENTITY,
  WEAPON_CODE,
  type SimEvent,
  type SimMap,
  type SimView,
} from '@boboforces/sim';
import { createTestBlocks, createWorldGrid, fillBox, makeCell } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { SOUND_IDS, SOUND_RANK, SOUNDS } from '../sound-bank.ts';
import { heartGain, heartInterval, SOUND_FEEL } from './sound-feel.ts';
import { createMatchSound, createSynthJob, MATCH_SOUND } from './sound.ts';

/** M2, fase 7b: os sons da partida. */

interface Played {
  readonly sound: string;
  readonly volume: number;
  readonly priority: number;
  readonly x: number | undefined;
  readonly rate: number;
  readonly pan?: number;
  readonly range?: number;
  readonly noDuck?: true;
}

interface FakeMixer extends Mixer {
  played: Played[];
  synthesized: string[];
  stops: number;
  /** M12 (fase 4): os "ducks" pedidos (canal ou `music`, dB, volta, atraso ou segurar) e a largura do pan. */
  ducks: [string, number, number, number][];
  panWidth: number;
  /** M12 (fase 4): o laço de ambiente de cada vaga (o vento e os grilos). */
  ambient: (string | null)[];
}

function fakeMixer(): FakeMixer {
  const played: Played[] = [];
  const synthesized: string[] = [];
  const have = new Set<string>();
  const ducks: [string, number, number, number][] = [];
  const m: FakeMixer = {
    available: true,
    context: null,
    stats: { activeVoices: 0, peakVoices: 0, played: 0, stolen: 0, dropped: 0, unknown: 0 },
    played,
    synthesized,
    stops: 0,
    ducks,
    panWidth: 1,
    ambient: [null, null],
    decode: () => Promise.reject(new Error('sem MP3 no teste')),
    synthesize(name: string, pcm: Float32Array, sampleRate: number) {
      synthesized.push(name);
      have.add(name);
      return { name, durationS: pcm.length / sampleRate, sampleRate, channels: 1 };
    },
    has: (name: string) => have.has(name),
    setListener: () => {},
    setListenerCount: () => {},
    play(sound: string, o: PlayOptions) {
      played.push({
        sound,
        volume: o.volume ?? 1,
        priority: o.priority ?? 1,
        x: o.x,
        rate: o.rate ?? 1,
        ...(o.pan !== undefined && o.pan !== 0 ? { pan: o.pan } : {}),
        ...(o.range !== undefined && o.range !== MAX_DISTANCE_M ? { range: o.range } : {}),
        ...(o.noDuck === true ? { noDuck: true as const } : {}),
      });
      return 0;
    },
    stopAll() {
      m.stops++;
    },
    setBusVolume: () => {},
    setMono: () => {},
    suspend: () => Promise.resolve(),
    resume: () => Promise.resolve(),
    resetStats: () => {},
    crop: () => false,
    playMusic: () => false,
    stopMusic: () => {},
    music: null,
    duckMusic(db: number, releaseS: number, holdS = 0) {
      ducks.push(['music', db, releaseS, holdS]);
    },
    duckBus(bus: string, db: number, releaseS: number, delayS = 0) {
      ducks.push([bus, db, releaseS, delayS]);
    },
    setPanWidth(w: number) {
      m.panWidth = w;
    },
    leadingSilenceS: () => 0,
    setAmbient(slot: number, name: string | null) {
      m.ambient[slot] = name;
      return name === null || have.has(name);
    },
    setMusicLayer: () => false,
    dispose: () => {},
  };
  return m;
}

const blocks = createTestBlocks();
const concrete = makeCell(blocks.byKey('concrete')!.id);

/** Humano em (10, 30), bot a `botDz` m à frente (−z), do time `botTeam`; `wall` ergue uma parede no meio. */
function setup(
  opts: {
    botDz?: number;
    botTeam?: number;
    wall?: boolean;
    hitmarker?: boolean;
    countdownS?: number;
    humans?: number;
    reduce?: boolean;
    coop?: boolean;
    ambient?: { wind: boolean; night: boolean };
  } = {},
) {
  const { botDz = 10, botTeam = 1, wall = false, hitmarker = true, countdownS = 0, humans = 1 } = opts;
  const grid = createWorldGrid(40, 12, 120);
  fillBox(grid, 0, 0, 0, 39, 0, 119, concrete);
  if (wall) fillBox(grid, 0, 1, 50, 39, 10, 50, concrete);
  const map: SimMap = {
    grid,
    blocks,
    spawns: [
      { x: 10, y: 0.5, z: 30, yaw: 0, team: 0 },
      { x: 10, y: 0.5, z: 30 - botDz, yaw: Math.PI, team: botTeam },
    ],
  };
  const bot = [{ ref: builtinBotRef('normal'), count: 1 }];
  const recipe: MatchRecipe = {
    format: MATCH_RECIPE_FORMAT,
    mode: 'warfare.tdm',
    map: 'test',
    seed: 1,
    teams: botTeam === 0 ? [{ humans: 1, bots: bot }, { bots: [] }] : [{ humans: 1, bots: [] }, { bots: bot }],
  };
  const sim = createSim({ recipe, map, humans: 1, countdownS });
  const v = sim.view();
  const me = sim.controllerEntity(0);
  const botEntity = sim.controllerEntity(4);
  const mixer = fakeMixer();
  const sound = createMatchSound({
    mixer,
    humans,
    localEntity: (p) => (p === 0 ? me : NULL_ENTITY),
    hitmarker,
    ffa: false,
    reduceEffects: () => opts.reduce === true,
    ...(opts.coop === true ? { coop: true } : {}),
    ...(opts.ambient ? { ambient: opts.ambient } : {}),
  });
  // Ouvinte nos olhos do humano.
  sound.setListenerCount(1);
  sound.setListener(0, 10, 2, 30, 0);
  return { sim, v, me, bot: botEntity, mixer, sound };
}

const shot = (shooter: number, weapon: number, z: number, tick = 0): SimEvent => ({
  type: 'shot',
  tick,
  shooter,
  weapon,
  originX: 10,
  originY: 2,
  originZ: z,
  dirX: 0,
  dirY: 0,
  dirZ: 1,
  distance: 5,
});

const hit = (shooter: number, target: number, part: 'head' | 'torso', damage = 20, dirX = 0): SimEvent => ({
  type: 'hit',
  tick: 0,
  shooter,
  target,
  part,
  bodyPart: 0,
  damage,
  x: 10,
  y: 1.5,
  z: 20,
  dirX,
  dirY: 0,
  dirZ: dirX === 0 ? -1 : 0,
});

const kill = (killer: number, victim: number): SimEvent => ({
  type: 'kill',
  tick: 0,
  killer,
  victim,
  weapon: 0,
  headshot: false,
  bodyPart: 0,
  dirX: 0,
  dirY: 0,
  dirZ: 1,
  force: 1,
  assister: NULL_ENTITY,
});

const weaponEv = (entity: number, weapon: number, action: 'reloadStart' | 'reloadEnd' | 'switch'): SimEvent => ({
  type: 'weapon',
  tick: 0,
  entity,
  weapon,
  action,
});

/** O shotPitch/shotGain do tick e do atirador ficam nestas faixas (M12, fase 4). */
const inShotRange = (rate: number, base = 1): boolean => rate >= base * 0.96 - 1e-9 && rate <= base * 1.04 + 1e-9;

describe('sons da partida (fase 7b)', () => {
  it('o próprio tiro toca na cabeça (sem posição) e com a prioridade mais alta da partida', () => {
    const { v, me, mixer, sound } = setup();
    sound.event(shot(me, WEAPON_CODE.rifle, 30), v, 1);
    expect(mixer.played).toHaveLength(1);
    const p = mixer.played[0]!;
    expect(p).toMatchObject({ sound: 'tiro-fuzil', priority: SOUND_RANK.own, x: undefined });
    // M12 (fase 4): cada tiro com o tom 0,96–1,04 e o volume de −1 a 0 dB.
    expect(inShotRange(p.rate)).toBe(true);
    expect(p.volume).toBeLessThanOrEqual(SOUNDS['tiro-fuzil'].volume + 1e-9);
    expect(p.volume).toBeGreaterThanOrEqual(SOUNDS['tiro-fuzil'].volume * 10 ** (-1 / 20) - 1e-9);
  });

  it('tiro de inimigo: amostra de perto até 30 m, de longe depois; a LMG usa o som do fuzil, mais grave', () => {
    const near = setup({ botDz: 10 });
    near.sound.event(shot(near.bot, WEAPON_CODE.lmg, 20), near.v, 1);
    expect(near.mixer.played[0]).toMatchObject({ sound: 'tiro-fuzil', priority: SOUND_RANK.enemy, x: 10 });
    expect(inShotRange(near.mixer.played[0]!.rate, SOUND_FEEL.lmgPitch)).toBe(true);
    const far = setup({ botDz: 40 });
    far.sound.event(shot(far.bot, WEAPON_CODE.sniper, 30 - MATCH_SOUND.farM - 5), far.v, 1);
    expect(far.mixer.played[0]).toMatchObject({ sound: 'tiro-sniper-longe', range: MATCH_SOUND.farRangeM });
  });

  it('aliado tem prioridade abaixo do inimigo', () => {
    const { v, bot, mixer, sound } = setup({ botTeam: 0 });
    sound.event(shot(bot, WEAPON_CODE.pistol, 20), v, 1);
    expect(mixer.played[0]).toMatchObject({ sound: 'tiro-pistola', priority: SOUND_RANK.ally });
  });

  it('M12 (fase 4): atrás de parede, o tiro toca a amostra de longe a −3 dB; o que não tem amostra de longe, −6 dB', () => {
    const open = setup({ botDz: 25 });
    open.sound.event(shot(open.bot, WEAPON_CODE.smg, 5), open.v, 1);
    const walled = setup({ botDz: 25, wall: true });
    // A parede está em z = 25 m (célula 50); o tiro sai de z = 5 (a 25 m: perto, sem a parede).
    walled.sound.event(shot(walled.bot, WEAPON_CODE.smg, 5), walled.v, 1);
    expect(open.mixer.played[0]!.sound).toBe('tiro-smg');
    expect(walled.mixer.played[0]!.sound).toBe('tiro-smg-longe');
    expect(walled.mixer.played[0]!.volume).toBeCloseTo(open.mixer.played[0]!.volume * MATCH_SOUND.occludedFarGain, 6);
    // O impacto no bobo (sem amostra de longe): −6 dB.
    open.sound.event({ ...hit(open.me, open.bot, 'torso'), z: 5 } as SimEvent, open.v, 2);
    walled.sound.event({ ...hit(walled.me, walled.bot, 'torso'), z: 5 } as SimEvent, walled.v, 2);
    const bobo = (s: ReturnType<typeof setup>) => s.mixer.played.find((p) => p.sound === 'impacto-bobo')!.volume;
    expect(bobo(walled)).toBeCloseTo(bobo(open) * MATCH_SOUND.occludedGain, 6);
  });

  it('cooldown por som: 2 tiros de bot no mesmo instante viram 1; os seus tocam todos', () => {
    const { v, me, bot, mixer, sound } = setup();
    sound.event(shot(bot, WEAPON_CODE.smg, 20, 1), v, 1);
    sound.event(shot(bot, WEAPON_CODE.smg, 20, 2), v, 1.01);
    sound.event(shot(bot, WEAPON_CODE.smg, 20, 3), v, 1.1);
    expect(mixer.played.filter((p) => p.sound === 'tiro-smg')).toHaveLength(2);
    mixer.played.length = 0;
    sound.event(shot(me, WEAPON_CODE.smg, 30, 10), v, 2);
    sound.event(shot(me, WEAPON_CODE.smg, 30, 11), v, 2);
    expect(mixer.played.filter((p) => p.sound === 'tiro-smg')).toHaveLength(2);
  });

  it('M12 (fase 4): o seu tiro não cala o do inimigo com a mesma arma (o fuzil a 600 rpm, o dele 20 ms depois)', () => {
    const { v, me, bot, mixer, sound } = setup();
    for (let k = 0; k < 10; k++) {
      sound.event(shot(me, WEAPON_CODE.rifle, 30, k * 6), v, k * 0.1);
      sound.event(shot(bot, WEAPON_CODE.rifle, 20, k * 6 + 1), v, k * 0.1 + 0.02);
    }
    expect(mixer.played.filter((p) => p.sound === 'tiro-fuzil' && p.x === undefined)).toHaveLength(10);
    expect(mixer.played.filter((p) => p.sound === 'tiro-fuzil' && p.x !== undefined)).toHaveLength(10);
  });

  it('M12 (fase 4): os chumbos da escopeta (um `shot` por chumbo) viram um tiro só, o seu também', () => {
    const { v, me, mixer, sound } = setup();
    for (let k = 0; k < 8; k++) sound.event(shot(me, WEAPON_CODE.shotgun, 30, 5), v, 1);
    expect(mixer.played.filter((p) => p.sound === 'tiro-escopeta')).toHaveLength(1);
  });

  it('M12 (fase 4): cada tiro sai com um tom diferente, e cada impacto também (pela célula)', () => {
    const { v, bot, mixer, sound } = setup();
    for (let k = 0; k < 6; k++) sound.event(shot(bot, WEAPON_CODE.rifle, 20, k * 10), v, k);
    const rates = new Set(mixer.played.map((p) => p.rate.toFixed(4)));
    expect(rates.size).toBe(6);
    for (const p of mixer.played) expect(inShotRange(p.rate)).toBe(true);
    mixer.played.length = 0;
    for (let c = 0; c < 6; c++)
      sound.event(
        {
          type: 'impact',
          tick: 0,
          x: 10,
          y: 0.5,
          z: 25,
          normalX: 0,
          normalY: 1,
          normalZ: 0,
          cellX: 20 + c,
          cellY: 0,
          cellZ: 50,
          block: blocks.byKey('concrete')!.id,
          face: 2,
          prop: -1,
        },
        v,
        10 + c,
      );
    const impacts = mixer.played.map((p) => p.rate);
    expect(new Set(impacts.map((r) => r.toFixed(4))).size).toBe(6);
    for (const r of impacts) {
      expect(r).toBeGreaterThanOrEqual(0.92 - 1e-9);
      expect(r).toBeLessThanOrEqual(1.08 + 1e-9);
    }
  });

  it('M10 (fase 8): o ricochete toca o "piiiu" no ponto do quique; os chumbos do mesmo tiro viram um só', () => {
    const { v, me, bot, mixer, sound } = setup();
    const ricochet = (shooter: number, tick: number, x: number): SimEvent => ({
      type: 'ricochet',
      tick,
      shooter,
      weapon: WEAPON_CODE.shotgun,
      x,
      y: 1,
      z: 22,
      dirX: 0,
      dirY: 0,
      dirZ: 1,
      distance: 6,
    });
    sound.event(ricochet(bot, 10, 12), v, 1);
    expect(mixer.played).toEqual([expect.objectContaining({ sound: 'ricochete', priority: SOUND_RANK.enemy, x: 12 })]);
    const rate = mixer.played[0]!.rate;
    expect(rate).toBeGreaterThanOrEqual(0.88);
    expect(rate).toBeLessThanOrEqual(1.12);
    // A mesma bala no mesmo tick (os chumbos de um tiro só): um som só.
    mixer.played.length = 0;
    sound.event(ricochet(bot, 10, 12), v, 2);
    expect(mixer.played).toHaveLength(0);
    // 8 chumbos da sua escopeta quicando no mesmo instante: um "piiiu" só, no mundo (com posição), não na cabeça.
    for (let k = 0; k < 8; k++) sound.event(ricochet(me, 20, 8 + k), v, 3);
    expect(mixer.played.map((p) => [p.sound, p.priority, p.x])).toEqual([['ricochete', SOUND_RANK.own, 8]]);
    // M10 (fase 8, revisão): o ricochete de um bot logo antes não engole o seu (o seu não espera o cooldown).
    mixer.played.length = 0;
    sound.event(ricochet(bot, 30, 12), v, 4);
    sound.event(ricochet(me, 30, 9), v, 4.01);
    expect(mixer.played.map((p) => p.x)).toEqual([12, 9]);
  });

  it('retorno: plic no corpo, PLOC na cabeça, dano em você; a regra sem hitmarker cala o plic', () => {
    const { v, me, bot, mixer, sound } = setup();
    sound.event(hit(me, bot, 'torso'), v, 1);
    sound.event(hit(me, bot, 'head'), v, 2);
    sound.event(hit(bot, me, 'torso'), v, 3);
    expect(mixer.played.map((p) => p.sound)).toEqual(['hitmarker', 'impacto-bobo', 'ploc', 'impacto-bobo', 'dano']);
    const quiet = setup({ hitmarker: false });
    quiet.sound.event(hit(quiet.me, quiet.bot, 'head'), quiet.v, 1);
    expect(quiet.mixer.played.map((p) => p.sound)).toEqual(['impacto-bobo']);
  });

  it('M12 (fase 4): sem plic nem dano no acerto de dano zero (a proteção de nascimento)', () => {
    const { v, me, bot, mixer, sound } = setup();
    sound.event(hit(me, bot, 'torso', 0), v, 1);
    sound.event(hit(bot, me, 'torso', 0), v, 2);
    expect(mixer.played.map((p) => p.sound)).toEqual(['impacto-bobo']);
  });

  it('M12 (fase 4): o plic sobe 3% a cada acerto seguido (até +15%) e volta depois de uma pausa', () => {
    const { v, me, bot, mixer, sound } = setup();
    for (let k = 0; k < 8; k++) sound.event(hit(me, bot, 'torso'), v, 1 + k * 0.1);
    sound.event(hit(me, bot, 'torso'), v, 3);
    const rates = mixer.played.filter((p) => p.sound === 'hitmarker').map((p) => Number(p.rate.toFixed(3)));
    expect(rates).toEqual([1, 1.03, 1.06, 1.09, 1.12, 1.15, 1.15, 1.15, 1]);
  });

  it('M12 (fase 4): o cooldown vale no retorno: o dano da Big Brrt (20/s) não empilha', () => {
    const { v, me, bot, mixer, sound } = setup();
    for (let k = 0; k < 20; k++) sound.event(hit(bot, me, 'torso'), v, 1 + k * 0.05);
    const n = mixer.played.filter((p) => p.sound === 'dano').length;
    expect(n).toBeLessThanOrEqual(Math.ceil(1 / SOUNDS.dano.cooldownS));
    expect(n).toBeGreaterThanOrEqual(5);
  });

  it('M12 (fase 4): o dano vem do lado do tiro (com 1 jogador); na tela dividida, no centro', () => {
    const { v, me, bot, mixer, sound } = setup();
    // O tiro anda para +x: veio da esquerda (o ouvinte olha para −z).
    sound.event(hit(bot, me, 'torso', 20, 1), v, 1);
    const pan = mixer.played.find((p) => p.sound === 'dano')!.pan!;
    expect(pan).toBeCloseTo(-SOUND_FEEL.hurtPanWidth, 6);
    const two = setup({ humans: 2 });
    two.sound.event(hit(two.bot, two.me, 'torso', 20, 1), two.v, 1);
    expect(two.mixer.played.find((p) => p.sound === 'dano')!.pan).toBeUndefined();
  });

  it('abate e morte', () => {
    const { v, me, bot, mixer, sound } = setup();
    sound.event(kill(me, bot), v, 1);
    sound.event(kill(bot, me), v, 2);
    expect(mixer.played.map((p) => p.sound)).toEqual(['abate', 'morte']);
  });

  it('M12 (fase 4): o abate sobe de tom a cada abate em 4 s (1; 1,06; 1,12; 1,19) e volta depois', () => {
    const { v, me, bot, mixer, sound } = setup();
    for (let k = 0; k < 5; k++) sound.event(kill(me, bot), v, 1 + k);
    sound.event(kill(me, bot), v, 12);
    expect(mixer.played.map((p) => p.rate)).toEqual([1, 1.06, 1.12, 1.19, 1.19, 1]);
  });

  it('M12 (fase 4): na morte o mundo abafa 10 dB por 1,5 s (só com 1 jogador e sem Reduzir efeitos)', () => {
    const one = setup();
    one.sound.event(kill(one.bot, one.me), one.v, 1);
    expect(one.mixer.ducks).toEqual([['sfx', MATCH_SOUND.deathDuckDb, MATCH_SOUND.deathDuckS, 0]]);
    // Revisão: o som da morte por cima do abafado.
    expect(one.mixer.played.find((p) => p.sound === 'morte')!.noDuck).toBe(true);
    const reduce = setup({ reduce: true });
    reduce.sound.event(kill(reduce.bot, reduce.me), reduce.v, 1);
    expect(reduce.mixer.ducks).toEqual([]);
    const two = setup({ humans: 2 });
    two.sound.event(kill(two.bot, two.me), two.v, 1);
    expect(two.mixer.ducks).toEqual([]);
  });

  it('M12 (fase 4): a explosão colada abafa o mundo 8 dB e zune; longe, só abaixa a música', () => {
    const blast = (x: number, z: number): SimEvent => ({
      type: 'explosion',
      tick: 0,
      owner: NULL_ENTITY,
      weapon: WEAPON_CODE.rocket,
      x,
      y: 1,
      z,
      radius: 4,
    });
    const near = setup();
    near.sound.event(blast(11, 31), near.v, 1);
    expect(near.mixer.ducks.map((d) => d[0])).toEqual(['music', 'sfx']);
    expect(near.mixer.played.map((p) => [p.sound, p.noDuck])).toEqual([
      ['explosao', undefined],
      ['zumbido', true],
    ]);
    const far = setup();
    far.sound.event(blast(10, 15), far.v, 1);
    expect(far.mixer.ducks.map((d) => d[0])).toEqual(['music']);
    expect(far.mixer.played.map((p) => p.sound)).toEqual(['explosao']);
  });

  it('impacto de bala pelo material do bloco', () => {
    const { v, mixer, sound } = setup();
    sound.event(
      {
        type: 'impact',
        tick: 0,
        x: 10,
        y: 0.5,
        z: 25,
        normalX: 0,
        normalY: 1,
        normalZ: 0,
        cellX: 20,
        cellY: 0,
        cellZ: 50,
        block: blocks.byKey('concrete')!.id,
        face: 2,
        prop: -1,
      },
      v,
      1,
    );
    expect(mixer.played[0]!.sound).toBe('impacto-concreto');
  });

  /** O bot anda a 4 m/s por `seconds` (correndo com `sprint`, agachado com `crouch`); devolve os passos tocados. */
  const run = (s: ReturnType<typeof setup>, seconds: number, crouch = false, sprint = false): Played[] => {
    const b = entityIndex(s.bot);
    const vel = s.v.velocity as Float64Array;
    const flags = s.v.flags as Uint32Array;
    for (let t = 0; t < seconds * 60; t++) {
      vel[b * 3] = 4;
      vel[b * 3 + 2] = 0;
      flags[b] = (flags[b]! | ENTITY_FLAG.onGround) & ~ENTITY_FLAG.sprinting;
      if (crouch) flags[b] = flags[b]! | ENTITY_FLAG.crouching;
      if (sprint) flags[b] = flags[b]! | ENTITY_FLAG.sprinting;
      s.sound.frame(s.v, 1 / 60, t / 60);
    }
    return s.mixer.played.filter((p) => p.sound.startsWith('passo-'));
  };

  it('passos: no compasso da passada, só dos bots perto; agachado pisa leve', () => {
    const near = setup({ botDz: 10 });
    // 4 m/s por 3 s = 12 m; passada de 1,7 m, a 1ª depois de meia passada: 7 passos.
    const steps = run(near, 3);
    // Os passos do bot à frente também marcam o indicador (na frente: ângulo ~0).
    const angles = new Float32Array(8);
    const alphas = new Float32Array(8);
    expect(near.sound.fillIndicator(0, angles, alphas)).toBeGreaterThan(0);
    expect(Math.abs(angles[0]!)).toBeLessThan(0.5);
    expect(steps).toHaveLength(7);
    expect(new Set(steps.map((p) => p.sound))).toEqual(new Set(['passo-concreto-1', 'passo-concreto-2']));
    // M12 (fase 4): o passo ímpar um pouco mais grave.
    for (const p of steps) expect(p.rate).toBeGreaterThanOrEqual(0.93 * MATCH_SOUND.oddStepPitch - 1e-9);
    const crouched = run(setup({ botDz: 10 }), 3, true);
    expect(crouched[0]!.volume).toBeCloseTo(steps[0]!.volume * MATCH_SOUND.crouchGain, 6);
    expect(run(setup({ botDz: MATCH_SOUND.stepRangeM + 5 }), 3)).toHaveLength(0);
  });

  it('M12 (fase 4): correndo pisa mais forte que andando; cada passo varia ±10% de volume', () => {
    const walk = run(setup({ botDz: 10 }), 3);
    const sprint = run(setup({ botDz: 10 }), 3, false, true);
    expect(sprint[0]!.volume / walk[0]!.volume).toBeCloseTo(MATCH_SOUND.sprintStepGain / MATCH_SOUND.walkStepGain, 6);
    const vols = new Set(walk.map((p) => p.volume.toFixed(4)));
    expect(vols.size).toBeGreaterThan(3);
    const base = SOUNDS['passo-concreto-1'].volume * MATCH_SOUND.walkStepGain;
    for (const p of walk) {
      expect(p.volume).toBeGreaterThanOrEqual(base * 0.9 * 0.5);
      expect(p.volume).toBeLessThanOrEqual(base * 1.1 + 1e-9);
    }
  });

  it('M12 (fase 4): o pouso pisa no material do chão também', () => {
    const { v, bot, mixer, sound } = setup();
    sound.event({ type: 'move', tick: 0, entity: bot, move: 'land', speed: 8 }, v, 1);
    expect(mixer.played.map((p) => p.sound)).toEqual(['pouso', expect.stringMatching(/^passo-concreto/)]);
  });

  it('a contagem bipa 3, 2, 1 e o "vai"', () => {
    const { sim, mixer, sound } = setup({ countdownS: 3 });
    const inputs = [null, null, null, null, null];
    let t = 0;
    while (sim.view().match.phase === 'warmup' && t < 600) {
      sim.step(inputs);
      sound.frame(sim.view(), 1 / 60, t++ / 60);
    }
    sound.frame(sim.view(), 1 / 60, t / 60);
    expect(mixer.played.map((p) => p.sound)).toEqual([
      'contagem-bipe',
      'contagem-bipe',
      'contagem-bipe',
      'contagem-vai',
    ]);
  });

  it('vida baixa: o coração bate no compasso, e para quando a vida volta', () => {
    const { sim, me, mixer, sound } = setup();
    const inputs = [null, null, null, null, null];
    for (let t = 0; t < 400 && sim.view().match.phase === 'warmup'; t++) sim.step(inputs);
    const v: SimView = sim.view();
    const health = v.health as Float32Array;
    health[entityIndex(me)] = 20;
    for (let t = 0; t < 120; t++) sound.frame(v, 1 / 60, 10 + t / 60);
    const beats = mixer.played.filter((p) => p.sound === 'coracao');
    expect(beats.length).toBe(Math.ceil(2 / heartInterval(20, 100)));
    expect(beats[0]!.volume).toBeCloseTo(SOUNDS.coracao.volume * heartGain(20, 100), 6);
    health[entityIndex(me)] = 100;
    for (let t = 0; t < 120; t++) sound.frame(v, 1 / 60, 20 + t / 60);
    expect(mixer.played.filter((p) => p.sound === 'coracao').length).toBe(beats.length);
    // M12 (fase 4): com 30% (o limite da vinheta da HUD) já bate; com 31%, não.
    mixer.played.length = 0;
    health[entityIndex(me)] = 31;
    for (let t = 0; t < 60; t++) sound.frame(v, 1 / 60, 30 + t / 60);
    expect(mixer.played.filter((p) => p.sound === 'coracao')).toHaveLength(0);
    health[entityIndex(me)] = 30;
    for (let t = 0; t < 60; t++) sound.frame(v, 1 / 60, 40 + t / 60);
    expect(mixer.played.filter((p) => p.sound === 'coracao')).toHaveLength(1);
  });

  /** Anda o relógio da sim na vista (o foley em tempos conta em ticks). */
  const setTick = (v: SimView, tick: number): void => {
    (v as { tick: number }).tick = tick;
  };

  it('M12 (fase 4): o ferrolho da sniper sai 0,3 s depois do tiro (em ticks da sim), no bot (perto)', () => {
    const { v, bot, mixer, sound } = setup();
    setTick(v, 5);
    sound.frame(v, 1 / 60, 0);
    sound.event(shot(bot, WEAPON_CODE.sniper, 20, 5), v, 1);
    for (let t = 1; t < 18; t++) {
      setTick(v, 5 + t);
      sound.frame(v, 1 / 60, 1 + t / 60);
    }
    expect(mixer.played.map((p) => p.sound)).toEqual(['tiro-sniper']);
    setTick(v, 5 + 18);
    // O relógio de parede não conta (o Aquário acelerado, a câmera lenta): só o tick.
    sound.frame(v, 1 / 60, 1.01);
    expect(mixer.played.map((p) => p.sound)).toEqual(['tiro-sniper', 'ferrolho']);
    expect(mixer.played[1]!.x).toBe(10);
  });

  it('M12 (fase 4): a recarga longa (a LMG, 4,5 s) ganha a tampa e a fita no meio; trocar de arma cancela', () => {
    const { v, me, mixer, sound } = setup();
    const i = entityIndex(me);
    const flags = v.flags as Uint32Array;
    const weapon = v.weapon as Uint8Array;
    weapon[i] = WEAPON_CODE.lmg;
    flags[i] = flags[i]! | ENTITY_FLAG.reloading;
    setTick(v, 0);
    sound.event(weaponEv(me, WEAPON_CODE.lmg, 'reloadStart'), v, 1);
    for (let t = 1; t <= 4.4 * 60; t++) {
      setTick(v, t);
      sound.frame(v, 1 / 60, 1 + t / 60);
    }
    expect(mixer.played.map((p) => p.sound)).toEqual(['recarga-tira', 'troca-arma', 'recarga-tira']);
    // O tom da LMG (0,88) em todos.
    expect(mixer.played[0]!.rate).toBeCloseTo(0.88, 6);
    mixer.played.length = 0;
    setTick(v, 0);
    sound.event(weaponEv(me, WEAPON_CODE.lmg, 'reloadStart'), v, 10);
    sound.event(weaponEv(me, WEAPON_CODE.lmg, 'switch'), v, 10.1);
    for (let t = 1; t <= 4.4 * 60; t++) {
      setTick(v, t);
      sound.frame(v, 1 / 60, 10 + t / 60);
    }
    expect(mixer.played.map((p) => p.sound)).toEqual(['recarga-tira', 'troca-arma']);
  });

  it('M12 (fase 4): o cartucho da escopeta: um som a cada cartucho que entra recarregando', () => {
    const { v, me, mixer, sound } = setup();
    const i = entityIndex(me);
    const flags = v.flags as Uint32Array;
    const weapon = v.weapon as Uint8Array;
    const clip = v.slotClip as Uint16Array;
    const k = i * 4 + v.slot[i]!;
    weapon[i] = WEAPON_CODE.shotgun;
    clip[k] = 2;
    flags[i] = flags[i]! | ENTITY_FLAG.reloading;
    sound.frame(v, 1 / 60, 0);
    for (let n = 3; n <= 5; n++) {
      clip[k] = n;
      sound.frame(v, 1 / 60, n);
    }
    expect(mixer.played.map((p) => p.sound)).toEqual(['recarga-poe', 'recarga-poe', 'recarga-poe']);
    expect(mixer.played[0]!.rate).toBeCloseTo(0.88 * 1.3, 6);
  });

  it('M12 (fase 4): o zunido da bala do inimigo que passa perto da cabeça (não o seu, nem o do aliado, nem o que acerta)', () => {
    const { v, me, bot, mixer, sound } = setup();
    const by = (shooter: number, x: number, distance: number, tick: number): SimEvent =>
      ({ ...shot(shooter, WEAPON_CODE.rifle, 15, tick), originX: x, distance }) as SimEvent;
    // A cabeça do humano está em (10; 2; 30): a bala passa a 0,8 m.
    sound.event(by(bot, 10.8, 40, 1), v, 1);
    expect(mixer.played.map((p) => p.sound)).toEqual(['tiro-fuzil', 'zunido']);
    expect(mixer.played[1]!.x).toBeCloseTo(10.8, 6);
    mixer.played.length = 0;
    // A 2 m: não zune; parando em você (o acerto): não zune; o seu tiro: não zune.
    sound.event(by(bot, 12, 40, 2), v, 2);
    sound.event(by(bot, 10.3, 15.2, 3), v, 3);
    sound.event(by(me, 10.8, 40, 4), v, 4);
    expect(mixer.played.filter((p) => p.sound === 'zunido')).toHaveLength(0);
    // Revisão: a bala do aliado não zune.
    const ally = setup({ botTeam: 0 });
    ally.sound.event(by(ally.bot, 10.8, 40, 1), ally.v, 1);
    expect(ally.mixer.played.map((p) => p.sound)).toEqual(['tiro-fuzil']);
  });

  it('M12 (fase 4): o tique do pente nas 3 últimas balas, o tom subindo até a última', () => {
    const { v, me, mixer, sound } = setup();
    const i = entityIndex(me);
    const clip = v.slotClip as Uint16Array;
    const k = i * 4 + v.slot[i]!;
    (v.weapon as Uint8Array)[i] = WEAPON_CODE.rifle;
    for (let n = 4; n >= 0; n--) {
      clip[k] = n;
      sound.event(shot(me, WEAPON_CODE.rifle, 30, 10 - n), v, 10 - n);
    }
    const ticks = mixer.played.filter((p) => p.sound === 'tique').map((p) => Number(p.rate.toFixed(3)));
    expect(ticks).toEqual([1, 1.12, 1.24]);
  });

  it('M12 (fase 4): o seu tiro que zera o colete do alvo toca o colete quebrando (se foi o último acerto do tick)', () => {
    const { v, me, bot, mixer, sound } = setup();
    const b = entityIndex(bot);
    const armor = v.armor as Uint8Array;
    const glass = (): Played[] => mixer.played.filter((p) => p.sound === 'impacto-vidro');
    armor[b] = 30;
    sound.frame(v, 1 / 60, 0);
    sound.event(hit(me, bot, 'torso'), v, 1);
    sound.frame(v, 1 / 60, 1);
    expect(glass()).toHaveLength(0);
    armor[b] = 0;
    sound.event(hit(me, bot, 'torso'), v, 2);
    sound.frame(v, 1 / 60, 2);
    expect(glass().map((p) => [p.x, p.rate])).toEqual([[undefined, 0.75]]);
    // Já quebrado: não repete.
    sound.event(hit(me, bot, 'torso'), v, 3);
    sound.frame(v, 1 / 60, 3);
    expect(glass()).toHaveLength(1);
    // Revisão: outro acertando depois de você no mesmo tick quebrou o colete; antes de você, foi você.
    const other = makeEntityId(9, 1);
    for (const [first, last, heard] of [
      [me, other, 1],
      [other, me, 2],
    ] as const) {
      armor[b] = 30;
      sound.frame(v, 1 / 60, 4);
      armor[b] = 0;
      sound.event(hit(first, bot, 'torso'), v, 5);
      sound.event(hit(last, bot, 'torso'), v, 5);
      sound.frame(v, 1 / 60, 5);
      expect(glass()).toHaveLength(heard);
    }
  });

  it('M12 (fase 4): as vinhetas de fim (o empate também) abaixam a música 8 dB durante 3 s', () => {
    const { v, mixer, sound } = setup();
    const match = v.match as { winnerTeam: number };
    match.winnerTeam = -1;
    sound.event({ type: 'matchPhase', tick: 0, phase: 'ended' }, v, 1);
    match.winnerTeam = 0;
    sound.event({ type: 'matchPhase', tick: 0, phase: 'ended' }, v, 3);
    match.winnerTeam = 1;
    sound.event({ type: 'matchPhase', tick: 0, phase: 'ended' }, v, 5);
    expect(mixer.played.map((p) => p.sound)).toEqual(['empate', 'vitoria', 'derrota']);
    expect(mixer.ducks[0]).toEqual(['music', MATCH_SOUND.jingleDuckDb, MATCH_SOUND.duckS, MATCH_SOUND.jingleS]);
  });

  it('M12 (fase 4, revisão): no Bobo Zombies, o fim sem vencedor (o time caiu) é a derrota', () => {
    const { v, mixer, sound } = setup({ coop: true });
    const match = v.match as { winnerTeam: number };
    match.winnerTeam = -1;
    sound.event({ type: 'matchPhase', tick: 0, phase: 'ended' }, v, 1);
    match.winnerTeam = 0;
    sound.event({ type: 'matchPhase', tick: 0, phase: 'ended' }, v, 3);
    expect(mixer.played.map((p) => p.sound)).toEqual(['derrota', 'vitoria']);
  });

  it('M12 (fase 4, revisão): o tiro além de 60 m (até 150 m) toca a amostra de longe e cede a voz a tudo', () => {
    const { v, bot, mixer, sound } = setup();
    // A 80 m do ouvinte, fora da grade.
    sound.event(shot(bot, WEAPON_CODE.rifle, -50, 1), v, 1);
    expect(mixer.played).toEqual([
      expect.objectContaining({ sound: 'tiro-fuzil-longe', priority: SOUND_RANK.world, range: MATCH_SOUND.farRangeM }),
    ]);
    mixer.played.length = 0;
    sound.event(shot(bot, WEAPON_CODE.rifle, -130, 2), v, 2);
    expect(mixer.played).toHaveLength(0);
  });

  it('M12 (fase 4): com 3 ou 4 vistas no sofá, o pan cai para 50%', () => {
    const { mixer, sound } = setup();
    sound.setListenerCount(3);
    expect(mixer.panWidth).toBe(MATCH_SOUND.crowdPanWidth);
    sound.setListenerCount(2);
    expect(mixer.panWidth).toBe(1);
  });

  it('indicador visual: tiro de inimigo à esquerda até 20 m vira um ponto à esquerda que some; o seu não', () => {
    const { v, me, bot, sound } = setup({ botDz: 10 });
    const angles = new Float32Array(8);
    const alphas = new Float32Array(8);
    // Ouvinte olhando para −z (yaw 0); tiro em x = 0 (10 m à esquerda).
    sound.event({ ...shot(bot, WEAPON_CODE.rifle, 30), originX: 0 } as SimEvent, v, 1);
    sound.event(shot(me, WEAPON_CODE.rifle, 30), v, 1);
    expect(sound.fillIndicator(0, angles, alphas)).toBe(1);
    expect(angles[0]).toBeCloseTo(Math.PI / 2, 2);
    expect(alphas[0]).toBeCloseTo(1, 6);
    sound.frame(v, MATCH_SOUND.indicatorLifeS / 2, 1.4);
    expect(sound.fillIndicator(0, angles, alphas)).toBe(1);
    expect(alphas[0]).toBeCloseTo(0.5, 2);
    sound.frame(v, MATCH_SOUND.indicatorLifeS, 2.2);
    expect(sound.fillIndicator(0, angles, alphas)).toBe(0);
    // Longe demais: toca, mas não marca.
    const far = setup({ botDz: MATCH_SOUND.indicatorRangeM + 5 });
    far.sound.event(shot(far.bot, WEAPON_CODE.rifle, 30 - MATCH_SOUND.indicatorRangeM - 5), far.v, 1);
    expect(far.sound.fillIndicator(0, angles, alphas)).toBe(0);
  });

  it('M12 (fase 4): o ambiente do mapa: o vento (e os grilos à noite) em laço; a pausa corta e a volta retoma', () => {
    const night = setup({ ambient: { wind: true, night: true } });
    night.mixer.synthesize('vento', new Float32Array(8), 44100);
    night.mixer.synthesize('grilos', new Float32Array(8), 44100);
    night.sound.frame(night.v, 1 / 60, 0);
    expect(night.mixer.ambient).toEqual(['vento', 'grilos']);
    night.sound.silence();
    expect(night.mixer.ambient).toEqual([null, null]);
    night.sound.frame(night.v, 1 / 60, 1);
    expect(night.mixer.ambient).toEqual(['vento', 'grilos']);
    // A Lua de dia: nada.
    const moon = setup({ ambient: { wind: false, night: false } });
    moon.mixer.synthesize('vento', new Float32Array(8), 44100);
    moon.sound.frame(moon.v, 1 / 60, 0);
    expect(moon.mixer.ambient).toEqual([null, null]);
  });

  it('pausa e fim cortam o que está tocando', () => {
    const { mixer, sound } = setup();
    sound.silence();
    sound.dispose();
    expect(mixer.stops).toBe(2);
  });
});

// Sintetiza os 53 sons de verdade: rápido sozinho, mas passa dos 5 s padrão com a suíte inteira em paralelo.
describe('síntese fatiada do loading', { timeout: 30_000 }, () => {
  it('um som por passo com orçamento zero; o mixer guarda e a 2ª partida não refaz', () => {
    const mixer = fakeMixer();
    const job = createSynthJob(mixer, () => {});
    const synth = SOUND_IDS.filter((id) => SOUNDS[id].src === 'synth');
    let steps = 0;
    while (!job.done) {
      job.step(0, () => 1);
      steps++;
    }
    expect(steps).toBe(synth.length);
    expect(mixer.synthesized).toEqual(synth);
    expect(createSynthJob(mixer, () => {}).done).toBe(true);
  });
});
