import type { MatchRecipe } from '@boboforces/format';
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
import { BLOCK_SIZE, type BlockRegistry, type WorldGrid } from '@boboforces/world';
import { BASE_HP, METRICS } from './config/metrics.ts';
import { MOVEMENT_BOBO } from './config/movement.ts';
import { MATCH_DEFAULTS } from './config/rules.ts';
import { MAX_CONTROLLERS, MAX_ENTITIES, MAX_TEAMS, secondsToTicks, SIM_HZ } from './constants.ts';
import { DamageQueue, type MatchState, type SimContext } from './context.ts';
import { ENTITY_FLAG, ENTITY_KIND, NULL_ENTITY, type EntityId } from './entity.ts';
import { EventQueue } from './event-queue.ts';
import type { SimEvent } from './events.ts';
import { expandRecipe, isFfaMode, isWarfareMode } from './recipe.ts';
import { hashState, readState, writeState } from './snapshot.ts';
import { SimState } from './state.ts';
import { damageSystem, respawn, rulesSystem, spawnSystem } from './systems/life.ts';
import { movementSystem } from './systems/movement.ts';
import { weaponSystem } from './systems/weapons.ts';
import type { MatchView, SimView } from './view.ts';

/** Ponto de spawn declarado pelo mapa (metros, radianos). `team` = -1 para FFA/qualquer time. */
export interface SpawnPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly team: number;
}

/** O que a sim precisa do mapa (no M1 sai do `.bfmap`; no M0 os testes montam na mão). */
export interface SimMap {
  readonly grid: WorldGrid;
  readonly blocks: BlockRegistry;
  readonly spawns: readonly SpawnPoint[];
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

/** Menor Y (m) com bloco na grade; o plano de morte fica `METRICS.killPlaneBelow` abaixo dele. */
function lowestBlockY(grid: WorldGrid): number {
  for (let y = 0; y < grid.sizeY; y++) {
    for (let z = 0; z < grid.sizeZ; z++) {
      for (let x = 0; x < grid.sizeX; x++) if (grid.get(x, y, z) !== 0) return y * BLOCK_SIZE;
    }
  }
  return 0;
}

/** Spawn inicial: o k-ésimo membro do time vai para o k-ésimo ponto do time (sem empilhar ninguém no tick 0). */
function initialSpawn(spawns: readonly SpawnPoint[], team: number, ffa: boolean, k: number): number {
  const own: number[] = [];
  const any: number[] = [];
  spawns.forEach((sp, i) => {
    if (!ffa && sp.team === team) own.push(i);
    if (sp.team === -1) any.push(i);
  });
  const list = own.length > 0 ? own : any.length > 0 ? any : spawns.map((_, i) => i);
  return list[k % list.length]!;
}

/**
 * Cria a sim de uma partida. Tudo é alocado aqui (typed arrays com capacidade fixa, pools de eventos, fila de dano);
 * `step()` não aloca. Os bobos (um por controlador da receita) nascem já no construtor, com os eventos `spawn` e
 * `matchPhase` entregues junto com os do primeiro tick.
 */
export function createSim(config: SimConfig): Sim {
  const { recipe, map, humans } = config;
  assert(map.spawns.length > 0, 'sim: o mapa precisa de pelo menos 1 spawn');
  const slots = expandRecipe(recipe, humans);
  const root = createRng(recipe.seed);
  const s = new SimState();
  const events = new EventQueue();
  const hz = config.hz ?? SIM_HZ;
  assert(Number.isInteger(hz) && hz >= 10 && hz <= 240, `sim: hz inválido (${hz})`);
  const timeLimitS = recipe.match?.timeLimitS ?? 0;
  const match: MatchState = {
    phase: 'playing',
    ticksLeft: timeLimitS > 0 ? Math.max(1, secondsToTicks(timeLimitS, hz)) : -1,
    teamScore: new Int32Array(MAX_TEAMS),
    winnerTeam: -1,
  };
  const ctx: SimContext = {
    s,
    events,
    damage: new DamageQueue(MAX_ENTITIES),
    match,
    grid: map.grid,
    blocks: map.blocks,
    spawns: map.spawns,
    // M0: só o perfil Bobo existe; os outros ids caem nele até o M2.
    profile: MOVEMENT_BOBO,
    ffa: isFfaMode(recipe.mode),
    warfare: isWarfareMode(recipe.mode),
    hz,
    dt: 1 / hz,
    tick: 0,
    maxHp: recipe.players?.hp ?? BASE_HP,
    respawnTicks: Math.max(1, secondsToTicks(recipe.players?.respawnS ?? MATCH_DEFAULTS.respawnS, hz)),
    spawnProtectTicks: secondsToTicks(MATCH_DEFAULTS.spawnProtectionS, hz),
    regenDelayTicks: secondsToTicks(MATCH_DEFAULTS.regenDelayS, hz),
    regenPerTick: MATCH_DEFAULTS.regenPerS / hz,
    scoreLimit: recipe.match?.scoreLimit ?? 0,
    killPlaneY: lowestBlockY(map.grid) - METRICS.killPlaneBelow,
    rngSpawn: root.fork('spawn'),
    rngWeapons: root.fork('weapons'),
  };

  const perTeam = new Int32Array(MAX_TEAMS);
  let controllerCount = 0;
  slots.forEach((slot, i) => {
    const id = s.allocate(ENTITY_KIND.bobo, slot.team, slot.controller);
    assert(id !== NULL_ENTITY, 'sim: sem slot de entidade');
    s.controllerEntity[slot.controller] = id;
    const k = perTeam[slot.team]!;
    perTeam[slot.team] = k + 1;
    respawn(ctx, id & 0xffff, initialSpawn(map.spawns, slot.team, ctx.ffa, ctx.ffa ? i : k));
    controllerCount = Math.max(controllerCount, slot.controller + 1);
  });
  events.matchPhase(0, 'playing');

  const matchView: Mutable<MatchView> = {
    phase: match.phase,
    ticksLeft: match.ticksLeft,
    teamScore: match.teamScore,
    winnerTeam: match.winnerTeam,
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
    weapon: s.weapon,
    ammoClip: s.ammoClip,
    ammoReserve: s.ammoReserve,
    kills: s.kills,
    deaths: s.deaths,
    recoilPitch: s.recoilPitch,
    recoilYaw: s.recoilYaw,
    match: matchView,
    world: map.grid,
    blocks: map.blocks,
  };
  const syncView = (): void => {
    view.tick = ctx.tick;
    view.count = s.count;
    matchView.phase = match.phase;
    matchView.ticksLeft = match.ticksLeft;
    matchView.winnerTeam = match.winnerTeam;
  };

  const hasher = new StateHasher();
  /** Os eventos do construtor (spawns, fase) saem junto com os do primeiro tick. */
  let keepEvents = true;
  let disposed = false;

  /** Passo 1: aplica os InputFrames (mira absoluta; botões guardados para detectar bordas). */
  const applyInputs = (inputs: ReadonlyArray<Readonly<InputFrame> | null>): void => {
    for (let c = 0; c < MAX_CONTROLLERS; c++) {
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
      s.inButtons[e] = f.buttons & 0xffff;
      s.inMoveX[e] = dequantizeAxis(f.moveX);
      s.inMoveY[e] = dequantizeAxis(f.moveY);
      s.inWeapon[e] = f.weapon & 0xff;
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
      // Ordem fixa (tecnico.md §4.1). (0) IA roda fora, antes do step; (4) projéteis e (8) diretor ainda não existem.
      applyInputs(inputs);
      movementSystem(ctx);
      weaponSystem(ctx);
      damageSystem(ctx);
      rulesSystem(ctx);
      spawnSystem(ctx);
      ctx.tick++;
      syncView();
    },
    view: () => view,
    drainEvents(out): void {
      events.drain(out);
    },
    controllerEntity(controller): EntityId {
      if (controller < 0 || controller >= MAX_CONTROLLERS) return NULL_ENTITY;
      return s.controllerEntity[controller]!;
    },
    stateHash: () => hashState(ctx, hasher),
    writeSnapshot(w, baseline): void {
      void baseline; // delta contra baseline: M5
      writeState(ctx, w);
    },
    readSnapshot(r): void {
      readState(ctx, r);
      events.clear();
      keepEvents = false;
      syncView();
    },
    dispose(): void {
      disposed = true;
      events.clear();
    },
  };
}
