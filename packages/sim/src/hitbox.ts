import {
  FIGURE_BONE,
  FIGURE_BONES,
  FIGURE_GRIP,
  FIGURE_HIT_FIELD,
  FIGURE_HIT_STRIDE,
  FIGURE_MODE,
  FIGURE_PART_CATEGORY,
  FIGURE_STANCE,
  figureAimPoint,
  figureBodyPartAtHeight,
  figureHitBoxes,
  figurePosture,
  type FigureAimOut,
  type FigureGameTable,
  type FigureGrip,
  type FigurePart,
} from '@boboforces/format';
import { METRICS } from './config/metrics.ts';
import { weaponDef } from './config/weapons.ts';
import { ENTITY_FLAG, ENTITY_KIND } from './entity.ts';
import type { SimState } from './state.ts';

/**
 * Hitboxes do bobo (gameplay.md §3.1; decisão #56, PLANO do porte §B3, §B4 e §C5): as 12 caixas orientadas (OBB) do
 * boneco do FutBobo, uma por osso, tiradas da tabela de jogo do format (`figureHitBoxes`, postura × pitch). O render
 * tira a pose de 3ª pessoa da MESMA tabela: o que você vê é o que acerta.
 *
 * Frame da tabela (raiz nos pés, yaw 0): x = direita do boneco, y a partir dos pés, z = frente (= −Z do mundo). Para o
 * mundo, com c = cos(yaw) e s = sin(yaw): (x, y, z) → pés + (c·x − s·z, y, −s·x − c·z) (yaw 0 olha para −Z, a direita é
 * +X).
 *
 * Exceção ao "o que você vê é o que acerta": as hitboxes de braço só valem a até `ARM_HIT_CUT_M` (0,75 m) do eixo, em
 * x e z do mundo (decisão 1 da §I do PLANO): o braço armado não leva tiro do outro lado de um muro de 1 bloco.
 *
 * A tabela é da partida: vem de `SimConfig.figureTable` ou o `createSim` monta (sempre na criação, nunca no 1º raio) e
 * solta no `dispose`. A sim usa a dela pelo `FigureHitCache` do contexto; as funções livres (`rayVsBobo`,
 * `aimPointLocal`, `aimPointWorld`, `bodyPartAtHeight`, usadas pela IA, pelas ferramentas e pelos testes) leem a tabela
 * ligada pela sim viva mais recente (`bindFigureTable`). Todas as tabelas são iguais (montagem pura e determinística),
 * então qual delas atende não muda nenhum resultado.
 */

/** Uma hitbox por osso (`FIGURE_BONE`): o índice da caixa é a `FigurePart`. */
export const HITBOX_COUNT = FIGURE_BONES;

/**
 * Corte das hitboxes de BRAÇO (braço e antebraço, D e E; categoria 2): só contam até esta distância (m) do eixo da
 * entidade em x e em z do MUNDO, a AABB de movimento crescida 0,45 m no plano (risco 14 do PLANO, plano B, decisão 1
 * da §I). O braço armado passa da face da AABB e atravessava o muro de 1 bloco (0,5 m): encostado nele, a mão do outro
 * lado levava tiro. Com o corte a 0,75 < 0,3 + 0,5 nada do braço fica além da face de lá. Só a hitbox: o visual não
 * muda (a arma pode aparecer do outro lado, mas não leva tiro por lá). Quadrado alinhado ao mundo, como a AABB e a
 * grade de blocos (o corte vale em qualquer yaw), e não círculo: a parte cortada é a menor que fecha o muro.
 */
export const ARM_HIT_CUT_M = METRICS.aabbWidth / 2 + 0.45;

const HF = FIGURE_HIT_FIELD;
const F = ENTITY_FLAG;
/** Categoria de dano do braço em `FIGURE_PART_CATEGORY` (as caixas que levam o corte). */
const ARM_CATEGORY = 2;
/** Floats das 12 hitboxes no frame da tabela (saída de `figureHitBoxes`). */
const LOCAL_ROW = FIGURE_BONES * FIGURE_HIT_STRIDE;
/** Hitbox no mundo (cache): centro (0..2), eixos direita/cima/frente da caixa (3..11) e meias medidas (12..14). */
const W_STRIDE = 15;
const W_ROW = FIGURE_BONES * W_STRIDE;
/**
 * Rascunho do raio: origem, direção unitária, melhor entrada até aqui (o `maxT` no começo), chão da fase larga e o
 * eixo (x, z) do corpo testado agora (o centro do corte dos braços).
 */
const R_OX = 0;
const R_OY = 1;
const R_OZ = 2;
const R_DX = 3;
const R_DY = 4;
const R_DZ = 5;
const R_BEST = 6;
const R_BOTTOM = 7;
const R_AXIS_X = 8;
const R_AXIS_Z = 9;
const RAY_SIZE = 10;
/** `stampKey` = entidade × KEY_POSTURES + postura (postura < 22). */
const KEY_POSTURES = 32;

// --- Postura ---

/** Empunhadura da arma do código (`WeaponDef.grip`, M2: `SimView.weapon` é o código); sem arma = nenhuma. */
export function weaponGrip(code: number): FigureGrip {
  const def = weaponDef(code);
  return def ? def.grip : FIGURE_GRIP.none;
}

/**
 * Postura da tabela de jogo (`figurePosture` do format) pelos bits da entidade: zumbi pelo `kind`; deslizar vence
 * agachar (o movimento liga `crouching` junto do deslize); ADS pelo bit `ads`; correr só em pé (o format ignora o modo
 * agachado e deslizando); empunhadura de `WeaponDef.grip` (`weaponGrip`). A sim usa nos raios e o `game` usa a MESMA
 * função para escrever `ActorBuffer.posture` (E.12).
 */
export function figurePostureOf(flags: number, grip: FigureGrip, kind: number): number {
  // quente:
  const stance =
    (flags & F.sliding) !== 0
      ? FIGURE_STANCE.slide
      : (flags & F.crouching) !== 0
        ? FIGURE_STANCE.crouch
        : FIGURE_STANCE.stand;
  const mode =
    (flags & F.ads) !== 0 ? FIGURE_MODE.ads : (flags & F.sprinting) !== 0 ? FIGURE_MODE.sprint : FIGURE_MODE.base;
  return figurePosture(stance, grip, mode, kind === ENTITY_KIND.zombie);
  // fim-quente
}

// --- Tabela ligada (funções livres) ---

/** Até quantas sims vivas a lista guarda; acima disso a mais antiga sai da lista (a sim dela segue com a própria). */
const BOUND_MAX = 8;
const bound: FigureGameTable[] = [];

/** Liga a tabela da partida às funções livres (o `createSim` chama na criação). Sem alocação depois do loading. */
export function bindFigureTable(table: FigureGameTable): void {
  bound.push(table);
  if (bound.length > BOUND_MAX) bound.shift();
}

/** Solta uma ligação da tabela (o `dispose` da sim): sem nenhuma sim viva, nada mais aponta para ela. */
export function unbindFigureTable(table: FigureGameTable): void {
  const i = bound.lastIndexOf(table);
  if (i >= 0) bound.splice(i, 1);
  // Sem outra ligação, os caches das funções livres também a soltam (regra 21: o dono é a partida).
  if (bound.indexOf(table) < 0) {
    if (FREE.table === table) FREE.release();
    if (AIM_CACHE.table === table) AIM_CACHE.release();
  }
}

/** A tabela das funções livres: a da sim viva mais recente. */
export function boundFigureTable(): FigureGameTable {
  const t = bound[bound.length - 1];
  if (t === undefined) throw new Error('sim: sem tabela de jogo do boneco (crie a sim antes, ou bindFigureTable)');
  return t;
}

// --- Raio ---

/** Entrada do raio na caixa [min, max] (slab test), ou `Infinity`. Origem dentro da caixa dá 0. */
export function rayBoxEntry(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
  maxT: number,
): number {
  let tmin = 0;
  let tmax = maxT;
  if (dx > -1e-12 && dx < 1e-12) {
    if (ox < minX || ox > maxX) return Infinity;
  } else {
    const inv = 1 / dx;
    let t1 = (minX - ox) * inv;
    let t2 = (maxX - ox) * inv;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return Infinity;
  }
  if (dy > -1e-12 && dy < 1e-12) {
    if (oy < minY || oy > maxY) return Infinity;
  } else {
    const inv = 1 / dy;
    let t1 = (minY - oy) * inv;
    let t2 = (maxY - oy) * inv;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return Infinity;
  }
  if (dz > -1e-12 && dz < 1e-12) {
    if (oz < minZ || oz > maxZ) return Infinity;
  } else {
    const inv = 1 / dz;
    let t1 = (minZ - oz) * inv;
    let t2 = (maxZ - oz) * inv;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return Infinity;
  }
  return tmin;
}

/**
 * Menor y (m, a partir dos pés) que uma hitbox da tabela alcança em qualquer pitch: o chão da fase larga. A tabela só
 * guarda o raio e o topo; entre as amostras a caixa gira (a faixa vertical pode passar das amostras) e cresce da folga,
 * então o limite usa a meia diagonal com a maior folga. Conservador: a fase larga só corta cedo. Só no loading.
 */
function tableBottom(t: FigureGameTable): number {
  let slack = 0;
  for (let i = 0; i < t.slack.length; i++) slack = Math.max(slack, t.slack[i]!);
  let lo = 0;
  for (let o = 0; o < t.boxes.length; o += FIGURE_HIT_STRIDE) {
    const hx = t.boxes[o + HF.hx]! + slack;
    const hy = t.boxes[o + HF.hy]! + slack;
    const hz = t.boxes[o + HF.hz]! + slack;
    lo = Math.min(lo, t.boxes[o + HF.cy]! - Math.sqrt(hx * hx + hy * hy + hz * hz));
  }
  return lo - 0.01;
}

/**
 * Hitboxes no mundo com cache POR ENTIDADE POR TICK (PLANO §C5 e adendo H): a fase larga lê o raio e o topo da postura
 * na tabela; só quem passa dela tem as 12 caixas montadas (`figureHitBoxes` + yaw + posição), uma vez por tick e
 * postura, e os outros raios do tick contra o mesmo corpo reusam. Sem alocação: as caixas ficam num slot por
 * controlador (corpo de bobo e zumbi sempre tem um), e o raio e o resultado vão em typed arrays (passar double para
 * função não inlinada aloca ~16 B no V8). A única chamada com double é a do `figureHitBoxes` (o pitch), uma vez por
 * corpo por tick.
 */
export class FigureHitCache {
  /** Tabela da partida; `null` depois do `release` (o objeto é solto no fim). */
  table: FigureGameTable | null = null;
  /** Origem, direção, melhor entrada (`R_BEST`) e chão da fase larga (`R_BOTTOM`). */
  readonly ray = new Float64Array(RAY_SIZE);
  /** Caixas no mundo, `W_ROW` por slot. */
  private readonly boxes: Float64Array;
  /** Tick e chave (entidade × 32 + postura) de cada slot; tick −1 = vazio. */
  private readonly stampTick: Int32Array;
  private readonly stampKey: Int32Array;
  /** Saída de `figureHitBoxes` (frame da tabela). */
  private readonly local = new Float64Array(LOCAL_ROW);
  /** Último slot: sem cache (corpo sem controlador, ou a função livre). */
  readonly spare: number;

  /** `slots` = slots com cache (controladores); mais 1 sem cache. */
  constructor(table: FigureGameTable | null, slots: number) {
    this.spare = slots;
    this.boxes = new Float64Array((slots + 1) * W_ROW);
    this.stampTick = new Int32Array(slots + 1).fill(-1);
    this.stampKey = new Int32Array(slots + 1).fill(-1);
    if (table !== null) this.setTable(table);
  }

  /** Troca a tabela (o chão da fase larga é recalculado só quando ela muda) e esvazia o cache. */
  setTable(table: FigureGameTable): void {
    if (table !== this.table) {
      this.table = table;
      this.ray[R_BOTTOM] = tableBottom(table);
    }
    this.invalidate();
  }

  /** Esvazia o cache (leitura de snapshot: o tick volta e as posições mudam). */
  invalidate(): void {
    this.stampTick.fill(-1);
  }

  /** Solta a tabela (fim da partida). */
  release(): void {
    this.table = null;
    this.invalidate();
  }

  /** Começa um raio (origem e direção unitária, m): a entrada tem de ser < `maxT`. */
  beginRay(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): void {
    const r = this.ray;
    r[R_OX] = ox;
    r[R_OY] = oy;
    r[R_OZ] = oz;
    r[R_DX] = dx;
    r[R_DY] = dy;
    r[R_DZ] = dz;
    r[R_BEST] = maxT;
  }

  /** Melhor entrada até aqui (o `maxT` do `beginRay` se nada foi acertado). */
  bestT(): number {
    return this.ray[R_BEST]!;
  }

  /**
   * Raio do `beginRay` contra o corpo `e` da sim, na `posture` (de `figurePostureOf`), no `tick`: devolve o osso
   * acertado (`FigurePart`) se a entrada for menor que a melhor até aqui (e a guarda como a nova melhor), ou −1.
   */
  testEntity(s: SimState, e: number, posture: number, tick: number): number {
    const c = s.controller[e]!;
    const slot = c >= 0 && c < this.spare ? c : this.spare;
    return this.test(posture, s.position, e * 3, s.yaw, s.pitch, e, slot, e * KEY_POSTURES + posture, tick);
  }

  /**
   * O raio do `beginRay` contra um corpo com os pés em pos[p3 ..], yaw[i] e pitch[i] na `posture`; o slot `slot` guarda
   * as caixas do tick com a chave `key` (o `spare` nunca reusa). Devolve o osso ou −1 (como `testEntity`).
   */
  test(
    posture: number,
    pos: Float64Array,
    p3: number,
    yaw: Float64Array,
    pitch: Float64Array,
    i: number,
    slot: number,
    key: number,
    tick: number,
  ): number {
    const table = this.table;
    if (table === null) throw new Error('sim: tabela de jogo solta (dispose)');
    // quente:
    const r = this.ray;
    // Fase larga: caixa alinhada aos eixos do mundo com o raio e o topo da postura (todo pitch, com a folga).
    const radius = table.broad[posture * 2]!;
    const px = pos[p3]!;
    const py = pos[p3 + 1]!;
    const pz = pos[p3 + 2]!;
    const best = r[R_BEST]!;
    let tmin = 0;
    let tmax = best;
    let o = r[R_OX]! - px;
    let d = r[R_DX]!;
    let lo = -radius;
    let hi = radius;
    for (let k = 0; k < 3; k++) {
      if (k === 1) {
        o = r[R_OY]! - py;
        d = r[R_DY]!;
        lo = r[R_BOTTOM]!;
        hi = table.broad[posture * 2 + 1]!;
      } else if (k === 2) {
        o = r[R_OZ]! - pz;
        d = r[R_DZ]!;
        lo = -radius;
        hi = radius;
      }
      if (d > -1e-12 && d < 1e-12) {
        if (o < lo || o > hi) return -1;
      } else {
        const inv = 1 / d;
        let t1 = (lo - o) * inv;
        let t2 = (hi - o) * inv;
        if (t1 > t2) {
          const tmp = t1;
          t1 = t2;
          t2 = tmp;
        }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) return -1;
      }
    }
    // Caixas do tick (montadas uma vez por corpo, tick e postura).
    const w = slot * W_ROW;
    if (slot === this.spare || this.stampTick[slot] !== tick || this.stampKey[slot] !== key) {
      this.place(table, posture, pos, p3, yaw, pitch, i, w);
      this.stampTick[slot] = tick;
      this.stampKey[slot] = key;
    }
    // O corte dos braços é em volta do eixo deste corpo (a fase larga acima não corta: continua conservadora).
    r[R_AXIS_X] = px;
    r[R_AXIS_Z] = pz;
    return this.narrow(w);
    // fim-quente
  }

  /**
   * Guarda no `slot` (chave `key`, `tick`) as caixas JÁ montadas em `src` (frame da tabela, saída de `figureHitBoxes`),
   * levadas ao mundo (pés em pos[p3 ..], yaw[i]): quem já tem as caixas locais (a mira visível) não monta de novo.
   */
  stampFrom(
    src: Float64Array,
    pos: Float64Array,
    p3: number,
    yaw: Float64Array,
    i: number,
    slot: number,
    key: number,
    tick: number,
  ): void {
    // quente:
    this.toWorld(src, pos, p3, yaw, i, slot * W_ROW);
    this.stampTick[slot] = tick;
    this.stampKey[slot] = key;
    // fim-quente
  }

  /** As 12 caixas da postura no pitch[i], levadas ao mundo (pés em pos[p3 ..], yaw[i]), em boxes[w ..]. */
  private place(
    table: FigureGameTable,
    posture: number,
    pos: Float64Array,
    p3: number,
    yaw: Float64Array,
    pitch: Float64Array,
    i: number,
    w: number,
  ): void {
    // quente:
    figureHitBoxes(table, posture, pitch[i]!, this.local, 0);
    this.toWorld(this.local, pos, p3, yaw, i, w);
    // fim-quente
  }

  /** Caixas do frame da tabela (`src`) → mundo (pés em pos[p3 ..], yaw[i]), em boxes[w ..]. */
  private toWorld(src: Float64Array, pos: Float64Array, p3: number, yaw: Float64Array, i: number, w: number): void {
    // quente:
    const dst = this.boxes;
    const c = Math.cos(yaw[i]!);
    const s = Math.sin(yaw[i]!);
    const px = pos[p3]!;
    const py = pos[p3 + 1]!;
    const pz = pos[p3 + 2]!;
    for (let b = 0; b < FIGURE_BONES; b++) {
      const h = b * FIGURE_HIT_STRIDE;
      const q = w + b * W_STRIDE;
      const x = src[h + HF.cx]!;
      const z = src[h + HF.cz]!;
      dst[q] = px + c * x - s * z;
      dst[q + 1] = py + src[h + HF.cy]!;
      dst[q + 2] = pz - s * x - c * z;
      // Coluna j de R (eixo j da caixa no frame da tabela) → mundo.
      for (let j = 0; j < 3; j++) {
        const rx = src[h + HF.r00 + j]!;
        const rz = src[h + HF.r20 + j]!;
        dst[q + 3 + j * 3] = c * rx - s * rz;
        dst[q + 4 + j * 3] = src[h + HF.r10 + j]!;
        dst[q + 5 + j * 3] = -s * rx - c * rz;
      }
      dst[q + 12] = src[h + HF.hx]!;
      dst[q + 13] = src[h + HF.hy]!;
      dst[q + 14] = src[h + HF.hz]!;
    }
    // fim-quente
  }

  /**
   * Fase estreita: o raio contra as 12 caixas do slot; a de menor entrada (a 1ª no empate) se < R_BEST. As caixas de
   * braço só valem dentro do corte (`ARM_HIT_CUT_M` em x e z do mundo em volta do eixo R_AXIS_X/Z): se a entrada numa
   * delas cai fora do corte, o trecho do raio na caixa é cortado pela faixa do raio dentro do prisma do corte (slab
   * test em x e z, feito só nesse caso e uma vez por chamada; o caso comum só confere o ponto de entrada).
   */
  private narrow(w: number): number {
    // quente:
    const r = this.ray;
    const bx = this.boxes;
    const ox = r[R_OX]!;
    const oy = r[R_OY]!;
    const oz = r[R_OZ]!;
    const dx = r[R_DX]!;
    const dy = r[R_DY]!;
    const dz = r[R_DZ]!;
    let best = r[R_BEST]!;
    // Faixa do raio dentro do corte dos braços (vazia: cutLo > cutHi), calculada na 1ª vez que precisa.
    let cutLo = 0;
    let cutHi = -1;
    let cutReady = false;
    let bone = -1;
    for (let b = 0; b < FIGURE_BONES; b++) {
      const q = w + b * W_STRIDE;
      const rx = ox - bx[q]!;
      const ry = oy - bx[q + 1]!;
      const rz = oz - bx[q + 2]!;
      let tmin = 0;
      let tmax = best;
      let j = 0;
      for (; j < 3; j++) {
        const ax = bx[q + 3 + j * 3]!;
        const ay = bx[q + 4 + j * 3]!;
        const az = bx[q + 5 + j * 3]!;
        const h = bx[q + 12 + j]!;
        // Origem e direção no eixo j da caixa (centro na origem).
        const e = ax * rx + ay * ry + az * rz;
        const f = ax * dx + ay * dy + az * dz;
        if (f > -1e-12 && f < 1e-12) {
          if (e < -h || e > h) break;
        } else {
          const inv = 1 / f;
          let t1 = (-h - e) * inv;
          let t2 = (h - e) * inv;
          if (t1 > t2) {
            const tmp = t1;
            t1 = t2;
            t2 = tmp;
          }
          if (t1 > tmin) tmin = t1;
          if (t2 < tmax) tmax = t2;
          if (tmin > tmax) break;
        }
      }
      if (j < 3 || tmin >= best) continue;
      if (FIGURE_PART_CATEGORY[b] === ARM_CATEGORY) {
        const ex = ox + dx * tmin - r[R_AXIS_X]!;
        const ez = oz + dz * tmin - r[R_AXIS_Z]!;
        if (ex < -ARM_HIT_CUT_M || ex > ARM_HIT_CUT_M || ez < -ARM_HIT_CUT_M || ez > ARM_HIT_CUT_M) {
          if (!cutReady) {
            cutReady = true;
            cutHi = Infinity;
            for (let k = 0; k < 2; k++) {
              const e = k === 0 ? ox - r[R_AXIS_X]! : oz - r[R_AXIS_Z]!;
              const f = k === 0 ? dx : dz;
              if (f > -1e-12 && f < 1e-12) {
                if (e < -ARM_HIT_CUT_M || e > ARM_HIT_CUT_M) cutHi = -1;
              } else {
                const inv = 1 / f;
                let t1 = (-ARM_HIT_CUT_M - e) * inv;
                let t2 = (ARM_HIT_CUT_M - e) * inv;
                if (t1 > t2) {
                  const tmp = t1;
                  t1 = t2;
                  t2 = tmp;
                }
                if (t1 > cutLo) cutLo = t1;
                if (t2 < cutHi) cutHi = t2;
              }
            }
          }
          // O trecho do raio na caixa dentro do corte: [max(entrada, cutLo); min(saída, cutHi)].
          if (cutLo > tmin) tmin = cutLo;
          if (cutHi < tmax) tmax = cutHi;
          if (tmin > tmax || tmin >= best) continue;
        }
      }
      best = tmin;
      bone = b;
    }
    if (bone >= 0) r[R_BEST] = best;
    return bone;
    // fim-quente
  }
}

/** Saída de `rayVsBobo`, preenchida só quando acerta: categoria de dano, parte do modelo e distância. */
export interface BoboHit {
  /** Categoria de dano: 0 cabeça, 1 tronco, 2 braço, 3 perna (`HIT_PARTS` do context; `FIGURE_PART_CATEGORY`). */
  part: number;
  /** Qual dos 12 ossos (`FIGURE_BONE`): a cor dos cubinhos e o desmonte saem dele. */
  bodyPart: FigurePart;
  t: number;
}

export function createBoboHit(): BoboHit {
  return { part: 1, bodyPart: 1, t: Infinity };
}

/** Cache de um slot só (sem reuso) das funções livres; a tabela é a ligada no momento da chamada. */
const FREE = new FigureHitCache(null, 0);
const FREE_POS = new Float64Array(3);
const FREE_YAW = new Float64Array(1);
const FREE_PITCH = new Float64Array(1);

/**
 * Raio (origem e direção unitária em metros) contra as hitboxes de um bobo com os pés em (px, py, pz), virado para
 * `yaw`, na `posture` (`figurePostureOf`) e no `pitch` da mira dele. Devolve a distância de entrada (< `maxT`) ou
 * `Infinity`; escreve a categoria e o osso em `out`. Usa a tabela ligada e monta as caixas a cada chamada: é para a IA,
 * as ferramentas e os testes. A sim usa o `FigureHitCache` (caixas por corpo por tick).
 */
export function rayVsBobo(
  px: number,
  py: number,
  pz: number,
  yaw: number,
  posture: number,
  pitch: number,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxT: number,
  out: BoboHit,
): number {
  const cache = FREE;
  const table = boundFigureTable();
  if (cache.table !== table) cache.setTable(table);
  // quente:
  FREE_POS[0] = px;
  FREE_POS[1] = py;
  FREE_POS[2] = pz;
  FREE_YAW[0] = yaw;
  FREE_PITCH[0] = pitch;
  cache.beginRay(ox, oy, oz, dx, dy, dz, maxT);
  const bone = cache.test(posture, FREE_POS, 0, FREE_YAW, FREE_PITCH, 0, cache.spare, -1, -1);
  if (bone < 0) {
    out.t = Infinity;
    return Infinity;
  }
  const t = cache.bestT();
  out.part = FIGURE_PART_CATEGORY[bone]!;
  out.bodyPart = bone as FigurePart;
  out.t = t;
  return t;
  // fim-quente
}

// --- Mira, parte pela altura e olho ---

/**
 * Ponto que a IA mira (centro da hitbox da cabeça ou do tronco) na postura e no pitch do ALVO, no frame do alvo: y a
 * partir dos pés e z para a frente dele (x = 0, o eixo). Leve ao mundo pelo yaw do alvo (`aimPointWorld` faz).
 */
export function aimPointLocal(posture: number, pitch: number, head: boolean, out: FigureAimOut): void {
  figureAimPoint(boundFigureTable(), posture, pitch, head, out);
}

/** Ponto no mundo (m). */
export interface AimPoint {
  x: number;
  y: number;
  z: number;
}

/** Os campos da entidade que a mira lê (a `SimView` e o `SimState` servem). */
export interface BodyArrays {
  readonly flags: Uint32Array;
  readonly weapon: Uint8Array;
  readonly kind: Uint8Array;
  readonly position: Float64Array;
  readonly yaw: Float64Array;
  readonly pitch: Float64Array;
}

const AIM_LOCAL: FigureAimOut = { y: 0, z: 0 };

/**
 * Ponto de mira no MUNDO do corpo `i` (cabeça ou tronco): postura pelos bits e pela arma dele, `aimPointLocal` no pitch
 * dele, levado ao mundo pela posição e pelo yaw dele. Sem alocação (só índices e arrays na chamada).
 */
export function aimPointWorld(body: BodyArrays, i: number, head: boolean, out: AimPoint): void {
  aimPointWorldWith(boundFigureTable(), body, i, head, out);
}

/** `aimPointWorld` com a tabela dada (a sim usa a dela). */
export function aimPointWorldWith(
  table: FigureGameTable,
  body: BodyArrays,
  i: number,
  head: boolean,
  out: AimPoint,
): void {
  // quente:
  const posture = figurePostureOf(body.flags[i]!, weaponGrip(body.weapon[i]!), body.kind[i]!);
  figureAimPoint(table, posture, body.pitch[i]!, head, AIM_LOCAL);
  const yaw = body.yaw[i]!;
  const i3 = i * 3;
  out.x = body.position[i3]! - Math.sin(yaw) * AIM_LOCAL.z;
  out.y = body.position[i3 + 1]! + AIM_LOCAL.y;
  out.z = body.position[i3 + 2]! - Math.cos(yaw) * AIM_LOCAL.z;
  // fim-quente
}

/**
 * Grade de candidatos de mira na caixa da cabeça ou do tronco: (direita, cima) = (AIM_STEPS[i], AIM_STEPS[j]) em
 * frações das meias medidas, no plano do centro da caixa (5 × 5).
 */
const AIM_STEPS = [-0.8, -0.4, 0, 0.4, 0.8];
const AIM_N = AIM_STEPS.length;
/** Quais candidatos da grade o olho vê, em i·AIM_N + j (rascunho da chamada). */
const AIM_SEEN = new Uint8Array(AIM_N * AIM_N);
/** Cache de 1 slot da mira visível: as caixas são montadas uma vez por chamada (o "tick" é o contador). */
const AIM_CACHE = new FigureHitCache(null, 1);
const AIM_BOXES = new Float64Array(LOCAL_ROW);
/** O alvo da mira visível fica nos pés da origem com yaw 0: o mundo é o frame dele com z trocado de sinal. */
const AIM_ORIGIN = new Float64Array(3);
const AIM_YAW = new Float64Array(1);
const AIM_PITCH = new Float64Array(1);
/** Rascunho da mira visível: olho (0..2), candidato (u, v) em frações (3..4) e o ponto dele no frame do alvo (5..7). */
const AIM_SCRATCH = new Float64Array(8);
const AIM_EYE: AimPoint = { x: 0, y: 0, z: 0 };
let aimCalls = 0;

/**
 * O olho (AIM_SCRATCH[0..2], frame do alvo) vê o candidato (AIM_SCRATCH[3..4]) da caixa `bone` da postura? Escreve o
 * ponto do candidato em AIM_SCRATCH[5..7]. As caixas do alvo já estão em AIM_BOXES e no slot 0 do AIM_CACHE (tick
 * `aimCalls`). Lê tudo de typed arrays: passar double a função não inlinada aloca no V8.
 */
function aimSees(posture: number, bone: number): boolean {
  // quente:
  const sc = AIM_SCRATCH;
  const local = AIM_BOXES;
  const o = bone * FIGURE_HIT_STRIDE;
  const u = sc[3]! * local[o + HF.hx]!;
  const v = sc[4]! * local[o + HF.hy]!;
  // Candidato no frame do alvo: o centro da caixa mais u na direita e v no cima dela.
  const x = local[o + HF.cx]! + local[o + HF.r00]! * u + local[o + HF.r01]! * v;
  const y = local[o + HF.cy]! + local[o + HF.r10]! * u + local[o + HF.r11]! * v;
  const z = local[o + HF.cz]! + local[o + HF.r20]! * u + local[o + HF.r21]! * v;
  sc[5] = x;
  sc[6] = y;
  sc[7] = z;
  // Raio do olho ao candidato no mundo do alvo na origem com yaw 0 (z do mundo = −z do frame).
  let dx = x - sc[0]!;
  let dy = y - sc[1]!;
  let dz = sc[2]! - z;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 1e-6) return true;
  dx /= len;
  dy /= len;
  dz /= len;
  const cache = AIM_CACHE;
  cache.beginRay(sc[0]!, sc[1]!, -sc[2]!, dx, dy, dz, len + 1);
  return cache.test(posture, AIM_ORIGIN, 0, AIM_YAW, AIM_PITCH, 0, 0, posture, aimCalls) === bone;
  // fim-quente
}

/**
 * Desvio (frame do alvo: x = direita, y = cima, z = frente, m) do ponto de mira (`aimPointLocal`, o centro da caixa)
 * para o meio da parte da caixa da cabeça ou do tronco que o olho em `eye` (frame do alvo) VÊ. Com arma, o antebraço
 * de apoio tapa o queixo no ADS e o peito agachado (E.5): mirar o centro jogaria o erro de mira para baixo no braço.
 * Testa a grade 5 × 5 da caixa (o raio até o candidato acerta a própria caixa primeiro?) e mira o centróide dos
 * candidatos vistos; se o centróide estiver tapado, o candidato visto mais perto dele. Nenhum visível: desvio 0.
 * Monta as caixas uma vez e testa até 27 raios (~10 µs com JIT, 0,23–0,26 ms jitless): para a IA de tempos em tempos e
 * na troca de postura do alvo, com teto por tick (`AI_SOLDIER.visibleAimPerTick`), nunca a cada tick por bot.
 */
export function visibleAimLocal(posture: number, pitch: number, head: boolean, eye: AimPoint, out: AimPoint): void {
  const table = boundFigureTable();
  const cache = AIM_CACHE;
  if (cache.table !== table) cache.setTable(table);
  aimCalls = (aimCalls + 1) & 0x3fffffff;
  // quente:
  AIM_PITCH[0] = pitch;
  const local = AIM_BOXES;
  figureHitBoxes(table, posture, pitch, local, 0);
  // As mesmas caixas vão para o slot 0 do cache (alvo na origem, yaw 0): os raios da grade não montam de novo.
  cache.stampFrom(local, AIM_ORIGIN, 0, AIM_YAW, 0, 0, posture, aimCalls);
  const bone = head ? FIGURE_BONE.head : FIGURE_BONE.torso;
  const o = bone * FIGURE_HIT_STRIDE;
  const sc = AIM_SCRATCH;
  sc[0] = eye.x;
  sc[1] = eye.y;
  sc[2] = eye.z;
  out.x = 0;
  out.y = 0;
  out.z = 0;
  let seen = 0;
  let cu = 0;
  let cv = 0;
  for (let i = 0; i < AIM_N; i++) {
    for (let j = 0; j < AIM_N; j++) {
      sc[3] = AIM_STEPS[i]!;
      sc[4] = AIM_STEPS[j]!;
      const ok = aimSees(posture, bone);
      AIM_SEEN[i * AIM_N + j] = ok ? 1 : 0;
      if (ok) {
        seen++;
        cu += sc[3]!;
        cv += sc[4]!;
      }
    }
  }
  if (seen === 0) return;
  // O centróide dos vistos; tapado, o visto mais perto dele.
  cu /= seen;
  cv /= seen;
  sc[3] = cu;
  sc[4] = cv;
  if (!aimSees(posture, bone)) {
    let bestI = 0;
    let bestJ = 0;
    let bestD = Infinity;
    for (let i = 0; i < AIM_N; i++) {
      for (let j = 0; j < AIM_N; j++) {
        if (AIM_SEEN[i * AIM_N + j] === 0) continue;
        const du = AIM_STEPS[i]! - cu;
        const dv = AIM_STEPS[j]! - cv;
        const d = du * du + dv * dv;
        if (d < bestD) {
          bestD = d;
          bestI = i;
          bestJ = j;
        }
      }
    }
    sc[3] = AIM_STEPS[bestI]!;
    sc[4] = AIM_STEPS[bestJ]!;
    aimSees(posture, bone);
  }
  // O ponto de mira é (0, cy, cz) do centro interpolado: o desvio sai dele.
  out.x = sc[5]!;
  out.y = sc[6]! - local[o + HF.cy]!;
  out.z = sc[7]! - local[o + HF.cz]!;
  // fim-quente
}

/**
 * `visibleAimLocal` para o corpo `i` (postura pelos bits e pela arma dele, pitch dele) com o olho `eye` no MUNDO; o
 * desvio sai no frame do alvo (leve ao mundo pelo yaw dele, junto com o `aimPointWorld`).
 */
export function visibleAimOffset(body: BodyArrays, i: number, head: boolean, eye: AimPoint, out: AimPoint): void {
  // quente:
  const posture = figurePostureOf(body.flags[i]!, weaponGrip(body.weapon[i]!), body.kind[i]!);
  const yaw = body.yaw[i]!;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const i3 = i * 3;
  const rx = eye.x - body.position[i3]!;
  const rz = eye.z - body.position[i3 + 2]!;
  AIM_EYE.x = c * rx - s * rz;
  AIM_EYE.y = eye.y - body.position[i3 + 1]!;
  AIM_EYE.z = -s * rx - c * rz;
  visibleAimLocal(posture, body.pitch[i]!, head, AIM_EYE, out);
  // fim-quente
}

/**
 * Parte do corpo (`FIGURE_BONE`) pela altura `h` de um ponto a partir dos pés, pela base (minY) das hitboxes da postura
 * no pitch: cabeça, tronco, coxa, canela e, abaixo de tudo, o pé (lado direito para as pernas).
 */
export function bodyPartAtHeight(posture: number, pitch: number, h: number): FigurePart {
  return figureBodyPartAtHeight(boundFigureTable(), posture, pitch, h);
}

/** Altura do olho (a partir dos pés, no eixo da entidade) conforme o agachamento. */
export function eyeHeightFor(flags: number): number {
  return (flags & ENTITY_FLAG.crouching) !== 0 ? METRICS.crouchEyeHeight : METRICS.eyeHeight;
}
