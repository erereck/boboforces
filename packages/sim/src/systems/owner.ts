import { builtinBotRef, MODIFIERS, modifiersConflict, type MatchRecipe, type ModifierId } from '@boboforces/format';
import { WEAPON_SLOT_COUNT } from '@boboforces/input';
import { u16ToYaw, yawToU16 } from '@boboforces/shared';
import { METRICS } from '../config/metrics.ts';
import { MATCH_DEFAULTS } from '../config/rules.ts';
import { isPrimaryWeapon, paintPrimaryFor, WEAPON_SLOT, WEAPONS, weaponDef } from '../config/weapons.ts';
import {
  BOT_CONTROLLER_BASE,
  MAX_BOTS,
  MAX_ENTITIES,
  RECENT_ATTACKERS,
  secondsToTicks,
  ZOMBIE_CONTROLLER_BASE,
} from '../constants.ts';
import { isBody, WEAPON_NONE, type SimContext } from '../context.ts';
import { ENTITY_FLAG, ENTITY_KIND, NULL_ENTITY, type EntityId } from '../entity.ts';
import { expandRecipe, type ControllerSlot } from '../recipe.ts';
import type { StateField } from '../state.ts';
import type { SimView } from '../view.ts';
import { MOD } from './chaos.ts';
import { createPartyState, partyActive } from './party.ts';
import { respawn } from './life.ts';

/**
 * M9 (fase 4): as Ferramentas do Dono (gameplay.md "Bobo Sandbox completo", estilo gmod) na sim, sem UI.
 *
 * - **Ligar:** `SimConfig.owner` (uma opção de criação, não da receita: a receita é a mesma com ou sem o dono). Sem
 *   ela, nada muda em lugar nenhum (os goldens ficam iguais). Com ela, a sim cria a reserva, o estado dos modificadores
 *   desde o tick 0 (para o dono ligar um ao vivo) e põe o estado do dono no hash e no snapshot.
 * - **A reserva:** `reserve` bots dormentes (o Normal Bob, no time 0) alocados na criação DEPOIS dos bots da receita,
 *   nos controladores seguintes (`ownerReserveSlots`, a mesma conta na sim e na IA: um cliente que cria a mesma sim
 *   tem as mesmas entidades). Dormente = morto sem contagem de renascer (`respawnTicks` -1): o `spawnSystem` nunca o
 *   traz de volta; só o `spawnBot`.
 * - **Os comandos** (`OwnerCommand`) entram por `Sim.command` numa fila e valem num ponto só do passo: no começo do
 *   próximo `step`, antes das entradas, na ordem em que chegaram. Cada um solta um evento `owner` (ok ou o motivo da
 *   recusa). Determinístico: o roteiro (`createOwnerScript`) com os mesmos ticks dá o mesmo hash.
 * - **Os alvos:** só bots (controlador de bot; humano é recusado com `human`), em jogo (vivo ou esperando o respawn;
 *   o dormente é recusado com `dormant`). `remove` vale para qualquer bot: o da receita também vira dormente e só
 *   volta pelo `spawnBot` (que usa a reserva primeiro e, sem ela, os removidos).
 * - **Os modos:** só os de respawn livre (Warfare, Paintball, Training, Sandbox; `ownerAllowed`, que a UI consulta
 *   antes de criar a sim). No Bobo Zombies, nas rodadas, no Royale e nos modos de festa quem volta e quem conta são as
 *   regras do modo (que trariam um dormente de volta ou o contariam como jogador): a sim recusa a opção na criação.
 * - **Só offline (por enquanto):** com o dono, a sim tem a reserva e o estado dos modificadores sempre; o layout da
 *   rede sai da sim (`createNetLayout`) e o cliente não sabe da opção. Até o protocolo levar a opção (fase 5), o host
 *   e o cliente online recusam uma sim com o dono (assert no `createNetHost` e no `createClientDriver`).
 * - **O Sandbox:** no `spawnBot` e no `setTeam`, o bot passa às regras do time de destino (a vida e as armas do time;
 *   a regra do próprio bot ganha). No `setTeam` com o bot vivo: a vida máxima muda na hora sem curar (a vida fica,
 *   cortada no teto novo) e só as armas que o time novo não libera trocam na hora (a primária vira a 1ª liberada, as
 *   outras saem); o resto vem no próximo renascer. Uma arma dada antes (`giveWeapon`) que o time novo não libera some.
 * - **O Paintball:** o `giveWeapon` dá a versão de tinta da arma (a escolha fica, e o renascer dá a de tinta de novo).
 */

/** Os números das ferramentas. */
export const OWNER = {
  /** Teto da reserva de bots dormentes por partida (AH7: o Sandbox separa 8; o teto de bots do motor também vale). */
  maxReserve: 16,
  /** Comandos esperando o próximo passo (com a fila cheia, `command` recusa). */
  maxQueue: 32,
  /** "Criar bot onde mira": o nó livre mais perto do ponto, até esta distância (m). */
  placeMaxDistM: 8,
  /** Quantos nós testar, do mais perto ao mais longe, atrás de um sem ninguém em cima. */
  placeTries: 16,
  /** Um nó está ocupado com um corpo a menos disto (m, no plano) e menos de uma altura de corpo acima ou abaixo. */
  placeClearM: 0.8,
} as const;

/** Os comandos do dono (o `kind` de `OwnerCommand`; o índice é estável: vai no replay). */
export const OWNER_COMMANDS = ['spawnBot', 'remove', 'freeze', 'setTeam', 'giveWeapon', 'setModifier'] as const;
export type OwnerCommandKind = (typeof OWNER_COMMANDS)[number];

/**
 * Por que um comando foi recusado (`none` = valeu). `ended`: a partida acabou. `entity`: o alvo não existe mais ou não
 * é bobo. `human`: o alvo é humano (as ferramentas são só para bots). `dormant`: o bot está fora de jogo. `team`: o
 * time não existe na receita. `weapon`: não é uma primária. `reserve`: nenhum bot dormente sobrando. `place`: nenhum
 * lugar livre perto do ponto. `modifier`: modificador desconhecido ou fixo da receita (o Arcade). `conflict`: conflita
 * com uma regra fixa da receita.
 */
export const OWNER_FAILS = [
  'none',
  'ended',
  'entity',
  'human',
  'dormant',
  'team',
  'weapon',
  'reserve',
  'place',
  'modifier',
  'conflict',
] as const;
export type OwnerFail = (typeof OWNER_FAILS)[number];

/**
 * Um comando do dono. Posições em metros (os pés), `yaw` em radianos, `team` 0..3 (precisa existir na receita),
 * `weapon` o código de uma primária (`WEAPON_CODE`). `setModifier` liga ou desliga um modificador ao vivo: ligar um
 * desliga o que conflita com ele (`MODIFIER_CONFLICTS`).
 */
export type OwnerCommand =
  | {
      readonly kind: 'spawnBot';
      readonly team: number;
      readonly x: number;
      readonly y: number;
      readonly z: number;
      readonly yaw: number;
    }
  | { readonly kind: 'remove'; readonly entity: EntityId }
  | { readonly kind: 'freeze'; readonly entity: EntityId; readonly on: boolean }
  | { readonly kind: 'setTeam'; readonly entity: EntityId; readonly team: number }
  | { readonly kind: 'giveWeapon'; readonly entity: EntityId; readonly weapon: number }
  | { readonly kind: 'setModifier'; readonly modifier: ModifierId; readonly on: boolean };

/** A opção de criação (`SimConfig.owner`). */
export interface SimOwnerConfig {
  /** Bots dormentes na reserva (0..`OWNER.maxReserve`, cortado no teto de bots do motor menos os da receita). */
  readonly reserve: number;
}

/** O que a UI lê do dono (`SimView.owner`; SOMENTE LEITURA). */
export interface OwnerView {
  /** Quantos bots na reserva e o controlador do 1º (os outros seguem em ordem). */
  readonly reserve: number;
  readonly reserveBase: number;
  /** 1 = o bot (índice de entidade) está congelado. */
  readonly frozen: Uint8Array;
}

/** O controlador do 1º bot da reserva: o seguinte ao último bot da receita (com reserva vazia também). */
export function ownerReserveBase(recipe: MatchRecipe, humans: number): number {
  let bots = 0;
  for (const slot of expandRecipe(recipe, humans)) if (slot.bot !== null) bots++;
  return BOT_CONTROLLER_BASE + bots;
}

/** Quantos bots a reserva tem de verdade (o pedido cortado nos tetos). */
export function ownerReserveCount(recipe: MatchRecipe, humans: number, reserve: number): number {
  const bots = ownerReserveBase(recipe, humans) - BOT_CONTROLLER_BASE;
  const want = Number.isFinite(reserve) ? Math.floor(reserve) : 0;
  return Math.max(0, Math.min(want, OWNER.maxReserve, MAX_BOTS - bots));
}

/**
 * Os controladores da reserva, depois dos bots da receita (o `botIndex` continua a conta): o Normal Bob, no time 0. A
 * sim e a IA usam a mesma função, então o bot `i` da reserva é o mesmo controlador nas duas (e no cliente online).
 */
export function ownerReserveSlots(recipe: MatchRecipe, humans: number, reserve: number): ControllerSlot[] {
  const base = ownerReserveBase(recipe, humans);
  const n = ownerReserveCount(recipe, humans, reserve);
  const ref = builtinBotRef('normal');
  const out: ControllerSlot[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ controller: base + i, team: 0, bot: ref, botIndex: base - BOT_CONTROLLER_BASE + i });
  }
  return out;
}

/**
 * O bot está fora de jogo pelo dono (morto e sem contagem de renascer)? Os da reserva começam assim. A UI (fase 5) usa
 * para tirar os dormentes das listas por jogador (placar, marcadores, Aquário): eles existem na sim desde a criação.
 */
export function isOwnerDormant(view: Pick<SimView, 'flags' | 'respawnTicks'>, e: number): boolean {
  return (view.flags[e]! & ENTITY_FLAG.dead) !== 0 && view.respawnTicks[e]! < 0;
}

/**
 * As Ferramentas do Dono cabem na receita? Só nos modos de respawn livre: fora o Bobo Zombies, as rodadas (BoboStrike
 * e Jugg Fixo), o Royale e os modos de festa (Gun Game, Infection, Juggernaut). Puro: a UI consulta antes de criar a
 * sim (o `createSim` recusa os outros).
 */
export function ownerAllowed(recipe: MatchRecipe): boolean {
  const mode = recipe.mode;
  return mode !== 'zombies' && mode !== 'strike' && mode !== 'royale.mini' && !partyActive(createPartyState(recipe));
}

/** O estado do dono (o que vai no hash e no snapshot está em `fields`) e a fila de comandos. */
export class OwnerState implements OwnerView {
  readonly reserve: number;
  readonly reserveBase: number;
  /** Times da receita (o `team` dos comandos fica em 0..teams-1). */
  readonly teams: number;
  readonly frozen = new Uint8Array(MAX_ENTITIES);
  /**
   * O congelado e as armas liberadas de cada bobo (`EntityRules.weaponMask`, que o `giveWeapon` alarga): no hash e no
   * snapshot só com o dono (o resto do estado do dono já mora no estado: o time, a primária, o `respawnTicks` -1).
   */
  readonly fields: readonly StateField[];
  /** A fila (FIFO) e o número de cada comando; `nextSeq` é o próximo número (fora do estado: só rotula o evento). */
  readonly queue: OwnerCommand[] = [];
  readonly seqs: number[] = [];
  nextSeq = 1;
  /**
   * 1 = o bot entrou por um `spawnBot` neste passo: a entrada dele fica de fora (o quadro da IA é de quando ele
   * estava fora de jogo; o rumo pedido vale, e o cérebro pega o rumo da view no próximo tick). Fora do estado: só vive
   * dentro do passo (`ownerInputsDone` limpa).
   */
  readonly fresh = new Uint8Array(MAX_ENTITIES);
  readonly freshList = new Int32Array(OWNER.maxQueue);
  freshCount = 0;
  /**
   * M9 (fase 4, revisão): no Sandbox, refaz as regras do bot `e` para o time `team` (a vida e as armas do time, a regra
   * do próprio bot ganha): o `createSim` liga, com a mesma conta da criação. `null` fora do Sandbox.
   */
  teamRules: ((e: number, team: number) => void) | null = null;

  constructor(reserve: number, reserveBase: number, teams: number, weaponMask: Uint16Array) {
    this.reserve = reserve;
    this.reserveBase = reserveBase;
    this.teams = teams;
    this.fields = [
      { name: 'ownerFrozen', array: this.frozen, stride: 1 },
      { name: 'weaponMask', array: weaponMask, stride: 1 },
    ];
  }
}

/** A sim ignora a entrada de `e` neste passo? (Congelado, ou acabou de entrar pelo `spawnBot`.) */
export function ownerHoldsInput(o: OwnerState, e: number): boolean {
  return o.frozen[e] !== 0 || o.fresh[e] !== 0;
}

/** Depois das entradas do passo: os que entraram pelo `spawnBot` voltam a receber entrada no próximo. */
export function ownerInputsDone(o: OwnerState): void {
  for (let i = 0; i < o.freshCount; i++) o.fresh[o.freshList[i]!] = 0;
  o.freshCount = 0;
}

/** Enfileira um comando (cópia: quem chama pode reaproveitar o objeto). Devolve o número dele, ou -1 (fila cheia). */
export function enqueueOwner(o: OwnerState, cmd: OwnerCommand): number {
  if (o.queue.length >= OWNER.maxQueue || !(OWNER_COMMANDS as readonly string[]).includes(cmd.kind)) return -1;
  const seq = o.nextSeq;
  o.nextSeq = (seq % 0x7fffffff) + 1;
  o.queue.push({ ...cmd });
  o.seqs.push(seq);
  return seq;
}

/** Passo 0b (no começo do `step`, antes das entradas): aplica a fila inteira, em ordem. */
export function ownerSystem(ctx: SimContext): void {
  const o = ctx.owner;
  if (o === null || o.queue.length === 0) return;
  for (let i = 0; i < o.queue.length; i++) applyCommand(ctx, o, o.queue[i]!, o.seqs[i]!);
  o.queue.length = 0;
  o.seqs.length = 0;
}

const F = ENTITY_FLAG;
const spot = new Float64Array(3);
/** Rascunho do "criar bot onde mira": os nós candidatos mais perto e a distância² de cada um. */
const candNode = new Int32Array(OWNER.placeTries);
const candD2 = new Float64Array(OWNER.placeTries);
/** O motivo da última recusa de `botTarget` ou `spawnBot` (rascunho: sem alocar um resultado por comando). */
let targetFail: OwnerFail = 'none';

/** Aplica um comando e solta o evento `owner` (o alvo é o bot; no `spawnBot`, o que entrou). */
function applyCommand(ctx: SimContext, o: OwnerState, cmd: OwnerCommand, seq: number): void {
  const s = ctx.s;
  let e = -1;
  let reason: OwnerFail = 'none';
  if (ctx.match.phase === 'ended') reason = 'ended';
  else if (cmd.kind === 'spawnBot') {
    e = spawnBot(ctx, o, cmd.team, cmd.x, cmd.y, cmd.z, cmd.yaw);
    if (e < 0) reason = targetFail;
  } else if (cmd.kind === 'setModifier') {
    reason = setModifier(ctx, cmd.modifier, cmd.on === true);
  } else {
    e = botTarget(ctx, cmd.entity);
    if (e < 0) reason = targetFail;
    else if (cmd.kind === 'remove') removeBot(ctx, o, e);
    else if (cmd.kind === 'freeze') freezeBot(ctx, o, e, cmd.on === true);
    else if (cmd.kind === 'setTeam') {
      if (validTeam(o, cmd.team)) setTeam(ctx, o, e, cmd.team);
      else reason = 'team';
    } else if (Number.isInteger(cmd.weapon) && isPrimaryWeapon(cmd.weapon)) givePrimary(ctx, e, cmd.weapon);
    else reason = 'weapon';
  }
  // A recusa com alvo diz qual era (a UI mostra em quem); o `spawnBot` recusado e o `setModifier` não têm.
  const entity = e >= 0 ? s.idOf(e) : 'entity' in cmd ? cmd.entity : NULL_ENTITY;
  ctx.events.owner(ctx.tick, seq, cmd.kind, entity, reason === 'none', reason);
}

function validTeam(o: OwnerState, team: number): boolean {
  return Number.isInteger(team) && team >= 0 && team < o.teams;
}

/** O índice do bot `id` se ele serve de alvo (bot, existe, em jogo); senão -1 e o motivo em `targetFail`. */
function botTarget(ctx: SimContext, id: EntityId): number {
  const s = ctx.s;
  if (!Number.isInteger(id) || !s.isCurrent(id) || s.kind[id & 0xffff] !== ENTITY_KIND.bobo) {
    targetFail = 'entity';
    return -1;
  }
  const e = id & 0xffff;
  const c = s.controller[e]!;
  if (c < BOT_CONTROLLER_BASE || c >= ZOMBIE_CONTROLLER_BASE) {
    targetFail = 'human';
    return -1;
  }
  if (isOwnerDormant(s, e)) {
    targetFail = 'dormant';
    return -1;
  }
  return e;
}

/** O 1º bot dormente: os da reserva primeiro (em ordem), depois os da receita que o dono tirou. -1 = nenhum. */
function firstDormant(ctx: SimContext, o: OwnerState): number {
  const s = ctx.s;
  const end = o.reserveBase + o.reserve;
  for (let pass = 0; pass < 2; pass++) {
    const from = pass === 0 ? o.reserveBase : BOT_CONTROLLER_BASE;
    const to = pass === 0 ? end : o.reserveBase;
    for (let c = from; c < to; c++) {
      const id = s.controllerEntity[c]!;
      if (id === NULL_ENTITY) continue;
      const e = id & 0xffff;
      if (s.alive[e] === 1 && s.kind[e] === ENTITY_KIND.bobo && isOwnerDormant(s, e)) return e;
    }
  }
  return -1;
}

/** "Criar bot onde mira": o 1º dormente entra no lugar livre mais perto do ponto, no time pedido. -1 = recusado. */
function spawnBot(ctx: SimContext, o: OwnerState, team: number, x: number, y: number, z: number, yaw: number): number {
  if (!validTeam(o, team)) {
    targetFail = 'team';
    return -1;
  }
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || !Number.isFinite(yaw)) {
    targetFail = 'place';
    return -1;
  }
  const e = firstDormant(ctx, o);
  if (e < 0) {
    targetFail = 'reserve';
    return -1;
  }
  if (!findSpot(ctx, x, y, z)) {
    targetFail = 'place';
    return -1;
  }
  const s = ctx.s;
  s.team[e] = team;
  o.frozen[e] = 0;
  // No Sandbox, as regras do time de destino antes do renascer (a vida e as armas dele já valem no loadout).
  o.teamRules?.(e, team);
  // O renascer de sempre (vida, armas, proteção, o evento `spawn`) e depois o lugar e o rumo pedidos.
  respawn(ctx, e, 0);
  const e3 = e * 3;
  s.position[e3] = spot[0]!;
  s.position[e3 + 1] = spot[1]!;
  s.position[e3 + 2] = spot[2]!;
  s.prevPosition[e3] = spot[0]!;
  s.prevPosition[e3 + 1] = spot[1]!;
  s.prevPosition[e3 + 2] = spot[2]!;
  // O rumo no passo da entrada (u16, [0, 2π)): o mesmo que um quadro diria e o que a rede leva.
  const facing = u16ToYaw(yawToU16(yaw));
  s.yaw[e] = facing;
  s.prevYaw[e] = facing;
  s.airPeakY[e] = spot[1]!;
  // Neste passo a entrada dele fica de fora (o quadro velho da IA viraria o rumo); no próximo, o cérebro pega o da view.
  if (o.fresh[e] === 0 && o.freshCount < o.freshList.length) {
    o.fresh[e] = 1;
    o.freshList[o.freshCount++] = e;
  }
  return e;
}

/**
 * Troca o time do bot. No Sandbox, ele passa às regras do time novo: a vida máxima na hora (sem curar: a vida fica,
 * cortada no teto novo) e as armas que o time novo não libera trocam na hora (`reequip`); o resto no próximo renascer.
 */
function setTeam(ctx: SimContext, o: OwnerState, e: number, team: number): void {
  const s = ctx.s;
  if (s.team[e] === team) return;
  s.team[e] = team;
  if (o.teamRules === null) return;
  o.teamRules(e, team);
  if ((s.flags[e]! & F.dead) !== 0) return;
  s.health[e] = Math.min(s.health[e]!, ctx.rules.maxHp[e]!);
  reequip(ctx, e);
}

/** A 1ª primária que a máscara libera, ou `WEAPON_NONE`. */
function firstAllowedPrimary(mask: number): number {
  for (let code = 0; code < WEAPONS.length; code++)
    if ((mask & (1 << code)) !== 0 && isPrimaryWeapon(code)) return code;
  return WEAPON_NONE;
}

/**
 * As armas do loadout que as regras de agora não liberam: a primária vira a 1ª liberada (cheia), as outras saem; a mão
 * vai para o 1º slot que sobrou se a dela saiu. Sem restrição (máscara 0), nada muda.
 */
function reequip(ctx: SimContext, e: number): void {
  const s = ctx.s;
  const mask = ctx.rules.weaponMask[e]!;
  if (mask === 0) return;
  const k = e * WEAPON_SLOT_COUNT;
  let changed = false;
  for (let slot = 0; slot < WEAPON_SLOT_COUNT; slot++) {
    const code = s.loadout[k + slot]!;
    if (code === WEAPON_NONE || (mask & (1 << code)) !== 0) continue;
    const next = slot === WEAPON_SLOT.primary ? firstAllowedPrimary(mask) : WEAPON_NONE;
    const def = weaponDef(next);
    s.loadout[k + slot] = next;
    s.slotClip[k + slot] = def ? def.clipSize : 0;
    s.slotReserve[k + slot] = def ? def.reserve : 0;
    if (slot === WEAPON_SLOT.primary && next !== WEAPON_NONE) s.primaryChoice[e] = next;
    changed = true;
  }
  if (!changed) return;
  if (s.loadout[k + s.slot[e]!] === WEAPON_NONE) {
    let first = 0;
    while (first < WEAPON_SLOT_COUNT - 1 && s.loadout[k + first] === WEAPON_NONE) first++;
    s.slot[e] = first;
  }
  s.weapon[e] = s.loadout[k + s.slot[e]!]!;
  s.reloadTicks[e] = 0;
  s.burstShots[e] = 0;
  s.adsAmount[e] = 0;
  s.cookTicks[e] = -1;
  s.quickNade[e] = 0;
  s.switchTicks[e] = secondsToTicks(MATCH_DEFAULTS.weaponSwitchS, ctx.hz);
  ctx.events.weapon(ctx.tick, s.idOf(e), s.weapon[e]!, 'switch');
}

/**
 * O lugar (em `spot`, pés em metros): com navegação, o nó em pé do componente principal mais perto do ponto (até
 * `placeMaxDistM`) dentro da área jogável e sem corpo em cima, testando até `placeTries` nós em ordem de distância
 * (empate: o de índice menor); sem navegação (testes), o ponto de spawn mais perto. `false` = nenhum.
 */
function findSpot(ctx: SimContext, x: number, y: number, z: number): boolean {
  const nav = ctx.nav;
  if (nav === null) {
    let best = -1;
    let bestD2 = Infinity;
    for (let i = 0; i < ctx.spawns.length; i++) {
      const sp = ctx.spawns[i]!;
      const d2 = (sp.x - x) ** 2 + (sp.y - y) ** 2 + (sp.z - z) ** 2;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = i;
      }
    }
    const sp = ctx.spawns[best]!;
    spot[0] = sp.x;
    spot[1] = sp.y;
    spot[2] = sp.z;
    return true;
  }
  // Uma passada pelos nós guarda os `placeTries` mais perto (em ordem; no empate, o de índice menor fica na frente).
  const max2 = OWNER.placeMaxDistM * OWNER.placeMaxDistM;
  const tries = OWNER.placeTries;
  const area = ctx.playArea;
  const half = METRICS.aabbWidth / 2;
  let found = 0;
  for (let node = 0; node < nav.nodeCount; node++) {
    if (nav.clearance[node] !== 1 || nav.component[node] !== ctx.navMainComponent) continue;
    nav.nodePosition(node, spot, 0);
    // As paredes invisíveis da área jogável (o movimento desconta a meia largura da caixa).
    if (
      area !== null &&
      (spot[0]! < area.minX + half ||
        spot[0]! > area.maxX - half ||
        spot[2]! < area.minZ + half ||
        spot[2]! > area.maxZ - half)
    )
      continue;
    const d2 = (spot[0]! - x) ** 2 + (spot[1]! - y) ** 2 + (spot[2]! - z) ** 2;
    if (d2 > max2 || (found === tries && d2 >= candD2[tries - 1]!)) continue;
    let k = found < tries ? found++ : tries - 1;
    while (k > 0 && candD2[k - 1]! > d2) {
      candD2[k] = candD2[k - 1]!;
      candNode[k] = candNode[k - 1]!;
      k--;
    }
    candD2[k] = d2;
    candNode[k] = node;
  }
  for (let i = 0; i < found; i++) {
    nav.nodePosition(candNode[i]!, spot, 0);
    if (!occupied(ctx, spot[0]!, spot[1]!, spot[2]!)) return true;
  }
  return false;
}

/** Algum corpo em jogo em cima do ponto (pés)? */
function occupied(ctx: SimContext, x: number, y: number, z: number): boolean {
  const s = ctx.s;
  const clear2 = OWNER.placeClearM * OWNER.placeClearM;
  for (let j = 0; j < s.count; j++) {
    if (s.alive[j] === 0 || !isBody(s.kind[j]!) || (s.flags[j]! & F.dead) !== 0) continue;
    const dx = s.position[j * 3]! - x;
    const dz = s.position[j * 3 + 2]! - z;
    if (dx * dx + dz * dz < clear2 && Math.abs(s.position[j * 3 + 1]! - y) < METRICS.bodyHeight) return true;
  }
  return false;
}

/**
 * Congela (ou solta) o bot: a sim troca a entrada dele por nenhuma (`applyInputs`). Congelar com a granada cozinhando
 * põe o pino de volta (soltar o botão jogaria a granada).
 */
function freezeBot(ctx: SimContext, o: OwnerState, e: number, on: boolean): void {
  o.frozen[e] = on ? 1 : 0;
  if (on) {
    ctx.s.cookTicks[e] = -1;
    ctx.s.quickNade[e] = 0;
  }
}

/**
 * Tira o bot de jogo (sem morte no placar nem evento `kill`): dormente até um `spawnBot`. O que ele jogou e ainda voa
 * some junto, e os abates que ainda seriam dele (o crédito do plano de morte, a assistência) deixam de ser: quem saiu
 * não pontua.
 */
function removeBot(ctx: SimContext, o: OwnerState, e: number): void {
  const s = ctx.s;
  const e3 = e * 3;
  const id = s.idOf(e);
  for (let p = s.projCount - 1; p >= 0; p--) if (s.projAlive[p] === 1 && s.projOwner[p] === id) s.freeProjectile(p);
  for (let j = 0; j < s.count; j++) if (s.lastAttacker[j] === id) s.lastAttacker[j] = NULL_ENTITY;
  for (let r = 0; r < s.count * RECENT_ATTACKERS; r++) if (s.recentFrom[r] === id) s.recentFrom[r] = NULL_ENTITY;
  s.flags[e] = (s.flags[e]! & F.onGround) | F.dead;
  s.health[e] = 0;
  s.velocity[e3] = 0;
  s.velocity[e3 + 1] = 0;
  s.velocity[e3 + 2] = 0;
  s.respawnTicks[e] = -1;
  s.spawnProtectTicks[e] = 0;
  // A granada cozinhando some com ele (sair do jogo não é morrer: nada cai da mão).
  s.cookTicks[e] = -1;
  s.quickNade[e] = 0;
  s.reloadTicks[e] = 0;
  s.slideTicks[e] = 0;
  s.adsAmount[e] = 0;
  s.burstShots[e] = 0;
  s.recoilPitch[e] = 0;
  s.recoilYaw[e] = 0;
  o.frozen[e] = 0;
}

/**
 * Dá a primária `code` (cheia, na mão; a mesma troca da parede do Zombies) e faz ela ficar: vira a escolha do próximo
 * spawn e entra nas armas liberadas do bot (quando a regra dele restringe). No Paintball vai a versão de tinta dela
 * (a escolha fica com a de verdade: o renascer dá a de tinta de novo, `paintLoadout`).
 */
function givePrimary(ctx: SimContext, e: number, code: number): void {
  const s = ctx.s;
  const live = ctx.paintHits > 0 ? paintPrimaryFor(code) : code;
  const def = weaponDef(live)!;
  const k = e * WEAPON_SLOT_COUNT + WEAPON_SLOT.primary;
  s.primaryChoice[e] = code;
  const mask = ctx.rules.weaponMask[e]!;
  if (mask !== 0) ctx.rules.weaponMask[e] = mask | (1 << code);
  if ((s.flags[e]! & F.dead) !== 0) return;
  s.loadout[k] = live;
  s.slotClip[k] = def.clipSize;
  s.slotReserve[k] = def.reserve;
  s.slot[e] = WEAPON_SLOT.primary;
  s.weapon[e] = live;
  s.reloadTicks[e] = 0;
  s.burstShots[e] = 0;
  s.adsAmount[e] = 0;
  s.fireCooldownS[e] = 0;
  s.cookTicks[e] = -1;
  s.quickNade[e] = 0;
  s.switchTicks[e] = secondsToTicks(MATCH_DEFAULTS.weaponSwitchS, ctx.hz);
  ctx.events.weapon(ctx.tick, s.idOf(e), live, 'switch');
}

/**
 * Liga ou desliga um modificador ao vivo (na máscara ativa e na próxima da Roleta). Ligar desliga os que conflitam
 * com ele; um conflito com regra fixa da receita (o "um tiro mata" das armas, o Arcade) recusa. O Arcade não muda ao
 * vivo (o perfil e o estado dele saem da receita), e o "só na cabeça" e o "um tiro mata" que vêm das regras de arma
 * da receita não desligam (`conflict`: a regra da receita manda).
 */
function setModifier(ctx: SimContext, id: ModifierId, on: boolean): OwnerFail {
  const c = ctx.chaos;
  const i = (MODIFIERS as readonly string[]).indexOf(id);
  if (c === null || i < 0 || id === 'arcade') return 'modifier';
  const bit = MOD[id];
  const m = c.masks;
  if (!on) {
    if ((c.baseBits & bit) !== 0) return 'conflict';
    m[0] = m[0]! & ~bit;
    m[1] = m[1]! & ~bit;
    return 'none';
  }
  let off = 0;
  for (let j = 0; j < MODIFIERS.length; j++) {
    const other = MODIFIERS[j]!;
    const b = 1 << j;
    if (j === i || !modifiersConflict(id, other)) continue;
    if ((c.baseBits & b) !== 0 || (other === 'arcade' && ((m[0]! | m[1]!) & b) !== 0)) return 'conflict';
    off |= b;
  }
  m[0] = (m[0]! & ~off) | bit;
  m[1] = (m[1]! & ~off) | bit;
  return 'none';
}
