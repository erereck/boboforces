// Props fora da grade (tecnico.md §6.6): um `InstancedMesh` por TIPO e por grupo espacial de 32 m, para o culling por
// vista funcionar (meta: ≤ 15 draw calls de props por vista, 8 no Switch 3–4P). Montado uma vez no `setMap`; por vista
// só muda `visible` e o `count` da dose. Sem three (testável em Node).
import { PROP_DOSE, type PropDose, type PropDoseView } from '@boboforces/format';
import type { RenderProp } from '../types.ts';
import { INST, INSTANCE_FLOATS, writeInstanceDefaults } from './layout.ts';
import { m4Identity, m4RotateY, m4Scale, m4Translate, MAT4 } from './math.ts';
import type { ModelBinding } from './model-geometry.ts';

/** Lado do grupo espacial (m). */
export const PROP_GROUP_SIZE_M = 32;
/** Teto de draw calls de props por vista (tecnico.md §6.6) e no Switch 3–4P. */
export const PROP_DRAWS_PER_VIEW = 15;
export const PROP_DRAWS_PER_VIEW_SMALL = 8;

/** Amostra a luz (céu, sol, emissivo 0..1) num ponto, como `sampleLightGrid` do world. */
export type LightSampler = (x: number, y: number, z: number, out: Float32Array, offset: number) => void;

export interface PropGroupData {
  readonly model: number;
  readonly cellX: number;
  readonly cellZ: number;
  /** Instâncias ordenadas pela dose (`PROP_DOSE`: 0 sempre, 1 proposta, 2 dobro). */
  readonly count: number;
  readonly matrices: Float32Array;
  readonly data: Float32Array;
  /** Quantas instâncias aparecem em cada dose vista, no índice da dose: [só blocos, proposta, dobro]. */
  readonly countByDose: readonly [number, number, number];
  /** Esfera envolvente do grupo (m), para o frustum. */
  readonly sphereX: number;
  readonly sphereY: number;
  readonly sphereZ: number;
  readonly radius: number;
}

/**
 * Dose máxima mostrada pela chave de depuração (índice de `countByDose`). Amarrada ao `PROP_DOSE` do format: com o
 * padrão `PLAYABLE_PROP_DOSE_VIEW`, a vista mostra exatamente as props do jogo (`PLAYABLE_PROP_DOSE`, decisão #52).
 */
export function doseIndex(view: PropDoseView): PropDose {
  return view === 'blocks' ? PROP_DOSE.always : view === 'proposal' ? PROP_DOSE.proposal : PROP_DOSE.double;
}

/**
 * Distância (m) do ponto à SUPERFÍCIE da esfera do grupo (0 dentro dela): a chave do teto de draw calls. Pelo centro,
 * um grupo de 32 m (raio até ~16 m) com prop a poucos metros perderia para grupos pequenos mais longe.
 */
export function propSurfaceDistance(group: PropGroupData, x: number, y: number, z: number): number {
  return Math.max(0, Math.hypot(group.sphereX - x, group.sphereY - y, group.sphereZ - z) - group.radius);
}

/**
 * Agrupa as props por modelo e célula de 32 m (XZ), escreve matriz (posição, giro, escala) e luz amostrada no centro
 * de cada uma. Modelo ausente (`null` na lista) é pulado. Ordem determinística (modelo, depois célula).
 */
export function buildPropGroups(
  props: readonly RenderProp[],
  models: readonly (ModelBinding | null)[],
  sampleLight: LightSampler | null,
): PropGroupData[] {
  const buckets = new Map<string, { model: number; cellX: number; cellZ: number; items: RenderProp[] }>();
  for (const prop of props) {
    const binding = models[prop.model];
    if (!binding || binding.geometry.vertexCount === 0) continue;
    const cellX = Math.floor(prop.x / PROP_GROUP_SIZE_M);
    const cellZ = Math.floor(prop.z / PROP_GROUP_SIZE_M);
    const key = `${prop.model}:${cellX}:${cellZ}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { model: prop.model, cellX, cellZ, items: [] };
      buckets.set(key, bucket);
    }
    bucket.items.push(prop);
  }
  const ordered = [...buckets.values()].sort((a, b) => a.model - b.model || a.cellZ - b.cellZ || a.cellX - b.cellX);
  const light = new Float32Array(3);
  return ordered.map((bucket) => {
    const binding = models[bucket.model]!;
    const items = bucket.items.slice().sort((a, b) => clampDose(a.dose) - clampDose(b.dose));
    const n = items.length;
    const matrices = new Float32Array(n * MAT4);
    const data = new Float32Array(n * INSTANCE_FLOATS);
    const countByDose: [number, number, number] = [0, 0, 0];
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    const b = binding.bounds;
    items.forEach((prop, i) => {
      const s = prop.scale > 0 ? prop.scale : 1;
      const m = i * MAT4;
      m4Identity(matrices, m);
      m4Translate(matrices, prop.x, prop.y, prop.z, m);
      m4RotateY(matrices, prop.yaw, m);
      m4Scale(matrices, s, s, s, m);
      const d = i * INSTANCE_FLOATS;
      writeInstanceDefaults(data, d);
      // Centro da esfera do modelo no mundo (o giro em Y move o centro no plano).
      const c = Math.cos(prop.yaw);
      const sn = Math.sin(prop.yaw);
      const cx = prop.x + (b.x * c + b.z * sn) * s;
      const cy = prop.y + b.y * s;
      const cz = prop.z + (-b.x * sn + b.z * c) * s;
      if (sampleLight) {
        sampleLight(cx, cy, cz, light, 0);
        data[d + INST.sky] = light[0]!;
        data[d + INST.sun] = light[1]!;
        data[d + INST.emissive] = light[2]!;
      }
      const dose = clampDose(prop.dose);
      for (let k = dose; k < 3; k++) countByDose[k]!++;
      const r = b.radius * s;
      minX = Math.min(minX, cx - r);
      minY = Math.min(minY, cy - r);
      minZ = Math.min(minZ, cz - r);
      maxX = Math.max(maxX, cx + r);
      maxY = Math.max(maxY, cy + r);
      maxZ = Math.max(maxZ, cz + r);
    });
    return {
      model: bucket.model,
      cellX: bucket.cellX,
      cellZ: bucket.cellZ,
      count: n,
      matrices,
      data,
      countByDose,
      sphereX: (minX + maxX) / 2,
      sphereY: (minY + maxY) / 2,
      sphereZ: (minZ + maxZ) / 2,
      radius: Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2,
    };
  });
}

function clampDose(dose: number): PropDose {
  return dose <= PROP_DOSE.always ? PROP_DOSE.always : dose >= PROP_DOSE.double ? PROP_DOSE.double : PROP_DOSE.proposal;
}

/**
 * Escolhe quais grupos visíveis desenhar quando passam do teto da vista: os mais perto ficam (os de longe já estão na
 * fog). `distances` (a do passe é `propSurfaceDistance`) e `order` são rascunhos do chamador (tamanho = nº de grupos),
 * sem alocar. Ordem estável: empate mantém o índice menor. Devolve quantos ficaram em `order`.
 */
export function limitGroups(
  visible: Uint8Array,
  distances: Float32Array,
  order: Int32Array,
  groupCount: number,
  cap: number,
): number {
  let n = 0;
  for (let g = 0; g < groupCount; g++) if (visible[g] === 1) order[n++] = g;
  if (n <= cap) return n;
  // Seleção parcial por inserção (n pequeno: dezenas de grupos).
  for (let a = 1; a < n; a++) {
    const g = order[a]!;
    const d = distances[g]!;
    let b = a - 1;
    while (b >= 0 && distances[order[b]!]! > d) {
      order[b + 1] = order[b]!;
      b--;
    }
    order[b + 1] = g;
  }
  for (let k = cap; k < n; k++) visible[order[k]!] = 0;
  return cap;
}
