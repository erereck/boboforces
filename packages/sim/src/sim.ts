import {
  createFigureGameTable,
  DEFAULT_BOT_RULES,
  ZOMBIES_DEFAULTS,
  resolveBot,
  type FigureGameTable,
  type MatchRecipe,
} from '@boboforces/format';
import { dequantizeAxis, type InputFrame } from '@boboforces/input';
import {
  assert,
  createRng,
  i16ToPitch,
  StateHasher,
  u16ToYaw,
  type BitReader,
  type BitWriter,
  type Disposable,
} from '@boboforces/shared';
import type { NavGrid } from '@boboforces/nav';
import { BLOCK_SIZE, type BlockRegistry, type StaticColliders, type WorldGrid } from '@boboforces/world';
import { BASE_HP, METRICS } from './config/metrics.ts';
import { resolveMovementProfile } from './config/movement.ts';
import { MATCH_DEFAULTS } from './config/rules.ts';
import { DEFAULT_PRIMARY, isPrimaryWeapon, WEAPONS } from './config/weapons.ts';
import { ZOMBIE_RULES, MOVEMENT_ZOMBIE, MOVEMENT_ZOMBIE_RUNNER, ZOMBIES_MODE } from './config/zombie.ts';
import {
  MAX_CONTROLLERS_WITH_ZOMBIES,
  MAX_ENTITIES,
  MAX_TEAMS,
  MAX_ZOMBIES,
  secondsToTicks,
  SIM_HZ,
  ZOMBIE_CONTROLLER_BASE,
} from './constants.ts';
import {
  AMMO_RULE,
  DamageQueue,
  DEFAULT_MATCH_MODS,
  RULE_FLAG,
  type EntityRules,
  type MatchMods,
  type MatchState,
  type SimContext,
} from './context.ts';
import { ENTITY_FLAG, ENTITY_KIND, NO_TEAM, NULL_ENTITY, type EntityId } from './entity.ts';
import { EventQueue } from './event-queue.ts';
import { bindFigureTable, FigureHitCache, unbindFigureTable } from './hitbox.ts';
import type { SimEvent } from './events.ts';
import { expandRecipe, isFfaMode, isWarfareMode } from './recipe.ts';
import { hashState, readState, writeState } from './snapshot.ts';
import { SimState } from './state.ts';
import { damageSystem, respawn, rulesSystem, spawnSystem } from './systems/life.ts';
import { zombiesSystem } from './systems/zombies.ts';
import { meleeSystem } from './systems/melee.ts';
import { projectileSystem } from './systems/projectiles.ts';
import { movementSystem } from './systems/movement.ts';
import { pickupSystem } from './systems/pickups.ts';
import { unstuckSystem } from './systems/unstuck.ts';
import { weaponSystem } from './systems/weapons.ts';
import type { MatchView, PickupView, ProjectileView, SimView } from './view.ts';

/** Ponto de spawn declarado pelo mapa (metros, radianos). `team` = -1 para FFA/qualquer time. */
export interface SpawnPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly team: number;
}

/**
 * O que a sim precisa do mapa. M1: sai do `.bfmap` (o `game` monta: grade, registro pela tabela do mapa, spawns dos
 * marcadores, colisores das props e a grade de navegação); o M0 e os testes montam na mão (sem os opcionais).
 */
export interface SimMap {
  readonly grid: WorldGrid;
  readonly blocks: BlockRegistry;
  readonly spawns: readonly SpawnPoint[];
  /** M1: caixas das props (colisão e raios); ausente = só a grade. */
  readonly colliders?: StaticColliders;
  /** M1: navegação (a IA usa; a sim só repassa na `SimView`). */
  readonly nav?: NavGrid;
  /** M1: plano de morte em metros (`playArea.killPlaneY` do mapa); ausente = `METRICS.killPlaneBelow` abaixo do bloco mais baixo. */
  readonly killPlaneY?: number;
  /** M1: área jogável (paredes invisíveis em X/Z, metros); ausente = a grade inteira. */
  readonly playArea?: { readonly minX: number; readonly minZ: number; readonly maxX: number; readonly maxZ: number };
}

export interface SimConfig {
  /** A ÚNICA entrada de regras (já validada por `format`). A semente dela é a raiz dos RNGs. */
  readonly recipe: MatchRecipe;
  readonly map: SimMap;
  /** Humanos que ocupam os controladores 0..humans-1 (0 no golden e no robô de balanceamento). */
  readonly humans: number;
  /**
   * Ticks por segundo (padrão `SIM_HZ` = 60). O Switch pode cair para 30 se o Teste Zero exigir: todo dado é em
   * unidades/s e a física e a cadência são integradas sem depender do passo (`movement.test` e `sim.test` conferem).
   */
  readonly hz?: number;
  /**
   * M1: zumbis do teste de estresse (0..`MAX_ZOMBIES`, padrão 0). Entidades `ENTITY_KIND.zombie`, hostis a todos,
   * nos controladores a partir de `ZOMBIE_CONTROLLER_BASE`, nascendo nos spawns de qualquer time. Não fazem parte da
   * receita (`preset@1`): são parâmetro do bench.
   */
  readonly zombies?: number;
  /**
   * Tabela de jogo do boneco (#56, PLANO do porte §B3): o `game` monta UMA vez no loading e passa o mesmo objeto à sim
   * e ao render (`Renderer.setFigures`). Ausente = o `createSim` monta a sua na criação (testes, golden, balance,
   * mapc), nunca no 1º raio. A sim tira dela as 12 hitboxes (postura × pitch) e a mira da IA; liga a tabela às funções
   * livres (`bindFigureTable`) e solta no `dispose` (regra 21). Quem cria muitas sims seguidas (o robô de
   * balanceamento) passa a mesma tabela a todas.
   */
  readonly figureTable?: FigureGameTable;
  /**
   * M2: primária de cada controlador no 1º spawn (código da arma; índice = controlador). Ausente ou inválida = o
   * fuzil. Depois do 1º spawn a escolha vem de `InputFrame.primary` e vale no próximo spawn.
   */
  readonly primaries?: ReadonlyArray<number>;
  /**
   * M2 (fase 2a): contagem antes da partida, em segundos (padrão 0: começa jogando). Na contagem (fase `warmup`) dá
   * para olhar em volta, mas a sim ignora o resto da entrada e o relógio não corre. O `game` passa
   * `MATCH_DEFAULTS.countdownS` nas partidas de verdade.
   */
  readonly countdownS?: number;
}

/** Referência a um snapshot já confirmado (delta do online, M5). */
export interface SnapshotRef {
  readonly tick: number;
}

/**
 * Fronteira da sim (tecnico.md §4.4). Headless, determinística na mesma build/plataforma, sem relógio e sem
 * alocação no laço quente. Ordem fixa por tick: aplicar inputs → movimento/colisão → armas → projéteis → dano/morte →
 * regras do modo → spawns → eventos. A IA roda FORA (antes do `step`) e entrega InputFrames como um humano.
 */
export interface Sim extends Disposable {
  readonly tick: number;
  /** Ticks por segundo desta partida (o laço de passo fixo e a IA usam o mesmo). */
  readonly hz: number;
  /**
   * Avança exatamente 1 tick. `inputs[c]` é o frame do controlador `c` (0..3 humanos, 4.. bots, ver
   * `BOT_CONTROLLER_BASE`); `null` = sem input neste tick (repete o último estado de botões soltos).
   */
  step(inputs: ReadonlyArray<Readonly<InputFrame> | null>): void;
  view(): SimView;
  /** Move os eventos do último tick para `out` (sem limpar `out`; quem chama zera o array). */
  drainEvents(out: SimEvent[]): void;
  /** Entidade do controlador, ou `NULL_ENTITY` se não houver (morto aguardando respawn mantém o id). */
  controllerEntity(controller: number): EntityId;
  /**
   * Maior índice de controlador em uso + 1 (os índices não são contíguos: humanos em 0..3, bots a partir de 4). É o
   * tamanho mínimo do array de `step(inputs)`.
   */
  readonly controllerCount: number;
  /** Hash do estado completo (teste golden: 3.600 ticks com hash estável). */
  stateHash(): number;
  writeSnapshot(w: BitWriter, baseline?: SnapshotRef): void;
  readSnapshot(r: BitReader): void;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** O componente conexo com mais nós (o Destravar só manda para ele; ilhas soltas não servem). Só na criação. */
function mainComponent(nav: NavGrid): number {
  const counts = new Map<number, number>();
  let best = -1;
  let bestCount = 0;
  for (let n = 0; n < nav.nodeCount; n++) {
    if (nav.clearance[n] !== 1) continue;
    const c = nav.component[n]!;
    const k = (counts.get(c) ?? 0) + 1;
    counts.set(c, k);
    if (k > bestCount || (k === bestCount && c < best)) {
      best = c;
      bestCount = k;
    }
  }
  return best;
}

/** Regras no padrão (vida da partida, ×1, sem restrição) para todas as entidades. Só na criação. */
function createEntityRules(maxHp: number): EntityRules {
  return {
    maxHp: new Float32Array(MAX_ENTITIES).fill(maxHp),
    damageMult: new Float32Array(MAX_ENTITIES).fill(1),
    speed: new Float32Array(MAX_ENTITIES).fill(1),
    ammo: new Uint8Array(MAX_ENTITIES),
    weaponMask: new Uint16Array(MAX_ENTITIES),
    flags: new Uint8Array(MAX_ENTITIES),
  };
}

/**
 * Regras do bot `e` (gameplay.md §6.5). A vida do bot só troca a da partida quando a regra muda o padrão (100): um
 * preset com 150 de vida dá 150 também aos bots sem regra.
 */
function applyBotRules(r: EntityRules, e: number, rules: typeof DEFAULT_BOT_RULES, matchHp: number): void {
  r.maxHp[e] = rules.hp !== DEFAULT_BOT_RULES.hp ? rules.hp : matchHp;
  r.damageMult[e] = rules.damageMult;
  r.speed[e] = rules.speed;
  r.ammo[e] =
    rules.ammo === 'infiniteClip'
      ? AMMO_RULE.infiniteClip
      : rules.ammo === 'infiniteReserve'
        ? AMMO_RULE.infiniteReserve
        : AMMO_RULE.normal;
  let mask = 0;
  for (const id of rules.weapons) {
    const code = WEAPONS.findIndex((w) => w.id === id);
    if (code >= 0) mask |= 1 << code;
  }
  r.weaponMask[e] = mask;
  r.flags[e] =
    (rules.headshotImmune ? RULE_FLAG.headshotImmune : 0) | (rules.explodeOnDeath ? RULE_FLAG.explodeOnDeath : 0);
}

/** M2 (fase 4e): regeneração da receita, em fração da padrão (25/s). */
const REGEN_FACTOR = { off: 0, slow: 0.5, default: 1, fast: 2 } as const;

/** M2 (fase 4e): os modificadores de arma da receita, sobre os padrões. */
function matchModsOf(recipe: MatchRecipe): MatchMods {
  const w = recipe.weapons;
  if (w === undefined) return DEFAULT_MATCH_MODS;
  const d = DEFAULT_MATCH_MODS;
  return {
    damageMul: w.damageMul ?? d.damageMul,
    headshotOnly: w.headshotOnly ?? d.headshotOnly,
    oneShot: w.oneShot ?? d.oneShot,
    ads: w.ads ?? d.ads,
    recoil: w.recoil ?? d.recoil,
    spread: w.spread ?? d.spread,
    friendlyFire: w.friendlyFire ?? d.friendlyFire,
    selfDamage: w.selfDamage ?? d.selfDamage,
    sniperBodyKill: w.sniperBodyKill ?? d.sniperBodyKill,
  };
}

/**
 * M2 (fase 4e): munição e armas permitidas da partida valem para todos (humanos e bots). Com regra do bot também, a
 * munição fica a mais generosa e as armas, a interseção (se não sobrar nenhuma, valem as da partida).
 */
function applyMatchWeaponRules(r: EntityRules, e: number, recipe: MatchRecipe): void {
  const w = recipe.weapons;
  if (w === undefined) return;
  if (w.ammo === 'infiniteClip') r.ammo[e] = AMMO_RULE.infiniteClip;
  else if (w.ammo === 'infiniteReserve' && r.ammo[e] !== AMMO_RULE.infiniteClip) r.ammo[e] = AMMO_RULE.infiniteReserve;
  if (w.allowed !== undefined && w.allowed.length > 0) {
    let mask = 0;
    for (const id of w.allowed) {
      const code = WEAPONS.findIndex((def) => def.id === id);
      if (code >= 0) mask |= 1 << code;
    }
    const both = r.weaponMask[e]! & mask;
    r.weaponMask[e] = r.weaponMask[e] === 0 || both === 0 ? mask : both;
  }
}

/** Menor Y (m) com bloco na grade; o plano de morte fica `METRICS.killPlaneBelow` abaixo dele. */
function lowestBlockY(grid: WorldGrid): number {
  for (let y = 0; y < grid.sizeY; y++) {
    for (let z = 0; z < grid.sizeZ; z++) {
      for (let x = 0; x < grid.sizeX; x++) if (grid.get(x, y, z) !== 0) return y * BLOCK_SIZE;
    }
  }
  return 0;
}

/**
 * Spawns iniciais dos zumbis: os pontos (de qualquer time) ordenados do mais longe ao mais perto dos bobos já postos;
 * o i-ésimo zumbi vai para o i-ésimo da metade mais longe (em rodízio). Só no construtor.
 */
function zombieSpawnOrder(spawns: readonly SpawnPoint[], s: SimState): number[] {
  const score = spawns.map((sp) => {
    let best = Infinity;
    for (let j = 0; j < s.count; j++) {
      if (s.alive[j] === 0 || s.kind[j] !== ENTITY_KIND.bobo) continue;
      const dx = s.position[j * 3]! - sp.x;
      const dz = s.position[j * 3 + 2]! - sp.z;
      best = Math.min(best, dx * dx + dz * dz);
    }
    return best;
  });
  const order = spawns.map((_, i) => i).sort((a, b) => score[b]! - score[a]! || a - b);
  return order.slice(0, Math.max(1, Math.ceil(order.length / 2)));
}

/**
 * Spawn inicial: o k-ésimo membro do time vai para o k-ésimo ponto do time (sem empilhar ninguém no tick 0). M2 (fase
 * 5d): no Bobo Training, os bots (fora do time do jogador) usam os pontos sem time, espalhados como no respawn.
 */
function initialSpawn(spawns: readonly SpawnPoint[], team: number, ffa: boolean, k: number, spread = false): number {
  const own: number[] = [];
  const any: number[] = [];
  spawns.forEach((sp, i) => {
    if (!ffa && sp.team === team) own.push(i);
    if (sp.team === -1) any.push(i);
  });
  const list = spread && any.length > 0 ? any : own.length > 0 ? own : any.length > 0 ? any : spawns.map((_, i) => i);
  return list[k % list.length]!;
}

/**
 * Cria a sim de uma partida. Tudo é alocado aqui (typed arrays com capacidade fixa, pools de eventos, fila de dano);
 * `step()` não aloca. Os bobos (um por controlador da receita) nascem já no construtor, com os eventos `spawn` e
 * `matchPhase` entregues junto com os do primeiro tick.
 */
export function createSim(config: SimConfig): Sim {
  const { recipe, map, humans } = config;
  // M3 (fase 2a): no Bobo Zombies, `zombies` é o pool (o teto do aparelho); os zumbis começam fora de jogo.
  const zombiesMode = recipe.mode === 'zombies';
  const zombies = config.zombies ?? (zombiesMode ? ZOMBIES_MODE.poolDefault : 0);
  assert(map.spawns.length > 0, 'sim: o mapa precisa de pelo menos 1 spawn');
  assert(Number.isInteger(zombies) && zombies >= 0 && zombies <= MAX_ZOMBIES, `sim: 0 a ${MAX_ZOMBIES} zumbis`);
  const slots = expandRecipe(recipe, humans);
  const root = createRng(recipe.seed);
  const s = new SimState();
  const events = new EventQueue();
  const hz = config.hz ?? SIM_HZ;
  assert(Number.isInteger(hz) && hz >= 10 && hz <= 240, `sim: hz inválido (${hz})`);
  // Tabela de jogo do boneco: a da partida, ou montada aqui (na criação; nunca no 1º raio).
  const figureTable = config.figureTable ?? createFigureGameTable();
  const timeLimitS = recipe.match?.timeLimitS ?? 0;
  const countdownS = config.countdownS ?? 0;
  assert(Number.isFinite(countdownS) && countdownS >= 0 && countdownS <= 30, `sim: contagem inválida (${countdownS})`);
  const countdownTicks = secondsToTicks(countdownS, hz);
  const match: MatchState = {
    phase: countdownTicks > 0 ? 'warmup' : 'playing',
    ticksLeft: timeLimitS > 0 ? Math.max(1, secondsToTicks(timeLimitS, hz)) : -1,
    countdownTicks,
    teamScore: new Int32Array(MAX_TEAMS),
    winnerTeam: -1,
    winnerEntity: NULL_ENTITY,
  };
  const ctx: SimContext = {
    s,
    events,
    damage: new DamageQueue(MAX_ENTITIES),
    match,
    grid: map.grid,
    blocks: map.blocks,
    colliders: map.colliders ?? null,
    spawns: map.spawns,
    // M0/M1: só o perfil Bobo existe; os outros ids caem nele até o M2.
    profile: resolveMovementProfile(recipe.players),
    zombieProfile: MOVEMENT_ZOMBIE,
    ffa: isFfaMode(recipe.mode),
    warfare: isWarfareMode(recipe.mode),
    training: recipe.mode === 'training',
    hz,
    dt: 1 / hz,
    tick: 0,
    maxHp: recipe.players?.hp ?? BASE_HP,
    respawnTicks: Math.max(1, secondsToTicks(recipe.players?.respawnS ?? MATCH_DEFAULTS.respawnS, hz)),
    spawnProtectTicks: secondsToTicks(recipe.players?.spawnProtectionS ?? MATCH_DEFAULTS.spawnProtectionS, hz),
    regenDelayTicks: secondsToTicks(MATCH_DEFAULTS.regenDelayS, hz),
    regenPerTick: (MATCH_DEFAULTS.regenPerS * REGEN_FACTOR[recipe.players?.regen ?? 'default']) / hz,
    scoreLimit: recipe.match?.scoreLimit ?? 0,
    suddenDeathTicks: secondsToTicks(MATCH_DEFAULTS.suddenDeathS, hz),
    assistWindowTicks: secondsToTicks(MATCH_DEFAULTS.assistWindowS, hz),
    assistMinDamage: MATCH_DEFAULTS.assistMinDamage,
    killPlaneCreditTicks: secondsToTicks(MATCH_DEFAULTS.killPlaneCreditS, hz),
    spawnScore: new Float64Array(map.spawns.length),
    spawnMark: new Uint8Array(map.spawns.length),
    nav: map.nav ?? null,
    navMainComponent: map.nav ? mainComponent(map.nav) : -1,
    ammoBoxTicks: secondsToTicks(MATCH_DEFAULTS.ammoBoxLifeS, hz),
    rules: createEntityRules(recipe.players?.hp ?? BASE_HP),
    mods: matchModsOf(recipe),
    killPlaneY: map.killPlaneY ?? lowestBlockY(map.grid) - METRICS.killPlaneBelow,
    playArea: map.playArea ?? null,
    zombieHp: ZOMBIE_RULES.hp,
    zombieRespawnTicks: Math.max(1, secondsToTicks(ZOMBIE_RULES.respawnS, hz)),
    rngSpawn: root.fork('spawn'),
    rngWeapons: root.fork('weapons'),
    // Um slot de caixas por controlador (todo corpo de bobo ou zumbi tem um).
    figures: new FigureHitCache(figureTable, MAX_CONTROLLERS_WITH_ZOMBIES),
    zombiesMode,
    zombieRunProfile: MOVEMENT_ZOMBIE_RUNNER,
    zombieRules: {
      waves: recipe.zombies?.waves ?? ZOMBIES_DEFAULTS.waves,
      quantity: recipe.zombies?.quantity ?? ZOMBIES_DEFAULTS.quantity,
      hpMul: recipe.zombies?.hpMul ?? ZOMBIES_DEFAULTS.hpMul,
      firstWaveTicks: Math.max(1, secondsToTicks(ZOMBIES_MODE.firstWaveS, hz)),
      intermissionTicks: Math.max(1, secondsToTicks(ZOMBIES_MODE.intermissionS, hz)),
      spawnIntervalTicks: Math.max(1, secondsToTicks(ZOMBIES_MODE.spawnIntervalS, hz)),
    },
    humans,
    waves: {
      wave: 0,
      resting: 1,
      restTicks: Math.max(1, secondsToTicks(ZOMBIES_MODE.firstWaveS, hz)),
      toSpawn: 0,
      spawnTicks: 0,
      waveHp: ZOMBIE_RULES.hp,
      runChance: 0,
      left: 0,
      lastZombie: NULL_ENTITY,
    },
    rngZombies: root.fork('zombies'),
  };

  const perTeam = new Int32Array(MAX_TEAMS);
  let controllerCount = 0;
  slots.forEach((slot, i) => {
    const id = s.allocate(ENTITY_KIND.bobo, slot.team, slot.controller);
    assert(id !== NULL_ENTITY, 'sim: sem slot de entidade');
    s.controllerEntity[slot.controller] = id;
    s.primaryChoice[id & 0xffff] = config.primaries?.[slot.controller] ?? DEFAULT_PRIMARY;
    if (slot.bot !== null) applyBotRules(ctx.rules, id & 0xffff, resolveBot(recipe, slot.bot).rules, ctx.maxHp);
    applyMatchWeaponRules(ctx.rules, id & 0xffff, recipe);
    const k = perTeam[slot.team]!;
    perTeam[slot.team] = k + 1;
    respawn(
      ctx,
      id & 0xffff,
      initialSpawn(map.spawns, slot.team, ctx.ffa, ctx.ffa ? i : k, ctx.training && slot.team !== 0),
    );
    controllerCount = Math.max(controllerCount, slot.controller + 1);
  });
  if (zombies > 0) {
    const order = zombieSpawnOrder(map.spawns, s);
    for (let i = 0; i < zombies; i++) {
      const controller = ZOMBIE_CONTROLLER_BASE + i;
      const id = s.allocate(ENTITY_KIND.zombie, NO_TEAM, controller);
      assert(id !== NULL_ENTITY, 'sim: sem slot de entidade');
      s.controllerEntity[controller] = id;
      if (zombiesMode) {
        // Fora de jogo até o diretor de ondas soltar (morto e sem contagem de renascer).
        const e = id & 0xffff;
        s.flags[e] = ENTITY_FLAG.dead;
        s.respawnTicks[e] = 0;
      } else respawn(ctx, id & 0xffff, order[i % order.length]!);
      controllerCount = controller + 1;
    }
  }
  events.matchPhase(0, match.phase);
  bindFigureTable(figureTable);

  const matchView: Mutable<MatchView> = {
    phase: match.phase,
    ticksLeft: match.ticksLeft,
    countdownTicks: match.countdownTicks,
    teamScore: match.teamScore,
    winnerTeam: match.winnerTeam,
    winnerEntity: match.winnerEntity,
    zombieWave: 0,
    zombiesLeft: 0,
    zombieRestTicks: -1,
    lastZombie: NULL_ENTITY,
  };
  const projView: Mutable<ProjectileView> = {
    count: 0,
    alive: s.projAlive,
    weapon: s.projWeapon,
    owner: s.projOwner,
    position: s.projPosition,
    prevPosition: s.projPrevPosition,
    velocity: s.projVelocity,
  };
  const pickView: Mutable<PickupView> = {
    count: 0,
    alive: s.pickAlive,
    kind: s.pickKind,
    position: s.pickPosition,
    prevPosition: s.pickPrevPosition,
    ticksLeft: s.pickTicks,
  };
  const view: Mutable<SimView> = {
    tick: 0,
    capacity: s.capacity,
    count: s.count,
    alive: s.alive,
    generation: s.generation,
    kind: s.kind,
    team: s.team,
    flags: s.flags,
    controller: s.controller,
    position: s.position,
    prevPosition: s.prevPosition,
    velocity: s.velocity,
    yaw: s.yaw,
    prevYaw: s.prevYaw,
    pitch: s.pitch,
    prevPitch: s.prevPitch,
    health: s.health,
    zombieType: s.zombieType,
    weapon: s.weapon,
    slot: s.slot,
    loadout: s.loadout,
    slotClip: s.slotClip,
    slotReserve: s.slotReserve,
    adsAmount: s.adsAmount,
    kills: s.kills,
    deaths: s.deaths,
    assists: s.assists,
    respawnTicks: s.respawnTicks,
    lastAttacker: s.lastAttacker,
    recoilPitch: s.recoilPitch,
    recoilYaw: s.recoilYaw,
    projectiles: projView,
    pickups: pickView,
    match: matchView,
    world: map.grid,
    blocks: map.blocks,
    colliders: map.colliders ?? null,
    nav: map.nav ?? null,
    playArea: map.playArea ?? null,
    mods: ctx.mods,
  };
  const syncView = (): void => {
    view.tick = ctx.tick;
    view.count = s.count;
    projView.count = s.projCount;
    pickView.count = s.pickCount;
    matchView.phase = match.phase;
    matchView.ticksLeft = match.ticksLeft;
    matchView.countdownTicks = match.countdownTicks;
    matchView.winnerTeam = match.winnerTeam;
    matchView.winnerEntity = match.winnerEntity;
    if (zombiesMode) {
      const w = ctx.waves;
      matchView.zombieWave = w.wave;
      matchView.zombiesLeft = w.left;
      matchView.zombieRestTicks = w.resting === 1 ? w.restTicks : -1;
      matchView.lastZombie = w.lastZombie;
    }
  };

  const hasher = new StateHasher();
  /** Os eventos do construtor (spawns, fase) saem junto com os do primeiro tick. */
  let keepEvents = true;
  let disposed = false;

  /** Passo 1: aplica os InputFrames (mira absoluta; botões guardados para detectar bordas). */
  const applyInputs = (inputs: ReadonlyArray<Readonly<InputFrame> | null>): void => {
    for (let c = 0; c < controllerCount; c++) {
      const id = s.controllerEntity[c]!;
      if (id === NULL_ENTITY) continue;
      const e = id & 0xffff;
      s.prevButtons[e] = s.inButtons[e]!;
      const f = c < inputs.length ? (inputs[c] ?? null) : null;
      if (f === null) {
        s.inButtons[e] = 0;
        s.inMoveX[e] = 0;
        s.inMoveY[e] = 0;
        continue;
      }
      // Contagem inicial: só a mira e a primária valem (a troca de arma pedida agora entra quando a partida começar).
      const frozen = match.phase === 'warmup';
      s.inButtons[e] = frozen ? 0 : f.buttons & 0xffff;
      s.inMoveX[e] = frozen ? 0 : dequantizeAxis(f.moveX);
      s.inMoveY[e] = frozen ? 0 : dequantizeAxis(f.moveY);
      if (!frozen) s.inWeapon[e] = f.weapon & 0xff;
      // Primária do próximo spawn: código + 1 (0 = manter); código que não é primária é ignorado.
      const p = (f.primary & 0xff) - 1;
      if (p >= 0 && isPrimaryWeapon(p)) s.primaryChoice[e] = p;
      if ((s.flags[e]! & ENTITY_FLAG.dead) === 0) {
        s.yaw[e] = u16ToYaw(f.yaw);
        s.pitch[e] = i16ToPitch(f.pitch);
      }
    }
  };

  return {
    hz,
    get tick(): number {
      return ctx.tick;
    },
    controllerCount,
    step(inputs): void {
      assert(!disposed, 'sim: step depois do dispose');
      if (!keepEvents) events.clear();
      keepEvents = false;
      // Estado anterior para o render interpolar.
      for (let e = 0; e < s.count; e++) {
        const e3 = e * 3;
        s.prevPosition[e3] = s.position[e3]!;
        s.prevPosition[e3 + 1] = s.position[e3 + 1]!;
        s.prevPosition[e3 + 2] = s.position[e3 + 2]!;
        s.prevYaw[e] = s.yaw[e]!;
        s.prevPitch[e] = s.pitch[e]!;
      }
      for (let p = 0; p < s.projCount * 3; p++) s.projPrevPosition[p] = s.projPosition[p]!;
      // Ordem fixa (tecnico.md §4.1). (0) IA roda fora, antes do step; (8) o diretor de ondas do Bobo Zombies.
      applyInputs(inputs);
      unstuckSystem(ctx);
      movementSystem(ctx);
      weaponSystem(ctx);
      meleeSystem(ctx);
      projectileSystem(ctx);
      pickupSystem(ctx);
      damageSystem(ctx);
      rulesSystem(ctx);
      spawnSystem(ctx);
      zombiesSystem(ctx);
      ctx.tick++;
      syncView();
    },
    view: () => view,
    drainEvents(out): void {
      events.drain(out);
    },
    controllerEntity(controller): EntityId {
      if (controller < 0 || controller >= MAX_CONTROLLERS_WITH_ZOMBIES) return NULL_ENTITY;
      return s.controllerEntity[controller]!;
    },
    stateHash: () => hashState(ctx, hasher),
    writeSnapshot(w, baseline): void {
      void baseline; // delta contra baseline: M5
      writeState(ctx, w);
    },
    readSnapshot(r): void {
      readState(ctx, r);
      // O tick volta e as posições mudam: as caixas guardadas do tick não valem mais.
      ctx.figures.invalidate();
      events.clear();
      keepEvents = false;
      syncView();
    },
    dispose(): void {
      if (!disposed) {
        unbindFigureTable(figureTable);
        ctx.figures.release();
      }
      disposed = true;
      events.clear();
    },
  };
}
