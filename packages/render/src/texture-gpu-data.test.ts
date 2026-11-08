import { describe, expect, it } from 'vitest';
import { ATLAS_MAX_MIP_LEVELS, ATLAS_PADDING } from './shared/glsl-common.ts';
import {
  alphaCoverage,
  arrayBytes,
  atlasBytes,
  atlasCellRect,
  atlasLayout,
  buildAtlasLevels,
  ALPHA_CUTOFF,
  completeMipChain,
  downsampleLayer,
  fullMipLevels,
  levelBytes,
  modelLayerCount,
  preserveAlphaCoverage,
  writeAtlasCell,
  writeLayerMips,
  writeLayerRange,
} from './texture-gpu-data.ts';

/** Números pseudoaleatórios com semente (LCG): os testes são reproduzíveis. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** A busca da cobertura de antes (texel a texel, 16 passadas): referência byte a byte do histograma. */
function preserveAlphaCoverageReference(rgba: Uint8Array, offset: number, texels: number, target: number): void {
  const coverage = (scale: number) => {
    let n = 0;
    for (let i = 0; i < texels; i++) if (rgba[offset + i * 4 + 3]! * scale >= ALPHA_CUTOFF) n++;
    return texels > 0 ? n / texels : 0;
  };
  if (target <= 0 || coverage(1) === target) return;
  let lo = 0;
  let hi = 16;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (coverage(mid) < target) lo = mid;
    else hi = mid;
  }
  for (let i = 0; i < texels; i++) {
    const o = offset + i * 4 + 3;
    rgba[o] = Math.min(255, Math.round(rgba[o]! * hi));
  }
}

/** Cadeia de mips vazia de um array `size` com `layers` camadas. */
function emptyChain(size: number, layers: number): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let k = 0; k < fullMipLevels(size); k++) out.push(new Uint8Array(levelBytes(size, k, layers)));
  return out;
}

/** Uma camada `side`×`side` "de skin": cor pela posição, alfa recortado (quadrados opacos espalhados). */
function skinLikeLayer(side: number, seed: number): Uint8Array {
  const rand = lcg(seed);
  const out = new Uint8Array(side * side * 4);
  for (let i = 0; i < side * side; i++) {
    out.set([Math.floor(rand() * 256), (i * 7) & 255, (i * 13) & 255, rand() < 0.45 ? 255 : 0], i * 4);
  }
  return out;
}

/** Camada sintética: cerca de 1 px a cada 4 px (alfa 255), resto transparente; cor pela posição. */
function fenceLayer(size: number): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4;
      out[o] = x * 10;
      out[o + 1] = y * 10;
      out[o + 2] = 200;
      out[o + 3] = x % 4 === 0 || y % 4 === 0 ? 255 : 0;
    }
  }
  return out;
}

describe('mips das camadas', () => {
  it('cadeia completa: 16 → 5 níveis, 64 → 7', () => {
    expect(fullMipLevels(16)).toBe(5);
    expect(fullMipLevels(64)).toBe(7);
    expect(arrayBytes(16, 2, 5)).toBe(2 * 4 * (256 + 64 + 16 + 4 + 1));
  });

  it('caixa 2×2 pondera a cor pelo alfa (sem franja escura) e faz a média do alfa', () => {
    const src = new Uint8Array(2 * 2 * 4);
    src.set([255, 0, 0, 255], 0); // um texel vermelho opaco, três transparentes pretos
    const dst = new Uint8Array(4);
    downsampleLayer(src, 0, 2, dst, 0);
    expect([...dst]).toEqual([255, 0, 0, 64]);
  });

  it('cobertura do alfa preservada nos mips das camadas cutout (a cerca não some ao longe)', () => {
    const size = 16;
    const level0 = fenceLayer(size);
    const data = { width: size, height: size, layers: 2, levels: [new Uint8Array(size * size * 4 * 2)] };
    data.levels[0]!.set(level0, 0);
    data.levels[0]!.set(level0, size * size * 4);
    // Camada 0 cutout, camada 1 não: a mesma imagem, mips diferentes.
    const levels = completeMipChain(data, 5, (layer) => layer === 0);
    expect(levels).toHaveLength(5);
    expect(levels[0]).toBe(data.levels[0]);
    const target = alphaCoverage(level0, 0, size * size);
    const side = size >> 2;
    // Cerca fina: sem preservar, o nível 2 some inteiro; preservando, fica pelo menos tão coberto quanto o nível 0.
    expect(alphaCoverage(levels[2]!, side * side * 4, side * side)).toBe(0);
    expect(alphaCoverage(levels[2]!, 0, side * side)).toBeGreaterThanOrEqual(target);

    // Densidade variando pela camada: a cobertura do nível 2 fica perto da do nível 0.
    const ramp = new Uint8Array(size * size * 4).fill(255);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) ramp[(y * size + x) * 4 + 3] = (x * 7 + y * 13) % 16 < x ? 255 : 0;
    }
    const rampLevels = completeMipChain({ width: size, height: size, layers: 1, levels: [ramp] }, 5, () => true);
    expect(Math.abs(alphaCoverage(rampLevels[2]!, 0, side * side) - alphaCoverage(ramp, 0, size * size))).toBeLessThan(
      0.15,
    );
  });

  it('writeLayerMips só mexe na camada pedida', () => {
    const levels = [new Uint8Array(4 * 4 * 4 * 2), new Uint8Array(2 * 2 * 4 * 2), new Uint8Array(1 * 1 * 4 * 2)];
    levels[0]!.fill(100, 4 * 4 * 4); // camada 1
    levels[1]!.fill(7);
    writeLayerMips(levels, 4, 1, false);
    expect(levels[1]!.subarray(0, 16).every((v) => v === 7)).toBe(true);
    expect([...levels[1]!.subarray(16, 20)]).toEqual([100, 100, 100, 100]);
    expect([...levels[2]!.subarray(4, 8)]).toEqual([100, 100, 100, 100]);
  });

  it('cobertura por histograma = a busca texel a texel, byte a byte', () => {
    const rand = lcg(51);
    for (let round = 0; round < 300; round++) {
      const side = [1, 2, 4, 8, 16, 32, 64][round % 7]!;
      const texels = side * side;
      const img = new Uint8Array(texels * 4 + 8);
      // Alfas de todo tipo: 0, 255, a faixa perto do corte e valores soltos.
      for (let i = 0; i < texels; i++) {
        const r = rand();
        img[4 + i * 4 + 3] =
          r < 0.3 ? 0 : r < 0.5 ? 255 : r < 0.8 ? 100 + Math.floor(rand() * 40) : Math.floor(rand() * 256);
      }
      const target = round % 5 === 0 ? 1 : round % 11 === 0 ? 0 : rand();
      const a = img.slice();
      const b = img.slice();
      preserveAlphaCoverage(a, 4, texels, target);
      preserveAlphaCoverageReference(b, 4, texels, target);
      expect(a).toEqual(b);
    }
  });

  it('writeLayerMips a partir do nível 1 dado: não mexe nos níveis 0 e 1 e a cobertura é a do nível 1', () => {
    const size = 64;
    const levels = emptyChain(size, 2);
    levels[0]!.fill(9);
    const l1 = skinLikeLayer(32, 7);
    levels[1]!.set(l1, 32 * 32 * 4); // camada 1
    const before0 = levels[0]!.slice();
    writeLayerMips(levels, size, 1, true, 2);
    expect(levels[0]).toEqual(before0);
    expect(levels[1]!.subarray(32 * 32 * 4)).toEqual(l1);
    expect(levels[1]!.subarray(0, 32 * 32 * 4).every((v) => v === 0)).toBe(true);
    const target = alphaCoverage(l1, 0, 32 * 32);
    for (let k = 2; k < levels.length; k++) {
      const side = size >> k;
      expect(alphaCoverage(levels[k]!, side * side * 4, side * side), `nível ${k}`).toBeGreaterThanOrEqual(target);
      // A camada 0 continua vazia.
      expect(levels[k]!.subarray(0, side * side * 4).every((v) => v === 0)).toBe(true);
    }
  });
});

describe('writeModelLayer, lado da CPU (k camadas e nível 1 dado, decisão #51)', () => {
  it('conta as camadas pelos bytes e recusa tamanho quebrado ou nível 1 errado', () => {
    expect(modelLayerCount(64, 4 * 16384)).toBe(4);
    expect(modelLayerCount(64, 16384, 4096)).toBe(1);
    expect(modelLayerCount(64, 4 * 16384, 4 * 4096)).toBe(4);
    expect(() => modelLayerCount(64, 0)).toThrow('k × 16384');
    expect(() => modelLayerCount(64, 16384 + 4)).toThrow('k × 16384');
    expect(() => modelLayerCount(64, 4 * 16384, 4096)).toThrow('esperado 16384');
  });

  it('4 camadas seguidas com o nível 1 dado: níveis 0 e 1 copiados, 2..6 tirados do nível 1, vizinhas intactas', () => {
    const size = 64;
    const layers = 10;
    const first = 3;
    const k = 4;
    const levels = emptyChain(size, layers);
    for (const l of levels) l.fill(77); // camadas vizinhas com lixo conhecido
    const rgba = new Uint8Array(k * 64 * 64 * 4);
    const level1 = new Uint8Array(k * 32 * 32 * 4);
    for (let i = 0; i < k; i++) {
      rgba.set(skinLikeLayer(64, 100 + i), i * 64 * 64 * 4);
      level1.set(skinLikeLayer(32, 200 + i), i * 32 * 32 * 4);
    }
    expect(writeLayerRange(levels, size, first, rgba, level1)).toBe(k);
    expect(levels[0]!.subarray(first * 16384, (first + k) * 16384)).toEqual(rgba);
    expect(levels[1]!.subarray(first * 4096, (first + k) * 4096)).toEqual(level1);

    // Os níveis 2..6 de cada camada são os de uma cadeia que parte do nível 1 dado (cobertura do nível 1).
    for (let i = 0; i < k; i++) {
      const solo = emptyChain(size, 1);
      solo[1]!.set(level1.subarray(i * 4096, (i + 1) * 4096));
      writeLayerMips(solo, size, 0, true, 2);
      for (let lv = 2; lv < levels.length; lv++) {
        const bytes = levelBytes(size, lv, 1);
        expect(levels[lv]!.subarray((first + i) * bytes, (first + i + 1) * bytes), `camada ${i} nível ${lv}`).toEqual(
          solo[lv],
        );
      }
    }
    // Fora da faixa nada mudou.
    for (let lv = 0; lv < levels.length; lv++) {
      const bytes = levelBytes(size, lv, 1);
      expect(levels[lv]!.subarray(0, first * bytes).every((v) => v === 77)).toBe(true);
      expect(levels[lv]!.subarray((first + k) * bytes).every((v) => v === 77)).toBe(true);
    }
  });

  it('sem nível 1, ele sai do nível 0 (como a skin de 1 camada de antes)', () => {
    const size = 64;
    const levels = emptyChain(size, 2);
    const rgba = skinLikeLayer(64, 3);
    writeLayerRange(levels, size, 1, rgba);
    const solo = emptyChain(size, 1);
    solo[0]!.set(rgba);
    writeLayerMips(solo, size, 0, true);
    for (let lv = 0; lv < levels.length; lv++) {
      const bytes = levelBytes(size, lv, 1);
      expect(levels[lv]!.subarray(bytes, 2 * bytes), `nível ${lv}`).toEqual(solo[lv]);
    }
  });
});

describe('atlas do plano B', () => {
  it('disposição dos 2 arrays cabe no MAX_TEXTURE_SIZE mínimo: blocos com 2 níveis, modelos com 3 (#51)', () => {
    const blocks = atlasLayout(256, 16, ATLAS_PADDING.blocos16, ATLAS_MAX_MIP_LEVELS.blocos16);
    expect(blocks).toMatchObject({ cols: 16, rows: 16, cell: 24, width: 384, height: 384, levels: 2 });
    const models = atlasLayout(128, 64, ATLAS_PADDING.modelos64, ATLAS_MAX_MIP_LEVELS.modelos64);
    expect(models).toMatchObject({ cols: 12, rows: 11, cell: 72, width: 864, height: 792, levels: 3 });
    expect(atlasBytes(blocks)).toBe(384 * 384 * 4 + 192 * 192 * 4);
    // O modelos64 do M1 (~90 camadas: 26 das ferramentas + 64 de skins): 720×648, níveis de 72 → 36 → 18 px por célula.
    const m1 = atlasLayout(90, 64, ATLAS_PADDING.modelos64, ATLAS_MAX_MIP_LEVELS.modelos64);
    expect(m1).toMatchObject({ cols: 10, rows: 9, width: 720, height: 648, levels: 3 });
    expect(atlasCellRect(m1, 89, 2)).toEqual({ x: 9 * 18, y: 8 * 18, size: 18 });
    expect(atlasBytes(m1)).toBe(720 * 648 * 4 + 360 * 324 * 4 + 180 * 162 * 4);
    // O padding de 4 px não deixa passar de 3 níveis (o 4º teria padding de meio px).
    expect(atlasLayout(90, 64, 4, 8).levels).toBe(3);
    // Sem padding par não dá para descer de nível sem misturar tiles.
    expect(atlasLayout(4, 16, 1, 2).levels).toBe(1);
  });

  it('célula do atlas com cópia por linha = a montagem texel a texel de antes, byte a byte', () => {
    const rand = lcg(7);
    for (const [tile, padding, maxLevels] of [
      [16, 4, 2],
      [64, 4, 3],
      [4, 2, 1],
      [8, 4, 3],
    ] as const) {
      const layers = 3;
      const level0 = new Uint8Array(tile * tile * 4 * layers);
      for (let i = 0; i < level0.length; i++) level0[i] = Math.floor(rand() * 256);
      const levels = completeMipChain({ width: tile, height: tile, layers, levels: [level0] }, 3, () => false);
      const layout = atlasLayout(layers, tile, padding, maxLevels);
      for (const wrap of ['repeat', 'clamp'] as const) {
        for (let k = 0; k < layout.levels; k++) {
          const t = Math.max(1, tile >> k);
          const pad = padding >> k;
          const cell = t + 2 * pad;
          const got = new Uint8Array((cell + 3) * (cell + 3) * 4).fill(1);
          const want = got.slice();
          writeAtlasCell(layout, 2, k, levels[k]!, wrap, got, cell + 3, 2, 1);
          // Referência: o laço por texel de antes.
          const wrapIndex = (i: number, n: number) =>
            wrap === 'repeat' ? ((i % n) + n) % n : i < 0 ? 0 : i >= n ? n - 1 : i;
          for (let y = 0; y < cell; y++) {
            for (let x = 0; x < cell; x++) {
              const s = (2 * t * t + wrapIndex(y - pad, t) * t + wrapIndex(x - pad, t)) * 4;
              want.set(levels[k]!.subarray(s, s + 4), ((1 + y) * (cell + 3) + 2 + x) * 4);
            }
          }
          expect(got, `tile ${tile} nível ${k} ${wrap}`).toEqual(want);
        }
      }
    }
  });

  it('padding por repetição (blocos) e por borda (modelos)', () => {
    const layout = atlasLayout(1, 4, 2, 1);
    const src = new Uint8Array(4 * 4 * 4);
    for (let i = 0; i < 16; i++) src[i * 4] = i; // R = índice do texel
    const repeat = new Uint8Array(layout.width * layout.height * 4);
    writeAtlasCell(layout, 0, 0, src, 'repeat', repeat, layout.width, 0, 0);
    const clamp = new Uint8Array(layout.width * layout.height * 4);
    writeAtlasCell(layout, 0, 0, src, 'clamp', clamp, layout.width, 0, 0);
    const at = (img: Uint8Array, x: number, y: number) => img[(y * layout.width + x) * 4];
    // Px (1, 2) do atlas = 1 à esquerda do texel (0, 0).
    expect(at(repeat, 1, 2)).toBe(3); // texel (3, 0)
    expect(at(clamp, 1, 2)).toBe(0); // texel (0, 0)
    expect(at(repeat, 2, 1)).toBe(12); // texel (0, 3)
    expect(at(repeat, 2, 2)).toBe(0);
  });

  it('a conta do shader (bfAtlasCorner + fract) lê o mesmo texel que o array', () => {
    const tile = 16;
    const layers = 5;
    const level0 = new Uint8Array(tile * tile * 4 * layers);
    for (let i = 0; i < level0.length / 4; i++) level0[i * 4] = i % 251;
    const levels = completeMipChain({ width: tile, height: tile, layers, levels: [level0] }, 5, () => false);
    const layout = atlasLayout(layers, tile, 4, 2);
    const atlas = buildAtlasLevels(layout, levels, 'repeat');
    for (const [u, v, layer] of [
      [0.03, 0.97, 0],
      [3.51, -2.2, 3],
      [-0.49, 7.75, 4],
    ] as const) {
      // bfAtlasCorner: (col, row) * (tile + 2·pad) + pad; st = (corner + fract(uv)·tile) / size (nearest).
      const fu = u - Math.floor(u);
      const fv = v - Math.floor(v);
      const corner = atlasCellRect(layout, layer, 0);
      const px = Math.floor(corner.x + layout.padding + fu * tile);
      const py = Math.floor(corner.y + layout.padding + fv * tile);
      const fromAtlas = atlas[0]![(py * layout.width + px) * 4];
      const tx = Math.floor(fu * tile);
      const ty = Math.floor(fv * tile);
      expect(fromAtlas).toBe(level0[(layer * tile * tile + ty * tile + tx) * 4]);
    }
    // Nível 1: a célula encolhe junto (padding 2), conteúdo do nível 1 da camada.
    const r = atlasCellRect(layout, 3, 1);
    expect(r.size).toBe(12);
    const px = r.x + 2;
    const py = r.y + 2;
    expect(atlas[1]![(py * (layout.width >> 1) + px) * 4]).toBe(levels[1]![3 * 8 * 8 * 4]);
  });

  it('bfAtlasCorner em float32 com divisão imprecisa (até 2 ULP abaixo) dá a célula do atlasCellRect', () => {
    const f = Math.fround;
    // Recíproco empurrado `ulps` para baixo, como uma GPU que faz a/b = a·(1/b) com 1/b arredondado para baixo.
    const lowRecip = (cols: number, ulps: number): number => {
      const r = new Float32Array([1 / cols]);
      const bits = new Uint32Array(r.buffer);
      bits[0] = bits[0]! - ulps;
      return r[0]!;
    };
    // A conta do glsl-common.ts: row = floor((layer + 0.5) / cols); col = layer − row·cols.
    const hardened = (layer: number, cols: number, recip: number) => {
      const row = Math.floor(f(f(layer + 0.5) * recip));
      return { col: f(layer - f(row * cols)), row };
    };
    // A conta antiga (mod + floor(layer / cols)) erra nesse cenário: prova de que o teste enxerga o defeito.
    let oldWrong = 0;
    for (let cols = 2; cols <= 16; cols++) {
      const layout = atlasLayout(cols * cols, 4, 2, 1);
      expect(layout.cols).toBe(cols);
      for (let ulps = 0; ulps <= 2; ulps++) {
        const recip = lowRecip(cols, ulps);
        for (let layer = 0; layer < 256; layer++) {
          const r = atlasCellRect(layout, layer, 0);
          const got = hardened(layer, cols, recip);
          expect([got.col * layout.cell, got.row * layout.cell], `cols ${cols}, layer ${layer}, -${ulps} ULP`).toEqual([
            r.x,
            r.y,
          ]);
          const oldRow = Math.floor(f(layer * recip));
          if (oldRow !== Math.floor(layer / cols)) oldWrong++;
        }
      }
    }
    expect(oldWrong).toBeGreaterThan(0);
  });

  it('modelos com 3 níveis: a conta do bfSampleClamp lê o texel da camada em cada nível, sem vazar do vizinho', () => {
    const tile = 64;
    const layers = 6;
    const level0 = new Uint8Array(tile * tile * 4 * layers);
    // R = camada + 1 (nada é 0), G = coluna, B = linha: dá para saber de onde veio cada texel.
    for (let l = 0; l < layers; l++) {
      for (let i = 0; i < tile * tile; i++)
        level0.set([l + 1, i % tile, Math.floor(i / tile), 255], (l * tile * tile + i) * 4);
    }
    const levels = completeMipChain({ width: tile, height: tile, layers, levels: [level0] }, 7, () => false);
    const layout = atlasLayout(layers, tile, ATLAS_PADDING.modelos64, ATLAS_MAX_MIP_LEVELS.modelos64);
    const atlas = buildAtlasLevels(layout, levels, 'clamp');
    expect(atlas).toHaveLength(3);
    for (let lv = 0; lv < 3; lv++) {
      const lw = layout.width >> lv;
      const t = tile >> lv;
      for (const layer of [0, 4, 5]) {
        for (const [u, v] of [
          [0, 0],
          [1, 1],
          [0.5, 0.999],
          [1, 0],
        ] as const) {
          // bfSampleClamp: inner = clamp(uv, 0,5/tile, 1 − 0,5/tile); st = (corner + inner·tile) / size; nearest.
          const iu = Math.min(1 - 0.5 / tile, Math.max(0.5 / tile, u));
          const iv = Math.min(1 - 0.5 / tile, Math.max(0.5 / tile, v));
          const cell = atlasCellRect(layout, layer, 0);
          const px = Math.floor((cell.x + layout.padding + iu * tile) / (1 << lv));
          const py = Math.floor((cell.y + layout.padding + iv * tile) / (1 << lv));
          const got = atlas[lv]!.subarray((py * lw + px) * 4, (py * lw + px) * 4 + 4);
          const tx = Math.min(t - 1, Math.floor(iu * t));
          const ty = Math.min(t - 1, Math.floor(iv * t));
          const o = (layer * t * t + ty * t + tx) * 4;
          expect([...got], `nível ${lv} camada ${layer} uv ${u},${v}`).toEqual([...levels[lv]!.subarray(o, o + 4)]);
        }
      }
    }
  });
});
