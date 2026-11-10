import { FIGURE_GRIP, type FigureGrip } from '@boboforces/format';
import { HEADSHOT_MULTIPLIER } from './metrics.ts';

/**
 * Armas como dado (gameplay.md §4.3, tecnico.md §7.2). Tudo em unidades por segundo, metros e graus; a sim converte
 * para ticks e radianos. M2 (fase 1): as 8 armas do MVP mais a LMG de reserva (#61: nomes aprovados como estão).
 *
 * Cada arma tem um CÓDIGO numérico estável (`WEAPON_CODE`), que é o índice em `WEAPONS`: é o que vai no estado da sim
 * (`SimView.weapon`, `loadout`), nos eventos (`weapon`) e no render. O fuzil é 0, como o slot 0 do M1. Códigos nunca
 * mudam nem são reaproveitados (regra 20, como os IDs de conteúdo); arma nova entra no fim.
 */

/** Como a arma dispara (`WeaponDef.fire`). */
export const WEAPON_FIRE = {
  /** Hitscan de 1 raio. */
  bullet: 0,
  /** Hitscan de `pellets` raios num cone fixo; o dano soma por alvo (um item de dano por alvo e por tiro). */
  pellets: 1,
  /** Projétil reto que explode no contato (foguete; fase 1b). */
  projectile: 2,
  /** Golpe à frente até `meleeRangeM` (faca). */
  melee: 3,
  /** Arremesso com gravidade, quica e explode no pavio (granada; fase 1b). */
  thrown: 4,
} as const;
export type WeaponFire = (typeof WEAPON_FIRE)[keyof typeof WEAPON_FIRE];

/**
 * Slots do loadout, na ordem do `InputFrame.weapon` (gameplay.md §4.1: primária, pistola, faca e 2 granadas). São
 * `WEAPON_SLOT_COUNT` do input (4); os arrays por slot da sim têm esse passo.
 */
export const WEAPON_SLOT = { primary: 0, secondary: 1, melee: 2, throwable: 3 } as const;

/** Código estável de cada arma = índice em `WEAPONS`. */
export const WEAPON_CODE = {
  rifle: 0,
  pistol: 1,
  smg: 2,
  shotgun: 3,
  sniper: 4,
  rocket: 5,
  knife: 6,
  grenade: 7,
  lmg: 8,
} as const;
export type WeaponCode = (typeof WEAPON_CODE)[keyof typeof WEAPON_CODE];

/** Categoria exibida ("Rattler · Fuzil") e usada pela IA para o alcance preferido. */
export type WeaponCategory =
  'pistol' | 'smg' | 'rifle' | 'shotgun' | 'sniper' | 'explosive' | 'melee' | 'throwable' | 'lmg';

export interface WeaponDef {
  /** ID de conteúdo sem prefixo (`weapon:rifle`). Nunca muda. */
  readonly id: string;
  /** Código numérico estável (índice em `WEAPONS`). */
  readonly code: number;
  /** Slot do loadout em que a arma vive (`WEAPON_SLOT`). */
  readonly slot: number;
  readonly category: WeaponCategory;
  readonly fire: WeaponFire;
  /**
   * Dano no tronco a até `falloffStartM` (por chumbo na escopeta; o golpe de frente na faca; o acerto direto no
   * foguete). Explosões usam `blastDamage`.
   */
  readonly damage: number;
  /** Multiplicador na cabeça (braços e pernas usam `PART_DAMAGE_MULTIPLIER`). 1 = sem bônus. */
  readonly headMultiplier: number;
  /** Cadência, tiros (ou golpes) por minuto. */
  readonly rpm: number;
  readonly automatic: boolean;
  /** Pente (na granada, quantas por vida). 0 = sem munição (faca). */
  readonly clipSize: number;
  /** Munição de reserva ao nascer (3 pentes, gameplay.md §4.1). */
  readonly reserve: number;
  /** Recarga do pente inteiro (s). */
  readonly reloadS: number;
  /**
   * Recarga por cartucho (s; escopeta 0,5): > 0 põe 1 cartucho a cada intervalo até encher, e atirar com algum no
   * pente interrompe. 0 = pente inteiro em `reloadS`.
   */
  readonly reloadPerRoundS: number;
  /** Dano cheio até aqui; cai em linha reta até `minDamage` em `falloffEndM`, e fica nisso depois. */
  readonly falloffStartM: number;
  readonly falloffEndM: number;
  readonly minDamage: number;
  /** Alcance máximo do hitscan (e do golpe na faca: `meleeRangeM`). */
  readonly rangeM: number;
  /** Chumbos por tiro (1 fora da escopeta) e o meio-ângulo do cone fixo deles (graus). */
  readonly pellets: number;
  readonly pelletSpreadDeg: number;
  /** Meio-ângulo do cone de dispersão no quadril, parado (graus). */
  readonly hipSpreadDeg: number;
  /** Multiplicador da dispersão com o ADS completo (gameplay.md §3.4: 0,3x; a sniper quase zera). */
  readonly adsSpreadMul: number;
  /** Tempo para o ADS completo (0,2–0,35 s, gameplay.md §3.5); sair leva o mesmo. */
  readonly adsInS: number;
  /** Zoom do ADS completo (divide a tangente do FOV; a sniper tem 4x). */
  readonly adsZoom: number;
  /** Recuo vertical por tiro (graus, para cima) e teto acumulado. */
  readonly recoilKickDeg: number;
  readonly recoilMaxDeg: number;
  /**
   * Padrão horizontal fixo, "aprendível" (gameplay.md §4.1): o n-ésimo tiro da rajada desvia
   * `recoilPatternDeg · sen(n · 0,9)` para o lado, mais o ruído pequeno `recoilYawNoiseDeg` (uniforme em ±).
   */
  readonly recoilPatternDeg: number;
  readonly recoilYawNoiseDeg: number;
  /** Depois de parar de atirar por este tempo, o recuo volta ao centro nesta velocidade (graus/s). */
  readonly recoilRecoverDelayS: number;
  readonly recoilRecoverDegPerS: number;
  /**
   * Força do golpe que mata (m/s, `KillEvent.force`): o render joga as partes do bobo que se desmonta nessa
   * velocidade, na direção do golpe. Cosmético (não mexe em nada da sim).
   */
  readonly killForce: number;
  /**
   * Empunhadura do boneco (#56, PLANO do porte §B3): escolhe a postura da tabela de jogo (`figurePosture`), que dá a
   * pose de 3ª pessoa e as hitboxes. Só existem pistola, fuzil e sniper: as armas novas usam a mais parecida (SMG,
   * escopeta, foguete e LMG: fuzil; faca e granada: pistola, uma mão).
   */
  readonly grip: FigureGrip;
  /** Faca: alcance do golpe (m) e o dano pelas costas (gameplay.md §4.3: 55 de frente, 100 pelas costas). */
  readonly meleeRangeM: number;
  readonly backstabDamage: number;
  /**
   * Projéteis (foguete e granada; fase 1b): velocidade de saída (m/s), gravidade (m/s²; 0 = reto), pavio (s; 0 =
   * explode no contato), explosão (dano no centro, raio em m, queda linear até 0 na borda) e a fração do autodano
   * (gameplay.md §5.1: 50%).
   */
  readonly projectileSpeed: number;
  readonly projectileGravity: number;
  readonly fuseS: number;
  readonly blastDamage: number;
  readonly blastRadiusM: number;
  readonly selfDamageMul: number;
}

/** Valores neutros das armas que não usam um campo (chumbos, faca, projétil). */
const BASE = {
  reloadPerRoundS: 0,
  pellets: 1,
  pelletSpreadDeg: 0,
  meleeRangeM: 0,
  backstabDamage: 0,
  projectileSpeed: 0,
  projectileGravity: 0,
  fuseS: 0,
  blastDamage: 0,
  blastRadiusM: 0,
  selfDamageMul: 0,
} as const;

/** Sem queda de dano (sniper, foguete, faca, granada). */
const NO_FALLOFF = 1e9;

// Os números de dispersão, ADS e recuo abaixo são PROVISÓRIOS: o robô de balanceamento calibra no M2. Dano, cadência,
// pente, recarga e queda são os da gameplay.md §4.3.

/** Fuzil (`weapon:rifle`, "Rattler"): 28 no corpo, 1,5x, 600/min, pente de 30, recarga de 2,2 s, 100% até 35 m. */
export const WEAPON_RIFLE: WeaponDef = {
  ...BASE,
  id: 'rifle',
  code: WEAPON_CODE.rifle,
  slot: WEAPON_SLOT.primary,
  category: 'rifle',
  fire: WEAPON_FIRE.bullet,
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
  hipSpreadDeg: 1.6,
  adsSpreadMul: 0.3,
  adsInS: 0.25,
  adsZoom: 1.3,
  recoilKickDeg: 0.35,
  recoilMaxDeg: 3.5,
  recoilPatternDeg: 0.12,
  recoilYawNoiseDeg: 0.08,
  recoilRecoverDelayS: 0.15,
  recoilRecoverDegPerS: 12,
  killForce: 6,
  grip: FIGURE_GRIP.rifle,
};

/** Pistola (`weapon:pistol`, "Pop Gun"): 25, 1,5x, semi até 400/min, pente de 12, 1,3 s, 100% até 25 m. */
export const WEAPON_PISTOL: WeaponDef = {
  ...BASE,
  id: 'pistol',
  code: WEAPON_CODE.pistol,
  slot: WEAPON_SLOT.secondary,
  category: 'pistol',
  fire: WEAPON_FIRE.bullet,
  damage: 25,
  headMultiplier: HEADSHOT_MULTIPLIER.default,
  rpm: 400,
  automatic: false,
  clipSize: 12,
  reserve: 36,
  reloadS: 1.3,
  falloffStartM: 25,
  falloffEndM: 40,
  minDamage: 15,
  rangeM: 150,
  hipSpreadDeg: 1.3,
  adsSpreadMul: 0.3,
  adsInS: 0.2,
  adsZoom: 1.15,
  recoilKickDeg: 0.8,
  recoilMaxDeg: 3,
  recoilPatternDeg: 0.1,
  recoilYawNoiseDeg: 0.15,
  recoilRecoverDelayS: 0.1,
  recoilRecoverDegPerS: 16,
  killForce: 4,
  grip: FIGURE_GRIP.pistol,
};

/** SMG (`weapon:smg`, "Buzzer"): 20, 1,5x, 850/min, pente de 30, 1,8 s, 100% até 12 m e 12 de dano aos 25 m. */
export const WEAPON_SMG: WeaponDef = {
  ...BASE,
  id: 'smg',
  code: WEAPON_CODE.smg,
  slot: WEAPON_SLOT.primary,
  category: 'smg',
  fire: WEAPON_FIRE.bullet,
  damage: 20,
  headMultiplier: HEADSHOT_MULTIPLIER.default,
  rpm: 850,
  automatic: true,
  clipSize: 30,
  reserve: 90,
  reloadS: 1.8,
  falloffStartM: 12,
  falloffEndM: 25,
  minDamage: 12,
  rangeM: 120,
  hipSpreadDeg: 2.2,
  adsSpreadMul: 0.4,
  adsInS: 0.2,
  adsZoom: 1.2,
  recoilKickDeg: 0.22,
  recoilMaxDeg: 3,
  recoilPatternDeg: 0.18,
  recoilYawNoiseDeg: 0.12,
  recoilRecoverDelayS: 0.12,
  recoilRecoverDegPerS: 14,
  killForce: 5,
  grip: FIGURE_GRIP.rifle,
};

/**
 * Escopeta pump (`weapon:shotgun`, "Door Knocker"): 8 chumbos × 14, 1,25x, 70/min, pente de 6, 0,5 s por cartucho,
 * 100% até 8 m e 0 aos 20 m ("mata de perto, inútil longe").
 */
export const WEAPON_SHOTGUN: WeaponDef = {
  ...BASE,
  id: 'shotgun',
  code: WEAPON_CODE.shotgun,
  slot: WEAPON_SLOT.primary,
  category: 'shotgun',
  fire: WEAPON_FIRE.pellets,
  damage: 14,
  headMultiplier: HEADSHOT_MULTIPLIER.shotgun,
  rpm: 70,
  automatic: false,
  clipSize: 6,
  reserve: 18,
  reloadS: 0.5,
  reloadPerRoundS: 0.5,
  falloffStartM: 8,
  falloffEndM: 20,
  minDamage: 0,
  rangeM: 40,
  pellets: 8,
  pelletSpreadDeg: 3.5,
  hipSpreadDeg: 0.8,
  adsSpreadMul: 0.5,
  adsInS: 0.25,
  adsZoom: 1.15,
  recoilKickDeg: 3,
  recoilMaxDeg: 6,
  recoilPatternDeg: 0,
  recoilYawNoiseDeg: 0.4,
  recoilRecoverDelayS: 0.2,
  recoilRecoverDegPerS: 10,
  killForce: 9,
  grip: FIGURE_GRIP.rifle,
};

/**
 * Sniper de ferrolho (`weapon:sniper`, "Peekaboo"): 95 sem queda, 2,0x, 45/min, pente de 5, 3,0 s, zoom 4x; sem
 * zoom a dispersão é enorme (6°), com o ADS completo quase zera.
 */
export const WEAPON_SNIPER: WeaponDef = {
  ...BASE,
  id: 'sniper',
  code: WEAPON_CODE.sniper,
  slot: WEAPON_SLOT.primary,
  category: 'sniper',
  fire: WEAPON_FIRE.bullet,
  damage: 95,
  headMultiplier: HEADSHOT_MULTIPLIER.sniper,
  rpm: 45,
  automatic: false,
  clipSize: 5,
  reserve: 15,
  reloadS: 3,
  falloffStartM: NO_FALLOFF,
  falloffEndM: NO_FALLOFF,
  minDamage: 95,
  rangeM: 250,
  hipSpreadDeg: 6,
  adsSpreadMul: 0.01,
  adsInS: 0.35,
  adsZoom: 4,
  recoilKickDeg: 2.5,
  recoilMaxDeg: 6,
  recoilPatternDeg: 0,
  recoilYawNoiseDeg: 0.3,
  recoilRecoverDelayS: 0.25,
  recoilRecoverDegPerS: 8,
  killForce: 10,
  grip: FIGURE_GRIP.sniper,
};

/**
 * Lança-foguetes (`weapon:rocket`, "Kaboomer"): 120 no acerto direto, área de 100 → 0 em 4 m, 1 no pente + 3,
 * recarga de 2,8 s, projétil reto a 35 m/s, autodano de 50%.
 */
export const WEAPON_ROCKET: WeaponDef = {
  ...BASE,
  id: 'rocket',
  code: WEAPON_CODE.rocket,
  slot: WEAPON_SLOT.primary,
  category: 'explosive',
  fire: WEAPON_FIRE.projectile,
  damage: 120,
  headMultiplier: 1,
  rpm: 60,
  automatic: false,
  clipSize: 1,
  reserve: 3,
  reloadS: 2.8,
  falloffStartM: NO_FALLOFF,
  falloffEndM: NO_FALLOFF,
  minDamage: 120,
  rangeM: 200,
  hipSpreadDeg: 0.5,
  adsSpreadMul: 0.3,
  adsInS: 0.3,
  adsZoom: 1.3,
  recoilKickDeg: 2,
  recoilMaxDeg: 4,
  recoilPatternDeg: 0,
  recoilYawNoiseDeg: 0.2,
  recoilRecoverDelayS: 0.2,
  recoilRecoverDegPerS: 10,
  killForce: 12,
  grip: FIGURE_GRIP.rifle,
  projectileSpeed: 35,
  blastDamage: 100,
  blastRadiusM: 4,
  selfDamageMul: 0.5,
};

/** Faca (`weapon:knife`, "Butter Knife"): 55 de frente e 100 pelas costas, um golpe a cada 0,5 s, alcance de 2 m. */
export const WEAPON_KNIFE: WeaponDef = {
  ...BASE,
  id: 'knife',
  code: WEAPON_CODE.knife,
  slot: WEAPON_SLOT.melee,
  category: 'melee',
  fire: WEAPON_FIRE.melee,
  damage: 55,
  headMultiplier: 1,
  rpm: 120,
  automatic: true,
  clipSize: 0,
  reserve: 0,
  reloadS: 0,
  falloffStartM: NO_FALLOFF,
  falloffEndM: NO_FALLOFF,
  minDamage: 55,
  rangeM: 2,
  hipSpreadDeg: 0,
  adsSpreadMul: 1,
  adsInS: 0.2,
  adsZoom: 1,
  recoilKickDeg: 0,
  recoilMaxDeg: 0,
  recoilPatternDeg: 0,
  recoilYawNoiseDeg: 0,
  recoilRecoverDelayS: 0,
  recoilRecoverDegPerS: 0,
  killForce: 5,
  grip: FIGURE_GRIP.pistol,
  meleeRangeM: 2,
  backstabDamage: 100,
};

/**
 * Granada (`weapon:grenade`, "Pineapple"): 2 por vida, 110 no centro → 0 em 5 m, pavio de 2,5 s, dá para cozinhar,
 * quica. Arremesso a 16 m/s com gravidade de 15 m/s² (alcance de ~17 m a 45°).
 */
/**
 * M2: arremesso da granada: o ângulo sai da mira mais `lift` (rad, para cima) e o corpo empresta `inherit` da velocidade
 * dele. A IA usa o mesmo para mirar o arco (fase 3d).
 */
export const GRENADE_THROW = { lift: 0.15, inherit: 0.5 } as const;

export const WEAPON_GRENADE: WeaponDef = {
  ...BASE,
  id: 'grenade',
  code: WEAPON_CODE.grenade,
  slot: WEAPON_SLOT.throwable,
  category: 'throwable',
  fire: WEAPON_FIRE.thrown,
  damage: 0,
  headMultiplier: 1,
  rpm: 60,
  automatic: false,
  clipSize: 2,
  reserve: 0,
  reloadS: 0,
  falloffStartM: NO_FALLOFF,
  falloffEndM: NO_FALLOFF,
  minDamage: 0,
  rangeM: 0,
  hipSpreadDeg: 0,
  adsSpreadMul: 1,
  adsInS: 0.2,
  adsZoom: 1,
  recoilKickDeg: 0,
  recoilMaxDeg: 0,
  recoilPatternDeg: 0,
  recoilYawNoiseDeg: 0,
  recoilRecoverDelayS: 0,
  recoilRecoverDegPerS: 0,
  killForce: 10,
  grip: FIGURE_GRIP.pistol,
  projectileSpeed: 16,
  projectileGravity: 15,
  fuseS: 2.5,
  blastDamage: 110,
  blastRadiusM: 5,
  selfDamageMul: 0.5,
};

/** LMG de reserva (`weapon:lmg`, "Lawnmower"): 22, 1,5x, 700/min, pente de 100, 4,5 s, 100% até 30 m e 15 aos 55 m. */
export const WEAPON_LMG: WeaponDef = {
  ...BASE,
  id: 'lmg',
  code: WEAPON_CODE.lmg,
  slot: WEAPON_SLOT.primary,
  category: 'lmg',
  fire: WEAPON_FIRE.bullet,
  damage: 22,
  headMultiplier: HEADSHOT_MULTIPLIER.default,
  rpm: 700,
  automatic: true,
  clipSize: 100,
  reserve: 300,
  reloadS: 4.5,
  falloffStartM: 30,
  falloffEndM: 55,
  minDamage: 15,
  rangeM: 200,
  hipSpreadDeg: 2.4,
  adsSpreadMul: 0.35,
  adsInS: 0.35,
  adsZoom: 1.25,
  recoilKickDeg: 0.3,
  recoilMaxDeg: 4,
  recoilPatternDeg: 0.15,
  recoilYawNoiseDeg: 0.15,
  recoilRecoverDelayS: 0.15,
  recoilRecoverDegPerS: 10,
  killForce: 7,
  grip: FIGURE_GRIP.rifle,
};

/** Todas as armas, no índice do código (`WEAPONS[c].code === c`). */
export const WEAPONS: readonly WeaponDef[] = [
  WEAPON_RIFLE,
  WEAPON_PISTOL,
  WEAPON_SMG,
  WEAPON_SHOTGUN,
  WEAPON_SNIPER,
  WEAPON_ROCKET,
  WEAPON_KNIFE,
  WEAPON_GRENADE,
  WEAPON_LMG,
];

/** Arma do código, ou `null` (sem arma: `WEAPON_NONE`, código desconhecido). */
export function weaponDef(code: number): WeaponDef | null {
  if (code < WEAPONS.length) return WEAPONS[code]!;
  return code === WEAPON_GOO ? ZOMBIE_GOO : code === WEAPON_SPIT ? ZOMBIE_SPIT : null;
}

/**
 * M3 (fase 3b): as "armas" dos zumbis especiais, fora de `WEAPONS` (não são do jogador: sem nome, modelo nem loadout).
 * A gosma do Chonker é só a explosão ao morrer; o cuspe do Spitter é um projétil lento que estoura pequeno no acerto.
 */
export const WEAPON_GOO = 9;
export const WEAPON_SPIT = 10;

export const ZOMBIE_GOO: WeaponDef = {
  ...WEAPON_ROCKET,
  id: 'goo',
  code: WEAPON_GOO,
  damage: 0,
  blastDamage: 40,
  blastRadiusM: 3,
  selfDamageMul: 0,
  killForce: 4,
};

export const ZOMBIE_SPIT: WeaponDef = {
  ...WEAPON_ROCKET,
  id: 'spit',
  code: WEAPON_SPIT,
  damage: 20,
  minDamage: 20,
  rangeM: 30,
  projectileSpeed: 12,
  blastDamage: 6,
  blastRadiusM: 0.8,
  selfDamageMul: 0,
  killForce: 3,
};

/** Primária padrão (sem escolha no `InputFrame.primary` nem em `SimConfig.primaries`). */
export const DEFAULT_PRIMARY: WeaponCode = WEAPON_CODE.rifle;

/** O código serve de primária (slot 0)? */
export function isPrimaryWeapon(code: number): boolean {
  const def = weaponDef(code);
  return def !== null && def.slot === WEAPON_SLOT.primary;
}

/** O resto do loadout do Bobo Warfare (gameplay.md §4.1): pistola, faca e granada, nos slots 1–3. */
export const DEFAULT_LOADOUT_REST: readonly WeaponCode[] = [WEAPON_CODE.pistol, WEAPON_CODE.knife, WEAPON_CODE.grenade];

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

/** Dano da arma a `distanceM` (sem multiplicador de parte; por chumbo na escopeta). */
export function weaponDamageAt(def: WeaponDef, distanceM: number): number {
  if (distanceM <= def.falloffStartM) return def.damage;
  if (distanceM >= def.falloffEndM) return def.minDamage;
  const t = (distanceM - def.falloffStartM) / (def.falloffEndM - def.falloffStartM);
  return def.damage + (def.minDamage - def.damage) * t;
}
