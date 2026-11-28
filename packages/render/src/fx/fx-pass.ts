// Passe de VFX (arte-ux.md §4, tecnico.md §6.6): consome a `FxQueue` do frame e desenha, por vista, no máximo 5 draw
// calls no mundo + 1 do clarão do viewmodel (orçamento: ≤ 6): cubinhos (programa 4), desmontes (programa 4, um draw
// para todos), partículas aditivas, partículas com alfa e marcas de tiro (programa 5). Pools pré-alocados; RNG próprio
// (cosmético, fora da sim). Cada efeito some sozinho: o passe nunca desenha uma malha sem nada vivo.
//
// #56 (porte do boneco do FutBobo, PLANO §B13): o boneco se desmonta em 6 corpos (`figure-corpses.ts`, cubo do
// programa 4, um draw para todos) a partir das 12 matrizes de osso do último quadro (faixa viva do ator, ou o
// cemitério das instâncias, ou a pose de repouso), e o cubinho do acerto lê o texel da caixa atingida do osso
// `HitEvent.bodyPart`. Sem gabaritos (ou ator sem boneco) o acerto e a morte só soltam a poeira, o confete e cubinhos
// cinza: o desmonte por `iPart` e a cor por parte do bobo A saíram no passo 5 do porte.
import {
  FIGURE_BOX_STRIDE,
  FIGURE_BONES,
  FIGURE_HEIGHT_PX,
  FIGURE_MAX_BOXES,
  FIGURE_POSE_SIZE,
  FIGURE_PX_M,
  FIGURE_REST_POSE,
  figureFk,
  figureRoot,
  type FigureTemplateSet,
} from '@boboforces/format';
import { createRng, type Rng } from '@boboforces/shared';
import { MAX_BLOCK_ID, sampleLightGrid, type LightGrid } from '@boboforces/world';
import { Group, PerspectiveCamera, Scene, type InstancedMesh } from 'three';
import { buildFigureCubeGeometry } from '../actors/figure-cube.ts';
import { FIGURE_BONE_FLOATS } from '../actors/figure-instances.ts';
import { ACTOR_SKY_FLOOR, INSTANCE_FLOATS } from '../actors/layout.ts';
import { findActor, linkFor } from '../actors/link.ts';
import { MAT4 } from '../actors/math.ts';
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
  uploadRange,
  type InstanceSet,
  type ParticleMesh,
} from '../actors/three-objects.ts';
import { createFxQueue, FX_KIND, FX_STRIDE, type FxQueue } from '../fx-queue.ts';
import type { FrameContext, FxPass, PassContext, ViewContext } from '../shared/passes.ts';
import { createWarmTwins } from '../shared/warm-twins.ts';
import { NO_FIGURE, type RenderMap } from '../types.ts';
import {
  blockTexelColor,
  FALLBACK_DEBRIS_COLOR,
  figureBoxTexelColor,
  figureHitBox,
  jitterColor,
  lightenColor,
} from './colors.ts';
import {
  buildDebrisCubeGeometry,
  clearDebris,
  createDebrisPool,
  DEBRIS_CAPACITY,
  setDebrisBudget,
  spawnDebris,
  stepDebris,
  type DebrisPool,
} from './debris.ts';
import {
  clearFigureCorpses,
  createFigureCorpsePool,
  createFigureCorpseSpec,
  spawnFigureCorpse,
  stepFigureCorpses,
} from './figure-corpses.ts';
import {
  clearParticleRing,
  createParticleRing,
  createParticleSpec,
  emitParticle,
  markParticlesUploaded,
  PARTICLE_FLOATS,
  resetParticleSpec,
  type ParticleRing,
} from './particles.ts';
import { PARTICLE_KIND } from './shader.ts';
import { tracerLife, tracerLookOf } from './tracer.ts';
import { floorBelow, type CollisionWorld } from './verlet.ts';

/** Tamanho dos anéis (arte-ux.md §4.1: traçantes 128, marcas de tiro 256). */
export const FX_RING_SIZES = { additive: 384, alpha: 384, decal: 256 } as const;
/** Pedidos por frame copiados da fila do `game`. */
export const FX_QUEUE_CAPACITY = 256;
/** Teto de cubinhos por pedido (a fila pode pedir mais; o pool é o limite real). */
const MAX_CUBES_PER_EVENT = 16;
/** M6 (fase 5): o anel das manchas de tinta (o teto do PC, U6) e quanto cada uma fica (até a mais velha sair). */
export const PAINT_RING_SIZE = 96;
export const PAINT_LIFE_S = 600;
/** O anel das bolas de tinta em voo (cada uma vive um quadro e pouco). */
const PAINT_BALL_RING_SIZE = 192;
/** Vida da marca de tiro (GDD §5.5). */
export const DECAL_LIFE_S = 20;
/** Centro do corpo de pé (m acima dos pés, × escala): metade da altura do boneco (#56). */
const FIGURE_CENTER_Y_M = FIGURE_HEIGHT_PX * FIGURE_PX_M * 0.5;
/** Confete do "poof" da morte: cores de time + amarelo, rosa e branco. */
const CONFETTI = [0xff7a1a, 0x2e8bff, 0x3ddc97, 0xa66bff, 0xffd23f, 0xff6fb5, 0xffffff] as const;

/** M2: cores dos cubinhos da explosão (carvão, cinza e laranja da paleta mestra). */
const EXPLOSION_CUBES = [0x2c2f3b, 0x454955, 0x9a4f30, 0xc4723f] as const;

/** M12 (fase 5): confetes que saem da cabeça no tiro na cabeça. */
const HEADSHOT_CONFETTI = 14;
/** M12 (fase 5): a marca chamuscada da explosão (diâmetro = isto × raio, presa a [mín, máx] m) e até onde o chão conta. */
export const SCORCH_SIZE_PER_RADIUS = 0.7;
const SCORCH_MIN_M = 1;
const SCORCH_MAX_M = 2.8;
/** Tom da marca chamuscada: a cor do chão vezes isto. */
const SCORCH_TONE = 0.32;
/** Altura máxima (× raio) da explosão ao chão para deixar marca e levantar o anel de poeira. */
const SCORCH_REACH_PER_RADIUS = 0.6;
/** Pedaços do anel de poeira da explosão. */
const DUST_RING_PUFFS = 10;
/** Cor do pó sem o chão à mão (sem mundo ou sem camada): terra clara. */
const FALLBACK_DUST_COLOR = 0xa89a80;

/**
 * M7 (fase 8): a parede da zona do Royale: pedaços em pé em volta do círculo (o raio de 130 m da ilha dá ~13 m por
 * pedaço), do chão até 60 m.
 */
export const ZONE_WALL_SEGMENTS = 64;
const ZONE_WALL_BOTTOM_M = -4;
const ZONE_WALL_HEIGHT_M = 64;

export function createFxPass(ctx: PassContext): FxPass {
  const link = linkFor(ctx.scene);
  const perView = createInstancedUniforms();
  const material = createInstancedMaterial(ctx, perView, 'instanciado-fx');
  const pUniforms = createParticleUniforms();
  const additive = createParticleMaterial(ctx, pUniforms, 'additive');
  const alpha = createParticleMaterial(ctx, pUniforms, 'alpha');
  const decal = createParticleMaterial(ctx, pUniforms, 'decal');
  const vmUniforms = createParticleUniforms();
  const vmFlash = createParticleMaterial(ctx, vmUniforms, 'additive');
  vmFlash.depthTest = false;
  const root = new Group();
  root.name = 'render-fx';
  ctx.scene.add(root);
  const quad = createQuadGeometry();
  const rng: Rng = createRng('render-fx');

  // --- cubinhos (programa 4) ---
  const debris: DebrisPool = createDebrisPool(DEBRIS_CAPACITY, 200);
  const debrisSet: InstanceSet = createInstanceSet(DEBRIS_CAPACITY, debris.matrices, debris.data);
  uploadRange(debrisSet.dataBuffer, debrisSet.dataRange, INSTANCE_FLOATS, 0, DEBRIS_CAPACITY - 1);
  const debrisMesh = instancedMesh(
    instancedGeometry(createVertexBuffers(buildDebrisCubeGeometry()), debrisSet.dataBuffer),
    material,
    debrisSet.matrixAttribute,
    'cubinhos',
  );
  root.add(debrisMesh);

  // --- desmonte dos bonecos do FutBobo (programa 4, cubo das figuras, uma instância por caixa) ---
  const figureCorpses = createFigureCorpsePool();
  const figureCorpseSet = createInstanceSet(figureCorpses.instances, figureCorpses.matrices, figureCorpses.data);
  const figureCorpseMesh = instancedMesh(
    instancedGeometry(createVertexBuffers(buildFigureCubeGeometry()), figureCorpseSet.dataBuffer),
    material,
    figureCorpseSet.matrixAttribute,
    'desmonte-bonecos',
  );
  root.add(figureCorpseMesh);
  const figureCorpse = createFigureCorpseSpec();
  /** 12 matrizes de osso da pose de repouso (desmonte sem faixa nem cemitério) e os rascunhos dela. */
  const restBones = new Float32Array(FIGURE_BONE_FLOATS);
  const restRoot = new Float32Array(MAT4);
  const restPose = new Float32Array(FIGURE_POSE_SIZE);
  restPose.set(FIGURE_REST_POSE);

  // --- partículas (programa 5) ---
  const rings = {
    additive: createParticleRing(FX_RING_SIZES.additive),
    alpha: createParticleRing(FX_RING_SIZES.alpha),
    decal: createParticleRing(FX_RING_SIZES.decal),
    // M6 (fase 5): as manchas de tinta, num anel delas (o teto é o da plataforma, que vem em cada pedido), e as bolas
    // em voo, num anel delas também (uma partícula por bola por quadro não empurra a fumaça do anel alfa).
    paint: createParticleRing(PAINT_RING_SIZE),
    balls: createParticleRing(PAINT_BALL_RING_SIZE),
    // M7 (fase 8): a parede da zona do Royale (os pedaços do círculo, reescritos quando ele muda).
    zone: createParticleRing(ZONE_WALL_SEGMENTS),
  };
  const ringMeshes: [ParticleRing, ParticleMesh][] = [
    [rings.additive, createParticleMesh(quad, rings.additive.data, additive, 'fx-aditivo')],
    [rings.alpha, createParticleMesh(quad, rings.alpha.data, alpha, 'fx-alfa')],
    [rings.decal, createParticleMesh(quad, rings.decal.data, decal, 'fx-marcas')],
    [rings.paint, createParticleMesh(quad, rings.paint.data, decal, 'fx-tinta')],
    [rings.balls, createParticleMesh(quad, rings.balls.data, alpha, 'fx-bolas')],
    [rings.zone, createParticleMesh(quad, rings.zone.data, additive, 'fx-zona')],
  ];
  for (const [, pm] of ringMeshes) root.add(pm.mesh);

  // --- clarão do viewmodel (desenhado por cima, depois do viewmodel, com a câmera dele) ---
  const vmRing = createParticleRing(2);
  const vmMesh = createParticleMesh(quad, vmRing.data, vmFlash, 'clarao-viewmodel');
  const vmScene = new Scene();
  vmScene.name = 'clarao-viewmodel';
  vmScene.add(vmMesh.mesh);
  const vmFlashUntil = new Float64Array(4).fill(-1);
  const vmFlashRotation = new Float32Array(4);
  const warmCamera = new PerspectiveCamera();

  const pending: FxQueue = createFxQueue(FX_QUEUE_CAPACITY);
  const spec = createParticleSpec();
  const light = new Float32Array(3);
  const local = new Float32Array(3);
  let map: RenderMap | null = null;
  let clock = 0;
  let disposed = false;
  /** M7 (fase 8): o círculo da parede da zona que está no anel (centro e raio). */
  const zoneKey = new Float64Array([NaN, NaN, NaN]);
  // Gabaritos do boneco do FutBobo (#56): o desmonte e a caixa do cubinho saem deles.
  let figureTemplates: FigureTemplateSet | null = null;

  function sample(grid: LightGrid | null, x: number, y: number, z: number): void {
    if (grid) sampleLightGrid(grid, x, y, z, light, 0);
    else {
      light[0] = 1;
      light[1] = 1;
      light[2] = 0;
    }
  }

  function lit(): void {
    spec.sky = light[0]!;
    spec.sun = light[1]!;
    spec.emissive = light[2]!;
  }

  function setColor(rgb: number, a: number): void {
    spec.r = ((rgb >> 16) & 0xff) / 255;
    spec.g = ((rgb >> 8) & 0xff) / 255;
    spec.b = (rgb & 0xff) / 255;
    spec.a = a;
  }

  function cube(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    rgb: number,
    size: number,
    life: number,
  ): void {
    spawnDebris(
      debris,
      x,
      y,
      z,
      vx,
      vy,
      vz,
      rgb,
      size,
      life,
      light[0]!,
      light[1]!,
      light[2]!,
      rng.range(0, 6.28),
      rng.range(0, 6.28),
      rng.range(-12, 12),
    );
  }

  /**
   * M12 (fase 5): o chão embaixo de (x, y, z) até `maxDown` m: a altura em `groundY` e a cor do texel do topo do bloco
   * (`blockTexelColor`, com a variedade `du`/`dv`); -1 sem chão sólido (no ar, fora da grade).
   */
  let groundY = 0;
  function groundColor(world: CollisionWorld, x: number, y: number, z: number, maxDown: number): number {
    const g = floorBelow(world, x, y + 0.05, z, maxDown);
    if (!(g === g)) return -1;
    groundY = g;
    const cy = Math.floor((g - 0.01) * 2);
    const grid = world.grid;
    const cx = Math.floor(x * 2);
    const cz = Math.floor(z * 2);
    if (cy < 0 || cx < 0 || cz < 0 || cx >= grid.sizeX || cz >= grid.sizeZ || cy >= grid.sizeY) {
      return FALLBACK_DUST_COLOR;
    }
    const block = grid.get(cx, cy, cz) & MAX_BLOCK_ID;
    const blocks = ctx.textures.assets?.blocks ?? null;
    const rgb = blockTexelColor(blocks, map, block, -1, x, g, z, 0, 1, 0, 0, 0);
    return rgb === FALLBACK_DEBRIS_COLOR ? FALLBACK_DUST_COLOR : rgb;
  }

  /**
   * M12 (fase 5): pó do pouso forte e do deslize: 4–6 cubinhos na cor do bloco do chão (com variação) e uma
   * nuvenzinha clara, sem marca. No ar (sem chão até 0,6 m) não levanta nada.
   */
  function dust(o: number, frame: FrameContext): void {
    const d = pending.data;
    const x = d[o]!;
    const y = d[o + 1]!;
    const z = d[o + 2]!;
    const s = Math.max(0, Math.min(1, d[o + 3]!));
    const vx = d[o + 4]!;
    const vz = d[o + 5]!;
    let rgb = FALLBACK_DUST_COLOR;
    let ground = y;
    const world = frame.world;
    if (world) {
      rgb = groundColor(world, x, y, z, 0.6);
      if (rgb < 0) return;
      ground = groundY;
    }
    sample(world?.lightGrid ?? null, x, ground + 0.3, z);
    // O deslize (a cada 0,1 s) solta só 1 cubinho: o anel de detritos é de 120–200 no Switch.
    const n = d[o + 6]! > 0.5 ? 1 : 4 + Math.round(2 * s);
    for (let k = 0; k < n; k++) {
      const up = 0.8 + rng.next() * (0.8 + 1.2 * s);
      cube(
        x + rng.range(-0.18, 0.18),
        ground + 0.05,
        z + rng.range(-0.18, 0.18),
        vx * 0.35 + rng.range(-1.1, 1.1) * (0.6 + s),
        up,
        vz * 0.35 + rng.range(-1.1, 1.1) * (0.6 + s),
        jitterColor(rgb, 0.12, rng.next()),
        0.035 + rng.next() * 0.03,
        0.7 + rng.next() * 0.4,
      );
    }
    resetParticleSpec(spec);
    lit();
    spec.kind = PARTICLE_KIND.round;
    spec.x = x;
    spec.y = ground + 0.12;
    spec.z = z;
    spec.vx = vx * 0.2;
    spec.vy = 0.35;
    spec.vz = vz * 0.2;
    spec.gravity = -0.2;
    spec.size = 0.2 + 0.25 * s;
    spec.growth = 2.6;
    spec.life = 0.45 + 0.2 * s;
    setColor(lightenColor(rgb, 0.4), 0.45);
    emitParticle(rings.alpha, spec, clock);
  }

  /** Poeira, marca e faíscas comuns ao tiro no cenário e na prop. */
  function surfaceHit(x: number, y: number, z: number, nx: number, ny: number, nz: number, base: number): void {
    resetParticleSpec(spec);
    lit();
    spec.kind = PARTICLE_KIND.round;
    spec.x = x + nx * 0.05;
    spec.y = y + ny * 0.05;
    spec.z = z + nz * 0.05;
    spec.size = 0.16;
    spec.growth = 3.2;
    spec.life = 0.55;
    spec.vx = nx * 0.7;
    spec.vy = ny * 0.7 + 0.25;
    spec.vz = nz * 0.7;
    spec.gravity = -0.4;
    setColor(lightenColor(base, 0.35), 0.55);
    emitParticle(rings.alpha, spec, clock);

    resetParticleSpec(spec);
    lit();
    spec.kind = PARTICLE_KIND.decal;
    spec.x = x;
    spec.y = y;
    spec.z = z;
    spec.x1 = nx;
    spec.y1 = ny;
    spec.z1 = nz;
    spec.size = 0.085;
    spec.life = DECAL_LIFE_S;
    spec.rotation = rng.range(0, Math.PI * 2);
    setColor(base, 1);
    emitParticle(rings.decal, spec, clock);

    for (let k = 0; k < 2; k++) {
      resetParticleSpec(spec);
      spec.kind = PARTICLE_KIND.spark;
      spec.x = x + nx * 0.02;
      spec.y = y + ny * 0.02;
      spec.z = z + nz * 0.02;
      spec.vx = nx * 2.5 + rng.range(-1.8, 1.8);
      spec.vy = ny * 2.5 + rng.range(0, 2.4);
      spec.vz = nz * 2.5 + rng.range(-1.8, 1.8);
      spec.gravity = 9.8;
      spec.size = 0.012;
      spec.life = 0.16 + rng.next() * 0.08;
      setColor(0xffd873, 1);
      emitParticle(rings.additive, spec, clock);
    }
  }

  function muzzleFlash(o: number): void {
    const d = pending.data;
    const owner = d[o + 6]! >= 0 && d[o + 6]! < 4 ? Math.round(d[o + 6]!) : -1;
    // M9 (fase 1b): o clarão do Mini e do gigante na escala do corpo (0 = pedido antigo, tamanho 1).
    const k = d[o + 8]! > 0 ? d[o + 8]! : 1;
    const x = d[o]! + d[o + 3]! * 0.05 * k;
    const y = d[o + 1]! + d[o + 4]! * 0.05 * k;
    const z = d[o + 2]! + d[o + 5]! * 0.05 * k;
    resetParticleSpec(spec);
    spec.kind = PARTICLE_KIND.star;
    spec.owner = owner;
    spec.x = x;
    spec.y = y;
    spec.z = z;
    spec.size = 0.32 * k;
    spec.growth = 1.2;
    spec.life = 0.05;
    spec.rotation = rng.range(0, Math.PI);
    setColor(0xffdb73, 1);
    emitParticle(rings.additive, spec, clock);
    spec.kind = PARTICLE_KIND.round;
    spec.size = 0.9 * k;
    spec.life = 0.07;
    setColor(0xffbf59, 0.35);
    emitParticle(rings.additive, spec, clock);
    // Fumacinha do cano (também some na vista do dono: estaria colada na câmera).
    resetParticleSpec(spec);
    spec.owner = owner;
    spec.kind = PARTICLE_KIND.round;
    spec.x = x;
    spec.y = y;
    spec.z = z;
    spec.size = 0.1 * k;
    spec.growth = 3;
    spec.life = 0.5;
    spec.vx = d[o + 3]! * 0.6 * k;
    spec.vy = (d[o + 4]! * 0.6 + 0.4) * k;
    spec.vz = d[o + 5]! * 0.6 * k;
    spec.gravity = -0.6;
    setColor(0xd9d9d9, 0.3);
    emitParticle(rings.alpha, spec, clock);
    if (owner >= 0) {
      vmFlashUntil[owner] = clock + 0.05;
      vmFlashRotation[owner] = rng.range(0, Math.PI);
    }
  }

  function tracer(o: number): void {
    const d = pending.data;
    const len = Math.hypot(d[o + 3]! - d[o]!, d[o + 4]! - d[o + 1]!, d[o + 5]! - d[o + 2]!);
    // M9 (fase 1b): o estilo (o quique do Ricochete mais grosso, claro e demorado; `TRACER_LOOK`).
    const look = tracerLookOf(d[o + 6]!);
    resetParticleSpec(spec);
    spec.kind = PARTICLE_KIND.streak;
    spec.x = d[o]!;
    spec.y = d[o + 1]!;
    spec.z = d[o + 2]!;
    spec.x1 = d[o + 3]!;
    spec.y1 = d[o + 4]!;
    spec.z1 = d[o + 5]!;
    spec.vx = look.tail;
    spec.size = look.size;
    spec.life = tracerLife(look, len);
    setColor(look.color, look.alpha);
    emitParticle(rings.additive, spec, clock);
  }

  function blockImpact(o: number, frame: FrameContext): void {
    const d = pending.data;
    const x = d[o]!;
    const y = d[o + 1]!;
    const z = d[o + 2]!;
    const nx = d[o + 3]!;
    const ny = d[o + 4]!;
    const nz = d[o + 5]!;
    const block = d[o + 6]!;
    const face = d[o + 7]!;
    const n = Math.min(MAX_CUBES_PER_EVENT, Math.max(0, Math.round(d[o + 8]!)));
    const blocks = ctx.textures.assets?.blocks ?? null;
    sample(frame.world?.lightGrid ?? null, x + nx * 0.3, y + ny * 0.3, z + nz * 0.3);
    const base = blockTexelColor(blocks, map, block, face, x, y, z, nx, ny, nz, 0, 0);
    for (let k = 0; k < n; k++) {
      const rgb = blockTexelColor(blocks, map, block, face, x, y, z, nx, ny, nz, rng.range(-2, 2), rng.range(-2, 2));
      const speed = 1.2 + rng.next() * 2.2;
      cube(
        x + nx * 0.04,
        y + ny * 0.04,
        z + nz * 0.04,
        nx * speed + rng.range(-1.2, 1.2),
        ny * speed + rng.range(-0.4, 1.2) + 1.2,
        nz * speed + rng.range(-1.2, 1.2),
        rgb,
        0.05 + rng.next() * 0.04,
        1.4 + rng.next(),
      );
    }
    surfaceHit(x, y, z, nx, ny, nz, base);
  }

  function propImpact(o: number, frame: FrameContext): void {
    const d = pending.data;
    const x = d[o]!;
    const y = d[o + 1]!;
    const z = d[o + 2]!;
    const nx = d[o + 3]!;
    const ny = d[o + 4]!;
    const nz = d[o + 5]!;
    const n = Math.min(MAX_CUBES_PER_EVENT, Math.max(0, Math.round(d[o + 7]!)));
    sample(frame.world?.lightGrid ?? null, x + nx * 0.3, y + ny * 0.3, z + nz * 0.3);
    const base = propColor(d[o + 6]!);
    for (let k = 0; k < n; k++) {
      const speed = 1.2 + rng.next() * 2;
      cube(
        x + nx * 0.04,
        y + ny * 0.04,
        z + nz * 0.04,
        nx * speed + rng.range(-1.2, 1.2),
        ny * speed + rng.range(0, 1.2) + 1,
        nz * speed + rng.range(-1.2, 1.2),
        jitterColor(base, 0.08, rng.next()),
        0.05 + rng.next() * 0.04,
        1.4 + rng.next(),
      );
    }
    surfaceHit(x, y, z, nx, ny, nz, base);
  }

  /**
   * Cor de prop no acerto: a `debrisColor` do modelo da prop atingida. O `game` resolve o `ImpactEvent.prop` (caixa em
   * `StaticColliders`) para a prop dona (índice em `RenderMap.props`, a mesma ordem do `.bfmap`) no `pushPropImpact`
   * (integração do M1, docs/ARCHITECTURE.md §8).
   */
  function propColor(index: number): number {
    const prop = map ? map.props[Math.round(index)] : undefined;
    const binding = prop ? link.models[prop.model] : undefined;
    return binding ? binding.debrisColor : FALLBACK_DEBRIS_COLOR;
  }

  function actorImpact(i: number, o: number, frame: FrameContext): void {
    const d = pending.data;
    const x = d[o]!;
    const y = d[o + 1]!;
    const z = d[o + 2]!;
    const dx = d[o + 3]!;
    const dy = d[o + 4]!;
    const dz = d[o + 5]!;
    const rawPart = Math.round(d[o + 6]!);
    const n = Math.min(MAX_CUBES_PER_EVENT, Math.max(0, Math.round(d[o + 7]!)));
    sample(frame.world?.lightGrid ?? null, x, y, z);
    const models = ctx.textures.assets?.models ?? null;
    const actor = findActor(link, pending.entity[i]!);
    // Boneco do FutBobo: a caixa atingida do osso `bodyPart` (0..11) na faixa do ator.
    const fig = link.figure;
    const templates = link.figureTemplates;
    const record = actor >= 0 && fig && templates ? (fig.actorRecord[actor] ?? -1) : -1;
    if (fig && templates && link.actors && record >= 0) {
      const bone = rawPart >= 0 && rawPart < FIGURE_BONES ? rawPart : 1;
      const base = fig.recTemplate[record]! * FIGURE_MAX_BOXES * FIGURE_BOX_STRIDE;
      const k = figureHitBox(
        fig.matrices,
        fig.recStart[record]!,
        templates.boxes,
        base,
        fig.recBoxes[record]!,
        bone,
        x,
        y,
        z,
        local,
      );
      const skin = link.actors.skin[actor]!;
      for (let c = 0; c < n; c++) {
        const rgb =
          k >= 0
            ? figureBoxTexelColor(
                models,
                skin,
                templates.boxes,
                base + k * FIGURE_BOX_STRIDE,
                local[0]!,
                local[1]!,
                local[2]!,
                rng.range(-1.5, 1.5),
                rng.range(-1.5, 1.5),
              )
            : FALLBACK_DEBRIS_COLOR;
        const speed = 1 + rng.next() * 2;
        cube(
          x,
          y,
          z,
          dx * speed + rng.range(-1.6, 1.6),
          dy * speed + rng.range(0, 1.6) + 1.4,
          dz * speed + rng.range(-1.6, 1.6),
          rgb,
          0.05 + rng.next() * 0.04,
          1.4 + rng.next(),
        );
      }
      puff(x, y, z);
      return;
    }
    // Ator sem boneco desenhado (ou sem gabaritos): cubinhos na cor padrão.
    for (let c = 0; c < n; c++) {
      const speed = 1 + rng.next() * 2;
      cube(
        x,
        y,
        z,
        dx * speed + rng.range(-1.6, 1.6),
        dy * speed + rng.range(0, 1.6) + 1.4,
        dz * speed + rng.range(-1.6, 1.6),
        FALLBACK_DEBRIS_COLOR,
        0.05 + rng.next() * 0.04,
        1.4 + rng.next(),
      );
    }
    puff(x, y, z);
  }

  /** Nuvenzinha branca do acerto em ator. */
  function puff(x: number, y: number, z: number): void {
    resetParticleSpec(spec);
    lit();
    spec.kind = PARTICLE_KIND.round;
    spec.x = x;
    spec.y = y;
    spec.z = z;
    spec.size = 0.1;
    spec.growth = 2.6;
    spec.life = 0.22;
    setColor(0xffffff, 0.5);
    emitParticle(rings.alpha, spec, clock);
  }

  /**
   * As 12 matrizes de osso de onde o boneco que morreu se desmonta: a faixa viva do ator (ainda no `ActorBuffer`), o
   * cemitério das instâncias (já saiu) ou, sem nenhum dos dois, a pose de repouso no ponto e no giro da morte. Devolve
   * o array e escreve o deslocamento em `boneOffset`.
   */
  function corpseBones(victim: number, x: number, y: number, z: number, yaw: number, scale: number): Float32Array {
    const fig = link.figure;
    if (fig) {
      const actor = findActor(link, victim);
      const record = actor >= 0 ? (fig.actorRecord[actor] ?? -1) : -1;
      if (record >= 0) {
        boneOffset = fig.recStart[record]! * MAT4;
        return fig.matrices;
      }
      const g = fig.findGrave(victim);
      if (g >= 0) {
        boneOffset = g * FIGURE_BONE_FLOATS;
        return fig.graveBones;
      }
    }
    figureRoot(restRoot, 0, x, y, z, yaw, scale, 0);
    figureFk(restPose, 0, restRoot, 0, restBones, 0);
    boneOffset = 0;
    return restBones;
  }
  let boneOffset = 0;

  /** Desmonte do boneco do FutBobo (gabarito `figure`). */
  function figureDeath(o: number, frame: FrameContext, figure: number, templates: FigureTemplateSet): void {
    const d = pending.data;
    const x = d[o]!;
    const y = d[o + 1]!;
    const z = d[o + 2]!;
    const scale = d[o + 10]! > 0 ? d[o + 10]! : 1;
    const bones = corpseBones(pending.entity[o / FX_STRIDE]!, x, y, z, d[o + 3]!, scale);
    // Luz e "poof" do centro do corpo (a origem do tronco), sem número fixo.
    const cy = bones[boneOffset + MAT4 + 13]!;
    sample(frame.world?.lightGrid ?? null, x, cy, z);
    figureCorpse.dirX = d[o + 4]!;
    figureCorpse.dirY = d[o + 5]!;
    figureCorpse.dirZ = d[o + 6]!;
    figureCorpse.force = d[o + 7]!;
    figureCorpse.bodyPart = Math.round(d[o + 8]!);
    figureCorpse.skin = d[o + 9]!;
    figureCorpse.sky = Math.max(ACTOR_SKY_FLOOR, light[0]!);
    figureCorpse.sun = light[1]!;
    figureCorpse.emissive = light[2]!;
    // M12 (fase 5): tiro na cabeça: a cabeça voa mais alto, girando, com confete na altura dela (GDD §5.5).
    figureCorpse.headPop = d[o + 13]! > 0.5;
    if (figureCorpse.headPop) {
      headConfetti(bones[boneOffset + 12]!, bones[boneOffset + 13]!, bones[boneOffset + 14]!);
    }
    spawnFigureCorpse(figureCorpses, bones, boneOffset, templates, figure, figureCorpse, rng);
    // Cubinhos na cor da roupa: o texel do meio da frente do tronco (caixa 1, osso do tronco, frente +z do FutBobo).
    const models = ctx.textures.assets?.models ?? null;
    const torso = (figure < templates.count ? figure : 0) * FIGURE_MAX_BOXES * FIGURE_BOX_STRIDE + FIGURE_BOX_STRIDE;
    for (let k = 0; k < 8; k++) {
      const rgb = figureBoxTexelColor(
        models,
        figureCorpse.skin,
        templates.boxes,
        torso,
        rng.range(-1.5, 1.5),
        6 + rng.range(-2, 2),
        2,
        0,
        0,
      );
      cube(
        x,
        cy,
        z,
        figureCorpse.dirX * figureCorpse.force * 0.3 + rng.range(-2.2, 2.2),
        rng.range(1.5, 4),
        figureCorpse.dirZ * figureCorpse.force * 0.3 + rng.range(-2.2, 2.2),
        rgb,
        0.06 + rng.next() * 0.03,
        1.6 + rng.next(),
      );
    }
    poof(x, cy, z);
  }

  function explicitDebris(o: number, frame: FrameContext): void {
    const d = pending.data;
    const n = Math.min(MAX_CUBES_PER_EVENT, Math.max(0, Math.round(d[o + 7]!)));
    const spread = Math.max(0, d[o + 8]!);
    const rgb = Math.round(d[o + 6]!) & 0xffffff;
    // M12 (fase 1): o lado e a vida do pedido (a cápsula dourada); 0 = o cubinho de sempre.
    const size = d[o + 9]! > 0 ? d[o + 9]! : 0.06;
    const life = d[o + 10]! > 0 ? d[o + 10]! : 2;
    sample(frame.world?.lightGrid ?? null, d[o]!, d[o + 1]!, d[o + 2]!);
    for (let k = 0; k < n; k++) {
      cube(
        d[o]!,
        d[o + 1]!,
        d[o + 2]!,
        d[o + 3]! + rng.range(-spread, spread),
        d[o + 4]! + rng.range(-spread, spread),
        d[o + 5]! + rng.range(-spread, spread),
        jitterColor(rgb, 0.05, rng.next()),
        size,
        life,
      );
    }
  }

  function death(o: number, frame: FrameContext): void {
    const d = pending.data;
    const figure = Math.round(d[o + 12]!);
    const templates = figureTemplates;
    if (figure !== NO_FIGURE && templates && templates.count > 0) {
      figureDeath(o, frame, figure, templates);
      return;
    }
    // Sem boneco para desmontar (gabaritos ainda não chegaram): só o "poof" na altura do centro do corpo de pé.
    const scale = d[o + 10]! > 0 ? d[o + 10]! : 1;
    const cy = d[o + 1]! + FIGURE_CENTER_Y_M * scale;
    sample(frame.world?.lightGrid ?? null, d[o]!, cy, d[o + 2]!);
    poof(d[o]!, cy, d[o + 2]!);
  }

  /** M12 (fase 5): o confete do tiro na cabeça, saindo da cabeça para cima (a luz é a do corpo, já amostrada). */
  function headConfetti(hx: number, hy: number, hz: number): void {
    for (let k = 0; k < HEADSHOT_CONFETTI; k++) {
      resetParticleSpec(spec);
      lit();
      spec.kind = PARTICLE_KIND.square;
      spec.x = hx;
      spec.y = hy;
      spec.z = hz;
      spec.vx = rng.range(-1.6, 1.6);
      spec.vy = rng.range(4.5, 6.5);
      spec.vz = rng.range(-1.6, 1.6);
      spec.gravity = 6;
      spec.size = 0.06;
      spec.growth = 0.8;
      spec.spin = rng.range(-12, 12);
      spec.rotation = rng.range(0, Math.PI);
      spec.life = 1.3 + rng.next() * 0.5;
      setColor(CONFETTI[(k + 3) % CONFETTI.length]!, 1);
      emitParticle(rings.alpha, spec, clock);
    }
  }

  /** "Poof" de confete e fumaça branca da morte. */
  function poof(cx: number, cy: number, cz: number): void {
    for (let k = 0; k < 22; k++) {
      resetParticleSpec(spec);
      lit();
      spec.kind = PARTICLE_KIND.square;
      spec.x = cx;
      spec.y = cy;
      spec.z = cz;
      spec.vx = rng.range(-2.2, 2.2);
      spec.vy = rng.range(3, 5.2);
      spec.vz = rng.range(-2.2, 2.2);
      spec.gravity = 5.5;
      spec.size = 0.07;
      spec.growth = 0.8;
      spec.spin = rng.range(-10, 10);
      spec.rotation = rng.range(0, Math.PI);
      spec.life = 1.5 + rng.next() * 0.6;
      setColor(CONFETTI[k % CONFETTI.length]!, 1);
      emitParticle(rings.alpha, spec, clock);
    }
    for (let k = 0; k < 4; k++) {
      resetParticleSpec(spec);
      lit();
      spec.kind = PARTICLE_KIND.round;
      spec.x = cx + rng.range(-0.2, 0.2);
      spec.y = cy + rng.range(-0.3, 0.3);
      spec.z = cz + rng.range(-0.2, 0.2);
      spec.vx = rng.range(-0.6, 0.6);
      spec.vy = 0.3;
      spec.vz = rng.range(-0.6, 0.6);
      spec.size = 0.35;
      spec.growth = 2.4;
      spec.life = 0.45;
      setColor(0xf2f2f2, 0.6);
      emitParticle(rings.alpha, spec, clock);
    }
  }

  /**
   * M2: explosão (arte-ux.md §4: "brinquedo que reage"). Clarão e bola de fogo aditivos no tamanho do raio, línguas de
   * fogo, faíscas, fumaça escura iluminada pela grade e cubinhos de carvão e laranja. Tudo nos anéis e no pool de
   * detritos que já existem (nenhum programa novo).
   */
  function explosion(o: number, frame: FrameContext): void {
    const d = pending.data;
    const x = d[o]!;
    const y = d[o + 1]!;
    const z = d[o + 2]!;
    const r = Math.max(1, d[o + 3]!);
    sample(frame.world?.lightGrid ?? null, x, y + 0.3, z);

    resetParticleSpec(spec);
    spec.kind = PARTICLE_KIND.star;
    spec.x = x;
    spec.y = y;
    spec.z = z;
    spec.size = r * 0.6;
    spec.growth = 0.6;
    spec.life = 0.08;
    spec.rotation = rng.range(0, Math.PI);
    setColor(0xfff1b8, 1);
    emitParticle(rings.additive, spec, clock);
    spec.kind = PARTICLE_KIND.round;
    spec.size = r * 0.45;
    spec.growth = 1.8;
    spec.life = 0.2;
    setColor(0xffa040, 0.9);
    emitParticle(rings.additive, spec, clock);

    for (let k = 0; k < 6; k++) {
      resetParticleSpec(spec);
      spec.kind = PARTICLE_KIND.round;
      spec.x = x + rng.range(-0.3, 0.3) * r;
      spec.y = y + rng.range(0, 0.3) * r;
      spec.z = z + rng.range(-0.3, 0.3) * r;
      spec.vx = rng.range(-1, 1) * r * 1.2;
      spec.vy = rng.range(0.2, 1) * r * 1.2;
      spec.vz = rng.range(-1, 1) * r * 1.2;
      spec.gravity = -1;
      spec.size = 0.5;
      spec.growth = 1.6;
      spec.life = 0.3 + rng.next() * 0.1;
      setColor(0xff8a33, 0.8);
      emitParticle(rings.additive, spec, clock);
    }
    for (let k = 0; k < 12; k++) {
      resetParticleSpec(spec);
      spec.kind = PARTICLE_KIND.spark;
      spec.x = x;
      spec.y = y + 0.1;
      spec.z = z;
      spec.vx = rng.range(-1, 1) * 9;
      spec.vy = rng.range(0, 1) * 9;
      spec.vz = rng.range(-1, 1) * 9;
      spec.gravity = 9.8;
      spec.size = 0.015;
      spec.life = 0.3 + rng.next() * 0.15;
      setColor(0xffd873, 1);
      emitParticle(rings.additive, spec, clock);
    }
    for (let k = 0; k < 8; k++) {
      resetParticleSpec(spec);
      lit();
      spec.kind = PARTICLE_KIND.round;
      spec.x = x + rng.range(-0.4, 0.4) * r;
      spec.y = y + rng.range(0, 0.4) * r;
      spec.z = z + rng.range(-0.4, 0.4) * r;
      spec.vx = rng.range(-1.2, 1.2);
      spec.vy = 1.5 + rng.next();
      spec.vz = rng.range(-1.2, 1.2);
      spec.gravity = -0.6;
      spec.size = r * 0.22;
      spec.growth = 2.2;
      spec.life = 1.2 + rng.next() * 0.5;
      setColor(0x6a6a6a, 0.5);
      emitParticle(rings.alpha, spec, clock);
    }
    for (let k = 0; k < 14; k++) {
      const speed = 5 + rng.next() * 4;
      cube(
        x,
        y + 0.15,
        z,
        rng.range(-1, 1) * speed,
        rng.range(0.4, 1) * speed,
        rng.range(-1, 1) * speed,
        EXPLOSION_CUBES[k % EXPLOSION_CUBES.length]!,
        0.06 + rng.next() * 0.06,
        1.6 + rng.next() * 0.8,
      );
    }
    explosionGround(x, y, z, r, frame);
  }

  /**
   * M12 (fase 5): a explosão com peso no chão: com chão sólido a até 0,6·raio embaixo, a marca chamuscada (0,7·raio de
   * diâmetro no anel de marcas, 20 s: a forma de mancha da tinta, com a borda em gotas, na cor do chão queimada; o
   * miolo preto da marca de tiro virava uma cruz de pixels de 35 cm) e um anel de poeira na cor do chão que corre para
   * fora.
   */
  function explosionGround(x: number, y: number, z: number, r: number, frame: FrameContext): void {
    const world = frame.world;
    if (!world) return;
    const rgb = groundColor(world, x, y + 0.2, z, Math.max(0.6, r * SCORCH_REACH_PER_RADIUS));
    if (rgb < 0) return;
    const ground = groundY;
    sample(world.lightGrid, x, ground + 0.4, z);
    resetParticleSpec(spec);
    lit();
    spec.kind = PARTICLE_KIND.paint;
    spec.x = x;
    spec.y = ground;
    spec.z = z;
    spec.x1 = 0;
    spec.y1 = 1;
    spec.z1 = 0;
    spec.size = Math.min(SCORCH_MAX_M, Math.max(SCORCH_MIN_M, r * SCORCH_SIZE_PER_RADIUS));
    spec.life = DECAL_LIFE_S;
    spec.rotation = rng.range(0, Math.PI * 2);
    // A cor do chão a 32% (o `jitterColor` com sorteio 0 escala por 1 − quanto).
    setColor(jitterColor(rgb, 1 - SCORCH_TONE, 0), 0.88);
    emitParticle(rings.decal, spec, clock);
    const dustRgb = lightenColor(rgb, 0.3);
    for (let k = 0; k < DUST_RING_PUFFS; k++) {
      const a = ((k + rng.next() * 0.5) / DUST_RING_PUFFS) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      resetParticleSpec(spec);
      lit();
      spec.kind = PARTICLE_KIND.round;
      spec.x = x + ca * r * 0.25;
      spec.y = ground + 0.2;
      spec.z = z + sa * r * 0.25;
      spec.vx = ca * r * (1 + rng.next() * 0.4);
      spec.vy = 0.3 + rng.next() * 0.3;
      spec.vz = sa * r * (1 + rng.next() * 0.4);
      spec.gravity = -0.2;
      spec.size = 0.45;
      spec.growth = 2.8;
      spec.life = 0.8 + rng.next() * 0.3;
      setColor(dustRgb, 0.5);
      emitParticle(rings.alpha, spec, clock);
    }
  }

  /** M2: rastro do foguete (uma fumacinha clara que cresce e sobe, e a chama colada na traseira). */
  /** M6 (fase 5): a bola de tinta em voo: um ponto da cor do time que dura um quadro e pouco. */
  function paintBall(o: number): void {
    const d = pending.data;
    resetParticleSpec(spec);
    spec.kind = PARTICLE_KIND.round;
    spec.x = d[o]!;
    spec.y = d[o + 1]!;
    spec.z = d[o + 2]!;
    spec.size = 0.11;
    spec.life = 0.045;
    setColor(d[o + 6]!, 1);
    emitParticle(rings.balls, spec, clock);
  }

  /** M6 (fase 5): a mancha de tinta (decal) na superfície; o anel dá a volta no teto da plataforma. */
  function paint(o: number, frame: FrameContext): void {
    const d = pending.data;
    const cap = d[o + 8]!;
    const limit = Math.max(1, Math.min(PAINT_RING_SIZE, Math.round(cap)));
    if (rings.paint.limit !== limit) {
      clearParticleRing(rings.paint);
      rings.paint.limit = limit;
    }
    // A luz do lugar da mancha (um pouco para fora da superfície).
    sample(
      frame.world?.lightGrid ?? null,
      d[o]! + d[o + 3]! * 0.1,
      d[o + 1]! + d[o + 4]! * 0.1,
      d[o + 2]! + d[o + 5]! * 0.1,
    );
    resetParticleSpec(spec);
    lit();
    spec.kind = PARTICLE_KIND.paint;
    spec.x = d[o]!;
    spec.y = d[o + 1]!;
    spec.z = d[o + 2]!;
    spec.x1 = d[o + 3]!;
    spec.y1 = d[o + 4]!;
    spec.z1 = d[o + 5]!;
    spec.size = d[o + 7]!;
    spec.life = PAINT_LIFE_S;
    spec.rotation = rng.range(0, Math.PI * 2);
    setColor(d[o + 6]!, 1);
    emitParticle(rings.paint, spec, clock);
  }

  function trail(o: number, frame: FrameContext): void {
    const d = pending.data;
    const bx = d[o]! - d[o + 3]! * 0.3;
    const by = d[o + 1]! - d[o + 4]! * 0.3;
    const bz = d[o + 2]! - d[o + 5]! * 0.3;
    sample(frame.world?.lightGrid ?? null, bx, by, bz);
    resetParticleSpec(spec);
    lit();
    spec.kind = PARTICLE_KIND.round;
    spec.x = bx;
    spec.y = by;
    spec.z = bz;
    spec.vx = rng.range(-0.3, 0.3);
    spec.vy = rng.range(0, 0.4);
    spec.vz = rng.range(-0.3, 0.3);
    spec.gravity = -0.3;
    spec.size = 0.12;
    spec.growth = 3.5;
    spec.life = 0.7;
    setColor(0xbfbfbf, 0.45);
    emitParticle(rings.alpha, spec, clock);
    resetParticleSpec(spec);
    spec.kind = PARTICLE_KIND.round;
    spec.x = bx;
    spec.y = by;
    spec.z = bz;
    spec.size = 0.2;
    spec.life = 0.05;
    setColor(0xffb347, 0.9);
    emitParticle(rings.additive, spec, clock);
  }

  function processQueue(frame: FrameContext): void {
    for (let i = 0; i < pending.count; i++) {
      const o = i * FX_STRIDE;
      switch (pending.kind[i]) {
        case FX_KIND.muzzleFlash:
          muzzleFlash(o);
          break;
        case FX_KIND.tracer:
          tracer(o);
          break;
        case FX_KIND.impactBlock:
          blockImpact(o, frame);
          break;
        case FX_KIND.impactActor:
          actorImpact(i, o, frame);
          break;
        case FX_KIND.impactProp:
          propImpact(o, frame);
          break;
        case FX_KIND.debris:
          explicitDebris(o, frame);
          break;
        case FX_KIND.death:
          death(o, frame);
          break;
        case FX_KIND.explosion:
          explosion(o, frame);
          break;
        case FX_KIND.trail:
          trail(o, frame);
          break;
        case FX_KIND.paintBall:
          paintBall(o);
          break;
        case FX_KIND.dust:
          dust(o, frame);
          break;
        case FX_KIND.paint:
          paint(o, frame);
          break;
        default:
          break;
      }
    }
    pending.count = 0;
  }

  function clearAll(): void {
    // M7 (fase 8, revisão): o anel da zona sai junto; a próxima chamada reescreve mesmo com o mesmo círculo.
    zoneKey.fill(NaN);
    clearDebris(debris);
    clearFigureCorpses(figureCorpses);
    for (const [ring] of ringMeshes) clearParticleRing(ring);
    pending.count = 0;
  }

  const allMeshes = (): InstancedMesh[] => [
    debrisMesh,
    figureCorpseMesh,
    ...ringMeshes.map(([, pm]) => pm.mesh),
    vmMesh.mesh,
  ];

  const pass: FxPass = {
    programs: 1,

    submit(queue) {
      if (disposed) return;
      // A fila é do `game` e é reaproveitada: copia (sem alocar) o que couber.
      const n = Math.min(queue.count, pending.capacity - pending.count);
      if (n <= 0) return;
      const base = pending.count;
      for (let i = 0; i < n; i++) {
        pending.kind[base + i] = queue.kind[i]!;
        pending.entity[base + i] = queue.entity[i]!;
      }
      const d0 = base * FX_STRIDE;
      for (let k = 0; k < n * FX_STRIDE; k++) pending.data[d0 + k] = queue.data[k]!;
      pending.count += n;
    },

    setMap(next) {
      if (disposed) return;
      map = next;
      // Troca de mapa: nada do mapa anterior sobrevive (regra 21).
      clearAll();
    },

    setZone(cx, cz, r) {
      if (disposed) return;
      // Raio inválido (NaN) vale como sem parede (e não reescreve o anel todo frame).
      if (!(r >= 0)) r = 0;
      if (Math.abs(cx - zoneKey[0]!) < 0.01 && Math.abs(cz - zoneKey[1]!) < 0.01 && Math.abs(r - zoneKey[2]!) < 0.01) {
        return;
      }
      zoneKey[0] = cx;
      zoneKey[1] = cz;
      zoneKey[2] = r;
      const ring = rings.zone;
      clearParticleRing(ring);
      if (!(r >= 0.25)) return;
      const n = ZONE_WALL_SEGMENTS;
      const half = (Math.PI * r) / n + 0.05;
      for (let k = 0; k < n; k++) {
        const a = ((k + 0.5) / n) * Math.PI * 2;
        resetParticleSpec(spec);
        spec.kind = PARTICLE_KIND.wall;
        spec.x = cx + Math.sin(a) * r;
        spec.y = ZONE_WALL_BOTTOM_M;
        spec.z = cz + Math.cos(a) * r;
        spec.size = half;
        // A altura no lugar da velocidade (`pB.x`); a tangente no lugar do fim do traçante (`pC`).
        spec.vx = ZONE_WALL_HEIGHT_M;
        spec.x1 = Math.cos(a);
        spec.y1 = 0;
        spec.z1 = -Math.sin(a);
        spec.r = 0.45;
        spec.g = 0.55;
        spec.b = 1;
        spec.a = 0.42;
        // Vive "para sempre" (o fade do shader nem começa): só some quando o círculo muda ou o modo acaba.
        spec.life = 1e7;
        emitParticle(ring, spec, clock);
      }
    },

    setDebrisBudget(maxDebris) {
      setDebrisBudget(debris, maxDebris);
    },

    setFigures(templates) {
      if (disposed) return;
      figureTemplates = templates;
    },

    update(frame) {
      if (disposed) return;
      const dt = Math.max(0, Math.min(0.1, frame.dt));
      clock += dt;
      pUniforms.uFxTime.value = clock;
      vmUniforms.uFxTime.value = clock;
      const world: CollisionWorld | null = frame.world;
      processQueue(frame);

      stepDebris(debris, dt, world);
      debrisMesh.count = debris.highWater;
      debrisMesh.visible = debris.highWater > 0;
      uploadRange(debrisSet.matrixAttribute, debrisSet.matrixRange, MAT4, 0, debris.highWater - 1);
      uploadRange(debrisSet.dataBuffer, debrisSet.dataRange, INSTANCE_FLOATS, debris.dataDirtyMin, debris.dataDirtyMax);
      debris.dataDirtyMin = -1;
      debris.dataDirtyMax = -1;

      stepFigureCorpses(figureCorpses, dt, world);
      figureCorpseMesh.count = figureCorpses.highWater;
      figureCorpseMesh.visible = figureCorpses.highWater > 0;
      uploadRange(figureCorpseSet.matrixAttribute, figureCorpseSet.matrixRange, MAT4, 0, figureCorpses.highWater - 1);
      uploadRange(
        figureCorpseSet.dataBuffer,
        figureCorpseSet.dataRange,
        INSTANCE_FLOATS,
        figureCorpses.dataDirtyMin,
        figureCorpses.dataDirtyMax,
      );
      figureCorpses.dataDirtyMin = -1;
      figureCorpses.dataDirtyMax = -1;

      for (let k = 0; k < ringMeshes.length; k++) {
        const ring = ringMeshes[k]![0];
        const pm = ringMeshes[k]![1];
        pm.mesh.count = ring.written;
        pm.mesh.visible = ring.written > 0 && clock < ring.aliveUntil;
        uploadRange(pm.buffer, pm.range, PARTICLE_FLOATS, ring.dirtyMin, ring.dirtyMax);
        markParticlesUploaded(ring);
      }
    },

    beforeView(v: ViewContext) {
      if (disposed) return;
      const view = v.view;
      pUniforms.uHideSlot.value = !view.thirdPerson && view.localSlot >= 0 ? view.localSlot : -1;
    },

    afterView(v: ViewContext) {
      if (disposed) return;
      const view = v.view;
      const slot = view.localSlot;
      if (view.thirdPerson || slot < 0 || slot > 3 || v.index > 3) return;
      if (v.debug.hideViewmodel || !view.viewmodel.visible || clock >= vmFlashUntil[slot]!) return;
      const camera = link.viewmodelCamera;
      const mz = link.viewmodelMuzzle;
      if (!camera || mz[v.index * 4 + 3]! < 0.5) return;
      // Estrela + brilho na boca do cano do viewmodel, por cima de tudo (sem teste de profundidade).
      clearParticleRing(vmRing);
      resetParticleSpec(spec);
      spec.kind = PARTICLE_KIND.star;
      spec.x = mz[v.index * 4]!;
      spec.y = mz[v.index * 4 + 1]!;
      spec.z = mz[v.index * 4 + 2]!;
      spec.size = 0.13 * Math.max(0.2, view.viewmodel.scale);
      spec.rotation = vmFlashRotation[slot]!;
      spec.life = 1;
      setColor(0xffdb73, 1);
      emitParticle(vmRing, spec, clock - 1e-3);
      spec.kind = PARTICLE_KIND.round;
      spec.size *= 2.2;
      setColor(0xffbf59, 0.4);
      emitParticle(vmRing, spec, clock - 1e-3);
      vmMesh.mesh.count = vmRing.written;
      vmMesh.mesh.visible = true;
      uploadRange(vmMesh.buffer, vmMesh.range, PARTICLE_FLOATS, 0, vmRing.written - 1);
      markParticlesUploaded(vmRing);
      const three = ctx.three;
      const autoClear = three.autoClear;
      three.autoClear = false;
      three.render(vmScene, camera);
      three.autoClear = autoClear;
      vmMesh.mesh.visible = false;
    },

    warmDraw(camera) {
      if (disposed) return () => undefined;
      const meshes = allMeshes();
      const undo = showForWarmDraw(meshes);
      // M12 (fase 5): os gêmeos de 1 instância válida (o clarão do viewmodel também: o estado sem profundidade dele).
      const twins = camera ? createWarmTwins(meshes, camera, root, clock) : null;
      const three = ctx.three;
      const autoClear = three.autoClear;
      three.autoClear = false;
      three.render(vmScene, warmCamera);
      three.autoClear = autoClear;
      return () => {
        twins?.dispose();
        undo();
      };
    },

    warmup() {
      if (disposed) return;
      const meshes = allMeshes();
      const saved = meshes.map((m) => m.visible);
      for (const m of meshes) m.visible = true;
      ctx.three.compile(ctx.scene, warmCamera);
      ctx.three.compile(vmScene, warmCamera);
      meshes.forEach((m, k) => (m.visible = saved[k] ?? false));
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      figureTemplates = null;
      for (const m of allMeshes()) {
        m.removeFromParent();
        m.geometry.dispose();
      }
      root.removeFromParent();
      for (const mat of [material, additive, alpha, decal, vmFlash]) mat.dispose();
    },
  };
  return pass;
}

/**
 * M4 (fase 5b): as `meshes` com espaço para instância ficam visíveis, sem corte por frustum e com 1 instância (os dados
 * zerados desenham um ponto degenerado no pixel do canto); devolve quem desfaz.
 */
function showForWarmDraw(all: readonly InstancedMesh[]): () => void {
  const meshes = all.filter((m) => m.instanceMatrix.count >= 1);
  const saved = meshes.map((m) => [m.visible, m.frustumCulled, m.count] as const);
  for (const m of meshes) {
    m.visible = true;
    m.frustumCulled = false;
    m.count = 1;
  }
  return () => {
    meshes.forEach((m, k) => {
      const s = saved[k]!;
      m.visible = s[0];
      m.frustumCulled = s[1];
      m.count = s[2];
    });
  };
}
