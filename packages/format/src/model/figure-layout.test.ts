import { describe, expect, it } from 'vitest';
import { boxCrossRects, ZOMBIE_KINDS } from './bobo.ts';
import { FIGURE_BODY_BOXES, FIGURE_BOX_FIELD, FIGURE_BOX_FLAG, FIGURE_BOX_STRIDE, FIGURE_MAX_BOXES } from './figure.ts';
import {
  FIGURE_LAYOUT,
  FIGURE_SKIN_BYTES,
  FIGURE_SKIN_LAYERS,
  FIGURE_SKIN_LEVEL1_BYTES,
  FIGURE_SWATCH,
  figureSwatchCorner,
} from './figure-layout.ts';
import { normalizeFigureLook, type FigureLook } from './figure-look.ts';
import { FIGURE_PAINT_REGIONS, paintFigureSkin } from './figure-paint.ts';
import { FIGURE_PRESETS, type FigurePresetId } from './figure-presets.ts';
import { buildFigureTemplate } from './figure-template.ts';

interface Rect {
  readonly what: string;
  readonly layer: number;
  readonly u: number;
  readonly v: number;
  readonly w: number;
  readonly h: number;
}

/** As 6 faces de uma cruz w×h×d com canto (u, v), na ordem +X, −X, topo, base, costas, frente (como o `boxCrossRects`). */
function crossFaces(what: string, layer: number, u: number, v: number, w: number, h: number, d: number): Rect[] {
  return [
    { what: `${what} +X`, layer, u, v: v + d, w: d, h },
    { what: `${what} −X`, layer, u: u + d + w, v: v + d, w: d, h },
    { what: `${what} topo`, layer, u: u + d, v, w, h: d },
    { what: `${what} base`, layer, u: u + d + w, v, w, h: d },
    { what: `${what} costas`, layer, u: u + 2 * d + w, v: v + d, w, h },
    { what: `${what} frente`, layer, u: u + d, v: v + d, w, h },
  ];
}

const L = FIGURE_LAYOUT;
const EXPRESSIONS = 8;

/** Regiões usadas do layout (§B7 do plano), com as calhas e células que o pintor preenche. */
function usedRegions(): Rect[] {
  const out: Rect[] = [];
  const p = L.palette;
  out.push({ what: 'paleta', layer: p.layer, u: p.u, v: p.v, w: p.cell * p.cols, h: p.cell * p.cols });
  out.push(...crossFaces('cabeça', L.head.layer, L.head.u, L.head.v, L.head.w, L.head.h, L.head.d));
  for (let e = 0; e < EXPRESSIONS; e++) {
    const c = L.expressions.cell;
    out.push({
      what: `expressão ${e}`,
      layer: L.expressions.layer,
      u: c * (e % 4),
      v: L.expressions.v + c * (e >> 2),
      w: c,
      h: c,
    });
  }
  out.push(...crossFaces('tronco', L.torso.layer, L.torso.u, L.torso.v, L.torso.w, L.torso.h, L.torso.d));
  // Canela: coluna de 4 t com a calha até a linha 11; bota: célula 12×12 pintada com a cor dela; manga, antebraço e
  // coxa: colunas de 4 t (farda da #58; o zumbi pinta nelas a roupa rasgada).
  out.push({ what: 'canela', layer: 1, u: 48, v: 0, w: 4, h: 12 });
  out.push({ what: 'bota', layer: 1, u: 52, v: 0, w: 12, h: 12 });
  out.push({ what: 'manga', layer: 1, u: 48, v: 12, w: 4, h: 10 });
  out.push({ what: 'antebraço', layer: 1, u: 52, v: 12, w: 4, h: 10 });
  out.push({ what: 'coxa', layer: 1, u: 56, v: 12, w: 4, h: 11 });
  return out;
}

const STRIPE_CELLS = ['canela', 'bota', 'manga', 'antebraço', 'coxa'];
const HELMET: Rect = { what: 'capacete', ...L.helmetReserve };

function inside(r: Rect, u: number, v: number, w: number, h: number): boolean {
  return u >= r.u && v >= r.v && u + w <= r.u + r.w && v + h <= r.v + r.h;
}

describe('figure-layout', () => {
  it('tamanhos da skin: 2 camadas 64×64 RGBA (32 KB) e o nível 1 (8 KB)', () => {
    expect(FIGURE_SKIN_LAYERS).toBe(2);
    expect(FIGURE_SKIN_BYTES).toBe(32768);
    expect(FIGURE_SKIN_LEVEL1_BYTES).toBe(8192);
  });

  it('toda região usada cabe em 64×64 numa camada válida', () => {
    for (const r of [...usedRegions(), HELMET]) {
      expect(r.layer, r.what).toBeGreaterThanOrEqual(0);
      expect(r.layer, r.what).toBeLessThan(FIGURE_SKIN_LAYERS);
      expect(r.u >= 0 && r.v >= 0 && r.u + r.w <= 64 && r.v + r.h <= 64, r.what).toBe(true);
    }
  });

  it('as regiões usadas não se sobrepõem, e a reserva do capacete fica livre', () => {
    const grids = [new Uint8Array(64 * 64), new Uint8Array(64 * 64)];
    for (const r of usedRegions()) {
      const grid = grids[r.layer]!;
      for (let y = r.v; y < r.v + r.h; y++) {
        for (let x = r.u; x < r.u + r.w; x++) {
          expect(grid[y * 64 + x], `${r.what} em (${x}, ${y}) da camada ${r.layer}`).toBe(0);
          grid[y * 64 + x] = 1;
        }
      }
    }
    const layer1 = grids[HELMET.layer]!;
    for (let y = HELMET.v; y < HELMET.v + HELMET.h; y++) {
      for (let x = HELMET.u; x < HELMET.u + HELMET.w; x++) expect(layer1[y * 64 + x], `capacete (${x}, ${y})`).toBe(0);
    }
    // A reserva é a cruz de uma casca 16³: 64×32.
    expect([HELMET.w, HELMET.h]).toEqual([64, 32]);
  });

  it('todo canto de região é par (o nível 1 é uma caixa 2×2 e não mistura partes)', () => {
    for (const r of [...usedRegions(), HELMET]) {
      expect(r.u % 2, `${r.what} u`).toBe(0);
      expect(r.v % 2, `${r.what} v`).toBe(0);
    }
  });

  it('as células de listra são alinhadas a 4 (mip limpo até o nível 2)', () => {
    for (const r of usedRegions().filter((x) => STRIPE_CELLS.includes(x.what))) {
      expect(r.u % 4, `${r.what} u`).toBe(0);
      expect(r.v % 4, `${r.what} v`).toBe(0);
      expect(r.w % 4, `${r.what} largura`).toBe(0);
    }
  });

  it('a UV de cada coluna e da mini-cruz cai dentro da sua célula', () => {
    const regions = usedRegions();
    const cell = (what: string): Rect => regions.find((r) => r.what === what)!;
    const columns = [
      ['canela', L.shin],
      ['manga', L.sleeve],
      ['antebraço', L.forearm],
      ['coxa', L.thigh],
    ] as const;
    for (const [what, uv] of columns) {
      // Medida 0 na largura: o VS lê a coluna u + 0,5, de v até v + h.
      expect(uv.w, what).toBe(0);
      expect(uv.d, what).toBe(0);
      expect(inside(cell(what), uv.u, uv.v, 1, uv.h), what).toBe(true);
      expect(uv.layer, what).toBe(cell(what).layer);
    }
    // Mini-cruz da bota: 2·(w + d) × (d + h) = 10 × 9, dentro da célula 12×12.
    const b = L.boot;
    expect([2 * (b.w + b.d), b.d + b.h]).toEqual([10, 9]);
    expect(inside(cell('bota'), b.u, b.v, 2 * (b.w + b.d), b.d + b.h)).toBe(true);
    // 2 t por px do boneco ao longo do membro: manga 5,2 px, antebraço 5, coxa 5,6 e canela 4,9.
    expect([L.sleeve.h, L.forearm.h, L.thigh.h, L.shin.h]).toEqual([10, 10, 11, 10]);
  });

  it('a frente da cabeça fica em (16, 16) e cada expressão numa célula 16×16 da camada 0', () => {
    const front = crossFaces('cabeça', 0, L.head.u, L.head.v, L.head.w, L.head.h, L.head.d)[5]!;
    expect([front.u, front.v, front.w, front.h]).toEqual([16, 16, 16, 16]);
    expect(L.expressions.layer).toBe(0);
    expect(L.expressions.cell).toBe(16);
    expect(L.expressions.v).toBe(32);
  });

  it('paleta: 16 amostras distintas, cada uma no meio da sua célula 4×4', () => {
    const names = Object.keys(FIGURE_SWATCH) as (keyof typeof FIGURE_SWATCH)[];
    const indices = names.map((n) => FIGURE_SWATCH[n]).sort((a, b) => a - b);
    expect(indices).toEqual([...Array(16).keys()]);
    const seen = new Set<number>();
    for (let i = 0; i < 16; i++) {
      const corner = figureSwatchCorner(i);
      seen.add(corner);
      const u0 = corner % 64;
      const v0 = (corner - u0) / 64;
      expect([u0, v0], `amostra ${i}`).toEqual([4 * (i % 4) + 2, 4 * Math.floor(i / 4) + 2]);
      // O VS soma 0,5: a leitura cai no centro de um texel da célula da amostra, longe da borda.
      const su = u0 + 0.5;
      const sv = v0 + 0.5;
      expect(Math.floor(su / 4), `coluna da amostra ${i}`).toBe(i % 4);
      expect(Math.floor(sv / 4), `linha da amostra ${i}`).toBe(Math.floor(i / 4));
      expect(su - Math.floor(su)).toBe(0.5);
    }
    expect(seen.size).toBe(16);
    // Cabe na paleta (0, 0, 16, 16) da camada 0.
    expect(L.palette.cell * L.palette.cols).toBe(16);
    expect(L.palette.layer).toBe(0);
  });
});

// --- E.7, parte do layout (F2): o que o render lê de cada caixa é o que o pintor pinta ---

function paintedSkin(look: FigureLook, team: number): Uint8Array {
  const out = new Uint8Array(FIGURE_SKIN_BYTES);
  paintFigureSkin({ look, team, teamColors: [0xff7a1a, 0x2e8bff] }, out, new Uint8Array(FIGURE_SKIN_LEVEL1_BYTES));
  return out;
}

function painted(layer: number, u: number, v: number): boolean {
  return FIGURE_PAINT_REGIONS.some((r) => r.layer === layer && u >= r.u && u < r.u + r.w && v >= r.v && v < r.v + r.h);
}

function texelAt(skin: Uint8Array, layer: number, u: number, v: number): number {
  const o = (layer * 4096 + v * 64 + u) * 4;
  return (skin[o]! << 16) | (skin[o + 1]! << 8) | skin[o + 2]!;
}

/** Caixas do gabarito do look (as 14 do corpo e, quando a F1 entregar, o cabelo e as colunas do zumbi). */
function templateBoxes(look: FigureLook): Float32Array[] {
  const out = new Float32Array(FIGURE_MAX_BOXES * FIGURE_BOX_STRIDE);
  const count = buildFigureTemplate(look, out, 0);
  expect(count).toBeGreaterThanOrEqual(FIGURE_BODY_BOXES.length / FIGURE_BOX_STRIDE);
  expect(count).toBeLessThanOrEqual(FIGURE_MAX_BOXES);
  return Array.from({ length: count }, (_, i) => out.subarray(i * FIGURE_BOX_STRIDE, (i + 1) * FIGURE_BOX_STRIDE));
}

/**
 * Looks do E.7: os 12 prontos, o zumbi nos 5 tipos, e os 34 cortes × 5 chapéus (com barba longa e argolas, que também
 * viram caixa no FutBobo) sobre o clássico.
 */
function e7Looks(): { name: string; look: FigureLook }[] {
  const out: { name: string; look: FigureLook }[] = [];
  for (const id of Object.keys(FIGURE_PRESETS) as FigurePresetId[]) out.push({ name: id, look: FIGURE_PRESETS[id] });
  for (const kind of ZOMBIE_KINDS) {
    out.push({
      name: `zumbi ${kind}`,
      look: normalizeFigureLook({ ...FIGURE_PRESETS.zombie, zombie: { kind, faceStyle: 0 } }),
    });
  }
  for (let hairStyle = 0; hairStyle < 34; hairStyle++) {
    for (let headwear = 0; headwear < 5; headwear++) {
      const look = normalizeFigureLook({ ...FIGURE_PRESETS.classico, hairStyle, headwear, beard: 8, earrings: 3 });
      out.push({ name: `corte ${hairStyle} chapéu ${headwear}`, look });
    }
  }
  return out;
}

describe('figure-layout × pintor (E.7, parte do layout)', () => {
  const F = FIGURE_BOX_FIELD;
  const looks = e7Looks();

  // As falhas são juntadas numa lista (um `expect` por texel deixaria o teste em segundos com 187 gabaritos).
  it('toda face de toda caixa de todo gabarito lê só texels que o pintor escreve (e o rosto, as 8 células)', () => {
    const fails: string[] = [];
    const seen = new Set<string>();
    for (const { name, look } of looks) {
      for (const b of templateBoxes(look)) {
        const layer = b[F.layer]!;
        const key = [layer, b[F.u], b[F.v], b[F.w], b[F.h], b[F.d], b[F.flags]! & FIGURE_BOX_FLAG.face].join(',');
        if (seen.has(key)) continue;
        seen.add(key);
        const rects = boxCrossRects(b[F.u]!, b[F.v]!, b[F.w]!, b[F.h]!, b[F.d]!);
        rects.forEach((r, f) => {
          // Medida 0: o VS soma 0,5 e lê o texel do canto.
          const w = Math.max(r.w, 1);
          const h = Math.max(r.h, 1);
          for (let v = r.v; v < r.v + h; v++) {
            for (let u = r.u; u < r.u + w; u++)
              if (!painted(layer, u, v)) fails.push(`${name}: osso ${b[F.bone]} face ${f} (${u}, ${v})`);
          }
        });
        if ((b[F.flags]! & FIGURE_BOX_FLAG.face) !== 0) {
          const front = rects[5]!;
          for (let e = 0; e < 8; e++) {
            const u0 = front.u - 16 + 16 * (e % 4);
            const v0 = front.v - 16 + 32 + 16 * Math.floor(e / 4);
            if (!painted(layer, u0, v0) || !painted(layer, u0 + 15, v0 + 15)) fails.push(`${name}: expressão ${e}`);
          }
        }
      }
    }
    expect(fails.slice(0, 20)).toEqual([]);
    expect(seen.size).toBeGreaterThanOrEqual(8);
  });

  it('medida 0 cai numa célula uniforme: amostra 4×4 de uma cor; coluna com a linha inteira de uma cor (4 t)', () => {
    const fails: string[] = [];
    for (const { name, look } of looks) {
      const boxes = templateBoxes(look);
      for (const team of [-1, 0]) {
        const skin = paintedSkin(look, team);
        const columns: { layer: number; u: number; v: number; h: number }[] = [];
        for (const b of boxes) {
          const layer = b[F.layer]!;
          const u = b[F.u]!;
          const v = b[F.v]!;
          if (b[F.w] === 0 && b[F.h] === 0 && b[F.d] === 0) {
            // Amostra: a célula 4×4 alinhada que contém (u, v).
            const cu = u - (u % 4);
            const cv = v - (v % 4);
            const c = texelAt(skin, layer, u, v);
            for (let y = 0; y < 4; y++) {
              for (let x = 0; x < 4; x++)
                if (texelAt(skin, layer, cu + x, cv + y) !== c) fails.push(`${name} ${team}: amostra (${u}, ${v})`);
            }
          } else if (b[F.w] === 0 && b[F.d] === 0) columns.push({ layer, u, v, h: b[F.h]! });
        }
        // As 4 colunas da farda sempre (o gabarito de todo look as lê; o zumbi pinta nelas a roupa rasgada).
        for (const c of [L.sleeve, L.forearm, L.thigh, L.shin]) columns.push(c);
        for (const c of columns) {
          // Coluna: cada linha da célula de 4 t tem uma cor só (a leitura em u + 0,5 não depende de arredondar).
          const cu = c.u - (c.u % 4);
          for (let y = c.v; y < c.v + c.h; y++) {
            const t = texelAt(skin, c.layer, c.u, y);
            for (let x = 0; x < 4; x++)
              if (texelAt(skin, c.layer, cu + x, y) !== t) fails.push(`${name} ${team}: coluna (${c.u}, ${y})`);
          }
        }
      }
    }
    expect(fails.slice(0, 20)).toEqual([]);
  });

  it('as regiões do pintor cobrem exatamente as usadas pelo layout, com as calhas, e deixam o capacete livre', () => {
    const covered = (r: Rect): boolean => {
      for (let v = r.v; v < r.v + r.h; v++)
        for (let u = r.u; u < r.u + r.w; u++) if (!painted(r.layer, u, v)) return false;
      return true;
    };
    for (const r of usedRegions()) expect(covered(r), r.what).toBe(true);
    for (let v = HELMET.v; v < HELMET.v + HELMET.h; v++) {
      for (let u = HELMET.u; u < HELMET.u + HELMET.w; u++) expect(painted(HELMET.layer, u, v)).toBe(false);
    }
    // Livres do §B7: camada 0 (48, 0, 16, 16); camada 1 (60, 12, 4, 12) e (48, 24, 16, 8).
    for (const [layer, u0, v0, w, h] of [
      [0, 48, 0, 16, 16],
      [1, 60, 12, 4, 12],
      [1, 48, 24, 16, 8],
    ] as const) {
      for (let v = v0; v < v0 + h; v++) for (let u = u0; u < u0 + w; u++) expect(painted(layer, u, v)).toBe(false);
    }
  });
});
