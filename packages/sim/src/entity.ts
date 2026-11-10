/**
 * EntityId = índice (16 bits baixos) + geração (16 bits altos), como u32 (tecnico.md §4.1). A geração começa em 1,
 * então `NULL_ENTITY` (0) nunca é um id válido e um id guardado de uma entidade morta não acerta a que reusou o slot.
 */
export type EntityId = number;

export const NULL_ENTITY: EntityId = 0;

export function makeEntityId(index: number, generation: number): EntityId {
  return (((generation & 0xffff) << 16) | (index & 0xffff)) >>> 0;
}

export function entityIndex(id: EntityId): number {
  return id & 0xffff;
}

export function entityGeneration(id: EntityId): number {
  return id >>> 16;
}

/** Tipo da entidade (`SimView.kind`). */
export const ENTITY_KIND = {
  none: 0,
  bobo: 1,
  projectile: 2,
  pickup: 3,
  door: 4,
  trigger: 5,
  /**
   * M1: bobo-zumbi do teste de estresse (corpo igual ao bobo, mesmas hitboxes; comportamento de perseguir e bater,
   * sem arma). Controlado pela IA nos controladores a partir de `ZOMBIE_CONTROLLER_BASE`.
   */
  zombie: 6,
} as const;

export type EntityKind = (typeof ENTITY_KIND)[keyof typeof ENTITY_KIND];

/** Bits de `SimView.flags`. Ordem fixa (entra no hash do golden e nos snapshots). */
export const ENTITY_FLAG = {
  onGround: 1 << 0,
  crouching: 1 << 1,
  sprinting: 1 << 2,
  sliding: 1 << 3,
  ads: 1 << 4,
  firing: 1 << 5,
  reloading: 1 << 6,
  dead: 1 << 7,
  spawnProtected: 1 << 8,
  /** M3 (fase 2c): caído (Bobo Zombies): rasteja, só a pistola, não toma dano; sangra até morrer ou alguém levanta. */
  downed: 1 << 9,
} as const;

/** Sem time (FFA usa um time só; isto é para props, projéteis neutros etc.). */
export const NO_TEAM = 255;

/** Sem controlador (projéteis, pickups, portas). */
export const NO_CONTROLLER = -1;
