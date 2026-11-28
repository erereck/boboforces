import { botLevelFromRef, LEVEL_ORDER, resolveBot, type BotRef, type MatchRecipe } from '@boboforces/format';
import { hashCombine } from '@boboforces/shared';
import {
  DEFAULT_PRIMARY,
  expandRecipe,
  MAX_CONTROLLERS,
  ownerReserveSlots,
  WEAPON_CODE,
  type WeaponCode,
} from '@boboforces/sim';

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

/**
 * M12 (fase 7a): os pesos do Pela vibe e do De boa (os níveis fáceis de verdade): sem foguete (mirava no pé e o erro
 * do Pela vibe caía dentro da explosão) e só 5% de sniper; os outros quatro na proporção de antes (somam 100).
 */
export const BOT_PRIMARY_WEIGHTS_EASY: readonly { readonly code: WeaponCode; readonly weight: number }[] = [
  { code: WEAPON_CODE.rifle, weight: 37 },
  { code: WEAPON_CODE.smg, weight: 24 },
  { code: WEAPON_CODE.shotgun, weight: 18 },
  { code: WEAPON_CODE.lmg, weight: 16 },
  { code: WEAPON_CODE.sniper, weight: 5 },
];

/** Sal do sorteio da primária (fixo: mudar muda o golden). */
const PRIMARY_SALT = 0x5052494d;

/** Primária do bot do controlador `controller` numa partida de semente `seed` (`easy`: os pesos dos níveis fáceis). */
export function botPrimary(seed: number, controller: number, easy = false): WeaponCode {
  let roll = hashCombine(seed >>> 0, (PRIMARY_SALT ^ controller) >>> 0) % 100;
  for (const w of easy ? BOT_PRIMARY_WEIGHTS_EASY : BOT_PRIMARY_WEIGHTS) {
    if (roll < w.weight) return w.code;
    roll -= w.weight;
  }
  return DEFAULT_PRIMARY;
}

/**
 * M12 (fase 7a): o bot da ref é dos níveis fáceis (Pela vibe ou De boa)? O nível rápido da ref ou, nos especiais e
 * embutidos, o da inteligência (a mesma conta do diretor).
 */
export function easyBotRef(recipe: MatchRecipe, ref: BotRef): boolean {
  const level = botLevelFromRef(ref) ?? LEVEL_ORDER[resolveBot(recipe, ref).intelligence.level] ?? 'normal';
  return level === 'vibe' || level === 'chill';
}

/**
 * Primária de cada controlador da receita (índice = controlador, `MAX_CONTROLLERS` posições) para o
 * `SimConfig.primaries`: bots pelo sorteio, humanos com a padrão (o menu radial da fase 2 escolhe a deles pelo
 * `InputFrame.primary`). M9 (fase 4): com a reserva do dono (`ownerReserve` bots), ela sorteia também. M12 (fase 7a):
 * os níveis fáceis sorteiam pelos pesos deles.
 */
export function botPrimaries(recipe: MatchRecipe, humans: number, ownerReserve = 0): number[] {
  const out: number[] = new Array<number>(MAX_CONTROLLERS).fill(DEFAULT_PRIMARY);
  for (const slot of expandRecipe(recipe, humans)) {
    if (slot.bot === null) continue;
    out[slot.controller] = botPrimary(recipe.seed, slot.controller, easyBotRef(recipe, slot.bot));
  }
  for (const slot of ownerReserveSlots(recipe, humans, ownerReserve)) {
    const easy = slot.bot !== null && easyBotRef(recipe, slot.bot);
    out[slot.controller] = botPrimary(recipe.seed, slot.controller, easy);
  }
  return out;
}
