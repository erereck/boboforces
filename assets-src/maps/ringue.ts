import type { MapBuilder, MapScript } from '../../tools/mapc/src/api.ts';

/**
 * RINGUE (nome provisório; gameplay.md §8.5: arena pequena de treino com alvos e estandes; M2, fase 5c): grade de
 * 48×20×48 m (96×40×96 células), área jogável de 36×36 m (x, z de 6 a 42), um nível só. Modos naturais: X1 (TDM
 * pequeno), Bobo Training e o Testar do Laboratório; FFA não.
 * - Meio: o RINGUE, um tablado de 10×10 m a 0,5 m do chão (o degrau automático sobe), com cordas e uma entrada de 2 m
 *   no meio de cada lado.
 * - Coberturas espelhadas oeste/leste (o time A nasce no oeste, o B no leste, atrás de um abrigo de 2,5 m com saídas
 *   no norte e no sul): caixotes nos 4 cantos, muretas de 1 m na frente de cada base e paredes de bloco de 2 m no norte
 *   e no sul do ringue.
 * - Norte: as BAIAS (estandes de tiro): 5 baias de 4 m com divisórias de bloco e um toldo de lona, viradas para a
 *   arena.
 * - Borda: a área jogável acaba numa parede invisível; a FAIXA LISTRADA amarela marca o limite no chão, com um
 *   corrimão logo fora (gameplay.md §8.4). Fora: grama, mato e árvores.
 *
 * Tudo em METROS aqui (múltiplos de 0,5); o builder recebe células. Caixas semiabertas [a, b).
 */

const c = (m: number): number => Math.round(m * 2);
/** Piso do chão (metros). */
const G = 1;
/** A área jogável e o meio. */
const MIN = 6;
const MAX = 42;
const MID = 24;

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

/** Corrimão numa linha (metros), de `height` metros. */
function fence(b: MapBuilder, x0: number, z0: number, x1: number, z1: number, y: number, height = 1): void {
  const ax = c(x0);
  const az = c(z0);
  b.fence(ax, c(y), az, x0 === x1 ? ax : c(x1) - 1, z0 === z1 ? az : c(z1) - 1, 'railing', c(height));
}

/** Espelha (x, z) do oeste para o leste. */
const mirror = (x: number): number => MIN + MAX - x;

function ground(b: MapBuilder): void {
  box(b, 0, 0, 0, 48, 0.5, 48, 'dirt');
  box(b, 0, 0.5, 0, 48, G, 48, 'grass');
  box(b, MIN, 0.5, MIN, MAX, G, MAX, 'test-floor');
  // A faixa listrada no limite (meio metro para dentro) e o corrimão logo fora.
  box(b, MIN, 0.5, MIN, MAX, G, MIN + 0.5, 'test-floor-stripe');
  box(b, MIN, 0.5, MAX - 0.5, MAX, G, MAX, 'test-floor-stripe');
  box(b, MIN, 0.5, MIN, MIN + 0.5, G, MAX, 'test-floor-stripe');
  box(b, MAX - 0.5, 0.5, MIN, MAX, G, MAX, 'test-floor-stripe');
  fence(b, MIN - 0.5, MIN - 0.5, MAX + 0.5, MIN - 0.5, G);
  fence(b, MIN - 0.5, MAX, MAX + 0.5, MAX, G);
  fence(b, MIN - 0.5, MIN - 0.5, MIN - 0.5, MAX + 0.5, G);
  fence(b, MAX, MIN - 0.5, MAX, MAX + 0.5, G);
}

/** Fora da área: mato em cruz, arbustos e árvores de bloco, sorteados (semente do mapa). */
function border(b: MapBuilder): void {
  const rng = b.rng('borda');
  const outside = (x: number, z: number): boolean => x < MIN - 1 || x >= MAX + 1 || z < MIN - 1 || z >= MAX + 1;
  for (let x = 0.5; x < 47.5; x += 0.5) {
    for (let z = 0.5; z < 47.5; z += 0.5) {
      if (!outside(x, z)) continue;
      const roll = rng.next();
      if (roll < 0.05) b.cross(c(x), c(G), c(z), 'tall-grass');
      else if (roll < 0.06) b.cross(c(x), c(G), c(z), 'flowers');
      else if (roll < 0.064) box(b, x, G, z, x + 0.5, G + 0.5, z + 0.5, 'bush');
    }
  }
  for (const [x, z] of [
    [2, 3],
    [45, 4],
    [3, 44],
    [44, 45],
    [24, 2],
    [2, 24],
  ] as const) {
    b.prop('tree', x, G, z, rng.range(0, Math.PI * 2), 1, 1);
  }
}

/** O ringue do meio: tablado de concreto, postes nos cantos e cordas com uma entrada no meio de cada lado. */
function ring(b: MapBuilder): void {
  const a = MID - 5;
  const z = MID + 5;
  box(b, a, G, a, z, G + 0.5, z, 'concrete');
  const top = G + 0.5;
  for (const [x, zz] of [
    [a, a],
    [z - 0.5, a],
    [a, z - 0.5],
    [z - 0.5, z - 0.5],
  ] as const) {
    box(b, x, top, zz, x + 0.5, top + 1.5, zz + 0.5, 'concrete');
  }
  // Cordas: de cada poste até a entrada de 2 m no meio do lado.
  for (const [x0, x1] of [
    [a + 0.5, MID - 1],
    [MID + 1, z - 0.5],
  ] as const) {
    fence(b, x0, a, x1, a, top);
    fence(b, x0, z - 0.5, x1, z - 0.5, top);
    fence(b, a, x0, a, x1, top);
    fence(b, z - 0.5, x0, z - 0.5, x1, top);
  }
}

/** Coberturas espelhadas oeste/leste. */
function covers(b: MapBuilder): void {
  for (const west of [true, false]) {
    const m = (x: number): number => (west ? x : mirror(x) - 0.5);
    const crate = (x: number, zz: number): void => {
      const x0 = west ? x : mirror(x) - 2;
      box(b, x0, G, zz, x0 + 2, G + 1.5, zz + 2, 'crate');
    };
    // Caixotes nos cantos (altura de cobertura alta para quem agacha).
    crate(11, 11);
    crate(11, 35);
    // Abrigo de 2,5 m na frente dos nascimentos do time (saídas no norte e no sul).
    box(b, m(10.5), G, 15, m(10.5) + 0.5, G + 2.5, 33, 'cinder-block');
    // Muretas de 1 m na frente da base (cobertura baixa), deixando o corredor do meio livre.
    box(b, m(15), G, 15, m(15) + 0.5, G + 1, 19, 'concrete');
    box(b, m(15), G, 29, m(15) + 0.5, G + 1, 33, 'concrete');
  }
  // Paredes de bloco de 2 m ao norte e ao sul do ringue (cortam a linha de visão de um canto ao outro).
  box(b, 22, G, 14.5, 26, G + 2, 15, 'cinder-block');
  box(b, 22, G, 33, 26, G + 2, 33.5, 'cinder-block');
  // Sacos de areia na frente de cada base.
  b.prop('sandbags', 9.5, G, 24, Math.PI / 2, 1, 1);
  b.prop('sandbags', 38.5, G, 24, -Math.PI / 2, 1, 1);
}

/** As baias de tiro no norte: 5 baias de 4 m, divisórias de 1,2 m e um toldo de lona a 2,5 m. */
function stands(b: MapBuilder): void {
  // Encostadas no limite (sem fresta de meio metro entre a divisória e a parede invisível).
  const z0 = MIN;
  const z1 = z0 + 3.5;
  for (let x = 14; x <= 34; x += 4) box(b, x, G, z0, x + 0.5, G + 1.5, z1, 'cinder-block');
  box(b, 14, G + 2.5, z0, 34.5, G + 3, z1, 'canvas');
  // Bancada baixa na frente de cada baia (apoio; não cobre o tiro).
  for (let x = 14.5; x < 34; x += 4) box(b, x, G, z1, x + 3.5, G + 0.5, z1 + 0.5, 'plank-slab');
  b.prop('floodlight', MIN + 1, G, MIN + 1, Math.PI * 0.25, 1, 1);
  b.prop('floodlight', MAX - 1, G, MIN + 1, -Math.PI * 0.25, 1, 1);
}

function spawns(b: MapBuilder): void {
  const spawn = (x: number, z: number, team: number): void => b.spawn({ x, y: G, z, yaw: yawTo(x, z, MID, MID), team });
  // 6 por time, atrás do abrigo (os times não se veem ao nascer).
  for (const z of [16.5, 19.5, 22.5, 25.5, 28.5, 31.5]) {
    spawn(8, z, 0);
    spawn(40, z, 1);
  }
  // 16 sem time, espalhados (o Bobo Training renasce os bots e os alvos por eles): cantos, perto das baias e do
  // fundo, nas saídas dos abrigos e em volta do ringue.
  for (const [x, z] of [
    [8.5, 8.5],
    [39.5, 8.5],
    [8.5, 39.5],
    [39.5, 39.5],
    [16.5, 11.5],
    [31.5, 11.5],
    [16.5, 36.5],
    [31.5, 36.5],
    [8.5, 14],
    [39.5, 14],
    [8.5, 34],
    [39.5, 34],
    [17.5, 24],
    [30.5, 24],
    [24, 17.5],
    [24, 30.5],
  ] as const) {
    spawn(x, z, -1);
  }
}

function cameras(b: MapBuilder): void {
  const camera = (name: string, x: number, y: number, z: number, tx: number, ty: number, tz: number): void =>
    b.camera({ name, x, y, z, yaw: yawTo(x, z, tx, tz), pitch: pitchTo(x, y, z, tx, ty, tz), fovYDeg: 0 });
  camera('print:ringue', MID, 13, 46, MID, G, 22);
  camera('print:baias', MID, G + 1.55, 30, MID, G + 1, MIN);
}

const ringue: MapScript = {
  id: 'ringue',
  build(b) {
    b.size(96, 40, 96);
    b.meta({
      nameKey: 'map.ringue.name',
      // X1 e 2v2 (TDM pequeno) e o treino; FFA não: numa arena de 36 m, os nascimentos se veem (gameplay.md §8.5).
      modes: ['warfare.tdm', 'training'],
      players: { min: 2, ideal: 4, max: 8 },
      maxSightLineM: 50,
      botCaps: { switch34p: 6 },
    });
    b.playArea(MIN, MIN, MAX, MAX, G - 10);
    b.sun(0.4, 0.8, -0.35, 'day');
    ground(b);
    border(b);
    ring(b);
    covers(b);
    stands(b);
    spawns(b);
    cameras(b);
  },
};

export default ringue;
