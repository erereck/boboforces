import { CHAOS_DEFAULTS, MODIFIERS, modifiersConflict, type MatchRecipe, type ModifierId } from '@boboforces/format';
import { WEAPON_SLOT_COUNT } from '@boboforces/input';
import type { MovementProfile } from '../config/movement.ts';
import { WEAPON_SLOT, WEAPONS, weaponDef } from '../config/weapons.ts';
import { MATCH_DEFAULTS } from '../config/rules.ts';
import { secondsToTicks } from '../constants.ts';
import { WEAPON_NONE, type MatchMods, type SimContext } from '../context.ts';
import { ENTITY_FLAG, ENTITY_KIND } from '../entity.ts';
import { CHAOS_SCALE_BITS, chaosScale, squeezedScaleAt } from '../hitbox.ts';

/**
 * M6 (fase 4): os modificadores (GDD §4.5.3) e a Roleta do Bobo Chaos.
 *
 * - **Os modificadores** são bits de uma máscara (o índice em `MODIFIERS`). Os fixos da receita (`modifiers`) valem a
 *   partida toda, em qualquer modo; a Roleta (`chaos`) sorteia `count` na largada e, a cada `everyS`, troca um (o
 *   que entra é anunciado `warnS` antes). O sorteio nunca põe dois que conflitam.
 * - **O estado** são 3 números (`masks`): a máscara ativa, a próxima (igual à ativa fora do aviso) e os ticks até a
 *   troca (-1 = sem Roleta, ou antes da largada). Entram no hash, no snapshot e na rede (o amigo aplica a máscara que
 *   chega: a gravidade e a velocidade da predição dele são as do host).
 * - **Aplicar** a máscara troca o perfil de movimento da partida (`ctx.profile`: um dos 6 feitos na criação, sem
 *   alocar) e liga os modificadores de arma (`ctx.mods`, a cópia da partida). Os outros efeitos olham a máscara na
 *   hora (`modOn`): munição infinita (armas), vampiro (dano), tudo explode e troca de arma por abate (morte) e, no M9,
 *   o Ricochete (armas). O Mini e os Bots gigantes viram a escala de cada corpo no fim do tick
 *   (`updateChaosScales`, apertada debaixo de teto), que as hitboxes, o olho, a IA e o desenho leem.
 */
export const MOD = Object.fromEntries(MODIFIERS.map((id, i) => [id, 1 << i])) as Readonly<Record<ModifierId, number>>;

/** Os números dos modificadores (GDD §4.5.3). */
export const CHAOS_MODS = {
  lowGravity: 0.35,
  heavyGravity: 1.8,
  speed: 1.5,
  /** Tudo explode: a explosão de quem morre (dano no centro e raio). */
  blastDamage: 60,
  blastRadiusM: 3,
  /** Cabeção: a cabeça (e a hitbox dela) em dobro, crescendo do pescoço para cima. */
  bigHead: 2,
  /** Invisíveis: aparecem por este tempo depois de atirar (s), e a menos disto (m) a IA nota mesmo assim. */
  invisibleShowS: 1,
  invisibleNearM: 2,
} as const;

type MutableMods = { -readonly [K in keyof MatchMods]: MatchMods[K] };

export class ChaosState {
  /** Os fixos da receita (bits). */
  readonly fixed: number;
  /** Quantos a Roleta mantém ligados (0 = sem Roleta). */
  readonly count: number;
  readonly everyTicks: number;
  readonly warnTicks: number;
  /** [0] a máscara ativa, [1] a próxima, [2] ticks até a troca (-1 = sem Roleta ou antes da largada). */
  readonly masks = new Int32Array(3);
  /** A máscara já aplicada no perfil e nas regras (fora do estado: sai das `masks`). */
  applied = -1;
  /** M9 (fase 1b): o `SimState.chaosScale` tem algum valor diferente de 1 (fora do estado: só poupa o `fill`). */
  scaled = false;
  /**
   * Só o amigo online: a máscara do snapshot mais novo, que vale para a predição do próprio movimento (a view mostra a
   * do snapshot atrasado, ~100 ms antes). -1 = a das `masks` (o host e as sims sem rede).
   */
  predictMask = -1;
  /** Perfis por gravidade (normal, lunar, pesada) × velocidade (normal, 1,5x): índice `g * 2 + v`. */
  readonly profiles: readonly MovementProfile[];
  /** Os bits que a regra de arma da receita já liga (só na cabeça, um tiro mata): a Roleta não sorteia o que conflita. */
  readonly baseBits: number;
  /** As regras de arma da partida (sem modificador) e a cópia que a máscara liga (`ctx.mods` aponta para ela). */
  readonly baseMods: MatchMods;
  readonly mods: MutableMods;

  constructor(recipe: MatchRecipe, base: MovementProfile, mods: MatchMods, hz: number) {
    let fixed = 0;
    for (const id of recipe.modifiers ?? []) fixed |= MOD[id];
    this.fixed = fixed;
    this.count = recipe.chaos === undefined ? 0 : (recipe.chaos.count ?? CHAOS_DEFAULTS.count);
    this.everyTicks = secondsToTicks(recipe.chaos?.everyS ?? CHAOS_DEFAULTS.everyS, hz);
    this.warnTicks = secondsToTicks(CHAOS_DEFAULTS.warnS, hz);
    this.masks[0] = fixed;
    this.masks[1] = fixed;
    this.masks[2] = -1;
    const profiles: MovementProfile[] = [];
    for (const g of [1, CHAOS_MODS.lowGravity, CHAOS_MODS.heavyGravity]) {
      for (const v of [1, CHAOS_MODS.speed]) profiles.push(scaleProfile(base, g, v));
    }
    this.profiles = profiles;
    this.baseMods = mods;
    this.mods = { ...mods };
    this.baseBits = (mods.headshotOnly ? MOD.headshotOnly : 0) | (mods.oneShot ? MOD.oneShot : 0);
  }
}

/** A partida tem modificadores (fixos ou a Roleta)? */
export function chaosOf(recipe: MatchRecipe): boolean {
  return (recipe.modifiers?.length ?? 0) > 0 || recipe.chaos !== undefined;
}

/**
 * O perfil com a gravidade e a velocidade multiplicadas. Com menos gravidade o pulo sobe mais (a velocidade dele fica)
 * e a queda não machuca (a altura do pulo passa da queda segura); com mais, o pulo continua da mesma altura (a
 * navegação tem ligações de pulo de até 1 m), só cai mais rápido.
 */
function scaleProfile(base: MovementProfile, g: number, v: number): MovementProfile {
  if (g === 1 && v === 1) return base;
  return {
    ...base,
    walk: base.walk * v,
    sprint: base.sprint * v,
    crouch: base.crouch * v,
    accel: base.accel * v,
    ...(base.slide ? { slide: { ...base.slide, startSpeed: base.slide.startSpeed * v } } : {}),
    gravity: base.gravity * g,
    jump: g < 1 ? base.jump / g : base.jump,
    fallDamage: g < 1 ? false : base.fallDamage,
  };
}

/** O modificador está ligado agora? */
export function modOn(ctx: SimContext, bit: number): boolean {
  return ctx.chaos !== null && (ctx.chaos.masks[0]! & bit) !== 0;
}

/**
 * Aplica a máscara ativa (o perfil e as regras de arma), se mudou. O host chama a cada tick; o amigo, a cada
 * snapshot; ler um snapshot também.
 */
export function applyChaos(ctx: SimContext): void {
  const c = ctx.chaos;
  if (c === null) return;
  const mask = c.predictMask >= 0 ? c.predictMask : c.masks[0]!;
  if (c.applied === mask) return;
  c.applied = mask;
  const g = (mask & MOD.lowGravity) !== 0 ? 1 : (mask & MOD.heavyGravity) !== 0 ? 2 : 0;
  const v = (mask & MOD.speed) !== 0 ? 1 : 0;
  ctx.profile = c.profiles[g * 2 + v]!;
  ctx.figures.setHeadScale((mask & MOD.bigHead) !== 0 ? CHAOS_MODS.bigHead : 1);
  c.mods.headshotOnly = c.baseMods.headshotOnly || (mask & MOD.headshotOnly) !== 0;
  c.mods.oneShot = c.baseMods.oneShot || (mask & MOD.oneShot) !== 0;
}

/**
 * M9 (fase 1b): a escala dos modificadores de cada corpo (`SimState.chaosScale`): a da máscara ATIVA (`masks[0]`, a
 * que a view mostra; `chaosScale`), com o gigante apertado debaixo de teto baixo (`squeezedScaleAt`: um raio da grade
 * por gigante, vivo ou morto). Derivada só do estado de agora (posição, bits, controlador, tipo, máscara e grade), fora
 * do hash e do snapshot. O `step` chama duas vezes: logo depois do movimento (o tiro, a faca e o olho do tick usam a da
 * posição nova; revisão da fase 1b) e no fim, antes de sincronizar a view (a view, a IA, o histórico do tiro no
 * passado e o snapshot); a criação, a leitura de snapshot e o `commit` do amigo online também. Sem tamanho na máscara,
 * tudo fica 1 (um `fill` só na saída). Sem alocação.
 */
export function updateChaosScales(ctx: SimContext): void {
  const c = ctx.chaos;
  if (c === null) return;
  const s = ctx.s;
  const out = s.chaosScale;
  const mask = c.masks[0]! & CHAOS_SCALE_BITS;
  if (mask === 0) {
    if (c.scaled) {
      out.fill(1);
      c.scaled = false;
    }
    return;
  }
  c.scaled = true;
  // quente:
  const p = s.position;
  for (let e = 0; e < s.count; e++) {
    const k = chaosScale(mask, s.controller[e]!, s.kind[e]!);
    if (k <= 1 || s.alive[e] !== 1) {
      out[e] = k;
      continue;
    }
    const e3 = e * 3;
    out[e] = squeezedScaleAt(ctx.grid, ctx.blocks, ctx.colliders, p[e3]!, p[e3 + 1]!, p[e3 + 2]!, s.flags[e]!, k);
  }
  // fim-quente
}

/** Os bits que a Roleta pode pôr com `mask` ligada (sem os ligados e sem os que conflitam com eles). */
function poolFor(mask: number): number {
  let pool = 0;
  for (let i = 0; i < MODIFIERS.length; i++) {
    const bit = 1 << i;
    // M8 (fase 7): o Arcade só fixo na receita.
    if ((mask & bit) !== 0 || MODIFIERS[i] === 'arcade') continue;
    let ok = true;
    for (let j = 0; j < MODIFIERS.length && ok; j++) {
      if ((mask & (1 << j)) !== 0 && modifiersConflict(MODIFIERS[i]!, MODIFIERS[j]!)) ok = false;
    }
    if (ok) pool |= bit;
  }
  return pool;
}

/** Um bit sorteado da máscara (0 = vazia). */
function pickBit(ctx: SimContext, mask: number): number {
  let n = 0;
  for (let b = mask; b !== 0; b &= b - 1) n++;
  if (n === 0) return 0;
  let k = ctx.rngChaos.int(0, n);
  for (let b = mask; b !== 0; b &= b - 1) {
    const low = b & -b;
    if (k-- === 0) return low;
  }
  return 0;
}

/** O passo da Roleta (antes do movimento: a gravidade nova vale no mesmo tick) e a aplicação da máscara. */
export function chaosSystem(ctx: SimContext): void {
  const c = ctx.chaos;
  if (c === null) return;
  const phase = ctx.match.phase;
  if (c.count > 0 && (phase === 'playing' || phase === 'suddenDeath')) {
    const m = c.masks;
    if (m[2]! < 0) {
      // A largada: os primeiros sorteados. M9 (fase 4, revisão): em cima da máscara ativa (sem o dono, ela é a dos
      // fixos; com ele, o que o dono ligou ou desligou antes da largada fica).
      let mask = m[0]!;
      for (let i = 0; i < c.count; i++) mask |= pickBit(ctx, poolFor(mask | c.baseBits) & ~c.baseBits);
      m[0] = mask;
      m[1] = mask;
      m[2] = c.everyTicks;
    } else {
      m[2] = m[2]! - 1;
      // O aviso: um da Roleta (nunca um fixo) sai e outro entra.
      if (m[2] === c.warnTicks) {
        const out = pickBit(ctx, m[0]! & ~c.fixed);
        const keep = m[0]! & ~out;
        const add = pickBit(ctx, poolFor(keep | c.baseBits) & ~out & ~c.baseBits);
        m[1] = add !== 0 ? keep | add : m[0]!;
      }
      if (m[2]! <= 0) {
        m[0] = m[1]!;
        m[2] = c.everyTicks;
      }
    }
  }
  applyChaos(ctx);
}

/**
 * Troca de arma por abate: quem abateu ganha uma primária sorteada diferente da que tinha (pente e reserva cheios), na
 * mão se estava com a primária.
 */
export function swapPrimary(ctx: SimContext, k: number): void {
  const s = ctx.s;
  const base = k * WEAPON_SLOT_COUNT + WEAPON_SLOT.primary;
  const current = s.loadout[base]!;
  // Quem não tem primária (só faca, por exemplo) continua sem.
  if (current === WEAPON_NONE) return;
  const mask = ctx.rules.weaponMask[k]!;
  const allowed = (code: number): boolean => mask === 0 || (mask & (1 << code)) !== 0;
  let n = 0;
  for (const w of WEAPONS) if (w.slot === WEAPON_SLOT.primary && w.code !== current && allowed(w.code)) n++;
  if (n === 0) return;
  let pick = ctx.rngChaos.int(0, n);
  let code = -1;
  for (const w of WEAPONS) {
    if (w.slot !== WEAPON_SLOT.primary || w.code === current || !allowed(w.code)) continue;
    if (pick-- === 0) {
      code = w.code;
      break;
    }
  }
  const def = weaponDef(code);
  if (def === null) return;
  s.loadout[base] = code;
  s.slotClip[base] = def.clipSize;
  s.slotReserve[base] = def.reserve;
  if (s.slot[k] === WEAPON_SLOT.primary) {
    s.weapon[k] = code;
    s.reloadTicks[k] = 0;
    s.burstShots[k] = 0;
    s.adsAmount[k] = 0;
    s.fireCooldownS[k] = 0;
    s.switchTicks[k] = secondsToTicks(MATCH_DEFAULTS.weaponSwitchS, ctx.hz);
    ctx.events.weapon(ctx.tick, s.idOf(k), code, 'switch');
  }
}

/** Quem pode ganhar a troca de arma: bobo vivo, de pé. */
export function canSwap(ctx: SimContext, k: number): boolean {
  const s = ctx.s;
  return s.alive[k] === 1 && s.kind[k] === ENTITY_KIND.bobo && (s.flags[k]! & ENTITY_FLAG.dead) === 0;
}
