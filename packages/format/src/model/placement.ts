import type { MapProp } from '../map/types.ts';
import { MODEL_TEXELS_PER_METER, type ModelDocument } from './types.ts';

/**
 * Prop posicionada no mapa → caixas de colisão no MUNDO e células de navegação ocupadas (tecnico.md §5.2 e §7.3,
 * arte-ux.md §1.4: rotação livre só no visual; a colisão volta a ser caixa alinhada aos eixos, a envolvente da caixa
 * girada). Uma conta só para o `mapc` (validação e navegação) e o `game` (loading dos `StaticColliders`), para os dois
 * nunca discordarem. Puro e determinístico.
 */

/** Floats por caixa em `out`: minX, minY, minZ, maxX, maxY, maxZ (metros), como o `COLLIDER_STRIDE` do world. */
export const MODEL_COLLIDER_STRIDE = 6;
/** Lado da célula da grade (m), o mesmo de `CELL_SIZE` do world. */
export const MODEL_NAV_CELL_SIZE = 0.5;

/** O que importa da prop do `.bfmap`: pivô em texels (1/32 m), giro em 1/256 de volta e escala em 1/16. */
export type ModelPlacement = Pick<MapProp, 'x' | 'y' | 'z' | 'yaw' | 'scale'>;

/** Seno e cosseno do giro, exatos nos quartos de volta (evita 6e-17 virar uma célula a mais). */
function yawSinCos(yaw: number): readonly [s: number, c: number] {
  const steps = ((Math.round(yaw) % 256) + 256) % 256;
  if (steps === 0) return [0, 1];
  if (steps === 64) return [1, 0];
  if (steps === 128) return [0, -1];
  if (steps === 192) return [-1, 0];
  const a = (steps / 256) * Math.PI * 2;
  return [Math.sin(a), Math.cos(a)];
}

/**
 * Escreve em `out[offset..]` as caixas de colisão da prop no mundo (metros), alinhadas aos eixos. O giro é anti-horário
 * visto de cima (o mesmo do yaw: (x, z) → (x·cos + z·sen, −x·sen + z·cos)) em volta do pivô; a escala é uniforme.
 * Devolve quantas caixas escreveu (= `model.colliders.length`).
 */
export function propColliderBoxes(
  model: ModelDocument,
  prop: ModelPlacement,
  out: Float32Array | Float64Array | number[],
  offset = 0,
): number {
  const k = prop.scale / 16 / MODEL_TEXELS_PER_METER;
  const px = prop.x / MODEL_TEXELS_PER_METER;
  const py = prop.y / MODEL_TEXELS_PER_METER;
  const pz = prop.z / MODEL_TEXELS_PER_METER;
  const [s, c] = yawSinCos(prop.yaw);
  let o = offset;
  for (const box of model.colliders) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let corner = 0; corner < 4; corner++) {
      const x = corner & 1 ? box.max[0] : box.min[0];
      const z = corner & 2 ? box.max[2] : box.min[2];
      const rx = x * c + z * s;
      const rz = -x * s + z * c;
      if (rx < minX) minX = rx;
      if (rx > maxX) maxX = rx;
      if (rz < minZ) minZ = rz;
      if (rz > maxZ) maxZ = rz;
    }
    out[o] = px + minX * k;
    out[o + 1] = py + box.min[1] * k;
    out[o + 2] = pz + minZ * k;
    out[o + 3] = px + maxX * k;
    out[o + 4] = py + box.max[1] * k;
    out[o + 5] = pz + maxZ * k;
    o += MODEL_COLLIDER_STRIDE;
  }
  return model.colliders.length;
}

/**
 * Células (x, z) da grade de 0,5 m que a prop ocupa na navegação: a projeção no chão das caixas de colisão que começam
 * abaixo de `clearance` metros acima do pivô (o padrão, 1,5 m, é a altura do bobo; caixa mais alta passa por cima da
 * cabeça). Prop com `blocksNav` falso não ocupa nada (as baixas, que o degrau automático sobe). Uma folga de 1 cm nas
 * bordas evita contar a célula vizinha quando a caixa encosta exatamente na linha da grade. Pares `x, z` em ordem
 * crescente, sem repetição.
 */
export function propNavCells(model: ModelDocument, prop: ModelPlacement, clearance = 1.5): number[] {
  if (!model.blocksNav || model.colliders.length === 0) return [];
  const boxes = new Float64Array(model.colliders.length * MODEL_COLLIDER_STRIDE);
  const n = propColliderBoxes(model, prop, boxes);
  const baseY = prop.y / MODEL_TEXELS_PER_METER;
  const eps = 0.01;
  const cells = new Set<number>();
  const keys: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const o = i * MODEL_COLLIDER_STRIDE;
    if (boxes[o + 1]! >= baseY + clearance) continue;
    const x0 = Math.floor((boxes[o]! + eps) / MODEL_NAV_CELL_SIZE);
    const x1 = Math.floor((boxes[o + 3]! - eps) / MODEL_NAV_CELL_SIZE);
    const z0 = Math.floor((boxes[o + 2]! + eps) / MODEL_NAV_CELL_SIZE);
    const z1 = Math.floor((boxes[o + 5]! - eps) / MODEL_NAV_CELL_SIZE);
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const key = (x + 0x8000) * 0x10000 + (z + 0x8000);
        if (cells.has(key)) continue;
        cells.add(key);
        keys.push([x, z]);
      }
    }
  }
  keys.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return keys.flat();
}
