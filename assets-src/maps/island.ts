import type { MapBuilder, MapScript } from '../../tools/mapc/src/api.ts';

/**
 * ILHA TROPICAL (nome provisório; M7, fase 5): o mapa do Bobo Royale Mini (GDD §4.6.4: praia, vila genérica, morro e
 * farol; ~200 × 200 m, decisão #35). Grade de 200 × 32 × 200 m (400 × 64 × 400 células), de dia. Gerado por código: o
 * relevo é um ruído de valor (a semente do mapa), quantizado em 0,5 m para os degraus serem de meio bloco.
 * - O mar (raso, dá para andar no fundo) em volta; a praia de areia na borda da ilha; a grama por dentro.
 * - O MORRO ao norte, com o FAROL no alto (só de enfeite: não se entra) e a casinha do faroleiro.
 * - A VILA ao sul do centro: uma praça e 10 casas de 3 m de pé-direito, com porta, janela e uma luminária no teto.
 * - O PÍER de tábua na praia do sul e 3 barracas na areia. Estradas de terra ligam a vila ao morro e às praias.
 * - Árvores, arbustos e mato na grama. Pontos de loot (marcador `lootSpots`) nas casas, nas barracas e no campo; os
 *   pontos de largada sem time espalhados (o Royale escolhe os mais afastados entre si).
 *
 * Tudo em METROS aqui (múltiplos de 0,5); o builder recebe células.
 */

const c = (m: number): number => Math.round(m * 2);
const SIZE = 200;
/** O centro da ilha e o raio (m) até a linha da água, antes do ruído. */
const CX = 100;
const CZ = 100;
const RADIUS = 80;
/** O fundo do mar (o topo da areia submersa) e o nível da água (a laje de água fica em cima do fundo). */
const SEABED = 1;
/** A área jogável (a água rasa em volta entra; fora dela, a parede invisível). */
const MIN = 8;
const MAX = 192;
/** O morro (o centro do topo e a altura a mais) e a vila (o retângulo plano). */
const HILL = { x: 100, z: 50, height: 11, sigma: 15 } as const;
const VILLAGE = { x0: 74, z0: 112, x1: 126, z1: 142, h: 4 } as const;

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
  // A distância normalizada até a borda da ilha (1 = a linha da água), com a borda ondulada pelo ruído.
  const shore = (x: number, z: number): number =>
    Math.hypot(x - CX, z - CZ) / RADIUS + (noise(x * 0.035, z * 0.035) - 0.5) * 0.3;
  const villageBlend = (x: number, z: number): number => {
    const dx = Math.max(VILLAGE.x0 - x, 0, x - VILLAGE.x1);
    const dz = Math.max(VILLAGE.z0 - z, 0, z - VILLAGE.z1);
    return Math.min(1, Math.hypot(dx, dz) / 8);
  };
  const raw = (x: number, z: number): number => {
    const d = shore(x, z);
    if (d >= 1) return SEABED;
    if (d >= 0.84) return SEABED + 0.5 + ((1 - d) / 0.16) * 1;
    const inland = 2.5 + (0.84 - d) * 4 + noise(x * 0.08 + 7, z * 0.08 + 3) * 1.2;
    const hill = HILL.height * Math.exp(-((x - HILL.x) ** 2 + (z - HILL.z) ** 2) / (2 * HILL.sigma * HILL.sigma));
    const t = villageBlend(x, z);
    return VILLAGE.h + (inland + hill - VILLAGE.h) * t;
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
        // A altura no centro da célula (a mesma do relevo): amostrar fora dele deixava buracos de grama na estrada.
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

interface House {
  readonly x: number;
  readonly z: number;
  readonly w: number;
  readonly d: number;
  /** Lado da porta: 0 = norte (−z), 1 = sul, 2 = oeste, 3 = leste. */
  readonly door: 0 | 1 | 2 | 3;
  readonly wall: string;
}

/** As casas da vila em volta da praça (centro em 100, 127). */
const HOUSES: readonly House[] = [
  { x: 76, z: 113, w: 7, d: 6, door: 1, wall: 'brick' },
  { x: 86, z: 113, w: 6, d: 6, door: 1, wall: 'plank' },
  { x: 108, z: 113, w: 6, d: 6, door: 1, wall: 'cinder-block' },
  { x: 117, z: 113, w: 8, d: 6, door: 1, wall: 'brick' },
  { x: 76, z: 123, w: 6, d: 7, door: 3, wall: 'cinder-block' },
  { x: 118, z: 123, w: 7, d: 7, door: 2, wall: 'plank' },
  { x: 76, z: 134, w: 7, d: 6, door: 0, wall: 'plank' },
  { x: 86, z: 135, w: 6, d: 6, door: 0, wall: 'brick' },
  { x: 108, z: 135, w: 6, d: 6, door: 0, wall: 'brick' },
  { x: 117, z: 134, w: 8, d: 6, door: 0, wall: 'cinder-block' },
];
const WALL_H = 3;

/** Uma casa: paredes, laje de teto, a porta e uma janela, a luminária do teto e 2 pontos de loot dentro. */
function house(b: MapBuilder, h: House, floor: number, loot: (x: number, y: number, z: number) => void): void {
  const { x, z, w, d } = h;
  const top = floor + WALL_H;
  b.walls(c(x), c(floor), c(z), c(x + w) - 1, c(top) - 1, c(z + d) - 1, h.wall);
  // O alicerce (2 m da parede abaixo do piso) e o interior vazio: na encosta, a laje não flutua nem enterra o chão.
  box(b, x, floor - 2.5, z, x + w, floor - 0.5, z + d, h.wall);
  box(b, x, floor - 0.5, z, x + w, floor, z + d, 'concrete');
  box(b, x + 0.5, floor, z + 0.5, x + w - 0.5, top, z + d - 0.5, null);
  box(b, x, top, z, x + w, top + 0.5, z + d, 'plank');
  // A porta (1 × 2 m) no meio do lado dela e a janela (1 × 1 m, a 1 m do chão) no lado oposto.
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

/** O farol no alto do morro (torre listrada de 10 m, com a lanterna) e a casinha do faroleiro. */
function lighthouse(b: MapBuilder, t: Terrain, loot: (x: number, y: number, z: number) => void): void {
  const base = t.height(HILL.x, HILL.z);
  // A base meio bloco abaixo do centro do morro (sem vão nas quinas da encosta).
  box(b, HILL.x - 2, base - 1, HILL.z - 2, HILL.x + 2, base, HILL.z + 2, 'concrete');
  for (let y = 0; y < 10; y++) {
    box(b, HILL.x - 2, base + y, HILL.z - 2, HILL.x + 2, base + y + 1, HILL.z + 2, y % 2 === 0 ? 'concrete' : 'brick');
  }
  box(b, HILL.x - 2.5, base + 10, HILL.z - 2.5, HILL.x + 2.5, base + 10.5, HILL.z + 2.5, 'metal-panel');
  box(b, HILL.x - 1, base + 10.5, HILL.z - 1, HILL.x + 1, base + 12, HILL.z + 1, 'lamp');
  box(b, HILL.x - 1.5, base + 12, HILL.z - 1.5, HILL.x + 1.5, base + 12.5, HILL.z + 1.5, 'metal-panel');
  // A casinha do faroleiro, ao lado (a porta para o sul).
  house(
    b,
    { x: HILL.x + 4, z: HILL.z - 1, w: 5, d: 5, door: 1, wall: 'cinder-block' },
    t.height(HILL.x + 6.5, HILL.z + 1.5),
    loot,
  );
}

/** O píer de tábua na praia do sul (2 m de largura, sobre a água) e as barracas na areia. */
function beach(b: MapBuilder, t: Terrain, loot: (x: number, y: number, z: number) => void): void {
  let z = 150;
  while (z < 185 && t.height(100, z) > SEABED + 0.5) z += 0.5;
  z -= 2;
  box(b, 99, SEABED + 0.5, z, 101, SEABED + 1, z + 14, 'plank');
  for (let k = 0; k < 14; k += 4) {
    box(b, 99, SEABED - 0.5, z + k, 99.5, SEABED + 0.5, z + k + 0.5, 'log');
    box(b, 100.5, SEABED - 0.5, z + k, 101, SEABED + 0.5, z + k + 0.5, 'log');
  }
  loot(100, SEABED + 1, z + 13);
  for (const [x, zz, yaw] of [
    [62, 150, 0.4],
    [138, 150, -0.4],
    [40, 100, Math.PI / 2],
  ] as const) {
    const h = t.height(x, zz);
    box(b, x - 2.5, h, zz - 2.5, x + 2.5, h + 4, zz + 2.5, null);
    box(b, x - 2.5, h - 0.5, zz - 2.5, x + 2.5, h, zz + 2.5, 'sand');
    b.prop('tarp', x, h, zz, yaw, 1, 1);
    // O loot na frente da porta (o -Z local da lona), fora do colisor dela.
    loot(Math.floor(x - Math.sin(yaw) * 2.25) + 0.5, h, Math.floor(zz - Math.cos(yaw) * 2.25) + 0.5);
  }
}

/** Árvores, arbustos e mato na grama, longe da vila, das estradas e do farol (a semente do mapa). */
function nature(
  b: MapBuilder,
  t: Terrain,
  spawns: readonly (readonly [number, number])[],
  trees: [number, number][],
): void {
  const rng = b.rng('natureza');
  // Só onde o topo real da célula é grama (fora das estradas, das barracas e da praia).
  const grassy = (x: number, z: number): boolean => b.get(c(x - 0.25), c(t.height(x, z)) - 1, c(z - 0.25)) === 'grass';
  const busy = (x: number, z: number): boolean =>
    (x > VILLAGE.x0 - 4 && x < VILLAGE.x1 + 4 && z > VILLAGE.z0 - 4 && z < VILLAGE.z1 + 4) ||
    Math.hypot(x - HILL.x, z - HILL.z) < 12 ||
    Math.abs(x - 100) < 3 ||
    spawns.some(([sx, sz]) => Math.hypot(x - sx, z - sz) < 3);
  const flat = (x: number, z: number): boolean => {
    const h = t.height(x, z);
    return t.height(x - 1, z) === h && t.height(x + 1, z) === h && t.height(x, z - 1) === h && t.height(x, z + 1) === h;
  };
  const nearTree = (x: number, z: number): boolean => trees.some(([tx, tz]) => Math.hypot(x - tx, z - tz) < 2);
  for (let i = 0; i < 2000 && trees.length < 140; i++) {
    const x = rng.range(MIN + 4, MAX - 4);
    const z = rng.range(MIN + 4, MAX - 4);
    if (busy(x, z) || t.sandy(x, z) || t.height(x, z) <= SEABED + 1 || !flat(x, z)) continue;
    const tx = Math.round(x * 2) / 2;
    const tz = Math.round(z * 2) / 2;
    if (nearTree(tx, tz) || !grassy(tx + 0.25, tz + 0.25) || !grassy(tx - 0.25, tz - 0.25)) continue;
    b.prop('tree', tx, t.height(x, z), tz, rng.range(0, Math.PI * 2), 1, 1);
    trees.push([tx, tz]);
  }
  // A planta encaixada na célula antes de medir a altura (a mesma do relevo); o arbusto também é cruzado.
  for (let i = 0; i < 9000; i++) {
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

const island: MapScript = {
  id: 'island',
  // Mapa grande: as linhas de visão vão longe (a névoa e a distância de visão da partida limitam o que se vê).
  analysis: { sightLimitM: 190 },
  build(b) {
    b.size(SIZE * 2, 64, SIZE * 2);
    b.meta({
      nameKey: 'map.island.name',
      modes: ['royale.mini'],
      players: { min: 2, ideal: 24, max: 24 },
      maxSightLineM: 190,
      botCaps: {},
    });
    b.playArea(MIN, MIN, MAX, MAX, SEABED - 10);
    b.sun(-0.4, 0.85, -0.3, 'day');
    const t = terrain(b);
    ground(b, t);
    // As estradas: da vila ao morro, às praias do leste e do oeste e ao píer.
    road(b, t, 100, VILLAGE.z0, 100, HILL.z + 6, 3);
    road(b, t, VILLAGE.x1, 127, 168, 127, 2.5);
    road(b, t, VILLAGE.x0, 127, 32, 120, 2.5);
    road(b, t, 100, VILLAGE.z1, 100, 152, 3);
    let lootN = 0;
    const loot = (x: number, y: number, z: number): void => {
      b.lootSpot({ id: `l${lootN++}`, x, y, z, radius: 0.6 });
    };
    for (const h of HOUSES) house(b, h, VILLAGE.h, loot);
    lighthouse(b, t, loot);
    beach(b, t, loot);
    // As largadas (M7, fase 6): uma grade de 18 m sobre a terra, fora da vila, do farol, da estrada do meio e da água;
    // com 24 participantes, o Royale escolhe as mais afastadas entre si (sem briga logo na largada).
    const spawns: [number, number][] = [];
    for (let gx = 0; gx < 11; gx++) {
      for (let gz = 0; gz < 11; gz++) {
        // As linhas ímpares deslocadas meia casa (a grade vira um quincunce).
        const x = 10.25 + gx * 18 + (gz % 2) * 9;
        const z = 10.25 + gz * 18;
        if (x > VILLAGE.x0 - 3 && x < VILLAGE.x1 + 3 && z > VILLAGE.z0 - 3 && z < VILLAGE.z1 + 3) continue;
        if (Math.hypot(x - HILL.x, z - HILL.z) < 10 || Math.abs(x - 100) < 3) continue;
        if (t.height(x, z) <= SEABED + 1 || x < MIN + 4 || x > MAX - 4 || z < MIN + 4 || z > MAX - 4) continue;
        spawns.push([x, z]);
      }
    }
    const trees: [number, number][] = [];
    nature(b, t, spawns, trees);
    // Loot no campo: perto de caixotes soltos (a semente do mapa), fora da vila e da areia.
    const rng = b.rng('loot');
    for (let i = 0; i < 400 && lootN < 60; i++) {
      const x = Math.round(rng.range(MIN + 10, MAX - 10) * 2) / 2;
      const z = Math.round(rng.range(MIN + 10, MAX - 10) * 2) / 2;
      if (t.sandy(x, z) || t.height(x, z) <= SEABED + 1) continue;
      if (x > VILLAGE.x0 - 4 && x < VILLAGE.x1 + 4 && z > VILLAGE.z0 - 4 && z < VILLAGE.z1 + 4) continue;
      if (Math.hypot(x - HILL.x, z - HILL.z) < 8) continue;
      if (trees.some(([tx, tz]) => Math.hypot(x + 1.5 - tx, z + 0.5 - tz) < 3)) continue;
      if (spawns.some(([sx, sz]) => Math.hypot(x + 1 - sx, z - sz) < 3)) continue;
      const h = t.height(x, z);
      let flat = true;
      for (let dx = -0.5; dx <= 3 && flat; dx += 0.5) {
        for (let dz = -1; dz <= 2 && flat; dz += 0.5) flat = t.height(x + dx, z + dz) === h;
      }
      if (!flat) continue;
      box(b, x + 1, h, z, x + 2, h + 1, z + 1, 'crate');
      loot(x, h, z);
    }
    // Os pontos de largada sem time: a grade pela ilha e 4 na praça.
    for (const [x, z] of spawns) {
      const yaw = Math.atan2(-(CX - x), -(CZ - z));
      b.spawn({ x, y: t.height(x, z), z, yaw, team: -1 });
    }
    for (const [x, z] of [
      [96.25, 122.25],
      [104.25, 122.25],
      [96.25, 131.25],
      [104.25, 131.25],
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
    camera('print:island', 100, 70, 210, 100, 0, 95);
    camera('print:vila', 100, 12, 158, 100, 3, 124);
    camera('print:farol', 120, 20, 78, 100, 20, 50);
    camera('print:praia', 70, 4, 160, 100, 2, 165);
  },
};

export default island;
