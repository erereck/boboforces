import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BufferAttribute, Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  ACTOR_BOX,
  ACTOR_EXTRA_COMPONENTS,
  composeYawPitch,
  createActorInstanceArrays,
  writeActorInstances,
} from './actor-instances.ts';
import * as worldShaders from './shaders.ts';
import { ACTOR_FRAGMENT, BLOCK_FRAGMENT, BLOCK_VERTEX } from './shaders.ts';
import { SKY_PRESETS } from './sky.ts';
import { assertTextureArray, textureArrayFromLayers, textureArrayFromStrip } from './texture-data.ts';
import { ACTOR_POSE, createActorBuffer } from './types.ts';
import { pinUpdateRange } from './ui/ui-pass.ts';
import * as uiShaders from './ui/ui-shader.ts';
import { bufferScale, createGlRect, surfaceRectToGl } from './viewport.ts';

const SRC = dirname(fileURLToPath(import.meta.url));

describe('viewports', () => {
  it('teto de DPR encolhe o drawing buffer só acima do teto', () => {
    expect(bufferScale(1, 2)).toBe(1);
    expect(bufferScale(2, 2)).toBe(1);
    expect(bufferScale(3, 2)).toBeCloseTo(2 / 3);
    expect(bufferScale(0, 2)).toBe(1);
  });

  it('converte para o GL (origem embaixo) e 4 quadrantes cobrem a tela sem fresta', () => {
    const r = surfaceRectToGl(0, 0, 640, 360, 1, 720, createGlRect());
    expect(r).toEqual({ x: 0, y: 360, width: 640, height: 360 });

    // Tela ímpar com escala quebrada: as bordas arredondadas encaixam.
    const W = 1281;
    const H = 721;
    const s = 0.73;
    const bw = Math.floor(W * s);
    const bh = Math.floor(H * s);
    const covered = new Uint8Array(bw * bh);
    const halfW = W / 2;
    const halfH = H / 2;
    for (const [x, y] of [
      [0, 0],
      [halfW, 0],
      [0, halfH],
      [halfW, halfH],
    ] as const) {
      const q = surfaceRectToGl(x, y, halfW, halfH, s, bh, createGlRect());
      for (let yy = q.y; yy < q.y + q.height; yy++)
        for (let xx = q.x; xx < q.x + q.width; xx++) if (xx < bw && yy >= 0 && yy < bh) covered[yy * bw + xx]!++;
    }
    expect(covered.every((c) => c === 1)).toBe(true);
  });
});

describe('texture arrays', () => {
  const layer = (v: number) => ({ width: 16, height: 16, data: new Uint8Array(16 * 16 * 4).fill(v) });

  it('tira vertical vira camadas sem copiar', () => {
    const strip = { width: 16, height: 48, data: new Uint8Array(16 * 48 * 4) };
    const t = textureArrayFromStrip(strip);
    expect([t.width, t.height, t.layers]).toEqual([16, 16, 3]);
    expect(t.levels[0]).toBe(strip.data);
  });

  it('camadas soltas viram um buffer contíguo na ordem', () => {
    const t = textureArrayFromLayers([layer(1), layer(2)]);
    expect(t.layers).toBe(2);
    expect(t.levels[0]![0]).toBe(1);
    expect(t.levels[0]![16 * 16 * 4]).toBe(2);
  });

  it('recusa tamanho errado, sem potência de 2 e camada faltando', () => {
    expect(() => textureArrayFromStrip({ width: 16, height: 40, data: new Uint8Array(16 * 40 * 4) })).toThrow();
    expect(() => textureArrayFromLayers([layer(1), { width: 8, height: 8, data: new Uint8Array(256) }])).toThrow();
    expect(() =>
      assertTextureArray({ width: 12, height: 12, layers: 1, levels: [new Uint8Array(12 * 12 * 4)] }),
    ).toThrow(/potência de 2/);
    expect(() => assertTextureArray({ width: 16, height: 16, layers: 2, levels: [new Uint8Array(16)] })).toThrow();
    expect(() => assertTextureArray({ width: 16, height: 16, layers: 1, levels: [] })).toThrow();
  });
});

describe('atores provisórios', () => {
  it('composeYawPitch bate com o Matrix4.compose do three (Euler YXZ)', () => {
    const out = new Float32Array(16);
    for (const [yaw, pitch] of [
      [0, 0],
      [0.7, -0.3],
      [-2.5, 1.2],
      [Math.PI, 0.5],
    ] as const) {
      composeYawPitch(out, 0, 1, 2, 3, yaw, pitch, 0.6, 1.5, 0.4);
      const q = new Quaternion().setFromEuler(new Euler(pitch, yaw, 0, 'YXZ'));
      const m = new Matrix4().compose(new Vector3(1, 2, 3), q, new Vector3(0.6, 1.5, 0.4));
      m.elements.forEach((e, i) => expect(out[i]).toBeCloseTo(e, 5));
    }
  });

  it('yaw 0 olha para -Z e yaw + vira para a esquerda (-X)', () => {
    const out = new Float32Array(16);
    composeYawPitch(out, 0, 0, 0, 0, Math.PI / 2, 0, 1, 1, 1);
    const forward = new Vector3(0, 0, -1).applyMatrix4(new Matrix4().fromArray(out));
    expect(forward.x).toBeCloseTo(-1);
    expect(forward.z).toBeCloseTo(0);
  });

  it('preenche corpo, cabeça, cor do time, flash e slot; agachado e morto mudam a pose', () => {
    const buffer = createActorBuffer(4);
    buffer.count = 3;
    buffer.position.set([1, 0, 2, 5, 0, 5, -3, 1, 0]);
    buffer.team.set([0, 1, 255]);
    buffer.pose.set([0, ACTOR_POSE.crouch, ACTOR_POSE.dead]);
    buffer.damageFlash.set([0, 0.5, 0]);
    buffer.localSlot.set([0, 255, 255]);
    const arrays = createActorInstanceArrays(8);
    expect(writeActorInstances(buffer, arrays)).toBe(3);

    // Em pé: corpo de 1,0 m e cabeça no pescoço (y = 1,0).
    expect(arrays.bodyMatrix[5]).toBeCloseTo(ACTOR_BOX.height - ACTOR_BOX.head);
    expect(arrays.headMatrix[13]).toBeCloseTo(ACTOR_BOX.height - ACTOR_BOX.head);
    // Agachado: pescoço desce para 0,45 m.
    expect(arrays.headMatrix[16 + 13]).toBeCloseTo(ACTOR_BOX.crouchHeight - ACTOR_BOX.head);
    // Morto: cabeça com escala zero.
    expect(arrays.headMatrix.subarray(32, 43).every((v) => v === 0)).toBe(true);

    expect(arrays.bodyColor[0]).toBeCloseTo(0xff / 255);
    expect(arrays.bodyColor[3 + 2]).toBeCloseTo(0xff / 255);
    expect(arrays.extra[ACTOR_EXTRA_COMPONENTS + 0]).toBeCloseTo(0.5);
    expect(arrays.extra[1]).toBe(0);
    expect(arrays.extra[ACTOR_EXTRA_COMPONENTS + 1]).toBe(255);
  });

  it('nunca escreve além da capacidade', () => {
    const buffer = createActorBuffer(10);
    buffer.count = 10;
    expect(writeActorInstances(buffer, createActorInstanceArrays(4))).toBe(4);
  });
});

describe('shaders (regras de portabilidade)', () => {
  const stripComments = (s: string) => s.replace(/\/\/.*$/gm, '');

  // Todos os shaders exportados, sem lista fixa: shader novo entra na checagem sozinho.
  const exported: Record<string, unknown> = { ...worldShaders, ...uiShaders };
  const all = Object.entries(exported).filter(
    (e): e is [string, string] => typeof e[1] === 'string' && /_(VERTEX|FRAGMENT)(_SHADER)?$/.test(e[0]),
  );
  const vertex = all.filter(([name]) => /_VERTEX(_SHADER)?$/.test(name));

  it('acha todos os shaders do render (mundo e UI)', () => {
    expect(all.map(([name]) => name).sort()).toEqual([
      'ACTOR_FRAGMENT',
      'ACTOR_VERTEX',
      'BLOCK_FRAGMENT',
      'BLOCK_VERTEX',
      'UI_FRAGMENT_SHADER',
      'UI_VERTEX_SHADER',
    ]);
  });

  it('nenhum vertex shader lê textura (regra 6)', () => {
    for (const [name, vs] of vertex) {
      const code = stripComments(vs);
      expect(code, name).not.toMatch(/\b(texture\w*|texelFetch\w*)\s*\(/);
      expect(code, name).not.toMatch(/\bsampler\w*/);
    }
  });

  it('nenhum shader usa extensão nem declara versão (o three põe o #version 300 es)', () => {
    for (const [name, src] of all) expect(src, name).not.toMatch(/#\s*(extension|version)\b/);
  });

  it('os materiais só usam os shaders exportados (nada de GLSL solto fora destes módulos)', () => {
    const names = new Set(all.map(([name]) => name));
    for (const file of ['renderer.ts', 'ui/ui-pass.ts']) {
      const text = readFileSync(join(SRC, file), 'utf8');
      const used = [...text.matchAll(/(?:vertex|fragment)Shader:\s*([A-Za-z_]\w*)/g)].map((m) => m[1] as string);
      expect(used.length, file).toBeGreaterThan(0);
      for (const name of used) expect(names.has(name), `${file}: ${name}`).toBe(true);
    }
  });

  it('fragment shaders GLSL3 declaram a saída e usam fog própria', () => {
    for (const fs of [BLOCK_FRAGMENT, ACTOR_FRAGMENT]) {
      expect(fs).toMatch(/layout\(location = 0\) out vec4 fragColor;/);
      expect(fs).toMatch(/applyFog/);
    }
    expect(BLOCK_FRAGMENT).toMatch(/#ifdef CUTOUT[\s\S]*discard/);
  });

  it('a tabela de normais do shader bate com a ordem de FACE do world', () => {
    expect(BLOCK_VERTEX).toContain(
      'vec3[6](vec3(1, 0, 0), vec3(-1, 0, 0), vec3(0, 1, 0), vec3(0, -1, 0), vec3(0, 0, 1), vec3(0, 0, -1))',
    );
  });
});

describe('presets de céu', () => {
  it('direção do sol unitária e acima do horizonte', () => {
    for (const sky of Object.values(SKY_PRESETS)) {
      expect(Math.hypot(sky.sunDirX, sky.sunDirY, sky.sunDirZ)).toBeCloseTo(1);
      expect(sky.sunDirY).toBeGreaterThan(0);
    }
  });
});

describe('faixa de upload fixa (regra 11)', () => {
  it('o upload do three não troca nem esvazia a faixa: por frame só muda o count', () => {
    const attr = new BufferAttribute(new Float32Array(64), 4);
    const range = { start: 0, count: 0 };
    pinUpdateRange(attr, range);
    for (let frame = 1; frame <= 3; frame++) {
      range.count = frame * 4;
      // O que o WebGLAttributes do three faz depois do bufferSubData.
      attr.clearUpdateRanges();
      expect(attr.updateRanges).toHaveLength(1);
      expect(attr.updateRanges[0]).toBe(range);
      expect(attr.updateRanges[0]?.count).toBe(frame * 4);
    }
  });
});
