import { createBlockRegistry, createWorldGrid, NORMAL } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import type { AssembledTextureArray, RenderMap } from '../types.ts';
import { blockTexelColor, cellVariant, FALLBACK_DEBRIS_COLOR, jitterColor, lightenColor } from './colors.ts';
import {
  createParticleRing,
  createParticleSpec,
  emitParticle,
  markParticlesUploaded,
  PARTICLE_FLOATS,
  particleAlive,
  particlePosition,
} from './particles.ts';
import { PARTICLE_KIND } from './shader.ts';

describe('anéis de partículas', () => {
  it('escreve na hora de nascer, marca a faixa suja e codifica tipo + dono', () => {
    const ring = createParticleRing(4);
    const s = createParticleSpec();
    s.kind = PARTICLE_KIND.star;
    s.owner = 2;
    s.x = 1;
    s.vy = 2;
    s.gravity = 4;
    s.life = 0.5;
    expect(emitParticle(ring, s, 10)).toBe(0);
    expect(emitParticle(ring, s, 10)).toBe(1);
    expect([ring.dirtyMin, ring.dirtyMax, ring.written]).toEqual([0, 1, 2]);
    expect(ring.data[18]).toBe(PARTICLE_KIND.star + 16 * 3);
    expect(ring.data[16]).toBe(10);
    expect(ring.aliveUntil).toBeCloseTo(10.5);
    // Posição pela mesma conta do vertex shader.
    const p = new Float32Array(3);
    particlePosition(ring, 0, 10.5, p);
    expect(p[1]).toBeCloseTo(2 * 0.5 - 0.5 * 4 * 0.25);
    expect(particleAlive(ring, 0, 10.2)).toBe(true);
    expect(particleAlive(ring, 0, 10.6)).toBe(false);
    markParticlesUploaded(ring);
    // Volta no anel no mesmo frame: sobe tudo.
    s.owner = -1;
    for (let i = 0; i < 3; i++) emitParticle(ring, s, 11);
    expect([ring.dirtyMin, ring.dirtyMax, ring.written]).toEqual([0, 3, 4]);
    expect(ring.data[PARTICLE_FLOATS * 3 + 18]).toBe(PARTICLE_KIND.star);
  });
});

function solidLayer(size: number, layers: number, paint: (layer: number, x: number, y: number) => number): Uint8Array {
  const data = new Uint8Array(size * size * 4 * layers);
  for (let l = 0; l < layers; l++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const rgb = paint(l, x, y);
        const o = ((l * size + y) * size + x) * 4;
        data[o] = (rgb >> 16) & 0xff;
        data[o + 1] = (rgb >> 8) & 0xff;
        data[o + 2] = rgb & 0xff;
        data[o + 3] = rgb < 0 ? 0 : 255;
      }
    }
  }
  return data;
}

function arrayOf(
  name: 'blocos16' | 'modelos64',
  size: number,
  layers: number,
  data: Uint8Array,
): AssembledTextureArray {
  return {
    name,
    data: { width: size, height: size, layers, levels: [data] },
    layers: new Map(),
    info: [],
    reservedStart: layers,
    reservedCount: 0,
  };
}

describe('cor do cubinho no texel atingido', () => {
  it('bloco: a mesma UV do shader (p·T, p·B)·2 e a variante da célula', () => {
    // Camada 0: cor = coluna; camada 1 e 2: variantes com cor fixa.
    const blocks = arrayOf(
      'blocos16',
      16,
      3,
      solidLayer(16, 3, (l, x) => (l === 0 ? x * 0x10 : l === 1 ? 0x112233 : 0x445566)),
    );
    const registry = createBlockRegistry([
      { key: 'plain', shape: 'cube', faces: [0, 0, 0, 0, 0, 0], flags: 1, frames: 1, stepSound: '' },
      { key: 'varied', shape: 'cube', faces: [1, 1, 1, 1, 1, 1], flags: 1, frames: 1, variants: 2, stepSound: '' },
    ]);
    const blockFaceLayers = new Uint8Array(3 * 6);
    blockFaceLayers.fill(0, 6, 12);
    blockFaceLayers.fill(1, 12, 18);
    const map = { blocks: registry, blockFaceLayers, props: [] } as unknown as RenderMap;
    // Topo (+Y): T = +X; x = 0,25 m → u = 0,5 → coluna 8.
    const c = blockTexelColor(blocks, map, 1, NORMAL.py, 0.25, 1, 0.1, 0, 1, 0, 0, 0);
    expect(c).toBe(8 * 0x10);
    expect(blockTexelColor(blocks, map, 1, NORMAL.py, 0.25, 1, 0.1, 0, 1, 0, 2, 0)).toBe(10 * 0x10);
    // Variante pelo hash da célula (igual ao shader).
    const v = blockTexelColor(blocks, map, 2, NORMAL.py, 0.25, 1, 0.1, 0, 1, 0, 0, 0);
    const variant = cellVariant(0, 1, 0, 2);
    expect(v).toBe(variant === 0 ? 0x112233 : 0x445566);
    expect(blockTexelColor(null, map, 1, 2, 0, 0, 0, 0, 1, 0, 0, 0)).toBe(FALLBACK_DEBRIS_COLOR);
    expect(blockTexelColor(blocks, map, 0, 2, 0, 0, 0, 0, 1, 0, 0, 0)).toBe(FALLBACK_DEBRIS_COLOR);
    void createWorldGrid;
  });

  it('variação e poeira mudam o brilho sem sair de 0..255', () => {
    expect(jitterColor(0x808080, 0.1, 1)).toBe(0x8d8d8d);
    expect(jitterColor(0xffffff, 0.5, 1)).toBe(0xffffff);
    expect(lightenColor(0x000000, 0.5)).toBe(0x808080);
  });
});
