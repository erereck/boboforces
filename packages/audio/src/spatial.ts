// "3D" próprio do mixer (tecnico.md §12): atenuação por distância + pan estéreo, sem PannerNode (regra 9). Conta pura,
// sem nós de áudio: o mixer aplica o resultado num GainNode e num StereoPannerNode por voz.

/** Até onde o som chega com volume cheio (m). */
export const REF_DISTANCE_M = 2;
/** Além daqui o som nem toca (não gasta voz). */
export const MAX_DISTANCE_M = 60;
/** Inclinação da queda depois de `REF_DISTANCE_M` (modelo "inverse" do Web Audio). */
export const ROLLOFF = 1;
/** Fração final do alcance em que o volume desce linear até 0 (sem estalo no limite). */
const EDGE_FADE = 0.2;
/** Abaixo desta distância o pan volta ao centro (som "dentro da cabeça" não pula de um lado para o outro). */
const PAN_NEAR_M = 1;

/** Ganho por distância em [0, 1]: inverso limitado, com o fim do alcance suavizado. */
export function distanceGain(distanceM: number): number {
  if (!(distanceM > REF_DISTANCE_M)) return 1;
  if (distanceM >= MAX_DISTANCE_M) return 0;
  const inverse = REF_DISTANCE_M / (REF_DISTANCE_M + ROLLOFF * (distanceM - REF_DISTANCE_M));
  const fadeStart = MAX_DISTANCE_M * (1 - EDGE_FADE);
  const edge = distanceM <= fadeStart ? 1 : (MAX_DISTANCE_M - distanceM) / (MAX_DISTANCE_M - fadeStart);
  return inverse * edge;
}

/**
 * Pan em [-1, 1] de um som em (dx, dz) relativo ao ouvinte com `yaw` (convenção do jogo: yaw 0 olha para -Z, direita
 * = (cos yaw, 0, -sin yaw); docs/ARCHITECTURE.md §3). A altura não entra: o pan é só esquerda/direita.
 */
export function stereoPan(dx: number, dz: number, yaw: number): number {
  const flat = Math.sqrt(dx * dx + dz * dz);
  if (flat < 1e-6) return 0;
  const right = (dx * Math.cos(yaw) - dz * Math.sin(yaw)) / flat;
  const near = flat < PAN_NEAR_M ? flat / PAN_NEAR_M : 1;
  const pan = right * near;
  return pan < -1 ? -1 : pan > 1 ? 1 : pan;
}

/** Ouvintes locais em arrays planos (sem objeto por ouvinte): x, y, z, yaw. */
export interface ListenerSet {
  count: number;
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly z: Float64Array;
  readonly yaw: Float64Array;
}

export function createListenerSet(capacity: number): ListenerSet {
  return {
    count: 1,
    x: new Float64Array(capacity),
    y: new Float64Array(capacity),
    z: new Float64Array(capacity),
    yaw: new Float64Array(capacity),
  };
}

/** Índice do ouvinte mais próximo (tela dividida: cada som usa o ouvinte local mais próximo, tecnico.md §12). */
export function nearestListener(set: Readonly<ListenerSet>, x: number, y: number, z: number): number {
  let best = 0;
  let bestD2 = Infinity;
  for (let i = 0; i < set.count; i++) {
    const dx = x - set.x[i]!;
    const dy = y - set.y[i]!;
    const dz = z - set.z[i]!;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = i;
    }
  }
  return best;
}

/** Resultado reaproveitado (sem alocar por som). */
export interface SpatialResult {
  gain: number;
  pan: number;
  listener: number;
  distance: number;
}

/** Ganho e pan de um som posicionado, pelo ouvinte mais próximo. `out.gain` 0 = inaudível (não toca). */
export function spatialize(
  set: Readonly<ListenerSet>,
  x: number,
  y: number,
  z: number,
  out: SpatialResult,
): SpatialResult {
  const i = nearestListener(set, x, y, z);
  const dx = x - set.x[i]!;
  const dy = y - set.y[i]!;
  const dz = z - set.z[i]!;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  out.listener = i;
  out.distance = distance;
  out.gain = distanceGain(distance);
  out.pan = out.gain > 0 ? stereoPan(dx, dz, set.yaw[i]!) : 0;
  return out;
}
