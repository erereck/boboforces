import { BitReader, BitWriter } from '@boboforces/shared';
import { WEAPONS } from '@boboforces/sim';
import { describe, expect, it } from 'vitest';
import {
  checkHello,
  compareGameVersions,
  localHello,
  MSG,
  PROTOCOL_VERSION,
  readHello,
  readReject,
  readWelcome,
  REJECT_REASON,
  seqDiff,
  SIM_CONTENT_TABLES,
  simContentHash,
  writeHello,
  writeReject,
  writeWelcome,
} from './protocol.ts';

function roundtrip(write: (w: BitWriter) => void): BitReader {
  const w = new BitWriter(256);
  write(w);
  return new BitReader(w.bytes().slice());
}

describe('protocolo (M5 fase 1)', () => {
  it('hello, welcome e recusa vão e voltam', () => {
    const hello = localHello();
    expect(hello.protocolVersion).toBe(PROTOCOL_VERSION);
    let r = roundtrip((w) => writeHello(w, hello));
    expect(r.readBits(8)).toBe(MSG.hello);
    expect(readHello(r)).toEqual(hello);
    r = roundtrip((w) => writeWelcome(w, { slot: 2, hz: 60, snapshotHz: 30 }));
    expect(r.readBits(8)).toBe(MSG.welcome);
    expect(readWelcome(r)).toEqual({ slot: 2, hz: 60, snapshotHz: 30 });
    r = roundtrip((w) => writeReject(w, REJECT_REASON.version, { ...hello, gameVersion: 'versão ✓ 1.2' }));
    expect(r.readBits(8)).toBe(MSG.reject);
    // Só ASCII visível na versão: o resto vira "?".
    expect(readReject(r)).toEqual({
      reason: REJECT_REASON.version,
      host: { ...hello, gameVersion: 'vers?o ? 1.2' },
    });
  });

  it('quem está na versão mais antiga atualiza; mesma versão com conteúdo outro = os dois', () => {
    const a = { protocolVersion: 1, gameVersion: '0.0.1', contentHash: 10 };
    expect(checkHello(a, a)).toBe('ok');
    expect(checkHello(a, { ...a, protocolVersion: 2 })).toBe('update-self');
    expect(checkHello({ ...a, protocolVersion: 2 }, a)).toBe('update-friend');
    expect(checkHello(a, { ...a, gameVersion: '0.1.0', contentHash: 11 })).toBe('update-self');
    expect(checkHello({ ...a, gameVersion: '0.1.0', contentHash: 11 }, a)).toBe('update-friend');
    expect(checkHello(a, { ...a, contentHash: 11 })).toBe('mismatch');
    // A versão sozinha não conta: mesmo conteúdo joga junto (correção de texto, de arte).
    expect(checkHello(a, { ...a, gameVersion: '0.0.2' })).toBe('ok');
    expect(compareGameVersions('0.0.10', '0.0.9')).toBe(1);
    expect(compareGameVersions('1.0', '1.0.0')).toBe(0);
    expect(compareGameVersions('0.2.0-dev', '0.10.0')).toBe(-1);
  });

  it('o hash do conteúdo é estável e muda com uma arma diferente', () => {
    expect(simContentHash()).toBe(simContentHash());
    const tables = SIM_CONTENT_TABLES.map((t) =>
      t === WEAPONS ? WEAPONS.map((w, i) => (i === 0 ? { ...w, damage: w.damage + 1 } : w)) : t,
    );
    expect(simContentHash(tables)).not.toBe(simContentHash());
  });

  it('seq de 16 bits compara com a volta', () => {
    expect(seqDiff(5, 3)).toBe(2);
    expect(seqDiff(3, 5)).toBe(-2);
    expect(seqDiff(1, 0xffff)).toBe(2);
    expect(seqDiff(0xffff, 1)).toBe(-2);
  });
});
