/**
 * Zumbi no pintor do boneco (frente F2; PLANO do porte §B11; estudo de pintura §6). O zumbi é o mesmo boneco com
 * aparência de zumbi: pele `0x8fae74` (vem no look), branco do olho `#dcbc5a` e sem blush (no `resolveHeadColors`),
 * farda 35% desbotada para `#8a8a86` (#58), rasgos, remendos e curativos coloridos por hash da semente do tipo, a
 * manga, o antebraço e a coxa rasgados com a pele no fim; sem vísceras.
 *
 * Rosto: as 8 expressões são as do boneco comum (o FutBobo + mirando e morto) com o "estilo de zumbi" por cima, no
 * estilo do FutBobo (grade 16×16), pela lógica da folha do bobo A (`assets-src/skins/faces.ts:404-420`, que saiu no
 * passo 5; cópia em `local/saidas-m1/2026-11-04/`): o traço do estilo manda nas expressões calmas (neutro, mirando,
 * bravo), e língua e costura têm as exceções de lá.
 *
 * Interno do pacote; sem `Math.random` (hash `mix32` da semente do tipo). Nada no import.
 */
import { mix32 } from '@boboforces/shared';
import { ZOMBIE_KINDS, type ZombieKind } from './bobo.ts';
import { HEAD_COLOR, headColorTable, paintTarget, px, shadeRgb, texel } from './figure-paint-head.ts';
import { JACKET_HEM_ROW, RING_BACK, RING_FRONT, RING_NX, TORSO_RING } from './figure-paint-outfit.ts';

/** Cor para onde a roupa do zumbi desbota, e quanto. */
export const ZOMBIE_FADE_TO = 0x8a8a86;
export const ZOMBIE_FADE = 0.35;
/** Gosma do chonker (amostra 14 da paleta) e as cores dos curativos (a amostra 15 é a do 1º curativo). */
export const ZOMBIE_GOO = 0x93ad57;
const BANDAGES_0 = 0xe07ab0;
const BANDAGES_1 = 0x9ee8ff;
const BANDAGES_2 = 0xffd56b;
const TONGUE = 0xc06e50;
/** Costura (o `STITCH` da folha de hoje, `placa` 1). */
const STITCH = 0xbdbbb2;

/** Estilos de rosto de zumbi, na ordem da folha de hoje (`ZOMBIE_FACE_STYLES`). */
export const ZOMBIE_FACE_STYLE = {
  spiral: 0,
  droopy: 1,
  tongue: 2,
  ooh: 3,
  stitched: 4,
  bigEye: 5,
  teeth: 6,
  crossEyed: 7,
} as const;

/** Semente do tipo (índice em `ZOMBIE_KINDS`, espalhado): os rasgos são os mesmos para todo zumbi do tipo. */
export function zombieKindSeed(kind: ZombieKind): number {
  let k = 0;
  for (let i = 0; i < ZOMBIE_KINDS.length; i++) if (ZOMBIE_KINDS[i] === kind) k = i;
  return mix32(0x2b0b0 + k * 0x9e3779b1);
}

function hash(seed: number, n: number): number {
  return mix32(seed ^ Math.imul(n + 1, 0x85ebca6b));
}

/** Cor do 1º curativo do tipo (amostra 15 da paleta). */
export function zombieBandage(seed: number, k: number): number {
  const i = hash(seed, 500 + k) % 3;
  return i === 0 ? BANDAGES_0 : i === 1 ? BANDAGES_1 : BANDAGES_2;
}

// quente:
/**
 * Traço do estilo de zumbi na grade 16×16 da expressão `e` (ordem de `FACE_EXPRESSIONS`), por cima de boca, olhos e
 * sobrancelhas e por baixo da linha do cabelo, dos óculos e do chapéu. "Calma" = neutro, mirando e bravo.
 */
export function paintZombieFaceTrait(style: number, e: number): void {
  const c = headColorTable();
  const white = c[HEAD_COLOR.eyeWhite]!;
  const pupil = c[HEAD_COLOR.pupil]!;
  const calm = e <= 2;
  switch (style) {
    case ZOMBIE_FACE_STYLE.spiral:
      // Olho direito do bobo (esquerda da imagem) em espiral: anel 3×3 claro com o miolo escuro e a ponta aberta.
      if (!calm) return;
      px(3, 6, white, 3, 3);
      px(4, 7, pupil);
      px(5, 6, pupil);
      break;
    case ZOMBIE_FACE_STYLE.droopy:
      // Olho caído: o da esquerda da imagem desce 1 linha, com a pálpebra por cima.
      if (!calm) return;
      px(3, 7, c[HEAD_COLOR.lidGrit]!, 3, 1);
      px(3, 8, white, 3, 2);
      px(4, 8, c[HEAD_COLOR.eyes]!, 2, 2);
      px(5, 9, pupil);
      break;
    case ZOMBIE_FACE_STYLE.tongue:
      // Língua de fora (menos comemorando e morto).
      if (e === 5 || e === 7) return;
      px(8, 13, TONGUE, 2, 2);
      break;
    case ZOMBIE_FACE_STYLE.ooh:
      // "Uuuh": a boca em "O" do assustado.
      if (!calm) return;
      px(6, 11, c[HEAD_COLOR.mouth]!, 4, 3);
      px(7, 12, c[HEAD_COLOR.mouthDeep]!, 2, 1);
      break;
    case ZOMBIE_FACE_STYLE.stitched:
      // Costurado: pontos alternados na linha da boca (menos comemorando, assustado e dor).
      if (e === 5 || e === 3 || e === 4) return;
      px(5, 12, STITCH);
      px(7, 12, STITCH);
      px(9, 12, STITCH);
      px(6, 11, STITCH);
      px(8, 13, STITCH);
      break;
    case ZOMBIE_FACE_STYLE.bigEye:
      // Olho grande: o da esquerda da imagem 4×3, pupila pequena.
      if (!calm) return;
      px(2, 6, white, 4, 3);
      px(3, 7, pupil);
      break;
    case ZOMBIE_FACE_STYLE.teeth:
      // Dentes: a boca do bravo com um dente faltando.
      if (!calm) return;
      px(4, 11, c[HEAD_COLOR.mouth]!, 8, 3);
      px(5, 12, 0xf5eee2, 6, 1);
      px(7, 12, c[HEAD_COLOR.mouth]!, 1, 1);
      px(9, 12, c[HEAD_COLOR.mouth]!, 1, 1);
      px(10, 12, c[HEAD_COLOR.mouthDeep]!, 1, 1);
      break;
    default:
      // Vesgo: pupilas para dentro, em alturas diferentes.
      if (!calm) return;
      px(3, 7, white, 3, 2);
      px(10, 7, white, 3, 2);
      px(5, 7, c[HEAD_COLOR.eyes]!, 1, 2);
      px(5, 8, pupil);
      px(10, 7, c[HEAD_COLOR.eyes]!, 1, 2);
      px(10, 7, pupil);
      break;
  }
}

/**
 * Farda rasgada no tronco, por hash da semente do tipo (estudo de pintura §6): barra da jaqueta em dente (0–2 t de
 * pele por coluna acima do cinto, nas 4 faces), um furo 2×1 de pele com a borda (pele −28) na frente e nas costas, 2
 * curativos 3×3 coloridos com o ponto escuro no meio (frente e −X) e, no chonker, a gosma 6×5 na frente.
 */
export function paintZombieRags(seed: number, skin: number, goo: boolean): void {
  const T = paintTarget();
  const K = texel(skin);
  const edge = texel(shadeRgb(skin, -28));
  // Barra em dente (a barra da jaqueta fica logo acima do cinto).
  for (let s = 0; s < 48; s++) {
    const cut = hash(seed, s) % 3;
    for (let r = 0; r < cut; r++) T[TORSO_RING + (JACKET_HEM_ROW - r) * 64 + s] = K;
  }
  // Furos: frente (k 1) e costas (k 2).
  for (let k = 1; k <= 2; k++) {
    const face = k === 1 ? RING_FRONT : RING_BACK;
    const x = 3 + (hash(seed, 100 + k) % 9);
    const y = 12 + (hash(seed, 200 + k) % 6);
    const o = TORSO_RING + y * 64 + face + x;
    T[o] = K;
    T[o + 1] = K;
    T[o + 64] = edge;
    T[o + 65] = edge;
  }
  // Curativos: frente (k 3, 16 de largura) e −X (k 4, 8).
  for (let k = 3; k <= 4; k++) {
    const face = k === 3 ? RING_FRONT : RING_NX;
    const w = k === 3 ? 16 : 8;
    const x = 1 + (hash(seed, 300 + k) % (w - 4));
    const y = 3 + (hash(seed, 400 + k) % 8);
    const color = zombieBandage(seed, k);
    const C = texel(color);
    for (let j = 0; j < 3; j++)
      T.fill(C, TORSO_RING + (y + j) * 64 + face + x, TORSO_RING + (y + j) * 64 + face + x + 3);
    T[TORSO_RING + (y + 1) * 64 + face + x + 1] = texel(shadeRgb(color, -60));
  }
  // Gosma do chonker.
  if (goo) {
    const G = texel(ZOMBIE_GOO);
    for (let j = 0; j < 5; j++)
      T.fill(G, TORSO_RING + (14 + j) * 64 + RING_FRONT + 5, TORSO_RING + (14 + j) * 64 + RING_FRONT + 11);
  }
}
// fim-quente
