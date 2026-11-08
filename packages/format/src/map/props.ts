import type { ModelCollider, TexelVec3 } from '../model/types.ts';
import { MAP_TEXELS_PER_METER, type MapProp } from './types.ts';

/**
 * Prop do `.bfmap` → mundo (frente "mapa-nav"; usado pelo `mapc` e pelo loading do jogo, para os dois montarem as
 * MESMAS caixas e fontes de luz). Puro e sem alocação.
 *
 * Convenções do `map@1`: pivô em texels (1/32 m); giro em Y em passos de 1/256 de volta, anti-horário visto de cima
 * (o yaw +: a frente -Z do modelo vai para -X com +64 passos); escala uniforme em 1/16. O modelo é Y para cima com a
 * frente em -Z (model@1).
 */

/** Passos de giro por volta (u8 do arquivo). */
export const MAP_PROP_YAW_STEPS = 256;
/** Escala 16 = 1,0. */
export const MAP_PROP_SCALE_ONE = 16;

/**
 * Ponto do modelo (texels, relativo ao pivô) → mundo (metros), em `out[offset..offset+2]`. Giro em Y pelo yaw da
 * prop, escala uniforme e translação para o pivô.
 */
export function propPointToWorld(
  prop: MapProp,
  x: number,
  y: number,
  z: number,
  out: Float32Array | Float64Array | number[],
  offset = 0,
): void {
  const a = (prop.yaw / MAP_PROP_YAW_STEPS) * Math.PI * 2;
  const s = prop.scale / MAP_PROP_SCALE_ONE;
  const c = Math.cos(a);
  const n = Math.sin(a);
  out[offset] = (prop.x + (x * c + z * n) * s) / MAP_TEXELS_PER_METER;
  out[offset + 1] = (prop.y + y * s) / MAP_TEXELS_PER_METER;
  out[offset + 2] = (prop.z + (-x * n + z * c) * s) / MAP_TEXELS_PER_METER;
}

/** Arredonda para 1/1024 m (caixas estáveis entre plataformas: seno e cosseno podem variar no último bit). */
const snap = (v: number): number => Math.round(v * 1024) / 1024;

/**
 * Caixas de colisão da prop no mundo, ALINHADAS AOS EIXOS (giro livre só no visual: cada caixa vira a envolvente da
 * caixa girada; não existe colisor girado nem cilíndrico, decisão #7). Escreve 6 floats por caixa (minX, minY, minZ,
 * maxX, maxY, maxZ, metros) em `out` a partir de `offset`; devolve quantas caixas escreveu.
 */
export function propCollidersToWorld(
  prop: MapProp,
  colliders: readonly ModelCollider[],
  out: Float32Array | Float64Array | number[],
  offset = 0,
): number {
  let o = offset;
  for (const col of colliders) {
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (let corner = 0; corner < 4; corner++) {
      const cx = (corner & 1) === 0 ? col.min[0] : col.max[0];
      const cz = (corner & 2) === 0 ? col.min[2] : col.max[2];
      propPointToWorld(prop, cx, 0, cz, out, o);
      minX = Math.min(minX, out[o]!);
      maxX = Math.max(maxX, out[o]!);
      minZ = Math.min(minZ, out[o + 2]!);
      maxZ = Math.max(maxZ, out[o + 2]!);
    }
    const s = prop.scale / MAP_PROP_SCALE_ONE;
    out[o] = snap(minX);
    out[o + 1] = snap((prop.y + col.min[1] * s) / MAP_TEXELS_PER_METER);
    out[o + 2] = snap(minZ);
    out[o + 3] = snap(maxX);
    out[o + 4] = snap((prop.y + col.max[1] * s) / MAP_TEXELS_PER_METER);
    out[o + 5] = snap(maxZ);
    o += 6;
  }
  return colliders.length;
}

const LIGHT_SCRATCH = new Float64Array(3);

/** Ponto de luz da prop (texels do modelo) → célula da grade (inteiros), presa dentro da grade. */
export function propLightCell(
  prop: MapProp,
  position: TexelVec3,
  sizeX: number,
  sizeY: number,
  sizeZ: number,
  out: Int32Array | number[],
  offset = 0,
): void {
  const m = LIGHT_SCRATCH;
  propPointToWorld(prop, position[0], position[1], position[2], m);
  const cell = (v: number, max: number): number => Math.min(max - 1, Math.max(0, Math.floor(v * 2)));
  out[offset] = cell(m[0]!, sizeX);
  out[offset + 1] = cell(m[1]!, sizeY);
  out[offset + 2] = cell(m[2]!, sizeZ);
}
