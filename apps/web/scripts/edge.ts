/// <reference lib="dom" />
// Peças comuns dos scripts de navegador da web (`scripts/smoke-web.ts`, `scripts/prints.ts`, `scripts/bench.ts`): o
// build servido pelo `vite preview` numa porta livre de 127.0.0.1 e o Edge instalado pelo playwright-core (headless,
// sem baixar navegador). No CI (`CI` definido; runner sem GPU) o Edge roda com o SwiftShader liberado e, se não
// estiver instalado, cai para o Chrome da imagem (o desvio fica no relatório de quem chamou).
import { existsSync } from 'node:fs';
import { createServer as createHttpServer, type Server } from 'node:http';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { preview } from 'vite';
import type { FigureSample } from './prints-plan-figures.ts';

export const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');
export const WEB_ROOT = join(REPO_ROOT, 'apps', 'web');
export const WEB_DIST = join(WEB_ROOT, 'dist');

/**
 * O gancho dos prints (`window.__bfDebug.print`) como os scripts o enxergam: o contrato `GameDebugApi` do game com os
 * valores em `string` (o teste do roteiro confere que os membros são os mesmos). O tipo completo do `__bfDebug` é o
 * `WebDebugHook` da casca.
 */
export interface PageDebugApi {
  readonly readyForPrint: boolean;
  readonly cameras: readonly string[];
  setCamera(name: string | null): boolean;
  setTimeOfDay(timeOfDay: string): void;
  setPropDose(dose: string): void;
  setGrayscale(on: boolean): void;
  setMipFilter(filter: string): void;
  setHudVisible(visible: boolean): void;
  setViewmodelVisible(visible: boolean): void;
  setFrozen(frozen: boolean): void;
  showFontSpecimen(on: boolean): void;
  whenReady(frames?: number): Promise<void>;
}

export interface PageViewStats {
  readonly drawCalls: number;
  readonly triangles: number;
  readonly regions: number;
  readonly propGroups: number;
  readonly actors: number;
  /** Draws de corpo de bobo na vista (`ViewStats.actorDraws`, #56; a meta é 1). */
  readonly actorDraws: number;
}

export interface PageHook {
  readonly screen: string;
  readonly paused: boolean;
  readonly frames: number;
  readonly simTick: number;
  readonly stats: {
    readonly programs: number;
    readonly drawCalls: number;
    readonly triangles: number;
    readonly viewports: number;
    readonly views?: readonly PageViewStats[];
    /** Bonecos por nível de animação no último frame (`RenderStats.figureL0..L2`, #56). */
    readonly figureL0: number;
    readonly figureL1: number;
    readonly figureL2: number;
  };
  readonly print?: PageDebugApi | null;
  readonly bench?: Readonly<Record<string, unknown>> | null;
  readonly benchWarnings?: readonly string[];
  readonly benchReport?: string | null;
  log?(maxLines?: number): readonly string[];
}

/** `window` visto de dentro do `page.evaluate` (cast local: sem `declare global`, para os scripts não brigarem). */
export interface PageWindow {
  readonly __bfDebug?: PageHook;
  /** Amostras do porte do boneco que o `scripts/bench.ts` junta na página durante a rodada. */
  __bfFigureSamples?: FigureSample[];
}

/** Título pronto: o jogo chegou ao título e o splash já saiu da página (smoke e prints do título). */
export async function waitForTitle(page: Page, timeoutMs = 15_000): Promise<void> {
  await page.waitForFunction(
    () =>
      (window as unknown as PageWindow).__bfDebug?.screen === 'title' && document.getElementById('bf-splash') === null,
    undefined,
    { timeout: timeoutMs },
  );
}

/**
 * Espera a cena com o gancho dos prints pronto (`print.readyForPrint`). Devolve `null` quando ficou pronta, a linha do
 * log quando o loading falhou (o jogo registra `loading falhou` e volta ao título: não adianta esperar o prazo) ou o
 * aviso de prazo estourado.
 */
export async function waitForPrintHook(page: Page, timeoutMs: number): Promise<string | null> {
  const outcome = await page
    .waitForFunction(
      () => {
        const d = (window as unknown as PageWindow).__bfDebug;
        if (d?.print?.readyForPrint === true) return 'ok';
        return d?.log?.(40).find((line) => line.includes('loading falhou')) ?? false;
      },
      undefined,
      { timeout: timeoutMs, polling: 250 },
    )
    .then((handle) => handle.jsonValue())
    .catch(() => null);
  if (outcome === 'ok') return null;
  return typeof outcome === 'string'
    ? `a cena não carregou: ${outcome.split('\n')[0]}`
    : `o gancho dos prints não ficou pronto em ${timeoutMs / 1000} s (window.__bfDebug.print.readyForPrint)`;
}

/** Espera o jogo desenhar mais `count` frames (telas sem o `whenReady` do gancho dos prints, como o título). */
export async function waitForFrames(page: Page, count: number, timeoutMs = 5_000): Promise<void> {
  const start = await page.evaluate(() => (window as unknown as PageWindow).__bfDebug?.frames ?? 0);
  await page.waitForFunction(
    (target) => ((window as unknown as PageWindow).__bfDebug?.frames ?? 0) >= target,
    start + count,
    { timeout: timeoutMs },
  );
}

export function freePort(): Promise<number> {
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

export interface LocalServer {
  readonly url: string;
  close(): Promise<void>;
}

/** `vite preview` do `apps/web/dist`. Lança com a dica de rodar o build quando ele não existe. */
export async function startPreview(): Promise<LocalServer> {
  if (!existsSync(join(WEB_DIST, 'index.html'))) {
    throw new Error(`não achei ${join(WEB_DIST, 'index.html')}: rode "npm run build" antes`);
  }
  const port = await freePort();
  const server = await preview({
    root: WEB_ROOT,
    configFile: join(WEB_ROOT, 'vite.config.ts'),
    logLevel: 'warn',
    preview: { host: '127.0.0.1', port, strictPort: true, open: false },
  });
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise<void>((done) => server.httpServer.close(() => done())),
  };
}

/** Servidor HTTP mínimo que responde `html` em qualquer caminho (página falsa dos testes dos scripts). */
export async function serveHtml(html: string): Promise<LocalServer> {
  const port = await freePort();
  const server: Server = createHttpServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(html);
  });
  await new Promise<void>((done) => server.listen(port, '127.0.0.1', () => done()));
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}

export interface LaunchedBrowser {
  readonly browser: Browser;
  /** Desvio do navegador (Chrome no lugar do Edge no CI), para o relatório; `null` sem desvio. */
  readonly fallback: string | null;
}

/**
 * Bandeira do Chromium que põe o ANGLE (D3D11) na GPU dedicada de um notebook híbrido. Sem ela o Edge fica na
 * integrada mesmo com `powerPreference: 'high-performance'` (medições do M1: Intel UHD em vez da RTX 2050).
 */
export const EDGE_HIGH_PERFORMANCE_GPU = '--force_high_performance_gpu';

/**
 * Sem vsync e sem limite de quadros: o rAF roda solto e o bench mede a folga acima do teto da tela (medições do M1:
 * neste Edge com janela até uma página vazia fica em 56 fps, 17,8 ms).
 */
export const EDGE_NO_VSYNC: readonly string[] = ['--disable-gpu-vsync', '--disable-frame-rate-limit'];

/** Abre o Edge instalado. `headless: false` mostra a janela (bench do PC com a GPU e o vsync de verdade). */
export async function launchEdge(
  options: { readonly headless?: boolean; readonly args?: readonly string[] } = {},
): Promise<LaunchedBrowser> {
  // Sem GPU (runner do CI) o Chromium só dá WebGL pelo SwiftShader, que precisa ser liberado explicitamente.
  const ci = process.env['CI'] !== undefined;
  const args = [...(ci ? ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] : []), ...(options.args ?? [])];
  const headless = options.headless ?? true;
  try {
    return { browser: await chromium.launch({ channel: 'msedge', headless, args }), fallback: null };
  } catch (error) {
    if (!ci) throw error;
    const fallback = `Edge indisponível no CI (${String(error).split('\n')[0]}); usando o Chrome`;
    return { browser: await chromium.launch({ channel: 'chrome', headless, args }), fallback };
  }
}
