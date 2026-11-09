import { AI_BUDGET, type AiBudget } from '@boboforces/ai';
import {
  BOT_LEVELS,
  builtinBotRef,
  presetLevel,
  ENGINE_MAX_BOTS,
  FACE_EXPRESSION,
  FIGURE_BOT_ROTATION,
  FIGURE_GRIP,
  FIGURE_PITCH_SAMPLES,
  MANNEQUIN_KIND,
  MATCH_RECIPE_FORMAT,
  normalizeFigureLook,
  PLATFORM_PROFILES,
  recipeLimitsFor,
  selectPlatformProfile,
  validateMatchRecipe,
  GAME_CODENAME,
  GAME_VERSION,
  type FigureGrip,
  type FigureLook,
  type MapCamera,
  type MapCameraRoute,
  type MatchRecipe,
  type PlatformProfile,
  type PropDoseView,
  type TimeOfDay,
  type BotLevel,
} from '@boboforces/format';
import {
  createGamepadProfile,
  createInputFrame,
  createInputMapper,
  createKeyboardMouseProfile,
  createTouchProfile,
  BUTTON,
  keyIndex,
  MAX_GAMEPADS,
  WEAPON_SLOT_COUNT,
  type ControlProfile,
  type DeviceBinding,
  type DeviceKind,
  type InputMapper,
  type MenuInput,
  type RawInputState,
} from '@boboforces/input';
import {
  ACTOR_KIND,
  ACTOR_POSE,
  createActorBuffer,
  createEnvironment,
  createFxQueue,
  createProjectileBuffer,
  createRenderDebug,
  createViewDesc,
  NO_FIGURE,
  NO_MODEL,
  pushActorImpact,
  pushBlockImpact,
  pushDeath,
  pushExplosion,
  pushMuzzleFlash,
  pushPropImpact,
  pushTracer,
  pushTrail,
  resetFxQueue,
  viewmodelAimOffset,
  type ActorBuffer,
  type FxDeath,
  type MipFilterMode,
  type ViewDesc,
} from '@boboforces/render/data';
import { clamp, createLogger, HALF_PI, lerp, lerpAngle, wrapAngle } from '@boboforces/shared';
import {
  ENTITY_FLAG,
  ENTITY_KIND,
  entityIndex,
  expandRecipe,
  eyeHeightFor,
  figurePostureOf,
  isFfaMode,
  makeEntityId,
  MATCH_DEFAULTS,
  METRICS,
  NO_TEAM,
  NULL_ENTITY,
  heldClip,
  heldReserve,
  MAX_CONTROLLERS,
  WEAPON_CODE,
  WEAPON_FIRE,
  WEAPON_KILL_PLANE,
  WEAPON_NONE,
  WEAPON_SLOT,
  weaponDef,
  WEAPONS,
  weaponGrip,
  type Sim,
  type SimEvent,
  type SimView,
} from '@boboforces/sim';
import {
  ageKillFeed,
  COLORS,
  createKillFeedModel,
  createScoreboardModel,
  drawKillFeed,
  drawMatchCountdown,
  drawScoreboard,
  MAX_ALLY_MARKERS,
  MAX_TEAM_PINGS,
  SETTINGS_ACTION,
  settingsScreen,
  PLAYER_COLORS,
  pushKillFeed,
  SCOREBOARD_MAX_ROWS,
  TEAM_COLORS,
  createDebugPanelModel,
  createDrawList,
  createHudModel,
  createHudSharedModel,
  drawDebugPanel,
  drawFontSpecimen,
  drawHud,
  drawHudShared,
  hitPrimaryOption,
  PRIMARY_LAYOUT,
  drawText,
  HUD_AMMO,
  HUD_CROSSHAIR,
  layoutHudScreen,
  measureText,
  MIN_TEXT,
  numberWidth,
  paintNumber,
  paintText,
  pushRect,
  resetDrawList,
  t,
  templateParts,
  textWidth,
  withAlpha,
  type DrawList,
  type HudModel,
  type HudScreenLayout,
  type StringKey,
  type UiFonts,
} from '@boboforces/ui';
import { sampleLightGrid } from '@boboforces/world';
import { AIM_ASSIST, createAimAssistState, findAimAssist, pullAim } from './aim-assist.ts';
import { formatBenchReport, type BenchReport } from '../bench/report.ts';
import { formatT0Line } from '../bench/t0.ts';
import type { BenchConfig, FigureClipFrame, GameDebugApi, MannequinOverride } from '../bench/types.ts';
import { ADS_BLEND_S, ADS_FOV_SCALE, defaultFovFor, verticalFov } from '../camera.ts';
import { createTouchOverlay } from '../hud.ts';
import { createLocalDriver, type LocalDriver } from '../local-driver.ts';
import { createMenuController, type UiFrame } from '../menu.ts';
import { challengeLevel, challengeScreen, PAUSE_ACTION, pauseScreen } from '../pause.ts';
import { prizeLine, RESULT_ACTION, resultScreen, type ResultScreenData } from '../result-screen.ts';
import type { SceneHost, SceneRequest, SceneSignal } from '../scene-api.ts';
import {
  beginDeath,
  controllerNames,
  controllerRules,
  countdownLine,
  createDeathState,
  deathCamAngles,
  deathTexts,
  DEATH_CAM,
  endDeath,
  fillDeathBanner,
  HARD_TIME,
  losingBadly,
  moveRadialCursor,
  PRIMARY_ORDER,
  radialIndex,
  stepCursor,
  type DeathState,
} from './death.ts';
import { createFigureClip, type FigureClipRun } from './figure-clip.ts';
import { projectToView } from './markers.ts';
import { createMatchStats, recordMatchEvent, summarizeMatch } from './result.ts';
import { bareLookId, FIGURE_ZOMBIE_LOOK, figureLookById, type SceneFigures } from './figures.ts';
import type { LoadedConstruto, LoadingTimes } from './load.ts';
import { createCameraPose, poseFromCamera, sampleRoute, type CameraPose } from './route.ts';
import { createSamples } from './stats.ts';

/** Quanto o flash de dano, a retícula e o tiro duram (s). */
const FLASH_S = 0.25;
const HIT_MARKER_S = 0.15;
const DAMAGE_S = 0.8;
const RECOIL_S = 0.12;
const FIRING_S = 0.08;
const SPAWN_S = 0.4;
/** Velocidade com que o olho acompanha o agachar (1/s). */
const EYE_FOLLOW = 18;
/** Pitch máximo da câmera: um fio abaixo de 90° (no polo exato o yaw some na ordem de Euler YXZ). */
const CAMERA_MAX_PITCH = HALF_PI - 1e-3;
/** Passada (m por ciclo do balanço do viewmodel) e velocidade de corrida (balanço cheio). */
const STRIDE_M = 1.2;
const RUN_SPEED = 6.8;
/** Bots do JOGAR (TDM 6 × 6 com o jogador), limitados pelo perfil. */
const PLAY_BOTS = 11;
/** M2 (fase 2d): regras do Bobo Warfare TDM no JOGAR (gameplay.md §7.4): 75 abates ou 10 min. */
const PLAY_SCORE_LIMIT = 75;
const PLAY_TIME_LIMIT_S = 600;
/** M2 (fase 2d): marcadores de aliado até esta distância (m), com a ponta este tanto acima dos pés (m). */
const ALLY_MARKER_MAX_M = 80;
const ALLY_MARKER_HEIGHT_M = 2.05;
/** M2 (fase 3e): por quanto tempo o aviso de um aliado fica na tela (s). */
const PING_SHOW_S = 2.5;
/** M2 (fase 3h, prints): avisos a menos desta fração da altura da vista um do outro viram um só. */
const PING_MERGE_FRAC = 0.04;
/** M2 (fase 2e): o resultado aparece este tempo depois do fim da partida (s). */
const RESULT_DELAY_S = 2.5;
/** Cubinhos por impacto (o render limita pelo teto do perfil). */
const CUBES_BLOCK = 6;
const CUBES_ACTOR = 5;
/** Janela do F2 (2 s a até 240 fps). */
const F2_WINDOW = 480;
/** Clarão de tiro na luz ambiente (arte-ux.md §1.8): alcance, ganho por tiro e queda (s). */
const FLASH_RANGE_M = 30;
/** M2: tremor da câmera nas explosões (até onde chega, quanto some por segundo e a amplitude em rad). */
const SHAKE_RANGE_M = 14;
const SHAKE_DECAY_PER_S = 2.5;
const SHAKE_AMPLITUDE = 0.02;
/** M2: projétil a menos disto (m) do olho de quem lançou não é desenhado (o foguete sai do olho). */
const PROJECTILE_HIDE_NEAR_EYE_M = 1.5;
/** M2 (fase 2b): o Destravar vira aviso (anel de recentes do relatório do F2), com o ponto para corrigir o mapa. */
const log = createLogger('partida');
/** M2 (fase 2b): giro da caixinha de munição no chão (rad/s). */
const PICKUP_SPIN_RAD_S = 1.2;
/** M2: projéteis desenhados por frame (foguetes e granadas em voo). */
/** Projéteis em voo e caixinhas no chão desenhados por frame (o resto fica de fora). */
const MAX_DRAWN_PROJECTILES = 128;
const FLASH_GAIN = 0.35;
const FLASH_DECAY_S = 0.08;
/**
 * Grupos de manequins do mapa (`MANNEQUIN_KIND` do format): a vitrine (sempre) e os de print, só com a câmera nomeada
 * deles: `leitura:*` com as `print:leitura-*`, `densidade` com as `print:densidade-*`, a régua `altura:*` com a
 * `print:altura` e a `print:altura-45` (#53), a fila `linha:*` com as `print:linha-*`. O format põe o close junto da
 * fila (`line`); o jogo separa pela câmera: `close:*` só com a `print:close-1m` (no lugar do `densidade`, sem os dois
 * juntos).
 */
const MANNEQUIN_GROUP = { ...MANNEQUIN_KIND, close: 5 } as const;
/** Giro que as câmeras da fila dão aos `linha:*` (o FutBobo gira o boneco, não a câmera): 3/4 e de costas. */
const LINE_TURN_3_4 = Math.PI / 4;
const LINE_TURN_BACK = Math.PI;
/** Altura (m) em que atores e manequins amostram a grade de luz: o meio do corpo (#53; sem número fixo). */
const ACTOR_LIGHT_Y = METRICS.bodyHeight / 2;
/** Mira dos manequins no gancho dos prints: a faixa da tabela de jogo. */
const MANNEQUIN_PITCH_MIN = FIGURE_PITCH_SAMPLES[0];
const MANNEQUIN_PITCH_MAX = FIGURE_PITCH_SAMPLES[FIGURE_PITCH_SAMPLES.length - 1]!;
/**
 * Entidades sintéticas (nunca da sim: a geração 0xFFFC/0xFFFD não existe; a 0xFFFE é a chave do manequim no render).
 * Manequim com mira ≠ 0 usa uma (o rig ignora o pitch da entidade 0, `anim/rig.ts:418`); o boneco do clipe usa outra
 * por clipe, para o rig começar do zero.
 */
const MANNEQUIN_AIM_ENTITY = 0xfffd0000;
const CLIP_ENTITY = 0xfffc0000;
/** Chaves de clipe lembradas por partida (só o gancho dos prints usa). */
const CLIP_KEYS_MAX = 4096;
/** Empunhadura do modelo de arma de um manequim (o id do `.bfmodel`; o que está na sim vem do `WeaponDef.grip`). */
const MODEL_GRIP: ReadonlyMap<string, FigureGrip> = new Map<string, FigureGrip>([
  ['pistol', FIGURE_GRIP.pistol],
  ['rifle', FIGURE_GRIP.rifle],
  ['sniper', FIGURE_GRIP.sniper],
]);

function mannequinGroup(name: string): number {
  if (name.startsWith('leitura:')) return MANNEQUIN_GROUP.reading;
  if (name === 'densidade') return MANNEQUIN_GROUP.density;
  if (name.startsWith('altura:')) return MANNEQUIN_GROUP.height;
  if (name.startsWith('linha:')) return MANNEQUIN_GROUP.line;
  if (name.startsWith('close:')) return MANNEQUIN_GROUP.close;
  return MANNEQUIN_GROUP.always;
}

/** Grupo de manequins que a câmera nomeada mostra (`always` = só a vitrine). */
function cameraGroup(name: string): number {
  if (name.startsWith('print:leitura-')) return MANNEQUIN_GROUP.reading;
  if (name.startsWith('print:densidade-')) return MANNEQUIN_GROUP.density;
  if (name === 'print:altura' || name.startsWith('print:altura-')) return MANNEQUIN_GROUP.height;
  if (name.startsWith('print:linha-')) return MANNEQUIN_GROUP.line;
  if (name.startsWith('print:close-')) return MANNEQUIN_GROUP.close;
  return MANNEQUIN_GROUP.always;
}

/** Empunhadura do modelo de arma pelo id (`''` = sem arma; desconhecido = fuzil, a pose de duas mãos). */
export function gripOfWeaponModel(id: string): FigureGrip {
  if (id === '') return FIGURE_GRIP.none;
  for (let c = 0; c < WEAPONS.length; c++) if (WEAPONS[c]!.id === id) return WEAPONS[c]!.grip;
  return MODEL_GRIP.get(id) ?? FIGURE_GRIP.rifle;
}
/**
 * M2: ajuste do viewmodel por código de arma (escala e deslocamento em m, só fora do ADS; +x direita, +y cima, −z
 * para longe). O lança-foguetes tem 19 cm de tubo e a traseira passa da mão: sem o ajuste tomava metade da tela.
 */
interface ViewmodelTweak {
  readonly scale: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}
const VIEWMODEL_TWEAK: readonly (ViewmodelTweak | null)[] = WEAPONS.map((w) =>
  w.code === WEAPON_CODE.rocket
    ? { scale: 0.62, x: 0.13, y: -0.04, z: -0.1 }
    : w.code === WEAPON_CODE.lmg
      ? { scale: 0.9, x: 0.02, y: 0, z: -0.04 }
      : w.code === WEAPON_CODE.sniper
        ? { scale: 0.75, x: 0.05, y: -0.03, z: -0.1 }
        : null,
);

/** Primárias em rodízio do `weapons=mix` do bench. */
const MIX_PRIMARIES = [
  WEAPON_CODE.rifle,
  WEAPON_CODE.smg,
  WEAPON_CODE.shotgun,
  WEAPON_CODE.sniper,
  WEAPON_CODE.rocket,
  WEAPON_CODE.lmg,
] as const;

/** Primária de cada controlador para o `weapons=` do bench (`mix` em rodízio; senão todos com a arma dada). */
export function benchPrimaries(weapons: string): number[] {
  const out: number[] = [];
  const fixed = WEAPONS.find((w) => w.id === weapons);
  for (let c = 0; c < MAX_CONTROLLERS; c++) {
    out.push(fixed ? fixed.code : MIX_PRIMARIES[c % MIX_PRIMARIES.length]!);
  }
  return out;
}

/** Bench: campos somados por vista (draws, triângulos, regiões, props, atores, draws de bonecos). */
const VIEW_SUM_FIELDS = 6;
/** Bench: frames do começo da partida medidos à parte (travada de shader, item 15 do T0). */
const STARTUP_FRAMES = 120;
/** Bench: no máximo uma linha `[bench] pico` por janela (a duração dividida nestas janelas), com o pior frame dela. */
const SPIKE_WINDOWS = 20;
/** Bench: frame acima disto (ms) é um vão do ciclo de vida (HOME, sleep): conta à parte, fora das estatísticas. */
const LIFECYCLE_GAP_MS = 1000;
/** Item 16 (thermal): o p50 do fim cobre os últimos 60 s POR TEMPO; abaixo de 180 s medidos o item é pulado. */
const THERMAL_WINDOW_S = 60;
const THERMAL_MIN_S = 180;

const F2_KEY = keyIndex('F2');

/** Orçamento da IA vindo do perfil da plataforma (decisão da integração do M1, `BotDirectorConfig.budget`). */
export function aiBudgetFor(profile: PlatformProfile): AiBudget {
  return {
    raysPerTick: profile.aiRaysPerTick,
    pathNodesPerTick: profile.aiPathNodesPerTick,
    pathSlice: AI_BUDGET.pathSlice,
  };
}

/** Perfil efetivo: o do bench (se não for `auto`) ou o da plataforma com N vistas locais. */
export function profileFor(
  family: PlatformProfile['family'],
  views: number,
  bench: BenchConfig | null,
): PlatformProfile {
  if (bench && bench.profile !== 'auto') return PLATFORM_PROFILES[bench.profile];
  return selectPlatformProfile(family, views);
}

export interface SceneRecipe {
  readonly recipe: MatchRecipe;
  readonly humans: number;
  readonly warnings: readonly string[];
}

/**
 * Receita da cena. JOGAR: Bobo Warfare TDM no Construto, o jogador + bots N0 (6 × 6, dentro do teto do perfil).
 * Cena-vitrine: FFA só com o jogador (andar e olhar). Bench: TDM só de bots — os "jogadores locais" do bench são bots
 * no lugar dos humanos (PLANO_M1: tela dividida só no bench) — com `views + bots` bobos, sem limite de tempo.
 */
export function sceneRecipe(request: SceneRequest, profile: PlatformProfile): SceneRecipe {
  const warnings: string[] = [];
  const ref = builtinBotRef(request.kind === 'play' ? (request.level ?? 'normal') : 'normal');
  const bench = request.bench;
  let recipe: MatchRecipe;
  let humans = 1;
  if (request.kind === 'bench' && bench) {
    humans = 0;
    let bots = bench.bots;
    if (bench.views + bots > ENGINE_MAX_BOTS) {
      bots = ENGINE_MAX_BOTS - bench.views;
      warnings.push(`bots limitado a ${bots} (${bench.views} jogadores locais também são bots)`);
    }
    if (!bench.armed) warnings.push('armed=0 ainda não existe no M1: os bots estão armados');
    const total = bench.views + bots;
    const a = Math.ceil(total / 2);
    const b = total - a;
    recipe = {
      format: MATCH_RECIPE_FORMAT,
      mode: 'warfare.tdm',
      map: 'construto',
      seed: bench.seed >>> 0,
      match: { timeLimitS: 0, viewDistanceM: bench.viewDistanceM },
      teams: [{ bots: [{ ref, count: a }] }, { bots: b > 0 ? [{ ref, count: b }] : [] }],
    };
  } else if (request.kind === 'vitrine') {
    recipe = {
      format: MATCH_RECIPE_FORMAT,
      mode: 'warfare.ffa',
      map: 'construto',
      seed: request.seed >>> 0,
      match: { timeLimitS: 0 },
      teams: [{ humans: 'all', bots: [] }],
    };
  } else if (request.kind === 'play' && request.recipe) {
    // M2 (fase 4c): o preset pedido, com a semente desta partida (o validador abaixo corta no teto do aparelho).
    recipe = { ...request.recipe, seed: request.seed >>> 0 };
  } else {
    const bots = Math.min(PLAY_BOTS, profile.maxBots);
    const enemies = Math.ceil(bots / 2);
    const allies = bots - enemies;
    recipe = {
      format: MATCH_RECIPE_FORMAT,
      mode: 'warfare.tdm',
      map: 'construto',
      seed: request.seed >>> 0,
      match: { timeLimitS: PLAY_TIME_LIMIT_S, scoreLimit: PLAY_SCORE_LIMIT },
      teams: [{ humans: 'all', bots: allies > 0 ? [{ ref, count: allies }] : [] }, { bots: [{ ref, count: enemies }] }],
    };
  }
  // O bench mede além do perfil (é a ferramenta que acha o teto): limites do motor e visão do PC.
  const limits =
    request.kind === 'bench'
      ? { maxBots: ENGINE_MAX_BOTS, maxLocalHumans: 4, maxViewDistanceM: PLATFORM_PROFILES.pc.maxViewDistanceM }
      : recipeLimitsFor(profile);
  const checked = validateMatchRecipe(recipe, limits);
  if (!checked.ok) throw new Error(`cena: receita recusada (${checked.errors.map((e) => e.code).join(', ')})`);
  return { recipe: checked.value, humans, warnings };
}

/** Uma vista local: a câmera, a HUD dela e o que ela segue. */
interface ViewSlot {
  readonly desc: ViewDesc;
  readonly hud: DrawList;
  readonly model: HudModel;
  /** Controlador seguido (humano 0 ou um bot); -1 = nenhum. */
  controller: number;
  eye: number;
  adsBlend: number;
  damageT: number;
  /** Clarão de tiro na luz ambiente desta vista, 0..1 (arte-ux.md §1.8; vai para `ViewDesc.flash`). */
  flash: number;
  /** M2: tremor de explosão, 0..1 (some em `SHAKE_DECAY_PER_S`). */
  shake: number;
  /** M2 (fase 2c): a tela de morte desta vista (câmera, faixa, radial). */
  readonly death: DeathState;
}

export interface ConstrutoMatch {
  readonly driver: LocalDriver;
  readonly debug: GameDebugApi;
  readonly paused: boolean;
  readonly wantsPointerLock: boolean;
  /** M2 (fase 2e): nível rápido dos bots adversários agora. */
  readonly level: BotLevel;
  pause(): void;
  frame(
    dt: number,
    raw: Readonly<RawInputState>,
    menu: MenuInput,
    ui: UiFrame,
    list: DrawList,
    frameMs?: number,
  ): SceneSignal;
  dispose(): void;
}

/** Avisos do relatório que a cena juntou (receita, loading). */
export interface MatchSetup {
  readonly host: SceneHost;
  readonly request: SceneRequest;
  readonly loaded: LoadedConstruto;
  /**
   * Bonecos da partida (#56; etapas "figuras" e "skins" do loading): tabela de jogo, gabaritos e skins. A partida é a
   * dona daqui em diante e solta tudo no `dispose` (regra 21).
   */
  readonly figures: SceneFigures;
  readonly recipe: SceneRecipe;
  readonly profile: PlatformProfile;
  readonly times: LoadingTimes;
  readonly warnings: readonly string[];
}

/**
 * A partida da cena (Construto carregado): passo fixo com bots N0 e zumbis, 1 a 4 vistas (cada uma seguindo um
 * jogador local; no bench, bots no lugar dos humanos), atores interpolados com a luz da grade de 2 m, eventos da sim
 * virando VFX, hora do dia por uniform, HUD por vista, painel F2, bench com relatório e o gancho dos prints.
 */
export function createConstrutoMatch(setup: MatchSetup): ConstrutoMatch {
  const { host, request, loaded, figures, profile } = setup;
  const { platform, renderer } = host;
  const now = (): number => platform.now();
  const doc = loaded.doc;
  const bench = request.kind === 'bench' ? request.bench : null;
  const recipe = setup.recipe.recipe;
  const humans = setup.recipe.humans;
  const ffa = isFfaMode(recipe.mode);
  const warnings: string[] = [...request.benchWarnings, ...setup.warnings, ...setup.recipe.warnings];
  // Alarme do orçamento de skins (#56, PLANO §B15): conjunto além da reserva veste o padrão do próprio time.
  if (figures.plan.overflow.length > 0) {
    warnings.push(`skins de boneco: ${figures.plan.overflow.length} conjuntos além da reserva vestem o padrão do time`);
  }

  // --- jogador humano (JOGAR e Cena-vitrine): mapeador que segue o último dispositivo usado (como no M0) ---
  const profiles: Readonly<Record<DeviceKind, ControlProfile>> = {
    keyboardMouse: createKeyboardMouseProfile(),
    gamepad: createGamepadProfile(request.convention),
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
  let device: DeviceKind = request.device ?? fallbackDevice;
  let padIndex = Math.max(0, request.gamepad);
  const bindingFor = (kind: DeviceKind, pad: number): DeviceBinding =>
    kind === 'gamepad' ? pads[pad]! : kind === 'touch' ? touch : keyboard;
  const player: InputMapper = createInputMapper(bindingFor(device, padIndex), profiles[device]);
  /** M2 (fase 3h): assistência de mira do humano (controle e toque; o nível vem do perfil do dispositivo). */
  const assist = createAimAssistState();
  const assistAngles = new Float64Array(2);
  const drain = createInputFrame();

  // --- modelos: arma por código da sim (M2: `SimView.weapon` é o código) e o alvo do ADS do viewmodel ---
  const modelIndex = loaded.world.modelIndex;
  const weaponModel = new Uint8Array(WEAPONS.length).fill(NO_MODEL);
  WEAPONS.forEach((w, code) => {
    const m = modelIndex.get(w.id);
    if (m !== undefined) weaponModel[code] = m;
  });
  const aimOffsets = loaded.modelDocs.map((m) => viewmodelAimOffset(m));
  // M2: nome e categoria de cada arma na tabela pt-BR, resolvidos uma vez (a HUD só guarda a referência).
  const weaponNames = WEAPONS.map((w) => t(`weapon.${w.id}` as StringKey));
  const weaponCategories = WEAPONS.map((w) => t(`weapon.category.${w.category}` as StringKey));
  // M2 (fase 2c): tela de morte. Nomes por controlador, textos da faixa e as opções do radial (resolvidos uma vez).
  const names = controllerNames(recipe, humans);
  /** M2 (fase 4e): o que a regra da partida deixa a HUD mostrar (`MatchRecipe.hud`) e a assistência permitida. */
  const showKillFeed = recipe.hud?.killFeed ?? true;
  const showHitmarker = recipe.hud?.hitmarker ?? true;
  const showAllyMarkers = recipe.hud?.allyMarkers ?? true;
  const assistAllowed = recipe.weapons?.aimAssist ?? true;
  /** M2 (fecho da fase 3): as regras ativas de cada controlador (placar e tela de morte). */
  const ruleTexts = controllerRules(recipe, humans);
  const deathTx = deathTexts();
  const primaryNames = PRIMARY_ORDER.map((code) => weaponNames[code] ?? '');
  const primaryCategories = PRIMARY_ORDER.map((code) => weaponCategories[code] ?? '');
  const NO_PRIMARIES: readonly string[] = [];
  /** Escolha do humano no radial (índice em `PRIMARY_ORDER`; começa no fuzil, a primária padrão). */
  let humanPrimary = 0;
  /** Derrota feia (GDD §3.8): mortes seguidas do humano sem abate e se a dica já saiu nesta partida. */
  let deathsWithoutKill = 0;
  let hardHintUsed = false;
  const timeLimitS = recipe.match?.timeLimitS ?? 0;
  const scoreLimit = recipe.match?.scoreLimit ?? 0;
  const camAngles = { yaw: 0, pitch: 0 };
  // M2 (fase 2d): HUD da partida (kill feed, placar do Tab, contagem inicial e marcadores dos aliados).
  const killFeed = createKillFeedModel();
  const scoreboard = createScoreboardModel();
  scoreboard.title = t(`mode.${recipe.mode}` as StringKey);
  // A legenda das regras: um bot diferente por linha, embaixo do time dele.
  scoreboard.ruleCount = 0;
  for (const slot of expandRecipe(recipe, humans)) {
    const rules = ruleTexts[slot.controller] ?? '';
    if (rules === '' || scoreboard.ruleCount >= scoreboard.ruleLines.length) continue;
    const line = t('rule.line', { name: names[slot.controller] ?? '', rules });
    if (scoreboard.ruleLines.slice(0, scoreboard.ruleCount).includes(line)) continue;
    scoreboard.ruleLines[scoreboard.ruleCount] = line;
    scoreboard.ruleTeam[scoreboard.ruleCount] = slot.team;
    scoreboard.ruleCount++;
  }
  const scoreOrder = new Int16Array(SCOREBOARD_MAX_ROWS);
  const todayLine = countdownLine(recipe, humans, names);
  const projected = new Float64Array(3);
  /** M2 (fase 3e): avisos do time (x, y, z) lidos do diretor. */
  const pingScratch = new Float64Array(MAX_TEAM_PINGS * 3);
  // M2 (fase 2e): pausa com páginas, nível dos bots adversários, Destravar e o resultado.
  let pausePage: 'main' | 'challenge' | 'settings' = 'main';
  const pauseState = { challenge: request.kind === 'play' };
  let currentLevel: BotLevel =
    request.kind !== 'play'
      ? 'normal'
      : request.recipe
        ? (presetLevel(request.recipe) ?? 'normal')
        : (request.level ?? 'normal');
  /** Time dos bots que o "Ajustar desafio" muda: o adversário no TDM (o humano é do time 0), todos no FFA. */
  const challengeTeam = ffa ? -1 : 1;
  let unstuckPending = false;
  let matchStats = createMatchStats(1);
  let endedAt = -1;
  let resultShown = false;
  const resultMenu = createMenuController();
  // M2: o foguete em voo tem modelo próprio; a granada em voo usa o da mão.
  const rocketShellModel = modelIndex.get('rocket-shell') ?? NO_MODEL;
  // M2 (fase 2b): a caixinha de munição no chão.
  const ammoBoxModel = modelIndex.get('ammo-box') ?? NO_MODEL;
  const projectiles = createProjectileBuffer(MAX_DRAWN_PROJECTILES);
  const modelOf = (code: number): number => (code >= 0 && code < weaponModel.length ? weaponModel[code]! : NO_MODEL);

  // --- estado por entidade (fora da sim: cosmético) ---
  let flash = new Float32Array(1);
  let recoil = new Float32Array(1);
  let firing = new Float32Array(1);
  let spawnT = new Float32Array(1);
  let reloadStart = new Float32Array(1);
  let reloadDur = new Float32Array(1);
  /** Fase do passo, só para o balanço do viewmodel (o boneco de 3ª pessoa anda pelo rig). */
  let walkPhase = new Float32Array(1);
  /** Skin (1ª das `FIGURE_SKIN_LAYERS` camadas; 0xffff = ainda não resolvida) e gabarito do boneco de cada entidade. */
  let skinLayer = new Uint16Array(1);
  let figureOf = new Uint8Array(1);
  /**
   * Velocidade de cada entidade no tick anterior e no atual (m/s): o render recebe a interpolada pelo `alpha`, sem o
   * degrau do tick (o rig do boneco filtra a aceleração; saltos viram tranco nas molas, pedido da F4).
   */
  let velPrev = new Float32Array(3);
  let velCur = new Float32Array(3);

  // --- vistas ---
  const viewCount = bench ? bench.views : 1;
  const slots: ViewSlot[] = [];
  const descs: ViewDesc[] = [];
  for (let i = 0; i < viewCount; i++) {
    const desc = createViewDesc();
    const hud = createDrawList(1024);
    slots.push({
      desc,
      hud,
      model: createHudModel(),
      controller: -1,
      eye: -1,
      adsBlend: 0,
      damageT: 0,
      flash: 0,
      shake: 0,
      death: createDeathState(),
    });
    descs.push(desc);
  }
  const sharedHud = createHudSharedModel();
  let layout: HudScreenLayout | null = null;
  /** Entradas do último `layoutHudScreen` (comparadas número a número: nada de chave em string por frame). */
  const layoutKey = new Float64Array(7).fill(-1);

  const far = Math.min(
    recipe.match?.viewDistanceM ?? MATCH_DEFAULTS.viewDistanceM,
    bench ? 140 : profile.maxViewDistanceM,
  );
  const fovDeg = defaultFovFor(platform.features);
  const env = createEnvironment();
  env.timeOfDay = bench?.timeOfDay ?? doc.light.timeOfDay;
  const sun = doc.light.sunDir;
  const sunLen = Math.hypot(sun[0], sun[1], sun[2]) || 1;
  env.sunDirX = sun[0] / sunLen;
  env.sunDirY = sun[1] / sunLen;
  env.sunDirZ = sun[2] / sunLen;
  env.viewDistanceM = far;
  env.wind = profile.family === 'mobile' ? 0 : 1;
  const debugState = createRenderDebug();
  debugState.gpuFinish = bench?.gpuFinish ?? false;
  // Bissecção do bench: sem viewmodel (as outras chaves ficam no frame).
  if (bench && !bench.viewmodel) debugState.hideViewmodel = true;
  renderer.setDebug(debugState);
  // Teto de detritos do perfil da cena (o renderer nasce antes, no boot, com o padrão).
  renderer.setDebrisBudget(profile.maxDebris);

  const actors: ActorBuffer = createActorBuffer(192);
  const fx = createFxQueue(512);
  const deathScratch: { -readonly [K in keyof FxDeath]: FxDeath[K] } = {
    victim: 0,
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    dirX: 0,
    dirY: 0,
    dirZ: 0,
    force: 0,
    bodyPart: 0,
    skin: 0,
    scale: 1,
    kind: 0,
    figure: NO_FIGURE,
  };
  const lightScratch = new Float32Array(3);

  // --- manequins do mapa: gabarito, skin, postura, arma e luz resolvidos no loading e no gancho dos prints (nada por
  // frame, regra 11). Os de print só aparecem com a câmera do print deles; bench e partida desenham só a vitrine
  // (verificação do M1: a pista de leitura tapava a si mesma e somava 9 atores à carga do bench).
  const mannequins = doc.markers.mannequins;
  const mqCount = mannequins.length;
  const mqGroup = new Uint8Array(mqCount);
  const mqFigure = new Uint8Array(mqCount).fill(NO_FIGURE);
  const mqSkin = new Uint16Array(mqCount);
  const mqTeam = new Uint8Array(mqCount).fill(255);
  const mqWeapon = new Uint8Array(mqCount).fill(NO_MODEL);
  /** Bits da sim da pose (agachado, ADS, deslizando) e a empunhadura: a postura sai de `figurePostureOf`. */
  const mqFlags = new Uint32Array(mqCount);
  const mqGrip = new Uint8Array(mqCount);
  const mqPosture = new Uint8Array(mqCount);
  const mqPose = new Uint8Array(mqCount);
  const mqZombie = new Uint8Array(mqCount);
  const mqPitch = new Float32Array(mqCount);
  /** Expressão pedida pelo gancho (−1 = a da câmera ou neutra) e giro somado ao yaw do mapa (rad). */
  const mqExpression = new Int8Array(mqCount).fill(-1);
  const mqTurn = new Float32Array(mqCount);
  /** n − 1 dos `linha:n` (−1 fora da fila): o visual n da fila e a expressão n − 1 da câmera de expressões. */
  const mqLine = new Int8Array(mqCount).fill(-1);
  const mqLight = new Float32Array(mqCount * 3);
  const mannequinByName = new Map<string, number>();
  const printsLoading = bench?.prints ?? false;
  let vitrineMannequins = 0;

  interface MannequinLook {
    readonly id: string;
    readonly look: FigureLook;
    readonly zombie: boolean;
  }

  /** Ajuste do gancho válido: pose, arma e time conhecidos e números finitos (um NaN no giro some com o manequim). */
  function validOverride(o: MannequinOverride): boolean {
    if (o.pose !== undefined && o.pose !== 'stand' && o.pose !== 'crouch' && o.pose !== 'aim' && o.pose !== 'slide')
      return false;
    if (o.weapon !== undefined && o.weapon !== '' && !modelIndex.has(o.weapon)) return false;
    const teams = Math.max(2, figures.teamColors.length);
    if (o.team !== undefined && (!Number.isInteger(o.team) || o.team < -1 || o.team >= teams)) return false;
    if (o.expression !== undefined && (!Number.isInteger(o.expression) || o.expression < 0 || o.expression > 7))
      return false;
    for (const x of [o.pitch, o.turnDeg, o.hairStyle, o.headwear])
      if (x !== undefined && !Number.isFinite(x)) return false;
    return true;
  }

  /** Look do manequim: o do gancho, o da fila (com o pedido de prints) ou o do mapa; `null` = id desconhecido. */
  function mannequinLook(m: number, o: MannequinOverride | null): MannequinLook | null {
    const q = mannequins[m]!;
    let id: string;
    if (o?.look !== undefined) id = bareLookId(o.look);
    else if (q.zombie) id = FIGURE_ZOMBIE_LOOK;
    else if (printsLoading && mqLine[m]! >= 0) id = FIGURE_BOT_ROTATION[mqLine[m]!] ?? bareLookId(q.look);
    else id = bareLookId(q.look);
    let look = figureLookById(id);
    if (!look) return null;
    if (o && (o.hairStyle !== undefined || o.headwear !== undefined)) {
      const base = look;
      look = normalizeFigureLook({
        ...look,
        ...(o.hairStyle !== undefined ? { hairStyle: o.hairStyle } : {}),
        ...(o.headwear !== undefined ? { headwear: o.headwear } : {}),
      });
      // Igual ao look de base (o boné do mecânico já é o 4): fica o id dele, sem gastar skin sob demanda.
      if (look.hairStyle === base.hairStyle && look.headwear === base.headwear) look = base;
      else id = `${id}~h${look.hairStyle}~c${look.headwear}`;
    }
    return { id, look, zombie: q.zombie || look.zombie !== null };
  }

  /** Aplica o manequim m (o mapa com o ajuste `o` por cima). `false` = look desconhecido (nada muda). */
  function applyMannequin(m: number, o: MannequinOverride | null): boolean {
    const q = mannequins[m]!;
    const r = mannequinLook(m, o);
    if (!r) return false;
    const team = r.zombie ? -1 : (o?.team ?? q.team);
    const slot = figures.resolve(r.id, r.look, team);
    mqFigure[m] = slot ? slot.figure : NO_FIGURE;
    mqSkin[m] = slot ? slot.skin : 0;
    mqTeam[m] = !r.zombie && team >= 0 && team < 255 ? team : 255;
    mqZombie[m] = r.zombie ? 1 : 0;
    const pose = o?.pose ?? q.pose;
    mqFlags[m] =
      pose === 'crouch'
        ? ENTITY_FLAG.crouching
        : pose === 'aim'
          ? ENTITY_FLAG.ads
          : pose === 'slide'
            ? ENTITY_FLAG.sliding | ENTITY_FLAG.crouching
            : 0;
    mqPose[m] =
      pose === 'crouch'
        ? ACTOR_POSE.crouch
        : pose === 'aim'
          ? ACTOR_POSE.ads
          : pose === 'slide'
            ? ACTOR_POSE.sliding | ACTOR_POSE.crouch
            : 0;
    const weapon = r.zombie ? '' : (o?.weapon ?? q.weapon);
    mqWeapon[m] = weapon ? (modelIndex.get(weapon) ?? NO_MODEL) : NO_MODEL;
    mqGrip[m] = mqWeapon[m] === NO_MODEL ? FIGURE_GRIP.none : gripOfWeaponModel(weapon);
    mqPosture[m] = figurePostureOf(
      mqFlags[m]!,
      mqGrip[m]! as FigureGrip,
      r.zombie ? ENTITY_KIND.zombie : ENTITY_KIND.bobo,
    );
    mqPitch[m] = clamp(o?.pitch ?? 0, MANNEQUIN_PITCH_MIN, MANNEQUIN_PITCH_MAX);
    mqExpression[m] = o?.expression !== undefined ? clamp(Math.round(o.expression), 0, 7) : -1;
    mqTurn[m] = ((o?.turnDeg ?? 0) * Math.PI) / 180;
    return true;
  }

  for (let m = 0; m < mqCount; m++) {
    const q = mannequins[m]!;
    const group = mannequinGroup(q.name);
    mqGroup[m] = group;
    if (group === MANNEQUIN_GROUP.always) vitrineMannequins++;
    mannequinByName.set(q.name, m);
    const line = /^linha:(\d+)$/.exec(q.name);
    if (line) mqLine[m] = Math.max(-1, Math.min(127, Number(line[1]) - 1));
    // Look fora dos presets no mapa: o recruta (o mapc já recusa; aqui só não quebra).
    if (!applyMannequin(m, null)) applyMannequin(m, { name: q.name, look: 'recruit' });
    sampleLightGrid(loaded.lightGrid, q.x, q.y + ACTOR_LIGHT_Y, q.z, mqLight, m * 3);
  }
  /** Qual grupo de manequins de print a câmera nomeada atual mostra (`MANNEQUIN_GROUP`; `always` = só a vitrine). */
  let printFocus: number = MANNEQUIN_GROUP.always;
  /** Giro e expressões que a câmera da fila dá aos `linha:*` (o jogo gira os bonecos; as 4 câmeras são a mesma). */
  let lineTurn = 0;
  let lineExpressions = false;

  // --- clipe do gancho dos prints (`setFigureClip`): um manequim posado pelo motor com dt fixo ---
  let clipRun: FigureClipRun | null = null;
  let clipMannequin = -1;
  let clipEntity = 0;
  /** Relógio somado ao do ambiente: cada passo do clipe anda `dtS` no render, com a cena congelada. */
  let clipClock = 0;
  let clipSerial = 0;
  const clipKeysUsed = new Set<number>();

  // --- câmeras nomeadas e rotas (prints, bench) ---
  const cameraByName = new Map<string, MapCamera>();
  for (const c of doc.markers.cameras) cameraByName.set(c.name, c);
  const routeByName = new Map<string, MapCameraRoute>();
  for (const r of doc.markers.routes) routeByName.set(r.name, r);
  const cameraNames: readonly string[] = [...cameraByName.keys(), ...routeByName.keys()];
  let overrideCamera: MapCamera | null = null;
  let overrideRoute: MapCameraRoute | null = null;
  let routeTime = 0;
  const pose: CameraPose = createCameraPose();
  if (bench?.route) {
    const r = routeByName.get(bench.route);
    if (r) overrideRoute = r;
    else warnings.push(`rota desconhecida: ${bench.route}`);
  } else if (bench?.scene === 'vitrine') {
    overrideCamera = cameraByName.get('print:dia') ?? null;
  }

  // --- eventos da sim → VFX, HUD e estado cosmético ---
  let timeS = 0;
  /**
   * Gabarito e skin do boneco da entidade i: zumbi; senão o look da rotação pelo controlador (o jogador 0 é o
   * recruta, `FIGURE_BOT_ROTATION[0]`) no time dele (sem time no FFA). Tabelas prontas do loading: sem alocação.
   */
  function resolveEntityFigure(v: SimView, i: number): void {
    if (v.kind[i] === ENTITY_KIND.zombie) {
      figureOf[i] = figures.zombieFigure;
      skinLayer[i] = figures.zombieSkin;
      return;
    }
    const p = Math.max(0, v.controller[i]!) % figures.botLooks;
    const team = ffa || v.team[i] === NO_TEAM ? -1 : v.team[i]!;
    figureOf[i] = figures.botFigure(p, team);
    skinLayer[i] = figures.botSkin(p, team);
  }
  function ensureCapacity(capacity: number): void {
    if (flash.length >= capacity) return;
    flash = new Float32Array(capacity);
    recoil = new Float32Array(capacity);
    firing = new Float32Array(capacity);
    spawnT = new Float32Array(capacity).fill(-10);
    reloadStart = new Float32Array(capacity).fill(-1);
    reloadDur = new Float32Array(capacity).fill(1);
    walkPhase = new Float32Array(capacity);
    skinLayer = new Uint16Array(capacity).fill(0xffff);
    figureOf = new Uint8Array(capacity).fill(NO_FIGURE);
    velPrev = new Float32Array(capacity * 3);
    velCur = new Float32Array(capacity * 3);
  }
  /** Vista em 1ª pessoa que segue a entidade (a câmera nomeada da vista 0 não conta); -1 = nenhuma. */
  function viewOfEntity(entity: number): number {
    if (entity === NULL_ENTITY) return -1;
    for (let s = 0; s < slots.length; s++) {
      const c = slots[s]!.controller;
      if (s === 0 && (overrideCamera !== null || overrideRoute !== null)) continue;
      if (c >= 0 && sim.controllerEntity(c) === entity) return s;
    }
    return -1;
  }

  /**
   * Clarão de tiro na luz ambiente das vistas que veem o evento a até 30 m, proporcional à distância (arte-ux.md §1.8);
   * a vista do atirador recebe o clarão inteiro. Antes era um uniform global: um tiro clareava as 4 vistas.
   */
  function flashViews(x: number, y: number, z: number, owner: number): void {
    for (let s = 0; s < slots.length; s++) {
      const slot = slots[s]!;
      let d = 0;
      if (s !== owner) {
        const c = slot.desc.camera;
        const dx = c.x - x;
        const dy = c.y - y;
        const dz = c.z - z;
        d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      }
      if (d >= FLASH_RANGE_M) continue;
      slot.flash = Math.min(1, slot.flash + FLASH_GAIN * (1 - d / FLASH_RANGE_M));
    }
  }

  const onEvents = (events: readonly SimEvent[], s: Sim): void => {
    const v = s.view();
    ensureCapacity(v.capacity);
    // Velocidade: a janela anda a cada TICK (anterior ← atual ← sim), como a posição da sim. Com 2 ticks num frame
    // (Switch a 30 fps) o anterior é o tick T−1, e não o do frame passado.
    for (let i = 0; i < v.count; i++) {
      if (v.alive[i] !== 1) continue;
      const o = i * 3;
      for (let c = 0; c < 3; c++) {
        velPrev[o + c] = velCur[o + c]!;
        velCur[o + c] = v.velocity[o + c]!;
      }
    }
    const human = humans > 0 ? s.controllerEntity(0) : NULL_ENTITY;
    if (matchStats.capacity < v.capacity) matchStats = createMatchStats(v.capacity);
    for (let k = 0; k < events.length; k++) {
      const ev = events[k]!;
      recordMatchEvent(matchStats, ev, human);
      if (ev.type === 'matchPhase' && ev.phase === 'ended' && endedAt < 0) endedAt = timeS;
      switch (ev.type) {
        case 'shot': {
          const i = entityIndex(ev.shooter);
          if (i < recoil.length) {
            recoil[i] = 1;
            firing[i] = FIRING_S;
          }
          // Boca do cano aproximada (o render usa a do viewmodel para o dono em 1ª pessoa).
          const yaw = Math.atan2(-ev.dirX, -ev.dirZ);
          const rx = Math.cos(yaw);
          const rz = -Math.sin(yaw);
          const mx = ev.originX + ev.dirX * 0.7 + rx * 0.16;
          const my = ev.originY + ev.dirY * 0.7 - 0.14;
          const mz = ev.originZ + ev.dirZ * 0.7 + rz * 0.16;
          const owner = viewOfEntity(ev.shooter);
          const weapon = modelOf(ev.weapon);
          pushMuzzleFlash(fx, ev.shooter, mx, my, mz, ev.dirX, ev.dirY, ev.dirZ, owner, weapon);
          if (ev.distance > 1.5) {
            const d = ev.distance;
            pushTracer(fx, mx, my, mz, ev.originX + ev.dirX * d, ev.originY + ev.dirY * d, ev.originZ + ev.dirZ * d);
          }
          flashViews(mx, my, mz, owner);
          break;
        }
        case 'impact': {
          if (ev.prop >= 0) {
            const owner = loaded.world.colliders.owner[ev.prop] ?? -1;
            const prop = owner >= 0 ? (loaded.propRenderIndex[owner] ?? -1) : -1;
            if (prop >= 0) pushPropImpact(fx, ev.x, ev.y, ev.z, ev.normalX, ev.normalY, ev.normalZ, prop, CUBES_BLOCK);
          } else {
            pushBlockImpact(fx, ev.x, ev.y, ev.z, ev.normalX, ev.normalY, ev.normalZ, ev.block, ev.face, CUBES_BLOCK);
          }
          break;
        }
        case 'hit': {
          const i = entityIndex(ev.target);
          if (i < flash.length) flash[i] = 1;
          // `bodyPart` é a `FigurePart` (0..11, o osso da hitbox atingida): o cubinho sai da caixa desse osso.
          pushActorImpact(fx, ev.target, ev.x, ev.y, ev.z, ev.dirX, ev.dirY, ev.dirZ, ev.bodyPart, CUBES_ACTOR);
          for (let sIdx = 0; sIdx < slots.length; sIdx++) {
            const slot = slots[sIdx]!;
            if (slot.controller < 0) continue;
            const mine = s.controllerEntity(slot.controller);
            // M2 (fase 4e): a regra da partida pode desligar o hitmarker.
            if (mine === ev.shooter && showHitmarker) {
              if (ev.part === 'head') slot.model.headshotMarker = 1;
              else slot.model.hitMarker = 1;
            }
            if (mine === ev.target) {
              // De onde veio o tiro (o contrário da direção), relativo à mira (positivo = à esquerda, como o yaw).
              const from = Math.atan2(ev.dirX, ev.dirZ);
              slot.model.damageAngle = wrapAngle(from - slot.desc.camera.yaw);
              slot.model.damageAmount = 1;
              slot.damageT = DAMAGE_S;
            }
          }
          break;
        }
        case 'kill': {
          const i = entityIndex(ev.victim);
          if (i >= v.count) break;
          const o = i * 3;
          const zombie = v.kind[i] === ENTITY_KIND.zombie;
          const d = deathScratch;
          d.victim = ev.victim;
          d.x = v.position[o]!;
          d.y = v.position[o + 1]!;
          d.z = v.position[o + 2]!;
          d.yaw = v.yaw[i]!;
          d.dirX = ev.dirX;
          d.dirY = ev.dirY;
          d.dirZ = ev.dirZ;
          d.force = ev.force;
          // Parte do golpe final como `FigurePart` (0..11): o desmonte solta o grupo desse osso.
          d.bodyPart = ev.bodyPart;
          ensureCapacity(v.capacity);
          if (skinLayer[i] === 0xffff) resolveEntityFigure(v, i);
          d.skin = skinLayer[i]!;
          d.figure = figureOf[i]!;
          d.scale = 1;
          d.kind = zombie ? ACTOR_KIND.zombie : ACTOR_KIND.bobo;
          pushDeath(fx, d);
          onDeath(s, ev.victim, ev.killer, ev.weapon);
          feedKill(v, ev.victim, ev.killer, ev.weapon, ev.headshot);
          break;
        }
        case 'spawn': {
          const i = entityIndex(ev.entity);
          ensureCapacity(v.capacity);
          spawnT[i] = timeS;
          resolveEntityFigure(v, i);
          // Velocidade do boneco novo começa do zero (sem herdar a do dono anterior do índice).
          velPrev.fill(0, i * 3, i * 3 + 3);
          velCur.fill(0, i * 3, i * 3 + 3);
          reloadStart[i] = -1;
          if (humans > 0 && ev.entity === s.controllerEntity(0)) {
            player.setAngles(v.yaw[i]!, 0);
            player.setWeapon(v.slot[i]!);
          }
          for (let sIdx = 0; sIdx < slots.length; sIdx++) {
            const slot = slots[sIdx]!;
            if (slot.death.t >= 0 && slot.death.victim === ev.entity) endDeath(slot.death);
          }
          break;
        }
        case 'weapon': {
          const i = entityIndex(ev.entity);
          if (i >= reloadStart.length) break;
          // A sim trocou de slot sozinha (acabou a granada): o mapeador do humano passa a pedir o slot da mão.
          if (
            ev.action === 'switch' &&
            humans > 0 &&
            ev.entity === s.controllerEntity(0) &&
            player.weapon !== v.slot[i]
          ) {
            player.setWeapon(v.slot[i]!);
          }
          if (ev.action === 'reloadStart') {
            reloadStart[i] = timeS;
            const def = weaponDef(ev.weapon);
            reloadDur[i] = def ? (def.reloadPerRoundS > 0 ? def.reloadPerRoundS : def.reloadS) : 2;
          } else if (ev.action === 'reloadEnd') {
            reloadStart[i] = -1;
          } else if (ev.action === 'switch' && humans > 0 && ev.entity === s.controllerEntity(0)) {
            player.setWeapon(ev.weapon);
          }
          break;
        }
        case 'melee': {
          const i = entityIndex(ev.attacker);
          if (i < firing.length) firing[i] = FIRING_S * 3;
          break;
        }
        case 'explosion': {
          pushExplosion(fx, ev.x, ev.y, ev.z, ev.radius);
          flashViews(ev.x, ev.y, ev.z, -1);
          for (let sIdx = 0; sIdx < slots.length; sIdx++) {
            const slot = slots[sIdx]!;
            const c = slot.desc.camera;
            const d = Math.hypot(c.x - ev.x, c.y - ev.y, c.z - ev.z);
            if (d < SHAKE_RANGE_M) slot.shake = Math.min(1, slot.shake + (1 - d / SHAKE_RANGE_M));
          }
          break;
        }
        case 'projectile': {
          if (ev.action !== 'launch' || ev.weapon !== WEAPON_CODE.rocket) break;
          const i = entityIndex(ev.owner);
          if (i < recoil.length) {
            recoil[i] = 1;
            firing[i] = FIRING_S;
          }
          const speed = Math.hypot(ev.vx, ev.vy, ev.vz);
          if (speed > 1e-6) {
            const dx = ev.vx / speed;
            const dy = ev.vy / speed;
            const dz = ev.vz / speed;
            const mx = ev.x + dx * 0.8;
            const my = ev.y + dy * 0.8 - 0.1;
            const mz = ev.z + dz * 0.8;
            const owner = viewOfEntity(ev.owner);
            pushMuzzleFlash(fx, ev.owner, mx, my, mz, dx, dy, dz, owner, modelOf(ev.weapon));
            flashViews(mx, my, mz, owner);
          }
          break;
        }
        case 'unstuck':
          // Raro (anti-frustração): pode montar a string aqui.
          log.warn(
            `destravar: bobo ${entityIndex(ev.entity)} preso em (${ev.fromX.toFixed(1)}, ${ev.fromY.toFixed(1)}, ` +
              `${ev.fromZ.toFixed(1)})${ev.respawned ? ' → spawn' : ''}`,
          );
          break;
        default:
          break;
      }
    }
  };

  const driver = createLocalDriver({
    recipe,
    map: loaded.simMap,
    humans,
    writeHumanFrame: (_slot, out, seq) => {
      player.writeFrame(out, seq);
      // M2 (fase 2e): "Destravar" da pausa vira o botão por um tick (a sim age na borda).
      if (unstuckPending) {
        out.buttons |= BUTTON.unstuck;
        unstuckPending = false;
      }
    },
    onEvents,
    ...(bench ? { hz: bench.simHz, zombies: bench.zombies } : {}),
    budget: aiBudgetFor(profile),
    now,
    // A MESMA tabela que o render recebeu no `setFigures` (a hitbox e a pose de 3ª pessoa saem dela).
    figureTable: figures.table,
    // Bench: a primária fixa do `weapons=` (fuzil por padrão, comparável ao M1); fora dele, o sorteio dos bots.
    ...(bench ? { primaries: benchPrimaries(bench.weapons) } : {}),
    // M2 (fase 2d): a contagem de 3 s só nas partidas de verdade (o bench, a vitrine e os prints começam jogando).
    ...(request.kind === 'play' ? { countdownS: MATCH_DEFAULTS.countdownS } : {}),
  });
  const sim = driver.sim;
  {
    const v = sim.view();
    ensureCapacity(v.capacity);
    for (let i = 0; i < v.count; i++) {
      if (v.alive[i] !== 1) continue;
      resolveEntityFigure(v, i);
    }
  }

  // Quem cada vista segue: o humano 0, ou (bench) bots espalhados pelos dois times.
  if (humans > 0) {
    slots[0]!.controller = 0;
    const v = sim.view();
    const e = entityIndex(sim.controllerEntity(0));
    player.setAngles(v.yaw[e]!, 0);
    player.setWeapon(v.weapon[e]!);
  } else {
    const byTeam: number[][] = [[], [], [], []];
    for (const slot of expandRecipe(recipe, 0)) if (slot.bot !== null) byTeam[slot.team]?.push(slot.controller);
    for (let i = 0; i < slots.length; i++) {
      const team = byTeam[i % 2]!.length > Math.floor(i / 2) ? i % 2 : (i + 1) % 2;
      slots[i]!.controller = byTeam[team]![Math.floor(i / 2)] ?? byTeam[0]![i] ?? -1;
    }
  }

  // --- mapeador, pausa, painel F2 ---
  const pauseMenu = createMenuController();
  pauseMenu.setRoot(pauseScreen.build(null));
  const touchOverlay = createTouchOverlay();
  /** Rascunho do quadro do overlay de toque (preenchido por frame, sem objeto novo). */
  const touchFrame = { width: 0, height: 0, pixelRatio: 1, minTextPx: 0 };
  const panel = createDebugPanelModel();
  panel.profile = profile.id;
  panel.textureMode = renderer.info.textureMode;
  panel.vertexAttributes = renderer.info.vertexAttributes;
  panel.viewDistanceM = far;
  panel.gpuFinish = debugState.gpuFinish;
  panel.simHz = sim.hz;
  panel.zombies = bench?.zombies ?? 0;
  let f2Down = false;
  const f2Frames = createSamples(F2_WINDOW);
  let heapMaxMb = -1;
  let heapLimitMb = -1;
  let heapCheckS = 0;
  let paused = false;
  let frozen = false;
  let disposed = false;
  let hudVisible = bench ? bench.hud : true;
  let lastPointerLocked = false;
  platform.lifecycle.setInMatch(request.kind !== 'bench');

  // --- bench ---
  const benchState = bench
    ? {
        phase: 'warmup' as 'warmup' | 'measure' | 'done',
        t: 0,
        frames: createSamples(Math.min(1 << 20, Math.ceil(bench.durationS * 240) + 16), false),
        cpu: createSamples(Math.min(1 << 20, Math.ceil(bench.durationS * 240) + 16), false),
        gpu: createSamples(Math.min(1 << 20, Math.ceil(bench.durationS * 240) + 16), false),
        sim: createSamples(Math.min(1 << 20, Math.ceil(bench.durationS * 240) + 16), false),
        ai: createSamples(Math.min(1 << 20, Math.ceil(bench.durationS * 240) + 16), false),
        render: createSamples(Math.min(1 << 20, Math.ceil(bench.durationS * 240) + 16), false),
        ui: createSamples(Math.min(1 << 20, Math.ceil(bench.durationS * 240) + 16), false),
        /** Por vista: draws, triângulos, regiões, grupos de props, atores e draws de bonecos (#56). */
        viewSums: new Float64Array(4 * VIEW_SUM_FIELDS),
        viewFrames: 0,
        /** Bonecos por nível de animação (L0, L1, L2), somados por frame medido (#56). */
        lodSums: new Float64Array(3),
        /** Maior número de bonecos fora da capacidade da malha num frame medido (somem da tela). */
        bodiesOut: 0,
        gcPauses: 0,
        ema: 0,
        stalls: 0,
        firstMinute: createSamples(240 * THERMAL_WINDOW_S, false),
        /** Só os frames dos últimos 60 s POR TEMPO (antes eram as últimas 14.400 amostras: 8 min a 30 fps). */
        lastFrames: createSamples(240 * THERMAL_WINDOW_S, true),
        lastStartT: -1,
        // Sim e IA por frame: soma (média sem viés com relógio em ms inteiros), máximo e ticks rodados.
        simSum: 0,
        aiSum: 0,
        simMax: 0,
        aiMax: 0,
        ticks: 0,
        // Frames lentos por faixa (40–60, 60–100, 100–250, 250+ ms) e vãos de ciclo de vida (> 1 s, fora das stats).
        slow: new Uint32Array(4),
        gaps: 0,
        // Começo da partida (desde o 1º frame, aquecimento incluído): o item 15 sai daqui.
        startFrames: 0,
        startFirst: -1,
        startMax: 0,
        startStalls: 0,
        // Pior frame lento da janela atual (vira UMA linha `[bench] pico` no fim da janela).
        windowEnd: 0,
        spikeT: -1,
        spikeFrame: 0,
        spikeCpu: 0,
        spikeSim: 0,
        spikeAi: 0,
        spikeRender: 0,
        spikeUi: 0,
        spikeTicks: 0,
        // Heap usado (MB) no frame do pico; -1 = a plataforma não informa.
        spikeHeap: -1,
        spikeHeap1s: -1,
        report: null as string | null,
      }
    : null;
  const frameTarget = 1000 / profile.targetFps;
  /** Pico = frame (ou CPU) acima de 1,5× o alvo do perfil (Switch 30 fps: 50 ms; PC 60 fps: 25 ms). */
  const spikeLimitMs = frameTarget * 1.5;
  const spikeWindowS = bench ? Math.max(1, bench.durationS / SPIKE_WINDOWS) : 1;
  let system = platform.id as string;
  let gpuName = 'desconhecida';
  platform.diagnostics.collectReport().then(
    (r) => {
      system = r.system;
      gpuName = r.gpu;
    },
    () => undefined,
  );

  // --- gancho dos prints ---
  let stableFrames = 0;
  let framesDrawn = 0;
  // Folha das fontes em uso (#54): o atlas é o `ui-fonts` de sempre, sem carga à parte.
  let fontSpecimen = false;
  const waiters: { target: number; resolve: () => void }[] = [];
  const changed = (): void => {
    stableFrames = 0;
  };
  function applyDebug(): void {
    renderer.setDebug(debugState);
    changed();
  }
  /** O clipe do gancho ainda está andando (os prints esperam). */
  const clipPending = (): boolean => clipRun !== null && !clipRun.done;
  const debugApi: GameDebugApi = {
    get readyForPrint(): boolean {
      return !disposed && stableFrames >= 3 && !clipPending();
    },
    cameras: cameraNames,
    setCamera(name: string | null): boolean {
      if (name === null) {
        overrideCamera = null;
        overrideRoute = null;
        printFocus = MANNEQUIN_GROUP.always;
        lineTurn = 0;
        lineExpressions = false;
        changed();
        return true;
      }
      const cam = cameraByName.get(name);
      const route = routeByName.get(name);
      if (!cam && !route) return false;
      overrideCamera = cam ?? null;
      overrideRoute = cam ? null : (route ?? null);
      printFocus = cameraGroup(name);
      lineTurn = name === 'print:linha-3-4' ? LINE_TURN_3_4 : name === 'print:linha-costas' ? LINE_TURN_BACK : 0;
      lineExpressions = name === 'print:linha-expressoes';
      routeTime = 0;
      changed();
      return true;
    },
    setTimeOfDay(timeOfDay: TimeOfDay): void {
      env.timeOfDay = timeOfDay;
      changed();
    },
    setPropDose(dose: PropDoseView): void {
      debugState.propDose = dose;
      applyDebug();
    },
    setGrayscale(on: boolean): void {
      debugState.grayscale = on;
      applyDebug();
    },
    setMipFilter(filter: MipFilterMode): void {
      debugState.mipFilter = filter;
      applyDebug();
    },
    setHudVisible(visible: boolean): void {
      hudVisible = visible;
      changed();
    },
    setViewmodelVisible(visible: boolean): void {
      debugState.hideViewmodel = !visible;
      applyDebug();
    },
    showResult(): void {
      if (humans > 0 && !resultShown) showResult();
      changed();
    },
    setFrozen(on: boolean): void {
      frozen = on;
      changed();
    },
    showFontSpecimen(on: boolean): void {
      fontSpecimen = on;
      changed();
    },
    whenReady(frames = 3): Promise<void> {
      return new Promise((resolve) => waiters.push({ target: framesDrawn + Math.max(1, frames), resolve }));
    },
    setMannequins(overrides: readonly MannequinOverride[]): boolean {
      if (disposed) return false;
      // Confere tudo antes de mudar qualquer coisa: nome, campos e look de cada ajuste.
      const byIndex = new Map<number, MannequinOverride>();
      for (const o of overrides) {
        const m = mannequinByName.get(o.name);
        if (m === undefined || !validOverride(o) || !mannequinLook(m, o)) return false;
        byIndex.set(m, o);
      }
      // As skins pedidas sob demanda pela lista anterior saem antes (a vaga volta para a lista nova).
      figures.releaseOnDemand();
      for (let m = 0; m < mqCount; m++) {
        const o = byIndex.get(m) ?? null;
        if (!applyMannequin(m, o) && o) applyMannequin(m, null);
      }
      // Look novo (cabelo ou chapéu por cima): os gabaritos cresceram; os índices de antes continuam valendo.
      if (figures.takeTemplatesChanged()) renderer.setFigures(figures.templates, figures.table);
      changed();
      return true;
    },
    setFigureClip(clip: FigureClipFrame | null): boolean {
      if (disposed) return false;
      if (clip === null) {
        clipRun = null;
        clipMannequin = -1;
        changed();
        return true;
      }
      const m = mannequinByName.get(clip.mannequin);
      const run = createFigureClip(clip.clip, clip.frame, clip.dtS);
      if (m === undefined || !run) return false;
      // Entidade nova por pedido: o rig começa do zero. A mesma chave para o mesmo pedido (a respiração do boneco sai
      // dela e o print repete igual); um pedido repetido na sessão ganha outra (o rig ainda lembraria da anterior).
      const text = `${m}|${clip.clip}|${clip.frame}|${clip.dtS}`;
      let h = 0x811c9dc5;
      for (let k = 0; k < text.length; k++) h = Math.imul(h ^ text.charCodeAt(k), 0x01000193);
      let key = (CLIP_ENTITY | ((h >>> 0) & 0x7fff)) >>> 0;
      if (clipKeysUsed.has(key)) key = (CLIP_ENTITY | 0x8000 | (clipSerial++ & 0x7fff)) >>> 0;
      // Teto do registro (regra 21): passou, esquece (no pior caso um pedido repetido reaproveita a chave).
      if (clipKeysUsed.size >= CLIP_KEYS_MAX) clipKeysUsed.clear();
      clipKeysUsed.add(key);
      clipRun = run;
      clipMannequin = m;
      clipEntity = key;
      frozen = true;
      changed();
      return true;
    },
  };

  /**
   * Rastro dos 2 primeiros frames da partida no log (`runtime.log` no Switch, gravado na hora): se o app cair no
   * primeiro frame (GL do nx.js, emulador), a última linha diz em que etapa.
   */
  const trace = (stage: string, a = -1, b = -1): void => {
    // Os números vêm separados e o texto só é montado aqui dentro: depois do 3º frame não aloca nada (regra 11).
    if (framesDrawn >= 3) return;
    const m = platform.diagnostics.memoryUsage?.() ?? null;
    const heap = m ? ` heap=${Math.round(m.usedHeapBytes / 1e5) / 10}MB` : '';
    const detail = b >= 0 ? ` (${a} draws, ${b} programas)` : a >= 0 ? ` (${a})` : '';
    host.log(`[cena] frame ${framesDrawn + 1}: ${stage}${detail}${heap}`);
  };
  /** Tempos dos 3 primeiros frames no log (item 15: a travada de shader aparece no começo). */
  const traceTimes = (cpuMs: number, frameMs: number): void => {
    if (framesDrawn >= 3) return;
    host.log(`[cena] frame ${framesDrawn + 1}: fim cpu_ms=${cpuMs.toFixed(1)} intervalo_ms=${frameMs.toFixed(1)}`);
  };

  /** Ticks rodados no último frame (o diagnóstico de picos do bench). */
  let lastTicks = 0;

  // --- funções do frame ---
  function useDevice(next: DeviceKind, pad: number): void {
    if (next === device && (next !== 'gamepad' || pad === padIndex)) return;
    const changedKind = next !== device;
    device = next;
    padIndex = pad;
    player.setDevice(bindingFor(next, pad));
    if (changedKind) player.setProfile(profiles[next]);
  }

  /**
   * M2 (fase 3h): antes do `update` do mapeador, procura o alvo da assistência pela mira atual (olho e alvos no estado
   * interpolado do último quadro) e devolve a fricção (multiplicador da sensibilidade).
   */
  function aimAssistBefore(): number {
    const level = assistAllowed ? player.profile.aimAssist : 0;
    assist.target = -1;
    assist.scale = 1;
    if (level <= 0) return 1;
    const v = sim.view();
    const e = entityIndex(sim.controllerEntity(0));
    if (e < 0 || v.alive[e] !== 1 || (v.flags[e]! & ENTITY_FLAG.dead) !== 0) return 1;
    const a = driver.alpha;
    const o = e * 3;
    const ex = v.prevPosition[o]! + (v.position[o]! - v.prevPosition[o]!) * a;
    const ey = v.prevPosition[o + 1]! + (v.position[o + 1]! - v.prevPosition[o + 1]!) * a + eyeHeightFor(v.flags[e]!);
    const ez = v.prevPosition[o + 2]! + (v.position[o + 2]! - v.prevPosition[o + 2]!) * a;
    findAimAssist(v, e, ffa, ex, ey, ez, player.yaw, player.pitch, level, a, far, assist);
    return assist.scale;
  }

  /** Depois do `update`: o ímã (mexendo a mira ou andando) e, no Forte, a trava ao apertar o ADS. */
  function aimAssistAfter(dt: number, looked: boolean): void {
    if (assist.target < 0) return;
    const level = assistAllowed ? player.profile.aimAssist : 0;
    if (level >= AIM_ASSIST.snapLevel && player.wasPressed('ads')) {
      player.setAngles(assist.targetYaw, assist.targetPitch);
      return;
    }
    const active = looked || player.moveX !== 0 || player.moveY !== 0;
    pullAim(assist, level, dt, active, player.yaw, player.pitch, assistAngles);
    if (assistAngles[0] !== player.yaw || assistAngles[1] !== player.pitch) {
      player.setAngles(assistAngles[0]!, assistAngles[1]!);
    }
  }

  function pause(): void {
    if (paused || disposed || humans === 0 || resultShown) return;
    paused = true;
  }

  function pauseMain(): void {
    pausePage = 'main';
    pauseMenu.setRoot(pauseScreen.build(pauseState));
  }

  /** M2 (fase 2e): uma ação da pausa (Continuar, Ajustar desafio, Ajustes, Destravar, Sair) ou das páginas dela. */
  function pauseAction(nav: { readonly back: boolean; readonly activated: string | null }): SceneSignal {
    const a = nav.activated;
    if (pausePage === 'main') {
      if (nav.back || a === PAUSE_ACTION.resume) resume();
      else if (a === PAUSE_ACTION.challenge) {
        pausePage = 'challenge';
        pauseMenu.setRoot(challengeScreen.build(currentLevel));
      } else if (a === PAUSE_ACTION.settings) {
        pausePage = 'settings';
        pauseMenu.setRoot(settingsScreen.build(null));
      } else if (a === PAUSE_ACTION.unstuck) {
        unstuckPending = true;
        resume();
      } else if (a === PAUSE_ACTION.quit) return 'quit';
      return 'none';
    }
    if (pausePage === 'challenge') {
      const level = challengeLevel(a);
      if (level !== null) {
        currentLevel = level;
        const n = driver.director.setLevel(level, challengeTeam);
        host.log(`[partida] desafio: ${level} (${n} bots)`);
        pauseMain();
      } else if (nav.back || a === 'back') pauseMain();
      return 'none';
    }
    if (nav.back || a === SETTINGS_ACTION.back) pauseMain();
    return 'none';
  }

  /** M2 (fase 2e): monta a tela de resultado com as contas da partida (uma vez, no fim). */
  /** M2 (fase 4e): o que o resultado mostra (para refazer a tela ao salvar o preset). */
  let resultData: ResultScreenData | null = null;
  function showResult(): void {
    const v = sim.view();
    const human = humans > 0 ? entityIndex(sim.controllerEntity(0)) : -1;
    const sum = summarizeMatch(matchStats, v, human, ffa);
    const nm = (i: number): string => (i >= 0 ? nameOf(v, i) : '');
    const title =
      sum.outcome === 'win'
        ? t('result.win')
        : sum.outcome === 'draw'
          ? t('result.draw')
          : ffa && sum.winner >= 0
            ? t('result.ffaWinner', { name: nm(sum.winner) })
            : t('result.loss');
    const data: ResultScreenData = {
      title,
      titleColor: sum.outcome === 'win' ? COLORS.acao : sum.outcome === 'loss' ? COLORS.perigo : COLORS.texto,
      own: sum.ownScore,
      other: sum.otherScore,
      mvp: nm(sum.mvp),
      nemesis: nm(sum.nemesis),
      nemesisKills: sum.nemesisKills,
      victim: nm(sum.victim),
      victimKills: sum.victimKills,
      kills: sum.kills,
      accuracy: sum.accuracy >= 0 ? `${sum.accuracy}%` : t('result.noAccuracy'),
      bestStreak: sum.bestStreak,
      prizes: sum.prizes.map((p) => prizeLine(p.prize, nm(p.entity))),
      level: t(`level.${currentLevel}` as StringKey),
      canEasier: currentLevel !== BOT_LEVELS[0],
      canHarder: currentLevel !== BOT_LEVELS[BOT_LEVELS.length - 1],
      focusEasier: sum.uglyLoss || hardHintUsed,
    };
    resultData = data;
    resultMenu.setRoot(resultScreen.build(data));
    resultShown = true;
    host.log(`[partida] fim: ${sum.outcome} ${sum.ownScore}×${sum.otherScore} abates=${sum.kills}`);
  }

  function resume(): void {
    if (!paused || disposed) return;
    paused = false;
    if (pausePage !== 'main') pauseMain();
    // Botões apertados no menu de pausa (o clique em "Continuar") não podem virar tiro no primeiro tick.
    player.writeFrame(drain, 0);
  }

  /**
   * O `ActorBuffer` do frame (#56): o boneco do FutBobo de cada entidade viva (gabarito, skin de 2 camadas, postura da
   * MESMA `figurePostureOf` da sim, expressão e velocidade interpolada) e os manequins do grupo da câmera. A piscada, a
   * passada e o resto da animação são do rig do render.
   */
  function fillActors(alpha: number, dt: number): void {
    // quente:
    const v = sim.view();
    ensureCapacity(v.capacity);
    const grid = loaded.lightGrid;
    let n = 0;
    for (let i = 0; i < v.count && n < actors.capacity; i++) {
      if (v.alive[i] !== 1) continue;
      const kind = v.kind[i]!;
      if (kind !== ENTITY_KIND.bobo && kind !== ENTITY_KIND.zombie) continue;
      const flags = v.flags[i]!;
      if (flags & ENTITY_FLAG.dead) continue;
      const o = i * 3;
      const k = n * 3;
      const x = lerp(v.prevPosition[o]!, v.position[o]!, alpha);
      const y = lerp(v.prevPosition[o + 1]!, v.position[o + 1]!, alpha);
      const z = lerp(v.prevPosition[o + 2]!, v.position[o + 2]!, alpha);
      actors.position[k] = x;
      actors.position[k + 1] = y;
      actors.position[k + 2] = z;
      actors.yaw[n] = lerpAngle(v.prevYaw[i]!, v.yaw[i]!, alpha);
      actors.pitch[n] = lerp(v.prevPitch[i]!, v.pitch[i]!, alpha);
      let pose = 0;
      if (flags & ENTITY_FLAG.crouching) pose |= ACTOR_POSE.crouch;
      if (flags & ENTITY_FLAG.ads) pose |= ACTOR_POSE.ads;
      if (flags & ENTITY_FLAG.sprinting) pose |= ACTOR_POSE.sprint;
      if (flags & ENTITY_FLAG.sliding) pose |= ACTOR_POSE.sliding;
      if ((flags & ENTITY_FLAG.onGround) === 0) pose |= ACTOR_POSE.airborne;
      if (firing[i]! > 0) pose |= ACTOR_POSE.firing;
      if (timeS - spawnT[i]! < SPAWN_S) pose |= ACTOR_POSE.spawning;
      actors.pose[n] = pose;
      if (skinLayer[i] === 0xffff) resolveEntityFigure(v, i);
      actors.skin[n] = skinLayer[i]!;
      actors.figure[n] = figureOf[i]!;
      // A mesma função e a mesma empunhadura (`WeaponDef.grip`) da hitbox da sim (E.12).
      actors.posture[n] = figurePostureOf(flags, weaponGrip(v.weapon[i]!), kind);
      actors.team[n] = ffa ? 255 : v.team[i]!;
      const zombie = kind === ENTITY_KIND.zombie;
      actors.weapon[n] = zombie ? NO_MODEL : modelOf(v.weapon[i]!);
      actors.damageFlash[n] = flash[i]!;
      const id = makeEntityId(i, v.generation[i]!);
      const local = viewOfEntity(id);
      actors.localSlot[n] = local >= 0 ? local : 255;
      actors.entity[n] = id;
      actors.kind[n] = zombie ? ACTOR_KIND.zombie : ACTOR_KIND.bobo;
      actors.scale[n] = 1;
      let expression: number = FACE_EXPRESSION.neutral;
      if (flash[i]! > 0.3) expression = FACE_EXPRESSION.pain;
      else if (zombie) expression = FACE_EXPRESSION.angry;
      else if (flags & ENTITY_FLAG.ads) expression = FACE_EXPRESSION.aiming;
      else if (firing[i]! > 0) expression = FACE_EXPRESSION.angry;
      actors.expression[n] = expression;
      sampleLightGrid(grid, x, y + ACTOR_LIGHT_Y, z, actors.light, k);
      const vx = lerp(velPrev[o]!, velCur[o]!, alpha);
      const vz = lerp(velPrev[o + 2]!, velCur[o + 2]!, alpha);
      actors.velocity[k] = vx;
      actors.velocity[k + 1] = lerp(velPrev[o + 1]!, velCur[o + 1]!, alpha);
      actors.velocity[k + 2] = vz;
      // Balanço do viewmodel (1ª pessoa) pela distância andada; o boneco de 3ª pessoa anda pelo rig.
      const speed = (flags & ENTITY_FLAG.onGround) !== 0 ? Math.sqrt(vx * vx + vz * vz) : 0;
      walkPhase[i] = (walkPhase[i]! + ((speed * dt) / STRIDE_M) * Math.PI * 2) % (Math.PI * 64);
      const r0 = reloadStart[i]!;
      actors.reload[n] = r0 >= 0 ? clamp((timeS - r0) / Math.max(0.1, reloadDur[i]!), 0, 1) : 0;
      actors.recoil[n] = recoil[i]!;
      n++;
    }
    // Manequins do mapa (vitrine sempre; os de print com a câmera deles): não são entidades da sim.
    for (let m = 0; m < mqCount && n < actors.capacity; m++) {
      const group = mqGroup[m]!;
      if (group !== MANNEQUIN_GROUP.always && group !== printFocus) continue;
      const q = mannequins[m]!;
      const k = n * 3;
      const line = mqLine[m]!;
      const clip = clipRun !== null && clipMannequin === m ? clipRun : null;
      const zombie = mqZombie[m] === 1;
      actors.position[k] = q.x;
      actors.position[k + 1] = q.y;
      actors.position[k + 2] = q.z;
      actors.yaw[n] = q.yaw + mqTurn[m]! + (line >= 0 ? lineTurn : 0);
      actors.pitch[n] = mqPitch[m]!;
      actors.figure[n] = mqFigure[m]!;
      actors.skin[n] = mqSkin[m]!;
      actors.team[n] = mqTeam[m]!;
      actors.weapon[n] = mqWeapon[m]!;
      actors.localSlot[n] = 255;
      actors.scale[n] = 1;
      actors.light[k] = mqLight[m * 3]!;
      actors.light[k + 1] = mqLight[m * 3 + 1]!;
      actors.light[k + 2] = mqLight[m * 3 + 2]!;
      actors.reload[n] = 0;
      actors.recoil[n] = 0;
      let expression = mqExpression[m]!;
      if (expression < 0) expression = lineExpressions && line >= 0 ? line & 7 : FACE_EXPRESSION.neutral;
      if (clip) {
        // Boneco do clipe: entidade própria (o rig anima com o motor), parado no lugar; velocidade, correr, no ar e
        // dano só no rig.
        const flags = mqFlags[m]! | (clip.sprint ? ENTITY_FLAG.sprinting : 0);
        actors.posture[n] = figurePostureOf(
          flags,
          mqGrip[m]! as FigureGrip,
          zombie ? ENTITY_KIND.zombie : ENTITY_KIND.bobo,
        );
        actors.pose[n] = mqPose[m]! | (clip.sprint ? ACTOR_POSE.sprint : 0) | (clip.airborne ? ACTOR_POSE.airborne : 0);
        actors.velocity[k] = clip.vx;
        actors.velocity[k + 1] = clip.vy;
        actors.velocity[k + 2] = clip.vz;
        actors.damageFlash[n] = clip.flash;
        if (clip.flash > 0.3) expression = FACE_EXPRESSION.pain;
        actors.entity[n] = clipEntity;
        actors.kind[n] = zombie ? ACTOR_KIND.zombie : ACTOR_KIND.bobo;
      } else {
        actors.posture[n] = mqPosture[m]!;
        actors.pose[n] = mqPose[m]!;
        actors.velocity[k] = 0;
        actors.velocity[k + 1] = 0;
        actors.velocity[k + 2] = 0;
        actors.damageFlash[n] = 0;
        // Mira ≠ 0: entidade sintética (o rig zera o pitch da entidade 0). O kind continua manequim, mas o rig a anima
        // como entidade (respira e pisca pela chave dela).
        actors.entity[n] = mqPitch[m] !== 0 ? (MANNEQUIN_AIM_ENTITY | m) >>> 0 : 0;
        actors.kind[n] = zombie ? ACTOR_KIND.zombie : ACTOR_KIND.mannequin;
      }
      actors.expression[n] = expression;
      n++;
    }
    actors.count = n;
    // fim-quente
  }

  function syncLayout(ui: UiFrame): HudScreenLayout {
    const g = platform.graphics;
    const minText =
      viewCount >= 3
        ? Math.min(ui.options.minTextPx ?? MIN_TEXT.phone, MIN_TEXT.switchSplit)
        : (ui.options.minTextPx ?? MIN_TEXT.phone);
    const safe = g.safeArea;
    const key = layoutKey;
    if (
      layout &&
      key[0] === ui.width &&
      key[1] === ui.height &&
      key[2] === minText &&
      key[3] === safe.top &&
      key[4] === safe.right &&
      key[5] === safe.bottom &&
      key[6] === safe.left
    ) {
      return layout;
    }
    key[0] = ui.width;
    key[1] = ui.height;
    key[2] = minText;
    key[3] = safe.top;
    key[4] = safe.right;
    key[5] = safe.bottom;
    key[6] = safe.left;
    layout = layoutHudScreen(viewCount, ui.width, ui.height, {
      minTextPx: minText,
      safeArea: { top: safe.top, right: safe.right, bottom: safe.bottom, left: safe.left },
      viewLocal: true,
    });
    return layout;
  }

  /**
   * M2: foguetes e granadas em voo, da `SimView.projectiles` (posição interpolada). O foguete aponta para a velocidade e
   * gira em volta dela, soltando o rastro; a granada rola enquanto voa e fica em pé parada.
   */
  function fillProjectiles(alpha: number, running: boolean): void {
    const v = sim.view();
    const pv = v.projectiles;
    let n = 0;
    for (let p = 0; p < pv.count && n < projectiles.capacity; p++) {
      if (pv.alive[p] !== 1) continue;
      const code = pv.weapon[p]!;
      const model = code === WEAPON_CODE.rocket ? rocketShellModel : modelOf(code);
      if (model === NO_MODEL) continue;
      const o = p * 3;
      const x = lerp(pv.prevPosition[o]!, pv.position[o]!, alpha);
      const y = lerp(pv.prevPosition[o + 1]!, pv.position[o + 1]!, alpha);
      const z = lerp(pv.prevPosition[o + 2]!, pv.position[o + 2]!, alpha);
      // Recém-saído do olho de quem lançou: escondido até 1,5 m (senão o fundo do foguete tapa a câmera dele).
      const owner = entityIndex(pv.owner[p]!);
      if (owner < v.count && v.alive[owner] === 1) {
        const ox = v.position[owner * 3]! - x;
        const oy = v.position[owner * 3 + 1]! + eyeHeightFor(v.flags[owner]!) - y;
        const oz = v.position[owner * 3 + 2]! - z;
        if (ox * ox + oy * oy + oz * oz < PROJECTILE_HIDE_NEAR_EYE_M * PROJECTILE_HIDE_NEAR_EYE_M) continue;
      }
      const vx = pv.velocity[o]!;
      const vy = pv.velocity[o + 1]!;
      const vz = pv.velocity[o + 2]!;
      const speed = Math.hypot(vx, vy, vz);
      const flat = Math.hypot(vx, vz);
      projectiles.model[n] = model;
      projectiles.position[n * 3] = x;
      projectiles.position[n * 3 + 1] = y;
      projectiles.position[n * 3 + 2] = z;
      projectiles.yaw[n] = flat > 1e-6 ? Math.atan2(-vx, -vz) : 0;
      if (code === WEAPON_CODE.rocket) {
        projectiles.pitch[n] = Math.atan2(vy, Math.max(flat, 1e-6));
        projectiles.roll[n] = timeS * 10 + p;
        if (running && speed > 1e-6) pushTrail(fx, x, y, z, vx / speed, vy / speed, vz / speed);
      } else {
        projectiles.pitch[n] = speed > 0.5 ? timeS * 9 + p : 0;
        projectiles.roll[n] = 0;
      }
      sampleLightGrid(loaded.lightGrid, x, y, z, lightScratch, 0);
      projectiles.light[n * 3] = lightScratch[0]!;
      projectiles.light[n * 3 + 1] = lightScratch[1]!;
      projectiles.light[n * 3 + 2] = lightScratch[2]!;
      n++;
    }
    n = fillPickups(alpha, n);
    projectiles.count = n;
  }

  /**
   * M2 (fase 2b): as caixinhas de munição, depois dos projéteis no mesmo buffer. Giram devagar no lugar (leitura de
   * "pegue-me") e piscam nos últimos 3 s antes de sumir.
   */
  function fillPickups(alpha: number, first: number): number {
    const pv = sim.view().pickups;
    let n = first;
    if (ammoBoxModel === NO_MODEL) return n;
    const blinkTicks = 3 * sim.hz;
    for (let i = 0; i < pv.count && n < projectiles.capacity; i++) {
      if (pv.alive[i] !== 1) continue;
      const left = pv.ticksLeft[i]!;
      if (left < blinkTicks && Math.floor(timeS * 6) % 2 === 1) continue;
      const o = i * 3;
      const x = pv.position[o]!;
      const y = lerp(pv.prevPosition[o + 1]!, pv.position[o + 1]!, alpha);
      const z = pv.position[o + 2]!;
      projectiles.model[n] = ammoBoxModel;
      projectiles.position[n * 3] = x;
      projectiles.position[n * 3 + 1] = y;
      projectiles.position[n * 3 + 2] = z;
      projectiles.yaw[n] = timeS * PICKUP_SPIN_RAD_S + i * 1.7;
      projectiles.pitch[n] = 0;
      projectiles.roll[n] = 0;
      sampleLightGrid(loaded.lightGrid, x, y + 0.2, z, lightScratch, 0);
      projectiles.light[n * 3] = lightScratch[0]!;
      projectiles.light[n * 3 + 1] = lightScratch[1]!;
      projectiles.light[n * 3 + 2] = lightScratch[2]!;
      n++;
    }
    return n;
  }

  /** Nome e cor de um bobo no feed e no placar: o nome do controlador; a cor do time (TDM) ou a sua (FFA). */
  function nameOf(v: SimView, i: number): string {
    return v.kind[i] === ENTITY_KIND.zombie ? deathTx.zombie : (names[v.controller[i]!] ?? deathTx.zombie);
  }
  function colorOf(v: SimView, i: number): number {
    if (!ffa && v.kind[i] !== ENTITY_KIND.zombie) return TEAM_COLORS[v.team[i]!] ?? COLORS.texto;
    return v.controller[i] === 0 && humans > 0 ? (PLAYER_COLORS[0] as number) : COLORS.texto;
  }

  /** M2 (fase 2d): uma morte no kill feed ("Normal Bob  Rattler  P1"; sem matador, "P1  Caiu no vazio"). */
  function feedKill(v: SimView, victim: number, killer: number, weapon: number, headshot: boolean): void {
    if (!showKillFeed) return;
    const vi = entityIndex(victim);
    if (vi >= v.count) return;
    const ki = entityIndex(killer);
    if (killer === NULL_ENTITY || killer === victim || ki >= v.count) {
      const cause = killer === victim ? deathTx.self : weapon === WEAPON_KILL_PLANE ? deathTx.void : deathTx.fall;
      pushKillFeed(killFeed, '', COLORS.texto, cause, nameOf(v, vi), colorOf(v, vi), false);
      return;
    }
    const label =
      weapon === WEAPON_KILL_PLANE
        ? deathTx.pushedVoid
        : weapon === WEAPON_NONE
          ? deathTx.bite
          : (weaponNames[weapon] ?? '');
    pushKillFeed(killFeed, nameOf(v, ki), colorOf(v, ki), label, nameOf(v, vi), colorOf(v, vi), headshot);
  }

  /** M2 (fase 2d): preenche o placar do Tab (bobos por abates, depois menos mortes; ordenação sem alocar). */
  function fillScoreboard(v: SimView): void {
    let n = 0;
    for (let i = 0; i < v.count && n < SCOREBOARD_MAX_ROWS; i++) {
      if (v.alive[i] !== 1 || v.kind[i] !== ENTITY_KIND.bobo) continue;
      let k = n++;
      while (k > 0) {
        const p = scoreOrder[k - 1]!;
        const better = v.kills[i]! > v.kills[p]! || (v.kills[i] === v.kills[p] && v.deaths[i]! < v.deaths[p]!);
        if (!better) break;
        scoreOrder[k] = p;
        k--;
      }
      scoreOrder[k] = i;
    }
    scoreboard.rowCount = n;
    scoreboard.teamCount = ffa ? 0 : recipe.teams.length;
    for (let tIdx = 0; tIdx < scoreboard.teamScores.length; tIdx++)
      scoreboard.teamScores[tIdx] = v.match.teamScore[tIdx] ?? 0;
    const human = humans > 0 ? entityIndex(sim.controllerEntity(0)) : -1;
    for (let r = 0; r < n; r++) {
      const i = scoreOrder[r]!;
      scoreboard.name[r] = nameOf(v, i);
      scoreboard.team[r] = v.team[i]!;
      scoreboard.kills[r] = v.kills[i]!;
      scoreboard.deaths[r] = v.deaths[i]!;
      scoreboard.assists[r] = v.assists[i]!;
      scoreboard.local[r] = i === human ? 1 : 0;
      scoreboard.dead[r] = (v.flags[i]! & ENTITY_FLAG.dead) !== 0 ? 1 : 0;
    }
  }

  /**
   * M2 (fase 2c): alguém morreu. A vista que seguia a vítima entra na tela de morte (câmera parte da mira atual). Para o
   * humano: a conta da derrota feia, a dica (1 vez por partida) e a mira zerada, que vira o cursor do radial.
   */
  function onDeath(s: Sim, victim: number, killer: number, weapon: number): void {
    const human = humans > 0 ? s.controllerEntity(0) : NULL_ENTITY;
    if (human !== NULL_ENTITY && killer === human && victim !== human) deathsWithoutKill = 0;
    for (let sIdx = 0; sIdx < slots.length; sIdx++) {
      const slot = slots[sIdx]!;
      if (slot.controller < 0 || s.controllerEntity(slot.controller) !== victim) continue;
      const c = slot.desc.camera;
      beginDeath(slot.death, victim, killer, weapon, c.yaw, c.pitch);
      if (victim !== human || slot.controller !== 0) continue;
      deathsWithoutKill++;
      if (
        !hardHintUsed &&
        (deathsWithoutKill >= HARD_TIME.deathsWithoutKill ||
          losingBadly(s.view(), entityIndex(victim), ffa, timeLimitS * s.hz, scoreLimit))
      ) {
        slot.death.hint = true;
        hardHintUsed = true;
      }
      player.setAngles(0, 0);
    }
  }

  /**
   * M2 (fase 2c): o relógio das telas de morte e o radial do humano. O giro de mira do quadro (mouse ou analógico) move
   * o cursor (a mira volta a zero a cada quadro; a câmera de morte não usa a do mapeador); a roda e os botões de troca
   * de arma passam a opção; no toque, tocar numa opção escolhe. A escolha vai para `InputFrame.primary` e vale no
   * próximo spawn.
   */
  function updateDeaths(dt: number, raw: RawInputState, lay: HudScreenLayout): void {
    for (let sIdx = 0; sIdx < slots.length; sIdx++) {
      const st = slots[sIdx]!.death;
      if (st.t < 0) continue;
      st.t += dt;
      if (sIdx !== 0 || humans === 0 || slots[sIdx]!.controller !== 0 || paused) continue;
      const n = PRIMARY_ORDER.length;
      const hit = slots[sIdx]!.model.primaryHit;
      let pick = -1;
      // O formato é o que a HUD desenhou no quadro anterior: anel pela direção; fileira e linha passo a passo.
      if (hit.layout === PRIMARY_LAYOUT.ring) {
        moveRadialCursor(st, wrapAngle(player.yaw), player.pitch);
        pick = radialIndex(st.cursorX, st.cursorY, n);
      } else {
        const step = stepCursor(st, wrapAngle(player.yaw));
        if (step !== 0) pick = (humanPrimary + step + n) % n;
      }
      player.setAngles(0, 0);
      if (player.wasPressed('nextWeapon')) pick = (humanPrimary + 1) % n;
      if (player.wasPressed('prevWeapon')) pick = (humanPrimary + n - 1) % n;
      if (device === 'touch') {
        for (let k = 0; k < raw.touches.length; k++) {
          const touch = raw.touches[k]!;
          if (!touch.active) continue;
          const tapped = hitPrimaryOption(hit, touch.x, touch.y);
          if (tapped >= 0) pick = tapped;
        }
      }
      if (pick >= 0 && pick !== humanPrimary) {
        humanPrimary = pick;
        player.setPrimary(PRIMARY_ORDER[pick]! + 1);
      }
    }
  }

  function updateView(s: number, dt: number, alpha: number, lay: HudScreenLayout): void {
    const slot = slots[s]!;
    const desc = slot.desc;
    const c = desc.camera;
    const rect = lay.rects[s]!;
    desc.x = rect.x;
    desc.y = rect.y;
    desc.width = rect.width;
    desc.height = rect.height;
    c.far = far;
    c.near = 0.05;
    desc.flash = slot.flash;
    const aspect = rect.width / Math.max(1, rect.height);
    const vm = desc.viewmodel;
    const override = s === 0 && (overrideCamera !== null || overrideRoute !== null);
    if (override) {
      if (overrideCamera) poseFromCamera(overrideCamera, pose);
      else sampleRoute(overrideRoute!, routeTime, pose);
      c.x = pose.x;
      c.y = pose.y;
      c.z = pose.z;
      c.yaw = pose.yaw;
      c.pitch = clamp(pose.pitch, -CAMERA_MAX_PITCH, CAMERA_MAX_PITCH);
      c.fovY = pose.fovY > 0 ? pose.fovY : verticalFov(fovDeg, aspect);
      desc.localSlot = -1;
      desc.team = 255;
      vm.visible = false;
      return;
    }
    const v = sim.view();
    const entity = slot.controller >= 0 ? sim.controllerEntity(slot.controller) : NULL_ENTITY;
    if (entity === NULL_ENTITY) {
      vm.visible = false;
      desc.localSlot = -1;
      return;
    }
    const e = entityIndex(entity);
    const o = e * 3;
    const flags = v.flags[e]!;
    const dead = (flags & ENTITY_FLAG.dead) !== 0;
    const targetEye = dead ? eyeHeightFor(0) : eyeHeightFor(flags);
    slot.eye = slot.eye < 0 ? targetEye : slot.eye + (targetEye - slot.eye) * Math.min(1, dt * EYE_FOLLOW);
    c.x = lerp(v.prevPosition[o]!, v.position[o]!, alpha);
    c.y = lerp(v.prevPosition[o + 1]!, v.position[o + 1]!, alpha) + slot.eye;
    c.z = lerp(v.prevPosition[o + 2]!, v.position[o + 2]!, alpha);
    const st = slot.death;
    if (dead && st.t >= 0) {
      // M2 (fase 2c): câmera de morte, um pouco acima do olho, virando para quem matou.
      c.y += DEATH_CAM.riseM * Math.min(1, st.t / DEATH_CAM.turnS);
      c.fovY = verticalFov(fovDeg, aspect);
      deathCamAngles(st, v, c.x, c.y, c.z, alpha, Math.atan(Math.tan(c.fovY / 2) * DEATH_CAM.killerLift), camAngles);
      c.yaw = camAngles.yaw;
      c.pitch = clamp(camAngles.pitch, -CAMERA_MAX_PITCH, CAMERA_MAX_PITCH);
      slot.adsBlend = 0;
      desc.localSlot = s;
      desc.team = ffa ? 255 : v.team[e]!;
      desc.thirdPerson = false;
      vm.visible = false;
      return;
    }
    const human = humans > 0 && slot.controller === 0;
    // Humano: a mira vem do mapeador em todo frame de render (sem esperar o tick); bot: a da sim, interpolada.
    const yaw = human ? player.yaw : lerpAngle(v.prevYaw[e]!, v.yaw[e]!, alpha);
    const pitch = human ? player.pitch : lerp(v.prevPitch[e]!, v.pitch[e]!, alpha);
    slot.shake = Math.max(0, slot.shake - dt * SHAKE_DECAY_PER_S);
    const shakeYaw = Math.sin(timeS * 47) * SHAKE_AMPLITUDE * slot.shake;
    const shakePitch = Math.sin(timeS * 53 + 1) * SHAKE_AMPLITUDE * slot.shake;
    c.yaw = yaw + v.recoilYaw[e]! + shakeYaw;
    c.pitch = clamp(pitch + v.recoilPitch[e]! + shakePitch, -CAMERA_MAX_PITCH, CAMERA_MAX_PITCH);
    const adsWanted = human ? !dead && !paused && player.isDown('ads') : (flags & ENTITY_FLAG.ads) !== 0;
    const adsTarget = adsWanted && !dead ? 1 : 0;
    // M2: o ADS entra no tempo da arma na mão (`adsInS`) e o zoom é o dela (`adsZoom`; a sniper tem 4x).
    const held = weaponDef(v.weapon[e]!);
    const blend = dt / (held !== null && held.adsInS > 0 ? held.adsInS : ADS_BLEND_S);
    slot.adsBlend =
      adsTarget > slot.adsBlend
        ? Math.min(adsTarget, slot.adsBlend + blend)
        : Math.max(adsTarget, slot.adsBlend - blend);
    const zoom = 1 + ((held !== null ? held.adsZoom : 1 / ADS_FOV_SCALE) - 1) * slot.adsBlend;
    c.fovY = 2 * Math.atan(Math.tan(verticalFov(fovDeg, aspect) / 2) / zoom);
    desc.localSlot = s;
    desc.team = ffa ? 255 : v.team[e]!;
    desc.thirdPerson = false;
    // Viewmodel: a arma da mão, com mola simples (ADS, passo, coice); luz amostrada no olho.
    const model = modelOf(v.weapon[e]!);
    // Na luneta (zoom ≥ 3x quase todo dentro) a arma sai da frente; a moldura da luneta é da HUD (fase 1e).
    const scoped = held !== null && held.adsZoom >= 3 && slot.adsBlend > 0.85;
    vm.visible = !dead && model !== NO_MODEL && !scoped;
    vm.model = model;
    const aim = model !== NO_MODEL ? aimOffsets[model] : null;
    const ads = slot.adsBlend;
    const walk = (1 - ads) * Math.min(1, Math.hypot(v.velocity[o]!, v.velocity[o + 2]!) / RUN_SPEED);
    const phase = walkPhase[e] ?? 0;
    const kick = recoil[e] ?? 0;
    // M2: ajuste por arma fora do ADS (o lança-foguetes é grosso e vai mais longe e menor).
    const tweak = VIEWMODEL_TWEAK[v.weapon[e]!] ?? null;
    const away = 1 - ads;
    vm.offsetX = (aim ? aim.x * ads : 0) + Math.sin(phase * 0.5) * 0.012 * walk + (tweak ? tweak.x * away : 0);
    vm.offsetY = (aim ? aim.y * ads : 0) - Math.abs(Math.cos(phase * 0.5)) * 0.01 * walk + (tweak ? tweak.y * away : 0);
    vm.offsetZ = kick * 0.045 + (tweak ? tweak.z * away : 0);
    vm.pitch = kick * 0.06;
    vm.yaw = 0;
    vm.roll = 0;
    // Braços do viewmodel com a skin do boneco do dono (1ª das 2 camadas, a mesma do `ActorBuffer.skin`).
    vm.skin = skinLayer[e] !== 0xffff ? skinLayer[e]! : 0;
    // [PROPOSTA] da integração: a pose da render-atores com a arma inteira passava de 40% da tela; 0,8 em 1–2P e
    // 0,6 em 3–4P deixam a arma no canto (arte-ux.md §3.3: no máximo 25% da vista no 3–4P).
    vm.scale = (viewCount >= 3 ? 0.6 : 0.8) * (tweak ? tweak.scale : 1);
    sampleLightGrid(loaded.lightGrid, c.x, c.y, c.z, lightScratch, 0);
    vm.lightSky = lightScratch[0]!;
    vm.lightSun = lightScratch[1]!;
    vm.lightEmissive = lightScratch[2]!;
  }

  function fillHud(s: number, fonts: UiFonts | null, lay: HudScreenLayout, ui: UiFrame, rawLocked: boolean): void {
    const slot = slots[s]!;
    const m = slot.model;
    const desc = slot.desc;
    resetDrawList(slot.hud, desc.width, desc.height);
    const entity = slot.controller >= 0 ? sim.controllerEntity(slot.controller) : NULL_ENTITY;
    const override = s === 0 && (overrideCamera !== null || overrideRoute !== null);
    // M2 (fase 2e): com o resultado na tela, a HUD sai (o véu e os botões ficam limpos).
    if (!hudVisible || entity === NULL_ENTITY || override || fontSpecimen || resultShown) {
      desc.hud = null;
      return;
    }
    const v = sim.view();
    const e = entityIndex(entity);
    const flags = v.flags[e]!;
    m.health = v.health[e]!;
    m.maxHealth = recipe.players?.hp ?? 100;
    m.clip = heldClip(v, e);
    m.reserve = heldReserve(v, e);
    m.kills = v.kills[e]!;
    m.deaths = v.deaths[e]!;
    m.dead = (flags & ENTITY_FLAG.dead) !== 0;
    m.respawnS = m.dead ? v.respawnTicks[e]! / sim.hz : 0;
    // M2 (fase 3e): avisos dos bots aliados N3 ("inimigo aqui"), só na vista do humano.
    m.pingCount = 0;
    if (!ffa && humans > 0 && slot.controller === 0) {
      const n = driver.director.pings(v.team[e]!, Math.round(PING_SHOW_S * sim.hz), pingScratch);
      for (let k = 0; k < n && m.pingCount < MAX_TEAM_PINGS; k++) {
        const o = k * 3;
        if (
          !projectToView(
            desc.camera,
            lay.rects[s]!,
            pingScratch[o]!,
            pingScratch[o + 1]! + 1.2,
            pingScratch[o + 2]!,
            projected,
          )
        ) {
          continue;
        }
        // Avisos quase no mesmo lugar da tela viram um losango só (vários bots avisam o mesmo inimigo).
        const near = PING_MERGE_FRAC * lay.rects[s]!.height;
        let dup = false;
        for (let q = 0; q < m.pingCount && !dup; q++) {
          dup =
            Math.abs(m.pings[q * 2]! - projected[0]!) < near && Math.abs(m.pings[q * 2 + 1]! - projected[1]!) < near;
        }
        if (dup) continue;
        m.pings[m.pingCount * 2] = projected[0]!;
        m.pings[m.pingCount * 2 + 1] = projected[1]!;
        m.pingCount++;
      }
    }
    // M2 (fase 2d): marcadores dos aliados (TDM), projetados com a câmera desta vista.
    m.markerCount = 0;
    if (!ffa && showAllyMarkers) {
      const team = v.team[e]!;
      m.markerColor = TEAM_COLORS[team] ?? COLORS.texto;
      const c = desc.camera;
      const rect = lay.rects[s]!;
      for (let j = 0; j < v.count && m.markerCount < MAX_ALLY_MARKERS; j++) {
        if (j === e || v.alive[j] !== 1 || v.kind[j] !== ENTITY_KIND.bobo || v.team[j] !== team) continue;
        if ((v.flags[j]! & ENTITY_FLAG.dead) !== 0) continue;
        const o = j * 3;
        const top = v.position[o + 1]! + ALLY_MARKER_HEIGHT_M;
        if (!projectToView(c, rect, v.position[o]!, top, v.position[o + 2]!, projected)) continue;
        if (projected[2]! > ALLY_MARKER_MAX_M) continue;
        m.markers[m.markerCount * 2] = projected[0]!;
        m.markers[m.markerCount * 2 + 1] = projected[1]!;
        m.markerCount++;
      }
    }
    // M2 (fase 2c): faixa de quem matou, o radial (só a vista do humano) e a dica da derrota feia.
    const st = slot.death;
    if (m.dead && st.t >= 0) {
      fillDeathBanner(m, st, v, names, weaponNames, deathTx, ruleTexts);
      const human = humans > 0 && s === 0 && slot.controller === 0;
      m.primaryNames = human ? primaryNames : NO_PRIMARIES;
      m.primaryCategories = human ? primaryCategories : NO_PRIMARIES;
      m.primarySelected = humanPrimary;
      m.hardTimeHint = st.hint;
    } else {
      m.deathName = '';
      m.primaryNames = NO_PRIMARIES;
      m.hardTimeHint = false;
    }
    m.playerSlot = s;
    m.team = ffa ? 255 : v.team[e]!;
    const held = weaponDef(v.weapon[e]!);
    m.weaponName = held ? (weaponNames[held.code] ?? '') : '';
    m.weaponCategory = held ? (weaponCategories[held.code] ?? '') : '';
    m.ammoMode = !held || held.clipSize === 0 ? HUD_AMMO.none : held.reserve === 0 ? HUD_AMMO.clip : HUD_AMMO.full;
    m.grenades =
      held && held.fire === WEAPON_FIRE.thrown
        ? -1
        : v.loadout[e * WEAPON_SLOT_COUNT + WEAPON_SLOT.throwable] === WEAPON_CODE.grenade
          ? v.slotClip[e * WEAPON_SLOT_COUNT + WEAPON_SLOT.throwable]!
          : -1;
    m.crosshair =
      held && (held.fire === WEAPON_FIRE.melee || held.fire === WEAPON_FIRE.thrown || held.adsZoom >= 3)
        ? HUD_CROSSHAIR.dot
        : HUD_CROSSHAIR.cross;
    m.scope = held && held.adsZoom >= 3 && slot.adsBlend > 0.85 ? 1 : 0;
    // A retícula abre com a dispersão da arma no quadril (chumbos inclusive), fecha no ADS, e abre com o movimento.
    const hip = held ? Math.min(1, (held.hipSpreadDeg + held.pelletSpreadDeg) / 6) * (1 - slot.adsBlend) : 0;
    const speed = Math.hypot(v.velocity[e * 3]!, v.velocity[e * 3 + 2]!);
    m.spread = Math.min(1, hip * 0.7 + (speed / RUN_SPEED) * 0.6 + (recoil[e] ?? 0) * 0.5);
    m.clickToAim =
      humans > 0 && s === 0 && !paused && device === 'keyboardMouse' && platform.id === 'web' && !rawLocked;
    drawHud(slot.hud, fonts, m, lay.views[s]!);
    desc.hud = slot.hud;
    void ui;
  }

  function decay(dt: number): void {
    ageKillFeed(killFeed, dt);
    const fade = dt / FLASH_S;
    for (let i = 0; i < flash.length; i++) {
      if (flash[i]! > 0) flash[i] = Math.max(0, flash[i]! - fade);
      if (recoil[i]! > 0) recoil[i] = Math.max(0, recoil[i]! - dt / RECOIL_S);
      if (firing[i]! > 0) firing[i] = Math.max(0, firing[i]! - dt);
    }
    // Laço por índice: no interpretador do Switch o for-of aloca um iterador (regra 11).
    for (let s = 0; s < slots.length; s++) {
      const slot = slots[s]!;
      const m = slot.model;
      m.hitMarker = Math.max(0, m.hitMarker - dt / HIT_MARKER_S);
      m.headshotMarker = Math.max(0, m.headshotMarker - dt / HIT_MARKER_S);
      slot.damageT = Math.max(0, slot.damageT - dt);
      m.damageAmount = slot.damageT / DAMAGE_S;
      slot.flash = Math.max(0, slot.flash - dt / FLASH_DECAY_S);
    }
  }

  // --- bench: medição e relatório ---
  /** Grava o pior frame lento da janela que acabou (uma linha `[bench] pico` por janela, distribuídas pelo bench). */
  function flushSpike(): void {
    const b = benchState;
    if (!b || b.spikeT < 0) return;
    host.log(
      `[bench] pico t=${Math.round(b.spikeT)} frame_ms=${Math.round(b.spikeFrame)} cpu_ms=${Math.round(b.spikeCpu)}` +
        ` sim=${Math.round(b.spikeSim)} ia=${Math.round(b.spikeAi)} render=${Math.round(b.spikeRender)}` +
        ` ui=${Math.round(b.spikeUi)}` +
        ` resto=${Math.round(b.spikeCpu - b.spikeSim - b.spikeAi - b.spikeRender - b.spikeUi)} ticks=${b.spikeTicks}` +
        // Heap no pico e na última amostra de 1 s: queda grande entre os dois = coleta do V8 do nx.js fora do frame (o
        // `cpu_ms` só mede o código do jogo).
        ` heap_mb=${b.spikeHeap < 0 ? '-' : b.spikeHeap.toFixed(1)} heap_1s_mb=${b.spikeHeap1s < 0 ? '-' : b.spikeHeap1s.toFixed(1)}`,
    );
    b.spikeT = -1;
    b.spikeFrame = 0;
  }

  function benchSample(frameMs: number, cpuMs: number, renderMs: number, uiMs: number): void {
    const b = benchState;
    if (!b || !bench) return;
    // Começo da partida (item 15): os 2 primeiros intervalos ainda carregam o fim do loading, então valem só pela CPU.
    if (b.startFrames < STARTUP_FRAMES && b.phase !== 'done') {
      const v = b.startFrames < 2 ? cpuMs : Math.max(cpuMs, frameMs);
      if (b.startFirst < 0) b.startFirst = v;
      if (v > b.startMax) b.startMax = v;
      if (v >= 100) b.startStalls++;
      b.startFrames++;
    }
    if (b.phase === 'warmup') {
      if (b.t >= bench.warmupS) {
        b.phase = 'measure';
        b.t = 0;
        b.windowEnd = spikeWindowS;
        host.log(`[bench] medindo ${bench.durationS} s`);
      }
      return;
    }
    if (b.phase !== 'measure') return;
    // Vão de ciclo de vida (HOME, sleep, aba escondida): fora das estatísticas, contado à parte.
    if (frameMs > LIFECYCLE_GAP_MS) {
      b.gaps++;
      return;
    }
    b.frames.push(frameMs);
    if (frameMs >= 40) {
      const k = frameMs < 60 ? 0 : frameMs < 100 ? 1 : frameMs < 250 ? 2 : 3;
      b.slow[k] = b.slow[k]! + 1;
    }
    const simMs = driver.lastSimMs;
    const aiMs = driver.lastAiMs;
    // Picos (Teste Zero): o pior frame lento de cada janela vai para o log com a quebra por fase.
    if ((frameMs > spikeLimitMs || cpuMs > spikeLimitMs) && frameMs > b.spikeFrame) {
      b.spikeT = b.t;
      b.spikeFrame = frameMs;
      b.spikeCpu = cpuMs;
      b.spikeSim = simMs;
      b.spikeAi = aiMs;
      b.spikeRender = renderMs;
      b.spikeUi = uiMs;
      b.spikeTicks = lastTicks;
      // Só nos frames lentos (no máximo alguns por janela): a leitura aloca um objeto.
      const mem = platform.diagnostics.memoryUsage?.() ?? null;
      b.spikeHeap = mem ? mem.usedHeapBytes / 1e6 : -1;
      b.spikeHeap1s = heapNowMb;
    }
    if (b.t >= b.windowEnd) {
      flushSpike();
      b.windowEnd += spikeWindowS;
    }
    b.cpu.push(cpuMs);
    const gpu = renderer.stats.gpuMs;
    if (gpu >= 0) b.gpu.push(gpu);
    b.sim.push(simMs);
    b.ai.push(aiMs);
    b.simSum += simMs;
    b.aiSum += aiMs;
    if (simMs > b.simMax) b.simMax = simMs;
    if (aiMs > b.aiMax) b.aiMax = aiMs;
    b.ticks += lastTicks;
    b.render.push(renderMs);
    b.ui.push(uiMs);
    if (b.t < THERMAL_WINDOW_S) b.firstMinute.push(frameMs);
    if (b.t >= bench.durationS - THERMAL_WINDOW_S) {
      if (b.lastStartT < 0) b.lastStartT = b.t;
      b.lastFrames.push(frameMs);
    }
    // Pausa provável de GC: frame acima de 2× a média recente sem CPU do jogo que explique (o resto é do navegador,
    // do coletor ou do sistema). Média exponencial: nada de ordenar por frame.
    if (b.ema > 0 && frameMs > b.ema * 2 && cpuMs < b.ema) b.gcPauses++;
    b.ema = b.ema > 0 ? b.ema * 0.95 + frameMs * 0.05 : frameMs;
    if (frameMs >= 100) b.stalls++;
    const rs = renderer.stats;
    const views = rs.views;
    for (let i = 0; i < views.length && i < 4; i++) {
      const vs = views[i]!;
      const sums = b.viewSums;
      const o = i * VIEW_SUM_FIELDS;
      sums[o] = sums[o]! + vs.drawCalls;
      sums[o + 1] = sums[o + 1]! + vs.triangles;
      sums[o + 2] = sums[o + 2]! + vs.regions;
      sums[o + 3] = sums[o + 3]! + vs.propGroups;
      sums[o + 4] = sums[o + 4]! + vs.actors;
      sums[o + 5] = sums[o + 5]! + vs.actorDraws;
    }
    b.lodSums[0] = b.lodSums[0]! + rs.figureL0;
    b.lodSums[1] = b.lodSums[1]! + rs.figureL1;
    b.lodSums[2] = b.lodSums[2]! + rs.figureL2;
    if (rs.figureOverflow > b.bodiesOut) b.bodiesOut = rs.figureOverflow;
    b.viewFrames++;
    if (b.t >= bench.durationS) finishBench(false);
  }

  function finishBench(interrupted: boolean): void {
    const b = benchState;
    if (!b || !bench || b.phase === 'done') return;
    const measuredS = b.phase === 'measure' ? b.t : 0;
    b.phase = 'done';
    flushSpike();
    if (interrupted) warnings.push('bench interrompido antes do fim');
    const mem = renderer.memory();
    const frames = b.frames.count;
    const viewReports = [];
    let drawMax = 0;
    let triMax = 0;
    const f = Math.max(1, b.viewFrames);
    const avg1 = (sum: number): number => Math.round((sum / f) * 10) / 10;
    for (let i = 0; i < viewCount; i++) {
      const o = i * VIEW_SUM_FIELDS;
      const view = {
        drawCalls: avg1(b.viewSums[o]!),
        triangles: Math.round(b.viewSums[o + 1]! / f),
        regions: avg1(b.viewSums[o + 2]!),
        propGroups: avg1(b.viewSums[o + 3]!),
        actors: avg1(b.viewSums[o + 4]!),
        actorDraws: avg1(b.viewSums[o + 5]!),
      };
      drawMax = Math.max(drawMax, view.drawCalls);
      triMax = Math.max(triMax, view.triangles);
      viewReports.push(view);
    }
    const g = platform.graphics;
    const fs = b.frames.stats();
    const seconds = (fs.avg * frames) / 1000;
    // Erros do three (`console.error`: compilação/link de shader…) vão para `erros=`; o resto fica nos avisos.
    const threeErrors: string[] = [];
    const threeWarnings: string[] = [];
    for (const w of renderer.info.warnings) (w.startsWith('error:') ? threeErrors : threeWarnings).push(`three: ${w}`);
    const ticks = Math.max(1, b.ticks);
    const n = Math.max(1, frames);
    const botsTotal = driver.director.botCount;
    const report: BenchReport = {
      version: GAME_VERSION,
      codename: GAME_CODENAME,
      platform: platform.id,
      profile: profile.id,
      system,
      gpu: gpuName,
      screenWidth: g.width,
      screenHeight: g.height,
      pixelRatio: g.pixelRatio,
      threeRevision: renderer.info.threeRevision,
      config: bench,
      effectiveBots: Math.max(0, botsTotal - viewCount),
      mannequins: bench.actors ? vitrineMannequins : 0,
      maxDebris: profile.maxDebris,
      loadingMs: { ...setup.times },
      frames,
      seconds,
      frameMs: fs,
      slowFrames: { from40: b.slow[0]!, from60: b.slow[1]!, from100: b.slow[2]!, from250: b.slow[3]!, gaps: b.gaps },
      startupMs: {
        first: Math.max(0, b.startFirst),
        max: b.startMax,
        stalls: b.startStalls,
        frames: b.startFrames,
      },
      cpuMs: { p50: b.cpu.percentile(0.5), p99: b.cpu.percentile(0.99) },
      gpuMs: b.gpu.count > 0 ? { p50: b.gpu.percentile(0.5), p99: b.gpu.percentile(0.99) } : null,
      phasesMs: {
        sim: b.sim.percentile(0.5),
        ai: b.ai.percentile(0.5),
        render: b.render.percentile(0.5),
        ui: b.ui.percentile(0.5),
      },
      simAiMs: {
        simAvg: b.simSum / n,
        simP99: b.sim.percentile(0.99),
        simMax: b.simMax,
        aiAvg: b.aiSum / n,
        aiP99: b.ai.percentile(0.99),
        aiMax: b.aiMax,
        ticks: b.ticks,
        simPerTick: b.simSum / ticks,
        aiPerTick: b.aiSum / ticks,
      },
      views: viewReports,
      figureLod: { l0: avg1(b.lodSums[0]!), l1: avg1(b.lodSums[1]!), l2: avg1(b.lodSums[2]!) },
      figures: {
        skins: figures.plan.sets.length,
        overflow: figures.plan.overflow.length,
        templates: figures.templates.count,
        bodiesOut: b.bodiesOut,
      },
      programs: renderer.stats.programs,
      memoryMb: {
        heapMax: heapMaxMb,
        heapLimit: heapLimitMb,
        textures: Math.round((mem.textureBytes / 1e6) * 10) / 10,
        meshes: Math.round((mem.worldMeshBytes / 1e6) * 10) / 10,
      },
      gcPauses: b.gcPauses,
      warnings: [...warnings, ...threeWarnings],
      errors: threeErrors,
    };
    const text = formatBenchReport(report);
    b.report = text;

    // Sondas do Teste Zero que dependem do jogo (itens 10–16; a casca grava as de plataforma: 1–9 e 17–21). Sem
    // amostra não há medição: `pulado`, nunca `ok` com zeros. Bench interrompido diz quantos segundos mediu.
    const cut: Record<string, number> = interrupted ? { interrompido: 1, segundos_medidos: Math.round(measuredS) } : {};
    const none = frames === 0;
    const skip = { motivo: 'sem_amostras' };
    host.log(
      none
        ? formatT0Line(10, 'pulado', { ...skip, ...cut })
        : formatT0Line(10, fs.p99 <= frameTarget * 1.2 ? 'ok' : 'falha', {
            p50: fs.p50.toFixed(2),
            p99: fs.p99.toFixed(2),
            max: fs.max.toFixed(2),
            alvo: frameTarget.toFixed(2),
            vistas: viewCount,
            bots: botsTotal,
            frames,
            vaos_1s: b.gaps,
            ...cut,
          }),
    );
    // Item 11: programas (≤ 7) e a meta de render POR VISTA (tecnico.md §24.1: 3–4P ≤ 45 draws e 120 mil triângulos;
    // 1–2P ≤ 60 e 200 mil). O pior caso é a vista mais cara (média de cada vista ao longo da medição).
    const metaDraw = viewCount >= 3 ? 45 : 60;
    const metaTri = viewCount >= 3 ? 120_000 : 200_000;
    const programsOk = renderer.stats.programs <= 7;
    host.log(
      b.viewFrames === 0
        ? formatT0Line(11, programsOk ? 'pulado' : 'falha', { ...skip, programas: renderer.stats.programs, ...cut })
        : formatT0Line(11, programsOk && drawMax <= metaDraw && triMax <= metaTri ? 'ok' : 'falha', {
            programas: renderer.stats.programs,
            draw_max_vista: drawMax,
            tri_max_vista: triMax,
            meta_draw: metaDraw,
            meta_tri: metaTri,
            textura: renderer.info.textureMode,
            atributos: renderer.info.vertexAttributes,
            ...cut,
          }),
    );
    host.log(
      none
        ? formatT0Line(12, 'pulado', { ...skip, ...cut })
        : formatT0Line(12, 'info', {
            sim_media: report.simAiMs.simAvg.toFixed(2),
            sim_p99: report.simAiMs.simP99.toFixed(2),
            sim_max: report.simAiMs.simMax.toFixed(2),
            ia_media: report.simAiMs.aiAvg.toFixed(2),
            ia_p99: report.simAiMs.aiP99.toFixed(2),
            ia_max: report.simAiMs.aiMax.toFixed(2),
            sim_por_tick: report.simAiMs.simPerTick.toFixed(3),
            ia_por_tick: report.simAiMs.aiPerTick.toFixed(3),
            bots: botsTotal,
            zumbis: bench.zombies,
            hz: sim.hz,
            ...cut,
          }),
    );
    const t = setup.times;
    host.log(
      formatT0Line(13, t.total <= 4000 ? 'ok' : 'falha', {
        total_ms: Math.round(t.total),
        assets: Math.round(t.assets),
        texturas: Math.round(t.textures),
        malha: Math.round(t.mesh),
        luz: Math.round(t.light),
        nav: Math.round(t.nav),
        figuras: Math.round(t.figures),
        skins: Math.round(t.skins),
        shaders: Math.round(t.shaders),
      }),
    );
    host.log(
      heapMaxMb < 0
        ? formatT0Line(14, 'pulado', { motivo: 'heap_desconhecido', gc_pausas: b.gcPauses, ...cut })
        : formatT0Line(14, heapMaxMb < 200 ? 'ok' : 'falha', {
            heap_max_mb: heapMaxMb,
            heap_limite_mb: heapLimitMb,
            gc_pausas: b.gcPauses,
            ...cut,
          }),
    );
    // Item 15 (tecnico.md §24.2: "primeiro frame e troca de cena"): os primeiros frames da partida, aquecimento
    // incluído. Os frames ≥ 100 ms da medição (picos de regime) ficam só como informação.
    host.log(
      b.startFrames === 0
        ? formatT0Line(15, 'pulado', { ...skip, ...cut })
        : formatT0Line(15, b.startStalls === 0 ? 'ok' : 'falha', {
            primeiro_frame_ms: b.startFirst.toFixed(1),
            max_inicio_ms: b.startMax.toFixed(1),
            travadas_inicio: b.startStalls,
            frames_inicio: b.startFrames,
            travadas_100ms: b.stalls,
            ...cut,
          }),
    );
    // Item 16 (frame depois de 10 min): p50 do primeiro minuto × p50 dos últimos 60 s, por tempo.
    const first = b.firstMinute.percentile(0.5);
    const last = b.lastFrames.percentile(0.5);
    const coveredS = b.lastStartT >= 0 ? Math.round(measuredS - b.lastStartT) : 0;
    host.log(
      none || interrupted || measuredS < THERMAL_MIN_S || b.lastFrames.count === 0
        ? formatT0Line(16, 'pulado', {
            motivo: none ? 'sem_amostras' : 'curto',
            segundos: Math.round(measuredS),
            minimo: THERMAL_MIN_S,
            ...cut,
          })
        : formatT0Line(16, last <= first * 1.15 ? 'ok' : 'falha', {
            p50_inicio: first.toFixed(2),
            p50_fim: last.toFixed(2),
            segundos_fim: coveredS,
            segundos: Math.round(measuredS),
          }),
    );
    host.benchReport(text);
  }

  // --- texto do bench na tela (fora dos prints: some com o HUD) ---
  const benchTexts = {
    warmup: t('test.bench.warmup'),
    running: t('test.bench.running'),
    done: platform.id === 'switch' ? t('test.bench.done') : t('bench.webDone'),
    // No Switch o B interrompe (na web é o Esc; a tela de relatório da web tem as teclas dela).
    hint: platform.id === 'switch' ? t('test.bench.hint') : '',
    // " · faltam {minutes}:{seconds}" ao lado de "Aquecendo"/"Medindo": quem roda no celular sabe quanto falta.
    left: templateParts('test.bench.timeLeft', ['minutes', 'seconds']),
  };
  /** Largura do " · faltam m:ss" (sem string por frame, como o relógio do HUD). */
  function benchLeftWidth(font: UiFonts['hud'], total: number, px: number): number {
    const p = benchTexts.left;
    return (
      textWidth(font, p[0] as string, px, 0.04) +
      numberWidth(font, Math.floor(total / 60), 0, px, 1, 0.04) +
      textWidth(font, p[1] as string, px, 0.04) +
      numberWidth(font, total % 60, 0, px, 2, 0.04) +
      textWidth(font, p[2] as string, px, 0.04)
    );
  }
  function paintBenchLeft(
    out: DrawList,
    font: UiFonts['hud'],
    total: number,
    x: number,
    capTop: number,
    px: number,
  ): void {
    const p = benchTexts.left;
    const c = COLORS.texto;
    let pen = x;
    pen += paintText(out, font, p[0] as string, pen, capTop, px, c, 0.04);
    pen += paintNumber(out, font, Math.floor(total / 60), 0, pen, capTop, px, c, 0, 1, 0.04);
    pen += paintText(out, font, p[1] as string, pen, capTop, px, c, 0.04);
    pen += paintNumber(out, font, total % 60, 0, pen, capTop, px, c, 0, 2, 0.04);
    paintText(out, font, p[2] as string, pen, capTop, px, c, 0.04);
  }
  function drawBenchStatus(out: DrawList, fonts: UiFonts | null, ui: UiFrame): void {
    const b = benchState;
    const font = fonts?.hud;
    if (!b || !font || !hudVisible || fontSpecimen || !bench) return;
    const text =
      b.phase === 'warmup' ? benchTexts.warmup : b.phase === 'measure' ? benchTexts.running : benchTexts.done;
    // Segundos que faltam na fase (aquecimento ou medição); −1 no relatório pronto.
    const left =
      b.phase === 'done' ? -1 : Math.max(0, Math.ceil((b.phase === 'warmup' ? bench.warmupS : bench.durationS) - b.t));
    const px = Math.max(Math.round(16 * ui.scale), ui.options.minTextPx ?? 12);
    const labelW = measureText(font, text, px, 0.04);
    const w = labelW + (left >= 0 ? benchLeftWidth(font, left, px) : 0) + px;
    const h = Math.round(px * 1.8);
    const x = Math.round((ui.width - w) / 2);
    // 1–2 vistas: no alto, no meio; 3–4: no cruzamento central (longe da HUD de cada vista).
    const y = viewCount >= 3 ? Math.round((ui.height - h) / 2) : Math.round(px * 0.8);
    pushRect(out, x, y, w, h, withAlpha(COLORS.bunker, 0.85));
    drawText(out, font, text, x + px / 2, y + px * 0.45, px, b.phase === 'done' ? COLORS.acao : COLORS.texto, 0.04);
    if (left >= 0) paintBenchLeft(out, font, left, Math.ceil(x + px / 2 + labelW), y + px * 0.45, px);
    if (b.phase === 'done' || benchTexts.hint === '') return;
    const hw = measureText(font, benchTexts.hint, px, 0.04) + px;
    const hx = Math.round((ui.width - hw) / 2);
    pushRect(out, hx, y + h, hw, h, withAlpha(COLORS.bunker, 0.85));
    drawText(out, font, benchTexts.hint, hx + px / 2, y + h + px * 0.45, px, COLORS.texto, 0.04);
  }

  function fillPanel(): void {
    const s = renderer.stats;
    panel.fps = f2Frames.count > 0 ? 1000 / Math.max(0.001, f2Frames.percentile(0.5)) : 0;
    panel.frameP50 = f2Frames.percentile(0.5);
    panel.frameP99 = f2Frames.percentile(0.99);
    panel.frameMax = f2Frames.percentile(1);
    panel.gpuMs = s.gpuMs;
    panel.simMs = driver.lastSimMs;
    panel.aiMs = driver.lastAiMs;
    panel.drawCalls = s.drawCalls;
    panel.triangles = s.triangles;
    panel.programs = s.programs;
    panel.viewCount = Math.min(4, s.views.length);
    for (let i = 0; i < panel.viewCount; i++) {
      const src = s.views[i]!;
      const dst = panel.views[i]!;
      dst.drawCalls = src.drawCalls;
      dst.triangles = src.triangles;
      dst.regions = src.regions;
      dst.propGroups = src.propGroups;
      dst.actors = src.actors;
    }
    panel.heapMb = heapMaxMb < 0 ? -1 : heapNowMb;
    panel.heapLimitMb = heapLimitMb;
    panel.bots = driver.director.botCount;
    panel.tick = sim.tick;
    panel.gcPauses = benchState?.gcPauses ?? panel.gcPauses;
  }
  let heapNowMb = -1;
  let memoryCheckS = 0;
  function sampleMemory(dt: number): void {
    heapCheckS -= dt;
    if (heapCheckS > 0) return;
    heapCheckS = 1;
    const m = platform.diagnostics.memoryUsage?.() ?? null;
    if (m) {
      heapNowMb = Math.round((m.usedHeapBytes / 1e6) * 10) / 10;
      heapMaxMb = Math.max(heapMaxMb, heapNowMb);
      heapLimitMb = m.heapLimitBytes > 0 ? Math.round((m.heapLimitBytes / 1e6) * 10) / 10 : -1;
    }
    memoryCheckS -= 1;
    if (memoryCheckS <= 0 && panel.visible) {
      memoryCheckS = 2;
      const mem = renderer.memory();
      panel.textureMb = Math.round((mem.textureBytes / 1e6) * 10) / 10;
      panel.meshMb = Math.round((mem.worldMeshBytes / 1e6) * 10) / 10;
    }
  }

  return {
    driver,
    debug: debugApi,
    get paused(): boolean {
      return paused;
    },
    get wantsPointerLock(): boolean {
      return (
        humans > 0 &&
        !paused &&
        !resultShown &&
        !disposed &&
        device === 'keyboardMouse' &&
        platform.features.keyboardMouse
      );
    },
    get level(): BotLevel {
      return currentLevel;
    },
    pause,
    frame(dt, raw, menu, ui, list, rawFrameMs): SceneSignal {
      if (disposed) return 'none';
      const t0 = now();
      // F2 (borda de subida): painel de depuração.
      const f2 = F2_KEY >= 0 && raw.keys[F2_KEY] === 1;
      if (f2 && !f2Down) panel.visible = !panel.visible;
      f2Down = f2;
      lastPointerLocked = raw.pointerLocked;

      // --- entrada e sim ---
      let signal: SceneSignal = 'none';
      if (humans > 0) {
        const last = menu.lastDevice;
        if (last !== null) useDevice(last, last === 'gamepad' ? Math.max(0, menu.lastGamepad) : padIndex);
        if (resultShown) {
          // M2 (fase 2e): o resultado é um menu (D-pad, mouse, toque); o jogador não anda por trás dele.
          const nav = resultMenu.update(menu, raw, ui);
          const a = nav.activated;
          if (a === RESULT_ACTION.again) signal = 'again';
          else if (a === RESULT_ACTION.easier) signal = 'easier';
          else if (a === RESULT_ACTION.harder) signal = 'harder';
          else if (a === RESULT_ACTION.quit) signal = 'quit';
          else if (a === RESULT_ACTION.changeRules) signal = 'rules';
          else if (a === RESULT_ACTION.savePreset && resultData !== null && !resultData.presetSaved) {
            // M2 (fase 4e): quem salva é o `game` (o save é dele); aqui o botão vira "Preset salvo".
            signal = 'save';
            resultData = { ...resultData, presetSaved: true };
            resultMenu.setRoot(resultScreen.build(resultData));
          }
        } else if (!paused) {
          const yaw0 = player.yaw;
          const pitch0 = player.pitch;
          const scale = frozen ? 1 : aimAssistBefore();
          player.update(raw, frozen ? 0 : dt, scale);
          if (!frozen) aimAssistAfter(dt, player.yaw !== yaw0 || player.pitch !== pitch0);
          if (player.wasPressed('pause')) pause();
        } else {
          // Pausado: a sim não anda e a mira não gira (o mapeador lê só os botões).
          const yaw = player.yaw;
          const pitch = player.pitch;
          player.update(raw, 0);
          player.setAngles(yaw, pitch);
          if (player.wasPressed('pause')) resume();
          else {
            signal = pauseAction(pauseMenu.update(menu, raw, ui));
          }
        }
      } else if (menu.pressed('back')) {
        // Bench: B (Switch) ou Esc interrompe; o relatório sai com o que foi medido.
        if (benchState && benchState.phase !== 'done') finishBench(true);
        signal = 'quit';
      }
      const running = !paused && !frozen;
      trace('entrada');
      if (running) {
        lastTicks = driver.update(dt);
        trace('sim e IA');
        timeS += dt;
        decay(dt);
        if (overrideRoute) routeTime += dt;
        if (benchState) benchState.t += dt;
      }
      // Clipe do gancho dos prints: um passo por frame desenhado, com `dtS` fixo no relógio do render (a cena fica
      // congelada; o passo 0 é o boneco novo, que o rig posa sem dt).
      if (clipRun !== null && !clipRun.done) {
        if (clipRun.steps > 0) clipClock += clipRun.dtS;
        // O mesmo yaw que o `fillActors` dá ao boneco (com o giro da câmera da fila), senão ele anda de lado.
        clipRun.advance(
          mannequins[clipMannequin]!.yaw + mqTurn[clipMannequin]! + (mqLine[clipMannequin]! >= 0 ? lineTurn : 0),
        );
        changed();
      }
      env.timeS = timeS + clipClock;
      sampleMemory(dt);

      // --- render ---
      const alpha = running ? driver.alpha : paused ? 1 : driver.alpha;
      // Bissecção do bench: `actors=0` tira bobos, manequins e sombras; `fx=0` descarta os VFX do frame.
      if (bench && !bench.actors) actors.count = 0;
      else fillActors(alpha, running ? dt : 0);
      renderer.setActors(actors);
      if (bench && !bench.actors) projectiles.count = 0;
      else fillProjectiles(alpha, running);
      renderer.setProjectiles(projectiles);
      renderer.setEnvironment(env);
      trace('atores', actors.count);
      if (fx.count > 0) {
        if (!bench || bench.fx) renderer.submitFx(fx);
        resetFxQueue(fx);
      }
      const lay = syncLayout(ui);
      updateDeaths(running ? dt : 0, raw, lay);
      for (let s = 0; s < slots.length; s++) updateView(s, running ? dt : 0, alpha, lay);
      trace('vfx e câmeras');
      const fonts = host.fonts;
      const tUi0 = now();
      for (let s = 0; s < slots.length; s++) fillHud(s, fonts, lay, ui, lastPointerLocked);
      let uiMs = now() - tUi0;
      const tr0 = now();
      if (fontSpecimen) {
        renderer.renderViews(NO_VIEWS);
      } else {
        renderer.renderViews(descs);
      }
      const renderMs = now() - tr0;
      trace('render', renderer.stats.drawCalls, renderer.stats.programs);
      const tUi1 = now();
      if (fontSpecimen) {
        pushRect(list, 0, 0, ui.width, ui.height, COLORS.bunker);
        drawFontSpecimen(list, fonts, ui.width, ui.height);
      } else {
        if (hudVisible && !resultShown && !(overrideCamera || overrideRoute)) {
          const sharedArea = lay.shared;
          if (!ffa && request.kind === 'play') {
            sharedHud.teamCount = 2;
            const score = sim.view().match.teamScore;
            sharedHud.teamScores[0] = score[0]!;
            sharedHud.teamScores[1] = score[1]!;
          } else {
            sharedHud.teamCount = 0;
          }
          const mv = sim.view().match;
          // M2 (fase 2d): o relógio da partida (na morte súbita, os 60 s dela) e o aviso de morte súbita.
          sharedHud.timeLeftS = request.kind === 'play' && mv.ticksLeft >= 0 ? mv.ticksLeft / sim.hz : -1;
          sharedHud.suddenDeath = mv.phase === 'suddenDeath';
          if (viewCount === 3 || sharedHud.teamCount > 0 || sharedHud.timeLeftS >= 0) {
            drawHudShared(list, fonts, sharedHud, sharedArea);
          }
          const hs = Math.min(ui.width / 640, ui.height / 360);
          const minText = ui.options.minTextPx ?? 0;
          const v0 = lay.views[0]!;
          drawKillFeed(
            list,
            fonts,
            killFeed,
            ui.width - Math.max(v0.insetRight, 16 * hs),
            Math.max(v0.insetTop, 12 * hs),
            hs,
            minText,
          );
          if (mv.phase === 'warmup' && mv.countdownTicks > 0) {
            drawMatchCountdown(list, fonts, mv.countdownTicks / sim.hz, todayLine, ui.width, ui.height, minText);
          }
          if (humans > 0 && !paused && player.isDown('scoreboard')) {
            fillScoreboard(sim.view());
            drawScoreboard(list, fonts, scoreboard, ui.width, ui.height, minText);
          }
          if (humans > 0 && device === 'touch' && !paused) {
            const tf = touchFrame;
            tf.width = ui.width;
            tf.height = ui.height;
            tf.pixelRatio = platform.graphics.pixelRatio;
            tf.minTextPx = ui.options.minTextPx ?? 0;
            touchOverlay.draw(list, fonts, tf, player);
          }
        }
        drawBenchStatus(list, fonts, ui);
        if (paused) pauseMenu.draw(list, ui);
        // M2 (fase 2e): o resultado entra 2,5 s depois do fim (dá para ver o último abate).
        if (!resultShown && endedAt >= 0 && humans > 0 && timeS - endedAt >= RESULT_DELAY_S) showResult();
        if (resultShown) resultMenu.draw(list, ui);
        if (panel.visible) {
          fillPanel();
          drawDebugPanel(list, fonts, panel, ui.width, ui.height);
        }
      }
      renderer.drawUi(list);
      uiMs += now() - tUi1;
      trace('ui');

      // --- medições do frame ---
      const cpuMs = now() - t0;
      const frameMs = rawFrameMs ?? dt * 1000;
      if (frameMs > 0) f2Frames.push(frameMs);
      panel.cpuMs = cpuMs;
      panel.renderMs = renderMs;
      panel.uiMs = uiMs;
      if (running) benchSample(frameMs, cpuMs, renderMs, uiMs);
      traceTimes(cpuMs, frameMs);

      // --- prints: frames estáveis desde a última mudança ---
      framesDrawn++;
      stableFrames++;
      const clipBusy = clipPending();
      for (let i = waiters.length - 1; i >= 0; i--) {
        const w = waiters[i]!;
        if (framesDrawn >= w.target && stableFrames >= 1 && !clipBusy) {
          waiters.splice(i, 1);
          w.resolve();
        }
      }
      return signal;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      platform.lifecycle.setInMatch(false);
      for (const w of waiters) w.resolve();
      waiters.length = 0;
      driver.dispose();
      actors.count = 0;
      renderer.setActors(actors);
      renderer.setProjectiles(null);
      // Bonecos (#56): o render solta gabaritos e tabela; o cache de skins solta o pintor (regra 21).
      renderer.setFigures(null, null);
      figures.dispose();
      clipRun = null;
    },
  };
}

const NO_VIEWS: readonly ViewDesc[] = [];
