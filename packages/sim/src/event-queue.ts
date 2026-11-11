import { FIGURE_BONE, type FigurePart } from '@boboforces/format';
import type { BlockId } from '@boboforces/world';
import type { HitPart } from './config/metrics.ts';
import type { EntityId } from './entity.ts';
import type {
  ExplosionEvent,
  HitEvent,
  MeleeEvent,
  ImpactEvent,
  KillEvent,
  MatchPhaseEvent,
  WaveEvent,
  BarricadeEvent,
  DoorEvent,
  PurchaseEvent,
  DownEvent,
  MoveEvent,
  PickupEvent,
  ProjectileEvent,
  ShotEvent,
  SimEvent,
  SpawnEvent,
  UnstuckEvent,
  WeaponEvent,
} from './events.ts';
import type { MatchPhase } from './view.ts';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/**
 * Pool de um tipo de evento: os objetos são reaproveitados a cada tick (regra 11). Se um tick precisar de mais que o
 * pico anterior, cria mais (só acontece até o pool "aquecer").
 */
class EventPool<T> {
  private readonly items: T[] = [];
  private used = 0;
  private readonly create: () => T;

  constructor(create: () => T, initial: number) {
    this.create = create;
    for (let i = 0; i < initial; i++) this.items.push(create());
  }

  acquire(): T {
    if (this.used === this.items.length) this.items.push(this.create());
    return this.items[this.used++]!;
  }

  reset(): void {
    this.used = 0;
  }
}

/**
 * Fila de eventos de UM tick (passo 9 da ordem fixa). `clear()` no começo do `step` recicla os objetos: quem consome
 * precisa drenar depois de cada `step` (ARCHITECTURE §7). A ordem de emissão é a ordem dos sistemas, determinística.
 */
export class EventQueue {
  private readonly list: SimEvent[] = [];
  private length = 0;

  private readonly shots = new EventPool<Mutable<ShotEvent>>(
    () => ({
      type: 'shot',
      tick: 0,
      shooter: 0,
      weapon: 0,
      originX: 0,
      originY: 0,
      originZ: 0,
      dirX: 0,
      dirY: 0,
      dirZ: 0,
      distance: 0,
    }),
    64,
  );
  private readonly hits = new EventPool<Mutable<HitEvent>>(
    () => ({
      type: 'hit',
      tick: 0,
      shooter: 0,
      target: 0,
      part: 'torso',
      bodyPart: FIGURE_BONE.torso,
      damage: 0,
      x: 0,
      y: 0,
      z: 0,
      dirX: 0,
      dirY: 0,
      dirZ: 0,
    }),
    64,
  );
  private readonly kills = new EventPool<Mutable<KillEvent>>(
    () => ({
      type: 'kill',
      tick: 0,
      killer: 0,
      victim: 0,
      weapon: 0,
      headshot: false,
      bodyPart: FIGURE_BONE.torso,
      dirX: 0,
      dirY: 0,
      dirZ: 0,
      force: 0,
      assister: 0,
    }),
    16,
  );
  private readonly impacts = new EventPool<Mutable<ImpactEvent>>(
    () => ({
      type: 'impact',
      tick: 0,
      x: 0,
      y: 0,
      z: 0,
      normalX: 0,
      normalY: 0,
      normalZ: 0,
      cellX: 0,
      cellY: 0,
      cellZ: 0,
      block: 0,
      face: -1,
      prop: -1,
    }),
    64,
  );
  private readonly spawns = new EventPool<Mutable<SpawnEvent>>(() => ({ type: 'spawn', tick: 0, entity: 0 }), 16);
  private readonly moves = new EventPool<Mutable<MoveEvent>>(
    () => ({ type: 'move', tick: 0, entity: 0, move: 'jump', speed: 0 }),
    32,
  );
  private readonly weapons = new EventPool<Mutable<WeaponEvent>>(
    () => ({ type: 'weapon', tick: 0, entity: 0, weapon: 0, action: 'switch' }),
    16,
  );
  private readonly melees = new EventPool<Mutable<MeleeEvent>>(
    () => ({ type: 'melee', tick: 0, attacker: 0, target: 0 }),
    16,
  );
  private readonly phases = new EventPool<Mutable<MatchPhaseEvent>>(
    () => ({ type: 'matchPhase', tick: 0, phase: 'playing' }),
    2,
  );
  private readonly downs = new EventPool<Mutable<DownEvent>>(
    () => ({ type: 'down', tick: 0, entity: 0, by: 0, action: 'down' }),
    4,
  );
  private readonly waves = new EventPool<Mutable<WaveEvent>>(
    () => ({ type: 'wave', tick: 0, wave: 0, action: 'start' }),
    2,
  );
  private readonly barricades = new EventPool<Mutable<BarricadeEvent>>(
    () => ({ type: 'barricade', tick: 0, index: 0, action: 'tear', planks: 0, by: 0 }),
    4,
  );
  private readonly doors = new EventPool<Mutable<DoorEvent>>(
    () => ({ type: 'door', tick: 0, index: 0, action: 'open', cost: 0, by: 0 }),
    2,
  );
  private readonly purchases = new EventPool<Mutable<PurchaseEvent>>(
    () => ({ type: 'purchase', tick: 0, index: 0, kind: 'weapon', action: 'ok', item: 0, cost: 0, by: 0 }),
    2,
  );
  private readonly projectiles = new EventPool<Mutable<ProjectileEvent>>(
    () => ({
      type: 'projectile',
      tick: 0,
      action: 'launch',
      index: 0,
      weapon: 0,
      owner: 0,
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
    }),
    16,
  );
  private readonly explosions = new EventPool<Mutable<ExplosionEvent>>(
    () => ({ type: 'explosion', tick: 0, owner: 0, weapon: 0, x: 0, y: 0, z: 0, radius: 0 }),
    8,
  );
  private readonly pickups = new EventPool<Mutable<PickupEvent>>(
    () => ({ type: 'pickup', tick: 0, action: 'drop', index: 0, entity: 0, x: 0, y: 0, z: 0 }),
    8,
  );
  private readonly unstucks = new EventPool<Mutable<UnstuckEvent>>(
    () => ({
      type: 'unstuck',
      tick: 0,
      entity: 0,
      fromX: 0,
      fromY: 0,
      fromZ: 0,
      x: 0,
      y: 0,
      z: 0,
      respawned: false,
    }),
    2,
  );

  get size(): number {
    return this.length;
  }

  clear(): void {
    this.length = 0;
    this.shots.reset();
    this.hits.reset();
    this.kills.reset();
    this.impacts.reset();
    this.spawns.reset();
    this.moves.reset();
    this.weapons.reset();
    this.melees.reset();
    this.phases.reset();
    this.waves.reset();
    this.barricades.reset();
    this.doors.reset();
    this.purchases.reset();
    this.downs.reset();
    this.projectiles.reset();
    this.explosions.reset();
    this.pickups.reset();
    this.unstucks.reset();
  }

  /** Copia as referências para `out` (sem limpar `out`) e esvazia a fila. Os objetos valem até o próximo `clear`. */
  drain(out: SimEvent[]): void {
    for (let i = 0; i < this.length; i++) out.push(this.list[i]!);
    this.length = 0;
  }

  private push(e: SimEvent): void {
    if (this.length < this.list.length) this.list[this.length] = e;
    else this.list.push(e);
    this.length++;
  }

  shot(
    tick: number,
    shooter: EntityId,
    weapon: number,
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    distance: number,
  ): void {
    const e = this.shots.acquire();
    e.tick = tick;
    e.shooter = shooter;
    e.weapon = weapon;
    e.originX = ox;
    e.originY = oy;
    e.originZ = oz;
    e.dirX = dx;
    e.dirY = dy;
    e.dirZ = dz;
    e.distance = distance;
    this.push(e);
  }

  /** Acerto: ponto e direção do golpe vêm da fila de dano (`DamageQueue`, item `i`). */
  hit(
    tick: number,
    shooter: EntityId,
    target: EntityId,
    part: HitPart,
    bodyPart: FigurePart,
    damage: number,
    point: Float64Array,
    dir: Float64Array,
    i: number,
  ): void {
    const e = this.hits.acquire();
    const i3 = i * 3;
    e.tick = tick;
    e.shooter = shooter;
    e.target = target;
    e.part = part;
    e.bodyPart = bodyPart;
    e.damage = damage;
    e.x = point[i3]!;
    e.y = point[i3 + 1]!;
    e.z = point[i3 + 2]!;
    e.dirX = dir[i3]!;
    e.dirY = dir[i3 + 1]!;
    e.dirZ = dir[i3 + 2]!;
    this.push(e);
  }

  /** Morte: a direção (unitária, zero em queda e plano de morte) e a força vêm do golpe final (item `i` da fila). */
  kill(
    tick: number,
    killer: EntityId,
    victim: EntityId,
    weapon: number,
    headshot: boolean,
    bodyPart: FigurePart,
    dir: Float64Array,
    force: number,
    i: number,
    assister: EntityId,
  ): void {
    const e = this.kills.acquire();
    const i3 = i * 3;
    e.tick = tick;
    e.killer = killer;
    e.victim = victim;
    e.weapon = weapon;
    e.headshot = headshot;
    e.bodyPart = bodyPart;
    e.dirX = dir[i3]!;
    e.dirY = dir[i3 + 1]!;
    e.dirZ = dir[i3 + 2]!;
    e.force = force;
    e.assister = assister;
    this.push(e);
  }

  /**
   * Impacto no cenário. `face` = índice na `NORMAL_TABLE` do world (0..5 eixos; rampas e cruz a partir do 6; -1 em
   * prop ou origem dentro do sólido); `prop` = caixa de prop em `StaticColliders` (-1 = bloco da grade).
   */
  impact(
    tick: number,
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    cx: number,
    cy: number,
    cz: number,
    block: BlockId,
    face: number,
    prop: number,
  ): void {
    const e = this.impacts.acquire();
    e.tick = tick;
    e.x = x;
    e.y = y;
    e.z = z;
    e.normalX = nx;
    e.normalY = ny;
    e.normalZ = nz;
    e.cellX = cx;
    e.cellY = cy;
    e.cellZ = cz;
    e.block = block;
    e.face = face;
    e.prop = prop;
    this.push(e);
  }

  spawn(tick: number, entity: EntityId): void {
    const e = this.spawns.acquire();
    e.tick = tick;
    e.entity = entity;
    this.push(e);
  }

  move(tick: number, entity: EntityId, move: MoveEvent['move'], speed: number): void {
    const e = this.moves.acquire();
    e.tick = tick;
    e.entity = entity;
    e.move = move;
    e.speed = speed;
    this.push(e);
  }

  weapon(tick: number, entity: EntityId, weapon: number, action: WeaponEvent['action']): void {
    const e = this.weapons.acquire();
    e.tick = tick;
    e.entity = entity;
    e.weapon = weapon;
    e.action = action;
    this.push(e);
  }

  melee(tick: number, attacker: EntityId, target: EntityId): void {
    const e = this.melees.acquire();
    e.tick = tick;
    e.attacker = attacker;
    e.target = target;
    this.push(e);
  }

  projectile(
    tick: number,
    action: ProjectileEvent['action'],
    index: number,
    weapon: number,
    owner: EntityId,
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
  ): void {
    const e = this.projectiles.acquire();
    e.tick = tick;
    e.action = action;
    e.index = index;
    e.weapon = weapon;
    e.owner = owner;
    e.x = x;
    e.y = y;
    e.z = z;
    e.vx = vx;
    e.vy = vy;
    e.vz = vz;
    this.push(e);
  }

  explosion(tick: number, owner: EntityId, weapon: number, x: number, y: number, z: number, radius: number): void {
    const e = this.explosions.acquire();
    e.tick = tick;
    e.owner = owner;
    e.weapon = weapon;
    e.x = x;
    e.y = y;
    e.z = z;
    e.radius = radius;
    this.push(e);
  }

  pickup(
    tick: number,
    action: PickupEvent['action'],
    index: number,
    entity: EntityId,
    x: number,
    y: number,
    z: number,
  ): void {
    const e = this.pickups.acquire();
    e.tick = tick;
    e.action = action;
    e.index = index;
    e.entity = entity;
    e.x = x;
    e.y = y;
    e.z = z;
    this.push(e);
  }

  /** Destravar: `from[fromOffset..+2]` é de onde o bobo saiu. */
  unstuck(
    tick: number,
    entity: EntityId,
    from: Float64Array,
    fromOffset: number,
    x: number,
    y: number,
    z: number,
    respawned: boolean,
  ): void {
    const e = this.unstucks.acquire();
    e.tick = tick;
    e.entity = entity;
    e.fromX = from[fromOffset]!;
    e.fromY = from[fromOffset + 1]!;
    e.fromZ = from[fromOffset + 2]!;
    e.x = x;
    e.y = y;
    e.z = z;
    e.respawned = respawned;
    this.push(e);
  }

  matchPhase(tick: number, phase: MatchPhase): void {
    const e = this.phases.acquire();
    e.tick = tick;
    e.phase = phase;
    this.push(e);
  }

  /** M3 (fase 2c). */
  down(tick: number, entity: EntityId, by: EntityId, action: 'down' | 'revive' | 'selfRevive'): void {
    const e = this.downs.acquire();
    e.tick = tick;
    e.entity = entity;
    e.by = by;
    e.action = action;
    this.push(e);
  }

  /** M3 (fase 3d). */
  barricade(tick: number, index: number, action: 'tear' | 'break' | 'repair', planks: number, by: EntityId): void {
    const e = this.barricades.acquire();
    e.tick = tick;
    e.index = index;
    e.action = action;
    e.planks = planks;
    e.by = by;
    this.push(e);
  }

  /** M3 (fase 3d). */
  door(tick: number, index: number, action: 'open' | 'denied', cost: number, by: EntityId): void {
    const e = this.doors.acquire();
    e.tick = tick;
    e.index = index;
    e.action = action;
    e.cost = cost;
    e.by = by;
    this.push(e);
  }

  /** M3 (fase 4a). */
  purchase(
    tick: number,
    index: number,
    kind: 'weapon' | 'ammo',
    action: 'ok' | 'denied',
    item: number,
    cost: number,
    by: EntityId,
  ): void {
    const e = this.purchases.acquire();
    e.tick = tick;
    e.index = index;
    e.kind = kind;
    e.action = action;
    e.item = item;
    e.cost = cost;
    e.by = by;
    this.push(e);
  }

  /** M3 (fase 2a). */
  wave(tick: number, wave: number, action: 'start' | 'clear'): void {
    const e = this.waves.acquire();
    e.tick = tick;
    e.wave = wave;
    e.action = action;
    this.push(e);
  }
}
