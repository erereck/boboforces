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
  MODIFIERS,
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
  type BotDocument,
  type VideoSettings,
  type BotLevel,
  type SettingsDocument,
  resolveBot,
  SETTINGS_RANGES,
  COUCH_PLAYER_KEYS,
  effectiveQuality,
  lowerQuality,
  QUALITY_PROBE,
  qualityKnobs,
  shouldLowerQuality,
  ZOMBIES_DEFAULTS,
  zombieRecordKey,
  isRoyaleMode,
} from '@boboforces/format';
import {
  AIM_ASSIST_LEVELS,
  createGamepadProfile,
  createBindingCapture,
  createInputFrame,
  profileBindings,
  createInputMapper,
  createKeyboardMouseProfile,
  createTouchProfile,
  BUTTON,
  FRAME_HUMAN,
  keyIndex,
  MAX_GAMEPADS,
  PAD_BUTTON,
  WEAPON_SLOT_COUNT,
  type CaptureResult,
  type ControlProfile,
  type DeviceBinding,
  type DeviceKind,
  type InputFrame,
  type InputMapper,
  type MenuInput,
  type RawInputState,
  type RemapAction,
  ORDER_WHEEL,
  withOrder,
} from '@boboforces/input';
import {
  ACTOR_KIND,
  ACTOR_POSE,
  type ActorBuffer,
  createActorBuffer,
  createEnvironment,
  createFxQueue,
  createProjectileBuffer,
  createRenderDebug,
  createViewDesc,
  type FxDeath,
  type MipFilterMode,
  NO_FIGURE,
  NO_MODEL,
  pushActorImpact,
  pushBlockImpact,
  pushDeath,
  pushDebris,
  pushExplosion,
  pushMuzzleFlash,
  pushPaint,
  pushPaintBall,
  pushPropImpact,
  pushTracer,
  TRACER_STYLE,
  pushTrail,
  resetFxQueue,
  type ViewDesc,
  VIEWMODEL_POSE,
  viewmodelAimOffset,
} from '@boboforces/render/data';
import { clamp, createLogger, HALF_PI, lerp, lerpAngle, pitchToI16, wrapAngle, yawToU16 } from '@boboforces/shared';
import {
  BOX,
  BOX_PHASE,
  CHAOS_MODS,
  ENTITY_FLAG,
  ENTITY_KIND,
  entityIndex,
  expandRecipe,
  chaosMaskScaleOf,
  chaosScaleOf,
  figurePostureOf,
  GRENADE_THROW,
  heldClip,
  heldReserve,
  isFfaMode,
  isPaintWeapon,
  juggernautHp,
  makeEntityId,
  MATCH_DEFAULTS,
  MAX_CONTROLLERS,
  MAX_ZOMBIES,
  METRICS,
  MOD,
  NO_TEAM,
  NULL_ENTITY,
  PERK,
  PERK_IDS,
  PICKUP_KIND,
  predictThrow,
  resolveMapMovementProfile,
  type Sim,
  type SimEvent,
  type SimView,
  type WeaponDef,
  SPREAD_STATE_MULTIPLIER,
  SPREAD_WALKING_SPEED,
  viewEyeHeight,
  WEAPON_BIG_BRRT,
  WEAPON_CHAOS_BLAST,
  WEAPON_CODE,
  WEAPON_DESMONTADOR,
  WEAPON_FIRE,
  WEAPON_GOO,
  WEAPON_KILL_PLANE,
  WEAPON_NONE,
  WEAPON_PAINT_BUCKET,
  WEAPON_PAINT_MARKER,
  WEAPON_PAINT_PUMP,
  WEAPON_PAINT_SNIPER,
  WEAPON_SLOT,
  WEAPON_SPIT,
  WEAPON_ZONE,
  weaponBase,
  weaponDef,
  weaponGrip,
  weaponRarity,
  WEAPONS,
  WEAPONS_M10,
  WEAPON_M10_FIRST,
  ARSENAL,
  ROYALE_WEAPONS,
  ROYALE,
  CIRCLE,
  ZONE,
  pickupWeapon,
  mapWeaponsDropPrimary,
  weaponMaskBit,
  ZOMBIE_BARRICADES,
  ZOMBIE_BOX,
  ZOMBIE_PERKS,
  ZOMBIE_SHOP,
  ZOMBIE_TYPE,
  ZOMBIES_DOWN,
  ROUND,
  ROUND_PHASE,
  BOMB,
  STRIKE,
  STRIKE_BUY_BASE,
  STRIKE_DATA,
  STRIKE_SHOP,
  matchLimits,
} from '@boboforces/sim';
import {
  ageKillFeed,
  COLORS,
  createKillFeedModel,
  createScoreboardModel,
  drawKillFeed,
  drawMatchCountdown,
  drawScoreboard,
  directorShiftText,
  MAX_ALLY_MARKERS,
  MAX_TEAM_PINGS,
  MAX_CONTROL_POINTS,
  MAX_EMOTE_BUBBLES,
  MAX_GRENADE_ARC,
  MAX_GRENADE_WARNINGS,
  SETTINGS_ACTION,
  SETTINGS_ROW_PREFIX,
  SETTINGS_TAB_PREFIX,
  settingsScreen,
  PLAYER_COLORS,
  pushKillFeed,
  SCOREBOARD_MAX_ROWS,
  createDebugPanelModel,
  createDrawList,
  createHudModel,
  createHudSharedModel,
  drawDebugPanel,
  drawFontSpecimen,
  drawHud,
  drawHudShared,
  hudSpareTopBand,
  type HudSharedArea,
  hitPrimaryOption,
  PRIMARY_LAYOUT,
  drawText,
  HUD_AMMO,
  HUD_CROSSHAIR,
  HUD_DOWNED,
  HUD_INTERACT,
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
  type MenuNavigation,
  type HudScreenLayout,
  type StringKey,
  type UiFonts,
} from '@boboforces/ui';
import { CELLS_PER_METER, isCellSolid, sampleLightGrid } from '@boboforces/world';
import { soloViewMode } from '../maps.ts';
import { seatRecipe, type LocalSeat } from './seats.ts';
import { AIM_ASSIST, createAimAssistState, findAimAssist, pullAim, type AimAssistState } from './aim-assist.ts';
import { switchedSlot } from './switch-slot.ts';
import { approachScale, cameraInsideBody } from './body-scale.ts';
import { createTips, createTipSignals, stepTips, TIP_RULES, tipAlpha, TIPS, type TipId } from './tips.ts';
import {
  calibrationFactor,
  calibrationTarget,
  createCalibration,
  stepCalibration,
  type CalibrationState,
} from './calibration.ts';
import { formatBenchReport, heapWindow, type BenchReport } from '../bench/report.ts';
import { formatT0Line } from '../bench/t0.ts';
import type { BenchConfig, FigureClipFrame, GameDebugApi, MannequinOverride } from '../bench/types.ts';
import { ADS_BLEND_S, ADS_FOV_SCALE, defaultFovFor, verticalFov } from '../camera.ts';
import { createTouchOverlay } from '../hud.ts';
import { createSceneDriver, type SceneDriver } from './scene-driver.ts';
import { createMenuController, followTab, type UiFrame } from '../menu.ts';
import {
  CALIBRATED_ACTION,
  calibratedScreen,
  challengeLevel,
  challengeScreen,
  PAUSE_ACTION,
  pauseHelp,
  pauseScreen,
  PLAYERS_ACTION,
  playersScreen,
  type PlayerSeatLine,
} from '../pause.ts';
import {
  prizeLine,
  RESULT_ACTION,
  resultScreen,
  zombiesResultScreen,
  type ResultScreenData,
  type ZombiesResultData,
} from '../result-screen.ts';
import { zombieWaves } from '../presets-ui.ts';
import { zombieRecord } from '../stats.ts';
import {
  actionLabel,
  applyControls,
  bindingLabel,
  bindRowAction,
  PAUSE_SETTINGS_TABS,
  rebindSettings,
  SETTINGS_TAB_LABELS,
  settingsHelp,
  settingsRows,
  stepSettings,
} from '../settings-menu.ts';
import type { RecordBreaks, SceneHost, SceneRequest, SceneSignal, TrainingReport } from '../scene-api.ts';
import {
  beginDeath,
  controllerNames,
  controllerRules,
  countdownLine,
  createDeathState,
  deathCamAngles,
  deathCamBackoff,
  deathTexts,
  DEATH_CAM,
  endDeath,
  fillDeathBanner,
  isCurrentEntity,
  HARD_TIME,
  losingBadly,
  moveRadialCursor,
  PRIMARY_ORDER,
  primaryChoices,
  radialIndex,
  ringPick,
  stepCursor,
  stepPick,
  type DeathState,
} from './death.ts';
import { createFigureClip, type FigureClipRun } from './figure-clip.ts';
import { projectToEdge, projectToView, type ProjectCamera, type ProjectRect } from './markers.ts';
import {
  createMatchStats,
  localMatchRecord,
  recordMatchEvent,
  summarizeMatch,
  trainingNumbers,
  zombiesRows,
  type TrainingNumbers,
} from './result.ts';
import { bareLookId, botLookIndices, FIGURE_ZOMBIE_LOOK, figureLookById, type SceneFigures } from './figures.ts';
import type { LoadedConstruto, LoadingTimes } from './load.ts';
import { createCameraPose, poseFromCamera, sampleRoute, type CameraPose } from './route.ts';
import { showsRivalry, updateNemesis, type MatchBotTally } from './nemesis.ts';
import {
  AQUARIUM,
  AQUARIUM_ACTION,
  AQUARIUM_CAMERA,
  aquariumMaxSpeed,
  aquariumPauseHelp,
  aquariumPauseItems,
  aquariumSpeedText,
  aquariumBarTop,
  drawAquariumBar,
  livingBobo,
  nextAquariumCamera,
  nextAquariumSpeed,
  nextLivingBobo,
  spectateRecipe,
  stepFlyCamera,
  type AquariumCamera,
  type FlyBounds,
  type FlyCamera,
} from './aquarium.ts';
import { createWardrobe, WARDROBE, type Wardrobe } from './wardrobe.ts';
import {
  aimFromCamera,
  AUTO_FIRE_RANGE_M,
  createShoulderPose,
  crosshairTarget,
  placeShoulderCamera,
  THIRD_PERSON,
  type ShoulderPose,
} from './third-person.ts';
import { createSamples } from './stats.ts';
import { cleanTypedName } from '../names.ts';
import { teamColorTable } from '../team-colors.ts';
import { teamName } from '../team-names.ts';
import { HOST_AWAY_END_S, waitsForHost, type OnlineNetStats } from '../online-api.ts';
import { createMatchSound } from './sound.ts';
import { createZombieMusic } from './zombie-music.ts';
import { buildMinimapPlan, drawMinimap, type MinimapPlan } from './minimap.ts';
import {
  addReserveNames,
  createOwnerTools,
  drawFrozenMarks,
  OWNER_NO_TOOL,
  ownerHidden,
  type OwnerTools,
} from './owner-tools.ts';
import { ownerReserveFor } from '../owner-reserve.ts';

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
/** M2 (fase 4f): com "Reduzir tremor", o tremor das explosões fica nesta fração. */
const REDUCED_SHAKE = 0.25;
/** M4 (fase 4a): os botões de face na ordem do glifo da dica (baixo, direita, esquerda, cima). */
const FACE_GLYPHS: readonly number[] = [
  PAD_BUTTON.faceDown,
  PAD_BUTTON.faceRight,
  PAD_BUTTON.faceLeft,
  PAD_BUTTON.faceUp,
];
/** M4 (fase 3): abaixo disto (0–1), sem carregar, a partida avisa uma vez (P5). */
const BATTERY_LOW = 0.2;
/** De quantos em quantos segundos da partida a bateria é lida, e quanto tempo o aviso fica na tela. */
const BATTERY_CHECK_S = 5;
const BATTERY_NOTICE_S = 6;
/** M2 (fase 3e): por quanto tempo o aviso de um aliado fica na tela (s). */
const PING_SHOW_S = 2.5;
/** Refino R2 (#79): aviso de granada dos outros até esta distância (m; o raio da explosão é 5). */
const GRENADE_WARN_M = 7;
/** Refino R2 (#79): um ponto do arco da granada a cada tantos ticks da previsão. */
const ARC_EVERY_TICKS = 3;
/** M2 (fase 3h, prints): avisos a menos desta fração da altura da vista um do outro viram um só. */
const PING_MERGE_FRAC = 0.04;
/** M5 (fase 5d): quanto o balão do emote fica no ar (s), e quantos pings de humanos a cena guarda. */
const EMOTE_SHOW_S = 2.5;
const MAX_HUMAN_PINGS = 8;
/** A base do balão fica acima dos pés (m): logo acima da cabeça. */
const EMOTE_HEIGHT_M = 2.35;
/** M2 (fase 2e): o resultado aparece este tempo depois do fim da partida (s). */
const RESULT_DELAY_S = 2.5;
/** M7 (fase 8, revisão): no Royale, o resultado de quem saiu vem depois da câmera de morte (s). */
const ROYALE_RESULT_DELAY_S = 4;
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
// M3 (fase 3d): + as tábuas das janelas (até 6 por janela) e as portas fechadas no mesmo buffer.
const MAX_DRAWN_PROJECTILES = 384;
/**
 * M10 (fase 7): os virotes cravados (só do render): quantos ao mesmo tempo, quanto tempo ficam (s, "alguns segundos",
 * GDD §4.3.3) e quanto o meio do modelo (`crossbow-bolt`, ponta a 0,34 m do meio) fica atrás da ponta (m): a ponta
 * entra 4 cm no bloco (revisão: com 6 cm, ela passava das placas finas de 6,25 cm, os painéis e o corrimão).
 */
const STUCK_BOLT_MAX = 24;
const STUCK_BOLT_S = 5;
const STUCK_BOLT_BACK_M = 0.3;

/** M3 (fase 5c): rajadas de cubinhos da gosma e das faíscas: velocidade (x, y, z) e espalhamento de cada uma. */
const GOO_BURSTS: readonly number[] = [3, 4, 0, 1.2, -3, 4, 1, 1.2, 0, 5, -3, 1.2, 1, 3, 3, 1.5];
const GOO_COLORS: readonly number[] = [0x93ad57, 0x6e9444, 0x4f7a3a, 0x93ad57];
const SPARK_COLORS: readonly number[] = [0x3ddc97, 0x9ee8ff, 0x3ddc97, 0xfff1b8];

/** M3 (fase 4d): o anúncio de cada drop (na ordem de `PICKUP_KIND`, a partir de `maxAmmo`). */
const DROP_TEXT: readonly StringKey[] = [
  'drop.maxAmmo',
  'drop.nuke',
  'drop.doublePoints',
  'drop.instaKill',
  'drop.carpenter',
];
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
/** M7 (fase 4): quem morre no BoboStrike passa a assistir um aliado depois de tantos segundos; a câmera atrás dele. */
const STRIKE_SPECTATE_S = 3;
/** M7 (fase 8): a cura e o alcance da troca do Royale (os da sim: `ROYALE`). */
const ROYALE_HEAL_S = ROYALE.healUseS;
const ROYALE_SWAP_REACH_M = ROYALE.swapReachM;

/** M7 (fase 4): o dinheiro com o ponto do milhar ("2.700"), sem `Intl` (regra 13). */
function moneyText(n: number): string {
  const v = Math.max(0, Math.floor(n));
  return v >= 1000 ? `${Math.floor(v / 1000)}.${String(v % 1000).padStart(3, '0')}` : String(v);
}

/** M7 (fase 4): o primeiro aliado vivo de `e` (índice), ou -1. */
function livingMate(v: SimView, e: number): number {
  const team = v.team[e];
  for (let i = 0; i < v.count; i++) {
    if (i === e || v.alive[i] !== 1 || v.kind[i] !== ENTITY_KIND.bobo || v.team[i] !== team) continue;
    if ((v.flags[i]! & ENTITY_FLAG.dead) === 0) return i;
  }
  return -1;
}

export function gripOfWeaponModel(id: string): FigureGrip {
  if (id === '') return FIGURE_GRIP.none;
  for (let c = 0; c < ARSENAL.length; c++) if (ARSENAL[c]!.id === id) return ARSENAL[c]!.grip;
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
/** M4 (fase 7a): de quanto em quanto tempo (s de partida) o Switch grava a linha `[mem]`. */
const MEMORY_LOG_EVERY_S = 60;
/** M5 (fase 7a): de quanto em quanto tempo (s) a partida online grava a linha `[rede]` (vai no "Copiar relatório"). */
const NET_LOG_EVERY_S = 30;
/** M6 (fase 1): a letra do ponto do Domination fica a esta altura acima do anel (m). */
const POINT_MARK_HEIGHT_M = 2.2;
/** M6 (fase 5): o tamanho das manchas de tinta (m; a cor é a do time, M10 fase 8: da tabela da partida). */
const PAINT_BALL_SPLAT_M = 0.45;
const PAINT_BUCKET_SPLAT_M = 1.8;
/** Onde procurar o bloco da superfície (o chão primeiro) e a quantos metros do ponto da tinta. */
const PAINT_PROBES = [0, -1, 0, 1, 0, 0, -1, 0, 0, 0, 0, 1, 0, 0, -1, 0, 1, 0] as const;
const PAINT_PROBE_M = 0.12;
/** Acima disto (m) entre o snapshot anterior e o atual, a bola é outra no mesmo lugar do pool (sem interpolar). */
const PAINT_JUMP_M = 12;
/** M6 (fase 4b): pedidos de confete da Festa por quadro (cada um, 2 punhados de 4 cubinhos). */
const CONFETTI_PER_FRAME = 4;
/** M6 (fase 3): a altura da plaquinha JUGG acima dos pés do Jugg (m). */
const JUGG_MARK_HEIGHT_M = 2.4;
/** M6 (fase 6a): a altura da plaquinha do gerador acima da base dele (m). */
const GENERATOR_MARK_HEIGHT_M = 2;
/** M4 (fase 5b): depois de quantos frames conferir se algum programa de shader nasceu fora do aquecimento. */
const PROGRAM_CHECK_FRAMES = 120;

/** Refino R4 (#79): a escala do viewmodel com 1 ou 2 jogadores (era 0,8; com 3–4 e no lado a lado, 0,6). */
const VIEWMODEL_SCALE_1P = 0.68;

const VIEWMODEL_TWEAK: readonly (ViewmodelTweak | null)[] = WEAPONS.map((w) =>
  w.code === WEAPON_CODE.rocket
    ? { scale: 0.62, x: 0.13, y: -0.04, z: -0.1 }
    : w.code === WEAPON_CODE.lmg
      ? { scale: 0.9, x: 0.02, y: 0, z: -0.04 }
      : w.code === WEAPON_CODE.sniper
        ? { scale: 0.75, x: 0.05, y: -0.03, z: -0.1 }
        : null,
);

/**
 * M10 (fases 6 e 7): o ajuste das armas novas (os códigos 27 a 31, fora do índice de `VIEWMODEL_TWEAK`): o DMR é
 * comprido como a sniper; a besta, larga (o arco tem 0,69 m de ponta a ponta); a escopeta automática e o
 * lança-granadas, gordos (o carregador de caixa, o tambor). O revólver fica como está (pelos prints da 1ª pessoa).
 */
const VIEWMODEL_TWEAK_M10: ReadonlyMap<number, ViewmodelTweak> = new Map([
  [WEAPON_CODE.dmr, { scale: 0.8, x: 0.04, y: -0.02, z: -0.08 }],
  [WEAPON_CODE.autoShotgun, { scale: 0.82, x: 0.04, y: -0.03, z: -0.06 }],
  [WEAPON_CODE.crossbow, { scale: 0.82, x: 0.04, y: -0.02, z: -0.06 }],
  [WEAPON_CODE.grenadeLauncher, { scale: 0.82, x: 0.06, y: -0.03, z: -0.06 }],
]);

/**
 * A arma mira por luneta: no ADS completo o viewmodel some e a HUD desenha a moldura. A partir de 3x de zoom (a sniper,
 * as raras e a de tinta dela) e, M10 (revisão), o DMR (2,5x): mirar pela arma deixava a lente de trás tapando o centro.
 * A besta e o resto miram pela arma (a mira passa por cima da alça ou da mira de ponto).
 */
function hasScope(def: WeaponDef): boolean {
  return def.adsZoom >= 3 || def.code === WEAPON_CODE.dmr;
}

/** Primárias em rodízio do `weapons=mix` do bench. */
const MIX_PRIMARIES = [
  WEAPON_CODE.rifle,
  WEAPON_CODE.smg,
  WEAPON_CODE.shotgun,
  WEAPON_CODE.sniper,
  WEAPON_CODE.rocket,
  WEAPON_CODE.lmg,
  // M10 (revisão): as primárias novas, no fim (os 6 primeiros controladores ficam com as de antes).
  WEAPON_CODE.dmr,
  WEAPON_CODE.autoShotgun,
  WEAPON_CODE.crossbow,
  WEAPON_CODE.grenadeLauncher,
] as const;

/** Primária de cada controlador para o `weapons=` do bench (`mix` em rodízio; senão todos com a arma dada). */
export function benchPrimaries(weapons: string): number[] {
  const out: number[] = [];
  const fixed = ARSENAL.find((w) => w.id === weapons);
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
/**
 * As vistas locais do pedido (o bench pede as dele; a partida, uma por assento do sofá). M11 (fase 5, revisão): o
 * Royale Grande é sempre 1 vista (sem sofá): o perfil fica o de 1 vista (o `pc`, não o `pcSplit`, que recusa o modo).
 */
export function sceneViews(request: SceneRequest): number {
  if (request.kind === 'bench' && request.bench) return request.bench.views;
  if (request.kind !== 'play' || (request.recipe !== undefined && soloViewMode(request.recipe.mode))) return 1;
  return Math.max(1, Math.min(4, request.seats?.length ?? 0));
}

/**
 * M3 (fase 1c): a partida veio da tela do sofá (com 1 jogador, também), e quem segura A num controle livre entra no
 * meio. M11 (fase 5, revisão): no Royale Grande, não (1 vista só).
 */
export function couchJoinAllowed(request: SceneRequest, recipe: MatchRecipe, humans: number): boolean {
  return request.kind === 'play' && (request.seats?.length ?? 0) >= 1 && humans > 0 && !soloViewMode(recipe.mode);
}

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
  /** M3 (fase 1a): o controlador da sim de cada assento local (o P1 é o 0); `[0]` com 1 jogador. */
  readonly seatControllers: readonly number[];
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
  let seatControllers: readonly number[] = [0];
  if (request.kind === 'bench' && bench) {
    humans = 0;
    seatControllers = [];
    let bots = bench.bots;
    if (bench.views + bots > ENGINE_MAX_BOTS) {
      bots = ENGINE_MAX_BOTS - bench.views;
      warnings.push(`bots limitado a ${bots} (${bench.views} jogadores locais também são bots)`);
    }
    if (!bench.armed) warnings.push('armed=0 ainda não existe no M1: os bots estão armados');
    if (bench.scene === 'zombies' || bench.scene === 'farm') {
      // M3 (fase 7b): o Bobo Zombies na Base, sem fim: as vistas são bots de apoio (o `bots=` não vale aqui) com 1000 de
      // vida (a horda se acumula sem derrubar o time), zumbis 3× mais numerosos e com 5× a vida (o pool enche). M10
      // (fase 5): o mesmo na Fazenda (`scene=farm`).
      recipe = {
        format: MATCH_RECIPE_FORMAT,
        mode: 'zombies',
        map: bench.scene === 'farm' ? 'farm' : 'base',
        seed: bench.seed >>> 0,
        match: { timeLimitS: 0, scoreLimit: 0, viewDistanceM: bench.viewDistanceM },
        players: { hp: 1000 },
        zombies: { waves: 0, quantity: 3, hpMul: 5, selfRevives: -1 },
        teams: [{ bots: [{ ref, count: bench.views }] }],
      };
    } else if (bench.scene === 'island' || bench.scene === 'archipelago') {
      // M7 (fase 5): a Ilha Tropical. Fase 8: o Royale solo (as vistas e os bots; a partida acaba no último vivo).
      // M11 (fase 5): o Arquipélago, com o Royale Grande.
      const grande = bench.scene === 'archipelago';
      recipe = {
        format: MATCH_RECIPE_FORMAT,
        mode: grande ? 'royale.grande' : 'royale.mini',
        map: grande ? 'archipelago' : 'island',
        seed: bench.seed >>> 0,
        match: { viewDistanceM: bench.viewDistanceM },
        // Muita vida para todos (como o bench do Zombies): a partida dura o bench todo e as vistas não morrem.
        players: { hp: 1000 },
        royale: { squad: 'solo' },
        teams: [{ bots: [{ ref, count: bench.views + bots }] }],
      };
    } else {
      const total = bench.views + bots;
      const a = Math.ceil(total / 2);
      const b = total - a;
      recipe = {
        format: MATCH_RECIPE_FORMAT,
        mode: 'warfare.tdm',
        // M7 (fase 1): o TDM na Base Bobo (`scene=airbase`). M10: no Canteiro (`scene=construction`), no Porto
        // (`scene=port`) e na Estação Lunar (`scene=moonbase`).
        map:
          bench.scene === 'airbase' ||
          bench.scene === 'construction' ||
          bench.scene === 'port' ||
          bench.scene === 'moonbase'
            ? bench.scene
            : 'construto',
        seed: bench.seed >>> 0,
        match: { timeLimitS: 0, viewDistanceM: bench.viewDistanceM },
        teams: [{ bots: [{ ref, count: a }] }, { bots: b > 0 ? [{ ref, count: b }] : [] }],
      };
    }
  } else if (request.kind === 'wardrobe') {
    // M2 (fase 6c): o Meu Bobo: o Ringue sem ninguém (o bobo é um manequim).
    humans = 0;
    seatControllers = [];
    recipe = {
      format: MATCH_RECIPE_FORMAT,
      mode: 'training',
      map: 'ringue',
      seed: request.seed >>> 0,
      match: { timeLimitS: 0, scoreLimit: 0 },
      teams: [{ bots: [] }],
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
  } else if (request.kind === 'play' && request.online && request.recipe) {
    // M5 (fase 4b): a receita do host como veio (o lobby já pôs os amigos nos times); a semente é a do começo.
    recipe = { ...request.recipe, seed: request.seed >>> 0 };
    humans = request.online.humans;
    seatControllers = [request.online.localController];
  } else if (request.kind === 'play' && request.recipe) {
    // M2 (fase 4c): o preset pedido, com a semente desta partida (o validador abaixo corta no teto do aparelho).
    recipe = { ...request.recipe, seed: request.seed >>> 0 };
    // M7 (fase 9): o Aquário: o lugar do jogador vira um bot do mesmo time (a partida é só de bots).
    if (request.spectate === true && recipe.mode !== 'training') {
      recipe = spectateRecipe(recipe, ref);
      humans = 0;
      seatControllers = [];
    }
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
  // M11 (fase 5): o bench e o cliente online sem o teto do Royale Grande do aparelho (o do motor).
  const engineGrande = ENGINE_MAX_BOTS + 4;
  const limits =
    request.kind === 'bench'
      ? {
          maxBots: ENGINE_MAX_BOTS,
          maxLocalHumans: 4,
          maxViewDistanceM: PLATFORM_PROFILES.pc.maxViewDistanceM,
          maxRoyaleGrandeParticipants: engineGrande,
        }
      : request.online
        ? // M5: online, só os limites do motor nos bots: o cliente não pode cortar a receita do host (a sim mudaria);
          // a distância de visão é só do render (a sim usa a dela), então corta pelo aparelho.
          {
            ...recipeLimitsFor(profile),
            maxBots: ENGINE_MAX_BOTS,
            maxLocalHumans: 4,
            maxRoyaleGrandeParticipants: engineGrande,
          }
        : recipeLimitsFor(profile);
  // M3 (fase 1a): o sofá, até o teto de humanos locais do aparelho. M11 (fase 5): o Royale Grande não tem sofá (GDD
  // §4.1.3: "local web não"); a partida começa com 1 jogador e ninguém entra no meio.
  const seats =
    request.kind === 'play' && !request.online && humans > 0 && !soloViewMode(recipe.mode)
      ? (request.seats ?? []).slice(0, limits.maxLocalHumans)
      : [];
  if (seats.length >= 2) {
    const seated = seatRecipe(recipe, seats);
    recipe = seated.recipe;
    seatControllers = seated.controllers;
    humans = seats.length;
  }
  const checked = validateMatchRecipe(recipe, limits);
  if (!checked.ok) throw new Error(`cena: receita recusada (${checked.errors.map((e) => e.code).join(', ')})`);
  return { recipe: checked.value, humans, warnings, seatControllers };
}

/** Uma vista local: a câmera, a HUD dela e o que ela segue. */
interface ViewSlot {
  readonly desc: ViewDesc;
  readonly hud: DrawList;
  readonly model: HudModel;
  /** M3 (fase 1c): o jogador desta vista (0 = P1): a cor e o símbolo dela, estáveis quando alguém sai. */
  seat: number;
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
  /** M7 (fase 8): o Royale: a colocação e o texto de quem saiu, a arma da troca e o aviso dela (feitos ao mudar). */
  royalePlace: number;
  royaleOut: string;
  royaleArmor: number;
  royaleArmorText: string;
  royaleSwapCode: number;
  royaleSwapText: string;
  /** M7 (fase 4): o cursor do anel da compra do BoboStrike e a opção apontada (-1 = nenhuma). */
  readonly buy: DeathState;
  buyPick: number;
  /**
   * M7 (fase 4, revisão): o anel aberto e a mira guardada na abertura (a câmera fica nela; o giro move o cursor), o
   * título por vista (o dinheiro de cada um) e o toque curto em curso (o dedo, a opção onde começou e a de agora).
   */
  buyOpen: boolean;
  buyYaw: number;
  buyPitch: number;
  buyMoney: number;
  buyTitle: string;
  tapId: number;
  tapOpt: number;
  tapNow: number;
  /**
   * M8 (fase 6): a roda das ordens (o aviso segurado): aberta, o cursor (o giro da mira move, como no anel da compra),
   * a ordem apontada (-1 = nenhuma), a mira guardada na abertura e o aviso da resposta ("Vem comigo: 2 de 3 bots").
   */
  orderOpen: boolean;
  readonly order: DeathState;
  orderPick: number;
  orderYaw: number;
  orderPitch: number;
  orderNotice: string;
  orderNoticeS: number;
  orderAnswerTick: number;
  /**
   * M2 (fase 6b): 3ª pessoa nesta vista no último frame, a câmera de ombro e onde ela ficou em relação ao olho (o
   * quadro do humano mira pelo raio da câmera).
   */
  third: boolean;
  readonly shoulder: ShoulderPose;
  camOffX: number;
  camOffY: number;
  camOffZ: number;
}

export interface ConstrutoMatch {
  readonly driver: SceneDriver;
  readonly debug: GameDebugApi;
  readonly paused: boolean;
  readonly wantsPointerLock: boolean;
  /** M2 (fase 7d): no resultado, a música do menu volta (GDD §5.10). */
  readonly wantsMusic: boolean;
  /** M3 (fase 6e): o Bobo Zombies toca a própria música (a do menu só volta no resultado). */
  readonly ownsMusic: boolean;
  /** M2 (fase 2e): nível rápido dos bots adversários agora. */
  readonly level: BotLevel;
  pause(): void;
  /** M2 (fase 5e): ver `Scene.trainingReport` e `Scene.nemesisBot`. */
  trainingReport(): TrainingReport | null;
  nemesisBot(): BotDocument | null;
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
  /**
   * Os jogadores locais (no online, todos os humanos da partida). M7 (fase 9): no Aquário começa em 0 e vira 1 enquanto
   * um bot está assumido (`pilot`); o resto da partida (nomes, regras, a expansão da receita) é de antes, com 0.
   */
  let humans = setup.recipe.humans;
  /** M7 (fase 9): o Aquário (só bots, fora do online). */
  const aquarium = request.kind === 'play' && request.spectate === true && !request.online && humans === 0;
  const ffa = isFfaMode(recipe.mode);
  /**
   * M6 (fase 3): o Juggernaut. Os caçadores são um time (sem fogo amigo, os marcadores dos aliados), mas o placar e o
   * vencedor são de cada um (os pontos de Jugg): `solo` vale para o resultado e o placar do alto.
   */
  const juggernaut = recipe.mode === 'juggernaut';
  /** M7 (fase 4): o BoboStrike (o dinheiro, a compra, a Boom Box e quem morre assiste um aliado). */
  const strikeMode = recipe.mode === 'strike';
  /** M7 (fase 8): o Bobo Royale (o `team` é o esquadrão: sem colete de time; a zona, o loot e a colocação). */
  const royaleMode = isRoyaleMode(recipe.mode);
  /** M9 (fase 3): o Bobo Sandbox (até 4 times; na eliminação, quem morre fica fora até o fim). */
  const sandboxMode = recipe.mode === 'sandbox';
  const sandboxElimination = sandboxMode && recipe.sandbox?.objective === 'elimination';
  const solo = ffa || juggernaut;
  const warnings: string[] = [...request.benchWarnings, ...setup.warnings, ...setup.recipe.warnings];
  // Alarme do orçamento de skins (#56, PLANO §B15): conjunto além da reserva veste o padrão do próprio time.
  if (figures.plan.overflow.length > 0) {
    warnings.push(`skins de boneco: ${figures.plan.overflow.length} conjuntos além da reserva vestem o padrão do time`);
  }

  // --- jogador humano (JOGAR e Cena-vitrine): mapeador que segue o último dispositivo usado (como no M0) ---
  // M2 (fase 4f): os perfis com os controles dos Ajustes (refeitos quando a pausa muda um ajuste).
  const buildProfiles = (): Readonly<Record<DeviceKind, ControlProfile>> => {
    const c = host.settings.current.controls;
    // #73: sem mouse (o teclado USB do Switch) o teclado mira nas setas e usa a assistência do controle.
    const keyboardMouse = platform.features.keyboardMouse
      ? applyControls(createKeyboardMouseProfile(), c.keyboardMouse)
      : {
          ...applyControls(createKeyboardMouseProfile({ mouse: false }), c.keyboardMouse),
          aimAssist: AIM_ASSIST_LEVELS[c.gamepad.aimAssist],
        };
    return {
      keyboardMouse,
      gamepad: applyControls(createGamepadProfile(request.convention), c.gamepad),
      touch: applyControls(createTouchProfile(), c.touch),
    };
  };
  let profiles = buildProfiles();
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
  // M3 (fase 1a): no sofá, cada assento fica preso ao seu dispositivo (o P1 também). Fase 1c: da tela do sofá, mesmo
  // com 1 jogador, para os outros poderem entrar no meio.
  const seats: readonly LocalSeat[] =
    request.kind === 'play' && (request.seats?.length ?? 0) >= 1 ? request.seats!.slice(0, Math.max(1, humans)) : [];
  /** A partida veio da tela do sofá: quem segura A num controle livre entra no meio (fase 1c; nunca no Grande). */
  const couch = seats.length >= 1 && couchJoinAllowed(request, recipe, humans);
  const p1Seat = seats[0];
  let device: DeviceKind = p1Seat ? p1Seat.device.kind : (request.device ?? fallbackDevice);
  let padIndex = p1Seat?.device.kind === 'gamepad' ? p1Seat.device.index : Math.max(0, request.gamepad);
  const bindingFor = (kind: DeviceKind, pad: number): DeviceBinding =>
    kind === 'gamepad' ? pads[pad]! : kind === 'touch' ? touch : keyboard;
  const player: InputMapper = createInputMapper(bindingFor(device, padIndex), profiles[device]);
  /**
   * M3 (fase 1a): os jogadores locais 2..4 do sofá (`SceneRequest.seats`), um mapeador preso ao dispositivo de cada
   * assento. `seatControllers[k]` é o controlador da sim do assento `k` (o P1 é o 0; os do time adversário vêm depois
   * dos do time do P1).
   */
  /**
   * O controlador da sim de cada assento (o 0 é o P1). Fase 1c: cresce quando alguém entra no meio, no lugar de um bot.
   */
  const seatCtrl: number[] = humans > 0 ? setup.recipe.seatControllers.slice(0, Math.max(1, seats.length)) : [];
  /**
   * M5 (fase 4b): o controlador do jogador deste aparelho (o P1). No solo e no sofá é o 0; no online, o que o lobby deu
   * (o host pode estar no time 1, e cada cliente tem o seu).
   */
  let me = seatCtrl[0] ?? 0;
  /**
   * M3 (fase 1e): o perfil do jogador de número `num` (0 = P1, que usa os Ajustes): o do dispositivo com a mira e o Y do
   * ajuste dele (`settings.couch`, mudado na tela do sofá).
   */
  const seatProfile = (num: number, kind: DeviceKind): ControlProfile => {
    const base = profiles[kind];
    const key = COUCH_PLAYER_KEYS[num - 1];
    if (key === undefined) return base;
    const c = host.settings.current.couch[key];
    return {
      ...base,
      lookSensitivity: base.lookSensitivity * c.sensitivity,
      keyLookRate: base.keyLookRate * c.sensitivity,
      invertY: c.invertY,
    };
  };
  const extras: InputMapper[] = seats
    .slice(1)
    .map((s, i) => createInputMapper(s.device, seatProfile(i + 1, s.device.kind)));
  const extraDevices: DeviceBinding[] = seats.slice(1).map((s) => s.device);
  const extraAssists = extras.map(() => createAimAssistState());
  /** O número de jogador de cada assento (0 = P1): quem entra no meio pega o menor livre. */
  const seatNum: number[] = seatCtrl.map((_, k) => k);
  /** Id do controle de cada assento (para achar o mesmo controle se ele voltar em outro índice); '' = ainda não visto. */
  const seatPadId: string[] = seatCtrl.map(() => '');
  /** O assento cujo controle caiu (-1 = nenhum) e o que pausou (0 = o P1). */
  let lostSeat = -1;
  let pausedBy = 0;
  /** O `MenuInput` do frame (a pausa do P2–P4 passa os menus para o dispositivo dele). */
  let frameMenu: MenuInput | null = null;
  /** O assento do controlador `c` (0 = o P1), ou -1 (bot). */
  const seatOf = (c: number): number => {
    for (let k = 0; k < seatCtrl.length; k++) if (seatCtrl[k] === c) return k;
    return -1;
  };
  /** Mapeador do controlador `c` se ele for um jogador local; `null` para bots. */
  const mapperOf = (c: number): InputMapper | null => {
    const k = seatOf(c);
    return k === 0 ? player : k > 0 ? extras[k - 1]! : null;
  };
  /** M2 (fase 3h): assistência de mira do humano (controle e toque; o nível vem do perfil do dispositivo). */
  const assist = createAimAssistState();
  const assistAngles = new Float64Array(2);
  const drain = createInputFrame();

  // --- modelos: arma por código da sim (M2: `SimView.weapon` é o código) e o alvo do ADS do viewmodel ---
  const modelIndex = loaded.world.modelIndex;
  // M10: no índice do código, até a última arma nova (`WEAPONS_M10`; o modelo tem o id da arma, como as do M2).
  const weaponModel = new Uint8Array(WEAPON_M10_FIRST + WEAPONS_M10.length).fill(NO_MODEL);
  for (const w of ARSENAL) {
    const m = modelIndex.get(w.id);
    if (m !== undefined) weaponModel[w.code] = m;
  }
  const aimOffsets = loaded.modelDocs.map((m) => viewmodelAimOffset(m));
  // M2: nome e categoria de cada arma na tabela pt-BR, resolvidos uma vez (a HUD só guarda a referência).
  const weaponNames = WEAPONS.map((w) => t(`weapon.${w.id}` as StringKey));
  // M10: as armas novas (o nome em inglês bobo e a categoria, como as do M2).
  for (const w of WEAPONS_M10) weaponNames[w.code] = t(`weapon.${w.id}` as StringKey);
  // M3 (fase 4e): o Desmontador fica fora de `WEAPONS` (só da caixa), mas tem nome e categoria no HUD.
  weaponNames[WEAPON_DESMONTADOR] = t('weapon.desmontador');
  // M6 (fase 3): a Big Brrt (só do Jugg) também. Fase 4: a explosão do "tudo explode" no kill feed.
  weaponNames[WEAPON_BIG_BRRT] = t('weapon.big-brrt' as StringKey);
  weaponNames[WEAPON_CHAOS_BLAST] = t('weapon.chaos-blast' as StringKey);
  // M6 (fase 5): as armas de tinta do Paintball.
  for (const code of [WEAPON_PAINT_MARKER, WEAPON_PAINT_PUMP, WEAPON_PAINT_SNIPER, WEAPON_PAINT_BUCKET]) {
    weaponNames[code] = t(`weapon.${weaponDef(code)!.id}` as StringKey);
  }
  // M7 (fase 8): as armas raras e épicas do Royale: o nome da base com a raridade ("Rattler épica").
  for (const w of ROYALE_WEAPONS) {
    const key = weaponRarity(w.code) >= 2 ? 'weapon.rarity.epic' : 'weapon.rarity.rare';
    weaponNames[w.code] = t(key as StringKey, { name: weaponNames[weaponBase(w.code)] ?? '' });
  }
  /** M3 (fase 4a): os nomes em caixa alta do aviso da arma na parede (feitos uma vez). */
  const weaponNamesUpper = weaponNames.map((n) => n.toUpperCase());
  const weaponCategories = WEAPONS.map((w) => t(`weapon.category.${w.category}` as StringKey));
  for (const w of WEAPONS_M10) weaponCategories[w.code] = t(`weapon.category.${w.category}` as StringKey);
  weaponCategories[WEAPON_DESMONTADOR] = t('weapon.category.explosive');
  weaponCategories[WEAPON_BIG_BRRT] = t('weapon.category.lmg');
  for (const code of [WEAPON_PAINT_MARKER, WEAPON_PAINT_PUMP, WEAPON_PAINT_SNIPER, WEAPON_PAINT_BUCKET]) {
    weaponCategories[code] = t('weapon.category.paint' as StringKey);
  }
  for (const w of ROYALE_WEAPONS) weaponCategories[w.code] = weaponCategories[weaponBase(w.code)] ?? '';
  // M2 (fase 2c): tela de morte. Nomes por controlador, textos da faixa e as opções do radial (resolvidos uma vez).
  const names = controllerNames(recipe, humans);
  // M5 (fase 4c): online, cada humano com o nome que escolheu na sala (o filtro do atlas: veio de outro aparelho).
  if (request.online) {
    request.online.names.forEach((name, c) => {
      const clean = name === undefined ? '' : cleanTypedName(name, 16).trim();
      if (clean !== '' && c < humans) names[c] = clean;
    });
  }
  /**
   * M9 (fase 5): as Ferramentas do Dono (só no Sandbox): a reserva de bots dormentes. Offline, 8 no teto de bots do
   * aparelho (AH7); online, a que o host mandou no começo (a sim do amigo tem que ser a do host). Os bots da reserva
   * ganham nome (e, pelo nome, look) como os da receita, a mesma conta nos dois lados.
   */
  const ownerReserve =
    request.kind !== 'play'
      ? null
      : request.online
        ? (request.online.ownerReserve ?? null)
        : ownerReserveFor(recipe, humans, profile.maxBots);
  if (ownerReserve !== null) addReserveNames(names, recipe, humans, ownerReserve);
  /** M2 (fase 8a): o look de cada bot pelo nome (o mesmo bot veste o mesmo look em qualquer partida). */
  const botLook = botLookIndices(names, figures.botLooks);
  /** M2 (fase 4e): o que a regra da partida deixa a HUD mostrar (`MatchRecipe.hud`) e a assistência permitida. */
  const showKillFeed = recipe.hud?.killFeed ?? true;
  const showHitmarker = recipe.hud?.hitmarker ?? true;
  const showAllyMarkers = recipe.hud?.allyMarkers ?? true;
  const assistAllowed = recipe.weapons?.aimAssist ?? true;
  /** M2 (fase 7b): os sons da partida (o `sim` só existe depois do driver; as funções só rodam com a partida viva). */
  const matchSound = createMatchSound({
    mixer: host.audio.mixer,
    // M3 (fase 1e): os jogadores locais são os assentos (quem entrou no meio também).
    get humans(): number {
      return seatCtrl.length;
    },
    localEntity: (p) => (p < seatCtrl.length ? sim.controllerEntity(seatCtrl[p]!) : NULL_ENTITY),
    hitmarker: showHitmarker,
    ffa,
    soloWinner: juggernaut,
  });
  /** M2 (fecho da fase 3): as regras ativas de cada controlador (placar e tela de morte). */
  const ruleTexts = controllerRules(recipe, humans);
  const deathTx = deathTexts();
  const primaryNames = PRIMARY_ORDER.map((code) => weaponNames[code] ?? '');
  const primaryCategories = PRIMARY_ORDER.map((code) => weaponCategories[code] ?? '');
  const NO_PRIMARIES: readonly string[] = [];
  /**
   * M9 (fase 3b): as opções do radial de cada time (índices em `PRIMARY_ORDER`), com os nomes e as categorias: no
   * Sandbox, só as armas do time; com o `weapons.allowed`, só as da partida. O time fora da receita (FFA) usa o 0.
   */
  const teamChoices = recipe.teams.map((_, team) => primaryChoices(recipe, team));
  const teamChoiceNames = teamChoices.map((c) => c.map((i) => primaryNames[i]!));
  const teamChoiceCategories = teamChoices.map((c) => c.map((i) => primaryCategories[i]!));
  const choicesOf = (team: number): number => (team >= 0 && team < teamChoices.length ? team : 0);
  /**
   * Escolha de cada jogador local no radial (índice em `PRIMARY_ORDER`; começa no fuzil, a primária padrão), por
   * assento (M3, fase 1d: o radial vale para o P2–P4 também).
   */
  const seatPrimary: number[] = [0, 0, 0, 0];
  /** Derrota feia (GDD §3.8): mortes seguidas do humano sem abate e se a dica já saiu nesta partida. */
  let deathsWithoutKill = 0;
  let hardHintUsed = false;
  // M9 (fase 3): os limites que a sim joga (no Sandbox, os padrões e o objetivo), não os crus da receita.
  const { timeLimitS, scoreLimit } = matchLimits(recipe);
  const camAngles = { yaw: 0, pitch: 0 };
  /** M9 (fase 1b): a direção do recuo da câmera de morte (`deathCamBackoff`). */
  const camBack = { x: 0, z: 0 };
  // M2 (fase 2d): HUD da partida (kill feed, placar do Tab, contagem inicial e marcadores dos aliados).
  const killFeed = createKillFeedModel();
  const scoreboard = createScoreboardModel();
  // M10 (fase 8): a cor de cada time nesta partida (a do Sandbox, se escolhida): o placar do Tab, o do alto, o feed,
  // os marcadores e a tinta leem daqui.
  const teamColors = teamColorTable(recipe);
  for (let i = 0; i < scoreboard.teamColors.length; i++) scoreboard.teamColors[i] = teamColors[i]!;
  scoreboard.title = t(`mode.${recipe.mode}` as StringKey);
  // M9 (fase 3): o nome de cada time no cabeçalho da tabela dele (o que o Sandbox deu, ou o da cor).
  for (let i = 0; i < recipe.teams.length && i < scoreboard.teamNames.length; i++) {
    scoreboard.teamNames[i] = teamName(recipe, i);
  }
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
  const todayLine = countdownLine(recipe, humans, names, me);
  /** M8 (fase 4, revisão): os controladores que um jogador já assumiu (o sofá, o Aquário): não contam como bot. */
  const everHuman = new Set<number>();
  /**
   * M8 (fase 4): o Nêmesis voltou? Na contagem, a 2ª linha ("Seu Nêmesis voltou: Jorge · te pegou 7, você 3"). Só na
   * partida de verdade com jogador (o Aquário e o bench não têm rival).
   */
  const nemesisLine = ((): string => {
    const mem = host.stats.current.nemesis;
    if (mem === undefined || request.kind !== 'play' || humans === 0) return '';
    const slots = expandRecipe(recipe, humans);
    // Do lado de lá (o rival aliado, como o bot de apoio do Zombies, não conta); no FFA, na Infection (quem é infectado
    // muda) e no Royale (os esquadrões saem da largada), todos.
    const everyone = solo || recipe.infection !== undefined || royaleMode;
    const myTeam = slots.find((sl) => sl.controller === me)?.team ?? 0;
    for (const slot of slots) {
      if (slot.bot !== null && (everyone || slot.team !== myTeam) && resolveBot(recipe, slot.bot).id === mem.id) {
        const name = names[slot.controller] ?? mem.name;
        return t('nemesis.back', { name, them: mem.killedYou, you: mem.youKilled });
      }
    }
    return '';
  })();
  const projected = new Float64Array(3);
  /** M2 (fase 3e): avisos do time (x, y, z) lidos do diretor. */
  const pingScratch = new Float64Array(MAX_TEAM_PINGS * 3);
  // M2 (fase 2e): pausa com páginas, nível dos bots adversários, Destravar e o resultado.
  let pausePage: 'main' | 'challenge' | 'settings' | 'calibrated' | 'players' | 'owner' = 'main';
  // M2 (fase 5f): no Bobo Training, "Ajustar desafio" vira "Calibrar mira".
  const pauseState = {
    challenge: request.kind === 'play' && recipe.mode !== 'training' && request.online?.role !== 'client',
    calibrate: recipe.mode === 'training',
  };
  /** M2 (fase 5f): a calibração em andamento, a pedida pelos Ajustes (começa no fim da contagem) e o "Desfazer". */
  let calibration: CalibrationState | null = null;
  let calibrationPending = request.calibrate === true;
  let calibrationUndo: SettingsDocument | null = null;
  const calibrationAim = new Float64Array(2);
  const calibrationLines = [1, 2, 3].map((n) => t('calibrate.progress', { n }));
  let currentLevel: BotLevel =
    request.kind !== 'play'
      ? 'normal'
      : request.recipe
        ? (presetLevel(request.recipe) ?? 'normal')
        : (request.level ?? 'normal');
  /**
   * Times dos bots que o "Ajustar desafio" muda: o adversário no TDM (o humano é do time 0), todos no FFA (-1). M9 (fase
   * 3): no Sandbox, todos os times menos o seu.
   */
  const challengeTeams: readonly number[] =
    solo || royaleMode || aquarium
      ? [-1]
      : sandboxMode
        ? recipe.teams
            .map((_tm, i) => i)
            .filter((i) => i !== (expandRecipe(recipe, humans).find((sl) => sl.controller === me)?.team ?? 0))
        : [1];
  let unstuckPending = false;
  let matchStats = createMatchStats(1);
  let endedAt = -1;
  /** M7 (fase 8, revisão): quando todo humano local ficou fora do Royale (-1 = ainda não). */
  let royaleOutAt = -1;
  let resultShown = false;
  const resultMenu = createMenuController();
  // M2: o foguete em voo tem modelo próprio; a granada em voo usa o da mão.
  const rocketShellModel = modelIndex.get('rocket-shell') ?? NO_MODEL;
  // M2 (fase 2b): a caixinha de munição no chão.
  const ammoBoxModel = modelIndex.get('ammo-box') ?? NO_MODEL;
  const plankModel = modelIndex.get('zombie-plank') ?? NO_MODEL;
  const doorModel = modelIndex.get('zombie-door') ?? NO_MODEL;
  const boxModel = modelIndex.get('mystery-box') ?? NO_MODEL;
  const chalkModel = modelIndex.get('chalk-outline') ?? NO_MODEL;
  /** M3 (fase 4c): as máquinas, pelo bit da vantagem (1 chonky, 2 speedy, 4 buddy). */
  const perkModels = [
    modelIndex.get('perk-chonky') ?? NO_MODEL,
    modelIndex.get('perk-speedy') ?? NO_MODEL,
    modelIndex.get('perk-buddy') ?? NO_MODEL,
  ];
  /** M3 (fase 4c): os nomes das vantagens em caixa alta (o aviso da máquina), pelo índice do bit. */
  const perkNamesUpper = PERK_IDS.map((id) => t(`perk.${id}` as StringKey).toUpperCase());
  /** M3 (fase 4b): as armas que passam em cima da caixa enquanto ela gira (só o desenho; o sorteio é da sim). */
  const boxReel = [...WEAPONS.filter((w) => w.slot === WEAPON_SLOT.primary).map((w) => w.code), WEAPON_DESMONTADOR];
  const projectiles = createProjectileBuffer(MAX_DRAWN_PROJECTILES);
  // M3 (fase 3b): o cuspe do Spitter usa o modelo da granada até a arte dos zumbis (fase 5).
  const desmontadorModel = modelIndex.get('desmontador') ?? NO_MODEL;
  const boltModel = modelIndex.get('desmontador-bolt') ?? NO_MODEL;
  /** M10 (fase 7): o virote da besta (em voo e cravado) e a granada do lança-granadas em voo. */
  const crossbowBoltModel = modelIndex.get('crossbow-bolt') ?? NO_MODEL;
  const launcherShellModel = modelIndex.get('grenade-launcher-shell') ?? NO_MODEL;
  const bigBrrtModel = modelIndex.get('big-brrt') ?? weaponModel[WEAPON_CODE.lmg]!;
  /** M6 (fase 5): as armas de tinta usam os modelos do arsenal (SMG, escopeta, sniper e granada) até a arte delas. */
  const paintModel = (code: number): number =>
    weaponModel[
      code === WEAPON_PAINT_MARKER
        ? WEAPON_CODE.smg
        : code === WEAPON_PAINT_PUMP
          ? WEAPON_CODE.shotgun
          : code === WEAPON_PAINT_SNIPER
            ? WEAPON_CODE.sniper
            : WEAPON_CODE.grenade
    ]!;
  const modelOf = (code: number): number =>
    code === WEAPON_DESMONTADOR
      ? desmontadorModel
      : isPaintWeapon(code)
        ? paintModel(code)
        : code === WEAPON_BIG_BRRT
          ? bigBrrtModel
          : code === WEAPON_SPIT
            ? weaponModel[WEAPON_CODE.grenade]!
            : weaponBase(code) !== code
              ? (weaponModel[weaponBase(code)] ?? NO_MODEL)
              : // M10: o `weaponModel` vai até o código 31; as raras e épicas do Royale (19 a 26) usam o da base, acima.
                code >= 0 && code < weaponModel.length
                ? weaponModel[code]!
                : NO_MODEL;
  /** M7 (fase 8): o colete e o kit de cura do Royale no chão. */
  const armorVestModel = modelIndex.get('armor-vest') ?? NO_MODEL;
  const medkitModel = modelIndex.get('medkit') ?? NO_MODEL;
  /** M3 (fase 4d): o modelo de cada drop (munição cheia, bomba, pontos em dobro, insta-kill, carpinteiro). */
  const dropModels = [
    ammoBoxModel,
    modelOf(WEAPON_CODE.grenade),
    modelIndex.get('drop-double') ?? NO_MODEL,
    modelOf(WEAPON_CODE.knife),
    plankModel,
  ];

  // --- estado por entidade (fora da sim: cosmético) ---
  let flash = new Float32Array(1);
  let recoil = new Float32Array(1);
  let firing = new Float32Array(1);
  /** M6 (fase 4b): quando cada entidade atirou por último (s) e quem está invisível agora (1), para a mira assistida. */
  let shotAt = new Float32Array(1);
  let hiddenNow = new Uint8Array(1);
  let spawnT = new Float32Array(1);
  let reloadStart = new Float32Array(1);
  let reloadDur = new Float32Array(1);
  /** Fase do passo, só para o balanço do viewmodel (o boneco de 3ª pessoa anda pelo rig). */
  let walkPhase = new Float32Array(1);
  /** Skin (1ª das `FIGURE_SKIN_LAYERS` camadas; 0xffff = ainda não resolvida) e gabarito do boneco de cada entidade. */
  let skinLayer = new Uint16Array(1);
  let figureOf = new Uint8Array(1);
  /** M6 (fase 3): o time com que a figura foi resolvida (no Juggernaut a roupa troca quando o time muda). */
  let figureTeam = new Uint8Array(1);
  /**
   * Velocidade de cada entidade no tick anterior e no atual (m/s): o render recebe a interpolada pelo `alpha`, sem o
   * degrau do tick (o rig do boneco filtra a aceleração; saltos viram tranco nas molas, pedido da F4).
   */
  let velPrev = new Float32Array(3);
  let velCur = new Float32Array(3);
  /**
   * M9 (fase 1b): a escala dos modificadores desenhada de cada entidade (0 = fora do desenho): anda até a da sim
   * (`SimView.chaosScale`) pelo `approachScale`, para o gigante não estalar ao passar debaixo de uma porta. O boneco,
   * os marcadores em cima da cabeça, o clarão do tiro, o desmonte e a câmera de morte usam esta.
   */
  let shownScale = new Float32Array(1);
  /** M9 (revisão da fase 1b): a escala da MÁSCARA de cada entidade no último desenho (mudou = a Roleta: pula direto). */
  let shownMaskScale = new Float32Array(1);

  // --- vistas ---
  /** Fase 1c: cresce quando alguém entra no meio (o layout da HUD é refeito). */
  let viewCount = bench ? bench.views : 1 + extras.length;
  const slots: ViewSlot[] = [];
  const descs: ViewDesc[] = [];
  for (let i = 0; i < viewCount; i++) addViewSlot();
  function addViewSlot(): ViewSlot {
    const desc = createViewDesc();
    const hud = createDrawList(1024);
    slots.push({
      desc,
      hud,
      model: createHudModel(),
      seat: slots.length,
      controller: -1,
      eye: -1,
      adsBlend: 0,
      damageT: 0,
      flash: 0,
      shake: 0,
      death: createDeathState(),
      royalePlace: -1,
      royaleOut: '',
      royaleArmor: -1,
      royaleArmorText: '',
      royaleSwapCode: -1,
      royaleSwapText: '',
      buy: createDeathState(),
      buyPick: -1,
      buyOpen: false,
      buyYaw: 0,
      buyPitch: 0,
      buyMoney: -1,
      buyTitle: '',
      tapId: -1,
      tapOpt: -1,
      tapNow: -1,
      orderOpen: false,
      order: createDeathState(),
      orderPick: -1,
      orderYaw: 0,
      orderPitch: 0,
      orderNotice: '',
      orderNoticeS: 0,
      orderAnswerTick: -1,
      third: false,
      shoulder: createShoulderPose(),
      camOffX: 0,
      camOffY: 0,
      camOffZ: 0,
    });
    descs.push(desc);
    return slots[slots.length - 1]!;
  }
  const sharedHud = createHudSharedModel();
  for (let i = 0; i < sharedHud.teamColors.length; i++) sharedHud.teamColors[i] = teamColors[i]!;
  // M2 (fase 5d): Bobo Training: sem placar nem relógio; a linha dos números, refeita só quando eles mudam.
  const training = recipe.mode === 'training';
  /** M3 (fase 2d): Bobo Zombies: a linha da onda no lugar do placar, refeita só quando a onda ou os números mudam. */
  const zombiesMode = recipe.mode === 'zombies';
  /** M6 (fase 6b): a Horda armada (a horda são os bots do time 1; eles ficam fora do placar). */
  const hordeArmed = zombiesMode && recipe.zombies?.variant === 'armed';
  /** M6 (fase 2): o Gun Game (a escada) e o Infection; nos dois, a arma é do modo (sem o radial da morte). */
  const gunGame = (recipe.weapons?.ladder?.length ?? 0) > 0;
  const infection = recipe.infection !== undefined;
  const fixedLoadout = gunGame || infection;
  /** A figura do infectado (a do bobo-zumbi comum). */
  const infectedFigure = figures.zombieFigureOf(ZOMBIE_TYPE.walker);
  // Refino R1 (#79): quanto o perfil da partida abre a mira andando e no ar (a retícula da HUD segue).
  // M10 (fase 4, revisão): o mesmo perfil da sim (num mapa de gravidade baixa, sem o Arcade).
  const moveProfile = resolveMapMovementProfile(recipe.players, recipe.modifiers ?? [], loaded.simMap.gravity ?? 1);
  const moveSpreadMul = moveProfile.moveSpreadMul ?? 1;
  // M8 (fase 7): no Arcade, correndo a mira abre como no ar (atira correndo).
  const sprintSpread = moveProfile.fireWhileSprinting === true;
  // M3 (fase 6e): a música do Bobo Zombies em 2 camadas (a cena manda nela; o núcleo volta no resultado).
  const zombieMusic = zombiesMode ? createZombieMusic(host.audio.mixer, host.platform.assets, host.log) : null;
  const musicLocals: number[] = [];
  // Refino R2 (#79): o arco da granada (pontos no mundo; um a cada `ARC_EVERY_TICKS` ticks).
  const arcWorld = new Float32Array(MAX_GRENADE_ARC * 3);
  // M3 (fase 7a): o minimapa do quadrante livre (3 jogadores): a planta sai na 1ª vez que o quadrante aparece.
  let minimapPlan: MinimapPlan | null = null;
  const minimapLocals: number[] = [];
  const minimapColors: number[] = [];
  const zombieLineKey = new Int32Array(7).fill(-2);
  /** M3 (fase 4d): o anúncio do último drop pego (tipo e até quando, em s de relógio da cena). */
  let dropAnnounce = 0;
  let dropAnnounceUntil = 0;
  const trainingNow: TrainingNumbers = { accuracy: -1, headPct: -1, ttkS: -1, kills: 0 };
  let lastTraining = [Number.NaN, Number.NaN, Number.NaN, Number.NaN];
  /** M2 (fase 5e): os números do treino para o Testar (a precisão é a dos bots que não são Alvo). */
  function trainingReport(): TrainingReport | null {
    if (!training) return null;
    const v = sim.view();
    const h = humans > 0 ? entityIndex(sim.controllerEntity(me)) : -1;
    trainingNumbers(matchStats, v, h, sim.hz, trainingNow);
    let shots = 0;
    let hits = 0;
    for (const slot of expandRecipe(recipe, humans)) {
      if (slot.bot === null || resolveBot(recipe, slot.bot).personality.preset === 'dummy') continue;
      const e = entityIndex(sim.controllerEntity(slot.controller));
      if (e < 0 || e >= matchStats.capacity) continue;
      shots += matchStats.shots[e]!;
      hits += Math.min(matchStats.hits[e]!, matchStats.shots[e]!);
    }
    return {
      botAccuracy: shots > 0 ? Math.round((hits * 100) / shots) : -1,
      kills: h >= 0 ? v.kills[h]! : 0,
      deaths: h >= 0 ? v.deaths[h]! : 0,
      ttkS: trainingNow.ttkS,
    };
  }
  /** M2 (fase 5e): o Nêmesis do resultado (índice da entidade; -1 = nenhum) e o documento do bot dele. */
  let resultNemesis = -1;
  function nemesisBot(): BotDocument | null {
    if (resultNemesis < 0) return null;
    for (const slot of expandRecipe(recipe, humans)) {
      if (slot.bot !== null && entityIndex(sim.controllerEntity(slot.controller)) === resultNemesis) {
        return resolveBot(recipe, slot.bot);
      }
    }
    return null;
  }

  /** M3 (fase 2d): "Onda 3 · 12 zumbis", "Onda 4 em 7 s" ou "Onda 3 · o último!". */
  function refreshZombieLine(): void {
    const mv = sim.view().match;
    const rest = mv.zombieRestTicks >= 0 ? Math.ceil(mv.zombieRestTicks / sim.hz) : -1;
    const last = mv.lastZombie !== NULL_ENTITY ? 1 : 0;
    // M3 (fase 4d): os tempos dos drops e o anúncio do último pego (só refaz a linha quando um número muda).
    const double = Math.ceil(mv.doublePointsTicks / sim.hz);
    const insta = Math.ceil(mv.instaKillTicks / sim.hz);
    const announce = timeS < dropAnnounceUntil ? dropAnnounce : 0;
    // M6 (fase 6a): a vida do gerador do Fortress, em %.
    const fort = sim.view().fortress;
    const genPct = fort !== null ? Math.ceil((fort.hp[0]! / fort.maxHp) * 100) : -1;
    const k = zombieLineKey;
    if (
      k[0] === mv.zombieWave &&
      k[1] === (rest >= 0 ? rest : mv.zombiesLeft) &&
      k[2] === (rest >= 0 ? -1 : last) &&
      k[3] === double &&
      k[4] === insta &&
      k[5] === announce &&
      k[6] === genPct
    )
      return;
    k[0] = mv.zombieWave;
    k[1] = rest >= 0 ? rest : mv.zombiesLeft;
    k[2] = rest >= 0 ? -1 : last;
    k[3] = double;
    k[4] = insta;
    k[5] = announce;
    k[6] = genPct;
    const base =
      rest >= 0
        ? t('hud.zombies.rest', { wave: mv.zombieWave + 1, s: rest })
        : last === 1
          ? t('hud.zombies.last', { wave: mv.zombieWave })
          : hordeArmed
            ? t('hud.horde.wave' as StringKey, { wave: mv.zombieWave, left: mv.zombiesLeft })
            : t('hud.zombies.wave', { wave: mv.zombieWave, left: mv.zombiesLeft });
    const parts = [base];
    if (announce > 0) parts.unshift(t(DROP_TEXT[announce - 1]!));
    if (double > 0) parts.push(t('hud.zombies.double', { s: double }));
    if (insta > 0) parts.push(t('hud.zombies.insta', { s: insta }));
    if (genPct >= 0) parts.push(t('hud.zombies.generator' as StringKey, { pct: genPct }));
    sharedHud.trainingLine = parts.join(' · ');
  }

  /** M7 (fase 0): a chave da linha da rodada (refeita só quando a rodada, a fase ou os segundos mudam). */
  const roundLineKey = new Int32Array(4).fill(-2);
  /** M7 (fase 0): "Rodada 2 de 4 · 2:31", "Rodada 2 de 4 · começa em 3" ou o resultado da rodada. */
  function refreshRoundLine(): void {
    const rv = sim.view().rounds;
    if (rv === null) return;
    const d = rv.data;
    const round = d[ROUND.round]!;
    const phase = d[ROUND.phase]!;
    const secs = Math.ceil(d[ROUND.ticks]! / sim.hz);
    const k = roundLineKey;
    if (k[0] === round && k[1] === phase && k[2] === secs && k[3] === d[ROUND.winner]) return;
    k[0] = round;
    k[1] = phase;
    k[2] = secs;
    k[3] = d[ROUND.winner]!;
    if (round === 0) {
      sharedHud.trainingLine = '';
      return;
    }
    const total = rv.totalRounds;
    if (phase === ROUND_PHASE.buy) {
      sharedHud.trainingLine = t('hud.round.start' as StringKey, { round, total, s: secs });
    } else if (phase === ROUND_PHASE.live) {
      const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
      sharedHud.trainingLine = t('hud.round.live' as StringKey, { round, total, time: clock });
    } else {
      const juggWon = d[ROUND.winner] === 1;
      sharedHud.trainingLine = t((juggWon ? 'hud.round.juggHeld' : 'hud.round.juggDown') as StringKey);
    }
  }

  /** M7 (fase 4): no BoboStrike, o relógio da rodada (o da bomba plantada) e o estado embaixo do placar. */
  const strikeLineKey = new Int32Array(4).fill(-2);
  function refreshStrikeLine(): void {
    const v = sim.view();
    const rv = v.rounds!;
    const d = rv.data;
    const phase = d[ROUND.phase]!;
    sharedHud.trainingLine = '';
    sharedHud.timeLeftS = phase === ROUND_PHASE.over || d[ROUND.round] === 0 ? -1 : d[ROUND.ticks]! / sim.hz;
    const bomb = v.strike !== null ? v.strike.data[STRIKE_DATA.bomb]! : -1;
    const site = v.strike !== null ? v.strike.data[STRIKE_DATA.site]! : -1;
    const k = strikeLineKey;
    if (k[0] === d[ROUND.round] && k[1] === phase && k[2] === bomb && k[3] === d[ROUND.winner]) return;
    k[0] = d[ROUND.round]!;
    k[1] = phase;
    k[2] = bomb;
    k[3] = d[ROUND.winner]!;
    const round = d[ROUND.round]!;
    const atk = d[ROUND.swapped] === 1 ? 1 : 0;
    let line: string;
    if (round === 0) line = '';
    else if (phase === ROUND_PHASE.buy) line = t('hud.strike.buy' as StringKey, { round });
    else if (phase === ROUND_PHASE.over) {
      line = t((d[ROUND.winner] === atk ? 'hud.strike.atkWon' : 'hud.strike.defWon') as StringKey);
      if (rv.swapAfter > 0 && round === rv.swapAfter) line += ` · ${t('hud.strike.half' as StringKey)}`;
    } else if (bomb === BOMB.planted) {
      line = t('hud.strike.planted' as StringKey, { site: String.fromCharCode(65 + Math.max(0, site)) });
    } else line = t('hud.strike.live' as StringKey, { round });
    sharedHud.modsLine = line.toUpperCase();
    sharedHud.modsWarn = bomb === BOMB.planted && phase === ROUND_PHASE.live;
  }

  function refreshTrainingLine(): void {
    const h = humans > 0 ? entityIndex(sim.controllerEntity(me)) : -1;
    trainingNumbers(matchStats, sim.view(), h, sim.hz, trainingNow);
    const n = trainingNow;
    const prev = lastTraining;
    if (prev[0] === n.accuracy && prev[1] === n.headPct && prev[2] === n.ttkS && prev[3] === n.kills) return;
    lastTraining = [n.accuracy, n.headPct, n.ttkS, n.kills];
    const none = t('result.noAccuracy');
    sharedHud.trainingLine = t('training.line', {
      accuracy: n.accuracy >= 0 ? t('settings.percent', { n: n.accuracy }) : none,
      ttk: n.ttkS >= 0 ? t('lab.seconds', { n: Math.round(n.ttkS * 10) / 10 }) : none,
      head: n.headPct >= 0 ? t('settings.percent', { n: n.headPct }) : none,
      kills: n.kills,
    });
  }
  let layout: HudScreenLayout | null = null;
  /** Entradas do último `layoutHudScreen` (comparadas número a número: nada de chave em string por frame). */
  const layoutKey = new Float64Array(7).fill(-1);
  let layoutVertical = false;

  const far = Math.min(
    recipe.match?.viewDistanceM ?? MATCH_DEFAULTS.viewDistanceM,
    bench ? 140 : profile.maxViewDistanceM,
  );
  // M2 (fase 4f): o campo de visão dos Ajustes (0 = o padrão da plataforma) e o tremor reduzido.
  const fovFromSettings = (): number => host.settings.current.video.fovDeg || defaultFovFor(platform.features);
  let fovDeg = fovFromSettings();
  const shakeFromSettings = (): number => (host.settings.current.accessibility.reduceShake ? REDUCED_SHAKE : 1);
  let shakeMul = shakeFromSettings();
  // M2 (fase 6b): 1ª ou 3ª pessoa e o ombro, dos Ajustes; a regra "Câmera permitida" da partida pode forçar a 1ª.
  const thirdAllowed = (recipe.players?.camera ?? 'any') === 'any';
  const thirdFromSettings = (): boolean => thirdAllowed && host.settings.current.video.view === 'third';
  const sideFromSettings = (): number => (host.settings.current.video.shoulder === 'left' ? -1 : 1);
  let thirdPerson = thirdFromSettings();
  let shoulderSide = sideFromSettings();
  const thirdAim = new Float64Array(2);
  // M2 (fase 6e): o fantasma dos dedos nas 2 primeiras partidas no celular, até o jogador andar e mirar (ou 10 s).
  const GHOST = { matches: 2, maxS: 10, fadeS: 0.4, moveS: 0.6 } as const;
  let ghostT = 0;
  let ghostMoved = 0;
  let ghostLooked = false;
  let ghostDone = humans === 0 || host.stats.current.totals.matches >= GHOST.matches;
  let ghostAlpha = 0;
  const env = createEnvironment();
  // M3 (fase 7b): o bench do Zombies fica com a luz do mapa (a Base é à noite; M10, fase 5: a Fazenda também).
  env.timeOfDay = bench && bench.scene !== 'zombies' && bench.scene !== 'farm' ? bench.timeOfDay : doc.light.timeOfDay;
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
  // M2 (fase 8b): os detritos da qualidade (o bench mede com o teto do perfil, comparável ao M1).
  renderer.setDebrisBudget(
    bench
      ? profile.maxDebris
      : qualityKnobs(profile, effectiveQuality(host.settings.current.video, profile.family)).maxDebris,
  );
  /**
   * M2 (fase 8b): reavaliação da qualidade automática (tecnico.md §17.2 e §17.3). Nos primeiros `QUALITY_PROBE.windowS`
   * de partida depois da contagem, conta os quadros lentos (acima de 1,5× o alvo do perfil, ou do limite de 30 quadros);
   * com mais de 10% lentos, baixa um nível para as próximas partidas. Só com a Automática e fora do Switch (720p fixo).
   */
  const qualityProbe = {
    active:
      request.kind === 'play' &&
      platform.id !== 'switch' &&
      host.settings.current.video.quality === 'auto' &&
      effectiveQuality(host.settings.current.video, profile.family) !== 'low',
    t: 0,
    frames: 0,
    slow: 0,
    slowS: QUALITY_PROBE.slowFactor / Math.min(profile.targetFps, host.settings.current.video.fpsCap),
  };
  function probeQuality(dt: number): void {
    if (!qualityProbe.active || sim.view().match.phase !== 'playing') return;
    qualityProbe.t += dt;
    qualityProbe.frames++;
    if (dt > qualityProbe.slowS) qualityProbe.slow++;
    if (qualityProbe.t < QUALITY_PROBE.windowS) return;
    qualityProbe.active = false;
    const doc = host.settings.current;
    const from = effectiveQuality(doc.video, profile.family);
    const counts = `${qualityProbe.slow}/${qualityProbe.frames} quadros lentos`;
    if (doc.video.quality !== 'auto' || !shouldLowerQuality(qualityProbe.frames, qualityProbe.slow)) {
      host.log(`[partida] qualidade ${from} aguenta (${counts})`);
      return;
    }
    const to = lowerQuality(from);
    host.settings.save({ ...doc, video: { ...doc.video, autoQuality: to } });
    host.log(`[partida] qualidade automática: ${from} → ${to} (${counts})`);
  }

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
    // M2 (fase 6c): o look inteiro (o Meu Bobo sendo editado), com o id que veio junto.
    if (o?.lookData) return { id: o.look ?? WARDROBE.lookId, look: normalizeFigureLook(o.lookData), zombie: false };
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

  // --- M2 (fase 6c): o Meu Bobo (o editor; o bobo é o manequim do meio do Ringue) ---
  const wardrobeMq = request.kind === 'wardrobe' ? (mannequinByName.get(WARDROBE.mannequin) ?? -1) : -1;
  let wardrobe: Wardrobe | null = null;
  if (wardrobeMq >= 0) {
    overrideCamera = cameraByName.get(WARDROBE.camera) ?? null;
    wardrobe = createWardrobe({
      bobo: host.bobo,
      seed: request.seed,
      log: (line) => host.log(line),
      apply(look, team) {
        figures.restyle(WARDROBE.lookId, look);
        const turn = mqTurn[wardrobeMq]!;
        // Sem arma na mão: a roupa aparece inteira.
        applyMannequin(wardrobeMq, {
          name: WARDROBE.mannequin,
          look: WARDROBE.lookId,
          lookData: look,
          team,
          weapon: '',
        });
        mqTurn[wardrobeMq] = turn;
        if (figures.takeTemplatesChanged()) renderer.setFigures(figures.templates, figures.table);
      },
      turn(deg) {
        mqTurn[wardrobeMq] = (deg * Math.PI) / 180;
      },
    });
  }

  // --- eventos da sim → VFX, HUD e estado cosmético ---
  let timeS = 0;
  // M5 (fase 5d): os pings dos humanos (x, y, z, o time e quem mandou) e os balões de emote (quem, o texto e até quando).
  const humanPings = new Float64Array(MAX_HUMAN_PINGS * 3);
  const humanPingTeam = new Int8Array(MAX_HUMAN_PINGS);
  const humanPingBy = new Float64Array(MAX_HUMAN_PINGS);
  const humanPingUntil = new Float64Array(MAX_HUMAN_PINGS);
  let humanPingNext = 0;
  const emoteBy = new Float64Array(MAX_EMOTE_BUBBLES).fill(-1);
  const emoteKind = new Uint8Array(MAX_EMOTE_BUBBLES);
  const emoteUntil = new Float64Array(MAX_EMOTE_BUBBLES);
  // M8 (fase 6): as ordens (o nome muda no Zombies e no Royale em grupo, onde o "Me cobre" levanta quem mandou) e os
  // balões delas depois dos 4 emotes (os tipos 5 a 8 do aviso da sim).
  const reviveOrders = zombiesMode || (royaleMode && (recipe.royale?.squad ?? 'solo') !== 'solo');
  const orderName = (o: number): string => t((o === 4 && reviveOrders ? 'order.4.revive' : `order.${o}`) as StringKey);
  const ORDER_BALLOON_KIND = 5;
  const emoteTexts = [
    ...[1, 2, 3, 4].map((k) => t(`emote.${k}` as StringKey)),
    ...[1, 2, 3, 4].map((o) => t('order.balloon', { order: orderName(o) })),
  ];
  /** Um sinal da sim: o ping vai para a lista do time; o emote troca o balão de quem mandou (ou ocupa um vago). */
  function onSignal(v: SimView, by: number, kind: number, x: number, y: number, z: number): void {
    const i = entityIndex(by);
    if (i >= v.count) return;
    if (kind === 0) {
      const k = humanPingNext;
      humanPingNext = (humanPingNext + 1) % MAX_HUMAN_PINGS;
      humanPings[k * 3] = x;
      humanPings[k * 3 + 1] = y;
      humanPings[k * 3 + 2] = z;
      humanPingTeam[k] = v.team[i]!;
      humanPingBy[k] = by;
      humanPingUntil[k] = timeS + PING_SHOW_S;
      return;
    }
    let slot = -1;
    for (let b = 0; b < MAX_EMOTE_BUBBLES; b++) {
      if (emoteBy[b] === by) slot = b;
      else if (slot < 0 && emoteUntil[b]! <= timeS) slot = b;
    }
    if (slot < 0) return;
    emoteBy[slot] = by;
    emoteKind[slot] = kind;
    emoteUntil[slot] = timeS + EMOTE_SHOW_S;
  }
  /**
   * Gabarito e skin do boneco da entidade i: zumbi; o jogador 1 com o Meu Bobo (fase 6c); senão o look da rotação
   * pelo controlador no time dele (sem time no FFA). Tabelas prontas do loading: sem alocação.
   */
  function resolveEntityFigure(v: SimView, i: number): void {
    figureTeam[i] = v.team[i]!;
    // M6 (fase 2): o infectado tem a cara do bobo-zumbi.
    if (infection && v.kind[i] === ENTITY_KIND.bobo && v.team[i] === 1) {
      figureOf[i] = figures.zombieFigureOf(ZOMBIE_TYPE.walker);
      skinLayer[i] = figures.zombieSkinOf(ZOMBIE_TYPE.walker);
      return;
    }
    if (v.kind[i] === ENTITY_KIND.zombie) {
      // M3 (fase 5b): a skin do tipo (o zumbi do pool troca de tipo a cada vez que entra; o `spawn` resolve de novo).
      const type = v.zombieType[i]!;
      figureOf[i] = figures.zombieFigureOf(type);
      skinLayer[i] = figures.zombieSkinOf(type);
      return;
    }
    const team = ffa || royaleMode || v.team[i] === NO_TEAM ? -1 : v.team[i]!;
    // M2 (fase 6c): o jogador 1 veste o Meu Bobo.
    if (humans > 0 && !aquarium && v.controller[i] === me) {
      // M6 (fase 3): o Meu Bobo só existe no time 0; o P1 que vira o Jugg continua com ele.
      figureOf[i] = figures.playerFigure(juggernaut ? 0 : team);
      skinLayer[i] = figures.playerSkin(juggernaut ? 0 : team);
      return;
    }
    const c = Math.max(0, v.controller[i]!);
    const p = c < botLook.length ? botLook[c]! : c % figures.botLooks;
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
    shotAt = new Float32Array(capacity).fill(-1e9);
    hiddenNow = new Uint8Array(capacity);
    figureTeam = new Uint8Array(capacity);
    velPrev = new Float32Array(capacity * 3);
    velCur = new Float32Array(capacity * 3);
    shownScale = new Float32Array(capacity);
    shownMaskScale = new Float32Array(capacity);
  }
  /** M9 (fase 1b): a escala dos modificadores desenhada da entidade `i` (a da sim, se ela ainda não foi desenhada). */
  function drawnScale(v: SimView, i: number): number {
    if (i >= v.count) return 1;
    const k = i < shownScale.length ? shownScale[i]! : 0;
    return k > 0 ? k : chaosScaleOf(v, i);
  }
  /** Vista em 1ª pessoa que segue a entidade (a câmera nomeada da vista 0 não conta); -1 = nenhuma. */
  function viewOfEntity(entity: number): number {
    if (entity === NULL_ENTITY) return -1;
    for (let s = 0; s < slots.length; s++) {
      const c = slots[s]!.controller;
      if (s === 0 && (overrideCamera !== null || overrideRoute !== null)) continue;
      if (slots[s]!.third) continue;
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
    const human = humans > 0 ? s.controllerEntity(me) : NULL_ENTITY;
    if (matchStats.capacity < v.capacity) matchStats = createMatchStats(v.capacity);
    for (let k = 0; k < events.length; k++) {
      const ev = events[k]!;
      matchSound.event(ev, v, timeS);
      recordMatchEvent(matchStats, ev, human);
      if (ev.type === 'matchPhase' && ev.phase === 'ended' && endedAt < 0) endedAt = timeS;
      // M10 (revisão): os virotes cravados saem quando a partida muda de fase e quando uma porta do Zombies abre (o
      // virote podia estar nela). A rodada nova do BoboStrike e do Jugg Fixo limpa em `fillStuckBolts`.
      if (ev.type === 'matchPhase' || (ev.type === 'door' && ev.action === 'open')) clearStuckBolts();
      switch (ev.type) {
        case 'shot': {
          const i = entityIndex(ev.shooter);
          if (i < recoil.length) {
            recoil[i] = 1;
            firing[i] = FIRING_S;
            shotAt[i] = timeS;
          }
          // Boca do cano aproximada (o render usa a do viewmodel para o dono em 1ª pessoa). M9 (fase 1): no Mini e no
          // gigante, a arma fica na escala do corpo (fase 1b: a desenhada, e o clarão também).
          const size = drawnScale(v, i);
          const yaw = Math.atan2(-ev.dirX, -ev.dirZ);
          const rx = Math.cos(yaw) * size;
          const rz = -Math.sin(yaw) * size;
          const mx = ev.originX + ev.dirX * 0.7 * size + rx * 0.16;
          const my = ev.originY + ev.dirY * 0.7 * size - 0.14 * size;
          const mz = ev.originZ + ev.dirZ * 0.7 * size + rz * 0.16;
          const owner = viewOfEntity(ev.shooter);
          const weapon = modelOf(ev.weapon);
          pushMuzzleFlash(fx, ev.shooter, mx, my, mz, ev.dirX, ev.dirY, ev.dirZ, owner, weapon, size);
          if (ev.distance > 1.5 * size) {
            const d = ev.distance;
            pushTracer(fx, mx, my, mz, ev.originX + ev.dirX * d, ev.originY + ev.dirY * d, ev.originZ + ev.dirZ * d);
          }
          flashViews(mx, my, mz, owner);
          break;
        }
        case 'ricochet': {
          // M9 (fase 1): o Ricochete: o rastro sai do ponto do quique (fase 1b: no estilo dele, que dá para ver).
          if (ev.distance > 0.5) {
            const d = ev.distance;
            const x1 = ev.x + ev.dirX * d;
            const y1 = ev.y + ev.dirY * d;
            const z1 = ev.z + ev.dirZ * d;
            pushTracer(fx, ev.x, ev.y, ev.z, x1, y1, z1, TRACER_STYLE.ricochet);
          }
          break;
        }
        case 'impact': {
          if (chaosOn(MOD.confetti)) confetti(ev.x, ev.y, ev.z);
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
          // M6 (fase 4b): a Festa solta confete em cada acerto.
          if (chaosOn(MOD.confetti)) confetti(ev.x, ev.y, ev.z);
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
              rumble(sIdx, Math.min(1, ev.damage / 60), 0.35, 120);
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
          for (let sIdx = 0; sIdx < slots.length; sIdx++) {
            const c = slots[sIdx]!.controller;
            if (c >= 0 && s.controllerEntity(c) === ev.victim) rumble(sIdx, 0.9, 0.6, 320, true);
          }
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
          // M6 (fase 4b): o invisível que morre não tem pose recente para desmontar: só o "poof", no lugar certo.
          d.figure = hiddenNow[i] === 1 ? NO_FIGURE : figureOf[i]!;
          // M9 (fase 1): o tamanho de quem caiu (o Mini e o gigante desmontam do tamanho que tinham).
          d.scale = v.bodyScale[i]! * drawnScale(v, i);
          d.kind = zombie ? ACTOR_KIND.zombie : ACTOR_KIND.bobo;
          pushDeath(fx, d);
          onDeath(s, ev.victim, ev.killer, ev.weapon);
          feedKill(v, ev.victim, ev.killer, ev.weapon, ev.headshot);
          break;
        }
        case 'signal':
          onSignal(v, ev.entity, ev.kind, ev.x, ev.y, ev.z);
          break;
        case 'point':
          feedPoint(ev.index, ev.team, ev.action === 'captured');
          break;
        case 'spawn': {
          const i = entityIndex(ev.entity);
          ensureCapacity(v.capacity);
          spawnT[i] = timeS;
          resolveEntityFigure(v, i);
          // Velocidade do boneco novo começa do zero (sem herdar a do dono anterior do índice).
          velPrev.fill(0, i * 3, i * 3 + 3);
          velCur.fill(0, i * 3, i * 3 + 3);
          reloadStart[i] = -1;
          for (let k = 0; k < seatCtrl.length; k++) {
            const h = seatCtrl[k]!;
            const m = mapperOf(h);
            if (m === null || ev.entity !== s.controllerEntity(h)) continue;
            m.setAngles(v.yaw[i]!, 0);
            m.setWeapon(v.slot[i]!);
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
          // A sim pôs uma arma na mão (acabou a granada, a arma do mapa, o loot, a compra): o mapeador do humano passa a
          // pedir o slot dela. M11 (fase 4, revisão): o evento traz o código da arma, não o slot (`switchedSlot`); um
          // 2º laço mandava o código direto ao mapeador e a mão ia para a faca ou a granada.
          if (ev.action === 'switch') {
            const slot = switchedSlot(ev.weapon, v.slot[i]!);
            for (let k = 0; k < seatCtrl.length; k++) {
              const h = seatCtrl[k]!;
              const m = mapperOf(h);
              if (m !== null && ev.entity === s.controllerEntity(h) && m.weapon !== slot) m.setWeapon(slot);
            }
          }
          if (ev.action === 'reloadStart') {
            reloadStart[i] = timeS;
            const def = weaponDef(ev.weapon);
            reloadDur[i] = def ? (def.reloadPerRoundS > 0 ? def.reloadPerRoundS : def.reloadS) : 2;
          } else if (ev.action === 'reloadEnd') {
            reloadStart[i] = -1;
          }
          break;
        }
        case 'melee': {
          const i = entityIndex(ev.attacker);
          if (i < firing.length) {
            firing[i] = FIRING_S * 3;
            shotAt[i] = timeS;
          }
          break;
        }
        case 'explosion': {
          // M6 (fase 5): a tinta: a mancha na superfície (sem fogo, sem tremer a tela) e um respingo da cor do time.
          if (isPaintWeapon(ev.weapon)) {
            paintSplat(v, ev.x, ev.y, ev.z, entityIndex(ev.owner), ev.radius);
            break;
          }
          // M3 (fase 5c): a gosma do Chonker é uma chuva de cubinhos verdes (sem fogo); o raio do Desmontador solta
          // faíscas verdes além da explosão.
          if (ev.weapon === WEAPON_GOO || ev.weapon === WEAPON_DESMONTADOR) {
            for (let k = 0; k < GOO_BURSTS.length; k += 4) {
              pushDebris(
                fx,
                ev.x,
                ev.y,
                ev.z,
                GOO_BURSTS[k]!,
                GOO_BURSTS[k + 1]!,
                GOO_BURSTS[k + 2]!,
                ev.weapon === WEAPON_GOO ? GOO_COLORS[k >> 2]! : SPARK_COLORS[k >> 2]!,
                10,
                GOO_BURSTS[k + 3]!,
              );
            }
          }
          if (ev.weapon !== WEAPON_GOO) pushExplosion(fx, ev.x, ev.y, ev.z, ev.radius);
          flashViews(ev.x, ev.y, ev.z, -1);
          for (let sIdx = 0; sIdx < slots.length; sIdx++) {
            const slot = slots[sIdx]!;
            const c = slot.desc.camera;
            const d = Math.hypot(c.x - ev.x, c.y - ev.y, c.z - ev.z);
            if (d < SHAKE_RANGE_M) {
              slot.shake = Math.min(1, slot.shake + (1 - d / SHAKE_RANGE_M) * shakeMul);
              rumble(sIdx, (1 - d / SHAKE_RANGE_M) * 0.8, 0.5, 220);
            }
          }
          break;
        }
        case 'projectile': {
          // M6 (fase 4b): o foguete e a granada também mostram o invisível (como o último tiro da sim).
          if (ev.action === 'launch') {
            const j = entityIndex(ev.owner);
            if (j < shotAt.length) shotAt[j] = timeS;
          }
          // M6 (fase 5): o marcador de tinta recua e põe o boneco atirando, sem o clarão do foguete.
          if (ev.action === 'launch' && isPaintWeapon(ev.weapon) && ev.weapon !== WEAPON_PAINT_BUCKET) {
            const j = entityIndex(ev.owner);
            if (j < recoil.length) {
              recoil[j] = 1;
              firing[j] = FIRING_S;
            }
            break;
          }
          // M10 (fase 7): o virote cravado fica no bloco alguns segundos (só do render; `fillStuckBolts`).
          if (ev.action === 'stick') {
            stickBolt(ev.x, ev.y, ev.z, ev.vx, ev.vy, ev.vz);
            break;
          }
          // M10 (fase 7): a besta recua e põe o boneco atirando, sem clarão; o lança-granadas, como o foguete.
          if (ev.action === 'launch' && ev.weapon === WEAPON_CODE.crossbow) {
            const j = entityIndex(ev.owner);
            if (j < recoil.length) {
              recoil[j] = 1;
              firing[j] = FIRING_S;
            }
            break;
          }
          if (ev.action !== 'launch' || (ev.weapon !== WEAPON_CODE.rocket && ev.weapon !== WEAPON_CODE.grenadeLauncher))
            break;
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
            // M9 (fase 1b): a boca do lança-foguetes e o clarão na escala do corpo de quem atirou.
            const size = drawnScale(v, i);
            const mx = ev.x + dx * 0.8 * size;
            const my = ev.y + (dy * 0.8 - 0.1) * size;
            const mz = ev.z + dz * 0.8 * size;
            const owner = viewOfEntity(ev.owner);
            pushMuzzleFlash(fx, ev.owner, mx, my, mz, dx, dy, dz, owner, modelOf(ev.weapon), size);
            flashViews(mx, my, mz, owner);
          }
          break;
        }
        case 'pickup':
          // M3 (fase 4d): pegou um drop do Bobo Zombies: o anúncio na linha das ondas por 2,5 s.
          if (ev.action === 'take' && ev.kind >= PICKUP_KIND.maxAmmo && ev.kind <= PICKUP_KIND.carpenter) {
            dropAnnounce = ev.kind;
            dropAnnounceUntil = timeS + 2.5;
          }
          break;
        case 'unstuck':
          // Raro (anti-frustração): pode montar a string aqui.
          log.warn(
            `destravar: bobo ${entityIndex(ev.entity)} preso em (${ev.fromX.toFixed(1)}, ${ev.fromY.toFixed(1)}, ` +
              `${ev.fromZ.toFixed(1)})${ev.respawned ? ' → spawn' : ''}`,
          );
          break;
        case 'owner':
          // M9 (fase 5): a resposta a um comando do dono (só no host): o aviso na tela.
          ownerTools?.onEvent(ev, v);
          break;
        default:
          break;
      }
    }
    // M6 (fase 3): o Jugg trocou de mãos (ou foi sorteado): o kill feed avisa.
    if (juggernaut) {
      const j = juggIndex(v);
      if (j !== lastJugg) {
        lastJugg = j;
        if (j >= 0) feedJugg(v, j);
      }
    }
  };

  const driver = createSceneDriver(
    {
      recipe,
      map: loaded.simMap,
      humans,
      // M3 (fase 1c): os jogadores 2–4 do sofá ganham um cérebro de reserva (um bot assume quem sai).
      ...(seatCtrl.length > 1 ? { standby: seatCtrl.slice(1) } : {}),
      writeHumanFrame: (slot, out, seq) => {
        const seat = seatOf(slot);
        if (seat !== 0) {
          // Sofá: os jogadores 2..4 só pelo dispositivo de cada um (sem 3ª pessoa, toque nem Destravar).
          if (seat > 0) {
            extras[seat - 1]!.writeFrame(out, seq);
            writeOrder(seat, out);
          }
          return;
        }
        player.writeFrame(out, seq);
        // M9 (fase 5, revisão): no online a sim anda com a pausa aberta: o que se aperta no menu (o clique num item, o
        // confirmar do controle) não chega ao bobo.
        if (paused && pausedBy === 0 && driver.online) {
          out.buttons &= FRAME_HUMAN;
          out.moveX = 0;
          out.moveY = 0;
        }
        if (aqUseLock) {
          if (player.isDown('use')) out.buttons &= ~BUTTON.use;
          else aqUseLock = false;
        }
        // M2 (fase 6b): em 3ª pessoa, o tiro mira o ponto que a câmera mira (do olho).
        if (thirdPersonAim()) {
          out.yaw = yawToU16(thirdAim[0]!);
          out.pitch = pitchToI16(thirdAim[1]!);
        }
        // M2 (fase 6e): no toque, "atirar sozinho" aperta o gatilho com a retícula num inimigo.
        if (device === 'touch' && host.settings.current.controls.touch.autoFire && enemyUnderCrosshair()) {
          out.buttons |= BUTTON.fire;
        }
        // M9 (fase 5): com uma ferramenta do dono armada, o tiro e a mira são dela (o bobo não atira nem mira). Revisão:
        // a mira que cancelou fica fora até soltar (senão o aperto do cancelar vira um ADS).
        if (ownerTools !== null) {
          if (ownerTools.armed !== OWNER_NO_TOOL) out.buttons &= ~(BUTTON.fire | BUTTON.ads);
          else if (ownerAdsLock) out.buttons &= ~BUTTON.ads;
        }
        // M2 (fase 2e): "Destravar" da pausa vira o botão por um tick (a sim age na borda).
        if (unstuckPending) {
          out.buttons |= BUTTON.unstuck;
          unstuckPending = false;
        }
        writeOrder(0, out);
      },
      onEvents,
      ...(bench ? { hz: bench.simHz, zombies: bench.zombies } : {}),
      // M3 (fase 2d): no Bobo Zombies o pool é o teto de zumbis do aparelho (gameplay.md §6.11); no bench do Zombies
      // (fase 7b), o `zombies=` da URL ou o mesmo teto. M5 (fase 6b): no online, o pool que o host escolheu (o menor
      // teto da sala), igual nos dois lados.
      // M6 (fase 6b): na Horda armada a horda são os bots do time 1 (sem pool de zumbis).
      ...(zombiesMode && (!bench || bench.zombies <= 0)
        ? {
            zombies: hordeArmed ? 0 : Math.min(MAX_ZOMBIES, request.online?.zombiePool ?? setup.profile.maxZombies),
          }
        : {}),
      budget: aiBudgetFor(profile),
      now,
      // A MESMA tabela que o render recebeu no `setFigures` (a hitbox e a pose de 3ª pessoa saem dela).
      figureTable: figures.table,
      // Bench: a primária fixa do `weapons=` (fuzil por padrão, comparável ao M1); fora dele, o sorteio dos bots.
      ...(bench ? { primaries: benchPrimaries(bench.weapons) } : {}),
      // M2 (fase 2d): a contagem de 3 s só nas partidas de verdade (o bench, a vitrine e os prints começam jogando).
      ...(request.kind === 'play' ? { countdownS: MATCH_DEFAULTS.countdownS } : {}),
      // M9 (fase 5): as Ferramentas do Dono (o Sandbox): a reserva vai à sim, à IA e ao log do replay.
      ...(ownerReserve !== null ? { owner: { reserve: ownerReserve } } : {}),
    },
    request.online ?? null,
  );
  const sim = driver.sim;
  /**
   * M11 (fase 4): as armas no mapa (a regra ligada e o mapa com pontos; a mesma conta no amigo online): sem o radial
   * da morte (todo mundo nasce sem a primária) e com a dica da troca.
   */
  const mapWeapons = sim.view().mapWeapons !== null;
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
    slots[0]!.controller = me;
    const v = sim.view();
    const e = entityIndex(sim.controllerEntity(me));
    player.setAngles(v.yaw[e]!, 0);
    player.setWeapon(v.weapon[e]!);
    for (let k = 1; k <= extras.length; k++) {
      const c = seatCtrl[k]!;
      slots[k]!.controller = c;
      const eh = entityIndex(sim.controllerEntity(c));
      extras[k - 1]!.setAngles(v.yaw[eh]!, 0);
      extras[k - 1]!.setWeapon(v.weapon[eh]!);
    }
  } else {
    const byTeam: number[][] = [[], [], [], []];
    for (const slot of expandRecipe(recipe, 0)) if (slot.bot !== null) byTeam[slot.team]?.push(slot.controller);
    for (let i = 0; i < slots.length; i++) {
      const team = byTeam[i % 2]!.length > Math.floor(i / 2) ? i % 2 : (i + 1) % 2;
      slots[i]!.controller = byTeam[team]![Math.floor(i / 2)] ?? byTeam[0]![i] ?? -1;
    }
  }

  // --- M7 (fase 9): o Aquário ---
  let aqCam: AquariumCamera = AQUARIUM_CAMERA.follow;
  let aqSpeed = 1;
  const aqMaxSpeed = aquariumMaxSpeed(profile.family);
  /** A lista de jogadores grande (o botão do placar liga e desliga). */
  let aqList = false;
  /** Há quanto tempo (s, do relógio do render) o bobo seguido está morto, e quem o matou (`NULL_ENTITY` = ninguém). */
  let aqDeadS = 0;
  let aqKiller: number = NULL_ENTITY;
  /** O bot assumido (controlador; -1 = assistindo). */
  let pilot = -1;
  /** M7 (fase 9, revisão): o usar que assumiu o bot ainda apertado (o bot não usa nada até ele ser solto). */
  let aqUseLock = false;
  const fly: FlyCamera = { x: 0, y: 0, z: 0 };
  const flyBounds: FlyBounds = (() => {
    const v = sim.view();
    const pa = v.playArea;
    const m = AQUARIUM.flyMarginM;
    return {
      minX: (pa?.minX ?? 0) - m,
      maxX: (pa?.maxX ?? v.world.sizeX / CELLS_PER_METER) + m,
      minY: 0.5,
      maxY: v.world.sizeY / CELLS_PER_METER + m,
      minZ: (pa?.minZ ?? 0) - m,
      maxZ: (pa?.maxZ ?? v.world.sizeZ / CELLS_PER_METER) + m,
    };
  })();
  /** Os textos da faixa (refeitos só quando a câmera, o bobo seguido, a velocidade ou o dispositivo mudam). */
  let aqStatus = '';
  let aqShownCam = -1;
  let aqShownCtrl = -2;
  let aqShownSpeed = -1;
  let aqHint = '';
  let aqHintDevice: DeviceKind | null = null;
  const AQ_HINTS = [
    ['camera', 'aquarium.hint.camera'],
    ['nextWeapon', 'aquarium.hint.next'],
    ['use', 'aquarium.hint.take'],
    ['scoreboard', 'aquarium.hint.list'],
    ['pause', 'aquarium.hint.pause'],
  ] as const;

  // --- M9 (fase 5): as Ferramentas do Dono (o Sandbox; só quem manda: offline, o P1 do sofá ou o host online) ---
  const ownerTools: OwnerTools | null =
    ownerReserve !== null && request.online?.role !== 'client'
      ? createOwnerTools({
          recipe,
          command: (cmd) => driver.command(cmd),
          view: () => sim.view(),
          nameOf: (v, i) => nameOf(v, i),
          primaries: PRIMARY_ORDER,
          weaponNames,
          // A câmera lenta só offline; no Aquário assistindo, a velocidade dele já faz isso (de 0,25× a 4×).
          slowAllowed: !driver.online && !aquarium,
          log: (line) => host.log(line),
          logFull: () => driver.ownerLogFull,
        })
      : null;
  /** M9 (fase 5b): o texto da plaquinha dos congelados (feito uma vez). */
  const frozenTag = t('owner.frozenTag').toUpperCase();
  /**
   * M9 (fase 5b, prints): a plaquinha "CONGELADO" em cima dos bots congelados da vista `s` (o congelado vai no
   * snapshot: o amigo online e o sofá também veem), na lista `out`. Revisão: na lista da HUD da vista (`fillHud`, antes
   * das plaquinhas dela, como os balões); só a câmera livre e a de cima do Aquário, que vão sem HUD, desenham na lista
   * da tela. A vista nos olhos de um bobo não marca ele mesmo; a posição é a desenhada (`alpha`, como o ator).
   */
  function drawFrozen(
    out: DrawList,
    fonts: UiFonts | null,
    s: number,
    rect: ProjectRect,
    minText: number,
    alpha: number,
  ) {
    const v = sim.view();
    if (v.owner === null || paused) return;
    const slot = slots[s]!;
    const watching = s === 0 && aquarium && pilot < 0 && aqCam !== AQUARIUM_CAMERA.eyes;
    const self = slot.controller >= 0 && !watching ? entityIndex(sim.controllerEntity(slot.controller)) : -1;
    const font = fonts?.hud ?? null;
    drawFrozenMarks(out, font, v, slot.desc.camera, rect, minText, frozenTag, self, drawnScale, hiddenNow, alpha);
  }
  /** O tiro que armou a ferramenta (o clique em "Criar bot") não vale: só o próximo, depois de soltar. */
  let ownerFireLock = false;
  /** M9 (fase 5, revisão): a mira (ADS) que cancelou fica fora do bobo até soltar. */
  let ownerAdsLock = false;
  /** A ferramenta (ou a trava do ADS do cancelar) segura o tiro e a mira do P1: sem ADS, sem zoom e sem assistência. */
  function ownerHolds(): boolean {
    return ownerTools !== null && (ownerTools.armed !== OWNER_NO_TOOL || ownerAdsLock);
  }
  /** Armou pela página: o tiro que armou não vale e o ADS alternado (os Ajustes) solta. */
  function ownerArmed(): void {
    ownerFireLock = true;
    player.release('ads');
  }
  /** A dica dos botões da ferramenta armada (refeita quando o dispositivo ou os botões mudam). */
  let ownerHint = '';
  let ownerHintDevice: DeviceKind | null = null;
  function ownerHintText(): string {
    if (device !== ownerHintDevice) {
      ownerHintDevice = device;
      const fire = profiles[device].game.fire?.[0];
      const ads = profiles[device].game.ads?.[0];
      ownerHint =
        fire !== undefined && ads !== undefined
          ? t('owner.hint', { apply: bindingLabel(fire), cancel: bindingLabel(ads) })
          : '';
    }
    return ownerHint;
  }
  /**
   * Com uma ferramenta armada (jogando ou assistindo): a mira (ADS) cancela e o tiro aplica no que a câmera do P1 mira.
   * Revisão: o cancelar solta o ADS alternado e trava o ADS até soltar; morto (a câmera é a da morte ou a de um aliado)
   * não aplica; no Aquário seguindo um bobo (ou nos olhos dele), ele não conta; e na web, o clique sem o ponteiro preso
   * só devolve o mouse ao jogo.
   */
  function ownerInput(): void {
    const tools = ownerTools;
    if (tools === null) return;
    if (ownerAdsLock && !player.isDown('ads')) ownerAdsLock = false;
    if (tools.armed === OWNER_NO_TOOL) return;
    if (player.wasPressed('ads')) {
      tools.cancel();
      player.release('ads');
      ownerAdsLock = true;
      return;
    }
    if (ownerFireLock) {
      if (!player.isDown('fire')) ownerFireLock = false;
      return;
    }
    if (!player.wasPressed('fire')) return;
    if (device === 'keyboardMouse' && platform.id === 'web' && !lastPointerLocked) return;
    const v = sim.view();
    let self = -1;
    if (humans > 0) {
      self = entityIndex(sim.controllerEntity(me));
      if ((v.flags[self]! & ENTITY_FLAG.dead) !== 0) {
        tools.fail('dead');
        return;
      }
    } else if (aquarium && (aqCam === AQUARIUM_CAMERA.follow || aqCam === AQUARIUM_CAMERA.eyes)) self = aqFollowed();
    const c = slots[0]!.desc.camera;
    tools.apply(v, c.x, c.y, c.z, c.yaw, c.pitch, self, (ctrl) => seatOf(ctrl) >= 0);
  }

  /** O bobo que a vista do Aquário segue (índice; -1 = nenhum). */
  function aqFollowed(): number {
    const c = slots[0]!.controller;
    if (c < 0) return -1;
    const id = sim.controllerEntity(c);
    return id === NULL_ENTITY ? -1 : entityIndex(id);
  }
  /** Passa a seguir o bobo `i` (índice): a câmera de morte e o braço da câmera de ombro recomeçam. */
  function aqFollow(i: number): void {
    const v = sim.view();
    if (i < 0 || i >= v.count) return;
    const slot = slots[0]!;
    aqDeadS = 0;
    aqKiller = NULL_ENTITY;
    if (slot.controller === v.controller[i]) return;
    slot.controller = v.controller[i]!;
    endDeath(slot.death);
    slot.shoulder.arm = -1;
    slot.eye = -1;
  }
  /** A entrada do Aquário assistindo (fora da pausa): câmeras, o bobo seguido, a lista, assumir e pausar. */
  function aquariumInput(raw: Readonly<RawInputState>, dt: number): void {
    player.update(raw, dt);
    const slot = slots[0]!;
    const v = sim.view();
    if (player.wasPressed('camera')) {
      const c = slot.desc.camera;
      aqCam = nextAquariumCamera(aqCam);
      // A câmera livre sai de onde a câmera estava; a de cima gira com a mira (começa no rumo atual).
      if (aqCam === AQUARIUM_CAMERA.free) {
        fly.x = c.x;
        fly.y = c.y;
        fly.z = c.z;
        player.setAngles(c.yaw, c.pitch);
      } else if (aqCam === AQUARIUM_CAMERA.top) player.setAngles(c.yaw, 0);
      slot.shoulder.arm = -1;
    }
    const dir = player.wasPressed('nextWeapon') ? 1 : player.wasPressed('prevWeapon') ? -1 : 0;
    if (dir !== 0) {
      aqFollow(nextLivingBobo(v, aqFollowed(), dir));
      if (aqCam === AQUARIUM_CAMERA.free) aqCam = AQUARIUM_CAMERA.follow;
    }
    if (player.wasPressed('scoreboard')) aqList = !aqList;
    // M9 (fase 5): a ferramenta do dono também vale assistindo (o raio sai da câmera).
    ownerInput();
    if (player.wasPressed('use')) takeBot();
    else if (player.wasPressed('pause')) pause();
    if (aqCam === AQUARIUM_CAMERA.free) {
      const up = (player.isDown('jump') ? 1 : 0) - (player.isDown('crouch') ? 1 : 0);
      const fast = player.isDown('sprint');
      stepFlyCamera(fly, player.yaw, player.pitch, player.moveX, player.moveY, up, fast, dt, flyBounds);
    }
    // O bobo seguido morto: passada a câmera de morte, quem matou (vivo) ou o próximo vivo; sem ninguém, o 1º vivo.
    const i = aqFollowed();
    if (i >= 0 && livingBobo(v, i)) aqDeadS = 0;
    else {
      aqDeadS += dt * aqSpeed;
      if (i < 0 || aqDeadS >= AQUARIUM.switchAfterDeadS) {
        const k = aqKiller !== NULL_ENTITY && isCurrentEntity(v, aqKiller) ? entityIndex(aqKiller) : -1;
        const next = k >= 0 && livingBobo(v, k) ? k : nextLivingBobo(v, i, 1);
        if (next >= 0 && next !== i) aqFollow(next);
      }
    }
  }
  /**
   * M7 (fase 9, revisão): zera o mapeador do P1 (os toggles, o que está apertado e os apertos guardados enquanto se
   * assistia, sem `writeFrame`), a escolha do radial e a compra da vista; o usar fica de fora até ser solto.
   */
  function aqResetInput(): void {
    player.setDevice(bindingFor(device, padIndex));
    player.writeFrame(drain, 0);
    player.setPrimary(0);
    seatPrimary[0] = 0;
    const slot = slots[0]!;
    slot.buyOpen = false;
    slot.buyPick = -1;
    slot.tapId = -1;
    aqUseLock = true;
  }
  /**
   * Assume o bobo seguido (vivo): ele vira o jogador local (o P1, no lugar do bot) com a posição, a vida e a arma dele;
   * a IA para de pensar por ele (`setHumanControlled`, o mesmo do "entrar no meio" do sofá).
   */
  function takeBot(): void {
    if (!aquarium || pilot >= 0 || resultShown) return;
    const v = sim.view();
    const i = aqFollowed();
    if (i < 0 || !livingBobo(v, i)) return;
    const c = slots[0]!.controller;
    // M9 (fase 5, revisão): o bot congelado pelo dono volta a se mexer (a sim ignoraria a entrada de quem assume, e o
    // dono não mira em quem pilota). Vale no próximo passo, como todo comando.
    if (v.owner?.frozen[i] === 1) driver.command({ kind: 'freeze', entity: sim.controllerEntity(c), on: false });
    pilot = c;
    me = c;
    humans = 1;
    seatCtrl.length = 0;
    seatCtrl.push(c);
    seatNum.length = 0;
    seatNum.push(0);
    seatPadId.length = 0;
    seatPadId.push('');
    aqResetInput();
    player.setAngles(v.yaw[i]!, v.pitch[i]!);
    player.setWeapon(v.slot[i]!);
    const slot = slots[0]!;
    endDeath(slot.death);
    slot.shoulder.arm = -1;
    driver.setHumanControlled(c, true);
    everHuman.add(c);
    aqList = false;
    aqDeadS = 0;
    host.log(`[partida] aquário: assumiu ${nameOf(v, i)}`);
  }
  /** Devolve o bot para a IA e volta a assistir, seguindo ele. */
  function releaseBot(): void {
    if (pilot < 0) return;
    driver.setHumanControlled(pilot, false);
    host.log('[partida] aquário: voltou a assistir');
    pilot = -1;
    humans = 0;
    me = 0;
    seatCtrl.length = 0;
    seatNum.length = 0;
    seatPadId.length = 0;
    aqResetInput();
    aqCam = AQUARIUM_CAMERA.follow;
    slots[0]!.shoulder.arm = -1;
  }
  /**
   * Com um bot assumido no Royale (ninguém volta), morto e sem colega vivo para assistir: passada a câmera de morte,
   * volta a assistir (seguindo quem matou). No BoboStrike o mesmo bot volta na próxima rodada.
   */
  function checkPilotOut(dt: number): void {
    if (pilot < 0 || !royaleMode) return;
    const v = sim.view();
    const i = aqFollowed();
    if (i < 0 || livingBobo(v, i) || livingMate(v, i) >= 0) {
      aqDeadS = 0;
      return;
    }
    aqDeadS += dt;
    if (aqDeadS >= AQUARIUM.switchAfterDeadS) releaseBot();
  }
  /** A faixa do Aquário: o estado ("AQUÁRIO · 2× · SEGUINDO JORGE") e os botões do dispositivo. */
  function refreshAquariumTexts(): void {
    const ctrl = slots[0]!.controller;
    if (aqCam !== aqShownCam || ctrl !== aqShownCtrl || aqSpeed !== aqShownSpeed) {
      aqShownCam = aqCam;
      aqShownCtrl = ctrl;
      aqShownSpeed = aqSpeed;
      const i = aqFollowed();
      const name = i >= 0 ? nameOf(sim.view(), i) : '';
      const cam =
        aqCam === AQUARIUM_CAMERA.free
          ? t('aquarium.cam.free')
          : aqCam === AQUARIUM_CAMERA.eyes
            ? t('aquarium.cam.eyes', { name })
            : aqCam === AQUARIUM_CAMERA.top
              ? t('aquarium.cam.top', { name })
              : t('aquarium.cam.follow', { name });
      aqStatus = `${t('aquarium.title')} · ${aquariumSpeedText(aqSpeed)} · ${cam}`.toUpperCase();
    }
    if (device !== aqHintDevice) {
      aqHintDevice = device;
      const parts: string[] = [];
      for (const [action, key] of AQ_HINTS) {
        const src = profiles[device].game[action]?.[0];
        if (src !== undefined) parts.push(t('aquarium.hint.item', { key: bindingLabel(src), action: t(key) }));
      }
      aqHint = parts.join(' · ');
    }
  }
  /** O título do resultado assistindo: quem venceu (o bobo, o esquadrão ou o time), sem "vitória" nem "derrota". */
  function aquariumResultTitle(v: SimView, winner: number): string {
    const rv = v.royale;
    if (rv !== null) {
      for (let i = 0; i < v.count; i++) {
        if (v.alive[i] === 1 && v.kind[i] === ENTITY_KIND.bobo && rv.place[v.team[i]!] === 1) {
          return t('result.ffaWinner', { name: nameOf(v, i) });
        }
      }
    } else if (solo) {
      if (winner >= 0) return t('result.ffaWinner', { name: nameOf(v, winner) });
    } else if (v.match.winnerTeam >= 0 && v.match.winnerTeam < recipe.teams.length) {
      // M9 (fase 3): os 4 times do Sandbox, com o nome que a receita deu.
      return t('result.aquarium.team', { team: teamName(recipe, v.match.winnerTeam) });
    }
    return t('result.draw');
  }

  // --- mapeador, pausa, painel F2 ---
  const pauseMenu = createMenuController();
  pauseMenu.setRoot(pauseScreen.build(pauseState));
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
        // M3 (fase 7b): zumbis vivos por frame medido (Bobo Zombies).
        zSum: 0,
        zMax: 0,
        zFrames: 0,
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
    setZone(cx: number, cz: number, r: number): void {
      const rv = sim.view().royale;
      if (rv === null || request.online) return;
      const c = rv.circle;
      c[CIRCLE.cx] = c[CIRCLE.fromCx] = c[CIRCLE.toCx] = cx;
      c[CIRCLE.cz] = c[CIRCLE.fromCz] = c[CIRCLE.toCz] = cz;
      c[CIRCLE.r] = c[CIRCLE.fromR] = c[CIRCLE.toR] = r;
      rv.data[ZONE.shrinking] = 0;
      rv.data[ZONE.ticks] = 45 * sim.hz;
      changed();
    },
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
    showResult(previewRecord): void {
      // Os prints não gravam estatística (o recorde, quando pedido, é só a prévia do título).
      if (humans > 0 && !resultShown) showResult(false, previewRecord ?? null);
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
  function aimAssistBefore(m: InputMapper = player, controller = 0, st: AimAssistState = assist): number {
    const level = assistAllowed ? m.profile.aimAssist : 0;
    st.target = -1;
    st.scale = 1;
    if (level <= 0) return 1;
    const v = sim.view();
    const e = entityIndex(sim.controllerEntity(controller));
    if (e < 0 || v.alive[e] !== 1 || (v.flags[e]! & ENTITY_FLAG.dead) !== 0) return 1;
    const a = driver.alpha;
    const o = e * 3;
    const ex = v.prevPosition[o]! + (v.position[o]! - v.prevPosition[o]!) * a;
    const ey =
      v.prevPosition[o + 1]! + (v.position[o + 1]! - v.prevPosition[o + 1]!) * a + viewEyeHeight(v, e, v.flags[e]!);
    const ez = v.prevPosition[o + 2]! + (v.position[o + 2]! - v.prevPosition[o + 2]!) * a;
    findAimAssist(v, e, ffa, ex, ey, ez, m.yaw, m.pitch, level, a, far, st, hiddenNow);
    return st.scale;
  }

  /** Depois do `update`: o ímã (mexendo a mira ou andando) e, no Forte, a trava ao apertar o ADS. */
  function aimAssistAfter(dt: number, looked: boolean, m: InputMapper = player, st: AimAssistState = assist): void {
    if (st.target < 0) return;
    const level = assistAllowed ? m.profile.aimAssist : 0;
    if (level >= AIM_ASSIST.snapLevel && m.wasPressed('ads')) {
      m.setAngles(st.targetYaw, st.targetPitch);
      return;
    }
    const active = looked || m.moveX !== 0 || m.moveY !== 0;
    pullAim(st, level, dt, active, m.yaw, m.pitch, assistAngles);
    if (assistAngles[0] !== m.yaw || assistAngles[1] !== m.pitch) {
      m.setAngles(assistAngles[0]!, assistAngles[1]!);
    }
  }

  // --- M3 (fase 1c): entrar no meio ---
  /** Segundos segurando o confirmar em cada controle livre (o último índice é o Enter do teclado); -1 = já entrou. */
  const joinHold = new Float32Array(MAX_GAMEPADS + 1);
  const JOIN_HOLD_S = 1;
  const KEY_ENTER = keyIndex('Enter');
  const joinButton = request.convention === 'right' ? PAD_BUTTON.faceRight : PAD_BUTTON.faceDown;
  const recipeSlots = expandRecipe(recipe, humans);
  let p1Device: DeviceBinding | null = seats[0]?.device ?? null;

  function seated(kind: DeviceKind, pad: number): boolean {
    const same = (d: DeviceBinding | null): boolean =>
      d !== null && d.kind === kind && (d.kind !== 'gamepad' || d.index === pad);
    if (same(p1Device)) return true;
    for (let k = 0; k < extraDevices.length; k++) if (same(extraDevices[k]!)) return true;
    return false;
  }

  /** Segurar A (o confirmar) por 1 s num controle livre, ou o Enter com o teclado livre, entra no meio (até 4). */
  function checkMidJoin(raw: Readonly<RawInputState>, dt: number): void {
    if (extras.length >= 3 || resultShown) return;
    for (let i = 0; i <= MAX_GAMEPADS; i++) {
      let held: boolean;
      if (i < MAX_GAMEPADS) {
        const p = raw.gamepads[i];
        held = p !== undefined && p.connected && (p.buttons[joinButton] ?? 0) >= 0.5 && !seated('gamepad', i);
      } else held = raw.keys[KEY_ENTER] === 1 && !seated('keyboardMouse', -1);
      const t = joinHold[i]!;
      joinHold[i] = !held ? 0 : t < 0 ? t : t + dt;
      if (joinHold[i]! >= JOIN_HOLD_S) {
        joinHold[i] = -1;
        joinMidMatch(i < MAX_GAMEPADS ? pads[i]! : keyboard);
      }
    }
  }

  /** O jogador novo assume um bot do time com menos humanos locais (no FFA, qualquer um) e ganha uma vista. */
  function joinMidMatch(d: DeviceBinding): void {
    const v = sim.view();
    const humansIn = [0, 0, 0, 0];
    for (let k = 0; k < seatCtrl.length; k++) {
      const e = entityIndex(sim.controllerEntity(seatCtrl[k]!));
      if (e >= 0) humansIn[v.team[e]!]!++;
    }
    let pick = -1;
    let best = Number.POSITIVE_INFINITY;
    for (const s of recipeSlots) {
      if (s.bot === null || seatOf(s.controller) >= 0 || !seatableBot(s.team)) continue;
      // M9 (fase 3): de preferência um bot vivo; na eliminação do Sandbox, só vivo (quem morreu não volta).
      const be = entityIndex(sim.controllerEntity(s.controller));
      const dead = be < 0 || (v.flags[be]! & ENTITY_FLAG.dead) !== 0;
      if (dead && sandboxElimination) continue;
      // M9 (fase 5): o bot que o dono tirou da partida (dormente) não recebe ninguém; revisão: nem o congelado (a sim
      // ignora a entrada dele, e o dono não mira em quem é do sofá para soltar).
      if (be >= 0 && (ownerHidden(v, be) || v.owner?.frozen[be] === 1)) continue;
      const n = (ffa ? 0 : (humansIn[s.team] ?? 0)) * 2 + (dead ? 1 : 0);
      if (n < best) {
        best = n;
        pick = s.controller;
      }
    }
    if (pick < 0) {
      if (sandboxElimination) host.log('[partida] sofá: sem bot vivo para entrar (eliminação); entra na próxima');
      return;
    }
    let num = 0;
    while (seatNum.includes(num)) num++;
    const m = createInputMapper(d, seatProfile(num, d.kind));
    const e = entityIndex(sim.controllerEntity(pick));
    if (e >= 0) {
      m.setAngles(v.yaw[e]!, 0);
      m.setWeapon(v.slot[e]!);
    }
    extras.push(m);
    extraDevices.push(d);
    extraAssists.push(createAimAssistState());
    seatCtrl.push(pick);
    seatNum.push(num);
    seatPadId.push('');
    const view = addViewSlot();
    view.controller = pick;
    view.seat = num;
    viewCount = slots.length;
    layout = null;
    driver.setHumanControlled(pick, true);
    everHuman.add(pick);
    const name = names[pick] ?? '?';
    const label = d.kind === 'gamepad' ? `controle ${d.index + 1}` : 'teclado';
    host.log(`[partida] sofá: P${num + 1} entrou no meio (${label}) no lugar de ${name}`);
  }

  /** M3 (fase 1c): o assento `k` (P2–P4) sai do sofá: um bot assume o lugar e a vista dele some. */
  function leaveSeat(k: number): void {
    if (k <= 0 || k >= seatCtrl.length) return;
    const num = seatNum[k]!;
    driver.setHumanControlled(seatCtrl[k]!, false);
    seatCtrl.splice(k, 1);
    seatNum.splice(k, 1);
    seatPadId.splice(k, 1);
    extras.splice(k - 1, 1);
    extraDevices.splice(k - 1, 1);
    extraAssists.splice(k - 1, 1);
    slots.splice(k, 1);
    descs.splice(k, 1);
    viewCount = slots.length;
    layout = null;
    if (lostSeat === k) lostSeat = -1;
    else if (lostSeat > k) lostSeat--;
    host.log(`[partida] sofá: P${num + 1} saiu; um bot assume`);
  }

  /** M3 (fase 1e): até quando (s da partida) cada vista não vibra de novo: o dano em rajada não vira zumbido. */
  const rumbleUntil = new Float64Array(4);
  /**
   * M3 (fase 1e): vibra o controle do jogador da vista `s` (se for controle e a Vibração estiver ligada). `force` passa
   * por cima da espera (a morte).
   */
  function rumble(s: number, strong: number, weak: number, ms: number, force = false): void {
    if (humans === 0 || !host.settings.current.accessibility.vibration || s >= rumbleUntil.length) return;
    const slot = slots[s];
    if (!slot || slot.controller < 0) return;
    const k = seatOf(slot.controller);
    if (k < 0) return;
    const d = k === 0 ? (device === 'gamepad' ? pads[padIndex]! : null) : (extraDevices[k - 1] ?? null);
    if (d === null || d.kind !== 'gamepad') return;
    if (!force && timeS < rumbleUntil[s]!) return;
    rumbleUntil[s] = timeS + ms / 1000;
    platform.input.vibrate(d.index, strong, weak, ms);
  }

  /** O dispositivo do assento `k` (0 = o P1). */
  function seatDevice(k: number): DeviceBinding | null {
    return k === 0 ? p1Device : (extraDevices[k - 1] ?? null);
  }

  /**
   * M3 (fase 1c): controle de um assento caiu: pausa e avisa; o assento fica guardado. Volta sozinho no mesmo índice
   * ou, pelo id, em outro índice livre (o mapeador passa a ler o novo).
   */
  function checkLostPads(raw: Readonly<RawInputState>): void {
    let lost = -1;
    for (let k = 0; k < seatCtrl.length; k++) {
      const d = seatDevice(k);
      if (d === null || d.kind !== 'gamepad') continue;
      const p = raw.gamepads[d.index];
      if (p !== undefined && p.connected) {
        if (seatPadId[k] === '') seatPadId[k] = p.id;
        continue;
      }
      let moved = -1;
      for (let i = 0; i < MAX_GAMEPADS && seatPadId[k] !== ''; i++) {
        const q = raw.gamepads[i];
        if (q !== undefined && q.connected && q.id === seatPadId[k] && !seated('gamepad', i)) moved = i;
      }
      if (moved >= 0) {
        const nd = pads[moved]!;
        if (k === 0) {
          p1Device = nd;
          padIndex = moved;
          player.setDevice(nd);
        } else {
          extraDevices[k - 1] = nd;
          extras[k - 1]!.setDevice(nd);
        }
        host.log(`[partida] sofá: o controle do P${seatNum[k]! + 1} voltou (controle ${moved + 1})`);
        menuOwnerFor(paused ? pausedBy : 0);
        continue;
      }
      if (lost < 0) lost = k;
    }
    if (lost === lostSeat) return;
    const was = lostSeat;
    lostSeat = lost;
    if (lost >= 0) {
      host.log(`[partida] sofá: controle do P${seatNum[lost]! + 1} desconectado`);
      // M4 (fase 3): a pausa abre na página Jogadores (A em outro controle fica no lugar dele).
      if (!paused) pause();
      if (paused && (pausePage === 'main' || pausePage === 'players')) openPlayers();
    } else if (was >= 0 && paused) {
      if (pausePage === 'main') pauseMain();
      else if (pausePage === 'players') openPlayers();
    }
  }

  // --- M4 (fase 3): a página Jogadores da pausa ---
  /** Linhas da página (pré-alocadas; a página só é refeita quando algo muda). */
  const seatLines: { player: number; state: PlayerSeatLine['state']; pad: number }[] = [0, 1, 2, 3].map((player) => ({
    player,
    state: 'free',
    pad: -1,
  }));
  /** Há um bot no lugar do qual alguém pode entrar. */
  function botSeatFree(): boolean {
    for (const s of recipeSlots) if (s.bot !== null && seatOf(s.controller) < 0 && seatableBot(s.team)) return true;
    return false;
  }
  /** M6 (fase 6b): no Bobo Zombies, só o bot de apoio (time 0) cede o lugar (o time 1 da Horda armada é a horda). */
  function seatableBot(team: number): boolean {
    return !zombiesMode || team === 0;
  }
  /** Abre (ou refaz) a página: a pausa passa a ser do P1. */
  function openPlayers(): void {
    pausePage = 'players';
    pausedBy = 0;
    menuOwnerFor(0);
    for (const line of seatLines) {
      const k = seatNum.indexOf(line.player);
      const d = k >= 0 ? seatDevice(k) : null;
      line.state = k < 0 ? 'free' : k === lostSeat ? 'lost' : d !== null && d.kind === 'gamepad' ? 'pad' : 'keyboard';
      line.pad = line.state === 'pad' && d !== null && d.kind === 'gamepad' ? d.index : -1;
    }
    pauseMenu.setRoot(
      playersScreen.build({
        seats: seatLines,
        lost: lostSeat >= 0 ? (seatNum[lostSeat] ?? -1) : -1,
        canJoin: extras.length < 3 && botSeatFree(),
        canLeave: extras.length > 0,
      }),
    );
  }
  /** O controle `d` passa a ser o do assento `k`, cujo controle caiu (Joy-Con que mudou de índice, outro controle). */
  function takeSeat(k: number, d: DeviceBinding & { kind: 'gamepad' }, raw: Readonly<RawInputState>): void {
    if (k === 0) {
      p1Device = d;
      padIndex = d.index;
      player.setDevice(d);
    } else {
      extraDevices[k - 1] = d;
      extras[k - 1]!.setDevice(d);
    }
    seatPadId[k] = raw.gamepads[d.index]?.id ?? '';
    lostSeat = -1;
    host.log(`[partida] sofá: o P${seatNum[k]! + 1} agora joga no controle ${d.index + 1}`);
  }
  /**
   * A entrada da página além do menu (que é do P1): A num controle livre fica no lugar de quem caiu ou entra no meio; B
   * no controle de um P2–P4 sai do sofá. Devolve `true` quando algo mudou (o menu não lê este frame: o A que sentou
   * alguém não vira Continuar).
   */
  function playersInput(raw: Readonly<RawInputState>): boolean {
    const menu = frameMenu;
    if (menu === null) return false;
    let changed = false;
    for (let k = seatCtrl.length - 1; k >= 1; k--) {
      const d = seatDevice(k);
      if (d === null || k === lostSeat || !menu.pressedBy(d, 'back')) continue;
      leaveSeat(k);
      changed = true;
    }
    for (let i = 0; i <= MAX_GAMEPADS; i++) {
      const pad = i < MAX_GAMEPADS;
      const d = pad ? pads[i]! : keyboard;
      if (pad && raw.gamepads[i]?.connected !== true) continue;
      if (seated(d.kind, i) || !menu.pressedBy(d, 'confirm')) continue;
      const lostDevice = lostSeat >= 0 ? seatDevice(lostSeat) : null;
      if (lostSeat >= 0 && d.kind === 'gamepad' && lostDevice !== null && lostDevice.kind === 'gamepad') {
        takeSeat(lostSeat, d, raw);
        changed = true;
      } else if (lostSeat < 0 && extras.length < 3) {
        const before = extras.length;
        joinMidMatch(d);
        if (extras.length > before) changed = true;
      }
    }
    if (changed) openPlayers();
    return changed;
  }
  /** A pausa do sistema (dock↔portátil, HOME, sleep): na LOCAL EDITION, abre a página Jogadores (GDD §3.6). */
  function systemPause(): void {
    const was = paused;
    pause();
    if (!paused || host.localEdition !== true || !couch) return;
    if (!was || pausePage === 'main') openPlayers();
  }

  /** M3 (fase 1c): o assento que pausou passa a ser o dono dos menus; ao continuar, volta o P1. */
  function menuOwnerFor(k: number): void {
    if (!couch || frameMenu === null) return;
    const d = seatDevice(k) ?? p1Device;
    if (d !== null) frameMenu.setOwner(d);
  }

  /**
   * Teste do sofá: os jogadores 2..4 no quadro (mira, assistência e o `+` que pausa). Pausado, só os botões: a mira
   * fica onde estava. Devolve se algum deles apertou pausa.
   */
  function updateExtras(raw: RawInputState, dt: number, frozen: boolean, pausedNow: boolean): number {
    let pauser = -1;
    for (let k = 0; k < extras.length; k++) {
      const m = extras[k]!;
      const yaw0 = m.yaw;
      const pitch0 = m.pitch;
      if (pausedNow || frozen) {
        m.update(raw, 0);
        m.setAngles(yaw0, pitch0);
      } else {
        const st = extraAssists[k]!;
        const scale = aimAssistBefore(m, seatCtrl[k + 1]!, st);
        m.update(raw, dt, scale);
        aimAssistAfter(dt, m.yaw !== yaw0 || m.pitch !== pitch0, m, st);
      }
      if (m.wasPressed('pause') && pauser < 0) pauser = k + 1;
    }
    return pauser;
  }

  // M2 (fase 4h): dicas de 1 linha (gameplay.md §2.5): só na partida de verdade com 1 jogador, nas 2 primeiras
  // partidas do aparelho e com "Dicas" ligado nos Ajustes; cada uma no máximo 1 vez (o `stats@1` lembra).
  const tips = createTips(
    request.kind === 'play' &&
      humans === 1 &&
      host.settings.current.accessibility.tips &&
      host.stats.current.totals.matches < TIP_RULES.maxMatches,
    host.stats.current.onboarding.tipsSeen,
  );
  const tipSignals = createTipSignals();
  const tipAssist = createAimAssistState();
  const tipCanShow = (id: TipId): boolean => profileBindings(profiles[device], TIPS[id].action).length > 0;
  /** O nome da tecla da dica, refeito só quando a dica ou o dispositivo mudam (a troca de glifos é na hora). */
  let tipLabelId: TipId | null = null;
  let tipLabelDevice: DeviceKind | null = null;
  let tipKey = '';
  let tipText = '';
  /** M4 (fase 4a): o botão de face da dica como glifo (0 baixo, 1 direita, 2 esquerda, 3 cima), ou -1. */
  let tipGlyph = -1;
  function refreshTipLabel(): void {
    const id = tips.current;
    if (id === null || (id === tipLabelId && device === tipLabelDevice)) return;
    tipLabelId = id;
    tipLabelDevice = device;
    const sources = profileBindings(profiles[device], TIPS[id].action);
    tipKey = sources.length > 0 ? bindingLabel(sources[0]!) : '';
    const src = sources[0];
    tipGlyph = src !== undefined && src.device === 'padButton' && !src.hold ? FACE_GLYPHS.indexOf(src.button) : -1;
    tipText = t(TIPS[id].textKey);
  }
  function updateTips(dt: number): void {
    if (tips.pending.size === 0 && tips.current === null) return;
    const v = sim.view();
    const e = entityIndex(sim.controllerEntity(me));
    const fl = e >= 0 ? v.flags[e]! : 0;
    tipSignals.alive = e >= 0 && v.alive[e] === 1 && (fl & ENTITY_FLAG.dead) === 0;
    tipSignals.farEnemy = false;
    tipSignals.magEmpty = false;
    // Refino R2 (#79): com granada no slot e o pente de granadas cheio (ainda não jogou nenhuma).
    const kT = e * WEAPON_SLOT_COUNT + WEAPON_SLOT.throwable;
    const nade = e >= 0 ? weaponDef(v.loadout[kT]!) : null;
    tipSignals.grenadeUnused =
      nade !== null && nade.fire === WEAPON_FIRE.thrown && v.slotClip[kT] === nade.clipSize && v.cookTicks[e]! < 0;
    if (tipSignals.alive) {
      const speed = Math.hypot(v.velocity[e * 3]!, v.velocity[e * 3 + 2]!);
      tipSignals.moving = speed > 1 && (fl & ENTITY_FLAG.onGround) !== 0;
      tipSignals.sprinting = (fl & ENTITY_FLAG.sprinting) !== 0;
      const held = weaponDef(v.weapon[e]!);
      tipSignals.magEmpty =
        held !== null &&
        held.clipSize > 0 &&
        held.fire !== WEAPON_FIRE.thrown &&
        heldClip(v, e) === 0 &&
        heldReserve(v, e) > 0 &&
        (fl & ENTITY_FLAG.reloading) === 0;
      // Inimigo longe na mira (sem ADS): o cone da assistência no nível 1, só enquanto a dica do ADS espera.
      if (tips.pending.has('ads') && (fl & ENTITY_FLAG.ads) === 0) {
        const a = driver.alpha;
        const o = e * 3;
        const ex = v.prevPosition[o]! + (v.position[o]! - v.prevPosition[o]!) * a;
        const ey = v.prevPosition[o + 1]! + (v.position[o + 1]! - v.prevPosition[o + 1]!) * a + viewEyeHeight(v, e, fl);
        const ez = v.prevPosition[o + 2]! + (v.position[o + 2]! - v.prevPosition[o + 2]!) * a;
        findAimAssist(v, e, ffa, ex, ey, ez, player.yaw, player.pitch, 1, a, far, tipAssist);
        const j = tipAssist.target;
        if (j >= 0) {
          const dx = v.position[j * 3]! - ex;
          const dz = v.position[j * 3 + 2]! - ez;
          tipSignals.farEnemy = dx * dx + dz * dz > TIP_RULES.farM * TIP_RULES.farM;
        }
      }
    }
    const started = stepTips(tips, tipSignals, dt, tipCanShow);
    if (started !== null) {
      host.stats.tipSeen(started);
      host.log(`[partida] dica: ${started}`);
    }
  }

  function pause(seat = 0): void {
    if (paused || disposed || (humans === 0 && !aquarium) || resultShown) return;
    paused = true;
    pausedBy = seat > 0 && seat < seatCtrl.length ? seat : 0;
    menuOwnerFor(pausedBy);
    matchSound.silence();
    // M2 (fase 5f): refeita ao abrir (calibrando, o item é "Pular calibração").
    if (pausePage === 'main') pauseMain();
    // M9 (fase 5): pausar com uma ferramenta do dono armada desarma e abre a página dela (para escolher outra).
    if (ownerTools !== null && ownerTools.armed !== OWNER_NO_TOOL && pausedBy === 0) {
      ownerTools.cancel();
      player.release('ads');
      ownerTools.openTools();
      pauseMenu.focus(null);
      ownerPage();
    }
  }

  // --- M5 (fase 5a): o host online ausente (só no cliente) ---
  let hostAwayText = '';
  /** Os segundos que a faixa mostra (o texto só é refeito quando eles mudam). */
  let hostAwayShown = -2;
  /**
   * 1x por frame no cliente online: a faixa "O host saiu do jogo"; no PvP, a contagem de 10 s e, sem o host, o
   * resultado do último snapshot (tecnico.md §13.4). No coop, a partida espera (a predição já parou no `net`).
   */
  function checkHostAway(): void {
    const absent = driver.hostAbsentS;
    if (absent <= 0) {
      hostAwayText = '';
      hostAwayShown = -2;
      return;
    }
    if (resultShown) return;
    // Só o aviso do host conta os 10 s do PvP: o silêncio sozinho pode ser a minha conexão caindo (aí a sala tenta
    // voltar, e a partida não deve acabar antes).
    const coop = waitsForHost(recipe.mode) || !driver.hostAwayNotified;
    const left = coop ? -1 : Math.max(0, Math.ceil(HOST_AWAY_END_S - absent));
    if (left !== hostAwayShown) {
      if (hostAwayShown === -2) host.log(`[partida] host ausente (${coop ? 'espera' : 'PvP: 10 s'})`);
      hostAwayShown = left;
      hostAwayText = coop ? t('match.hostAway') : t('match.hostAwayEnds', { s: left });
    }
    if (!coop && absent >= HOST_AWAY_END_S && humans > 0) {
      host.log('[partida] o host não voltou em 10 s: resultado do último snapshot');
      hostAwayText = '';
      showResult(true);
    }
  }

  // --- M4 (fase 3): a bateria (Switch; P5: o nível na pausa e um aviso só abaixo de 20%, sem carregar) ---
  let batteryWarned = false;
  let batteryCheckS = 0;
  let batteryNoticeS = 0;
  let batteryNotice = '';
  /** A linha da pausa ("Bateria 64%"), ou `''` sem leitura. */
  function batteryLine(): string {
    const b = host.battery?.() ?? null;
    if (b === null) return '';
    return t(b.charging ? 'pause.batteryCharging' : 'pause.battery', { n: Math.round(b.level * 100) });
  }
  /** A cada 5 s da partida: abaixo de 20% e sem carregar, o aviso aparece uma vez (na vista do P1). */
  function checkBattery(dt: number): void {
    if (batteryNoticeS > 0) batteryNoticeS = Math.max(0, batteryNoticeS - dt);
    if (batteryWarned || !host.battery || humans === 0) return;
    batteryCheckS -= dt;
    if (batteryCheckS > 0) return;
    batteryCheckS = BATTERY_CHECK_S;
    const b = host.battery();
    if (b === null || b.charging || b.level >= BATTERY_LOW) return;
    const n = Math.round(b.level * 100);
    batteryWarned = true;
    batteryNoticeS = BATTERY_NOTICE_S;
    batteryNotice = t('match.batteryLow', { n });
    host.log(`[partida] bateria em ${n}% sem carregar: aviso`);
  }

  // --- M8 (fase 5): o Diretor de Partida (o ajuste vem do diretor dos bots; o cliente online não tem: sem linha) ---
  let directorShown = Number.NaN;
  /** O ajuste de agora (quartos de nível) ou `null` com o Diretor desligado. */
  function directorShift(): number | null {
    return driver.director?.directorShift() ?? null;
  }
  /** A linha da pausa, ou `''` com o Diretor desligado. */
  function directorPauseLine(): string {
    const shift = directorShift();
    if (shift === null) return '';
    const goal = t(`director.goal.${recipe.director?.goal ?? 'balanced'}` as StringKey);
    return t('director.pause', { goal, shift: directorShiftText(shift) });
  }
  /** A linha do placar: refeita só quando o ajuste muda (a cada 30 s no máximo). */
  function refreshDirectorNote(): void {
    const shift = directorShift();
    if (shift === null) {
      scoreboard.note = '';
      return;
    }
    if (shift === directorShown) return;
    directorShown = shift;
    scoreboard.note = t('director.badge', { shift: directorShiftText(shift) });
  }

  /** Refino R4: o foco com que a pausa foi montada (a frase de ajuda é dele). */
  let pauseMainFocus: string | null = null;
  function pauseMain(): void {
    pausePage = 'main';
    pauseMainFocus = pauseMenu.focusedId;
    const st = {
      ...pauseState,
      calibrating: calibration !== null,
      player: seatNum[pausedBy] ?? 0,
      lost: lostSeat >= 0 ? (seatNum[lostSeat] ?? -1) : -1,
      // O item Jogadores é da LOCAL EDITION (na web, a página abre sozinha quando um controle cai).
      players: couch && host.localEdition === true,
      battery: batteryLine(),
      director: directorPauseLine(),
      // M9 (fase 5): as Ferramentas do Dono (o Sandbox), no alto da pausa do P1.
      owner: ownerTools !== null,
      // M7 (fase 9): os itens do Aquário (a velocidade, assumir e voltar a assistir).
      ...(aquarium
        ? {
            items: aquariumPauseItems({
              speed: aquariumSpeedText(aqSpeed),
              piloting: pilot >= 0,
              canTake: aqFollowed() >= 0 && livingBobo(sim.view(), aqFollowed()),
              list: aqList,
              challenge: pauseState.challenge,
            }),
          }
        : {}),
    };
    const help = (aquarium ? aquariumPauseHelp(pauseMainFocus) : null) ?? pauseHelp(pauseMainFocus, st);
    pauseMenu.setRoot(pauseScreen.build({ ...st, help }));
  }

  /** M9 (fase 5): a página das Ferramentas do Dono (ou a dos modificadores), montada pelo `owner-tools`. */
  let ownerFocus: string | null = null;
  function ownerPage(): void {
    pausePage = 'owner';
    ownerFocus = pauseMenu.focusedId;
    pauseMenu.setRoot(ownerTools!.build(ownerFocus));
  }
  /** Uma navegação da página do dono: armou (fecha a pausa), voltou à pausa ou mudou um valor (refaz a página). */
  function ownerPageAction(nav: MenuNavigation): void {
    const tools = ownerTools!;
    const before = tools.page;
    const r = tools.action(nav);
    if (r === 'resume') {
      resume();
      ownerArmed();
    } else if (r === 'back') {
      // O foco volta para o item das ferramentas na pausa.
      pauseMenu.focus('owner');
      pauseMain();
    } else if (r === 'rebuild') {
      // Trocou de página: o foco vai para o inicial dela (o último item usado).
      if (tools.page !== before) pauseMenu.focus(null);
      ownerPage();
    } else if (pauseMenu.focusedId !== ownerFocus) ownerPage();
  }

  function startCalibration(): void {
    calibration = createCalibration(player.yaw, player.pitch);
    calibrationUndo = null;
    host.log('[partida] calibrar mira: começou');
  }

  /** Fim da calibração: aplica o ajuste na sensibilidade do dispositivo (na hora) e mostra o resultado, com Desfazer. */
  function finishCalibration(): void {
    const st = calibration!;
    calibration = null;
    lastTraining = [Number.NaN, Number.NaN, Number.NaN, Number.NaN];
    const factor = calibrationFactor(st);
    const before = host.settings.current;
    const c = before.controls[device];
    const from = c.sensitivity;
    const range = SETTINGS_RANGES.sensitivity;
    const to = Math.max(range.min, Math.min(range.max, Math.round(from * factor * 100) / 100));
    let message: string;
    if (to === from) message = t('calibrate.same', { from });
    else {
      calibrationUndo = before;
      host.settings.save({ ...before, controls: { ...before.controls, [device]: { ...c, sensitivity: to } } });
      applySettings();
      message = t(factor < 1 ? 'calibrate.lower' : 'calibrate.higher', { from, to });
    }
    host.log(`[partida] calibrar mira: ×${from} → ×${to} (passou ${st.overshoots}, não chegou ${st.undershoots})`);
    pause();
    pausePage = 'calibrated';
    pauseMenu.setRoot(calibratedScreen.build({ message, changed: calibrationUndo !== null }));
  }

  /** M2 (fase 4f): a página de Ajustes da pausa (Controles, Botões, Vídeo, Acessibilidade), que vale na hora. */
  let pauseSettingsTab = 0;
  let pauseSettingsDevice: DeviceKind = device;
  let pauseNote = '';
  /** M2 (fase 4f, parte 2): a captura do novo botão de uma ação (aba Botões). */
  const capture = createBindingCapture();
  let capturing: RemapAction | null = null;
  /** Refino R3c: o foco com que a página foi montada (a frase de ajuda é dele). */
  let pauseHelpFocus: string | null = null;
  function pauseSettings(): void {
    const tab = PAUSE_SETTINGS_TABS[pauseSettingsTab]!;
    pauseHelpFocus = pauseMenu.focusedId;
    pauseMenu.setRoot(
      settingsScreen.build({
        tabs: PAUSE_SETTINGS_TABS.map((id) => SETTINGS_TAB_LABELS[id]),
        tab: pauseSettingsTab,
        rows: settingsRows(tab, host.settings.current, pauseSettingsDevice, capturing, platform.features.keyboardMouse),
        note: pauseNote,
        help: settingsHelp(PAUSE_SETTINGS_TABS, tab, pauseHelpFocus, pauseSettingsDevice),
      }),
    );
  }
  /** Fim da captura: liga a fonte nova e aplica na hora (com o aviso de troca, se houver) ou cancela. */
  function finishCapture(result: CaptureResult): void {
    if (capturing === null || result === 'none') return;
    if (result === 'cancel') pauseNote = '';
    else {
      const next = rebindSettings(
        host.settings.current,
        pauseSettingsDevice,
        capturing,
        result,
        platform.features.keyboardMouse,
      );
      if (next.doc !== host.settings.current) {
        host.settings.save(next.doc);
        applySettings();
      }
      pauseNote = next.note;
    }
    capturing = null;
    pauseSettings();
  }
  /** Leva os ajustes novos para a partida: perfis, campo de visão e tremor. */
  function applySettings(): void {
    profiles = buildProfiles();
    player.setProfile(profiles[device]);
    aqHintDevice = null;
    ownerHintDevice = null;
    for (let k = 0; k < extras.length; k++) extras[k]!.setProfile(seatProfile(seatNum[k + 1]!, extraDevices[k]!.kind));
    fovDeg = fovFromSettings();
    shakeMul = shakeFromSettings();
    thirdPerson = thirdFromSettings();
    shoulderSide = sideFromSettings();
  }

  /** M2 (fase 6b): a troca de câmera e de ombro na partida vale para sempre (vai para os Ajustes). */
  function saveVideo(patch: Partial<VideoSettings>): void {
    const doc = host.settings.current;
    host.settings.save({ ...doc, video: { ...doc.video, ...patch } });
    applySettings();
    host.log(
      `[partida] câmera: ${thirdPerson ? '3ª' : '1ª'} pessoa, ombro ${shoulderSide > 0 ? 'direito' : 'esquerdo'}`,
    );
  }

  /**
   * M2 (fase 6b): com a vista do humano em 3ª pessoa, o tiro sai do olho na direção do ponto que o raio da câmera
   * acerta (`aimFromCamera`). A câmera fica onde o último frame a pôs, em relação ao olho do tick atual.
   */
  /** M2 (fase 6e): a retícula do jogador 1 está num inimigo vivo e à vista (o "atirar sozinho" do toque)? */
  function enemyUnderCrosshair(): boolean {
    if (humans === 0) return false;
    const v = sim.view();
    const e = entityIndex(sim.controllerEntity(me));
    const fl = v.flags[e]!;
    if (v.alive[e] !== 1 || (fl & ENTITY_FLAG.dead) !== 0) return false;
    const ex = v.position[e * 3]!;
    const ey = v.position[e * 3 + 1]! + viewEyeHeight(v, e, fl);
    const ez = v.position[e * 3 + 2]!;
    let third: ViewSlot | null = null;
    for (let i = 0; i < slots.length; i++) if (slots[i]!.controller === me && slots[i]!.third) third = slots[i]!;
    const cx = third ? ex + third.camOffX : ex;
    const cy = third ? ey + third.camOffY : ey;
    const cz = third ? ez + third.camOffZ : ez;
    const j = crosshairTarget(v, e, ex, ey, ez, cx, cy, cz, player.yaw, player.pitch, AUTO_FIRE_RANGE_M);
    return j >= 0 && (ffa || v.team[j] !== v.team[e]);
  }

  function thirdPersonAim(): boolean {
    if (humans === 0) return false;
    let slot: ViewSlot | null = null;
    for (let i = 0; i < slots.length; i++) if (slots[i]!.controller === me && slots[i]!.third) slot = slots[i]!;
    if (slot === null) return false;
    const v = sim.view();
    const e = entityIndex(sim.controllerEntity(me));
    const fl = v.flags[e]!;
    if (v.alive[e] !== 1 || (fl & ENTITY_FLAG.dead) !== 0) return false;
    const ex = v.position[e * 3]!;
    const ey = v.position[e * 3 + 1]! + viewEyeHeight(v, e, fl);
    const ez = v.position[e * 3 + 2]!;
    aimFromCamera(
      v,
      e,
      ex,
      ey,
      ez,
      ex + slot.camOffX,
      ey + slot.camOffY,
      ez + slot.camOffZ,
      player.yaw,
      player.pitch,
      thirdAim,
    );
    return true;
  }

  /** M2 (fase 2e): uma ação da pausa (Continuar, Ajustar desafio, Ajustes, Destravar, Sair) ou das páginas dela. */
  function pauseAction(nav: MenuNavigation, raw: Readonly<RawInputState>): SceneSignal {
    const a = nav.activated;
    if (pausePage === 'main') {
      if (nav.back || a === PAUSE_ACTION.resume) resume();
      else if (a === PAUSE_ACTION.challenge) {
        pausePage = 'challenge';
        pauseMenu.setRoot(challengeScreen.build(currentLevel));
      } else if (a === PAUSE_ACTION.settings) {
        pausePage = 'settings';
        pauseSettingsDevice = device;
        pauseNote = '';
        pauseSettings();
      } else if (a === PAUSE_ACTION.calibrate) {
        // Calibrando: o item é "Pular calibração".
        if (calibration !== null) {
          calibration = null;
          lastTraining = [Number.NaN, Number.NaN, Number.NaN, Number.NaN];
          host.log('[partida] calibrar mira: pulou');
        } else startCalibration();
        resume();
      } else if (a === PAUSE_ACTION.unstuck) {
        unstuckPending = true;
        resume();
      } else if (a === PAUSE_ACTION.leave) {
        const k = pausedBy;
        resume();
        leaveSeat(k);
      } else if (a === PAUSE_ACTION.players) {
        openPlayers();
        return 'none';
      } else if (a === PAUSE_ACTION.owner && ownerTools !== null) {
        ownerTools.openTools();
        ownerPage();
        return 'none';
      } else if (a === AQUARIUM_ACTION.speed) {
        // M7 (fase 9): a próxima velocidade (a pausa fica aberta, com o foco no item).
        aqSpeed = nextAquariumSpeed(aqSpeed, aqMaxSpeed);
        host.log(`[partida] aquário: velocidade ${aquariumSpeedText(aqSpeed)}`);
        pauseMain();
        return 'none';
      } else if (a === AQUARIUM_ACTION.list) {
        aqList = !aqList;
        resume();
      } else if (a === AQUARIUM_ACTION.take) {
        resume();
        takeBot();
      } else if (a === AQUARIUM_ACTION.watch) {
        resume();
        releaseBot();
      } else if (a === PAUSE_ACTION.quit) return request.online?.role === 'client' ? 'leave' : 'quit';
      // Refino R4: a frase de ajuda segue o foco.
      if (paused && pausePage === 'main' && pauseMenu.focusedId !== pauseMainFocus) pauseMain();
      return 'none';
    }
    if (pausePage === 'players') {
      if (a === PLAYERS_ACTION.resume) resume();
      else if (nav.back) pauseMain();
      return 'none';
    }
    if (pausePage === 'owner') {
      ownerPageAction(nav);
      return 'none';
    }
    if (pausePage === 'calibrated') {
      if (a === CALIBRATED_ACTION.undo && calibrationUndo !== null) {
        host.settings.save(calibrationUndo);
        applySettings();
      }
      calibrationUndo = null;
      if (a !== null || nav.back) resume();
      return 'none';
    }
    if (pausePage === 'challenge') {
      const level = challengeLevel(a);
      if (level !== null) {
        currentLevel = level;
        let n = 0;
        for (const team of challengeTeams) n += driver.director?.setLevel(level, team) ?? 0;
        host.log(`[partida] desafio: ${level} (${n} bots)`);
        pauseMain();
      } else if (nav.back || a === 'back') pauseMain();
      return 'none';
    }
    if (nav.tab !== 0) {
      pauseSettingsTab = (pauseSettingsTab + nav.tab + PAUSE_SETTINGS_TABS.length) % PAUSE_SETTINGS_TABS.length;
      followTab(pauseMenu, pauseSettingsTab);
      pauseNote = '';
      pauseSettings();
    } else if (nav.back || a === SETTINGS_ACTION.back) pauseMain();
    else if (a !== null && a.startsWith(SETTINGS_TAB_PREFIX)) {
      pauseSettingsTab = Number(a.slice(SETTINGS_TAB_PREFIX.length));
      pauseNote = '';
      pauseSettings();
    } else if (a !== null && a.startsWith(SETTINGS_ROW_PREFIX)) {
      const tab = PAUSE_SETTINGS_TABS[pauseSettingsTab]!;
      const id = a.slice(SETTINGS_ROW_PREFIX.length);
      const bind = tab === 'buttons' ? bindRowAction(id, pauseSettingsDevice) : null;
      if (bind !== null) {
        capturing = bind;
        capture.start(raw, pauseSettingsDevice === 'gamepad' ? 'gamepad' : 'keyboardMouse');
        pauseNote = t('settings.bind.press', { action: t(actionLabel(bind)) });
      } else {
        const next = stepSettings(tab, host.settings.current, pauseSettingsDevice, id, nav.delta);
        pauseSettingsDevice = next.device;
        if (next.doc !== host.settings.current) {
          host.settings.save(next.doc);
          applySettings();
        }
        pauseNote = tab === 'buttons' && id === 'reset' ? t('settings.bind.resetDone') : '';
      }
      pauseSettings();
    }
    // Refino R3c: a frase de ajuda segue o foco (a página continua a dos Ajustes se nada acima a trocou).
    if (pausePage === 'settings' && pauseMenu.focusedId !== pauseHelpFocus) pauseSettings();
    return 'none';
  }

  /**
   * M8 (fase 4): a memória do Nêmesis depois da partida (`scene/nemesis.ts`): cada bot com quantas vezes te pegou e
   * você a ele, pelo id do documento. Devolve a linha da rivalidade quando o Nêmesis da partida é o rival guardado.
   */
  function recordNemesis(v: SimView, human: number): string {
    const tallies: MatchBotTally[] = [];
    for (const slot of expandRecipe(recipe, humans)) {
      // O lugar que um jogador do sofá assumiu (mesmo que tenha saído depois) não é bot: os abates dele não contam.
      if (slot.bot === null || everHuman.has(slot.controller)) continue;
      const e = entityIndex(sim.controllerEntity(slot.controller));
      if (e >= v.count || e >= matchStats.capacity) continue;
      // Só os do lado de lá: no FFA e na Infection (quem é infectado muda), todos; no Royale, o esquadrão é o time.
      if (!solo && !infection && v.team[e] === v.team[human]) continue;
      const id = resolveBot(recipe, slot.bot).id;
      // O id longo demais não volta igual do save (o teto é 64): fica de fora.
      if (id.length > 48) continue;
      tallies.push({
        id,
        name: Array.from(nameOf(v, e)).slice(0, 24).join(''),
        killedYou: matchStats.killedHuman[e]!,
        youKilled: matchStats.killedByHuman[e]!,
      });
    }
    const prev = host.stats.current.nemesis ?? null;
    const mem = updateNemesis(prev, tallies);
    if (mem !== prev) host.stats.setNemesis(mem);
    if (mem === null || !showsRivalry(mem, tallies)) return '';
    return t('result.rivalry', { name: mem.name, them: mem.killedYou, you: mem.youKilled, n: mem.matches });
  }

  /** M2 (fase 2e): monta a tela de resultado com as contas da partida (uma vez, no fim). */
  /** M2 (fase 4e): o que o resultado mostra (para refazer a tela ao salvar o preset). */
  let resultData: ResultScreenData | null = null;
  function showResult(record: boolean, previewRecord: 'kills' | 'streak' | 'both' | null = null): void {
    const v = sim.view();
    const human = humans > 0 ? entityIndex(sim.controllerEntity(me)) : -1;
    const sum = summarizeMatch(matchStats, v, human, solo, juggernaut);
    resultNemesis = sum.nemesis;
    // M2 (fase 4g): a partida vai para o `stats@1` (o bench não tem humano). Rodada 8 (D5): em tela dividida, todos os
    // jogadores locais somados (os humanos são os controladores 0..humans-1).
    let breaks: RecordBreaks | null = null;
    /** M8 (fase 4): a rivalidade com o Nêmesis guardado (`''` = nenhuma). */
    let rivalry = '';
    // M3 (fase 6a): a onda máxima desta configuração antes da partida (o recorde é por mapa, regras e jogadores).
    const zombieKey = zombiesMode ? zombieRecordKey(recipe, humans) : '';
    const previousWave = zombiesMode ? zombieRecord(host.stats.current, zombieKey) : 0;
    if (record && human >= 0 && !benchState && !aquarium) {
      const locals: number[] = [];
      for (let p = 0; p < humans; p++) locals.push(entityIndex(sim.controllerEntity(p)));
      const zombies = zombiesMode ? { key: zombieKey, wave: v.match.zombieWave } : undefined;
      breaks = host.stats.record(localMatchRecord(matchStats, v, locals, solo, Math.round(timeS), zombies));
      rivalry = recordNemesis(v, human);
    }
    if (zombiesMode) {
      showZombiesResult(sum.outcome === 'win', previousWave, breaks !== null, breaks?.zombieWave === true);
      host.log(`[partida] fim do Bobo Zombies: ${sum.outcome} onda=${v.match.zombieWave} recorde=${previousWave}`);
      return;
    }
    const recordKind =
      breaks === null
        ? previewRecord
        : breaks.mostKills && breaks.bestStreak
          ? 'both'
          : breaks.mostKills
            ? 'kills'
            : breaks.bestStreak
              ? 'streak'
              : null;
    const nm = (i: number): string => (i >= 0 ? nameOf(v, i) : '');
    const wave = v.match.zombieWave;
    const watching = aquarium && human < 0;
    const title = watching
      ? aquariumResultTitle(v, sum.winner)
      : zombiesMode
        ? sum.outcome === 'win'
          ? t('result.zombiesWin', { waves: wave })
          : t('result.zombiesLoss', { wave })
        : sum.outcome === 'win'
          ? t('result.win')
          : sum.outcome === 'draw'
            ? t('result.draw')
            : solo && sum.winner >= 0
              ? t('result.ffaWinner', { name: nm(sum.winner) })
              : t('result.loss');
    // M7 (fase 8): no Royale, a colocação do esquadrão do jogador ("3º de 24").
    const rov = v.royale;
    const royalePlace = rov !== null && human >= 0 ? (rov.place[v.team[human]!] ?? 0) : 0;
    const royalePlaceLine =
      royalePlace > 0 ? t('result.royalePlace' as StringKey, { place: royalePlace, squads: rov!.squads }) : '';
    // M9 (fase 3): no Sandbox com outro time na frente, quem venceu (pelo nome) junto do placar.
    const winnerTeam = v.match.winnerTeam;
    const sandboxLine =
      sandboxMode && !watching && sum.outcome === 'loss' && winnerTeam >= 0 && winnerTeam < recipe.teams.length
        ? t('result.sandboxWinner' as StringKey, {
            team: teamName(recipe, winnerTeam),
            own: sum.ownScore,
            // M9 (fase 3, revisão): o placar de quem venceu (na eliminação, nem sempre o maior).
            other: v.match.teamScore[winnerTeam] ?? 0,
          })
        : '';
    const data: ResultScreenData = {
      title,
      titleColor: watching
        ? COLORS.texto
        : sum.outcome === 'win'
          ? COLORS.acao
          : sum.outcome === 'loss'
            ? COLORS.perigo
            : COLORS.texto,
      own: sum.ownScore,
      other: sum.otherScore,
      ...(zombiesMode ? { scoreLine: t('result.zombiesWave', { wave }) } : {}),
      ...(royalePlaceLine !== '' ? { scoreLine: royalePlaceLine } : {}),
      ...(sandboxLine !== '' ? { scoreLine: sandboxLine } : {}),
      ...(sandboxMode ? { scenario: true } : {}),
      // M7 (fase 9): assistindo, sem os números pessoais; no FFA e no Royale, sem o placar.
      ...(watching ? { watching: true } : {}),
      ...(watching && (solo || rov !== null) ? { scoreLine: '' } : {}),
      mvp: nm(sum.mvp),
      nemesis: nm(sum.nemesis),
      ...(currentLevel === BOT_LEVELS[BOT_LEVELS.length - 1] ? { openLab: true } : {}),
      nemesisKills: sum.nemesisKills,
      ...(rivalry !== '' ? { rivalry } : {}),
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
      ...(recordKind !== null ? { record: recordKind } : {}),
      ...(request.online ? { online: true } : {}),
    };
    resultData = data;
    resultMenu.setRoot(resultScreen.build(data));
    resultShown = true;
    host.log(`[partida] fim: ${sum.outcome} ${sum.ownScore}×${sum.otherScore} abates=${sum.kills}`);
  }

  /** M3 (fase 7a): o minimapa no quadrante livre, embaixo do placar (se houver). */
  function drawSpareMinimap(list: DrawList, area: HudSharedArea): void {
    const v = sim.view();
    if (minimapPlan === null) {
      const t0 = now();
      minimapPlan = buildMinimapPlan(v.world, v.blocks, v.playArea, v.colliders);
      host.log(
        `[partida] minimapa: ${minimapPlan.walls} paredes e ${minimapPlan.count - minimapPlan.walls} props em ${(now() - t0).toFixed(1)} ms`,
      );
    }
    minimapLocals.length = 0;
    minimapColors.length = 0;
    let team = -2;
    for (let s = 0; s < slots.length; s++) {
      const c = slots[s]!.controller;
      const i = entityIndex(sim.controllerEntity(c));
      minimapLocals.push(i);
      minimapColors.push(PLAYER_COLORS[Math.max(0, seatOf(c))] ?? COLORS.texto);
      const t = i < v.count ? v.team[i]! : -1;
      team = team === -2 || team === t ? t : -1;
    }
    const top = hudSpareTopBand(area, sharedHud);
    const hs = Math.min(area.width / 320, area.height / 180);
    drawMinimap(list, minimapPlan, v, {
      x: area.x,
      y: area.y + top,
      width: area.width,
      height: area.height - top,
      scale: Math.max(0.75, hs),
      locals: minimapLocals,
      localColors: minimapColors,
      // Aliados: o time dos locais (no versus do sofá, ninguém; no FFA também não).
      allyTeam: ffa ? -1 : team,
      zombies: zombiesMode,
      hordeTeam: hordeArmed ? 1 : -1,
    });
  }

  /** M3 (fase 6a): o resultado do Bobo Zombies (a tabela do time e o recorde de onda). */
  let zombiesData: ZombiesResultData | null = null;
  function showZombiesResult(win: boolean, previousWave: number, recorded: boolean, newRecord: boolean): void {
    const v = sim.view();
    const wave = v.match.zombieWave;
    const z = recipe.zombies ?? {};
    const D = ZOMBIES_DEFAULTS;
    const customRules =
      (z.quantity ?? D.quantity) !== D.quantity ||
      (z.hpMul ?? D.hpMul) !== D.hpMul ||
      (z.speed ?? D.speed) !== D.speed ||
      (z.specials ?? D.specials) !== D.specials ||
      (z.bosses ?? D.bosses) !== D.bosses ||
      (z.economy ?? D.economy) !== D.economy ||
      (z.selfRevives ?? D.selfRevives) !== D.selfRevives;
    const config = [
      t(`map.${recipe.map}` as StringKey),
      zombieWaves(recipe),
      aquarium
        ? t('aquarium.title')
        : humans === 1
          ? t('result.zombies.onePlayer')
          : t('result.zombies.players', { n: humans }),
      ...(customRules ? [t('result.zombies.customRules')] : []),
    ].join(' · ');
    const best = recorded ? Math.max(previousWave, wave) : previousWave;
    const recordLine = newRecord
      ? t('result.zombies.newRecord', { wave: previousWave })
      : best === 0 || (recorded && previousWave === 0)
        ? t('result.zombies.firstRecord')
        : t('result.zombies.record', { wave: best });
    const data: ZombiesResultData = {
      // Solo: "Caiu na onda 7" (o plural é do time).
      title: win
        ? t(humans === 1 ? 'result.zombiesWinSolo' : 'result.zombiesWin', { waves: wave })
        : t(humans === 1 ? 'result.zombiesLossSolo' : 'result.zombiesLoss', { wave }),
      titleColor: win ? COLORS.acao : COLORS.perigo,
      config,
      // M7 (fase 9, revisão): o Aquário não grava recorde.
      record: aquarium ? '' : recordLine,
      newRecord: newRecord && !aquarium,
      ...(request.online ? { online: true } : {}),
      rows: zombiesRows(matchStats, v).map((r) => {
        const c = v.controller[r.entity]!;
        return {
          name: nameOf(v, r.entity),
          color: aquarium
            ? seatOf(c) === 0
              ? (PLAYER_COLORS[0] as number)
              : COLORS.texto
            : c < humans
              ? (PLAYER_COLORS[c] ?? COLORS.texto)
              : COLORS.texto,
          points: r.points,
          kills: r.kills,
          headKills: r.headKills,
          downs: r.downs,
          revives: r.revives,
        };
      }),
    };
    zombiesData = data;
    resultMenu.setRoot(zombiesResultScreen.build(data));
    resultShown = true;
  }

  function resume(): void {
    if (!paused || disposed) return;
    paused = false;
    pausedBy = 0;
    menuOwnerFor(0);
    if (pausePage !== 'main') pauseMain();
    // Botões apertados no menu de pausa (o clique em "Continuar") não podem virar tiro no primeiro tick.
    player.writeFrame(drain, 0);
  }

  /** M9 (fase 1b): quantos atores do frame são entidades da sim (os primeiros; depois vêm os manequins). */
  let entityActors = 0;

  /**
   * M9 (fase 1b): o corpo dos modificadores maior que o normal (o bot gigante) com a câmera de uma vista em 1ª pessoa
   * dentro dele (`cameraInsideBody`) some nessa vista, pelo mesmo caminho do próprio corpo (o `localSlot` do ator vira
   * o da vista; nenhum programa novo). Com a colisão normal o gigante encosta no jogador e a tela virava perna. Depois
   * das câmeras do frame, antes do desenho. Limites (o `localSlot` é um só por ator e só vale em 1ª pessoa):
   * - um ator só some numa vista: no sofá, a primeira cuja câmera está dentro dele;
   * - o gigante que já é o corpo de uma vista (o jogador do sofá num lugar de bot, o piloto do Aquário) fica como está:
   *   na vista de outro jogador com a câmera dentro dele, ele aparece;
   * - as vistas em 3ª pessoa e as câmeras do Aquário (de cima e seguindo: `localSlot` −1) nunca escondem ninguém; a de
   *   ombro já se afasta do corpo seguido, e a de cima fica acima de todos.
   */
  function hideBodiesAroundCameras(): void {
    // quente:
    const pos = actors.position;
    for (let n = 0; n < entityActors && n < actors.count; n++) {
      if (actors.localSlot[n] !== 255) continue;
      const i = entityIndex(actors.entity[n]!);
      if (i >= shownScale.length || shownScale[i]! <= 1) continue;
      const sc = actors.scale[n]!;
      const k = n * 3;
      for (let s = 0; s < slots.length; s++) {
        const desc = slots[s]!.desc;
        if (desc.thirdPerson || desc.localSlot !== s) continue;
        const c = desc.camera;
        if (cameraInsideBody(c.x, c.y, c.z, pos[k]!, pos[k + 1]!, pos[k + 2]!, sc)) {
          actors.localSlot[n] = s;
          break;
        }
      }
    }
    // fim-quente
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
    // M6 (fase 4b): o Cabeção (a cabeça de todos em dobro) e os Invisíveis (ninguém aparece, só logo depois de atirar).
    actors.headScale = chaosOn(MOD.bigHead) ? CHAOS_MODS.bigHead : 1;
    confettiLeft = CONFETTI_PER_FRAME;
    const invisible = chaosOn(MOD.invisible);
    let n = 0;
    for (let i = 0; i < v.count && n < actors.capacity; i++) {
      hiddenNow[i] = 0;
      // M9 (fase 1b): fora do desenho, a escala desenhada esquece (o próximo desenho começa na da sim, sem crescer).
      const lastScale = shownScale[i]!;
      shownScale[i] = 0;
      if (v.alive[i] !== 1) continue;
      const kind = v.kind[i]!;
      if (kind !== ENTITY_KIND.bobo && kind !== ENTITY_KIND.zombie) continue;
      const flags = v.flags[i]!;
      if (flags & ENTITY_FLAG.dead) continue;
      if (invisible && kind === ENTITY_KIND.bobo && timeS - shotAt[i]! > CHAOS_MODS.invisibleShowS && !localBody(i)) {
        hiddenNow[i] = 1;
        continue;
      }
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
      // M6 (fase 2): o 1º infectado muda de time vivo (sem o evento de spawn): a cara troca aqui. Fase 3: o Jugg também
      // muda de time vivo (quem derruba o Jugg), e a roupa é a do time. M9 (fase 5): o "trocar de time" do dono também.
      if (
        skinLayer[i] === 0xffff ||
        (infection && (v.team[i] === 1) !== (figureOf[i] === infectedFigure)) ||
        ((juggernaut || v.owner !== null) && figureTeam[i] !== v.team[i])
      ) {
        resolveEntityFigure(v, i);
      }
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
      // M3 (fase 3b): Chonker e chefão maiores (a hitbox da sim cresce junto). M9 (fase 1): o Mini e os Bots gigantes
      // (fase 1b: a escala da sim, apertada debaixo de teto, com o desenho andando até ela sem estalo; a Roleta, que
      // troca a escala da máscara e a hitbox inteira de uma vez, pula direto).
      const maskK = chaosMaskScaleOf(v, i);
      const chaosK = approachScale(lastScale, chaosScaleOf(v, i), dt, maskK !== shownMaskScale[i]);
      shownMaskScale[i] = maskK;
      shownScale[i] = chaosK;
      actors.scale[n] = v.bodyScale[i]! * chaosK;
      let expression: number = FACE_EXPRESSION.neutral;
      if (flash[i]! > 0.3) expression = FACE_EXPRESSION.pain;
      else if (zombie) expression = FACE_EXPRESSION.angry;
      else if (flags & ENTITY_FLAG.ads) expression = FACE_EXPRESSION.aiming;
      else if (firing[i]! > 0) expression = FACE_EXPRESSION.angry;
      actors.expression[n] = expression;
      // A luz do meio do corpo; no gigante, a do tamanho normal (dentro de casa, o meio dele fica no teto).
      sampleLightGrid(grid, x, y + ACTOR_LIGHT_Y * Math.min(1, chaosK), z, actors.light, k);
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
    entityActors = n;
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
    // M3 (fase 1d): com 2 jogadores, lado a lado se o Ajuste pedir (a troca no meio da partida refaz o layout).
    const vertical = viewCount === 2 && host.settings.current.video.split2 === 'sideBySide';
    if (layoutVertical !== vertical) layout = null;
    layoutVertical = vertical;
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
      vertical,
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
      // M6 (fase 5): a bola de tinta é um ponto na cor do time de quem atirou (o balde voa com o modelo).
      if (isPaintWeapon(code) && code !== WEAPON_PAINT_BUCKET) {
        const o3 = p * 3;
        // Um salto grande do anterior para o atual é outra bola no mesmo lugar do pool (no amigo online): sem lerp.
        const jx = pv.position[o3]! - pv.prevPosition[o3]!;
        const jy = pv.position[o3 + 1]! - pv.prevPosition[o3 + 1]!;
        const jz = pv.position[o3 + 2]! - pv.prevPosition[o3 + 2]!;
        const a = jx * jx + jy * jy + jz * jz > PAINT_JUMP_M * PAINT_JUMP_M ? 1 : alpha;
        const bx = lerp(pv.prevPosition[o3]!, pv.position[o3]!, a);
        const by = lerp(pv.prevPosition[o3 + 1]!, pv.position[o3 + 1]!, a);
        const bz = lerp(pv.prevPosition[o3 + 2]!, pv.position[o3 + 2]!, a);
        // A bola recém-saída do olho de quem atirou fica escondida até 1,5 m (senão tapa a mira dele), como o foguete.
        const shooter = entityIndex(pv.owner[p]!);
        if (shooter < v.count && v.alive[shooter] === 1) {
          const ox = v.position[shooter * 3]! - bx;
          const oy = v.position[shooter * 3 + 1]! + viewEyeHeight(v, shooter, v.flags[shooter]!) - by;
          const oz = v.position[shooter * 3 + 2]! - bz;
          if (ox * ox + oy * oy + oz * oz < PROJECTILE_HIDE_NEAR_EYE_M * PROJECTILE_HIDE_NEAR_EYE_M) continue;
        }
        pushPaintBall(fx, bx, by, bz, paintColorOf(v, shooter));
        continue;
      }
      // M10 (fase 7): o virote da besta e a granada do lança-granadas (modelos próprios).
      const model =
        code === WEAPON_CODE.rocket
          ? rocketShellModel
          : code === WEAPON_DESMONTADOR
            ? boltModel
            : code === WEAPON_CODE.crossbow
              ? crossbowBoltModel
              : code === WEAPON_CODE.grenadeLauncher
                ? launcherShellModel
                : modelOf(code);
      if (model === NO_MODEL) continue;
      const o = p * 3;
      const x = lerp(pv.prevPosition[o]!, pv.position[o]!, alpha);
      const y = lerp(pv.prevPosition[o + 1]!, pv.position[o + 1]!, alpha);
      const z = lerp(pv.prevPosition[o + 2]!, pv.position[o + 2]!, alpha);
      // Recém-saído do olho de quem lançou: escondido até 1,5 m (senão o fundo do foguete tapa a câmera dele).
      const owner = entityIndex(pv.owner[p]!);
      if (owner < v.count && v.alive[owner] === 1) {
        const ox = v.position[owner * 3]! - x;
        const oy = v.position[owner * 3 + 1]! + viewEyeHeight(v, owner, v.flags[owner]!) - y;
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
      } else if (code === WEAPON_CODE.crossbow) {
        // O virote aponta para onde voa (o arco), sem girar.
        projectiles.pitch[n] = Math.atan2(vy, Math.max(flat, 1e-6));
        projectiles.roll[n] = 0;
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
    n = fillMapObjects(n);
    n = fillFortress(n);
    n = fillBomb(n);
    n = fillStuckBolts(n);
    projectiles.count = n;
  }

  /**
   * M10 (fase 7): os virotes cravados nos blocos (o evento `stick` da sim; só do render, o mundo não muda): ficam
   * `STUCK_BOLT_S` segundos, no máximo `STUCK_BOLT_MAX` (o mais antigo dá lugar), com a ponta na superfície.
   */
  const stuckPos = new Float32Array(STUCK_BOLT_MAX * 3);
  const stuckYaw = new Float32Array(STUCK_BOLT_MAX);
  const stuckPitch = new Float32Array(STUCK_BOLT_MAX);
  const stuckAt = new Float64Array(STUCK_BOLT_MAX).fill(-1e9);
  let stuckNext = 0;
  /** A rodada (BoboStrike, Jugg Fixo) em que os virotes cravaram: na rodada nova o mapa volta ao começo e eles saem. */
  let stuckRound = -1;
  /** Tira todos os virotes cravados (o relógio deles é o `timeS`, que para na pausa: lá eles ficam). */
  function clearStuckBolts(): void {
    stuckAt.fill(-1e9);
    stuckNext = 0;
  }
  function stickBolt(x: number, y: number, z: number, vx: number, vy: number, vz: number): void {
    const speed = Math.hypot(vx, vy, vz);
    if (speed < 1e-6) return;
    const flat = Math.hypot(vx, vz);
    const k = stuckNext;
    stuckNext = (stuckNext + 1) % STUCK_BOLT_MAX;
    // O meio do virote fica para trás da ponta, para fora do bloco.
    stuckPos[k * 3] = x - (vx / speed) * STUCK_BOLT_BACK_M;
    stuckPos[k * 3 + 1] = y - (vy / speed) * STUCK_BOLT_BACK_M;
    stuckPos[k * 3 + 2] = z - (vz / speed) * STUCK_BOLT_BACK_M;
    stuckYaw[k] = flat > 1e-6 ? Math.atan2(-vx, -vz) : 0;
    stuckPitch[k] = Math.atan2(vy, Math.max(flat, 1e-6));
    stuckAt[k] = timeS;
  }
  function fillStuckBolts(first: number): number {
    let n = first;
    const rounds = sim.view().rounds;
    const round = rounds === null ? -1 : rounds.data[ROUND.round]!;
    if (round !== stuckRound) {
      stuckRound = round;
      clearStuckBolts();
    }
    if (crossbowBoltModel === NO_MODEL) return n;
    for (let k = 0; k < STUCK_BOLT_MAX && n < projectiles.capacity; k++) {
      if (timeS - stuckAt[k]! > STUCK_BOLT_S) continue;
      const x = stuckPos[k * 3]!;
      const y = stuckPos[k * 3 + 1]!;
      const z = stuckPos[k * 3 + 2]!;
      projectiles.model[n] = crossbowBoltModel;
      projectiles.position[n * 3] = x;
      projectiles.position[n * 3 + 1] = y;
      projectiles.position[n * 3 + 2] = z;
      projectiles.yaw[n] = stuckYaw[k]!;
      projectiles.pitch[n] = stuckPitch[k]!;
      projectiles.roll[n] = 0;
      sampleLightGrid(loaded.lightGrid, x, y, z, lightScratch, 0);
      projectiles.light[n * 3] = lightScratch[0]!;
      projectiles.light[n * 3 + 1] = lightScratch[1]!;
      projectiles.light[n * 3 + 2] = lightScratch[2]!;
      n++;
    }
    return n;
  }

  /** M6 (fase 6a): o gerador do Fortress (o modelo de prop), no mesmo buffer das caixinhas. */
  const generatorModel = modelIndex.get('generator') ?? NO_MODEL;
  /** M7 (fase 4): a Boom Box no chão (largada ou plantada; com o portador, não aparece). */
  const boomBoxModel = modelIndex.get('boom-box') ?? NO_MODEL;
  function fillBomb(first: number): number {
    const sv = sim.view().strike;
    if (sv === null || boomBoxModel === NO_MODEL || first >= projectiles.capacity) return first;
    const bomb = sv.data[STRIKE_DATA.bomb];
    if (bomb !== BOMB.dropped && bomb !== BOMB.planted && bomb !== BOMB.defused) return first;
    const n = first;
    projectiles.model[n] = boomBoxModel;
    projectiles.position[n * 3] = sv.pos[0]!;
    projectiles.position[n * 3 + 1] = sv.pos[1]!;
    projectiles.position[n * 3 + 2] = sv.pos[2]!;
    projectiles.yaw[n] = 0;
    projectiles.pitch[n] = 0;
    projectiles.roll[n] = 0;
    sampleLightGrid(loaded.lightGrid, sv.pos[0]!, sv.pos[1]! + 0.3, sv.pos[2]!, lightScratch, 0);
    projectiles.light[n * 3] = lightScratch[0]!;
    projectiles.light[n * 3 + 1] = lightScratch[1]!;
    projectiles.light[n * 3 + 2] = lightScratch[2]!;
    return n + 1;
  }
  function fillFortress(first: number): number {
    const f = sim.view().fortress;
    if (f === null || generatorModel === NO_MODEL || first >= projectiles.capacity) return first;
    const n = first;
    projectiles.model[n] = generatorModel;
    projectiles.position[n * 3] = f.x;
    projectiles.position[n * 3 + 1] = f.y;
    projectiles.position[n * 3 + 2] = f.z;
    projectiles.yaw[n] = 0;
    projectiles.pitch[n] = 0;
    projectiles.roll[n] = 0;
    sampleLightGrid(loaded.lightGrid, f.x, f.y + 0.5, f.z, lightScratch, 0);
    projectiles.light[n * 3] = lightScratch[0]!;
    projectiles.light[n * 3 + 1] = lightScratch[1]!;
    projectiles.light[n * 3 + 2] = lightScratch[2]!;
    return n + 1;
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
      let y = lerp(pv.prevPosition[o + 1]!, pv.position[o + 1]!, alpha);
      const z = pv.position[o + 2]!;
      // M3 (fase 4d): os drops do Zombies flutuam, giram mais rápido e brilham (o modelo pelo tipo).
      const kind = pv.kind[i]!;
      // M11 (fase 4): o ponto vazio da arma no mapa: o contorno de giz deitado no chão (pisca nos 3 s antes da volta).
      if (kind >= PICKUP_KIND.spotBase) {
        if (chalkModel === NO_MODEL) continue;
        projectiles.model[n] = chalkModel;
        projectiles.position[n * 3] = x;
        projectiles.position[n * 3 + 1] = y + 0.03;
        projectiles.position[n * 3 + 2] = z;
        projectiles.yaw[n] = i * 1.7;
        projectiles.pitch[n] = -Math.PI / 2;
        projectiles.roll[n] = 0;
        sampleLightGrid(loaded.lightGrid, x, y + 0.3, z, lightScratch, 0);
        projectiles.light[n * 3] = Math.min(1.4, lightScratch[0]! * 1.3 + 0.3);
        projectiles.light[n * 3 + 1] = Math.min(1.4, lightScratch[1]! * 1.3 + 0.3);
        projectiles.light[n * 3 + 2] = Math.min(1.4, lightScratch[2]! * 1.3 + 0.3);
        n++;
        continue;
      }
      const drop = kind !== PICKUP_KIND.ammoBox;
      // M7 (fase 8): os itens do Royale (a arma pelo modelo dela, o colete, o kit); a arma rara e a épica brilham mais.
      const royaleItem = kind >= PICKUP_KIND.armor50;
      const code = pickupWeapon(kind);
      const model = royaleItem
        ? code !== WEAPON_NONE
          ? modelOf(code)
          : kind === PICKUP_KIND.heal
            ? medkitModel
            : armorVestModel
        : drop
          ? (dropModels[kind - 1] ?? NO_MODEL)
          : ammoBoxModel;
      if (model === NO_MODEL) continue;
      if (drop) y += (royaleItem ? 0.3 : 0.55) + Math.sin(timeS * 3 + i) * 0.08;
      projectiles.model[n] = model;
      projectiles.position[n * 3] = x;
      projectiles.position[n * 3 + 1] = y;
      projectiles.position[n * 3 + 2] = z;
      projectiles.yaw[n] = timeS * PICKUP_SPIN_RAD_S * (drop ? 2.5 : 1) + i * 1.7;
      projectiles.pitch[n] = 0;
      projectiles.roll[n] = 0;
      sampleLightGrid(loaded.lightGrid, x, y + 0.2, z, lightScratch, 0);
      const rarity = code !== WEAPON_NONE ? weaponRarity(code) : kind === PICKUP_KIND.armor100 ? 1 : 0;
      const glow = royaleItem ? 0.15 + rarity * 0.3 : drop ? 0.35 : 0;
      // A épica puxa para o roxo; a rara, para o azul (o brilho do "pegue-me").
      projectiles.light[n * 3] = Math.min(1.6, lightScratch[0]! + glow * (rarity === 1 ? 0.5 : 1));
      projectiles.light[n * 3 + 1] = Math.min(1.6, lightScratch[1]! + glow * (rarity >= 1 ? 0.5 : 1));
      projectiles.light[n * 3 + 2] = Math.min(1.6, lightScratch[2]! + glow * (rarity >= 1 ? 1 : 0.6));
      n++;
    }
    return n;
  }

  /**
   * M3 (fase 3d): as tábuas das janelas (uma por fileira de 1 m de vão, de baixo para cima, com a inclinação alternada
   * do cartoon; a de cima some quando o zumbi arranca) e as portas pagas fechadas, no mesmo buffer das caixinhas.
   */
  function fillMapObjects(first: number): number {
    const mo = sim.view().mapObjects;
    let n = first;
    if (mo === null) return n;
    const cap = projectiles.capacity;
    if (plankModel !== NO_MODEL) {
      for (let i = 0; i < mo.barricades; i++) {
        const nx = mo.bnx[i]!;
        const nz = mo.bnz[i]!;
        const across = Math.max(1, Math.round(mo.bhw[i]! * 2));
        for (let k = 0; k < mo.planks[i]! && n < cap; k++) {
          for (let a = 0; a < across && n < cap; a++) {
            const off = a - (across - 1) / 2;
            const x = mo.bx[i]! + (nz !== 0 ? off : 0) + nx * 0.04;
            const y = mo.by[i]! + 0.35 + k * 0.27;
            const z = mo.bz[i]! + (nx !== 0 ? off : 0) + nz * 0.04;
            projectiles.model[n] = plankModel;
            projectiles.position[n * 3] = x;
            projectiles.position[n * 3 + 1] = y;
            projectiles.position[n * 3 + 2] = z;
            projectiles.yaw[n] = nx !== 0 ? Math.PI / 2 : 0;
            projectiles.pitch[n] = 0;
            projectiles.roll[n] = (((i * 5 + k * 3 + a) % 3) - 1) * 0.13;
            sampleLightGrid(loaded.lightGrid, x - nx * 0.3, y, z - nz * 0.3, lightScratch, 0);
            projectiles.light[n * 3] = lightScratch[0]!;
            projectiles.light[n * 3 + 1] = lightScratch[1]!;
            projectiles.light[n * 3 + 2] = lightScratch[2]!;
            n++;
          }
        }
      }
    }
    // M3 (fase 4a): as armas na parede, deitadas na face da parede a 1,3 m do chão (o cano ao longo do muro). Fase 5c:
    // com o contorno de giz atrás, um pouco mais claro que o lugar (lê à noite).
    for (let w = 0; w < mo.wallBuys && n + 1 < cap; w++) {
      const model = modelOf(mo.wbWeapon[w]!);
      if (model === NO_MODEL) continue;
      const nx = mo.wbnx[w]!;
      const nz = mo.wbnz[w]!;
      const x = mo.wbx[w]! + nx * 0.06;
      const y = mo.wby[w]! + 1.3;
      const z = mo.wbz[w]! + nz * 0.06;
      if (chalkModel !== NO_MODEL) {
        sampleLightGrid(loaded.lightGrid, x + nx * 0.4, y, z + nz * 0.4, lightScratch, 0);
        projectiles.model[n] = chalkModel;
        projectiles.position[n * 3] = mo.wbx[w]! + nx * 0.02;
        projectiles.position[n * 3 + 1] = y;
        projectiles.position[n * 3 + 2] = mo.wbz[w]! + nz * 0.02;
        projectiles.yaw[n] = nx !== 0 ? Math.PI / 2 : 0;
        projectiles.pitch[n] = 0;
        projectiles.roll[n] = 0;
        projectiles.light[n * 3] = Math.min(1.4, lightScratch[0]! * 1.3 + 0.3);
        projectiles.light[n * 3 + 1] = Math.min(1.4, lightScratch[1]! * 1.3 + 0.3);
        projectiles.light[n * 3 + 2] = Math.min(1.4, lightScratch[2]! * 1.3 + 0.3);
        n++;
      }
      projectiles.model[n] = model;
      projectiles.position[n * 3] = x;
      projectiles.position[n * 3 + 1] = y;
      projectiles.position[n * 3 + 2] = z;
      projectiles.yaw[n] = nx !== 0 ? 0 : Math.PI / 2;
      projectiles.pitch[n] = 0;
      projectiles.roll[n] = 0;
      sampleLightGrid(loaded.lightGrid, x + nx * 0.4, y, z + nz * 0.4, lightScratch, 0);
      projectiles.light[n * 3] = lightScratch[0]!;
      projectiles.light[n * 3 + 1] = lightScratch[1]!;
      projectiles.light[n * 3 + 2] = lightScratch[2]!;
      n++;
    }
    // M3 (fase 4c): as máquinas de vantagem (a frente para o lado da normal; a caixa fica atrás da frente).
    for (let q = 0; q < mo.machines && n < cap; q++) {
      const model = perkModels[Math.log2(mo.pmPerk[q]!)] ?? NO_MODEL;
      if (model === NO_MODEL) continue;
      const nx = mo.pmnx[q]!;
      const nz = mo.pmnz[q]!;
      const x = mo.pmx[q]! - nx * ZOMBIE_PERKS.depthM * 0.5;
      const y = mo.pmy[q]!;
      const z = mo.pmz[q]! - nz * ZOMBIE_PERKS.depthM * 0.5;
      projectiles.model[n] = model;
      projectiles.position[n * 3] = x;
      projectiles.position[n * 3 + 1] = y;
      projectiles.position[n * 3 + 2] = z;
      projectiles.yaw[n] = Math.atan2(-nx, -nz);
      projectiles.pitch[n] = 0;
      projectiles.roll[n] = 0;
      sampleLightGrid(loaded.lightGrid, mo.pmx[q]! + nx * 0.4, y + 1.2, mo.pmz[q]! + nz * 0.4, lightScratch, 0);
      // A máquina brilha um pouco (tem luz própria, como as do gênero).
      projectiles.light[n * 3] = Math.min(1.5, lightScratch[0]! * 1.2 + 0.15);
      projectiles.light[n * 3 + 1] = Math.min(1.5, lightScratch[1]! * 1.2 + 0.15);
      projectiles.light[n * 3 + 2] = Math.min(1.5, lightScratch[2]! * 1.2 + 0.15);
      n++;
    }
    // M3 (fase 4b): a Caixa Misteriosa na posição ativa e, girando ou oferecendo, a arma flutuando em cima.
    if (boxModel !== NO_MODEL && mo.boxSpots > 0 && n + 1 < cap) {
      const st = mo.boxState;
      const i = st[BOX.active]!;
      const x = mo.boxX[i]!;
      const y = mo.boxY[i]!;
      const z = mo.boxZ[i]!;
      const yaw = mo.boxNx[i] !== 0 ? Math.PI / 2 : 0;
      sampleLightGrid(loaded.lightGrid, x + mo.boxNx[i]! * 0.6, y + 0.5, z + mo.boxNz[i]! * 0.6, lightScratch, 0);
      projectiles.model[n] = boxModel;
      projectiles.position[n * 3] = x;
      projectiles.position[n * 3 + 1] = y;
      projectiles.position[n * 3 + 2] = z;
      projectiles.yaw[n] = yaw;
      projectiles.pitch[n] = 0;
      projectiles.roll[n] = 0;
      // M3 (fase 5c): a caixa tem um brilho próprio (os "?" amarelos leem no escuro), como as máquinas.
      projectiles.light[n * 3] = Math.min(1.5, lightScratch[0]! * 1.2 + 0.25);
      projectiles.light[n * 3 + 1] = Math.min(1.5, lightScratch[1]! * 1.2 + 0.22);
      projectiles.light[n * 3 + 2] = Math.min(1.5, lightScratch[2]! * 1.2 + 0.12);
      n++;
      const phase = st[BOX.phase]!;
      if (phase !== BOX_PHASE.idle) {
        const rollTicks = ZOMBIE_BOX.rollS * sim.hz;
        // Girando: troca de arma a cada 0,12 s e sobe; oferecendo: a sorteada, parada no alto, girando devagar.
        const code =
          phase === BOX_PHASE.rolling ? boxReel[Math.floor(timeS / 0.12) % boxReel.length]! : st[BOX.weapon]!;
        const rise = phase === BOX_PHASE.rolling ? 1 - st[BOX.ticks]! / rollTicks : 1;
        const model = modelOf(code);
        if (model !== NO_MODEL) {
          projectiles.model[n] = model;
          projectiles.position[n * 3] = x;
          projectiles.position[n * 3 + 1] = y + 0.7 + rise * 0.35;
          projectiles.position[n * 3 + 2] = z;
          projectiles.yaw[n] =
            phase === BOX_PHASE.offering ? yaw + Math.PI / 2 + Math.sin(timeS * 1.5) * 0.4 : yaw + Math.PI / 2;
          projectiles.pitch[n] = 0;
          projectiles.roll[n] = 0;
          // A arma brilha um pouco (leitura de "pegue-me" no escuro).
          projectiles.light[n * 3] = Math.min(1.5, lightScratch[0]! * 1.4 + 0.2);
          projectiles.light[n * 3 + 1] = Math.min(1.5, lightScratch[1]! * 1.4 + 0.2);
          projectiles.light[n * 3 + 2] = Math.min(1.5, lightScratch[2]! * 1.4 + 0.2);
          n++;
        }
      }
    }
    if (doorModel !== NO_MODEL) {
      for (let d = 0; d < mo.doors && n < cap; d++) {
        if (mo.doorOpen[d] === 1) continue;
        const o = d * 6;
        const wx = mo.doorBox[o + 3]! - mo.doorBox[o]!;
        const wz = mo.doorBox[o + 5]! - mo.doorBox[o + 2]!;
        const alongX = wx >= wz;
        const count = Math.max(1, Math.round(alongX ? wx : wz));
        const cx = (mo.doorBox[o]! + mo.doorBox[o + 3]!) / 2;
        const cz = (mo.doorBox[o + 2]! + mo.doorBox[o + 5]!) / 2;
        for (let a = 0; a < count && n < cap; a++) {
          const off = a - (count - 1) / 2;
          const x = cx + (alongX ? off : 0);
          const y = mo.doorBox[o + 1]!;
          const z = cz + (alongX ? 0 : off);
          projectiles.model[n] = doorModel;
          projectiles.position[n * 3] = x;
          projectiles.position[n * 3 + 1] = y;
          projectiles.position[n * 3 + 2] = z;
          projectiles.yaw[n] = alongX ? 0 : Math.PI / 2;
          projectiles.pitch[n] = 0;
          projectiles.roll[n] = 0;
          sampleLightGrid(loaded.lightGrid, x, y + 1, z, lightScratch, 0);
          projectiles.light[n * 3] = lightScratch[0]!;
          projectiles.light[n * 3 + 1] = lightScratch[1]!;
          projectiles.light[n * 3 + 2] = lightScratch[2]!;
          n++;
        }
      }
    }
    return n;
  }

  /** Nome e cor de um bobo no feed e no placar: o nome do controlador; a cor do time (TDM) ou a sua (FFA). */
  function nameOf(v: SimView, i: number): string {
    return v.kind[i] === ENTITY_KIND.zombie ? deathTx.zombie : (names[v.controller[i]!] ?? deathTx.zombie);
  }
  function colorOf(v: SimView, i: number): number {
    if (!ffa && !royaleMode && v.kind[i] !== ENTITY_KIND.zombie) return teamColors[v.team[i]!] ?? COLORS.texto;
    return v.controller[i] === me && humans > 0 ? (PLAYER_COLORS[0] as number) : COLORS.texto;
  }

  /** M2 (fase 2d): uma morte no kill feed ("Normal Bob  Rattler  P1"; sem matador, "P1  Caiu no vazio"). */
  function feedKill(v: SimView, victim: number, killer: number, weapon: number, headshot: boolean): void {
    if (!showKillFeed) return;
    const vi = entityIndex(victim);
    if (vi >= v.count) return;
    const ki = entityIndex(killer);
    if (killer === NULL_ENTITY || killer === victim || ki >= v.count) {
      const cause =
        killer === victim
          ? deathTx.self
          : weapon === WEAPON_KILL_PLANE
            ? deathTx.void
            : weapon === WEAPON_ZONE
              ? deathTx.zone
              : deathTx.fall;
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

  /** M6 (fase 1): os textos do Domination no kill feed (resolvidos uma vez: o evento não cria string). */
  const pointFeed = {
    // M9 (fase 3): o nome que a receita deu ao time (ou o da cor).
    teams: recipe.teams.map((_tm, i) => teamName(recipe, i)),
    captured: t('feed.pointCaptured'),
    lost: t('feed.pointLost'),
    points: [...t('hud.pointLetters')].map((letter) => t('feed.point', { letter })),
  };
  /** M6 (fase 5): a cor da tinta de quem atirou (a do time; sem time, a do Laranja). */
  function paintColorOf(v: SimView, owner: number): number {
    const team = owner >= 0 && owner < v.count ? v.team[owner]! : 0;
    return (teamColors[team] ?? teamColors[0]!) >>> 8;
  }
  /** O teto de manchas da plataforma (U6: 96 no PC, 48 no celular, 32 no Switch). */
  const paintCap = profile.family === 'switch' ? 32 : profile.family === 'mobile' ? 48 : 96;
  const paintNormal = new Float32Array(3);
  /**
   * A normal da superfície onde a tinta bateu: a explosão da bola fica 5 cm para fora dela, então o bloco vizinho
   * sólido mais perto diz a face (o chão primeiro). Sem bloco por perto (no ar, num bobo ou numa prop), `false`.
   */
  function surfaceNormal(v: SimView, x: number, y: number, z: number): boolean {
    for (let k = 0; k < PAINT_PROBES.length; k += 3) {
      const dx = PAINT_PROBES[k]!;
      const dy = PAINT_PROBES[k + 1]!;
      const dz = PAINT_PROBES[k + 2]!;
      const cx = Math.floor((x + dx * PAINT_PROBE_M) * CELLS_PER_METER);
      const cy = Math.floor((y + dy * PAINT_PROBE_M) * CELLS_PER_METER);
      const cz = Math.floor((z + dz * PAINT_PROBE_M) * CELLS_PER_METER);
      if (cx < 0 || cz < 0 || cx >= v.world.sizeX || cz >= v.world.sizeZ) return false;
      if (isCellSolid(v.world, v.blocks, cx, cy, cz)) {
        paintNormal[0] = -dx;
        paintNormal[1] = -dy;
        paintNormal[2] = -dz;
        return true;
      }
    }
    return false;
  }
  /** A tinta que estourou: a mancha (bola pequena, balde grande) e o respingo. */
  function paintSplat(v: SimView, x: number, y: number, z: number, owner: number, radius: number): void {
    const color = paintColorOf(v, owner);
    if (surfaceNormal(v, x, y, z)) {
      pushPaint(
        fx,
        x - paintNormal[0]! * 0.04,
        y - paintNormal[1]! * 0.04,
        z - paintNormal[2]! * 0.04,
        paintNormal[0]!,
        paintNormal[1]!,
        paintNormal[2]!,
        color,
        radius > 0 ? PAINT_BUCKET_SPLAT_M : PAINT_BALL_SPLAT_M,
        paintCap,
      );
    }
    pushDebris(fx, x, y, z, 0, 1.5, 0, color, radius > 0 ? 14 : 5, radius > 0 ? 3 : 1.6);
  }
  /** M6 (fase 6a): o rótulo da plaquinha do gerador. */
  const generatorLabel = t('hud.generator' as StringKey).toUpperCase();
  // M7 (fase 4): os textos do BoboStrike e a loja (os nomes e os preços, prontos).
  const sk = (key: string): string => t(key as StringKey);
  const strikeTx = {
    money: sk('hud.strike.money'),
    plant: sk('hud.strike.plant').toUpperCase(),
    defuse: sk('hud.strike.defuse').toUpperCase(),
    planting: sk('hud.strike.planting').toUpperCase(),
    defusing: sk('hud.strike.defusing').toUpperCase(),
    wait: sk('hud.strike.waitRound').toUpperCase(),
    bomb: sk('hud.strike.bomb').toUpperCase(),
  };
  const strikeItems = STRIKE_SHOP.map((it) => sk(`strike.item.${it.id}`));
  /** M9 (fase 3): morto na eliminação do Sandbox (no lugar do "Renascendo"). */
  const sandboxOutText = sk('hud.sandbox.out').toUpperCase();
  // M7 (fase 8): os textos do Bobo Royale.
  const royaleTx = {
    kits: sk('hud.royale.kits').toUpperCase(),
    armor50: t('hud.royale.armorKits' as StringKey, { armor: 50 }).toUpperCase(),
    armor100: t('hud.royale.armorKits' as StringKey, { armor: 100 }).toUpperCase(),
    healing: sk('hud.royale.healing').toUpperCase(),
    zone: sk('hud.royale.zone').toUpperCase(),
    spectate: sk('hud.royale.spectate').toUpperCase(),
  };
  const strikePrices = STRIKE_SHOP.map((it) => `$${moneyText(it.price)}`);

  /** M6 (fase 4b): o modificador está ligado agora (pela máscara que a view mostra)? */
  function chaosOn(bit: number): boolean {
    const c = sim.view().chaos;
    return c !== null && (c.masks[0]! & bit) !== 0;
  }
  /** M6 (fase 4b): as cores do confete da Festa (as do "poof" da morte) e a próxima a sair. */
  const CONFETTI_COLORS = [0xff7a1a, 0x2e8bff, 0x3ddc97, 0xa66bff, 0xffd23f, 0xff6fb5, 0xffffff] as const;
  let confettiNext = 0;
  /** Pedidos de confete que ainda cabem neste quadro (a Big Brrt são 20 tiros por segundo). */
  let confettiLeft = CONFETTI_PER_FRAME;
  /** O próprio corpo de um jogador local (em 3ª pessoa e no sofá ele não some para ninguém da tela). */
  function localBody(i: number): boolean {
    for (let sIdx = 0; sIdx < slots.length; sIdx++) {
      const c = slots[sIdx]!.controller;
      if (c >= 0 && entityIndex(sim.controllerEntity(c)) === i) return true;
    }
    return false;
  }
  function confetti(x: number, y: number, z: number): void {
    if (confettiLeft <= 0) return;
    confettiLeft--;
    for (let k = 0; k < 2; k++) {
      const color = CONFETTI_COLORS[confettiNext++ % CONFETTI_COLORS.length]!;
      pushDebris(fx, x, y, z, 0, 2.5, 0, color, 4, 2.2);
    }
  }
  /** M6 (fase 4): os nomes dos modificadores (pelo bit) e a chave da última linha montada. */
  const modNames = MODIFIERS.map((id) => t(`mod.${id}` as StringKey).toUpperCase());
  /**
   * M10 (fase 4): no mapa com a gravidade da Lua de série (a Estação Lunar), "LUA" fica fixa na linha dos modificadores
   * em todo modo (é assim que o jogador sabe por que pula tão alto); a Roleta nunca a sorteia lá.
   */
  const lunarMap = (loaded.simMap.gravity ?? 1) <= CHAOS_MODS.lowGravity;
  const lunarName = modNames[MODIFIERS.indexOf('lowGravity')]!;
  if (lunarMap) sharedHud.modsLine = lunarName;
  let modsKey = -1;
  /** Remonta a linha dos modificadores só quando a máscara (ou o aviso) muda. */
  function refreshModsLine(masks: Int32Array): void {
    const active = masks[0]!;
    const next = masks[1]!;
    const key = active * 65536 + next;
    if (key === modsKey) return;
    modsKey = key;
    const nameOf = (mask: number): string => {
      for (let i = 0; i < modNames.length; i++) if ((mask & (1 << i)) !== 0) return modNames[i]!;
      return '';
    };
    if (next !== active) {
      sharedHud.modsLine = t('hud.chaosSwap' as StringKey, {
        out: nameOf(active & ~next),
        in: nameOf(next & ~active),
      }).toUpperCase();
      sharedHud.modsWarn = true;
      return;
    }
    const names: string[] = [];
    if (lunarMap && (active & MOD.lowGravity) === 0) names.push(lunarName);
    for (let i = 0; i < modNames.length; i++) if ((active & (1 << i)) !== 0) names.push(modNames[i]!);
    sharedHud.modsLine = names.join(' · ');
    sharedHud.modsWarn = false;
  }
  /** M6 (fase 3): o Jugg vivo agora (índice), ou -1. */
  function juggIndex(v: SimView): number {
    for (let i = 0; i < v.count; i++) {
      if (
        v.alive[i] === 1 &&
        v.kind[i] === ENTITY_KIND.bobo &&
        v.team[i] === 1 &&
        (v.flags[i]! & ENTITY_FLAG.dead) === 0
      )
        return i;
    }
    return -1;
  }
  /** M6 (fase 3): quantos caçam o Jugg (a conta da vida dele, a mesma da sim). */
  function huntersOf(v: SimView): number {
    let n = 0;
    for (let i = 0; i < v.count; i++) if (v.alive[i] === 1 && v.kind[i] === ENTITY_KIND.bobo && v.team[i] !== 1) n++;
    return n;
  }
  /** O Jugg da última olhada (para o kill feed avisar quando ele muda). */
  let lastJugg = -1;
  const juggFeed = { is: t('feed.juggIs' as StringKey), jugg: t('feed.jugg' as StringKey) };
  /** M6 (fase 3): "Fulano  virou o  Jugg". */
  function feedJugg(v: SimView, j: number): void {
    if (!showKillFeed) return;
    pushKillFeed(killFeed, nameOf(v, j), teamColors[1] ?? COLORS.texto, juggFeed.is, juggFeed.jugg, COLORS.acao, false);
  }
  /** M6 (fase 1): um ponto do Domination mudou de dono ("Laranja  capturou  Ponto B"). */
  function feedPoint(index: number, team: number, captured: boolean): void {
    if (!showKillFeed) return;
    const color = teamColors[team] ?? COLORS.texto;
    pushKillFeed(
      killFeed,
      pointFeed.teams[team] ?? '',
      color,
      captured ? pointFeed.captured : pointFeed.lost,
      pointFeed.points[index] ?? '',
      COLORS.acao,
      false,
    );
  }

  /** M2 (fase 2d): preenche o placar do Tab (bobos por abates, depois menos mortes; ordenação sem alocar). */
  function fillScoreboard(v: SimView): void {
    let n = 0;
    for (let i = 0; i < v.count && n < SCOREBOARD_MAX_ROWS; i++) {
      if (v.alive[i] !== 1 || v.kind[i] !== ENTITY_KIND.bobo) continue;
      if (hordeArmed && v.team[i] === 1) continue;
      // M9 (fase 5): os bots fora de jogo pelo dono (a reserva, os tirados) não estão na partida.
      if (ownerHidden(v, i)) continue;
      let k = n++;
      while (k > 0) {
        const p = scoreOrder[k - 1]!;
        // M6 (fase 3): no Juggernaut a ordem é a dos pontos de Jugg (depois os abates).
        const pi = juggernaut ? v.points[i]! - v.points[p]! : 0;
        const better =
          pi > 0 ||
          (pi === 0 && (v.kills[i]! > v.kills[p]! || (v.kills[i] === v.kills[p] && v.deaths[i]! < v.deaths[p]!)));
        if (!better) break;
        scoreOrder[k] = p;
        k--;
      }
      scoreOrder[k] = i;
    }
    scoreboard.rowCount = n;
    refreshDirectorNote();
    scoreboard.teamCount = solo ? 0 : hordeArmed ? 1 : recipe.teams.length;
    for (let tIdx = 0; tIdx < scoreboard.teamScores.length; tIdx++)
      scoreboard.teamScores[tIdx] = v.match.teamScore[tIdx] ?? 0;
    const human = humans > 0 ? entityIndex(sim.controllerEntity(me)) : aquarium ? aqFollowed() : -1;
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
    const human = humans > 0 ? s.controllerEntity(me) : NULL_ENTITY;
    if (human !== NULL_ENTITY && killer === human && victim !== human) deathsWithoutKill = 0;
    // M7 (fase 9): no Aquário, quem matou o bobo seguido (a câmera passa para ele depois da câmera de morte).
    if (aquarium && slots[0]!.controller >= 0 && s.controllerEntity(slots[0]!.controller) === victim) aqKiller = killer;
    for (let sIdx = 0; sIdx < slots.length; sIdx++) {
      const slot = slots[sIdx]!;
      if (slot.controller < 0 || s.controllerEntity(slot.controller) !== victim) continue;
      const c = slot.desc.camera;
      beginDeath(slot.death, victim, killer, weapon, c.yaw, c.pitch);
      if (victim !== human || slot.controller !== me) continue;
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
      const seat = humans > 0 ? seatOf(slots[sIdx]!.controller) : -1;
      if (seat < 0 || paused) continue;
      const m = seat === 0 ? player : extras[seat - 1]!;
      // M9 (fase 3b): na eliminação não há próxima vida; e o radial só anda nas armas que o time pode pegar.
      if (sandboxElimination) continue;
      const ent = sim.controllerEntity(slots[sIdx]!.controller);
      const choices = teamChoices[choicesOf(ent === NULL_ENTITY ? 0 : sim.view().team[entityIndex(ent)]!)]!;
      const n = choices.length;
      if (n <= 1) continue;
      const current = Math.max(0, choices.indexOf(seatPrimary[seatNum[seat]!]!));
      const hit = slots[sIdx]!.model.primaryHit;
      let pick = -1;
      // O formato é o que a HUD desenhou no quadro anterior: anel pela direção; fileira e linha passo a passo.
      if (hit.layout === PRIMARY_LAYOUT.ring) {
        moveRadialCursor(st, wrapAngle(m.yaw), m.pitch);
        pick = ringPick(hit, st.cursorX, st.cursorY, n);
      } else {
        const step = stepCursor(st, wrapAngle(m.yaw));
        if (step !== 0) pick = (current + step + n) % n;
      }
      m.setAngles(0, 0);
      if (m.wasPressed('nextWeapon')) pick = (current + 1) % n;
      if (m.wasPressed('prevWeapon')) pick = (current + n - 1) % n;
      if (seat === 0 && device === 'touch') {
        for (let k = 0; k < raw.touches.length; k++) {
          const touch = raw.touches[k]!;
          if (!touch.active) continue;
          const tapped = hitPrimaryOption(hit, touch.x, touch.y);
          if (tapped >= 0) pick = tapped;
        }
      }
      if (pick >= 0 && pick !== current) {
        seatPrimary[seatNum[seat]!] = choices[pick]!;
        m.setPrimary(PRIMARY_ORDER[choices[pick]!]! + 1);
      }
    }
  }

  /**
   * M7 (fase 4): o HUD do BoboStrike desta vista: plantar (o portador no site) e desarmar (o defensor perto da bomba
   * plantada) embaixo da mira; a plaquinha do meio enquanto planta ou desarma; o anel da compra (o humano vivo, na
   * compra).
   */
  function fillStrikeHud(m: HudModel, v: SimView, e: number, slot: ViewSlot): void {
    const sv = v.strike;
    const rv = v.rounds;
    if (sv === null || rv === null || m.dead) return;
    const d = sv.data;
    const me = (v.generation[e]! * 65536 + e) >>> 0;
    const phase = rv.data[ROUND.phase];
    const atk = rv.data[ROUND.swapped] === 1 ? 1 : 0;
    // A contagem antes da 1ª rodada também é a fase 0 (a compra): o anel só com a rodada valendo.
    if (phase === ROUND_PHASE.buy && rv.data[ROUND.round]! > 0 && humans > 0 && seatOf(slot.controller) >= 0) {
      const money = v.points[e]!;
      if (money !== slot.buyMoney) {
        slot.buyMoney = money;
        slot.buyTitle = t('hud.strike.buyTitle' as StringKey, { money: moneyText(money) }).toUpperCase();
      }
      m.buyTitle = slot.buyTitle;
      return;
    }
    if (phase !== ROUND_PHASE.live) return;
    const x = v.position[e * 3]!;
    const y = v.position[e * 3 + 1]!;
    const z = v.position[e * 3 + 2]!;
    if (d[STRIKE_DATA.planter]! >>> 0 === me && d[STRIKE_DATA.plantTicks]! > 0) {
      m.centerLabel = strikeTx.planting;
      m.centerValue = (STRIKE.plantS * sim.hz - d[STRIKE_DATA.plantTicks]!) / sim.hz;
      return;
    }
    if (d[STRIKE_DATA.defuser]! >>> 0 === me && d[STRIKE_DATA.defuseTicks]! > 0) {
      const need = (v.kit[e] === 1 ? STRIKE.kitDefuseS : STRIKE.defuseS) * sim.hz;
      m.centerLabel = strikeTx.defusing;
      m.centerValue = (need - d[STRIKE_DATA.defuseTicks]!) / sim.hz;
      return;
    }
    const bomb = d[STRIKE_DATA.bomb];
    if (bomb === BOMB.carried && d[STRIKE_DATA.carrier]! >>> 0 === me) {
      for (const site of sv.sites) {
        const dx = x - site.x;
        const dz = z - site.z;
        if (dx * dx + dz * dz <= site.radius * site.radius && Math.abs(y - site.y) < 2) {
          m.interact = HUD_INTERACT.text;
          m.interactName = strikeTx.plant;
        }
      }
    } else if (bomb === BOMB.planted && v.team[e] !== atk) {
      const dx = x - sv.pos[0]!;
      const dy = y - sv.pos[1]!;
      const dz = z - sv.pos[2]!;
      if (dx * dx + dy * dy + dz * dz <= STRIKE.defuseReachM * STRIKE.defuseReachM) {
        m.interact = HUD_INTERACT.text;
        m.interactName = strikeTx.defuse;
      }
    }
  }

  /**
   * M7 (fase 8): o HUD do Royale desta vista: o colete e os kits no lugar dos pontos; a troca de arma embaixo da mira
   * (com a arma do chão ao alcance); a cura em curso na plaquinha do meio; fora da zona (ou com ela para fechar), a
   * marca da zona na borda da tela; morto, a colocação.
   */
  function fillRoyaleHud(m: HudModel, v: SimView, e: number, slot: ViewSlot): void {
    const rv = v.royale;
    if (rv === null) return;
    // O colete se gasta (o do BoboStrike): o valor que sobra, montado só quando muda.
    const armor = v.armor[e]!;
    if (armor !== slot.royaleArmor) {
      slot.royaleArmor = armor;
      slot.royaleArmorText =
        armor > 0 ? t('hud.royale.armorKits' as StringKey, { armor }).toUpperCase() : royaleTx.kits;
    }
    m.points = v.heals[e]!;
    m.pointsLabel = slot.royaleArmorText;
    if (m.dead) {
      const place = rv.place[v.team[e]!] ?? 0;
      if (place !== slot.royalePlace) {
        slot.royalePlace = place;
        // Com o esquadrão ainda vivo (o colega de pé), assiste ele; fora, a colocação.
        slot.royaleOut = place > 0 ? t('hud.royale.out' as StringKey, { place }).toUpperCase() : royaleTx.spectate;
      }
      m.waitText = slot.royaleOut;
      return;
    }
    if (v.healTicks[e]! > 0) {
      m.centerLabel = royaleTx.healing;
      m.centerValue = (ROYALE_HEAL_S * sim.hz - v.healTicks[e]!) / sim.hz;
    }
    // A troca: a arma do chão que a sim trocaria pelo usar (com a primária ocupada).
    if (
      v.loadout[e * WEAPON_SLOT_COUNT + WEAPON_SLOT.primary] !== WEAPON_NONE &&
      (v.flags[e]! & ENTITY_FLAG.downed) === 0 &&
      v.cookTicks[e]! < 0
    ) {
      const code = swapWeaponNear(v, e);
      if (code !== WEAPON_NONE) {
        if (code !== slot.royaleSwapCode) {
          slot.royaleSwapCode = code;
          slot.royaleSwapText = t('hud.royale.swap' as StringKey, { name: weaponNames[code] ?? '' }).toUpperCase();
        }
        m.interact = HUD_INTERACT.text;
        m.interactName = slot.royaleSwapText;
      }
    }
  }

  /**
   * M11 (fase 4): a dica da troca das armas no mapa: a arma do chão ao alcance, outra que a primária de agora (a igual
   * entra passando por cima) e que ele pode ter (a regra de armas; o Jugg não pega), como a troca do Royale.
   */
  function fillMapWeaponHud(m: HudModel, v: SimView, e: number, slot: ViewSlot): void {
    const primary = v.loadout[e * WEAPON_SLOT_COUNT + WEAPON_SLOT.primary]!;
    if (primary === WEAPON_NONE || v.cookTicks[e]! >= 0 || (juggernaut && v.team[e] === 1)) return;
    const code = swapWeaponNear(v, e);
    const mask = v.weaponMask[e]!;
    if (code === WEAPON_NONE || code === primary || (mask !== 0 && (mask & weaponMaskBit(code)) === 0)) return;
    if (code !== slot.royaleSwapCode) {
      slot.royaleSwapCode = code;
      slot.royaleSwapText = t('hud.royale.swap' as StringKey, { name: weaponNames[code] ?? '' }).toUpperCase();
    }
    m.interact = HUD_INTERACT.text;
    m.interactName = slot.royaleSwapText;
  }

  /** M7 (fase 8): a arma do chão que a sim trocaria agora pelo usar de `e` (a mais perto ao alcance), ou nenhuma. */
  function swapWeaponNear(v: SimView, e: number): number {
    const p = v.pickups;
    let best = WEAPON_NONE;
    let bestD = ROYALE_SWAP_REACH_M * ROYALE_SWAP_REACH_M;
    for (let i = 0; i < p.count; i++) {
      if (p.alive[i] !== 1) continue;
      const code = pickupWeapon(p.kind[i]!);
      if (code === WEAPON_NONE) continue;
      const dx = p.position[i * 3]! - v.position[e * 3]!;
      const dy = p.position[i * 3 + 1]! - v.position[e * 3 + 1]!;
      const dz = p.position[i * 3 + 2]! - v.position[e * 3 + 2]!;
      const d = dx * dx + dz * dz;
      if (d <= bestD && dy > -0.6 && dy < 1.8) {
        bestD = d;
        best = code;
      }
    }
    return best;
  }

  /** M7 (fase 8, revisão): o esquadrão de todo humano local já tem colocação (está fora ou venceu). */
  function royaleLocalsOut(): boolean {
    const v = sim.view();
    const rv = v.royale;
    if (rv === null) return false;
    for (let p = 0; p < humans; p++) {
      const h = entityIndex(sim.controllerEntity(p));
      if (h >= v.count || (rv.place[v.team[h]!] ?? 0) === 0) return false;
    }
    return true;
  }

  /** M7 (fase 8): no Royale, os vivos e a zona (o relógio é o da espera ou do encolher). */
  const royaleLineKey = new Int32Array(3).fill(-2);
  function refreshRoyaleLine(): void {
    const v = sim.view();
    const rv = v.royale!;
    const d = rv.data;
    const stage = d[ZONE.stage]!;
    sharedHud.trainingLine = '';
    sharedHud.timeLeftS = stage < rv.zone.length ? d[ZONE.ticks]! / sim.hz : -1;
    let alive = 0;
    for (let i = 0; i < v.count; i++) {
      if (v.alive[i] === 1 && v.kind[i] === ENTITY_KIND.bobo && (v.flags[i]! & ENTITY_FLAG.dead) === 0) alive++;
    }
    const state = stage >= rv.zone.length ? 2 : d[ZONE.shrinking]!;
    // O aviso: a zona fechando, ou o jogador (o 1º humano) fora dela.
    const h = humans > 0 ? entityIndex(sim.controllerEntity(me)) : -1;
    let outside = false;
    if (h >= 0 && h < v.count && (v.flags[h]! & ENTITY_FLAG.dead) === 0) {
      const c = rv.circle;
      const dx = v.position[h * 3]! - c[CIRCLE.cx]!;
      const dz = v.position[h * 3 + 2]! - c[CIRCLE.cz]!;
      outside = dx * dx + dz * dz >= c[CIRCLE.r]! * c[CIRCLE.r]!;
    }
    sharedHud.modsWarn = state === 1 || outside;
    const k = royaleLineKey;
    if (k[0] === alive && k[1] === state && k[2] === stage) return;
    k[0] = alive;
    k[1] = state;
    k[2] = stage;
    const key = state === 2 ? 'hud.royale.closed' : state === 1 ? 'hud.royale.shrink' : 'hud.royale.wait';
    sharedHud.modsLine = t(key as StringKey, { alive, stage: stage + 1, stages: rv.zone.length }).toUpperCase();
  }

  // --- M8 (fase 6): as ordens aos bots aliados (gameplay.md §6.10) ---
  /** A ordem que vai no quadro de cada assento e por quantos ticks ainda (a sim e a IA agem na borda). */
  const seatOrder = new Uint8Array(4);
  const seatOrderTicks = new Uint8Array(4);
  /** Os ticks com a ordem no quadro (a rede pode perder um; a borda só conta uma vez). */
  const ORDER_HOLD_TICKS = 6;
  /** Quanto tempo o aviso da resposta fica na tela (s). */
  const ORDER_NOTICE_S = 2.5;
  const ordersTitle = t('orders.title').toUpperCase();
  const orderNames = ORDER_WHEEL.map(orderName);
  const orderHints = ORDER_WHEEL.map((o) =>
    t((o === 4 && reviveOrders ? 'order.hint.4.revive' : `order.hint.${o}`) as StringKey),
  );
  /**
   * M8 (fase 6, revisão): com a roda aberta e enquanto a ordem sai, o quadro leva a mira da abertura (o giro do quadro
   * move só o cursor: o boneco não treme para os outros, o tiro não sai torto e o Ataca ali cai onde a mira estava).
   */
  const seatLock = new Uint8Array(4);
  const seatLockYaw = new Float64Array(4);
  const seatLockPitch = new Float64Array(4);
  function writeOrder(seat: number, out: InputFrame): void {
    const sending = seatOrderTicks[seat]! > 0;
    if (seatLock[seat] === 1 || sending) {
      out.yaw = yawToU16(seatLockYaw[seat]!);
      out.pitch = pitchToI16(seatLockPitch[seat]!);
    }
    if (!sending) return;
    out.buttons = withOrder(out.buttons, seatOrder[seat]!);
    seatOrderTicks[seat] = seatOrderTicks[seat]! - 1;
  }
  function closeOrders(slot: ViewSlot): void {
    slot.orderOpen = false;
    slot.orderPick = -1;
    slot.tapId = -1;
    const seat = seatOf(slot.controller);
    if (seat >= 0) seatLock[seat] = 0;
  }
  function sendOrder(slot: ViewSlot, seat: number, pick: number): void {
    const o = ORDER_WHEEL[pick]!;
    seatOrder[seat] = o;
    seatOrderTicks[seat] = ORDER_HOLD_TICKS;
    host.log(`[partida] ordem do P${seat + 1}: ${orderName(o)}`);
    // No cliente online os bots são do host: a resposta não chega, então o aviso só confirma a ordem.
    if (driver.director === null) {
      slot.orderNotice = t('order.sent', { order: orderName(o) });
      slot.orderNoticeS = ORDER_NOTICE_S;
    }
  }
  /** A resposta da última ordem (o diretor dos bots conta quem ouviu e quem obedeceu; no cliente online, nada). */
  function pollOrderAnswer(slot: ViewSlot): void {
    const a = driver.director?.orderAnswer(slot.controller) ?? null;
    if (a === null || a.tick === slot.orderAnswerTick) return;
    slot.orderAnswerTick = a.tick;
    const order = orderName(a.order);
    slot.orderNotice = a.nowhere
      ? t('order.answer.nowhere', { order })
      : a.asked === 0
        ? t('order.answer.none', { order })
        : a.obeyed === 0
          ? t('order.answer.ignored', { order })
          : t('order.answer', { order, n: a.obeyed, asked: a.asked });
    slot.orderNoticeS = ORDER_NOTICE_S;
  }
  /**
   * A roda de cada humano vivo. Segurando o aviso, ela abre: a câmera fica na mira da abertura e o giro move o cursor
   * (como no anel da compra); soltando com uma ordem apontada, a ordem vai no quadro. No toque, o botão Ordens abre e
   * fecha, e tocar numa ordem manda. Fora dos times (FFA, Juggernaut), na compra do BoboStrike e na pausa, fechada.
   */
  function updateOrders(raw: RawInputState, dt: number): void {
    const v = sim.view();
    for (let sIdx = 0; sIdx < slots.length; sIdx++) {
      const slot = slots[sIdx]!;
      if (slot.orderNoticeS > 0) slot.orderNoticeS = Math.max(0, slot.orderNoticeS - dt);
      const seat = seatOf(slot.controller);
      if (seat < 0) continue;
      pollOrderAnswer(slot);
      const m = seat === 0 ? player : extras[seat - 1]!;
      const e = entityIndex(sim.controllerEntity(slot.controller));
      const alive = e >= 0 && e < v.count && (v.flags[e]! & ENTITY_FLAG.dead) === 0;
      const touchSeat = seat === 0 && device === 'touch';
      if (solo || !alive || slot.buyOpen || paused) {
        if (slot.orderOpen) closeOrders(slot);
        continue;
      }
      if (!slot.orderOpen) {
        if (!(touchSeat ? m.wasPressed('orders') : m.isDown('orders'))) continue;
        slot.orderOpen = true;
        slot.orderYaw = m.yaw;
        slot.orderPitch = m.pitch;
        seatLock[seat] = 1;
        seatLockYaw[seat] = m.yaw;
        seatLockPitch[seat] = m.pitch;
        slot.order.cursorX = 0;
        slot.order.cursorY = 0;
        slot.orderPick = -1;
        slot.tapId = -1;
        continue;
      }
      if (touchSeat) {
        if (m.wasPressed('orders')) {
          closeOrders(slot);
          continue;
        }
        // Só o toque curto que começa e termina na mesma ordem (arrastar o dedo não manda).
        const hit = slot.model.primaryHit;
        let still = false;
        let pick = -1;
        for (let k = 0; k < raw.touches.length; k++) {
          const touch = raw.touches[k]!;
          if (!touch.active) continue;
          if (slot.tapId < 0) {
            const at = hitPrimaryOption(hit, touch.startX, touch.startY);
            if (at >= 0) {
              slot.tapId = touch.id;
              slot.tapOpt = at;
            }
          }
          if (touch.id === slot.tapId) {
            still = true;
            slot.tapNow = hitPrimaryOption(hit, touch.x, touch.y);
          }
        }
        if (slot.tapId >= 0 && !still) {
          if (slot.tapNow === slot.tapOpt) pick = slot.tapOpt;
          slot.tapId = -1;
        }
        if (pick >= 0) {
          sendOrder(slot, seat, pick);
          closeOrders(slot);
        }
        continue;
      }
      const dyaw = wrapAngle(m.yaw - slot.orderYaw);
      const dpitch = m.pitch - slot.orderPitch;
      m.setAngles(slot.orderYaw, slot.orderPitch);
      if (dyaw !== 0 || dpitch !== 0) {
        moveRadialCursor(slot.order, dyaw, dpitch);
        const aimed = radialIndex(slot.order.cursorX, slot.order.cursorY, ORDER_WHEEL.length);
        if (aimed >= 0) slot.orderPick = aimed;
      }
      if (!m.isDown('orders')) {
        if (slot.orderPick >= 0) sendOrder(slot, seat, slot.orderPick);
        closeOrders(slot);
      }
    }
  }

  /**
   * M7 (fase 4): o anel da compra de cada humano vivo, na compra: o giro de mira move o cursor (como o radial da morte),
   * o tiro compra a opção apontada (no toque, tocar nela compra). O pedido vai no `InputFrame.primary` e a sim compra
   * na borda: fora da compra o quadro volta a 0. A mão do mapeador acompanha a da sim (a arma comprada).
   */
  function updateBuys(raw: RawInputState): void {
    const v = sim.view();
    const rv = v.rounds;
    if (!strikeMode || rv === null || humans <= 0) return;
    const buying = rv.data[ROUND.phase] === ROUND_PHASE.buy && rv.data[ROUND.round]! > 0;
    const n = STRIKE_SHOP.length;
    for (let sIdx = 0; sIdx < slots.length; sIdx++) {
      const slot = slots[sIdx]!;
      const seat = seatOf(slot.controller);
      if (seat < 0) continue;
      const m = seat === 0 ? player : extras[seat - 1]!;
      const e = entityIndex(sim.controllerEntity(slot.controller));
      const alive = e >= 0 && (v.flags[e]! & ENTITY_FLAG.dead) === 0;
      if (!buying || !alive) {
        if (m.primary >= STRIKE_BUY_BASE) m.setPrimary(0);
        slot.buy.cursorX = 0;
        slot.buy.cursorY = 0;
        slot.buyPick = -1;
        slot.buyOpen = false;
        slot.tapId = -1;
        continue;
      }
      if (paused) continue;
      // Na abertura, guarda a mira (a do spawn da rodada): a câmera fica nela e o giro do quadro move o cursor.
      if (!slot.buyOpen) {
        slot.buyOpen = true;
        slot.buyYaw = m.yaw;
        slot.buyPitch = m.pitch;
        slot.buy.cursorX = 0;
        slot.buy.cursorY = 0;
      }
      const dyaw = wrapAngle(m.yaw - slot.buyYaw);
      const dpitch = m.pitch - slot.buyPitch;
      m.setAngles(slot.buyYaw, slot.buyPitch);
      // M10: o formato que a HUD desenhou no quadro anterior (revisão: a loja aparece inteira em todo formato): no anel
      // (o redondo ou o largo dos 13 itens), o giro de mira aponta; na fileira e na linha (a vista pequena), anda passo a
      // passo, como o radial da morte.
      const shopHit = slot.model.primaryHit;
      if (dyaw !== 0 || dpitch !== 0) {
        if (shopHit.layout === PRIMARY_LAYOUT.ring) {
          moveRadialCursor(slot.buy, dyaw, dpitch);
          const aimed = ringPick(shopHit, slot.buy.cursorX, slot.buy.cursorY, n);
          if (aimed >= 0) slot.buyPick = aimed;
        } else {
          const step = stepCursor(slot.buy, dyaw);
          if (step !== 0) slot.buyPick = stepPick(slot.buyPick, step, n);
        }
      }
      // A troca de arma (e o D-pad) anda pelas opções; o tiro ou o usar compra a apontada.
      if (m.wasPressed('nextWeapon')) slot.buyPick = stepPick(slot.buyPick, 1, n);
      if (m.wasPressed('prevWeapon')) slot.buyPick = stepPick(slot.buyPick, -1, n);
      let pick = m.wasPressed('fire') || m.wasPressed('use') ? slot.buyPick : -1;
      if (seat === 0 && device === 'touch') {
        // No toque, só o toque curto que começa e termina na mesma opção (arrastar o dedo não compra).
        const hit = slot.model.primaryHit;
        let still = false;
        for (let k = 0; k < raw.touches.length; k++) {
          const touch = raw.touches[k]!;
          if (!touch.active) continue;
          if (slot.tapId < 0) {
            const at = hitPrimaryOption(hit, touch.startX, touch.startY);
            if (at >= 0) {
              slot.tapId = touch.id;
              slot.tapOpt = at;
            }
          }
          if (touch.id === slot.tapId) {
            still = true;
            slot.tapNow = hitPrimaryOption(hit, touch.x, touch.y);
          }
        }
        if (slot.tapId >= 0 && !still) {
          if (slot.tapNow === slot.tapOpt) pick = slot.tapOpt;
          slot.tapId = -1;
        }
      }
      if (pick >= 0) m.setPrimary(STRIKE_BUY_BASE + pick);
      // A mão segue a da sim (a arma comprada vai para a mão).
      if (m.weapon !== v.slot[e]) m.setWeapon(v.slot[e]!);
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
    // M7 (fase 9): o Aquário assistindo: a câmera livre voa com o mapeador do P1 (sem bobo nenhum).
    const watching = s === 0 && aquarium && pilot < 0;
    if (watching && aqCam === AQUARIUM_CAMERA.free) {
      c.x = fly.x;
      c.y = fly.y;
      c.z = fly.z;
      c.yaw = player.yaw;
      c.pitch = clamp(player.pitch, -CAMERA_MAX_PITCH, CAMERA_MAX_PITCH);
      c.fovY = verticalFov(fovDeg, aspect);
      slot.adsBlend = 0;
      desc.localSlot = -1;
      desc.team = 255;
      desc.thirdPerson = false;
      slot.third = false;
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
    const targetEye = viewEyeHeight(v, e, dead ? 0 : flags);
    slot.eye = slot.eye < 0 ? targetEye : slot.eye + (targetEye - slot.eye) * Math.min(1, dt * EYE_FOLLOW);
    c.x = lerp(v.prevPosition[o]!, v.position[o]!, alpha);
    c.y = lerp(v.prevPosition[o + 1]!, v.position[o + 1]!, alpha) + slot.eye;
    c.z = lerp(v.prevPosition[o + 2]!, v.position[o + 2]!, alpha);
    const st = slot.death;
    // M7 (fase 9): o Aquário de cima (sobre o bobo seguido, um pouco para trás, girando com a mira) e seguindo (a câmera
    // de ombro atrás dele, no rumo dele).
    if (watching && aqCam === AQUARIUM_CAMERA.top) {
      const back = AQUARIUM.topHeightM / Math.tan(-AQUARIUM.topPitch);
      c.x += Math.sin(player.yaw) * back;
      c.y += AQUARIUM.topHeightM - slot.eye;
      c.z += Math.cos(player.yaw) * back;
      c.yaw = player.yaw;
      c.pitch = AQUARIUM.topPitch;
      c.fovY = verticalFov(fovDeg, aspect);
      slot.adsBlend = 0;
      desc.localSlot = -1;
      desc.team = ffa ? 255 : v.team[e]!;
      desc.thirdPerson = false;
      slot.third = false;
      vm.visible = false;
      return;
    }
    if (watching && aqCam === AQUARIUM_CAMERA.follow && !dead) {
      const fyaw = lerpAngle(v.prevYaw[e]!, v.yaw[e]!, alpha);
      const fpitch = lerp(v.prevPitch[e]!, v.pitch[e]!, alpha) * 0.5;
      placeShoulderCamera(v, c.x, c.y, c.z, fyaw, fpitch, 0, dt, slot.shoulder);
      c.x = slot.shoulder.x;
      c.y = slot.shoulder.y;
      c.z = slot.shoulder.z;
      c.yaw = fyaw;
      c.pitch = clamp(fpitch, -CAMERA_MAX_PITCH, CAMERA_MAX_PITCH);
      c.fovY = verticalFov(fovDeg, aspect);
      slot.adsBlend = 0;
      desc.localSlot = -1;
      desc.team = ffa ? 255 : v.team[e]!;
      desc.thirdPerson = false;
      slot.third = false;
      vm.visible = false;
      return;
    }
    // M7 (fase 4): no BoboStrike, passada a câmera de morte, assiste um aliado vivo (em 3ª pessoa, atrás dele).
    // Fase 9: no Aquário assistindo, não (a câmera passa para quem matou).
    const mate =
      dead && (strikeMode || royaleMode || sandboxElimination) && st.t >= STRIKE_SPECTATE_S && !watching
        ? livingMate(v, e)
        : -1;
    if (mate >= 0) {
      const q = mate * 3;
      const mx = lerp(v.prevPosition[q]!, v.position[q]!, alpha);
      const my = lerp(v.prevPosition[q + 1]!, v.position[q + 1]!, alpha) + viewEyeHeight(v, mate, v.flags[mate]!);
      const mz = lerp(v.prevPosition[q + 2]!, v.position[q + 2]!, alpha);
      const myaw = lerpAngle(v.prevYaw[mate]!, v.yaw[mate]!, alpha);
      const mpitch = lerp(v.prevPitch[mate]!, v.pitch[mate]!, alpha) * 0.5;
      placeShoulderCamera(v, mx, my, mz, myaw, mpitch, 0, dt, slot.shoulder);
      c.x = slot.shoulder.x;
      c.y = slot.shoulder.y;
      c.z = slot.shoulder.z;
      c.yaw = myaw;
      c.pitch = clamp(mpitch, -CAMERA_MAX_PITCH, CAMERA_MAX_PITCH);
      c.fovY = verticalFov(fovDeg, aspect);
      slot.adsBlend = 0;
      desc.localSlot = -1;
      desc.team = v.team[e]!;
      desc.thirdPerson = false;
      slot.third = false;
      vm.visible = false;
      return;
    }
    if (dead && st.t >= 0) {
      // M2 (fase 2c): câmera de morte, um pouco acima do olho, virando para quem matou.
      c.y += DEATH_CAM.riseM * Math.min(1, st.t / DEATH_CAM.turnS);
      c.fovY = verticalFov(fovDeg, aspect);
      // M9 (fase 1b): o peito de quem matou na escala dele (a desenhada) e, se ele é grande (o gigante colado na
      // vítima enchia a tela com a perna), a câmera recua no plano até ele caber (parando antes da parede).
      const killerScale = isCurrentEntity(v, st.killer) ? drawnScale(v, entityIndex(st.killer)) : 1;
      const back = deathCamBackoff(st, v, c.x, c.y, c.z, alpha, c.fovY, killerScale, camBack);
      c.x += camBack.x * back;
      c.z += camBack.z * back;
      const lift = Math.atan(Math.tan(c.fovY / 2) * DEATH_CAM.killerLift);
      deathCamAngles(st, v, c.x, c.y, c.z, alpha, lift, camAngles, killerScale);
      c.yaw = camAngles.yaw;
      c.pitch = clamp(camAngles.pitch, -CAMERA_MAX_PITCH, CAMERA_MAX_PITCH);
      slot.adsBlend = 0;
      desc.localSlot = s;
      desc.team = ffa ? 255 : v.team[e]!;
      desc.thirdPerson = false;
      slot.third = false;
      slot.shoulder.arm = -1;
      vm.visible = false;
      return;
    }
    const human = humans > 0 && slot.controller === me;
    // Humano: a mira vem do mapeador em todo frame de render (sem esperar o tick); bot: a da sim, interpolada.
    // Teste do sofá: os jogadores 2..4 também, cada um pelo seu mapeador.
    const local = mapperOf(slot.controller);
    const yaw = local !== null ? local.yaw : lerpAngle(v.prevYaw[e]!, v.yaw[e]!, alpha);
    const pitch = local !== null ? local.pitch : lerp(v.prevPitch[e]!, v.pitch[e]!, alpha);
    slot.shake = Math.max(0, slot.shake - dt * SHAKE_DECAY_PER_S);
    const shakeYaw = Math.sin(timeS * 47) * SHAKE_AMPLITUDE * slot.shake;
    const shakePitch = Math.sin(timeS * 53 + 1) * SHAKE_AMPLITUDE * slot.shake;
    c.yaw = yaw + v.recoilYaw[e]! + shakeYaw;
    c.pitch = clamp(pitch + v.recoilPitch[e]! + shakePitch, -CAMERA_MAX_PITCH, CAMERA_MAX_PITCH);
    // M9 (fase 5, revisão): com a ferramenta do dono (ou a trava do cancelar), o P1 não mira (nem o zoom).
    const adsWanted =
      local !== null
        ? !dead && !paused && local.isDown('ads') && !(local === player && ownerHolds())
        : (flags & ENTITY_FLAG.ads) !== 0;
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
    // Viewmodel: a arma da mão, com mola simples (ADS, passo, coice); luz amostrada no olho. Refino R2 (#79): no
    // arremesso rápido, a granada aparece na mão enquanto cozinha.
    const model = modelOf(
      v.quickNade[e] === 1 && v.cookTicks[e]! >= 0
        ? v.loadout[e * WEAPON_SLOT_COUNT + WEAPON_SLOT.throwable]!
        : v.weapon[e]!,
    );
    // Na luneta (zoom ≥ 3x, ou o DMR: `hasScope`; quase todo dentro) a arma sai da frente; a moldura da luneta é da HUD
    // (fase 1e).
    const scoped = held !== null && hasScope(held) && slot.adsBlend > 0.85;
    vm.visible = !dead && model !== NO_MODEL && !scoped;
    // M2 (fase 6b): 3ª pessoa (na luneta volta à 1ª): a câmera vai para o ombro, o bobo aparece e o viewmodel some.
    slot.third = false;
    if (human && thirdPerson && !dead && !scoped) {
      placeShoulderCamera(v, c.x, c.y, c.z, yaw, pitch, shoulderSide, dt, slot.shoulder);
      // Braço curto demais (de costas para a parede): fica a 1ª pessoa neste frame (o braço segue esticando).
      slot.third = slot.shoulder.arm >= THIRD_PERSON.minVisibleArmM;
    } else slot.shoulder.arm = -1;
    if (slot.third) {
      const eyeX = c.x;
      const eyeY = c.y;
      const eyeZ = c.z;
      c.x = slot.shoulder.x;
      c.y = slot.shoulder.y;
      c.z = slot.shoulder.z;
      slot.camOffX = c.x - eyeX;
      slot.camOffY = c.y - eyeY;
      slot.camOffZ = c.z - eyeZ;
      desc.thirdPerson = true;
      vm.visible = false;
    }
    vm.model = model;
    const aim = model !== NO_MODEL ? aimOffsets[model] : null;
    const ads = slot.adsBlend;
    const walk = (1 - ads) * Math.min(1, Math.hypot(v.velocity[o]!, v.velocity[o + 2]!) / RUN_SPEED);
    const phase = walkPhase[e] ?? 0;
    const kick = recoil[e] ?? 0;
    // M2: ajuste por arma fora do ADS (o lança-foguetes é grosso e vai mais longe e menor).
    // M6 (fase 5): a sniper de tinta usa o modelo (e o ajuste) da sniper.
    const vmCode = v.weapon[e] === WEAPON_PAINT_SNIPER ? WEAPON_CODE.sniper : weaponBase(v.weapon[e]!);
    // M10: as armas novas (códigos 27 a 31) têm o ajuste delas (`VIEWMODEL_TWEAK_M10`).
    const tweak = VIEWMODEL_TWEAK[vmCode] ?? VIEWMODEL_TWEAK_M10.get(vmCode) ?? null;
    const away = 1 - ads;
    // [PROPOSTA] da integração: a pose da render-atores com a arma inteira passava de 40% da tela; 0,8 em 1–2P e
    // 0,6 em 3–4P deixavam a arma no canto (arte-ux.md §3.3: no máximo 25% da vista no 3–4P). M3 (fase 1d): a vista
    // estreita do lado a lado usa a escala do 3–4P. Refino R4 (#79): 0,8 → 0,68 em 1–2P (o fuzil tampava um terço da
    // tela e escondia quem vinha pela direita).
    const scale = (viewCount >= 3 || layoutVertical ? 0.6 : VIEWMODEL_SCALE_1P) * (tweak ? tweak.scale : 1);
    // O alvo do ADS com a escala: a arma encolhe em torno da mão, então a mira (`sight`) chega mais perto dela; sem
    // isto, quanto menor a escala, mais a mira do ADS sai do centro (alvo = −(mão + escala · (mira − mão))).
    const aimX = aim ? aim.x - (1 - scale) * (aim.x + VIEWMODEL_POSE.hand[0]) : 0;
    const aimY = aim ? aim.y - (1 - scale) * (aim.y + VIEWMODEL_POSE.hand[1]) : 0;
    vm.offsetX = aimX * ads + Math.sin(phase * 0.5) * 0.012 * walk + (tweak ? tweak.x * away : 0);
    vm.offsetY = aimY * ads - Math.abs(Math.cos(phase * 0.5)) * 0.01 * walk + (tweak ? tweak.y * away : 0);
    vm.offsetZ = kick * 0.045 + (tweak ? tweak.z * away : 0);
    vm.pitch = kick * 0.06;
    vm.yaw = 0;
    vm.roll = 0;
    // Braços do viewmodel com a skin do boneco do dono (1ª das 2 camadas, a mesma do `ActorBuffer.skin`).
    vm.skin = skinLayer[e] !== 0xffff ? skinLayer[e]! : 0;
    // M9 (fase 1b): de propósito, o viewmodel NÃO acompanha a escala do corpo (`SimView.chaosScale`): no Mini (e no
    // humano que assume um bot gigante) a arma em 1ª pessoa fica do tamanho de sempre. O olho já desce ou sobe com o
    // corpo; a arma encolhida sumiria no canto e a gigante taparia a tela. O mundo (o clarão, o traçado) é que escala.
    vm.scale = scale;
    sampleLightGrid(loaded.lightGrid, c.x, c.y, c.z, lightScratch, 0);
    vm.lightSky = lightScratch[0]!;
    vm.lightSun = lightScratch[1]!;
    vm.lightEmissive = lightScratch[2]!;
  }

  /**
   * Refino R2 (#79): o pavio (fração que falta) e o arco da granada que vai sair agora, previsto pela `predictThrow`
   * da sim (gravidade, quiques e parada iguais aos de verdade) a partir do olho, com a mira e a herança da velocidade
   * do arremesso, e projetado na vista. `+1` tick: a granada já anda no tick do lançamento.
   */
  function fillGrenadeArc(m: HudModel, v: SimView, e: number, cam: ProjectCamera, rect: ProjectRect): void {
    m.cook = -1;
    m.arcCount = 0;
    const cook = v.cookTicks[e]!;
    if (cook < 0) return;
    const code = v.quickNade[e] === 1 ? v.loadout[e * WEAPON_SLOT_COUNT + WEAPON_SLOT.throwable]! : v.weapon[e]!;
    const def = weaponDef(code);
    if (def === null || def.fire !== WEAPON_FIRE.thrown) return;
    m.cook = cook / Math.max(1, Math.round(def.fuseS * sim.hz));
    const o = e * 3;
    const yaw = v.yaw[e]!;
    const pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, v.pitch[e]! + GRENADE_THROW.lift));
    const cp = Math.cos(pitch);
    const spd = def.projectileSpeed;
    const n = predictThrow(
      v.world,
      v.blocks,
      v.colliders,
      def,
      v.position[o]!,
      v.position[o + 1]! + viewEyeHeight(v, e, v.flags[e]!),
      v.position[o + 2]!,
      -Math.sin(yaw) * cp * spd + v.velocity[o]! * GRENADE_THROW.inherit,
      Math.sin(pitch) * spd + v.velocity[o + 1]! * GRENADE_THROW.inherit,
      -Math.cos(yaw) * cp * spd + v.velocity[o + 2]! * GRENADE_THROW.inherit,
      sim.hz,
      cook + 1,
      ARC_EVERY_TICKS,
      arcWorld,
    );
    for (let i = 0; i < n && m.arcCount < MAX_GRENADE_ARC; i++) {
      if (!projectToView(cam, rect, arcWorld[i * 3]!, arcWorld[i * 3 + 1]!, arcWorld[i * 3 + 2]!, projected)) continue;
      m.arc[m.arcCount * 2] = projected[0]!;
      m.arc[m.arcCount * 2 + 1] = projected[1]!;
      m.arcCount++;
    }
  }

  /** Refino R2 (#79): as granadas vivas dos outros a até `GRENADE_WARN_M`, no anel em volta da mira. */
  function fillGrenadeWarnings(m: HudModel, v: SimView, e: number, me: number, yaw: number): void {
    m.nadeCount = 0;
    const p = v.projectiles;
    const ex = v.position[e * 3]!;
    const ey = v.position[e * 3 + 1]! + 1;
    const ez = v.position[e * 3 + 2]!;
    for (let i = 0; i < p.count && m.nadeCount < MAX_GRENADE_WARNINGS; i++) {
      if (p.alive[i] !== 1 || p.owner[i] === me) continue;
      if (p.weapon[i] !== WEAPON_CODE.grenade && p.weapon[i] !== WEAPON_PAINT_BUCKET) continue;
      const dx = p.position[i * 3]! - ex;
      const dy = p.position[i * 3 + 1]! - ey;
      const dz = p.position[i * 3 + 2]! - ez;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > GRENADE_WARN_M) continue;
      let a = Math.atan2(-dx, -dz) - yaw;
      a -= Math.round(a / (Math.PI * 2)) * Math.PI * 2;
      m.nadeAngle[m.nadeCount] = a;
      m.nadeAlpha[m.nadeCount] = 1 - d / GRENADE_WARN_M;
      m.nadeCount++;
    }
  }

  function fillHud(
    s: number,
    fonts: UiFonts | null,
    lay: HudScreenLayout,
    ui: UiFrame,
    rawLocked: boolean,
    alpha: number,
  ): void {
    const slot = slots[s]!;
    const m = slot.model;
    const desc = slot.desc;
    resetDrawList(slot.hud, desc.width, desc.height);
    const entity = slot.controller >= 0 ? sim.controllerEntity(slot.controller) : NULL_ENTITY;
    const override = s === 0 && (overrideCamera !== null || overrideRoute !== null);
    // M2 (fase 2e): com o resultado na tela, a HUD sai (o véu e os botões ficam limpos).
    const aqNoHud =
      s === 0 && aquarium && pilot < 0 && (aqCam === AQUARIUM_CAMERA.free || aqCam === AQUARIUM_CAMERA.top);
    // M9 (fase 5b, prints): sob as páginas do dono (a tela inteira), a HUD do P1 sai: o Voltar compacto do canto de
    // cima fica no lugar da plaquinha de abates e mortes, que aparecia em volta dele.
    const ownerPageOpen = s === 0 && paused && pausePage === 'owner';
    if (!hudVisible || entity === NULL_ENTITY || override || fontSpecimen || resultShown || aqNoHud || ownerPageOpen) {
      desc.hud = null;
      return;
    }
    const v = sim.view();
    const e = entityIndex(entity);
    const flags = v.flags[e]!;
    m.health = v.health[e]!;
    // M9 (fase 3): no Sandbox, a vida do time (a sim dá a mesma a humanos e bots; a regra do bot ganha: o `max`).
    m.maxHealth = sandboxMode
      ? Math.max(recipe.teams[v.team[e]!]?.hp ?? recipe.players?.hp ?? 100, m.health)
      : (recipe.players?.hp ?? 100);
    m.clip = heldClip(v, e);
    m.reserve = heldReserve(v, e);
    m.kills = v.kills[e]!;
    m.deaths = v.deaths[e]!;
    m.dead = (flags & ENTITY_FLAG.dead) !== 0;
    m.respawnS = m.dead ? v.respawnTicks[e]! / sim.hz : 0;
    // M3 (fase 2d): Bobo Zombies.
    // M6 (fase 2): no Gun Game, o nível (de 1 até o tamanho da escada).
    // M6 (fase 3): no Juggernaut, os pontos de Jugg; a vida do Jugg é a dele (300 por caçador).
    m.points = zombiesMode || juggernaut || strikeMode ? v.points[e]! : gunGame ? v.points[e]! + 1 : -1;
    m.pointsLabel = strikeMode ? strikeTx.money : '';
    if (juggernaut && v.team[e] === 1) m.maxHealth = Math.max(juggernautHp(huntersOf(v)), m.health);
    m.pointsIsLevel = gunGame;
    // M3 (fase 4c): as vantagens e a vida máxima com a Chonky Cola.
    m.perks = zombiesMode ? v.perks[e]! : 0;
    if ((m.perks & PERK.chonky) !== 0) m.maxHealth = Math.round(m.maxHealth * ZOMBIE_PERKS.chonkyHpMul);
    // M9 (fase 3): na eliminação do Sandbox ninguém volta: "fora até o fim" no lugar da contagem do renascer.
    m.waitWave = (zombiesMode || strikeMode || royaleMode || sandboxElimination) && m.dead;
    m.waitText = strikeMode ? strikeTx.wait : sandboxElimination ? sandboxOutText : '';
    if ((zombiesMode || royaleMode) && (flags & ENTITY_FLAG.downed) !== 0 && !m.dead) {
      if (v.selfUp[e] === 1) {
        m.downed = HUD_DOWNED.selfUp;
        m.downedValue = v.downTicks[e]! / sim.hz;
      } else if (v.reviveTicks[e]! > 0) {
        m.downed = HUD_DOWNED.reviving;
        m.downedValue = (100 * v.reviveTicks[e]!) / (ZOMBIES_DOWN.reviveS * sim.hz);
      } else {
        m.downed = HUD_DOWNED.bleeding;
        m.downedValue = v.downTicks[e]! / sim.hz;
      }
    } else m.downed = HUD_DOWNED.none;
    // M3 (fase 3d): o aviso de consertar a janela ou abrir a porta paga (as mesmas regras de `barricadesSystem`).
    m.interact = HUD_INTERACT.none;
    m.centerLabel = '';
    m.buyTitle = '';
    if (strikeMode) fillStrikeHud(m, v, e, slot);
    if (royaleMode) fillRoyaleHud(m, v, e, slot);
    if (mapWeapons && !m.dead) fillMapWeaponHud(m, v, e, slot);
    const mo = v.mapObjects;
    if (zombiesMode && mo !== null && !m.dead && m.downed === HUD_DOWNED.none) {
      const x = v.position[e * 3]!;
      const y = v.position[e * 3 + 1]!;
      const z = v.position[e * 3 + 2]!;
      const B = ZOMBIE_BARRICADES;
      for (let i = 0; i < mo.barricades && m.interact === HUD_INTERACT.none; i++) {
        if (mo.openWindows || mo.planks[i]! >= B.planks || Math.abs(y - mo.by[i]!) > 1) continue;
        const dx = x - mo.bx[i]!;
        const dz = z - mo.bz[i]!;
        const dn = dx * mo.bnx[i]! + dz * mo.bnz[i]!;
        const dt = Math.abs(dx * mo.bnz[i]! - dz * mo.bnx[i]!);
        if (dn < 0 && dn >= -B.repairReachM && dt <= mo.bhw[i]! + B.sideSlackM) m.interact = HUD_INTERACT.repair;
      }
      for (let d = 0; d < mo.doors && m.interact === HUD_INTERACT.none; d++) {
        if (mo.doorOpen[d] === 1) continue;
        const o = d * 6;
        if (y < mo.doorBox[o + 1]! - 1 || y > mo.doorBox[o + 4]!) continue;
        const ddx = Math.max(mo.doorBox[o]! - x, 0, x - mo.doorBox[o + 3]!);
        const ddz = Math.max(mo.doorBox[o + 2]! - z, 0, z - mo.doorBox[o + 5]!);
        if (ddx * ddx + ddz * ddz > B.doorReachM * B.doorReachM) continue;
        m.interact = HUD_INTERACT.door;
        m.interactCost = mo.doorCost[d]!;
        m.interactAfford = v.points[e]! >= mo.doorCost[d]!;
      }
      // M3 (fase 4a): arma na parede (as regras do `wallBuySystem`): a nova, ou a munição da que já tem.
      for (let w = 0; w < mo.wallBuys && m.interact === HUD_INTERACT.none; w++) {
        if (Math.abs(y - mo.wby[w]!) > 1) continue;
        const dx = x - mo.wbx[w]!;
        const dz = z - mo.wbz[w]!;
        const dn = dx * mo.wbnx[w]! + dz * mo.wbnz[w]!;
        const dt = Math.abs(dx * mo.wbnz[w]! - dz * mo.wbnx[w]!);
        if (dn < -0.25 || dn > ZOMBIE_SHOP.wallReachM || dt > ZOMBIE_SHOP.wallSideM) continue;
        const code = mo.wbWeapon[w]!;
        const k = e * WEAPON_SLOT_COUNT;
        let owned = false;
        for (let slot = 0; slot < WEAPON_SLOT_COUNT; slot++) if (v.loadout[k + slot] === code) owned = true;
        const cost = owned ? Math.round(mo.wbCost[w]! * ZOMBIE_SHOP.ammoCostFrac) : mo.wbCost[w]!;
        m.interact = owned ? HUD_INTERACT.buyAmmo : HUD_INTERACT.buy;
        m.interactCost = cost;
        m.interactAfford = v.points[e]! >= cost;
        m.interactName = weaponNamesUpper[code] ?? '';
      }
      // M3 (fase 4c): máquina de vantagem que ele ainda não tem (as regras do `perkSystem`).
      for (let q = 0; q < mo.machines && m.interact === HUD_INTERACT.none; q++) {
        if ((v.perks[e]! & mo.pmPerk[q]!) !== 0 || Math.abs(y - mo.pmy[q]!) > 1) continue;
        const dx = x - mo.pmx[q]!;
        const dz = z - mo.pmz[q]!;
        const dn = dx * mo.pmnx[q]! + dz * mo.pmnz[q]!;
        const dt = Math.abs(dx * mo.pmnz[q]! - dz * mo.pmnx[q]!);
        if (dn < 0 || dn > ZOMBIE_PERKS.reachM || dt > ZOMBIE_PERKS.sideM) continue;
        m.interact = HUD_INTERACT.buy;
        m.interactCost = mo.pmCost[q]!;
        m.interactAfford = v.points[e]! >= mo.pmCost[q]!;
        m.interactName = perkNamesUpper[Math.log2(mo.pmPerk[q]!)] ?? '';
      }
      // M3 (fase 4b): a Caixa Misteriosa (as regras do `mysteryBoxSystem`): pagar, ou pegar a arma de quem pagou.
      if (mo.boxSpots > 0 && m.interact === HUD_INTERACT.none) {
        const st = mo.boxState;
        const i = st[BOX.active]!;
        const dx = x - mo.boxX[i]!;
        const dz = z - mo.boxZ[i]!;
        const dn = dx * mo.boxNx[i]! + dz * mo.boxNz[i]!;
        const dt = Math.abs(dx * mo.boxNz[i]! - dz * mo.boxNx[i]!);
        if (dn >= 0 && dn <= ZOMBIE_BOX.reachM && dt <= ZOMBIE_BOX.sideM && Math.abs(y - mo.boxY[i]!) <= 1) {
          if (st[BOX.phase] === BOX_PHASE.idle) {
            m.interact = HUD_INTERACT.box;
            m.interactCost = ZOMBIE_BOX.cost;
            m.interactAfford = v.points[e]! >= ZOMBIE_BOX.cost;
          } else if (st[BOX.phase] === BOX_PHASE.offering && mo.boxUser[0] === entity) {
            m.interact = HUD_INTERACT.boxTake;
            m.interactName = weaponNamesUpper[st[BOX.weapon]!] ?? '';
          }
        }
      }
    }
    // Refino R2 (#79): a granada cozinhando na mão: o pavio e o arco previsto (a mesma conta da sim); e as granadas
    // dos outros perto.
    fillGrenadeArc(m, v, e, desc.camera, lay.rects[s]!);
    fillGrenadeWarnings(m, v, e, entity, desc.camera.yaw);
    // M2 (fase 3e): avisos dos bots aliados N3 ("inimigo aqui"), só na vista do humano.
    m.pingCount = 0;
    if (calibration !== null && slot.controller === me) {
      // M2 (fase 5f): o alvo da calibração, um losango a 10 m na direção dele.
      calibrationTarget(calibration, calibration.index, calibrationAim);
      const ty = calibrationAim[0]!;
      const tp = calibrationAim[1]!;
      const cam = desc.camera;
      const px = cam.x - Math.sin(ty) * Math.cos(tp) * 10;
      const py = cam.y + Math.sin(tp) * 10;
      const pz = cam.z - Math.cos(ty) * Math.cos(tp) * 10;
      if (projectToView(cam, lay.rects[s]!, px, py, pz, projected)) {
        m.pings[0] = projected[0]!;
        m.pings[1] = projected[1]!;
        m.pingCount = 1;
      }
    } else if (!ffa && humans > 0 && slot.controller === me) {
      const n = driver.director?.pings(v.team[e]!, Math.round(PING_SHOW_S * sim.hz), pingScratch) ?? 0;
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
    // M5 (fase 5d): os pings dos humanos do time (no FFA, só os meus) e os balões de emote de todo mundo.
    if (calibration === null && slot.controller >= 0) {
      const mine = sim.controllerEntity(slot.controller);
      for (let k = 0; k < MAX_HUMAN_PINGS && m.pingCount < MAX_TEAM_PINGS; k++) {
        if (humanPingUntil[k]! <= timeS) continue;
        if (ffa ? humanPingBy[k] !== mine : humanPingTeam[k] !== v.team[e]) continue;
        if (
          !projectToView(
            desc.camera,
            lay.rects[s]!,
            humanPings[k * 3]!,
            humanPings[k * 3 + 1]!,
            humanPings[k * 3 + 2]!,
            projected,
          )
        ) {
          continue;
        }
        m.pings[m.pingCount * 2] = projected[0]!;
        m.pings[m.pingCount * 2 + 1] = projected[1]!;
        m.pingCount++;
      }
    }
    m.bubbleCount = 0;
    for (let b = 0; b < MAX_EMOTE_BUBBLES; b++) {
      if (emoteUntil[b]! <= timeS) continue;
      const i = entityIndex(emoteBy[b]!);
      if (i >= v.count || v.alive[i] !== 1 || (v.flags[i]! & ENTITY_FLAG.dead) !== 0) continue;
      // M6 (fase 4b): o balão não entrega o invisível.
      if (hiddenNow[i] === 1) continue;
      // M8 (fase 6): o balão da ordem é só do time de quem mandou.
      if (emoteKind[b]! >= ORDER_BALLOON_KIND && (ffa || e < 0 || v.team[i] !== v.team[e])) continue;
      const o = i * 3;
      if (
        !projectToView(
          desc.camera,
          lay.rects[s]!,
          v.position[o]!,
          v.position[o + 1]! + EMOTE_HEIGHT_M * drawnScale(v, i),
          v.position[o + 2]!,
          projected,
        )
      ) {
        continue;
      }
      m.bubbles[m.bubbleCount * 2] = projected[0]!;
      m.bubbles[m.bubbleCount * 2 + 1] = projected[1]!;
      m.bubbleText[m.bubbleCount] = emoteTexts[emoteKind[b]! - 1] ?? '';
      m.bubbleCount++;
    }
    // M6 (fase 1): as letras dos pontos do Domination em cima de cada anel.
    m.pointMarkCount = 0;
    const cp = v.controlPoints;
    if (cp !== null) {
      for (let i = 0; i < cp.count && m.pointMarkCount < MAX_CONTROL_POINTS; i++) {
        if (!projectToView(desc.camera, lay.rects[s]!, cp.x[i]!, cp.y[i]! + POINT_MARK_HEIGHT_M, cp.z[i]!, projected)) {
          continue;
        }
        const k = m.pointMarkCount++;
        m.pointMarks[k * 2] = projected[0]!;
        m.pointMarks[k * 2 + 1] = projected[1]!;
        m.pointMarkIndex[k] = i;
        m.pointMarkOwner[k] = cp.owner[i]!;
      }
    }
    // M6 (fase 3): o Jugg aparece sempre para quem caça (na borda da vista quando está fora dela). Fase 6a: no
    // Fortress, a mesma plaquinha mostra o gerador.
    m.juggMarkOn = false;
    m.juggMarkLabel = '';
    const fortMark = v.fortress;
    if (fortMark !== null) {
      const rect = lay.rects[s]!;
      projectToEdge(
        desc.camera,
        rect,
        fortMark.x,
        fortMark.y + GENERATOR_MARK_HEIGHT_M,
        fortMark.z,
        Math.max(16, rect.height * 0.06),
        projected,
      );
      m.juggMark[0] = projected[0]!;
      m.juggMark[1] = projected[1]!;
      m.juggMarkOn = true;
      m.juggMarkLabel = generatorLabel;
    }
    const rov = v.royale;
    if (rov !== null && (flags & ENTITY_FLAG.dead) === 0) {
      const c = rov.circle;
      const px = v.position[e * 3]!;
      const pz = v.position[e * 3 + 2]!;
      const dx = px - c[CIRCLE.cx]!;
      const dz = pz - c[CIRCLE.cz]!;
      const tx = px - c[CIRCLE.toCx]!;
      const tz = pz - c[CIRCLE.toCz]!;
      const outsideNow = dx * dx + dz * dz >= c[CIRCLE.r]! * c[CIRCLE.r]!;
      const outsideNext = rov.data[ZONE.shrinking] === 1 && tx * tx + tz * tz >= c[CIRCLE.toR]! * c[CIRCLE.toR]!;
      if (outsideNow || outsideNext) {
        const rect = lay.rects[s]!;
        projectToEdge(
          desc.camera,
          rect,
          c[CIRCLE.toCx]!,
          v.position[e * 3 + 1]! + 1.5,
          c[CIRCLE.toCz]!,
          Math.max(16, rect.height * 0.06),
          projected,
        );
        m.juggMark[0] = projected[0]!;
        m.juggMark[1] = projected[1]!;
        m.juggMarkOn = true;
        m.juggMarkLabel = royaleTx.zone;
      }
    }
    const sv = v.strike;
    if (sv !== null && v.rounds !== null) {
      const bomb = sv.data[STRIKE_DATA.bomb];
      const atk = v.rounds.data[ROUND.swapped] === 1 ? 1 : 0;
      if (bomb === BOMB.planted || (bomb === BOMB.dropped && v.team[e] === atk)) {
        const rect = lay.rects[s]!;
        projectToEdge(
          desc.camera,
          rect,
          sv.pos[0]!,
          sv.pos[1]! + 0.9,
          sv.pos[2]!,
          Math.max(16, rect.height * 0.06),
          projected,
        );
        m.juggMark[0] = projected[0]!;
        m.juggMark[1] = projected[1]!;
        m.juggMarkOn = true;
        m.juggMarkLabel = strikeTx.bomb;
      }
    }
    if (juggernaut && v.team[e] !== 1) {
      const j = juggIndex(v);
      if (j >= 0) {
        const rect = lay.rects[s]!;
        projectToEdge(
          desc.camera,
          rect,
          v.position[j * 3]!,
          v.position[j * 3 + 1]! + JUGG_MARK_HEIGHT_M * drawnScale(v, j),
          v.position[j * 3 + 2]!,
          Math.max(16, rect.height * 0.06),
          projected,
        );
        m.juggMark[0] = projected[0]!;
        m.juggMark[1] = projected[1]!;
        m.juggMarkOn = true;
      }
    }
    // M2 (fase 2d): marcadores dos aliados (TDM), projetados com a câmera desta vista.
    m.markerCount = 0;
    if (!ffa && showAllyMarkers) {
      const team = v.team[e]!;
      m.markerColor = royaleMode ? teamColors[0]! : (teamColors[team] ?? COLORS.texto);
      const c = desc.camera;
      const rect = lay.rects[s]!;
      for (let j = 0; j < v.count && m.markerCount < MAX_ALLY_MARKERS; j++) {
        if (j === e || v.alive[j] !== 1 || v.kind[j] !== ENTITY_KIND.bobo || v.team[j] !== team) continue;
        if ((v.flags[j]! & ENTITY_FLAG.dead) !== 0) continue;
        // M3 (fase 1d): um jogador local leva o símbolo e a cor dele (e aparece a qualquer distância).
        let seat = -1;
        for (let k = 0; k < seatCtrl.length; k++) {
          if (entityIndex(sim.controllerEntity(seatCtrl[k]!)) === j) seat = seatNum[k]!;
        }
        const o = j * 3;
        const top = v.position[o + 1]! + ALLY_MARKER_HEIGHT_M * drawnScale(v, j);
        if (!projectToView(c, rect, v.position[o]!, top, v.position[o + 2]!, projected)) continue;
        if (seat < 0 && projected[2]! > ALLY_MARKER_MAX_M) continue;
        m.markers[m.markerCount * 2] = projected[0]!;
        m.markers[m.markerCount * 2 + 1] = projected[1]!;
        m.markerSeat[m.markerCount] = seat;
        m.markerCount++;
      }
    }
    // M2 (fase 2c): faixa de quem matou, o radial (só a vista do humano) e a dica da derrota feia.
    const st = slot.death;
    if (m.dead && st.t >= 0) {
      fillDeathBanner(m, st, v, names, weaponNames, deathTx, ruleTexts);
      const seat = humans > 0 ? seatOf(slot.controller) : -1;
      const human = seat >= 0;
      // M6 (fase 2): no Gun Game e no Infection a arma é do modo: sem o radial.
      // M7 (fase 4): no BoboStrike a arma se compra (sem o radial da morte).
      // M9 (fase 3b): na eliminação do Sandbox também não (ninguém volta); e só as armas que o time pode pegar.
      const ct = choicesOf(v.team[e]!);
      // M11 (fase 4): com as armas no mapa também não (a primária está no chão). Revisão: a não ser para quem a regra de
      // armas deixa com o loadout de sempre (a mesma conta da sim).
      const radial =
        human &&
        !fixedLoadout &&
        !(mapWeapons && mapWeaponsDropPrimary(v.weaponMask[e]!, v.mapWeapons!.spotMask)) &&
        !strikeMode &&
        !royaleMode &&
        !sandboxElimination &&
        teamChoices[ct]!.length > 1;
      m.primaryNames = radial ? teamChoiceNames[ct]! : NO_PRIMARIES;
      m.primaryCategories = radial ? teamChoiceCategories[ct]! : NO_PRIMARIES;
      m.primarySelected = radial ? Math.max(0, teamChoices[ct]!.indexOf(seatPrimary[seatNum[seat]!]!)) : 0;
      m.hardTimeHint = st.hint;
    } else {
      m.deathName = '';
      m.primaryNames = NO_PRIMARIES;
      m.hardTimeHint = false;
    }
    // M7 (fase 4): o anel da compra (vivo, na compra) usa as opções do radial.
    if (m.buyTitle !== '') {
      m.primaryNames = strikeItems;
      m.primaryCategories = strikePrices;
      m.primarySelected = slot.buyPick;
    } else if (slot.orderOpen && !m.dead) {
      // M8 (fase 6): a roda das ordens usa o mesmo anel (a compra fecha a roda).
      m.buyTitle = ordersTitle;
      m.primaryNames = orderNames;
      m.primaryCategories = orderHints;
      m.primarySelected = slot.orderPick;
    }
    m.playerSlot = slot.seat;
    m.team = ffa ? 255 : v.team[e]!;
    const held = weaponDef(v.weapon[e]!);
    m.weaponName = held ? (weaponNames[held.code] ?? '') : '';
    m.weaponCategory = held ? (weaponCategories[held.code] ?? '') : '';
    m.ammoMode = !held || held.clipSize === 0 ? HUD_AMMO.none : held.reserve === 0 ? HUD_AMMO.clip : HUD_AMMO.full;
    m.grenades =
      held && held.fire === WEAPON_FIRE.thrown
        ? -1
        : weaponDef(v.loadout[e * WEAPON_SLOT_COUNT + WEAPON_SLOT.throwable]!)?.fire === WEAPON_FIRE.thrown
          ? v.slotClip[e * WEAPON_SLOT_COUNT + WEAPON_SLOT.throwable]!
          : -1;
    m.crosshair =
      held && (held.fire === WEAPON_FIRE.melee || held.fire === WEAPON_FIRE.thrown || held.adsZoom >= 3)
        ? HUD_CROSSHAIR.dot
        : HUD_CROSSHAIR.cross;
    m.scope = held && hasScope(held) && slot.adsBlend > 0.85 ? 1 : 0;
    // A retícula abre com a dispersão da arma no quadril (chumbos inclusive), fecha no ADS, e abre com o movimento.
    const hip = held ? Math.min(1, (held.hipSpreadDeg + held.pelletSpreadDeg) / 6) * (1 - slot.adsBlend) : 0;
    // Refino R1 (#79): o movimento abre a retícula pelo que a sim abre de verdade (o perfil: no Bobo quase nada
    // andando), não pela velocidade, que fazia a mira pulsar a cada passo.
    const speed = Math.hypot(v.velocity[e * 3]!, v.velocity[e * 3 + 2]!);
    const fl = v.flags[e]!;
    const moveOpen =
      (fl & ENTITY_FLAG.onGround) === 0 || (sprintSpread && (fl & ENTITY_FLAG.sprinting) !== 0)
        ? SPREAD_STATE_MULTIPLIER.air * moveSpreadMul - 1
        : speed > SPREAD_WALKING_SPEED && (fl & ENTITY_FLAG.crouching) === 0
          ? SPREAD_STATE_MULTIPLIER.walking * moveSpreadMul - 1
          : 0;
    m.spread = Math.min(1, hip * 0.7 + Math.min(0.6, moveOpen * 0.6) * (1 - slot.adsBlend) + (recoil[e] ?? 0) * 0.5);
    m.clickToAim =
      humans > 0 && s === 0 && !paused && device === 'keyboardMouse' && platform.id === 'web' && !rawLocked;
    m.tipAlpha = s === 0 ? tipAlpha(tips) : 0;
    if (m.tipAlpha > 0) {
      refreshTipLabel();
      m.tipKey = tipKey;
      m.tipText = tipText;
      m.tipGlyph = tipGlyph;
    }
    // M4 (fase 3): o aviso da bateria usa a plaquinha da dica (passa na frente dela).
    if (s === 0 && hostAwayText !== '') {
      m.tipAlpha = 1;
      m.tipKey = '!';
      m.tipText = hostAwayText;
      m.tipGlyph = -1;
    } else if (s === 0 && batteryNoticeS > 0) {
      m.tipAlpha = Math.min(1, batteryNoticeS);
      m.tipKey = '!';
      m.tipText = batteryNotice;
      m.tipGlyph = -1;
    } else if (slot.orderNoticeS > 0) {
      // M8 (fase 6): a resposta da ordem na plaquinha da dica.
      m.tipAlpha = Math.min(1, slot.orderNoticeS);
      m.tipKey = '!';
      m.tipText = slot.orderNotice;
      m.tipGlyph = -1;
    }
    // M9 (fase 5b, revisão): a plaquinha dos congelados por baixo das plaquinhas da HUD desta vista (como os balões).
    drawFrozen(slot.hud, fonts, s, lay.rects[s]!, lay.views[s]!.minTextPx, alpha);
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
      // M2 (fase 7c): o indicador visual de som, se ligado nos Ajustes.
      m.soundCount = host.settings.current.audio.soundIndicator
        ? matchSound.fillIndicator(s, m.soundAngle, m.soundAlpha)
        : 0;
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

  /** M3 (fase 7b): a linha dos zumbis do relatório do bench (o pool é a contagem de entidades zumbi da sim). */
  function benchZombies(b: { zSum: number; zMax: number; zFrames: number }): {
    avgAlive: number;
    maxAlive: number;
    pool: number;
    wave: number;
  } {
    const zv = sim.view();
    let pool = 0;
    for (let i = 0; i < zv.count; i++) if (zv.kind[i] === ENTITY_KIND.zombie) pool++;
    return { avgAlive: b.zFrames > 0 ? b.zSum / b.zFrames : 0, maxAlive: b.zMax, pool, wave: zv.match.zombieWave };
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
    if (zombiesMode) {
      const zv = sim.view();
      let alive = 0;
      for (let i = 0; i < zv.count; i++) {
        if (zv.kind[i] === ENTITY_KIND.zombie && zv.alive[i] === 1 && !(zv.flags[i]! & ENTITY_FLAG.dead)) alive++;
      }
      b.zSum += alive;
      b.zFrames++;
      if (alive > b.zMax) b.zMax = alive;
    }
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
    const botsTotal = driver.director?.botCount ?? 0;
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
      ...(zombiesMode ? { zombies: benchZombies(b) } : {}),
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
        heapEarly: heapWindow(heapByMinute, 5, 10),
        heapLate: heapWindow(heapByMinute, 15, 20),
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
    panel.bots = driver.director?.botCount ?? 0;
    panel.tick = sim.tick;
    panel.gcPauses = benchState?.gcPauses ?? panel.gcPauses;
    panel.voices = host.audio.mixer.stats.activeVoices;
    panel.voicesPeak = host.audio.mixer.stats.peakVoices;
    // M5 (fase 7a): a rede (as taxas por segundo saem do `sampleNet`).
    panel.netRole = driver.net === null ? 0 : driver.director !== null ? 1 : 2;
    panel.netMs = driver.lastNetMs;
  }
  // M5 (fase 7a): a rede da partida online, uma vez por segundo (o F2) e a cada 30 s no registro. As janelas usam o
  // relógio da plataforma (KB/s de verdade): o `dt` da cena tem teto, e a aba de trás andaria devagar.
  let netSent = 0;
  let netReceived = 0;
  let netSnapshots = 0;
  let netLogSent = 0;
  let netLogReceived = 0;
  let netLogSnapshots = 0;
  /** Quando foram a última amostra e a última linha (ms da plataforma; -1 = sem base ainda). */
  let netSampleAt = -1;
  let netLogAt = 0;
  /** O tempo desde a 1ª base (s), somado só nas janelas que valeram (a aba de trás não conta). */
  let netClockS = 0;
  /** Amigos × segundos na janela da linha (o "por amigo" com quem estava em cada segundo). */
  let netPeerS = 0;
  let netMsSum = 0;
  let netMsFrames = 0;
  /** A sim e a IA do host na janela da linha (a CPU do host no celular contra o tecnico.md §13.4). */
  let netSimSum = 0;
  let netAiSum = 0;
  /** Uma amostra que chega depois disto (ms) veio de uma parada (a aba atrás, o app trocado): a janela recomeça. */
  const NET_GAP_MS = 2500;
  /** A base das contas: tudo o que veio antes dela não entra (as janelas recomeçam daqui). */
  function netBaseline(n: OnlineNetStats, t: number): void {
    netSampleAt = netLogAt = t;
    netSent = netLogSent = n.sentBytes;
    netReceived = netLogReceived = n.receivedBytes;
    netSnapshots = netLogSnapshots = n.snapshots;
    netPeerS = 0;
    netMsSum = 0;
    netSimSum = 0;
    netAiSum = 0;
    netMsFrames = 0;
  }
  function sampleNet(): void {
    const n = driver.net;
    if (n === null) return;
    const t = platform.now();
    const isHost = driver.director !== null;
    // A 1ª base só com a partida andando (o host mandou o 1º snapshot; o amigo já mostra um): a carga de cada lado e o
    // 1º snapshot completo não entram. Uma parada longa (a aba atrás) também recomeça a janela, senão a média do fps e
    // dos KB/s sairia diluída pelo tempo parado.
    if (netSampleAt < 0 || t - netSampleAt > NET_GAP_MS) {
      if (isHost ? n.snapshots > 0 : n.lagTicks >= 0) netBaseline(n, t);
      return;
    }
    const dtS = Math.max(0.001, (t - netSampleAt) / 1000);
    netClockS += dtS;
    // Host: bytes por amigo; os snapshots são do host (um por vez, para todos), sem dividir.
    const friends = isHost ? Math.max(1, n.peers) : 1;
    netPeerS += friends * dtS;
    panel.netUpKBps = (n.sentBytes - netSent) / 1024 / dtS / friends;
    panel.netDownKBps = (n.receivedBytes - netReceived) / 1024 / dtS / friends;
    panel.netSnapshotsPerS = (n.snapshots - netSnapshots) / dtS;
    panel.netPeers = n.peers;
    panel.netLagTicks = n.lagTicks;
    panel.netMispredicts = n.mispredicts;
    netSampleAt = t;
    netSent = n.sentBytes;
    netReceived = n.receivedBytes;
    netSnapshots = n.snapshots;
    if (t - netLogAt < NET_LOG_EVERY_S * 1000) return;
    // A cada 30 s: as médias da janela (o texto pode alocar).
    const spanS = (t - netLogAt) / 1000;
    const peerS = Math.max(0.001, netPeerS);
    const up = (n.sentBytes - netLogSent) / 1024 / peerS;
    const down = (n.receivedBytes - netLogReceived) / 1024 / peerS;
    const snaps = (n.snapshots - netLogSnapshots) / spanS;
    const frames = Math.max(1, netMsFrames);
    const ms = netMsSum / frames;
    const fps = netMsFrames / spanS;
    const clock = Math.round(netClockS);
    host.log(
      isHost
        ? `[rede] host t=${clock}s rede_ms=${ms.toFixed(3)} sobe_kbs=${up.toFixed(1)} desce_kbs=${down.toFixed(1)}` +
            ` amigos=${n.peers} snapshots_s=${snaps.toFixed(1)} sim_ms=${(netSimSum / frames).toFixed(2)}` +
            ` ia_ms=${(netAiSum / frames).toFixed(2)} fps=${fps.toFixed(1)}`
        : `[rede] amigo t=${clock}s desce_kbs=${down.toFixed(1)} sobe_kbs=${up.toFixed(1)} snapshots_s=${snaps.toFixed(1)}` +
            ` atraso_ticks=${n.lagTicks.toFixed(1)} predicao_errada=${n.mispredicts}/${n.reconciles}` +
            ` host_ausente_s=${driver.hostAbsentS.toFixed(1)} fps=${fps.toFixed(1)}`,
    );
    netLogAt = t;
    netLogSent = n.sentBytes;
    netLogReceived = n.receivedBytes;
    netLogSnapshots = n.snapshots;
    netPeerS = 0;
    netMsSum = 0;
    netSimSum = 0;
    netAiSum = 0;
    netMsFrames = 0;
  }
  let heapNowMb = -1;
  let memoryCheckS = 0;
  /**
   * M4 (fase 7a): no Switch, uma linha `[mem]` por minuto de partida no `runtime.log` (o heap de agora, o pico e o
   * teto), para provar o "heap estável" dos 20 min com 4 no Zombies (P8) com o jogo de verdade, não só no bench.
   */
  let memoryLogS = MEMORY_LOG_EVERY_S;
  let memoryLogMin = 0;
  /** M4 (fase 5b): os programas de shader no fim do aquecimento (a partida nasce logo depois dele) e os frames feitos. */
  const warmPrograms = renderer.stats.programs;
  let renderedFrames = 0;
  /** M4 (fase 7b): o heap (MB) no fim de cada minuto (o índice é o minuto); -1 = sem amostra. */
  const heapByMinute = new Float32Array(64).fill(-1);
  function sampleMemory(dt: number): void {
    if (driver.net !== null) {
      netMsSum += driver.lastNetMs;
      netSimSum += driver.lastSimMs;
      netAiSum += driver.lastAiMs;
      netMsFrames++;
    }
    heapCheckS -= dt;
    if (heapCheckS > 0) return;
    heapCheckS = 1;
    sampleNet();
    const m = platform.diagnostics.memoryUsage?.() ?? null;
    if (m) {
      heapNowMb = Math.round((m.usedHeapBytes / 1e6) * 10) / 10;
      heapMaxMb = Math.max(heapMaxMb, heapNowMb);
      heapLimitMb = m.heapLimitBytes > 0 ? Math.round((m.heapLimitBytes / 1e6) * 10) / 10 : -1;
    }
    memoryLogS -= 1;
    if (memoryLogS <= 0 && heapNowMb >= 0) {
      memoryLogS = MEMORY_LOG_EVERY_S;
      memoryLogMin++;
      // M4 (fase 7b): a amostra do minuto (a tendência do relatório do bench de 20 min).
      if (memoryLogMin < heapByMinute.length) heapByMinute[memoryLogMin] = heapNowMb;
      // Uma vez por minuto: o texto pode alocar.
      if (platform.id === 'switch') {
        host.log(
          `[mem] t=${memoryLogMin}min heap_mb=${heapNowMb} max_mb=${heapMaxMb}` +
            (heapLimitMb > 0 ? ` limite_mb=${heapLimitMb}` : ''),
        );
      }
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
    get wantsMusic(): boolean {
      return resultShown;
    },
    get ownsMusic(): boolean {
      return zombieMusic?.owns ?? false;
    },
    get wantsPointerLock(): boolean {
      return (
        (humans > 0 || aquarium) &&
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
    pause: systemPause,
    trainingReport,
    nemesisBot,
    frame(dt, raw, menu, ui, list, rawFrameMs): SceneSignal {
      if (disposed) return 'none';
      frameMenu = menu;
      if (couch) checkLostPads(raw);
      const t0 = now();
      // F2 (borda de subida): painel de depuração.
      const f2 = F2_KEY >= 0 && raw.keys[F2_KEY] === 1;
      if (f2 && !f2Down) panel.visible = !panel.visible;
      f2Down = f2;
      lastPointerLocked = raw.pointerLocked;

      // --- entrada e sim ---
      let signal: SceneSignal = 'none';
      // M5: a sala acabou (o host saiu, fui expulso, a conexão caiu): de volta ao menu.
      if (driver.closed && !resultShown) signal = 'quit';
      checkHostAway();
      if (humans > 0 || aquarium) {
        const last = menu.lastDevice;
        if (last !== null && !couch) useDevice(last, last === 'gamepad' ? Math.max(0, menu.lastGamepad) : padIndex);
        if (resultShown) {
          // M2 (fase 2e): o resultado é um menu (D-pad, mouse, toque); o jogador não anda por trás dele.
          const nav = resultMenu.update(menu, raw, ui);
          const a = nav.activated;
          if (a === RESULT_ACTION.again) signal = 'again';
          else if (a === RESULT_ACTION.easier) signal = 'easier';
          else if (a === RESULT_ACTION.harder) signal = 'harder';
          else if (a === RESULT_ACTION.quit) signal = 'quit';
          else if (a === RESULT_ACTION.changeRules) signal = 'rules';
          // M2 (fase 5e): Abrir Laboratório (no Tryhard) e Salvar na Oficina (o Nêmesis; quem salva é o `game`).
          else if (a === RESULT_ACTION.lab) signal = 'lab';
          else if (a === RESULT_ACTION.saveWorkshop && resultData !== null && !resultData.nemesisSaved) {
            signal = 'nemesis';
            resultData = { ...resultData, nemesisSaved: true };
            resultMenu.setRoot(resultScreen.build(resultData));
          } else if (a === RESULT_ACTION.savePreset && resultData !== null && !resultData.presetSaved) {
            // M2 (fase 4e): quem salva é o `game` (o save é dele); aqui o botão vira "Preset salvo".
            signal = 'save';
            resultData = { ...resultData, presetSaved: true };
            resultMenu.setRoot(resultScreen.build(resultData));
          } else if (a === RESULT_ACTION.savePreset && zombiesData !== null && !zombiesData.presetSaved) {
            // M3 (fase 6a): o mesmo no resultado do Bobo Zombies.
            signal = 'save';
            zombiesData = { ...zombiesData, presetSaved: true };
            resultMenu.setRoot(zombiesResultScreen.build(zombiesData));
          }
        } else if (!paused && humans === 0) {
          // M7 (fase 9): o Aquário assistindo.
          aquariumInput(raw, dt);
        } else if (!paused) {
          const yaw0 = player.yaw;
          const pitch0 = player.pitch;
          // M7 (fase 9): a assistência mira do bobo do P1 (no Aquário, o bot assumido; no online, o da sala). M9 (fase
          // 5, revisão): não com a ferramenta do dono (o ADS que cancela não puxa a mira para um inimigo).
          const noAssist = frozen || ownerHolds();
          const scale = noAssist ? 1 : aimAssistBefore(player, me);
          player.update(raw, frozen ? 0 : dt, scale);
          if (!noAssist) aimAssistAfter(dt, player.yaw !== yaw0 || player.pitch !== pitch0);
          if (!ghostDone && device === 'touch' && !frozen) {
            ghostT += dt;
            if (player.moveX !== 0 || player.moveY !== 0) ghostMoved += dt;
            if (player.yaw !== yaw0 || player.pitch !== pitch0) ghostLooked = true;
            const learned = ghostMoved >= GHOST.moveS && ghostLooked;
            if (learned || ghostT >= GHOST.maxS) {
              ghostDone = true;
              host.log(`[partida] fantasma dos dedos: ${learned ? 'aprendeu' : 'tempo'}`);
            }
          }
          ghostAlpha =
            !ghostDone && device === 'touch'
              ? Math.min(1, ghostT / GHOST.fadeS)
              : Math.max(0, ghostAlpha - dt / GHOST.fadeS);
          // M9 (fase 5): com uma ferramenta do dono armada, o tiro aplica e a mira cancela.
          if (!frozen) ownerInput();
          if (player.wasPressed('camera') && thirdAllowed) saveVideo({ view: thirdPerson ? 'first' : 'third' });
          if (player.wasPressed('shoulder') && thirdPerson)
            saveVideo({ shoulder: shoulderSide > 0 ? 'left' : 'right' });
          // M2 (fase 5f): a calibração anda com a mira (a pedida pelos Ajustes começa no fim da contagem).
          if (calibrationPending && sim.view().match.phase === 'playing') {
            calibrationPending = false;
            startCalibration();
          }
          if (calibration !== null && !frozen) {
            if (stepCalibration(calibration, player.yaw, player.pitch, player.wasPressed('fire'), dt))
              finishCalibration();
          }
          if (couch) checkMidJoin(raw, dt);
          checkBattery(dt);
          const pauser = updateExtras(raw, dt, frozen, false);
          if (pauser > 0) pause(pauser);
          else if (player.wasPressed('pause')) pause();
          if (aquarium) checkPilotOut(dt);
        } else {
          // Pausado: a sim não anda e a mira não gira (o mapeador lê só os botões).
          const yaw = player.yaw;
          const pitch = player.pitch;
          player.update(raw, 0);
          player.setAngles(yaw, pitch);
          const extraPause = updateExtras(raw, 0, false, true);
          // Capturando um botão (e esperando soltar tudo depois): nem a pausa nem o menu andam.
          if (capture.active) finishCapture(capture.update(raw));
          else if (player.wasPressed('pause') || extraPause > 0) resume();
          else if (pausePage !== 'players' || !playersInput(raw)) {
            // M9 (fase 5, revisão): no online a sim anda com a pausa aberta: a resposta do dono refaz a página (um
            // modificador recusado apaga, a reserva muda).
            if (ownerTools !== null && ownerTools.takeChanged() && pausePage === 'owner') ownerPage();
            signal = pauseAction(pauseMenu.update(menu, raw, ui), raw);
          }
        }
      } else if (wardrobe) {
        signal = wardrobe.frame(dt, menu, raw, ui);
      } else if (menu.pressed('back')) {
        // Bench: B (Switch) ou Esc interrompe; o relatório sai com o que foi medido.
        if (benchState && benchState.phase !== 'done') finishBench(true);
        signal = 'quit';
      }
      const running = (!paused || driver.online) && !frozen;
      trace('entrada');
      if (running) {
        // M7 (fase 9): o Aquário acelera a sim (o resto da cena anda no relógio do render). M9 (fase 5): a câmera lenta
        // do dono (só offline) desacelera do mesmo jeito.
        lastTicks = driver.update((aquarium && pilot < 0 ? dt * aqSpeed : dt) * (ownerTools?.slow ?? 1));
        trace('sim e IA');
        timeS += dt;
        ownerTools?.update(dt);
        // M7 (fase 9, revisão): acelerado, o frame faz mais ticks: a sonda da qualidade não conta. M9 (fase 5, revisão):
        // na câmera lenta do dono, menos ticks por frame: também não.
        if (!(aquarium && pilot < 0 && aqSpeed > 1) && (ownerTools?.slow ?? 1) >= 1) probeQuality(dt);
        decay(dt);
        if (!resultShown && endedAt < 0) updateTips(dt);
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
      // M7 (fase 8): a parede da zona do Royale (o render só reescreve quando o círculo muda).
      const zoneView = sim.view().royale;
      if (zoneView !== null) {
        const zc = zoneView.circle;
        renderer.setZone(zc[CIRCLE.cx]!, zc[CIRCLE.cz]!, zc[CIRCLE.r]!);
      }
      trace('atores', actors.count);
      if (fx.count > 0) {
        if (!bench || bench.fx) renderer.submitFx(fx);
        resetFxQueue(fx);
      }
      const lay = syncLayout(ui);
      updateDeaths(running ? dt : 0, raw, lay);
      updateBuys(raw);
      updateOrders(raw, dt);
      for (let s = 0; s < slots.length; s++) updateView(s, running ? dt : 0, alpha, lay);
      hideBodiesAroundCameras();
      // M2 (fase 7b): cada vista ouve da própria câmera; passos, coração e contagem andam com a partida.
      matchSound.setListenerCount(slots.length);
      for (let s = 0; s < slots.length; s++) {
        const c = slots[s]!.desc.camera;
        matchSound.setListener(s, c.x, c.y, c.z, c.yaw);
      }
      if (running) matchSound.frame(sim.view(), dt, timeS);
      if (zombieMusic !== null) {
        const zv = sim.view();
        musicLocals.length = 0;
        for (let p = 0; p < humans; p++) musicLocals.push(entityIndex(sim.controllerEntity(aquarium ? me : p)));
        zombieMusic.frame(zv, running ? dt : 0, {
          live: zv.match.phase !== 'ended',
          result: resultShown,
          musicInMatch: host.settings.current.audio.musicInMatch,
          locals: musicLocals,
          hordeTeam: hordeArmed ? 1 : -1,
        });
      }
      trace('vfx e câmeras');
      const fonts = host.fonts;
      const tUi0 = now();
      for (let s = 0; s < slots.length; s++) fillHud(s, fonts, lay, ui, lastPointerLocked, alpha);
      let uiMs = now() - tUi0;
      const tr0 = now();
      if (fontSpecimen) {
        renderer.renderViews(NO_VIEWS);
      } else {
        renderer.renderViews(descs);
      }
      const renderMs = now() - tr0;
      trace('render', renderer.stats.drawCalls, renderer.stats.programs);
      // M4 (fase 5b): programa compilado depois do aquecimento é travada no 1º uso (o Switch não compila em paralelo).
      if (renderedFrames < PROGRAM_CHECK_FRAMES && ++renderedFrames === PROGRAM_CHECK_FRAMES) {
        const after = renderer.stats.programs;
        host.log(
          `[partida] programas: ${warmPrograms} no aquecimento, ${after} em ${PROGRAM_CHECK_FRAMES} frames` +
            (after > warmPrograms ? ' (compilou depois do aquecimento)' : ''),
        );
      }
      const tUi1 = now();
      if (fontSpecimen) {
        pushRect(list, 0, 0, ui.width, ui.height, COLORS.bunker);
        drawFontSpecimen(list, fonts, ui.width, ui.height);
      } else {
        if (hudVisible && !resultShown && !(overrideCamera || overrideRoute)) {
          // M9 (fase 5b, revisão): a câmera livre e a de cima do Aquário vão sem HUD: a plaquinha dos congelados vai
          // na lista da tela, antes do resto (as vistas com HUD desenham a delas no `fillHud`).
          if (aquarium && pilot < 0 && (aqCam === AQUARIUM_CAMERA.free || aqCam === AQUARIUM_CAMERA.top)) {
            drawFrozen(list, fonts, 0, lay.rects[0]!, ui.options.minTextPx ?? 0, alpha);
          }
          const sharedArea = lay.shared;
          if (training) {
            sharedHud.teamCount = 0;
            if (calibration !== null) sharedHud.trainingLine = calibrationLines[calibration.index] ?? '';
            else refreshTrainingLine();
          } else if (zombiesMode) {
            sharedHud.teamCount = 0;
            refreshZombieLine();
          } else if (royaleMode) {
            sharedHud.teamCount = 0;
          } else if (!ffa && !juggernaut && request.kind === 'play') {
            // M9 (fase 3): o Sandbox mostra os seus 3 ou 4 times.
            const teams = sandboxMode ? Math.min(recipe.teams.length, sharedHud.teamScores.length) : 2;
            sharedHud.teamCount = teams;
            const score = sim.view().match.teamScore;
            for (let i = 0; i < teams; i++) sharedHud.teamScores[i] = score[i]!;
          } else {
            sharedHud.teamCount = 0;
          }
          const mv = sim.view().match;
          // M2 (fase 2d): o relógio da partida (na morte súbita, os 60 s dela) e o aviso de morte súbita.
          sharedHud.timeLeftS = request.kind === 'play' && !training && mv.ticksLeft >= 0 ? mv.ticksLeft / sim.hz : -1;
          // M7 (fase 0): nas rodadas, a linha da rodada (com o relógio dela) no lugar do relógio da partida.
          if (sim.view().rounds !== null) {
            if (strikeMode) refreshStrikeLine();
            else {
              sharedHud.timeLeftS = -1;
              refreshRoundLine();
            }
          }
          // M7 (fase 8): no Royale, os vivos e a zona.
          if (royaleMode && sim.view().royale !== null) refreshRoyaleLine();
          sharedHud.suddenDeath = mv.phase === 'suddenDeath';
          // M6 (fase 1): os pontos do Domination embaixo do placar.
          const cpv = sim.view().controlPoints;
          sharedHud.points = cpv === null ? 0 : Math.min(cpv.count, MAX_CONTROL_POINTS);
          for (let i = 0; i < sharedHud.points; i++) {
            sharedHud.pointOwner[i] = cpv!.owner[i]!;
            sharedHud.pointProgress[i] = cpv!.progress[i]!;
          }
          // M6 (fase 4): os modificadores ligados (ou o aviso da Roleta) embaixo do placar.
          const chv = sim.view().chaos;
          if (chv !== null) refreshModsLine(chv.masks);
          sharedHud.spareMap = viewCount === 3 && sharedArea.mode === 'spare';
          if (
            viewCount === 3 ||
            sharedHud.teamCount > 0 ||
            sharedHud.timeLeftS >= 0 ||
            training ||
            zombiesMode ||
            sharedHud.trainingLine !== '' ||
            sharedHud.modsLine !== ''
          ) {
            drawHudShared(list, fonts, sharedHud, sharedArea);
          }
          if (sharedHud.spareMap) drawSpareMinimap(list, sharedArea);
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
            drawMatchCountdown(
              list,
              fonts,
              mv.countdownTicks / sim.hz,
              todayLine,
              ui.width,
              ui.height,
              minText,
              nemesisLine,
            );
          }
          let wantsScoreboard = (humans > 0 && player.isDown('scoreboard')) || (aquarium && pilot < 0 && aqList);
          for (let k = 0; k < extras.length; k++) if (extras[k]!.isDown('scoreboard')) wantsScoreboard = true;
          if (!paused && wantsScoreboard) {
            fillScoreboard(sim.view());
            drawScoreboard(list, fonts, scoreboard, ui.width, ui.height, minText);
          }
          // M7 (fase 9): a faixa do Aquário (o estado e os botões).
          if (aquarium && pilot < 0 && !paused) {
            refreshAquariumTexts();
            drawAquariumBar(list, fonts?.hud ?? null, aqStatus, aqHint, ui.width, ui.height, hs, minText);
          }
          // M9 (fase 5): a ferramenta do dono armada e as respostas, na vista do P1 (na câmera livre e na de cima do
          // Aquário, sem HUD, com uma cruz no meio).
          if (ownerTools !== null && !paused) {
            const r0 = lay.rects[0]!;
            const noHud = aquarium && pilot < 0 && (aqCam === AQUARIUM_CAMERA.free || aqCam === AQUARIUM_CAMERA.top);
            const font = fonts?.hud ?? null;
            // Revisão: assistindo, acima da faixa do Aquário.
            const limit = aquarium && pilot < 0 ? aquariumBarTop(aqHint, ui.height, hs, minText) : Infinity;
            ownerTools.draw(list, font, r0.x, r0.y, r0.width, r0.height, minText, ownerHintText(), noHud, limit);
          }
          if ((humans > 0 || aquarium) && device === 'touch' && !paused) {
            const tf = touchFrame;
            tf.width = ui.width;
            tf.height = ui.height;
            tf.pixelRatio = platform.graphics.pixelRatio;
            tf.minTextPx = ui.options.minTextPx ?? 0;
            touchOverlay.draw(list, fonts, tf, player);
            if (ghostAlpha > 0) {
              const left = host.settings.current.controls.touch.leftHanded;
              touchOverlay.drawGhost(list, fonts, tf, left, ghostAlpha, timeS);
            }
          }
        }
        drawBenchStatus(list, fonts, ui);
        if (wardrobe) wardrobe.draw(list, ui);
        if (paused) pauseMenu.draw(list, ui);
        // M2 (fase 2e): o resultado entra 2,5 s depois do fim (dá para ver o último abate).
        if (!resultShown && endedAt >= 0 && (humans > 0 || aquarium) && timeS - endedAt >= RESULT_DELAY_S)
          showResult(true);
        // M7 (fase 8, revisão): no Royale (fora do online), com todo humano local fora, o resultado sai depois da câmera
        // de morte, sem esperar os bots acabarem (a partida segue por trás, como depois do fim).
        if (!resultShown && endedAt < 0 && royaleMode && !request.online && humans > 0 && !benchState && !aquarium) {
          if (!royaleLocalsOut()) royaleOutAt = -1;
          else if (royaleOutAt < 0) royaleOutAt = timeS;
          else if (timeS - royaleOutAt >= ROYALE_RESULT_DELAY_S) showResult(true);
        }
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
      matchSound.dispose();
      zombieMusic?.dispose();
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
