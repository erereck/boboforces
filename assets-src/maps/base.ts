import type { MapBuilder, MapScript } from '../../tools/mapc/src/api.ts';

/**
 * BASE ABANDONADA (nome provisório, GDD §4.9; M3, fase 5a): o mapa do Bobo Zombies, à noite. Grade de 68×20×68 m
 * (136×40×136 células), área jogável de 46×48 m (x de 12 a 58, z de 10 a 58) cercada de arame com holofotes: o
 * anel de fora fica estreito para nenhuma reta passar dos 50 m do Switch 3–4P.
 * - QG (x 20..36, z 28..40): onde os bobos nascem; 3 janelas (2 no oeste e 1 no norte); Buzzer e Door Knocker na parede;
 *   a Caixa Misteriosa começa aqui.
 * - REFEITÓRIO (x 24..40, z 14..28), ao norte, pela porta de 750: mesas, 4 janelas, Rattler e a Buddy Brew.
 * - PÁTIO (x 36..52, z 28..46), a leste, pela porta de 1000: a torre de rádio, a caixa d'água, 4 janelas, a Peekaboo e a
 *   Speedy Soda. Uma 2ª porta de 750 liga o Pátio ao Refeitório (dá a volta).
 * - GARAGEM (x 18..36, z 40..54), ao sul, pelos escombros de 1250: o jipe, 4 janelas, a Lawnmower e a Chonky Cola.
 * - Fora dos muros: os zumbis nascem em 10 pontos perto da cerca e entram pelas janelas.
 *
 * Muros de bloco de 3 m sem teto (base abandonada); lâmpadas no alto dos muros iluminam as salas. Tudo em METROS aqui
 * (múltiplos de 0,5); o builder recebe células. Caixas semiabertas [a, b). Vãos de 1 m começam em metro inteiro (a
 * grade de navegação é de 1 m).
 */

const c = (m: number): number => Math.round(m * 2);
const G = 1;
/** A área jogável (a cerca): estreita o bastante para nenhuma reta entre a cerca e os muros passar de ~48 m. */
const MIN_X = 12;
const MAX_X = 58;
const MIN_Z = 10;
const MAX_Z = 58;
const WALL_H = 3;
const GAP_H = 2;

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

/** Muro de bloco de 3 m [x0, x1) × [z0, z1). */
function wall(b: MapBuilder, x0: number, z0: number, x1: number, z1: number): void {
  box(b, x0, G, z0, x1, G + WALL_H, z1, 'cinder-block');
}

/** Vão de `w` m (e `h` de altura) num muro: centro (x, z) no plano do muro; `alongX` = o muro corre em X. */
function gap(b: MapBuilder, alongX: boolean, x: number, z: number, w = 1, h = GAP_H): void {
  if (alongX) box(b, x - w / 2, G, z - 0.25, x + w / 2, G + h, z + 0.25, null);
  else box(b, x - 0.25, G, z - w / 2, x + 0.25, G + h, z + w / 2, null);
}

function ground(b: MapBuilder): void {
  box(b, 0, 0, 0, 68, 0.5, 68, 'dirt');
  box(b, 0, 0.5, 0, 68, G, 68, 'grass');
  box(b, MIN_X, 0.5, MIN_Z, MAX_X, G, MAX_Z, 'dirt');
  // Pisos: concreto no QG, no Refeitório e no Pátio; faixa de concreto na Garagem.
  box(b, 20, 0.5, 28, 36, G, 40, 'concrete');
  box(b, 24, 0.5, 14, 40, G, 28, 'concrete');
  box(b, 36, 0.5, 28, 52, G, 46, 'concrete');
  box(b, 18, 0.5, 40, 36, G, 54, 'concrete-stripe');
  // A cerca de arame na borda da área jogável, com a faixa de terra batida.
  const fence = (x0: number, z0: number, x1: number, z1: number): void =>
    b.panel(c(x0), c(G), c(z0), c(x1) - 1, c(G + 2.5) - 1, c(z1) - 1, 'fence-wire');
  fence(MIN_X - 0.5, MIN_Z - 0.5, MAX_X + 0.5, MIN_Z);
  fence(MIN_X - 0.5, MAX_Z, MAX_X + 0.5, MAX_Z + 0.5);
  fence(MIN_X - 0.5, MIN_Z - 0.5, MIN_X, MAX_Z + 0.5);
  fence(MAX_X, MIN_Z - 0.5, MAX_X + 0.5, MAX_Z + 0.5);
}

/** Os muros das 4 áreas (um muro por divisa) com as portas e as janelas abertas. */
function walls(b: MapBuilder): void {
  // Divisa z = 28 (QG/fora, QG/Refeitório, Refeitório/Pátio, Pátio/fora).
  wall(b, 20, 28, 52, 28.5);
  // QG: oeste; leste (QG/Pátio, segue como Pátio/Garagem); sul (QG/Garagem, com o pedaço de fora da Garagem).
  wall(b, 20, 28, 20.5, 40);
  wall(b, 36, 28, 36.5, 46);
  wall(b, 18, 40, 36, 40.5);
  // Refeitório: oeste, norte e leste.
  wall(b, 24, 14, 24.5, 28);
  wall(b, 24, 14, 40, 14.5);
  wall(b, 39.5, 14, 40, 28);
  // Pátio: leste e sul.
  wall(b, 51.5, 28, 52, 46);
  wall(b, 36, 45.5, 52, 46);
  // Garagem: oeste, sul e o leste de fora (z 46..54).
  wall(b, 18, 40, 18.5, 54);
  wall(b, 18, 53.5, 36, 54);
  wall(b, 35.5, 46, 36, 54);
  for (const w of WINDOWS) gap(b, w.alongX, w.x, w.z);
  for (const d of DOORS) gap(b, d.alongX, d.x, d.z, 2, GAP_H);
}

/** Janelas: centro do vão no plano do muro, de que lado fica a rua e se o muro corre em X. */
const WINDOWS: readonly { x: number; z: number; outside: 0 | 1 | 2 | 3; alongX: boolean }[] = [
  // QG.
  { x: 20.25, z: 31.5, outside: 1, alongX: false },
  { x: 20.25, z: 37.5, outside: 1, alongX: false },
  { x: 22.5, z: 28.25, outside: 3, alongX: true },
  // Refeitório.
  { x: 28.5, z: 14.25, outside: 3, alongX: true },
  { x: 35.5, z: 14.25, outside: 3, alongX: true },
  { x: 24.25, z: 20.5, outside: 1, alongX: false },
  { x: 39.75, z: 21.5, outside: 0, alongX: false },
  // Pátio.
  { x: 51.75, z: 32.5, outside: 0, alongX: false },
  { x: 51.75, z: 41.5, outside: 0, alongX: false },
  { x: 46.5, z: 28.25, outside: 3, alongX: true },
  { x: 43.5, z: 45.75, outside: 2, alongX: true },
  // Garagem.
  { x: 18.25, z: 47.5, outside: 1, alongX: false },
  { x: 25.5, z: 53.75, outside: 2, alongX: true },
  { x: 32.5, z: 53.75, outside: 2, alongX: true },
];

/** Portas pagas de 2 m: centro no plano do muro, se o muro corre em X e o preço. */
const DOORS: readonly { x: number; z: number; alongX: boolean; cost: number }[] = [
  { x: 30, z: 28.25, alongX: true, cost: 750 },
  { x: 36.25, z: 34, alongX: false, cost: 1000 },
  { x: 27, z: 40.25, alongX: true, cost: 1250 },
  { x: 38, z: 28.25, alongX: true, cost: 750 },
];

function objects(b: MapBuilder): void {
  for (const w of WINDOWS) b.barricade({ x: w.x, y: G, z: w.z, outside: w.outside, width: 1, height: GAP_H });
  for (const d of DOORS) {
    b.paidDoor({
      minX: d.alongX ? d.x - 1 : d.x - 0.25,
      minY: G,
      minZ: d.alongX ? d.z - 0.25 : d.z - 1,
      maxX: d.alongX ? d.x + 1 : d.x + 0.25,
      maxY: G + GAP_H,
      maxZ: d.alongX ? d.z + 0.25 : d.z + 1,
      cost: d.cost,
    });
  }
  // Armas na parede (ponto na face de dentro do muro, no chão).
  b.wallBuy({ x: 36, y: G, z: 30.5, facing: 1, weapon: 'smg', cost: 1000 });
  b.wallBuy({ x: 23.5, y: G, z: 40, facing: 3, weapon: 'shotgun', cost: 900 });
  b.wallBuy({ x: 32, y: G, z: 14.5, facing: 2, weapon: 'rifle', cost: 1200 });
  b.wallBuy({ x: 51.5, y: G, z: 37, facing: 1, weapon: 'sniper', cost: 1000 });
  b.wallBuy({ x: 27.5, y: G, z: 53.5, facing: 3, weapon: 'lmg', cost: 1500 });
  // A Caixa Misteriosa: começa no QG; pode ir para o Refeitório e para a Garagem.
  b.boxSpot({ x: 34, y: G, z: 29.3, facing: 2 });
  b.boxSpot({ x: 26.5, y: G, z: 15.3, facing: 2 });
  b.boxSpot({ x: 34.7, y: G, z: 50, facing: 1 });
  // As vantagens.
  b.perkMachine({ x: 25.3, y: G, z: 25, facing: 0, perk: 'buddy', cost: 1500 });
  b.perkMachine({ x: 40, y: G, z: 44.7, facing: 3, perk: 'speedy', cost: 3000 });
  b.perkMachine({ x: 19.3, y: G, z: 51, facing: 0, perk: 'chonky', cost: 2500 });
}

/** Dentro: mesas no Refeitório, caixotes, o jipe, a caixa d'água e a torre de rádio; lâmpadas no alto dos muros. */
function props(b: MapBuilder): void {
  // Refeitório: 2 fileiras de mesas (tampo de tábua a 0,5 m sobre o chão; cobertura baixa).
  for (const z of [18, 23]) {
    box(b, 28, G, z, 31, G + 0.5, z + 1, 'plank-slab');
    box(b, 33, G, z, 36, G + 0.5, z + 1, 'plank-slab');
  }
  // QG: caixotes e o gerador.
  box(b, 20.5, G, 38.5, 22, G + 1, 40, 'crate');
  b.prop('generator', 33.5, G, 37.5, Math.PI / 2, 1, 1);
  // Pátio: a torre de rádio (coluna de 1 m até 9 m, plataforma de grade e um holofote), a caixa d'água e sacos.
  box(b, 44, G, 36, 45, G + 8, 37, 'metal-panel');
  box(b, 43, G + 8, 35, 46, G + 8.5, 38, 'grate-slab');
  b.prop('floodlight', 44.5, G + 8.5, 36.5, Math.PI * 0.75, 1, 1);
  b.prop('water-tank', 48.5, G, 31.5, 0, 1, 1);
  b.prop('sandbags', 40, G, 40, 0, 1, 1);
  box(b, 46, G, 42, 47.5, G + 1.5, 43.5, 'crate');
  // Garagem: o jipe, tambores e caixotes.
  b.prop('jeep', 27, G, 47.5, Math.PI / 2, 1, 1);
  b.prop('barrel', 21, G, 43, 0, 1, 1);
  b.prop('barrel', 22, G, 43.5, 1, 1, 1);
  b.prop('crate-large', 32, G, 43, 0.3, 1, 1);
  // Lâmpadas presas no alto dos muros, viradas para dentro (luz das salas à noite).
  const lamp = (x: number, z: number): void => box(b, x, G + 2.5, z, x + 0.5, G + 3, z + 0.5, 'lamp');
  lamp(20.5, 34);
  lamp(35.5, 37.5);
  lamp(24.5, 17);
  lamp(39, 25);
  lamp(32, 14.5);
  lamp(36.5, 30);
  lamp(51, 36);
  lamp(41, 45);
  lamp(18.5, 44);
  lamp(35, 52.5);
  lamp(24, 53);
  // Fora: galpões e contêineres no anel entre a cerca e os muros (cortam as linhas de visão longas e dão cobertura).
  const shed = (x0: number, z0: number, x1: number, z1: number, h = 3): void =>
    box(b, x0, G, z0, x1, G + h, z1, 'metal-panel');
  shed(46, 16, 49, 19);
  shed(48, 50, 51, 53, 2.5);
  shed(13, 40, 15, 43, 2.5);
  shed(43, 11, 45, 13, 2.5);
  // Fora: holofotes nos cantos da cerca, árvores e caixotes perdidos.
  b.prop('floodlight', MIN_X + 1, G, MIN_Z + 1, Math.PI * 0.25, 1, 1);
  b.prop('floodlight', MAX_X - 1, G, MIN_Z + 1, -Math.PI * 0.25, 1, 1);
  b.prop('floodlight', MIN_X + 1, G, MAX_Z - 1, Math.PI * 0.75, 1, 1);
  b.prop('floodlight', MAX_X - 1, G, MAX_Z - 1, -Math.PI * 0.75, 1, 1);
  box(b, 54, G, 22, 55.5, G + 1.5, 23.5, 'crate');
  b.prop('barrel', 56, G, 50, 0, 1, 1);
  b.prop('tarp', 52, G, 13, 0.5, 1, 1);
}

function border(b: MapBuilder): void {
  const rng = b.rng('borda');
  const outside = (x: number, z: number): boolean => x < MIN_X - 1 || x >= MAX_X + 1 || z < MIN_Z - 1 || z >= MAX_Z + 1;
  for (let x = 0.5; x < 67.5; x += 0.5) {
    for (let z = 0.5; z < 67.5; z += 0.5) {
      if (!outside(x, z)) continue;
      const roll = rng.next();
      if (roll < 0.05) b.cross(c(x), c(G), c(z), 'tall-grass');
      else if (roll < 0.053) box(b, x, G, z, x + 0.5, G + 0.5, z + 0.5, 'bush');
    }
  }
  for (const [x, z] of [
    [2, 3],
    [65, 4],
    [3, 64],
    [64, 65],
    [34, 2],
    [2, 34],
  ] as const) {
    b.prop('tree', x, G, z, rng.range(0, Math.PI * 2), 1, 1);
  }
}

function spawns(b: MapBuilder): void {
  for (const [x, z] of [
    [23, 31],
    [23, 37],
    [27, 33],
    [27, 36],
  ] as const) {
    b.spawn({ x, y: G, z, yaw: yawTo(x, z, 30, 34), team: 0 });
  }
  for (const [x, z] of [
    [15, 22],
    [15, 34],
    [16, 49],
    [30, 12],
    [50, 12],
    [56, 26],
    [55, 40],
    [46, 55],
    [28, 56],
    [15, 56],
  ] as const) {
    b.spawn({ x, y: G, z, yaw: yawTo(x, z, 34, 34), team: -1 });
  }
}

function cameras(b: MapBuilder): void {
  const camera = (name: string, x: number, y: number, z: number, tx: number, ty: number, tz: number): void =>
    b.camera({ name, x, y, z, yaw: yawTo(x, z, tx, tz), pitch: pitchTo(x, y, z, tx, ty, tz), fovYDeg: 0 });
  camera('print:base', 34, 26, 66, 34, G, 30);
  camera('print:base-qg', 33, G + 1.55, 38, 21, G + 1, 31);
  camera('print:base-patio', 38, G + 1.55, 30, 50, G + 3, 44);
}

const base: MapScript = {
  id: 'base',
  build(b) {
    b.size(136, 40, 136);
    b.meta({
      nameKey: 'map.base.name',
      modes: ['zombies'],
      players: { min: 1, ideal: 4, max: 4 },
      maxSightLineM: 50,
      botCaps: {},
    });
    b.playArea(MIN_X, MIN_Z, MAX_X, MAX_Z, G - 10);
    b.sun(0.35, 0.6, 0.45, 'night');
    ground(b);
    border(b);
    walls(b);
    props(b);
    objects(b);
    spawns(b);
    cameras(b);
  },
};

export default base;
