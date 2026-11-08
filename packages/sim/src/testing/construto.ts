import {
  BLOCK_FLAG,
  createBlockRegistry,
  createWorldGrid,
  fillBox,
  makeCell,
  type BlockDefInput,
  type BlockRegistry,
  type Cell,
  type WorldGrid,
} from '@boboforces/world';
import { BOBO_NAV_METRICS } from '../config/nav-metrics.ts';
import type { SimMap, SpawnPoint } from '../sim.ts';
import { buildTestNav, type TestNavGrid } from './test-nav.ts';

/**
 * CONSTRUTO SINTÉTICO: mapa gerado por código com o tamanho e as peças do Construto (GDD §4.6.4: grade de 80×80×24 m,
 * área jogável de 72×72 m, 3 níveis), para o golden do M1, os testes da IA e o bench headless enquanto o `.bfmap` de
 * verdade (frente mapa-nav, `npm run mapc`) não existe. Não é o Construto: é um equivalente de teste com as mesmas
 * classes de peça (cubo, laje, degrau, rampas 1:1 e 1:2, painel de arame, cerca de madeira, cruz de mato), spawns de
 * TDM (6 por time) e de FFA (16), área jogável e plano de morte, e a navegação de teste (`buildTestNav`).
 *
 * Coordenadas em CÉLULAS (0,5 m). Time 0 nasce no sul (z alto) olhando para o norte (-Z); time 1 no norte.
 */

const SOLID = BLOCK_FLAG.solid | BLOCK_FLAG.blocksBullets | BLOCK_FLAG.blocksSight | BLOCK_FLAG.walkable;
const F0: BlockDefInput['faces'] = [0, 0, 0, 0, 0, 0];

/** Blocos do mapa sintético, com IDs de conteúdo do registro (`block:*`). As camadas (`faces`) não importam à sim. */
export const SYNTHETIC_CONSTRUTO_BLOCKS: readonly BlockDefInput[] = [
  { key: 'test-floor', shape: 'cube', faces: F0, flags: SOLID, frames: 1, stepSound: 'concrete' },
  { key: 'concrete', shape: 'cube', faces: F0, flags: SOLID, frames: 1, stepSound: 'concrete' },
  { key: 'crate', shape: 'cube', faces: F0, flags: SOLID, frames: 1, stepSound: 'wood' },
  { key: 'concrete-slab', shape: 'slab', faces: F0, flags: SOLID, frames: 1, stepSound: 'concrete' },
  { key: 'concrete-step', shape: 'step', faces: F0, flags: SOLID, frames: 1, stepSound: 'concrete' },
  { key: 'concrete-ramp', shape: 'ramp', faces: F0, flags: SOLID, frames: 1, stepSound: 'concrete' },
  { key: 'concrete-ramp-half-low', shape: 'rampHalfLow', faces: F0, flags: SOLID, frames: 1, stepSound: 'concrete' },
  { key: 'concrete-ramp-half-high', shape: 'rampHalfHigh', faces: F0, flags: SOLID, frames: 1, stepSound: 'concrete' },
  // Arame: segura o corpo, deixa passar bala e visão (GDD §4.6.1).
  {
    key: 'fence-wire',
    shape: 'panel',
    faces: F0,
    flags: BLOCK_FLAG.solid | BLOCK_FLAG.cutout,
    frames: 1,
    stepSound: 'metal',
  },
  // Cerca de madeira fechada: bloqueia tudo.
  {
    key: 'fence-wood',
    shape: 'postRail',
    faces: F0,
    flags: SOLID & ~BLOCK_FLAG.walkable,
    frames: 1,
    stepSound: 'wood',
  },
  // Mato alto (cruz): não bloqueia nada.
  { key: 'tall-grass', shape: 'cross', faces: F0, flags: BLOCK_FLAG.cutout, frames: 1, stepSound: 'grass' },
];

/** Tamanho da grade (células) e área jogável (metros). */
export const SYNTHETIC_CONSTRUTO_SIZE = { x: 160, y: 48, z: 160 } as const;
export const SYNTHETIC_CONSTRUTO_PLAY_AREA = { minX: 4, minZ: 4, maxX: 76, maxZ: 76 } as const;

export interface SyntheticConstruto {
  readonly map: SimMap;
  readonly grid: WorldGrid;
  readonly blocks: BlockRegistry;
  /** Navegação de teste (quando pedida). Também está em `map.nav`. */
  readonly nav: TestNavGrid | null;
}

/** Monta o mapa (e, com `nav: true`, a navegação de teste; leva algumas dezenas de ms). Determinístico. */
export function buildSyntheticConstruto(options: { readonly nav?: boolean } = {}): SyntheticConstruto {
  const blocks = createBlockRegistry(SYNTHETIC_CONSTRUTO_BLOCKS);
  const id = (key: string): number => blocks.byKey(key)!.id;
  const floor = makeCell(id('test-floor'));
  const concrete = makeCell(id('concrete'));
  const crate = makeCell(id('crate'));
  const slab = makeCell(id('concrete-slab'));
  const wire = makeCell(id('fence-wire'));
  const wireZ = makeCell(id('fence-wire'), 1);
  const wood = makeCell(id('fence-wood'));
  const grass = makeCell(id('tall-grass'));
  const { x: sx, y: sy, z: sz } = SYNTHETIC_CONSTRUTO_SIZE;
  const grid = createWorldGrid(sx, sy, sz);
  const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, cell: Cell): void =>
    fillBox(grid, x0, y0, z0, x1, y1, z1, cell);
  /** Espelha em Z (o mapa é simétrico entre os times). */
  const mz = (z: number): number => sz - 1 - z;
  const pair = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, cell: Cell): void => {
    box(x0, y0, z0, x1, y1, z1, cell);
    box(x0, y0, mz(z1), x1, y1, mz(z0), cell);
  };

  /**
   * Rampa 1:2 de `rise` camadas sobre o chão (camada 1), largura x0..x1, subindo na direção dada: `-1` = para -Z
   * (giro 0, forma canônica), `+1` = para +Z (giro 2). `zLow` é a célula mais baixa. Embaixo de cada degrau, cubos.
   */
  const rampHalfZ = (x0: number, x1: number, zLow: number, rise: number, dir: -1 | 1): void => {
    const rot = dir < 0 ? 0 : 2;
    const low = makeCell(id('concrete-ramp-half-low'), rot);
    const high = makeCell(id('concrete-ramp-half-high'), rot);
    for (let k = 0; k < rise; k++) {
      const zl = zLow + dir * 2 * k;
      const zh = zl + dir;
      box(x0, 1 + k, zl, x1, 1 + k, zl, low);
      box(x0, 1 + k, zh, x1, 1 + k, zh, high);
      if (k > 0) box(x0, 1, Math.min(zl, zh), x1, k, Math.max(zl, zh), concrete);
    }
  };
  /** Rampa 1:1 de `rise` camadas subindo para -X (giro 1), com a célula mais baixa em `xLow`. */
  const rampFullNegX = (xLow: number, z0: number, z1: number, rise: number): void => {
    const ramp = makeCell(id('concrete-ramp'), 1);
    for (let k = 0; k < rise; k++) {
      const x = xLow - k;
      box(x, 1 + k, z0, x, 1 + k, z1, ramp);
      if (k > 0) box(x, 1, z0, x, k, z1, concrete);
    }
  };

  // Chão de placas de teste e muro de 4 m na borda da área jogável (células 7 e 152).
  box(0, 0, 0, sx - 1, 0, sz - 1, floor);
  box(7, 1, 7, 152, 8, 7, concrete);
  box(7, 1, 152, 152, 8, 152, concrete);
  box(7, 1, 7, 7, 8, 152, concrete);
  box(152, 1, 7, 152, 8, 152, concrete);

  // Torre central de 3 m (16×16 células) com rampas 1:2 ao norte e ao sul (2 m de largura).
  box(72, 1, 72, 87, 6, 87, concrete);
  rampHalfZ(78, 81, 99, 6, -1);
  rampHalfZ(78, 81, 60, 6, 1);

  // Galpão a oeste (12 × 20 m, pé-direito de 3 m) com portas leste/oeste e telhado andável; rampa 1:1 até o telhado.
  box(20, 1, 60, 43, 6, 99, concrete);
  box(21, 1, 61, 42, 5, 98, 0);
  box(43, 1, 78, 43, 4, 81, 0); // porta leste (2 m × 2 m)
  box(20, 1, 78, 20, 4, 81, 0); // porta oeste
  rampFullNegX(49, 62, 65, 6); // sobe de x = 49 a 44, encostando no telhado (camada 6)

  // Plataforma leste de 1 m com escada de degraus (forma `step`, giro 3: o alto para +X).
  box(116, 1, 60, 131, 2, 99, concrete);
  box(114, 1, 76, 114, 1, 83, makeCell(id('concrete-step'), 3));
  box(115, 1, 76, 115, 1, 83, concrete);
  box(115, 2, 76, 115, 2, 83, makeCell(id('concrete-step'), 3));

  // Lajes perto dos spawns (0,25 m) e caixotes de 1 m como cobertura baixa; muretas de 2 m como cobertura alta.
  pair(56, 1, 124, 71, 1, 131, slab);
  pair(88, 1, 124, 103, 1, 131, slab);
  for (const [x, z] of [
    [50, 110],
    [64, 104],
    [94, 104],
    [108, 110],
    [40, 120],
    [118, 120],
    [79, 116],
  ] as const) {
    pair(x, 1, z, x + 3, 2, z + 3, crate);
  }
  pair(30, 1, 108, 37, 4, 109, concrete);
  pair(122, 1, 108, 129, 4, 109, concrete);
  // Cerca de arame (segura o corpo, não a bala) e cerca de madeira (segura tudo).
  pair(54, 1, 92, 65, 2, 92, wire);
  pair(94, 1, 88, 94, 2, 97, wireZ);
  pair(12, 1, 40, 27, 2, 40, wood);
  // Mato alto na borda.
  pair(9, 1, 9, 18, 1, 18, grass);
  pair(141, 1, 9, 150, 1, 18, grass);

  const spawns: SpawnPoint[] = [];
  const at = (cx: number): number => (cx + 0.5) * 0.5;
  for (const x of [52, 62, 72, 86, 96, 106]) {
    spawns.push({ x: at(x), y: 0.5, z: at(144), yaw: 0, team: 0 });
    spawns.push({ x: at(x), y: 0.5, z: at(mz(144)), yaw: Math.PI, team: 1 });
  }
  // FFA: 16 pontos espalhados (4 × 4), olhando para o centro.
  for (const gx of [16, 56, 104, 144]) {
    for (const gz of [24, 56, 104, 136]) {
      const x = at(gx);
      const z = at(gz);
      spawns.push({ x, y: 0.5, z, yaw: Math.atan2(-(40 - x), -(40 - z)), team: -1 });
    }
  }

  const area = SYNTHETIC_CONSTRUTO_PLAY_AREA;
  const nav = options.nav ? buildTestNav({ grid, blocks }, BOBO_NAV_METRICS) : null;
  const map: SimMap = {
    grid,
    blocks,
    spawns,
    playArea: { minX: area.minX, minZ: area.minZ, maxX: area.maxX, maxZ: area.maxZ },
    killPlaneY: -10,
    ...(nav ? { nav } : {}),
  };
  return { map, grid, blocks, nav };
}
