import {
  createFigureGameTable,
  createFigureTemplateSet,
  FIGURE_BONE,
  FIGURE_GRIP,
  FIGURE_LOOK_DEFAULT,
  FIGURE_MAX_BOXES,
  FIGURE_MODE,
  FIGURE_PRESETS,
  FIGURE_STANCE,
  figurePosture,
  MODEL_FORMAT,
  type ModelDocument,
} from '@boboforces/format';
import { createBlockRegistry, createWorldGrid, type LightGrid } from '@boboforces/world';
import {
  Frustum,
  InterleavedBufferAttribute,
  Matrix4,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector4,
  type InstancedMesh,
  type Object3D,
  type WebGLRenderer,
} from 'three';
import { describe, expect, it } from 'vitest';
import { createFxPass } from '../fx/index.ts';
import {
  createFxQueue,
  pushActorImpact,
  pushBlockImpact,
  pushDeath,
  pushDebris,
  pushExplosion,
  pushMuzzleFlash,
  pushTracer,
  pushTrail,
} from '../fx-queue.ts';
import { COMMON_UNIFORM_NAMES } from '../shared/glsl-common.ts';
import {
  createFrameViews,
  type FrameContext,
  type PassContext,
  type SharedTextures,
  type SharedUniforms,
  type ViewContext,
} from '../shared/passes.ts';
import {
  ACTOR_POSE,
  createActorBuffer,
  createProjectileBuffer,
  createRenderDebug,
  createViewDesc,
  NO_MODEL,
  type RenderMap,
  type ViewDesc,
} from '../types.ts';
import { createActorPass } from './index.ts';
import { linkFor } from './link.ts';

function fakeContext(): { ctx: PassContext; calls: string[] } {
  const calls: string[] = [];
  const three = {
    autoClear: false,
    clearDepth: () => calls.push('clearDepth'),
    render: (scene: Scene) => calls.push(`render:${scene.name}`),
    compile: (scene: Scene) => calls.push(`compile:${scene.name}`),
  } as unknown as WebGLRenderer;
  const uniforms = Object.fromEntries(COMMON_UNIFORM_NAMES.map((n) => [n, { value: 0 }])) as unknown as SharedUniforms;
  const textures: SharedTextures = {
    blocks: { value: null },
    blocksAtlas: { value: new Vector4() },
    blocksAtlasSize: { value: new Vector2() },
    models: { value: null },
    modelsAtlas: { value: new Vector4() },
    modelsAtlasSize: { value: new Vector2() },
    assets: null,
  };
  const scene = new Scene();
  scene.name = 'principal';
  return {
    ctx: { three, textureMode: 'array', vertexAttributes: 'int', defines: {}, scene, uniforms, textures },
    calls,
  };
}

const rifle: ModelDocument = {
  format: MODEL_FORMAT,
  id: 'rifle',
  kind: 'weapon',
  flags: 0,
  parts: [
    {
      name: 'body',
      parent: -1,
      pivot: [0, 0, 0],
      boxes: [{ origin: [-2, -2, -16], size: [4, 4, 20], uv: [0, 0], layer: 'metal', inflate: 0, mirror: false }],
      meshes: [],
    },
  ],
  sockets: [
    { name: 'hand_r', part: 0, position: [0, -2, 0], direction: [0, 0, -1] },
    { name: 'muzzle', part: 0, position: [0, 0, -16], direction: [0, 0, -1] },
    { name: 'sight', part: 0, position: [0, 2, -4], direction: [0, 0, -1] },
  ],
  colliders: [],
  light: null,
  debrisColor: 0x556b2f,
  blocksNav: false,
};
const barrel: ModelDocument = { ...rifle, id: 'barrel', kind: 'prop', sockets: [] };
const ammoBox: ModelDocument = { ...rifle, id: 'ammo-box', kind: 'pickup', sockets: [] };

function frame(timeS: number, debug = createRenderDebug(), dt = 1 / 60): FrameContext {
  return { dt, timeS, debug, world: null, views: createFrameViews() };
}

function viewContext(view: ViewDesc, index = 0): ViewContext {
  const camera = new PerspectiveCamera(70, 16 / 9, 0.05, 90);
  camera.position.set(0, 1.6, 5);
  camera.updateMatrixWorld();
  const frustum = new Frustum().setFromProjectionMatrix(
    new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
  );
  return { index, view, camera, frustum, rect: { x: 0, y: 0, width: 640, height: 360 }, debug: createRenderDebug() };
}

const mesh = (scene: Scene, name: string) => scene.getObjectByName(name) as InstancedMesh;

const templates = createFigureTemplateSet([FIGURE_LOOK_DEFAULT, FIGURE_PRESETS.mechanic]);
const table = createFigureGameTable();

function threeActors() {
  const a = createActorBuffer(8);
  a.count = 3;
  for (let i = 0; i < 3; i++) {
    a.entity[i] = 0x00010000 + i + 1;
    a.position.set([i * 2, 0, 0], i * 3);
    a.weapon[i] = NO_MODEL;
    a.localSlot[i] = 255;
    a.team[i] = i === 2 ? 1 : 0;
    a.skin[i] = 90 + i;
  }
  a.localSlot[0] = 0;
  a.weapon[1] = 0;
  a.pose[2] = ACTOR_POSE.dead;
  return a;
}

/** Os 3 atores com gabarito (0, 1, 0) e o do meio armado de fuzil. */
function figureActors() {
  const a = threeActors();
  for (let i = 0; i < 3; i++) a.figure[i] = i % 2;
  a.posture[1] = figurePosture(FIGURE_STANCE.stand, FIGURE_GRIP.rifle, FIGURE_MODE.base, false);
  return a;
}

describe('passe dos atores (three sem GPU)', () => {
  it('sem gabaritos não há corpo; com eles, arma, sombra, o próprio corpo escondido e a conta por vista', () => {
    const { ctx, calls } = fakeContext();
    const pass = createActorPass(ctx);
    pass.setModels([rifle]);
    pass.setActors(figureActors());
    const debug = createRenderDebug();
    pass.update(frame(0, debug));
    // O bobo de 7 partes saiu (#56): sem `setFigures` nenhum corpo, arma nem sombra.
    const bobos = mesh(ctx.scene, 'bobos');
    expect(bobos.count).toBe(0);
    expect(mesh(ctx.scene, 'arma-rifle').count).toBe(0);
    expect(mesh(ctx.scene, 'sombra-blob').count).toBe(0);
    for (const gone of ['bobo-cabeca', 'bobo-rosto', 'bobo-tronco'])
      expect(ctx.scene.getObjectByName(gone)).toBeUndefined();
    pass.setFigures(templates, table);
    pass.update(frame(1 / 60, debug));
    expect(bobos.count).toBeGreaterThan(0); // o morto fica com o desmonte
    expect(mesh(ctx.scene, 'arma-rifle').count).toBe(1);
    expect(mesh(ctx.scene, 'sombra-blob').count).toBe(2);
    // Sem contorno de time (#50): nenhum casco na cena, e o material só tem os uniforms do programa 4 de hoje.
    let hulls = 0;
    ctx.scene.traverse((o) => {
      if (o.name.startsWith('contorno-')) hulls++;
    });
    expect(hulls).toBe(0);
    const uniforms = (bobos.material as ShaderMaterial).uniforms;
    for (const gone of ['uOutlinePx', 'uViewportPx', 'uTeamColors', 'uEnemyColor', 'uViewTeam', 'uDensityLayer']) {
      expect(uniforms[gone], gone).toBeUndefined();
    }

    const view = createViewDesc();
    view.localSlot = 0;
    view.team = 0;
    pass.beforeView(viewContext(view));
    const material = bobos.material as ShaderMaterial;
    expect(material.uniforms['uHideSlot']!.value).toBe(0);
    expect(pass.lastViewActors).toBe(1);
    view.thirdPerson = true;
    pass.beforeView(viewContext(view));
    expect(material.uniforms['uHideSlot']!.value).toBe(-1);
    expect(pass.lastViewActors).toBe(2);

    // Viewmodel: limpa a profundidade e desenha a cena própria; guarda a boca do cano para o clarão.
    view.thirdPerson = false;
    view.viewmodel.visible = true;
    view.viewmodel.model = 0;
    pass.afterView(viewContext(view));
    expect(calls).toContain('clearDepth');
    expect(calls).toContain('render:viewmodel');
    expect(linkFor(ctx.scene).viewmodelMuzzle[3]).toBe(1);
    pass.warmup();
    expect(calls).toContain('compile:principal');
    pass.dispose();
    expect(ctx.scene.getObjectByName('render-atores')).toBeUndefined();
  });

  it('props por grupo: dose da depuração, luz da grade e culling por vista', () => {
    const { ctx } = fakeContext();
    const pass = createActorPass(ctx);
    pass.setModels([rifle, barrel]);
    const lightGrid: LightGrid = { sizeX: 1, sizeY: 1, sizeZ: 1, data: new Uint8Array([255, 128, 0]) };
    const map = {
      sizeX: 64,
      sizeY: 16,
      sizeZ: 64,
      regions: [],
      lightGrid,
      grid: createWorldGrid(64, 16, 64),
      blocks: createBlockRegistry([]),
      props: [
        { model: 1, x: 0, y: 0, z: 0, yaw: 0, scale: 1, dose: 0 },
        { model: 1, x: 1, y: 0, z: 0, yaw: 0, scale: 1, dose: 2 },
        { model: 1, x: 0, y: 0, z: 200, yaw: 0, scale: 1, dose: 1 },
      ],
      blockFaceLayers: new Uint8Array(6),
    } as RenderMap;
    pass.setMap(map);
    const debug = createRenderDebug();
    debug.propDose = 'blocks';
    pass.update(frame(0, debug));
    const near = mesh(ctx.scene, 'props-0');
    expect(near.count).toBe(1);
    debug.propDose = 'double';
    pass.update(frame(0, debug));
    expect(near.count).toBe(2);
    pass.beforeView(viewContext(createViewDesc()));
    // O grupo a 200 m está além do plano distante (90 m).
    expect(pass.lastViewPropGroups).toBe(1);
    expect(mesh(ctx.scene, 'props-1').visible).toBe(false);
    pass.dispose();
  });

  it('M2: projéteis em voo entram no conjunto instanciado da arma do modelo, sem malha nova', () => {
    const { ctx } = fakeContext();
    const pass = createActorPass(ctx);
    pass.setModels([rifle, barrel]);
    const projectiles = createProjectileBuffer(4);
    projectiles.count = 3;
    projectiles.model[0] = 0;
    projectiles.model[1] = 0;
    // Prop não tem conjunto de arma: não desenha.
    projectiles.model[2] = 1;
    projectiles.position.set([0, 1, -3, 2, 1, -3], 0);
    projectiles.yaw[1] = Math.PI / 2;
    projectiles.pitch[1] = 0.3;
    pass.setProjectiles(projectiles);
    pass.update(frame(0));
    const weapon = mesh(ctx.scene, 'arma-rifle');
    expect(weapon.count).toBe(2);
    // A matriz do 1º projétil leva a posição dele (translação na coluna 3).
    const m = weapon.instanceMatrix.array;
    expect([m[12], m[13], m[14]]).toEqual([0, 1, -3]);
    pass.setProjectiles(null);
    pass.update(frame(1 / 60));
    expect(weapon.count).toBe(0);
    pass.dispose();
  });

  it('M2 (fase 2b): a caixinha (modelo pickup) tem conjunto instanciado próprio no mesmo buffer', () => {
    const { ctx } = fakeContext();
    const pass = createActorPass(ctx);
    pass.setModels([rifle, barrel, ammoBox]);
    const buffer = createProjectileBuffer(4);
    buffer.count = 2;
    buffer.model[0] = 2;
    buffer.model[1] = 2;
    pass.setProjectiles(buffer);
    pass.update(frame(0));
    expect(mesh(ctx.scene, 'arma-ammo-box').count).toBe(2);
    expect(mesh(ctx.scene, 'arma-rifle').count).toBe(0);
    expect(ctx.scene.getObjectByName('arma-barrel')).toBeUndefined();
    pass.dispose();
  });
});

describe('passe de VFX (three sem GPU)', () => {
  it('consome a fila, divide os programas e some sozinho; ≤ 5 malhas no mundo', () => {
    const { ctx, calls } = fakeContext();
    const actors = createActorPass(ctx);
    const fx = createFxPass(ctx);
    actors.setModels([rifle]);
    const buffer = figureActors();
    actors.setActors(buffer);
    actors.setFigures(templates, table);
    fx.setFigures(templates);
    fx.setDebrisBudget(200);
    const q = createFxQueue(16);
    pushMuzzleFlash(q, buffer.entity[1]!, 2, 1.4, -0.5, 0, 0, -1, 0, 0);
    pushTracer(q, 2, 1.4, -0.5, 2, 1.4, -30);
    pushBlockImpact(q, 2, 1, -30, 0, 0, 1, 1, 4, 6);
    pushActorImpact(q, buffer.entity[0]!, 0, 1.2, 0, 0, 0, -1, FIGURE_BONE.torso, 5);
    pushDebris(q, 0, 1, 0, 0, 2, 0, 0xffd56b, 3, 1);
    pushDeath(q, {
      victim: buffer.entity[2]!,
      x: 4,
      y: 0,
      z: 0,
      yaw: 0,
      dirX: 0,
      dirY: 0,
      dirZ: -1,
      force: 6,
      bodyPart: FIGURE_BONE.head,
      skin: 92,
      scale: 1,
      kind: 0,
      figure: 0,
    });
    fx.submit(q);
    actors.update(frame(0));
    fx.update(frame(0));
    const group = ctx.scene.getObjectByName('render-fx')!;
    const visible = group.children.filter((c: Object3D) => c.visible);
    expect(visible.length).toBeLessThanOrEqual(5);
    expect(mesh(ctx.scene, 'cubinhos').count).toBeGreaterThanOrEqual(6 + 5 + 3 + 8);
    // O morto saiu do quadro: desmonta da pose de repouso; um cadáver ocupa um bloco de FIGURE_MAX_BOXES instâncias.
    expect(mesh(ctx.scene, 'desmonte-bonecos').count).toBe(FIGURE_MAX_BOXES);
    expect(ctx.scene.getObjectByName('desmonte')).toBeUndefined();
    expect(mesh(ctx.scene, 'fx-aditivo').visible).toBe(true);
    expect(mesh(ctx.scene, 'fx-marcas').count).toBe(1);

    // M2: explosão e rastro do foguete usam os mesmos anéis e o mesmo pool de cubinhos (nenhuma malha nova).
    const before = mesh(ctx.scene, 'cubinhos').count;
    pushExplosion(q, 0, 1, -10, 4);
    pushTrail(q, 0, 1.5, -5, 0, 0, -1);
    fx.submit(q);
    fx.update(frame(1 / 60));
    expect(mesh(ctx.scene, 'cubinhos').count).toBeGreaterThanOrEqual(before + 14);
    expect(
      ctx.scene.getObjectByName('render-fx')!.children.filter((c: Object3D) => c.visible).length,
    ).toBeLessThanOrEqual(5);

    // Todo material do passe usa um dos 2 programas (instanciado ou partículas).
    const shaders = new Set<string>();
    ctx.scene.traverse((o) => {
      const m = (o as InstancedMesh).material;
      if (m instanceof ShaderMaterial) shaders.add(m.vertexShader + m.fragmentShader + JSON.stringify(m.defines));
    });
    expect(shaders.size).toBe(2);

    // Clarão do viewmodel na vista do dono (slot 0), depois do viewmodel.
    const view = createViewDesc();
    view.localSlot = 0;
    view.viewmodel.visible = true;
    view.viewmodel.model = 0;
    const v = viewContext(view);
    fx.beforeView(v);
    actors.beforeView(v);
    actors.afterView(v);
    fx.afterView(v);
    expect(calls.filter((c) => c.startsWith('render:')).length).toBe(2);

    // 5 s depois: só as marcas de tiro (20 s) continuam.
    for (let t = 1; t <= 300; t++) {
      actors.update(frame(t / 60));
      fx.update(frame(t / 60));
    }
    expect(mesh(ctx.scene, 'cubinhos').visible).toBe(false);
    expect(mesh(ctx.scene, 'desmonte-bonecos').visible).toBe(false);
    expect(mesh(ctx.scene, 'fx-aditivo').visible).toBe(false);
    expect(mesh(ctx.scene, 'fx-marcas').visible).toBe(true);
    fx.setMap(null);
    fx.update(frame(6));
    expect(mesh(ctx.scene, 'fx-marcas').visible).toBe(false);
    fx.dispose();
    actors.dispose();
  });
});

describe('bonecos do FutBobo nos passes (#56, three sem GPU, rig real da F4)', () => {
  it('UMA malha "bobos" (1 draw por vista), arma pela rig.weapon, sombra, morto fora, o mesmo programa 4', () => {
    const { ctx } = fakeContext();
    const pass = createActorPass(ctx);
    pass.setModels([rifle]);
    const a = figureActors();
    pass.setActors(a);
    pass.setFigures(templates, table);
    pass.update(frame(0));
    const bobos = mesh(ctx.scene, 'bobos');
    expect(bobos.count).toBe(templates.length[0]! + templates.length[1]!);
    expect(bobos.visible).toBe(true);
    expect(bobos.boundingSphere?.radius).toBe(1e6);
    expect(mesh(ctx.scene, 'arma-rifle').count).toBe(1);
    expect(mesh(ctx.scene, 'sombra-blob').count).toBe(2);
    expect(bobos.material).toBe(mesh(ctx.scene, 'arma-rifle').material);
    const view = createViewDesc();
    view.localSlot = 0;
    pass.beforeView(viewContext(view));
    expect(pass.lastViewActorDraws).toBe(1);
    expect(pass.lastViewActors).toBe(1);
    expect(pass.figureCount).toBe(2);
    expect(pass.figureBoxes).toBe(bobos.count);
    // Viewmodel com os braços do FutBobo: a arma + 2 braços de 3 caixas.
    view.viewmodel.visible = true;
    view.viewmodel.model = 0;
    pass.afterView(viewContext(view));
    expect(linkFor(ctx.scene).viewmodelCamera).not.toBeNull();
    // Sem gabaritos de novo (fim da partida): nenhum corpo.
    pass.setFigures(null, null);
    pass.update(frame(1 / 60));
    expect(mesh(ctx.scene, 'bobos').count).toBe(0);
    expect(mesh(ctx.scene, 'sombra-blob').count).toBe(0);
    pass.beforeView(viewContext(view));
    expect(pass.lastViewActorDraws).toBe(0);
    pass.dispose();
  });

  it('upload: o prefixo dos manequins sobe só no loading; depois, 1 faixa de matrizes e dados só no evento', () => {
    const { ctx } = fakeContext();
    const pass = createActorPass(ctx);
    const a = figureActors();
    // Manequim DEPOIS das entidades, como no `game`.
    a.count = 4;
    a.entity[3] = 0;
    a.figure[3] = 1;
    a.position.set([5, 0, 5], 9);
    a.weapon[3] = NO_MODEL;
    a.localSlot[3] = 255;
    a.skin[3] = 70;
    pass.setActors(a);
    pass.setFigures(templates, table);
    pass.update(frame(0));
    const bobos = mesh(ctx.scene, 'bobos');
    const matrices = bobos.instanceMatrix.updateRanges[0]!;
    const data = (bobos.geometry.getAttribute('iLayer') as InterleavedBufferAttribute).data.updateRanges[0]!;
    const prefix = templates.length[1]!;
    const total = prefix + templates.length[0]! + templates.length[1]!;
    expect(bobos.count).toBe(total);
    // 1º quadro (loading): tudo sobe.
    expect([matrices.start, matrices.count]).toEqual([0, total * 16]);
    expect([data.start, data.count]).toEqual([0, total * 16]);
    data.count = -1;
    for (let f = 1; f < 5; f++) {
      a.position[0] = f * 0.1;
      pass.update(frame(f / 60));
      expect([matrices.start, matrices.count], `quadro ${f}`).toEqual([prefix * 16, (total - prefix) * 16]);
      expect(data.count, `quadro ${f}`).toBe(-1);
    }
    // O morto (entidade 2) sai de vez do buffer: o manequim sobe um índice e o prefixo continua parado.
    a.count = 3;
    a.entity[2] = 0;
    a.figure[2] = 1;
    a.position.set([5, 0, 5], 6);
    a.skin[2] = 70;
    a.team[2] = a.team[3]!;
    a.pose[2] = 0;
    a.weapon[2] = NO_MODEL;
    pass.update(frame(5 / 60));
    expect([matrices.start, matrices.count]).toEqual([prefix * 16, (total - prefix) * 16]);
    expect(data.count).toBe(-1);
    // Sombra-blob do boneco: 16 px de ombro a ombro = 0,875 m (× escala).
    const shadow = mesh(ctx.scene, 'sombra-blob');
    const blob = (shadow.geometry.getAttribute('pA') as InterleavedBufferAttribute).data.array as Float32Array;
    expect(blob[3]).toBeCloseTo(0.875, 6);
    pass.dispose();
    expect(linkFor(ctx.scene).figure).toBeNull();
  });

  it('desmonte de 6 grupos a partir da faixa do ator e cubinho pela caixa atingida', () => {
    const { ctx } = fakeContext();
    const actors = createActorPass(ctx);
    const fx = createFxPass(ctx);
    actors.setModels([rifle]);
    const a = figureActors();
    actors.setActors(a);
    actors.setFigures(templates, table);
    fx.setFigures(templates);
    actors.update(frame(0));
    fx.update(frame(0));
    const q = createFxQueue(8);
    pushActorImpact(q, a.entity[0]!, 0, 1.2, 0, 0, 0, -1, FIGURE_BONE.torso, 5);
    pushDeath(q, {
      victim: a.entity[1]!,
      x: 2,
      y: 0,
      z: 0,
      yaw: 0,
      dirX: 0,
      dirY: 0,
      dirZ: -1,
      force: 6,
      bodyPart: FIGURE_BONE.head,
      skin: 91,
      scale: 1,
      kind: 0,
      figure: 1,
    });
    fx.submit(q);
    actors.update(frame(1 / 60));
    fx.update(frame(1 / 60));
    expect(mesh(ctx.scene, 'desmonte-bonecos').count).toBe(44);
    expect(mesh(ctx.scene, 'cubinhos').count).toBeGreaterThanOrEqual(5 + 8);
    const shaders = new Set<string>();
    ctx.scene.traverse((o) => {
      const m = (o as InstancedMesh).material;
      if (m instanceof ShaderMaterial) shaders.add(m.vertexShader + m.fragmentShader + JSON.stringify(m.defines));
    });
    expect(shaders.size).toBe(2);
    fx.dispose();
    actors.dispose();
  });
});
