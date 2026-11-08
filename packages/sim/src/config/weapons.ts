import { FIGURE_GRIP, type FigureGrip } from '@boboforces/format';
import { HEADSHOT_MULTIPLIER } from './metrics.ts';

/**
 * Armas como dado (gameplay.md §4.3, tecnico.md §7.2). Tudo em unidades por segundo e graus; a sim converte para ticks
 * e radianos ao criar a partida. M0: só o fuzil (Rattler), no slot 0. O resto do arsenal entra no M2 nesta mesma tabela.
 */
export interface WeaponDef {
  /** ID de conteúdo sem prefixo (`weapon:rifle`). Nunca muda. */
  readonly id: string;
  /** Dano no tronco a até `falloffStartM`. */
  readonly damage: number;
  /** Multiplicador na cabeça (braços e pernas usam `PART_DAMAGE_MULTIPLIER`). */
  readonly headMultiplier: number;
  /** Cadência, tiros por minuto. */
  readonly rpm: number;
  readonly automatic: boolean;
  readonly clipSize: number;
  /** Munição de reserva ao nascer (3 pentes, gameplay.md §4.1). */
  readonly reserve: number;
  readonly reloadS: number;
  /** Dano cheio até aqui; cai em linha reta até `minDamage` em `falloffEndM`, e fica nisso depois. */
  readonly falloffStartM: number;
  readonly falloffEndM: number;
  readonly minDamage: number;
  /** Alcance máximo do hitscan. */
  readonly rangeM: number;
  /** Meio-ângulo do cone de dispersão no quadril, parado (graus). */
  readonly hipSpreadDeg: number;
  /** Multiplicador da dispersão no ADS (gameplay.md §3.4: 0,3x). */
  readonly adsSpreadMul: number;
  /** Recuo vertical por tiro (graus, para cima) e teto acumulado. */
  readonly recoilKickDeg: number;
  readonly recoilMaxDeg: number;
  /** Ruído horizontal do recuo por tiro (graus, uniforme em ±). */
  readonly recoilYawNoiseDeg: number;
  /** Depois de parar de atirar por este tempo, o recuo volta ao centro nesta velocidade (graus/s). */
  readonly recoilRecoverDelayS: number;
  readonly recoilRecoverDegPerS: number;
  /**
   * Força do tiro que mata (m/s, `KillEvent.force`): o render joga as partes do bobo que se desmonta nessa velocidade,
   * na direção do tiro. Cosmético (não mexe em nada da sim).
   */
  readonly killForce: number;
  /**
   * Empunhadura do boneco (#56, PLANO do porte §B3): escolhe a postura da tabela de jogo (`figurePosture`), que dá a
   * pose de 3ª pessoa e as hitboxes. Só existem pistola, fuzil e sniper; arma nova usa a mais parecida (escopeta e
   * submetralhadora: fuzil, duas mãos com coronha no ombro).
   */
  readonly grip: FigureGrip;
}

/** Fuzil (`weapon:rifle`, "Rattler"): 28 no corpo, 1,5x na cabeça, 600/min, pente de 30, recarga de 2,2 s. */
export const WEAPON_RIFLE: WeaponDef = {
  id: 'rifle',
  damage: 28,
  headMultiplier: HEADSHOT_MULTIPLIER.default,
  rpm: 600,
  automatic: true,
  clipSize: 30,
  reserve: 90,
  reloadS: 2.2,
  falloffStartM: 35,
  falloffEndM: 60,
  minDamage: 20,
  rangeM: 200,
  // Os números de dispersão e recuo abaixo são PROVISÓRIOS (M0): o robô de balanceamento calibra no M2.
  hipSpreadDeg: 1.6,
  adsSpreadMul: 0.3,
  recoilKickDeg: 0.35,
  recoilMaxDeg: 3.5,
  recoilYawNoiseDeg: 0.15,
  recoilRecoverDelayS: 0.15,
  recoilRecoverDegPerS: 12,
  killForce: 6,
  grip: FIGURE_GRIP.rifle,
};

/** Arma de cada slot (índice = `InputFrame.weapon`). `null` = slot vazio. M0: só a primária. */
export const WEAPON_SLOTS: readonly (WeaponDef | null)[] = [WEAPON_RIFLE];

/**
 * Multiplicador da dispersão por estado (gameplay.md §3.4). Agachado vale parado ou andando; no ar ganha de tudo.
 * Correndo (sprint) o perfil Bobo nem atira.
 */
export const SPREAD_STATE_MULTIPLIER = {
  still: 1.0,
  walking: 1.5,
  crouching: 0.8,
  air: 2.5,
} as const;

/** Acima desta velocidade horizontal (m/s) conta como "andando" para a dispersão. */
export const SPREAD_WALKING_SPEED = 1.0;

/** Dano da arma a `distanceM` (sem multiplicador de parte). */
export function weaponDamageAt(def: WeaponDef, distanceM: number): number {
  if (distanceM <= def.falloffStartM) return def.damage;
  if (distanceM >= def.falloffEndM) return def.minDamage;
  const t = (distanceM - def.falloffStartM) / (def.falloffEndM - def.falloffStartM);
  return def.damage + (def.minDamage - def.damage) * t;
}
