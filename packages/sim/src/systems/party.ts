import type { MatchRecipe } from '@boboforces/format';
import { INFECTION_DEFAULTS } from '@boboforces/format';
import { WEAPON_SLOT_COUNT } from '@boboforces/input';
import { WEAPON_CODE, WEAPONS, weaponDef } from '../config/weapons.ts';
import { WEAPON_NONE, type SimContext } from '../context.ts';
import { ENTITY_KIND, NULL_ENTITY, type EntityId } from '../entity.ts';

/**
 * M6 (fase 2): os modos de festa que são regra sobre o Warfare (GDD §4.1.2):
 * - **Gun Game** (\`weapons.ladder\`, sobre o FFA): cada bobo só tem a arma do nível dele (o nível mora nos pontos,
 *   \`SimState.points\`, que o snapshot e a rede já levam); cada abate sobe um nível e troca a arma na hora; morrer pela
 *   faca desce um; quem abate com a última arma vence. No fim do tempo, vence o nível mais alto.
 * - **Infection** (\`infection\`, sobre os Times): o time 0 são os sobreviventes e o time 1 os infectados (só a faca,
 *   mais rápidos). Na largada, se não houver infectado, um sobrevivente sorteado vira um; quem morre vira infectado (ao
 *   renascer). Os infectados vencem quando não sobra sobrevivente; os sobreviventes, no fim do tempo. O placar mostra
 *   quantos há de cada lado.
 */
export interface PartyState {
  /** Códigos das armas da escada do Gun Game, ou \`null\`. */
  readonly ladder: Uint8Array | null;
  /** A velocidade dos infectados, ou -1 sem Infection. */
  readonly infectedSpeed: number;
  /** O Infection já sorteou o 1º infectado. */
  started: boolean;
  /** Quem fechou a escada (\`NULL_ENTITY\` = ninguém ainda). */
  winnerEntity: EntityId;
  /** O time que o modo deu como vencedor (-2 = ninguém ainda; -1 = empate). */
  winnerTeam: number;
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
  };
}

/** O bobo \`e\` fica só com a arma \`code\` (pente e reserva cheios, na mão), sem nada pela metade da anterior. */
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
}

/** O sobrevivente \`e\` vira infectado (o time 1 e a velocidade; a faca vem no próximo spawn, ou agora se \`now\`). */
function infect(ctx: SimContext, e: number, now: boolean): void {
  ctx.s.team[e] = 1;
  ctx.rules.speed[e] = ctx.party.infectedSpeed;
  if (now) holdOnly(ctx, e, WEAPON_CODE.knife);
}

/** Um abate (chamado por \`kill\` depois do placar): o nível do Gun Game e a infecção. */
export function partyKill(ctx: SimContext, victim: number, killer: EntityId, weapon: number): void {
  const p = ctx.party;
  const s = ctx.s;
  if (p.ladder !== null) {
    // Morrer pela faca desce um nível.
    if (weapon === WEAPON_CODE.knife) s.points[victim] = Math.max(0, s.points[victim]! - 1);
    if (killer !== NULL_ENTITY && s.isCurrent(killer)) {
      const k = killer & 0xffff;
      if (k !== victim && s.kind[k] === ENTITY_KIND.bobo && s.alive[k] === 1) {
        const level = s.points[k]! + 1;
        s.points[k] = level;
        if (level >= p.ladder.length) {
          if (p.winnerEntity === NULL_ENTITY) p.winnerEntity = killer;
        } else holdOnly(ctx, k, p.ladder[level]!);
      }
    }
  }
  if (p.infectedSpeed > 0 && s.kind[victim] === ENTITY_KIND.bobo && s.team[victim] === 0) infect(ctx, victim, false);
}

/** Passo dos modos de festa (antes das regras do placar): a largada do Infection, o placar dele e quem venceu. */
export function partySystem(ctx: SimContext): void {
  const p = ctx.party;
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
