/// <reference lib="dom" />
// Bench do PC de referência no Edge (PLANO_M1 critério 5; números para o docs/PERF.md). Frente "web-bench".
//
//   npm run build && npm run bench -- --views 4 --bots 24 --duration 120
//   npm run bench -- --vistas 1 --bots 40 --visao 140 --atlas --float     (apelidos pt-BR e bandeiras valem)
//   npm run bench -- --janela                     com janela (GPU e vsync de verdade; o padrão é headless)
//   npm run bench -- --url https://erereck.github.io/boboforces/          contra o site publicado
//   npm run bench -- --tela 1920x1080             tamanho da janela (padrão 1280x720)
//   npm run bench -- --janela --gpu-alto          GPU dedicada no notebook híbrido (o Edge fica na integrada sem isso)
//   npm run bench -- --janela --sem-vsync         sem vsync nem limite de quadros (mede a folga acima do teto da tela)
//
// Todo `--chave valor` que não é do script vira parâmetro da URL (`?bench&chave=valor`; `--atlas` vira `atlas=1`), com
// os mesmos nomes de `BENCH_PARAMS` do game e os apelidos pt-BR da casca. O script abre o build, espera o relatório
// (`window.__bfDebug.benchReport`, preenchido pelo `GameHooks.onBenchReport`) e grava em
// local/m1/bench/<AAAA-MM-DD-HHMM>-<resumo>.txt, mais um .json com URL, navegador e erros do console. Sai com 1 se o
// relatório não vier, trouxer `erros=` diferente de 0 ou o console tiver erro.
//
// Colunas do porte do boneco (decisão #56): draws de bonecos por vista (`actorDraws`), bonecos por nível de animação
// (`figure_lod` L0/L1/L2) e a etapa "figuras" do loading. Vêm do relatório do game (`FIGURE_REPORT_KEYS`, desde o
// passo 5); as amostras de `__bfDebug.stats` a cada 1 s durante a rodada ficam de reserva (relatório antigo ou
// interrompido). Saem na linha `porte_boneco …` do console e no `figures` do .json; o .txt é o relatório do game.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ConsoleMessage } from 'playwright-core';
import { parseArgs, stamp } from '../apps/web/scripts/args.ts';
import {
  EDGE_HIGH_PERFORMANCE_GPU,
  EDGE_NO_VSYNC,
  launchEdge,
  REPO_ROOT,
  startPreview,
  type PageWindow,
} from '../apps/web/scripts/edge.ts';
import { figureColumns, formatFigureColumns, type FigureSample } from '../apps/web/scripts/prints-plan-figures.ts';

const SAMPLE_INTERVAL_MS = 1000;

/** Opções do próprio script (o resto vai para a URL). */
const SCRIPT_OPTIONS = new Set(['url', 'janela', 'headed', 'tela', 'limite', 'gpu-alto', 'sem-vsync']);
const LOADING_ALLOWANCE_S = 120;

const args = parseArgs(process.argv.slice(2));
const remoteUrl = typeof args.get('url') === 'string' ? (args.get('url') as string) : null;
const headless = !(args.has('janela') || args.has('headed'));
const screenArg = args.get('tela');
const [screenW, screenH] =
  typeof screenArg === 'string' && /^\d+x\d+$/.test(screenArg) ? screenArg.split('x').map(Number) : [1280, 720];

const query = new URLSearchParams();
query.set('bench', '');
for (const [key, value] of args) {
  if (SCRIPT_OPTIONS.has(key)) continue;
  query.set(key, value === true ? '1' : value);
}
const search = `?${query.toString().replace(/^bench=(&|$)/, 'bench$1')}`;

const server = remoteUrl ? null : await startPreview();
const url = new URL(search, remoteUrl ?? server!.url).href;
const highPerformanceGpu = args.has('gpu-alto');
const noVsync = args.has('sem-vsync');
const { browser, fallback } = await launchEdge({
  headless,
  args: [...(highPerformanceGpu ? [EDGE_HIGH_PERFORMANCE_GPU] : []), ...(noVsync ? EDGE_NO_VSYNC : [])],
});
const browserName = `${fallback ? 'Chrome' : 'Edge'} ${browser.version()}`;
const consoleErrors: string[] = [];
const problems: string[] = [];
if (fallback) problems.push(fallback);
let report: string | null = null;
let bench: Readonly<Record<string, unknown>> | null = null;
let warnings: readonly string[] = [];
let log: readonly string[] = [];
let samples: FigureSample[] = [];

console.log(
  `bench: ${url} (${browserName}, ${headless ? 'headless' : 'com janela'}${highPerformanceGpu ? ', GPU dedicada' : ''}${noVsync ? ', sem vsync' : ''}, ${screenW}x${screenH})`,
);
try {
  const page = await browser.newPage({ viewport: { width: screenW!, height: screenH! }, deviceScaleFactor: 1 });
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => (window as unknown as PageWindow).__bfDebug !== undefined, undefined, {
    timeout: 60_000,
  });
  ({ bench, warnings } = await page.evaluate(() => {
    const d = (window as unknown as PageWindow).__bfDebug!;
    return { bench: d.bench ?? null, warnings: [...(d.benchWarnings ?? [])] };
  }));
  if (!bench) throw new Error('a casca não leu o bench da URL (window.__bfDebug.bench vazio)');
  const durationS = Number(bench['durationS'] ?? 600);
  const warmupS = Number(bench['warmupS'] ?? 10);
  const limitArg = args.get('limite');
  const limitS = typeof limitArg === 'string' ? Number(limitArg) : LOADING_ALLOWANCE_S + warmupS + durationS + 60;
  for (const w of warnings) console.log(`  aviso: ${w}`);
  // Amostra os campos do boneco a cada 1 s (só quadros com vistas: o loading fica de fora).
  await page.evaluate((interval) => {
    const w = window as unknown as PageWindow;
    w.__bfFigureSamples = [];
    setInterval(() => {
      const s = w.__bfDebug?.stats;
      const views = s?.views ?? [];
      if (!s || views.length === 0) return;
      w.__bfFigureSamples!.push({
        views: views.map((v) => v.actorDraws),
        l0: s.figureL0,
        l1: s.figureL1,
        l2: s.figureL2,
      });
    }, interval);
  }, SAMPLE_INTERVAL_MS);
  console.log(`  esperando o relatório (até ${limitS} s)…`);
  report = await page
    .waitForFunction(() => (window as unknown as PageWindow).__bfDebug?.benchReport ?? null, undefined, {
      timeout: limitS * 1000,
      polling: 1000,
    })
    .then((handle) => handle.jsonValue())
    .catch(() => null);
  log = await page.evaluate(() => [...((window as unknown as PageWindow).__bfDebug?.log?.(400) ?? [])]);
  samples = await page.evaluate(() => [...((window as unknown as PageWindow).__bfFigureSamples ?? [])]);
  if (report === null) problems.push(`o relatório não chegou em ${limitS} s`);
} catch (error) {
  problems.push(String(error instanceof Error ? error.message : error).split('\n')[0] ?? 'erro');
} finally {
  await browser.close();
  await server?.close();
}

if (report !== null) {
  const errors = /^erros=(\d+)$/m.exec(report)?.[1];
  if (errors !== undefined && errors !== '0') problems.push(`o relatório traz erros=${errors}`);
  if (!report.startsWith('BoboForces bench ') || !report.trimEnd().endsWith('fim')) {
    problems.push('relatório fora do formato (BoboForces bench … fim)');
  }
}
for (const e of consoleErrors) problems.push(`erro no console: ${e}`);

const b = bench ?? {};
const summary = [
  `${String(b['views'] ?? '?')}v`,
  `${String(b['bots'] ?? '?')}b`,
  `${String(b['viewDistanceM'] ?? '?')}m`,
  b['textureMode'] === 'atlas' ? 'atlas' : '',
  b['vertexAttributes'] === 'float' ? 'float' : '',
  b['route'] ? String(b['route']).replace(/[^0-9A-Za-z-]+/g, '-') : '',
  b['gpuFinish'] === true ? 'glfinish' : '',
  highPerformanceGpu ? 'dgpu' : '',
  noVsync ? 'semvsync' : '',
]
  .filter((s) => s !== '')
  .join('-');
const OUT = join(REPO_ROOT, 'local', 'm1', 'bench');
const name = `${stamp(new Date())}-${summary}`;
const figures = figureColumns(report, samples);
mkdirSync(OUT, { recursive: true });
if (report !== null) writeFileSync(join(OUT, `${name}.txt`), `${report.trimEnd()}\n`);
writeFileSync(
  join(OUT, `${name}.json`),
  `${JSON.stringify({ url, browser: browserName, headless, highPerformanceGpu, noVsync, screen: `${screenW}x${screenH}`, bench, warnings, problems, consoleErrors, figures, log }, null, 2)}\n`,
);

if (report !== null) console.log(`\n${report.trimEnd()}\n`);
console.log(formatFigureColumns(figures));
console.log(`bench: ${report !== null ? join(OUT, `${name}.txt`) : 'sem relatório'} (+ ${name}.json)`);
if (problems.length > 0) {
  for (const p of problems) console.log(`  - ${p}`);
  console.log('\nbench REPROVADO');
  process.exit(1);
}
console.log('\nbench ok');
