import { performance } from 'node:perf_hooks';
import { FIGURE_CROUCH_TOP_M, FIGURE_MAX_TOP_M, type MapDocument } from '@boboforces/format';
import { createNavPath, findPath, NO_NAV_NODE, type NavGridImpl } from '@boboforces/nav';
import { METRICS, MOVEMENT_BOBO } from '@boboforces/sim';
import {
  BLOCK_FLAG,
  BLOCK_SIZE,
  COLLIDER_FLAG,
  COLLIDER_STRIDE,
  MAX_SHAPE_BOXES,
  SHAPE_BOX_STRIDE,
  SHAPE_STEPS,
  shapeCollision,
  shapeCollisionBoxes,
  shapeFloorHeight,
  type BlockRegistry,
  type ShapeId,
  type StaticColliders,
  type WorldGrid,
} from '@boboforces/world';
import type { DoorRecord } from './api.ts';
import { figureLimbProbes, type LimbProbe, type LimbProbes, type LimbTip } from './limb-probe.ts';
import { lineOfSight, measureMaxSightLine, type SightGrid, type SightMeasure } from './sight.ts';

/**
 * Validações do `mapc` que precisam do mundo e da navegação (tecnico.md §15.3, GDD §4.6.3): spawns alcançáveis e
 * invisíveis para o inimigo, portas de 1,0 m, corredores ≥ 1,0 m, maior linha de visão medida, props dentro das
 * paredes e o aviso de "visto sem ver". Mensagens em pt-BR; posições em metros.
 */
export interface CheckInput {
  readonly doc: MapDocument;
  readonly grid: WorldGrid;
  readonly registry: BlockRegistry;
  readonly nav: NavGridImpl;
  readonly sight: SightGrid;
  readonly doors: readonly DoorRecord[];
  /** Colisores das props do jogo (`isPlayableProp`, metros). */
  readonly colliders: StaticColliders;
  /** Nome do modelo de cada caixa (mensagens). */
  readonly colliderModel: readonly string[];
  /** Teto da maior linha de visão declarada (50 m para os mapas que rodam no Switch 3–4P). */
  readonly maxSightLimitM: number;
  /** Sondas da medida de membro através de barreira; sem elas, as da tabela de jogo real (`figureLimbProbes`). */
  readonly limbProbes?: LimbProbes;
}

export interface SpawnStats {
  readonly count: number;
  readonly tdmA: number;
  readonly tdmB: number;
  readonly ffa: number;
  /** A* entre todos os pares ordenados de spawns (ms por busca completa). */
  readonly astarPairs: number;
  readonly astarMeanMs: number;
  readonly astarP99Ms: number;
  readonly astarMaxMs: number;
  readonly astarMeanExpanded: number;
  /** Travessia TDM de um spawn de A até o spawn de B mais perto, correndo (s): mínimo, média, máximo. */
  readonly tdmTravelS: readonly [number, number, number];
}

export interface CheckReport {
  readonly errors: string[];
  readonly warnings: string[];
  readonly spawns: SpawnStats;
  readonly sight: SightMeasure;
  readonly mainComponent: number;
  /** Nós alcançáveis a partir dos spawns e dentro da área jogável. */
  readonly playableNodes: number;
  /**
   * Distância (m) de cada nó do térreo até a cobertura mais próxima (qualquer obstáculo de ≥ 1,0 m acima do piso):
   * mediana, p95 e máximo. GDD §4.6.3 pede cobertura a cada 8–12 m, ou seja, ~4–6 m até a mais próxima.
   */
  readonly cover: { readonly median: number; readonly p95: number; readonly max: number; readonly nodes: number };
  /**
   * Nós jogáveis em pé com "visto sem ver" ao lado (decisão #53): parede que tapa o olho (`eyeHeight`) mas deixa o
   * topo da hitbox em pé (`FIGURE_MAX_TOP_M`, 1,81 m: cabeça do boneco do FutBobo em qualquer pitch) de fora. Só aviso.
   */
  readonly seenWithoutSeeing: number;
  /** Nós jogáveis ao lado de cobertura com topo em `LOW_COVER_BAND` (rente ao agachado). Só aviso. */
  readonly lowCover: number;
  /** Nós jogáveis em pé ao lado de cobertura com topo em `HIGH_COVER_BAND` (a cabeça passa dela). Só aviso. */
  readonly highCover: number;
  /**
   * Braço armado através de barreira (J-M4, risco 14 do PLANO do porte): medida, não aviso. O alcance sai da tabela
   * de jogo (`figureLimbProbes`), não do 0,74 m do PLANO §B4. VISUAL: as caixas inteiras (o braço que aparece do
   * outro lado; a arma não entra na conta).
   */
  readonly armThrough: LimbThroughStats;
  /**
   * O mesmo na HITBOX da sim: braço cortado a `ARM_HIT_CUT_M` do eixo (decisão 1 da §I do PLANO). É o que leva tiro
   * do outro lado.
   */
  readonly armHitThrough: LimbThroughStats;
  /** O mesmo para o corpo inteiro no deslize "carrinho" (pés à frente, nuca atrás): medida, não aviso. Visual. */
  readonly slideThrough: LimbThroughStats;
  /** `slideThrough` na hitbox da sim (só os braços cortados). */
  readonly slideHitThrough: LimbThroughStats;
}

/** Resultado de `LimbProbe` num mapa: nós jogáveis em que a ponta do membro sai do outro lado de uma barreira. */
export interface LimbThroughStats {
  /** Maior alcance da sonda (m do centro do boneco). */
  readonly reachM: number;
  /** Maior alcance por postura (`stand`, `crouch`, `slide`). */
  readonly reachByStance: Readonly<Record<string, number>>;
  /** Nós em que, em alguma postura e direção, a ponta atravessa algo que PARA BALA (o risco do J-M4). */
  readonly bullets: number;
  /** Nós em que ela só atravessa algo que tapa a visão e deixa a bala passar (vazamento de visão, não de dano). */
  readonly sightOnly: number;
  /** Nós com travessia que para bala, por postura. */
  readonly bulletsByStance: Readonly<Record<string, number>>;
  /** O que foi atravessado (ID do bloco ou do modelo da prop) → nós, contando as duas categorias. */
  readonly by: Readonly<Record<string, number>>;
  /** Primeiros nós com travessia que para bala (posição do nó, postura, direção e o que atravessou). */
  readonly samples: readonly string[];
}

/**
 * Faixas dos avisos de cobertura (PLANO do porte §B5), em metros acima do piso do nó, [min, max):
 * - BAIXA, de `aabbCrouchHeight` (0,95) a 1 cm acima do teto da hitbox agachada (`FIGURE_CROUCH_TOP_M`, 0,97): parece
 *   esconder o agachado, mas a hitbox passa do topo ou fica a menos de 1 cm dele (J-I1; a de 1,0 m deixa 3 cm);
 * - ALTA, de `coverHighMin` (1,75) ao teto da hitbox em pé (`FIGURE_MAX_TOP_M`, 1,81): a cobertura "alta" deixa a
 *   cabeça de quem está em pé à mostra em algum pitch (J-M8; ela só esconde a partir de 1,81 m).
 * As duas contam o que para bala (cobertura é contra tiro); o "visto sem ver" conta o que tapa a visão.
 */
export const LOW_COVER_BAND: readonly [number, number] = [METRICS.aabbCrouchHeight, FIGURE_CROUCH_TOP_M + 0.01];
export const HIGH_COVER_BAND: readonly [number, number] = [METRICS.coverHighMin, FIGURE_MAX_TOP_M];

/**
 * Células livres acima do piso para o bobo ficar em pé: `ceil(aabbHeight / 0,5)` (1,75 m → 4 células, decisões #53 e #55).
 * As validações de corredor usam esta altura, a mesma da navegação (`BOBO_NAV_METRICS.height`).
 */
export const STAND_CELLS = Math.ceil(METRICS.aabbHeight / BLOCK_SIZE - 1e-9);
/** Primeira célula (contada a partir do piso) acima do degrau automático: o que ocupa dali até `STAND_CELLS` é parede. */
const WALL_FROM_CELL = Math.round(METRICS.stepHeight / BLOCK_SIZE) + 1;

const fmt = (v: number): string => (Math.round(v * 100) / 100).toString();
const at = (x: number, y: number, z: number): string => `(${fmt(x)}, ${fmt(y)}, ${fmt(z)})`;
/** Medida com vírgula decimal e até 3 casas (texto em pt-BR: 1,425). */
const br = (v: number): string => (Math.round(v * 1000) / 1000).toString().replace('.', ',');

/** Lista curta de posições para a mensagem (as primeiras N). */
function sample(list: readonly string[], n = 6): string {
  return list.length <= n ? list.join(' ') : `${list.slice(0, n).join(' ')} … (+${list.length - n})`;
}

export function runChecks(input: CheckInput): CheckReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { doc, grid, registry, nav } = input;
  const area = doc.markers.playArea;
  const inArea = (x: number, z: number): boolean =>
    x >= area.minX && x <= area.maxX && z >= area.minZ && z <= area.maxZ;

  // --- Células ---
  const collides = (x: number, y: number, z: number): boolean => {
    const cell = grid.get(x, y, z);
    if (cell === 0) return false;
    const b = cell & 0x3ff;
    if ((registry.flags[b]! & BLOCK_FLAG.solid) === 0) return false;
    return shapeCollision(registry.shapes[b] as ShapeId, (cell >>> 10) & 7) !== 'none';
  };
  const floorCell = (x: number, y: number, z: number): boolean => {
    const cell = grid.get(x, y, z);
    if (!collides(x, y, z)) return false;
    const b = cell & 0x3ff;
    if ((registry.flags[b]! & BLOCK_FLAG.walkable) === 0) return false;
    return shapeFloorHeight(registry.shapes[b] as ShapeId, (cell >>> 10) & 7, 0.5, 0.5) >= 0;
  };

  // --- Spawns: nó, componente, alcance (A* dirigido), visibilidade ---
  const spawns = doc.markers.spawns;
  const spawnNode = spawns.map((s, i) => {
    const n = nav.nearestNode(s.x, s.y, s.z);
    const pos = new Float64Array(3);
    if (n === NO_NAV_NODE) {
      errors.push(`spawn ${i} ${at(s.x, s.y, s.z)} sem nó de navegação a menos de 2 m`);
      return NO_NAV_NODE;
    }
    nav.nodePosition(n, pos);
    if (Math.abs(pos[1]! - s.y) > 0.6 || Math.hypot(pos[0]! - s.x, pos[2]! - s.z) > 1.0) {
      errors.push(`spawn ${i} ${at(s.x, s.y, s.z)} longe do nó mais próximo ${at(pos[0]!, pos[1]!, pos[2]!)}`);
    }
    return n;
  });
  const votes = new Map<number, number>();
  for (const n of spawnNode)
    if (n !== NO_NAV_NODE) votes.set(nav.component[n]!, (votes.get(nav.component[n]!) ?? 0) + 1);
  let mainComponent = -1;
  let mainVotes = -1;
  for (const [c, v] of votes) {
    if (v > mainVotes) {
      mainComponent = c;
      mainVotes = v;
    }
  }
  spawnNode.forEach((n, i) => {
    if (n !== NO_NAV_NODE && nav.component[n] !== mainComponent) {
      const s = spawns[i]!;
      errors.push(`spawn ${i} ${at(s.x, s.y, s.z)} fora da área navegável principal (ilhado)`);
    }
  });

  const path = createNavPath(nav, 1024);
  const times: number[] = [];
  let expandedTotal = 0;
  const unreachable: string[] = [];
  const pathLength = (): number => {
    let len = 0;
    for (let p = 1; p < path.pointCount; p++) {
      const o = p * 3;
      len += Math.hypot(path.points[o]! - path.points[o - 3]!, path.points[o + 2]! - path.points[o - 1]!);
    }
    return len;
  };
  const travel = new Map<string, number>();
  for (let i = 0; i < spawns.length; i++) {
    for (let j = 0; j < spawns.length; j++) {
      if (i === j || spawnNode[i] === NO_NAV_NODE || spawnNode[j] === NO_NAV_NODE) continue;
      const t0 = performance.now();
      let expanded = 0;
      let status = findPath(nav, spawnNode[i]!, spawnNode[j]!, path, 256);
      expanded += 256;
      while (status === 'pending') {
        status = findPath(nav, spawnNode[i]!, spawnNode[j]!, path, 256);
        expanded += 256;
      }
      times.push(performance.now() - t0);
      expandedTotal += expanded;
      if (status !== 'found') unreachable.push(`${i}→${j}`);
      else travel.set(`${i}:${j}`, pathLength());
    }
  }
  if (unreachable.length > 0) errors.push(`spawns sem caminho (A* dirigido): ${sample(unreachable, 10)}`);
  times.sort((a, b) => a - b);
  const mean = times.reduce((a, b) => a + b, 0) / Math.max(1, times.length);
  const p99 = times[Math.min(times.length - 1, Math.floor(times.length * 0.99))] ?? 0;

  const teamIdx = (team: number): number[] => spawns.flatMap((s, i) => (s.team === team ? [i] : []));
  const teamA = teamIdx(0);
  const teamB = teamIdx(1);
  const ffa = teamIdx(-1);
  const travels: number[] = [];
  for (const a of teamA) {
    let best = Infinity;
    for (const b of teamB) best = Math.min(best, travel.get(`${a}:${b}`) ?? Infinity);
    if (Number.isFinite(best)) travels.push(best / MOVEMENT_BOBO.sprint);
  }
  const tdmTravelS: [number, number, number] =
    travels.length > 0
      ? [Math.min(...travels), travels.reduce((a, b) => a + b, 0) / travels.length, Math.max(...travels)]
      : [0, 0, 0];

  const eye = METRICS.eyeHeight;
  const sees = (i: number, j: number): boolean => {
    const a = spawns[i]!;
    const b = spawns[j]!;
    return lineOfSight(input.sight, a.x, a.y + eye, a.z, b.x, b.y + eye, b.z);
  };
  // Só nos modos declarados: TDM (time 0 contra time 1) e FFA (todo spawn de qualquer time contra os outros).
  const visible: string[] = [];
  const modes = new Set(doc.meta.modes);
  if (modes.has('warfare.tdm')) {
    for (const a of teamA) for (const b of teamB) if (sees(a, b)) visible.push(`${a}↔${b}`);
  }
  if (modes.has('warfare.ffa')) {
    for (let p = 0; p < ffa.length; p++) {
      for (let q = p + 1; q < ffa.length; q++) if (sees(ffa[p]!, ffa[q]!)) visible.push(`${ffa[p]}↔${ffa[q]}`);
    }
  }
  if (visible.length > 0) errors.push(`spawn visível de spawn inimigo (olho a olho): ${sample(visible, 12)}`);

  // --- Linha de visão medida ---
  // Só os nós ALCANÇÁVEIS a partir dos spawns seguindo as ligações no sentido certo (o componente conta queda nos
  // dois sentidos: o topo de uma parede de onde só se cai entraria na conta sem ninguém conseguir subir lá).
  const reachable = new Uint8Array(nav.nodeCount);
  const queue: number[] = [];
  for (const n of spawnNode) {
    if (n !== NO_NAV_NODE && reachable[n] === 0) {
      reachable[n] = 1;
      queue.push(n);
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const a = queue[q]!;
    for (let l = nav.linkStart[a]!; l < nav.linkStart[a + 1]!; l++) {
      const b = nav.linkTarget[l]!;
      if (reachable[b] === 0) {
        reachable[b] = 1;
        queue.push(b);
      }
    }
  }
  const pos = new Float64Array(3);
  let playableNodes = 0;
  const accept = (n: number): boolean => {
    if (reachable[n] === 0) return false;
    nav.nodePosition(n, pos);
    return inArea(pos[0]!, pos[2]!);
  };
  for (let n = 0; n < nav.nodeCount; n++) if (accept(n)) playableNodes++;
  const sight = measureMaxSightLine(nav, input.sight, accept, eye, METRICS.crouchEyeHeight);
  const declared = doc.meta.maxSightLineM;
  if (declared > input.maxSightLimitM) {
    errors.push(`maior linha de visão declarada (${declared} m) passa do teto do mapa (${input.maxSightLimitM} m)`);
  }
  if (sight.max && sight.max.distance > declared + 1e-6) {
    const m = sight.max;
    errors.push(
      `maior linha de visão MEDIDA (${fmt(m.distance)} m) passa da declarada (${declared} m): ` +
        `${at(...m.a)} → ${at(...m.b)}`,
    );
  } else if (sight.max && declared - sight.max.distance > 5) {
    warnings.push(`linha de visão declarada (${declared} m) bem acima da medida (${fmt(sight.max.distance)} m)`);
  }

  // --- Portas ---
  for (const d of input.doors) {
    const where = at(d.x * BLOCK_SIZE, d.y * BLOCK_SIZE, d.z * BLOCK_SIZE);
    if (d.width !== 2) errors.push(`porta em ${where} com ${d.width * BLOCK_SIZE} m de largura (precisa de 1,0 m)`);
    if (d.height < 4) errors.push(`porta em ${where} com ${d.height * BLOCK_SIZE} m de altura (mínimo 2,0 m)`);
    const start = d.along === 'x' ? d.x : d.z;
    if (start % 2 !== 0) errors.push(`porta em ${where} desalinhada da grade de navegação (1 m)`);
    // A abertura tem parede dos dois lados (senão é um vão maior que a porta).
    for (let t = 0; t < d.thickness; t++) {
      for (let y = d.y + 1; y < d.y + d.height; y++) {
        const ok =
          d.along === 'x'
            ? collides(d.x - 1, y, d.z + t) && collides(d.x + d.width, y, d.z + t)
            : collides(d.x + t, y, d.z - 1) && collides(d.x + t, y, d.z + d.width);
        if (!ok) {
          errors.push(`porta em ${where} sem parede dos dois lados (vão maior que 1,0 m)`);
          t = d.thickness;
          break;
        }
      }
    }
    // Atravessa: de 1,5 m na frente a 1,5 m atrás, por um caminho curto.
    const cx = (d.along === 'x' ? d.x + d.width / 2 : d.x + d.thickness / 2) * BLOCK_SIZE;
    const cz = (d.along === 'z' ? d.z + d.width / 2 : d.z + d.thickness / 2) * BLOCK_SIZE;
    const fy = d.y * BLOCK_SIZE;
    const off = d.thickness * BLOCK_SIZE * 0.5 + 1.5;
    const front = d.along === 'x' ? nav.nearestNode(cx, fy, cz - off) : nav.nearestNode(cx - off, fy, cz);
    const back = d.along === 'x' ? nav.nearestNode(cx, fy, cz + off) : nav.nearestNode(cx + off, fy, cz);
    let through = false;
    if (front !== NO_NAV_NODE && back !== NO_NAV_NODE) {
      let status = findPath(nav, front, back, path, 100000);
      while (status === 'pending') status = findPath(nav, front, back, path, 100000);
      through = status === 'found' && path.length <= Math.ceil(off * 2) + 3;
    }
    if (!through) errors.push(`porta em ${where} não liga os dois lados na navegação`);
  }

  // --- Corredores: fresta de 0,5 m entre paredes e corredor de 1,0 m desalinhado ---
  const narrow: string[] = [];
  const misaligned: string[] = [];
  // Em pé: piso + `STAND_CELLS` células livres. Parede: algo acima do degrau e até a altura do corpo.
  const standable = (x: number, y: number, z: number): boolean => {
    if (!floorCell(x, y, z)) return false;
    for (let o = 1; o <= STAND_CELLS; o++) if (collides(x, y + o, z)) return false;
    return true;
  };
  const wall = (x: number, y: number, z: number): boolean => {
    for (let o = WALL_FROM_CELL; o <= STAND_CELLS; o++) if (collides(x, y + o, z)) return true;
    return false;
  };
  const x0 = Math.max(1, Math.ceil(area.minX / BLOCK_SIZE));
  const x1 = Math.min(grid.sizeX - 2, Math.floor(area.maxX / BLOCK_SIZE) - 1);
  const z0 = Math.max(1, Math.ceil(area.minZ / BLOCK_SIZE));
  const z1 = Math.min(grid.sizeZ - 2, Math.floor(area.maxZ / BLOCK_SIZE) - 1);
  for (let y = 0; y < grid.sizeY - STAND_CELLS; y++) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        if (!standable(x, y, z)) continue;
        const p = at(x * BLOCK_SIZE, (y + 1) * BLOCK_SIZE, z * BLOCK_SIZE);
        if ((wall(x - 1, y, z) && wall(x + 1, y, z)) || (wall(x, y, z - 1) && wall(x, y, z + 1))) narrow.push(p);
        if (x % 2 === 1 && wall(x - 1, y, z) && standable(x + 1, y, z) && wall(x + 2, y, z)) misaligned.push(p);
        if (z % 2 === 1 && wall(x, y, z - 1) && standable(x, y, z + 1) && wall(x, y, z + 2)) misaligned.push(p);
      }
    }
  }
  if (narrow.length > 0) errors.push(`fresta de 0,5 m entre paredes (corredor < 1,0 m) em: ${sample(narrow)}`);
  if (misaligned.length > 0) {
    errors.push(`corredor de 1,0 m desalinhado da grade de navegação (célula ímpar) em: ${sample(misaligned)}`);
  }

  // --- Cobertura: distância até o obstáculo de ≥ 1,0 m mais próximo, nos nós do térreo (transformada de distância
  // chanfrada 3-4 na grade de células, em metros) ---
  const sx = grid.sizeX;
  const sz = grid.sizeZ;
  const dist = new Float64Array(sx * sz).fill(Infinity);
  // Piso do térreo: a camada mais comum dos spawns (os mapas do M1 têm um térreo só).
  const groundCell = Math.round(spawns.reduce((a, sp) => Math.min(a, sp.y), Infinity) / BLOCK_SIZE);
  for (let z = 0; z < sz; z++) {
    for (let x = 0; x < sx; x++) {
      if (collides(x, groundCell + 1, z) || !inArea((x + 0.5) * BLOCK_SIZE, (z + 0.5) * BLOCK_SIZE))
        dist[x + z * sx] = 0;
    }
  }
  const relax = (i: number, j: number, w: number): void => {
    if (dist[j]! + w < dist[i]!) dist[i] = dist[j]! + w;
  };
  for (let z = 0; z < sz; z++) {
    for (let x = 0; x < sx; x++) {
      const i = x + z * sx;
      if (x > 0) relax(i, i - 1, 3);
      if (z > 0) relax(i, i - sx, 3);
      if (x > 0 && z > 0) relax(i, i - sx - 1, 4);
      if (x < sx - 1 && z > 0) relax(i, i - sx + 1, 4);
    }
  }
  for (let z = sz - 1; z >= 0; z--) {
    for (let x = sx - 1; x >= 0; x--) {
      const i = x + z * sx;
      if (x < sx - 1) relax(i, i + 1, 3);
      if (z < sz - 1) relax(i, i + sx, 3);
      if (x < sx - 1 && z < sz - 1) relax(i, i + sx + 1, 4);
      if (x > 0 && z < sz - 1) relax(i, i + sx - 1, 4);
    }
  }
  const coverDist: number[] = [];
  for (let n = 0; n < nav.nodeCount; n++) {
    if (!accept(n) || Math.abs(nav.floorY[n]! - groundCell * BLOCK_SIZE) > 0.01) continue;
    nav.nodePosition(n, pos);
    const cx = Math.floor(pos[0]! / BLOCK_SIZE);
    const cz = Math.floor(pos[2]! / BLOCK_SIZE);
    // O centro do nó fica na quina de 4 células: vale a menor delas (chanfro em terços de célula).
    let d = Infinity;
    for (const [ox, oz] of [
      [-1, -1],
      [0, -1],
      [-1, 0],
      [0, 0],
    ] as const) {
      d = Math.min(d, dist[cx + ox + (cz + oz) * sx]!);
    }
    coverDist.push((d / 3) * BLOCK_SIZE);
  }
  coverDist.sort((a, b) => a - b);
  const pick = (q: number): number => coverDist[Math.min(coverDist.length - 1, Math.floor(coverDist.length * q))] ?? 0;
  const cover = {
    median: pick(0.5),
    p95: pick(0.95),
    max: coverDist[coverDist.length - 1] ?? 0,
    nodes: coverDist.length,
  };
  if (cover.max > 8) warnings.push(`nó do térreo a ${fmt(cover.max)} m da cobertura mais próxima (alvo: ≤ 6 m)`);

  // --- Visto sem ver (decisão #53): ao lado de um nó jogável em pé, parede que tapa o olho mas não o topo da hitbox em
  // pé (1,81 m, `FIGURE_MAX_TOP_M`; com o olho a 1,55 m, a grade de 0,25 m cai nessa faixa só no topo de 1,75 m). Só
  // conta o que tapa a visão (`blocksSight`), pela forma de colisão: tela, vidro fino e cerca deixam ver e não contam.
  const shapeBoxes = new Float32Array(MAX_SHAPE_BOXES * SHAPE_BOX_STRIDE);
  const props = input.colliders;
  let propTop = -1;
  let propMask: number = COLLIDER_FLAG.blocksSight;
  const visitProp = (i: number): boolean => {
    if ((props.flags[i]! & propMask) !== 0) propTop = Math.max(propTop, props.boxes[i * COLLIDER_STRIDE + 4]!);
    return true;
  };
  /**
   * Topo (m) do que tapa a visão (ou, com `bullets`, do que para bala) no ponto, bloco ou prop; -1 se nada. Bloco
   * precisa ser sólido e ter a flag; a prop, a flag do colisor.
   */
  const topAt = (x: number, y: number, z: number, bullets = false): number => {
    let top = -1;
    const cx = Math.floor(x / BLOCK_SIZE);
    const cy = Math.floor(y / BLOCK_SIZE);
    const cz = Math.floor(z / BLOCK_SIZE);
    const cell = grid.get(cx, cy, cz);
    const b = cell & 0x3ff;
    const need = BLOCK_FLAG.solid | (bullets ? BLOCK_FLAG.blocksBullets : BLOCK_FLAG.blocksSight);
    if (cell !== 0 && (registry.flags[b]! & need) === need) {
      const shape = registry.shapes[b] as ShapeId;
      const o = (cell >>> 10) & 7;
      const fx = x / BLOCK_SIZE - cx;
      const fy = y / BLOCK_SIZE - cy;
      const fz = z / BLOCK_SIZE - cz;
      if (shapeCollision(shape, o) === 'slope') {
        const h = shapeFloorHeight(shape, o, fx, fz);
        if (h >= 0 && fy <= h) top = (cy + h) * BLOCK_SIZE;
      } else {
        const n = shapeCollisionBoxes(shape, o, shapeBoxes);
        const [lx, ly, lz] = [fx * SHAPE_STEPS, fy * SHAPE_STEPS, fz * SHAPE_STEPS];
        for (let i = 0; i < n; i++) {
          const s = i * SHAPE_BOX_STRIDE;
          if (lx < shapeBoxes[s]! || lx > shapeBoxes[s + 3]! || lz < shapeBoxes[s + 2]! || lz > shapeBoxes[s + 5]!)
            continue;
          if (ly < shapeBoxes[s + 1]! || ly > shapeBoxes[s + 4]!) continue;
          top = Math.max(top, (cy + shapeBoxes[s + 4]! / SHAPE_STEPS) * BLOCK_SIZE);
        }
      }
    }
    propTop = -1;
    propMask = bullets ? COLLIDER_FLAG.blocksBullets : COLLIDER_FLAG.blocksSight;
    props.query(x, y, z, x, y, z, visitProp);
    return Math.max(top, propTop);
  };
  /** Topo de verdade a partir do ponto: sobe pelo que estiver empilhado em cima (laje, prop); -1 se nada no ponto. */
  const stackTopAt = (x: number, y: number, z: number, bullets = false): number => {
    let top = topAt(x, y, z, bullets);
    if (top < 0) return -1;
    for (let guard = 0; guard < 64; guard++) {
      const above = topAt(x, top + 1e-3, z, bullets);
      if (above <= top) break;
      top = above;
    }
    return top;
  };
  const eyeH = METRICS.eyeHeight;
  const maxTop = FIGURE_MAX_TOP_M;
  // Centro das 8 células coladas no nó de 1 m (2 por lado).
  const ring = [
    [-0.75, -0.25],
    [-0.75, 0.25],
    [0.75, -0.25],
    [0.75, 0.25],
    [-0.25, -0.75],
    [0.25, -0.75],
    [-0.25, 0.75],
    [0.25, 0.75],
  ] as const;
  const seenUnseen: string[] = [];
  for (let n = 0; n < nav.nodeCount; n++) {
    if (nav.clearance[n] !== 1 || !accept(n)) continue;
    nav.nodePosition(n, pos);
    const floor = nav.floorY[n]!;
    for (const [ox, oz] of ring) {
      const top = stackTopAt(pos[0]! + ox, floor + eyeH, pos[2]! + oz);
      if (top >= 0 && top < floor + maxTop - 1e-4) {
        seenUnseen.push(at(pos[0]!, floor, pos[2]!));
        break;
      }
    }
  }
  if (seenUnseen.length > 0) {
    warnings.push(
      `visto sem ver: ${seenUnseen.length} nó(s) jogável(is) ao lado de parede com topo entre o olho ` +
        `(${br(eyeH)} m) e o topo da hitbox em pé (${br(maxTop)} m): ${sample(seenUnseen)}`,
    );
  }

  // --- Cobertura rente à hitbox (PLANO do porte §B5): ao lado de um nó jogável, o que para bala com topo numa das
  // faixas. A sonda entra 1 cm abaixo da faixa e sobe pelo empilhado; a grade de 0,25 m não cai em nenhuma delas
  // (piso e topo de bloco são múltiplos de 0,25), então só prop, rampa ou degrau fora da grade acusa.
  const coverIn = (band: readonly [number, number], standOnly: boolean): string[] => {
    const found: string[] = [];
    for (let n = 0; n < nav.nodeCount; n++) {
      if ((standOnly && nav.clearance[n] !== 1) || !accept(n)) continue;
      nav.nodePosition(n, pos);
      const floor = nav.floorY[n]!;
      for (const [ox, oz] of ring) {
        const top = stackTopAt(pos[0]! + ox, floor + band[0] - 0.01, pos[2]! + oz, true);
        if (top >= floor + band[0] - 1e-4 && top < floor + band[1] - 1e-4) {
          found.push(at(pos[0]!, floor, pos[2]!));
          break;
        }
      }
    }
    return found;
  };
  const lowCover = coverIn(LOW_COVER_BAND, false);
  if (lowCover.length > 0) {
    warnings.push(
      `cobertura rente ao agachado: ${lowCover.length} nó(s) jogável(is) ao lado de cobertura com topo entre ` +
        `${br(LOW_COVER_BAND[0])} e ${br(LOW_COVER_BAND[1])} m (a hitbox agachada vai a ${br(FIGURE_CROUCH_TOP_M)} m): ` +
        sample(lowCover),
    );
  }
  const highCover = coverIn(HIGH_COVER_BAND, true);
  if (highCover.length > 0) {
    warnings.push(
      `cobertura alta que não esconde a cabeça: ${highCover.length} nó(s) jogável(is) em pé ao lado de cobertura ` +
        `com topo entre ${br(HIGH_COVER_BAND[0])} e ${br(HIGH_COVER_BAND[1])} m (a hitbox em pé vai a ` +
        `${br(FIGURE_MAX_TOP_M)} m): ${sample(highCover)}`,
    );
  }

  // --- Membro através de barreira (J-M4): medida para o relatório ---
  const probes = input.limbProbes ?? figureLimbProbes();
  const armThrough = measureLimbThrough(input, accept, probes.arm);
  const armHitThrough = measureLimbThrough(input, accept, probes.armHit);
  const slideThrough = measureLimbThrough(input, accept, probes.slide);
  const slideHitThrough = measureLimbThrough(input, accept, probes.slideHit);

  // --- Travessia TDM (GDD §4.6.3: 12–18 s correndo de spawn a spawn) ---
  if (travels.length > 0 && (tdmTravelS[1] < 12 || tdmTravelS[1] > 18)) {
    warnings.push(
      `travessia TDM média de ${fmt(tdmTravelS[1])} s correndo (GDD §4.6.3 pede 12–18 s; mapa de 72 m a ` +
        `${MOVEMENT_BOBO.sprint} m/s)`,
    );
  }

  // --- Rotas de câmera: a câmera não atravessa bloco ---
  for (const route of doc.markers.routes) {
    const hits: string[] = [];
    for (let i = 1; i < route.points.length; i++) {
      const a = route.points[i - 1]!;
      const b = route.points[i]!;
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / 0.25));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t;
        const z = a.z + (b.z - a.z) * t;
        if (collides(Math.floor(x / BLOCK_SIZE), Math.floor(y / BLOCK_SIZE), Math.floor(z / BLOCK_SIZE))) {
          hits.push(`${i - 1}→${i} ${at(x, y, z)}`);
          break;
        }
      }
    }
    if (hits.length > 0) warnings.push(`rota ${route.name} atravessa bloco (trecho reto): ${sample(hits)}`);
  }

  // --- Props: caixa dentro de parede ou flutuando ---
  const c = input.colliders;
  const inWall: string[] = [];
  const floating: string[] = [];
  for (let i = 0; i < c.count; i++) {
    const o = i * COLLIDER_STRIDE;
    const bx0 = Math.floor((c.boxes[o]! + 0.05) / BLOCK_SIZE);
    const by0 = Math.floor((c.boxes[o + 1]! + 0.05) / BLOCK_SIZE);
    const bz0 = Math.floor((c.boxes[o + 2]! + 0.05) / BLOCK_SIZE);
    const bx1 = Math.floor((c.boxes[o + 3]! - 0.05) / BLOCK_SIZE);
    const by1 = Math.floor((c.boxes[o + 4]! - 0.05) / BLOCK_SIZE);
    const bz1 = Math.floor((c.boxes[o + 5]! - 0.05) / BLOCK_SIZE);
    let hit = false;
    for (let y = by0; y <= by1 && !hit; y++) {
      for (let z = bz0; z <= bz1 && !hit; z++) for (let x = bx0; x <= bx1 && !hit; x++) hit = collides(x, y, z);
    }
    const name = input.colliderModel[i] ?? '?';
    if (hit) inWall.push(`${name}${at(c.boxes[o]!, c.boxes[o + 1]!, c.boxes[o + 2]!)}`);
    const below = Math.floor((c.boxes[o + 1]! - 0.05) / BLOCK_SIZE);
    const mx = Math.floor((c.boxes[o]! + c.boxes[o + 3]!) / 2 / BLOCK_SIZE);
    const mz = Math.floor((c.boxes[o + 2]! + c.boxes[o + 5]!) / 2 / BLOCK_SIZE);
    if (!collides(mx, below, mz) && c.boxes[o + 1]! > 0.01)
      floating.push(`${name}${at(mx * BLOCK_SIZE, c.boxes[o + 1]!, mz * BLOCK_SIZE)}`);
  }
  if (inWall.length > 0) warnings.push(`prop atravessando bloco: ${sample(inWall)}`);
  if (floating.length > 0) warnings.push(`prop sem chão embaixo do centro: ${sample(floating)}`);

  return {
    errors,
    warnings,
    cover,
    seenWithoutSeeing: seenUnseen.length,
    lowCover: lowCover.length,
    highCover: highCover.length,
    armThrough,
    armHitThrough,
    slideThrough,
    slideHitThrough,
    mainComponent,
    playableNodes,
    sight,
    spawns: {
      count: spawns.length,
      tdmA: teamA.length,
      tdmB: teamB.length,
      ffa: ffa.length,
      astarPairs: times.length,
      astarMeanMs: mean,
      astarP99Ms: p99,
      astarMaxMs: times[times.length - 1] ?? 0,
      astarMeanExpanded: expandedTotal / Math.max(1, times.length),
      tdmTravelS,
    },
  };
}

/** Bits de `obstacleAt` em `measureLimbThrough`. */
const OBST_SOLID = 1;
const OBST_BULLETS = 2;
const OBST_SIGHT = 4;
/** Passo da sonda ao longo do membro: 2,5 cm (o painel fino tem 6,25 cm; a cerca de poste, 12,5 cm). */
const LIMB_STEP = 0.025;
/** Bisseções do encosto da AABB: o passo de 2,5 cm vira ~6 µm. */
const LIMB_BISECT = 12;
/**
 * O corpo anda no máximo isto além do centro do nó: meio metro quando há nó vizinho na direção (o resto é dele), 1 m
 * quando não há (a barreira fina tira o nó da coluna dela, e o trecho até ela fica sem dono).
 */
const LIMB_NODE_HALF = 0.5;
const LIMB_NODE_GAP = 1;

/**
 * Membro através de barreira (J-M4, risco 14 do PLANO do porte). Para cada nó jogável (`accept`), cada postura da
 * sonda que cabe nele e as 4 direções dos eixos (as barreiras da grade são alinhadas a eles; o boneco gira e a AABB
 * não, então a ponta usa o alcance em qualquer direção): o corpo anda do centro do nó até a face da AABB encostar no
 * primeiro sólido das alturas do corpo (no máximo `LIMB_NODE_HALF` ou `LIMB_NODE_GAP` além do centro); em cada altura
 * `h` da sonda a ponta fica `reachM(h) − aabbWidth/2` além da face. Conta o nó quando, em alguma altura, o trecho face
 * → ponta começa no ar, atravessa algo que para bala (ou só tapa a visão) e a ponta termina no ar: ela aparece do outro
 * lado da barreira e pode levar tiro de quem não vê o corpo. Medida conservadora no corpo (só a linha do centro
 * encosta) e exata nas formas (encosto por bisseção, a ~6 µm; trecho da ponta a cada 2,5 cm).
 */
export function measureLimbThrough(
  input: CheckInput,
  accept: (n: number) => boolean,
  probe: LimbProbe,
): LimbThroughStats {
  const { grid, registry, nav, doc } = input;
  const props = input.colliders;
  const half = METRICS.aabbWidth / 2;
  const beyond = probe.reachM - half;
  const reachByStance: Record<string, number> = {};
  for (const s of probe.stances) reachByStance[s.name] = s.tips.reduce((m, t) => Math.max(m, t.reachM), 0);
  const shapeBoxes = new Float32Array(MAX_SHAPE_BOXES * SHAPE_BOX_STRIDE);
  const near: number[] = [];
  let label = '';
  const insideShape = (shape: ShapeId, o: number, fx: number, fy: number, fz: number): boolean => {
    const kind = shapeCollision(shape, o);
    if (kind === 'none') return false;
    if (kind === 'slope') {
      const h = shapeFloorHeight(shape, o, fx, fz);
      return h >= 0 && fy <= h;
    }
    const n = shapeCollisionBoxes(shape, o, shapeBoxes);
    const [lx, ly, lz] = [fx * SHAPE_STEPS, fy * SHAPE_STEPS, fz * SHAPE_STEPS];
    for (let i = 0; i < n; i++) {
      const s = i * SHAPE_BOX_STRIDE;
      if (lx < shapeBoxes[s]! || lx > shapeBoxes[s + 3]! || lz < shapeBoxes[s + 2]! || lz > shapeBoxes[s + 5]!)
        continue;
      if (ly >= shapeBoxes[s + 1]! && ly <= shapeBoxes[s + 4]!) return true;
    }
    return false;
  };
  /** `OBST_*` no ponto (bloco pela forma de colisão e props por perto); `label` = o que para bala ou tapa a visão. */
  const obstacleAt = (x: number, y: number, z: number): number => {
    let bits = 0;
    label = '';
    const cx = Math.floor(x / BLOCK_SIZE);
    const cy = Math.floor(y / BLOCK_SIZE);
    const cz = Math.floor(z / BLOCK_SIZE);
    const cell = grid.get(cx, cy, cz);
    if (cell !== 0) {
      const b = cell & 0x3ff;
      const f = registry.flags[b]!;
      const shape = registry.shapes[b] as ShapeId;
      if (
        (f & BLOCK_FLAG.solid) !== 0 &&
        insideShape(shape, (cell >>> 10) & 7, x / BLOCK_SIZE - cx, y / BLOCK_SIZE - cy, z / BLOCK_SIZE - cz)
      ) {
        bits |= OBST_SOLID;
        if ((f & BLOCK_FLAG.blocksBullets) !== 0) bits |= OBST_BULLETS;
        if ((f & BLOCK_FLAG.blocksSight) !== 0) bits |= OBST_SIGHT;
        if ((bits & (OBST_BULLETS | OBST_SIGHT)) !== 0) label = doc.blocks[b] ?? '?';
      }
    }
    for (const i of near) {
      const o = i * COLLIDER_STRIDE;
      const bx = props.boxes;
      if (x < bx[o]! || x > bx[o + 3]! || y < bx[o + 1]! || y > bx[o + 4]! || z < bx[o + 2]! || z > bx[o + 5]!)
        continue;
      const pf = props.flags[i]!;
      bits |= OBST_SOLID;
      if ((pf & COLLIDER_FLAG.blocksBullets) !== 0) bits |= OBST_BULLETS;
      if ((pf & COLLIDER_FLAG.blocksSight) !== 0) bits |= OBST_SIGHT;
      if (label === '' && (pf & (COLLIDER_FLAG.blocksBullets | COLLIDER_FLAG.blocksSight)) !== 0) {
        label = input.colliderModel[i] ?? '?';
      }
    }
    return bits;
  };
  /**
   * Até onde a face da AABB anda, a partir do centro, na direção (dx, dz) e na altura y, sem passar de `limit`: amostra
   * a cada `LIMB_STEP` (e no próprio `limit`) e refina o contato por bisseção. Só com o passo, a face parava um passo
   * antes da parede nas direções + (a amostra cai na face da célula, que é semiaberta) e na hora certa nas −: a mão a 2
   * cm além de um muro de 1 bloco só contava de um lado. Devolve o último ponto livre (< 0 se o centro já é sólido).
   */
  const contactAt = (x: number, y: number, z: number, dx: number, dz: number, limit: number): number => {
    let free = -LIMB_STEP;
    for (let k = 0; ; k++) {
      const t = Math.min(k * LIMB_STEP, limit);
      if ((obstacleAt(x + dx * t, y, z + dz * t) & OBST_SOLID) !== 0) {
        let solid = t;
        for (let i = 0; i < LIMB_BISECT; i++) {
          const mid = (free + solid) / 2;
          if ((obstacleAt(x + dx * mid, y, z + dz * mid) & OBST_SOLID) !== 0) solid = mid;
          else free = mid;
        }
        return free;
      }
      if (t >= limit) return limit;
      free = t;
    }
  };
  const dirs = [
    [1, 0, '+x'],
    [-1, 0, '-x'],
    [0, 1, '+z'],
    [0, -1, '-z'],
  ] as const;
  const pos = new Float64Array(3);
  const by: Record<string, number> = {};
  const bulletsByStance: Record<string, number> = {};
  const samples: string[] = [];
  let bullets = 0;
  let sightOnly = 0;
  const reach = LIMB_NODE_GAP + half + beyond + LIMB_STEP;
  const other = new Float64Array(3);
  /** Há nó vizinho a 1 m na direção, no mesmo piso (±0,3 m)? */
  const hasNeighbor = (x: number, floor: number, z: number): boolean => {
    const m = nav.nearestNode(x, floor, z);
    if (m === NO_NAV_NODE) return false;
    nav.nodePosition(m, other);
    return Math.abs(other[0]! - x) < 0.1 && Math.abs(other[2]! - z) < 0.1 && Math.abs(nav.floorY[m]! - floor) < 0.3;
  };
  for (let n = 0; n < nav.nodeCount; n++) {
    if (!accept(n)) continue;
    nav.nodePosition(n, pos);
    const [px, , pz] = pos;
    const floor = nav.floorY[n]!;
    near.length = 0;
    let nearBarrier = false;
    props.query(px! - reach, floor, pz! - reach, px! + reach, floor + METRICS.aabbHeight, pz! + reach, (i) => {
      near.push(i);
      if ((props.flags[i]! & (COLLIDER_FLAG.blocksBullets | COLLIDER_FLAG.blocksSight)) !== 0) nearBarrier = true;
      return true;
    });
    /** Atalho: sem prop por perto, há bloco que para bala ou tapa a visão no caminho da ponta (célula a célula)? */
    const barrierCells = (dx: number, dz: number, tips: readonly LimbTip[]): boolean => {
      for (const { h } of tips) {
        const cy = Math.floor((floor + h) / BLOCK_SIZE);
        for (let t = 0; t <= reach; t += BLOCK_SIZE / 2) {
          const cell = grid.get(Math.floor((px! + dx * t) / BLOCK_SIZE), cy, Math.floor((pz! + dz * t) / BLOCK_SIZE));
          if (cell !== 0 && (registry.flags[cell & 0x3ff]! & (BLOCK_FLAG.blocksBullets | BLOCK_FLAG.blocksSight)) !== 0)
            return true;
        }
      }
      return false;
    };
    let nodeBullets = false;
    let nodeSight = false;
    const crossed = new Set<string>();
    for (const stance of probe.stances) {
      if (stance.standOnly && nav.clearance[n] !== 1) continue;
      // Alturas do corpo para o encosto: acima do degrau automático (o corpo sobe o que for mais baixo) até o topo.
      const body: number[] = [];
      for (let h = METRICS.stepHeight + 0.05; h < stance.bodyTop - 0.02; h += 0.2) body.push(h);
      for (const { h } of stance.tips) if (h > METRICS.stepHeight && h < stance.bodyTop) body.push(h);
      let stanceBullets = false;
      for (const [dx, dz, dn] of dirs) {
        if (!nearBarrier && !barrierCells(dx, dz, stance.tips)) continue;
        // Face da AABB: do centro do nó (meia largura à frente) até encostar no primeiro sólido, no máximo
        // `LIMB_NODE_HALF` (ou `LIMB_NODE_GAP`, sem vizinho) além.
        let face = half + (hasNeighbor(px! + dx, floor, pz! + dz) ? LIMB_NODE_HALF : LIMB_NODE_GAP);
        for (const h of body) face = contactAt(px!, floor + h, pz!, dx, dz, face);
        if (face < half) continue; // o centro do nó já encosta: não é lugar de ficar de frente para isso
        for (const { h, reachM } of stance.tips) {
          const y = floor + h;
          const tip = face + reachM - half;
          if (obstacleAt(px! + dx * face, y, pz! + dz * face) !== 0) continue; // a ponta nasce dentro de algo
          if (obstacleAt(px! + dx * tip, y, pz! + dz * tip) !== 0) continue; // a ponta termina dentro de algo
          let hit = 0;
          let what = '';
          for (let t = face + LIMB_STEP; t < tip; t += LIMB_STEP) {
            const bits = obstacleAt(px! + dx * t, y, pz! + dz * t);
            if ((bits & (OBST_BULLETS | OBST_SIGHT)) !== 0 && (hit & OBST_BULLETS) === 0) {
              hit = bits;
              what = label;
            }
          }
          if (hit === 0) continue;
          crossed.add(what);
          if ((hit & OBST_BULLETS) !== 0) {
            if (!nodeBullets && samples.length < 12)
              samples.push(`${at(px!, floor, pz!)} ${stance.name} ${dn} ${what}`);
            nodeBullets = true;
            stanceBullets = true;
          } else nodeSight = true;
        }
      }
      if (stanceBullets) bulletsByStance[stance.name] = (bulletsByStance[stance.name] ?? 0) + 1;
    }
    if (nodeBullets) bullets++;
    else if (nodeSight) sightOnly++;
    for (const w of crossed) by[w] = (by[w] ?? 0) + 1;
  }
  return { reachM: probe.reachM, reachByStance, bullets, sightOnly, bulletsByStance, by, samples };
}
