import { FIGURE_GRIP, type FigureGrip } from '@boboforces/format';
import { HEADSHOT_MULTIPLIER } from './metrics.ts';

/**
 * Armas como dado (gameplay.md §4.3, tecnico.md §7.2). Tudo em unidades por segundo, metros e graus; a sim converte
 * para ticks e radianos. M2 (fase 1): as 8 armas do MVP mais a LMG de reserva (#61: nomes aprovados como estão).
 *
 * Cada arma tem um CÓDIGO numérico estável (`WEAPON_CODE`), que é o índice em `WEAPONS`: é o que vai no estado da sim
 * (`SimView.weapon`, `loadout`), nos eventos (`weapon`) e no render. O fuzil é 0, como o slot 0 do M1. Códigos nunca
 * mudam nem são reaproveitados (regra 20, como os IDs de conteúdo); arma nova entra no fim. M10: as 5 armas novas
 * ficam nos códigos 27 a 31 (`WEAPONS_M10`), depois das armas de modo e das raridades do Royale; o arsenal inteiro do
 * jogador é o `ARSENAL`.
 */

/** Como a arma dispara (`WeaponDef.fire`). */
export const WEAPON_FIRE = {
  /** Hitscan de 1 raio. */
  bullet: 0,
  /** Hitscan de `pellets` raios num cone fixo; o dano soma por alvo (um item de dano por alvo e por tiro). */
  pellets: 1,
  /**
   * Projétil que explode no contato (foguete, reto; fase 1b). Com `projectileGravity`, em arco: a bola de tinta e, M10,
   * a granada do lança-granadas.
   */
  projectile: 2,
  /** Golpe à frente até `meleeRangeM` (faca). */
  melee: 3,
  /** Arremesso com gravidade, quica e explode no pavio (granada; fase 1b). */
  thrown: 4,
  /**
   * M10 (fase 7): virote (besta): projétil com gravidade que acerta o corpo como bala (a parte vale: cabeça, membros) e,
   * no bloco, crava (o evento `projectile` `stick`; o render mostra o virote preso por alguns segundos, sem mexer no
   * mundo). Não explode.
   */
  bolt: 5,
} as const;
export type WeaponFire = (typeof WEAPON_FIRE)[keyof typeof WEAPON_FIRE];

/**
 * Slots do loadout, na ordem do `InputFrame.weapon` (gameplay.md §4.1: primária, pistola, faca e 2 granadas). São
 * `WEAPON_SLOT_COUNT` do input (4); os arrays por slot da sim têm esse passo.
 */
export const WEAPON_SLOT = { primary: 0, secondary: 1, melee: 2, throwable: 3 } as const;

/** Código estável de cada arma (= índice em `WEAPONS` nas do M2; as do M10 em `WEAPONS_M10`). */
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
  // M10 (fases 6 e 7): as armas novas, depois das armas de modo e das raridades do Royale (9 a 26).
  dmr: 27,
  revolver: 28,
  autoShotgun: 29,
  crossbow: 30,
  grenadeLauncher: 31,
} as const;
export type WeaponCode = (typeof WEAPON_CODE)[keyof typeof WEAPON_CODE];

/**
 * Categoria exibida ("Rattler · Fuzil") e usada pela IA para o alcance preferido. M10: uma por arma nova (a categoria
 * é o tipo da arma no HUD e no card do bot: "só escopeta" e "só escopeta automática" não se confundem).
 */
export type WeaponCategory =
  | 'pistol'
  | 'smg'
  | 'rifle'
  | 'shotgun'
  | 'sniper'
  | 'explosive'
  | 'melee'
  | 'throwable'
  | 'lmg'
  | 'dmr'
  | 'revolver'
  | 'autoShotgun'
  | 'crossbow'
  | 'launcher';

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

/**
 * As 9 armas do M2, no índice do código (`WEAPONS[c].code === c`, de 0 a 8). As do M10 têm códigos depois das armas de
 * modo (`WEAPONS_M10`); o arsenal inteiro do jogador (o loadout, os menus, as regras) é o `ARSENAL`. Quem sorteia entre
 * as armas com golden gravado (a troca por abate do Chaos, a Caixa Misteriosa) continua nesta lista.
 */
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

// --- M10 (fases 6 e 7): as 5 armas do arsenal futuro (GDD §4.3.3). Números meus (revisáveis), conferidos pelo robô
// de balanceamento (`npm run balance -- --weapons`): o TTK de cada uma na faixa da classe dela (GDD §4.3).

/**
 * DMR (`weapon:rifle.dmr`, "Pinpoint"): o semiautomático de média e longa (gameplay.md §4.2: "pune quem erra"). 46 no
 * corpo, 2,0x, semi até 300/min, pente de 10, 2,5 s, 100% até 50 m e 34 aos 90 m (3 tiros no corpo a qualquer
 * distância, 0,40 s; 2 na cabeça, 0,20 s), zoom 2,5x. Do quadril abre muito (2,5°); mirado, quase não espalha.
 */
export const WEAPON_DMR: WeaponDef = {
  ...BASE,
  id: 'rifle.dmr',
  code: WEAPON_CODE.dmr,
  slot: WEAPON_SLOT.primary,
  category: 'dmr',
  fire: WEAPON_FIRE.bullet,
  damage: 46,
  headMultiplier: HEADSHOT_MULTIPLIER.sniper,
  rpm: 300,
  automatic: false,
  clipSize: 10,
  reserve: 30,
  reloadS: 2.5,
  falloffStartM: 50,
  falloffEndM: 90,
  minDamage: 34,
  rangeM: 220,
  hipSpreadDeg: 2.5,
  adsSpreadMul: 0.08,
  adsInS: 0.3,
  adsZoom: 2.5,
  recoilKickDeg: 1.4,
  recoilMaxDeg: 4.5,
  recoilPatternDeg: 0.1,
  recoilYawNoiseDeg: 0.2,
  recoilRecoverDelayS: 0.12,
  recoilRecoverDegPerS: 14,
  killForce: 8,
  grip: FIGURE_GRIP.rifle,
};

/**
 * Revólver (`weapon:pistol.revolver`, "Hand Cannon"): a secundária pesada (AK5: escolhida como a pistola, pelas armas
 * permitidas; `loadoutSecondary`). 50 no corpo, 1,5x, semi até 120/min, tambor de 6, 2,4 s, 100% até 22 m e 34 aos
 * 45 m (2 tiros no corpo de perto, 0,50 s; 3 longe). Recuo forte.
 */
export const WEAPON_REVOLVER: WeaponDef = {
  ...BASE,
  id: 'pistol.revolver',
  code: WEAPON_CODE.revolver,
  slot: WEAPON_SLOT.secondary,
  category: 'revolver',
  fire: WEAPON_FIRE.bullet,
  damage: 50,
  headMultiplier: HEADSHOT_MULTIPLIER.default,
  rpm: 120,
  automatic: false,
  clipSize: 6,
  reserve: 18,
  reloadS: 2.4,
  falloffStartM: 22,
  falloffEndM: 45,
  minDamage: 34,
  rangeM: 150,
  hipSpreadDeg: 1.2,
  adsSpreadMul: 0.25,
  adsInS: 0.22,
  adsZoom: 1.25,
  recoilKickDeg: 3.2,
  recoilMaxDeg: 5,
  recoilPatternDeg: 0.2,
  recoilYawNoiseDeg: 0.3,
  recoilRecoverDelayS: 0.12,
  recoilRecoverDegPerS: 16,
  killForce: 8,
  grip: FIGURE_GRIP.pistol,
};

/**
 * Escopeta automática (`weapon:shotgun.auto`, "Leafblower"): 8 chumbos × 9 (menos que a pump), 1,25x, 180/min
 * automática, pente de 8 (de caixa: recarga inteira de 2,6 s), 100% até 6 m e 0 aos 16 m: de perto, 2 tiros (0,33 s).
 */
export const WEAPON_AUTO_SHOTGUN: WeaponDef = {
  ...BASE,
  id: 'shotgun.auto',
  code: WEAPON_CODE.autoShotgun,
  slot: WEAPON_SLOT.primary,
  category: 'autoShotgun',
  fire: WEAPON_FIRE.pellets,
  damage: 9,
  headMultiplier: HEADSHOT_MULTIPLIER.shotgun,
  rpm: 180,
  automatic: true,
  clipSize: 8,
  reserve: 24,
  reloadS: 2.6,
  falloffStartM: 6,
  falloffEndM: 16,
  minDamage: 0,
  rangeM: 35,
  pellets: 8,
  pelletSpreadDeg: 4.5,
  hipSpreadDeg: 1,
  adsSpreadMul: 0.6,
  adsInS: 0.25,
  adsZoom: 1.1,
  recoilKickDeg: 1.8,
  recoilMaxDeg: 6,
  recoilPatternDeg: 0.3,
  recoilYawNoiseDeg: 0.4,
  recoilRecoverDelayS: 0.15,
  recoilRecoverDegPerS: 14,
  killForce: 7,
  grip: FIGURE_GRIP.rifle,
};

/**
 * Besta (`weapon:sniper.crossbow`, "Twang"): o virote (`WEAPON_FIRE.bolt`) sai a 70 m/s com gravidade de 5 m/s² (cai
 * ~0,8 m aos 40 m), 90 no corpo sem queda e 2,0x na cabeça (1 virote na cabeça, 2 no corpo), 1 no pente e 12 de
 * reserva, recarga de 1,5 s (o TTK no corpo é a recarga). No bloco, o virote crava (cosmético). Revisão: do quadril abre
 * 3,5° (não é uma sniper sem luneta); mirada, 0,18°. A regra "Sniper mata no corpo" (`category === 'sniper'`,
 * `partDamage`) não vale para ela: a categoria da besta é a dela.
 */
export const WEAPON_CROSSBOW: WeaponDef = {
  ...BASE,
  id: 'sniper.crossbow',
  code: WEAPON_CODE.crossbow,
  slot: WEAPON_SLOT.primary,
  category: 'crossbow',
  fire: WEAPON_FIRE.bolt,
  damage: 90,
  headMultiplier: HEADSHOT_MULTIPLIER.sniper,
  rpm: 60,
  automatic: false,
  clipSize: 1,
  reserve: 12,
  reloadS: 1.5,
  falloffStartM: NO_FALLOFF,
  falloffEndM: NO_FALLOFF,
  minDamage: 90,
  rangeM: 150,
  hipSpreadDeg: 3.5,
  adsSpreadMul: 0.05,
  adsInS: 0.28,
  adsZoom: 1.8,
  recoilKickDeg: 1.6,
  recoilMaxDeg: 3,
  recoilPatternDeg: 0,
  recoilYawNoiseDeg: 0.2,
  recoilRecoverDelayS: 0.2,
  recoilRecoverDegPerS: 10,
  killForce: 9,
  grip: FIGURE_GRIP.rifle,
  projectileSpeed: 70,
  projectileGravity: 5,
};

/**
 * Lança-granadas (`weapon:rocket.grenade-launcher`, "Bloop"): a granada sai a 30 m/s em arco (gravidade de 12 m/s²) e
 * explode no CONTATO, com corpo ou com bloco (o ramo do foguete, com gravidade; sem quicar, ao contrário da granada de
 * mão): o papel é o fogo indireto por cima da cobertura. 85 no acerto direto e área de 85 → 0 em 3,5 m (2 acertos
 * matam), 90/min, pente de 6 e 12 de reserva, recarga de 3,2 s, autodano de 50%. Sem contato, explode no ar no fim do
 * alcance (60 m, 2 s de voo).
 */
export const WEAPON_GRENADE_LAUNCHER: WeaponDef = {
  ...BASE,
  id: 'rocket.grenade-launcher',
  code: WEAPON_CODE.grenadeLauncher,
  slot: WEAPON_SLOT.primary,
  category: 'launcher',
  fire: WEAPON_FIRE.projectile,
  damage: 85,
  headMultiplier: 1,
  rpm: 90,
  automatic: false,
  clipSize: 6,
  reserve: 12,
  reloadS: 3.2,
  falloffStartM: NO_FALLOFF,
  falloffEndM: NO_FALLOFF,
  minDamage: 85,
  rangeM: 60,
  hipSpreadDeg: 0.8,
  adsSpreadMul: 0.5,
  adsInS: 0.3,
  adsZoom: 1.25,
  recoilKickDeg: 2.4,
  recoilMaxDeg: 5,
  recoilPatternDeg: 0,
  recoilYawNoiseDeg: 0.3,
  recoilRecoverDelayS: 0.2,
  recoilRecoverDegPerS: 10,
  killForce: 11,
  grip: FIGURE_GRIP.rifle,
  projectileSpeed: 30,
  projectileGravity: 12,
  blastDamage: 85,
  blastRadiusM: 3.5,
  selfDamageMul: 0.5,
};

/** M10: o código da primeira arma nova (as de `WEAPONS_M10` vêm em seguida, na ordem do código). */
export const WEAPON_M10_FIRST = 27;

/** M10: as armas novas, no índice `código − WEAPON_M10_FIRST`. */
export const WEAPONS_M10: readonly WeaponDef[] = [
  WEAPON_DMR,
  WEAPON_REVOLVER,
  WEAPON_AUTO_SHOTGUN,
  WEAPON_CROSSBOW,
  WEAPON_GRENADE_LAUNCHER,
];

/**
 * M10: o arsenal do jogador, as armas que entram no loadout, nos menus, nas regras (`weapons.allowed`, as do bot e as
 * do time) e nas escadas: as do M2 e as do M10. A posição aqui é o bit da arma em `EntityRules.weaponMask`
 * (`weaponMaskBit`): as do M2 ficam no bit do próprio código (as máscaras de antes não mudam) e as do M10 nos bits 9 a
 * 13 (a máscara é de 16 bits).
 */
export const ARSENAL: readonly WeaponDef[] = [...WEAPONS, ...WEAPONS_M10];

/** Bit de cada código na máscara de armas (0 = fora do arsenal). Montado uma vez: a sim consulta por tick. */
const MASK_BIT_OF_CODE = new Uint16Array(256);
ARSENAL.forEach((w, i) => {
  MASK_BIT_OF_CODE[w.code] = 1 << i;
});

/** O bit da arma `code` em `EntityRules.weaponMask` (0 no que não é do arsenal: arma de modo, `WEAPON_NONE`). */
export function weaponMaskBit(code: number): number {
  return code >= 0 && code < MASK_BIT_OF_CODE.length ? MASK_BIT_OF_CODE[code]! : 0;
}

/** O código da arma do arsenal com o id de conteúdo `id` (sem prefixo), ou -1. */
export function weaponCodeOf(id: string): number {
  for (let i = 0; i < ARSENAL.length; i++) if (ARSENAL[i]!.id === id) return ARSENAL[i]!.code;
  return -1;
}

/** Arma do código, ou `null` (sem arma: `WEAPON_NONE`, código desconhecido). */
export function weaponDef(code: number): WeaponDef | null {
  if (code < WEAPONS.length) return WEAPONS[code]!;
  if (code >= WEAPON_M10_FIRST && code < WEAPON_M10_FIRST + WEAPONS_M10.length)
    return WEAPONS_M10[code - WEAPON_M10_FIRST]!;
  return code === WEAPON_GOO
    ? ZOMBIE_GOO
    : code === WEAPON_SPIT
      ? ZOMBIE_SPIT
      : code === WEAPON_DESMONTADOR
        ? DESMONTADOR
        : code === WEAPON_BIG_BRRT
          ? BIG_BRRT
          : code === WEAPON_CHAOS_BLAST
            ? CHAOS_BLAST
            : code >= WEAPON_PAINT_MARKER && code <= WEAPON_PAINT_BUCKET
              ? PAINT_WEAPONS[code - WEAPON_PAINT_MARKER]!
              : code === WEAPON_BOOM_BOX
                ? BOOM_BOX
                : code >= WEAPON_ROYALE_FIRST && code < WEAPON_ROYALE_FIRST + ROYALE_WEAPONS.length
                  ? ROYALE_WEAPONS[code - WEAPON_ROYALE_FIRST]!
                  : null;
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
  // M6 (fase 5): só o arsenal: as armas de modo (Desmontador, Big Brrt, tinta) não são escolha do jogador. M10: as do
  // M2 e as novas (`ARSENAL`).
  if (weaponMaskBit(code) === 0) return false;
  const def = weaponDef(code);
  return def !== null && def.slot === WEAPON_SLOT.primary;
}

/** O resto do loadout do Bobo Warfare (gameplay.md §4.1): pistola, faca e granada, nos slots 1–3. */
export const DEFAULT_LOADOUT_REST: readonly WeaponCode[] = [WEAPON_CODE.pistol, WEAPON_CODE.knife, WEAPON_CODE.grenade];

/**
 * M10 (AK5): a secundária do loadout pela máscara das armas permitidas (`EntityRules.weaponMask`): o revólver quando a
 * lista o cita (escolhido como a pistola: no Laboratório, nas armas da partida e nas do time); senão a pistola, que a
 * lista ainda pode tirar. Sem restrição (máscara 0), a pistola, como sempre.
 */
export function loadoutSecondary(mask: number): WeaponCode {
  return (mask & weaponMaskBit(WEAPON_CODE.revolver)) !== 0 ? WEAPON_CODE.revolver : WEAPON_CODE.pistol;
}

/** A 1ª primária que a máscara libera, na ordem do arsenal (`ARSENAL`), ou -1 (a lista só tem armas de outros slots). */
export function firstAllowedPrimary(mask: number): number {
  for (let i = 0; i < ARSENAL.length; i++) {
    const w = ARSENAL[i]!;
    if ((mask & (1 << i)) !== 0 && w.slot === WEAPON_SLOT.primary) return w.code;
  }
  return -1;
}

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

/**
 * M3 (fase 4e): a arma maravilha do Bobo Zombies, o Desmontador (nome provisório, GDD §4.1.5: "raio que desmonta o
 * zumbi em cubinhos"). Fora de `WEAPONS` (só sai da Caixa Misteriosa: não entra nos menus, no loadout nem nos bots do
 * Warfare), como a gosma e o cuspe. Um projétil de energia rápido que estoura em 2,5 m com dano para matar o zumbi até
 * a onda 7 de uma vez, sem machucar quem atira; o corpo já desmonta em cubinhos na morte. Números meus (revisáveis).
 */
export const WEAPON_DESMONTADOR = 11;

export const DESMONTADOR: WeaponDef = {
  ...WEAPON_ROCKET,
  id: 'desmontador',
  code: WEAPON_DESMONTADOR,
  damage: 400,
  minDamage: 400,
  rpm: 120,
  clipSize: 6,
  reserve: 24,
  reloadS: 2.4,
  projectileSpeed: 45,
  blastDamage: 400,
  blastRadiusM: 2.5,
  selfDamageMul: 0,
  killForce: 10,
  recoilKickDeg: 1,
  recoilMaxDeg: 2,
};

/**
 * M6 (fase 3): a minigun do Jugg, a Big Brrt (GDD §5.5: 15 de dano, 1200/min, pente infinito, superaquece depois de 6 s
 * de fogo contínuo). Fora de `WEAPONS`, como o Desmontador: só o Jugg tem (não entra nos menus, no loadout, na escada
 * nem na caixa). O pente é o calor: os 120 tiros são os 6 s de fogo; parada, ela esfria (o pente volta,
 * `BIG_BRRT_COOL`), e no zero superaquece e trava como uma recarga (`reloadS` é o tempo de esfriar). A reserva é
 * infinita pela regra do Jugg. Dispersão e recuo meus (revisáveis).
 */
export const WEAPON_BIG_BRRT = 12;

export const BIG_BRRT: WeaponDef = {
  ...WEAPON_LMG,
  id: 'big-brrt',
  code: WEAPON_BIG_BRRT,
  damage: 15,
  minDamage: 10,
  falloffStartM: 25,
  falloffEndM: 50,
  rpm: 1200,
  clipSize: 120,
  reserve: 120,
  reloadS: 2.5,
  hipSpreadDeg: 3,
  adsSpreadMul: 0.6,
  adsInS: 0.4,
  adsZoom: 1.1,
  recoilKickDeg: 0.12,
  recoilMaxDeg: 2.5,
  recoilPatternDeg: 0.2,
  recoilYawNoiseDeg: 0.2,
  killForce: 8,
};

/** A Big Brrt esfria depois de `delayS` sem atirar: o pente volta `perS` tiros por segundo (cheio em 2 s). */
export const BIG_BRRT_COOL = { delayS: 0.3, perS: 60 } as const;

/**
 * M6 (fase 4): a explosão do modificador "tudo explode" (GDD §4.5.3: 60 de dano em 3 m), de quem morreu. Não é arma de
 * ninguém (fora de `WEAPONS`), como a gosma do Chonker; o abate de quem ela pega vai para quem explodiu.
 */
export const WEAPON_CHAOS_BLAST = 13;

export const CHAOS_BLAST: WeaponDef = {
  ...WEAPON_ROCKET,
  id: 'chaos-blast',
  code: WEAPON_CHAOS_BLAST,
  damage: 0,
  blastDamage: 60,
  blastRadiusM: 3,
  selfDamageMul: 0,
  killForce: 6,
};

/**
 * M6 (fase 5): as armas do Bobo Paintball (GDD §5.5: marcador automático, pump, sniper e balde), fora de `WEAPONS` como
 * a Big Brrt: só o modo as dá (a primária escolhida vira a de tinta dela). A bola de tinta é um projétil de contato com
 * queda (o ramo do foguete, sem área); o balde é uma granada que espirra em 3 m. O dano "100" vira o acerto de tinta: o
 * modo troca pelo que derruba em `hits` acertos. Números meus (revisáveis).
 */
export const WEAPON_PAINT_MARKER = 14;
export const WEAPON_PAINT_PUMP = 15;
export const WEAPON_PAINT_SNIPER = 16;
export const WEAPON_PAINT_BUCKET = 17;

const PAINT_BALL = {
  fire: WEAPON_FIRE.projectile,
  damage: 100,
  minDamage: 100,
  falloffStartM: NO_FALLOFF,
  falloffEndM: NO_FALLOFF,
  fuseS: 0,
  blastDamage: 0,
  blastRadiusM: 0,
  selfDamageMul: 0,
  pellets: 1,
  pelletSpreadDeg: 0,
  killForce: 2,
} as const;

export const PAINT_MARKER: WeaponDef = {
  ...WEAPON_SMG,
  ...PAINT_BALL,
  id: 'paint-marker',
  code: WEAPON_PAINT_MARKER,
  rpm: 600,
  clipSize: 40,
  reserve: 160,
  reloadS: 2,
  rangeM: 70,
  projectileSpeed: 45,
  projectileGravity: 6,
  hipSpreadDeg: 2.2,
};

export const PAINT_PUMP: WeaponDef = {
  ...WEAPON_RIFLE,
  ...PAINT_BALL,
  id: 'paint-pump',
  code: WEAPON_PAINT_PUMP,
  automatic: false,
  rpm: 90,
  clipSize: 8,
  reserve: 40,
  reloadS: 2.4,
  rangeM: 90,
  projectileSpeed: 65,
  projectileGravity: 5,
  hipSpreadDeg: 1.2,
  grip: FIGURE_GRIP.rifle,
};

export const PAINT_SNIPER: WeaponDef = {
  ...WEAPON_SNIPER,
  ...PAINT_BALL,
  id: 'paint-sniper',
  code: WEAPON_PAINT_SNIPER,
  rangeM: 160,
  projectileSpeed: 110,
  projectileGravity: 3,
};

export const PAINT_BUCKET: WeaponDef = {
  ...WEAPON_GRENADE,
  id: 'paint-bucket',
  code: WEAPON_PAINT_BUCKET,
  clipSize: 1,
  reserve: 0,
  blastDamage: 100,
  blastRadiusM: 3,
  selfDamageMul: 0,
  killForce: 3,
};

const PAINT_WEAPONS: readonly WeaponDef[] = [PAINT_MARKER, PAINT_PUMP, PAINT_SNIPER, PAINT_BUCKET];

/** A arma é de tinta (o acerto conta como acerto de tinta no Paintball)? */
export function isPaintWeapon(code: number): boolean {
  return code >= WEAPON_PAINT_MARKER && code <= WEAPON_PAINT_BUCKET;
}

/**
 * A primária de tinta de quem escolheu `primary` (sniper → a de tinta; escopeta → o pump; o resto → o marcador). M10:
 * o DMR e a besta → a sniper de tinta; a escopeta automática → o pump.
 */
export function paintPrimaryFor(primary: number): number {
  return primary === WEAPON_CODE.sniper || primary === WEAPON_CODE.dmr || primary === WEAPON_CODE.crossbow
    ? WEAPON_PAINT_SNIPER
    : primary === WEAPON_CODE.shotgun || primary === WEAPON_CODE.autoShotgun
      ? WEAPON_PAINT_PUMP
      : WEAPON_PAINT_MARKER;
}

/**
 * M7 (fase 2): a explosão da Boom Box do BoboStrike (gameplay.md: a bomba de brinquedo). Sem dono (ninguém leva o abate)
 * e fere todo mundo: 500 no centro, caindo até 0 em 20 m (mata a até 10 m mesmo com colete cheio). Escolha minha
 * (revisável, pergunta Y4).
 */
export const WEAPON_BOOM_BOX = 18;

export const BOOM_BOX: WeaponDef = {
  ...WEAPON_ROCKET,
  id: 'boom-box',
  code: WEAPON_BOOM_BOX,
  damage: 0,
  blastDamage: 500,
  blastRadiusM: 20,
  selfDamageMul: 0,
  killForce: 14,
};

/**
 * M7 (fase 6): as raridades das armas do loot do Bobo Royale (GDD §4.6.4: melhoram o recuo e o pente, sem mais dano).
 * A comum é a arma de sempre (o código base); a rara e a épica são códigos novos (19 a 26), com o pente (e a reserva)
 * maior e o recuo menor. Os multiplicadores são meus (revisáveis).
 */
export const ROYALE_RARITY = [
  { clip: 1, recoil: 1 },
  { clip: 1.25, recoil: 0.8 },
  { clip: 1.5, recoil: 0.6 },
] as const;
/** As armas que têm raridade, na ordem dos códigos novos (a rara e a épica de cada uma). */
export const ROYALE_RARITY_BASES: readonly number[] = [
  WEAPON_CODE.smg,
  WEAPON_CODE.shotgun,
  WEAPON_CODE.rifle,
  WEAPON_CODE.sniper,
];
export const WEAPON_ROYALE_FIRST = 19;

function rarityVariant(base: WeaponDef, rarity: 1 | 2, code: number): WeaponDef {
  const r = ROYALE_RARITY[rarity];
  return {
    ...base,
    id: base.id + (rarity === 1 ? '-rare' : '-epic'),
    code,
    clipSize: Math.round(base.clipSize * r.clip),
    reserve: Math.round(base.reserve * r.clip),
    recoilKickDeg: base.recoilKickDeg * r.recoil,
    recoilMaxDeg: base.recoilMaxDeg * r.recoil,
    recoilPatternDeg: base.recoilPatternDeg * r.recoil,
    recoilYawNoiseDeg: base.recoilYawNoiseDeg * r.recoil,
  };
}

export const ROYALE_WEAPONS: readonly WeaponDef[] = ROYALE_RARITY_BASES.flatMap((b, i) => [
  rarityVariant(WEAPONS[b]!, 1, WEAPON_ROYALE_FIRST + i * 2),
  rarityVariant(WEAPONS[b]!, 2, WEAPON_ROYALE_FIRST + i * 2 + 1),
]);

// M10 (revisão): as raras e épicas do Royale (a partir de 19) não podem invadir os códigos das armas novas (27 a 31):
// uma raridade a mais para uma arma nova precisa de códigos depois delas.
if (WEAPON_ROYALE_FIRST + ROYALE_WEAPONS.length > WEAPON_M10_FIRST) {
  throw new Error('weapons: os códigos das raridades do Royale passaram dos das armas do M10');
}

/** O código da arma `base` na raridade (0 = comum: o próprio `base`, como a arma sem raridade). */
export function royaleWeaponCode(base: number, rarity: number): number {
  const i = ROYALE_RARITY_BASES.indexOf(base);
  if (rarity <= 0 || i < 0) return base;
  return WEAPON_ROYALE_FIRST + i * 2 + (rarity >= 2 ? 1 : 0);
}

/** A raridade de um código (0 comum, 1 rara, 2 épica). */
export function weaponRarity(code: number): number {
  const k = code - WEAPON_ROYALE_FIRST;
  return k >= 0 && k < ROYALE_WEAPONS.length ? 1 + (k % 2) : 0;
}

/** A arma base de um código (a comum da rara e da épica; as outras são elas mesmas). */
export function weaponBase(code: number): number {
  const k = code - WEAPON_ROYALE_FIRST;
  return k >= 0 && k < ROYALE_WEAPONS.length ? ROYALE_RARITY_BASES[k >> 1]! : code;
}
