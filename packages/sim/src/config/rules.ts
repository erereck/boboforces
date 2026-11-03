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
} as const;
