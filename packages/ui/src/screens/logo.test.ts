import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDrawList, DRAW_FLOATS_PER_COMMAND, resetDrawList } from '../draw-list.ts';
import { layoutTree } from '../layout.ts';
import { rgba } from '../tokens.ts';
import { BLOCK_LOGO_SIZE, drawBlockLogo, drawTitleLogo } from './logo.ts';
import { titleScreen } from './title.ts';

const ROOT = resolve(import.meta.dirname, '..', '..', '..', '..');
const PLATE_FACE = rgba(0xc4cac0);
const STRIPE_FACE = rgba(0xf5812a);

/** As células do SVG do splash (`<path id="…" d="M x y h w v h h -w z…">`): "coluna,linha". */
function svgCells(html: string, id: string): Set<string> {
  const d = new RegExp(`id="${id}"\\s+d="([^"]+)"`).exec(html)?.[1] ?? '';
  const out = new Set<string>();
  for (const m of d.matchAll(/M(\d+) (\d+)h(\d+)v(\d+)h-\d+z/g)) {
    const [x, y, w, h] = [m[1], m[2], m[3], m[4]].map(Number) as [number, number, number, number];
    for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) out.add(`${x + i},${y + j}`);
  }
  return out;
}

describe('M12 (fase 3, #43): o logo em blocos do título', () => {
  it('é o mesmo do splash da web: as mesmas placas e a faixa laranja na fileira de baixo', () => {
    const list = createDrawList(4096);
    resetDrawList(list, 1280, 720);
    drawBlockLogo(list, { x: 0, y: 0, w: BLOCK_LOGO_SIZE.width, h: BLOCK_LOGO_SIZE.height });
    expect(list.overflow).toBe(0);
    const plates = new Set<string>();
    const stripes = new Set<string>();
    const e = 2;
    for (let i = 0; i < list.count; i++) {
      const c = list.colors[i];
      if (c !== PLATE_FACE && c !== STRIPE_FACE) continue;
      const g = i * DRAW_FLOATS_PER_COMMAND;
      const cell = `${((list.geom[g]! - e) / 12).toFixed(0)},${((list.geom[g + 1]! - e) / 12).toFixed(0)}`;
      (c === PLATE_FACE ? plates : stripes).add(cell);
    }
    const html = readFileSync(join(ROOT, 'apps', 'web', 'index.html'), 'utf8');
    expect(plates).toEqual(svgCells(html, 'bf-lg'));
    expect(stripes).toEqual(svgCells(html, 'bf-lo'));
    expect(plates.size + stripes.size).toBe(166);
  });

  it('o título reserva a caixa e o desenho fica dentro dela (com a sombra a meio bloco), em qualquer escala', () => {
    for (const [w, h] of [
      [1280, 720],
      [640, 360],
      [960, 720],
    ] as const) {
      const l = layoutTree(titleScreen.build({ version: '1', codename: 'x' }), { x: 0, y: 0, w, h });
      const node = l.byId.get('logo')!;
      const r = l.rects.get(node)!;
      const list = createDrawList(4096);
      resetDrawList(list, w, h);
      drawTitleLogo(list, l);
      expect(list.count).toBeGreaterThan(166 * 3);
      const b = Math.floor(r.h / 7);
      for (let i = 0; i < list.count; i++) {
        const g = i * DRAW_FLOATS_PER_COMMAND;
        expect(list.geom[g]!).toBeGreaterThanOrEqual(r.x - 0.5);
        expect(list.geom[g]! + list.geom[g + 2]!).toBeLessThanOrEqual(r.x + r.w + b);
        expect(list.geom[g + 1]! + list.geom[g + 3]!).toBeLessThanOrEqual(r.y + r.h + b);
      }
    }
  });
});
