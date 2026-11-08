import { encodePng } from '@boboforces/format';
import { BLOCK_SIZE, COLLIDER_STRIDE } from '@boboforces/world';
import type { CompileResult } from './compile.ts';

/**
 * Vista de cima para revisão (local/m1/<mapa>-topo.png): cor do material do bloco mais alto de cada coluna, clareada
 * pela altura, com contorno onde a altura muda; por cima, área jogável, props do jogo (`isPlayableProp`), spawns (A
 * laranja, B azul, FFA branco), pontos de Domination (verde), câmeras (roxo), manequins (ciano), portas (amarelo) e a
 * maior linha de visão medida (vermelho). 4 px por célula de 0,5 m.
 */
const SCALE = 4;

/** Cor base por bloco (RGB) ou por família numerada (`sector-marker-1…9` → `sector-marker`); o resto cai no cinza. */
const BLOCK_COLORS: Readonly<Record<string, readonly [number, number, number]>> = {
  concrete: [150, 150, 146],
  'concrete-slab': [160, 160, 156],
  'concrete-step': [160, 160, 156],
  'concrete-ramp': [170, 168, 160],
  'concrete-ramp-half-low': [170, 168, 160],
  'concrete-ramp-half-high': [170, 168, 160],
  'concrete-ramp-corner-in': [170, 168, 160],
  'concrete-ramp-corner-out': [170, 168, 160],
  crate: [176, 128, 70],
  'test-floor': [205, 205, 200],
  'test-floor-stripe': [232, 196, 60],
  'sector-marker': [240, 140, 40],
  'test-wall': [235, 120, 40],
  'metal-panel': [225, 110, 35],
  'metal-roof-ramp': [120, 125, 130],
  'metal-roof-ramp-corner-in': [120, 125, 130],
  'metal-roof-ramp-corner-out': [120, 125, 130],
  brick: [170, 80, 60],
  plank: [160, 120, 75],
  'plank-slab': [160, 120, 75],
  grass: [90, 150, 60],
  dirt: [120, 90, 60],
  log: [100, 70, 45],
  leaves: [50, 110, 45],
  'tall-grass': [110, 170, 70],
  flowers: [190, 170, 80],
  bush: [70, 130, 55],
  'fence-wire': [190, 195, 200],
  'fence-wood': [140, 100, 60],
  railing: [230, 200, 60],
  'grate-slab': [95, 100, 105],
  'light-panel': [255, 245, 170],
  lamp: [255, 250, 200],
  glass: [150, 210, 230],
  'glass-pane': [150, 210, 230],
  water: [60, 120, 200],
};

export function renderTopView(result: CompileResult): Uint8Array {
  const { grid, doc } = result;
  const w = grid.sizeX * SCALE;
  const h = grid.sizeZ * SCALE;
  const data = new Uint8Array(w * h * 4);
  const height = new Int32Array(grid.sizeX * grid.sizeZ).fill(-1);
  const color = new Uint8Array(grid.sizeX * grid.sizeZ * 3);
  for (let z = 0; z < grid.sizeZ; z++) {
    for (let x = 0; x < grid.sizeX; x++) {
      for (let y = grid.sizeY - 1; y >= 0; y--) {
        const cell = grid.get(x, y, z);
        if (cell === 0) continue;
        const key = doc.blocks[cell & 0x3ff] ?? 'missing';
        const c = BLOCK_COLORS[key] ?? BLOCK_COLORS[key.replace(/-\d+$/, '')] ?? [128, 128, 128];
        const i = x + z * grid.sizeX;
        height[i] = y;
        color[i * 3] = c[0];
        color[i * 3 + 1] = c[1];
        color[i * 3 + 2] = c[2];
        break;
      }
    }
  }
  const put = (px: number, py: number, r: number, g: number, b: number): void => {
    if (px < 0 || py < 0 || px >= w || py >= h) return;
    const o = (px + py * w) * 4;
    data[o] = r;
    data[o + 1] = g;
    data[o + 2] = b;
    data[o + 3] = 255;
  };
  for (let z = 0; z < grid.sizeZ; z++) {
    for (let x = 0; x < grid.sizeX; x++) {
      const i = x + z * grid.sizeX;
      const y = height[i]!;
      const light = y < 0 ? 0 : 0.55 + 0.45 * Math.min(1, y / 24);
      const edge =
        (x > 0 && Math.abs(height[i - 1]! - y) > 1) || (z > 0 && Math.abs(height[i - grid.sizeX]! - y) > 1) ? 0.6 : 1;
      for (let sy = 0; sy < SCALE; sy++) {
        for (let sx = 0; sx < SCALE; sx++) {
          const border = (sx === 0 || sy === 0) && edge < 1 ? edge : 1;
          put(
            x * SCALE + sx,
            z * SCALE + sy,
            Math.round(color[i * 3]! * light * border),
            Math.round(color[i * 3 + 1]! * light * border),
            Math.round(color[i * 3 + 2]! * light * border),
          );
        }
      }
    }
  }
  const px = (m: number): number => Math.round((m / BLOCK_SIZE) * SCALE);
  const rect = (x0: number, z0: number, x1: number, z1: number, r: number, g: number, b: number): void => {
    for (let x = x0; x <= x1; x++) {
      put(x, z0, r, g, b);
      put(x, z1, r, g, b);
    }
    for (let z = z0; z <= z1; z++) {
      put(x0, z, r, g, b);
      put(x1, z, r, g, b);
    }
  };
  const disc = (cx: number, cz: number, radius: number, r: number, g: number, b: number, ring = false): void => {
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const d = Math.hypot(dx, dz);
        if (d > radius + 0.3 || (ring && d < radius - 1.2)) continue;
        put(cx + dx, cz + dz, r, g, b);
      }
    }
  };
  const line = (ax: number, az: number, bx: number, bz: number, r: number, g: number, b: number): void => {
    const n = Math.max(Math.abs(bx - ax), Math.abs(bz - az), 1);
    for (let t = 0; t <= n; t++)
      put(Math.round(ax + ((bx - ax) * t) / n), Math.round(az + ((bz - az) * t) / n), r, g, b);
  };
  const area = doc.markers.playArea;
  rect(px(area.minX), px(area.minZ), px(area.maxX) - 1, px(area.maxZ) - 1, 255, 255, 255);
  const c = result.colliders;
  for (let i = 0; i < c.count; i++) {
    const o = i * COLLIDER_STRIDE;
    rect(px(c.boxes[o]!), px(c.boxes[o + 2]!), px(c.boxes[o + 3]!) - 1, px(c.boxes[o + 5]!) - 1, 220, 60, 220);
  }
  for (const d of doc.markers.domination) disc(px(d.x), px(d.z), px(d.radius), 60, 230, 90, true);
  for (const s of doc.markers.spawns) {
    const col: [number, number, number] =
      s.team === 0 ? [255, 140, 0] : s.team === 1 ? [40, 120, 255] : [255, 255, 255];
    disc(px(s.x), px(s.z), 5, 0, 0, 0);
    disc(px(s.x), px(s.z), 4, ...col);
    line(px(s.x), px(s.z), px(s.x - Math.sin(s.yaw) * 1.5), px(s.z - Math.cos(s.yaw) * 1.5), 0, 0, 0);
  }
  for (const q of doc.markers.mannequins) disc(px(q.x), px(q.z), 2, 0, 230, 230);
  for (const cam of doc.markers.cameras) {
    disc(px(cam.x), px(cam.z), 3, 150, 60, 230);
    line(px(cam.x), px(cam.z), px(cam.x - Math.sin(cam.yaw) * 4), px(cam.z - Math.cos(cam.yaw) * 4), 150, 60, 230);
  }
  for (const r of doc.markers.routes) {
    for (let i = 1; i < r.points.length; i++) {
      const a = r.points[i - 1]!;
      const b = r.points[i]!;
      line(px(a.x), px(a.z), px(b.x), px(b.z), 120, 40, 200);
    }
  }
  const m = result.checks.sight.max;
  if (m) line(px(m.a[0]), px(m.a[2]), px(m.b[0]), px(m.b[2]), 255, 30, 30);
  return encodePng({ width: w, height: h, data });
}
