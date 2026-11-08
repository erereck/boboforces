import { describe, expect, it } from 'vitest';
import { BLOCK_FLAG, createBlockRegistry, FACE, type BlockDefInput } from './blocks.ts';
import { makeCell } from './cell.ts';
import { COLLIDER_FLAG, createStaticColliders, type StaticColliders } from './colliders.ts';
import { createWorldGrid, type WorldGrid } from './grid.ts';
import { NORMAL, rampNormalIndex } from './mesh/vertex.ts';
import {
  boxIntersectsSolid,
  boxIntersectsWorld,
  createAabb,
  createRayHit,
  createSweepResult,
  isCellSolid,
  raycastGrid,
  sweepAabb,
  type Aabb,
} from './query.ts';
import type { BlockShape } from './shapes.ts';

const SOLID = BLOCK_FLAG.solid | BLOCK_FLAG.blocksBullets | BLOCK_FLAG.blocksSight | BLOCK_FLAG.walkable;
const def = (key: string, shape: BlockShape, flags = SOLID): BlockDefInput => ({
  key,
  shape,
  faces: [0, 0, 0, 0, 0, 0],
  flags,
  frames: 1,
  stepSound: '',
});

// ids: 1 concreto, 2 laje, 3 degrau, 4 rampa 1:1, 5 rampa 1:2 baixa, 6 rampa 1:2 alta, 7 painel, 8 poste + travessa,
// 9 cruz (sólida no flag, mas sem colisão), 10 painel que só bloqueia visão, 11 cruz que bloqueia visão.
const registry = createBlockRegistry([
  def('concrete', 'cube'),
  def('slab', 'slab'),
  def('step', 'step'),
  def('ramp', 'ramp'),
  def('ramp-low', 'rampHalfLow'),
  def('ramp-high', 'rampHalfHigh'),
  def('panel', 'panel'),
  def('rail', 'postRail'),
  def('grass', 'cross', BLOCK_FLAG.solid),
  def('screen', 'panel', BLOCK_FLAG.solid | BLOCK_FLAG.blocksSight),
  def('bush', 'cross', BLOCK_FLAG.blocksSight),
]);
const CONCRETE = makeCell(1);

/** Chão de 24 × 24 células com o topo em 0,5 m. */
function floor(): WorldGrid {
  const g = createWorldGrid(24, 16, 24);
  for (let z = 0; z < 24; z++) for (let x = 0; x < 24; x++) g.set(x, 0, z, CONCRETE);
  return g;
}

function bobo(x: number, y: number, z: number, height = 1.5): Aabb {
  const b = createAabb();
  b.minX = x - 0.3;
  b.maxX = x + 0.3;
  b.minY = y;
  b.maxY = y + height;
  b.minZ = z - 0.3;
  b.maxZ = z + 0.3;
  return b;
}

/** Gravidade de um tick a 60 Hz com o bobo no chão (a sim passa isso todo tick). */
const GROUND_DY = -0.5 * 20 * (1 / 60) ** 2;

describe('colisão com formas', () => {
  it('pousa em cima da laje e sobe nela pelo degrau automático', () => {
    const g = floor();
    for (let z = 0; z < 24; z++) g.set(10, 1, z, makeCell(2));
    const out = createSweepResult();
    const fall = bobo(5.25, 3, 5);
    sweepAabb(g, registry, fall, 0, -5, 0, 0, out);
    expect(fall.minY).toBeCloseTo(0.75, 9);
    expect(out.onGround).toBe(true);
    // Andando do chão para a laje: sobe 0,25 m e marca degrau.
    const walk = bobo(4.65, 0.5, 5);
    sweepAabb(g, registry, walk, 0.1, GROUND_DY, 0, 0.5, out);
    expect(out.stepped).toBe(true);
    expect(walk.minY).toBeCloseTo(0.75, 9);
    // Laje invertida (metade de cima): sem degrau, o bobo em pé bate nela; com degrau, é um degrau de 0,5 m.
    const g2 = floor();
    for (let z = 0; z < 24; z++) g2.set(10, 1, z, makeCell(2, 0, true));
    const box = bobo(4.65, 0.5, 5);
    sweepAabb(g2, registry, box, 0.1, GROUND_DY, 0, 0, out);
    expect(out.hitX).toBe(true);
    expect(box.maxX).toBeCloseTo(5, 9);
    sweepAabb(g2, registry, box, 0.1, GROUND_DY, 0, 0.5, out);
    expect(out.stepped).toBe(true);
    expect(box.minY).toBeCloseTo(1, 9);
  });

  it('sobe a rampa 1:1 liso (sem "stepped") e desce colado no plano', () => {
    const g = floor();
    // Rampa subindo para +X (giro 3: o alto canônico em -Z vai para +X) e plataforma de cubos depois.
    for (let z = 0; z < 24; z++) {
      g.set(10, 1, z, makeCell(4, 3));
      for (let x = 11; x < 16; x++) g.set(x, 1, z, CONCRETE);
    }
    const out = createSweepResult();
    const box = bobo(4, 0.5, 5);
    let lastY = box.minY;
    let maxRise = 0;
    for (let tick = 0; tick < 40; tick++) {
      sweepAabb(g, registry, box, 0.08, GROUND_DY, 0, 0.5, out);
      expect(out.onGround).toBe(true);
      expect(out.stepped).toBe(false);
      expect(out.hitX).toBe(false);
      maxRise = Math.max(maxRise, box.minY - lastY);
      lastY = box.minY;
    }
    expect(box.minY).toBeCloseTo(1, 9);
    expect(maxRise).toBeLessThanOrEqual(0.08 + 1e-6);
    // No meio da rampa, a altura é a do plano sob a borda da frente.
    const mid = bobo(4.6, 0.5, 5);
    for (let tick = 0; tick < 10; tick++) sweepAabb(g, registry, mid, 0.04, GROUND_DY, 0, 0.5, out);
    expect(mid.maxX).toBeCloseTo(5.3, 9);
    expect(mid.minY).toBeCloseTo(0.8, 6);
    // Caixa um pouco afundada no plano (1 cm) sai dele ao andar.
    const sunk = bobo(4.71, 0.5, 5);
    sweepAabb(g, registry, sunk, 0.04, GROUND_DY, 0, 0.5, out);
    expect(sunk.minY).toBeCloseTo(0.5 + (sunk.maxX - 5), 6);
    // Descendo: fica no chão todo tick (sem "voar" e sem degrau).
    for (let tick = 0; tick < 40; tick++) {
      sweepAabb(g, registry, box, -0.08, GROUND_DY, 0, 0.5, out);
      expect(out.onGround).toBe(true);
      expect(out.stepped).toBe(false);
      expect(boxIntersectsSolid(g, registry, box)).toBe(false);
      const support = createAabb();
      Object.assign(support, box);
      support.minY -= 0.01;
      expect(boxIntersectsSolid(g, registry, support)).toBe(true);
    }
    expect(box.minY).toBeCloseTo(0.5, 9);
  });

  it('rampa 1:2 (baixa + alta) e a lateral da rampa vale como parede de degrau', () => {
    const g = floor();
    for (let z = 0; z < 24; z++) {
      g.set(10, 1, z, makeCell(5, 3));
      g.set(11, 1, z, makeCell(6, 3));
      for (let x = 12; x < 16; x++) g.set(x, 1, z, CONCRETE);
    }
    const out = createSweepResult();
    const box = bobo(4, 0.5, 5);
    for (let tick = 0; tick < 50; tick++) {
      sweepAabb(g, registry, box, 0.06, GROUND_DY, 0, 0.5, out);
      expect(out.stepped).toBe(false);
    }
    expect(box.minY).toBeCloseTo(1, 9);
    // Chegando pela lateral (andando em Z contra a rampa alta): é parede de 0,5 m → degrau automático.
    const side = bobo(5.75, 0.5, 2);
    const g2 = floor();
    for (let x = 0; x < 24; x++) g2.set(x, 1, 6, makeCell(4, 0));
    sweepAabb(g2, registry, side, 0, GROUND_DY, 0.1, 0, out);
    expect(out.hitZ).toBe(false); // ainda não chegou
    const near = bobo(5.75, 0.5, 2.65);
    sweepAabb(g2, registry, near, 0, GROUND_DY, 0.1, 0, out);
    // Rampa giro 0 sobe para -Z: chegando de -Z, a face de trás (alta) barra.
    expect(out.hitZ).toBe(true);
    expect(near.maxZ).toBeCloseTo(3, 9);
  });

  it('degrau (forma) se sobe em dois passos de 0,25 m', () => {
    const g = floor();
    // Degrau canônico: alto em -Z. Andando para -Z chega pela frente baixa; atrás dele, plataforma da mesma altura.
    for (let x = 0; x < 24; x++) {
      g.set(x, 1, 10, makeCell(3));
      for (let z = 4; z < 10; z++) g.set(x, 1, z, CONCRETE);
    }
    const out = createSweepResult();
    const box = bobo(5, 0.5, 6);
    let stepped = 0;
    for (let tick = 0; tick < 30; tick++) {
      sweepAabb(g, registry, box, 0, GROUND_DY, -0.08, 0.5, out);
      if (out.stepped) stepped++;
    }
    expect(stepped).toBeGreaterThanOrEqual(1);
    expect(box.minY).toBeCloseTo(1, 9);
  });

  it('painel e poste + travessa bloqueiam (sem degrau por cima); cruz não colide', () => {
    const out = createSweepResult();
    for (const block of [7, 8]) {
      const g = floor();
      for (let x = 0; x < 24; x++) g.set(x, 1, 10, makeCell(block));
      const box = bobo(5, 0.5, 4.5);
      for (let tick = 0; tick < 20; tick++) sweepAabb(g, registry, box, 0, GROUND_DY, 0.1, 0.5, out);
      expect(out.hitZ).toBe(true);
      expect(box.minY).toBe(0.5);
      // Painel: caixa fina z ∈ [7, 9]/16 da célula; poste + travessa: [6, 10]/16.
      expect(box.maxZ).toBeCloseTo(5 + (block === 7 ? 7 : 6) / 32, 9);
      // Girado (giro 1), o painel corre ao longo de Z e deixa passar quem anda em Z ao lado dele.
      const g2 = floor();
      for (let z = 0; z < 24; z++) g2.set(10, 1, z, makeCell(block, 1));
      const along = bobo(4.5, 0.5, 2);
      sweepAabb(g2, registry, along, 0, GROUND_DY, 3, 0.5, out);
      expect(out.hitZ).toBe(false);
    }
    const g = floor();
    for (let x = 0; x < 24; x++) g.set(x, 1, 10, makeCell(9));
    const box = bobo(5, 0.5, 4.5);
    sweepAabb(g, registry, box, 0, GROUND_DY, 2, 0.5, out);
    expect(out.hitZ).toBe(false);
    expect(isCellSolid(g, registry, 5, 1, 10)).toBe(false);
    expect(isCellSolid(g, registry, 5, 0, 10)).toBe(true);
  });

  it('boxIntersectsSolid respeita a forma (laje: só a metade de baixo)', () => {
    const g = floor();
    g.set(10, 1, 10, makeCell(2));
    expect(boxIntersectsSolid(g, registry, bobo(5.25, 0.75, 5.25))).toBe(false);
    expect(boxIntersectsSolid(g, registry, bobo(5.25, 0.7, 5.25))).toBe(true);
    g.set(10, 1, 12, makeCell(4)); // rampa: piso 1 − z
    expect(boxIntersectsSolid(g, registry, bobo(5.25, 1.01, 6.25))).toBe(false);
    expect(boxIntersectsSolid(g, registry, bobo(5.25, 0.8, 6.25))).toBe(true);
  });
});

function props(boxes: number[][], flags: number[]): StaticColliders {
  return createStaticColliders({
    boxes: Float32Array.from(boxes.flat()),
    flags: Uint8Array.from(flags),
    owner: Int32Array.from(boxes.map((_, i) => i)),
    count: boxes.length,
  });
}

describe('colisores de props', () => {
  it('hash: consulta em ordem, sem repetir caixa que atravessa células, e para quando pedem', () => {
    const c = props(
      [
        [0, 0, 0, 1, 1, 1],
        [3, 0, 3, 9, 1, 9], // atravessa várias células de 4 m
        [20, 0, 20, 21, 1, 21],
      ],
      [1, 1, 1],
    );
    const seen: number[] = [];
    c.query(-1, -1, -1, 10, 2, 10, (i) => (seen.push(i), true));
    expect(seen).toEqual([0, 1]);
    const first: number[] = [];
    c.query(-100, -100, -100, 100, 100, 100, (i) => (first.push(i), false));
    expect(first).toHaveLength(1);
    expect(
      createStaticColliders({
        boxes: new Float32Array(0),
        flags: new Uint8Array(0),
        owner: new Int32Array(0),
        count: 0,
      }).count,
    ).toBe(0);
  });

  it('caixa de prop bloqueia; andável dá degrau, não andável não', () => {
    const g = floor();
    const out = createSweepResult();
    for (const walkable of [true, false]) {
      const c = props([[5, 0.5, 0, 6, 1, 12]], [COLLIDER_FLAG.solid | (walkable ? COLLIDER_FLAG.walkable : 0)]);
      const box = bobo(4.65, 0.5, 5);
      sweepAabb(g, registry, box, 0.1, GROUND_DY, 0, 0.5, out, c);
      expect(out.stepped).toBe(walkable);
      expect(box.minY).toBeCloseTo(walkable ? 1 : 0.5, 6);
      if (!walkable) expect(box.maxX).toBeCloseTo(5, 6);
      expect(boxIntersectsWorld(g, registry, bobo(5.2, 0.5, 5), c)).toBe(true);
      expect(boxIntersectsSolid(g, registry, bobo(5.2, 0.5, 5))).toBe(false);
    }
    // Sem a flag solid, não colide.
    const ghost = props([[5, 0.5, 0, 6, 1, 12]], [COLLIDER_FLAG.blocksBullets]);
    const box = bobo(4.65, 0.5, 5);
    sweepAabb(g, registry, box, 0.1, GROUND_DY, 0, 0.5, out, ghost);
    expect(out.hitX).toBe(false);
  });
});

describe('raio contra formas', () => {
  const hit = createRayHit();
  const BUL = BLOCK_FLAG.blocksBullets;

  it('laje: acerta o topo a meia célula; por cima passa', () => {
    const g = floor();
    g.set(10, 1, 10, makeCell(2));
    expect(raycastGrid(g, registry, 5.2, 3, 5.2, 0, -1, 0, 10, BUL, hit)).toBe(true);
    expect(hit.y).toBeCloseTo(0.75, 9);
    expect(hit.face).toBe(FACE.py);
    expect([hit.cellX, hit.cellY, hit.cellZ]).toEqual([10, 1, 10]);
    expect(raycastGrid(g, registry, 3, 0.9, 5.2, 1, 0, 0, 10, BUL, hit)).toBe(false);
    expect(raycastGrid(g, registry, 3, 0.6, 5.2, 1, 0, 0, 10, BUL, hit)).toBe(true);
    expect(hit.x).toBeCloseTo(5, 9);
    expect(hit.face).toBe(FACE.nx);
  });

  it('rampa: acerta o plano com a normal da tabela; invertida: o teto inclinado', () => {
    const g = floor();
    g.set(10, 1, 10, makeCell(4, 3)); // sobe para +X
    expect(raycastGrid(g, registry, 5.1, 3, 5.25, 0, -1, 0, 10, BUL, hit)).toBe(true);
    // Piso 0,5 + (x − 5) no giro 3.
    expect(hit.y).toBeCloseTo(0.6, 6);
    expect(hit.face).toBe(rampNormalIndex(1, 3, false));
    expect(hit.normalX).toBeLessThan(0);
    expect(hit.normalY).toBeGreaterThan(0);
    g.set(10, 6, 10, makeCell(4, 3, true));
    expect(raycastGrid(g, registry, 5.1, 2, 5.25, 0, 1, 0, 10, BUL, hit)).toBe(true);
    // Teto: espelho do piso: y = 3 + 0,5 − (x − 5) = 3,4.
    expect(hit.y).toBeCloseTo(3.4, 6);
    expect(hit.face).toBe(rampNormalIndex(1, 3, true));
    expect(hit.normalY).toBeLessThan(0);
  });

  it('painel fino, vão do poste + travessa e máscara bloqueia-visão', () => {
    const g = floor();
    g.set(10, 1, 10, makeCell(7)); // painel ao longo de X, z ∈ [5,109; 5,141]
    expect(raycastGrid(g, registry, 5.25, 0.75, 3, 0, 0, 1, 10, BUL, hit)).toBe(true);
    expect(hit.z).toBeCloseTo(5 + 7 / 32, 9);
    expect(hit.face).toBe(FACE.nz);
    // Ao longo de X fora da espessura: passa.
    expect(raycastGrid(g, registry, 3, 0.75, 5.05, 1, 0, 0, 10, BUL, hit)).toBe(false);
    // Poste + travessa: no vão entre as travessas (y 7..11/16 da célula) e fora do poste, a bala passa.
    const g2 = floor();
    g2.set(10, 1, 10, makeCell(8));
    const yGap = 0.5 + 9 / 32;
    expect(raycastGrid(g2, registry, 5.05, yGap, 3, 0, 0, 1, 10, BUL, hit)).toBe(false);
    expect(raycastGrid(g2, registry, 5.05, 0.5 + 5 / 32, 3, 0, 0, 1, 10, BUL, hit)).toBe(true);
    expect(raycastGrid(g2, registry, 5.25, yGap, 3, 0, 0, 1, 10, BUL, hit)).toBe(true); // poste
    // Tela (só bloqueia visão) e arbusto em cruz.
    const g3 = floor();
    g3.set(10, 1, 10, makeCell(10));
    g3.set(14, 1, 10, makeCell(11));
    expect(raycastGrid(g3, registry, 5.25, 0.75, 3, 0, 0, 1, 10, BUL, hit)).toBe(false);
    expect(raycastGrid(g3, registry, 5.25, 0.75, 3, 0, 0, 1, 10, BLOCK_FLAG.blocksSight, hit)).toBe(true);
    expect(raycastGrid(g3, registry, 7.1, 0.75, 3, 0, 0, 1, 10, BLOCK_FLAG.blocksSight, hit)).toBe(true);
    expect(hit.face).toBeGreaterThanOrEqual(NORMAL.cross);
    expect(hit.face).toBeLessThan(NORMAL.cross + 4);
    expect(hit.normalZ).toBeLessThan(0); // virada para quem atira
    // Grama (cruz sem bloqueia-visão): passa.
    const g4 = floor();
    g4.set(10, 1, 10, makeCell(9));
    expect(raycastGrid(g4, registry, 5.1, 0.75, 3, 0, 0, 1, 10, BLOCK_FLAG.blocksSight | BUL, hit)).toBe(false);
  });

  it('origem dentro da forma acerta na distância 0; fora da parte sólida, não', () => {
    const g = floor();
    g.set(10, 1, 10, makeCell(2));
    expect(raycastGrid(g, registry, 5.25, 0.6, 5.25, 1, 0, 0, 5, BUL, hit)).toBe(true);
    expect(hit.distance).toBe(0);
    expect(hit.face).toBe(-1);
    expect(raycastGrid(g, registry, 5.25, 0.9, 5.25, 1, 0, 0, 5, BUL, hit)).toBe(false);
  });

  it('props: a mais perto ganha da parede; origem dentro da prop é ignorada; máscara mapeada', () => {
    const g = floor();
    for (let z = 0; z < 24; z++) for (let y = 1; y < 6; y++) g.set(16, y, z, CONCRETE);
    const c = props(
      [
        [5, 0.5, 4, 6, 2, 6],
        [1, 0.5, 4, 2, 2, 6],
      ],
      [COLLIDER_FLAG.solid | COLLIDER_FLAG.blocksBullets, COLLIDER_FLAG.blocksSight],
    );
    expect(raycastGrid(g, registry, 0.5, 1, 5, 1, 0, 0, 20, BUL, hit, c)).toBe(true);
    expect(hit.prop).toBe(0);
    expect(hit.x).toBeCloseTo(5, 6);
    expect(hit.face).toBe(-1);
    expect(hit.normalX).toBe(-1);
    // Visão: a caixa 1 bloqueia visão.
    expect(raycastGrid(g, registry, 0.5, 1, 5, 1, 0, 0, 20, BLOCK_FLAG.blocksSight, hit, c)).toBe(true);
    expect(hit.prop).toBe(1);
    // De dentro da caixa 0, atirando para +X: ignora a 0 e acerta a parede.
    expect(raycastGrid(g, registry, 5.5, 1, 5, 1, 0, 0, 20, BUL, hit, c)).toBe(true);
    expect(hit.prop).toBe(-1);
    expect(hit.x).toBeCloseTo(8, 9);
    // Sem colisores: como o M0.
    expect(raycastGrid(g, registry, 0.5, 1, 5, 1, 0, 0, 20, BUL, hit)).toBe(true);
    expect(hit.x).toBeCloseTo(8, 9);
  });

  it('não aloca no laço quente: muitas consultas seguidas dão o mesmo resultado', () => {
    const g = floor();
    g.set(10, 1, 10, makeCell(4, 1));
    const a = createRayHit();
    raycastGrid(g, registry, 5.2, 3, 5.2, 0, -1, 0, 10, BUL, a);
    for (let i = 0; i < 1000; i++) raycastGrid(g, registry, 5.2, 3, 5.2, 0, -1, 0, 10, BUL, hit);
    expect(hit).toEqual(a);
  });
});
