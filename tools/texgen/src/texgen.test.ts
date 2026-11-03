import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BLOCK_TEXTURES } from '../../../assets-src/textures/blocks16.ts';
import { buildManifest, buildOutputs, buildStrip, generateLayers, validateLayers } from './generate.ts';
import { createImage, createPaint } from './paint.ts';
import { hue, inPalette, luma, PALETTE, RAMPS, ramp, saturation } from './palette.ts';
import { decodePng } from './png.ts';
import { validateTexture } from './validate.ts';

const generatedDir = resolve(import.meta.dirname, '../../../assets-src/textures/generated');

/** Distância circular do matiz até o amarelo (60°). */
const toYellow = (rgb: number): number => {
  const d = Math.abs(hue(rgb) - 60) % 360;
  return d > 180 ? 360 - d : d;
};

describe('paleta mestra', () => {
  it('tem 64 cores sem repetição', () => {
    expect(PALETTE.length).toBe(64);
    expect(new Set(PALETTE).size).toBe(64);
  });

  it('rampas vão do escuro para o claro', () => {
    for (const r of RAMPS) {
      if (r.use === 'time' || r.use === 'emissivo') continue;
      for (let i = 1; i < r.colors.length; i++)
        expect(luma(r.colors[i]!), r.name).toBeGreaterThan(luma(r.colors[i - 1]!));
    }
  });

  it('reserva de saturação: cenário até ~60%, acentos até ~70%, times acima de todo o cenário', () => {
    // Times: croma (max − min do RGB) acima de qualquer cor de cenário; o roxo D é vivo mas tem saturação HSV baixa.
    const chroma = (c: number): number =>
      Math.max(c >> 16, (c >> 8) & 0xff, c & 0xff) - Math.min(c >> 16, (c >> 8) & 0xff, c & 0xff);
    const sceneryMax = Math.max(...RAMPS.filter((r) => r.use === 'cenario').flatMap((r) => r.colors.map(chroma)));
    for (const r of RAMPS) {
      for (const c of r.colors) {
        if (r.use === 'cenario') expect(saturation(c), `${r.name} #${c.toString(16)}`).toBeLessThanOrEqual(0.62);
        if (r.use === 'acento') expect(saturation(c), `${r.name} #${c.toString(16)}`).toBeLessThanOrEqual(0.7);
        if (r.use === 'time') expect(chroma(c), `${r.name} #${c.toString(16)}`).toBeGreaterThan(sceneryMax + 20);
      }
    }
  });

  it('hue shift: o tom escuro fica mais longe do amarelo que o claro', () => {
    for (const r of RAMPS) {
      if (r.use !== 'cenario') continue;
      expect(toYellow(r.colors[0]!), r.name).toBeGreaterThanOrEqual(toYellow(r.colors[r.colors.length - 1]!));
    }
  });

  it('preto puro existe só na rampa neutra', () => {
    for (const r of RAMPS) if (r.name !== 'neutro') expect(r.colors).not.toContain(0x000000);
    expect(ramp('neutro')).toContain(0x000000);
  });
});

describe('validador', () => {
  const solid = (rgb: number): ReturnType<typeof createImage> => {
    const img = createImage(16);
    createPaint(img, 'teste').fill(rgb);
    return img;
  };

  it('aceita camada só com cores da paleta', () => {
    expect(validateTexture('ok', solid(ramp('concreto')[2]!), { size: 16, kind: 'opaque' })).toEqual([]);
  });

  it('reprova cor fora da paleta, alfa parcial, buraco em opaco e tamanho errado', () => {
    const off = solid(0x123456);
    expect(validateTexture('x', off, { size: 16, kind: 'opaque' })[0]).toMatch(/fora da paleta.*#123456/);

    const partial = solid(ramp('grama')[1]!);
    partial.data[3] = 128;
    expect(validateTexture('x', partial, { size: 16, kind: 'cutout' }).join()).toMatch(/alfa parcial/);

    const hole = solid(ramp('grama')[1]!);
    createPaint(hole, 'teste').clear(3, 3);
    expect(validateTexture('x', hole, { size: 16, kind: 'opaque' }).join()).toMatch(/transparente/);
    expect(validateTexture('x', hole, { size: 16, kind: 'cutout' })).toEqual([]);

    expect(validateTexture('x', createImage(32), { size: 16, kind: 'opaque' }).join()).toMatch(/32×32/);
  });
});

describe('texturas de bloco', () => {
  it('todas as receitas passam no validador', () => {
    const layers = generateLayers();
    expect(layers.map((l) => l.name)).toEqual([
      'concrete',
      'metal',
      'wood',
      'grass',
      'grass_side',
      'dirt',
      'brick',
      'test_floor',
    ]);
    expect(validateLayers(layers)).toEqual([]);
    for (const l of layers) {
      for (let i = 0; i < l.image.data.length; i += 4) {
        const d = l.image.data;
        expect(inPalette((d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]!)).toBe(true);
      }
    }
  });

  it('cada textura usa pelo menos 3 tons (não é chapada) e é determinística', () => {
    const a = generateLayers();
    const b = generateLayers();
    a.forEach((l, i) => {
      expect(l.image.data).toEqual(b[i]!.image.data);
      const colors = new Set<number>();
      for (let p = 0; p < l.image.data.length; p += 4)
        colors.add((l.image.data[p]! << 16) | (l.image.data[p + 1]! << 8) | l.image.data[p + 2]!);
      expect(colors.size, l.name).toBeGreaterThanOrEqual(3);
    });
  });

  it('a tira vertical tem as camadas na ordem do manifesto', () => {
    const layers = generateLayers();
    const strip = buildStrip(layers);
    expect(strip.width).toBe(16);
    expect(strip.height).toBe(16 * layers.length);
    expect(strip.data.subarray(16 * 16 * 4 * 3, 16 * 16 * 4 * 4)).toEqual(layers[3]!.image.data);
    expect(buildManifest(layers).layers[3]!.name).toBe('grass');
  });

  it('receita repetida ou com nome inválido é recusada', () => {
    expect(() => generateLayers([BLOCK_TEXTURES[0]!, BLOCK_TEXTURES[0]!])).toThrow(/repetida/);
    expect(() => generateLayers([{ ...BLOCK_TEXTURES[0]!, name: 'Concreto' }])).toThrow(/inválido/);
  });

  it('os arquivos em assets-src/textures/generated estão em dia (rode "npm run texgen" se falhar)', () => {
    const files = buildOutputs();
    for (const [rel, bytes] of files) {
      const path = join(generatedDir, rel);
      expect(existsSync(path), rel).toBe(true);
      expect(Buffer.compare(readFileSync(path), bytes), rel).toBe(0);
    }
  });

  it('os PNGs gravados decodificam e passam no validador', () => {
    const manifest = JSON.parse(readFileSync(join(generatedDir, 'blocos16.json'), 'utf8')) as ReturnType<
      typeof buildManifest
    >;
    const strip = decodePng(readFileSync(join(generatedDir, 'blocos16.png')));
    expect(strip.height).toBe(16 * manifest.layers.length);
    manifest.layers.forEach((layer, i) => {
      const img = decodePng(readFileSync(join(generatedDir, 'blocks', `${layer.name}.png`)));
      expect(validateTexture(layer.name, img, { size: 16, kind: layer.kind })).toEqual([]);
      expect(img.data).toEqual(strip.data.subarray(i * 1024, (i + 1) * 1024));
    });
  });
});
