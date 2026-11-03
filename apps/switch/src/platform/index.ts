import type { AudioSurface, Platform } from '@boboforces/platform-api';
import { createRomfsAssets } from './assets.ts';
import { readBuildManifest, type BuildManifest } from './build-info.ts';
import { createSwitchDiagnostics } from './diagnostics.ts';
import { createSdFiles } from './files.ts';
import { createFrameScheduler } from './frames.ts';
import { drawGlNotice, type NoticeGl } from './gl-notice.ts';
import { createSwitchGraphics, drawNotice } from './graphics.ts';
import { createSwitchInput } from './input.ts';
import { createSwitchLifecycle } from './lifecycle.ts';
import { ROMFS_ASSETS, SD_DIR, describeError, readNxGlobals, type NxEvent, type NxGlobals } from './nx.ts';
import { createSdStorage, type SdStorage } from './storage.ts';

export { SD_DIR, ROMFS_ASSETS, describeError, readNxGlobals, type NxGlobals } from './nx.ts';
export { describeBuild, type BuildManifest } from './build-info.ts';

/**
 * platform-switch: implementa `Platform` sobre o nx.js (application mode). Tudo o que é do Switch fica aqui:
 * `screen.getContext('webgl2')` + shim de canvas, save JSON em `sdmc:/switch/boboforces/` com backup, `romfs:/assets/`
 * para assets, Gamepad do nx.js, `runtime.log` com rotação, `online: null` sempre (decisão #1).
 *
 * O `+` do primeiro controle dispara `beforeunload` no nx.js (que fecharia o app): a casca cancela, porque o `+`
 * pausa e só se sai pelo menu com `platform.exit()` (regra 16). Exceção: sem GPU não há menu, então o `+` sai.
 */
export interface SwitchShell {
  readonly platform: Platform;
  /** WebGL2 disponível (application mode). */
  readonly hasGpu: boolean;
  readonly storage: SdStorage;
  /** `romfs:/manifest.json` gravado pelo build (`null` se faltar). */
  readonly build: BuildManifest | null;
  /** Linha no `runtime.log`. */
  log(line: string): void;
  /**
   * Mostra um aviso fora da UI do jogo (sem GPU ou falha no boot). Sem GPU sai em Canvas 2D; COM GPU sai pelo próprio
   * WebGL2 (o canvas já é WebGL2 e não dá um contexto 2D), redesenhado a cada frame. A partir daí o `+` volta a fechar
   * o app, porque não há menu para sair. Devolve `false` (e grava no log) se não deu para desenhar.
   */
  showNotice(lines: readonly string[]): boolean;
  dispose(): void;
}

export interface SwitchShellOptions {
  /** Globais já lidos (testes). Padrão: `readNxGlobals(globalThis)`. */
  readonly nx?: NxGlobals;
  /** Carimbo das linhas do log. Padrão: ISO 8601 do relógio do console. */
  readonly timestamp?: () => string;
}

function createAudio(nx: NxGlobals, log: (line: string) => void): AudioSurface | null {
  const AudioContextClass = nx.AudioContext;
  if (!AudioContextClass) return null;
  try {
    const context = new AudioContextClass();
    // No nx.js não há política de autoplay: o contexto já nasce liberado.
    return { context, unlocked: true, onUnlock: () => () => {} };
  } catch (error) {
    log(`áudio indisponível: ${describeError(error)}`);
    return null;
  }
}

export function createSwitchShell(opts: SwitchShellOptions = {}): SwitchShell {
  const nx = opts.nx ?? readNxGlobals(globalThis);
  const graphics = createSwitchGraphics(nx.screen);
  const diagnostics = createSwitchDiagnostics({
    fs: nx.Switch,
    sw: nx.Switch,
    dir: SD_DIR,
    gl: graphics.context,
    screen: nx.screen,
    timestamp: opts.timestamp ?? (() => new Date().toISOString()),
  });
  const log = diagnostics.appendLog;
  const storage = createSdStorage({
    fs: nx.Switch,
    dir: SD_DIR,
    setTimeout: nx.setTimeout,
    clearTimeout: nx.clearTimeout,
    onProblem: log,
  });
  const lifecycle = createSwitchLifecycle({ operationMode: () => nx.Switch.operationMode(), onEvent: log });
  // Save gravado no momento da pausa: a suspensão (HOME/sleep) não perde nada (tecnico.md §11.2).
  lifecycle.onPause(() => storage.flushSync());
  const input = createSwitchInput({ nx, onDisconnect: (index) => lifecycle.controllerLost(index) });
  // O ciclo de vida mede o vão entre o FIM de um frame e o início do seguinte, com o mesmo relógio nas duas pontas.
  const frames = createFrameScheduler({
    requestAnimationFrame: nx.requestAnimationFrame,
    beforeFrame: () => lifecycle.frame(nx.performance.now()),
    afterFrame: () => lifecycle.frameEnd(nx.performance.now()),
  });
  // Áudio criado no primeiro uso (o boot fica mais curto e o log começa pela linha de boot).
  let audio: AudioSurface | null | undefined;

  let exiting = false;
  let noticeShown = false;
  /** Aviso pelo WebGL2: linhas atuais e se o redesenho por frame já está agendado. */
  let glNotice: readonly string[] | null = null;
  let glNoticeLoop = false;
  const paintGlNotice = (): boolean => {
    if (!glNotice) return false;
    try {
      drawGlNotice(graphics.context as NoticeGl, nx.screen.width, nx.screen.height, glNotice);
      return true;
    } catch (error) {
      log(`aviso: o WebGL2 não desenhou (${describeError(error)})`);
      glNotice = null;
      return false;
    }
  };
  // O jogo parou de pedir frames (erro): a casca redesenha o aviso em todo frame, porque a troca de buffers do GL
  // não guarda o quadro anterior.
  const glNoticeFrame = (): void => {
    if (!paintGlNotice()) {
      glNoticeLoop = false;
      return;
    }
    frames.request(glNoticeFrame);
  };

  const onBeforeUnload = (event: NxEvent): void => {
    if (exiting || noticeShown || !graphics.hasGpu) return;
    event.preventDefault();
  };
  const onUnload = (): void => {
    storage.flushSync();
    log('app encerrado');
  };
  const onError = (event: NxEvent): void => log(`ERRO ${describeError(event.error ?? event.message)}`);
  const onRejection = (event: NxEvent): void => log(`PROMESSA REJEITADA ${describeError(event.reason)}`);
  nx.addEventListener('beforeunload', onBeforeUnload);
  nx.addEventListener('unload', onUnload);
  nx.addEventListener('error', onError);
  nx.addEventListener('unhandledrejection', onRejection);

  const platform: Platform = {
    id: 'switch',
    features: { profileHint: 'switch', touch: false, keyboardMouse: false, reducedMotion: false, canExit: true },
    graphics,
    storage,
    assets: createRomfsAssets(nx.Switch, ROMFS_ASSETS),
    files: createSdFiles(nx.Switch, SD_DIR),
    // Teclado do sistema (navigator.virtualKeyboard) fica para o T0: o jogo usa o teclado próprio no canvas.
    textInput: { available: false, open: () => null },
    lifecycle,
    diagnostics,
    input,
    get audio() {
      if (audio === undefined) audio = createAudio(nx, log);
      return audio;
    },
    online: null,
    now: () => nx.performance.now(),
    requestFrame: (callback) => frames.request(callback),
    cancelFrame: (handle) => frames.cancel(handle),
    exit() {
      exiting = true;
      storage.flushSync();
      log('saída pelo menu');
      nx.Switch.exit();
    },
  };

  return {
    platform,
    hasGpu: graphics.hasGpu,
    storage,
    build: readBuildManifest(nx.Switch),
    log,
    showNotice(lines) {
      // Com aviso na tela não há menu para sair: o `+` precisa poder fechar o app, mesmo que o desenho falhe.
      noticeShown = true;
      let shown: boolean;
      if (graphics.hasGpu) {
        glNotice = lines;
        shown = paintGlNotice();
        if (shown && !glNoticeLoop) {
          glNoticeLoop = true;
          frames.request(glNoticeFrame);
        }
      } else {
        shown = drawNotice(nx.screen, lines);
      }
      if (!shown) log(`aviso não desenhado: ${lines.join(' / ')}`);
      return shown;
    },
    dispose() {
      input.dispose();
      nx.removeEventListener('beforeunload', onBeforeUnload);
      nx.removeEventListener('unload', onUnload);
      nx.removeEventListener('error', onError);
      nx.removeEventListener('unhandledrejection', onRejection);
      storage.flushSync();
    },
  };
}

/** Contrato do esqueleto: só a `Platform` (a casca completa é `createSwitchShell`). */
export function createSwitchPlatform(): Platform {
  return createSwitchShell().platform;
}
