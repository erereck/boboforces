import type { WeaponCategory } from '@boboforces/sim';

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
  /**
   * M2 (fase 2b, GDD §3.8): sem alvo à vista e sem progresso por `unstuckS` (nem `unstuckProgressM` mais perto do
   * objetivo, nem `unstuckMoveM` andados no plano), aperta Destravar; a sim leva ao nó livre mais perto fora da vista
   * dos humanos e, na 3ª vez, a um spawn. Trocar de objetivo sozinho não conta (o bot numa ilha da navegação troca
   * sem sair do lugar).
   */
  unstuckS: 8,
  unstuckProgressM: 1,
  unstuckMoveM: 2,
  /** Afasta-se de corpos a menos disto (m), sem RVO (tecnico.md §8.1). */
  separationM: 0.9,
  separationWeight: 0.8,
  /** Capacidade de cada caminho (nós). */
  pathCapacity: 256,
} as const;

/**
 * M2 (fase 3c): cobertura do N1 (gameplay.md §6.3). Ao tomar dano, a chance de correr para a cobertura é
 * `baseChance + cautionWeight·cautela − aggressionWeight·agressividade` (+ `lowHpBonus` com a vida abaixo de
 * `lowHpFrac`). A cobertura é um nó da navegação a `minM`..`maxM` m, para o lado oposto da ameaça (±`spreadDeg`), de
 * onde o olho da ameaça (`threatEyeM`) não vê o olho do bot agachado (`coverEyeM`); `samples` tentativas.
 */
export const AI_COVER = {
  baseChance: 0.35,
  cautionWeight: 0.5,
  aggressionWeight: 0.35,
  lowHpFrac: 0.5,
  lowHpBonus: 0.3,
  samples: 8,
  spreadRad: (75 * Math.PI) / 180,
  minM: 3,
  maxM: 9,
  threatEyeM: 1.55,
  coverEyeM: 0.85,
  arriveM: 0.8,
  /** Indo para a cobertura com o alvo mais perto que isto (m): troca tiro em vez de correr. */
  fightBelowM: 5,
  /** Tempos (s): desiste de chegar, fica agachado (mínimo + até `holdExtraS` pela paciência), espera para a próxima. */
  goingS: 5,
  holdMinS: 1.2,
  holdExtraS: 2.5,
  cooldownS: 4,
} as const;

/**
 * M2 (fase 3d): segurar o ângulo (N2): ao perder o alvo de vista, chance `baseChance + patienceWeight·paciência −
 * aggressionWeight·agressividade` de ficar parado mirando onde ele sumiu, por `minS` + até `extraS` pela paciência.
 */
export const AI_HOLD = { baseChance: 0.2, patienceWeight: 0.6, aggressionWeight: 0.3, minS: 1, extraS: 2 } as const;

/**
 * M2 (fase 3d): flanquear (N2): chance `baseChance + patienceWeight·paciência` ao perder o alvo a `minM`..`maxM` m;
 * o ponto de flanco fica `backM` atrás da última posição do inimigo (do lado do bot) e `sideM` para o lado; desiste
 * em `timeoutS`.
 */
export const AI_FLANK = {
  baseChance: 0.15,
  patienceWeight: 0.5,
  minM: 10,
  maxM: 45,
  backM: 4,
  sideM: 10,
  timeoutS: 8,
} as const;

/**
 * M2 (fase 3d): recuar (N2): com o alvo à vista e a vida abaixo de `belowBase + belowCaution·cautela` da cheia, corre
 * para uma cobertura a `minM`..`maxM` m e fica lá até `untilHpFrac` da vida (ou `holdS`).
 */
export const AI_RETREAT = {
  belowBase: 0.25,
  belowCaution: 0.25,
  minM: 8,
  maxM: 16,
  untilHpFrac: 0.8,
  holdS: 8,
} as const;

/**
 * M2 (fase 3d): granada (N2): o inimigo sumiu há até `memoryS` a `minM`..`maxM` m (fora do raio da própria
 * explosão); sorteio pelo `skill.grenadeUse` no máximo a cada `decideS`. Mira o arco com tolerância `aimTolDeg`, cozinha
 * o pavio menos o voo e `fuseSlackS` (até `maxCookS`), e espera `cooldownS` para a próxima.
 */
export const AI_GRENADE = {
  minM: 7,
  maxM: 25,
  memoryS: 4,
  decideS: 1.5,
  switchS: 0.45,
  aimTolDeg: 3,
  fuseSlackS: 0.4,
  maxCookS: 1.2,
  cooldownS: 8,
} as const;

/**
 * M2 (fases 3e e 3f): o time (N3) e o leitor (N4).
 * - Avisos: anel de `pingCapacity`; cada bot avisa no máximo a cada `pingEveryS`; quem está sem pista vai atrás de
 *   aviso com até `pingMaxAgeS` a até `pingMaxM`.
 * - Dupla/trio: segue o objetivo de um líder (aliado N3 de controlador menor) a até `buddyM`, escolhido há até
 *   `buddyGoalAgeS`, com `buddyOffsetM` de folga. Cerco: o flanco ganha `siegeFlankBonus` e o lado vem do índice.
 * - Calor (N4): células de `heatCellM`, amostra a cada `heatSampleS`, meia-vida `heatHalfLifeS` (a memória decai em
 *   ~2 min, gameplay.md §6.3); abate de humano pesa `heatKillWeight`, morte do time pesa `dangerWeight`.
 * - Uso do calor: caçar (`huntChance` de passear para a célula quente a `huntMinM`..`huntMaxM`), evitar passeio em
 *   célula com perigo ≥ `dangerAvoid`, pré-mirar a célula quente a `preAimMinM`..`preAimMaxM` a cada `preAimEveryS`,
 *   granada na célula quente (metade da chance de granada) e fingir recuar (`fakeRetreatChance` ao achar um alvo com
 *   mais de `fakeRetreatHpFrac` da vida).
 */
export const AI_TEAM = {
  pingCapacity: 16,
  pingEveryS: 1,
  pingMaxAgeS: 3,
  pingMaxM: 60,
  buddyM: 25,
  buddyGoalAgeS: 10,
  buddyOffsetM: 3,
  siegeFlankBonus: 0.3,
  heatCellM: 4,
  heatSampleS: 1,
  heatHalfLifeS: 60,
  heatKillWeight: 5,
  dangerWeight: 3,
  minHeat: 3,
  huntChance: 0.5,
  huntMinM: 12,
  huntMaxM: 60,
  dangerAvoid: 2.5,
  preAimMinM: 8,
  preAimMaxM: 40,
  preAimEveryS: 1,
  fakeRetreatChance: 0.15,
  fakeRetreatHpFrac: 0.7,
} as const;

/**
 * M2 (fase 3g): o comportamento visível de cada personalidade (gameplay.md §6.4; `persona.ts`). Tempos em segundos e
 * distâncias em metros.
 */
export const AI_PERSONA = {
  /** Pulinhos de bobeira andando: a cada `hopEveryS`, chance `bobeira·hopWeight`. */
  hopEveryS: 1,
  /** M2 (fase 5d): o Alvo que anda troca de lado a cada tanto. */
  dummyStrideS: 1.4,
  hopWeight: 0.4,
  /** Rusher e Kamikaze: correm até o contato (passando desta folga além da distância preferida) e pulam em combate. */
  sprintGapM: 6,
  rusherJumpMinS: 0.7,
  rusherJumpMaxS: 1.6,
  /** Lunático: troca de intenção a cada 2–5 s; distância sorteada; tiro pro alto (graus acima do horizonte, s). */
  lunaticIntentMinS: 2,
  lunaticIntentMaxS: 5,
  lunaticRangeMinM: 2,
  lunaticRangeMaxM: 35,
  lunaticSkyDeg: 65,
  lunaticSkyS: 0.8,
  lunaticJumpS: 0.6,
  /**
   * Covarde: foge com a vida abaixo de `cowardFleeHp` (precisa do recuo do N2) e manda um aviso de ajuda; mantém
   * `cowardKeepFrac` da distância preferida; finge de morto com a vida abaixo de `playDeadBelowHp` (uma vez por vida).
   */
  cowardFleeHp: 0.6,
  cowardKeepFrac: 0.5,
  playDeadBelowHp: 0.4,
  playDeadChance: 0.35,
  playDeadS: 4,
  /**
   * Camper: um ponto com visão (o mais alto de `campSamples` nós a `campMinM`..`campMaxM` m); fica lá
   * `campHoldS + paciência·campHoldExtraS`, agachado, olhando em volta ±`campScanDeg`; sai depois de `campKills`
   * abates, ao tomar dano (foi descoberto) ou no fim do tempo, e tenta outro ponto depois de `campRetryS`.
   */
  campSamples: 10,
  campMinM: 8,
  campMaxM: 50,
  campHoldS: 20,
  campHoldExtraS: 40,
  campKills: 2,
  campScanDeg: 35,
  campRetryS: 5,
  /** Estrategista (N2+): bônus na chance de flanquear ao perder o alvo; anda com o time sem precisar do N3. */
  strategistFlankBonus: 0.35,
  /**
   * Kamikaze e Caçador: a presa (o Caçador escolhe o humano com mais abates; o Kamikaze, o humano mais perto), refeita
   * a cada `quarryEveryS`; sem pista, vão até ela com um erro de até `pursuitNoiseM`, refeito a cada `pursuitEveryS`.
   */
  quarryEveryS: 10,
  pursuitEveryS: 4,
  pursuitNoiseM: 6,
  /** Kamikaze: com granada, a menos disto do alvo troca para ela e segura o gatilho até explodir na mão. */
  kamikazeBoomM: 3,
  /** Suporte: segue o humano aliado (fica a `supportNearM`..`supportFarM` atrás dele) e vigia as costas dele. */
  supportNearM: 3,
  supportFarM: 6,
  supportEveryS: 1.5,
  /** Palhaço: dancinha de `danceS` depois do abate (gira, agacha e pula). */
  danceS: 2,
  danceSpinDegPerS: 540,
  danceCrouchS: 0.25,
  danceJumpS: 0.6,
} as const;

/** M2 (fase 3c): patrulha do N1: olhando em volta enquanto anda sem pista do inimigo (a cada 1,5–3,5 s, ±`deg`). */
export const AI_PATROL = { everyMinS: 1.5, everyMaxS: 3.5, holdS: 0.7, deg: 40 } as const;

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

/**
 * Como o soldado usa cada categoria de arma (M2, fase 1d; gameplay.md §4.2 "cada arma tem 1 papel e 1 fraqueza"). A
 * IA decide pela arma NA MÃO (troca de slot leva 0,4 s).
 */
export interface AiWeaponUse {
  /** Chega mais perto acima desta distância (m). */
  readonly approachM: number;
  /** Recua abaixo desta distância (m; 0 = nunca). */
  readonly retreatM: number;
  /** ADS a partir desta distância (m; `Infinity` = nunca). */
  readonly adsMinM: number;
  /** Só atira com o ADS completo (a sniper espalha 6° no quadril). */
  readonly needFullAds: boolean;
  /** Abaixo desta distância (m) troca a primária pela pistola (0 = nunca): foguete (autodano) e sniper (lenta). */
  readonly pistolBelowM: number;
  /** Mira no pé do alvo com antecipação pela velocidade do projétil (foguete). */
  readonly splash: boolean;
}

export const AI_WEAPON_USE: Readonly<Record<WeaponCategory, AiWeaponUse>> = {
  rifle: { approachM: 30, retreatM: 0, adsMinM: 8, needFullAds: false, pistolBelowM: 0, splash: false },
  lmg: { approachM: 30, retreatM: 0, adsMinM: 10, needFullAds: false, pistolBelowM: 0, splash: false },
  smg: { approachM: 12, retreatM: 0, adsMinM: 12, needFullAds: false, pistolBelowM: 0, splash: false },
  shotgun: { approachM: 6, retreatM: 0, adsMinM: Infinity, needFullAds: false, pistolBelowM: 0, splash: false },
  sniper: { approachM: 60, retreatM: 12, adsMinM: 0, needFullAds: true, pistolBelowM: 6, splash: false },
  explosive: { approachM: 30, retreatM: 8, adsMinM: 10, needFullAds: false, pistolBelowM: 5, splash: true },
  pistol: { approachM: 20, retreatM: 0, adsMinM: 10, needFullAds: false, pistolBelowM: 0, splash: false },
  melee: { approachM: 0, retreatM: 0, adsMinM: Infinity, needFullAds: false, pistolBelowM: 0, splash: false },
  throwable: { approachM: 20, retreatM: 0, adsMinM: Infinity, needFullAds: false, pistolBelowM: 0, splash: false },
};

/** Faca: troca para ela com o alvo colado (m) e volta para a arma de fogo longe disto (m). */
export const AI_KNIFE = { switchM: 1.6, backM: 3 } as const;

/** Volta da pistola para a primária só com o alvo esta folga (m) além do `pistolBelowM` (sem trocar sem parar). */
export const AI_PISTOL_HYSTERESIS_M = 2;

/** Zumbi do estresse (N0 puro: sabe onde estão os bobos, persegue pelo caminho e bate). */
/**
 * M3 (fase 3a): os bots de apoio do Bobo Zombies. Vão levantar o colega caído até esta distância (m) e seguram o usar
 * colados nele; com um zumbi à vista a menos de `fightM`, atiram primeiro.
 */
export const AI_SUPPORT = {
  reviveSeekM: 30,
  reviveReachM: 1.1,
  fightM: 4,
  /** Zumbi mais perto que isto (m): o bot recua atirando. */
  kiteM: 6,
} as const;

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
