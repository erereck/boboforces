import { angleDelta } from '@boboforces/shared';
import { cellCenter, createTestBlocks, createWorldGrid, fillBox, makeCell } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { openSpawnYaw } from './spawn-facing.ts';

/**
 * M12 (fase 7b): o nascido olha para o lado aberto. Chão de 40 × 40 m (piso a 0,5 m); o ponto em (10, 20) olhando
 * para +X (yaw −π/2).
 */

const blocks = createTestBlocks();
const concrete = makeCell(blocks.byKey('concrete')!.id);
const AREA = { minX: 0, maxX: 40, minZ: 0, maxZ: 40 };
const EAST = -Math.PI / 2;
const X = cellCenter(20);
const Z = cellCenter(40);

function field(build?: (grid: ReturnType<typeof createWorldGrid>) => void) {
  const grid = createWorldGrid(80, 16, 80);
  fillBox(grid, 0, 0, 0, 79, 0, 79, concrete);
  build?.(grid);
  return grid;
}

describe('o yaw de nascimento (M12, fase 7b)', () => {
  it('com a vista livre à frente, fica o do marcador', () => {
    const grid = field();
    expect(openSpawnYaw(grid, blocks, null, AREA, X, 0.5, Z, EAST)).toBe(EAST);
  });

  it('de cara para uma parede a 2 m, vira para o lado aberto mais perto do rumo do marcador', () => {
    // Parede de 3 m em x = 12 m, de z = 10 a 30 m (o abrigo do Ringue); o lado de cá (x < 12) é livre.
    const grid = field((g) => fillBox(g, 24, 1, 20, 24, 6, 59, concrete));
    const yaw = openSpawnYaw(grid, blocks, null, AREA, X, 0.5, Z, EAST);
    // Não olha mais para a parede (±60° do leste)...
    expect(Math.abs(angleDelta(yaw, EAST))).toBeGreaterThan(Math.PI / 3);
    // ...nem para trás (o oeste, a 10 m da borda da área, é mais curto que o corredor ao norte e ao sul).
    expect(Math.abs(angleDelta(yaw, Math.PI / 2))).toBeGreaterThan(Math.PI / 4);
  });

  it('num nicho de 3 lados, olha para a saída', () => {
    // Nicho de 2 m: paredes ao leste (x = 11), ao norte (z = 19) e ao sul (z = 21); aberto para o oeste.
    const grid = field((g) => {
      fillBox(g, 22, 1, 37, 22, 6, 43, concrete);
      fillBox(g, 16, 1, 37, 22, 6, 37, concrete);
      fillBox(g, 16, 1, 43, 22, 6, 43, concrete);
    });
    const yaw = openSpawnYaw(grid, blocks, null, AREA, X, 0.5, Z, EAST);
    expect(Math.abs(angleDelta(yaw, Math.PI / 2))).toBeLessThan(0.01);
  });

  it('determinístico e no intervalo (−π, π]', () => {
    const grid = field((g) => fillBox(g, 24, 1, 20, 24, 6, 59, concrete));
    const a = openSpawnYaw(grid, blocks, null, AREA, X, 0.5, Z, EAST);
    const b = openSpawnYaw(grid, blocks, null, AREA, X, 0.5, Z, EAST);
    expect(b).toBe(a);
    expect(a).toBeGreaterThan(-Math.PI);
    expect(a).toBeLessThanOrEqual(Math.PI);
  });
});
