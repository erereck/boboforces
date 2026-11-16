import { BitReader, BitWriter } from '@boboforces/shared';
import { MAX_ENTITIES, MAX_PICKUPS, MAX_PROJECTILES } from '@boboforces/sim';
import { clearFrame, copyFrame, ensureEntities, ensurePickups, ensureProjectiles, NetFrame } from './frame.ts';
import { MAX_MESSAGE_BYTES, MSG, NO_TICK } from './protocol.ts';
import {
  bitsFor,
  ENTITY_GROUP_START,
  ENTITY_GROUPS,
  ENTITY_SLOTS,
  HOT_GROUPS,
  PICKUP_SLOTS,
  PROJECTILE_SLOTS,
  type NetLayout,
  type SlotCodecs,
} from './schema.ts';

/**
 * Snapshot pela rede (tecnico.md §13.3): delta contra a última base que o cliente confirmou (ou completo, sem base),
 * dividido em partes de até `MAX_MESSAGE_BYTES` com as entidades por prioridade (a do próprio jogador primeiro, depois
 * as mais perto). Cada parte se lê sozinha (cabeçalho + itens); o snapshot só vale (vira base e é aplicado) quando
 * todas as partes chegam. Itens: os escalares da partida, entidades, projéteis e pickups que mudaram.
 */

export const ITEM = { entity: 0, projectile: 1, pickup: 2, globals: 3 } as const;

const ENTITY_INDEX_BITS = bitsFor(MAX_ENTITIES);
const PROJ_INDEX_BITS = bitsFor(MAX_PROJECTILES);
const PICK_INDEX_BITS = bitsFor(MAX_PICKUPS);
/** Partes por snapshot (6 bits): ~70 KB, mais que um snapshot completo com o pool de entidades cheio. */
export const MAX_SNAPSHOT_PARTS = 64;
const PART_BITS = 6;
/** Escalares da partida em blocos de 8, com um bit de "mudou" por bloco. */
const GLOBAL_CHUNK = 8;

/** tipo + tick + base + parte + partes + 3 contagens + seq da entrada. */
export const SNAPSHOT_HEADER_BITS = 8 + 32 + 32 + PART_BITS + PART_BITS + 16 * 3 + 1 + 16;

function signExtend(x: number, bits: number): number {
  return bits === 32 ? x | 0 : (x << (32 - bits)) >> (32 - bits);
}

function writeSlot(w: BitWriter, table: SlotCodecs, j: number, q: number, base: number): void {
  const small = table.small[j]!;
  if (small > 0) {
    const d = q - base;
    const lim = 2 ** (small - 1);
    if (d >= -lim && d < lim) {
      w.writeBits(1, 1);
      w.writeBits(d >>> 0, small);
      return;
    }
    w.writeBits(0, 1);
  }
  w.writeBits(q >>> 0, table.bits[j]!);
}

function readSlot(r: BitReader, table: SlotCodecs, j: number, base: number): number {
  const small = table.small[j]!;
  if (small > 0 && r.readBits(1) === 1) return (base + signExtend(r.readBits(small), small)) | 0;
  const bits = table.bits[j]!;
  const raw = r.readBits(bits);
  return table.signed[j] === 1 ? signExtend(raw, bits) : raw | 0;
}

/** Copia os bits [from, to) de `src` (LSB primeiro, como o BitWriter) para `dst`. */
export function copyBits(src: Uint8Array, from: number, to: number, dst: BitWriter): void {
  let pos = from;
  while (pos < to) {
    const n = Math.min(24, to - pos);
    let v = 0;
    let got = 0;
    while (got < n) {
      const off = pos & 7;
      const take = Math.min(8 - off, n - got);
      v |= ((src[pos >>> 3]! >>> off) & ((1 << take) - 1)) << got;
      got += take;
      pos += take;
    }
    dst.writeBits(v, n);
  }
}

/** Quem recebe o snapshot: a entidade dele (prioridade) e o último `seq` de entrada que o host usou. */
export interface SnapshotTarget {
  /** Índice da entidade do jogador (-1 = nenhuma: tudo por ordem de índice). */
  readonly focus: number;
  /** Último `seq` de entrada do cliente consumido pelo host (-1 = nenhum ainda). */
  readonly inputSeq: number;
}

export interface EncodeResult {
  readonly parts: number;
  readonly bytes: number;
}

/**
 * Codificador do host: um por host (os rascunhos são dele). `encode` escreve as partes e chama `send` em cada uma
 * (os bytes valem só durante a chamada: o transporte copia).
 */
export class SnapshotEncoder {
  private readonly layout: NetLayout;
  private readonly scratch = new BitWriter(1 << 17);
  private readonly part = new BitWriter(MAX_MESSAGE_BYTES);
  private readonly itemEnd = new Int32Array(1 + MAX_ENTITIES + MAX_PROJECTILES + MAX_PICKUPS);
  private readonly order = new Int32Array(MAX_ENTITIES);
  private readonly keys = new Float64Array(MAX_ENTITIES);
  private readonly groupMask = new Int32Array(MAX_ENTITIES);
  private readonly empty: NetFrame;

  constructor(layout: NetLayout) {
    this.layout = layout;
    this.empty = new NetFrame(layout);
  }

  encode(
    cur: NetFrame,
    base: NetFrame | null,
    target: SnapshotTarget,
    send: (bytes: Uint8Array) => void,
  ): EncodeResult {
    const b = base ?? this.empty;
    const w = this.scratch;
    w.reset();
    let items = 0;
    if (this.writeGlobals(cur, b)) this.itemEnd[items++] = w.bitLength;
    const n = this.collectEntities(cur, b, target.focus);
    for (let k = 0; k < n; k++) {
      this.writeEntity(cur, b, this.order[k]!);
      this.itemEnd[items++] = w.bitLength;
    }
    const projTo = Math.max(cur.projCount, b.projCount);
    for (let p = 0; p < projTo; p++) {
      if (this.writePooled(ITEM.projectile, PROJ_INDEX_BITS, PROJECTILE_SLOTS, cur.proj, b.proj, p)) {
        this.itemEnd[items++] = w.bitLength;
      }
    }
    const pickTo = Math.max(cur.pickCount, b.pickCount);
    for (let p = 0; p < pickTo; p++) {
      if (this.writePooled(ITEM.pickup, PICK_INDEX_BITS, PICKUP_SLOTS, cur.pick, b.pick, p)) {
        this.itemEnd[items++] = w.bitLength;
      }
    }
    // Partes: gulosas, na ordem dos itens (os escalares e o próprio jogador caem na primeira).
    const budget = MAX_MESSAGE_BYTES * 8 - SNAPSHOT_HEADER_BITS - 1;
    let parts = 1;
    let used = 0;
    let start = 0;
    for (let i = 0; i < items; i++) {
      const size = this.itemEnd[i]! - start + 1;
      if (used > 0 && used + size > budget) {
        parts++;
        used = 0;
      }
      used += size;
      start = this.itemEnd[i]!;
    }
    if (parts > MAX_SNAPSHOT_PARTS) throw new Error(`snapshot: ${parts} partes (máximo ${MAX_SNAPSHOT_PARTS})`);
    // Escreve cada parte (mesma divisão de cima).
    let bytes = 0;
    let item = 0;
    start = 0;
    for (let part = 0; part < parts; part++) {
      const pw = this.part;
      pw.reset();
      pw.writeBits(MSG.snapshot, 8);
      pw.writeBits(cur.tick >>> 0, 32);
      pw.writeBits(base ? base.tick >>> 0 : NO_TICK, 32);
      pw.writeBits(part, PART_BITS);
      pw.writeBits(parts - 1, PART_BITS);
      pw.writeBits(cur.count, 16);
      pw.writeBits(cur.projCount, 16);
      pw.writeBits(cur.pickCount, 16);
      pw.writeBits(target.inputSeq >= 0 ? 1 : 0, 1);
      pw.writeBits(target.inputSeq >= 0 ? target.inputSeq : 0, 16);
      let used2 = 0;
      while (item < items) {
        const size = this.itemEnd[item]! - start + 1;
        if (used2 > 0 && used2 + size > budget) break;
        pw.writeBits(1, 1);
        copyBits(w.buffer, start, this.itemEnd[item]!, pw);
        used2 += size;
        start = this.itemEnd[item]!;
        item++;
      }
      pw.writeBits(0, 1);
      bytes += pw.byteLength;
      send(pw.bytes());
    }
    return { parts, bytes };
  }

  /** Escalares da partida; devolve se escreveu o item (algo mudou). */
  private writeGlobals(cur: NetFrame, b: NetFrame): boolean {
    const n = cur.glob.length;
    let changed = false;
    for (let k = 0; k < n; k++) {
      if (cur.glob[k] !== b.glob[k]) {
        changed = true;
        break;
      }
    }
    if (!changed) return false;
    const w = this.scratch;
    const table = this.layout.globalCodecs;
    w.writeBits(ITEM.globals, 2);
    for (let c = 0; c < n; c += GLOBAL_CHUNK) {
      const end = Math.min(n, c + GLOBAL_CHUNK);
      let any = 0;
      for (let k = c; k < end; k++) if (cur.glob[k] !== b.glob[k]) any = 1;
      w.writeBits(any, 1);
      if (any === 0) continue;
      for (let k = c; k < end; k++) {
        const q = cur.glob[k]!;
        const base = b.glob[k]!;
        if (q === base) {
          w.writeBits(0, 1);
        } else {
          w.writeBits(1, 1);
          writeSlot(w, table, k, q, base);
        }
      }
    }
    return true;
  }

  /** Entidades que mudaram, em `order`, por prioridade; devolve quantas. */
  private collectEntities(cur: NetFrame, b: NetFrame, focus: number): number {
    const slots = ENTITY_SLOTS.count;
    const to = Math.max(cur.count, b.count);
    const fx = focus >= 0 ? cur.ent[focus * slots] : 0;
    const fz = focus >= 0 ? cur.ent[focus * slots + 2] : 0;
    let n = 0;
    for (let e = 0; e < to; e++) {
      const o = e * slots;
      let mask = 0;
      for (let gi = 0; gi < ENTITY_GROUPS.length; gi++) {
        for (let j = ENTITY_GROUP_START[gi]!; j < ENTITY_GROUP_START[gi + 1]!; j++) {
          if ((cur.ent[o + j] ?? 0) !== (b.ent[o + j] ?? 0)) {
            mask |= 1 << gi;
            break;
          }
        }
      }
      if (mask === 0) continue;
      this.groupMask[e] = mask;
      // Prioridade: o próprio jogador, depois a distância no chão (cm²) até ele.
      let key: number;
      if (e === focus) key = -1;
      else if (focus < 0) key = e;
      else {
        const dx = (cur.ent[o] ?? 0) - (fx ?? 0);
        const dz = (cur.ent[o + 2] ?? 0) - (fz ?? 0);
        key = dx * dx + dz * dz;
      }
      // Inserção ordenada (estável): poucas dezenas de entidades mudam por snapshot.
      let i = n++;
      while (i > 0 && this.keys[i - 1]! > key) {
        this.keys[i] = this.keys[i - 1]!;
        this.order[i] = this.order[i - 1]!;
        i--;
      }
      this.keys[i] = key;
      this.order[i] = e;
    }
    return n;
  }

  private writeEntity(cur: NetFrame, b: NetFrame, e: number): void {
    const w = this.scratch;
    const table = ENTITY_SLOTS;
    const slots = ENTITY_SLOTS.count;
    const mask = this.groupMask[e]!;
    w.writeBits(ITEM.entity, 2);
    w.writeBits(e, ENTITY_INDEX_BITS);
    w.writeBits(mask & ((1 << HOT_GROUPS) - 1), HOT_GROUPS);
    const cold = mask >>> HOT_GROUPS;
    w.writeBits(cold !== 0 ? 1 : 0, 1);
    if (cold !== 0) w.writeBits(cold, ENTITY_GROUPS.length - HOT_GROUPS);
    const o = e * slots;
    for (let gi = 0; gi < ENTITY_GROUPS.length; gi++) {
      if ((mask & (1 << gi)) === 0) continue;
      for (let j = ENTITY_GROUP_START[gi]!; j < ENTITY_GROUP_START[gi + 1]!; j++) {
        const q = cur.ent[o + j] ?? 0;
        const base = b.ent[o + j] ?? 0;
        if (q === base) {
          w.writeBits(0, 1);
        } else {
          w.writeBits(1, 1);
          writeSlot(w, table, j, q, base);
        }
      }
    }
  }

  /** Projétil ou pickup `p`; devolve se escreveu (mudou). */
  private writePooled(
    tag: number,
    indexBits: number,
    t: SlotCodecs,
    cur: Int32Array,
    base: Int32Array,
    p: number,
  ): boolean {
    const o = p * t.count;
    let changed = false;
    for (let j = 0; j < t.count; j++) {
      if ((cur[o + j] ?? 0) !== (base[o + j] ?? 0)) {
        changed = true;
        break;
      }
    }
    if (!changed) return false;
    const w = this.scratch;
    w.writeBits(tag, 2);
    w.writeBits(p, indexBits);
    for (let j = 0; j < t.count; j++) {
      const q = cur[o + j] ?? 0;
      const bq = base[o + j] ?? 0;
      if (q === bq) {
        w.writeBits(0, 1);
      } else {
        w.writeBits(1, 1);
        writeSlot(w, t, j, q, bq);
      }
    }
    return true;
  }
}

/** Fila dos snapshots do host (bases do delta) ou dos completos do cliente. */
export class FrameRing {
  readonly frames: NetFrame[];
  private head = 0;

  constructor(layout: NetLayout, size: number) {
    this.frames = Array.from({ length: size }, () => new NetFrame(layout));
  }

  /** O próximo slot (o mais antigo), para escrever por cima. */
  next(): NetFrame {
    const f = this.frames[this.head]!;
    this.head = (this.head + 1) % this.frames.length;
    return f;
  }

  /** Troca o slot mais antigo por `f` e devolve o que saiu (sem copiar). */
  swapIn(f: NetFrame): NetFrame {
    const out = this.frames[this.head]!;
    this.frames[this.head] = f;
    this.head = (this.head + 1) % this.frames.length;
    return out;
  }

  get(tick: number): NetFrame | null {
    if (tick === NO_TICK) return null;
    for (const f of this.frames) if (f.tick === tick) return f;
    return null;
  }
}

interface Pending {
  frame: NetFrame;
  tick: number;
  parts: number;
  received: number;
  /** Partes que já chegaram (64 bits em dois inteiros). */
  lo: number;
  hi: number;
  count: number;
  projCount: number;
  pickCount: number;
  inputSeq: number;
}

export interface AssemblerStats {
  parts: number;
  completed: number;
  /** Partes de um snapshot cuja base o cliente não tem mais (o host vai mandar outro). */
  noBase: number;
  /** Partes velhas (de um snapshot mais antigo que o último completo) ou repetidas. */
  stale: number;
}

/**
 * Montador do cliente: junta as partes de cada snapshot em cima da base e, quando completa, guarda na fila dos
 * completos (as bases dos próximos). Até 4 snapshots montando ao mesmo tempo (partes fora de ordem).
 */
export class SnapshotAssembler {
  private readonly layout: NetLayout;
  private readonly ring: FrameRing;
  private readonly pending: Pending[];
  private readonly reader = new BitReader(new Uint8Array(0));
  private newestFrame: NetFrame | null = null;
  private newestSeq = -1;
  readonly stats: AssemblerStats = { parts: 0, completed: 0, noBase: 0, stale: 0 };

  constructor(layout: NetLayout, ringSize = 64, pendingSize = 4) {
    this.layout = layout;
    this.ring = new FrameRing(layout, ringSize);
    this.pending = Array.from({ length: pendingSize }, () => ({
      frame: new NetFrame(layout),
      tick: NO_TICK,
      parts: 0,
      received: 0,
      lo: 0,
      hi: 0,
      count: 0,
      projCount: 0,
      pickCount: 0,
      inputSeq: -1,
    }));
  }

  /** O snapshot completo mais novo (`null` = nenhum ainda). */
  get newest(): NetFrame | null {
    return this.newestFrame;
  }

  /** Último `seq` de entrada que o host disse ter usado, no snapshot completo mais novo (-1 = nenhum). */
  get newestInputSeq(): number {
    return this.newestSeq;
  }

  get(tick: number): NetFrame | null {
    return this.ring.get(tick);
  }

  /** Uma mensagem `MSG.snapshot` inteira (com o byte do tipo). Devolve se completou um snapshot novo. */
  receive(bytes: Uint8Array): boolean {
    const r = this.reader;
    r.reset(bytes);
    if (r.readBits(8) !== MSG.snapshot) return false;
    this.stats.parts++;
    const tick = r.readBits(32);
    const baseTick = r.readBits(32);
    const part = r.readBits(PART_BITS);
    const parts = r.readBits(PART_BITS) + 1;
    const count = r.readBits(16);
    const projCount = r.readBits(16);
    const pickCount = r.readBits(16);
    const hasSeq = r.readBits(1);
    const seq = r.readBits(16);
    if (this.newestFrame !== null && tick <= this.newestFrame.tick) {
      this.stats.stale++;
      return false;
    }
    let p = this.pending.find((x) => x.tick === tick) ?? null;
    if (p === null) {
      // O slot livre ou o do snapshot mais antigo (que já não vai completar).
      p = this.pending[0]!;
      for (const x of this.pending) if (x.tick === NO_TICK || (p.tick !== NO_TICK && x.tick < p.tick)) p = x;
      if (baseTick === NO_TICK) {
        clearFrame(p.frame);
      } else {
        const b = this.ring.get(baseTick);
        if (b === null) {
          this.stats.noBase++;
          p.tick = NO_TICK;
          return false;
        }
        copyFrame(p.frame, b);
      }
      p.tick = tick;
      p.parts = parts;
      p.received = 0;
      p.lo = 0;
      p.hi = 0;
    }
    const bit = part < 32 ? 1 << part : 1 << (part - 32);
    if ((part < 32 ? p.lo : p.hi) & bit) {
      this.stats.stale++;
      return false;
    }
    if (part < 32) p.lo |= bit;
    else p.hi |= bit;
    p.received++;
    p.count = count;
    p.projCount = projCount;
    p.pickCount = pickCount;
    p.inputSeq = hasSeq === 1 ? seq : -1;
    this.decodeItems(r, p.frame);
    if (p.received < p.parts) return false;
    // Completo: vira base e o mais novo.
    const f = p.frame;
    f.tick = tick;
    f.count = count;
    f.projCount = projCount;
    f.pickCount = pickCount;
    p.frame = this.ring.swapIn(f);
    p.tick = NO_TICK;
    this.newestFrame = f;
    this.newestSeq = p.inputSeq;
    this.stats.completed++;
    // Os que montavam um snapshot mais velho não servem mais.
    for (const x of this.pending) if (x.tick !== NO_TICK && x.tick < tick) x.tick = NO_TICK;
    return true;
  }

  private decodeItems(r: BitReader, f: NetFrame): void {
    const slots = ENTITY_SLOTS.count;
    const ent = ENTITY_SLOTS;
    const globals = this.layout.globalCodecs;
    while (r.readBits(1) === 1) {
      const tag = r.readBits(2);
      if (tag === ITEM.entity) {
        const e = r.readBits(ENTITY_INDEX_BITS);
        ensureEntities(f, e + 1);
        let mask = r.readBits(HOT_GROUPS);
        if (r.readBits(1) === 1) mask |= r.readBits(ENTITY_GROUPS.length - HOT_GROUPS) << HOT_GROUPS;
        const o = e * slots;
        for (let gi = 0; gi < ENTITY_GROUPS.length; gi++) {
          if ((mask & (1 << gi)) === 0) continue;
          for (let j = ENTITY_GROUP_START[gi]!; j < ENTITY_GROUP_START[gi + 1]!; j++) {
            if (r.readBits(1) === 1) f.ent[o + j] = readSlot(r, ent, j, f.ent[o + j]!);
          }
        }
        if (e + 1 > f.count) f.count = e + 1;
      } else if (tag === ITEM.projectile) {
        const p = r.readBits(PROJ_INDEX_BITS);
        ensureProjectiles(f, p + 1);
        this.decodePooled(r, PROJECTILE_SLOTS, f.proj, p);
        if (p + 1 > f.projCount) f.projCount = p + 1;
      } else if (tag === ITEM.pickup) {
        const p = r.readBits(PICK_INDEX_BITS);
        ensurePickups(f, p + 1);
        this.decodePooled(r, PICKUP_SLOTS, f.pick, p);
        if (p + 1 > f.pickCount) f.pickCount = p + 1;
      } else {
        const n = f.glob.length;
        for (let c = 0; c < n; c += GLOBAL_CHUNK) {
          if (r.readBits(1) === 0) continue;
          const end = Math.min(n, c + GLOBAL_CHUNK);
          for (let k = c; k < end; k++) {
            if (r.readBits(1) === 1) f.glob[k] = readSlot(r, globals, k, f.glob[k]!);
          }
        }
      }
    }
  }

  private decodePooled(r: BitReader, t: SlotCodecs, data: Int32Array, p: number): void {
    const o = p * t.count;
    for (let j = 0; j < t.count; j++) {
      if (r.readBits(1) === 1) data[o + j] = readSlot(r, t, j, data[o + j]!);
    }
  }
}
