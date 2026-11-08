import { describe, expect, it } from 'vitest';
import { PARTICLE_FRAGMENT, PARTICLE_KIND, PARTICLE_UNIFORM_NAMES, PARTICLE_VERTEX } from '../fx/shader.ts';
import { COMMON_UNIFORM_NAMES, GLSL_COMMON_UNIFORMS, GLSL_COMMON_VERTEX } from '../shared/glsl-common.ts';
import { FIGURE_BOX_FLAG } from '@boboforces/format';
import { VERTEX_FLAG } from './layout.ts';
import { INSTANCED_FRAGMENT, INSTANCED_UNIFORM_NAMES, INSTANCED_VERTEX } from './shader.ts';

const strip = (s: string) => s.replace(/\/\/.*$/gm, '');

describe('shaders dos programas 4 e 5 (regras de portabilidade)', () => {
  const vertex = { INSTANCED_VERTEX, PARTICLE_VERTEX };
  const all = { ...vertex, INSTANCED_FRAGMENT, PARTICLE_FRAGMENT };

  it('nenhum vertex shader lê textura nem declara sampler próprio (regra 6)', () => {
    for (const [name, src] of Object.entries(vertex)) {
      expect(strip(src), name).not.toMatch(/\b(texture\w*|texelFetch\w*)\s*\(/);
      // O único sampler é o da LUT, que vem nos uniforms comuns (congelados) e não é lido no vertex shader.
      expect(strip(src.replace(GLSL_COMMON_UNIFORMS, '')), name).not.toMatch(/\bsampler\w*/);
    }
  });

  it('sem extensão nem versão; saída declarada; fim com fog/cinza do glsl-common', () => {
    for (const [name, src] of Object.entries(all)) expect(src, name).not.toMatch(/#\s*(extension|version)\b/);
    for (const fs of [INSTANCED_FRAGMENT, PARTICLE_FRAGMENT]) {
      expect(fs).toMatch(/layout\(location = 0\) out vec4 fragColor;/);
      expect(fs).toMatch(/bfFinish|bfGrayscale/);
    }
    for (const name of COMMON_UNIFORM_NAMES) expect(INSTANCED_FRAGMENT).toContain(` ${name};`);
  });

  it('declara os uniforms próprios e as flags batem com o layout da CPU', () => {
    for (const name of INSTANCED_UNIFORM_NAMES) expect(INSTANCED_VERTEX).toMatch(new RegExp(`uniform \\w+ ${name}\\b`));
    for (const name of PARTICLE_UNIFORM_NAMES) {
      expect(PARTICLE_VERTEX + PARTICLE_FRAGMENT).toMatch(new RegExp(`uniform \\w+ ${name}\\b`));
    }
    expect(INSTANCED_VERTEX).toContain(`BF_V_ALPHA = ${VERTEX_FLAG.alphaTest};`);
    expect(INSTANCED_FRAGMENT).toContain(`BF_V_SOLID = ${VERTEX_FLAG.solid};`);
    expect(PARTICLE_VERTEX).toContain(`BF_P_DECAL = ${PARTICLE_KIND.decal};`);
    expect(PARTICLE_VERTEX).toContain(`BF_P_STAR = ${PARTICLE_KIND.star};`);
    expect(INSTANCED_VERTEX).toContain(`BF_V_BOX = ${VERTEX_FLAG.box};`);
    expect(INSTANCED_VERTEX).toContain(`BF_V_FACE = ${VERTEX_FLAG.face};`);
    expect(INSTANCED_VERTEX).toContain(`BF_B_FACE = ${FIGURE_BOX_FLAG.face};`);
    expect(INSTANCED_VERTEX).toContain(`BF_B_OUTER = ${FIGURE_BOX_FLAG.outer};`);
    // Atlas ou array pelo mesmo trecho comum.
    expect(INSTANCED_FRAGMENT).toContain('uniform BF_LAYER_SAMPLER uModels;');
  });

  it('programa 4 sem contorno (#50) nem skin de teste (#51): só uHideSlot e uOuterMaxDist', () => {
    expect([...INSTANCED_UNIFORM_NAMES]).toEqual(['uHideSlot', 'uOuterMaxDist']);
    const code = strip(INSTANCED_VERTEX + INSTANCED_FRAGMENT);
    for (const gone of [
      'uDensityLayer',
      'uDensityMap',
      'uOutlinePx',
      'uViewportPx',
      'uTeamColors',
      'uEnemyColor',
      'uViewTeam',
      'BF_V_HULL',
    ]) {
      expect(code, gone).not.toContain(gone);
    }
    // Uniform do programa 4 declarado no shader = lista da CPU (nada sobrando de um lado só).
    const own = strip(INSTANCED_VERTEX.replace(GLSL_COMMON_UNIFORMS, '').replace(GLSL_COMMON_VERTEX, ''));
    const declared = [...own.matchAll(/^uniform \w+ (u\w+)/gm)].map((m) => m[1]);
    expect(declared.sort()).toEqual([...INSTANCED_UNIFORM_NAMES].sort());
  });

  it('camada do vértice ou da instância (#56: sem o quadrante da skin de 4 camadas); sem o bobo A no VS', () => {
    const code = strip(INSTANCED_VERTEX);
    expect(code).toContain('float layer = aVert.x >= 0.0 ? aVert.x : iLayer.x;');
    // A folha de rostos (camada em iLayer.y), o desmonte por iPart.x e a camada externa por iPart.y saíram com o bobo A.
    for (const gone of ['layer = iLayer.y', 'iPart.x;', 'iPart.y', 'aVert.w']) expect(code, gone).not.toContain(gone);
    // Sem multiplicação inteira, sem atributo novo: os atributos do programa 4 continuam os mesmos.
    expect(code).not.toMatch(/\bint\s+\w+\s*=\s*[^;]*\*/);
    expect([...code.matchAll(/^in vec4 (\w+);/gm)].map((m) => m[1])).toEqual([
      'aVert',
      'iLayer',
      'iLight',
      'iColor',
      'iPart',
    ]);
  });

  it('E.8: restrições do Eden no VS do programa 4 (sem return no main, sem int * / %, sem |, divisão no padrão)', () => {
    const own = strip(INSTANCED_VERTEX.replace(GLSL_COMMON_UNIFORMS, '').replace(GLSL_COMMON_VERTEX, ''));
    const main = own.slice(own.indexOf('void main()'));
    expect(main.length).toBeGreaterThan(100);
    // Sem saída antecipada: o recompilador do Eden derruba o app.
    expect(main).not.toMatch(/\breturn\b/);
    // Sem OR de bits (só soma de bits disjuntos) e sem resto: nem no código próprio dos programas 4 e 5 nem no trecho
    // comum do VS (o bfHash, com `|` em uint, só entra no fragment).
    expect(strip(GLSL_COMMON_VERTEX)).not.toMatch(/[^|]\|[^|]/);
    for (const src of [INSTANCED_VERTEX, PARTICLE_VERTEX]) {
      const code = strip(src.replace(GLSL_COMMON_UNIFORMS, '').replace(GLSL_COMMON_VERTEX, ''));
      expect(code).not.toMatch(/[^|]\|[^|]/);
      expect(code).not.toContain('%');
    }
    // Inteiros só com `int(x + 0.5)`, `&`, soma e comparação: nenhuma variável int nem constante BF_ ao lado de * ou /.
    const ints = [...own.matchAll(/\bint\s+(\w+)\s*=/g)].map((m) => m[1]!);
    expect(ints.sort()).toEqual(
      [
        'BF_B_FACE',
        'BF_B_OUTER',
        'BF_V_ALPHA',
        'BF_V_BOX',
        'BF_V_EMISSIVE',
        'BF_V_FACE',
        'BF_V_SOLID',
        'bflags',
        'flags',
      ].sort(),
    );
    for (const name of ints) {
      expect(main, name).not.toMatch(new RegExp(`\\b${name}\\s*[*/]|[*/]\\s*${name}\\b`));
    }
    for (const m of main.matchAll(/\bint\(([^)]*)\)/g)) expect(m[1]).toMatch(/^\s*[\w.]+\s*\+\s*0\.5\s*$/);
    // Divisão em float só no padrão floor((x + 0.5) / n), com n literal.
    const divisions = [...main.matchAll(/\//g)].length;
    const pattern = [...main.matchAll(/floor\(\(\s*[\w.]+\s*\+\s*0\.5\)\s*\/\s*[0-9.]+\)/g)].length;
    expect(divisions).toBe(pattern);
    expect(pattern).toBeGreaterThanOrEqual(5);
    // Sem índice dinâmico em uniform: nenhum uniform (u…) indexado no programa 4.
    expect(main).not.toMatch(/\bu[A-Z]\w*\s*\[/);
    // A matriz da instância é lida com índice constante (4ª linha: luz, expressão e clarão das caixas).
    for (const m of main.matchAll(/\bim\[([^\]]*)\]/g)) expect(m[1]).toMatch(/^[0-3]$/);
  });

  it('todo fade das partículas tem a borda 0 do smoothstep abaixo de 1,0 (a sombra-blob sumia com 2,0)', () => {
    const starts = [...strip(PARTICLE_FRAGMENT).matchAll(/fadeStart\s*=\s*([0-9.]+)\s*;/g)].map((m) => Number(m[1]));
    expect(starts.length).toBeGreaterThanOrEqual(5);
    for (const s of starts) expect(s).toBeLessThan(1);
    expect(PARTICLE_FRAGMENT).toMatch(/smoothstep\(fadeStart, 1\.0, vT\)/);
  });
});
