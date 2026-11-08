// E.14 (PLANO do porte §E): faixas estáveis, compactação só em evento (matrizes junto com os dados), ator em L2 ou no
// quadro pulado do L1 nunca com matriz alheia, ator em L2 que anda sem caixa na posição antiga, prefixo que nunca sobe
// depois do loading, codec da 4ª linha = gêmeo do VS, count ≤ capacidade e esfera fixa na malha.
import {
  createFigureGameTable,
  createFigureTemplateSet,
  FIGURE_BONES,
  FIGURE_LOOK_DEFAULT,
  FIGURE_PRESETS,
  type FigureGameTable,
} from '@boboforces/format';
import { BufferGeometry, Frustum, InstancedBufferAttribute, Matrix4, PerspectiveCamera, ShaderMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { createFrameViews, type FrameContext } from '../shared/passes.ts';
import { ACTOR_KIND, ACTOR_POSE, createActorBuffer, createRenderDebug, NO_FIGURE, type ActorBuffer } from '../types.ts';
import { FIGURE_POSE_RESULT, type FigurePoseResult, type FigureRig } from './anim/types.ts';
import { createFigureFrame } from './figure-frame.ts';
import { createFigureInstances, FIGURE_INSTANCES_MAX } from './figure-instances.ts';
import { createRestFigureRig } from './figure-rest-rig.ts';
import { figureRow4Expression } from './figure-row4.ts';
import { MAT4 } from './math.ts';
import { FIXED_SPHERE_RADIUS, instancedMesh } from './three-objects.ts';

const templates = createFigureTemplateSet([FIGURE_LOOK_DEFAULT, FIGURE_PRESETS.mechanic, FIGURE_PRESETS.blackpower]);
let table: FigureGameTable | null = null;
const gameTable = (): FigureGameTable => (table ??= createFigureGameTable());

function frameCtx(): FrameContext {
  return { dt: 1 / 60, timeS: 0, debug: createRenderDebug(), world: null, views: createFrameViews() };
}

function actorsOf(n: number, template = (i: number) => i % 3): ActorBuffer {
  const a = createActorBuffer(Math.max(8, n));
  a.count = n;
  for (let i = 0; i < n; i++) {
    a.entity[i] = 0x00010000 + i + 1;
    a.position.set([i * 2, 0, -3], i * 3);
    a.figure[i] = template(i);
    a.skin[i] = 100 + 2 * (i % 3);
    a.localSlot[i] = 255;
    a.weapon[i] = 255;
  }
  return a;
}

/** Marca as matrizes da faixa do registro com um valor (identifica de quem é a matriz). */
function stamp(inst: ReturnType<typeof createFigureInstances>, r: number, value: number): void {
  const s = inst.recStart[r]!;
  inst.matrices.fill(value, s * MAT4, (s + inst.recBoxes[r]!) * MAT4);
}

function placeAll(inst: ReturnType<typeof createFigureInstances>, a: ActorBuffer, frame: number): void {
  inst.begin(frame, a.count);
  for (let i = 0; i < a.count; i++) {
    if (a.figure[i] === NO_FIGURE || (a.pose[i]! & ACTOR_POSE.dead) !== 0) continue;
    inst.place(i, a.entity[i]!, a.kind[i] === ACTOR_KIND.mannequin, a.figure[i]!, a.skin[i]!, a.localSlot[i]!, 0);
  }
  inst.end();
}

describe('instâncias dos bonecos (E.14)', () => {
  it('faixas estáveis e dados só no quadro de evento', () => {
    const inst = createFigureInstances();
    inst.setTemplates(templates);
    const a = actorsOf(3);
    placeAll(inst, a, 1);
    const starts = [0, 1, 2].map((i) => inst.recStart[inst.actorRecord[i]!]);
    expect(starts[0]).toBe(0);
    expect(inst.count).toBe(templates.length[0]! + templates.length[1]! + templates.length[2]!);
    // 1º quadro: todo ator é novo (dados e pose com force).
    expect([inst.dataFirst, inst.dataLast]).toEqual([0, inst.count - 1]);
    expect([0, 1, 2].map((i) => inst.actorFresh[i])).toEqual([1, 1, 1]);
    for (let f = 2; f < 30; f++) {
      placeAll(inst, a, f);
      expect([0, 1, 2].map((i) => inst.recStart[inst.actorRecord[i]!])).toEqual(starts);
      expect(inst.dataFirst).toBe(-1);
      expect([0, 1, 2].map((i) => inst.actorFresh[i])).toEqual([0, 0, 0]);
    }
    expect(inst.compactions).toBe(0);
    // A ordem no ActorBuffer muda: as faixas seguem a entidade, não o índice.
    const b = actorsOf(3);
    b.entity.set([a.entity[2]!, a.entity[0]!, a.entity[1]!]);
    b.figure.set([a.figure[2]!, a.figure[0]!, a.figure[1]!]);
    b.skin.set([a.skin[2]!, a.skin[0]!, a.skin[1]!]);
    placeAll(inst, b, 30);
    expect(inst.recStart[inst.actorRecord[0]!]).toBe(starts[2]);
    expect(inst.recStart[inst.actorRecord[1]!]).toBe(starts[0]);
    expect(inst.dataFirst).toBe(-1);
    // Troca de skin: dados reescritos no lugar, sem mover ninguém e sem pose forçada.
    b.skin[1] = 120;
    placeAll(inst, b, 31);
    expect([inst.dataFirst, inst.dataLast]).toEqual([starts[0], starts[0]! + templates.length[0]! - 1]);
    expect(inst.data[starts[0]! * 16]).toBe(120);
    expect(inst.actorFresh[1]).toBe(0);
  });

  it('compactação só em evento, com as matrizes junto: L2 e quadro pulado do L1 nunca ficam com matriz alheia', () => {
    const inst = createFigureInstances();
    inst.setTemplates(templates);
    const a = actorsOf(5);
    placeAll(inst, a, 1);
    for (let i = 0; i < 5; i++) stamp(inst, inst.actorRecord[i]!, 1000 + i);
    // O ator 1 morre: os de depois descem; ninguém posa (todos "em L2"), e cada faixa continua com as SUAS matrizes.
    a.pose[1] = ACTOR_POSE.dead;
    placeAll(inst, a, 2);
    expect(inst.actorRecord[1]).toBe(-1);
    expect(inst.compactions).toBeGreaterThan(0);
    for (const i of [0, 2, 3, 4]) {
      const r = inst.actorRecord[i]!;
      const s = inst.recStart[r]!;
      const n = inst.recBoxes[r]!;
      for (let k = s * MAT4; k < (s + n) * MAT4; k++) expect(inst.matrices[k], `ator ${i}`).toBe(1000 + i);
      // Mudou de lugar: a pose fica (sem force) e só os dados sobem.
      expect(inst.actorFresh[i]).toBe(0);
    }
    // Dados movidos junto (a 1ª camada da skin de cada caixa continua a do dono).
    for (const i of [0, 2, 3, 4]) expect(inst.data[inst.recStart[inst.actorRecord[i]!]! * 16]).toBe(a.skin[i]);
    expect(inst.dataFirst).toBe(inst.recStart[inst.actorRecord[2]!]);
    const after = inst.count;
    expect(after).toBe([0, 2, 3, 4].reduce((s, i) => s + templates.length[a.figure[i]!]!, 0));
    // O morto deixou as 12 matrizes de osso do último quadro no cemitério.
    const g = inst.findGrave(a.entity[1]!);
    expect(g).toBeGreaterThanOrEqual(0);
    expect(inst.graveBones[g * FIGURE_BONES * MAT4]).toBe(1001);
    // Sem evento: nada se move nem sobe.
    const compactions = inst.compactions;
    placeAll(inst, a, 3);
    expect(inst.compactions).toBe(compactions);
    expect(inst.dataFirst).toBe(-1);
    // Um novo entra no fim, com pose forçada.
    a.pose[1] = 0;
    a.entity[1] = 0x00020002;
    placeAll(inst, a, 4);
    expect(inst.recStart[inst.actorRecord[1]!]).toBe(after);
    expect(inst.actorFresh[1]).toBe(1);
  });

  it('prefixo dos manequins: escrito no loading e de novo só se a linha mudar; o upload começa depois dele', () => {
    const inst = createFigureInstances();
    inst.setTemplates(templates);
    const a = actorsOf(4);
    a.kind[0] = ACTOR_KIND.mannequin;
    a.entity[0] = 0;
    a.kind[1] = ACTOR_KIND.mannequin;
    a.entity[1] = 0;
    const frame = createFigureFrame(createRestFigureRig(), inst);
    frame.setFigures(templates, gameTable());
    frame.update(frameCtx(), a, 1);
    expect(inst.prefixDirty).toBe(true);
    expect(inst.prefixEnd).toBe(templates.length[0]! + templates.length[1]!);
    expect(inst.recStart[inst.actorRecord[0]!]).toBe(0);
    const prefix = inst.matrices.slice(0, inst.prefixEnd * MAT4);
    for (let f = 2; f < 40; f++) {
      a.position[2 * 3] = f * 0.1;
      frame.update(frameCtx(), a, f);
      expect(inst.prefixDirty, `quadro ${f}`).toBe(false);
      expect(inst.actorFresh[0]).toBe(0);
    }
    expect(inst.matrices.slice(0, inst.prefixEnd * MAT4)).toEqual(prefix);
    // A luz de um manequim muda (a única coisa que mexe nele na partida): o prefixo posa e sobe uma vez.
    a.light[1 * 3] = 0.5;
    frame.update(frameCtx(), a, 40);
    expect(inst.prefixDirty).toBe(true);
    frame.update(frameCtx(), a, 41);
    expect(inst.prefixDirty).toBe(false);
  });

  it('prefixo estável com os manequins DEPOIS das entidades (ordem do game): morte e renascimento não o refazem', () => {
    // O `game` escreve as entidades vivas e depois os manequins (entidade 0), e tira os mortos do `ActorBuffer`: o
    // índice dos manequins muda a cada morte. A chave deles é a ordem entre os manequins, não o índice.
    const inst = createFigureInstances();
    const frame = createFigureFrame(createRestFigureRig(), inst);
    frame.setFigures(templates, gameTable());
    const fill = (alive: number): ActorBuffer => {
      const a = actorsOf(alive + 2);
      for (const k of [0, 1]) {
        const i = alive + k;
        a.entity[i] = 0;
        a.kind[i] = ACTOR_KIND.mannequin;
        a.position.set([10 + k * 2, 0, 5], i * 3);
        a.figure[i] = k;
        a.skin[i] = 50 + 2 * k;
      }
      return a;
    };
    frame.update(frameCtx(), fill(3), 1);
    expect(inst.prefixDirty).toBe(true);
    const prefixEnd = inst.prefixEnd;
    expect(prefixEnd).toBe(templates.length[0]! + templates.length[1]!);
    const prefix = inst.matrices.slice(0, prefixEnd * MAT4);
    frame.update(frameCtx(), fill(3), 2);
    const events = inst.events;
    // Um morre (sai do buffer: os manequins sobem um índice) e depois renasce.
    for (const [alive, f] of [
      [2, 3],
      [3, 4],
      [1, 5],
    ] as const) {
      const a = fill(alive);
      frame.update(frameCtx(), a, f);
      expect(inst.prefixDirty, `quadro ${f}`).toBe(false);
      expect(inst.prefixEnd).toBe(prefixEnd);
      for (const i of [alive, alive + 1]) {
        expect(inst.actorFresh[i], `manequim ${i} no quadro ${f}`).toBe(0);
        expect(inst.recStart[inst.actorRecord[i]!]).toBe(i === alive ? 0 : templates.length[0]);
      }
    }
    // Só as entidades geraram eventos (sai, entra, sai): os manequins nenhum.
    expect(inst.events - events).toBe(1 + 1 + 2);
    expect(inst.matrices.slice(0, prefixEnd * MAT4)).toEqual(prefix);
  });

  it('ator em L2 que anda: o rig só soma o deslocamento, e nenhuma caixa (mãos, cabelo) fica na posição antiga', () => {
    // Rig de teste: 1º quadro = pose de repouso; depois sempre `shifted` (L2) somando o deslocamento da raiz.
    const rest = createRestFigureRig();
    const last = new Float32Array(3 * 64).fill(NaN);
    let lastResult: FigurePoseResult = FIGURE_POSE_RESULT.hidden;
    const rig: FigureRig = {
      setTable: (t) => rest.setTable(t),
      setLod: () => {},
      begin: () => {},
      pose(actors, i, out, o, force) {
        const x = actors.position[i * 3]!;
        const y = actors.position[i * 3 + 1]!;
        const z = actors.position[i * 3 + 2]!;
        if (force || Number.isNaN(last[i * 3]!)) {
          rest.pose(actors, i, out, o, true);
          lastResult = FIGURE_POSE_RESULT.computed;
        } else {
          for (let b = 0; b < FIGURE_BONES; b++) {
            out[o + b * 16 + 12] = out[o + b * 16 + 12]! + x - last[i * 3]!;
            out[o + b * 16 + 13] = out[o + b * 16 + 13]! + y - last[i * 3 + 1]!;
            out[o + b * 16 + 14] = out[o + b * 16 + 14]! + z - last[i * 3 + 2]!;
          }
          lastResult = FIGURE_POSE_RESULT.shifted;
        }
        last.set([x, y, z], i * 3);
        return lastResult;
      },
      expression: 0,
      hairCeilingY: Infinity,
      weapon: () => false,
      end: () => {},
      stats: { l0: 0, l1: 0, l2: 0 },
      dispose: () => {},
    };
    const inst = createFigureInstances();
    const frame = createFigureFrame(rig, inst);
    frame.setFigures(templates, gameTable());
    const a = actorsOf(3, () => 2); // black power: muitas caixas de cabelo
    frame.update(frameCtx(), a, 1);
    const r = inst.actorRecord[1]!;
    const s = inst.recStart[r]!;
    const n = inst.recBoxes[r]!;
    expect(n).toBeGreaterThan(14);
    const before = inst.matrices.slice(s * MAT4, (s + n) * MAT4);
    a.position[1 * 3] = a.position[1 * 3]! + 3;
    a.position[1 * 3 + 2] = a.position[1 * 3 + 2]! - 1;
    // O ator 0 sai: a faixa do 1 desce (compactação) no mesmo quadro em que ele anda em L2.
    a.figure[0] = NO_FIGURE;
    frame.update(frameCtx(), a, 2);
    expect(lastResult).toBe(FIGURE_POSE_RESULT.shifted);
    const s2 = inst.recStart[r]!;
    expect(s2).toBeLessThan(s);
    for (let k = 0; k < n; k++) {
      const o = (s2 + k) * MAT4;
      expect(inst.matrices[o + 12]! - before[k * MAT4 + 12]!, `caixa ${k}`).toBeCloseTo(3, 5);
      expect(inst.matrices[o + 14]! - before[k * MAT4 + 14]!, `caixa ${k}`).toBeCloseTo(-1, 5);
      expect(inst.matrices[o + 13]).toBeCloseTo(before[k * MAT4 + 13]!, 5);
    }
  });

  it('4ª linha: luz, expressão e clarão por caixa; o gêmeo do VS devolve a expressão', () => {
    const inst = createFigureInstances();
    const frame = createFigureFrame(createRestFigureRig(), inst);
    frame.setFigures(templates, gameTable());
    const a = actorsOf(2);
    a.light.set([0.25, 0.75, 0.5], 3);
    for (let e = 0; e < 8; e++) {
      for (const flash of [0, 0.3, 1]) {
        a.expression[1] = e;
        a.damageFlash[1] = flash;
        frame.update(frameCtx(), a, e * 3 + (flash > 0 ? (flash < 1 ? 1 : 2) : 0) + 1);
        const r = inst.actorRecord[1]!;
        for (let k = 0; k < inst.recBoxes[r]!; k++) {
          const o = (inst.recStart[r]! + k) * MAT4;
          expect([inst.matrices[o + 3], inst.matrices[o + 7], inst.matrices[o + 11]]).toEqual([0.25, 0.75, 0.5]);
          const w = inst.matrices[o + 15]!;
          expect(figureRow4Expression(w)).toBe(e);
          expect(Math.fround(w - 2 * figureRow4Expression(w))).toBeCloseTo(flash, 6);
        }
      }
    }
  });

  it('count ≤ capacidade: o que não cabe não desenha e conta como estouro', () => {
    const inst = createFigureInstances(4);
    inst.setTemplates(templates);
    const a = actorsOf(7, () => 2);
    placeAll(inst, a, 1);
    expect(inst.count).toBeLessThanOrEqual(inst.capacity);
    expect(inst.overflow).toBe(3);
    expect([...a.entity.slice(0, 7)].map((_, i) => inst.actorRecord[i]! >= 0).filter(Boolean).length).toBe(4);
    expect(FIGURE_INSTANCES_MAX).toBe(72 * 44);
  });

  it('esfera envolvente fixa: o three nunca recalcula (nem com N quadros de instâncias mudando)', () => {
    const matrices = new InstancedBufferAttribute(new Float32Array(32 * 16), 16);
    const mesh = instancedMesh(new BufferGeometry(), new ShaderMaterial(), matrices, 'bobos');
    const sphere = mesh.boundingSphere;
    expect(sphere?.radius).toBe(FIXED_SPHERE_RADIUS);
    expect(sphere?.center.toArray()).toEqual([0, 0, 0]);
    let computed = 0;
    mesh.computeBoundingSphere = () => {
      computed++;
    };
    const camera = new PerspectiveCamera(70, 1, 0.1, 100);
    camera.updateMatrixWorld();
    const frustum = new Frustum().setFromProjectionMatrix(
      new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    );
    for (let f = 0; f < 50; f++) {
      mesh.count = f % 32;
      // 4ª linha com dados (luz, expressão), como nas caixas.
      matrices.array[(f % 32) * 16 + 15] = 2 * (f % 8) + 0.5;
      matrices.needsUpdate = true;
      frustum.intersectsObject(mesh);
    }
    expect(computed).toBe(0);
    expect(mesh.boundingSphere).toBe(sphere);
    expect(sphere?.radius).toBe(FIXED_SPHERE_RADIUS);
  });
});
