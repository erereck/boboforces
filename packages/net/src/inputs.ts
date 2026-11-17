import { copyInputFrame, createInputFrame, readInputFrame, writeInputFrame, type InputFrame } from '@boboforces/input';
import type { BitReader, BitWriter } from '@boboforces/shared';
import { MSG, NO_TICK, seqDiff } from './protocol.ts';

/**
 * Entradas do cliente (tecnico.md §13.3): uma mensagem por tick com o InputFrame novo e os 3 anteriores repetidos
 * (cobre a perda no canal não confiável), mais o último snapshot completo que o cliente tem (o "ack": a base do
 * próximo delta).
 */

/** Frames por mensagem: o novo + 3 repetidos. */
export const INPUT_REDUNDANCY = 4;

/**
 * Cliente: os últimos frames, do mais novo para o mais velho. Cada um leva o tick que o cliente mostrava dos outros
 * (fase 2d: o host volta o tiro até lá; -1 = nenhum snapshot ainda), nos 16 bits baixos.
 */
export class InputHistory {
  private readonly frames: InputFrame[] = Array.from({ length: INPUT_REDUNDANCY }, createInputFrame);
  private readonly views = new Int32Array(INPUT_REDUNDANCY).fill(-1);
  private head = 0;
  private size = 0;

  /** Guarda uma cópia do frame do tick. */
  push(f: Readonly<InputFrame>, viewTick = -1): void {
    this.head = (this.head + INPUT_REDUNDANCY - 1) % INPUT_REDUNDANCY;
    copyInputFrame(this.frames[this.head]!, f);
    this.views[this.head] = viewTick;
    if (this.size < INPUT_REDUNDANCY) this.size++;
  }

  /** Mensagem `MSG.input` com o ack e os frames guardados (o mais novo primeiro). */
  write(w: BitWriter, ackTick: number): void {
    w.writeBits(MSG.input, 8);
    w.writeBits(ackTick >>> 0, 32);
    w.writeBits(this.size, 3);
    for (let i = 0; i < this.size; i++) {
      const k = (this.head + i) % INPUT_REDUNDANCY;
      writeInputFrame(w, this.frames[k]!);
      const view = this.views[k]!;
      w.writeBits(view >= 0 ? 1 : 0, 1);
      w.writeBits(view >= 0 ? view & 0xffff : 0, 16);
    }
  }
}

/** Tamanho da fila do host por cliente (em `seq`). */
const BUFFER = 64;
/** Com mais que isto esperando (além do da vez), o host pula para perto do mais novo (a fila não vira atraso). */
const MAX_WAITING = 3;
/** Ticks repetindo o último frame antes de soltar movimento e botões (aba em segundo plano, conexão parada). */
const STARVE_HOLD = 8;
/** Quantos deixa esperando depois de pular. */
const KEEP_WAITING = 2;

export interface RemoteInputStats {
  received: number;
  /** Frames que chegaram depois de usados ou repetidos (a redundância cobriu). */
  duplicates: number;
  /** Ticks sem frame novo (repetiu o último). */
  starved: number;
  /** Frames pulados: perdidos de vez ou para alcançar o mais novo. */
  skipped: number;
}

/**
 * Host: a fila de entradas de um cliente. Consome um frame por tick na ordem do `seq`; frame que não chegou e já tem
 * um mais novo é dado como perdido; sem nenhum novo, repete o último (segurar o gatilho continua segurando). Ao pular
 * frames para alcançar, os botões deles somam no próximo (um toque de pulo não se perde).
 */
export class RemoteInputBuffer {
  private readonly ring: InputFrame[] = Array.from({ length: BUFFER }, createInputFrame);
  private readonly seqs = new Int32Array(BUFFER).fill(-1);
  private readonly views = new Int32Array(BUFFER).fill(-1);
  private readonly scratch = createInputFrame();
  private readonly last = createInputFrame();
  private next = -1;
  private newest = -1;
  private lastSeq = -1;
  private carry = 0;
  private starvedRun = 0;
  /** O snapshot completo mais novo que o cliente disse ter. */
  ackTick = NO_TICK;
  readonly stats: RemoteInputStats = { received: 0, duplicates: 0, starved: 0, skipped: 0 };

  /** O tick que o cliente mostrava no último frame usado (16 bits baixos; -1 = nenhum): a volta do tiro (fase 2d). */
  lastView = -1;

  /**
   * M5 (fase 5a): entradas de verdade que chegaram (contador: algo apertado, andando ou a mira mexendo). Parado ou com
   * a aba escondida, não sobe: é por ele que o host vê o AFK (e a volta, mesmo com um bot no lugar e a fila sem ler).
   */
  activeReceived = 0;
  private recvYaw = 0;
  private recvPitch = 0;

  /** Último `seq` usado (-1 = nenhum): vai no snapshot para o cliente reconciliar (fase 2). */
  get lastConsumedSeq(): number {
    return this.lastSeq;
  }

  /** Corpo de uma `MSG.input` (o tipo já foi lido). */
  receive(r: BitReader): void {
    const ack = r.readBits(32);
    if (ack !== NO_TICK && (this.ackTick === NO_TICK || ack > this.ackTick)) this.ackTick = ack;
    const n = r.readBits(3);
    for (let i = 0; i < n; i++) {
      const f = readInputFrame(r, this.scratch);
      const hasView = r.readBits(1);
      const view16 = r.readBits(16);
      const view = hasView === 1 ? view16 : -1;
      const seq = f.seq;
      if (f.buttons !== 0 || f.moveX !== 0 || f.moveY !== 0 || f.yaw !== this.recvYaw || f.pitch !== this.recvPitch) {
        this.activeReceived++;
      }
      this.recvYaw = f.yaw;
      this.recvPitch = f.pitch;
      if (this.lastSeq >= 0 && seqDiff(seq, this.lastSeq) <= 0) {
        this.stats.duplicates++;
        continue;
      }
      const k = seq & (BUFFER - 1);
      if (this.seqs[k] === seq) {
        this.stats.duplicates++;
        continue;
      }
      copyInputFrame(this.ring[k]!, f);
      this.views[k] = view;
      this.seqs[k] = seq;
      this.stats.received++;
      if (this.newest < 0 || seqDiff(seq, this.newest) > 0) this.newest = seq;
      if (this.next < 0 || seqDiff(seq, this.next) < 0) {
        if (this.lastSeq < 0) this.next = seq;
      }
    }
  }

  /** Escreve em `out` a entrada deste tick do host. Sem nada recebido ainda, solta botões e movimento. */
  consume(out: InputFrame): void {
    if (this.next < 0) {
      out.buttons = 0;
      out.moveX = 0;
      out.moveY = 0;
      return;
    }
    // Atrasado demais: pula para perto do mais novo, somando os botões do que pulou.
    if (seqDiff(this.newest, this.next) > MAX_WAITING) {
      const target = (this.newest - KEEP_WAITING) & 0xffff;
      while (this.next !== target) {
        const k = this.next & (BUFFER - 1);
        if (this.seqs[k] === this.next) this.carry |= this.ring[k]!.buttons;
        this.stats.skipped++;
        this.next = (this.next + 1) & 0xffff;
      }
    }
    for (;;) {
      const k = this.next & (BUFFER - 1);
      if (this.seqs[k] === this.next) {
        copyInputFrame(this.last, this.ring[k]!);
        this.lastView = this.views[k]!;
        this.last.buttons |= this.carry;
        this.carry = 0;
        this.lastSeq = this.next;
        this.next = (this.next + 1) & 0xffff;
        this.starvedRun = 0;
        break;
      }
      if (seqDiff(this.newest, this.next) > 0) {
        // Perdido de vez (já chegou um mais novo e a redundância não trouxe este).
        this.stats.skipped++;
        this.next = (this.next + 1) & 0xffff;
        continue;
      }
      this.stats.starved++;
      // Parado de vez: o boneco para e solta o gatilho, mas a mira fica.
      if (++this.starvedRun > STARVE_HOLD) {
        this.last.buttons = 0;
        this.last.moveX = 0;
        this.last.moveY = 0;
      }
      break;
    }
    copyInputFrame(out, this.last);
  }
}
