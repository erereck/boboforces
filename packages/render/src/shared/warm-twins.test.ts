import {
  BufferAttribute,
  BufferGeometry,
  Group,
  InstancedInterleavedBuffer,
  InstancedMesh,
  InterleavedBufferAttribute,
  Matrix4,
  PerspectiveCamera,
  ShaderMaterial,
  Vector3,
} from 'three';
import { describe, expect, it } from 'vitest';
import { createWarmTwins } from './warm-twins.ts';

function liveMesh(particle: boolean, material: ShaderMaterial): InstancedMesh {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 2, 0, 0, 0, 4, 0]), 3));
  g.setIndex(new BufferAttribute(new Uint16Array([0, 1, 2]), 1));
  const buffer = new InstancedInterleavedBuffer(new Float32Array(particle ? 24 : 16), particle ? 24 : 16);
  if (particle) g.setAttribute('pA', new InterleavedBufferAttribute(buffer, 4, 0));
  else g.setAttribute('iLayer', new InterleavedBufferAttribute(buffer, 4, 0));
  const m = new InstancedMesh(g, material, 0);
  m.name = particle ? 'p' : 'i';
  return m;
}

describe('M12 (fase 5): gêmeos do aquecimento', () => {
  it('um gêmeo válido por geometria e material, na frente da câmera; o dispose não mexe na malha viva', () => {
    const material = new ShaderMaterial();
    const other = new ShaderMaterial();
    const a = liveMesh(false, material);
    // Mesma geometria e material: um gêmeo só; outro material: outro gêmeo.
    const b = new InstancedMesh(a.geometry, material, 0);
    const c = new InstancedMesh(a.geometry, other, 0);
    const p = liveMesh(true, material);
    const camera = new PerspectiveCamera(90, 1, 0.05, 100);
    camera.position.set(10, 2, 5);
    camera.updateMatrixWorld();
    const parent = new Group();
    const twins = createWarmTwins([a, b, c, p], camera, parent, 7);
    expect(twins.count).toBe(3);
    expect(parent.children.length).toBe(3);
    const first = parent.children[0] as InstancedMesh;
    expect(first.geometry.getAttribute('position')).toBe(a.geometry.getAttribute('position'));
    expect(first.count).toBe(1);
    // O centro da esfera da geometria (1, 2, 0; raio √5) fica a 3 m na frente da câmera (−z), com raio 1.
    const m = new Matrix4();
    first.getMatrixAt(0, m);
    const center = new Vector3(1, 2, 0).applyMatrix4(m);
    expect(center.x).toBeCloseTo(10, 4);
    expect(center.y).toBeCloseTo(2, 4);
    expect(center.z).toBeCloseTo(2, 4);
    // A partícula nasce antes do relógio e vive.
    const pt = parent.children[2] as InstancedMesh;
    const pe = pt.geometry.getAttribute('pE') as InterleavedBufferAttribute;
    expect(pe.getX(0)).toBeLessThan(7);
    expect(pe.getY(0)).toBeGreaterThan(10);
    twins.dispose();
    expect(parent.children.length).toBe(0);
    expect(a.geometry.getAttribute('position')).toBeDefined();
    expect(a.geometry.index).not.toBeNull();
  });
});
