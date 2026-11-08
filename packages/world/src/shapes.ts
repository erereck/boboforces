/**
 * Catálogo de formas dentro da célula (tecnico.md §5.2, arte-ux.md §1.4). CONTRATO DO M1: os ids numéricos, a forma
 * canônica de cada uma e as regras de orientação são fixos (entram nos mapas). Quem implementa colisão, DDA, mesher e
 * navegação usa as tabelas daqui; nada é redesenhado em outro pacote.
 *
 * Unidade: 1/16 de célula (`SUBCELL_STEPS`) = 1 texel do cenário = 3,125 cm. Coordenadas locais da célula em [0, 16].
 *
 * Forma CANÔNICA (giro 0, sem inversão): o "alto" das rampas e o "fundo" do degrau ficam no lado -Z (para onde o yaw 0
 * olha: andar para a frente sobe). Painel e travessas correm ao longo de X.
 * Orientação (`cellOrientation`): giro | inversão << 2. A inversão espelha em Y (y → 16 − y) ANTES do giro; o giro é em
 * quartos de volta anti-horários vistos de cima em torno do centro da célula (8, 8): (x, z) → (z, 16 − x) por quarto,
 * ou seja, -Z vira -X, -X vira +Z, +Z vira +X e +X vira -Z.
 *
 * | forma          | canônica (subcélulas)                                         | colisão             | piso (andável) |
 * |----------------|---------------------------------------------------------------|---------------------|----------------|
 * | cube           | [0,0,0]–[16,16,16]                                            | caixa               | topo 16        |
 * | slab           | laje de baixo [0,0,0]–[16,8,16] (invertida = laje de cima)    | caixa               | 8 (16 inv.)    |
 * | step           | laje [0,0,0]–[16,8,16] + [0,8,0]–[16,16,8] (fundo em -Z)      | 2 caixas            | 8 / 16         |
 * | ramp           | rampa 1:1: piso 16 − z (16 em z=0, 0 em z=16)                 | plano (piso)        | 16 − z         |
 * | rampHalfLow    | rampa 1:2 baixa: piso 8 − z/2                                 | plano (piso)        | 8 − z/2        |
 * | rampHalfHigh   | rampa 1:2 alta: base de 8 + piso 16 − z/2                     | plano (piso)        | 16 − z/2       |
 * | rampCornerIn   | quina interna 1:1: piso max(16 − z, 16 − x)                   | plano (piso)        | idem           |
 * | rampCornerOut  | quina externa 1:1: piso min(16 − z, 16 − x)                   | plano (piso)        | idem           |
 * | panel          | painel fino [0,0,7]–[16,16,9]                                 | caixa fina          | não            |
 * | postRail       | poste [6,0,6]–[10,16,10] + travessas [0,4,7]–[16,7,9] e [0,11,7]–[16,14,9] | [0,0,6]–[16,16,10] | não |
 * | cross          | 2 quads cruzados nas diagonais da célula                      | nenhuma             | não            |
 *
 * Rampas INVERTIDAS (teto inclinado) colidem como cubo cheio no M1: o teto inclinado é só visual.
 */

/** Ids numéricos das formas (espelho em typed array: `BlockRegistry.shapes`). NUNCA reordenar; forma nova no fim. */
export const SHAPE_ID = {
  empty: 0,
  cube: 1,
  slab: 2,
  step: 3,
  ramp: 4,
  rampHalfLow: 5,
  rampHalfHigh: 6,
  rampCornerIn: 7,
  rampCornerOut: 8,
  panel: 9,
  postRail: 10,
  cross: 11,
} as const;

/** Nome da forma em `BlockDef.shape` e nos arquivos de definição de bloco. */
export type BlockShape = keyof typeof SHAPE_ID;
export type ShapeId = (typeof SHAPE_ID)[BlockShape];
export const SHAPE_COUNT = 12;

/** Nomes na ordem dos ids. */
export const SHAPE_NAMES: readonly BlockShape[] = [
  'empty',
  'cube',
  'slab',
  'step',
  'ramp',
  'rampHalfLow',
  'rampHalfHigh',
  'rampCornerIn',
  'rampCornerOut',
  'panel',
  'postRail',
  'cross',
];

/** Como a forma colide: nada, caixas (`shapeCollisionBoxes`) ou plano inclinado (`shapeFloorHeight`). */
export type ShapeCollision = 'none' | 'boxes' | 'slope';

export function shapeCollision(shape: ShapeId, orientation: number): ShapeCollision {
  if (shape === SHAPE_ID.empty || shape === SHAPE_ID.cross) return 'none';
  if (shape >= SHAPE_ID.ramp && shape <= SHAPE_ID.rampCornerOut) return (orientation & 4) !== 0 ? 'boxes' : 'slope';
  return 'boxes';
}

/** Subcélulas por lado da célula. */
export const SHAPE_STEPS = 16;
/** Teto de caixas de colisão por forma (o `postRail` usa 1, o `step` 2). */
export const MAX_SHAPE_BOXES = 2;
/** Floats por caixa nas saídas: minX, minY, minZ, maxX, maxY, maxZ (subcélulas). */
export const SHAPE_BOX_STRIDE = 6;

type Box = readonly [number, number, number, number, number, number];

const CANONICAL_BOXES: readonly (readonly Box[])[] = [
  [], // empty
  [[0, 0, 0, 16, 16, 16]], // cube
  [[0, 0, 0, 16, 8, 16]], // slab
  [
    [0, 0, 0, 16, 8, 16],
    [0, 8, 0, 16, 16, 8],
  ], // step
  [[0, 0, 0, 16, 16, 16]], // ramp (só vale invertida; em pé é plano)
  [[0, 0, 0, 16, 16, 16]], // rampHalfLow
  [[0, 0, 0, 16, 16, 16]], // rampHalfHigh
  [[0, 0, 0, 16, 16, 16]], // rampCornerIn
  [[0, 0, 0, 16, 16, 16]], // rampCornerOut
  [[0, 0, 7, 16, 16, 9]], // panel
  [[0, 0, 6, 16, 16, 10]], // postRail
  [], // cross
];

/** Aplica a orientação (inversão em Y, depois giro) a uma caixa canônica. Escreve em `out[o..o+6]`. */
export function orientBox(box: Box, orientation: number, out: Float32Array | Uint8Array | number[], o = 0): void {
  let x0 = box[0];
  let y0 = box[1];
  let z0 = box[2];
  let x1 = box[3];
  let y1 = box[4];
  let z1 = box[5];
  if ((orientation & 4) !== 0) {
    const a = 16 - y1;
    y1 = 16 - y0;
    y0 = a;
  }
  for (let r = orientation & 3; r > 0; r--) {
    // Quarto de volta anti-horário visto de cima: (x, z) → (z, 16 − x).
    const nx0 = z0;
    const nx1 = z1;
    const nz0 = 16 - x1;
    const nz1 = 16 - x0;
    x0 = nx0;
    x1 = nx1;
    z0 = nz0;
    z1 = nz1;
  }
  out[o] = x0;
  out[o + 1] = y0;
  out[o + 2] = z0;
  out[o + 3] = x1;
  out[o + 4] = y1;
  out[o + 5] = z1;
}

/**
 * Caixas VISUAIS das formas feitas de caixas (o mesher desenha estas; rampas e cruz são polígonos das fórmulas do
 * topo do arquivo). Diferem da colisão só no poste + travessa (a colisão é uma caixa fina contínua).
 */
const CANONICAL_VISUAL_BOXES: readonly (readonly Box[])[] = [
  [],
  [[0, 0, 0, 16, 16, 16]],
  [[0, 0, 0, 16, 8, 16]],
  [
    [0, 0, 0, 16, 8, 16],
    [0, 8, 0, 16, 16, 8],
  ],
  [],
  [],
  [[0, 0, 0, 16, 8, 16]], // rampHalfHigh: a base; o plano vai por cima
  [],
  [],
  [[0, 0, 7, 16, 16, 9]],
  [
    [6, 0, 6, 10, 16, 10],
    [0, 4, 7, 16, 7, 9],
    [0, 11, 7, 16, 14, 9],
  ],
  [],
];

/** Teto de caixas visuais por forma (o `postRail` usa 3). */
export const MAX_SHAPE_VISUAL_BOXES = 3;

function orientTable(source: readonly (readonly Box[])[]): readonly (readonly Uint8Array[])[] {
  return source.map((boxes) =>
    Array.from({ length: 8 }, (_, orientation) => {
      const out = new Uint8Array(boxes.length * SHAPE_BOX_STRIDE);
      boxes.forEach((b, i) => orientBox(b, orientation, out, i * SHAPE_BOX_STRIDE));
      return out;
    }),
  );
}

/** Tabelas pré-calculadas: [forma][orientação] → caixas orientadas (subcélulas). */
const BOX_TABLE = orientTable(CANONICAL_BOXES);
const VISUAL_BOX_TABLE = orientTable(CANONICAL_VISUAL_BOXES);

/** Caixas visuais orientadas (subcélulas) em `out`; devolve quantas (0..`MAX_SHAPE_VISUAL_BOXES`). Sem alocação. */
export function shapeVisualBoxes(shape: ShapeId, orientation: number, out: Float32Array | Uint8Array): number {
  const table = VISUAL_BOX_TABLE[shape]?.[orientation & 7];
  if (!table) return 0;
  out.set(table);
  return table.length / SHAPE_BOX_STRIDE;
}

/**
 * Caixas de colisão da forma na orientação dada, em subcélulas (0..16), escritas em `out` (6 valores por caixa).
 * Devolve quantas caixas escreveu (0..`MAX_SHAPE_BOXES`). Rampas em pé devolvem 0: a colisão delas é o plano
 * (`shapeFloorHeight`); invertidas devolvem o cubo cheio. Sem alocação.
 */
export function shapeCollisionBoxes(shape: ShapeId, orientation: number, out: Float32Array | Uint8Array): number {
  if (shapeCollision(shape, orientation) !== 'boxes') return 0;
  const table = BOX_TABLE[shape]?.[orientation & 7];
  if (!table) return 0;
  out.set(table);
  return table.length / SHAPE_BOX_STRIDE;
}

/**
 * Altura do piso andável da forma num ponto da célula, em CÉLULAS (0..1). `fx`, `fz` em [0, 1] (fração da célula em
 * X e Z, no espaço do mundo, já com a orientação aplicada aqui dentro). Devolve -1 onde a forma não tem piso
 * (ar, cruz, painel, poste). Cubo e rampas invertidas = 1; laje = 0,5 (1 invertida); degrau = 0,5 ou 1 conforme o
 * lado. É a função que a colisão (rampa lisa, tecnico.md §7.2) e a navegação usam.
 */
export function shapeFloorHeight(shape: ShapeId, orientation: number, fx: number, fz: number): number {
  const flipped = (orientation & 4) !== 0;
  // Leva o ponto do mundo para o espaço canônico: desfaz o giro (3 quartos anti-horários = 1 horário).
  let x = fx;
  let z = fz;
  for (let r = orientation & 3; r > 0; r--) {
    // Inverso de (x, z) → (z, 1 − x): (x, z) → (1 − z, x).
    const nx = 1 - z;
    z = x;
    x = nx;
  }
  switch (shape) {
    case SHAPE_ID.cube:
      return 1;
    case SHAPE_ID.slab:
      return flipped ? 1 : 0.5;
    case SHAPE_ID.step:
      return flipped ? 1 : z < 0.5 ? 1 : 0.5;
    case SHAPE_ID.ramp:
      return flipped ? 1 : 1 - z;
    case SHAPE_ID.rampHalfLow:
      return flipped ? 1 : 0.5 - z / 2;
    case SHAPE_ID.rampHalfHigh:
      return flipped ? 1 : 1 - z / 2;
    case SHAPE_ID.rampCornerIn:
      return flipped ? 1 : Math.max(1 - z, 1 - x);
    case SHAPE_ID.rampCornerOut:
      return flipped ? 1 : Math.min(1 - z, 1 - x);
    default:
      return -1;
  }
}

/**
 * Faces da célula que a forma cobre POR INTEIRO (bits por `FACE`: 1 << face), para o mesher descartar a face do
 * vizinho escondida. Cubo cobre as 6; laje cobre só a de baixo (a de cima, invertida); degrau, rampa 1:1 e rampa 1:2
 * alta cobrem a de baixo e a do fundo; quina interna também a -X; formas finas e a cruz não cobrem nenhuma.
 */
export function shapeCoveredFaces(shape: ShapeId, orientation: number): number {
  // Bits canônicos: +X 1, -X 2, +Y 4, -Y 8, +Z 16, -Z 32.
  let bits: number;
  switch (shape) {
    case SHAPE_ID.cube:
      return 63;
    case SHAPE_ID.slab:
    case SHAPE_ID.rampHalfLow:
    case SHAPE_ID.rampCornerOut:
      bits = 8;
      break;
    case SHAPE_ID.step:
    case SHAPE_ID.ramp:
    case SHAPE_ID.rampHalfHigh:
      bits = 8 | 32;
      break;
    case SHAPE_ID.rampCornerIn:
      bits = 8 | 32 | 2;
      break;
    default:
      return 0;
  }
  return orientFaceBits(bits, orientation);
}

/** Índice de face (`FACE`) depois da orientação: inversão troca +Y/-Y; cada quarto leva +X→-Z→-X→+Z→+X. */
export function orientFace(face: number, orientation: number): number {
  let f = face;
  if ((orientation & 4) !== 0 && (f === 2 || f === 3)) f = f === 2 ? 3 : 2;
  for (let r = orientation & 3; r > 0; r--) {
    if (f === 0) f = 5;
    else if (f === 5) f = 1;
    else if (f === 1) f = 4;
    else if (f === 4) f = 0;
  }
  return f;
}

function orientFaceBits(bits: number, orientation: number): number {
  let out = 0;
  for (let f = 0; f < 6; f++) if ((bits & (1 << f)) !== 0) out |= 1 << orientFace(f, orientation);
  return out;
}

/**
 * Qual face de `BlockDef.faces` dá a textura de uma face de forma: faces axiais usam a do próprio eixo (+X → `px`…);
 * planos inclinados usam a de cima (`py`) em pé e a de baixo (`ny`) invertidos; os dois quads da cruz usam `px`.
 * `normalIndex` é o índice na `NORMAL_TABLE` (`mesh/vertex.ts`). Devolve o índice de `FACE`.
 */
export function shapeFaceSource(normalIndex: number): number {
  if (normalIndex >= 0 && normalIndex < 6) return normalIndex;
  if (normalIndex >= 6 && normalIndex < 10) return 0; // cruz
  // Rampas: os blocos "para cima" e "para baixo" alternam de 4 em 4 a partir do 10 (ver NORMAL_TABLE).
  const group = (normalIndex - 10) >> 2;
  return group % 2 === 0 ? 2 : 3;
}
