import { GAME_CODENAME, GAME_VERSION } from '@boboforces/format';
import {
  confirmConventionFor,
  createMenuInput,
  createRawInputState,
  type MenuConfirmConvention,
} from '@boboforces/input';
import type { GraphicsSurface, Platform } from '@boboforces/platform-api';
import type { Renderer, ViewDesc } from '@boboforces/render/data';
import type { Disposable, Unsubscribe } from '@boboforces/shared';
import {
  createDrawList,
  MIN_TEXT,
  MIN_TOUCH_TARGET,
  resetDrawList,
  settingsScreen,
  SETTINGS_ACTION,
  TITLE_ACTION,
  titleScreen,
  uiScale,
  type LayoutOptions,
  type UiFonts,
} from '@boboforces/ui';
import { loadGameAssets, type GameAssets } from './assets.ts';
import type { LocalDriver } from './local-driver.ts';
import { createMenuController, type UiFrame } from './menu.ts';
import { createNullRenderer } from './null-renderer.ts';
import { createTestScene, type TestScene } from './test-scene.ts';

/** Menus não têm mundo: `renderViews` vazio só zera as estatísticas do frame (o F2 mostra o custo da UI). */
const NO_VIEWS: readonly ViewDesc[] = [];

/** Linha que o `game` grava no log da plataforma no primeiro frame do menu (o portcheck e o Teste Zero procuram). */
export const MENU_READY_MARKER = '[boot] menu-ready';

/** Ganchos da casca (todos opcionais; o Switch e os testes passam só o que têm). */
export interface GameHooks {
  /** Progresso do carregamento inicial, de 0 a 1 (barra do splash na web). */
  onProgress?(fraction: number): void;
  /** O primeiro frame do título foi desenhado (a web troca o splash pela canvas). */
  onMenuReady?(): void;
  /** Falha que impede o jogo de seguir (asset essencial, erro dentro do frame). O laço para. */
  onError?(error: unknown): void;
  /** Só a web: pedir o pointer lock (o jogo quer o mouse para mirar) e soltar (pausa, menu). */
  requestPointerLock?(): void;
  releasePointerLock?(): void;
}

export interface GameDeps {
  readonly platform: Platform;
  /** `null` = sem GPU (portcheck, testes): o jogo roda com o NullRenderer. */
  readonly createRenderer: ((surface: GraphicsSurface) => Renderer) | null;
  readonly hooks?: GameHooks;
}

export type GameScreen = 'loading' | 'title' | 'settings' | 'scene' | 'error';

export interface GameHandle extends Disposable {
  /** Renderer em uso (o real ou o NullRenderer). */
  readonly renderer: Renderer;
  readonly screen: GameScreen;
  /** Partida pausada (só faz sentido na cena). */
  readonly paused: boolean;
  /** A cena está rodando no teclado/mouse: a casca web pede o pointer lock no próximo clique. */
  readonly wantsPointerLock: boolean;
  /** Frames rodados desde o boot. */
  readonly frames: number;
  /** Partida em andamento (testes e F2); `null` fora da cena. */
  readonly match: LocalDriver | null;
  /** Cena de teste em andamento (testes e F2). */
  readonly scene: TestScene | null;
}

/** Piso do texto em px reais (arte-ux.md §6.8): TV/Switch na dock, ou 13 px de layout no navegador. */
function minTextFor(platform: Platform): number {
  if (platform.id === 'switch') return MIN_TEXT.tv;
  return MIN_TEXT.phone * Math.max(1, platform.graphics.pixelRatio);
}

/**
 * Ponto de entrada das duas cascas: boot (carrega fontes e texturas pela `platform.assets`) → título (UI WebGL) →
 * JOGAR → cena de teste, com pausa e volta ao título. O laço é `platform.requestFrame`; o tempo do frame é a
 * diferença entre os timestamps do rAF (início do frame, sem o atraso de onde o callback roda), limitado a 0,1 s. Com `createRenderer: null` tudo roda igual, só que o
 * NullRenderer não desenha (portcheck, testes).
 */
export function startGame(deps: GameDeps): GameHandle {
  const { platform } = deps;
  const hooks = deps.hooks ?? {};
  const renderer = deps.createRenderer ? deps.createRenderer(platform.graphics) : createNullRenderer();
  const convention: MenuConfirmConvention = confirmConventionFor(platform.id);
  const raw = createRawInputState();
  const menuInput = createMenuInput(convention);
  const list = createDrawList(4096);
  const titleMenu = createMenuController();
  const settingsMenu = createMenuController();
  titleMenu.setRoot(
    titleScreen.build({ version: GAME_VERSION, codename: GAME_CODENAME, canExit: platform.features.canExit }),
  );
  settingsMenu.setRoot(settingsScreen.build(null));

  let screen: GameScreen = 'loading';
  let assets: GameAssets | null = null;
  let fonts: UiFonts | null = null;
  let scene: TestScene | null = null;
  let matches = 0;
  let frames = 0;
  let frameHandle = -1;
  /** Timestamp do rAF do frame anterior (-1 antes do primeiro). */
  let lastFrameMs = -1;
  const bootAt = platform.now();
  let menuReady = false;
  let wantsLock = false;
  let disposed = false;

  // UI do frame: refeita só quando o tamanho, a safe area ou as fontes mudam (o layout dos menus segue a revisão).
  let ui: UiFrame = { width: 1, height: 1, scale: 1, userScale: 1, options: {}, revision: 0 };
  function syncUi(): UiFrame {
    const g = platform.graphics;
    const w = Math.max(1, g.width);
    const h = Math.max(1, g.height);
    const safe = g.safeArea;
    const o = ui.options;
    if (
      ui.width === w &&
      ui.height === h &&
      o.fonts === fonts &&
      o.safeArea !== undefined &&
      o.safeArea.top === safe.top &&
      o.safeArea.right === safe.right &&
      o.safeArea.bottom === safe.bottom &&
      o.safeArea.left === safe.left
    ) {
      return ui;
    }
    const options: LayoutOptions = {
      fonts,
      safeArea: { top: safe.top, right: safe.right, bottom: safe.bottom, left: safe.left },
      minTarget: platform.features.touch ? MIN_TOUCH_TARGET * Math.max(1, g.pixelRatio) : 0,
      minTextPx: minTextFor(platform),
    };
    ui = {
      width: w,
      height: h,
      scale: uiScale(w, h, ui.userScale),
      userScale: ui.userScale,
      options,
      revision: ui.revision + 1,
    };
    return ui;
  }

  function log(line: string): void {
    platform.diagnostics.appendLog(line);
  }

  function fail(error: unknown): void {
    if (disposed) return;
    screen = 'error';
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    log(`[game] erro: ${message}`);
    hooks.onError?.(error);
  }

  function startScene(): void {
    scene?.dispose();
    matches++;
    scene = createTestScene({
      platform,
      renderer,
      assets,
      seed: 0x6b0b0 + matches,
      convention,
      device: menuInput.lastDevice,
      gamepad: menuInput.lastGamepad,
    });
    screen = 'scene';
    log(`[game] cena de teste ${matches} (dispositivo ${scene.device})`);
  }

  function leaveScene(): void {
    scene?.dispose();
    scene = null;
    screen = 'title';
  }

  /** Pointer lock na borda: pede quando a cena passa a querer o mouse, solta quando deixa de querer. */
  function syncPointerLock(): void {
    const want = scene?.wantsPointerLock ?? false;
    if (want === wantsLock) return;
    wantsLock = want;
    if (want) hooks.requestPointerLock?.();
    else hooks.releasePointerLock?.();
  }

  function step(frameMs: number): void {
    // O timestamp do rAF marca o vsync; `platform.now()` aqui dentro somaria o jitter de quando o callback rodou.
    const nowMs = Number.isFinite(frameMs) ? frameMs : platform.now();
    const dt = lastFrameMs < 0 ? 0 : Math.min(0.1, Math.max(0, (nowMs - lastFrameMs) / 1000));
    lastFrameMs = nowMs;
    platform.input.poll(raw);
    menuInput.update(raw, dt);
    const u = syncUi();
    resetDrawList(list, u.width, u.height);

    switch (screen) {
      case 'loading':
      case 'error':
        // Nada para desenhar: na web o splash (ou a página de erro) cobre a canvas.
        break;
      case 'title': {
        const nav = titleMenu.update(menuInput, raw, u);
        if (nav.activated === TITLE_ACTION.play) startScene();
        else if (nav.activated === TITLE_ACTION.settings) screen = 'settings';
        else if (nav.activated === TITLE_ACTION.quit) platform.exit();
        if (screen === 'title') {
          titleMenu.draw(list, u);
          renderer.renderViews(NO_VIEWS);
          renderer.drawUi(list);
        }
        break;
      }
      case 'settings': {
        const nav = settingsMenu.update(menuInput, raw, u);
        if (nav.back || nav.activated === SETTINGS_ACTION.back) screen = 'title';
        settingsMenu.draw(list, u);
        renderer.renderViews(NO_VIEWS);
        renderer.drawUi(list);
        break;
      }
      case 'scene':
        break;
    }
    if (screen === 'scene' && scene !== null) {
      if (scene.update(dt, raw, menuInput, u) === 'quit') leaveScene();
      else scene.render(list, u, fonts);
    }
    syncPointerLock();
    frames++;

    if (!menuReady && screen === 'title') {
      menuReady = true;
      log(`${MENU_READY_MARKER} ${Math.round(platform.now() - bootAt)} ms`);
      hooks.onMenuReady?.();
    }
  }

  function onFrame(frameMs: number): void {
    if (disposed || screen === 'error') return;
    try {
      step(frameMs);
    } catch (error) {
      fail(error);
      return;
    }
    frameHandle = platform.requestFrame(onFrame);
  }

  const unsubscribes: Unsubscribe[] = [
    // Pointer lock perdido, aba oculta, HOME, dock↔portátil, controle desconectado: solo pausa (tecnico.md §4.2).
    platform.lifecycle.onPause(() => scene?.pause()),
  ];

  log(
    `[boot] BoboForces ${GAME_VERSION} "${GAME_CODENAME}" · ${platform.id} · render ${deps.createRenderer ? 'WebGL2' : 'nulo'}`,
  );
  hooks.onProgress?.(0.1);
  loadGameAssets(platform.assets, (f) => hooks.onProgress?.(0.1 + f * 0.8)).then(
    (loaded) => {
      if (disposed) return;
      assets = loaded;
      fonts = loaded.fonts.fonts;
      renderer.setUiAtlas(loaded.uiAtlas);
      screen = 'title';
    },
    (error: unknown) => fail(error),
  );
  frameHandle = platform.requestFrame(onFrame);

  return {
    renderer,
    get screen(): GameScreen {
      return screen;
    },
    get paused(): boolean {
      return scene?.paused ?? false;
    },
    get wantsPointerLock(): boolean {
      return scene?.wantsPointerLock ?? false;
    },
    get frames(): number {
      return frames;
    },
    get match(): LocalDriver | null {
      return scene?.driver ?? null;
    },
    get scene(): TestScene | null {
      return scene;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      platform.cancelFrame(frameHandle);
      for (const unsubscribe of unsubscribes) unsubscribe();
      scene?.dispose();
      scene = null;
      if (wantsLock) hooks.releasePointerLock?.();
      renderer.setUiAtlas(null);
      renderer.dispose();
    },
  };
}
