import {
  BOMB,
  makeEntityId,
  NULL_ENTITY,
  PICKUP_KIND,
  ROUND,
  ROUND_PHASE,
  SIM_HZ,
  STRIKE,
  STRIKE_DATA,
  ZONE,
  type RoundsView,
  type SimEvent,
  type SimView,
} from '@boboforces/sim';
import { describe, expect, it } from 'vitest';
import { SOUND_RANK, type SoundId } from '../sound-bank.ts';
import { bombBeepInterval, createObjectiveSound, decisive, OBJECTIVE_SOUND } from './sound-objectives.ts';

/** M12 (fase 4): os sons dos objetivos (vista sintética: só os campos que o módulo lê). */

interface Heard {
  readonly id: SoundId;
  readonly at: boolean;
  readonly x?: number;
  readonly volume: number;
  readonly rate: number;
}

/** Bobo 0 do time 0 (o jogador local), bobo 1 do time 0 (aliado), bobo 2 do time 1. */
function fakeView(): SimView & { strike: { data: Int32Array; pos: Float32Array } } {
  const strike = { data: new Int32Array(10), pos: new Float32Array([5, 0, 5]), sites: [] };
  strike.data[STRIKE_DATA.carrier] = NULL_ENTITY;
  strike.data[STRIKE_DATA.planter] = NULL_ENTITY;
  strike.data[STRIKE_DATA.defuser] = NULL_ENTITY;
  return {
    count: 3,
    alive: new Uint8Array([1, 1, 1]),
    team: new Uint8Array([0, 0, 1]),
    position: new Float64Array(9),
    match: { phase: 'playing' },
    strike,
    rounds: null,
    royale: null,
    chaos: null,
    mapWeapons: null,
  } as unknown as SimView & { strike: { data: Int32Array; pos: Float32Array } };
}

function setup() {
  const heard: Heard[] = [];
  const me = makeEntityId(0, 1);
  const sound = createObjectiveSound({
    flat: (id, _nowS, volume, rate) => heard.push({ id, at: false, volume, rate }),
    at: (id, x, _y, _z, _nowS, _priority, volume, rate, nearM) =>
      heard.push({ id, at: true, x: nearM > 0 ? -nearM : x, volume, rate }),
    listenerDistance: (x, _y, z) => Math.hypot(x, z),
    myTeam: () => 0,
    isLocal: (e) => e === me,
  });
  return { heard, sound, me };
}

describe('os sons dos objetivos (M12, fase 4)', () => {
  it('a Boom Box: armada, bipe de 1 s a 0,15 s pelo relógio dela, e desarmada', () => {
    expect(bombBeepInterval(STRIKE.bombS * SIM_HZ)).toBeCloseTo(OBJECTIVE_SOUND.bombSlowS, 9);
    expect(bombBeepInterval(0)).toBeCloseTo(OBJECTIVE_SOUND.bombFastS, 9);
    const { heard, sound } = setup();
    const v = fakeView();
    const d = v.strike.data;
    d[STRIKE_DATA.bomb] = BOMB.carried;
    sound.frame(v, 1 / 60, 0);
    d[STRIKE_DATA.bomb] = BOMB.planted;
    d[STRIKE_DATA.bombTicks] = STRIKE.bombS * SIM_HZ;
    sound.frame(v, 1 / 60, 0.1);
    expect(heard.map((h) => h.id)).toEqual(['bomba-armada']);
    // Os 40 s do relógio: nos 5 primeiros, uns 5 bipes; nos 5 últimos, mais de 20.
    const total = STRIKE.bombS * SIM_HZ;
    const beeps: number[] = [];
    for (let t = 0; t < total; t++) {
      d[STRIKE_DATA.bombTicks] = total - t;
      const before = heard.length;
      sound.frame(v, 1 / 60, 1 + t / 60);
      if (heard.length > before) beeps.push(t);
    }
    expect(beeps.filter((t) => t < 5 * SIM_HZ).length).toBe(5);
    expect(beeps.filter((t) => t >= total - 5 * SIM_HZ).length).toBeGreaterThan(20);
    d[STRIKE_DATA.bomb] = BOMB.defused;
    sound.frame(v, 1 / 60, 5);
    expect(heard.at(-1)!.id).toBe('bomba-desarmada');
  });

  it('o 1º frame só guarda o estado (a bomba já plantada ao entrar não "arma" de novo)', () => {
    const { heard, sound } = setup();
    const v = fakeView();
    v.strike.data[STRIKE_DATA.bomb] = BOMB.planted;
    v.strike.data[STRIKE_DATA.bombTicks] = 600;
    sound.frame(v, 1 / 60, 0);
    expect(heard.filter((h) => h.id === 'bomba-armada')).toHaveLength(0);
  });

  it('o ponto do Domination: o seu time ganha (sobe) ou perde (desce)', () => {
    const { heard, sound } = setup();
    const v = fakeView();
    const point = (team: number, action: 'captured' | 'neutralized'): SimEvent => ({
      type: 'point',
      tick: 1,
      index: 0,
      team,
      action,
    });
    sound.event(point(0, 'captured'), v, 1);
    sound.event(point(1, 'captured'), v, 2);
    sound.event(point(0, 'neutralized'), v, 3);
    sound.event(point(1, 'neutralized'), v, 4);
    expect(heard.map((h) => [h.id, h.volume])).toEqual([
      ['ponto-ganho', 1],
      ['ponto-perdido', 1],
      ['ponto-perdido', 0.6],
      ['ponto-ganho', 0.6],
    ]);
  });

  it('o ping só para o time (o seu também), trazido para perto na direção dele; os emotes mudos', () => {
    const { heard, sound, me } = setup();
    const v = fakeView();
    const signal = (entity: number, kind: number): SimEvent => ({
      type: 'signal',
      tick: 1,
      entity,
      kind,
      x: 40,
      y: 0,
      z: 0,
    });
    sound.event(signal(makeEntityId(1, 1), 0), v, 1);
    sound.event(signal(makeEntityId(2, 1), 0), v, 2);
    sound.event(signal(me, 0), v, 3);
    sound.event(signal(makeEntityId(1, 1), 2), v, 4);
    expect(heard.map((h) => [h.id, h.x])).toEqual([
      ['ping', -OBJECTIVE_SOUND.pingNearM],
      ['ping', -OBJECTIVE_SOUND.pingNearM],
    ]);
  });

  it('as rodadas: o começo e o fim (ganha ou perde); a zona fechando; a Roleta trocando', () => {
    const { heard, sound } = setup();
    const rounds = new Int32Array(7);
    const zone = new Int32Array(5);
    const masks = new Int32Array(3);
    const v = Object.assign(fakeView(), {
      rounds: { data: rounds },
      royale: { data: zone },
      chaos: { masks },
    }) as unknown as SimView;
    rounds[ROUND.round] = 1;
    rounds[ROUND.phase] = ROUND_PHASE.buy;
    sound.frame(v, 1 / 60, 0);
    rounds[ROUND.phase] = ROUND_PHASE.live;
    sound.frame(v, 1 / 60, 1);
    rounds[ROUND.phase] = ROUND_PHASE.over;
    rounds[ROUND.winner] = 1;
    sound.frame(v, 1 / 60, 2);
    zone[ZONE.shrinking] = 1;
    sound.frame(v, 1 / 60, 3);
    masks[0] = 4;
    sound.frame(v, 1 / 60, 4);
    expect(heard.map((h) => h.id)).toEqual(['contagem-vai', 'ponto-perdido', 'zona-fecha', 'drop-pega']);
  });

  it('revisão: a rodada que fecha a partida fica só com a vinheta (sem o tom do fim da rodada)', () => {
    const { heard, sound } = setup();
    const rounds = new Int32Array(7);
    const view = (winRounds: number, totalRounds: number): SimView =>
      Object.assign(fakeView(), { rounds: { data: rounds, winRounds, totalRounds } }) as unknown as SimView;
    // O BoboStrike: 7 vitórias ou 12 rodadas. O time 1 chega às 7.
    const v = view(7, 12);
    rounds[ROUND.round] = 9;
    rounds[ROUND.phase] = ROUND_PHASE.live;
    sound.frame(v, 1 / 60, 0);
    rounds[ROUND.phase] = ROUND_PHASE.over;
    rounds[ROUND.winner] = 1;
    rounds[ROUND.wins1] = 7;
    sound.frame(v, 1 / 60, 1);
    expect(heard).toHaveLength(0);
    expect(decisive({ data: rounds, winRounds: 7, totalRounds: 12 } as unknown as RoundsView)).toBe(true);
    rounds[ROUND.wins1] = 6;
    expect(decisive({ data: rounds, winRounds: 7, totalRounds: 12 } as unknown as RoundsView)).toBe(false);
    rounds[ROUND.round] = 12;
    expect(decisive({ data: rounds, winRounds: 7, totalRounds: 12 } as unknown as RoundsView)).toBe(true);
  });

  it('a arma do mapa que volta: baixinho e só perto (a largada do tick 0 não conta)', () => {
    const { heard, sound } = setup();
    const v = fakeView() as SimView & { mapWeapons: unknown };
    (v as { mapWeapons: unknown }).mapWeapons = { spots: [], respawnTicks: 1200, spotMask: 0 };
    const drop = (tick: number, x: number): SimEvent => ({
      type: 'pickup',
      action: 'drop',
      tick,
      index: 0,
      entity: NULL_ENTITY,
      x,
      y: 0,
      z: 0,
      kind: PICKUP_KIND.weaponBase + 2,
    });
    sound.event(drop(0, 3), v, 0);
    sound.event(drop(600, 3), v, 10);
    sound.event(drop(600, OBJECTIVE_SOUND.weaponBackM + 5), v, 11);
    expect(heard.map((h) => [h.id, h.volume])).toEqual([['drop-aparece', OBJECTIVE_SOUND.weaponBackGain]]);
    expect(SOUND_RANK.world).toBeGreaterThan(0);
  });
});
