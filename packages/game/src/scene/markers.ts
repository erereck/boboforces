/**
 * M2 (fase 2d): projeção de um ponto do mundo na vista (para os marcadores dos aliados), com a convenção da câmera do
 * jogo: yaw 0 olha para −Z, yaw positivo vira para a esquerda, pitch positivo olha para cima; `fovY` vertical. Puro e
 * sem alocar.
 */

export interface ProjectCamera {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly pitch: number;
  readonly fovY: number;
}

export interface ProjectRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Mais perto que isto na frente da câmera (m) não projeta. */
const NEAR_M = 0.1;

/**
 * Projeta (x, y, z) na vista: `out[0]`, `out[1]` em px da superfície e `out[2]` a profundidade (m). `false` = atrás da
 * câmera (ou colado nela).
 */
export function projectToView(
  cam: ProjectCamera,
  rect: ProjectRect,
  x: number,
  y: number,
  z: number,
  out: Float32Array | Float64Array,
): boolean {
  const dx = x - cam.x;
  const dy = y - cam.y;
  const dz = z - cam.z;
  const sy = Math.sin(cam.yaw);
  const cy = Math.cos(cam.yaw);
  const sp = Math.sin(cam.pitch);
  const cp = Math.cos(cam.pitch);
  // Frente f = (−sin yaw · cos pitch, sin pitch, −cos yaw · cos pitch); direita r = (cos yaw, 0, −sin yaw); cima = r × f.
  const depth = -sy * cp * dx + sp * dy - cy * cp * dz;
  if (depth < NEAR_M) return false;
  const right = cy * dx - sy * dz;
  const up = sy * sp * dx + cp * dy + cy * sp * dz;
  const tanY = Math.tan(cam.fovY / 2);
  const aspect = rect.width / Math.max(1, rect.height);
  const ndcX = right / (depth * tanY * aspect);
  const ndcY = up / (depth * tanY);
  out[0] = rect.x + ((ndcX + 1) / 2) * rect.width;
  out[1] = rect.y + ((1 - ndcY) / 2) * rect.height;
  out[2] = depth;
  return true;
}
