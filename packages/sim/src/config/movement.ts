import type { MovementProfileId } from '@boboforces/format';
import { METRICS } from './metrics.ts';

/**
 * Perfil de movimento = dado (decisão #8, tecnico.md §7.2). Um conjunto único de parâmetros; os perfis são presets.
 * Tudo em unidades por segundo (o tick converte), para o Switch poder rodar a 30 Hz sem rebalancear.
 */
export interface SlideParams {
  readonly durationS: number;
  readonly startSpeed: number;
  readonly cooldownS: number;
}

export interface MovementProfile {
  readonly id: MovementProfileId;
  /** Velocidades no chão, m/s. */
  readonly walk: number;
  readonly sprint: number;
  readonly crouch: number;
  /** Aceleração no chão, m/s². */
  readonly accel: number;
  /** Fração do controle no ar (0..1). */
  readonly airControl: number;
  /** Atrito no chão, 1/s: sem input a velocidade cai como `v·e^(-friction·t)` (até parar anda `v/friction` m). */
  readonly friction: number;
  /** Altura do pulo, m (a velocidade inicial sai de `sqrt(2 · gravity · jump)`). */
  readonly jump: number;
  /** Gravidade, m/s². */
  readonly gravity: number;
  /** Escalar borda (mantle) até esta altura, m. */
  readonly mantleHeight: number;
  /** Tempo de "coyote" depois de sair da borda, s. */
  readonly coyoteS: number;
  /** Buffer de pulo apertado antes de tocar o chão, s. */
  readonly jumpBufferS: number;
  /** Tempo para voltar a atirar depois de correr, s. */
  readonly sprintFireDelayS: number;
  /** Multiplicador de velocidade durante o ADS. */
  readonly adsMoveMul: number;
  readonly fallDamage: boolean;
  readonly slide?: SlideParams;
  readonly bhop?: boolean;
  readonly wallJump?: boolean;
  readonly doubleJump?: boolean;
}

/**
 * Perfil Bobo (padrão, gameplay.md §3.3): rápido e gostoso, com correr, pular e deslizar; sem bhop.
 *
 * Os campos sem número no GDD foram calibrados no M0 na sim headless, contra alvos medidos em `movement.test.ts`:
 * - accel 60 m/s²: parado → andar (4,8 m/s) em 0,08 s; parado → correr em ~0,12 s (resposta de arcade);
 * - friction 18,5/s (exponencial exato): andar → parado em ~0,25 s, deslizando ~0,26 m, igual a 30 e a 60 Hz (dá
 *   para "contra-strafar" sem patinar);
 * - gravity 20 m/s²: pulo de 1,0 m com ~0,63 s no ar (pulo curto e firme, sem "flutuar");
 * - airControl 0,3, coyote e buffer de pulo de 0,1 s (valores comuns de plataforma).
 * A sensação final é aprovada na cena de teste do M1, com controle na mão.
 */
export const MOVEMENT_BOBO: MovementProfile = {
  id: 'bobo',
  walk: 4.8,
  sprint: 6.8,
  crouch: 2.4,
  accel: 60,
  airControl: 0.3,
  friction: 18.5,
  jump: METRICS.jumpHeight,
  gravity: 20,
  mantleHeight: 1.5,
  coyoteS: 0.1,
  jumpBufferS: 0.1,
  sprintFireDelayS: 0.15,
  adsMoveMul: 0.6,
  fallDamage: true,
  slide: { durationS: 0.7, startSpeed: 8, cooldownS: 1 },
  bhop: false,
  wallJump: false,
  doubleJump: false,
};
