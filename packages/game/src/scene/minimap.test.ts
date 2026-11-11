import { createDrawList } from '@boboforces/ui';
import {
  BLOCK_FLAG,
  createBlockRegistry,
  createStaticColliders,
  createWorldGrid,
  fillBox,
  makeCell,
} from '@boboforces/world';
import { ENTITY_KIND, type SimView } from '@boboforces/sim';
import { describe, expect, it } from 'vitest';
import { buildMinimapPlan, drawMinimap, MINIMAP } from './minimap.ts';

/** M3, fase 7a: o minimapa do quadrante livre. */

const SOLID = BLOCK_FLAG.solid | BLOCK_FLAG.blocksBullets | BLOCK_FLAG.blocksSight | BLOCK_FLAG.walkable;
const blocks = createBlockRegistry([
  { key: 'concrete', shape: 'cube', faces: [1, 1, 1, 1, 1, 1], flags: SOLID, frames: 1, stepSound: 'concrete' },
]);
const concrete = makeCell(blocks.byKey('concrete')!.id);

/** 20 × 20 m (40 × 40 células), chão na camada 0, uma parede em L de 2 m de altura e um pilar baixo (0,5 m). */
function world() {
  const g = createWorldGrid(40, 12, 40);
  fillBox(g, 0, 0, 0, 39, 0, 39, concrete);
  fillBox(g, 4, 1, 10, 29, 4, 10, concrete);
  fillBox(g, 4, 1, 11, 4, 4, 30, concrete);
  fillBox(g, 30, 1, 30, 31, 1, 31, concrete);
  return g;
}

describe('minimapa (M3, fase 7a)', () => {
  it('a planta: as paredes de 1–1,5 m viram poucos retângulos; o pilar baixo fica de fora', () => {
    const plan = buildMinimapPlan(world(), blocks, null, null);
    expect([plan.minX, plan.minZ, plan.maxX, plan.maxZ]).toEqual([0, 0, 20, 20]);
    // O L: a linha de cima (x 4..29, z 10) e a coluna (x 4, z 11..30) = 2 retângulos.
    expect(plan.walls).toBe(2);
    expect(Array.from(plan.rects.subarray(0, 8))).toEqual([2, 5, 15, 5.5, 2, 5.5, 2.5, 15.5]);
  });

  it('as props altas entram (as janelas e portas, sem dono, não); a área de jogo recorta', () => {
    const boxes = new Float32Array([1, 0.5, 1, 2, 2.5, 2, 6, 0.5, 6, 7, 1, 7, 3, 0.5, 3, 4, 3, 4]);
    const colliders = createStaticColliders({
      boxes,
      flags: new Uint8Array([1, 1, 1]),
      owner: new Int32Array([0, 1, -1]),
      count: 3,
    });
    const plan = buildMinimapPlan(world(), blocks, { minX: 0, minZ: 0, maxX: 10, maxZ: 10 }, colliders);
    // Só a 1ª prop (2 m acima do chão); a 2ª tem 0,5 m e a 3ª é uma porta.
    expect(plan.count - plan.walls).toBe(1);
    expect(plan.maxX).toBe(10);
  });

  it('desenha o chão, a planta e os pontos sem passar da área', () => {
    const plan = buildMinimapPlan(world(), blocks, null, null);
    const view = {
      count: 3,
      alive: new Uint8Array([1, 1, 1]),
      flags: new Uint32Array(3),
      kind: new Uint8Array([ENTITY_KIND.bobo, ENTITY_KIND.zombie, ENTITY_KIND.bobo]),
      team: new Uint8Array([0, 255, 0]),
      position: new Float32Array([5, 0.5, 5, 10, 0.5, 10, 15, 0.5, 15]),
      yaw: new Float64Array(3),
      mapObjects: null,
    } as unknown as SimView;
    const list = createDrawList(256);
    const frame = {
      x: 100,
      y: 50,
      width: 200,
      height: 100,
      scale: 1,
      locals: [0],
      localColors: [0xff0000ff],
      allyTeam: 0,
      zombies: true,
    };
    drawMinimap(list, plan, view, frame);
    // Chão + 2 paredes + zumbi + aliado + o local (contorno, ponto e o risquinho).
    expect(list.count).toBe(1 + 2 + 1 + 1 + 3);
    for (let i = 0; i < list.count; i++) {
      const x = list.geom[i * 8]!;
      const y = list.geom[i * 8 + 1]!;
      expect(x).toBeGreaterThanOrEqual(100 - 8);
      expect(x).toBeLessThanOrEqual(300);
      expect(y).toBeGreaterThanOrEqual(50 - 8);
      expect(y).toBeLessThanOrEqual(150);
    }
    // Sem zumbis no modo (Warfare), o zumbi não aparece.
    const warfare = createDrawList(256);
    drawMinimap(warfare, plan, view, { ...frame, zombies: false });
    expect(warfare.count).toBe(list.count - 1);
    expect(MINIMAP.maxRects).toBeGreaterThan(plan.count);
  });
});
