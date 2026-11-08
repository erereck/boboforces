/// <reference lib="dom" />
// Prints automáticos da cena-vitrine no Edge (PLANO_M1 critério 1; GDD §5.8; arte-ux.md §5.2; rodada 3 do porte do
// boneco, decisão #56). Frente "web-bench" (F7 no porte).
//
//   npm run build && npm run prints                      todos os conjuntos, build local (vite preview)
//   npm run prints -- --so leitura,altura                só alguns conjuntos (hora, densidade, leitura, fontes, altura,
//                                                        titulo, setores, regua, fila, close, vitrine, zumbi, mira,
//                                                        sequencia, andar, bots, tropa, farda, patio, infectado; o
//                                                        número; ou a rodada: escolhas, rodada3, rodada4)
//   npm run prints -- --copia h5                         na CÓPIA descartável (passo 6): só os prints da variante
//                                                        (marca padrão `copia-<variante>`; ver COPY_VARIANTS)
//   npm run prints -- --marca altura-a                   pasta <versão>-<marca> (rodadas da mesma versão lado a lado)
//   npm run prints -- --saida <pasta>                    outra pasta de saída (padrão local/m1/prints deste repositório;
//                                                        a cópia descartável das variantes grava na árvore principal)
//   npm run prints -- --url http://127.0.0.1:5173/       contra um servidor já de pé (o `npm run dev`, por exemplo)
//   npm run prints -- --cena vitrine                     outra cena do bench (padrão: construto)
//   npm run prints -- --falso                            contra a página FALSA do jogo (testa o roteiro sem o build)
//
// Roteiro (`apps/web/scripts/prints-plan.ts`), executado agrupado por página (uma carga por página):
//   - CENA (`?bench&scene=…&views=1&bots=0&…`, e `&atlas=1` no print da rota do atlas): espera
//     `print.readyForPrint` (contrato `GameDebugApi`, pendurado pela casca em `window.__bfDebug.print`), congela e
//     esconde o viewmodel; em cada print ajusta a janela (1280×720 ou 640×360, DPR 1), aplica TODAS as chaves (câmera
//     nomeada, hora, dose, cinza, mip, HUD, folha das fontes e, quando o game tiver o gancho novo `FigurePrintHook`,
//     os manequins e o clipe com dt fixo), espera `whenReady()` e fotografa;
//   - TÍTULO (a página inicial, ou `?titulo=switch` para a prévia do Switch com os 9 itens de teste): espera o título
//     sem o splash; em cada print ajusta a janela, espera a canvas e alguns frames e fotografa.
// Rodada 3: print que precisa de membro do gancho novo que o game ainda não expõe, ou de câmera da rodada que o mapa
// ainda não tem, fica `pendente` (peça do passo 5); print de variante da cópia fica `copia` na árvore principal (só o
// lugar na folha, com o comando). Grava os PNG, `prints.json` e a folha de contato `index.html` (com as 16 perguntas
// da rodada 3 e as 4 da rodada 4 quando elas entram) em <saída>/<versão>[-<marca>]/ (padrão local/m1/prints/, pasta
// privada, fora do git).
// Sai com 1 se faltar câmera, houver print pendente, a página não ficar pronta ou houver erro no console.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Browser, ConsoleMessage, Page } from 'playwright-core';
import { parseArgs } from '../apps/web/scripts/args.ts';
import {
  launchEdge,
  REPO_ROOT,
  serveHtml,
  startPreview,
  waitForFrames,
  waitForPrintHook,
  waitForTitle,
  type LocalServer,
  type PageDebugApi,
  type PageWindow,
} from '../apps/web/scripts/edge.ts';
import { fakePrintsPage } from '../apps/web/scripts/prints-fake.ts';
import {
  buildPrintPlan,
  contactSheetHtml,
  COPY_VARIANTS,
  copyCommand,
  copyPlan,
  fakeTag,
  FIGURE_HOOK_MEMBERS,
  filterPlan,
  onlyInRound,
  printDirName,
  questionsFor,
  runOrder,
  shotNeeds,
  shotQuery,
  type CopyVariantId,
  type FigurePrintHook,
  type PrintSettings,
  type PrintShot,
  type ShotResult,
} from '../apps/web/scripts/prints-plan.ts';

/** O gancho com os membros novos da rodada 3 opcionais: o script detecta o que o game já expõe. */
type PrintHook = PageDebugApi & Partial<FigurePrintHook>;

const READY_TIMEOUT_MS = 120_000;
const TITLE_TIMEOUT_MS = 30_000;
const SHOT_TIMEOUT_MS = 20_000;
/** Frames depois de mudar a janela no título (não há `whenReady` fora da cena). */
const TITLE_SETTLE_FRAMES = 6;

const args = parseArgs(process.argv.slice(2));
const flag = (name: string): string | null => {
  const v = args.get(name);
  return typeof v === 'string' ? v : null;
};
const fake = args.has('falso') || args.has('fake');
const remoteUrl = flag('url');
const scene = flag('cena') ?? flag('scene') ?? 'construto';
const only = (flag('so') ?? flag('only') ?? '').split(',');
/** Variante da cópia descartável (`--copia h5`): roda só os prints dela. */
const copy = (flag('copia') ?? flag('copy')) as CopyVariantId | null;
const selected = filterPlan(buildPrintPlan(), only);
const plan = copy ? copyPlan(selected, copy) : selected;
if (plan.length === 0) {
  console.log(`prints: nada para rodar (--so ${only.join(',')}${copy ? ` --copia ${copy}` : ''})`);
  process.exit(1);
}
const version = (JSON.parse(readFileSync(join(REPO_ROOT, 'version.json'), 'utf8')) as { version: string }).version;
const baseTag = flag('marca') ?? (copy ? `copia-${copy}` : null);
const tag = fake ? fakeTag(baseTag) : baseTag;
const outRoot = flag('saida') ?? flag('out');
const OUT = join(outRoot ? resolve(outRoot) : join(REPO_ROOT, 'local', 'm1', 'prints'), printDirName(version, tag));

const problems: string[] = [];
const consoleErrors: string[] = [];
const results = new Map<string, ShotResult>();

const server: LocalServer | null = remoteUrl ? null : fake ? await serveHtml(fakePrintsPage()) : await startPreview();
const base = remoteUrl ?? server!.url;
const urlOf = (shot: PrintShot): string => new URL(shotQuery(shot, scene), base).href;
const { browser, fallback } = await launchEdge();
if (fallback) problems.push(fallback);
const browserName = `${fallback ? 'Chrome' : 'Edge'} ${browser.version()}`;
mkdirSync(OUT, { recursive: true });

/**
 * Guarda o resultado; a falha (e o pendente) vira problema da rodada, menos a de página que não abriu (contada uma
 * vez só) e o lugar da cópia descartável.
 */
function record(shot: PrintShot, result: Omit<ShotResult, 'shot'>, report = true): void {
  results.set(shot.file, { shot, ...result });
  if (report && result.status !== 'ok' && result.status !== 'copia') {
    problems.push(`${shot.file}: ${result.detail ?? result.status}`);
  }
}

/** Conjunto só das rodadas do boneco (câmera ausente ali é peça pendente do passo 5, não erro do mapa). */
const round3Only = (shot: PrintShot): boolean => onlyInRound(shot.set, 'rodada3') || onlyInRound(shot.set, 'rodada4');

/**
 * Aplica as chaves e espera a tela. Os membros do gancho novo (`setMannequins`, `setFigureClip`) só são chamados se o
 * game os expõe; quem chega aqui sem eles não precisa deles (`shotNeeds`), e o print sai com o mapa como está.
 */
async function applyAndWait(page: Page, settings: PrintSettings): Promise<'ok' | 'sem-camera' | 'recusou'> {
  return page.evaluate(async (s) => {
    const p = (window as unknown as PageWindow).__bfDebug?.print as PrintHook | null | undefined;
    if (!p) throw new Error('gancho dos prints sumiu (window.__bfDebug.print)');
    if (!p.setCamera(s.camera)) return 'sem-camera';
    p.setTimeOfDay(s.timeOfDay);
    p.setPropDose(s.propDose);
    p.setGrayscale(s.grayscale);
    p.setMipFilter(s.mipFilter);
    p.setHudVisible(s.hud);
    p.showFontSpecimen(s.fontSpecimen);
    if (typeof p.setMannequins === 'function' && !p.setMannequins(s.mannequins)) return 'recusou';
    if (typeof p.setFigureClip === 'function' && !p.setFigureClip(s.clip)) return 'recusou';
    await p.whenReady();
    return 'ok';
  }, settings);
}

/** Espera o drawing buffer seguir a janela nova (a platform-web mede pelo ResizeObserver). */
async function waitCanvasSize(page: Page, width: number, height: number): Promise<void> {
  await page
    .waitForFunction(
      ([w, h]) => {
        const c = document.getElementById('bf-game');
        return c instanceof HTMLCanvasElement && c.width === w && c.height === h;
      },
      [width, height] as const,
      { timeout: 5_000 },
    )
    .catch(() => problems.push(`a canvas não ficou em ${width}×${height} (o print pode ter saído esticado)`));
}

/** Prazo de um print; o relógio é desligado no fim (senão o processo espera os 20 s de cada print para sair). */
async function withTimeout<T>(work: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, fail) => {
        timer = setTimeout(() => fail(new Error(`${what} passou de ${SHOT_TIMEOUT_MS / 1000} s`)), SHOT_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const errorText = (error: unknown): string =>
  String(error instanceof Error ? error.message : error).split('\n')[0] ?? 'erro';

interface OpenedPage {
  readonly page: Page;
  /** Câmeras nomeadas do mapa (só na cena). */
  readonly cameras: readonly string[] | null;
  /** Membros do gancho novo da rodada 3 que o game já expõe (só na cena). */
  readonly members: readonly string[];
  /** Por que a página não ficou pronta; `null` = pronta. */
  readonly failure: string | null;
}

/**
 * Abre uma página e espera ela ficar pronta: a cena com o gancho dos prints (congela, esconde o viewmodel e devolve as
 * câmeras) ou o título.
 */
async function openPage(browser: Browser, first: PrintShot): Promise<OpenedPage> {
  const page = await browser.newPage({ viewport: { width: first.width, height: first.height }, deviceScaleFactor: 1 });
  const url = urlOf(first);
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') consoleErrors.push(`[${url}] ${msg.text()}`);
  });
  page.on('pageerror', (error) => consoleErrors.push(`[${url}] pageerror: ${error.message}`));
  await page.goto(url, { waitUntil: 'load' });
  if (first.page === 'title') {
    const failure = await waitForTitle(page, TITLE_TIMEOUT_MS)
      .then(() => null)
      .catch(() => `o título não apareceu em ${TITLE_TIMEOUT_MS / 1000} s (${url})`);
    return { page, cameras: null, members: [], failure };
  }
  const notReady = await waitForPrintHook(page, READY_TIMEOUT_MS);
  if (notReady) return { page, cameras: null, members: [], failure: `${notReady} (${url})` };
  const { cameras, members } = await page.evaluate((wanted) => {
    const p = (window as unknown as PageWindow).__bfDebug!.print! as PrintHook;
    p.setFrozen(true);
    p.setViewmodelVisible(false);
    const hook = p as unknown as Record<string, unknown>;
    return { cameras: [...p.cameras], members: wanted.filter((m) => typeof hook[m] === 'function') };
  }, FIGURE_HOOK_MEMBERS);
  return { page, cameras, members, failure: null };
}

async function takeShot(page: Page, shot: PrintShot, opened: OpenedPage): Promise<void> {
  if (shot.page === 'title') {
    await withTimeout(waitForFrames(page, TITLE_SETTLE_FRAMES), 'a espera dos frames do título');
    await page.screenshot({ path: join(OUT, shot.file) });
    record(shot, { status: 'ok' });
    return;
  }
  const missing = shotNeeds(shot).filter((m) => !opened.members.includes(m));
  if (missing.length > 0) {
    const what = missing.map((m) => `GameDebugApi.${m}`).join(' e ');
    record(shot, { status: 'pendente', detail: `o game ainda não expõe ${what} (pedido do porte, passo 5)` });
    return;
  }
  const camera = shot.settings.camera;
  if (camera !== null && !opened.cameras?.includes(camera)) {
    record(
      shot,
      round3Only(shot)
        ? { status: 'pendente', detail: `câmera ${camera} da rodada 3 ainda não existe no mapa (F6/integração)` }
        : { status: 'sem-camera', detail: `câmera ${camera} não existe no mapa` },
    );
    return;
  }
  const status = await withTimeout(applyAndWait(page, shot.settings), 'whenReady');
  if (status === 'sem-camera') {
    record(shot, { status, detail: `setCamera(${camera === null ? 'null' : `'${camera}'`}) recusou` });
    return;
  }
  if (status === 'recusou') {
    record(shot, {
      status: 'falhou',
      detail: 'setMannequins ou setFigureClip recusou (nome, look ou clipe desconhecido)',
    });
    return;
  }
  await page.screenshot({ path: join(OUT, shot.file) });
  record(shot, { status: 'ok' });
}

try {
  // Na árvore principal, as variantes da cópia só deixam o lugar marcado na folha (passo 6).
  const toRun = copy ? plan : plan.filter((shot) => shot.copy === null);
  if (!copy) {
    for (const shot of plan) {
      if (shot.copy !== null) record(shot, { status: 'copia', detail: copyCommand(shot.copy) });
    }
  }
  const order = runOrder(toRun, scene);
  let currentUrl = '';
  let current: OpenedPage | null = null;
  let size = { width: 0, height: 0 };
  for (const shot of order) {
    const url = urlOf(shot);
    if (current === null || currentUrl !== url) {
      await current?.page.close();
      const opened: OpenedPage = await openPage(browser, shot);
      current = opened;
      currentUrl = url;
      size = { width: shot.width, height: shot.height };
      if (opened.failure) problems.push(opened.failure);
      else await waitCanvasSize(opened.page, size.width, size.height);
    }
    if (current.failure) {
      record(shot, { status: 'falhou', detail: current.failure }, false);
      continue;
    }
    try {
      if (shot.width !== size.width || shot.height !== size.height) {
        size = { width: shot.width, height: shot.height };
        await current.page.setViewportSize(size);
        await waitCanvasSize(current.page, size.width, size.height);
      }
      await takeShot(current.page, shot, current);
    } catch (error) {
      record(shot, { status: 'falhou', detail: errorText(error) });
    }
  }
  await current?.page.close();
} finally {
  await browser.close();
  await server?.close();
}

for (const e of consoleErrors) problems.push(`erro no console: ${e}`);
// A folha de contato e o JSON seguem a ordem do roteiro (a execução agrupa por página).
const ordered = plan.map((shot) => results.get(shot.file) ?? { shot, status: 'falhou' as const, detail: 'não rodou' });
const createdAt = new Date().toISOString();
const url = base;
// As perguntas das rodadas 3 e 4 vão no JSON também (o padrão de cada uma), para quem ler a rodada sem a folha.
const questions = copy ? [] : questionsFor(ordered.map((r) => r.shot));
const variant = copy ? (COPY_VARIANTS.find((v) => v.id === copy) ?? null) : null;
writeFileSync(
  join(OUT, 'prints.json'),
  `${JSON.stringify({ version, tag, createdAt, url, scene, fake, copy: variant, browser: browserName, problems, questions, results: ordered }, null, 2)}\n`,
);
writeFileSync(
  join(OUT, 'index.html'),
  contactSheetHtml({ version, tag, createdAt, browser: browserName, url, fake, copy, results: ordered, problems }),
);
const ok = ordered.filter((r) => r.status === 'ok').length;
const pending = ordered.filter((r) => r.status === 'pendente').length;
const copies = ordered.filter((r) => r.status === 'copia').length;
console.log(
  `prints: ${ok} de ${plan.length} em ${OUT}${pending ? ` (${pending} pendentes do passo 5)` : ''}` +
    `${copies ? ` (${copies} só na cópia descartável)` : ''}`,
);
console.log(`folha de contato: ${join(OUT, 'index.html')}`);
if (problems.length > 0) {
  for (const p of problems) console.log(`  - ${p}`);
  console.log('\nprints REPROVADO');
  process.exit(1);
}
console.log('\nprints ok');
