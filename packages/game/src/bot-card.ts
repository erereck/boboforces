import {
  BOT_RANGES,
  BUILTIN_BOTS,
  DEFAULT_BOT_RULES,
  LEVEL_ORDER,
  LEVEL_SKILLS,
  type BotDocument,
  type BotLevel,
  type BotRules,
  type BotSkill,
} from '@boboforces/format';
import type { Rng } from '@boboforces/shared';
import { t, type StringKey } from '@boboforces/ui';

/**
 * M2 (fase 5a): como um bot aparece nos menus (Oficina, Laboratório) e nas regras à vista do placar e da tela de morte
 * (gameplay.md §6.5: toda regra ativa no card, no placar e na tela de morte). Puro e sem a sim: fica no pedaço do menu.
 */

/** A categoria de cada arma pelo id do `weapon:` (para o nome na tabela; o teste confere com a tabela da sim). */
export const WEAPON_CATEGORY: Readonly<Record<string, string>> = {
  rifle: 'rifle',
  pistol: 'pistol',
  smg: 'smg',
  shotgun: 'shotgun',
  sniper: 'sniper',
  rocket: 'explosive',
  knife: 'melee',
  grenade: 'throwable',
  lmg: 'lmg',
};

/** As regras ativas de um bot numa linha ("500 de vida · só escopeta"); `''` = nenhuma. */
export function rulesText(r: BotRules): string {
  return ruleTags(r).join(t('rule.separator'));
}

/** As regras ativas, uma por item. */
export function ruleTags(r: BotRules): string[] {
  const tags: string[] = [];
  if (r.hp !== 100) tags.push(t('rule.hp', { n: r.hp }));
  if (r.damageMult !== 1) tags.push(t('rule.damage', { n: r.damageMult }));
  if (r.speed !== 1) tags.push(t('rule.speed', { n: r.speed }));
  if (r.weapons.length > 0) {
    const list = r.weapons.map((id) => {
      const category = WEAPON_CATEGORY[id];
      const name = category !== undefined ? t(`weapon.category.${category}` as StringKey) : id;
      // "só escopeta", mas "só SMG".
      return name === name.toUpperCase() ? name : name.toLowerCase();
    });
    tags.push(t('rule.only', { list: list.join(t('rule.listSeparator')) }));
  }
  if (r.ammo === 'infiniteClip') tags.push(t('rule.infiniteClip'));
  else if (r.ammo === 'infiniteReserve') tags.push(t('rule.infiniteReserve'));
  if (r.headshotImmune) tags.push(t('rule.headshotImmune'));
  if (r.explodeOnDeath) tags.push(t('rule.explodeOnDeath'));
  if (r.visionDeg !== DEFAULT_BOT_RULES.visionDeg) tags.push(t('rule.vision', { n: r.visionDeg }));
  if (r.visionRange !== DEFAULT_BOT_RULES.visionRange) tags.push(t('rule.visionRange', { n: r.visionRange }));
  if (r.hearing !== DEFAULT_BOT_RULES.hearing) tags.push(t('rule.hearing', { n: r.hearing }));
  if (r.knowledge !== 'normal') tags.push(t(`rule.knowledge.${r.knowledge}` as StringKey));
  return tags;
}

/** O card não quebra linha: as regras vão em linhas de até tantos caracteres (cabem no card do 640×360). */
export const CARD_LINE_CHARS = 40;

/** "Regras: 500 de vida · só escopeta", em mais linhas quando não cabe. */
function ruleLines(r: BotRules): string[] {
  const tags = ruleTags(r);
  if (tags.length === 0) return [t('bot.card.noRules')];
  const sep = t('rule.separator');
  const out: string[] = [];
  let line = `${t('bot.card.rulesLabel')} ${tags[0]!}`;
  for (const tag of tags.slice(1)) {
    if (line.length + sep.length + tag.length <= CARD_LINE_CHARS) line += sep + tag;
    else {
      out.push(line + sep.trimEnd());
      line = tag;
    }
  }
  out.push(line);
  return out;
}

/** Bot de fábrica (os 12 da §6.7): o nome vem da tabela; não se apaga nem se edita (duplica-se). */
export function isBuiltinBot(doc: BotDocument): boolean {
  return Object.hasOwn(BUILTIN_BOTS, doc.id) && BUILTIN_BOTS[doc.id] === doc;
}

export function botDisplayName(doc: BotDocument): string {
  return isBuiltinBot(doc) ? t(`bot.name.${doc.id}` as StringKey) : doc.name;
}

function sameSkill(a: BotSkill, b: BotSkill): boolean {
  return (Object.keys(a) as (keyof BotSkill)[]).every((k) => a[k] === b[k]);
}

/** O nível rápido cuja habilidade o bot tem, ou `null` (habilidade ajustada à mão). */
export function botLevelOf(doc: BotDocument): BotLevel | null {
  return LEVEL_ORDER.find((l) => sameSkill(LEVEL_SKILLS[l], doc.skill)) ?? null;
}

/** As linhas do card: habilidade, cabeça (inteligência e personalidade), números de mira e regras. */
export function botCardLines(doc: BotDocument): string[] {
  const level = botLevelOf(doc);
  const s = doc.skill;
  return [
    t('bot.card.skill', { level: level !== null ? t(`level.${level}` as StringKey) : t('bot.card.customSkill') }),
    t('bot.card.mind', {
      n: doc.intelligence.level,
      persona: t(`persona.${doc.personality.preset}` as StringKey),
    }),
    t('bot.card.aim', { reaction: s.reactionMs, error: s.aimErrorDeg, head: Math.round(s.headPref * 100) }),
    ...ruleLines(doc.rules),
  ];
}

/** Um id novo de 6 dígitos hexadecimais, fora dos já usados (os de fábrica têm nome, não colidem). */
export function newBotId(rng: Rng, taken: ReadonlySet<string>): string {
  for (;;) {
    let id = '';
    for (let i = 0; i < 6; i++) id += '0123456789abcdef'[rng.int(0, 16)]!;
    if (!taken.has(id)) return id;
  }
}

/** O nome da cópia: "Jorge the Immortal 2", "… 3"…, cortado no tamanho máximo. */
export function copyName(name: string, taken: ReadonlySet<string>): string {
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`;
    const candidate = name.slice(0, BOT_RANGES.nameMaxLength - suffix.length).trimEnd() + suffix;
    if (!taken.has(candidate)) return candidate;
  }
}
