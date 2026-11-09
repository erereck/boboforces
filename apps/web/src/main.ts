// Casca web. DOM só aqui (decisão #3): splash, input de texto escondido, input de arquivo e link de download.
// Boot: confere o navegador (ES2022 + WebGL2), cria a platform-web, liga o jogo e troca o splash pela canvas quando
// o primeiro frame do título estiver desenhado.
//
// M1:
// - O menu desenha com o renderer só de UI (`@boboforces/render/menu`); a cena (`@boboforces/game/scene`) e o
//   renderer completo vêm juntos por `import()` (`src/scene.ts`) quando o jogador entra no Construto.
// - `?bench&…` (ou `/bench/?…`) começa direto no bench: a parte da casca do bench (`src/bench/shell.ts`: leitura da
//   URL, área de transferência e atalhos do relatório) vem por `import()` dinâmico, só nesse caso, para o menu normal
//   não pagar os bytes; as rotas de criação do renderer (atlas, atributos em float) saem da mesma configuração.
// - O F2 chega ao jogo como qualquer tecla, pelo `RawInputState` dos adaptadores de `src/input` (contrato do input;
//   o adaptador não devolve o F2 ao navegador).
// - `window.__bfDebug` (`debug-hook.ts`) expõe o estado, o gancho dos prints (`print` = `GameHandle.debug`) e o
//   relatório do bench para o smoke, os prints e o bench do PC.
// - `?titulo=switch` abre a prévia do título do Switch (`title-preview.ts`), só para o print do título.
import { startGame } from '@boboforces/game';
import { createMenuRenderer, createMsdfUiPass } from '@boboforces/render/menu';
import { createLogger } from '@boboforces/shared';
import { rendererOptionsFor, urlAsksForBench } from './bench/options.ts';
import type { ReportDelivery } from './bench/report.ts';
import type { BenchShell } from './bench/shell.ts';
import { bootWeb, type WebBoot } from './boot.ts';
import { createDebugHook } from './debug-hook.ts';
import { BUILD_INFO, type WebPlatform } from './platform/index.ts';
import { asSwitchTitlePlatform, SWITCH_TITLE_ITEMS, urlAsksForSwitchTitle } from './title-preview.ts';

/** Resultado do relatório no título da aba (sem UI em DOM, decisão #3). */
const TITLE_SUFFIX: Readonly<Record<ReportDelivery, string>> = {
  copiado: 'relatório copiado',
  baixado: 'relatório baixado',
  falhou: 'relatório não saiu (veja o console)',
};

async function loadBenchShell(platform: WebPlatform): Promise<BenchShell | null> {
  const search = window.location.search;
  if (!urlAsksForBench(search)) return null;
  const log = createLogger('web');
  const baseTitle = document.title;
  const { createBenchShell } = await import('./bench/shell.ts');
  const shell = createBenchShell(search, {
    writeClipboard: navigator.clipboard ? (text) => navigator.clipboard.writeText(text) : null,
    save: (name, data, mimeType) => platform.files.save(name, data, mimeType),
    log: (line) => {
      platform.diagnostics.appendLog(line);
      log.info(line);
    },
    notify: (delivery) => {
      document.title = `${baseTitle} · ${TITLE_SUFFIX[delivery]}`;
    },
    version: BUILD_INFO.version,
    now: () => new Date(),
  });
  for (const warning of shell?.warnings ?? []) {
    platform.diagnostics.appendLog(`[bench] aviso ${warning}`);
    log.warn(`bench: ${warning}`);
  }
  return shell;
}

function start(platform: WebPlatform, boot: WebBoot, bench: BenchShell | null): void {
  const webInput = platform.webInput;
  const options = rendererOptionsFor(platform.graphics, bench?.config ?? null);
  // Prévia do título do Switch (`?titulo=switch`, prints da decisão #54): a plataforma com a cara do Switch e os 9
  // itens de teste dele, sem cena (`title-preview.ts`).
  const switchTitle = !bench && urlAsksForSwitchTitle(window.location.search);
  const game = startGame({
    platform: switchTitle ? asSwitchTitlePlatform(platform) : platform,
    // O menu desenha com o renderer só de UI; o completo (mundo, atores, VFX) chega com a cena (`loadScene`), por
    // `import()`, fora da carga inicial (tecnico.md §16.4: menu ≤ 350 KB).
    createRenderer: (surface, routes) =>
      createMenuRenderer(surface, { ...options, ...(routes ?? {}) }, (three) => createMsdfUiPass(three)),
    ...(switchTitle
      ? { testItems: SWITCH_TITLE_ITEMS }
      : { loadScene: () => import('./scene.ts').then((m) => m.sceneBundle(options)) }),
    hooks: {
      onProgress: (fraction) => boot.setProgress(fraction),
      onMenuReady: () => boot.reveal(),
      onError: (error) => boot.fail(error),
      requestPointerLock: () => void webInput?.requestPointerLock(),
      releasePointerLock: () => webInput?.exitPointerLock(),
      onBenchReport: (text) => {
        // O relatório pede o mouse livre (tocar/clicar copia) e fica no console para quem roda pelo DevTools.
        webInput?.exitPointerLock();
        console.info(text);
        void bench?.report.receive(text);
      },
    },
    ...(bench ? { bench: bench.config, benchWarnings: bench.warnings } : {}),
  });
  // O pointer lock só sai dentro de um gesto: o clique do mouse na canvas durante a cena pega o mouse de volta (o
  // pedido automático ao entrar ou continuar pode ser recusado, por exemplo logo depois de o jogador sair com Esc).
  platform.graphics.canvas.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && game.wantsPointerLock && webInput && !webInput.pointerLocked) {
      void webInput.requestPointerLock();
    }
  });
  bench?.install(window, platform.graphics.canvas);
  window.__bfDebug = createDebugHook({
    game,
    bench: bench?.config ?? null,
    benchWarnings: bench?.warnings ?? [],
    report: bench?.report ?? null,
    memory: () => platform.diagnostics.memoryUsage(),
    recentLog: (maxLines) => platform.diagnostics.recentLog(maxLines),
  });
}

async function main(): Promise<void> {
  const search = window.location.search;
  const boot = bootWeb({
    assetsBaseUrl: new URL('./assets/', document.baseURI).href,
    // M2 (fase 8c): o service worker só no build de produção, fora do bench e da prévia do título do Switch.
    serviceWorker: import.meta.env.PROD && !urlAsksForBench(search) && !urlAsksForSwitchTitle(search),
  });
  if (!boot) return;
  try {
    start(boot.platform, boot, await loadBenchShell(boot.platform));
  } catch (error) {
    boot.fail(error);
  }
}

// O splash pinta ANTES do boot: criar o contexto WebGL2 (e o processo da GPU, com o navegador frio) segura a thread
// principal por centenas de ms. Esperar um frame deixa o primeiro pixel em < 0,5 s (tecnico.md §16.4).
requestAnimationFrame(() => setTimeout(() => void main(), 0));
