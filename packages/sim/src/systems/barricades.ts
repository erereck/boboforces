import { BUTTON } from '@boboforces/input';
import { ZOMBIE_BARRICADES, ZOMBIE_TYPE } from '../config/zombie.ts';
import type { SimContext } from '../context.ts';
import { ENTITY_FLAG, ENTITY_KIND, NULL_ENTITY } from '../entity.ts';
import { secondsToTicks } from '../constants.ts';

const F = ENTITY_FLAG;
const B = ZOMBIE_BARRICADES;

/**
 * M3 (fase 3d): janelas com barricada e portas pagas (passo 8, dentro do diretor de ondas do Bobo Zombies; ver
 * `map-objects.ts`). Por janela: o zumbi do lado de fora, colado nela, arranca uma tábua a cada `tearS` (o chefão,
 * todas de uma vez); o bobo de pé do lado de dentro segurando o usar repõe uma a cada `repairS` (10 pontos por tábua,
 * até 50 por onda). Por porta fechada: o bobo que aperta o usar perto dela compra, se tem os pontos. Determinístico:
 * entidades em ordem de índice, sem RNG.
 */
export function barricadesSystem(ctx: SimContext): void {
  const mo = ctx.mapObjects;
  if (mo === null) return;
  const s = ctx.s;
  const tearTicks = Math.max(1, secondsToTicks(B.tearS, ctx.hz));
  const repairTicks = Math.max(1, secondsToTicks(B.repairS, ctx.hz));
  for (let i = 0; i < mo.barricades; i++) {
    const bx = mo.bx[i]!;
    const by = mo.by[i]!;
    const bz = mo.bz[i]!;
    const nx = mo.bnx[i]!;
    const nz = mo.bnz[i]!;
    const side = mo.bhw[i]! + B.sideSlackM;
    const before = mo.planks[i]!;
    // --- Zumbis do lado de fora ---
    let tearer = -1;
    let boss = -1;
    for (let e = 0; e < s.count; e++) {
      if (s.alive[e] === 0 || s.kind[e] !== ENTITY_KIND.zombie || (s.flags[e]! & F.dead) !== 0) continue;
      const e3 = e * 3;
      const dx = s.position[e3]! - bx;
      const dz = s.position[e3 + 2]! - bz;
      const dn = dx * nx + dz * nz;
      const dt = Math.abs(dx * nz - dz * nx);
      if (dn <= 0 || dn > B.tearReachM * s.bodyScale[e]! || dt > side) continue;
      if (Math.abs(s.position[e3 + 1]! - by) > 1) continue;
      if (tearer < 0) tearer = e;
      if (s.zombieType[e] === ZOMBIE_TYPE.boss) {
        boss = e;
        break;
      }
    }
    if (mo.planks[i]! > 0 && boss >= 0) {
      mo.planks[i] = 0;
      mo.tearTicks[i] = 0;
      ctx.events.barricade(ctx.tick, i, 'break', 0, s.idOf(boss));
    } else if (mo.planks[i]! > 0 && tearer >= 0) {
      if (mo.tearTicks[i] === 0) mo.tearTicks[i] = tearTicks;
      mo.tearTicks[i]!--;
      if (mo.tearTicks[i] === 0) {
        mo.planks[i]!--;
        ctx.events.barricade(ctx.tick, i, 'tear', mo.planks[i]!, s.idOf(tearer));
      }
    } else {
      mo.tearTicks[i] = 0;
    }
    // --- Bobo de pé do lado de dentro, segurando o usar ---
    let helper = -1;
    let best = Infinity;
    if (mo.planks[i]! < B.planks) {
      for (let e = 0; e < s.count; e++) {
        if (s.alive[e] === 0 || s.kind[e] !== ENTITY_KIND.bobo) continue;
        if ((s.flags[e]! & (F.dead | F.downed)) !== 0 || (s.inButtons[e]! & BUTTON.use) === 0) continue;
        const e3 = e * 3;
        const dx = s.position[e3]! - bx;
        const dz = s.position[e3 + 2]! - bz;
        const dn = dx * nx + dz * nz;
        const dt = Math.abs(dx * nz - dz * nx);
        if (dn >= 0 || dn < -B.repairReachM || dt > side || Math.abs(s.position[e3 + 1]! - by) > 1) continue;
        const d = dn * dn + dt * dt;
        if (d < best) {
          best = d;
          helper = e;
        }
      }
    }
    if (helper >= 0) {
      const id = s.idOf(helper);
      if (mo.repairer[i] !== id) {
        mo.repairer[i] = id;
        mo.repairTicks[i] = 0;
      }
      mo.repairTicks[i]!++;
      if (mo.repairTicks[i]! >= repairTicks) {
        mo.repairTicks[i] = 0;
        mo.planks[i]!++;
        if (ctx.zombiesMode && s.repairPoints[helper]! < B.repairPointsPerWave) {
          s.repairPoints[helper] = s.repairPoints[helper]! + B.repairPoints;
          s.points[helper] = s.points[helper]! + Math.round(B.repairPoints * ctx.zombieRules.economy);
        }
        ctx.events.barricade(ctx.tick, i, 'repair', mo.planks[i]!, id);
      }
    } else {
      mo.repairer[i] = NULL_ENTITY;
      mo.repairTicks[i] = 0;
    }
    if (mo.planks[i] !== before) mo.syncBarricade(i);
  }
  // --- Portas: o usar (na borda) perto da porta fechada compra ---
  for (let d = 0; d < mo.doors; d++) {
    if (mo.doorOpen[d] === 1) continue;
    const o = d * 6;
    const cost = mo.doorCost[d]!;
    for (let e = 0; e < s.count; e++) {
      if (s.alive[e] === 0 || s.kind[e] !== ENTITY_KIND.bobo || (s.flags[e]! & (F.dead | F.downed)) !== 0) continue;
      if ((s.inButtons[e]! & BUTTON.use) === 0 || (s.prevButtons[e]! & BUTTON.use) !== 0) continue;
      const e3 = e * 3;
      const y = s.position[e3 + 1]!;
      if (y < mo.doorBox[o + 1]! - 1 || y > mo.doorBox[o + 4]!) continue;
      if (mo.doorDistance(d, s.position[e3]!, s.position[e3 + 2]!) > B.doorReachM) continue;
      const id = s.idOf(e);
      if (s.points[e]! < cost) {
        ctx.events.door(ctx.tick, d, 'denied', cost, id);
        continue;
      }
      s.points[e] = s.points[e]! - cost;
      mo.doorOpen[d] = 1;
      mo.syncDoor(d);
      ctx.events.door(ctx.tick, d, 'open', cost, id);
      break;
    }
  }
}
