import {
  botLevelFromRef,
  LEVEL_ORDER,
  PERSONALITY_PRESETS,
  personalityForRoll,
  resolveBot,
  type BotLevel,
  type MatchRecipe,
} from '@boboforces/format';
import type { InputFrame } from '@boboforces/input';
import { assert, createRng, type Disposable } from '@boboforces/shared';
import {
  expandRecipe,
  isFfaMode,
  MATCH_DEFAULTS,
  MAX_ZOMBIES,
  SIM_HZ,
  ZOMBIE_CONTROLLER_BASE,
  type SimView,
} from '@boboforces/sim';
import { AiContext } from './context.ts';
import { AI_BUDGET, type AiBudget } from './config.ts';
import { ZombieFlow } from './flow.ts';
import { NAV_PATH_API, PathFollower, PathService, type NavPathApi } from './paths.ts';
import { SoldierBrain, SoldierTiming, thinkSoldier } from './soldier.ts';
import { TeamBoard } from './team.ts';
import { thinkZombie, ZombieBrain, ZombieTiming } from './zombie.ts';

/**
 * Controla TODOS os bots (e os zumbis do estresse) de uma partida. Roda antes de cada `sim.step` (passo 0 da ordem
 * fixa) e escreve o frame de cada bot em `frames[BOT_CONTROLLER_BASE + botIndex]` (a ordem dos bots é a de expansão
 * da receita) e o de cada zumbi em `frames[ZOMBIE_CONTROLLER_BASE + i]`.
 */
export interface BotDirector extends Disposable {
  readonly botCount: number;
  think(view: SimView, frames: InputFrame[]): void;
  /**
   * M2 (fase 3e): avisos do time `team` com até `maxAgeTicks` (os bots N3 avisam quando veem um inimigo). Escreve x, y,
   * z de cada um em `out` (até `out.length / 3`) e devolve quantos. O `game` mostra o ping para os humanos do time.
   */
  pings(team: number, maxAgeTicks: number, out: Float64Array): number;
  /**
   * M2 (fase 2e): "Ajustar desafio" (gameplay.md §2.2): troca o nível dos bots do time `team` (-1 = todos) no meio
   * da partida. Devolve quantos mudaram.
   */
  setLevel(level: BotLevel, team: number): number;
  /**
   * M3 (fase 1c): um jogador local pilota (`true`) ou devolve (`false`) o controlador: enquanto pilota, o cérebro dele
   * não pensa nem escreve o frame. Vale para um bot que alguém assumiu no meio e para os humanos do sofá com cérebro de
   * reserva (`BotDirectorConfig.standby`), que começam pilotados. Controlador sem cérebro: nada.
   */
  setHumanControlled(controller: number, human: boolean): void;
}

export interface BotDirectorConfig {
  readonly recipe: MatchRecipe;
  /** Humanos ocupando os controladores 0..humans-1 (os bots começam em BOT_CONTROLLER_BASE de qualquer jeito). */
  readonly humans: number;
  /** Ticks por segundo da sim (`sim.hz`; padrão `SIM_HZ`): os tempos da IA são em segundos e viram ticks aqui. */
  readonly hz?: number;
  /**
   * M1 (contrato; implementação da frente "sim-ia"): zumbis do teste de estresse, o MESMO número de
   * `SimConfig.zombies`. O diretor escreve os frames dos controladores `ZOMBIE_CONTROLLER_BASE`.. com o cérebro de
   * zumbi (persegue o humano/bot mais próximo pela navegação e bate de perto). A navegação vem de `SimView.nav`.
   */
  readonly zombies?: number;
  /**
   * M1 (integração): orçamento de raios e de A* por tick, vindo do perfil da plataforma (`aiBudgetFor` no `game`).
   * Ausente = `AI_BUDGET` (o golden e o robô de balanceamento usam o padrão).
   */
  readonly budget?: AiBudget;
  /**
   * M3 (fase 1c): humanos do sofá (controladores em 0..humans-1) que ganham um cérebro de reserva, um Normal Bob do
   * time deles: começa parado e assume quando o jogador sai (`setHumanControlled(c, false)`). Fluxo de RNG próprio
   * (`fork('standby', c)`): os bots da receita não mudam. Não conta em `botCount`.
   */
  readonly standby?: readonly number[];
}

/** Estatísticas acumuladas do diretor (bench headless e painel F2). */
export interface BotDirectorStats {
  /** Raios de percepção gastos desde o começo. */
  readonly rays: number;
  /** Chamadas de `findPath` e pedidos de caminho atendidos. */
  readonly pathCalls: number;
  readonly pathsServed: number;
  /** Escolhas da mira visível (`visibleAimOffset`) desde o começo. */
  readonly visibleAims: number;
  /** M3 (fase 3c): flow fields dos zumbis prontos. */
  readonly flowBuilds: number;
}

/** O diretor com as estatísticas (o que `createBotDirectorWithPaths` devolve). */
export interface BotDirectorWithStats extends BotDirector {
  stats(): BotDirectorStats;
}

/**
 * IA do M1 (tecnico.md §8.2–§8.3; PLANO_M1, área `sim + ai`): soldados N0 (`soldier.ts`) e zumbis de estresse
 * (`zombie.ts`) sobre um contexto de tick comum (`AiContext`: orçamento de raios, observadores para o LOD) e uma fila
 * de caminhos com orçamento de nós de A* (`PathService`). Os cérebros são visitados numa ordem que gira a cada tick,
 * para nenhum bot ficar sempre sem orçamento. Determinístico: um fluxo de RNG por bot (`fork('bot', i)`) e por zumbi
 * (`fork('zombie', i)`), orçamentos em unidades de trabalho. Utility AI, blackboard de time e os níveis N1+ são do M2.
 */
export function createBotDirector(config: BotDirectorConfig): BotDirector {
  return createBotDirectorWithPaths(config, NAV_PATH_API);
}

/**
 * Igual a `createBotDirector`, com as funções de caminho trocáveis (testes, golden e bench usam a navegação de teste
 * da sim enquanto a do `nav` não existe) e as estatísticas.
 */
export function createBotDirectorWithPaths(config: BotDirectorConfig, api: NavPathApi): BotDirectorWithStats {
  const { recipe } = config;
  const hz = config.hz ?? SIM_HZ;
  const zombies = config.zombies ?? 0;
  assert(Number.isInteger(zombies) && zombies >= 0 && zombies <= MAX_ZOMBIES, `ai: 0 a ${MAX_ZOMBIES} zumbis`);
  const soldierTiming = new SoldierTiming(hz);
  const zombieTiming = new ZombieTiming(hz);
  const root = createRng(recipe.seed);
  const followers: PathFollower[] = [];
  const soldiers: SoldierBrain[] = [];
  /** Time de cada soldado (na ordem de `soldiers`). */
  const soldierTeams: number[] = [];
  const zombieBrains: ZombieBrain[] = [];
  let maxController = -1;
  for (const slot of expandRecipe(recipe, config.humans)) {
    if (slot.bot === null) continue;
    // Bot embutido (`embedded:`) ainda não existe no M1: vira Normal.
    // M2 (fase 3a): o bot da ref (de fábrica ou embutido; sem ele, o Normal Bob). O nível rápido é o da ref ou, nos
    // especiais, o da inteligência (base do "Ajustar desafio").
    const bot = resolveBot(recipe, slot.bot);
    const quick = botLevelFromRef(slot.bot);
    const level = quick ?? LEVEL_ORDER[bot.intelligence.level] ?? 'normal';
    // Os bots de nível sorteiam a personalidade da mistura (§6.6) num fluxo próprio: o RNG do cérebro não muda.
    const personality =
      quick !== null
        ? PERSONALITY_PRESETS[personalityForRoll(root.fork('personality', slot.botIndex).next())]
        : bot.personality;
    const follower = new PathFollower(followers.length);
    followers.push(follower);
    soldiers.push(
      new SoldierBrain(
        slot.botIndex,
        slot.controller,
        level,
        root.fork('bot', slot.botIndex),
        soldierTiming,
        follower,
        bot,
        personality,
      ),
    );
    soldierTeams.push(slot.team);
    maxController = Math.max(maxController, slot.controller);
  }
  const recipeBots = soldiers.length;
  for (const slot of expandRecipe(recipe, config.humans)) {
    if (slot.bot !== null || !(config.standby ?? []).includes(slot.controller)) continue;
    const follower = new PathFollower(followers.length);
    followers.push(follower);
    const brain = new SoldierBrain(
      soldiers.length,
      slot.controller,
      'normal',
      root.fork('standby', slot.controller),
      soldierTiming,
      follower,
    );
    soldiers.push(brain);
    soldierTeams.push(slot.team);
    maxController = Math.max(maxController, slot.controller);
  }
  /** M3 (fase 1c): 1 = um jogador pilota este soldado (o cérebro não pensa). Os de reserva começam pilotados. */
  const piloted = new Uint8Array(soldiers.length).fill(0, 0, recipeBots).fill(1, recipeBots);
  for (let i = 0; i < zombies; i++) {
    const follower = new PathFollower(followers.length);
    followers.push(follower);
    const controller = ZOMBIE_CONTROLLER_BASE + i;
    zombieBrains.push(new ZombieBrain(i, controller, root.fork('zombie', i), zombieTiming, follower));
    maxController = Math.max(maxController, controller);
  }
  const viewDistance = recipe.match?.viewDistanceM ?? MATCH_DEFAULTS.viewDistanceM;
  const budget = config.budget ?? AI_BUDGET;
  assert(budget.raysPerTick >= 0 && budget.pathNodesPerTick > 0 && budget.pathSlice > 0, 'ai: orçamento inválido');
  const paths = new PathService(api, followers, budget);
  const ctx = new AiContext(hz, isFfaMode(recipe.mode), viewDistance, paths, budget.raysPerTick);
  ctx.zombiesMode = recipe.mode === 'zombies';
  const createFlow = api.createFlowField;
  const flow = zombies > 0 && createFlow !== undefined ? new ZombieFlow(createFlow, hz, budget.pathNodesPerTick) : null;
  ctx.flow = flow;
  const total = soldiers.length + zombieBrains.length;

  let disposed = false;
  return {
    botCount: recipeBots,
    think(view, frames): void {
      assert(!disposed, 'ai: think depois do dispose');
      assert(frames.length > maxController, 'ai: frames precisa cobrir todos os controladores de bot e zumbi');
      ctx.begin(view);
      paths.service();
      flow?.update(ctx);
      if (total === 0) return;
      // M2 (fases 3e e 3f): o quadro do time (criado no 1º tick, com o tamanho do mapa).
      ctx.board ??= new TeamBoard(view.world.sizeX, view.world.sizeZ, hz, ctx.ffa);
      ctx.board.update(view, view.tick);
      // Ordem girando a cada tick: o orçamento de raios e a fila não favorecem sempre os mesmos.
      const start = view.tick % total;
      for (let k = 0; k < total; k++) {
        const i = (start + k) % total;
        if (i < soldiers.length) {
          if (piloted[i] === 1) continue;
          const b = soldiers[i]!;
          thinkSoldier(ctx, b, frames[b.controller]!, soldierTiming);
        } else {
          const z = zombieBrains[i - soldiers.length]!;
          thinkZombie(ctx, z, frames[z.controller]!, zombieTiming);
        }
      }
    },
    pings(team, maxAgeTicks, out): number {
      const board = ctx.board;
      if (board === null) return 0;
      let n = 0;
      const tick = ctx.tick;
      for (let k = 0; k < board.pingTick.length && (n + 1) * 3 <= out.length; k++) {
        if (board.pingTeam[k] !== (ctx.ffa ? 0 : team) || tick - board.pingTick[k]! > maxAgeTicks) continue;
        out[n * 3] = board.pingX[k]!;
        out[n * 3 + 1] = board.pingY[k]!;
        out[n * 3 + 2] = board.pingZ[k]!;
        n++;
      }
      return n;
    },
    setHumanControlled(controller, human): void {
      for (let i = 0; i < soldiers.length; i++) if (soldiers[i]!.controller === controller) piloted[i] = human ? 1 : 0;
    },
    setLevel(level, team): number {
      let n = 0;
      for (let i = 0; i < soldiers.length; i++) {
        if (team >= 0 && soldierTeams[i] !== team) continue;
        soldiers[i]!.setLevel(level, soldierTiming);
        n++;
      }
      return n;
    },
    stats(): BotDirectorStats {
      return {
        rays: ctx.raysTotal,
        pathCalls: paths.calls,
        pathsServed: paths.served,
        visibleAims: ctx.aimsTotal,
        flowBuilds: flow?.builds ?? 0,
      };
    },
    dispose(): void {
      disposed = true;
      soldiers.length = 0;
      zombieBrains.length = 0;
    },
  };
}
