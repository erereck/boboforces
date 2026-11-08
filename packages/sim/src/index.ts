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
export { expandRecipe, isFfaMode, isWarfareMode, type ControllerSlot } from './recipe.ts';
export {
  aimPointLocal,
  aimPointWorld,
  ARM_HIT_CUT_M,
  bindFigureTable,
  bodyPartAtHeight,
  boundFigureTable,
  createBoboHit,
  eyeHeightFor,
  figurePostureOf,
  HITBOX_COUNT,
  rayBoxEntry,
  rayVsBobo,
  unbindFigureTable,
  visibleAimLocal,
  visibleAimOffset,
  weaponGrip,
  type AimPoint,
  type BoboHit,
  type BodyArrays,
} from './hitbox.ts';
export { WEAPON_NONE } from './context.ts';
