// @boboforces/sim: simulação headless (ECS-lite em typed arrays, passo fixo). Puro e determinístico: sem DOM, sem
// relógio, sem Math.random (regra 10) e sem alocação no laço quente (regra 11). Só emite eventos; nunca chama render,
// áudio ou UI.
export * from './constants.ts';
export * from './entity.ts';
export * from './config/metrics.ts';
export * from './config/movement.ts';
export * from './config/weapons.ts';
export * from './config/rules.ts';
export * from './config/nav-metrics.ts';
export * from './config/zombie.ts';
export * from './view.ts';
export * from './events.ts';
export * from './sim.ts';
export * from './fixed-step.ts';
export * from './loop.ts';
export * from './map.ts';
export {
  MAX_BARRICADES,
  MAX_DOORS,
  MAX_WALL_BUYS,
  MAX_BOX_SPOTS,
  MAX_PERK_MACHINES,
  BOX,
  type BarricadeDef,
  type BoxSpotDef,
  type PerkMachineDef,
  type BarricadeOutside,
  type DoorDef,
  type WallBuyDef,
} from './map-objects.ts';
export {
  expandRecipe,
  isFfaMode,
  isWarfareMode,
  matchLimits,
  type ControllerSlot,
  type MatchLimits,
} from './recipe.ts';
// M6 (fase 1): o Domination.
export { ControlPoints, DOMINATION, type ControlPointDef, type ControlPointsView } from './systems/domination.ts';
export { JUGG_FIXED, JUGGERNAUT, juggernautHp } from './systems/party.ts';
// M7 (fase 0): as rodadas.
export { ROUND, ROUND_PHASE, ROUND_UNDECIDED } from './systems/rounds.ts';
// M7 (fase 2): o BoboStrike.
export {
  BOMB,
  STRIKE,
  STRIKE_BUY_BASE,
  STRIKE_DATA,
  STRIKE_SHOP,
  attackers as strikeAttackers,
  type StrikeItemId,
} from './systems/strike.ts';
// M7 (fase 6): o Bobo Royale Mini.
export {
  CIRCLE,
  isRoyaleItem,
  pickupWeapon,
  ROYALE,
  ROYALE_AMMO_BASE,
  ROYALE_UNDECIDED,
  ZONE,
  zoneDps,
} from './systems/royale.ts';
export { CHAOS_MODS, MOD } from './systems/chaos.ts';
export { FORTRESS } from './systems/fortress.ts';
export {
  aimPointLocal,
  aimPointWorld,
  ARM_HIT_CUT_M,
  bindFigureTable,
  bodyPartAtHeight,
  boundFigureTable,
  CHAOS_SCALE,
  CHAOS_SCALE_BITS,
  CHAOS_SQUEEZE,
  chaosScale,
  chaosMaskScaleOf,
  chaosScaleOf,
  createBoboHit,
  eyeHeightFor,
  figurePostureOf,
  GIANT_EYE_CEILING_GAP_M,
  HITBOX_COUNT,
  rayBoxEntry,
  rayVsBobo,
  scaledEyeHeight,
  squeezedScale,
  squeezedScaleAt,
  unbindFigureTable,
  viewAimPoint,
  viewEyeHeight,
  visibleAimLocal,
  visibleAimOffset,
  weaponGrip,
  type AimPoint,
  type BoboHit,
  type BodyArrays,
  type ChaosBodies,
  type ChaosMaskBodies,
  type EyeBodies,
} from './hitbox.ts';
export { WEAPON_KILL_PLANE, WEAPON_NONE, WEAPON_NUKE, WEAPON_ZONE } from './context.ts';
// Refino R2 (#79): o arco da granada para a HUD.
export { predictThrow } from './systems/projectiles.ts';
// M9 (fase 4): as Ferramentas do Dono e o roteiro dos comandos.
export {
  isOwnerDormant,
  OWNER,
  OWNER_COMMANDS,
  OWNER_FAILS,
  ownerAllowed,
  ownerReserveBase,
  ownerReserveCount,
  ownerReserveSlots,
  type OwnerCommand,
  type OwnerCommandKind,
  type OwnerFail,
  type OwnerView,
  type SimOwnerConfig,
} from './systems/owner.ts';
export * from './owner-script.ts';
