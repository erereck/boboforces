import type { MatchRecipe } from '@boboforces/format';
import { INFECTION_DEFAULTS } from '@boboforces/format';
import { WEAPON_SLOT_COUNT } from '@boboforces/input';
import { WEAPON_BIG_BRRT, WEAPON_CODE, WEAPONS, weaponDef } from '../config/weapons.ts';
import { MAX_ENTITIES } from '../constants.ts';
import { AMMO_RULE, RULE_FLAG, WEAPON_NONE, type SimContext } from '../context.ts';
import { ENTITY_FLAG, ENTITY_KIND, NULL_ENTITY, type EntityId } from '../entity.ts';
import { roundLive } from './rounds.ts';

/**
 * M6 (fase 2): os modos de festa que são regra sobre o Warfare (GDD §4.1.2):
 * - **Gun Game** (`weapons.ladder`, sobre o FFA): cada bobo só tem a arma do nível dele (o nível mora nos pontos,
 *   `SimState.points`, que o snapshot e a rede já levam); cada abate sobe um nível e troca a arma na hora; morrer pela
 *   faca desce um; quem abate com a última arma vence. No fim do tempo, vence o nível mais alto.
 * - **Infection** (`infection`, sobre os Times): o time 0 são os sobreviventes e o time 1 os infectados (só a faca,
 *   mais rápidos). Na largada, se não houver infectado, um sobrevivente sorteado vira um; quem morre vira infectado (ao
 *   renascer). Os infectados vencem quando não sobra sobrevivente; os sobreviventes, no fim do tempo. O placar mostra
 *   quantos há de cada lado.
 * - **Juggernaut** (`mode: 'juggernaut'`, M6 fase 3, a variante Rodízio): o time 0 caça e o time 1 é o Jugg, um só (vida
 *   de 300 por oponente, no mínimo 1000; sem o multiplicador da cabeça; 0,75x de velocidade; a Big Brrt). Na largada,
 *   um sorteado vira o Jugg; quem dá o golpe final no Jugg vira o próximo (na hora, com a vida cheia de Jugg); sem
 *   ninguém (o vazio sem crédito), outro sorteado. Cada segundo como Jugg vale 1 ponto (`points`); vence quem chegar à
 *   meta (150) ou, no fim do tempo, quem tiver mais.
 */
/** M6 (fase 3): os números do Jugg (GDD §4.1.2). */
export const JUGGERNAUT = { hpPerOpponent: 300, minHp: 1000, speed: 0.75, scoreLimit: 150 } as const;

/**
 * M7 (fase 0): o Jugg Fixo (GDD §4.1.2: rodadas de 3 min com rodízio, o "1 contra 3" do sofá). Cada rodada, o da vez
 * (pela ordem dos controladores: os humanos primeiro) é o Jugg até cair ou o tempo acabar; cada segundo de Jugg vale 1
 * ponto e, no fim, vence quem tiver mais. São tantas rodadas quanto participantes, até `maxRounds`. Escolhas minhas
 * (revisáveis): 3 s de largada parada e 4 s de pausa entre as rodadas.
 */
export const JUGG_FIXED = { roundS: 180, startS: 3, overS: 4, maxRounds: 8 } as const;

/** A vida do Jugg contra `opponents` caçadores. */
export function juggernautHp(opponents: number): number {
  return Math.max(JUGGERNAUT.minHp, JUGGERNAUT.hpPerOpponent * opponents);
}

/**
 * As regras de cada bobo de antes de virar o Jugg (fora do estado, como as regras: saem do time, que o estado leva).
 * `crowned` diz quem está com as regras do Jugg agora.
 */
interface JuggRules {
  readonly crowned: Uint8Array;
  readonly maxHp: Float32Array;
  readonly speed: Float32Array;
  readonly flags: Uint8Array;
  readonly ammo: Uint8Array;
}
export interface PartyState {
  /** Códigos das armas da escada do Gun Game, ou `null`. */
  readonly ladder: Uint8Array | null;
  /** A velocidade dos infectados, ou -1 sem Infection. */
  readonly infectedSpeed: number;
  /** O Infection já sorteou o 1º infectado. */
  started: boolean;
  /** Quem fechou a escada (`NULL_ENTITY` = ninguém ainda). */
  winnerEntity: EntityId;
  /** O time que o modo deu como vencedor (-2 = ninguém ainda; -1 = empate). */
  winnerTeam: number;
  /** M6 (fase 3): as regras guardadas do Juggernaut, ou `null` fora dele. */
  readonly jugg: JuggRules | null;
  /** Ticks do Jugg atual desde o último ponto. */
  juggTicks: number;
  /** M7 (fase 0): o Jugg Fixo (o Jugg é o da rodada; derrubar o Jugg acaba a rodada em vez de passar a coroa). */
  readonly juggFixed: boolean;
}

/** O modo tem estado de festa (o hash e o snapshot levam `started`, os vencedores e o sorteio)? */
export function partyActive(p: PartyState): boolean {
  return p.ladder !== null || p.infectedSpeed > 0 || p.jugg !== null;
}

export function createPartyState(recipe: MatchRecipe): PartyState {
  const ids = recipe.weapons?.ladder ?? [];
  const codes: number[] = [];
  for (const id of ids) {
    const code = WEAPONS.findIndex((def) => def.id === id);
    if (code >= 0) codes.push(code);
  }
  return {
    ladder: codes.length >= 2 ? Uint8Array.from(codes) : null,
    infectedSpeed: recipe.infection !== undefined ? (recipe.infection.speed ?? INFECTION_DEFAULTS.speed) : -1,
    started: false,
    winnerEntity: NULL_ENTITY,
    winnerTeam: -2,
    jugg:
      recipe.mode === 'juggernaut'
        ? {
            crowned: new Uint8Array(MAX_ENTITIES),
            maxHp: new Float32Array(MAX_ENTITIES),
            speed: new Float32Array(MAX_ENTITIES),
            flags: new Uint8Array(MAX_ENTITIES),
            ammo: new Uint8Array(MAX_ENTITIES),
          }
        : null,
    juggTicks: 0,
    juggFixed: recipe.mode === 'juggernaut' && recipe.juggernaut?.variant === 'fixed',
  };
}

/** O bobo `e` fica só com a arma `code` (pente e reserva cheios, na mão), sem nada pela metade da anterior. */
function holdOnly(ctx: SimContext, e: number, code: number): void {
  const s = ctx.s;
  const def = weaponDef(code);
  const k = e * WEAPON_SLOT_COUNT;
  for (let slot = 0; slot < WEAPON_SLOT_COUNT; slot++) {
    s.loadout[k + slot] = WEAPON_NONE;
    s.slotClip[k + slot] = 0;
    s.slotReserve[k + slot] = 0;
  }
  if (def === null) return;
  const slot = def.slot;
  s.loadout[k + slot] = code;
  s.slotClip[k + slot] = def.clipSize;
  s.slotReserve[k + slot] = def.reserve;
  s.slot[e] = slot;
  s.weapon[e] = code;
  s.reloadTicks[e] = 0;
  s.cookTicks[e] = -1;
  s.quickNade[e] = 0;
  s.burstShots[e] = 0;
  s.adsAmount[e] = 0;
}

/** O loadout do modo ao renascer (depois do de sempre): a arma do nível no Gun Game; a faca para o infectado. */
export function partyLoadout(ctx: SimContext, e: number): void {
  const p = ctx.party;
  const s = ctx.s;
  if (s.kind[e] !== ENTITY_KIND.bobo) return;
  if (p.ladder !== null) holdOnly(ctx, e, p.ladder[Math.min(s.points[e]!, p.ladder.length - 1)]!);
  if (p.infectedSpeed > 0 && s.team[e] === 1) holdOnly(ctx, e, WEAPON_CODE.knife);
  if (p.jugg !== null && s.team[e] === 1) holdOnly(ctx, e, WEAPON_BIG_BRRT);
}

/** Quantos bobos caçam (fora do time do Jugg), vivos ou esperando o respawn. */
function hunters(ctx: SimContext): number {
  const s = ctx.s;
  let n = 0;
  for (let e = 0; e < s.count; e++) if (s.alive[e] === 1 && s.kind[e] === ENTITY_KIND.bobo && s.team[e] !== 1) n++;
  return n;
}

/** Põe (ou tira) as regras do Jugg em `e`, guardando as de antes. Nada muda se já estiver assim. */
function juggRules(ctx: SimContext, e: number, crown: boolean, opponents: number): void {
  const j = ctx.party.jugg!;
  if ((j.crowned[e] === 1) === crown) return;
  const r = ctx.rules;
  if (crown) {
    j.maxHp[e] = r.maxHp[e]!;
    j.speed[e] = r.speed[e]!;
    j.flags[e] = r.flags[e]!;
    j.ammo[e] = r.ammo[e]!;
    r.maxHp[e] = juggernautHp(opponents);
    r.speed[e] = JUGGERNAUT.speed;
    r.flags[e] = r.flags[e]! | RULE_FLAG.headshotImmune;
    r.ammo[e] = AMMO_RULE.infiniteReserve;
  } else {
    r.maxHp[e] = j.maxHp[e]!;
    r.speed[e] = j.speed[e]!;
    r.flags[e] = j.flags[e]!;
    r.ammo[e] = j.ammo[e]!;
  }
  j.crowned[e] = crown ? 1 : 0;
}

/**
 * As regras do Juggernaut acompanham o time (o snapshot e a rede trazem o time; as regras ficam fora do estado). O host
 * chama a cada tick; o amigo, a cada snapshot (a predição dele anda e mira como no host).
 */
export function syncJuggRules(ctx: SimContext): void {
  if (ctx.party.jugg === null) return;
  const s = ctx.s;
  const opponents = hunters(ctx);
  for (let e = 0; e < s.count; e++) {
    if (s.alive[e] !== 1 || s.kind[e] !== ENTITY_KIND.bobo) continue;
    juggRules(ctx, e, s.team[e] === 1, opponents);
  }
}

/** `e` (vivo) vira o Jugg agora: o time, as regras, a vida cheia de Jugg e só a Big Brrt na mão. */
function crown(ctx: SimContext, e: number): void {
  const s = ctx.s;
  s.team[e] = 1;
  juggRules(ctx, e, true, hunters(ctx));
  s.health[e] = ctx.rules.maxHp[e]!;
  holdOnly(ctx, e, WEAPON_BIG_BRRT);
  ctx.party.juggTicks = 0;
}

function huntsAlive(ctx: SimContext, e: number): boolean {
  const s = ctx.s;
  return (
    s.alive[e] === 1 && s.kind[e] === ENTITY_KIND.bobo && s.team[e] !== 1 && (s.flags[e]! & ENTITY_FLAG.dead) === 0
  );
}

/** Um caçador vivo sorteado (índice), ou -1. */
function randomHunter(ctx: SimContext): number {
  const s = ctx.s;
  let n = 0;
  for (let e = 0; e < s.count; e++) if (huntsAlive(ctx, e)) n++;
  if (n === 0) return -1;
  let pick = ctx.rngParty.int(0, n);
  for (let e = 0; e < s.count; e++) if (huntsAlive(ctx, e) && pick-- === 0) return e;
  return -1;
}

/** M7 (fase 0): antes de a rodada do Jugg Fixo começar, todo mundo volta a caçar (as regras de antes). */
export function juggRoundReset(ctx: SimContext): void {
  const s = ctx.s;
  for (let e = 0; e < s.count; e++) {
    if (s.alive[e] !== 1 || s.kind[e] !== ENTITY_KIND.bobo || s.team[e] !== 1) continue;
    s.team[e] = 0;
    juggRules(ctx, e, false, 0);
  }
}

/** M7 (fase 0): depois do spawn da rodada `round` (1..), o da vez vira o Jugg (pela ordem das entidades). */
export function juggRoundStart(ctx: SimContext, round: number): void {
  const s = ctx.s;
  let n = 0;
  for (let e = 0; e < s.count; e++) if (s.alive[e] === 1 && s.kind[e] === ENTITY_KIND.bobo) n++;
  if (n === 0) return;
  let k = (round - 1) % n;
  for (let e = 0; e < s.count; e++) {
    if (s.alive[e] !== 1 || s.kind[e] !== ENTITY_KIND.bobo) continue;
    if (k-- === 0) {
      crown(ctx, e);
      return;
    }
  }
}

/** M7 (fase 0): o Jugg Fixo caiu: os caçadores (o time 0) levam a rodada. -2 = ainda não. */
export function juggRoundWinner(ctx: SimContext): number {
  return currentJugg(ctx) < 0 ? 0 : -2;
}

/** O Jugg vivo agora (índice), ou -1. */
export function currentJugg(ctx: SimContext): number {
  const s = ctx.s;
  for (let e = 0; e < s.count; e++) {
    if (s.alive[e] === 1 && s.kind[e] === ENTITY_KIND.bobo && s.team[e] === 1 && (s.flags[e]! & ENTITY_FLAG.dead) === 0)
      return e;
  }
  return -1;
}

/** O sobrevivente `e` vira infectado (o time 1 e a velocidade; a faca vem no próximo spawn, ou agora se `now`). */
function infect(ctx: SimContext, e: number, now: boolean): void {
  ctx.s.team[e] = 1;
  ctx.rules.speed[e] = ctx.party.infectedSpeed;
  if (now) holdOnly(ctx, e, WEAPON_CODE.knife);
}

/** Um abate (chamado por `kill` depois do placar): o nível do Gun Game e a infecção. */
export function partyKill(ctx: SimContext, victim: number, killer: EntityId, weapon: number): void {
  const p = ctx.party;
  const s = ctx.s;
  if (p.ladder !== null) {
    // Morrer pela faca desce um nível.
    if (weapon === WEAPON_CODE.knife) s.points[victim] = Math.max(0, s.points[victim]! - 1);
    if (killer !== NULL_ENTITY && s.isCurrent(killer)) {
      const k = killer & 0xffff;
      // Só quem está vivo sobe (no "tudo explode", o abate da explosão é de quem já morreu).
      if (
        k !== victim &&
        s.kind[k] === ENTITY_KIND.bobo &&
        s.alive[k] === 1 &&
        (s.flags[k]! & ENTITY_FLAG.dead) === 0
      ) {
        const level = s.points[k]! + 1;
        s.points[k] = level;
        if (level >= p.ladder.length) {
          if (p.winnerEntity === NULL_ENTITY) p.winnerEntity = killer;
        } else holdOnly(ctx, k, p.ladder[level]!);
      }
    }
  }
  if (p.infectedSpeed > 0 && s.kind[victim] === ENTITY_KIND.bobo && s.team[victim] === 0) infect(ctx, victim, false);
  // Juggernaut: o Jugg caído volta a caçar (renasce como caçador) e quem deu o golpe final vira o Jugg.
  if (p.jugg !== null && s.kind[victim] === ENTITY_KIND.bobo && s.team[victim] === 1) {
    s.team[victim] = 0;
    juggRules(ctx, victim, false, 0);
    // M7 (fase 0): no Fixo, derrubar o Jugg acaba a rodada (a coroa não passa).
    if (!p.juggFixed && killer !== NULL_ENTITY && s.isCurrent(killer)) {
      const k = killer & 0xffff;
      if (k !== victim && huntsAlive(ctx, k)) crown(ctx, k);
    }
  }
}

/** Passo dos modos de festa (antes das regras do placar): a largada do Infection, o placar dele e quem venceu. */
export function partySystem(ctx: SimContext): void {
  const p = ctx.party;
  if (p.jugg !== null) {
    juggernautSystem(ctx);
    return;
  }
  if (p.infectedSpeed <= 0) return;
  const m = ctx.match;
  if (m.phase !== 'playing') return;
  const s = ctx.s;
  if (!p.started) {
    p.started = true;
    let infected = 0;
    let survivors = 0;
    for (let e = 0; e < s.count; e++) {
      if (s.alive[e] !== 1 || s.kind[e] !== ENTITY_KIND.bobo) continue;
      if (s.team[e] === 1) infected++;
      else if (s.team[e] === 0) survivors++;
    }
    if (infected === 0 && survivors > 1) {
      let pick = ctx.rngParty.int(0, survivors);
      for (let e = 0; e < s.count; e++) {
        if (s.alive[e] !== 1 || s.kind[e] !== ENTITY_KIND.bobo || s.team[e] !== 0) continue;
        if (pick-- === 0) {
          infect(ctx, e, true);
          break;
        }
      }
    }
  }
  let survivors = 0;
  let infected = 0;
  for (let e = 0; e < s.count; e++) {
    if (s.alive[e] !== 1 || s.kind[e] !== ENTITY_KIND.bobo) continue;
    if (s.team[e] === 0) survivors++;
    else if (s.team[e] === 1) infected++;
  }
  m.teamScore[0] = survivors;
  m.teamScore[1] = infected;
  if (p.winnerTeam !== -2) return;
  // Ninguém sobrou: os infectados vencem. O tempo acabando (o último tick): os sobreviventes.
  if (survivors === 0) p.winnerTeam = 1;
  else if (m.ticksLeft >= 0 && m.ticksLeft <= 1) p.winnerTeam = 0;
}

/** O passo do Juggernaut: as regras pelo time, o Jugg (o sorteio quando falta), o ponto por segundo e a meta. */
function juggernautSystem(ctx: SimContext): void {
  const p = ctx.party;
  syncJuggRules(ctx);
  const m = ctx.match;
  if (m.phase !== 'playing' && m.phase !== 'suddenDeath') return;
  p.started = true;
  // M7 (fase 0): no Fixo, o Jugg é o da rodada (as rodadas coroam) e só pontua com a rodada valendo.
  if (p.juggFixed && !roundLive(ctx)) return;
  let jugg = currentJugg(ctx);
  // Um só Jugg: quem mais estiver vivo no time 1 volta a caçar (não acontece com a largada de sempre; é a garantia).
  if (jugg >= 0) {
    const s = ctx.s;
    for (let e = jugg + 1; e < s.count; e++) {
      if (s.alive[e] === 1 && s.kind[e] === ENTITY_KIND.bobo && s.team[e] === 1) {
        s.team[e] = 0;
        juggRules(ctx, e, false, 0);
        if (s.health[e]! > ctx.rules.maxHp[e]!) s.health[e] = ctx.rules.maxHp[e]!;
      }
    }
  }
  if (jugg < 0) {
    if (p.juggFixed) return;
    jugg = randomHunter(ctx);
    if (jugg < 0) return;
    crown(ctx, jugg);
  }
  if (++p.juggTicks < ctx.hz) return;
  p.juggTicks = 0;
  const s = ctx.s;
  s.points[jugg] = s.points[jugg]! + 1;
  if (ctx.scoreLimit > 0 && s.points[jugg]! >= ctx.scoreLimit && p.winnerEntity === NULL_ENTITY) {
    p.winnerEntity = s.idOf(jugg);
  }
}
