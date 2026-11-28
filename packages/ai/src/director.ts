import {
  botLevelFromRef,
  isRoyaleMode,
  LEVEL_ORDER,
  PERSONALITY_PRESETS,
  personalityForRoll,
  recipeWeaponPickups,
  resolveBot,
  type BotLevel,
  type MatchRecipe,
} from '@boboforces/format';
import { BUTTON, frameOrder, ORDER, type InputFrame } from '@boboforces/input';
import { assert, createRng, i16ToPitch, u16ToYaw, type Disposable } from '@boboforces/shared';
import {
  ENTITY_FLAG,
  expandRecipe,
  isFfaMode,
  MATCH_DEFAULTS,
  MAX_ZOMBIES,
  ownerReserveSlots,
  ROUND,
  ROUND_PHASE,
  SIM_HZ,
  ZOMBIE_CONTROLLER_BASE,
  type SimOwnerConfig,
  type SimView,
} from '@boboforces/sim';
import { AiContext } from './context.ts';
import { strikeRoundTick } from './strike.ts';
import { RoyaleClaims } from './royale.ts';
import { AI_BUDGET, AI_DIRECTOR, AI_ORDERS, type AiBudget } from './config.ts';
import { MatchDirector } from './match-director.ts';
import {
  createOrderAnswer,
  dropOrder,
  obeys,
  orderPoint,
  orderTicks,
  takeOrder,
  type OrderAnswer,
  type OrderPoint,
} from './orders.ts';
import { ZombieFlow } from './flow.ts';
import { NAV_PATH_API, PathFollower, PathService, type NavPathApi } from './paths.ts';
import { markPointDefenders, SoldierBrain, SoldierTiming, thinkSoldier } from './soldier.ts';
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
  /**
   * M8 (fase 5): o ajuste do Diretor de Partida em quartos de nível (+ = bots melhores), ou `null` com ele desligado
   * (sem o bloco `director`, no Bobo Zombies ou sem humanos). O `game` mostra no placar ("Diretor: bots −½").
   */
  directorShift(): number | null;
  /**
   * M8 (fase 6): a resposta da última ordem do humano no controlador (quantos bots aliados ouviram e quantos
   * obedeceram), ou `null` sem ordem ainda. O `game` mostra a quem mandou.
   */
  orderAnswer(controller: number): Readonly<OrderAnswer> | null;
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
  /**
   * M9 (fase 4): as Ferramentas do Dono, a MESMA opção de `SimConfig.owner`: a reserva ganha cérebros desde o começo
   * (`ownerReserveSlots`, depois dos bots da receita), que ficam parados enquanto o bot dorme. Os cérebros dos
   * congelados seguem pensando (a sim ignora a entrada deles).
   */
  readonly owner?: SimOwnerConfig;
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
  const owner = config.owner ?? null;
  const recipeSlots = expandRecipe(recipe, config.humans);
  const botSlots =
    owner !== null ? [...recipeSlots, ...ownerReserveSlots(recipe, config.humans, owner.reserve)] : recipeSlots;
  for (const slot of botSlots) {
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
  for (const slot of recipeSlots) {
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
  // M10: os defensores do Domination pela ordem dentro de cada time (não pelo controlador global).
  markPointDefenders(soldiers, soldierTeams);
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
  ctx.juggernaut = recipe.mode === 'juggernaut';
  // M7 (fase 7): no Royale a vida também não volta (só o kit cura).
  ctx.noRegen = recipe.mode === 'paintball' || isRoyaleMode(recipe.mode);
  ctx.royaleMode = isRoyaleMode(recipe.mode);
  ctx.royaleGrande = recipe.mode === 'royale.grande';
  ctx.sandboxHunt = recipe.mode === 'sandbox' && recipe.sandbox?.objective === 'elimination';
  ctx.royaleClaims = ctx.royaleMode ? new RoyaleClaims() : null;
  // M11 (fase 4): as armas no mapa (a sim só liga num mapa com pontos: o soldado ainda confere a `view.mapWeapons`).
  ctx.mapWeapons = recipeWeaponPickups(recipe);
  ctx.weaponClaims = ctx.mapWeapons ? new RoyaleClaims() : null;
  ctx.hordeArmed = ctx.zombiesMode && recipe.zombies?.variant === 'armed';
  // M7 (fase 3): o BoboStrike (o sorteio do site de cada rodada).
  ctx.strikeMode = recipe.mode === 'strike';
  ctx.strikeRng = ctx.strikeMode ? root.fork('strike') : null;
  const createFlow = api.createFlowField;
  const flow = zombies > 0 && createFlow !== undefined ? new ZombieFlow(createFlow, hz, budget.pathNodesPerTick) : null;
  ctx.flow = flow;
  // M6 (fase 6a): no Fortress, o campo até o gerador (fonte fixa).
  const fortFlow =
    zombies > 0 && createFlow !== undefined && recipe.zombies?.variant === 'fortress'
      ? new ZombieFlow(createFlow, hz, budget.pathNodesPerTick, true)
      : null;
  ctx.fortFlow = fortFlow;
  const total = soldiers.length + zombieBrains.length;
  // M8 (fase 5): o Diretor de Partida. Quem é humano agora (controlador): os do sofá e os amigos online, menos quem
  // saiu e voltou a ser o cérebro de reserva, mais o bot que um jogador assumiu (`setHumanControlled`).
  const isHuman = new Uint8Array(Math.max(maxController, config.humans - 1) + 1).fill(1, 0, config.humans);
  const matchDirector =
    recipe.director !== undefined && recipe.mode !== 'zombies' && config.humans > 0 && recipeBots > 0
      ? new MatchDirector(recipe.director.goal ?? 'balanced', hz, isHuman)
      : null;
  /** 1 = o Diretor mexe na mira deste bot da receita (os cérebros de reserva do sofá são dos humanos). */
  const shifted = new Uint8Array(recipeBots);
  /** O soldado de cada controlador (-1 = nenhum) e o time de agora de cada um (o da `SimView`: no Royale, o esquadrão). */
  const soldierOf = new Int16Array(maxController + 1).fill(-1);
  for (let i = 0; i < recipeBots; i++) soldierOf[soldiers[i]!.controller] = i;
  const teamNow = new Int16Array(recipeBots);
  const humanTeam = new Uint8Array(256);
  /** Refazer quem muda (os humanos mudaram ou é o 1º tick) e a folga (o "Ajustar desafio" trocou o nível). */
  let directorRebuild = true;
  let directorRange = true;
  /**
   * Os bots que mudam: os dos times de agora sem humano; no FFA e na Infection (quem é infectado muda), todos; com
   * humano em todo time (o sofá dividido), todos. Um bot que um jogador pilota não muda até voltar.
   */
  function rebuildShifted(view: SimView): void {
    humanTeam.fill(0);
    teamNow.fill(-1);
    for (let e = 0; e < view.count; e++) {
      const c = view.controller[e]!;
      if (c < 0 || c >= isHuman.length) continue;
      if (isHuman[c] === 1) humanTeam[view.team[e]!] = 1;
      const i = c < soldierOf.length ? soldierOf[c]! : -1;
      if (i >= 0) teamNow[i] = view.team[e]!;
    }
    const everyone = ctx.ffa || recipe.infection !== undefined;
    let any = false;
    for (let i = 0; i < recipeBots; i++) {
      const t = teamNow[i]!;
      const on = isHuman[soldiers[i]!.controller] !== 1 && (everyone || t < 0 || humanTeam[t] === 0);
      shifted[i] = on ? 1 : 0;
      any ||= on;
    }
    if (!any) for (let i = 0; i < recipeBots; i++) shifted[i] = isHuman[soldiers[i]!.controller] === 1 ? 0 : 1;
  }
  /** A folga do Diretor: a maior entre os bots que mudam (até ±1 nível). */
  function refreshRange(): void {
    let up = 0;
    let down = 0;
    for (let i = 0; i < recipeBots; i++) {
      if (shifted[i] !== 1) continue;
      up = Math.max(up, soldiers[i]!.roomUp);
      down = Math.max(down, soldiers[i]!.roomDown);
    }
    matchDirector?.setRange(Math.min(AI_DIRECTOR.maxQuarters, up), Math.min(AI_DIRECTOR.maxQuarters, down));
  }
  function applyDirectorShift(shift: number): void {
    for (let i = 0; i < recipeBots; i++) soldiers[i]!.setShift(shifted[i] === 1 ? shift : 0, soldierTiming);
  }
  // M8 (fase 6): as ordens aos bots aliados. A última ordem de cada controlador humano (a borda), a resposta de cada
  // um e o fluxo de RNG da obediência (à parte dos cérebros: sem ordem, nada muda).
  const lastOrder = new Uint8Array(isHuman.length);
  const lastPing = new Uint8Array(isHuman.length);
  const answers: OrderAnswer[] = [];
  for (let c = 0; c < isHuman.length; c++) answers.push(createOrderAnswer());
  const orderRng = root.fork('orders');
  const orderAt: OrderPoint = { x: 0, y: 0, z: 0 };
  const pickIdx = new Int32Array(AI_ORDERS.maxBots);
  const pickD2 = new Float64Array(AI_ORDERS.maxBots);
  /** Lê a ordem de cada humano na borda (o valor mudou para uma ordem) e passa aos aliados. */
  function readOrders(view: SimView, frames: InputFrame[]): void {
    // M8 (fase 6, revisão): o que a sim ignora a IA também ignora: tudo na contagem e fora da rodada valendo (a sim
    // zera os botões), e o aviso de quem está caído (a ordem vale: o Me revive é para isso).
    const frozen =
      view.match.phase === 'warmup' || (view.rounds !== null && view.rounds.data[ROUND.phase] !== ROUND_PHASE.live);
    for (let c = 0; c < isHuman.length && c < frames.length; c++) {
      const f = frames[c]!;
      const buttons = isHuman[c] === 1 && !frozen ? f.buttons : 0;
      const o = frameOrder(buttons);
      if (o !== 0 && o !== lastOrder[c]) dispatchOrder(view, c, o, f);
      lastOrder[c] = o;
      // O aviso do humano também vale para os bots do time (como o de um bot N3: quem ouve avisos vai conferir).
      const e = ctx.ctrlToEntity[c]!;
      const downed = e >= 0 && (view.flags[e]! & ENTITY_FLAG.downed) !== 0;
      const ping = (buttons & BUTTON.ping) !== 0 && !downed ? 1 : 0;
      if (ping === 1 && lastPing[c] === 0) humanPing(view, c, f);
      lastPing[c] = ping;
    }
  }
  function humanPing(view: SimView, c: number, f: InputFrame): void {
    const e = ctx.ctrlToEntity[c]!;
    if (ctx.ffa || ctx.board === null || e < 0 || !ctx.living(e)) return;
    if (!orderPoint(view, e, ORDER.attack, u16ToYaw(f.yaw), i16ToPitch(f.pitch), orderAt)) return;
    ctx.board.post(view.team[e]!, orderAt.x, orderAt.y, orderAt.z, view.tick, true);
  }
  /** M8 (fase 6, revisão): no BoboStrike, a rodada nova tira as ordens (o lado pode ter trocado). */
  let orderRound = -1;
  function dropOrdersOnNewRound(view: SimView): void {
    if (view.rounds === null) return;
    const r = view.rounds.data[ROUND.round]!;
    if (r === orderRound) return;
    orderRound = r;
    for (let i = 0; i < recipeBots; i++) dropOrder(soldiers[i]!);
  }
  /**
   * Os bots aliados de quem mandou (os da receita que ninguém pilota, vivos), até `maxBots` dos mais perto dentro de
   * `rangeM`: cada um sorteia se obedece (N0 e N1 ignoram).
   */
  function dispatchOrder(view: SimView, c: number, order: number, f: InputFrame): void {
    const answer = answers[c]!;
    answer.tick = view.tick;
    answer.order = order;
    answer.asked = 0;
    answer.obeyed = 0;
    answer.nowhere = false;
    const e = ctx.ctrlToEntity[c]!;
    if (order > ORDER.cover || e < 0 || !ctx.living(e)) return;
    // A mira do próprio quadro da ordem (a da `SimView` é a do tick anterior; o ping da sim usa a do quadro).
    if (!orderPoint(view, e, order, u16ToYaw(f.yaw), i16ToPitch(f.pitch), orderAt)) {
      answer.nowhere = true;
      return;
    }
    const x = view.position[e * 3]!;
    const z = view.position[e * 3 + 2]!;
    const range2 = AI_ORDERS.rangeM * AI_ORDERS.rangeM;
    let n = 0;
    for (let i = 0; i < recipeBots; i++) {
      if (piloted[i] === 1) continue;
      const be = ctx.ctrlToEntity[soldiers[i]!.controller]!;
      if (be < 0 || !ctx.living(be) || ctx.hostile(e, be)) continue;
      const dx = view.position[be * 3]! - x;
      const dz = view.position[be * 3 + 2]! - z;
      const d2 = dx * dx + dz * dz;
      if (d2 > range2) continue;
      // Os mais perto primeiro (inserção numa lista curta).
      let k = Math.min(n, AI_ORDERS.maxBots - 1);
      if (n === AI_ORDERS.maxBots && d2 >= pickD2[k]!) continue;
      while (k > 0 && pickD2[k - 1]! > d2) {
        pickD2[k] = pickD2[k - 1]!;
        pickIdx[k] = pickIdx[k - 1]!;
        k--;
      }
      pickD2[k] = d2;
      pickIdx[k] = i;
      if (n < AI_ORDERS.maxBots) n++;
    }
    const until = view.tick + orderTicks(order, hz);
    for (let k = 0; k < n; k++) {
      const b = soldiers[pickIdx[k]!]!;
      answer.asked++;
      if (!obeys(orderRng, b, order, e, view.generation[e]!, view.tick, hz)) continue;
      takeOrder(b, order, e, view.generation[e]!, orderAt, until);
      answer.obeyed++;
    }
  }
  /**
   * M9 (fase 4): o time de agora do soldado `i` (o dono troca o time de um bot; a Infection também): o da view, ou o
   * da receita antes do 1º tick e para quem não tem corpo.
   */
  function teamOf(i: number): number {
    const view = ctx.view;
    const e = view !== null ? ctx.ctrlToEntity[soldiers[i]!.controller]! : -1;
    return e >= 0 ? view!.team[e]! : soldierTeams[i]!;
  }
  /** M9 (fase 4): o time que o Diretor de Partida viu de cada bot (o dono trocou um: refaz quem muda). */
  const ownerTeams = new Int16Array(owner !== null ? recipeBots : 0).fill(-1);
  function ownerTeamsChanged(): boolean {
    let changed = false;
    for (let i = 0; i < ownerTeams.length; i++) {
      const t = teamOf(i);
      if (t !== ownerTeams[i]) {
        ownerTeams[i] = t;
        changed = true;
      }
    }
    return changed;
  }
  function directorTick(md: MatchDirector, view: SimView): void {
    let changed = false;
    if (owner !== null && ownerTeamsChanged()) directorRebuild = true;
    if (directorRebuild) {
      rebuildShifted(view);
      // Quem conta mudou: a janela recomeça dos totais de agora (sem um salto no K/D).
      md.rebase(view);
      directorRebuild = false;
      directorRange = true;
      changed = true;
    }
    if (directorRange) {
      refreshRange();
      directorRange = false;
      changed = true;
    }
    if (md.update(view)) changed = true;
    if (changed) applyDirectorShift(md.shift);
  }

  let disposed = false;
  return {
    botCount: recipeBots,
    think(view, frames): void {
      assert(!disposed, 'ai: think depois do dispose');
      assert(frames.length > maxController, 'ai: frames precisa cobrir todos os controladores de bot e zumbi');
      ctx.begin(view);
      paths.service();
      flow?.update(ctx);
      fortFlow?.update(ctx);
      if (matchDirector !== null) directorTick(matchDirector, view);
      dropOrdersOnNewRound(view);
      readOrders(view, frames);
      if (total === 0) return;
      // M2 (fases 3e e 3f): o quadro do time (criado no 1º tick, com o tamanho do mapa).
      // M7 (fase 6): no Royale os esquadrões passam do teto de times do quadro: o calor e o perigo num quadro só, como
      // no FFA; os pings continuam por esquadrão.
      ctx.board ??= new TeamBoard(view.world.sizeX, view.world.sizeZ, hz, ctx.ffa, ctx.ffa || view.royale !== null);
      if (ctx.strikeMode) strikeRoundTick(ctx);
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
        if (board.pingHuman[k] === 1) continue;
        out[n * 3] = board.pingX[k]!;
        out[n * 3 + 1] = board.pingY[k]!;
        out[n * 3 + 2] = board.pingZ[k]!;
        n++;
      }
      return n;
    },
    setHumanControlled(controller, human): void {
      for (let i = 0; i < soldiers.length; i++) {
        if (soldiers[i]!.controller !== controller) continue;
        // M12 (fase 7a, revisão): o bot devolvido (Aquário, sofá) recomeça como no renascer: sem o alvo, a reação e a
        // velocidade estimada velhos de quando o humano pilotava.
        if (!human && piloted[i] === 1) soldiers[i]!.restart();
        piloted[i] = human ? 1 : 0;
      }
      if (controller >= 0 && controller < isHuman.length && isHuman[controller] !== (human ? 1 : 0)) {
        isHuman[controller] = human ? 1 : 0;
        directorRebuild = true;
      }
    },
    setLevel(level, team): number {
      let n = 0;
      for (let i = 0; i < soldiers.length; i++) {
        // M9 (fase 4): com o dono, pelo time de agora (ele troca o time de um bot); sem ele, o da receita, como antes
        // (na Infection, o "Ajustar desafio" do time 1 segue sendo o dos bots que começaram nele).
        if (team >= 0 && (owner !== null ? teamOf(i) : soldierTeams[i]) !== team) continue;
        soldiers[i]!.setLevel(level, soldierTiming);
        n++;
        // M8 (fase 5, revisão): o nível novo muda a folga do Diretor.
        directorRange = true;
      }
      return n;
    },
    directorShift(): number | null {
      return matchDirector?.shift ?? null;
    },
    orderAnswer(controller): Readonly<OrderAnswer> | null {
      const a = controller >= 0 && controller < answers.length ? answers[controller]! : null;
      return a !== null && a.tick >= 0 ? a : null;
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
