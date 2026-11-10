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

/**
 * M3 (fase 2a): o Bobo Zombies (GDD §4.1.5; gameplay.md "Bobo Zombies"). As fórmulas das ondas e os tempos do diretor.
 * Os números da onda vêm do GDD; o intervalo e o ritmo de soltar zumbis são escolhas minhas (revisáveis).
 */
export const ZOMBIES_MODE = {
  /** Antes da 1ª onda (depois da contagem) e entre as ondas, s. */
  firstWaveS: 5,
  intermissionS: 10,
  /** Um zumbi novo a cada tanto, s (enquanto a onda ainda tem zumbis para soltar e há lugar no pool). */
  spawnIntervalS: 0.6,
  /** Total da onda = (base + porOnda × onda) × (1 + porHumano × (humanos − 1)) × quantidade. */
  baseCount: 6,
  perWave: 4,
  perExtraHuman: 0.5,
  /** Vida: base + porOnda × (onda − 1) até a onda `linearUntil`; depois × `growth` por onda. */
  hpBase: 100,
  hpPerWave: 60,
  hpLinearUntil: 10,
  hpGrowth: 1.1,
  /** Andando até a onda `runnersFrom − 1`, misto até `allRunFrom − 1`, todos correndo dali em diante. */
  runnersFrom: 5,
  allRunFrom: 10,
  /** O zumbi nasce a pelo menos isto (m, no plano) de todo bobo vivo, se algum ponto deixar. */
  minSpawnDistM: 12,
  /** Pool quando a partida não diz (o teto do aparelho é do `game`). */
  poolDefault: 24,
} as const;

/**
 * M3 (fase 2b): os pontos do Bobo Zombies (GDD §4.1.5): por acerto que tira vida de um zumbi e o bônus do abate (na
 * cabeça e de faca valem mais). Tudo × a economia da partida. Começar com 500 é escolha minha (o GDD não diz).
 */
export const ZOMBIE_POINTS = {
  start: 500,
  hit: 10,
  kill: 60,
  headshotKill: 100,
  knifeKill: 130,
} as const;

/** M3 (fase 2a): o tipo de cada zumbi (`SimState.zombieType`). Os especiais e o chefão chegam na fase 3. */
export const ZOMBIE_TYPE = { walker: 0, runner: 1 } as const;

/** M3 (fase 2a): o zumbi que corre (da onda 5 em diante, e o último de cada onda). Mais rápido que o andar do bobo. */
export const MOVEMENT_ZOMBIE_RUNNER: MovementProfile = { ...MOVEMENT_ZOMBIE, walk: 5.2, sprint: 5.2, accel: 40 };

/** Quantos zumbis a onda `wave` (1..) solta. */
export function zombiesInWave(wave: number, humans: number, quantity: number): number {
  const Z = ZOMBIES_MODE;
  const base = Z.baseCount + Z.perWave * wave;
  return Math.max(1, Math.round(base * (1 + Z.perExtraHuman * (Math.max(1, humans) - 1)) * quantity));
}

/** Vida dos zumbis da onda `wave` (1..), com o multiplicador da partida. */
export function zombieWaveHp(wave: number, hpMul: number): number {
  const Z = ZOMBIES_MODE;
  const linear = Z.hpBase + Z.hpPerWave * (Math.min(wave, Z.hpLinearUntil) - 1);
  const grown = wave > Z.hpLinearUntil ? linear * Z.hpGrowth ** (wave - Z.hpLinearUntil) : linear;
  return Math.max(1, Math.round(grown * hpMul));
}

/** Chance de um zumbi da onda `wave` correr: 0 até a 4, cresce até a 9, 1 da 10 em diante. */
export function runnerChance(wave: number): number {
  const Z = ZOMBIES_MODE;
  if (wave < Z.runnersFrom) return 0;
  if (wave >= Z.allRunFrom) return 1;
  return (wave - Z.runnersFrom + 1) / (Z.allRunFrom - Z.runnersFrom + 1);
}
