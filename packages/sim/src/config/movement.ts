import type { MovementProfileId, PlayerRules } from '@boboforces/format';
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
  /** M2 (fase 6a): multiplica a dispersão andando e no ar (a penalidade de precisão em movimento; ausente = 1, média). */
  readonly moveSpreadMul?: number;
  /** M2 (fase 6a): fração da velocidade horizontal que sobra ao aterrissar (o Tático freia; ausente = não freia). */
  readonly landingKeep?: number;
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

/**
 * M2 (fase 6a): perfil Tático (gameplay.md §3.3, estilo CS): mais lento, pulo baixo, sem deslizar, aterrissar freia e
 * errar andando custa mais. Os números da tabela; o resto é escolha minha (revisável, `ARCHITECTURE.md` §12.39):
 * aceleração 45 m/s² (andar em ~0,09 s), controle no ar 0,2, voltar a atirar depois de correr em 0,2 s, aterrissar
 * mantém 60% da velocidade e a dispersão andando e no ar vale ×1,4 (a penalidade "alta"). A escalada de 1,0 m sai de
 * pulo 0,8 + borda 0,2: todo mapa continua atravessável (§3.6).
 */
export const MOVEMENT_TACTICAL: MovementProfile = {
  id: 'tactical',
  walk: 4.0,
  sprint: 5.5,
  crouch: 2.0,
  accel: 45,
  airControl: 0.2,
  friction: 18.5,
  jump: 0.8,
  gravity: 20,
  mantleHeight: 1.0,
  coyoteS: 0.1,
  jumpBufferS: 0.1,
  sprintFireDelayS: 0.2,
  adsMoveMul: 0.6,
  fallDamage: true,
  moveSpreadMul: 1.4,
  landingKeep: 0.6,
  bhop: false,
  wallJump: false,
  doubleJump: false,
};

/**
 * Pulo mínimo (m) depois da gravidade e do multiplicador: com a borda de até 0,5 m no ar, alcança 1,0 m (mais 5 cm de
 * folga, porque o ápice quase nunca cai num tick), e todo mapa continua atravessável (gameplay.md §3.6) mesmo com
 * gravidade 2× no Tático ou pulo 0,5× com gravidade alta.
 */
export const MIN_JUMP_HEIGHT = 0.55;

/**
 * M2 (fase 6a): o perfil da partida pelas regras dos jogadores. Tático ou Bobo como base (o Arcade é do M6+: até lá,
 * Bobo); o Personalizado é o Bobo com velocidade (andar, correr, agachar, aceleração e deslize) e pulo multiplicados.
 * A gravidade (fase 4e) mantém a velocidade do pulo: a gravidade menor faz subir mais, por isso a altura divide por
 * ela. Sem nada mudado, devolve o próprio perfil base (o golden não muda).
 */
export function resolveMovementProfile(players: PlayerRules | undefined): MovementProfile {
  const id = players?.movement ?? 'bobo';
  const base = id === 'tactical' ? MOVEMENT_TACTICAL : MOVEMENT_BOBO;
  const custom = id === 'custom';
  const g = players?.gravity ?? 1;
  const speed = custom ? (players?.speed ?? 1) : 1;
  const jumpMul = custom ? (players?.jump ?? 1) : 1;
  const fall = players?.fallDamage;
  if (!custom && g === 1 && fall === undefined) return base;
  return {
    ...base,
    id: custom ? 'custom' : base.id,
    walk: base.walk * speed,
    sprint: base.sprint * speed,
    crouch: base.crouch * speed,
    accel: base.accel * speed,
    ...(base.slide ? { slide: { ...base.slide, startSpeed: base.slide.startSpeed * speed } } : {}),
    gravity: base.gravity * g,
    jump: Math.max(MIN_JUMP_HEIGHT, (base.jump * jumpMul) / g),
    fallDamage: fall ?? base.fallDamage,
  };
}
