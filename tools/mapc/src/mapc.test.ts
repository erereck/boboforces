import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  decodeMap,
  decodePng,
  encodeMap,
  FIGURE_BODY_BOXES,
  FIGURE_BONE,
  FIGURE_BONES,
  FIGURE_BOX_FIELD,
  FIGURE_BOX_STRIDE,
  FIGURE_CROUCH_POSE,
  FIGURE_CROUCH_TOP_M,
  FIGURE_HEAD_HALF_M,
  FIGURE_HIT_FIELD,
  FIGURE_HIT_STRIDE,
  FIGURE_MAX_TOP_M,
  FIGURE_PITCH_SAMPLES,
  FIGURE_POSTURES,
  FIGURE_REST_POSE,
  FIGURE_SLIDE_POSE,
  figureFk,
  figureRoot,
  MAP_CELL_RESERVED_MASK,
  MAP_CHUNK_SIZE,
  MAP_MAX_GRID_XZ,
  MAP_MAX_GRID_Y,
  OPTIONAL_MANNEQUINS,
  OPTIONAL_PRINT_CAMERAS,
  PRINT_CAMERAS,
  REQUIRED_BENCH_ROUTES,
  REQUIRED_MANNEQUINS,
  type MapCamera,
  type MapMannequin,
} from '@boboforces/format';
import { ARM_HIT_CUT_M, METRICS } from '@boboforces/sim';
import {
  BLOCK_SIZE,
  cellBlock,
  cellRotation,
  CELL_RESERVED_MASK,
  CHUNK_SIZE,
  createBlockRegistry,
  createWorldGrid,
  MAX_GRID_SIZE_XZ,
  MAX_GRID_SIZE_Y,
} from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import construto, { HEIGHT_RULER } from '../../../assets-src/maps/construto.ts';
import type { MapBuilder, MapScript } from './api.ts';
import { loadBlockTable } from './blocks.ts';
import { createMapBuilder } from './builder.ts';
import { HIGH_COVER_BAND, LOW_COVER_BAND, STAND_CELLS } from './checks.ts';
import { compileMap, MAX_BFMAP_BYTES, type CompileOptions } from './compile.ts';
import {
  figureLimbProbes,
  LIMB_BIN_M,
  limbProbeFromTable,
  type LimbProbe,
  type LimbProbes,
  type LimbTip,
} from './limb-probe.ts';
import { loadModelTable } from './models.ts';
import { MAP_IDS, MAPS_OUT_DIR, ROOT } from './paths.ts';
import { buildSightGrid, lineOfSight } from './sight.ts';
import { renderTopView } from './topview.ts';

// Tabelas reais (ou a reserva, com aviso) — as mesmas que o `npm run mapc` usa.
const OPTIONS: CompileOptions = { blocks: loadBlockTable(), models: loadModelTable() };

/** Quinas (metros do mundo) das caixas do corpo do boneco na pose (ou só as do osso `bone`), com a raiz do manequim. */
function figureCorners(
  pose: Float32Array,
  q: Pick<MapMannequin, 'x' | 'y' | 'z' | 'yaw'>,
  bone = -1,
): [number, number, number][] {
  const root = new Float32Array(16);
  figureRoot(root, 0, q.x, q.y, q.z, q.yaw, 1, 0);
  const bones = new Float32Array(FIGURE_BONES * 16);
  figureFk(pose, 0, root, 0, bones, 0);
  const F = FIGURE_BOX_FIELD;
  const out: [number, number, number][] = [];
  for (let i = 0; i < FIGURE_BODY_BOXES.length / FIGURE_BOX_STRIDE; i++) {
    const b = FIGURE_BODY_BOXES.subarray(i * FIGURE_BOX_STRIDE, (i + 1) * FIGURE_BOX_STRIDE);
    if (bone >= 0 && b[F.bone] !== bone) continue;
    const o = b[F.bone]! * 16;
    for (const sx of [-0.5, 0.5]) {
      for (const sy of [-0.5, 0.5]) {
        for (const sz of [-0.5, 0.5]) {
          const [x, y, z] = [b[F.cx]! + sx * b[F.sx]!, b[F.cy]! + sy * b[F.sy]!, b[F.cz]! + sz * b[F.sz]!];
          const p = [0, 1, 2].map((k) => bones[o + k]! * x + bones[o + 4 + k]! * y + bones[o + 8 + k]! * z);
          out.push([p[0]! + bones[o + 12]!, p[1]! + bones[o + 13]!, p[2]! + bones[o + 14]!]);
        }
      }
    }
  }
  return out;
}

/**
 * Onde o ponto cai no quadro de 16:9 da câmera (FOV vertical fixo, ou o padrão do PC: 90° na horizontal): a menor
 * folga até a borda, em fração da meia largura/altura (> 0 = dentro). −Infinity atrás da câmera.
 */
function frameMargin(c: MapCamera, x: number, y: number, z: number): number {
  const tanV = c.fovYDeg > 0 ? Math.tan((c.fovYDeg * Math.PI) / 360) : 1 / (16 / 9);
  const tanH = tanV * (16 / 9);
  const [sy, cy, sp, cp] = [Math.sin(c.yaw), Math.cos(c.yaw), Math.sin(c.pitch), Math.cos(c.pitch)];
  const [dx, dy, dz] = [x - c.x, y - c.y, z - c.z];
  const ahead = -sy * cp * dx + sp * dy - cy * cp * dz;
  if (ahead <= 0) return -Infinity;
  const side = (cy * dx - sy * dz) / ahead;
  const rise = (sy * sp * dx + cp * dy + cy * sp * dz) / ahead;
  return Math.min(1 - Math.abs(side) / tanH, 1 - Math.abs(rise) / tanV);
}

/** Caixa (x, z) das quinas: o que o boneco ocupa no chão. */
function footprint(corners: readonly (readonly [number, number, number])[]): [number, number, number, number] {
  const xs = corners.map((p) => p[0]);
  const zs = corners.map((p) => p[2]);
  return [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
}

/** Mapa sintético de 16 × 8 × 16 m: chão, paredes de 3 m em volta e o que `extra` acrescentar. */
function arena(extra: (b: MapBuilder) => void, sight = 25): MapScript {
  return {
    id: 'ringue',
    build(b) {
      b.size(32, 16, 32);
      b.meta({
        nameKey: 'map.teste.name',
        modes: ['training'],
        players: { min: 1, ideal: 2, max: 4 },
        maxSightLineM: sight,
        botCaps: {},
      });
      b.playArea(0.5, 0.5, 15.5, 15.5, -10);
      b.sun(0, 1, 0, 'day');
      b.box(0, 0, 0, 31, 0, 31, 'concrete');
      b.walls(0, 1, 0, 31, 6, 31, 'test-wall');
      b.spawn({ x: 2.5, y: 0.5, z: 2.5, yaw: 0, team: -1 });
      b.spawn({ x: 13.5, y: 0.5, z: 13.5, yaw: 0, team: -1 });
      extra(b);
    },
  };
}

describe('mapc: caminhos e nomes', () => {
  it('saídas cadastradas e nomes de câmera/rota do contrato', () => {
    const table = JSON.parse(readFileSync(join(ROOT, 'assets-src', 'runtime-assets.json'), 'utf8')) as {
      files: Record<string, string>;
    };
    for (const id of MAP_IDS) expect(table.files[`maps/${id}.bfmap`]).toBe(`maps/generated/${id}.bfmap`);
    expect(PRINT_CAMERAS).toContain('print:dia');
    expect(REQUIRED_BENCH_ROUTES).toEqual(['bench:volta']);
  });

  it('os tetos do format espelham os do world', () => {
    expect(MAP_MAX_GRID_XZ).toBe(MAX_GRID_SIZE_XZ);
    expect(MAP_MAX_GRID_Y).toBe(MAX_GRID_SIZE_Y);
    expect(MAP_CHUNK_SIZE).toBe(CHUNK_SIZE);
    expect(MAP_CELL_RESERVED_MASK).toBe(CELL_RESERVED_MASK);
  });
});

describe('mapc: builder', () => {
  it('rampa 1:2, escada, cerca, porta e tabela compacta', () => {
    const h = createMapBuilder('teste');
    const b = h.builder;
    b.size(16, 16, 16);
    b.box(0, 0, 0, 15, 0, 15, 'concrete');
    b.set(5, 5, 5, 'crate');
    b.set(5, 5, 5, null); // o caixote some: sai da tabela
    const top = b.ramp(2, 1, 2, 3, 9, { solid: 'concrete', halfLow: 'lo', halfHigh: 'hi' }, '-z', '1:2');
    expect(top).toBe(1 + 4);
    b.stairs(8, 1, 2, 9, 5, { solid: 'concrete', step: 'degrau' }, '+x');
    b.fence(12, 1, 2, 12, 6, 'cerca');
    b.walls(0, 1, 10, 6, 4, 12, 'test-wall');
    b.door(2, 1, 10, 'x');
    b.meta({
      nameKey: 'k',
      modes: ['training'],
      players: { min: 1, ideal: 1, max: 1 },
      maxSightLineM: 10,
      botCaps: {},
    });
    b.playArea(0, 0, 8, 8, -5);
    b.sun(1, 1, 0, 'day');
    const built = h.finish();
    expect(built.errors).toEqual([]);
    expect(built.doc.blocks).not.toContain('crate');
    const key = (x: number, y: number, z: number): string | null => {
      const cell = built.grid.get(x, y, z);
      return cell === 0 ? null : built.doc.blocks[cellBlock(cell)]!;
    };
    // Rampa subindo para -Z: o pé (z = 9) é meia baixa no nível 1; o alto (z = 2) é meia alta no nível 4 com apoio.
    expect(key(2, 1, 9)).toBe('lo');
    expect(key(2, 1, 8)).toBe('hi');
    expect(key(2, 4, 2)).toBe('hi');
    expect(key(2, 3, 2)).toBe('concrete');
    expect(cellRotation(built.grid.get(2, 4, 2))).toBe(0);
    // Escada subindo para +X: giro 3.
    expect(key(9, 2, 2)).toBe('degrau');
    expect(cellRotation(built.grid.get(9, 2, 2))).toBe(3);
    // Cerca ao longo de Z: giro 1.
    expect(cellRotation(built.grid.get(12, 1, 4))).toBe(1);
    // Porta: 2 × 4 células abertas na parede z = 10.
    expect(key(2, 1, 10)).toBeNull();
    expect(key(3, 4, 10)).toBeNull();
    expect(key(4, 1, 10)).toBe('test-wall');
    expect(built.doors).toHaveLength(1);
    expect(built.shapeNeeds.get('degrau')).toEqual(new Set(['step']));
    expect(built.shapeNeeds.get('lo')).toEqual(new Set(['rampHalfLow']));
  });

  it('prop: metros → texels, giro em 1/256 de volta e escala em 1/16', () => {
    const h = createMapBuilder('teste');
    h.builder.size(8, 8, 8);
    h.builder.prop('barrel', 1.5, 0.5, 2, Math.PI / 2, 1.25, 2);
    const p = h.finish().doc.props[0]!;
    expect(p).toEqual({ model: 'barrel', x: 48, y: 16, z: 64, yaw: 64, scale: 20, dose: 2 });
  });
});

describe('mapc: validações com o mundo', () => {
  it('arena simples passa; linha de visão medida confere com a declarada', () => {
    const r = compileMap(
      arena(() => {}),
      OPTIONS,
    );
    expect(r.errors).toEqual([]);
    // Paredes nas células 0 e 31: nós com centro de 1,5 a 14,5 m, diagonal de 13 m nos dois eixos.
    expect(r.checks.sight.max!.distance).toBeCloseTo(Math.hypot(13, 13), 5);
    const tight = compileMap(
      arena(() => {}, 15),
      OPTIONS,
    );
    expect(tight.errors.some((e) => e.includes('MEDIDA'))).toBe(true);
    // Duas compilações com as sondas do braço e do deslize (#56): passa de 5 s com a máquina carregada.
  }, 30000);

  it('acusa porta desalinhada, fresta de 0,5 m e spawn inimigo visível', () => {
    const r = compileMap(
      arena((b) => {
        // Parede no meio com porta em x ímpar.
        b.box(1, 1, 16, 30, 6, 16, 'concrete');
        b.door(7, 1, 16, 'x');
        // Fresta de 1 célula entre dois blocos altos.
        b.box(20, 1, 4, 20, 4, 8, 'concrete');
        b.box(22, 1, 4, 22, 4, 8, 'concrete');
        b.meta({
          nameKey: 'k',
          modes: ['warfare.tdm'],
          players: { min: 2, ideal: 2, max: 2 },
          maxSightLineM: 25,
          botCaps: {},
        });
        for (let i = 0; i < 6; i++) {
          b.spawn({ x: 2.5 + i, y: 0.5, z: 2.5, yaw: 0, team: 0 });
          b.spawn({ x: 2.5 + i, y: 0.5, z: 6.5, yaw: 0, team: 1 });
        }
      }),
      OPTIONS,
    );
    expect(r.errors.some((e) => e.includes('desalinhada'))).toBe(true);
    expect(r.errors.some((e) => e.startsWith('fresta de 0,5 m'))).toBe(true);
    expect(r.errors.some((e) => e.startsWith('spawn visível de spawn inimigo'))).toBe(true);
  });

  it('acusa spawn ilhado (sem caminho) e bloco com forma errada', () => {
    const r = compileMap(
      arena((b) => {
        b.box(1, 1, 20, 30, 6, 20, 'concrete'); // parede alta sem porta: o sul fica ilhado
        b.spawn({ x: 5.5, y: 0.5, z: 13.5, yaw: 0, team: -1 });
        b.stairs(4, 1, 2, 5, 4, { solid: 'concrete', step: 'concrete' }, '+x'); // concreto é cubo, não degrau
      }),
      OPTIONS,
    );
    expect(r.errors.some((e) => e.includes('ilhado'))).toBe(true);
    expect(r.errors.some((e) => e.includes('sem caminho'))).toBe(true);
    expect(r.errors.some((e) => e.includes('usado como step'))).toBe(true);
  });

  it('prop do dobro (dose 2) é do jogo: colisor, buraco na navegação e fonte de luz (decisão #52)', () => {
    const empty = compileMap(
      arena(() => {}),
      OPTIONS,
    );
    const r = compileMap(
      arena((b) => {
        b.prop('water-tank', 8, 0.5, 8, 0, 1, 2);
        b.prop('generator', 4, 0.5, 11, 0, 1, 2);
      }),
      OPTIONS,
    );
    expect(r.errors).toEqual([]);
    expect(r.stats.props).toEqual([0, 0, 2]);
    expect(new Set(r.colliders.owner.subarray(0, r.colliders.count))).toEqual(new Set([0, 1]));
    // A caixa d'água (2,5 m de lado, bloqueia a navegação) tira os nós de baixo dela.
    expect(r.nav.nodeCount).toBeLessThan(empty.nav.nodeCount);
    const pos = new Float64Array(3);
    r.nav.nodePosition(r.nav.nearestNode(8, 0.5, 8), pos);
    expect(Math.max(Math.abs(pos[0]! - 8), Math.abs(pos[2]! - 8))).toBeGreaterThan(1.25);
    // O gerador acende: a única fonte de luz da arena.
    expect(empty.doc.light.emitters).toHaveLength(0);
    expect(r.doc.light.emitters).toHaveLength(1);
    expect(r.doc.light.emitters[0]!.level).toBe(6);
  });

  it('em pé pede ceil(aabbHeight / 0,5) células livres: 4 com o bobo de 1,75 m (decisões #53 e #55)', () => {
    expect(STAND_CELLS).toBe(Math.ceil(METRICS.aabbHeight / BLOCK_SIZE));
    expect(STAND_CELLS).toBe(4);
    // Fresta de 0,5 m só na altura da cabeça (vigas de 1,5 a 2,0 m acima do piso): com 3 células ela passava.
    const beams = compileMap(
      arena((b) => {
        b.box(20, 4, 4, 20, 4, 8, 'concrete');
        b.box(22, 4, 4, 22, 4, 8, 'concrete');
      }),
      OPTIONS,
    );
    expect(beams.errors.some((e) => e.startsWith('fresta de 0,5 m'))).toBe(true);
    // Fresta de 0,5 m entre paredes de 2,0 m, mas com teto a 1,5 m: ninguém fica em pé ali, então não é corredor.
    const low = compileMap(
      arena((b) => {
        b.box(20, 1, 4, 20, 4, 8, 'concrete');
        b.box(22, 1, 4, 22, 4, 8, 'concrete');
        b.box(21, 4, 4, 21, 4, 8, 'concrete');
      }),
      OPTIONS,
    );
    expect(low.errors.some((e) => e.startsWith('fresta de 0,5 m'))).toBe(false);
  });

  it('aviso "visto sem ver": parede com topo entre o olho e o topo da hitbox em pé ao lado de nó jogável', () => {
    // Parede de 5 m de comprimento no meio da arena; o piso fica em 0,5 m e cada célula soma 0,5 m.
    const wall = (top: number, block = 'concrete'): ReturnType<typeof compileMap> =>
      compileMap(
        arena((b) =>
          block === 'fence-wire' ? b.panel(10, 1, 14, 20, top, 14, block) : b.box(10, 1, 14, 20, top, 14, block),
        ),
        OPTIONS,
      );
    // A faixa vai do olho (1,55) ao teto da hitbox em pé do boneco do FutBobo (1,81, `FIGURE_MAX_TOP_M`): o muro de
    // 1,5 m com meia laje em cima (topo a 1,75 m) entra; antes, com o topo da cabeça (1,75), ficava fora.
    expect(FIGURE_MAX_TOP_M).toBe(1.81);
    const slabTop = compileMap(
      arena((b) => {
        b.box(10, 1, 14, 20, 3, 14, 'concrete');
        b.box(10, 4, 14, 20, 4, 14, 'concrete-slab');
      }),
      OPTIONS,
    );
    expect(slabTop.errors).toEqual([]);
    expect(slabTop.checks.seenWithoutSeeing).toBeGreaterThan(0);
    expect(slabTop.warnings.some((w) => w.startsWith('visto sem ver') && w.includes('(1,81 m)'))).toBe(true);
    // Com a altura B (#55) a grade de 0,25 m não cai entre o olho (1,55) e o topo (1,75): só prop. Barril de 0,875 m
    // sobre bloco + meia laje (0,75 m): topo a 1,625 m do piso.
    const seen = compileMap(
      arena((b) => {
        b.box(10, 1, 14, 10, 1, 14, 'concrete');
        b.box(10, 2, 14, 10, 2, 14, 'concrete-slab');
        b.prop('barrel', 5.25, 1.25, 7.25, 0);
      }),
      OPTIONS,
    );
    expect(seen.errors).toEqual([]);
    expect(seen.checks.seenWithoutSeeing).toBeGreaterThan(0);
    expect(seen.warnings.some((w) => w.startsWith('visto sem ver'))).toBe(true);
    expect(wall(3).checks.seenWithoutSeeing).toBe(0); // 1,5 m: o olho (1,55) passa por cima e a cabeça aparece
    expect(wall(2).checks.seenWithoutSeeing).toBe(0); // 1,0 m: cobertura baixa, o olho passa por cima
    expect(wall(4).checks.seenWithoutSeeing).toBe(0); // 2,0 m: esconde quem está em pé
    expect(wall(3, 'fence-wire').checks.seenWithoutSeeing).toBe(0); // tela: deixa ver
    expect(wall(4).warnings.some((w) => w.startsWith('visto sem ver'))).toBe(false);
    // Sete compilações da arena: ~3,5 s sozinho, 5,9 s com o check inteiro rodando (08/11/2026).
  }, 30000);

  it('avisos de cobertura rente à hitbox: baixa em [0,95; 0,98) e alta em [1,75; 1,81) (PLANO do porte §B5)', () => {
    expect(LOW_COVER_BAND).toEqual([METRICS.aabbCrouchHeight, FIGURE_CROUCH_TOP_M + 0.01]);
    expect(HIGH_COVER_BAND).toEqual([METRICS.coverHighMin, FIGURE_MAX_TOP_M]);
    // Barril com o topo a 31/32 m (0,969) do piso, pela caixa de colisão do modelo: rente ao agachado (0,97).
    const barrelTop = OPTIONS.models.models.get('barrel')!.colliders[0]!.max[1];
    const low = compileMap(
      arena((b) => b.prop('barrel', 5.25, 0.5 + (31 - barrelTop) / 32, 7.25, 0)),
      OPTIONS,
    );
    expect(low.errors).toEqual([]);
    expect(low.checks.lowCover).toBeGreaterThan(0);
    expect(low.warnings.some((w) => w.startsWith('cobertura rente ao agachado'))).toBe(true);
    // Muro de 1,5 m com meia laje (topo a 1,75 m): cobertura "alta" que a cabeça passa.
    const high = compileMap(
      arena((b) => {
        b.box(10, 1, 14, 20, 3, 14, 'concrete');
        b.box(10, 4, 14, 20, 4, 14, 'concrete-slab');
      }),
      OPTIONS,
    );
    expect(high.checks.highCover).toBeGreaterThan(0);
    expect(high.checks.lowCover).toBe(0);
    expect(high.warnings.some((w) => w.startsWith('cobertura alta que não esconde a cabeça'))).toBe(true);
    // Cobertura de 1,0 m e muro de 2,0 m: fora das duas faixas.
    for (const top of [2, 4]) {
      const r = compileMap(
        arena((b) => b.box(10, 1, 14, 20, top, 14, 'concrete')),
        OPTIONS,
      );
      expect([r.checks.lowCover, r.checks.highCover]).toEqual([0, 0]);
    }
  });

  it('braço armado e corpo no deslize através de barreira: medida com sonda fixa (J-M4, risco 14 do PLANO)', () => {
    // Sondas sintéticas (a conta não depende da tabela da frente "figura"): a mão com o mesmo alcance em todas as
    // alturas e o pé do deslize rente ao chão. Na hitbox, a mão é cortada a `ARM_HIT_CUT_M` (o pé não).
    const probes = (reachM: number): LimbProbes => {
      const tips = (hs: readonly number[], r: number): LimbTip[] => hs.map((h) => ({ h, reachM: r }));
      const arm = (r: number): LimbProbe => ({
        reachM: r,
        stances: [
          { name: 'stand', standOnly: true, bodyTop: METRICS.aabbHeight, tips: tips([0.95, 1.15, 1.35], r) },
          { name: 'crouch', standOnly: false, bodyTop: METRICS.aabbCrouchHeight, tips: tips([0.45, 0.65], r) },
        ],
      });
      const slide: LimbProbe = {
        reachM: 0.72,
        stances: [
          { name: 'slide', standOnly: false, bodyTop: METRICS.aabbCrouchHeight, tips: tips([0.05, 0.15], 0.72) },
        ],
      };
      return { arm: arm(reachM), armHit: arm(Math.min(reachM, ARM_HIT_CUT_M)), slide, slideHit: slide };
    };
    // Cerca de tábua de 2 m (painel de 6,25 cm que para bala) com 2,5 m de comprimento no meio da arena.
    const thin = (block: string, panel: boolean, reachM = 0.74): ReturnType<typeof compileMap> =>
      compileMap(
        arena((b) => (panel ? b.fence(10, 1, 16, 14, 16, block, 4) : b.box(10, 1, 16, 14, 4, 16, block))),
        { ...OPTIONS, limbProbes: probes(reachM) },
      );
    const wood = thin('fence-wood', true);
    expect(wood.errors).toEqual([]);
    const arm = wood.checks.armThrough;
    expect(arm.reachByStance).toEqual({ stand: 0.74, crouch: 0.74 });
    expect(arm.bullets).toBeGreaterThan(0);
    expect(arm.bulletsByStance['stand']).toBeGreaterThan(0);
    expect(arm.bulletsByStance['crouch']).toBeGreaterThan(0);
    expect(Object.keys(arm.by)).toEqual(['fence-wood']);
    // Dos dois lados da cerca (a mão sai para +Z de quem está ao norte e para −Z de quem está ao sul).
    expect(arm.samples.some((s) => s.includes(' +z '))).toBe(true);
    expect(arm.samples.some((s) => s.includes(' -z '))).toBe(true);
    expect(wood.checks.slideThrough.bullets).toBeGreaterThan(0);
    // Parede de bloco (0,5 m) segura a mão a 0,74 m (0,44 m além da AABB), mas não a 0,94 m (0,64 m além: o fuzil
    // agachado da tabela de hoje); a tela não para bala nem tapa a visão.
    expect(thin('concrete', false).checks.armThrough.bullets).toBe(0);
    const block = thin('concrete', false, 0.94).checks.armThrough;
    expect(block.by['concrete']).toBeGreaterThan(0); // (e o perímetro de `test-wall` da arena, também de 1 bloco)
    // O encosto da AABB é exato nos dois sentidos: a mão 1 cm além do muro (0,81 m, 0,51 m além da AABB) sai dos DOIS
    // lados dele, 2 nós de cada (x 5,5 e 6,5), como a de 0,94. Só com o passo de 2,5 cm, ela saía só do lado −z.
    expect(block.by['concrete']).toBe(4);
    expect(thin('concrete', false, 0.81).checks.armThrough.by['concrete']).toBe(4);
    expect(thin('concrete', false, 0.79).checks.armThrough.by['concrete']).toBeUndefined();
    // Na hitbox (decisão 1 da §I do PLANO), o corte a 0,75 m (0,45 m além da AABB) segura a mão de 0,94 m no muro de
    // 1 bloco; a cerca de tábua (6,25 cm) continua atravessada com qualquer alcance.
    expect(block.bullets).toBeGreaterThan(0);
    expect(thin('concrete', false, 0.94).checks.armHitThrough.bullets).toBe(0);
    expect(thin('fence-wood', true, 0.94).checks.armHitThrough.by['fence-wood']).toBeGreaterThan(0);
    expect(wood.checks.armHitThrough).toEqual(arm); // 0,74 m < corte: a hitbox é o visual
    expect(wood.checks.slideHitThrough).toEqual(wood.checks.slideThrough);
    const wire = thin('fence-wire', true).checks.armThrough;
    expect([wire.bullets, wire.sightOnly]).toEqual([0, 0]);
    // A medida não vira aviso (aceita por escrito no gameplay.md §3.1).
    expect(wood.warnings.some((w) => w.includes('barreira'))).toBe(false);
  });

  it('perfil de alcance da tabela de jogo: exato nas quinas e nas arestas que cruzam a faixa', () => {
    // Tabela sintética: só o antebraço D da postura 1 tem tamanho, igual nas 5 amostras de pitch; o resto é ponto.
    const samples = FIGURE_PITCH_SAMPLES.length;
    const boxes = new Float32Array(FIGURE_POSTURES * samples * FIGURE_BONES * FIGURE_HIT_STRIDE);
    // Campos contíguos de cx a r22 (centro, meias medidas e a 3×3 linha-maior); a vara gira em torno de x.
    const F = FIGURE_HIT_FIELD;
    expect([F.hx, F.r00, F.r22]).toEqual([3, 6, 14]);
    const put = (posture: number, bone: number, c: readonly number[], h: readonly number[], tilt: number): void => {
      const [cos, sin] = [Math.cos(tilt), Math.sin(tilt)];
      for (let s = 0; s < samples; s++) {
        const d = ((posture * samples + s) * FIGURE_BONES + bone) * FIGURE_HIT_STRIDE;
        boxes.set([...c, ...h, 1, 0, 0, 0, cos, -sin, 0, sin, cos], d + F.cx);
      }
    };
    for (let p = 0; p < FIGURE_POSTURES; p++) for (let b = 0; b < FIGURE_BONES; b++) put(p, b, [0, 0, 0], [0, 0, 0], 0);
    const table = {
      poses: new Float32Array(0),
      boxes,
      broad: new Float32Array(0),
      slack: new Float32Array(FIGURE_POSTURES * (samples - 1) * FIGURE_BONES * 3),
      grip: new Float32Array(0),
      reload: new Float32Array(0),
    };
    const spec = { name: 'stand', standOnly: true, bodyTop: 1.75, postures: [1], bones: [FIGURE_BONE.forearmR] };
    // Caixa reta de y 0,82 a 1,18 e z até 0,7: 4 faixas, todas com o raio da quina de fora.
    put(1, FIGURE_BONE.forearmR, [0.05, 1, 0.6], [0.05, 0.18, 0.1], 0);
    const straight = limbProbeFromTable(table, [spec]);
    expect(straight.stances[0]!.tips.map((t) => t.h)).toEqual(
      [0.85, 0.95, 1.05, 1.15].map((h) => expect.closeTo(h, 9)),
    );
    for (const t of straight.stances[0]!.tips) expect(t.reachM).toBeCloseTo(Math.hypot(0.1, 0.7), 6);
    expect(straight.reachM).toBeCloseTo(Math.hypot(0.1, 0.7), 6);
    // Vara inclinada 45° para a frente: nas faixas do meio o mais longe está numa aresta, não numa quina. Confere
    // contra uma amostragem densa do volume (o perfil nunca fica abaixo dela nem passa mais que a faixa permite).
    const c = [0, 1, 0.5];
    const h = [0.01, 0.3, 0.01];
    const tilt = Math.PI / 4;
    put(1, FIGURE_BONE.forearmR, c, h, tilt);
    const rod = limbProbeFromTable(table, [spec]);
    const dense = new Map<number, number>();
    for (let i = 0; i <= 20; i++) {
      for (let j = 0; j <= 200; j++) {
        for (let k = 0; k <= 20; k++) {
          const [lx, ly, lz] = [(i / 10 - 1) * h[0]!, (j / 100 - 1) * h[1]!, (k / 10 - 1) * h[2]!];
          const y = Math.fround(c[1]!) + Math.cos(tilt) * ly - Math.sin(tilt) * lz;
          const z = Math.fround(c[2]!) + Math.sin(tilt) * ly + Math.cos(tilt) * lz;
          const bin = Math.floor(y / LIMB_BIN_M);
          dense.set(bin, Math.max(dense.get(bin) ?? 0, Math.hypot(lx, z)));
        }
      }
    }
    const profile = new Map(rod.stances[0]!.tips.map((t) => [Math.round(t.h / LIMB_BIN_M - 0.5), t.reachM]));
    for (const [bin, r] of dense) {
      if (r <= METRICS.aabbWidth / 2) continue;
      expect(profile.get(bin)).toBeGreaterThanOrEqual(r - 1e-6);
      expect(profile.get(bin)! - r).toBeLessThan(0.01);
    }
    // A faixa de 1,1 a 1,2 m não tem quina: sem as arestas ela ficaria de fora.
    expect(profile.get(11)).toBeCloseTo(0.5 + 0.2 + 0.01 * Math.SQRT2, 2);
  });

  it('sondas da tabela de jogo real: braço armado em pé e agachado e o deslize dentro dos tetos (§B4)', () => {
    const { arm, slide } = figureLimbProbes();
    const [stand, crouch] = arm.stances;
    expect([stand!.name, crouch!.name, slide.stances[0]!.name]).toEqual(['stand', 'crouch', 'slide']);
    for (const s of [stand!, crouch!, slide.stances[0]!]) {
      expect(s.tips.length).toBeGreaterThan(0);
      for (const t of s.tips) expect(t.reachM).toBeGreaterThan(METRICS.aabbWidth / 2);
    }
    // O braço armado sai da AABB pelo menos o que o PLANO mediu no fuzil em pé (0,74 m do centro).
    expect(Math.max(...stand!.tips.map((t) => t.reachM))).toBeGreaterThan(0.7);
    // Alturas: em pé até o teto da hitbox; agachado e deslizando abaixo do teto agachado (a faixa de 10 cm de folga).
    for (const t of stand!.tips) expect(t.h).toBeLessThan(FIGURE_MAX_TOP_M + LIMB_BIN_M);
    for (const t of [...crouch!.tips, ...slide.stances[0]!.tips])
      expect(t.h).toBeLessThan(FIGURE_CROUCH_TOP_M + LIMB_BIN_M);
    expect(figureLimbProbes()).toBe(figureLimbProbes()); // montada uma vez por processo
    // Hitbox (decisão 1 da §I do PLANO): o braço é todo braço, então é o visual cortado faixa a faixa; no deslize só os
    // braços são cortados (fica entre o visual cortado e o visual).
    const { armHit, slideHit } = figureLimbProbes();
    const capped = (p: LimbProbe): LimbProbe['stances'] =>
      p.stances.map((s) => ({ ...s, tips: s.tips.map((t) => ({ ...t, reachM: Math.min(t.reachM, ARM_HIT_CUT_M) })) }));
    expect(armHit.stances).toEqual(capped(arm));
    expect(armHit.reachM).toBe(Math.min(arm.reachM, ARM_HIT_CUT_M));
    const [hitTips, visTips] = [slideHit.stances[0]!.tips, slide.stances[0]!.tips];
    expect(hitTips.map((t) => t.h)).toEqual(visTips.map((t) => t.h));
    hitTips.forEach((t, i) => {
      expect(t.reachM).toBeLessThanOrEqual(visTips[i]!.reachM);
      expect(t.reachM).toBeGreaterThanOrEqual(Math.min(visTips[i]!.reachM, ARM_HIT_CUT_M));
    });
  });

  it('linha de visão: parede cheia bloqueia, laje não; fora da grade é ar', () => {
    const grid = createWorldGrid(16, 8, 16);
    const reg = createBlockRegistry([
      { key: 'c', shape: 'cube', faces: [0, 0, 0, 0, 0, 0], flags: 1 | 32, frames: 1, stepSound: '' },
      { key: 's', shape: 'slab', faces: [0, 0, 0, 0, 0, 0], flags: 1 | 32, frames: 1, stepSound: '' },
    ]);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 16; x++) grid.set(x, y, 8, 1);
    for (let x = 0; x < 16; x++) grid.set(x, 0, 4, 2);
    const s = buildSightGrid(grid, reg);
    expect(lineOfSight(s, 1, 1, 1, 1, 1, 7)).toBe(false);
    expect(lineOfSight(s, 1, 0.1, 1, 1, 0.1, 3)).toBe(true);
    expect(lineOfSight(s, 1, 1, 1, 7, 1, 1)).toBe(true);
    expect(lineOfSight(s, -5, 1, 1, 1, 1, 1)).toBe(true);
  });
});

describe('mapc: Construto', () => {
  it('compila sem erro, é determinístico e cabe no teto', () => {
    const a = compileMap(construto, { ...OPTIONS, requirePrintMarkers: true, maxSightLimitM: 50 });
    expect(a.errors).toEqual([]);
    expect(a.bytes.length).toBeLessThanOrEqual(MAX_BFMAP_BYTES);
    expect(a.checks.sight.max!.distance).toBeLessThanOrEqual(50);
    expect(a.checks.spawns.tdmA).toBeGreaterThanOrEqual(6);
    expect(a.checks.spawns.tdmB).toBeGreaterThanOrEqual(6);
    expect(a.checks.spawns.ffa).toBeGreaterThanOrEqual(16);
    const names = new Set(a.doc.markers.mannequins.map((m) => m.name));
    for (const m of REQUIRED_MANNEQUINS) expect(names.has(m)).toBe(true);
    expect(a.doc.markers.domination.length).toBeGreaterThanOrEqual(3);
    // Navegação do CP1 do porte (passo 1, altura B): os marcadores do boneco (fila, close, deslize) não colidem e a
    // régua, 1 m mais a leste, troca 2 nós dela fora da área jogável sem mudar a conta. Mapa novo = conta nova.
    expect([a.stats.navNodes, a.checks.playableNodes, a.stats.navComponents]).toEqual([7161, 4599, 25]);
    // A mão armada sai pela cerca de tábua do canteiro (6,25 cm) com qualquer alcance da tabela; o resto (paredes de
    // bloco, painéis) depende do alcance de hoje e vai para o relatório. Medida, nunca aviso.
    expect(a.checks.armThrough.by['fence-wood']).toBeGreaterThan(0);
    expect(a.checks.armHitThrough.by['fence-wood']).toBeGreaterThan(0);
    // Na hitbox (corte a 0,75 m, decisão 1 da §I do PLANO) nenhum muro de bloco cheio é atravessado pelo braço: a ponta
    // fica 0,45 m além da AABB, menos que o bloco de 0,5 m.
    for (const wall of ['concrete', 'brick', 'test-wall']) expect(a.checks.armHitThrough.by[wall]).toBeUndefined();
    expect(a.warnings.some((w) => w.includes('através de barreira'))).toBe(false);
    // Dose do jogo (#52): toda prop com colisor, de qualquer dose, aparece como dona de caixa.
    const owners = new Set(a.colliders.owner.subarray(0, a.colliders.count));
    a.doc.props.forEach((p, i) => {
      if ((OPTIONS.models.models.get(p.model)?.colliders.length ?? 0) > 0) expect(owners.has(i)).toBe(true);
    });
    expect(a.doc.props.some((p) => p.dose === 2)).toBe(true);
    // Determinismo: montar de novo (só o builder; as validações não mexem no documento) dá os mesmos bytes, com a
    // luz das props calculada igual.
    const again = createMapBuilder('construto');
    construto.build(again.builder);
    const doc = { ...again.finish().doc, light: a.doc.light };
    expect(Buffer.from(encodeMap(doc)).equals(Buffer.from(a.bytes))).toBe(true);
    // Ida e volta do arquivo e a vista de cima.
    const back = decodeMap(a.bytes);
    expect(back.grid.sizeX).toBe(160);
    const png = decodePng(renderTopView(a));
    expect([png.width, png.height]).toEqual([640, 640]);
  }, 30000);

  it('olho do METRICS nas câmeras e rotas; régua de métricas fora da área e fora dos outros prints (#53)', () => {
    const r = compileMap(construto, { ...OPTIONS, requirePrintMarkers: true, maxSightLimitM: 50 });
    expect(r.errors).toEqual([]);
    const G = 1;
    const eye = METRICS.eyeHeight;
    const cams = new Map(r.doc.markers.cameras.map((cam) => [cam.name, cam]));
    for (const name of ['print:densidade-1m', 'print:densidade-3m', 'print:leitura-5m', 'print:leitura-50m']) {
      expect(cams.get(name)!.y).toBeCloseTo(G + eye, 6);
    }
    const routes = new Map(r.doc.markers.routes.map((route) => [route.name, route]));
    expect(routes.get('bench:volta')!.points[0]!.y).toBeCloseTo(G + eye + 0.2, 6);
    expect(routes.get('bench:alto')!.points[0]!.y).toBeCloseTo(G + 8 + eye, 6);

    // Régua: fora da área jogável (ao sul do perímetro), com a câmera e os 3 manequins dentro dela.
    const R = HEIGHT_RULER;
    const area = r.doc.markers.playArea;
    expect(R.minZ).toBeGreaterThanOrEqual(area.maxZ);
    expect(R.maxZ).toBeLessThanOrEqual(r.grid.sizeZ * BLOCK_SIZE);
    const ruler = r.doc.markers.mannequins.filter((q) => q.name.startsWith('altura:'));
    expect(ruler.map((q) => [q.name, q.pose])).toEqual([
      ['altura:em-pe', 'stand'],
      ['altura:agachado', 'crouch'],
      ['altura:deslizando', 'slide'],
    ]);
    const cam = cams.get('print:altura')!;
    for (const p of [...ruler, cam]) {
      expect(p.x).toBeGreaterThanOrEqual(R.minX);
      expect(p.x).toBeLessThan(R.maxX);
      expect(p.z).toBeGreaterThanOrEqual(R.minZ);
      expect(p.z).toBeLessThan(R.maxZ);
    }
    expect(cam.pitch).toBe(0);
    // De perfil, a face de fora da cabeça (meia aresta do boneco do FutBobo, sem camada externa) fica no plano das
    // paredes: o topo visto e o das paredes estão à mesma distância da câmera (sem paralaxe na comparação).
    for (const q of ruler) expect(q.z - FIGURE_HEAD_HALF_M).toBeCloseTo(R.plane, 6);
    // Pelo FK do boneco nas poses base: os 3 inteiros no quadro de 16:9 (folga ≥ 2% da meia largura), sem encostar um
    // no outro nem nas paredes da fileira (z do plano até o plano + 0,5) e com o topo de cada pose abaixo do que ele
    // compara (porta 2,0; cobertura 1,0).
    const poses = [FIGURE_REST_POSE, FIGURE_CROUCH_POSE, FIGURE_SLIDE_POSE];
    const boxes = ruler.map((q, i) => figureCorners(poses[i]!, q));
    const spans = boxes.map(footprint);
    for (const corners of boxes) {
      expect(Math.min(...corners.map(([x, y, z]) => frameMargin(cam, x, y, z)))).toBeGreaterThan(0.02);
    }
    // Em x, da esquerda para a direita do quadro: em pé (entre o muro e o batente), agachado e deslizando.
    const [stand, crouch, slide] = spans as [number, number, number, number][];
    // A cobertura de 1,0 m é a parede de teste da fileira (o muro de 1,5 m é de tijolo, colado nela a leste).
    const rowZ = Math.floor((R.plane + 0.25) / BLOCK_SIZE);
    const rowBlock = (x: number): string | null => {
      const cell = r.grid.get(Math.floor(x / BLOCK_SIZE), Math.floor((G + 0.25) / BLOCK_SIZE), rowZ);
      return cell === 0 ? null : r.doc.blocks[cellBlock(cell)]!;
    };
    let cover = R.minX;
    while (rowBlock(cover + 0.25) !== 'test-wall' && cover < R.maxX) cover += BLOCK_SIZE;
    expect(rowBlock(cover + 0.75)).toBe('brick');
    expect(stand![0]).toBeGreaterThan(cover + 1); // atrás do muro de 1,5 m (cover + 0,5 .. cover + 1)
    expect(stand![1]).toBeLessThan(cover + 2); // antes do batente direito
    expect(crouch![1]).toBeLessThan(cover);
    expect(slide![1]).toBeLessThan(crouch![0]);
    expect(crouch![0] - slide![1]).toBeLessThan(0.05);
    const tops = boxes.map((corners) => Math.max(...corners.map((p) => p[1])) - 1);
    expect(tops[0]).toBeCloseTo(METRICS.bodyHeight, 4);
    expect(tops[1]).toBeLessThan(FIGURE_CROUCH_TOP_M);
    expect(tops[2]).toBeLessThan(FIGURE_CROUCH_TOP_M);
    // O que fica na frente de cada manequim (0,5 m para onde ele olha), na fileira das paredes: o muro de 1,5 m para
    // quem está em pé (com a altura B, #55, o olho passa por cima e a cabeça fica à mostra) e a cobertura baixa para o
    // agachado.
    const topAhead = (q: (typeof ruler)[number]): number => {
      const x = Math.floor((q.x - Math.sin(q.yaw) * 0.5) / BLOCK_SIZE);
      const z = Math.floor((R.plane + 0.25) / BLOCK_SIZE);
      let y = Math.round(q.y / BLOCK_SIZE);
      while (r.grid.get(x, y, z) !== 0) y++;
      return y * BLOCK_SIZE - q.y;
    };
    const wallTop = topAhead(ruler[0]!);
    expect(wallTop).toBe(1.5);
    expect(wallTop).toBeLessThan(eye);
    expect(wallTop).toBeGreaterThan(METRICS.coverLow);
    expect(topAhead(ruler[1]!)).toBe(METRICS.coverLow);

    // Longe das props do dobro (#52): nenhuma a menos de 5 m da régua.
    for (const p of r.doc.props) {
      if (p.dose !== 2) continue;
      const [px, pz] = [p.x / 32, p.z / 32];
      const dx = Math.max(R.minX - px, 0, px - R.maxX);
      const dz = Math.max(R.minZ - pz, 0, pz - R.maxZ);
      expect(Math.hypot(dx, dz)).toBeGreaterThan(5);
    }
    // Fora dos quadros de print:dia e print:doses: nenhum ponto da régua fica no campo de visão (FOV do PC, o mais
    // largo, com 10% de folga) com linha de visão livre (conservadora: só bloco cheio tapa).
    const visibleFrom = (name: string): number => {
      const c = cams.get(name)!;
      const tanV = c.fovYDeg > 0 ? Math.tan((c.fovYDeg * Math.PI) / 360) : 1 / (16 / 9);
      const tanH = tanV * (16 / 9);
      const [sy, cy, sp, cp] = [Math.sin(c.yaw), Math.cos(c.yaw), Math.sin(c.pitch), Math.cos(c.pitch)];
      let seen = 0;
      for (let x = R.minX; x <= R.maxX; x += 0.5) {
        for (const z of [R.minZ + 0.25, R.plane - 1, R.plane, R.maxZ - 0.75]) {
          for (const y of [G + 0.1, G + 1, G + 2, G + 3.4]) {
            const [dx, dy, dz] = [x - c.x, y - c.y, z - c.z];
            const ahead = -sy * cp * dx + sp * dy - cy * cp * dz;
            if (ahead <= 0) continue;
            const side = (cy * dx - sy * dz) / ahead;
            const rise = (sy * sp * dx + cp * dy + cy * sp * dz) / ahead;
            if (Math.abs(side) > tanH * 1.1 || Math.abs(rise) > tanV * 1.1) continue;
            if (lineOfSight(r.sight, c.x, c.y, c.z, x, y, z)) seen++;
          }
        }
      }
      return seen;
    };
    expect(visibleFrom('print:dia')).toBe(0);
    expect(visibleFrom('print:doses')).toBe(0);
    // A própria câmera da régua vê a régua (sanidade da conta acima).
    expect(visibleFrom('print:altura')).toBeGreaterThan(0);
  }, 30000);

  it('régua a 45° (decisão 6 da §I do PLANO do porte): a de perfil girada 45°, com os 3 no quadro e as cabeças à vista', () => {
    const r = compileMap(construto, { ...OPTIONS, requirePrintMarkers: true, maxSightLimitM: 50 });
    expect(r.errors).toEqual([]);
    const cams = new Map(r.doc.markers.cameras.map((c) => [c.name, c]));
    const profile = cams.get('print:altura')!;
    const cam = cams.get('print:altura-45')!;
    // O que o roteiro da F7 pede (`prints-plan.ts`, `REQUESTED_CAMERAS`): mesma altura e mesmo FOV da de perfil; e o
    // pitch 0 dela, que deixa o topo da cobertura de 1,0 m no horizonte. Mesmo z (colada no perímetro), 45° no yaw.
    expect([cam.y, cam.z, cam.pitch, cam.fovYDeg]).toEqual([profile.y, profile.z, 0, profile.fovYDeg]);
    expect(cam.y).toBeCloseTo(1 + METRICS.coverLow, 9);
    expect(Math.abs(Math.atan2(Math.sin(cam.yaw - profile.yaw), Math.cos(cam.yaw - profile.yaw)))).toBeCloseTo(
      Math.PI / 4,
      9,
    );
    const R = HEIGHT_RULER;
    expect(cam.x).toBeGreaterThanOrEqual(R.minX);
    expect(cam.x).toBeLessThan(R.maxX);
    // O agachado no centro do quadro, e os 3 inteiros nele (folga ≥ 2% da meia largura), nas poses base.
    const ruler = r.doc.markers.mannequins.filter((q) => q.name.startsWith('altura:'));
    const crouch = ruler.find((q) => q.name === 'altura:agachado')!;
    expect(Math.atan2(-(crouch.x - cam.x), -(crouch.z - cam.z))).toBeCloseTo(cam.yaw, 9);
    const poses = [FIGURE_REST_POSE, FIGURE_CROUCH_POSE, FIGURE_SLIDE_POSE];
    ruler.forEach((q, i) => {
      const corners = figureCorners(poses[i]!, q);
      expect(Math.min(...corners.map(([x, y, z]) => frameMargin(cam, x, y, z)))).toBeGreaterThan(0.02);
      // O centro da cabeça à vista (só bloco tapa: a cobertura deixa ver o centro da do agachado, não a nuca).
      const head = figureCorners(poses[i]!, q, FIGURE_BONE.head);
      const [hx, hy, hz] = [0, 1, 2].map((k) => head.reduce((s, p) => s + p[k]!, 0) / head.length) as [
        number,
        number,
        number,
      ];
      expect(lineOfSight(r.sight, cam.x, cam.y, cam.z, hx, hy, hz)).toBe(true);
    });
  }, 30000);

  it('fila e close do boneco: marcadores opcionais nos lugares do PLANO do porte (§B16), dentro dos quadros', () => {
    const r = compileMap(construto, { ...OPTIONS, requirePrintMarkers: true, maxSightLimitM: 50 });
    expect(r.errors).toEqual([]);
    const mans = new Map(r.doc.markers.mannequins.map((q) => [q.name, q]));
    const cams = new Map(r.doc.markers.cameras.map((c) => [c.name, c]));
    for (const n of OPTIONAL_MANNEQUINS) {
      expect(mans.has(n)).toBe(true);
      expect((REQUIRED_MANNEQUINS as readonly string[]).includes(n)).toBe(false);
    }
    for (const n of OPTIONAL_PRINT_CAMERAS) {
      expect(cams.has(n)).toBe(true);
      expect((PRINT_CAMERAS as readonly string[]).includes(n)).toBe(false);
    }
    const G = 1;
    const headY = G + METRICS.bodyHeight - FIGURE_HEAD_HALF_M;
    // Fila: x = 74,5; z = 32,2 + (n − 4,5)·0,95; olhando para −X; 1–4 no time A e 5–8 no B; em pé, recruta.
    const line = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => mans.get(`linha:${n}`)!);
    line.forEach((q, i) => {
      const n = i + 1;
      expect([q.x, q.y, q.pose, q.team, q.look, q.weapon]).toEqual([74.5, G, 'stand', n <= 4 ? 0 : 1, 'recruit', '']);
      expect(q.z).toBeCloseTo(32.2 + (n - 4.5) * 0.95, 9);
      expect(q.yaw).toBeCloseTo(Math.PI / 2, 9);
    });
    // As 4 câmeras da fila são a mesma pose: 4 m à frente das cabeças, na altura do centro delas.
    const front = cams.get('print:linha-frente')!;
    for (const name of ['print:linha-3-4', 'print:linha-costas', 'print:linha-expressoes']) {
      expect(cams.get(name)).toEqual({ ...front, name });
    }
    expect(74.5 - FIGURE_HEAD_HALF_M - front.x).toBeCloseTo(4, 6);
    expect(front.y).toBeCloseTo(headY, 6);
    for (const q of line) {
      const margin = Math.min(...figureCorners(FIGURE_REST_POSE, q).map(([x, y, z]) => frameMargin(front, x, y, z)));
      expect(margin).toBeGreaterThan(0.02);
      expect(lineOfSight(r.sight, front.x, front.y, front.z, q.x, headY, q.z)).toBe(true);
    }
    // Close a 1 m: a frente da cabeça no plano z = 66 da densidade, 1 (time A) e 5 (time B); as cabeças no quadro
    // (padrão do PC, 90° na horizontal), com a vista livre, e a mão direita do 1 fora do contraforte (x 31).
    const close = cams.get('print:close-1m')!;
    const density = cams.get('print:densidade-1m')!;
    expect([close.y, close.z, close.pitch, close.fovYDeg]).toEqual([density.y, density.z, density.pitch, 0]);
    for (const [n, team] of [
      [1, 0],
      [5, 1],
    ] as const) {
      const q = mans.get(`close:${n}`)!;
      expect([q.team, q.pose, q.yaw]).toEqual([team, 'stand', 0]);
      expect(q.z - FIGURE_HEAD_HALF_M).toBeCloseTo(66, 6);
      const head = figureCorners(FIGURE_REST_POSE, q, 0);
      expect(Math.min(...head.map(([x, y, z]) => frameMargin(close, x, y, z)))).toBeGreaterThan(0.02);
      expect(lineOfSight(r.sight, close.x, close.y, close.z, q.x, headY, q.z)).toBe(true);
      expect(footprint(figureCorners(FIGURE_REST_POSE, q))[1]).toBeLessThan(31);
    }
    // O densidade também pelo contrato novo (sem o 0,25 fixo).
    expect(mans.get('densidade')!.z - FIGURE_HEAD_HALF_M).toBeCloseTo(66, 6);
  }, 30000);

  it('o .bfmap gravado é um map@1 de verdade (não o provisório)', () => {
    const doc = decodeMap(new Uint8Array(readFileSync(join(MAPS_OUT_DIR, 'construto.bfmap'))));
    expect(doc.id).toBe('construto');
    expect(doc.meta.maxSightLineM).toBe(50);
    // Já com a régua do deslize (pose `slide` no arquivo, sem subir o `map@1`).
    expect(doc.markers.mannequins.find((q) => q.name === 'altura:deslizando')?.pose).toBe('slide');
  });
});
