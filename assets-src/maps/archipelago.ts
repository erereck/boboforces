import type { MapBuilder, MapScript } from '../../tools/mapc/src/api.ts';
import { barnDoor, container } from './kit.ts';

/**
 * ARQUIPÉLAGO (M11, fase 5): o mapa do Bobo Royale Grande (GDD §4.1.3 e §4.6.4: "só PC, depois do Mini; alvo de 48
 * participantes em ~400 m"). Grade de 400 × 32 × 400 m (800 × 64 × 800 células), de dia, nome genérico (nenhum lugar
 * real). Gerado por código, como a Ilha Tropical: o relevo é um ruído de valor da semente do mapa, em degraus de meio
 * bloco, e o mar em volta e entre as ilhas é raso (dá para andar no fundo, como o da Ilha).
 * - A ILHA GRANDE no meio: a vila (a praça, 16 casas e o galpão), o morro do norte com a caixa d'água e as estradas de
 *   terra até as praias.
 * - 4 ilhas em volta, ligadas à grande por baixios de areia: a do FAROL (noroeste: o morro, o farol e a casinha), a do
 *   PORTO (nordeste: o pátio de contêineres, o depósito e o píer), a da FAZENDA (sudoeste: o celeiro, a casa, o silo,
 *   a roça e o feno) e a do ACAMPAMENTO (sudeste: as barracas, a cabana e a torre de rádio no morrote).
 * - Ilhotas de areia com coqueiro no mar, árvores, arbustos e mato na grama; caixotes com loot no campo.
 *
 * Tudo em METROS aqui (múltiplos de 0,5); o builder recebe células.
 */

const c = (m: number): number => Math.round(m * 2);
const SIZE = 400;
/** O fundo do mar (o topo da areia submersa); a laje de água fica em cima dele. */
const SEABED = 1;
/** A área jogável (o mar raso em volta entra; fora dela, a parede invisível). */
const MIN = 10;
const MAX = 390;

interface Isle {
  readonly x: number;
  readonly z: number;
  readonly r: number;
}

/** As ilhas: o centro e o raio (m) até a linha da água, antes do ruído. */
const BIG: Isle = { x: 200, z: 205, r: 92 };
const LIGHT: Isle = { x: 84, z: 84, r: 52 };
const PORT: Isle = { x: 318, z: 82, r: 50 };
const FARM: Isle = { x: 82, z: 320, r: 54 };
const CAMP: Isle = { x: 320, z: 320, r: 50 };
const ISLES: readonly Isle[] = [BIG, LIGHT, PORT, FARM, CAMP];
/** As ilhotas de areia (com um coqueiro). */
const ISLETS: readonly Isle[] = [
  { x: 200, z: 36, r: 9 },
  { x: 36, z: 200, r: 8 },
  { x: 364, z: 196, r: 9 },
  { x: 204, z: 366, r: 8 },
  { x: 150, z: 70, r: 6 },
  { x: 262, z: 340, r: 6 },
];

/** Os baixios de areia (a areia seca a meio metro acima do fundo) da ilha grande a cada ilha de fora. */
const BARS: readonly (readonly [number, number, number, number, number])[] = [
  [148, 150, 112, 114, 7],
  [252, 150, 288, 112, 7],
  [150, 258, 112, 290, 7],
  [254, 258, 290, 290, 7],
];

/** Os morros: o centro do topo, a altura a mais e a largura. */
const HILL_LIGHT = { x: 80, z: 72, height: 11, sigma: 13 } as const;
const HILL_NORTH = { x: 200, z: 142, height: 7, sigma: 13 } as const;
const HILL_CAMP = { x: 336, z: 338, height: 5, sigma: 10 } as const;
const HILLS = [HILL_LIGHT, HILL_NORTH, HILL_CAMP] as const;

interface Flat {
  readonly x0: number;
  readonly z0: number;
  readonly x1: number;
  readonly z1: number;
  readonly h: number;
}
/** As áreas aplainadas: a vila, o pátio do porto, o terreiro da fazenda e a clareira do acampamento. */
const VILLAGE: Flat = { x0: 166, z0: 184, x1: 234, z1: 238, h: 4 };
const YARD: Flat = { x0: 300, z0: 66, x1: 338, z1: 100, h: 3.5 };
const FARMYARD: Flat = { x0: 62, z0: 300, x1: 104, z1: 340, h: 3.5 };
const CLEARING: Flat = { x0: 300, z0: 300, x1: 326, z1: 326, h: 3.5 };
const FLATS: readonly Flat[] = [VILLAGE, YARD, FARMYARD, CLEARING];

/** Ruído de valor 2D (bilinear com suavização) sobre uma tabela de 64 × 64 da semente do mapa. */
function valueNoise(table: Float64Array): (x: number, z: number) => number {
  const N = 64;
  const at = (i: number, k: number): number => table[(((i % N) + N) % N) + (((k % N) + N) % N) * N]!;
  const smooth = (t: number): number => t * t * (3 - 2 * t);
  return (x, z) => {
    const i = Math.floor(x);
    const k = Math.floor(z);
    const fx = smooth(x - i);
    const fz = smooth(z - k);
    const a = at(i, k) + (at(i + 1, k) - at(i, k)) * fx;
    const b = at(i, k + 1) + (at(i + 1, k + 1) - at(i, k + 1)) * fx;
    return a + (b - a) * fz;
  };
}

/** A distância de (x, z) ao segmento (x0, z0)–(x1, z1). */
function segDist(x: number, z: number, x0: number, z0: number, x1: number, z1: number): number {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const t = Math.max(0, Math.min(1, ((x - x0) * dx + (z - z0) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - (x0 + dx * t), z - (z0 + dz * t));
}

/** Dentro do retângulo com folga `pad` (m)? */
function inFlat(f: Flat, x: number, z: number, pad: number): boolean {
  return x > f.x0 - pad && x < f.x1 + pad && z > f.z0 - pad && z < f.z1 + pad;
}

interface Terrain {
  /** A altura do chão (m, múltiplo de 0,5) e se o topo é areia, no centro da célula (x, z em metros). */
  height(x: number, z: number): number;
  sandy(x: number, z: number): boolean;
}

function terrain(b: MapBuilder): Terrain {
  const rng = b.rng('relevo');
  const table = new Float64Array(64 * 64);
  for (let i = 0; i < table.length; i++) table[i] = rng.next();
  const noise = valueNoise(table);
  // A distância normalizada até a borda da ilha mais perto (1 = a linha da água), com a borda ondulada pelo ruído.
  const shore = (x: number, z: number): number => {
    let d = Infinity;
    for (const s of ISLES) d = Math.min(d, Math.hypot(x - s.x, z - s.z) / s.r);
    for (const s of ISLETS) d = Math.min(d, 0.88 + (Math.hypot(x - s.x, z - s.z) / s.r) * 0.12);
    return d + (noise(x * 0.035, z * 0.035) - 0.5) * 0.24;
  };
  const bar = (x: number, z: number): boolean => {
    for (const [x0, z0, x1, z1, w] of BARS) {
      if (segDist(x, z, x0, z0, x1, z1) < w / 2 + (noise(x * 0.11 + 3, z * 0.11 + 9) - 0.5) * 3) return true;
    }
    return false;
  };
  const raw = (x: number, z: number): number => {
    const d = shore(x, z);
    if (d >= 1) return bar(x, z) ? SEABED + 0.5 : SEABED;
    if (d >= 0.84) return Math.max(bar(x, z) ? SEABED + 0.5 : 0, SEABED + 0.5 + ((1 - d) / 0.16) * 1);
    let h = 2.5 + Math.min(0.84 - d, 0.5) * 4 + noise(x * 0.08 + 7, z * 0.08 + 3) * 1.2;
    for (const k of HILLS) h += k.height * Math.exp(-((x - k.x) ** 2 + (z - k.z) ** 2) / (2 * k.sigma * k.sigma));
    for (const f of FLATS) {
      const dx = Math.max(f.x0 - x, 0, x - f.x1);
      const dz = Math.max(f.z0 - z, 0, z - f.z1);
      const t = Math.min(1, Math.hypot(dx, dz) / 8);
      h = f.h + (h - f.h) * t;
    }
    return h;
  };
  return {
    height: (x, z) => Math.max(SEABED, Math.round(raw(x, z) * 2) / 2),
    sandy: (x, z) => shore(x, z) >= 0.8,
  };
}

/** Caixa [x0, x1) × [y0, y1) × [z0, z1) em metros. */
function box(
  b: MapBuilder,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  block: string | null,
): void {
  b.box(c(x0), c(y0), c(z0), c(x1) - 1, c(y1) - 1, c(z1) - 1, block);
}

/** O relevo inteiro, coluna por coluna (terra embaixo; o topo de grama ou areia; a água rasa no mar). */
function ground(b: MapBuilder, t: Terrain): void {
  for (let cx = 0; cx < SIZE * 2; cx++) {
    for (let cz = 0; cz < SIZE * 2; cz++) {
      const x = (cx + 0.5) / 2;
      const z = (cz + 0.5) / 2;
      const h = t.height(x, z);
      const top = c(h) - 1;
      if (top > 0) b.box(cx, 0, cz, cx, top - 1, cz, 'dirt');
      const sea = h <= SEABED;
      b.set(cx, top, cz, sea || t.sandy(x, z) ? 'sand' : 'grass');
      if (sea) b.set(cx, top + 1, cz, 'water');
    }
  }
}

/** Uma estrada de terra (troca o topo de grama por terra) de (x0, z0) a (x1, z1), com a largura em metros. */
function road(b: MapBuilder, t: Terrain, x0: number, z0: number, x1: number, z1: number, width: number): void {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const steps = Math.ceil(len * 2);
  for (let i = 0; i <= steps; i++) {
    const x = x0 + ((x1 - x0) * i) / steps;
    const z = z0 + ((z1 - z0) * i) / steps;
    for (let a = -width / 2; a < width / 2; a += 0.5) {
      for (let k = -width / 2; k < width / 2; k += 0.5) {
        const cx = Math.floor((x + a) * 2);
        const cz = Math.floor((z + k) * 2);
        const px = (cx + 0.5) / 2;
        const pz = (cz + 0.5) / 2;
        const h = t.height(px, pz);
        if (h <= SEABED + 1 || t.sandy(px, pz)) continue;
        b.set(cx, c(h) - 1, cz, 'dirt');
      }
    }
  }
}

type Loot = (x: number, y: number, z: number) => void;

interface House {
  readonly x: number;
  readonly z: number;
  readonly w: number;
  readonly d: number;
  /** Lado da porta: 0 = norte (−z), 1 = sul, 2 = oeste, 3 = leste. */
  readonly door: 0 | 1 | 2 | 3;
  readonly wall: string;
}

const WALL_H = 3;

/** Uma casa: paredes, alicerce, laje de teto, a porta e uma janela, a luminária do teto e 2 pontos de loot dentro. */
function house(b: MapBuilder, h: House, floor: number, loot: Loot): void {
  const { x, z, w, d } = h;
  const top = floor + WALL_H;
  b.walls(c(x), c(floor), c(z), c(x + w) - 1, c(top) - 1, c(z + d) - 1, h.wall);
  box(b, x, floor - 2.5, z, x + w, floor - 0.5, z + d, h.wall);
  box(b, x, floor - 0.5, z, x + w, floor, z + d, 'concrete');
  box(b, x + 0.5, floor, z + 0.5, x + w - 0.5, top, z + d - 0.5, null);
  box(b, x, top, z, x + w, top + 0.5, z + d, 'plank');
  const mx = x + Math.floor(w / 2);
  const mz = z + Math.floor(d / 2);
  const hole = (side: number, y0: number, y1: number): void => {
    if (side === 0) box(b, mx, y0, z, mx + 1, y1, z + 0.5, null);
    else if (side === 1) box(b, mx, y0, z + d - 0.5, mx + 1, y1, z + d, null);
    else if (side === 2) box(b, x, y0, mz, x + 0.5, y1, mz + 1, null);
    else box(b, x + w - 0.5, y0, mz, x + w, y1, mz + 1, null);
  };
  hole(h.door, floor, floor + 2);
  hole(h.door ^ 1, floor + 1, floor + 2);
  box(b, mx, top - 0.5, mz, mx + 0.5, top, mz + 0.5, 'lamp');
  loot(x + 1, floor, z + 1);
  loot(x + w - 1.5, floor, z + d - 1.5);
}

/** As casas da vila em volta da praça (centro em 200, 211). */
const HOUSES: readonly House[] = [
  { x: 168, z: 186, w: 7, d: 6, door: 1, wall: 'brick' },
  { x: 178, z: 186, w: 6, d: 6, door: 1, wall: 'plank' },
  { x: 188, z: 186, w: 7, d: 6, door: 1, wall: 'cinder-block' },
  { x: 206, z: 186, w: 7, d: 6, door: 1, wall: 'plank' },
  { x: 216, z: 186, w: 6, d: 6, door: 1, wall: 'brick' },
  { x: 226, z: 186, w: 7, d: 6, door: 1, wall: 'cinder-block' },
  { x: 168, z: 198, w: 6, d: 7, door: 3, wall: 'cinder-block' },
  { x: 168, z: 214, w: 6, d: 7, door: 3, wall: 'brick' },
  { x: 227, z: 198, w: 6, d: 7, door: 2, wall: 'plank' },
  { x: 227, z: 214, w: 6, d: 7, door: 2, wall: 'cinder-block' },
  { x: 168, z: 230, w: 7, d: 6, door: 0, wall: 'plank' },
  { x: 178, z: 230, w: 6, d: 6, door: 0, wall: 'brick' },
  { x: 188, z: 230, w: 7, d: 6, door: 0, wall: 'brick' },
  { x: 206, z: 230, w: 7, d: 6, door: 0, wall: 'cinder-block' },
  { x: 216, z: 230, w: 6, d: 6, door: 0, wall: 'plank' },
  { x: 226, z: 230, w: 7, d: 6, door: 0, wall: 'brick' },
];

/**
 * O galpão da vila (14 × 10 m, 4 m de pé-direito, telhado de chapa): duas portas largas nos lados curtos, janelas
 * altas, caixotes por dentro e 4 pontos de loot.
 */
function warehouse(b: MapBuilder, x: number, z: number, floor: number, loot: Loot): void {
  const w = 14;
  const d = 10;
  const top = floor + 4;
  b.walls(c(x), c(floor), c(z), c(x + w) - 1, c(top) - 1, c(z + d) - 1, 'metal-panel');
  box(b, x, floor - 2.5, z, x + w, floor - 0.5, z + d, 'concrete');
  box(b, x, floor - 0.5, z, x + w, floor, z + d, 'concrete');
  box(b, x + 0.5, floor, z + 0.5, x + w - 0.5, top, z + d - 0.5, null);
  box(b, x, top, z, x + w, top + 0.5, z + d, 'metal-panel');
  // As portas de 2 m nos lados oeste e leste, no meio; as janelas altas nos lados compridos.
  box(b, x, floor, z + 4, x + 0.5, floor + 2.5, z + 6, null);
  box(b, x + w - 0.5, floor, z + 4, x + w, floor + 2.5, z + 6, null);
  for (const wx of [x + 3, x + 7, x + 10]) {
    box(b, wx, floor + 2.5, z, wx + 1, floor + 3.5, z + 0.5, 'glass');
    box(b, wx, floor + 2.5, z + d - 0.5, wx + 1, floor + 3.5, z + d, 'glass');
  }
  box(b, x + 3, floor, z + 0.5, x + 4, floor + 1, z + 1.5, 'crate');
  box(b, x + 9, floor, z + 7, x + 11, floor + 1, z + 8, 'crate');
  box(b, x + 6, floor, z + 2, x + 7, floor + 1.5, z + 3, 'crate');
  box(b, x + 6.5, top - 0.5, z + 4.5, x + 7, top, z + 5, 'lamp');
  loot(x + 2, floor, z + 7.5);
  loot(x + 5, floor, z + 5);
  loot(x + 9, floor, z + 2);
  loot(x + 12, floor, z + 7);
}

/** O farol no alto do morro (torre listrada de 10 m, com a lanterna) e a casinha do faroleiro. */
function lighthouse(b: MapBuilder, t: Terrain, loot: Loot): void {
  const H = HILL_LIGHT;
  const base = t.height(H.x, H.z);
  box(b, H.x - 2, base - 1, H.z - 2, H.x + 2, base, H.z + 2, 'concrete');
  for (let y = 0; y < 10; y++) {
    box(b, H.x - 2, base + y, H.z - 2, H.x + 2, base + y + 1, H.z + 2, y % 2 === 0 ? 'concrete' : 'brick');
  }
  box(b, H.x - 2.5, base + 10, H.z - 2.5, H.x + 2.5, base + 10.5, H.z + 2.5, 'metal-panel');
  box(b, H.x - 1, base + 10.5, H.z - 1, H.x + 1, base + 12, H.z + 1, 'lamp');
  box(b, H.x - 1.5, base + 12, H.z - 1.5, H.x + 1.5, base + 12.5, H.z + 1.5, 'metal-panel');
  house(b, { x: H.x + 4, z: H.z - 1, w: 5, d: 5, door: 1, wall: 'cinder-block' }, t.height(H.x + 6.5, H.z + 1.5), loot);
}

/** O porto: o pátio de contêineres (2 fileiras, uma pilha de 2), o depósito e o píer de tábua para o leste. */
function harbor(b: MapBuilder, t: Terrain, loot: Loot): void {
  const y = YARD.h;
  container(b, { x: 304, y, z: 70, along: 'x', color: 'blue' });
  container(b, { x: 304, y, z: 76, along: 'x', color: 'tan', doors: 'start' });
  container(b, { x: 313, y, z: 70, along: 'x', color: 'green', length: 12 });
  const up = container(b, { x: 313, y, z: 72.5, along: 'x', color: 'red', length: 12, doors: 'none' });
  container(b, { x: 316, y: up, z: 72.5, along: 'x', color: 'blue', doors: 'none' });
  container(b, { x: 328, y, z: 78, along: 'z', color: 'tan' });
  container(b, { x: 333, y, z: 78, along: 'z', color: 'green', doors: 'end' });
  loot(310.5, y, 74);
  loot(326, y, 70.5);
  loot(331, y, 81);
  house(b, { x: 304, z: 88, w: 8, d: 7, door: 0, wall: 'metal-panel' }, y, loot);
  box(b, 322, y, 92, 323, y + 1, 93, 'crate');
  box(b, 323, y, 92, 324, y + 1, 93, 'crate');
  // O píer: da praia leste da ilha, 2,5 m de largura, até a água funda o bastante para o barco (que não existe).
  let x = 340;
  while (x < 380 && t.height(x, 86) > SEABED + 0.5) x += 0.5;
  x -= 3;
  box(b, x, SEABED + 0.5, 85, x + 18, SEABED + 1, 87.5, 'plank');
  for (let k = 0; k < 18; k += 4) {
    box(b, x + k, SEABED - 0.5, 85, x + k + 0.5, SEABED + 0.5, 85.5, 'log');
    box(b, x + k, SEABED - 0.5, 87, x + k + 0.5, SEABED + 0.5, 87.5, 'log');
  }
  b.prop('bollard', x + 16.5, SEABED + 1, 85.5, 0, 1, 1);
  b.prop('bollard', x + 16.5, SEABED + 1, 87, 0, 1, 1);
  loot(x + 15, SEABED + 1, 86.25);
}

/** A fazenda: o celeiro de madeira com a porta de X, a casa, o silo, os fardos de feno e a roça. */
function farmstead(b: MapBuilder, loot: Loot): void {
  const y = FARMYARD.h;
  // O celeiro (12 × 10 m, 4,5 m de parede), a porta de 3 m no lado leste e uma porta de 1 m no oeste.
  const bx = 66;
  const bz = 304;
  b.walls(c(bx), c(y), c(bz), c(bx + 12) - 1, c(y + 4.5) - 1, c(bz + 10) - 1, 'barn-wood');
  box(b, bx, y - 2.5, bz, bx + 12, y - 0.5, bz + 10, 'barn-wood');
  box(b, bx, y - 0.5, bz, bx + 12, y, bz + 10, 'plank');
  box(b, bx + 0.5, y, bz + 0.5, bx + 11.5, y + 4.5, bz + 9.5, null);
  box(b, bx, y + 4.5, bz, bx + 12, y + 5, bz + 10, 'plank');
  barnDoor(b, bx + 11.5, y + 3, bz + 3, 'z', 4, 1.5);
  box(b, bx + 11.5, y, bz + 3, bx + 12, y + 3, bz + 7, null);
  box(b, bx, y, bz + 5, bx + 0.5, y + 2, bz + 6, null);
  // Os fardos encostados na parede (sem fresta de meio metro atrás deles).
  box(b, bx + 0.5, y, bz + 0.5, bx + 2.5, y + 1, bz + 1.5, 'hay-bale');
  box(b, bx + 0.5, y, bz + 8.5, bx + 1.5, y + 1.5, bz + 9.5, 'hay-bale');
  box(b, bx + 8, y, bz + 0.5, bx + 10, y + 1, bz + 1.5, 'hay-bale');
  box(b, bx + 5.5, y + 4, bz + 4.5, bx + 6, y + 4.5, bz + 5, 'lamp');
  loot(bx + 2, y, bz + 4);
  loot(bx + 6, y, bz + 7.5);
  loot(bx + 9.5, y, bz + 3);
  // A casa da fazenda, o silo e os rolos de feno no terreiro.
  house(b, { x: 88, z: 304, w: 8, d: 7, door: 1, wall: 'siding' }, y, loot);
  b.prop('silo', 98, y, 326, 0, 1, 1);
  b.prop('hay-roll', 82, y, 322, 0.6, 1, 1);
  b.prop('hay-roll', 86, y, 334, 1.9, 1, 1);
  box(b, 72, y, 330, 74, y + 1, 331, 'hay-bale');
  box(b, 72, y + 1, 330, 73, y + 2, 331, 'hay-bale');
  loot(75, y, 333);
  // A roça: terra arada com milho em fileiras (o milho segura a vista; a bala passa).
  for (let z = 316; z < 338; z += 2) {
    for (let x = 64; x < 79; x += 0.5) {
      b.set(c(x), c(y) - 1, c(z), 'farmland');
      if ((z / 2) % 2 === 0 && x > 64.5 && x < 78) b.cross(c(x), c(y), c(z), 'crops');
    }
  }
}

/** O acampamento: as barracas em roda, a cabana, os caixotes e a torre de rádio de treliça no morrote. */
function campsite(b: MapBuilder, t: Terrain, loot: Loot): void {
  const y = CLEARING.h;
  const cx = 313;
  const cz = 313;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    const x = Math.round((cx + Math.cos(a) * 9) * 2) / 2;
    const z = Math.round((cz + Math.sin(a) * 9) * 2) / 2;
    // A porta da lona (o -Z local) virada para o meio da roda.
    const yaw = Math.atan2(x - cx, z - cz);
    box(b, x - 2.5, y, z - 2.5, x + 2.5, y + 4, z + 2.5, null);
    b.prop('tarp', x, y, z, yaw, 1, 1);
    if (i % 2 === 0) loot(Math.floor(x - Math.sin(yaw) * 2.25) + 0.5, y, Math.floor(z - Math.cos(yaw) * 2.25) + 0.5);
  }
  box(b, cx - 0.5, y, cz - 0.5, cx + 0.5, y + 0.5, cz + 0.5, 'log');
  house(b, { x: 300, z: 300, w: 6, d: 5, door: 1, wall: 'plank' }, y, loot);
  box(b, 322, y, 302, 323, y + 1, 303, 'crate');
  box(b, 323, y, 302, 324, y + 1.5, 303, 'crate');
  loot(321, y, 304);
  // A torre de rádio (treliça de 1 × 1 m e 14 m; a bala e a vista passam) com a luz no alto.
  const H = HILL_CAMP;
  const base = t.height(H.x, H.z);
  box(b, H.x - 1.5, base - 1, H.z - 1.5, H.x + 1.5, base, H.z + 1.5, 'concrete');
  box(b, H.x - 0.5, base, H.z - 0.5, H.x + 0.5, base + 14, H.z + 0.5, 'crane-lattice');
  box(b, H.x - 0.5, base + 14, H.z - 0.5, H.x + 0.5, base + 14.5, H.z + 0.5, 'lamp');
  box(b, H.x + 2, base, H.z - 1, H.x + 3, base + 1, H.z, 'crate');
  loot(H.x + 2.5, base, H.z + 1.5);
}

/** A caixa d'água no morro do norte da ilha grande, com loot embaixo. */
function waterTower(b: MapBuilder, t: Terrain, loot: Loot): void {
  const H = HILL_NORTH;
  const base = t.height(H.x, H.z);
  box(b, H.x - 3, base - 1, H.z - 3, H.x + 3, base, H.z + 3, 'concrete');
  b.prop('water-tank', H.x, base, H.z, 0, 1, 1);
  loot(H.x + 2.5, base, H.z + 2.5);
}

/** Árvores (e coqueiros nas ilhotas), arbustos e mato na grama, longe das construções (a semente do mapa). */
function nature(
  b: MapBuilder,
  t: Terrain,
  spawns: readonly (readonly [number, number])[],
  trees: [number, number][],
): void {
  const rng = b.rng('natureza');
  const grassy = (x: number, z: number): boolean => b.get(c(x - 0.25), c(t.height(x, z)) - 1, c(z - 0.25)) === 'grass';
  const busy = (x: number, z: number): boolean =>
    FLATS.some((f) => inFlat(f, x, z, 4)) ||
    HILLS.some((k) => Math.hypot(x - k.x, z - k.z) < 9) ||
    spawns.some(([sx, sz]) => Math.hypot(x - sx, z - sz) < 3);
  const flat = (x: number, z: number): boolean => {
    const h = t.height(x, z);
    return t.height(x - 1, z) === h && t.height(x + 1, z) === h && t.height(x, z - 1) === h && t.height(x, z + 1) === h;
  };
  const nearTree = (x: number, z: number): boolean => trees.some(([tx, tz]) => Math.hypot(x - tx, z - tz) < 2);
  // Um coqueiro em cada ilhota, num quadrado de areia aplainado de 2 m (sem degrau embaixo do tronco).
  for (const s of ISLETS) {
    const h = Math.max(SEABED + 1, t.height(s.x, s.z));
    box(b, s.x - 1, SEABED, s.z - 1, s.x + 1, h, s.z + 1, 'sand');
    box(b, s.x - 1, h, s.z - 1, s.x + 1, h + 3, s.z + 1, null);
    b.prop('tree', s.x, h, s.z, rng.range(0, Math.PI * 2), 1, 1);
    trees.push([s.x, s.z]);
  }
  for (let i = 0; i < 9000 && trees.length < 480; i++) {
    const x = rng.range(MIN + 4, MAX - 4);
    const z = rng.range(MIN + 4, MAX - 4);
    if (busy(x, z) || t.sandy(x, z) || t.height(x, z) <= SEABED + 1 || !flat(x, z)) continue;
    const tx = Math.round(x * 2) / 2;
    const tz = Math.round(z * 2) / 2;
    if (nearTree(tx, tz) || !grassy(tx + 0.25, tz + 0.25) || !grassy(tx - 0.25, tz - 0.25)) continue;
    b.prop('tree', tx, t.height(x, z), tz, rng.range(0, Math.PI * 2), 1, 1);
    trees.push([tx, tz]);
  }
  for (let i = 0; i < 36000; i++) {
    const cx = Math.floor(rng.range(MIN, MAX) * 2);
    const cz = Math.floor(rng.range(MIN, MAX) * 2);
    const x = (cx + 0.5) / 2;
    const z = (cz + 0.5) / 2;
    if (busy(x, z) || t.sandy(x, z) || t.height(x, z) <= SEABED + 1 || nearTree(x, z) || !grassy(x, z)) continue;
    const cy = c(t.height(x, z));
    if (b.get(cx, cy, cz) !== null) continue;
    const kind = rng.next();
    b.cross(cx, cy, cz, kind < 0.68 ? 'tall-grass' : kind < 0.85 ? 'flowers' : 'bush');
  }
}

const archipelago: MapScript = {
  id: 'archipelago',
  // Mapa aberto de 380 m de área: a declarada cobre a diagonal da área (o `mapc` não precisa medir par a par; a
  // distância de visão da partida, 140 m no PC, limita o que se vê).
  analysis: { sightLimitM: 560, openSight: true },
  build(b) {
    b.size(SIZE * 2, 64, SIZE * 2);
    b.meta({
      nameKey: 'map.archipelago.name',
      modes: ['royale.grande'],
      players: { min: 2, ideal: 48, max: 48 },
      maxSightLineM: 560,
      botCaps: { pcSplit: 0, mobile: 0, switch1p: 0, switch2p: 0, switch34p: 0 },
    });
    b.playArea(MIN, MIN, MAX, MAX, SEABED - 10);
    b.sun(0.35, 0.85, -0.4, 'day');
    const t = terrain(b);
    ground(b, t);
    // As estradas da ilha grande: da vila ao morro do norte e às praias dos 4 baixios.
    road(b, t, 200, VILLAGE.z0, 200, HILL_NORTH.z + 8, 3);
    road(b, t, VILLAGE.x0, VILLAGE.z0, 150, 152, 2.5);
    road(b, t, VILLAGE.x1, VILLAGE.z0, 250, 152, 2.5);
    road(b, t, VILLAGE.x0, VILLAGE.z1, 152, 256, 2.5);
    road(b, t, VILLAGE.x1, VILLAGE.z1, 252, 256, 2.5);
    // As trilhas das ilhas de fora: do baixio ao centro de cada uma.
    road(b, t, 114, 116, LIGHT.x + 8, LIGHT.z + 6, 2);
    road(b, t, 286, 114, YARD.x0 + 4, YARD.z1, 2);
    road(b, t, 114, 288, FARMYARD.x1, FARMYARD.z0 + 4, 2);
    road(b, t, 288, 288, CLEARING.x0, CLEARING.z0, 2);
    let lootN = 0;
    const loot: Loot = (x, y, z) => {
      b.lootSpot({ id: `l${lootN++}`, x, y, z, radius: 0.6 });
    };
    for (const h of HOUSES) house(b, h, VILLAGE.h, loot);
    warehouse(b, 193, 196, VILLAGE.h, loot);
    lighthouse(b, t, loot);
    harbor(b, t, loot);
    farmstead(b, loot);
    campsite(b, t, loot);
    waterTower(b, t, loot);
    // As largadas: uma grade de 24 m (em quincunce) sobre a terra, fora das construções e dos morros; com 48
    // esquadrões, o Royale escolhe as mais afastadas entre si.
    const spawns: [number, number][] = [];
    for (let gz = 0; gz < 17; gz++) {
      for (let gx = 0; gx < 17; gx++) {
        const x = 14.25 + gx * 24 + (gz % 2) * 12;
        const z = 14.25 + gz * 24;
        if (FLATS.some((f) => inFlat(f, x, z, 4)) || HILLS.some((k) => Math.hypot(x - k.x, z - k.z) < 10)) continue;
        if (t.height(x, z) <= SEABED + 1 || x < MIN + 4 || x > MAX - 4 || z < MIN + 4 || z > MAX - 4) continue;
        spawns.push([x, z]);
      }
    }
    const trees: [number, number][] = [];
    nature(b, t, spawns, trees);
    // Loot no campo: perto de caixotes soltos (a semente do mapa), fora das construções e da areia.
    const rng = b.rng('loot');
    for (let i = 0; i < 1600 && lootN < 104; i++) {
      const x = Math.round(rng.range(MIN + 10, MAX - 10) * 2) / 2;
      const z = Math.round(rng.range(MIN + 10, MAX - 10) * 2) / 2;
      if (t.sandy(x, z) || t.height(x, z) <= SEABED + 1) continue;
      if (FLATS.some((f) => inFlat(f, x, z, 4)) || HILLS.some((k) => Math.hypot(x - k.x, z - k.z) < 8)) continue;
      if (trees.some(([tx, tz]) => Math.hypot(x + 1.5 - tx, z + 0.5 - tz) < 3)) continue;
      if (spawns.some(([sx, sz]) => Math.hypot(x + 1 - sx, z - sz) < 3)) continue;
      const h = t.height(x, z);
      let flat = true;
      for (let dx = -0.5; dx <= 3 && flat; dx += 0.5) {
        for (let dz = -1; dz <= 2 && flat; dz += 0.5) flat = t.height(x + dx, z + dz) === h;
      }
      if (!flat || b.get(c(x + 1), c(h), c(z)) !== null) continue;
      box(b, x + 1, h, z, x + 2, h + 1, z + 1, 'crate');
      loot(x, h, z);
    }
    for (const [x, z] of spawns) {
      const yaw = Math.atan2(-(BIG.x - x), -(BIG.z - z));
      b.spawn({ x, y: t.height(x, z), z, yaw, team: -1 });
    }
    // 4 largadas na praça da vila.
    for (const [x, z] of [
      [196.25, 208.25],
      [204.25, 208.25],
      [196.25, 216.25],
      [204.25, 216.25],
    ] as const) {
      b.spawn({ x, y: VILLAGE.h, z, yaw: 0, team: -1 });
    }
    const camera = (name: string, x: number, y: number, z: number, tx: number, ty: number, tz: number): void =>
      b.camera({
        name,
        x,
        y,
        z,
        yaw: Math.atan2(-(tx - x), -(tz - z)),
        pitch: Math.atan2(ty - y, Math.hypot(tx - x, tz - z)),
        fovYDeg: 0,
      });
    camera('print:archipelago', 200, 150, 440, 200, 0, 195);
    camera('print:vila-grande', 200, 14, 262, 200, 4, 212);
    camera('print:porto', 290, 16, 120, 318, 4, 82);
    camera('print:fazenda', 118, 12, 352, 80, 4, 318);
    camera('print:acampamento', 290, 10, 290, 318, 4, 318);
  },
};

export default archipelago;
