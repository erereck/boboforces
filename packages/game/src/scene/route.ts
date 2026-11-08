import type { MapCamera, MapCameraRoute } from '@boboforces/format';
import { DEG_TO_RAD } from '@boboforces/shared';

/** Pose de câmera (olho em metros, yaw/pitch em rad; `fovYDeg` 0 = o padrão do jogo). */
export interface CameraPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  fovY: number;
}

export function createCameraPose(): CameraPose {
  return { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, fovY: 0 };
}

/** Câmera nomeada fixa → pose (`fovY` em rad; 0 = padrão). */
export function poseFromCamera(cam: MapCamera, out: CameraPose): CameraPose {
  out.x = cam.x;
  out.y = cam.y;
  out.z = cam.z;
  out.yaw = cam.yaw;
  out.pitch = cam.pitch;
  out.fovY = cam.fovYDeg > 0 ? cam.fovYDeg * DEG_TO_RAD : 0;
  return out;
}

/** Duração da rota (s): o `t` do último ponto (no laço, mais o trecho de volta ao primeiro, do mesmo tamanho médio). */
export function routeDuration(route: MapCameraRoute): number {
  const p = route.points;
  if (p.length < 2) return 0;
  const last = p[p.length - 1]!.t;
  return route.loop ? last + last / (p.length - 1) : last;
}

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

function wrapAngle(a: number): number {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
}

/**
 * Pose da rota no instante `timeS` (contrato do `map@1`: Catmull-Rom na posição, menor arco no yaw). No laço o
 * tempo dá a volta; fora dele, para no fim. Sem alocação.
 */
function routeIndex(k: number, n: number, loop: boolean): number {
  return loop ? ((k % n) + n) % n : Math.max(0, Math.min(n - 1, k));
}

export function sampleRoute(route: MapCameraRoute, timeS: number, out: CameraPose): CameraPose {
  const pts = route.points;
  const n = pts.length;
  out.fovY = 0;
  if (n === 0) return out;
  if (n === 1) {
    const p = pts[0]!;
    out.x = p.x;
    out.y = p.y;
    out.z = p.z;
    out.yaw = p.yaw;
    out.pitch = p.pitch;
    return out;
  }
  const duration = routeDuration(route);
  let t = timeS;
  if (route.loop) t = duration > 0 ? ((t % duration) + duration) % duration : 0;
  else t = Math.max(0, Math.min(duration, t));
  // Trecho i → i+1 (no laço, o último trecho fecha no primeiro ponto).
  const segments = route.loop ? n : n - 1;
  let i = 0;
  while (i < segments - 1 && t >= (i + 1 < n ? pts[i + 1]!.t : duration)) i++;
  const tA = pts[i]!.t;
  const tB = i + 1 < n ? pts[i + 1]!.t : duration;
  const f = tB > tA ? Math.max(0, Math.min(1, (t - tA) / (tB - tA))) : 0;
  // Índices sem closure (roda por frame no bench com rota: regra 11).
  const p0 = pts[routeIndex(i - 1, n, route.loop)]!;
  const p1 = pts[routeIndex(i, n, route.loop)]!;
  const p2 = pts[routeIndex(i + 1, n, route.loop)]!;
  const p3 = pts[routeIndex(i + 2, n, route.loop)]!;
  out.x = catmull(p0.x, p1.x, p2.x, p3.x, f);
  out.y = catmull(p0.y, p1.y, p2.y, p3.y, f);
  out.z = catmull(p0.z, p1.z, p2.z, p3.z, f);
  out.yaw = p1.yaw + wrapAngle(p2.yaw - p1.yaw) * f;
  out.pitch = p1.pitch + (p2.pitch - p1.pitch) * f;
  return out;
}
