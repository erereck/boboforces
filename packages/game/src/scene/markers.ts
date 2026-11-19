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

/**
 * M6 (fase 3): como `projectToView`, mas sempre dá um ponto: com o alvo fora da vista (ou atrás da câmera), o ponto vai
 * para a borda, `margin` px para dentro, na direção dele (o marcador do Jugg nunca some). `out[2]` = 1 na vista, 0 na
 * borda.
 */
export function projectToEdge(
  cam: ProjectCamera,
  rect: ProjectRect,
  x: number,
  y: number,
  z: number,
  margin: number,
  out: Float32Array | Float64Array,
): void {
  const dx = x - cam.x;
  const dy = y - cam.y;
  const dz = z - cam.z;
  const sy = Math.sin(cam.yaw);
  const cy = Math.cos(cam.yaw);
  const sp = Math.sin(cam.pitch);
  const cp = Math.cos(cam.pitch);
  const depth = -sy * cp * dx + sp * dy - cy * cp * dz;
  const right = cy * dx - sy * dz;
  const up = sy * sp * dx + cp * dy + cy * sp * dz;
  const cx = rect.x + rect.width / 2;
  const cyPx = rect.y + rect.height / 2;
  const hw = Math.max(1, rect.width / 2 - margin);
  const hh = Math.max(1, rect.height / 2 - margin);
  let ux: number;
  let uy: number;
  if (depth >= NEAR_M) {
    const tanY = Math.tan(cam.fovY / 2);
    const aspect = rect.width / Math.max(1, rect.height);
    ux = (right / (depth * tanY * aspect)) * (rect.width / 2);
    uy = -(up / (depth * tanY)) * (rect.height / 2);
    if (Math.abs(ux) <= hw && Math.abs(uy) <= hh) {
      out[0] = cx + ux;
      out[1] = cyPx + uy;
      out[2] = 1;
      return;
    }
  } else {
    // Atrás: o lado é o do alvo, e o ponto desce para a borda de baixo (o "vire-se").
    ux = right;
    uy = Math.max(Math.abs(up), Math.abs(right) * 0.5, 1e-3);
  }
  if (ux === 0 && uy === 0) uy = 1;
  const t = Math.min(ux !== 0 ? hw / Math.abs(ux) : Infinity, uy !== 0 ? hh / Math.abs(uy) : Infinity);
  out[0] = cx + ux * t;
  out[1] = cyPx + uy * t;
  out[2] = 0;
}
