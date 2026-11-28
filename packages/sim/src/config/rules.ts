/**
 * Padrões de regra da partida (gameplay.md §5.1 e §5.2, família Bobo Warfare). A receita (`MatchRecipe.players`) pode
 * trocar HP e respawn; o resto vira regra de partida no M2.
 */
export const MATCH_DEFAULTS = {
  /** Tempo morto até renascer (configurável 0–15 s). */
  respawnS: 3,
  /** Proteção de spawn: dura isto ou até o bobo atirar. */
  spawnProtectionS: 1.5,
  /** Regeneração: espera sem tomar dano, depois cura por segundo (só nos modos `warfare.*`). */
  regenDelayS: 5,
  regenPerS: 25,
  /** Troca de arma. */
  weaponSwitchS: 0.4,
  /** Dano de queda por metro acima de `METRICS.safeFallHeight`. */
  fallDamagePerM: 12,
  /** Velocidade terminal de queda, m/s. */
  terminalSpeed: 40,
  /** Alcance de visão padrão da partida (humanos e bots), m. */
  viewDistanceM: 100,
  /**
   * M2: contagem antes da partida (gameplay.md §2.2). A sim usa `SimConfig.countdownS` (padrão 0: golden e balance
   * começam jogando); o `game` passa este valor nas partidas de verdade.
   */
  countdownS: 3,
  /** M2: empate no fim do tempo abre a morte súbita (o próximo abate que desempata vence). */
  suddenDeathS: 60,
  /** M2: assistência = 25 de dano ou mais na vítima nos últimos 10 s (gameplay.md §5.1). */
  assistMinDamage: 25,
  assistWindowS: 10,
  /** M2: quem feriu a vítima nos últimos 5 s leva o abate do plano de morte (GDD §3.8); senão é acidente. */
  killPlaneCreditS: 5,
  /** M2: no FFA, o spawn fica sem linha de visão de inimigo e a mais disto dele (gameplay.md §5.3). */
  ffaSpawnMinDistM: 20,
  /**
   * M12 (fase 7b, pergunta AM5; GDD §4.2.4): entre os pontos seguros do FFA, os 3 com o inimigo mais perto mais próximo
   * desta distância (m): perto da ação, não no canto mais longe do mapa.
   */
  ffaSpawnIdealDistM: 35,
  /**
   * M2 (fase 2b): caixinha de munição de quem morre no Bobo Warfare (gameplay.md §4.1): some depois disto e é pega a
   * esta distância (no plano) dos pés. Dá 1 pente da primária e da pistola e 1 granada, até o máximo de cada.
   */
  ammoBoxLifeS: 20,
  ammoBoxReachM: 1,
  /** M2 (fase 2b): Destravar leva a um nó a pelo menos isto de onde o bobo estava; na 3ª vez na vida, o bot renasce. */
  unstuckMinDistM: 2,
  botUnstuckRespawnAt: 3,
} as const;

/**
 * M9 (fase 2): a casa dos times do Bobo Sandbox sem ponto de spawn no mapa (os mapas só marcam os times 0 e 1): a base
 * são `basePoints` nós da navegação em cruz em volta da casa, a `baseSpreadM` um do outro; a casa fica a `marginM` da
 * borda da área jogável.
 * M10 (fase 8): cada ponto prefere um nó no chão das bases do mapa (o piso a menos de `groundToleranceM` da altura
 * dos spawns dos times que têm ponto) a até `groundReachM` (no plano) do ponto da cruz; sem nenhum, o mais perto (como
 * antes). Na Base Bobo, a casa cai em cima dos quebra-vistas de 2,5 m das rotas, e os nós de cima deles saíam primeiro.
 */
export const SANDBOX_SPAWN = {
  basePoints: 4,
  baseSpreadM: 2.5,
  marginM: 4,
  groundToleranceM: 1,
  groundReachM: 8,
} as const;

/**
 * M11 (fase 4): as armas no mapa (a regra `weapons.pickups`, GDD §4.3.2 e §4.4): a arma pega volta ao ponto `respawnS`
 * depois (GDD: 20 s); a troca pela primária de agora é no usar, a até `swapReachM` dos pés (a mesma do Royale, que a IA
 * e a dica do HUD já medem).
 */
export const MAP_WEAPONS = {
  respawnS: 20,
  swapReachM: 1.2,
} as const;

/**
 * M12 (fase 7b): para onde o bobo olha ao nascer (`spawn-facing.ts`): com a vista à frente (e a ±22,5°) livre até
 * `keepM`, o yaw do marcador; senão o rumo mais aberto de `directions` (raios de até `rangeM`), com `bonusM · cos` para o
 * rumo do marcador.
 */
export const SPAWN_FACING = {
  keepM: 4,
  directions: 16,
  rangeM: 24,
  bonusM: 2,
} as const;
