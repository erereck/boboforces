import { BackSide, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { GLSL_COMMON_UNIFORMS } from './shared/glsl-common.ts';
import {
  createSharedTextures,
  createSharedUniforms,
  createSkyMesh,
  createWorldMaterials,
  creationDefines,
  SKY_RENDER_ORDER,
} from './world-materials.ts';
import { AO_LEVELS, REGION_FRAGMENT, REGION_VERTEX, SKY_FRAGMENT, SKY_VERTEX } from './world-shaders.ts';

const stripComments = (s: string): string => s.replace(/\/\/.*$/gm, '');

/** Palavras reservadas do GLSL ES 3.00 que um nome nosso poderia pegar sem querer (o compilador recusa). */
const RESERVED = [
  'half',
  'fixed',
  'sample',
  'filter',
  'input',
  'output',
  'common',
  'partition',
  'active',
  'superp',
  'namespace',
  'using',
  'cast',
  'long',
  'short',
  'double',
  'unsigned',
  'external',
  'interface',
  'class',
  'union',
  'enum',
  'typedef',
  'template',
  'this',
  'goto',
  'inline',
  'noinline',
  'volatile',
  'public',
  'static',
  'extern',
  'asm',
  'sizeof',
  'packed',
  'resource',
];

const PROGRAMS = {
  regiao: { vertex: REGION_VERTEX, fragment: REGION_FRAGMENT },
  ceu: { vertex: SKY_VERTEX, fragment: SKY_FRAGMENT },
} as const;

/** Uniforms declarados num estágio (nome sem o tamanho do array). */
function declaredUniforms(src: string): string[] {
  return [...stripComments(src).matchAll(/^\s*uniform\s+\w+\s+(\w+)\s*(?:\[\d+\])?\s*;/gm)].map((m) => m[1]!);
}

describe('programas do mundo (1–3 e 6)', () => {
  it('nenhum vertex shader lê textura nem declara sampler fora do bloco comum (regra 6)', () => {
    for (const [name, p] of Object.entries(PROGRAMS)) {
      const code = stripComments(p.vertex);
      expect(code, name).not.toMatch(/\b(texture\w*|texelFetch\w*)\s*\(/);
      expect(code.replace(stripComments(GLSL_COMMON_UNIFORMS), ''), name).not.toMatch(/\bsampler\w*/);
    }
  });

  it('sem extensão, sem #version, chaves e parênteses fechados, nada de palavra reservada', () => {
    for (const [name, p] of Object.entries(PROGRAMS)) {
      for (const src of [p.vertex, p.fragment]) {
        const code = stripComments(src);
        expect(code, name).not.toMatch(/#\s*(extension|version)\b/);
        expect(code.split('{').length, name).toBe(code.split('}').length);
        expect(code.split('(').length, name).toBe(code.split(')').length);
        for (const word of RESERVED) expect(code, `${name}: ${word}`).not.toMatch(new RegExp(`\\b${word}\\b`));
      }
    }
  });

  it('fragment shaders declaram a saída e terminam em fog → LUT → cinza', () => {
    for (const [name, p] of Object.entries(PROGRAMS)) {
      expect(p.fragment, name).toMatch(/layout\(location = 0\) out vec4 fragColor;/);
      expect(p.fragment, name).toMatch(/bfFinish\(/);
    }
    expect(REGION_FRAGMENT).toMatch(/#ifdef CUTOUT[\s\S]*albedo\.a < 0\.5[\s\S]*discard/);
    expect(REGION_FRAGMENT).toMatch(/#ifdef TRANSLUCENT[\s\S]*vec4\(color, albedo\.a\)/);
    // Plano B: atlas com fract + textureGrad nos mesmos programas.
    expect(REGION_FRAGMENT).toMatch(/#ifdef ATLAS[\s\S]*textureGrad\(uBlocks[\s\S]*fract\(uv\)/);
    // Variantes e quadros de animação pela célula; variação de cor só no shader.
    expect(REGION_FRAGMENT).toMatch(/bfBlockLayer\(vLayer\.x, vLayer\.y, vLayer\.z, vCell\)/);
    // O vértice lê o formato compacto pela função comum (inteiro ou VERTEX_FLOAT).
    expect(REGION_VERTEX).toMatch(/bfUnpackBlockVertex\(bfBlockData\(\)\)/);
    expect(REGION_VERTEX).toMatch(/#ifdef VERTEX_FLOAT/);
  });

  it('todo uniform declarado existe no material (o three não deixa nenhum sem valor)', () => {
    const { uniforms } = createSharedUniforms();
    const materials = createWorldMaterials(uniforms, createSharedTextures(), creationDefines('atlas', 'float'));
    const pairs = [
      [materials.regions.opaque, PROGRAMS.regiao],
      [materials.regions.cutout, PROGRAMS.regiao],
      [materials.regions.translucent, PROGRAMS.regiao],
      [materials.sky, PROGRAMS.ceu],
    ] as const;
    for (const [material, p] of pairs) {
      for (const name of [...declaredUniforms(p.vertex), ...declaredUniforms(p.fragment)]) {
        expect(material.uniforms[name], `${material.name}: ${name}`).toBeDefined();
      }
      // Os uniforms comuns são os MESMOS objetos em todos os materiais.
      expect(material.uniforms['uSunDir']).toBe(uniforms.uSunDir);
    }
    expect(materials.regions.cutout.defines).toMatchObject({ ATLAS: '1', VERTEX_FLOAT: '1', CUTOUT: '1' });
    expect(materials.regions.translucent.transparent).toBe(true);
    expect(materials.regions.translucent.depthWrite).toBe(false);
    expect(materials.sky.depthWrite).toBe(false);
    materials.dispose();
  });
});

describe('céu e tabelas', () => {
  it('cubo do céu com as 12 faces para fora (o material desenha o lado de dentro) e depois dos opacos', () => {
    const { uniforms } = createSharedUniforms();
    const materials = createWorldMaterials(uniforms, createSharedTextures(), {});
    const sky = createSkyMesh(materials.sky);
    const pos = sky.geometry.getAttribute('position');
    const index = sky.geometry.index!;
    expect(index.count).toBe(36);
    const a = new Vector3();
    const b = new Vector3();
    const c = new Vector3();
    for (let t = 0; t < 12; t++) {
      a.fromBufferAttribute(pos, index.getX(t * 3));
      b.fromBufferAttribute(pos, index.getX(t * 3 + 1));
      c.fromBufferAttribute(pos, index.getX(t * 3 + 2));
      const centroid = a.clone().add(b).add(c);
      const normal = b.clone().sub(a).cross(c.clone().sub(a));
      expect(normal.dot(centroid), `triângulo ${t}`).toBeGreaterThan(0);
    }
    expect(materials.sky.side).toBe(BackSide);
    expect(sky.renderOrder).toBe(SKY_RENDER_ORDER);
    expect(sky.frustumCulled).toBe(false);
    materials.dispose();
  });

  it('AO do vértice cresce do canto fechado ao aberto e o shader usa a mesma tabela', () => {
    for (let i = 1; i < AO_LEVELS.length; i++) expect(AO_LEVELS[i]).toBeGreaterThan(AO_LEVELS[i - 1]!);
    expect(AO_LEVELS[3]).toBe(1);
    expect(REGION_VERTEX).toContain(`float[4](${AO_LEVELS.map((v) => v.toFixed(2)).join(', ')})`);
    expect(creationDefines('array', 'int')).toEqual({});
  });
});
