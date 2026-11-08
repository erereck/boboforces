import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { checkRomfs, formatRomfs, placeholderReason } from './romfs.ts';

const png = (w: number, h: number): Uint8Array => {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const v = new DataView(b.buffer);
  v.setUint32(16, w);
  v.setUint32(20, h);
  return b;
};
const text = (s: string): Uint8Array => new TextEncoder().encode(s);
const mp3 = (zeros: number, total: number): Uint8Array => {
  const b = new Uint8Array(total).fill(0x55);
  b.fill(0, 0, zeros);
  return b;
};

describe('RomFS: provisórios da etapa de contratos', () => {
  it('reconhece JSON com placeholder, PNG 1×1, MP3 de silêncio e binário com versão 0', () => {
    expect(placeholderReason('a.json', text('{"placeholder": true}'))).toMatch('placeholder');
    expect(placeholderReason('a.json', text('{"format": "x"}'))).toBeNull();
    expect(placeholderReason('a.png', png(1, 1))).toBe('PNG 1×1');
    expect(placeholderReason('a.png', png(64, 4096))).toBeNull();
    expect(placeholderReason('a.mp3', mp3(940, 1000))).toBe('MP3 de silêncio');
    expect(placeholderReason('a.mp3', mp3(80, 1000))).toBeNull();
    const fake = deflateRawSync(Buffer.from('BFMP\0\0PROVISORIO: rode npm run assets'));
    expect(placeholderReason('maps/x.bfmap', new Uint8Array(fake))).toMatch('provisório');
    expect(placeholderReason('maps/x.bfmap', new Uint8Array([0x42, 0x46, 0x4d, 0x50, 1, 0]))).toBeNull();
  });
});

describe('RomFS: assets do runtime-assets.json e orçamento', () => {
  it('lista o que falta, o que é provisório e os maiores; acima do teto reprova', () => {
    const romfs = new Map<string, Uint8Array>([
      ['main.js', new Uint8Array(3000)],
      ['assets/fonts/ui.png', png(256, 256)],
      ['assets/audio/t0-tiro.mp3', mp3(10, 500)],
      ['assets/maps/construto.bfmap', new Uint8Array(deflateRawSync(Buffer.from('BFMP\0\0PROVISORIO')))],
    ]);
    const r = checkRomfs(
      romfs,
      ['fonts/ui.png', 'audio/t0-tiro.mp3', 'maps/construto.bfmap', 'models/x.bfmodel'],
      3500,
    );
    expect(r.missing).toEqual(['models/x.bfmodel']);
    expect(r.placeholders).toEqual(['maps/construto.bfmap: binário provisório (versão 0)']);
    expect(r.mainBytes).toBe(3000);
    expect(r.largest[0]).toEqual({ path: 'main.js', bytes: 3000 });
    expect(r.overBudget).toBe(true);
    const lines = formatRomfs(r);
    expect(lines[0]).toMatch(/^RomFS: 4 arquivo\(s\), .* ACIMA DO ORÇAMENTO$/);
    expect(lines).toContain('  falta no RomFS: assets/models/x.bfmodel (runtime-assets.json)');
    expect(checkRomfs(romfs, ['fonts/ui.png']).overBudget).toBe(false);
  });
});
