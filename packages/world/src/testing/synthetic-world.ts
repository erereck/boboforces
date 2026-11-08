import { BLOCK_FLAG, createBlockRegistry, type BlockDefInput, type BlockFaces, type BlockRegistry } from '../blocks.ts';
import { makeCell } from '../cell.ts';
import { createWorldGrid, type WorldGrid } from '../grid.ts';
import type { LightField } from '../light.ts';
import { buildRegionMesh, regionCounts, type RegionMesh } from '../mesh/region.ts';
import type { BlockShape } from '../shapes.ts';

/**
 * Grade SINTÉTICA do tamanho do Construto (160 × 48 × 160 células, ~30 chunks não vazios; tecnico.md §5.3) para
 * testes e medições da frente mundo enquanto o `.bfmap` de verdade não existe: chão, muro de borda, prédios ocos com
 * porta, janelas de vidro e lâmpada, telhados de rampa, escadas de laje e degrau, talude de rampas 1:2 e quinas, cercas
 * de painel e de poste, grama em cruz e postes de luz. Determinística (LCG com semente fixa). Não sai no `index.ts`.
 */

const SOLID = BLOCK_FLAG.solid | BLOCK_FLAG.blocksBullets | BLOCK_FLAG.blocksSight | BLOCK_FLAG.walkable;

interface DefExtra {
  readonly emissive?: number;
  readonly variants?: number;
  readonly frames?: number;
  readonly faces?: BlockFaces;
}

function def(key: string, shape: BlockShape, layer: number, flags = SOLID, extra: DefExtra = {}): BlockDefInput {
  const faces: BlockFaces = extra.faces ?? [layer, layer, layer, layer, layer, layer];
  const out: BlockDefInput = { key, shape, faces, flags, frames: extra.frames ?? 1, stepSound: '' };
  return {
    ...out,
    ...(extra.emissive === undefined ? {} : { emissive: extra.emissive }),
    ...(extra.variants === undefined ? {} : { variants: extra.variants }),
  };
}

export function syntheticRegistry(): BlockRegistry {
  return createBlockRegistry([
    def('concrete', 'cube', 1), // 1
    def('brick', 'cube', 2, SOLID | BLOCK_FLAG.colorVariation), // 2
    def('glass', 'cube', 3, BLOCK_FLAG.solid | BLOCK_FLAG.translucent | BLOCK_FLAG.blocksBullets), // 3
    def('lamp', 'cube', 4, SOLID | BLOCK_FLAG.emissive, { emissive: 14 }), // 4
    def('slab', 'slab', 5), // 5
    def('step', 'step', 5), // 6
    def('ramp', 'ramp', 6), // 7
    def('ramp-half-low', 'rampHalfLow', 6), // 8
    def('ramp-half-high', 'rampHalfHigh', 6), // 9
    def('ramp-corner-in', 'rampCornerIn', 6), // 10
    def('ramp-corner-out', 'rampCornerOut', 6), // 11
    def('fence', 'panel', 7, BLOCK_FLAG.solid | BLOCK_FLAG.cutout), // 12
    def('rail', 'postRail', 8), // 13
    def('grass', 'cross', 9, BLOCK_FLAG.cutout | BLOCK_FLAG.swaysInWind), // 14
  ]);
}

/** LCG determinístico só do gerador (o mundo nunca usa acaso). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function box(g: WorldGrid, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, cell: number) {
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) g.set(x, y, z, cell);
}

export function syntheticConstruto(): WorldGrid {
  const g = createWorldGrid(160, 48, 160);
  const concrete = makeCell(1);
  const brick = makeCell(2);
  const glass = makeCell(3);
  const lamp = makeCell(4);
  const rnd = lcg(46);
  // Chão (2 camadas) e muro de borda de 4 m.
  box(g, 0, 0, 0, 159, 1, 159, concrete);
  box(g, 0, 2, 0, 159, 9, 0, brick);
  box(g, 0, 2, 159, 159, 9, 159, brick);
  box(g, 0, 2, 0, 0, 9, 159, brick);
  box(g, 159, 2, 0, 159, 9, 159, brick);
  // Prédios ocos com porta, janelas de vidro, lâmpada interna e telhado de rampas.
  for (let b = 0; b < 12; b++) {
    const w = 10 + Math.floor(rnd() * 14);
    const d = 10 + Math.floor(rnd() * 14);
    const h = 8 + Math.floor(rnd() * 12) + (b < 2 ? 18 : 0);
    const x0 = 6 + Math.floor(rnd() * (146 - w));
    const z0 = 6 + Math.floor(rnd() * (146 - d));
    const x1 = x0 + w - 1;
    const z1 = z0 + d - 1;
    const top = 2 + h;
    box(g, x0, 2, z0, x1, top, z0, brick);
    box(g, x0, 2, z1, x1, top, z1, brick);
    box(g, x0, 2, z0, x0, top, z1, brick);
    box(g, x1, 2, z0, x1, top, z1, brick);
    box(g, x0 + 1, 2, z0 + 1, x1 - 1, 2, z1 - 1, makeCell(0));
    box(g, x0, top, z0, x1, top, z1, concrete); // laje do teto
    // Porta 2 × 4 e janelas.
    const door = x0 + 2 + Math.floor(rnd() * (w - 5));
    box(g, door, 2, z0, door + 1, 5, z0, 0);
    for (let wx = x0 + 2; wx < x1 - 1; wx += 4) box(g, wx, 5, z1, wx + 1, 6, z1, glass);
    g.set(x0 + 1, top - 1, z0 + 1, lamp);
    // Telhado de duas águas em rampas 1:1 (giro 0 e 2), com cumeeira de laje.
    const mid = (x0 + x1) >> 1;
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const dz = Math.min(z - z0, z1 - z);
        const ry = top + 1 + Math.min(dz, 4);
        if (dz < 4) g.set(x, ry, z, makeCell(7, z - z0 < z1 - z ? 2 : 0));
        else if (x === mid) g.set(x, top + 5, z, makeCell(5));
      }
    }
    // Escada de degraus e lajes até a porta.
    g.set(door, 2, z0 - 1, makeCell(6, 2));
    g.set(door + 1, 2, z0 - 1, makeCell(5));
  }
  // Rampas 1:2 e quinas num talude, cercas, corrimão e grama.
  for (let x = 20; x < 60; x++) {
    g.set(x, 2, 80, makeCell(8));
    g.set(x, 2, 79, makeCell(9));
    box(g, x, 2, 72, x, 2, 78, concrete);
  }
  g.set(19, 2, 79, makeCell(10));
  g.set(60, 2, 79, makeCell(11, 1));
  for (let x = 70; x < 130; x++) {
    g.set(x, 2, 40, makeCell(12));
    g.set(x, 3, 40, makeCell(12));
    g.set(x, 2, 120, makeCell(13));
  }
  for (let i = 0; i < 1500; i++) {
    const x = 2 + Math.floor(rnd() * 156);
    const z = 2 + Math.floor(rnd() * 156);
    if (g.get(x, 2, z) === 0) g.set(x, 2, z, makeCell(14));
  }
  // Postes de luz.
  for (let k = 0; k < 10; k++) {
    const x = 10 + k * 14;
    box(g, x, 2, 140, x, 7, 140, concrete);
    g.set(x, 8, 140, lamp);
  }
  return g;
}

export function meshWholeGrid(grid: WorldGrid, registry: BlockRegistry, light: LightField | null): RegionMesh[] {
  const counts = regionCounts(grid);
  const out: RegionMesh[] = [];
  for (let ry = 0; ry < counts.y; ry++)
    for (let rz = 0; rz < counts.z; rz++)
      for (let rx = 0; rx < counts.x; rx++) out.push(buildRegionMesh(grid, registry, light, rx, ry, rz));
  return out;
}
