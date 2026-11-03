import { clamp, type BitReader, type BitWriter } from '@boboforces/shared';
import { FRAME_BUTTON_BITS } from './actions.ts';

/**
 * Entrada de UM controlador para UM tick da sim (tecnico.md §10). Igual para humano, bot, replay e rede.
 *
 * - `yaw`/`pitch` são ABSOLUTOS e quantizados (`yawToU16`/`pitchToI16` do shared): a câmera aplica a mira em todo
 *   frame de render e o tick só lê o último valor, sem latência extra mesmo a 30 Hz.
 * - `weapon` é o slot DESEJADO, absoluto. A sim age na borda (quando o valor muda), então repetir o frame é seguro.
 * - Objetos mutáveis e reaproveitados: crie com `createInputFrame()` fora do laço e reescreva a cada tick.
 */
export interface InputFrame {
  /** u16, cresce 1 por tick e dá a volta; a rede reconcilia por ele. */
  seq: number;
  /** Bits de `BUTTON`. */
  buttons: number;
  /** i8 em [-127, 127]; positivo = direita. */
  moveX: number;
  /** i8 em [-127, 127]; positivo = frente. */
  moveY: number;
  /** u16: 0..65535 cobre uma volta (yaw 0 olha para -Z). */
  yaw: number;
  /** i16 em [-32767, 32767] = [-π/2, π/2]; positivo olha para cima. */
  pitch: number;
  /** u8: slot de arma desejado (0 = primária, 1 = pistola, 2 = faca, 3 = granada…). */
  weapon: number;
}

/** Tamanho serializado: seq 16 + botões 16 + move 8+8 + yaw 16 + pitch 16 + arma 8 = 88 bits (11 bytes). */
export const INPUT_FRAME_BITS = 16 + FRAME_BUTTON_BITS + 8 + 8 + 16 + 16 + 8;

export const MOVE_AXIS_MAX = 127;

export function createInputFrame(): InputFrame {
  return { seq: 0, buttons: 0, moveX: 0, moveY: 0, yaw: 0, pitch: 0, weapon: 0 };
}

/** Zera tudo menos `seq`, `yaw`, `pitch` e `weapon` (que são absolutos e persistem entre ticks). */
export function clearInputFrameButtons(f: InputFrame): void {
  f.buttons = 0;
  f.moveX = 0;
  f.moveY = 0;
}

export function copyInputFrame(dst: InputFrame, src: Readonly<InputFrame>): InputFrame {
  dst.seq = src.seq;
  dst.buttons = src.buttons;
  dst.moveX = src.moveX;
  dst.moveY = src.moveY;
  dst.yaw = src.yaw;
  dst.pitch = src.pitch;
  dst.weapon = src.weapon;
  return dst;
}

export function hasButton(f: Readonly<InputFrame>, bit: number): boolean {
  return (f.buttons & bit) !== 0;
}

/** Eixo analógico em [-1, 1] → i8 em [-127, 127]. */
export function quantizeAxis(v: number): number {
  return Math.round(clamp(v, -1, 1) * MOVE_AXIS_MAX);
}

/** i8 → eixo em [-1, 1]. */
export function dequantizeAxis(q: number): number {
  return clamp(q, -MOVE_AXIS_MAX, MOVE_AXIS_MAX) / MOVE_AXIS_MAX;
}

export function writeInputFrame(w: BitWriter, f: Readonly<InputFrame>): void {
  w.writeBits(f.seq, 16);
  w.writeBits(f.buttons, FRAME_BUTTON_BITS);
  w.writeInt(f.moveX, 8);
  w.writeInt(f.moveY, 8);
  w.writeBits(f.yaw, 16);
  w.writeInt(f.pitch, 16);
  w.writeBits(f.weapon, 8);
}

export function readInputFrame(r: BitReader, out: InputFrame): InputFrame {
  out.seq = r.readBits(16);
  out.buttons = r.readBits(FRAME_BUTTON_BITS);
  out.moveX = r.readInt(8);
  out.moveY = r.readInt(8);
  out.yaw = r.readBits(16);
  out.pitch = r.readInt(16);
  out.weapon = r.readBits(8);
  return out;
}
