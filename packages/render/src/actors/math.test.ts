// Matemática sem alocação dos atores (matrizes e quatérnios contra o three) e a tabela de estado por entidade. Eram o
// começo do teste do rig do bobo A (saiu no passo 5 do porte do boneco, #56); o rig novo tem os dele em `anim/`.
import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { actorKey, createEntityTable } from './entity-table.ts';
import {
  m4FromQuat,
  m4Identity,
  m4InverseRigidPoint,
  m4Multiply,
  m4RotateX,
  m4RotateY,
  m4RotateZ,
  m4Scale,
  m4TransformPoint,
  m4Translate,
  MAT4,
  orientedHalfExtent,
  qFromYaw,
  qIntegrate,
  qSettle,
} from './math.ts';

const close = (a: ArrayLike<number>, b: ArrayLike<number>, digits = 5) => {
  for (let k = 0; k < b.length; k++) expect(a[k]!).toBeCloseTo(b[k]!, digits);
};

describe('matrizes e quatérnios (sem alocação)', () => {
  it('a cadeia T·Ry·Rx·Rz·S bate com o three', () => {
    const m = new Float32Array(MAT4);
    m4Identity(m);
    m4Translate(m, 1, 2, 3);
    m4RotateY(m, 0.7);
    m4RotateX(m, -0.4);
    m4RotateZ(m, 0.2);
    m4Scale(m, 2, 3, 4);
    const ref = new Matrix4().compose(
      new Vector3(1, 2, 3),
      new Quaternion().setFromEuler(new Euler(-0.4, 0.7, 0.2, 'YXZ')),
      new Vector3(2, 3, 4),
    );
    close(m, ref.elements);
  });

  it('quatérnio → matriz, multiplicação e inverso rígido de ponto', () => {
    const q = new Float32Array(4);
    qFromYaw(q, 0, 1.1);
    const m = new Float32Array(MAT4);
    m4FromQuat(m, 0, 5, 0, -2, q, 0, 1.5);
    const ref = new Matrix4().compose(
      new Vector3(5, 0, -2),
      new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 1.1),
      new Vector3(1.5, 1.5, 1.5),
    );
    close(m, ref.elements);
    const p = new Float32Array(3);
    m4TransformPoint(m, 0, 0.3, 0.2, -0.1, p, 0);
    const back = new Float32Array(3);
    m4InverseRigidPoint(m, 0, p[0]!, p[1]!, p[2]!, back, 0);
    close(back, [0.3, 0.2, -0.1]);
    const out = new Float32Array(MAT4);
    m4Multiply(out, 0, m, 0, m, 0);
    close(out, new Matrix4().multiplyMatrices(ref, ref).elements, 4);
  });

  it('integra o giro, mede a extensão vertical da caixa girada e assenta numa face', () => {
    const q = new Float32Array([0, 0, 0, 1]);
    expect(orientedHalfExtent(q, 0, 1, 0.1, 0.3, 0.2)).toBeCloseTo(0.3);
    // 90° em Z: o eixo X vira vertical.
    for (let i = 0; i < 100; i++) qIntegrate(q, 0, 0, 0, Math.PI / 2, 0.01);
    expect(orientedHalfExtent(q, 0, 1, 0.1, 0.3, 0.2)).toBeCloseTo(0.1, 3);
    // Inclinada 30° em X: assentar leva de volta a uma face para baixo.
    const tilted = new Float32Array(4);
    new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.5).toArray(tilted);
    for (let i = 0; i < 20; i++) qSettle(tilted, 0, 0.5);
    expect(orientedHalfExtent(tilted, 0, 1, 0.1, 0.3, 0.2)).toBeCloseTo(0.3, 3);
  });
});

describe('tabela de estado por entidade', () => {
  it('guarda, acha de novo e esquece quem sumiu', () => {
    const t = createEntityTable(16, 3);
    const a = t.slot(actorKey(0x00010003, 0), 1);
    expect(t.state[a * 3 + 2]).toBe(0);
    t.state[a * 3 + 1] = 0.5;
    expect(t.slot(actorKey(0x00010003, 5), 2)).toBe(a);
    expect(t.state[a * 3 + 1]).toBe(0.5);
    // Manequins (entidade 0) usam o índice.
    expect(actorKey(0, 1)).not.toBe(actorKey(0, 2));
    for (let e = 10; e < 20; e++) t.slot(e, 3);
    t.sweep(500, 100);
    expect(t.size).toBe(0);
  });
});
