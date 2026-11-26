import type { MapBuilder, MapScript, RampDir, RampFamily } from '../../tools/mapc/src/api.ts';

/**
 * ESTAÇÃO LUNAR (nome provisório, pergunta AK2; M10, fase 4): o mapa do Bobo Chaos (GDD §4.6.4), que também joga TDM,
 * FFA e o Sandbox, com a GRAVIDADE BAIXA DE SÉRIE em todo modo (`meta.gravity` 0,35, a do modificador Lua; pergunta
 * AK3): o pulo sobe ~2,9 m, a queda é lenta e não machuca. Grade de 80×24×80 m (160×48×160 células), área jogável de
 * 72×72 m (x, z de 4 a 76), à noite (o céu escuro com estrelas é o espaço).
 *
 * Simétrico no eixo norte-sul (z ↔ 80 − z): o time 0 nasce no HANGAR SUL, o time 1 no HANGAR NORTE. As 3 rotas:
 * - OESTE (x 4..28): o chão de regolito, a CRATERA no meio (1,5 m de fundo: cobertura natural), afloramentos de rocha,
 *   rochedos de 6 m e o MÓDULO DE POUSO de cada lado (o bloco alto que corta as vistas do pátio, com a cabine oca
 *   embaixo).
 * - MEIO (x 28..52): a ESTAÇÃO, um módulo de 24×28 m e 8 m de pé-direito: as ECLUSAS norte e sul (portas de fora e de
 *   dentro desencontradas) com o VESTÍBULO para fora no pátio (portas dos lados e o anteparo no meio), o ÁTRIO com o
 *   reator no meio e o anel de cima (sacadas sobre as eclusas e passarelas de grade nas paredes oeste e leste, a 4 m,
 *   com 4 rampas), janelas para o céu escuro e o neon ciano.
 * - LESTE (x 52..76): a TORRE DA ANTENA no meio (deque a 3 m com rampa dos dois lados e a sala do rádio embaixo), os
 *   painéis solares (cobertura baixa), o radiador, os tanques e a pilha de carga.
 *
 * Com a gravidade da Lua todo topo até ~2,9 m acima de onde se pisa vira lugar para pular: os telhados ficam altos
 * (a estação a 8,5 m, os hangares a 6,5 m, os vestíbulos a 5,5 m, os módulos de pouso a 6 m) e nada perto deles passa
 * de 3 m, para ninguém subir onde não há rampa (conferido com o "alcance lunar" de local/m10/mapc-moon.ts). O que se
 * alcança só pulando (o topo de uma rocha, da pilha de carga, do duto, do jipe) é atalho, como os do Arcade. Nenhuma
 * reta passa de 50 m, nem do alto desses atalhos (M10, fase 10: o passe de pulos do `mapc` mede a visada de lá; com o
 * olho acima de todas as rochas baixas ela cruzava o mapa, 76 m. Os rochedos de 6 m no lugar das rochas dos 4 cantos,
 * da beira oeste, do meio da rota oeste, da quina do hangar e do lado da estação, o radiador e os muros da frente do
 * hangar de 6 m e o anteparo do vestíbulo de 3,5 m cortam essas retas: medido, 47,3 m, com 208 nós de pulo em 20
 * lugares).
 *
 * Tudo em METROS aqui (múltiplos de 0,5); o builder recebe células. Caixas semiabertas [a, b). Vãos de porta começam
 * em metro inteiro (a grade de navegação é de 1 m).
 */

const c = (m: number): number => Math.round(m * 2);
/** Lado da grade (m). */
const SIZE = 80;
/** Piso do chão de regolito (m): as crateras descem até 1,5 m abaixo dele. */
const G = 2;
const MIN = 4;
const MAX = 76;
/** O eixo do espelho (z) e o meio em x. */
const MID = 40;
/** A estação: pegada, pé-direito e o piso de cima (as sacadas e as passarelas). */
const HUB = { x0: 28, x1: 52, z0: 26, z1: 54, top: G + 8 } as const;
const UPPER = G + 4;
/** Os hangares dos times: pegada (lado sul; o norte é o espelho) e o teto. */
const HANGAR = { x0: 30, x1: 50, z0: 66, z1: 76, top: G + 6 } as const;
/** A gravidade de série (a do modificador Lua, `CHAOS_MODS.lowGravity`; pergunta AK3). */
const MOON_GRAVITY = 0.35;

/** Rampas e o apoio de metal da estação. */
const METAL: RampFamily = { solid: 'metal-panel', ramp: 'metal-roof-ramp' };

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

/**
 * Um lado do espelho: o script desenha a metade SUL (z ≥ 40) e o lado norte repete com z ↔ 80 − z (e as rampas que
 * sobem em z, ao contrário).
 */
interface Side {
  readonly north: boolean;
  /** z da metade sul → z deste lado. */
  z(z: number): number;
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, block: string | null): void;
  /** Só as paredes (0,5 m) de [x0, x1) × [z0, z1), de y0 a y1. */
  shell(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, block: string): void;
  ramp(x0: number, z0: number, x1: number, z1: number, y: number, dir: RampDir, slope: '1:1' | '1:2'): void;
  /** Corrimão numa linha reta (metros). */
  fence(x0: number, z0: number, x1: number, z1: number, y: number, height?: number): void;
  prop(model: string, x: number, y: number, z: number, yaw: number): void;
}

function side(b: MapBuilder, north: boolean): Side {
  const mz = (z: number): number => (north ? SIZE - z : z);
  const span = (z0: number, z1: number): [number, number] => (north ? [SIZE - z1, SIZE - z0] : [z0, z1]);
  const flip = (d: RampDir): RampDir => (!north ? d : d === '+z' ? '-z' : d === '-z' ? '+z' : d);
  return {
    north,
    z: mz,
    box(x0, y0, z0, x1, y1, z1, block) {
      const [a, e] = span(z0, z1);
      box(b, x0, y0, a, x1, y1, e, block);
    },
    shell(x0, z0, x1, z1, y0, y1, block) {
      const [a, e] = span(z0, z1);
      b.walls(c(x0), c(y0), c(a), c(x1) - 1, c(y1) - 1, c(e) - 1, block);
    },
    ramp(x0, z0, x1, z1, y, dir, slope) {
      const [a, e] = span(z0, z1);
      b.ramp(c(x0), c(y), c(a), c(x1) - 1, c(e) - 1, METAL, flip(dir), slope);
    },
    fence(x0, z0, x1, z1, y, height = 1) {
      // A linha ocupa a célula do começo; espelhada, a célula do outro lado do metro.
      const ax = c(x0);
      const bx = x0 === x1 ? ax : c(x1) - 1;
      const az = north ? c(SIZE - z0) - 1 : c(z0);
      const bz = z0 === z1 ? az : north ? c(SIZE - z1) : c(z1) - 1;
      b.fence(ax, c(y), az, bx, bz, 'railing', c(height));
    },
    prop(model, x, y, z, yaw) {
      b.prop(model, x, y, mz(z), north ? Math.PI - yaw : yaw, 1, 1);
    },
  };
}

/** Os dois lados (sul primeiro). */
function bothSides(b: MapBuilder, draw: (s: Side) => void): void {
  draw(side(b, false));
  draw(side(b, true));
}

// --- Chão, crateras e rochas -------------------------------------------------------------------------------------

/** Cratera: tigela de `depth` m em degraus de 0,5 m (o degrau automático sobe) e a borda de 0,5 m em volta. */
function crater(b: MapBuilder, cx: number, cz: number, r: number, depth: number): void {
  for (let x = cx - r - 1; x < cx + r + 1; x += 0.5) {
    for (let z = cz - r - 1; z < cz + r + 1; z += 0.5) {
      const d = Math.hypot(x + 0.25 - cx, z + 0.25 - cz);
      if (d < r) {
        const t = d / r;
        const sink = Math.floor((depth * (1 - t * t)) / 0.5 + 0.5) * 0.5;
        if (sink > 0) box(b, x, G - sink, z, x + 0.5, G, z + 0.5, null);
      } else if (d < r + 1) {
        box(b, x, G, z, x + 0.5, G + 0.5, z + 0.5, 'regolith');
      }
    }
  }
}

/**
 * Afloramento de rocha de `h` m: a última camada de 0,5 m recuada da borda e um degrau mais baixo no lado oeste (o
 * contorno não fica reto). O topo fica em `h`.
 */
function rock(s: Side, x0: number, z0: number, x1: number, z1: number, h: number): void {
  // A partir de 2,5 m a última camada fica recuada; abaixo disso a pegada inteira passa do olho (1,55 m) e corta a vista.
  const inset = h >= 2.5;
  s.box(x0, G, z0, x1, G + (inset ? h - 0.5 : h), z1, 'regolith');
  if (inset) s.box(x0 + 0.5, G + h - 0.5, z0 + 0.5, x1 - 0.5, G + h, z1 - 0.5, 'regolith');
  s.box(x0 - 0.5, G, z0 + 1, x0, G + Math.max(0.5, h - 1), z1 - 1, 'regolith');
}

/**
 * Rochedo de `h` m (M10, fase 10): sem o degrau do lado e com a última camada recuada. Com 6 m, o topo fica mais de
 * 2,9 m (o pulo lunar) acima de tudo o que se pisa em volta (as rochas baixas vão a 2,5 m): ninguém sobe, e ele corta a
 * vista de quem está no alto de uma rocha baixa, que passa por cima delas.
 */
function boulder(s: Side, x0: number, z0: number, x1: number, z1: number, h: number): void {
  s.box(x0, G, z0, x1, G + h - 0.5, z1, 'regolith');
  s.box(x0 + 0.5, G + h - 0.5, z0 + 0.5, x1 - 0.5, G + h, z1 - 0.5, 'regolith');
}

function ground(b: MapBuilder): void {
  box(b, 0, 0, 0, SIZE, G, SIZE, 'regolith');
  // A cratera do meio da rota oeste (no eixo: ela mesma é simétrica) e as pequenas perto dos pátios.
  crater(b, 18, MID, 6.5, 1.5);
  crater(b, 9.5, 60, 3.5, 1);
  crater(b, 9.5, SIZE - 60, 3.5, 1);
  crater(b, 70, 60, 2.5, 0.5);
  crater(b, 70, SIZE - 60, 2.5, 0.5);
}

/** Fora da área: o regolito sobe em cristas e rochas (o horizonte da bacia), com a semente do mapa. */
function border(b: MapBuilder): void {
  const rng = b.rng('borda');
  for (let x = 0; x < SIZE; x += 1) {
    for (let z = 0; z < SIZE; z += 1) {
      const out = Math.min(x + 1 - (MIN - 0.5), z + 1 - (MIN - 0.5), MAX + 0.5 - x, MAX + 0.5 - z);
      if (out > 0) continue;
      // Mais alto quanto mais longe da área (até 3 m), com ruído.
      const far = Math.min(4, -out);
      const h = Math.max(0, Math.round((far * 0.6 + rng.range(-0.6, 0.9)) * 2) / 2);
      if (h > 0) box(b, x, G, z, x + 1, G + h, z + 1, 'regolith');
    }
  }
  // Rochas grandes nos cantos de fora.
  for (const [x, z] of [
    [0, 0],
    [76, 0],
    [0, 76],
    [76, 76],
  ] as const) {
    box(b, x, G, z, x + 4, G + 4, z + 4, 'regolith');
  }
}

/**
 * A rota oeste (metade sul): rochas, rochedos, a pequena cratera e o módulo de pouso. As pedras da faixa z 47..68
 * cobrem, juntas, todo x de 4 a 28 (em fileiras desencontradas, com passagem entre elas): nenhuma vista norte-sul
 * atravessa a rota. M10 (fase 10): do alto de uma rocha (aonde o pulo lunar leva) o olho fica acima de todas as rochas
 * baixas, então as do canto, da beira oeste, do meio e a junto do hangar viraram rochedos de 6 m (ninguém sobe; a vista
 * de lá de cima para neles); ficam para pular a rocha de 2 m (1 m mais curta, para o topo dela não ver o outro canto a
 * mais de 50 m) e a de 2,5 m perto da cratera pequena.
 */
function westRoute(s: Side): void {
  boulder(s, 4, 47, 11.5, 51, 6);
  rock(s, 20, 49, 27, 52, 2);
  boulder(s, 10, 53, 16.5, 56, 6);
  boulder(s, 4, 70, 8, 76, 6);
  boulder(s, 25, 63, 28, 67.5, 6);
  rock(s, 8, 65, 13, 67.5, 2.5);
  lander(s, 16, 58);
}

/**
 * Módulo de pouso: o corpo de 6×6 m até 6 m (alto demais para pular em cima de qualquer rocha em volta), oco embaixo
 * (a cabine de 5×5 m e 2,5 m, com a escotilha de 2 m virada para o meio do mapa: esconderijo e spawn do FFA), as 4
 * pernas com sapata e a luz de pouso. `x0`, `z0` = canto mínimo do corpo (metade sul).
 */
function lander(s: Side, x0: number, z0: number): void {
  const top = G + 6;
  const cabin = G + 2.5;
  s.box(x0, G, z0, x0 + 6, top, z0 + 6, 'metal-panel');
  s.box(x0 + 0.5, top - 0.5, z0 + 0.5, x0 + 5.5, top, z0 + 5.5, 'station-panel');
  s.box(x0, cabin, z0, x0 + 6, cabin + 0.5, z0 + 6, 'neon-trim');
  // A cabine e a escotilha (com o batente de perigo).
  s.box(x0 + 0.5, G - 0.5, z0 + 0.5, x0 + 5.5, G, z0 + 5.5, 'station-floor');
  s.box(x0 + 0.5, G, z0 + 0.5, x0 + 5.5, cabin, z0 + 5.5, null);
  s.box(x0 + 1.5, G, z0, x0 + 4.5, cabin + 0.5, z0 + 0.5, 'hazard-block');
  s.box(x0 + 2, G, z0, x0 + 4, cabin, z0 + 0.5, null);
  s.box(x0 + 2.5, cabin, z0 + 4.5, x0 + 3.5, cabin + 0.5, z0 + 5, 'lamp');
  s.box(x0 + 2, G + 1, z0 + 5.5, x0 + 4, G + 2, z0 + 6, 'light-panel');
  // As pernas: colunas de 0,5 m nas quinas, um pouco para fora, com a sapata.
  for (const [lx, lz] of [
    [x0 - 1, z0 - 1],
    [x0 + 6.5, z0 - 1],
    [x0 - 1, z0 + 6.5],
    [x0 + 6.5, z0 + 6.5],
  ] as const) {
    s.box(lx, G, lz, lx + 0.5, G + 2, lz + 0.5, 'metal-panel');
    s.box(lx, G + 1.5, lz, lx + 0.5, G + 2, lz + 0.5, 'hazard-block');
  }
  s.box(x0 + 2.5, top, z0 + 2.5, x0 + 3.5, top + 0.5, z0 + 3.5, 'lamp');
}

// --- A estação (meio) --------------------------------------------------------------------------------------------

/** A casca, o teto, o piso e o reator (uma vez só: a estação inteira já é simétrica). */
function hubShell(b: MapBuilder): void {
  const { x0, x1, z0, z1, top } = HUB;
  box(b, x0, G - 0.5, z0, x1, G, z1, 'station-floor');
  b.walls(c(x0), c(G), c(z0), c(x1) - 1, c(top) - 1, c(z1) - 1, 'station-panel');
  box(b, x0, top, z0, x1, top + 0.5, z1, 'station-panel');
  // As faixas de neon por fora (e por dentro: a parede tem 0,5 m) na altura do piso de cima e na beira do teto.
  b.walls(c(x0), c(G + 3), c(z0), c(x1) - 1, c(G + 3.5) - 1, c(z1) - 1, 'neon-trim');
  b.walls(c(x0), c(top), c(z0), c(x1) - 1, c(top + 0.5) - 1, c(z1) - 1, 'neon-trim');
  // O reator: o núcleo de 6×6 m do chão ao teto, com o neon nas quinas e os painéis de luz nas 4 faces.
  box(b, 37, G, 37, 43, top, 43, 'station-panel');
  for (const [x, z] of [
    [37, 37],
    [42.5, 37],
    [37, 42.5],
    [42.5, 42.5],
  ] as const) {
    box(b, x, G, z, x + 0.5, top, z + 0.5, 'neon-trim');
  }
  box(b, 39, G + 1.5, 37, 41, G + 3, 37.5, 'light-panel');
  box(b, 39, G + 1.5, 42.5, 41, G + 3, 43, 'light-panel');
  box(b, 37, G + 1.5, 39, 37.5, G + 3, 41, 'light-panel');
  box(b, 42.5, G + 1.5, 39, 43, G + 3, 41, 'light-panel');
  // Luzes do teto do átrio.
  for (const x of [32, 47.5]) for (const z of [35, 44.5]) box(b, x, top - 0.5, z, x + 0.5, top, z + 0.5, 'lamp');
  // As portas de fora oeste e leste do átrio (4 × 3 m), com o batente de perigo e as folhas da porta recolhidas.
  for (const x of [x0, x1 - 0.5]) {
    box(b, x, G, 38, x + 0.5, G + 3, 42, null);
    box(b, x, G + 3, 37.5, x + 0.5, G + 3.5, 42.5, 'hazard-block');
    box(b, x, G, 37.5, x + 0.5, G + 3, 38, 'hazard-block');
    box(b, x, G, 42, x + 0.5, G + 3, 42.5, 'hazard-block');
    box(b, x, G, 35.5, x + 0.5, G + 3, 37.5, 'airlock-door');
    box(b, x, G, 42.5, x + 0.5, G + 3, 44.5, 'airlock-door');
    // As janelas do andar de cima, para o céu (acima do olho de quem está lá em cima: a vista sobe e não acha o chão).
    box(b, x, G + 6, 33.5, x + 0.5, G + 7.5, 36.5, 'glass');
    box(b, x, G + 6, 43.5, x + 0.5, G + 7.5, 46.5, 'glass');
  }
}

/** A metade sul da estação: a eclusa, a sacada em cima dela, as rampas e a passarela do lado. */
function hubHalf(s: Side): void {
  const { x0, x1, z1 } = HUB;
  // A eclusa: parede de dentro em z 47 (até o piso de cima), o teto dela é a sacada.
  s.box(x0 + 0.5, G, 47, x1 - 0.5, UPPER - 0.5, 47.5, 'station-panel');
  s.box(x0 + 0.5, UPPER - 0.5, 47, x1 - 0.5, UPPER, z1 - 0.5, 'station-floor');
  // Portas de dentro (2 × 3 m), desencontradas da de fora.
  s.box(32, G, 47, 34, G + 3, 47.5, null);
  s.box(46, G, 47, 48, G + 3, 47.5, null);
  s.box(31.5, G + 3, 47, 34.5, UPPER - 0.5, 47.5, 'neon-trim');
  s.box(45.5, G + 3, 47, 48.5, UPPER - 0.5, 47.5, 'neon-trim');
  // O vestíbulo da eclusa, para fora no pátio (x 35..45, z 54..60, 5 m): as portas dos lados, desencontradas (oeste
  // perto da estação, leste perto do pátio), cortam as vistas leste-oeste do pátio e a de fora para dentro.
  const v = { x0: 35, x1: 45, z0: z1, z1: z1 + 6, top: G + 5 } as const;
  s.box(v.x0, G - 0.5, v.z0, v.x1, G, v.z1, 'station-floor');
  s.shell(v.x0, v.z0 - 0.5, v.x1, v.z1, G, v.top, 'station-panel');
  s.box(v.x0, v.top, v.z0, v.x1, v.top + 0.5, v.z1, 'station-panel');
  s.shell(v.x0, v.z0 - 0.5, v.x1, v.z1, G + 3, G + 3.5, 'neon-trim');
  s.box(v.x0, G, 54.5, v.x0 + 0.5, G + 3, 57, null);
  s.box(v.x1 - 0.5, G, 57, v.x1, G + 3, 59.5, null);
  s.box(v.x0, G + 3, 54, v.x0 + 0.5, G + 3.5, 57.5, 'hazard-block');
  s.box(v.x1 - 0.5, G + 3, 56.5, v.x1, G + 3.5, 59.5, 'hazard-block');
  s.box(39.5, v.top - 0.5, 56.5, 40.5, v.top, 57.5, 'lamp');
  // O anteparo do meio (3,5 m, deixando 1,5 m junto da estação): nenhuma reta passa pelas duas portas dos lados. M10
  // (fase 10): com 2,5 m, a reta que vem do alto (do topo da pilha de carga, a 2 m) passava por cima dele, entre as
  // duas portas (3 m), e cruzava o mapa (58 m).
  s.box(39.5, G, 55.5, 40.5, G + 3.5, v.z1 - 0.5, 'station-panel');
  s.box(39.5, G + 3, 55.5, 40.5, G + 3.5, v.z1 - 0.5, 'neon-trim');
  // A porta da eclusa para o vestíbulo (4 × 3 m), com o batente de perigo e as folhas da porta recolhidas.
  s.box(38, G, z1 - 0.5, 42, G + 3, z1, null);
  s.box(37.5, G + 3, z1 - 0.5, 42.5, G + 3.5, z1, 'hazard-block');
  s.box(37.5, G, z1 - 0.5, 38, G + 3, z1, 'hazard-block');
  s.box(42, G, z1 - 0.5, 42.5, G + 3, z1, 'hazard-block');
  s.box(35.5, G, z1 - 0.5, 37.5, G + 3, z1, 'airlock-door');
  s.box(42.5, G, z1 - 0.5, 44.5, G + 3, z1, 'airlock-door');
  // Janelas da sacada, para o céu (na altura do olho, não: de um hangar se veria o outro pelas portas da estação).
  s.box(30.5, UPPER + 0.5, z1 - 0.5, 35.5, UPPER + 2.5, z1, 'glass');
  s.box(44.5, UPPER + 0.5, z1 - 0.5, 49.5, UPPER + 2.5, z1, 'glass');
  // Dentro da eclusa: o banco do meio (cobertura baixa), armários nas paredes e a luz no teto.
  s.box(38.5, G, 50, 41.5, G + 1, 51, 'metal-panel');
  s.box(x0 + 0.5, G, 49, x0 + 1, G + 2, 52, 'station-panel');
  s.box(x1 - 1, G, 49, x1 - 0.5, G + 2, 52, 'station-panel');
  s.box(35, UPPER - 0.5, 50, 35.5, UPPER, 50.5, 'lamp');
  s.box(44.5, UPPER - 0.5, 50, 45, UPPER, 50.5, 'lamp');
  // As rampas do átrio para a sacada (1:1, 4 m), nas duas pontas.
  s.ramp(31, 43, 33, 47, G, '+z', '1:1');
  s.ramp(47, 43, 49, 47, G, '+z', '1:1');
  // O corrimão da sacada (menos onde as rampas chegam) e o das passarelas.
  s.fence(x0 + 2.5, 47, 31, 47, UPPER);
  s.fence(33, 47, 47, 47, UPPER);
  s.fence(49, 47, x1 - 2.5, 47, UPPER);
  // As passarelas de grade nas paredes oeste e leste (2 m, 0,25 m abaixo da sacada), ligando as duas sacadas.
  s.box(x0 + 0.5, UPPER - 0.5, MID, x0 + 2.5, UPPER, 47, 'grate-slab');
  s.box(x1 - 2.5, UPPER - 0.5, MID, x1 - 0.5, UPPER, 47, 'grate-slab');
  s.fence(x0 + 2.5, MID, x0 + 2.5, 47, UPPER - 0.5);
  s.fence(x1 - 2.5, MID, x1 - 2.5, 47, UPPER - 0.5);
  // No chão do átrio: consoles (1 m) e caixotes.
  s.box(33, G, 41.5, 35.5, G + 1, 42.5, 'metal-panel');
  s.box(44.5, G, 44, 47, G + 1, 45, 'metal-panel');
  s.box(34.5, G + 1, 41.5, 35.5, G + 1.5, 42.5, 'led-strip');
  s.box(44.5, G + 1, 44, 45.5, G + 1.5, 45, 'led-strip');
  s.box(39, G, 44.5, 40.5, G + 1.5, 45.5, 'crate');
}

// --- Os pátios e os hangares ------------------------------------------------------------------------------------

/**
 * O hangar do time (metade sul: o time 0). As saídas são as dos lados (3 m), com o anteparo logo dentro; a frente é
 * fechada (revisão: sem as duas portas da frente a travessia de spawn a spawn passa de 10,6 s para 12,7 s, dentro dos
 * 12–18 s do GDD, e de fora não se vê o fundo do hangar). O jipe lunar na frente das vagas.
 */
function hangar(s: Side): void {
  const { x0, x1, z0, z1, top } = HANGAR;
  s.box(x0, G - 0.5, z0, x1, G, z1, 'station-floor');
  s.shell(x0, z0, x1, z1, G, top, 'station-panel');
  s.box(x0, top, z0, x1, top + 0.5, z1, 'station-panel');
  s.shell(x0, z0, x1, z1, top - 0.5, top, 'neon-trim');
  // A faixa de perigo e o neon na frente fechada.
  s.box(x0 + 1, G + 2.5, z0, x1 - 1, G + 3, z0 + 0.5, 'hazard-block');
  s.box(x0 + 1, G + 3, z0, x1 - 1, G + 3.5, z0 + 0.5, 'neon-trim');
  for (const x of [x0, x1 - 0.5]) {
    s.box(x, G, 69.5, x + 0.5, G + 3, 72.5, null);
    s.box(x, G + 3, 69, x + 0.5, G + 3.5, 73, 'hazard-block');
    // O anteparo de 2,5 m logo dentro da porta: de uma porta do lado não se vê a outra (nem as vagas).
    const bx = x === x0 ? x0 + 2 : x1 - 2.5;
    s.box(bx, G, 68.5, bx + 0.5, G + 2.5, 73.5, 'station-panel');
    s.box(bx, G + 2, 68.5, bx + 0.5, G + 2.5, 73.5, 'neon-trim');
  }
  // Janelas altas (acima do olho: de fora não se vê quem nasce) e as luzes.
  s.box(x0, G + 3.5, 73, x0 + 0.5, G + 5, 75, 'glass');
  s.box(x1 - 0.5, G + 3.5, 73, x1, G + 5, 75, 'glass');
  for (const x of [34, 40, 46]) s.box(x, top - 0.5, 71, x + 1, top, 72, 'lamp');
  for (const x of [33, 39, 45]) s.box(x, G + 2, z1 - 0.5, x + 2, G + 3, z1, 'light-panel');
  // O jipe lunar na frente das vagas (2 m: tapa a vista de quem olha pelas saídas), a cabine com o para-brisa e os
  // faróis.
  s.box(36, G, 68, 44, G + 1.5, 70, 'metal-panel');
  s.box(37, G + 1.5, 68, 41, G + 2, 70, 'metal-panel');
  s.box(37, G + 2, 68.5, 41, G + 2.5, 69.5, 'glass');
  s.box(36, G + 0.5, 68, 44, G + 1, 70, 'neon-trim');
  s.box(43.5, G + 1, 68, 44, G + 1.5, 70, 'light-panel');
}

/** O pátio da frente do hangar: a faixa de pouso pintada, os holofotes e a carga. */
function apron(s: Side): void {
  // A plataforma de concreto com a faixa (nivelada com o regolito) entre o vestíbulo e o hangar.
  s.box(29, G - 0.5, 60, 51, G, 66, 'concrete');
  s.box(29, G - 0.5, 60.5, 51, G, 61, 'concrete-stripe');
  s.box(29, G - 0.5, 65, 51, G, 65.5, 'concrete-stripe');
  // Cobertura baixa no pátio: caixotes e o banco de metal.
  s.box(32, G, 60, 34, G + 1, 61, 'crate');
  s.box(46.5, G, 61.5, 48.5, G + 1.5, 63, 'crate');
  s.box(39, G, 62.5, 41, G + 1, 63.5, 'metal-panel');
  // Os muros de proteção nas quinas da frente do hangar, emendados nas rochas: de dentro do hangar não se vê a diagonal
  // até a beirada do outro lado do mapa. Os holofotes ficam no chão, na frente deles (revisão: em cima da mureta o topo
  // do holofote, a 4,9 m, era a escada para o telhado do hangar; no chão ele fica a 2,4 m). M10 (fase 10): eram muretas
  // de 2,5 m, e do topo delas (aonde o pulo lunar leva) a vista descia a rota oeste até o outro lado do mapa (60 m);
  // com 6 m ninguém sobe e a vista para nelas.
  s.box(28, G, 63, 30.5, G + 6, 64.5, 'concrete');
  s.box(49.5, G, 63, 53, G + 6, 64.5, 'concrete');
  s.box(28, G + 2, 63, 30.5, G + 2.5, 64.5, 'hazard-block');
  s.box(49.5, G + 2, 63, 53, G + 2.5, 64.5, 'hazard-block');
  s.prop('floodlight', 29, G, 61.75, Math.PI * 0.8);
  s.prop('floodlight', 51.5, G, 61.75, -Math.PI * 0.8);
  s.prop('barrel', 27.5, G, 60, 0);
  s.prop('barrel', 51.5, G, 59.5, 0);
}

/**
 * A rota leste (metade sul): os painéis solares, os tanques, a pilha de carga, o duto, a rocha e os rochedos. Como na
 * oeste, a faixa z 45..76 cobre todo x de 52 a 76 com fileiras desencontradas.
 */
function eastRoute(s: Side): void {
  // Painéis solares: base de 0,5 m e a placa inclinada (cobertura baixa de 1 m).
  const solar = (x0: number, x1: number, z: number): void => {
    s.box(x0, G, z, x1, G + 0.5, z + 1, 'metal-panel');
    s.ramp(x0, z, x1, z + 0.5, G + 0.5, '-z', '1:1');
    s.box(x0, G + 0.5, z + 0.5, x1, G + 1, z + 1, 'metal-panel');
  };
  solar(55, 61, 45.5);
  solar(71, 75.5, 50.5);
  solar(57, 63, 54);
  // O radiador entre o rochedo e os tanques: corta as diagonais do pátio leste para o hangar do outro time. M10 (fase
  // 10): 6 m (era 2,5 m e o topo dele, como o da pilha de carga, via a rota leste de ponta a ponta por cima de tudo).
  s.box(57, G, 48.5, 63.5, G + 6, 50, 'metal-panel');
  s.box(57, G + 2, 48.5, 63.5, G + 2.5, 50, 'led-strip');
  // Os tanques de oxigênio (6,5 m: o deque da antena fica a 3 m e o pulo lunar sobe 2,9 m, então de lá não se pula
  // em cima deles; revisão: com 4 m o topo deles via o fundo do hangar do outro time a mais de 50 m) com o neon.
  s.box(69, G, 45, MAX, G + 6.5, 48, 'station-panel');
  s.box(69, G + 3, 45, MAX, G + 3.5, 48, 'neon-trim');
  s.box(65, G, 51.5, 69.5, G + 6.5, 54.5, 'station-panel');
  s.box(65, G + 2.5, 51.5, 69.5, G + 3, 54.5, 'neon-trim');
  s.prop('water-tank', 75, G, 49.5, 0);
  // O duto que sai da parede leste da estação (2,5 m) até o chão.
  s.box(52, G, 56, 53.5, G + 2.5, 58, 'metal-panel');
  s.box(52, G + 2, 56, 53.5, G + 2.5, 58, 'hazard-block');
  // A pilha de carga do pátio leste (módulos de 2 a 2,5 m: de cima dela nem com a Pressa se alcança o teto do vestíbulo,
  // 3 m acima; revisão: com o neon em cima, a 3 m, a Pressa pulava dela para o vestíbulo e dali para os telhados).
  s.box(57, G, 57, 62, G + 2.5, 61, 'station-panel');
  s.box(57, G + 2, 57, 62, G + 2.5, 61, 'neon-trim');
  s.box(62, G, 58, 65, G + 2, 61, 'station-panel');
  s.box(59, G, 61, 63, G + 2.5, 64.5, 'metal-panel');
  s.prop('crate-large', 67.5, G, 64.5, 0.4);
  s.prop('barrel', 66.5, G, 57.5, 0);
  s.prop('generator', 71.5, G, 55.5, Math.PI / 2);
  // O rochedo ao lado da estação, a rocha perto do hangar e o rochedo do canto.
  boulder(s, 53.5, 49, 57, 52, 6);
  rock(s, 53, 63, 56, 67.5, 2);
  boulder(s, 72, 70, 76, 76, 6);
}

/** A torre da antena (no eixo): base de 6×6 m a 3 m, as 2 rampas, o mastro e a luz de cima. */
function antenna(b: MapBuilder): void {
  const deck = G + 3;
  box(b, 62, G, 37, 68, deck, 43, 'station-panel');
  box(b, 62, deck - 0.5, 37, 68, deck, 43, 'station-floor');
  box(b, 62, G + 1.5, 37, 68, G + 2, 43, 'neon-trim');
  // A sala do rádio dentro da base (5×5 m e 2,5 m; um spawn do FFA), com a porta de 2 m virada para a estação.
  box(b, 62.5, G - 0.5, 37.5, 67.5, G, 42.5, 'station-floor');
  box(b, 62.5, G, 37.5, 67.5, deck - 0.5, 42.5, null);
  box(b, 62, G, 38.5, 62.5, deck - 0.5, 41.5, 'hazard-block');
  box(b, 62, G, 39, 62.5, deck - 0.5, 41, null);
  box(b, 67.5, G + 0.5, 39, 68, G + 1.5, 41, 'light-panel');
  box(b, 64.5, deck - 1, 39.5, 65.5, deck - 0.5, 40.5, 'lamp');
  // O mastro de treliça até 14 m e o farol no alto.
  box(b, 64.5, deck, 39.5, 65.5, G + 14, 40.5, 'crane-lattice');
  box(b, 64.5, G + 14, 39.5, 65.5, G + 14.5, 40.5, 'lamp');
  // Rampa sul e rampa norte (1:1, 3 m) no meio da base.
  b.ramp(c(64), c(G), c(43), c(66) - 1, c(46) - 1, METAL, '-z', '1:1');
  b.ramp(c(64), c(G), c(34), c(66) - 1, c(37) - 1, METAL, '+z', '1:1');
  // O corrimão do deque (menos onde as rampas chegam).
  const rail = (x0: number, z0: number, x1: number, z1: number): void => {
    const ax = c(x0);
    const az = c(z0);
    b.fence(ax, c(deck), az, x0 === x1 ? ax : c(x1) - 1, z0 === z1 ? az : c(z1) - 1, 'railing', 2);
  };
  rail(62, 37, 64, 37);
  rail(66, 37, 68, 37);
  rail(62, 42.5, 64, 42.5);
  rail(66, 42.5, 68, 42.5);
  rail(62, 37, 62, 43);
  rail(67.5, 37, 67.5, 43);
}

// --- Marcadores ---------------------------------------------------------------------------------------------------

function spawns(b: MapBuilder): void {
  // Os times: o 0 no hangar sul, o 1 no hangar norte (espelho), atrás do jipe.
  const team = [
    [34, 72.5],
    [36.5, 74],
    [40, 72],
    [43.5, 74],
    [47, 72.5],
    [33.5, 74.5],
    [46.5, 74.5],
    [40, 74.5],
  ] as const;
  for (const [x, z] of team) {
    b.spawn({ x, y: G, z, yaw: yawTo(x, z, MID, MID), team: 0 });
    b.spawn({ x, y: G, z: SIZE - z, yaw: yawTo(x, SIZE - z, MID, MID), team: 1 });
  }
  // FFA: cada um num canto que não vê os outros (o mapc confere olho a olho). Os do meio (o átrio, dos dois lados do
  // reator, e as beiradas oeste e leste) e 7 por metade, espelhados.
  const ffa: [number, number][] = [
    [34, 44],
    [46, 36],
    [6, MID],
    [74, MID],
    [64, MID],
  ];
  const half: readonly (readonly [number, number])[] = [
    [36.5, 51.5],
    [10, 74],
    [24, 61],
    [6, 56],
    [70, 66],
    [17.5, 63],
  ];
  for (const [x, z] of half) ffa.push([x, z], [x, SIZE - z]);
  for (const [x, z] of ffa) b.spawn({ x, y: G, z, yaw: yawTo(x, z, MID, MID), team: -1 });
}

function cameras(b: MapBuilder): void {
  const camera = (name: string, x: number, y: number, z: number, tx: number, ty: number, tz: number): void =>
    b.camera({ name, x, y, z, yaw: yawTo(x, z, tx, tz), pitch: pitchTo(x, y, z, tx, ty, tz), fovYDeg: 0 });
  camera('print:moonbase', 40, 26, 84, 40, G, 38);
  camera('print:atrio', 31, UPPER + 1.55, 50, 44, G + 1, 36);
  camera('print:cratera', 26.5, G + 3.5, 47.5, 15, G - 1, 37);
  camera('print:antena', 55, G + 4.5, 53, 65, G + 2, 39);
}

const moonbase: MapScript = {
  id: 'moonbase',
  build(b) {
    b.size(c(SIZE), 48, c(SIZE));
    b.meta({
      nameKey: 'map.moonbase.name',
      modes: ['warfare.tdm', 'warfare.ffa', 'sandbox'],
      players: { min: 2, ideal: 10, max: 16 },
      maxSightLineM: 50,
      botCaps: {},
      gravity: MOON_GRAVITY,
    });
    b.playArea(MIN, MIN, MAX, MAX, G - 10);
    b.sun(-0.35, 0.75, 0.45, 'night');
    ground(b);
    border(b);
    hubShell(b);
    bothSides(b, (s) => {
      westRoute(s);
      hubHalf(s);
      hangar(s);
      apron(s);
      eastRoute(s);
    });
    antenna(b);
    spawns(b);
    cameras(b);
  },
};

export default moonbase;
