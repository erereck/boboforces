import {
  LAYER_MANIFEST_FORMAT,
  mipChainOffsets,
  PLAYABLE_PROP_DOSE_VIEW,
  type LayerManifest,
} from '@boboforces/format';
import { NORMAL } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { createEnvironment, TIME_OF_DAY_PRESETS } from './environment.ts';
import { createFxQueue, FX_KIND, FX_STRIDE, pushBlockImpact, pushDeath, pushDebris, resetFxQueue } from './fx-queue.ts';
import {
  GLSL_BLOCK_VERTEX_INPUT,
  GLSL_COMMON_FRAGMENT,
  GLSL_COMMON_UNIFORMS,
  GLSL_COMMON_VERTEX,
  GLSL_NORMAL_COUNT,
  GLSL_NORMAL_TABLES,
  COMMON_UNIFORM_NAMES,
} from './shared/glsl-common.ts';
import { assembleTextureArray, type TextureStrip } from './texture-assets.ts';
import { createActorBuffer, createRenderDebug, createViewDesc } from './types.ts';

function strip(
  source: 'texgen' | 'modelgen',
  names: string[],
  size: number,
  mipLevels: number,
  fill: number,
): TextureStrip {
  const manifest: LayerManifest = {
    format: LAYER_MANIFEST_FORMAT,
    array: size === 16 ? 'blocos16' : 'modelos64',
    source,
    layerWidth: size,
    layerHeight: size,
    mipLevels,
    layers: names.map((name) => ({ name, kind: 'opaque', frames: 1, cutout: false })),
  };
  const level0 = { width: size, height: size * names.length, data: new Uint8Array(size * size * 4 * names.length) };
  level0.data.fill(fill);
  const mips = {
    width: size / 2,
    height: size * names.length,
    data: new Uint8Array((size / 2) * size * 4 * names.length),
  };
  // Marca o nível 1 de cada camada com o índice dela + 1 (para conferir a cópia).
  names.forEach((_, i) => {
    const r = mipChainOffsets(size, mipLevels)[0];
    if (!r) return;
    for (let row = 0; row < r.height; row++) {
      const o = ((i * size + r.y + row) * (size / 2) + r.x) * 4;
      mips.data.fill(fill + i + 1, o, o + r.width * 4);
    }
  });
  return { manifest, level0, mips: mipLevels > 1 ? mips : null };
}

describe('texture arrays do M1', () => {
  it('concatena tiras na ordem, resolve por nome, copia os mips e reserva camadas no fim', () => {
    const a = strip('texgen', ['metal', 'pistol_tile'], 64, 7, 10);
    const b = strip('modelgen', ['rifle'], 64, 7, 50);
    const arr = assembleTextureArray('modelos64', [a, b], 2);
    expect(arr.data.layers).toBe(5);
    expect(arr.data.levels.length).toBe(7);
    expect(arr.layers.get('rifle')).toBe(2);
    expect(arr.reservedStart).toBe(3);
    expect(arr.reservedCount).toBe(2);
    expect(arr.data.levels[0]![64 * 64 * 4 * 2]).toBe(50);
    // Nível 1 (32×32): camada 1 da tira a = 12; camada 2 (rifle) = 51; reservadas zeradas.
    expect(arr.data.levels[1]![32 * 32 * 4 * 1]).toBe(12);
    expect(arr.data.levels[1]![32 * 32 * 4 * 2]).toBe(51);
    expect(arr.data.levels[1]![32 * 32 * 4 * 3]).toBe(0);
  });

  it('recusa nome repetido, mips divergentes e arquivo provisório', () => {
    const a = strip('texgen', ['x'], 16, 5, 1);
    expect(() => assembleTextureArray('blocos16', [a, strip('modelgen', ['x'], 16, 5, 1)])).toThrow('repetida');
    expect(() => assembleTextureArray('blocos16', [a, strip('modelgen', ['y'], 16, 1, 1)])).toThrow('mip');
    const placeholder = { ...a, manifest: { ...a.manifest, placeholder: true } };
    expect(() => assembleTextureArray('blocos16', [placeholder])).toThrow('npm run assets');
  });
});

describe('fila de VFX', () => {
  it('escreve os campos no lugar documentado e descarta quando enche', () => {
    const q = createFxQueue(2);
    expect(pushBlockImpact(q, 1, 2, 3, 0, 1, 0, 7, NORMAL.py, 6)).toBe(true);
    expect(q.kind[0]).toBe(FX_KIND.impactBlock);
    expect([...q.data.subarray(0, 9)]).toEqual([1, 2, 3, 0, 1, 0, 7, 2, 6]);
    expect(pushDebris(q, 0, 0, 0, 1, 2, 3, 0xffd56b, 4, 1)).toBe(true);
    expect(q.data[FX_STRIDE + 6]).toBe(0xffd56b);
    expect(pushBlockImpact(q, 0, 0, 0, 0, 1, 0, 1, 2, 1)).toBe(false);
    resetFxQueue(q);
    const death = {
      victim: 0x00020005,
      x: 1,
      y: 0,
      z: 2,
      yaw: 0.5,
      dirX: 0,
      dirY: 0,
      dirZ: -1,
      force: 6,
      bodyPart: 0,
      skin: 40,
      scale: 1,
      kind: 0,
      figure: 3,
    };
    expect(pushDeath(q, death)).toBe(true);
    expect(q.entity[0]).toBe(0x00020005);
    expect(q.data[9]).toBe(40);
    expect(q.data[12]).toBe(3);
  });
});

describe('GLSL comum (congelado)', () => {
  it('sem extensões, sem textura no vertex shader e com a tabela de normais do world', () => {
    const all = GLSL_COMMON_UNIFORMS + GLSL_NORMAL_TABLES + GLSL_COMMON_VERTEX + GLSL_BLOCK_VERTEX_INPUT;
    expect(all + GLSL_COMMON_FRAGMENT).not.toMatch(/#extension/);
    expect(GLSL_COMMON_VERTEX + GLSL_BLOCK_VERTEX_INPUT).not.toMatch(/\btexture(Grad|Lod)?\s*\(/);
    expect(GLSL_NORMAL_COUNT).toBe(NORMAL.count);
    expect(GLSL_NORMAL_TABLES.match(/vec3\(/g)!.length).toBe(NORMAL.count * 3);
    for (const name of COMMON_UNIFORM_NAMES) expect(GLSL_COMMON_UNIFORMS).toContain(` ${name};`);
    expect(GLSL_COMMON_FRAGMENT).toContain('#ifdef ATLAS');
    expect(GLSL_BLOCK_VERTEX_INPUT).toContain('#ifdef VERTEX_FLOAT');
  });
});

describe('contrato do render do M1', () => {
  it('fábricas sem three e presets de hora do dia', () => {
    const view = createViewDesc();
    expect(view.viewmodel.visible).toBe(false);
    expect(view.hud).toBeNull();
    // A vista padrão mostra exatamente as props do jogo (#52); sem chaves de contorno nem de skin de teste (#50, #51).
    expect(createRenderDebug()).toEqual({
      grayscale: false,
      mipFilter: 'nearest',
      propDose: PLAYABLE_PROP_DOSE_VIEW,
      hideViewmodel: false,
      gpuFinish: false,
    });
    const actors = createActorBuffer(4);
    expect(actors.scale[3]).toBe(1);
    expect(actors.light.length).toBe(12);
    expect(Object.keys(TIME_OF_DAY_PRESETS)).toEqual(['day', 'dusk', 'night']);
    expect(createEnvironment().fogStartFraction).toBeGreaterThan(0);
  });
});
