/**
 * Cores, pincel e cabeça do pintor do boneco (frente F2; PLANO do porte §B7 e §B9). Porte de
 * `futbobo/app/botao/three/textures.ts:20-47` (cores) e `:147-676` (cabeça) e das expressões extras do teste aprovado
 * (`local/futbobo-teste/cabecas/src/expressoes-extra.ts`: "mirando" e "morto", COMO ESTÃO, #56).
 *
 * O FutBobo pinta cada face da cabeça num canvas 64×64 com `px(x, y, cor, w, h)` = `fillRect` em múltiplos de 4: é uma
 * grade 16×16 de retângulos de cor sólida. Aqui o `px` preenche a grade direto na skin (2 t por px de boneco), com as
 * cores inteiras (`shade`/`mix` com o mesmo `Math.round` por canal do `shadeHex`/`mixHex`). A ordem das pinturas é a
 * do FutBobo, então o resultado é o mesmo byte a byte (a conferência contra o teste das cabeças vai no relatório).
 *
 * Interno do pacote (não sai no `index.ts`): o `figure-paint.ts` monta a skin. Estado de módulo de propósito: o alvo
 * e a origem da grade ficam aqui para o `px` não alocar nem receber 8 argumentos. Nada é montado no import.
 */
import type { FigureLook } from './figure-look.ts';

// --- Cores inteiras (0xRRGGBB) ---

function channel(v: number): number {
  const r = Math.round(v);
  return r < 0 ? 0 : r > 255 ? 255 : r;
}

/** `shadeHex` do FutBobo: soma `amount` aos três canais, com clamp. */
export function shadeRgb(c: number, amount: number): number {
  return (
    (channel(((c >> 16) & 255) + amount) << 16) |
    (channel(((c >> 8) & 255) + amount) << 8) |
    channel((c & 255) + amount)
  );
}

/** `mixHex` do FutBobo: a + (b − a)·t por canal, arredondado. */
export function mixRgb(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  return (
    (channel(ar + (((b >> 16) & 255) - ar) * t) << 16) |
    (channel(ag + (((b >> 8) & 255) - ag) * t) << 8) |
    channel(ab + ((b & 255) - ab) * t)
  );
}

/** `luminance` do FutBobo (0..1). */
export function luminanceRgb(c: number): number {
  return (0.2126 * ((c >> 16) & 255) + 0.7152 * ((c >> 8) & 255) + 0.0722 * (c & 255)) / 255;
}

/** `readableInk` do FutBobo (`kits.ts:37-41`): tinta escura no fundo claro, branca no resto. */
export function readableInkRgb(background: number): number {
  return luminanceRgb(background) > 0.58 ? 0x10271d : 0xffffff;
}

/**
 * RGB → texel RGBA opaco como Int32 little-endian (todos os alvos são little-endian, `shared/hash.ts`). O alfa 0xff no
 * byte alto deixa o valor entre −2^24 e −1: cabe num Smi, sem HeapNumber por texel.
 */
export function texel(rgb: number): number {
  return 0xff000000 | ((rgb & 255) << 16) | (rgb & 0xff00) | ((rgb >> 16) & 255);
}

/** Texel Int32 → RGB. */
export function texelRgb(t: number): number {
  return ((t & 255) << 16) | (t & 0xff00) | ((t >>> 16) & 255);
}

// --- Cores derivadas da cabeça (um Int32Array de rascunho, feito uma vez por processo) ---

/** Índices das cores da cabeça no rascunho. */
export const HEAD_COLOR = {
  skin: 0,
  hair: 1,
  hairTop: 2,
  eyes: 3,
  accessory: 4,
  accessoryShade: 5,
  beard: 6,
  beardSoft: 7,
  beardThin: 8,
  beardStubble: 9,
  stubble: 10,
  scalp: 11,
  hairDark: 12,
  hairLight: 13,
  brow: 14,
  chin: 15,
  nose: 16,
  blush: 17,
  eyeWhite: 18,
  pupil: 19,
  blink: 20,
  lidGrit: 21,
  lidSad: 22,
  mouth: 23,
  mouthDeep: 24,
  mouthSide: 25,
  mouthPout: 26,
  freckle: 27,
  mole: 28,
  scar: 29,
  scarEdge: 30,
  parting: 31,
  bandanaDot: 32,
  bandMid: 33,
  ear: 34,
  earInner: 35,
  sideTopLine: 36,
  backStrand: 37,
  braidKnot: 38,
  slickedBack: 39,
  bottom: 40,
  baldShine: 41,
  doubleParting: 42,
  topBase: 43,
  topStrand: 44,
  topFront: 45,
  topSide: 46,
  topTwists: 47,
  topComb: 48,
  topCombFront: 49,
  deadInk: 50,
} as const;
const HEAD_COLORS = 51;

const TEETH = 0xf5eee2;
const TONGUE = 0xc0464a;
const EYE_WHITE = 0xf4f1ea;
const BLUSH = 0xff8a80;
const BROW_DARK = 0x2a1f1a;
const FRECKLE = 0x8a4b2a;
const MOLE = 0x3b2418;
const SCAR = 0xf6cdc2;
const GREASE = 0x17171a;
const GOGGLE_STRAP = 0x1d1e22;
const PROTECTIVE_MASK = 0x16171a;
const SUNGLASS_LENS = 0x14171c;
/** Ouro dos brincos (`EARRING_GOLD`). */
export const FIGURE_GOLD = 0xe8c25a;
// Lentes e brilhos: rgba do FutBobo com o alfa em 8 bits (round(a·255)), compostos por cima (saída opaca).
const LENS_TINT = 0x96d7ff;
const LENS_TINT_A = 77;
const LENS_GLINT_A = 102;
const MASK_GLINT_A = 46;
const SUN_GLINT_A = 87;
const WHITE = 0xffffff;

// Índices das listas do FutBobo (`textures.ts:154-163`).
const HEADWEAR_BAND = 1;
const HEADWEAR_TIARA = 2;
const HEADWEAR_BANDANA = 3;
const HEADWEAR_CAP = 4;
const EYEWEAR_GOGGLES = 1;
const EYEWEAR_MASK = 2;
const EYEWEAR_SUNGLASSES = 3;
const EARRING_STUD = 1;
const EARRING_HOOPS = 3;
const BALD = 12;
const BLEACHED = 11;
/** `STUBBLE_STYLES` {3, 5, 15, 18, 20, 22, 26, 30} como máscara de bits. */
const STUBBLE_MASK = (1 << 3) | (1 << 5) | (1 << 15) | (1 << 18) | (1 << 20) | (1 << 22) | (1 << 26) | (1 << 30);
/** Lados longos {4, 6, 9, 13, 14, 17, 31} (`paintSideHair`). */
const LONG_SIDE_MASK = (1 << 4) | (1 << 6) | (1 << 9) | (1 << 13) | (1 << 14) | (1 << 17) | (1 << 31);
/** Bloco lateral baixo {4, 9, 13, 17, 31}. */
const SIDE_BLOCK_MASK = (1 << 4) | (1 << 9) | (1 << 13) | (1 << 17) | (1 << 31);
/** Nuca funda {4, 6, 9, 13, 14, 16, 17, 21, 31, 32} (`paintBackHair`); o 32 fica fora dos 32 bits. */
const DEEP_BACK_MASK =
  (1 << 4) | (1 << 6) | (1 << 9) | (1 << 13) | (1 << 14) | (1 << 16) | (1 << 17) | (1 << 21) | (1 << 31);

/** Humores do FutBobo (`FACE_MOODS`) + as 2 expressões extras do BF. */
export const FACE_MOOD = { normal: 0, blink: 1, shout: 2, sad: 3, surprised: 4, grit: 5, aiming: 6, dead: 7 } as const;
/** Humor de cada expressão do BF, na ordem de `FACE_EXPRESSIONS` (PLANO §B9). */
export const EXPRESSION_MOOD: readonly number[] = [
  FACE_MOOD.normal,
  FACE_MOOD.aiming,
  FACE_MOOD.grit,
  FACE_MOOD.surprised,
  FACE_MOOD.sad,
  FACE_MOOD.shout,
  FACE_MOOD.blink,
  FACE_MOOD.dead,
];

let headColors: Int32Array | null = null;

/** O rascunho das cores da cabeça (alocado na 1ª pintura do processo). */
export function headColorTable(): Int32Array {
  if (headColors === null) headColors = new Int32Array(HEAD_COLORS);
  return headColors;
}

// --- Pincel: grade 16×16 na skin (Int32 por texel, linha de 64) ---

let target: Int32Array | null = null;
let grid = 0;
let look: FigureLook | null = null;

/** Alvo da pintura (a skin inteira, 2 camadas 64×64) e o look da cabeça. */
export function setPaintTarget(skin: Int32Array, l: FigureLook): void {
  target = skin;
  look = l;
}

/** Solta o alvo e o look guardados (o `disposeFigurePaint` chama; nada fica preso ao buffer do dono). */
export function releasePaintTarget(): void {
  target = null;
  look = null;
}

/** A skin que está sendo pintada (Int32 por texel: camada·4096 + v·64 + u). */
export function paintTarget(): Int32Array {
  return target!;
}

/** Origem da grade 16×16 atual: camada, u, v em texels. */
export function setGrid(layer: number, u: number, v: number): void {
  grid = layer * 4096 + v * 64 + u;
}

// quente:
/** `px` do FutBobo: retângulo w×h de cor sólida na grade 16×16 (recortado nela). */
export function px(x: number, y: number, rgb: number, w = 1, h = 1): void {
  const x0 = x < 0 ? 0 : x;
  const y0 = y < 0 ? 0 : y;
  const x1 = x + w > 16 ? 16 : x + w;
  const y1 = y + h > 16 ? 16 : y + h;
  if (x1 <= x0 || y1 <= y0) return;
  const c = texel(rgb);
  const t = target!;
  let o = grid + y0 * 64 + x0;
  const n = x1 - x0;
  for (let j = y0; j < y1; j++) {
    if (n === 1) t[o] = c;
    else t.fill(c, o, o + n);
    o += 64;
  }
}

/**
 * round(x / 255) para x inteiro em 0..65025, só com inteiros: no interpretador (o proxy do Switch) uma divisão com
 * resto vira número em caixa (HeapNumber) a cada canal. Sem empate (x/255 nunca termina em ,5); conferido nos 65.026
 * valores contra `Math.round`.
 */
export function round255(x: number): number {
  const y = x + 127;
  return (y + 1 + (y >> 8)) >> 8;
}

/** Retângulo com alfa `a` (0..255) por cima do que já está pintado (lentes e brilhos); continua opaco. */
export function pxAlpha(x: number, y: number, rgb: number, a: number, w = 1, h = 1): void {
  const r = (rgb >> 16) & 255;
  const g = (rgb >> 8) & 255;
  const b = rgb & 255;
  const ia = 255 - a;
  const t = target!;
  for (let j = y; j < y + h; j++) {
    for (let i = x; i < x + w; i++) {
      if (i < 0 || i >= 16 || j < 0 || j >= 16) continue;
      const o = grid + j * 64 + i;
      const d = t[o]!;
      const nr = round255((d & 255) * ia + r * a);
      const ng = round255(((d >> 8) & 255) * ia + g * a);
      const nb = round255(((d >> 16) & 255) * ia + b * a);
      t[o] = 0xff000000 | (nb << 16) | (ng << 8) | nr;
    }
  }
}

/** Copia a grade 16×16 com origem `from` (índice de texel) para a grade atual. */
export function copyGrid(from: number): void {
  const t = target!;
  for (let j = 0; j < 16; j++) t.copyWithin(grid + j * 64, from + j * 64, from + j * 64 + 16);
}

/** Índice de texel da origem da grade atual. */
export function gridOrigin(): number {
  return grid;
}

function isStubble(style: number): boolean {
  return style < 32 && ((STUBBLE_MASK >>> style) & 1) === 1;
}

/** Calcula as cores derivadas da cabeça no rascunho (`accessory` já travado contra os times). */
export function resolveHeadColors(l: FigureLook, accessory: number, zombie: boolean): void {
  const c = headColorTable();
  const H = HEAD_COLOR;
  const skin = l.skinTone;
  const hair = l.hair;
  const top = l.hairTop;
  const style = l.hairStyle;
  c[H.skin] = skin;
  c[H.hair] = hair;
  c[H.hairTop] = top;
  c[H.eyes] = l.eyes;
  c[H.accessory] = accessory;
  // `accessoryShade`: mais escuro, ou mais claro no preto.
  const accShade = luminanceRgb(accessory) < 0.16 ? shadeRgb(accessory, 38) : shadeRgb(accessory, -36);
  c[H.accessoryShade] = accShade;
  const beard = shadeRgb(hair, -6);
  c[H.beard] = beard;
  c[H.beardSoft] = mixRgb(skin, beard, 0.55);
  c[H.beardThin] = mixRgb(skin, beard, 0.7);
  c[H.beardStubble] = mixRgb(skin, beard, 0.4);
  c[H.stubble] = mixRgb(skin, hair, 0.42);
  c[H.scalp] = mixRgb(skin, hair, 0.22);
  c[H.hairDark] = shadeRgb(top, -22);
  c[H.hairLight] = shadeRgb(top, 18);
  c[H.brow] = mixRgb(shadeRgb(hair, 10), BROW_DARK, luminanceRgb(hair) > 0.7 ? 0.35 : 0);
  c[H.chin] = shadeRgb(skin, -12);
  c[H.nose] = shadeRgb(skin, -18);
  // Zumbi (PLANO §B11): sem blush (pele −16) e o branco do olho amarelado.
  c[H.blush] = zombie ? shadeRgb(skin, -16) : mixRgb(skin, BLUSH, 0.12);
  c[H.eyeWhite] = zombie ? 0xdcbc5a : EYE_WHITE;
  c[H.pupil] = shadeRgb(l.eyes, -38);
  c[H.blink] = shadeRgb(skin, -48);
  c[H.lidGrit] = shadeRgb(skin, -26);
  c[H.lidSad] = shadeRgb(skin, -20);
  c[H.mouth] = shadeRgb(skin, -70);
  c[H.mouthDeep] = shadeRgb(skin, -110);
  c[H.mouthSide] = shadeRgb(skin, -38);
  c[H.mouthPout] = shadeRgb(skin, -40);
  c[H.freckle] = mixRgb(skin, FRECKLE, 0.42);
  c[H.mole] = mixRgb(skin, MOLE, 0.75);
  c[H.scar] = mixRgb(skin, SCAR, 0.6);
  c[H.scarEdge] = shadeRgb(skin, -24);
  c[H.parting] = mixRgb(skin, top, 0.4);
  c[H.bandanaDot] = luminanceRgb(accessory) > 0.6 ? shadeRgb(accessory, -60) : mixRgb(accessory, WHITE, 0.6);
  c[H.bandMid] = mixRgb(accessory, accShade, 0.45);
  c[H.ear] = shadeRgb(skin, -14);
  c[H.earInner] = shadeRgb(skin, -28);
  c[H.sideTopLine] = shadeRgb(top, 16);
  c[H.backStrand] = shadeRgb(top, -16);
  c[H.braidKnot] = shadeRgb(top, -20);
  c[H.slickedBack] = shadeRgb(top, -18);
  c[H.bottom] = shadeRgb(skin, -24);
  c[H.baldShine] = shadeRgb(skin, 22);
  c[H.doubleParting] = shadeRgb(skin, 6);
  const base = isStubble(style) ? c[H.stubble]! : style === 27 ? c[H.scalp]! : top;
  c[H.topBase] = base;
  c[H.topStrand] = shadeRgb(base, -12);
  c[H.topFront] = shadeRgb(base, 14);
  c[H.topSide] = shadeRgb(base, -30);
  c[H.topTwists] = shadeRgb(base, -28);
  c[H.topComb] = shadeRgb(base, -26);
  c[H.topCombFront] = shadeRgb(base, 22);
  c[H.deadInk] = shadeRgb(skin, -110);
}

/** Linhas de cabelo na testa, por corte (`paintHairFront`, `textures.ts:196-280`). */
function paintHairFront(l: FigureLook, c: Int32Array): void {
  const style = l.hairStyle;
  const hair = c[HEAD_COLOR.hairTop]!;
  const dark = c[HEAD_COLOR.hairDark]!;
  const light = c[HEAD_COLOR.hairLight]!;
  const skin = c[HEAD_COLOR.skin]!;
  if (style === BALD) return;
  if (isStubble(style)) {
    px(0, 0, c[HEAD_COLOR.stubble]!, 16, 2);
    if (style === 3 || style === 30) px(6, 0, hair, 4, 2);
    if (style === 15) px(4, 0, hair, 8, 3);
    if (style === 18) {
      px(1, 0, hair, 14, 2);
      px(1, 2, dark, 9, 1);
    }
    if (style === 20) {
      px(3, 0, skin, 1, 2);
      px(6, 0, skin, 1, 2);
    }
    // Cascão 2002: o triângulo do topete com a ponta na testa.
    if (style === 22) {
      px(5, 0, hair, 6, 1);
      px(6, 1, hair, 4, 1);
      px(7, 2, hair, 2, 1);
    }
    // Hi-top: a base reta do bloco, laterais na máquina.
    if (style === 26) {
      px(1, 0, hair, 14, 2);
      px(1, 0, light, 14, 1);
    }
    return;
  }
  px(0, 0, hair, 16, 3);
  px(0, 0, light, 16, 1);
  switch (style) {
    case 0:
      px(0, 3, hair, 2, 2);
      px(14, 3, hair, 2, 2);
      break;
    case 1:
      px(0, 3, hair, 16, 1);
      for (let x = 1; x < 13; x += 3) px(x, 4, hair, 2, 1);
      px(0, 4, hair, 1, 2);
      px(15, 4, hair, 1, 2);
      break;
    case 2:
    case 21:
      for (let x = 0; x < 16; x += 2) px(x + (style === 21 ? 1 : 0), 3, hair, 1, 1);
      px(0, 3, hair, 1, 3);
      px(15, 3, hair, 1, 3);
      break;
    case 4:
    case 31:
      px(0, 3, hair, 16, 1);
      px(0, 4, hair, 2, 4);
      px(14, 4, hair, 2, 4);
      break;
    case 6:
    case 16:
      for (let x = 1; x < 16; x += 3) px(x, 0, dark, 1, 3);
      px(0, 3, hair, 1, 2);
      px(15, 3, hair, 1, 2);
      break;
    case 7:
      px(0, 3, hair, 11, 1);
      px(0, 4, hair, 6, 1);
      px(11, 1, dark, 1, 2);
      break;
    case 8:
      px(0, 3, hair, 2, 1);
      px(14, 3, hair, 2, 1);
      px(3, 3, light, 9, 1);
      break;
    case 9:
      // for (const x of [0, 1, 14, 15]) px(x, 3, hair, 1, 6 + (x % 2) * 2)
      px(0, 3, hair, 1, 6);
      px(1, 3, hair, 1, 8);
      px(14, 3, hair, 1, 6);
      px(15, 3, hair, 1, 8);
      break;
    case 10:
    case 19:
      px(0, 1, dark, 16, 1);
      px(0, 3, hair, 1, 2);
      px(15, 3, hair, 1, 2);
      break;
    case 11:
      px(0, 2, c[HEAD_COLOR.hair]!, 16, 1);
      px(0, 3, c[HEAD_COLOR.hair]!, 2, 2);
      px(14, 3, c[HEAD_COLOR.hair]!, 2, 2);
      break;
    case 13:
      px(0, 3, hair, 2, 3);
      px(14, 3, hair, 2, 3);
      break;
    case 14:
      px(0, 3, hair, 16, 2);
      px(0, 5, hair, 2, 2);
      px(14, 5, hair, 2, 2);
      break;
    case 17:
      px(6, 3, hair, 10, 1);
      px(9, 4, hair, 7, 1);
      px(12, 5, hair, 4, 1);
      px(14, 6, hair, 2, 1);
      break;
    case 23:
      // Longo solto: mechas emoldurando o rosto até o queixo e a franja leve, de lado.
      px(0, 3, hair, 2, 13);
      px(14, 3, hair, 2, 13);
      px(2, 3, hair, 7, 1);
      px(2, 4, hair, 3, 1);
      break;
    case 24:
      // Arrepiado: franja em dente de serra (x = 1, 5, 9, 13).
      for (let x = 1; x < 16; x += 4) {
        px(x, 3, hair, 2, 1);
        px(x < 8 ? x + 1 : x, 4, hair, 1, 1);
      }
      px(3, 0, dark, 1, 2);
      px(12, 0, dark, 1, 2);
      break;
    case 25:
      // Repartido: risca no meio e as duas cortinas abrindo a testa em V.
      px(7, 0, c[HEAD_COLOR.parting]!, 2, 1);
      px(7, 1, skin, 2, 1);
      px(6, 2, skin, 4, 1);
      px(0, 3, hair, 5, 1);
      px(11, 3, hair, 5, 1);
      px(0, 4, hair, 3, 1);
      px(13, 4, hair, 3, 1);
      px(0, 5, hair, 2, 1);
      px(14, 5, hair, 2, 1);
      break;
    case 27:
      // Nagô: fileiras da testa para trás, com o couro entre elas.
      px(0, 2, skin, 16, 1);
      for (let x = 0; x < 16; x += 3) px(x, 0, c[HEAD_COLOR.scalp]!, 1, 2);
      break;
    case 28:
      px(7, 0, c[HEAD_COLOR.scalp]!, 2, 2);
      px(0, 3, hair, 1, 2);
      px(15, 3, hair, 1, 2);
      break;
    case 29:
      // Pra trás: entrada alta e limpa, fios penteados para trás (x = 3, 6, 9, 12).
      px(0, 2, skin, 16, 1);
      px(0, 2, hair, 1, 2);
      px(15, 2, hair, 1, 2);
      for (let x = 3; x < 13; x += 3) px(x, 1, dark, 1, 1);
      break;
    case 32:
      // Chanel: franja reta até a sobrancelha, laterais até o queixo.
      px(0, 3, hair, 16, 2);
      px(0, 4, dark, 16, 1);
      px(0, 5, hair, 1, 8);
      px(15, 5, hair, 1, 8);
      break;
    case 33:
      px(0, 3, hair, 1, 2);
      px(15, 3, hair, 1, 2);
      break;
    default:
      break;
  }
}

/** Traço da sobrancelha (a "Grossa" ganha uma linha por cima). */
function browStroke(x: number, y: number, w: number, up: number, brow: number): void {
  px(x, y - up, brow, w, 1 + up);
}

/** Sobrancelhas por humor (`paintBrows`, `textures.ts:282-317`). */
function paintBrows(l: FigureLook, c: Int32Array, mood: number): void {
  const brow = c[HEAD_COLOR.brow]!;
  const row = mood === FACE_MOOD.shout || mood === FACE_MOOD.surprised ? 4 : 5 + (l.brow === 0 ? 1 : 0);
  const up = l.brow === 4 ? 1 : 0;
  // Desconfiado: a sobrancelha da direita da imagem sobe (no rosto de sempre).
  const raise = l.face === 10 && (mood === FACE_MOOD.normal || mood === FACE_MOOD.blink) ? 1 : 0;
  // Onde passa o risco da "Com risco" (na sobrancelha da direita da imagem); −1 = sem risco.
  let slitX = -1;
  let slitY = 0;
  if (mood === FACE_MOOD.sad) {
    browStroke(3, row + 1, 2, up, brow);
    browStroke(5, row, 2, up, brow);
    browStroke(9, row, 2, up, brow);
    browStroke(11, row + 1, 2, up, brow);
    slitX = 11;
    slitY = row + 1;
  } else if (mood === FACE_MOOD.grit) {
    // Raça: sobrancelhas descem em direção ao nariz.
    browStroke(3, 5, 2, up, brow);
    browStroke(5, 6, 2, up, brow);
    browStroke(9, 6, 2, up, brow);
    browStroke(11, 5, 2, up, brow);
    slitX = 11;
    slitY = 5;
  } else if (mood === FACE_MOOD.surprised) {
    // Arqueadas e altas.
    browStroke(4, row - 1, 2, up, brow);
    browStroke(3, row, 1, up, brow);
    browStroke(6, row, 1, up, brow);
    browStroke(10, row - 1, 2, up, brow);
    browStroke(9, row, 1, up, brow);
    browStroke(12, row, 1, up, brow);
    slitX = 11;
    slitY = row - 1;
  } else if (l.brow === 2 && mood === FACE_MOOD.normal) {
    // Sobrancelha intensa: desce em direção ao nariz.
    px(3, row, brow, 3, 1);
    px(5, row + 1, brow, 2, 1);
    px(10, row - raise, brow, 3, 1);
    px(9, row + 1 - raise, brow, 2, 1);
  } else {
    const thick = l.brow === 2 || l.brow === 4 ? 2 : 1;
    px(3, row, brow, 4, thick);
    px(9, row - raise, brow, 4, thick);
    slitX = 11;
    slitY = row - raise;
  }
  if (l.brow === 3 && slitX >= 0) px(slitX, slitY, c[HEAD_COLOR.skin]!, 1, 1);
}

/** Olhos por humor (`paintEyes`, `textures.ts:319-354`). */
function paintEyes(l: FigureLook, c: Int32Array, mood: number): void {
  if (mood === FACE_MOOD.blink) {
    px(3, 8, c[HEAD_COLOR.blink]!, 3, 1);
    px(10, 8, c[HEAD_COLOR.blink]!, 3, 1);
    return;
  }
  const white = c[HEAD_COLOR.eyeWhite]!;
  const pupil = c[HEAD_COLOR.pupil]!;
  const eyes = c[HEAD_COLOR.eyes]!;
  if (mood === FACE_MOOD.shout) {
    px(3, 7, white, 3, 2);
    px(10, 7, white, 3, 2);
    px(4, 7, eyes, 1, 2);
    px(11, 7, eyes, 1, 2);
    return;
  }
  if (mood === FACE_MOOD.surprised) {
    // Olhos arregalados: 3×3 com a pupila pequena no meio.
    px(3, 6, white, 3, 3);
    px(10, 6, white, 3, 3);
    px(4, 7, pupil);
    px(11, 7, pupil);
    return;
  }
  if (mood === FACE_MOOD.grit) {
    // Olhos semicerrados de esforço.
    px(3, 8, white, 3, 1);
    px(10, 8, white, 3, 1);
    px(4, 8, eyes, 2, 1);
    px(10, 8, eyes, 2, 1);
    px(3, 7, c[HEAD_COLOR.lidGrit]!, 3, 1);
    px(10, 7, c[HEAD_COLOR.lidGrit]!, 3, 1);
    return;
  }
  px(3, 7, white, 3, 2);
  px(10, 7, white, 3, 2);
  px(4, 7, eyes, 2, 2);
  px(10, 7, eyes, 2, 2);
  px(5, 8, pupil);
  px(10, 8, pupil);
  if (mood === FACE_MOOD.sad) {
    px(3, 7, c[HEAD_COLOR.lidSad]!, 3, 1);
    px(10, 7, c[HEAD_COLOR.lidSad]!, 3, 1);
  }
  // Desconfiado: o olho do lado da sobrancelha baixa fica meio fechado.
  else if (l.face === 10) px(3, 7, c[HEAD_COLOR.lidSad]!, 3, 1);
}

/** Barba na frente (`paintBeard`, `textures.ts:356-384`). */
function paintBeard(l: FigureLook, c: Int32Array): void {
  const color = c[HEAD_COLOR.beard]!;
  const soft = c[HEAD_COLOR.beardSoft]!;
  switch (l.beard) {
    case 1:
      px(6, 13, color, 4, 3);
      px(5, 11, color, 6, 1);
      break;
    case 2:
    case 8:
      // A longa é a cheia no rosto; o volume que desce do queixo é uma caixa no boneco.
      px(0, 9, color, 2, 7);
      px(14, 9, color, 2, 7);
      px(2, 12, color, 12, 4);
      px(4, 11, color, 8, 1);
      if (l.beard === 8) {
        px(2, 10, color, 1, 2);
        px(13, 10, color, 1, 2);
      }
      break;
    case 3:
      px(4, 11, color, 8, 1);
      px(4, 12, color, 1, 1);
      px(11, 12, color, 1, 1);
      break;
    case 4:
      px(0, 10, soft, 2, 6);
      px(14, 10, soft, 2, 6);
      px(2, 12, soft, 12, 4);
      px(5, 11, soft, 6, 1);
      break;
    case 5:
      px(1, 8, color, 1, 6);
      px(14, 8, color, 1, 6);
      px(2, 14, color, 12, 1);
      px(7, 13, color, 2, 3);
      break;
    case 6:
      px(5, 11, c[HEAD_COLOR.beardThin]!, 6, 1);
      break;
    case 7: {
      // Por fazer: os 13 pontos do FutBobo, na mesma ordem.
      const d = c[HEAD_COLOR.beardStubble]!;
      px(1, 11, d);
      px(3, 13, d);
      px(5, 14, d);
      px(8, 15, d);
      px(10, 14, d);
      px(12, 13, d);
      px(14, 11, d);
      px(2, 14, d);
      px(13, 14, d);
      px(6, 15, d);
      px(9, 13, d);
      px(4, 12, d);
      px(11, 12, d);
      break;
    }
    // Costeletas: só as laterais, do cabelo até o queixo.
    case 9:
      px(0, 4, color, 1, 9);
      px(15, 4, color, 1, 9);
      break;
    // Ferradura: bigode com as duas barras descendo até o queixo.
    case 10:
      px(4, 11, color, 8, 1);
      px(4, 12, color, 1, 4);
      px(11, 12, color, 1, 4);
      break;
    // Contorno: risco fino pela linha do maxilar.
    case 11:
      px(0, 10, color, 1, 6);
      px(15, 10, color, 1, 6);
      px(1, 15, color, 14, 1);
      break;
    default:
      break;
  }
}

/** Sardas, pinta, cicatriz, graxa e pintura (`paintFaceMark`, `textures.ts:387-409`). */
function paintFaceMark(l: FigureLook, c: Int32Array): void {
  switch (l.faceMark) {
    case 1: {
      const dot = c[HEAD_COLOR.freckle]!;
      px(2, 9, dot);
      px(4, 9, dot);
      px(3, 10, dot);
      px(5, 10, dot);
      px(11, 9, dot);
      px(13, 9, dot);
      px(12, 10, dot);
      px(10, 10, dot);
      break;
    }
    case 2:
      px(12, 11, c[HEAD_COLOR.mole]!);
      break;
    case 3: {
      const scar = c[HEAD_COLOR.scar]!;
      const edge = c[HEAD_COLOR.scarEdge]!;
      px(11, 9, scar);
      px(12, 10, scar);
      px(13, 11, scar);
      px(11, 10, edge);
      px(12, 11, edge);
      break;
    }
    case 4:
      px(3, 9, GREASE, 3, 1);
      px(10, 9, GREASE, 3, 1);
      break;
    case 5: {
      const a = c[HEAD_COLOR.accessory]!;
      px(1, 9, a, 4, 1);
      px(2, 11, a, 3, 1);
      px(11, 9, a, 4, 1);
      px(11, 11, a, 3, 1);
      break;
    }
    default:
      break;
  }
}

/** Boca por humor e rosto (`paintMouth`, `textures.ts:411-459`). */
function paintMouth(l: FigureLook, c: Int32Array, mood: number): void {
  const mouth = c[HEAD_COLOR.mouth]!;
  if (mood === FACE_MOOD.shout) {
    px(5, 11, mouth, 6, 4);
    px(6, 11, TEETH, 4, 1);
    px(6, 14, TONGUE, 4, 1);
    return;
  }
  if (mood === FACE_MOOD.sad) {
    px(6, 12, mouth, 4, 1);
    px(5, 13, mouth, 1, 1);
    px(10, 13, mouth, 1, 1);
    return;
  }
  if (mood === FACE_MOOD.surprised) {
    // Boca em "O".
    px(6, 11, mouth, 4, 3);
    px(7, 12, c[HEAD_COLOR.mouthDeep]!, 2, 1);
    return;
  }
  if (mood === FACE_MOOD.grit) {
    // Dentes cerrados.
    px(4, 11, mouth, 8, 3);
    px(5, 12, TEETH, 6, 1);
    px(7, 12, mouth, 1, 1);
    px(9, 12, mouth, 1, 1);
    return;
  }
  switch (l.face) {
    case 0:
      px(5, 12, mouth, 6, 1);
      break;
    case 1:
      px(5, 12, mouth, 5, 1);
      px(10, 11, mouth, 1, 1);
      break;
    case 2:
      px(4, 11, mouth, 1, 1);
      px(11, 11, mouth, 1, 1);
      px(5, 12, mouth, 6, 1);
      px(6, 12, TEETH, 4, 1);
      break;
    case 3:
      px(5, 12, mouth, 6, 2);
      break;
    case 4:
      px(5, 11, mouth, 1, 1);
      px(10, 11, mouth, 1, 1);
      px(6, 12, mouth, 4, 1);
      break;
    case 5:
      px(7, 11, mouth, 2, 3);
      break;
    case 6:
      px(5, 12, TEETH, 6, 1);
      px(5, 13, mouth, 6, 1);
      px(4, 12, mouth, 1, 1);
      px(11, 12, mouth, 1, 1);
      break;
    case 7:
      px(7, 12, mouth, 2, 1);
      px(7, 13, c[HEAD_COLOR.mouthPout]!, 2, 1);
      break;
    case 9:
      // Sorrisão: boca aberta, dentes de cima à mostra e os cantos para cima.
      px(3, 10, mouth, 1, 1);
      px(12, 10, mouth, 1, 1);
      px(4, 11, mouth, 8, 2);
      px(5, 13, mouth, 6, 1);
      px(4, 11, TEETH, 8, 1);
      px(6, 13, TONGUE, 4, 1);
      break;
    case 10:
      // Desconfiado: boca de canto, puxada para um lado.
      px(5, 12, c[HEAD_COLOR.mouthSide]!, 2, 1);
      px(7, 12, mouth, 4, 1);
      px(11, 11, mouth, 1, 1);
      break;
    default:
      px(5, 12, mouth, 3, 1);
      px(8, 11, mouth, 3, 1);
      break;
  }
}

/** Óculos e máscara, por cima de tudo (`paintEyewear`, `textures.ts:462-493`). */
function paintEyewear(l: FigureLook, c: Int32Array): void {
  const frame = c[HEAD_COLOR.accessory]!;
  switch (l.eyewear) {
    case EYEWEAR_GOGGLES:
      for (let x = 2; x < 16; x += 7) {
        px(x, 6, frame, 5, 1);
        px(x, 9, frame, 5, 1);
        px(x, 7, frame, 1, 2);
        px(x + 4, 7, frame, 1, 2);
        // Lente: só tinge o olho que já está pintado.
        pxAlpha(x + 1, 7, LENS_TINT, LENS_TINT_A, 3, 2);
        pxAlpha(x + 1, 7, WHITE, LENS_GLINT_A, 1, 1);
      }
      px(7, 7, frame, 2, 1);
      px(0, 7, GOGGLE_STRAP, 2, 1);
      px(14, 7, GOGGLE_STRAP, 2, 1);
      break;
    case EYEWEAR_MASK:
      // Máscara protetora: testa baixa, maçãs do rosto e o protetor do nariz, com os furos dos olhos.
      px(1, 6, PROTECTIVE_MASK, 14, 1);
      px(1, 7, PROTECTIVE_MASK, 2, 2);
      px(6, 7, PROTECTIVE_MASK, 4, 2);
      px(13, 7, PROTECTIVE_MASK, 2, 2);
      px(1, 9, PROTECTIVE_MASK, 14, 1);
      px(5, 10, PROTECTIVE_MASK, 6, 1);
      pxAlpha(2, 6, WHITE, MASK_GLINT_A, 3, 1);
      pxAlpha(11, 6, WHITE, MASK_GLINT_A, 3, 1);
      break;
    case EYEWEAR_SUNGLASSES:
      px(2, 7, SUNGLASS_LENS, 5, 2);
      px(9, 7, SUNGLASS_LENS, 5, 2);
      px(2, 6, frame, 5, 1);
      px(9, 6, frame, 5, 1);
      px(7, 7, frame, 2, 1);
      px(0, 7, frame, 2, 1);
      px(14, 7, frame, 2, 1);
      pxAlpha(3, 7, WHITE, SUN_GLINT_A, 1, 1);
      pxAlpha(10, 7, WHITE, SUN_GLINT_A, 1, 1);
      break;
    default:
      break;
  }
}

/** Bolinhas da bandana (estampa), em linhas alternadas (`bandanaDots`, `textures.ts:496-501`). */
function bandanaDots(c: Int32Array, y0: number, rows: number): void {
  const dot = c[HEAD_COLOR.bandanaDot]!;
  for (let y = y0; y < y0 + rows; y += 1) {
    for (let x = (y * 2) % 4; x < 16; x += 4) px(x, y, dot);
  }
}

/** Faixa, tiara, bandana e boné (`paintHeadwear`, `textures.ts:508-522`); `rows` = até onde a bandana desce. */
function paintHeadwear(l: FigureLook, c: Int32Array, bandanaRows: number): void {
  const color = c[HEAD_COLOR.accessory]!;
  switch (l.headwear) {
    case HEADWEAR_BAND:
      px(0, 1, color, 16, 2);
      px(0, 2, c[HEAD_COLOR.bandMid]!, 16, 1);
      break;
    case HEADWEAR_TIARA:
      px(0, 1, color, 16, 1);
      break;
    case HEADWEAR_BANDANA:
      px(0, 0, color, 16, bandanaRows);
      bandanaDots(c, 0, bandanaRows - 1);
      px(0, bandanaRows - 1, c[HEAD_COLOR.accessoryShade]!, 16, 1);
      break;
    case HEADWEAR_CAP:
      px(0, 0, color, 16, 2);
      break;
    default:
      break;
  }
}

/**
 * Base de toda expressão (o começo do `paintFace`, `textures.ts:524-540`): pele, sombra do queixo, nariz, blush,
 * barba e marca. O `figure-paint.ts` pinta isto uma vez e copia para as 8 células.
 */
export function paintFaceBase(): void {
  const c = headColorTable();
  const l = look!;
  px(0, 0, c[HEAD_COLOR.skin]!, 16, 16);
  px(0, 15, c[HEAD_COLOR.chin]!, 16, 1);
  px(7, 10, c[HEAD_COLOR.nose]!, 2, 1);
  px(1, 10, c[HEAD_COLOR.blush]!, 2, 1);
  px(13, 10, c[HEAD_COLOR.blush]!, 2, 1);
  paintBeard(l, c);
  paintFaceMark(l, c);
}

/**
 * Mirando (`paintFaceAiming` do teste aprovado, como está): o olho direito do bobo (esquerda da imagem) aberto, como
 * no "normal"; o esquerdo semicerrado (pálpebra do "grit" na linha 7) com a metade de dentro da sobrancelha descendo
 * 1; boca reta (a do "Sério") em qualquer rosto.
 */
function paintAiming(l: FigureLook, c: Int32Array): void {
  px(5, 12, c[HEAD_COLOR.mouth]!, 6, 1);
  const white = c[HEAD_COLOR.eyeWhite]!;
  const pupil = c[HEAD_COLOR.pupil]!;
  const eyes = c[HEAD_COLOR.eyes]!;
  px(3, 7, white, 3, 2);
  px(10, 7, white, 3, 2);
  px(4, 7, eyes, 2, 2);
  px(10, 7, eyes, 2, 2);
  px(5, 8, pupil, 1, 1);
  px(10, 8, pupil, 1, 1);
  px(10, 7, c[HEAD_COLOR.lidGrit]!, 3, 1);

  const brow = c[HEAD_COLOR.brow]!;
  const row = 5 + (l.brow === 0 ? 1 : 0);
  const up = l.brow === 4 ? 1 : 0;
  // Lado aberto: a sobrancelha de sempre (a "Intensa" com a ponta descendo, como no normal).
  if (l.brow === 2) {
    px(3, row, brow, 3, 1);
    px(5, row + 1, brow, 2, 1);
  } else {
    px(3, row, brow, 4, l.brow === 4 ? 2 : 1);
  }
  // Lado semicerrado: a metade de dentro desce 1 (nunca abaixo da linha 6, para não comer a pálpebra).
  const low = Math.min(row + 1, 6);
  browStroke(9, low, 2, up, brow);
  browStroke(11, low - 1, 2, up, brow);
  if (l.brow === 3) px(11, low - 1, c[HEAD_COLOR.skin]!, 1, 1);
}

/**
 * Morto (`paintFaceDead` do teste aprovado, como está): olhos em X 3×3 nas linhas 6–8 na tinta pele −110,
 * sobrancelhas retas uma linha acima e boca reta.
 */
function paintDead(l: FigureLook, c: Int32Array): void {
  px(5, 12, c[HEAD_COLOR.mouth]!, 6, 1);
  const ink = c[HEAD_COLOR.deadInk]!;
  for (let x = 3; x < 16; x += 7) {
    px(x, 6, ink);
    px(x + 2, 6, ink);
    px(x + 1, 7, ink);
    px(x, 8, ink);
    px(x + 2, 8, ink);
  }
  const brow = c[HEAD_COLOR.brow]!;
  const up = l.brow === 4 ? 1 : 0;
  px(3, 4 - up, brow, 4, 1 + up);
  px(9, 4 - up, brow, 4, 1 + up);
  if (l.brow === 3) px(11, 4, c[HEAD_COLOR.skin]!, 1, 1);
}

/** Boca, olhos e sobrancelhas do humor (o meio do `paintFace`), sobre a base já pintada na grade atual. */
export function paintFaceMood(mood: number): void {
  const c = headColorTable();
  const l = look!;
  if (mood === FACE_MOOD.aiming) {
    paintAiming(l, c);
    return;
  }
  if (mood === FACE_MOOD.dead) {
    paintDead(l, c);
    return;
  }
  paintMouth(l, c, mood);
  paintEyes(l, c, mood);
  paintBrows(l, c, mood);
}

/** O que o `paintFace` pinta por cima de tudo: linha do cabelo, óculos e faixa/bandana/boné. */
export function paintFaceTop(): void {
  const c = headColorTable();
  const l = look!;
  paintHairFront(l, c);
  paintEyewear(l, c);
  paintHeadwear(l, c, 3);
}

/** Cabelo no lado da cabeça (`paintSideHair`, `textures.ts:543-571`); `front` = a frente fica na coluna 0. */
function paintSideHair(l: FigureLook, c: Int32Array, front: boolean): void {
  const style = l.hairStyle;
  if (style === BALD) return;
  const hair = c[HEAD_COLOR.hairTop]!;
  if (isStubble(style)) {
    px(0, 0, c[HEAD_COLOR.stubble]!, 16, style === 18 ? 5 : 4);
    if (style === 18) px(0, 0, hair, 16, 2);
    if (style === 15) px(0, 0, hair, 16, 1);
    return;
  }
  const long = style < 32 && ((LONG_SIDE_MASK >>> style) & 1) === 1;
  px(0, 0, hair, 16, long ? 6 : 4);
  px(front ? 10 : 0, 4, hair, 6, long ? 9 : 4);
  px(front ? 0 : 13, 4, hair, 3, 3);
  if (style < 32 && ((SIDE_BLOCK_MASK >>> style) & 1) === 1) px(front ? 9 : 0, 8, hair, 7, 6);
  if (style === BLEACHED) px(front ? 0 : 12, 3, c[HEAD_COLOR.hair]!, 4, 2);
  // Longo solto: o lado some atrás do cabelo, sobra a bochecha na frente.
  if (style === 23) px(front ? 2 : 0, 0, hair, 14, 16);
  // Chanel: capacete até o queixo.
  if (style === 32) px(0, 0, hair, 16, 13);
  if (style === 27) {
    // Nagô: as fileiras correm da testa para a nuca.
    px(0, 2, c[HEAD_COLOR.scalp]!, 16, 1);
    px(front ? 10 : 0, 5, c[HEAD_COLOR.scalp]!, 6, 1);
  }
  if (style === 29) px(0, 2, c[HEAD_COLOR.slickedBack]!, 16, 1);
  px(0, 0, c[HEAD_COLOR.sideTopLine]!, 16, 1);
}

/** Coluna `x` (largura `w`) do lado, espelhada quando a frente fica na coluna 15 (o `at` do FutBobo). */
function at(front: boolean, x: number, w: number): number {
  return front ? x : 16 - x - w;
}

/**
 * Lado da cabeça (`paintSide`, `textures.ts:574-598`). `front` = `frontOnLeft` do FutBobo (true = +x dele = esquerda
 * do boneco = a face −X do BF; false = a +X, direita).
 */
export function paintHeadSide(front: boolean): void {
  const c = headColorTable();
  const l = look!;
  px(0, 0, c[HEAD_COLOR.skin]!, 16, 16);
  px(at(front, 6, 3), 7, c[HEAD_COLOR.ear]!, 3, 4);
  px(at(front, 7, 1), 8, c[HEAD_COLOR.earInner]!, 1, 2);
  px(0, 15, c[HEAD_COLOR.chin]!, 16, 1);
  paintSideHair(l, c, front);
  const beard = c[HEAD_COLOR.beard]!;
  if (l.beard === 2 || l.beard === 4 || l.beard === 8) {
    px(at(front, 0, 4), 10, l.beard === 4 ? c[HEAD_COLOR.beardSoft]! : beard, 4, 6);
  }
  if (l.beard === 9) px(at(front, 4, 2), 4, beard, 2, 9);
  if (l.beard === 11) {
    px(at(front, 0, 6), 15, beard, 6, 1);
    px(at(front, 5, 1), 9, beard, 1, 6);
  }
  // Brinco: um só fica na orelha esquerda do boneco (+x do FutBobo).
  if (l.earrings > 0 && (l.earrings !== EARRING_STUD || front)) {
    if (l.earrings === EARRING_HOOPS) {
      px(at(front, 6, 1), 11, FIGURE_GOLD, 1, 2);
      px(at(front, 8, 1), 11, FIGURE_GOLD, 1, 2);
      px(at(front, 7, 1), 13, FIGURE_GOLD);
    } else px(at(front, 7, 1), 11, FIGURE_GOLD);
  }
  if (l.eyewear === EYEWEAR_GOGGLES) px(0, 7, GOGGLE_STRAP, 16, 1);
  if (l.eyewear === EYEWEAR_MASK) px(0, 7, PROTECTIVE_MASK, 16, 1);
  if (l.eyewear === EYEWEAR_SUNGLASSES) px(at(front, 0, 6), 7, c[HEAD_COLOR.accessory]!, 6, 1);
  paintHeadwear(l, c, 4);
}

/** Cabelo da nuca (`paintBackHair`, `textures.ts:600-619`). */
function paintBackHair(l: FigureLook, c: Int32Array): void {
  const style = l.hairStyle;
  if (style === BALD) return;
  const hair = c[HEAD_COLOR.hairTop]!;
  if (isStubble(style)) {
    px(0, 0, c[HEAD_COLOR.stubble]!, 16, 9);
    if (style === 3 || style === 30) px(6, 0, hair, 4, 9);
    if (style === 15) px(4, 0, hair, 8, 4);
    if (style === 18) px(0, 0, hair, 16, 3);
    if (style === 26) px(1, 0, hair, 14, 2);
    return;
  }
  const deep = style === 32 || (style < 32 && ((DEEP_BACK_MASK >>> style) & 1) === 1);
  const depth = style === 23 ? 16 : deep ? 13 : 10;
  px(0, 0, hair, 16, depth);
  px(0, 0, c[HEAD_COLOR.sideTopLine]!, 16, 1);
  for (let x = 1; x < 16; x += 4) px(x, 2, c[HEAD_COLOR.backStrand]!, 1, depth - 3);
  if (style === 13) px(2, depth, hair, 12, 3);
  if (style === BLEACHED) px(0, depth - 2, c[HEAD_COLOR.hair]!, 16, 2);
  if (style === 27) for (let x = 0; x < 16; x += 3) px(x, 0, c[HEAD_COLOR.scalp]!, 1, depth);
  // Trança longa: o cabelo junta na nuca, de onde sai a trança (caixas).
  if (style === 33) {
    px(5, 7, c[HEAD_COLOR.braidKnot]!, 6, 1);
    px(6, 8, hair, 4, 4);
    px(6, 9, c[HEAD_COLOR.braidKnot]!, 4, 1);
  }
}

/** Nuca (`paintBack`, `textures.ts:621-632`). */
export function paintHeadBack(): void {
  const c = headColorTable();
  const l = look!;
  px(0, 0, c[HEAD_COLOR.skin]!, 16, 16);
  px(0, 15, c[HEAD_COLOR.ear]!, 16, 1);
  paintBackHair(l, c);
  if (l.eyewear === EYEWEAR_GOGGLES) px(0, 7, GOGGLE_STRAP, 16, 1);
  if (l.eyewear === EYEWEAR_MASK) px(0, 7, PROTECTIVE_MASK, 16, 1);
  // A bandana desce mais na nuca, onde fica o nó.
  paintHeadwear(l, c, 6);
}

/** Topo (`paintTop` + `paintTopHair`, `textures.ts:634-676`): linha 15 = frente, coluna 0 = direita do boneco. */
export function paintHeadTop(): void {
  const c = headColorTable();
  const l = look!;
  const style = l.hairStyle;
  const top = c[HEAD_COLOR.hairTop]!;
  if (style === BALD) {
    px(0, 0, c[HEAD_COLOR.skin]!, 16, 16);
    px(4, 4, c[HEAD_COLOR.baldShine]!, 3, 2);
  } else {
    const stubble = isStubble(style);
    px(0, 0, c[HEAD_COLOR.topBase]!, 16, 16);
    if (style === 3 || style === 30) px(6, 0, top, 4, 16);
    if (style === 15) px(4, 0, top, 8, 16);
    if (style === 18) px(1, 0, top, 14, 16);
    if (style === 20) {
      px(3, 0, c[HEAD_COLOR.doubleParting]!, 1, 10);
      px(6, 0, c[HEAD_COLOR.doubleParting]!, 1, 10);
    }
    if (style === 22) {
      px(5, 12, top, 6, 4);
      px(6, 10, top, 4, 2);
      px(7, 9, top, 2, 1);
    }
    if (style === 26) px(1, 1, top, 14, 14);
    if (style === 27) for (let x = 1; x < 16; x += 3) px(x, 0, top, 2, 16);
    if (!stubble && style !== 27) {
      // Textura de fios: faixas finas, mais claras na frente (luz de cima).
      for (let y = 0; y < 16; y += 3) px(0, y, c[HEAD_COLOR.topStrand]!, 16, 1);
      px(0, 15, c[HEAD_COLOR.topFront]!, 16, 1);
      if (style === 7) px(5, 0, c[HEAD_COLOR.topSide]!, 1, 16);
      if (style === 6 || style === 16) for (let x = 1; x < 16; x += 3) px(x, 0, c[HEAD_COLOR.topTwists]!, 1, 16);
      // Risca no meio (aparece entre as duas metades do repartido e entre os coques).
      if (style === 25 || style === 28) px(7, 0, c[HEAD_COLOR.scalp]!, 2, 16);
      if (style === 29) {
        // Penteado para trás: os riscos do pente correm da testa para a nuca (x = 2, 5, 10, 13).
        px(2, 0, c[HEAD_COLOR.topComb]!, 1, 16);
        px(5, 0, c[HEAD_COLOR.topComb]!, 1, 16);
        px(10, 0, c[HEAD_COLOR.topComb]!, 1, 16);
        px(13, 0, c[HEAD_COLOR.topComb]!, 1, 16);
        px(0, 13, c[HEAD_COLOR.topCombFront]!, 16, 1);
      }
    }
  }
  if (l.headwear === HEADWEAR_BANDANA || l.headwear === HEADWEAR_CAP) {
    px(0, 0, c[HEAD_COLOR.accessory]!, 16, 16);
    if (l.headwear === HEADWEAR_BANDANA) bandanaDots(c, 0, 16);
  }
}

/** Base da cabeça (pele −24, lisa). */
export function paintHeadBottom(): void {
  px(0, 0, headColorTable()[HEAD_COLOR.bottom]!, 16, 16);
}
// fim-quente
