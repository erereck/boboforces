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
  MODIFIERS,
  type FigureAimOut,
  type FigureGameTable,
  type FigureGrip,
  type FigurePart,
} from '@boboforces/format';
import {
  BLOCK_FLAG,
  createRayHit,
  raycastGrid,
  type BlockRegistry,
  type StaticColliders,
  type WorldGrid,
} from '@boboforces/world';
import { METRICS } from './config/metrics.ts';
import { weaponDef } from './config/weapons.ts';
import { BOT_CONTROLLER_BASE, ZOMBIE_CONTROLLER_BASE } from './constants.ts';
import type { SimContext } from './context.ts';
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

/**
 * M9 (fase 1): o tamanho do corpo pelos modificadores Mini (todos com metade) e Bots gigantes (os bots com o triplo).
 * Sem estado novo: sai da máscara de modificadores (que já entra no hash, no snapshot e na rede), do controlador e do
 * tipo. Multiplica o `bodyScale` (Chonker, chefão) nas hitboxes e no desenho; a caixa de colisão e a navegação não
 * mudam (como no Chonker). De propósito não escreve no `bodyScale`: ele só entra no hash do Zombies e do Royale, e os
 * zumbis nascem escrevendo nele.
 *
 * M9 (fase 1b): debaixo de teto baixo o gigante encolhe (`CHAOS_SQUEEZE`, `squeezedScale`); a escala de verdade de
 * cada corpo fica no `SimState.chaosScale` (derivado, `updateChaosScales`), que as hitboxes, o olho, a mira da IA e o
 * desenho leem (`SimView.chaosScale`, `chaosScaleOf`). Esta função dá só a escala da máscara (sem o aperto).
 *
 * Limites aceitos (revisão da fase 1), sem estado novo na rede:
 * - **Quem assume um lugar fica com o corpo do lugar**: o "gigante" é o controlador de bot, não quem joga. O humano
 *   que entra no meio da partida pelo sofá, ou que assume um bot no Aquário, vira gigante (o lugar é de bot); o bot que
 *   ocupa o lugar de um humano que saiu continua normal (o lugar é de humano).
 * - **A volta no tempo** (o tiro do amigo online) testa as posições antigas com o tamanho da máscara de AGORA: só
 *   difere nos < 200 ms em volta da troca da Roleta que liga ou desliga um tamanho.
 * - **As explosões** medem a distância até a caixa de colisão, que não muda: o Mini leva o estilhaço de um bobo inteiro
 *   e o gigante, o de um normal.
 * - **O spawn seguro** (`life.ts`, quem enxerga o ponto) usa o olho normal de todos.
 */
export const CHAOS_SCALE = { mini: 0.5, giantBots: 3 } as const;
const MINI_BIT = 1 << MODIFIERS.indexOf('mini');
const GIANT_BIT = 1 << MODIFIERS.indexOf('giantBots');
/** Os bits da máscara que mudam o tamanho dos corpos. */
export const CHAOS_SCALE_BITS = MINI_BIT | GIANT_BIT;

/**
 * Escala do corpo pela máscara `mask` (bits de `MODIFIERS`): o Mini vale para todo corpo (bobo e zumbi); os Bots
 * gigantes só para os bobos de controlador de bot (humanos são 0..3 e zumbis vêm depois dos bots). 1 = normal. Decide
 * pelo controlador (o lugar), não por quem joga nele: ver os limites em `CHAOS_SCALE`.
 */
export function chaosScale(mask: number, controller: number, kind: number): number {
  if ((mask & CHAOS_SCALE_BITS) === 0) return 1;
  if ((mask & MINI_BIT) !== 0) {
    return kind === ENTITY_KIND.bobo || kind === ENTITY_KIND.zombie ? CHAOS_SCALE.mini : 1;
  }
  return kind === ENTITY_KIND.bobo && controller >= BOT_CONTROLLER_BASE && controller < ZOMBIE_CONTROLLER_BASE
    ? CHAOS_SCALE.giantBots
    : 1;
}

/** O que `chaosMaskScaleOf` lê (a `SimView` serve). */
export interface ChaosMaskBodies {
  readonly chaos: { readonly masks: Int32Array } | null;
  readonly controller: Int16Array;
  readonly kind: Uint8Array;
}

/**
 * `chaosScale` do corpo `e` pela máscara ligada na view (1 sem modificadores), SEM o aperto do teto: "este corpo é
 * gigante?" (a IA prefere caminhos de teto alto por isto, para a escolha não piscar a cada porta).
 */
export function chaosMaskScaleOf(v: ChaosMaskBodies, e: number): number {
  return v.chaos === null ? 1 : chaosScale(v.chaos.masks[0]!, v.controller[e]!, v.kind[e]!);
}

/** O que `chaosScaleOf` lê (a `SimView` e o `SimState` servem). */
export interface ChaosBodies {
  readonly chaosScale: Float32Array;
}

/**
 * M9 (fase 1b): a escala dos modificadores do corpo `e` agora, já apertada debaixo de teto (`SimState.chaosScale`,
 * derivada no fim de cada tick). É a das hitboxes, do olho, da mira da IA e do desenho. 1 = normal.
 */
export function chaosScaleOf(v: ChaosBodies, e: number): number {
  return v.chaosScale[e]!;
}

/**
 * M9 (fase 1b): o aperto do gigante debaixo de teto baixo. A escala de um corpo maior que 1 vira
 * clamp((livre − `gapM`) ÷ topo, 1, escala), com "livre" a altura dos pés até o primeiro bloco em cima (um raio da
 * grade por gigante por tick) e "topo" a altura do desenho em pé ou agachado (com o cabelo e o chapéu: o recorte do
 * cabelo do render vai a 1,99 m em pé e 0,99 m agachado; a hitbox, a `FIGURE_MAX_TOP_M` 1,81 e `FIGURE_CROUCH_TOP_M`
 * 0,97). Assim a cabeça, a arma e o olho do gigante nunca entram na laje; o tamanho 1 é o piso (a caixa de colisão
 * normal já cabe). O Mini e o tamanho 1 não apertam.
 */
export const CHAOS_SQUEEZE = { gapM: 0.1, standTopM: 2, crouchTopM: 1 } as const;

/** O que barra o gigante em cima: bloco sólido ou que para bala ou visão (vidro e grade também). */
const SQUEEZE_MASK = BLOCK_FLAG.solid | BLOCK_FLAG.blocksBullets | BLOCK_FLAG.blocksSight;

/**
 * M9 (fase 1b): a escala `k` da máscara apertada pela altura livre `free` (m, dos pés ao primeiro bloco em cima; ≥
 * `Infinity` = céu aberto) com os bits `flags` (agachado usa o topo agachado). Pura.
 */
export function squeezedScale(k: number, free: number, flags: number): number {
  if (k <= 1) return k;
  const top = (flags & ENTITY_FLAG.crouching) !== 0 ? CHAOS_SQUEEZE.crouchTopM : CHAOS_SQUEEZE.standTopM;
  const fit = (free - CHAOS_SQUEEZE.gapM) / top;
  return fit >= k ? k : fit <= 1 ? 1 : fit;
}

const squeezeHit = createRayHit();

/**
 * M9 (fase 1b): a escala do corpo de escala `k` da máscara com os pés em (x, y, z) e os bits `flags`: o raio da
 * grade sobe do olho normal (sempre dentro da caixa de colisão, livre de bloco) até onde o topo em escala chegaria.
 */
export function squeezedScaleAt(
  grid: WorldGrid,
  blocks: BlockRegistry,
  colliders: StaticColliders | null,
  x: number,
  y: number,
  z: number,
  flags: number,
  k: number,
): number {
  if (k <= 1) return k;
  const crouched = (flags & ENTITY_FLAG.crouching) !== 0;
  const from = crouched ? METRICS.crouchEyeHeight : METRICS.eyeHeight;
  const top = crouched ? CHAOS_SQUEEZE.crouchTopM : CHAOS_SQUEEZE.standTopM;
  const reach = top * k + CHAOS_SQUEEZE.gapM - from;
  if (!raycastGrid(grid, blocks, x, y + from, z, 0, 1, 0, reach, SQUEEZE_MASK, squeezeHit, colliders)) return k;
  return squeezedScale(k, from + squeezeHit.distance, flags);
}

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
/**
 * M9 (fase 1): o corte dos braços no frame do raio. `ARM_HIT_CUT_M` sempre, menos no corpo do Mini e do gigante, que
 * vai testado no frame de tamanho 1 (`testEntity`): lá ele é `ARM_HIT_CUT_M` ÷ a escala, e no mundo o corte não muda.
 */
const R_CUT = 10;
const RAY_SIZE = 11;
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
  /**
   * M6 (fase 4b): o Cabeção: a caixa da cabeça multiplicada por isto, crescendo do pescoço para cima (o centro sobe meia
   * altura a mais, pelo eixo de cima da caixa). 1 = normal. A fase larga ganha as folgas `headTop` e `headSide` (m).
   */
  headScale = 1;
  private headTop = 0;
  private headSide = 0;

  /** `slots` = slots com cache (controladores); mais 1 sem cache. */
  constructor(table: FigureGameTable | null, slots: number) {
    this.spare = slots;
    this.boxes = new Float64Array((slots + 1) * W_ROW);
    this.stampTick = new Int32Array(slots + 1).fill(-1);
    this.stampKey = new Int32Array(slots + 1).fill(-1);
    this.ray[R_CUT] = ARM_HIT_CUT_M;
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

  /** M6 (fase 4b): troca a escala da cabeça (o Cabeção); mudando, esvazia o cache. */
  setHeadScale(k: number): void {
    if (k === this.headScale) return;
    this.headScale = k;
    // A caixa da cabeça tem 0,44 m de altura e 0,25 m de largura: em dobro, o topo sobe 0,44 m (0,48 com a cabeça
    // inclinada) e o canto sai até 0,1 m do raio da fase larga (medido na revisão da 4b). Com folga.
    this.headTop = k > 1 ? 0.55 * (k - 1) : 0;
    this.headSide = k > 1 ? 0.2 * (k - 1) : 0;
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
    // M9 (fase 1): o Mini e os Bots gigantes multiplicam a escala do corpo (fase 1b: a do fim do tick anterior, já
    // apertada debaixo de teto; as caixas do cache ficam no frame de tamanho 1, então mudar não esvazia nada).
    const k = s.chaosScale[e]!;
    const sc = k === 1 ? s.bodyScale[e]! : s.bodyScale[e]! * k;
    if (sc === 1)
      return this.test(posture, s.position, e * 3, s.yaw, s.pitch, e, slot, e * KEY_POSTURES + posture, tick);
    // M3 (fase 3b): corpo em escala (Chonker, chefão): o raio vai para o espaço do corpo em tamanho 1, em volta dos pés
    // (origem e direção ÷ escala); o `t` do acerto continua o do raio do mundo.
    const r = this.ray;
    // M9: no corpo dos modificadores o corte dos braços continua o do mundo (o do Chonker cresce com ele, como antes).
    if (k !== 1) r[R_CUT] = ARM_HIT_CUT_M / k;
    const e3 = e * 3;
    const px = s.position[e3]!;
    const py = s.position[e3 + 1]!;
    const pz = s.position[e3 + 2]!;
    const ox = r[R_OX]!;
    const oy = r[R_OY]!;
    const oz = r[R_OZ]!;
    const dx = r[R_DX]!;
    const dy = r[R_DY]!;
    const dz = r[R_DZ]!;
    const inv = 1 / sc;
    r[R_OX] = px + (ox - px) * inv;
    r[R_OY] = py + (oy - py) * inv;
    r[R_OZ] = pz + (oz - pz) * inv;
    r[R_DX] = dx * inv;
    r[R_DY] = dy * inv;
    r[R_DZ] = dz * inv;
    const hit = this.test(posture, s.position, e3, s.yaw, s.pitch, e, slot, e * KEY_POSTURES + posture, tick);
    r[R_OX] = ox;
    r[R_OY] = oy;
    r[R_OZ] = oz;
    r[R_DX] = dx;
    r[R_DY] = dy;
    r[R_DZ] = dz;
    r[R_CUT] = ARM_HIT_CUT_M;
    return hit;
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
    const radius = table.broad[posture * 2]! + this.headSide;
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
        hi = table.broad[posture * 2 + 1]! + this.headTop;
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
    // M6 (fase 4b): o Cabeção cresce a caixa da cabeça a partir do pescoço (a base dela fica).
    const k = this.headScale;
    if (k !== 1) {
      const q = w + FIGURE_BONE.head * W_STRIDE;
      const up = dst[q + 13]! * (k - 1);
      dst[q] = dst[q]! + dst[q + 6]! * up;
      dst[q + 1] = dst[q + 1]! + dst[q + 7]! * up;
      dst[q + 2] = dst[q + 2]! + dst[q + 8]! * up;
      dst[q + 12] = dst[q + 12]! * k;
      dst[q + 13] = dst[q + 13]! * k;
      dst[q + 14] = dst[q + 14]! * k;
    }
    // fim-quente
  }

  /**
   * Fase estreita: o raio contra as 12 caixas do slot; a de menor entrada (a 1ª no empate) se < R_BEST. As caixas de
   * braço só valem dentro do corte (R_CUT, o `ARM_HIT_CUT_M`, em x e z em volta do eixo R_AXIS_X/Z): se a entrada numa
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
    const cut = r[R_CUT]!;
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
        if (ex < -cut || ex > cut || ez < -cut || ez > cut) {
          if (!cutReady) {
            cutReady = true;
            cutHi = Infinity;
            for (let k = 0; k < 2; k++) {
              const e = k === 0 ? ox - r[R_AXIS_X]! : oz - r[R_AXIS_Z]!;
              const f = k === 0 ? dx : dz;
              if (f > -1e-12 && f < 1e-12) {
                if (e < -cut || e > cut) cutHi = -1;
              } else {
                const inv = 1 / f;
                let t1 = (-cut - e) * inv;
                let t2 = (cut - e) * inv;
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
 * dele, levado ao mundo pela posição e pelo yaw dele. Sem alocação (só índices e arrays na chamada). M9 (fase 1):
 * `scale` é a escala dos modificadores do corpo (`chaosScaleOf`; o ponto cresce a partir dos pés). O `bodyScale` do
 * Chonker fica de fora (a mira dos zumbis grandes é a de sempre).
 */
export function aimPointWorld(body: BodyArrays, i: number, head: boolean, out: AimPoint, scale = 1): void {
  aimPointWorldWith(boundFigureTable(), body, i, head, out, scale);
}

/** `aimPointWorld` com a tabela dada (a sim usa a dela). */
export function aimPointWorldWith(
  table: FigureGameTable,
  body: BodyArrays,
  i: number,
  head: boolean,
  out: AimPoint,
  scale = 1,
): void {
  // quente:
  const posture = figurePostureOf(body.flags[i]!, weaponGrip(body.weapon[i]!), body.kind[i]!);
  figureAimPoint(table, posture, body.pitch[i]!, head, AIM_LOCAL);
  if (scale !== 1) {
    AIM_LOCAL.y *= scale;
    AIM_LOCAL.z *= scale;
  }
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
 * M9 (revisão da fase 1): `scale` é a escala dos modificadores do alvo (o frame aqui é o de tamanho 1, como o
 * `testEntity` faz): o corte dos braços vai ÷ escala, o mesmo da sim, e no mundo continua a 0,75 m.
 */
export function visibleAimLocal(
  posture: number,
  pitch: number,
  head: boolean,
  eye: AimPoint,
  out: AimPoint,
  scale = 1,
): void {
  const table = boundFigureTable();
  const cache = AIM_CACHE;
  if (cache.table !== table) cache.setTable(table);
  aimCalls = (aimCalls + 1) & 0x3fffffff;
  cache.ray[R_CUT] = scale === 1 ? ARM_HIT_CUT_M : ARM_HIT_CUT_M / scale;
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
 * desvio sai no frame do alvo (leve ao mundo pelo yaw dele, junto com o `aimPointWorld`). M9 (fase 1): no corpo em
 * escala (`scale`, a do `aimPointWorld`), o olho vai para o frame de tamanho 1 e o desvio volta multiplicado.
 */
export function visibleAimOffset(
  body: BodyArrays,
  i: number,
  head: boolean,
  eye: AimPoint,
  out: AimPoint,
  scale = 1,
): void {
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
  if (scale !== 1) {
    AIM_EYE.x /= scale;
    AIM_EYE.y /= scale;
    AIM_EYE.z /= scale;
  }
  visibleAimLocal(posture, body.pitch[i]!, head, AIM_EYE, out, scale);
  if (scale !== 1) {
    out.x *= scale;
    out.y *= scale;
    out.z *= scale;
  }
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

/** M9 (fase 1): folga (m) do olho do gigante abaixo do primeiro bloco acima dele. */
export const GIANT_EYE_CEILING_GAP_M = 0.1;
/** O que barra o olho do gigante: bloco que para bala ou visão. */
const EYE_CEILING_MASK = BLOCK_FLAG.blocksBullets | BLOCK_FLAG.blocksSight;
const eyeHit = createRayHit();

/**
 * M9 (fase 1): altura do olho (a partir dos pés) do corpo na escala `scale` dos modificadores (`chaosScale`), com os
 * pés em (x, y, z). Escala 1: `eyeHeightFor`. Menor (o Mini): o olho em escala, sempre dentro da caixa de colisão, que
 * não muda. Maior (o gigante, de caixa normal): o olho em escala, mas nunca além do primeiro bloco (que para bala ou
 * visão) logo acima do olho normal, menos `GIANT_EYE_CEILING_GAP_M`: um raio da grade para cima. Sem isto o gigante
 * embaixo de um teto veria e atiraria do andar de cima.
 *
 * M9 (fase 1b): com a escala já apertada (`SimState.chaosScale`), o olho em escala fica sempre abaixo do teto na
 * posição em que ela foi medida (o fim do tick): o corte só pega no tick em que o gigante entra debaixo de um teto ou
 * levanta de agachado (a escala é a do fim do tick anterior). Fica como rede de segurança.
 */
export function scaledEyeHeight(
  grid: WorldGrid,
  blocks: BlockRegistry,
  colliders: StaticColliders | null,
  x: number,
  y: number,
  z: number,
  flags: number,
  scale: number,
): number {
  const eye = eyeHeightFor(flags);
  if (scale === 1) return eye;
  const want = eye * scale;
  if (scale < 1) return want;
  if (!raycastGrid(grid, blocks, x, y + eye, z, 0, 1, 0, want - eye, EYE_CEILING_MASK, eyeHit, colliders)) return want;
  return Math.min(want, eye + Math.max(0, eyeHit.distance - GIANT_EYE_CEILING_GAP_M));
}

/** O que `viewEyeHeight` lê (a `SimView` serve). */
export interface EyeBodies extends ChaosBodies {
  readonly position: Float64Array;
  readonly world: WorldGrid;
  readonly blocks: BlockRegistry;
  readonly colliders: StaticColliders | null;
}

/** M9 (fase 1): o olho do corpo `e` com os bits `flags` pela view (a IA, a câmera e a mira do jogo). */
export function viewEyeHeight(v: EyeBodies, e: number, flags: number): number {
  const k = chaosScaleOf(v, e);
  if (k === 1) return eyeHeightFor(flags);
  const e3 = e * 3;
  return scaledEyeHeight(
    v.world,
    v.blocks,
    v.colliders,
    v.position[e3]!,
    v.position[e3 + 1]!,
    v.position[e3 + 2]!,
    flags,
    k,
  );
}

/**
 * M9 (revisão da fase 1): `aimPointWorld` do corpo `i` na escala dos modificadores dele (`chaosScaleOf`). É o ponto
 * que a IA olha e mira. Fase 1b: a escala já vem apertada debaixo de teto, então a cabeça e o peito do gigante dentro
 * de casa ficam abaixo da laje (antes o ponto era cortado no olho dele, `viewAimCeiling`, que saiu).
 */
export function viewAimPoint(v: ChaosBodies & BodyArrays, i: number, head: boolean, out: AimPoint): void {
  aimPointWorld(v, i, head, out, chaosScaleOf(v, i));
}

/** M9 (fase 1): o olho do corpo `e` com os bits `flags` na sim (a escala do `SimState.chaosScale`). */
export function simEyeHeight(
  ctx: Pick<SimContext, 's' | 'grid' | 'blocks' | 'colliders'>,
  e: number,
  flags: number,
): number {
  const k = ctx.s.chaosScale[e]!;
  if (k === 1) return eyeHeightFor(flags);
  const p = ctx.s.position;
  const e3 = e * 3;
  return scaledEyeHeight(ctx.grid, ctx.blocks, ctx.colliders, p[e3]!, p[e3 + 1]!, p[e3 + 2]!, flags, k);
}
