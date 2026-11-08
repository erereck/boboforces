import { isReachable, NAV_LINK, NO_NAV_NODE } from '@boboforces/nav';
import { describe, expect, it } from 'vitest';
import { buildSyntheticConstruto, SYNTHETIC_CONSTRUTO_SIZE } from './construto.ts';
import { createTestNavPath, findTestPath } from './test-nav.ts';

/** O dublê de navegação e o Construto sintético (apoio do golden, dos testes da IA e do bench). */
describe('Construto sintético + navegação de teste', () => {
  const { map, nav } = buildSyntheticConstruto({ nav: true });

  it('tem o tamanho do Construto, spawns de TDM e FFA e área jogável', () => {
    expect(map.grid.sizeX).toBe(SYNTHETIC_CONSTRUTO_SIZE.x);
    expect(map.spawns.filter((s) => s.team === 0)).toHaveLength(6);
    expect(map.spawns.filter((s) => s.team === 1)).toHaveLength(6);
    expect(map.spawns.filter((s) => s.team === -1)).toHaveLength(16);
    expect(map.playArea!.maxX - map.playArea!.minX).toBe(72);
    expect(map.nav).toBe(nav);
  });

  it('todos os spawns caem na mesma ilha de navegação (alcançáveis uns dos outros)', () => {
    const nodes = map.spawns.map((s) => nav!.nearestNode(s.x, s.y, s.z));
    expect(nodes.every((n) => n !== NO_NAV_NODE)).toBe(true);
    for (const n of nodes) expect(isReachable(nav!, nodes[0]!, n)).toBe(true);
  });

  it('acha caminho até o alto da torre (rampa 1:2) e do telhado do galpão (rampa 1:1), com orçamento', () => {
    const path = createTestNavPath(nav!);
    const from = nav!.nearestNode(map.spawns[0]!.x, 0.5, map.spawns[0]!.z);
    for (const [x, y, z] of [
      [40, 3.5, 40], // topo da torre
      [16, 3.5, 40], // telhado do galpão
      [16, 0.5, 40], // dentro do galpão (embaixo do telhado)
      [62, 1.5, 40], // plataforma leste (escada de degraus)
    ] as const) {
      const to = nav!.nearestNode(x, y, z);
      expect(to, `${x},${y},${z}`).not.toBe(NO_NAV_NODE);
      expect(nav!.floorY[to]).toBeCloseTo(y, 0);
      let status = findTestPath(nav!, from, to, path, 50);
      let calls = 1;
      while (status === 'pending' && calls < 1000) {
        status = findTestPath(nav!, from, to, path, 50);
        calls++;
      }
      expect(status, `${x},${y},${z}`).toBe('found');
      expect(calls).toBeGreaterThan(1);
      expect(path.pointCount).toBeGreaterThan(1);
      expect(path.points[(path.pointCount - 1) * 3 + 1]).toBeCloseTo(y, 0);
      // Pontos dentro da área jogável e ligações válidas.
      for (let i = 0; i < path.pointCount; i++) {
        expect(path.points[i * 3]).toBeGreaterThan(4);
        expect(path.points[i * 3]).toBeLessThan(76);
        expect(path.pointLinks[i]).toBeLessThanOrEqual(NAV_LINK.crouch);
      }
    }
  });
});
