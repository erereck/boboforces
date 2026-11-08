import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { mipChainOffsets, parseLayerManifest, TEXTURE_ARRAYS } from '@boboforces/format';
import { describe, expect, it } from 'vitest';
import { BLOCK_TEXTURES } from '../../../assets-src/textures/blocks16.ts';
import { MODEL_MATERIAL_TEXTURES } from '../../../assets-src/textures/modelos64.ts';
import { buildContactSheet } from './contact.ts';
import { buildManifest, buildStripAssets, generateLayers, layerGroups, validateLayers } from './generate.ts';
import { formatJson } from './json.ts';
import { BLOCK_STRIP, buildTexgen, layerFileName, MODEL_MATERIALS_STRIP, TEXGEN_OUTPUT_DIRS } from './outputs.ts';
import { inPalette } from './palette.ts';
import { decodePng } from './png.ts';
import { validateTexture } from './validate.ts';

const root = resolve(import.meta.dirname, '../../..');
const blocks = buildStripAssets(BLOCK_STRIP);
const materials = buildStripAssets(MODEL_MATERIALS_STRIP);

const colorsOf = (data: Uint8Array): Set<number> => {
  const colors = new Set<number>();
  for (let p = 0; p < data.length; p += 4)
    if (data[p + 3]! > 0) colors.add((data[p]! << 16) | (data[p + 1]! << 8) | data[p + 2]!);
  return colors;
};

describe('camadas de blocos16', () => {
  it('cobrem o catálogo do Construto (~40 texturas) e mantêm os nomes do M0', () => {
    const bases = BLOCK_TEXTURES.map((r) => r.name);
    expect(bases.length).toBeGreaterThanOrEqual(36);
    const names = blocks.layers.map((l) => l.name);
    for (const m0 of ['concrete', 'metal', 'wood', 'grass', 'grass_side', 'dirt', 'brick', 'test_floor']) {
      expect(names, m0).toContain(m0);
    }
    expect(names.length).toBeLessThanOrEqual(TEXTURE_ARRAYS.blocos16.maxLayers);
  });

  it('todas passam no validador e só usam a paleta mestra', () => {
    expect(validateLayers(blocks.layers, 'blocos16')).toEqual([]);
    expect(validateLayers(materials.layers, 'modelos64')).toEqual([]);
    for (const l of [...blocks.layers, ...materials.layers])
      for (const c of colorsOf(l.image.data)) expect(inPalette(c)).toBe(true);
  });

  it('variantes e quadros viram camadas seguidas com nome estável (base, _b, _c…; quadro com #n)', () => {
    const names = blocks.layers.map((l) => l.name);
    const at = (n: string): number => names.indexOf(n);
    expect(at('grass_b')).toBe(at('grass') + 1);
    expect(at('grass_c')).toBe(at('grass') + 2);
    expect(at('concrete_d')).toBe(at('concrete') + 3);
    expect(names.slice(at('water'), at('water') + 4)).toEqual(['water', 'water#1', 'water#2', 'water#3']);
    const groups = layerGroups(blocks.layers);
    expect(groups.get('water')).toMatchObject({ variants: 1, frames: 4, kind: 'translucent' });
    // Número de setor: uma camada por setor, sem variante sorteada (arte-8).
    for (let n = 1; n <= 9; n++) expect(groups.get(`sector_marker_${n}`)).toMatchObject({ variants: 1, frames: 1 });
    // Contínuos com pelo menos 3 variantes (arte-ux.md §1.3).
    for (const base of ['concrete', 'grass', 'grass_side', 'dirt'])
      expect(groups.get(base)!.variants).toBeGreaterThanOrEqual(3);
  });

  it('a água anima de verdade (quadros diferentes) e as variantes não são cópias', () => {
    const img = (n: string): Uint8Array => blocks.layers.find((l) => l.name === n)!.image.data;
    expect(img('water#1')).not.toEqual(img('water'));
    expect(img('grass_b')).not.toEqual(img('grass'));
    expect(img('sector_marker_9')).not.toEqual(img('sector_marker_1'));
  });

  it('número de setor girado 180° (lido do outro lado) não vira outro número (o 6 e o 9)', () => {
    const img = (n: string): Uint8Array => blocks.layers.find((l) => l.name === n)!.image.data;
    // Só o miolo dentro da moldura (2..13): o bevel e os riscos da borda não ajudam a saber o lado do número.
    const inner = (data: Uint8Array, turned: boolean): string => {
      const out: number[] = [];
      for (let y = 2; y <= 13; y++)
        for (let x = 2; x <= 13; x++) {
          const [sx, sy] = turned ? [15 - x, 15 - y] : [x, y];
          const o = (sy * 16 + sx) * 4;
          out.push(data[o]!, data[o + 1]!, data[o + 2]!);
        }
      return out.join(',');
    };
    for (let n = 1; n <= 9; n++) {
      const turned = inner(img(`sector_marker_${n}`), true);
      for (let m = 1; m <= 9; m++) {
        if (m === n) continue;
        expect(turned === inner(img(`sector_marker_${m}`), false), `${n} girado = ${m}`).toBe(false);
      }
    }
  });

  it('cada textura usa pelo menos 3 tons (não é chapada), exceto o branco dos detritos e o xadrez do missing', () => {
    for (const l of [...blocks.layers, ...materials.layers]) {
      if (l.name === 'mat_white' || l.material === 'debug') continue;
      expect(colorsOf(l.image.data).size, l.name).toBeGreaterThanOrEqual(3);
    }
  });

  it('é determinística (duas gerações iguais byte a byte)', () => {
    const again = generateLayers(BLOCK_TEXTURES, 16);
    again.forEach((l, i) => expect(l.image.data, l.name).toEqual(blocks.layers[i]!.image.data));
    const again64 = generateLayers(MODEL_MATERIAL_TEXTURES, 64);
    again64.forEach((l, i) => expect(l.image.data, l.name).toEqual(materials.layers[i]!.image.data));
    const a = buildTexgen().files;
    const b = buildTexgen().files;
    for (const [rel, bytes] of a) expect(Buffer.compare(bytes, b.get(rel)!), rel).toBe(0);
  });

  it('receita repetida, nome inválido ou variantes fora de 1..16 são recusados', () => {
    const r = BLOCK_TEXTURES[0]!;
    expect(() => generateLayers([r, r], 16)).toThrow(/repetida/);
    expect(() => generateLayers([{ ...r, name: 'Concreto' }], 16)).toThrow(/inválido/);
    expect(() => generateLayers([{ ...r, variants: 17 }], 16)).toThrow(/variants/);
  });

  it('cutout tem buraco de verdade e os mips não somem (cerca e folhagem ao longe)', () => {
    for (const [i, l] of blocks.layers.entries()) {
      if (l.kind !== 'cutout') continue;
      const mips = blocks.mips[i]!;
      // Do 8×8 ao 4×4 sempre sobra texel visível (o 1×1 pode sumir: a célula inteira cabe num pixel).
      for (const m of mips.slice(0, 2)) {
        let visible = 0;
        for (let p = 3; p < m.data.length; p += 4) if (m.data[p]! >= 128) visible++;
        expect(visible, `${l.name} ${m.width}×${m.width}`).toBeGreaterThan(0);
      }
    }
  });
});

describe('manifestos e tiras', () => {
  it('manifesto layers@1 válido pelo contrato, com quadros e cutout', () => {
    const m = blocks.manifest;
    expect(parseLayerManifest(JSON.parse(JSON.stringify(m)))).toEqual(m);
    expect(m).toMatchObject({ array: 'blocos16', source: 'texgen', mipLevels: 5, layerWidth: 16 });
    expect(m.layers.find((l) => l.name === 'water')).toMatchObject({ frames: 4, kind: 'translucent' });
    expect(m.layers.find((l) => l.name === 'water#2')).toMatchObject({ frames: 1 });
    expect(m.layers.find((l) => l.name === 'fence_wire')).toMatchObject({ cutout: true });
    expect(materials.manifest).toMatchObject({ array: 'modelos64', mipLevels: 7, layerWidth: 64 });
    expect(materials.manifest.layers[0]!.name).toBe('mat_white');
    expect(buildManifest(blocks.layers, 'blocos16').layers.length).toBe(blocks.layers.length);
  });

  it('a tira do nível 0 e o .mips.png seguem o layout do contrato (mipChainOffsets)', () => {
    const n = blocks.layers.length;
    expect([blocks.level0.width, blocks.level0.height]).toEqual([16, 16 * n]);
    expect([blocks.mipsImage.width, blocks.mipsImage.height]).toEqual([8, 16 * n]);
    const i = blocks.layers.findIndex((l) => l.name === 'brick');
    expect(blocks.level0.data.subarray(i * 1024, (i + 1) * 1024)).toEqual(blocks.layers[i]!.image.data);
    for (const r of mipChainOffsets(16, 5)) {
      const mip = blocks.mips[i]![r.level - 1]!;
      for (let row = 0; row < r.height; row++) {
        const src = ((i * 16 + r.y + row) * 8 + r.x) * 4;
        expect(blocks.mipsImage.data.subarray(src, src + r.width * 4)).toEqual(
          mip.data.subarray(row * r.width * 4, (row + 1) * r.width * 4),
        );
      }
    }
    // A última linha do bloco de cada camada fica transparente.
    expect(blocks.mipsImage.data.subarray((i * 16 + 15) * 32, (i * 16 + 16) * 32).every((v) => v === 0)).toBe(true);
  });

  it('o branco dos detritos é branco puro e os materiais de prop são o mesmo pixel dos blocos', () => {
    const white = materials.layers[0]!.image.data;
    expect([...colorsOf(white)]).toEqual([0xffffff]);
    const wood64 = materials.layers.find((l) => l.name === 'mat_wood')!.image.data;
    const wood16 = blocks.layers.find((l) => l.name === 'wood')!.image.data;
    for (let y = 0; y < 16; y++) {
      expect(wood64.subarray((y + 16) * 64 * 4 + 16 * 4, (y + 16) * 64 * 4 + 32 * 4)).toEqual(
        wood16.subarray(y * 64, (y + 1) * 64),
      );
    }
  });

  it('JSON no formato do Prettier: objeto aberto, array curto numa linha', () => {
    expect(formatJson({ a: 1, b: ['x', 'y'], c: [{ d: true }], e: [] })).toBe(
      '{\n  "a": 1,\n  "b": ["x", "y"],\n  "c": [\n    {\n      "d": true\n    }\n  ],\n  "e": []\n}\n',
    );
    const long = Array.from({ length: 20 }, (_, i) => `camada_${i}`);
    expect(formatJson({ long })).toContain('"long": [\n    "camada_0",\n');
  });

  it('folha de contato sai com a paleta e todas as camadas', () => {
    const sheet = buildContactSheet([blocks, materials]);
    expect(sheet.width).toBeGreaterThan(1000);
    expect(sheet.height).toBeGreaterThan(1000);
    expect(sheet.data.length).toBe(sheet.width * sheet.height * 4);
  });
});

describe('arquivos gerados', () => {
  const build = buildTexgen();

  it('estão em dia com o código (rode "npm run texgen" se falhar)', () => {
    for (const [rel, bytes] of build.files) {
      const path = join(root, rel);
      expect(existsSync(path), rel).toBe(true);
      expect(Buffer.compare(readFileSync(path), bytes), rel).toBe(0);
    }
  });

  it('não sobra arquivo velho nas pastas de saída', () => {
    const found: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else found.push(relative(root, p).replaceAll('\\', '/'));
      }
    };
    for (const dir of TEXGEN_OUTPUT_DIRS) walk(join(root, dir));
    expect(found.filter((f) => !build.files.has(f))).toEqual([]);
  });

  it('os PNGs gravados decodificam, batem com o manifesto e passam no validador', () => {
    const material = new Map([...blocks.layers, ...materials.layers].map((l) => [l.name, l.material]));
    for (const base of ['blocos16', 'modelos64-materiais']) {
      const dir = join(root, 'assets-src/textures/generated');
      const manifest = parseLayerManifest(JSON.parse(readFileSync(join(dir, `${base}.json`), 'utf8')));
      const size = TEXTURE_ARRAYS[manifest.array].layerSize;
      const strip = decodePng(readFileSync(join(dir, `${base}.png`)));
      const mips = decodePng(readFileSync(join(dir, `${base}.mips.png`)));
      expect([strip.width, strip.height]).toEqual([size, size * manifest.layers.length]);
      expect([mips.width, mips.height]).toEqual([size / 2, size * manifest.layers.length]);
      manifest.layers.forEach((layer, i) => {
        const data = strip.data.subarray(i * size * size * 4, (i + 1) * size * size * 4);
        const img = { width: size, height: size, data };
        const options = { size, kind: layer.kind, material: material.get(layer.name)! };
        expect(validateTexture(layer.name, img, options), layer.name).toEqual([]);
        if (manifest.array === 'blocos16') {
          const loose = decodePng(readFileSync(join(dir, 'blocks', layerFileName(layer.name))));
          expect(loose.data, layer.name).toEqual(data);
        }
      });
    }
  });
});
