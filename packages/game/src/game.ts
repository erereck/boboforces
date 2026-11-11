import {
  BOT_RANGES,
  BUILTIN_BOTS,
  COUCH_PLAYER_KEYS,
  DEBUT_PRESET,
  effectiveQuality,
  GAME_CODENAME,
  GAME_VERSION,
  MATCH_RECIPE_FORMAT,
  guessQuality,
  qualityKnobs,
  selectPlatformProfile,
  withPresetLevel,
  type BackupDocument,
  type BotDocument,
  type BotLevel,
  type CouchPlayerSettings,
  type ControlDevice,
  type MatchRecipe,
  type QualityLevel,
  type SettingsDocument,
  parseLoopManifest,
} from '@boboforces/format';
import { stepLevel } from './pause.ts';
import {
  confirmConventionFor,
  createBindingCapture,
  createLocalPlayers,
  createMenuInput,
  createRawInputState,
  PAD_BUTTON,
  type CaptureResult,
  type DeviceBinding,
  type MenuConfirmConvention,
  type RawInputState,
  type RemapAction,
} from '@boboforces/input';
import type { Platform, TextInputSession } from '@boboforces/platform-api';
import type { Renderer, ViewDesc } from '@boboforces/render/data';
import { createRng, decodeUtf8, type Disposable, type Unsubscribe } from '@boboforces/shared';
import {
  createDrawList,
  formatDecimal,
  createLoadingModel,
  createTestScreenModel,
  drawLoadingScreen,
  drawTestScreen,
  CUSTOM_ACTION,
  CUSTOM_ROW_PREFIX,
  CUSTOM_TAB_PREFIX,
  MAIN_MENU_ACTION,
  mainMenuScreen,
  COUCH_ACTION,
  couchScreen,
  type CouchSeatView,
  LAB_ACTION,
  LAB_INTRO_ACTION,
  labIntroScreen,
  MODES_ACTION,
  WORKSHOP_ACTION,
  WORKSHOP_BOT_PREFIX,
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
  type MenuNavigation,
  type StringKey,
  type TabbedRow,
  type TitleExtraItem,
  type UiAtlasImage,
  type UiFonts,
} from '@boboforces/ui';
import { loadGameAssets } from './assets.ts';
import type { BenchConfig, GameDebugApi, TestItem, TestRunner } from './bench/types.ts';
import type { LocalDriver } from './local-driver.ts';
import type { LocalSeat } from './scene/seats.ts';
import { createMenuController, followTab, setMenuSoundSink, type UiFrame } from './menu.ts';
import { createNullRenderer } from './null-renderer.ts';
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
import { botCardLines, botDisplayName, copyName, isBuiltinBot, newBotId } from './bot-card.ts';
import type * as EditorsModule from './editors.ts';
import { trainingPreset } from './training.ts';
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
import { skipCappedFrame } from './frame-cap.ts';
import {
  applyAudioSettings,
  loadSoundFiles,
  MENU_MUSIC,
  MENU_MUSIC_ID,
  MENU_SOUNDS,
  playUiSound,
  wantsMusic,
} from './sound-bank.ts';
import { createMixer, type MixerStats } from '@boboforces/audio';
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
/** Teste do sofá: jogadores locais no máximo (decisão #1: até 4 em tela dividida). */

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
  /**
   * M3: as telas de edição (`@boboforces/game/editors`): web por `import()` (fora do menu), Switch e testes direto. O
   * jogo pede logo depois do menu pronto. Ausente = Laboratório, Oficina e Partida personalizada não abrem.
   */
  readonly loadEditors?: () => Promise<Editors>;
}

/** M3: o módulo das telas de edição (`editors.ts`). */
export type Editors = typeof EditorsModule;

/** Alguma tecla, botão do mouse ou do controle ainda apertado. */
function anyInputHeld(raw: Readonly<RawInputState>): boolean {
  if (raw.mouseButtons !== 0) return true;
  for (let k = 0; k < raw.keys.length; k++) if (raw.keys[k] === 1) return true;
  for (const pad of raw.gamepads) {
    if (!pad.connected) continue;
    for (let b = 0; b < pad.buttons.length; b++) if (pad.buttons[b]! >= 0.5) return true;
  }
  return false;
}

export type GameScreen =
  | 'loading'
  | 'title'
  | 'main'
  | 'news'
  | 'workshop'
  | 'lab'
  | 'labIntro'
  | 'quick'
  | 'modes'
  | 'custom'
  | 'surprise'
  | 'couch'
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
  /** M2 (fase 7b): os contadores do mixer e o estado do contexto (`'none'` sem áudio), para o F2 e os scripts. */
  readonly audio: {
    readonly stats: MixerStats;
    readonly state: string;
    readonly sounds: number;
    /** M2 (fase 7d): a música tocando agora, ou `null`. */
    readonly music: string | null;
  };
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
  // M2 (fase 7b): um mixer só para o jogo inteiro (a interface e a partida tocam nele). Sem áudio na plataforma, ele
  // existe mudo. Os MP3 do banco carregam depois do primeiro frame do título (`startSoundFiles`).
  const mixer = createMixer(platform.audio);
  let soundFiles: Promise<void> | null = null;
  let soundCount = 0;
  // M2 (fase 7c): os volumes dos Ajustes valem na hora (o `step` compara a referência do documento salvo) e os
  // menus tocam pelo mixer.
  let audioApplied: SettingsDocument | null = null;
  /**
   * M2 (fase 8b): a qualidade aplicada na resolução da casca (arte-ux.md §1.12). Muda na hora com os Ajustes; os
   * detritos valem na próxima partida. O bench mede com a resolução que pediu (fica fora).
   */
  let qualityApplied: QualityLevel | null = null;
  function applyQuality(): void {
    if (deps.bench) return;
    const family = platform.features.profileHint;
    const level = effectiveQuality(save.settings.video, family);
    if (level === qualityApplied) return;
    qualityApplied = level;
    const knobs = qualityKnobs(selectPlatformProfile(family, 1), level);
    if (!platform.graphics.setResolution) return;
    platform.graphics.setResolution(knobs.maxPixelRatio, knobs.renderScale);
    log(`[game] qualidade ${level}: dpr até ${knobs.maxPixelRatio}, escala ${knobs.renderScale}`);
  }
  /**
   * M2 (fase 8b): a escolha automática da primeira abertura (tecnico.md §17.2): lê o aparelho uma vez e guarda o nível.
   * Depois que o jogador escolhe a qualidade, não roda mais.
   */
  function pickAutoQuality(): void {
    const video = save.settings.video;
    if (deps.bench || video.quality !== 'auto' || video.autoQuality !== 'none') return;
    platform.diagnostics.collectReport().then(
      (report) => {
        if (disposed || save.settings.video.autoQuality !== 'none') return;
        const level = guessQuality({
          family: platform.features.profileHint,
          gpu: report.gpu,
          cores: Number(report.extra['cores']) || 0,
          memoryGb: Number(report.extra['deviceMemoryGb']) || 0,
        });
        save.setSettings({ ...save.settings, video: { ...save.settings.video, autoQuality: level } });
        log(`[game] qualidade automática: ${level} (gpu "${report.gpu}")`);
      },
      (error: unknown) => log(`[game] qualidade automática: sem leitura do aparelho (${String(error)})`),
    );
  }
  setMenuSoundSink((sound) => playUiSound(mixer, MENU_SOUNDS[sound]));
  function startSoundFiles(): Promise<void> {
    soundFiles ??= loadSoundFiles(mixer, platform.assets, (id, error) =>
      platform.diagnostics.appendLog(`[audio] ${id}: ${error instanceof Error ? error.message : String(error)}`),
    ).then(
      (n) => {
        soundCount += n;
        if (n > 0) platform.diagnostics.appendLog(`[audio] ${n} sons do banco prontos`);
        loadMenuMusic();
      },
      () => {},
    );
    return soundFiles;
  }
  /**
   * M2 (fase 7d): a faixa do menu, sob demanda, depois dos efeitos: o manifesto `loop@1` diz onde o loop começa no
   * áudio decodificado (o atraso do MP3) e quanto dura; o mixer recorta e a música fecha o loop no compasso.
   */
  function loadMenuMusic(): void {
    const base = MENU_MUSIC;
    if (base === null || !mixer.available || mixer.has(MENU_MUSIC_ID)) return;
    platform.assets
      .loadText(`${base}.json`)
      .then(async (text) => {
        const loop = parseLoopManifest(JSON.parse(text));
        await mixer.decode(MENU_MUSIC_ID, await platform.assets.loadBytes(`${base}.mp3`));
        if (!mixer.crop(MENU_MUSIC_ID, loop.loopStartS, loop.loopS)) throw new Error('o loop não cabe no MP3');
        return loop;
      })
      .then(
        (loop) => platform.diagnostics.appendLog(`[audio] música do menu pronta (loop de ${loop.loopS.toFixed(1)} s)`),
        (error: unknown) =>
          platform.diagnostics.appendLog(`[audio] música: ${error instanceof Error ? error.message : String(error)}`),
      );
  }
  /** 1x por frame: a música do menu segue a tela (menus e resultado) e o Ajuste "Música na partida". */
  function updateMusic(): void {
    if (screen === 'scene' && scene?.ownsMusic === true) return;
    if (!mixer.has(MENU_MUSIC_ID)) return;
    const want = wantsMusic(screen === 'scene', scene?.wantsMusic ?? false, save.settings.audio.musicInMatch);
    if (want && mixer.music !== MENU_MUSIC_ID) mixer.playMusic(MENU_MUSIC_ID);
    else if (!want && mixer.music !== null) mixer.stopMusic();
  }
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
  // M2 (fase 6c): o Meu Bobo entre o Laboratório e os Ajustes (GDD §2.2).
  mainMenu.setRoot(
    mainMenuScreen.build({ items: ['quickMatch', 'modes', 'couch', 'lab', 'bobo', 'settings', 'news'] }),
  );

  // M2 (fase 5a): a Oficina (a entrada do Laboratório): a biblioteca dos bots e o card do escolhido.
  const workshopMenu = createMenuController();
  const botRng = createRng((Math.floor(platform.now()) ^ 0x5bd1e995) >>> 0);
  const factoryBots = Object.values(BUILTIN_BOTS);
  let workshopSelected = factoryBots[0]!.id;
  let workshopNote = '';
  /** O bot que está esperando o "Confirmar" do Apagar. */
  let workshopConfirm: string | null = null;
  function findBot(id: string): BotDocument | null {
    return save.bots.find((b) => b.id === id) ?? factoryBots.find((b) => b.id === id) ?? null;
  }
  function rebuildWorkshop(): void {
    const item = (b: BotDocument) => ({ id: b.id, label: botDisplayName(b) });
    const favorites = save.presets.botFavorites.map(findBot).filter((b): b is BotDocument => b !== null);
    const bot = findBot(workshopSelected) ?? factoryBots[0]!;
    workshopSelected = bot.id;
    workshopMenu.setRoot(
      editors!.workshopScreen.build({
        groups: [
          { id: 'fav', titleKey: 'workshop.favorites', items: favorites.map(item), empty: '' },
          { id: 'mine', titleKey: 'workshop.mine', items: save.bots.map(item), empty: t('workshop.empty') },
          { id: 'factory', titleKey: 'workshop.factory', items: factoryBots.map(item), empty: '' },
        ],
        selected: bot.id,
        name: botDisplayName(bot),
        lines: botCardLines(bot),
        note: workshopNote,
        canEdit: true,
        canDelete: !isBuiltinBot(bot),
        favorite: save.presets.botFavorites.includes(bot.id),
        confirmDelete: workshopConfirm === bot.id,
      }),
    );
  }
  // M2 (fase 5b): o Laboratório, o editor de um bot por vez.
  const labMenu = createMenuController();
  let labDoc: BotDocument = factoryBots[0]!;
  let labTab = 0;
  let labNote = '';
  /** Mudou algo desde que abriu (Voltar pede confirmação); `labDiscard` = já pediu. */
  let labDirty = false;
  let labDiscard = false;
  /** Digitando o nome (o menu não anda) e, depois, esperando soltar tudo (o Enter não reabre a digitação). */
  let labTyping: TextInputSession | null = null;
  let labTypingFrom = '';
  let labHold = false;
  /** Testando o bot no Bobo Training (a volta da cena cai no Laboratório). */
  let labTesting = false;
  /** M2 (fase 6c): a cena aberta é o Meu Bobo (o Voltar dela leva ao menu principal). */
  let wardrobeOpen = false;
  const allBotNames = (): Set<string> => new Set([...save.bots, ...factoryBots].map(botDisplayName));
  function rebuildLab(): void {
    labMenu.setRoot(
      editors!.labScreen.build({
        tabs: editors!.LAB_TABS.map((id) => editors!.LAB_TAB_LABELS[id]),
        tab: labTab,
        rows: editors!.labRows(editors!.LAB_TABS[labTab]!, labDoc, platform.textInput.available),
        summary: editors!.labSummary(labDoc),
        note: labNote,
      }),
    );
  }
  /** De fábrica: edita uma cópia nova (o original fica); dos seus: o próprio (salvar substitui). */
  function openLab(bot: BotDocument): void {
    if (isBuiltinBot(bot)) {
      const ids = new Set([...save.bots.map((b) => b.id), ...factoryBots.map((b) => b.id)]);
      labDoc = { ...bot, id: newBotId(botRng, ids), name: copyName(botDisplayName(bot), allBotNames()) };
    } else labDoc = bot;
    labTab = 0;
    labNote = '';
    labDirty = false;
    labDiscard = false;
    labMenu.focus(null);
    rebuildLab();
    screen = 'lab';
  }
  function closeLab(): void {
    endTyping();
    screen = 'workshop';
    rebuildWorkshop();
  }
  function endTyping(): void {
    labTyping?.close();
    labTyping = null;
    labHold = true;
  }
  function startTyping(): void {
    if (!platform.textInput.available || labTyping !== null) return;
    labTypingFrom = labDoc.name;
    const done = (name: string): void => {
      labDoc = { ...labDoc, name: name.trim() || labTypingFrom };
      labNote = '';
      endTyping();
      rebuildLab();
    };
    labTyping = platform.textInput.open(
      { initial: labDoc.name, maxLength: BOT_RANGES.nameMaxLength, kind: 'name' },
      {
        onChange: (value) => {
          labDoc = { ...labDoc, name: editors!.cleanBotName(value) };
          labDirty = true;
          rebuildLab();
        },
        onSubmit: (value) => done(editors!.cleanBotName(value)),
        onCancel: () => done(labTypingFrom),
      },
    );
    if (labTyping !== null) labNote = t('lab.typing');
  }
  function labAction(nav: MenuNavigation): void {
    const a = nav.activated;
    if (nav.tab !== 0) {
      labTab = (labTab + nav.tab + editors!.LAB_TABS.length) % editors!.LAB_TABS.length;
      followTab(labMenu, labTab);
      labNote = '';
    } else if (nav.back || a === LAB_ACTION.back) {
      if (labDirty && !labDiscard) {
        labDiscard = true;
        labNote = t('lab.discardAsk');
      } else {
        closeLab();
        return;
      }
    } else if (a === LAB_ACTION.test) {
      // O bot vai embutido no treino (sem salvar), junto dos alvos; na volta, o editor continua de onde estava.
      labTesting = true;
      playTraining(trainingPreset([{ ref: `embedded:${labDoc.id}`, count: 1 }], [labDoc]));
      return;
    } else if (a === LAB_ACTION.save) {
      if (save.saveBot(labDoc)) {
        workshopSelected = labDoc.id;
        workshopNote = t('lab.saved', { name: labDoc.name });
        workshopConfirm = null;
        workshopMenu.focus(`${WORKSHOP_BOT_PREFIX}mine:${labDoc.id}`);
        closeLab();
        return;
      }
      labNote = t('workshop.full', { n: save.bots.length });
    } else if (a !== null && a.startsWith(SETTINGS_TAB_PREFIX)) {
      labTab = Number(a.slice(SETTINGS_TAB_PREFIX.length));
      labNote = '';
    } else if (a !== null && a.startsWith(SETTINGS_ROW_PREFIX)) {
      const id = a.slice(SETTINGS_ROW_PREFIX.length);
      const tab = editors!.LAB_TABS[labTab]!;
      labNote = '';
      labDiscard = false;
      if (tab === 'name' && id === 'roll') {
        labDoc = { ...labDoc, name: editors!.rollBotName(botRng, allBotNames()) };
        labDirty = true;
      } else if (tab === 'name' && id === 'name') startTyping();
      else {
        const next = editors!.stepLab(tab, labDoc, id, nav.delta);
        if (next !== labDoc) {
          labDoc = next;
          labDirty = true;
        }
      }
    }
    rebuildLab();
  }

  function openWorkshop(): void {
    withEditors(() => {
      workshopNote = '';
      workshopConfirm = null;
      rebuildWorkshop();
      screen = 'workshop';
    });
  }
  function workshopAction(a: string): void {
    const bot = findBot(workshopSelected);
    if (a.startsWith(WORKSHOP_BOT_PREFIX)) {
      // `bot:<grupo>:<id>`
      workshopSelected = a.slice(a.indexOf(':', WORKSHOP_BOT_PREFIX.length) + 1);
      workshopNote = '';
      workshopConfirm = null;
    } else if (bot === null) return;
    else if (a === WORKSHOP_ACTION.duplicate) {
      const ids = new Set([...save.bots.map((b) => b.id), ...factoryBots.map((b) => b.id)]);
      const names = new Set([...save.bots, ...factoryBots].map(botDisplayName));
      const copy: BotDocument = { ...bot, id: newBotId(botRng, ids), name: copyName(botDisplayName(bot), names) };
      if (save.saveBot(copy)) {
        workshopSelected = copy.id;
        workshopNote = t('workshop.duplicated', { name: copy.name });
        workshopMenu.focus(`${WORKSHOP_BOT_PREFIX}mine:${copy.id}`);
      } else workshopNote = t('workshop.full', { n: save.bots.length });
      workshopConfirm = null;
    } else if (a === WORKSHOP_ACTION.edit) {
      openLab(bot);
      return;
    } else if (a === WORKSHOP_ACTION.favorite) {
      const on = !save.presets.botFavorites.includes(bot.id);
      workshopNote = save.setBotFavorite(bot.id, on) ? '' : t('workshop.favoritesFull');
    } else if (a === WORKSHOP_ACTION.delete && !isBuiltinBot(bot)) {
      if (workshopConfirm === bot.id) {
        save.deleteBot(bot.id);
        workshopNote = t('workshop.deleted', { name: bot.name });
        workshopConfirm = null;
        workshopSelected = save.bots[0]?.id ?? factoryBots[0]!.id;
      } else {
        workshopConfirm = bot.id;
        workshopNote = t('workshop.deleteAsk', { name: bot.name });
      }
    }
    rebuildWorkshop();
  }

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
      modes: [
        ...QUICK_MODES.map((id) => ({
          id,
          nameKey: id === 'warfare.tdm' ? ('mode.name.warfare.tdm' as const) : ('mode.name.warfare.ffa' as const),
          descKey: id === 'warfare.tdm' ? ('mode.desc.warfare.tdm' as const) : ('mode.desc.warfare.ffa' as const),
        })),
        // M2 (fase 5d): o Bobo Training começa direto (no Ringue, com os alvos).
        { id: 'training', nameKey: 'mode.name.training' as const, descKey: 'mode.desc.training' as const },
        // M3 (fase 2d): o Bobo Zombies começa direto (fase 5a: na Base Abandonada).
        { id: 'zombies', nameKey: 'mode.name.zombies' as const, descKey: 'mode.desc.zombies' as const },
      ],
    }),
  );
  /**
   * M3 (fase 2d): o Bobo Zombies dos Modos: a Curta (10 ondas), só os humanos contra as ondas. Fase 5a: na Base
   * Abandonada, à noite (o Posto Avançado e o Construto continuam nos recentes).
   */
  const ZOMBIES_PRESET: MatchRecipe = {
    format: MATCH_RECIPE_FORMAT,
    mode: 'zombies',
    map: 'base',
    seed: 0,
    match: { timeLimitS: 0, scoreLimit: 0 },
    teams: [{ humans: 'all', bots: [] }],
  };
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
  // M2 (fase 5b): os bots da Oficina entram na escolha do bot de cada time (lidos na hora: a Oficina muda).
  const customLimits = {
    maxBots,
    maxViewM: selectPlatformProfile(platform.features.profileHint, 1).maxViewDistanceM,
    get savedBots(): readonly BotDocument[] {
      return save.bots;
    },
  };
  function rebuildCustom(): void {
    const ed = editors!;
    // M3 (fase 6b): o Bobo Zombies tem outras abas; trocar o modo pode deixar a aba atual fora da lista.
    const tabs = ed.customTabs(customRecipe);
    customTab = Math.min(customTab, tabs.length - 1);
    const tab = tabs[customTab]!;
    customMenu.setRoot(
      ed.customMatchScreen.build({
        tabs: tabs.map((id) => ed.CUSTOM_TAB_LABELS[id]),
        tab: customTab,
        rows: ed.customRows(tab, customRecipe).map((r) => ({
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
    withEditors(() => {
      customRecipe = recipe;
      customTab = 0;
      customNote = '';
      customReturn = back;
      rebuildCustom();
      customMenu.focus('start');
      screen = 'custom';
    });
  }

  // --- M3: as telas de edição chegam à parte (`GameDeps.loadEditors`) ---
  let editors: Editors | null = null;
  let editorsPromise: Promise<void> | null = null;
  /** O que ficou esperando o módulo (abrir a tela pedida); roda no primeiro frame depois que ele chega. */
  let editorsAfter: (() => void) | null = null;
  function loadEditors(): void {
    if (editorsPromise !== null || !deps.loadEditors) return;
    editorsPromise = deps.loadEditors().then(
      (m) => {
        editors = m;
      },
      (error: unknown) => fail(error),
    );
  }
  /** Roda agora, se as telas de edição já chegaram; senão pede e roda quando chegarem. */
  function withEditors(then: () => void): void {
    if (editors !== null) {
      then();
      return;
    }
    if (!deps.loadEditors) {
      log('[game] telas de edição indisponíveis nesta casca (sem loadEditors)');
      return;
    }
    editorsAfter = then;
    loadEditors();
  }
  /** Salva o preset com nome do gerador ("Times 4×4 De boa"; repetido, " 2"); devolve o aviso para a tela. */
  function saveCustomPreset(recipe: MatchRecipe): string {
    const short = presetShortcut({ ...recipe, name: '' }).label;
    const base = `${t(`mode.short.${recipe.mode}` as StringKey)} ${short}`;
    const name = editors!.presetName(base, (n) => save.presets.saved.some((p) => p.name === n));
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
              : tab === 'controls'
                ? [
                    ...settingsRows(tab, save.settings, settingsDevice, capturing, platform.features.keyboardMouse),
                    // M2 (fase 5f): abre o Bobo Training já calibrando a mira.
                    { kind: 'action', id: 'calibrate', label: { key: 'settings.row.calibrate' } },
                  ]
                : settingsRows(tab, save.settings, settingsDevice, capturing, platform.features.keyboardMouse),
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
      const next = rebindSettings(save.settings, settingsDevice, capturing, result, platform.features.keyboardMouse);
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

  // --- M3 (fase 1b): a tela do sofá ---
  /** Os assentos (P1 a P4) da tela do sofá; o P1 é quem abriu a tela. */
  const locals = createLocalPlayers();
  /** O lado de cada assento: 0 = com o P1, 1 = contra (o do P1 é sempre 0). */
  const couchSides = new Uint8Array(4);
  let couchActive = false;
  let couchPresets: MatchRecipe[] = [];
  let couchPreset = 0;
  /** Assinatura do que a tela mostra (refaz a árvore só quando muda). */
  let couchSig = -1;
  let couchStartPrev = false;
  const couchMenu = createMenuController();
  const KEYBOARD_DEVICE: DeviceBinding = { kind: 'keyboardMouse' };
  const TOUCH_DEVICE: DeviceBinding = { kind: 'touch' };

  function couchDeviceLabel(d: DeviceBinding): string {
    if (d.kind === 'gamepad') return t('couch.device.pad', { n: d.index + 1 });
    if (d.kind === 'touch') return t('couch.device.touch');
    return t(platform.features.keyboardMouse ? 'couch.device.keyboard' : 'couch.device.keyboardOnly');
  }

  /** O preset escolhido tem dois lados (TDM): os jogadores 2 a 4 escolhem com ou contra o P1. */
  function couchTeams(): boolean {
    const r = couchPresets[couchPreset];
    return r !== undefined && r.mode !== 'warfare.ffa' && r.mode !== 'training' && r.teams.length >= 2;
  }

  function couchSeats(): LocalSeat[] {
    const teams = couchTeams();
    const out: LocalSeat[] = [];
    for (const s of locals.slots) {
      if (s.device === null) continue;
      out.push({ device: s.device, side: s.index > 0 && teams && couchSides[s.index] === 1 ? 1 : 0 });
    }
    return out;
  }

  /** M3 (fase 1e): muda e guarda o ajuste do jogador `k` (1 = P2) e refaz a tela. */
  function tuneCouchPlayer(k: number, f: (p: CouchPlayerSettings) => CouchPlayerSettings): void {
    const key = COUCH_PLAYER_KEYS[k - 1];
    if (key === undefined) return;
    const couch = save.settings.couch;
    save.setSettings({ ...save.settings, couch: { ...couch, [key]: f(couch[key]) } });
    couchSig = -1;
  }

  /** O ajuste do jogador `k` (1 = P2) para o cartão: "Mira 1,2× · Y invertido". */
  function couchTune(k: number): string | null {
    const key = COUCH_PLAYER_KEYS[k - 1];
    if (key === undefined) return null;
    const p = save.settings.couch[key];
    return t('couch.tune', {
      sens: formatDecimal(p.sensitivity, 1),
      y: t(p.invertY ? 'couch.tune.inverted' : 'couch.tune.normal'),
    });
  }

  function rebuildCouch(): void {
    let sig = couchPreset << 16;
    for (const s of locals.slots) {
      if (s.device !== null) sig |= (1 + (s.connected ? 2 : 0) + couchSides[s.index]! * 4) << (s.index * 4);
    }
    if (locals.slotOf(KEYBOARD_DEVICE) >= 0) sig |= 1 << 24;
    if (sig === couchSig) return;
    couchSig = sig;
    const teams = couchTeams();
    const seats: CouchSeatView[] = locals.slots.map((s) => ({
      device: s.device ? couchDeviceLabel(s.device) : null,
      side: s.index > 0 && teams && s.device !== null ? (couchSides[s.index] === 1 ? 1 : 0) : null,
      disconnected: s.device !== null && !s.connected,
      tune: s.index > 0 && s.device !== null ? couchTune(s.index) : null,
    }));
    const preset = couchPresets[couchPreset];
    couchMenu.setRoot(
      couchScreen.build({
        seats,
        match: preset ? presetSummary(preset) : '',
        keyboardFree: locals.slotOf(KEYBOARD_DEVICE) < 0,
      }),
    );
  }

  /** Abre a tela: quem abriu é o P1 e passa a ser o único que navega nos menus (gameplay.md §10.6). */
  function openCouch(raw: Readonly<RawInputState>): void {
    const last = menuInput.lastDevice;
    const pad = Math.max(0, menuInput.lastGamepad);
    const p1: DeviceBinding =
      last === 'gamepad' ? { kind: 'gamepad', index: pad } : last === 'touch' ? TOUCH_DEVICE : KEYBOARD_DEVICE;
    locals.clear();
    couchSides.fill(0);
    locals.join(p1, p1.kind === 'gamepad' ? (raw.gamepads[pad]?.id ?? '') : '');
    menuInput.setOwner(p1);
    // A partida: o último preset (o do JOGAR) e os de fábrica.
    const current = currentPreset();
    couchPresets = [current, ...factoryPresets().filter((p) => p.name !== current.name)];
    couchPreset = 0;
    couchActive = true;
    couchSig = -1;
    couchStartPrev = true;
    rebuildCouch();
    couchMenu.focus('start');
    screen = 'couch';
    log(`[game] sofá aberto (P1: ${couchDeviceLabel(p1)})`);
  }

  function closeCouch(): void {
    locals.clear();
    menuInput.setOwner(null);
    couchActive = false;
  }

  /** Um frame da tela: entradas e saídas de cada dispositivo, o lado de cada um e os botões do P1. */
  function couchFrame(raw: Readonly<RawInputState>, u: UiFrame): void {
    const joined = locals.update(raw, true);
    if (joined >= 0) log(`[game] sofá: P${joined + 1} entrou (${couchDeviceLabel(locals.slots[joined]!.device!)})`);
    for (let k = 1; k < locals.slots.length; k++) {
      const d = locals.slots[k]!.device;
      if (d === null || k === joined) continue;
      if (menuInput.pressedBy(d, 'back')) {
        locals.leave(k);
        couchSides[k] = 0;
        log(`[game] sofá: P${k + 1} saiu`);
      } else if (couchTeams() && (menuInput.pressedBy(d, 'left') || menuInput.pressedBy(d, 'right'))) {
        couchSides[k] = couchSides[k] === 1 ? 0 : 1;
      } else if (menuInput.pressedBy(d, 'tabPrev') || menuInput.pressedBy(d, 'tabNext')) {
        // M3 (fase 1e): os ombros mudam a mira deste jogador em 0,1×; o botão de cima inverte o Y. Fica guardado.
        const dir = menuInput.pressedBy(d, 'tabNext') ? 1 : -1;
        tuneCouchPlayer(k, (p) => ({
          ...p,
          sensitivity: Math.round(Math.min(3, Math.max(0.3, p.sensitivity + dir * 0.1)) * 10) / 10,
        }));
      } else if (menuInput.pressedBy(d, 'secondary')) {
        tuneCouchPlayer(k, (p) => ({ ...p, invertY: !p.invertY }));
      }
    }
    rebuildCouch();
    const nav = couchMenu.update(menuInput, raw, u);
    // O Start (o +) do P1 também começa.
    const p1 = locals.slots[0]!.device;
    const startDown = p1?.kind === 'gamepad' && (raw.gamepads[p1.index]?.buttons[PAD_BUTTON.start] ?? 0) >= 0.5;
    const start = startDown && !couchStartPrev;
    couchStartPrev = startDown;
    if (nav.back || nav.activated === COUCH_ACTION.back) {
      closeCouch();
      screen = 'main';
    } else if (nav.activated === COUCH_ACTION.match && couchPresets.length > 0) {
      const n = couchPresets.length;
      couchPreset = (couchPreset + (nav.delta === 0 ? 1 : nav.delta) + n) % n;
      rebuildCouch();
    } else if ((nav.activated === COUCH_ACTION.start || start) && couchPresets[couchPreset]) {
      playPreset(couchPresets[couchPreset]!);
    }
  }

  function requestScene(
    kind: SceneKind,
    bench: BenchConfig | null,
    recipe: MatchRecipe | null = null,
    calibrate = false,
  ): void {
    if (!deps.loadScene) {
      log('[game] cena indisponível nesta casca (sem loadScene)');
      return;
    }
    matches++;
    // M3 (fase 1b): os assentos da tela do sofá. O Bobo Training (e a calibração) é de 1 jogador: o treino lê só o
    // humano 0.
    const seats = kind === 'play' && couchActive && !calibrate && recipe?.mode !== 'training' ? couchSeats() : [];
    if (seats.length >= 2) {
      log(
        `[game] sofá: ${seats.length} jogadores (${seats.map((s) => couchDeviceLabel(s.device) + (s.side === 1 ? ' contra' : '')).join(', ')})`,
      );
    }
    const p1 = seats.length >= 1 ? seats[0]!.device : null;
    pendingScene = {
      kind,
      bench,
      benchWarnings: bench ? (deps.benchWarnings ?? []) : [],
      seed: bench ? bench.seed : (0x6b0b0 + matches * 0x9e37) >>> 0,
      convention,
      device: p1 ? p1.kind : menuInput.lastDevice,
      gamepad: p1?.kind === 'gamepad' ? p1.index : menuInput.lastGamepad,
      ...(recipe ? { recipe } : {}),
      ...(calibrate ? { calibrate: true } : {}),
      ...(seats.length >= 1 ? { seats } : {}),
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
        bobo: {
          get current() {
            return save.bobo;
          },
          save: (doc) => save.setBobo(doc),
        },
        audio: {
          mixer,
          get files() {
            return startSoundFiles();
          },
        },
        benchReport: (text) => hooks.onBenchReport?.(text),
      },
      request,
    );
    log(`[game] cena ${matches}: ${request.kind}${request.bench ? ` (vistas=${request.bench.views})` : ''}`);
  }

  function leaveScene(): void {
    // M2 (fase 5e): o Testar do Laboratório volta para o editor, com os números do treino.
    const report = labTesting ? (scene?.trainingReport() ?? null) : null;
    scene?.dispose();
    scene = null;
    pendingScene = null;
    if (wardrobeOpen) {
      wardrobeOpen = false;
      screen = 'main';
      return;
    }
    if (labTesting) {
      labTesting = false;
      const none = t('result.noAccuracy');
      labNote =
        report === null
          ? ''
          : t('lab.tested', {
              accuracy: report.botAccuracy >= 0 ? t('settings.percent', { n: report.botAccuracy }) : none,
              kills: report.kills,
              deaths: report.deaths,
              ttk: report.ttkS >= 0 ? t('lab.seconds', { n: Math.round(report.ttkS * 10) / 10 }) : none,
            });
      rebuildLab();
      screen = 'lab';
      return;
    }
    if (couchActive) {
      // M3 (fase 1b): do sofá, a volta é para a tela do sofá, com os mesmos jogadores.
      couchSig = -1;
      couchStartPrev = true;
      rebuildCouch();
      screen = 'couch';
      return;
    }
    screen = 'title';
    refreshTitle();
    // De volta da partida, o foco é o JOGAR (revanche em 1 interação, arte-ux.md §6.4).
    titleMenu.focus('play');
  }

  /**
   * M2 (fase 5e): o card "Conheça o Laboratório", uma vez, ao sair da 1ª partida terminada (só pelo Sair: De novo e
   * as outras emendam outra partida). Fica marcado como visto já ao abrir.
   */
  const labIntroMenu = createMenuController();
  const LAB_INTRO_SEEN = 'labCard';
  function maybeLabIntro(): void {
    if (screen !== 'title' || save.stats.totals.matches !== 1) return;
    if (save.stats.onboarding.tipsSeen.includes(LAB_INTRO_SEEN)) return;
    save.setStats(markTipSeen(save.stats, LAB_INTRO_SEEN));
    const jorge = factoryBots.find((b) => b.id === 'jorge-the-immortal')!;
    labIntroMenu.setRoot(labIntroScreen.build({ name: botDisplayName(jorge), lines: botCardLines(jorge) }));
    screen = 'labIntro';
  }

  /** M2 (fase 5e): o Nêmesis do resultado vai para a Oficina (cópia, com o nome dele ou "… 2"). */
  function saveNemesis(): void {
    const doc = scene?.nemesisBot() ?? null;
    if (doc === null) return;
    const ids = new Set([...save.bots.map((b) => b.id), ...factoryBots.map((b) => b.id)]);
    const names = allBotNames();
    const base = botDisplayName(doc);
    save.saveBot({ ...doc, id: newBotId(botRng, ids), name: names.has(base) ? copyName(base, names) : base });
  }

  /** M2 (fase 4c): joga um preset: ele vira o último (o do JOGAR) e a partida começa com semente nova. */
  function playPreset(preset: MatchRecipe): void {
    playingPreset = preset;
    save.pushRecent({ ...preset, seed: 0 });
    requestScene('play', null, preset);
  }

  /** M2 (fase 5d): o treino não vira o último preset (o JOGAR continua sendo a última partida). */
  function playTraining(preset: MatchRecipe, calibrate = false): void {
    playingPreset = preset;
    requestScene('play', null, preset, calibrate);
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
    if (save.settings !== audioApplied) {
      audioApplied = save.settings;
      applyAudioSettings(mixer, audioApplied.audio);
      applyQuality();
    }
    // M2 (fase 8c): a versão nova baixada pelo service worker só vale no título (GDD §2), nunca no meio da partida.
    if (screen === 'title' && !deps.bench && platform.updates?.ready) {
      log('[game] versão nova: aplicando no título');
      platform.updates.apply();
    }
    // M3: a tela de edição pedida antes de o módulo chegar abre agora.
    if (editors !== null && editorsAfter !== null) {
      const then = editorsAfter;
      editorsAfter = null;
      then();
    }
    updateMusic();
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
        else if (nav.activated === MAIN_MENU_ACTION.couch) openCouch(raw);
        else if (nav.activated === MAIN_MENU_ACTION.news) openNews('main');
        else if (nav.activated === MAIN_MENU_ACTION.lab) openWorkshop();
        else if (nav.activated === MAIN_MENU_ACTION.bobo) {
          // M2 (fase 6c): o editor é uma cena (o bobo em 3D); na volta, o menu principal.
          wardrobeOpen = true;
          requestScene('wardrobe', null);
        }
        if (screen === 'main') {
          mainMenu.draw(list, u);
          renderer.renderViews(NO_VIEWS);
          renderer.drawUi(list);
        }
        break;
      }
      case 'couch': {
        couchFrame(raw, u);
        if (screen === 'couch') {
          couchMenu.draw(list, u);
          renderer.renderViews(NO_VIEWS);
          renderer.drawUi(list);
        }
        break;
      }
      case 'labIntro': {
        const nav = labIntroMenu.update(menuInput, raw, u);
        const a = nav.activated;
        if (nav.back || a === LAB_INTRO_ACTION.later) screen = 'title';
        else if (a === LAB_INTRO_ACTION.open) openWorkshop();
        else if (a === LAB_INTRO_ACTION.test) {
          // Testar o Jorge: o treino com ele; na volta, o título.
          screen = 'title';
          playTraining(trainingPreset([{ ref: 'builtin:jorge-the-immortal', count: 1 }]));
        }
        if (screen === 'labIntro') {
          labIntroMenu.draw(list, u);
          renderer.renderViews(NO_VIEWS);
          renderer.drawUi(list);
        }
        break;
      }
      case 'lab': {
        // Digitando o nome, ou logo depois (até soltar tudo): o menu não anda.
        if (labHold && !anyInputHeld(raw)) labHold = false;
        if (labTyping === null && !labHold) labAction(labMenu.update(menuInput, raw, u));
        if (screen === 'lab') {
          labMenu.draw(list, u);
          renderer.renderViews(NO_VIEWS);
          renderer.drawUi(list);
        }
        break;
      }
      case 'workshop': {
        const nav = workshopMenu.update(menuInput, raw, u);
        if (nav.back || nav.activated === WORKSHOP_ACTION.back) screen = 'main';
        else {
          if (nav.activated !== null) workshopAction(nav.activated);
          workshopMenu.draw(list, u);
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
          const count = editors!.customTabs(customRecipe).length;
          customTab = (customTab + nav.tab + count) % count;
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
          customRecipe = editors!.stepCustom(
            editors!.customTabs(customRecipe)[customTab]!,
            customRecipe,
            id,
            nav.delta,
            customLimits,
          );
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
          else if (id === 'training') playTraining(trainingPreset());
          else if (id === 'zombies') playPreset(ZOMBIES_PRESET);
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
          else if (tab === 'controls' && id === 'calibrate') playTraining(trainingPreset(), true);
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
      if (signal === 'quit') {
        leaveScene();
        maybeLabIntro();
      } else if (signal === 'again' || signal === 'easier' || signal === 'harder') {
        // M2 (fase 2e): De novo / Mais fácil / Mais difícil: a mesma partida com semente nova, um passo de nível.
        const level = scene!.level;
        const next = signal === 'easier' ? stepLevel(level, -1) : signal === 'harder' ? stepLevel(level, 1) : level;
        const preset = playingPreset ?? currentPreset();
        leaveScene();
        // M2 (fase 4c): o nível novo vale para todos os bots de nível do preset, e ele vira o último.
        playPreset(withPresetLevel(preset, next));
      } else if (signal === 'rules') {
        // M2 (fase 4e): Mudar regras abre a Partida personalizada com o preset desta partida (e o sofá acaba).
        const preset = playingPreset ?? currentPreset();
        closeCouch();
        leaveScene();
        // M3 (fase 6b): também no Bobo Zombies (a Partida personalizada sabe as regras dele).
        openCustom(preset, 'title');
      } else if (signal === 'save') {
        const preset = playingPreset ?? currentPreset();
        withEditors(() => void saveCustomPreset(preset));
      } else if (signal === 'nemesis') saveNemesis();
      else if (signal === 'lab') {
        // M2 (fase 5e): Abrir Laboratório (no Tryhard): sai da partida para a Oficina (e o sofá acaba).
        closeCouch();
        leaveScene();
        openWorkshop();
      }
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
    void startSoundFiles();
    pickAutoQuality();
    loadEditors();
    // O bench abre a cena só depois de UM frame do título: assim o `loading_ms` mede o mesmo que JOGAR no menu.
    // Antes, a cena começava no boot e o loading pagava o primeiro desenho da UI (programa, atlas e, no Eden, a
    // compilação dos shaders do emulador): ~0,75 s a mais na mesma build.
    if (deps.bench) requestScene('bench', deps.bench);
  }

  function onFrame(frameMs: number): void {
    if (disposed || screen === 'error') return;
    // M2 (fase 6e): o limite de 30 FPS dos Ajustes pula o quadro que chega cedo (o bench mede sem limite).
    if (!deps.bench && skipCappedFrame(save.settings.video.fpsCap, lastFrameMs, frameMs)) {
      frameHandle = platform.requestFrame(onFrame);
      return;
    }
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
    get audio() {
      return { stats: mixer.stats, state: mixer.context?.state ?? 'none', sounds: soundCount, music: mixer.music };
    },
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
      setMenuSoundSink(null);
      mixer.dispose();
    },
  };
}
