import { contentIdsOfKind, isKnownContentId, isValidContentLocal } from '../content-ids.ts';
import { ENGINE_MAX_BOTS, PLATFORM_PROFILE_IDS } from '../platform-profiles.ts';
import {
  MAP_CELL_BLOCK_MASK,
  MAP_CELL_RESERVED_MASK,
  MAP_CHUNK_SIZE,
  MAP_CHUNK_VOLUME,
  MAP_MAX_BLOCK_TYPES,
  MAP_MAX_GRID_XZ,
  MAP_MAX_GRID_Y,
  MAP_MAX_PROPS,
} from './codec.ts';
import {
  MAP_FORMAT,
  MAP_TEXELS_PER_METER,
  OPTIONAL_MANNEQUINS,
  OPTIONAL_PRINT_CAMERAS,
  PRINT_CAMERAS,
  REQUIRED_BENCH_ROUTES,
  REQUIRED_MANNEQUINS,
  TIMES_OF_DAY,
  type MapDocument,
  type MapMannequin,
} from './types.ts';

/** Opções do `validateMap` (o tipo público fica no `index.ts`, contrato). */
export interface MapValidationOptionsImpl {
  readonly knownBlocks?: ReadonlySet<string>;
  readonly knownModels?: ReadonlySet<string>;
  readonly requirePrintMarkers?: boolean;
}

/** Mínimos de spawn por modo (GDD §4.6.3): TDM ≥ 6 por time (times 0 e 1), FFA ≥ 16 (time -1). */
export const MIN_TDM_SPAWNS_PER_TEAM = 6;
export const MIN_FFA_SPAWNS = 16;
/** Domination precisa de pelo menos 3 pontos (A, B, C). */
export const MIN_DOMINATION_POINTS = 3;
/** Maior linha de visão que um mapa pode declarar (teto do PC; Switch 3–4P pede ≤ 50 m, mas isso é do mapa). */
export const MAX_DECLARED_SIGHT_LINE_M = 140;
/** Teto de um nome de câmera, rota ou manequim. */
const MAX_MARKER_NAME = 64;
/**
 * Poses de manequim que o formato conhece (`MapMannequin.pose`; o decodificador do `.bfmap` recusa outra). `slide` (o
 * deslize "carrinho" do boneco do FutBobo) entrou sem subir o `map@1`: a pose vai como texto no JSON da seção MARK.
 */
export const MANNEQUIN_POSES: readonly MapMannequin['pose'][] = ['stand', 'crouch', 'aim', 'slide'];

/** Por que um manequim de print tem pose fixa (vai na mensagem). */
const RULER = 'régua de métricas';
const LINEUP = 'fila e close do boneco';
/**
 * Pose fixa dos manequins de print com nome: a régua de métricas (`print:altura`, decisão #53, e o deslize do PLANO do
 * porte §B16) compara em pé × agachado × deslizando; a fila e o close (§B16) são em pé (o giro e a expressão são do
 * jogo).
 */
const FIXED_MANNEQUIN_POSE: Readonly<Record<string, readonly [MapMannequin['pose'], string]>> = {
  'altura:em-pe': ['stand', RULER],
  'altura:agachado': ['crouch', RULER],
  'altura:deslizando': ['slide', RULER],
  ...Object.fromEntries(
    OPTIONAL_MANNEQUINS.filter((n) => !n.startsWith('altura:')).map((n) => [n, ['stand', LINEUP] as const]),
  ),
};

/**
 * Prefixos de grupo dos marcadores de print: o `game` escolhe o grupo pelo prefixo (`MANNEQUIN_KIND`), então um nome
 * com eles que não esteja no contrato (`linha:9`, `print:linha-3q`, `print:altura-30`) seria desenhado ou pedido
 * errado. Valem sempre. `print:altura-` (com o hífen) deixa de fora a `print:altura`, que é obrigatória.
 */
const RESERVED_MANNEQUIN_PREFIXES = ['altura:', 'linha:', 'close:'] as const;
const RESERVED_CAMERA_PREFIXES = ['print:linha', 'print:close', 'print:altura-'] as const;
const KNOWN_MANNEQUINS: ReadonlySet<string> = new Set<string>([...REQUIRED_MANNEQUINS, ...OPTIONAL_MANNEQUINS]);
const KNOWN_CAMERAS: ReadonlySet<string> = new Set<string>([...PRINT_CAMERAS, ...OPTIONAL_PRINT_CAMERAS]);

/**
 * Grupos OPCIONAIS dos prints do boneco (§B16): ou o mapa tem o grupo inteiro (manequins e câmeras), ou nenhum pedaço
 * dele. `altura:deslizando` não é grupo: usa a `print:altura`, que já é obrigatória. A `print:altura-45` também não:
 * olha os `altura:*` obrigatórios (sem o deslizando, mostra os dois que há).
 */
const OPTIONAL_GROUPS: readonly { readonly name: string; readonly names: readonly string[] }[] = [
  {
    name: 'fila do boneco',
    names: [
      ...OPTIONAL_MANNEQUINS.filter((n) => n.startsWith('linha:')),
      ...OPTIONAL_PRINT_CAMERAS.filter((n) => n.startsWith('print:linha-')),
    ],
  },
  {
    name: 'close do boneco',
    names: [
      ...OPTIONAL_MANNEQUINS.filter((n) => n.startsWith('close:')),
      ...OPTIONAL_PRINT_CAMERAS.filter((n) => n.startsWith('print:close-')),
    ],
  },
];

const finite = (...values: number[]): boolean => values.every((v) => Number.isFinite(v));

/**
 * Confere o documento (tecnico.md §15.3, parte que não precisa do world nem da navegação). Devolve as mensagens em
 * pt-BR (para log e para o `mapc`; o jogo nunca mostra isto ao jogador); vazio = ok.
 */
export function validateMapImpl(doc: MapDocument, options: MapValidationOptionsImpl = {}): readonly string[] {
  const out: string[] = [];
  const err = (msg: string): void => {
    out.push(msg);
  };
  const knownBlocks = options.knownBlocks ?? new Set(contentIdsOfKind('block'));
  const knownModels = options.knownModels ?? new Set(contentIdsOfKind('model'));

  // Documento e metadados
  if (doc.format !== MAP_FORMAT) err(`format precisa ser "${MAP_FORMAT}"`);
  if (!isValidContentLocal(doc.id)) err(`ID de mapa inválido: "${doc.id}"`);
  const meta = doc.meta;
  if (meta.nameKey.length === 0) err('meta.nameKey vazio');
  if (meta.modes.length === 0) err('meta.modes vazio: o mapa precisa declarar pelo menos um modo');
  const modes = new Set<string>();
  for (const m of meta.modes) {
    if (modes.has(m)) err(`modo repetido: ${m}`);
    modes.add(m);
    if (!isKnownContentId(`mode:${m}`)) err(`modo não registrado: mode:${m}`);
  }
  const { min, ideal, max } = meta.players;
  if (!(Number.isInteger(min) && min >= 1 && min <= ideal && ideal <= max && max <= ENGINE_MAX_BOTS + 4)) {
    err(`meta.players inválido: ${min}/${ideal}/${max} (precisa de 1 ≤ min ≤ ideal ≤ max)`);
  }
  if (!(meta.maxSightLineM > 0 && meta.maxSightLineM <= MAX_DECLARED_SIGHT_LINE_M)) {
    err(`meta.maxSightLineM fora de 0..${MAX_DECLARED_SIGHT_LINE_M} m: ${meta.maxSightLineM}`);
  }
  for (const [p, cap] of Object.entries(meta.botCaps)) {
    if (!(PLATFORM_PROFILE_IDS as readonly string[]).includes(p)) err(`meta.botCaps: perfil desconhecido "${p}"`);
    if (cap === undefined || !Number.isInteger(cap) || cap < 0 || cap > ENGINE_MAX_BOTS) {
      err(`meta.botCaps.${p} fora de 0..${ENGINE_MAX_BOTS}`);
    }
  }

  // Blocos
  const blocks = doc.blocks;
  if (blocks.length === 0 || blocks[0] !== 'air') err('tabela de blocos precisa começar por "air"');
  if (blocks.length > MAP_MAX_BLOCK_TYPES)
    err(`tabela de blocos com ${blocks.length} entradas (teto ${MAP_MAX_BLOCK_TYPES})`);
  const seenBlocks = new Set<string>();
  blocks.forEach((b, i) => {
    if (seenBlocks.has(b)) err(`bloco repetido na tabela: ${b}`);
    seenBlocks.add(b);
    if (i > 0 && !knownBlocks.has(b)) err(`bloco não registrado: block:${b}`);
  });

  // Grade
  const g = doc.grid;
  const sizeOk =
    Number.isInteger(g.sizeX) &&
    Number.isInteger(g.sizeY) &&
    Number.isInteger(g.sizeZ) &&
    g.sizeX >= 1 &&
    g.sizeY >= 1 &&
    g.sizeZ >= 1 &&
    g.sizeX <= MAP_MAX_GRID_XZ &&
    g.sizeZ <= MAP_MAX_GRID_XZ &&
    g.sizeY <= MAP_MAX_GRID_Y;
  if (!sizeOk) err(`grade ${g.sizeX}×${g.sizeY}×${g.sizeZ} fora do teto`);
  const chunksX = Math.ceil(g.sizeX / MAP_CHUNK_SIZE);
  const chunksY = Math.ceil(g.sizeY / MAP_CHUNK_SIZE);
  const chunksZ = Math.ceil(g.sizeZ / MAP_CHUNK_SIZE);
  const seenChunks = new Set<number>();
  const badCells = new Set<string>();
  for (const c of g.chunks) {
    const where = `chunk ${c.cx},${c.cy},${c.cz}`;
    if (c.cx < 0 || c.cy < 0 || c.cz < 0 || c.cx >= chunksX || c.cy >= chunksY || c.cz >= chunksZ) {
      err(`${where} fora da grade`);
      continue;
    }
    const slot = c.cx + c.cz * chunksX + c.cy * chunksX * chunksZ;
    if (seenChunks.has(slot)) err(`${where} repetido`);
    seenChunks.add(slot);
    if (c.cells !== null && c.cells.length !== MAP_CHUNK_VOLUME) err(`${where} com ${c.cells.length} células`);
    const check = (cell: number): void => {
      if ((cell & MAP_CELL_RESERVED_MASK) !== 0) badCells.add(`${where}: célula com bit reservado`);
      else if ((cell & MAP_CELL_BLOCK_MASK) >= blocks.length) badCells.add(`${where}: bloco além da tabela`);
    };
    if (c.cells === null) check(c.uniform);
    else for (let i = 0; i < c.cells.length; i++) check(c.cells[i]!);
  }
  for (const m of badCells) err(m);

  // Props (texels; a grade vai de 0 a size·16 texels)
  if (doc.props.length > MAP_MAX_PROPS) err(`${doc.props.length} props (teto ${MAP_MAX_PROPS})`);
  const texPerCell = MAP_TEXELS_PER_METER / 2;
  const missingModels = new Set<string>();
  doc.props.forEach((p, i) => {
    if (!knownModels.has(p.model)) missingModels.add(p.model);
    const inside =
      [p.x, p.y, p.z].every((v) => Number.isInteger(v)) &&
      p.x >= 0 &&
      p.z >= 0 &&
      p.x <= g.sizeX * texPerCell &&
      p.z <= g.sizeZ * texPerCell &&
      p.y >= -g.sizeY * texPerCell &&
      p.y <= g.sizeY * texPerCell;
    if (!inside) err(`prop ${i} (${p.model}) fora da grade ou fora dos texels inteiros`);
    if (!Number.isInteger(p.yaw) || p.yaw < 0 || p.yaw > 255) err(`prop ${i} com yaw fora de 0..255`);
    if (!Number.isInteger(p.scale) || p.scale < 1 || p.scale > 255) err(`prop ${i} com escala fora de 1..255`);
    if (p.dose !== 0 && p.dose !== 1 && p.dose !== 2) err(`prop ${i} com dose inválida`);
  });
  for (const m of missingModels) err(`modelo não registrado: model:${m}`);

  // Marcadores
  const mk = doc.markers;
  const area = mk.playArea;
  const gridMaxX = g.sizeX / 2;
  const gridMaxZ = g.sizeZ / 2;
  if (!finite(area.minX, area.minZ, area.maxX, area.maxZ, area.killPlaneY)) err('playArea com número não finito');
  if (!(area.minX < area.maxX && area.minZ < area.maxZ)) err('playArea vazia (min ≥ max)');
  if (area.minX < 0 || area.minZ < 0 || area.maxX > gridMaxX || area.maxZ > gridMaxZ) err('playArea fora da grade');
  const inArea = (x: number, z: number): boolean =>
    x >= area.minX && x <= area.maxX && z >= area.minZ && z <= area.maxZ;

  mk.spawns.forEach((s, i) => {
    if (!finite(s.x, s.y, s.z, s.yaw)) err(`spawn ${i} com número não finito`);
    else if (!inArea(s.x, s.z)) err(`spawn ${i} fora da playArea`);
    if (!Number.isInteger(s.team) || s.team < -1 || s.team > 3) err(`spawn ${i} com time fora de -1..3`);
    if (s.y <= area.killPlaneY) err(`spawn ${i} abaixo do plano de morte`);
  });
  if (modes.has('warfare.tdm')) {
    for (const team of [0, 1]) {
      const n = mk.spawns.filter((s) => s.team === team).length;
      if (n < MIN_TDM_SPAWNS_PER_TEAM) err(`TDM: time ${team} com ${n} spawns (mínimo ${MIN_TDM_SPAWNS_PER_TEAM})`);
    }
  }
  if (modes.has('warfare.ffa')) {
    const n = mk.spawns.filter((s) => s.team === -1).length;
    if (n < MIN_FFA_SPAWNS) err(`FFA: ${n} spawns de qualquer time (mínimo ${MIN_FFA_SPAWNS})`);
  }
  // M3 (fase 3d): janelas e portas do Bobo Zombies (os tetos são os da sim: 32 e 16).
  const bars = mk.barricades ?? [];
  const doors = mk.paidDoors ?? [];
  if (bars.length > 32) err(`${bars.length} janelas com barricada (máximo 32)`);
  if (doors.length > 16) err(`${doors.length} portas pagas (máximo 16)`);
  bars.forEach((b, i) => {
    if (!finite(b.x, b.y, b.z, b.width, b.height)) err(`janela ${i} com número não finito`);
    else if (!inArea(b.x, b.z)) err(`janela ${i} fora da playArea`);
    if (![0, 1, 2, 3].includes(b.outside)) err(`janela ${i} com lado de fora fora de 0..3`);
    if (!(b.width >= 0.5 && b.width <= 4) || !(b.height >= 1 && b.height <= 4))
      err(`janela ${i} com vão fora de 0,5..4 m`);
  });
  doors.forEach((d, i) => {
    if (!finite(d.minX, d.minY, d.minZ, d.maxX, d.maxY, d.maxZ)) err(`porta ${i} com número não finito`);
    else if (!(d.minX < d.maxX && d.minY < d.maxY && d.minZ < d.maxZ)) err(`porta ${i} com caixa vazia`);
    else if (!inArea((d.minX + d.maxX) / 2, (d.minZ + d.maxZ) / 2)) err(`porta ${i} fora da playArea`);
    if (!Number.isInteger(d.cost) || d.cost < 0 || d.cost > 100_000) err(`porta ${i} com preço inválido`);
  });
  // M3 (fase 4a): armas na parede (teto da sim: 16).
  const buys = mk.wallBuys ?? [];
  if (buys.length > 16) err(`${buys.length} armas na parede (máximo 16)`);
  buys.forEach((w, i) => {
    if (!finite(w.x, w.y, w.z)) err(`arma na parede ${i} com número não finito`);
    else if (!inArea(w.x, w.z)) err(`arma na parede ${i} fora da playArea`);
    if (![0, 1, 2, 3].includes(w.facing)) err(`arma na parede ${i} com lado fora de 0..3`);
    if (!isKnownContentId(`weapon:${w.weapon}`)) err(`arma na parede ${i}: arma não registrada: weapon:${w.weapon}`);
    if (!Number.isInteger(w.cost) || w.cost < 0 || w.cost > 100_000) err(`arma na parede ${i} com preço inválido`);
  });
  if (modes.has('warfare.domination') && mk.domination.length < MIN_DOMINATION_POINTS) {
    err(`Domination: ${mk.domination.length} pontos (mínimo ${MIN_DOMINATION_POINTS})`);
  }
  const unique = (kind: string, names: readonly string[]): void => {
    const seen = new Set<string>();
    for (const n of names) {
      if (n.length === 0 || n.length > MAX_MARKER_NAME) err(`${kind} com nome vazio ou longo demais`);
      if (seen.has(n)) err(`${kind} repetido: ${n}`);
      seen.add(n);
    }
  };
  unique(
    'ponto de Domination',
    mk.domination.map((d) => d.id),
  );
  mk.domination.forEach((d) => {
    if (!finite(d.x, d.y, d.z, d.radius) || d.radius <= 0) err(`ponto de Domination ${d.id} inválido`);
    else if (!inArea(d.x, d.z)) err(`ponto de Domination ${d.id} fora da playArea`);
  });
  unique(
    'câmera',
    mk.cameras.map((c) => c.name),
  );
  mk.cameras.forEach((c) => {
    if (!finite(c.x, c.y, c.z, c.yaw, c.pitch, c.fovYDeg)) err(`câmera ${c.name} com número não finito`);
    if (c.fovYDeg !== 0 && (c.fovYDeg < 10 || c.fovYDeg > 120)) err(`câmera ${c.name} com FOV fora de 10..120°`);
    if (Math.abs(c.pitch) > Math.PI / 2) err(`câmera ${c.name} com pitch além da vertical`);
    if (RESERVED_CAMERA_PREFIXES.some((p) => c.name.startsWith(p)) && !KNOWN_CAMERAS.has(c.name)) {
      err(`câmera ${c.name}: nome de print reservado fora do contrato`);
    }
  });
  unique(
    'rota',
    mk.routes.map((r) => r.name),
  );
  mk.routes.forEach((r) => {
    if (r.points.length < 2) err(`rota ${r.name} com menos de 2 pontos`);
    r.points.forEach((p, i) => {
      if (!finite(p.t, p.x, p.y, p.z, p.yaw, p.pitch)) err(`rota ${r.name}: ponto ${i} com número não finito`);
      if (i === 0 && p.t !== 0) err(`rota ${r.name} precisa começar em t = 0`);
      if (i > 0 && !(p.t > r.points[i - 1]!.t)) err(`rota ${r.name}: tempo não crescente no ponto ${i}`);
    });
  });
  unique(
    'manequim',
    mk.mannequins.map((q) => q.name),
  );
  mk.mannequins.forEach((q) => {
    if (!finite(q.x, q.y, q.z, q.yaw)) err(`manequim ${q.name} com número não finito`);
    if (!isKnownContentId(`skin:${q.look}`)) err(`manequim ${q.name}: skin não registrada: skin:${q.look}`);
    if (q.weapon !== '' && !knownModels.has(q.weapon))
      err(`manequim ${q.name}: arma não registrada: model:${q.weapon}`);
    if (!Number.isInteger(q.team) || q.team < -1 || q.team > 3) err(`manequim ${q.name} com time fora de -1..3`);
    if (!MANNEQUIN_POSES.includes(q.pose)) err(`manequim ${q.name} com pose desconhecida: ${String(q.pose)}`);
    if (RESERVED_MANNEQUIN_PREFIXES.some((p) => q.name.startsWith(p)) && !KNOWN_MANNEQUINS.has(q.name)) {
      err(`manequim ${q.name}: nome de print reservado fora do contrato`);
    }
  });
  if (options.requirePrintMarkers === true) {
    const cams = new Set(mk.cameras.map((c) => c.name));
    for (const c of PRINT_CAMERAS) if (!cams.has(c)) err(`câmera obrigatória ausente: ${c}`);
    const routes = new Set(mk.routes.map((r) => r.name));
    for (const r of REQUIRED_BENCH_ROUTES) if (!routes.has(r)) err(`rota obrigatória ausente: ${r}`);
    const mans = new Set(mk.mannequins.map((q) => q.name));
    for (const q of REQUIRED_MANNEQUINS) if (!mans.has(q)) err(`manequim obrigatório ausente: ${q}`);
    for (const q of mk.mannequins) {
      const fixed = FIXED_MANNEQUIN_POSE[q.name];
      if (fixed !== undefined && q.pose !== fixed[0])
        err(`manequim ${q.name} precisa da pose "${fixed[0]}" (${fixed[1]})`);
    }
    // Marcadores opcionais: o grupo inteiro ou nada.
    const present = new Set([...cams, ...mans]);
    for (const group of OPTIONAL_GROUPS) {
      const missing = group.names.filter((n) => !present.has(n));
      if (missing.length > 0 && missing.length < group.names.length) {
        err(`grupo opcional "${group.name}" pela metade: faltam ${missing.join(', ')}`);
      }
    }
  }

  // Luz
  const [sx, sy, sz] = doc.light.sunDir;
  if (!finite(sx, sy, sz) || Math.abs(Math.hypot(sx, sy, sz) - 1) > 1e-3) err('sunDir precisa ser unitária');
  if (!(sy > 0)) err('sunDir precisa ter y > 0 (sol acima do horizonte)');
  if (!(TIMES_OF_DAY as readonly string[]).includes(doc.light.timeOfDay)) err(`timeOfDay desconhecido`);
  doc.light.emitters.forEach((e, i) => {
    const ok =
      [e.x, e.y, e.z, e.level].every((v) => Number.isInteger(v)) &&
      e.x >= 0 &&
      e.y >= 0 &&
      e.z >= 0 &&
      e.x < g.sizeX &&
      e.y < g.sizeY &&
      e.z < g.sizeZ;
    if (!ok) err(`emissor de luz ${i} fora da grade`);
    if (!(e.level >= 1 && e.level <= 15)) err(`emissor de luz ${i} com nível fora de 1..15`);
  });
  return out;
}
