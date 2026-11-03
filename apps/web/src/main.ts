// Casca web. DOM só aqui (decisão #3): splash, input de texto escondido, input de arquivo e link de download.
// Boot: confere o navegador (ES2022 + WebGL2), cria a platform-web, liga o jogo e troca o splash pela canvas quando
// o primeiro frame do título estiver desenhado.
import { startGame, type GameHandle } from '@boboforces/game';
import { createMsdfUiPass, createRenderer } from '@boboforces/render';
import { bootWeb } from './boot.ts';
import type { WebPlatform } from './platform/index.ts';

/**
 * Gancho de depuração (só na casca web): o teste de fumaça no navegador e o console leem o estado do jogo e as
 * estatísticas do render (`programs` ≤ 7, regra 8) sem tocar no código compartilhado.
 */
export interface WebDebugHook {
  readonly screen: string;
  readonly paused: boolean;
  readonly frames: number;
  readonly simTick: number;
  readonly stats: GameHandle['renderer']['stats'];
}

function installDebugHook(game: GameHandle): void {
  const hook: WebDebugHook = {
    get screen() {
      return game.screen;
    },
    get paused() {
      return game.paused;
    },
    get frames() {
      return game.frames;
    },
    get simTick() {
      return game.match?.sim.tick ?? -1;
    },
    get stats() {
      return game.renderer.stats;
    },
  };
  window.__bfDebug = hook;
}

function start(platform: WebPlatform, boot: NonNullable<ReturnType<typeof bootWeb>>): void {
  const webInput = platform.webInput;
  const game = startGame({
    platform,
    createRenderer: (surface) =>
      createRenderer(
        surface,
        // O contexto é da plataforma: antialias e teto de DPR seguem o que ela escolheu (tecnico.md §6.10).
        { antialias: platform.graphics.antialias, maxPixelRatio: platform.graphics.maxPixelRatio },
        (three) => createMsdfUiPass(three),
      ),
    hooks: {
      onProgress: (fraction) => boot.setProgress(fraction),
      onMenuReady: () => boot.reveal(),
      onError: (error) => boot.fail(error),
      requestPointerLock: () => void webInput?.requestPointerLock(),
      releasePointerLock: () => webInput?.exitPointerLock(),
    },
  });
  // O pointer lock só sai dentro de um gesto: o clique do mouse na canvas durante a cena pega o mouse de volta (o
  // pedido automático ao entrar ou continuar pode ser recusado, por exemplo logo depois de o jogador sair com Esc).
  platform.graphics.canvas.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && game.wantsPointerLock && webInput && !webInput.pointerLocked) {
      void webInput.requestPointerLock();
    }
  });
  installDebugHook(game);
}

function main(): void {
  const boot = bootWeb({ assetsBaseUrl: new URL('./assets/', document.baseURI).href });
  if (!boot) return;
  try {
    start(boot.platform, boot);
  } catch (error) {
    boot.fail(error);
  }
}

// O splash pinta ANTES do boot: criar o contexto WebGL2 (e o processo da GPU, com o navegador frio) segura a thread
// principal por centenas de ms. Esperar um frame deixa o primeiro pixel em < 0,5 s (tecnico.md §16.4).
requestAnimationFrame(() => setTimeout(main, 0));
