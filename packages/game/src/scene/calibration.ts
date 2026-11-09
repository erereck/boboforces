/**
 * M2 (fase 5f): "Calibrar mira" (gameplay.md §2.5): 3 alvos aparecem, um de cada vez, em direções espalhadas em volta
 * de onde o jogador olhava; ele mira e atira. Para cada alvo o jogo mede o primeiro movimento até ele:
 * - **passou**: a mira cruzou o alvo (o erro mudou de lado) por mais de `CALIBRATION.overshootDeg` antes do acerto;
 * - **não chegou**: a primeira parada (giro abaixo de `stopDegS`) ficou a mais de `undershootFrac` do caminho.
 * Dois "passou" pedem sensibilidade menor (×0,85); dois "não chegou", maior (×1,2); senão, fica. Puro e sem alocação
 * por frame: a cena entrega o olhar (yaw/pitch em rad) e o gatilho.
 */
export const CALIBRATION = {
  /** Direções dos alvos em relação ao olhar inicial: [Δyaw, Δpitch] em graus (positivo = esquerda / cima). */
  targets: [
    [40, 4],
    [-55, -6],
    [85, 8],
  ] as readonly (readonly [number, number])[],
  /** Acerto: o gatilho com a mira a menos disto do alvo. */
  hitDeg: 2.5,
  overshootDeg: 2,
  stopDegS: 12,
  undershootFrac: 0.25,
  /** Antes de começar a contar a parada (ainda reagindo ao alvo novo). */
  reactS: 0.15,
  smaller: 0.85,
  larger: 1.2,
} as const;

const DEG = Math.PI / 180;

export interface CalibrationState {
  /** Alvo atual (0..2); 3 = terminou. */
  index: number;
  readonly baseYaw: number;
  readonly basePitch: number;
  /** Erro inicial do alvo atual (rad) e a direção dele (unitária). */
  e0: number;
  dirYaw: number;
  dirPitch: number;
  /** Já parou uma vez (a 1ª parada conta) e o tempo desde que o alvo apareceu. */
  stopped: boolean;
  elapsedS: number;
  lastYaw: number;
  lastPitch: number;
  overshoot: boolean;
  undershoot: boolean;
  overshoots: number;
  undershoots: number;
}

function wrap(a: number): number {
  let x = a;
  while (x > Math.PI) x -= 2 * Math.PI;
  while (x < -Math.PI) x += 2 * Math.PI;
  return x;
}

/** O alvo `i` (yaw, pitch em rad). */
export function calibrationTarget(st: CalibrationState, i: number, out: Float64Array): void {
  const t = CALIBRATION.targets[i]!;
  out[0] = wrap(st.baseYaw + t[0] * DEG);
  out[1] = st.basePitch + t[1] * DEG;
}

const scratch = new Float64Array(2);

function startTarget(st: CalibrationState, yaw: number, pitch: number): void {
  calibrationTarget(st, st.index, scratch);
  const dy = wrap(scratch[0]! - yaw);
  const dp = scratch[1]! - pitch;
  st.e0 = Math.hypot(dy, dp);
  st.dirYaw = st.e0 > 0 ? dy / st.e0 : 1;
  st.dirPitch = st.e0 > 0 ? dp / st.e0 : 0;
  st.stopped = false;
  st.elapsedS = 0;
  st.overshoot = false;
  st.undershoot = false;
  st.lastYaw = yaw;
  st.lastPitch = pitch;
}

export function createCalibration(yaw: number, pitch: number): CalibrationState {
  const st: CalibrationState = {
    index: 0,
    baseYaw: yaw,
    basePitch: pitch,
    e0: 0,
    dirYaw: 1,
    dirPitch: 0,
    stopped: false,
    elapsedS: 0,
    lastYaw: yaw,
    lastPitch: pitch,
    overshoot: false,
    undershoot: false,
    overshoots: 0,
    undershoots: 0,
  };
  startTarget(st, yaw, pitch);
  return st;
}

/** Um frame. Devolve `true` quando o último alvo foi acertado. */
export function stepCalibration(st: CalibrationState, yaw: number, pitch: number, fire: boolean, dt: number): boolean {
  if (st.index >= CALIBRATION.targets.length) return true;
  calibrationTarget(st, st.index, scratch);
  const ey = wrap(scratch[0]! - yaw);
  const ep = scratch[1]! - pitch;
  const err = Math.hypot(ey, ep);
  // Quanto falta ao longo da direção inicial: negativo = passou do alvo.
  const along = ey * st.dirYaw + ep * st.dirPitch;
  if (along < -CALIBRATION.overshootDeg * DEG) st.overshoot = true;
  st.elapsedS += dt;
  const speed = dt > 0 ? Math.hypot(wrap(yaw - st.lastYaw), pitch - st.lastPitch) / dt : 0;
  st.lastYaw = yaw;
  st.lastPitch = pitch;
  if (!st.stopped && st.elapsedS > CALIBRATION.reactS && st.e0 > 0 && err < st.e0 * 0.97) {
    // Já saiu do lugar: a 1ª parada mede se chegou perto.
    if (speed < CALIBRATION.stopDegS * DEG) {
      st.stopped = true;
      if (along > st.e0 * CALIBRATION.undershootFrac) st.undershoot = true;
    }
  }
  if (fire && err < CALIBRATION.hitDeg * DEG) {
    if (st.overshoot) st.overshoots++;
    else if (st.undershoot) st.undershoots++;
    st.index++;
    if (st.index >= CALIBRATION.targets.length) return true;
    startTarget(st, yaw, pitch);
  }
  return false;
}

/** O ajuste sugerido: ×0,85 (passou do alvo 2 vezes ou mais), ×1,2 (não chegou 2 vezes ou mais) ou 1. */
export function calibrationFactor(st: CalibrationState): number {
  if (st.overshoots >= 2) return CALIBRATION.smaller;
  if (st.undershoots >= 2) return CALIBRATION.larger;
  return 1;
}
