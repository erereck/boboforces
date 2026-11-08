import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BufferAttribute } from 'three';
import { describe, expect, it } from 'vitest';
import { GLSL_COMMON_UNIFORMS } from './shared/glsl-common.ts';
import * as actorShaders from './actors/shader.ts';
import * as fxShaders from './fx/shader.ts';
import * as worldShaders from './world-shaders.ts';
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

describe('shaders (regras de portabilidade)', () => {
  const stripComments = (s: string) => s.replace(/\/\/.*$/gm, '');

  // Todos os shaders exportados, sem lista fixa: shader novo entra na checagem sozinho.
  const exported: Record<string, unknown> = { ...worldShaders, ...actorShaders, ...fxShaders, ...uiShaders };
  const all = Object.entries(exported).filter(
    (e): e is [string, string] => typeof e[1] === 'string' && /_(VERTEX|FRAGMENT)(_SHADER)?$/.test(e[0]),
  );
  const vertex = all.filter(([name]) => /_VERTEX(_SHADER)?$/.test(name));

  it('acha todos os shaders do render (mundo e UI)', () => {
    expect(all.map(([name]) => name).sort()).toEqual([
      'INSTANCED_FRAGMENT',
      'INSTANCED_VERTEX',
      'PARTICLE_FRAGMENT',
      'PARTICLE_VERTEX',
      'REGION_FRAGMENT',
      'REGION_VERTEX',
      'SKY_FRAGMENT',
      'SKY_VERTEX',
      'UI_FRAGMENT_SHADER',
      'UI_VERTEX_SHADER',
    ]);
  });

  it('nenhum vertex shader lê textura (regra 6)', () => {
    for (const [name, vs] of vertex) {
      const code = stripComments(vs);
      expect(code, name).not.toMatch(/\b(texture\w*|texelFetch\w*)\s*\(/);
      // O bloco comum declara a LUT (sampler2D) nos dois estágios; declarar não é ler (o compilador descarta).
      expect(code.replace(stripComments(GLSL_COMMON_UNIFORMS), ''), name).not.toMatch(/\bsampler\w*/);
    }
  });

  it('Eden (integração do M1): sem return antecipado, sem resto inteiro e sem índice dinâmico em uniform', () => {
    for (const [name, src] of all) {
      const code = stripComments(src);
      expect(code, name).not.toMatch(/\breturn\s*;/);
      expect(code, name).not.toMatch(/[^%]%[^%]/);
      // Qualquer uniform (`uAlgo[`) só com índice literal; a declaração `uAlgo[2];` também passa.
      expect(code, name).not.toMatch(/\bu[A-Z]\w*\[(?!\d+\])/);
    }
  });

  it('nenhum shader usa extensão nem declara versão (o three põe o #version 300 es)', () => {
    for (const [name, src] of all) expect(src, name).not.toMatch(/#\s*(extension|version)\b/);
  });

  it('os materiais só usam os shaders exportados (nada de GLSL solto fora destes módulos)', () => {
    const names = new Set(all.map(([name]) => name));
    for (const file of ['world-materials.ts', 'actors/three-objects.ts', 'ui/ui-pass.ts']) {
      const text = readFileSync(join(SRC, file), 'utf8');
      const used = [...text.matchAll(/(?:vertex|fragment)Shader:\s*([A-Za-z_]\w*)/g)].map((m) => m[1] as string);
      expect(used.length, file).toBeGreaterThan(0);
      for (const name of used) expect(names.has(name), `${file}: ${name}`).toBe(true);
    }
  });

  it('fragment shaders do mundo e dos atores declaram a saída GLSL3 (o M0 por chunk saiu na integração do M1)', () => {
    for (const [name, src] of all.filter(([n]) => /^(REGION|INSTANCED|PARTICLE|SKY)_FRAGMENT$/.test(n))) {
      expect(src, name).toContain('layout(location = 0) out vec4 fragColor;');
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
