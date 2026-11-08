/**
 * Números da IA do M1 (tecnico.md §8.1–§8.3, gameplay.md §6.3). Tudo em segundos/metros; o diretor converte para ticks
 * pelo `hz` da partida. Orçamentos em UNIDADES DE TRABALHO por tick (raios, nós de A*), nunca em ms (regra 10).
 */

/**
 * Orçamento por tick, somando todos os bots e zumbis (tecnico.md §8.3, perfil do Switch 3–4P). Os valores do M1 ficam
 * aqui (padrão); o perfil da plataforma passa a escolher no M2 (pedido de contrato no relatório da frente).
 */
/** Orçamento de trabalho da IA por tick (unidades de trabalho, nunca ms: regra 10). */
export interface AiBudget {
  readonly raysPerTick: number;
  readonly pathNodesPerTick: number;
  readonly pathSlice: number;
}

/** Orçamento padrão (PC). O `game` passa o do perfil da plataforma em `BotDirectorConfig.budget`. */
export const AI_BUDGET = {
  /** Raios de percepção (DDA de linha de visão) por tick. */
  raysPerTick: 16,
  /** Nós de A* expandidos por tick. */
  pathNodesPerTick: 800,
  /**
   * Fatia de A* por chamada de `findPath`. O contrato não diz quantos nós a chamada expandiu, então o diretor desconta
   * a fatia inteira (conta para cima): no máximo `pathNodesPerTick / pathSlice` chamadas por tick.
   */
  pathSlice: 200,
} as const satisfies AiBudget;

/**
 * LOD de IA (tecnico.md §8.3). A: engajado ou a até `nearM` de um observador (câmera de humano); B: o resto. Sem
 * humanos na partida (golden, robô de balanceamento), todo bot é A. O nível C (Royale) não existe no M1.
 */
export const AI_LOD = {
  nearM: 25,
  /** Percepção (Hz) e candidatos por percepção (cada candidato custa até 2 raios: cabeça e tronco). */
  perceptionHzA: 10,
  perceptionHzB: 4,
  candidatesA: 4,
  candidatesB: 2,
  /** Intervalo mínimo entre pedidos de caminho do mesmo bot (s): replaneja até 2×/s no A e 0,5×/s no B. */
  replanSA: 0.5,
  replanSB: 2,
} as const;

/** Percepção (gameplay.md §6.3): cone de 120°, alcance = visão da partida, audição por estado do corpo. */
export const AI_SENSES = {
  viewConeDeg: 120,
  /** Ouve tiro a 50 m, passo correndo a 15 m, andando a 6 m (agachado: nada). */
  hearShotM: 50,
  hearSprintM: 15,
  hearWalkM: 6,
  /** Acima disto (m/s) o corpo "faz barulho de passo". */
  hearStepSpeed: 1.5,
  /** Memória do alvo que sumiu da vista (s) e de onde ele foi visto ou ouvido (s). */
  memoryS: 3,
  chaseS: 6,
  /** Depois de tomar dano, olha em volta (360°) por este tempo (s). */
  alertS: 1,
} as const;

/** Seguidor de caminho (os dois cérebros). */
export const AI_PATH = {
  /** Chegou no ponto (m, no plano) e diferença de altura aceita (m). */
  arriveM: 0.45,
  arriveDy: 1.2,
  /** O objetivo andou mais que isto (m) desde o pedido: pede caminho de novo. */
  replanGoalM: 2.5,
  /** Longe do próximo ponto mais que isto (m) ou caiu: pede caminho de novo. */
  offPathM: 4,
  /** Pula para o ponto da ligação de pulo a esta distância (m) se ele estiver mais alto que um degrau. */
  jumpTriggerM: 1.3,
  /** Sem andar `stuckMoveM` em `stuckS`: pula; 2 vezes seguidas: pede caminho; 4: desiste do objetivo. */
  stuckS: 0.75,
  stuckMoveM: 0.35,
  /** Afasta-se de corpos a menos disto (m), sem RVO (tecnico.md §8.1). */
  separationM: 0.9,
  separationWeight: 0.8,
  /** Capacidade de cada caminho (nós). */
  pathCapacity: 256,
} as const;

/** Soldado N0 (o bot "burro" do M1: alvo visível, rota pelo A*, fuzil; sem tática). */
export const AI_SOLDIER = {
  /** Folga angular extra para apertar o gatilho, além do tamanho aparente do alvo (graus). */
  fireToleranceDeg: 1,
  /** ADS a partir desta distância (m). */
  adsMinM: 8,
  /** Troca tiro chegando mais perto acima desta distância (m). */
  approachM: 30,
  /** Corre se o caminho restante passar disto (m) e estiver virado para onde vai. */
  sprintMinM: 8,
  sprintMaxTurnDeg: 30,
  /** Passeio: novo objetivo depois deste tempo (s) e tentativas de achar um nó alcançável. */
  wanderS: 15,
  wanderTries: 4,
  /**
   * Refaz a escolha da parte visível da cabeça ou do tronco do alvo (`visibleAimOffset`, ~26 raios: ~10 µs com JIT e
   * 0,23–0,26 ms jitless) a cada (s), além de na troca de alvo e de postura dele.
   */
  visibleAimRefreshS: 0.5,
  /**
   * Teto de escolhas da mira visível por tick, somando todos os bots; quem passa do teto espera o tick seguinte com a
   * escolha anterior. Sem o teto, até 9 (1 humano + 24 bots) e 17 (4 + 48) escolhas caíam no mesmo tick: um pico de
   * vários ms no interpretador (proxy do Switch). A demanda média é 0,3–1,1 por tick nesses cenários.
   */
  visibleAimPerTick: 2,
} as const;

/** Zumbi do estresse (N0 puro: sabe onde estão os bobos, persegue pelo caminho e bate). */
export const AI_ZOMBIE = {
  /** Reavalia o alvo (o bobo vivo mais perto) a cada (s), no LOD A e no B. */
  retargetSA: 0.5,
  retargetSB: 1,
  /** Perto disto (m, mesma altura) vai direto, sem caminho. */
  directM: 4,
  /** Começa a golpear a esta distância (m) do alvo (o golpe da sim alcança 1,1 m). */
  attackM: 1.05,
  /** Giro do corpo (graus/s). */
  turnDegPerS: 360,
  /** Replaneja no máximo a cada (s), no LOD A e no B. */
  replanSA: 1,
  replanSB: 2,
} as const;
