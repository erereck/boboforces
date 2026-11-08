import { describe, expect, it } from 'vitest';
import { BLOCK_FLAG, createBlockRegistry, FACE, type BlockDefInput, type BlockFaces } from '../blocks.ts';
import { makeCell } from '../cell.ts';
import { createWorldGrid, type WorldGrid } from '../grid.ts';
import { computeLight } from '../light.ts';
import type { BlockShape } from '../shapes.ts';
import {
  buildRegionMesh,
  REGION_VERTEX_FLAG,
  unpackRegionVertex,
  type RegionMesh,
  type RegionMeshArrays,
  type RegionVertex,
} from './region.ts';
import { NORMAL, NORMAL_TABLE, rampNormalIndex } from './vertex.ts';

const SOLID = BLOCK_FLAG.solid | BLOCK_FLAG.blocksBullets | BLOCK_FLAG.blocksSight;
interface DefExtra {
  readonly emissive?: number;
  readonly variants?: number;
  readonly frames?: number;
  readonly faces?: BlockFaces;
}

function def(key: string, shape: BlockShape, layer: number, flags = SOLID, extra: DefExtra = {}): BlockDefInput {
  const faces: BlockFaces = extra.faces ?? [layer, layer, layer, layer, layer, layer];
  const out: BlockDefInput = { key, shape, faces, flags, frames: extra.frames ?? 1, stepSound: '' };
  return {
    ...out,
    ...(extra.emissive === undefined ? {} : { emissive: extra.emissive }),
    ...(extra.variants === undefined ? {} : { variants: extra.variants }),
  };
}

// 1 concreto (0), 2 tijolo (1), 3 laje (2), 4 painel cutout (3), 5 rampa (4), 6 cruz que balança (5),
// 7 lâmpada (6, emissivo 12), 8 vidro (7), 9 caixote com faces diferentes (10..15), 10 rampa 1:2 baixa (4),
// 11 bloco animado com variantes e UV aleatória (20).
const registry = createBlockRegistry([
  def('concrete', 'cube', 0),
  def('brick', 'cube', 1),
  def('slab', 'slab', 2),
  def('fence', 'panel', 3, BLOCK_FLAG.solid | BLOCK_FLAG.cutout),
  def('ramp', 'ramp', 4),
  def('grass', 'cross', 5, BLOCK_FLAG.cutout | BLOCK_FLAG.swaysInWind),
  def('lamp', 'cube', 6, SOLID | BLOCK_FLAG.emissive, { emissive: 12 }),
  def('glass', 'cube', 7, BLOCK_FLAG.solid | BLOCK_FLAG.translucent),
  def('crate', 'cube', 0, SOLID, { faces: [10, 11, 12, 13, 14, 15] }),
  def('ramp-low', 'rampHalfLow', 4),
  def('screen', 'cube', 20, SOLID | BLOCK_FLAG.randomUv | BLOCK_FLAG.colorVariation, { frames: 4, variants: 3 }),
]);
const CONCRETE = makeCell(1);
const BRICK = makeCell(2);

const quads = (a: RegionMeshArrays): number => a.indexCount / 6;
const allQuads = (m: RegionMesh): number => quads(m.opaque) + quads(m.cutout) + quads(m.translucent);

function vertices(a: RegionMeshArrays): RegionVertex[] {
  const out: RegionVertex[] = [];
  for (let i = 0; i < a.vertexCount; i++) {
    out.push(
      unpackRegionVertex(a.vertices, i * 6, {
        x: 0,
        y: 0,
        z: 0,
        normal: 0,
        ao: 0,
        colorVariation: false,
        layer: 0,
        sky: 0,
        sun: 0,
        emissive: 0,
        flags: 0,
        variants: 1,
        frames: 1,
      }),
    );
  }
  return out;
}

function mesh(grid: WorldGrid, rx = 0, ry = 0, rz = 0, light: ReturnType<typeof computeLight> | null = null) {
  return buildRegionMesh(grid, registry, light, rx, ry, rz);
}

describe('greedy por textura', () => {
  it('cubo sozinho: 6 quads, 24 vértices, AO aberto, luz cheia sem campo, u16', () => {
    const g = createWorldGrid(64, 32, 64);
    g.set(5, 6, 7, CONCRETE);
    const m = mesh(g);
    expect(quads(m.opaque)).toBe(6);
    expect(m.opaque.vertexCount).toBe(24);
    expect(m.opaque.indices).toBeInstanceOf(Uint16Array);
    const vs = vertices(m.opaque);
    expect(vs.every((v) => v.ao === 3 && v.sky === 15 && v.sun === 15 && v.emissive === 0)).toBe(true);
    expect(new Set(vs.map((v) => v.normal))).toEqual(new Set([0, 1, 2, 3, 4, 5]));
    expect([m.minX, m.minY, m.minZ, m.maxX, m.maxY, m.maxZ]).toEqual([5, 6, 7, 6, 7, 8]);
    expect([m.originX, m.originY, m.originZ]).toEqual([0, 0, 0]);
  });

  it('chão de 64 × 64: topo e fundo viram 1 quad cada; textura diferente não funde', () => {
    const g = createWorldGrid(64, 32, 64);
    for (let z = 0; z < 64; z++) for (let x = 0; x < 64; x++) g.set(x, 0, z, CONCRETE);
    expect(allQuads(mesh(g))).toBe(6);
    g.set(10, 0, 10, BRICK);
    // O tijolo parte topo e fundo em vários quads e ganha os dele.
    const m = mesh(g);
    expect(allQuads(m)).toBeGreaterThan(6);
    const tops = vertices(m.opaque).filter((v) => v.normal === FACE.py);
    expect(new Set(tops.map((v) => v.layer))).toEqual(new Set([0, 1]));
  });

  it('caixote: camada por face e giro leva a face junto', () => {
    const g = createWorldGrid(64, 32, 64);
    g.set(1, 1, 1, makeCell(9, 1));
    const vs = vertices(mesh(g).opaque);
    const layerOf = (normal: number) => vs.find((v) => v.normal === normal)!.layer;
    expect(layerOf(FACE.py)).toBe(12);
    // Giro 1: a face local -Z (15) aparece em -X; a local +X (10) em -Z.
    expect(layerOf(FACE.nx)).toBe(15);
    expect(layerOf(FACE.nz)).toBe(10);
  });

  it('bytes 9–10: flags, variantes, quadros e variação de cor', () => {
    const g = createWorldGrid(64, 32, 64);
    g.set(1, 1, 1, makeCell(11));
    const v = vertices(mesh(g).opaque)[0]!;
    expect(v.flags).toBe(REGION_VERTEX_FLAG.animated | REGION_VERTEX_FLAG.randomUv);
    expect(v.variants).toBe(3);
    expect(v.frames).toBe(4);
    expect(v.colorVariation).toBe(true);
    expect(v.layer).toBe(20);
  });

  it('opaco, cutout e translúcido em malhas separadas; vidro com vidro some, vidro com concreto não', () => {
    const g = createWorldGrid(64, 32, 64);
    g.set(1, 1, 1, makeCell(8));
    g.set(2, 1, 1, makeCell(8));
    g.set(3, 1, 1, CONCRETE);
    const m = mesh(g);
    // Vidro: 2 células fundidas em 1 bloco de 2 → topo, fundo, ±Z fundem (4) + -X (1); +X do vidro encosta no
    // concreto, que é opaco: some. Concreto: 6 faces menos nada (o vidro não esconde).
    expect(quads(m.translucent)).toBe(5);
    expect(quads(m.opaque)).toBe(6);
  });
});

describe('AO 0fps e troca da diagonal', () => {
  /** Vértices do topo (normal +Y) na altura y (células) com x, z (células). */
  function topVertex(vs: RegionVertex[], x: number, y: number, z: number): RegionVertex[] {
    return vs.filter((v) => v.normal === FACE.py && v.x === x * 16 && v.y === y * 16 && v.z === z * 16);
  }

  it('cubo em cima do chão escurece os cantos encostados; dois lados fechados dão AO 0', () => {
    const g = createWorldGrid(64, 32, 64);
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) g.set(x, 0, z, CONCRETE);
    g.set(5, 1, 5, BRICK);
    let vs = vertices(mesh(g).opaque);
    // Canto (5, 1, 5) do chão: vértices dos quads do chão que tocam o cubo têm AO < 3.
    expect(topVertex(vs, 5, 1, 5).every((v) => v.ao < 3)).toBe(true);
    expect(Math.min(...topVertex(vs, 5, 1, 5).map((v) => v.ao))).toBe(2);
    expect(topVertex(vs, 0, 1, 0).every((v) => v.ao === 3)).toBe(true);
    // Canto interno entre dois cubos: AO 0.
    g.set(4, 1, 6, BRICK);
    vs = vertices(mesh(g).opaque);
    expect(topVertex(vs, 5, 1, 6).some((v) => v.ao === 0)).toBe(true);
    // Sem AO (comparação nos prints).
    const flat = vertices(buildRegionMesh(g, registry, null, 0, 0, 0, { noAo: true }).opaque);
    expect(flat.every((v) => v.ao === 3)).toBe(true);
  });

  it('quad com um canto escuro troca a diagonal (liga os cantos claros)', () => {
    const g = createWorldGrid(64, 32, 64);
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) g.set(x, 0, z, CONCRETE);
    g.set(5, 1, 5, BRICK);
    const m = mesh(g);
    const vs = vertices(m.opaque);
    // O topo da célula (4, 0, 4) tem só o canto (5, 5) escuro: é um quad próprio.
    let found = false;
    for (let q = 0; q < m.opaque.indexCount / 6; q++) {
      const i = [0, 1, 2, 3, 4, 5].map((k) => m.opaque.indices[q * 6 + k]!);
      const corners = new Set(i.map((k) => `${vs[k]!.x},${vs[k]!.y},${vs[k]!.z}`));
      const want = ['64,16,64', '80,16,64', '80,16,80', '64,16,80'];
      if (vs[i[0]!]!.normal !== FACE.py || !want.every((w) => corners.has(w))) continue;
      found = true;
      // A diagonal comum aos dois triângulos não passa pelo vértice escuro.
      const t1 = new Set(i.slice(0, 3));
      const shared = i.slice(3).filter((k) => t1.has(k));
      expect(shared).toHaveLength(2);
      for (const k of shared) expect(vs[k]!.ao).toBe(3);
    }
    expect(found).toBe(true);
  });

  it('fusão exige o mesmo AO e a mesma luz nos 4 cantos', () => {
    const g = createWorldGrid(64, 32, 64);
    for (let z = 0; z < 64; z++) for (let x = 0; x < 64; x++) g.set(x, 0, z, CONCRETE);
    // Uma fileira de cubos no meio: o chão em volta vira faixas (AO), mas continua fundindo ao longo dela.
    for (let z = 0; z < 64; z++) g.set(32, 1, z, BRICK);
    const m = mesh(g);
    const floorTops = m.opaque.indexCount / 6;
    // Chão: topo em 4 faixas (antes, x = 31, x = 33, depois) + fundo + 4 lados; fileira: topo, 2 pontas e 2 lados
    // em 3 pedaços cada (nas pontas o canto do AO cai fora da grade, que é ar). Fora das pontas, tudo fundiu em z.
    expect(floorTops).toBe(22);
    // Com luz: sombra do sol a pino debaixo de uma marquise parte o chão pelo canal de sol.
    const lit = computeLight(g, registry, { sunDirX: 0, sunDirY: 1, sunDirZ: 0, emitters: [] });
    const vs = vertices(mesh(g, 0, 0, 0, lit).opaque).filter((v) => v.normal === FACE.py && v.y === 16);
    expect(vs.every((v) => v.sun === 15 && v.sky === 15)).toBe(true);
  });
});

describe('formas na malha', () => {
  it('laje: topo a meia altura e fileira de lajes funde topo e fundo, as pontas se escondem', () => {
    const g = createWorldGrid(64, 32, 64);
    g.set(3, 2, 3, makeCell(3));
    let m = mesh(g);
    expect(quads(m.opaque)).toBe(6);
    const vs = vertices(m.opaque);
    expect(Math.max(...vs.map((v) => v.y))).toBe(2 * 16 + 8);
    expect(vs.filter((v) => v.normal === FACE.py).every((v) => v.y === 40)).toBe(true);
    for (let x = 0; x < 64; x++) g.set(x, 2, 3, makeCell(3));
    m = mesh(g);
    // Topo 1 + fundo 1 + 64 × (±Z, parciais) + 2 pontas.
    expect(quads(m.opaque)).toBe(1 + 1 + 128 + 2);
  });

  it('painel: faces largas fundem; pontas entre painéis somem; vai para o cutout', () => {
    const g = createWorldGrid(64, 32, 64);
    for (let x = 0; x < 10; x++) g.set(x, 1, 5, makeCell(4));
    const m = mesh(g);
    expect(quads(m.opaque)).toBe(0);
    // ±Z: 1 + 1 (fundidas, planos z = 7 e 9 da célula); pontas ±X: 2; topo e fundo (parciais): 10 + 10.
    expect(quads(m.cutout)).toBe(24);
    const zs = new Set(
      vertices(m.cutout)
        .filter((v) => v.normal === FACE.pz || v.normal === FACE.nz)
        .map((v) => v.z),
    );
    expect(zs).toEqual(new Set([5 * 16 + 7, 5 * 16 + 9]));
  });

  it('rampa: plano com a normal da tabela, laterais em triângulo, costas e fundo cheios', () => {
    const g = createWorldGrid(64, 32, 64);
    g.set(3, 1, 3, makeCell(5, 1));
    const m = mesh(g);
    const vs = vertices(m.opaque);
    expect(vs.filter((v) => v.normal === rampNormalIndex(1, 1, false))).toHaveLength(4);
    // 1 plano (6 índices) + 2 triângulos (3 + 3) + costas + fundo (6 + 6).
    expect(m.opaque.indexCount).toBe(6 + 3 + 3 + 6 + 6);
    // Duas rampas lado a lado (ao longo da largura) escondem os triângulos encostados.
    g.set(3, 1, 4, makeCell(5, 1));
    // Costas e fundo das duas também fundem (mesmo plano, mesma camada).
    expect(mesh(g).opaque.indexCount).toBe(2 * 6 + 6 + 6 + 3 + 3);
    // Rampa 1:2 usa a normal 1:2.
    g.set(10, 1, 10, makeCell(10));
    expect(vertices(mesh(g).opaque).some((v) => v.normal === rampNormalIndex(2, 0, false))).toBe(true);
  });

  it('cubo encostado nas costas da rampa esconde as duas faces', () => {
    const g = createWorldGrid(64, 32, 64);
    g.set(3, 1, 3, makeCell(5)); // costas em -Z
    g.set(3, 1, 2, CONCRETE);
    const vs = vertices(mesh(g).opaque);
    expect(vs.filter((v) => v.z === 3 * 16 && (v.normal === FACE.pz || v.normal === FACE.nz))).toHaveLength(0);
  });

  it('cruz: 4 quads no cutout (dupla face), normais das diagonais, topo marcado, sem AO', () => {
    const g = createWorldGrid(64, 32, 64);
    for (let z = 0; z < 8; z++) for (let x = 0; x < 8; x++) g.set(x, 0, z, CONCRETE);
    g.set(3, 1, 3, makeCell(6));
    const m = mesh(g);
    expect(quads(m.cutout)).toBe(4);
    const vs = vertices(m.cutout);
    expect(new Set(vs.map((v) => v.normal))).toEqual(
      new Set([NORMAL.cross, NORMAL.cross + 1, NORMAL.cross + 2, NORMAL.cross + 3]),
    );
    expect(vs.every((v) => v.ao === 3)).toBe(true);
    for (const v of vs) {
      const top = (v.flags & REGION_VERTEX_FLAG.top) !== 0;
      expect(top).toBe(v.y === 32);
      expect(v.flags & REGION_VERTEX_FLAG.swaysInWind).toBe(REGION_VERTEX_FLAG.swaysInWind);
    }
    // O chão embaixo da cruz continua inteiro (a cruz não esconde nada).
    expect(quads(m.opaque)).toBe(6);
  });

  it('emissivo do bloco vale como mínimo no vértice; luz do campo entra nos canais', () => {
    const g = createWorldGrid(64, 32, 64);
    g.set(3, 3, 3, makeCell(7));
    const lit = computeLight(g, registry, { sunDirX: 0, sunDirY: 1, sunDirZ: 0, emitters: [] });
    const vs = vertices(mesh(g, 0, 0, 0, lit).opaque);
    expect(vs.every((v) => v.emissive === 12)).toBe(true);
    // Embaixo: a célula da frente está na sombra; o vértice faz a média com as vizinhas (luz suave).
    expect(vs.filter((v) => v.normal === FACE.ny).every((v) => v.sun < 15)).toBe(true);
    expect(vs.filter((v) => v.normal === FACE.py).every((v) => v.sun === 15)).toBe(true);
  });
});

describe('todas as formas em todas as orientações', () => {
  it('cada triângulo gira para fora (produto vetorial na direção da normal da tabela) e fica dentro da célula', () => {
    const shapes: BlockShape[] = [
      'cube',
      'slab',
      'step',
      'ramp',
      'rampHalfLow',
      'rampHalfHigh',
      'rampCornerIn',
      'rampCornerOut',
      'panel',
      'postRail',
      'cross',
    ];
    const reg = createBlockRegistry(shapes.map((s, i) => def(`s${i}`, s, i)));
    const g = createWorldGrid(64, 32, 64);
    shapes.forEach((_, i) => {
      for (let o = 0; o < 8; o++) g.set(2 + o * 3, 2, 2 + i * 3, makeCell(i + 1, o & 3, o >= 4));
    });
    const m = buildRegionMesh(g, reg, null, 0, 0, 0);
    let triangles = 0;
    for (const a of [m.opaque, m.cutout, m.translucent]) {
      const vs = vertices(a);
      for (let t = 0; t < a.indexCount; t += 3) {
        const [p, q, r] = [a.indices[t]!, a.indices[t + 1]!, a.indices[t + 2]!].map((k) => vs[k]!);
        const e1 = [q!.x - p!.x, q!.y - p!.y, q!.z - p!.z];
        const e2 = [r!.x - p!.x, r!.y - p!.y, r!.z - p!.z];
        const cross = [
          e1[1]! * e2[2]! - e1[2]! * e2[1]!,
          e1[2]! * e2[0]! - e1[0]! * e2[2]!,
          e1[0]! * e2[1]! - e1[1]! * e2[0]!,
        ];
        const n = NORMAL_TABLE[p!.normal]!;
        const len = Math.hypot(cross[0]!, cross[1]!, cross[2]!);
        expect(len).toBeGreaterThan(0);
        expect((cross[0]! * n[0] + cross[1]! * n[1] + cross[2]! * n[2]) / len).toBeGreaterThan(0.99);
        expect(q!.normal).toBe(p!.normal);
        expect(r!.normal).toBe(p!.normal);
        triangles++;
      }
    }
    expect(triangles).toBeGreaterThan(400);
  });
});

describe('região, reaproveitamento e determinismo', () => {
  it('região 2×2×1 chunks: origem e posições relativas; vizinho fora da região esconde a face da borda', () => {
    const g = createWorldGrid(128, 64, 128);
    g.set(64, 32, 64, CONCRETE);
    g.set(63, 32, 64, CONCRETE);
    const m = mesh(g, 1, 1, 1);
    expect([m.originX, m.originY, m.originZ]).toEqual([64, 32, 64]);
    const vs = vertices(m.opaque);
    expect(Math.min(...vs.map((v) => v.x))).toBe(0);
    // A face -X do cubo em 64 encosta no cubo em 63 (outra região): some.
    expect(vs.some((v) => v.normal === FACE.nx)).toBe(false);
    expect(quads(m.opaque)).toBe(5);
    // Região sem bloco: malhas vazias e AABB vazia.
    const empty = mesh(g, 0, 0, 0);
    expect(allQuads(empty)).toBe(0);
    expect(empty.minX).toBeGreaterThan(empty.maxX);
  });

  it('reuse: devolve os mesmos arrays quando cabem; resultado igual e determinístico', () => {
    const g = createWorldGrid(64, 32, 64);
    for (let z = 0; z < 64; z += 2)
      for (let x = 0; x < 64; x += 3) g.set(x, (x + z) % 7, z, makeCell(1 + ((x + z) % 3)));
    const a = mesh(g);
    const copy = Uint16Array.from(a.opaque.vertices.subarray(0, a.opaque.vertexCount * 6));
    const big = buildRegionMesh(g, registry, null, 0, 0, 0);
    const b = buildRegionMesh(g, registry, null, 0, 0, 0, { reuse: big });
    expect(b.opaque.vertices).toBe(big.opaque.vertices);
    expect(b.opaque.indices).toBe(big.opaque.indices);
    expect(Array.from(b.opaque.vertices.subarray(0, b.opaque.vertexCount * 6))).toEqual(Array.from(copy));
    expect(b.opaque.indexCount).toBe(a.opaque.indexCount);
  });

  it('mais de 65.535 vértices numa malha passa para índices u32', () => {
    const g = createWorldGrid(64, 32, 64);
    // Xadrez 3D: nada funde, ~6 faces por célula ocupada.
    for (let y = 0; y < 32; y++)
      for (let z = 0; z < 64; z++) for (let x = 0; x < 64; x++) if ((x + y + z) % 2 === 0) g.set(x, y, z, CONCRETE);
    const m = mesh(g);
    expect(m.opaque.vertexCount).toBeGreaterThan(0xffff);
    expect(m.opaque.indices).toBeInstanceOf(Uint32Array);
  });
});
