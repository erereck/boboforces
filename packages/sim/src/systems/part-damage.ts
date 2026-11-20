import { FIGURE_PART_CATEGORY, type FigurePart } from '@boboforces/format';
import { PART_DAMAGE_MULTIPLIER } from '../config/metrics.ts';
import { weaponDamageAt, type WeaponDef } from '../config/weapons.ts';
import { HIT_PARTS, PART_HEAD, RULE_FLAG, type SimContext } from '../context.ts';

/** M2 (fase 4e): dano da "sniper mata no corpo" (passa de qualquer vida da faixa da receita). */
export const SNIPER_KILL_DAMAGE = 10_000;

/**
 * Dano de um acerto da arma `def` a `t` m no osso `bone` de `target`: o raio da bala ou o chumbo (`weapons.ts`) e, M10
 * (fase 7), o virote da besta (`projectiles.ts`), que acerta o corpo como bala. A cabeça usa o multiplicador da arma
 * (quem é imune a tiro de cabeça, regra do bot da fase 3b, leva na cabeça o dano do tronco); braços e pernas, o
 * `PART_DAMAGE_MULTIPLIER`. As regras da partida "sniper mata no corpo" e "só cabeça conta" valem aqui.
 */
export function partDamage(ctx: SimContext, def: WeaponDef, t: number, bone: FigurePart, target: number): number {
  const cat = FIGURE_PART_CATEGORY[bone]!;
  // Só a sniper (a besta e o DMR têm categoria própria: a regra não vale para eles).
  if (ctx.mods.sniperBodyKill && def.category === 'sniper') return SNIPER_KILL_DAMAGE;
  if (ctx.mods.headshotOnly && cat !== PART_HEAD) return 0;
  const base = weaponDamageAt(def, t);
  if (cat === PART_HEAD) {
    return base * ((ctx.rules.flags[target]! & RULE_FLAG.headshotImmune) !== 0 ? 1 : def.headMultiplier);
  }
  return base * PART_DAMAGE_MULTIPLIER[HIT_PARTS[cat] as 'torso' | 'arm' | 'leg'];
}
