import { angleDelta, DEG_TO_RAD, wrapAngle } from '@boboforces/shared';
import type { SimView } from '@boboforces/sim';
import { BLOCK_FLAG, createRayHit, raycastGrid } from '@boboforces/world';
import { AI_GROUP } from './config-group.ts';

/**
 * M12 (fase 7b): os bots em grupo (as constantes e o resumo em `config-group.ts`). Quem segue um líder vai a uma vaga
 * atrás dele; antes todos iam ao mesmo ponto atrás do YAW do líder (quem olhava para trás punha o ponto na frente
 * dele) e o bot parado encarava as costas dele. Os zumbis cercam numa vaga do anel em volta do alvo (antes iam reto ao
 * centro e só a separação os afastava: a fila indiana).
 */
export { AI_GROUP };

const SLOT_RAD = AI_GROUP.slotDeg.map((d) => d * DEG_TO_RAD);

/** O estado de seguidor de um soldado (um por cérebro; o `think` não aloca). */
export class GroupState {
  /** O líder seguido neste tick (-1 = ninguém) e a geração dele. */
  leader = -1;
  leaderGen = 0;
  /** O tick do último cálculo (o `orderGoal` e o Suporte só confiam no deste tick). */
  tick = -1;
  /** Indo para a vaga (`true`) ou parado nela. */
  moving = true;
  /** A vaga (pés, m), a distância até ela no plano e o setor dela (rad a partir das costas). */
  slotX = 0;
  slotY = 0;
  slotZ = 0;
  slotDist = 0;
  sector = 0;
  /** A ordem do seguidor entre os do mesmo líder (0 = o primeiro). */
  rank = 0;
  /** A vaga atual saiu de um nó bom (sem nó bom no tick, fica esta; revisão). */
  slotOk = false;
  /**
   * Para onde olhar parado na vaga: o yaw do líder + π + o setor, com uma varredura lenta (fora de fase entre os
   * seguidores).
   */
  watchYaw = 0;
}

const rayHit = createRayHit();

/** O registro de quem segue quem e o rumo de cada corpo (no `AiContext`, um por partida). */
export interface FollowBoard {
  readonly tick: number;
  readonly hz: number;
  readonly heading: Float64Array;
  readonly groundY: Float64Array;
  readonly followLeader: Int32Array;
  readonly followTick: Int32Array;
}

/**
 * Atualiza a vaga do soldado `e` atrás de `leader` (-1 = não segue ninguém: sai da conta). Escreve em `g`: a vaga, a
 * distância, o olhar e se ainda está indo (`moving`, com a folga entre `slotArriveM` e `slotLeaveM`).
 */
export function updateFollowSlot(
  board: FollowBoard,
  view: SimView,
  g: GroupState,
  e: number,
  leader: number,
  cover: boolean,
  staleTicks: number,
): void {
  const tick = board.tick;
  if (leader < 0) {
    board.followLeader[e] = -1;
    g.leader = -1;
    return;
  }
  board.followLeader[e] = leader;
  board.followTick[e] = tick;
  const gen = view.generation[leader]!;
  const sameLeader = g.leader === leader && g.leaderGen === gen;
  if (!sameLeader) {
    g.moving = true;
    g.slotOk = false;
  }
  g.leader = leader;
  g.leaderGen = gen;
  g.tick = tick;
  // A ordem entre os seguidores do mesmo líder (pelo índice da entidade: estável enquanto ninguém sai).
  let rank = 0;
  for (let j = 0; j < e; j++) {
    if (board.followLeader[j] === leader && tick - board.followTick[j]! <= staleTicks) rank++;
  }
  g.rank = rank;
  const ring = Math.floor(rank / SLOT_RAD.length);
  const sector = SLOT_RAD[rank % SLOT_RAD.length]!;
  g.sector = sector;
  const radius = (cover ? AI_GROUP.coverSlotM : AI_GROUP.slotM) + ring * AI_GROUP.ringStepM;
  const l3 = leader * 3;
  const lx = view.position[l3]!;
  // Revisão: a altura do chão do líder (a do último tick no chão): pulando, a vaga não sobe junto (e não falha).
  const ly = board.groundY[leader]!;
  const lz = view.position[l3 + 2]!;
  // As costas do rumo (o rumo é um yaw: frente = (−sin, −cos)) giradas pelo setor da vaga.
  const a = board.heading[leader]! + sector;
  const dx = Math.sin(a);
  const dz = Math.cos(a);
  // Do lado de cá do que estiver lá (de costas para a parede, a vaga não cai na sala vizinha).
  const hit = raycastGrid(
    view.world,
    view.blocks,
    lx,
    ly + 1,
    lz,
    dx,
    0,
    dz,
    radius + AI_GROUP.slotWallM,
    BLOCK_FLAG.solid,
    rayHit,
    view.colliders,
  );
  const t = hit ? Math.max(0, rayHit.distance - AI_GROUP.slotWallM) : radius;
  const placed = placeSlot(view, lx, ly, lz, dx, dz, t);
  // Sem nó bom para a vaga, fica a de antes (do mesmo líder); sem nenhuma, o próprio líder.
  if (placed || !g.slotOk) {
    g.slotX = slotAt[0]!;
    g.slotY = slotAt[1]!;
    g.slotZ = slotAt[2]!;
    g.slotOk = placed;
  }
  const clamped = Math.hypot(g.slotX - lx, g.slotZ - lz) < radius - 0.25;
  const sweep = Math.sin((tick / board.hz) * AI_GROUP.watchSweepRate + rank * 1.7);
  g.watchYaw = wrapAngle(view.yaw[leader]! + Math.PI + sector + sweep * AI_GROUP.watchSweepDeg * DEG_TO_RAD);
  const e3 = e * 3;
  const x = view.position[e3]!;
  const y = view.position[e3 + 1]!;
  const z = view.position[e3 + 2]!;
  const sx = g.slotX - x;
  const sz = g.slotZ - z;
  g.slotDist = Math.sqrt(sx * sx + sz * sz);
  const sameFloor = Math.abs(ly - y) < AI_GROUP.sameFloorM;
  // A vaga encurtada pela parede: perto do líder (a até o raio) também conta como chegar.
  const near = clamped && Math.hypot(lx - x, lz - z) <= radius;
  if (g.moving) {
    if (sameFloor && (g.slotDist <= AI_GROUP.slotArriveM || near)) g.moving = false;
  } else if (!sameFloor || (g.slotDist > AI_GROUP.slotLeaveM && !near)) {
    g.moving = true;
  }
}

const nodePos = new Float32Array(3);
const slotAt = new Float64Array(3);

/**
 * A vaga (em `slotAt`) a `t` m do líder (em lx, ly, lz; ly = o chão dele) na direção (dx, dz), presa num nó da
 * navegação do mesmo piso e à vista do líder (sem isso, o nó mais perto da vaga colada numa parede podia ser o do topo
 * dela ou o do outro lado, e a rota falhava ou dava a volta). Tenta `t` e a metade. `true` com a vaga achada (ou sem
 * navegação, ou encurtada pela parede até o líder: a vaga é ele); `false` sem nó bom (a vaga é o líder, e quem chama
 * fica com a de antes, se houver).
 */
function placeSlot(view: SimView, lx: number, ly: number, lz: number, dx: number, dz: number, t: number): boolean {
  const nav = view.nav;
  if (nav === null) {
    slotAt[0] = lx + dx * t;
    slotAt[1] = ly;
    slotAt[2] = lz + dz * t;
    return true;
  }
  slotAt[0] = lx;
  slotAt[1] = ly;
  slotAt[2] = lz;
  if (t <= 0.25) return true;
  for (let k = 0; k < 2 && t > 0.25; k++, t *= 0.5) {
    const n = nav.nearestNode(lx + dx * t, ly, lz + dz * t);
    if (n < 0) continue;
    nav.nodePosition(n, nodePos, 0);
    const nx = nodePos[0]!;
    const ny = nodePos[1]!;
    const nz = nodePos[2]!;
    if (Math.abs(ny - ly) > AI_GROUP.slotFloorM) continue;
    const ox = nx - lx;
    const oz = nz - lz;
    const d = Math.sqrt(ox * ox + oz * oz);
    if (
      d > 1e-3 &&
      raycastGrid(
        view.world,
        view.blocks,
        lx,
        ly + 1,
        lz,
        ox / d,
        0,
        oz / d,
        d,
        BLOCK_FLAG.solid,
        rayHit,
        view.colliders,
      )
    ) {
      continue;
    }
    slotAt[0] = nx;
    slotAt[1] = ny;
    slotAt[2] = nz;
    return true;
  }
  return false;
}

/** Gira `current` até `goal` no máximo `step` (rad). */
export function turnYaw(current: number, goal: number, step: number): number {
  const d = angleDelta(current, goal);
  return wrapAngle(current + (d > step ? step : d < -step ? -step : d));
}

/** O ângulo da vaga do zumbi de índice `index` no anel, a partir do ângulo de chegada `approach` (rad). */
export function zombieRingAngle(approach: number, index: number): number {
  const half = Math.floor(AI_GROUP.zombieRingSlots / 2);
  return approach + ((index % AI_GROUP.zombieRingSlots) - half) * AI_GROUP.zombieRingStepRad;
}
