import { isKnownContentId, isValidContentLocal } from '../content-ids.ts';
import { MODEL_KINDS } from './codec.ts';
import {
  MAX_MODEL_PARTS,
  MAX_MODEL_TRIANGLES,
  MODEL_FLAG,
  MODEL_FORMAT,
  REQUIRED_WEAPON_SOCKETS,
  WEAPON_SOCKETS,
  type ModelBox,
  type ModelDocument,
  type ModelKind,
  type ModelMesh,
  type ModelPack,
  type TexelVec3,
} from './types.ts';

/**
 * Teto de triângulos por TIPO de modelo (arte-ux.md §1.4, §3.2 e §13): arma até 600 (a maioria abaixo de 300), prop,
 * acessório e pickup até 300. Nunca passa de `MAX_MODEL_TRIANGLES`.
 */
export const MODEL_TRIANGLE_BUDGET: Readonly<Record<ModelKind, number>> = {
  weapon: MAX_MODEL_TRIANGLES,
  prop: 300,
  accessory: 300,
  pickup: 300,
};

/** Lado da camada de `modelos64` (a UV das caixas e malhas fica dentro de 0..64). */
export const MODEL_LAYER_SIZE = 64;

const ALL_FLAGS = Object.values(MODEL_FLAG).reduce((a, b) => a | b, 0);
const PART_NAME_RE = /^[a-z][a-z0-9_]{0,31}$/;
const LAYER_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const HALF_LIMIT = 16383.5;

/** Triângulos de uma caixa: 12, ou 4 se for plana (um lado com tamanho 0 vira 2 faces, frente e verso). */
export function boxTriangles(box: ModelBox): number {
  return box.size[0] === 0 || box.size[1] === 0 || box.size[2] === 0 ? 4 : 12;
}

/** Triângulos do modelo inteiro (caixas + malhas). */
export function modelTriangleCount(model: ModelDocument): number {
  let n = 0;
  for (const part of model.parts) {
    for (const box of part.boxes) n += boxTriangles(box);
    for (const mesh of part.meshes) n += Math.floor(mesh.indices.length / 3);
  }
  return n;
}

function isHalf(v: number): boolean {
  return Number.isFinite(v) && Number.isInteger(v * 2) && Math.abs(v) <= HALF_LIMIT;
}

function halfVec(v: TexelVec3): boolean {
  return v.length === 3 && isHalf(v[0]) && isHalf(v[1]) && isHalf(v[2]);
}

function checkBox(box: ModelBox, where: string, out: string[]): void {
  if (!halfVec(box.origin)) out.push(`${where}: origem precisa ser múltiplo de meio texel`);
  const [w, h, d] = box.size;
  if (!box.size.every((s) => Number.isInteger(s) && s >= 0 && s <= 0xffff)) {
    out.push(`${where}: tamanho precisa ser inteiro ≥ 0 (texels)`);
  }
  const [u, v] = box.uv;
  if (!Number.isInteger(u) || !Number.isInteger(v) || u < 0 || v < 0) {
    out.push(`${where}: UV precisa ser inteira ≥ 0`);
  } else if (u + 2 * d + 2 * w > MODEL_LAYER_SIZE || v + d + h > MODEL_LAYER_SIZE) {
    out.push(`${where}: cruz de UV (${u}, ${v}) + ${2 * d + 2 * w}×${d + h} sai da camada de 64×64`);
  }
  if (!LAYER_NAME_RE.test(box.layer)) out.push(`${where}: nome de camada inválido "${box.layer}"`);
  if (!(box.inflate >= 0) || !Number.isInteger(box.inflate * 4) || box.inflate > 63.75) {
    out.push(`${where}: inflar precisa ser 0..63,75 em quartos de texel`);
  }
}

function checkMesh(mesh: ModelMesh, where: string, out: string[]): void {
  const nv = mesh.positions.length / 3;
  if (!Number.isInteger(nv) || mesh.normals.length !== nv * 3 || mesh.uvs.length !== nv * 2) {
    out.push(`${where}: posições, normais e UV com tamanhos incoerentes`);
    return;
  }
  if (nv > 0xffff) out.push(`${where}: ${nv} vértices (máximo 65535)`);
  if (mesh.indices.length % 3 !== 0) out.push(`${where}: ${mesh.indices.length} índices (não é múltiplo de 3)`);
  for (const i of mesh.indices) {
    if (i >= nv) {
      out.push(`${where}: índice ${i} além dos ${nv} vértices`);
      break;
    }
  }
  for (const t of mesh.uvs) {
    if (t > MODEL_LAYER_SIZE) {
      out.push(`${where}: UV ${t} fora da camada de 64×64`);
      break;
    }
  }
  for (let i = 0; i < nv; i++) {
    if (mesh.normals[i * 3] === 0 && mesh.normals[i * 3 + 1] === 0 && mesh.normals[i * 3 + 2] === 0) {
      out.push(`${where}: vértice ${i} sem normal`);
      break;
    }
  }
  if (!LAYER_NAME_RE.test(mesh.layer)) out.push(`${where}: nome de camada inválido "${mesh.layer}"`);
}

/**
 * Confere um modelo (tecnico.md §15.3): ID registrado (`model:<id>`), peças com mãe antes da filha, até
 * `MAX_MODEL_TRIANGLES` triângulos (e o teto do tipo, `MODEL_TRIANGLE_BUDGET`), soquetes obrigatórios das armas,
 * UV dentro de 64×64, camadas nomeadas, valores que cabem na quantização do `.bfmodel`, colisores não vazios, prop com
 * colisor e luz só em modelo emissivo. Devolve as mensagens (pt-BR) dos problemas; vazio = ok.
 */
export function validateModel(model: ModelDocument): readonly string[] {
  const out: string[] = [];
  const id = model.id;
  const tag = `model:${id}`;
  if (model.format !== MODEL_FORMAT) out.push(`${tag}: format precisa ser "${MODEL_FORMAT}"`);
  if (!isValidContentLocal(id)) out.push(`${tag}: ID com forma inválida`);
  else if (!isKnownContentId(tag)) out.push(`${tag}: ID não registrado no content-ids`);
  if (!MODEL_KINDS.includes(model.kind)) out.push(`${tag}: tipo desconhecido "${String(model.kind)}"`);
  if (!Number.isInteger(model.flags) || (model.flags & ~ALL_FLAGS) !== 0)
    out.push(`${tag}: flags com bits desconhecidos`);
  if (!Number.isInteger(model.debrisColor) || model.debrisColor < 0 || model.debrisColor > 0xffffff) {
    out.push(`${tag}: debrisColor precisa ser 0xRRGGBB`);
  }

  // Peças
  if (model.parts.length === 0) out.push(`${tag}: sem peças`);
  if (model.parts.length > MAX_MODEL_PARTS) out.push(`${tag}: ${model.parts.length} peças (máximo ${MAX_MODEL_PARTS})`);
  const partNames = new Set<string>();
  model.parts.forEach((part, i) => {
    const where = `${tag}: peça "${part.name}"`;
    if (!PART_NAME_RE.test(part.name)) out.push(`${where}: nome inválido (minúsculas, dígitos e _)`);
    if (partNames.has(part.name)) out.push(`${where}: nome repetido`);
    partNames.add(part.name);
    if (i === 0 && part.parent !== -1) out.push(`${where}: a primeira peça precisa ser a raiz (mãe -1)`);
    if (!Number.isInteger(part.parent) || part.parent < -1 || part.parent >= i) {
      out.push(`${where}: mãe ${part.parent} precisa vir antes da filha`);
    }
    if (!halfVec(part.pivot)) out.push(`${where}: pivô precisa ser múltiplo de meio texel`);
    if (part.boxes.length > 255 || part.meshes.length > 255) out.push(`${where}: mais de 255 caixas ou malhas`);
    part.boxes.forEach((box, b) => checkBox(box, `${where}, caixa ${b}`, out));
    part.meshes.forEach((mesh, m) => checkMesh(mesh, `${where}, malha ${m}`, out));
  });

  const tris = modelTriangleCount(model);
  const budget = Math.min(MAX_MODEL_TRIANGLES, MODEL_TRIANGLE_BUDGET[model.kind] ?? MAX_MODEL_TRIANGLES);
  if (tris > budget) out.push(`${tag}: ${tris} triângulos (teto de ${model.kind}: ${budget})`);

  // Soquetes
  const socketNames = new Set<string>();
  for (const s of model.sockets) {
    const where = `${tag}: soquete "${s.name}"`;
    if (!PART_NAME_RE.test(s.name)) out.push(`${where}: nome inválido`);
    if (socketNames.has(s.name)) out.push(`${where}: repetido`);
    socketNames.add(s.name);
    if (!Number.isInteger(s.part) || s.part < 0 || s.part >= model.parts.length) out.push(`${where}: peça inexistente`);
    if (!halfVec(s.position)) out.push(`${where}: posição precisa ser múltiplo de meio texel`);
    const len = Math.hypot(s.direction[0], s.direction[1], s.direction[2]);
    if (!(Math.abs(len - 1) <= 0.01)) out.push(`${where}: direção precisa ser unitária`);
    if (model.kind === 'weapon' && !(WEAPON_SOCKETS as readonly string[]).includes(s.name)) {
      out.push(`${where}: arma só aceita ${WEAPON_SOCKETS.join(', ')}`);
    }
  }
  if (model.kind === 'weapon') {
    for (const name of REQUIRED_WEAPON_SOCKETS) {
      if (!socketNames.has(name)) out.push(`${tag}: arma sem o soquete obrigatório "${name}"`);
    }
  }

  // Colisão, navegação e luz
  model.colliders.forEach((c, i) => {
    const where = `${tag}: colisor ${i}`;
    if (!halfVec(c.min) || !halfVec(c.max)) out.push(`${where}: cantos precisam ser múltiplos de meio texel`);
    else if (!(c.min[0] < c.max[0] && c.min[1] < c.max[1] && c.min[2] < c.max[2])) out.push(`${where}: caixa vazia`);
  });
  if (model.kind === 'prop' && model.colliders.length === 0) out.push(`${tag}: prop sem caixa de colisão`);
  if (model.blocksNav && model.colliders.length === 0) out.push(`${tag}: ocupa navegação mas não tem colisor`);
  if (model.light !== null) {
    const { level, position } = model.light;
    if (!Number.isInteger(level) || level < 1 || level > 15) out.push(`${tag}: luz com nível ${level} (1..15)`);
    if (!halfVec(position)) out.push(`${tag}: posição da luz precisa ser múltiplo de meio texel`);
    if ((model.flags & MODEL_FLAG.emissive) === 0) out.push(`${tag}: luz sem a flag emissive`);
  }
  return out;
}

/** Camadas de textura que o modelo usa (nomes, sem repetição, na ordem em que aparecem). */
export function modelLayers(model: ModelDocument): string[] {
  const seen = new Set<string>();
  for (const part of model.parts) {
    for (const box of part.boxes) seen.add(box.layer);
    for (const mesh of part.meshes) seen.add(mesh.layer);
  }
  return [...seen];
}

/** Confere se toda camada citada pelo modelo existe no manifesto (`layers@1`) de `modelos64`. */
export function validateModelLayers(model: ModelDocument, knownLayers: ReadonlySet<string>): readonly string[] {
  return modelLayers(model)
    .filter((name) => !knownLayers.has(name))
    .map((name) => `model:${model.id}: camada "${name}" não existe em modelos64`);
}

/** Confere um pacote inteiro: cada modelo, IDs repetidos e (se dado) as camadas existentes. */
export function validateModelPack(pack: ModelPack, knownLayers?: ReadonlySet<string>): readonly string[] {
  const out: string[] = [];
  const ids = new Set<string>();
  for (const model of pack.models) {
    if (ids.has(model.id)) out.push(`model:${model.id}: repetido no pacote`);
    ids.add(model.id);
    out.push(...validateModel(model));
    if (knownLayers !== undefined) out.push(...validateModelLayers(model, knownLayers));
  }
  return out;
}
