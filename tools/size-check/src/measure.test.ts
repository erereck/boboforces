import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BUDGETS, FONT_TEXT_GZIP_LEVEL, KB, MB, UI_FONT_FILES, type Budget } from './budgets.ts';
import {
  checkBudgets,
  classifyFile,
  formatBytes,
  formatReport,
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

/** JSON do atlas de fontes: texto repetitivo (o gzip encolhe bem, como o de verdade). */
const FONT_JSON = JSON.stringify({
  format: 'boboforces/ui-fonts@1',
  glyphs: Array.from({ length: 200 }, (_, i) => [i, 9, 12]),
});

const HTML = `<!doctype html><html><head>
<link rel="icon" href="/favicon.svg" />
<link rel="manifest" href="/manifest.webmanifest" />
<script type="module" crossorigin src="./assets/index-a.js"></script>
<link rel="modulepreload" crossorigin href="./assets/core-b.js">
<link rel="stylesheet" crossorigin href="./assets/index-c.css">
<link rel="preload" as="fetch" crossorigin href="./assets/fonts/ui-fonts.json">
<link rel="preload" as="fetch" crossorigin href="./assets/fonts/ui-fonts.png">
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
    put('assets/shell-g.js', 'export const bench=4;');
    put('assets/index-c.css', 'body{margin:0}');
    put('assets/blocks-f.png', noise(4000, 7));
    put('music/menu.mp3', noise(9000, 9));
    put('assets/index-a.js.map', '{"mappings":""}');
    put('.vite/manifest.json', '{}');
    // Assets do jogo (M1): menu, primeira partida e sob demanda.
    put('assets/fonts/ui-fonts.png', noise(1500, 1));
    put('assets/fonts/ui-fonts.json', FONT_JSON);
    put('assets/maps/construto.bfmap', noise(2000, 2));
    put('assets/models/modelos.bfmodel', noise(500, 3));
    put('assets/blocks/blocks.json', '{"blocks":[]}');
    put('assets/textures/blocos16.png', noise(1200, 4));
    put('assets/models/modelos64-modelos.png', noise(800, 5));
    put('assets/skins/partes64.png', noise(700, 6));
    put('assets/audio/tiro.mp3', noise(600, 8));
    put('assets/audio/t0-tiro.mp3', noise(3000, 10));
    put('assets/maps/ringue.bfmap', noise(900, 12));
    put('assets/props/novo.png', noise(300, 13));
    put('bench/index.html', '<!doctype html><script>location.replace("../?bench")</script>');
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

  it('lê scripts, modulepreload, CSS e preload do HTML, mas não ícone nem manifest', () => {
    expect(htmlInitialRefs(HTML)).toEqual([
      './assets/index-a.js',
      './assets/core-b.js',
      './assets/index-c.css',
      './assets/fonts/ui-fonts.json',
      './assets/fonts/ui-fonts.png',
    ]);
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
      'assets/fonts/ui-fonts.json',
      'assets/fonts/ui-fonts.png',
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

  it('M1: primeira partida = menu + assets da partida; sob demanda e fora de assets/ ficam de fora', () => {
    const report = measureDist(dist);
    const paths = (files: readonly { path: string }[]): string[] => files.map((f) => f.path).sort();
    expect(paths(report.groups.construto.files)).toEqual([
      'assets/blocks/blocks.json',
      'assets/maps/construto.bfmap',
      'assets/models/modelos.bfmodel',
    ]);
    expect(paths(report.groups.textures.files)).toEqual([
      'assets/models/modelos64-modelos.png',
      'assets/textures/blocos16.png',
    ]);
    // Porte do boneco (#56): as partes de skin do bobo A saem das texturas; enquanto existirem, contam na partida.
    expect(paths(report.retired.files)).toEqual(['assets/skins/partes64.png']);
    expect(paths(report.groups.sounds.files)).toEqual(['assets/audio/tiro.mp3']);
    // Sem grupo conta na partida (conservador): o PNG solto do Vite, a pasta nova e o código preguiçoso da cena
    // (integração do M1); a casca do bench (`shell-*`) fica de fora.
    expect(paths(report.groups.other.files)).toEqual([
      'assets/blocks-f.png',
      'assets/lazy-d.js',
      'assets/props/novo.png',
    ]);
    expect(paths(report.onDemand)).toEqual(['assets/audio/t0-tiro.mp3', 'assets/maps/ringue.bfmap']);
    const first = new Set(report.firstMatch.map((f) => f.path));
    for (const f of report.initial) expect(first.has(f.path)).toBe(true);
    for (const out of ['assets/shell-g.js', 'bench/index.html', 'favicon.svg', 'assets/audio/t0-tiro.mp3']) {
      expect(first.has(out), out).toBe(false);
    }
    expect(first.has('assets/skins/partes64.png')).toBe(true);
    expect(report.firstMatchTotal).toBe(report.firstMatch.reduce((s, f) => s + f.transfer, 0));
    expect(report.groups.construto.total).toBe(2000 + 500 + report.groups.construto.files[0]!.transfer);
  });

  it('M1: orçamentos por grupo reprovam sozinhos', () => {
    const report = measureDist(dist);
    const ids = BUDGETS.map((b) => b.id);
    expect(ids).toEqual([
      'html',
      'initial',
      'fonts',
      'firstMatch',
      'construto',
      'textures',
      'sounds',
      'total',
      'largest',
    ]);
    expect(BUDGETS.find((b) => b.id === 'firstMatch')?.limit).toBe(1 * MB);
    const tight = BUDGETS.map((b) => (b.id === 'textures' ? { ...b, limit: 1 * KB } : b));
    const failed = checkBudgets(report, tight).filter((r) => !r.ok);
    expect(failed.map((r) => r.budget.id)).toEqual(['textures']);
    // blocos16 (1200) + modelos64-modelos (800); o partes64 (700) é aposentado e fica fora.
    expect(failed[0]?.value).toBe(2000);
    expect(formatReport(report, checkBudgets(report), false)).toContain('    Construto (mapa, modelos e blocos)');
    expect(formatReport(report, checkBudgets(report), false)).toContain('assets sem grupo');
  });

  it('decisão #54: sub-orçamento das fontes = PNG cru + JSON gzip do atlas, dentro do menu', () => {
    const report = measureDist(dist);
    expect(report.fonts.files.map((f) => f.path)).toEqual(['assets/fonts/ui-fonts.json', 'assets/fonts/ui-fonts.png']);
    // O JSON das fontes vai pelo limite de cima calibrado no GitHub Pages (nível 4), não pelo gzip -9 do resto.
    expect(FONT_TEXT_GZIP_LEVEL).toBe(4);
    const bytes = new TextEncoder().encode(FONT_JSON);
    const json = gzipSync(bytes, { level: FONT_TEXT_GZIP_LEVEL }).length;
    expect(transferSize('assets/fonts/ui-fonts.json', bytes)).toBe(json);
    expect(transferSize('assets/other.json', bytes)).toBe(gzipSync(bytes, { level: 9 }).length);
    expect(report.fonts.total).toBe(1500 + json);
    const fonts = BUDGETS.find((b) => b.id === 'fonts');
    expect(fonts).toMatchObject({ parent: 'initial', limit: 120 * KB });
    const initial = new Set(report.initial.map((f) => f.path));
    for (const f of report.fonts.files) expect(initial.has(f.path), f.path).toBe(true);
    expect(formatReport(report, checkBudgets(report), false)).toContain('    Fontes (atlas MSDF: PNG + JSON)');
    // Só o atlas da UI conta: outra coisa na pasta de fontes não entra no sub-orçamento.
    expect(UI_FONT_FILES.test('assets/fonts/fontes-candidatas.png')).toBe(false);
  });

  it('decisão #54: atlas de fontes acima de 120 KB estoura só o sub-orçamento', () => {
    const big = mkdtempSync(join(tmpdir(), 'bf-size-check-fontes-'));
    try {
      writeFileSync(
        join(big, 'index.html'),
        '<!doctype html><link rel="preload" as="fetch" href="./assets/fonts/ui-fonts.png">' +
          '<link rel="preload" as="fetch" href="./assets/fonts/ui-fonts.json">',
      );
      mkdirSync(join(big, 'assets', 'fonts'), { recursive: true });
      writeFileSync(join(big, 'assets', 'fonts', 'ui-fonts.png'), noise(120_000, 21));
      writeFileSync(join(big, 'assets', 'fonts', 'ui-fonts.json'), FONT_JSON);
      const report = measureDist(big);
      expect(report.fonts.total).toBeGreaterThan(120 * KB);
      const failed = checkBudgets(report).filter((r) => !r.ok);
      expect(failed.map((r) => r.budget.id)).toEqual(['fonts']);
      expect(formatReport(report, checkBudgets(report), false)).toContain('ESTOUROU');
    } finally {
      rmSync(big, { recursive: true, force: true });
    }
  });

  it('M1: classifica pelo caminho', () => {
    const none = new Set<string>();
    expect(classifyFile('assets/maps/construto.bfmap', none)).toBe('construto');
    expect(classifyFile('assets/models/modelos.bfmodel', none)).toBe('construto');
    expect(classifyFile('assets/models/modelos64-modelos.mips.png', none)).toBe('textures');
    expect(classifyFile('assets/skins/modelos64-rostos.json', none)).toBe('retired');
    expect(classifyFile('assets/skins/modelos64-rostos.mips.png', none)).toBe('retired');
    expect(classifyFile('assets/skins/partes64.json', none)).toBe('retired');
    expect(classifyFile('assets/textures/modelos64-materiais.png', none)).toBe('textures');
    // Outra coisa na pasta de skins não é aposentada: fica sem grupo (aviso), como asset novo.
    expect(classifyFile('assets/skins/outra.png', none)).toBe('other');
    expect(classifyFile('assets/audio/t0-ui.mp3', none)).toBe('onDemand');
    expect(classifyFile('assets/music/menu.mp3', none)).toBe('onDemand');
    expect(classifyFile('assets/net-x.js', none)).toBe('outside');
    expect(classifyFile('licencas.txt', none)).toBe('outside');
    expect(classifyFile('assets/fonts/ui-fonts.png', new Set(['assets/fonts/ui-fonts.png']))).toBe('initial');
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
