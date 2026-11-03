import { describe, expect, it } from 'vitest';
import { scanBundle } from './scan.ts';

const rules = (code: string): string[] => scanBundle(code).map((f) => `${f.rule}:${f.what}@${f.line}`);

describe('varredura do bundle', () => {
  it('acha rede, threads, armazenamento, eval, WASM e P2P em qualquer posição', () => {
    const code = [
      'const ws = new globalThis.WebSocket(u);',
      'const w = new Worker(u); const sab = new SharedArrayBuffer(8);',
      'x.localStorage.getItem("a");',
      'eval(s); new Function(s);',
      'WebAssembly.instantiate(b);',
      'var import_trystero = {};',
    ].join('\n');
    expect(rules(code)).toEqual([
      'rede:WebSocket@1',
      'threads:Worker@2',
      'threads:SharedArrayBuffer@2',
      'armazenamento:localStorage@3',
      'eval:eval@4',
      'eval:new Function@4',
      'wasm:WebAssembly@5',
      'p2p:import_trystero@6',
    ]);
  });

  it('o que o three tem atrás de typeof (document, window, navigator, self) não reprova', () => {
    const code = [
      'if (typeof window !== "undefined") window.__THREE__ = "187";',
      'const ok = typeof navigator === "undefined" ? false : /Oculus/.test(navigator.userAgent);',
      'if (typeof self !== "undefined") animation.setContext(self);',
      'function createElementNS(name) { return document.createElementNS("http://www.w3.org/1999/xhtml", name); }',
      'gl.getExtension("EXT_color_buffer_float");',
    ].join('\n');
    expect(rules(code)).toEqual([]);
  });

  it('strings e comentários não contam; membros comuns (obj.process, x.require) também não', () => {
    const code =
      '// new WebSocket(u)\nconst s = "localStorage eval(x)"; job.process(); m.require(); const o = { process: 1 };';
    expect(rules(code)).toEqual([]);
  });

  it('fetch é rede (o Switch é 100% offline): livre ou pela raiz global, mas não como membro de outro objeto', () => {
    const code = 'fetch("http://example.com/x");\nglobalThis.fetch(u);\nloader.fetch(u); const o = { fetch: 1 };';
    expect(rules(code)).toEqual(['rede:fetch@1', 'rede:globalThis.fetch@2']);
  });

  it('texto entre colchetes vale como o nome acessado', () => {
    const code = [
      'g["localStorage"].getItem("a");',
      "globalThis['fetch'](u);",
      'x["eval"](s); globalThis["Function"]("x");',
      'const nomes = ["screen", "navigator"];',
    ].join('\n');
    expect(rules(code)).toEqual([
      'armazenamento:["localStorage"]@1',
      'rede:["fetch"]@2',
      'eval:["eval"]@3',
      'eval:["Function"]@3',
    ]);
  });

  it('restos de Node e de módulos', () => {
    const code = 'const fs = require("fs"); process.env.X; import("./a.js"); import.meta.url; export { a };';
    expect(rules(code)).toEqual([
      'node:require@1',
      'node:process@1',
      'modulos:import()@1',
      'modulos:import.meta@1',
      'modulos:export@1',
    ]);
  });
});
