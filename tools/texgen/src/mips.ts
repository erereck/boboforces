import type { LayerKind } from '@boboforces/format';
import type { RgbaImage } from './png.ts';

/**
 * Mips das camadas (tecnico.md §6.1, arte-ux.md §1.6), feitos no build e enviados nível a nível:
 * - cada texel do nível k é a média da área 2^k × 2^k do nível 0 (não em cascata, para não acumular arredondamento);
 * - a média é em luz LINEAR (sRGB → linear → sRGB), para o chão ao longe não escurecer;
 * - opaca e emissiva: alfa 255;
 * - cutout: a cor é a média só dos texels visíveis e o alfa preserva a COBERTURA do nível 0 no corte de 0,5 do
 *   shader (a cerca e a folhagem não somem nem engordam ao longe);
 * - translúcida: cor ponderada pelo alfa e alfa médio.
 * Tudo em inteiros depois da tabela sRGB → linear (arredondada), para sair igual byte a byte em qualquer máquina.
 */

/** sRGB (byte) → linear, em milionésimos (inteiro). */
const TO_LINEAR: readonly number[] = Array.from({ length: 256 }, (_, i) => {
  const c = i / 255;
  const lin = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  return Math.round(lin * 1_000_000);
});

/** Linear (milionésimos, pode ser fracionário) → byte sRGB mais próximo (busca binária na tabela). */
function toSrgb(linear: number): number {
  let lo = 0;
  let hi = 255;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (TO_LINEAR[mid]! < linear) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && linear - TO_LINEAR[lo - 1]! <= TO_LINEAR[lo]! - linear) return lo - 1;
  return lo;
}

/** Lado do nível de mip `level` (1..) de uma camada quadrada de lado `size`. */
export function mipSize(size: number, level: number): number {
  return Math.max(1, size >> level);
}

/**
 * Espalha a cor dos texels visíveis para os transparentes vizinhos (alfa continua 0). Sem isso o filtro entre níveis
 * (`NEAREST_MIPMAP_LINEAR`) puxaria a borda da folha para o preto dos buracos. Com wrap (camadas repetem).
 */
export function bleedTransparent(image: RgbaImage): RgbaImage {
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
            r += TO_LINEAR[data[j * 4]!]!;
            g += TO_LINEAR[data[j * 4 + 1]!]!;
            b += TO_LINEAR[data[j * 4 + 2]!]!;
            n++;
          }
        }
        if (n === 0) continue;
        data[i * 4] = toSrgb(r / n);
        data[i * 4 + 1] = toSrgb(g / n);
        data[i * 4 + 2] = toSrgb(b / n);
        next[i] = 1;
        pending--;
      }
    }
    known = next;
  }
  return { width: w, height: h, data };
}

/** Os níveis 1..`levels`−1 de uma camada (o nível 0 é a própria imagem). */
export function buildMipChain(image: RgbaImage, kind: LayerKind, levels: number): RgbaImage[] {
  const size = image.width;
  if (image.height !== size) throw new Error('mips: camada precisa ser quadrada');
  const src = kind === 'cutout' ? bleedTransparent(image) : image;
  const d = src.data;
  const out: RgbaImage[] = [];
  const opaqueCoverage = kind === 'cutout' ? coverage(image) : 1;
  for (let level = 1; level < levels; level++) {
    const side = mipSize(size, level);
    const f = size / side;
    const data = new Uint8Array(side * side * 4);
    // Cobertura bruta (0..1) de cada texel, para a escala do alfa das cutout.
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
            const lr = TO_LINEAR[d[i]!]!;
            const lg = TO_LINEAR[d[i + 1]!]!;
            const lb = TO_LINEAR[d[i + 2]!]!;
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
          data[o] = toSrgb(r / w);
          data[o + 1] = toSrgb(g / w);
          data[o + 2] = toSrgb(b / w);
          data[o + 3] = Math.round(a / n);
        } else if (kind === 'cutout') {
          // Cor só dos visíveis; sem nenhum visível, a média da cor espalhada (o alfa sai 0 em `applyCoverage`).
          const k = visible > 0 ? visible : n;
          data[o] = toSrgb((visible > 0 ? vr : r) / k);
          data[o + 1] = toSrgb((visible > 0 ? vg : g) / k);
          data[o + 2] = toSrgb((visible > 0 ? vb : b) / k);
          cover[y * side + x] = visible / n;
        } else {
          data[o] = toSrgb(r / n);
          data[o + 1] = toSrgb(g / n);
          data[o + 2] = toSrgb(b / n);
          data[o + 3] = 255;
        }
      }
    }
    if (kind === 'cutout') applyCoverage(data, cover, side, opaqueCoverage);
    out.push({ width: side, height: side, data });
  }
  return out;
}

/** Fração de texels visíveis (alfa ≥ 128) de uma camada. */
export function coverage(image: RgbaImage): number {
  let visible = 0;
  const n = image.width * image.height;
  for (let i = 0; i < n; i++) if (image.data[i * 4 + 3]! >= 128) visible++;
  return visible / n;
}

/** Ordem de Bayer 4×4: desempata texels de mesma cobertura espalhando os escolhidos (sem aglomerar num canto). */
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5] as const;

/**
 * Alfa de um nível de cutout com a COBERTURA do nível 0 preservada (à moda de Castaño): exatamente
 * round(cobertura × texels) texels ficam acima do corte do shader (0,5), os de maior cobertura bruta primeiro e, no
 * empate (padrão uniforme como a cerca de arame), pela ordem de Bayer. O alfa sai suave (escala da cobertura bruta,
 * preso abaixo ou acima de 0,5): o filtro entre níveis mistura dois mips e o `discard` corta depois. Texel sem
 * cobertura nenhuma nunca aparece.
 */
function applyCoverage(data: Uint8Array, cover: Float64Array, side: number, target: number): void {
  const n = cover.length;
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => {
    const dc = cover[b]! - cover[a]!;
    if (dc !== 0) return dc;
    const ba = BAYER4[((a / side) & 3) * 4 + ((a % side) & 3)]!;
    const bb = BAYER4[((b / side) & 3) * 4 + ((b % side) & 3)]!;
    return ba !== bb ? ba - bb : a - b;
  });
  const keep = Math.round(target * n);
  // Menor cobertura positiva entre as escolhidas: ela vira exatamente 0,5.
  let threshold = 0;
  for (let k = keep - 1; k >= 0 && threshold === 0; k--) threshold = cover[order[k]!]!;
  const scale = threshold > 0 ? 0.5 / threshold : 0;
  order.forEach((i, rank) => {
    const c = cover[i]!;
    const a = Math.min(255, Math.round(c * scale * 255));
    data[i * 4 + 3] = c > 0 && rank < keep ? Math.max(128, a) : Math.min(127, a);
  });
}
