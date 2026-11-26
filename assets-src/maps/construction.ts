import { METRICS } from '@boboforces/sim';
import type { MapBuilder, MapScript, RampDir, RampFamily } from '../../tools/mapc/src/api.ts';
import { container as kitContainer, towerCrane, type ContainerColor } from './kit.ts';

/**
 * CANTEIRO DE OBRAS (nome provisório "Canteiro", pergunta AK2; M10, fase 2): um prédio de 3 níveis em obra no meio de
 * um canteiro cercado de tapume, de dia. Grade de 80×24×88 m (160×48×176 células), área jogável de 72×80 m (x de 4 a
 * 76, z de 4 a 84), classe média (GDD §4.6.2). Níveis: térreo 1,0 m, 1º andar 4,0 m e 2º andar 7,0 m (andares de 3 m).
 * Maior linha de visão declarada: 50 m (Switch 3–4P, pergunta AK4). Modos: TDM, FFA e Sandbox.
 *
 * ESPELHADO em z (z → 88 − z): o time B nasce no norte e o A no sul, com o mesmo mapa dos dois lados. Cada metade se
 * desenha com o mesmo código (`Kit` com `south`); o que fica em cima do eixo (z = 44) se desenha uma vez só.
 * - BASES (z 4,5–14,5 e o espelho): o pátio de apoio, fechado por uma fileira de contêineres de 2 andares com 3
 *   saídas (oeste x 13–17, meio x 37–43 e leste x 63–67) e dividido em 3 pátios por muros com porta; o anteparo de
 *   2 × 2 contêineres atrás da saída do meio, um contêiner atravessado (2 andares) na frente das saídas dos lados e os
 *   galpões de ferramentas nos cantos (spawns de FFA).
 * - PÁTIOS (z 17–32): os limites das rotas (pilhas de contêineres em x 23–25,5 e 56–58,5, com a passagem de 3 m entre
 *   as rotas em z 23–26), o bloco de 3 × 2 contêineres na frente da saída do meio (z 19,5–27) com 2 pilhas de 2 ao
 *   lado, o pátio de 5 m até a fachada e, nas rotas de fora, a travessa de 2 andares em z 28,5–31 com a abertura de
 *   frente para o escritório/almoxarifado.
 * - SEM POLEIRO SÓ DE HUMANO: todo teto que ninguém alcança pela navegação fica a mais de 3,7 m no plano de qualquer
 *   piso alcançável que esteja a menos de 0,5 m abaixo dele (pulo correndo) e a mais de 1,2 m dos que estão a menos de
 *   1,5 m abaixo (mantle). Por isso o bloco da frente fica a 5 m do prédio, o 2º assoalho do andaime leste começa a
 *   4,5 m do contêiner do limite da rota, a escada do 2º assoalho fica dentro do andaime (o almoxarifado a 5 m) e as
 *   travessas e as fôrmas de pilar são altas.
 * - O PRÉDIO (x 28–52, z 32–56): térreo de salas e corredores em zigue-zague em volta do núcleo do elevador (x 38–42,
 *   z 42–46, até 11 m: quebra as vistas de norte a sul e de leste a oeste); 1º andar inteiro, meio construído
 *   (parapeitos de 1 m e paredes inteiras só em alguns trechos); 2º andar só no terço leste (x 42–52), com os tocos de
 *   pilar e os ferros de espera.
 * - ANDAIMES: o oeste (x 25–28) até o 1º andar e o leste (x 52–56,5) até o 2º; embaixo do assoalho, uma passagem
 *   coberta ao longo da fachada.
 * - ESCADAS em L ou em U, com lances de 1,5 m e patamar: ao 1º andar, 2 nas pontas de cada andaime e 2 dentro; ao 2º
 *   andar, 2 dentro (debaixo da laje) e a do andaime leste (em U, no eixo).
 * - As 3 ROTAS (GDD §4.6.3): OESTE pelo pátio de materiais, com o escritório de contêineres de 2 andares no meio
 *   (x 11–18,5, z 38–50); MEIO pelo prédio; LESTE pelo pátio do guindaste, com o almoxarifado de contêineres no meio
 *   (x 61–68,5, z 38–50) e o guindaste de torre (mastro em x 71,5–72,5, z 43,5–44,5) com a lança sobre o prédio e o
 *   caixote pendurado (a assinatura do mapa, arte-ux.md §5.3).
 * - Cobertura a cada 8–12 m: paletes de sacos de cimento (1 m), pilhas de vigas (1 m), barreiras zebradas, contêineres
 *   (2,5 e 5 m), fôrmas de pilar de 3,5 m e as paredes do prédio. Medido no `mapc`: maior linha de visão 47,9 m,
 *   travessia TDM de 12,2–13,3 s, cobertura mais longe a 5 m, nenhum aviso.
 * - Sandbox: os times 2 e 3 ganham casa no meio do oeste (x 8, z 44) e do leste (x 72, z 44), ambos no chão livre.
 *
 * Tudo em METROS aqui (múltiplos de 0,5); o builder recebe células. Caixas semiabertas [a, b).
 */

const c = (m: number): number => Math.round(m * 2);
/** Piso do térreo, do 1º e do 2º andar (metros). */
const G = 1;
const L1 = 4;
const L2 = 7;
/** Eixo do espelho: z → 2 × 44 − z. */
const MIRROR_Z2 = 88;
const MIN_X = 4;
const MAX_X = 76;
const MIN_Z = 4;
const MAX_Z = 84;
const EYE = METRICS.eyeHeight;

const CONCRETE: RampFamily = {
  solid: 'concrete',
  ramp: 'concrete-ramp',
  halfLow: 'concrete-ramp-half-low',
  halfHigh: 'concrete-ramp-half-high',
  step: 'concrete-step',
};

/** Yaw (rad) para olhar de (x, z) para (tx, tz): a frente é -Z e o yaw + vira à esquerda. */
function yawTo(x: number, z: number, tx: number, tz: number): number {
  return Math.atan2(-(tx - x), -(tz - z));
}

function pitchTo(x: number, y: number, z: number, tx: number, ty: number, tz: number): number {
  return Math.atan2(ty - y, Math.hypot(tx - x, tz - z));
}

/** Kit em metros sobre o builder de células; na metade sul (`south`), tudo sai espelhado em z. */
class Kit {
  readonly b: MapBuilder;
  readonly south: boolean;
  constructor(b: MapBuilder, south = false) {
    this.b = b;
    this.south = south;
  }

  /** O mesmo kit na outra metade. */
  mirror(): Kit {
    return new Kit(this.b, !this.south);
  }

  /** Ponto z na metade certa. */
  z(v: number): number {
    return this.south ? MIRROR_Z2 - v : v;
  }

  /** Intervalo [z0, z1) na metade certa. */
  zr(z0: number, z1: number): readonly [number, number] {
    return this.south ? [MIRROR_Z2 - z1, MIRROR_Z2 - z0] : [z0, z1];
  }

  /** Direção de subida na metade certa (±z troca no sul). */
  dir(d: RampDir): RampDir {
    if (!this.south) return d;
    return d === '+z' ? '-z' : d === '-z' ? '+z' : d;
  }

  /** Caixa [x0, x1) × [y0, y1) × [z0, z1) em metros. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, block: string | null, rot = 0): void {
    const [a, e] = this.zr(z0, z1);
    this.b.box(c(x0), c(y0), c(a), c(x1) - 1, c(y1) - 1, c(e) - 1, block, rot);
  }

  /** Paredes de 0,5 m no contorno de [x0, x1) × [z0, z1), de y0 a y1. */
  shell(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, block: string): void {
    const [a, e] = this.zr(z0, z1);
    this.b.walls(c(x0), c(y0), c(a), c(x1) - 1, c(y1) - 1, c(e) - 1, block);
  }

  /** Assoalho de laje invertida (a metade de cima da célula) com o piso exatamente em `y`. */
  deck(x0: number, z0: number, x1: number, z1: number, y: number, block: string): void {
    const [a, e] = this.zr(z0, z1);
    const cy = c(y) - 1;
    for (let x = c(x0); x < c(x1); x++) for (let z = c(a); z < c(e); z++) this.b.set(x, cy, z, block, 0, true);
  }

  /**
   * Cerca de poste e travessa numa linha: ao longo de X em [x0, x1) na célula de z0 (z0 = z1), ou ao longo de Z em
   * [z0, z1) na célula de x0 (x0 = x1). Altura em metros.
   */
  fence(x0: number, z0: number, x1: number, z1: number, y: number, block: string, height = 1): void {
    if (z0 === z1) {
      const [a] = this.zr(z0, z0 + 0.5);
      this.b.fence(c(x0), c(y), c(a), c(x1) - 1, c(a), block, c(height));
    } else {
      const [a, e] = this.zr(z0, z1);
      this.b.fence(c(x0), c(y), c(a), c(x0), c(e) - 1, block, c(height));
    }
  }

  stairs(x0: number, z0: number, x1: number, z1: number, y: number, dir: RampDir): void {
    const [a, e] = this.zr(z0, z1);
    this.b.stairs(c(x0), c(y), c(a), c(x1) - 1, c(e) - 1, CONCRETE, this.dir(dir));
  }

  /** Porta de 1,0 × 2,0 m na parede de 0,5 m: (x, z) = canto mínimo da abertura, `along` = eixo da parede. */
  door(x: number, z: number, y: number, along: 'x' | 'z'): void {
    const [a] = along === 'x' ? this.zr(z, z + 0.5) : this.zr(z, z + 1);
    this.b.door(c(x), c(y), c(a), along, 1);
  }

  /** Ferros de espera (cruz) nas células vazias de [x0, x1) × [z0, z1) em cima do piso `y`. */
  rebar(x0: number, z0: number, x1: number, z1: number, y: number): void {
    const [a, e] = this.zr(z0, z1);
    for (let x = c(x0); x < c(x1); x++) for (let z = c(a); z < c(e); z++) this.b.cross(x, c(y), z, 'rebar');
  }

  /** Palete de sacos de cimento (1 m de altura por padrão: a cobertura baixa). */
  bags(x: number, z: number, w: number, d: number, h = 1): void {
    this.bagsAt(G, x, z, w, d, h);
  }

  /** Palete de sacos num andar (`y` = piso). */
  bagsAt(y: number, x: number, z: number, w: number, d: number, h = 1): void {
    this.box(x, y, z, x + w, y + h, z + d, 'cement-bags');
  }

  /** Pilha de vigas I deitadas (1 m), ao longo de X ou de Z. */
  beams(x: number, z: number, w: number, d: number, h = 1, y = G): void {
    this.box(x, y, z, x + w, y + h, z + d, 'steel-beam');
  }

  /** Contêiner do kit (metros), espelhado no sul (as portas de começo e fim trocam em Z). */
  container(x: number, y: number, z: number, along: 'x' | 'z', color: ContainerColor, length = 6): number {
    const width = along === 'x' ? 2.5 : length;
    const [a] = this.zr(z, z + width);
    return kitContainer(this.b, { x, y, z: a, along, color, length });
  }

  prop(model: string, x: number, y: number, z: number, yaw: number): void {
    this.b.prop(model, x, y, this.z(z), this.south ? Math.PI - yaw : yaw, 1, 1);
  }

  spawn(x: number, z: number, team: number, y = G, lookX = 40, lookZ = 44): void {
    const sz = this.z(z);
    this.b.spawn({ x, y, z: sz, yaw: yawTo(x, sz, lookX, lookZ), team });
  }

  camera(name: string, x: number, y: number, z: number, tx: number, ty: number, tz: number): void {
    const sz = this.z(z);
    const tzz = this.z(tz);
    this.b.camera({ name, x, y, z: sz, yaw: yawTo(x, sz, tx, tzz), pitch: pitchTo(x, y, sz, tx, ty, tzz), fovYDeg: 0 });
  }
}

// --- Chão, tapume e borda ---

function ground(k: Kit): void {
  k.box(0, 0, 0, 80, 0.5, 88, 'dirt');
  k.box(0, 0.5, 0, 80, G, 88, 'grass');
  // O canteiro é de brita, com manchas de terra; o prédio e as bases têm piso de concreto.
  k.box(MIN_X, 0.5, MIN_Z, MAX_X, G, MAX_Z, 'gravel');
  const rng = k.b.rng('terra');
  for (let i = 0; i < 70; i++) {
    const x = Math.floor(rng.range(MIN_X + 1, MAX_X - 3));
    const z = Math.floor(rng.range(MIN_Z + 1, MAX_Z - 3));
    const w = 1 + Math.floor(rng.range(0, 3));
    const d = 1 + Math.floor(rng.range(0, 3));
    k.box(x, 0.5, z, x + w, G, z + d, 'dirt');
  }
  k.box(27, 0.5, 31, 53, G, 57, 'concrete');
  for (const h of [k, k.mirror()]) h.box(MIN_X + 0.5, 0.5, MIN_Z + 0.5, MAX_X - 0.5, G, 14.5, 'concrete');
}

/** Tapume de tábuas de 2,5 m com a faixa zebrada em cima (o limite do mundo), em volta da área jogável. */
function hoarding(k: Kit): void {
  const top = G + 2.5;
  const ring: readonly [number, number, number, number][] = [
    [MIN_X, MIN_Z, MAX_X, MIN_Z + 0.5],
    [MIN_X, MAX_Z - 0.5, MAX_X, MAX_Z],
    [MIN_X, MIN_Z, MIN_X + 0.5, MAX_Z],
    [MAX_X - 0.5, MIN_Z, MAX_X, MAX_Z],
  ];
  for (const [x0, z0, x1, z1] of ring) {
    k.box(x0, G, z0, x1, top, z1, 'plank');
    k.box(x0, top, z0, x1, top + 0.5, z1, 'barrier-block');
  }
}

/** Fora do tapume: grama, mato em cruz e árvores (semente do mapa). */
function border(k: Kit): void {
  const b = k.b;
  const rng = b.rng('borda');
  for (let x = 0; x < 160; x++) {
    for (let z = 0; z < 176; z++) {
      const mx = x / 2;
      const mz = z / 2;
      if (mx >= MIN_X - 0.5 && mx < MAX_X + 0.5 && mz >= MIN_Z - 0.5 && mz < MAX_Z + 0.5) continue;
      const r = rng.next();
      if (r < 0.22) b.cross(x, c(G), z, 'tall-grass');
      else if (r < 0.25) b.cross(x, c(G), z, 'bush');
    }
  }
  for (const [x, z] of [
    [1.5, 10],
    [2, 40],
    [1.5, 70],
    [78.5, 18],
    [78, 52],
    [78.5, 80],
    [20, 1.5],
    [58, 2],
    [24, 86.5],
    [62, 86],
  ] as const) {
    b.prop('tree', x, G, z, rng.range(0, Math.PI * 2), 1, 1);
  }
}

// --- As bases (uma metade; o sul é o espelho) ---

/** O pátio de apoio: a fileira de contêineres de 2 andares com 3 saídas, o anteparo e os galpões dos cantos. */
function base(k: Kit): void {
  const z = 14.5;
  const row: readonly [number, number, ContainerColor, ContainerColor][] = [
    [6, 6, 'green', 'tan'],
    [18, 12, 'blue', 'red'],
    [30, 6, 'tan', 'green'],
    [44, 6, 'red', 'blue'],
    [50, 12, 'green', 'tan'],
    [68, 6, 'blue', 'red'],
  ];
  for (const [x, len, low, high] of row) {
    const top = k.container(x, G, z, 'x', low, len);
    k.container(x, top, z, 'x', high, len);
  }
  // As pontas da fileira e as ombreiras das saídas (oeste x 13–17, meio x 37–43, leste x 63–67): blocos de alvenaria
  // da altura dos 2 contêineres.
  for (const [x0, x1] of [
    [MIN_X + 0.5, 6],
    [12, 13],
    [17, 18],
    [36, 37],
    [43, 44],
    [62, 63],
    [67, 68],
    [74, MAX_X - 0.5],
  ] as const) {
    k.box(x0, G, z, x1, G + 5, z + 2.5, 'cinder-block');
  }
  // O anteparo na frente da saída do meio (2 × 2 contêineres): de fora não se vê o fundo da base.
  for (const [z, low, high] of [
    [7, 'tan', 'red'],
    [9.5, 'red', 'blue'],
  ] as const) {
    const top = k.container(37, G, z, 'x', low, 6);
    k.container(37, top, z, 'x', high, 6);
  }
  // Muros de dentro: a base vira 3 pátios (oeste, meio e leste), com as portas na altura do anteparo (as vistas de
  // ponta a ponta da base param nele).
  for (const x of [23.5, 56]) {
    k.box(x, G, MIN_Z + 0.5, x + 0.5, G + 3.5, 14.5, 'cinder-block');
    k.box(x, G, 9.5, x + 0.5, G + 2.5, 11.5, null);
  }
  // Os galpões de ferramentas nos cantos (a porta para o sul, de frente para a fileira).
  for (const [x0, doorX] of [
    [MIN_X + 0.5, 7],
    [69.5, 72],
  ] as const) {
    k.shell(x0, MIN_Z + 0.5, x0 + 6, 10, G, G + 3, 'cinder-block');
    k.box(x0, G + 3, MIN_Z + 0.5, x0 + 6, G + 3.5, 10, 'metal-panel');
    k.door(doorX, 9.5, G, 'x');
  }
  // Coisas do pátio: gerador, barris, holofote, canos e uma lona.
  k.prop('generator', 33.5, G, 6.5, Math.PI / 2);
  k.prop('barrel', 45.5, G, 5.5, 0);
  k.prop('barrel', 46.2, G, 6.3, 0);
  k.prop('floodlight', 13.5, G, 5.5, Math.PI * 0.8);
  k.prop('pipe', 60, G, 5.5, 0);
  k.prop('pipe', 60, G, 6.1, 0);
  k.prop('tarp', 29, G, 6.5, Math.PI / 2);
}

// --- O prédio ---

const BX0 = 28;
const BX1 = 52;
const BZ0 = 32;

/** Metade norte do prédio (z 32–44); o sul é o espelho. */
function buildingHalf(k: Kit): void {
  // Lajes do 1º andar (inteira) e do 2º (só o terço leste).
  k.box(BX0, L1 - 0.5, BZ0, BX1, L1, 44, 'concrete');
  k.box(42, L2 - 0.5, BZ0, BX1, L2, 44, 'concrete');

  // TÉRREO: fachadas de bloco de concreto até a laje.
  const wallTop = L1 - 0.5;
  k.box(BX0, G, BZ0, 37, wallTop, BZ0 + 0.5, 'cinder-block');
  k.box(43, G, BZ0, BX1, wallTop, BZ0 + 0.5, 'cinder-block');
  k.box(BX0, G, BZ0, BX0 + 0.5, wallTop, 44, 'cinder-block');
  k.box(BX1 - 0.5, G, BZ0, BX1, wallTop, 44, 'cinder-block');
  // Janelas (peitoril de 1 m) nas salas da frente; portas de 2 m nas laterais.
  k.box(31, G + 1, BZ0, 33, G + 2.5, BZ0 + 0.5, null);
  k.box(47, G + 1, BZ0, 49, G + 2.5, BZ0 + 0.5, null);
  k.box(BX0, G, 36, BX0 + 0.5, G + 2.5, 38, null);
  k.box(BX1 - 0.5, G, 36, BX1, G + 2.5, 38, null);
  // Salas da frente (noroeste e nordeste): a porta para o saguão e a porta para o corredor desencontradas.
  k.box(35.5, G, BZ0, 36, wallTop, 40, 'cinder-block');
  k.box(BX0, G, 39.5, 36, wallTop, 40, 'cinder-block');
  k.box(35.5, G, 34, 36, G + 2.5, 36, null);
  k.box(29, G, 39.5, 31, G + 2.5, 40, null);
  k.box(44, G, BZ0, 44.5, wallTop, 40, 'cinder-block');
  k.box(44, G, 39.5, BX1, wallTop, 40, 'cinder-block');
  k.box(44, G, 37, 44.5, G + 2.5, 39, null);
  k.box(49, G, 39.5, 51, G + 2.5, 40, null);
  // Pilha de sacos de 2 m no canto de cada sala da frente: da porta lateral não se vê a janela da frente.
  k.bags(BX0 + 0.5, 34, 3, 2, 2);
  k.bags(48.5, 34, 3, 2, 2);

  // Pilares (1 × 1 m) da grade de 8 m, até o 2º andar; os da fachada leste passam da laje e viram tocos de 1 m.
  for (const x of [BX0, 35.5, 43.5, BX1 - 1]) {
    for (const z of [BZ0, 39.5]) {
      const top = x === BX1 - 1 ? L2 + 1 : L2;
      k.box(x, G, z, x + 1, top, z + 1, 'concrete');
      k.rebar(x, z, x + 1, z + 1, top);
    }
  }

  // 1º ANDAR: parapeitos de 1 m nas bordas, com paredes inteiras em alguns trechos (a alvenaria pela metade).
  const p1 = L1 + 1;
  k.box(BX0, L1, BZ0, BX1, p1, BZ0 + 0.5, 'cinder-block');
  k.box(BX0, L1, BZ0, 37, L2, BZ0 + 0.5, 'cinder-block');
  k.box(42, L1, BZ0, BX1, L2 - 0.5, BZ0 + 0.5, 'cinder-block');
  k.box(BX0, L1, BZ0, BX0 + 0.5, p1, 44, 'cinder-block');
  k.box(BX0, L1, 38, BX0 + 0.5, L2, 44, 'cinder-block');
  // A borda leste fica debaixo do 2º andar: parede inteira com a passagem para o andaime e uma janela.
  k.box(BX1 - 0.5, L1, BZ0, BX1, L2 - 0.5, 44, 'cinder-block');
  k.box(BX1 - 0.5, L1, 35, BX1, L1 + 2.5, 37, null);
  k.box(BX1 - 0.5, L1 + 1, 40, BX1, L1 + 2, 42, null);
  // Passagens para o andaime oeste no parapeito.
  k.box(BX0, L1, 35, BX0 + 0.5, p1, 37, null);
  // Cobertura no 1º andar: paletes de sacos de cimento e vigas.
  k.bagsAt(L1, 31.5, 36, 1.5, 1.5);
  k.bagsAt(L1, 38, 34.5, 2, 1);
  k.beams(33, 36.5, 4, 1, 1, L1);

  // 2º ANDAR (x 42–52): parapeitos nas bordas norte e leste e na beira que olha o 1º andar.
  const p2 = L2 + 1;
  k.box(42, L2, BZ0, BX1, p2, BZ0 + 0.5, 'cinder-block');
  k.box(BX1 - 0.5, L2, BZ0, BX1, p2, 44, 'cinder-block');
  k.box(BX1 - 0.5, L2, 38, BX1, p2, 40, null);
  k.box(42, L2, BZ0, 42.5, p2, 42, 'cinder-block');
  k.bagsAt(L2, 48.5, 41, 1.5, 1.5);

  // Escada em L do 1º ao 2º andar (debaixo da laje do 2º): lance que sobe para o norte, patamar a 1,5 m e lance que
  // sobe para leste.
  k.box(44.5, L2 - 0.5, 36, 48, L2, 38, null);
  k.box(44.5, L2 - 0.5, 38, 46.5, L2, 39.5, null);
  k.stairs(44.5, 38, 46.5, 39.5, L1, '-z');
  k.box(44.5, L1, 36, 46.5, L1 + 1.5, 38, 'concrete');
  k.stairs(46.5, 36, 48, 38, L1 + 1.5, '+x');
  k.fence(44.5, 35.5, 48, 35.5, L2, 'railing');
  k.fence(44, 36, 44, 39.5, L2, 'railing');
}

/** O que fica em cima do eixo: o núcleo, as escadas do térreo, os quebra-vistas e a torre de escada do andaime leste. */
function buildingCenter(k: Kit): void {
  // Núcleo do elevador (até 11 m) com a faixa listrada no topo.
  k.box(38, G, 42, 42, 10.5, 46, 'concrete');
  k.box(38, 10.5, 42, 42, 11, 46, 'concrete-stripe');
  // Quebra-vistas do térreo dos dois lados do núcleo (o corredor anda em zigue-zague).
  k.box(34, G, 43.5, 38, L1 - 0.5, 44.5, 'cinder-block');
  k.box(42, G, 43.5, 46, L1 - 0.5, 44.5, 'cinder-block');
  // Escadas em L do térreo ao 1º andar (lances de 1,5 m e patamar; buraco na laje em cima, guarda-corpo em volta).
  // Oeste: sobe para leste e vira para o norte; leste: sobe para oeste e vira para o sul.
  k.box(BX0 + 0.5, L1 - 0.5, 41.5, 32, L1, 45.5, null);
  k.stairs(BX0 + 0.5, 43, 30, 45, G, '+x');
  k.box(30, G, 41.5, 32, G + 1.5, 45, 'concrete');
  k.stairs(30, 41.5, 32, 43, G + 1.5, '-z');
  k.fence(32, 42, 32, 45.5, L1, 'railing');
  k.fence(BX0 + 0.5, 45.5, 32.5, 45.5, L1, 'railing');
  k.box(48, L1 - 0.5, 42.5, BX1 - 0.5, L1, 46.5, null);
  k.stairs(50, 43, BX1 - 0.5, 45, G, '-x');
  k.box(48, G, 43, 50, G + 1.5, 46.5, 'concrete');
  k.stairs(48, 45, 50, 46.5, G + 1.5, '+z');
  k.fence(47.5, 42.5, 47.5, 46, L1, 'railing');
  k.fence(47.5, 42, BX1 - 0.5, 42, L1, 'railing');
  // Escada em U do 1º ao 2º assoalho do andaime leste, no eixo e DENTRO do andaime (x 52–56): lance que sobe para o
  // norte (x 52–54, colado na parede do prédio), patamar de ponta a ponta e lance que sobe para o sul (x 54–56). Nada
  // do andaime fica a menos de 4,5 m do almoxarifado (x 61): de lá não se pula para o teto dele. Os assoalhos do 1º e
  // do 2º se dividem aqui; as metades se ligam pelo prédio.
  k.box(BX1, L2 - 0.5, 42.5, 56.5, L2, 45.5, null);
  k.stairs(BX1, 44, 54, 45.5, L1, '-z');
  k.box(BX1, L1, 42.5, 56, L1 + 1.5, 44, 'concrete');
  k.box(54, L1, 44, 56, L1 + 1.5, 45.5, 'concrete');
  k.stairs(54, 44, 56, 45.5, L1 + 1.5, '+z');
}

/** Andaimes: o oeste até o 1º andar e o leste até o 2º (metade norte; o sul é o espelho). */
function scaffolds(k: Kit): void {
  // Oeste (x 25–28): assoalho no 1º andar, guarda-corpo e montantes na borda de fora.
  k.deck(25, BZ0, BX0, 44, L1, 'plank-slab');
  k.fence(25, BZ0, 25, 44, L1, 'scaffold-rail');
  for (let z = BZ0; z < 44; z += 2) k.fence(25, z, 25, z + 0.5, G, 'scaffold-rail', L1 + 1 - G);
  // O montante da quina é uma coluna de aço (fecha a vista rente à ponta do andaime).
  k.box(25, G, BZ0, 25.5, L1 + 1, BZ0 + 0.5, 'steel-column');
  // Escada em L na ponta: lance que sobe para oeste (x 28–29,5), patamar a 1,5 m e lance que sobe para o sul, para
  // dentro do assoalho. Embaixo do lance de cima, maciço: a passagem coberta fecha na ponta.
  k.box(25.5, L1 - 0.5, BZ0, BX0, L1, 33, null);
  k.stairs(BX0, 30, 29.5, BZ0, G, '-x');
  k.box(25.5, G, 30, BX0, G + 1.5, 33.5, 'concrete');
  k.stairs(25.5, BZ0, BX0, 33.5, G + 1.5, '+z');
  // Leste (x 52–56,5): assoalhos no 1º e no 2º andar e a mesma escada em L na ponta (sobe para leste e vira).
  k.deck(BX1, BZ0, 56.5, 44, L1, 'plank-slab');
  k.deck(BX1, 36.5, 56.5, 44, L2, 'plank-slab');
  k.fence(56, BZ0, 56, 44, L1, 'scaffold-rail');
  k.fence(56, 36.5, 56, 42.5, L2, 'scaffold-rail');
  for (let z = BZ0; z < 44; z += 2) k.fence(56, z, 56, z + 0.5, G, 'scaffold-rail', L2 + 1 - G);
  k.box(56, G, BZ0, 56.5, L2 + 1, BZ0 + 0.5, 'steel-column');
  k.box(BX1, L1 - 0.5, BZ0, 56, L1, 33, null);
  k.stairs(50.5, 30, BX1, BZ0, G, '+x');
  k.box(BX1, G, 30, 56, G + 1.5, 33.5, 'concrete');
  k.stairs(BX1, BZ0, 56, 33.5, G + 1.5, '+z');
  // O 2º assoalho começa 4,5 m depois do contêiner do limite da rota (z 32): dele não se pula para o teto do
  // contêiner. A ponta tem guarda-corpo.
  k.fence(BX1, 36.5, 56.5, 36.5, L2, 'scaffold-rail');
  // Palete de sacos no 1º assoalho, na faixa da parede (x 52–54): cobertura baixa no meio da passarela e, para a rota da
  // IA, a reta da escada da ponta até a escada em U do eixo se quebra aqui (sem isso a rota junta 3 m de subida num
  // trecho só, que o seguidor de hoje larga).
  k.bagsAt(L1, BX1, 38.5, 2, 1);
}

// --- As rotas ---

/** Pátios do norte (oeste, frente do prédio e leste), entre a base e o eixo. */
function yards(k: Kit): void {
  // Os limites das rotas: pilhas de 2 contêineres ao longo de z (oeste x 23–25,5; leste x 56–58,5), da fileira da base
  // até z 23 e de z 26 até o prédio, com a passagem de 3 m entre as rotas no meio (z 23–26). As vistas de leste a
  // oeste pelo pátio param nelas e no contêiner do meio.
  for (const [x, a, b] of [
    [23, 'tan', 'blue'],
    [56, 'blue', 'green'],
  ] as const) {
    for (const z of [17, 26]) {
      const top = k.container(x, G, z, 'z', a, 6);
      k.container(x, top, z, 'z', b, 6);
    }
  }
  // Na frente das saídas oeste e leste da base, um contêiner atravessado: quem sai vira para um lado (de dentro da
  // base não se vê a rota inteira).
  for (const [x, low, high] of [
    [12, 'green', 'red'],
    [62, 'tan', 'green'],
  ] as const) {
    const top = k.container(x, G, 19.5, 'x', low, 6);
    k.container(x, top, 19.5, 'x', high, 6);
  }
  // Frente do prédio: o bloco de 3 contêineres atravessados (2 andares) tapa a saída do meio e as passagens entre as
  // rotas, mais 1 contêiner de cada lado (as diagonais da saída do meio até as passagens); paletes de cobertura baixa.
  // Entre o bloco e o prédio fica o beco de 2,5 m que leva ao saguão.
  for (const [z, low, high] of [
    [19.5, 'tan', 'blue'],
    [22, 'red', 'tan'],
    [24.5, 'green', 'red'],
  ] as const) {
    const top = k.container(37, G, z, 'x', low, 6);
    k.container(37, top, z, 'x', high, 6);
  }
  k.bags(31, 25, 1.5, 1.5);
  k.bags(47.5, 25, 1.5, 1.5);
  k.container(28, G, 18.5, 'x', 'blue', 6);
  k.container(46, G, 18.5, 'x', 'green', 6);
  // E 2 de 2 andares ao lado do bloco, na altura da passagem entre as rotas (a 5 m do prédio e a 3 m das escadas dos
  // andaimes, com o teto 3,5 m acima do patamar: de lá ninguém pula para cima deles).
  for (const [x, low, high] of [
    [28, 'red', 'tan'],
    [46, 'tan', 'green'],
  ] as const) {
    const top = k.container(x, G, 24.5, 'x', low, 6);
    k.container(x, top, 24.5, 'x', high, 6);
  }
  k.fence(33, 30, 36, 30, G, 'barrier-rail');
  k.fence(44, 30, 47, 30, G, 'barrier-rail');

  // Pátio de materiais (oeste). Em z 28,5–31, a travessa de contêineres com a abertura no meio (x 11,5–17, de frente
  // para o escritório): as vistas de norte a sul pelos corredores dos lados do escritório param nela.
  k.box(MIN_X + 0.5, G, 28.5, 5.5, G + 5, 31, 'cinder-block');
  for (const [x, low, high] of [
    [5.5, 'red', 'green'],
    [17, 'tan', 'blue'],
  ] as const) {
    const top = k.container(x, G, 28.5, 'x', low, 6);
    k.container(x, top, 28.5, 'x', high, 6);
  }
  k.beams(6, 24, 6, 1);
  k.bags(7, 34, 1.5, 1.5);
  k.bags(19, 21, 1.5, 1.5);
  k.bags(20, 34.5, 1.5, 1.5);
  k.box(16, G, 25, 17, G + 3.5, 26, 'concrete');
  k.rebar(16, 25, 17, 26, G + 3.5);
  k.box(9, G, 20, 10, G + 3.5, 21, 'concrete');
  k.rebar(9, 20, 10, 21, G + 3.5);
  k.prop('pipe', 6.5, G, 21.5, 0);
  k.prop('pipe', 6.5, G, 22.1, 0);
  k.prop('crate-large', 13.5, G, 34.5, 0);

  // Pátio do guindaste (leste): a mesma travessa (abertura em x 64,5–68,5, de frente para o almoxarifado), vigas,
  // paletes, fôrmas de pilar, gerador e barris.
  for (const [x, low, high] of [
    [58.5, 'blue', 'tan'],
    [68.5, 'green', 'red'],
  ] as const) {
    const top = k.container(x, G, 28.5, 'x', low, 6);
    k.container(x, top, 28.5, 'x', high, 6);
  }
  k.box(74.5, G, 28.5, MAX_X - 0.5, G + 5, 31, 'cinder-block');
  k.beams(68, 24, 6, 1);
  k.bags(72, 34, 1.5, 1.5);
  k.bags(60, 24, 1.5, 1.5);
  k.bags(59, 34.5, 1.5, 1.5);
  k.box(63, G, 25, 64, G + 3.5, 26, 'concrete');
  k.rebar(63, 25, 64, 26, G + 3.5);
  k.box(70, G, 20, 71, G + 3.5, 21, 'concrete');
  k.rebar(70, 20, 71, 21, G + 3.5);
  k.prop('generator', 66.5, G, 25.5, Math.PI / 2);
  k.prop('barrel', 73.5, G, 21.5, 0);
  k.prop('barrel', 74.2, G, 22.2, 0);
}

/** O que fica em cima do eixo nas rotas de fora: o escritório, o almoxarifado e o guindaste. */
function lanesCenter(k: Kit): void {
  // Escritório da obra (oeste): 3 contêineres de 12 m ao longo de z, 2 andares.
  const office: readonly [number, ContainerColor, ContainerColor][] = [
    [11, 'blue', 'tan'],
    [13.5, 'tan', 'green'],
    [16, 'green', 'blue'],
  ];
  for (const [x, low, high] of office) {
    const top = k.container(x, G, 38, 'z', low, 12);
    k.container(x, top, 38, 'z', high, 12);
  }
  // Almoxarifado (leste): o mesmo, com outras cores.
  const store: readonly [number, ContainerColor, ContainerColor][] = [
    [61, 'red', 'green'],
    [63.5, 'green', 'red'],
    [66, 'tan', 'blue'],
  ];
  for (const [x, low, high] of store) {
    const top = k.container(x, G, 38, 'z', low, 12);
    k.container(x, top, 38, 'z', high, 12);
  }
  // O guindaste de torre: a lança aponta para o oeste, por cima do prédio, com o caixote pendurado.
  k.box(70.5, 0.5, 42.5, 73.5, G, 45.5, 'concrete');
  towerCrane(k.b, { x: 71.5, y: G, z: 43.5, height: 15, dir: '-x', jib: 26, counterJib: 6, hook: { at: 20, drop: 3 } });
}

// --- Marcadores ---

function spawns(k: Kit): void {
  // TDM: o time B (1) no norte, o A (0) no sul, no fundo da base (os dos pátios de fora longe das saídas dos lados: a
  // travessia mais curta, pela rota oeste, fica em 12 s).
  const team = k.south ? 0 : 1;
  for (const [x, z] of [
    [16.5, 5.5],
    [21.5, 6.5],
    [28.5, 7.5],
    [51.5, 7.5],
    [58.5, 7.5],
    [63.5, 5.5],
  ] as const) {
    k.spawn(x, z, team);
  }
  // FFA (-1): 8 por metade, um por canto escondido.
  const ffa: readonly (readonly [number, number, number?])[] = [
    [7.5, 7.5],
    [72.5, 7.5],
    [40.5, 5.5],
    [33.5, 34.5],
    [46.5, 34.5],
    [23.5, 24.5],
    [66.5, 24.5],
    [60.5, 6.5],
  ];
  for (const [x, z, y] of ffa) k.spawn(x, z, -1, y ?? G);
}

/** Câmeras dos prints (a vista geral do alto, o prédio do pátio de materiais, o andaime leste e o guindaste). */
function cameras(k: Kit): void {
  k.camera('print:construction', 74, 24, 86, 40, 3, 42);
  k.camera('print:obra', 14, G + 4, 61.5, 38, L1, 46);
  k.camera('print:andaime', 60, G + 2, 53, 53, L1 + 1, 41);
  k.camera('print:guindaste', 60, G + EYE, 66, 70, 12, 44);
}

const construction: MapScript = {
  id: 'construction',
  // TODO (M10, fase 1c): do 2º andar do prédio e dos andaimes, pulos correndo de 4–6 m levam aos topos de 6 m (o núcleo,
  // os quebra-vistas e as fileiras de contêineres das bases) e, encadeados, ao mapa todo por cima; a maior linha de
  // visão de lá dá 85 m (o teto do Switch é 50 m). Fechar muda o mapa e os goldens: decisão do Erick.
  analysis: { jumpSightTodo: 'topos de 6 m (contêineres das bases) pelos pulos do prédio e dos andaimes (85 m)' },
  build(b) {
    b.size(160, 48, 176);
    b.meta({
      nameKey: 'map.construction.name',
      modes: ['warfare.tdm', 'warfare.ffa', 'sandbox'],
      players: { min: 2, ideal: 12, max: 16 },
      maxSightLineM: 50,
      botCaps: { switch34p: 12 },
    });
    b.playArea(MIN_X, MIN_Z, MAX_X, MAX_Z, G - 10);
    b.sun(-0.4, 0.8, -0.35, 'day');
    const north = new Kit(b);
    ground(north);
    border(north);
    hoarding(north);
    for (const k of [north, north.mirror()]) {
      base(k);
      yards(k);
      buildingHalf(k);
      scaffolds(k);
    }
    buildingCenter(north);
    lanesCenter(north);
    for (const k of [north, north.mirror()]) spawns(k);
    cameras(north);
  },
};

export default construction;
