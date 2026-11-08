import { deflateSync, Inflate, strFromU8, strToU8 } from 'fflate';
import { PLATFORM_PROFILE_IDS, type PlatformProfileId } from '../platform-profiles.ts';
import { ByteReader, ByteWriter, tagToU32, u32ToTag } from './bytes.ts';
import {
  BFMAP_MAGIC,
  BFMAP_PLACEHOLDER_VERSION,
  BFMAP_VERSION,
  MAP_FORMAT,
  TIMES_OF_DAY,
  type MapCamera,
  type MapCameraRoute,
  type MapChunk,
  type MapDocument,
  type MapGrid,
  type MapLight,
  type MapLightEmitter,
  type MapMannequin,
  type MapMarkers,
  type MapMeta,
  type MapPointMarker,
  type MapProp,
  type MapRoutePoint,
  type MapSpawnMarker,
  type PropDose,
  type TimeOfDay,
} from './types.ts';

/**
 * Codificador e decodificador do `.bfmap` (`map@1`). Layout no `index.ts` (contrato). Frente "mapa-nav".
 *
 * Determinismo: o mesmo documento dá sempre os mesmos bytes (chunks em ordem y, z, x; tabela de modelos na ordem em
 * que aparecem; JSON montado com as chaves numa ordem fixa, só com os campos do contrato).
 */

// --- Tetos (espelho dos do world, que o format não importa; o teste do mapc confere que batem) ---

/** Lado do chunk de dados (células) e células por chunk. */
export const MAP_CHUNK_SIZE = 32;
export const MAP_CHUNK_VOLUME = MAP_CHUNK_SIZE * MAP_CHUNK_SIZE * MAP_CHUNK_SIZE;
/** Teto da grade em células (`MAX_GRID_SIZE_XZ`/`MAX_GRID_SIZE_Y` do world). */
export const MAP_MAX_GRID_XZ = 2048;
export const MAP_MAX_GRID_Y = 256;
/** A célula guarda o índice do bloco em 10 bits: a tabela tem no máximo 1.024 entradas (com o `air`). */
export const MAP_MAX_BLOCK_TYPES = 1024;
/** Bits da célula: 0–9 bloco, 10–12 orientação, 13–15 reservados (precisam ser 0). */
export const MAP_CELL_BLOCK_MASK = 0x3ff;
export const MAP_CELL_RESERVED_MASK = 0xe000;
/**
 * Teto de chunks NÃO uniformes (cada um vira um `Uint16Array` de 64 KB no loading): 1.024 = 64 MB. O maior mapa
 * previsto (Royale Mini, 400×64×400) tem 338 chunks no total. Protege contra um arquivo pequeno que peça gigabytes.
 */
export const MAP_MAX_DENSE_CHUNKS = 1024;
/** Teto do conteúdo descompactado (um "zip bomb" para no inflate, antes de alocar o resto). */
export const MAP_MAX_INFLATED_BYTES = 64 * 1024 * 1024;
/** Teto de props por mapa (instâncias). */
export const MAP_MAX_PROPS = 65535;

/** Etiquetas das seções, na ordem em que o codificador grava. */
export const BFMAP_SECTIONS = ['META', 'BLKS', 'GRID', 'PROP', 'MARK', 'LITE'] as const;
export type BfmapSection = (typeof BFMAP_SECTIONS)[number];
/** Reservada (navegação pré-calculada, M2+): o decodificador do M1 pula. */
export const BFMAP_NAV_SECTION = 'NAV ';

// --- Codificação ---

function writeSection(w: ByteWriter, tag: BfmapSection, body: (w: ByteWriter) => void): void {
  w.u32(tagToU32(tag));
  const sizeAt = w.length;
  w.u32(0);
  const start = w.length;
  body(w);
  w.patchU32(sizeAt, w.length - start);
}

function writeJson(w: ByteWriter, value: unknown): void {
  w.bytes(strToU8(JSON.stringify(value)));
}

function writeString(w: ByteWriter, s: string): void {
  const bytes = strToU8(s);
  w.varUint(bytes.length);
  w.bytes(bytes);
}

function normalizeMeta(id: string, meta: MapMeta): unknown {
  const botCaps: Record<string, number> = {};
  for (const p of PLATFORM_PROFILE_IDS) {
    const cap = meta.botCaps[p];
    if (cap !== undefined) botCaps[p] = cap;
  }
  return {
    id,
    meta: {
      nameKey: meta.nameKey,
      modes: [...meta.modes],
      players: { min: meta.players.min, ideal: meta.players.ideal, max: meta.players.max },
      maxSightLineM: meta.maxSightLineM,
      botCaps,
    },
  };
}

function normalizeMarkers(m: MapMarkers): MapMarkers {
  return {
    spawns: m.spawns.map((s) => ({ x: s.x, y: s.y, z: s.z, yaw: s.yaw, team: s.team })),
    domination: m.domination.map((d) => ({ id: d.id, x: d.x, y: d.y, z: d.z, radius: d.radius })),
    cameras: m.cameras.map((c) => ({
      name: c.name,
      x: c.x,
      y: c.y,
      z: c.z,
      yaw: c.yaw,
      pitch: c.pitch,
      fovYDeg: c.fovYDeg,
    })),
    routes: m.routes.map((r) => ({
      name: r.name,
      loop: r.loop,
      points: r.points.map((p) => ({ t: p.t, x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch })),
    })),
    mannequins: m.mannequins.map((q) => ({
      name: q.name,
      x: q.x,
      y: q.y,
      z: q.z,
      yaw: q.yaw,
      look: q.look,
      team: q.team,
      zombie: q.zombie,
      pose: q.pose,
      weapon: q.weapon,
    })),
    playArea: {
      minX: m.playArea.minX,
      minZ: m.playArea.minZ,
      maxX: m.playArea.maxX,
      maxZ: m.playArea.maxZ,
      killPlaneY: m.playArea.killPlaneY,
    },
  };
}

function normalizeLight(l: MapLight): MapLight {
  return {
    sunDir: [l.sunDir[0], l.sunDir[1], l.sunDir[2]],
    timeOfDay: l.timeOfDay,
    emitters: l.emitters.map((e) => ({ x: e.x, y: e.y, z: e.z, level: e.level })),
  };
}

/** Chunk só de ar (não vai para o arquivo). */
function chunkIsAir(c: MapChunk): boolean {
  if (c.cells === null) return c.uniform === 0;
  for (let i = 0; i < MAP_CHUNK_VOLUME; i++) if (c.cells[i] !== 0) return false;
  return true;
}

function writeGrid(w: ByteWriter, grid: MapGrid): void {
  const check = (v: number, max: number, what: string): void => {
    if (!Number.isInteger(v) || v < 1 || v > max) throw new RangeError(`encodeMap: ${what} ${v} fora de 1..${max}`);
  };
  check(grid.sizeX, MAP_MAX_GRID_XZ, 'sizeX');
  check(grid.sizeY, MAP_MAX_GRID_Y, 'sizeY');
  check(grid.sizeZ, MAP_MAX_GRID_XZ, 'sizeZ');
  w.u16(grid.sizeX);
  w.u16(grid.sizeY);
  w.u16(grid.sizeZ);
  const chunks = grid.chunks.filter((c) => !chunkIsAir(c));
  chunks.sort((a, b) => a.cy - b.cy || a.cz - b.cz || a.cx - b.cx);
  w.varUint(chunks.length);
  for (const c of chunks) {
    if (c.cells !== null && c.cells.length !== MAP_CHUNK_VOLUME) {
      throw new RangeError(`encodeMap: chunk ${c.cx},${c.cy},${c.cz} com ${c.cells.length} células`);
    }
    w.u16(c.cx);
    w.u16(c.cy);
    w.u16(c.cz);
    const cells = c.cells;
    if (cells === null) {
      w.varUint(1);
      w.u16(c.uniform);
      w.varUint(MAP_CHUNK_VOLUME);
      continue;
    }
    let runs = 0;
    for (let i = 0; i < MAP_CHUNK_VOLUME;) {
      const v = cells[i]!;
      let j = i + 1;
      while (j < MAP_CHUNK_VOLUME && cells[j] === v) j++;
      runs++;
      i = j;
    }
    w.varUint(runs);
    for (let i = 0; i < MAP_CHUNK_VOLUME;) {
      const v = cells[i]!;
      let j = i + 1;
      while (j < MAP_CHUNK_VOLUME && cells[j] === v) j++;
      w.u16(v);
      w.varUint(j - i);
      i = j;
    }
  }
}

function writeProps(w: ByteWriter, props: readonly MapProp[]): void {
  if (props.length > MAP_MAX_PROPS) throw new RangeError(`encodeMap: ${props.length} props (teto ${MAP_MAX_PROPS})`);
  const models: string[] = [];
  const index = new Map<string, number>();
  for (const p of props) {
    if (!index.has(p.model)) {
      index.set(p.model, models.length);
      models.push(p.model);
    }
  }
  w.varUint(models.length);
  for (const m of models) writeString(w, m);
  w.varUint(props.length);
  for (const p of props) {
    for (const v of [p.x, p.y, p.z]) {
      if (!Number.isInteger(v)) throw new RangeError(`encodeMap: prop "${p.model}" fora dos texels inteiros`);
    }
    if (!Number.isInteger(p.yaw) || p.yaw < 0 || p.yaw > 255) throw new RangeError('encodeMap: yaw de prop');
    if (!Number.isInteger(p.scale) || p.scale < 1 || p.scale > 255) throw new RangeError('encodeMap: escala de prop');
    w.varUint(index.get(p.model)!);
    w.i32(p.x);
    w.i32(p.y);
    w.i32(p.z);
    w.u8(p.yaw);
    w.u8(p.scale);
    w.u8(p.dose);
  }
}

/** Grava o `.bfmap` (deflate nível 9 por cima de tudo). Determinístico. Não valida a semântica (`validateMap`). */
export function encodeMap(doc: MapDocument): Uint8Array {
  if (doc.format !== MAP_FORMAT) throw new Error(`encodeMap: format precisa ser "${MAP_FORMAT}"`);
  const w = new ByteWriter();
  w.u32(BFMAP_MAGIC);
  w.u16(BFMAP_VERSION);
  w.u16(BFMAP_SECTIONS.length);
  writeSection(w, 'META', (s) => writeJson(s, normalizeMeta(doc.id, doc.meta)));
  writeSection(w, 'BLKS', (s) => writeJson(s, [...doc.blocks]));
  writeSection(w, 'GRID', (s) => writeGrid(s, doc.grid));
  writeSection(w, 'PROP', (s) => writeProps(s, doc.props));
  writeSection(w, 'MARK', (s) => writeJson(s, normalizeMarkers(doc.markers)));
  writeSection(w, 'LITE', (s) => writeJson(s, normalizeLight(doc.light)));
  return deflateSync(w.result(), { level: 9 });
}

// --- Decodificação ---

function fail(message: string): never {
  throw new Error(`map: ${message}`);
}

/** Inflate em fatias com teto de saída: passou do teto, erro antes de alocar o resto. */
function inflateBounded(bytes: Uint8Array, limit: number): Uint8Array {
  const parts: Uint8Array[] = [];
  let total = 0;
  const inflater = new Inflate((chunk) => {
    total += chunk.length;
    if (total > limit) throw new RangeError('map: dados descompactados passam do teto');
    parts.push(chunk);
  });
  const STEP = 4096;
  if (bytes.length === 0) fail('arquivo vazio');
  try {
    for (let i = 0; i < bytes.length; i += STEP) inflater.push(bytes.subarray(i, i + STEP), i + STEP >= bytes.length);
  } catch (e) {
    if (e instanceof RangeError) throw e;
    fail('dados comprimidos inválidos (não é um .bfmap)');
  }
  if (parts.length === 1) return parts[0]!;
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

type Json = unknown;

function isObject(v: Json): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseJson(bytes: Uint8Array, what: string): Json {
  try {
    return JSON.parse(strFromU8(bytes)) as Json;
  } catch {
    return fail(`seção ${what} com JSON inválido`);
  }
}

function obj(v: Json, path: string): Record<string, unknown> {
  if (!isObject(v)) fail(`${path} não é um objeto`);
  return v;
}

function arr(v: Json, path: string): readonly unknown[] {
  if (!Array.isArray(v)) fail(`${path} não é uma lista`);
  return v;
}

function num(v: Json, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(`${path} não é um número finito`);
  return v;
}

function int(v: Json, path: string): number {
  const n = num(v, path);
  if (!Number.isInteger(n)) fail(`${path} não é inteiro`);
  return n;
}

function str(v: Json, path: string): string {
  if (typeof v !== 'string') fail(`${path} não é texto`);
  return v;
}

function bool(v: Json, path: string): boolean {
  if (typeof v !== 'boolean') fail(`${path} não é booleano`);
  return v;
}

function parseMeta(json: Json): { id: string; meta: MapMeta } {
  const root = obj(json, 'META');
  const m = obj(root['meta'], 'meta');
  const players = obj(m['players'], 'meta.players');
  const capsRaw = m['botCaps'] === undefined ? {} : obj(m['botCaps'], 'meta.botCaps');
  const botCaps: Partial<Record<PlatformProfileId, number>> = {};
  for (const p of PLATFORM_PROFILE_IDS) {
    const v = capsRaw[p];
    if (v !== undefined) botCaps[p] = int(v, `meta.botCaps.${p}`);
  }
  return {
    id: str(root['id'], 'id'),
    meta: {
      nameKey: str(m['nameKey'], 'meta.nameKey'),
      modes: arr(m['modes'], 'meta.modes').map((x, i) => str(x, `meta.modes[${i}]`)),
      players: {
        min: int(players['min'], 'meta.players.min'),
        ideal: int(players['ideal'], 'meta.players.ideal'),
        max: int(players['max'], 'meta.players.max'),
      },
      maxSightLineM: num(m['maxSightLineM'], 'meta.maxSightLineM'),
      botCaps,
    },
  };
}

function parseBlocks(json: Json): string[] {
  const list = arr(json, 'BLKS').map((x, i) => str(x, `blocks[${i}]`));
  if (list.length < 1 || list[0] !== 'air') fail('tabela de blocos precisa começar por "air"');
  if (list.length > MAP_MAX_BLOCK_TYPES)
    fail(`tabela de blocos com ${list.length} entradas (teto ${MAP_MAX_BLOCK_TYPES})`);
  return list;
}

function checkCell(cell: number, blockCount: number, where: string): void {
  if ((cell & MAP_CELL_RESERVED_MASK) !== 0) fail(`célula com bit reservado em ${where}`);
  if ((cell & MAP_CELL_BLOCK_MASK) >= blockCount)
    fail(`célula com bloco ${cell & MAP_CELL_BLOCK_MASK} além da tabela em ${where}`);
}

function parseGrid(bytes: Uint8Array, blockCount: number): MapGrid {
  const r = new ByteReader(bytes, 'map GRID');
  const sizeX = r.u16();
  const sizeY = r.u16();
  const sizeZ = r.u16();
  if (
    sizeX < 1 ||
    sizeZ < 1 ||
    sizeY < 1 ||
    sizeX > MAP_MAX_GRID_XZ ||
    sizeZ > MAP_MAX_GRID_XZ ||
    sizeY > MAP_MAX_GRID_Y
  ) {
    fail(
      `grade ${sizeX}×${sizeY}×${sizeZ} fora do teto do motor (${MAP_MAX_GRID_XZ}×${MAP_MAX_GRID_Y}×${MAP_MAX_GRID_XZ})`,
    );
  }
  const chunksX = Math.ceil(sizeX / MAP_CHUNK_SIZE);
  const chunksY = Math.ceil(sizeY / MAP_CHUNK_SIZE);
  const chunksZ = Math.ceil(sizeZ / MAP_CHUNK_SIZE);
  const slots = chunksX * chunksY * chunksZ;
  const count = r.varUint();
  if (count > slots) fail(`${count} chunks não cabem numa grade de ${slots}`);
  const seen = new Uint8Array(slots);
  const chunks: MapChunk[] = [];
  let dense = 0;
  for (let c = 0; c < count; c++) {
    const cx = r.u16();
    const cy = r.u16();
    const cz = r.u16();
    if (cx >= chunksX || cy >= chunksY || cz >= chunksZ) fail(`chunk ${cx},${cy},${cz} fora da grade`);
    const slot = cx + cz * chunksX + cy * chunksX * chunksZ;
    if (seen[slot] === 1) fail(`chunk ${cx},${cy},${cz} repetido`);
    seen[slot] = 1;
    const where = `chunk ${cx},${cy},${cz}`;
    const runs = r.varUint();
    if (runs < 1 || runs > MAP_CHUNK_VOLUME) fail(`${where} com ${runs} corridas`);
    if (runs === 1) {
      const v = r.u16();
      const len = r.varUint();
      if (len !== MAP_CHUNK_VOLUME) fail(`${where} incompleto`);
      checkCell(v, blockCount, where);
      if (v !== 0) chunks.push({ cx, cy, cz, uniform: v, cells: null });
      continue;
    }
    if (++dense > MAP_MAX_DENSE_CHUNKS) fail(`mais de ${MAP_MAX_DENSE_CHUNKS} chunks não uniformes`);
    const cells = new Uint16Array(MAP_CHUNK_VOLUME);
    let at = 0;
    let solid = false;
    for (let k = 0; k < runs; k++) {
      const v = r.u16();
      const len = r.varUint();
      if (len < 1 || at + len > MAP_CHUNK_VOLUME) fail(`corrida passa do ${where}`);
      checkCell(v, blockCount, where);
      if (v !== 0) solid = true;
      cells.fill(v, at, at + len);
      at += len;
    }
    if (at !== MAP_CHUNK_VOLUME) fail(`${where} incompleto`);
    if (solid) chunks.push({ cx, cy, cz, uniform: 0, cells });
  }
  if (!r.done) fail('bytes sobrando na seção GRID');
  return { sizeX, sizeY, sizeZ, chunks };
}

function parseProps(bytes: Uint8Array): MapProp[] {
  const r = new ByteReader(bytes, 'map PROP');
  const modelCount = r.varUint();
  if (modelCount > MAP_MAX_PROPS) fail(`${modelCount} modelos na seção PROP`);
  const models: string[] = [];
  for (let i = 0; i < modelCount; i++) {
    const len = r.varUint();
    if (len > 256) fail('ID de modelo longo demais');
    models.push(strFromU8(r.take(len)));
  }
  const count = r.varUint();
  if (count > MAP_MAX_PROPS) fail(`${count} props (teto ${MAP_MAX_PROPS})`);
  const props: MapProp[] = [];
  for (let i = 0; i < count; i++) {
    const m = r.varUint();
    const model = models[m];
    if (model === undefined) fail(`prop ${i} com modelo ${m} além da tabela`);
    const x = r.i32();
    const y = r.i32();
    const z = r.i32();
    const yaw = r.u8();
    const scale = r.u8();
    const dose = r.u8();
    if (scale < 1) fail(`prop ${i} com escala 0`);
    if (dose > 2) fail(`prop ${i} com dose ${dose}`);
    props.push({ model, x, y, z, yaw, scale, dose: dose as PropDose });
  }
  if (!r.done) fail('bytes sobrando na seção PROP');
  return props;
}

function parseMarkers(json: Json): MapMarkers {
  const m = obj(json, 'MARK');
  const spawns = arr(m['spawns'], 'spawns').map((v, i): MapSpawnMarker => {
    const s = obj(v, `spawns[${i}]`);
    const p = `spawns[${i}]`;
    return { x: num(s['x'], p), y: num(s['y'], p), z: num(s['z'], p), yaw: num(s['yaw'], p), team: int(s['team'], p) };
  });
  const domination = arr(m['domination'], 'domination').map((v, i): MapPointMarker => {
    const d = obj(v, `domination[${i}]`);
    const p = `domination[${i}]`;
    return {
      id: str(d['id'], p),
      x: num(d['x'], p),
      y: num(d['y'], p),
      z: num(d['z'], p),
      radius: num(d['radius'], p),
    };
  });
  const cameras = arr(m['cameras'], 'cameras').map((v, i): MapCamera => {
    const c = obj(v, `cameras[${i}]`);
    const p = `cameras[${i}]`;
    return {
      name: str(c['name'], p),
      x: num(c['x'], p),
      y: num(c['y'], p),
      z: num(c['z'], p),
      yaw: num(c['yaw'], p),
      pitch: num(c['pitch'], p),
      fovYDeg: num(c['fovYDeg'], p),
    };
  });
  const routes = arr(m['routes'], 'routes').map((v, i): MapCameraRoute => {
    const r = obj(v, `routes[${i}]`);
    const p = `routes[${i}]`;
    return {
      name: str(r['name'], p),
      loop: bool(r['loop'], p),
      points: arr(r['points'], `${p}.points`).map((pv, k): MapRoutePoint => {
        const q = obj(pv, `${p}.points[${k}]`);
        const pp = `${p}.points[${k}]`;
        return {
          t: num(q['t'], pp),
          x: num(q['x'], pp),
          y: num(q['y'], pp),
          z: num(q['z'], pp),
          yaw: num(q['yaw'], pp),
          pitch: num(q['pitch'], pp),
        };
      }),
    };
  });
  const mannequins = arr(m['mannequins'], 'mannequins').map((v, i): MapMannequin => {
    const q = obj(v, `mannequins[${i}]`);
    const p = `mannequins[${i}]`;
    const pose = str(q['pose'], p);
    if (pose !== 'stand' && pose !== 'crouch' && pose !== 'aim' && pose !== 'slide')
      fail(`${p}.pose desconhecida: ${pose}`);
    return {
      name: str(q['name'], p),
      x: num(q['x'], p),
      y: num(q['y'], p),
      z: num(q['z'], p),
      yaw: num(q['yaw'], p),
      look: str(q['look'], p),
      team: int(q['team'], p),
      zombie: bool(q['zombie'], p),
      pose,
      weapon: str(q['weapon'], p),
    };
  });
  const a = obj(m['playArea'], 'playArea');
  return {
    spawns,
    domination,
    cameras,
    routes,
    mannequins,
    playArea: {
      minX: num(a['minX'], 'playArea.minX'),
      minZ: num(a['minZ'], 'playArea.minZ'),
      maxX: num(a['maxX'], 'playArea.maxX'),
      maxZ: num(a['maxZ'], 'playArea.maxZ'),
      killPlaneY: num(a['killPlaneY'], 'playArea.killPlaneY'),
    },
  };
}

function parseLight(json: Json): MapLight {
  const l = obj(json, 'LITE');
  const dir = arr(l['sunDir'], 'sunDir');
  if (dir.length !== 3) fail('sunDir precisa de 3 números');
  const tod = str(l['timeOfDay'], 'timeOfDay');
  if (!(TIMES_OF_DAY as readonly string[]).includes(tod)) fail(`timeOfDay desconhecido: ${tod}`);
  const emitters = arr(l['emitters'], 'emitters').map((v, i): MapLightEmitter => {
    const e = obj(v, `emitters[${i}]`);
    const p = `emitters[${i}]`;
    return { x: int(e['x'], p), y: int(e['y'], p), z: int(e['z'], p), level: int(e['level'], p) };
  });
  return {
    sunDir: [num(dir[0], 'sunDir[0]'), num(dir[1], 'sunDir[1]'), num(dir[2], 'sunDir[2]')],
    timeOfDay: tod as TimeOfDay,
    emitters,
  };
}

/**
 * Lê um `.bfmap`. Recusa (com mensagem em pt-BR): arquivo provisório (versão 0), versão maior, magia errada, seção
 * obrigatória ausente ou repetida, grade fora do teto, célula com bit reservado ou bloco além da tabela, dados
 * truncados ou sobrando. Seção desconhecida é pulada. A semântica (IDs, spawns, câmeras) fica no `validateMap`.
 */
export function decodeMap(bytes: Uint8Array): MapDocument {
  const r = new ByteReader(inflateBounded(bytes, MAP_MAX_INFLATED_BYTES), 'map');
  if (r.u32() !== BFMAP_MAGIC) fail('assinatura inválida (não é um .bfmap)');
  const version = r.u16();
  if (version === BFMAP_PLACEHOLDER_VERSION) fail('arquivo provisório da etapa de contratos: rode "npm run mapc"');
  if (version > BFMAP_VERSION) fail(`versão ${version} mais nova que a suportada (${BFMAP_VERSION}): atualize o jogo`);
  const sectionCount = r.u16();
  const sections = new Map<string, Uint8Array>();
  for (let i = 0; i < sectionCount; i++) {
    const tag = u32ToTag(r.u32());
    const size = r.u32();
    const body = r.take(size);
    if (!(BFMAP_SECTIONS as readonly string[]).includes(tag)) continue;
    if (sections.has(tag)) fail(`seção ${tag} repetida`);
    sections.set(tag, body);
  }
  if (!r.done) fail('bytes sobrando depois das seções');
  const get = (tag: BfmapSection): Uint8Array => sections.get(tag) ?? fail(`seção ${tag} ausente`);
  const { id, meta } = parseMeta(parseJson(get('META'), 'META'));
  const blocks = parseBlocks(parseJson(get('BLKS'), 'BLKS'));
  const grid = parseGrid(get('GRID'), blocks.length);
  const props = parseProps(get('PROP'));
  const markers = parseMarkers(parseJson(get('MARK'), 'MARK'));
  const light = parseLight(parseJson(get('LITE'), 'LITE'));
  return { format: MAP_FORMAT, id, meta, blocks, grid, props, markers, light };
}
