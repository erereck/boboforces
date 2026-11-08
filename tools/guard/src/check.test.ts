import { describe, expect, it } from 'vitest';
import { checkRuntimeAssets } from './assets.ts';
import { checkFile, type CheckContext, type WorkspaceInfo } from './check.ts';

const ws = (dir: string, packageName: string, deps: string[] = []): WorkspaceInfo => ({
  dir,
  packageName,
  deps: new Set(deps),
});

const ctx: CheckContext = {
  workspaces: [
    ws('packages/shared', '@boboforces/shared'),
    ws('packages/sim', '@boboforces/sim', ['@boboforces/shared']),
    ws('packages/ui', '@boboforces/ui', ['@boboforces/shared']),
    ws('packages/render', '@boboforces/render', ['@boboforces/shared', 'three']),
    ws('packages/game', '@boboforces/game', ['@boboforces/render', '@boboforces/shared']),
    ws('packages/net', '@boboforces/net', ['trystero']),
    ws('apps/web', '@boboforces/web', ['@boboforces/game', '@boboforces/net']),
    ws('apps/switch', '@boboforces/switch', ['@boboforces/game']),
  ],
};

/** Regras violadas, como `regra@linha`. */
const check = (rel: string, src: string): string[] =>
  checkFile(rel, src, ctx).violations.map((v) => `${v.rule}@${v.line}`);

describe('globais proibidos', () => {
  it('APIs do navegador no código compartilhado', () => {
    const src = [
      'export function f() {',
      '  localStorage.setItem("a", "b");',
      '  const r = fetch("/x");',
      '  return globalThis.document;',
      '}',
    ].join('\n');
    expect(check('packages/ui/src/a.ts', src)).toEqual(['dom@2', 'dom@3', 'dom@4']);
  });

  it('nas cascas (apps/*) as APIs do navegador e do nx.js são permitidas', () => {
    expect(
      check('apps/web/src/platform/x.ts', 'localStorage.getItem("a"); fetch("x"); navigator.getGamepads();'),
    ).toEqual([]);
  });

  it('não confunde membro, chave de objeto, membro de tipo, método nem nome declarado', () => {
    const src = [
      'interface P { fetch(path: string): Promise<void>; navigator: number; }',
      'const o = { fetch: 1, window: 2 };',
      'o.fetch; o?.document;',
      'class A { fetch(path: string): void {} location = 1 }',
      'const navigator = makeNav(); navigator.go();',
      'function g(document: Doc) { return document.x; }',
      'list.map((window) => window.id);',
    ].join('\n');
    expect(check('packages/ui/src/a.ts', src)).toEqual([]);
  });

  it('o que está em string ou comentário não conta', () => {
    expect(check('packages/sim/src/a.ts', '// Math.random() e fetch\nconst s = "window.localStorage";')).toEqual([]);
  });

  it('rede só em packages/net; threads e eval em lugar nenhum', () => {
    const src = 'new WebSocket(u); new Worker(u); eval(s); new Function(s); Function(s);';
    expect(check('apps/web/src/a.ts', src)).toEqual(['network@1', 'threads@1', 'eval@1', 'eval@1', 'eval@1']);
    expect(check('packages/net/src/a.ts', 'new RTCPeerConnection(c); new WebSocket(u);')).toEqual([]);
  });

  it('sem relógio nem acaso nos pacotes determinísticos', () => {
    const src = 'Math.random(); Date.now(); performance.now(); new Date(); globalThis.Math.random();';
    expect(check('packages/sim/src/a.ts', src)).toEqual(['clock@1', 'clock@1', 'clock@1', 'clock@1', 'clock@1']);
    expect(check('packages/game/src/a.ts', 'performance.now()')).toEqual([]);
    expect(check('packages/sim/src/a.ts', 'rng.random(); x.Date.now();')).toEqual([]);
  });

  it('regra 10 por lista branca: colchete, desestruturação e alias de Math/Date também caem', () => {
    for (const src of [
      'Math["random"]();',
      'const { random } = Math; random();',
      'const M = Math; M.random();',
      'Date["now"]();',
      'const D = Date;',
      'crypto.getRandomValues(b);',
      'Reflect.get(globalThis, "Math");',
    ]) {
      expect(check('packages/world/src/a.ts', src), src).toContain('clock@1');
    }
    // As funções puras de Math continuam livres, inclusive por colchete literal.
    expect(check('packages/sim/src/a.ts', 'Math.floor(1) + Math.PI + Math["sqrt"](2) + Math.atan2(1, 2);')).toEqual([]);
  });

  it('sem Intl nem toLocale* no código compartilhado', () => {
    expect(check('packages/ui/src/a.ts', 'n.toLocaleString("pt-BR"); new Intl.NumberFormat();')).toEqual([
      'intl@1',
      'intl@1',
    ]);
    expect(check('packages/ui/src/a.ts', "'abc'.toLocaleUpperCase('tr'); 'ABC'.toLocaleLowerCase();")).toEqual([
      'intl@1',
      'intl@1',
    ]);
  });

  it('getExtension só no diagnóstico da casca web', () => {
    expect(check('packages/render/src/a.ts', 'gl.getExtension("EXT_x")')).toEqual(['webgl-extension@1']);
    expect(check('apps/web/src/platform/diagnostics.ts', 'gl.getExtension("WEBGL_debug_renderer_info")')).toEqual([]);
    expect(check('apps/web/src/main.ts', 'gl.getExtension("x")')).toEqual(['webgl-extension@1']);
  });

  it('float/half-float e textura comprimida do three também são proibidos (regra 6)', () => {
    const src = 'new WebGLRenderTarget(4, 4, { type: HalfFloatType }); new CompressedArrayTexture(m, 4, 4, 1);';
    expect(check('packages/render/src/a.ts', src)).toEqual(['three-api@1', 'three-api@1']);
    expect(check('packages/render/src/a.ts', 'const t = { type: FloatType };')).toEqual(['three-api@1']);
  });

  it('partes proibidas do three e do Web Audio', () => {
    const src = 'new THREE.TextureLoader(); new OrbitControls(c); tex.anisotropy = 4; ctx.createOscillator();';
    expect(check('packages/render/src/a.ts', src)).toEqual([
      'three-api@1',
      'three-api@1',
      'three-api@1',
      'audio-api@1',
    ]);
  });

  it('import() dinâmico e require só onde podem', () => {
    expect(check('packages/game/src/a.ts', 'const m = await import("./x.ts");')).toEqual(['dynamic-import@1']);
    expect(check('apps/switch/src/a.ts', 'import("./x.ts")')).toEqual(['dynamic-import@1']);
    expect(check('apps/web/src/a.ts', 'import("./x.ts"); import.meta.url;')).toEqual([]);
    expect(check('packages/game/src/a.ts', 'const fs = require("fs");')).toEqual(['commonjs@1']);
  });

  it('import() só com especificador literal, até em apps/web (template sem ${} conta como literal)', () => {
    expect(check('apps/web/src/a.ts', 'const n = "x"; import(n);')).toEqual(['dynamic-import@1']);
    expect(check('apps/web/src/a.ts', 'import(`./a/${n}.ts`);')).toEqual(['dynamic-import@1']);
    expect(check('apps/web/src/a.ts', 'import(`three`);')).toEqual(['import-three@1', 'import-undeclared@1']);
  });

  it('import.meta só nas cascas', () => {
    expect(check('packages/game/src/a.ts', "const u = new URL('a.png', import.meta.url);")).toEqual([
      'dom@1',
      'import-meta@1',
    ]);
  });
});

describe('globais disfarçados', () => {
  const game = (src: string): string[] => check('packages/game/src/a.ts', src);

  it('colchete com texto vale como ponto', () => {
    expect(game('globalThis["localStorage"].getItem("a");')).toEqual(['dom@1']);
    expect(game("(globalThis as any)['localStorage'].x;")).toEqual(['dom@1']);
    expect(game("globalThis['eval']('1'); new globalThis['Function']('x');")).toEqual(['eval@1', 'eval@1']);
    expect(game("(1)['toLocaleString']();")).toEqual(['intl@1']);
    expect(check('packages/render/src/a.ts', "gl['getExtension']('X');")).toEqual(['webgl-extension@1']);
    // Array literal não é acesso.
    expect(game("const a = ['document', 'fetch']; f(['localStorage']);")).toEqual([]);
  });

  it('raiz global como valor (alias, desestruturação, Reflect, índice dinâmico) não passa no código compartilhado', () => {
    expect(game('const { localStorage: ls } = globalThis;')).toEqual(['dom@1', 'global-root@1']);
    expect(game('const g = globalThis; g.document;')).toEqual(['global-root@1', 'dom@1']);
    expect(game('Reflect.get(globalThis, "fetch");')).toEqual(['dom@1', 'global-root@1']);
    expect(game('const x = globalThis[name];')).toEqual(['global-root@1']);
    // O cast para ler um membro continua permitido (o log do shared lê o console assim).
    const log = 'const c = (globalThis as unknown as { console?: C }).console;';
    expect(check('packages/shared/src/a.ts', log)).toEqual([]);
  });

  it('nas cascas, alias e desestruturação da raiz ainda passam pelas regras de threads/eval/rede', () => {
    const src = 'const { Worker: W } = globalThis; const g = window; new g.Worker("x");';
    expect(check('apps/web/src/a.ts', src)).toEqual(['threads@1', 'threads@1']);
    expect(check('apps/web/src/a.ts', 'new (globalThis as any).Worker("u");')).toEqual(['threads@1']);
  });

  it('código a partir de texto por outros caminhos', () => {
    expect(game("(function () {}).constructor('return 1');")).toEqual(['eval@1']);
    expect(game("setTimeout('alert(1)', 0); setInterval(`x`, 1);")).toEqual(['eval@1', 'eval@1']);
    expect(game('setTimeout(() => go(), 0);')).toEqual([]);
  });

  it('globais do navegador que o nx.js não tem', () => {
    const src = [
      "addEventListener('keydown', f);",
      'const w = innerWidth * devicePixelRatio;',
      'const h = location.href + screen.width;',
      "new Blob([]); new FontFace('a', 'b'); createImageBitmap(x);",
      "new BroadcastChannel('a'); new MessageChannel();",
    ].join('\n');
    expect(game(src)).toEqual([
      'dom@1',
      'dom@2',
      'dom@2',
      'dom@3',
      'dom@3',
      'dom@4',
      'dom@4',
      'dom@4',
      'dom@5',
      'dom@5',
    ]);
  });

  it('declaração local vale só no seu escopo', () => {
    const src = ['function f(document: Doc) {', '  return document.x;', '}', 'export const t = document.title;'];
    expect(game(src.join('\n'))).toEqual(['dom@4']);
    const ok = [
      'class A { location = 1; readonly screen: number = 2 }',
      'interface B { readonly location: string }',
      'export function g(screen: string): string { const location = screen; return location; }',
      'const xs = list.map((location) => location.id);',
      'const f = ({ screen }: P): number => screen;',
      'let a = 0, location = 1;',
      'try { x(); } catch (screen) { log(screen); }',
    ];
    expect(game(ok.join('\n'))).toEqual([]);
  });
});

describe('imports', () => {
  it('three só em render, e sem addons/webgpu', () => {
    expect(check('packages/ui/src/a.ts', "import { Vector3 } from 'three';")).toEqual([
      'import-three@1',
      'import-undeclared@1',
    ]);
    expect(check('packages/render/src/a.ts', "import { WebGLRenderer } from 'three';")).toEqual([]);
    expect(
      check('packages/render/src/a.ts', "import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';"),
    ).toEqual(['three-api@1', 'import-three-addon@1']);
    expect(check('packages/render/src/a.ts', "import * as T from 'three/webgpu';")).toEqual(['import-three-addon@1']);
  });

  it('trystero só em net; net só em apps/web', () => {
    expect(check('packages/net/src/a.ts', "import { joinRoom } from 'trystero';")).toEqual([]);
    expect(check('apps/web/src/a.ts', "import { createNet } from '@boboforces/net';")).toEqual([]);
    expect(check('packages/game/src/a.ts', "import { x } from '@boboforces/net';")).toEqual([
      'import-net@1',
      'import-undeclared@1',
    ]);
    expect(check('apps/switch/src/a.ts', "export { x } from '@boboforces/net';")).toEqual([
      'import-net@1',
      'import-undeclared@1',
    ]);
  });

  it('game só enxerga o render por @boboforces/render/data, até para tipos (compila sem a lib DOM)', () => {
    for (const src of [
      "import type { Renderer } from '@boboforces/render';",
      "export type { Renderer } from '@boboforces/render';",
      "import { createRenderer } from '@boboforces/render';",
      "import { type Renderer } from '@boboforces/render';",
    ]) {
      expect(check('packages/game/src/a.ts', src)).toEqual(['import-render@1']);
    }
    expect(check('packages/game/src/a.ts', "import { createActorBuffer } from '@boboforces/render/data';")).toEqual([]);
    expect(check('packages/game/src/a.ts', "import type { Renderer } from '@boboforces/render/data';")).toEqual([]);
  });

  it('dependência precisa estar no package.json; node:* nunca', () => {
    expect(check('packages/sim/src/a.ts', "import { x } from '@boboforces/shared/sub';")).toEqual([]);
    expect(check('packages/sim/src/a.ts', "import { inflateSync } from 'fflate';")).toEqual(['import-undeclared@1']);
    expect(check('packages/sim/src/a.ts', "import { readFileSync } from 'node:fs';")).toEqual(['import-node@1']);
  });

  it('import relativo não pode entrar em outro pacote (arquivos da raiz, como version.json, podem)', () => {
    expect(check('packages/sim/src/a.ts', "import { t } from '../../ui/src/strings.pt-BR.ts';")).toEqual([
      'import-cross-workspace@1',
    ]);
    expect(check('packages/sim/src/x/a.ts', "import { b } from '../b.ts';")).toEqual([]);
    expect(check('packages/sim/src/a.ts', "import v from '../../../version.json' with { type: 'json' };")).toEqual([]);
  });
});

describe('imports do M1', () => {
  const m1: CheckContext = {
    workspaces: [
      ...ctx.workspaces,
      ws('packages/world', '@boboforces/world', ['@boboforces/shared', '@boboforces/render', 'vite']),
      ws('tools/audioconv', '@boboforces/audioconv', ['@breezystack/lamejs']),
      ws('tools/mapc', '@boboforces/mapc', ['@boboforces/world']),
    ],
  };
  const checkM1 = (rel: string, src: string): string[] =>
    checkFile(rel, src, m1).violations.map((v) => `${v.rule}@${v.line}`);

  it('render/data continua o único caminho do game ao render; os outros pacotes nem isso (até declarando)', () => {
    expect(checkM1('packages/world/src/a.ts', "import type { Renderer } from '@boboforces/render/data';")).toEqual([
      'import-render@1',
    ]);
    expect(checkM1('packages/world/src/a.ts', "import { createRenderer } from '@boboforces/render';")).toEqual([
      'import-render@1',
    ]);
    expect(checkM1('packages/render/src/a.ts', "import { x } from '@boboforces/render/data';")).toEqual([]);
    expect(checkM1('apps/web/src/a.ts', "import { createRenderer } from '@boboforces/render';")).toEqual([
      'import-undeclared@1',
    ]);
    expect(checkM1('packages/game/src/a.ts', "import type { TextureMode } from '@boboforces/render/data';")).toEqual(
      [],
    );
  });

  it('ferramentas e dependências de desenvolvimento nunca no código do jogo (lamejs é LGPL)', () => {
    expect(checkM1('packages/world/src/a.ts', "import { defineConfig } from 'vite';")).toEqual(['import-tooling@1']);
    expect(checkM1('apps/web/src/a.ts', "import { Mp3Encoder } from '@breezystack/lamejs';")).toEqual([
      'import-tooling@1',
      'import-undeclared@1',
    ]);
    expect(checkM1('apps/switch/src/a.ts', "import { build } from 'esbuild';")).toEqual([
      'import-tooling@1',
      'import-undeclared@1',
    ]);
    expect(checkM1('packages/game/src/a.ts', "import { compileMap } from '@boboforces/mapc';")).toEqual([
      'import-tooling@1',
      'import-undeclared@1',
    ]);
    expect(checkM1('apps/web/src/a.ts', "import { chromium } from 'playwright-core';")).toEqual([
      'import-tooling@1',
      'import-undeclared@1',
    ]);
    // Testes, .d.ts e as ferramentas em si ficam fora da varredura (só packages/* e apps/*).
    expect(checkM1('tools/audioconv/src/mp3.ts', "import { Mp3Encoder } from '@breezystack/lamejs';")).toEqual([]);
  });
});

describe('assets em tempo de execução (regra 23)', () => {
  const runtime = (files: Record<string, string>, preload: string[] = []): string =>
    JSON.stringify({ files, preload }, null, 2);

  it('aceita PNG, MP3, JSON e binários próprios com a mesma extensão dos dois lados', () => {
    const src = runtime(
      {
        'fonts/ui-fonts.png': 'fonts/generated/ui-fonts.generated.png',
        'textures/blocos16.mips.png': 'textures/generated/blocos16.mips.png',
        'blocks/blocks.json': 'blocks/generated/blocks.json',
        'maps/construto.bfmap': 'maps/generated/construto.bfmap',
        'models/modelos.bfmodel': 'models/generated/modelos.bfmodel',
        'audio/t0-tiro.mp3': 'audio/generated/t0-tiro.mp3',
      },
      ['fonts/ui-fonts.png'],
    );
    expect(checkRuntimeAssets(src)).toEqual([]);
  });

  it('recusa OGG, JPEG, textura comprimida, extensão trocada e preload fora de files, apontando a linha', () => {
    const src = runtime(
      {
        'audio/tiro.ogg': 'audio/generated/tiro.ogg',
        'textures/ceu.jpg': 'textures/ceu.jpg',
        'textures/x.png': 'textures/x.ktx2',
        'maps/a.bfmap': 'maps/a.json',
        'blocks/blocks.json': 'blocks/blocks.json',
      },
      ['fonts/ui-fonts.png'],
    );
    const found = checkRuntimeAssets(src);
    expect(found.map((v) => `${v.rule}@${v.line}`)).toEqual([
      'asset-format@3',
      'asset-format@4',
      'asset-format@5',
      'asset-format@6',
      'asset-format@10',
    ]);
    expect(found[2]?.message).toContain("'textures/x.png' → 'textures/x.ktx2'");
    expect(found[3]?.message).toContain('extensões diferentes');
    expect(found[4]?.message).toContain("preload 'fonts/ui-fonts.png' não está em files");
    expect(found.every((v) => v.file === 'assets-src/runtime-assets.json')).toBe(true);
  });

  it('JSON quebrado vira violação (não derruba o guard)', () => {
    expect(checkRuntimeAssets('{ "files": ').map((v) => v.rule)).toEqual(['asset-format']);
  });
});

describe('laço quente (regra 11; E.9 do porte)', () => {
  const hot = (rel: string, body: string[]): string[] =>
    check(
      rel,
      ['export function f(m: Float32Array, o: number): void {', '  // quente:', ...body, '  // fim-quente', '}'].join(
        '\n',
      ),
    );

  it('reprova as 7 construções proibidas entre os marcadores, com a linha de cada uma', () => {
    const body = [
      '  const v = new Float32Array(4);', // 3
      '  const a = [1, 2];', // 4
      '  const p = { x: 1 };', // 5
      '  const g = (k: number) => k + 1;', // 6
      '  list.map(h).filter(q).forEach(z); xs.slice(1).concat(ys);', // 7
      '  const s = `id ${o} e ${m[o]}`;', // 8
      '  call(...args);', // 9
    ];
    expect(hot('packages/render/src/actors/anim/a.ts', body)).toEqual([
      'hot-loop@3',
      'hot-loop@4',
      'hot-loop@5',
      'hot-loop@6',
      'hot-loop@7',
      'hot-loop@7',
      'hot-loop@7',
      'hot-loop@7',
      'hot-loop@7',
      'hot-loop@8',
      'hot-loop@9',
    ]);
    const report = checkFile(
      'packages/sim/src/a.ts',
      ['// quente:', 'const s = `x`;', '// fim-quente'].join('\n'),
      ctx,
    );
    expect(report.violations[0]?.message).toMatch(/^template string: laço quente/);
  });

  it('o código típico do laço quente passa: índices, contas, laços, ternário, blocos, case e tipos', () => {
    const body = [
      '  const c = -Math.cos(m[o]!);',
      '  for (let k = 0; k < 4; k++) {',
      '    m[o + k] = k > 1 ? (c < 0 ? 0 : c) : m[o + HF.r00]! * c;',
      '  }',
      '  switch (o) {',
      '    case 1: {',
      '      m[0] = 1;',
      '      break;',
      '    }',
      '    default: {',
      '      m[1] = 2;',
      '    }',
      '  }',
      '  if (c > 0) { m[2] = c; } else { m[2] = -c; }',
      '  const t: { x: number } = scratch;',
      '  const u: number[] = list;',
      '  out.set(m.subarray(0, 4), 8); m.fill(0); this.#buf[o] = `x`.length;',
      '  const w = rows[o]![1]! + fn(o)[2]! + (m as Float32Array)[3]!;',
      '  for (const k of list) total += k;',
    ];
    expect(hot('packages/format/src/model/a.ts', body)).toEqual(['hot-loop@19']);
  });

  it('região quente em volta de funções inteiras: as assinaturas (`: void {`, padrões) não são literais', () => {
    const src = [
      '// quente:',
      'export function px(x: number, y: number, rgb: number, w = 1, h = 1): void {',
      '  T[y * 64 + x] = rgb;',
      '}',
      'function ring(p: number): number | null {',
      '  return p > 0 ? p : null;',
      '}',
      'function scratch(): Promise<void> {',
      '  return done;',
      '}',
      'function bad(o = {}): void {',
      '  m[0] = o.x;',
      '}',
      '// fim-quente',
    ].join('\n');
    expect(check('packages/format/src/model/a.ts', src)).toEqual(['hot-loop@11']);
  });

  it('desestruturação por array e ternário com objeto também alocam', () => {
    expect(hot('packages/sim/src/a.ts', ['  const [a, b] = pair;', '  const r = ok ? m : { x: 0 };'])).toEqual([
      'hot-loop@3',
      'hot-loop@4',
    ]);
    expect(hot('packages/sim/src/a.ts', ['  return { a: 1 };'])).toEqual(['hot-loop@3']);
    expect(hot('packages/sim/src/a.ts', ['  f(o, { a: 1 });', '  throw new Error(`x`);'])).toEqual([
      'hot-loop@3',
      'hot-loop@4',
      'hot-loop@4',
    ]);
  });

  it('fora dos marcadores vale tudo; o marcador no fim de uma linha só pega o que vem depois', () => {
    const src = [
      'const a = [1].map((x) => ({ x }));',
      'function f() { const b = [2]; // quente:',
      '  m[0] = 1;',
      '  const c = { k: 1 }; // fim-quente',
      '  return `${a}${b}`;',
      '}',
      '/** Um componente quente: o texto no meio de um comentário não é marcador. */',
      'const d = new Map();',
    ].join('\n');
    expect(check('packages/game/src/a.ts', src)).toEqual(['hot-loop@4']);
  });

  it('marcadores órfãos reprovam: fim sem início, região sem fim e região dentro de região', () => {
    expect(check('packages/sim/src/a.ts', 'x();\n// fim-quente')).toEqual(['hot-loop@2']);
    expect(check('packages/sim/src/a.ts', '// quente: figureFk\nm[0] = 1;\nconst a = [];')).toEqual([
      'hot-loop@1',
      'hot-loop@3',
    ]);
    expect(check('packages/sim/src/a.ts', '// quente:\n// quente:\nm[0] = 1;\n// fim-quente')).toEqual(['hot-loop@2']);
  });

  it('as funções e arquivos do E.9 não podem perder os marcadores', () => {
    // Corpo dentro da região (inteira ou em parte, mesmo com tipo de retorno literal): ok.
    const inside = [
      'export function figureFk(m: Float32Array): { ok: boolean } {',
      '  const k = 1;',
      '  // quente:',
      '  m[0] = k;',
      '  // fim-quente',
      '  return ok;',
      '}',
    ].join('\n');
    expect(check('packages/format/src/model/figure.ts', inside)).toEqual([]);
    expect(
      check('packages/sim/src/hitbox.ts', '// quente:\nfunction rayVsBobo(): void {\n  m[0] = 1;\n}\n// fim-quente'),
    ).toEqual([]);
    // Sem região no corpo (a região de outra função não vale), em qualquer arquivo: reprova no nome.
    const outside = [
      'function a(): void {',
      '  // quente:',
      '  m[0] = 1;',
      '  // fim-quente',
      '}',
      'export function paintFigureSkin(r: number, out: Uint8Array): void {',
      '  out[0] = r;',
      '}',
      'export function figureHitBoxes(t: number): void;',
    ].join('\n');
    expect(check('packages/format/src/model/x.ts', outside)).toEqual(['hot-loop@6']);
    // Chamada não é declaração; arquivo do E.9 sem região nenhuma reprova na linha 1.
    expect(check('packages/sim/src/a.ts', 'figureGamePose(t, 0, 0, out, 0);')).toEqual([]);
    expect(check('packages/render/src/actors/anim/rig.ts', 'export const x = 1;')).toEqual(['hot-loop@1']);
    expect(
      check('packages/render/src/actors/figure-instances.ts', 'x();\n// quente:\nm[0] = 1;\n// fim-quente'),
    ).toEqual([]);
    expect(check('packages/render/src/actors/anim/motion-math.ts', 'export const x = 1;')).toEqual([]);
  });

  it('vale nas cascas também, e o guard-allow silencia a linha com motivo', () => {
    expect(check('apps/web/src/a.ts', '// quente:\nconst a = [];\n// fim-quente')).toEqual(['hot-loop@2']);
    const src =
      '// quente:\nconst a = new Float32Array(4); // guard-allow: hot-loop rascunho criado uma vez\n// fim-quente';
    const report = checkFile('packages/render/src/a.ts', src, ctx);
    expect(report.violations).toEqual([]);
    expect(report.suppressed).toBe(1);
  });
});

describe('guard-allow', () => {
  it('silencia só a regra citada, na linha ou na de cima, e exige motivo', () => {
    const src = [
      '// guard-allow: dom a casca de teste precisa',
      'fetch(a);',
      'fetch(b); // guard-allow: dom motivo',
      'eval(c); // guard-allow: dom motivo',
      'fetch(d); // guard-allow: dom',
    ].join('\n');
    const report = checkFile('packages/ui/src/a.ts', src, ctx);
    expect(report.violations.map((v) => `${v.rule}@${v.line}`)).toEqual(['eval@4', 'dom@5']);
    expect(report.suppressed).toBe(2);
  });
});
