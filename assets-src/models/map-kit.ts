/**
 * M10 (fase 0): as props do kit dos 5 mapas novos (arte-ux.md §1.4: só o que é redondo, inclinado ou grande demais
 * para a grade; o resto do kit é bloco, em assets-src/blocks/blocks.ts). Mesmas regras das props do Construto
 * (`props.ts`): ≤ 300 triângulos, 32 px/m, pivô no chão no centro da pegada, pegada em múltiplos de 0,5 m, colisão só
 * em caixas, genérico (sem marca nem bandeira, #19) e na saturação do cenário (as cores de time ficam de fora).
 *
 * Duas camadas COMPARTILHADAS (o orçamento de camadas de modelo do `modelgen`): `mdl_map_kit_1` (os quatro infláveis do
 * paintball e o cabeço de amarração do cais) e `mdl_map_kit_2` (silo, trator e rolo de feno).
 *
 * | Prop               | Mapa                 | Tamanho (L × A × P)  | Colisão e visão                              |
 * |--------------------|----------------------|----------------------|----------------------------------------------|
 * | `bollard`          | Porto (cais)         | 0,5 × 0,56 × 0,5 m   | degrau de 0,5 m, para bala, sem navegação    |
 * | `silo`             | Fazenda              | 3 × 9,1 × 3 m        | para bala e visão                            |
 * | `tractor`          | Fazenda              | 2 × 2,8 × 3,25 m     | 6 caixas em degrau, para bala, visão parcial |
 * | `hay-roll`         | Fazenda              | 1,5 × 1,5 × 1,5 m    | para bala, visão parcial, andável            |
 * | `inflatable-can`   | Galpão de Paintball  | 1 × 2 × 1 m          | cobertura alta, para bala e visão            |
 * | `inflatable-cube`  | Galpão de Paintball  | 1 × 1 × 1 m          | cobertura baixa, andável                     |
 * | `inflatable-wedge` | Galpão de Paintball  | 1,5 × 1 × 1 m        | cobertura baixa (cunha deitada, 2 degraus)   |
 * | `inflatable-wall`  | Galpão de Paintball  | 2 × 2 × 0,5 m        | cobertura alta, para bala e visão            |
 *
 * Os infláveis têm uma cor cada (vermelho-escuro, branco-gelo, areia e azul-aço apagados): nada de verde (some na
 * grama sintética) nem de cor perto das 8 de time (laranja, azul, verde, roxo, vermelho, amarelo, rosa e ciano, todas
 * vivas); o vermelho e o ocre ficam nos tons de baixo e apagados da paleta.
 */
import { MODEL_FLAG, type TexelVec3 } from '@boboforces/format';
import {
  LayerCanvas,
  ModelBuilder,
  type BuiltModel,
  type PartBuilder,
  type Painter,
  type Tile,
} from '../../tools/modelgen/src/builder.ts';
import { tone } from '../../tools/skingen/src/palette.ts';

const F = MODEL_FLAG;
const SIGHT_PARTIAL = F.blocksSight | F.partialSight;

/** As duas camadas do kit, criadas a cada geração (`buildModels`), como a dos modelos pequenos do Zombies. */
export interface MapKitLayers {
  /** `mdl_map_kit_1`: os infláveis e o cabeço do cais (o cabeço é o 1º do registro, então esta vem antes na tira). */
  readonly field: LayerCanvas;
  /** `mdl_map_kit_2`: o silo, o trator e o rolo de feno. */
  readonly farm: LayerCanvas;
}

export function createMapKitLayers(): MapKitLayers {
  return {
    field: new LayerCanvas('mdl_map_kit_1', 'opaque', tone('aco', 1)),
    farm: new LayerCanvas('mdl_map_kit_2', 'opaque', tone('aco', 1)),
  };
}

function hline(p: Painter, y: number, rgb: number): void {
  for (let x = 0; x < p.w; x++) p.px(x, y, rgb);
}

function vline(p: Painter, x: number, rgb: number): void {
  for (let y = 0; y < p.h; y++) p.px(x, y, rgb);
}

type V3 = [number, number, number];

/**
 * Trapézio plano (a, b na aresta de baixo; c, d na de cima) com a UV esticada na largura do ladrilho: o chanfro dos
 * infláveis. A ordem dos cantos é acertada pela normal de fora (`out`).
 */
function trapezoid(part: PartBuilder, a: V3, b: V3, c: V3, d: V3, out: TexelVec3, tile: Tile): void {
  const slant = Math.min(tile.h, Math.max(1, Math.round(Math.hypot(d[0] - a[0], d[1] - a[1], d[2] - a[2]))));
  const width = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const along = (p: V3): number => {
    const t = ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1]) + (p[2] - a[2]) * (b[2] - a[2])) / width;
    return Math.max(0, Math.min(tile.w, Math.round((t / width) * tile.w)));
  };
  const uv = (p: V3, top: boolean): readonly [number, number] => [along(p), top ? 0 : slant];
  const e1: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const e2: V3 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
  const n: V3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const facesOut = n[0] * out[0] + n[1] * out[1] + n[2] * out[2] > 0;
  const [p0, p1, p2, p3] = facesOut ? [a, b, c, d] : [b, a, d, c];
  const tops = facesOut ? [false, false, true, true] : [false, false, true, true];
  part.tri([p0, p1, p2], [uv(p0, tops[0]!), uv(p1, tops[1]!), uv(p2, tops[2]!)], tile);
  part.tri([p0, p2, p3], [uv(p0, tops[0]!), uv(p2, tops[2]!), uv(p3, tops[3]!)], tile);
}

/** Caixa estofada: as 4 laterais até `max.y − bevel`, o tampo recuado e os 4 chanfros de 45°. */
function pillowBox(part: PartBuilder, min: V3, max: V3, bevel: number, tile: Tile): void {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const yb = y1 - bevel;
  part.tiledBox([x0, y0, z0], [x1, yb, z1], { right: tile, left: tile, front: tile, back: tile });
  const xa = x0 + bevel;
  const xb = x1 - bevel;
  const za = z0 + bevel;
  const zb = z1 - bevel;
  part.quad(
    [
      [xa, y1, za],
      [xb, y1, za],
      [xb, y1, zb],
      [xa, y1, zb],
    ],
    tile,
  );
  trapezoid(part, [x0, yb, z0], [x1, yb, z0], [xb, y1, za], [xa, y1, za], [0, 1, -1], tile);
  trapezoid(part, [x1, yb, z1], [x0, yb, z1], [xa, y1, zb], [xb, y1, zb], [0, 1, 1], tile);
  trapezoid(part, [x0, yb, z1], [x0, yb, z0], [xa, y1, za], [xa, y1, zb], [-1, 1, 0], tile);
  trapezoid(part, [x1, yb, z0], [x1, yb, z1], [xb, y1, zb], [xb, y1, za], [1, 1, 0], tile);
}

// ---------------------------------------------------------------------------------------------------------------
// Porto

/** Cabeço de amarração do cais: chapa de base, corpo de ferro fundido de 8 lados e a cabeça amarela. */
export function bollard(kit: MapKitLayers): BuiltModel {
  const m = new ModelBuilder('bollard', 'prop', {
    flags: F.blocksBullets | F.walkable | F.blobShadow,
    debrisColor: tone('concreto', 1),
    blocksNav: false,
  });
  const L = m.useLayer(kit.field);
  const iron = m.tile(L, 8, 8, (p) => {
    p.fill(tone('concreto', 1));
    vline(p, 0, tone('concreto', 2));
    vline(p, 7, tone('concreto', 0));
    p.px(3, 2, tone('concreto', 2));
  });
  const head = m.tile(L, 8, 8, (p) => {
    p.fill(tone('amarelo', 1));
    hline(p, 0, tone('amarelo', 2));
    hline(p, 7, tone('amarelo', 0));
  });
  const body = m.part('body');
  body.tiledBox([-8, 0, -8], [8, 2, 8], { top: iron, right: iron, left: iron, front: iron, back: iron });
  body.prism('y', [0, 0], 2, 12, 6, 8, iron, null);
  body.prism('y', [0, 0], 14, 4, 8, 8, head, head, [true, true]);
  m.collider([-8, 0, -8], [8, 16, 8]);
  return m.build();
}

// ---------------------------------------------------------------------------------------------------------------
// Fazenda

/** Silo de chapa ondulada: corpo de 12 lados (Ø 3 m, 8 m), telhado cônico e o respiro no topo. */
export function silo(kit: MapKitLayers): BuiltModel {
  const m = new ModelBuilder('silo', 'prop', {
    flags: F.blocksBullets | F.blocksSight,
    debrisColor: tone('aco', 2),
    blocksNav: true,
  });
  const L = m.useLayer(kit.farm);
  // 25 de largura (a corda do lado de 12 com raio 48) × 64: as nervuras horizontais e a costura parafusada (o ladrilho
  // alto corta o corpo de 8 m em 4 pedaços por lado, não em 8).
  const side = m.tile(L, 25, 64, (p) => {
    const rows = [tone('aco', 3), tone('aco', 2), tone('aco', 2), tone('aco', 1)];
    for (let y = 0; y < p.h; y++) hline(p, y, rows[y % 4]!);
    for (let y = 1; y < p.h; y += 4) p.px(0, y, tone('aco', 0));
    for (const [x, y] of [
      [7, 9],
      [18, 21],
    ] as const) {
      for (let k = 0; k < 4; k++) p.px(x, y + k, tone('terra', 3));
    }
  });
  const roof = m.tile(L, 16, 16, (p) => {
    p.fill(tone('aco', 2));
    p.blotches(3, tone('aco', 1));
    p.blotches(2, tone('aco', 3), 2, 2);
    vline(p, 0, tone('aco', 1));
  });
  const body = m.part('body');
  body.prism('y', [0, 0], 0, 256, 48, 12, side, null);
  body.frustum([0, 0], 256, 288, 50, 8, 12, roof, null);
  body.prism('y', [0, 0], 288, 4, 8, 8, roof, roof, [false, true]);
  m.collider([-48, 0, -48], [48, 292, 48]);
  return m.build();
}

/**
 * Trator genérico: capô com a grade, corpo, assento, para-lamas, arco de proteção, escapamento e as 4 rodas, em
 * vermelho-escuro (os tons de baixo do `tijolo`). Colisão em 6 caixas de degrau (rodas de trás com os para-lamas, corpo,
 * assento, capô e rodas da frente): bala para no que se vê e quem sobe pisa no topo de cada peça.
 */
export function tractor(kit: MapKitLayers): BuiltModel {
  const m = new ModelBuilder('tractor', 'prop', {
    flags: F.blocksBullets | SIGHT_PARTIAL | F.walkable | F.blobShadow,
    debrisColor: tone('tijolo', 1),
    blocksNav: true,
  });
  const L = m.useLayer(kit.farm);
  const paint = m.tile(L, 20, 20, (p) => {
    p.fill(tone('tijolo', 1));
    p.blotches(5, tone('tijolo', 0));
    p.blotches(3, tone('tijolo', 2), 2, 2);
    hline(p, 0, tone('tijolo', 2));
  });
  const steel = m.tile(L, 4, 24, (p) => {
    p.fill(tone('aco', 0));
    vline(p, 0, tone('aco', 1));
  });
  const tread = m.tile(L, 16, 12, (p) => {
    p.fill(tone('concreto', 0));
    // Garras da banda de rodagem em V.
    for (let x = 0; x < 16; x += 4) {
      for (let k = 0; k < 3; k++) {
        p.px(x + k, 2 + k, tone('concreto', 1));
        p.px(x + k, 9 - k, tone('concreto', 1));
      }
    }
  });
  // Calota (a tampa da roda é o ladrilho inteiro reduzido ao disco): pneu, aro claro, cubo e o eixo.
  const hub = m.tile(L, 12, 12, (p) => {
    for (let y = 0; y < 12; y++) {
      for (let x = 0; x < 12; x++) {
        const d = Math.hypot(x - 5.5, y - 5.5);
        const c =
          d < 1.6 ? tone('aco', 0) : d < 3.2 ? tone('aco', 2) : d < 4.4 ? tone('placa', 1) : tone('concreto', 0);
        p.px(x, y, c);
      }
    }
  });
  // Grade do capô: moldura vermelha, aletas escuras e os dois faróis nos cantos de cima.
  const grille = m.tile(L, 16, 12, (p) => {
    p.fill(tone('tijolo', 1));
    p.rect(3, 3, 10, 8, tone('concreto', 0));
    for (let x = 4; x < 13; x += 2) for (let y = 4; y < 10; y++) p.px(x, y, tone('concreto', 1));
    p.rect(0, 0, 3, 3, tone('placa', 3));
    p.rect(13, 0, 3, 3, tone('placa', 3));
    p.px(1, 1, tone('amarelo', 2));
    p.px(14, 1, tone('amarelo', 2));
    hline(p, 11, tone('tijolo', 0));
  });
  const body = m.part('body');
  // Capô (frente −Z), chassi escuro embaixo e o corpo de trás (o assento e o arco ficam em cima).
  body.tiledBox([-10, 24, -52], [10, 44, -12], { front: grille, top: paint, right: paint, left: paint });
  body.tiledBox([-8, 14, -52], [8, 24, 8], { front: tread, right: tread, left: tread });
  body.tiledBox([-14, 24, -12], [14, 40, 20], { front: paint, back: paint, top: paint, right: paint, left: paint });
  body.tiledBox([-6, 40, 8], [6, 44, 16], { front: tread, back: tread, top: tread, right: tread, left: tread });
  body.tiledBox([-6, 44, 16], [6, 54, 18], { front: tread, back: tread, top: tread, right: tread, left: tread });
  // Para-lamas sobre as rodas de trás.
  for (const x0 of [16, -28]) {
    body.tiledBox([x0, 48, 6], [x0 + 12, 52, 38], { top: paint, front: paint, back: paint, right: paint, left: paint });
  }
  // Arco de proteção (dois montantes e a travessa) e o escapamento na frente.
  for (const x0 of [-15, 13])
    body.tiledBox([x0, 44, 18], [x0 + 2, 88, 20], { front: steel, back: steel, right: steel, left: steel });
  body.tiledBox([-15, 88, 18], [15, 91, 20], { front: paint, back: paint, top: paint });
  body.tiledBox([6, 44, -30], [8, 64, -28], { front: steel, back: steel, right: steel, left: steel });
  // Rodas: as de trás grandes (Ø 1,5 m, 10 lados), as da frente pequenas (Ø 0,8 m, 8 lados); calota só de fora.
  body.prism('x', [22, 24], 16, 12, 24, 10, tread, hub, [false, true]);
  body.prism('x', [22, 24], -28, 12, 24, 10, tread, hub, [true, false]);
  body.prism('x', [-40, 13], 12, 8, 13, 8, tread, hub, [false, true]);
  body.prism('x', [-40, 13], -20, 8, 13, 8, tread, hub, [true, false]);
  // Caixas de colisão em degrau (pegadas em múltiplos de 0,5 m). O arco de proteção e o escapamento, finos, ficam sem.
  m.collider([-32, 0, 0], [-16, 52, 48]); // roda de trás e para-lama, esquerda
  m.collider([16, 0, 0], [32, 52, 48]); // roda de trás e para-lama, direita
  m.collider([-16, 0, -16], [16, 40, 16]); // corpo (o piso de trás a 1,25 m)
  m.collider([-8, 40, 0], [8, 48, 16]); // assento
  m.collider([-16, 0, -56], [16, 44, -8]); // capô e chassi
  m.collider([-24, 0, -56], [24, 28, -24]); // rodas da frente
  return m.build();
}

/** Rolo de feno deitado (Ø 1,5 m × 1,5 m, 10 lados): a palha enrolada em volta e a espiral nas pontas. */
export function hayRoll(kit: MapKitLayers): BuiltModel {
  const m = new ModelBuilder('hay-roll', 'prop', {
    flags: F.blocksBullets | SIGHT_PARTIAL | F.walkable | F.blobShadow,
    debrisColor: tone('areia', 2),
    blocksNav: true,
  });
  const L = m.useLayer(kit.farm);
  const straw = m.tile(L, 16, 16, (p) => {
    p.fill(tone('areia', 2));
    for (let i = 0; i < 10; i++) {
      const y = p.rng.int(0, 16);
      const x = p.rng.int(0, 16);
      for (let k = 0; k < p.rng.int(3, 7); k++) p.px(x + k, y, i % 3 === 0 ? tone('areia', 1) : tone('areia', 3));
    }
    for (let k = 0; k < 3; k++) p.px(p.rng.int(0, 16), p.rng.int(0, 16), tone('amarelo', 2));
    hline(p, 5, tone('terra', 3));
  });
  const spiral = m.tile(L, 12, 12, (p) => {
    for (let y = 0; y < 12; y++) {
      for (let x = 0; x < 12; x++) {
        const d = Math.hypot(x - 5.5, y - 5.5) + Math.atan2(y - 5.5, x - 5.5) / Math.PI;
        const ring = Math.floor(d / 1.5) % 3;
        p.px(x, y, ring === 0 ? tone('areia', 1) : ring === 1 ? tone('areia', 2) : tone('areia', 3));
      }
    }
  });
  m.part('body').prism('x', [0, 24], -24, 48, 24, 10, straw, spiral, [true, true]);
  m.collider([-24, 0, -24], [24, 48, 24]);
  return m.build();
}

// ---------------------------------------------------------------------------------------------------------------
// Galpão de Paintball

/**
 * Tecido inflável de uma cor, em gomos verticais estufados: a costura escura na esquerda, a luz larga no primeiro
 * terço (a luz vem de cima/esquerda), o meio no tom base e a sombra antes da próxima costura; a costura horizontal em
 * cima marca o painel (o ladrilho repete a cada `size` texels).
 */
function inflatableTile(
  m: ModelBuilder,
  layer: LayerCanvas,
  size: number,
  ramp: Parameters<typeof tone>[0],
  base: number,
): Tile {
  return m.tile(layer, size, size, (p) => {
    const light = Math.round(size * 0.15);
    const lightEnd = Math.round(size * 0.45);
    const shadow = Math.round(size * 0.8);
    for (let x = 0; x < size; x++) {
      const t = x === 0 || x >= shadow ? base - 1 : x >= light && x < lightEnd ? base + 1 : base;
      vline(p, x, tone(ramp, t));
    }
    hline(p, 0, tone(ramp, base - 1));
  });
}

/**
 * Lata (cilindro de 12 lados, Ø 1 m × 2 m) vermelho-escura (os tons de baixo do `tijolo`, longe do vermelho vivo do
 * time) com duas faixas brancas e a tampa arredondada.
 */
export function inflatableCan(kit: MapKitLayers): BuiltModel {
  const m = new ModelBuilder('inflatable-can', 'prop', {
    flags: F.blocksBullets | F.blocksSight | F.blobShadow,
    debrisColor: tone('tijolo', 1),
    blocksNav: true,
  });
  const L = m.useLayer(kit.field);
  const red = m.tile(L, 24, 24, (p) => {
    p.fill(tone('tijolo', 1));
    for (let x = 0; x < 24; x += 8) {
      vline(p, x, tone('tijolo', 0));
      vline(p, x + 2, tone('tijolo', 2));
    }
    for (const y of [10, 11]) hline(p, y, tone('placa', 3));
    hline(p, 12, tone('placa', 1));
  });
  const body = m.part('body');
  body.prism('y', [0, 0], 0, 56, 16, 12, red, null);
  body.frustum([0, 0], 56, 62, 16, 11, 12, red, null);
  body.frustum([0, 0], 62, 64, 11, 0, 12, red, null);
  m.collider([-16, 0, -16], [16, 64, 16]);
  return m.build();
}

/** Bloco estofado branco-gelo (1 m), chanfrado em cima (branco e não verde: o campo é de grama sintética). */
export function inflatableCube(kit: MapKitLayers): BuiltModel {
  const m = new ModelBuilder('inflatable-cube', 'prop', {
    flags: F.blocksBullets | SIGHT_PARTIAL | F.walkable | F.blobShadow,
    debrisColor: tone('placa', 2),
    blocksNav: true,
  });
  const white = inflatableTile(m, m.useLayer(kit.field), 24, 'placa', 2);
  pillowBox(m.part('body'), [-16, 0, -16], [16, 32, 16], 4, white);
  m.collider([-16, 0, -16], [16, 32, 16]);
  return m.build();
}

/**
 * Cunha: o inflável deitado de seção triangular (1,5 m de comprimento, base de 1 m, 1 m de altura), com a crista
 * arredondada, em areia (o ocre apagado; o amarelo vivo é de time). Colisão em degraus: a base inteira até 0,5 m e a
 * metade do meio até 1 m (uma caixa só faria parede invisível nas encostas).
 */
export function inflatableWedge(kit: MapKitLayers): BuiltModel {
  const m = new ModelBuilder('inflatable-wedge', 'prop', {
    flags: F.blocksBullets | SIGHT_PARTIAL | F.blobShadow,
    debrisColor: tone('areia', 1),
    blocksNav: true,
  });
  // 30 × 30: o perfil cabe inteiro no ladrilho da tampa (a ponta não estica).
  const sand = inflatableTile(m, m.useLayer(kit.field), 30, 'areia', 1);
  const profile = [
    [-15, 0],
    [15, 0],
    [3, 29],
    [0, 30],
    [-3, 29],
  ] as const;
  m.part('body').extrudeX(profile, -24, 24, sand, sand);
  m.collider([-24, 0, -16], [24, 16, 16]);
  m.collider([-24, 16, -8], [24, 32, 8]);
  return m.build();
}

/** Parede estofada azul-aço (2 m × 2 m × 0,5 m): cobertura alta, chanfrada em cima. */
export function inflatableWall(kit: MapKitLayers): BuiltModel {
  const m = new ModelBuilder('inflatable-wall', 'prop', {
    flags: F.blocksBullets | F.blocksSight,
    debrisColor: tone('aco', 2),
    blocksNav: true,
  });
  const blue = inflatableTile(m, m.useLayer(kit.field), 24, 'aco', 2);
  pillowBox(m.part('body'), [-32, 0, -8], [32, 64, 8], 4, blue);
  m.collider([-32, 0, -8], [32, 64, 8]);
  return m.build();
}

/**
 * Receitas na ordem em que os ladrilhos são alocados nas camadas compartilhadas (o pacote sai na ordem do registro
 * de conteúdo). O ladrilho de 30 × 30 da cunha entra primeiro na `mdl_map_kit_1`, antes dos de 24 × 24.
 */
export const MAP_KIT_RECIPES: readonly ((kit: MapKitLayers) => BuiltModel)[] = [
  silo,
  tractor,
  hayRoll,
  inflatableWedge,
  inflatableCan,
  inflatableCube,
  inflatableWall,
  bollard,
];
