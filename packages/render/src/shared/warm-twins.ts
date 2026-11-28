// M12 (fase 5, item 7): o aquecimento que desenha DE VERDADE. Até aqui o frame fora da tela desenhava as malhas vivas
// com 1 instância de dados zerados: um ponto degenerado, sem nenhum fragmento (o driver podia adiar a montagem do
// estado de pixel para o 1º quadro da partida). Aqui cada malha ganha um GÊMEO de 1 instância VÁLIDA: o mesmo
// material e os mesmos atributos de vértice (o programa e o estado são os mesmos, regra 8), com a instância própria
// posta na frente da câmera do aquecimento, para gerar fragmento no pixel do canto. Os gêmeos saem logo depois, sem
// apagar os buffers divididos com a malha viva.
import {
  BufferGeometry,
  type Group,
  InstancedInterleavedBuffer,
  InstancedMesh,
  InterleavedBufferAttribute,
  Matrix4,
  Vector3,
  type BufferAttribute,
  type Camera,
  type Material,
} from 'three';
import { NO_SLOT } from '../actors/layout.ts';

/** Floats por instância do programa 4 (`INSTANCE_FLOATS`) e do programa 5 (`PARTICLE_FLOATS`). */
const INSTANCE_FLOATS = 16;
const PARTICLE_FLOATS = 24;
/** Distância (m) do 1º gêmeo à câmera e o passo de cada seguinte (mais perto: passa no teste de profundidade). */
const NEAR_M = 3;
const STEP_M = 0.004;
/** Ordem de desenho dos gêmeos (depois de tudo, na ordem em que entram). */
const RENDER_ORDER = 1e6;

/** O que o gêmeo copia da malha viva: atributos de vértice divididos (nunca apagados no fim). */
const SHARED_NAMES = ['position', 'normal', 'uv', 'aVert'] as const;

export interface WarmTwins {
  /** Tira os gêmeos da cena e solta só o que é deles (a instância e o VAO). */
  dispose(): void;
  readonly count: number;
}

/**
 * Gêmeos de 1 instância válida das `meshes` (programa 4 com `iLayer`; programa 5 com `pA`), na frente de `camera`,
 * dentro de `parent`. `fxTime` = o relógio do programa 5 (a partícula nasce um pouco antes e vive 100 s). Malhas com
 * a mesma geometria de vértice e o mesmo material viram um gêmeo só.
 */
export function createWarmTwins(
  meshes: readonly InstancedMesh[],
  camera: Camera,
  parent: Group,
  fxTime: number,
): WarmTwins {
  camera.updateMatrixWorld();
  const e = camera.matrixWorld.elements;
  const cam = new Vector3(e[12], e[13], e[14]);
  const fwd = new Vector3(-e[8]!, -e[9]!, -e[10]!).normalize();
  const twins: InstancedMesh[] = [];
  const seen = new Set<string>();
  let k = 0;
  for (const mesh of meshes) {
    const g = mesh.geometry;
    const position = g.getAttribute('position') as BufferAttribute | undefined;
    if (!position || position.count === 0) continue;
    const material = mesh.material as Material;
    const key = `${position.id}:${material.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const particle = g.getAttribute('pA') !== undefined;
    const twinGeo = new BufferGeometry();
    for (const name of SHARED_NAMES) {
      const attr = g.getAttribute(name);
      if (attr) twinGeo.setAttribute(name, attr);
    }
    if (g.index) twinGeo.setIndex(g.index);
    const dist = (particle ? NEAR_M * 0.5 : NEAR_M) - STEP_M * k;
    const at = cam.clone().addScaledVector(fwd, dist);
    const twin = new InstancedMesh(twinGeo, material, 1);
    if (particle) {
      // Partícula redonda (billboard, encara a câmera em qualquer material), viva, branca, de 1 m.
      const data = new Float32Array(PARTICLE_FLOATS);
      data.set([at.x, at.y, at.z, 1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 1, 1, fxTime - 0.01, 100, 0, 1, 1, 1, 0, 0]);
      const buffer = new InstancedInterleavedBuffer(data, PARTICLE_FLOATS);
      ['pA', 'pB', 'pC', 'pD', 'pE', 'pF'].forEach((n, i) =>
        twinGeo.setAttribute(n, new InterleavedBufferAttribute(buffer, 4, i * 4)),
      );
    } else {
      // Programa 4: o mesmo dado vale para caixa e modelo (caixa: centro 0, giro nenhum, medida 1 = o cubo unitário;
      // modelo: luz e cor quaisquer). A matriz põe a esfera da geometria (raio 1) a `dist` da câmera.
      const data = new Float32Array(INSTANCE_FLOATS);
      data.set([0, 0, 0, NO_SLOT, 0, 0, 0, 0, 1, 0, 1, 0, 1, 1, 1, 0]);
      const buffer = new InstancedInterleavedBuffer(data, INSTANCE_FLOATS);
      twinGeo.setAttribute('iLayer', new InterleavedBufferAttribute(buffer, 4, 0));
      twinGeo.setAttribute('iLight', new InterleavedBufferAttribute(buffer, 4, 4));
      twinGeo.setAttribute('iColor', new InterleavedBufferAttribute(buffer, 4, 8));
      twinGeo.setAttribute('iPart', new InterleavedBufferAttribute(buffer, 4, 12));
      twinGeo.computeBoundingSphere();
      const sphere = twinGeo.boundingSphere;
      const r = sphere && sphere.radius > 1e-4 ? sphere.radius : 1;
      const s = 1 / r;
      const c = sphere ? sphere.center : new Vector3();
      twin.setMatrixAt(0, new Matrix4().makeScale(s, s, s).setPosition(at.x - c.x * s, at.y - c.y * s, at.z - c.z * s));
    }
    twin.count = 1;
    twin.frustumCulled = false;
    twin.matrixAutoUpdate = false;
    twin.renderOrder = RENDER_ORDER + k;
    twin.name = `aquecimento-${mesh.name}`;
    parent.add(twin);
    twins.push(twin);
    k++;
  }
  return {
    count: twins.length,
    dispose() {
      for (const twin of twins) {
        twin.removeFromParent();
        const g = twin.geometry;
        // Os atributos divididos saem da geometria ANTES do dispose (o three apagaria o buffer da malha viva).
        for (const name of SHARED_NAMES) g.deleteAttribute(name);
        g.setIndex(null);
        g.dispose();
        twin.dispose();
      }
      twins.length = 0;
    },
  };
}
