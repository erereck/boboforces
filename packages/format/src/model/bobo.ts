/**
 * O que sobrou do bobo de caixas depois do porte do boneco do FutBobo (decisão #56; PLANO do porte §B18): o layout em
 * cruz das caixas texturizadas (skins do boneco, `.bfmodel` e o cubo do programa 4), as expressões do rosto e os tipos
 * de zumbi. As caixas, a pintura, a pose e as hitboxes do bobo são as do boneco: `figure*.ts`.
 *
 * Espaço da caixa: Y para cima, FRENTE para -Z, DIREITA do boneco para +X (o yaw 0 olha para -Z).
 */

export type Vec3Tuple = readonly [x: number, y: number, z: number];

/** Retângulo de UV em px (canto superior esquerdo, largura, altura). */
export interface UvRect {
  readonly u: number;
  readonly v: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Layout em CRUZ de uma caixa w×h×d com canto (u, v), igual para a skin do boneco e as caixas de `.bfmodel`. Devolve os
 * 6 retângulos na ordem de `FACE` (+X, -X, +Y, -Y, +Z, -Z):
 *
 *   linha v      : [u+d, w×d] topo (+Y) · [u+d+w, w×d] base (-Y)
 *   linha v + d  : [u, d×h] +X (direita do boneco) · [u+d, w×h] frente (-Z) · [u+d+w, d×h] -X · [u+2d+w, w×h] trás (+Z)
 *
 * Eixos da textura em cada face (u para a direita da imagem, v para baixo): laterais com v = -Y; +X com u → -Z;
 * frente com u → -X; -X com u → +Z; trás com u → +X; topo com u → -X e v → -Z (a borda de baixo encosta na frente);
 * base com u → -X e v → +Z. `SKIN_FACE_AXES` tem os vetores.
 */
export function boxCrossRects(u: number, v: number, w: number, h: number, d: number): readonly UvRect[] {
  return [
    { u, v: v + d, w: d, h },
    { u: u + d + w, v: v + d, w: d, h },
    { u: u + d, v, w, h: d },
    { u: u + d + w, v, w, h: d },
    { u: u + 2 * d + w, v: v + d, w, h },
    { u: u + d, v: v + d, w, h },
  ];
}

/** Direção 3D (espaço da caixa) em que u e v da textura crescem, por face na ordem de `FACE`. */
export const SKIN_FACE_AXES: readonly { readonly u: Vec3Tuple; readonly v: Vec3Tuple }[] = [
  { u: [0, 0, -1], v: [0, -1, 0] },
  { u: [0, 0, 1], v: [0, -1, 0] },
  { u: [-1, 0, 0], v: [0, 0, -1] },
  { u: [-1, 0, 0], v: [0, 0, 1] },
  { u: [1, 0, 0], v: [0, -1, 0] },
  { u: [-1, 0, 0], v: [0, -1, 0] },
];

/**
 * Expressões do rosto, ordem fixa (`ActorBuffer.expression`; células da skin do boneco, `FIGURE_LAYOUT.expressions`).
 * Os nomes da folha de rostos do bobo A (`faces`, `faces_zombie`) saíram com ela e nunca são reusados.
 */
export const FACE_EXPRESSIONS = [
  'neutral',
  'aiming',
  'angry',
  'scared',
  'pain',
  'cheering',
  'sleeping',
  'dead',
] as const;
export type FaceExpression = (typeof FACE_EXPRESSIONS)[number];
export const FACE_EXPRESSION: Readonly<Record<FaceExpression, number>> = {
  neutral: 0,
  aiming: 1,
  angry: 2,
  scared: 3,
  pain: 4,
  cheering: 5,
  sleeping: 6,
  dead: 7,
};

/** Tipos de zumbi (GDD §4.7.3); o M1 usa só `common` no teste de estresse. Escala uniforme (o pixel continua quadrado). */
export const ZOMBIE_KINDS = ['common', 'sprinter', 'chonker', 'spitter', 'mega'] as const;
export type ZombieKind = (typeof ZOMBIE_KINDS)[number];
export const ZOMBIE_SCALE: Readonly<Record<ZombieKind, number>> = {
  common: 1,
  sprinter: 1,
  chonker: 1.3,
  spitter: 1,
  mega: 1.8,
};
