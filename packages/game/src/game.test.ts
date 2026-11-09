import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHeadlessMatch } from '@boboforces/ai';
import {
  builtinBotRef,
  DEBUT_PRESET,
  DEFAULT_SETTINGS,
  EMPTY_STATS,
  createFigureGameTable,
  decodeMap,
  FIGURE_BOT_ROTATION,
  FIGURE_GRIP,
  FIGURE_LOOK_DEFAULT,
  FIGURE_MODE,
  FIGURE_POSTURE_INFO,
  FIGURE_PRESETS,
  FIGURE_SKIN_BYTES,
  FIGURE_SKIN_LAYERS,
  FIGURE_STANCE,
  figurePosture,
  GAME_VERSION,
  ISSUE_CODES,
  MATCH_RECIPE_FORMAT,
  normalizeFigureLook,
  PLATFORM_PROFILES,
  SKIN_LAYER_RESERVE,
  type FigureGameTable,
  type FigureLook,
  type MatchRecipe,
} from '@boboforces/format';
import {
  createRawInputState,
  DEFAULT_TOUCH_LAYOUT,
  keyIndex,
  placeTouchButton,
  type RawInputState,
  type TouchButtonRect,
} from '@boboforces/input';
import type { Platform, PlatformId } from '@boboforces/platform-api';
import { ACTOR_KIND, NO_FIGURE, type ActorBuffer } from '@boboforces/render/data';
import { hashToHex } from '@boboforces/shared';
import {
  entityIndex,
  ENTITY_FLAG,
  ENTITY_KIND,
  expandRecipe,
  figurePostureOf,
  weaponDef,
  weaponGrip,
  type Sim,
} from '@boboforces/sim';
import {
  BUTTON,
  layoutTree,
  LOADING_STEPS,
  measureText,
  MIN_TEXT,
  MIN_TOUCH_TARGET,
  moveFocus,
  parseFontPack,
  STRINGS_PT_BR,
  uiScale,
  type StringKey,
  type TestScreenModel,
} from '@boboforces/ui';
import { buildTestArena } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { GAME_ASSETS, loadGameAssets } from './assets.ts';
import { BENCH_DEFAULTS, type BenchConfig, type TestItem } from './bench/types.ts';
import { verticalFov } from './camera.ts';
import { MENU_READY_MARKER, startGame, type GameDeps, type GameHandle } from './game.ts';
import { createLocalDriver } from './local-driver.ts';
import { createNullRenderer } from './null-renderer.ts';
import { pauseScreen } from './pause.ts';
import type { SceneBundle, SceneRequest } from './scene-api.ts';
import { createConstrutoLoader } from './scene/load.ts';
import { SCENE_MODULE } from './scene/index.ts';
import {
  createSceneFigures,
  FIGURE_DEFAULT_LOOK,
  figureSetKey,
  planFigureSkins,
  type FigureSkinSet,
  type SceneFigures,
  type SceneFiguresInput,
} from './scene/figures.ts';
import { profileFor, sceneRecipe } from './scene/match.ts';

// --- Plataforma falsa: relógio e frames manuais, input controlado pelo teste, assets lidos de assets-src/ pela
// --- mesma tabela (`runtime-assets.json`) que a web e o Switch usam.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const RUNTIME = JSON.parse(readFileSync(join(ROOT, 'assets-src', 'runtime-assets.json'), 'utf8')) as {
  files: Record<string, string>;
  preload: string[];
};

function readRuntimeAsset(path: string): Uint8Array {
  const source = RUNTIME.files[path];
  if (!source) throw new Error(`asset desconhecido: ${path}`);
  return new Uint8Array(readFileSync(join(ROOT, 'assets-src', source)));
}

interface FakePlatform extends Platform {
  /** Estado bruto que o próximo `poll` entrega (o teste mexe nele). */
  readonly rawNext: RawInputState;
  readonly logLines: string[];
  exits: number;
  readonly framesPending: number;
  pump(n: number, frameMs?: number): void;
  /** Aperta e solta uma tecla em dois frames (o mapeador vê a borda). */
  tap(code: string): void;
  firePause(): void;
}

function createFakePlatform(
  opts: { id?: PlatformId; brokenAssets?: boolean; store?: Readonly<Record<string, string>> } = {},
): FakePlatform {
  const noop = (): (() => void) => () => {};
  // M2 (fase 4g): o save pode já vir preenchido (um jogador que atualizou o jogo).
  const store = new Map<string, string>(Object.entries(opts.store ?? {}));
  const pauseListeners = new Set<() => void>();
  const callbacks = new Map<number, (nowMs: number) => void>();
  const rawNext = createRawInputState();
  rawNext.surfaceWidth = 1280;
  rawNext.surfaceHeight = 720;
  const id = opts.id ?? 'web';
  let now = 1000;
  let nextHandle = 1;
  const load = (path: string): Uint8Array => {
    if (opts.brokenAssets) throw new Error(`asset ausente: ${path}`);
    return readRuntimeAsset(path);
  };

  const platform: FakePlatform = {
    id,
    features: {
      profileHint: id === 'switch' ? 'switch' : 'pc',
      touch: false,
      keyboardMouse: id !== 'switch',
      reducedMotion: false,
      canExit: id === 'switch',
    },
    graphics: {
      kind: 'webgl2',
      context: null,
      canvas: null,
      width: 1280,
      height: 720,
      pixelRatio: 1,
      safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
      onResize: noop,
    },
    storage: {
      get: (k) => store.get(k) ?? null,
      set: (k, v) => void store.set(k, v),
      remove: (k) => void store.delete(k),
      keys: () => [...store.keys()],
      getBackup: () => null,
      flush: async () => {},
    },
    assets: {
      loadBytes: async (path) => load(path),
      loadText: async (path) => new TextDecoder().decode(load(path)),
    },
    files: null,
    textInput: { available: false, open: () => null },
    lifecycle: {
      onPause: (listener) => {
        pauseListeners.add(listener);
        return () => pauseListeners.delete(listener);
      },
      onResume: noop,
      onVisibility: noop,
      setInMatch: () => {},
    },
    diagnostics: {
      collectReport: async () => ({
        platform: id,
        system: 'teste',
        screen: { width: 1280, height: 720, pixelRatio: 1 },
        gpu: 'nenhuma',
        glLimits: {},
        storagePersisted: null,
        extra: {},
      }),
      appendLog: (line) => void platform.logLines.push(line),
    },
    input: {
      poll(out) {
        out.keys.set(rawNext.keys);
        out.mouseDX = rawNext.mouseDX;
        out.mouseDY = rawNext.mouseDY;
        out.mouseButtons = rawNext.mouseButtons;
        out.pointerLocked = rawNext.pointerLocked;
        out.surfaceWidth = rawNext.surfaceWidth;
        out.surfaceHeight = rawNext.surfaceHeight;
        out.pixelRatio = 1;
        rawNext.mouseDX = 0;
        rawNext.mouseDY = 0;
      },
      vibrate: () => {},
    },
    audio: null,
    online: null,
    now: () => now,
    requestFrame(callback) {
      const handle = nextHandle++;
      callbacks.set(handle, callback);
      return handle;
    },
    cancelFrame(handle) {
      callbacks.delete(handle);
    },
    exit() {
      platform.exits++;
    },
    rawNext,
    logLines: [],
    exits: 0,
    get framesPending() {
      return callbacks.size;
    },
    pump(n, frameMs = 1000 / 60) {
      for (let i = 0; i < n; i++) {
        now += frameMs;
        const pending = [...callbacks.values()];
        callbacks.clear();
        for (const cb of pending) cb(now);
      }
    },
    tap(code) {
      const k = keyIndex(code);
      rawNext.keys[k] = 1;
      platform.pump(1);
      rawNext.keys[k] = 0;
      platform.pump(1);
    },
    firePause() {
      for (const listener of pauseListeners) listener();
    },
  };
  return platform;
}

/** Deixa as promessas do carregamento (assets, cena) andarem. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

/** A cena vem direto (como no Switch: um arquivo só). */
const loadScene = (): Promise<SceneBundle> => Promise.resolve({ module: SCENE_MODULE });

async function bootToTitle(
  id: PlatformId = 'web',
  extra: { testItems?: readonly TestItem[] } = {},
  store: Readonly<Record<string, string>> = {},
) {
  const platform = createFakePlatform({ id, store });
  const events: string[] = [];
  const game = startGame({
    platform,
    createRenderer: null,
    loadScene,
    ...extra,
    hooks: {
      onMenuReady: () => events.push('menuReady'),
      onError: (e) => events.push(`error ${String(e)}`),
      requestPointerLock: () => events.push('lock'),
      releasePointerLock: () => events.push('unlock'),
    },
  });
  platform.pump(2);
  await settle();
  platform.pump(2);
  return { platform, game, events };
}

/** Frames + promessas até a cena ficar pronta (o loading roda dentro dos frames). */
async function untilRunning(platform: FakePlatform, game: GameHandle): Promise<void> {
  for (let i = 0; i < 200 && game.scene?.phase !== 'running'; i++) {
    platform.pump(1);
    await settle();
  }
  expect(game.scene?.phase).toBe('running');
}

describe('startGame (NullRenderer)', () => {
  it('carrega as fontes, chega ao título e grava o marcador do menu uma vez', async () => {
    const { platform, game, events } = await bootToTitle();
    expect(game.screen).toBe('title');
    expect(game.renderer.stats.programs).toBe(0);
    expect(events).toEqual(['menuReady']);
    expect(platform.logLines.filter((l) => l.startsWith(MENU_READY_MARKER))).toHaveLength(1);
    platform.pump(30);
    expect(events).toEqual(['menuReady']);
    expect(platform.framesPending).toBe(1);
    game.dispose();
    expect(platform.framesPending).toBe(0);
  });

  it('JOGAR abre o Construto (loading por etapas), bots andam, os prints respondem, pausa e volta', async () => {
    const { platform, game, events } = await bootToTitle();
    platform.tap('Enter');
    expect(game.screen).toBe('scene');
    expect(game.debug).toBeNull();
    await untilRunning(platform, game);
    expect(platform.logLines.some((l) => l.startsWith('[cena] loading ') && l.includes(' (chegada '))).toBe(true);
    expect(events).toContain('lock');
    const debug = game.debug!;
    expect(debug.cameras).toEqual(expect.arrayContaining(['print:dia', 'print:leitura-50m', 'bench:volta']));
    expect(debug.setCamera('nao-existe')).toBe(false);
    const match = game.match!;
    const sim = match.sim;
    const view = sim.view();
    // M2 (fase 4c): sem nada salvo, o JOGAR é a partida de estreia (TDM 4v4: o jogador e 7 bots De boa).
    expect(match.director.botCount).toBe(7);
    // M2 (fase 2d): o JOGAR começa com a contagem de 3 s, sem ninguém andar; os bots saem depois dela.
    expect([view.match.phase, view.match.countdownTicks > 0]).toEqual(['warmup', true]);
    platform.pump(view.match.countdownTicks + 5);
    expect(view.match.phase).toBe('playing');
    const bots = [4, 5, 6, 7].map((c) => entityIndex(sim.controllerEntity(c)));
    const start = bots.map((e) => [view.position[e * 3]!, view.position[e * 3 + 2]!] as const);
    const tick0 = sim.tick;
    platform.rawNext.keys[keyIndex('KeyW')] = 1;
    platform.pump(180);
    platform.rawNext.keys[keyIndex('KeyW')] = 0;
    expect(sim.tick - tick0).toBeGreaterThanOrEqual(170);
    const moved = bots.filter((e, i) => {
      const [x, z] = start[i]!;
      return Math.hypot(view.position[e * 3]! - x, view.position[e * 3 + 2]! - z) > 1;
    });
    expect(moved.length).toBeGreaterThanOrEqual(2);
    const me = entityIndex(sim.controllerEntity(0));
    expect(view.flags[me]! & ENTITY_FLAG.dead).toBe(0);

    // Prints: chaves de depuração, congelar e o "pronto".
    expect(debug.setCamera('print:dia')).toBe(true);
    debug.setTimeOfDay('night');
    debug.setMipFilter('off');
    debug.setFrozen(true);
    const ready = debug.whenReady(2);
    platform.pump(3);
    await ready;
    expect(debug.readyForPrint).toBe(true);
    const frozenTick = sim.tick;
    platform.pump(10);
    expect(sim.tick).toBe(frozenTick);
    // Folha das fontes em uso (#54): o atlas real de sempre, sem carga à parte; liga sem vistas 3D e desliga.
    debug.showFontSpecimen(true);
    const sheet = debug.whenReady(2);
    platform.pump(3);
    await sheet;
    expect(debug.readyForPrint).toBe(true);
    expect(game.renderer.stats.viewports).toBe(0);
    debug.showFontSpecimen(false);
    platform.pump(1);
    expect(game.renderer.stats.viewports).toBe(1);
    debug.setFrozen(false);
    debug.setCamera(null);

    // Pausa pelo ciclo de vida congela a sim; Enter continua. M2 (fase 2e): P, Ajustar desafio → Normal (um abaixo do
    // De boa da partida de estreia, que vem com o foco) volta à pausa com o nível novo; 4 × baixo + Enter (Sair) volta
    // ao título.
    platform.firePause();
    expect(game.paused).toBe(true);
    platform.pump(1);
    expect(events.at(-1)).toBe('unlock');
    const paused = sim.tick;
    platform.pump(30);
    expect(sim.tick).toBe(paused);
    platform.tap('Enter');
    expect(game.paused).toBe(false);
    platform.pump(10);
    expect(sim.tick).toBeGreaterThan(paused);
    platform.tap('KeyP');
    expect(game.paused).toBe(true);
    platform.tap('ArrowDown');
    platform.tap('Enter');
    platform.tap('ArrowDown');
    platform.tap('Enter');
    expect([game.scene!.level, game.paused]).toEqual(['normal', true]);
    for (let i = 0; i < 4; i++) platform.tap('ArrowDown');
    platform.tap('Enter');
    expect(game.screen).toBe('title');
    expect(game.scene).toBeNull();
    expect(game.debug).toBeNull();
    game.dispose();
  }, 120_000);

  it('bench (GameDeps.bench): 2 vistas seguindo bots, relatório no formato e sondas [t0] do jogo', async () => {
    const platform = createFakePlatform();
    const reports: string[] = [];
    const bench: BenchConfig = { ...BENCH_DEFAULTS, views: 2, bots: 4, durationS: 1, warmupS: 0, viewDistanceM: 50 };
    const game = startGame({
      platform,
      createRenderer: null,
      loadScene,
      bench,
      benchWarnings: ['parâmetro desconhecido: foo'],
      hooks: { onBenchReport: (text) => reports.push(text) },
    });
    platform.pump(2);
    await settle();
    await untilRunning(platform, game);
    expect(game.match!.director.botCount).toBe(6);
    for (let i = 0; i < 120 && reports.length === 0; i++) platform.pump(1);
    expect(reports).toHaveLength(1);
    const lines = reports[0]!.split('\n');
    expect(lines[0]).toBe('BoboForces bench 2');
    expect(lines.at(-1)).toBe('fim');
    expect(lines.some((l) => /\bvistas=2\b/.test(l))).toBe(true);
    expect(lines.filter((l) => /^vista\d /.test(l))).toHaveLength(2);
    expect(lines).toContain('erros=0');
    expect(lines).toContain('aviso "parâmetro desconhecido: foo"');
    expect(lines.some((l) => l.startsWith('loading_ms total='))).toBe(true);
    for (const item of [10, 11, 12, 13, 14, 15, 16]) {
      expect(platform.logLines.some((l) => l.startsWith(`[t0] item=${item} `))).toBe(true);
    }
    game.dispose();
  }, 120_000);

  // --- verificação do M1: sondas sem medição, erros do three, bots limitados, thermal, clarão e manequins ---

  /** Bench com relatório e o log: `t0(n)` devolve a linha `[t0] item=n`. */
  async function runBench(bench: BenchConfig, createRenderer: GameDeps['createRenderer'] = null) {
    const platform = createFakePlatform();
    const reports: string[] = [];
    const game = startGame({
      platform,
      createRenderer,
      loadScene,
      bench,
      hooks: { onBenchReport: (text) => reports.push(text) },
    });
    platform.pump(2);
    await settle();
    await untilRunning(platform, game);
    const t0 = (item: number): string => platform.logLines.find((l) => l.startsWith(`[t0] item=${item} `)) ?? '';
    return { platform, game, reports, t0 };
  }

  it('bench interrompido no aquecimento: sem amostra as sondas saem `pulado`, nunca `ok` com zeros', async () => {
    const { platform, game, reports, t0 } = await runBench({ ...BENCH_DEFAULTS, views: 1, bots: 2, warmupS: 10 });
    platform.pump(30);
    platform.tap('Escape');
    expect(reports).toHaveLength(1);
    expect(t0(10)).toMatch(/status=pulado motivo=sem_amostras interrompido=1 segundos_medidos=0$/);
    expect(t0(12)).toMatch(/status=pulado motivo=sem_amostras/);
    expect(t0(14)).toMatch(/status=pulado motivo=heap_desconhecido/); // a plataforma falsa não mede heap
    // O item 15 mede o começo da partida (aquecimento incluído), então tem amostra mesmo interrompido.
    expect(t0(15)).toMatch(
      /status=ok primeiro_frame_ms=[\d.]+ max_inicio_ms=[\d.]+ travadas_inicio=0 frames_inicio=3\d /,
    );
    expect(t0(16)).toMatch(/status=pulado motivo=sem_amostras/);
    game.dispose();
  }, 120_000);

  it('bench: erro do three vai para erros=, bots limitados pelo motor e teto de detritos do perfil no relatório', async () => {
    let budget = -1;
    const factory: GameDeps['createRenderer'] = () => {
      const r = createNullRenderer();
      (r.info.warnings as string[]).push('error: THREE.WebGLProgram: Shader Error 1282', 'warn: aviso qualquer');
      r.setDebrisBudget = (n) => void (budget = n);
      return r;
    };
    const { platform, game, reports, t0 } = await runBench(
      { ...BENCH_DEFAULTS, views: 4, bots: 64, durationS: 1, warmupS: 0 },
      factory,
    );
    expect(game.match!.director.botCount).toBe(64);
    for (let i = 0; i < 200 && reports.length === 0; i++) platform.pump(1);
    const lines = reports[0]!.split('\n');
    expect(lines).toContain('erros=1');
    expect(lines).toContain('erro "three: error: THREE.WebGLProgram: Shader Error 1282"');
    expect(lines).toContain('aviso "three: warn: aviso qualquer"');
    // 4 jogadores locais (bots) + 60 extras = 64; o relatório diz os extras de verdade, o [t0] o total da partida.
    expect(lines[3]).toMatch(/ bots=64 .* bots_efetivos=60 manequins=6 detritos=500 armas=rifle$/);
    expect(t0(12)).toMatch(/ bots=64 /);
    expect(budget).toBe(500); // pcSplit (PC com 4 vistas)
    game.dispose();
  }, 120_000);

  it('item 16 (thermal) compara o 1º minuto com os ÚLTIMOS 60 s por tempo, não com as últimas 14.400 amostras', async () => {
    const { platform, game, reports, t0 } = await runBench({
      ...BENCH_DEFAULTS,
      views: 1,
      bots: 0,
      durationS: 200,
      warmupS: 0,
    });
    // 150 s a 40 ms e o fim a 60 ms (queda de clock nos últimos 50 s): antes o p50_fim cobria a rodada inteira.
    platform.pump(3750, 40);
    for (let i = 0; i < 2000 && reports.length === 0; i++) platform.pump(1, 60);
    expect(reports).toHaveLength(1);
    expect(t0(16)).toMatch(/status=falha p50_inicio=40\.00 p50_fim=60\.00 segundos_fim=6\d segundos=20\d$/);
    // Picos distribuídos: no máximo uma linha por janela (duração ÷ 20).
    const peaks = platform.logLines.filter((l) => l.startsWith('[bench] pico '));
    expect(peaks.length).toBeGreaterThan(0);
    expect(peaks.length).toBeLessThanOrEqual(21);
    // O heap no pico e na amostra de 1 s separa coleta do V8 de espera do GL (`-` = plataforma sem memória).
    expect(peaks[0]).toMatch(/^\[bench\] pico t=\d+ frame_ms=\d+ cpu_ms=.* heap_mb=\S+ heap_1s_mb=\S+$/);
    game.dispose();
  }, 120_000);

  it('clarão de tiro por vista (arte-ux §1.8) e manequins de print só com a câmera deles', async () => {
    const flashes: number[][] = [];
    let actorCount = -1;
    let buffer: ActorBuffer | null = null;
    const factory: GameDeps['createRenderer'] = () => {
      const r = createNullRenderer();
      const render = r.renderViews.bind(r);
      r.renderViews = (views) => {
        flashes.push(views.map((v) => v.flash));
        render(views);
      };
      const setActors = r.setActors.bind(r);
      r.setActors = (a) => {
        actorCount = a.count;
        buffer = a;
        setActors(a);
      };
      return r;
    };
    const { platform, game } = await runBench(
      { ...BENCH_DEFAULTS, views: 2, bots: 6, durationS: 600, warmupS: 0 },
      factory,
    );
    // Algum tiro clareou uma vista e não a outra (antes era um uniform só para as duas). Roda até o 1º tiro de um dos
    // bots das vistas (até 60 s): quando ele vem depende do sorteio das personalidades (fase 3g).
    const split = (): boolean => flashes.some((f) => f.length === 2 && Math.abs(f[0]! - f[1]!) > 0.2);
    for (let k = 0; k < 60 && !split(); k++) platform.pump(60);
    expect(split()).toBe(true);
    const debug = game.debug!;
    debug.setFrozen(true);
    platform.pump(2);
    const base = actorCount;
    debug.setCamera('print:leitura-30m');
    platform.pump(1);
    expect(actorCount).toBe(base + 2);
    debug.setCamera('print:densidade-1m');
    platform.pump(1);
    expect(actorCount).toBe(base + 1);
    // Régua de métricas (#53): `altura:em-pe`, `altura:agachado` e (#56) `altura:deslizando` só com a `print:altura`.
    debug.setCamera('print:altura');
    platform.pump(1);
    expect(actorCount).toBe(base + 3);
    // O deslize é a postura `slide` de verdade (sem arma: 17), não o em pé de antes.
    const slide = figurePosture(FIGURE_STANCE.slide, FIGURE_GRIP.none, FIGURE_MODE.base, false);
    const b = buffer! as ActorBuffer;
    const mannequinPostures: number[] = [];
    for (let i = 0; i < b.count; i++) if (b.kind[i] === ACTOR_KIND.mannequin) mannequinPostures.push(b.posture[i]!);
    expect(mannequinPostures).toContain(slide);
    // Fila (#56, `MANNEQUIN_KIND.line`): os 8 `linha:*` só com as `print:linha-*`; o close só com a `print:close-1m`.
    debug.setCamera('print:linha-frente');
    platform.pump(1);
    expect(actorCount).toBe(base + 8);
    debug.setCamera('print:close-1m');
    platform.pump(1);
    expect(actorCount).toBe(base + 2);
    debug.setCamera('print:dia');
    platform.pump(1);
    expect(actorCount).toBe(base);
    debug.setCamera(null);
    platform.pump(1);
    expect(actorCount).toBe(base);
    game.dispose();
  }, 120_000);

  it('E.12: em 600 ticks, ActorBuffer.posture = figurePostureOf da sim e a empunhadura = WeaponDef.grip', async () => {
    let sim: Sim | null = null;
    let checked = 0;
    let zombies = 0;
    const seen = new Set<number>();
    const problems: string[] = [];
    const factory: GameDeps['createRenderer'] = () => {
      const r = createNullRenderer();
      const setActors = r.setActors.bind(r);
      r.setActors = (a) => {
        const s = sim;
        if (s) {
          const v = s.view();
          for (let i = 0; i < a.count; i++) {
            if (a.kind[i] === ACTOR_KIND.mannequin || a.entity[i] === 0) continue;
            const e = entityIndex(a.entity[i]!);
            const expected = figurePostureOf(v.flags[e]!, weaponGrip(v.weapon[e]!), v.kind[e]!);
            if (a.posture[i] !== expected) problems.push(`tick ${s.tick}: ${a.posture[i]} ≠ ${expected}`);
            const zombie = v.kind[e] === ENTITY_KIND.zombie;
            const grip = zombie ? FIGURE_GRIP.none : (weaponDef(v.weapon[e]!)?.grip ?? FIGURE_GRIP.none);
            if (FIGURE_POSTURE_INFO[a.posture[i]! * 3 + 1] !== grip) problems.push(`tick ${s.tick}: empunhadura`);
            if (a.figure[i] === NO_FIGURE) problems.push(`tick ${s.tick}: sem gabarito`);
            if (zombie) zombies++;
            seen.add(a.posture[i]!);
            checked++;
          }
        }
        setActors(a);
      };
      return r;
    };
    const { platform, game } = await runBench(
      { ...BENCH_DEFAULTS, views: 1, bots: 8, zombies: 2, durationS: 600, warmupS: 0 },
      factory,
    );
    sim = game.match!.sim;
    const tick0 = sim.tick;
    for (let i = 0; i < 700 && sim.tick - tick0 < 600; i++) platform.pump(1);
    expect(sim.tick - tick0).toBeGreaterThanOrEqual(600);
    expect(problems.slice(0, 5)).toEqual([]);
    expect(checked).toBeGreaterThan(600 * 5);
    expect(zombies).toBeGreaterThan(0);
    // A partida passa por mais de uma postura (em pé, correndo, ADS, zumbi…), não só pela de repouso.
    expect(seen.size).toBeGreaterThan(2);
    game.dispose();
  }, 120_000);

  it('gancho dos prints da rodada 3: setMannequins (looks sob demanda) e setFigureClip (dt fixo)', async () => {
    let buffer: ActorBuffer | null = null;
    const clock: number[] = [];
    let setFiguresCalls = 0;
    let templates = 0;
    const factory: GameDeps['createRenderer'] = () => {
      const r = createNullRenderer();
      r.setActors = (a) => void (buffer = a);
      r.setEnvironment = (env) => void clock.push(env.timeS);
      r.setFigures = (t) => {
        setFiguresCalls++;
        templates = t?.count ?? 0;
      };
      return r;
    };
    const { platform, game } = await runBench(
      { ...BENCH_DEFAULTS, views: 1, bots: 2, durationS: 600, warmupS: 0, prints: true },
      factory,
    );
    const debug = game.debug!;
    debug.setFrozen(true);
    platform.pump(2);
    const actorsOf = (pick: (a: ActorBuffer, i: number) => boolean): number[] => {
      const a = buffer!;
      const out: number[] = [];
      for (let i = 0; i < a.count; i++) if (pick(a, i)) out.push(i);
      return out;
    };
    // Com o pedido de prints, a fila veste o visual n no manequim n (8 skins diferentes); sem ele, o mapa (recruta).
    debug.setCamera('print:linha-frente');
    platform.pump(1);
    // A fila fica em x = 74,5 (a vitrine também aparece: é de sempre).
    const line = actorsOf((a, i) => a.kind[i] === ACTOR_KIND.mannequin && Math.abs(a.position[i * 3]! - 74.5) < 0.01);
    expect(line).toHaveLength(8);
    expect(new Set(line.map((i) => buffer!.skin[i])).size).toBe(8);

    expect(debug.setMannequins([{ name: 'nao-existe' }])).toBe(false);
    expect(debug.setMannequins([{ name: 'altura:em-pe', look: 'skin:nao-existe' }])).toBe(false);
    debug.setCamera('print:altura');
    const before = setFiguresCalls;
    const templatesBefore = templates;
    expect(
      debug.setMannequins([
        { name: 'altura:em-pe', look: 'skin:classico', team: -1, pose: 'crouch', weapon: 'rifle', pitch: 0.6 },
        { name: 'altura:agachado', look: 'skin:classico', team: -1, pose: 'crouch', weapon: 'rifle', hairStyle: 31 },
      ]),
    ).toBe(true);
    // Afro gigante por cima do Clássico: look fora da cena, gabarito novo (sob demanda na web) e repassado ao render.
    expect(setFiguresCalls).toBe(before + 1);
    expect(templates).toBe(templatesBefore + 1);
    platform.pump(1);
    const crouchRifle = figurePosture(FIGURE_STANCE.crouch, FIGURE_GRIP.rifle, FIGURE_MODE.base, false);
    const aimed = actorsOf((a, i) => Math.abs(a.pitch[i]! - 0.6) < 1e-6);
    expect(aimed).toHaveLength(1);
    // Mira ≠ 0: entidade sintética (o rig zera o pitch da entidade 0), ainda manequim para o render.
    expect(buffer!.entity[aimed[0]!]).not.toBe(0);
    expect(buffer!.kind[aimed[0]!]).toBe(ACTOR_KIND.mannequin);
    expect(buffer!.posture[aimed[0]!]).toBe(crouchRifle);
    expect(debug.setMannequins([])).toBe(true);

    // Clipe com dt fixo: 30 passos de preparo + o quadro 9 + o passo 0 (boneco novo).
    debug.setCamera('print:linha-3-4');
    expect(debug.setFigureClip({ mannequin: 'nao', clip: 'start', frame: 9, dtS: 1 / 60 })).toBe(false);
    expect(debug.setFigureClip({ mannequin: 'linha:4', clip: 'nao' as 'start', frame: 9, dtS: 1 / 60 })).toBe(false);
    clock.length = 0;
    expect(debug.setFigureClip({ mannequin: 'linha:4', clip: 'start', frame: 9, dtS: 1 / 60 })).toBe(true);
    let resolved = false;
    const ready = debug.whenReady(1).then(() => void (resolved = true));
    platform.pump(10);
    await settle();
    expect(resolved).toBe(false);
    expect(debug.readyForPrint).toBe(false);
    platform.pump(40);
    await ready;
    const steps = clock.slice(1).map((t, i) => t - clock[i]!);
    const moving = steps.filter((d) => d > 0);
    expect(moving).toHaveLength(30 + 9);
    for (const d of moving) expect(d).toBeCloseTo(1 / 60, 9);
    const clipActor = actorsOf((a, i) => a.entity[i]! >>> 16 === 0xfffc);
    expect(clipActor).toHaveLength(1);
    const k = clipActor[0]! * 3;
    // Quadro 9 do arranque: já correndo a 6,8 m/s (aceleração de 60 m/s²), parado no lugar.
    expect(Math.hypot(buffer!.velocity[k]!, buffer!.velocity[k + 2]!)).toBeCloseTo(6.8, 6);
    expect(buffer!.kind[clipActor[0]!]).toBe(ACTOR_KIND.bobo);
    // Depois do clipe a cena fica parada (o relógio do render não anda mais).
    const end = clock.at(-1)!;
    platform.pump(5);
    expect(clock.at(-1)).toBe(end);
    expect(debug.setFigureClip(null)).toBe(true);
    game.dispose();
  }, 120_000);

  it('a tela de loading lista as etapas na ordem em que o loader roda (luz antes da malha)', async () => {
    const platform = createFakePlatform();
    let clock = 0;
    const host = {
      platform: { ...platform, now: () => (clock += 0.05) },
      renderer: createNullRenderer(),
      fonts: null,
      uiAtlas: null,
      log: () => {},
      settings: { current: DEFAULT_SETTINGS, save: () => {} },
      stats: { current: EMPTY_STATS, record: () => ({ mostKills: false, bestStreak: false }), tipSeen: () => {} },
      benchReport: () => {},
    };
    const loader = createConstrutoLoader(host);
    const seen: number[] = [];
    for (let i = 0; i < 20000; i++) {
      const done = loader.step(1);
      await settle();
      if (seen.at(-1) !== loader.model.current) seen.push(loader.model.current);
      if (done) break;
    }
    // O índice da etapa em andamento só cresce: nenhuma etapa "Na fila" fica acima da que está rodando.
    for (let i = 1; i < seen.length; i++) expect(seen[i]!).toBeGreaterThan(seen[i - 1]!);
    expect(seen.map((s) => LOADING_STEPS[s])).toEqual(expect.arrayContaining(['light', 'mesh']));
    // Leitura e decodificação dos assets separadas para o log do Teste Zero.
    const ad = loader.assetsDetail;
    expect(ad.files).toBeGreaterThan(10);
    expect(ad.readMs).toBeGreaterThan(0);
    expect(ad.readMs).toBeLessThanOrEqual(loader.times.assets);
    expect(ad.decodeMs).toBeGreaterThan(0);
  }, 120_000);

  it('itens de teste do título: a tela da casca abre, desenha e volta no voltar', async () => {
    let updates = 0;
    let disposed = 0;
    const item: TestItem = {
      id: 'audio',
      labelKey: 'test.audio',
      start: () => ({
        update: () => void updates++,
        describe: (out: TestScreenModel) => {
          out.titleKey = 'test.audio.title';
          out.lineCount = 0;
        },
        finished: false,
        dispose: () => void disposed++,
      }),
    };
    const { platform, game } = await bootToTitle('switch', { testItems: [item] });
    // No Switch o item fica na coluna de testes, à direita do menu.
    platform.tap('ArrowRight');
    platform.tap('Enter');
    expect(game.screen).toBe('test');
    platform.pump(3);
    expect(updates).toBeGreaterThan(0);
    platform.tap('Escape');
    expect(game.screen).toBe('title');
    expect(disposed).toBe(1);
    game.dispose();
  });

  it('no Switch o título tem "Sair", que chama platform.exit()', async () => {
    const { platform, game } = await bootToTitle('switch');
    // Convenção do Switch: o botão da direita confirma; no teclado do teste, Enter confirma do mesmo jeito.
    // JOGAR, Surpreenda-me, Mudar, Sair.
    platform.tap('ArrowDown');
    platform.tap('ArrowDown');
    platform.tap('ArrowDown');
    platform.tap('Enter');
    expect(platform.exits).toBe(1);
    game.dispose();
  });

  it('asset quebrado: tela de erro, onError e o laço para', async () => {
    const platform = createFakePlatform({ brokenAssets: true });
    const errors: unknown[] = [];
    const game = startGame({ platform, createRenderer: null, hooks: { onError: (e) => errors.push(e) } });
    platform.pump(2);
    await settle();
    platform.pump(2);
    expect(game.screen).toBe('error');
    expect(errors).toHaveLength(1);
    expect(platform.framesPending).toBe(0);
    game.dispose();
  });
});

describe('orçamento de skins do boneco (E.16, #56): 2 camadas por skin, 32 na reserva', () => {
  const MAP = decodeMap(readRuntimeAsset('maps/construto.bfmap'));
  const MANNEQUINS = MAP.markers.mannequins;
  let table: FigureGameTable | null = null;
  const tableOnce = (): FigureGameTable => (table ??= createFigureGameTable());
  const CAPACITY = SKIN_LAYER_RESERVE / FIGURE_SKIN_LAYERS;

  /** Receita do bench (TDM só de bots) com `views` jogadores locais e `bots` extras no perfil dado. */
  function benchRecipe(profileId: keyof typeof PLATFORM_PROFILES, views: 1 | 2 | 3 | 4, bots: number) {
    const bench: BenchConfig = { ...BENCH_DEFAULTS, views, bots, profile: profileId };
    const request: SceneRequest = {
      kind: 'bench',
      bench,
      benchWarnings: [],
      seed: 1,
      convention: undefined as unknown as SceneRequest['convention'],
      device: null,
      gamepad: 0,
    };
    const profile = profileFor('switch', views, bench);
    return { profile, recipe: sceneRecipe(request, profile).recipe };
  }

  /** Pinta o plano e devolve as escritas (1ª camada, bytes e texels opacos). */
  function paint(input: SceneFiguresInput) {
    const figures = createSceneFigures(input);
    const writes: { first: number; bytes: number; opaque: number }[] = [];
    figures.paintSkins((first, rgba) => {
      let opaque = 0;
      for (let i = 3; i < rgba.length; i += 4) if (rgba[i]! === 255) opaque++;
      writes.push({ first, bytes: rgba.length, opaque });
    }, 1000);
    return { figures, writes };
  }

  /** Conjunto efetivo (look e time) que uma skin veste. */
  function setOf(figures: SceneFigures, skin: number): FigureSkinSet | null {
    const k = figures.setSkins.indexOf(skin);
    return k >= 0 ? figures.plan.sets[k]! : null;
  }

  it('switch34p TDM com 16 bots + 4 jogadores locais: 10 skins (3 looks × 3 times + zumbi), 0 estouro', () => {
    const { profile, recipe } = benchRecipe('switch34p', 4, 16);
    expect(profile.id).toBe('switch34p');
    const { figures, writes } = paint({
      profile,
      teamCount: recipe.teams.length,
      mannequins: MANNEQUINS,
      prints: false,
      capacity: CAPACITY,
      onDemand: false,
      table: tableOnce(),
    });
    expect(CAPACITY).toBe(32);
    expect(writes).toHaveLength(10);
    expect(figures.plan.overflow).toEqual([]);
    expect(figures.cache!.stats).toMatchObject({ used: 10, composed: 10, overflows: 0 });
    // Skins seguidas na reserva, 2 camadas cada, pintadas (cabeça e tronco opacos).
    expect(writes.map((w) => w.first)).toEqual(Array.from({ length: 10 }, (_, i) => 1000 + i * FIGURE_SKIN_LAYERS));
    for (const w of writes) {
      expect(w.bytes).toBe(FIGURE_SKIN_BYTES);
      expect(w.opaque).toBeGreaterThan(1000);
    }
    // Cada controlador da receita veste a rotação no PRÓPRIO time.
    for (const slot of expandRecipe(recipe, 0)) {
      const p = slot.controller % figures.botLooks;
      const set = setOf(figures, figures.botSkin(p, slot.team));
      expect(set, `controlador ${slot.controller}`).toEqual({ look: FIGURE_BOT_ROTATION[p], team: slot.team });
    }
    expect(setOf(figures, figures.zombieSkin)).toEqual({ look: 'zombie', team: -1 });
    figures.dispose();
  });

  it('pc: 19 skins (6 looks × 3 times + zumbi); com o pedido de prints a fila inteira cabe (31)', () => {
    const { profile, recipe } = benchRecipe('pc', 1, 12);
    const base = {
      profile,
      teamCount: recipe.teams.length,
      mannequins: MANNEQUINS,
      capacity: CAPACITY,
      onDemand: false,
      table: tableOnce(),
    };
    const pc = paint({ ...base, prints: false });
    expect(pc.writes).toHaveLength(19);
    expect(pc.figures.plan.overflow).toEqual([]);
    pc.figures.dispose();
    const prints = paint({ ...base, prints: true });
    expect(prints.writes).toHaveLength(31);
    expect(prints.figures.plan.overflow).toEqual([]);
    prints.figures.dispose();
  });

  it('forçando 40 conjuntos: o excedente veste o look padrão do PRÓPRIO time e nenhum bobo veste outro time', () => {
    const rotation = Array.from({ length: 13 }, (_, k): readonly [string, FigureLook] => [
      `teste${k}`,
      normalizeFigureLook({ ...FIGURE_LOOK_DEFAULT, hairStyle: k + 2 }),
    ]);
    const { profile, recipe } = benchRecipe('switch34p', 4, 16);
    const { figures, writes } = paint({
      profile,
      teamCount: recipe.teams.length,
      mannequins: [],
      prints: false,
      capacity: CAPACITY,
      onDemand: false,
      table: tableOnce(),
      rotation,
    });
    // 13 looks × 3 times + zumbi = 40 pedidos; reserva de 32 = 29 conjuntos + o padrão de cada um dos 3 times.
    expect(writes).toHaveLength(32);
    expect(figures.cache!.stats.overflows).toBe(0);
    expect(figures.plan.overflow).toHaveLength(11);
    let defaults = 0;
    for (let p = 0; p < rotation.length; p++) {
      for (const team of [-1, 0, 1]) {
        const set = setOf(figures, figures.botSkin(p, team))!;
        expect(set.team, `look ${p} time ${team}`).toBe(team);
        const key = figureSetKey(rotation[p]![0], team);
        if (figures.plan.overflow.includes(key)) {
          expect(set.look).toBe(FIGURE_DEFAULT_LOOK);
          defaults++;
        } else {
          expect(set.look).toBe(rotation[p]![0]);
        }
      }
    }
    expect(defaults).toBe(11);
    // O zumbi vem primeiro no pedido: nunca estoura.
    expect(setOf(figures, figures.zombieSkin)).toEqual({ look: 'zombie', team: -1 });
    figures.dispose();
  });

  it('o plano é puro: dentro da reserva fica como pediu; reserva menor que os times lança', () => {
    const plan = planFigureSkins(
      [
        { look: 'a', team: 0 },
        { look: 'a', team: 0 },
        { look: 'b', team: 1 },
      ],
      2,
    );
    expect(plan.sets).toEqual([
      { look: 'a', team: 0 },
      { look: 'b', team: 1 },
    ]);
    expect(plan.overflow).toEqual([]);
    const many = [0, 1, 2].map((team) => ({ look: 'x', team }));
    expect(() => planFigureSkins([...many, { look: 'y', team: 0 }], 2)).toThrow(/não cabem/);
  });

  it('o cache solta o pintor no fim da partida (opção release do skin-cache)', () => {
    const { profile, recipe } = benchRecipe('switch34p', 4, 16);
    const { figures } = paint({
      profile,
      teamCount: recipe.teams.length,
      mannequins: [],
      prints: false,
      capacity: CAPACITY,
      onDemand: false,
      table: tableOnce(),
    });
    const cache = figures.cache!;
    figures.dispose();
    expect(figures.cache).toBeNull();
    expect(() => cache.acquire({ look: FIGURE_LOOK_DEFAULT, team: -1, teamColors: [] })).toThrow(/dispose/);
  });
});

describe('textos do game com o atlas real (#54)', () => {
  const fonts = parseFontPack(JSON.parse(new TextDecoder().decode(readRuntimeAsset('fonts/ui-fonts.json')))).fonts;

  interface Target {
    readonly name: string;
    readonly w: number;
    readonly h: number;
    readonly minTextPx: number;
    readonly minTarget: number;
  }
  const TARGETS: readonly Target[] = [
    { name: 'web 1280×720', w: 1280, h: 720, minTextPx: MIN_TEXT.phone, minTarget: 0 },
    { name: 'web 640×360', w: 640, h: 360, minTextPx: MIN_TEXT.phone, minTarget: 0 },
    { name: 'celular 1334×750', w: 1334, h: 750, minTextPx: MIN_TEXT.phone * 2, minTarget: MIN_TOUCH_TARGET * 2 },
    { name: 'web 1920×1080', w: 1920, h: 1080, minTextPx: MIN_TEXT.phone, minTarget: 0 },
    { name: 'web 4:3 1024×768', w: 1024, h: 768, minTextPx: MIN_TEXT.phone, minTarget: 0 },
    { name: 'Switch 1280×720', w: 1280, h: 720, minTextPx: MIN_TEXT.tv, minTarget: 0 },
  ];

  it('pausa: título e botões cabem (texto ≤ largura − 2·padX·escala) e o D-pad passa pelos 5 botões', () => {
    for (const t of TARGETS) {
      const layout = layoutTree(pauseScreen.build(null), { x: 0, y: 0, w: t.w, h: t.h }, 1, {
        fonts,
        minTextPx: t.minTextPx,
        minTarget: t.minTarget,
      });
      const c = layout.content;
      for (const node of layout.order) {
        const r = layout.rects.get(node)!;
        const text = layout.texts.get(node);
        if (!text) continue;
        expect(text.px, `${t.name}: ${text.text}`).toBeGreaterThanOrEqual(t.minTextPx);
        if (node.kind === 'button') {
          const room = r.w - 2 * BUTTON.padX * layout.scale;
          expect(text.width, `${t.name}: "${text.text}" em ${room.toFixed(1)} px`).toBeLessThanOrEqual(room);
          expect(text.height).toBeLessThanOrEqual(r.h);
          expect(r.h).toBeGreaterThanOrEqual(t.minTarget);
        } else {
          expect(r.x, t.name).toBeGreaterThanOrEqual(c.x - 0.5);
          expect(r.x + text.width, `${t.name}: "${text.text}"`).toBeLessThanOrEqual(c.x + c.w + 0.5);
        }
      }
      // M2 (fase 2e): Continuar · Ajustar desafio · Ajustes · Destravar · Sair.
      const order = ['resume', 'challenge', 'settings', 'unstuck', 'quit'];
      for (let i = 0; i + 1 < order.length; i++) {
        expect(moveFocus(layout, order[i]!, 'down'), t.name).toBe(order[i + 1]);
        expect(moveFocus(layout, order[i + 1]!, 'up'), t.name).toBe(order[i]);
      }
    }
  });

  it('texto do bench na tela e rótulos dos botões de toque cabem (sem "?" nem estouro)', () => {
    const hud = fonts.hud;
    const glyphs = new Set<number>();
    for (let i = 0; i < hud.glyphData.length; i += 8) glyphs.add(hud.glyphData[i]!);
    // Bench: Switch (piso da TV) e web (piso do celular), como o `drawBenchStatus` desenha.
    const benchTexts = [
      ['test.bench.warmup', 'test.bench.running', 'test.bench.done', 'test.bench.hint'],
      ['test.bench.warmup', 'test.bench.running', 'bench.webDone'],
    ] as const;
    for (const [i, t] of [TARGETS[5]!, TARGETS[1]!].entries()) {
      const px = Math.max(Math.round(16 * uiScale(t.w, t.h)), t.minTextPx);
      for (const key of benchTexts[i]!) {
        const text = STRINGS_PT_BR[key];
        for (const ch of text) expect(glyphs.has(ch.charCodeAt(0)), `${key}: ${ch}`).toBe(true);
        expect(measureText(hud, text, px, 0.04) + px, `${t.name}: ${key}`).toBeLessThanOrEqual(t.w);
      }
    }
    // Toque: o rótulo em caixa alta cabe na corda do círculo à meia altura de maiúscula (DPR 1 e 2).
    const rect: TouchButtonRect = { control: 'fire', x: 0, y: 0, radius: 0 };
    for (const dpr of [1, 2]) {
      const labelPx = Math.max(13 * dpr, MIN_TEXT.phone * dpr * 0.75);
      for (let b = 0; b < DEFAULT_TOUCH_LAYOUT.buttons.length; b++) {
        const { control, radius } = placeTouchButton(DEFAULT_TOUCH_LAYOUT, b, 667 * dpr, 375 * dpr, dpr, rect);
        const label = STRINGS_PT_BR[`touch.${control}` as StringKey].toUpperCase();
        const half = (hud.capHeight * labelPx) / hud.size / 2;
        const chord = 2 * Math.sqrt(radius * radius - half * half);
        expect(measureText(hud, label, labelPx, 0.04), `DPR ${dpr}: ${label}`).toBeLessThanOrEqual(chord);
      }
    }
  });
});

describe('assets do boot', () => {
  it('a tabela runtime-assets cobre os caminhos lógicos do jogo e o preload é subconjunto', () => {
    for (const path of Object.values(GAME_ASSETS)) expect(RUNTIME.files[path], path).toBeTypeOf('string');
    for (const path of RUNTIME.preload) expect(RUNTIME.files[path], path).toBeTypeOf('string');
  });

  it('decodifica o atlas da UI', async () => {
    const assets = await loadGameAssets({
      loadBytes: async (p) => readRuntimeAsset(p),
      loadText: async (p) => new TextDecoder().decode(readRuntimeAsset(p)),
    });
    expect(assets.uiAtlas.pixels.length).toBe(assets.uiAtlas.width * assets.uiAtlas.height * assets.uiAtlas.layers * 4);
  });
});

describe('ganchos de print e fallback do boneco (revisão do passo 5, #56)', () => {
  const MAP = decodeMap(readRuntimeAsset('maps/construto.bfmap'));
  const table = createFigureGameTable();

  async function benchWithActors(prints: boolean) {
    let buffer: ActorBuffer | null = null;
    const createRenderer: GameDeps['createRenderer'] = () => {
      const r = createNullRenderer();
      r.setActors = (a) => void (buffer = a);
      return r;
    };
    const platform = createFakePlatform();
    const bench: BenchConfig = { ...BENCH_DEFAULTS, views: 1, bots: 2, durationS: 600, warmupS: 0, prints };
    const game = startGame({ platform, createRenderer, loadScene, bench });
    platform.pump(2);
    await settle();
    await untilRunning(platform, game);
    return { platform, game, actors: () => buffer! as ActorBuffer };
  }

  it('look fora do plano e sem vaga veste o recruta do time, nunca o zumbi', () => {
    for (const [profile, prints, onDemand] of [
      [PLATFORM_PROFILES.switch34p, false, false],
      [PLATFORM_PROFILES.pc, true, true],
    ] as const) {
      const f = createSceneFigures({
        profile,
        teamCount: 2,
        mannequins: MAP.markers.mannequins,
        prints,
        capacity: SKIN_LAYER_RESERVE / FIGURE_SKIN_LAYERS,
        onDemand,
        table,
      });
      f.paintSkins(() => {}, 1000);
      for (const team of [-1, 0, 1]) {
        // Duas aparências fora do plano seguidas: com prints a 1ª pega a última vaga e a 2ª cai no fallback.
        for (const id of ['sardento', 'bandana'] as const) {
          const slot = f.resolve(id, FIGURE_PRESETS[id], team);
          expect(slot).not.toBeNull();
          expect(slot!.look).not.toBe('zombie');
          if (slot!.team !== team) expect(slot!.team).toBe(-1);
        }
      }
      f.dispose();
    }
  });

  it('setMannequins recusa pose, arma, time e números inválidos sem mudar nada', async () => {
    const { platform, game } = await benchWithActors(false);
    const debug = game.debug!;
    debug.setFrozen(true);
    debug.setCamera('print:altura');
    const bad = [
      { name: 'altura:em-pe', pose: 'voando' as 'stand' },
      { name: 'altura:em-pe', weapon: 'bazuca' },
      { name: 'altura:em-pe', team: 7 },
      { name: 'altura:em-pe', turnDeg: Number.NaN },
      { name: 'altura:em-pe', pitch: Number.POSITIVE_INFINITY },
      { name: 'altura:em-pe', expression: 9 },
    ];
    for (const o of bad) expect(debug.setMannequins([o])).toBe(false);
    expect(debug.setMannequins([{ name: 'altura:em-pe', pose: 'crouch', weapon: 'rifle', team: 0 }])).toBe(true);
    platform.pump(1);
    game.dispose();
  }, 60_000);

  it('clipe de andar nas 3 câmeras da fila: a velocidade vai para a frente do corpo', async () => {
    const { platform, game, actors } = await benchWithActors(true);
    const debug = game.debug!;
    debug.setFrozen(true);
    for (const camera of ['print:linha-frente', 'print:linha-3-4', 'print:linha-costas'] as const) {
      debug.setCamera(camera);
      expect(
        debug.setMannequins([
          { name: 'linha:4', look: 'skin:classico', team: 0, pose: 'stand', weapon: 'rifle', pitch: 0 },
        ]),
      ).toBe(true);
      expect(debug.setFigureClip({ mannequin: 'linha:4', clip: 'walk', frame: 30, dtS: 1 / 60 })).toBe(true);
      for (let i = 0; i < 80 && !debug.readyForPrint; i++) {
        platform.pump(1);
        await settle();
      }
      const a = actors();
      let k = -1;
      for (let i = 0; i < a.count; i++) if (a.entity[i]! >>> 16 === 0xfffc) k = i;
      expect(k, camera).toBeGreaterThanOrEqual(0);
      const yaw = a.yaw[k]!;
      const vx = a.velocity[k * 3]!;
      const vz = a.velocity[k * 3 + 2]!;
      // As contas do rig: frente = (−sen yaw, −cos yaw); direita = (cos yaw, −sen yaw).
      const forward = -vx * Math.sin(yaw) - vz * Math.cos(yaw);
      const side = vx * Math.cos(yaw) - vz * Math.sin(yaw);
      expect(forward, camera).toBeGreaterThan(0.5);
      expect(Math.abs(Math.atan2(side, forward)), camera).toBeLessThan(0.02);
    }
    game.dispose();
  }, 120_000);
});

describe('LocalDriver', () => {
  it('sem humanos é a mesma partida do headless (mesmo hash no mesmo tick)', () => {
    const recipe: MatchRecipe = {
      format: MATCH_RECIPE_FORMAT,
      mode: 'warfare.tdm',
      map: 'test-arena',
      seed: 7,
      teams: [
        { bots: [{ ref: builtinBotRef('normal'), count: 2 }] },
        { bots: [{ ref: builtinBotRef('normal'), count: 2 }] },
      ],
    };
    const driver = createLocalDriver({ recipe, map: buildTestArena(), humans: 0, writeHumanFrame: () => {} });
    for (let i = 0; i < 600; i++) driver.update(1 / 60);
    const ticks = driver.sim.tick;
    expect(ticks).toBeGreaterThan(590);
    const headless = createHeadlessMatch({ recipe, map: buildTestArena(), humans: 0 });
    headless.run(ticks);
    expect(hashToHex(driver.sim.stateHash())).toBe(hashToHex(headless.sim.stateHash()));
    // Frame longo (volta do HOME): no máximo 4 ticks.
    expect(driver.update(5)).toBe(4);
    driver.dispose();
    headless.dispose();
  });
});

describe('câmera', () => {
  const deg = (r: number): number => (r * 180) / Math.PI;
  it('Hor+: vertical fixo em 16:9, horizontal limitado a 110° (32:9) e a 80° no estreito', () => {
    expect(deg(verticalFov(90, 16 / 9))).toBeCloseTo(58.72, 1);
    expect(deg(verticalFov(90, 21 / 9))).toBeCloseTo(58.72, 1);
    const wide = verticalFov(90, 32 / 9);
    expect(deg(2 * Math.atan(Math.tan(wide / 2) * (32 / 9)))).toBeCloseTo(110, 3);
    const narrow = verticalFov(90, 8 / 9);
    expect(deg(2 * Math.atan(Math.tan(narrow / 2) * (8 / 9)))).toBeCloseTo(80, 3);
  });
});

describe('textos', () => {
  it('todo código de ISSUE_CODES (format) tem texto issue.<código> na tabela pt-BR', () => {
    const keys = Object.keys(STRINGS_PT_BR);
    for (const code of ISSUE_CODES) expect(keys, code).toContain(`issue.${code}`);
  });
});

describe('título, menu principal e Surpreenda-me (M2, fase 4c)', () => {
  it('Mudar abre o menu principal; Ajustes e Voltar andam pelas telas', async () => {
    const { platform, game } = await bootToTitle();
    platform.tap('ArrowDown');
    platform.tap('ArrowDown');
    platform.tap('Enter');
    expect(game.screen).toBe('main');
    // Partida Rápida, Modos, Laboratório, Ajustes.
    for (let i = 0; i < 3; i++) platform.tap('ArrowDown');
    platform.tap('Enter');
    expect(game.screen).toBe('settings');
    platform.tap('Escape');
    expect(game.screen).toBe('main');
    platform.tap('Escape');
    expect(game.screen).toBe('title');
    game.dispose();
  });

  it('Surpreenda-me sorteia, Jogar começa a partida sorteada e o JOGAR seguinte repete o mesmo preset', async () => {
    const { platform, game } = await bootToTitle();
    platform.tap('ArrowDown');
    platform.tap('Enter');
    expect(game.screen).toBe('surprise');
    // Rolar de novo (à direita de Jogar) fica na tela; Jogar começa a partida.
    platform.tap('ArrowRight');
    platform.tap('Enter');
    expect(game.screen).toBe('surprise');
    platform.tap('ArrowLeft');
    platform.tap('Enter');
    expect(game.screen).toBe('scene');
    await untilRunning(platform, game);
    const rolled = game.save.presets.recent[0]!;
    const bots = rolled.teams.reduce((n, team) => n + team.bots.reduce((m, b) => m + b.count, 0), 0);
    expect(game.match!.director.botCount).toBe(bots);
    // Sai pela pausa (P, 4 × baixo, Sair) e joga de novo pelo JOGAR: o mesmo jeito de partida.
    platform.tap('KeyP');
    for (let i = 0; i < 4; i++) platform.tap('ArrowDown');
    platform.tap('Enter');
    expect(game.screen).toBe('title');
    platform.tap('Enter');
    await untilRunning(platform, game);
    expect(game.match!.director.botCount).toBe(bots);
    expect(game.save.presets.recent).toHaveLength(1);
    game.dispose();
  }, 120_000);
});

describe('Partida Rápida e Modos (M2, fase 4d)', () => {
  it('mudar os bots e COMEÇAR joga o tamanho escolhido, que vira o último preset', async () => {
    const { platform, game } = await bootToTitle();
    // Título → Mudar → Partida Rápida (o foco abre no COMEÇAR).
    platform.tap('ArrowDown');
    platform.tap('ArrowDown');
    platform.tap('Enter');
    platform.tap('Enter');
    expect(game.screen).toBe('quick');
    // COMEÇAR fica no canto: esquerda (Mais regras), esquerda (Voltar), esquerda (Duração), cima (Bots), direita (5
    // contra 5); de volta: baixo (Duração), baixo (a fileira do canto) e direita até o COMEÇAR.
    for (let i = 0; i < 3; i++) platform.tap('ArrowLeft');
    platform.tap('ArrowUp');
    platform.tap('ArrowRight');
    platform.tap('ArrowDown');
    platform.tap('ArrowDown');
    for (let i = 0; i < 3; i++) platform.tap('ArrowRight');
    platform.tap('Enter');
    expect(game.screen).toBe('scene');
    await untilRunning(platform, game);
    expect(game.match!.director.botCount).toBe(9);
    platform.tap('KeyP');
    for (let i = 0; i < 4; i++) platform.tap('ArrowDown');
    platform.tap('Enter');
    expect(game.screen).toBe('title');
    expect(game.save.presets.recent[0]!.teams[1]!.bots[0]!.count).toBe(5);
    game.dispose();
  }, 120_000);
});

describe('Partida personalizada (M2, fase 4e)', () => {
  it('Mais regras → aba Jogadores → Vida 150 → COMEÇAR; no resultado, Salvar preset e Mudar regras', async () => {
    const { platform, game } = await bootToTitle();
    // Título → Mudar → Partida Rápida → Mais regras (à esquerda do COMEÇAR).
    platform.tap('ArrowDown');
    platform.tap('ArrowDown');
    platform.tap('Enter');
    platform.tap('Enter');
    platform.tap('ArrowLeft');
    platform.tap('Enter');
    expect(game.screen).toBe('custom');
    // E (próxima aba): Jogadores (6 linhas desde a fase 6a: Movimento em cima). Do COMEÇAR: esquerda (Salvar), esquerda
    // (Voltar), esquerda (uma linha); cima até a aba e baixo 2 (Movimento, Vida); direita: 150. De volta: baixo 5 vezes
    // (até o Voltar) e direita 2 (COMEÇAR).
    platform.tap('KeyE');
    for (let k = 0; k < 3; k++) platform.tap('ArrowLeft');
    for (let k = 0; k < 8; k++) platform.tap('ArrowUp');
    for (let k = 0; k < 2; k++) platform.tap('ArrowDown');
    platform.tap('ArrowRight');
    for (let k = 0; k < 5; k++) platform.tap('ArrowDown');
    for (let k = 0; k < 2; k++) platform.tap('ArrowRight');
    platform.tap('Enter');
    expect(game.screen).toBe('scene');
    await untilRunning(platform, game);
    const sim = game.match!.sim;
    expect(sim.view().health[entityIndex(sim.controllerEntity(0))]).toBe(150);
    // Resultado (o gancho dos prints abre no meio): baixo (Mudar regras), direita (Salvar preset).
    game.debug!.showResult();
    platform.pump(2);
    // O resultado dos prints não grava estatística (M2, fase 4g).
    expect(game.save.stats.totals.matches).toBe(0);
    platform.tap('ArrowDown');
    platform.tap('ArrowRight');
    platform.tap('Enter');
    expect(game.save.presets.saved.map((p) => p.players?.hp)).toEqual([150]);
    platform.tap('ArrowLeft');
    platform.tap('Enter');
    expect(game.screen).toBe('custom');
    game.dispose();
  }, 120_000);
});

describe('Ajustes (M2, fase 4f)', () => {
  it('menu: Ajustes → Vídeo (E) → Tamanho dos menus; na pausa, Acessibilidade → Reduzir tremor vale na hora', async () => {
    const { platform, game } = await bootToTitle();
    // Título → Mudar → Ajustes (Partida Rápida, Modos, Laboratório, Ajustes).
    platform.tap('ArrowDown');
    platform.tap('ArrowDown');
    platform.tap('Enter');
    for (let i = 0; i < 3; i++) platform.tap('ArrowDown');
    platform.tap('Enter');
    expect(game.screen).toBe('settings');
    // E E: Vídeo. Da aba (o foco vai junto) desce para a 2ª linha (Tamanho dos menus) e anda um para a direita.
    platform.tap('KeyE');
    platform.tap('KeyE');
    platform.tap('ArrowDown');
    platform.tap('ArrowDown');
    platform.tap('ArrowRight');
    expect(game.save.settings.video.uiScale).toBe(1.1);
    // Q: Botões. Desce até "Andar: frente" (depois do dispositivo), confirma e aperta o I.
    platform.tap('KeyQ');
    platform.tap('ArrowDown');
    platform.tap('ArrowDown');
    platform.tap('Enter');
    platform.tap('KeyI');
    expect(game.save.settings.controls.keyboardMouse.bindings).toEqual({ forward: ['key:KeyI'] });
    // De novo, mas o Esc cancela (e não sai dos Ajustes).
    platform.tap('Enter');
    platform.tap('Escape');
    expect(game.screen).toBe('settings');
    expect(game.save.settings.controls.keyboardMouse.bindings).toEqual({ forward: ['key:KeyI'] });
    platform.tap('Escape');
    platform.tap('Escape');
    expect(game.screen).toBe('title');
    // Na partida (o foco do título ficou no Mudar: sobe até o JOGAR): P, Ajustes (2 abaixo), E E E
    // (Acessibilidade), baixo, confirmar: Reduzir tremor ligado.
    platform.tap('ArrowUp');
    platform.tap('ArrowUp');
    platform.tap('Enter');
    await untilRunning(platform, game);
    platform.tap('KeyP');
    platform.tap('ArrowDown');
    platform.tap('ArrowDown');
    platform.tap('Enter');
    platform.tap('KeyE');
    platform.tap('KeyE');
    platform.tap('KeyE');
    platform.tap('ArrowDown');
    platform.tap('Enter');
    expect(game.save.settings.accessibility.reduceShake).toBe(true);
    // Q Q: Botões; "Pular" (dispositivo, 4 de andar, atirar, mirar, pular) vira J na hora; o P (da pausa) é recusado.
    platform.tap('KeyQ');
    platform.tap('KeyQ');
    for (let i = 0; i < 8; i++) platform.tap('ArrowDown');
    platform.tap('Enter');
    platform.tap('KeyP');
    expect(game.save.settings.controls.keyboardMouse.bindings).toEqual({ forward: ['key:KeyI'] });
    platform.tap('Enter');
    platform.tap('KeyJ');
    expect(game.save.settings.controls.keyboardMouse.bindings).toEqual({ forward: ['key:KeyI'], jump: ['key:KeyJ'] });
    game.dispose();
  }, 120_000);
});

describe('Novidades (M2, fase 4g)', () => {
  it('quem já jogava vê a Novidades uma vez antes do título; o menu principal abre de novo', async () => {
    const stats = { ...EMPTY_STATS, totals: { ...EMPTY_STATS.totals, matches: 3 } };
    const { platform, game } = await bootToTitle('web', {}, { stats: JSON.stringify(stats) });
    expect(game.screen).toBe('news');
    platform.tap('Enter');
    expect(game.screen).toBe('title');
    expect(game.save.stats.onboarding.seenNews).toBe(GAME_VERSION);
    // Título → Mudar → Novidades (o 5º item) → OK volta ao menu principal.
    platform.tap('ArrowDown');
    platform.tap('ArrowDown');
    platform.tap('Enter');
    for (let i = 0; i < 4; i++) platform.tap('ArrowDown');
    platform.tap('Enter');
    expect(game.screen).toBe('news');
    platform.tap('Escape');
    expect(game.screen).toBe('main');
    game.dispose();
  }, 60_000);

  it('instalação nova: direto no título, com a versão marcada como vista', async () => {
    const { game } = await bootToTitle();
    expect(game.screen).toBe('title');
    expect(game.save.stats.onboarding.seenNews).toBe(GAME_VERSION);
    game.dispose();
  }, 60_000);
});

describe('Oficina (M2, fase 5a)', () => {
  it('Laboratório abre a Oficina; duplicar um de fábrica salva, favoritar e apagar (com confirmação)', async () => {
    const { platform, game } = await bootToTitle();
    // Título → Mudar → Laboratório (o 3º item).
    platform.tap('ArrowDown');
    platform.tap('ArrowDown');
    platform.tap('Enter');
    platform.tap('ArrowDown');
    platform.tap('ArrowDown');
    platform.tap('Enter');
    expect(game.screen).toBe('workshop');
    // O foco começa no escolhido (o Vibe Bob, primeiro de fábrica). Desce 5 (Jorge the Immortal) e escolhe.
    for (let i = 0; i < 5; i++) platform.tap('ArrowDown');
    platform.tap('Enter');
    // Direita: a primeira ação do card (Editar); direita de novo: Duplicar.
    platform.tap('ArrowRight');
    platform.tap('ArrowRight');
    platform.tap('Enter');
    expect(game.save.bots.map((b) => b.name)).toEqual(['Jorge the Immortal 2']);
    expect(game.save.bots[0]!.rules.hp).toBe(500);
    const id = game.save.bots[0]!.id;
    expect(id).toMatch(/^[0-9a-f]{6}$/);
    // O foco foi para a cópia na lista; direita (Editar), baixo (Favoritar), confirmar.
    platform.tap('ArrowRight');
    platform.tap('ArrowDown');
    platform.tap('Enter');
    expect(game.save.presets.botFavorites).toEqual([id]);
    // Apagar (à direita): o primeiro aperto só pede confirmação.
    platform.tap('ArrowRight');
    platform.tap('Enter');
    expect(game.save.bots).toHaveLength(1);
    platform.tap('Enter');
    expect(game.save.bots).toHaveLength(0);
    expect(game.save.presets.botFavorites).toEqual([]);
    platform.tap('Escape');
    expect(game.screen).toBe('main');
    game.dispose();
  }, 60_000);
});

describe('Laboratório (M2, fase 5b)', () => {
  it('Editar um de fábrica abre uma cópia; mudar a vida, rolar o nome e salvar; Voltar com mudança pede confirmação', async () => {
    const { platform, game } = await bootToTitle();
    // Título → Mudar → Laboratório → Jorge (6º de fábrica) → direita (Editar).
    platform.tap('ArrowDown');
    platform.tap('ArrowDown');
    platform.tap('Enter');
    platform.tap('ArrowDown');
    platform.tap('ArrowDown');
    platform.tap('Enter');
    for (let i = 0; i < 5; i++) platform.tap('ArrowDown');
    platform.tap('Enter');
    platform.tap('ArrowRight');
    platform.tap('Enter');
    expect(game.screen).toBe('lab');
    // E ×3: Regras; baixo (Vida) e direita: 500 → 750.
    for (let i = 0; i < 3; i++) platform.tap('KeyE');
    platform.tap('ArrowDown');
    platform.tap('ArrowRight');
    // E: Nome; baixo ×2 (Rolar nome) e confirmar.
    platform.tap('KeyE');
    platform.tap('ArrowDown');
    platform.tap('ArrowDown');
    platform.tap('Enter');
    // Baixo cai na fileira do canto (Voltar); direita duas vezes (Testar, Salvar).
    platform.tap('ArrowDown');
    platform.tap('ArrowRight');
    platform.tap('ArrowRight');
    platform.tap('Enter');
    expect(game.screen).toBe('workshop');
    expect(game.save.bots).toHaveLength(1);
    const bot = game.save.bots[0]!;
    expect(bot.rules.hp).toBe(750);
    expect(bot.name).not.toBe('Jorge the Immortal 2');
    expect(bot.name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
    // O salvo fica escolhido (foco nele): direita (Editar), confirmar; muda o nível e tenta voltar.
    platform.tap('ArrowRight');
    platform.tap('Enter');
    expect(game.screen).toBe('lab');
    platform.tap('ArrowDown');
    platform.tap('ArrowRight');
    platform.tap('Escape');
    expect(game.screen).toBe('lab');
    platform.tap('Escape');
    expect(game.screen).toBe('workshop');
    expect(game.save.bots[0]).toEqual(bot);
    game.dispose();
  }, 60_000);
});

describe('Ringue (M2, fase 5c)', () => {
  it('JOGAR com um preset no Ringue carrega o mapa e a partida roda (X1)', async () => {
    const { platform, game } = await bootToTitle();
    game.save.pushRecent({
      ...DEBUT_PRESET,
      map: 'ringue',
      teams: [{ humans: 'all', bots: [] }, { bots: [{ ref: builtinBotRef('chill'), count: 1 }] }],
    });
    platform.tap('Enter');
    await untilRunning(platform, game);
    expect(platform.logLines.some((l) => l.includes('[cena] ringue (play)'))).toBe(true);
    const sim = game.match!.sim;
    platform.pump(120);
    // O jogador nasce no oeste (x < 12), dentro da área jogável do Ringue.
    const e = entityIndex(sim.controllerEntity(0));
    const x = sim.view().position[e * 3]!;
    expect(x).toBeGreaterThan(6);
    expect(x).toBeLessThan(42);
    game.dispose();
  }, 120_000);
});

describe('Bobo Training (M2, fase 5d)', () => {
  it('Modos → Bobo Training: Ringue sem placar, alvos espalhados que não atacam e a linha dos números', async () => {
    const { platform, game } = await bootToTitle();
    // Título → Mudar → Modos (2º item) → o card de baixo (Bobo Training).
    platform.tap('ArrowDown');
    platform.tap('ArrowDown');
    platform.tap('Enter');
    platform.tap('ArrowDown');
    platform.tap('Enter');
    expect(game.screen).toBe('modes');
    platform.tap('ArrowDown');
    platform.tap('Enter');
    await untilRunning(platform, game);
    expect(platform.logLines.some((l) => l.includes('[cena] ringue (play)'))).toBe(true);
    // 10 s de jogo: ninguém atira no jogador (os alvos não atacam) e nenhum nasce atrás do abrigo leste.
    platform.pump(600, 1000 / 60);
    const sim = game.match!.sim;
    const v = sim.view();
    const me = entityIndex(sim.controllerEntity(0));
    expect(v.health[me]).toBe(100);
    let bots = 0;
    for (let i = 0; i < v.count; i++) {
      if (i === me || v.alive[i] !== 1 || v.kind[i] !== ENTITY_KIND.bobo) continue;
      bots++;
      // Atrás do abrigo leste (x além de 37,5 m, z entre 15 e 33 m) ninguém veria o alvo.
      const x = v.position[i * 3]!;
      const z = v.position[i * 3 + 2]!;
      expect(x > 37.5 && z > 15 && z < 33, `bot ${i} em (${x}, ${z})`).toBe(false);
    }
    expect(bots).toBe(4);
    expect(v.match.phase).not.toBe('ended');
    game.dispose();
  }, 120_000);
});

describe('Pontes do Laboratório (M2, fase 5e)', () => {
  it('Testar abre o Bobo Training com o bot (sem salvar) e Sair volta ao Laboratório', async () => {
    const { platform, game } = await bootToTitle();
    // Título → Mudar → Laboratório → Jorge (6º de fábrica) → Editar.
    platform.tap('ArrowDown');
    platform.tap('ArrowDown');
    platform.tap('Enter');
    platform.tap('ArrowDown');
    platform.tap('ArrowDown');
    platform.tap('Enter');
    for (let i = 0; i < 5; i++) platform.tap('ArrowDown');
    platform.tap('Enter');
    platform.tap('ArrowRight');
    platform.tap('Enter');
    expect(game.screen).toBe('lab');
    // Da aba (o foco inicial), baixo cai na 1ª linha; mais baixo, no Voltar (o da esquerda do canto); direita: Testar.
    for (let i = 0; i < 20; i++) platform.tap('ArrowDown');
    platform.tap('ArrowRight');
    platform.tap('Enter');
    expect(game.screen).toBe('scene');
    await untilRunning(platform, game);
    const sim = game.match!.sim;
    // Você, os 4 alvos e o bot testado (embutido).
    platform.pump(30);
    let bobos = 0;
    for (let i = 0; i < sim.view().count; i++) if (sim.view().kind[i] === ENTITY_KIND.bobo) bobos++;
    expect(bobos).toBe(6);
    // Pausa → Sair (o último item).
    platform.tap('KeyP');
    for (let i = 0; i < 4; i++) platform.tap('ArrowDown');
    platform.tap('Enter');
    expect(game.screen).toBe('lab');
    expect(game.save.bots).toHaveLength(0);
    game.dispose();
  }, 120_000);
});

describe('Conheça o Laboratório (M2, fase 5e)', () => {
  it('sair da partida com 1 terminada mostra o card uma vez; Agora não volta ao título e não mostra de novo', async () => {
    const stats = {
      ...EMPTY_STATS,
      totals: { ...EMPTY_STATS.totals, matches: 1 },
      onboarding: { tipsSeen: [], seenNews: GAME_VERSION },
    };
    const { platform, game } = await bootToTitle('web', {}, { stats: JSON.stringify(stats) });
    expect(game.screen).toBe('title');
    const quitMatch = async (): Promise<void> => {
      platform.tap('Enter');
      await untilRunning(platform, game);
      platform.tap('KeyP');
      for (let i = 0; i < 4; i++) platform.tap('ArrowDown');
      platform.tap('Enter');
    };
    await quitMatch();
    expect(game.screen).toBe('labIntro');
    expect(game.save.stats.onboarding.tipsSeen).toContain('labCard');
    // Agora não (o 3º botão).
    platform.tap('ArrowRight');
    platform.tap('ArrowRight');
    platform.tap('Enter');
    expect(game.screen).toBe('title');
    await quitMatch();
    expect(game.screen).toBe('title');
    game.dispose();
  }, 120_000);
});

describe('Calibrar mira (M2, fase 5f)', () => {
  it('Ajustes → Controles → Calibrar mira abre o treino calibrando; a pausa oferece Pular calibração', async () => {
    const { platform, game } = await bootToTitle();
    // Título → Mudar → Ajustes (4º) → baixo ×10 (dispositivo e as 8 linhas do teclado, depois a ação) → confirmar.
    platform.tap('ArrowDown');
    platform.tap('ArrowDown');
    platform.tap('Enter');
    for (let i = 0; i < 3; i++) platform.tap('ArrowDown');
    platform.tap('Enter');
    expect(game.screen).toBe('settings');
    for (let i = 0; i < 10; i++) platform.tap('ArrowDown');
    platform.tap('Enter');
    expect(game.screen).toBe('scene');
    await untilRunning(platform, game);
    // A contagem (3 s) e o começo da calibração.
    platform.pump(240);
    expect(platform.logLines.some((l) => l.includes('[partida] calibrar mira: começou'))).toBe(true);
    // Pausa → o 2º item (Pular calibração).
    platform.tap('KeyP');
    platform.tap('ArrowDown');
    platform.tap('Enter');
    expect(platform.logLines.some((l) => l.includes('[partida] calibrar mira: pulou'))).toBe(true);
    expect(game.scene?.paused).toBe(false);
    game.dispose();
  }, 120_000);
});
