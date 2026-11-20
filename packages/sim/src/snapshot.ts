import { RNG_STATE_WORDS, type BitReader, type BitWriter, type StateHasher } from '@boboforces/shared';
import { MAX_CONTROLLERS_WITH_ZOMBIES, MAX_TEAMS } from './constants.ts';
import type { SimContext } from './context.ts';
import type { StateArray } from './state.ts';
import type { MatchPhase } from './view.ts';
import { partyActive, syncJuggRules } from './systems/party.ts';
import { applyChaos } from './systems/chaos.ts';

/**
 * Snapshot simples (M0) e hash do estado. Os dois percorrem a MESMA lista (`SimState.fields`, na ordem fixa) até
 * `count`, mais partida, RNGs e controladores. O snapshot é completo e sem perda (f64 como f64): ler um snapshot numa sim
 * criada com a mesma receita e o mesmo mapa e seguir com os mesmos inputs dá o mesmo hash. Delta contra baseline e
 * quantização para a rede ficam para o M5.
 */

const SNAPSHOT_MAGIC = 0x50414e53; // 'SNAP'
// 2: `fireCooldownS` (f64, segundos) no lugar de `fireCooldownTicks` (i16).
// 3 (M1): controladores dos zumbis (68..131) no fim da tabela de controladores.
// 4 (M2): loadout e munição por slot, ADS e rajada (fase 1 das armas).
// 5 (M2): granada cozinhando e o pool de projéteis (fase 1b).
// 6 (M2): contagem, vencedor do FFA, assistências e agressores recentes (fase 2a).
// 7 (M2): caixinhas de munição e a contagem do Destravar (fase 2b).
// 9 (M3, fase 3d): janelas com barricada e portas pagas; pontos de conserto da onda.
// 19 (M8, fase 7): os campos do Arcade (só com ele).
const SNAPSHOT_VERSION = 19;

const PHASES: readonly MatchPhase[] = ['warmup', 'playing', 'ended', 'suddenDeath'];

const rngScratch = new Uint32Array(RNG_STATE_WORDS);

export function hashState(ctx: SimContext, h: StateHasher): number {
  const s = ctx.s;
  h.reset();
  h.u32(ctx.tick).u32(s.count);
  h.u8(PHASES.indexOf(ctx.match.phase)).i32(ctx.match.ticksLeft).i32(ctx.match.winnerTeam);
  h.i32(ctx.match.countdownTicks).u32(ctx.match.winnerEntity);
  for (let t = 0; t < MAX_TEAMS; t++) h.i32(ctx.match.teamScore[t]!);
  ctx.rngSpawn.saveState(rngScratch);
  h.bytes(rngScratch);
  ctx.rngWeapons.saveState(rngScratch);
  h.bytes(rngScratch);
  for (const f of s.fields) h.bytes(f.array.subarray(0, s.count * f.stride));
  h.u32(s.projCount);
  for (const f of s.projectileFields) h.bytes(f.array.subarray(0, s.projCount * f.stride));
  h.u32(s.pickCount);
  for (const f of s.pickupFields) h.bytes(f.array.subarray(0, s.pickCount * f.stride));
  h.bytes(s.controllerEntity);
  // M3 (fase 2a): só no Bobo Zombies (o hash dos outros modos não muda).
  if (ctx.zombiesMode) {
    const w = ctx.waves;
    h.i32(w.wave).i32(w.resting).i32(w.restTicks).i32(w.toSpawn).i32(w.spawnTicks).i32(w.waveHp);
    h.i32(Math.round(w.runChance * 1e6))
      .i32(w.left)
      .u32(w.lastZombie)
      .i32(w.selfRevivesLeft)
      .i32(w.bossPending)
      .i32(w.drops)
      .i32(w.doubleTicks)
      .i32(w.instaTicks);
    ctx.rngZombies.saveState(rngScratch);
    h.bytes(rngScratch);
    for (const f of s.zombieFields) h.bytes(f.array.subarray(0, s.count * f.stride));
  }
  // M3 (fase 3d): janelas e portas (só nos mapas que têm: o hash dos outros não muda).
  const mo = ctx.mapObjects;
  if (mo !== null) {
    h.bytes(mo.planks).bytes(mo.tearTicks).bytes(mo.repairTicks).bytes(mo.repairer).bytes(mo.doorOpen);
    if (mo.boxSpots > 0) h.bytes(mo.boxState).bytes(mo.boxUser);
  }
  // M6 (fase 1): os pontos do Domination (só nele: o hash dos outros modos não muda).
  const cp = ctx.domination;
  if (cp !== null) h.bytes(cp.owner).bytes(cp.progress).bytes(cp.scoreTicks);
  // M6 (fase 2): o Gun Game e o Infection (só neles). Fase 3: o Juggernaut, com o relógio do ponto do Jugg.
  const party = ctx.party;
  if (partyActive(party)) {
    h.i32(party.started ? 1 : 0)
      .i32(party.winnerEntity | 0)
      .i32(party.winnerTeam);
    ctx.rngParty.saveState(rngScratch);
    h.bytes(rngScratch);
    if (party.jugg !== null) h.i32(party.juggTicks);
  }
  // M6 (fase 6a): a vida do gerador do Fortress (só nele).
  if (ctx.fortress !== null) h.bytes(ctx.fortress.hp);
  // M7 (fase 0): as rodadas (só nos modos de rodada). Fase 2: o BoboStrike (a bomba e os campos dos bobos).
  if (ctx.rounds !== null) h.bytes(ctx.rounds.data);
  if (ctx.strike !== null) {
    h.bytes(ctx.strike.data).bytes(ctx.strike.pos);
    ctx.rngStrike.saveState(rngScratch);
    h.bytes(rngScratch);
    for (const f of s.strikeFields) h.bytes(f.array.subarray(0, s.count * f.stride));
  }
  // M7 (fase 6): o Bobo Royale (a zona, a colocação, o sorteio e os campos dos bobos, com os do caído).
  const royale = ctx.royale;
  if (royale !== null) {
    h.bytes(royale.data).bytes(royale.circle).bytes(royale.place);
    ctx.rngRoyale.saveState(rngScratch);
    h.bytes(rngScratch);
    for (const f of s.royaleFields) h.bytes(f.array.subarray(0, s.count * f.stride));
    if (!ctx.zombiesMode) for (const f of s.zombieFields) h.bytes(f.array.subarray(0, s.count * f.stride));
  }
  // M6 (fase 4): os modificadores e a Roleta (só com eles).
  const chaos = ctx.chaos;
  if (chaos !== null) {
    h.bytes(chaos.masks);
    ctx.rngChaos.saveState(rngScratch);
    h.bytes(rngScratch);
  }
  // M8 (fase 7): o Arcade (só com ele: o hash dos outros perfis não muda).
  if (ctx.arcade) for (const f of s.arcadeFields) h.bytes(f.array.subarray(0, s.count * f.stride));
  return h.digest();
}

function writeArray(w: BitWriter, a: StateArray, n: number): void {
  if (a instanceof Float64Array) for (let i = 0; i < n; i++) w.writeF64(a[i]!);
  else if (a instanceof Float32Array) for (let i = 0; i < n; i++) w.writeF32(a[i]!);
  else if (a instanceof Uint8Array) for (let i = 0; i < n; i++) w.writeBits(a[i]!, 8);
  else if (a instanceof Uint16Array) for (let i = 0; i < n; i++) w.writeBits(a[i]!, 16);
  else if (a instanceof Int16Array) for (let i = 0; i < n; i++) w.writeBits(a[i]! & 0xffff, 16);
  else for (let i = 0; i < n; i++) w.writeBits(a[i]! >>> 0, 32);
}

function readArray(r: BitReader, a: StateArray, n: number): void {
  if (a instanceof Float64Array) for (let i = 0; i < n; i++) a[i] = r.readF64();
  else if (a instanceof Float32Array) for (let i = 0; i < n; i++) a[i] = r.readF32();
  else if (a instanceof Uint8Array) for (let i = 0; i < n; i++) a[i] = r.readBits(8);
  else if (a instanceof Uint16Array) for (let i = 0; i < n; i++) a[i] = r.readBits(16);
  else if (a instanceof Int16Array) for (let i = 0; i < n; i++) a[i] = r.readBits(16);
  // Typed arrays convertem sozinhos: u32 → Int32Array vira o negativo certo.
  else for (let i = 0; i < n; i++) a[i] = r.readBits(32);
}

export function writeState(ctx: SimContext, w: BitWriter): void {
  const s = ctx.s;
  w.writeU32(SNAPSHOT_MAGIC);
  w.writeU8(SNAPSHOT_VERSION);
  w.writeU32(ctx.tick);
  w.writeU16(s.count);
  w.writeU8(PHASES.indexOf(ctx.match.phase));
  w.writeBits(ctx.match.ticksLeft >>> 0, 32);
  w.writeBits(ctx.match.winnerTeam >>> 0, 32);
  w.writeBits(ctx.match.countdownTicks >>> 0, 32);
  w.writeBits(ctx.match.winnerEntity >>> 0, 32);
  for (let t = 0; t < MAX_TEAMS; t++) w.writeBits(ctx.match.teamScore[t]! >>> 0, 32);
  ctx.rngSpawn.saveState(rngScratch);
  writeArray(w, rngScratch, RNG_STATE_WORDS);
  ctx.rngWeapons.saveState(rngScratch);
  writeArray(w, rngScratch, RNG_STATE_WORDS);
  for (const f of s.fields) writeArray(w, f.array, s.count * f.stride);
  w.writeU16(s.projCount);
  for (const f of s.projectileFields) writeArray(w, f.array, s.projCount * f.stride);
  w.writeU16(s.pickCount);
  for (const f of s.pickupFields) writeArray(w, f.array, s.pickCount * f.stride);
  writeArray(w, s.controllerEntity, MAX_CONTROLLERS_WITH_ZOMBIES);
  if (ctx.zombiesMode) {
    const v = ctx.waves;
    for (const n of [
      v.wave,
      v.resting,
      v.restTicks,
      v.toSpawn,
      v.spawnTicks,
      v.waveHp,
      v.left,
      v.lastZombie,
      v.selfRevivesLeft,
      v.bossPending,
      v.drops,
      v.doubleTicks,
      v.instaTicks,
    ]) {
      w.writeBits(n >>> 0, 32);
    }
    w.writeF64(v.runChance);
    ctx.rngZombies.saveState(rngScratch);
    writeArray(w, rngScratch, RNG_STATE_WORDS);
    for (const f of s.zombieFields) writeArray(w, f.array, s.count * f.stride);
  }
  const mo = ctx.mapObjects;
  if (mo !== null) {
    writeArray(w, mo.planks, mo.barricades);
    writeArray(w, mo.tearTicks, mo.barricades);
    writeArray(w, mo.repairTicks, mo.barricades);
    writeArray(w, mo.repairer, mo.barricades);
    writeArray(w, mo.doorOpen, mo.doors);
    if (mo.boxSpots > 0) {
      writeArray(w, mo.boxState, mo.boxState.length);
      writeArray(w, mo.boxUser, 1);
    }
  }
  {
    const cp = ctx.domination;
    if (cp !== null) {
      for (let i = 0; i < cp.count; i++) w.writeBits(cp.owner[i]! & 0xff, 8);
      writeArray(w, cp.progress, cp.count);
      writeArray(w, cp.scoreTicks, cp.scoreTicks.length);
    }
    const party = ctx.party;
    if (partyActive(party)) {
      w.writeBits(party.started ? 1 : 0, 8);
      w.writeBits(party.winnerEntity >>> 0, 32);
      w.writeBits(party.winnerTeam >>> 0, 32);
      ctx.rngParty.saveState(rngScratch);
      writeArray(w, rngScratch, RNG_STATE_WORDS);
      if (party.jugg !== null) w.writeBits(party.juggTicks >>> 0, 32);
    }
    if (ctx.fortress !== null) writeArray(w, ctx.fortress.hp, 1);
    if (ctx.rounds !== null) writeArray(w, ctx.rounds.data, ctx.rounds.data.length);
    if (ctx.strike !== null) {
      writeArray(w, ctx.strike.data, ctx.strike.data.length);
      writeArray(w, ctx.strike.pos, 3);
      ctx.rngStrike.saveState(rngScratch);
      writeArray(w, rngScratch, RNG_STATE_WORDS);
      for (const f of s.strikeFields) writeArray(w, f.array, s.count * f.stride);
    }
    const royale = ctx.royale;
    if (royale !== null) {
      writeArray(w, royale.data, royale.data.length);
      writeArray(w, royale.circle, royale.circle.length);
      writeArray(w, royale.place, royale.place.length);
      ctx.rngRoyale.saveState(rngScratch);
      writeArray(w, rngScratch, RNG_STATE_WORDS);
      for (const f of s.royaleFields) writeArray(w, f.array, s.count * f.stride);
      if (!ctx.zombiesMode) for (const f of s.zombieFields) writeArray(w, f.array, s.count * f.stride);
    }
    const chaos = ctx.chaos;
    if (chaos !== null) {
      writeArray(w, chaos.masks, chaos.masks.length);
      ctx.rngChaos.saveState(rngScratch);
      writeArray(w, rngScratch, RNG_STATE_WORDS);
    }
    if (ctx.arcade) for (const f of s.arcadeFields) writeArray(w, f.array, s.count * f.stride);
  }
}

/**
 * Lê por cima do estado atual. M0: a sim precisa ter sido criada com a mesma receita e o mesmo mapa (o conjunto de
 * entidades é o mesmo; o alocador de slots não viaja no snapshot).
 */
export function readState(ctx: SimContext, r: BitReader): void {
  const s = ctx.s;
  if (r.readU32() !== SNAPSHOT_MAGIC) throw new Error('snapshot: assinatura inválida');
  const version = r.readU8();
  if (version !== SNAPSHOT_VERSION) throw new Error(`snapshot: versão ${version} não suportada`);
  const tick = r.readU32();
  const count = r.readU16();
  if (count !== s.count) throw new Error('snapshot: conjunto de entidades diferente (receita/mapa outros?)');
  const phase = PHASES[r.readU8()];
  if (phase === undefined) throw new Error('snapshot: fase inválida');
  ctx.tick = tick;
  ctx.match.phase = phase;
  ctx.match.ticksLeft = r.readBits(32) | 0;
  ctx.match.winnerTeam = r.readBits(32) | 0;
  ctx.match.countdownTicks = r.readBits(32) | 0;
  ctx.match.winnerEntity = r.readBits(32) >>> 0;
  for (let t = 0; t < MAX_TEAMS; t++) ctx.match.teamScore[t] = r.readBits(32) | 0;
  readArray(r, rngScratch, RNG_STATE_WORDS);
  ctx.rngSpawn.loadState(rngScratch);
  readArray(r, rngScratch, RNG_STATE_WORDS);
  ctx.rngWeapons.loadState(rngScratch);
  for (const f of s.fields) readArray(r, f.array, s.count * f.stride);
  // Projéteis: os acima do `projCount` lido ficam mortos (o pool da sim pode ter mais vivos que o snapshot).
  const projCount = r.readU16();
  s.projAlive.fill(0, projCount);
  s.projCount = projCount;
  for (const f of s.projectileFields) readArray(r, f.array, projCount * f.stride);
  const pickCount = r.readU16();
  s.pickAlive.fill(0, pickCount);
  s.pickCount = pickCount;
  for (const f of s.pickupFields) readArray(r, f.array, pickCount * f.stride);
  readArray(r, s.controllerEntity, MAX_CONTROLLERS_WITH_ZOMBIES);
  if (ctx.zombiesMode) {
    const v = ctx.waves;
    v.wave = r.readBits(32) | 0;
    v.resting = r.readBits(32) | 0;
    v.restTicks = r.readBits(32) | 0;
    v.toSpawn = r.readBits(32) | 0;
    v.spawnTicks = r.readBits(32) | 0;
    v.waveHp = r.readBits(32) | 0;
    v.left = r.readBits(32) | 0;
    v.lastZombie = r.readBits(32) >>> 0;
    v.selfRevivesLeft = r.readBits(32) | 0;
    v.bossPending = r.readBits(32) | 0;
    v.drops = r.readBits(32) | 0;
    v.doubleTicks = r.readBits(32) | 0;
    v.instaTicks = r.readBits(32) | 0;
    v.runChance = r.readF64();
    readArray(r, rngScratch, RNG_STATE_WORDS);
    ctx.rngZombies.loadState(rngScratch);
    for (const f of s.zombieFields) readArray(r, f.array, s.count * f.stride);
  }
  // M3 (fase 3d): quem chama aplica na colisão e na navegação (`MapObjects.sync`).
  const mo = ctx.mapObjects;
  if (mo !== null) {
    readArray(r, mo.planks, mo.barricades);
    readArray(r, mo.tearTicks, mo.barricades);
    readArray(r, mo.repairTicks, mo.barricades);
    readArray(r, mo.repairer, mo.barricades);
    readArray(r, mo.doorOpen, mo.doors);
    if (mo.boxSpots > 0) {
      readArray(r, mo.boxState, mo.boxState.length);
      readArray(r, mo.boxUser, 1);
    }
  }
  {
    const cp = ctx.domination;
    if (cp !== null) {
      for (let i = 0; i < cp.count; i++) cp.owner[i] = (r.readBits(8) << 24) >> 24;
      readArray(r, cp.progress, cp.count);
      readArray(r, cp.scoreTicks, cp.scoreTicks.length);
    }
    const party = ctx.party;
    if (partyActive(party)) {
      party.started = r.readBits(8) === 1;
      party.winnerEntity = r.readBits(32) >>> 0;
      party.winnerTeam = r.readBits(32) | 0;
      readArray(r, rngScratch, RNG_STATE_WORDS);
      ctx.rngParty.loadState(rngScratch);
      if (party.jugg !== null) {
        party.juggTicks = r.readBits(32) | 0;
        // As regras saem do time que acabou de chegar.
        syncJuggRules(ctx);
      }
    }
    if (ctx.fortress !== null) readArray(r, ctx.fortress.hp, 1);
    if (ctx.rounds !== null) readArray(r, ctx.rounds.data, ctx.rounds.data.length);
    if (ctx.strike !== null) {
      readArray(r, ctx.strike.data, ctx.strike.data.length);
      readArray(r, ctx.strike.pos, 3);
      readArray(r, rngScratch, RNG_STATE_WORDS);
      ctx.rngStrike.loadState(rngScratch);
      for (const f of s.strikeFields) readArray(r, f.array, s.count * f.stride);
    }
    const royale = ctx.royale;
    if (royale !== null) {
      readArray(r, royale.data, royale.data.length);
      readArray(r, royale.circle, royale.circle.length);
      readArray(r, royale.place, royale.place.length);
      readArray(r, rngScratch, RNG_STATE_WORDS);
      ctx.rngRoyale.loadState(rngScratch);
      for (const f of s.royaleFields) readArray(r, f.array, s.count * f.stride);
      if (!ctx.zombiesMode) for (const f of s.zombieFields) readArray(r, f.array, s.count * f.stride);
    }
    const chaos = ctx.chaos;
    if (chaos !== null) {
      readArray(r, chaos.masks, chaos.masks.length);
      readArray(r, rngScratch, RNG_STATE_WORDS);
      ctx.rngChaos.loadState(rngScratch);
      applyChaos(ctx);
    }
    if (ctx.arcade) for (const f of s.arcadeFields) readArray(r, f.array, s.count * f.stride);
  }
}
