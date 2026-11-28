import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  bleedTransparent,
  buildLayerMipChain,
  createLayerMipScratch,
  LAYER_MIP_FILTER,
  layerCoverage,
  linearToSrgb,
  mipSize,
  srgbToLinearTable,
  writeLayerMipChain,
  writeStripMips,
  type LayerMipFilter,
} from './layer-mips.ts';
import { mipChainOffsets, parseLayerManifest, TEXTURE_ARRAYS, type LayerKind } from './layers.ts';
import { decodePng } from './png/decode.ts';
import type { RgbaImage } from './png/types.ts';

// --- Referência: o código que gravava os `.mips.png` até o M11, copiado como estava (texgen `mips.ts` e skingen
// `strip.ts`). O runtime precisa sair byte a byte igual a ele (ARCHITECTURE §23.9). ---

const REF_TO_LINEAR: readonly number[] = Array.from({ length: 256 }, (_, i) => {
  const c = i / 255;
  const lin = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  return Math.round(lin * 1_000_000);
});

function refToSrgb(linear: number): number {
  let lo = 0;
  let hi = 255;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (REF_TO_LINEAR[mid]! < linear) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && linear - REF_TO_LINEAR[lo - 1]! <= REF_TO_LINEAR[lo]! - linear) return lo - 1;
  return lo;
}

function refBleed(image: RgbaImage): RgbaImage {
  const { width: w, height: h } = image;
  const data = new Uint8Array(image.data);
  let known = new Uint8Array(w * h);
  let pending = 0;
  for (let i = 0; i < w * h; i++) {
    if (data[i * 4 + 3]! > 0) known[i] = 1;
    else pending++;
  }
  if (pending === w * h) return { width: w, height: h, data };
  while (pending > 0) {
    const next = new Uint8Array(known);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (known[i]) continue;
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const j = ((y + dy + h) % h) * w + ((x + dx + w) % w);
            if (!known[j]) continue;
            r += REF_TO_LINEAR[data[j * 4]!]!;
            g += REF_TO_LINEAR[data[j * 4 + 1]!]!;
            b += REF_TO_LINEAR[data[j * 4 + 2]!]!;
            n++;
          }
        }
        if (n === 0) continue;
        data[i * 4] = refToSrgb(r / n);
        data[i * 4 + 1] = refToSrgb(g / n);
        data[i * 4 + 2] = refToSrgb(b / n);
        next[i] = 1;
        pending--;
      }
    }
    known = next;
  }
  return { width: w, height: h, data };
}

function refCoverage(image: RgbaImage): number {
  let visible = 0;
  const n = image.width * image.height;
  for (let i = 0; i < n; i++) if (image.data[i * 4 + 3]! >= 128) visible++;
  return visible / n;
}

const REF_BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5] as const;

function refApplyCoverage(data: Uint8Array, cover: Float64Array, side: number, target: number): void {
  const n = cover.length;
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => {
    const dc = cover[b]! - cover[a]!;
    if (dc !== 0) return dc;
    const ba = REF_BAYER4[((a / side) & 3) * 4 + ((a % side) & 3)]!;
    const bb = REF_BAYER4[((b / side) & 3) * 4 + ((b % side) & 3)]!;
    return ba !== bb ? ba - bb : a - b;
  });
  const keep = Math.round(target * n);
  let threshold = 0;
  for (let k = keep - 1; k >= 0 && threshold === 0; k--) threshold = cover[order[k]!]!;
  const scale = threshold > 0 ? 0.5 / threshold : 0;
  order.forEach((i, rank) => {
    const c = cover[i]!;
    const a = Math.min(255, Math.round(c * scale * 255));
    data[i * 4 + 3] = c > 0 && rank < keep ? Math.max(128, a) : Math.min(127, a);
  });
}

/** texgen `buildMipChain` (filtro `linear`). */
function refLinearChain(image: RgbaImage, kind: LayerKind, levels: number): RgbaImage[] {
  const size = image.width;
  const src = kind === 'cutout' ? refBleed(image) : image;
  const d = src.data;
  const out: RgbaImage[] = [];
  const opaqueCoverage = kind === 'cutout' ? refCoverage(image) : 1;
  for (let level = 1; level < levels; level++) {
    const side = Math.max(1, size >> level);
    const f = size / side;
    const data = new Uint8Array(side * side * 4);
    const cover = new Float64Array(side * side);
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) {
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        let vr = 0;
        let vg = 0;
        let vb = 0;
        let visible = 0;
        for (let yy = 0; yy < f; yy++) {
          for (let xx = 0; xx < f; xx++) {
            const i = ((y * f + yy) * size + x * f + xx) * 4;
            const alpha = d[i + 3]!;
            const lr = REF_TO_LINEAR[d[i]!]!;
            const lg = REF_TO_LINEAR[d[i + 1]!]!;
            const lb = REF_TO_LINEAR[d[i + 2]!]!;
            if (kind === 'translucent') {
              r += lr * alpha;
              g += lg * alpha;
              b += lb * alpha;
            } else {
              r += lr;
              g += lg;
              b += lb;
            }
            a += alpha;
            if (alpha >= 128) {
              vr += lr;
              vg += lg;
              vb += lb;
              visible++;
            }
          }
        }
        const n = f * f;
        const o = (y * side + x) * 4;
        if (kind === 'translucent') {
          const w = a > 0 ? a : 1;
          data[o] = refToSrgb(r / w);
          data[o + 1] = refToSrgb(g / w);
          data[o + 2] = refToSrgb(b / w);
          data[o + 3] = Math.round(a / n);
        } else if (kind === 'cutout') {
          const k = visible > 0 ? visible : n;
          data[o] = refToSrgb((visible > 0 ? vr : r) / k);
          data[o + 1] = refToSrgb((visible > 0 ? vg : g) / k);
          data[o + 2] = refToSrgb((visible > 0 ? vb : b) / k);
          cover[y * side + x] = visible / n;
        } else {
          data[o] = refToSrgb(r / n);
          data[o + 1] = refToSrgb(g / n);
          data[o + 2] = refToSrgb(b / n);
          data[o + 3] = 255;
        }
      }
    }
    if (kind === 'cutout') refApplyCoverage(data, cover, side, opaqueCoverage);
    out.push({ width: side, height: side, data });
  }
  return out;
}

interface RefFloat {
  readonly size: number;
  readonly data: Float64Array;
}

function refToFloat(image: RgbaImage): RefFloat {
  const data = new Float64Array(image.width * image.height * 4);
  for (let i = 0; i < data.length; i += 4) {
    const a = image.data[i + 3]! / 255;
    data[i] = (image.data[i]! / 255) * a;
    data[i + 1] = (image.data[i + 1]! / 255) * a;
    data[i + 2] = (image.data[i + 2]! / 255) * a;
    data[i + 3] = a;
  }
  return { size: image.width, data };
}

function refDownsample(src: RefFloat): RefFloat {
  const size = Math.max(1, src.size >> 1);
  const data = new Float64Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      for (let c = 0; c < 4; c++) {
        let sum = 0;
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const sx = Math.min(src.size - 1, x * 2 + dx);
            const sy = Math.min(src.size - 1, y * 2 + dy);
            sum += src.data[(sy * src.size + sx) * 4 + c]!;
          }
        }
        data[(y * size + x) * 4 + c] = sum / 4;
      }
    }
  }
  return { size, data };
}

function refFloatCoverage(alpha: ArrayLike<number>, threshold: number, count: number): number {
  let n = 0;
  for (let i = 0; i < count; i++) if (alpha[i * 4 + 3]! >= threshold) n++;
  return n / count;
}

function refToRgba(level: RefFloat, cutout: boolean, targetCoverage: number): RgbaImage {
  const out = { width: level.size, height: level.size, data: new Uint8Array(level.size * level.size * 4) };
  const n = level.size * level.size;
  let threshold = 0.5;
  if (cutout) {
    let best = Infinity;
    for (let t = 1; t <= 255; t++) {
      const err = Math.abs(refFloatCoverage(level.data, t / 255, n) - targetCoverage);
      if (err < best - 1e-9) {
        best = err;
        threshold = t / 255;
      }
    }
  }
  for (let i = 0; i < n; i++) {
    const a = level.data[i * 4 + 3]!;
    const o = i * 4;
    const visible = cutout ? a >= threshold && a > 0 : true;
    if (a > 0) {
      out.data[o] = Math.round((level.data[o]! / a) * 255);
      out.data[o + 1] = Math.round((level.data[o + 1]! / a) * 255);
      out.data[o + 2] = Math.round((level.data[o + 2]! / a) * 255);
    }
    out.data[o + 3] = cutout ? (visible ? 255 : 0) : Math.round(a * 255);
  }
  return out;
}

/** skingen `mipLevels` (filtro `premultiplied`, o do modelgen). */
function refPremultipliedChain(image: RgbaImage, levels: number, cutout: boolean): RgbaImage[] {
  const n = image.width * image.height;
  let opaque = 0;
  for (let i = 0; i < n; i++) if (image.data[i * 4 + 3]! >= 128) opaque++;
  const target = opaque / n;
  const out: RgbaImage[] = [];
  let current = refToFloat(image);
  for (let level = 1; level < levels; level++) {
    current = refDownsample(current);
    out.push(refToRgba(current, cutout, target));
  }
  return out;
}

function refChain(filter: LayerMipFilter, image: RgbaImage, kind: LayerKind, cutout: boolean, levels: number) {
  return filter === 'linear' ? refLinearChain(image, kind, levels) : refPremultipliedChain(image, levels, cutout);
}

// --- Camadas sintéticas ---

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function blank(size: number): RgbaImage {
  return { width: size, height: size, data: new Uint8Array(size * size * 4) };
}

function px(img: RgbaImage, x: number, y: number, rgb: number, a = 255): void {
  const o = (y * img.width + x) * 4;
  img.data[o] = (rgb >> 16) & 0xff;
  img.data[o + 1] = (rgb >> 8) & 0xff;
  img.data[o + 2] = rgb & 0xff;
  img.data[o + 3] = a;
}

const rgbAt = (img: RgbaImage, i: number): number =>
  (img.data[i * 4]! << 16) | (img.data[i * 4 + 1]! << 8) | img.data[i * 4 + 2]!;

/** Padrões de alfa que exercitam os ramos: opaco, ruído, cerca de 1 px, metade, vazio, folhagem, alfa parcial. */
const PATTERNS = ['opaco', 'ruido', 'cerca', 'metade', 'vazio', 'folhas', 'parcial', 'um-texel'] as const;

function synthetic(size: number, pattern: (typeof PATTERNS)[number], seed: number): RgbaImage {
  const img = blank(size);
  const rand = lcg(seed);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const rgb = Math.floor(rand() * 0x1000000);
      let a = 255;
      if (pattern === 'ruido') a = rand() < 0.5 ? 255 : 0;
      else if (pattern === 'cerca') a = (x + y) % 8 === 0 || (x - y + size) % 8 === 0 ? 255 : 0;
      else if (pattern === 'metade') a = y >= size / 2 ? 255 : 0;
      else if (pattern === 'vazio') a = 0;
      else if (pattern === 'folhas') a = (x * 7 + y * 13) % 5 < 2 || rand() < 0.15 ? 255 : 0;
      else if (pattern === 'parcial') a = Math.floor(rand() * 256);
      else if (pattern === 'um-texel') a = x === 3 && y === 5 ? 255 : 0;
      px(img, x, y, rgb, a);
    }
  }
  return img;
}

const KINDS: readonly LayerKind[] = ['opaque', 'cutout', 'translucent', 'emissive'];

describe('mips das camadas (M12: gerados no carregamento)', () => {
  it('a tabela sRGB → linear é a das ferramentas e tem folga até a borda do arredondamento', () => {
    expect([...srgbToLinearTable()]).toEqual(REF_TO_LINEAR);
    // Qualquer `pow` com erro de alguns ulp dá a mesma tabela: o valor antes do arredondamento fica longe de x,5.
    let margin = 1;
    for (let i = 0; i < 256; i++) {
      const c = i / 255;
      const v = (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4) * 1_000_000;
      margin = Math.min(margin, Math.abs(v - Math.floor(v) - 0.5));
    }
    expect(margin).toBeGreaterThan(1e-5);
  });

  it('a volta linear → sRGB por faixas dá o byte da busca binária das ferramentas', () => {
    // Todos os inteiros e meio-inteiros (os pontos médios e os empates exatos) e frações r/n de vários denominadores.
    for (let v = 0; v <= 1_000_000; v += 0.5) {
      if (linearToSrgb(v) !== refToSrgb(v)) expect(linearToSrgb(v), String(v)).toBe(refToSrgb(v));
    }
    const rand = lcg(7);
    for (let k = 0; k < 200_000; k++) {
      const n = 1 + Math.floor(rand() * 255 * 4096);
      const v = Math.floor(rand() * 1_000_000 * n) / n;
      if (linearToSrgb(v) !== refToSrgb(v)) expect(linearToSrgb(v), `${v} (n=${n})`).toBe(refToSrgb(v));
    }
    for (const n of [3, 5, 6, 7, 9]) {
      for (let r = 0; r <= 1_000_000 * n; r += 997) {
        if (linearToSrgb(r / n) !== refToSrgb(r / n)) expect(linearToSrgb(r / n), `${r}/${n}`).toBe(refToSrgb(r / n));
      }
    }
  });

  it('cada ferramenta tem o seu filtro', () => {
    expect(LAYER_MIP_FILTER).toEqual({ texgen: 'linear', modelgen: 'premultiplied' });
  });

  it('cadeia completa: 16 → 8, 4, 2, 1 e 64 → 32 … 1', () => {
    expect(buildLayerMipChain(blank(16), 5, 'linear', 'opaque').map((m) => m.width)).toEqual([8, 4, 2, 1]);
    expect(buildLayerMipChain(blank(64), 7, 'premultiplied', 'opaque').map((m) => m.width)).toEqual([
      32, 16, 8, 4, 2, 1,
    ]);
    expect(mipSize(16, 9)).toBe(1);
  });

  it('linear: cor chapada continua igual em todos os níveis (opaca com alfa 255)', () => {
    const img = blank(16);
    for (let i = 0; i < 256; i++) px(img, i % 16, i >> 4, 0x7d7f82);
    for (const mip of buildLayerMipChain(img, 5, 'linear', 'opaque')) {
      for (let i = 0; i < mip.width * mip.height; i++) {
        expect(rgbAt(mip, i)).toBe(0x7d7f82);
        expect(mip.data[i * 4 + 3]).toBe(255);
      }
    }
  });

  it('linear: preto + branco dá o cinza de 50% de luz (188), não 128', () => {
    const img = blank(16);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(img, x, y, (x + y) % 2 === 0 ? 0xffffff : 0);
    const [level1] = buildLayerMipChain(img, 2, 'linear', 'opaque');
    expect(level1!.data[0]).toBe(188);
  });

  it('linear: cutout preserva a cobertura do nível 0 (até o 2×2) e não pinta texel sem cobertura', () => {
    const fence = synthetic(16, 'cerca', 1);
    const c0 = layerCoverage(fence);
    const chain = buildLayerMipChain(fence, 5, 'linear', 'cutout');
    for (const mip of chain.slice(0, 3)) {
      const n = mip.width * mip.height;
      expect(Math.abs(layerCoverage(mip) - c0), `${mip.width}×${mip.width}`).toBeLessThanOrEqual(0.5 / n + 1e-9);
    }
    expect(layerCoverage(chain[1]!)).toBeGreaterThan(0);

    const half = synthetic(16, 'metade', 2);
    const [h1] = buildLayerMipChain(half, 2, 'linear', 'cutout');
    for (let x = 0; x < 8; x++) {
      expect(h1!.data[x * 4 + 3], 'linha de cima vazia').toBeLessThan(128);
      expect(h1!.data[(7 * 8 + x) * 4 + 3], 'linha de baixo cheia').toBeGreaterThanOrEqual(128);
    }
  });

  it('linear: a cor dos buracos da cutout puxa a dos vizinhos (sem franja preta no filtro entre níveis)', () => {
    const img = blank(16);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 8; x++) px(img, x, y, 0x4f7a3a);
    const bled = bleedTransparent(img);
    expect(bled.data[(5 * 16 + 12) * 4 + 3]).toBe(0);
    expect(rgbAt(bled, 5 * 16 + 12)).toBe(0x4f7a3a);
    expect(img.data[(5 * 16 + 12) * 4]).toBe(0);
  });

  it('linear: translúcida com alfa médio e cor ponderada pelo alfa', () => {
    const img = blank(16);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) px(img, x, y, x < 8 ? 0x6a7183 : 0xffffff, x < 8 ? 200 : 0);
    const [level1] = buildLayerMipChain(img, 2, 'linear', 'translucent');
    expect(level1!.data[3]).toBe(200);
    expect(rgbAt(level1!, 0)).toBe(0x6a7183);
    expect(level1!.data[(0 * 8 + 4) * 4 + 3]).toBe(0);
  });

  it('premultiplied: cutout binariza o alfa no limiar que mais aproxima a cobertura do nível 0', () => {
    const fence = synthetic(64, 'cerca', 3);
    const c0 = layerCoverage(fence);
    const chain = buildLayerMipChain(fence, 7, 'premultiplied', 'cutout');
    const plain = buildLayerMipChain(fence, 7, 'premultiplied', 'cutout', false);
    for (const mip of chain) for (let i = 3; i < mip.data.length; i += 4) expect([0, 255]).toContain(mip.data[i]);
    chain.forEach((mip, k) => {
      const err = Math.abs(layerCoverage(mip) - c0);
      expect(err, `nível ${k + 1}`).toBeLessThanOrEqual(Math.abs(layerCoverage(plain[k]!) - c0));
    });
  });

  for (const filter of ['linear', 'premultiplied'] as const) {
    it(`${filter}: byte a byte igual ao código das ferramentas em todos os tipos e padrões`, () => {
      let seed = 10;
      for (const [size, levels] of [
        [16, 5],
        [64, 7],
      ] as const) {
        for (const kind of KINDS) {
          for (const pattern of PATTERNS) {
            const img = synthetic(size, pattern, seed++);
            const cutouts = filter === 'premultiplied' ? [false, true] : [kind === 'cutout'];
            for (const cutout of cutouts) {
              const got = buildLayerMipChain(img, levels, filter, kind, cutout);
              const want = refChain(filter, img, kind, cutout, levels);
              want.forEach((m, k) =>
                expect(got[k]!.data, `${size} ${kind} ${pattern} ${cutout} nível ${k + 1}`).toEqual(m.data),
              );
            }
          }
        }
      }
    });
  }

  it('o rascunho é reaproveitado entre camadas e tamanhos, e só a camada pedida muda', () => {
    const scratch = createLayerMipScratch(64);
    const layers = PATTERNS.map((p, i) => synthetic(16, p, 100 + i));
    const levels = [new Uint8Array(16 * 16 * 4 * layers.length)];
    for (let k = 1; k < 5; k++) levels.push(new Uint8Array(mipSize(16, k) ** 2 * 4 * layers.length).fill(77));
    layers.forEach((img, i) => levels[0]!.set(img.data, i * 16 * 16 * 4));
    // Camada 2 por último e a 0 duas vezes: o resultado não depende da ordem nem do que o rascunho guardou.
    for (const i of [0, 1, 3, 4, 5, 6, 7, 0, 2]) writeLayerMipChain(levels, 16, i, 'linear', 'cutout', true, scratch);
    layers.forEach((img, i) => {
      const want = refLinearChain(img, 'cutout', 5);
      want.forEach((m, k) => {
        const bytes = m.data.length;
        expect(levels[k + 1]!.subarray(i * bytes, (i + 1) * bytes), `camada ${i} nível ${k + 1}`).toEqual(m.data);
      });
    });
    expect(() => writeLayerMipChain(levels, 64, 0, 'linear', 'opaque', false, createLayerMipScratch(16))).toThrow(
      'rascunho',
    );
  });
});

// --- As tiras de verdade (assets-src): o que o jogo gera no loading é o que as ferramentas gravavam. ---

const ROOT = join(import.meta.dirname, '..', '..', '..');
const STRIPS = [
  'assets-src/textures/generated/blocos16',
  'assets-src/textures/generated/modelos64-materiais',
  'assets-src/models/generated/modelos64-modelos',
] as const;

describe('mips das tiras do jogo', () => {
  for (const base of STRIPS) {
    it(`${base}: o loading gera o mesmo que o código das ferramentas`, () => {
      const manifest = parseLayerManifest(JSON.parse(readFileSync(join(ROOT, `${base}.json`), 'utf8')) as unknown);
      const level0 = decodePng(readFileSync(join(ROOT, `${base}.png`)));
      const size = TEXTURE_ARRAYS[manifest.array].layerSize;
      const count = manifest.layers.length;
      const levels: Uint8Array[] = [level0.data];
      for (let k = 1; k < manifest.mipLevels; k++) levels.push(new Uint8Array(mipSize(size, k) ** 2 * 4 * count));
      writeStripMips(manifest, levels, 0, createLayerMipScratch(size));
      const filter = LAYER_MIP_FILTER[manifest.source];
      manifest.layers.forEach((entry, i) => {
        const bytes = size * size * 4;
        const image = { width: size, height: size, data: level0.data.subarray(i * bytes, (i + 1) * bytes) };
        const want = refChain(filter, image, entry.kind, entry.cutout, manifest.mipLevels);
        want.forEach((m, k) => {
          const n = m.data.length;
          expect(levels[k + 1]!.subarray(i * n, (i + 1) * n), `${entry.name} nível ${k + 1}`).toEqual(m.data);
        });
      });
      // Os `.mips.png` saíram no M12 (a comparação com eles rodou, nas 166 camadas, antes de apagá-los): se algum voltar
      // para o repositório, confere contra ele também.
      if (!existsSync(join(ROOT, `${base}.mips.png`))) return;
      const mips = decodePng(readFileSync(join(ROOT, `${base}.mips.png`)));
      for (let i = 0; i < count; i++) {
        for (const r of mipChainOffsets(size, manifest.mipLevels)) {
          for (let row = 0; row < r.height; row++) {
            const src = ((i * size + r.y + row) * mips.width + r.x) * 4;
            const dst = (i * r.width * r.height + row * r.width) * 4;
            expect(levels[r.level]!.subarray(dst, dst + r.width * 4), `${manifest.layers[i]!.name} ${r.level}`).toEqual(
              mips.data.subarray(src, src + r.width * 4),
            );
          }
        }
      }
    });
  }
});
