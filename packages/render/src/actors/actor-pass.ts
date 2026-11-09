// Passe dos atores (programa 4, instanciado): bonecos do FutBobo (#56: UMA `InstancedMesh` "bobos" com uma instância
// por caixa, `figure-frame.ts` + `figure-instances.ts`), armas na mão (1 malha por modelo, matriz pela `rig.weapon`),
// props fora da grade por grupo de 32 m, sombra-blob (programa 5) e viewmodel (arma + braços, depois do mundo, com FOV
// próprio). Sem contorno de time (decisão #50). Matrizes e dados 1x por frame no `update`; por vista só uniforms,
// `visible` e o `count` das props.
//
// Só desenha corpo com gabaritos (`setFigures`) e `ActorBuffer.figure` válido: o bobo de 6 partes + rosto (7
// `InstancedMesh`, `rig.ts`, `bobo-geometry.ts`) saiu no passo 5 do porte.
import {
  FIGURE_PX_M,
  type FigureGameTable,
  type FigureTemplateSet,
  type ModelDocument,
  type PropDoseView,
} from '@boboforces/format';
import { sampleLightGrid } from '@boboforces/world';
import { Group, PerspectiveCamera, Scene, Sphere, type InstancedMesh } from 'three';
import { INITIAL_ACTOR_CAPACITY } from '../limits.ts';
import type { ActorPass, FrameContext, PassContext, ViewContext } from '../shared/passes.ts';
import { ACTOR_POSE, NO_FIGURE, NO_MODEL, type ActorBuffer, type ProjectileBuffer, type RenderMap } from '../types.ts';
import { floorBelow } from '../fx/verlet.ts';
import { PARTICLE_FLOATS } from '../fx/particles.ts';
import { PARTICLE_KIND } from '../fx/shader.ts';
import { createFigureRig, type FigureLodStats } from './anim/index.ts';
import { buildFigureCubeGeometry } from './figure-cube.ts';
import { createFigureFrame } from './figure-frame.ts';
import { createFigureInstances, FIGURE_INSTANCES_MAX } from './figure-instances.ts';
import { INST, INSTANCE_FLOATS, NO_SLOT, writeInstanceDefaults } from './layout.ts';
import { linkFor } from './link.ts';
import {
  m4Copy,
  m4Identity,
  m4RotateX,
  m4RotateY,
  m4RotateZ,
  m4Scale,
  m4TransformPoint,
  m4Translate,
  MAT4,
} from './math.ts';
import { buildModelBinding, type LayerRef, type ModelBinding, type SocketM } from './model-geometry.ts';
import {
  buildPropGroups,
  doseIndex,
  limitGroups,
  PROP_DRAWS_PER_VIEW,
  PROP_DRAWS_PER_VIEW_SMALL,
  propSurfaceDistance,
  type PropGroupData,
} from './props.ts';
import {
  createInstancedMaterial,
  createInstancedUniforms,
  createInstanceSet,
  createParticleMaterial,
  createParticleMesh,
  createParticleUniforms,
  createQuadGeometry,
  createVertexBuffers,
  instancedGeometry,
  instancedMesh,
  uploadInstances,
  uploadRange,
  type InstanceSet,
  type ParticleMesh,
  type VertexBuffers,
} from './three-objects.ts';
import { buildViewmodelGeometry, VIEWMODEL_POSE } from './viewmodel.ts';

/** Vistas pequenas (3–4P): teto de 8 draw calls de props (tecnico.md §6.6). */
const SMALL_VIEW_COUNT = 3;
/** Sombra-blob do boneco do FutBobo (PLANO do porte §B14): 16 px de ombro a ombro = 0,875 m (× escala). */
const FIGURE_SHADOW_SIZE = 16 * FIGURE_PX_M;
const SHADOW_ALPHA = 0.42;
const SHADOW_MAX_HEIGHT = 3;
/** Atores que o rig dos bonecos acompanha por índice do `ActorBuffer` (o estado por entidade é dele). */
const FIGURE_RIG_CAPACITY = 256;

/**
 * O que o passe mede além do contrato (`ActorPass`), para a integração ligar no `RenderStats` (pedido do passo 3):
 * draws de corpo de bobo na última vista (`ViewStats.actorDraws`) e os níveis da animação (`figureL0..L2`).
 */
export interface ActorPassFigureStats {
  readonly lastViewActorDraws: number;
  readonly figureLod: FigureLodStats;
  /** Instâncias (caixas) da malha "bobos", bonecos nela e estouros da capacidade no último quadro. */
  readonly figureBoxes: number;
  readonly figureCount: number;
  readonly figureOverflow: number;
}

/** Sombras-blob dos atores (uma por ator desenhado) e a capacidade que também dimensiona as armas na mão. */
interface ShadowMeshes {
  readonly capacity: number;
  readonly data: Float32Array;
  readonly shadow: ParticleMesh;
}

interface WeaponMeshes {
  readonly set: InstanceSet;
  readonly mesh: InstancedMesh;
  readonly handR: SocketM | null;
  count: number;
}

interface ViewmodelMeshes {
  readonly set: InstanceSet;
  readonly mesh: InstancedMesh;
  readonly vertex: VertexBuffers;
  readonly handR: SocketM;
  readonly muzzle: SocketM | null;
}

interface PropMeshes {
  readonly group: PropGroupData;
  readonly set: InstanceSet;
  readonly mesh: InstancedMesh;
}

export function createActorPass(ctx: PassContext): ActorPass & ActorPassFigureStats {
  const link = linkFor(ctx.scene);
  const perView = createInstancedUniforms();
  const material = createInstancedMaterial(ctx, perView, 'instanciado-atores');
  const shadowUniforms = createParticleUniforms();
  const shadowMaterial = createParticleMaterial(ctx, shadowUniforms, 'decal');
  const root = new Group();
  root.name = 'render-atores';
  ctx.scene.add(root);
  const quad = createQuadGeometry();

  // Bonecos do FutBobo (#56): o cubo, a faixa por ator e UMA malha para todos.
  const figureRig = createFigureRig(FIGURE_RIG_CAPACITY);
  const figureInstances = createFigureInstances();
  const figureFrame = createFigureFrame(figureRig, figureInstances);
  const figureSet = createInstanceSet(FIGURE_INSTANCES_MAX, figureInstances.matrices, figureInstances.data);
  const figureMesh = instancedMesh(
    instancedGeometry(createVertexBuffers(buildFigureCubeGeometry()), figureSet.dataBuffer),
    material,
    figureSet.matrixAttribute,
    'bobos',
  );
  root.add(figureMesh);
  let frameIndex = 0;
  let lastViewActorDraws = 0;

  const vmScene = new Scene();
  vmScene.name = 'viewmodel';
  const vmCamera = new PerspectiveCamera(60, 16 / 9, 0.01, 10);
  vmCamera.rotation.order = 'YXZ';
  link.viewmodelCamera = vmCamera;
  const warmCamera = new PerspectiveCamera();

  let shadows = createShadows(INITIAL_ACTOR_CAPACITY);
  let actors: ActorBuffer | null = null;
  let projectiles: ProjectileBuffer | null = null;
  let boboCount = 0;
  const slotCounts = new Int32Array(4);

  let modelDocs: readonly ModelDocument[] | null = null;
  let bindings: (ModelBinding | null)[] = [];
  let modelVertex: (VertexBuffers | null)[] = [];
  let weapons: (WeaponMeshes | null)[] = [];
  let viewmodels: (ViewmodelMeshes | null)[] = [];
  let layersResolved = true;
  const warnedLayers = new Set<string>();

  let map: RenderMap | null = null;
  let props: PropMeshes[] = [];
  let propVisible = new Uint8Array(0);
  let propDistance = new Float32Array(0);
  let propOrder = new Int32Array(0);
  let appliedDose: PropDoseView | null = null;

  let viewsLastFrame = 1;
  let viewsThisFrame = 0;
  let lastViewActors = 0;
  let lastViewPropGroups = 0;
  let disposed = false;
  // Gabaritos e tabela de jogo da partida (#56): o quadro das figuras é quem usa; aqui só para soltar no `dispose`.
  let figureTemplates: FigureTemplateSet | null = null;
  let figureTable: FigureGameTable | null = null;
  let figureNearM = 0;
  let figureHalfRate = false;

  const vmMatrix = new Float32Array(MAT4);
  const sphere = new Sphere();

  function createShadows(capacity: number): ShadowMeshes {
    const data = new Float32Array(Math.max(1, capacity) * PARTICLE_FLOATS);
    const shadow = createParticleMesh(quad, data, shadowMaterial, 'sombra-blob');
    root.add(shadow.mesh);
    return { capacity, data, shadow };
  }

  function disposeShadows(b: ShadowMeshes): void {
    b.shadow.mesh.removeFromParent();
    b.shadow.mesh.geometry.dispose();
  }

  function lookupLayer(name: string): LayerRef | null {
    const assets = ctx.textures.assets;
    if (!assets) return null;
    const index = assets.models.layers.get(name);
    if (index === undefined) return null;
    const info = assets.models.info[index];
    return { index, cutout: info?.cutout ?? false, emissive: info?.kind === 'emissive' };
  }

  function disposeModels(): void {
    for (const w of weapons) {
      if (!w) continue;
      w.mesh.removeFromParent();
      w.mesh.geometry.dispose();
    }
    for (const vm of viewmodels) {
      if (!vm) continue;
      vm.mesh.removeFromParent();
      vm.mesh.geometry.dispose();
    }
    weapons = [];
    viewmodels = [];
    bindings = [];
    modelVertex = [];
    link.models = bindings;
  }

  function buildWeapons(): void {
    for (const w of weapons) {
      if (!w) continue;
      w.mesh.removeFromParent();
      w.mesh.geometry.dispose();
    }
    weapons = bindings.map((binding, i) => {
      const vertex = modelVertex[i];
      // Armas, projéteis (modelo `weapon`) e pickups (M2, fase 2b: a caixinha) dividem o mesmo desenho instanciado.
      if (!binding || !vertex || (binding.kind !== 'weapon' && binding.kind !== 'pickup')) return null;
      if (vertex.vertexCount === 0) return null;
      const set = createInstanceSet(shadows.capacity);
      const mesh = instancedMesh(
        instancedGeometry(vertex, set.dataBuffer),
        material,
        set.matrixAttribute,
        `arma-${binding.id}`,
      );
      root.add(mesh);
      return { set, mesh, handR: binding.sockets.get('hand_r') ?? null, count: 0 };
    });
  }

  function buildModels(): void {
    disposeModels();
    if (!modelDocs) return;
    layersResolved = ctx.textures.assets !== null;
    bindings = modelDocs.map((doc) => {
      try {
        const binding = buildModelBinding(doc, lookupLayer);
        for (const name of binding.missingLayers) {
          if (layersResolved && !warnedLayers.has(name)) {
            warnedLayers.add(name);
            console.warn(`render-atores: camada "${name}" do modelo ${doc.id} não existe em modelos64`);
          }
        }
        return binding;
      } catch (error) {
        console.warn(`render-atores: modelo ${doc.id} ignorado (${String(error)})`);
        return null;
      }
    });
    modelVertex = bindings.map((b) => (b ? createVertexBuffers(b.geometry) : null));
    link.models = bindings;
    buildWeapons();
    viewmodels = bindings.map((binding) => {
      const handR = binding?.sockets.get('hand_r');
      if (!binding || binding.kind !== 'weapon' || !handR) return null;
      const vertex = createVertexBuffers(buildViewmodelGeometry(binding));
      const set = createInstanceSet(1);
      m4Identity(set.matrices, 0);
      writeInstanceDefaults(set.data, 0);
      uploadInstances(set, 1, 0, 0);
      const mesh = instancedMesh(
        instancedGeometry(vertex, set.dataBuffer),
        material,
        set.matrixAttribute,
        `viewmodel-${binding.id}`,
      );
      mesh.count = 1;
      vmScene.add(mesh);
      return { set, mesh, vertex, handR, muzzle: binding.sockets.get('muzzle') ?? null };
    });
  }

  function disposeProps(): void {
    for (const p of props) {
      p.mesh.removeFromParent();
      p.mesh.geometry.dispose();
    }
    props = [];
  }

  function rebuildProps(): void {
    disposeProps();
    appliedDose = null;
    if (!map || bindings.length === 0) return;
    const grid = map.lightGrid;
    const groups = buildPropGroups(map.props, bindings, (x, y, z, out, o) => sampleLightGrid(grid, x, y, z, out, o));
    props = groups.map((group, i) => {
      const set = createInstanceSet(group.count, group.matrices, group.data, false);
      uploadInstances(set, group.count, 0, group.count - 1);
      const vertex = modelVertex[group.model]!;
      const mesh = instancedMesh(
        instancedGeometry(vertex, set.dataBuffer),
        material,
        set.matrixAttribute,
        `props-${i}`,
      );
      root.add(mesh);
      return { group, set, mesh };
    });
    propVisible = new Uint8Array(props.length);
    propDistance = new Float32Array(props.length);
    propOrder = new Int32Array(props.length);
  }

  function applyDose(view: PropDoseView): void {
    const k = doseIndex(view);
    for (const p of props) p.mesh.count = p.group.countByDose[k];
    appliedDose = view;
  }

  function writeShadow(n: number, a: ActorBuffer, i: number, frame: FrameContext, size: number): void {
    const d = shadows.data;
    const o = n * PARTICLE_FLOATS;
    const x = a.position[i * 3]!;
    const y = a.position[i * 3 + 1]!;
    const z = a.position[i * 3 + 2]!;
    let ground = y;
    if (frame.world && (a.pose[i]! & ACTOR_POSE.airborne) !== 0)
      ground = floorBelow(frame.world, x, y + 0.05, z, SHADOW_MAX_HEIGHT);
    const height = Number.isNaN(ground) ? SHADOW_MAX_HEIGHT : Math.max(0, y - ground);
    const fade = Math.max(0, 1 - height / SHADOW_MAX_HEIGHT);
    const scale = a.scale[i]! > 0 ? a.scale[i]! : 1;
    d[o] = x;
    d[o + 1] = (Number.isNaN(ground) ? y : ground) + 0.01;
    d[o + 2] = z;
    d[o + 3] = size * scale * (1 - 0.3 * (1 - fade));
    d.fill(0, o + 4, o + 15);
    d[o + 9] = 1;
    d[o + 15] = SHADOW_ALPHA * fade;
    d[o + 16] = 0;
    d[o + 17] = 1e9;
    d[o + 18] = PARTICLE_KIND.blob;
    d[o + 19] = 1;
    d[o + 20] = 1;
    d[o + 21] = 1;
    d[o + 22] = 0;
    d[o + 23] = 0;
  }

  /** Dados da arma na mão: os do dono (skin, luz, clarão, slot que a esconde na 1ª pessoa). */
  function writeActorData(data: Float32Array, d: number, a: ActorBuffer, i: number): void {
    writeInstanceDefaults(data, d);
    data[d + INST.layer] = a.skin[i]!;
    data[d + INST.slot] = a.localSlot[i]!;
    data[d + INST.sky] = a.light[i * 3]!;
    data[d + INST.sun] = a.light[i * 3 + 1]!;
    data[d + INST.emissive] = a.light[i * 3 + 2]!;
    data[d + INST.flash] = a.damageFlash[i]!;
    data[d + INST.team] = a.team[i]!;
  }

  function setVisibleAll(visible: boolean | null, saved: boolean[]): void {
    const meshes: InstancedMesh[] = [
      figureMesh,
      shadows.shadow.mesh,
      ...props.map((p) => p.mesh),
      ...weapons.flatMap((w) => (w ? [w.mesh] : [])),
      ...viewmodels.flatMap((v) => (v ? [v.mesh] : [])),
    ];
    meshes.forEach((mesh, k) => {
      if (visible === null) mesh.visible = saved[k] ?? false;
      else {
        saved[k] = mesh.visible;
        mesh.visible = visible;
      }
    });
  }

  const pass: ActorPass & ActorPassFigureStats = {
    programs: 1,

    get lastViewActors() {
      return lastViewActors;
    },
    get lastViewPropGroups() {
      return lastViewPropGroups;
    },
    get lastViewActorDraws() {
      return lastViewActorDraws;
    },
    get figureLod() {
      return figureRig.stats;
    },
    get figureBoxes() {
      return figureInstances.count;
    },
    get figureCount() {
      return figureFrame.stats.figures;
    },
    get figureOverflow() {
      return figureInstances.overflow;
    },

    setModels(models) {
      if (disposed) return;
      modelDocs = models;
      buildModels();
      rebuildProps();
    },

    setMap(next) {
      if (disposed) return;
      map = next;
      rebuildProps();
    },

    setActors(buffer) {
      actors = buffer;
    },

    setProjectiles(buffer) {
      projectiles = buffer;
    },

    setFigures(templates, table) {
      if (disposed) return;
      figureTemplates = templates;
      figureTable = table;
      figureFrame.setFigures(templates, table);
      link.figure = figureInstances;
      link.figureTemplates = templates;
    },

    setFigureLod(nearM, halfRate) {
      if (disposed) return;
      figureNearM = nearM;
      figureHalfRate = halfRate;
      figureRig.setLod(figureNearM, figureHalfRate);
    },

    update(frame) {
      if (disposed) return;
      viewsLastFrame = Math.max(1, viewsThisFrame);
      viewsThisFrame = 0;
      if (!layersResolved && ctx.textures.assets) {
        buildModels();
        rebuildProps();
      }
      if (frame.debug.propDose !== appliedDose) applyDose(frame.debug.propDose);

      const a = actors;
      // Laço por índice (sem iterador): no interpretador do Switch o for-of aloca.
      for (let k = 0; k < weapons.length; k++) {
        const w = weapons[k];
        if (w) w.count = 0;
      }
      slotCounts.fill(0);
      let shadowCount = 0;
      const figureOn = figureFrame.active;
      if (a) {
        if (a.count > shadows.capacity) {
          disposeShadows(shadows);
          shadows = createShadows(Math.max(a.count, a.capacity));
          buildWeapons();
        }
        if (figureOn) figureFrame.update(frame, a, frameIndex++);
        for (let i = 0; figureOn && i < a.count; i++) {
          // Sem gabarito o ator não tem corpo (o `game` sempre preenche `figure`).
          if (a.figure[i] === NO_FIGURE) continue;
          // As caixas já estão nas faixas; aqui só a arma, a sombra e as contas da vista.
          const r = figureInstances.actorRecord[i]!;
          if (r < 0) continue;
          const slot = a.localSlot[i]!;
          if (slot < 4) slotCounts[slot]!++;
          const model = a.weapon[i]!;
          const weapon = model !== NO_MODEL ? (weapons[model] ?? null) : null;
          if (weapon && figureInstances.recArmed[r] === 1 && weapon.count < weapon.set.capacity) {
            const wm = weapon.count * MAT4;
            m4Copy(weapon.set.matrices, wm, figureInstances.recWeapon, r * MAT4);
            // A matriz do rig é a do soquete `hand_r` (m): a malha da arma começa na origem do modelo.
            if (weapon.handR) m4Translate(weapon.set.matrices, -weapon.handR.x, -weapon.handR.y, -weapon.handR.z, wm);
            writeActorData(weapon.set.data, weapon.count * INSTANCE_FLOATS, a, i);
            weapon.count++;
          }
          writeShadow(shadowCount++, a, i, frame, FIGURE_SHADOW_SIZE);
        }
      }
      // M2: projéteis em voo nos conjuntos instanciados das armas (o modelo do projétil é `kind: 'weapon'`).
      const pj = projectiles;
      for (let i = 0; pj !== null && i < pj.count; i++) {
        const model = pj.model[i]!;
        const weapon = model !== NO_MODEL ? (weapons[model] ?? null) : null;
        if (!weapon || weapon.count >= weapon.set.capacity) continue;
        const wm = weapon.count * MAT4;
        const mat = weapon.set.matrices;
        m4Identity(mat, wm);
        m4Translate(mat, pj.position[i * 3]!, pj.position[i * 3 + 1]!, pj.position[i * 3 + 2]!, wm);
        m4RotateY(mat, pj.yaw[i]!, wm);
        m4RotateX(mat, pj.pitch[i]!, wm);
        m4RotateZ(mat, pj.roll[i]!, wm);
        const d = weapon.count * INSTANCE_FLOATS;
        writeInstanceDefaults(weapon.set.data, d);
        weapon.set.data[d + INST.sky] = pj.light[i * 3]!;
        weapon.set.data[d + INST.sun] = pj.light[i * 3 + 1]!;
        weapon.set.data[d + INST.emissive] = pj.light[i * 3 + 2]!;
        weapon.count++;
      }
      boboCount = figureOn ? figureFrame.stats.figures : 0;

      // Bonecos: as matrizes num upload só (sem o prefixo dos manequins, salvo no quadro em que ele muda) e os dados só
      // no quadro de evento.
      const fc = figureOn ? figureInstances.count : 0;
      figureMesh.count = fc;
      figureMesh.visible = fc > 0;
      if (fc > 0) {
        const first = figureInstances.prefixDirty ? 0 : figureInstances.prefixEnd;
        uploadRange(figureSet.matrixAttribute, figureSet.matrixRange, MAT4, first, fc - 1);
        uploadRange(
          figureSet.dataBuffer,
          figureSet.dataRange,
          INSTANCE_FLOATS,
          figureInstances.dataFirst,
          figureInstances.dataLast,
        );
      }

      const shadow = shadows.shadow;
      shadow.mesh.count = shadowCount;
      shadow.mesh.visible = shadowCount > 0;
      uploadRange(shadow.buffer, shadow.range, PARTICLE_FLOATS, 0, shadowCount - 1);
      for (let k = 0; k < weapons.length; k++) {
        const w = weapons[k];
        if (!w) continue;
        w.mesh.count = w.count;
        w.mesh.visible = w.count > 0;
        uploadInstances(w.set, w.count, 0, w.count - 1);
      }
      link.actors = a;
    },

    beforeView(v: ViewContext) {
      if (disposed) return;
      viewsThisFrame = Math.max(viewsThisFrame, v.index + 1);
      const small = viewsLastFrame >= SMALL_VIEW_COUNT;
      const view = v.view;
      const hide = !view.thirdPerson && view.localSlot >= 0 ? view.localSlot : -1;
      perView.uHideSlot.value = hide;
      lastViewActors = boboCount - (hide >= 0 && hide < 4 ? slotCounts[hide]! : 0);
      // Draws de corpo nesta vista: só a malha "bobos" (#56: de 7 draws para 1).
      lastViewActorDraws = figureMesh.count > 0 ? 1 : 0;
      if (v.index < 4) link.viewmodelMuzzle[v.index * 4 + 3] = 0;

      // Props: frustum da vista + distância (a fog termina no plano distante) + teto de draw calls. O teto corta pela
      // distância à SUPERFÍCIE da esfera do grupo, não ao centro: com a dose do jogo (#52) toda prop colide, e um grupo
      // grande com o centro longe pode ter prop a poucos metros, no quadro.
      const cam = v.camera.position;
      const far = v.camera.far;
      for (let g = 0; g < props.length; g++) {
        const p = props[g]!;
        const grp = p.group;
        const surface = propSurfaceDistance(grp, cam.x, cam.y, cam.z);
        propDistance[g] = surface;
        sphere.center.set(grp.sphereX, grp.sphereY, grp.sphereZ);
        sphere.radius = grp.radius;
        propVisible[g] = p.mesh.count > 0 && surface < far && v.frustum.intersectsSphere(sphere) ? 1 : 0;
      }
      const cap = small ? PROP_DRAWS_PER_VIEW_SMALL : PROP_DRAWS_PER_VIEW;
      lastViewPropGroups = limitGroups(propVisible, propDistance, propOrder, props.length, cap);
      for (let g = 0; g < props.length; g++) props[g]!.mesh.visible = propVisible[g] === 1;
    },

    afterView(v: ViewContext) {
      if (disposed) return;
      const view = v.view;
      const vm = view.viewmodel;
      if (v.debug.hideViewmodel || !vm.visible || view.thirdPerson || vm.model === NO_MODEL) return;
      const set = viewmodels[vm.model];
      if (!set) return;

      // Câmera do viewmodel: mesma pose da vista, FOV próprio, perto (a arma nunca atravessa parede).
      vmCamera.position.copy(v.camera.position);
      vmCamera.quaternion.copy(v.camera.quaternion);
      vmCamera.fov = (vm.fovY * 180) / Math.PI;
      vmCamera.aspect = Math.max(1, v.rect.width) / Math.max(1, v.rect.height);
      vmCamera.near = 0.01;
      vmCamera.far = 10;
      vmCamera.updateProjectionMatrix();
      vmCamera.updateMatrixWorld();

      // Mundo = câmera · T(mão + deslocamentos) · giros · escala · T(−hand_r).
      const e = vmCamera.matrixWorld.elements;
      for (let k = 0; k < 16; k++) vmMatrix[k] = e[k]!;
      const hand = VIEWMODEL_POSE.hand;
      const s = vm.scale > 0 ? vm.scale : 1;
      // A escala encolhe a arma em torno da mão (o canto da tela fica onde está).
      m4Translate(vmMatrix, hand[0] + vm.offsetX, hand[1] + vm.offsetY, hand[2] + vm.offsetZ);
      m4RotateY(vmMatrix, vm.yaw);
      m4RotateX(vmMatrix, vm.pitch);
      m4RotateZ(vmMatrix, vm.roll);
      m4Scale(vmMatrix, s, s, s);
      m4Translate(vmMatrix, -set.handR.x, -set.handR.y, -set.handR.z);
      set.mesh.matrix.fromArray(vmMatrix);
      set.mesh.matrixWorldNeedsUpdate = true;
      if (set.muzzle && v.index < 4) {
        m4TransformPoint(vmMatrix, 0, set.muzzle.x, set.muzzle.y, set.muzzle.z, link.viewmodelMuzzle, v.index * 4);
        link.viewmodelMuzzle[v.index * 4 + 3] = 1;
      }

      const d = set.set.data;
      writeInstanceDefaults(d, 0);
      d[INST.layer] = vm.skin;
      d[INST.sky] = vm.lightSky;
      d[INST.sun] = vm.lightSun;
      d[INST.emissive] = vm.lightEmissive;
      d[INST.slot] = NO_SLOT;
      d[INST.team] = view.team;
      uploadRange(set.set.dataBuffer, set.set.dataRange, INSTANCE_FLOATS, 0, 0);
      for (let k = 0; k < viewmodels.length; k++) {
        const other = viewmodels[k];
        if (other) other.mesh.visible = other === set;
      }

      const three = ctx.three;
      const autoClear = three.autoClear;
      three.autoClear = false;
      three.clearDepth();
      three.render(vmScene, vmCamera);
      three.autoClear = autoClear;
      set.mesh.visible = false;
    },

    warmup() {
      if (disposed) return;
      const saved: boolean[] = [];
      setVisibleAll(true, saved);
      ctx.three.compile(ctx.scene, warmCamera);
      ctx.three.compile(vmScene, warmCamera);
      setVisibleAll(null, saved);
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      // Solta a tabela de jogo e os gabaritos (são da partida; regra 21).
      figureTemplates = null;
      figureTable = null;
      disposeProps();
      disposeModels();
      disposeShadows(shadows);
      figureMesh.removeFromParent();
      figureMesh.geometry.dispose();
      // O quadro também guarda os gabaritos e as faixas do cabelo: solta antes do rig.
      figureFrame.setFigures(null, null);
      figureRig.dispose();
      figureInstances.clear();
      link.figure = null;
      link.figureTemplates = null;
      root.removeFromParent();
      material.dispose();
      shadowMaterial.dispose();
      vmScene.clear();
      if (link.viewmodelCamera === vmCamera) link.viewmodelCamera = null;
      link.actors = null;
    },
  };
  return pass;
}
