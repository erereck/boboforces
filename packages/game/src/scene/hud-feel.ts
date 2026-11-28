import {
  BOMB,
  ENTITY_FLAG,
  ENTITY_KIND,
  NULL_ENTITY,
  ROUND,
  ROUND_PHASE,
  STRIKE_DATA,
  ZONE,
  type SimView,
} from '@boboforces/sim';
import type { TouchLayout } from '@boboforces/input';
import {
  GO_SHOW_S,
  HUD_DAMAGE_ARCS,
  HUD_GAINS,
  MOTION,
  NOTICE_SHOW_S,
  enterProgress,
  t,
  type HudModel,
  type StringKey,
} from '@boboforces/ui';

/**
 * M12 (fase 2): a HUD com peso (ARCHITECTURE §23.2). A lógica dos tempos e dos estados da HUD, fora da cena: o que
 * acende e por quanto tempo (o hitmarker, o X de abate, as sequências, o rastro da vida, a vinheta, os indicadores de
 * dano, os "+N"), os avisos centrais de momento, o "VALENDO!", a batida do placar e o fim da partida. Puro, sem DOM e
 * sem alocar por quadro (strings só nos eventos). O `scene/match.ts` só chama: eventos (`feelHit`, `feelKill`…), o
 * passo (`stepHudFeel`) e o preenchimento do modelo da HUD (`fillFeelHud`). "Reduzir efeitos" (`reduce`) tira a
 * escala, o pulso, o pisca e a subida (fica o estado, parado).
 */
export const HUD_FEEL = {
  /** Hitmarker: cheio por 60 ms, some em 0,2 s; o "pop" de 1 passo fecha em 50 ms. */
  hitHoldS: 0.06,
  hitFadeS: 0.2,
  hitPopS: 0.05,
  /** X de abate: 0,4 s; começa 40% maior e encolhe em 80 ms; some nos últimos 0,12 s. */
  killS: 0.4,
  killShrinkS: 0.08,
  killScale: 1.4,
  killFadeS: 0.12,
  /** O nome da vítima e a sequência embaixo da retícula (s), sumindo nos últimos 0,25 s. */
  killNameS: 1.2,
  lineFadeS: 0.25,
  /** A batida do número de ABATES e do placar que mudou (s). */
  beatS: 0.15,
  /** "ABATE DUPLO": 2 abates em até 3 s. */
  doubleS: 3,
  /** O rastro da vida escorre em 0,4 s. */
  trailS: 0.4,
  /** Vinheta: a vida ≤ 30% do máximo (o mesmo limite do som), pulsando a ~1 Hz. */
  lowHpFrac: 0.3,
  lowHpHz: 1,
  /** Indicador de dano: 0,8 s (cheio nos primeiros 0,3 s); a espessura cheia com 40% da vida máxima num golpe. */
  damageS: 0.8,
  damageHoldS: 0.3,
  damageFullFrac: 0.4,
  /** "+N": sobe e some em 0,8 s; ganhos em até 0,5 s se somam. */
  gainS: 0.8,
  gainMergeS: 0.5,
  gainFadeS: 0.2,
  /** O aliado caído pisca a 2,5 Hz (abaixo dos 3 clarões por segundo). */
  blinkHz: 2.5,
  /** Fim da partida: a câmera lenta (offline, fora do Aquário) a 0,35× por 0,8 s. */
  endSlowMul: 0.35,
  endSlowS: 0.8,
  /** M12 (fase 2, prints): o "R recarrega" aparece depois deste tempo sem atirar, com o pente a ≤ 25%. */
  reloadQuietS: 0.6,
  /** Resultado: travado (esmaecido) por 0,5 s; as linhas entram 40 ms uma depois da outra; os números contam em 0,4 s. */
  resultLockS: 0.5,
  resultRowMs: 40,
  resultCountS: 0.4,
} as const;

const clamp01 = (v: number): number => (v > 0 ? (v < 1 ? v : 1) : 0);
/** O alfa de algo que dura `total` e some nos últimos `fade` (0 fora da janela). */
function holdFade(age: number, total: number, fade: number): number {
  if (age < 0 || age >= total) return 0;
  return age <= total - fade ? 1 : (total - age) / fade;
}

/** As sequências em texto (AM11: secas, em caixa alta), resolvidas uma vez. */
export interface StreakTexts {
  readonly double: string;
  readonly three: string;
  readonly five: string;
  readonly revenge: string;
  readonly head: string;
}

export function streakTexts(): StreakTexts {
  return {
    double: t('hud.streak.double').toUpperCase(),
    three: t('hud.streak.three').toUpperCase(),
    five: t('hud.streak.five').toUpperCase(),
    revenge: t('hud.streak.revenge').toUpperCase(),
    head: t('hud.streak.head').toUpperCase(),
  };
}

/** O estado de uma vista (idades em s; -1 = nada). */
export interface HudFeel {
  hitAge: number;
  hitHead: boolean;
  hitZero: boolean;
  killAge: number;
  killHead: boolean;
  killName: string;
  streak: string;
  streakAge: number;
  /** Quando (s, o relógio da cena) foi o último abate, os abates desde a última morte e quem te matou por último. */
  lastKillAt: number;
  run: number;
  revenge: number;
  /** O rastro da vida: de onde escorre, há quanto tempo e a vida do quadro anterior (-1 = ainda não viu). */
  trailFrom: number;
  trailAge: number;
  lastHealth: number;
  /** Relógio do pulso da vinheta e do pisca do aliado caído. */
  clock: number;
  /** Os indicadores de dano: a origem no mundo, a idade, a espessura e quem causou (`NULL_ENTITY` = nenhum). */
  readonly dmgX: Float32Array;
  readonly dmgY: Float32Array;
  readonly dmgZ: Float32Array;
  readonly dmgAge: Float32Array;
  readonly dmgWeight: Float32Array;
  readonly dmgSource: Float64Array;
  /** Os "+N" (o mais novo primeiro): o valor e a idade; e os pontos do quadro anterior (-1 = ainda não viu). */
  readonly gainValue: Float32Array;
  readonly gainAge: Float32Array;
  gainCount: number;
  lastPoints: number;
  /** O maior tempo de renascer visto nesta morte (a barra que esvazia). */
  respawnMax: number;
  /**
   * O "R recarrega" (`reloadPrompt`): a arma e o pente do quadro anterior, quando foi o último tiro (no `clock`), se
   * ele está na tela e se já saiu neste pente.
   */
  rpWeapon: number;
  rpClip: number;
  rpSince: number;
  rpShowing: boolean;
  rpDone: boolean;
  /** A entidade que a vista seguia no último preenchimento (outra = esquece tudo: o Aquário troca de bobo). */
  entity: number;
  /** A faixa do fim desta vista ("VITÓRIA!") e a cor dela; `''` = jogando. */
  endText: string;
  endColor: number;
}

export function createHudFeel(): HudFeel {
  return {
    hitAge: -1,
    hitHead: false,
    hitZero: false,
    killAge: -1,
    killHead: false,
    killName: '',
    streak: '',
    streakAge: -1,
    lastKillAt: -1e9,
    run: 0,
    revenge: NULL_ENTITY,
    trailFrom: 0,
    trailAge: -1,
    lastHealth: -1,
    clock: 0,
    dmgX: new Float32Array(HUD_DAMAGE_ARCS),
    dmgY: new Float32Array(HUD_DAMAGE_ARCS),
    dmgZ: new Float32Array(HUD_DAMAGE_ARCS),
    dmgAge: new Float32Array(HUD_DAMAGE_ARCS).fill(-1),
    dmgWeight: new Float32Array(HUD_DAMAGE_ARCS),
    dmgSource: new Float64Array(HUD_DAMAGE_ARCS).fill(NULL_ENTITY),
    gainValue: new Float32Array(HUD_GAINS),
    gainAge: new Float32Array(HUD_GAINS),
    gainCount: 0,
    lastPoints: -1,
    respawnMax: 0,
    rpWeapon: -1,
    rpClip: 0,
    rpSince: 0,
    rpShowing: false,
    rpDone: false,
    entity: NULL_ENTITY,
    endText: '',
    endColor: 0,
  };
}

/** A vista passou a seguir outra entidade (ou recomeçou): esquece o que era da anterior. */
export function resetHudFeel(f: HudFeel): void {
  f.hitAge = -1;
  f.killAge = -1;
  f.streakAge = -1;
  f.lastKillAt = -1e9;
  f.run = 0;
  f.revenge = NULL_ENTITY;
  f.trailAge = -1;
  f.lastHealth = -1;
  f.dmgAge.fill(-1);
  f.gainCount = 0;
  f.lastPoints = -1;
  f.respawnMax = 0;
  f.rpWeapon = -1;
  f.rpShowing = false;
  f.rpDone = false;
}

/** O seu tiro acertou (a regra da partida pode desligar o hitmarker: quem chama decide). `zero` = sem dano. */
export function feelHit(f: HudFeel, head: boolean, zero: boolean): void {
  // Um acerto com dano não vira cinza por um sem dano no mesmo instante (a chuva de chumbos).
  const fresh = f.hitAge < 0 || f.hitAge > HUD_FEEL.hitHoldS;
  f.hitZero = fresh ? zero : f.hitZero && zero;
  f.hitHead = fresh ? head : f.hitHead || head;
  f.hitAge = 0;
}

/**
 * Você abateu `victim` (id; o nome `name` já em caixa alta) às `now` s: o X de abate, a batida, o nome embaixo da
 * retícula e (fora do Zombies, `streaks`) a sequência: VINGANÇA > 5 SEGUIDOS > 3 SEGUIDOS > ABATE DUPLO > NA CABEÇA.
 */
export function feelKill(
  f: HudFeel,
  now: number,
  name: string,
  head: boolean,
  victim: number,
  streaks: boolean,
  tx: StreakTexts,
): void {
  f.killAge = 0;
  f.killHead = head;
  f.killName = name;
  f.run++;
  let text = '';
  if (victim !== NULL_ENTITY && victim === f.revenge) {
    text = tx.revenge;
    f.revenge = NULL_ENTITY;
  } else if (f.run === 5) text = tx.five;
  else if (f.run === 3) text = tx.three;
  else if (now - f.lastKillAt <= HUD_FEEL.doubleS) text = tx.double;
  else if (head) text = tx.head;
  f.lastKillAt = now;
  if (streaks && text !== '') {
    f.streak = text;
    f.streakAge = 0;
  }
}

/** Você morreu (`killer` = quem matou; ninguém ou você mesmo não mudam a vingança): a sequência zera. */
export function feelDeath(f: HudFeel, killer: number, self: number): void {
  f.run = 0;
  if (killer !== NULL_ENTITY && killer !== self) f.revenge = killer;
  f.dmgAge.fill(-1);
  f.respawnMax = 0;
}

/**
 * Você levou `amount` de dano vindo de (x, y, z) no mundo (o atirador ou o centro da explosão), de `source`
 * (`NULL_ENTITY` = sem dono). O mesmo atacante renova o indicador dele; senão, o vago ou o mais velho dos 4.
 */
export function feelDamage(
  f: HudFeel,
  x: number,
  y: number,
  z: number,
  amount: number,
  maxHealth: number,
  source: number,
): void {
  let k = -1;
  if (source !== NULL_ENTITY) {
    for (let i = 0; i < HUD_DAMAGE_ARCS && k < 0; i++) if (f.dmgAge[i]! >= 0 && f.dmgSource[i] === source) k = i;
  }
  if (k < 0) {
    let oldest = -1;
    for (let i = 0; i < HUD_DAMAGE_ARCS; i++) {
      const age = f.dmgAge[i]!;
      if (age < 0 || age >= HUD_FEEL.damageS) {
        k = i;
        break;
      }
      if (age > oldest) {
        oldest = age;
        k = i;
      }
    }
  }
  const weight = clamp01(amount / Math.max(1, maxHealth * HUD_FEEL.damageFullFrac));
  const fresh = f.dmgAge[k]! < 0 || f.dmgSource[k] !== source;
  f.dmgX[k] = x;
  f.dmgY[k] = y;
  f.dmgZ[k] = z;
  f.dmgWeight[k] = fresh ? weight : Math.max(weight, f.dmgWeight[k]!);
  f.dmgSource[k] = source;
  f.dmgAge[k] = 0;
}

/** O passo do relógio da vista (s). */
export function stepHudFeel(f: HudFeel, dt: number): void {
  if (dt <= 0) return;
  f.clock += dt;
  if (f.hitAge >= 0) f.hitAge += dt;
  if (f.killAge >= 0) f.killAge += dt;
  if (f.streakAge >= 0) f.streakAge += dt;
  if (f.trailAge >= 0) f.trailAge += dt;
  for (let i = 0; i < HUD_DAMAGE_ARCS; i++) {
    if (f.dmgAge[i]! < 0) continue;
    f.dmgAge[i] = f.dmgAge[i]! + dt;
    if (f.dmgAge[i]! >= HUD_FEEL.damageS) f.dmgAge[i] = -1;
  }
  let n = 0;
  for (let i = 0; i < f.gainCount; i++) {
    const age = f.gainAge[i]! + dt;
    if (age >= HUD_FEEL.gainS) continue;
    f.gainValue[n] = f.gainValue[i]!;
    f.gainAge[n] = age;
    n++;
  }
  f.gainCount = n;
}

/** Os pontos agora (`points` < 0 = o modo não tem): a diferença positiva vira um "+N" (somado ao de há < 0,5 s). */
export function feelPoints(f: HudFeel, points: number): void {
  if (points < 0) {
    f.lastPoints = -1;
    return;
  }
  const gain = f.lastPoints >= 0 ? points - f.lastPoints : 0;
  f.lastPoints = points;
  if (gain <= 0) return;
  if (f.gainCount > 0 && f.gainAge[0]! < HUD_FEEL.gainMergeS) {
    f.gainValue[0] = f.gainValue[0]! + gain;
    return;
  }
  for (let i = Math.min(f.gainCount, HUD_GAINS - 1); i > 0; i--) {
    f.gainValue[i] = f.gainValue[i - 1]!;
    f.gainAge[i] = f.gainAge[i - 1]!;
  }
  f.gainValue[0] = gain;
  f.gainAge[0] = 0;
  f.gainCount = Math.min(f.gainCount + 1, HUD_GAINS);
}

/** A câmera da vista (o olho e o yaw) para os indicadores de dano. */
export interface FeelCamera {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
}

/**
 * Preenche os campos da HUD com peso no modelo da vista. `health`/`maxHealth` da vista (o rastro e a vinheta saem
 * deles); `respawnS` o que falta do renascer (morto). Sem alocar.
 */
export function fillFeelHud(m: HudModel, f: HudFeel, cam: FeelCamera, reduce: boolean): void {
  const H = HUD_FEEL;
  // Hitmarker: cheio 60 ms, some em 0,2 s, com o "pop" de 50 ms.
  const ha = f.hitAge < 0 ? 0 : f.hitAge <= H.hitHoldS ? 1 : clamp01(1 - (f.hitAge - H.hitHoldS) / H.hitFadeS);
  m.hitMarker = f.hitHead ? 0 : ha;
  m.headshotMarker = f.hitHead ? ha : 0;
  m.hitPop = reduce || f.hitAge < 0 ? 0 : clamp01(1 - f.hitAge / H.hitPopS);
  m.hitZero = f.hitZero;
  // X de abate, a batida do ABATES, o nome e a sequência.
  m.killMarker = holdFade(f.killAge, H.killS, H.killFadeS);
  m.killScale = reduce || f.killAge < 0 ? 1 : 1 + (H.killScale - 1) * clamp01(1 - f.killAge / H.killShrinkS);
  m.killHead = f.killHead;
  m.killsBeat = reduce || f.killAge < 0 ? 0 : clamp01(1 - f.killAge / H.beatS);
  m.killName = f.killName;
  m.killNameAlpha = holdFade(f.killAge, H.killNameS, H.lineFadeS);
  m.streakText = f.streak;
  m.streakAlpha = holdFade(f.streakAge, H.killNameS, H.lineFadeS);
  // Vida: o rastro e a vinheta.
  const hp = Math.max(0, m.health);
  if (m.dead || f.lastHealth < 0 || hp >= f.lastHealth) {
    if (hp > f.lastHealth || m.dead) f.trailAge = -1;
  } else {
    // Levou dano: o rastro parte de onde estava (se ainda escorria) ou da vida de antes.
    f.trailFrom = Math.max(trailValue(f, f.lastHealth), f.lastHealth);
    f.trailAge = 0;
  }
  f.lastHealth = m.dead ? -1 : hp;
  m.healthTrail = trailValue(f, hp);
  const low = !m.dead && hp > 0 && m.maxHealth > 0 && hp <= m.maxHealth * H.lowHpFrac;
  m.lowHealth = !low ? 0 : reduce ? 0.8 : 0.6 + 0.4 * (0.5 + 0.5 * Math.cos(f.clock * H.lowHpHz * Math.PI * 2));
  // Indicadores de dano: o ângulo recalculado a cada quadro pela origem no mundo.
  let n = 0;
  const angles = m.damageAngles;
  const alphas = m.damageAlphas;
  const weights = m.damageWeights;
  if (angles && alphas && weights && !m.dead) {
    for (let i = 0; i < HUD_DAMAGE_ARCS; i++) {
      const age = f.dmgAge[i]!;
      if (age < 0) continue;
      const dx = f.dmgX[i]! - cam.x;
      const dz = f.dmgZ[i]! - cam.z;
      let a = Math.atan2(-dx, -dz) - cam.yaw;
      a -= Math.round(a / (Math.PI * 2)) * Math.PI * 2;
      angles[n] = a;
      alphas[n] = age <= H.damageHoldS ? 1 : clamp01(1 - (age - H.damageHoldS) / (H.damageS - H.damageHoldS));
      weights[n] = f.dmgWeight[i]!;
      n++;
    }
  }
  m.damageCount = n;
  // Os "+N".
  let g = 0;
  if (m.gainValues && m.gainAlphas && m.gainRise) {
    for (let i = 0; i < f.gainCount && g < HUD_GAINS; i++) {
      m.gainValues[g] = f.gainValue[i]!;
      m.gainAlphas[g] = holdFade(f.gainAge[i]!, H.gainS, H.gainFadeS);
      m.gainRise[g] = reduce ? 0 : clamp01(f.gainAge[i]! / H.gainS);
      g++;
    }
  }
  m.gainCount = g;
  // Morto: a barra do renascer (o que falta, do maior tempo visto nesta morte).
  if (m.dead && m.respawnS > 0) {
    f.respawnMax = Math.max(f.respawnMax, m.respawnS);
    m.respawnFrac = clamp01(m.respawnS / f.respawnMax);
  } else {
    if (!m.dead) f.respawnMax = 0;
    m.respawnFrac = -1;
  }
  // O aliado caído pisca (fixo com Reduzir efeitos).
  m.markerBlink = reduce ? 1 : Math.sin(f.clock * H.blinkHz * Math.PI * 2) >= 0 ? 1 : 0;
}

/** A vida de onde o rastro escorre agora (sem rastro = a própria vida `hp`). */
function trailValue(f: HudFeel, hp: number): number {
  if (f.trailAge < 0 || f.trailAge >= HUD_FEEL.trailS) return hp;
  return f.trailFrom + (hp - f.trailFrom) * (f.trailAge / HUD_FEEL.trailS);
}

// --- O que é da partida (uma vez por tela) ---------------------------------------------------------------------

/** Os avisos centrais, o "VALENDO!", a batida do placar e o fim (idades em s; -1 = nada). */
export interface MatchFeel {
  notice: string;
  noticeAge: number;
  /** O aviso que espera a contagem (ou o "VALENDO!") sair da tela. */
  pending: string;
  goAge: number;
  readonly score: Int32Array;
  readonly beatAge: Float32Array;
  /** O fim da partida (s desde o fim; -1 = jogando). */
  endAge: number;
  /** O que `detectMoments` viu no quadro anterior (a 1ª olhada só guarda). */
  primed: boolean;
  phase: string;
  countdown: number;
  rest: number;
  wave: number;
  round: number;
  roundPhase: number;
  bomb: number;
  shrinking: number;
}

export function createMatchFeel(): MatchFeel {
  return {
    notice: '',
    noticeAge: -1,
    pending: '',
    goAge: -1,
    score: new Int32Array(4).fill(-1),
    beatAge: new Float32Array(4).fill(-1),
    endAge: -1,
    primed: false,
    phase: '',
    countdown: 0,
    rest: -1,
    wave: 0,
    round: 0,
    roundPhase: -1,
    bomb: -1,
    shrinking: 0,
  };
}

/** Quanto o "VALENDO!" e o aviso ficam (s): os do desenho (`match-hud.ts`). */
const GO_S = GO_SHOW_S;
const NOTICE_S = NOTICE_SHOW_S;

/** Um aviso central (o último manda); com a contagem ou o "VALENDO!" na tela, espera eles saírem. */
export function showNotice(f: MatchFeel, text: string, countdownOn = false): void {
  if (text === '') return;
  if (countdownOn || (f.goAge >= 0 && f.goAge < GO_S)) {
    f.pending = text;
    return;
  }
  f.notice = text;
  f.noticeAge = 0;
}

export function startGo(f: MatchFeel): void {
  f.goAge = 0;
}

/** O passo da partida (s): as idades, e o aviso que esperava entra quando a contagem e o "VALENDO!" saem. */
export function stepMatchFeel(f: MatchFeel, dt: number, countdownOn: boolean): void {
  if (dt > 0) {
    if (f.noticeAge >= 0) {
      f.noticeAge += dt;
      if (f.noticeAge >= NOTICE_S) f.noticeAge = -1;
    }
    if (f.goAge >= 0) {
      f.goAge += dt;
      if (f.goAge >= GO_S) f.goAge = -1;
    }
    for (let i = 0; i < 4; i++) if (f.beatAge[i]! >= 0) f.beatAge[i] = f.beatAge[i]! + dt;
    if (f.endAge >= 0) f.endAge += dt;
  }
  if (f.pending !== '' && !countdownOn && f.goAge < 0) {
    f.notice = f.pending;
    f.noticeAge = 0;
    f.pending = '';
  }
}

/** O placar de cada time agora: o que mudou dá a batida (a 1ª olhada só guarda). */
export function feelScores(
  f: MatchFeel,
  scores: readonly number[],
  count: number,
  beat: Float32Array | undefined,
  reduce: boolean,
): void {
  for (let i = 0; i < 4; i++) {
    const v = i < count ? (scores[i] ?? 0) : -1;
    if (f.score[i]! >= 0 && v > f.score[i]!) f.beatAge[i] = 0;
    f.score[i] = v;
    if (beat !== undefined) {
      const age = f.beatAge[i]!;
      beat[i] = reduce || age < 0 ? 0 : clamp01(1 - age / HUD_FEEL.beatS);
    }
  }
}

/** Os textos dos avisos que não mudam (caixa alta, resolvidos uma vez). */
export interface MomentTexts {
  readonly suddenDeath: string;
  readonly go: string;
}

export function momentTexts(): MomentTexts {
  return { suddenDeath: t('hud.suddenDeath').toUpperCase(), go: t('hud.go').toUpperCase() };
}

const up = (key: string, params?: Record<string, string | number>): string => t(key as StringKey, params).toUpperCase();

/**
 * Olha a partida e dispara os avisos quando o estado MUDA (a 1ª olhada só guarda): a morte súbita; o fim da contagem
 * (o "VALENDO!"); a onda limpa ("ONDA 5 EM 15 S") e a nova (o "VALENDO!" e depois "ONDA 5"); a rodada que começa e a que
 * acaba; a Boom Box plantada; a zona que começa a fechar. As strings já existem na tabela (só montadas no evento).
 */
export function detectMoments(f: MatchFeel, v: SimView, hz: number, tx: MomentTexts): void {
  const mv = v.match;
  const rounds = v.rounds;
  const strike = v.strike;
  const royale = v.royale;
  const round = rounds !== null ? rounds.data[ROUND.round]! : 0;
  const roundPhase = rounds !== null ? rounds.data[ROUND.phase]! : -1;
  const bomb = strike !== null ? strike.data[STRIKE_DATA.bomb]! : -1;
  const shrinking = royale !== null ? royale.data[ZONE.shrinking]! : 0;
  if (f.primed) {
    const countdownOn = mv.phase === 'warmup' && mv.countdownTicks > 0;
    if (f.countdown > 0 && mv.countdownTicks <= 0 && mv.phase !== 'ended') startGo(f);
    if (f.phase !== 'suddenDeath' && mv.phase === 'suddenDeath') showNotice(f, tx.suddenDeath, countdownOn);
    // O Zombies: a onda limpa (começa o descanso) e a nova (acaba o descanso).
    if (f.rest < 0 && mv.zombieRestTicks >= 0 && mv.zombieWave > 0) {
      showNotice(f, up('hud.zombies.rest', { wave: mv.zombieWave + 1, s: Math.ceil(mv.zombieRestTicks / hz) }));
    } else if (f.rest >= 0 && mv.zombieRestTicks < 0 && mv.phase !== 'ended') {
      startGo(f);
      showNotice(f, up('result.zombiesWave', { wave: mv.zombieWave }));
    }
    if (rounds !== null && round > 0 && roundPhase !== f.roundPhase) {
      if (roundPhase === ROUND_PHASE.live) showNotice(f, up('hud.strike.live', { round }), countdownOn);
      else if (roundPhase === ROUND_PHASE.over) {
        const winner = rounds.data[ROUND.winner]!;
        if (strike !== null) {
          const atk = rounds.data[ROUND.swapped] === 1 ? 1 : 0;
          showNotice(f, up(winner === atk ? 'hud.strike.atkWon' : 'hud.strike.defWon'));
        } else showNotice(f, up(winner === 1 ? 'hud.round.juggHeld' : 'hud.round.juggDown'));
      }
    }
    if (strike !== null && f.bomb !== BOMB.planted && bomb === BOMB.planted) {
      const site = String.fromCharCode(65 + Math.max(0, strike.data[STRIKE_DATA.site]!));
      showNotice(f, up('hud.strike.planted', { site }));
    }
    if (royale !== null && f.shrinking === 0 && shrinking === 1) {
      let alive = 0;
      for (let i = 0; i < v.count; i++) {
        if (v.alive[i] === 1 && v.kind[i] === ENTITY_KIND.bobo && (v.flags[i]! & ENTITY_FLAG.dead) === 0) alive++;
      }
      showNotice(f, up('hud.royale.shrink', { alive }));
    }
  }
  f.primed = true;
  f.phase = mv.phase;
  f.countdown = mv.countdownTicks;
  f.rest = mv.zombieRestTicks;
  f.wave = mv.zombieWave;
  f.round = round;
  f.roundPhase = roundPhase;
  f.bomb = bomb;
  f.shrinking = shrinking;
}

/** A partida acabou agora (o fim começa a contar). */
export function feelEnd(f: MatchFeel): void {
  if (f.endAge < 0) f.endAge = 0;
}

/** A câmera lenta do fim (o fator do tempo da sim; 1 = normal): ~0,35× nos primeiros 0,8 s, só onde é permitido. */
export function endSlowFactor(f: MatchFeel, allowed: boolean): number {
  return allowed && f.endAge >= 0 && f.endAge < HUD_FEEL.endSlowS ? HUD_FEEL.endSlowMul : 1;
}

/** A entrada da faixa do fim (0..1; seca, 150 ms; instantânea com Reduzir efeitos). */
export function endBannerIn(f: MatchFeel, reduce: boolean): number {
  return f.endAge < 0 ? 0 : enterProgress(f.endAge * 1000, MOTION.enterMs, reduce);
}

/** A contagem dos números do resultado (0..1, em 0,4 s; 1 com Reduzir efeitos). */
export function resultCount(ageS: number, reduce: boolean): number {
  return reduce ? 1 : clamp01(ageS / HUD_FEEL.resultCountS);
}

/** Onde os botões de toque ficam (px da superfície): a HUD e o kill feed desviam deles. */
export interface TouchBounds {
  /** A largura da coluna dos botões de baixo, a partir da borda (direita; no canhoto, esquerda). */
  reserve: number;
  /** Até onde descem os botões de cima (pausa, câmera, ordens) e até onde sobem os de baixo, a partir da borda. */
  top: number;
  bottom: number;
}

export function createTouchBounds(): TouchBounds {
  return { reserve: 0, top: 0, bottom: 0 };
}

/** As medidas do layout de toque (px de layout × `pixelRatio`), com a folga do acerto e mais 8 px de respiro. */
export function touchBounds(layout: TouchLayout, pixelRatio: number, out: TouchBounds): TouchBounds {
  let reserve = 0;
  let top = 0;
  let bottom = 0;
  for (let i = 0; i < layout.buttons.length; i++) {
    const b = layout.buttons[i]!;
    if (b.anchor === 'bottomLeft' || b.anchor === 'bottomRight') {
      reserve = Math.max(reserve, b.x + b.radius);
      bottom = Math.max(bottom, b.y + b.radius);
    } else top = Math.max(top, b.y + b.radius);
  }
  const slop = layout.hitSlop + 8;
  out.reserve = (reserve + slop) * pixelRatio;
  out.top = (top + slop) * pixelRatio;
  out.bottom = (bottom + slop) * pixelRatio;
  return out;
}

/**
 * M12 (fase 2, revisão): a barra da recarga (0..1; -1 = nenhuma). Só com a sim recarregando (`reloading`: a troca de
 * arma no meio da recarga zera a dela e não avisa); por cartucho (`perRound`, a escopeta), o pente que enche; senão,
 * o tempo desde o começo (`startS`, -1 = não viu) sobre a duração `durS`, no relógio `nowS`.
 */
export function reloadProgress(
  reloading: boolean,
  perRound: boolean,
  clip: number,
  clipSize: number,
  startS: number,
  durS: number,
  nowS: number,
): number {
  if (!reloading) return -1;
  if (perRound) return clipSize > 0 ? clamp01(clip / clipSize) : 0;
  return startS >= 0 ? clamp01((nowS - startS) / Math.max(0.1, durS)) : 0;
}

/**
 * M12 (fase 2, prints): o "R recarrega" (a sim recarrega sozinha com o pente vazio, então "vazio e parado" quase nunca
 * acontece). Aparece com o pente a ≤ 25%, reserva, sem recarregar e sem atirar há `reloadQuietS`; uma vez por pente:
 * um tiro com ele na tela o tira até a próxima recarga ou troca de arma. Chame a cada quadro com a arma na mão
 * (`weapon` = o código; -1 = nenhuma). Devolve se mostra.
 */
export function reloadPrompt(
  f: HudFeel,
  weapon: number,
  clip: number,
  clipSize: number,
  reserve: number,
  reloading: boolean,
): boolean {
  if (weapon !== f.rpWeapon || reloading || clip > f.rpClip) {
    // Arma nova, recarregando ou o pente encheu: começa de novo.
    f.rpWeapon = weapon;
    f.rpShowing = false;
    f.rpDone = false;
    f.rpSince = f.clock;
  } else if (clip < f.rpClip) {
    // Um tiro: zera a espera; com o aviso na tela, ele sai e não volta neste pente.
    f.rpSince = f.clock;
    if (f.rpShowing) {
      f.rpShowing = false;
      f.rpDone = true;
    }
  }
  f.rpClip = clip;
  const low = weapon >= 0 && clipSize > 0 && clip * 4 <= clipSize && reserve > 0 && !reloading;
  if (!low) f.rpShowing = false;
  else if (!f.rpShowing && !f.rpDone && f.clock - f.rpSince >= HUD_FEEL.reloadQuietS) f.rpShowing = true;
  return f.rpShowing;
}
