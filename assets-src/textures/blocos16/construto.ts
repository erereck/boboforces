/**
 * Camadas do Construto (arte-ux.md §5.1): concreto, placas de teste com a grade de 0,5 m pintada, faixa amarela de
 * circulação, marcador de setor, parede de medida, concreto com faixa laranja, degrau antiderrapante, bloco cinza e
 * tijolo. Paleta neutra: cinza, laranja de segurança e um pouco de amarelo de sinalização.
 */
import type { LayerRecipe, Paint } from '../../../tools/texgen/src/paint.ts';

/** Concreto liso (contínuo): base média, manchas ±1 tom e poros esparsos. A variante só muda o detalhe. */
export function paintConcrete(p: Paint, variant: number): void {
  const c = p.ramp('concreto');
  p.fill(c[3]!);
  p.blotches(4, c[2]!);
  p.blotches(2, c[4]!, 2, 2);
  for (let i = 0; i < 2; i++) p.px(p.rng.int(0, 16), p.rng.int(0, 16), c[2]!);
  if (variant === 1) {
    // Trinca fina e curta, um tom abaixo, em escada ligada pelos lados (diagonal de 1 px vira xadrez).
    let x = p.rng.int(0, 16);
    let y = p.rng.int(0, 16);
    for (let i = 0; i < 5; i++) {
      p.px(x, y, c[2]!);
      if (p.rng.chance(0.5)) p.px(x, ++y, c[2]!);
      x += 1;
    }
  } else if (variant === 2) {
    p.blotches(3, c[4]!, 2, 2);
  } else if (variant === 3) {
    // Mancha de umidade: três manchas escuras juntas.
    const x = p.rng.int(0, 16);
    const y = p.rng.int(0, 16);
    p.rect(x, y, 3, 2, c[2]!);
    p.rect(x + 1, y + 2, 3, 2, c[2]!);
    p.px(x + 3, y + 1, c[2]!);
  }
}

const concrete: LayerRecipe = {
  name: 'concrete',
  kind: 'opaque',
  material: 'continuo',
  variants: 4,
  draw: paintConcrete,
};

/** Concreto com faixa laranja de segurança no meio do bloco (uma fiada na altura da cintura). */
const concreteStripe: LayerRecipe = {
  name: 'concrete_stripe',
  kind: 'opaque',
  material: 'modular',
  draw(p) {
    paintConcrete(p, 0);
    const o = p.ramp('laranja');
    p.rect(0, 6, 16, 4, o[2]!);
    p.hline(0, 6, 16, o[3]!);
    p.hline(0, 9, 16, o[1]!);
    // Desgaste: lascas de concreto nas bordas da tinta.
    const c = p.ramp('concreto');
    for (let i = 0; i < 3; i++) {
      const x = p.rng.int(0, 15);
      p.hline(x, p.rng.chance(0.5) ? 6 : 9, 2, c[3]!);
    }
  },
};

/** Placa de teste: cinza-claro, sulco da grade (luz em cima/esquerda, sombra embaixo/direita) e marca de centro. */
function paintPlate(p: Paint, base: number, light: number, dark: number): void {
  p.fill(base);
  p.bevel(0, 0, 16, 16, light, dark);
  // Marcas de 25 cm no meio de cada borda (ajudam a ler distância no chão).
  p.px(8, 1, dark);
  p.px(1, 8, dark);
}

const testFloor: LayerRecipe = {
  name: 'test_floor',
  kind: 'opaque',
  material: 'modular',
  variants: 3,
  draw(p, variant) {
    const pl = p.ramp('placa');
    paintPlate(p, pl[1]!, pl[3]!, pl[0]!);
    p.blotches(2, pl[2]!, 2, 3);
    p.rect(7, 7, 2, 2, pl[0]!);
    if (variant === 1) {
      // Marca de uso (pneu, bota): manchas um tom abaixo.
      p.blotches(2, pl[0]!, 2, 3);
    } else if (variant === 2) {
      // Parafusos nos cantos.
      const c = p.ramp('concreto');
      for (const [x, y] of [
        [3, 3],
        [12, 3],
        [3, 12],
        [12, 12],
      ] as const) {
        p.px(x, y, c[4]!);
        p.px(x + 1, y + 1, pl[3]!);
      }
    }
  },
};

/** Placa pintada de amarelo: as faixas de circulação são fileiras destes blocos (servem em X e em Z). */
const testFloorStripe: LayerRecipe = {
  name: 'test_floor_stripe',
  kind: 'opaque',
  material: 'modular',
  variants: 2,
  draw(p, variant) {
    const y = p.ramp('amarelo');
    paintPlate(p, y[1]!, y[2]!, y[0]!);
    p.blotches(2, y[2]!, 2, 2);
    if (variant === 1) p.blotches(3, p.tone('placa', 1), 2, 2);
  },
};

/** Algarismos de setor 1–9 (6×8, traço de 2 px, para ler de longe). */
const SECTOR_DIGITS: readonly (readonly string[])[] = [
  ['..##..', '.###..', '####..', '..##..', '..##..', '..##..', '..##..', '######'],
  ['.####.', '##..##', '....##', '...##.', '..##..', '.##...', '##....', '######'],
  ['#####.', '....##', '....##', '.####.', '....##', '....##', '....##', '#####.'],
  ['...##.', '..###.', '.####.', '##.##.', '######', '...##.', '...##.', '...##.'],
  ['######', '##....', '##....', '#####.', '....##', '....##', '##..##', '.####.'],
  ['.####.', '##....', '##....', '#####.', '##..##', '##..##', '##..##', '.####.'],
  ['######', '....##', '...##.', '...##.', '..##..', '..##..', '.##...', '.##...'],
  ['.####.', '##..##', '##..##', '.####.', '##..##', '##..##', '##..##', '.####.'],
  ['.####.', '##..##', '##..##', '##..##', '.#####', '....##', '....##', '.####.'],
];

/**
 * Marcadores de setor `sector_marker_1` … `_9`: placa de teste com moldura laranja e o número do setor. Uma camada
 * por número (sem variantes): o shader sorteia a variante pela célula, e o número tem de ser o do setor (arte-8).
 * O marcador fica no chão e é lido de qualquer lado; girado 180°, o 6 é o 9. Por isso os dois sobem 1 px e ganham um
 * sublinhado (escuro sobre a moldura de baixo): girado, o traço vai para cima do número e denuncia o lado.
 */
const SECTOR_MARKERS: readonly LayerRecipe[] = SECTOR_DIGITS.map((digit, i) => ({
  name: `sector_marker_${i + 1}`,
  kind: 'opaque',
  material: 'sinal',
  draw(p) {
    const pl = p.ramp('placa');
    paintPlate(p, pl[1]!, pl[3]!, pl[0]!);
    const o = p.tone('laranja', 2);
    const ink = p.tone('concreto', 1);
    p.hline(2, 2, 12, o);
    p.hline(2, 13, 12, o);
    p.vline(2, 3, 10, o);
    p.vline(13, 3, 10, o);
    const underline = i + 1 === 6 || i + 1 === 9;
    p.grid(5, underline ? 3 : 4, digit, { '#': ink });
    if (underline) p.hline(6, 12, 4, ink);
  },
}));

/** Parede de medida: painel claro com régua laranja na esquerda (marcas de 12,5, 25 e 50 cm). */
const testWall: LayerRecipe = {
  name: 'test_wall',
  kind: 'opaque',
  material: 'modular',
  draw(p) {
    const pl = p.ramp('placa');
    const o = p.ramp('laranja');
    const mark = p.tone('concreto', 1);
    p.fill(pl[1]!);
    p.blotches(2, pl[2]!, 2, 3);
    p.hline(2, 0, 14, pl[3]!);
    p.vline(15, 1, 15, pl[0]!);
    p.hline(2, 15, 13, pl[0]!);
    p.vline(0, 0, 16, o[3]!);
    p.vline(1, 0, 16, o[2]!);
    p.hline(0, 15, 6, mark);
    p.hline(0, 7, 4, mark);
    p.hline(0, 3, 2, mark);
    p.hline(0, 11, 2, mark);
  },
};

/** Degrau antiderrapante: concreto escuro com saliências de 2×2 numa grade de 4 px (sem direção: serve girado). */
const antiSlip: LayerRecipe = {
  name: 'anti_slip',
  kind: 'opaque',
  material: 'modular',
  draw(p) {
    const c = p.ramp('concreto');
    p.fill(c[3]!);
    p.blotches(2, c[2]!, 2, 2);
    for (let y = 1; y < 16; y += 4) {
      for (let x = 1; x < 16; x += 4) {
        p.rect(x, y, 2, 2, c[4]!);
        p.px(x + 2, y + 1, c[2]!);
        p.px(x + 1, y + 2, c[2]!);
        p.px(x + 2, y + 2, c[2]!);
      }
    }
  },
};

/** Bloco cinza de concreto: duas fiadas de 8 px desencontradas, junta escura e bevel por bloco. */
const cinderBlock: LayerRecipe = {
  name: 'cinder_block',
  kind: 'opaque',
  material: 'modular',
  draw(p) {
    const c = p.ramp('concreto');
    p.fill(c[3]!);
    p.blotches(3, c[2]!, 2, 2);
    p.blotches(2, c[4]!, 2, 2);
    for (const [row, offset] of [
      [0, 0],
      [8, 8],
    ] as const) {
      // Bloco de 15×7 com bevel; a junta (1 px) fecha à direita e embaixo.
      p.hline(offset, row, 15, c[4]!);
      p.vline(offset, row + 1, 6, c[4]!);
      p.hline(offset + 1, row + 6, 14, c[2]!);
      p.vline(offset + 14, row + 1, 5, c[2]!);
      p.hline(offset, row + 7, 16, c[1]!);
      p.vline(offset + 15, row, 7, c[1]!);
    }
  },
};

/** Tijolo: fiadas de 4 px (3 de tijolo + 1 de argamassa), tijolos de 8 px desencontrados. */
const brick: LayerRecipe = {
  name: 'brick',
  kind: 'opaque',
  material: 'modular',
  draw(p) {
    const b = p.ramp('tijolo');
    p.fill(p.tone('concreto', 4));
    for (let row = 0; row < 4; row++) {
      const y = row * 4;
      const offset = row % 2 === 0 ? 0 : 4;
      for (let col = 0; col < 2; col++) {
        const x = offset + col * 8;
        const tone = p.rng.chance(0.5) ? 1 : 2;
        p.rect(x, y, 7, 3, b[tone]!);
        p.hline(x, y, 7, b[tone + 1]!);
        p.px(x + 5, y + 2, b[tone - 1]!);
        p.px(x + 6, y + 2, b[tone - 1]!);
        if (p.rng.chance(0.6)) p.px(x + p.rng.int(1, 5), y + 1, b[tone - 1]!);
      }
    }
  },
};

export const CONSTRUTO_TEXTURES: readonly LayerRecipe[] = [
  concrete,
  concreteStripe,
  testFloor,
  testFloorStripe,
  ...SECTOR_MARKERS,
  testWall,
  antiSlip,
  cinderBlock,
  brick,
];
