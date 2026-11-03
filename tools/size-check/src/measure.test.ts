import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BUDGETS, KB, type Budget } from './budgets.ts';
import {
  checkBudgets,
  formatBytes,
  htmlInitialRefs,
  measureDist,
  resolveRef,
  staticImports,
  transferSize,
} from './measure.ts';

/** Bytes pseudoaleatórios determinísticos (incompressíveis), para simular PNG e MP3. */
function noise(length: number, seed: number): Uint8Array {
  const out = new Uint8Array(length);
  let s = seed >>> 0;
  for (let i = 0; i < length; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out[i] = s >>> 24;
  }
  return out;
}

const HTML = `<!doctype html><html><head>
<link rel="icon" href="/favicon.svg" />
<link rel="manifest" href="/manifest.webmanifest" />
<script type="module" crossorigin src="./assets/index-a.js"></script>
<link rel="modulepreload" crossorigin href="./assets/core-b.js">
<link rel="stylesheet" crossorigin href="./assets/index-c.css">
<script>window.__bfEs = 1;</script>
</head><body></body></html>`;

describe('size-check', () => {
  let dist = '';

  function put(path: string, content: string | Uint8Array): void {
    const full = join(dist, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }

  beforeAll(() => {
    dist = mkdtempSync(join(tmpdir(), 'bf-size-check-'));
    put('index.html', HTML);
    put('favicon.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
    put('manifest.webmanifest', '{"name":"x"}');
    put(
      'assets/index-a.js',
      'import{a as b}from"./core-b.js";import"./three-c.js";const l=()=>import("./lazy-d.js");console.log(b,l);',
    );
    put('assets/core-b.js', 'export const a=1;export*from"./shared-e.js";const u=import.meta.url;');
    put('assets/shared-e.js', 'export const s=2;');
    put('assets/three-c.js', 'export const REVISION="187";'.repeat(50));
    put('assets/lazy-d.js', 'export const lazy=3;');
    put('assets/index-c.css', 'body{margin:0}');
    put('assets/blocks-f.png', noise(4000, 7));
    put('music/menu.mp3', noise(9000, 9));
    put('assets/index-a.js.map', '{"mappings":""}');
    put('.vite/manifest.json', '{}');
  });

  afterAll(() => {
    if (dist) rmSync(dist, { recursive: true, force: true });
  });

  it('acha os imports estáticos e ignora import() dinâmico e import.meta', () => {
    expect(
      staticImports(
        'import"./a.js";import x from"./b.js";import*as t from "./c.js";import{y as z}from\'./d.js\';' +
          'export{q}from"./e.js";export*from"./f.js";const g=import("./g.js");new URL("h.png",import.meta.url);',
      ),
    ).toEqual(['./a.js', './b.js', './c.js', './d.js', './e.js', './f.js']);
  });

  it('lê scripts, modulepreload e CSS do HTML, mas não ícone nem manifest', () => {
    expect(htmlInitialRefs(HTML)).toEqual(['./assets/index-a.js', './assets/core-b.js', './assets/index-c.css']);
  });

  it('resolve referências relativas ao arquivo, à raiz e descarta externas', () => {
    expect(resolveRef('index.html', './assets/x.js')).toBe('assets/x.js');
    expect(resolveRef('assets/a.js', './b.js?v=1')).toBe('assets/b.js');
    expect(resolveRef('assets/a.js', '../favicon.svg')).toBe('favicon.svg');
    expect(resolveRef('assets/a.js', '/favicon.svg')).toBe('favicon.svg');
    expect(resolveRef('index.html', 'https://example.com/x.js')).toBeNull();
    expect(resolveRef('index.html', '//cdn.example.com/x.js')).toBeNull();
    expect(resolveRef('index.html', 'data:text/javascript,1')).toBeNull();
    expect(resolveRef('index.html', '../fora.js')).toBeNull();
  });

  it('mede texto em gzip e binário cru', () => {
    const text = new TextEncoder().encode('a'.repeat(5000));
    expect(transferSize('x.js', text)).toBeLessThan(100);
    const bin = noise(5000, 3);
    expect(transferSize('x.png', bin)).toBe(5000);
  });

  it('monta a carga inicial pelo fecho de imports estáticos', () => {
    const report = measureDist(dist);
    expect(report.initial.map((f) => f.path)).toEqual([
      'assets/core-b.js',
      'assets/index-a.js',
      'assets/index-c.css',
      'assets/shared-e.js',
      'assets/three-c.js',
      'index.html',
    ]);
    expect(report.files.some((f) => f.path.endsWith('.map') || f.path.startsWith('.vite/'))).toBe(false);
    expect(report.files.some((f) => f.path === 'assets/lazy-d.js')).toBe(true);
    // O MP3 (9000 B) fica fora do "maior arquivo"; o PNG (4000 B) é o maior.
    expect(report.largest?.path).toBe('assets/blocks-f.png');
    expect(report.total).toBeGreaterThan(13000);
    expect(report.initialTotal).toBeLessThan(report.total);
  });

  it('passa nos orçamentos reais e reprova quando um estoura', () => {
    const report = measureDist(dist);
    expect(checkBudgets(report).every((r) => r.ok)).toBe(true);
    const tight: Budget[] = BUDGETS.map((b) => (b.id === 'largest' ? { ...b, limit: 1 * KB } : b));
    const results = checkBudgets(report, tight);
    const largest = results.find((r) => r.budget.id === 'largest');
    expect(largest?.ok).toBe(false);
    expect(largest?.file).toBe('assets/blocks-f.png');
    expect(results.filter((r) => !r.ok)).toHaveLength(1);
  });

  it('formata bytes em pt-BR', () => {
    expect(formatBytes(999)).toBe('999 B');
    expect(formatBytes(15_000)).toBe('15,0 KB');
    expect(formatBytes(2_345_678)).toBe('2,35 MB');
  });

  it('recusa pasta sem index.html', () => {
    const empty = mkdtempSync(join(tmpdir(), 'bf-size-check-vazio-'));
    try {
      expect(() => measureDist(empty)).toThrow(/index\.html/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
