// M12 (fase 4): as contas pequenas do refino do som (ARCHITECTURE §23.4), puras e testáveis: a variação de cada tiro e
// de cada impacto, o coração que acelera, o lado do dano, o tom das sequências (plic e abate), o tique do pente, o tom
// do foley por classe de arma e a distância da bala à cabeça (o zunido). Variação só por hash (tick, entidade, célula),
// nunca `Math.random`: os testes repetem e a mesma partida soa igual.
import { stereoPan } from '@boboforces/audio';
import { WEAPON_BIG_BRRT, WEAPON_CODE, weaponBase, weaponDef } from '@boboforces/sim';

/** Os números do refino (revisáveis). */
export const SOUND_FEEL = {
  /** Cada tiro: tom 0,96–1,04 e volume de −1 a 0 dB. */
  shotPitchSpread: 0.04,
  shotGainMinDb: -1,
  /** Cada impacto: tom ±8%. */
  impactPitchSpread: 0.08,
  /** O tiro da LMG: o do fuzil, mais grave. */
  lmgPitch: 0.92,
  /** Vida baixa (a HUD usa o mesmo): `hp ≤ 0,3·maxHp`; o coração vai de 1 s ali a 0,55 s com 10% ou menos. */
  lowHealthFrac: 0.3,
  heartSlowS: 1,
  heartFastS: 0.55,
  heartFastFrac: 0.1,
  heartQuietGain: 0.6,
  /** O lado do dano: o pan da direção de onde veio, nesta fração (só com 1 jogador local). */
  hurtPanWidth: 0.7,
  /** O plic sobe 3% a cada acerto seguido (até 0,3 s um do outro), até +15%. */
  hitStreakS: 0.3,
  hitStreakStep: 0.03,
  hitStreakMax: 0.15,
  /** O abate sobe de tom a cada abate seguido em 4 s: 1; 1,06; 1,12; 1,19. */
  killStreakS: 4,
  /** O tique do pente: nas 3 últimas balas (ou no último quarto do pente pequeno), o tom subindo 12% por bala. */
  lowMagShots: 3,
  lowMagFrac: 0.25,
  lowMagPitchStep: 0.12,
  /** O zunido: a bala passa a menos disto da cabeça, de 3 m do cano até 1 m antes do fim do raio (o acerto não zune). */
  whizRadiusM: 1.5,
  whizMinM: 3,
  whizEndGapM: 1,
} as const;

/**
 * Hash inteiro de 2 números (variação de tom e de intervalo sem `Math.random`, para os testes repetirem). M12 (fase
 * 4): as multiplicações em 32 bits (`Math.imul`): o produto em ponto flutuante perdia os bits baixos com números
 * grandes (o hash da célula, ids de entidade); com os pequenos de antes (tick, índice) dá o mesmo valor.
 */
export const hash2 = (a: number, b: number): number =>
  Math.imul(Math.imul(a, 0x9e3779b1) ^ Math.imul(b, 0x85ebca6b), 0xc2b2ae35) >>> 0;
/** 24 bits do hash em [0, 1]. */
export const unit = (h: number): number => (h >>> 8) / 0xffffff;

/** O tom de um tiro (`tick` e quem atirou): 0,96–1,04. */
export function shotPitch(tick: number, shooter: number): number {
  return 1 - SOUND_FEEL.shotPitchSpread + unit(hash2(tick, shooter)) * 2 * SOUND_FEEL.shotPitchSpread;
}

/** O ganho de um tiro: de −1 a 0 dB, por outros bits do mesmo hash. */
export function shotGain(tick: number, shooter: number): number {
  const u = unit(hash2(tick + 0x51ed, shooter));
  return 10 ** ((SOUND_FEEL.shotGainMinDb * u) / 20);
}

/** O tom de um impacto pela célula (e pelo tick: a mesma parede metralhada não repete o mesmo estalo). */
export function impactPitch(cellX: number, cellY: number, cellZ: number, tick: number): number {
  const h = hash2(hash2(cellX, cellY) ^ cellZ, tick);
  return 1 - SOUND_FEEL.impactPitchSpread + unit(h) * 2 * SOUND_FEEL.impactPitchSpread;
}

/** Vida baixa: com vida e no máximo 30% da máxima. */
export function isLowHealth(hp: number, maxHp: number): boolean {
  return hp > 0 && hp <= SOUND_FEEL.lowHealthFrac * Math.max(1, maxHp);
}

/** Quanto falta para o coração acelerar de vez: 1 em 30% da vida, 0 com 10% ou menos. */
const heartT = (hp: number, maxHp: number): number => {
  const f = hp / Math.max(1, maxHp);
  const t = (f - SOUND_FEEL.heartFastFrac) / (SOUND_FEEL.lowHealthFrac - SOUND_FEEL.heartFastFrac);
  return t < 0 ? 0 : t > 1 ? 1 : t;
};

/** O intervalo entre batidas: 1 s em 30% da vida, 0,55 s com 10% ou menos. */
export function heartInterval(hp: number, maxHp: number): number {
  return SOUND_FEEL.heartFastS + (SOUND_FEEL.heartSlowS - SOUND_FEEL.heartFastS) * heartT(hp, maxHp);
}

/** O volume do coração: 0,6 em 30% da vida, cheio com 10% ou menos. */
export function heartGain(hp: number, maxHp: number): number {
  return 1 - (1 - SOUND_FEEL.heartQuietGain) * heartT(hp, maxHp);
}

/**
 * O pan do dano: de onde a bala veio (o contrário da direção do tiro, `dirX`/`dirZ`), em relação à mira `yaw` do
 * ouvinte, em 70% da largura. Sem direção (queda, zona), no centro.
 */
export function hurtPan(dirX: number, dirZ: number, yaw: number): number {
  if (dirX * dirX + dirZ * dirZ < 1e-6) return 0;
  // Escala o vetor (unitário em 3D) para fora do "perto demais" do `stereoPan`.
  return stereoPan(-dirX * 10, -dirZ * 10, yaw) * SOUND_FEEL.hurtPanWidth;
}

/** O tom do plic no acerto número `streak` da sequência (0 = o primeiro). */
export function hitStreakPitch(streak: number): number {
  return 1 + Math.min(SOUND_FEEL.hitStreakMax, SOUND_FEEL.hitStreakStep * streak);
}

/** O tom do abate número `streak` da sequência (0 = o primeiro): 1; 1,06; 1,12; 1,19 e fica. */
const KILL_PITCH = [1, 1.06, 1.12, 1.19] as const;
export function killStreakPitch(streak: number): number {
  return KILL_PITCH[Math.max(0, Math.min(KILL_PITCH.length - 1, streak))]!;
}

/**
 * O tique do pente depois de um tiro que deixou `clip` balas num pente de `clipSize`: o tom (> 0) nas últimas balas
 * (as 3 últimas, ou o último quarto num pente pequeno), subindo até a última; 0 = sem tique. Armas de 1 ou 2 tiros e
 * sem pente não tiquetaqueiam.
 */
export function lowMagPitch(clip: number, clipSize: number): number {
  if (clipSize <= 2 || clip < 0) return 0;
  const last = Math.max(1, Math.min(SOUND_FEEL.lowMagShots, Math.round(SOUND_FEEL.lowMagFrac * clipSize)));
  if (clip >= last) return 0;
  return 1 + SOUND_FEEL.lowMagPitchStep * (last - 1 - clip);
}

/**
 * O tom do foley (troca, recarga, pente vazio, cartucho, ferrolho) pela classe da arma: a pistola mais aguda (1,15) e
 * as pesadas mais graves (LMG, sniper e escopetas: 0,88).
 */
export function foleyPitch(weapon: number): number {
  const def = weaponDef(weaponBase(weapon));
  if (weapon === WEAPON_BIG_BRRT) return 0.8;
  if (def === null) return 1;
  switch (def.category) {
    case 'pistol':
      return 1.15;
    case 'revolver':
    case 'smg':
      return 1.06;
    case 'lmg':
    case 'sniper':
    case 'shotgun':
    case 'autoShotgun':
      return 0.88;
    case 'dmr':
    case 'launcher':
    case 'crossbow':
      return 0.94;
    default:
      return 1;
  }
}

/** A arma engatilha depois do tiro (o pump da escopeta e o ferrolho da sniper, 0,3 s depois)? */
export function cyclesAfterShot(weapon: number): boolean {
  const base = weaponBase(weapon);
  return base === WEAPON_CODE.shotgun || base === WEAPON_CODE.sniper;
}

/** Rascunho do ponto mais perto do `whizPoint` (regra 11: nada alocado por tiro). */
export const whizOut = { x: 0, y: 0, z: 0 };

/**
 * O zunido: a bala do tiro (de `o` na direção unitária `d`, até `distance`) passa a menos de 1,5 m da cabeça `h`,
 * entre 3 m do cano e 1 m antes do fim do raio? Escreve o ponto mais perto em `whizOut` e devolve a distância dele à
 * cabeça, ou -1.
 */
export function whizPoint(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  distance: number,
  hx: number,
  hy: number,
  hz: number,
): number {
  const t = (hx - ox) * dx + (hy - oy) * dy + (hz - oz) * dz;
  if (t < SOUND_FEEL.whizMinM || t > distance - SOUND_FEEL.whizEndGapM) return -1;
  const px = ox + dx * t;
  const py = oy + dy * t;
  const pz = oz + dz * t;
  const ex = hx - px;
  const ey = hy - py;
  const ez = hz - pz;
  const d = Math.sqrt(ex * ex + ey * ey + ez * ez);
  if (d >= SOUND_FEEL.whizRadiusM) return -1;
  whizOut.x = px;
  whizOut.y = py;
  whizOut.z = pz;
  return d;
}
