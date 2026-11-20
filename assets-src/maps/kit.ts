/**
 * M10 (fase 0): as montagens do kit dos mapas novos (não é um mapa: o `mapc` só compila os ids de `MAP_IDS`). Os mapas
 * das fases 1 a 5 importam daqui o que é chato de acertar à mão: o contêiner com as portas giradas, o guindaste de
 * treliça com o caixote pendurado, o X da porta de celeiro (o xadrez A/B) e o mar do porto sem armadilha para a
 * navegação. Erro de uso (gancho fora da lança, porta de largura quebrada) lança e o `mapc` reprova o mapa. O resto do
 * kit é bloco solto (catálogo em assets-src/blocks/blocks.ts) e prop (assets-src/models/map-kit.ts).
 *
 * Tudo em METROS, em múltiplos de 0,5 (como os scripts dos mapas); o builder recebe células. Caixas semiabertas
 * [a, a + tamanho).
 */
import { BOBO_NAV_METRICS } from '@boboforces/sim';
import type { MapBuilder } from '../../tools/mapc/src/api.ts';
import { CONTAINER_COLORS as CONTAINER_PAINT, type ContainerColor } from '../textures/blocos16/porto.ts';

export type { ContainerColor };

/** Cores dos contêineres (os blocos `container-<cor>` e `container-<cor>-door`): vermelho, azul-aço, verde e bege. */
export const CONTAINER_COLORS: readonly ContainerColor[] = CONTAINER_PAINT.map((c) => c.key);

/** Medidas do contêiner (m): largura e altura de 2,5; comprimento de 6 (o de 20 pés) ou 12 (o de 40). */
export const CONTAINER_WIDTH = 2.5;
export const CONTAINER_HEIGHT = 2.5;

const c = (m: number): number => Math.round(m * 2);

/** Caixa [x0, x1) × [y0, y1) × [z0, z1) em metros, com giro opcional (quartos de volta). */
function boxM(
  b: MapBuilder,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  block: string | null,
  rot = 0,
): void {
  b.box(c(x0), c(y0), c(z0), c(x1) - 1, c(y1) - 1, c(z1) - 1, block, rot);
}

export interface ContainerSpec {
  /** Canto mínimo (m): x e z da pegada e a base (o chão ou o topo do contêiner de baixo). */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Eixo do comprimento. */
  readonly along: 'x' | 'z';
  readonly color: ContainerColor;
  /** Comprimento em metros (padrão 6; o de 40 pés tem 12). */
  readonly length?: number;
  /** Onde ficam as portas: nas duas pontas (padrão), só no começo (menor x/z), só no fim ou em nenhuma. */
  readonly doors?: 'both' | 'start' | 'end' | 'none';
}

/**
 * Contêiner de chapa: o corpo em `container-<cor>` e a fatia de 0,5 m da ponta em `container-<cor>-door` (a porta
 * fica nas faces ±Z da forma canônica; em X, giro 1). Devolve a altura do topo (m), para empilhar.
 */
export function container(b: MapBuilder, s: ContainerSpec): number {
  const len = s.length ?? 6;
  const [sx, sz] = s.along === 'x' ? [len, CONTAINER_WIDTH] : [CONTAINER_WIDTH, len];
  const top = s.y + CONTAINER_HEIGHT;
  boxM(b, s.x, s.y, s.z, s.x + sx, top, s.z + sz, `container-${s.color}`);
  const doors = s.doors ?? 'both';
  const ends = doors === 'both' ? (['start', 'end'] as const) : doors === 'none' ? [] : [doors];
  const door = `container-${s.color}-door`;
  for (const end of ends) {
    if (s.along === 'x') {
      const x0 = end === 'start' ? s.x : s.x + sx - 0.5;
      boxM(b, x0, s.y, s.z, x0 + 0.5, top, s.z + sz, door, 1);
    } else {
      const z0 = end === 'start' ? s.z : s.z + sz - 0.5;
      boxM(b, s.x, s.y, z0, s.x + sx, top, z0 + 0.5, door, 0);
    }
  }
  return top;
}

export interface TowerCraneSpec {
  /** Canto mínimo do mastro de 1 × 1 m e a base (m). */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Altura do mastro até a lança (m). */
  readonly height: number;
  /** Para onde a lança aponta. */
  readonly dir: '+x' | '-x' | '+z' | '-z';
  /** Comprimento da lança a partir da face do mastro (m). */
  readonly jib: number;
  /** Comprimento da contralança (m, padrão 1/3 da lança), com o contrapeso de concreto na ponta. */
  readonly counterJib?: number;
  /** O caixote de 1,5 m pendurado: a distância da face do mastro e o comprimento do cabo abaixo da lança (m). */
  readonly hook?: { readonly at: number; readonly drop: number };
}

/**
 * Guindaste de torre: mastro de treliça de 1 × 1 m, o topo de 2 m acima da lança, a lança e a contralança de
 * treliça (1 × 1 m), o contrapeso de concreto, a cabine de chapa com janela e, opcional, o cabo com o caixote. A
 * treliça para o movimento mas deixa passar bala e visão (`crane-lattice`); o caixote (`crate`) para tudo. Devolve a
 * altura de cima da lança (m).
 */
export function towerCrane(b: MapBuilder, s: TowerCraneSpec): number {
  if (s.hook && (s.hook.at < 1 || s.hook.at + 0.5 > s.jib)) {
    throw new Error(
      `kit: o gancho do guindaste fica a ${s.hook.at} m da face do mastro; precisa de 1 m ou mais e caber na lança ` +
        `de ${s.jib} m (at + 0,5 ≤ jib)`,
    );
  }
  const jibY = s.y + s.height;
  const jibTop = jibY + 1;
  // O mastro passa pela altura da lança e sobe mais 2 m (onde os tirantes iriam): a silhueta de guindaste de longe.
  boxM(b, s.x, s.y, s.z, s.x + 1, jibTop + 2, s.z + 1, 'crane-lattice');
  const counter = s.counterJib ?? Math.max(1, Math.round(s.jib / 3));
  // Vetor da lança: (dx, dz); a contralança vai para o lado contrário.
  const [dx, dz] = s.dir === '+x' ? [1, 0] : s.dir === '-x' ? [-1, 0] : s.dir === '+z' ? [0, 1] : [0, -1];
  /** Trecho [d0, d1) ao longo da lança, medido da face do mastro (negativo = lado da contralança). */
  const run = (d0: number, d1: number, y0: number, y1: number, block: string): void => {
    if (dx !== 0) {
      const a = dx > 0 ? s.x + 1 + d0 : s.x - d1;
      const e = dx > 0 ? s.x + 1 + d1 : s.x - d0;
      boxM(b, a, y0, s.z, e, y1, s.z + 1, block);
    } else {
      const a = dz > 0 ? s.z + 1 + d0 : s.z - d1;
      const e = dz > 0 ? s.z + 1 + d1 : s.z - d0;
      boxM(b, s.x, y0, a, s.x + 1, y1, e, block);
    }
  };
  // A contralança mede a partir da face oposta do mastro: no `run`, a face oposta fica a −1 m da face da lança.
  run(0, s.jib, jibY, jibTop, 'crane-lattice');
  run(-1 - counter, -1, jibY, jibTop, 'crane-lattice');
  run(-1 - counter, -1 - counter + 1, jibY - 1.5, jibY, 'concrete');
  // Cabine: 1 m de chapa do lado da lança, logo abaixo dela, com a janela de vidro na frente.
  run(0, 1, jibY - 1, jibY, 'metal-panel');
  if (dx !== 0) {
    const fx = dx > 0 ? s.x + 1.5 : s.x - 1;
    boxM(b, fx, jibY - 0.5, s.z + 0.5, fx + 0.5, jibY, s.z + 1, 'glass');
  } else {
    const fz = dz > 0 ? s.z + 1.5 : s.z - 1;
    boxM(b, s.x + 0.5, jibY - 0.5, fz, s.x + 1, jibY, fz + 0.5, 'glass');
  }
  if (s.hook) {
    const { at, drop } = s.hook;
    const cableTop = jibY;
    const cableBottom = jibY - drop;
    // O cabo é um painel fino numa coluna de células (a primeira da largura da lança); o caixote de 1,5 m fica
    // logo abaixo, centrado na célula do cabo.
    if (dx !== 0) {
      const cx = dx > 0 ? s.x + 1 + at : s.x - at - 0.5;
      boxM(b, cx, cableBottom, s.z, cx + 0.5, cableTop, s.z + 0.5, 'crane-cable', 0);
      boxM(b, cx - 0.5, cableBottom - 1.5, s.z - 0.5, cx + 1, cableBottom, s.z + 1, 'crate');
    } else {
      const cz = dz > 0 ? s.z + 1 + at : s.z - at - 0.5;
      boxM(b, s.x, cableBottom, cz, s.x + 0.5, cableTop, cz + 0.5, 'crane-cable', 1);
      boxM(b, s.x - 0.5, cableBottom - 1.5, cz - 0.5, s.x + 1, cableBottom, cz + 1, 'crate');
    }
  }
  return jibTop;
}

/**
 * Porta de celeiro com o X branco: xadrez de `barn-door-a` ("\") e `barn-door-b` ("/") na parede, contado de cima
 * (a fileira de cima começa com A no menor x ou z), então cada 2×2 blocos (1 × 1 m) é um X. `w` e `h` em metros
 * (múltiplos de 1 m para o X fechar); a parede tem 0,5 m de espessura em (x, z).
 */
export function barnDoor(b: MapBuilder, x: number, y: number, z: number, along: 'x' | 'z', w: number, h: number): void {
  if (!Number.isInteger(w) || w < 1) {
    throw new Error(
      `kit: a porta de celeiro tem ${w} m de largura; precisa ser um número inteiro de metros (o X fecha)`,
    );
  }
  const cols = c(w);
  const rows = c(h);
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const fromTop = rows - 1 - j;
      const block = (i + fromTop) % 2 === 0 ? 'barn-door-a' : 'barn-door-b';
      const cx = along === 'x' ? c(x) + i : c(x);
      const cz = along === 'z' ? c(z) + i : c(z);
      b.set(cx, c(y) + j, cz, block);
    }
  }
}

export interface HarborWaterSpec {
  /** Caixa da água [x0, x1) × [z0, z1) (m). */
  readonly x0: number;
  readonly z0: number;
  readonly x1: number;
  readonly z1: number;
  /** Altura do piso do cais (m): de onde o bobo cai na água. */
  readonly dock: number;
  /** Topo da célula da água (m): a laje `water` ocupa a meia célula de baixo (a superfície fica 0,25 m abaixo). */
  readonly surface: number;
  /** Bloco do fundo, escuro debaixo da água translúcida (padrão `dirt`). */
  readonly floor?: string;
}

/**
 * Mar do porto SEM natação e sem armadilha para os bots (diferente do mar da Ilha, raso e andável): a laje `water`
 * (sem colisão) na superfície e o fundo a mais de `BOBO_NAV_METRICS.maxDrop` (3 m) abaixo do cais e pelo menos 1,5 m
 * abaixo da água, então a navegação nunca liga o cais ao fundo por uma queda. Devolve a altura (m) do plano de morte
 * para o `playArea`: no meio do vão entre a água e o fundo (quem cai morre antes de chegar no fundo). Todo o resto do
 * mapa precisa ficar acima dele.
 */
export function harborWater(b: MapBuilder, s: HarborWaterSpec): number {
  if (s.surface > s.dock) {
    throw new Error(`kit: a água do porto (topo a ${s.surface} m) precisa ficar abaixo do cais (${s.dock} m)`);
  }
  const bed = Math.floor(Math.min(s.surface - 1.5, s.dock - BOBO_NAV_METRICS.maxDrop - 1) * 2) / 2;
  if (bed < 0.5) {
    throw new Error(
      `kit: sem altura para o fundo do porto a mais de ${BOBO_NAV_METRICS.maxDrop} m do cais (${s.dock} m); suba o cais`,
    );
  }
  boxM(b, s.x0, bed - 0.5, s.z0, s.x1, bed, s.z1, s.floor ?? 'dirt');
  boxM(b, s.x0, s.surface - 0.5, s.z0, s.x1, s.surface, s.z1, 'water');
  return (bed + s.surface - 0.5) / 2;
}
