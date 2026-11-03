/// <reference lib="dom" />
// Teste de fumaça da web no navegador de verdade (tecnico.md §20; DECISOES "Testes de dispositivo"): sobe o build
// (`apps/web/dist`) com `vite preview` numa porta livre de 127.0.0.1 e abre no Edge instalado (playwright-core,
// headless, sem baixar navegador). Confere:
//   - tempo até o splash aparecer (first-contentful-paint; meta < 1 s local);
//   - canvas WebGL2 e tela de título desenhada (o splash sai depois do primeiro frame do título);
//   - zero erros no console; programas de shader ≤ 7 (regra 8, pelo gancho `window.__bfDebug` da casca web);
//   - Enter no JOGAR entra na cena de teste e a sim anda; P pausa;
//   - uma segunda passada em 667×375 (celular em paisagem, tecnico.md §20): título, cena e zero erros.
// Salva `titulo.png`, `cena-teste.png` e os prints de 667×375 em `local/m0/` (pasta privada, fora do git). Uso:
// `npm run build` e depois `npm run smoke:web`. Sai com 1 se algo falhar.
//
// No CI (`CI` definido; ubuntu-latest sem GPU) o Edge roda com o SwiftShader liberado, que é o WebGL2 por software do
// próprio navegador. Se o Edge não estiver instalado, cai para o Chrome da imagem e registra o desvio no relatório.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { chromium, type ConsoleMessage } from 'playwright-core';
import { preview } from 'vite';

/** O gancho que `apps/web/src/main.ts` põe no `window` (os callbacks do `page.evaluate` rodam no navegador). */
declare global {
  interface Window {
    __bfDebug?: {
      readonly screen: string;
      readonly paused: boolean;
      readonly frames: number;
      readonly simTick: number;
      readonly stats: { readonly programs: number; readonly drawCalls: number; readonly viewports: number };
    };
  }
}

const ROOT = resolve(import.meta.dirname, '..');
const WEB = join(ROOT, 'apps', 'web');
const OUT = join(ROOT, 'local', 'm0');
const SPLASH_GOAL_MS = 1000;
const SPLASH_CI_LIMIT_MS = 2500;
const MAX_PROGRAMS = 7;

interface DebugSnapshot {
  readonly screen: string;
  readonly paused: boolean;
  readonly frames: number;
  readonly simTick: number;
  readonly programs: number;
  readonly drawCalls: number;
  readonly viewports: number;
}

function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const srv = createServer();
    srv.once('error', fail);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      srv.close(() => done(port));
    });
  });
}

const port = await freePort();
const server = await preview({
  root: WEB,
  configFile: join(WEB, 'vite.config.ts'),
  logLevel: 'warn',
  preview: { host: '127.0.0.1', port, strictPort: true, open: false },
});
const url = `http://127.0.0.1:${port}/`;
const problems: string[] = [];
const report: Record<string, unknown> = { url };
const errors: string[] = [];
const warnings: string[] = [];

// Sem GPU (runner do CI) o Chromium só dá WebGL pelo SwiftShader, que precisa ser liberado explicitamente.
const ci = process.env['CI'] !== undefined;
const launchArgs = ci ? ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] : [];
async function launch(): Promise<Awaited<ReturnType<typeof chromium.launch>>> {
  try {
    return await chromium.launch({ channel: 'msedge', headless: true, args: launchArgs });
  } catch (error) {
    if (!ci) throw error;
    report['browserFallback'] = `Edge indisponível no CI (${String(error).split('\n')[0]}); usando o Chrome`;
    return chromium.launch({ channel: 'chrome', headless: true, args: launchArgs });
  }
}
const browser = await launch();
report['browser'] = browser.version();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text());
    else if (msg.type() === 'warning') warnings.push(msg.text());
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('requestfailed', (request) => errors.push(`requestfailed: ${request.url()}`));

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

  // Título pronto: o jogo chegou ao título e o splash já saiu da página.
  await page.waitForFunction(
    () => window.__bfDebug?.screen === 'title' && document.getElementById('bf-splash') === null,
    undefined,
    { timeout: 15_000 },
  );
  report['menuMs'] = Math.round(await page.evaluate(() => performance.now()));
  const canvas = await page.evaluate(() => {
    const c = document.getElementById('bf-game');
    if (!(c instanceof HTMLCanvasElement)) return null;
    return { webgl2: c.getContext('webgl2') !== null, width: c.width, height: c.height };
  });
  report['canvas'] = canvas;
  if (!canvas?.webgl2) problems.push('canvas WebGL2 não apareceu');

  const snapshot = (): Promise<DebugSnapshot> =>
    page.evaluate(() => {
      const d = window.__bfDebug!;
      return {
        screen: d.screen,
        paused: d.paused,
        frames: d.frames,
        simTick: d.simTick,
        programs: d.stats.programs,
        drawCalls: d.stats.drawCalls,
        viewports: d.stats.viewports,
      };
    });

  await page.waitForTimeout(300);
  const title = await snapshot();
  report['title'] = title;
  if (title.programs < 1) problems.push('o título não compilou o programa de UI (nada desenhado?)');
  mkdirSync(OUT, { recursive: true });
  const titlePath = join(OUT, 'titulo.png');
  await page.screenshot({ path: titlePath });

  // JOGAR tem o foco inicial: Enter confirma.
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__bfDebug?.screen === 'scene', undefined, { timeout: 5_000 });
  await page.waitForFunction(() => (window.__bfDebug?.simTick ?? 0) > 150, undefined, { timeout: 15_000 });
  await page.waitForTimeout(500);
  const scene = await snapshot();
  report['scene'] = scene;
  if (scene.viewports !== 1) problems.push(`cena com ${scene.viewports} viewports (esperado 1)`);
  const scenePath = join(OUT, 'cena-teste.png');
  await page.screenshot({ path: scenePath });

  await page.keyboard.press('KeyP');
  await page.waitForTimeout(200);
  const paused = await snapshot();
  await page.waitForTimeout(300);
  const stillPaused = await snapshot();
  report['pause'] = { paused: paused.paused, frozen: stillPaused.simTick === paused.simTick };
  if (!paused.paused || stillPaused.simTick !== paused.simTick) problems.push('P não pausou a sim');

  // Celular em paisagem (667×375, DPR 2): o layout não pode assumir proporção nem resolução (regra 17).
  const phone = await browser.newPage({ viewport: { width: 667, height: 375 }, deviceScaleFactor: 2 });
  phone.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(`[667×375] ${msg.text()}`);
  });
  phone.on('pageerror', (error) => errors.push(`[667×375] pageerror: ${error.message}`));
  await phone.goto(url, { waitUntil: 'load' });
  await phone.waitForFunction(
    () => window.__bfDebug?.screen === 'title' && document.getElementById('bf-splash') === null,
    undefined,
    { timeout: 15_000 },
  );
  await phone.waitForTimeout(300);
  const phoneTitlePath = join(OUT, 'titulo-667x375.png');
  await phone.screenshot({ path: phoneTitlePath });
  await phone.keyboard.press('Enter');
  await phone.waitForFunction(() => window.__bfDebug?.screen === 'scene', undefined, { timeout: 5_000 });
  await phone.waitForFunction(() => (window.__bfDebug?.simTick ?? 0) > 60, undefined, { timeout: 15_000 });
  const phoneScene = await phone.evaluate(() => {
    const c = document.getElementById('bf-game');
    const d = window.__bfDebug!;
    return {
      canvas: c instanceof HTMLCanvasElement ? { width: c.width, height: c.height } : null,
      programs: d.stats.programs,
      viewports: d.stats.viewports,
    };
  });
  const phoneScenePath = join(OUT, 'cena-667x375.png');
  await phone.screenshot({ path: phoneScenePath });
  report['phone'] = phoneScene;
  if (phoneScene.viewports !== 1) problems.push(`667×375: cena com ${phoneScene.viewports} viewports (esperado 1)`);

  const maxPrograms = Math.max(title.programs, scene.programs, stillPaused.programs, phoneScene.programs);
  report['maxPrograms'] = maxPrograms;
  if (maxPrograms > MAX_PROGRAMS) problems.push(`${maxPrograms} programas de shader (teto ${MAX_PROGRAMS})`);
  report['screenshots'] = [titlePath, scenePath, phoneTitlePath, phoneScenePath];
} finally {
  await browser.close();
  await new Promise<void>((done) => server.httpServer.close(() => done()));
}

report['consoleErrors'] = errors;
report['consoleWarnings'] = warnings;
for (const e of errors) problems.push(`erro no console: ${e}`);
report['problems'] = problems;
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'smoke-web.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (problems.length > 0) {
  console.log('\nsmoke:web REPROVADO');
  process.exit(1);
}
console.log('\nsmoke:web ok');
