import { botLevelFromRef, type MatchRecipe } from '@boboforces/format';
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
import { NAV_PATH_API, PathFollower, PathService, type NavPathApi } from './paths.ts';
import { SoldierBrain, SoldierTiming, thinkSoldier } from './soldier.ts';
import { thinkZombie, ZombieBrain, ZombieTiming } from './zombie.ts';

/**
 * Controla TODOS os bots (e os zumbis do estresse) de uma partida. Roda antes de cada `sim.step` (passo 0 da ordem
 * fixa) e escreve o frame de cada bot em `frames[BOT_CONTROLLER_BASE + botIndex]` (a ordem dos bots é a de expansão
 * da receita) e o de cada zumbi em `frames[ZOMBIE_CONTROLLER_BASE + i]`.
 */
export interface BotDirector extends Disposable {
  readonly botCount: number;
  think(view: SimView, frames: InputFrame[]): void;
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
  const zombieBrains: ZombieBrain[] = [];
  let maxController = -1;
  for (const slot of expandRecipe(recipe, config.humans)) {
    if (slot.bot === null) continue;
    // Bot embutido (`embedded:`) ainda não existe no M1: vira Normal.
    const level = botLevelFromRef(slot.bot) ?? 'normal';
    const follower = new PathFollower(followers.length);
    followers.push(follower);
    soldiers.push(
      new SoldierBrain(slot.botIndex, slot.controller, level, root.fork('bot', slot.botIndex), soldierTiming, follower),
    );
    maxController = Math.max(maxController, slot.controller);
  }
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
  const total = soldiers.length + zombieBrains.length;

  let disposed = false;
  return {
    botCount: soldiers.length,
    think(view, frames): void {
      assert(!disposed, 'ai: think depois do dispose');
      assert(frames.length > maxController, 'ai: frames precisa cobrir todos os controladores de bot e zumbi');
      ctx.begin(view);
      paths.service();
      if (total === 0) return;
      // Ordem girando a cada tick: o orçamento de raios e a fila não favorecem sempre os mesmos.
      const start = view.tick % total;
      for (let k = 0; k < total; k++) {
        const i = (start + k) % total;
        if (i < soldiers.length) {
          const b = soldiers[i]!;
          thinkSoldier(ctx, b, frames[b.controller]!, soldierTiming);
        } else {
          const z = zombieBrains[i - soldiers.length]!;
          thinkZombie(ctx, z, frames[z.controller]!, zombieTiming);
        }
      }
    },
    stats(): BotDirectorStats {
      return { rays: ctx.raysTotal, pathCalls: paths.calls, pathsServed: paths.served, visibleAims: ctx.aimsTotal };
    },
    dispose(): void {
      disposed = true;
      soldiers.length = 0;
      zombieBrains.length = 0;
    },
  };
}
