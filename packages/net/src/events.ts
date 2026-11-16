import { BitReader, BitWriter } from '@boboforces/shared';
import type { SimEvent, SimEventType } from '@boboforces/sim';
import { MAX_MESSAGE_BYTES, MSG } from './protocol.ts';
import { bitsFor } from './schema.ts';
import { copyBits } from './snapshot.ts';

/**
 * Eventos da sim pela rede (M5 fase 2a): tiro, acerto, morte, som, compra… O cliente não roda a sim, então o host
 * manda os eventos de cada tick pelo canal confiável (agrupados até o próximo snapshot) e o cliente solta cada um
 * quando o estado que ele mostra chega naquele tick (o efeito sai junto com o boneco). Reais em f32 (os eventos são
 * poucos por tick e o render usa a direção e o ponto exatos).
 */

type EvKind = 'u8' | 'u16' | 'i16' | 'i32' | 'u32' | 'f32' | 'bool' | readonly string[];
type EventOf<T extends SimEventType> = Extract<SimEvent, { type: T }>;
type EvField<T extends SimEventType> = readonly [Exclude<keyof EventOf<T>, 'type' | 'tick'> & string, EvKind];

const XYZ = (p = ''): readonly [string, EvKind][] => [
  [`${p}${p ? 'X' : 'x'}`, 'f32'],
  [`${p}${p ? 'Y' : 'y'}`, 'f32'],
  [`${p}${p ? 'Z' : 'z'}`, 'f32'],
];

/**
 * Os campos de cada tipo, na ordem em que viajam. Tipo novo entra no FIM (o índice do tipo viaja) e campo novo no fim
 * do tipo; os dois sobem o `PROTOCOL_VERSION`. O teste confere que todo campo de todo tipo volta igual.
 */
export const EVENT_SCHEMA: { readonly [T in SimEventType]: readonly EvField<T>[] } = {
  shot: [
    ['shooter', 'u32'],
    ['weapon', 'u8'],
    ...XYZ('origin'),
    ...XYZ('dir'),
    ['distance', 'f32'],
  ] as EvField<'shot'>[],
  hit: [
    ['shooter', 'u32'],
    ['target', 'u32'],
    ['part', ['head', 'torso', 'arm', 'leg']],
    ['bodyPart', 'u8'],
    ['damage', 'f32'],
    ...XYZ(),
    ...XYZ('dir'),
  ] as EvField<'hit'>[],
  kill: [
    ['killer', 'u32'],
    ['victim', 'u32'],
    ['weapon', 'u8'],
    ['headshot', 'bool'],
    ['bodyPart', 'u8'],
    ...XYZ('dir'),
    ['force', 'f32'],
    ['assister', 'u32'],
  ] as EvField<'kill'>[],
  impact: [
    ...XYZ(),
    ...XYZ('normal'),
    ['cellX', 'i16'],
    ['cellY', 'i16'],
    ['cellZ', 'i16'],
    ['block', 'u16'],
    ['face', 'i16'],
    ['prop', 'i32'],
  ] as EvField<'impact'>[],
  spawn: [['entity', 'u32']],
  move: [
    ['entity', 'u32'],
    ['move', ['jump', 'land', 'slide', 'step']],
    ['speed', 'f32'],
  ],
  weapon: [
    ['entity', 'u32'],
    ['weapon', 'u8'],
    ['action', ['switch', 'reloadStart', 'reloadEnd', 'empty', 'cook']],
  ],
  melee: [
    ['attacker', 'u32'],
    ['target', 'u32'],
  ],
  matchPhase: [['phase', ['warmup', 'playing', 'ended', 'suddenDeath']]],
  wave: [
    ['wave', 'u16'],
    ['action', ['start', 'clear']],
  ],
  down: [
    ['entity', 'u32'],
    ['by', 'u32'],
    ['action', ['down', 'revive', 'selfRevive']],
  ],
  projectile: [
    ['action', ['launch', 'bounce']],
    ['index', 'u16'],
    ['weapon', 'u8'],
    ['owner', 'u32'],
    ...XYZ(),
    ['vx', 'f32'],
    ['vy', 'f32'],
    ['vz', 'f32'],
  ] as EvField<'projectile'>[],
  explosion: [['owner', 'u32'], ['weapon', 'u8'], ...XYZ(), ['radius', 'f32']] as EvField<'explosion'>[],
  pickup: [
    ['action', ['drop', 'take']],
    ['index', 'u16'],
    ['entity', 'u32'],
    ...XYZ(),
    ['kind', 'u8'],
  ] as EvField<'pickup'>[],
  unstuck: [['entity', 'u32'], ...XYZ('from'), ...XYZ(), ['respawned', 'bool']] as EvField<'unstuck'>[],
  barricade: [
    ['index', 'u8'],
    ['action', ['tear', 'break', 'repair']],
    ['planks', 'u8'],
    ['by', 'u32'],
  ],
  door: [
    ['index', 'u8'],
    ['action', ['open', 'denied']],
    ['cost', 'i32'],
    ['by', 'u32'],
  ],
  purchase: [
    ['index', 'u8'],
    ['kind', ['weapon', 'ammo', 'perk']],
    ['action', ['ok', 'denied']],
    ['item', 'i32'],
    ['cost', 'i32'],
    ['by', 'u32'],
  ],
  box: [
    ['index', 'u8'],
    ['action', ['open', 'denied', 'offer', 'take', 'expire', 'move']],
    ['weapon', 'u8'],
    ['by', 'u32'],
  ],
};

/** Índice de cada tipo (a ordem do `EVENT_SCHEMA`). */
export const EVENT_TYPES = Object.keys(EVENT_SCHEMA) as SimEventType[];
const TYPE_BITS = bitsFor(EVENT_TYPES.length);
const TYPE_INDEX = new Map<string, number>(EVENT_TYPES.map((t, i) => [t, i]));
type AnyField = readonly [string, EvKind];
const FIELDS: readonly (readonly AnyField[])[] = EVENT_TYPES.map((t) => EVENT_SCHEMA[t] as readonly AnyField[]);
/** Uma mensagem junta eventos de até 255 ticks depois do primeiro (o deslocamento vai em 8 bits). */
const MAX_TICK_OFFSET = 255;

function writeField(w: BitWriter, kind: EvKind, v: unknown): void {
  if (typeof kind !== 'string') {
    const i = kind.indexOf(v as string);
    w.writeBits(i < 0 ? 0 : i, bitsFor(kind.length));
    return;
  }
  const n = v as number;
  switch (kind) {
    case 'u8':
      w.writeBits(n & 0xff, 8);
      break;
    case 'u16':
    case 'i16':
      w.writeBits(n & 0xffff, 16);
      break;
    case 'u32':
    case 'i32':
      w.writeBits(n >>> 0, 32);
      break;
    case 'f32':
      w.writeF32(n);
      break;
    case 'bool':
      w.writeBits(v ? 1 : 0, 1);
      break;
  }
}

function readField(r: BitReader, kind: EvKind): unknown {
  if (typeof kind !== 'string') return kind[r.readBits(bitsFor(kind.length))] ?? kind[0];
  switch (kind) {
    case 'u8':
      return r.readBits(8);
    case 'u16':
      return r.readBits(16);
    case 'i16':
      return (r.readBits(16) << 16) >> 16;
    case 'u32':
      return r.readBits(32) >>> 0;
    case 'i32':
      return r.readBits(32) | 0;
    case 'f32':
      return r.readF32();
    case 'bool':
      return r.readBits(1) === 1;
  }
}

/**
 * Host: junta os eventos em mensagens de até `MAX_MESSAGE_BYTES` e entrega cada uma pronta a `send` (o host manda
 * para todos os clientes; o transporte copia). `flush` fecha a mensagem aberta (na hora do snapshot).
 */
export class EventWriter {
  private readonly msg = new BitWriter(MAX_MESSAGE_BYTES);
  private readonly one = new BitWriter(256);
  private readonly send: (bytes: Uint8Array) => void;
  private baseTick = -1;
  private count = 0;
  sent = 0;

  constructor(send: (bytes: Uint8Array) => void) {
    this.send = send;
  }

  add(ev: SimEvent): void {
    const type = TYPE_INDEX.get(ev.type);
    if (type === undefined) return;
    const one = this.one;
    one.reset();
    one.writeBits(type, TYPE_BITS);
    const fields = FIELDS[type]!;
    const rec = ev as unknown as Record<string, unknown>;
    for (let i = 0; i < fields.length; i++) writeField(one, fields[i]![1], rec[fields[i]![0]]);
    const need = 1 + 8 + one.bitLength + 1;
    if (
      this.count > 0 &&
      (this.msg.bitLength + need > MAX_MESSAGE_BYTES * 8 || ev.tick - this.baseTick > MAX_TICK_OFFSET)
    ) {
      this.flush();
    }
    if (this.count === 0) {
      this.msg.reset();
      this.msg.writeBits(MSG.events, 8);
      this.msg.writeBits(ev.tick >>> 0, 32);
      this.baseTick = ev.tick;
    }
    this.msg.writeBits(1, 1);
    this.msg.writeBits(ev.tick - this.baseTick, 8);
    copyBits(one.buffer, 0, one.bitLength, this.msg);
    this.count++;
  }

  addAll(events: readonly SimEvent[]): void {
    for (let i = 0; i < events.length; i++) this.add(events[i]!);
  }

  flush(): void {
    if (this.count === 0) return;
    this.msg.writeBits(0, 1);
    this.send(this.msg.bytes());
    this.sent++;
    this.count = 0;
  }
}

/**
 * Cliente: lê as mensagens de eventos para objetos de pool (um por tipo, com o mesmo formato do evento da sim) e solta
 * os que o estado mostrado já alcançou. Como na sim, o evento só vale durante o `onEvents`; quem precisar, copia.
 */
export class EventQueue {
  private readonly reader = new BitReader(new Uint8Array(0));
  private readonly pools: Record<string, unknown>[][] = EVENT_TYPES.map(() => []);
  private readonly pending: SimEvent[] = [];
  private readonly ready: SimEvent[] = [];
  received = 0;

  /** Uma mensagem `MSG.events` inteira (com o byte do tipo). */
  receive(bytes: Uint8Array): void {
    const r = this.reader;
    r.reset(bytes);
    if (r.readBits(8) !== MSG.events) return;
    const base = r.readBits(32);
    while (r.readBits(1) === 1) {
      const tick = base + r.readBits(8);
      const type = r.readBits(TYPE_BITS);
      const fields = FIELDS[type];
      if (fields === undefined) return;
      const ev = this.pools[type]!.pop() ?? {};
      ev['type'] = EVENT_TYPES[type];
      ev['tick'] = tick;
      for (let i = 0; i < fields.length; i++) ev[fields[i]![0]] = readField(r, fields[i]![1]);
      this.pending.push(ev as unknown as SimEvent);
      this.received++;
    }
  }

  /** Quantos esperam o estado chegar. */
  get waiting(): number {
    return this.pending.length;
  }

  /**
   * Solta (em ordem) os eventos com tick até `tick` para `handler` e devolve os objetos ao pool. Chamada depois de
   * aplicar o snapshot desse tick.
   */
  release(tick: number, handler: ((events: readonly SimEvent[]) => void) | null): void {
    const p = this.pending;
    let n = 0;
    while (n < p.length && p[n]!.tick <= tick) n++;
    if (n === 0) return;
    const ready = this.ready;
    ready.length = 0;
    for (let i = 0; i < n; i++) ready.push(p[i]!);
    handler?.(ready);
    for (let i = 0; i < n; i++) {
      const ev = ready[i]!;
      this.pools[TYPE_INDEX.get(ev.type)!]!.push(ev as unknown as Record<string, unknown>);
    }
    ready.length = 0;
    p.copyWithin(0, n);
    p.length -= n;
  }
}
