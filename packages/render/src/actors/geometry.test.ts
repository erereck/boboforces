import {
  FIGURE_PX_M,
  FIGURE_SWATCH,
  figureSwatchCorner,
  MODEL_FLAG,
  MODEL_FORMAT,
  type ModelDocument,
} from '@boboforces/format';
import { describe, expect, it } from 'vitest';
import type { GeometryArrays } from './geometry.ts';
import { LAYER_FROM_INSTANCE, VERT_COMPONENTS, VERTEX_FLAG } from './layout.ts';
import { buildModelBinding } from './model-geometry.ts';
import {
  buildFigureArmGeometry,
  buildViewmodelGeometry,
  VIEWMODEL_FIGURE_ARM,
  VIEWMODEL_POSE,
  viewmodelAimOffset,
} from './viewmodel.ts';

/** Triângulos com a normal geométrica (pela ordem dos índices) e a normal do vértice. */
function triangles(g: GeometryArrays): { geometric: number[]; vertex: number[] }[] {
  const out: { geometric: number[]; vertex: number[] }[] = [];
  for (let t = 0; t < g.indexCount; t += 3) {
    const [a, b, c] = [g.indices[t]!, g.indices[t + 1]!, g.indices[t + 2]!];
    const p = (i: number) => [g.positions[i * 3]!, g.positions[i * 3 + 1]!, g.positions[i * 3 + 2]!];
    const [pa, pb, pc] = [p(a), p(b), p(c)];
    const u = [pb[0]! - pa[0]!, pb[1]! - pa[1]!, pb[2]! - pa[2]!];
    const v = [pc[0]! - pa[0]!, pc[1]! - pa[1]!, pc[2]! - pa[2]!];
    const geometric = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
    out.push({ geometric, vertex: [g.normals[a * 3]!, g.normals[a * 3 + 1]!, g.normals[a * 3 + 2]!] });
  }
  return out;
}

const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;

function synthModel(overrides: Partial<ModelDocument> = {}): ModelDocument {
  return {
    format: MODEL_FORMAT,
    id: 'rifle',
    kind: 'weapon',
    flags: 0,
    parts: [
      {
        name: 'body',
        parent: -1,
        pivot: [0, 0, 0],
        boxes: [{ origin: [-2, -2, -16], size: [4, 4, 20], uv: [0, 0], layer: 'metal', inflate: 0, mirror: false }],
        meshes: [],
      },
      {
        name: 'mag',
        parent: 0,
        pivot: [0, -2, -4],
        boxes: [
          { origin: [-1, -6, 0], size: [2, 6, 3], uv: [0, 40], layer: 'missing_layer', inflate: 0, mirror: true },
        ],
        meshes: [],
      },
    ],
    sockets: [
      { name: 'hand_r', part: 0, position: [0, -2, 0], direction: [0, 0, -1] },
      { name: 'muzzle', part: 0, position: [0, 0, -16], direction: [0, 0, -2] },
      { name: 'sight', part: 0, position: [0, 2, -4], direction: [0, 0, -1] },
    ],
    colliders: [],
    light: null,
    debrisColor: 0x333333,
    blocksNav: false,
    ...overrides,
  };
}

describe('modelo .bfmodel', () => {
  const layers = new Map([['metal', { index: 7, cutout: false, emissive: false }]]);
  const lookup = (name: string) => layers.get(name) ?? null;

  it('caixas em metros a 32 texels/m, camadas por nome e soquetes no espaço do modelo', () => {
    const b = buildModelBinding(synthModel(), lookup);
    expect(b.geometry.indexCount / 3).toBe(24);
    expect(b.missingLayers).toEqual(['missing_layer']);
    let minZ = Infinity;
    const layersUsed = new Set<number>();
    for (let i = 0; i < b.geometry.vertexCount; i++) {
      minZ = Math.min(minZ, b.geometry.positions[i * 3 + 2]!);
      layersUsed.add(b.geometry.verts[i * VERT_COMPONENTS]!);
    }
    expect(minZ).toBeCloseTo(-16 / 32);
    expect([...layersUsed].sort()).toEqual([0, 7]);
    expect(b.sockets.get('hand_r')).toMatchObject({ x: 0, y: -2 / 32, z: 0 });
    const muzzle = b.sockets.get('muzzle')!;
    expect(muzzle.z).toBeCloseTo(-0.5);
    expect(muzzle.dz).toBeCloseTo(-1);
    expect(b.bounds.radius).toBeGreaterThan(0.3);
  });

  it('peça filha soma o pivô da mãe; vento só nos modelos que balançam', () => {
    const still = buildModelBinding(synthModel(), lookup);
    const tree = buildModelBinding(synthModel({ kind: 'prop', flags: MODEL_FLAG.swaysInWind }), lookup);
    let maxSway = 0;
    for (let i = 0; i < tree.geometry.vertexCount; i++) {
      expect(still.geometry.verts[i * VERT_COMPONENTS + 2]).toBe(0);
      maxSway = Math.max(maxSway, tree.geometry.verts[i * VERT_COMPONENTS + 2]!);
    }
    expect(maxSway).toBeCloseTo(1);
    // O pente (pivô -2, -4 sob o corpo) desce até y = (-2 - 6) / 32.
    let minY = Infinity;
    for (let i = 0; i < still.geometry.vertexCount; i++) minY = Math.min(minY, still.geometry.positions[i * 3 + 1]!);
    expect(minY).toBeCloseTo(-8 / 32);
  });

  it('camada cutout liga o alpha test; emissiva acende a luz cheia', () => {
    const special = (name: string) =>
      name === 'metal' ? { index: 3, cutout: true, emissive: true } : { index: 0, cutout: false, emissive: false };
    const b = buildModelBinding(synthModel(), special);
    expect(b.geometry.verts[1]! & VERTEX_FLAG.alphaTest).toBe(VERTEX_FLAG.alphaTest);
    expect(b.geometry.verts[1]! & VERTEX_FLAG.emissive).toBe(VERTEX_FLAG.emissive);
  });

  it('ADS do viewmodel: o deslocamento põe a mira (sight) no centro da tela', () => {
    const offset = viewmodelAimOffset(synthModel())!;
    expect(offset.x).toBeCloseTo(-VIEWMODEL_POSE.hand[0]);
    // sight 2 texels acima do corpo, hand_r 2 abaixo: a mira fica 4/32 m acima da mão.
    expect(offset.y).toBeCloseTo(-(VIEWMODEL_POSE.hand[1] + 4 / 32));
    expect(viewmodelAimOffset(synthModel({ sockets: [] }))).toBeNull();
  });

  it('viewmodel: arma + os dois braços do boneco (camada da instância) num buffer só, encostados no soquete', () => {
    const weapon = buildModelBinding(synthModel(), lookup);
    const vm = buildViewmodelGeometry(weapon);
    const arm = buildFigureArmGeometry();
    let armVerts = 0;
    let nearestToHand = Infinity;
    for (let i = 0; i < vm.vertexCount; i++) {
      // Braços: a 1ª camada da skin do dono (a da instância).
      if (vm.verts[i * VERT_COMPONENTS]! >= 0) continue;
      expect(vm.verts[i * VERT_COMPONENTS]).toBe(LAYER_FROM_INSTANCE);
      armVerts++;
      const p = [vm.positions[i * 3]!, vm.positions[i * 3 + 1]!, vm.positions[i * 3 + 2]!];
      nearestToHand = Math.min(nearestToHand, Math.hypot(p[0]!, p[1]! + 2 / 32, p[2]!));
    }
    expect(armVerts).toBe(2 * arm.vertexCount);
    // O fim do braço direito encosta no soquete hand_r.
    expect(nearestToHand).toBeLessThan(0.15);
    // Caixas viradas para fora (a ordem dos índices bate com a normal).
    for (const t of triangles(arm)) expect(dot(t.geometric, t.vertex)).toBeGreaterThan(0);
  });

  it('viewmodel do boneco do FutBobo (#56): manga, antebraço e mão por braço, na amostra da paleta, 0,596 m', () => {
    const weapon = buildModelBinding(synthModel(), lookup);
    const vm = buildViewmodelGeometry(weapon);
    const arm = buildFigureArmGeometry();
    expect(arm.vertexCount).toBe(3 * 24);
    expect(vm.vertexCount).toBe(weapon.geometry.vertexCount + 2 * arm.vertexCount);
    expect(VIEWMODEL_FIGURE_ARM.armLength).toBeCloseTo(0.596, 3);
    // Cada caixa lê o centro do texel da sua amostra (manga 8 na manga e no antebraço, a manga comprida da farda da #58;
    // mão 7, a luva) na 1ª camada da skin do dono.
    const swatches = VIEWMODEL_FIGURE_ARM.boxes.map((b) => figureSwatchCorner(b.swatch));
    expect(VIEWMODEL_FIGURE_ARM.boxes.map((b) => b.swatch)).toEqual([
      FIGURE_SWATCH.sleeve,
      FIGURE_SWATCH.sleeve,
      FIGURE_SWATCH.hand,
    ]);
    for (let i = 0; i < arm.vertexCount; i++) {
      const corner = swatches[Math.floor(i / 24)]!;
      expect(arm.uvs[i * 2]! * 64).toBeCloseTo((corner % 64) + 0.5, 4);
      expect(arm.uvs[i * 2 + 1]! * 64).toBeCloseTo(Math.floor(corner / 64) + 0.5, 4);
      expect(arm.verts[i * VERT_COMPONENTS]).toBe(LAYER_FROM_INSTANCE);
      expect(arm.verts[i * VERT_COMPONENTS + 1]).toBe(0);
    }
    // O braço desce do ombro até 11,6 px (a ponta da mão), com o soquete a 10,9 px.
    let minY = Infinity;
    for (let i = 0; i < arm.vertexCount; i++) minY = Math.min(minY, arm.positions[i * 3 + 1]!);
    expect(minY / FIGURE_PX_M).toBeCloseTo(-11.6, 4);
  });
});
