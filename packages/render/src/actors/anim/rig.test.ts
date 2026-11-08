import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createFigureGameTable,
  FACE_EXPRESSIONS,
  FIGURE_ARM_PITCH,
  FIGURE_BONE,
  FIGURE_GRIP,
  FIGURE_GRIP_DEFS,
  FIGURE_MODE,
  FIGURE_PALM_Y,
  FIGURE_POSE_SIZE,
  FIGURE_POSTURE_INFO,
  FIGURE_POSTURES,
  FIGURE_PX_M,
  FIGURE_STANCE,
  figureFk,
  figureGamePose,
  figureGripMatrix,
  figurePosture,
  figureRoot,
  type FigureGameTable,
} from '@boboforces/format';
import { fnv1a32, hashToHex } from '@boboforces/shared';
import { describe, expect, it } from 'vitest';
import { ACTOR_KIND, ACTOR_POSE, createActorBuffer, NO_FIGURE, type ActorBuffer } from '../../types.ts';
import { FIGURE_MOTION, FIGURE_MOTION_STOPPED } from './motion-config.ts';
import { createFigureRig } from './rig.ts';
import { createHarnessFrame, createSyntheticFigureTable, type HarnessFrame } from './rig-harness.ts';
import { FIGURE_POSE_RESULT, type FigureRig } from './types.ts';

const RIFLE = figurePosture(FIGURE_STANCE.stand, FIGURE_GRIP.rifle, FIGURE_MODE.base, false);
const RIFLE_CROUCH = figurePosture(FIGURE_STANCE.crouch, FIGURE_GRIP.rifle, FIGURE_MODE.base, false);
const UNARMED = figurePosture(FIGURE_STANCE.stand, FIGURE_GRIP.none, FIGURE_MODE.base, false);
const CROUCH = figurePosture(FIGURE_STANCE.crouch, FIGURE_GRIP.none, FIGURE_MODE.base, false);
const SLIDE = figurePosture(FIGURE_STANCE.slide, FIGURE_GRIP.none, FIGURE_MODE.base, false);
const ZOMBIE = figurePosture(FIGURE_STANCE.stand, FIGURE_GRIP.none, FIGURE_MODE.base, true);
const SLEEPING = FACE_EXPRESSIONS.indexOf('sleeping');
const ANGRY = FACE_EXPRESSIONS.indexOf('angry');

interface ActorSpec {
  entity?: number;
  x?: number;
  y?: number;
  z?: number;
  yaw?: number;
  pitch?: number;
  scale?: number;
  posture?: number;
  pose?: number;
  weapon?: number;
  vx?: number;
  vz?: number;
  expression?: number;
  localSlot?: number;
  recoil?: number;
  reload?: number;
  flash?: number;
}

function put(actors: ActorBuffer, i: number, s: ActorSpec): void {
  actors.entity[i] = s.entity ?? i + 1;
  actors.kind[i] = s.posture === ZOMBIE ? ACTOR_KIND.zombie : ACTOR_KIND.bobo;
  actors.figure[i] = 0;
  actors.position[i * 3] = s.x ?? 0;
  actors.position[i * 3 + 1] = s.y ?? 0;
  actors.position[i * 3 + 2] = s.z ?? 0;
  actors.yaw[i] = s.yaw ?? 0;
  actors.pitch[i] = s.pitch ?? 0;
  actors.scale[i] = s.scale ?? 1;
  actors.posture[i] = s.posture ?? RIFLE;
  actors.pose[i] = s.pose ?? 0;
  actors.weapon[i] = s.weapon ?? 0;
  actors.velocity[i * 3] = s.vx ?? 0;
  actors.velocity[i * 3 + 1] = 0;
  actors.velocity[i * 3 + 2] = s.vz ?? 0;
  actors.expression[i] = s.expression ?? 0;
  actors.localSlot[i] = s.localSlot ?? 255;
  actors.recoil[i] = s.recoil ?? 0;
  actors.reload[i] = s.reload ?? 0;
  actors.damageFlash[i] = s.flash ?? 0;
}

/** Um quadro inteiro do rig para os atores 0..count−1 (cada um em out[i·192]). */
function step(
  rig: FigureRig,
  frame: HarnessFrame,
  actors: ActorBuffer,
  out: Float32Array,
  n: number,
  force = false,
): number[] {
  rig.begin(frame, actors, n);
  const r: number[] = [];
  for (let i = 0; i < actors.count; i++) r.push(rig.pose(actors, i, out, i * 192, force));
  rig.end(n);
  return r;
}

/** Maior diferença nas 3 primeiras linhas das 12 matrizes (a 4ª é da F3). */
function boneDiff(a: Float32Array, ao: number, b: Float32Array, bo: number): number {
  let worst = 0;
  for (let k = 0; k < 192; k++) {
    if (k % 4 === 3) continue;
    worst = Math.max(worst, Math.abs(a[ao + k]! - b[bo + k]!));
  }
  return worst;
}

function referenceBones(
  table: FigureGameTable,
  posture: number,
  pitch: number,
  x: number,
  y: number,
  z: number,
  yaw: number,
  scale: number,
  out: Float32Array,
): void {
  const pose = new Float32Array(FIGURE_POSE_SIZE);
  const root = new Float32Array(16);
  figureGamePose(table, posture, pitch, pose, 0);
  figureRoot(root, 0, x, y, z, yaw, scale, 0);
  figureFk(pose, 0, root, 0, out, 0);
}

describe('rig do boneco (F4)', () => {
  it('E.1 (render): com o motor parado, os ossos = figureGamePose + figureFk ≤ 1e−5 em toda postura e pitch', () => {
    for (const table of [createFigureGameTable(), createSyntheticFigureTable()]) {
      const rig = createFigureRig(1, { motion: FIGURE_MOTION_STOPPED });
      rig.setTable(table);
      const actors = createActorBuffer(1);
      actors.count = 1;
      const frame = createHarnessFrame();
      const out = new Float32Array(192);
      const ref = new Float32Array(192);
      let worst = 0;
      let entity = 1;
      let n = 0;
      for (let p = 0; p < FIGURE_POSTURES; p++) {
        for (let k = 0; k <= 12; k++) {
          const pitch = -1.2 + 0.2 * k;
          const scale = k % 3 === 0 ? 1.3 : 1;
          put(actors, 0, { entity: entity++, posture: p, pitch, x: 3.5, y: 0.25, z: -7, yaw: 0.7 + 0.3 * k, scale });
          expect(step(rig, frame, actors, out, n++)[0]).toBe(FIGURE_POSE_RESULT.computed);
          referenceBones(table, p, pitch, 3.5, 0.25, -7, 0.7 + 0.3 * k, scale, ref);
          worst = Math.max(worst, boneDiff(out, 0, ref, 0));
        }
      }
      expect(worst).toBeLessThanOrEqual(1e-5);
    }
  });

  it('E.1 (render): a mistura de postura assenta na pose da tabela (motor parado) em 120 ms', () => {
    const table = createSyntheticFigureTable();
    const rig = createFigureRig(1, { motion: FIGURE_MOTION_STOPPED });
    rig.setTable(table);
    const actors = createActorBuffer(1);
    actors.count = 1;
    const frame = createHarnessFrame();
    const out = new Float32Array(192);
    const ref = new Float32Array(192);
    put(actors, 0, { posture: RIFLE, pitch: 0.3 });
    step(rig, frame, actors, out, 0);
    put(actors, 0, { posture: RIFLE_CROUCH, pitch: 0.3 });
    step(rig, frame, actors, out, 1);
    referenceBones(table, RIFLE_CROUCH, 0.3, 0, 0, 0, 0, 1, ref);
    // No meio da troca a pose ainda não é a nova; 120 ms depois, é.
    expect(boneDiff(out, 0, ref, 0)).toBeGreaterThan(1e-3);
    for (let n = 2; n < 10; n++) step(rig, frame, actors, out, n);
    expect(boneDiff(out, 0, ref, 0)).toBeLessThanOrEqual(1e-5);
  });

  it('a mistura de pé ↔ agachado mantém a sola no chão (o `bodyY` segue o `legDrop`)', () => {
    const table = createFigureGameTable();
    const rig = createFigureRig(1, { motion: FIGURE_MOTION_STOPPED });
    rig.setTable(table);
    const actors = createActorBuffer(1);
    actors.count = 1;
    const frame = createHarnessFrame();
    const out = new Float32Array(192);
    put(actors, 0, { posture: UNARMED });
    step(rig, frame, actors, out, 0);
    put(actors, 0, { posture: CROUCH });
    let lowest = Infinity;
    let highest = -Infinity;
    for (let n = 1; n < 10; n++) {
      step(rig, frame, actors, out, n);
      // Sola das duas chuteiras: y mínimo das quinas da caixa (4,05 × 2,7 × 5,25 em (0; −1,15; 0,55)).
      let sole = Infinity;
      for (const b of [10, 11]) {
        for (let q = 0; q < 8; q++) {
          const x = (q & 1 ? 1 : -1) * 2.025;
          const y = -1.15 + (q & 2 ? 1 : -1) * 1.35;
          const z = 0.55 + (q & 4 ? 1 : -1) * 2.625;
          const o = b * 16;
          sole = Math.min(sole, out[o + 1]! * x + out[o + 5]! * y + out[o + 9]! * z + out[o + 13]!);
        }
      }
      lowest = Math.min(lowest, sole);
      highest = Math.max(highest, sole);
    }
    // A cócoras funda gira o pé: a quina da sola pode descer uns mm; sem a correção o pé afundava ~9 cm.
    expect(lowest).toBeGreaterThan(-0.02);
    expect(highest).toBeLessThan(0.02);
  });

  it('E.17: a mesma sequência de ActorBuffer e dt dá as mesmas matrizes; hash depois de 600 quadros travado', () => {
    const run = (): string => {
      const table = createSyntheticFigureTable();
      const rig = createFigureRig(4);
      rig.setTable(table);
      rig.setLod(20, true);
      const actors = createActorBuffer(4);
      actors.count = 4;
      const frame = createHarnessFrame(1, 0, 1.55, 8);
      const out = new Float32Array(4 * 192);
      const weapon = new Float32Array(16);
      let h = 0x811c9dc5;
      for (let n = 0; n < 600; n++) {
        const t = n / 60;
        // dt variável e determinístico (30 a 120 Hz).
        frame.dt = [1 / 60, 1 / 30, 1 / 120, 1 / 60][n % 4]!;
        const run = t > 1 && t < 4;
        put(actors, 0, {
          entity: 11,
          posture: run ? figurePosture(FIGURE_STANCE.stand, FIGURE_GRIP.rifle, FIGURE_MODE.sprint, false) : RIFLE,
          pose: (run ? ACTOR_POSE.sprint : 0) | (n % 7 === 0 ? ACTOR_POSE.firing : 0),
          vz: run ? -6.8 : 0,
          z: -t * 2,
          pitch: Math.sin(t) * 0.8,
          recoil: n % 7 === 0 ? 1 : 0.4,
          flash: t > 5 && t < 5.3 ? 1 : 0,
        });
        put(actors, 1, {
          entity: 22,
          posture: t > 2 && t < 6 ? RIFLE_CROUCH : RIFLE,
          pose: (t > 2 && t < 6 ? ACTOR_POSE.crouch : 0) | (t > 7 && t < 7.6 ? ACTOR_POSE.airborne : 0),
          x: 2,
          z: -5,
          vx: Math.sin(t * 6) * 4.8,
          yaw: t * 0.7,
          reload: t > 8 ? (t - 8) / 2 : 0,
        });
        put(actors, 2, {
          entity: 33,
          posture: t > 3 && t < 3.7 ? SLIDE : ZOMBIE,
          weapon: 255,
          x: -3,
          z: -30,
          vz: -3,
          scale: 1.3,
          pose: n < 30 ? ACTOR_POSE.spawning : 0,
        });
        put(actors, 3, { entity: 0, posture: UNARMED, weapon: 255, x: 1, z: 20, pitch: 1 });
        rig.begin(frame, actors, n);
        for (let i = 0; i < 4; i++) {
          const r = rig.pose(actors, i, out, i * 192, false);
          const armed = rig.weapon(weapon, 0);
          h = fnv1a32(new Uint8Array([r, armed ? 1 : 0, rig.expression]), h);
          if (armed) h = fnv1a32(new Uint8Array(weapon.buffer), h);
        }
        rig.end(n);
        h = fnv1a32(new Uint8Array(out.buffer), h);
      }
      return hashToHex(h);
    };
    const a = run();
    expect(run()).toBe(a);
    // Muda se mudar o motor, os ganhos (`FIGURE_MOTION`) ou as bases congeladas do `figure.ts`: refazer de propósito.
    // `9cd6df1e` → `3ecdbb31`: arma na moldura da mira (decisão 3 da §I) e recarga no envelope (decisão 4).
    expect(a).toBe('3ecdbb31');
  });

  it('E.17 (texto): sem sorteio nem relógio em render/src/actors/anim/**', () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const banned = new RegExp(['Math\\s*\\.\\s*random', 'Date\\s*\\.\\s*now', 'performance\\s*\\.\\s*now'].join('|'));
    // anim/** inteiro (subpastas também).
    const files = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThanOrEqual(5);
    for (const f of files) {
      // Comentários e strings fora (o teste não pode casar consigo mesmo nem com a documentação).
      const src = readFileSync(join(dir, f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '')
        .replace(/'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g, "''");
      expect(banned.test(src), f).toBe(false);
    }
  });

  it('não escreve a 4ª linha das matrizes (luz e expressão são da F3), nem no quadro deslocado', () => {
    const rig = createFigureRig(2);
    rig.setTable(createSyntheticFigureTable());
    rig.setLod(20, true);
    const actors = createActorBuffer(2);
    actors.count = 2;
    const frame = createHarnessFrame(1, 0, 1.55, 0);
    // Vista olhando para −Z: atrás da câmera (z > 0) fica fora.
    frame.views.planes.fill(0, 0, 24);
    for (let p = 0; p < 6; p++) frame.views.planes[p * 4 + 3] = 1;
    frame.views.planes[2] = -1;
    frame.views.planes[3] = 0;
    const out = new Float32Array(2 * 192).fill(7);
    for (let n = 0; n < 10; n++) {
      put(actors, 0, { entity: 5, z: -5, vz: -4.8 });
      put(actors, 1, { entity: 6, z: 10 + n * 0.1, vz: 6 });
      step(rig, frame, actors, out, n);
    }
    for (let k = 3; k < out.length; k += 4) expect(out[k]).toBe(7);
  });

  describe('LOD', () => {
    function lodFixture(): { rig: FigureRig; actors: ActorBuffer; frame: HarnessFrame; out: Float32Array } {
      const rig = createFigureRig(4);
      rig.setTable(createSyntheticFigureTable());
      rig.setLod(20, true);
      const actors = createActorBuffer(4);
      actors.count = 3;
      const frame = createHarnessFrame(1, 0, 1.55, 0);
      // Vista olhando para −Z (dentro: −z ≥ 0); os outros planos aceitam tudo.
      for (let p = 0; p < 6; p++) {
        frame.views.planes[p * 4] = 0;
        frame.views.planes[p * 4 + 1] = 0;
        frame.views.planes[p * 4 + 2] = 0;
        frame.views.planes[p * 4 + 3] = 1;
      }
      frame.views.planes[2] = -1;
      frame.views.planes[3] = 0;
      return { rig, actors, frame, out: new Float32Array(4 * 192) };
    }

    it('L0 perto, L1 longe (meia taxa pela paridade), L2 fora da vista; estatísticas por quadro', () => {
      const { rig, actors, frame, out } = lodFixture();
      const results: number[][] = [];
      for (let n = 0; n < 6; n++) {
        put(actors, 0, { entity: 1, z: -10 });
        put(actors, 1, { entity: 2, z: -30 });
        put(actors, 2, { entity: 3, z: 10 });
        results.push(step(rig, frame, actors, out, n));
        expect(rig.stats).toEqual({ l0: 1, l1: 1, l2: 1 });
      }
      const C = FIGURE_POSE_RESULT.computed;
      const S = FIGURE_POSE_RESULT.shifted;
      expect(results.map((r) => r[0])).toEqual([C, C, C, C, C, C]);
      // L1: o 1º quadro calcula (entidade nova); depois alterna.
      const l1 = results.map((r) => r[1]);
      expect(l1[0]).toBe(C);
      for (let n = 1; n < 5; n++) expect(l1[n]).not.toBe(l1[n + 1]);
      expect(results.slice(1).map((r) => r[2])).toEqual([S, S, S, S, S]);
      // Sem meia taxa, tudo que está na vista é L0.
      rig.setLod(20, false);
      step(rig, frame, actors, out, 6);
      expect(rig.stats).toEqual({ l0: 2, l1: 0, l2: 1 });
    });

    it('L2 que anda leva a pose junto (sem caixa na posição antiga) e volta com 1 quadro cheio', () => {
      const { rig, actors, frame, out } = lodFixture();
      actors.count = 1;
      put(actors, 0, { entity: 9, x: 0, z: 10 });
      step(rig, frame, actors, out, 0);
      const first = out.slice(0, 192);
      for (let n = 1; n <= 20; n++) {
        put(actors, 0, { entity: 9, x: 0.25 * n, z: 10, vx: 15 });
        expect(step(rig, frame, actors, out, n)[0]).toBe(FIGURE_POSE_RESULT.shifted);
      }
      for (let b = 0; b < 12; b++) {
        expect(out[b * 16 + 12]).toBeCloseTo(first[b * 16 + 12]! + 5, 4);
        expect(out[b * 16 + 13]).toBeCloseTo(first[b * 16 + 13]!, 5);
        expect(out[b * 16 + 14]).toBeCloseTo(first[b * 16 + 14]!, 5);
      }
      // Entra na vista longe (L1): o 1º quadro é cheio mesmo na paridade "pulada".
      let n = 21;
      put(actors, 0, { entity: 9, x: 5, z: -40 });
      if (((9 + n) & 1) === 0) n++;
      expect(step(rig, frame, actors, out, n)[0]).toBe(FIGURE_POSE_RESULT.computed);
      expect(rig.stats.l1).toBe(1);
      expect(step(rig, frame, actors, out, n + 1)[0]).toBe(FIGURE_POSE_RESULT.computed);
      expect(step(rig, frame, actors, out, n + 2)[0]).toBe(FIGURE_POSE_RESULT.shifted);
    });

    it('de volta do L2 sem tranco: a velocidade de antes (correndo) não vira freada nem mola', () => {
      // Dois rigs no mesmo roteiro: o motor e o motor parado. O ator corre na vista, para escondido (L2) e volta parado:
      // nos quadros depois da volta a cabeça fica perto da base (só a respiração), sem o tranco da aceleração velha.
      const views = (): HarnessFrame => {
        const f = createHarnessFrame(1, 0, 1.55, 0);
        f.views.planes[2] = -1;
        f.views.planes[3] = 0;
        return f;
      };
      const full = createFigureRig(1);
      const base = createFigureRig(1, { motion: FIGURE_MOTION_STOPPED });
      const table = createSyntheticFigureTable();
      full.setTable(table);
      base.setTable(table);
      const actors = createActorBuffer(1);
      actors.count = 1;
      const frame = views();
      const a = new Float32Array(192);
      const b = new Float32Array(192);
      let worst = 0;
      for (let n = 0; n < 150; n++) {
        const hidden = n >= 60 && n < 120;
        put(actors, 0, {
          entity: 31,
          z: hidden ? 5 : -5,
          vz: n < 60 ? -6.8 : 0,
          pose: n < 60 ? ACTOR_POSE.sprint : 0,
          posture: n < 60 ? figurePosture(FIGURE_STANCE.stand, FIGURE_GRIP.rifle, FIGURE_MODE.sprint, false) : RIFLE,
        });
        step(full, frame, actors, a, n);
        step(base, frame, actors, b, n);
        if (n >= 120) {
          const dx = a[12]! - b[12]!;
          const dy = a[13]! - b[13]!;
          const dz = a[14]! - b[14]!;
          worst = Math.max(worst, Math.hypot(dx, dy, dz) / FIGURE_PX_M);
        }
      }
      // A pose da corrida (pernas, braços) assenta em ~0,3 s pelos pesos; o tronco não toma o tranco da freada.
      expect(worst).toBeLessThan(1);
    });

    it('de volta do L2 sem a aceleração velha: some no meio da arrancada e volta em regime', () => {
      // A mesma arrancada (60 m/s² até 6,8 m/s) com e sem sumir no meio dela; nos 0,6 s depois da volta (já em regime) a
      // cabeça fica tão perto da base quanto na corrida que nunca sumiu. Os filtros de aceleração guardados de antes do
      // L2 empurravam a mola na volta (+0,22 px; com os filtros zerados sobram +0,07 px das molas congeladas, §B6).
      const SPRINT = figurePosture(FIGURE_STANCE.stand, FIGURE_GRIP.rifle, FIGURE_MODE.sprint, false);
      const run = (hidden: (n: number) => boolean): number => {
        const full = createFigureRig(1);
        const base = createFigureRig(1, { motion: FIGURE_MOTION_STOPPED });
        const table = createSyntheticFigureTable();
        full.setTable(table);
        base.setTable(table);
        const actors = createActorBuffer(1);
        actors.count = 1;
        const frame = createHarnessFrame(1, 0, 1.55, 0);
        frame.views.planes[2] = -1;
        frame.views.planes[3] = 0;
        const a = new Float32Array(192);
        const b = new Float32Array(192);
        let z = -5;
        let worst = 0;
        for (let n = 0; n < 186; n++) {
          const t = n / 60;
          const v = t < 0.5 ? 0 : Math.min(6.8, (t - 0.5) * 60);
          z -= v / 60;
          const sprint = v > 4;
          put(actors, 0, {
            entity: 9,
            z: hidden(n) ? 5 : z,
            vz: -v,
            pose: sprint ? ACTOR_POSE.sprint : 0,
            posture: sprint ? SPRINT : RIFLE,
          });
          step(full, frame, actors, a, n);
          step(base, frame, actors, b, n);
          if (n >= 150) {
            // Centro da cabeça (0, 4, 0) no osso 0.
            const p = (m: Float32Array, r: number): number => m[4 + r]! * 4 + m[12 + r]!;
            worst = Math.max(worst, Math.hypot(p(a, 0) - p(b, 0), p(a, 1) - p(b, 1), p(a, 2) - p(b, 2)) / FIGURE_PX_M);
          }
        }
        return worst;
      };
      const reference = run(() => false);
      const returned = run((n) => n >= 32 && n < 150);
      expect(returned).toBeLessThan(reference + 0.15);
    });

    it('a vista em 1ª pessoa não conta para o próprio corpo; `force` recalcula em L2', () => {
      const { rig, actors, frame, out } = lodFixture();
      actors.count = 1;
      frame.views.owner[0] = 2;
      put(actors, 0, { entity: 4, z: -5, localSlot: 2 });
      step(rig, frame, actors, out, 0);
      expect(rig.stats).toEqual({ l0: 0, l1: 0, l2: 1 });
      expect(step(rig, frame, actors, out, 1)[0]).toBe(FIGURE_POSE_RESULT.shifted);
      expect(step(rig, frame, actors, out, 2, true)[0]).toBe(FIGURE_POSE_RESULT.computed);
      // Outra vista (sem dono) vê: L0.
      frame.views.count = 2;
      frame.views.owner[1] = 255;
      frame.views.planes.copyWithin(24, 0, 24);
      step(rig, frame, actors, out, 3);
      expect(rig.stats).toEqual({ l0: 1, l1: 0, l2: 0 });
    });
  });

  it('arma (decisão 3): moldura da mira na palma D do FK, numa 4×4 em metros; sem arma, zumbi ou modelo 255 não há', () => {
    // A tabela sintética gira a `grip` com o pitch em volta do antebraço (não na moldura): a orientação da arma tem de
    // vir da moldura (yaw da raiz + pitch), e só a translação da `grip` (a palma D no antebraço D) vale.
    const table = createSyntheticFigureTable();
    const rig = createFigureRig(1, { motion: FIGURE_MOTION_STOPPED });
    rig.setTable(table);
    const actors = createActorBuffer(1);
    actors.count = 1;
    const frame = createHarnessFrame();
    const out = new Float32Array(192);
    const w = new Float32Array(16);
    const grip = new Float32Array(16);
    const yaw = 0.5;
    const pitch = 0.4;
    put(actors, 0, { posture: RIFLE, pitch, x: 1, z: -3, yaw, scale: 1.3 });
    step(rig, frame, actors, out, 0);
    expect(rig.weapon(w, 0)).toBe(true);
    // Origem: antebraço D × a translação da `grip` (px).
    figureGripMatrix(table, RIFLE, pitch, grip, 0);
    const f = 4 * 16;
    for (let r = 0; r < 3; r++) {
      let v = out[f + 12 + r]!;
      for (let k = 0; k < 3; k++) v += out[f + k * 4 + r]! * grip[12 + k]!;
      expect(w[12 + r]).toBeCloseTo(v, 6);
    }
    // Orientação: escala·Ry(yaw + π)·(x = −x, y = cima da mira, z = −frente da mira) do frame do FutBobo.
    const ry = (v: readonly number[]): number[] => {
      const c = Math.cos(yaw + Math.PI);
      const s = Math.sin(yaw + Math.PI);
      return [1.3 * (c * v[0]! + s * v[2]!), 1.3 * v[1]!, 1.3 * (c * v[2]! - s * v[0]!)];
    };
    const cols = [
      ry([-1, 0, 0]),
      ry([0, Math.cos(pitch), -Math.sin(pitch)]),
      ry([0, -Math.sin(pitch), -Math.cos(pitch)]),
    ];
    for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) expect(w[c * 4 + r]).toBeCloseTo(cols[c]![r]!, 5);
    expect([w[3], w[7], w[11], w[15]]).toEqual([0, 0, 0, 1]);
    for (const spec of [{ posture: UNARMED }, { posture: ZOMBIE, weapon: 255 }, { posture: RIFLE, weapon: 255 }]) {
      put(actors, 0, { entity: 50, ...spec });
      step(rig, frame, actors, out, 1);
      expect(rig.weapon(w, 0)).toBe(false);
    }
  });

  describe('arma na mira (decisão 3, tabela de jogo)', () => {
    const table = createFigureGameTable();
    const ARMED: number[] = [];
    for (let p = 0; p < FIGURE_POSTURES; p++) if (FIGURE_POSTURE_INFO[p * 3 + 1]! !== FIGURE_GRIP.none) ARMED.push(p);
    /** Ângulo da moldura da mira da postura (a mesma da montagem da tabela): clamp do stance; correndo, o tilt. */
    const aimOf = (p: number, pitch: number): number => {
      const def = FIGURE_GRIP_DEFS[FIGURE_POSTURE_INFO[p * 3 + 1]! - 1]!;
      if (FIGURE_POSTURE_INFO[p * 3 + 2] === FIGURE_MODE.sprint) return def.sprintTilt;
      const stance = FIGURE_POSTURE_INFO[p * 3]!;
      const r =
        stance === FIGURE_STANCE.stand
          ? FIGURE_ARM_PITCH.stand
          : stance === FIGURE_STANCE.crouch
            ? FIGURE_ARM_PITCH.crouch
            : FIGURE_ARM_PITCH.slide;
      return Math.max(r[0], Math.min(r[1], pitch));
    };
    /** Ângulo (rad) entre o cano (−z da arma) e a mira de yaw e ângulo `a`. */
    const barrelError = (w: Float32Array, yaw: number, a: number): number => {
      const want = [-Math.sin(yaw) * Math.cos(a), Math.sin(a), -Math.cos(yaw) * Math.cos(a)];
      const len = Math.hypot(w[8]!, w[9]!, w[10]!);
      return Math.acos(Math.min(1, -(w[8]! * want[0]! + w[9]! * want[1]! + w[10]! * want[2]!) / len));
    };
    /** Ponto (px no osso) → mundo. */
    const bonePoint = (out: Float32Array, b: number, y: number): number[] =>
      [0, 1, 2].map((r) => out[b * 16 + 12 + r]! + out[b * 16 + 4 + r]! * y);
    /** px entre a palma D e a origem da arma, e entre a palma E e a telha (ou o pente correndo, se for o caso). */
    const hands = (out: Float32Array, w: Float32Array, p: number, scale: number): [number, number] => {
      const def = FIGURE_GRIP_DEFS[FIGURE_POSTURE_INFO[p * 3 + 1]! - 1]!;
      const second = FIGURE_POSTURE_INFO[p * 3 + 2] === FIGURE_MODE.sprint && def.sprintOnMag ? def.mag : def.left;
      // hand_l − hand_r nos eixos do modelo da arma (o frame do FutBobo troca o sinal de x e z), em m.
      const v = [-second[0] * FIGURE_PX_M, second[1] * FIGURE_PX_M, -second[2] * FIGURE_PX_M];
      const unit = FIGURE_PX_M * scale;
      const handR = bonePoint(out, FIGURE_BONE.forearmR, FIGURE_PALM_Y);
      const handL = bonePoint(out, FIGURE_BONE.forearmL, FIGURE_PALM_Y);
      const tel = [0, 1, 2].map((r) => w[12 + r]! + w[r]! * v[0]! + w[4 + r]! * v[1]! + w[8 + r]! * v[2]!);
      const d = (a: number[], b: number[]): number => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!) / unit;
      return [d([w[12]!, w[13]!, w[14]!], handR), d(tel, handL)];
    };

    it('motor parado: cano ≤ 0,5° da moldura em toda postura armada e pitch (−1,2..1,2, passo 0,05); palma D ≤ 0,1 px', () => {
      const rig = createFigureRig(1, { motion: FIGURE_MOTION_STOPPED });
      rig.setTable(table);
      const actors = createActorBuffer(1);
      actors.count = 1;
      const frame = createHarnessFrame();
      const out = new Float32Array(192);
      const w = new Float32Array(16);
      let barrel = 0;
      let palm = 0;
      let left = 0;
      let leftSlide = 0;
      let entity = 1;
      let n = 0;
      for (const p of ARMED) {
        for (let k = -24; k <= 24; k++) {
          const pitch = k * 0.05;
          const yaw = 0.7 + 0.3 * k;
          const scale = k % 3 === 0 ? 1.3 : 1;
          put(actors, 0, { entity: entity++, posture: p, pitch, x: 3.5, y: 0.25, z: -7, yaw, scale });
          step(rig, frame, actors, out, n++);
          expect(rig.weapon(w, 0)).toBe(true);
          barrel = Math.max(barrel, barrelError(w, yaw, aimOf(p, pitch)));
          const [r, l] = hands(out, w, p, scale);
          palm = Math.max(palm, r);
          if (FIGURE_POSTURE_INFO[p * 3] === FIGURE_STANCE.slide) leftSlide = Math.max(leftSlide, l);
          else left = Math.max(left, l);
        }
      }
      expect((barrel * 180) / Math.PI).toBeLessThanOrEqual(0.5);
      expect(palm).toBeLessThanOrEqual(0.1);
      // Mão E fora da telha (relatado; a interpolação dos ângulos dos braços entre as amostras): em pé e agachado
      // ≤ 0,85 px (sniper em pé, pitch −0,9); no deslize, 1,63 px no pitch ±0,3 (o limite dos braços, ±0,3, cai no
      // meio do intervalo de 0,6 entre as amostras). Os tetos travam esses números com folga.
      expect(left).toBeLessThanOrEqual(1);
      expect(leftSlide).toBeLessThanOrEqual(1.7);
    });

    it('nas amostras a arma é a mesma de antes (antebraço D × figureGripMatrix × S(1/px)) ≤ 1e−5', () => {
      // A tabela monta a arma nesta mesma moldura: nas 5 amostras a mudança da decisão 3 não muda nada.
      const rig = createFigureRig(1, { motion: FIGURE_MOTION_STOPPED });
      rig.setTable(table);
      const actors = createActorBuffer(1);
      actors.count = 1;
      const frame = createHarnessFrame();
      const out = new Float32Array(192);
      const w = new Float32Array(16);
      const grip = new Float32Array(16);
      const f = FIGURE_BONE.forearmR * 16;
      let worst = 0;
      let n = 0;
      for (const p of ARMED) {
        for (let s = 0; s < 5; s++) {
          const pitch = -1.2 + 0.6 * s;
          const scale = s % 2 === 0 ? 1 : 1.3;
          put(actors, 0, { entity: 1 + n, posture: p, pitch, x: -2, y: 1, z: 4, yaw: -1.1 + s, scale });
          step(rig, frame, actors, out, n++);
          rig.weapon(w, 0);
          figureGripMatrix(table, p, pitch, grip, 0);
          for (let c = 0; c < 4; c++) {
            for (let r = 0; r < 3; r++) {
              let v = c === 3 ? out[f + 12 + r]! : 0;
              for (let k = 0; k < 3; k++) v += out[f + k * 4 + r]! * grip[c * 4 + k]!;
              worst = Math.max(worst, Math.abs(w[c * 4 + r]! - (c === 3 ? v : v / FIGURE_PX_M)));
            }
          }
        }
      }
      expect(worst).toBeLessThanOrEqual(1e-5);
    });

    it('motor ligado: molas, passada, giro, pulo e dano não tiram o cano da mira; recuo levanta e recarga gira', () => {
      const rig = createFigureRig(1);
      rig.setTable(table);
      rig.setLod(1000, false);
      const actors = createActorBuffer(1);
      actors.count = 1;
      const frame = createHarnessFrame();
      const out = new Float32Array(192);
      const w = new Float32Array(16);
      const RIFLE_ADS = figurePosture(FIGURE_STANCE.stand, FIGURE_GRIP.rifle, FIGURE_MODE.ads, false);
      let barrel = 0;
      let palm = 0;
      let y = 0;
      let vy = 0;
      for (let n = 0; n < 600; n++) {
        const t = n / 60;
        const posture = t < 3 ? RIFLE : t < 6 ? RIFLE_ADS : RIFLE_CROUCH;
        const pitch = 0.9 * Math.sin(t * 0.8);
        const yaw = t < 4 ? 0.3 * Math.sin(t * 3) : 1.5 * t;
        if (n % 120 === 60 && y <= 0) vy = 4.47;
        if (y > 0 || vy > 0) vy -= 20 / 60;
        y = Math.max(0, y + vy / 60);
        if (y === 0 && vy < 0) vy = 0;
        put(actors, 0, {
          entity: 7,
          posture,
          pitch,
          yaw,
          y,
          vx: Math.floor(t / 0.35) % 2 === 0 ? 4.8 : -4.8,
          pose: (y > 0 ? ACTOR_POSE.airborne : 0) | (posture === RIFLE_CROUCH ? ACTOR_POSE.crouch : 0),
          flash: n % 150 < 10 ? 1 : 0,
        });
        step(rig, frame, actors, out, n);
        rig.weapon(w, 0);
        // Na troca de postura (120 ms) a moldura se mistura entre as duas faixas: o clamp das duas é o mesmo aqui.
        barrel = Math.max(barrel, barrelError(w, yaw, aimOf(posture, pitch)));
        palm = Math.max(palm, hands(out, w, posture, 1)[0]);
      }
      expect((barrel * 180) / Math.PI).toBeLessThanOrEqual(0.5);
      expect(palm).toBeLessThanOrEqual(0.1);
      // Recuo: o cano sobe `recoilArmPitch`·recuo (os braços vão à mesma amostra); recarga: a arma gira em volta do cano.
      put(actors, 0, { entity: 8, posture: RIFLE, pitch: 0.2, yaw: 0.4, recoil: 1 });
      step(rig, frame, actors, out, 600);
      rig.weapon(w, 0);
      expect((barrelError(w, 0.4, 0.2 + FIGURE_MOTION.recoilArmPitch) * 180) / Math.PI).toBeLessThanOrEqual(0.5);
      put(actors, 0, { entity: 9, posture: RIFLE, pitch: 0.2, yaw: 0.4 });
      step(rig, frame, actors, out, 601);
      const still = new Float32Array(16);
      rig.weapon(still, 0);
      put(actors, 0, { entity: 9, posture: RIFLE, pitch: 0.2, yaw: 0.4, reload: 0.5 });
      step(rig, frame, actors, out, 602);
      rig.weapon(w, 0);
      expect((barrelError(w, 0.4, 0.2) * 180) / Math.PI).toBeLessThanOrEqual(0.5);
      const roll = Math.acos(still[0]! * w[0]! + still[1]! * w[1]! + still[2]! * w[2]!);
      expect(roll).toBeCloseTo(FIGURE_MOTION.reloadWeaponRotZ, 4);
    });
  });

  it('arma no quadro deslocado: soma o mesmo deslocamento da raiz', () => {
    const rig = createFigureRig(1);
    rig.setTable(createSyntheticFigureTable());
    const actors = createActorBuffer(1);
    actors.count = 1;
    const frame = createHarnessFrame(1, 0, 1.55, 0);
    frame.views.planes[2] = -1;
    frame.views.planes[3] = 0;
    const out = new Float32Array(192);
    const w = new Float32Array(16);
    // Atrás da câmera: o 1º quadro é cheio (entidade nova), o 2º é L2.
    put(actors, 0, { entity: 3, z: 5 });
    expect(step(rig, frame, actors, out, 0)[0]).toBe(FIGURE_POSE_RESULT.computed);
    expect(rig.weapon(w, 0)).toBe(true);
    const before = w.slice();
    put(actors, 0, { entity: 3, z: 6, x: 0.5 });
    expect(step(rig, frame, actors, out, 1)[0]).toBe(FIGURE_POSE_RESULT.shifted);
    expect(rig.weapon(w, 0)).toBe(true);
    expect(w[12]).toBeCloseTo(before[12]! + 0.5, 5);
    expect(w[13]).toBeCloseTo(before[13]!, 5);
    expect(w[14]).toBeCloseTo(before[14]! + 1, 5);
    expect(w[0]).toBe(before[0]);
  });

  it('piscada: 0,13 s a cada 1,8 + h·3,6 s, só com a expressão neutra; manequim não pisca', () => {
    const rig = createFigureRig(3);
    rig.setTable(createSyntheticFigureTable());
    const actors = createActorBuffer(3);
    actors.count = 3;
    const frame = createHarnessFrame();
    const out = new Float32Array(3 * 192);
    const starts: number[] = [];
    let blinkFrames = 0;
    let run = 0;
    let angrySleeps = 0;
    let mannequinSleeps = 0;
    for (let n = 0; n < 60 * 30; n++) {
      put(actors, 0, { entity: 1234, expression: 0 });
      put(actors, 1, { entity: 77, expression: ANGRY });
      put(actors, 2, { entity: 0, expression: 0, posture: UNARMED, weapon: 255 });
      rig.begin(frame, actors, n);
      rig.pose(actors, 0, out, 0, false);
      const e = rig.expression;
      rig.pose(actors, 1, out, 192, false);
      if (rig.expression === SLEEPING) angrySleeps++;
      rig.pose(actors, 2, out, 384, false);
      if (rig.expression === SLEEPING) mannequinSleeps++;
      rig.end(n);
      if (e === SLEEPING) {
        if (run === 0) starts.push(n / 60);
        run++;
        blinkFrames++;
      } else {
        if (run > 0) {
          expect(run).toBeGreaterThanOrEqual(7);
          expect(run).toBeLessThanOrEqual(9);
        }
        run = 0;
        expect(e).toBe(0);
      }
    }
    expect(angrySleeps).toBe(0);
    expect(mannequinSleeps).toBe(0);
    expect(starts.length).toBeGreaterThanOrEqual(5);
    expect(starts[0]).toBeGreaterThanOrEqual(2 - 1e-6);
    expect(starts[0]).toBeLessThanOrEqual(5 + 1 / 60);
    for (let k = 1; k < starts.length; k++) {
      const gap = starts[k]! - starts[k - 1]!;
      expect(gap).toBeGreaterThanOrEqual(1.93 - 1 / 30);
      expect(gap).toBeLessThanOrEqual(5.53 + 1 / 30);
    }
    expect(blinkFrames).toBeGreaterThan(0);
  });

  it('teto do cabelo: raiz + escala·1,99 em pé, 0,99 agachado ou deslizando; Infinity escondido', () => {
    const rig = createFigureRig(1);
    rig.setTable(createSyntheticFigureTable());
    const actors = createActorBuffer(1);
    actors.count = 1;
    const frame = createHarnessFrame();
    const out = new Float32Array(192);
    put(actors, 0, { y: 2, scale: 1.3, posture: RIFLE });
    step(rig, frame, actors, out, 0);
    expect(rig.hairCeilingY).toBeCloseTo(2 + 1.3 * 1.99, 5);
    put(actors, 0, { y: 2, scale: 1.3, posture: SLIDE, weapon: 255 });
    for (let n = 1; n < 12; n++) step(rig, frame, actors, out, n);
    expect(rig.hairCeilingY).toBeCloseTo(2 + 1.3 * 0.99, 5);
    actors.figure[0] = NO_FIGURE;
    expect(step(rig, frame, actors, out, 12)[0]).toBe(FIGURE_POSE_RESULT.hidden);
    expect(rig.hairCeilingY).toBe(Infinity);
  });

  it('manequim (entidade 0): pitch 0, respiração congelada pelo índice, sem molas; sem tabela tudo some', () => {
    const table = createSyntheticFigureTable();
    const rig = createFigureRig(2);
    rig.setTable(table);
    const actors = createActorBuffer(2);
    actors.count = 2;
    const frame = createHarnessFrame();
    const out = new Float32Array(2 * 192);
    const first = new Float32Array(2 * 192);
    for (let n = 0; n < 90; n++) {
      put(actors, 0, { entity: 0, posture: RIFLE, pitch: 1, flash: n === 30 ? 1 : 0, recoil: 1 });
      put(actors, 1, { entity: 0, posture: RIFLE, pitch: -1 });
      step(rig, frame, actors, out, n);
      if (n === 0) first.set(out);
    }
    expect(boneDiff(out, 0, first, 0)).toBe(0);
    expect(boneDiff(out, 192, first, 192)).toBe(0);
    // Índices diferentes = fases de respiração diferentes; perto da tabela no pitch 0.
    expect(boneDiff(out, 0, out, 192)).toBeGreaterThan(0);
    const ref = new Float32Array(192);
    referenceBones(table, RIFLE, 0, 0, 0, 0, 0, 1, ref);
    expect(boneDiff(out, 0, ref, 0)).toBeLessThan(0.02);
    // O coice também não mexe na arma do manequim.
    const kicked = new Float32Array(16);
    const still = new Float32Array(16);
    rig.begin(frame, actors, 90);
    rig.pose(actors, 0, out, 0, true);
    expect(rig.weapon(kicked, 0)).toBe(true);
    actors.recoil[0] = 0;
    rig.pose(actors, 0, out, 0, true);
    rig.weapon(still, 0);
    rig.end(90);
    expect(Array.from(kicked)).toEqual(Array.from(still));
    rig.setTable(null);
    expect(step(rig, frame, actors, out, 90)).toEqual([FIGURE_POSE_RESULT.hidden, FIGURE_POSE_RESULT.hidden]);
    rig.dispose();
  });

  it('nascer: cada osso cai e encaixa em 0,4 s', () => {
    const table = createSyntheticFigureTable();
    const rig = createFigureRig(1);
    rig.setTable(table);
    const actors = createActorBuffer(1);
    actors.count = 1;
    const frame = createHarnessFrame();
    const out = new Float32Array(192);
    const ref = new Float32Array(192);
    referenceBones(table, RIFLE, 0, 0, 0, 0, 0, 1, ref);
    const drops: number[] = [];
    for (let n = 0; n < 40; n++) {
      put(actors, 0, { entity: 8, pose: n < 30 ? ACTOR_POSE.spawning : 0 });
      step(rig, frame, actors, out, n);
      drops.push(out[11 * 16 + 13]! - ref[11 * 16 + 13]!);
    }
    // O pé E (osso 11) cai mais: 0,5 + 0,11·11 = 1,71 m no começo; encaixado depois de 0,4 s.
    expect(drops[1]).toBeGreaterThan(1.4);
    for (let n = 2; n < 24; n++) expect(drops[n]!).toBeLessThanOrEqual(drops[n - 1]! + 1e-6);
    expect(Math.abs(drops[30]!)).toBeLessThan(0.01);
  });

  it('molas paradas (FLAG.calm) acordam no impulso: tiro depois de 15 s parado mexe o tronco', () => {
    const full = createFigureRig(1);
    const base = createFigureRig(1, { motion: FIGURE_MOTION_STOPPED });
    const table = createSyntheticFigureTable();
    full.setTable(table);
    base.setTable(table);
    const actors = createActorBuffer(1);
    actors.count = 1;
    const frame = createHarnessFrame();
    const a = new Float32Array(192);
    const b = new Float32Array(192);
    // Tronco (osso 1) no ponto (0, 6, 0): a distância do motor à base, em px.
    const torso = (): number => {
      const p = (m: Float32Array, r: number): number => m[16 + 4 + r]! * 6 + m[16 + 12 + r]!;
      return Math.hypot(p(a, 0) - p(b, 0), p(a, 1) - p(b, 1), p(a, 2) - p(b, 2)) / FIGURE_PX_M;
    };
    let quiet = 0;
    let kicked = 0;
    for (let n = 0; n < 60 * 16; n++) {
      const fire = n === 60 * 15;
      put(actors, 0, { entity: 41, pose: fire ? ACTOR_POSE.firing : 0, recoil: 0 });
      step(full, frame, actors, a, n);
      step(base, frame, actors, b, n);
      if (n >= 60 * 14 && n < 60 * 15) quiet = Math.max(quiet, torso());
      if (n > 60 * 15) kicked = Math.max(kicked, torso());
    }
    // Parado, só a respiração separa o motor da base; o tiro empurra a mola de novo.
    expect(kicked).toBeGreaterThan(quiet + 0.05);
  });

  it('motor ligado: sem NaN numa sequência longa com tudo junto', () => {
    const rig = createFigureRig(3, { motion: FIGURE_MOTION });
    rig.setTable(createFigureGameTable());
    const actors = createActorBuffer(3);
    actors.count = 3;
    const frame = createHarnessFrame();
    const out = new Float32Array(3 * 192);
    const w = new Float32Array(16);
    let bad = 0;
    let seed = 12345;
    const rnd = (): number => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed / 4294967296;
    };
    for (let n = 0; n < 2000; n++) {
      frame.dt = rnd() < 0.05 ? 0 : rnd() * 0.1;
      for (let i = 0; i < 3; i++) {
        put(actors, i, {
          entity: 100 + i,
          posture: Math.floor(rnd() * FIGURE_POSTURES),
          pose: Math.floor(rnd() * 256),
          vx: (rnd() - 0.5) * 20,
          vz: (rnd() - 0.5) * 20,
          yaw: rnd() * 20,
          pitch: (rnd() - 0.5) * 4,
          recoil: rnd(),
          reload: rnd(),
          flash: rnd(),
          weapon: rnd() < 0.2 ? 255 : 0,
        });
      }
      rig.begin(frame, actors, n);
      for (let i = 0; i < 3; i++) {
        rig.pose(actors, i, out, i * 192, false);
        if (rig.weapon(w, 0)) for (let k = 0; k < 16; k++) if (!Number.isFinite(w[k]!)) bad++;
        if (!Number.isFinite(rig.hairCeilingY)) bad++;
      }
      rig.end(n);
      for (let k = 0; k < out.length; k++) if (k % 4 !== 3 && !Number.isFinite(out[k]!)) bad++;
    }
    expect(bad).toBe(0);
  });
});
