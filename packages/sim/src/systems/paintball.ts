import { WEAPON_SLOT_COUNT } from '@boboforces/input';
import { PAINT_BUCKET, paintPrimaryFor, WEAPON_CODE, WEAPON_SLOT, weaponDef } from '../config/weapons.ts';
import { WEAPON_NONE, type SimContext } from '../context.ts';
import { ENTITY_KIND } from '../entity.ts';

/**
 * M6 (fase 5): o Bobo Paintball (GDD §4.1.2; `mode: 'paintball'`, `ctx.paintHits` > 0). Os Times com as armas de tinta:
 * - **o loadout:** a primária escolhida vira a de tinta dela (sniper → a sniper de tinta, escopeta → o pump, o resto → o
 *   marcador) e o balde no lugar da granada; sem pistola e sem faca;
 * - **o acerto:** qualquer dano de arma de tinta (a bola direta ou o respingo do balde) vale um acerto, e `hits`
 *   acertos derrubam (o dano vira a vida máxima ÷ `hits`, arredondado para cima: `paintDamage`);
 * - **as regras:** sem regeneração e sem caixinha de munição (a reserva é infinita pela receita).
 */

/** O dano de um acerto de tinta em `t` (a vida máxima dividida pelos acertos que derrubam). */
export function paintDamage(ctx: SimContext, maxHp: number): number {
  return Math.ceil(maxHp / ctx.paintHits);
}

/** O loadout de tinta de `e` ao renascer (depois do de sempre: a primária escolhida já está no slot 0). */
export function paintLoadout(ctx: SimContext, e: number): void {
  const s = ctx.s;
  if (s.kind[e] !== ENTITY_KIND.bobo) return;
  const k = e * WEAPON_SLOT_COUNT;
  // Quem não tem primária (o bot só de faca) continua sem; o balde só para quem pode a granada.
  const chosen = s.loadout[k + WEAPON_SLOT.primary]!;
  const mask = ctx.rules.weaponMask[e]!;
  const bucket = mask === 0 || (mask & (1 << WEAPON_CODE.grenade)) !== 0;
  const primary = chosen === WEAPON_NONE ? null : weaponDef(paintPrimaryFor(chosen))!;
  for (let slot = 0; slot < WEAPON_SLOT_COUNT; slot++) {
    s.loadout[k + slot] = WEAPON_NONE;
    s.slotClip[k + slot] = 0;
    s.slotReserve[k + slot] = 0;
  }
  if (primary !== null) {
    s.loadout[k + WEAPON_SLOT.primary] = primary.code;
    s.slotClip[k + WEAPON_SLOT.primary] = primary.clipSize;
    s.slotReserve[k + WEAPON_SLOT.primary] = primary.reserve;
  }
  if (bucket) {
    s.loadout[k + WEAPON_SLOT.throwable] = PAINT_BUCKET.code;
    s.slotClip[k + WEAPON_SLOT.throwable] = PAINT_BUCKET.clipSize;
  }
  s.slot[e] = primary !== null ? WEAPON_SLOT.primary : WEAPON_SLOT.throwable;
  s.weapon[e] = s.loadout[k + s.slot[e]!]!;
  s.reloadTicks[e] = 0;
  s.cookTicks[e] = -1;
  s.quickNade[e] = 0;
  s.burstShots[e] = 0;
  s.adsAmount[e] = 0;
}
