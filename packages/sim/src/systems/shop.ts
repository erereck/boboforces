import { BUTTON, WEAPON_SLOT_COUNT } from '@boboforces/input';
import { weaponDef } from '../config/weapons.ts';
import { ZOMBIE_SHOP } from '../config/zombie.ts';
import type { SimContext } from '../context.ts';
import { ENTITY_FLAG, ENTITY_KIND } from '../entity.ts';

const F = ENTITY_FLAG;

/**
 * M3 (fase 4a): as armas na parede do Bobo Zombies (passo 8, dentro do diretor de ondas; `ZOMBIE_SHOP`). O bobo de pé
 * na frente da arma aperta o usar (na borda): arma nova vai para o slot da primária, com pente e reserva cheios, e vai
 * para a mão; a que ele já tem (em qualquer slot) recarrega pente e reserva pela fração do preço, se faltar munição.
 * Sem pontos: o evento `purchase` com `denied`. Determinístico: entidades em ordem de índice.
 */
export function wallBuySystem(ctx: SimContext): void {
  const mo = ctx.mapObjects;
  if (mo === null || mo.wallBuys === 0) return;
  const s = ctx.s;
  for (let e = 0; e < s.count; e++) {
    if (s.alive[e] === 0 || s.kind[e] !== ENTITY_KIND.bobo || (s.flags[e]! & (F.dead | F.downed)) !== 0) continue;
    if ((s.inButtons[e]! & BUTTON.use) === 0 || (s.prevButtons[e]! & BUTTON.use) !== 0) continue;
    const e3 = e * 3;
    const x = s.position[e3]!;
    const y = s.position[e3 + 1]!;
    const z = s.position[e3 + 2]!;
    for (let w = 0; w < mo.wallBuys; w++) {
      const dx = x - mo.wbx[w]!;
      const dz = z - mo.wbz[w]!;
      const dn = dx * mo.wbnx[w]! + dz * mo.wbnz[w]!;
      const dt = Math.abs(dx * mo.wbnz[w]! - dz * mo.wbnx[w]!);
      if (dn < -0.25 || dn > ZOMBIE_SHOP.wallReachM || dt > ZOMBIE_SHOP.wallSideM) continue;
      if (Math.abs(y - mo.wby[w]!) > 1) continue;
      buy(ctx, e, w);
      break;
    }
  }
}

function buy(ctx: SimContext, e: number, w: number): void {
  const s = ctx.s;
  const mo = ctx.mapObjects!;
  const code = mo.wbWeapon[w]!;
  const def = weaponDef(code);
  if (def === null) return;
  const id = s.idOf(e);
  const k = e * WEAPON_SLOT_COUNT;
  let owned = -1;
  for (let slot = 0; slot < WEAPON_SLOT_COUNT; slot++) if (s.loadout[k + slot] === code) owned = slot;
  if (owned >= 0) {
    // Já tem: munição (só se falta).
    if (s.slotClip[k + owned]! >= def.clipSize && s.slotReserve[k + owned]! >= def.reserve) return;
    const cost = Math.round(mo.wbCost[w]! * ZOMBIE_SHOP.ammoCostFrac);
    if (s.points[e]! < cost) {
      ctx.events.purchase(ctx.tick, w, 'ammo', 'denied', code, cost, id);
      return;
    }
    s.points[e] = s.points[e]! - cost;
    s.slotClip[k + owned] = def.clipSize;
    s.slotReserve[k + owned] = def.reserve;
    ctx.events.purchase(ctx.tick, w, 'ammo', 'ok', code, cost, id);
    return;
  }
  const cost = mo.wbCost[w]!;
  if (s.points[e]! < cost) {
    ctx.events.purchase(ctx.tick, w, 'weapon', 'denied', code, cost, id);
    return;
  }
  s.points[e] = s.points[e]! - cost;
  s.loadout[k] = code;
  s.slotClip[k] = def.clipSize;
  s.slotReserve[k] = def.reserve;
  // Na mão na hora (sem a troca animada: a compra já é a pausa).
  s.slot[e] = 0;
  s.weapon[e] = code;
  s.reloadTicks[e] = 0;
  s.switchTicks[e] = 0;
  s.fireCooldownS[e] = 0;
  s.cookTicks[e] = -1;
  ctx.events.purchase(ctx.tick, w, 'weapon', 'ok', code, cost, id);
}
