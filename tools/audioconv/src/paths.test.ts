import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { AUDIO_OUT_DIR, ROOT, SOUND_TABLE, T0_SOUNDS } from './paths.ts';
import { processPcm } from './process.ts';
import { parseSoundTable, readSoundTable } from './sounds.ts';

describe('audioconv: tabela e licenças', () => {
  it('os sons do T0 estão cadastrados no runtime-assets.json', () => {
    const table = JSON.parse(readFileSync(join(ROOT, 'assets-src', 'runtime-assets.json'), 'utf8')) as {
      files: Record<string, string>;
    };
    for (const name of T0_SOUNDS) expect(table.files[`audio/${name}.mp3`]).toBe(`audio/generated/${name}.mp3`);
  });

  it('sounds.json cobre os 4 sons do T0 (e os do jogo, fase 7a), com original e License.txt CC0 ao lado', () => {
    const t = readSoundTable(SOUND_TABLE);
    expect(t.sounds.map((s) => s.out)).toEqual(expect.arrayContaining([...T0_SOUNDS]));
    for (const pack of Object.values(t.packs)) {
      expect(pack.license).toMatch(/CC0/);
      expect(pack.url).toMatch(/^https:\/\/kenney\.nl\/assets\//);
    }
  });

  it('os MP3 gerados são de verdade (não o provisório de silêncio): quadros MPEG-1 Layer III mono', () => {
    for (const name of readSoundTable(SOUND_TABLE).sounds.map((s) => s.out)) {
      const bytes = readFileSync(join(AUDIO_OUT_DIR, `${name}.mp3`));
      // O clique de sem munição tem 9 ms (0,6 KB); os do T0 passam de 1 KB.
      expect(bytes.length, name).toBeGreaterThan((T0_SOUNDS as readonly string[]).includes(name) ? 1000 : 500);
      // Silêncio do LAME é quase só byte zero (~94%); som de verdade fica abaixo de 15%.
      let zeros = 0;
      for (const b of bytes) if (b === 0) zeros++;
      expect(zeros / bytes.length, `${name}: parece o provisório de silêncio`).toBeLessThan(0.5);
      expect(bytes[0], name).toBe(0xff);
      expect(bytes[1]! & 0xfe, name).toBe(0xfa);
      expect((bytes[3]! >> 6) & 3, `${name}: modo de canal`).toBe(3); // 3 = mono
    }
  });
});

describe('audioconv: validação da tabela (dados sintéticos)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'audioconv-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'p'));
  writeFileSync(join(dir, 'p', 'a.ogg'), 'x');
  const pack = { title: 'T', author: 'A', url: 'https://x', license: 'CC0 1.0', zipSha256: '0', downloaded: 'hoje' };
  const doc = (sounds: unknown[], license = 'CC0 1.0') =>
    JSON.stringify({ packs: { p: { ...pack, license } }, sounds });

  it('recusa licença que não é CC0, falta de License.txt, arquivo ausente e nome repetido', () => {
    const ok = { out: 's', pack: 'p', file: 'a.ogg', maxS: 1, peakDb: -1 };
    expect(() => parseSoundTable(doc([ok]), dir)).toThrow('License.txt');
    writeFileSync(join(dir, 'p', 'License.txt'), 'CC0');
    expect(parseSoundTable(doc([ok]), dir).sounds).toHaveLength(1);
    expect(() => parseSoundTable(doc([ok], 'CC-BY 4.0'), dir)).toThrow('CC0');
    expect(() => parseSoundTable(doc([{ ...ok, file: 'b.ogg' }]), dir)).toThrow('falta source/p/b.ogg');
    expect(() => parseSoundTable(doc([ok, ok]), dir)).toThrow('repetida');
    expect(() => parseSoundTable(doc([{ ...ok, peakDb: 3 }]), dir)).toThrow('peakDb');
  });
});

describe('audioconv: tratamento do PCM', () => {
  it('corta o silêncio do começo, limita a duração com fade e normaliza o pico', () => {
    const rate = 1000;
    const pcm = new Float32Array(3000);
    for (let i = 500; i < 2500; i++) pcm[i] = 0.25 * Math.sin(i);
    const r = processPcm(pcm, { sampleRate: rate, maxS: 1, peakDb: -6 });
    expect(r.trimmedStartS).toBeCloseTo(0.499, 3);
    expect(r.cut).toBe(true);
    expect(r.pcm.length).toBe(1000);
    expect(r.pcm.at(-1)).toBe(0);
    let peak = 0;
    for (const s of r.pcm) peak = Math.max(peak, Math.abs(s));
    expect(peak).toBeCloseTo(10 ** (-6 / 20), 4);
    expect(() => processPcm(new Float32Array(10), { sampleRate: rate, maxS: 1, peakDb: -1 })).toThrow('silêncio');
  });
});
