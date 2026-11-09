import {
  DEBUT_PRESET,
  GAME_CODENAME,
  GAME_VERSION,
  selectPlatformProfile,
  withPresetLevel,
  type BackupDocument,
  type BotLevel,
  type ControlDevice,
  type MatchRecipe,
} from '@boboforces/format';
import { stepLevel } from './pause.ts';
import {
  confirmConventionFor,
  createBindingCapture,
  createMenuInput,
  createRawInputState,
  type CaptureResult,
  type MenuConfirmConvention,
  type RemapAction,
} from '@boboforces/input';
import type { Platform } from '@boboforces/platform-api';
import type { Renderer, ViewDesc } from '@boboforces/render/data';
import { createRng, decodeUtf8, type Disposable, type Unsubscribe } from '@boboforces/shared';
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
  NEWS_ACTION,
  NEWS_ITEMS,
  newsScreen,
  MODES_PREFIX,
  modesScreen,
  QUICK_ACTION,
  QUICK_ROWS,
  QUICK_SHORTCUT_PREFIX,
  quickMatchScreen,
  MIN_TEXT,
  MIN_TOUCH_TARGET,
  resetDrawList,
  rotateScreen,
  settingsScreen,
  SETTINGS_ACTION,
  SETTINGS_ROW_PREFIX,
  SETTINGS_TAB_PREFIX,
  SURPRISE_ACTION,
  surpriseScreen,
  TITLE_ACTION,
  TITLE_ACTION_TEST_PREFIX,
  t,
  titleScreen,
  uiScale,
  type LayoutOptions,
  type StringKey,
  type TabbedRow,
  type TitleExtraItem,
  type UiAtlasImage,
  type UiFonts,
} from '@boboforces/ui';
import { loadGameAssets } from './assets.ts';
import type { BenchConfig, GameDebugApi, TestItem, TestRunner } from './bench/types.ts';
import type { LocalDriver } from './local-driver.ts';
import { createMenuController, followTab, type UiFrame } from './menu.ts';
import { createNullRenderer } from './null-renderer.ts';
import { CUSTOM_TAB_LABELS, CUSTOM_TABS, customRows, presetName, stepCustom } from './custom-match.ts';
import {
  actionLabel,
  bindRowAction,
  rebindSettings,
  SETTINGS_TAB_LABELS,
  SETTINGS_TABS,
  settingsRows,
  stepSettings,
} from './settings-menu.ts';
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
import { addMatch, markNewsSeen, markTipSeen, migratedCount, newsOnBoot, statsLines } from './stats.ts';
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
  | 'loading'
  | 'title'
  | 'main'
  | 'news'
  | 'quick'
  | 'modes'
  | 'custom'
  | 'surprise'
  | 'settings'
  | 'scene'
  | 'test'
  | 'error';

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
  mainMenu.setRoot(mainMenuScreen.build({ items: ['quickMatch', 'modes', 'settings', 'news'] }));

  // M2 (fase 4h): o aviso "Gire o celular" (celular em retrato).
  const rotateMenu = createMenuController();
  rotateMenu.setRoot(rotateScreen.build(null));

  // M2 (fase 4g): Novidades: uma vez depois de atualizar (no boot, antes do título) e sempre pelo menu principal.
  const newsMenu = createMenuController();
  let newsReturn: 'title' | 'main' = 'title';
  /** Documentos do save que vieram de um formato antigo neste boot (a Novidades avisa em 1 linha). */
  const migrated = migratedCount(save.loadWarnings);
  function openNews(back: 'title' | 'main'): void {
    newsReturn = back;
    newsMenu.setRoot(
      newsScreen.build({
        version: GAME_VERSION,
        codename: GAME_CODENAME,
        items: NEWS_ITEMS,
        migrated: migrated > 0 ? t('news.migrated', { n: migrated }) : '',
      }),
    );
    save.setStats(markNewsSeen(save.stats, GAME_VERSION));
    screen = 'news';
  }

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
  // M2 (fase 4f): Ajustes.
  let settingsTab = 0;
  let settingsDevice: ControlDevice = platform.id === 'switch' ? 'gamepad' : 'keyboardMouse';
  let settingsNote = '';
  /** O backup lido do arquivo, esperando "Juntar" ou "Substituir". */
  let pendingBackup: BackupDocument | null = null;
  function dataRows(): TabbedRow[] {
    // M2 (fase 4g): as estatísticas e os recordes do aparelho em cima.
    const stats: TabbedRow[] = statsLines(save.stats).map((text, i) => ({ kind: 'text', id: `stats${i}`, text }));
    if (platform.files === null) {
      return [...stats, { kind: 'text', id: 'none', text: t('settings.data.none'), dim: true }];
    }
    const rows: TabbedRow[] = [
      ...stats,
      { kind: 'text', id: 'warning', text: t('settings.data.warning'), dim: true },
      { kind: 'text', id: 'warning2', text: t('settings.data.warning2'), dim: true },
      { kind: 'action', id: 'export', label: { key: 'settings.data.export' } },
      { kind: 'action', id: 'import', label: { key: 'settings.data.import' } },
    ];
    if (pendingBackup !== null) {
      rows.push(
        {
          kind: 'text',
          id: 'found',
          text: t('settings.data.found', {
            presets: pendingBackup.presets.saved.length,
            bots: pendingBackup.bots.length,
          }),
        },
        { kind: 'action', id: 'merge', label: { key: 'settings.data.merge' } },
        { kind: 'action', id: 'replace', label: { key: 'settings.data.replace' }, variant: 'danger' },
        { kind: 'action', id: 'cancel', label: { key: 'settings.data.cancel' } },
      );
    }
    return rows;
  }
  function aboutRows(): TabbedRow[] {
    return [
      { kind: 'text', id: 'version', text: t('title.version', { version: GAME_VERSION, codename: GAME_CODENAME }) },
      { kind: 'text', id: 'credit', text: t('title.credit') },
      { kind: 'text', id: 'fonts', text: t('settings.about.fonts'), dim: true },
      { kind: 'text', id: 'fonts2', text: t('settings.about.fonts2'), dim: true },
      { kind: 'text', id: 'three', text: t('settings.about.three'), dim: true },
      { kind: 'action', id: 'copy', label: { key: 'settings.about.copy' } },
    ];
  }
  function rebuildSettings(): void {
    const tab = SETTINGS_TABS[settingsTab]!;
    settingsMenu.setRoot(
      settingsScreen.build({
        tabs: SETTINGS_TABS.map((id) => SETTINGS_TAB_LABELS[id]),
        tab: settingsTab,
        rows:
          tab === 'data'
            ? dataRows()
            : tab === 'about'
              ? aboutRows()
              : settingsRows(tab, save.settings, settingsDevice, capturing),
        note: settingsNote,
      }),
    );
  }
  /** M2 (fase 4f, parte 2): a captura do novo botão de uma ação (aba Botões). */
  const capture = createBindingCapture();
  let capturing: RemapAction | null = null;
  /** Fim da captura: liga a fonte nova (com o aviso de troca, se houver) ou cancela. */
  function finishCapture(result: CaptureResult): void {
    if (capturing === null || result === 'none') return;
    if (result === 'cancel') settingsNote = '';
    else {
      const next = rebindSettings(save.settings, settingsDevice, capturing, result);
      if (next.doc !== save.settings) save.setSettings(next.doc);
      settingsNote = next.note;
    }
    capturing = null;
    rebuildSettings();
  }
  function openSettings(): void {
    settingsTab = 0;
    capture.stop();
    capturing = null;
    settingsNote = '';
    pendingBackup = null;
    const last = menuInput.lastDevice;
    if (last !== null) settingsDevice = last;
    rebuildSettings();
    screen = 'settings';
  }
  /** Texto do relatório (#42): versão, plataforma, render e as últimas linhas do registro. */
  function reportText(): string {
    const stats = renderer.stats;
    return [
      `BoboForces ${GAME_VERSION} (${GAME_CODENAME})`,
      `plataforma: ${platform.id} · perfil: ${platform.features.profileHint}`,
      `render: ${renderer.info.textureMode} · programas ${stats.programs} · draw calls ${stats.drawCalls}`,
      'registro:',
      ...(platform.diagnostics.recentLog?.(40) ?? []),
    ].join('\n');
  }
  function settingsAction(id: string): void {
    const note = (text: string): void => {
      settingsNote = text;
      rebuildSettings();
    };
    if (id === 'export' && platform.files !== null) {
      const date = new Date().toISOString();
      const name = `boboforces-backup-${date.slice(0, 10)}.json`;
      void platform.files
        .save(name, save.exportBackup(date, GAME_VERSION), 'application/json')
        .then((ok) => note(ok ? t('settings.data.exported', { name }) : t('settings.data.exportFailed')));
    } else if (id === 'import' && platform.files !== null) {
      void platform.files.pick(['.json']).then((file) => {
        if (file === null) return;
        const read = save.readBackup(decodeUtf8(file.bytes));
        pendingBackup = read.ok ? read.value : null;
        note(read.ok ? '' : t('settings.data.invalid'));
      });
    } else if ((id === 'merge' || id === 'replace') && pendingBackup !== null) {
      save.applyBackup(pendingBackup, id);
      pendingBackup = null;
      refreshTitle();
      note(t('settings.data.imported'));
    } else if (id === 'cancel') {
      pendingBackup = null;
      note('');
    } else if (id === 'copy') {
      const text = reportText();
      const clip = platform.clipboard;
      if (clip === undefined) {
        log(text);
        note(t('settings.about.copyFailed'));
      } else {
        void clip.writeText(text).then((ok) => {
          if (!ok) log(text);
          note(t(ok ? 'settings.about.copied' : 'settings.about.copyFailed'));
        });
      }
    }
  }
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
    // M2 (fase 4f): o tamanho da interface vem dos Ajustes.
    const userScale = save.settings.video.uiScale;
    if (
      ui.width === w &&
      ui.height === h &&
      ui.userScale === userScale &&
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
      scale: uiScale(w, h, userScale),
      userScale,
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
        settings: {
          get current() {
            return save.settings;
          },
          save: (doc) => save.setSettings(doc),
        },
        stats: {
          get current() {
            return save.stats;
          },
          tipSeen: (id) => save.setStats(markTipSeen(save.stats, id)),
          record: (m) => {
            const r = addMatch(save.stats, m);
            save.setStats(r.doc);
            return r.records;
          },
        },
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

    // M2 (fase 4h): celular em retrato (gameplay.md §2.5): "Gire o celular" por cima de tudo; a partida pausa e
    // nenhuma tela anda até o aparelho deitar.
    if (
      platform.features.profileHint === 'mobile' &&
      u.height > u.width &&
      screen !== 'loading' &&
      screen !== 'error'
    ) {
      scene?.pause();
      rotateMenu.draw(list, u);
      renderer.renderViews(NO_VIEWS);
      renderer.drawUi(list);
      syncPointerLock();
      frames++;
      checkMenuReady();
      return;
    }

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
        else if (nav.activated === MAIN_MENU_ACTION.settings) openSettings();
        else if (nav.activated === MAIN_MENU_ACTION.quickMatch) openQuick(null);
        else if (nav.activated === MAIN_MENU_ACTION.modes) screen = 'modes';
        else if (nav.activated === MAIN_MENU_ACTION.news) openNews('main');
        if (screen === 'main') {
          mainMenu.draw(list, u);
          renderer.renderViews(NO_VIEWS);
          renderer.drawUi(list);
        }
        break;
      }
      case 'news': {
        const nav = newsMenu.update(menuInput, raw, u);
        if (nav.back || nav.activated === NEWS_ACTION.ok) screen = newsReturn;
        else {
          newsMenu.draw(list, u);
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
          followTab(customMenu, customTab);
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
        // Capturando um botão (e esperando soltar tudo depois): o menu não anda.
        if (capture.active) {
          finishCapture(capture.update(raw));
          settingsMenu.draw(list, u);
          renderer.renderViews(NO_VIEWS);
          renderer.drawUi(list);
          break;
        }
        const nav = settingsMenu.update(menuInput, raw, u);
        const a = nav.activated;
        if (nav.tab !== 0) {
          settingsTab = (settingsTab + nav.tab + SETTINGS_TABS.length) % SETTINGS_TABS.length;
          followTab(settingsMenu, settingsTab);
          settingsNote = '';
          rebuildSettings();
        } else if (nav.back || a === SETTINGS_ACTION.back) screen = 'main';
        else if (a !== null && a.startsWith(SETTINGS_TAB_PREFIX)) {
          settingsTab = Number(a.slice(SETTINGS_TAB_PREFIX.length));
          settingsNote = '';
          rebuildSettings();
        } else if (a !== null && a.startsWith(SETTINGS_ROW_PREFIX)) {
          const id = a.slice(SETTINGS_ROW_PREFIX.length);
          const tab = SETTINGS_TABS[settingsTab]!;
          const bind = tab === 'buttons' ? bindRowAction(id, settingsDevice) : null;
          if (tab === 'data' || tab === 'about') settingsAction(id);
          else if (bind !== null) {
            capturing = bind;
            capture.start(raw, settingsDevice === 'gamepad' ? 'gamepad' : 'keyboardMouse');
            settingsNote = t('settings.bind.press', { action: t(actionLabel(bind)) });
            rebuildSettings();
          } else {
            const next = stepSettings(tab, save.settings, settingsDevice, id, nav.delta);
            settingsDevice = next.device;
            if (next.doc !== save.settings) save.setSettings(next.doc);
            settingsNote = tab === 'buttons' && id === 'reset' ? t('settings.bind.resetDone') : '';
            rebuildSettings();
          }
        }
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
    checkMenuReady();
  }

  /** O primeiro frame do título (ou do aviso de retrato por cima dele): o splash da casca pode sair. */
  function checkMenuReady(): void {
    if (menuReady || screen !== 'title') return;
    menuReady = true;
    log(`${MENU_READY_MARKER} ${Math.round(platform.now() - bootAt)} ms`);
    hooks.onMenuReady?.();
    // O bench abre a cena só depois de UM frame do título: assim o `loading_ms` mede o mesmo que JOGAR no menu.
    // Antes, a cena começava no boot e o loading pagava o primeiro desenho da UI (programa, atlas e, no Eden, a
    // compilação dos shaders do emulador): ~0,75 s a mais na mesma build.
    if (deps.bench) requestScene('bench', deps.bench);
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
      // M2 (fase 4g): versão nova para quem já jogava: Novidades antes do título; instalação nova só marca como vista.
      const news = newsOnBoot(save.stats, GAME_VERSION);
      if (news === 'show') openNews('title');
      else if (news === 'silent') save.setStats(markNewsSeen(save.stats, GAME_VERSION));
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
