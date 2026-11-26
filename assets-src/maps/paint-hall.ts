import type { MapBuilder, MapScript, RampDir, RampFamily } from '../../tools/mapc/src/api.ts';
import { container, type ContainerColor } from './kit.ts';

/**
 * GALPÃO DE PAINTBALL (nome provisório, pergunta AK2; M10, fase 3): o mapa do Bobo Paintball (GDD §4.6.4: interior
 * colorido com infláveis), que também joga TDM e o Sandbox. Grade de 72×16×108 m (144×32×216 células), galpão
 * fechado de 64×84 m (x de 4 a 68; z de 4 a 88 no script, de 20 a 104 no mundo: ver `OZ`), de dia: a luz entra pelas
 * aberturas de 2 m do lanternim no teto (fechadas por vidro em pé) e pelos painéis luminosos das paredes.
 *
 * ESPELHADO no meio (z = 46 no script): o time 0 nasce na área de preparação do norte (z 4..13), o time 1 na do sul;
 * cada área tem 3 boxes (oeste, meio e leste, cada um com o seu portão para o campo), fechados para o campo do chão ao
 * teto. Travessia de spawn a spawn: 13,5–15 s correndo.
 * - O CAMPO (z 13,5..78,5): grama sintética com as linhas brancas (laterais, as de saída e a do meio).
 * - OESTE, o lado da cobra: as duas PASSARELAS de grade a 3,75 m encostadas na parede, com o parapeito de 1,25 m, a
 *   cobertura de grade e escada nas duas pontas, que terminam na CASA DO COMPRESSOR do meio (a sala com uma porta para
 *   cada metade); embaixo delas o corredor coberto; a parede de paletes do portão, o L de tapume, a cobra de cubos
 *   infláveis e o ônibus (dois contêineres de 12 m empilhados).
 * - MEIO: a TORRE DO JUIZ (8 × 8 m, 8,5 m de altura) no centro, os contêineres curtos dos lados dela, a espinha de tapume
 *   na frente do portão do meio e as pilhas de paletes, com os infláveis entre eles.
 * - LESTE, o lado dos contêineres: contêineres de chapa (um, dois de altura) formando os corredores, com latas e cubos
 *   infláveis entre eles.
 * - Em cima: a PONTE ROLANTE (as vigas do caminho de rolamento em x 20 e x 52, a 2,5 m do chão, sobre as colunas, e a
 *   viga da ponte com o gancho), que também corta a vista da passarela para o outro lado do galpão.
 * As 3 rotas (oeste, meio e leste) correm o campo inteiro; a cobertura fica a 4–10 m uma da outra (latas e cubos
 * infláveis do kit e os blocos), boa para o duelo de projétil do Paintball (a bola de tinta a 45–110 m/s). Os infláveis
 * não contam na linha de visão do `mapc` (só bloco conta): quem segura os 50 m são os tapumes, os paletes, os
 * contêineres, a torre e a casa (medido: 49,98 m).
 *
 * Revisão (os poleiros): gente sobe 1,5 m (pulo + degrau), então os tapumes e paletes têm 3 m (do topo de um cubo
 * inflável não se sobe neles), as latas ficam a mais de 3 m dos cubos, as vigas da ponte rolante e o gancho ficam fora
 * de alcance e a cobertura da passarela tira o pé-direito de cima do parapeito: o mais alto que gente chega é a
 * passarela (o teste do mapa confere que nenhum poleiro vê além de 50 m nem enxerga um box de fora).
 *
 * Tudo em METROS aqui (múltiplos de 0,5); o builder recebe células. Caixas semiabertas [a, b).
 */

const c = (m: number): number => Math.round(m * 2);
const PI = Math.PI;
/** Piso do chão (metros). */
const G = 1;
/**
 * O galpão por dentro (a área jogável) e a soma do espelho (z' = MZ − z), nas coordenadas do SCRIPT. O mundo é o script
 * deslocado de `OZ` em z (só o `Half` e as chamadas diretas somam): assim os infláveis (z 17..75 aqui, 33..91 no mundo)
 * caem em 2 × 2 células de 32 m do render (um grupo instanciado por modelo e célula; o Switch 3–4P desenha até 8 por
 * vista) e, com 2 modelos de inflável, o galpão inteiro tem no máximo 8 grupos (revisão, item 5).
 */
const MIN_X = 4;
const MAX_X = 68;
const MIN_Z = 4;
const MAX_Z = 88;
const MZ = MIN_Z + MAX_Z;
const MID_Z = MZ / 2;
const OZ = 16;
const MID_X = (MIN_X + MAX_X) / 2;
/** Altura do teto (a laje de telha começa aqui). */
const ROOF = 12;
/** A passarela oeste: a laje de grade fica em [3,5; 4) (piso a 3,75 m). */
const CATWALK = 4;
/** As aberturas de 2 m do teto (início em z, metade norte; a sul é o espelho), longe das colunas e das tesouras. */
const ROOF_SLOTS: readonly number[] = [7, 13, 22.5, 28, 35, 40.5];
/** Fim da área de preparação (o tapume) e o início do campo de grama. */
const START_WALL_Z = 13;
const FIELD_Z = 13.5;

const CONCRETE: RampFamily = {
  solid: 'concrete',
  ramp: 'concrete-ramp',
  halfLow: 'concrete-ramp-half-low',
  halfHigh: 'concrete-ramp-half-high',
  step: 'concrete-step',
};

/** Os 3 portões de cada tapume (x0, x1): oeste, meio e leste (espelhados em x também). */
const GATES: readonly (readonly [number, number])[] = [
  [6, 9],
  [34.5, 37.5],
  [63, 66],
];

/** Yaw (rad) para olhar de (x, z) para (tx, tz): a frente é -Z e o yaw + vira à esquerda. */
function yawTo(x: number, z: number, tx: number, tz: number): number {
  return Math.atan2(-(tx - x), -(tz - z));
}

function pitchTo(x: number, y: number, z: number, tx: number, ty: number, tz: number): number {
  return Math.atan2(ty - y, Math.hypot(tx - x, tz - z));
}

/**
 * Metade do galpão em METROS: `flip` espelha em z (z' = MZ − z) e troca o time; o que fica em cima da linha do meio
 * entra uma vez só, sem espelho.
 */
class Half {
  readonly b: MapBuilder;
  readonly flip: boolean;
  constructor(b: MapBuilder, flip: boolean) {
    this.b = b;
    this.flip = flip;
  }

  /** z do script → z do mundo (espelhado na metade sul e deslocado de `OZ`). */
  z(z: number): number {
    return (this.flip ? MZ - z : z) + OZ;
  }

  /** Caixa [x0, x1) × [y0, y1) × [z0, z1). */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, block: string | null, rot = 0): void {
    const [a, e] = this.flip ? [MZ - z1 + OZ, MZ - z0 + OZ] : [z0 + OZ, z1 + OZ];
    this.b.box(c(x0), c(y0), c(a), c(x1) - 1, c(y1) - 1, c(e) - 1, block, rot);
  }

  /** Painel fino (rede) no plano z = z0 (a célula [z0, z0 + 0,5)), de x0 a x1 e de y0 a y1. */
  panelX(x0: number, x1: number, y0: number, y1: number, z0: number, block: string): void {
    const z = (this.flip ? MZ - z0 - 0.5 : z0) + OZ;
    this.b.panel(c(x0), c(y0), c(z), c(x1) - 1, c(y1) - 1, c(z), block);
  }

  /** Painel fino no plano x = x0, de z0 a z1. */
  panelZ(z0: number, z1: number, y0: number, y1: number, x0: number, block: string): void {
    const [a, e] = this.flip ? [MZ - z1 + OZ, MZ - z0 + OZ] : [z0 + OZ, z1 + OZ];
    this.b.panel(c(x0), c(y0), c(a), c(x0), c(y1) - 1, c(e) - 1, block);
  }

  stairs(x0: number, z0: number, x1: number, z1: number, y: number, dir: RampDir): void {
    const [a, e] = this.flip ? [MZ - z1 + OZ, MZ - z0 + OZ] : [z0 + OZ, z1 + OZ];
    const d: RampDir = this.flip && dir === '+z' ? '-z' : this.flip && dir === '-z' ? '+z' : dir;
    this.b.stairs(c(x0), c(y), c(a), c(x1) - 1, c(e) - 1, CONCRETE, d);
  }

  prop(model: string, x: number, z: number, yaw = 0, y = G): void {
    this.b.prop(model, x, y, this.z(z), this.flip ? PI - yaw : yaw, 1, 1);
  }

  /** Spawn do time da metade (0 no norte, 1 no sul), olhando para o meio do campo. */
  spawn(x: number, z: number): void {
    const zz = this.z(z);
    this.b.spawn({ x, y: G, z: zz, yaw: yawTo(x, zz, MID_X, MID_Z + OZ), team: this.flip ? 1 : 0 });
  }

  /** Contêiner do kit (2,5 m de altura) no chão ou empilhado (`y`); as portas nas duas pontas (o espelho fica igual). */
  container(x: number, z: number, along: 'x' | 'z', color: ContainerColor, length = 6, y = G): number {
    const lenZ = along === 'z' ? length : 2.5;
    const zz = (this.flip ? MZ - z - lenZ : z) + OZ;
    return container(this.b, { x, y, z: zz, along, color, length });
  }
}

/** O casco: o piso, as paredes, o teto com as faixas de telha de vidro, as tesouras e as luminárias. */
function hall(b: MapBuilder): void {
  const k = new Half(b, false);
  // Piso de concreto (a laje inteira) e a grama sintética do campo.
  k.box(MIN_X - 0.5, 0, MIN_Z - 0.5, MAX_X + 0.5, G, MAX_Z + 0.5, 'concrete');
  k.box(7, 0.5, FIELD_Z, 65, G, MZ - FIELD_Z, 'turf');
  // As linhas brancas: as laterais, as de saída (a 1 m do tapume) e a do meio (1 m).
  k.box(7, 0.5, FIELD_Z, 7.5, G, MZ - FIELD_Z, 'turf-line');
  k.box(64.5, 0.5, FIELD_Z, 65, G, MZ - FIELD_Z, 'turf-line');
  k.box(7, 0.5, MID_Z - 0.5, 65, G, MID_Z + 0.5, 'turf-line');
  for (const flip of [false, true]) {
    const h = new Half(b, flip);
    h.box(7, 0.5, 14.5, 65, G, 15, 'turf-line');
    // A marca do meio de cada metade (a "linha dos 25").
    h.box(7, 0.5, 29.5, 9, G, 30, 'turf-line');
    h.box(63, 0.5, 29.5, 65, G, 30, 'turf-line');
  }
  // Paredes: bloco de concreto até 4 m e chapa até o teto.
  b.walls(
    c(MIN_X - 0.5),
    c(G),
    c(MIN_Z - 0.5 + OZ),
    c(MAX_X + 0.5) - 1,
    c(ROOF) - 1,
    c(MAX_Z + 0.5 + OZ) - 1,
    'metal-panel',
  );
  b.walls(
    c(MIN_X - 0.5),
    c(G),
    c(MIN_Z - 0.5 + OZ),
    c(MAX_X + 0.5) - 1,
    c(G + 3) - 1,
    c(MAX_Z + 0.5 + OZ) - 1,
    'cinder-block',
  );
  // A faixa de LED em volta do galpão, a 4 m.
  b.walls(
    c(MIN_X - 0.5),
    c(G + 3),
    c(MIN_Z - 0.5 + OZ),
    c(MAX_X + 0.5) - 1,
    c(G + 3.5) - 1,
    c(MAX_Z + 0.5 + OZ) - 1,
    'led-strip',
  );
  // O teto: o forro de chapa (a rampa de telhado mostra o forro por baixo) com as aberturas de ventilação de 2 m (o
  // lanternim) a cada 5–7 m, por onde entram a luz do céu e o sol. As aberturas também dividem o telhado em faixas
  // soltas: em cima dele não sobra um pedaço de navegação maior que o chão do galpão (a sim usa o maior componente).
  k.box(MIN_X - 0.5, ROOF, MIN_Z - 0.5, MAX_X + 0.5, ROOF + 0.5, MAX_Z + 0.5, 'metal-roof-ramp');
  for (const flip of [false, true]) {
    const h = new Half(b, flip);
    // Cada abertura leva 4 fileiras de vidro em pé (painel fino a cada 0,5 m): a luz e o sol passam, ninguém passa
    // (nem com a gravidade baixa) e ninguém fica em pé em cima (o painel não é piso: o telhado continua em pedaços).
    for (const z of ROOF_SLOTS) {
      h.box(MIN_X - 0.5, ROOF, z, MAX_X + 0.5, ROOF + 0.5, z + 2, null);
      for (let r = 0; r < 2; r += 0.5) h.panelX(MIN_X - 0.5, MAX_X + 0.5, ROOF, ROOF + 0.5, z + r, 'glass-pane');
    }
    // As tesouras de aço ao longo de x, embaixo das faixas do forro (as do meio apoiam nas colunas da ponte rolante),
    // com as luminárias penduradas.
    for (const z of [10.5, 19, 26, 32.5, 38.5]) {
      h.box(MIN_X, ROOF - 1, z, MAX_X, ROOF, z + 0.5, 'steel-beam');
      if (z === 19 || z === 32.5) continue;
      for (const x of [12, 24, 36, 47.5, 59.5]) h.box(x, ROOF - 1.5, z, x + 0.5, ROOF - 1, z + 0.5, 'lamp');
    }
  }
  k.box(MIN_X, ROOF - 1, MID_Z - 0.5, MAX_X, ROOF, MID_Z + 0.5, 'steel-beam');
  // Painéis luminosos nas paredes compridas (a 2 m), a cada 8 m; os da parede oeste ficam debaixo da passarela.
  for (let z = 10; z < MAX_Z - 2; z += 8) {
    k.box(MIN_X - 0.5, G + 1, z, MIN_X, G + 2, z + 1, 'light-panel');
    k.box(MAX_X, G + 1, z, MAX_X + 0.5, G + 2, z + 1, 'light-panel');
  }
  // Acima da passarela, mais uma fileira na parede oeste.
  for (let z = 26; z < 70; z += 8) k.box(MIN_X - 0.5, CATWALK + 1.5, z, MIN_X, CATWALK + 2.5, z + 1, 'light-panel');
}

/**
 * A área de preparação de uma metade, FECHADA para o campo (revisão): o tapume vai do chão ao teto (tábua até 4 m e
 * chapa até o forro) e as duas divisórias também, então só se vê (e só se acerta) um box pelo portão dele. Três boxes
 * (oeste, meio e leste), cada um com o seu portão; atrás de cada portão o anteparo de 3 m (a altura do portão), em L nos
 * boxes dos lados (encostado na parede do galpão, com a saída de 1 m perto do tapume): de fora, a linha que passa pelo
 * portão e pela saída do L só pega a faixa junto do tapume, longe dos spawns.
 */
function staging(h: Half): void {
  h.box(MIN_X, G, START_WALL_Z, MAX_X, G + 3, START_WALL_Z + 0.5, 'plank');
  h.box(MIN_X, G + 3, START_WALL_Z, MAX_X, ROOF, START_WALL_Z + 0.5, 'metal-panel');
  for (const [x0, x1] of GATES) h.box(x0, G, START_WALL_Z, x1, G + 3, START_WALL_Z + 0.5, null);
  // Os anteparos: o do box do meio na frente do portão; os dos lados em L, da parede do galpão até 1 m além do portão.
  h.box(33.5, G, 10.5, 38.5, G + 3, 11, 'plank');
  h.box(MIN_X, G, 10.5, 13, G + 3, 11, 'plank');
  h.box(12.5, G, 11, 13, G + 3, 12, 'plank');
  h.box(59, G, 10.5, MAX_X, G + 3, 11, 'plank');
  h.box(59, G, 11, 59.5, G + 3, 12, 'plank');
  // As duas divisórias, também até o teto.
  for (const x of [30, 41.5]) {
    h.box(x, G, MIN_Z, x + 0.5, G + 3, START_WALL_Z, 'plank');
    h.box(x, G + 3, MIN_Z, x + 0.5, ROOF, START_WALL_Z, 'metal-panel');
  }
  // A faixa amarela de circulação no piso.
  h.box(MIN_X + 1, 0.5, 11.5, MAX_X - 1, G, 12, 'concrete-stripe');
  // Armários (chapa) no fundo e os caixotes dos cantos.
  h.box(14, G, MIN_Z, 28, G + 2, MIN_Z + 0.5, 'metal-panel');
  h.box(44, G, MIN_Z, 58, G + 2, MIN_Z + 0.5, 'metal-panel');
  h.box(MIN_X, G, MIN_Z, MIN_X + 2, G + 2, MIN_Z + 2, 'crate');
  h.box(MAX_X - 2, G, MIN_Z, MAX_X, G + 2, MIN_Z + 2, 'crate');
  // O compressor de ar (caixotes) no fundo do box do meio.
  h.box(35, G, MIN_Z, 37, G + 1.5, MIN_Z + 1, 'crate');
  // Painéis luminosos no fundo, acima dos armários, e a placa de saída no meio.
  for (const x of [8, 20, 31, 40, 51, 63]) h.box(x, G + 2.5, MIN_Z - 0.5, x + 1, G + 3.5, MIN_Z, 'light-panel');
  h.box(35.5, G + 2.5, MIN_Z - 0.5, 36.5, G + 3, MIN_Z, 'exit-sign');
  // Os 8 spawns: 3 no box oeste, 2 no do meio e 3 no leste, no fundo (fora da faixa que se vê pelos portões).
  for (const [x, z] of [
    [17, 6.5],
    [21.5, 6.5],
    [26, 5.5],
    [32.5, 7.5],
    [39.5, 7.5],
    [46, 5.5],
    [50.5, 6.5],
    [55, 6.5],
  ] as const) {
    h.spawn(x, z);
  }
}

/**
 * Tapume de compensado (cobertura alta de bloco) de `h` metros. 3 m (revisão): do topo de um inflável de 1 m não se
 * sobe nele (são 2 m), então o topo dele não vira poleiro.
 */
function wall(h: Half, x0: number, z0: number, x1: number, z1: number, height = 3): void {
  h.box(x0, G, z0, x1, G + height, z1, 'plank');
}

/** Pilha de paletes (caixotes) de `height` metros (3 m, como o tapume). */
function pallets(h: Half, x0: number, z0: number, x1: number, z1: number, height = 3): void {
  h.box(x0, G, z0, x1, G + height, z1, 'crate');
}

/** O lado oeste de uma metade: a passarela, as escadas, o corredor coberto, o L e a cobra. */
function west(h: Half): void {
  // A passarela de grade desta metade (z 21,5..42, até a casa do compressor) com o parapeito de tábua de 1,25 m na
  // beira (os vãos das duas escadas ficam abertos) e o fecho da ponta. O piso de grade NÃO para a tinta (de baixo se
  // acerta quem está em cima e vice-versa), de propósito: a passarela vê longe e é exposta. Em cima, a cobertura de
  // grade a 2,25 m do piso: deixa a luz passar e tira o pé-direito de cima do parapeito (ninguém fica em pé nele).
  h.box(MIN_X, CATWALK - 0.5, 21.5, 7, CATWALK, 42, 'grate-slab');
  h.box(6.5, CATWALK - 0.5, 24, 7, CATWALK + 1, 38, 'plank');
  h.box(6.5, CATWALK - 0.5, 40, 7, CATWALK + 1, 42, 'plank');
  h.box(MIN_X, CATWALK - 0.5, 21.5, 7, CATWALK + 1, 22, 'plank');
  h.box(MIN_X, CATWALK + 2, 21.5, 7, CATWALK + 2.5, 42, 'grate-slab');
  h.stairs(7, 22, 10, 24, G, '-x');
  h.stairs(7, 38, 10, 40, G, '-x');
  // O corredor coberto: uma pilha de caixotes encostada na parede.
  pallets(h, MIN_X, 30, 5.5, 32, 2.5);
  // A ponte rolante: a viga do caminho de rolamento sobre as colunas (x 20 e o espelho em x 52), a 2,5 m do chão
  // (passa-se por baixo), e a viga da ponte atravessando o galpão. A viga de 2,5 m tapa a visão de quem está na
  // passarela para o lado de lá do galpão. Ela começa a 2,5 m do tapume e nada de pé alcança o topo dela.
  for (const x of [19.5, 51.5]) {
    h.box(x, G + 2.5, 16, x + 1, G + 5, MID_Z, 'steel-beam');
    for (const z of [19, 32]) h.box(x, G, z, x + 1, ROOF - 1, z + 1, 'steel-column');
  }
  h.box(20.5, G + 5, 29.5, 51.5, G + 6, 30.5, 'steel-beam');
  // O gancho da ponte: o caixote pendurado logo embaixo da viga (o fundo a 3 m do chão, o topo a 2,5 m acima do topo
  // dos tapumes: de cima deles não se sobe nele).
  h.box(27, G + 3, 29.5, 28.5, G + 5, 31, 'crate');
  // Na saída do portão oeste: a lata.
  h.prop('inflatable-can', 8, 17.5);
  // A parede de paletes do lado do portão oeste (protege a saída e corta a vista ao longo do tapume).
  // (4,5 m: o topo fica fora do alcance de qualquer pulo)
  pallets(h, 10, FIELD_Z, 12.5, 21, 4.5);
  h.prop('inflatable-can', 14, 22.5);
  // O L de tapume e a cobra: cubos infláveis em pares, a 2 m um par do outro, paralelos à passarela.
  // (3,5 m e a 3,5 m da escada: de cima dela ninguém pula no L)
  wall(h, 11, 25.5, 15, 26, 3.5);
  wall(h, 14.5, 26, 15, 29, 3.5);
  for (const z of [30, 34, 38]) {
    h.prop('inflatable-cube', 11.5, z + 0.5);
    h.prop('inflatable-cube', 11.5, z + 1.5);
  }
  // O tapume do meio da faixa oeste e as latas.
  wall(h, 15.5, 34.5, 20.5, 35);
  h.prop('inflatable-can', 18, 30);
  h.prop('inflatable-can', 17.5, 39.5);
}

/** O meio de uma metade: o tapume na frente do portão, o T, os paletes e os infláveis. */
function middle(h: Half): void {
  // A boca do portão do meio (2 m de corredor para fora do tapume) e o tapume de casa logo depois (sai-se pelos lados).
  h.box(33.5, G, START_WALL_Z + 0.5, 34.5, G + 3, 15.5, 'plank');
  h.box(37.5, G, START_WALL_Z + 0.5, 38.5, G + 3, 15.5, 'plank');
  // (as paredes da boca vão até o teto, como o tapume: em cima delas não se sobe)
  h.box(33.5, G + 3, START_WALL_Z + 0.5, 34.5, ROOF, 15.5, 'metal-panel');
  h.box(37.5, G + 3, START_WALL_Z + 0.5, 38.5, ROOF, 15.5, 'metal-panel');
  wall(h, 32, 17.5, 40, 18);
  h.prop('inflatable-cube', 30.5, 19.5);
  h.prop('inflatable-cube', 41.5, 19.5);
  // As pilhas de paletes dos dois lados e as paredes infláveis.
  pallets(h, 24.5, 22, 29.5, 24);
  pallets(h, 42.5, 22, 47.5, 24);
  for (const x of [29.5, 30.5, 41.5, 42.5]) h.prop('inflatable-cube', x, 25.5);
  // A espinha do meio: o tapume ao longo de z (separa o meio-norte em dois) e a pilha de paletes na ponta.
  wall(h, 35.5, 18, 36.5, 34);
  // Os tapumes do quarto de campo, entre a espinha e as faixas.
  wall(h, 20.5, 32, 25.5, 32.5);
  wall(h, 46.5, 32, 51.5, 32.5);
  pallets(h, 35, 34, 37, 37);
  // Os infláveis do meio-campo de cada lado da espinha.
  h.prop('inflatable-cube', 22, 18);
  h.prop('inflatable-cube', 50, 18);
  h.prop('inflatable-cube', 33.5, 23.5);
  h.prop('inflatable-cube', 38.5, 23.5);
  h.prop('inflatable-cube', 26.5, 28);
  h.prop('inflatable-cube', 45.5, 28);
  h.prop('inflatable-can', 23, 37.5);
  h.prop('inflatable-can', 49, 37.5);
  h.prop('inflatable-can', 31, 30);
  h.prop('inflatable-can', 41, 30);
  h.prop('inflatable-cube', 27, 33.5);
  h.prop('inflatable-cube', 45, 33.5);
  // As pilhas baixas na frente da torre e o que fica em volta dela.
  pallets(h, 28, 37, 32, 41);
  pallets(h, 40, 37, 44, 41);
  h.prop('inflatable-cube', 33.5, 36.5);
  h.prop('inflatable-cube', 38.5, 36.5);
  h.prop('inflatable-cube', 35.5, 40.5);
  h.prop('inflatable-cube', 36.5, 40.5);
  h.prop('inflatable-cube', 30.5, 43.5);
  h.prop('inflatable-cube', 41.5, 43.5);
}

/** O leste de uma metade: os contêineres e os infláveis entre eles. */
function east(h: Half): void {
  h.prop('inflatable-can', 63.5, 17.5);
  pallets(h, 59.5, FIELD_Z, 62, 21, 4.5);
  h.prop('inflatable-cube', 56, 17.5);
  h.container(53, 21, 'x', 'blue');
  h.container(60.5, 26, 'z', 'red');
  // A pilha de dois do meio-leste (5 m).
  const top = h.container(52, 31, 'x', 'green');
  h.container(52, 31, 'x', 'tan', 6, top);
  h.prop('inflatable-can', 58.5, 30);
  h.prop('inflatable-can', 56.5, 26.5);
  h.prop('inflatable-can', 56, 37.5);
  pallets(h, 61.5, 36, 64.5, 37.5);
}

/** O que fica em cima da linha do meio (uma vez só): a torre do juiz, a casa do compressor e os contêineres. */
function center(b: MapBuilder): void {
  const k = new Half(b, false);
  // A torre do juiz: base de bloco de 5,5 m, a cabine de vidro (acima do olho de quem está na passarela) e a laje.
  k.box(32, G, 42, 40, G + 5.5, 50, 'cinder-block');
  k.box(32, G + 5.5, 42, 40, G + 7, 50, 'glass');
  k.box(32.5, G + 5.5, 42.5, 39.5, G + 7, 49.5, 'plank');
  k.box(31.5, G + 7, 41.5, 40.5, G + 7.5, 50.5, 'metal-panel');
  for (const z of [44, 47]) {
    k.box(31.5, G + 2, z, 32, G + 3, z + 1, 'light-panel');
    k.box(40, G + 2, z, 40.5, G + 3, z + 1, 'light-panel');
  }
  for (const x of [34, 37]) {
    k.box(x, G + 2, 41.5, x + 1, G + 3, 42, 'light-panel');
    k.box(x, G + 2, 50, x + 1, G + 3, 50.5, 'light-panel');
  }
  // A casa do compressor no meio do lado oeste (as duas passarelas terminam nela): bloco de 6,5 m de altura.
  k.box(MIN_X, G, 42, 13, G + 6.5, 50, 'cinder-block');
  k.box(MIN_X, G + 6.5, 41.5, 13.5, G + 7, 50.5, 'metal-panel');
  // Por dentro, a sala do compressor (8 × 7 m, 3 m de pé-direito) com uma porta para cada metade: a passagem coberta
  // da faixa oeste e a casa de um dos times a mais do Sandbox (ela cai no meio do lado oeste; a do outro, no leste).
  k.box(MIN_X + 0.5, G, 42.5, 12.5, G + 3, 49.5, null);
  b.door(c(10), c(G), c(42 + OZ), 'x');
  b.door(c(10), c(G), c(49.5 + OZ), 'x');
  k.box(8, G + 2.5, 45.5, 9, G + 3, 46.5, 'lamp');
  k.box(MIN_X + 0.5, G + 1, 44, MIN_X + 1, G + 2, 45, 'light-panel');
  k.box(MIN_X + 0.5, G + 1, 47, MIN_X + 1, G + 2, 48, 'light-panel');
  k.box(12.5, G + 1, 43, 13, G + 2, 44, 'light-panel');
  k.box(12.5, G + 1, 48, 13, G + 2, 49, 'light-panel');
  // A pilha de caixotes no meio da sala (de uma porta não se vê a outra).
  pallets(k, 9, 45, 11, 47, 2);
  // O compressor (caixotes) no canto.
  k.box(MIN_X + 0.5, G, 42.5, 6.5, G + 1.5, 44, 'crate');
  // Os letreiros luminosos em cima das portas, virados para o campo.
  k.box(9.5, G + 3.5, 42, 11.5, G + 4.5, 42.5, 'light-panel');
  k.box(9.5, G + 3.5, 49.5, 11.5, G + 4.5, 50, 'light-panel');
  // O ônibus: dois contêineres de 12 m empilhados (6 m) na faixa oeste, encostados na casa; o comprido do leste.
  const busTop = k.container(13, 40, 'z', 'tan', 12);
  k.container(13, 40, 'z', 'red', 12, busTop);
  k.container(59, 40, 'z', 'tan', 12);
  // As colunas do meio da ponte rolante, com o tapume de 1 m encostado do lado do meio.
  for (const x of [19.5, 51.5]) k.box(x, G, 45.5, x + 1, ROOF - 1, 46.5, 'steel-column');
  wall(k, 20.5, 42, 21.5, 50);
  wall(k, 50.5, 42, 51.5, 50);
  // Entre o tapume leste e o contêiner comprido, os paletes.
  pallets(k, 55.5, 43.5, 57, 48.5);
  // Os contêineres curtos dos dois lados da torre (o miolo da linha do meio).
  k.container(23.5, 43, 'z', 'green');
  k.container(46, 43, 'z', 'green');
  // Na linha do meio: as latas e a pilha de paletes encostada na parede leste
  k.prop('inflatable-cube', 30, MID_Z);
  k.prop('inflatable-cube', 42, MID_Z);
  // (3,5 m: de cima não se desce para o chão, então ela fica fora da navegação e a casa do Sandbox cai do lado dela).
  pallets(k, 64.5, 44, MAX_X, 48, 3.5);
}

/**
 * Câmeras dos prints. Pendência anotada (revisão): a câmera de cima do Aquário fica 24 m acima do bobo seguido
 * (`AQUARIUM.topHeightM`), acima do forro de 12 m, e mostra o telhado; num mapa coberto ela precisaria de um teto por
 * mapa (fica para o Aquário).
 */
function cameras(b: MapBuilder): void {
  const camera = (name: string, x: number, y: number, z: number, tx: number, ty: number, tz: number): void =>
    b.camera({ name, x, y, z: z + OZ, yaw: yawTo(x, z, tx, tz), pitch: pitchTo(x, y, z, tx, ty, tz), fovYDeg: 0 });
  camera('print:paint-hall', MID_X, 8.5, 16, MID_X, G, 50);
  camera('print:paint-hall-passarela', 5.5, CATWALK + 1.55, 24, 30, G + 1, 44);
  camera('print:paint-hall-meio', 30, G + 1.55, 26.5, 40, G + 1, 44);
  camera('print:paint-hall-conteineres', 66, G + 1.55, 20, 56, G + 1, 40);
}

const paintHall: MapScript = {
  id: 'paint-hall',
  build(b) {
    b.size(144, 32, 216);
    b.meta({
      nameKey: 'map.paint-hall.name',
      modes: ['paintball', 'warfare.tdm', 'sandbox'],
      players: { min: 2, ideal: 10, max: 16 },
      maxSightLineM: 50,
      botCaps: {},
    });
    b.playArea(MIN_X, MIN_Z + OZ, MAX_X, MAX_Z + OZ, G - 10);
    b.sun(-0.4, 0.8, -0.45, 'day');
    hall(b);
    for (const flip of [false, true]) {
      const h = new Half(b, flip);
      staging(h);
      west(h);
      middle(h);
      east(h);
    }
    center(b);
    cameras(b);
  },
  // M11 (fase 4): as armas no mapa (a regra `weapons.pickups`; no TDM e no Sandbox), espelhadas em z = 62 (mundo). As
  // fortes na linha do meio: o foguete do lado oeste da torre do juiz, a escopeta automática do lado leste (revisão:
  // saiu da casa do compressor, onde cai a casa do time 2 do Sandbox) e o lança-granadas em cima do contêiner do
  // leste; os pares: a sniper na passarela oeste, a metralhadora e a SMG no campo e o fuzil na parede leste.
  weaponSpots: [
    { id: 'c1', x: 31.5, y: 1, z: 61.5, weapon: 'rocket' },
    { id: 'c2', x: 56.5, y: 4, z: 61.5, weapon: 'rocket.grenade-launcher' },
    { id: 'c3', x: 43.5, y: 1, z: 61.5, weapon: 'shotgun.auto' },
    { id: 'a1', x: 5.5, y: 4, z: 45.5, weapon: 'sniper' },
    { id: 'b1', x: 5.5, y: 4, z: 78.5, weapon: 'sniper' },
    { id: 'a2', x: 24.5, y: 1, z: 43.5, weapon: 'lmg' },
    { id: 'b2', x: 24.5, y: 1, z: 80.5, weapon: 'lmg' },
    { id: 'a3', x: 44.5, y: 1, z: 45.5, weapon: 'smg' },
    { id: 'b3', x: 44.5, y: 1, z: 78.5, weapon: 'smg' },
    { id: 'a4', x: 66.5, y: 1, z: 38.5, weapon: 'rifle' },
    { id: 'b4', x: 66.5, y: 1, z: 85.5, weapon: 'rifle' },
  ],
};

export default paintHall;
