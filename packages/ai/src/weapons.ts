import type { MatchRecipe } from '@boboforces/format';
import { hashCombine } from '@boboforces/shared';
import { DEFAULT_PRIMARY, expandRecipe, MAX_CONTROLLERS, WEAPON_CODE, type WeaponCode } from '@boboforces/sim';

/**
 * Primária de cada bot (M2, fase 1d; gameplay.md §4.3: "nenhuma arma entra sem o bot saber quando usá-la"). Sorteio
 * determinístico pela semente da receita e pelo controlador, com os pesos abaixo (somam 100). Os bots de fábrica com
 * arma favorita (Jorge com a escopeta, Camper Carl com a sniper) e a primária do Laboratório chegam na fase 3; até lá,
 * todo bot sorteia.
 */
export const BOT_PRIMARY_WEIGHTS: readonly { readonly code: WeaponCode; readonly weight: number }[] = [
  { code: WEAPON_CODE.rifle, weight: 30 },
  { code: WEAPON_CODE.smg, weight: 20 },
  { code: WEAPON_CODE.shotgun, weight: 15 },
  { code: WEAPON_CODE.lmg, weight: 13 },
  { code: WEAPON_CODE.sniper, weight: 12 },
  { code: WEAPON_CODE.rocket, weight: 10 },
];

/** Sal do sorteio da primária (fixo: mudar muda o golden). */
const PRIMARY_SALT = 0x5052494d;

/** Primária do bot do controlador `controller` numa partida de semente `seed`. */
export function botPrimary(seed: number, controller: number): WeaponCode {
  let roll = hashCombine(seed >>> 0, (PRIMARY_SALT ^ controller) >>> 0) % 100;
  for (const w of BOT_PRIMARY_WEIGHTS) {
    if (roll < w.weight) return w.code;
    roll -= w.weight;
  }
  return DEFAULT_PRIMARY;
}

/**
 * Primária de cada controlador da receita (índice = controlador, `MAX_CONTROLLERS` posições) para o
 * `SimConfig.primaries`: bots pelo sorteio, humanos com a padrão (o menu radial da fase 2 escolhe a deles pelo
 * `InputFrame.primary`).
 */
export function botPrimaries(recipe: MatchRecipe, humans: number): number[] {
  const out: number[] = new Array<number>(MAX_CONTROLLERS).fill(DEFAULT_PRIMARY);
  for (const slot of expandRecipe(recipe, humans)) {
    if (slot.bot !== null) out[slot.controller] = botPrimary(recipe.seed, slot.controller);
  }
  return out;
}
