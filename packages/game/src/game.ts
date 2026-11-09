import {
  DEBUT_PRESET,
  GAME_CODENAME,
  GAME_VERSION,
  selectPlatformProfile,
  withPresetLevel,
  type BotLevel,
  type MatchRecipe,
} from '@boboforces/format';
import { stepLevel } from './pause.ts';
import {
  confirmConventionFor,
  createMenuInput,
  createRawInputState,
  type MenuConfirmConvention,
} from '@boboforces/input';
import type { Platform } from '@boboforces/platform-api';
import type { Renderer, ViewDesc } from '@boboforces/render/data';
import { createRng, type Disposable, type Unsubscribe } from '@boboforces/shared';
import {
  createDrawList,
  createLoadingModel,
  createTestScreenModel,
  drawLoadingScreen,
  drawTestScreen,
  CUSTOM_ACTION,
  CUSTOM_ROW_PREFIX,
  CUSTOM_TAB_PREFIX,
  customMatchScreen,
  MAIN_MENU_ACTION,
  mainMenuScreen,
  MODES_ACTION,
  MODES_PREFIX,
  modesScreen,
  QUICK_ACTION,
  QUICK_ROWS,
  QUICK_SHORTCUT_PREFIX,
  quickMatchScreen,
  MIN_TEXT,
  MIN_TOUCH_TARGET,
  resetDrawList,
  settingsScreen,
  SETTINGS_ACTION,
  SURPRISE_ACTION,
  surpriseScreen,
  TITLE_ACTION,
  TITLE_ACTION_TEST_PREFIX,
  t,
  titleScreen,
  uiScale,
  type LayoutOptions,
  type StringKey,
  type TitleExtraItem,
  type UiAtlasImage,
  type UiFonts,
} from '@boboforces/ui';
import { loadGameAssets } from './assets.ts';
import type { BenchConfig, GameDebugApi, TestItem, TestRunner } from './bench/types.ts';
import type { LocalDriver } from './local-driver.ts';
import { createMenuController, type UiFrame } from './menu.ts';
import { createNullRenderer } from './null-renderer.ts';
import { CUSTOM_TAB_LABELS, CUSTOM_TABS, customRows, presetName, stepCustom } from './custom-match.ts';
import { presetLines, presetShortcut, presetSummary, rollSurprise } from './presets-ui.ts';
import {
  factoryPresets,
  QUICK_MODES,
  quickFromPreset,
  quickToPreset,
  quickValue,
  stepQuick,
  type QuickMode,
  type QuickSettings,
} from './quick-match.ts';
import { createSaveStore, libraryCapsFor, type SaveStore } from './save-store.ts';
import {
  DEFAULT_RENDERER_ROUTES,
  type RendererFactory,
  type RendererRoutes,
  type Scene,
  type SceneBundle,
  type SceneKind,
  type SceneRequest,
} from './scene-api.ts';

/** Menus não têm mundo: `renderViews` vazio só zera as estatísticas do frame (o F2 mostra o custo da UI). */
const NO_VIEWS: readonly ViewDesc[] = [];

/** Linha que o `game` grava no log da plataforma no primeiro frame do menu (o portcheck e o Teste Zero procuram). */
export const MENU_READY_MARKER = '[boot] menu-ready';

/** Item extra do título na web (decisão da integração do M1): andar no Construto sem bots. */
export const VITRINE_ITEM_ID = 'vitrine';

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
  /**
   * M1: o bench terminou; `text` é o relatório (`formatBenchReport`). A web mostra para copiar; o Switch grava no
   * `runtime.log` linha a linha com `[bench] `.
   */
  onBenchReport?(text: string): void;
}

export interface GameDeps {
  readonly platform: Platform;
  /**
   * `null` = sem GPU (portcheck, testes): o jogo roda com o NullRenderer. M1: recebe as rotas do Teste Zero (`routes`;
   * ausente = as do bench pedido na criação ou o padrão); o jogo recria o renderer quando um bench pede outra rota.
   */
  readonly createRenderer: RendererFactory | null;
  readonly hooks?: GameHooks;
  /**
   * M1: começar direto no bench com esta configuração (web: `?bench&…`, lida pela casca com `parseBenchParams`;
   * Switch: `bench.json` no SD). Ausente = título normal.
   */
  readonly bench?: BenchConfig;
  /** M1: avisos da leitura do bench (parâmetro desconhecido, valor limitado); entram em `BenchReport.warnings`. */
  readonly benchWarnings?: readonly string[];
  /** M1: itens extras de teste no título (Switch: presets do bench, Controles, Teclado, Áudio). */
  readonly testItems?: readonly TestItem[];
  /**
   * M1: a cena (Construto). Web: `import()` do subcaminho `@boboforces/game/scene` (fora da carga inicial do menu) e o
   * renderer completo; Switch e testes: o módulo direto. Ausente = JOGAR não abre nada (só registra no log).
   */
  readonly loadScene?: () => Promise<SceneBundle>;
}

export type GameScreen =
  'loading' | 'title' | 'main' | 'quick' | 'modes' | 'custom' | 'surprise' | 'settings' | 'scene' | 'test' | 'error';

export interface GameHandle extends Disposable {
  /** Renderer em uso (o real ou o NullRenderer). M1: pode trocar (menu → cena completa; rotas do bench). */
  readonly renderer: Renderer;
  readonly screen: GameScreen;
  /** Partida pausada (só faz sentido na cena). */
  readonly paused: boolean;
  /** A cena está rodando no teclado/mouse: a casca web pede o pointer lock no próximo clique. */
  readonly wantsPointerLock: boolean;
  /** Frames rodados desde o boot. */
  readonly frames: number;
  /** Partida em andamento (testes e F2); `null` fora da cena (e durante o loading dela). */
  readonly match: LocalDriver | null;
  /** Cena em andamento (loading ou partida); `null` fora dela. */
  readonly scene: Scene | null;
  /** M1: gancho de depuração dos prints (`window.__bfDebug.print`): não nulo quando o Construto carregou. */
  readonly debug: GameDebugApi | null;
  /** M2 (fase 4b): o save do jogador (ajustes, estatísticas, presets e bots), lido na criação. */
  readonly save: SaveStore;
}

/** Piso do texto em px reais (arte-ux.md §6.8): TV/Switch na dock, ou 13 px de layout no navegador. */
function minTextFor(platform: Platform): number {
  if (platform.id === 'switch') return MIN_TEXT.tv;
  return MIN_TEXT.phone * Math.max(1, platform.graphics.pixelRatio);
}

function routesOf(bench: BenchConfig | null | undefined): RendererRoutes {
  return bench ? { textureMode: bench.textureMode, vertexAttributes: bench.vertexAttributes } : DEFAULT_RENDERER_ROUTES;
}

/**
 * Ponto de entrada das duas cascas: boot (fontes pela `platform.assets`) → título (UI WebGL) → JOGAR (Construto em
 * TDM com bots), Cena-vitrine (web) ou um item de teste (Switch) → a cena carrega por etapas e roda, com pausa e volta
 * ao título. Bench (`GameDeps.bench`) entra na cena depois de um frame do título. O laço é `platform.requestFrame`; o
 * tempo do frame é a diferença entre os timestamps do rAF, limitado a 0,1 s. Com `createRenderer: null` tudo roda
 * igual, só que o NullRenderer não desenha (portcheck, testes).
 */
export function startGame(deps: GameDeps): GameHandle {
  const { platform } = deps;
  const hooks = deps.hooks ?? {};
  // M2 (fase 4b): o save do jogador. O que veio estragado ou de versão antiga vai para o log (e para o relatório).
  const save = createSaveStore(platform.storage, libraryCapsFor(platform.id));
  for (const w of save.loadWarnings) platform.diagnostics.appendLog(`[save] ${w.path}: ${w.code}`);
  let renderer: Renderer = deps.createRenderer
    ? deps.createRenderer(platform.graphics, routesOf(deps.bench))
    : createNullRenderer();
  /** Fábrica do renderer completo, quando a casca entrega outra junto com a cena (web). */
  let sceneFactory: RendererFactory | null = deps.createRenderer;
  let sceneRendererReady = false;
  const convention: MenuConfirmConvention = confirmConventionFor(platform.id);
  const raw = createRawInputState();
  const menuInput = createMenuInput(convention);
  const list = createDrawList(4096);
  const titleMenu = createMenuController();
  const settingsMenu = createMenuController();
  const testItems = deps.testItems ?? [];
  const extraItems: TitleExtraItem[] = [
    ...(platform.id === 'web' && deps.loadScene ? [{ id: VITRINE_ITEM_ID, labelKey: 'title.vitrine' as const }] : []),
    ...testItems.map((item) => ({ id: item.id, labelKey: item.labelKey })),
  ];
  const mainMenu = createMenuController();
  const surpriseMenu = createMenuController();
  /**
   * M2 (fase 4c): o que o JOGAR joga: o último preset (o save guarda os 5 últimos) ou, na primeira vez, a partida de
   * estreia (gameplay.md §2.5).
   */
  const currentPreset = (): MatchRecipe => save.presets.recent[0] ?? DEBUT_PRESET;
  /** O preset da partida em andamento (para De novo, Mais fácil, Mais difícil, Mudar regras e Salvar preset). */
  let playingPreset: MatchRecipe | null = null;
  /** O sorteio na tela do Surpreenda-me. */
  let surprise: MatchRecipe = DEBUT_PRESET;
  const surpriseRng = createRng(Math.floor(platform.now()) >>> 0);
  function refreshTitle(): void {
    titleMenu.setRoot(
      titleScreen.build({
        version: GAME_VERSION,
        codename: GAME_CODENAME,
        canExit: platform.features.canExit,
        playSummary: presetSummary(currentPreset()),
        ...(extraItems.length > 0 ? { extraItems } : {}),
      }),
    );
  }
  refreshTitle();
  mainMenu.setRoot(mainMenuScreen.build({ items: ['quickMatch', 'modes', 'settings'] }));

  // M2 (fase 4d): Partida Rápida e Modos.
  const quickMenu = createMenuController();
  const modesMenu = createMenuController();
  modesMenu.setRoot(
    modesScreen.build({
      modes: QUICK_MODES.map((id) => ({
        id,
        nameKey: id === 'warfare.tdm' ? 'mode.name.warfare.tdm' : 'mode.name.warfare.ffa',
        descKey: id === 'warfare.tdm' ? 'mode.desc.warfare.tdm' : 'mode.desc.warfare.ffa',
      })),
    }),
  );
  /** Teto de bots do aparelho com 1 jogador local (a Partida Rápida não deixa passar). */
  const maxBots = selectPlatformProfile(platform.features.profileHint, 1).maxBots;
  let quick: QuickSettings = quickFromPreset(DEBUT_PRESET, maxBots);
  /** Os atalhos na tela, por grupo, para achar o preset do botão apertado. */
  const quickGroups = new Map<string, readonly MatchRecipe[]>();
  function rebuildQuick(): void {
    const favorites = save.presets.favorites
      .map((name) => save.presets.saved.find((p) => p.name === name))
      .filter((p): p is MatchRecipe => p !== undefined);
    const groups = [
      { id: 'recent', titleKey: 'quick.recent' as const, presets: save.presets.recent },
      { id: 'favorites', titleKey: 'quick.favorites' as const, presets: favorites },
      { id: 'factory', titleKey: 'quick.factory' as const, presets: factoryPresets() },
    ];
    quickGroups.clear();
    for (const g of groups) quickGroups.set(g.id, g.presets);
    quickMenu.setRoot(
      quickMatchScreen.build({
        values: QUICK_ROWS.map((row) => quickValue(quick, row)),
        groups: groups.map((g) => ({ id: g.id, titleKey: g.titleKey, items: g.presets.map(presetShortcut) })),
      }),
    );
  }
  // M2 (fase 4e): Partida personalizada.
  const customMenu = createMenuController();
  let customRecipe: MatchRecipe = DEBUT_PRESET;
  let customTab = 0;
  let customNote = '';
  let customReturn: GameScreen = 'quick';
  const customLimits = {
    maxBots,
    maxViewM: selectPlatformProfile(platform.features.profileHint, 1).maxViewDistanceM,
  };
  function rebuildCustom(): void {
    const tab = CUSTOM_TABS[customTab]!;
    customMenu.setRoot(
      customMatchScreen.build({
        tabs: CUSTOM_TABS.map((id) => CUSTOM_TAB_LABELS[id]),
        tab: customTab,
        rows: customRows(tab, customRecipe).map((r) => ({
          id: r.id,
          labelKey: r.labelKey,
          value: r.value(customRecipe),
        })),
        summary: presetSummary(customRecipe),
        note: customNote,
      }),
    );
  }
  function openCustom(recipe: MatchRecipe, back: GameScreen): void {
    customRecipe = recipe;
    customTab = 0;
    customNote = '';
    customReturn = back;
    rebuildCustom();
    customMenu.focus('start');
    screen = 'custom';
  }
  /** Salva o preset com nome do gerador ("Times 4×4 De boa"; repetido, " 2"); devolve o aviso para a tela. */
  function saveCustomPreset(recipe: MatchRecipe): string {
    const short = presetShortcut({ ...recipe, name: '' }).label;
    const base = `${t(`mode.short.${recipe.mode}` as StringKey)} ${short}`;
    const name = presetName(base, (n) => save.presets.saved.some((p) => p.name === n));
    const ok = save.savePreset({ ...recipe, name, seed: 0 });
    return ok ? t('custom.saved', { name }) : t('custom.full');
  }

  /** Abre a Partida Rápida como o último preset estava (com o modo pedido, se veio dos Modos). */
  function openQuick(mode: QuickMode | null): void {
    quick = quickFromPreset(currentPreset(), maxBots);
    if (mode !== null && mode !== quick.mode) quick = stepQuick(quick, 'mode', 1, maxBots);
    rebuildQuick();
    quickMenu.focus('start');
    screen = 'quick';
  }
  settingsMenu.setRoot(settingsScreen.build(null));
  function rollNewSurprise(): void {
    surprise = rollSurprise(surpriseRng);
    surpriseMenu.setRoot(surpriseScreen.build({ lines: presetLines(surprise) }));
  }

  let screen: GameScreen = 'loading';
  let fonts: UiFonts | null = null;
  let uiAtlas: UiAtlasImage | null = null;
  let scene: Scene | null = null;
  /** Cena pedida esperando o `loadScene` (web: o chunk da cena chegando). */
  let pendingScene: SceneRequest | null = null;
  const pendingLoading = createLoadingModel();
  pendingLoading.mapName = 'Construto';
  let runner: TestRunner | null = null;
  const testModel = createTestScreenModel();
  let matches = 0;
  let frames = 0;
  let frameHandle = -1;
  /** Timestamp do rAF do frame anterior (-1 antes do primeiro). */
  let lastFrameMs = -1;
  const bootAt = platform.now();
  let menuReady = false;
  let wantsLock = false;
  let disposed = false;
  let bundle: SceneBundle | null = null;
  let bundlePromise: Promise<SceneBundle> | null = null;

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

  /**
   * Troca o renderer (entre frames, sem cena viva): menu → completo na primeira cena da web, ou outra rota de
   * criação pedida por um bench (atlas, atributos em float; Teste Zero). O contexto GL é da casca e continua.
   */
  function swapRenderer(factory: RendererFactory, routes: RendererRoutes): void {
    renderer.setUiAtlas(null);
    renderer.dispose();
    renderer = factory(platform.graphics, routes);
    renderer.setUiAtlas(uiAtlas);
    log(`[game] renderer recriado: textura=${routes.textureMode} atributos=${routes.vertexAttributes}`);
  }

  function prepareRenderer(next: SceneBundle, routes: RendererRoutes): void {
    if (!deps.createRenderer) return;
    if (next.createRenderer && !sceneRendererReady) {
      sceneFactory = next.createRenderer;
      sceneRendererReady = true;
      swapRenderer(sceneFactory, routes);
      return;
    }
    sceneRendererReady = true;
    const info = renderer.info;
    if (
      sceneFactory &&
      (info.textureMode !== routes.textureMode || info.vertexAttributes !== routes.vertexAttributes)
    ) {
      swapRenderer(sceneFactory, routes);
    }
  }

  function requestScene(kind: SceneKind, bench: BenchConfig | null, recipe: MatchRecipe | null = null): void {
    if (!deps.loadScene) {
      log('[game] cena indisponível nesta casca (sem loadScene)');
      return;
    }
    matches++;
    pendingScene = {
      kind,
      bench,
      benchWarnings: bench ? (deps.benchWarnings ?? []) : [],
      seed: bench ? bench.seed : (0x6b0b0 + matches * 0x9e37) >>> 0,
      convention,
      device: menuInput.lastDevice,
      gamepad: menuInput.lastGamepad,
      ...(recipe ? { recipe } : {}),
    };
    screen = 'scene';
    pendingLoading.current = 0;
    if (!bundlePromise) {
      bundlePromise = deps.loadScene();
      bundlePromise.then(
        (b) => {
          bundle = b;
        },
        (error: unknown) => fail(error),
      );
    }
  }

  function startPendingScene(): void {
    const request = pendingScene;
    if (!request || !bundle) return;
    pendingScene = null;
    prepareRenderer(bundle, routesOf(request.bench));
    scene = bundle.module.createScene(
      {
        platform,
        renderer,
        fonts,
        uiAtlas,
        log,
        benchReport: (text) => hooks.onBenchReport?.(text),
      },
      request,
    );
    log(`[game] cena ${matches}: ${request.kind}${request.bench ? ` (vistas=${request.bench.views})` : ''}`);
  }

  function leaveScene(): void {
    scene?.dispose();
    scene = null;
    pendingScene = null;
    screen = 'title';
    refreshTitle();
    // De volta da partida, o foco é o JOGAR (revanche em 1 interação, arte-ux.md §6.4).
    titleMenu.focus('play');
  }

  /** M2 (fase 4c): joga um preset: ele vira o último (o do JOGAR) e a partida começa com semente nova. */
  function playPreset(preset: MatchRecipe): void {
    playingPreset = preset;
    save.pushRecent({ ...preset, seed: 0 });
    requestScene('play', null, preset);
  }

  /** JOGAR do título: o último preset (ou a partida de estreia). */
  function play(): void {
    playPreset(currentPreset());
  }

  function startTest(item: TestItem): void {
    if (item.bench) {
      requestScene('bench', item.bench);
      return;
    }
    if (!item.start) return;
    runner = item.start({ platform, log });
    screen = 'test';
  }

  function closeTest(): void {
    runner?.dispose();
    runner = null;
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

  function step(timestampMs: number): void {
    // O timestamp do rAF marca o vsync; `platform.now()` aqui dentro somaria o jitter de quando o callback rodou.
    const nowMs = Number.isFinite(timestampMs) ? timestampMs : platform.now();
    // Intervalo cru (bench e F2 medem o frame de verdade) e o limitado a 0,1 s (a sim não salta mais que isso).
    const intervalMs = lastFrameMs < 0 ? 0 : Math.max(0, nowMs - lastFrameMs);
    const dt = Math.min(0.1, intervalMs / 1000);
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
        const action = nav.activated;
        if (action === TITLE_ACTION.play) play();
        else if (action === TITLE_ACTION.surprise) {
          rollNewSurprise();
          screen = 'surprise';
        } else if (action === TITLE_ACTION.change) screen = 'main';
        else if (action === TITLE_ACTION.quit) platform.exit();
        else if (action !== null && action.startsWith(TITLE_ACTION_TEST_PREFIX)) {
          const id = action.slice(TITLE_ACTION_TEST_PREFIX.length);
          if (id === VITRINE_ITEM_ID) requestScene('vitrine', null);
          else {
            const item = testItems.find((i) => i.id === id);
            if (item) startTest(item);
          }
        }
        if (screen === 'title') {
          titleMenu.draw(list, u);
          renderer.renderViews(NO_VIEWS);
          renderer.drawUi(list);
        }
        break;
      }
      case 'main': {
        const nav = mainMenu.update(menuInput, raw, u);
        if (nav.back || nav.activated === MAIN_MENU_ACTION.back) screen = 'title';
        else if (nav.activated === MAIN_MENU_ACTION.settings) screen = 'settings';
        else if (nav.activated === MAIN_MENU_ACTION.quickMatch) openQuick(null);
        else if (nav.activated === MAIN_MENU_ACTION.modes) screen = 'modes';
        if (screen === 'main') {
          mainMenu.draw(list, u);
          renderer.renderViews(NO_VIEWS);
          renderer.drawUi(list);
        }
        break;
      }
      case 'quick': {
        const nav = quickMenu.update(menuInput, raw, u);
        const a = nav.activated;
        if (nav.back || a === QUICK_ACTION.back) screen = 'main';
        else if (a === QUICK_ACTION.start) playPreset(quickToPreset(quick));
        else if (a === QUICK_ACTION.custom) openCustom(quickToPreset(quick), 'quick');
        else if (a !== null && (QUICK_ROWS as readonly string[]).includes(a)) {
          // Linha de opção: esquerda e direita andam; o confirmar avança um.
          quick = stepQuick(quick, a as (typeof QUICK_ROWS)[number], nav.delta === 0 ? 1 : nav.delta, maxBots);
          rebuildQuick();
        } else if (a !== null && a.startsWith(QUICK_SHORTCUT_PREFIX)) {
          const [group, index] = a.slice(QUICK_SHORTCUT_PREFIX.length).split(':');
          const preset = quickGroups.get(group ?? '')?.[Number(index)];
          if (preset) playPreset(preset);
        }
        if (screen === 'quick') {
          quickMenu.draw(list, u);
          renderer.renderViews(NO_VIEWS);
          renderer.drawUi(list);
        }
        break;
      }
      case 'custom': {
        const nav = customMenu.update(menuInput, raw, u);
        const a = nav.activated;
        if (nav.tab !== 0) {
          customTab = (customTab + nav.tab + CUSTOM_TABS.length) % CUSTOM_TABS.length;
          rebuildCustom();
        } else if (nav.back || a === CUSTOM_ACTION.back) screen = customReturn;
        else if (a === CUSTOM_ACTION.start) playPreset(customRecipe);
        else if (a === CUSTOM_ACTION.save) {
          customNote = saveCustomPreset(customRecipe);
          rebuildCustom();
        } else if (a !== null && a.startsWith(CUSTOM_TAB_PREFIX)) {
          customTab = Number(a.slice(CUSTOM_TAB_PREFIX.length));
          rebuildCustom();
        } else if (a !== null && a.startsWith(CUSTOM_ROW_PREFIX)) {
          const id = a.slice(CUSTOM_ROW_PREFIX.length);
          customRecipe = stepCustom(CUSTOM_TABS[customTab]!, customRecipe, id, nav.delta, customLimits);
          customNote = '';
          rebuildCustom();
        }
        if (screen === 'custom') {
          customMenu.draw(list, u);
          renderer.renderViews(NO_VIEWS);
          renderer.drawUi(list);
        }
        break;
      }
      case 'modes': {
        const nav = modesMenu.update(menuInput, raw, u);
        const a = nav.activated;
        if (nav.back || a === MODES_ACTION.back) screen = 'main';
        else if (a !== null && a.startsWith(MODES_PREFIX)) {
          const id = a.slice(MODES_PREFIX.length);
          if ((QUICK_MODES as readonly string[]).includes(id)) openQuick(id as QuickMode);
        }
        if (screen === 'modes') {
          modesMenu.draw(list, u);
          renderer.renderViews(NO_VIEWS);
          renderer.drawUi(list);
        }
        break;
      }
      case 'surprise': {
        const nav = surpriseMenu.update(menuInput, raw, u);
        if (nav.back || nav.activated === SURPRISE_ACTION.back) screen = 'title';
        else if (nav.activated === SURPRISE_ACTION.reroll) rollNewSurprise();
        else if (nav.activated === SURPRISE_ACTION.play) playPreset(surprise);
        if (screen === 'surprise') {
          surpriseMenu.draw(list, u);
          renderer.renderViews(NO_VIEWS);
          renderer.drawUi(list);
        }
        break;
      }
      case 'settings': {
        const nav = settingsMenu.update(menuInput, raw, u);
        if (nav.back || nav.activated === SETTINGS_ACTION.back) screen = 'main';
        settingsMenu.draw(list, u);
        renderer.renderViews(NO_VIEWS);
        renderer.drawUi(list);
        break;
      }
      case 'test': {
        const r = runner;
        if (!r) {
          screen = 'title';
          break;
        }
        r.update(raw, dt);
        if (r.finished || menuInput.pressed('back')) {
          closeTest();
          break;
        }
        r.describe(testModel);
        drawTestScreen(list, fonts, testModel, u.width, u.height);
        renderer.renderViews(NO_VIEWS);
        renderer.drawUi(list);
        break;
      }
      case 'scene':
        break;
    }
    if (screen === 'scene') {
      if (pendingScene !== null) {
        if (bundle !== null) startPendingScene();
        else {
          // O código da cena ainda está chegando (web: o chunk do `import()`).
          drawLoadingScreen(list, fonts, pendingLoading, u.width, u.height, {
            minTextPx: u.options.minTextPx ?? MIN_TEXT.phone,
            safeArea: platform.graphics.safeArea,
          });
          renderer.renderViews(NO_VIEWS);
          renderer.drawUi(list);
        }
      }
      const signal = scene !== null ? scene.frame(dt, raw, menuInput, u, list, intervalMs) : 'none';
      if (signal === 'quit') leaveScene();
      else if (signal === 'again' || signal === 'easier' || signal === 'harder') {
        // M2 (fase 2e): De novo / Mais fácil / Mais difícil: a mesma partida com semente nova, um passo de nível.
        const level = scene!.level;
        const next = signal === 'easier' ? stepLevel(level, -1) : signal === 'harder' ? stepLevel(level, 1) : level;
        const preset = playingPreset ?? currentPreset();
        leaveScene();
        // M2 (fase 4c): o nível novo vale para todos os bots de nível do preset, e ele vira o último.
        playPreset(withPresetLevel(preset, next));
      } else if (signal === 'rules') {
        // M2 (fase 4e): Mudar regras abre a Partida personalizada com o preset desta partida.
        const preset = playingPreset ?? currentPreset();
        leaveScene();
        openCustom(preset, 'title');
      } else if (signal === 'save') saveCustomPreset(playingPreset ?? currentPreset());
    }
    syncPointerLock();
    frames++;

    if (!menuReady && screen === 'title') {
      menuReady = true;
      log(`${MENU_READY_MARKER} ${Math.round(platform.now() - bootAt)} ms`);
      hooks.onMenuReady?.();
      // O bench abre a cena só depois de UM frame do título: assim o `loading_ms` mede o mesmo que JOGAR no menu.
      // Antes, a cena começava no boot e o loading pagava o primeiro desenho da UI (programa, atlas e, no Eden, a
      // compilação dos shaders do emulador): ~0,75 s a mais na mesma build.
      if (deps.bench) requestScene('bench', deps.bench);
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
      fonts = loaded.fonts.fonts;
      uiAtlas = loaded.uiAtlas;
      renderer.setUiAtlas(loaded.uiAtlas);
      screen = 'title';
    },
    (error: unknown) => fail(error),
  );
  frameHandle = platform.requestFrame(onFrame);

  return {
    get renderer(): Renderer {
      return renderer;
    },
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
    get scene(): Scene | null {
      return scene;
    },
    get debug(): GameDebugApi | null {
      return scene?.debug ?? null;
    },
    save,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      platform.cancelFrame(frameHandle);
      for (const unsubscribe of unsubscribes) unsubscribe();
      runner?.dispose();
      runner = null;
      scene?.dispose();
      scene = null;
      if (wantsLock) hooks.releasePointerLock?.();
      renderer.setUiAtlas(null);
      renderer.dispose();
    },
  };
}
