/**
 * Farda do pintor do boneco (frente F2; decisão #58, que tirou o uniforme de futebol). Na cruz 16×24×8 do tronco (2 t
 * por px): a jaqueta no tecido do look (liso, camuflados woodland, deserto, urbano e noturno, ou liso com graxa), gola
 * mais escura, fecho e bolsos do peito, cinto com fivela e, por cima, o colete (placa de frente e de costas com alças,
 * faixa lateral, porta-carregadores e o painel com o ícone do time ▲ ● ■ ◆ na tinta legível). Nas colunas dos membros:
 * a manga com a braçadeira do time, o antebraço com o punho da luva, a coxa e a canela com a joelheira e a barra presa
 * na bota. Na mini-cruz, a bota de combate (sola mais escura e o cadarço numa linha).
 *
 * O camuflado vai só no tronco (a única peça com textura cheia); os membros ficam no tom principal. As manchas são
 * ruído de valor por hash (`mix32` com semente fixa por tecido, sem `Math.random`), que dá a volta no tronco sem
 * costura e continua do topo para a frente; as máscaras são feitas na 1ª pintura do processo (nada no import).
 *
 * Interno do pacote: o `figure-paint.ts` chama.
 */
import { mix32 } from '@boboforces/shared';
import { FIGURE_FABRIC } from './figure-look.ts';
import { luminanceRgb, mixRgb, paintTarget, readableInkRgb, shadeRgb, texel, texelRgb } from './figure-paint-head.ts';

/** Primeiro texel (Int32) da camada 1. */
export const LAYER1 = 4096;
/** Linha 0 do anel do tronco (+X | frente | −X | costas, u 0..47) na camada 1. */
export const TORSO_RING = LAYER1 + 8 * 64;
/** Início de cada face no anel (coordenada `s`). */
export const RING_PX = 0;
export const RING_FRONT = 8;
export const RING_NX = 24;
export const RING_BACK = 32;
const RING_W = 48;
/** Linhas da cruz do tronco (topo/base 8 + anel 24). */
const CROSS_H = 32;

/** Cinto (fita de náilon escura) e fivela. */
const BELT = 0x2d2c28;
const BUCKLE = 0x8f8d84;
const BLACK = 0x000000;
const WHITE = 0xffffff;
/** Luminância 0,16 nos pesos inteiros do `detailRgb` (0,16 · 255 · 10⁴). */
const DARK_LUMA = 408000;

/**
 * Linhas do anel (de cima): o colete na frente e nas costas da 2 à 18 (a faixa lateral da 10 à 18), a barra da jaqueta
 * na 19, o cinto na 20..21 e o cós da calça na 22..23. As 3 de baixo ficam quase sempre atrás das coxas (a coxa do
 * FutBobo é mais funda que o tronco e sobe ~1,4 px nele): o que importa de frente acaba no cinto.
 */
const VEST_TOP = 2;
const VEST_BOTTOM = 18;
const SIDE_TOP = 10;
export const JACKET_HEM_ROW = 19;
const BELT_ROW = 20;
const WAIST_ROW = 22;
/** Braçadeira (linhas da coluna da manga, de cima), punho da luva (antebraço) e joelheira (canela). */
const ARMBAND_FIRST = 2;
const ARMBAND_LAST = 6;
const CUFF_FIRST = 8;
const KNEE_ROWS = 4;
/** Barra da calça presa na bota: as linhas 8 e 9 da canela (e a calha 10..11). */
const HEM_FIRST = 8;

/**
 * Ícones de time 5×5 (▲ time 0, ● 1, ■ 2, ◆ 3), uma linha de 5 bits por número (bit alto = coluna 0). Para quem não
 * distingue as cores: a forma diz o time (GDD §4.7.2; arte-ux §2.7).
 */
const TEAM_ICONS: readonly number[] = [
  // ▲
  0b00100, 0b00100, 0b01110, 0b01110, 0b11111,
  // ●
  0b01110, 0b11111, 0b11111, 0b11111, 0b01110,
  // ■
  0b11111, 0b11111, 0b11111, 0b11111, 0b11111,
  // ◆
  0b00100, 0b01110, 0b11111, 0b01110, 0b00100,
];

// --- Tecidos: máscaras de tom (48×32, a cruz inteira do tronco), feitas na 1ª pintura de cada tecido ---

/** Máscara de cada tecido (índice de `FIGURE_FABRIC`; o liso não tem), feita quando o tecido aparece. */
let masks: (Uint8Array | null)[] | null = null;
/** Rascunho dos texels dos tons do tecido da pintura atual (até 5). */
let tones: Int32Array | null = null;
/** Pesos suaves (smoothstep) das frações de célula: 8 de 8 t e 4 de 4 t (o ruído só é lido em texel inteiro). */
let smooth8: Float64Array | null = null;
let smooth4: Float64Array | null = null;

/** Reticulado do ruído de valor (célula de 2^`shift` t, dá a volta em u com período 48): mix32 da semente, em [0; 1). */
function lattice(shift: number, seed: number): Float64Array {
  const cols = RING_W >> shift;
  const rows = (CROSS_H >> shift) + 1;
  const t = new Float64Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++)
      t[y * cols + x] = mix32(seed ^ Math.imul(x + 1, 0x9e3779b1) ^ Math.imul(y + 1, 0x85ebca6b)) / 4294967296;
  }
  return t;
}

/** Ruído de valor com interpolação suave no reticulado `l` (célula de 2^`shift` t), no texel (u, v) da cruz. */
function noise(l: Float64Array, shift: number, u: number, v: number): number {
  const cols = RING_W >> shift;
  const mask = (1 << shift) - 1;
  const w = shift === 3 ? smooth8! : smooth4!;
  const x0 = u >> shift;
  const y0 = v >> shift;
  const x1 = x0 + 1 === cols ? 0 : x0 + 1;
  const sx = w[u & mask]!;
  const sy = w[v & mask]!;
  const r0 = y0 * cols;
  const r1 = r0 + cols;
  const a = l[r0 + x0]! + (l[r0 + x1]! - l[r0 + x0]!) * sx;
  const b = l[r1 + x0]! + (l[r1 + x1]! - l[r1 + x0]!) * sx;
  return a + (b - a) * sy;
}

/** Manchas grandes de 8 t com a borda recortada pelo ruído de 4 t (peso `w`), em [0; 1), na cruz inteira. */
function blobs(seed: number, w: number): Float64Array {
  const coarse = lattice(3, seed);
  const fine = lattice(2, mix32(seed + 0x6d2b79f5));
  const out = new Float64Array(RING_W * CROSS_H);
  for (let v = 0; v < CROSS_H; v++) {
    for (let u = 0; u < RING_W; u++) out[v * RING_W + u] = (1 - w) * noise(coarse, 3, u, v) + w * noise(fine, 2, u, v);
  }
  return out;
}

function texelHash(seed: number, u: number, v: number): number {
  return mix32(seed ^ Math.imul(u + 7, 0x27d4eb2d) ^ Math.imul(v + 13, 0x165667b1));
}

/** A máscara de tons do tecido `fabric` (0 = o tom principal). Determinística: só hash com semente fixa. */
function buildMask(fabric: number): Uint8Array {
  const m = new Uint8Array(RING_W * CROSS_H);
  const W = FIGURE_FABRIC;
  if (fabric === W.woodland) {
    // Manchas de marrom e de verde claro sobre o tom principal, com "galhos" pretos de um 2º ruído por cima.
    const a = blobs(0x5ca1ab1e, 0.35);
    const b = blobs(0x7a11e7, 0.45);
    for (let i = 0; i < m.length; i++) m[i] = b[i]! > 0.64 ? 2 : a[i]! > 0.6 ? 1 : a[i]! < 0.37 ? 3 : 0;
  } else if (fabric === W.desert) {
    // Três tons em manchas largas e as "gotas de chocolate" (pontos escuros e claros espalhados).
    const a = blobs(0xde5e47, 0.25);
    for (let v = 0; v < CROSS_H; v++) {
      for (let u = 0; u < RING_W; u++) {
        const i = v * RING_W + u;
        const h = texelHash(0xc0c0a, u, v) % 31;
        m[i] = h === 0 || h === 17 ? 3 : h === 9 ? 4 : a[i]! > 0.6 ? 2 : a[i]! < 0.38 ? 1 : 0;
      }
    }
  } else if (fabric === W.urban) {
    // Digital, em blocos de 2×2 t (1 px do boneco), com o ruído lido no canto do bloco e um sorteio por bloco.
    const a = blobs(0x0b5c0de, 0.4);
    for (let v = 0; v < CROSS_H; v++) {
      for (let u = 0; u < RING_W; u++) {
        const bu = u & ~1;
        const bv = v & ~1;
        const n = a[bv * RING_W + bu]! + ((texelHash(0x2d16, bu, bv) & 255) / 255 - 0.5) * 0.16;
        m[v * RING_W + u] = n > 0.66 ? 3 : n > 0.55 ? 2 : n < 0.35 ? 1 : 0;
      }
    }
  } else if (fabric === W.night) {
    // Manchas de pouco contraste (azul-acinzentado e preto) sobre o escuro.
    const a = blobs(0x41647, 0.35);
    for (let i = 0; i < m.length; i++) m[i] = a[i]! > 0.62 ? 2 : a[i]! < 0.35 ? 1 : 0;
  } else if (fabric === W.grease) {
    // Poucas manchas escuras irregulares (o macacão do mecânico).
    const a = blobs(0x63a5e, 0.5);
    for (let i = 0; i < m.length; i++) m[i] = a[i]! > 0.74 ? 2 : a[i]! > 0.66 ? 1 : 0;
  }
  return m;
}

/** Garante o rascunho dos tons e as tabelas do ruído (1ª pintura do processo; as máscaras vêm por tecido). */
export function ensureOutfitMasks(): void {
  if (masks !== null) return;
  masks = [null, null, null, null, null, null];
  tones = new Int32Array(5);
  smooth8 = new Float64Array(8);
  smooth4 = new Float64Array(4);
  for (let i = 0; i < 8; i++) smooth8[i] = (i / 8) * (i / 8) * (3 - (2 * i) / 8);
  for (let i = 0; i < 4; i++) smooth4[i] = (i / 4) * (i / 4) * (3 - (2 * i) / 4);
}

/** A máscara do tecido (feita na 1ª pintura dele no processo); `null` no liso. */
function maskOf(fabric: number): Uint8Array | null {
  if (fabric === FIGURE_FABRIC.plain) return null;
  const all = masks!;
  let m = all[fabric] ?? null;
  if (m === null) {
    m = buildMask(fabric);
    all[fabric] = m;
  }
  return m;
}

// quente:
/**
 * Os tons do tecido a partir do tom principal `j` (texels no rascunho; devolve quantos). Os tons das manchas puxam o
 * principal para as cores do camuflado, então a farda segue a cor que o jogador escolher. `fade` > 0 desbota tudo
 * para `fadeTo` (o zumbi).
 */
export function fabricTones(fabric: number, j: number, fadeTo: number, fade: number): number {
  const t = tones!;
  let n = 1;
  t[0] = j;
  switch (fabric) {
    case FIGURE_FABRIC.woodland:
      t[1] = mixRgb(j, 0x5a4530, 0.75);
      t[2] = mixRgb(j, 0x1f2219, 0.8);
      t[3] = mixRgb(j, 0x9ba46c, 0.55);
      n = 4;
      break;
    case FIGURE_FABRIC.desert:
      t[1] = mixRgb(j, 0xe6d8b5, 0.6);
      t[2] = mixRgb(j, 0x8d6e4c, 0.7);
      t[3] = mixRgb(j, 0x3b2f24, 0.85);
      t[4] = mixRgb(j, 0xf3eddf, 0.7);
      n = 5;
      break;
    case FIGURE_FABRIC.urban:
      t[1] = mixRgb(j, 0xc9cbc8, 0.6);
      t[2] = mixRgb(j, 0x4c4f53, 0.7);
      t[3] = mixRgb(j, 0x222326, 0.85);
      n = 4;
      break;
    case FIGURE_FABRIC.night:
      t[1] = mixRgb(j, 0x4a5366, 0.55);
      t[2] = mixRgb(j, 0x121318, 0.75);
      n = 3;
      break;
    case FIGURE_FABRIC.grease:
      t[1] = mixRgb(j, 0x2b2620, 0.5);
      t[2] = mixRgb(j, 0x17140f, 0.75);
      n = 3;
      break;
    default:
      break;
  }
  for (let i = 0; i < n; i++) t[i] = texel(fade > 0 ? mixRgb(t[i]!, fadeTo, fade) : t[i]!);
  return n;
}

/** Retângulo w×h de um texel na camada 1, canto (u, v). */
function rect(u: number, v: number, w: number, h: number, t: number): void {
  const T = paintTarget();
  for (let y = 0; y < h; y++) {
    const o = LAYER1 + (v + y) * 64 + u;
    T.fill(t, o, o + w);
  }
}

/**
 * Tom de detalhe de uma cor: `amount` mais escuro, ou ¾ dele mais claro nas cores quase pretas (luminância < 0,16, para
 * o detalhe aparecer). A luminância em inteiros (pesos ×10⁴): no interpretador, sem número em caixa.
 */
export function detailRgb(c: number, amount: number): number {
  const lum = 2126 * ((c >> 16) & 255) + 7152 * ((c >> 8) & 255) + 722 * (c & 255);
  return lum < DARK_LUMA ? shadeRgb(c, (amount * 3) >> 2) : shadeRgb(c, -amount);
}

/**
 * A jaqueta na cruz inteira do tronco (com os tons do `fabricTones`), a base e o cós na cor da calça, gola mais escura
 * (frente, costas e em volta do pescoço no topo), fecho no meio da frente, as lapelas dos bolsos do peito e o cinto
 * com fivela. O colete vem depois, por cima.
 */
export function paintJacket(fabric: number, jacket: number, pants: number): void {
  const T = paintTarget();
  const t = tones!;
  const m = maskOf(fabric);
  for (let v = 0; v < CROSS_H; v++) {
    const o = LAYER1 + v * 64;
    if (m === null) T.fill(t[0]!, o, o + RING_W);
    else for (let u = 0; u < RING_W; u++) T[o + u] = t[m[v * RING_W + u]!]!;
  }
  // Base do tronco (o gancho da calça) e o cós da calça nas 2 linhas de baixo do anel.
  const P = texel(pants);
  rect(24, 0, 16, 8, P);
  rect(0, 8 + WAIST_ROW, RING_W, 2, P);
  const collar = texel(detailRgb(jacket, 30));
  const seam = texel(detailRgb(jacket, 22));
  // Gola: 6 t no meio da frente e das costas (linhas 0..1) e o anel 6×4 em volta do pescoço no topo.
  rect(RING_FRONT + 5, 8, 6, 2, collar);
  rect(RING_BACK + 5, 8, 6, 2, collar);
  rect(8 + 5, 2, 6, 4, collar);
  // Fecho no meio da frente (até a barra) e as lapelas dos bolsos do peito (linha 4, x 2..5 e 10..13).
  rect(RING_FRONT + 8, 10, 1, JACKET_HEM_ROW - 1, seam);
  rect(RING_FRONT + 2, 12, 4, 1, seam);
  rect(RING_FRONT + 10, 12, 4, 1, seam);
  paintBelt(texel(BELT), texel(detailRgb(BELT, 10)));
}

/** Cinto nas linhas 20..21 do anel inteiro (`a` em cima, `b` embaixo), com a fivela no meio da frente. */
function paintBelt(a: number, b: number): void {
  rect(0, 8 + BELT_ROW, RING_W, 1, a);
  rect(0, 8 + BELT_ROW + 1, RING_W, 1, b);
  rect(RING_FRONT + 7, 8 + BELT_ROW, 2, 2, texel(BUCKLE));
}

/** O ícone do time `team` (0..3) 5×5 com canto (u, v) da camada 1, na tinta `ink` (texel). */
function paintIcon(team: number, u: number, v: number, ink: number): void {
  const T = paintTarget();
  for (let y = 0; y < 5; y++) {
    const bits = TEAM_ICONS[team * 5 + y]!;
    const o = LAYER1 + (v + y) * 64 + u;
    for (let x = 0; x < 5; x++) if (((bits >> (4 - x)) & 1) === 1) T[o + x] = ink;
  }
}

/**
 * O colete por cima da jaqueta (cor `vest`), com o cinto de guarnição na mesma cor (por cima do cinto da calça).
 * `collar` = o texel da gola (o recorte do pescoço).
 *
 * Com time (`team` 0..3), o COLETE DE TIME, grande: placa da frente e das costas na largura toda, linhas 2..18 do anel
 * (com o recorte do pescoço na frente e a alça de arrasto atrás), alças de 3 t nos ombros (frente, topo e costas),
 * faixa lateral nas linhas 10..18, painel 7×7 no peito e nas costas com o ícone do time na tinta legível, 3
 * porta-carregadores na frente e o tecido de fixação (linhas mais escuras) atrás e dos lados: a cor do time passa de 35%
 * da frente. Sem time (`team` −1), o colete do look é uma placa menor (colunas 3..12, linhas 3..15, alças de 2 t,
 * faixa lateral 10..15, 2 porta-carregadores e uma tira de velcro sem ícone): o tecido da jaqueta aparece em volta.
 */
export function paintVest(vest: number, team: number, collar: number): void {
  const V = texel(vest);
  const hi = texel(mixRgb(vest, WHITE, 0.14));
  const edge = texel(detailRgb(vest, 26));
  const pouch = texel(detailRgb(vest, 12));
  const flap = texel(detailRgb(vest, 24));
  const web = texel(detailRgb(vest, 14));
  // A tinta lê contra o painel (o tom escuro do colete), não contra o colete.
  const ink = texel(readableInkRgb(detailRgb(vest, 26)));
  const big = team >= 0;
  const x0 = big ? 0 : 3;
  const w = big ? 16 : 10;
  const top = big ? VEST_TOP : VEST_TOP + 1;
  const bottom = big ? VEST_BOTTOM : VEST_BOTTOM - 3;
  const strap = big ? 3 : 2;
  const strapL = big ? 2 : 3;
  const strapR = big ? 11 : 11;
  const h = bottom - top + 1;
  paintBelt(V, edge);
  for (let side = 0; side < 2; side++) {
    const f = side === 0 ? RING_FRONT : RING_BACK;
    // Placa, alças (das linhas 0 até a placa) e o brilho de cima e a borda de baixo.
    rect(f + x0, 8 + top, w, h, V);
    rect(f + strapL, 8, strap, top, V);
    rect(f + strapR, 8, strap, top, V);
    rect(f + x0, 8 + top, w, 1, hi);
    rect(f + x0, 8 + bottom, w, 1, edge);
  }
  // Alças por cima dos ombros (topo da cruz, de trás para a frente).
  rect(8 + strapL, 0, strap, 8, V);
  rect(8 + strapR, 0, strap, 8, V);
  // Faixa lateral nas duas faces de lado, com as fitas.
  for (let side = 0; side < 2; side++) {
    const s = side === 0 ? RING_PX : RING_NX;
    rect(s, 8 + SIDE_TOP, 8, bottom - SIDE_TOP + 1, V);
    rect(s, 8 + SIDE_TOP, 8, 1, hi);
    rect(s + 1, 8 + SIDE_TOP + 3, 6, 1, web);
    if (big) rect(s + 1, 8 + SIDE_TOP + 6, 6, 1, web);
    rect(s, 8 + bottom, 8, 1, edge);
  }
  if (big) {
    // Frente: recorte do pescoço (a gola aparece), painel 7×7 com o ícone e os 3 porta-carregadores (lapela + corpo).
    rect(RING_FRONT + 6, 8 + top, 4, 2, collar);
    rect(RING_FRONT + 4, 8 + 4, 7, 7, edge);
    paintIcon(team, RING_FRONT + 5, 8 + 5, ink);
    for (let k = 0; k < 3; k++) {
      const x = RING_FRONT + 1 + 5 * k;
      rect(x, 8 + 12, 4, 2, flap);
      rect(x, 8 + 14, 4, 4, pouch);
    }
    // Costas: alça de arrasto, painel com o ícone e as fitas de fixação.
    rect(RING_BACK + 6, 8 + top, 4, 2, edge);
    rect(RING_BACK + 4, 8 + 4, 7, 7, edge);
    paintIcon(team, RING_BACK + 5, 8 + 5, ink);
    for (let r = 12; r <= 16; r += 2) rect(RING_BACK + 1, 8 + r, 14, 1, web);
  } else {
    // Frente: tira de velcro 6×2 e 2 porta-carregadores de 4 t (lapela + corpo), com a placa entre eles.
    rect(RING_FRONT + 5, 8 + 5, 6, 2, edge);
    for (let k = 0; k < 2; k++) {
      const x = RING_FRONT + 3 + 6 * k;
      rect(x, 8 + 10, 4, 2, flap);
      rect(x, 8 + 12, 4, 3, pouch);
    }
    // Costas: alça de arrasto e as fitas de fixação.
    rect(RING_BACK + 6, 8 + top, 4, 2, edge);
    for (let r = 8; r <= 12; r += 2) rect(RING_BACK + 4, 8 + r, 8, 1, web);
  }
}

/**
 * Colunas de 4 t dos membros: manga (48, 12), antebraço (52, 12) e coxa (56, 12), linhas 12..23 com a calha, e a
 * canela (48, 0), linhas 0..11. Cores em RGB; −1 = sem a peça. A manga leva a braçadeira (`armband`) nas linhas
 * 2..6; o antebraço termina no punho da luva (`glove`, linhas 8..9) ou na barra da manga; a canela tem a joelheira
 * (`knee`, linhas 0..3), a calça e a barra presa na bota (linhas 8..11). O zumbi rasga: `sleeveRows`/`forearmRows`/
 * `thighRows` = linhas de roupa antes da pele (12/12/12 = inteiras).
 */
export function paintLimbColumns(
  sleeve: number,
  armband: number,
  glove: number,
  pants: number,
  knee: number,
  skin: number,
  sleeveRows: number,
  forearmRows: number,
  thighRows: number,
): void {
  const T = paintTarget();
  const K = texel(skin);
  const S = texel(sleeve);
  const P = texel(pants);
  const A = armband >= 0 ? texel(armband) : S;
  const Ae = armband >= 0 ? texel(detailRgb(armband, 24)) : S;
  const G = glove >= 0 ? texel(glove) : S;
  const cuff = texel(detailRgb(sleeve, 18));
  for (let r = 0; r < 12; r++) {
    const o = LAYER1 + (12 + r) * 64;
    let sl = S;
    if (r >= ARMBAND_FIRST && r <= ARMBAND_LAST) sl = r === ARMBAND_FIRST || r === ARMBAND_LAST ? Ae : A;
    let fa = S;
    if (glove >= 0 && r >= CUFF_FIRST) fa = G;
    else if (glove < 0 && r >= CUFF_FIRST + 1) fa = cuff;
    else if (glove >= 0 && r === CUFF_FIRST - 1) fa = cuff;
    T.fill(r < sleeveRows ? sl : K, o + 48, o + 52);
    T.fill(r < forearmRows ? fa : K, o + 52, o + 56);
    T.fill(r < thighRows ? P : K, o + 56, o + 60);
  }
  const Kn = knee >= 0 ? texel(knee) : P;
  const KnE = knee >= 0 ? texel(detailRgb(knee, 24)) : P;
  const hem = texel(detailRgb(pants, 24));
  for (let r = 0; r < 12; r++) {
    const o = LAYER1 + r * 64;
    let c = P;
    if (r < KNEE_ROWS) c = r === KNEE_ROWS - 1 ? KnE : Kn;
    else if (r >= HEM_FIRST) c = hem;
    T.fill(c, o + 48, o + 52);
  }
}

/**
 * Bota de combate: a célula (52, 0, 12, 12) na cor dela e a mini-cruz (w 1, h 5, d 4) com canto (53, 1). Nas faces de
 * lado, frente e calcanhar: a boca do cano (linha 5, um tom mais claro), o couro e a sola (linha 9, mais escura); na
 * frente, o cadarço na linha 6. No topo (v cresce para a frente), o cadarço na linha 3 e o bico na 4; a base é sola.
 */
export function paintBootCell(boots: number): void {
  const T = paintTarget();
  const B = texel(boots);
  const sole = texel(mixRgb(boots, BLACK, 0.5));
  const dark = luminanceRgb(boots) < 0.35;
  const lace = texel(dark ? shadeRgb(boots, 40) : shadeRgb(boots, -40));
  const top = texel(dark ? shadeRgb(boots, 16) : shadeRgb(boots, -16));
  rect(52, 0, 12, 12, B);
  // Boca do cano (linha 5) nas 4 faces de lado (+X 53..56, frente 57, −X 58..61, calcanhar 62) e a sola (linha 9).
  rect(53, 5, 10, 1, top);
  rect(53, 9, 10, 1, sole);
  // Cadarço: frente (57, 6) e topo (57, 3).
  T[LAYER1 + 6 * 64 + 57] = lace;
  T[LAYER1 + 3 * 64 + 57] = lace;
  // Base (58, 1..4) toda em sola.
  rect(58, 1, 1, 4, sole);
}
// fim-quente

/**
 * Os tons do tecido `fabric` a partir do tom principal `jacket`, em RGB (o principal primeiro). Para o editor "Meu Bobo"
 * do M2 mostrar o tecido e para os testes; aloca (nunca na pintura).
 */
export function figureFabricTones(fabric: number, jacket: number): number[] {
  ensureOutfitMasks();
  const n = fabricTones(fabric, jacket, 0, 0);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(texelRgb(tones![i]!));
  return out;
}
