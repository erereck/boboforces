import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHeadlessMatch } from '@boboforces/ai';
import { builtinBotRef, ISSUE_CODES, MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import { createRawInputState, keyIndex, type RawInputState } from '@boboforces/input';
import type { Platform, PlatformId } from '@boboforces/platform-api';
import { hashToHex } from '@boboforces/shared';
import { entityIndex, ENTITY_FLAG } from '@boboforces/sim';
import { STRINGS_PT_BR } from '@boboforces/ui';
import { buildTestArena } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { GAME_ASSETS, loadGameAssets, parseBlockManifest } from './assets.ts';
import { verticalFov } from './camera.ts';
import { MENU_READY_MARKER, startGame } from './game.ts';
import { createLocalDriver } from './local-driver.ts';
import { createRenderBlocks, TEST_BLOCK_TEXTURES } from './world.ts';

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

function createFakePlatform(opts: { id?: PlatformId; brokenAssets?: boolean } = {}): FakePlatform {
  const noop = (): (() => void) => () => {};
  const store = new Map<string, string>();
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

/** Deixa as promessas do carregamento (assets) andarem. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

async function bootToTitle(id: PlatformId = 'web') {
  const platform = createFakePlatform({ id });
  const events: string[] = [];
  const game = startGame({
    platform,
    createRenderer: null,
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

describe('startGame (NullRenderer)', () => {
  it('carrega os assets, chega ao título e grava o marcador do menu uma vez', async () => {
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

  it('Enter no JOGAR entra na cena de teste: o jogador e 4 bots andam e o pointer lock é pedido', async () => {
    const { platform, game, events } = await bootToTitle();
    platform.tap('Enter');
    expect(game.screen).toBe('scene');
    expect(events).toContain('lock');
    const match = game.match!;
    const sim = match.sim;
    const view = sim.view();
    const bots = [4, 5, 6, 7].map((c) => entityIndex(sim.controllerEntity(c)));
    const start = bots.map((e) => [view.position[e * 3]!, view.position[e * 3 + 2]!] as const);
    const tick0 = sim.tick;
    // Anda para a frente segurando W por 2 s.
    platform.rawNext.keys[keyIndex('KeyW')] = 1;
    platform.pump(120);
    platform.rawNext.keys[keyIndex('KeyW')] = 0;
    expect(sim.tick - tick0).toBeGreaterThanOrEqual(115);
    const moved = bots.filter((e, i) => {
      const [x, z] = start[i]!;
      return Math.hypot(view.position[e * 3]! - x, view.position[e * 3 + 2]! - z) > 1;
    });
    expect(moved.length).toBeGreaterThanOrEqual(3);
    const me = entityIndex(game.scene!.playerEntity);
    expect(view.flags[me]! & ENTITY_FLAG.dead).toBe(0);
    game.dispose();
  });

  it('pausa pelo ciclo de vida congela a sim; Enter continua; P + baixo + Enter volta ao título', async () => {
    const { platform, game, events } = await bootToTitle();
    platform.tap('Enter');
    const sim = game.match!.sim;
    platform.pump(10);
    platform.firePause();
    expect(game.paused).toBe(true);
    platform.pump(1);
    expect(events.at(-1)).toBe('unlock');
    const frozen = sim.tick;
    platform.pump(60);
    expect(sim.tick).toBe(frozen);
    platform.tap('Enter');
    expect(game.paused).toBe(false);
    platform.pump(10);
    expect(sim.tick).toBeGreaterThan(frozen);

    platform.tap('KeyP');
    expect(game.paused).toBe(true);
    platform.tap('ArrowDown');
    platform.tap('Enter');
    expect(game.screen).toBe('title');
    expect(game.scene).toBeNull();
    expect(events.at(-1)).toBe('unlock');
    game.dispose();
  });

  it('no Switch o título tem "Sair", que chama platform.exit()', async () => {
    const { platform, game } = await bootToTitle('switch');
    // Convenção do Switch: o botão da direita confirma; no teclado do teste, Enter confirma do mesmo jeito.
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

describe('assets do M0', () => {
  it('a tabela runtime-assets cobre os caminhos lógicos do jogo e o preload é subconjunto', () => {
    for (const path of Object.values(GAME_ASSETS)) expect(RUNTIME.files[path], path).toBeTypeOf('string');
    for (const path of RUNTIME.preload) expect(RUNTIME.files[path], path).toBeTypeOf('string');
  });

  it('decodifica atlas e blocos e monta as faces pelo nome da camada', async () => {
    const assets = await loadGameAssets({
      loadBytes: async (p) => readRuntimeAsset(p),
      loadText: async (p) => new TextDecoder().decode(readRuntimeAsset(p)),
    });
    expect(assets.uiAtlas.pixels.length).toBe(assets.uiAtlas.width * assets.uiAtlas.height * assets.uiAtlas.layers * 4);
    expect(assets.blockTextures.layers).toBe(assets.blockLayers.size);
    const missing: string[] = [];
    const blocks = createRenderBlocks(assets.blockLayers, missing);
    expect(missing).toEqual([]);
    const concrete = blocks.byKey('concrete')!;
    expect(concrete.faces[2]).toBe(assets.blockLayers.get(TEST_BLOCK_TEXTURES['concrete']![2]));
    // Mesmos ids da grade (o registro da sim e o do mesher precisam bater).
    expect(concrete.id).toBe(buildTestArena().blocks.byKey('concrete')!.id);
  });

  it('manifesto de blocos inválido é recusado com mensagem', () => {
    expect(() => parseBlockManifest({ layers: [] })).toThrow(/layerWidth/);
    expect(() =>
      parseBlockManifest({ layerWidth: 16, layerHeight: 16, layers: [{ name: 'a' }, { name: 'a' }] }),
    ).toThrow(/repetida/);
  });
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
