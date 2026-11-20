import { WEAPON_SLOT_COUNT } from '@boboforces/input';
import {
  BOMB,
  isPrimaryWeapon,
  MAX_HUMANS,
  ROUND,
  ROUND_PHASE,
  STRIKE,
  STRIKE_BUY_BASE,
  STRIKE_DATA,
  STRIKE_SHOP,
  WEAPON_CODE,
  WEAPON_SLOT,
  type SimView,
} from '@boboforces/sim';
import type { AiContext } from './context.ts';

/**
 * M7 (fase 3): a IA do BoboStrike (gameplay.md: atacantes escolhem o site, plantam e defendem a Boom Box; defensores se
 * dividem, rotacionam e retomam; todos economizam quando o dinheiro não dá). Aqui ficam as decisões do modo; o
 * `soldier.ts` só pergunta o objetivo (o ponto e a ação), o passeio e a compra.
 */
export const STRIKE_ACT = { none: 0, plant: 1, defuse: 2, pickup: 3 } as const;

const shop = (id: string): number => STRIKE_SHOP.findIndex((s) => s.id === id);
const BUY_RIFLE = STRIKE_BUY_BASE + shop('rifle');
const BUY_SMG = STRIKE_BUY_BASE + shop('smg');
const BUY_ARMOR50 = STRIKE_BUY_BASE + shop('armor50');
const BUY_ARMOR100 = STRIKE_BUY_BASE + shop('armor100');
const BUY_KIT = STRIKE_BUY_BASE + shop('kit');
const BUY_GRENADE = STRIKE_BUY_BASE + shop('grenade');
const PRICE_RIFLE = STRIKE_SHOP[shop('rifle')]!.price;
const PRICE_SMG = STRIKE_SHOP[shop('smg')]!.price;
const PRICE_ARMOR50 = STRIKE_SHOP[shop('armor50')]!.price;
const PRICE_ARMOR100 = STRIKE_SHOP[shop('armor100')]!.price;
const PRICE_KIT = STRIKE_SHOP[shop('kit')]!.price;
const PRICE_GRENADE = STRIKE_SHOP[shop('grenade')]!.price;
/** A SMG só com folga para o colete e a granada depois (abaixo disso, a rodada é de economia: escolha minha). */
const FORCE_BUY = PRICE_SMG + PRICE_ARMOR50 + PRICE_GRENADE + 450;

/** O time que ataca agora (o 0 no 1º tempo). */
export function attackTeam(view: SimView): number {
  return view.rounds !== null && view.rounds.data[ROUND.swapped] === 1 ? 1 : 0;
}

/** Saída de `strikeObjective` (rascunho do módulo): a ação, o ponto e a distância que basta. */
export const strikeGoal = { act: 0, x: 0, y: 0, z: 0, reach: 0 };

/**
 * O objetivo do bobo `e` agora, em `strikeGoal` (`false` = nenhum: passeia). O portador vai ao site da rodada e planta;
 * com a bomba no chão, o atacante mais perto vai pegar; com ela plantada, o defensor mais perto vai desarmar.
 */
export function strikeObjective(c: AiContext, e: number, keep: number): boolean {
  const view = c.view!;
  const sv = view.strike;
  const rv = view.rounds;
  if (sv === null || rv === null || rv.data[ROUND.phase] !== ROUND_PHASE.live) return false;
  const d = sv.data;
  const atk = attackTeam(view);
  const team = view.team[e]!;
  const bomb = d[STRIKE_DATA.bomb];
  const g = strikeGoal;
  if (team === atk) {
    if (bomb === BOMB.carried && d[STRIKE_DATA.carrier]! >>> 0 === view.generation[e]! * 65536 + e) {
      const site = sv.sites[c.strikeSite];
      if (site === undefined) return false;
      g.act = STRIKE_ACT.plant;
      g.x = site.x;
      g.y = site.y;
      g.z = site.z;
      g.reach = site.radius * 0.5;
      return true;
    }
    if (bomb === BOMB.dropped && nearestTo(c, atk, sv.pos[0]!, sv.pos[2]!, keep === STRIKE_ACT.pickup ? e : -1) === e) {
      g.act = STRIKE_ACT.pickup;
      g.x = sv.pos[0]!;
      g.y = sv.pos[1]!;
      g.z = sv.pos[2]!;
      g.reach = 0;
      return true;
    }
    return false;
  }
  // Quem já está desarmando continua (a sim zera o progresso se ele soltar o usar).
  const defusing = d[STRIKE_DATA.defuser]! >>> 0 === view.generation[e]! * 65536 + e;
  if (
    bomb === BOMB.planted &&
    (defusing || nearestTo(c, team, sv.pos[0]!, sv.pos[2]!, keep === STRIKE_ACT.defuse ? e : -1) === e)
  ) {
    g.act = STRIKE_ACT.defuse;
    g.x = sv.pos[0]!;
    g.y = sv.pos[1]!;
    g.z = sv.pos[2]!;
    g.reach = STRIKE.defuseReachM * 0.6;
    return true;
  }
  return false;
}

/** Folga (m) para `keep` continuar com o objetivo (dois bots quase à mesma distância não ficam trocando). */
const KEEP_SLACK_M = 1.5;

/**
 * O bot vivo do time `team` mais perto de (x, z), ou -1. Humanos não contam (eles fazem o que quiserem; a sim mantém
 * quem já está desarmando). `keep` (quem já tinha o objetivo) leva uma folga.
 */
function nearestTo(c: AiContext, team: number, x: number, z: number, keep: number): number {
  const view = c.view!;
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < view.count; i++) {
    if (!c.living(i) || view.team[i] !== team) continue;
    const ctrl = view.controller[i]!;
    if (ctrl >= 0 && ctrl < MAX_HUMANS) continue;
    const dx = view.position[i * 3]! - x;
    const dz = view.position[i * 3 + 2]! - z;
    const raw = Math.sqrt(dx * dx + dz * dz);
    const d = i === keep ? Math.max(0, raw - KEEP_SLACK_M) : raw;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * O ponto de passeio do BoboStrike em `out` (x, y, z e o raio para espalhar): com a bomba no chão ou plantada, todo
 * mundo vai a ela; senão os atacantes vão ao site da rodada e os defensores se dividem pelos sites (pelo controlador).
 * `false` = sem rodada valendo.
 */
export function strikeWander(c: AiContext, e: number, controller: number, out: Float64Array): boolean {
  const view = c.view!;
  const sv = view.strike;
  if (sv === null || view.rounds === null || sv.sites.length === 0) return false;
  const atk = attackTeam(view);
  const bomb = sv.data[STRIKE_DATA.bomb];
  // A bomba largada só o ataque vê (o marcador é dele); a plantada, todo mundo.
  if (bomb === BOMB.planted || (bomb === BOMB.dropped && view.team[e] === atk)) {
    out[0] = sv.pos[0]!;
    out[1] = sv.pos[1]!;
    out[2] = sv.pos[2]!;
    out[3] = 5;
    return true;
  }
  const mine = view.team[e] === atk;
  const site = sv.sites[mine ? c.strikeSite : controller % sv.sites.length]!;
  out[0] = site.x;
  out[1] = site.y;
  out[2] = site.z;
  out[3] = mine ? site.radius : site.radius + 3;
  return true;
}

/** Na largada de cada rodada, o time de ataque escolhe o site (o mesmo para todos). */
export function strikeRoundTick(c: AiContext): void {
  const view = c.view!;
  if (view.rounds === null || view.strike === null || c.strikeRng === null) return;
  const round = view.rounds.data[ROUND.round]!;
  if (round === c.strikeRound) return;
  c.strikeRound = round;
  c.strikeSite = view.strike.sites.length > 0 ? c.strikeRng.int(0, view.strike.sites.length) : 0;
}

/**
 * A compra do bot nesta tick (o `primary` do quadro; 0 = nada): o primeiro item da lista que falta e o dinheiro dá —
 * o fuzil (sobrando o colete de 50), senão a SMG; o colete de 100 (com o fuzil) ou o de 50; o kit (defensor); a
 * granada. Com pouco dinheiro, sobra só o que cabe (a economia). Uma compra por tick: a seguinte vê o que já comprou.
 */
export function strikeBuy(c: AiContext, e: number): number {
  const view = c.view!;
  if (view.rounds === null || view.rounds.data[ROUND.phase] !== ROUND_PHASE.buy) return 0;
  const money = view.points[e]!;
  const k = e * WEAPON_SLOT_COUNT;
  const primary = view.loadout[k + WEAPON_SLOT.primary];
  const rifle = primary === WEAPON_CODE.rifle || primary === WEAPON_CODE.sniper;
  // Qualquer primária de fogo conta como arma (M10: as novas também; o foguete não, como antes). As novas o bot não
  // compra (a lista de compra dele é a de sempre); ganha pela regra das armas permitidas.
  const anyGun = rifle || (primary !== undefined && primary !== WEAPON_CODE.rocket && isPrimaryWeapon(primary));
  if (!rifle && money >= PRICE_RIFLE + PRICE_ARMOR50) return BUY_RIFLE;
  if (!anyGun && money >= FORCE_BUY) return BUY_SMG;
  const k3 = k + WEAPON_SLOT.throwable;
  const nadeOk = view.loadout[k3] === WEAPON_CODE.grenade && view.slotClip[k3]! > 0;
  // Economia: sem arma e sem dinheiro para comprar direito, guarda (só a granada, que é barata).
  if (!anyGun) return !nadeOk && money >= PRICE_GRENADE ? BUY_GRENADE : 0;
  const armor = view.armor[e]!;
  if (armor < 100 && rifle && money >= PRICE_ARMOR100) return BUY_ARMOR100;
  if (armor < 50 && money >= PRICE_ARMOR50) return BUY_ARMOR50;
  if (view.team[e] !== attackTeam(view) && view.kit[e] === 0 && money >= PRICE_KIT) return BUY_KIT;
  if (!nadeOk && money >= PRICE_GRENADE) return BUY_GRENADE;
  return 0;
}
