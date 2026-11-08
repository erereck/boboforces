/// <reference lib="dom" />
// Teste de fumaça da web no navegador de verdade (tecnico.md §20; DECISOES "Testes de dispositivo"): sobe o build
// (`apps/web/dist`) com `vite preview` numa porta livre de 127.0.0.1 e abre no Edge instalado (playwright-core,
// headless, sem baixar navegador; peças comuns em `apps/web/scripts/edge.ts`). M1, confere:
//   - tempo até o splash aparecer (first-contentful-paint; meta < 1 s local);
//   - canvas WebGL2 e tela de título desenhada (o splash sai depois do primeiro frame do título);
//   - Enter no JOGAR abre o Construto: a cena chega, o gancho dos prints (`window.__bfDebug.print`, só existe no
//     Construto) fica pronto com as câmeras nomeadas do mapa, a sim anda, 1 vista com estatística própria;
//   - F2 abre o painel de depuração por cima da cena (foto `f2.png`; a tela tem de mudar) e P pausa (foto
//     `pausa.png`): as duas telas de texto da partida, para conferir as fontes da decisão #54 no navegador;
//   - bench com 4 vistas (`?bench&views=4…`, 5 s): 4 viewports, 4 linhas de estatística por vista, cada uma desenhando,
//     e o relatório chega no formato (`BoboForces bench 2` … `fim`, `erros=0`);
//   - programas de shader ≤ 7 em toda tomada (regra 8: o teto vale com 1 e com 4 vistas);
//   - porte do boneco (#56): 1 draw de bobos por vista (`ViewStats.actorDraws`; +1 com cadáver no desmonte) em toda
//     tomada com vistas, e REPROVA desde o passo 5 do porte (`REQUIRE_ACTOR_DRAWS`); os números e o `figure_lod`
//     ficam no relatório;
//   - uma passada em 667×375 (celular em paisagem, tecnico.md §20): título, Construto, pausa e zero erros;
//   - zero erros no console em tudo.
// Salva os prints e `smoke-web.json` em `local/m1/smoke/` (pasta privada, fora do git). Uso: `npm run build` e depois
// `npm run smoke:web` (ou `npm run smoke:web -- --url <site publicado>`, que grava em `local/m1/smoke/publicado/`). Sai
// com 1 se algo falhar.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ConsoleMessage, Page } from 'playwright-core';
import { parseArgs } from '../apps/web/scripts/args.ts';
import {
  launchEdge,
  REPO_ROOT,
  startPreview,
  waitForPrintHook,
  waitForTitle,
  type PageWindow,
} from '../apps/web/scripts/edge.ts';
import { checkActorDraws, type ViewActorStats } from '../apps/web/scripts/prints-plan-figures.ts';

/**
 * PORTE DO BONECO (#56): `true` faz "1 draw de bobos por vista" REPROVAR o smoke. Ligado no passo 5, junto do portão
 * do §E: o game só desenha o caminho novo (R4c, `actorDraws` medido) e o bobo de 7 draws saiu.
 */
const REQUIRE_ACTOR_DRAWS = true;

const args = parseArgs(process.argv.slice(2));
const remoteArg = args.get('url');
const remoteUrl = typeof remoteArg === 'string' ? remoteArg : null;
const OUT = join(REPO_ROOT, 'local', 'm1', 'smoke', ...(remoteUrl ? ['publicado'] : []));
const SPLASH_GOAL_MS = 1000;
const SPLASH_CI_LIMIT_MS = 2500;
const MAX_PROGRAMS = 7;
/** Loading do Construto (malha, luz, nav, skins, shaders): 4 s é a meta do Switch; aqui só reprova o desastre. */
const CONSTRUTO_TIMEOUT_MS = 60_000;
/** Câmeras e rota que todo Construto tem (contrato `PRINT_CAMERAS`/`REQUIRED_BENCH_ROUTES` do format). */
const REQUIRED_CAMERAS = ['print:dia', 'print:leitura-50m', 'bench:volta'];
const BENCH_4_VIEWS = '?bench&views=4&bots=8&duration=5&warmup=0';

interface Snapshot {
  readonly screen: string;
  readonly paused: boolean;
  readonly frames: number;
  readonly simTick: number;
  readonly programs: number;
  readonly drawCalls: number;
  readonly viewports: number;
  readonly views: readonly ({ readonly drawCalls: number; readonly triangles: number } & ViewActorStats)[];
  /** Bonecos por nível de animação (`RenderStats.figureL0..2`); `null` sem o campo. */
  readonly figureLod: { readonly l0: number; readonly l1: number; readonly l2: number } | null;
  readonly printReady: boolean | null;
  readonly cameras: readonly string[];
}

const ci = process.env['CI'] !== undefined;
const server = remoteUrl ? null : await startPreview();
const url = remoteUrl ?? server!.url;
const problems: string[] = [];
const report: Record<string, unknown> = { url };
const errors: string[] = [];
const warnings: string[] = [];
const screenshots: string[] = [];
const programsSeen: number[] = [];
/** Avisos do "1 draw de bobos por vista" se `REQUIRE_ACTOR_DRAWS` for desligado (para medir sem reprovar). */
const figureWarnings: string[] = [];

const { browser, fallback } = await launchEdge();
if (fallback) report['browserFallback'] = fallback;
report['browser'] = browser.version();

function watch(page: Page, label: string): void {
  const tag = label ? `[${label}] ` : '';
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(`${tag}${msg.text()}`);
    else if (msg.type() === 'warning') warnings.push(`${tag}${msg.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`${tag}pageerror: ${error.message}`));
  page.on('requestfailed', (request) => errors.push(`${tag}requestfailed: ${request.url()}`));
}

async function snapshot(page: Page): Promise<Snapshot> {
  const s = await page.evaluate(() => {
    const d = (window as unknown as PageWindow).__bfDebug!;
    const print = d.print ?? null;
    const s = d.stats;
    return {
      screen: d.screen,
      paused: d.paused,
      frames: d.frames,
      simTick: d.simTick,
      programs: s.programs,
      drawCalls: s.drawCalls,
      viewports: s.viewports,
      // Casca antiga (sem o campo) lê `null`: a checagem avisa em vez de quebrar.
      views: (s.views ?? []).map((v) => ({
        drawCalls: v.drawCalls,
        triangles: v.triangles,
        actors: v.actors,
        actorDraws: typeof v.actorDraws === 'number' ? v.actorDraws : null,
      })),
      figureLod: typeof s.figureL0 === 'number' ? { l0: s.figureL0, l1: s.figureL1, l2: s.figureL2 } : null,
      printReady: print ? print.readyForPrint : null,
      cameras: print ? [...print.cameras] : [],
    };
  });
  programsSeen.push(s.programs);
  return s;
}

async function shot(page: Page, name: string): Promise<Buffer> {
  const path = join(OUT, name);
  const image = await page.screenshot({ path });
  screenshots.push(path);
  return image;
}

/** Congela (ou solta) a cena pelo gancho dos prints e espera o frame chegar à tela. */
async function setFrozen(page: Page, frozen: boolean): Promise<void> {
  await page.evaluate(async (on) => {
    const p = (window as unknown as PageWindow).__bfDebug?.print;
    if (!p) throw new Error('gancho dos prints sumiu (window.__bfDebug.print)');
    p.setFrozen(on);
    await p.whenReady();
  }, frozen);
}

/**
 * F2 abre e fecha o painel de depuração. Com a cena congelada, a foto antes e a depois só diferem pelo painel: se
 * forem iguais, o F2 não chegou ao jogo (ou o painel não desenhou). Devolve o problema, ou `null`.
 */
async function checkF2(page: Page): Promise<string | null> {
  await setFrozen(page, true);
  const before = await page.screenshot();
  await page.keyboard.press('F2');
  // O painel atualiza os números a cada meio segundo.
  await page.waitForTimeout(700);
  const after = await shot(page, 'f2.png');
  await page.keyboard.press('F2');
  await page.waitForTimeout(200);
  await setFrozen(page, false);
  return before.equals(after) ? 'F2 não abriu o painel de depuração (a tela não mudou)' : null;
}

/** P pausa a sim (o tick para) e a foto da pausa sai (`report[key]`). Devolve o problema, ou `null`. */
async function checkPause(page: Page, file: string, key: string): Promise<string | null> {
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(200);
  const paused = await snapshot(page);
  await page.waitForTimeout(300);
  const stillPaused = await snapshot(page);
  report[key] = { paused: paused.paused, frozen: stillPaused.simTick === paused.simTick };
  await shot(page, file);
  return !paused.paused || stillPaused.simTick !== paused.simTick ? `P não pausou a sim (${file})` : null;
}

/**
 * JOGAR (foco inicial) → Construto. A cena chegou quando o gancho dos prints existe e diz pronto: o
 * `GameHandle.debug` só fica não nulo no Construto. Devolve o problema, ou `null`.
 */
async function openConstruto(page: Page, label: string): Promise<string | null> {
  await page.keyboard.press('Enter');
  const notReady = await waitForPrintHook(page, CONSTRUTO_TIMEOUT_MS);
  if (notReady === null) return null;
  const s = await snapshot(page);
  return s.screen !== 'scene' && !notReady.startsWith('a cena não carregou')
    ? `${label}: Enter no JOGAR não abriu a cena (tela ${s.screen})`
    : `${label}: ${notReady}`;
}

function checkViews(s: Snapshot, expected: number, label: string): void {
  if (s.viewports !== expected) problems.push(`${label}: ${s.viewports} viewports (esperado ${expected})`);
  if (s.views.length !== expected)
    problems.push(`${label}: ${s.views.length} linhas de estatística por vista (esperado ${expected})`);
  s.views.forEach((v, i) => {
    if (v.drawCalls <= 0) problems.push(`${label}: vista ${i} sem draw calls`);
  });
  if (s.programs > MAX_PROGRAMS) problems.push(`${label}: ${s.programs} programas de shader (teto ${MAX_PROGRAMS})`);
  // Porte do boneco: 1 draw de bobos por vista (reprova só com REQUIRE_ACTOR_DRAWS; antes disso, aviso).
  for (const p of checkActorDraws(s.views, label)) (REQUIRE_ACTOR_DRAWS ? problems : figureWarnings).push(p);
}

try {
  mkdirSync(OUT, { recursive: true });

  // --- PC, 1280×720: splash, título, Construto, pausa ---
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  watch(page, '');
  await page.goto(url, { waitUntil: 'load' });
  const fcp = await page.evaluate(
    () =>
      new Promise<number>((done) => {
        const read = (): number | null => {
          const entry = performance.getEntriesByName('first-contentful-paint')[0];
          return entry ? entry.startTime : null;
        };
        const now = read();
        if (now !== null) return done(now);
        new PerformanceObserver(() => {
          const value = read();
          if (value !== null) done(value);
        }).observe({ type: 'paint', buffered: true });
      }),
  );
  report['splashMs'] = Math.round(fcp);
  report['navigation'] = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    return nav
      ? { responseEnd: Math.round(nav.responseEnd), domContentLoaded: Math.round(nav.domContentLoadedEventEnd) }
      : null;
  });
  // No CI (runner frio, WebGL por software) o teto é mais folgado: a meta de 1 s vale para a URL publicada e para a
  // máquina local; aqui o número fica no relatório e só reprova se for um desastre.
  const splashLimit = ci ? SPLASH_CI_LIMIT_MS : SPLASH_GOAL_MS;
  report['splashLimitMs'] = splashLimit;
  if (fcp >= splashLimit) problems.push(`splash em ${Math.round(fcp)} ms (limite ${splashLimit} ms)`);

  await waitForTitle(page);
  report['menuMs'] = Math.round(await page.evaluate(() => performance.now()));
  const canvas = await page.evaluate(() => {
    const c = document.getElementById('bf-game');
    if (!(c instanceof HTMLCanvasElement)) return null;
    return { webgl2: c.getContext('webgl2') !== null, width: c.width, height: c.height };
  });
  report['canvas'] = canvas;
  if (!canvas?.webgl2) problems.push('canvas WebGL2 não apareceu');
  await page.waitForTimeout(300);
  const title = await snapshot(page);
  report['title'] = title;
  if (title.programs < 1) problems.push('o título não compilou o programa de UI (nada desenhado?)');
  await shot(page, 'titulo.png');

  const t0 = Date.now();
  const construtoProblem = await openConstruto(page, '1280×720');
  report['construtoMs'] = Date.now() - t0;
  if (construtoProblem) problems.push(construtoProblem);
  else {
    const before = await snapshot(page);
    await page
      .waitForFunction(
        (tick) => ((window as unknown as PageWindow).__bfDebug?.simTick ?? 0) > tick + 60,
        before.simTick,
        { timeout: 15_000 },
      )
      .catch(() => problems.push('a sim não andou no Construto'));
    await page.waitForTimeout(500);
    const scene = await snapshot(page);
    report['construto'] = scene;
    checkViews(scene, 1, 'Construto');
    const missing = REQUIRED_CAMERAS.filter((c) => !scene.cameras.includes(c));
    if (missing.length) problems.push(`Construto sem as câmeras nomeadas ${missing.join(', ')}`);
    await shot(page, 'construto.png');

    const f2Problem = await checkF2(page);
    report['f2'] = f2Problem === null;
    if (f2Problem) problems.push(f2Problem);
    const pauseProblem = await checkPause(page, 'pausa.png', 'pause');
    if (pauseProblem) problems.push(pauseProblem);
  }
  await page.close();

  // --- Bench com 4 vistas (tela dividida, o critério do Switch na dock em miniatura) ---
  const bench = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  watch(bench, 'bench 4 vistas');
  await bench.goto(new URL(BENCH_4_VIEWS, url).href, { waitUntil: 'load' });
  const split = await bench
    .waitForFunction(() => (window as unknown as PageWindow).__bfDebug?.stats.viewports === 4, undefined, {
      timeout: CONSTRUTO_TIMEOUT_MS,
    })
    .then(() => true)
    .catch(() => false);
  if (!split) problems.push('bench: as 4 vistas não apareceram');
  else {
    await bench.waitForTimeout(1000);
    const four = await snapshot(bench);
    report['bench4'] = four;
    checkViews(four, 4, 'bench 4 vistas');
    await shot(bench, 'bench-4-vistas.png');
    const text = await bench
      .waitForFunction(() => (window as unknown as PageWindow).__bfDebug?.benchReport ?? null, undefined, {
        timeout: CONSTRUTO_TIMEOUT_MS,
        polling: 500,
      })
      .then((h) => h.jsonValue())
      .catch(() => null);
    report['benchReport'] = text;
    if (text === null) problems.push('bench: o relatório não chegou (window.__bfDebug.benchReport)');
    else {
      const lines = text.trimEnd().split('\n');
      if (lines[0] !== 'BoboForces bench 2' || lines.at(-1) !== 'fim')
        problems.push('bench: relatório fora do formato');
      if (!lines.some((l) => /\bvistas=4\b/.test(l))) problems.push('bench: o relatório não diz vistas=4');
      if (!lines.includes('erros=0')) problems.push('bench: o relatório traz erros');
      const programs = /^programas=(\d+)$/m.exec(text)?.[1];
      if (programs !== undefined && Number(programs) > MAX_PROGRAMS) {
        problems.push(`bench: relatório com programas=${programs} (teto ${MAX_PROGRAMS})`);
      }
    }
  }
  await bench.close();

  // --- Celular em paisagem (667×375, DPR 2): o layout não pode assumir proporção nem resolução (regra 17) ---
  const phone = await browser.newPage({ viewport: { width: 667, height: 375 }, deviceScaleFactor: 2 });
  watch(phone, '667×375');
  await phone.goto(url, { waitUntil: 'load' });
  await waitForTitle(phone);
  await phone.waitForTimeout(300);
  await shot(phone, 'titulo-667x375.png');
  const phoneProblem = await openConstruto(phone, '667×375');
  if (phoneProblem) problems.push(phoneProblem);
  else {
    await phone.waitForTimeout(500);
    const phoneScene = await snapshot(phone);
    const phoneCanvas = await phone.evaluate(() => {
      const c = document.getElementById('bf-game');
      return c instanceof HTMLCanvasElement ? { width: c.width, height: c.height } : null;
    });
    report['phone'] = { ...phoneScene, canvas: phoneCanvas };
    checkViews(phoneScene, 1, '667×375');
    await shot(phone, 'construto-667x375.png');
    const phonePause = await checkPause(phone, 'pausa-667x375.png', 'phonePause');
    if (phonePause) problems.push(phonePause);
  }
} catch (error) {
  problems.push(`o smoke parou: ${String(error instanceof Error ? error.message : error).split('\n')[0]}`);
} finally {
  await browser.close();
  await server?.close();
}

const maxPrograms = programsSeen.length ? Math.max(...programsSeen) : 0;
report['maxPrograms'] = maxPrograms;
if (maxPrograms > MAX_PROGRAMS) problems.push(`${maxPrograms} programas de shader (teto ${MAX_PROGRAMS})`);
report['screenshots'] = screenshots;
report['consoleErrors'] = errors;
report['consoleWarnings'] = warnings;
report['actorDrawsRequired'] = REQUIRE_ACTOR_DRAWS;
report['figureWarnings'] = [...new Set(figureWarnings)];
for (const e of errors) problems.push(`erro no console: ${e}`);
report['problems'] = [...new Set(problems)];
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'smoke-web.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (figureWarnings.length > 0) {
  console.log('\naviso (porte do boneco, ainda sem reprovar: REQUIRE_ACTOR_DRAWS = false):');
  for (const w of new Set(figureWarnings)) console.log(`  - ${w}`);
}
if (problems.length > 0) {
  console.log('\nsmoke:web REPROVADO');
  process.exit(1);
}
console.log('\nsmoke:web ok');
