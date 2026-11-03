import { describe, expect, it } from 'vitest';
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
