import type { MapBuilder, MapScript } from '../../tools/mapc/src/api.ts';

/**
 * BASE BOBO (nome provisório; M7, fase 1): o mapa do BoboStrike (GDD §4.6.4: base militar cartunesca diurna com
 * hangar, 2 sites e 3 rotas), que também joga TDM. Grade de 72×24×72 m (144×48×144 células), área jogável de 64×64 m
 * (x, z de 4 a 68), de dia.
 * - Sul: a PISTA (z 56..68), onde os atacantes (time 0 na largada) nascem.
 * - Norte, no meio: o PÁTIO dos defensores (x 30..42, z 4..14), onde o time 1 nasce.
 * - Site A: o HANGAR (noroeste, x 4..28, z 4..26), com o portão grande no sul (para a rota oeste), uma porta a leste
 *   (para o meio) e metade do teto (a parte norte, com luminárias).
 * - Site B: o PÁTIO DE CARGA (nordeste, x 46..68, z 4..26), a céu aberto, com contêineres e caixotes; aberto ao sul
 *   (para a rota leste) e com uma passagem a oeste (para o meio).
 * - As 3 rotas: OESTE (x 4..14) até a praça na frente do hangar; MEIO (x 30..42), com a torre de controle no meio,
 *   ligando aos dois sites por corredores curtos; LESTE (x 58..68) até o pátio de carga. Entre elas, os barracões
 *   (blocos fechados de tijolo e chapa).
 *
 * Tudo em METROS aqui (múltiplos de 0,5); o builder recebe células. Caixas semiabertas [a, b).
 */

const c = (m: number): number => Math.round(m * 2);
/** Piso do chão (metros). */
const G = 1;
const MIN = 4;
const MAX = 68;
/** Altura dos barracões e dos muros entre as rotas. */
const WALL_H = 5;
const HANGAR_H = 7;

/** Centro dos sites (pés) e raio (m). */
export const AIRBASE_SITES = {
  A: { x: 15, z: 13, radius: 5 },
  B: { x: 57, z: 14, radius: 5 },
} as const;

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

/** Só as paredes (0,5 m) de [x0, x1) × [z0, z1), da altura y0 até y1. */
function shell(
  b: MapBuilder,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  y0: number,
  y1: number,
  block: string,
): void {
  b.walls(c(x0), c(y0), c(z0), c(x1) - 1, c(y1) - 1, c(z1) - 1, block);
}

function fence(b: MapBuilder, x0: number, z0: number, x1: number, z1: number, y: number, height = 1): void {
  const ax = c(x0);
  const az = c(z0);
  b.fence(ax, c(y), az, x0 === x1 ? ax : c(x1) - 1, z0 === z1 ? az : c(z1) - 1, 'railing', c(height));
}

/** Pilha de caixotes de bloco (cobertura): pegada w × d m, altura h m. */
function crates(b: MapBuilder, x: number, z: number, w: number, d: number, h: number): void {
  box(b, x, G, z, x + w, G + h, z + d, 'crate');
}

/** Contêiner de chapa (2,5 × 6 m, 2,5 m de altura), deitado em X ou em Z. */
function container(b: MapBuilder, x: number, z: number, alongX: boolean): void {
  if (alongX) box(b, x, G, z, x + 6, G + 2.5, z + 2.5, 'metal-panel');
  else box(b, x, G, z, x + 2.5, G + 2.5, z + 6, 'metal-panel');
}

function ground(b: MapBuilder): void {
  box(b, 0, 0, 0, 72, 0.5, 72, 'dirt');
  box(b, 0, 0.5, 0, 72, G, 72, 'grass');
  // O pátio de concreto da base inteira e a pista listrada no sul.
  box(b, MIN, 0.5, MIN, MAX, G, MAX, 'concrete');
  box(b, 8, 0.5, 61.5, 64, G, 62, 'concrete-stripe');
  for (let x = 10; x < 64; x += 6) box(b, x, 0.5, 64.5, x + 3, G, 65, 'concrete-stripe');
  // A cerca de arame em volta da área jogável.
  fence(b, MIN - 0.5, MIN - 0.5, MAX + 0.5, MIN - 0.5, G, 2);
  fence(b, MIN - 0.5, MAX, MAX + 0.5, MAX, G, 2);
  fence(b, MIN - 0.5, MIN - 0.5, MIN - 0.5, MAX + 0.5, G, 2);
  fence(b, MAX, MIN - 0.5, MAX, MAX + 0.5, G, 2);
}

/** O hangar do site A: paredes de chapa, portão sul de 8 m, porta leste de 3 m e o teto na metade norte. */
function hangar(b: MapBuilder): void {
  const [x0, z0, x1, z1] = [4, 4, 28, 26];
  const top = G + HANGAR_H;
  shell(b, x0, z0, x1, z1, G, top, 'metal-panel');
  shell(b, x0, z0, x1, z1, G, G + 1, 'concrete');
  // Teto de chapa sobre a parte norte (z 4..13), com luminárias embutidas.
  box(b, x0, top, z0, x1, top + 0.5, 13, 'metal-panel');
  for (const x of [8, 14, 20, 25]) box(b, x, top - 0.5, 8, x + 1, top, 9, 'lamp');
  // Painéis luminosos nas paredes da parte coberta (sem eles o fundo fica escuro).
  for (const x of [7, 13, 19, 24]) box(b, x, G + 2, z0, x + 1.5, G + 3, z0 + 0.5, 'light-panel');
  for (const z of [6, 10]) box(b, x0, G + 2, z, x0 + 0.5, G + 3, z + 1.5, 'light-panel');
  // Portão sul (rota oeste) de 8 × 5 m e porta leste (o corredor do meio) de 3 × 3 m.
  box(b, 10, G, z1 - 0.5, 18, G + 5, z1, null);
  box(b, x1 - 0.5, G, 16, x1, G + 3, 19, null);
  // A faixa de piso do site A (para ver de onde se planta).
  box(b, 11, 0.5, 9, 19, G, 9.5, 'concrete-stripe');
  box(b, 11, 0.5, 17, 19, G, 17.5, 'concrete-stripe');
  // Dentro: caixotes de cobertura, o jipe e barris. M11 (fase 1): as pilhas de 1,5 m viraram de 2 m (a escalada no ar
  // vence 1,5 m e a navegação só 1,0: o topo delas era poleiro só de humano e o começo dos pulos para as outras); o jipe
  // andou 0,5 m para leste, com as pontas na grade de 1 m da navegação (o capô, a 0,94 m, liga ao chão pelo pulo).
  crates(b, 6, 15, 2, 2, 2);
  crates(b, 22, 6, 2, 3, 2);
  crates(b, 20, 20, 3, 2, 1);
  crates(b, 9, 21, 1.5, 1.5, 2);
  b.prop('jeep', 15.5, G, 6.5, Math.PI / 2, 1, 1);
  b.prop('barrel', 25, G, 23, 0, 1, 1);
  b.prop('barrel', 26, G, 22, 0, 1, 1);
}

/** O pátio de carga do site B: muro no norte e no leste (a borda), contêineres, caixotes e a caixa d'água. */
function cargo(b: MapBuilder): void {
  // Muro sul do pátio (com a abertura de 10 m para a rota leste) e o oeste (com a passagem para o meio).
  box(b, 46, G, 25.5, 58, G + WALL_H, 26, 'brick');
  box(b, 46, G, 4, 46.5, G + WALL_H, 16, 'brick');
  box(b, 46, G, 20, 46.5, G + WALL_H, 26, 'brick');
  box(b, 52, 0.5, 9, 62, G, 9.5, 'concrete-stripe');
  box(b, 52, 0.5, 19, 62, G, 19.5, 'concrete-stripe');
  container(b, 49, 5, false);
  container(b, 61, 21, true);
  container(b, 61, 18.5, true);
  crates(b, 54, 12, 2, 2, 2); // M11 (fase 1): 2 m (era 1,5; ver o hangar)
  crates(b, 59, 7, 1.5, 3, 2);
  crates(b, 50, 20, 2, 1.5, 1);
  b.prop('water-tank', 65, G, 7, 0, 1, 1);
  b.prop('sandbags', 53, G, 23.5, 0, 1, 1);
}

/** Os barracões entre as rotas: o oeste-meio (x 14..30) e o meio-leste (x 42..58), entre z 30 e 56. */
function barracks(b: MapBuilder): void {
  // Oeste-meio: dois blocos encostados (sem beco onde se esconder).
  box(b, 14, G, 30, 30, G + WALL_H, 44, 'brick');
  box(b, 15, G, 44, 30, G + WALL_H, 56, 'cinder-block');
  box(b, 14, G, 41, 15, G + WALL_H, 56, 'cinder-block');
  // Meio-leste.
  box(b, 42, G, 30, 58, G + WALL_H, 40, 'cinder-block');
  box(b, 42, G, 40, 57, G + WALL_H, 56, 'brick');
  box(b, 57, G, 40, 58, G + WALL_H, 56, 'brick');
  // Telhados de chapa por cima (detalhe, sem acesso).
  box(b, 14, G + WALL_H, 30, 30, G + WALL_H + 0.5, 56, 'metal-panel');
  box(b, 42, G + WALL_H, 30, 58, G + WALL_H + 0.5, 56, 'metal-panel');
  // Muro curto entre a praça do hangar e o corredor do meio (guia a rota oeste até o portão).
  box(b, 28, G, 26, 30, G + WALL_H, 30, 'brick');
  // Muro entre o pátio dos defensores e o hangar/pátio de carga (as saídas ficam nos corredores).
  box(b, 28, G, 4, 30, G + WALL_H, 14, 'brick');
  box(b, 42, G, 4, 46, G + WALL_H, 14, 'brick');
}

/** O meio: a torre de controle (bloco de 6 × 6 m) e a cobertura dos corredores curtos. */
function middle(b: MapBuilder): void {
  box(b, 33, G, 33, 39, G + 8, 39, 'concrete');
  box(b, 32.5, G + 8, 32.5, 39.5, G + 8.5, 39.5, 'metal-panel');
  box(b, 34, G + 4, 32.5, 38, G + 5.5, 33, 'glass');
  // Sacos de areia e caixotes no meio (cobertura baixa).
  b.prop('sandbags', 36, G, 46, 0, 1, 1);
  crates(b, 31, 24, 1.5, 1.5, 1);
  crates(b, 39.5, 50, 1.5, 2, 1);
  // O QG na frente do pátio dos defensores (as saídas ficam dos lados, x 30..32 e 40..42): da pista não se vê o
  // pátio pelo corredor do meio.
  box(b, 32, G, 12, 40, G + 4, 17, 'brick');
  box(b, 32, G + 4, 12, 40, G + 4.5, 17, 'metal-panel');
  box(b, 34, G + 1.5, 16.5, 38, G + 2.5, 17, 'light-panel');
  // As saídas do pátio dobram: um muro curto na frente de cada uma (do pátio não se vê o meio em linha reta).
  box(b, 30, G, 18.5, 33, G + 3, 19, 'brick');
  box(b, 39, G, 18.5, 42, G + 3, 19, 'brick');
  // No corredor entre os sites (do pátio de carga ao hangar), a pilha de caixotes no meio quebra a vista de ponta a ponta.
  box(b, 34, G, 17, 36, G + 2.5, 19.5, 'crate');
  // Atrás da torre (sul), duas pilhas de caixotes: as diagonais do meio param nelas.
  box(b, 31.5, G, 41, 33.5, G + 2.5, 43, 'crate');
  box(b, 38.5, G, 41, 40.5, G + 2.5, 43, 'crate');
  // Na boca do corredor sul do pátio de carga (onde ele encontra o meio), uma pilha encostada no muro.
  box(b, 41.5, G, 26, 43.5, G + 2.5, 28, 'crate');
  // No pátio dos defensores: o holofote.
  b.prop('floodlight', 31, G, 5, Math.PI * 0.75, 1, 1);
  // Na rota oeste e na leste: barris e caixotes. M11 (fase 1): a pilha da rota oeste tem 2 m (era 1; do topo, um pulo
  // de 1,5 m de subida chegava ao quebra-vista vizinho e dali ao outro), como a da rota leste.
  crates(b, 11, 50, 1.5, 1.5, 2);
  crates(b, 64, 44, 2, 2, 2); // M11 (fase 1): 2 m (era 1,5; ver o hangar)
  b.prop('barrel', 7, G, 31, 0, 1, 1);
  b.prop('barrel', 66, G, 52, 0, 1, 1);
  // Quebra-vistas (2,5 m) em zigue-zague nas 3 rotas e na pista: nenhuma linha reta corre o mapa inteiro (teto de
  // 50 m). Na rota oeste e na leste, um de cada lado; na pista, dois hangarzinhos que se sobrepõem em z.
  box(b, 4, G, 44, 9.5, G + 2.5, 50, 'metal-panel');
  box(b, 8.5, G, 35, 14, G + 2.5, 41, 'metal-panel');
  box(b, 58, G, 44, 62.5, G + 2.5, 50, 'metal-panel');
  box(b, 61.5, G, 34, 68, G + 2.5, 40, 'metal-panel');
  box(b, 30, G, 46, 31.5, G + 2.5, 48, 'crate');
  box(b, 40.5, G, 24, 42, G + 2.5, 26, 'crate');
  box(b, 46, G, 56, 49, G + 3, 62.5, 'brick');
  box(b, 52, G, 61.5, 55, G + 3, 68, 'brick');
  box(b, 46, G + 3, 56, 49, G + 3.5, 62.5, 'metal-panel');
  box(b, 52, G + 3, 61.5, 55, G + 3.5, 68, 'metal-panel');
  // Na pista: o jipe e a lona.
  b.prop('jeep', 20, G, 63, 0, 1, 1);
  b.prop('tarp', 52, G, 60, 0, 1, 1);
}

/** Fora da área: mato e árvores (semente do mapa). */
function border(b: MapBuilder): void {
  const rng = b.rng('borda');
  const outside = (x: number, z: number): boolean => x < MIN - 1 || x >= MAX + 1 || z < MIN - 1 || z >= MAX + 1;
  for (let x = 0.5; x < 71.5; x += 0.5) {
    for (let z = 0.5; z < 71.5; z += 0.5) {
      if (!outside(x, z)) continue;
      const roll = rng.next();
      if (roll < 0.05) b.cross(c(x), c(G), c(z), 'tall-grass');
      else if (roll < 0.054) box(b, x, G, z, x + 0.5, G + 0.5, z + 0.5, 'bush');
    }
  }
  for (const [x, z] of [
    [1.5, 2],
    [70, 3],
    [2, 70],
    [70, 69],
    [36, 1.5],
    [1.5, 36],
  ] as const) {
    b.prop('tree', x, G, z, rng.range(0, Math.PI * 2), 1, 1);
  }
}

function spawns(b: MapBuilder): void {
  // Os atacantes (o time 0 na largada) nascem na pista.
  for (const [x, z] of [
    [30, 60],
    [33, 60],
    [36, 60],
    [39, 60],
    [42, 60],
    [36, 63],
  ] as const) {
    b.spawn({ x, y: G, z, yaw: yawTo(x, z, 36, 40), team: 0 });
  }
  // Os defensores (o time 1 na largada) nascem no pátio do norte, atrás do QG (a pista não enxerga o pátio).
  for (const [x, z] of [
    [33, 6],
    [35, 8],
    [37, 6],
    [39, 8],
    [34, 10],
    [38, 10],
  ] as const) {
    b.spawn({ x, y: G, z, yaw: yawTo(x, z, 36, 30), team: 1 });
  }
}

function objectives(b: MapBuilder): void {
  for (const [id, s] of Object.entries(AIRBASE_SITES)) {
    b.bombSite({ id, x: s.x, y: G, z: s.z, radius: s.radius });
  }
}

function cameras(b: MapBuilder): void {
  const camera = (name: string, x: number, y: number, z: number, tx: number, ty: number, tz: number): void =>
    b.camera({ name, x, y, z, yaw: yawTo(x, z, tx, tz), pitch: pitchTo(x, y, z, tx, ty, tz), fovYDeg: 0 });
  camera('print:airbase', 36, 24, 60, 36, G, 28);
  camera('print:siteA', 26, G + 3, 24, 15, G, 12);
  camera('print:siteB', 63, G + 2.5, 32, 55, G, 14);
  camera('print:meio', 36, G + 1.55, 54, 36, G + 1, 20);
}

const airbase: MapScript = {
  id: 'airbase',
  // M11 (fase 1): nenhum topo só do pulo correndo (o passe de `tools/mapc/src/jump-reach.ts`). A escalada de 1,5 m e
  // pulos curtos levavam a topos de 2,5–3,5 m (visada de 61 m): as pilhas de caixote subiram para 2 m e o jipe do hangar
  // encaixou na grade da navegação.
  build(b) {
    b.size(144, 48, 144);
    b.meta({
      nameKey: 'map.airbase.name',
      // M10 (fase 8): o Sandbox (a casa dos times 2 e 3 fica no chão das rotas oeste e leste).
      modes: ['strike', 'warfare.tdm', 'sandbox'],
      players: { min: 2, ideal: 10, max: 10 },
      maxSightLineM: 50,
      botCaps: {},
    });
    b.playArea(MIN, MIN, MAX, MAX, G - 10);
    b.sun(-0.45, 0.8, -0.35, 'day');
    ground(b);
    border(b);
    hangar(b);
    cargo(b);
    barracks(b);
    middle(b);
    spawns(b);
    objectives(b);
    cameras(b);
  },
  // M11 (fase 4): as armas no mapa (a regra `weapons.pickups`; só no TDM e no Sandbox). No chão das rotas (fora dos
  // topos que a revisão dos poleiros mexe). As fortes no meio: o foguete ao lado da torre de controle, a sniper na rota
  // oeste (do lado dos defensores) e o lança-granadas na leste (do lado dos atacantes), invertidos pelo meio do mapa e
  // a 5 m ou mais da casa dos times 2 e 3 do Sandbox (no meio dessas rotas); os pares, também invertidos: a escopeta e o
  // fuzil nas pontas das rotas (o hangar e o pátio de carga do lado dos defensores) e a SMG na rota do meio.
  weaponSpots: [
    { id: 'c1', x: 32.5, y: 1, z: 34.5, weapon: 'rocket' },
    { id: 'c2', x: 7.5, y: 1, z: 26.5, weapon: 'sniper' },
    { id: 'c3', x: 64.5, y: 1, z: 42.5, weapon: 'rocket.grenade-launcher' },
    { id: 'a1', x: 12.5, y: 1, z: 58.5, weapon: 'shotgun' },
    { id: 'b1', x: 59.5, y: 1, z: 10.5, weapon: 'shotgun' },
    { id: 'a2', x: 59.5, y: 1, z: 58.5, weapon: 'rifle' },
    { id: 'b2', x: 12.5, y: 1, z: 10.5, weapon: 'rifle' },
    { id: 'a3', x: 36.5, y: 1, z: 48.5, weapon: 'smg' },
    { id: 'b3', x: 35.5, y: 1, z: 20.5, weapon: 'smg' },
  ],
};

export default airbase;
