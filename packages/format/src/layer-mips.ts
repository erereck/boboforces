// Mips das camadas dos texture arrays (tecnico.md §6.1, arte-ux.md §1.6). Até o M11 cada ferramenta gravava os níveis
// 1..n−1 num `<base>.mips.png`; desde o M12 (ARCHITECTURE §23.9) o jogo gera a cadeia no CARREGAMENTO a partir do
// nível 0 decodificado (uns 58 KB a menos na primeira partida da web), com o MESMO código que as ferramentas usam para
// a folha de contato. Dois filtros, um por ferramenta (o `source` do manifesto), cada um byte a byte igual ao
// `.mips.png` que ela gravava (o teste guarda o código antigo como referência):
//
// - `linear` (texgen: `blocos16` e `modelos64-materiais`): cada texel do nível k é a média da área 2^k × 2^k do nível 0
//   (a soma inteira da área, não média de médias: só a divisão final arredonda), em luz LINEAR (sRGB → linear → sRGB:
//   o chão ao longe não escurece), tudo em inteiros depois da tabela sRGB → linear. Opaca e emissiva: alfa 255. Cutout:
//   a cor é a média só dos texels visíveis (os buracos ganham antes a cor dos vizinhos, sem franja preta no filtro
//   entre níveis) e o alfa preserva a COBERTURA do nível 0 no corte de 0,5 do shader (a cerca e a folhagem não somem
//   nem engordam ao longe). Translúcida: cor ponderada pelo alfa e alfa médio.
// - `premultiplied` (modelgen: `modelos64-modelos`): caixa 2×2 em cascata sobre o RGB pré-multiplicado em double; na
//   cutout, o limiar de alfa (1..255) que mais aproxima a cobertura do nível 0, binarizado em 0/255.
//
// Sem alocação por camada: um rascunho (`createLayerMipScratch`) por array, reaproveitado entre tiras e camadas. Puro e
// determinístico (regra 10): a tabela sRGB → linear usa `**`, mas fica a mais de 1e−4 milionésimo da borda de cada
// arredondamento (o teste confere), então qualquer `pow` com erro de poucos ulp dá a mesma tabela (V8 com ou sem JIT).
import type { LayerKind, LayerManifest, LayerSource } from './layers.ts';
import type { RgbaImage } from './png/types.ts';

/** O filtro de mips de uma tira. */
export type LayerMipFilter = 'linear' | 'premultiplied';

/** Filtro de cada ferramenta: o mesmo que ela usava ao gravar o `.mips.png` (o runtime escolhe pelo `source`). */
export const LAYER_MIP_FILTER: Readonly<Record<LayerSource, LayerMipFilter>> = {
  texgen: 'linear',
  modelgen: 'premultiplied',
};

/** Lado do nível `level` de uma camada quadrada de lado `size`. */
export function mipSize(size: number, level: number): number {
  return Math.max(1, size >> level);
}

/**
 * A volta linear → sRGB: os pontos médios entre bytes vizinhos da tabela (meio-inteiros exatos) e, por faixa de 1024
 * milionésimos, quantos ficam abaixo do começo da faixa.
 */
interface SrgbLut {
  readonly linear: Int32Array;
  readonly mid: Float64Array;
  readonly buckets: Uint8Array;
}

/** Multiplicar por 1/1024 (potência de 2: exato) e truncar dá a faixa. */
const BUCKET_SCALE = 1 / 1024;
const BUCKETS = Math.floor(1_000_000 * BUCKET_SCALE) + 2;
let srgbLutCache: SrgbLut | null = null;

function srgbLut(): SrgbLut {
  if (srgbLutCache) return srgbLutCache;
  const linear = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    const lin = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    linear[i] = Math.round(lin * 1_000_000);
  }
  const mid = new Float64Array(255);
  for (let i = 0; i < 255; i++) mid[i] = (linear[i]! + linear[i + 1]!) / 2;
  const buckets = new Uint8Array(BUCKETS);
  for (let b = 0, below = 0; b < BUCKETS; b++) {
    while (below < 255 && mid[below]! < b / BUCKET_SCALE) below++;
    buckets[b] = below;
  }
  srgbLutCache = { linear, mid, buckets };
  return srgbLutCache;
}

/** sRGB (byte) → luz linear em milionésimos (inteiro). Calculada na primeira chamada (o menu não paga). */
export function srgbToLinearTable(): Int32Array {
  return srgbLut().linear;
}

/**
 * Linear (milionésimos, 0..1e6, pode ser fracionário) → byte sRGB mais próximo; no empate exato, o menor. É o número de
 * pontos médios abaixo do valor, contado a partir da faixa dele (1 ou 2 passos em vez dos 8 da busca binária que as
 * ferramentas usavam). Dá o mesmo byte que a busca: os pontos médios são exatos, e um valor r/n que não cai em cima de
 * um deles fica a ≥ 1/(2n) dele, muito acima do arredondamento do double (o teste varre os casos).
 */
function toSrgb(lut: SrgbLut, linear: number): number {
  const mid = lut.mid;
  const b = (linear * BUCKET_SCALE) | 0;
  let i = lut.buckets[b < BUCKETS ? b : BUCKETS - 1]!;
  while (i < 255 && mid[i]! < linear) i++;
  return i;
}

/** `toSrgb` para os testes e as ferramentas. */
export function linearToSrgb(linear: number): number {
  return toSrgb(srgbLut(), linear);
}

/** Somas por texel de nível no `linear`: R, G, B (×alfa na translúcida), alfa, R, G, B só dos visíveis e visíveis. */
const SUMS = 8;

/** Rascunho de uma cadeia de mips para camadas de até `size` × `size` (um por array, reaproveitado). */
export interface LayerMipScratch {
  readonly size: number;
  /** `linear` cutout: cópia da camada com a cor espalhada nos buracos. */
  readonly bled: Uint8Array;
  /** `linear` cutout: texels com cor conhecida (o espalhamento alterna os dois). */
  readonly known: Uint8Array;
  readonly next: Uint8Array;
  /** `linear` cutout: cobertura bruta (0..1) de cada texel do nível. */
  readonly cover: Float64Array;
  /** `linear` cutout: chaves de ordenação da cobertura, uma visão por lado de nível (índice = log2 do lado). */
  readonly keys: readonly Int32Array[];
  /**
   * Níveis 1.. em double, alternados (o 1 no A, o 2 no B, o 3 no A…): pré-multiplicados no `premultiplied` (4 por
   * texel) e as somas inteiras do `linear` (8 por texel). A: (S/2)² × 8; B: (S/4)² × 8.
   */
  readonly floatA: Float64Array;
  readonly floatB: Float64Array;
  /** `premultiplied` cutout: histograma do maior limiar t/255 que cada alfa alcança. */
  readonly histogram: Uint32Array;
}

export function createLayerMipScratch(size: number): LayerMipScratch {
  const texels = size * size;
  const half = mipSize(size, 1);
  const keys = new Int32Array(half * half);
  // A ordenação nativa do typed array ordena a visão inteira: uma visão do tamanho exato de cada nível.
  const views: Int32Array[] = [];
  for (let side = 1; side <= half; side *= 2) views.push(keys.subarray(0, side * side));
  return {
    size,
    bled: new Uint8Array(texels * 4),
    known: new Uint8Array(texels),
    next: new Uint8Array(texels),
    cover: new Float64Array(half * half),
    keys: views,
    floatA: new Float64Array(half * half * SUMS),
    floatB: new Float64Array(mipSize(size, 2) ** 2 * SUMS),
    histogram: new Uint32Array(256),
  };
}

/**
 * Espalha a cor dos texels visíveis (alfa > 0) para os transparentes vizinhos, em passadas até cobrir a camada (alfa
 * continua 0; com wrap, as camadas repetem). Camada toda transparente fica como está. No lugar, em `data`.
 */
function bleedInPlace(data: Uint8Array, size: number, scratch: LayerMipScratch, lut: SrgbLut): void {
  const table = lut.linear;
  const total = size * size;
  let known = scratch.known;
  let next = scratch.next;
  let pending = 0;
  for (let i = 0; i < total; i++) {
    if (data[i * 4 + 3]! > 0) known[i] = 1;
    else {
      known[i] = 0;
      pending++;
    }
  }
  if (pending === total) return;
  while (pending > 0) {
    next.set(known);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        if (known[i]) continue;
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const row = ((y + dy + size) % size) * size;
          for (let dx = -1; dx <= 1; dx++) {
            const j = row + ((x + dx + size) % size);
            if (!known[j]) continue;
            r += table[data[j * 4]!]!;
            g += table[data[j * 4 + 1]!]!;
            b += table[data[j * 4 + 2]!]!;
            n++;
          }
        }
        if (n === 0) continue;
        data[i * 4] = toSrgb(lut, r / n);
        data[i * 4 + 1] = toSrgb(lut, g / n);
        data[i * 4 + 2] = toSrgb(lut, b / n);
        next[i] = 1;
        pending--;
      }
    }
    const swap = known;
    known = next;
    next = swap;
  }
}

/** Ordem de Bayer 4×4: desempata texels de mesma cobertura espalhando os escolhidos (sem aglomerar num canto). */
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5] as const;

/**
 * Alfa de um nível de cutout com a COBERTURA do nível 0 preservada (à moda de Castaño): exatamente
 * round(cobertura × texels) texels ficam acima do corte do shader (0,5), os de maior cobertura bruta primeiro e, no
 * empate (padrão uniforme como a cerca de arame), pela ordem de Bayer e depois pelo índice. O alfa sai suave (escala da
 * cobertura bruta, preso abaixo ou acima de 0,5): o filtro entre níveis mistura dois mips e o `discard` corta depois.
 * Texel sem cobertura nenhuma nunca aparece. `keys` já vem com uma chave por texel que ordena nessa ordem (ordenação
 * nativa do typed array, sem comparador: o índice sai da chave pelo resto).
 */
function applyCoverage(
  dst: Uint8Array,
  offset: number,
  cover: Float64Array,
  keys: Int32Array,
  n: number,
  target: number,
): void {
  keys.sort();
  const keep = Math.round(target * n);
  // Menor cobertura positiva entre as escolhidas: ela vira exatamente 0,5.
  let threshold = 0;
  for (let k = keep - 1; k >= 0 && threshold === 0; k--) threshold = cover[keys[k]! % n]!;
  const scale = threshold > 0 ? 0.5 / threshold : 0;
  for (let rank = 0; rank < n; rank++) {
    const i = keys[rank]! % n;
    const c = cover[i]!;
    const a = Math.min(255, Math.round(c * scale * 255));
    dst[offset + i * 4 + 3] = c > 0 && rank < keep ? Math.max(128, a) : Math.min(127, a);
  }
}

/**
 * Filtro `linear` (texgen): níveis 1.. de uma camada (ver o cabeçalho). Cada texel do nível k é a média da área
 * 2^k × 2^k do nível 0; as somas dessa área são inteiras (milionésimos × alfa ≤ 2,6e8 por texel, ≤ 1,1e12 na camada
 * de 64: exatas em double), então saem em cascata (o nível k soma 4 texels do k−1) com o mesmo valor da soma direta, e
 * só a divisão final arredonda. Assim a camada de 64 lê o nível 0 uma vez, não seis.
 */
function writeLinear(
  levels: readonly Uint8Array[],
  size: number,
  layer: number,
  kind: LayerKind,
  scratch: LayerMipScratch,
): void {
  const lut = srgbLut();
  const table = lut.linear;
  const texels = size * size;
  const level0 = levels[0]!;
  const cutout = kind === 'cutout';
  const translucent = kind === 'translucent';
  let src = level0;
  let base = layer * texels * 4;
  let target = 1;
  if (cutout) {
    let visible = 0;
    for (let i = 0; i < texels; i++) if (level0[base + i * 4 + 3]! >= 128) visible++;
    target = visible / texels;
    scratch.bled.set(level0.subarray(base, base + texels * 4));
    bleedInPlace(scratch.bled, size, scratch, lut);
    src = scratch.bled;
    base = 0;
  }
  let sums = scratch.floatA;
  let spare = scratch.floatB;
  let prevSide = size;
  for (let level = 1; level < levels.length; level++) {
    const side = mipSize(size, level);
    if (level === 1) {
      // Somas do nível 1 direto dos texels (blocos de 2×2, ou a camada inteira se ela tiver lado 1).
      const f = size / side;
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
            let i = base + ((y * f + yy) * size + x * f) * 4;
            for (let xx = 0; xx < f; xx++, i += 4) {
              const alpha = src[i + 3]!;
              const lr = table[src[i]!]!;
              const lg = table[src[i + 1]!]!;
              const lb = table[src[i + 2]!]!;
              if (translucent) {
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
          const s = (y * side + x) * SUMS;
          sums[s] = r;
          sums[s + 1] = g;
          sums[s + 2] = b;
          sums[s + 3] = a;
          sums[s + 4] = vr;
          sums[s + 5] = vg;
          sums[s + 6] = vb;
          sums[s + 7] = visible;
        }
      }
    } else if (side < prevSide) {
      // Em cascata: cada texel soma os 4 do nível anterior (inteiros: a ordem não muda o resultado).
      for (let y = 0; y < side; y++) {
        for (let x = 0; x < side; x++) {
          const p00 = (y * 2 * prevSide + x * 2) * SUMS;
          const p01 = p00 + SUMS;
          const p10 = p00 + prevSide * SUMS;
          const p11 = p10 + SUMS;
          const d = (y * side + x) * SUMS;
          for (let c = 0; c < SUMS; c++)
            spare[d + c] = sums[p00 + c]! + sums[p01 + c]! + sums[p10 + c]! + sums[p11 + c]!;
        }
      }
      const swap = sums;
      sums = spare;
      spare = swap;
    }
    // (lado igual ao anterior, só se pedirem mais níveis que a cadeia: a área já é a camada inteira, mesmas somas.)
    prevSide = side;
    const f = size / side;
    const n = f * f;
    const dst = levels[level]!;
    const offset = layer * side * side * 4;
    const keys = cutout ? scratch.keys[31 - Math.clz32(side)]! : null;
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) {
        const t = y * side + x;
        const s = t * SUMS;
        const r = sums[s]!;
        const g = sums[s + 1]!;
        const b = sums[s + 2]!;
        const o = offset + t * 4;
        if (translucent) {
          const a = sums[s + 3]!;
          const w = a > 0 ? a : 1;
          dst[o] = toSrgb(lut, r / w);
          dst[o + 1] = toSrgb(lut, g / w);
          dst[o + 2] = toSrgb(lut, b / w);
          dst[o + 3] = Math.round(a / n);
        } else if (keys) {
          // Cor só dos visíveis; sem nenhum visível, a média da cor espalhada (o alfa sai 0 em `applyCoverage`).
          const visible = sums[s + 7]!;
          const k = visible > 0 ? visible : n;
          dst[o] = toSrgb(lut, (visible > 0 ? sums[s + 4]! : r) / k);
          dst[o + 1] = toSrgb(lut, (visible > 0 ? sums[s + 5]! : g) / k);
          dst[o + 2] = toSrgb(lut, (visible > 0 ? sums[s + 6]! : b) / k);
          scratch.cover[t] = visible / n;
          // Cobertura decrescente (mesmo denominador: a ordem do `visible` é a da cobertura), Bayer e índice.
          keys[t] = ((n - visible) * 16 + BAYER4[(y & 3) * 4 + (x & 3)]!) * side * side + t;
        } else {
          dst[o] = toSrgb(lut, r / n);
          dst[o + 1] = toSrgb(lut, g / n);
          dst[o + 2] = toSrgb(lut, b / n);
          dst[o + 3] = 255;
        }
      }
    }
    if (keys) applyCoverage(dst, offset, scratch.cover, keys, side * side, target);
  }
}

/** Maior t em 0..255 com `alpha ≥ t / 255` (a mesma comparação em double da busca do limiar). */
function maxThreshold(alpha: number): number {
  let t = Math.floor(alpha * 255);
  if (t > 255) t = 255;
  else if (t < 0) t = 0;
  while (t < 255 && alpha >= (t + 1) / 255) t++;
  while (t > 0 && !(alpha >= t / 255)) t--;
  return t;
}

/**
 * Converte um nível em double pré-multiplicado para RGBA8 em `dst`. Na cutout, escolhe o limiar t/255 (t = 1..255) cuja
 * cobertura (alfa ≥ limiar) mais aproxima a do nível 0 (o primeiro que melhora mais de 1e−9) e binariza (0 ou 255),
 * como o `discard` do shader espera. A cobertura de cada limiar sai de um histograma (uma passada no nível em vez de
 * 255): o mesmo número da contagem texel a texel, porque a comparação é monótona no limiar.
 */
function writeFromFloat(
  level: Float64Array,
  side: number,
  cutout: boolean,
  target: number,
  dst: Uint8Array,
  offset: number,
  histogram: Uint32Array,
): void {
  const n = side * side;
  let threshold = 0.5;
  if (cutout) {
    histogram.fill(0);
    for (let i = 0; i < n; i++) histogram[maxThreshold(level[i * 4 + 3]!)]!++;
    let best = Infinity;
    let count = n - histogram[0]!;
    for (let t = 1; t <= 255; t++) {
      const err = Math.abs(count / n - target);
      if (err < best - 1e-9) {
        best = err;
        threshold = t / 255;
      }
      count -= histogram[t]!;
    }
  }
  for (let i = 0; i < n; i++) {
    const s = i * 4;
    const a = level[s + 3]!;
    const o = offset + s;
    if (a > 0) {
      dst[o] = Math.round((level[s]! / a) * 255);
      dst[o + 1] = Math.round((level[s + 1]! / a) * 255);
      dst[o + 2] = Math.round((level[s + 2]! / a) * 255);
    } else {
      dst[o] = 0;
      dst[o + 1] = 0;
      dst[o + 2] = 0;
    }
    dst[o + 3] = cutout ? (a >= threshold && a > 0 ? 255 : 0) : Math.round(a * 255);
  }
}

/** Caixa 2×2 sobre o pré-multiplicado (o transparente não escurece a borda); no lado 1, repete o texel. */
function downsampleFloat(src: Float64Array, srcSide: number, dst: Float64Array): void {
  const side = Math.max(1, srcSide >> 1);
  const step = srcSide > 1 ? 1 : 0;
  for (let y = 0; y < side; y++) {
    const row0 = y * 2 * srcSide;
    const row1 = (y * 2 + step) * srcSide;
    for (let x = 0; x < side; x++) {
      const p00 = (row0 + x * 2) * 4;
      const p01 = (row0 + x * 2 + step) * 4;
      const p10 = (row1 + x * 2) * 4;
      const p11 = (row1 + x * 2 + step) * 4;
      const d = (y * side + x) * 4;
      // Canal a canal, na ordem da soma de antes ((((0 + 00) + 01) + 10) + 11): o double sai idêntico.
      dst[d] = (src[p00]! + src[p01]! + src[p10]! + src[p11]!) / 4;
      dst[d + 1] = (src[p00 + 1]! + src[p01 + 1]! + src[p10 + 1]! + src[p11 + 1]!) / 4;
      dst[d + 2] = (src[p00 + 2]! + src[p01 + 2]! + src[p10 + 2]! + src[p11 + 2]!) / 4;
      dst[d + 3] = (src[p00 + 3]! + src[p01 + 3]! + src[p10 + 3]! + src[p11 + 3]!) / 4;
    }
  }
}

/** Filtro `premultiplied` (modelgen): níveis 1.. de uma camada, em cascata (ver o cabeçalho). */
function writePremultiplied(
  levels: readonly Uint8Array[],
  size: number,
  layer: number,
  cutout: boolean,
  scratch: LayerMipScratch,
): void {
  const texels = size * size;
  const level0 = levels[0]!;
  const base = layer * texels * 4;
  let opaque = 0;
  for (let i = 0; i < texels; i++) if (level0[base + i * 4 + 3]! >= 128) opaque++;
  const target = opaque / texels;
  let current = scratch.floatA;
  let spare = scratch.floatB;
  if (levels.length < 2) return;
  // Nível 1 direto dos bytes: o texel pré-multiplicado de antes ((v/255)·(a/255)) é calculado na hora, com as mesmas
  // contas, e somado na mesma ordem; o nível 0 em double não precisa existir.
  const half = Math.max(1, size >> 1);
  const step = size > 1 ? 4 : 0;
  const rowStep = size > 1 ? size * 4 : 0;
  for (let y = 0; y < half; y++) {
    for (let x = 0; x < half; x++) {
      const i00 = base + (y * 2 * size + x * 2) * 4;
      const i01 = i00 + step;
      const i10 = i00 + rowStep;
      const i11 = i10 + step;
      const a00 = level0[i00 + 3]! / 255;
      const a01 = level0[i01 + 3]! / 255;
      const a10 = level0[i10 + 3]! / 255;
      const a11 = level0[i11 + 3]! / 255;
      const d = (y * half + x) * 4;
      current[d] =
        ((level0[i00]! / 255) * a00 +
          (level0[i01]! / 255) * a01 +
          (level0[i10]! / 255) * a10 +
          (level0[i11]! / 255) * a11) /
        4;
      current[d + 1] =
        ((level0[i00 + 1]! / 255) * a00 +
          (level0[i01 + 1]! / 255) * a01 +
          (level0[i10 + 1]! / 255) * a10 +
          (level0[i11 + 1]! / 255) * a11) /
        4;
      current[d + 2] =
        ((level0[i00 + 2]! / 255) * a00 +
          (level0[i01 + 2]! / 255) * a01 +
          (level0[i10 + 2]! / 255) * a10 +
          (level0[i11 + 2]! / 255) * a11) /
        4;
      current[d + 3] = (a00 + a01 + a10 + a11) / 4;
    }
  }
  let currentSide = half;
  writeFromFloat(current, half, cutout, target, levels[1]!, layer * half * half * 4, scratch.histogram);
  for (let level = 2; level < levels.length; level++) {
    const side = Math.max(1, currentSide >> 1);
    downsampleFloat(current, currentSide, spare);
    const swap = current;
    current = spare;
    spare = swap;
    currentSide = side;
    writeFromFloat(current, side, cutout, target, levels[level]!, layer * side * side * 4, scratch.histogram);
  }
}

/**
 * Escreve os níveis 1..`levels.length`−1 da camada `layer` de uma cadeia de array (cada nível com as camadas uma após
 * a outra, como `TextureArrayData.levels`) a partir do nível 0 dela, pelo filtro da ferramenta. `kind` e `cutout` são os
 * da entrada do manifesto (o `linear` olha o `kind`; o `premultiplied`, o `cutout`). Os níveis da camada são
 * sobrescritos inteiros (os 4 canais de todo texel).
 */
export function writeLayerMipChain(
  levels: readonly Uint8Array[],
  size: number,
  layer: number,
  filter: LayerMipFilter,
  kind: LayerKind,
  cutout: boolean,
  scratch: LayerMipScratch,
): void {
  if (scratch.size < size) throw new Error(`mips: rascunho de ${scratch.size}, camada de ${size}`);
  if (filter === 'linear') writeLinear(levels, size, layer, kind, scratch);
  else writePremultiplied(levels, size, layer, cutout, scratch);
}

/**
 * Gera os mips de uma tira inteira já copiada no nível 0 de `levels` a partir da camada `firstLayer` (o caminho do
 * `assembleTextureArray` quando a tira chega sem `.mips.png`): filtro pelo `source` do manifesto.
 */
export function writeStripMips(
  manifest: LayerManifest,
  levels: readonly Uint8Array[],
  firstLayer: number,
  scratch: LayerMipScratch,
): void {
  const filter = LAYER_MIP_FILTER[manifest.source];
  const size = manifest.layerWidth;
  const entries = manifest.layers;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    writeLayerMipChain(levels, size, firstLayer + i, filter, e.kind, e.cutout, scratch);
  }
}

/**
 * Os níveis 1..`levels`−1 de UMA camada quadrada como imagens soltas (folha de contato e testes das ferramentas). O
 * nível 0 é a própria imagem. `cutout` padrão: `kind === 'cutout'` (o que as duas ferramentas gravam no manifesto).
 */
export function buildLayerMipChain(
  image: RgbaImage,
  levels: number,
  filter: LayerMipFilter,
  kind: LayerKind,
  cutout: boolean = kind === 'cutout',
): RgbaImage[] {
  const size = image.width;
  if (image.height !== size) throw new Error('mips: camada precisa ser quadrada');
  const chain: Uint8Array[] = [image.data.subarray(0, size * size * 4)];
  for (let level = 1; level < levels; level++) chain.push(new Uint8Array(mipSize(size, level) ** 2 * 4));
  writeLayerMipChain(chain, size, 0, filter, kind, cutout, createLayerMipScratch(size));
  return chain.slice(1).map((data, k) => ({ width: mipSize(size, k + 1), height: mipSize(size, k + 1), data }));
}

/** A camada com a cor dos texels visíveis espalhada nos buracos, como o filtro `linear` usa (cópia; para os testes). */
export function bleedTransparent(image: RgbaImage): RgbaImage {
  const size = image.width;
  if (image.height !== size) throw new Error('mips: camada precisa ser quadrada');
  const data = new Uint8Array(image.data);
  bleedInPlace(data, size, createLayerMipScratch(size), srgbLut());
  return { width: size, height: size, data };
}

/** Fração de texels visíveis (alfa ≥ 128) de uma imagem. */
export function layerCoverage(image: RgbaImage): number {
  let visible = 0;
  const n = image.width * image.height;
  for (let i = 0; i < n; i++) if (image.data[i * 4 + 3]! >= 128) visible++;
  return visible / n;
}
