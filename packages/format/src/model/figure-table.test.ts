import { readFileSync } from 'node:fs';
import { fnv1a32, hashToHex } from '@boboforces/shared';
import { describe, expect, it } from 'vitest';
import {
  FIGURE_AIM,
  FIGURE_BODY_BOXES,
  FIGURE_BONE,
  FIGURE_BONES,
  FIGURE_BOX_FIELD,
  FIGURE_BOX_STRIDE,
  FIGURE_CROUCH_POSE,
  FIGURE_CROUCH_TOP_M,
  FIGURE_GRIP,
  FIGURE_JOINT,
  FIGURE_MAX_TOP_M,
  FIGURE_MODE,
  FIGURE_PART_CATEGORY,
  FIGURE_PITCH_SAMPLES,
  FIGURE_POSE,
  FIGURE_POSE_SIZE,
  FIGURE_POSTURE_INFO,
  FIGURE_POSTURES,
  FIGURE_PX_M,
  FIGURE_REST_POSE,
  FIGURE_SLIDE_POSE,
  FIGURE_STANCE,
  FIGURE_ZOMBIE_POSE,
  figureFk,
  figurePosture,
  figureRoot,
} from './figure.ts';
import * as tableModule from './figure-table.ts';
import {
  createFigureGameTable,
  FIGURE_ARM_PITCH,
  FIGURE_ARM_REACH,
  FIGURE_GRIP_DEFS,
  FIGURE_HIT_FIELD as HF,
  FIGURE_HIT_STRIDE,
  FIGURE_PALM_Y,
  FIGURE_RELOAD,
  FIGURE_RELOAD_KEY,
  figureAimPoint,
  figureBodyPartAtHeight,
  figureGamePose,
  figureGripMatrix,
  figureHitBoxes,
  figureSoftReach,
  figureSolveArm,
  type FigureAimOut,
  type FigureGameTable,
} from './figure-table.ts';

const PX = FIGURE_PX_M;
const P = FIGURE_POSE;
const S = FIGURE_PITCH_SAMPLES.length;
const ZOMBIE = FIGURE_POSTURES - 1;
const table = createFigureGameTable();
const gripOf = (p: number): number => FIGURE_POSTURE_INFO[p * 3 + 1]!;
const modeOf = (p: number): number => FIGURE_POSTURE_INFO[p * 3 + 2]!;
/** Posturas armadas (o zumbi não tem arma). */
const ARMED = Array.from({ length: FIGURE_POSTURES }, (_, p) => p).filter(
  (p) => p !== ZOMBIE && gripOf(p) !== FIGURE_GRIP.none,
);
const UNIT = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

/** FK em px com a raiz identidade (frame do FutBobo: +x esquerda, +z frente) da pose da tabela. */
function fkPx(p: number, pitch: number): Float32Array {
  const pose = new Float32Array(FIGURE_POSE_SIZE);
  figureGamePose(table, p, pitch, pose, 0);
  const bones = new Float32Array(FIGURE_BONES * 16);
  figureFk(pose, 0, UNIT, 0, bones, 0);
  return bones;
}

/** Ponto (x, y, z) do osso b no FK em px. */
function bonePt(bones: Float32Array, b: number, x: number, y: number, z: number): number[] {
  const m = b * 16;
  return [0, 1, 2].map((r) => bones[m + 12 + r]! + bones[m + r]! * x + bones[m + 4 + r]! * y + bones[m + 8 + r]! * z);
}

const dist3 = (a: readonly number[], b: readonly number[]): number =>
  Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

/** Pitches de −1,2 a 1,2 em passos de `step` (contados em inteiros, sem acumular erro). */
function pitches(step: number): number[] {
  const n = Math.round(1.2 / step);
  const out: number[] = [];
  for (let k = -n; k <= n; k++) out.push(k * step);
  return out;
}

const stanceOf = (p: number): number => FIGURE_POSTURE_INFO[p * 3]!;
const boxesAt = (t: FigureGameTable, p: number, pitch: number): Float64Array => {
  const out = new Float64Array(FIGURE_BONES * FIGURE_HIT_STRIDE);
  figureHitBoxes(t, p, pitch, out, 0);
  return out;
};

/** Ponto q (frame da sim) dentro da hitbox em h[o ..] crescida de `margin` m. */
function inHit(h: Float64Array, o: number, q: readonly number[], margin: number): boolean {
  const dx = q[0]! - h[o + HF.cx]!;
  const dy = q[1]! - h[o + HF.cy]!;
  const dz = q[2]! - h[o + HF.cz]!;
  for (let j = 0; j < 3; j++) {
    const local = h[o + HF.r00 + j]! * dx + h[o + HF.r10 + j]! * dy + h[o + HF.r20 + j]! * dz;
    if (Math.abs(local) > h[o + HF.hx + j]! + margin) return false;
  }
  return true;
}

/** Caixas visuais do FK (frame da sim) da pose da tabela: matriz do osso, centro e meias medidas em px. */
interface Visual {
  readonly bone: number;
  readonly m: Float32Array;
  readonly c: readonly number[];
  readonly h: readonly number[];
}

function visuals(pose: Float32Array): Visual[] {
  const root = new Float32Array(16);
  figureRoot(root, 0, 0, 0, 0, 0, 1, 0);
  const bones = new Float32Array(FIGURE_BONES * 16);
  figureFk(pose, 0, root, 0, bones, 0);
  const F = FIGURE_BOX_FIELD;
  const out: Visual[] = [];
  for (let i = 0; i < FIGURE_BODY_BOXES.length / FIGURE_BOX_STRIDE; i++) {
    const o = i * FIGURE_BOX_STRIDE;
    const bone = FIGURE_BODY_BOXES[o + F.bone]!;
    out.push({
      bone,
      m: bones.subarray(bone * 16, bone * 16 + 16),
      c: [FIGURE_BODY_BOXES[o + F.cx]!, FIGURE_BODY_BOXES[o + F.cy]!, FIGURE_BODY_BOXES[o + F.cz]!],
      h: [FIGURE_BODY_BOXES[o + F.sx]! / 2, FIGURE_BODY_BOXES[o + F.sy]! / 2, FIGURE_BODY_BOXES[o + F.sz]! / 2],
    });
  }
  return out;
}

/** Ponto local da caixa visual (px) no frame da sim (z = −Z do mundo). */
function visualPoint(v: Visual, lx: number, ly: number, lz: number): number[] {
  const m = v.m;
  const x = v.c[0]! + lx;
  const y = v.c[1]! + ly;
  const z = v.c[2]! + lz;
  return [
    m[12]! + m[0]! * x + m[4]! * y + m[8]! * z,
    m[13]! + m[1]! * x + m[5]! * y + m[9]! * z,
    -(m[14]! + m[2]! * x + m[6]! * y + m[10]! * z),
  ];
}

/** Ponto q (frame da sim) dentro da caixa visual crescida de `marginPx`. */
function inVisual(v: Visual, q: readonly number[], marginPx: number): boolean {
  const m = v.m;
  const d = [q[0]! - m[12]!, q[1]! - m[13]!, -q[2]! - m[14]!];
  for (let j = 0; j < 3; j++) {
    // As colunas do osso medem FIGURE_PX_M: col·d / k² dá a coordenada em px.
    const local = (m[j * 4]! * d[0]! + m[j * 4 + 1]! * d[1]! + m[j * 4 + 2]! * d[2]!) / (PX * PX);
    if (Math.abs(local - v.c[j]!) > v.h[j]! + marginPx) return false;
  }
  return true;
}

/** Paridade de uma postura num pitch: visual ⊂ hitbox + 1 px e hitbox ⊂ união visual do osso + 1 px. */
function parityFailures(p: number, pitch: number): string[] {
  const fails: string[] = [];
  const pose = new Float32Array(FIGURE_POSE_SIZE);
  figureGamePose(table, p, pitch, pose, 0);
  const vis = visuals(pose);
  const hit = boxesAt(table, p, pitch);
  const signs = [-1, 1];
  const grid = [-1, -0.5, 0, 0.5, 1];
  for (let b = 0; b < FIGURE_BONES; b++) {
    const o = b * FIGURE_HIT_STRIDE;
    const mine = vis.filter((v) => v.bone === b);
    for (const v of mine) {
      for (const sx of signs)
        for (const sy of signs)
          for (const sz of signs) {
            const q = visualPoint(v, sx * v.h[0]!, sy * v.h[1]!, sz * v.h[2]!);
            if (!inHit(hit, o, q, PX)) fails.push(`postura ${p} pitch ${pitch}: visual do osso ${b} fora da hitbox`);
          }
    }
    for (const u of grid)
      for (const w of grid)
        for (const t of grid) {
          const lx = u * hit[o + HF.hx]!;
          const ly = w * hit[o + HF.hy]!;
          const lz = t * hit[o + HF.hz]!;
          const q = [
            hit[o + HF.cx]! + hit[o + HF.r00]! * lx + hit[o + HF.r01]! * ly + hit[o + HF.r02]! * lz,
            hit[o + HF.cy]! + hit[o + HF.r10]! * lx + hit[o + HF.r11]! * ly + hit[o + HF.r12]! * lz,
            hit[o + HF.cz]! + hit[o + HF.r20]! * lx + hit[o + HF.r21]! * ly + hit[o + HF.r22]! * lz,
          ];
          if (!mine.some((v) => inVisual(v, q, 1)))
            fails.push(`postura ${p} pitch ${pitch}: hitbox do osso ${b} fora da união visual`);
        }
  }
  return fails;
}

function tableHash(t: FigureGameTable): string {
  let h = fnv1a32(new Uint8Array(t.poses.buffer, t.poses.byteOffset, t.poses.byteLength));
  for (const a of [t.boxes, t.broad, t.grip, t.reload, t.slack, t.bulge!])
    h = fnv1a32(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), h);
  return hashToHex(h);
}

describe('tabela de jogo: montagem (E.18)', () => {
  it('importar o módulo não monta nada: só funções e constantes; nenhuma alocação nem chamada no topo', () => {
    for (const [name, value] of Object.entries(tableModule)) {
      expect(ArrayBuffer.isView(value), name).toBe(false);
      expect(['function', 'number', 'object'], name).toContain(typeof value);
    }
    // A tabela e o que ela reexporta (empunhaduras e IK).
    for (const file of ['./figure-table.ts', './figure-grips.ts', './figure-ik.ts']) {
      const src = readFileSync(new URL(file, import.meta.url), 'utf8');
      for (const line of src.split('\n')) {
        if (/^(export )?(const|let|var) /.test(line)) {
          expect(line, `${file}: ${line}`).not.toMatch(/new |\(/);
        }
        // Instrução solta no topo do módulo (chamada de função).
        expect(line, `${file}: ${line}`).not.toMatch(/^[A-Za-z_$][\w$.]*\(/);
      }
    }
  });

  it('formas: 22 posturas × 5 amostras', () => {
    expect(table.poses.length).toBe(FIGURE_POSTURES * S * FIGURE_POSE_SIZE);
    expect(table.boxes.length).toBe(FIGURE_POSTURES * S * FIGURE_BONES * FIGURE_HIT_STRIDE);
    expect(table.broad.length).toBe(FIGURE_POSTURES * 2);
    expect(table.grip.length).toBe(FIGURE_POSTURES * S * 12);
    expect(table.reload.length).toBe(3 * 3 * 4);
    expect(table.slack.length).toBe(FIGURE_POSTURES * (S - 1) * FIGURE_BONES * 3);
    expect(table.bulge!.length).toBe(FIGURE_POSTURES * (S - 1) * FIGURE_BONES * 9);
    // As amostras são equidistantes (a interpolação conta com isso).
    for (let s = 1; s < S; s++) expect(FIGURE_PITCH_SAMPLES[s]! - FIGURE_PITCH_SAMPLES[s - 1]!).toBeCloseTo(0.6, 12);
  });

  it('montar 2× dá o mesmo (bytes iguais) em objetos diferentes; nada memorizado', () => {
    const again = createFigureGameTable();
    expect(again).not.toBe(table);
    expect(again.poses).not.toBe(table.poses);
    for (const k of ['poses', 'boxes', 'broad', 'grip', 'reload', 'slack', 'bulge'] as const) {
      expect(new Uint8Array(again[k]!.buffer)).toEqual(new Uint8Array(table[k]!.buffer));
    }
  });

  it('hash FNV-1a travado', () => {
    // Mudou um número da tabela (empunhadura, IK, mira, folga): atualize aqui junto, com o motivo.
    // '41f2baf9' → '937dad0d' (correção do passo 2: `slack` e a fase larga medida com ela) → '8c741111' (F1: posturas
    // armadas pelo IK, deslize do pescoço, `grip`, `reload` e a barriga `bulge`, que entra no hash) → '9324de80'
    // (decisão 2 da §I: agachada e deslizando a cabeça só levanta, `headPitchMinCrouch` 0).
    expect(tableHash(table)).toBe('9324de80');
  });

  it('nenhum NaN; sem arma e zumbi: grip = identidade; armadas: grip ortonormal; reload preenchido', () => {
    for (const k of ['poses', 'boxes', 'broad', 'grip', 'slack', 'reload', 'bulge'] as const) {
      expect(
        table[k]!.every((v) => Number.isFinite(v)),
        k,
      ).toBe(true);
    }
    expect(table.reload.some((v) => v !== 0)).toBe(true);
    const m = new Float32Array(16);
    for (let p = 0; p < FIGURE_POSTURES; p++) {
      for (const pitch of [-1.2, -0.3, 0, 0.9]) {
        figureGripMatrix(table, p, pitch, m, 0);
        if (!ARMED.includes(p)) {
          expect(Array.from(m)).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
          continue;
        }
        for (let i = 0; i < 3; i++)
          for (let j = 0; j < 3; j++) {
            const d = m[i * 4]! * m[j * 4]! + m[i * 4 + 1]! * m[j * 4 + 1]! + m[i * 4 + 2]! * m[j * 4 + 2]!;
            expect(d).toBeCloseTo(i === j ? 1 : 0, 5);
          }
        expect([m[3], m[7], m[11], m[15]]).toEqual([0, 0, 0, 1]);
      }
    }
  });
});

describe('tabela de jogo: poses', () => {
  const base = (p: number): Float32Array =>
    p === ZOMBIE
      ? FIGURE_ZOMBIE_POSE
      : stanceOf(p) === FIGURE_STANCE.crouch
        ? FIGURE_CROUCH_POSE
        : stanceOf(p) === FIGURE_STANCE.slide
          ? FIGURE_SLIDE_POSE
          : FIGURE_REST_POSE;

  /** Chaves que a mira e a arma mexem: pescoço, deslize, tronco Y e os 2 braços. */
  const AIM_KEYS: readonly number[] = [
    P.neckX,
    P.neckY,
    P.neckZ,
    P.neckSlide,
    P.torsoY,
    P.shLX,
    P.shLY,
    P.shLZ,
    P.shRX,
    P.shRY,
    P.shRZ,
    P.elL,
    P.elR,
  ];

  it('sem arma (e zumbi): no pitch 0 a pose é a base do stance; o pitch só mexe no pescoço e no deslize', () => {
    const pose = new Float32Array(FIGURE_POSE_SIZE);
    for (const p of [0, 10, 17, ZOMBIE]) {
      const b = base(p);
      for (const pitch of FIGURE_PITCH_SAMPLES) {
        figureGamePose(table, p, pitch, pose, 0);
        for (let k = 0; k < FIGURE_POSE_SIZE; k++) {
          const neck = k === P.neckX || k === P.neckY || k === P.neckZ || k === P.neckSlide;
          if ((pitch === 0 && k !== P.neckSlide) || !neck) {
            expect(pose[k], `postura ${p} pitch ${pitch} chave ${k}`).toBeCloseTo(b[k]!, 6);
          }
        }
      }
    }
  });

  it('armadas: corpo e pernas = base do stance; tronco girado da empunhadura (correndo: o dele)', () => {
    const pose = new Float32Array(FIGURE_POSE_SIZE);
    for (const p of ARMED) {
      const b = base(p);
      const def = FIGURE_GRIP_DEFS[gripOf(p) - 1]!;
      for (const pitch of pitches(0.3)) {
        figureGamePose(table, p, pitch, pose, 0);
        for (let k = 0; k < FIGURE_POSE_SIZE; k++) {
          if (!AIM_KEYS.includes(k)) expect(pose[k], `postura ${p} pitch ${pitch} chave ${k}`).toBe(b[k]!);
        }
        const torsoY = modeOf(p) === FIGURE_MODE.sprint ? def.sprintTorsoY : def.torsoY;
        expect(pose[P.torsoY]).toBe(Math.fround(torsoY));
      }
    }
  });

  it('cabeça presa ao olho: a cabeça armada gira como a sem arma (composição exata; neckY = −torsoY em pé no pitch 0)', () => {
    // H = Rx(−p_cabeça)·H_base no espaço do quadril, com o tronco torcido ou não. No ADS em pé a cabeça desce sobre a
    // coronha: p_cabeça = c − mergulho·(1 − |c|/0,6), com c = clamp(p; ±0,6), igual à sem arma nesse pitch.
    const max = FIGURE_AIM.headPitchMaxStand;
    for (const p of ARMED) {
      const stand = stanceOf(p) === FIGURE_STANCE.stand;
      const ref = figurePosture(stanceOf(p) as 0 | 1 | 2, FIGURE_GRIP.none, FIGURE_MODE.base, false);
      const dip = stand && modeOf(p) === FIGURE_MODE.ads ? FIGURE_GRIP_DEFS[gripOf(p) - 1]!.adsHeadDip : 0;
      for (const pitch of pitches(0.1)) {
        const c = Math.max(-max, Math.min(max, pitch));
        const a = fkPx(p, pitch);
        const r = fkPx(ref, c - dip * (1 - Math.abs(c) / max));
        for (let k = 0; k < 11; k++) {
          if (k === 3 || k === 7) continue;
          expect(Math.abs(a[k]! - r[k]!), `postura ${p} pitch ${pitch} m${k}`).toBeLessThan(2e-6);
        }
      }
      if (!stand) continue;
      const pose = new Float32Array(FIGURE_POSE_SIZE);
      figureGamePose(table, p, 0, pose, 0);
      if (dip === 0) {
        expect(pose[P.neckY]).toBeCloseTo(-pose[P.torsoY]!, 6);
        expect(pose[P.neckX]).toBeCloseTo(0, 6);
        expect(pose[P.neckZ]).toBeCloseTo(0, 6);
      }
    }
  });

  it('pistola: o ADS é a base (gêmea, bit a bit); fuzil e sniper: ADS mais alto e com a cabeça baixa', () => {
    const block = S * FIGURE_POSE_SIZE;
    const hits = S * FIGURE_BONES * FIGURE_HIT_STRIDE;
    const grips = S * 12;
    const slacks = (S - 1) * FIGURE_BONES * 3;
    for (const stance of [FIGURE_STANCE.stand, FIGURE_STANCE.crouch] as const) {
      const b = figurePosture(stance, FIGURE_GRIP.pistol, FIGURE_MODE.base, false);
      const a = figurePosture(stance, FIGURE_GRIP.pistol, FIGURE_MODE.ads, false);
      for (const [arr, n] of [
        [table.poses, block],
        [table.boxes, hits],
        [table.grip, grips],
        [table.slack, slacks],
      ] as const) {
        expect(Array.from(arr.subarray(a * n, (a + 1) * n))).toEqual(Array.from(arr.subarray(b * n, (b + 1) * n)));
      }
      expect([table.broad[a * 2], table.broad[a * 2 + 1]]).toEqual([table.broad[b * 2], table.broad[b * 2 + 1]]);
    }
    for (const grip of [FIGURE_GRIP.rifle, FIGURE_GRIP.sniper] as const) {
      const b = fkPx(figurePosture(FIGURE_STANCE.stand, grip, FIGURE_MODE.base, false), 0);
      const a = fkPx(figurePosture(FIGURE_STANCE.stand, grip, FIGURE_MODE.ads, false), 0);
      // A palma D sobe ~2,2 px no ADS.
      const hb = bonePt(b, FIGURE_BONE.forearmR, 0, FIGURE_PALM_Y, 0);
      const ha = bonePt(a, FIGURE_BONE.forearmR, 0, FIGURE_PALM_Y, 0);
      expect(ha[1]! - hb[1]!).toBeGreaterThan(1.5);
    }
  });

  it('cabeça: em pé (e zumbi) clamp(p; ±0,6); agachado e deslizando (0,1/0,6)·clamp(p; 0..0,6), só levanta', () => {
    // Decisão 2 da §I: agachada e deslizando a cabeça não desce (olhando para baixo a quina de trás subiria por cima do
    // muro de 1,0 m). A dobra fica no pitch 0, que é amostra: entre as amostras a pose interpolada segue a regra.
    expect(FIGURE_AIM.headPitchMinCrouch).toBe(0);
    const pose = new Float32Array(FIGURE_POSE_SIZE);
    const clamp = (v: number, lo: number): number => Math.max(lo, Math.min(0.6, v));
    for (const p of [0, 10, 17, ZOMBIE]) {
      const b = base(p);
      const stand = stanceOf(p) === FIGURE_STANCE.stand;
      const share = stand ? 1 : 0.1 / 0.6;
      for (const pitch of pitches(0.1)) {
        figureGamePose(table, p, pitch, pose, 0);
        // Base só com giro X no tronco e no pescoço: a composição exata dá neckX = base − hp e Y = Z = 0.
        const hp = share * clamp(pitch, stand ? -0.6 : 0);
        expect(pose[FIGURE_POSE.neckX], `postura ${p} pitch ${pitch}`).toBeCloseTo(b[FIGURE_POSE.neckX]! - hp, 6);
        expect(pose[FIGURE_POSE.neckY]).toBeCloseTo(0, 6);
        expect(pose[FIGURE_POSE.neckZ]).toBeCloseTo(0, 6);
      }
    }
    // Armadas agachadas e deslizando: olhando para baixo a cabeça fica igual à do pitch 0 (o pescoço não mexe).
    const at = new Float32Array(FIGURE_POSE_SIZE);
    for (const p of ARMED) {
      if (stanceOf(p) === FIGURE_STANCE.stand) continue;
      figureGamePose(table, p, 0, at, 0);
      for (const pitch of [-1.2, -0.75, -0.3, -0.05]) {
        figureGamePose(table, p, pitch, pose, 0);
        for (const k of [P.neckX, P.neckY, P.neckZ]) {
          expect(pose[k], `postura ${p} pitch ${pitch}`).toBeCloseTo(at[k]!, 6);
        }
      }
    }
  });

  it('E.4: centro da cabeça ≤ 1 px do eixo do olho em pé e ≤ 2 px agachado (passo 0,05); deslize e zumbi relatados', () => {
    // O eixo do olho é a vertical da raiz (x = z = 0). O deslize do pescoço (≤ 1,5 px) é o que traz a cabeça de volta.
    const worst = [0, 0, 0, 0];
    for (let p = 0; p < FIGURE_POSTURES; p++) {
      const k = p === ZOMBIE ? 3 : stanceOf(p);
      for (const pitch of pitches(0.05)) {
        const c = bonePt(fkPx(p, pitch), FIGURE_BONE.head, 0, 4, 0);
        worst[k] = Math.max(worst[k]!, Math.hypot(c[0]!, c[2]!));
      }
    }
    // Medido: em pé 0,759 px; agachado < 0,001 px (0,110 antes da decisão 2, com a cabeça descendo).
    expect(worst[FIGURE_STANCE.stand]).toBeLessThanOrEqual(1);
    expect(worst[FIGURE_STANCE.crouch]).toBeLessThanOrEqual(2);
    // Relatados (fora da regra): deslize 6,47 px (0,354 m, a cabeça deitada para trás; o deslize dura 0,7 s) e zumbi
    // 6,84 px (curvado para a frente; não tem câmera). Travados para a mudança aparecer.
    expect(worst[FIGURE_STANCE.slide]).toBeCloseTo(6.466, 2);
    expect(worst[3]).toBeCloseTo(6.841, 2);
  });

  it('deslize do pescoço ≤ 1,5 px em toda postura e amostra; zero no zumbi', () => {
    for (let p = 0; p < FIGURE_POSTURES; p++) {
      for (let s = 0; s < S; s++) {
        const v = table.poses[(p * S + s) * FIGURE_POSE_SIZE + P.neckSlide]!;
        expect(Math.abs(v)).toBeLessThanOrEqual(FIGURE_AIM.neckSlideMaxPx);
        if (p === ZOMBIE) expect(v).toBe(0);
      }
    }
  });

  it('figureGamePose: amostra exata, meio do intervalo, clamp nas pontas e NaN na 1ª amostra', () => {
    const out = new Float32Array(FIGURE_POSE_SIZE + 2);
    // A interpolação devolve +0 onde a tabela tem −0 (−0 + 0 = +0): compara pelo valor.
    const num = (a: Float32Array) => Array.from(a, (v) => v + 0);
    const row = (p: number, s: number) =>
      table.poses.subarray((p * S + s) * FIGURE_POSE_SIZE, (p * S + s + 1) * FIGURE_POSE_SIZE);
    const p = 0;
    figureGamePose(table, p, -0.6, out, 1);
    expect(num(out.subarray(1, 1 + FIGURE_POSE_SIZE))).toEqual(num(row(p, 1)));
    figureGamePose(table, p, -0.9, out, 0);
    for (let k = 0; k < FIGURE_POSE_SIZE; k++) expect(out[k]).toBeCloseTo((row(p, 0)[k]! + row(p, 1)[k]!) / 2, 6);
    figureGamePose(table, p, -7, out, 0);
    expect(num(out.subarray(0, FIGURE_POSE_SIZE))).toEqual(num(row(p, 0)));
    figureGamePose(table, p, 7, out, 0);
    expect(num(out.subarray(0, FIGURE_POSE_SIZE))).toEqual(num(row(p, S - 1)));
    figureGamePose(table, p, Number.NaN, out, 0);
    expect(num(out.subarray(0, FIGURE_POSE_SIZE))).toEqual(num(row(p, 0)));
    expect(out[FIGURE_POSE_SIZE + 1]).toBe(0);
  });
});

describe('tabela de jogo: hitboxes', () => {
  it('uma por osso: categorias e antebraço + mão numa caixa só de 3,8 × 6,8 × 3,8 px em (0; −3,3; 0)', () => {
    const h = boxesAt(table, 0, 0);
    for (let b = 0; b < FIGURE_BONES; b++) expect(h[b * FIGURE_HIT_STRIDE + HF.category]).toBe(FIGURE_PART_CATEGORY[b]);
    for (const b of [FIGURE_BONE.forearmR, FIGURE_BONE.forearmL]) {
      const o = b * FIGURE_HIT_STRIDE;
      expect(h[o + HF.hx]! / PX).toBeCloseTo(1.9, 5);
      expect(h[o + HF.hy]! / PX).toBeCloseTo(3.4, 5);
      expect(h[o + HF.hz]! / PX).toBeCloseTo(1.9, 5);
    }
    const head = FIGURE_BONE.head * FIGURE_HIT_STRIDE;
    expect([h[head + HF.hx], h[head + HF.hy], h[head + HF.hz]]).toEqual([4 * PX, 4 * PX, 4 * PX]);
  });

  it('frame da sim no repouso: x = direita, z = frente, cabeça em (0; 28 px; 0) com R = I; topo 1,75 e sola 0 (E.4)', () => {
    const h = boxesAt(table, 0, 0);
    const at = (b: number, f: number) => h[b * FIGURE_HIT_STRIDE + f]!;
    expect(at(FIGURE_BONE.head, HF.cx)).toBeCloseTo(0, 7);
    expect(at(FIGURE_BONE.head, HF.cy)).toBeCloseTo(28 * PX, 6);
    expect(at(FIGURE_BONE.head, HF.cz)).toBeCloseTo(0, 7);
    for (let k = 0; k < 9; k++) expect(at(FIGURE_BONE.head, HF.r00 + k)).toBeCloseTo(k % 4 === 0 ? 1 : 0, 6);
    expect(at(FIGURE_BONE.thighR, HF.cx)).toBeCloseTo(2.05 * PX, 6);
    expect(at(FIGURE_BONE.thighL, HF.cx)).toBeCloseTo(-2.05 * PX, 6);
    expect(at(FIGURE_BONE.upperArmR, HF.cx)).toBeGreaterThan(5 * PX);
    expect(at(FIGURE_BONE.upperArmL, HF.cx)).toBeLessThan(-5 * PX);
    expect(at(FIGURE_BONE.footR, HF.cz)).toBeCloseTo(0.55 * PX, 6);
    let top = -Infinity;
    let sole = Infinity;
    for (let b = 0; b < FIGURE_BONES; b++) {
      top = Math.max(top, at(b, HF.maxY));
      sole = Math.min(sole, at(b, HF.minY));
    }
    expect(Math.abs(top - 1.75)).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(sole)).toBeLessThanOrEqual(1e-6);
  });

  it('paridade nas amostras: hitbox ⊇ visual do osso (FK + FIGURE_BODY_BOXES) + 1 px e vice-versa', () => {
    // As conferências reprovam o que está fora (a paridade não passa no vazio).
    const h = boxesAt(table, 0, 0);
    const pose = new Float32Array(FIGURE_POSE_SIZE);
    figureGamePose(table, 0, 0, pose, 0);
    const head = visuals(pose)[0]!;
    const out = [h[HF.cx]! + h[HF.hx]! + 2 * PX, h[HF.cy]!, h[HF.cz]!];
    expect(inHit(h, 0, out, PX)).toBe(false);
    expect(inVisual(head, out, 1)).toBe(false);
    expect(inVisual(head, visualPoint(head, 0, 0, 4.5), 1)).toBe(true);
    expect(inVisual(head, [h[HF.cx]!, h[HF.cy]!, h[HF.cz]! + 5.5 * PX], 1)).toBe(false);
    expect(inHit(h, 0, [h[HF.cx]!, h[HF.cy]!, h[HF.cz]! + 5.5 * PX], PX)).toBe(false);
    const fails: string[] = [];
    for (let p = 0; p < FIGURE_POSTURES; p++)
      for (const pitch of FIGURE_PITCH_SAMPLES) fails.push(...parityFailures(p, pitch));
    expect(fails.slice(0, 5)).toEqual([]);
  });

  it('paridade entre as amostras (E.1, 13 pitches de −1,2 a 1,2): ângulos interpolados × caixas interpoladas', () => {
    const fails: string[] = [];
    for (let p = 0; p < FIGURE_POSTURES; p++) for (const pitch of pitches(0.2)) fails.push(...parityFailures(p, pitch));
    expect(fails.slice(0, 5)).toEqual([]);
  });

  it('E.1 sem margem: toda quina visual (FK exato da pose interpolada) cai na hitbox em todo pitch (passo 0,005)', () => {
    // Referência independente da interpolação das caixas: o visual é o que o render desenha (ângulos interpolados +
    // FK). Sem a folga (`slack`) a quina da cabeça em pé saía ~9,9 mm no meio dos intervalos, e um raio na cabeça visual
    // passava sem acerto na sim. Tolerância só do float32 da tabela.
    const pose = new Float32Array(FIGURE_POSE_SIZE);
    let worst = -Infinity;
    let at = '';
    for (let p = 0; p < FIGURE_POSTURES; p++) {
      for (const pitch of pitches(0.005)) {
        figureGamePose(table, p, pitch, pose, 0);
        const hit = boxesAt(table, p, pitch);
        for (const v of visuals(pose)) {
          const o = v.bone * FIGURE_HIT_STRIDE;
          for (const sx of [-1, 1])
            for (const sy of [-1, 1])
              for (const sz of [-1, 1]) {
                const q = visualPoint(v, sx * v.h[0]!, sy * v.h[1]!, sz * v.h[2]!);
                const dx = q[0]! - hit[o + HF.cx]!;
                const dy = q[1]! - hit[o + HF.cy]!;
                const dz = q[2]! - hit[o + HF.cz]!;
                for (let j = 0; j < 3; j++) {
                  const local = hit[o + HF.r00 + j]! * dx + hit[o + HF.r10 + j]! * dy + hit[o + HF.r20 + j]! * dz;
                  const out = Math.abs(local) - hit[o + HF.hx + j]!;
                  if (out > worst) {
                    worst = out;
                    at = `postura ${p} pitch ${pitch} osso ${v.bone} eixo ${j}`;
                  }
                }
              }
        }
      }
    }
    expect(worst, at).toBeLessThanOrEqual(1e-6);
  });

  it('E.1 no outro sentido, em todo pitch (passo 0,005): toda quina da hitbox (com a folga) ⊂ união visual do osso + 1 px', () => {
    // A folga é cheia no meio dos intervalos, onde os 13 pitches do E.1 (f = 1/3 e 2/3) não olham. Medido: 0,886 px
    // (antebraço D do sniper em pé, pitch −0,95).
    const pose = new Float32Array(FIGURE_POSE_SIZE);
    const fails: string[] = [];
    for (let p = 0; p < FIGURE_POSTURES; p++) {
      for (const pitch of pitches(0.005)) {
        figureGamePose(table, p, pitch, pose, 0);
        const vis = visuals(pose);
        const hit = boxesAt(table, p, pitch);
        for (let b = 0; b < FIGURE_BONES; b++) {
          const o = b * FIGURE_HIT_STRIDE;
          const mine = vis.filter((v) => v.bone === b);
          for (let c = 0; c < 8; c++) {
            const lx = c & 1 ? hit[o + HF.hx]! : -hit[o + HF.hx]!;
            const ly = c & 2 ? hit[o + HF.hy]! : -hit[o + HF.hy]!;
            const lz = c & 4 ? hit[o + HF.hz]! : -hit[o + HF.hz]!;
            const q = [
              hit[o + HF.cx]! + hit[o + HF.r00]! * lx + hit[o + HF.r01]! * ly + hit[o + HF.r02]! * lz,
              hit[o + HF.cy]! + hit[o + HF.r10]! * lx + hit[o + HF.r11]! * ly + hit[o + HF.r12]! * lz,
              hit[o + HF.cz]! + hit[o + HF.r20]! * lx + hit[o + HF.r21]! * ly + hit[o + HF.r22]! * lz,
            ];
            if (!mine.some((v) => inVisual(v, q, 1))) fails.push(`postura ${p} pitch ${pitch} osso ${b}`);
          }
        }
      }
    }
    expect(fails.slice(0, 5)).toEqual([]);
  });

  it('nas amostras a folga é zero: a hitbox é a da tabela (justa no FK)', () => {
    for (let p = 0; p < FIGURE_POSTURES; p++) {
      for (let s = 0; s < S; s++) {
        const h = boxesAt(table, p, FIGURE_PITCH_SAMPLES[s]!);
        const row = (p * S + s) * FIGURE_BONES * FIGURE_HIT_STRIDE;
        for (let b = 0; b < FIGURE_BONES; b++) {
          for (const f of [HF.cx, HF.cy, HF.cz, HF.hx, HF.hy, HF.hz]) {
            expect(h[b * FIGURE_HIT_STRIDE + f], `postura ${p} amostra ${s} osso ${b}`).toBeCloseTo(
              table.boxes[row + b * FIGURE_HIT_STRIDE + f]!,
              6,
            );
          }
        }
      }
    }
    // E a folga existe onde a cabeça gira (em pé, entre −0,6 e 0,6), e não onde ela satura. Com a barriga (o meio do
    // intervalo exato) a folga da cabeça em pé caiu de ~12,6 mm para ~1,2 mm.
    const head = (p: number, iv: number, axis: number): number =>
      table.slack[((p * (S - 1) + iv) * FIGURE_BONES + FIGURE_BONE.head) * 3 + axis]!;
    expect(head(0, 1, 1)).toBeGreaterThan(0);
    expect(head(0, 1, 1)).toBeLessThan(0.003);
    expect(head(0, 0, 1)).toBe(0);
    expect(head(0, 3, 1)).toBe(0);
  });

  it('barriga: no meio de cada intervalo o centro da hitbox interpolada = o do FK exato (≤ 1e−5 m)', () => {
    for (let p = 0; p < FIGURE_POSTURES; p++) {
      for (let iv = 0; iv < S - 1; iv++) {
        const pitch = FIGURE_PITCH_SAMPLES[iv]! + 0.3;
        const bones = fkPx(p, pitch);
        const h = boxesAt(table, p, pitch);
        // Cabeça (centro da caixa em (0; 4; 0)) e manga D (envolvente de (0; −2,4; 0)).
        for (const [b, y] of [
          [FIGURE_BONE.head, 4],
          [FIGURE_BONE.upperArmR, -2.4],
        ] as const) {
          const c = bonePt(bones, b, 0, y, 0);
          const o = b * FIGURE_HIT_STRIDE;
          const err = Math.hypot(h[o + HF.cx]! + c[0]! * PX, h[o + HF.cy]! - c[1]! * PX, h[o + HF.cz]! - c[2]! * PX);
          expect(err, `postura ${p} intervalo ${iv} osso ${b}`).toBeLessThanOrEqual(1e-5);
        }
      }
    }
  });

  it('topo agachado e deslizando ≤ FIGURE_CROUCH_TOP_M em todo pitch (E.3, passo 0,05)', () => {
    let worst = 0;
    for (let p = 0; p < FIGURE_POSTURES; p++) {
      if (stanceOf(p) === FIGURE_STANCE.stand) continue;
      for (const pitch of pitches(0.05)) {
        const h = boxesAt(table, p, pitch);
        for (let b = 0; b < FIGURE_BONES; b++) worst = Math.max(worst, h[b * FIGURE_HIT_STRIDE + HF.maxY]!);
      }
    }
    expect(worst).toBeLessThanOrEqual(FIGURE_CROUCH_TOP_M);
  });

  it('topo em pé (e zumbi) ≤ FIGURE_MAX_TOP_M em todo pitch, e o máximo calculado a menos de 0,01 dele (E.4)', () => {
    let worst = 0;
    for (let p = 0; p < FIGURE_POSTURES; p++) {
      if (stanceOf(p) !== FIGURE_STANCE.stand) continue;
      for (const pitch of pitches(0.005)) {
        const h = boxesAt(table, p, pitch);
        for (let b = 0; b < FIGURE_BONES; b++) worst = Math.max(worst, h[b * FIGURE_HIT_STRIDE + HF.maxY]!);
      }
    }
    // Medido 1,8036 (o ADS em pé; sem arma 1,8030): o topo visual é 1,8016; com a barriga a folga soma ~2 mm.
    expect(worst).toBeLessThanOrEqual(FIGURE_MAX_TOP_M);
    expect(FIGURE_MAX_TOP_M - worst).toBeLessThanOrEqual(0.01);
  });

  it('no meio do intervalo R é ortonormal (|RᵀR − I| ≤ 1e−6, det +1); a interpolação crua encolheria', () => {
    for (let p = 0; p < FIGURE_POSTURES; p++) {
      for (const pitch of [-0.9, -0.3, 0.3, 0.9]) {
        const h = boxesAt(table, p, pitch);
        for (let b = 0; b < FIGURE_BONES; b++) {
          const o = b * FIGURE_HIT_STRIDE + HF.r00;
          const r = (i: number, j: number) => h[o + i * 3 + j]!;
          for (let i = 0; i < 3; i++)
            for (let j = 0; j < 3; j++) {
              const d = r(0, i) * r(0, j) + r(1, i) * r(1, j) + r(2, i) * r(2, j);
              expect(Math.abs(d - (i === j ? 1 : 0))).toBeLessThanOrEqual(1e-6);
            }
          const det =
            r(0, 0) * (r(1, 1) * r(2, 2) - r(1, 2) * r(2, 1)) -
            r(0, 1) * (r(1, 0) * r(2, 2) - r(1, 2) * r(2, 0)) +
            r(0, 2) * (r(1, 0) * r(2, 1) - r(1, 1) * r(2, 0));
          expect(det).toBeCloseTo(1, 6);
        }
      }
    }
    // A cabeça em pé gira 0,6 rad entre −0,6 e 0: a média crua das colunas mede cos(0,3) = 0,955 (encolhe ~4,5%).
    const a = (S * 0 + 1) * FIGURE_BONES * FIGURE_HIT_STRIDE + HF.r00;
    const b = (S * 0 + 2) * FIGURE_BONES * FIGURE_HIT_STRIDE + HF.r00;
    const col1 = [1, 4, 7].map((k) => (table.boxes[a + k]! + table.boxes[b + k]!) / 2);
    expect(Math.hypot(col1[0]!, col1[1]!, col1[2]!)).toBeCloseTo(Math.cos(0.3), 5);
  });

  it('fase larga cobre a interpolação em todo pitch (passo 0,005)', () => {
    for (let p = 0; p < FIGURE_POSTURES; p++) {
      let r2 = 0;
      let top = -Infinity;
      for (const pitch of pitches(0.005)) {
        const h = boxesAt(table, p, pitch);
        for (let bone = 0; bone < FIGURE_BONES; bone++) {
          const o = bone * FIGURE_HIT_STRIDE;
          top = Math.max(top, h[o + HF.maxY]!);
          for (let c = 0; c < 8; c++) {
            const lx = c & 1 ? h[o + HF.hx]! : -h[o + HF.hx]!;
            const ly = c & 2 ? h[o + HF.hy]! : -h[o + HF.hy]!;
            const lz = c & 4 ? h[o + HF.hz]! : -h[o + HF.hz]!;
            const x = h[o + HF.cx]! + h[o + HF.r00]! * lx + h[o + HF.r01]! * ly + h[o + HF.r02]! * lz;
            const z = h[o + HF.cz]! + h[o + HF.r20]! * lx + h[o + HF.r21]! * ly + h[o + HF.r22]! * lz;
            r2 = Math.max(r2, x * x + z * z);
          }
        }
      }
      expect(Math.sqrt(r2), `raio da postura ${p}`).toBeLessThanOrEqual(table.broad[p * 2]!);
      expect(top, `topo da postura ${p}`).toBeLessThanOrEqual(table.broad[p * 2 + 1]!);
      // Folga pequena (1 cm sobre os 5 pontos lidos por intervalo): não pode virar uma caixa enorme.
      expect(table.broad[p * 2 + 1]! - top).toBeLessThanOrEqual(0.0101);
      expect(table.broad[p * 2]! - Math.sqrt(r2)).toBeLessThanOrEqual(0.0101);
    }
  });

  it('a saída respeita o deslocamento `o` e não escreve fora dele', () => {
    const out = new Float64Array(FIGURE_BONES * FIGURE_HIT_STRIDE + 4).fill(-7);
    figureHitBoxes(table, 3, 0.37, out, 2);
    expect([out[0], out[1], out[out.length - 2], out[out.length - 1]]).toEqual([-7, -7, -7, -7]);
    expect(Array.from(out.subarray(2, 2 + FIGURE_BONES * FIGURE_HIT_STRIDE))).toEqual(
      Array.from(boxesAt(table, 3, 0.37)),
    );
  });
});

/** Arma no FK em px (frame do FutBobo): antebraço D × `figureGripMatrix`, colunas e origem. */
function gunWorld(bones: Float32Array, p: number, pitch: number): { col: number[][]; origin: number[] } {
  const g = new Float32Array(16);
  figureGripMatrix(table, p, pitch, g, 0);
  const f = FIGURE_BONE.forearmR * 16;
  const dir = (x: number, y: number, z: number): number[] =>
    [0, 1, 2].map((r) => bones[f + r]! * x + bones[f + 4 + r]! * y + bones[f + 8 + r]! * z);
  return {
    col: [0, 1, 2].map((c) => dir(g[c * 4]!, g[c * 4 + 1]!, g[c * 4 + 2]!)),
    origin: bonePt(bones, FIGURE_BONE.forearmR, g[12]!, g[13]!, g[14]!),
  };
}

describe('tabela de jogo: arma, IK e recarga', () => {
  it('arma: cano na mira (moldura girada pelo pitch inteiro, saturada por stance; correndo, inclinação fixa)', () => {
    for (const p of ARMED) {
      const def = FIGURE_GRIP_DEFS[gripOf(p) - 1]!;
      const range =
        stanceOf(p) === FIGURE_STANCE.stand
          ? FIGURE_ARM_PITCH.stand
          : stanceOf(p) === FIGURE_STANCE.crouch
            ? FIGURE_ARM_PITCH.crouch
            : FIGURE_ARM_PITCH.slide;
      for (const pitch of FIGURE_PITCH_SAMPLES) {
        const a = modeOf(p) === FIGURE_MODE.sprint ? def.sprintTilt : Math.max(range[0], Math.min(range[1], pitch));
        const gun = gunWorld(fkPx(p, pitch), p, pitch);
        // Eixos do modelo no frame do FutBobo: +x do modelo = −x da raiz; o cano (−z do modelo) na mira.
        const barrel = gun.col[2]!.map((v) => -v);
        expect(dist3(barrel, [0, Math.sin(a), Math.cos(a)]), `postura ${p} pitch ${pitch}`).toBeLessThan(1e-5);
        expect(dist3(gun.col[0]!, [-1, 0, 0]), `postura ${p} pitch ${pitch}`).toBeLessThan(1e-5);
      }
    }
    // Agachado, os braços saturam em +0,6 (FIGURE_AIM.armPitchMaxCrouch).
    expect(FIGURE_ARM_PITCH.crouch[1]).toBe(FIGURE_AIM.armPitchMaxCrouch);
  });

  it('E.11 (IK): alcance ≤ 100% e erro da palma ≤ 0,1 px em toda postura armada × amostra (D no hand_r, E na telha ou no pente)', () => {
    let worstReach = 0;
    let worstErr = 0;
    for (const p of ARMED) {
      const def = FIGURE_GRIP_DEFS[gripOf(p) - 1]!;
      const second = modeOf(p) === FIGURE_MODE.sprint && def.sprintOnMag ? def.mag : def.left;
      for (const pitch of FIGURE_PITCH_SAMPLES) {
        const bones = fkPx(p, pitch);
        const gun = gunWorld(bones, p, pitch);
        // O vetor da mão E está no frame do FutBobo (x da raiz); nos eixos do modelo é (−x, y, −z).
        const v = [-second[0], second[1], -second[2]];
        const left = [0, 1, 2].map(
          (r) => gun.origin[r]! + gun.col[0]![r]! * v[0]! + gun.col[1]![r]! * v[1]! + gun.col[2]![r]! * v[2]!,
        );
        for (const [target, b, sx] of [
          [gun.origin, FIGURE_BONE.forearmR, -1],
          [left, FIGURE_BONE.forearmL, 1],
        ] as const) {
          const palm = bonePt(bones, b, 0, FIGURE_PALM_Y, 0);
          const shoulder = bonePt(bones, FIGURE_BONE.torso, sx * FIGURE_JOINT.shoulderX, FIGURE_JOINT.shoulderY, 0);
          worstReach = Math.max(worstReach, dist3(shoulder, target) / FIGURE_ARM_REACH);
          worstErr = Math.max(worstErr, dist3(palm, target));
        }
      }
    }
    // Medido: 98,0% (o teto `FIGURE_REACH_MAX`) e 0,081 px (o `softReach` deixa a palma um pouco aquém).
    expect(worstReach).toBeLessThanOrEqual(1);
    expect(worstErr).toBeLessThanOrEqual(0.1);
  });

  it('porte do solveArm: no pitch 0 os braços = os do IK do FutBobo no estudo de anatomia §5.3 (± 0,005 rad)', () => {
    // [ombro X, Y, Z, cotovelo] D e E (convenção crua do FutBobo), arredondados a 0,01 no estudo.
    const study: readonly (readonly [number, number, readonly number[], readonly number[]])[] = [
      [FIGURE_GRIP.pistol, FIGURE_MODE.base, [-1.48, 0.55, 0.76, -0.47], [-0.64, -0.66, -0.08, -1.32]],
      [FIGURE_GRIP.rifle, FIGURE_MODE.base, [-0.58, 1.08, 0.47, -1.51], [-0.67, -0.3, 0.29, -1.16]],
      [FIGURE_GRIP.rifle, FIGURE_MODE.ads, [-1.21, 1.03, 0.81, -1.54], [-0.88, -0.28, 0.38, -1.18]],
      [FIGURE_GRIP.rifle, FIGURE_MODE.sprint, [-0.15, 1.09, 0.27, -1.48], [-0.47, -0.64, -0.34, -0.63]],
    ];
    const pose = new Float32Array(FIGURE_POSE_SIZE);
    for (const [grip, mode, right, left] of study) {
      figureGamePose(
        table,
        figurePosture(FIGURE_STANCE.stand, grip as 1 | 2 | 3, mode as 0 | 1 | 2, false),
        0,
        pose,
        0,
      );
      const r = [pose[P.shRX]!, pose[P.shRY]!, pose[P.shRZ]!, pose[P.elR]!];
      const l = [pose[P.shLX]!, pose[P.shLY]!, pose[P.shLZ]!, pose[P.elL]!];
      for (let k = 0; k < 4; k++) {
        expect(Math.abs(r[k]! - right[k]!), `empunhadura ${grip} modo ${mode} D[${k}]`).toBeLessThanOrEqual(0.0051);
        expect(Math.abs(l[k]! - left[k]!), `empunhadura ${grip} modo ${mode} E[${k}]`).toBeLessThanOrEqual(0.0051);
      }
    }
  });

  it('recarga: telha = braço E da postura em pé base; pente e cinto com a palma no alvo (≤ 0,1 px)', () => {
    const pose = new Float32Array(FIGURE_POSE_SIZE);
    const bones = new Float32Array(FIGURE_BONES * 16);
    const c = Math.cos(FIGURE_RELOAD.gunRoll);
    const s = Math.sin(FIGURE_RELOAD.gunRoll);
    for (let gi = 0; gi < 3; gi++) {
      const def = FIGURE_GRIP_DEFS[gi]!;
      const p = figurePosture(FIGURE_STANCE.stand, (gi + 1) as 1 | 2 | 3, FIGURE_MODE.base, false);
      const key = (k: number): number[] => {
        const r = (gi * 3 + k) * 4;
        return Array.from(table.reload.subarray(r, r + 4));
      };
      figureGamePose(table, p, 0, pose, 0);
      expect(key(FIGURE_RELOAD_KEY.handguard)).toEqual([pose[P.shLX], pose[P.shLY], pose[P.shLZ], pose[P.elL]]);
      figureFk(pose, 0, UNIT, 0, bones, 0);
      const gun = gunWorld(bones, p, 0);
      const m = def.mag;
      const magTarget = [
        gun.origin[0]! + m[0] * c - m[1] * s,
        gun.origin[1]! - FIGURE_RELOAD.gunDropPx + m[0] * s + m[1] * c,
        gun.origin[2]! + m[2],
      ];
      const beltTarget = bonePt(bones, FIGURE_BONE.torso, ...FIGURE_RELOAD.belt);
      for (const [k, target] of [
        [FIGURE_RELOAD_KEY.mag, magTarget],
        [FIGURE_RELOAD_KEY.belt, beltTarget],
      ] as const) {
        const arm = key(k);
        pose[P.shLX] = arm[0]!;
        pose[P.shLY] = arm[1]!;
        pose[P.shLZ] = arm[2]!;
        pose[P.elL] = arm[3]!;
        figureFk(pose, 0, UNIT, 0, bones, 0);
        const palm = bonePt(bones, FIGURE_BONE.forearmL, 0, FIGURE_PALM_Y, 0);
        expect(dist3(palm, target), `empunhadura ${gi + 1} chave ${k}`).toBeLessThanOrEqual(0.1);
      }
    }
  });

  it('teto dos braços armados nas amostras: em pé ≤ 1,78 m; agachado e deslizando ≤ 0,955 m', () => {
    for (const p of ARMED) {
      const limit = stanceOf(p) === FIGURE_STANCE.stand ? 1.78 : 0.955;
      for (const pitch of FIGURE_PITCH_SAMPLES) {
        const h = boxesAt(table, p, pitch);
        for (let b = FIGURE_BONE.upperArmR; b <= FIGURE_BONE.forearmL; b++) {
          expect(h[b * FIGURE_HIT_STRIDE + HF.maxY]!, `postura ${p} pitch ${pitch} osso ${b}`).toBeLessThanOrEqual(
            limit + 1e-6,
          );
        }
      }
    }
  });
});

describe('IK do braço (figureSolveArm, porte do solveArm do FutBobo)', () => {
  /** Palma no espaço do tronco depois do FK com o braço do lado `side` nos ângulos resolvidos. */
  function palmFor(side: number, angles: Float64Array): number[] {
    const pose = new Float32Array(FIGURE_REST_POSE);
    const [x, y, z, el] = side > 0 ? [P.shLX, P.shLY, P.shLZ, P.elL] : [P.shRX, P.shRY, P.shRZ, P.elR];
    pose[x] = angles[0]!;
    pose[y] = angles[1]!;
    pose[z] = angles[2]!;
    pose[el] = angles[3]!;
    const bones = new Float32Array(FIGURE_BONES * 16);
    figureFk(pose, 0, UNIT, 0, bones, 0);
    const w = bonePt(bones, side > 0 ? FIGURE_BONE.forearmL : FIGURE_BONE.forearmR, 0, FIGURE_PALM_Y, 0);
    // Tronco do repouso: só translação.
    const t = FIGURE_BONE.torso * 16;
    return [w[0]! - bones[t + 12]!, w[1]! - bones[t + 13]!, w[2]! - bones[t + 14]!];
  }

  it('a palma vai ao alvo (≤ 1e−4 px) abaixo de 95% do alcance, nos dois lados; acima, o softReach a deixa aquém', () => {
    const out = new Float64Array(4);
    for (const side of [-1, 1]) {
      for (const [dx, dy, dz] of [
        [0.5, -3, 5],
        [-1, 1, 7],
        [2, -6, 3],
        [-2, 2.5, 8.5],
        [1.5, -8, 1],
      ] as const) {
        const target = [side * (FIGURE_JOINT.shoulderX + dx), FIGURE_JOINT.shoulderY + dy, dz];
        const reach = figureSolveArm(target[0]!, target[1]!, target[2]!, side, out, 0);
        expect(reach).toBeLessThan(0.95);
        expect(dist3(palmFor(side, out), target), `lado ${side} alvo ${target}`).toBeLessThanOrEqual(1e-4);
        // Cotovelo dobra para a frente (negativo), como no FutBobo.
        expect(out[3]).toBeLessThan(0);
      }
    }
    // Alvo a 98% do alcance: a palma fica 0,08 px aquém (o teto de E.11 é 0,1).
    const far = 0.98 * FIGURE_ARM_REACH;
    expect(far - figureSoftReach(far, FIGURE_ARM_REACH)).toBeLessThan(0.1);
    const reach = figureSolveArm(FIGURE_JOINT.shoulderX, FIGURE_JOINT.shoulderY, far, 1, out, 0);
    expect(reach).toBeCloseTo(0.98, 6);
    const palm = palmFor(1, out);
    expect(dist3(palm, [FIGURE_JOINT.shoulderX, FIGURE_JOINT.shoulderY, far])).toBeLessThan(0.1);
  });

  it('alvo em cima do ombro: não escreve e devolve 0', () => {
    const out = new Float64Array(4).fill(7);
    expect(figureSolveArm(FIGURE_JOINT.shoulderX, FIGURE_JOINT.shoulderY, 0, 1, out, 0)).toBe(0);
    expect(Array.from(out)).toEqual([7, 7, 7, 7]);
  });
});

describe('tabela de jogo: mira e corpo a corpo', () => {
  it('figureAimPoint = centro da hitbox da cabeça ou do tronco, e (0; y; z) cai dentro da caixa', () => {
    const aim: FigureAimOut = { y: 0, z: 0 };
    for (let p = 0; p < FIGURE_POSTURES; p++) {
      for (const pitch of pitches(0.05)) {
        const h = boxesAt(table, p, pitch);
        for (const head of [true, false]) {
          figureAimPoint(table, p, pitch, head, aim);
          const o = (head ? FIGURE_BONE.head : FIGURE_BONE.torso) * FIGURE_HIT_STRIDE;
          expect(aim.y).toBeCloseTo(h[o + HF.cy]!, 9);
          expect(aim.z).toBeCloseTo(h[o + HF.cz]!, 9);
          expect(inHit(h, o, [0, aim.y, aim.z], 0), `postura ${p} pitch ${pitch}`).toBe(true);
        }
      }
    }
  });

  it('figureBodyPartAtHeight pelo minY: cabeça, tronco, coxa, canela e pé (em pé, pitch 0)', () => {
    expect(figureBodyPartAtHeight(table, 0, 0, 1.6)).toBe(FIGURE_BONE.head);
    expect(figureBodyPartAtHeight(table, 0, 0, 24 * PX)).toBe(FIGURE_BONE.head);
    expect(figureBodyPartAtHeight(table, 0, 0, 1.2)).toBe(FIGURE_BONE.torso);
    expect(figureBodyPartAtHeight(table, 0, 0, 0.5)).toBe(FIGURE_BONE.thighR);
    expect(figureBodyPartAtHeight(table, 0, 0, 0.3)).toBe(FIGURE_BONE.shinR);
    expect(figureBodyPartAtHeight(table, 0, 0, 0.05)).toBe(FIGURE_BONE.footR);
    // Agachado (P4f, topo 0,94): a cabeça desce junto.
    expect(figureBodyPartAtHeight(table, 10, 0, 0.8)).toBe(FIGURE_BONE.head);
  });

  it('figureBodyPartAtHeight = minY das hitboxes do figureHitBoxes em toda postura e pitch (passo 0,005)', () => {
    // A média dos minY das amostras errava até 4,7 cm na cabeça (o "V" do minY quando ela passa pelo nível: ADS em pé
    // com o mergulho e zumbi). Cada fronteira é conferida a ±1 µm.
    const order = [FIGURE_BONE.head, FIGURE_BONE.torso, FIGURE_BONE.thighR, FIGURE_BONE.shinR] as const;
    const fails: string[] = [];
    for (let p = 0; p < FIGURE_POSTURES; p++) {
      for (const pitch of pitches(0.005)) {
        const h = boxesAt(table, p, pitch);
        for (let k = 0; k < order.length; k++) {
          const bone = order[k]!;
          const y = h[bone * FIGURE_HIT_STRIDE + HF.minY]!;
          // Acima da fronteira, a parte (ou uma de cima, se a fronteira de cima for mais baixa); abaixo, nunca ela.
          const above = figureBodyPartAtHeight(table, p, pitch, y + 1e-6);
          const below = figureBodyPartAtHeight(table, p, pitch, y - 1e-6);
          const idx = order.indexOf(above as (typeof order)[number]);
          if (idx < 0 || idx > k) fails.push(`postura ${p} pitch ${pitch} acima ${bone}`);
          if (below === bone) fails.push(`postura ${p} pitch ${pitch} abaixo ${bone}`);
        }
      }
    }
    expect(fails.slice(0, 5)).toEqual([]);
  });
});
