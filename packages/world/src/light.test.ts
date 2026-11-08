import { describe, expect, it } from 'vitest';
import { BLOCK_FLAG, createBlockRegistry, type BlockDefInput } from './blocks.ts';
import { makeCell } from './cell.ts';
import { createWorldGrid, type WorldGrid } from './grid.ts';
import {
  buildLightGrid,
  computeLight,
  createLightJob,
  sampleLightGrid,
  type LightField,
  type LightParams,
} from './light.ts';
import type { BlockShape } from './shapes.ts';

const SOLID = BLOCK_FLAG.solid | BLOCK_FLAG.blocksBullets | BLOCK_FLAG.blocksSight;
const def = (key: string, shape: BlockShape, flags = SOLID, emissive = 0): BlockDefInput => ({
  key,
  shape,
  faces: [0, 0, 0, 0, 0, 0],
  flags,
  frames: 1,
  stepSound: '',
  emissive,
});

// 1 concreto, 2 vidro, 3 lâmpada (14), 4 laje, 5 rampa, 6 painel, 7 cruz.
const registry = createBlockRegistry([
  def('concrete', 'cube'),
  def('glass', 'cube', BLOCK_FLAG.solid | BLOCK_FLAG.translucent),
  def('lamp', 'cube', SOLID | BLOCK_FLAG.emissive, 14),
  def('slab', 'slab'),
  def('ramp', 'ramp'),
  def('panel', 'panel'),
  def('grass', 'cross', BLOCK_FLAG.cutout),
]);
const C = makeCell(1);
const UP: LightParams = { sunDirX: 0, sunDirY: 1, sunDirZ: 0, emitters: [] };

function fill(g: WorldGrid, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, cell: number) {
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) g.set(x, y, z, cell);
}

/** Sala fechada de 10 × 6 × 10 por fora (paredes de 1 célula) sobre um chão, numa grade de 40 × 16 × 40. */
function room(): WorldGrid {
  const g = createWorldGrid(40, 16, 40);
  fill(g, 0, 0, 0, 39, 0, 39, C);
  fill(g, 10, 1, 10, 19, 6, 19, C);
  fill(g, 11, 1, 11, 18, 5, 18, 0);
  return g;
}

describe('luz do céu (flood fill)', () => {
  it('céu aberto é 15; sala fechada fica no escuro', () => {
    const g = room();
    const light = computeLight(g, registry, UP);
    expect(light.sky(3, 1, 3)).toBe(15);
    expect(light.sun(3, 1, 3)).toBe(1);
    expect(light.sky(14, 2, 14)).toBe(0);
    expect(light.sun(14, 2, 14)).toBe(0);
    expect(light.emissive(14, 2, 14)).toBe(0);
    // Fora da grade: céu aberto.
    expect(light.sky(-1, 5, 3)).toBe(15);
    expect(light.sun(100, 5, 3)).toBe(1);
  });

  it('pela porta, perde 1 por célula andada', () => {
    const g = room();
    fill(g, 14, 1, 10, 14, 2, 10, 0); // porta na parede -Z
    const light = computeLight(g, registry, UP);
    expect(light.sky(14, 1, 9)).toBe(15);
    expect(light.sky(14, 1, 10)).toBe(14);
    expect(light.sky(14, 1, 11)).toBe(13);
    expect(light.sky(14, 1, 15)).toBe(9);
    expect(light.sky(15, 1, 15)).toBe(8);
    expect(light.sky(14, 5, 11)).toBe(10); // subir também custa
  });

  it('telhado de rampa e de laje fecha o interior; o vidro deixa passar; a forma recebe luz na parte de ar', () => {
    for (const roof of [makeCell(5), makeCell(4), makeCell(4, 0, true)]) {
      const g = room();
      fill(g, 11, 6, 11, 18, 6, 18, roof); // troca o teto de concreto por formas
      const light = computeLight(g, registry, UP);
      expect(light.sky(14, 3, 14)).toBe(0);
      expect(light.sky(14, 6, 14)).toBe(roof === makeCell(4, 0, true) ? 0 : 15);
    }
    const g = room();
    fill(g, 11, 6, 11, 18, 6, 18, makeCell(2)); // claraboia de vidro
    const light = computeLight(g, registry, UP);
    expect(light.sky(14, 3, 14)).toBe(15);
    expect(light.sun(14, 3, 14)).toBe(1);
    // Painel e cruz também não seguram luz.
    const g2 = room();
    fill(g2, 11, 6, 11, 18, 6, 18, makeCell(6));
    expect(computeLight(g2, registry, UP).sky(14, 3, 14)).toBe(15);
  });

  it('borda X/Z da grade recebe céu de fora (o mundo termina no céu aberto)', () => {
    const g = createWorldGrid(20, 8, 20);
    fill(g, 0, 0, 0, 19, 0, 19, C);
    fill(g, 0, 4, 0, 19, 4, 19, C); // teto inteiro em y = 4: sem céu por cima
    const light = computeLight(g, registry, UP);
    expect(light.sky(0, 2, 10)).toBe(14);
    expect(light.sky(1, 2, 10)).toBe(13);
    expect(light.sky(10, 2, 10)).toBe(5); // 9 células da borda +X
  });
});

describe('luz emissiva', () => {
  it('lâmpada no escuro: nível nela, −1 por célula; fonte de prop soma', () => {
    const g = room();
    g.set(14, 3, 14, makeCell(3));
    const params: LightParams = { ...UP, emitters: [{ x: 12, y: 1, z: 12, level: 6 }] };
    const light = computeLight(g, registry, params);
    expect(light.emissive(14, 3, 14)).toBe(14);
    expect(light.emissive(15, 3, 14)).toBe(13);
    expect(light.emissive(16, 3, 14)).toBe(12);
    expect(light.emissive(15, 4, 15)).toBe(11);
    expect(light.sky(15, 3, 14)).toBe(0);
    // O cubo de concreto não recebe (parede).
    expect(light.emissive(10, 3, 14)).toBe(0);
    // Prop: nível 6 na célula, 5 ao lado (a lâmpada chega a 14 − 4 = 10 lá, então vale o maior).
    expect(light.emissive(12, 1, 12)).toBe(Math.max(6, 14 - 6));
  });
});

describe('sol (varredura na direção do sol)', () => {
  it('sol a pino: sombra logo abaixo; sol inclinado: sombra deslocada para longe do sol', () => {
    const g = createWorldGrid(32, 16, 32);
    fill(g, 0, 0, 0, 31, 0, 31, C);
    g.set(16, 10, 16, C);
    const up = computeLight(g, registry, UP);
    expect(up.sun(16, 9, 16)).toBe(0);
    expect(up.sun(16, 1, 16)).toBe(0);
    expect(up.sun(17, 9, 16)).toBe(1);
    expect(up.sky(16, 9, 16)).toBe(14); // céu ainda chega pelos lados
    // Sol em +X e +Y (45°): a sombra cai para -X, uma célula por camada.
    const s = Math.SQRT1_2;
    const slant = computeLight(g, registry, { sunDirX: s, sunDirY: s, sunDirZ: 0, emitters: [] });
    expect(slant.sun(16, 10, 16)).toBe(1); // o próprio cubo testa antes de marcar
    expect(slant.sun(15, 9, 16)).toBe(0);
    expect(slant.sun(14, 8, 16)).toBe(0);
    expect(slant.sun(16, 9, 16)).toBe(1);
    expect(slant.sun(7, 1, 16)).toBe(0);
    expect(slant.sun(7, 1, 17)).toBe(1);
  });

  it('a laje do telhado recebe sol; quem está embaixo, não', () => {
    const g = room();
    fill(g, 11, 6, 11, 18, 6, 18, makeCell(4));
    const light = computeLight(g, registry, UP);
    expect(light.sun(14, 6, 14)).toBe(1);
    expect(light.sun(14, 5, 14)).toBe(0);
  });
});

/** Compara todas as células de dois campos. */
function sameField(a: LightField, b: LightField): boolean {
  for (let y = 0; y < a.sizeY; y++)
    for (let z = 0; z < a.sizeZ; z++)
      for (let x = 0; x < a.sizeX; x++) {
        if (a.skyEmissive(x, y, z) !== b.skyEmissive(x, y, z) || a.sun(x, y, z) !== b.sun(x, y, z)) return false;
      }
  return true;
}

describe('trabalho fatiado, chunks e determinismo', () => {
  it('fatias pequenas dão o mesmo campo que de uma vez; progresso sobe até 1', () => {
    const g = room();
    fill(g, 14, 1, 10, 14, 2, 10, 0);
    g.set(14, 3, 14, makeCell(3));
    const params: LightParams = {
      sunDirX: 0.3,
      sunDirY: 0.9,
      sunDirZ: -0.2,
      emitters: [{ x: 3, y: 1, z: 3, level: 9 }],
    };
    const whole = computeLight(g, registry, params);
    const job = createLightJob(g, registry, params);
    expect(() => job.result).toThrow('ainda não terminou');
    let last = 0;
    let steps = 0;
    while (!job.step(500)) {
      expect(job.progress).toBeGreaterThanOrEqual(last);
      last = job.progress;
      steps++;
    }
    expect(steps).toBeGreaterThan(10);
    expect(job.progress).toBe(1);
    expect(sameField(job.result, whole)).toBe(true);
    expect(sameField(computeLight(g, registry, params), whole)).toBe(true);
  });

  it('chunk todo no padrão não guarda nada; chunk de ar sob teto guarda', () => {
    const g = createWorldGrid(64, 64, 32);
    fill(g, 0, 0, 0, 63, 0, 31, C);
    fill(g, 32, 40, 0, 63, 40, 31, C); // teto alto só na metade +X
    const light = computeLight(g, registry, UP);
    expect(light.getChunk(0, 1, 0)).toBeNull(); // céu aberto
    const under = light.getChunk(1, 1, 0);
    expect(under).not.toBeNull();
    expect(light.getChunk(5, 0, 0)).toBeNull(); // fora da grade
    expect(light.sky(40, 35, 10)).toBeLessThan(15);
  });
});

describe('grade de luz de 2 m', () => {
  it('médias só das células de ar; bloco todo sólido herda a vizinha mais clara; amostra trilinear', () => {
    const g = room();
    fill(g, 0, 1, 0, 3, 4, 3, C); // um bloco de 2 m todo de concreto num canto
    const light = computeLight(g, registry, UP);
    const lg = buildLightGrid(light);
    expect([lg.sizeX, lg.sizeY, lg.sizeZ]).toEqual([10, 4, 10]);
    const at = (x: number, y: number, z: number) => {
      const i = (x + z * lg.sizeX + y * lg.sizeX * lg.sizeZ) * 3;
      return [lg.data[i], lg.data[i + 1], lg.data[i + 2]];
    };
    // Célula de 2 m em (2..4 m, 0..2 m, 2..4 m) fora: a camada y=0 é chão (fora da média), o resto ar.
    expect(at(5, 1, 5)).toEqual([255, 255, 0]);
    // Dentro da sala (células 12..15 → 2 m em x = 3): escuro.
    expect(at(3, 0, 3)).toEqual([0, 0, 0]);
    // Bloco sólido em (0..2 m, 0.5..2 m...) não fica preto: herda.
    expect(at(0, 0, 0)[0]).toBeGreaterThan(0);
    const out = new Float32Array(6);
    sampleLightGrid(lg, 11, 3, 11, out, 0); // centro de (5, 1, 5)
    expect(out[0]).toBeCloseTo(1, 6);
    sampleLightGrid(lg, 7, 1, 7, out, 3); // centro de (3, 0, 3): escuro
    expect(out[3]).toBeCloseTo(0, 6);
    // No meio entre um centro claro e um escuro: média.
    sampleLightGrid(lg, 8, 1, 7, out, 0);
    const a = out[0]!;
    sampleLightGrid(lg, 7, 1, 7, out, 0);
    const b = out[0]!;
    sampleLightGrid(lg, 9, 1, 7, out, 0);
    expect(a).toBeCloseTo((b + out[0]!) / 2, 6);
    // Fora da grade: limita na borda.
    sampleLightGrid(lg, -50, 100, -50, out, 0);
    expect(out[0]).toBeGreaterThanOrEqual(0);
    expect(out[0]).toBeLessThanOrEqual(1);
  });

  it('campo de outra origem: calcula pelas consultas', () => {
    const fake: LightField = {
      sizeX: 8,
      sizeY: 4,
      sizeZ: 8,
      skyEmissive: () => 15 | (3 << 4),
      sky: () => 15,
      emissive: () => 3,
      sun: () => 1,
      getChunk: () => null,
    };
    const lg = buildLightGrid(fake);
    expect([lg.sizeX, lg.sizeY, lg.sizeZ]).toEqual([2, 1, 2]);
    expect(Array.from(lg.data.subarray(0, 3))).toEqual([255, 255, 51]);
  });
});
