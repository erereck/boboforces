import type { MovementProfile } from './movement.ts';
import { METRICS } from './metrics.ts';

/**
 * Zumbi do teste de estresse do M1 (tecnico.md §24.1: "24 zumbis"; gameplay.md, Bobo Zombies). Corpo e hitboxes do
 * bobo, sem arma: persegue pelo caminho e bate de perto. Os números são da onda 1 do Bobo Zombies (100 de vida,
 * andando) e servem ao bench; o modo de verdade (ondas, especiais, barricadas) é do M3 e lê estes mesmos campos.
 */
export const ZOMBIE_RULES = {
  /** Vida (onda 1). */
  hp: 100,
  /** Dano do golpe no tronco (4 golpes derrubam um bobo de 100 de vida). */
  meleeDamage: 25,
  /** Alcance do golpe: distância no plano entre os centros (0,6 m de corpos encostados + o braço). */
  meleeRangeM: 1.1,
  /** Meio-ângulo do golpe à frente (graus): o zumbi precisa estar virado para o alvo. */
  meleeHalfAngleDeg: 60,
  /** Diferença máxima de altura entre os pés (m) para o golpe alcançar. */
  meleeMaxDy: 1.0,
  /** Intervalo entre golpes, s. */
  meleeIntervalS: 1.0,
  /** Força do golpe que mata (m/s): o render joga as partes nessa direção. */
  meleeForce: 3,
  /** Tempo morto até voltar (num dos spawns mais longe dos bobos). */
  respawnS: 2,
} as const;

/**
 * Movimento do zumbi: o mesmo integrador do bobo com números de "arrastar os pés" (mais lento que o andar do bobo, para
 * dar para correr dele), sem deslize nem dano de queda. Não corre: `sprint` = `walk` (o corredor do M3 é outro perfil).
 */
export const MOVEMENT_ZOMBIE: MovementProfile = {
  // Não é perfil de partida (regra `movement` da receita): é o corpo do zumbi.
  id: 'custom',
  walk: 3.4,
  sprint: 3.4,
  crouch: 2.0,
  accel: 30,
  airControl: 0.3,
  friction: 12,
  jump: METRICS.jumpHeight,
  gravity: 20,
  mantleHeight: 1.5,
  coyoteS: 0.1,
  jumpBufferS: 0.1,
  sprintFireDelayS: 0,
  adsMoveMul: 1,
  fallDamage: false,
  bhop: false,
  wallJump: false,
  doubleJump: false,
};
