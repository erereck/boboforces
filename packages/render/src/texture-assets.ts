// M1: monta os 2 texture arrays a partir das tiras das ferramentas (sem three, testável em Node). Contrato do manifesto
// em `@boboforces/format` (`layers.ts`). Ordem das tiras = ordem de `arrays` no `assets-src/runtime-assets.json`.
import { mipChainOffsets, TEXTURE_ARRAYS, type LayerManifest, type TextureArrayName } from '@boboforces/format';
import type { RgbaImageLike } from './texture-data.ts';
import type { AssembledTextureArray, TextureLayerInfo } from './types.ts';

/** Uma tira já decodificada (PNG próprio do `format`). */
export interface TextureStrip {
  readonly manifest: LayerManifest;
  /** `<base>.png`: nível 0, camadas na vertical. */
  readonly level0: RgbaImageLike;
  /** `<base>.mips.png` quando `mipLevels` > 1; senão `null`. */
  readonly mips: RgbaImageLike | null;
}

function fail(message: string): never {
  throw new Error(`texture array: ${message}`);
}

/**
 * Concatena as tiras de UM array e acrescenta `reserve` camadas transparentes no fim (skins compostas no loading).
 * Toda tira do array precisa declarar o mesmo `mipLevels`; o resultado tem esse número de níveis. Nome repetido entre
 * tiras é erro; tira provisória (`placeholder`) é recusada com a instrução de gerar os assets.
 */
export function assembleTextureArray(
  name: TextureArrayName,
  strips: readonly TextureStrip[],
  reserve = 0,
): AssembledTextureArray {
  const spec = TEXTURE_ARRAYS[name];
  const size = spec.layerSize;
  if (strips.length === 0) fail(`${name} sem tiras`);
  const mipLevels = strips[0]!.manifest.mipLevels;
  let total = reserve;
  for (const s of strips) {
    const m = s.manifest;
    const where = `${name}/${m.source}`;
    if (m.placeholder === true) fail(`${where} é um arquivo provisório: rode "npm run assets"`);
    if (m.array !== name) fail(`${where} declara o array ${m.array}`);
    if (m.mipLevels !== mipLevels) fail(`${where} com ${m.mipLevels} níveis de mip, esperado ${mipLevels}`);
    if (s.level0.width !== size || s.level0.height !== size * m.layers.length) {
      fail(`${where}: PNG ${s.level0.width}×${s.level0.height} não bate com ${m.layers.length} camadas de ${size}`);
    }
    if (mipLevels > 1) {
      if (!s.mips) fail(`${where} sem .mips.png`);
      if (s.mips.width !== size / 2 || s.mips.height !== size * m.layers.length) {
        fail(`${where}: .mips.png ${s.mips.width}×${s.mips.height}, esperado ${size / 2}×${size * m.layers.length}`);
      }
    }
    total += m.layers.length;
  }
  if (total > spec.maxLayers) fail(`${name} com ${total} camadas (teto ${spec.maxLayers})`);

  const levels: Uint8Array[] = [];
  for (let level = 0; level < mipLevels; level++) {
    const side = Math.max(1, size >> level);
    levels.push(new Uint8Array(side * side * 4 * total));
  }
  const rects = mipChainOffsets(size, mipLevels);
  const layers = new Map<string, number>();
  const info: TextureLayerInfo[] = [];
  let layer = 0;
  for (const s of strips) {
    levels[0]!.set(s.level0.data.subarray(0, size * size * 4 * s.manifest.layers.length), layer * size * size * 4);
    s.manifest.layers.forEach((entry, i) => {
      if (layers.has(entry.name)) fail(`camada "${entry.name}" repetida em ${name}`);
      layers.set(entry.name, layer + i);
      info.push({ name: entry.name, kind: entry.kind, frames: entry.frames, cutout: entry.cutout });
      if (!s.mips) return;
      const mipWidth = s.mips.width;
      for (const r of rects) {
        const dst = levels[r.level]!;
        const base = (layer + i) * r.width * r.height * 4;
        for (let row = 0; row < r.height; row++) {
          const src = ((i * size + r.y + row) * mipWidth + r.x) * 4;
          dst.set(s.mips.data.subarray(src, src + r.width * 4), base + row * r.width * 4);
        }
      }
    });
    layer += s.manifest.layers.length;
  }
  return {
    name,
    data: { width: size, height: size, layers: total, levels },
    layers,
    info,
    reservedStart: total - reserve,
    reservedCount: reserve,
  };
}
