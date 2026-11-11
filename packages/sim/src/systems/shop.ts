import { BUTTON, WEAPON_SLOT_COUNT } from '@boboforces/input';
import { WEAPON_SLOT, WEAPONS, weaponDef } from '../config/weapons.ts';
import { BOX_PHASE, ZOMBIE_BOX, ZOMBIE_PERKS, ZOMBIE_SHOP } from '../config/zombie.ts';
import { maxHpOf } from './life.ts';
import { secondsToTicks } from '../constants.ts';
import type { SimContext } from '../context.ts';
import { ENTITY_FLAG, ENTITY_KIND } from '../entity.ts';
import { BOX } from '../map-objects.ts';

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

/** M3 (fase 4b): o que a caixa pode dar (as primárias; a arma maravilha entra na 4e). */
const BOX_POOL: readonly number[] = WEAPONS.filter((w) => w.slot === WEAPON_SLOT.primary).map((w) => w.code);

/**
 * M3 (fase 4b): a Caixa Misteriosa (`ZOMBIE_BOX`). Parada: o bobo de pé na frente dela aperta o usar (na borda) e paga
 * (sem pontos, `denied`); gira `rollS` e sorteia uma primária que ele não tem, ou, passados os usos até o ursinho (e
 * com mais de uma posição), o ursinho: devolve os pontos e a caixa vai para outra posição. Oferecendo: só quem pagou
 * pega com o usar (na borda), e a arma vai para a primária, cheia; passado `offerS`, fecha (`expire`). O sorteio usa o
 * RNG dos zumbis (no snapshot).
 */
export function mysteryBoxSystem(ctx: SimContext): void {
  const mo = ctx.mapObjects;
  if (mo === null || mo.boxSpots === 0) return;
  const s = ctx.s;
  const st = mo.boxState;
  const i = st[BOX.active]!;
  if (st[BOX.phase] === BOX_PHASE.rolling) {
    st[BOX.ticks]!--;
    if (st[BOX.ticks]! > 0) return;
    const user = mo.boxUser[0]!;
    if (st[BOX.uses]! >= st[BOX.moveAt]! && mo.boxSpots > 1) {
      // O ursinho: devolve os pontos e muda de posição.
      if (s.isCurrent(user)) s.points[user & 0xffff] = s.points[user & 0xffff]! + ZOMBIE_BOX.cost;
      let next = ctx.rngZombies.int(0, mo.boxSpots - 1);
      if (next >= i) next++;
      st[BOX.active] = next;
      st[BOX.phase] = BOX_PHASE.idle;
      st[BOX.uses] = 0;
      st[BOX.moveAt] = 0;
      ctx.events.box(ctx.tick, next, 'move', 0, user);
      return;
    }
    st[BOX.weapon] = rollWeapon(ctx, user);
    st[BOX.phase] = BOX_PHASE.offering;
    st[BOX.ticks] = Math.max(1, secondsToTicks(ZOMBIE_BOX.offerS, ctx.hz));
    ctx.events.box(ctx.tick, i, 'offer', st[BOX.weapon]!, user);
    return;
  }
  if (st[BOX.phase] === BOX_PHASE.offering) {
    const user = mo.boxUser[0]!;
    if (s.isCurrent(user)) {
      const e = user & 0xffff;
      if (usePressed(s, e) && atBox(mo, i, s, e)) {
        giveWeapon(ctx, e, st[BOX.weapon]!);
        st[BOX.phase] = BOX_PHASE.idle;
        ctx.events.box(ctx.tick, i, 'take', st[BOX.weapon]!, user);
        return;
      }
    }
    st[BOX.ticks]!--;
    if (st[BOX.ticks]! <= 0) {
      st[BOX.phase] = BOX_PHASE.idle;
      ctx.events.box(ctx.tick, i, 'expire', st[BOX.weapon]!, user);
    }
    return;
  }
  for (let e = 0; e < s.count; e++) {
    if (!usePressed(s, e) || !atBox(mo, i, s, e)) continue;
    const id = s.idOf(e);
    if (s.points[e]! < ZOMBIE_BOX.cost) {
      ctx.events.box(ctx.tick, i, 'denied', 0, id);
      continue;
    }
    s.points[e] = s.points[e]! - ZOMBIE_BOX.cost;
    if (st[BOX.moveAt] === 0) st[BOX.moveAt] = ctx.rngZombies.int(ZOMBIE_BOX.moveAfterMin, ZOMBIE_BOX.moveAfterMax + 1);
    st[BOX.uses]!++;
    st[BOX.phase] = BOX_PHASE.rolling;
    st[BOX.ticks] = Math.max(1, secondsToTicks(ZOMBIE_BOX.rollS, ctx.hz));
    mo.boxUser[0] = id;
    ctx.events.box(ctx.tick, i, 'open', 0, id);
    return;
  }
}

/** Bobo de pé que apertou o usar neste tick (na borda). */
function usePressed(s: SimContext['s'], e: number): boolean {
  if (s.alive[e] === 0 || s.kind[e] !== ENTITY_KIND.bobo || (s.flags[e]! & (F.dead | F.downed)) !== 0) return false;
  return (s.inButtons[e]! & BUTTON.use) !== 0 && (s.prevButtons[e]! & BUTTON.use) === 0;
}

/** O bobo `e` está na frente da caixa na posição `i`. */
function atBox(mo: NonNullable<SimContext['mapObjects']>, i: number, s: SimContext['s'], e: number): boolean {
  const e3 = e * 3;
  const dx = s.position[e3]! - mo.boxX[i]!;
  const dz = s.position[e3 + 2]! - mo.boxZ[i]!;
  const dn = dx * mo.boxNx[i]! + dz * mo.boxNz[i]!;
  const dt = Math.abs(dx * mo.boxNz[i]! - dz * mo.boxNx[i]!);
  return (
    dn >= 0 && dn <= ZOMBIE_BOX.reachM && dt <= ZOMBIE_BOX.sideM && Math.abs(s.position[e3 + 1]! - mo.boxY[i]!) <= 1
  );
}

/** Uma primária do sorteio que `user` não tem (se tem todas, qualquer uma). */
function rollWeapon(ctx: SimContext, user: number): number {
  const s = ctx.s;
  const k = (user & 0xffff) * WEAPON_SLOT_COUNT;
  const owns = (code: number): boolean => {
    if (!s.isCurrent(user)) return false;
    for (let slot = 0; slot < WEAPON_SLOT_COUNT; slot++) if (s.loadout[k + slot] === code) return true;
    return false;
  };
  let free = 0;
  for (const code of BOX_POOL) if (!owns(code)) free++;
  let pick = ctx.rngZombies.int(0, free > 0 ? free : BOX_POOL.length);
  for (const code of BOX_POOL) {
    if (free > 0 && owns(code)) continue;
    if (pick-- === 0) return code;
  }
  return BOX_POOL[0]!;
}

/** Arma nova na primária, cheia, direto para a mão (a mesma troca da parede). */
function giveWeapon(ctx: SimContext, e: number, code: number): void {
  const s = ctx.s;
  const def = weaponDef(code);
  if (def === null) return;
  const k = e * WEAPON_SLOT_COUNT;
  s.loadout[k] = code;
  s.slotClip[k] = def.clipSize;
  s.slotReserve[k] = def.reserve;
  s.slot[e] = 0;
  s.weapon[e] = code;
  s.reloadTicks[e] = 0;
  s.switchTicks[e] = 0;
  s.fireCooldownS[e] = 0;
  s.cookTicks[e] = -1;
}

/**
 * M3 (fase 4c): as máquinas de vantagem. O bobo de pé na frente da máquina aperta o usar (na borda): já tem, nada; sem
 * pontos, `purchase` com `denied`; senão ganha a vantagem (a Chonky Cola já soma os 50 de vida a mais).
 */
export function perkSystem(ctx: SimContext): void {
  const mo = ctx.mapObjects;
  if (mo === null || mo.machines === 0) return;
  const s = ctx.s;
  for (let e = 0; e < s.count; e++) {
    if (!usePressed(s, e)) continue;
    const e3 = e * 3;
    for (let q = 0; q < mo.machines; q++) {
      const dx = s.position[e3]! - mo.pmx[q]!;
      const dz = s.position[e3 + 2]! - mo.pmz[q]!;
      const dn = dx * mo.pmnx[q]! + dz * mo.pmnz[q]!;
      const dt = Math.abs(dx * mo.pmnz[q]! - dz * mo.pmnx[q]!);
      if (dn < 0 || dn > ZOMBIE_PERKS.reachM || dt > ZOMBIE_PERKS.sideM) continue;
      if (Math.abs(s.position[e3 + 1]! - mo.pmy[q]!) > 1) continue;
      const bit = mo.pmPerk[q]!;
      if ((s.perks[e]! & bit) !== 0) break;
      const cost = mo.pmCost[q]!;
      const id = s.idOf(e);
      if (s.points[e]! < cost) {
        ctx.events.purchase(ctx.tick, q, 'perk', 'denied', bit, cost, id);
        break;
      }
      s.points[e] = s.points[e]! - cost;
      const before = maxHpOf(ctx, e);
      s.perks[e] = s.perks[e]! | bit;
      s.health[e] = Math.min(maxHpOf(ctx, e), s.health[e]! + (maxHpOf(ctx, e) - before));
      ctx.events.purchase(ctx.tick, q, 'perk', 'ok', bit, cost, id);
      break;
    }
  }
}
