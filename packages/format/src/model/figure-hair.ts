/**
 * Cabelo e acessórios da cabeça do boneco (decisão #56; PLANO do porte §B8 e §C3). Dona: frente F1. Porte do
 * `buildHair` do FutBobo (`character.ts:378-616`) sem `Object3D`, `Box3` nem `Euler`: o giro de cada caixa é
 * Rx(rotX)·Rz(rotZ) (o Euler XYZ do three com y 0), a AABB do `around` sai de |R|·meias medidas e o eixo das pontas é
 * Rx·Rz·(0; 1; 0). Mesma ordem de caixas do FutBobo.
 *
 * Tudo no osso `head` (o `neck` do FutBobo: a cabeça ocupa y 0..8 e x/z ±4), com a flag `hair`, cor de amostra da
 * paleta (`FIGURE_SWATCH`: cabelo = topo do cabelo, sombra, barba, acessório, sombra do acessório e ouro, como o
 * `HEAD_TONE_PAINT` do FutBobo) e giro em `rotX`/`rotZ`. Depende só de (corte 0..33, chapéu 0..4, barba longa,
 * brincos 0..3): 1.360 combinações, de 0 a 28 caixas. Roda no loading (gabaritos), nunca por quadro.
 */
import { FIGURE_BONE, FIGURE_BOX_FIELD, FIGURE_BOX_FLAG, FIGURE_BOX_STRIDE } from './figure.ts';
import { FIGURE_LAYOUT, FIGURE_SWATCH, figureSwatchCorner } from './figure-layout.ts';
import type { FigureLook } from './figure-look.ts';

/** Teto de caixas de cabelo e acessórios por look (twists + faixa + barba longa + argolas = 28). */
export const FIGURE_HAIR_MAX_BOXES = 28;
/** Chapéus (`HEADWEAR_NAMES` do FutBobo, `textures.ts:154-157`). */
export const FIGURE_HEADWEAR = { none: 0, band: 1, tiara: 2, bandana: 3, cap: 4 } as const;
/** Brincos (`EARRING_NAMES`, `textures.ts:161-162`): 1 = um só, na esquerda (+x); 2 = par; 3 = argolas. */
export const FIGURE_EARRING = { none: 0, stud: 1, pair: 2, hoops: 3 } as const;
/** Barba que vira caixa (`beard === 8`, "Barba longa"); as outras são só pintura. */
export const FIGURE_BEARD_LONG = 8;

/** Acima disto (centro do bloco, px no pescoço) o cabelo fica dentro do boné ou da bandana (`UNDER_CAP_Y`). */
const UNDER_CAP_Y = 7.9;
/** Folga do `around` em volta do cabelo abraçado (px). */
const AROUND_MARGIN = 0.15;
/** Campos do rascunho: w, h, d, x, y, z, rotX, rotZ, tom (amostra). */
const PART = 9;
/** Rascunho: o maior corte (17) antes do recorte do boné cabe com folga, e o total nunca passa de 28. */
const SCRATCH_PARTS = 48;

/** Rascunho da montagem de um look (alocado por chamada, no loading). */
interface HairBuild {
  readonly parts: Float64Array;
  n: number;
  /** Tom corrente (`FIGURE_SWATCH`). */
  tone: number;
  /** Saída do `around`: x, z, largura, profundidade. */
  readonly ring: Float64Array;
}

function add(b: HairBuild, w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, rz = 0): void {
  if (b.n >= SCRATCH_PARTS) throw new Error('figure: cabelo com caixas demais');
  const o = b.n * PART;
  const p = b.parts;
  p[o] = w;
  p[o + 1] = h;
  p[o + 2] = d;
  p[o + 3] = x;
  p[o + 4] = y;
  p[o + 5] = z;
  p[o + 6] = rx;
  p[o + 7] = rz;
  p[o + 8] = b.tone;
  b.n++;
}

/** Casca do topo (`shell`): `size` × `height` × `size` com a base 0,15 px abaixo do topo da cabeça. */
function shell(b: HairBuild, height = 1.1, size = 8.5): void {
  add(b, size, height, size, 0, 8 + height / 2 - 0.15, 0);
}

/**
 * Ponta de cabelo (`spike`): base larga e bico com metade da largura, inclinados por Rx(z·0,1)·Rz(−x·0,1) para fora do
 * centro da cabeça, a partir de y 8,3, ao longo do eixo girado.
 */
function spike(b: HairBuild, x: number, z: number, height: number, width = 1.9): void {
  const tx = z * 0.1;
  const tz = -x * 0.1;
  // Rx(tx)·Rz(tz)·(0; 1; 0).
  const ax = -Math.sin(tz);
  const ay = Math.cos(tz) * Math.cos(tx);
  const az = Math.cos(tz) * Math.sin(tx);
  const base = 8.3;
  const piece = height * 0.55;
  const low = piece / 2;
  const high = height - piece / 2;
  add(b, width, piece, width, x + ax * low, base + ay * low, z + az * low, tx, tz);
  add(b, width * 0.5, piece, width * 0.5, x + ax * high, base + ay * high, z + az * high, tx, tz);
}

/**
 * Caixa que abraça a cabeça (meia aresta `half`) e todo cabelo (tom cabelo ou sombra) da faixa [y0, y1] com ≥ 3 px de
 * largura ou profundidade, pela AABB das caixas giradas, com margem de 0,15 (`around`). Escreve em b.ring.
 */
function around(b: HairBuild, y0: number, y1: number, half: number): void {
  let minX = -half;
  let maxX = half;
  let minZ = -half;
  let maxZ = half;
  const p = b.parts;
  for (let i = 0; i < b.n; i++) {
    const o = i * PART;
    const tone = p[o + 8]!;
    if (tone !== FIGURE_SWATCH.hair && tone !== FIGURE_SWATCH.hairShade) continue;
    const hw = p[o]! / 2;
    const hh = p[o + 1]! / 2;
    const hd = p[o + 2]! / 2;
    const cx = Math.cos(p[o + 6]!);
    const sx = Math.sin(p[o + 6]!);
    const cz = Math.cos(p[o + 7]!);
    const sz = Math.sin(p[o + 7]!);
    // R = Rx·Rz = [cz, −sz, 0; cx·sz, cx·cz, −sx; sx·sz, sx·cz, cx]: meia AABB = |R|·meias medidas.
    const ex = Math.abs(cz) * hw + Math.abs(sz) * hh;
    const ey = Math.abs(cx * sz) * hw + Math.abs(cx * cz) * hh + Math.abs(sx) * hd;
    const ez = Math.abs(sx * sz) * hw + Math.abs(sx * cz) * hh + Math.abs(cx) * hd;
    const y = p[o + 4]!;
    if (y + ey < y0 + 0.2 || y - ey > y1 - 0.2) continue;
    if (Math.max(2 * ex, 2 * ez) < 3) continue;
    const x = p[o + 3]!;
    const z = p[o + 5]!;
    minX = Math.min(minX, x - ex);
    maxX = Math.max(maxX, x + ex);
    minZ = Math.min(minZ, z - ez);
    maxZ = Math.max(maxZ, z + ez);
  }
  b.ring[0] = (minX + maxX) / 2;
  b.ring[1] = (minZ + maxZ) / 2;
  b.ring[2] = maxX - minX + AROUND_MARGIN * 2;
  b.ring[3] = maxZ - minZ + AROUND_MARGIN * 2;
}

/** Volume de cabelo de cada corte (o `switch` do `buildHair`); os cortes 5, 12 e 20 são só pintura. */
function hairStyle(b: HairBuild, style: number): void {
  switch (style) {
    case 0:
      shell(b);
      break;
    case 1:
      shell(b);
      add(b, 8.5, 1.5, 0.9, 0, 7.4, 4.05);
      break;
    case 2: {
      shell(b, 1.4, 8.7);
      const tufts = [-2.6, -2.6, 0, -2.8, 2.6, -2.4, -2.8, 0, 0.2, 0.1, 2.7, 0.3, -2.4, 2.6, 0.1, 2.8, 2.6, 2.5];
      for (let i = 0; i < tufts.length; i += 2) add(b, 2, 1.2, 2, tufts[i]!, 9.5, tufts[i + 1]!);
      break;
    }
    case 3:
      add(b, 1.9, 3.1, 8.8, 0, 9.3, 0);
      break;
    case 4:
      add(b, 10.6, 5.4, 10.6, 0, 8.3, -0.3);
      break;
    case 6:
      shell(b, 0.9, 8.4);
      for (let x = -3; x <= 3; x += 2) add(b, 1, 4.2, 1, x, 4.6, -4.35);
      break;
    case 7:
      shell(b, 1.1);
      add(b, 5.4, 0.9, 8.7, 1.6, 9.1, 0);
      break;
    case 8:
      shell(b, 1.1);
      add(b, 6.4, 2.4, 3.2, 0, 9.6, 2.5, -0.35);
      break;
    case 9: {
      shell(b, 1.2, 8.7);
      // Dreads: (x, z, comprimento), pendurados de y 8,4.
      const locks = [
        -4.2, -2, 7, -4.2, 1, 6, 4.2, -2, 7, 4.2, 1, 6, -2.6, -4.2, 8, -0.8, -4.2, 8.5, 1, -4.2, 8, 2.8, -4.2, 7.5,
      ];
      for (let i = 0; i < locks.length; i += 3) {
        const length = locks[i + 2]!;
        add(b, 1.2, length, 1.2, locks[i]!, 8.4 - length / 2, locks[i + 1]!);
      }
      break;
    }
    case 10:
      shell(b, 0.9, 8.4);
      add(b, 3.2, 3, 3.2, 0, 10.2, -1.6);
      break;
    case 11:
      shell(b);
      break;
    case 13:
      shell(b);
      add(b, 7.4, 4.8, 1.1, 0, 4.2, -4.4);
      break;
    case 14:
      add(b, 8.9, 3.5, 8.9, 0, 7.2, 0);
      break;
    case 15:
      add(b, 3.6, 2.1, 8.8, 0, 8.9, 0);
      break;
    case 16:
      shell(b, 0.9, 8.4);
      for (let x = -3; x <= 3; x += 2) for (let z = -3; z <= 3; z += 2) add(b, 1.3, 1.6, 1.3, x, 9.4, z);
      break;
    case 17:
      shell(b);
      add(b, 5.2, 3, 0.9, 1.4, 6.8, 4.05);
      break;
    case 18:
      add(b, 7.4, 1.8, 8.4, 0, 8.7, 0);
      break;
    case 19:
      shell(b, 0.9, 8.4);
      add(b, 2.1, 5.6, 2.1, 0, 5.4, -5.1, 0.32);
      add(b, 2.4, 0.9, 2.4, 0, 7.8, -4.6);
      break;
    case 21:
      add(b, 9.3, 2.5, 9.3, 0, 8.9, 0);
      break;
    case 22:
      // Cascão: só o triângulo da frente, base larga na testa.
      add(b, 3.2, 0.8, 2.1, 0, 8.25, 3.05);
      add(b, 1.8, 0.7, 1.6, 0, 8.2, 1.4);
      break;
    case 23:
      // Longo solto: laterais e costas até o ombro, franja leve de lado.
      shell(b, 1.2, 8.7);
      add(b, 0.9, 9, 7.4, -4.45, 3.6, -0.95);
      add(b, 0.9, 9, 7.4, 4.45, 3.6, -0.95);
      add(b, 8.9, 10, 0.9, 0, 3.1, -4.45);
      add(b, 6.2, 1, 0.5, -0.9, 7.35, 4.15, 0, 0.12);
      break;
    case 24: {
      shell(b, 1, 8.5);
      const spikes = [
        -2.6, -2.4, 3.2, 0.2, -2.8, 3.6, 2.7, -2.2, 3, -2.9, 0.6, 3, 0, 0.3, 3.8, 2.8, 0.8, 3.2, -0.4, 3, 2.8,
      ];
      for (let i = 0; i < spikes.length; i += 3) spike(b, spikes[i]!, spikes[i + 1]!, spikes[i + 2]!);
      break;
    }
    case 25:
      // Repartido: duas metades com a risca no meio (a risca é a textura) e as cortinas na testa.
      for (let side = -1; side <= 1; side += 2) {
        add(b, 3.9, 1.2, 8.5, side * 2.25, 8.4, -0.1, 0, -side * 0.1);
        add(b, 3.4, 1.1, 0.8, side * 2.3, 7.15, 4.1, 0, -side * 0.42);
      }
      break;
    case 26:
      // Hi-top: o bloco reto bem acima da cabeça.
      add(b, 7.6, 5.2, 7.6, 0, 9.6, -0.1);
      break;
    case 27: {
      // Nagô: fileiras baixas da testa até a nuca; o couro entre elas é a textura.
      const rows = [-3, -1.5, 0, 1.5, 3];
      for (let i = 0; i < rows.length; i++) {
        add(b, 1, 0.55, 8.3, rows[i]!, 8.2, 0);
        add(b, 1, 4.6, 0.5, rows[i]!, 5.75, -4.15);
      }
      break;
    }
    case 28:
      for (let side = -1; side <= 1; side += 2) {
        add(b, 3.2, 2.2, 3.2, side * 2.5, 9.3, -0.6);
        add(b, 2.2, 3.2, 2.2, side * 2.5, 9.5, -0.6);
      }
      break;
    case 29:
      // Pra trás: rente na frente, volume crescendo para a nuca.
      add(b, 8.4, 0.6, 2.4, 0, 8.15, 1);
      add(b, 8.5, 1.3, 4.4, 0, 8.45, -1.95);
      add(b, 8.6, 1.6, 1.3, 0, 7.7, -3.75);
      break;
    case 30: {
      add(b, 1.9, 0.7, 8.6, 0, 8.2, 0);
      const crest = [-3.4, 3.6, -1.7, 4.4, 0, 5, 1.7, 4.6, 3.4, 3.8];
      for (let i = 0; i < crest.length; i += 2) spike(b, 0, crest[i]!, crest[i + 1]!, 1.7);
      break;
    }
    case 31:
      // Afro gigante: blocos cruzados para arredondar.
      add(b, 13, 6.4, 11, 0, 10.2, -1);
      add(b, 10.4, 8.4, 13, 0, 10, -1);
      add(b, 14.4, 4.4, 8.6, 0, 9.6, -1.2);
      add(b, 12.6, 3, 9.4, 0, 5.6, -1.6);
      add(b, 8.4, 1.2, 8.4, 0, 14.6, -1);
      break;
    case 32:
      // Chanel: capacete até o queixo com a franja reta.
      shell(b, 1.3, 8.8);
      add(b, 7.8, 0.5, 7.8, 0, 9.35, 0);
      add(b, 0.8, 6.6, 8.6, -4.4, 4.9, -0.1);
      add(b, 0.8, 6.6, 8.6, 4.4, 4.9, -0.1);
      add(b, 8.8, 6.6, 0.8, 0, 4.9, -4.4);
      add(b, 8.8, 2.2, 0.8, 0, 7, 4.35);
      break;
    case 33: {
      // Trança longa: elos alternados descendo pelas costas, meio de lado.
      shell(b, 1, 8.5);
      add(b, 2.4, 1.4, 1.3, 0.4, 4.2, -4.55);
      const links = 6;
      for (let index = 0; index < links; index++) {
        const y = 3 - index * 1.55;
        const z = -4.65 + (3 - y) * 0.17;
        const width = 2 - index * 0.12;
        b.tone = FIGURE_SWATCH.hair;
        add(b, width, 1.15, 1.5, 0.4, y, z, -0.17);
        b.tone = FIGURE_SWATCH.hairShade;
        add(b, width * 0.72, 0.5, 1.2, 0.4, y - 0.78, z + 0.13, -0.17);
      }
      b.tone = FIGURE_SWATCH.hair;
      add(b, 1.4, 1.3, 1.2, 0.4, 3 - links * 1.55 - 0.2, -4.65 + (links * 1.55 + 0.2) * 0.17, -0.17);
      break;
    }
    default:
      break;
  }
}

/**
 * Cabelo e acessórios do look (porte do `buildHair`): caixas no osso `head` com a flag `hair`, de 0 a 28. Escreve em
 * out[o ..] (`FIGURE_BOX_FIELD`, px no espaço do osso) e devolve quantas escreveu. Ordem do FutBobo: o corte (sem o
 * que fica dentro do boné ou da bandana), a fuga do black power sob o boné, a barba longa, o chapéu e os brincos.
 */
export function figureHairBoxes(look: FigureLook, out: Float32Array, o: number): number {
  const b: HairBuild = {
    parts: new Float64Array(SCRATCH_PARTS * PART),
    n: 0,
    tone: FIGURE_SWATCH.hair,
    ring: new Float64Array(4),
  };
  hairStyle(b, look.hairStyle);

  if (look.headwear === FIGURE_HEADWEAR.cap || look.headwear === FIGURE_HEADWEAR.bandana) {
    // Boné e bandana: some o volume de cima; fica o que aparece por baixo (franja, nuca, cabelo comprido).
    let kept = 0;
    for (let i = 0; i < b.n; i++) {
      if (b.parts[i * PART + 4]! > UNDER_CAP_Y) continue;
      if (kept !== i) b.parts.copyWithin(kept * PART, i * PART, (i + 1) * PART);
      kept++;
    }
    b.n = kept;
    // O black power escapa pelos lados (atrás do rosto, sem tapar a sobrancelha).
    if (look.hairStyle === 4) add(b, 9.8, 2.2, 9.6, 0, 6.6, -1);
  }

  if (look.beard === FIGURE_BEARD_LONG) {
    // Barba longa: desce do queixo pela frente do peito.
    b.tone = FIGURE_SWATCH.beard;
    add(b, 6.4, 2.6, 1.5, 0, -0.95, 3.45);
    add(b, 4.2, 1.7, 1.3, 0, -2.9, 3.35);
  }

  const ring = b.ring;
  switch (look.headwear) {
    case FIGURE_HEADWEAR.band:
      around(b, 6.5, 7.5, 4);
      b.tone = FIGURE_SWATCH.accessory;
      add(b, ring[2]!, 1, ring[3]!, ring[0]!, 7, ring[1]!);
      break;
    case FIGURE_HEADWEAR.tiara:
      around(b, 7, 7.5, 4);
      b.tone = FIGURE_SWATCH.accessory;
      add(b, ring[2]!, 0.5, ring[3]!, ring[0]!, 7.25, ring[1]!);
      break;
    case FIGURE_HEADWEAR.bandana: {
      // O nó vai por fora do cabelo comprido da nuca.
      around(b, 5.6, 6.8, 4);
      const back = ring[1]! - ring[3]! / 2;
      b.tone = FIGURE_SWATCH.accessory;
      add(b, 1.8, 1.3, 1, 0, 6.2, back - 0.25);
      b.tone = FIGURE_SWATCH.accessoryShade;
      add(b, 0.9, 2.2, 0.4, -0.55, 4.9, back - 0.45, 0.12, 0.22);
      add(b, 0.9, 1.9, 0.4, 0.6, 5.05, back - 0.4, 0.1, -0.18);
      break;
    }
    case FIGURE_HEADWEAR.cap: {
      // Copa do tamanho do que ficou de cabelo; aba para a frente, caída de leve.
      around(b, 6.8, 9.4, 4.35);
      const x = ring[0]!;
      const z = ring[1]!;
      const width = ring[2]!;
      const depth = ring[3]!;
      b.tone = FIGURE_SWATCH.accessory;
      add(b, width, 2.6, depth, x, 8.1, z);
      add(b, width - 0.8, 0.6, depth - 0.8, x, 9.6, z);
      b.tone = FIGURE_SWATCH.accessoryShade;
      add(b, Math.min(width - 1.2, 7.8), 0.4, 4.2, x, 6.95, z + depth / 2 + 1.7, 0.1);
      add(b, 1.2, 0.35, 1.2, x, 10.05, z);
      break;
    }
    default:
      break;
  }

  if (look.earrings > 0) {
    // Na ponta da orelha (o pixel dourado da pintura fica por baixo); um brinco só vai na esquerda (+x).
    b.tone = FIGURE_SWATCH.gold;
    for (let side = look.earrings === FIGURE_EARRING.stud ? 1 : -1; side <= 1; side += 2) {
      const x = side * 4.2;
      if (look.earrings === FIGURE_EARRING.hoops) {
        add(b, 0.3, 0.3, 1.3, x, 2.2, 0.25);
        add(b, 0.3, 0.3, 1.3, x, 1.2, 0.25);
        add(b, 0.3, 1.3, 0.3, x, 1.7, 0.75);
        add(b, 0.3, 1.3, 0.3, x, 1.7, -0.25);
      } else add(b, 0.55, 0.55, 0.55, x, 2.3, 0.25);
    }
  }

  if (b.n > FIGURE_HAIR_MAX_BOXES) throw new Error(`figure: ${b.n} caixas de cabelo passam do teto de 28`);
  const F = FIGURE_BOX_FIELD;
  const layer = FIGURE_LAYOUT.palette.layer;
  for (let i = 0; i < b.n; i++) {
    const s = i * PART;
    const d = o + i * FIGURE_BOX_STRIDE;
    const corner = figureSwatchCorner(b.parts[s + 8]!);
    const u = corner % 64;
    out[d + F.bone] = FIGURE_BONE.head;
    out[d + F.cx] = b.parts[s + 3]!;
    out[d + F.cy] = b.parts[s + 4]!;
    out[d + F.cz] = b.parts[s + 5]!;
    out[d + F.sx] = b.parts[s]!;
    out[d + F.sy] = b.parts[s + 1]!;
    out[d + F.sz] = b.parts[s + 2]!;
    out[d + F.rotX] = b.parts[s + 6]!;
    out[d + F.rotZ] = b.parts[s + 7]!;
    out[d + F.layer] = layer;
    out[d + F.u] = u;
    out[d + F.v] = (corner - u) / 64;
    out[d + F.w] = 0;
    out[d + F.h] = 0;
    out[d + F.d] = 0;
    out[d + F.flags] = FIGURE_BOX_FLAG.hair;
  }
  return b.n;
}
