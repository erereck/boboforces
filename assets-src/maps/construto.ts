import { FIGURE_HEAD_HALF_M } from '@boboforces/format';
import { METRICS } from '@boboforces/sim';
import type { MapBuilder, MapScript, RampDir, RampFamily } from '../../tools/mapc/src/api.ts';

/**
 * CONSTRUTO (decisão #20; GDD §4.6.4 e §5.8; arte-ux.md §5.1–§5.2): sala de teste gigante, homenagem ao gmod sem
 * copiar o mapa. Grade de 80×80×24 m (160×48×160 células), área jogável de 72×72 m (x, z de 4 a 76), 3 níveis
 * (térreo 1,0 m, 1º andar 4,0 m, topo da torre 9,0 m), maior linha de visão declarada de 50 m (Switch 3–4P).
 *
 * Planta em 3×3 SETORES de 24×24 m (colunas oeste/centro/leste × faixas norte/meio/sul; norte = -Z). Os setores se
 * separam por PAREDES DE TESTE de 5 m com réguas (mais altas que o olho de quem está no 1º andar), com passagens
 * de 4 m DESENCONTRADAS de um limite para o outro: é isso que segura a maior linha de visão em 50 m sem fechar as
 * 3 rotas (oeste, centro e leste).
 * - NO: Prédio de Teste 1 (2 andares, escada interna). N: abrigo do time B (nasce no norte) e ponto A.
 * - NE: Prédio de Teste 2 (térreo) e caixa d'água.
 * - O: pátio de caixotes, guarita e plataforma com rampa 1:1. C: a Torre de 8 m (sala embaixo, cabine com seteiras
 *   em cima), rampa 1:2 até o patamar de 4 m, escada até o topo e passarela de grade até o Bloco Leste. L: Bloco
 *   Leste (2 andares) e paredes de teste em zigue-zague.
 * - SO (cena-vitrine, ~32×32 m): galpão fechado (metade interior: mezanino de grade, luminárias e painéis luminosos)
 *   e o pátio da vitrine (metade exterior: grama, rampa 1:2, laje, cerca de tela, mato em cruz, lona, jipe, caixa
 *   d'água, canos, barris, sacos de areia, holofote e os 6 manequins). A BANCADA DE MATERIAIS (vidro e água rasa)
 *   fica FORA da área jogável, atrás da cerca de tela do sul.
 * - S: o time A nasce no sul, com o ponto B. SE: Prédio de Teste 3 (2 andares).
 * - Borda (fora da área): grama, mato em cruz, árvores de bloco, a PISTA DE LEITURA (estrada de terra no norte, entre
 *   uma sebe e o perímetro, com o par de manequins do print de leitura e as câmeras a 5, 15, 30 e 50 m dele) e a RÉGUA
 *   DE MÉTRICAS (faixa sul, a leste da bancada: porta, muro de 1,5 m e cobertura baixa com os 3 manequins de perfil).
 * - Marcadores OPCIONAIS do boneco do FutBobo (PLANO do porte §B16): a FILA `linha:1..8` encostada no perímetro leste
 *   e o CLOSE `close:1`/`close:5` no plano do print de densidade. Manequins e câmeras não colidem nem entram na
 *   navegação.
 *
 * Tudo em METROS aqui (múltiplos de 0,5); o builder recebe células. Caixas semiabertas [a, b).
 */

const c = (m: number): number => Math.round(m * 2);
/** Piso do térreo, do 1º andar e da laje do teto dos prédios de 2 andares (metros). */
const G = 1;
const F2 = 4;
const F3 = 7;
/** Altura das paredes entre setores (topo a 6,0 m: acima do olho de quem está no 1º andar, 4,0 + 1,55 = 5,55 m). */
const SECTOR_WALL_TOP = G + 5;
/** Olho em pé, da tabela canônica (câmeras dos prints e rotas do bench). */
const EYE = METRICS.eyeHeight;
const PI = Math.PI;

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

/** Kit em metros sobre o builder de células. */
class Kit {
  readonly b: MapBuilder;
  constructor(b: MapBuilder) {
    this.b = b;
  }

  /** Caixa [x0, x1) × [y0, y1) × [z0, z1) em metros. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, block: string | null, rot = 0): void {
    this.b.box(c(x0), c(y0), c(z0), c(x1) - 1, c(y1) - 1, c(z1) - 1, block, rot);
  }

  /** Paredes de 0,5 m no contorno de [x0, x1) × [z0, z1), de y0 a y1. */
  shell(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, block: string): void {
    this.b.walls(c(x0), c(y0), c(z0), c(x1) - 1, c(y1) - 1, c(z1) - 1, block);
  }

  /** Laje de 0,5 m logo abaixo do piso `y` (o piso fica em `y`). */
  slab(x0: number, z0: number, x1: number, z1: number, y: number, block: string): void {
    this.box(x0, y - 0.5, z0, x1, y, z1, block);
  }

  /** Porta de 1,0 × 2,0 m na parede de 0,5 m: (x, z) = canto mínimo da abertura, `along` = eixo da parede. */
  door(x: number, z: number, y: number, along: 'x' | 'z'): void {
    this.b.door(c(x), c(y), c(z), along, 1);
  }

  /** Abertura (janela, seteira, portão) sem registro de porta. */
  hole(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    this.box(x0, y0, z0, x1, y1, z1, null);
  }

  /** Corrimão/cerca numa linha (metros), altura em metros. */
  fence(x0: number, z0: number, x1: number, z1: number, y: number, block: string, height = 1): void {
    const ax = c(x0);
    const az = c(z0);
    const bx = x0 === x1 ? ax : c(x1) - 1;
    const bz = z0 === z1 ? az : c(z1) - 1;
    this.b.fence(ax, c(y), az, bx, bz, block, c(height));
  }

  ramp(x0: number, z0: number, x1: number, z1: number, y: number, dir: RampDir, slope: '1:1' | '1:2'): void {
    this.b.ramp(c(x0), c(y), c(z0), c(x1) - 1, c(z1) - 1, CONCRETE, dir, slope);
  }

  stairs(x0: number, z0: number, x1: number, z1: number, y: number, dir: RampDir): void {
    this.b.stairs(c(x0), c(y), c(z0), c(x1) - 1, c(z1) - 1, CONCRETE, dir);
  }

  /** Pilha de caixotes de `h` metros (cobertura baixa = 1, alta = 2). */
  crates(x: number, z: number, w: number, d: number, h: number): void {
    this.box(x, G, z, x + w, G + h, z + d, 'crate');
  }

  /** Bloco de cobertura (concreto por padrão). */
  cover(x: number, z: number, w: number, d: number, h: number, block = 'concrete'): void {
    this.box(x, G, z, x + w, G + h, z + d, block);
  }

  /**
   * Parede de setor ao longo de X (em z) ou de Z (em x), de `from` a `to`, com passagens [a, b) abertas. Parede de
   * teste com réguas embaixo e concreto em cima.
   */
  sectorWall(
    axis: 'x' | 'z',
    at: number,
    from: number,
    to: number,
    gaps: readonly (readonly [number, number])[],
  ): void {
    let start = from;
    const pieces: [number, number][] = [];
    for (const [a, b] of [...gaps].sort((p, q) => p[0] - q[0])) {
      if (a > start) pieces.push([start, a]);
      start = Math.max(start, b);
    }
    if (start < to) pieces.push([start, to]);
    for (const [a, b] of pieces) {
      if (axis === 'x') {
        this.box(a, G, at, b, G + 2, at + 0.5, 'test-wall');
        this.box(a, G + 2, at, b, SECTOR_WALL_TOP, at + 0.5, 'concrete');
      } else {
        this.box(at, G, a, at + 0.5, G + 2, b, 'test-wall');
        this.box(at, G + 2, a, at + 0.5, SECTOR_WALL_TOP, b, 'concrete');
      }
    }
  }

  spawn(x: number, z: number, team: number, y = G, lookX = 40, lookZ = 40): void {
    this.b.spawn({ x, y, z, yaw: yawTo(x, z, lookX, lookZ), team });
  }

  camera(name: string, x: number, y: number, z: number, tx: number, ty: number, tz: number, fov = 0): void {
    this.b.camera({ name, x, y, z, yaw: yawTo(x, z, tx, tz), pitch: pitchTo(x, y, z, tx, ty, tz), fovYDeg: fov });
  }
}

// --- Chão, perímetro, borda e bancada ---

function ground(k: Kit): void {
  // Base de terra, grama na borda e placas de teste na área jogável.
  k.box(0, 0, 0, 80, 0.5, 80, 'dirt');
  k.box(0, 0.5, 0, 80, G, 80, 'grass');
  k.box(4, 0.5, 4, 76, G, 76, 'test-floor');
  // Faixas amarelas de circulação ao longo das 3 rotas (oeste, centro e leste) e do anel do meio.
  for (const x of [12, 40, 64]) k.box(x, 0.5, 6, x + 0.5, G, 74, 'test-floor-stripe');
  for (const z of [30, 50]) k.box(6, 0.5, z, 74, G, z + 0.5, 'test-floor-stripe');
  // A cada 4 m, um bloco com o número do setor (3×3 de 24 m a partir de x, z = 4; 1 = noroeste, 9 = sudeste).
  for (let x = 8; x < 76; x += 4)
    for (let z = 8; z < 76; z += 4) k.box(x, 0.5, z, x + 0.5, G, z + 0.5, sectorMarker(x, z));
}

/** Bloco com o número do setor da posição (x, z) em metros. */
function sectorMarker(x: number, z: number): string {
  const col = Math.min(2, Math.floor((x - 4) / 24));
  const row = Math.min(2, Math.floor((z - 4) / 24));
  return `sector-marker-${row * 3 + col + 1}`;
}

function perimeter(k: Kit): void {
  const top = G + 4;
  // Norte, leste e oeste (até o galpão): paredes de teste de 4 m.
  k.box(4, G, 4, 76, top, 4.5, 'test-wall');
  k.box(75.5, G, 4, 76, top, 76, 'test-wall');
  k.box(4, G, 4, 4.5, top, 52, 'test-wall');
  // Sul a partir da vitrine.
  k.box(36, G, 75.5, 76, top, 76, 'test-wall');
  // Sul da vitrine: mureta + cerca de tela de 2 m (dá para ver a bancada de materiais lá fora).
  k.box(22, G, 75.5, 36, G + 0.5, 76, 'concrete');
  k.b.panel(c(22), c(G + 0.5), c(75.5), c(36) - 1, c(G + 2.5) - 1, c(75.5), 'fence-wire');
}

/** Borda de grama: mato em cruz, árvores de bloco e a pista de leitura (estrada de terra no norte). */
function border(k: Kit): void {
  const b = k.b;
  // Estrada de terra de 3 m (z 1 a 4) colada no perímetro, com uma SEBE de folhas de 1,5 m no limite norte da grade
  // (z 0 a 1): no print de leitura, o lado esquerdo do quadro é sebe, não o fim do mundo (verificação do M1). Baixa de
  // propósito: o sol vem do noroeste e a sombra dela só pega a beira da estrada.
  k.box(0, 0.5, 1, 80, G, 4, 'dirt');
  k.box(0, G, 0, 80, G + 1.5, 1, 'leaves');
  const rng = b.rng('borda');
  const inBorder = (x: number, z: number): boolean => x < 4 || x >= 76 || z < 4 || z >= 76;
  const onRoad = (z: number): boolean => z < 4;
  const nearBench = (x: number, z: number): boolean => x >= 21 && x < 37 && z >= 76;
  // Árvores de bloco: tronco de 3 m e copa de 2,5 × 1,5 × 2,5 m, espaçadas na borda (fora da pista e da bancada).
  const trees: [number, number][] = [];
  for (let t = 0; t < 400 && trees.length < 22; t++) {
    const x = Math.floor(rng.range(0, 80)) + 0.5;
    const z = Math.floor(rng.range(0, 80)) + 0.5;
    if (!inBorder(x, z) || onRoad(z) || z < 4.5 || nearBench(x, z)) continue;
    if (x < 1.5 || z < 1.5 || x > 78.5 || z > 78.5 || (x >= 2.5 && x < 77.5 && z >= 2.5 && z < 77.5)) continue;
    if (trees.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < 6)) continue;
    trees.push([x, z]);
    k.box(x - 0.5, G, z - 0.5, x, G + 3, z, 'log');
    k.box(x - 1.5, G + 2.5, z - 1.5, x + 1, G + 4, z + 1, 'leaves');
    k.box(x - 0.5, G + 2.5, z - 0.5, x, G + 4, z, 'log');
  }
  for (let x = 0; x < 160; x++) {
    for (let z = 0; z < 160; z++) {
      const mx = x / 2;
      const mz = z / 2;
      if (!inBorder(mx, mz) || onRoad(mz) || nearBench(mx, mz)) continue;
      const r = rng.next();
      if (r < 0.28) b.cross(x, c(G), z, 'tall-grass');
      else if (r < 0.33) b.cross(x, c(G), z, 'flowers');
      else if (r < 0.37) b.cross(x, c(G), z, 'bush');
    }
  }
}

/** Bancada de materiais (fora da área jogável): vidro, vidro fino e água rasa, só para prints e medição. */
function materialBench(k: Kit): void {
  k.box(23.5, 0.5, 76.5, 30, G + 0.5, 79.5, 'concrete');
  k.box(24, 0.5, 77, 29.5, G + 0.5, 79, 'water');
  k.box(31, G, 77, 35, G + 2, 77.5, 'glass');
  k.b.panel(c(31), c(G), c(78.5), c(35) - 1, c(G + 2) - 1, c(78.5), 'glass-pane');
}

/**
 * Muro da régua de 1,5 m. Com a altura A ele tapava o olho e deixava a cabeça à mostra ("visto sem ver", #53); com a B
 * (#55) o olho (1,55 m) passa por cima e ele vira a cobertura em que só a cabeça aparece.
 */
const RULER_WALL = 1.5;

/**
 * Área da régua de métricas (metros, [min, max)): faixa ao sul do perímetro (z ≥ 76), a leste da bancada (x ≤ 35) e
 * a oeste da árvore mais perto da borda (copa a partir de x = 58). `plane` = z das faces da frente das paredes e da
 * face de fora da cabeça dos manequins (de perfil, o que a câmera vê mais perto).
 * Exportada para o teste do `mapc` conferir que ela fica fora da área jogável e fora dos quadros dos outros prints.
 */
export const HEIGHT_RULER = { minX: 40, maxX: 49, minZ: 76, maxZ: 80, plane: 78.5 } as const;

/**
 * Régua de métricas (decisão #53, câmera `print:altura`), FORA da área jogável: na faixa ao sul do perímetro, a leste
 * da bancada e longe das árvores da borda (a mais perto fica em x = 58). No quadro (a câmera olha para o sul), da
 * esquerda para a direita: batente com o vão da porta do jogo (`doorWidth` × `doorHeight`), manequim em pé ao lado
 * dele virado para o muro de 1,5 m, a cobertura baixa (`coverLow`), o manequim agachado atrás dela, virado para ela, e
 * o manequim deslizando (o "carrinho" do boneco do FutBobo, PLANO do porte §B16) logo atrás do agachado, de costas
 * para ele: a nuca perto das costas do agachado e a perna esticada para a borda do quadro (virado para a cobertura, os
 * ombros e os braços, mais perto da câmera, sairiam do quadro).
 * As faces da frente das paredes e a face de fora da cabeça e do tronco dos manequins ficam no mesmo plano (z = 78,5):
 * o topo que a câmera vê é a aresta mais perto dela, então as alturas no plano se comparam sem distorção. A câmera de
 * perfil fica na altura da cobertura, sem pitch: o topo da cobertura cai na linha do horizonte.
 * Fundo: parede lisa de concreto colada no fim da grade (1 m atrás do plano), alta o bastante para fechar o quadro.
 * Lisa de propósito: marcas de altura lá atrás ficariam 1 m mais longe e a paralaxe faria os bobos parecerem mais altos;
 * as marcas de 12,5/25/50 cm ficam na própria cobertura, no plano.
 * Os manequins `altura:*` são só de print (o jogo só os desenha com a câmera `print:altura`).
 */
function heightRuler(k: Kit): void {
  const b = k.b;
  const { minX: x0, maxX: x1, minZ: z0, maxZ: z1, plane } = HEIGHT_RULER;
  // Piso de teste no lugar da grama (mesma altura) e sem mato em cruz; fundo de 4 m.
  k.box(x0, 0.5, z0, x1, G, z1 - 0.5, 'test-floor');
  k.box(x0, G, z0, x1, G + 0.5, z1 - 0.5, null);
  k.box(x0, G, z1 - 0.5, x1, G + 4, z1, 'concrete');
  // Cobertura baixa e muro de 1,5 m colados (degrau de 1,0 → 1,5 m), 0,5 m de espessura cada. A cobertura é de parede
  // de teste: as marcas de 12,5/25/50 cm ficam NO plano (régua sem paralaxe) e o painel claro se separa do fundo.
  const cover = 43.5;
  k.box(cover, G, plane, cover + 0.5, G + METRICS.coverLow, plane + 0.5, 'test-wall');
  k.box(cover + 0.5, G, plane, cover + 1, G + RULER_WALL, plane + 0.5, 'brick');
  // Batente de tábua com o vão da porta (o mesmo das portas do jogo, alinhado à grade de 1 m).
  const door = cover + 2.5;
  k.box(door - 0.5, G, plane, door + METRICS.doorWidth + 0.5, G + METRICS.doorHeight + 0.5, plane + 0.5, 'plank');
  k.hole(door, G, plane, door + METRICS.doorWidth, G + METRICS.doorHeight, plane + 0.5);
  // Manequins de perfil, encostados como um jogador encostaria: a caixa de 0,6 m toca a parede (de perfil, o boneco em
  // pé vai a ±0,219 m do centro e o agachado P4f a ±0,286 m). A face de fora da cabeça (meia aresta de 0,219 m, sem
  // camada externa) fica no plano; o tronco tem a mesma meia largura.
  const stand = cover + 1 + METRICS.aabbWidth / 2;
  const crouch = cover - METRICS.aabbWidth / 2;
  // O deslize vai de −0,653 (nuca) a +0,654 m (sola da perna esticada) ao longo do olhar, com o `bodyZ` do FIGURE. A
  // 0,97 m do agachado (0,286 das costas dele + 3 cm + 0,653), olhando para −X: a nuca fica 3 cm atrás das costas do
  // agachado e a sola em x = 41,576.
  const slide = crouch - 0.97;
  const mz = plane + FIGURE_HEAD_HALF_M;
  const mannequin = (name: string, x: number, lookX: number, pose: 'stand' | 'crouch' | 'slide'): void =>
    b.mannequin({
      name,
      x,
      y: G,
      z: mz,
      yaw: yawTo(x, mz, lookX, mz),
      look: 'recruit',
      team: -1,
      zombie: false,
      pose,
      weapon: '',
    });
  mannequin('altura:em-pe', stand, cover, 'stand');
  mannequin('altura:agachado', crouch, cover + 1, 'crouch');
  mannequin('altura:deslizando', slide, slide - 1, 'slide');
  // Câmera de perfil colada na face sul do perímetro, a 2,25 m do plano. FOV vertical fixo de 74° (horizontal de 106°
  // em 16:9; era 64° antes do deslize, que pede 1,3 m a mais de fileira): o quadro é o mesmo em qualquer perfil de
  // plataforma. Em 16:9 ele vai, no plano, de x = 41,49 (9 cm além da sola do deslize) a 47,51 (o batente esquerdo
  // inteiro) e até 2,7 m acima do piso: a porta entra inteira, com o topo do batente; no fundo (3,25 m da câmera) vai
  // de x = 40,15 a 48,85 e até 3,45 m acima do piso, dentro da parede de fundo. A régua andou 1 m para leste (x 40–49)
  // para o fundo cobrir o quadro sem passar de x = 40: a oeste dele fica um nó de navegação (fora da área jogável) que
  // a parede apagaria.
  const camX = 44.5;
  const camY = G + METRICS.coverLow;
  const camZ = z0 + 0.25;
  k.camera('print:altura', camX, camY, camZ, camX, camY, plane, 74);
  // Régua a 45° (`print:altura-45`, opcional; decisão 6 da §I do PLANO do porte): mesma altura, mesmo FOV e pitch 0 (o
  // topo da cobertura continua no horizonte), girada 45° no yaw. Fica a LESTE, no mesmo z da de perfil, com o
  // agachado no centro do quadro: ele aparece de frente a 3/4, com a cobertura tapando a metade de trás (como o vê
  // quem está do outro lado dela), e o em pé e o deslizando de costas a 3/4. A oeste, o muro de 1,5 m tapava metade do
  // em pé, e o deslizando, um terço do agachado. As 3 cabeças ficam à vista.
  const depth = mz - camZ;
  k.camera('print:altura-45', crouch + depth, camY, camZ, crouch, camY, mz, 74);
}

// --- Paredes entre setores ---

function sectorWalls(k: Kit): void {
  // Norte | meio (z = 27,5): passagens na rota oeste, duas no centro e uma no leste.
  k.sectorWall('x', 27.5, 4.5, 75.5, [
    [10, 14],
    [30, 34],
    [46, 50],
    [62, 66],
  ]);
  // Meio | sul (z = 52), do pátio da vitrine ao leste: passagem do centro (pé da rampa da torre) e do leste.
  k.sectorWall('x', 52, 36.5, 75.5, [
    [40, 44],
    [54, 58],
  ]);
  // Oeste | centro (x = 27,5) até o pátio da vitrine; centro | leste (x = 52) do norte ao sul.
  k.sectorWall('z', 27.5, 4.5, 43.5, [
    [14, 18],
    [39.5, 43.5],
  ]);
  k.sectorWall('z', 52, 4.5, 75.5, [
    [8, 12],
    [28, 32],
    [42, 50],
    [66, 70],
  ]);
  // Pátio da vitrine: norte (z = 43,5) e leste (x = 36).
  k.sectorWall('x', 43.5, 4.5, 36.5, [[8, 12]]);
  k.sectorWall('z', 36, 44, 75.5, [[56, 60]]);
  // Anteparo alto na frente da passagem da vitrine (a linha de visão não atravessa o sul inteiro).
  k.sectorWall('z', 38.5, 54, 62, []);
}

// --- Prédios ---

/** Prédio de Teste 1 (NO): 2 andares, escada interna, dois cômodos no térreo. */
function testBuilding1(k: Kit): void {
  const [x0, z0, x1, z1] = [8, 8, 22, 20];
  k.shell(x0, z0, x1, z1, G, F3, 'concrete');
  k.shell(x0, z0, x1, z1, G, G + 1, 'test-wall');
  k.slab(x0 + 0.5, z0 + 0.5, x1 - 0.5, z1 - 0.5, F2, 'concrete');
  k.slab(x0, z0, x1, z1, F3, 'concrete');
  // Escada de 2,5 m de largura subindo para +X junto à parede norte; vão na laje em cima.
  k.stairs(12, 8.5, 15, 11, G, '+x');
  k.hole(11, F2 - 0.5, 8.5, 14.5, F2, 11);
  k.fence(11, 11, 15, 11, F2, 'railing');
  // Parede interna de tijolo no térreo (cômodo norte com a escada e cômodo sul) com porta.
  k.box(8.5, G, 13, 21.5, F2 - 0.5, 13.5, 'brick');
  k.door(18, 13, G, 'x');
  // Portas: sul, leste e oeste no térreo; janela do 1º andar para o sul (a parede do setor fica a 8 m).
  k.door(12, 19.5, G, 'x');
  k.door(21.5, 11, G, 'z');
  k.door(8, 17, G, 'z');
  k.hole(15, F2 + 0.5, 19.5, 17, F2 + 2, 20);
  k.box(17, F2 - 1, 16, 17.5, F2 - 0.5, 16.5, 'lamp');
  k.box(10, F3 - 1, 16, 10.5, F3 - 0.5, 16.5, 'lamp');
}

/** Prédio de Teste 2 (NE): térreo com 2 portas e janelas baixas; caixa d'água ao lado. */
function testBuilding2(k: Kit): void {
  const [x0, z0, x1, z1] = [58, 8, 72, 18];
  k.shell(x0, z0, x1, z1, G, G + 4, 'concrete');
  k.shell(x0, z0, x1, z1, G, G + 1, 'test-wall');
  k.slab(x0, z0, x1, z1, G + 4.5, 'concrete');
  k.door(58, 12, G, 'z');
  k.door(64, 17.5, G, 'x');
  k.hole(61, G + 1, 17.5, 63, G + 2, 18);
  k.box(64, G + 3, 12, 64.5, G + 3.5, 12.5, 'lamp');
  k.crates(69.5, 8.5, 2, 1, 2);
  k.b.prop('water-tank', 73.5, G, 22.5, 0, 1, 1);
}

/** Torre de 8 m no centro: sala embaixo, cabine com seteiras no topo (9 m), rampa 1:2 e escada pelo leste. */
function tower(k: Kit): void {
  const [x0, z0, x1, z1] = [36, 36, 42, 42];
  const top = G + 8;
  // Sala do térreo (paredes até a laje do topo) com portas norte e sul.
  k.shell(x0, z0, x1, z1, G, top - 0.5, 'concrete');
  k.shell(x0, z0, x1, z1, G, G + 1, 'test-wall');
  k.door(38, 36, G, 'x');
  k.door(36, 39, G, 'z');
  // Contraforte alto ao sul da torre (fecha o corredor entre a torre e o pátio da vitrine para a linha de visão).
  k.box(36, G, 42, 42, G + 2, 43.5, 'test-wall');
  k.box(36, G + 2, 42, 42, SECTOR_WALL_TOP, 43.5, 'concrete');
  k.box(39, top - 1.5, 39, 39.5, top - 1, 39.5, 'lamp');
  // Laje do topo, cabine de 2 m com seteiras de 1,0 a 2,0 m (o olho, a 1,55 m, fica no vão; #55) e teto de painel.
  k.slab(x0, z0, x1, z1, top, 'concrete');
  k.shell(x0, z0, x1, z1, top, top + 2, 'concrete');
  k.slab(x0, z0, x1, z1, top + 2.5, 'metal-panel');
  k.hole(38, top + 1, 36, 40, top + 2, 36.5); // seteira norte
  k.hole(36, top + 1, 38, 36.5, top + 2, 40); // oeste
  k.hole(38, top + 1, 41.5, 40, top + 2, 42); // sul
  k.door(41.5, 38, top, 'z'); // entrada leste
  // Acesso: rampa 1:2 (1,0 → 4,0 m), patamar A, escada (4,0 → 9,0 m) e patamar C no topo.
  k.ramp(42, 46, 44, 52, G, '-z', '1:2');
  k.box(42, G, 44, 46, F2 - 0.5, 46, 'concrete');
  k.slab(42, 44, 46, 46, F2, 'concrete');
  k.box(44, G, 39, 46, F2, 44, 'concrete');
  k.stairs(44, 39, 46, 44, F2, '-z');
  k.slab(42, 37, 46, 39, top, 'concrete');
  k.box(45.5, G, 37, 46, top - 0.5, 37.5, 'concrete');
  k.fence(42, 37, 46, 37, top, 'railing');
  k.fence(45.5, 37.5, 45.5, 39, top, 'railing');
  k.fence(42, 44, 42, 46, F2, 'railing');
  k.b.prop('column', 42.75, G, 37.75, 0, 1, 0);
}

/** Galpão (SO, cena-vitrine): fechado, 6 m de pé-direito, mezanino de grade, portão leste e porta norte. */
function shed(k: Kit): void {
  const [x0, z0, x1, z1] = [4, 52, 22, 76];
  const top = G + 6;
  k.shell(x0, z0, x1, z1, G, top, 'metal-panel');
  k.shell(x0, z0, x1, z1, G, G + 1, 'test-wall');
  k.slab(x0, z0, x1, z1, top + 0.5, 'metal-panel');
  // Cumeeira baixa no telhado (só visual, sem acesso), ao longo de Z, com as quinas nas pontas.
  k.b.box(c(12.5), c(top + 0.5), c(z0 + 0.5), c(13) - 1, c(top + 0.5), c(z1 - 0.5) - 1, 'metal-roof-ramp', 3);
  k.b.box(c(13), c(top + 0.5), c(z0 + 0.5), c(13.5) - 1, c(top + 0.5), c(z1 - 0.5) - 1, 'metal-roof-ramp', 1);
  k.b.set(c(12.5), c(top + 0.5), c(z0), 'metal-roof-ramp-corner-out', 3);
  k.b.set(c(13), c(top + 0.5), c(z0), 'metal-roof-ramp-corner-out', 0);
  k.b.set(c(12.5), c(top + 0.5), c(z1 - 0.5), 'metal-roof-ramp-corner-out', 2);
  k.b.set(c(13), c(top + 0.5), c(z1 - 0.5), 'metal-roof-ramp-corner-out', 1);
  // Portão leste de 6 × 3 m (baixo de propósito: quem está na escada da torre não enxerga o fundo do galpão) e
  // porta norte.
  k.hole(21.5, G, 58, 22, G + 3, 64);
  k.door(18, 52, G, 'x');
  // Mezanino de grade a 4 m ao longo da parede oeste, com escada e corrimão.
  k.slab(4.5, 52.5, 10, 75.5, F2, 'grate-slab');
  k.fence(9.5, 52.5, 9.5, 66, F2, 'railing');
  k.fence(9.5, 68, 9.5, 75.5, F2, 'railing');
  k.stairs(10, 66, 13, 68, G, '-x');
  // Divisória de caixotes no fundo (esconde quem nasce debaixo do mezanino).
  k.crates(10, 69, 1, 6.5, 2);
  // Luminárias no teto e painéis luminosos nas paredes (emissivos do interior).
  for (const z of [56, 62, 68, 74]) k.box(15, top - 0.5, z, 15.5, top, z + 0.5, 'lamp');
  for (const z of [55, 66, 73]) k.box(21.5, G + 2, z, 22, G + 3, z + 1, 'light-panel');
  k.box(4, F2 + 1, 60, 4.5, F2 + 2, 62, 'light-panel');
  // Painéis baixos embutidos nas paredes oeste (debaixo do mezanino), sul e norte: sem eles o fundo do galpão ficava
  // em luz 0 (preto puro no Dia; verificação do M1). Só trocam bloco de parede por bloco de parede: colisão igual.
  for (const z of [56, 64, 71]) k.box(x0, G + 1.5, z, x0 + 0.5, G + 2.5, z + 1, 'light-panel');
  for (const x of [7, 13, 18]) k.box(x, G + 1.5, z1 - 0.5, x + 1, G + 2.5, z1, 'light-panel');
  for (const x of [8, 13]) k.box(x, G + 1.5, z0, x + 1, G + 2.5, z0 + 0.5, 'light-panel');
  // [PROPOSTA] Faixa luminosa no piso, no corredor do meio (troca placa por painel no próprio piso: colisão igual). As
  // luminárias do teto (a 6,5 m) só chegam ao chão com 4 de 15; a faixa acende o miolo que as paredes não alcançam.
  k.box(12.5, 0.5, 54.5, 13, G, 75.5, 'light-panel');
  // Caixotes, bancada de tábuas e barris dentro.
  k.crates(14, 70, 2, 2, 2);
  k.crates(16, 70, 1, 2, 1);
  k.crates(13, 57, 2, 1, 1);
  k.crates(16, 64, 2, 2, 2);
  k.box(12, G, 53, 15, G + 0.5, 54, 'plank-slab');
  k.b.prop('barrel', 19.5, G, 73.5, 0.3, 1, 1);
  k.b.prop('barrel', 20.5, G, 73.2, 1.2, 1, 1);
  k.b.prop('generator', 19, G, 68.5, PI / 2, 1, 1);
}

/** Pátio da vitrine (metade exterior): grama, rampa 1:2 até uma plataforma, cerca, tijolo, props e manequins. */
function vitrineYard(k: Kit): void {
  const b = k.b;
  // Canteiro de grama com mato em cruz e árvore low-poly.
  k.box(30, 0.5, 68, 35.5, G, 75.5, 'grass');
  const rng = b.rng('vitrine');
  for (let x = c(30); x < c(35); x++) {
    for (let z = c(68.5); z < c(75); z++) {
      const r = rng.next();
      if (r < 0.35) b.cross(x, c(G), z, 'tall-grass');
      else if (r < 0.42) b.cross(x, c(G), z, 'flowers');
      else if (r < 0.45) b.cross(x, c(G), z, 'bush');
    }
  }
  b.prop('tree', 33, G, 72, 0.4, 1, 1);
  // Plataforma de 1,5 m com rampa 1:2, laje de borda e cerca de tela.
  k.box(26, G, 46, 32, G + 1.5, 50, 'concrete');
  k.ramp(32, 46, 35, 48, G, '-x', '1:2');
  k.box(26, G + 1.5, 49.5, 32, G + 2, 50, 'concrete-slab');
  k.fence(26, 46, 32, 46, G + 1.5, 'fence-wire');
  // Muro de tijolo (parede do print de densidade) e mureta de tábua.
  k.box(28, G, 67.5, 33, G + 2.5, 68, 'brick');
  k.box(23, G, 50, 25, G + 1, 51, 'plank');
  // Cerca de madeira fechando o canteiro.
  k.fence(29.5, 68, 29.5, 75.5, G, 'fence-wood');
  // Props: jipe, lona, canos, barris, sacos de areia, holofote, gerador, coluna e caixa d'água.
  b.prop('jeep', 25.5, G, 69.5, PI / 2, 1, 1);
  b.prop('tarp', 33.5, G, 57, 0, 1, 1);
  b.prop('pipe', 24.5, G, 73.2, PI / 2, 1, 1);
  b.prop('pipe', 25.2, G, 73.2, PI / 2, 1, 2);
  b.prop('barrel', 24, G, 66, 0, 1, 1);
  b.prop('barrel', 24.8, G, 66.6, 0.7, 1, 1);
  // A 1,3 m da parede do galpão: em 23,9 (0,3 m mais a leste) ilhava o nó em cima do barril de (24,8; 66,6) (#52).
  b.prop('barrel', 23.6, G, 67.4, 1.9, 1, 2);
  b.prop('sandbags', 33, G, 52.5, 0, 1, 1);
  b.prop('sandbags', 30, G, 52.5, 0, 1, 2);
  b.prop('floodlight', 23, G, 56.5, yawTo(23, 56.5, 28, 62), 1, 1);
  b.prop('generator', 23.5, G, 54.2, 0, 1, 2);
  b.prop('column', 25, G, 45, 0, 1, 0);
  b.prop('water-tank', 34, G, 64, 0, 1, 2);
  // Mostruário de formas do catálogo encostado na parede leste do pátio (laje, degrau, rampas 1:1 e 1:2, quinas
  // interna e externa, painel e poste com travessa), para o print e para conferir o mesher.
  const shapes: [string, number][] = [
    ['concrete-slab', 0],
    ['concrete-step', 3],
    ['concrete-ramp', 3],
    ['concrete-ramp-half-low', 3],
    ['concrete-ramp-half-high', 3],
    ['concrete-ramp-corner-in', 3],
    ['concrete-ramp-corner-out', 3],
    ['concrete', 0],
    ['fence-wire', 1],
    ['railing', 1],
    ['fence-wood', 1],
  ];
  shapes.forEach(([block, rot], i) => b.set(c(35.5), c(G), c(61) + i, block, rot));
  // Painel luminoso na fachada do galpão, EMBUTIDO na parede acima do portão (o de antes sobrava 0,5 m para fora).
  k.box(21.5, G + 3.5, 60, 22, G + 4.5, 62, 'light-panel');
  // Os 6 manequins em arco na frente do portão, olhando a câmera do print:dia.
  const cam = { x: 34, z: 50 };
  const looks: [string, number, boolean, string][] = [
    ['recruit', -1, false, 'rifle'],
    ['mechanic', -1, false, 'pistol'],
    ['pilot', -1, false, 'sniper'],
    ['recruit', 0, false, 'rifle'],
    ['recruit', 1, false, 'rifle'],
    ['zombie', -1, true, ''],
  ];
  looks.forEach(([look, team, zombie, weapon], i) => {
    const x = 25 + i * 1.2;
    const z = 61 + Math.abs(i - 2.5) * 0.6;
    b.mannequin({
      name: `vitrine:${i + 1}`,
      x,
      y: G,
      z,
      yaw: yawTo(x, z, cam.x, cam.z),
      look,
      team,
      zombie,
      // O zumbi fica em pé (curvado, braços à frente: arte-ux.md §2.8); o agachado é de um bobo comum (§2.1).
      pose: i === 2 ? 'aim' : i === 1 ? 'crouch' : 'stand',
      weapon,
    });
  });
}

/** Setor oeste: guarita, plataforma de 1 m com rampa 1:1 e pilhas de caixotes. */
function westSector(k: Kit): void {
  // Guarita de 6 × 6 m (porta leste).
  k.shell(16, 32, 22, 38, G, G + 3, 'brick');
  k.slab(16, 32, 22, 38, G + 3.5, 'plank');
  k.door(21.5, 34, G, 'z');
  k.hole(16, G + 1, 34, 16.5, G + 2, 36);
  // Plataforma de 1 m (2 células) com rampa 1:1 e corrimão.
  k.box(6, G, 38, 14, G + 1, 42, 'concrete');
  k.ramp(9, 42, 12, 43, G, '-z', '1:1');
  k.fence(6, 38, 14, 38, G + 1, 'railing');
  // Caixotes e coberturas.
  k.crates(6, 30, 2, 2, 2);
  k.crates(8, 30, 1, 2, 1);
  k.crates(20, 40, 2, 1, 1);
  k.cover(12, 32, 1, 3, 2);
  k.b.prop('barrel', 24.5, G, 31.5, 0.5, 1, 1);
  k.b.prop('sandbags', 22, G, 41.5, 0, 1, 1);
  k.b.prop('floodlight', 5.5, G, 28.5, yawTo(5.5, 28.5, 20, 40), 1, 1);
}

/** Setor norte: abrigo do time B (telhado baixo), ponto A e coberturas. */
function northSector(k: Kit): void {
  // Abrigo Norte de 16 × 7,5 m (o time B nasce dentro): paredes laterais fechadas, frente sul aberta com pilares e
  // telhado a 4 m (sem acesso). As laterais cortam as linhas de visão leste-oeste da faixa norte.
  k.box(32, G, 4.5, 32.5, G + 3, 12, 'concrete');
  k.box(47.5, G, 4.5, 48, G + 3, 12, 'concrete');
  k.box(32, G, 4.5, 48, G + 1, 5, 'test-wall');
  k.slab(32, 4.5, 48, 12, G + 3.5, 'metal-panel');
  for (const x of [36, 39.75, 43.5]) k.box(x, G, 11.5, x + 0.5, G + 3, 12, 'concrete');
  k.box(36, G + 2, 6, 36.5, G + 3, 7, 'lamp');
  k.box(43.5, G + 2, 6, 44, G + 3, 7, 'lamp');
  k.cover(30, 16, 3, 1, 1);
  k.cover(46, 14, 1, 3, 2, 'test-wall');
  k.crates(36, 22, 2, 2, 1);
  k.cover(43, 23, 4, 1, 2);
  k.b.prop('sandbags', 38, G, 13, 0, 1, 1);
  k.b.prop('tarp', 49.5, G, 22.5, 0, 1, 1);
  k.b.prop('barrel', 31, G, 10.5, 0, 1, 2);
  // Setor noroeste: coberturas na frente do prédio 1.
  k.cover(24, 22, 1, 3, 2);
  k.crates(14, 23, 2, 2, 1);
  k.b.prop('floodlight', 5.5, G, 5.5, yawTo(5.5, 5.5, 20, 20), 1, 1);
  // Setor nordeste: coberturas.
  k.cover(56, 22, 3, 1, 2, 'test-wall');
  k.crates(68, 22, 2, 1, 1);
}

/** Setor leste: Bloco Leste (2 andares, ligado à torre pela passarela) e paredes de teste em zigue-zague. */
function eastSector(k: Kit): void {
  // Bloco Leste.
  const [x0, z0, x1, z1] = [52, 42, 60, 50];
  k.shell(x0, z0, x1, z1, G, F3, 'brick');
  k.slab(x0 + 0.5, z0 + 0.5, x1 - 0.5, z1 - 0.5, F2, 'concrete');
  k.slab(x0, z0, x1, z1, F3, 'concrete');
  k.stairs(57, 43, 59.5, 46, G, '+z');
  k.hole(57, F2 - 0.5, 43, 59.5, F2, 45.5);
  k.door(54, 49.5, G, 'x');
  k.door(59.5, 46, G, 'z');
  // Passarela de grade a 4 m do patamar A da torre até a porta oeste do 1º andar.
  k.slab(46, 43.5, 52, 46.5, F2, 'grate-slab');
  k.fence(46, 43.5, 52, 43.5, F2, 'railing');
  k.fence(46, 46, 52, 46, F2, 'railing');
  k.door(52, 44, F2, 'z');
  k.b.prop('column', 49, G, 45, 0, 0.8125, 0);
  // Paredes de teste em zigue-zague e coberturas.
  k.box(58, G, 30, 59, G + 3, 38, 'test-wall');
  k.box(64, G, 36, 72, G + 3, 37, 'test-wall');
  k.box(62, G, 42, 63, G + 3, 50, 'test-wall');
  k.box(68, G, 44, 75.5, G + 3, 45, 'test-wall');
  k.cover(66, 30, 2, 1, 1);
  k.crates(70, 40, 1, 2, 1);
  k.crates(65, 48, 2, 2, 1);
  k.b.prop('jeep', 70, G, 49, PI / 2 + 0.2, 1, 1);
  k.b.prop('sandbags', 55, G, 35, PI / 2, 1, 1);
}

/** Setor centro (em volta da torre): coberturas. */
function centerSector(k: Kit): void {
  k.cover(30, 32, 2, 1, 2);
  k.crates(31, 40, 1, 2, 1);
  k.cover(46, 31, 4, 1, 2, 'test-wall');
  k.b.prop('barrel', 34.5, G, 41.5, 0, 1, 1);
  k.b.prop('barrel', 35.2, G, 42.1, 0.6, 1, 2);
}

/** Setor sul: o time A nasce aqui (abrigo baixo) e o ponto B. */
function southSector(k: Kit): void {
  k.slab(40, 70.5, 50, 75.5, G + 3.5, 'metal-panel');
  for (const x of [40, 49.5]) k.box(x, G, 70.5, x + 0.5, G + 3, 71, 'concrete');
  k.cover(38, 56, 1, 4, 2);
  k.crates(46, 58, 2, 1, 1);
  k.cover(42, 64, 4, 1, 2, 'test-wall');
  k.b.prop('sandbags', 47, G, 66.5, 0, 1, 1);
  k.b.prop('floodlight', 51, G, 74.5, yawTo(51, 74.5, 40, 60), 1, 1);
}

/** Prédio de Teste 3 (SE): 2 andares. */
function testBuilding3(k: Kit): void {
  const [x0, z0, x1, z1] = [58, 58, 72, 72];
  k.shell(x0, z0, x1, z1, G, F3, 'concrete');
  k.shell(x0, z0, x1, z1, G, G + 1, 'test-wall');
  k.slab(x0 + 0.5, z0 + 0.5, x1 - 0.5, z1 - 0.5, F2, 'concrete');
  k.slab(x0, z0, x1, z1, F3, 'concrete');
  k.stairs(68, 61, 70, 64, G, '-z');
  k.hole(68, F2 - 0.5, 61.5, 70, F2, 64);
  k.fence(67.5, 61.5, 67.5, 64, F2, 'railing');
  k.fence(68, 64, 70, 64, F2, 'railing');
  k.box(58.5, G, 64, 67.5, F2 - 0.5, 64.5, 'brick');
  k.door(62, 64, G, 'x');
  k.door(58, 60, G, 'z');
  k.door(58, 68, G, 'z');
  k.door(64, 58, G, 'x');
  k.box(65, F2 - 1, 68, 65.5, F2 - 0.5, 68.5, 'lamp');
  k.cover(54, 70, 1, 3, 2);
  k.crates(73, 56, 1, 2, 1);
}

/** Pontos de Domination (M6+, já marcados): anel de painéis luminosos no chão. */
function domination(k: Kit): void {
  const points: [string, number, number][] = [
    ['a', 40, 18],
    ['b', 46, 60],
    ['c', 16, 47],
  ];
  for (const [id, x, z] of points) {
    k.b.domination({ id, x, y: G, z, radius: 3 });
    for (let a = 0; a < 16; a++) {
      const t = (a / 16) * PI * 2;
      const px = Math.floor((x + Math.cos(t) * 3) * 2) / 2;
      const pz = Math.floor((z + Math.sin(t) * 3) * 2) / 2;
      const under = k.b.get(c(px), c(G) - 1, c(pz));
      if (k.b.get(c(px), c(G), c(pz)) === null && (under === 'test-floor' || under?.startsWith('sector-marker-'))) {
        k.box(px, 0.5, pz, px + 0.5, G, pz + 0.5, 'light-panel');
      }
    }
  }
}

function spawns(k: Kit): void {
  // Time B (1) embaixo do abrigo norte; time A (0) embaixo do abrigo sul.
  for (const [x, z] of [
    [34.5, 6.5],
    [37.5, 7.5],
    [41.5, 6.5],
    [44.5, 7.5],
    [36.5, 5.5],
    [43.5, 5.5],
  ] as const)
    k.spawn(x, z, 1);
  for (const [x, z] of [
    [41.5, 73.5],
    [44.5, 72.5],
    [47.5, 73.5],
    [43.5, 74.5],
    [46.5, 74.5],
    [48.5, 72.5],
  ] as const)
    k.spawn(x, z, 0);
  // FFA (-1): 16 pontos, um por cômodo ou canto escondido.
  const ffa: [number, number, number?][] = [
    [10.5, 11.5],
    [19.5, 17.5],
    [10.5, 17.5, F2],
    [70.5, 11.5],
    [38.5, 38.5],
    [60.5, 70.5],
    [69.5, 69.5, F2],
    [6.5, 72.5],
    [56.5, 48.5, F2],
    [18.5, 61.5],
    [60.5, 33.5],
    [55.5, 47.5],
    [18.5, 35.5],
    [60.5, 24.5],
    [24.5, 6.5],
    [74.5, 54.5],
  ];
  for (const [x, z, y] of ffa) k.spawn(x, z, -1, y ?? G);
}

function printMarkers(k: Kit): void {
  const b = k.b;
  // Print 1 (Dia/Entardecer/Noite) e fontes: a vitrine vista de dentro do pátio, com o portão do galpão.
  k.camera('print:dia', 34, G + 3.2, 50, 24, G + 1, 62);
  // Print 2: bobo e tijolo NO MESMO PLANO a 1 m e a 3 m (a comparação do pixel só vale à mesma distância). Um
  // contraforte de tijolo sai do muro até z = 66,0, colado no braço direito do manequim (a mão vai a 0,49 m do centro),
  // e a frente da cabeça do manequim (meia aresta `FIGURE_HEAD_HALF_M`) fica no mesmo z = 66,0; as câmeras ficam a 1 m
  // e a 3 m desse plano.
  const plane = 66;
  k.box(31, G, plane, 31.5, G + 2.5, 67.5, 'brick');
  const m1 = { x: 30.5, z: plane + FIGURE_HEAD_HALF_M };
  b.mannequin({
    name: 'densidade',
    x: m1.x,
    y: G,
    z: m1.z,
    yaw: 0,
    look: 'recruit',
    team: -1,
    zombie: false,
    pose: 'stand',
    weapon: '',
  });
  // Câmera entre o rosto e o contraforte (os dois cabem no FOV de 90° a 1 m).
  const camX = 30.75;
  k.camera('print:densidade-1m', camX, G + EYE, plane - 1, camX, G + 0.9, plane + 1.25);
  k.camera('print:densidade-3m', camX, G + EYE, plane - 3, camX, G + 0.9, plane + 1.25);
  closePair(k, plane);
  // Print 3: as doses de props (vista alta do pátio da vitrine).
  k.camera('print:doses', 35, G + 6, 74, 26, G, 58);
  // Print 4: pista de leitura (estrada no norte, fora da área). UM par (time A e time B) no fim da estrada e as 4
  // câmeras a 5, 15, 30 e 50 m dele, na mesma reta: nada fica na frente do par em nenhum print (verificação do M1; o
  // jogo só desenha estes manequins com uma câmera `print:leitura-*`). Atrás do par, a 24 m, a estrada termina numa
  // parede de teste (o fundo médio do mapa); à esquerda, a sebe da borda; à direita, o perímetro.
  const pair = { x: 54, z: 2.8 };
  for (const [suffix, team, dz] of [
    ['a', 0, -0.4],
    ['b', 1, 0.4],
  ] as const) {
    b.mannequin({
      name: `leitura:${suffix}`,
      x: pair.x,
      y: G,
      z: pair.z + dz,
      yaw: yawTo(pair.x, pair.z + dz, pair.x - 1, pair.z + dz),
      look: 'recruit',
      team,
      zombie: false,
      pose: 'stand',
      weapon: 'rifle',
    });
  }
  for (const d of [5, 15, 30, 50]) {
    k.camera(`print:leitura-${d}m`, pair.x - d, G + EYE, pair.z, pair.x, G + 0.9, pair.z);
  }
  k.box(78, G, 1, 78.5, G + 2, 4, 'test-wall');
  k.box(78, G + 2, 1, 78.5, G + 3, 4, 'concrete');
  // Print 5: filtro de mipmap no chão ao longe (rota leste, olhando para o norte, baixa).
  k.camera('print:mip', 74, G + 1.6, 74, 74, G, 46);
  // Print 9: números de setor no chão, na altura do olho, a uns 45° para baixo. Na passagem leste do muro meio | sul
  // (x = 54–58), o 9 da soleira visto do sul (em pé) e o 6 logo ao norte visto do norte (girado 180°): sem marca de
  // lado, os dois saem iguais. E o 4 e o 5 lado a lado na passagem oeste | centro (x = 27,5, z = 39,5–43,5).
  k.camera('print:setores-norte', 56.25, G + EYE, 53.7, 56.25, G, 52.25);
  k.camera('print:setores-sul', 56.25, G + EYE, 46.8, 56.25, G, 48.25);
  k.camera('print:setores-4-5', 26.25, G + EYE, 42.75, 26.25, G, 40.25);
}

/**
 * Close do rosto a 1 m (marcadores OPCIONAIS, PLANO do porte §B16; o par do `retratos/close-rosto-1m` do FutBobo):
 * `close:1` (time A) e `close:5` (time B) de frente, com a frente da cabeça no plano z = 66 do print de densidade e
 * 0,55 m para cada lado do eixo da câmera, como no retrato. A câmera `print:close-1m` é a `print:densidade-1m` (olho,
 * 1 m do plano, mesma mira e FOV do jogo) deslocada 0,85 m para oeste: no eixo dela o `close:1` cairia dentro do
 * contraforte de tijolo (x 31–31,5); assim a mão direita dele fica a 6 cm do tijolo. Na esquerda do quadro (+X olhando
 * +Z) fica o 1, na direita o 5. Ocupam o lugar do `densidade` sem conflito: cada grupo só aparece com a câmera dele.
 */
function closePair(k: Kit, plane: number): void {
  const camX = 29.9;
  for (const [n, team, dx] of [
    [1, 0, 0.55],
    [5, 1, -0.55],
  ] as const) {
    k.b.mannequin({
      name: `close:${n}`,
      x: camX + dx,
      y: G,
      z: plane + FIGURE_HEAD_HALF_M,
      yaw: 0,
      look: 'recruit',
      team,
      zombie: false,
      pose: 'stand',
      weapon: '',
    });
  }
  k.camera('print:close-1m', camX, G + EYE, plane - 1, camX, G + 0.9, plane + 1.25);
}

/**
 * Fila do boneco do FutBobo (marcadores OPCIONAIS, PLANO do porte §B16; grupo `MANNEQUIN_KIND.line`): 8 manequins
 * `linha:1..8` em pé, lado a lado e de frente, para comparar com o `linha-frente` do FutBobo. Encostada por dentro no
 * perímetro leste (fundo de parede de teste de 4 m), no trecho livre entre a parede de setor (face sul em z = 28) e as
 * paredes em zigue-zague (z 36): os manequins olham para o oeste (o sol vem do noroeste e ilumina o rosto), a 1 m da
 * parede, com 0,95 m entre centros (os mesmos números da cópia de teste, para os prints casarem). `linha:1..4` no time
 * A e `linha:5..8` no time B; o visual n vai no manequim n, da esquerda para a direita do quadro. As 4 câmeras
 * `print:linha-*` são a MESMA pose (o giro de 3/4 e de costas e as expressões são do jogo, só nos `linha:*`): a 4 m do
 * plano da frente das cabeças, na altura do centro da cabeça, mirando a meia altura do bobo, FOV vertical de 62°
 * (horizontal de 94° em 16:9: a fila de 7,6 m cabe com folga). Só aparecem com essas câmeras.
 */
function lineup(k: Kit): void {
  const x = 74.5;
  const zc = 32.2;
  const step = 0.95;
  for (let n = 1; n <= 8; n++) {
    const z = zc + (n - 4.5) * step;
    k.b.mannequin({
      name: `linha:${n}`,
      x,
      y: G,
      z,
      yaw: yawTo(x, z, x - 1, z),
      look: 'recruit',
      team: n <= 4 ? 0 : 1,
      zombie: false,
      pose: 'stand',
      weapon: '',
    });
  }
  const front = x - FIGURE_HEAD_HALF_M;
  const camX = front - 4;
  const camY = G + METRICS.bodyHeight - FIGURE_HEAD_HALF_M;
  const aimY = G + METRICS.bodyHeight / 2;
  for (const name of ['print:linha-frente', 'print:linha-3-4', 'print:linha-costas', 'print:linha-expressoes']) {
    k.camera(name, camX, camY, zc, front, aimY, zc, 62);
  }
}

function benchRoutes(k: Kit): void {
  const y = G + EYE + 0.2;
  // Volta de 60 s pela área jogável (passa pelo galpão, pelas passagens entre setores e pelas linhas mais longas).
  const loop: [number, number][] = [
    [44, 66.5],
    [38, 63],
    [37.5, 58],
    [33, 57.5],
    [24, 61],
    [16, 61],
    [8, 65],
    [14, 56],
    [18.5, 53.5],
    [18.5, 50],
    [10, 47],
    [10, 43.5],
    [15, 39],
    [14, 30],
    [12, 26],
    [16, 22],
    [24, 21],
    [26, 16],
    [32, 14],
    [40, 14],
    [49, 13],
    [52, 10],
    [55, 20],
    [64, 24],
    [64, 28],
    [60, 29],
    [55, 30],
    [51, 30],
    [51, 34],
    [50.5, 48],
    [45, 50.5],
    [42, 54],
    [40, 60],
    [40.5, 66],
  ];
  const points = loop.map(([x, z], i) => {
    const [nx, nz] = loop[(i + 1) % loop.length]!;
    return { t: (i * 60) / loop.length, x, y, z, yaw: yawTo(x, z, nx, nz), pitch: 0 };
  });
  points.push({ ...points[0]!, t: 60 });
  k.b.route({ name: 'bench:volta', loop: true, points });
  // Vista de cima da torre: um giro de 32 s pelas seteiras (o pior caso de regiões visíveis).
  const top = G + 8 + EYE;
  const spin = [0, PI / 2, PI, (PI * 3) / 2, PI * 2].map((yaw, i) => ({
    t: i * 8,
    x: 39,
    y: top,
    z: 39,
    yaw,
    pitch: -0.1,
  }));
  k.b.route({ name: 'bench:alto', loop: true, points: spin });
}

const construto: MapScript = {
  id: 'construto',
  build(b) {
    const k = new Kit(b);
    b.size(160, 48, 160);
    b.meta({
      nameKey: 'map.construto.name',
      // M3 (fase 2d): o Bobo Zombies roda aqui enquanto a Base Abandonada não chega.
      modes: ['warfare.tdm', 'warfare.ffa', 'zombies'],
      players: { min: 2, ideal: 12, max: 16 },
      maxSightLineM: 50,
      botCaps: { switch34p: 12 },
    });
    b.playArea(4, 4, 76, 76, G - 10);
    // Sol alto vindo do noroeste (a pista de leitura do norte fica iluminada).
    b.sun(-0.35, 0.8, -0.45, 'day');
    ground(k);
    perimeter(k);
    border(k);
    materialBench(k);
    sectorWalls(k);
    testBuilding1(k);
    testBuilding2(k);
    tower(k);
    shed(k);
    vitrineYard(k);
    westSector(k);
    northSector(k);
    centerSector(k);
    eastSector(k);
    southSector(k);
    testBuilding3(k);
    domination(k);
    spawns(k);
    printMarkers(k);
    heightRuler(k);
    lineup(k);
    benchRoutes(k);
  },
};

export default construto;
