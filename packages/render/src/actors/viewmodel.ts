// Viewmodel (tecnico.md §6.7, arte-ux.md §3.3): o MESMO modelo da arma da 3ª pessoa, com os dois braços da skin do
// dono (luvas e mangas na cor do time) montados no espaço da arma, numa geometria só: 1 draw call por vista. Sem three.
//
// #56 (PLANO do porte §B12): o braço é manga + antebraço + mão do FutBobo (caixas do `addTexturedBox` com a UV no
// centro das amostras 8, 6 e 7 da paleta, camada 0 da skin do dono), esticado do ombro ao soquete com o cotovelo reto;
// o comprimento de referência é o do FutBobo, 10,9 px = 0,596 m. O braço do bobo A saiu no passo 5 do porte.
import { FIGURE_PX_M, FIGURE_SWATCH, figureSwatchCorner, type ModelDocument } from '@boboforces/format';
import { addTexturedBox, affine, GeometryBuilder, type GeometryArrays } from './geometry.ts';
import { LAYER_FROM_INSTANCE } from './layout.ts';
import { modelSocket, type ModelBinding, type SocketM } from './model-geometry.ts';

/**
 * Pose de repouso no espaço da câmera (m; X direita, Y cima, -Z frente): onde fica o soquete `hand_r` da arma e os
 * ombros de onde saem os braços. Os deslocamentos do `ViewmodelDesc` (sway, coice, ADS) somam em cima. [PROPOSTA]
 */
export const VIEWMODEL_POSE = {
  hand: [0.16, -0.18, -0.42],
  /** Ombros abaixo da borda de baixo da tela: os braços sobem dos cantos (nunca cruzam o plano próximo). */
  shoulderR: [0.3, -0.7, -0.08],
  shoulderL: [-0.16, -0.72, -0.14],
  /** Espessura do braço na 1ª pessoa (fração da caixa da skin): o braço inteiro perto do olho tamparia a tela. */
  armThickness: 0.7,
} as const;

/**
 * Deslocamento (m, espaço da câmera) que põe o soquete `sight` no centro da tela: é o alvo do ADS do viewmodel (o
 * `game` anima `ViewmodelDesc.offsetX/Y` de 0 até este valor). Sem `sight` ou `hand_r`, `null`. Sem three.
 */
export function viewmodelAimOffset(model: ModelDocument): { x: number; y: number } | null {
  const sight = modelSocket(model, 'sight');
  const hand = modelSocket(model, 'hand_r');
  if (!sight || !hand) return null;
  return {
    x: -(VIEWMODEL_POSE.hand[0] + sight.x - hand.x),
    y: -(VIEWMODEL_POSE.hand[1] + sight.y - hand.y),
  };
}

/**
 * Braço do boneco do FutBobo na 1ª pessoa (px do FutBobo, pivô no ombro, pendurado em −Y): manga 4×5,2×4 em −2,4,
 * cotovelo em −4,9, antebraço 3,6×5×3,6 em −7,3 e mão 3,8×2,2×3,8 em −10,5 (as caixas do `FIGURE_BODY_BOXES` com o
 * cotovelo reto). O soquete fica a `armPx` do ombro, dentro da mão. Farda da #58: manga comprida (manga e antebraço na
 * amostra da manga) e a mão na amostra `hand`, que é a luva (do time, nos modos com time; arte-ux §3.2).
 */
export const VIEWMODEL_FIGURE_ARM = {
  armPx: 10.9,
  /** Comprimento de referência (m) para ligar ombro e soquete: 10,9 px = 0,596 m. */
  armLength: 10.9 * FIGURE_PX_M,
  boxes: [
    { center: -2.4, size: [4, 5.2, 4], swatch: FIGURE_SWATCH.sleeve },
    { center: -7.3, size: [3.6, 5, 3.6], swatch: FIGURE_SWATCH.sleeve },
    { center: -10.5, size: [3.8, 2.2, 3.8], swatch: FIGURE_SWATCH.hand },
  ],
} as const;

/**
 * Geometria do braço do FutBobo (m, pivô no ombro, pendurado em −Y): cada caixa lê o centro do texel da sua amostra
 * na camada da INSTÂNCIA (a 1ª camada da skin do dono, a da paleta).
 */
export function buildFigureArmGeometry(): GeometryArrays {
  const b = new GeometryBuilder();
  const px = FIGURE_PX_M;
  for (const box of VIEWMODEL_FIGURE_ARM.boxes) {
    const corner = figureSwatchCorner(box.swatch);
    const u0 = corner % 64;
    const v0 = (corner - u0) / 64;
    const [sx, sy, sz] = box.size;
    addTexturedBox(
      b,
      {
        min: [(-sx / 2) * px, (box.center - sy / 2) * px, (-sz / 2) * px],
        size: [sx * px, sy * px, sz * px],
        inflate: 0,
        tex: [0, 0, 0],
        uv: [u0 + 0.5, v0 + 0.5],
        layerSize: 64,
        mirror: false,
      },
      { layer: LAYER_FROM_INSTANCE, flags: 0 },
    );
  }
  return b.build();
}

/** Mão esquerda: o soquete `hand_l`; sem ele, um ponto sob o cano a 55% do caminho até a boca. */
export function leftHandSocket(weapon: ModelBinding): SocketM | null {
  const left = weapon.sockets.get('hand_l');
  if (left) return left;
  const right = weapon.sockets.get('hand_r');
  const muzzle = weapon.sockets.get('muzzle');
  if (!right || !muzzle) return null;
  return {
    x: right.x + (muzzle.x - right.x) * 0.55,
    y: right.y + (muzzle.y - right.y) * 0.55 - 0.03,
    z: right.z + (muzzle.z - right.z) * 0.55,
    dx: 0,
    dy: 0,
    dz: -1,
  };
}

/**
 * Matriz que leva o braço (pivô no ombro, pendurado em -Y) do ombro `s` até a mão `h` (espaço do modelo): gira,
 * estica no comprimento (entre 0,6× e 2×) e afina na espessura.
 */
function armTransform(
  hx: number,
  hy: number,
  hz: number,
  sx: number,
  sy: number,
  sz: number,
  length: number,
): Float32Array {
  let dx = hx - sx;
  let dy = hy - sy;
  let dz = hz - sz;
  const len = Math.hypot(dx, dy, dz) || 1;
  dx /= len;
  dy /= len;
  dz /= len;
  // Eixo +Y local do braço aponta da mão para o ombro; X = cima × Y fica na horizontal e para a direita, como o braço
  // levantado para a frente (a face da frente da manga fica para cima, virada para a câmera).
  const yx = -dx;
  const yy = -dy;
  const yz = -dz;
  let xx = yz;
  let xy = 0;
  let xz = -yx;
  let xl = Math.hypot(xx, xy, xz);
  if (xl < 1e-4) {
    xx = 1;
    xy = 0;
    xz = 0;
    xl = 1;
  }
  xx /= xl;
  xy /= xl;
  xz /= xl;
  // Z = X × Y (base direita).
  const zx = xy * yz - xz * yy;
  const zy = xz * yx - xx * yz;
  const zz = xx * yy - xy * yx;
  // Estica até o ombro (dentro do limite) e recua o pivô a partir da mão: o fim do braço encosta no soquete.
  const stretch = Math.min(2, Math.max(0.6, len / length));
  const reach = length * stretch;
  const t = VIEWMODEL_POSE.armThickness;
  return affine(
    [hx - dx * reach, hy - dy * reach, hz - dz * reach],
    [xx * t, xy * t, xz * t],
    [yx * stretch, yy * stretch, yz * stretch],
    [zx * t, zy * t, zz * t],
  );
}

/**
 * Arma + braço direito (até `hand_r`) + braço esquerdo (até `hand_l` ou o ponto sob o cano), tudo no espaço do
 * modelo. Os vértices dos braços usam a camada da INSTÂNCIA (a 1ª das 2 camadas da skin do dono, #56); os da arma, as
 * camadas do modelo.
 */
export function buildViewmodelGeometry(weapon: ModelBinding): GeometryArrays {
  const b = new GeometryBuilder();
  b.append(weapon.geometry, null, null);
  const right = weapon.sockets.get('hand_r');
  if (!right) return b.build();
  const arm = buildFigureArmGeometry();
  const length = VIEWMODEL_FIGURE_ARM.armLength;
  const [hx, hy, hz] = VIEWMODEL_POSE.hand;
  // Ponto da câmera c ↔ ponto do modelo m = c − mão + hand_r (sem giro na pose de repouso).
  const toModel = (c: readonly [number, number, number]): [number, number, number] => [
    c[0] - hx + right.x,
    c[1] - hy + right.y,
    c[2] - hz + right.z,
  ];
  const sR = toModel(VIEWMODEL_POSE.shoulderR);
  b.append(arm, armTransform(right.x, right.y, right.z, sR[0], sR[1], sR[2], length), null);
  const left = leftHandSocket(weapon);
  if (left) {
    const sL = toModel(VIEWMODEL_POSE.shoulderL);
    b.append(arm, armTransform(left.x, left.y, left.z, sL[0], sL[1], sL[2], length), null);
  }
  return b.build();
}
