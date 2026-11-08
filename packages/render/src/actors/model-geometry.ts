// `.bfmodel` → geometria do programa 4 (sem three, testável em Node). No M1 o modelo vira UMA malha na pose de
// repouso (peças com o pivô acumulado): um draw call por modelo visível. Camadas por NOME, resolvidas no loading pelo
// manifesto de `modelos64` (reordenar a tira do modelgen nunca quebra nada).
import { MODEL_FLAG, MODEL_TEXELS_PER_METER, type ModelDocument, type ModelKind } from '@boboforces/format';
import { addTexturedBox, boundingSphere, GeometryBuilder, type GeometryArrays } from './geometry.ts';
import { VERT_COMPONENTS, VERTEX_FLAG } from './layout.ts';

const TEXEL = 1 / MODEL_TEXELS_PER_METER;
/** Lado da camada de `modelos64` em texels. */
const LAYER_SIZE = 64;

/** O que o render precisa saber de uma camada pelo nome: índice e como desenhar. */
export interface LayerRef {
  readonly index: number;
  readonly cutout: boolean;
  readonly emissive: boolean;
}
export type LayerLookup = (name: string) => LayerRef | null;

/** Soquete em METROS, no espaço do modelo inteiro (pose de repouso), com a direção unitária. */
export interface SocketM {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly dx: number;
  readonly dy: number;
  readonly dz: number;
}

export interface ModelBinding {
  readonly id: string;
  readonly kind: ModelKind;
  readonly flags: number;
  readonly geometry: GeometryArrays;
  /** Esfera envolvente no espaço do modelo (m). */
  readonly bounds: { readonly x: number; readonly y: number; readonly z: number; readonly radius: number };
  readonly sockets: ReadonlyMap<string, SocketM>;
  readonly debrisColor: number;
  /** Nomes de camada que o manifesto não tem (caem na camada 0; o render avisa uma vez). */
  readonly missingLayers: readonly string[];
}

/** Pivô absoluto (texels) de cada peça na pose de repouso. Mãe sempre antes da filha (validador do format). */
function absolutePivots(model: ModelDocument): Float32Array {
  const out = new Float32Array(model.parts.length * 3);
  model.parts.forEach((part, i) => {
    const parent = part.parent;
    for (let k = 0; k < 3; k++) {
      const base = parent >= 0 && parent < i ? out[parent * 3 + k]! : 0;
      out[i * 3 + k] = base + part.pivot[k]!;
    }
  });
  return out;
}

/** Um soquete em metros no espaço do modelo (pose de repouso), sem montar a geometria; `null` se não existe. */
export function modelSocket(model: ModelDocument, name: string): SocketM | null {
  const s = model.sockets.find((socket) => socket.name === name);
  if (!s) return null;
  const pivots = absolutePivots(model);
  const part = s.part >= 0 && s.part < model.parts.length ? s.part : 0;
  const len = Math.hypot(s.direction[0], s.direction[1], s.direction[2]) || 1;
  return {
    x: (pivots[part * 3]! + s.position[0]) * TEXEL,
    y: (pivots[part * 3 + 1]! + s.position[1]) * TEXEL,
    z: (pivots[part * 3 + 2]! + s.position[2]) * TEXEL,
    dx: s.direction[0] / len,
    dy: s.direction[1] / len,
    dz: s.direction[2] / len,
  };
}

/** Monta a geometria e os dados de um modelo. Peça desconhecida não quebra: camada ausente vira a 0. */
export function buildModelBinding(model: ModelDocument, lookup: LayerLookup): ModelBinding {
  const pivots = absolutePivots(model);
  const missing = new Set<string>();
  const resolve = (name: string): LayerRef => {
    const ref = lookup(name);
    if (ref) return ref;
    missing.add(name);
    return { index: 0, cutout: false, emissive: false };
  };
  const flagsOf = (ref: LayerRef): number =>
    (ref.cutout ? VERTEX_FLAG.alphaTest : 0) | (ref.emissive ? VERTEX_FLAG.emissive : 0);

  const b = new GeometryBuilder();
  model.parts.forEach((part, pi) => {
    const px = pivots[pi * 3]!;
    const py = pivots[pi * 3 + 1]!;
    const pz = pivots[pi * 3 + 2]!;
    for (const box of part.boxes) {
      const ref = resolve(box.layer);
      addTexturedBox(
        b,
        {
          min: [(px + box.origin[0]) * TEXEL, (py + box.origin[1]) * TEXEL, (pz + box.origin[2]) * TEXEL],
          size: [box.size[0] * TEXEL, box.size[1] * TEXEL, box.size[2] * TEXEL],
          inflate: box.inflate * TEXEL,
          tex: [box.size[0], box.size[1], box.size[2]],
          uv: box.uv,
          layerSize: LAYER_SIZE,
          mirror: box.mirror,
        },
        { layer: ref.index, flags: flagsOf(ref) },
      );
    }
    for (const mesh of part.meshes) {
      const ref = resolve(mesh.layer);
      const tag = { layer: ref.index, flags: flagsOf(ref) };
      const base = b.vertexCount;
      const count = mesh.positions.length / 3;
      for (let v = 0; v < count; v++) {
        const nx = mesh.normals[v * 3]! / 127;
        const ny = mesh.normals[v * 3 + 1]! / 127;
        const nz = mesh.normals[v * 3 + 2]! / 127;
        const len = Math.hypot(nx, ny, nz) || 1;
        b.vertex(
          (px + mesh.positions[v * 3]!) * TEXEL,
          (py + mesh.positions[v * 3 + 1]!) * TEXEL,
          (pz + mesh.positions[v * 3 + 2]!) * TEXEL,
          nx / len,
          ny / len,
          nz / len,
          mesh.uvs[v * 2]! / LAYER_SIZE,
          mesh.uvs[v * 2 + 1]! / LAYER_SIZE,
          tag,
        );
      }
      for (const index of mesh.indices) b.indices.push(base + index);
    }
  });
  const geometry = b.build();

  // Balanço com o vento: 0 na base, 1 no topo (só modelos com `swaysInWind`: árvore, lona).
  if ((model.flags & MODEL_FLAG.swaysInWind) !== 0 && geometry.vertexCount > 0) {
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < geometry.vertexCount; i++) {
      minY = Math.min(minY, geometry.positions[i * 3 + 1]!);
      maxY = Math.max(maxY, geometry.positions[i * 3 + 1]!);
    }
    const span = Math.max(1e-6, maxY - minY);
    for (let i = 0; i < geometry.vertexCount; i++) {
      geometry.verts[i * VERT_COMPONENTS + 2] = (geometry.positions[i * 3 + 1]! - minY) / span;
    }
  }

  const sockets = new Map<string, SocketM>();
  for (const s of model.sockets) {
    const part = s.part >= 0 && s.part < model.parts.length ? s.part : 0;
    const len = Math.hypot(s.direction[0], s.direction[1], s.direction[2]) || 1;
    sockets.set(s.name, {
      x: (pivots[part * 3]! + s.position[0]) * TEXEL,
      y: (pivots[part * 3 + 1]! + s.position[1]) * TEXEL,
      z: (pivots[part * 3 + 2]! + s.position[2]) * TEXEL,
      dx: s.direction[0] / len,
      dy: s.direction[1] / len,
      dz: s.direction[2] / len,
    });
  }

  return {
    id: model.id,
    kind: model.kind,
    flags: model.flags,
    geometry,
    bounds: boundingSphere(geometry),
    sockets,
    debrisColor: model.debrisColor,
    missingLayers: [...missing],
  };
}
