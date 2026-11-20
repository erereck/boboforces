import { BOBO_NAV_METRICS } from '@boboforces/sim';
import { cellRotation } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { barnDoor, container, CONTAINER_COLORS, harborWater, towerCrane } from '../../../assets-src/maps/kit.ts';
import { loadBlockTable } from './blocks.ts';
import { createMapBuilder } from './builder.ts';

/** M10 (fase 0): as montagens do kit dos mapas novos (`assets-src/maps/kit.ts`) numa grade pequena. */
describe('kit dos mapas novos', () => {
  const fresh = (): ReturnType<typeof createMapBuilder> => {
    const h = createMapBuilder('kit-teste');
    h.builder.size(48, 48, 48);
    return h;
  };

  it('contêiner em X: o corpo, a fatia da porta girada nas duas pontas e o topo para empilhar', () => {
    const h = fresh();
    const b = h.builder;
    const top = container(b, { x: 1, y: 0, z: 1, along: 'x', color: 'red' });
    expect(top).toBe(2.5);
    // 6 × 2,5 × 2,5 m a partir de (1, 0, 1): células x 2..13, y 0..4, z 2..6.
    expect(b.get(2, 0, 2)).toBe('container-red-door');
    expect(b.get(13, 4, 6)).toBe('container-red-door');
    expect(b.get(3, 2, 4)).toBe('container-red');
    expect(b.get(12, 4, 6)).toBe('container-red');
    expect(b.get(14, 0, 2)).toBeNull();
    expect(b.get(2, 5, 2)).toBeNull();
    // Empilha em cima, em Z, com a porta só no começo (o menor z).
    container(b, { x: 2, y: top, z: 0, along: 'z', color: 'tan', doors: 'start' });
    expect(b.get(4, 5, 0)).toBe('container-tan-door');
    expect(b.get(4, 5, 11)).toBe('container-tan');
    const grid = h.finish().grid;
    // A porta em X gira 1 quarto (as faces ±Z da forma canônica viram ±X); em Z fica no giro 0.
    expect(cellRotation(grid.get(2, 0, 2))).toBe(1);
    expect(cellRotation(grid.get(4, 5, 0))).toBe(0);
  });

  it('porta de celeiro: xadrez A/B contado de cima (cada 2×2 é um X)', () => {
    const h = fresh();
    const b = h.builder;
    barnDoor(b, 2, 1, 3, 'x', 2, 2);
    // Fileira de cima (y = 3): A no menor x, B no maior; a de baixo troca.
    expect([b.get(4, 3, 6), b.get(5, 3, 6), b.get(6, 3, 6), b.get(7, 3, 6)]).toEqual([
      'barn-door-a',
      'barn-door-b',
      'barn-door-a',
      'barn-door-b',
    ]);
    expect([b.get(4, 2, 6), b.get(5, 2, 6)]).toEqual(['barn-door-b', 'barn-door-a']);
    barnDoor(b, 10, 0, 2, 'z', 1, 1);
    expect([b.get(20, 1, 4), b.get(20, 1, 5), b.get(20, 0, 4)]).toEqual(['barn-door-a', 'barn-door-b', 'barn-door-b']);
  });

  it('guindaste: mastro, lança, contrapeso, cabo e o caixote pendurado', () => {
    const h = fresh();
    const b = h.builder;
    const jibTop = towerCrane(b, { x: 5, y: 0, z: 2, height: 10, dir: '+x', jib: 8, hook: { at: 4, drop: 4 } });
    expect(jibTop).toBe(11);
    // Mastro de 1 × 1 m (células x 10..11, z 4..5) do chão até 2 m acima da lança, passando por ela.
    expect(b.get(10, 0, 4)).toBe('crane-lattice');
    expect(b.get(11, 21, 5)).toBe('crane-lattice');
    expect(b.get(10, 25, 4)).toBe('crane-lattice');
    expect(b.get(10, 26, 4)).toBeNull();
    // Lança de 8 m a partir da face do mastro (x = 6 m): células x 12..27 na altura de 10 m.
    expect(b.get(27, 20, 4)).toBe('crane-lattice');
    expect(b.get(28, 20, 4)).toBeNull();
    // Contralança de 3 m para −X e o contrapeso de 1,5 m pendurado na ponta dela.
    expect(b.get(4, 20, 4)).toBe('crane-lattice');
    expect(b.get(4, 19, 4)).toBe('concrete');
    expect(b.get(4, 16, 4)).toBeNull();
    // Cabo a 4 m da face (x = 10 m → célula 20) do fundo da lança até 4 m abaixo; o caixote de 1,5 m embaixo.
    expect(b.get(20, 19, 4)).toBe('crane-cable');
    expect(b.get(20, 12, 4)).toBe('crane-cable');
    expect(b.get(20, 11, 4)).toBe('crate');
    expect(b.get(19, 9, 3)).toBe('crate');
    expect(b.get(20, 8, 4)).toBeNull();
  });

  it('erro de uso lança (o mapc reprova o mapa): gancho fora da lança e porta de celeiro de largura quebrada', () => {
    const b = fresh().builder;
    const crane = { x: 5, y: 0, z: 2, height: 10, dir: '+x', jib: 8 } as const;
    expect(() => towerCrane(b, { ...crane, hook: { at: 0.5, drop: 2 } })).toThrow(/gancho/);
    expect(() => towerCrane(b, { ...crane, hook: { at: 8, drop: 2 } })).toThrow(/gancho/);
    expect(() => towerCrane(b, { ...crane, hook: { at: 7.5, drop: 2 } })).not.toThrow();
    expect(() => barnDoor(b, 2, 1, 3, 'x', 1.5, 2)).toThrow(/inteiro/);
  });

  it('mar do porto: o fundo fica a mais da queda máxima da navegação abaixo do cais e o plano de morte no vão', () => {
    const h = fresh();
    const b = h.builder;
    const kill = harborWater(b, { x0: 0, z0: 20, x1: 10, z1: 24, dock: 6, surface: 5 });
    // Fundo: min(5 − 1,5; 6 − 3 − 1) = 2 m → a laje de 0,5 m em [1,5; 2); a água na célula [4,5; 5).
    expect(b.get(0, 3, 40)).toBe('dirt');
    expect(b.get(0, 4, 40)).toBeNull();
    expect(b.get(0, 9, 40)).toBe('water');
    expect(kill).toBeGreaterThan(2);
    expect(kill).toBeLessThan(4.5);
    expect(6 - 2).toBeGreaterThan(BOBO_NAV_METRICS.maxDrop);
    expect(() => harborWater(b, { x0: 0, z0: 0, x1: 1, z1: 1, dock: 3, surface: 2.5 })).toThrow(/fundo/);
  });

  it('os blocos que as montagens usam existem no blocks.json com a forma certa', () => {
    const { defs } = loadBlockTable();
    const keys = [
      ...CONTAINER_COLORS.flatMap((c) => [`container-${c}`, `container-${c}-door`]),
      'crane-lattice',
      'crane-cable',
      'barn-door-a',
      'barn-door-b',
      'crate',
      'concrete',
      'metal-panel',
      'glass',
    ];
    for (const k of keys) expect(defs.has(k), k).toBe(true);
    expect(defs.get('crane-cable')!.shape).toBe('panel');
  });
});
