import { describe, expect, it } from 'vitest';
import { encodeMp3 } from './mp3.ts';

describe('encodeMp3 (lamejs)', () => {
  it('gera quadros MPEG-1 Layer III válidos e é determinístico', () => {
    const pcm = new Float32Array(44100 / 4);
    for (let i = 0; i < pcm.length; i++) pcm[i] = Math.sin((i / 44100) * 2 * Math.PI * 440) * 0.5;
    const a = encodeMp3(pcm);
    const b = encodeMp3(pcm);
    expect(a.length).toBeGreaterThan(200);
    expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).toBe(0);
    // Cabeçalho de quadro: sync de 11 bits (0xFFE) + MPEG-1 (bits 11) + Layer III (01).
    expect(a[0]).toBe(0xff);
    expect(a[1]! & 0xfe).toBe(0xfa);
  });
});
