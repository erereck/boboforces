import { angleDelta, clamp, DEG_TO_RAD, wrapAngle } from '@boboforces/shared';
import { chaosScaleOf, ENTITY_FLAG, ENTITY_KIND, type SimView } from '@boboforces/sim';
import { BLOCK_FLAG, createRayHit, raycastGrid } from '@boboforces/world';

/**
 * M2 (fase 3h): assistência de mira para o controle e o toque (tecnico.md §10, arte-ux.md §8, gameplay.md §12):
 * - **fricção:** com um inimigo no cone, a mira desacelera a fração do nível (Leve 25%, Média 40%, Forte 60%), mais
 *   no centro e sumindo na borda;
 * - **magnetismo leve:** com o jogador mexendo a mira ou andando, a mira é puxada para o alvo uma fração do erro por
 *   segundo (proporcional ao nível); parado, nada puxa. M12 (fase 6): puxa só até o segmento quadril–cabeça
 *   (`hipM`–`headM`): mirando na cabeça (ou em qualquer ponto do corpo entre os dois), o ímã não arrasta para o peito;
 * - **acompanhar** (M12, fase 6): mexendo a mira, ela segue uma fração (`nível · rotation`) da velocidade angular do
 *   alvo vista do olho (o movimento dos dois, pela `velocity`: no online o `prev` dos outros é igual ao atual), quem anda
 *   de lado não escapa da mira só por andar;
 * - **Forte:** ao apertar o ADS com um alvo no cone, a mira vai até ele em `snapS` (0,1 s, sem estalo; era de uma vez).
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
  /** Altura do centro do cone acima do pé (m): o meio do tronco em pé; agachado, `crouchChestM`. */
  chestM: 1.15,
  crouchChestM: 0.8,
  /**
   * M12 (fase 6): o segmento até onde o ímã puxa, acima do pé (m): do quadril à cabeça (o olho, 1,55 m); agachado, a
   * cabeça no olho agachado (0,8 m) e o quadril na mesma proporção.
   */
  hipM: 0.8,
  headM: 1.55,
  crouchHipM: 0.45,
  crouchHeadM: 0.8,
  /** Magnetismo: fração do erro corrigida por segundo, vezes o nível. */
  pullPerS: 2.5,
  /** M12 (fase 6): fração da velocidade angular do alvo que a mira acompanha (vezes o nível), mexendo a mira. */
  rotation: 0.5,
  /**
   * Revisão: teto da velocidade angular acompanhada (rad/s, em cada eixo). Perto do polo (alvo quase em cima ou embaixo,
   * a poucos cm na horizontal) o yaw do alvo gira dezenas de rad/s com um passo de lado.
   */
  maxRateRadS: 4,
  /** A partir deste nível (o Forte), o ADS trava no alvo, em `snapS` segundos (M12, fase 6: suave). */
  snapLevel: 0.6,
  snapS: 0.1,
  /** Raios de linha de visão por frame (os candidatos mais centrais primeiro). */
  maxRays: 3,
} as const;

export interface AimAssistState {
  /** Multiplicador da sensibilidade neste frame (1 = sem fricção). */
  scale: number;
  /** Entidade do alvo no cone (-1 = nenhum) e a direção até ele (rad, absoluta; o pitch é o do centro do cone). */
  target: number;
  targetYaw: number;
  targetPitch: number;
  /** M12 (fase 6): o pitch do quadril e o da cabeça do alvo (o segmento do ímã e da trava). */
  pitchLow: number;
  pitchHigh: number;
  /** M12 (fase 6): a velocidade angular do alvo vista do olho (rad/s; o movimento dos dois). */
  yawRate: number;
  pitchRate: number;
  /** M12 (fase 6): segundos que faltam da trava do Forte (0 = nenhuma). */
  snapLeft: number;
}

export function createAimAssistState(): AimAssistState {
  return {
    scale: 1,
    target: -1,
    targetYaw: 0,
    targetPitch: 0,
    pitchLow: 0,
    pitchHigh: 0,
    yawRate: 0,
    pitchRate: 0,
    snapLeft: 0,
  };
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
  hidden: Uint8Array | null = null,
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
    // M6 (fase 4b): o invisível (que não atirou há pouco) não puxa a mira.
    if (hidden !== null && hidden[j] === 1) continue;
    const o = j * 3;
    // M9 (fase 1): o peito e o cone crescem com o corpo (o Mini e o bot gigante; fase 1b: o gigante debaixo de teto na
    // escala apertada, a mesma da mira da IA, e o peito dele fica abaixo da laje).
    const size = chaosScaleOf(view, j);
    const chest = ((fl & ENTITY_FLAG.crouching) !== 0 ? AIM_ASSIST.crouchChestM : AIM_ASSIST.chestM) * size;
    const tx = view.prevPosition[o]! + (view.position[o]! - view.prevPosition[o]!) * alpha;
    const ty = view.prevPosition[o + 1]! + (view.position[o + 1]! - view.prevPosition[o + 1]!) * alpha + chest;
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
      Math.atan((AIM_ASSIST.radiusM * size) / dist),
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
    const j = candIndex[k]!;
    out.target = j;
    out.targetYaw = candYaw[k]!;
    out.targetPitch = candPitch[k]!;
    out.scale = 1 - level * (1 - candNorm[k]!);
    targetSegment(view, self, j, ex, ey, ez, candX[k]!, candY[k]!, candZ[k]!, out);
    return;
  }
}

/**
 * M12 (fase 6): o segmento quadril–cabeça do alvo `j` (o centro do cone em `cx, cy, cz`) visto do olho, e a velocidade
 * angular dele (o movimento relativo dos dois, pela `velocity` da view).
 */
function targetSegment(
  view: SimView,
  self: number,
  j: number,
  ex: number,
  ey: number,
  ez: number,
  cx: number,
  cy: number,
  cz: number,
  out: AimAssistState,
): void {
  const fl = view.flags[j]!;
  const size = chaosScaleOf(view, j);
  const crouch = (fl & ENTITY_FLAG.crouching) !== 0;
  const feet = cy - (crouch ? AIM_ASSIST.crouchChestM : AIM_ASSIST.chestM) * size;
  const dx = cx - ex;
  const dz = cz - ez;
  const h2 = dx * dx + dz * dz;
  const h = Math.sqrt(h2);
  out.pitchLow = Math.atan2(feet + (crouch ? AIM_ASSIST.crouchHipM : AIM_ASSIST.hipM) * size - ey, h);
  out.pitchHigh = Math.atan2(feet + (crouch ? AIM_ASSIST.crouchHeadM : AIM_ASSIST.headM) * size - ey, h);
  out.yawRate = 0;
  out.pitchRate = 0;
  if (h < 1e-3) return;
  const vel = view.velocity;
  const o = j * 3;
  const so = self * 3;
  const vx = vel[o]! - vel[so]!;
  const vy = vel[o + 1]! - vel[so + 1]!;
  const vz = vel[o + 2]! - vel[so + 2]!;
  // yaw = atan2(−dx, −dz) e pitch = atan2(dy, h): as derivadas no tempo com o deslocamento relativo (vx, vy, vz).
  const max = AIM_ASSIST.maxRateRadS;
  out.yawRate = clamp((dz * vx - dx * vz) / h2, -max, max);
  const dy = cy - ey;
  const dh = (dx * vx + dz * vz) / h;
  out.pitchRate = clamp((h * vy - dy * dh) / (h2 + dy * dy), -max, max);
}

/**
 * Depois do `update` do mapeador (M12, fase 6; antes `pullAim` e a trava de uma vez na cena): escreve em `angles[0]` e
 * `angles[1]` a mira assistida a partir de (yaw, pitch).
 * - **Forte** (`level ≥ snapLevel`) com o ADS apertado (`adsPressed`): a trava anda até o alvo em `snapS`, uma fração
 *   `dt / restante` por quadro (chega no fim mesmo com o alvo andando);
 * - mexendo a mira (`looked`): acompanha `level · rotation` da velocidade angular do alvo;
 * - mexendo a mira ou andando (`moving`): o ímã, `level · pullPerS · dt` do erro até o eixo do alvo (yaw) e até o
 *   segmento quadril–cabeça (pitch: dentro dele, nada).
 * Sem alvo, nada (e a trava acaba).
 */
export function steerAim(
  state: AimAssistState,
  level: number,
  dt: number,
  looked: boolean,
  moving: boolean,
  adsPressed: boolean,
  yaw: number,
  pitch: number,
  angles: Float64Array,
): void {
  angles[0] = yaw;
  angles[1] = pitch;
  if (state.target < 0 || level <= 0) {
    state.snapLeft = 0;
    return;
  }
  if (level >= AIM_ASSIST.snapLevel && adsPressed) state.snapLeft = AIM_ASSIST.snapS;
  if (dt <= 0) return;
  if (state.snapLeft > 0) {
    // O último quadro (sobra ≤ dt, com folga do ponto flutuante) chega no alvo e acaba a trava.
    const f = state.snapLeft <= dt + 1e-9 ? 1 : dt / state.snapLeft;
    state.snapLeft = f >= 1 ? 0 : state.snapLeft - dt;
    angles[0] = wrapAngle(yaw + angleDelta(yaw, state.targetYaw) * f);
    angles[1] = pitch + (clamp(pitch, state.pitchLow, state.pitchHigh) - pitch) * f;
    return;
  }
  let y = yaw;
  let p = pitch;
  if (looked) {
    const k = level * AIM_ASSIST.rotation * dt;
    y += state.yawRate * k;
    p += state.pitchRate * k;
  }
  if (looked || moving) {
    const f = Math.min(1, level * AIM_ASSIST.pullPerS * dt);
    y += angleDelta(y, state.targetYaw) * f;
    p += (clamp(p, state.pitchLow, state.pitchHigh) - p) * f;
  }
  angles[0] = wrapAngle(y);
  angles[1] = p;
}
