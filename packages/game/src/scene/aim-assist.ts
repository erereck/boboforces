import { angleDelta, clamp, DEG_TO_RAD, wrapAngle } from '@boboforces/shared';
import { ENTITY_FLAG, ENTITY_KIND, type SimView } from '@boboforces/sim';
import { BLOCK_FLAG, createRayHit, raycastGrid } from '@boboforces/world';

/**
 * M2 (fase 3h): assistência de mira para o controle e o toque (tecnico.md §10, arte-ux.md §8, gameplay.md §12):
 * - **fricção:** com um inimigo no cone, a mira desacelera a fração do nível (Leve 25%, Média 40%, Forte 60%), mais
 *   no centro e sumindo na borda;
 * - **magnetismo leve:** com o jogador mexendo a mira ou andando, a mira é puxada para o alvo uma fração do erro por
 *   segundo (proporcional ao nível); parado, nada puxa;
 * - **Forte:** ao apertar o ADS com um alvo no cone, a mira trava nele.
 * O alvo é o inimigo vivo mais perto do centro da tela, dentro do cone (o tronco com folga, `AIM_ASSIST.radiusM`, visto
 * da distância dele), até o alcance de visão e com a linha de visão livre (no máximo `maxRays` raios DDA por frame,
 * dos candidatos mais centrais). Calculada no cliente sobre o estado interpolado (o mesmo `alpha` do render), antes de
 * virar `InputFrame`: o frame grava os ângulos já assistidos, então o replay e o determinismo não mudam. O mouse não
 * tem assistência (o perfil dele vem com 0). Sem alocação.
 */
export const AIM_ASSIST = {
  /** Raio do cone em torno do meio do tronco (m), e os limites do ângulo dele (graus). */
  radiusM: 1.1,
  minDeg: 2,
  maxDeg: 10,
  /** Altura do ponto mirado acima do pé (m): o meio do tronco em pé; agachado, `crouchChestM`. */
  chestM: 1.15,
  crouchChestM: 0.8,
  /** Magnetismo: fração do erro corrigida por segundo, vezes o nível. */
  pullPerS: 2.5,
  /** A partir deste nível (o Forte), o ADS trava no alvo. */
  snapLevel: 0.6,
  /** Raios de linha de visão por frame (os candidatos mais centrais primeiro). */
  maxRays: 3,
} as const;

export interface AimAssistState {
  /** Multiplicador da sensibilidade neste frame (1 = sem fricção). */
  scale: number;
  /** Entidade do alvo no cone (-1 = nenhum) e a direção até ele (rad, absoluta). */
  target: number;
  targetYaw: number;
  targetPitch: number;
}

export function createAimAssistState(): AimAssistState {
  return { scale: 1, target: -1, targetYaw: 0, targetPitch: 0 };
}

const MAX_CANDIDATES = 8;
const candIndex = new Int32Array(MAX_CANDIDATES);
const candNorm = new Float64Array(MAX_CANDIDATES);
const candYaw = new Float64Array(MAX_CANDIDATES);
const candPitch = new Float64Array(MAX_CANDIDATES);
const candX = new Float64Array(MAX_CANDIDATES);
const candY = new Float64Array(MAX_CANDIDATES);
const candZ = new Float64Array(MAX_CANDIDATES);
const rayHit = createRayHit();

/** Inimigo de `self` pela regra da sim: zumbi contra bobo; entre bobos, FFA ou times diferentes. */
function hostile(view: SimView, self: number, j: number, ffa: boolean): boolean {
  const za = view.kind[self] === ENTITY_KIND.zombie;
  const zb = view.kind[j] === ENTITY_KIND.zombie;
  if (za || zb) return za !== zb;
  return ffa || view.team[self] !== view.team[j];
}

/**
 * Procura o alvo da assistência para o olho (ex, ey, ez) mirando (yaw, pitch) e preenche `out` (fricção e direção).
 * `level` 0 desliga (scale 1, sem alvo).
 */
export function findAimAssist(
  view: SimView,
  self: number,
  ffa: boolean,
  ex: number,
  ey: number,
  ez: number,
  yaw: number,
  pitch: number,
  level: number,
  alpha: number,
  maxM: number,
  out: AimAssistState,
): void {
  out.scale = 1;
  out.target = -1;
  if (level <= 0) return;
  let count = 0;
  for (let j = 0; j < view.count; j++) {
    if (j === self || view.alive[j] !== 1) continue;
    const kind = view.kind[j];
    if (kind !== ENTITY_KIND.bobo && kind !== ENTITY_KIND.zombie) continue;
    const fl = view.flags[j]!;
    if ((fl & ENTITY_FLAG.dead) !== 0 || !hostile(view, self, j, ffa)) continue;
    const o = j * 3;
    const tx = view.prevPosition[o]! + (view.position[o]! - view.prevPosition[o]!) * alpha;
    const ty =
      view.prevPosition[o + 1]! +
      (view.position[o + 1]! - view.prevPosition[o + 1]!) * alpha +
      ((fl & ENTITY_FLAG.crouching) !== 0 ? AIM_ASSIST.crouchChestM : AIM_ASSIST.chestM);
    const tz = view.prevPosition[o + 2]! + (view.position[o + 2]! - view.prevPosition[o + 2]!) * alpha;
    const dx = tx - ex;
    const dy = ty - ey;
    const dz = tz - ez;
    const horiz = Math.sqrt(dx * dx + dz * dz);
    const dist = Math.sqrt(horiz * horiz + dy * dy);
    if (dist < 0.3 || dist > maxM) continue;
    const tYaw = Math.atan2(-dx, -dz);
    const tPitch = Math.atan2(dy, horiz);
    const eYaw = angleDelta(yaw, tYaw);
    const ePitch = tPitch - pitch;
    const cone = clamp(
      Math.atan(AIM_ASSIST.radiusM / dist),
      AIM_ASSIST.minDeg * DEG_TO_RAD,
      AIM_ASSIST.maxDeg * DEG_TO_RAD,
    );
    const norm = Math.sqrt(eYaw * eYaw + ePitch * ePitch) / cone;
    if (norm >= 1) continue;
    // Inserção ordenada pelo erro normalizado num vetor fixo (os mais centrais primeiro).
    if (count === MAX_CANDIDATES && norm >= candNorm[MAX_CANDIDATES - 1]!) continue;
    let k = count < MAX_CANDIDATES ? count++ : MAX_CANDIDATES - 1;
    while (k > 0 && candNorm[k - 1]! > norm) {
      candNorm[k] = candNorm[k - 1]!;
      candIndex[k] = candIndex[k - 1]!;
      candYaw[k] = candYaw[k - 1]!;
      candPitch[k] = candPitch[k - 1]!;
      candX[k] = candX[k - 1]!;
      candY[k] = candY[k - 1]!;
      candZ[k] = candZ[k - 1]!;
      k--;
    }
    candNorm[k] = norm;
    candIndex[k] = j;
    candYaw[k] = tYaw;
    candPitch[k] = tPitch;
    candX[k] = tx;
    candY[k] = ty;
    candZ[k] = tz;
  }
  const rays = Math.min(count, AIM_ASSIST.maxRays);
  for (let k = 0; k < rays; k++) {
    const dx = candX[k]! - ex;
    const dy = candY[k]! - ey;
    const dz = candZ[k]! - ez;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (
      raycastGrid(
        view.world,
        view.blocks,
        ex,
        ey,
        ez,
        dx / d,
        dy / d,
        dz / d,
        d,
        BLOCK_FLAG.blocksSight,
        rayHit,
        view.colliders,
      )
    ) {
      continue;
    }
    out.target = candIndex[k]!;
    out.targetYaw = candYaw[k]!;
    out.targetPitch = candPitch[k]!;
    out.scale = 1 - level * (1 - candNorm[k]!);
    return;
  }
}

/**
 * Magnetismo: com o jogador mexendo a mira ou andando (`active`), puxa (yaw, pitch) para o alvo uma fração do erro
 * (`level · pullPerS · dt`, no máximo o erro todo). Escreve os ângulos novos em `angles[0]` e `angles[1]`.
 */
export function pullAim(
  state: AimAssistState,
  level: number,
  dt: number,
  active: boolean,
  yaw: number,
  pitch: number,
  angles: Float64Array,
): void {
  angles[0] = yaw;
  angles[1] = pitch;
  if (state.target < 0 || !active || level <= 0 || dt <= 0) return;
  const f = Math.min(1, level * AIM_ASSIST.pullPerS * dt);
  angles[0] = wrapAngle(yaw + angleDelta(yaw, state.targetYaw) * f);
  angles[1] = pitch + (state.targetPitch - pitch) * f;
}
