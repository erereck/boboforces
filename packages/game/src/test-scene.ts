import {
  builtinBotRef,
  MATCH_RECIPE_FORMAT,
  recipeLimitsFor,
  selectPlatformProfile,
  validateMatchRecipe,
  type MatchRecipe,
} from '@boboforces/format';
import {
  createGamepadProfile,
  createInputFrame,
  createInputMapper,
  createKeyboardMouseProfile,
  createTouchProfile,
  MAX_GAMEPADS,
  type ControlProfile,
  type DeviceBinding,
  type DeviceKind,
  type InputMapper,
  type MenuConfirmConvention,
  type MenuInput,
  type RawInputState,
} from '@boboforces/input';
import type { Platform } from '@boboforces/platform-api';
import {
  ACTOR_POSE,
  createActorBuffer,
  INITIAL_ACTOR_CAPACITY,
  type ActorBuffer,
  type Renderer,
  type TextureArrayData,
  type ViewDesc,
} from '@boboforces/render/data';
import { clamp, HALF_PI, lerp, lerpAngle, type Disposable } from '@boboforces/shared';
import {
  entityIndex,
  ENTITY_FLAG,
  ENTITY_KIND,
  eyeHeightFor,
  MATCH_DEFAULTS,
  NULL_ENTITY,
  type EntityId,
  type Sim,
  type SimEvent,
} from '@boboforces/sim';
import { COLORS, type DrawList, type Screen, type UiFonts } from '@boboforces/ui';
import type { GameAssets } from './assets.ts';
import { ADS_BLEND_S, ADS_FOV_SCALE, defaultFovFor, verticalFov } from './camera.ts';
import { createHud, createHudState, type HudFrame } from './hud.ts';
import { createLocalDriver, type LocalDriver } from './local-driver.ts';
import { createMenuController, type UiFrame } from './menu.ts';
import { buildRenderWorld, createRenderBlocks, loadMatchMap } from './world.ts';

/** Ações da tela de pausa. */
export const PAUSE_ACTION = { resume: 'resume', quit: 'quit' } as const;

/** Pausa (arte-ux.md §6): véu sobre a partida congelada, Continuar e Sair da partida (faixa de perigo). */
export const pauseScreen: Screen<null> = {
  id: 'pause',
  build() {
    return {
      kind: 'box',
      id: 'root',
      color: COLORS.veu,
      children: [
        {
          kind: 'column',
          id: 'main',
          anchor: 'center',
          align: 'stretch',
          width: 380,
          gap: 14,
          children: [
            {
              kind: 'text',
              id: 'title',
              text: { key: 'pause.title' },
              style: 'title',
              color: COLORS.texto,
              textAlign: 'center',
            },
            { kind: 'box', height: 18 },
            {
              kind: 'button',
              id: 'resume',
              text: { key: 'pause.resume' },
              action: PAUSE_ACTION.resume,
              variant: 'primary',
              autofocus: true,
            },
            {
              kind: 'button',
              id: 'quit',
              text: { key: 'pause.quitMatch' },
              action: PAUSE_ACTION.quit,
              variant: 'danger',
            },
          ],
        },
      ],
    };
  },
};

/**
 * Receita da cena de teste do M0: Bobo Warfare TDM, o jogador + 1 bot Normal contra 3 bots De boa (4 bots que andam e
 * atiram). O mapa declarado é o Construto, que no M0 ainda é a arena de teste (`loadMatchMap`).
 */
export function testSceneRecipe(seed: number): MatchRecipe {
  return {
    format: MATCH_RECIPE_FORMAT,
    mode: 'warfare.tdm',
    map: 'construto',
    seed: seed >>> 0,
    teams: [
      { humans: 'all', bots: [{ ref: builtinBotRef('normal'), count: 1 }] },
      { bots: [{ ref: builtinBotRef('chill'), count: 3 }] },
    ],
  };
}

/** Textura de reserva quando os assets não carregaram: 1 camada cinza (a cena ainda roda e dá para jogar). */
const FALLBACK_TEXTURES: TextureArrayData = {
  width: 1,
  height: 1,
  layers: 1,
  levels: [new Uint8Array([168, 172, 164, 255])],
};

export interface TestSceneOptions {
  readonly platform: Platform;
  readonly renderer: Renderer;
  /** `null` quando o carregamento falhou: a cena usa a textura de reserva e o HUD fica sem texto. */
  readonly assets: GameAssets | null;
  readonly seed: number;
  readonly convention: MenuConfirmConvention;
  /** Dispositivo que apertou JOGAR (o mesmo segue jogando); `null` = o padrão da plataforma. */
  readonly device: DeviceKind | null;
  readonly gamepad: number;
}

export type SceneSignal = 'none' | 'quit';

export interface TestScene extends Disposable {
  readonly driver: LocalDriver;
  readonly paused: boolean;
  /** Jogando no teclado/mouse: a casca web pede o pointer lock. */
  readonly wantsPointerLock: boolean;
  /** Entidade do jogador local (controlador 0). */
  readonly playerEntity: EntityId;
  readonly player: InputMapper;
  readonly device: DeviceKind;
  pause(): void;
  resume(): void;
  /** 1x por frame, depois do poll e do `menu.update`. */
  update(dt: number, raw: Readonly<RawInputState>, menu: MenuInput, ui: UiFrame): SceneSignal;
  /** Mundo (1 viewport) e UI (HUD e, pausado, o menu de pausa) na `list` já zerada. */
  render(list: DrawList, ui: UiFrame, fonts: UiFonts | null): void;
}

/** Quanto o flash de dano e a retícula acesa duram (s). */
const FLASH_S = 0.25;
const HIT_MARKER_S = 0.15;
/** Velocidade com que o olho acompanha o agachar (1/s). */
const EYE_FOLLOW = 18;
/** Pitch máximo da câmera: um fio abaixo de 90° (no polo exato o yaw some na ordem de Euler YXZ). */
const CAMERA_MAX_PITCH = HALF_PI - 1e-3;

/**
 * Cena de teste do M0 (PLANO_M0, área `game`): arena de teste, jogador local em 1ª pessoa (teclado/mouse com pointer
 * lock, controle ou toque, trocando na hora pelo último dispositivo usado), 4 bots que andam e atiram, atores como
 * caixas coloridas, HUD mínimo e pausa (pointer lock perdido, aba oculta, `+`/Start, P/Esc, botão de toque).
 */
export function createTestScene(options: TestSceneOptions): TestScene {
  const { platform, renderer, assets } = options;
  const profile = selectPlatformProfile(platform.features.profileHint, 1);
  const checked = validateMatchRecipe(testSceneRecipe(options.seed), recipeLimitsFor(profile));
  if (!checked.ok) {
    throw new Error(`cena de teste: receita recusada (${checked.errors.map((e) => e.code).join(', ')})`);
  }
  const recipe = checked.value;
  const map = loadMatchMap(recipe.map);

  // Dispositivos e perfis prontos (trocar de dispositivo no meio não aloca nada além do `setProfile`).
  const profiles: Readonly<Record<DeviceKind, ControlProfile>> = {
    keyboardMouse: createKeyboardMouseProfile(),
    gamepad: createGamepadProfile(options.convention),
    touch: createTouchProfile(),
  };
  const keyboard: DeviceBinding = { kind: 'keyboardMouse' };
  const touch: DeviceBinding = { kind: 'touch' };
  const pads: readonly DeviceBinding[] = Array.from({ length: MAX_GAMEPADS }, (_, index) => ({
    kind: 'gamepad',
    index,
  }));
  const fallbackDevice: DeviceKind =
    platform.id === 'switch'
      ? 'gamepad'
      : platform.features.touch && !platform.features.keyboardMouse
        ? 'touch'
        : 'keyboardMouse';
  let device: DeviceKind = options.device ?? fallbackDevice;
  let padIndex = Math.max(0, options.gamepad);
  const bindingFor = (kind: DeviceKind, pad: number): DeviceBinding =>
    kind === 'gamepad' ? pads[pad]! : kind === 'touch' ? touch : keyboard;
  const player = createInputMapper(bindingFor(device, padIndex), profiles[device]);
  const drain = createInputFrame();

  // Efeitos fora da sim: flash de dano por entidade e retícula acesa.
  let playerEntity: EntityId = NULL_ENTITY;
  let flash = new Float32Array(1);
  let hitMarker = 0;

  const onEvents = (events: readonly SimEvent[], sim: Sim): void => {
    for (let i = 0; i < events.length; i++) {
      const ev = events[i]!;
      if (ev.type === 'hit') {
        const target = entityIndex(ev.target);
        if (target < flash.length) flash[target] = 1;
        if (ev.shooter === playerEntity) hitMarker = 1;
      } else if (ev.type === 'spawn' && ev.entity === playerEntity) {
        // Renasceu: a mira volta para o yaw do spawn e a arma para a da sim.
        const v = sim.view();
        const e = entityIndex(ev.entity);
        player.setAngles(v.yaw[e]!, 0);
        player.setWeapon(v.weapon[e]!);
      } else if (ev.type === 'weapon' && ev.entity === playerEntity && ev.action === 'switch') {
        player.setWeapon(ev.weapon);
      }
    }
  };

  const driver = createLocalDriver({
    recipe,
    map,
    humans: 1,
    writeHumanFrame: (_slot, out, seq) => player.writeFrame(out, seq),
    onEvents,
  });
  const sim = driver.sim;
  playerEntity = sim.controllerEntity(0);
  {
    // A mira começa onde o bobo nasceu (o primeiro frame já vai com o yaw certo).
    const v = sim.view();
    const e = entityIndex(playerEntity);
    player.setAngles(v.yaw[e]!, 0);
    player.setWeapon(v.weapon[e]!);
    flash = new Float32Array(v.capacity);
  }

  // Mundo no renderer (loading da partida: malhas e texture array sobem uma vez).
  const missingLayers: string[] = [];
  const renderBlocks = assets ? createRenderBlocks(assets.blockLayers, missingLayers) : map.blocks;
  if (missingLayers.length > 0) {
    platform.diagnostics.appendLog(`[cena] camadas de textura ausentes: ${missingLayers.join(', ')}`);
  }
  renderer.setWorld(buildRenderWorld(map, renderBlocks, assets?.blockTextures ?? FALLBACK_TEXTURES));

  const actors: ActorBuffer = createActorBuffer(INITIAL_ACTOR_CAPACITY);
  const hud = createHud();
  const hudState = createHudState();
  const pauseMenu = createMenuController();
  pauseMenu.setRoot(pauseScreen.build(null));

  const fovDeg = defaultFovFor(platform.features);
  const far = Math.min(recipe.match?.viewDistanceM ?? MATCH_DEFAULTS.viewDistanceM, profile.maxViewDistanceM);
  const view: ViewDesc = {
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    camera: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, fovY: 1, near: 0.05, far },
    localSlot: 0,
    thirdPerson: false,
  };
  const views: readonly ViewDesc[] = [view];
  const hudFrame: { -readonly [K in keyof HudFrame]: HudFrame[K] } = {
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    scale: 1,
    minTextPx: 0,
    safeArea: platform.graphics.safeArea,
    pixelRatio: 1,
  };
  let eyeHeight = -1;
  let adsBlend = 0;
  let paused = false;
  let lastPointerLocked = false;
  let disposed = false;

  platform.lifecycle.setInMatch(true);

  function useDevice(next: DeviceKind, pad: number): void {
    if (next === device && (next !== 'gamepad' || pad === padIndex)) return;
    const changedKind = next !== device;
    device = next;
    padIndex = pad;
    player.setDevice(bindingFor(next, pad));
    if (changedKind) player.setProfile(profiles[next]);
  }

  function pause(): void {
    if (paused || disposed) return;
    paused = true;
  }

  function resume(): void {
    if (!paused || disposed) return;
    paused = false;
    // Botões apertados no menu de pausa (o clique em "Continuar") não podem virar tiro no primeiro tick.
    player.writeFrame(drain, 0);
  }

  function fillActors(alpha: number): void {
    const v = sim.view();
    const self = entityIndex(playerEntity);
    let n = 0;
    for (let i = 0; i < v.count && n < actors.capacity; i++) {
      if (v.alive[i] !== 1 || v.kind[i] !== ENTITY_KIND.bobo) continue;
      const o = i * 3;
      const k = n * 3;
      actors.position[k] = lerp(v.prevPosition[o]!, v.position[o]!, alpha);
      actors.position[k + 1] = lerp(v.prevPosition[o + 1]!, v.position[o + 1]!, alpha);
      actors.position[k + 2] = lerp(v.prevPosition[o + 2]!, v.position[o + 2]!, alpha);
      actors.yaw[n] = lerpAngle(v.prevYaw[i]!, v.yaw[i]!, alpha);
      actors.pitch[n] = lerp(v.prevPitch[i]!, v.pitch[i]!, alpha);
      const flags = v.flags[i]!;
      let pose = 0;
      if (flags & ENTITY_FLAG.crouching) pose |= ACTOR_POSE.crouch;
      if (flags & ENTITY_FLAG.ads) pose |= ACTOR_POSE.ads;
      if (flags & ENTITY_FLAG.dead) pose |= ACTOR_POSE.dead;
      if (flags & ENTITY_FLAG.sprinting) pose |= ACTOR_POSE.sprint;
      if ((flags & ENTITY_FLAG.onGround) === 0) pose |= ACTOR_POSE.airborne;
      actors.pose[n] = pose;
      actors.skin[n] = 0;
      actors.team[n] = v.team[i]!;
      actors.weapon[n] = v.weapon[i]!;
      actors.damageFlash[n] = flash[i] ?? 0;
      actors.localSlot[n] = i === self ? 0 : 255;
      n++;
    }
    actors.count = n;
  }

  function updateCamera(dt: number, alpha: number, ui: UiFrame): void {
    const v = sim.view();
    const e = entityIndex(playerEntity);
    const o = e * 3;
    const flags = v.flags[e]!;
    const dead = (flags & ENTITY_FLAG.dead) !== 0;
    const targetEye = dead ? eyeHeightFor(0) : eyeHeightFor(flags);
    eyeHeight = eyeHeight < 0 ? targetEye : eyeHeight + (targetEye - eyeHeight) * Math.min(1, dt * EYE_FOLLOW);
    const c = view.camera;
    c.x = lerp(v.prevPosition[o]!, v.position[o]!, alpha);
    c.y = lerp(v.prevPosition[o + 1]!, v.position[o + 1]!, alpha) + eyeHeight;
    c.z = lerp(v.prevPosition[o + 2]!, v.position[o + 2]!, alpha);
    // A mira vem do mapeador em todo frame de render (sem esperar o tick); o recuo da arma vem da sim.
    c.yaw = player.yaw + v.recoilYaw[e]!;
    // Mesmo limite da sim (weapons.ts): mira a 89° + recuo de até 3,5° passaria de 90° e a câmera YXZ viraria.
    c.pitch = clamp(player.pitch + v.recoilPitch[e]!, -CAMERA_MAX_PITCH, CAMERA_MAX_PITCH);
    const adsTarget = !dead && !paused && player.isDown('ads') ? 1 : 0;
    const step = dt / ADS_BLEND_S;
    adsBlend = adsTarget > adsBlend ? Math.min(adsTarget, adsBlend + step) : Math.max(adsTarget, adsBlend - step);
    view.x = 0;
    view.y = 0;
    view.width = ui.width;
    view.height = ui.height;
    c.fovY = verticalFov(fovDeg, ui.width / Math.max(1, ui.height)) * (1 - (1 - ADS_FOV_SCALE) * adsBlend);
  }

  let lastDt = 0;

  return {
    driver,
    player,
    get paused(): boolean {
      return paused;
    },
    get wantsPointerLock(): boolean {
      return !paused && !disposed && device === 'keyboardMouse' && platform.features.keyboardMouse;
    },
    get playerEntity(): EntityId {
      return playerEntity;
    },
    get device(): DeviceKind {
      return device;
    },
    pause,
    resume,

    update(dt, raw, menu, ui): SceneSignal {
      if (disposed) return 'none';
      lastDt = dt;
      const last = menu.lastDevice;
      if (last !== null) useDevice(last, last === 'gamepad' ? Math.max(0, menu.lastGamepad) : padIndex);
      lastPointerLocked = raw.pointerLocked;

      if (!paused) {
        player.update(raw, dt);
        if (player.wasPressed('pause')) {
          pause();
          return 'none';
        }
        driver.update(dt);
        const fade = dt / FLASH_S;
        for (let i = 0; i < flash.length; i++) if (flash[i]! > 0) flash[i] = Math.max(0, flash[i]! - fade);
        hitMarker = Math.max(0, hitMarker - dt / HIT_MARKER_S);
        playerEntity = sim.controllerEntity(0);
        return 'none';
      }

      // Pausado: a sim não anda e a mira não gira (o mapeador lê só os botões).
      const yaw = player.yaw;
      const pitch = player.pitch;
      player.update(raw, 0);
      player.setAngles(yaw, pitch);
      if (player.wasPressed('pause')) {
        resume();
        return 'none';
      }
      const nav = pauseMenu.update(menu, raw, ui);
      if (nav.back || nav.activated === PAUSE_ACTION.resume) resume();
      else if (nav.activated === PAUSE_ACTION.quit) return 'quit';
      return 'none';
    },

    render(list, ui, fonts): void {
      if (disposed) return;
      const alpha = paused ? 1 : driver.alpha;
      fillActors(alpha);
      renderer.setActors(actors);
      updateCamera(lastDt, alpha, ui);
      renderer.renderViews(views);

      const v = sim.view();
      const e = entityIndex(playerEntity);
      hudState.health = v.health[e]!;
      hudState.maxHealth = recipe.players?.hp ?? 100;
      hudState.kills = v.kills[e]!;
      hudState.clip = v.ammoClip[e]!;
      hudState.reserve = v.ammoReserve[e]!;
      hudState.dead = (v.flags[e]! & ENTITY_FLAG.dead) !== 0;
      hudState.hitMarker = hitMarker;
      hudState.clickToAim = !paused && device === 'keyboardMouse' && platform.id === 'web' && !lastPointerLocked;
      hudState.touch = device === 'touch' && !paused ? player : null;
      hudFrame.width = ui.width;
      hudFrame.height = ui.height;
      hudFrame.scale = ui.scale;
      hudFrame.minTextPx = ui.options.minTextPx ?? 0;
      hudFrame.safeArea = platform.graphics.safeArea;
      hudFrame.pixelRatio = platform.graphics.pixelRatio;
      hud.draw(list, fonts, hudFrame, hudState);
      if (paused) pauseMenu.draw(list, ui);
      renderer.drawUi(list);
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      platform.lifecycle.setInMatch(false);
      driver.dispose();
      actors.count = 0;
      renderer.setActors(actors);
      renderer.setWorld(null);
    },
  };
}
