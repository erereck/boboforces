import {
  MAP_FORMAT,
  type MapCamera,
  type MapCameraRoute,
  type MapDocument,
  type MapLight,
  type MapBarricadeMarker,
  type MapMannequin,
  type MapMeta,
  type MapPaidDoorMarker,
  type MapWallBuyMarker,
  type MapPointMarker,
  type MapProp,
  type MapSpawnMarker,
  type PropDose,
} from '@boboforces/format';
import { createRng } from '@boboforces/shared';
import {
  cellBlock,
  cellFlipped,
  cellRotation,
  createWorldGrid,
  makeCell,
  mapGridFromGrid,
  MAX_BLOCK_ID,
  type BlockShape,
  type WorldGrid,
} from '@boboforces/world';
import { RAMP_DIR_ROTATION, type DoorRecord, type MapBuilder, type RampDir, type RampFamily } from './api.ts';

/** Texels do cenário por metro (posição das props) e passos de giro por volta (u8). */
const TEXELS_PER_METER = 32;
const YAW_STEPS = 256;

/** O que o builder entrega para o compilador. */
export interface BuiltMap {
  readonly id: string;
  /** Documento sem as fontes de luz das props (o compilador calcula a partir dos modelos). */
  readonly doc: MapDocument;
  /** Grade com os índices LOCAIS de `doc.blocks`. */
  readonly grid: WorldGrid;
  readonly doors: readonly DoorRecord[];
  /** Forma que cada bloco precisa ter pelo uso (rampa, escada, cerca, cruz…). */
  readonly shapeNeeds: ReadonlyMap<string, ReadonlySet<BlockShape>>;
  /** Problemas de uso da API (pt-BR). */
  readonly errors: readonly string[];
}

export interface MapBuilderHandle {
  readonly builder: MapBuilder;
  finish(): BuiltMap;
}

const order = (a: number, b: number): [number, number] => (a <= b ? [a, b] : [b, a]);

/** Cria o builder de um mapa. `seedBase` separa os RNGs de mapas diferentes. */
export function createMapBuilder(id: string): MapBuilderHandle {
  let grid: WorldGrid | null = null;
  const table: string[] = ['air'];
  const index = new Map<string, number>([['air', 0]]);
  const errors: string[] = [];
  const doors: DoorRecord[] = [];
  const shapeNeeds = new Map<string, Set<BlockShape>>();
  const props: MapProp[] = [];
  const spawns: MapSpawnMarker[] = [];
  const domination: MapPointMarker[] = [];
  const cameras: MapCamera[] = [];
  const routes: MapCameraRoute[] = [];
  const mannequins: MapMannequin[] = [];
  const barricades: MapBarricadeMarker[] = [];
  const paidDoors: MapPaidDoorMarker[] = [];
  const wallBuys: MapWallBuyMarker[] = [];
  let meta: MapMeta | null = null;
  let playArea: MapDocument['markers']['playArea'] | null = null;
  let light: MapLight | null = null;

  const need = (block: string, shape: BlockShape): void => {
    let set = shapeNeeds.get(block);
    if (!set) {
      set = new Set();
      shapeNeeds.set(block, set);
    }
    set.add(shape);
  };
  const g = (): WorldGrid => {
    if (!grid) throw new Error(`mapa ${id}: chame size() antes de mexer na grade`);
    return grid;
  };
  const blockIndex = (block: string): number => {
    let i = index.get(block);
    if (i === undefined) {
      i = table.length;
      if (i > MAX_BLOCK_ID) throw new Error(`mapa ${id}: mais de ${MAX_BLOCK_ID} blocos`);
      table.push(block);
      index.set(block, i);
    }
    return i;
  };
  const setCell = (x: number, y: number, z: number, block: string | null, rot = 0, flip = false): void => {
    const grid = g();
    if (!grid.inBounds(x, y, z)) throw new Error(`mapa ${id}: célula ${x},${y},${z} fora da grade`);
    grid.set(x, y, z, block === null ? 0 : makeCell(blockIndex(block), rot, flip));
  };
  const getCell = (x: number, y: number, z: number): string | null => {
    const cell = g().get(x, y, z);
    return cell === 0 ? null : table[cellBlock(cell)]!;
  };
  const forBox = (
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    fn: (x: number, y: number, z: number) => void,
  ): void => {
    const [ax, bx] = order(x0, x1);
    const [ay, by] = order(y0, y1);
    const [az, bz] = order(z0, z1);
    for (let y = ay; y <= by; y++) for (let z = az; z <= bz; z++) for (let x = ax; x <= bx; x++) fn(x, y, z);
  };

  /** Rampa ou escada: célula t (0 = pé) ao longo de `dir`, com apoio embaixo. */
  const slopeRun = (
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    z1: number,
    family: RampFamily,
    dir: RampDir,
    kind: '1:1' | '1:2' | 'stairs',
  ): number => {
    const [ax, bx] = order(x0, x1);
    const [az, bz] = order(z0, z1);
    const rot = RAMP_DIR_ROTATION[dir];
    const alongX = dir === '+x' || dir === '-x';
    const length = alongX ? bx - ax + 1 : bz - az + 1;
    let topY = y0;
    for (let t = 0; t < length; t++) {
      const level = kind === '1:2' ? t >> 1 : t;
      let block: string | undefined;
      if (kind === '1:1') block = family.ramp;
      else if (kind === 'stairs') block = family.step;
      else block = t % 2 === 0 ? family.halfLow : family.halfHigh;
      if (!block) throw new Error(`mapa ${id}: família de rampa sem o bloco para ${kind}`);
      need(block, kind === '1:1' ? 'ramp' : kind === 'stairs' ? 'step' : t % 2 === 0 ? 'rampHalfLow' : 'rampHalfHigh');
      need(family.solid, 'cube');
      // Posição ao longo da direção de subida.
      const p = dir === '+x' ? ax + t : dir === '-x' ? bx - t : dir === '+z' ? az + t : bz - t;
      for (let q = alongX ? az : ax; q <= (alongX ? bz : bx); q++) {
        const x = alongX ? p : q;
        const z = alongX ? q : p;
        for (let y = y0; y < y0 + level; y++) setCell(x, y, z, family.solid);
        setCell(x, y0 + level, z, block, rot);
      }
      topY = y0 + level + 1;
    }
    return topY;
  };

  const builder: MapBuilder = {
    meta(m) {
      meta = m;
    },
    size(x, y, z) {
      grid = createWorldGrid(x, y, z);
    },
    set: (x, y, z, block, rot = 0, flip = false) => setCell(x, y, z, block, rot, flip),
    get: getCell,
    box(x0, y0, z0, x1, y1, z1, block, rot = 0) {
      forBox(x0, y0, z0, x1, y1, z1, (x, y, z) => setCell(x, y, z, block, rot));
    },
    fill(x0, y0, z0, x1, y1, z1, block) {
      forBox(x0, y0, z0, x1, y1, z1, (x, y, z) => {
        if (getCell(x, y, z) === null) setCell(x, y, z, block);
      });
    },
    walls(x0, y0, z0, x1, y1, z1, block) {
      const [ax, bx] = order(x0, x1);
      const [az, bz] = order(z0, z1);
      forBox(ax, y0, az, bx, y1, bz, (x, y, z) => {
        if (x === ax || x === bx || z === az || z === bz) setCell(x, y, z, block);
      });
    },
    ramp: (x0, y0, z0, x1, z1, family, dir, slope) => slopeRun(x0, y0, z0, x1, z1, family, dir, slope),
    stairs: (x0, y0, z0, x1, z1, family, dir) => slopeRun(x0, y0, z0, x1, z1, family, dir, 'stairs'),
    fence(x0, y, z0, x1, z1, block, height = 1) {
      if (x0 !== x1 && z0 !== z1) throw new Error(`mapa ${id}: cerca precisa ser reta (x0 = x1 ou z0 = z1)`);
      // Forma canônica corre ao longo de X; linha ao longo de Z gira 1 quarto.
      const rot = x0 === x1 && z0 !== z1 ? 1 : 0;
      forBox(x0, y, z0, x1, y + height - 1, z1, (x, yy, z) => setCell(x, yy, z, block, rot));
    },
    panel(x0, y0, z0, x1, y1, z1, block) {
      if (x0 !== x1 && z0 !== z1) throw new Error(`mapa ${id}: painel precisa ter 1 célula de espessura em X ou Z`);
      need(block, 'panel');
      const rot = x0 === x1 && z0 !== z1 ? 1 : 0;
      forBox(x0, y0, z0, x1, y1, z1, (x, y, z) => setCell(x, y, z, block, rot));
    },
    cross(x, y, z, block) {
      const grid = g();
      if (!grid.inBounds(x, y, z) || grid.get(x, y, z) !== 0 || y === 0 || grid.get(x, y - 1, z) === 0) return false;
      need(block, 'cross');
      setCell(x, y, z, block);
      return true;
    },
    door(x, y, z, along, thickness = 1, width = 2, height = 4) {
      const x1 = along === 'x' ? x + width - 1 : x + thickness - 1;
      const z1 = along === 'z' ? z + width - 1 : z + thickness - 1;
      forBox(x, y, z, x1, y + height - 1, z1, (cx, cy, cz) => setCell(cx, cy, cz, null));
      doors.push({ x, y, z, along, width, height, thickness });
    },
    prop(model, x, y, z, yaw, scale = 1, dose: PropDose = 1) {
      const steps = Math.round((yaw / (Math.PI * 2)) * YAW_STEPS);
      props.push({
        model,
        x: Math.round(x * TEXELS_PER_METER),
        y: Math.round(y * TEXELS_PER_METER),
        z: Math.round(z * TEXELS_PER_METER),
        yaw: ((steps % YAW_STEPS) + YAW_STEPS) % YAW_STEPS,
        scale: Math.max(1, Math.min(255, Math.round(scale * 16))),
        dose,
      });
    },
    spawn: (m) => void spawns.push(m),
    domination: (p) => void domination.push(p),
    camera: (c) => void cameras.push(c),
    route: (r) => void routes.push(r),
    mannequin: (q) => void mannequins.push(q),
    barricade: (w) => void barricades.push(w),
    paidDoor: (d) => void paidDoors.push(d),
    wallBuy: (w) => void wallBuys.push(w),
    playArea(minX, minZ, maxX, maxZ, killPlaneY) {
      playArea = { minX, minZ, maxX, maxZ, killPlaneY };
    },
    sun(dx, dy, dz, timeOfDay) {
      const len = Math.hypot(dx, dy, dz);
      light = { sunDir: [dx / len, dy / len, dz / len], timeOfDay, emitters: [] };
    },
    rng: (domain) => createRng(`map:${id}:${domain}`),
  };

  return {
    builder,
    finish(): BuiltMap {
      const grid = g();
      if (!meta) errors.push('meta() não foi chamado');
      if (!playArea) errors.push('playArea() não foi chamado');
      if (!light) errors.push('sun() não foi chamado');
      // Compacta a tabela: blocos que não sobraram na grade saem, os outros mantêm a ordem do primeiro uso.
      const used = new Uint8Array(table.length);
      grid.forEachChunk((chunk) => {
        if (chunk.cells === null) used[cellBlock(chunk.uniform)] = 1;
        else for (let i = 0; i < chunk.cells.length; i++) used[cellBlock(chunk.cells[i]!)] = 1;
      });
      used[0] = 1;
      const remap = new Int32Array(table.length);
      const blocks: string[] = [];
      for (let i = 0; i < table.length; i++) {
        if (used[i] === 0) continue;
        remap[i] = blocks.length;
        blocks.push(table[i]!);
      }
      const fix = (cell: number): number =>
        cell === 0 ? 0 : makeCell(remap[cellBlock(cell)]!, cellRotation(cell), cellFlipped(cell));
      grid.forEachChunk((chunk) => {
        if (chunk.cells === null) chunk.uniform = fix(chunk.uniform);
        else for (let i = 0; i < chunk.cells.length; i++) chunk.cells[i] = fix(chunk.cells[i]!);
      });
      for (const key of [...shapeNeeds.keys()]) if (!blocks.includes(key)) shapeNeeds.delete(key);
      const doc: MapDocument = {
        format: MAP_FORMAT,
        id,
        meta: meta ?? {
          nameKey: '',
          modes: [],
          players: { min: 1, ideal: 1, max: 1 },
          maxSightLineM: 0,
          botCaps: {},
        },
        blocks,
        grid: mapGridFromGrid(grid),
        props,
        markers: {
          spawns,
          domination,
          cameras,
          routes,
          mannequins,
          ...(barricades.length > 0 ? { barricades } : {}),
          ...(paidDoors.length > 0 ? { paidDoors } : {}),
          ...(wallBuys.length > 0 ? { wallBuys } : {}),
          playArea: playArea ?? { minX: 0, minZ: 0, maxX: 0, maxZ: 0, killPlaneY: 0 },
        },
        light: light ?? { sunDir: [0, 1, 0], timeOfDay: 'day', emitters: [] },
      };
      return { id, doc, grid, doors, shapeNeeds, errors };
    },
  };
}
