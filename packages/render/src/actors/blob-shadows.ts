// M12 (fase 5): a sombra-blob das props e do que está no chão (sem three, testável em Node). As flags
// `MODEL_FLAG.blobShadow` do `.bfmodel` passam a valer: cada prop do mapa com a flag ganha um disco escuro no chão,
// num PREFIXO estático da mesma malha "sombra-blob" dos bonecos (refeito no `setMap`/`setModels`), e cada item do
// buffer de projéteis com a flag (arma e caixinha no chão, granada, foguete, gerador) ganha um por quadro, depois dos
// bonecos. Zero draw a mais: é a mesma instância de partícula (`PARTICLE_KIND.blob`, programa 5).
import { MODEL_FLAG, PROP_DOSE } from '@boboforces/format';
import { PARTICLE_FLOATS } from '../fx/particles.ts';
import { PARTICLE_KIND } from '../fx/shader.ts';
import { floorBelow, type CollisionWorld } from '../fx/verlet.ts';
import type { RenderProp } from '../types.ts';
import type { ModelBinding } from './model-geometry.ts';

/** Alfa da sombra das props (a mesma dos bonecos: a copa do pinheiro cobre o meio do disco, a borda é que lê). */
export const PROP_SHADOW_ALPHA = 0.42;
/** Alfa da sombra do item no chão (arma, caixinha, granada). */
export const ITEM_SHADOW_ALPHA = 0.5;
/** Teto de sombras de prop no prefixo (o Royale Grande tem centenas de pinheiros; os de longe somem na fog). */
export const PROP_SHADOW_MAX = 2048;
/** Diâmetro da sombra: média das larguras X e Z do modelo × isto (passa da copa), presa a [mín, máx] (m). */
const SIZE_GAIN = 1.35;
const SIZE_MIN = 0.3;
const SIZE_MAX = 4;

/** O modelo pede sombra-blob? */
export function hasBlobShadow(binding: ModelBinding | null | undefined): binding is ModelBinding {
  return binding !== null && binding !== undefined && (binding.flags & MODEL_FLAG.blobShadow) !== 0;
}

/**
 * Diâmetro (m) e centro (x, z no espaço do modelo) da sombra de um modelo, pela caixa XZ da geometria em repouso.
 * Guardado por binding (a conta percorre os vértices uma vez).
 */
export interface BlobFootprint {
  readonly size: number;
  readonly cx: number;
  readonly cz: number;
}

const footprints = new WeakMap<ModelBinding, BlobFootprint>();

export function blobFootprint(binding: ModelBinding): BlobFootprint {
  const known = footprints.get(binding);
  if (known) return known;
  const p = binding.geometry.positions;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i + 2 < p.length; i += 3) {
    const x = p[i]!;
    const z = p[i + 2]!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const fp: BlobFootprint =
    minX <= maxX
      ? {
          size: Math.min(SIZE_MAX, Math.max(SIZE_MIN, ((maxX - minX + (maxZ - minZ)) / 2) * SIZE_GAIN)),
          cx: (minX + maxX) / 2,
          cz: (minZ + maxZ) / 2,
        }
      : { size: SIZE_MIN, cx: 0, cz: 0 };
  footprints.set(binding, fp);
  return fp;
}

/**
 * Escreve um disco de sombra (24 floats) em data[n·24 ..]: centro (x, chão + 1 cm, z), diâmetro e alfa. `prop`: o
 * disco é de prop do mapa (`pC.x` = 1): a vista que esconde o grupo dela pelo teto de draw calls apaga o disco junto
 * (`uBlobMaxDist`, `fx/shader.ts`).
 */
export function writeBlob(
  data: Float32Array,
  n: number,
  x: number,
  ground: number,
  z: number,
  size: number,
  alpha: number,
  prop = false,
): void {
  const o = n * PARTICLE_FLOATS;
  data[o] = x;
  data[o + 1] = ground + 0.01;
  data[o + 2] = z;
  data[o + 3] = size;
  data.fill(0, o + 4, o + 15);
  data[o + 8] = prop ? 1 : 0;
  data[o + 9] = 1;
  data[o + 15] = alpha;
  data[o + 16] = 0;
  data[o + 17] = 1e9;
  data[o + 18] = PARTICLE_KIND.blob;
  data[o + 19] = 1;
  data[o + 20] = 1;
  data[o + 21] = 1;
  data[o + 22] = 0;
  data[o + 23] = 0;
}

/** O prefixo das props: os discos (24 floats cada) e a dose de cada um (`PROP_DOSE`; a chave visual esconde). */
export interface PropShadows {
  readonly count: number;
  readonly data: Float32Array;
  readonly dose: Uint8Array;
}

/** Frações do diâmetro tentadas quando a borda do disco passa de um degrau (a 1ª que assenta fica; nenhuma: sem). */
const RIM_TRIES: readonly number[] = [1, 0.75, 0.55];
/** Pontos da borda conferidos e o desnível (m) que já conta como degrau para baixo. */
const RIM_POINTS = 8;
const RIM_DROP_M = 0.15;

/**
 * M12 (fase 5, revisão): o disco grande (até 4 m) sobre um degrau ficava no ar: confere o chão em 8 pontos da borda
 * (`floorBelow` da física cosmética) e encolhe o disco até ele assentar; devolve a fração do diâmetro (0 = sem disco).
 * Sem mundo, o disco inteiro.
 */
export function fitBlobToGround(
  world: CollisionWorld | null,
  x: number,
  base: number,
  z: number,
  size: number,
): number {
  if (!world) return 1;
  for (const k of RIM_TRIES) {
    const r = (size * k) / 2;
    let ok = true;
    for (let p = 0; p < RIM_POINTS && ok; p++) {
      const a = (p / RIM_POINTS) * Math.PI * 2;
      const g = floorBelow(world, x + Math.cos(a) * r, base + 0.3, z + Math.sin(a) * r, 1.5);
      if (!(g === g) || g < base - RIM_DROP_M) ok = false;
    }
    if (ok) return k;
  }
  return 0;
}

/**
 * Uma sombra por prop do mapa cujo modelo tem `blobShadow`, no centro da pegada (girado pelo yaw da prop, na escala
 * dela) e na base da prop (o pivô dos modelos é a base), encolhida até assentar no chão (`fitBlobToGround`, com o
 * `world`). Ordem do `.bfmap`, até `PROP_SHADOW_MAX`.
 */
export function buildPropShadows(
  props: readonly RenderProp[],
  models: readonly (ModelBinding | null)[],
  world: CollisionWorld | null = null,
): PropShadows {
  const data: number[] = [];
  const doses: number[] = [];
  const scratch = new Float32Array(PARTICLE_FLOATS);
  for (const prop of props) {
    if (doses.length >= PROP_SHADOW_MAX) break;
    const binding = models[prop.model];
    if (!hasBlobShadow(binding)) continue;
    const fp = blobFootprint(binding);
    const s = prop.scale > 0 ? prop.scale : 1;
    const c = Math.cos(prop.yaw);
    const sn = Math.sin(prop.yaw);
    const x = prop.x + (fp.cx * c + fp.cz * sn) * s;
    const z = prop.z + (-fp.cx * sn + fp.cz * c) * s;
    const fit = fitBlobToGround(world, x, prop.y, z, fp.size * s);
    if (fit <= 0) continue;
    writeBlob(scratch, 0, x, prop.y, z, fp.size * s * fit, PROP_SHADOW_ALPHA, true);
    for (let k = 0; k < PARTICLE_FLOATS; k++) data.push(scratch[k]!);
    doses.push(
      prop.dose <= PROP_DOSE.always
        ? PROP_DOSE.always
        : prop.dose >= PROP_DOSE.double
          ? PROP_DOSE.double
          : PROP_DOSE.proposal,
    );
  }
  const count = doses.length;
  const out = new Float32Array(Math.max(1, count) * PARTICLE_FLOATS);
  out.set(data);
  const dose = new Uint8Array(Math.max(1, count));
  dose.set(doses);
  return { count, data: out, dose };
}

/** Liga (alfa da prop) ou apaga (alfa 0: o shader descarta) as sombras do prefixo pela dose da chave visual. */
export function applyPropShadowDose(shadows: PropShadows, target: Float32Array, maxDose: number): void {
  for (let n = 0; n < shadows.count; n++) {
    target[n * PARTICLE_FLOATS + 15] = shadows.dose[n]! <= maxDose ? PROP_SHADOW_ALPHA : 0;
  }
}
