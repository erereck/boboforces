import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';
import {
  BFMODEL_MAGIC,
  BFMODEL_PLACEHOLDER_VERSION,
  BFMODEL_VERSION,
  MODEL_FORMAT,
  type ModelBox,
  type ModelCollider,
  type ModelDocument,
  type ModelKind,
  type ModelLight,
  type ModelMesh,
  type ModelPack,
  type ModelPart,
  type ModelSocket,
  type TexelVec3,
} from './types.ts';

/**
 * Codificador e decodificador do `.bfmodel` (`model@1`). Frente "skins-modelos".
 *
 * Pacote (little-endian), TODO comprimido com deflate cru (fflate, nível 9), como o provisório da etapa de contratos:
 *   u32 magia `BFMODEL_MAGIC` ("BFMD") · u16 versão (1) · u16 nº de modelos · por modelo: u32 tamanho · conteúdo
 *
 * Conteúdo de um modelo (todas as medidas em inteiros):
 *   u16 nº de strings · (u8 tamanho em bytes, UTF-8) × n     tabela de strings: ID, nomes de peça, soquete e camada
 *   u16 ID (índice na tabela) · u8 tipo (`MODEL_KINDS`) · u16 flags · u8 R · u8 G · u8 B (cor dos cubinhos) ·
 *   u8 ocupa navegação (0/1)
 *   u8 nº de peças · por peça:
 *     u16 nome · i8 mãe · 3×i16 pivô (meio texel)
 *     u8 nº de caixas · por caixa: 3×i16 origem (meio texel) · 3×u16 tamanho (texel) · u8 u · u8 v · u16 camada ·
 *       u8 inflar (quarto de texel) · u8 espelho (0/1)
 *     u8 nº de malhas · por malha: u16 camada · u16 nº de vértices · u32 nº de índices · i16×3 posições (texel) ·
 *       i8×3 normais (×127) · u8×2 UV (texel) · u16 índices
 *   u8 nº de soquetes · por soquete: u16 nome · u8 peça · 3×i16 posição (meio texel) · 3×i16 direção (×16384)
 *   u16 nº de colisores · por colisor: 3×i16 mínimo · 3×i16 máximo (meio texel)
 *   u8 tem luz (0/1) · [3×i16 posição (meio texel) · u8 nível]
 *
 * Meio texel (1/64 m) cobre a camada externa das caixas (meio pixel maior por lado) e pivôs no meio de um texel. Valor
 * que não cabe na quantização é ERRO no codificador (o validador avisa antes, no modelgen). A direção dos soquetes é
 * normalizada na volta.
 */

/** Ordem fixa dos tipos no binário. */
export const MODEL_KINDS: readonly ModelKind[] = ['weapon', 'prop', 'accessory', 'pickup'];

/** Teto de bytes do pacote inflado (o do M1 tem poucos KB; protege contra arquivo malformado). */
export const BFMODEL_MAX_BYTES = 8 * 1024 * 1024;

const DIR_SCALE = 16384;

function fail(message: string): never {
  throw new Error(`bfmodel: ${message}`);
}

// ---------------------------------------------------------------------------------------------------------------
// Escrita

class Writer {
  private buf = new Uint8Array(1024);
  private view = new DataView(this.buf.buffer);
  length = 0;

  private reserve(n: number): void {
    if (this.length + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.length + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }

  u8(v: number): void {
    this.reserve(1);
    this.view.setUint8(this.length, v);
    this.length += 1;
  }

  i8(v: number): void {
    this.reserve(1);
    this.view.setInt8(this.length, v);
    this.length += 1;
  }

  u16(v: number): void {
    this.reserve(2);
    this.view.setUint16(this.length, v, true);
    this.length += 2;
  }

  i16(v: number): void {
    this.reserve(2);
    this.view.setInt16(this.length, v, true);
    this.length += 2;
  }

  u32(v: number): void {
    this.reserve(4);
    this.view.setUint32(this.length, v, true);
    this.length += 4;
  }

  bytes(b: Uint8Array): void {
    this.reserve(b.length);
    this.buf.set(b, this.length);
    this.length += b.length;
  }

  done(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}

function intIn(what: string, v: number, min: number, max: number): number {
  if (!Number.isInteger(v) || v < min || v > max) fail(`${what} fora da faixa (${v}; esperado inteiro ${min}..${max})`);
  return v;
}

/** Meio texel → i16; recusa o que não for múltiplo de 0,5. */
function half(what: string, v: number): number {
  return intIn(`${what} (em meios texels)`, v * 2, -32768, 32767);
}

function writeHalfVec(w: Writer, what: string, v: TexelVec3): void {
  w.i16(half(what, v[0]));
  w.i16(half(what, v[1]));
  w.i16(half(what, v[2]));
}

function encodeModel(model: ModelDocument): Uint8Array {
  const strings: string[] = [];
  const index = new Map<string, number>();
  const str = (s: string): number => {
    let i = index.get(s);
    if (i === undefined) {
      i = strings.length;
      strings.push(s);
      index.set(s, i);
    }
    return i;
  };
  // Primeiro coleta todas as strings (a tabela vai no começo).
  str(model.id);
  for (const part of model.parts) {
    str(part.name);
    for (const box of part.boxes) str(box.layer);
    for (const mesh of part.meshes) str(mesh.layer);
  }
  for (const socket of model.sockets) str(socket.name);

  const w = new Writer();
  w.u16(intIn('nº de strings', strings.length, 0, 0xffff));
  for (const s of strings) {
    const b = strToU8(s);
    w.u8(intIn(`tamanho da string "${s}"`, b.length, 0, 255));
    w.bytes(b);
  }
  const kind = MODEL_KINDS.indexOf(model.kind);
  if (kind < 0) fail(`tipo desconhecido: ${String(model.kind)}`);
  w.u16(str(model.id));
  w.u8(kind);
  w.u16(intIn('flags', model.flags, 0, 0xffff));
  const color = intIn('debrisColor', model.debrisColor, 0, 0xffffff);
  w.u8((color >> 16) & 0xff);
  w.u8((color >> 8) & 0xff);
  w.u8(color & 0xff);
  w.u8(model.blocksNav ? 1 : 0);

  w.u8(intIn('nº de peças', model.parts.length, 0, 255));
  for (const part of model.parts) {
    w.u16(str(part.name));
    w.i8(intIn(`mãe da peça "${part.name}"`, part.parent, -1, 127));
    writeHalfVec(w, `pivô da peça "${part.name}"`, part.pivot);
    w.u8(intIn(`nº de caixas da peça "${part.name}"`, part.boxes.length, 0, 255));
    for (const box of part.boxes) {
      writeHalfVec(w, 'origem da caixa', box.origin);
      for (const s of box.size) w.u16(intIn('tamanho da caixa', s, 0, 0xffff));
      w.u8(intIn('u da caixa', box.uv[0], 0, 255));
      w.u8(intIn('v da caixa', box.uv[1], 0, 255));
      w.u16(str(box.layer));
      w.u8(intIn('inflar da caixa (em quartos de texel)', box.inflate * 4, 0, 255));
      w.u8(box.mirror ? 1 : 0);
    }
    w.u8(intIn(`nº de malhas da peça "${part.name}"`, part.meshes.length, 0, 255));
    for (const mesh of part.meshes) {
      const nv = mesh.positions.length / 3;
      if (!Number.isInteger(nv) || mesh.normals.length !== nv * 3 || mesh.uvs.length !== nv * 2) {
        fail(`malha da peça "${part.name}" com arrays de tamanhos incoerentes`);
      }
      w.u16(str(mesh.layer));
      w.u16(intIn('nº de vértices', nv, 0, 0xffff));
      w.u32(mesh.indices.length);
      for (const p of mesh.positions) w.i16(p);
      for (const n of mesh.normals) w.i8(n);
      for (const t of mesh.uvs) w.u8(t);
      for (const i of mesh.indices) w.u16(i);
    }
  }

  w.u8(intIn('nº de soquetes', model.sockets.length, 0, 255));
  for (const socket of model.sockets) {
    w.u16(str(socket.name));
    w.u8(intIn(`peça do soquete "${socket.name}"`, socket.part, 0, 255));
    writeHalfVec(w, `posição do soquete "${socket.name}"`, socket.position);
    const [dx, dy, dz] = socket.direction;
    const len = Math.hypot(dx, dy, dz);
    if (!(len > 0)) fail(`soquete "${socket.name}" sem direção`);
    w.i16(Math.round((dx / len) * DIR_SCALE));
    w.i16(Math.round((dy / len) * DIR_SCALE));
    w.i16(Math.round((dz / len) * DIR_SCALE));
  }

  w.u16(intIn('nº de colisores', model.colliders.length, 0, 0xffff));
  for (const c of model.colliders) {
    writeHalfVec(w, 'mínimo do colisor', c.min);
    writeHalfVec(w, 'máximo do colisor', c.max);
  }

  if (model.light === null) {
    w.u8(0);
  } else {
    w.u8(1);
    writeHalfVec(w, 'posição da luz', model.light.position);
    w.u8(intIn('nível da luz', model.light.level, 0, 255));
  }
  return w.done();
}

/** Grava um pacote `.bfmodel` (deflate cru, nível 9). Lança se algum valor não couber na quantização. */
export function encodeModelPack(pack: ModelPack): Uint8Array {
  const w = new Writer();
  w.u32(BFMODEL_MAGIC);
  w.u16(BFMODEL_VERSION);
  w.u16(intIn('nº de modelos', pack.models.length, 0, 0xffff));
  for (const model of pack.models) {
    const body = encodeModel(model);
    w.u32(body.length);
    w.bytes(body);
  }
  return deflateSync(w.done(), { level: 9 });
}

// ---------------------------------------------------------------------------------------------------------------
// Leitura

class Reader {
  private readonly view: DataView;
  private readonly bytes: Uint8Array;
  pos: number;
  readonly end: number;

  constructor(bytes: Uint8Array, start: number, end: number) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.pos = start;
    this.end = end;
  }

  private need(n: number): number {
    const at = this.pos;
    if (at + n > this.end) fail('arquivo truncado');
    this.pos += n;
    return at;
  }

  u8(): number {
    return this.view.getUint8(this.need(1));
  }

  i8(): number {
    return this.view.getInt8(this.need(1));
  }

  u16(): number {
    return this.view.getUint16(this.need(2), true);
  }

  i16(): number {
    return this.view.getInt16(this.need(2), true);
  }

  u32(): number {
    return this.view.getUint32(this.need(4), true);
  }

  slice(n: number): Uint8Array {
    const at = this.need(n);
    return this.bytes.subarray(at, at + n);
  }
}

function readHalfVec(r: Reader): TexelVec3 {
  return [r.i16() / 2, r.i16() / 2, r.i16() / 2];
}

function decodeModel(r: Reader): ModelDocument {
  const nStrings = r.u16();
  const strings: string[] = [];
  for (let i = 0; i < nStrings; i++) strings.push(strFromU8(r.slice(r.u8())));
  const str = (): string => {
    const i = r.u16();
    const s = strings[i];
    if (s === undefined) fail(`índice de string fora da tabela (${i})`);
    return s;
  };

  const id = str();
  const kind = MODEL_KINDS[r.u8()];
  if (kind === undefined) fail(`modelo "${id}" com tipo desconhecido`);
  const flags = r.u16();
  const debrisColor = (r.u8() << 16) | (r.u8() << 8) | r.u8();
  const blocksNav = r.u8() !== 0;

  const parts: ModelPart[] = [];
  const nParts = r.u8();
  for (let p = 0; p < nParts; p++) {
    const name = str();
    const parent = r.i8();
    const pivot = readHalfVec(r);
    const boxes: ModelBox[] = [];
    const nBoxes = r.u8();
    for (let b = 0; b < nBoxes; b++) {
      const origin = readHalfVec(r);
      const size: TexelVec3 = [r.u16(), r.u16(), r.u16()];
      const uv: readonly [number, number] = [r.u8(), r.u8()];
      const layer = str();
      const inflate = r.u8() / 4;
      const mirror = r.u8() !== 0;
      boxes.push({ origin, size, uv, layer, inflate, mirror });
    }
    const meshes: ModelMesh[] = [];
    const nMeshes = r.u8();
    for (let m = 0; m < nMeshes; m++) {
      const layer = str();
      const nv = r.u16();
      const ni = r.u32();
      if (ni % 3 !== 0) fail(`malha de "${id}" com ${ni} índices (não é múltiplo de 3)`);
      // Confere o tamanho antes de alocar (arquivo malformado não pede gigabytes).
      if (r.pos + nv * 11 + ni * 2 > r.end) fail('arquivo truncado');
      const positions = new Int16Array(nv * 3);
      for (let i = 0; i < positions.length; i++) positions[i] = r.i16();
      const normals = new Int8Array(nv * 3);
      for (let i = 0; i < normals.length; i++) normals[i] = r.i8();
      const uvs = new Uint8Array(nv * 2);
      for (let i = 0; i < uvs.length; i++) uvs[i] = r.u8();
      const indices = new Uint16Array(ni);
      for (let i = 0; i < ni; i++) {
        const v = r.u16();
        if (v >= nv) fail(`malha de "${id}" com índice ${v} além dos ${nv} vértices`);
        indices[i] = v;
      }
      meshes.push({ positions, normals, uvs, indices, layer });
    }
    parts.push({ name, parent, pivot, boxes, meshes });
  }

  const sockets: ModelSocket[] = [];
  const nSockets = r.u8();
  for (let s = 0; s < nSockets; s++) {
    const name = str();
    const part = r.u8();
    const position = readHalfVec(r);
    const dx = r.i16();
    const dy = r.i16();
    const dz = r.i16();
    const len = Math.hypot(dx, dy, dz) || 1;
    sockets.push({ name, part, position, direction: [dx / len, dy / len, dz / len] });
  }

  const colliders: ModelCollider[] = [];
  const nColliders = r.u16();
  for (let c = 0; c < nColliders; c++) colliders.push({ min: readHalfVec(r), max: readHalfVec(r) });

  let light: ModelLight | null = null;
  if (r.u8() !== 0) light = { position: readHalfVec(r), level: r.u8() };

  return { format: MODEL_FORMAT, id, kind, flags, parts, sockets, colliders, light, debrisColor, blocksNav };
}

/**
 * Lê um pacote `.bfmodel`. Recusa o provisório da etapa de contratos (versão 0) com "rode npm run modelgen" e versão
 * maior que a conhecida. Não valida as regras de conteúdo (isso é o `validateModel`), só a estrutura.
 */
export function decodeModelPack(bytes: Uint8Array): ModelPack {
  let raw: Uint8Array;
  try {
    raw = inflateSync(bytes);
  } catch (e) {
    fail(`deflate inválido (${e instanceof Error ? e.message : String(e)})`);
  }
  if (raw.length > BFMODEL_MAX_BYTES) fail(`pacote grande demais (${raw.length} bytes)`);
  const r = new Reader(raw, 0, raw.length);
  if (r.u32() !== BFMODEL_MAGIC) fail('não é um .bfmodel (magia errada)');
  const version = r.u16();
  if (version === BFMODEL_PLACEHOLDER_VERSION) fail('arquivo provisório da etapa de contratos: rode npm run modelgen');
  if (version > BFMODEL_VERSION) fail(`versão ${version} mais nova que a suportada (${BFMODEL_VERSION})`);
  const count = r.u16();
  const models: ModelDocument[] = [];
  for (let i = 0; i < count; i++) {
    const size = r.u32();
    const start = r.pos;
    if (start + size > raw.length) fail('arquivo truncado');
    const sub = new Reader(raw, start, start + size);
    models.push(decodeModel(sub));
    if (sub.pos !== start + size) fail(`modelo ${i} com ${start + size - sub.pos} byte(s) sobrando`);
    r.pos = start + size;
  }
  return { models };
}
