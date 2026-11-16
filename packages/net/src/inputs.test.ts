import { BUTTON, createInputFrame, type InputFrame } from '@boboforces/input';
import { BitReader, BitWriter } from '@boboforces/shared';
import { describe, expect, it } from 'vitest';
import { InputHistory, RemoteInputBuffer } from './inputs.ts';
import { MSG, NO_TICK } from './protocol.ts';
import { createLoopback } from './transport.ts';

/** Frame `seq` com a mira = seq (dá para conferir qual chegou). */
function frameOf(seq: number, buttons = 0): InputFrame {
  const f = createInputFrame();
  f.seq = seq & 0xffff;
  f.yaw = seq & 0xffff;
  f.buttons = buttons;
  return f;
}

function message(history: InputHistory, ack = NO_TICK): BitReader {
  const w = new BitWriter(128);
  history.write(w, ack);
  const r = new BitReader(w.bytes().slice());
  expect(r.readBits(8)).toBe(MSG.input);
  return r;
}

describe('entradas do cliente (M5 fase 1)', () => {
  it('cada mensagem leva o novo e os 3 anteriores: perder 3 seguidas não perde frame', () => {
    const history = new InputHistory();
    const buf = new RemoteInputBuffer();
    const out = createInputFrame();
    const got: number[] = [];
    for (let seq = 1; seq <= 20; seq++) {
      history.push(frameOf(seq));
      // Perde as mensagens 5, 6 e 7 (a 8 traz 5..8).
      if (seq < 5 || seq > 7) buf.receive(message(history, 100 + seq));
      if (seq >= 8 || seq < 5) {
        buf.consume(out);
        got.push(out.yaw);
      }
    }
    // Do 1 ao 4 em dia; na 8 chegam 5..8 juntos e o host segue um por tick (até 3 esperando, sem pular).
    expect(got.slice(0, 4)).toEqual([1, 2, 3, 4]);
    expect(got.slice(4)).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect(buf.ackTick).toBe(120);
    expect(buf.lastConsumedSeq).toBe(17);
    expect(buf.stats.duplicates).toBeGreaterThan(0);
  });

  it('sem frame novo repete o último (o gatilho segue apertado); atrasado demais pula somando os botões', () => {
    const history = new InputHistory();
    const buf = new RemoteInputBuffer();
    const out = createInputFrame();
    history.push(frameOf(1, BUTTON.fire));
    buf.receive(message(history));
    buf.consume(out);
    buf.consume(out);
    expect([out.yaw, out.buttons]).toEqual([1, BUTTON.fire]);
    expect(buf.stats.starved).toBe(1);
    // 10 frames de uma vez (um toque de pulo no 3): o host não vira 10 ticks de atraso.
    for (let seq = 2; seq <= 11; seq++) {
      history.push(frameOf(seq, seq === 3 ? BUTTON.jump : 0));
      buf.receive(message(history));
    }
    buf.consume(out);
    expect(out.yaw).toBe(9);
    expect(out.buttons & BUTTON.jump).toBe(BUTTON.jump);
    buf.consume(out);
    expect([out.yaw, out.buttons]).toEqual([10, 0]);
    expect(buf.stats.skipped).toBeGreaterThan(0);
  });

  it('o seq dá a volta em 16 bits', () => {
    const history = new InputHistory();
    const buf = new RemoteInputBuffer();
    const out = createInputFrame();
    const got: number[] = [];
    for (let seq = 0xfffd; seq <= 0x10003; seq++) {
      history.push(frameOf(seq));
      buf.receive(message(history));
      buf.consume(out);
      got.push(out.yaw);
    }
    expect(got).toEqual([0xfffd, 0xfffe, 0xffff, 0, 1, 2, 3]);
  });
});

describe('loopback', () => {
  it('latência, perda e duplicação só no não confiável; o confiável chega sempre e em ordem', () => {
    const net = createLoopback({ seed: 5, latencyMs: 50, jitterMs: 30, loss: 0.2, duplicate: 0.05 });
    const a = net.endpoint(0);
    const b = net.endpoint(1);
    for (let i = 0; i < 200; i++) {
      a.send(1, 'reliable', Uint8Array.of(i));
      a.send(1, 'unreliable', Uint8Array.of(i));
    }
    const reliable: number[] = [];
    const unreliable: number[] = [];
    net.advance(49);
    b.poll(() => expect.unreachable('chegou antes da latência'));
    net.advance(40);
    b.poll((_from, channel, bytes) => (channel === 'reliable' ? reliable : unreliable).push(bytes[0]!));
    expect(reliable).toEqual(Array.from({ length: 200 }, (_, i) => i));
    expect(net.stats.dropped).toBeGreaterThan(20);
    expect(unreliable.length).toBe(200 - net.stats.dropped + net.stats.duplicated);
    // A variação reordena o não confiável.
    expect(unreliable.some((v, i) => i > 0 && v < unreliable[i - 1]!)).toBe(true);
    // Mesma semente, mesma perda.
    const again = createLoopback({ seed: 5, latencyMs: 50, jitterMs: 30, loss: 0.2, duplicate: 0.05 });
    for (let i = 0; i < 200; i++) {
      again.endpoint(0).send(1, 'reliable', Uint8Array.of(i));
      again.endpoint(0).send(1, 'unreliable', Uint8Array.of(i));
    }
    expect(again.stats.dropped).toBe(net.stats.dropped);
  });
});
