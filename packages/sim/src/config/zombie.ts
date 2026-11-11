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

/**
 * M3 (fase 2c): caído e reviver (GDD §4.1.5; gameplay.md §5.4). O bobo que levaria o golpe final cai: rasteja só com a
 * pistola e não toma mais dano; sangra até morrer em `bleedS`; um colega de pé segurando o usar por `reviveS` a até
 * `reviveRangeM` levanta ele com uma parte da vida. Sem ninguém de pé para ajudar, gasta um "levanta sozinho" e volta
 * em `selfReviveS`. Os 4 s do levanta sozinho e a metade da vida são escolhas minhas.
 */
export const ZOMBIES_DOWN = {
  bleedS: 30,
  reviveS: 3,
  reviveRangeM: 1.5,
  selfReviveS: 4,
  revivedHpFrac: 0.5,
} as const;

/** M3 (fase 2c): rastejando (caído): 1 m/s, sem pulo nem escalada. */
export const MOVEMENT_DOWNED: MovementProfile = {
  ...MOVEMENT_ZOMBIE,
  walk: 1,
  sprint: 1,
  crouch: 1,
  jump: 0,
  mantleHeight: 0,
};

/**
 * O tipo de cada zumbi (`SimState.zombieType`): M3 (fase 2a) o que anda e o que corre; fase 3b os especiais (GDD
 * §4.1.5): Sprinter (rápido, pouca vida), Chonker (maior; explode em gosma ao morrer), Spitter (cospe) e o chefão Mega
 * Bobo (1,8× maior).
 */
export const ZOMBIE_TYPE = { walker: 0, runner: 1, sprinter: 2, chonker: 3, spitter: 4, boss: 5 } as const;

/** M3 (fase 3b): o que muda por tipo: vida (× a da onda), escala do corpo (e da hitbox) e o golpe. */
export interface ZombieKind {
  readonly hpMul: number;
  readonly scale: number;
  readonly damage: number;
  readonly rangeM: number;
  readonly intervalS: number;
}

/**
 * M3 (fase 3b): os tipos, no índice do `ZOMBIE_TYPE`. O que anda e o que corre são o zumbi do M1 (`ZOMBIE_RULES`); os
 * números dos especiais são escolhas minhas (revisáveis). A vida do chefão é `bossHpPerHuman` × humanos (não a da onda).
 */
export const ZOMBIE_KINDS: readonly ZombieKind[] = [
  { hpMul: 1, scale: 1, damage: 25, rangeM: 1.1, intervalS: 1 },
  { hpMul: 1, scale: 1, damage: 25, rangeM: 1.1, intervalS: 1 },
  { hpMul: 0.5, scale: 0.9, damage: 20, rangeM: 1.1, intervalS: 0.8 },
  { hpMul: 1.6, scale: 1.3, damage: 30, rangeM: 1.3, intervalS: 1.2 },
  { hpMul: 0.9, scale: 1, damage: 20, rangeM: 1.1, intervalS: 1 },
  { hpMul: 1, scale: 1.8, damage: 60, rangeM: 1.8, intervalS: 1.5 },
];

/**
 * M3 (fase 3b): quando os especiais aparecem (da onda `*From` em diante, com a chance por zumbi solto), o chefão (uma
 * vez a cada `bossEvery` ondas), a gosma do Chonker e o cuspe do Spitter. Escolhas minhas (revisáveis).
 */
export const ZOMBIE_SPECIALS = {
  sprinterFrom: 3,
  sprinterChance: 0.08,
  chonkerFrom: 4,
  chonkerChance: 0.07,
  spitterFrom: 6,
  spitterChance: 0.07,
  bossEvery: 5,
  bossHpPerHuman: 3000,
  /** Gosma do Chonker: dano no centro e raio (m). */
  gooDamage: 40,
  gooRadiusM: 3,
  /** Cuspe do Spitter: dano no acerto, velocidade (m/s), espera entre cuspes (s) e alcance para cuspir (m). */
  spitDamage: 20,
  spitSpeed: 12,
  spitCooldownS: 3,
  spitRangeM: 15,
} as const;

/** M3 (fase 3b): o Sprinter (mais rápido que o bobo correndo, por pouco). */
export const MOVEMENT_ZOMBIE_SPRINTER: MovementProfile = { ...MOVEMENT_ZOMBIE, walk: 6.4, sprint: 6.4, accel: 45 };

/** M3 (fase 3b): o Chonker e o chefão (devagar). */
export const MOVEMENT_ZOMBIE_SLOW: MovementProfile = { ...MOVEMENT_ZOMBIE, walk: 2.7, sprint: 2.7 };

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

/**
 * M3 (fase 3d): janelas com barricada e portas pagas (GDD §4.1.5, gameplay.md §8.7). 6 tábuas; o zumbi do lado de fora
 * arranca 1 a cada 1,5 s (o chefão, todas de uma vez); o bobo do lado de dentro segurando o usar repõe 1 por
 * `repairS`, com 10 pontos por tábua até 50 por onda. A porta abre com o usar (na borda) a até `doorReachM` dela, se
 * o bobo tem os pontos. O tempo do conserto, os alcances e as medidas da caixa são escolhas minhas (revisáveis).
 */
export const ZOMBIE_BARRICADES = {
  planks: 6,
  tearS: 1.5,
  repairS: 1,
  repairPoints: 10,
  repairPointsPerWave: 50,
  /** Do plano da janela até o centro do zumbi, do lado de fora, para arrancar (m). */
  tearReachM: 0.9,
  /** Do plano da janela até o centro do bobo, do lado de dentro, para consertar (m). */
  repairReachM: 1.5,
  /** Folga além da meia largura do vão, no plano da parede (m). */
  sideSlackM: 0.4,
  /** Da caixa da porta até o centro do bobo, no plano, para comprar (m). */
  doorReachM: 1.5,
  /** Espessura da caixa das tábuas e altura padrão do vão (m). */
  thicknessM: 0.2,
  heightM: 2,
} as const;

/**
 * M3 (fase 4a): as armas na parede do Bobo Zombies (GDD §4.1.5: 500–1500). O bobo de pé na frente da arma (até
 * `wallReachM` da parede e `wallSideM` do centro, de lado) aperta o usar: arma nova vai para o slot da primária com
 * munição cheia; a que ele já tem recarrega pente e reserva por `ammoCostFrac` do preço. Escolhas minhas (revisáveis),
 * como o equipamento do começo: no Zombies o humano nasce com a pistola, a faca e 2 granadas (a primária vem da parede
 * ou da caixa); os bots de apoio continuam com a primária do loadout.
 */
export const ZOMBIE_SHOP = {
  wallReachM: 1.5,
  wallSideM: 0.9,
  ammoCostFrac: 0.5,
} as const;
