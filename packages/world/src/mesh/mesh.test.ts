import { describe, expect, it } from 'vitest';
import { BLOCK_FLAG, FACE, createBlockRegistry, type BlockDefInput, type BlockFaces } from '../blocks.ts';
import { makeCell } from '../cell.ts';
import { CHUNK_SIZE } from '../constants.ts';
import { createWorldGrid, type WorldGrid } from '../grid.ts';
import { buildChunkMesh } from './greedy.ts';
import { NORMAL_TABLE, POSITION_STEPS_PER_CELL, VERTEX_FLAG, type MeshArrays } from './vertex.ts';

function cube(key: string, faces: number | BlockFaces, flags: number = BLOCK_FLAG.solid, frames = 1): BlockDefInput {
  const f: BlockFaces = typeof faces === 'number' ? [faces, faces, faces, faces, faces, faces] : faces;
  return { key, shape: 'cube', faces: f, flags, frames, stepSound: key };
}

// ids: 1 concreto (camada 0), 2 tijolo (camada 1), 3 vidro (translúcido), 4 grade (cutout), 5 caixote (6 camadas),
// 6 lâmpada (emissiva + variação + animada), 7 laje (forma ainda não suportada no M0).
const registry = createBlockRegistry([
  cube('concrete', 0),
  cube('brick', 1),
  cube('glass', 2, BLOCK_FLAG.solid | BLOCK_FLAG.translucent),
  cube('grate', 3, BLOCK_FLAG.solid | BLOCK_FLAG.cutout),
  cube('crate', [10, 11, 12, 13, 14, 15]),
  cube('lamp', 20, BLOCK_FLAG.solid | BLOCK_FLAG.emissive | BLOCK_FLAG.colorVariation, 2),
  { key: 'slab', shape: 'slab', faces: [5, 5, 5, 5, 5, 5], flags: BLOCK_FLAG.solid, frames: 1, stepSound: '' },
]);
const CONCRETE = makeCell(1);
const BRICK = makeCell(2);
const GLASS = makeCell(3);
const GRATE = makeCell(4);
const LAMP = makeCell(6);
const SLAB = makeCell(7);

const quads = (m: MeshArrays): number => m.indexCount / 6;

function mesh0(grid: WorldGrid) {
  return buildChunkMesh(grid, registry, 0, 0, 0);
}

/** Camada (byte 1) e normal (5 bits do byte 0) de cada quad. */
function quadInfo(m: MeshArrays): { normal: number; layer: number }[] {
  const out = [];
  for (let q = 0; q < m.vertexCount / 4; q++)
    out.push({ normal: m.attributes[q * 16]! & 31, layer: m.attributes[q * 16 + 1]! });
  return out;
}

describe('buildChunkMesh: contagem de quads', () => {
  it('chunk vazio e chunk inexistente não geram nada', () => {
    const grid = createWorldGrid(64, 32, 32);
    const m = mesh0(grid);
    expect(m.opaque.indexCount + m.cutout.indexCount + m.translucent.indexCount).toBe(0);
    expect([m.originX, m.originY, m.originZ]).toEqual([0, 0, 0]);
    const far = buildChunkMesh(grid, registry, 1, 0, 0);
    expect(far.originX).toBe(32);
    expect(far.opaque.vertexCount).toBe(0);
  });

  it('um cubo sozinho: 6 quads, 24 vértices, 36 índices em u16', () => {
    const grid = createWorldGrid(32, 32, 32);
    grid.set(5, 6, 7, CONCRETE);
    const m = mesh0(grid).opaque;
    expect(quads(m)).toBe(6);
    expect(m.vertexCount).toBe(24);
    expect(m.indices).toBeInstanceOf(Uint16Array);
    const S = POSITION_STEPS_PER_CELL;
    let min = [Infinity, Infinity, Infinity];
    let max = [-Infinity, -Infinity, -Infinity];
    for (let v = 0; v < m.vertexCount; v++) {
      const p = [m.positions[v * 3]!, m.positions[v * 3 + 1]!, m.positions[v * 3 + 2]!];
      min = min.map((x, i) => Math.min(x, p[i]!));
      max = max.map((x, i) => Math.max(x, p[i]!));
    }
    expect(min).toEqual([5 * S, 6 * S, 7 * S]);
    expect(max).toEqual([6 * S, 7 * S, 8 * S]);
  });

  it('fileira do mesmo bloco funde em 6 quads; blocos diferentes não fundem', () => {
    const grid = createWorldGrid(32, 32, 32);
    for (let x = 2; x < 10; x++) grid.set(x, 1, 1, CONCRETE);
    expect(quads(mesh0(grid).opaque)).toBe(6);

    const mixed = createWorldGrid(32, 32, 32);
    mixed.set(2, 1, 1, CONCRETE);
    mixed.set(3, 1, 1, BRICK);
    // As 4 faces laterais de cada um ficam separadas (8) + as 2 pontas.
    expect(quads(mesh0(mixed).opaque)).toBe(10);
  });

  it('placa 4×4 e cubo 3×3×3 viram um quad por lado', () => {
    const grid = createWorldGrid(32, 32, 32);
    for (let x = 0; x < 4; x++) for (let z = 0; z < 4; z++) grid.set(x, 0, z, CONCRETE);
    expect(quads(mesh0(grid).opaque)).toBe(6);

    const box = createWorldGrid(32, 32, 32);
    for (let x = 10; x < 13; x++)
      for (let y = 10; y < 13; y++) for (let z = 10; z < 13; z++) box.set(x, y, z, CONCRETE);
    expect(quads(mesh0(box).opaque)).toBe(6);
  });

  it('chunk cheio (uniforme) dá 6 quads; com vizinho cheio a face da borda some', () => {
    const grid = createWorldGrid(64, 32, 32);
    for (let x = 0; x < 32; x++) for (let y = 0; y < 32; y++) for (let z = 0; z < 32; z++) grid.set(x, y, z, CONCRETE);
    const alone = mesh0(grid).opaque;
    expect(quads(alone)).toBe(6);
    // Cada quad cobre a face inteira do chunk.
    expect(Math.max(...alone.positions.subarray(0, alone.vertexCount * 3))).toBe(CHUNK_SIZE * POSITION_STEPS_PER_CELL);

    for (let y = 0; y < 32; y++) for (let z = 0; z < 32; z++) grid.set(32, y, z, CONCRETE);
    const m = mesh0(grid).opaque;
    expect(quads(m)).toBe(5);
    expect(quadInfo(m).some((q) => q.normal === FACE.px)).toBe(false);
  });

  it('degrau em L funde por linhas máximas', () => {
    // Visto de cima: 3 células em x (z=0) + 1 em z=1 → topo vira 2 quads (3×1 e 1×1).
    const grid = createWorldGrid(32, 32, 32);
    grid.set(0, 0, 0, CONCRETE);
    grid.set(1, 0, 0, CONCRETE);
    grid.set(2, 0, 0, CONCRETE);
    grid.set(0, 0, 1, CONCRETE);
    const info = quadInfo(mesh0(grid).opaque);
    expect(info.filter((q) => q.normal === FACE.py).length).toBe(2);
    expect(info.filter((q) => q.normal === FACE.ny).length).toBe(2);
  });

  it('xadrez 3D cheio passa de 65.536 vértices e usa índices u32', () => {
    const grid = createWorldGrid(32, 32, 32);
    let cubes = 0;
    for (let x = 0; x < 32; x++)
      for (let y = 0; y < 32; y++)
        for (let z = 0; z < 32; z++)
          if ((x + y + z) % 2 === 0) {
            grid.set(x, y, z, CONCRETE);
            cubes++;
          }
    const m = mesh0(grid).opaque;
    expect(quads(m)).toBe(cubes * 6);
    expect(m.indices).toBeInstanceOf(Uint32Array);
    expect(m.vertexCount).toBe(cubes * 24);
  });
});

describe('buildChunkMesh: programas e culling', () => {
  it('opaco ao lado de vidro: a face do opaco aparece, a do vidro contra o opaco some', () => {
    const grid = createWorldGrid(32, 32, 32);
    grid.set(4, 4, 4, CONCRETE);
    grid.set(5, 4, 4, GLASS);
    const m = mesh0(grid);
    expect(quads(m.opaque)).toBe(6);
    expect(quads(m.translucent)).toBe(5);
    expect(quadInfo(m.translucent).some((q) => q.normal === FACE.nx)).toBe(false);
  });

  it('vidro com vidro e grade com grade não geram faces internas', () => {
    const grid = createWorldGrid(32, 32, 32);
    grid.set(4, 4, 4, GLASS);
    grid.set(5, 4, 4, GLASS);
    grid.set(10, 4, 4, GRATE);
    grid.set(10, 5, 4, GRATE);
    const m = mesh0(grid);
    expect(quads(m.translucent)).toBe(6);
    expect(quads(m.cutout)).toBe(6);
    expect(m.opaque.vertexCount).toBe(0);
  });

  it('vidro ao lado de grade: as duas faces de contato aparecem', () => {
    const grid = createWorldGrid(32, 32, 32);
    grid.set(4, 4, 4, GLASS);
    grid.set(5, 4, 4, GRATE);
    const m = mesh0(grid);
    expect(quads(m.translucent)).toBe(6);
    expect(quads(m.cutout)).toBe(6);
  });

  it('formas ainda não suportadas (laje) não geram malha nem escondem vizinhos', () => {
    const grid = createWorldGrid(32, 32, 32);
    grid.set(4, 4, 4, SLAB);
    grid.set(5, 4, 4, CONCRETE);
    expect(quads(mesh0(grid).opaque)).toBe(6);
  });

  it('borda do mapa conta como ar', () => {
    const grid = createWorldGrid(32, 32, 32);
    grid.set(0, 0, 0, CONCRETE);
    expect(quads(mesh0(grid).opaque)).toBe(6);
  });
});

describe('buildChunkMesh: vértices', () => {
  it('triângulos anti-horários vistos de fora (normal geométrica = normal da tabela)', () => {
    const grid = createWorldGrid(32, 32, 32);
    grid.set(3, 3, 3, CONCRETE);
    grid.set(4, 3, 3, CONCRETE);
    grid.set(3, 4, 3, BRICK);
    const m = mesh0(grid).opaque;
    for (let t = 0; t < m.indexCount; t += 3) {
      const [a, b, c] = [m.indices[t]!, m.indices[t + 1]!, m.indices[t + 2]!];
      const p = (i: number) => [m.positions[i * 3]!, m.positions[i * 3 + 1]!, m.positions[i * 3 + 2]!];
      const [pa, pb, pc] = [p(a), p(b), p(c)];
      const e1 = pb.map((x, i) => x - pa[i]!);
      const e2 = pc.map((x, i) => x - pa[i]!);
      const n = [
        e1[1]! * e2[2]! - e1[2]! * e2[1]!,
        e1[2]! * e2[0]! - e1[0]! * e2[2]!,
        e1[0]! * e2[1]! - e1[1]! * e2[0]!,
      ];
      const len = Math.hypot(n[0]!, n[1]!, n[2]!);
      const expected = NORMAL_TABLE[m.attributes[a * 4]! & 31]!;
      expect(n.map((x) => Math.round(x / len))).toEqual([...expected]);
    }
  });

  it('camada por face respeita o giro em Y e a inversão', () => {
    // caixote: px 10, nx 11, py 12, ny 13, pz 14, nz 15.
    const layerOf = (cell: number, face: number): number => {
      const grid = createWorldGrid(32, 32, 32);
      grid.set(1, 1, 1, cell);
      const q = quadInfo(mesh0(grid).opaque).find((i) => i.normal === face);
      return q!.layer;
    };
    expect(layerOf(makeCell(5), FACE.px)).toBe(10);
    // Um quarto de volta anti-horário: a frente local (+Z) passa a olhar para +X.
    expect(layerOf(makeCell(5, 1), FACE.px)).toBe(14);
    expect(layerOf(makeCell(5, 1), FACE.nz)).toBe(10);
    expect(layerOf(makeCell(5, 2), FACE.nz)).toBe(14);
    expect(layerOf(makeCell(5, 3), FACE.nx)).toBe(14);
    expect(layerOf(makeCell(5, 0, true), FACE.py)).toBe(13);
    expect(layerOf(makeCell(5, 2, true), FACE.ny)).toBe(12);
  });

  it('emissivo, variação de cor, animação e luz cheia no M0', () => {
    const grid = createWorldGrid(32, 32, 32);
    grid.set(1, 1, 1, LAMP);
    grid.set(9, 1, 1, CONCRETE);
    const m = mesh0(grid).opaque;
    const lamp: number[][] = [];
    const plain: number[][] = [];
    for (let v = 0; v < m.vertexCount; v++) {
      const a = [...m.attributes.subarray(v * 4, v * 4 + 4)];
      (a[1] === 20 ? lamp : plain).push(a);
    }
    expect(lamp.length).toBe(24);
    for (const a of lamp) {
      expect(a[0]! >> 7).toBe(1);
      expect(a[2]).toBe(0xff);
      expect(a[3]! & 15).toBe(15);
      expect(a[3]! >> 4).toBe(VERTEX_FLAG.animated);
    }
    for (const a of plain) {
      expect(a[0]! >> 7).toBe(0);
      expect((a[0]! >> 5) & 3).toBe(3);
      expect(a[3]).toBe(0);
    }
  });

  it('é determinístico e reaproveita buffers com `reuse`', () => {
    const grid = createWorldGrid(32, 32, 32);
    for (let i = 0; i < 20; i++) grid.set((i * 7) % 32, (i * 3) % 32, (i * 11) % 32, i % 2 ? CONCRETE : BRICK);
    const a = mesh0(grid);
    const snapshot = {
      positions: a.opaque.positions.slice(0, a.opaque.vertexCount * 3),
      attributes: a.opaque.attributes.slice(0, a.opaque.vertexCount * 4),
      indices: a.opaque.indices.slice(0, a.opaque.indexCount),
    };
    const positions = a.opaque.positions;
    const b = buildChunkMesh(grid, registry, 0, 0, 0, { reuse: a });
    expect(b.opaque.positions).toBe(positions);
    expect(b.opaque.positions.slice(0, b.opaque.vertexCount * 3)).toEqual(snapshot.positions);
    expect(b.opaque.attributes.slice(0, b.opaque.vertexCount * 4)).toEqual(snapshot.attributes);
    expect(b.opaque.indices.slice(0, b.opaque.indexCount)).toEqual(snapshot.indices);
  });
});
