import { ENTITY_FLAG, ENTITY_KIND, METRICS, type SimView } from '@boboforces/sim';
import { BLOCK_FLAG, createRayHit, raycastGrid } from '@boboforces/world';

/**
 * M2 (fase 6b): a 3ª pessoa (gameplay.md §3.5; tecnico.md §9). A câmera de ombro fica presa ao olho do bobo, com um
 * braço que encurta na parede (DDA na grade e nas props). A mira usa o raio da câmera: ele acha o ponto mirado (cenário
 * ou um bobo), e o tiro sai do OLHO na direção desse ponto. Se o caminho do olho até lá estiver tapado, a bala acerta o
 * que tapa: a 3ª pessoa não atira por trás de parede. A sim não muda: a cena só troca o yaw/pitch do quadro do humano.
 * Puro e sem alocação por frame.
 */
export const THIRD_PERSON = {
  /** Câmera atrás do olho, ao lado (ombro direito positivo) e acima, em m. */
  backM: 2.6,
  sideM: 0.7,
  upM: 0.4,
  /** Folga da parede quando o braço encurta. */
  wallMarginM: 0.25,
  /** Braço mínimo (colado na cabeça). */
  minArmM: 0.3,
  /**
   * Braço mais curto que isto (de costas para a parede): a câmera entraria na cabeça do bobo (cabeçudo, 0,44 m), então
   * a vista desenha a 1ª pessoa até o braço voltar.
   */
  minVisibleArmM: 0.9,
  /** O braço volta a esticar a esta velocidade (m/s); encolher é na hora (a câmera nunca atravessa a parede). */
  armGrowPerS: 6,
  /** Alcance do raio da mira. */
  aimRangeM: 250,
  /** Ponto mirado a menos disto do olho: o tiro segue o olhar da câmera (não vira o bobo para o lado). */
  minAimM: 1.5,
} as const;

/** Onde a câmera de ombro ficou e o braço atual (para suavizar o esticar no próximo frame). */
export interface ShoulderPose {
  x: number;
  y: number;
  z: number;
  arm: number;
}

export function createShoulderPose(): ShoulderPose {
  return { x: 0, y: 0, z: 0, arm: -1 };
}

const hit = createRayHit();

/**
 * Põe a câmera de ombro com o pivô no olho (ex, ey, ez), olhando para (yaw, pitch). `side`: +1 ombro direito, −1
 * esquerdo. `pose.arm` < 0 = primeira vez (sem suavizar). Escreve a posição e o braço novo em `pose`.
 */
export function placeShoulderCamera(
  view: SimView,
  ex: number,
  ey: number,
  ez: number,
  yaw: number,
  pitch: number,
  side: number,
  dt: number,
  pose: ShoulderPose,
): void {
  const T = THIRD_PERSON;
  const cp = Math.cos(pitch);
  const fx = -Math.sin(yaw) * cp;
  const fy = Math.sin(pitch);
  const fz = -Math.cos(yaw) * cp;
  // Direita no plano do chão (yaw 0 olha para −Z: a direita é +X).
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  let dx = rx * side * T.sideM - fx * T.backM;
  let dy = T.upM - fy * T.backM;
  let dz = rz * side * T.sideM - fz * T.backM;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  dx /= len;
  dy /= len;
  dz /= len;
  const blocked = raycastGrid(
    view.world,
    view.blocks,
    ex,
    ey,
    ez,
    dx,
    dy,
    dz,
    len,
    BLOCK_FLAG.solid,
    hit,
    view.colliders,
  );
  const free = blocked ? Math.max(T.minArmM, hit.distance - T.wallMarginM) : len;
  const arm = pose.arm < 0 ? free : Math.min(free, pose.arm + T.armGrowPerS * dt);
  pose.arm = arm;
  pose.x = ex + dx * arm;
  pose.y = ey + dy * arm;
  pose.z = ez + dz * arm;
}

/**
 * Distância ao longo do raio (o, d) até a caixa de movimento do bobo `j` (−1 = não acerta). Agachado, a caixa é a
 * baixa. Método das placas.
 */
function rayBody(
  view: SimView,
  j: number,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxT: number,
): number {
  const hw = METRICS.aabbWidth / 2;
  const fl = view.flags[j]!;
  const h = (fl & ENTITY_FLAG.crouching) !== 0 ? METRICS.aabbCrouchHeight : METRICS.aabbHeight;
  const px = view.position[j * 3]!;
  const py = view.position[j * 3 + 1]!;
  const pz = view.position[j * 3 + 2]!;
  slabT0 = 0;
  slabT1 = maxT;
  if (!slab(ox, dx, px - hw, px + hw) || !slab(oy, dy, py, py + h) || !slab(oz, dz, pz - hw, pz + hw)) return -1;
  return slabT0;
}

/** Intervalo [entrada, saída] do raio nas placas já vistas (rascunho do módulo, sem alocar). */
let slabT0 = 0;
let slabT1 = 0;

/** Corta o intervalo com a placa [lo, hi] de um eixo; `false` = o raio não passa. */
function slab(o: number, d: number, lo: number, hi: number): boolean {
  if (Math.abs(d) < 1e-9) return o >= lo && o <= hi;
  let a = (lo - o) / d;
  let b = (hi - o) / d;
  if (a > b) {
    const s = a;
    a = b;
    b = s;
  }
  if (a > slabT0) slabT0 = a;
  if (b < slabT1) slabT1 = b;
  return slabT0 <= slabT1;
}

/**
 * Os ângulos do tiro para a mira da câmera. O raio da câmera (cx, cy, cz → yaw, pitch) começa no plano do olho (o que
 * fica entre a câmera e o bobo não conta) e para no cenário que segura bala ou num bobo vivo que não seja o `self`; o
 * tiro vai do olho até esse ponto. Escreve [yaw, pitch] em `out`.
 */
export function aimFromCamera(
  view: SimView,
  self: number,
  ex: number,
  ey: number,
  ez: number,
  cx: number,
  cy: number,
  cz: number,
  yaw: number,
  pitch: number,
  out: Float64Array,
): void {
  const T = THIRD_PERSON;
  const cp = Math.cos(pitch);
  const fx = -Math.sin(yaw) * cp;
  const fy = Math.sin(pitch);
  const fz = -Math.cos(yaw) * cp;
  const depth = Math.max(0, (ex - cx) * fx + (ey - cy) * fy + (ez - cz) * fz);
  const ox = cx + fx * depth;
  const oy = cy + fy * depth;
  const oz = cz + fz * depth;
  raycastGrid(
    view.world,
    view.blocks,
    ox,
    oy,
    oz,
    fx,
    fy,
    fz,
    T.aimRangeM,
    BLOCK_FLAG.blocksBullets,
    hit,
    view.colliders,
  );
  let t = hit.hit ? hit.distance : T.aimRangeM;
  for (let j = 0; j < view.count; j++) {
    if (j === self || view.alive[j] !== 1) continue;
    const kind = view.kind[j]!;
    if (kind !== ENTITY_KIND.bobo && kind !== ENTITY_KIND.zombie) continue;
    if ((view.flags[j]! & ENTITY_FLAG.dead) !== 0) continue;
    const tj = rayBody(view, j, ox, oy, oz, fx, fy, fz, t);
    if (tj >= 0 && tj < t) t = tj;
  }
  const dx = ox + fx * t - ex;
  const dy = oy + fy * t - ey;
  const dz = oz + fz * t - ez;
  const flat = Math.sqrt(dx * dx + dz * dz);
  if (flat * flat + dy * dy < T.minAimM * T.minAimM) {
    out[0] = yaw;
    out[1] = pitch;
    return;
  }
  out[0] = Math.atan2(-dx, -dz);
  out[1] = Math.atan2(dy, flat);
}
