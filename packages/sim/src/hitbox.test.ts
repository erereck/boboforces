import {
  createFigureGameTable,
  FIGURE_BODY_BOXES,
  FIGURE_BONE,
  FIGURE_BONES,
  FIGURE_BOX_FIELD,
  FIGURE_BOX_STRIDE,
  FIGURE_CROUCH_TOP_M,
  FIGURE_GRIP,
  FIGURE_HIT_FIELD as HF,
  FIGURE_HIT_STRIDE,
  FIGURE_MODE,
  FIGURE_PART_CATEGORY,
  FIGURE_PITCH_SAMPLES,
  FIGURE_POSE_SIZE,
  FIGURE_POSTURE_INFO,
  FIGURE_POSTURES,
  FIGURE_PX_M,
  FIGURE_STANCE,
  figureFk,
  figureGamePose,
  figureHitBoxes,
  figurePosture,
  figureRoot,
  type FigureAimOut,
} from '@boboforces/format';
import { createRng } from '@boboforces/shared';
import {
  BLOCK_FLAG,
  createRayHit,
  createTestBlocks,
  createWorldGrid,
  fillBox,
  makeCell,
  raycastGrid,
} from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { METRICS } from './config/metrics.ts';
import { weaponDamageAt, WEAPON_RIFLE } from './config/weapons.ts';
import { ENTITY_FLAG, ENTITY_KIND } from './entity.ts';
import {
  aimPointLocal,
  aimPointWorld,
  ARM_HIT_CUT_M,
  bindFigureTable,
  bodyPartAtHeight,
  boundFigureTable,
  createBoboHit,
  eyeHeightFor,
  FigureHitCache,
  figurePostureOf,
  HITBOX_COUNT,
  rayVsBobo,
  unbindFigureTable,
  visibleAimLocal,
  visibleAimOffset,
  weaponGrip,
  type AimPoint,
} from './hitbox.ts';

/**
 * Hitboxes do boneco (#56; PLANO do porte §B3, §B4, §C5 e §E): a sim contra a tabela de jogo (`figureHitBoxes`) e
 * contra o visual (FK exato da mesma postura e pitch com `FIGURE_BODY_BOXES`), mais os testes E.1 (raios), E.3 (tiros
 * por cima do muro de 1,0 m), o corte dos braços a 0,75 m (decisão 1 da §I) e E.5 (mira da IA). Bobo nos pés da origem
 * com yaw 0 olha para −Z; a direita dele é +X.
 */

/**
 * E.1 por osso (raios × caixa visual). O plano pede ≥ 99,5% e a tabela da F1 de 04/11 (boxes `18c42b1c`) NÃO chega:
 * 99,42–99,46% no total, 99,49–99,55% nas amostras de pitch e 99,35–99,38% entre elas (3 sementes, revisão da F5).
 * Nas amostras ~86% das trocas são "sim antebraço, visual outra parte": a caixa única de antebraço + mão (§B4) é maior
 * que as duas caixas visuais; entre as amostras soma a folga da interpolação. É geometria da tabela, não da sim (o
 * raio da sim = `figureHitBoxes` exato, teste de referência abaixo). O teste trava o nível medido com folga; a categoria
 * de dano (≥ 99,5%) e a cabeça (0 "visual sem acerto") seguem o plano. Com a tabela da decisão 2 (boxes `b677fdca`) e
 * o corte dos braços (decisão 1, fora da conta): 99,53% nas amostras, 99,37% entre elas e 99,68% na categoria.
 */
const E1_BONE_MIN = 0.992;
/**
 * E.5: parte dos raios a 10 m no ponto que a IA mira (o meio da parte visível da caixa, `visibleAimLocal`) que dá
 * cabeça (mira na cabeça) e cabeça/tronco (mira no tronco), de 8 lados e de frente ±20°. Mirando o CENTRO da caixa
 * (`aimPointLocal`) dá só 90,9% e 61,2% nessas direções (82% e 50% de frente: o antebraço armado tapa o queixo e o
 * peito). Medido com a tabela da F1 de 04/11: 100% e 97,2% (iguais com a decisão 2 e o corte dos braços: 5.500 de
 * 5.500 e 5.344 de 5.500). O tronco não chega a 100%: agachado e deslizando com
 * arma, os antebraços tapam o peito quase inteiro de alguns lados (oclusão real, o visual é igual).
 */
const E5_HEAD_MIN = 0.995;
const E5_TORSO_MIN = 0.96;
/** E.5: azimutes do atirador (0 = na frente do alvo): ±20° e os 8 lados. */
const E5_AZIMUTHS = [-0.35, 0.35, ...Array.from({ length: 8 }, (_, k) => (k * Math.PI) / 4)];
/** E.3: giro do alvo em relação ao muro (olhando por cima dele, ±45°) e ângulo do atirador com a normal (±30°). */
const E3_YAW = Math.PI / 4;
const E3_SHOOTER = Math.PI / 6;

const table = createFigureGameTable();
bindFigureTable(table);
const out = createBoboHit();
const F = ENTITY_FLAG;
const ZOMBIE = FIGURE_POSTURES - 1;
const STAND = figurePosture(FIGURE_STANCE.stand, FIGURE_GRIP.none, FIGURE_MODE.base, false);
const CROUCH = figurePosture(FIGURE_STANCE.crouch, FIGURE_GRIP.none, FIGURE_MODE.base, false);
const stanceOf = (p: number): number => FIGURE_POSTURE_INFO[p * 3]!;
const POSTURES = Array.from({ length: FIGURE_POSTURES }, (_, p) => p);
const LOW = POSTURES.filter((p) => stanceOf(p) !== FIGURE_STANCE.stand && p !== ZOMBIE);
const CROUCHED = POSTURES.filter((p) => stanceOf(p) === FIGURE_STANCE.crouch);

/** Pitches de `a` a `b` em `n` passos iguais (contados em inteiros). */
function steps(a: number, b: number, n: number): number[] {
  return Array.from({ length: n + 1 }, (_, k) => a + ((b - a) * k) / n);
}

function boxesAt(p: number, pitch: number): Float64Array {
  const h = new Float64Array(FIGURE_BONES * FIGURE_HIT_STRIDE);
  figureHitBoxes(table, p, pitch, h, 0);
  return h;
}

/** Ponto do frame da tabela (x = direita, z = frente) → mundo, com os pés em `pos` e o `yaw` da sim. */
function toWorld(q: readonly number[], pos: readonly number[], yaw: number): number[] {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [pos[0]! + c * q[0]! - s * q[2]!, pos[1]! + q[1]!, pos[2]! - s * q[0]! - c * q[2]!];
}

/** Mundo → frame da tabela (a volta de `toWorld`); `dir` = sem a translação. */
function toTable(p: readonly number[], pos: readonly number[], yaw: number, dir = false): number[] {
  const rx = p[0]! - (dir ? 0 : pos[0]!);
  const rz = p[2]! - (dir ? 0 : pos[2]!);
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [c * rx - s * rz, p[1]! - (dir ? 0 : pos[1]!), -s * rx - c * rz];
}

/** Ponto (frame da tabela) da hitbox `b` de `h` nas coordenadas (u, v, w) ∈ [−1, 1]³ da caixa. */
function hitPoint(h: Float64Array, b: number, u: number, v: number, w: number): number[] {
  const o = b * FIGURE_HIT_STRIDE;
  const l = [u * h[o + HF.hx]!, v * h[o + HF.hy]!, w * h[o + HF.hz]!];
  return [0, 1, 2].map((r) => h[o + HF.cx + r]! + l.reduce((s, x, j) => s + h[o + HF.r00 + r * 3 + j]! * x, 0));
}

/** Faixa sem corte (o raio inteiro). */
const NO_CUT: readonly [number, number] = [0, 1000];
const isArm = (b: number): boolean => FIGURE_PART_CATEGORY[b] === 2;

/**
 * Faixa [t0, t1] do raio do MUNDO (origem `o`, direção unitária `d`) dentro do corte dos braços em volta dos pés `pos`
 * (|x|, |z| ≤ ARM_HIT_CUT_M + `grow`); vazia quando t0 > t1. Referência independente da do `narrow`.
 */
function cutRange(
  o: readonly number[],
  d: readonly number[],
  pos: ArrayLike<number>,
  grow: number,
): readonly [number, number] {
  let t0 = 0;
  let t1 = 1000;
  const half = ARM_HIT_CUT_M + grow;
  for (const k of [0, 2]) {
    const e = o[k]! - pos[k]!;
    if (Math.abs(d[k]!) < 1e-12) {
      if (Math.abs(e) > half) return [1, 0];
      continue;
    }
    let a = (-half - e) / d[k]!;
    let b = (half - e) / d[k]!;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
  }
  return [t0, t1];
}

/** Ponto do mundo `q` dentro do corte dos braços em volta dos pés `pos`, crescido de `grow`? */
function inCut(q: readonly number[], pos: ArrayLike<number>, grow: number): boolean {
  return Math.abs(q[0]! - pos[0]!) <= ARM_HIT_CUT_M + grow && Math.abs(q[2]! - pos[2]!) <= ARM_HIT_CUT_M + grow;
}

/**
 * Entrada do raio (frame da tabela) na hitbox `b` crescida de `grow` m, ou Infinity: referência independente. `range`
 * limita o trecho do raio (o corte dos braços, de `cutRange`: a transformação é rígida, o t é o mesmo nos dois frames).
 */
function refEntry(
  h: Float64Array,
  b: number,
  o: readonly number[],
  d: readonly number[],
  grow: number,
  range: readonly [number, number] = NO_CUT,
): number {
  const q = b * FIGURE_HIT_STRIDE;
  let tmin = range[0];
  let tmax = range[1];
  if (tmin > tmax) return Infinity;
  for (let j = 0; j < 3; j++) {
    const ax = [h[q + HF.r00 + j]!, h[q + HF.r10 + j]!, h[q + HF.r20 + j]!];
    const e = ax[0]! * (o[0]! - h[q + HF.cx]!) + ax[1]! * (o[1]! - h[q + HF.cy]!) + ax[2]! * (o[2]! - h[q + HF.cz]!);
    const f = ax[0]! * d[0]! + ax[1]! * d[1]! + ax[2]! * d[2]!;
    const half = h[q + HF.hx + j]! + grow;
    if (Math.abs(f) < 1e-12) {
      if (Math.abs(e) > half) return Infinity;
      continue;
    }
    let t1 = (-half - e) / f;
    let t2 = (half - e) / f;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return Infinity;
  }
  return tmin;
}

/** Ponto (frame da tabela) dentro da hitbox `b` crescida de `margin`? */
function inHit(h: Float64Array, b: number, q: readonly number[], margin: number): boolean {
  const o = b * FIGURE_HIT_STRIDE;
  for (let j = 0; j < 3; j++) {
    const l =
      h[o + HF.r00 + j]! * (q[0]! - h[o + HF.cx]!) +
      h[o + HF.r10 + j]! * (q[1]! - h[o + HF.cy]!) +
      h[o + HF.r20 + j]! * (q[2]! - h[o + HF.cz]!);
    if (Math.abs(l) > h[o + HF.hx + j]! + margin) return false;
  }
  return true;
}

/** Direção unitária pelo azimute (0 = −Z do mundo, +π/2 = −X) e pela elevação. */
function dirOf(azimuth: number, elevation: number): number[] {
  const ce = Math.cos(elevation);
  return [-Math.sin(azimuth) * ce, Math.sin(elevation), -Math.cos(azimuth) * ce];
}

/**
 * Tiro horizontal no bobo em pé sem arma (pitch 0) na altura `y`: da frente, de trás ou da direita dele; `side` é o x
 * local (frente e trás) ou o z local (direita; + = frente). Devolve o osso, ou −1.
 */
function shoot(from: 'front' | 'back' | 'right', y: number, side = 0, posture = STAND): number {
  let t: number;
  if (from === 'front') t = rayVsBobo(0, 0, 0, 0, posture, 0, side, y, -10, 0, 0, 1, 100, out);
  else if (from === 'back') t = rayVsBobo(0, 0, 0, 0, posture, 0, side, y, 10, 0, 0, -1, 100, out);
  else t = rayVsBobo(0, 0, 0, 0, posture, 0, 10, y, -side, -1, 0, 0, 100, out);
  return t === Infinity ? -1 : out.bodyPart;
}

// --- E.3: muro de 1,0 m ---

/**
 * Distância (m) além da qual nenhum atirador em pé no mesmo piso (olho a `eyeHeight`) vê ponto de hitbox do alvo
 * agachado encostado no muro de 1,0 m (AABB na face de trás). Um ponto a y < 1,0 e δ atrás da face fica visível por
 * cima do muro até (olho − muro)·δ/(muro − y) da face; o máximo nas quinas (a função é quase-linear na caixa), nas
 * posturas agachadas, no pitch de `pitchMin` a `pitchMax` (passo ≤ 0,025) e no giro do alvo até ±`yawRange`, mais a
 * meia AABB, e dividido pelo cosseno do maior ângulo do atirador (de lado, o caminho atrás da face fica mais longo).
 * Conservador.
 */
function exposureDistance(yawRange: number, shooterAngle: number, pitchMin: number, pitchMax: number): number {
  const eye = METRICS.eyeHeight;
  const wall = METRICS.coverLow;
  const half = METRICS.aabbWidth / 2;
  let best = 0;
  for (const p of CROUCHED) {
    for (const pitch of steps(pitchMin, pitchMax, Math.ceil((pitchMax - pitchMin) / 0.025))) {
      const h = boxesAt(p, pitch);
      const corners: number[][] = [];
      for (let b = 0; b < FIGURE_BONES; b++) {
        for (let q = 0; q < 8; q++) corners.push(hitPoint(h, b, q & 1 ? 1 : -1, q & 2 ? 1 : -1, q & 4 ? 1 : -1));
      }
      for (const yaw of steps(-yawRange, yawRange, 18)) {
        const c = Math.cos(yaw);
        const s = Math.sin(yaw);
        for (const [x, y, z] of corners as [number, number, number][]) {
          // Frente do alvo girada por `yaw` em relação à normal do muro: a componente na direção do muro.
          const depth = half - (s * x + c * z);
          if (y >= wall || depth <= 0) continue;
          best = Math.max(best, ((eye - wall) * depth) / (wall - y) + half);
        }
      }
    }
  }
  return best / Math.cos(shooterAngle) + 0.05;
}

/**
 * 10 mil tiros no alvo agachado encostado num muro de 1,0 m de altura e `thick` blocos de espessura (piso com topo em
 * 0,5 m; muro em z ∈ [10; 10 + 0,5·thick]; pés do alvo em z = 10 − 0,3, olhando para o muro com giro até ±E3_YAW;
 * postura agachada e pitch de `pitchMin` a `pitchMax` sorteados). Atiradores em pé no mesmo piso, do outro lado, a
 * `dMin`–`dMax` m e até E3_SHOOTER da normal, mirando um ponto sorteado na metade de cima de uma hitbox sorteada (o pior
 * caso). O DDA na grade dá onde a bala para e o raio contra o alvo só vale antes disso, como no sistema de armas.
 */
function wallShots(
  thick: number,
  dMin: number,
  dMax: number,
  seed: string,
  pitchMin: number,
  pitchMax: number,
): { hits: { dist: number; bone: number }[]; blocked: number } {
  const blocks = createTestBlocks();
  const concrete = makeCell(blocks.byKey('concrete')!.id);
  const grid = createWorldGrid(80, 8, 100);
  fillBox(grid, 0, 0, 0, 79, 0, 99, concrete);
  fillBox(grid, 0, 1, 20, 79, 2, 19 + thick, concrete);
  const floor = 0.5;
  const target = [20, floor, 10 - METRICS.aabbWidth / 2];
  const ray = createRayHit();
  const rng = createRng(seed);
  const hits: { dist: number; bone: number }[] = [];
  let blocked = 0;
  for (let n = 0; n < 10_000; n++) {
    const p = CROUCHED[n % CROUCHED.length]!;
    const pitch = rng.range(pitchMin, pitchMax);
    const yaw = Math.PI + rng.range(-E3_YAW, E3_YAW); // yaw π olha para +Z (o muro e os atiradores)
    const h = boxesAt(p, pitch);
    // Metade dos tiros na hitbox mais alta (a que aparece por cima do muro), na quarta parte de cima dela; a outra
    // metade numa hitbox sorteada, na metade de cima.
    let b = rng.int(0, FIGURE_BONES);
    let vMin = 0;
    if (rng.next() < 0.5) {
      b = 0;
      for (let k = 1; k < FIGURE_BONES; k++) {
        if (h[k * FIGURE_HIT_STRIDE + HF.maxY]! > h[b * FIGURE_HIT_STRIDE + HF.maxY]!) b = k;
      }
      vMin = 0.5;
    }
    const aim = toWorld(hitPoint(h, b, rng.range(-1, 1), rng.range(vMin, 1), rng.range(-1, 1)), target, yaw);
    const dist = rng.range(dMin, dMax);
    const a = rng.range(-E3_SHOOTER, E3_SHOOTER);
    const eye = [target[0]! + Math.sin(a) * dist, floor + METRICS.eyeHeight, target[2]! + Math.cos(a) * dist];
    const len = Math.hypot(aim[0]! - eye[0]!, aim[1]! - eye[1]!, aim[2]! - eye[2]!);
    const d = [0, 1, 2].map((k) => (aim[k]! - eye[k]!) / len) as [number, number, number];
    raycastGrid(grid, blocks, eye[0]!, eye[1]!, eye[2]!, d[0], d[1], d[2], 200, BLOCK_FLAG.blocksBullets, ray);
    const wallT = ray.hit ? ray.distance : 200;
    if (wallT < len) blocked++;
    const t = rayVsBobo(
      target[0]!,
      target[1]!,
      target[2]!,
      yaw,
      p,
      pitch,
      eye[0]!,
      eye[1]!,
      eye[2]!,
      d[0],
      d[1],
      d[2],
      wallT,
      out,
    );
    if (t < wallT) hits.push({ dist, bone: out.bodyPart });
  }
  return { hits, blocked };
}

// --- Visual: FK exato da pose da tabela (o que o render desenha com o motor parado) ---

const visPose = new Float32Array(FIGURE_POSE_SIZE);
const visRoot = new Float32Array(16);
const visBones = new Float32Array(FIGURE_BONES * 16);
const VISUAL_BOXES = FIGURE_BODY_BOXES.length / FIGURE_BOX_STRIDE;
const VF = FIGURE_BOX_FIELD;

function posePlaced(p: number, pitch: number, pos: ArrayLike<number>, yaw: number): void {
  figureGamePose(table, p, pitch, visPose, 0);
  figureRoot(visRoot, 0, pos[0]!, pos[1]!, pos[2]!, yaw, 1, 0);
  figureFk(visPose, 0, visRoot, 0, visBones, 0);
}

/** Entrada do raio do mundo na caixa visual `i` (as colunas do osso medem `FIGURE_PX_M`: o t é o mesmo). */
function visualEntry(i: number, o: readonly number[], d: readonly number[]): number {
  const q = i * FIGURE_BOX_STRIDE;
  const m = FIGURE_BODY_BOXES[q + VF.bone]! * 16;
  const k2 = FIGURE_PX_M * FIGURE_PX_M;
  let tmin = 0;
  let tmax = 1000;
  for (let j = 0; j < 3; j++) {
    const ax = visBones[m + j * 4]!;
    const ay = visBones[m + j * 4 + 1]!;
    const az = visBones[m + j * 4 + 2]!;
    const e =
      (ax * (o[0]! - visBones[m + 12]!) + ay * (o[1]! - visBones[m + 13]!) + az * (o[2]! - visBones[m + 14]!)) / k2 -
      FIGURE_BODY_BOXES[q + VF.cx + j]!;
    const f = (ax * d[0]! + ay * d[1]! + az * d[2]!) / k2;
    const half = FIGURE_BODY_BOXES[q + VF.sx + j]! / 2;
    if (Math.abs(f) < 1e-12) {
      if (Math.abs(e) > half) return Infinity;
      continue;
    }
    let t1 = (-half - e) / f;
    let t2 = (half - e) / f;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return Infinity;
  }
  return tmin;
}

/** Osso da 1ª caixa visual que o raio acerta (−1 se nenhuma) e a entrada nela. */
function visualFirst(o: readonly number[], d: readonly number[]): { bone: number; t: number } {
  let best = Infinity;
  let bone = -1;
  for (let i = 0; i < VISUAL_BOXES; i++) {
    const t = visualEntry(i, o, d);
    if (t < best) {
      best = t;
      bone = FIGURE_BODY_BOXES[i * FIGURE_BOX_STRIDE + VF.bone]!;
    }
  }
  return { bone, t: best };
}

/** Ponto do mundo dentro da caixa visual `i`, em (u, v, w) ∈ [0, 1]³. */
function visualPoint(i: number, u: number, v: number, w: number): number[] {
  const q = i * FIGURE_BOX_STRIDE;
  const m = FIGURE_BODY_BOXES[q + VF.bone]! * 16;
  const l = [u, v, w].map((x, j) => FIGURE_BODY_BOXES[q + VF.cx + j]! + (x - 0.5) * FIGURE_BODY_BOXES[q + VF.sx + j]!);
  return [0, 1, 2].map((r) => visBones[m + 12 + r]! + l.reduce((s, x, j) => s + visBones[m + j * 4 + r]! * x, 0));
}

describe('hitboxes do boneco do FutBobo (#56): 12 OBB pela tabela de jogo', () => {
  it('postura pelos bits: deslizar vence agachar, correr só em pé, ADS pelo bit, zumbi pelo tipo, arma pelo grip', () => {
    const S = FIGURE_STANCE;
    const G = FIGURE_GRIP;
    const M = FIGURE_MODE;
    const bobo = ENTITY_KIND.bobo;
    expect(figurePostureOf(0, G.none, bobo)).toBe(0);
    expect(figurePostureOf(F.crouching, G.none, bobo)).toBe(10);
    expect(figurePostureOf(F.crouching | F.sliding, G.none, bobo)).toBe(17);
    expect(figurePostureOf(0, G.none, ENTITY_KIND.zombie)).toBe(21);
    expect(figurePostureOf(0, G.rifle, bobo)).toBe(figurePosture(S.stand, G.rifle, M.base, false));
    expect(figurePostureOf(F.ads, G.rifle, bobo)).toBe(figurePosture(S.stand, G.rifle, M.ads, false));
    expect(figurePostureOf(F.sprinting, G.pistol, bobo)).toBe(figurePosture(S.stand, G.pistol, M.sprint, false));
    expect(figurePostureOf(F.crouching | F.ads, G.sniper, bobo)).toBe(figurePosture(S.crouch, G.sniper, M.ads, false));
    // Agachado correndo não existe: fica agachado base.
    expect(figurePostureOf(F.crouching | F.sprinting, G.rifle, bobo)).toBe(
      figurePosture(S.crouch, G.rifle, M.base, false),
    );
    // A sim liga `crouching` junto do deslize (movement.ts): deslizar vence, e deslizando o modo é base.
    expect(figurePostureOf(F.crouching | F.sliding | F.ads, G.rifle, bobo)).toBe(
      figurePosture(S.slide, G.rifle, M.base, false),
    );
    // Zumbi vence tudo.
    expect(figurePostureOf(F.crouching | F.sliding, G.rifle, ENTITY_KIND.zombie)).toBe(ZOMBIE);
    // Empunhadura da arma do slot (WeaponDef.grip); slot vazio = sem arma.
    expect(weaponGrip(0)).toBe(WEAPON_RIFLE.grip);
    expect(weaponGrip(200)).toBe(G.none);
    expect(HITBOX_COUNT).toBe(12);
  });

  it('em pé sem arma (pitch 0): cabeça, tronco, braço, coxa, canela e pé, com a categoria de dano de cada osso', () => {
    const h = boxesAt(STAND, 0);
    const cy = (b: number): number => h[b * FIGURE_HIT_STRIDE + HF.cy]!;
    const cx = (b: number): number => h[b * FIGURE_HIT_STRIDE + HF.cx]!;
    const B = FIGURE_BONE;
    expect(shoot('front', cy(B.head))).toBe(B.head);
    expect(out.part).toBe(0);
    expect(shoot('front', cy(B.torso))).toBe(B.torso);
    expect(out.part).toBe(1);
    expect(shoot('right', cy(B.upperArmR))).toBe(B.upperArmR);
    expect(out.part).toBe(2);
    expect(shoot('front', cy(B.thighR), cx(B.thighR))).toBe(B.thighR);
    expect(out.part).toBe(3);
    expect(shoot('front', cy(B.shinL), cx(B.shinL))).toBe(B.shinL);
    expect(shoot('front', cy(B.footR), cx(B.footR))).toBe(B.footR);
    expect(out.part).toBe(3);
    expect(shoot('back', cy(B.head))).toBe(B.head);
    // Acima do topo (1,75 m no pitch 0) e ao lado do braço: erra.
    expect(shoot('front', METRICS.bodyHeight + 1e-3)).toBe(-1);
    expect(shoot('front', cy(B.torso), 0.6)).toBe(-1);
    // A entrada é a face da frente da cabeça.
    const o = B.head * FIGURE_HIT_STRIDE;
    const t = rayVsBobo(0, 0, 0, 0, STAND, 0, 0, cy(B.head), -10, 0, 0, 1, 100, out);
    expect(t).toBeCloseTo(10 - (h[o + HF.cz]! + h[o + HF.hz]!), 9);
    expect(h[o + HF.hz]!).toBeCloseTo(METRICS.headSize / 2, 6);
    // Toda parte tem a categoria do FIGURE_PART_CATEGORY.
    for (let b = 0; b < FIGURE_BONES; b++) expect(h[b * FIGURE_HIT_STRIDE + HF.category]).toBe(FIGURE_PART_CATEGORY[b]);
  });

  it('o yaw gira as caixas: virado para −X, o braço esquerdo tapa o tronco de quem vem de +Z', () => {
    const h = boxesAt(STAND, 0);
    const y = h[FIGURE_BONE.upperArmL * FIGURE_HIT_STRIDE + HF.cy]!;
    const t = rayVsBobo(0, 0, 0, Math.PI / 2, STAND, 0, 0, y, 10, 0, 0, -1, 100, out);
    expect(out.bodyPart).toBe(FIGURE_BONE.upperArmL);
    expect(out.part).toBe(2);
    expect(t).toBeLessThan(10 - h[FIGURE_BONE.torso * FIGURE_HIT_STRIDE + HF.hx]!);
  });

  it('raios de todos os lados acertam o mesmo osso, na mesma distância, que as caixas da tabela com o corte dos braços (referência)', () => {
    const pos = [3.25, 1, -2.5];
    const dirs: number[][] = [];
    for (let a = 0; a < 8; a++) dirs.push(dirOf((a * Math.PI) / 4 + 0.05, 0));
    for (let a = 0; a < 4; a++) dirs.push(dirOf((a * Math.PI) / 2 + 0.3, -0.5));
    dirs.push(dirOf(0.4, 0.35), dirOf(2.6, -1.2));
    const winners = new Set<number>();
    let fails = 0;
    let rays = 0;
    for (const p of [STAND, 4, CROUCH, 13, 19, ZOMBIE]) {
      for (const pitch of [-1.35, -0.17, 0.45, 1.3]) {
        const h = boxesAt(p, pitch);
        for (const yaw of [0.7, -2.2]) {
          for (const d of dirs) {
            const ul = Math.hypot(d[0]!, d[2]!);
            const u = [-d[2]! / ul, 0, d[0]! / ul];
            const v = [d[1]! * u[2]! - d[2]! * u[1]!, d[2]! * u[0]! - d[0]! * u[2]!, d[0]! * u[1]! - d[1]! * u[0]!];
            for (let i = -6; i <= 6; i++) {
              for (let j = -6; j <= 6; j++) {
                const a = i * 0.141 + 0.0071;
                const b = j * 0.141 + 0.0037;
                const o = [0, 1, 2].map((k) => pos[k]! + (k === 1 ? 0.75 : 0) + u[k]! * a + v[k]! * b - d[k]! * 5);
                const t = rayVsBobo(
                  pos[0]!,
                  pos[1]!,
                  pos[2]!,
                  yaw,
                  p,
                  pitch,
                  o[0]!,
                  o[1]!,
                  o[2]!,
                  d[0]!,
                  d[1]!,
                  d[2]!,
                  100,
                  out,
                );
                const lo = toTable(o, pos, yaw);
                const ld = toTable(d, pos, yaw, true);
                // Braço: só o trecho do raio dentro do corte (decisão 1), crescido e encolhido junto com a caixa.
                const cutIn = cutRange(o, d, pos, 1e-7);
                const cutOut = cutRange(o, d, pos, -1e-7);
                const grown = Array.from({ length: FIGURE_BONES }, (_, k) =>
                  refEntry(h, k, lo, ld, 1e-7, isArm(k) ? cutIn : NO_CUT),
                );
                const shrunk = Array.from({ length: FIGURE_BONES }, (_, k) =>
                  refEntry(h, k, lo, ld, -1e-7, isArm(k) ? cutOut : NO_CUT),
                );
                const bestGrown = Math.min(...grown);
                const bestShrunk = Math.min(...shrunk);
                rays++;
                if (t === Infinity) {
                  if (bestShrunk !== Infinity) fails++;
                  continue;
                }
                winners.add(out.bodyPart);
                const ok =
                  bestGrown < Infinity &&
                  t >= bestGrown - 1e-6 &&
                  (bestShrunk === Infinity || t <= bestShrunk + 1e-6) &&
                  grown[out.bodyPart]! <= t + 1e-6 &&
                  out.part === FIGURE_PART_CATEGORY[out.bodyPart];
                if (!ok) fails++;
              }
            }
          }
        }
      }
    }
    expect(fails, `${fails} de ${rays} raios`).toBe(0);
    expect([...winners].sort((a, b) => a - b)).toEqual(Array.from({ length: FIGURE_BONES }, (_, k) => k));
  }, 30_000);

  it('fase larga não corta borda: toda quina de hitbox (1 mm para dentro) é acertável de qualquer direção', () => {
    // Exceção (decisão 1): quina de braço fora do corte de 0,75 m não é acertável por construção; nenhum acerto de braço
    // pode cair fora do corte.
    const pos = [-1.5, 0.5, 4];
    const yaw = 1.1;
    const pitches = [-1.5, -0.93, -0.3, 0, 0.27, 0.6, 0.95, 1.5];
    const dirs: number[][] = [];
    for (let a = 0; a < 8; a++) for (const el of [-0.6, 0, 0.4]) dirs.push(dirOf((a * Math.PI) / 4 + 0.1, el));
    let fails = 0;
    let rays = 0;
    let cut = 0;
    let armOutside = 0;
    for (const p of POSTURES) {
      for (const pitch of pitches) {
        const h = boxesAt(p, pitch);
        for (let b = 0; b < FIGURE_BONES; b++) {
          const o = b * FIGURE_HIT_STRIDE;
          for (let c = 0; c < 8; c++) {
            const s = (k: number): number => ((c >> k) & 1 ? 1 : -1) * (1 - 1e-3 / h[o + HF.hx + k]!);
            const target = toWorld(hitPoint(h, b, s(0), s(1), s(2)), pos, yaw);
            const skip = isArm(b) && !inCut(target, pos, -1e-6);
            if (skip) cut++;
            for (const d of dirs) {
              const t = rayVsBobo(
                pos[0]!,
                pos[1]!,
                pos[2]!,
                yaw,
                p,
                pitch,
                target[0]! - d[0]! * 6,
                target[1]! - d[1]! * 6,
                target[2]! - d[2]! * 6,
                d[0]!,
                d[1]!,
                d[2]!,
                100,
                out,
              );
              if (t !== Infinity && isArm(out.bodyPart)) {
                const e = [0, 1, 2].map((k) => target[k]! + d[k]! * (t - 6));
                if (!inCut(e, pos, 1e-9)) armOutside++;
              }
              if (skip) continue;
              rays++;
              if (!(t <= 6 + 1e-9)) fails++;
            }
          }
        }
      }
    }
    expect(fails, `${fails} de ${rays} raios`).toBe(0);
    expect(armOutside).toBe(0);
    // Há braço fora do corte nessas posturas (o teste da exceção não é vazio).
    expect(cut).toBeGreaterThan(0);
  }, 30_000);

  it('cache por corpo por tick: mesmo resultado da função livre; troca de postura ou de tick monta de novo', () => {
    const cache = new FigureHitCache(table, 1);
    const pos = new Float64Array([2, 0.5, -3]);
    const yaw = new Float64Array([0.4]);
    const pitch = new Float64Array([0.33]);
    const rng = createRng('cache');
    let fails = 0;
    for (let i = 0; i < 2000; i++) {
      const posture = i < 1000 ? 4 : CROUCH;
      if (i === 1500) pitch[0] = -0.8; // muda o pitch e o tick: o slot é remontado
      const tick = i < 1500 ? 7 : 8;
      const d = dirOf(rng.range(0, Math.PI * 2), rng.range(-0.5, 0.5));
      const target = [pos[0]! + rng.range(-0.4, 0.4), pos[1]! + rng.range(0, 1.8), pos[2]! + rng.range(-0.4, 0.4)];
      const o = [0, 1, 2].map((k) => target[k]! - d[k]! * 8);
      cache.beginRay(o[0]!, o[1]!, o[2]!, d[0]!, d[1]!, d[2]!, 100);
      const bone = cache.test(posture, pos, 0, yaw, pitch, 0, 0, posture, tick);
      const t = rayVsBobo(
        pos[0]!,
        pos[1]!,
        pos[2]!,
        yaw[0]!,
        posture,
        pitch[0]!,
        o[0]!,
        o[1]!,
        o[2]!,
        d[0]!,
        d[1]!,
        d[2]!,
        100,
        out,
      );
      if (t === Infinity ? bone !== -1 : bone !== out.bodyPart || cache.bestT() !== t) fails++;
    }
    expect(fails).toBe(0);
    // Entrada só se menor que a melhor até aqui (a parede ou outro corpo mais perto).
    cache.beginRay(0, 1, -10, 0, 0, 1, 5);
    const far = new Float64Array([0, 0, 0]);
    expect(cache.test(STAND, far, 0, new Float64Array(1), new Float64Array(1), 0, 0, 1, 9)).toBe(-1);
    expect(cache.bestT()).toBe(5);
    // Solta a tabela no fim.
    cache.release();
    expect(cache.table).toBeNull();
    expect(() => cache.test(STAND, far, 0, new Float64Array(1), new Float64Array(1), 0, 0, 1, 9)).toThrow();
  });

  it('a tabela ligada: a função livre lê a da sim viva mais recente e falha sem nenhuma', () => {
    const other = createFigureGameTable();
    bindFigureTable(other);
    expect(boundFigureTable()).toBe(other);
    unbindFigureTable(other);
    expect(boundFigureTable()).toBe(table);
    unbindFigureTable(table);
    expect(() => boundFigureTable()).toThrow();
    bindFigureTable(table);
  });

  it('E.1: 10 mil raios por postura (2–30 m, de todos os lados): o osso da sim é o da caixa visual atingida', () => {
    // Visual = FK exato da pose da tabela na MESMA postura e pitch (o render com o motor parado). 70% dos raios miram
    // um ponto dentro de uma caixa visual e 30% o cilindro largo da postura; o acordo conta os raios que acertam
    // alguma coisa (sim ou visual). Nas amostras de pitch a hitbox é a envolvente das caixas visuais do osso; entre
    // elas a sim interpola centros e R com folga (§B3). Por osso fica abaixo dos 99,5% do plano (ver E1_BONE_MIN; o
    // plano B é a F1 subir para 9 amostras e/ou separar a mão).
    // EXCEÇÃO (decisão 1 da §I): o braço visual acertado FORA do corte de 0,75 m (a entrada do raio na caixa visual
    // passa de ARM_HIT_CUT_M do eixo em x ou z do mundo) não conta; ali a sim de propósito não acerta o braço. O E.1
    // vale para todo o resto.
    const rng = createRng('e1-sim');
    const cache = new FigureHitCache(table, 1);
    const pos = new Float64Array(3);
    const yaw = new Float64Array(1);
    const pitch = new Float64Array(1);
    let headVisualSimMiss = 0;
    let armBeyondCut = 0;
    const agree = [0, 0];
    const cat = [0, 0];
    const total = [0, 0];
    for (const p of POSTURES) {
      for (let k = 0; k < 40; k++) {
        // Metade nas amostras (exatas), metade em qualquer pitch de −1,2 a 1,2.
        const atSample = k % 2 === 0;
        pitch[0] = atSample ? FIGURE_PITCH_SAMPLES[(k >> 1) % FIGURE_PITCH_SAMPLES.length]! : rng.range(-1.2, 1.2);
        pos[0] = rng.range(-50, 50);
        pos[1] = rng.range(-5, 20);
        pos[2] = rng.range(-50, 50);
        yaw[0] = rng.range(-Math.PI, Math.PI);
        posePlaced(p, pitch[0]!, pos, yaw[0]!);
        const radius = table.broad[p * 2]!;
        const top = table.broad[p * 2 + 1]!;
        for (let r = 0; r < 250; r++) {
          let target: number[];
          if (rng.next() < 0.7) target = visualPoint(rng.int(0, VISUAL_BOXES), rng.next(), rng.next(), rng.next());
          else {
            const a = rng.range(0, Math.PI * 2);
            const rr = radius * Math.sqrt(rng.next());
            target = [pos[0]! + Math.cos(a) * rr, pos[1]! + rng.range(-0.05, top), pos[2]! + Math.sin(a) * rr];
          }
          const d = dirOf(rng.range(0, Math.PI * 2), rng.range(-0.8, 0.8));
          const dist = rng.range(2, 30);
          const o = [0, 1, 2].map((j) => target[j]! - d[j]! * dist);
          cache.beginRay(o[0]!, o[1]!, o[2]!, d[0]!, d[1]!, d[2]!, 100);
          const sim = cache.test(p, pos, 0, yaw, pitch, 0, 0, p, k);
          const first = visualFirst(o, d);
          const vis = first.bone;
          if (vis === FIGURE_BONE.head && sim < 0) headVisualSimMiss++;
          if (sim < 0 && vis < 0) continue;
          if (vis >= 0 && isArm(vis)) {
            const e = [0, 1, 2].map((j) => o[j]! + d[j]! * first.t);
            if (!inCut(e, pos, 0)) {
              armBeyondCut++;
              continue;
            }
          }
          const g = atSample ? 0 : 1;
          total[g]!++;
          if (sim === vis) agree[g]!++;
          if ((sim < 0 ? -1 : FIGURE_PART_CATEGORY[sim]) === (vis < 0 ? -1 : FIGURE_PART_CATEGORY[vis])) cat[g]!++;
        }
      }
    }
    expect(headVisualSimMiss).toBe(0);
    // A exceção é pequena: medido 0,83% dos raios que acertam alguma coisa (1.522 de 184.039 com a semente do teste).
    const counted = total[0]! + total[1]!;
    expect(armBeyondCut, `braço fora do corte: ${armBeyondCut} de ${counted + armBeyondCut}`).toBeGreaterThan(0);
    expect(armBeyondCut / (counted + armBeyondCut)).toBeLessThan(0.02);
    expect(agree[0]! / total[0]!, `nas amostras: ${agree[0]} de ${total[0]}`).toBeGreaterThanOrEqual(E1_BONE_MIN);
    expect(agree[1]! / total[1]!, `entre as amostras: ${agree[1]} de ${total[1]}`).toBeGreaterThanOrEqual(E1_BONE_MIN);
    // Categoria de dano (cabeça, tronco, braço, perna) em todos os raios, nas amostras e entre elas.
    const catAll = (cat[0]! + cat[1]!) / (total[0]! + total[1]!);
    expect(catAll, `categoria: ${cat[0]! + cat[1]!} de ${total[0]! + total[1]!}`).toBeGreaterThanOrEqual(0.995);
  }, 30_000);

  it('agachado e deslizando: nenhum tiro horizontal acima de FIGURE_CROUCH_TOP_M acerta, de nenhum lado', () => {
    let fails = 0;
    for (const p of LOW) {
      for (const pitch of steps(-1.2, 1.2, 48)) {
        for (let a = 0; a < 16; a++) {
          const d = dirOf((a * Math.PI) / 8, 0);
          for (let side = -0.9; side <= 0.9; side += 0.05) {
            const ox = -d[0]! * 5 - d[2]! * side;
            const oz = -d[2]! * 5 + d[0]! * side;
            const t = rayVsBobo(0, 0, 0, 0, p, pitch, ox, FIGURE_CROUCH_TOP_M + 1e-6, oz, d[0]!, 0, d[2]!, 100, out);
            if (t !== Infinity) fails++;
          }
        }
      }
    }
    expect(fails).toBe(0);
    // E o agachado de frente, logo abaixo do topo, leva tiro na cabeça.
    const h = boxesAt(CROUCH, 0);
    const o = FIGURE_BONE.head * FIGURE_HIT_STRIDE;
    expect(shoot('front', h[o + HF.maxY]! - 0.01, 0, CROUCH)).toBe(FIGURE_BONE.head);
    expect(shoot('front', METRICS.coverLow, 0, CROUCH)).toBe(-1);
  });

  it('E.3: agachado encostado no muro de 1,0 m, em TODO pitch: 0 acerto em 10 mil tiros a 7–30 m (3 sementes)', () => {
    // D_max = limite analítico (quinas das hitboxes, giro ±45°, atirador ±30°). Com a cabeça agachada só levantando
    // (decisão 2 da §I, `FIGURE_AIM.headPitchMinCrouch` 0) a quina de trás não sobe olhando para baixo, e o D_max em
    // todo pitch é o da cabeça reta: medido 6,81 m (era 9,65 com a cabeça descendo −0,1 rad). O E.3 do plano vale pela
    // geometria em todo pitch, não pela sorte da amostra. Curva D_max(postura, pitch, giro) no relatório.
    const dMax = exposureDistance(E3_YAW, E3_SHOOTER, -1.2, 1.2);
    expect(dMax).toBeLessThan(7);
    // O E.3 do plano: muro de 1,0 m de 2 blocos de espessura, atiradores a 7–30 m, qualquer pitch do alvo.
    for (const seed of ['e3-a', 'e3-b', 'e3-c']) {
      const far = wallShots(2, 7, 30, seed, -1.2, 1.2);
      expect(far.hits.length, seed).toBe(0);
      expect(far.blocked, seed).toBe(10_000);
    }
    // De perto o tiro passa por cima do muro e acha o alvo (o teste não é vazio), sempre dentro do D_max.
    const near = wallShots(2, 3, dMax, 'e3-x', -1.2, 1.2);
    expect(near.hits.length).toBeGreaterThan(0);
    for (const h of near.hits) expect(h.dist).toBeLessThanOrEqual(dMax);
    // Muro de 1 bloco (0,5 m): a mão armada passa do outro lado no visual, mas o corte dos braços a 0,75 m (decisão 1)
    // deixa a hitbox dentro do muro. Também 0 acerto a 7–30 m.
    const thin = wallShots(1, 7, 30, 'e3-fino', -1.2, 1.2);
    expect(thin.hits.map((h) => `osso ${h.bone} a ${h.dist.toFixed(2)} m`)).toEqual([]);
  }, 120_000);

  it('decisão 1: braço armado encostado num muro de 0,5 m não leva tiro do outro lado (corte a 0,75 m do eixo)', () => {
    // Muro de 1 bloco de espessura (z ∈ [10; 10,5]) e 3 m de altura num piso com topo em 0,5 m. Alvo armado (todas as
    // posturas armadas) com a AABB encostada na face (pés em z = 9,7), virado para o muro com giro até ±90° e pitch de
    // −1,2 a 1,2, sorteados até a hitbox de algum braço passar da face de lá (raro: em pé com a sniper e o fuzil). Os
    // atiradores ficam do outro lado, a 0,2–30 m da face, de 0,2 a 2,8 m de altura e até ±60° da normal, e miram um
    // ponto dessa parte do braço. Sem o corte a mão levava tiro; com ele, nada.
    const blocks = createTestBlocks();
    const concrete = makeCell(blocks.byKey('concrete')!.id);
    const grid = createWorldGrid(120, 10, 100);
    fillBox(grid, 0, 0, 0, 119, 0, 99, concrete);
    fillBox(grid, 0, 1, 20, 119, 6, 20, concrete);
    const floor = 0.5;
    const face = 10.5;
    const target = [30, floor, 10 - METRICS.aabbWidth / 2];
    const ARMED = POSTURES.filter((p) => p !== ZOMBIE && FIGURE_POSTURE_INFO[p * 3 + 1] !== FIGURE_GRIP.none);
    const ARMS = [FIGURE_BONE.upperArmR, FIGURE_BONE.upperArmL, FIGURE_BONE.forearmR, FIGURE_BONE.forearmL];
    const ray = createRayHit();
    const rng = createRng('braco-muro');
    const SHOTS = 2000;
    let shots = 0;
    let tries = 0;
    let hits = 0;
    let uncut = 0;
    const postures = new Set<number>();
    while (shots < SHOTS && tries < 400_000) {
      tries++;
      const p = ARMED[rng.int(0, ARMED.length)]!;
      const pitch = rng.range(-1.2, 1.2);
      const yaw = Math.PI + rng.range(-Math.PI / 2, Math.PI / 2);
      const h = boxesAt(p, pitch);
      // Braço com alguma quina além da face de lá (z do mundo > 10,5).
      const poking = ARMS.filter((b) => {
        for (let c = 0; c < 8; c++) {
          const q = toWorld(hitPoint(h, b, c & 1 ? 1 : -1, c & 2 ? 1 : -1, c & 4 ? 1 : -1), target, yaw);
          if (q[2]! > face) return true;
        }
        return false;
      });
      if (poking.length === 0) continue;
      // Um ponto desse braço além da face (amostragem com rejeição).
      const b = poking[rng.int(0, poking.length)]!;
      let aim: number[] | null = null;
      for (let k = 0; k < 64 && aim === null; k++) {
        const q = toWorld(hitPoint(h, b, rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)), target, yaw);
        if (q[2]! > face + 1e-3) aim = q;
      }
      if (aim === null) continue;
      shots++;
      postures.add(p);
      const dist = rng.range(0.2, 30);
      const a = rng.range(-Math.PI / 3, Math.PI / 3);
      const eye = [target[0]! + Math.sin(a) * dist, floor + rng.range(0.2, 2.8), face + Math.cos(a) * dist];
      const len = Math.hypot(aim[0]! - eye[0]!, aim[1]! - eye[1]!, aim[2]! - eye[2]!);
      const d = [0, 1, 2].map((k) => (aim[k]! - eye[k]!) / len) as [number, number, number];
      raycastGrid(grid, blocks, eye[0]!, eye[1]!, eye[2]!, d[0], d[1], d[2], 200, BLOCK_FLAG.blocksBullets, ray);
      const wallT = ray.hit ? ray.distance : 200;
      const t = rayVsBobo(
        target[0]!,
        target[1]!,
        target[2]!,
        yaw,
        p,
        pitch,
        eye[0]!,
        eye[1]!,
        eye[2]!,
        d[0],
        d[1],
        d[2],
        wallT,
        out,
      );
      if (t < wallT) hits++;
      // Referência SEM o corte (as caixas da tabela inteiras): o tiro acertaria o braço antes do muro?
      const lo = toTable(eye, target, yaw);
      const ld = toTable(d, target, yaw, true);
      if (ARMS.some((k) => refEntry(h, k, lo, ld, 0) < wallT)) uncut++;
    }
    expect(shots, `${tries} sorteios`).toBe(SHOTS);
    expect(hits).toBe(0);
    // O teste não é vazio: sem o corte, quase todos esses tiros acertariam o braço do outro lado.
    expect(uncut).toBeGreaterThan(SHOTS * 0.9);
  }, 60_000);

  it('E.5: o ponto de mira fica dentro da caixa da cabeça ou do tronco em toda postura e pitch', () => {
    const aim: FigureAimOut = { y: 0, z: 0 };
    let fails = 0;
    for (const p of POSTURES) {
      for (const pitch of steps(-1.5, 1.5, 60)) {
        const h = boxesAt(p, pitch);
        for (const head of [true, false]) {
          aimPointLocal(p, pitch, head, aim);
          if (!inHit(h, head ? FIGURE_BONE.head : FIGURE_BONE.torso, [0, aim.y, aim.z], 1e-9)) fails++;
        }
      }
    }
    expect(fails).toBe(0);
  });

  it('E.5: raio a 10 m no ponto que a IA mira dá cabeça (mira na cabeça) ou cabeça/tronco (no tronco)', () => {
    // Atirador em pé a 10 m do alvo (olho 1,55): de frente ±20° e dos 8 lados. A IA mira o meio da parte da caixa que
    // ela vê (`visibleAimLocal`): o antebraço armado tapa parte da cabeça e do peito.
    const aim: FigureAimOut = { y: 0, z: 0 };
    const off: AimPoint = { x: 0, y: 0, z: 0 };
    const eye: AimPoint = { x: 0, y: 0, z: 0 };
    const counts = { head: [0, 0], torso: [0, 0] };
    for (const p of POSTURES) {
      for (const pitch of steps(-1.2, 1.2, 24)) {
        for (const az of E5_AZIMUTHS) {
          for (const head of [true, false]) {
            aimPointLocal(p, pitch, head, aim);
            // Alvo nos pés da origem com yaw 0: frame do alvo = mundo com z trocado de sinal.
            eye.x = -Math.sin(az) * 10;
            eye.y = METRICS.eyeHeight;
            eye.z = Math.cos(az) * 10;
            visibleAimLocal(p, pitch, head, eye, off);
            const tx = off.x;
            const ty = aim.y + off.y;
            const tz = -(aim.z + off.z);
            const ex = -Math.sin(az) * 10;
            const ez = -Math.cos(az) * 10;
            const dx = tx - ex;
            const dy = ty - METRICS.eyeHeight;
            const dz = tz - ez;
            const len = Math.hypot(dx, dy, dz);
            const t = rayVsBobo(
              0,
              0,
              0,
              0,
              p,
              pitch,
              ex,
              METRICS.eyeHeight,
              ez,
              dx / len,
              dy / len,
              dz / len,
              100,
              out,
            );
            const c = head ? counts.head : counts.torso;
            c[1]!++;
            const ok = t !== Infinity && (head ? out.part === 0 : out.part <= 1);
            if (ok) c[0]!++;
          }
        }
      }
    }
    expect(counts.head[0]! / counts.head[1]!, `cabeça ${counts.head.join(' de ')}`).toBeGreaterThanOrEqual(E5_HEAD_MIN);
    expect(counts.torso[0]! / counts.torso[1]!, `tronco ${counts.torso.join(' de ')}`).toBeGreaterThanOrEqual(
      E5_TORSO_MIN,
    );
    // Fuzil em ADS, de frente: o antebraço de apoio tapa o queixo e a mira na cabeça sobe para a parte vista. Sem arma
    // a cabeça aparece inteira e a mira fica no centro.
    const ads = figurePosture(FIGURE_STANCE.stand, FIGURE_GRIP.rifle, FIGURE_MODE.ads, false);
    visibleAimLocal(ads, 0, true, { x: 0, y: METRICS.eyeHeight, z: 10 }, off);
    expect(off.y).toBeGreaterThan(0.02);
    visibleAimLocal(STAND, 0, true, { x: 0, y: METRICS.eyeHeight, z: 10 }, off);
    expect(Math.hypot(off.x, off.y, off.z)).toBeLessThan(1e-9);
  }, 30_000);

  it('mira no mundo pelo yaw do alvo; parte pela altura (minY); olho no eixo', () => {
    const aim: FigureAimOut = { y: 0, z: 0 };
    const body = {
      flags: new Uint32Array([F.crouching]),
      weapon: new Uint8Array([0]),
      kind: new Uint8Array([ENTITY_KIND.bobo]),
      position: new Float64Array([4, 1, -2]),
      yaw: new Float64Array([0.9]),
      pitch: new Float64Array([0.3]),
    };
    const posture = figurePostureOf(F.crouching, weaponGrip(0), ENTITY_KIND.bobo);
    for (const head of [true, false]) {
      aimPointLocal(posture, 0.3, head, aim);
      const p: AimPoint = { x: 0, y: 0, z: 0 };
      aimPointWorld(body, 0, head, p);
      const w = toWorld([0, aim.y, aim.z], [4, 1, -2], 0.9);
      expect(p.x).toBeCloseTo(w[0]!, 12);
      expect(p.y).toBeCloseTo(w[1]!, 12);
      expect(p.z).toBeCloseTo(w[2]!, 12);
      // Mira visível: o olho no mundo vira o olho no frame do alvo (o mesmo desvio da versão local).
      const eyeLocal = [0.7, 1.2, 9];
      const eyeWorld = toWorld(eyeLocal, [4, 1, -2], 0.9);
      const a: AimPoint = { x: 0, y: 0, z: 0 };
      const b: AimPoint = { x: 0, y: 0, z: 0 };
      visibleAimOffset(body, 0, head, { x: eyeWorld[0]!, y: eyeWorld[1]!, z: eyeWorld[2]! }, a);
      visibleAimLocal(posture, 0.3, head, { x: eyeLocal[0]!, y: eyeLocal[1]!, z: eyeLocal[2]! }, b);
      expect(a.x).toBeCloseTo(b.x, 9);
      expect(a.y).toBeCloseTo(b.y, 9);
      expect(a.z).toBeCloseTo(b.z, 9);
    }
    // Parte pela altura: a base (minY) das caixas da postura no pitch.
    const h = boxesAt(STAND, 0);
    const minY = (b: number): number => h[b * FIGURE_HIT_STRIDE + HF.minY]!;
    const B = FIGURE_BONE;
    expect(bodyPartAtHeight(STAND, 0, minY(B.head) + 0.01)).toBe(B.head);
    expect(bodyPartAtHeight(STAND, 0, minY(B.head) - 0.01)).toBe(B.torso);
    expect(bodyPartAtHeight(STAND, 0, minY(B.torso) - 0.01)).toBe(B.thighR);
    expect(bodyPartAtHeight(STAND, 0, minY(B.thighR) - 0.01)).toBe(B.shinR);
    expect(bodyPartAtHeight(STAND, 0, 0.01)).toBe(B.footR);
    const c = boxesAt(CROUCH, 0);
    expect(bodyPartAtHeight(CROUCH, 0, c[B.head * FIGURE_HIT_STRIDE + HF.minY]! + 0.01)).toBe(B.head);
    // Olho: no eixo, em pé e agachado; dentro da cabeça em pé.
    expect(eyeHeightFor(0)).toBe(METRICS.eyeHeight);
    expect(eyeHeightFor(F.crouching)).toBe(METRICS.crouchEyeHeight);
    expect(inHit(h, B.head, [0, METRICS.eyeHeight, 0], 0)).toBe(true);
  });

  it('queda de dano do fuzil: 28 até 35 m, 20 a partir de 60 m', () => {
    expect(weaponDamageAt(WEAPON_RIFLE, 10)).toBe(28);
    expect(weaponDamageAt(WEAPON_RIFLE, 47.5)).toBeCloseTo(24);
    expect(weaponDamageAt(WEAPON_RIFLE, 100)).toBe(20);
  });
});
