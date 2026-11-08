/**
 * Props fora da grade do Construto (arte-ux.md §1.4 e §5.1–§5.2; tecnico.md §6.6): barril, caixa d'água, jipe,
 * holofote (emissivo), gerador, cano (cilindro de 8 lados), coluna (12 lados), lona/tenda, árvore low-poly, sacos de
 * areia e o caixote grande. Fonte da verdade em texto; `npm run modelgen` gera o pacote e as camadas.
 *
 * Regras: ≤ 300 triângulos, textura 32 px/m numa camada 64×64 por prop (ladrilhos de material repetidos nas faces
 * grandes), militar genérico sem marca nem bandeira (#19), saturação do cenário (as cores de time ficam de fora).
 * Cada prop declara caixas de colisão alinhadas aos eixos (não existe colisor cilíndrico), se para bala, se tapa a
 * visão (sim / parcial / não), se dá para andar em cima, se ocupa navegação e a cor dos cubinhos. Pivô no CHÃO, no
 * centro da pegada; a pegada fica em múltiplos de 0,5 m (16 texels) para cair certinho nas células da grade.
 *
 * Visão dos bots: "sim" = `blocksSight`; "parcial" = `blocksSight | partialSight` (cobertura baixa, ~1 m); "não" = 0.
 */
import { MODEL_FLAG } from '@boboforces/format';
import { ModelBuilder, type BuiltModel, type LayerCanvas, type Painter } from '../../tools/modelgen/src/builder.ts';
import { shiftTone, tone } from '../../tools/skingen/src/palette.ts';

export interface PropContext {
  /** Camada emissiva compartilhada (`mdl_glow`): lente do holofote, lâmpada do gerador. */
  readonly glow: LayerCanvas;
}

const F = MODEL_FLAG;
const SIGHT_PARTIAL = F.blocksSight | F.partialSight;

/** Linha horizontal inteira. */
function hline(p: Painter, y: number, rgb: number): void {
  for (let x = 0; x < p.w; x++) p.px(x, y, rgb);
}

function vline(p: Painter, x: number, rgb: number): void {
  for (let y = 0; y < p.h; y++) p.px(x, y, rgb);
}

/** Metal pintado com desgaste em manchas (sem costura). */
function paintedMetal(
  p: Painter,
  ramp: 'metal' | 'laranja' | 'aco' | 'placa' | 'concreto',
  base: number,
  wear = 6,
): void {
  p.fill(tone(ramp, base));
  p.blotches(wear, tone(ramp, base - 1));
  p.blotches(Math.ceil(wear / 2), tone(ramp, base + 1));
}

// ---------------------------------------------------------------------------------------------------------------

/** Tambor de 0,5 m × 0,875 m, 12 lados, laranja de segurança com frisos. */
export function barrel(): BuiltModel {
  const m = new ModelBuilder('barrel', 'prop', {
    flags: F.blocksBullets | SIGHT_PARTIAL | F.walkable | F.blobShadow,
    debrisColor: tone('laranja', 2),
    blocksNav: true,
  });
  const L = m.layer('mdl_barrel', 'opaque', tone('laranja', 1));
  const side = m.tile(L, 48, 28, (p) => {
    paintedMetal(p, 'laranja', 2, 5);
    hline(p, 0, tone('laranja', 3));
    hline(p, 1, tone('laranja', 3));
    for (const y of [9, 18]) {
      hline(p, y, tone('laranja', 3));
      hline(p, y + 1, tone('laranja', 1));
    }
    hline(p, 26, tone('laranja', 1));
    hline(p, 27, tone('laranja', 0));
    // Etiqueta clara com pictograma de gota (sem texto) num dos lados.
    p.rect(20, 12, 8, 4, tone('placa', 2));
    p.px(23, 13, tone('laranja', 0));
    p.px(24, 13, tone('laranja', 0));
    p.px(23, 14, tone('laranja', 0));
    p.px(24, 14, tone('laranja', 0));
    p.px(24, 12, tone('laranja', 0));
  });
  const cap = m.tile(L, 16, 16, (p) => {
    p.fill(tone('laranja', 2));
    for (let i = 0; i < 16; i++) {
      p.px(i, 0, tone('laranja', 1));
      p.px(0, i, tone('laranja', 1));
    }
    p.rect(3, 3, 2, 2, tone('aco', 1));
    p.rect(10, 10, 3, 3, tone('aco', 1));
    p.px(11, 11, tone('aco', 0));
  });
  const body = m.part('body');
  body.prism('y', [0, 0], 0, 28, 8, 12, side, cap, [false, true]);
  m.collider([-8, 0, -8], [8, 28, 8]);
  return m.build();
}

/** Caixa d'água de 1,5 m de diâmetro sobre laje de concreto, telhado cônico, tampa e escada. */
export function waterTank(): BuiltModel {
  const m = new ModelBuilder('water-tank', 'prop', {
    flags: F.blocksBullets | F.blocksSight,
    debrisColor: tone('placa', 1),
    blocksNav: true,
  });
  const L = m.layer('mdl_water_tank', 'opaque', tone('placa', 0));
  // 48 × 24: o tanque de 48 de altura repete o ladrilho 2 vezes (as emendas a cada 12 linhas disfarçam).
  const side = m.tile(L, 48, 24, (p) => {
    p.fill(tone('placa', 1));
    p.blotches(8, tone('placa', 0));
    p.blotches(5, tone('placa', 2));
    hline(p, 0, tone('placa', 2));
    hline(p, 12, tone('placa', 0));
    // Escorridos de ferrugem curtos e um pictograma de gota azulada.
    for (const [x, y] of [
      [5, 13],
      [17, 1],
      [33, 14],
      [41, 2],
    ] as const) {
      for (let k = 0; k < 3; k++) p.px(x, y + k, tone('terra', 3));
    }
    p.rect(22, 16, 3, 4, tone('aco', 1));
    p.px(23, 15, tone('aco', 1));
  });
  const roof = m.tile(L, 12, 22, (p) => {
    p.fill(tone('concreto', 3));
    p.blotches(3, tone('concreto', 2));
    hline(p, p.h - 1, tone('concreto', 2));
  });
  const slab = m.tile(L, 32, 32, (p) => {
    p.fill(tone('concreto', 3));
    p.blotches(10, tone('concreto', 2));
    p.blotches(5, tone('concreto', 4));
  });
  const lid = m.tile(L, 8, 8, (p) => {
    p.fill(tone('aco', 1));
    p.px(3, 3, tone('aco', 2));
  });
  const body = m.part('body');
  body.tiledBox([-24, 0, -24], [24, 4, 24], { top: slab, right: slab, left: slab, front: slab, back: slab });
  body.prism('y', [0, 0], 4, 48, 24, 12, side, null);
  body.frustum([0, 0], 52, 60, 24, 4, 12, roof, null);
  body.prism('y', [0, 0], 60, 2, 4, 12, lid, lid, [false, true]);
  // Escada na frente: dois montantes e 6 degraus (a mesma UV repetida).
  const metal = (_f: string, p: Painter): void => {
    p.fill(tone('aco', 1));
    hline(p, 0, tone('aco', 2));
  };
  // Montantes como prismas de 4 lados (vigas de 2×2 texels) num ladrilho fino; degraus como caixas.
  const railTile = m.tile(L, 8, 26, (p) => {
    p.fill(tone('aco', 1));
    vline(p, 0, tone('aco', 2));
  });
  body.prism('y', [-5, -26], 0, 52, 1.42, 4, railTile, null);
  body.prism('y', [5, -26], 0, 52, 1.42, 4, railTile, null);
  const rung = body.box([-4, 10, -26.5], [8, 1, 1], L, metal);
  for (const y of [18, 26, 34, 42, 50]) body.boxLike([-4, y, -26.5], rung);
  m.collider([-24, 0, -24], [24, 60, 24]);
  return m.build();
}

/** Jipe militar genérico low-poly: 3 m × 1,5 m, caçamba aberta, para-brisa sem vidro, estepe atrás. */
export function jeep(): BuiltModel {
  const m = new ModelBuilder('jeep', 'prop', {
    flags: F.blocksBullets | SIGHT_PARTIAL | F.walkable,
    debrisColor: tone('metal', 3),
    blocksNav: true,
  });
  const L = m.layer('mdl_jeep', 'opaque', tone('metal', 2));
  const panel = m.tile(L, 32, 32, (p) => {
    paintedMetal(p, 'metal', 3, 8);
    for (const [x, y] of [
      [1, 1],
      [30, 1],
      [1, 30],
      [30, 30],
    ] as const) {
      p.px(x, y, tone('metal', 4));
    }
  });
  const grille = m.tile(L, 32, 16, (p) => {
    paintedMetal(p, 'metal', 3, 3);
    // Grade de frestas verticais no meio e dois faróis redondos (claros) nas pontas.
    for (let x = 9; x <= 22; x += 2) for (let y = 3; y <= 12; y++) p.px(x, y, tone('metal', 0));
    for (const cx of [3, 26]) {
      p.rect(cx, 5, 3, 3, tone('placa', 2));
      p.px(cx + 1, 6, tone('amarelo', 2));
      p.rect(cx, 4, 3, 1, tone('metal', 1));
    }
    hline(p, 15, tone('metal', 1));
  });
  const tread = m.tile(L, 16, 8, (p) => {
    p.fill(tone('concreto', 0));
    for (let x = 0; x < 16; x += 4) {
      p.px(x, 1, tone('concreto', 1));
      p.px(x + 1, 2, tone('concreto', 1));
      p.px(x, 5, tone('concreto', 1));
      p.px(x + 1, 6, tone('concreto', 1));
    }
  });
  const hub = m.tile(L, 16, 16, (p) => {
    p.fill(tone('concreto', 0));
    p.rect(4, 4, 8, 8, tone('metal', 3));
    p.rect(6, 6, 4, 4, tone('metal', 2));
    p.rect(7, 7, 2, 2, tone('aco', 1));
  });
  const seat = m.tile(L, 16, 16, (p) => {
    p.fill(tone('lona', 1));
    p.blotches(3, tone('lona', 0));
    hline(p, 0, tone('lona', 2));
    vline(p, 8, tone('lona', 0));
  });
  const bar = m.tile(L, 32, 4, (p) => {
    p.fill(tone('aco', 0));
    hline(p, 0, tone('aco', 1));
  });
  const body = m.part('body');
  // Caçamba (frente com a grade) e capô.
  body.tiledBox([-16, 8, -44], [16, 24, 44], {
    front: grille,
    back: panel,
    right: panel,
    left: panel,
    top: panel,
    bottom: null,
  });
  body.tiledBox([-16, 24, -44], [16, 30, -22], {
    front: panel,
    back: panel,
    right: panel,
    left: panel,
    top: panel,
    bottom: null,
  });
  // Para-lamas sobre as rodas.
  for (const sx of [1, -1]) {
    for (const z0 of [-40, 20]) {
      const x0 = sx > 0 ? 16 : -24;
      body.tiledBox([x0, 20, z0], [x0 + 8, 22, z0 + 20], {
        top: panel,
        bottom: panel,
        front: panel,
        back: panel,
        right: sx > 0 ? panel : null,
        left: sx > 0 ? null : panel,
      });
    }
  }
  // Rodas (8 lados, tampa só do lado de fora) e estepe atrás.
  for (const zc of [-30, 30]) {
    body.prism('x', [zc, 10], 16, 8, 10, 8, tread, hub, [false, true]);
    body.prism('x', [zc, 10], -24, 8, 10, 8, tread, hub, [true, false]);
  }
  body.prism('z', [0, 22], 44, 4, 8, 8, tread, hub, [false, true]);
  // Para-brisa sem vidro: dois montantes e a barra de cima.
  const post = body.box([-16, 24, -23], [2, 18, 2], L, (_f, p) => {
    p.fill(tone('aco', 0));
    vline(p, 0, tone('aco', 1));
  });
  body.boxLike([14, 24, -23], post);
  body.tiledBox([-16, 42, -23], [16, 44, -21], bar);
  // Bancos dianteiros (assento e encosto).
  for (const x0 of [-13, 3]) {
    body.tiledBox([x0, 24, -14], [x0 + 10, 28, -4], {
      top: seat,
      front: seat,
      back: seat,
      right: seat,
      left: seat,
      bottom: null,
    });
    body.tiledBox([x0, 28, -6], [x0 + 10, 38, -4], {
      top: seat,
      front: seat,
      back: seat,
      right: seat,
      left: seat,
      bottom: null,
    });
  }
  m.collider([-24, 0, -48], [24, 30, 48]);
  return m.build();
}

/** Holofote: base, poste de 2,25 m, travessa e duas cabeças com lente emissiva (fonte de luz 14). */
export function floodlight(ctx: PropContext): BuiltModel {
  const m = new ModelBuilder('floodlight', 'prop', {
    flags: F.emissive | F.blobShadow,
    debrisColor: tone('aco', 1),
    blocksNav: true,
  });
  const L = m.layer('mdl_floodlight', 'opaque', tone('aco', 1));
  const plate = m.tile(L, 16, 16, (p) => {
    p.fill(tone('aco', 1));
    p.bevel(0, 0, 16, 16);
    for (const [x, y] of [
      [2, 2],
      [13, 2],
      [2, 13],
      [13, 13],
    ] as const) {
      p.px(x, y, tone('aco', 0));
    }
  });
  const pole = m.tile(L, 4, 32, (p) => {
    p.fill(tone('aco', 1));
    vline(p, 0, tone('aco', 2));
    p.blotches(2, tone('aco', 0), 1, 2);
  });
  const crossbar = m.tile(L, 28, 4, (p) => {
    p.fill(tone('aco', 0));
    hline(p, 0, tone('aco', 1));
  });
  const housing = m.tile(L, 10, 10, (p) => {
    p.fill(tone('aco', 0));
    for (let y = 1; y < 10; y += 2) hline(p, y, tone('aco', 1));
  });
  const glow = m.tile(m.useLayer(ctx.glow), 10, 10, (p) => {
    p.fill(tone('emissivo', 2));
    p.rect(0, 0, 10, 1, tone('emissivo', 1));
    p.rect(0, 9, 10, 1, tone('emissivo', 1));
    p.rect(0, 0, 1, 10, tone('emissivo', 1));
    p.rect(9, 0, 1, 10, tone('emissivo', 1));
    p.rect(4, 4, 2, 2, tone('neutro', 1));
  });
  const body = m.part('body');
  body.tiledBox([-8, 0, -8], [8, 4, 8], {
    top: plate,
    front: plate,
    back: plate,
    right: plate,
    left: plate,
    bottom: null,
  });
  body.tiledBox([-2, 4, -2], [2, 72, 2], { front: pole, back: pole, right: pole, left: pole, top: null, bottom: null });
  body.tiledBox([-14, 72, -2], [14, 75, 2], crossbar);
  for (const x0 of [-14, 4]) {
    body.tiledBox([x0, 66, -8], [x0 + 10, 76, -2], {
      front: glow,
      back: housing,
      right: housing,
      left: housing,
      top: housing,
      bottom: housing,
    });
  }
  m.light([0, 71, -10], 14);
  m.collider([-8, 0, -8], [8, 76, 8]);
  return m.build();
}

/** Cano de 8 lados (2 m, Ø 0,37 m) deitado sobre dois berços, com flanges nas pontas. Degrau de 0,5 m. */
export function pipe(): BuiltModel {
  const m = new ModelBuilder('pipe', 'prop', {
    flags: F.blocksBullets | F.walkable | F.blobShadow,
    debrisColor: tone('aco', 1),
    blocksNav: false,
  });
  const L = m.layer('mdl_pipe', 'opaque', tone('aco', 1));
  const pipeSide = m.tile(L, 40, 32, (p) => {
    paintedMetal(p, 'aco', 1, 4);
    p.blotches(3, tone('terra', 3), 1, 2);
    p.blotches(2, tone('laranja', 1), 1, 2);
  });
  const flange = m.tile(L, 48, 3, (p) => {
    p.fill(tone('aco', 0));
    hline(p, 0, tone('aco', 1));
  });
  const face = m.tile(L, 16, 16, (p) => {
    p.fill(tone('aco', 1));
    p.rect(4, 4, 8, 8, tone('aco', 0));
    p.rect(6, 6, 4, 4, tone('concreto', 0));
    for (const [x, y] of [
      [2, 7],
      [13, 7],
      [7, 2],
      [7, 13],
    ] as const) {
      p.px(x, y, tone('aco', 2));
    }
  });
  const body = m.part('body');
  body.prism('x', [0, 8], -29, 58, 6, 8, pipeSide, null);
  body.prism('x', [0, 8], -32, 3, 8, 8, flange, face, [true, true]);
  body.prism('x', [0, 8], 29, 3, 8, 8, flange, face, [true, true]);
  const saddle = body.box([-22, 0, -6], [4, 4, 12], L, (f, p) => {
    p.fill(f === 'top' ? tone('concreto', 3) : tone('concreto', 2));
    p.blotches(2, tone('concreto', 1), 1, 2);
  });
  body.boxLike([18, 0, -6], saddle);
  m.collider([-32, 0, -8], [32, 16, 8]);
  return m.build();
}

/** Coluna de concreto de 12 lados (Ø 1 m, 3 m), plinto com faixa zebrada e capitel. */
export function column(): BuiltModel {
  const m = new ModelBuilder('column', 'prop', {
    flags: F.blocksBullets | F.blocksSight | F.walkable,
    debrisColor: tone('concreto', 3),
    blocksNav: true,
  });
  const L = m.layer('mdl_column', 'opaque', tone('concreto', 3));
  const shaft = m.tile(L, 24, 41, (p) => {
    paintedMetal(p, 'concreto', 3, 10);
    hline(p, 0, tone('concreto', 2));
    for (let x = 0; x < p.w; x += 8) p.px(x, 20, tone('concreto', 2));
  });
  const hazard = m.tile(L, 32, 8, (p) => {
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 32; x++) p.px(x, y, (x + y) % 8 < 4 ? tone('amarelo', 2) : tone('concreto', 0));
  });
  const block = m.tile(L, 32, 32, (p) => {
    p.fill(tone('concreto', 2));
    p.blotches(8, tone('concreto', 1));
    p.bevel(0, 0, 32, 32);
  });
  const body = m.part('body');
  body.tiledBox([-16, 0, -16], [16, 6, 16], {
    top: block,
    front: hazard,
    back: hazard,
    right: hazard,
    left: hazard,
    bottom: null,
  });
  body.prism('y', [0, 0], 6, 82, 16, 12, shaft, null);
  body.tiledBox([-16, 88, -16], [16, 96, 16], block);
  m.collider([-16, 0, -16], [16, 96, 16]);
  return m.build();
}

/** Tenda de lona (2 m × 2,5 m, cumeeira a 1,5 m): duas águas, saias, empenas, porta e mastros. Balança no vento. */
export function tarp(): BuiltModel {
  const m = new ModelBuilder('tarp', 'prop', {
    flags: F.blocksSight | F.swaysInWind,
    debrisColor: tone('lona', 2),
    blocksNav: true,
  });
  const L = m.layer('mdl_tarp', 'opaque', tone('lona', 1));
  const gable = m.tile(L, 32, 48, (p) => {
    p.fill(tone('lona', 2));
    p.blotches(8, tone('lona', 1));
    hline(p, 40, tone('lona', 1));
  });
  const canvas = m.tile(L, 30, 26, (p) => {
    p.fill(tone('lona', 2));
    p.blotches(6, tone('lona', 1));
    hline(p, 0, tone('lona', 1));
    vline(p, 0, tone('lona', 1));
  });
  const door = m.tile(L, 16, 24, (p) => {
    p.fill(tone('lona', 0));
    vline(p, 8, tone('lona', 1));
    hline(p, 0, tone('lona', 1));
  });
  const wood = m.tile(L, 8, 28, (p) => {
    p.fill(tone('madeira', 3));
    vline(p, 0, tone('madeira', 4));
    p.blotches(2, tone('madeira', 2), 1, 2);
  });
  const body = m.part('body');
  // Águas (frente e verso) e saias laterais.
  body.quad(
    [
      [0, 48, -40],
      [0, 48, 40],
      [-32, 8, 40],
      [-32, 8, -40],
    ],
    canvas,
    true,
  );
  body.quad(
    [
      [0, 48, 40],
      [0, 48, -40],
      [32, 8, -40],
      [32, 8, 40],
    ],
    canvas,
    true,
  );
  body.quad(
    [
      [-32, 8, -40],
      [-32, 8, 40],
      [-32, 0, 40],
      [-32, 0, -40],
    ],
    canvas,
    true,
  );
  body.quad(
    [
      [32, 8, 40],
      [32, 8, -40],
      [32, 0, -40],
      [32, 0, 40],
    ],
    canvas,
    true,
  );
  // Empenas: cada metade = 2 triângulos com UV 1:1 no ladrilho (u = |x|, v = 48 − y).
  for (const z of [-40, 40]) {
    const front = z < 0;
    for (const sx of [-1, 1]) {
      const apex = [0, 48, z] as const;
      const center = [0, 0, z] as const;
      const outer = [32 * sx, 0, z] as const;
      const eave = [32 * sx, 8, z] as const;
      // A frente aponta para −Z: a ordem dos vértices depende do lado e da empena.
      const flip = sx < 0 !== front;
      const t1 = flip ? ([apex, outer, center] as const) : ([apex, center, outer] as const);
      const t2 = flip ? ([apex, eave, outer] as const) : ([apex, outer, eave] as const);
      const uvOf = (p: readonly [number, number, number]): readonly [number, number] => [Math.abs(p[0]), 48 - p[1]];
      body.tri(t1, [uvOf(t1[0]), uvOf(t1[1]), uvOf(t1[2])], gable, true);
      body.tri(t2, [uvOf(t2[0]), uvOf(t2[1]), uvOf(t2[2])], gable, true);
    }
  }
  body.quad(
    [
      [8, 24, -41],
      [-8, 24, -41],
      [-8, 0, -41],
      [8, 0, -41],
    ],
    door,
  );
  // Cumeeira e mastros (prismas de 4 lados = vigas quadradas de 2 texels).
  body.prism('z', [0, 49], -42, 84, 1.5, 4, wood, null);
  body.prism('y', [0, -39], 0, 48, 1.5, 4, wood, null);
  body.prism('y', [0, 39], 0, 48, 1.5, 4, wood, null);
  m.collider([-32, 0, -40], [32, 48, 40]);
  return m.build();
}

/** Gerador sobre esquis: corpo de 1 × 0,75 × 1,5 m, respiros, painel com mostradores e lâmpada âmbar (luz 6). */
export function generator(ctx: PropContext): BuiltModel {
  const m = new ModelBuilder('generator', 'prop', {
    flags: F.blocksBullets | SIGHT_PARTIAL | F.walkable | F.emissive,
    debrisColor: tone('metal', 3),
    blocksNav: true,
  });
  const L = m.layer('mdl_generator', 'opaque', tone('metal', 2));
  const skid = m.tile(L, 4, 48, (p) => {
    p.fill(tone('aco', 0));
    vline(p, 0, tone('aco', 1));
  });
  const side = m.tile(L, 48, 24, (p) => {
    paintedMetal(p, 'metal', 3, 6);
    // Respiros (venezianas) e pictograma de raio em quadrado escuro (sem texto).
    for (let y = 6; y <= 16; y += 2) for (let x = 4; x <= 22; x++) p.px(x, y, tone('metal', 1));
    p.rect(32, 6, 8, 8, tone('concreto', 0));
    for (const [x, y] of [
      [36, 7],
      [35, 8],
      [34, 9],
      [35, 9],
      [36, 9],
      [37, 9],
      [36, 10],
      [35, 11],
      [34, 12],
    ] as const) {
      p.px(x, y, tone('amarelo', 2));
    }
    hline(p, 0, tone('metal', 4));
  });
  const front = m.tile(L, 32, 24, (p) => {
    paintedMetal(p, 'metal', 3, 3);
    p.rect(4, 3, 24, 12, tone('concreto', 0));
    for (const cx of [7, 15]) {
      p.rect(cx, 5, 4, 4, tone('placa', 2));
      p.px(cx + 1, 6, tone('concreto', 0));
      p.px(cx + 2, 7, tone('concreto', 0));
    }
    p.rect(22, 6, 3, 3, tone('aco', 1));
    p.px(23, 7, tone('concreto', 0));
    hline(p, 0, tone('metal', 4));
  });
  const top = m.tile(L, 24, 24, (p) => {
    paintedMetal(p, 'metal', 3, 6);
    p.bevel(0, 0, 24, 24);
  });
  const body = m.part('body');
  body.tiledBox([-16, 4, -24], [16, 28, 24], { right: side, left: side, back: side, front, top, bottom: null });
  body.prism('z', [-12, 2], -24, 48, 2.83, 4, skid, skid);
  body.prism('z', [12, 2], -24, 48, 2.83, 4, skid, skid);
  body.box([8, 28, 12], [3, 8, 3], L, (_f, p) => {
    p.fill(tone('aco', 0));
    vline(p, 0, tone('aco', 1));
  });
  body.box([7.5, 36, 11.5], [4, 1, 4], L, (_f, p) => p.fill(tone('aco', 1)));
  body.box([-10, 28, 14], [4, 1, 4], L, (_f, p) => {
    p.fill(tone('laranja', 2));
    p.px(1, 1, tone('laranja', 3));
  });
  body.box([-4, 21, -25], [2, 2, 1], m.useLayer(ctx.glow), (_f, p) => p.fill(tone('emissivo', 1)));
  m.light([-3, 22, -27], 6);
  m.collider([-16, 0, -24], [16, 28, 24]);
  return m.build();
}

/** Pinheiro low-poly: tronco de 6 lados e três copas cônicas de 8 lados. Balança no vento. */
export function tree(): BuiltModel {
  const m = new ModelBuilder('tree', 'prop', {
    flags: F.blocksBullets | F.blocksSight | F.swaysInWind,
    debrisColor: tone('grama', 3),
    blocksNav: true,
  });
  const L = m.layer('mdl_tree', 'opaque', tone('grama', 2));
  const bark = m.tile(L, 24, 32, (p) => {
    p.fill(tone('madeira', 2));
    for (let x = 1; x < p.w; x += 4)
      for (let y = 0; y < p.h; y++) if ((y + x) % 7 !== 0) p.px(x, y, tone('madeira', 1));
    p.blotches(3, tone('madeira', 3), 1, 2);
  });
  const leaves = m.tile(L, 24, 40, (p) => {
    p.fill(tone('grama', 3));
    p.blotches(18, tone('grama', 2));
    p.blotches(12, tone('grama', 4));
    p.blotches(4, tone('grama', 5), 1, 2);
    hline(p, p.h - 1, tone('grama', 2));
  });
  const under = m.tile(L, 16, 16, (p) => {
    p.fill(tone('grama', 1));
    p.blotches(5, tone('grama', 2));
  });
  const body = m.part('body');
  body.prism('y', [0, 0], 0, 40, 4, 6, bark, null);
  body.frustum([0, 0], 16, 46, 28, 6, 8, leaves, under);
  body.frustum([0, 0], 38, 66, 22, 4, 8, leaves, under);
  body.frustum([0, 0], 58, 88, 15, 0, 8, leaves, under);
  m.collider([-8, 0, -8], [8, 64, 8]);
  return m.build();
}

/** Muro de sacos de areia arredondados (2 m × 1 m × 0,5 m): 4 + 3 + 4 sacos sextavados, um pouco amassados. */
export function sandbags(): BuiltModel {
  const m = new ModelBuilder('sandbags', 'prop', {
    flags: F.blocksBullets | SIGHT_PARTIAL | F.walkable,
    debrisColor: tone('areia', 1),
    blocksNav: true,
  });
  const L = m.layer('mdl_sandbags', 'opaque', tone('areia', 0));
  const burlap = m.tile(L, 16, 15, (p) => {
    p.fill(tone('areia', 1));
    p.blotches(5, tone('areia', 0));
    p.blotches(3, tone('areia', 2));
    vline(p, 0, tone('areia', 0));
  });
  const end = m.tile(L, 16, 12, (p) => {
    p.fill(tone('areia', 1));
    p.rect(6, 4, 4, 4, tone('areia', 0));
    p.px(7, 5, tone('lona', 0));
    p.px(8, 6, tone('lona', 0));
  });
  const body = m.part('body');
  const rows: readonly (readonly number[])[] = [
    [-32, -16, 0, 16],
    [-24, -8, 8],
    [-32, -16, 0, 16],
  ];
  rows.forEach((starts, row) => {
    const y = row * 10;
    const profile = [
      [-6, y],
      [6, y],
      [8, y + 6],
      [6, y + 12],
      [-6, y + 12],
      [-8, y + 6],
    ] as const;
    for (const x0 of starts) body.extrudeX(profile, x0, x0 + 15, burlap, end);
  });
  m.collider([-32, 0, -8], [32, 32, 8]);
  return m.build();
}

/** Caixote grande de 1 m (tábuas, moldura com bevel e travessa diagonal). ID a registrar: `model:crate-large`. */
export function crateLarge(): BuiltModel {
  const m = new ModelBuilder('crate-large', 'prop', {
    flags: F.blocksBullets | F.blocksSight | F.walkable,
    debrisColor: tone('madeira', 3),
    blocksNav: true,
  });
  const L = m.layer('mdl_crate_large', 'opaque', tone('madeira', 2));
  const face = m.tile(L, 32, 32, (p) => {
    p.fill(tone('madeira', 3));
    for (let y = 7; y < 32; y += 8) hline(p, y, tone('madeira', 2));
    p.blotches(6, tone('madeira', 2), 1, 2);
    // Moldura de 3 px com bevel e a travessa diagonal.
    for (let i = 0; i < 32; i++) {
      for (let k = 0; k < 3; k++) {
        p.px(i, k, tone('madeira', 4));
        p.px(i, 31 - k, tone('madeira', 4));
        p.px(k, i, tone('madeira', 4));
        p.px(31 - k, i, tone('madeira', 4));
      }
    }
    for (let i = 3; i < 29; i++) {
      p.px(i, 31 - i, tone('madeira', 4));
      p.px(i + 1, 31 - i, tone('madeira', 4));
      p.px(i + 2, 31 - i, shiftTone(tone('madeira', 4), -2));
    }
    p.bevel(0, 0, 32, 32);
    for (const [x, y] of [
      [1, 1],
      [30, 1],
      [1, 30],
      [30, 30],
    ] as const) {
      p.px(x, y, tone('aco', 1));
    }
  });
  const body = m.part('body');
  body.tiledBox([-16, 0, -16], [16, 32, 16], {
    top: face,
    front: face,
    back: face,
    right: face,
    left: face,
    bottom: null,
  });
  m.collider([-16, 0, -16], [16, 32, 16]);
  return m.build();
}

/** Props na ordem do registro de conteúdo (o caixote grande entra quando o ID for registrado). */
export const PROP_RECIPES: readonly ((ctx: PropContext) => BuiltModel)[] = [
  barrel,
  waterTank,
  jeep,
  floodlight,
  pipe,
  column,
  tarp,
  generator,
  tree,
  sandbags,
  crateLarge,
];
