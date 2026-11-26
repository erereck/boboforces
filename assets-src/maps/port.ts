import { METRICS } from '@boboforces/sim';
import type { MapBuilder, MapScript, RampDir, RampFamily } from '../../tools/mapc/src/api.ts';
import { container, harborWater, towerCrane, type ContainerColor } from './kit.ts';

/**
 * PORTO DE CONTÊINERES (nome provisório "Porto", pergunta AK2; M10, fase 1): o terminal de contêineres (GDD §4.6.4:
 * verticalidade e corredores), de dia. Grade de 96 × 28 × 96 m (192 × 56 × 192 células), área jogável de 88 × 74 m
 * (x de 4 a 92, z de 14,5 a 86), 3 níveis (o chão do cais a 4,5 m, o topo do contêiner a 7 m e o piso do mezanino
 * do armazém a 7,25 m), maior linha de visão declarada de 50 m (Switch 3–4P, pergunta AK4).
 *
 * ESPELHADO em X = 48 (o time A nasce no oeste, o B no leste; tudo de um lado tem o par do outro, com as cores dos
 * contêineres trocadas para o mapa não ficar repetido). As 3 rotas de oeste a leste:
 * - NORTE, o CAIS (z 14..30): o chão de concreto com a faixa pintada, a mureta zebrada na beira, os cabeços de
 *   amarração e a água (o `harborWater` do kit, sem natação: o plano de morte fica entre a água e o fundo, e da beira
 *   até o fundo são 4 m, mais que a queda da navegação, então os bots nunca descem). As pilhas Q1 (de cada lado) e as
 *   do meio (Q2 na beira e CN no pátio) fazem o zigue-zague: o cais passa pelo canal do ponto A, entre elas.
 * - MEIO, o PÁTIO DE CONTÊINERES (z 30..61): pilhas de 2 de altura (5 m) por fora e de 1 (2,5 m) por dentro, com os
 *   corredores entre elas; os topos de 1 de altura formam a TRILHA DE CIMA (escadas nas pontas e passarelas de grade
 *   por cima dos corredores). No meio, a PRAÇA do guindaste de torre (o marco do mapa, de longe) e a plataforma do ponto
 *   B (em cima dos contêineres, com escada dos dois lados e do sul).
 * - SUL, a RUA e o ARMAZÉM (z 61..86): a rua com os caminhões parados, o pátio de carga e o armazém (portão de carga
 *   no norte, porta do lado embaixo do mezanino de grade de cada ponta) com o ponto C no meio. O bloco CS fecha a rua
 *   no meio: a rota sul atravessa por dentro do armazém.
 * Os spawns de time ficam nos pátios dos portões (oeste e leste), fechados por pilhas; os de FFA (10 de cada lado), em
 * cantos sem vista um do outro.
 *
 * A maior linha de visão (49,65 m medidos) vale também de cima: as pilhas de fora são de 2 (5 m) e os caixotes da
 * trilha, de 2 m, para quem está em cima de um contêiner não ver por cima delas de ponta a ponta.
 *
 * Tudo em METROS aqui (múltiplos de 0,5); o builder recebe células. Caixas semiabertas [a, b).
 */

const c = (m: number): number => Math.round(m * 2);
const SIZE = 96;
/** O eixo do espelho. */
const MID = SIZE / 2;
/** O chão do cais e do pátio (m): a água e o fundo ficam embaixo, na faixa norte (o kit pede 4,5 m ou mais). */
const G = 4.5;
/** O topo de um contêiner (m): a trilha de cima e a plataforma do ponto B. */
const H1 = G + 2.5;
/** A beira do cais (z, m): ao norte dela, a água. */
const QUAY = 14;
/**
 * O topo da escada do mezanino do armazém (m). A grade (`grate-slab`) é a meia laje de baixo: o piso do mezanino fica
 * 0,25 m abaixo (7,25 m), como o das passarelas fica 0,25 m abaixo do topo dos contêineres (6,75 m).
 */
const LOFT = G + 3;
const LOFT_FLOOR = LOFT - 0.25;
/**
 * Área jogável. O norte para na face de dentro da mureta da beira (14,5): a mureta tem 0,5 m, a altura do degrau
 * automático, e sem a parede invisível dava para cair no mar andando. O plano de morte (do `harborWater`, entre a água e
 * o fundo) fica de reserva.
 */
const AREA = { minX: 4, maxX: 92, minZ: 14.5, maxZ: 86 } as const;
const EYE = METRICS.eyeHeight;
const PI = Math.PI;

const CONCRETE: RampFamily = {
  solid: 'concrete',
  ramp: 'concrete-ramp',
  halfLow: 'concrete-ramp-half-low',
  halfHigh: 'concrete-ramp-half-high',
  step: 'concrete-step',
};

/** Os pontos de Domination (os pés, em metros): A no cais, B em cima da plataforma da praça, C no armazém. */
export const PORT_POINTS = {
  a: { x: MID, y: G, z: 22.25, radius: 3 },
  b: { x: MID, y: H1, z: 47, radius: 2.5 },
  c: { x: MID, y: G, z: 76, radius: 3 },
} as const;

export const PORT_AREA = AREA;
export const PORT_FLOOR = G;

/** No lado espelhado, cada cor de contêiner vira outra (o par do outro lado não fica idêntico). */
const MIRROR_COLOR: Readonly<Record<ContainerColor, ContainerColor>> = {
  red: 'blue',
  blue: 'green',
  green: 'tan',
  tan: 'red',
};

/** Yaw (rad) para olhar de (x, z) para (tx, tz): a frente é -Z e o yaw + vira à esquerda. */
function yawTo(x: number, z: number, tx: number, tz: number): number {
  return Math.atan2(-(tx - x), -(tz - z));
}

function pitchTo(x: number, y: number, z: number, tx: number, ty: number, tz: number): number {
  return Math.atan2(ty - y, Math.hypot(tx - x, tz - z));
}

/**
 * Kit em metros sobre o builder de células, de um LADO do mapa: no lado leste (`mirror`) o x vira 96 − x (as caixas
 * trocam as pontas), a escada que sobe para +X sobe para −X, o yaw troca de sinal e a porta do contêiner troca de ponta.
 */
class Side {
  readonly b: MapBuilder;
  readonly mirror: boolean;
  /** Time dos spawns deste lado (o A no oeste). */
  readonly team: number;
  constructor(b: MapBuilder, mirror: boolean) {
    this.b = b;
    this.mirror = mirror;
    this.team = mirror ? 1 : 0;
  }

  x(v: number): number {
    return this.mirror ? SIZE - v : v;
  }

  /** [x0, x1) espelhado. */
  span(x0: number, x1: number): [number, number] {
    return this.mirror ? [SIZE - x1, SIZE - x0] : [x0, x1];
  }

  /** Caixa [x0, x1) × [y0, y1) × [z0, z1) em metros. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, block: string | null, rot = 0): void {
    const [a, e] = this.span(x0, x1);
    this.b.box(c(a), c(y0), c(z0), c(e) - 1, c(y1) - 1, c(z1) - 1, block, rot);
  }

  dir(d: RampDir): RampDir {
    if (!this.mirror) return d;
    return d === '+x' ? '-x' : d === '-x' ? '+x' : d;
  }

  stairs(x0: number, z0: number, x1: number, z1: number, y: number, dir: RampDir): void {
    const [a, e] = this.span(x0, x1);
    this.b.stairs(c(a), c(y), c(z0), c(e) - 1, c(z1) - 1, CONCRETE, this.dir(dir));
  }

  color(col: ContainerColor): ContainerColor {
    return this.mirror ? MIRROR_COLOR[col] : col;
  }

  /** Contêiner de 6 m (ou `length`) com o canto mínimo em (x, y, z); devolve o topo. */
  container(
    x: number,
    y: number,
    z: number,
    along: 'x' | 'z',
    color: ContainerColor,
    doors: 'both' | 'start' | 'end' | 'none' = 'both',
    length = 6,
  ): number {
    const sx = along === 'x' ? length : 2.5;
    const [a] = this.span(x, x + sx);
    const flip = this.mirror && along === 'x';
    const d = flip && doors === 'start' ? 'end' : flip && doors === 'end' ? 'start' : doors;
    return container(this.b, { x: a, y, z, along, color: this.color(color), doors: d, length });
  }

  /** Pilha de contêineres no chão (uma cor por andar, de baixo para cima); devolve o topo. */
  stack(x: number, z: number, along: 'x' | 'z', colors: readonly ContainerColor[], length = 6): number {
    let y = G;
    for (const col of colors) y = this.container(x, y, z, along, col, 'both', length);
    return y;
  }

  /**
   * Passarela de grade na célula logo abaixo de `y` (a meia laje de baixo: o piso fica 0,25 m abaixo de `y`) com
   * corrimão nos lados ao longo de `along`.
   */
  catwalk(x0: number, z0: number, x1: number, z1: number, y: number, along: 'x' | 'z'): void {
    this.box(x0, y - 0.5, z0, x1, y, z1, 'grate-slab');
    if (along === 'z') {
      this.fence(x0, z0, x0, z1 - 0.5, y);
      this.fence(x1 - 0.5, z0, x1 - 0.5, z1 - 0.5, y);
    } else {
      this.fence(x0, z0, x1 - 0.5, z0, y);
      this.fence(x0, z1 - 0.5, x1 - 0.5, z1 - 0.5, y);
    }
  }

  /** Corrimão numa linha (metros): (x0, z0) e (x1, z1) são cantos mínimos de célula, a linha inclui as duas pontas. */
  fence(x0: number, z0: number, x1: number, z1: number, y: number, block = 'railing', height = 1): void {
    const [a, e] = this.span(x0, x1 + 0.5);
    const ax = c(a);
    const bx = c(e) - 1;
    this.b.fence(ax, c(y), c(z0), x0 === x1 ? ax : bx, c(z1), block, c(height));
  }

  prop(model: string, x: number, y: number, z: number, yaw: number, scale = 1, dose: 0 | 1 | 2 = 1): void {
    this.b.prop(model, this.x(x), y, z, this.mirror ? -yaw : yaw, scale, dose);
  }

  spawn(x: number, z: number, team: number, y = G, lookX = MID, lookZ = 47): void {
    const sx = this.x(x);
    this.b.spawn({ x: sx, y, z, yaw: yawTo(sx, z, this.x(lookX), lookZ), team });
  }
}

// --- Chão, água e borda ---

/** O chão, a água e as faixas pintadas; devolve a altura do plano de morte (a do mar do kit). */
function ground(b: MapBuilder): number {
  const k = new Side(b, false);
  // O mar ao norte da beira: a laje de água 0,75 m abaixo do cais e o fundo escuro bem embaixo (sem queda de
  // navegação até ele).
  const kill = harborWater(b, { x0: 0, z0: 0, x1: SIZE, z1: QUAY, dock: G, surface: G - 0.5 });
  // O aterro do cais e do pátio; o piso do cais é de concreto e o do pátio, de asfalto.
  k.box(0, 0, QUAY, SIZE, G - 0.5, SIZE, 'concrete');
  k.box(0, G - 0.5, QUAY, SIZE, G, 27, 'concrete');
  k.box(0, G - 0.5, 27, SIZE, G, SIZE, 'asphalt');
  // A mureta zebrada de 0,5 m na beira (fora da área jogável: a parede invisível fica na face de dentro dela).
  k.box(0, G, QUAY, SIZE, G + 0.5, QUAY + 0.5, 'hazard-block');
  // A faixa de segurança pintada no cais, a 3 m da beira.
  k.box(AREA.minX, G - 0.5, 17, AREA.maxX, G, 17.5, 'concrete-stripe');
  // A faixa do meio da rua, tracejada (2 m pintados a cada 4 m).
  for (let x = 6; x < 90; x += 4) k.box(x, G - 0.5, 64, x + 2, G, 64.5, 'asphalt-line');
  return kill;
}

/** As pontas da área jogável: barreira zebrada no cais e a cerca de tela no pátio (o limite marcado, GDD §8.3). */
function perimeter(k: Side): void {
  const b = k.b;
  // No cais, a barreira zebrada de 1 m na linha do limite (o cais continua lá fora, só de enfeite).
  k.box(AREA.minX - 0.5, G, QUAY + 0.5, AREA.minX, G + 1, 30, 'hazard-block');
  // No pátio, a cerca de tela de 2,5 m (oeste, de z 30 até o fundo; e o fundo até o armazém).
  const [x0] = k.span(AREA.minX - 0.5, AREA.minX);
  b.panel(c(x0), c(G), c(30), c(x0), c(G + 2.5) - 1, c(AREA.maxZ) - 1, 'fence-wire');
  const [s0, s1] = k.span(AREA.minX - 0.5, 30);
  b.panel(c(s0), c(G), c(AREA.maxZ), c(s1) - 1, c(G + 2.5) - 1, c(AREA.maxZ), 'fence-wire');
}

/** Fora da área: pilhas altas de contêineres (o horizonte de pátio), atrás da cerca do sul e da do lado. */
function backdrop(k: Side): void {
  // Atrás da cerca do sul, as pilhas de 3 e 4 (fecham o fundo dos quadros do pátio de carga).
  k.stack(2, 87.5, 'x', ['blue', 'red', 'tan']);
  k.stack(8, 87.5, 'x', ['green', 'blue', 'red', 'green']);
  k.stack(14, 87.5, 'x', ['tan', 'green', 'blue']);
  k.stack(20, 87.5, 'x', ['red', 'tan', 'green', 'blue']);
  k.stack(2, 90.5, 'x', ['red', 'green', 'tan', 'blue']);
  k.stack(14, 90.5, 'x', ['blue', 'tan', 'red']);
  // A oeste, colado na cerca: uma fileira de contêineres em Z (3 de altura).
  for (const [z, cols] of [
    [31, ['tan', 'red', 'blue']],
    [43, ['green', 'blue', 'tan']],
    [55, ['red', 'tan', 'green']],
    [67, ['blue', 'green', 'red']],
    [79, ['tan', 'blue', 'green']],
  ] as const) {
    k.stack(0.5, z, 'z', cols);
  }
}

/** O navio atracado (fora da área, só a silhueta): casco, contêineres no convés e a ponte na popa. */
function ship(b: MapBuilder): void {
  const k = new Side(b, false);
  const [x0, x1, z0, z1] = [10, 86, 3, 11];
  const deck = G + 3;
  // Casco de chapa (o vermelho de zarcão embaixo, a faixa de chapa em cima) e a proa afinando a oeste.
  k.box(x0 + 4, 0.5, z0, x1, deck - 1, z1, 'steel-beam');
  k.box(x0 + 4, deck - 1, z0, x1, deck, z1, 'metal-panel');
  const bow = [1.5, 2, 3, 3.5];
  bow.forEach((half, i) => {
    k.box(x0 + i, 0.5, 7 - half, x0 + i + 1, deck - 1, 7 + half, 'steel-beam');
    k.box(x0 + i, deck - 1, 7 - half, x0 + i + 1, deck, 7 + half, 'metal-panel');
  });
  // Contêineres no convés (em Z, de 2 e 3 de altura) e a ponte de comando na popa (leste).
  const colors: readonly ContainerColor[] = ['red', 'blue', 'tan', 'green'];
  let i = 0;
  for (let x = x0 + 6; x < x1 - 14; x += 2.5) {
    const height = 2 + ((i * 7) % 3 === 0 ? 1 : 0);
    let y = deck;
    for (let h = 0; h < height; h++) {
      y = container(b, { x, y, z: z0 + 1, along: 'z', color: colors[(i + h) % 4]!, doors: 'start' });
    }
    i++;
  }
  k.box(x1 - 10, deck, z0 + 0.5, x1 - 2, deck + 8, z1 - 0.5, 'concrete');
  k.box(x1 - 10, deck + 6, z0 + 0.5, x1 - 2, deck + 7, z0 + 1, 'glass');
  k.box(x1 - 10, deck + 6, z1 - 1, x1 - 2, deck + 7, z1 - 0.5, 'glass');
  k.box(x1 - 6, deck + 8, z0 + 3, x1 - 4, deck + 11, z0 + 5, 'steel-beam');
}

// --- O cais (rota norte) ---

function quay(k: Side): void {
  // Cabeços de amarração na beira, a cada 8 m.
  for (const x of [9, 17, 25, 33, 41]) k.prop('bollard', x, G, QUAY + 0.75, 0, 1, 1);
  // Q1: o paredão de pilhas que corta o cais da faixa da beira (3 m, colada na água) até o pátio: do portão para o meio
  // do cais, só pela beira (ou pelo pátio, pelo corredor norte).
  const q1: ContainerColor[][] = [
    ['blue', 'tan'],
    ['red', 'green', 'blue'],
    ['tan', 'red'],
    ['green', 'blue'],
    ['red', 'tan', 'green'],
  ];
  q1.forEach((cols, i) => k.stack(23, 17.5 + i * 2.5, 'x', cols));
  // O trecho do portão (x 4..23): caixotes, barris e o holofote.
  k.box(12, G, 20.5, 14, G + 1, 21.5, 'crate');
  k.box(16, G, 26, 17.5, G + 2, 27.5, 'crate');
  k.prop('barrel', 6, G, 25.5, 0, 1, 1);
  k.prop('barrel', 6.8, G, 26.1, 0.7, 1, 2);
  k.prop('floodlight', 5, G, 27.5, yawTo(5, 27.5, 20, 18), 1, 1);
  // O trecho do meio (x 29..45): a pilha em Z colada na beira (esperando o embarque; quem vem pela beira contorna por
  // dentro), caixotes baixos (1 m) e altos (2 m), barris e canos, a cada 8–10 m.
  k.container(34.5, G, 14.5, 'z', 'tan', 'end');
  k.container(34.5, H1, 14.5, 'z', 'green', 'end');
  k.box(31, G, 20.5, 32, G + 1, 22, 'crate');
  k.box(38, G, 22, 40, G + 1, 23, 'crate');
  k.box(41, G, 27.5, 42.5, G + 2, 29, 'crate');
  k.prop('barrel', 30.5, G, 26, 0, 1, 1);
  k.prop('barrel', 31.3, G, 26.6, 0.7, 1, 2);
  k.prop('pipe', 34.5, G, 26.5, PI / 2, 1, 1);
  k.prop('pipe', 35.2, G, 26.5, PI / 2, 1, 2);
}

// --- O meio (feito uma vez: é simétrico em si) ---

function center(b: MapBuilder): void {
  const k = new Side(b, false);
  // Q2: na beira, no meio do cais (de 2 de altura). O ponto A fica no canal entre ela e a CN.
  k.stack(45, 14.5, 'x', ['tan', 'red']);
  k.stack(45, 17, 'x', ['blue', 'green']);
  // CN: o bloco do meio entre o cais e a praça (5 fileiras de 6 m em X, de 2 e 3 de altura).
  const cn: ContainerColor[][] = [
    ['red', 'green'],
    ['green', 'tan', 'red'],
    ['blue', 'red'],
    ['tan', 'blue', 'green'],
    ['red', 'tan'],
  ];
  cn.forEach((cols, i) => k.stack(45, 25 + i * 2.5, 'x', cols));
  // A base do guindaste (o bloco de concreto de 3,5 m na praça) e o guindaste de torre, com a lança para o norte e
  // o caixote pendurado em cima do ponto A.
  k.box(46.5, G, 37.5, 49.5, G + 3.5, 40.5, 'concrete');
  towerCrane(b, {
    x: 47.5,
    y: G + 3.5,
    z: 39,
    height: 14.5,
    dir: '-z',
    jib: 26,
    counterJib: 7,
    hook: { at: 16.5, drop: 8 },
  });
  // CB: a plataforma do ponto B (2 fileiras de 1 de altura) com o paredão de 2 no norte.
  k.stack(45, 42, 'x', ['tan', 'red']);
  k.container(45, G, 44.5, 'x', 'blue');
  k.container(45, G, 47, 'x', 'green');
  // Em cima: caixotes baixos nos cantos do sul (cobertura de quem segura o ponto).
  k.box(45.5, H1, 48.5, 46.5, H1 + 1, 49.5, 'crate');
  k.box(49.5, H1, 48.5, 50.5, H1 + 1, 49.5, 'crate');
  // A escada do sul (2 m, no meio) até a plataforma.
  k.stairs(47, 49.5, 49, 52, G, '-z');
  // CS: o bloco do sul da praça, que atravessa a rua até a frente do armazém (a rota sul passa por dentro dele).
  const cs: ContainerColor[][] = [
    ['green', 'blue'],
    ['red', 'tan', 'blue'],
    ['tan', 'green'],
    ['blue', 'red'],
    ['red', 'green'],
    ['green', 'tan'],
  ];
  // Todas de 2 ou mais: de cima de uma de 1 o bobo veria a rua de ponta a ponta (e pularia de caminhão em caminhão).
  cs.forEach((cols, i) => k.stack(45, 53 + i * 2.5, 'x', cols));
}

// --- O pátio de contêineres (rota do meio), de um lado ---

function yard(k: Side): void {
  // As 4 fileiras de pilhas: o lado de fora (x 19..25) de 2 de altura, o de dentro (x 25..31) de 1 (a trilha de cima).
  const rows: [number, ContainerColor[], ContainerColor[]][] = [
    [30, ['green', 'red'], ['blue']],
    [32.5, ['tan', 'blue'], ['red']],
    [37.5, ['red', 'tan'], ['tan']],
    [40, ['blue', 'red'], ['green']],
    [48.5, ['blue', 'green'], ['green']],
    [51, ['red', 'tan'], ['tan']],
    [55.5, ['tan', 'green'], ['red']],
    [58, ['green', 'blue'], ['blue']],
  ];
  for (const [z, outer, inner] of rows) {
    k.stack(19, z, 'x', outer);
    k.stack(25, z, 'x', inner);
  }
  // A trilha de cima: escadas nas pontas (do pátio norte e do pátio sul) e passarelas por cima dos corredores.
  k.stairs(31, 32.5, 33.5, 35, G, '-x');
  k.stairs(31, 55.5, 33.5, 58, G, '-x');
  k.catwalk(27, 35, 30, 37.5, H1, 'z');
  k.catwalk(27, 42.5, 30, 48.5, H1, 'z');
  k.catwalk(27, 53.5, 30, 55.5, H1, 'z');
  // Caixotes altos em cima (2 m: cobertura de quem anda na trilha, e ninguém sobe neles para ver por cima das pilhas).
  // Em zigue-zague (um lado, o outro): a vista de ponta a ponta da trilha para neles.
  k.box(27, H1, 31.5, 31, H1 + 2, 32.5, 'crate');
  k.box(25, H1, 39, 27, H1 + 2, 40, 'crate');
  k.box(27, H1, 50, 31, H1 + 2, 51, 'crate');
  k.box(25, H1, 58, 27, H1 + 2, 59, 'crate');
  // A boca do corredor central: o TAMPÃO (3 fileiras de 2 de altura) com o túnel no meio (o contêiner de baixo sem as
  // portas). O corredor não fica alinhado com a praça: contorna o tampão pelo norte ou pelo sul, ou passa pelo túnel.
  k.stack(33, 42, 'x', ['red', 'green']);
  k.container(33, G, 44.5, 'x', 'tan', 'none');
  k.box(33, G, 45, 39, G + 2, 46.5, null);
  k.container(33, H1, 44.5, 'x', 'blue');
  k.stack(33, 47, 'x', ['green', 'red']);
  // O pátio norte e o pátio sul: uma pilha de 2 em pé (em Z) em cada, que corta as diagonais de quem está na trilha
  // de cima, e caixotes.
  k.stack(39.5, 32, 'z', ['green', 'red']);
  k.stack(39.5, 51.5, 'z', ['blue', 'tan']);
  // A 5 m da trilha (x 31): perto dela, o caixote alto virava poleiro de quem pula de cima do contêiner.
  k.box(36, G, 38, 37.5, G + 2, 39.5, 'crate');
  k.box(37.5, G, 40, 38.5, G + 1, 41, 'crate');
  k.box(35, G, 51, 36.5, G + 1, 52, 'crate');
  k.box(35, G, 34, 37, G + 1, 35, 'crate');
  k.box(35, G, 58.5, 36.5, G + 1, 60, 'crate');
  k.prop('barrel', 33.5, G, 53.5, 0.2, 1, 1);
  k.prop('barrel', 34.3, G, 54.1, 1.1, 1, 2);
  // A faixa do corredor central (do portão até a praça).
  for (let x = 18; x < 32; x += 4) k.box(x, G - 0.5, 45.5, x + 2, G, 46, 'asphalt-line');
  // A escada oeste da plataforma do ponto B.
  k.stairs(42.5, 45.5, 45, 48, G, '+x');
}

// --- O portão (spawn do time) ---

function gate(k: Side): void {
  // A guarita (5,5 × 5 m, porta para o pátio do portão; fechada para o pátio de contêineres).
  k.box(11, G, 44, 16.5, G + 3, 49, 'cinder-block');
  k.box(11.5, G, 44.5, 16, G + 2.5, 48.5, null);
  k.box(10.5, G + 3, 43.5, 17, G + 3.5, 49.5, 'metal-panel');
  const [dx] = k.span(11, 11.5);
  k.b.door(c(dx), c(G), c(46), 'z', 1);
  k.box(14, G + 2, 46, 15, G + 2.5, 47, 'lamp');
  // O pátio do portão é fechado por pilhas de 2 no norte (a saída para o cais é o beco de 3 m junto do pátio de
  // contêineres) e no sul (a saída para a rua fica na cerca); o lado leste dá para a rua do portão (x 16..19), de onde
  // saem os 3 corredores do pátio.
  k.stack(4, 28.5, 'x', ['tan', 'blue']);
  k.stack(10, 28.5, 'x', ['red', 'green']);
  k.stack(8, 60.5, 'x', ['green', 'tan']);
  k.stack(14, 60.5, 'x', ['blue', 'red']);
  k.box(16, G, 36, 17, G + 1, 38, 'hazard-block');
  k.box(16, G, 54, 17, G + 1, 56, 'hazard-block');
  k.prop('floodlight', 5, G, 57.5, yawTo(5, 57.5, 12, 46), 1, 1);
  k.prop('floodlight', 5, G, 31.5, yawTo(5, 31.5, 12, 46), 1, 1);
  // Os spawns do time: no pátio do portão, atrás da guarita.
  for (const [x, z] of [
    [5.5, 40.5],
    [5.5, 44.5],
    [5.5, 48.5],
    [5.5, 52.5],
    [8.5, 42.5],
    [8.5, 46.5],
    [8.5, 50.5],
    [7, 56],
  ] as const) {
    k.spawn(x, z, k.team);
  }
}

// --- A rua e o pátio de carga (rota sul) ---

function south(k: Side): void {
  // Os caminhões parados na rua (cortam as vistas de norte a sul, do cais até a rua): um na frente do portão de carga do
  // armazém e um na saída do pátio sul. Todos de 2 contêineres (revisão): o de 1 do portão ficava a 3,5 m da ponta sul
  // da trilha, ao alcance do pulo correndo, e de cima dele se via a rua inteira; o da saída, colado no bloco CS, ligava
  // por quedas de 2,5 m o telhado do armazém à rua (a casa do time 2 do Sandbox caía lá em cima).
  k.stack(22, 62, 'x', ['green', 'tan']);
  k.stack(31, 64, 'x', ['red', 'tan']);
  k.stack(39, 62, 'x', ['blue', 'green']);
  // O pátio de carga (sudoeste), fechado na rua por uma fileira com 3 entradas (x 4..10, 16..22 e o beco junto do
  // armazém): pilhas, caixotes e o contêiner em Z.
  k.container(10, G, 68, 'x', 'tan');
  k.stack(22, 68, 'x', ['red', 'blue']);
  k.stack(20, 74, 'z', ['tan']);
  k.stack(4, 78, 'x', ['green']);
  k.box(12, G, 76, 14, G + 1, 77, 'crate');
  k.box(25, G, 73, 26.5, G + 2, 74.5, 'crate');
  k.box(26, G, 80, 27.5, G + 1, 82, 'crate');
  k.prop('tarp', 17, G, 76, 0, 1, 1);
  k.prop('generator', 26.5, G, 84.5, PI / 2, 1, 1);
}

// --- O armazém (rota sul; o ponto C) ---

function warehouse(b: MapBuilder): void {
  const k = new Side(b, false);
  const [x0, z0, x1, z1] = [30, 68, 66, 86];
  const top = G + 6;
  k.box(x0 + 0.5, G - 0.5, z0 + 0.5, x1 - 0.5, G, z1 - 0.5, 'concrete');
  b.walls(c(x0), c(G), c(z0), c(x1) - 1, c(top) - 1, c(z1) - 1, 'metal-panel');
  b.walls(c(x0), c(G), c(z0), c(x1) - 1, c(G + 1) - 1, c(z1) - 1, 'cinder-block');
  k.box(x0, top, z0, x1, top + 0.5, z1, 'metal-panel');
  // As claraboias: 3 faixas de vidro no telhado (a luz do céu entra; ninguém chega ao telhado).
  for (const z of [71.5, 75.5, 79.5]) k.box(x0 + 1, top, z, x1 - 1, top + 0.5, z + 1, 'glass');
  for (const s of [false, true]) {
    const side = new Side(b, s);
    // O portão de carga no norte (4 × 2,5 m) e a porta do lado (2 × 2,5 m, embaixo do mezanino).
    side.box(34, G, z0, 38, G + 2.5, z0 + 0.5, null);
    side.box(x0, G, 82, x0 + 0.5, G + 2.5, 84, null);
    // O mezanino de grade na ponta (sul), com escada junto da parede e corrimão.
    side.box(x0 + 0.5, LOFT - 0.5, 80, 36, LOFT, z1 - 0.5, 'grate-slab');
    side.stairs(x0 + 0.5, 77, 32.5, 80, G, '+z');
    side.fence(32.5, 80, 35.5, 80, LOFT);
    side.fence(35.5, 80, 35.5, 85, LOFT);
    // Coberturas: o contêiner que flanqueia o ponto C, paletes de caixotes baixos e altos.
    side.container(39, G, 76, 'x', 'blue');
    side.box(37, G, 72.5, 39, G + 1, 73.5, 'crate');
    side.box(41, G, 81.5, 42.5, G + 2, 83, 'crate');
    // Luz: luminárias no teto e painéis nas paredes.
    side.box(36, top - 0.5, 73, 36.5, top, 73.5, 'lamp');
    side.box(42, top - 0.5, 80, 42.5, top, 80.5, 'lamp');
    side.box(x0, G + 1.5, 75, x0 + 0.5, G + 2.5, 76.5, 'light-panel');
    side.box(40, G + 1.5, z1 - 0.5, 41.5, G + 2.5, z1, 'light-panel');
    side.box(41, G + 1.5, z0, 43, G + 2.5, z0 + 0.5, 'light-panel');
    side.box(x0, G + 1.5, 79, x0 + 0.5, G + 2.5, 80.5, 'light-panel');
    side.prop('barrel', 37.5, G, 70, 0.4, 1, 2);
  }
  k.box(47.5, top - 0.5, 77, 48.5, top, 78, 'lamp');
  k.box(47.5, top - 0.5, 71, 48.5, top, 72, 'lamp');
  // A pilha de paletes do fundo, atrás do ponto C, e a da frente (cortam as vistas de porta a porta).
  k.box(46, G, 78.5, 50, G + 4, z1 - 0.5, 'crate');
  k.box(46, G, z0 + 0.5, 50, G + 2.5, 72.5, 'crate');
}

// --- Pontos, spawns de FFA e câmeras ---

function points(b: MapBuilder): void {
  for (const [id, p] of Object.entries(PORT_POINTS)) {
    b.domination({ id, x: p.x, y: p.y, z: p.z, radius: p.radius });
    // O anel de painéis luminosos no piso (troca bloco cheio de piso por painel: a colisão é a mesma). As células saem
    // da metade oeste e são espelhadas (o arredondamento a 0° e a 180° não é simétrico), e nunca num degrau ou rampa
    // (revisão: um painel no último degrau da escada sul do B deixava a escada diferente de um lado).
    const cells = new Set<string>();
    for (let a = 0; a < 40; a++) {
      const t = (a / 40) * PI * 2;
      const cx = Math.floor((p.x + Math.cos(t) * p.radius) * 2);
      const cz = Math.floor((p.z + Math.sin(t) * p.radius) * 2);
      if (cx >= c(MID)) continue;
      cells.add(`${cx},${cz}`);
      cells.add(`${c(SIZE) - 1 - cx},${cz}`);
    }
    for (const cell of cells) {
      const [cx, cz] = cell.split(',').map(Number) as [number, number];
      const under = b.get(cx, c(p.y) - 1, cz);
      if (b.get(cx, c(p.y), cz) !== null || under === null || under === 'light-panel') continue;
      if (under.includes('step') || under.includes('ramp')) continue;
      b.set(cx, c(p.y) - 1, cz, 'light-panel');
    }
  }
}

function ffaSpawns(k: Side): void {
  // 10 de cada lado (20 no total), escolhidos pela conta do mapc: nenhum vê outro (nem o par do outro lado).
  const spots: [number, number][] = [
    [14, 46.5],
    [8.5, 26],
    [33, 27.5],
    [43.5, 34],
    [20.5, 44],
    [34, 58.5],
    [20, 66],
    [32, 70],
    [7, 84.5],
    [32, 85],
  ];
  for (const [x, z] of spots) k.spawn(x, z, -1);
}

function cameras(b: MapBuilder): void {
  const camera = (name: string, x: number, y: number, z: number, tx: number, ty: number, tz: number): void =>
    b.camera({ name, x, y, z, yaw: yawTo(x, z, tx, tz), pitch: pitchTo(x, y, z, tx, ty, tz), fovYDeg: 0 });
  camera('print:port', 8, 26, 92, 52, G, 40);
  camera('print:cais', 6, G + EYE, 19, 40, G + 1, 22);
  camera('print:praca', 40, G + 6, 39, 48, H1, 47);
  camera('print:galpao', 33, LOFT_FLOOR + EYE, 84, 48, G + 1, 75);
  camera('print:trilha', 29, H1 + EYE, 34, 29, H1, 50);
}

const port: MapScript = {
  id: 'port',
  build(b) {
    b.size(c(SIZE), 56, c(SIZE));
    b.meta({
      nameKey: 'map.port.name',
      modes: ['warfare.tdm', 'warfare.ffa', 'warfare.domination', 'sandbox'],
      players: { min: 2, ideal: 12, max: 16 },
      maxSightLineM: 50,
      botCaps: { switch34p: 12 },
    });

    // Sol alto do sudoeste: as faces que dão para o sul e o oeste ficam claras e a água, do lado da sombra.
    b.sun(-0.4, 0.82, 0.42, 'day');
    b.playArea(AREA.minX, AREA.minZ, AREA.maxX, AREA.maxZ, ground(b));
    ship(b);
    center(b);
    warehouse(b);
    for (const mirror of [false, true]) {
      const k = new Side(b, mirror);
      perimeter(k);
      backdrop(k);
      quay(k);
      yard(k);
      gate(k);
      south(k);
      ffaSpawns(k);
    }
    points(b);
    cameras(b);
  },
  // M11 (fase 4): as armas no mapa (a regra `weapons.pickups`), espelhadas em x = 48. As fortes no eixo: o lança-
  // granadas na praça do guindaste (revisão: saiu do canal do ponto A, onde cai a casa do time 3 do Sandbox), o foguete
  // na plataforma do ponto B e a sniper no alto do bloco CS (a rua); os pares: o fuzil no cais, a metralhadora na
  // passarela da trilha de cima e a SMG na rua.
  weaponSpots: [
    { id: 'c1', x: 47.5, y: 7, z: 47.5, weapon: 'rocket' },
    { id: 'c2', x: 47.5, y: 7, z: 69.5, weapon: 'sniper' },
    { id: 'c3', x: 48.5, y: 4.5, z: 41.5, weapon: 'rocket.grenade-launcher' },
    { id: 'a1', x: 23.5, y: 4.5, z: 16.5, weapon: 'rifle' },
    { id: 'b1', x: 72.5, y: 4.5, z: 16.5, weapon: 'rifle' },
    { id: 'a2', x: 28.5, y: 7, z: 47.5, weapon: 'lmg' },
    { id: 'b2', x: 67.5, y: 7, z: 47.5, weapon: 'lmg' },
    { id: 'a3', x: 27.5, y: 4.5, z: 61.5, weapon: 'smg' },
    { id: 'b3', x: 68.5, y: 4.5, z: 61.5, weapon: 'smg' },
  ],
};

export default port;
