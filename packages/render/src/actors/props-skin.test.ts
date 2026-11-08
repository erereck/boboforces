import {
  isPlayableProp,
  PLAYABLE_PROP_DOSE,
  PLAYABLE_PROP_DOSE_VIEW,
  PROP_DOSE,
  type PropDose,
} from '@boboforces/format';
import { describe, expect, it } from 'vitest';
import { createRenderDebug, type RenderProp } from '../types.ts';
import { GeometryBuilder, addTexturedBox } from './geometry.ts';
import { INST, INSTANCE_FLOATS } from './layout.ts';
import type { ModelBinding } from './model-geometry.ts';
import {
  buildPropGroups,
  doseIndex,
  limitGroups,
  PROP_DRAWS_PER_VIEW_SMALL,
  PROP_GROUP_SIZE_M,
  propSurfaceDistance,
  type PropGroupData,
} from './props.ts';
import { writeLayerMips } from '../texture-gpu-data.ts';

function boxBinding(id: string): ModelBinding {
  const b = new GeometryBuilder();
  addTexturedBox(
    b,
    {
      min: [-0.5, 0, -0.5],
      size: [1, 1, 1],
      inflate: 0,
      tex: [32, 32, 32],
      uv: [0, 0],
      layerSize: 64,
      mirror: false,
    },
    { layer: 1, flags: 0 },
  );
  const geometry = b.build();
  return {
    id,
    kind: 'prop',
    flags: 0,
    geometry,
    bounds: { x: 0, y: 0.5, z: 0, radius: Math.sqrt(0.75) },
    sockets: new Map(),
    debrisColor: 0x884422,
    missingLayers: [],
  };
}

const prop = (model: number, x: number, z: number, dose: number, yaw = 0): RenderProp => ({
  model,
  x,
  y: 1,
  z,
  yaw,
  scale: 1,
  dose,
});

describe('props por grupo de 32 m', () => {
  it('agrupa por modelo e célula, ordena pela dose e conta por dose vista', () => {
    const models = [boxBinding('barrel'), boxBinding('crate'), null];
    const props = [
      prop(0, 1, 1, 2),
      prop(0, 5, 3, 0),
      prop(0, 31, 31, 1),
      prop(0, 40, 1, 1),
      prop(1, 2, 2, 1),
      prop(2, 3, 3, 0), // modelo ausente: pulado
    ];
    const sampled: number[][] = [];
    const groups = buildPropGroups(props, models, (x, y, z, out, o) => {
      sampled.push([x, y, z]);
      out[o] = 0.5;
      out[o + 1] = 0.25;
      out[o + 2] = 0.125;
    });
    expect(groups.map((g) => [g.model, g.cellX, g.cellZ, g.count])).toEqual([
      [0, 0, 0, 3],
      [0, 1, 0, 1],
      [1, 0, 0, 1],
    ]);
    const first = groups[0]!;
    expect(first.countByDose).toEqual([1, 2, 3]);
    // Primeira instância = a de dose 0 (x = 5).
    expect(first.matrices[12]).toBe(5);
    expect(first.data[INST.sky]).toBe(0.5);
    expect(first.data[INSTANCE_FLOATS + INST.emissive]).toBe(0.125);
    expect(sampled.length).toBe(5);
    // Luz amostrada no centro da esfera do modelo (y = 1 + 0,5).
    expect(sampled[0]![1]).toBeCloseTo(1.5);
    expect(first.radius).toBeGreaterThan(Math.hypot(26, 30) / 2);
    expect(PROP_GROUP_SIZE_M).toBe(32);
    expect([doseIndex('blocks'), doseIndex('proposal'), doseIndex('double')]).toEqual([0, 1, 2]);
  });

  it('acima do teto da vista, ficam os grupos mais perto', () => {
    const visible = new Uint8Array([1, 1, 0, 1, 1]);
    const dist = new Float32Array([50, 10, 5, 30, 20]);
    const order = new Int32Array(5);
    expect(limitGroups(visible, dist, order, 5, 2)).toBe(2);
    expect([...visible]).toEqual([0, 1, 0, 0, 1]);
    const all = new Uint8Array([1, 1]);
    expect(limitGroups(all, new Float32Array([1, 2]), new Int32Array(2), 2, 15)).toBe(2);
  });

  it('a dose vista amarrada à do jogo (#52): o padrão da depuração mostra exatamente as props que colidem', () => {
    expect(doseIndex('blocks')).toBe(PROP_DOSE.always);
    expect(doseIndex('proposal')).toBe(PROP_DOSE.proposal);
    expect(doseIndex('double')).toBe(PROP_DOSE.double);
    expect(createRenderDebug().propDose).toBe(PLAYABLE_PROP_DOSE_VIEW);
    expect(doseIndex(PLAYABLE_PROP_DOSE_VIEW)).toBe(PLAYABLE_PROP_DOSE);
    const props: RenderProp[] = [];
    for (let i = 0; i < 30; i++) props.push(prop(i % 2, (i * 7) % 90, (i * 13) % 70, i % 3));
    const groups = buildPropGroups(props, [boxBinding('barrel'), boxBinding('crate')], null);
    const shown = groups.reduce((n, g) => n + g.countByDose[doseIndex(PLAYABLE_PROP_DOSE_VIEW)], 0);
    expect(shown).toBe(props.filter((p) => isPlayableProp({ dose: p.dose as PropDose })).length);
    expect(shown).toBe(30);
  });
});

/** Grupo sintético só com a esfera (o teto olha só para ela). */
function sphereGroup(x: number, y: number, z: number, radius: number): PropGroupData {
  return {
    model: 0,
    cellX: 0,
    cellZ: 0,
    count: 1,
    matrices: new Float32Array(16),
    data: new Float32Array(INSTANCE_FLOATS),
    countByDose: [1, 1, 1],
    sphereX: x,
    sphereY: y,
    sphereZ: z,
    radius,
  };
}

/** Corta como o passe: distância à superfície + `limitGroups` com o teto do Switch 3–4P. */
function cutBySurface(groups: readonly PropGroupData[], cx: number, cy: number, cz: number, cap: number): Uint8Array {
  const visible = new Uint8Array(groups.length).fill(1);
  const dist = new Float32Array(groups.length);
  groups.forEach((g, i) => (dist[i] = propSurfaceDistance(g, cx, cy, cz)));
  limitGroups(visible, dist, new Int32Array(groups.length), groups.length, cap);
  return visible;
}

describe('teto de draw calls de props pela superfície do grupo (#52)', () => {
  it('distância à superfície da esfera, 0 dentro dela', () => {
    const g = sphereGroup(20, 0, 0, 15.7);
    expect(propSurfaceDistance(g, 0, 0, 0)).toBeCloseTo(4.3, 5);
    expect(propSurfaceDistance(g, 18, 0, 0)).toBe(0);
  });

  it('grupo grande com prop a poucos metros não perde para grupos pequenos mais longe', () => {
    // 9 grupos pequenos a 12 m (superfície 11 m) e um grupo de 32 m com o centro a 20 m (superfície 4,3 m).
    const groups = Array.from({ length: 9 }, (_, i) => {
      const a = (i / 9) * Math.PI - Math.PI / 2;
      return sphereGroup(Math.sin(a) * 12, 0, -Math.cos(a) * 12, 1);
    });
    groups.push(sphereGroup(0, 0, -20, 15.7));
    const cap = PROP_DRAWS_PER_VIEW_SMALL;
    expect(cap).toBe(8);
    const visible = cutBySurface(groups, 0, 0, 0, cap);
    expect(visible[9]).toBe(1);
    expect(visible.reduce((n, v) => n + v, 0)).toBe(cap);
    // Pelo centro (como era), o grupo grande seria o cortado.
    const byCenter = new Uint8Array(groups.length).fill(1);
    const centers = Float32Array.from(groups, (g) => Math.hypot(g.sphereX, g.sphereY, g.sphereZ));
    limitGroups(byCenter, centers, new Int32Array(groups.length), groups.length, cap);
    expect(byCenter[9]).toBe(0);
  });

  it('com teto 8, grupo com superfície ≤ 10 m nunca é cortado (até 8 deles) e nenhum cortado fica mais perto', () => {
    // Sorteio determinístico (LCG): cenas de 10 a 30 grupos de 32 m (raio até 16 m) num quadrado de 60 m.
    let seed = 0x5eed;
    const rand = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    const cap = PROP_DRAWS_PER_VIEW_SMALL;
    let checked = 0;
    let centerWouldCut = 0;
    for (let scene = 0; scene < 400; scene++) {
      const n = 10 + Math.floor(rand() * 21);
      const groups = Array.from({ length: n }, () =>
        sphereGroup((rand() - 0.5) * 60, rand() * 6, (rand() - 0.5) * 60, 0.5 + rand() * 15.5),
      );
      const cam = [(rand() - 0.5) * 40, 1.425, (rand() - 0.5) * 40] as const;
      const visible = cutBySurface(groups, cam[0], cam[1], cam[2], cap);
      const surface = groups.map((g) => propSurfaceDistance(g, cam[0], cam[1], cam[2]));
      const near = surface.filter((d) => d <= 10).length;
      if (near <= cap) {
        checked++;
        surface.forEach((d, i) => {
          if (d <= 10) expect(visible[i], `cena ${scene}, grupo ${i} a ${d.toFixed(2)} m`).toBe(1);
        });
        // O corte antigo (pelo centro) na mesma cena: conta quando ele esconderia um grupo a ≤ 10 m.
        const byCenter = new Uint8Array(n).fill(1);
        const centers = Float32Array.from(groups, (g) =>
          Math.hypot(g.sphereX - cam[0], g.sphereY - cam[1], g.sphereZ - cam[2]),
        );
        limitGroups(byCenter, centers, new Int32Array(n), n, cap);
        if (surface.some((d, i) => d <= 10 && byCenter[i] === 0)) centerWouldCut++;
      }
      const kept = surface.filter((_, i) => visible[i] === 1);
      const cut = surface.filter((_, i) => visible[i] === 0);
      if (cut.length > 0) expect(Math.max(...kept)).toBeLessThanOrEqual(Math.min(...cut));
    }
    // 348 cenas conferidas; pelo centro, 77 delas cortariam grupo a ≤ 10 m (o teste pega a volta do bug).
    expect(checked).toBeGreaterThan(300);
    expect(centerWouldCut).toBeGreaterThan(50);
  });
});

describe('mips da camada com cobertura de alfa', () => {
  it('a camada externa não some de longe (cobertura parecida em todos os níveis)', () => {
    const size = 64;
    const level0 = new Uint8Array(size * size * 4);
    // Grade fina de 1 px opaco a cada 2 (cobertura 25%): a média simples daria alfa 64 (< 0,5) e sumiria.
    for (let y = 0; y < size; y += 2) {
      for (let x = 0; x < size; x += 2) {
        const o = (y * size + x) * 4;
        level0.set([200, 100, 50, 255], o);
      }
    }
    // Uma implementação só (integração do M1): o `writeLayerMips` da render-mundo, o mesmo do `writeModelLayer`.
    const levels = [level0];
    for (let k = 1; k < 7; k++) levels.push(new Uint8Array((size >> k) * (size >> k) * 4));
    writeLayerMips(levels, size, 0, true);
    const mips = levels.slice(1);
    expect(mips.length).toBe(6);
    expect(mips[0]!.length).toBe(32 * 32 * 4);
    const coverage = (d: Uint8Array) => {
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i]! >= 128) n++;
      return n / (d.length / 4);
    };
    expect(coverage(mips[0]!)).toBeGreaterThan(0.15);
    // Cor média ponderada pelo alfa: sem halo escuro.
    expect(mips[0]![0]).toBe(200);
    expect(mips[5]!.length).toBe(4);
  });
});
