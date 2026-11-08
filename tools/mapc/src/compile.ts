import { performance } from 'node:perf_hooks';
import { inflateRawSync } from 'node:zlib';
import {
  contentIdsOfKind,
  decodeMap,
  encodeMap,
  isPlayableProp,
  MODEL_FLAG,
  propCollidersToWorld,
  propLightCell,
  validateMap,
  type MapDocument,
  type MapLightEmitter,
} from '@boboforces/format';
import { buildNavGrid, NAV_LINK, type NavGridImpl } from '@boboforces/nav';
import { BOBO_NAV_METRICS } from '@boboforces/sim';
import {
  COLLIDER_FLAG,
  COLLIDER_STRIDE,
  createMapBlockRegistry,
  type BlockRegistry,
  type StaticColliders,
  type WorldGrid,
} from '@boboforces/world';
import type { MapScript } from './api.ts';
import type { BlockTable } from './blocks.ts';
import { createMapBuilder } from './builder.ts';
import { runChecks, type CheckReport } from './checks.ts';
import type { LimbProbes } from './limb-probe.ts';
import type { ModelTable } from './models.ts';
import { buildSightGrid, type SightGrid } from './sight.ts';

/** Teto do `.bfmap` comprimido (tecnico.md §16.4: Construto ≤ 300 KB na primeira partida). */
export const MAX_BFMAP_BYTES = 300 * 1024;
/** Memória da grade acima disto vira aviso (tecnico.md §5.3 estima ≤ 2 MB para o Construto). */
export const GRID_MEMORY_WARN_BYTES = 4 * 1024 * 1024;

export interface CompileOptions {
  readonly blocks: BlockTable;
  readonly models: ModelTable;
  /** Teto da linha de visão declarada (50 m: mapas que rodam no Switch 3–4P). */
  readonly maxSightLimitM?: number;
  /** Exigir câmeras dos prints, rotas do bench e manequins (o Construto do M1 exige). */
  readonly requirePrintMarkers?: boolean;
  /** Sondas da medida de membro através de barreira (testes); sem elas, as da tabela de jogo real. */
  readonly limbProbes?: LimbProbes;
}

export interface MapStats {
  readonly bytes: number;
  readonly rawBytes: number;
  readonly cells: number;
  readonly blockTypes: number;
  readonly chunks: number;
  readonly denseChunks: number;
  readonly gridMemoryBytes: number;
  readonly props: readonly [always: number, proposal: number, double: number];
  readonly emitters: number;
  readonly navNodes: number;
  readonly navLinks: Readonly<Record<keyof typeof NAV_LINK, number>>;
  readonly navComponents: number;
  readonly navBuildMs: number;
  readonly sightMs: number;
  readonly compileMs: number;
}

export interface CompileResult {
  readonly id: string;
  readonly doc: MapDocument;
  readonly bytes: Uint8Array;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly stats: MapStats;
  readonly grid: WorldGrid;
  readonly registry: BlockRegistry;
  readonly nav: NavGridImpl;
  readonly sight: SightGrid;
  readonly checks: CheckReport;
  readonly colliders: StaticColliders;
}

/** Colisores simples (busca linear): o `mapc` só usa para navegação e validação, no build. */
function simpleColliders(boxes: number[], flags: number[], owner: number[]): StaticColliders {
  const b = Float32Array.from(boxes);
  const f = Uint8Array.from(flags);
  const o = Int32Array.from(owner);
  const count = f.length;
  return {
    count,
    boxes: b,
    flags: f,
    owner: o,
    query(minX, minY, minZ, maxX, maxY, maxZ, visit) {
      for (let i = 0; i < count; i++) {
        const s = i * COLLIDER_STRIDE;
        if (b[s + 3]! < minX || b[s]! > maxX || b[s + 4]! < minY || b[s + 1]! > maxY) continue;
        if (b[s + 5]! < minZ || b[s + 2]! > maxZ) continue;
        if (!visit(i)) return;
      }
    },
  };
}

export function compileMap(script: MapScript, options: CompileOptions): CompileResult {
  const t0 = performance.now();
  const errors: string[] = [];
  const warnings: string[] = [...options.blocks.warnings, ...options.models.warnings];
  const handle = createMapBuilder(script.id);
  script.build(handle.builder);
  const built = handle.finish();
  errors.push(...built.errors);

  // Registro de blocos do mapa (na ordem da tabela do .bfmap).
  const missing: string[] = [];
  const registry = createMapBlockRegistry(built.doc.blocks, options.blocks.defs, missing);
  for (const m of missing) errors.push(`bloco sem definição (${options.blocks.source}): ${m}`);
  for (const [key, shapes] of built.shapeNeeds) {
    const def = options.blocks.defs.get(key);
    if (!def) continue;
    for (const shape of shapes) {
      if (def.shape !== shape) {
        errors.push(`bloco "${key}" usado como ${shape}, mas a definição (${options.blocks.source}) diz ${def.shape}`);
      }
    }
  }

  // Props do jogo (`isPlayableProp`: dose ≤ `PLAYABLE_PROP_DOSE`, o dobro da #52) → colisores, navegação e fontes de
  // luz. O mesmo filtro do loading (game/src/scene/world.ts).
  const boxes: number[] = [];
  const flags: number[] = [];
  const owner: number[] = [];
  const models: string[] = [];
  const navBoxes: number[] = [];
  const navFlags: number[] = [];
  const navOwner: number[] = [];
  const emitters: MapLightEmitter[] = [];
  const unknownModels = new Set<string>();
  built.doc.props.forEach((p, index) => {
    const info = options.models.models.get(p.model);
    if (!info) {
      unknownModels.add(p.model);
      return;
    }
    if (!isPlayableProp(p)) return;
    const flagBits =
      COLLIDER_FLAG.solid |
      ((info.flags & MODEL_FLAG.blocksBullets) !== 0 ? COLLIDER_FLAG.blocksBullets : 0) |
      ((info.flags & MODEL_FLAG.blocksSight) !== 0 ? COLLIDER_FLAG.blocksSight : 0) |
      ((info.flags & MODEL_FLAG.walkable) !== 0 ? COLLIDER_FLAG.walkable : 0);
    const world = new Float64Array(info.colliders.length * COLLIDER_STRIDE);
    const count = propCollidersToWorld(p, info.colliders, world);
    for (let i = 0; i < count; i++) {
      const box = Array.from(world.subarray(i * COLLIDER_STRIDE, (i + 1) * COLLIDER_STRIDE));
      boxes.push(...box);
      flags.push(flagBits);
      owner.push(index);
      models.push(p.model);
      if (info.blocksNav) {
        navBoxes.push(...box);
        navFlags.push(flagBits);
        navOwner.push(index);
      }
    }
    if (info.light) {
      const g = built.grid;
      const cell = [0, 0, 0];
      propLightCell(p, info.light.position, g.sizeX, g.sizeY, g.sizeZ, cell);
      emitters.push({ x: cell[0]!, y: cell[1]!, z: cell[2]!, level: info.light.level });
    }
  });
  for (const m of unknownModels) errors.push(`modelo sem definição (${options.models.source}): ${m}`);
  const doc: MapDocument = { ...built.doc, light: { ...built.doc.light, emitters } };
  const colliders = simpleColliders(boxes, flags, owner);
  const navColliders = simpleColliders(navBoxes, navFlags, navOwner);

  // Documento (sem o world).
  errors.push(
    ...validateMap(doc, {
      requirePrintMarkers: options.requirePrintMarkers ?? false,
      knownBlocks: new Set(contentIdsOfKind('block')),
      knownModels: new Set(contentIdsOfKind('model')),
    }),
  );

  // Navegação, linha de visão e as validações com o world.
  const tNav = performance.now();
  const nav = buildNavGrid(
    { grid: built.grid, blocks: registry, colliders: navColliders },
    BOBO_NAV_METRICS,
  ) as NavGridImpl;
  const navBuildMs = performance.now() - tNav;
  const sight = buildSightGrid(built.grid, registry);
  const tSight = performance.now();
  const checks = runChecks({
    doc,
    grid: built.grid,
    registry,
    nav,
    sight,
    doors: built.doors,
    colliders,
    colliderModel: models,
    maxSightLimitM: options.maxSightLimitM ?? 50,
    ...(options.limbProbes !== undefined ? { limbProbes: options.limbProbes } : {}),
  });
  const sightMs = performance.now() - tSight;
  errors.push(...checks.errors);
  warnings.push(...checks.warnings);

  // Arquivo: codifica, confere a ida e volta e o teto.
  const bytes = encodeMap(doc);
  const raw = inflateRawSync(bytes);
  const back = decodeMap(bytes);
  if (back.grid.chunks.length !== doc.grid.chunks.length || back.props.length !== doc.props.length) {
    errors.push('ida e volta do .bfmap não bateu');
  }
  if (bytes.length > MAX_BFMAP_BYTES) {
    errors.push(`.bfmap com ${bytes.length} bytes passa do teto de ${MAX_BFMAP_BYTES} (download da 1ª partida)`);
  }
  let cells = 0;
  let dense = 0;
  for (const c of doc.grid.chunks) {
    if (c.cells === null) {
      cells += c.uniform !== 0 ? 32768 : 0;
      continue;
    }
    dense++;
    for (let i = 0; i < c.cells.length; i++) if (c.cells[i] !== 0) cells++;
  }
  const gridMemoryBytes = dense * 32768 * 2;
  if (gridMemoryBytes > GRID_MEMORY_WARN_BYTES) {
    warnings.push(`grade usa ${(gridMemoryBytes / 1048576).toFixed(1)} MB em chunks densos (estimativa: ≤ 2 MB)`);
  }
  const linkCount = { walk: 0, step: 0, jump: 0, drop: 0, crouch: 0 };
  const kinds = Object.keys(NAV_LINK) as (keyof typeof NAV_LINK)[];
  for (let l = 0; l < nav.linkKind.length; l++) linkCount[kinds[nav.linkKind[l]!]!]++;
  const dose = [0, 0, 0] as [number, number, number];
  for (const p of doc.props) dose[p.dose]++;
  const stats: MapStats = {
    bytes: bytes.length,
    rawBytes: raw.length,
    cells,
    blockTypes: doc.blocks.length - 1,
    chunks: doc.grid.chunks.length,
    denseChunks: dense,
    gridMemoryBytes,
    props: dose,
    emitters: emitters.length,
    navNodes: nav.nodeCount,
    navLinks: linkCount,
    navComponents: nav.componentCount,
    navBuildMs,
    sightMs,
    compileMs: performance.now() - t0,
  };
  return {
    id: script.id,
    doc,
    bytes,
    errors,
    warnings,
    stats,
    grid: built.grid,
    registry,
    nav,
    sight,
    checks,
    colliders,
  };
}
