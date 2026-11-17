import { createHeadlessMatch } from '@boboforces/ai';
import { builtinBotRef, MATCH_RECIPE_FORMAT } from '@boboforces/format';
import { BUTTON, quantizeAxis } from '@boboforces/input';
import { yawToU16 } from '@boboforces/shared';
import type { SimEvent } from '@boboforces/sim';
import { buildSyntheticConstruto, TEST_NAV_PATHS } from '@boboforces/sim/testing';
import { describe, expect, it } from 'vitest';
import { EVENT_TYPES, EventQueue, EventWriter } from './events.ts';
import { MAX_MESSAGE_BYTES } from './protocol.ts';

/** Um de cada tipo (o TypeScript exige todos os campos: campo que faltar no schema não volta igual). */
const SAMPLES: SimEvent[] = [
  {
    type: 'shot',
    tick: 10,
    shooter: 0x20003,
    weapon: 2,
    originX: 1.5,
    originY: 2.25,
    originZ: -3.1,
    dirX: 0.6,
    dirY: 0,
    dirZ: -0.8,
    distance: 41.7,
  },
  {
    type: 'hit',
    tick: 10,
    shooter: 0x20003,
    target: 0x10005,
    part: 'head',
    bodyPart: 0,
    damage: 87.5,
    x: 4,
    y: 1.7,
    z: -9,
    dirX: 0.6,
    dirY: 0,
    dirZ: -0.8,
  },
  {
    type: 'kill',
    tick: 11,
    killer: 0x20003,
    victim: 0x10005,
    weapon: 254,
    headshot: true,
    bodyPart: 0,
    dirX: 0,
    dirY: -1,
    dirZ: 0,
    force: 6.5,
    assister: 0,
  },
  {
    type: 'impact',
    tick: 11,
    x: 7,
    y: 0.5,
    z: 3,
    normalX: 0,
    normalY: 1,
    normalZ: 0,
    cellX: 14,
    cellY: 1,
    cellZ: -6,
    block: 300,
    face: -1,
    prop: -1,
  },
  { type: 'spawn', tick: 12, entity: 0x10001 },
  { type: 'move', tick: 12, entity: 0x10001, move: 'land', speed: 7.25 },
  { type: 'weapon', tick: 12, entity: 0x10001, weapon: 7, action: 'cook' },
  { type: 'melee', tick: 13, attacker: 0x10001, target: 0 },
  { type: 'matchPhase', tick: 13, phase: 'suddenDeath' },
  { type: 'wave', tick: 14, wave: 12, action: 'clear' },
  { type: 'down', tick: 14, entity: 0x10001, by: 0x30009, action: 'selfRevive' },
  {
    type: 'projectile',
    tick: 15,
    action: 'bounce',
    index: 300,
    weapon: 7,
    owner: 0x10001,
    x: 1,
    y: 2,
    z: 3,
    vx: -4,
    vy: 5,
    vz: -6,
  },
  { type: 'explosion', tick: 15, owner: 0x10001, weapon: 5, x: 1, y: 2, z: 3, radius: 4.5 },
  { type: 'pickup', tick: 16, action: 'take', index: 200, entity: 0x10001, x: 1, y: 0, z: 2, kind: 5 },
  {
    type: 'unstuck',
    tick: 16,
    entity: 0x10001,
    fromX: 1,
    fromY: 2,
    fromZ: 3,
    x: 4,
    y: 5,
    z: 6,
    respawned: true,
  },
  { type: 'barricade', tick: 17, index: 31, action: 'repair', planks: 6, by: 0x10001 },
  { type: 'door', tick: 17, index: 15, action: 'denied', cost: 1250, by: 0x10001 },
  // M5 (fase 5d): um ping e um emote.
  { type: 'signal', tick: 17, entity: 0x10002, kind: 0, x: 3.25, y: 1.5, z: -7 },
  { type: 'signal', tick: 17, entity: 0x10001, kind: 3, x: 1, y: 2.5, z: 2 },
  { type: 'purchase', tick: 18, index: 3, kind: 'perk', action: 'ok', item: 4, cost: 2500, by: 0x10001 },
  { type: 'box', tick: 18, index: 2, action: 'move', weapon: 11, by: 0 },
];

/** O evento como o cliente deve ver: reais em f32. */
function asF32(ev: SimEvent): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ev)) out[k] = typeof v === 'number' && !Number.isInteger(v) ? Math.fround(v) : v;
  return out;
}

function roundtrip(events: readonly SimEvent[]): { got: Record<string, unknown>[]; messages: Uint8Array[] } {
  const messages: Uint8Array[] = [];
  const writer = new EventWriter((b) => messages.push(b.slice()));
  writer.addAll(events);
  writer.flush();
  const queue = new EventQueue();
  for (const m of messages) queue.receive(m);
  const got: Record<string, unknown>[] = [];
  queue.release(Number.MAX_SAFE_INTEGER, (list) => {
    for (const ev of list) got.push({ ...ev });
  });
  return { got, messages };
}

describe('eventos pela rede (M5 fase 2a)', () => {
  it('todo tipo, todo campo volta igual (reais em f32)', () => {
    expect(new Set(SAMPLES.map((e) => e.type))).toEqual(new Set(EVENT_TYPES));
    const { got } = roundtrip(SAMPLES);
    expect(got).toEqual(SAMPLES.map(asF32));
  });

  it('muitos eventos viram várias mensagens de até 1.100 B; ticks longe abrem outra; o pool reaproveita', () => {
    const many: SimEvent[] = [];
    for (let i = 0; i < 400; i++) many.push({ ...SAMPLES[0]!, tick: 1000 + i } as SimEvent);
    const { got, messages } = roundtrip(many);
    expect(messages.length).toBeGreaterThan(5);
    for (const m of messages) expect(m.length).toBeLessThanOrEqual(MAX_MESSAGE_BYTES);
    expect(got.map((e) => e['tick'])).toEqual(many.map((e) => e.tick));
    // Soltar só até um tick: os outros esperam o estado chegar.
    const writer = new EventWriter((b) => queue.receive(b.slice()));
    const queue = new EventQueue();
    writer.addAll(SAMPLES);
    writer.flush();
    const seen: number[] = [];
    queue.release(12, (list) => seen.push(...list.map((e) => e.tick)));
    expect(seen).toEqual([10, 10, 11, 11, 12, 12, 12]);
    expect(queue.waiting).toBe(SAMPLES.length - 7);
    queue.release(18, (list) => seen.push(...list.map((e) => e.tick)));
    expect(queue.waiting).toBe(0);
  });

  it('os eventos de uma partida com bots e granadas voltam iguais', () => {
    const { map } = buildSyntheticConstruto({ nav: true });
    const all: Record<string, unknown>[] = [];
    const types = new Set<string>();
    const m = createHeadlessMatch({
      recipe: {
        format: MATCH_RECIPE_FORMAT,
        mode: 'warfare.tdm',
        map: 'test',
        seed: 5,
        teams: [
          { humans: 1, bots: [{ ref: builtinBotRef('normal'), count: 5 }] },
          { bots: [{ ref: builtinBotRef('sweaty'), count: 6 }] },
        ],
      },
      map,
      humans: 1,
      paths: TEST_NAV_PATHS,
      writeHumans: (f, s) => {
        f[0]!.yaw = yawToU16(s.tick * 0.01);
        f[0]!.moveY = quantizeAxis(1);
        f[0]!.weapon = s.tick % 300 < 60 ? 3 : 0;
        f[0]!.buttons = s.tick % 50 < 20 ? BUTTON.fire : 0;
      },
      onEvents: (events) => {
        for (const ev of events) {
          all.push(asF32(ev));
          types.add(ev.type);
        }
      },
    });
    m.run(60 * 20);
    m.dispose();
    // `all` já são cópias (os eventos da sim são de pool): manda tudo de uma vez.
    const { got } = roundtrip(all as unknown as SimEvent[]);
    expect(got).toEqual(all);
    for (const t of ['shot', 'hit', 'kill', 'impact', 'spawn', 'move', 'weapon', 'projectile', 'explosion']) {
      expect(types, t).toContain(t);
    }
  }, 30_000);
});
