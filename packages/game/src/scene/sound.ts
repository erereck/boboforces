// M2 (fase 7b): os sons da partida (arte-ux.md §10.4–§10.5; GDD §5.10). Lê os eventos da sim e o estado da vista e
// toca pelo mixer: tiro de perto ou de longe (além de 30 m), −6 dB atrás de parede (raio na grade), prioridade por
// parentesco (sua arma > dano em você > inimigos > aliados > ambiente), cooldown por som, passos só dos 4 bots mais
// perto de cada ouvinte, retorno ao jogador (plic, PLOC, abate, dano, morte, coração) e a contagem. A sim não sabe que
// o som existe (tecnico.md §1.1). Também a síntese fatiada do loading (`createSynthJob`).
//
// M12 (fase 4, ARCHITECTURE §23.4): o refino. O cooldown só vale entre os sons dos outros (o seu tiro não cala mais o
// do inimigo) e vale no retorno (dano, morte, coração, abate); cada tiro e cada impacto um pouco diferente; a parede
// abafa (a amostra de longe a −3 dB); o dano com lado e o coração que acelera; o foley das armas em tempos (o ferrolho,
// o cartucho, a recarga longa); o zunido da bala que passa perto; o plic que sobe na sequência e o tique do pente; o
// abate que sobe de tom e o colete que quebra; passos com peso e o pouso no material; os objetivos
// (`sound-objectives.ts`); as vinhetas de 3 s e o empate; o mundo abafado na morte e na explosão colada; o pan a 50%
// com 3–4 no sofá; tiros e explosões até 150 m. As contas pequenas ficam em `sound-feel.ts`.
import {
  GAME_SYNTH_SOUNDS,
  MAX_DISTANCE_M,
  SYNTH_SAMPLE_RATE,
  WIND_RATE,
  type AudioBus,
  type Mixer,
} from '@boboforces/audio';
import type { Disposable } from '@boboforces/shared';
import {
  ENTITY_FLAG,
  ENTITY_KIND,
  entityIndex,
  heldClip,
  isLivePhase,
  isPaintWeapon,
  makeEntityId,
  type MatchPhase,
  NO_TEAM,
  NULL_ENTITY,
  PICKUP_KIND,
  type ShotEvent,
  SIM_HZ,
  type SimEvent,
  type SimView,
  WEAPON_BIG_BRRT,
  WEAPON_CODE,
  WEAPON_DESMONTADOR,
  WEAPON_GOO,
  WEAPON_PAINT_BUCKET,
  WEAPON_PAINT_PUMP,
  WEAPON_PAINT_SNIPER,
  WEAPON_SPIT,
  ZOMBIE_TYPE,
  weaponBase,
  weaponDef,
} from '@boboforces/sim';
import { BLOCK_FLAG, cellBlock, CELLS_PER_METER, createRayHit, raycastGrid } from '@boboforces/world';
import { SOUND_IDS, SOUND_RANK, SOUNDS, type SoundId } from '../sound-bank.ts';
import {
  cyclesAfterShot,
  foleyPitch,
  hash2,
  heartGain,
  heartInterval,
  hitStreakPitch,
  hurtPan,
  impactPitch,
  isLowHealth,
  killStreakPitch,
  lowMagPitch,
  shotGain,
  shotPitch,
  SOUND_FEEL,
  unit,
  whizOut,
  whizPoint,
} from './sound-feel.ts';
import { createObjectiveSound } from './sound-objectives.ts';

/** Números da mixagem da partida (revisáveis; arte-ux §10.4 e GDD §5.10). */
export const MATCH_SOUND = {
  /** Além daqui o tiro e a explosão tocam a amostra de longe. */
  farM: 30,
  /** −6 dB atrás de parede. */
  occludedGain: 0.5,
  /**
   * M12 (fase 4): atrás de parede, o que tem amostra de longe (tiros e explosões) toca ela (o passa-baixa de 900 Hz é
   * o abafado) a −3 dB.
   */
  occludedFarGain: 0.708,
  /** M12 (fase 4): tiros e explosões vão até aqui (pela amostra de longe; o Royale Grande tem 400 m de mapa). */
  farRangeM: 150,
  /** Só os passos dos N bots mais perto de cada ouvinte tocam, e só até esta distância. */
  stepNearest: 4,
  stepRangeM: 25,
  /** Passada (m) andando e correndo; abaixo de `stepMinSpeed` (m/s) não há passo. */
  walkStrideM: 1.7,
  sprintStrideM: 2.3,
  stepMinSpeed: 0.8,
  /** Agachado pisa leve. */
  crouchGain: 0.35,
  /**
   * M12 (fase 4): correndo pisa mais forte e andando mais leve, cada passo ±10% de volume, e o passo ímpar um pouco
   * mais grave (o pé de lá).
   */
  sprintStepGain: 1.25,
  walkStepGain: 0.85,
  stepGainSpread: 0.1,
  oddStepPitch: 0.94,
  /** Foley de arma (troca, recarga, pino, clique) dos outros só até aqui. */
  foleyRangeM: 12,
  /** M12 (fase 4): o ferrolho da sniper e o pump da escopeta, depois do tiro. */
  boltDelayS: 0.3,
  /** M12 (fase 4): a recarga de pente desta duração ou mais ganha o foley do meio (aos 40% e aos 70%). */
  reloadMidS: 2.4,
  /** Pouso: inaudível abaixo de `landMinSpeed` e cheio a partir de `landFullSpeed` (m/s de queda). */
  landMinSpeed: 3,
  landFullSpeed: 9,
  /** Com 3 ou 4 jogadores locais, a própria arma perde 3 dB (arte-ux §10.3). */
  ownCrowdGain: 0.7,
  /** A música nas explosões: −6 dB e volta em 0,8 s. */
  duckDb: -6,
  duckS: 0.8,
  /**
   * M12 (fase 4): só com 1 jogador e sem "Reduzir efeitos": na morte os efeitos caem 10 dB e voltam em 1,5 s (o som
   * da morte por cima); numa explosão a menos de 4 m, caem 8 dB depois do estrondo, com o zumbido por cima.
   */
  deathDuckDb: -10,
  deathDuckS: 1.5,
  blastNearM: 4,
  blastDuckDb: -8,
  blastDuckS: 1.2,
  blastDuckDelayS: 0.12,
  /** M12 (fase 4): a música abaixa 8 dB durante a vinheta de fim (3 s). */
  jingleDuckDb: -8,
  jingleS: 3,
  /** M12 (fase 4): com 3 ou 4 jogadores no sofá, o pan cai para 50% (arte-ux §10.3). */
  crowdPanWidth: 0.5,
  /** Indicador visual de som (arte-ux §6.7): tiros, explosões e passos até aqui, e quanto tempo cada um fica. */
  indicatorRangeM: 20,
  indicatorLifeS: 0.8,
  /** Altura aproximada dos olhos e das mãos acima dos pés (m). */
  eyeM: 1.5,
  handsM: 1.2,
  /**
   * M3 (fase 6d): gemidos dos zumbis: cada zumbi a cada `groanMinS`..`groanMaxS` (sorteio por hash), só até
   * `groanRangeM` do ouvinte e no máximo um a cada `groanGapS` na partida (o teto de 24 vozes é de todo mundo).
   */
  groanMinS: 3,
  groanMaxS: 8,
  groanRangeM: 22,
  groanGapS: 0.45,
  /** O chefão ruge mais espaçado. */
  roarMinS: 6,
  roarMaxS: 11,
} as const;

/** M3 (fase 6d): as 3 vozes dos zumbis comuns. */
const GROAN_SOUNDS: readonly SoundId[] = ['zumbi-gemido-1', 'zumbi-gemido-2', 'zumbi-gemido-3'];

/** M12 (fase 4, revisão): o ferrolho em ticks da sim. */
const BOLT_TICKS = Math.round(MATCH_SOUND.boltDelayS * SIM_HZ);

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

/**
 * Tiro de cada arma (código da sim) → [perto, longe]; a LMG usa o do fuzil (M12: mais grave, `SOUND_FEEL.lmgPitch`) e
 * a Big Brrt o da SMG (mais grave).
 */
function shotSounds(weapon: number): readonly [SoundId, SoundId] | null {
  switch (weapon) {
    case WEAPON_CODE.pistol:
      return ['tiro-pistola', 'tiro-pistola-longe'];
    case WEAPON_CODE.smg:
    case WEAPON_BIG_BRRT:
      return ['tiro-smg', 'tiro-smg-longe'];
    case WEAPON_CODE.rifle:
    case WEAPON_CODE.lmg:
      return ['tiro-fuzil', 'tiro-fuzil-longe'];
    case WEAPON_CODE.shotgun:
    case WEAPON_CODE.autoShotgun:
      return ['tiro-escopeta', 'tiro-escopeta-longe'];
    case WEAPON_CODE.sniper:
      return ['tiro-sniper', 'tiro-sniper-longe'];
    // M10 (fase 6): o DMR e o revólver têm o tiro deles; a escopeta automática usa o da pump (`AUTO_SHOTGUN_PITCH`).
    case WEAPON_CODE.dmr:
      return ['tiro-dmr', 'tiro-dmr-longe'];
    case WEAPON_CODE.revolver:
      return ['tiro-revolver', 'tiro-revolver-longe'];
    default:
      return null;
  }
}

const SOUND_INDEX: ReadonlyMap<SoundId, number> = new Map(SOUND_IDS.map((id, i) => [id, i]));

/** M6 (fase 5): o tiro do marcador de tinta (o da arma parecida, bem mais agudo e baixo). */
const PAINT_PITCH = 1.7;
const PAINT_GAIN = 0.55;
/** M6 (fase 3): o tiro da Big Brrt (o da SMG, mais grave e um pouco mais baixo: são 20 por segundo). */
const BIG_BRRT_PITCH = 0.75;
const BIG_BRRT_GAIN = 0.8;
/** M10 (fase 6): a escopeta automática: o tiro da pump um pouco mais agudo e mais baixo (são 3 por segundo). */
const AUTO_SHOTGUN_PITCH = 1.15;
const AUTO_SHOTGUN_GAIN = 0.8;

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
  /** M6 (fase 3): o vencedor é um bobo, não um time (o Juggernaut), sem mudar o parentesco dos sons (`ffa`). */
  readonly soloWinner?: boolean;
  /**
   * M12 (fase 4): a vida máxima do jogador local (a entidade): o coração bate com `hp ≤ 0,3·máxima`, o mesmo limite da
   * vinheta da HUD. Sem isto, 100.
   */
  maxHealth?(entity: number): number;
  /** M12 (fase 4): "Reduzir efeitos" (o Ajuste ou o sistema): sem o mundo abafado na morte e na explosão colada. */
  reduceEffects?(): boolean;
  /** M12 (fase 4): o ambiente do mapa: o vento (não na Lua) e os grilos (à noite). Sem isto, nada. */
  readonly ambient?: { readonly wind: boolean; readonly night: boolean };
  /**
   * M12 (fase 4, revisão): o modo é contra a IA (o Bobo Zombies, a Horda, o Fortress): o fim sem vencedor
   * (`winnerTeam` -1) é a derrota, não o empate.
   */
  readonly coop?: boolean;
}

export interface MatchSound extends Disposable {
  /** Ouvinte da vista local `slot` (a câmera dela). */
  setListener(slot: number, x: number, y: number, z: number, yaw: number): void;
  setListenerCount(count: number): void;
  /** Um evento da sim (no laço do `onEvents`). */
  event(ev: SimEvent, v: SimView, nowS: number): void;
  /** 1x por frame: passos, coração e contagem. */
  frame(v: SimView, dt: number, nowS: number): void;
  /**
   * M2 (fase 7c): o indicador visual de som da vista `slot`: escreve ângulo (relativo à mira, positivo = à esquerda)
   * e força 0..1 dos sons recentes e devolve quantos (até o tamanho dos arrays).
   */
  fillIndicator(slot: number, angles: Float32Array, alphas: Float32Array): number;
  /** Pausa e troca de cena: corta o que está tocando. */
  silence(): void;
}

/** Opções reaproveitadas do `mixer.play` (regra 11: nada alocado por som). */
interface FlatOptions {
  bus: AudioBus;
  volume: number;
  priority: number;
  rate: number;
  /** M12 (fase 4): o lado do dano. */
  pan: number;
  /** M12 (fase 4, revisão): por cima do "duck" dos efeitos (a morte, o zumbido). */
  noDuck: boolean;
}
interface SpatialOptions {
  bus: AudioBus;
  volume: number;
  priority: number;
  rate: number;
  x: number;
  y: number;
  z: number;
  /** M12 (fase 4): o alcance (tiros e explosões vão mais longe). */
  range: number;
}

export function createMatchSound(deps: MatchSoundDeps): MatchSound {
  const { mixer } = deps;
  const lx = new Float64Array(4);
  const ly = new Float64Array(4);
  const lz = new Float64Array(4);
  const lyaw = new Float64Array(4);
  let listeners = 1;
  // Indicador: um anel de `BLIPS` por vista (ângulo absoluto no mundo, idade e força).
  const BLIPS = 8;
  const blipYaw = new Float64Array(4 * BLIPS);
  const blipAge = new Float32Array(4 * BLIPS).fill(Infinity);
  const blipStrength = new Float32Array(4 * BLIPS);
  const blipNext = new Uint8Array(4);
  const lastPlayed = new Float64Array(SOUND_IDS.length).fill(-1e9);
  const flat: FlatOptions = { bus: 'sfx', volume: 1, priority: 1, rate: 1, pan: 0, noDuck: false };
  const spatial: SpatialOptions = {
    bus: 'sfx',
    volume: 1,
    priority: 1,
    rate: 1,
    x: 0,
    y: 0,
    z: 0,
    range: MAX_DISTANCE_M,
  };
  const ray = createRayHit();
  let stepAcc = new Float32Array(0);
  let stepCount = new Uint32Array(0);
  let nearMark = new Uint8Array(0);
  const nearBest = new Int32Array(MATCH_SOUND.stepNearest);
  const nearD2 = new Float64Array(MATCH_SOUND.stepNearest);
  const heartT = new Float64Array(4);
  let familyOf: Uint8Array | null = null;
  // M3 (fase 6d): o relógio do próximo gemido de cada zumbi (NaN = ainda não sorteado) e o último gemido da partida.
  let groanT = new Float32Array(0);
  let groanN = new Uint32Array(0);
  // M12 (fase 4): o foley em tempos de cada bobo, em ticks da sim (revisão: o Aquário acelerado e a câmera lenta do
  // dono seguem): o tick do ferrolho (-1 = nenhum), a recarga longa (o tick em que começou, a duração em ticks e
  // quantos sons do meio já tocaram), o pente e a arma vistos (o cartucho da escopeta), o colete visto e a quebra dele
  // (o tick em que zerou, -1 = não, e se o último acerto desse tick foi seu).
  let boltTick = new Int32Array(0);
  let reloadTick = new Int32Array(0);
  let reloadDur = new Int32Array(0);
  let reloadStage = new Uint8Array(0);
  let clipSeen = new Int32Array(0);
  let weaponSeen = new Uint8Array(0);
  let armorSeen = new Uint8Array(0);
  let armorBreakTick = new Int32Array(0);
  let armorMine = new Uint8Array(0);
  // M12 (fase 4): as sequências de cada jogador local (o plic e o abate que sobem de tom).
  const hitStreak = new Uint8Array(4);
  const lastHitS = new Float64Array(4).fill(-1e9);
  const killStreak = new Uint8Array(4);
  const lastKillS = new Float64Array(4).fill(-1e9);
  let lastGroanS = -1e9;
  let lastCount = -1;
  let lastPhase: MatchPhase | null = null;
  let disposed = false;
  /** A vista do último `event`/`frame` (os objetivos tocam por ela). */
  let view: SimView | null = null;
  /** M12 (fase 4): o ambiente já pedido ao mixer (a pausa corta; o `frame` seguinte pede de novo). */
  let ambientOn = false;

  /** M12 (fase 4): o vento e os grilos em laço, quando a síntese deles já saiu (no loading). */
  const startAmbient = (): void => {
    const a = deps.ambient;
    if (ambientOn || a === undefined) return;
    if (a.wind && mixer.has('vento')) mixer.setAmbient(0, 'vento', SOUNDS.vento.volume, 2, WIND_RATE);
    if (a.night && mixer.has('grilos')) mixer.setAmbient(1, 'grilos', SOUNDS.grilos.volume, 2);
    ambientOn = true;
  };
  const stopAmbient = (fadeS: number): void => {
    if (!ambientOn) return;
    ambientOn = false;
    mixer.setAmbient(0, null, 0, fadeS);
    mixer.setAmbient(1, null, 0, fadeS);
  };

  const ensure = (capacity: number): void => {
    if (stepAcc.length >= capacity) return;
    stepAcc = new Float32Array(capacity);
    stepCount = new Uint32Array(capacity);
    nearMark = new Uint8Array(capacity);
    groanT = new Float32Array(capacity).fill(Number.NaN);
    groanN = new Uint32Array(capacity);
    boltTick = new Int32Array(capacity).fill(-1);
    reloadTick = new Int32Array(capacity).fill(-1);
    reloadDur = new Int32Array(capacity);
    reloadStage = new Uint8Array(capacity);
    clipSeen = new Int32Array(capacity).fill(-1);
    weaponSeen = new Uint8Array(capacity);
    armorSeen = new Uint8Array(capacity);
    armorBreakTick = new Int32Array(capacity).fill(-1);
    armorMine = new Uint8Array(capacity);
  };

  /** M3 (fase 6d): som de um bobo local "na cabeça"; de outro, no mundo onde ele está. */
  const playBy = (v: SimView, id: SoundId, entity: number, nowS: number, volume = 1): void => {
    if (localIndex(entity) >= 0) {
      playFlat(id, nowS, volume);
      return;
    }
    const i = at(v, entity);
    if (i < 0) return;
    const o = i * 3;
    playAt(
      v,
      id,
      null,
      v.position[o]!,
      v.position[o + 1]! + MATCH_SOUND.handsM,
      v.position[o + 2]!,
      nowS,
      rankOf(v, entity),
      volume,
    );
  };

  /**
   * M12 (fase 4): foley de arma do bobo `i` (o da mão): na cabeça se é seu, no mundo até `foleyRangeM` se é de outro.
   * O tom vem da classe da arma vezes `pitch`.
   */
  const playFoley = (v: SimView, id: SoundId, i: number, nowS: number, volume: number, pitch: number): void => {
    const rate = foleyPitch(v.weapon[i]!) * pitch;
    const e = makeEntityId(i, v.generation[i]!);
    if (isLocalIndex(v, i)) {
      playFlat(id, nowS, volume, SOUND_RANK.own, rate, 0, true);
      return;
    }
    const o = i * 3;
    const x = v.position[o]!;
    const y = v.position[o + 1]! + MATCH_SOUND.handsM;
    const z = v.position[o + 2]!;
    if (listenerDistance(x, y, z) <= MATCH_SOUND.foleyRangeM)
      playAt(v, id, null, x, y, z, nowS, rankOf(v, e), volume, rate);
  };

  /** M3 (fase 6d): o gemido (ou o rugido do chefão) de cada zumbi perto de algum ouvinte, espaçado. */
  const groans = (v: SimView, dt: number, nowS: number): void => {
    const range2 = MATCH_SOUND.groanRangeM * MATCH_SOUND.groanRangeM;
    for (let i = 0; i < v.count; i++) {
      if (v.kind[i] !== ENTITY_KIND.zombie || v.alive[i] !== 1 || v.flags[i]! & ENTITY_FLAG.dead) {
        groanT[i] = Number.NaN;
        continue;
      }
      const boss = v.zombieType[i] === ZOMBIE_TYPE.boss;
      if (Number.isNaN(groanT[i]!)) {
        // Recém-nascido: o primeiro gemido sai num ponto sorteado do intervalo (os da onda não gemem juntos).
        groanT[i] = unit(hash2(i, groanN[i]!)) * (boss ? MATCH_SOUND.roarMinS : MATCH_SOUND.groanMaxS);
        continue;
      }
      groanT[i] = groanT[i]! - dt;
      if (groanT[i]! > 0) continue;
      const n = groanN[i]!++;
      const h = hash2(i + 7919, n);
      const lo = boss ? MATCH_SOUND.roarMinS : MATCH_SOUND.groanMinS;
      const hi = boss ? MATCH_SOUND.roarMaxS : MATCH_SOUND.groanMaxS;
      groanT[i] = lo + unit(h) * (hi - lo);
      if (!boss && nowS - lastGroanS < MATCH_SOUND.groanGapS) continue;
      const o = i * 3;
      const x = v.position[o]!;
      const y = v.position[o + 1]! + MATCH_SOUND.eyeM;
      const z = v.position[o + 2]!;
      let near = false;
      for (let l = 0; l < listeners && !near; l++) {
        const dx = x - lx[l]!;
        const dz = z - lz[l]!;
        near = dx * dx + dz * dz <= range2;
      }
      if (!near) continue;
      if (!boss) lastGroanS = nowS;
      const id = boss ? 'chefao-rugido' : GROAN_SOUNDS[h % GROAN_SOUNDS.length]!;
      // Tom ±10% (o Sprinter mais agudo, o Chonker mais grave).
      const type = v.zombieType[i]!;
      const pitch = type === ZOMBIE_TYPE.sprinter ? 1.18 : type === ZOMBIE_TYPE.chonker ? 0.82 : 1;
      playAt(v, id, null, x, y, z, nowS, SOUND_RANK.world, 1, pitch * (0.9 + unit(h >>> 3) * 0.2));
    }
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

  /** M10 (fase 8, revisão): o último ricochete tocado (tick e atirador): os chumbos do mesmo tiro viram um som só. */
  let ricochetTick = -1;
  let ricochetShooter = -1;
  /** M12 (fase 4): o último tiro tocado (tick e atirador): a escopeta manda um `shot` por chumbo. */
  let shotTick = -1;
  let shotShooter = -1;
  let shotRank: number = SOUND_RANK.world;

  /** Ainda no cooldown? (Sem marcar: o tiro olha os dois sons, de perto e de longe, antes do raio da parede.) */
  const cooling = (id: SoundId, nowS: number): boolean =>
    nowS - lastPlayed[SOUND_INDEX.get(id)!]! < SOUNDS[id].cooldownS;

  /**
   * Cooldown por som entre os sons dos OUTROS. `own` (a própria arma, o próprio movimento) passa sempre e não marca:
   * M12 (fase 4) — antes marcava, e com o seu fuzil a 600 rpm uns 40% dos tiros do inimigo com a mesma arma sumiam.
   * `false` = ainda no cooldown.
   */
  const ready = (id: SoundId, nowS: number, own: boolean): boolean => {
    if (own) return true;
    if (cooling(id, nowS)) return false;
    lastPlayed[SOUND_INDEX.get(id)!] = nowS;
    return true;
  };

  const ownGain = (): number => (deps.humans >= 3 ? MATCH_SOUND.ownCrowdGain : 1);

  /**
   * Som "na cabeça" do jogador (sem posição): retorno, a própria arma. M12 (fase 4): o retorno (dano, morte, coração,
   * abate, plic…) respeita o cooldown; só a própria arma (`own`) passa sempre. `pan` é o lado do dano. `true` = tocou.
   */
  const playFlat = (
    id: SoundId,
    nowS: number,
    volume = 1,
    priority: number = SOUNDS[id].priority,
    rate = 1,
    pan = 0,
    own = false,
    noDuck = false,
  ): boolean => {
    if (!ready(id, nowS, own)) return false;
    const def = SOUNDS[id];
    flat.bus = def.bus;
    flat.volume = Math.min(1, def.volume * volume);
    flat.priority = priority;
    flat.rate = rate;
    flat.pan = pan;
    flat.noDuck = noDuck;
    mixer.play(id, flat);
    return true;
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

  /**
   * Marca o som no indicador da vista que o ouve (a do ouvinte mais perto, achada pelo último `listenerDistance`),
   * se estiver no alcance. `yaw` do mundo para o ponto: a mesma convenção da câmera (yaw 0 olha para −z).
   */
  const blip = (x: number, z: number, d: number, strength: number): void => {
    if (d > MATCH_SOUND.indicatorRangeM || d < 1) return;
    const l = nearestL;
    const k = l * BLIPS + blipNext[l]!;
    blipNext[l] = (blipNext[l]! + 1) % BLIPS;
    blipYaw[k] = Math.atan2(-(x - lx[l]!), -(z - lz[l]!));
    blipAge[k] = 0;
    blipStrength[k] = strength;
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

  /**
   * Som no mundo: distância e pan pelo mixer, mais a troca perto/longe e a parede. M12 (fase 4): atrás de parede, o que
   * tem amostra de longe toca ela a −3 dB (o raio roda antes do cooldown: ele escolhe o som); o resto, −6 dB. `range`
   * é o alcance (tiros e explosões até 150 m).
   */
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
    indicator = 0,
    range: number = MAX_DISTANCE_M,
  ): void => {
    const d = listenerDistance(x, y, z);
    if (d >= range) return;
    if (indicator > 0 && priority !== SOUND_RANK.own) blip(x, z, d, indicator);
    const own = priority === SOUND_RANK.own;
    // O som que vai tocar no cooldown: nem roda o raio (longe, é a amostra de longe; perto, depende da parede).
    if (!own) {
      if (far !== null && d > MATCH_SOUND.farM) {
        if (cooling(far, nowS)) return;
      } else if (cooling(id, nowS) && (far === null || cooling(far, nowS))) return;
    }
    // Revisão: além do alcance de sempre (60 m), o tiro e a explosão de longe cedem a voz a tudo (os passos perto).
    if (d > MAX_DISTANCE_M && priority > SOUND_RANK.world) priority = SOUND_RANK.world;
    const wall = occluded(v, x, y, z, d);
    const sound = far !== null && (d > MATCH_SOUND.farM || wall) ? far : id;
    if (!ready(sound, nowS, own)) return;
    const def = SOUNDS[sound];
    const muffle = wall ? (far !== null ? MATCH_SOUND.occludedFarGain : MATCH_SOUND.occludedGain) : 1;
    spatial.bus = def.bus;
    spatial.volume = Math.min(1, def.volume * volume * muffle);
    spatial.priority = priority;
    spatial.rate = rate;
    spatial.x = x;
    spatial.y = y;
    spatial.z = z;
    spatial.range = range;
    mixer.play(sound, spatial);
  };

  /** Índice de uma entidade viva (os pés estão em `position`), ou -1. */
  const at = (v: SimView, entity: number): number => {
    const i = entityIndex(entity);
    return entity !== NULL_ENTITY && i < v.count && v.alive[i] === 1 ? i : -1;
  };

  /** O passo do material sob os pés do bobo `i` (o par de cada material alterna). */
  const stepSound = (v: SimView, i: number, n: number): SoundId => {
    const o = i * 3;
    return STEP_SOUND[floorFamily(v, v.position[o]!, v.position[o + 1]!, v.position[o + 2]!)]![n & 1]!;
  };

  const playStep = (v: SimView, i: number, nowS: number, own: boolean): void => {
    const o = i * 3;
    const n = stepCount[i]!++;
    // Tom de cada passo varia ±7% (hash do bobo e do passo; sem Math.random fora da sim também, para os testes); M12:
    // o passo ímpar um pouco mais grave, e o volume ±10% (outros bits do mesmo hash).
    const h = Math.imul(i * 0x9e3779b1 + n, 0x85ebca6b) >>> 0;
    const rate = (0.93 + ((h >>> 8) / 0xffffff) * 0.14) * (n & 1 ? MATCH_SOUND.oddStepPitch : 1);
    const spread = 1 - MATCH_SOUND.stepGainSpread + ((h & 0xff) / 0xff) * 2 * MATCH_SOUND.stepGainSpread;
    const flags = v.flags[i]!;
    const gait = flags & ENTITY_FLAG.sprinting ? MATCH_SOUND.sprintStepGain : MATCH_SOUND.walkStepGain;
    const volume = gait * spread * (flags & ENTITY_FLAG.crouching ? MATCH_SOUND.crouchGain : 1) * (own ? 0.8 : 1);
    const x = v.position[o]!;
    const y = v.position[o + 1]!;
    const z = v.position[o + 2]!;
    playAt(v, stepSound(v, i, n), null, x, y, z, nowS, SOUND_RANK.world, volume, rate, own ? 0 : 0.55 * volume);
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

  /** M12 (fase 4): o mundo abafa (só com 1 jogador e sem "Reduzir efeitos"). */
  const canDuck = (): boolean => deps.humans === 1 && deps.reduceEffects?.() !== true;

  /** M12 (fase 4): a morte do jogador local: o som dela e, depois do golpe, o mundo 10 dB abaixo por 1,5 s. */
  const died = (nowS: number): void => {
    // Revisão: a morte toca por cima do abafado (fora do "duck"), e o mundo cai na hora.
    playFlat('morte', nowS, 1, SOUNDS.morte.priority, 1, 0, false, true);
    if (canDuck()) mixer.duckBus('sfx', MATCH_SOUND.deathDuckDb, MATCH_SOUND.deathDuckS);
  };

  /**
   * M12 (fase 4): o zunido da bala de outro que passa perto da cabeça de um jogador local (um por tiro; o cooldown do
   * som espaça a rajada).
   */
  const whiz = (v: SimView, ev: ShotEvent, nowS: number): void => {
    for (let p = 0; p < deps.humans; p++) {
      const e = deps.localEntity(p);
      if (e === ev.shooter) continue;
      const i = at(v, e);
      if (i < 0 || v.flags[i]! & ENTITY_FLAG.dead) continue;
      const o = i * 3;
      const d = whizPoint(
        ev.originX,
        ev.originY,
        ev.originZ,
        ev.dirX,
        ev.dirY,
        ev.dirZ,
        ev.distance,
        v.position[o]!,
        v.position[o + 1]! + MATCH_SOUND.eyeM,
        v.position[o + 2]!,
      );
      if (d < 0) continue;
      playAt(v, 'zunido', null, whizOut.x, whizOut.y, whizOut.z, nowS, SOUND_RANK.hurt);
      return;
    }
  };

  /** M12 (fase 4): o tique do pente no fim, depois do seu tiro (o tom sobe até a última bala). */
  const lowMagTick = (v: SimView, shooter: number, nowS: number): void => {
    const i = at(v, shooter);
    if (i < 0) return;
    const def = weaponDef(v.weapon[i]!);
    if (def === null) return;
    const pitch = lowMagPitch(heldClip(v, i), def.clipSize);
    if (pitch > 0) playFlat('tique', nowS, 1, SOUND_RANK.own, pitch, 0, true);
  };

  /** M12 (fase 4): os objetivos dos modos (a Boom Box, os pontos, a zona, as rodadas, a Roleta, o ping, a arma). */
  const objective = createObjectiveSound({
    flat(id, nowS, volume, rate) {
      playFlat(id, nowS, volume, SOUNDS[id].priority, rate);
    },
    at(id, x, y, z, nowS, priority, volume, rate, nearM) {
      if (view === null) return;
      if (nearM > 0) {
        // Longe: o som vem de `nearM` na mesma direção (o lado fica, o volume não some).
        const d = listenerDistance(x, y, z);
        if (d > nearM) {
          const l = nearestL;
          const k = nearM / d;
          x = lx[l]! + (x - lx[l]!) * k;
          y = ly[l]! + (y - ly[l]!) * k;
          z = lz[l]! + (z - lz[l]!) * k;
        }
      }
      playAt(view, id, null, x, y, z, nowS, priority, volume, rate);
    },
    listenerDistance,
    myTeam(v) {
      if (deps.ffa) return -1;
      const e = deps.localEntity(0);
      const i = entityIndex(e);
      if (e === NULL_ENTITY || i >= v.count) return -1;
      const team = v.team[i]!;
      return team === NO_TEAM ? -1 : team;
    },
    isLocal: (entity) => localIndex(entity) >= 0,
  });

  /**
   * M12 (fase 4): o foley em tempos (o ferrolho, a recarga longa, o cartucho, em ticks da sim) e o colete: o que zerou
   * com o seu acerto como o último dano daquele tick toca aqui (revisão: outro quebrando no mesmo tick não conta).
   */
  const foley = (v: SimView, nowS: number): void => {
    for (let i = 0; i < v.count; i++) {
      if (armorMine[i] === 1) playFlat('impacto-vidro', nowS, 2, SOUND_RANK.own, 0.75, 0, true);
      armorMine[i] = 0;
      armorBreakTick[i] = -1;
      const flags = v.flags[i]!;
      if (v.alive[i] !== 1 || v.kind[i] !== ENTITY_KIND.bobo || flags & ENTITY_FLAG.dead) {
        boltTick[i] = -1;
        reloadTick[i] = -1;
        clipSeen[i] = -1;
        armorSeen[i] = 0;
        continue;
      }
      armorSeen[i] = v.armor[i]!;
      // O ferrolho da sniper e o pump da escopeta, 0,3 s depois do tiro.
      if (boltTick[i]! >= 0 && v.tick >= boltTick[i]!) {
        boltTick[i] = -1;
        playFoley(v, 'ferrolho', i, nowS, 1, 0.97 + unit(hash2(i, v.tick)) * 0.06);
      }
      const weapon = v.weapon[i]!;
      const reloading = (flags & ENTITY_FLAG.reloading) !== 0;
      // A recarga longa (a LMG muda 4,5 s): a tampa aos 40% e a fita aos 70%.
      if (reloadTick[i]! >= 0) {
        if (!reloading) reloadTick[i] = -1;
        else {
          const u = (v.tick - reloadTick[i]!) / Math.max(1, reloadDur[i]!);
          if (reloadStage[i] === 0 && u >= 0.4) {
            reloadStage[i] = 1;
            playFoley(v, 'troca-arma', i, nowS, 0.7, 0.8);
          } else if (reloadStage[i] === 1 && u >= 0.7) {
            reloadStage[i] = 2;
            playFoley(v, 'recarga-tira', i, nowS, 0.6, 0.85);
          }
        }
      }
      // O cartucho da escopeta: a sim não avisa cada um; o pente sobe recarregando.
      const clip = heldClip(v, i);
      if (reloading && weapon === weaponSeen[i] && clipSeen[i]! >= 0 && clip > clipSeen[i]!) {
        const def = weaponDef(weapon);
        if (def !== null && def.reloadPerRoundS > 0) playFoley(v, 'recarga-poe', i, nowS, 0.6, 1.3);
      }
      clipSeen[i] = clip;
      weaponSeen[i] = weapon;
    }
  };

  return {
    setListener(slot, x, y, z, yaw) {
      if (slot < 0 || slot > 3) return;
      lx[slot] = x;
      ly[slot] = y;
      lz[slot] = z;
      lyaw[slot] = yaw;
      mixer.setListener(slot, x, y, z, yaw);
    },
    setListenerCount(count) {
      listeners = Math.max(1, Math.min(4, count));
      mixer.setListenerCount(listeners);
      // M12 (fase 4): com 3 ou 4 vistas no sofá, o pan pela metade.
      mixer.setPanWidth(listeners >= 3 ? MATCH_SOUND.crowdPanWidth : 1);
    },
    event(ev, v, nowS) {
      if (disposed) return;
      ensure(v.capacity);
      view = v;
      objective.event(ev, v, nowS);
      switch (ev.type) {
        case 'shot': {
          // M12 (fase 4): o som do tiro, um só por tiro (a escopeta manda um `shot` por chumbo); o zunido testa cada
          // chumbo, depois do tiro.
          // Revisão: só a bala do inimigo zune (o parentesco do 1º chumbo vale para os outros).
          const first = ev.tick !== shotTick || ev.shooter !== shotShooter;
          if (first) shotRank = rankOf(v, ev.shooter);
          shotTick = ev.tick;
          shotShooter = ev.shooter;
          const pair = first ? shotSounds(weaponBase(ev.weapon)) : null;
          if (pair === null) {
            if (shotRank === SOUND_RANK.enemy) whiz(v, ev, nowS);
            break;
          }
          const base = weaponBase(ev.weapon);
          const rank = shotRank;
          // M6 (fase 3): a Big Brrt é o tiro da SMG uma quarta abaixo (o "brrt" grave da minigun), um pouco mais baixo.
          // M12 (fase 4): cada tiro com o tom 0,96–1,04 e −1–0 dB (pelo tick e por quem atirou); a LMG mais grave.
          const brrt = ev.weapon === WEAPON_BIG_BRRT;
          const auto = ev.weapon === WEAPON_CODE.autoShotgun;
          const kind = brrt
            ? BIG_BRRT_PITCH
            : auto
              ? AUTO_SHOTGUN_PITCH
              : base === WEAPON_CODE.lmg
                ? SOUND_FEEL.lmgPitch
                : 1;
          const pitch = kind * shotPitch(ev.tick, ev.shooter);
          const gain = (brrt ? BIG_BRRT_GAIN : auto ? AUTO_SHOTGUN_GAIN : 1) * shotGain(ev.tick, ev.shooter);
          if (rank === SOUND_RANK.own) {
            playFlat(pair[0], nowS, ownGain() * gain, SOUND_RANK.own, pitch, 0, true);
            lowMagTick(v, ev.shooter, nowS);
          } else {
            const range = MATCH_SOUND.farRangeM;
            playAt(v, pair[0], pair[1], ev.originX, ev.originY, ev.originZ, nowS, rank, gain, pitch, 1, range);
            if (rank === SOUND_RANK.enemy) whiz(v, ev, nowS);
          }
          // M12 (fase 4): o pump e o ferrolho, 0,3 s depois (em ticks: o Aquário acelerado e a câmera lenta seguem).
          if (cyclesAfterShot(ev.weapon)) {
            const i = at(v, ev.shooter);
            if (i >= 0) boltTick[i] = ev.tick + BOLT_TICKS;
          }
          break;
        }
        case 'impact':
          // M12 (fase 4): o tom de cada impacto ±8% pela célula (e pelo tick).
          playAt(
            v,
            IMPACT_SOUND[ev.prop >= 0 ? FAMILY.wood : (families(v)[ev.block] ?? FAMILY.concrete)]!,
            null,
            ev.x,
            ev.y,
            ev.z,
            nowS,
            SOUND_RANK.world,
            1,
            impactPitch(ev.cellX, ev.cellY, ev.cellZ, ev.tick),
          );
          break;
        case 'ricochet': {
          // M10 (fase 8): o "piiiu" no ponto do quique (o impacto na parede já tocou junto). Os chumbos do mesmo tiro
          // (mesmo atirador, mesmo tick) viram um som só; o seu não espera o cooldown dos outros (revisão). O tom varia
          // ±12% pelo tick e pela arma (sem sorteio fora da sim, para os testes repetirem).
          if (ev.tick === ricochetTick && ev.shooter === ricochetShooter) break;
          ricochetTick = ev.tick;
          ricochetShooter = ev.shooter;
          const rate = 0.88 + unit(hash2(ev.tick, ev.weapon)) * 0.24;
          playAt(v, 'ricochete', null, ev.x, ev.y, ev.z, nowS, rankOf(v, ev.shooter), 1, rate);
          break;
        }
        case 'hit': {
          const shooterP = localIndex(ev.shooter);
          const targetP = localIndex(ev.target);
          // M12 (fase 4): sem "plic" no dano zero (proteção de nascimento, fim da partida); o tom sobe 3% a cada acerto
          // seguido (até 0,3 s um do outro), até +15%.
          if (shooterP >= 0 && deps.hitmarker && ev.shooter !== ev.target && ev.damage > 0) {
            const streak = nowS - lastHitS[shooterP]! <= SOUND_FEEL.hitStreakS ? hitStreak[shooterP]! + 1 : 0;
            const id: SoundId = ev.part === 'head' ? 'ploc' : 'hitmarker';
            if (playFlat(id, nowS, 1, SOUNDS[id].priority, hitStreakPitch(streak))) {
              hitStreak[shooterP] = Math.min(255, streak);
              lastHitS[shooterP] = nowS;
            }
          }
          // M12 (fase 4): o colete do alvo zerou (BoboStrike e Royale): conta o tick em que zerou e se o último acerto
          // desse tick foi seu; toca no rame() (revisão: outro quebrando no mesmo tick depois de você não conta).
          const ti = entityIndex(ev.target);
          if (ti < v.count && armorSeen[ti]! > 0 && v.armor[ti] === 0) {
            if (armorBreakTick[ti]! < 0) armorBreakTick[ti] = ev.tick;
            if (ev.tick === armorBreakTick[ti]) armorMine[ti] = shooterP >= 0 && ev.shooter !== ev.target ? 1 : 0;
          }
          // M12 (fase 4): o dano com o lado de onde veio (só com 1 jogador: na tela dividida o som é de todos).
          if (targetP >= 0) {
            if (ev.damage > 0) {
              const pan = deps.humans === 1 ? hurtPan(ev.dirX, ev.dirZ, lyaw[0]!) : 0;
              playFlat('dano', nowS, 1, SOUNDS.dano.priority, 1, pan);
            }
          } else playAt(v, 'impacto-bobo', null, ev.x, ev.y, ev.z, nowS, rankOf(v, ev.target));
          break;
        }
        case 'kill': {
          if (localIndex(ev.victim) >= 0) died(nowS);
          else {
            // M12 (fase 4): o abate sobe de tom a cada abate em 4 s (conta o abate, mesmo que o som caia no cooldown).
            const p = localIndex(ev.killer);
            if (p >= 0) {
              const streak = nowS - lastKillS[p]! <= SOUND_FEEL.killStreakS ? killStreak[p]! + 1 : 0;
              killStreak[p] = Math.min(255, streak);
              lastKillS[p] = nowS;
              playFlat('abate', nowS, 1, SOUNDS.abate.priority, killStreakPitch(streak));
            }
          }
          break;
        }
        case 'melee': {
          const i = at(v, ev.attacker);
          if (i >= 0) {
            const o = i * 3;
            const rank = rankOf(v, ev.attacker);
            if (rank === SOUND_RANK.own) playFlat('faca-golpe', nowS, 1, SOUNDS['faca-golpe'].priority, 1, 0, true);
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
          const own = rank === SOUND_RANK.own;
          // M12 (fase 4): os disparos também variam um pouco (o tom pelo tick e por quem atirou).
          const vary = shotPitch(ev.tick, ev.owner);
          if (ev.action === 'bounce') {
            const speed = Math.hypot(ev.vx, ev.vy, ev.vz);
            playAt(v, 'granada-quica', null, ev.x, ev.y, ev.z, nowS, rank, Math.min(1, 0.3 + speed / 12));
          } else if (ev.action === 'stick') {
            // M10 (fase 7): o virote cravando no bloco.
            playAt(v, 'virote-crava', null, ev.x, ev.y, ev.z, nowS, SOUND_RANK.world);
          } else if (ev.weapon === WEAPON_CODE.crossbow || ev.weapon === WEAPON_CODE.grenadeLauncher) {
            // M10 (fase 7): a corda da besta e o "bloop" do lança-granadas.
            const id: SoundId = ev.weapon === WEAPON_CODE.crossbow ? 'besta' : 'lanca-granadas';
            if (own) playFlat(id, nowS, ownGain(), rank, vary, 0, true);
            else playAt(v, id, null, ev.x, ev.y, ev.z, nowS, rank, 1, vary);
          } else if (isPaintWeapon(ev.weapon) && ev.weapon !== WEAPON_PAINT_BUCKET) {
            // M6 (fase 5): o marcador de tinta: o tiro da arma parecida, bem mais agudo e baixo (um "pop").
            const id: SoundId =
              ev.weapon === WEAPON_PAINT_SNIPER
                ? 'tiro-sniper'
                : ev.weapon === WEAPON_PAINT_PUMP
                  ? 'tiro-escopeta'
                  : 'tiro-smg';
            if (own) playFlat(id, nowS, ownGain() * PAINT_GAIN, rank, PAINT_PITCH * vary, 0, true);
            else playAt(v, id, null, ev.x, ev.y, ev.z, nowS, rank, PAINT_GAIN, PAINT_PITCH * vary, 1);
          } else if (ev.weapon === WEAPON_CODE.rocket) {
            if (own) playFlat('foguete', nowS, ownGain(), rank, vary, 0, true);
            else playAt(v, 'foguete', null, ev.x, ev.y, ev.z, nowS, rank, 1, vary);
          } else if (ev.weapon === WEAPON_DESMONTADOR) {
            // M3 (fase 4e): o raio do Desmontador: o sopro do foguete, bem mais agudo.
            if (own) playFlat('foguete', nowS, ownGain(), rank, 1.9, 0, true);
            else playAt(v, 'foguete', null, ev.x, ev.y, ev.z, nowS, rank, 1, 1.9);
          } else if (ev.weapon === WEAPON_SPIT) {
            // M3 (fase 6d): o cuspe do Spitter.
            playAt(v, 'cuspe', null, ev.x, ev.y, ev.z, nowS, rank);
          } else if (ev.weapon === WEAPON_CODE.grenade || ev.weapon === WEAPON_PAINT_BUCKET) {
            // Arremesso: o mesmo sopro da faca, mais grave.
            if (own) playFlat('faca-golpe', nowS, 0.8, rank, 0.75, 0, true);
            else playAt(v, 'faca-golpe', null, ev.x, ev.y, ev.z, nowS, rank, 0.8, 0.75);
          }
          break;
        }
        case 'explosion': {
          // M6 (fase 5): a tinta estoura com a gosma (a bola baixinho e aguda; o balde inteiro), sem abaixar a música.
          if (isPaintWeapon(ev.weapon)) {
            const bucket = ev.radius > 0;
            playAt(
              v,
              'gosma',
              null,
              ev.x,
              ev.y,
              ev.z,
              nowS,
              SOUND_RANK.world,
              bucket ? 1 : 0.35,
              bucket ? 1.2 : 1.8,
              0,
            );
            break;
          }
          // A música abaixa 6 dB nas explosões (arte-ux §10.4), se estiver tocando na partida.
          if (listenerDistance(ev.x, ev.y, ev.z) < MAX_DISTANCE_M)
            mixer.duckMusic(MATCH_SOUND.duckDb, MATCH_SOUND.duckS);
          // M3 (fase 6d): o Chonker estoura em gosma, sem o estrondo.
          if (ev.weapon === WEAPON_GOO) {
            playAt(v, 'gosma', null, ev.x, ev.y, ev.z, nowS, SOUND_RANK.enemy, 1, 1, 1);
            break;
          }
          playAt(
            v,
            'explosao',
            'explosao-longe',
            ev.x,
            ev.y,
            ev.z,
            nowS,
            Math.max(rankOf(v, ev.owner), SOUND_RANK.enemy),
            1,
            1,
            1,
            MATCH_SOUND.farRangeM,
          );
          // M12 (fase 4): colada (a menos de 4 m da cabeça do jogador), o mundo abafa e o ouvido zune.
          if (canDuck()) {
            const i = at(v, deps.localEntity(0));
            if (i >= 0 && !(v.flags[i]! & ENTITY_FLAG.dead)) {
              const o = i * 3;
              const dx = ev.x - v.position[o]!;
              const dy = ev.y - v.position[o + 1]! - MATCH_SOUND.eyeM;
              const dz = ev.z - v.position[o + 2]!;
              const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
              if (d < MATCH_SOUND.blastNearM) {
                mixer.duckBus('sfx', MATCH_SOUND.blastDuckDb, MATCH_SOUND.blastDuckS, MATCH_SOUND.blastDuckDelayS);
                // O zumbido fica por cima do abafado que ele acompanha (fora do duck).
                const gain = 1 - (0.5 * d) / MATCH_SOUND.blastNearM;
                playFlat('zumbido', nowS, gain, SOUNDS.zumbido.priority, 1, 0, false, true);
              }
            }
          }
          break;
        }
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
          // M12 (fase 4): a recarga longa ganha o foley do meio; trocar ou terminar cancela.
          if (ev.action === 'reloadStart') {
            const def = weaponDef(ev.weapon);
            if (def !== null && def.reloadPerRoundS === 0 && def.reloadS >= MATCH_SOUND.reloadMidS) {
              reloadTick[i] = ev.tick;
              reloadDur[i] = Math.round(def.reloadS * SIM_HZ);
              reloadStage[i] = 0;
            }
          } else if (ev.action === 'switch' || ev.action === 'reloadEnd') reloadTick[i] = -1;
          // M12 (fase 4): o tom do foley pela classe da arma (a pistola mais aguda, as pesadas mais graves).
          const rate = ev.action === 'cook' ? 1 : foleyPitch(ev.weapon);
          const rank = rankOf(v, ev.entity);
          if (rank === SOUND_RANK.own) {
            playFlat(id, nowS, 1, rank, rate, 0, true);
            break;
          }
          const o = i * 3;
          const x = v.position[o]!;
          const y = v.position[o + 1]! + MATCH_SOUND.handsM;
          const z = v.position[o + 2]!;
          if (listenerDistance(x, y, z) <= MATCH_SOUND.foleyRangeM) playAt(v, id, null, x, y, z, nowS, rank, 1, rate);
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
          const rank = own ? SOUND_RANK.own : SOUND_RANK.world;
          const x = v.position[o]!;
          const y = v.position[o + 1]!;
          const z = v.position[o + 2]!;
          playAt(v, id, null, x, y, z, nowS, rank, volume);
          // M12 (fase 4): o pouso pisa no material do chão (a madeira, a grama, o metal).
          if (ev.move === 'land') {
            const n = stepCount[i]!++;
            playAt(v, stepSound(v, i, n), null, x, y, z, nowS, rank, volume * 1.1, 0.9);
          }
          break;
        }
        case 'pickup':
          // M7 (fase 8): os itens do Royale (o loot nasce aos montes no tick 0): só quem pega ouve.
          if (ev.kind >= PICKUP_KIND.armor50) {
            if (ev.action === 'take' && localIndex(ev.entity) >= 0) playFlat('municao', nowS);
            break;
          }
          if (ev.kind === PICKUP_KIND.ammoBox) {
            if (ev.action === 'take' && localIndex(ev.entity) >= 0) playFlat('municao', nowS);
            break;
          }
          // M3 (fase 6d): os drops do Zombies: o brilho onde caiu e, ao pegar, a fanfarra para o time todo (a bomba
          // ainda estoura).
          if (ev.action === 'drop') playAt(v, 'drop-aparece', null, ev.x, ev.y + 0.5, ev.z, nowS, SOUND_RANK.world);
          else {
            playFlat('drop-pega', nowS);
            if (ev.kind === PICKUP_KIND.nuke) playFlat('explosao', nowS, 0.8, SOUND_RANK.ui);
          }
          break;
        case 'wave':
          playFlat(ev.action === 'start' ? 'onda-comeca' : 'onda-limpa', nowS);
          break;
        case 'down':
          if (ev.action === 'down') {
            if (localIndex(ev.entity) >= 0) died(nowS);
          } else playBy(v, 'levantou', ev.entity, nowS);
          break;
        case 'spawn': {
          // O Mega Bobo chegou: o rugido na hora.
          const i = at(v, ev.entity);
          if (i < 0 || v.kind[i] !== ENTITY_KIND.zombie || v.zombieType[i] !== ZOMBIE_TYPE.boss) break;
          const o = i * 3;
          playAt(
            v,
            'chefao-rugido',
            null,
            v.position[o]!,
            v.position[o + 1]! + MATCH_SOUND.eyeM,
            v.position[o + 2]!,
            nowS,
            SOUND_RANK.enemy,
          );
          break;
        }
        case 'barricade': {
          const mo = v.mapObjects;
          if (mo === null || ev.index >= mo.barricades) break;
          const x = mo.bx[ev.index]!;
          const y = mo.by[ev.index]! + mo.bh[ev.index]! * 0.5;
          const z = mo.bz[ev.index]!;
          if (ev.action === 'repair') playAt(v, 'tabua-poe', null, x, y, z, nowS, rankOf(v, ev.by));
          else playAt(v, 'tabua-arranca', null, x, y, z, nowS, SOUND_RANK.world, ev.action === 'break' ? 1 : 0.8);
          break;
        }
        case 'door': {
          if (ev.action === 'denied') {
            if (localIndex(ev.by) >= 0) playFlat('compra-negada', nowS);
            break;
          }
          const mo = v.mapObjects;
          if (mo === null || ev.index >= mo.doors) break;
          const o = ev.index * 6;
          const b = mo.doorBox;
          playAt(
            v,
            'porta-abre',
            null,
            (b[o]! + b[o + 3]!) * 0.5,
            (b[o + 1]! + b[o + 4]!) * 0.5,
            (b[o + 2]! + b[o + 5]!) * 0.5,
            nowS,
            rankOf(v, ev.by),
          );
          break;
        }
        case 'purchase':
          if (ev.action === 'denied') {
            if (localIndex(ev.by) >= 0) playFlat('compra-negada', nowS);
          } else playBy(v, ev.kind === 'perk' ? 'vantagem' : 'compra', ev.by, nowS);
          break;
        case 'box': {
          if (ev.action === 'denied') {
            if (localIndex(ev.by) >= 0) playFlat('compra-negada', nowS);
            break;
          }
          if (ev.action === 'take') {
            playBy(v, 'compra', ev.by, nowS);
            break;
          }
          const mo = v.mapObjects;
          if (mo === null || ev.index >= mo.boxSpots) break;
          const x = mo.boxX[ev.index]!;
          const y = mo.boxY[ev.index]! + 0.6;
          const z = mo.boxZ[ev.index]!;
          const rank = rankOf(v, ev.by);
          if (ev.action === 'open') {
            playAt(v, 'caixa-abre', null, x, y, z, nowS, rank);
            playAt(v, 'caixa-gira', null, x, y, z, nowS, rank);
          } else if (ev.action === 'move') playAt(v, 'caixa-ursinho', null, x, y, z, nowS, rank);
          break;
        }
        case 'matchPhase': {
          if (ev.phase !== 'ended') break;
          const me = deps.localEntity(0);
          const i = entityIndex(me);
          let win = false;
          let tie = false;
          if (deps.ffa || deps.soloWinner === true) {
            win = v.match.winnerEntity === me && me !== NULL_ENTITY;
            tie = v.match.winnerEntity === NULL_ENTITY;
          } else {
            win = me !== NULL_ENTITY && i < v.count && v.match.winnerTeam === v.team[i];
            // Revisão: contra os zumbis, sem vencedor é a derrota (a sim grava -1 quando o time cai).
            tie = v.match.winnerTeam < 0 && deps.coop !== true;
          }
          // M12 (fase 4): as vinhetas de 3 s e o empate (antes mudo), com a música 8 dB abaixo durante.
          playFlat(tie ? 'empate' : win ? 'vitoria' : 'derrota', nowS);
          mixer.duckMusic(MATCH_SOUND.jingleDuckDb, MATCH_SOUND.duckS, MATCH_SOUND.jingleS);
          break;
        }
        default:
          break;
      }
    },
    frame(v, dt, nowS) {
      if (disposed) return;
      ensure(v.capacity);
      view = v;
      for (let k = 0; k < blipAge.length; k++) blipAge[k] = blipAge[k]! + dt;
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
      // M12 (fase 4): o ambiente, os objetivos e o foley em tempos.
      startAmbient();
      objective.frame(v, dt, nowS);
      foley(v, nowS);
      // M3 (fase 6d): os gemidos dos zumbis.
      groans(v, dt, nowS);
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
      // Vida baixa: o coração de cada jogador local. M12 (fase 4): com `hp ≤ 0,3·máxima` (o limite da vinheta da HUD),
      // de 1 s entre batidas ali a 0,55 s com 10% ou menos, e o volume de 0,6 ao cheio.
      for (let p = 0; p < Math.min(deps.humans, 4); p++) {
        const e = deps.localEntity(p);
        const i = at(v, e);
        const hp = i >= 0 ? v.health[i]! : 0;
        const max = deps.maxHealth?.(e) ?? 100;
        const low = i >= 0 && isLivePhase(phase) && !(v.flags[i]! & ENTITY_FLAG.dead) && isLowHealth(hp, max);
        if (!low) {
          heartT[p] = 0;
          continue;
        }
        heartT[p] = heartT[p]! - dt;
        if (heartT[p]! <= 0) {
          playFlat('coracao', nowS, heartGain(hp, max));
          heartT[p] = heartInterval(hp, max);
        }
      }
    },
    fillIndicator(slot, angles, alphas) {
      if (slot < 0 || slot > 3) return 0;
      let n = 0;
      for (let b = 0; b < BLIPS && n < angles.length && n < alphas.length; b++) {
        const k = slot * BLIPS + b;
        const age = blipAge[k]!;
        if (!(age < MATCH_SOUND.indicatorLifeS)) continue;
        let a = blipYaw[k]! - lyaw[slot]!;
        a -= Math.round(a / (Math.PI * 2)) * Math.PI * 2;
        angles[n] = a;
        alphas[n] = blipStrength[k]! * (1 - age / MATCH_SOUND.indicatorLifeS);
        n++;
      }
      return n;
    },
    silence() {
      mixer.stopAll();
      stopAmbient(0.1);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      mixer.stopAll();
      stopAmbient(0.3);
      mixer.setPanWidth(1);
      view = null;
    },
  };
}
