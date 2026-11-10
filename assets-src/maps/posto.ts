import type { MapBuilder, MapScript } from '../../tools/mapc/src/api.ts';

/**
 * POSTO AVANÇADO (nome provisório; M3, fase 3d): o mapa pequeno do Bobo Zombies, para testar janelas e porta paga
 * antes da Base Abandonada (fase 5). Grade de 48×20×48 m (96×40×96 células), área jogável de 36×36 m (x, z de 6 a
 * 42), ao entardecer.
 * - Meio: o POSTO, um cercado de muro de bloco de 3 m (sem teto) de 20×16 m (x 14..34, z 16..32), dividido por um muro
 *   em x = 24 em duas salas: a SALA 1 (oeste, onde os bobos nascem) e a SALA 2 (leste), ligadas por uma PORTA PAGA de
 *   1 m (750 pontos) no meio do muro.
 * - Janelas: 3 por sala (norte, sul e a parede de fora), vãos de 1 m no chão com 2 m de altura (verga em cima), cada
 *   uma com 6 tábuas. O zumbi entra por elas; o bobo não sai por elas.
 * - Fora: terra, mato e caixotes; os zumbis nascem nos 4 cantos e no meio de cada lado, longe dos muros.
 *
 * Tudo em METROS aqui (múltiplos de 0,5); o builder recebe células. Caixas semiabertas [a, b).
 */

const c = (m: number): number => Math.round(m * 2);
/** Piso do chão (metros). */
const G = 1;
const MIN = 6;
const MAX = 42;
/** O cercado e o muro do meio. */
const X0 = 14;
const X1 = 34;
const Z0 = 16;
const Z1 = 32;
const XM = 24;
const WALL_H = 3;
/** Vão das janelas e da porta (m). */
const GAP = 1;
const GAP_H = 2;
/** Centro da porta no muro do meio (vãos de 1 m começam em metro inteiro: a grade de navegação é de 1 m). */
const DOOR_Z = 24.5;

function yawTo(x: number, z: number, tx: number, tz: number): number {
  return Math.atan2(-(tx - x), -(tz - z));
}

function pitchTo(x: number, y: number, z: number, tx: number, ty: number, tz: number): number {
  return Math.atan2(ty - y, Math.hypot(tx - x, tz - z));
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

function fence(b: MapBuilder, x0: number, z0: number, x1: number, z1: number, y: number, height = 1): void {
  const ax = c(x0);
  const az = c(z0);
  b.fence(ax, c(y), az, x0 === x1 ? ax : c(x1) - 1, z0 === z1 ? az : c(z1) - 1, 'railing', c(height));
}

function ground(b: MapBuilder): void {
  box(b, 0, 0, 0, 48, 0.5, 48, 'dirt');
  box(b, 0, 0.5, 0, 48, G, 48, 'grass');
  box(b, MIN, 0.5, MIN, MAX, G, MAX, 'dirt');
  // Piso de concreto no posto.
  box(b, X0, 0.5, Z0, X1, G, Z1, 'concrete');
  fence(b, MIN - 0.5, MIN - 0.5, MAX + 0.5, MIN - 0.5, G);
  fence(b, MIN - 0.5, MAX, MAX + 0.5, MAX, G);
  fence(b, MIN - 0.5, MIN - 0.5, MIN - 0.5, MAX + 0.5, G);
  fence(b, MAX, MIN - 0.5, MAX, MAX + 0.5, G);
}

/** Abre um vão de `GAP` m (e `GAP_H` de altura) no muro, com centro em (x, z) no plano do muro. */
function gap(b: MapBuilder, alongX: boolean, x: number, z: number): void {
  if (alongX) box(b, x - GAP / 2, G, z - 0.25, x + GAP / 2, G + GAP_H, z + 0.25, null);
  else box(b, x - 0.25, G, z - GAP / 2, x + 0.25, G + GAP_H, z + GAP / 2, null);
}

/** Os muros do posto (0,5 m de espessura) e o do meio, com os vãos das janelas e da porta. */
function walls(b: MapBuilder): void {
  box(b, X0, G, Z0, X1, G + WALL_H, Z0 + 0.5, 'cinder-block');
  box(b, X0, G, Z1 - 0.5, X1, G + WALL_H, Z1, 'cinder-block');
  box(b, X0, G, Z0, X0 + 0.5, G + WALL_H, Z1, 'cinder-block');
  box(b, X1 - 0.5, G, Z0, X1, G + WALL_H, Z1, 'cinder-block');
  box(b, XM, G, Z0, XM + 0.5, G + WALL_H, Z1, 'cinder-block');
  for (const w of WINDOWS) gap(b, w.alongX, w.x, w.z);
  gap(b, false, XM + 0.25, DOOR_Z);
}

/** Janelas: centro do vão no plano do muro, de que lado fica a rua e se o muro corre em X. */
const WINDOWS: readonly { x: number; z: number; outside: 0 | 1 | 2 | 3; alongX: boolean }[] = [
  // Sala 1: norte, sul e oeste.
  { x: 18.5, z: Z0 + 0.25, outside: 3, alongX: true },
  { x: 19.5, z: Z1 - 0.25, outside: 2, alongX: true },
  { x: X0 + 0.25, z: 24.5, outside: 1, alongX: false },
  // Sala 2: norte, sul e leste.
  { x: 29.5, z: Z0 + 0.25, outside: 3, alongX: true },
  { x: 28.5, z: Z1 - 0.25, outside: 2, alongX: true },
  { x: X1 - 0.25, z: 24.5, outside: 0, alongX: false },
];

function objects(b: MapBuilder): void {
  for (const w of WINDOWS) b.barricade({ x: w.x, y: G, z: w.z, outside: w.outside, width: GAP, height: GAP_H });
  const zc = DOOR_Z;
  b.paidDoor({
    minX: XM,
    minY: G,
    minZ: zc - GAP / 2,
    maxX: XM + 0.5,
    maxY: G + GAP_H,
    maxZ: zc + GAP / 2,
    cost: 750,
  });
}

/** Dentro: caixotes de cobertura baixa e um gerador; fora: caixotes, sacos de areia e holofotes. */
function props(b: MapBuilder): void {
  box(b, 16, G, 27, 17.5, G + 1, 28.5, 'crate');
  box(b, 21, G, 19, 22.5, G + 1, 20.5, 'crate');
  box(b, 30.5, G, 27.5, 32, G + 1.5, 29, 'crate');
  b.prop('generator', 27, G, 20, 0, 1, 1);
  b.prop('sandbags', 10, G, 24, Math.PI / 2, 1, 1);
  b.prop('sandbags', 38, G, 24, -Math.PI / 2, 1, 1);
  box(b, 9, G, 11, 10.5, G + 1.5, 12.5, 'crate');
  box(b, 37.5, G, 35.5, 39, G + 1.5, 37, 'crate');
  b.prop('floodlight', MIN + 1, G, MIN + 1, Math.PI * 0.25, 1, 1);
  b.prop('floodlight', MAX - 1, G, MAX - 1, Math.PI * 1.25, 1, 1);
}

/** Fora da área: mato e árvores, sorteados (semente do mapa). */
function border(b: MapBuilder): void {
  const rng = b.rng('borda');
  const outside = (x: number, z: number): boolean => x < MIN - 1 || x >= MAX + 1 || z < MIN - 1 || z >= MAX + 1;
  for (let x = 0.5; x < 47.5; x += 0.5) {
    for (let z = 0.5; z < 47.5; z += 0.5) {
      if (!outside(x, z)) continue;
      const roll = rng.next();
      if (roll < 0.05) b.cross(c(x), c(G), c(z), 'tall-grass');
      else if (roll < 0.054) box(b, x, G, z, x + 0.5, G + 0.5, z + 0.5, 'bush');
    }
  }
  for (const [x, z] of [
    [2, 3],
    [45, 4],
    [3, 44],
    [44, 45],
  ] as const) {
    b.prop('tree', x, G, z, rng.range(0, Math.PI * 2), 1, 1);
  }
}

function spawns(b: MapBuilder): void {
  // Os bobos (time 0) nascem na sala 1.
  for (const [x, z] of [
    [17, 22],
    [17, 26],
    [21, 22],
    [21, 26],
  ] as const) {
    b.spawn({ x, y: G, z, yaw: yawTo(x, z, 19, 24), team: 0 });
  }
  // Os zumbis (sem time) nascem fora, longe dos muros.
  for (const [x, z] of [
    [8, 8],
    [40, 8],
    [8, 40],
    [40, 40],
    [24, 8],
    [24, 40],
    [8, 24],
    [40, 24],
  ] as const) {
    b.spawn({ x, y: G, z, yaw: yawTo(x, z, 24, 24), team: -1 });
  }
}

function cameras(b: MapBuilder): void {
  const camera = (name: string, x: number, y: number, z: number, tx: number, ty: number, tz: number): void =>
    b.camera({ name, x, y, z, yaw: yawTo(x, z, tx, tz), pitch: pitchTo(x, y, z, tx, ty, tz), fovYDeg: 0 });
  camera('print:posto', 24, 16, 44, 24, G, 22);
  camera('print:janela', 17, G + 1.55, 21, 18.5, G + 1, Z0);
}

const posto: MapScript = {
  id: 'posto',
  build(b) {
    b.size(96, 40, 96);
    b.meta({
      nameKey: 'map.posto.name',
      modes: ['zombies'],
      players: { min: 1, ideal: 4, max: 4 },
      maxSightLineM: 40,
      botCaps: {},
    });
    b.playArea(MIN, MIN, MAX, MAX, G - 10);
    b.sun(-0.5, 0.45, -0.4, 'dusk');
    ground(b);
    border(b);
    walls(b);
    props(b);
    objects(b);
    spawns(b);
    cameras(b);
  },
};

export default posto;
