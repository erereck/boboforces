// M2 (fase 7b): os sons da partida (arte-ux.md §10.4–§10.5; GDD §5.10). Lê os eventos da sim e o estado da vista e
// toca pelo mixer: tiro de perto ou de longe (além de 30 m), −6 dB atrás de parede (raio na grade), prioridade por
// parentesco (sua arma > dano em você > inimigos > aliados > ambiente), cooldown por som, passos só dos 4 bots mais
// perto de cada ouvinte, retorno ao jogador (plic, PLOC, abate, dano, morte, coração) e a contagem. A sim não sabe que
// o som existe (tecnico.md §1.1). Também a síntese fatiada do loading (`createSynthJob`).
import { GAME_SYNTH_SOUNDS, MAX_DISTANCE_M, SYNTH_SAMPLE_RATE, type AudioBus, type Mixer } from '@boboforces/audio';
import type { Disposable } from '@boboforces/shared';
import {
  ENTITY_FLAG,
  entityIndex,
  isLivePhase,
  NO_TEAM,
  NULL_ENTITY,
  SIM_HZ,
  WEAPON_CODE,
  type MatchPhase,
  type SimEvent,
  type SimView,
} from '@boboforces/sim';
import { BLOCK_FLAG, cellBlock, CELLS_PER_METER, createRayHit, raycastGrid } from '@boboforces/world';
import { SOUND_IDS, SOUND_RANK, SOUNDS, type SoundId } from '../sound-bank.ts';

/** Números da mixagem da partida (revisáveis; arte-ux §10.4 e GDD §5.10). */
export const MATCH_SOUND = {
  /** Além daqui o tiro e a explosão tocam a amostra de longe. */
  farM: 30,
  /** −6 dB atrás de parede. */
  occludedGain: 0.5,
  /** Só os passos dos N bots mais perto de cada ouvinte tocam, e só até esta distância. */
  stepNearest: 4,
  stepRangeM: 25,
  /** Passada (m) andando e correndo; abaixo de `stepMinSpeed` (m/s) não há passo. */
  walkStrideM: 1.7,
  sprintStrideM: 2.3,
  stepMinSpeed: 0.8,
  /** Agachado pisa leve. */
  crouchGain: 0.35,
  /** Foley de arma (troca, recarga, pino, clique) dos outros só até aqui. */
  foleyRangeM: 12,
  /** Vida baixa: o coração bate abaixo disto, a cada `heartbeatS`. */
  lowHealth: 30,
  heartbeatS: 0.95,
  /** Pouso: inaudível abaixo de `landMinSpeed` e cheio a partir de `landFullSpeed` (m/s de queda). */
  landMinSpeed: 3,
  landFullSpeed: 9,
  /** Com 3 ou 4 jogadores locais, a própria arma perde 3 dB (arte-ux §10.3). */
  ownCrowdGain: 0.7,
  /** Altura aproximada dos olhos e das mãos acima dos pés (m). */
  eyeM: 1.5,
  handsM: 1.2,
} as const;

/** Família de som do `stepSound` do bloco (arte-ux §10.5: cada material declara a sua). */
const FAMILY = { concrete: 0, metal: 1, wood: 2, glass: 3, soft: 4, canvas: 5 } as const;
const STEP_FAMILY: Readonly<Record<string, number>> = {
  concrete: FAMILY.concrete,
  metal: FAMILY.metal,
  wood: FAMILY.wood,
  glass: FAMILY.glass,
  grass: FAMILY.soft,
  dirt: FAMILY.soft,
  leaves: FAMILY.soft,
  water: FAMILY.soft,
  canvas: FAMILY.canvas,
};
const STEP_SOUND: readonly (readonly [SoundId, SoundId])[] = [
  ['passo-concreto-1', 'passo-concreto-2'],
  ['passo-metal', 'passo-metal'],
  ['passo-madeira', 'passo-madeira'],
  ['passo-concreto-1', 'passo-concreto-2'],
  ['passo-grama', 'passo-grama'],
  ['passo-tecido', 'passo-tecido'],
];
const IMPACT_SOUND: readonly SoundId[] = [
  'impacto-concreto',
  'impacto-metal',
  'impacto-madeira',
  'impacto-vidro',
  'impacto-macio',
  'impacto-macio',
];

/** Tiro de cada arma (código da sim) → [perto, longe]; a LMG usa o do fuzil. */
function shotSounds(weapon: number): readonly [SoundId, SoundId] | null {
  switch (weapon) {
    case WEAPON_CODE.pistol:
      return ['tiro-pistola', 'tiro-pistola-longe'];
    case WEAPON_CODE.smg:
      return ['tiro-smg', 'tiro-smg-longe'];
    case WEAPON_CODE.rifle:
    case WEAPON_CODE.lmg:
      return ['tiro-fuzil', 'tiro-fuzil-longe'];
    case WEAPON_CODE.shotgun:
      return ['tiro-escopeta', 'tiro-escopeta-longe'];
    case WEAPON_CODE.sniper:
      return ['tiro-sniper', 'tiro-sniper-longe'];
    default:
      return null;
  }
}

const SOUND_INDEX: ReadonlyMap<SoundId, number> = new Map(SOUND_IDS.map((id, i) => [id, i]));

/**
 * Síntese dos sons `synth` do banco, um por vez dentro do orçamento do frame do loading (no Switch o JS é
 * interpretado: os 19 juntos custam ~0,6 s no V8 sem JIT). O mixer guarda o que já fez: a 2ª partida não refaz.
 */
export interface SynthJob {
  readonly done: boolean;
  /** Sintetiza até `deadline` (sempre ao menos um som, se faltar). */
  step(deadline: number, now: () => number): void;
}

export function createSynthJob(mixer: Mixer, onError: (id: string, error: unknown) => void): SynthJob {
  const queue = mixer.available ? SOUND_IDS.filter((id) => SOUNDS[id].src === 'synth' && !mixer.has(id)) : [];
  let next = 0;
  return {
    get done() {
      return next >= queue.length;
    },
    step(deadline, now) {
      do {
        const id = queue[next++];
        if (id === undefined) return;
        const gen = GAME_SYNTH_SOUNDS[id];
        try {
          if (!gen) throw new Error('sem receita');
          mixer.synthesize(id, gen(), SYNTH_SAMPLE_RATE);
        } catch (error) {
          onError(id, error);
        }
      } while (next < queue.length && now() < deadline);
    },
  };
}

export interface MatchSoundDeps {
  readonly mixer: Mixer;
  /** Humanos locais (1 a 4). */
  readonly humans: number;
  /** Entidade do humano local `p`, ou `NULL_ENTITY`. */
  localEntity(p: number): number;
  /** A regra que esconde o hitmarker também cala o "plic" e o "PLOC". */
  readonly hitmarker: boolean;
  /** FFA: todo mundo que não é você é inimigo. */
  readonly ffa: boolean;
}

export interface MatchSound extends Disposable {
  /** Ouvinte da vista local `slot` (a câmera dela). */
  setListener(slot: number, x: number, y: number, z: number, yaw: number): void;
  setListenerCount(count: number): void;
  /** Um evento da sim (no laço do `onEvents`). */
  event(ev: SimEvent, v: SimView, nowS: number): void;
  /** 1x por frame: passos, coração e contagem. */
  frame(v: SimView, dt: number, nowS: number): void;
  /** Pausa e troca de cena: corta o que está tocando. */
  silence(): void;
}

/** Opções reaproveitadas do `mixer.play` (regra 11: nada alocado por som). */
interface FlatOptions {
  bus: AudioBus;
  volume: number;
  priority: number;
  rate: number;
}
interface SpatialOptions extends FlatOptions {
  x: number;
  y: number;
  z: number;
}

export function createMatchSound(deps: MatchSoundDeps): MatchSound {
  const { mixer } = deps;
  const lx = new Float64Array(4);
  const ly = new Float64Array(4);
  const lz = new Float64Array(4);
  let listeners = 1;
  const lastPlayed = new Float64Array(SOUND_IDS.length).fill(-1e9);
  const flat: FlatOptions = { bus: 'sfx', volume: 1, priority: 1, rate: 1 };
  const spatial: SpatialOptions = { bus: 'sfx', volume: 1, priority: 1, rate: 1, x: 0, y: 0, z: 0 };
  const ray = createRayHit();
  let stepAcc = new Float32Array(0);
  let stepCount = new Uint32Array(0);
  let nearMark = new Uint8Array(0);
  const nearBest = new Int32Array(MATCH_SOUND.stepNearest);
  const nearD2 = new Float64Array(MATCH_SOUND.stepNearest);
  const heartT = new Float64Array(4);
  let familyOf: Uint8Array | null = null;
  let lastCount = -1;
  let lastPhase: MatchPhase | null = null;
  let disposed = false;

  const ensure = (capacity: number): void => {
    if (stepAcc.length >= capacity) return;
    stepAcc = new Float32Array(capacity);
    stepCount = new Uint32Array(capacity);
    nearMark = new Uint8Array(capacity);
  };

  /** Família de cada bloco do registro (uma vez por partida). */
  const families = (v: SimView): Uint8Array => {
    if (familyOf && familyOf.length === v.blocks.size) return familyOf;
    familyOf = new Uint8Array(v.blocks.size);
    for (let id = 0; id < v.blocks.size; id++)
      familyOf[id] = STEP_FAMILY[v.blocks.get(id).stepSound] ?? FAMILY.concrete;
    return familyOf;
  };

  /** Família do chão sob os pés (a célula logo abaixo; em laje ou rampa, a de baixo dela). */
  const floorFamily = (v: SimView, x: number, y: number, z: number): number => {
    const fam = families(v);
    const cx = Math.floor(x * CELLS_PER_METER);
    const cz = Math.floor(z * CELLS_PER_METER);
    for (let k = 1; k <= 2; k++) {
      const cy = Math.floor((y - 0.05 * k * k) * CELLS_PER_METER);
      if (!v.world.inBounds(cx, cy, cz)) continue;
      const b = cellBlock(v.world.get(cx, cy, cz));
      if (b !== 0) return fam[b] ?? FAMILY.concrete;
    }
    return FAMILY.concrete;
  };

  const localIndex = (entity: number): number => {
    if (entity === NULL_ENTITY) return -1;
    for (let p = 0; p < deps.humans; p++) if (deps.localEntity(p) === entity) return p;
    return -1;
  };

  /** Parentesco de quem fez o som com os jogadores locais. */
  const rankOf = (v: SimView, entity: number): number => {
    if (entity === NULL_ENTITY) return SOUND_RANK.world;
    if (localIndex(entity) >= 0) return SOUND_RANK.own;
    if (deps.ffa) return SOUND_RANK.enemy;
    const i = entityIndex(entity);
    const team = i < v.count ? v.team[i]! : NO_TEAM;
    for (let p = 0; p < deps.humans; p++) {
      const e = deps.localEntity(p);
      if (e === NULL_ENTITY) continue;
      const li = entityIndex(e);
      if (li < v.count && team !== NO_TEAM && v.team[li] === team) return SOUND_RANK.ally;
    }
    return SOUND_RANK.enemy;
  };

  /** Cooldown por som (o próprio jogador passa sempre). `false` = ainda no cooldown. */
  const ready = (id: SoundId, nowS: number, own: boolean): boolean => {
    const k = SOUND_INDEX.get(id)!;
    if (!own && nowS - lastPlayed[k]! < SOUNDS[id].cooldownS) return false;
    lastPlayed[k] = nowS;
    return true;
  };

  const ownGain = (): number => (deps.humans >= 3 ? MATCH_SOUND.ownCrowdGain : 1);

  /** Som "na cabeça" do jogador (sem posição): retorno, a própria arma. */
  const playFlat = (id: SoundId, nowS: number, volume = 1, priority: number = SOUNDS[id].priority, rate = 1): void => {
    if (!ready(id, nowS, true)) return;
    const def = SOUNDS[id];
    flat.bus = def.bus;
    flat.volume = Math.min(1, def.volume * volume);
    flat.priority = priority;
    flat.rate = rate;
    mixer.play(id, flat);
  };

  /** Distância ao ouvinte mais perto (o mesmo que o mixer usa) e o índice dele em `nearestL`. */
  let nearestL = 0;
  const listenerDistance = (x: number, y: number, z: number): number => {
    let best = Infinity;
    for (let l = 0; l < listeners; l++) {
      const dx = x - lx[l]!;
      const dy = y - ly[l]!;
      const dz = z - lz[l]!;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < best) {
        best = d2;
        nearestL = l;
      }
    }
    return Math.sqrt(best);
  };

  /** Há parede (bloco que tapa a visão) entre o ouvinte mais perto e o ponto? */
  const occluded = (v: SimView, x: number, y: number, z: number, d: number): boolean => {
    if (d < 2) return false;
    const ox = lx[nearestL]!;
    const oy = ly[nearestL]!;
    const oz = lz[nearestL]!;
    const inv = 1 / d;
    return raycastGrid(
      v.world,
      v.blocks,
      ox,
      oy,
      oz,
      (x - ox) * inv,
      (y - oy) * inv,
      (z - oz) * inv,
      d - 0.4,
      BLOCK_FLAG.blocksSight,
      ray,
    );
  };

  /** Som no mundo: distância e pan pelo mixer, mais a troca perto/longe e a parede. */
  const playAt = (
    v: SimView,
    id: SoundId,
    far: SoundId | null,
    x: number,
    y: number,
    z: number,
    nowS: number,
    priority: number,
    volume = 1,
    rate = 1,
  ): void => {
    const d = listenerDistance(x, y, z);
    if (d >= MAX_DISTANCE_M) return;
    const sound = far !== null && d > MATCH_SOUND.farM ? far : id;
    if (!ready(sound, nowS, priority === SOUND_RANK.own)) return;
    const def = SOUNDS[sound];
    spatial.bus = def.bus;
    spatial.volume = Math.min(1, def.volume * volume * (occluded(v, x, y, z, d) ? MATCH_SOUND.occludedGain : 1));
    spatial.priority = priority;
    spatial.rate = rate;
    spatial.x = x;
    spatial.y = y;
    spatial.z = z;
    mixer.play(sound, spatial);
  };

  /** Índice de uma entidade viva (os pés estão em `position`), ou -1. */
  const at = (v: SimView, entity: number): number => {
    const i = entityIndex(entity);
    return entity !== NULL_ENTITY && i < v.count && v.alive[i] === 1 ? i : -1;
  };

  const playStep = (v: SimView, i: number, nowS: number, own: boolean): void => {
    const o = i * 3;
    const x = v.position[o]!;
    const y = v.position[o + 1]!;
    const z = v.position[o + 2]!;
    const pair = STEP_SOUND[floorFamily(v, x, y, z)]!;
    const n = stepCount[i]!++;
    // Tom de cada passo varia ±7% (hash do bobo e do passo; sem Math.random fora da sim também, para os testes).
    const h = Math.imul(i * 0x9e3779b1 + n, 0x85ebca6b) >>> 0;
    const rate = 0.93 + ((h >>> 8) / 0xffffff) * 0.14;
    const flags = v.flags[i]!;
    const volume = (flags & ENTITY_FLAG.crouching ? MATCH_SOUND.crouchGain : 1) * (own ? 0.8 : 1);
    playAt(v, pair[n & 1]!, null, x, y, z, nowS, SOUND_RANK.world, volume, rate);
  };

  /** Marca os N bobos (não locais) mais perto de cada ouvinte, até o alcance dos passos. */
  const markNearest = (v: SimView): void => {
    nearMark.fill(0, 0, v.count);
    const range2 = MATCH_SOUND.stepRangeM * MATCH_SOUND.stepRangeM;
    for (let l = 0; l < listeners; l++) {
      nearBest.fill(-1);
      nearD2.fill(Infinity);
      for (let i = 0; i < v.count; i++) {
        if (v.alive[i] !== 1 || v.flags[i]! & ENTITY_FLAG.dead) continue;
        const o = i * 3;
        const dx = v.position[o]! - lx[l]!;
        const dy = v.position[o + 1]! - ly[l]!;
        const dz = v.position[o + 2]! - lz[l]!;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > range2) continue;
        // Inserção ordenada nos N melhores.
        let k = MATCH_SOUND.stepNearest - 1;
        if (d2 >= nearD2[k]!) continue;
        while (k > 0 && nearD2[k - 1]! > d2) {
          nearD2[k] = nearD2[k - 1]!;
          nearBest[k] = nearBest[k - 1]!;
          k--;
        }
        nearD2[k] = d2;
        nearBest[k] = i;
      }
      for (let k = 0; k < MATCH_SOUND.stepNearest; k++) if (nearBest[k]! >= 0) nearMark[nearBest[k]!] = 1;
    }
  };

  const isLocalIndex = (v: SimView, i: number): boolean => {
    for (let p = 0; p < deps.humans; p++) {
      const e = deps.localEntity(p);
      if (e !== NULL_ENTITY && entityIndex(e) === i && i < v.count) return true;
    }
    return false;
  };

  return {
    setListener(slot, x, y, z, yaw) {
      if (slot < 0 || slot > 3) return;
      lx[slot] = x;
      ly[slot] = y;
      lz[slot] = z;
      mixer.setListener(slot, x, y, z, yaw);
    },
    setListenerCount(count) {
      listeners = Math.max(1, Math.min(4, count));
      mixer.setListenerCount(listeners);
    },
    event(ev, v, nowS) {
      if (disposed) return;
      switch (ev.type) {
        case 'shot': {
          const pair = shotSounds(ev.weapon);
          if (!pair) break;
          const rank = rankOf(v, ev.shooter);
          if (rank === SOUND_RANK.own) playFlat(pair[0], nowS, ownGain(), SOUND_RANK.own);
          else playAt(v, pair[0], pair[1], ev.originX, ev.originY, ev.originZ, nowS, rank);
          break;
        }
        case 'impact':
          playAt(
            v,
            IMPACT_SOUND[ev.prop >= 0 ? FAMILY.wood : (families(v)[ev.block] ?? FAMILY.concrete)]!,
            null,
            ev.x,
            ev.y,
            ev.z,
            nowS,
            SOUND_RANK.world,
          );
          break;
        case 'hit': {
          const shooterLocal = localIndex(ev.shooter) >= 0;
          const targetLocal = localIndex(ev.target) >= 0;
          if (shooterLocal && deps.hitmarker && ev.shooter !== ev.target) {
            if (ev.part === 'head') playFlat('ploc', nowS);
            else playFlat('hitmarker', nowS);
          }
          if (targetLocal) playFlat('dano', nowS);
          else playAt(v, 'impacto-bobo', null, ev.x, ev.y, ev.z, nowS, rankOf(v, ev.target));
          break;
        }
        case 'kill': {
          if (localIndex(ev.victim) >= 0) playFlat('morte', nowS);
          else if (localIndex(ev.killer) >= 0) playFlat('abate', nowS);
          break;
        }
        case 'melee': {
          const i = at(v, ev.attacker);
          if (i >= 0) {
            const o = i * 3;
            const rank = rankOf(v, ev.attacker);
            if (rank === SOUND_RANK.own) playFlat('faca-golpe', nowS);
            else
              playAt(
                v,
                'faca-golpe',
                null,
                v.position[o]!,
                v.position[o + 1]! + MATCH_SOUND.handsM,
                v.position[o + 2]!,
                nowS,
                rank,
              );
          }
          const t = at(v, ev.target);
          if (t >= 0) {
            const o = t * 3;
            playAt(
              v,
              'faca-acerto',
              null,
              v.position[o]!,
              v.position[o + 1]! + MATCH_SOUND.handsM,
              v.position[o + 2]!,
              nowS,
              Math.max(rankOf(v, ev.attacker), rankOf(v, ev.target)),
            );
          }
          break;
        }
        case 'projectile': {
          const rank = rankOf(v, ev.owner);
          if (ev.action === 'bounce') {
            const speed = Math.hypot(ev.vx, ev.vy, ev.vz);
            playAt(v, 'granada-quica', null, ev.x, ev.y, ev.z, nowS, rank, Math.min(1, 0.3 + speed / 12));
          } else if (ev.weapon === WEAPON_CODE.rocket) {
            if (rank === SOUND_RANK.own) playFlat('foguete', nowS, ownGain(), rank);
            else playAt(v, 'foguete', null, ev.x, ev.y, ev.z, nowS, rank);
          } else if (ev.weapon === WEAPON_CODE.grenade) {
            // Arremesso: o mesmo sopro da faca, mais grave.
            if (rank === SOUND_RANK.own) playFlat('faca-golpe', nowS, 0.8, rank, 0.75);
            else playAt(v, 'faca-golpe', null, ev.x, ev.y, ev.z, nowS, rank, 0.8, 0.75);
          }
          break;
        }
        case 'explosion':
          playAt(
            v,
            'explosao',
            'explosao-longe',
            ev.x,
            ev.y,
            ev.z,
            nowS,
            Math.max(rankOf(v, ev.owner), SOUND_RANK.enemy),
          );
          break;
        case 'weapon': {
          const i = at(v, ev.entity);
          if (i < 0) break;
          const id: SoundId =
            ev.action === 'switch'
              ? 'troca-arma'
              : ev.action === 'reloadStart'
                ? 'recarga-tira'
                : ev.action === 'reloadEnd'
                  ? 'recarga-poe'
                  : ev.action === 'empty'
                    ? 'sem-municao'
                    : 'granada-pino';
          const rank = rankOf(v, ev.entity);
          if (rank === SOUND_RANK.own) {
            playFlat(id, nowS, 1, rank);
            break;
          }
          const o = i * 3;
          const x = v.position[o]!;
          const y = v.position[o + 1]! + MATCH_SOUND.handsM;
          const z = v.position[o + 2]!;
          if (listenerDistance(x, y, z) <= MATCH_SOUND.foleyRangeM) playAt(v, id, null, x, y, z, nowS, rank);
          break;
        }
        case 'move': {
          const i = at(v, ev.entity);
          if (i < 0 || ev.move === 'step') break;
          const own = localIndex(ev.entity) >= 0;
          const o = i * 3;
          let volume = 1;
          if (ev.move === 'land') {
            if (ev.speed < MATCH_SOUND.landMinSpeed) break;
            volume =
              0.35 +
              0.65 *
                Math.min(
                  1,
                  (ev.speed - MATCH_SOUND.landMinSpeed) / (MATCH_SOUND.landFullSpeed - MATCH_SOUND.landMinSpeed),
                );
          }
          const id: SoundId = ev.move === 'jump' ? 'pulo' : ev.move === 'land' ? 'pouso' : 'deslize';
          playAt(
            v,
            id,
            null,
            v.position[o]!,
            v.position[o + 1]!,
            v.position[o + 2]!,
            nowS,
            own ? SOUND_RANK.own : SOUND_RANK.world,
            volume,
          );
          break;
        }
        case 'pickup':
          if (ev.action === 'take' && localIndex(ev.entity) >= 0) playFlat('municao', nowS);
          break;
        case 'matchPhase': {
          if (ev.phase !== 'ended') break;
          const me = deps.localEntity(0);
          const i = entityIndex(me);
          let win = false;
          let tie = false;
          if (deps.ffa) {
            win = v.match.winnerEntity === me && me !== NULL_ENTITY;
            tie = v.match.winnerEntity === NULL_ENTITY;
          } else {
            win = me !== NULL_ENTITY && i < v.count && v.match.winnerTeam === v.team[i];
            tie = v.match.winnerTeam < 0;
          }
          if (!tie) playFlat(win ? 'vitoria' : 'derrota', nowS);
          break;
        }
        default:
          break;
      }
    },
    frame(v, dt, nowS) {
      if (disposed) return;
      ensure(v.capacity);
      // Contagem: 3, 2, 1 e o "vai" quando a partida começa a valer.
      const phase = v.match.phase;
      if (phase === 'warmup') {
        const secs = Math.ceil(v.match.countdownTicks / SIM_HZ);
        if (secs !== lastCount && secs >= 1 && secs <= 3) playFlat('contagem-bipe', nowS);
        lastCount = secs;
      } else if (lastPhase === 'warmup' && isLivePhase(phase)) {
        playFlat('contagem-vai', nowS);
      }
      lastPhase = phase;
      // Passos.
      markNearest(v);
      for (let i = 0; i < v.count; i++) {
        const flags = v.flags[i]!;
        if (v.alive[i] !== 1 || flags & ENTITY_FLAG.dead) {
          stepAcc[i] = 0;
          continue;
        }
        if (!(flags & ENTITY_FLAG.onGround) || flags & ENTITY_FLAG.sliding) continue;
        const o = i * 3;
        const speed = Math.hypot(v.velocity[o]!, v.velocity[o + 2]!);
        const stride = flags & ENTITY_FLAG.sprinting ? MATCH_SOUND.sprintStrideM : MATCH_SOUND.walkStrideM;
        if (speed < MATCH_SOUND.stepMinSpeed) {
          // Parado: o 1º passo sai meia passada depois de começar a andar.
          stepAcc[i] = stride * 0.5;
          continue;
        }
        stepAcc[i] = stepAcc[i]! + speed * dt;
        if (stepAcc[i]! < stride) continue;
        stepAcc[i] = Math.min(stride, stepAcc[i]! - stride);
        const own = isLocalIndex(v, i);
        if (own || nearMark[i] === 1) playStep(v, i, nowS, own);
      }
      // Vida baixa: o coração de cada jogador local.
      for (let p = 0; p < Math.min(deps.humans, 4); p++) {
        const i = at(v, deps.localEntity(p));
        const low =
          i >= 0 &&
          isLivePhase(phase) &&
          !(v.flags[i]! & ENTITY_FLAG.dead) &&
          v.health[i]! > 0 &&
          v.health[i]! < MATCH_SOUND.lowHealth;
        if (!low) {
          heartT[p] = 0;
          continue;
        }
        heartT[p] = heartT[p]! - dt;
        if (heartT[p]! <= 0) {
          playFlat('coracao', nowS);
          heartT[p] = MATCH_SOUND.heartbeatS;
        }
      }
    },
    silence() {
      mixer.stopAll();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      mixer.stopAll();
    },
  };
}
