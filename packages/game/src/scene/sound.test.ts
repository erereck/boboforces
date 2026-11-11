import type { Mixer, PlayOptions } from '@boboforces/audio';
import { builtinBotRef, MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import {
  createSim,
  ENTITY_FLAG,
  entityIndex,
  NULL_ENTITY,
  WEAPON_CODE,
  type SimEvent,
  type SimMap,
  type SimView,
} from '@boboforces/sim';
import { createTestBlocks, createWorldGrid, fillBox, makeCell } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { SOUND_IDS, SOUND_RANK, SOUNDS } from '../sound-bank.ts';
import { createMatchSound, createSynthJob, MATCH_SOUND } from './sound.ts';

/** M2, fase 7b: os sons da partida. */

interface Played {
  readonly sound: string;
  readonly volume: number;
  readonly priority: number;
  readonly x: number | undefined;
  readonly rate: number;
}

function fakeMixer(): Mixer & { played: Played[]; synthesized: string[]; stops: number } {
  const played: Played[] = [];
  const synthesized: string[] = [];
  const have = new Set<string>();
  const m = {
    available: true,
    context: null,
    stats: { activeVoices: 0, peakVoices: 0, played: 0, stolen: 0, dropped: 0, unknown: 0 },
    played,
    synthesized,
    stops: 0,
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
      played.push({ sound, volume: o.volume ?? 1, priority: o.priority ?? 1, x: o.x, rate: o.rate ?? 1 });
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
    duckMusic: () => {},
    setMusicLayer: () => false,
    dispose: () => {},
  };
  return m;
}

const blocks = createTestBlocks();
const concrete = makeCell(blocks.byKey('concrete')!.id);

/** Humano em (10, 30), bot a `botDz` m à frente (−z), do time `botTeam`; `wall` ergue uma parede no meio. */
function setup(
  opts: { botDz?: number; botTeam?: number; wall?: boolean; hitmarker?: boolean; countdownS?: number } = {},
) {
  const { botDz = 10, botTeam = 1, wall = false, hitmarker = true, countdownS = 0 } = opts;
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
    humans: 1,
    localEntity: (p) => (p === 0 ? me : NULL_ENTITY),
    hitmarker,
    ffa: false,
  });
  // Ouvinte nos olhos do humano.
  sound.setListenerCount(1);
  sound.setListener(0, 10, 2, 30, 0);
  return { sim, v, me, bot: botEntity, mixer, sound };
}

const shot = (shooter: number, weapon: number, z: number): SimEvent => ({
  type: 'shot',
  tick: 0,
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

const hit = (shooter: number, target: number, part: 'head' | 'torso'): SimEvent => ({
  type: 'hit',
  tick: 0,
  shooter,
  target,
  part,
  bodyPart: 0,
  damage: 20,
  x: 10,
  y: 1.5,
  z: 20,
  dirX: 0,
  dirY: 0,
  dirZ: -1,
});

describe('sons da partida (fase 7b)', () => {
  it('o próprio tiro toca na cabeça (sem posição) e com a prioridade mais alta da partida', () => {
    const { v, me, mixer, sound } = setup();
    sound.event(shot(me, WEAPON_CODE.rifle, 30), v, 1);
    expect(mixer.played).toEqual([
      { sound: 'tiro-fuzil', volume: SOUNDS['tiro-fuzil'].volume, priority: SOUND_RANK.own, x: undefined, rate: 1 },
    ]);
  });

  it('tiro de inimigo: amostra de perto até 30 m, de longe depois; a LMG usa o som do fuzil', () => {
    const near = setup({ botDz: 10 });
    near.sound.event(shot(near.bot, WEAPON_CODE.lmg, 20), near.v, 1);
    expect(near.mixer.played[0]).toMatchObject({ sound: 'tiro-fuzil', priority: SOUND_RANK.enemy, x: 10 });
    const far = setup({ botDz: 40 });
    far.sound.event(shot(far.bot, WEAPON_CODE.sniper, 30 - MATCH_SOUND.farM - 5), far.v, 1);
    expect(far.mixer.played[0]!.sound).toBe('tiro-sniper-longe');
  });

  it('aliado tem prioridade abaixo do inimigo', () => {
    const { v, bot, mixer, sound } = setup({ botTeam: 0 });
    sound.event(shot(bot, WEAPON_CODE.pistol, 20), v, 1);
    expect(mixer.played[0]).toMatchObject({ sound: 'tiro-pistola', priority: SOUND_RANK.ally });
  });

  it('atrás de parede, −6 dB', () => {
    const open = setup({ botDz: 25 });
    open.sound.event(shot(open.bot, WEAPON_CODE.smg, 5), open.v, 1);
    const walled = setup({ botDz: 25, wall: true });
    // A parede está em z = 25 m (célula 50); o tiro sai de z = 5.
    walled.sound.event(shot(walled.bot, WEAPON_CODE.smg, 5), walled.v, 1);
    expect(walled.mixer.played[0]!.volume).toBeCloseTo(open.mixer.played[0]!.volume * MATCH_SOUND.occludedGain, 6);
  });

  it('cooldown por som: 2 tiros de bot no mesmo instante viram 1; os seus tocam todos', () => {
    const { v, me, bot, mixer, sound } = setup();
    sound.event(shot(bot, WEAPON_CODE.smg, 20), v, 1);
    sound.event(shot(bot, WEAPON_CODE.smg, 20), v, 1.01);
    sound.event(shot(bot, WEAPON_CODE.smg, 20), v, 1.1);
    expect(mixer.played.filter((p) => p.sound === 'tiro-smg')).toHaveLength(2);
    mixer.played.length = 0;
    sound.event(shot(me, WEAPON_CODE.smg, 30), v, 2);
    sound.event(shot(me, WEAPON_CODE.smg, 30), v, 2);
    expect(mixer.played).toHaveLength(2);
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

  it('abate e morte', () => {
    const { v, me, bot, mixer, sound } = setup();
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
    sound.event(kill(me, bot), v, 1);
    sound.event(kill(bot, me), v, 2);
    expect(mixer.played.map((p) => p.sound)).toEqual(['abate', 'morte']);
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

  it('passos: no compasso da passada, só dos bots perto; agachado pisa leve', () => {
    const near = setup({ botDz: 10 });
    const run = (s: ReturnType<typeof setup>, seconds: number, crouch = false): Played[] => {
      const b = entityIndex(s.bot);
      const vel = s.v.velocity as Float64Array;
      const flags = s.v.flags as Uint32Array;
      for (let t = 0; t < seconds * 60; t++) {
        vel[b * 3] = 4;
        vel[b * 3 + 2] = 0;
        flags[b] = (flags[b]! | ENTITY_FLAG.onGround) & ~ENTITY_FLAG.sprinting;
        if (crouch) flags[b] = flags[b]! | ENTITY_FLAG.crouching;
        s.sound.frame(s.v, 1 / 60, t / 60);
      }
      return s.mixer.played.filter((p) => p.sound.startsWith('passo-'));
    };
    // 4 m/s por 3 s = 12 m; passada de 1,7 m, a 1ª depois de meia passada: 7 passos.
    const steps = run(near, 3);
    // Os passos do bot à frente também marcam o indicador (na frente: ângulo ~0).
    const angles = new Float32Array(8);
    const alphas = new Float32Array(8);
    expect(near.sound.fillIndicator(0, angles, alphas)).toBeGreaterThan(0);
    expect(Math.abs(angles[0]!)).toBeLessThan(0.5);
    expect(steps).toHaveLength(7);
    expect(new Set(steps.map((p) => p.sound))).toEqual(new Set(['passo-concreto-1', 'passo-concreto-2']));
    for (const p of steps) expect(p.rate).toBeGreaterThanOrEqual(0.93);
    const crouched = run(setup({ botDz: 10 }), 3, true);
    expect(crouched[0]!.volume).toBeCloseTo(steps[0]!.volume * MATCH_SOUND.crouchGain, 6);
    expect(run(setup({ botDz: MATCH_SOUND.stepRangeM + 5 }), 3)).toHaveLength(0);
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
    const beats = mixer.played.filter((p) => p.sound === 'coracao').length;
    expect(beats).toBe(Math.ceil(2 / MATCH_SOUND.heartbeatS));
    health[entityIndex(me)] = 100;
    for (let t = 0; t < 120; t++) sound.frame(v, 1 / 60, 20 + t / 60);
    expect(mixer.played.filter((p) => p.sound === 'coracao').length).toBe(beats);
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

  it('pausa e fim cortam o que está tocando', () => {
    const { mixer, sound } = setup();
    sound.silence();
    sound.dispose();
    expect(mixer.stops).toBe(2);
  });
});

describe('síntese fatiada do loading', () => {
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
