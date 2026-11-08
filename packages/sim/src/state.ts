import { IndexAllocator } from '@boboforces/shared';
import { MAX_CONTROLLERS_WITH_ZOMBIES, MAX_ENTITIES } from './constants.ts';
import { makeEntityId, NO_CONTROLLER, NO_TEAM, NULL_ENTITY, type EntityId } from './entity.ts';

/** Array de estado da sim (todos os typed arrays que entram em snapshot e hash). */
export type StateArray = Uint8Array | Uint16Array | Int16Array | Uint32Array | Int32Array | Float32Array | Float64Array;

/** Um componente quente: o array e quantos valores por entidade (3 para vetores). */
export interface StateField {
  readonly name: string;
  readonly array: StateArray;
  readonly stride: number;
}

/**
 * Mundo ECS-lite (tecnico.md §4.1): componentes quentes em typed arrays (SoA) com capacidade fixa, alocados uma vez.
 * A primeira parte é o que a `SimView` expõe; a segunda é interna (timers, entrada do tick, estado de movimento).
 * Toda entidade nova ou campo novo entra em `fields`, que define a ordem do snapshot e do hash (não reordenar à toa:
 * muda o golden).
 */
export class SimState {
  readonly capacity = MAX_ENTITIES;
  /** Maior índice em uso + 1. */
  count = 0;
  readonly allocator = new IndexAllocator(MAX_ENTITIES);

  // --- Expostos na SimView ---
  readonly alive = new Uint8Array(MAX_ENTITIES);
  readonly generation = new Uint16Array(MAX_ENTITIES);
  readonly kind = new Uint8Array(MAX_ENTITIES);
  readonly team = new Uint8Array(MAX_ENTITIES).fill(NO_TEAM);
  readonly flags = new Uint32Array(MAX_ENTITIES);
  readonly controller = new Int16Array(MAX_ENTITIES).fill(NO_CONTROLLER);
  readonly position = new Float64Array(MAX_ENTITIES * 3);
  readonly prevPosition = new Float64Array(MAX_ENTITIES * 3);
  readonly velocity = new Float64Array(MAX_ENTITIES * 3);
  readonly yaw = new Float64Array(MAX_ENTITIES);
  readonly prevYaw = new Float64Array(MAX_ENTITIES);
  readonly pitch = new Float64Array(MAX_ENTITIES);
  readonly prevPitch = new Float64Array(MAX_ENTITIES);
  readonly health = new Float32Array(MAX_ENTITIES);
  readonly weapon = new Uint8Array(MAX_ENTITIES);
  readonly ammoClip = new Uint16Array(MAX_ENTITIES);
  readonly ammoReserve = new Uint16Array(MAX_ENTITIES);
  readonly kills = new Uint16Array(MAX_ENTITIES);
  readonly deaths = new Uint16Array(MAX_ENTITIES);
  readonly recoilPitch = new Float32Array(MAX_ENTITIES);
  readonly recoilYaw = new Float32Array(MAX_ENTITIES);

  // --- Internos ---
  /** Entrada aplicada neste tick (passo 1) e a do tick anterior (bordas de botão). */
  readonly inButtons = new Uint16Array(MAX_ENTITIES);
  readonly prevButtons = new Uint16Array(MAX_ENTITIES);
  readonly inMoveX = new Float32Array(MAX_ENTITIES);
  readonly inMoveY = new Float32Array(MAX_ENTITIES);
  readonly inWeapon = new Uint8Array(MAX_ENTITIES);
  /** Movimento. */
  readonly coyoteTicks = new Int16Array(MAX_ENTITIES);
  readonly jumpBufferTicks = new Int16Array(MAX_ENTITIES);
  readonly slideTicks = new Int16Array(MAX_ENTITIES);
  readonly slideCooldownTicks = new Int16Array(MAX_ENTITIES);
  /** Direção do deslize no plano (x, z). */
  readonly slideDir = new Float64Array(MAX_ENTITIES * 2);
  readonly airPeakY = new Float64Array(MAX_ENTITIES);
  /** Arma. */
  /**
   * Tempo até o próximo tiro, em SEGUNDOS (não em ticks): atirando sem parar, o resto do tick passa para o tiro
   * seguinte e a cadência média fica igual à da arma em qualquer `SIM_HZ`. No zumbi (sem arma) é o tempo até o
   * próximo golpe.
   */
  readonly fireCooldownS = new Float64Array(MAX_ENTITIES);
  readonly reloadTicks = new Int16Array(MAX_ENTITIES);
  readonly switchTicks = new Int16Array(MAX_ENTITIES);
  readonly sprintFireDelayTicks = new Int16Array(MAX_ENTITIES);
  readonly lastShotTick = new Int32Array(MAX_ENTITIES).fill(-1_000_000);
  /** Vida e spawn. */
  readonly respawnTicks = new Int32Array(MAX_ENTITIES);
  readonly spawnProtectTicks = new Int32Array(MAX_ENTITIES);
  readonly lastDamageTick = new Int32Array(MAX_ENTITIES).fill(-1_000_000);
  readonly lastAttacker = new Uint32Array(MAX_ENTITIES);

  /** Controlador → entidade (EntityId com geração), `NULL_ENTITY` se não houver. Cobre humanos, bots e zumbis. */
  readonly controllerEntity = new Uint32Array(MAX_CONTROLLERS_WITH_ZOMBIES);

  readonly fields: readonly StateField[];

  constructor() {
    const f = (name: string, array: StateArray, stride = 1): StateField => ({ name, array, stride });
    this.fields = [
      f('alive', this.alive),
      f('generation', this.generation),
      f('kind', this.kind),
      f('team', this.team),
      f('flags', this.flags),
      f('controller', this.controller),
      f('position', this.position, 3),
      f('prevPosition', this.prevPosition, 3),
      f('velocity', this.velocity, 3),
      f('yaw', this.yaw),
      f('prevYaw', this.prevYaw),
      f('pitch', this.pitch),
      f('prevPitch', this.prevPitch),
      f('health', this.health),
      f('weapon', this.weapon),
      f('ammoClip', this.ammoClip),
      f('ammoReserve', this.ammoReserve),
      f('kills', this.kills),
      f('deaths', this.deaths),
      f('recoilPitch', this.recoilPitch),
      f('recoilYaw', this.recoilYaw),
      f('inButtons', this.inButtons),
      f('prevButtons', this.prevButtons),
      f('inMoveX', this.inMoveX),
      f('inMoveY', this.inMoveY),
      f('inWeapon', this.inWeapon),
      f('coyoteTicks', this.coyoteTicks),
      f('jumpBufferTicks', this.jumpBufferTicks),
      f('slideTicks', this.slideTicks),
      f('slideCooldownTicks', this.slideCooldownTicks),
      f('slideDir', this.slideDir, 2),
      f('airPeakY', this.airPeakY),
      f('fireCooldownS', this.fireCooldownS),
      f('reloadTicks', this.reloadTicks),
      f('switchTicks', this.switchTicks),
      f('sprintFireDelayTicks', this.sprintFireDelayTicks),
      f('lastShotTick', this.lastShotTick),
      f('respawnTicks', this.respawnTicks),
      f('spawnProtectTicks', this.spawnProtectTicks),
      f('lastDamageTick', this.lastDamageTick),
      f('lastAttacker', this.lastAttacker),
    ];
  }

  /** Cria uma entidade num slot livre (geração nova, começando em 1). `NULL_ENTITY` = cheio. */
  allocate(kind: number, team: number, controller: number): EntityId {
    const i = this.allocator.alloc();
    if (i < 0) return NULL_ENTITY;
    const gen = (this.generation[i]! + 1) & 0xffff || 1;
    this.generation[i] = gen;
    this.alive[i] = 1;
    this.kind[i] = kind;
    this.team[i] = team;
    this.controller[i] = controller;
    this.flags[i] = 0;
    if (i + 1 > this.count) this.count = i + 1;
    return makeEntityId(i, gen);
  }

  /** A entidade deste id ainda existe (mesma geração)? */
  isCurrent(id: EntityId): boolean {
    if (id === NULL_ENTITY) return false;
    const i = id & 0xffff;
    return i < this.count && this.alive[i] === 1 && this.generation[i] === id >>> 16;
  }

  idOf(index: number): EntityId {
    return makeEntityId(index, this.generation[index]!);
  }
}
