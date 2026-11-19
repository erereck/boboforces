import {
  createFigureGameTable,
  DEFAULT_BOT_RULES,
  ZOMBIES_DEFAULTS,
  resolveBot,
  type FigureGameTable,
  type MatchRecipe,
} from '@boboforces/format';
import { BUTTON, dequantizeAxis, type InputFrame } from '@boboforces/input';
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
import { resolveMovementProfile, type MovementProfile } from './config/movement.ts';
import { MATCH_DEFAULTS } from './config/rules.ts';
import { DEFAULT_PRIMARY, isPrimaryWeapon, WEAPONS } from './config/weapons.ts';
import {
  MOVEMENT_DOWNED,
  MOVEMENT_ZOMBIE,
  MOVEMENT_ZOMBIE_RUNNER,
  MOVEMENT_ZOMBIE_SLOW,
  MOVEMENT_ZOMBIE_SPRINTER,
  ZOMBIE_POINTS,
  ZOMBIE_RULES,
  ZOMBIES_DOWN,
  ZOMBIES_MODE,
  ZOMBIE_DROPS,
} from './config/zombie.ts';
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
import { REWIND_HISTORY, REWIND_MAX_S, RewindState } from './rewind.ts';
import { SimState } from './state.ts';
import { damageSystem, finishMatch, respawn, rulesSystem, spawnSystem } from './systems/life.ts';
import { createSignalState, signalSystem } from './systems/signals.ts';
import { ControlPoints, dominationSystem, type ControlPointDef } from './systems/domination.ts';
import { createPartyState, partySystem, syncJuggRules } from './systems/party.ts';
import { zombiesSystem } from './systems/zombies.ts';
import { meleeSystem } from './systems/melee.ts';
import { projectileSystem } from './systems/projectiles.ts';
import { movementSystem, moveOne } from './systems/movement.ts';
import { pickupSystem } from './systems/pickups.ts';
import { unstuckSystem } from './systems/unstuck.ts';
import { weaponSystem } from './systems/weapons.ts';
import type { MatchPhase, MatchView, PickupView, ProjectileView, SimView } from './view.ts';
import {
  MapObjects,
  type BarricadeDef,
  type BoxSpotDef,
  type DoorDef,
  type PerkMachineDef,
  type WallBuyDef,
} from './map-objects.ts';

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
  /** M3 (fase 3d): janelas com barricada do Bobo Zombies (ausente = nenhuma). */
  readonly barricades?: readonly BarricadeDef[];
  /** M3 (fase 3d): portas pagas do Bobo Zombies (ausente = nenhuma). */
  readonly doors?: readonly DoorDef[];
  /** M3 (fase 4a): armas na parede do Bobo Zombies (ausente = nenhuma). */
  readonly wallBuys?: readonly WallBuyDef[];
  /** M3 (fase 4b): posições da Caixa Misteriosa (até 3; a 1ª é onde ela começa; ausente = sem caixa). */
  readonly boxSpots?: readonly BoxSpotDef[];
  /** M3 (fase 4c): máquinas de vantagem do Bobo Zombies (ausente = nenhuma). */
  readonly perkMachines?: readonly PerkMachineDef[];
  /** M6 (fase 1): os pontos do Domination (o centro do anel nos pés e o raio). */
  readonly controlPoints?: readonly ControlPointDef[];
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
  /** M3 (fase 4d): chance de drop por zumbi abatido no Bobo Zombies (padrão `ZOMBIE_DROPS.chance`; testes e robô). */
  readonly dropChance?: number;
}

/** Referência a um snapshot já confirmado (delta do online, M5). */
export interface SnapshotRef {
  readonly tick: number;
}

/** M5 (online): os escalares do estado que o cliente recebe do host (o `net` monta a partir do snapshot). */
export interface SimRemoteState {
  tick: number;
  count: number;
  projCount: number;
  pickCount: number;
  phase: MatchPhase;
  ticksLeft: number;
  countdownTicks: number;
  winnerTeam: number;
  winnerEntity: number;
  zombieWave: number;
  zombiesLeft: number;
  /** -1 = no meio de uma onda (como na `MatchView`). */
  zombieRestTicks: number;
  doublePointsTicks: number;
  instaKillTicks: number;
  lastZombie: number;
  selfRevivesLeft: number;
}

/**
 * M5 (online, só o `net`): o cliente mostra o estado do host em vez de rodar a sim. `begin` copia o estado atual para
 * os `prev*` (o render interpola do snapshot anterior para o novo); entre `begin` e `commit` o `net` escreve os
 * arrays da view (inclusive os de `mapObjects` e o placar em `match.teamScore`), o único que escreve neles fora da
 * sim; `commit` aplica os escalares, refaz a tabela controlador → entidade, devolve tábuas e portas à colisão e
 * sincroniza a view. Os campos internos (cooldowns, botões, RNG) ficam como estão: o cliente não chama `step` enquanto
 * recebe (a predição do próprio movimento é a fase 2 do M5).
 */
export interface SimRemote {
  begin(): void;
  commit(state: Readonly<SimRemoteState>): void;
}

/**
 * M5 (fase 2b): tamanho do estado de movimento de uma entidade (`SimPredict.save`): posição (3), velocidade (3),
 * flags, botões, coiote, pulo guardado, deslize, recarga do deslize, direção do deslize (2), pico do ar e o atraso do
 * tiro depois de correr.
 */
export const PREDICT_STATE_SIZE = 16;

/**
 * M5 (fase 2b, só o cliente online): o cliente prediz o próprio movimento com o mesmo código do `step`. O host manda,
 * só para o dono, o estado de movimento do boneco dele (`save`); o cliente carrega (`load`) e refaz as entradas que o
 * host ainda não tinha usado (`step`, uma por tick). Só o movimento: armas, dano e regras ficam com o host.
 */
export interface SimPredict {
  save(e: number, out: Float64Array): void;
  load(e: number, from: Float64Array): void;
  /** Um tick do movimento de `e` com `frame` (`prev*` ← atual, entrada, movimento); eventos e dano descartados. */
  step(e: number, frame: Readonly<InputFrame>): void;
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
  /** M5: o estado do host escrito por cima (só o cliente online, pelo `net`). */
  readonly remote: SimRemote;
  /** M5 (fase 2b): a predição do próprio movimento (só o cliente online, pelo `net`). */
  readonly predict: SimPredict;
  /** M5 (fase 2d): o "tiro no que eu vi" (só o host online, pelo `net`). */
  readonly rewind: SimRewind;
  /**
   * M5 (fase 5a): encerra a partida agora, com quem está na frente (o evento `matchPhase` sai no próximo `step`). Só o
   * host online, quando volta de mais de 10 s em segundo plano num PvP.
   */
  finish(): void;
}

/**
 * M5 (fase 2d, só o host online): compensação do tiro (tecnico.md §13.3). `enable` liga o histórico (24 ticks, ~1 MB);
 * `set` diz quantos ticks o tiro hitscan de um controlador volta no tempo (o host põe o atraso do que o cliente via,
 * até `maxTicks`: 350 ms, `REWIND_MAX_S`). Só hitscan: foguete, granada e faca são do presente.
 */
export interface SimRewind {
  enable(): void;
  set(controller: number, ticks: number): void;
  readonly maxTicks: number;
  /** Tiros que voltaram no tempo desde o começo. */
  readonly rewound: number;
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

/** M3 (fase 2c): caído, só a pistola (o slot 1 do loadout) e só atirar, mirar e recarregar. */
const DOWNED_SLOT = 1;
const DOWNED_BUTTONS = BUTTON.fire | BUTTON.ads | BUTTON.reload;

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
  // M3 (fase 3d): janelas e portas montam os dois conjuntos de colisão (bobos e zumbis) e os portões da navegação.
  const mapObjects =
    (map.barricades?.length ?? 0) +
      (map.doors?.length ?? 0) +
      (map.wallBuys?.length ?? 0) +
      (map.boxSpots?.length ?? 0) +
      (map.perkMachines?.length ?? 0) >
    0
      ? new MapObjects(
          map.colliders ?? null,
          map.nav ?? null,
          map.barricades ?? [],
          map.doors ?? [],
          map.wallBuys ?? [],
          map.boxSpots ?? [],
          map.perkMachines ?? [],
        )
      : null;
  // M6 (fase 1): os pontos do Domination (só no modo dele e num mapa que os tem).
  const domination =
    recipe.mode === 'warfare.domination' && (map.controlPoints?.length ?? 0) > 0
      ? new ControlPoints(map.controlPoints!)
      : null;
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
    colliders: mapObjects?.boboColliders ?? map.colliders ?? null,
    zombieColliders: mapObjects?.zombieColliders ?? map.colliders ?? null,
    mapObjects,
    domination,
    spawns: map.spawns,
    // M0/M1: só o perfil Bobo existe; os outros ids caem nele até o M2.
    profile: resolveMovementProfile(recipe.players),
    zombieProfile: zombieSpeed(MOVEMENT_ZOMBIE, recipe),
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
    rewind: null,
    signals: createSignalState(MAX_ENTITIES),
    zombiesMode,
    zombieRunProfile: zombieSpeed(MOVEMENT_ZOMBIE_RUNNER, recipe),
    zombieRules: {
      waves: recipe.zombies?.waves ?? ZOMBIES_DEFAULTS.waves,
      quantity: recipe.zombies?.quantity ?? ZOMBIES_DEFAULTS.quantity,
      hpMul: recipe.zombies?.hpMul ?? ZOMBIES_DEFAULTS.hpMul,
      economy: recipe.zombies?.economy ?? ZOMBIES_DEFAULTS.economy,
      firstWaveTicks: Math.max(1, secondsToTicks(ZOMBIES_MODE.firstWaveS, hz)),
      intermissionTicks: Math.max(1, secondsToTicks(ZOMBIES_MODE.intermissionS, hz)),
      spawnIntervalTicks: Math.max(1, secondsToTicks(ZOMBIES_MODE.spawnIntervalS, hz)),
      bleedTicks: Math.max(1, secondsToTicks(ZOMBIES_DOWN.bleedS, hz)),
      reviveTicks: Math.max(1, secondsToTicks(ZOMBIES_DOWN.reviveS, hz)),
      selfReviveTicks: Math.max(1, secondsToTicks(ZOMBIES_DOWN.selfReviveS, hz)),
      selfRevives: recipe.zombies?.selfRevives ?? ZOMBIES_DEFAULTS.selfRevives,
      specials: recipe.zombies?.specials ?? ZOMBIES_DEFAULTS.specials,
      bosses: recipe.zombies?.bosses ?? ZOMBIES_DEFAULTS.bosses,
    },
    humans,
    dropChance: config.dropChance ?? ZOMBIE_DROPS.chance,
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
      selfRevivesLeft: recipe.zombies?.selfRevives ?? ZOMBIES_DEFAULTS.selfRevives,
      bossPending: 0,
      drops: 0,
      doubleTicks: 0,
      instaTicks: 0,
    },
    rngZombies: root.fork('zombies'),
    rngParty: root.fork('party'),
    party: createPartyState(recipe),
    downedProfile: MOVEMENT_DOWNED,
    sprinterProfile: zombieSpeed(MOVEMENT_ZOMBIE_SPRINTER, recipe),
    slowProfile: zombieSpeed(MOVEMENT_ZOMBIE_SLOW, recipe),
  };

  const perTeam = new Int32Array(MAX_TEAMS);
  let controllerCount = 0;
  slots.forEach((slot, i) => {
    // M6 (fase 3, revisão): no Juggernaut todo mundo começa caçando (o time 1 é só do Jugg, que o modo sorteia), mesmo
    // que a sala ou o sofá tenha posto alguém do outro lado.
    const id = s.allocate(ENTITY_KIND.bobo, ctx.party.jugg !== null ? 0 : slot.team, slot.controller);
    assert(id !== NULL_ENTITY, 'sim: sem slot de entidade');
    s.controllerEntity[slot.controller] = id;
    s.primaryChoice[id & 0xffff] = config.primaries?.[slot.controller] ?? DEFAULT_PRIMARY;
    // M3 (fase 2b): os pontos do começo no Bobo Zombies.
    if (zombiesMode) s.points[id & 0xffff] = ZOMBIE_POINTS.start;
    if (slot.bot !== null) applyBotRules(ctx.rules, id & 0xffff, resolveBot(recipe, slot.bot).rules, ctx.maxHp);
    applyMatchWeaponRules(ctx.rules, id & 0xffff, recipe);
    const k = perTeam[slot.team]!;
    perTeam[slot.team] = k + 1;
    // M6 (fase 3): no Juggernaut todo mundo começa espalhado (o Jugg sorteado não nasce no meio dos caçadores).
    const spread = ctx.ffa || ctx.party.jugg !== null;
    respawn(
      ctx,
      id & 0xffff,
      initialSpawn(map.spawns, slot.team, spread, spread ? i : k, ctx.training && slot.team !== 0),
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
    selfRevivesLeft: 0,
    doublePointsTicks: 0,
    instaKillTicks: 0,
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
    bodyScale: s.bodyScale,
    perks: s.perks,
    points: s.points,
    downTicks: s.downTicks,
    selfUp: s.selfUp,
    reviveTicks: s.reviveTicks,
    weapon: s.weapon,
    slot: s.slot,
    loadout: s.loadout,
    slotClip: s.slotClip,
    slotReserve: s.slotReserve,
    cookTicks: s.cookTicks,
    quickNade: s.quickNade,
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
    colliders: ctx.colliders,
    nav: map.nav ?? null,
    mapObjects,
    controlPoints: domination,
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
      matchView.doublePointsTicks = w.doubleTicks;
      matchView.instaKillTicks = w.instaTicks;
      matchView.lastZombie = w.lastZombie;
      matchView.selfRevivesLeft = w.selfRevivesLeft;
    }
  };

  const hasher = new StateHasher();
  /** Os eventos do construtor (spawns, fase) saem junto com os do primeiro tick. */
  let keepEvents = true;
  let disposed = false;

  /** Passo 1 de uma entidade: a entrada do controlador dela (mira absoluta; botões guardados para detectar bordas). */
  const applyInput = (e: number, f: Readonly<InputFrame> | null): void => {
    s.prevButtons[e] = s.inButtons[e]!;
    if (f === null) {
      s.inButtons[e] = 0;
      s.inMoveX[e] = 0;
      s.inMoveY[e] = 0;
      return;
    }
    // Contagem inicial: só a mira e a primária valem (a troca de arma pedida agora entra quando a partida começar).
    const frozen = match.phase === 'warmup';
    s.inButtons[e] = frozen ? 0 : f.buttons & 0xffff;
    s.inMoveX[e] = frozen ? 0 : dequantizeAxis(f.moveX);
    s.inMoveY[e] = frozen ? 0 : dequantizeAxis(f.moveY);
    if (!frozen) s.inWeapon[e] = f.weapon & 0xff;
    if ((s.flags[e]! & ENTITY_FLAG.downed) !== 0) {
      s.inWeapon[e] = DOWNED_SLOT;
      s.inButtons[e] = (s.inButtons[e]! & DOWNED_BUTTONS) | BUTTON.crouch;
    }
    // Primária do próximo spawn: código + 1 (0 = manter); código que não é primária é ignorado.
    const p = (f.primary & 0xff) - 1;
    if (p >= 0 && isPrimaryWeapon(p)) s.primaryChoice[e] = p;
    if ((s.flags[e]! & ENTITY_FLAG.dead) === 0) {
      s.yaw[e] = u16ToYaw(f.yaw);
      s.pitch[e] = i16ToPitch(f.pitch);
    }
  };

  /** Passo 1: aplica os InputFrames de todos os controladores. */
  const applyInputs = (inputs: ReadonlyArray<Readonly<InputFrame> | null>): void => {
    for (let c = 0; c < controllerCount; c++) {
      const id = s.controllerEntity[c]!;
      if (id === NULL_ENTITY) continue;
      applyInput(id & 0xffff, c < inputs.length ? (inputs[c] ?? null) : null);
    }
  };

  const remote: SimRemote = {
    begin(): void {
      for (let e = 0; e < s.count; e++) {
        const e3 = e * 3;
        s.prevPosition[e3] = s.position[e3]!;
        s.prevPosition[e3 + 1] = s.position[e3 + 1]!;
        s.prevPosition[e3 + 2] = s.position[e3 + 2]!;
        s.prevYaw[e] = s.yaw[e]!;
        s.prevPitch[e] = s.pitch[e]!;
      }
      for (let p = 0; p < s.projCount * 3; p++) s.projPrevPosition[p] = s.projPosition[p]!;
      for (let p = 0; p < s.pickCount * 3; p++) s.pickPrevPosition[p] = s.pickPosition[p]!;
    },
    commit(state): void {
      ctx.tick = state.tick;
      s.count = state.count;
      s.projCount = state.projCount;
      s.pickCount = state.pickCount;
      match.phase = state.phase;
      match.ticksLeft = state.ticksLeft;
      match.countdownTicks = state.countdownTicks;
      match.winnerTeam = state.winnerTeam;
      match.winnerEntity = state.winnerEntity;
      if (zombiesMode) {
        const w = ctx.waves;
        w.wave = state.zombieWave;
        w.left = state.zombiesLeft;
        w.resting = state.zombieRestTicks >= 0 ? 1 : 0;
        w.restTicks = Math.max(0, state.zombieRestTicks);
        w.doubleTicks = state.doublePointsTicks;
        w.instaTicks = state.instaKillTicks;
        w.lastZombie = state.lastZombie;
        w.selfRevivesLeft = state.selfRevivesLeft;
      }
      // A câmera e o HUD acham "o meu bobo" por aqui; morto esperando o respawn continua com o id (como no host).
      s.controllerEntity.fill(NULL_ENTITY);
      for (let e = 0; e < s.count; e++) {
        const c = s.controller[e]!;
        if (s.alive[e] === 1 && c >= 0 && c < MAX_CONTROLLERS_WITH_ZOMBIES) s.controllerEntity[c] = s.idOf(e);
      }
      // M6 (fase 2): a velocidade do modo sai do time (que o snapshot traz): a predição do próprio boneco anda como no
      // host (o infectado é mais rápido).
      if (ctx.party.infectedSpeed > 0) {
        for (let e = 0; e < s.count; e++) {
          if (s.kind[e] === ENTITY_KIND.bobo) ctx.rules.speed[e] = s.team[e] === 1 ? ctx.party.infectedSpeed : 1;
        }
      }
      // M6 (fase 3): as regras do Jugg (a velocidade dele) também saem do time.
      syncJuggRules(ctx);
      mapObjects?.sync();
      ctx.figures.invalidate();
      events.clear();
      keepEvents = false;
      syncView();
    },
  };

  const predict: SimPredict = {
    save(e, out): void {
      const e3 = e * 3;
      out[0] = s.position[e3]!;
      out[1] = s.position[e3 + 1]!;
      out[2] = s.position[e3 + 2]!;
      out[3] = s.velocity[e3]!;
      out[4] = s.velocity[e3 + 1]!;
      out[5] = s.velocity[e3 + 2]!;
      out[6] = s.flags[e]!;
      out[7] = s.inButtons[e]!;
      out[8] = s.coyoteTicks[e]!;
      out[9] = s.jumpBufferTicks[e]!;
      out[10] = s.slideTicks[e]!;
      out[11] = s.slideCooldownTicks[e]!;
      out[12] = s.slideDir[e * 2]!;
      out[13] = s.slideDir[e * 2 + 1]!;
      out[14] = s.airPeakY[e]!;
      out[15] = s.sprintFireDelayTicks[e]!;
    },
    load(e, from): void {
      // M6 (fase 3, revisão): o próprio time chega do snapshot mais novo (os outros, do atrasado): as regras do Jugg
      // (a velocidade) saem dele antes de refazer as entradas.
      syncJuggRules(ctx);
      const e3 = e * 3;
      s.position[e3] = from[0]!;
      s.position[e3 + 1] = from[1]!;
      s.position[e3 + 2] = from[2]!;
      s.velocity[e3] = from[3]!;
      s.velocity[e3 + 1] = from[4]!;
      s.velocity[e3 + 2] = from[5]!;
      s.flags[e] = from[6]!;
      s.inButtons[e] = from[7]!;
      s.coyoteTicks[e] = from[8]!;
      s.jumpBufferTicks[e] = from[9]!;
      s.slideTicks[e] = from[10]!;
      s.slideCooldownTicks[e] = from[11]!;
      s.slideDir[e * 2] = from[12]!;
      s.slideDir[e * 2 + 1] = from[13]!;
      s.airPeakY[e] = from[14]!;
      s.sprintFireDelayTicks[e] = from[15]!;
    },
    step(e, frame): void {
      if (e < 0 || e >= s.count || s.alive[e] !== 1) return;
      const e3 = e * 3;
      s.prevPosition[e3] = s.position[e3]!;
      s.prevPosition[e3 + 1] = s.position[e3 + 1]!;
      s.prevPosition[e3 + 2] = s.position[e3 + 2]!;
      s.prevYaw[e] = s.yaw[e]!;
      s.prevPitch[e] = s.pitch[e]!;
      applyInput(e, frame);
      moveOne(ctx, e);
      // O cliente não processa dano nem solta eventos da sim: quem manda nisso é o host.
      ctx.damage.count = 0;
      events.clear();
      keepEvents = false;
    },
  };

  const maxRewind = Math.min(REWIND_HISTORY - 2, Math.round(REWIND_MAX_S * hz));
  const rewind: SimRewind = {
    maxTicks: maxRewind,
    get rewound(): number {
      return ctx.rewind?.rewound ?? 0;
    },
    enable(): void {
      if (ctx.rewind !== null) return;
      ctx.rewind = new RewindState();
      ctx.rewind.record(s, ctx.tick);
    },
    set(controller, ticks): void {
      const r = ctx.rewind;
      if (r === null || controller < 0 || controller >= r.byController.length) return;
      r.byController[controller] = Math.max(0, Math.min(maxRewind, Math.round(ticks)));
    },
  };

  return {
    hz,
    get tick(): number {
      return ctx.tick;
    },
    remote,
    predict,
    rewind,
    controllerCount,
    finish(): void {
      assert(!disposed, 'sim: finish depois do dispose');
      // O evento vai junto com os do próximo passo (o step limpa a lista no começo, então ela fica guardada).
      finishMatch(ctx);
      keepEvents = true;
    },
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
      // M5 (fase 5d): ping e emotes (depois do movimento e da mira deste tick).
      signalSystem(ctx);
      projectileSystem(ctx);
      pickupSystem(ctx);
      damageSystem(ctx);
      // M6 (fase 1): os pontos do Domination (antes das regras, que olham o placar).
      dominationSystem(ctx);
      // M6 (fase 2): o Infection (a largada, o placar e quem venceu).
      partySystem(ctx);
      rulesSystem(ctx);
      spawnSystem(ctx);
      zombiesSystem(ctx);
      ctx.tick++;
      ctx.rewind?.record(s, ctx.tick);
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
      // M3 (fase 3d): tábuas e portas do snapshot voltam para a colisão e a navegação.
      mapObjects?.sync();
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

/**
 * M3 (fase 6b): a velocidade dos zumbis da receita (`zombies.speed`) em cima do perfil de cada tipo (andar e correr;
 * a aceleração e o pulo ficam). Em 1× devolve o mesmo perfil (o golden não muda).
 */
function zombieSpeed(profile: MovementProfile, recipe: MatchRecipe): MovementProfile {
  const k = recipe.zombies?.speed ?? ZOMBIES_DEFAULTS.speed;
  return k === 1 ? profile : { ...profile, walk: profile.walk * k, sprint: profile.sprint * k };
}
