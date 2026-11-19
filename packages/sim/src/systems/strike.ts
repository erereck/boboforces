import { BUTTON, WEAPON_SLOT_COUNT } from '@boboforces/input';
import { BLOCK_FLAG, createRayHit, raycastGrid } from '@boboforces/world';
import { BOOM_BOX, WEAPON_CODE, WEAPON_SLOT, weaponDef } from '../config/weapons.ts';
import { MAX_ENTITIES } from '../constants.ts';
import { WEAPON_NONE, type SimContext } from '../context.ts';
import { ENTITY_FLAG, ENTITY_KIND, NULL_ENTITY } from '../entity.ts';
import { explode } from './projectiles.ts';
import { ROUND, ROUND_PHASE, ROUND_UNDECIDED } from './rounds.ts';

const F = ENTITY_FLAG;

/**
 * M7 (fase 2): o BoboStrike (`mode: 'strike'`, GDD §4.1.2 e gameplay.md "BoboStrike"): rodadas sem respawn, a Boom Box
 * (a bomba de brinquedo), a compra no começo da rodada e a economia em faixas fixas. Os números vêm do GDD; os marcados
 * "minha" são escolhas minhas (revisáveis).
 */
export const STRIKE = {
  buyS: 15,
  roundS: 105,
  /** A pausa depois da rodada (minha). */
  overS: 5,
  winRounds: 7,
  totalRounds: 12,
  swapAfter: 6,
  /** O dinheiro da largada e da volta do intervalo, e o teto (os do CS: minha). */
  startMoney: 800,
  maxMoney: 16000,
  winMoney: 3000,
  lossMoney: 1900,
  lossStep: 500,
  lossMax: 3400,
  killMoney: 300,
  plantMoney: 300,
  bombS: 40,
  /** Plantar segurando o usar (o GDD não diz: minha, pergunta Y4). */
  plantS: 3,
  defuseS: 7,
  kitDefuseS: 5,
  /** Até onde dá para desarmar (m, da bomba ao corpo) e pegar a bomba largada. */
  defuseReachM: 1.5,
  pickupReachM: 1.2,
  /** O colete absorve isto do dano no tronco e nos membros (a cabeça passa inteira). */
  armorAbsorb: 0.5,
} as const;

/**
 * A loja do BoboStrike, na ordem do radial de compra (o `InputFrame.primary` = `STRIKE_BUY_BASE` + índice). Comprar o
 * que já tem não faz nada (a entrada repetida pela rede não compra duas vezes).
 */
export const STRIKE_SHOP = [
  { id: 'smg', price: 1200 },
  { id: 'shotgun', price: 1200 },
  { id: 'rifle', price: 2700 },
  { id: 'sniper', price: 4500 },
  { id: 'armor50', price: 650 },
  { id: 'armor100', price: 1000 },
  { id: 'grenade', price: 300 },
  { id: 'kit', price: 400 },
] as const;
export type StrikeItemId = (typeof STRIKE_SHOP)[number]['id'];
export const STRIKE_BUY_BASE = 200;

/** O estado da Boom Box (`StrikeState.data`). */
export const BOMB = { carried: 0, dropped: 1, planted: 2, exploded: 3, defused: 4 } as const;
/** Os índices de `StrikeState.data`. */
export const STRIKE_DATA = {
  bomb: 0,
  carrier: 1,
  site: 2,
  bombTicks: 3,
  plantTicks: 4,
  planter: 5,
  defuseTicks: 6,
  defuser: 7,
  streak0: 8,
  streak1: 9,
} as const;
export const STRIKE_FIELDS = 10;

export interface StrikeSite {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly radius: number;
}

export interface StrikeState {
  /** A bomba, quem carrega, o site, os ticks da bomba, de plantar e de desarmar, e as derrotas seguidas dos times. */
  readonly data: Int32Array;
  /** A posição da bomba (largada ou plantada). */
  readonly pos: Float32Array;
  readonly sites: readonly StrikeSite[];
  /** Rascunho do loadout de quem sobreviveu à rodada (a largada da próxima devolve). */
  readonly keepLoadout: Uint8Array;
  readonly keepClip: Int32Array;
  readonly keepReserve: Int32Array;
  readonly keep: Uint8Array;
}

export function createStrikeState(sites: readonly StrikeSite[]): StrikeState {
  const data = new Int32Array(STRIKE_FIELDS);
  data[STRIKE_DATA.carrier] = NULL_ENTITY;
  data[STRIKE_DATA.planter] = NULL_ENTITY;
  data[STRIKE_DATA.defuser] = NULL_ENTITY;
  data[STRIKE_DATA.site] = -1;
  return {
    data,
    pos: new Float32Array(3),
    sites,
    keepLoadout: new Uint8Array(MAX_ENTITIES * WEAPON_SLOT_COUNT),
    keepClip: new Int32Array(MAX_ENTITIES * WEAPON_SLOT_COUNT),
    keepReserve: new Int32Array(MAX_ENTITIES * WEAPON_SLOT_COUNT),
    keep: new Uint8Array(MAX_ENTITIES),
  };
}

/** O time que ataca agora (o 0 no 1º tempo, o 1 depois da troca). */
export function attackers(ctx: SimContext): number {
  return ctx.rounds !== null && ctx.rounds.data[ROUND.swapped] === 1 ? 1 : 0;
}

function living(ctx: SimContext, e: number): boolean {
  const s = ctx.s;
  return s.alive[e] === 1 && s.kind[e] === ENTITY_KIND.bobo && (s.flags[e]! & F.dead) === 0;
}

function addMoney(ctx: SimContext, e: number, amount: number): void {
  const s = ctx.s;
  s.points[e] = Math.max(0, Math.min(STRIKE.maxMoney, s.points[e]! + amount));
}

/**
 * Antes do spawn da rodada: guarda o loadout de quem está vivo (sobreviveu à rodada passada; no intervalo e na 1ª
 * rodada, ninguém guarda) e, na volta do intervalo (`reset`), zera o dinheiro e as derrotas seguidas.
 */
export function strikeRoundReset(ctx: SimContext, reset: boolean): void {
  const st = ctx.strike!;
  const s = ctx.s;
  const first = ctx.rounds!.data[ROUND.round] === 1;
  for (let e = 0; e < s.count; e++) {
    st.keep[e] = 0;
    if (s.alive[e] !== 1 || s.kind[e] !== ENTITY_KIND.bobo) continue;
    if (reset || first) {
      s.points[e] = STRIKE.startMoney;
      s.armor[e] = 0;
      s.kit[e] = 0;
      continue;
    }
    if ((s.flags[e]! & F.dead) !== 0) {
      s.armor[e] = 0;
      s.kit[e] = 0;
      continue;
    }
    st.keep[e] = 1;
    const k = e * WEAPON_SLOT_COUNT;
    for (let slot = 0; slot < WEAPON_SLOT_COUNT; slot++) {
      st.keepLoadout[k + slot] = s.loadout[k + slot]!;
      st.keepClip[k + slot] = s.slotClip[k + slot]!;
      st.keepReserve[k + slot] = s.slotReserve[k + slot]!;
    }
  }
  if (reset) {
    st.data[STRIKE_DATA.streak0] = 0;
    st.data[STRIKE_DATA.streak1] = 0;
  }
}

/**
 * Depois do spawn da rodada: quem sobreviveu volta com o que tinha; o resto, com a pistola e a faca (a pistola é
 * grátis, o resto se compra). Um atacante sorteado leva a Boom Box.
 */
export function strikeRoundStart(ctx: SimContext): void {
  const st = ctx.strike!;
  const s = ctx.s;
  const atk = attackers(ctx);
  let carriers = 0;
  for (let e = 0; e < s.count; e++) {
    if (s.alive[e] !== 1 || s.kind[e] !== ENTITY_KIND.bobo) continue;
    s.spawnProtectTicks[e] = 0;
    s.flags[e] = s.flags[e]! & ~F.spawnProtected;
    const k = e * WEAPON_SLOT_COUNT;
    if (st.keep[e] === 1) {
      for (let slot = 0; slot < WEAPON_SLOT_COUNT; slot++) {
        s.loadout[k + slot] = st.keepLoadout[k + slot]!;
        s.slotClip[k + slot] = st.keepClip[k + slot]!;
        s.slotReserve[k + slot] = st.keepReserve[k + slot]!;
      }
    } else {
      s.loadout[k + WEAPON_SLOT.primary] = WEAPON_NONE;
      s.slotClip[k + WEAPON_SLOT.primary] = 0;
      s.slotReserve[k + WEAPON_SLOT.primary] = 0;
      s.loadout[k + WEAPON_SLOT.throwable] = WEAPON_NONE;
      s.slotClip[k + WEAPON_SLOT.throwable] = 0;
      s.slotReserve[k + WEAPON_SLOT.throwable] = 0;
    }
    holdFirst(ctx, e);
    if (s.team[e] === atk) carriers++;
  }
  const d = st.data;
  d[STRIKE_DATA.bomb] = BOMB.carried;
  d[STRIKE_DATA.carrier] = NULL_ENTITY;
  d[STRIKE_DATA.site] = -1;
  d[STRIKE_DATA.bombTicks] = 0;
  d[STRIKE_DATA.plantTicks] = 0;
  d[STRIKE_DATA.planter] = NULL_ENTITY;
  d[STRIKE_DATA.defuseTicks] = 0;
  d[STRIKE_DATA.defuser] = NULL_ENTITY;
  if (carriers === 0) return;
  let pick = ctx.rngStrike.int(0, carriers);
  for (let e = 0; e < s.count; e++) {
    if (s.alive[e] !== 1 || s.kind[e] !== ENTITY_KIND.bobo || s.team[e] !== atk) continue;
    if (pick-- === 0) {
      d[STRIKE_DATA.carrier] = s.idOf(e);
      return;
    }
  }
}

/** A mão no 1º slot com arma (a primária, se tiver; senão a pistola). */
function holdFirst(ctx: SimContext, e: number): void {
  const s = ctx.s;
  const k = e * WEAPON_SLOT_COUNT;
  for (let slot = 0; slot < WEAPON_SLOT_COUNT; slot++) {
    if (s.loadout[k + slot] === WEAPON_NONE) continue;
    s.slot[e] = slot;
    s.weapon[e] = s.loadout[k + slot]!;
    // A entrada congelada não puxa a mão de volta (o jogo acerta o slot do quadro pelo da view).
    s.inWeapon[e] = slot;
    return;
  }
}

/** Uma compra (o índice de `STRIKE_SHOP`); sem dinheiro, ou já tendo, nada. */
function buy(ctx: SimContext, e: number, item: number): void {
  const s = ctx.s;
  const def = STRIKE_SHOP[item];
  if (def === undefined || s.points[e]! < def.price) return;
  const k = e * WEAPON_SLOT_COUNT;
  switch (def.id) {
    case 'armor50':
    case 'armor100': {
      const value = def.id === 'armor50' ? 50 : 100;
      if (s.armor[e]! >= value) return;
      s.armor[e] = value;
      break;
    }
    case 'kit':
      // Só quem defende desarma.
      if (s.kit[e] === 1 || s.team[e] === attackers(ctx)) return;
      s.kit[e] = 1;
      break;
    case 'grenade': {
      const code = WEAPON_CODE.grenade;
      if (s.loadout[k + WEAPON_SLOT.throwable] === code && s.slotClip[k + WEAPON_SLOT.throwable]! > 0) return;
      s.loadout[k + WEAPON_SLOT.throwable] = code;
      s.slotClip[k + WEAPON_SLOT.throwable] = 1;
      s.slotReserve[k + WEAPON_SLOT.throwable] = 0;
      break;
    }
    default: {
      const code = WEAPON_CODE[def.id];
      if (s.loadout[k + WEAPON_SLOT.primary] === code) return;
      const w = weaponDef(code)!;
      s.loadout[k + WEAPON_SLOT.primary] = code;
      s.slotClip[k + WEAPON_SLOT.primary] = w.clipSize;
      s.slotReserve[k + WEAPON_SLOT.primary] = w.reserve;
      s.slot[e] = WEAPON_SLOT.primary;
      s.weapon[e] = code;
      s.inWeapon[e] = WEAPON_SLOT.primary;
      ctx.events.weapon(ctx.tick, s.idOf(e), code, 'switch');
    }
  }
  s.points[e] = s.points[e]! - def.price;
}

/** O passo do BoboStrike (antes das rodadas): a compra, a Boom Box (carregar, largar, pegar, plantar, desarmar, explodir). */
export function strikeSystem(ctx: SimContext): void {
  const st = ctx.strike;
  const rounds = ctx.rounds;
  if (st === null || rounds === null || ctx.match.phase !== 'playing') return;
  const s = ctx.s;
  const rd = rounds.data;
  const phase = rd[ROUND.phase];
  if (rd[ROUND.round] === 0) return;
  // A compra (só na fase dela): o pedido do InputFrame, consumido.
  for (let e = 0; e < s.count; e++) {
    const req = s.buyRequest[e]!;
    if (req === 0) continue;
    s.buyRequest[e] = 0;
    if (phase === ROUND_PHASE.buy && living(ctx, e)) buy(ctx, e, req - 1);
  }
  if (phase !== ROUND_PHASE.live) return;
  const d = st.data;
  const atk = attackers(ctx);
  const bomb = d[STRIKE_DATA.bomb];
  if (bomb === BOMB.carried) {
    const id = d[STRIKE_DATA.carrier]! >>> 0;
    if (id === NULL_ENTITY || !s.isCurrent(id)) return;
    const e = id & 0xffff;
    const e3 = e * 3;
    if (!living(ctx, e)) {
      // O portador caiu: a bomba fica no chão onde ele estava (com marcador para o time).
      drop(ctx, s.position[e3]!, s.position[e3 + 1]!, s.position[e3 + 2]!);
      return;
    }
    plantStep(ctx, e);
    return;
  }
  if (bomb === BOMB.dropped) {
    // Um atacante vivo encostando pega de volta.
    const r2 = STRIKE.pickupReachM * STRIKE.pickupReachM;
    for (let e = 0; e < s.count; e++) {
      if (!living(ctx, e) || s.team[e] !== atk) continue;
      const e3 = e * 3;
      const dx = s.position[e3]! - st.pos[0]!;
      const dz = s.position[e3 + 2]! - st.pos[2]!;
      if (dx * dx + dz * dz <= r2 && Math.abs(s.position[e3 + 1]! - st.pos[1]!) < 1.5) {
        d[STRIKE_DATA.bomb] = BOMB.carried;
        d[STRIKE_DATA.carrier] = s.idOf(e);
        return;
      }
    }
    return;
  }
  if (bomb !== BOMB.planted) return;
  defuseStep(ctx);
  if (d[STRIKE_DATA.bomb] !== BOMB.planted) return;
  if (d[STRIKE_DATA.bombTicks]! > 0) d[STRIKE_DATA.bombTicks] = d[STRIKE_DATA.bombTicks]! - 1;
  if (d[STRIKE_DATA.bombTicks] === 0) {
    d[STRIKE_DATA.bomb] = BOMB.exploded;
    explode(ctx, st.pos[0]!, st.pos[1]! + 0.3, st.pos[2]!, BOOM_BOX, NULL_ENTITY, -1);
  }
}

/** Rascunho do raio até o chão da bomba largada. */
const dropHit = createRayHit();

/**
 * O portador caiu: a bomba cai até o chão embaixo dele. Sem chão (o vazio), ela passa a um atacante vivo sorteado (sem
 * ninguém, fica: a rodada já está acabando).
 */
function drop(ctx: SimContext, x: number, y: number, z: number): void {
  const st = ctx.strike!;
  const d = st.data;
  d[STRIKE_DATA.plantTicks] = 0;
  d[STRIKE_DATA.planter] = NULL_ENTITY;
  const top = Math.max(y, ctx.killPlaneY) + 0.5;
  const floor =
    y > ctx.killPlaneY &&
    raycastGrid(
      ctx.grid,
      ctx.blocks,
      x,
      top,
      z,
      0,
      -1,
      0,
      top - ctx.killPlaneY,
      BLOCK_FLAG.solid,
      dropHit,
      ctx.colliders,
    );
  if (floor) {
    d[STRIKE_DATA.bomb] = BOMB.dropped;
    d[STRIKE_DATA.carrier] = NULL_ENTITY;
    st.pos[0] = x;
    st.pos[1] = dropHit.y;
    st.pos[2] = z;
    return;
  }
  const s = ctx.s;
  const atk = attackers(ctx);
  let n = 0;
  for (let e = 0; e < s.count; e++) if (living(ctx, e) && s.team[e] === atk) n++;
  if (n === 0) {
    d[STRIKE_DATA.bomb] = BOMB.dropped;
    d[STRIKE_DATA.carrier] = NULL_ENTITY;
    st.pos[0] = x;
    st.pos[1] = y;
    st.pos[2] = z;
    return;
  }
  let pick = ctx.rngStrike.int(0, n);
  for (let e = 0; e < s.count; e++) {
    if (!living(ctx, e) || s.team[e] !== atk || pick-- !== 0) continue;
    d[STRIKE_DATA.bomb] = BOMB.carried;
    d[STRIKE_DATA.carrier] = s.idOf(e);
    return;
  }
}

/** O site em que `e` está (-1 = nenhum). */
function siteOf(ctx: SimContext, e: number): number {
  const st = ctx.strike!;
  const s = ctx.s;
  const e3 = e * 3;
  for (let i = 0; i < st.sites.length; i++) {
    const site = st.sites[i]!;
    const dx = s.position[e3]! - site.x;
    const dz = s.position[e3 + 2]! - site.z;
    if (dx * dx + dz * dz <= site.radius * site.radius && Math.abs(s.position[e3 + 1]! - site.y) < 2) return i;
  }
  return -1;
}

/** O portador no site segurando o usar, no chão: planta em `plantS`; soltar ou sair recomeça. */
function plantStep(ctx: SimContext, e: number): void {
  const st = ctx.strike!;
  const d = st.data;
  const s = ctx.s;
  const site = siteOf(ctx, e);
  const holding = (s.inButtons[e]! & BUTTON.use) !== 0 && (s.flags[e]! & F.onGround) !== 0;
  if (site < 0 || !holding) {
    d[STRIKE_DATA.plantTicks] = 0;
    d[STRIKE_DATA.planter] = NULL_ENTITY;
    return;
  }
  d[STRIKE_DATA.planter] = s.idOf(e);
  d[STRIKE_DATA.plantTicks] = d[STRIKE_DATA.plantTicks]! + 1;
  if (d[STRIKE_DATA.plantTicks]! < Math.round(STRIKE.plantS * ctx.hz)) return;
  const e3 = e * 3;
  st.pos[0] = s.position[e3]!;
  st.pos[1] = s.position[e3 + 1]!;
  st.pos[2] = s.position[e3 + 2]!;
  d[STRIKE_DATA.bomb] = BOMB.planted;
  d[STRIKE_DATA.carrier] = NULL_ENTITY;
  d[STRIKE_DATA.site] = site;
  d[STRIKE_DATA.plantTicks] = 0;
  d[STRIKE_DATA.bombTicks] = Math.round(STRIKE.bombS * ctx.hz);
  addMoney(ctx, e, STRIKE.plantMoney);
  // O relógio da rodada passa a ser o da bomba (a rodada não acaba no tempo com ela plantada).
  ctx.rounds!.data[ROUND.ticks] = d[STRIKE_DATA.bombTicks]! + 2;
}

/** O defensor vivo mais perto da bomba plantada, segurando o usar e no chão, desarma; trocar de quem desarma recomeça. */
function defuseStep(ctx: SimContext): void {
  const st = ctx.strike!;
  const d = st.data;
  const s = ctx.s;
  const def = attackers(ctx) ^ 1;
  const r2 = STRIKE.defuseReachM * STRIKE.defuseReachM;
  // Quem já está desarmando continua (outro chegando mais perto não zera o progresso).
  const cur = d[STRIKE_DATA.defuser]! >>> 0;
  if (cur !== NULL_ENTITY && s.isCurrent(cur) && canDefuse(ctx, cur & 0xffff, def, r2) >= 0) {
    defuseTick(ctx, cur & 0xffff);
    return;
  }
  let who = -1;
  let best = r2;
  for (let e = 0; e < s.count; e++) {
    const dist2 = canDefuse(ctx, e, def, r2);
    if (dist2 >= 0 && dist2 <= best) {
      best = dist2;
      who = e;
    }
  }
  if (who < 0) {
    d[STRIKE_DATA.defuseTicks] = 0;
    d[STRIKE_DATA.defuser] = NULL_ENTITY;
    return;
  }
  d[STRIKE_DATA.defuser] = s.idOf(who);
  d[STRIKE_DATA.defuseTicks] = 0;
  defuseTick(ctx, who);
}

/** `e` (do time `def`) pode desarmar agora: a distância² até a bomba, ou -1. */
function canDefuse(ctx: SimContext, e: number, def: number, r2: number): number {
  const st = ctx.strike!;
  const s = ctx.s;
  if (!living(ctx, e) || s.team[e] !== def) return -1;
  if ((s.inButtons[e]! & BUTTON.use) === 0 || (s.flags[e]! & F.onGround) === 0) return -1;
  const e3 = e * 3;
  const dx = s.position[e3]! - st.pos[0]!;
  const dy = s.position[e3 + 1]! - st.pos[1]!;
  const dz = s.position[e3 + 2]! - st.pos[2]!;
  const dist2 = dx * dx + dy * dy + dz * dz;
  return dist2 <= r2 ? dist2 : -1;
}

function defuseTick(ctx: SimContext, e: number): void {
  const d = ctx.strike!.data;
  d[STRIKE_DATA.defuseTicks] = d[STRIKE_DATA.defuseTicks]! + 1;
  const need = Math.round((ctx.s.kit[e] === 1 ? STRIKE.kitDefuseS : STRIKE.defuseS) * ctx.hz);
  if (d[STRIKE_DATA.defuseTicks]! >= need) d[STRIKE_DATA.bomb] = BOMB.defused;
}

/** Quem venceu a rodada agora: a explosão, o desarme, ou um lado eliminado (com a bomba plantada, matar os atacantes não basta). */
export function strikeRoundWinner(ctx: SimContext): number {
  const d = ctx.strike!.data;
  const atk = attackers(ctx);
  const bomb = d[STRIKE_DATA.bomb];
  if (bomb === BOMB.exploded) return atk;
  if (bomb === BOMB.defused) return atk ^ 1;
  const s = ctx.s;
  let a = 0;
  let b = 0;
  for (let e = 0; e < s.count; e++) {
    if (!living(ctx, e)) continue;
    if (s.team[e] === atk) a++;
    else b++;
  }
  // Os dois lados zerados no mesmo tick, sem a bomba plantada: a defesa leva (escolha minha, revisável).
  if (a === 0 && bomb !== BOMB.planted) return atk ^ 1;
  if (b === 0) return atk;
  return ROUND_UNDECIDED;
}

/** O tempo acabou: sem a bomba plantada, os defensores levam. */
export function strikeTimeWinner(ctx: SimContext): number {
  return ctx.strike!.data[STRIKE_DATA.bomb] === BOMB.planted ? ROUND_UNDECIDED : attackers(ctx) ^ 1;
}

/** O dinheiro do fim da rodada: quem venceu ganha a faixa da vitória; quem perdeu, a da derrota (mais a cada derrota seguida). */
export function strikeRoundEnd(ctx: SimContext, winner: number): void {
  const d = ctx.strike!.data;
  const s = ctx.s;
  for (let t = 0; t < 2; t++) {
    const slot = t === 0 ? STRIKE_DATA.streak0 : STRIKE_DATA.streak1;
    const won = t === winner;
    const pay = won ? STRIKE.winMoney : Math.min(STRIKE.lossMax, STRIKE.lossMoney + STRIKE.lossStep * d[slot]!);
    d[slot] = won ? 0 : d[slot]! + 1;
    for (let e = 0; e < s.count; e++) {
      if (s.alive[e] === 1 && s.kind[e] === ENTITY_KIND.bobo && s.team[e] === t) addMoney(ctx, e, pay);
    }
  }
}

/** O abate de um inimigo rende `killMoney`. */
export function strikeKill(ctx: SimContext, killer: number, victim: number): void {
  if (killer === victim || ctx.s.team[killer] === ctx.s.team[victim]) return;
  addMoney(ctx, killer, STRIKE.killMoney);
}

/** O colete: absorve `armorAbsorb` do dano fora da cabeça (até o que sobra dele). Devolve o dano que passa. */
export function strikeArmor(ctx: SimContext, t: number, amount: number, head: boolean): number {
  const s = ctx.s;
  if (head || amount <= 0 || s.armor[t] === 0) return amount;
  const absorbed = Math.min(s.armor[t]!, Math.round(amount * STRIKE.armorAbsorb));
  s.armor[t] = s.armor[t]! - absorbed;
  return amount - absorbed;
}
