import { IndexAllocator } from '@boboforces/shared';
import { WEAPON_SLOT_COUNT } from '@boboforces/input';
import {
  MAX_CONTROLLERS_WITH_ZOMBIES,
  MAX_ENTITIES,
  MAX_PICKUPS,
  MAX_PROJECTILES,
  RECENT_ATTACKERS,
} from './constants.ts';
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
  /** Código da arma na mão (`WEAPON_CODE`), ou `WEAPON_NONE` (zumbi). */
  readonly weapon = new Uint8Array(MAX_ENTITIES);
  /** Slot ativo do loadout (0..3, `WEAPON_SLOT`). */
  readonly slot = new Uint8Array(MAX_ENTITIES);
  /** M2: loadout e munição POR SLOT (passo `WEAPON_SLOT_COUNT`): código da arma de cada slot, pente e reserva. */
  readonly loadout = new Uint8Array(MAX_ENTITIES * WEAPON_SLOT_COUNT);
  readonly slotClip = new Uint16Array(MAX_ENTITIES * WEAPON_SLOT_COUNT);
  readonly slotReserve = new Uint16Array(MAX_ENTITIES * WEAPON_SLOT_COUNT);
  /** Quanto do ADS já entrou (0..1; a câmera aplica o zoom da arma nessa fração). */
  readonly adsAmount = new Float32Array(MAX_ENTITIES);
  readonly kills = new Uint16Array(MAX_ENTITIES);
  readonly deaths = new Uint16Array(MAX_ENTITIES);
  /** M2 (fase 2a): assistências. */
  readonly assists = new Uint16Array(MAX_ENTITIES);
  readonly recoilPitch = new Float32Array(MAX_ENTITIES);
  readonly recoilYaw = new Float32Array(MAX_ENTITIES);

  // --- Internos ---
  /** Entrada aplicada neste tick (passo 1) e a do tick anterior (bordas de botão). */
  readonly inButtons = new Uint16Array(MAX_ENTITIES);
  readonly prevButtons = new Uint16Array(MAX_ENTITIES);
  readonly inMoveX = new Float32Array(MAX_ENTITIES);
  readonly inMoveY = new Float32Array(MAX_ENTITIES);
  readonly inWeapon = new Uint8Array(MAX_ENTITIES);
  /** Primária escolhida para o PRÓXIMO spawn (código; vem de `InputFrame.primary` ou de `SimConfig.primaries`). */
  readonly primaryChoice = new Uint8Array(MAX_ENTITIES);
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
  /** Tiros seguidos da rajada atual (o padrão horizontal do recuo anda por ele; zera quando o recuo volta). */
  readonly burstShots = new Uint16Array(MAX_ENTITIES);
  /** Granada sendo cozida: ticks de pavio que sobram, ou -1 (não está cozinhando). */
  readonly cookTicks = new Int32Array(MAX_ENTITIES).fill(-1);
  /** Vida e spawn. */
  readonly respawnTicks = new Int32Array(MAX_ENTITIES);
  readonly spawnProtectTicks = new Int32Array(MAX_ENTITIES);
  readonly lastDamageTick = new Int32Array(MAX_ENTITIES).fill(-1_000_000);
  readonly lastAttacker = new Uint32Array(MAX_ENTITIES);
  /**
   * M2 (fase 2a): os `RECENT_ATTACKERS` últimos inimigos que feriram o bobo nesta vida (passo `RECENT_ATTACKERS`):
   * quem (EntityId, `NULL_ENTITY` = vazio), o dano somado na janela da assistência e o tick do último golpe.
   */
  readonly recentFrom = new Uint32Array(MAX_ENTITIES * RECENT_ATTACKERS);
  readonly recentDamage = new Float32Array(MAX_ENTITIES * RECENT_ATTACKERS);
  readonly recentTick = new Int32Array(MAX_ENTITIES * RECENT_ATTACKERS);
  /** M2 (fase 2b): quantas vezes o bobo usou o Destravar nesta vida (o bot renasce na 3ª). */
  readonly unstuckCount = new Uint8Array(MAX_ENTITIES);

  /** Controlador → entidade (EntityId com geração), `NULL_ENTITY` se não houver. Cobre humanos, bots e zumbis. */
  readonly controllerEntity = new Uint32Array(MAX_CONTROLLERS_WITH_ZOMBIES);

  readonly fields: readonly StateField[];

  // --- Projéteis (M2, fase 1b): pool fixo, separado das entidades ---
  /** Maior índice de projétil em uso + 1. */
  projCount = 0;
  readonly projAlive = new Uint8Array(MAX_PROJECTILES);
  /** Código da arma que lançou (foguete ou granada). */
  readonly projWeapon = new Uint8Array(MAX_PROJECTILES);
  /** Quem lançou (EntityId com geração): o dano e o abate vão para ele. */
  readonly projOwner = new Uint32Array(MAX_PROJECTILES);
  readonly projPosition = new Float64Array(MAX_PROJECTILES * 3);
  readonly projPrevPosition = new Float64Array(MAX_PROJECTILES * 3);
  readonly projVelocity = new Float64Array(MAX_PROJECTILES * 3);
  /** Ticks até explodir no ar (pavio da granada; alcance do foguete). */
  readonly projFuseTicks = new Int32Array(MAX_PROJECTILES);
  /** Os campos dos projéteis, na ordem do snapshot e do hash (até `projCount`). */
  readonly projectileFields: readonly StateField[];

  // --- Pickups (M2, fase 2b): pool fixo da caixinha de munição ---
  /** Maior índice de pickup em uso + 1. */
  pickCount = 0;
  readonly pickAlive = new Uint8Array(MAX_PICKUPS);
  /** `PICKUP_KIND`. */
  readonly pickKind = new Uint8Array(MAX_PICKUPS);
  /** 3 por pickup (pés da caixinha, m). */
  readonly pickPosition = new Float64Array(MAX_PICKUPS * 3);
  readonly pickPrevPosition = new Float64Array(MAX_PICKUPS * 3);
  /** Velocidade de queda (m/s; 0 = no chão). */
  readonly pickVelY = new Float64Array(MAX_PICKUPS);
  /** Ticks até sumir. */
  readonly pickTicks = new Int32Array(MAX_PICKUPS);
  /** Os campos dos pickups, na ordem do snapshot e do hash (até `pickCount`). */
  readonly pickupFields: readonly StateField[];
  /** M3 (fase 2a): o tipo de cada zumbi do Bobo Zombies (`ZOMBIE_TYPE`). */
  readonly zombieType = new Uint8Array(MAX_ENTITIES);
  /** M3 (fase 2b): os pontos de cada bobo no Bobo Zombies. */
  readonly points = new Int32Array(MAX_ENTITIES);
  /**
   * M3 (fase 2c): o bobo caído: ticks até sangrar (ou até levantar sozinho, com `selfUp` 1), o progresso do reviver e
   * quem está levantando.
   */
  readonly downTicks = new Int32Array(MAX_ENTITIES);
  readonly selfUp = new Uint8Array(MAX_ENTITIES);
  readonly reviveTicks = new Int32Array(MAX_ENTITIES);
  readonly reviver = new Uint32Array(MAX_ENTITIES);
  /**
   * M3 (fase 2a): os campos que só existem no Bobo Zombies. Entram no snapshot e no hash só nesse modo (o golden dos
   * outros modos não muda).
   */
  readonly zombieFields: readonly StateField[];

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
      f('slot', this.slot),
      f('loadout', this.loadout, WEAPON_SLOT_COUNT),
      f('slotClip', this.slotClip, WEAPON_SLOT_COUNT),
      f('slotReserve', this.slotReserve, WEAPON_SLOT_COUNT),
      f('adsAmount', this.adsAmount),
      f('kills', this.kills),
      f('deaths', this.deaths),
      f('assists', this.assists),
      f('recoilPitch', this.recoilPitch),
      f('recoilYaw', this.recoilYaw),
      f('inButtons', this.inButtons),
      f('prevButtons', this.prevButtons),
      f('inMoveX', this.inMoveX),
      f('inMoveY', this.inMoveY),
      f('inWeapon', this.inWeapon),
      f('primaryChoice', this.primaryChoice),
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
      f('burstShots', this.burstShots),
      f('cookTicks', this.cookTicks),
      f('respawnTicks', this.respawnTicks),
      f('spawnProtectTicks', this.spawnProtectTicks),
      f('lastDamageTick', this.lastDamageTick),
      f('lastAttacker', this.lastAttacker),
      f('recentFrom', this.recentFrom, RECENT_ATTACKERS),
      f('recentDamage', this.recentDamage, RECENT_ATTACKERS),
      f('recentTick', this.recentTick, RECENT_ATTACKERS),
      f('unstuckCount', this.unstuckCount),
    ];
    this.projectileFields = [
      f('projAlive', this.projAlive),
      f('projWeapon', this.projWeapon),
      f('projOwner', this.projOwner),
      f('projPosition', this.projPosition, 3),
      f('projPrevPosition', this.projPrevPosition, 3),
      f('projVelocity', this.projVelocity, 3),
      f('projFuseTicks', this.projFuseTicks),
    ];
    this.pickupFields = [
      f('pickAlive', this.pickAlive),
      f('pickKind', this.pickKind),
      f('pickPosition', this.pickPosition, 3),
      f('pickPrevPosition', this.pickPrevPosition, 3),
      f('pickVelY', this.pickVelY),
      f('pickTicks', this.pickTicks),
    ];
    this.zombieFields = [
      f('zombieType', this.zombieType),
      f('points', this.points),
      f('downTicks', this.downTicks),
      f('selfUp', this.selfUp),
      f('reviveTicks', this.reviveTicks),
      f('reviver', this.reviver),
    ];
  }

  /** Projétil num slot livre (`projAlive` ligado); -1 = pool cheio. */
  allocateProjectile(): number {
    for (let i = 0; i < MAX_PROJECTILES; i++) {
      if (this.projAlive[i] === 0) {
        this.projAlive[i] = 1;
        if (i + 1 > this.projCount) this.projCount = i + 1;
        return i;
      }
    }
    return -1;
  }

  /** Solta o projétil `i` e encolhe `projCount` até o último vivo. */
  freeProjectile(i: number): void {
    this.projAlive[i] = 0;
    while (this.projCount > 0 && this.projAlive[this.projCount - 1] === 0) this.projCount--;
  }

  /** Pickup num slot livre (`pickAlive` ligado); -1 = pool cheio. */
  allocatePickup(): number {
    for (let i = 0; i < MAX_PICKUPS; i++) {
      if (this.pickAlive[i] === 0) {
        this.pickAlive[i] = 1;
        if (i + 1 > this.pickCount) this.pickCount = i + 1;
        return i;
      }
    }
    return -1;
  }

  /** Solta o pickup `i` e encolhe `pickCount` até o último vivo. */
  freePickup(i: number): void {
    this.pickAlive[i] = 0;
    while (this.pickCount > 0 && this.pickAlive[this.pickCount - 1] === 0) this.pickCount--;
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
