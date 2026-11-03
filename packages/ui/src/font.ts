import { pushGlyph, type DrawList } from './draw-list.ts';
import type { FontRole } from './tokens.ts';

/**
 * Fontes MSDF da UI (tecnico.md §9). O `tools/fontbake` gera um pacote: uma tira PNG vertical com uma camada por fonte
 * (vira um `TEXTURE_2D_ARRAY` no render) + um JSON de métricas neste formato. O `game` carrega os dois por
 * `platform.assets`, passa o JSON por `parseFontPack` e entrega as fontes ao layout e a imagem ao render.
 *
 * Unidades do JSON: px do atlas, no tamanho em que a fonte foi gerada (`size`). Texto é desenhado a partir do TOPO DAS
 * MAIÚSCULAS (cap height): é o que deixa títulos e rótulos alinhados opticamente em caixas e colunas.
 */
export const FONT_PACK_FORMAT = 'boboforces/ui-fonts@1';

/** Floats por glifo em `FontFile.glyphs`: code, x, y, w, h, xoffset, yoffset, xadvance. */
export const FONT_GLYPH_STRIDE = 8;
/** Números por par em `FontFile.kerning`: first, second, amount. */
export const FONT_KERNING_STRIDE = 3;

export interface FontFile {
  /** Camada da fonte no atlas (= `DrawList.textures` dos glifos). */
  readonly layer: number;
  readonly name: string;
  readonly version: string;
  /** Tamanho (em) em px do atlas. */
  readonly size: number;
  /** Faixa de distância do MSDF em px do atlas. */
  readonly distanceRange: number;
  readonly lineHeight: number;
  /** Linha de base a partir do topo da linha. */
  readonly base: number;
  readonly capHeight: number;
  readonly xHeight: number;
  /** Planos: `FONT_GLYPH_STRIDE` números por glifo. */
  readonly glyphs: readonly number[];
  /** Planos: `FONT_KERNING_STRIDE` números por par. */
  readonly kerning: readonly number[];
  /** Códigos pedidos que a fonte não tem (caem no `?`). */
  readonly missing: readonly number[];
}

export interface FontPackFile {
  readonly format: typeof FONT_PACK_FORMAT;
  readonly atlas: { readonly width: number; readonly height: number; readonly layers: number; readonly image: string };
  readonly fonts: Readonly<Record<FontRole, FontFile>>;
}

/** Fonte pronta para medir e desenhar. Consultas sem alocação. */
export interface MsdfFont {
  readonly name: string;
  readonly layer: number;
  readonly size: number;
  readonly distanceRange: number;
  readonly lineHeight: number;
  readonly base: number;
  readonly capHeight: number;
  readonly xHeight: number;
  readonly atlasWidth: number;
  readonly atlasHeight: number;
  /** `FONT_GLYPH_STRIDE` floats por glifo (mesma ordem do JSON). */
  readonly glyphData: Float32Array;
  /** Índice do glifo (para `glyphData`) ou -1. */
  glyphIndex(code: number): number;
  /** Kerning do par em px do atlas (0 se não houver). */
  kerning(first: number, second: number): number;
}

export type UiFonts = Readonly<Record<FontRole, MsdfFont>>;

export interface FontPack {
  readonly atlas: FontPackFile['atlas'];
  readonly fonts: UiFonts;
}

/** Códigos abaixo disso têm busca direta por tabela (Latin-1 + Latin Extended-A). */
const DIRECT_LIMIT = 0x180;
const FALLBACK_CODE = 0x3f; // '?'

function fail(message: string): never {
  throw new Error(`fonte: ${message}`);
}

function num(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${what} inválido`);
  return value;
}

function numArray(value: unknown, stride: number, what: string): readonly number[] {
  if (!Array.isArray(value) || value.length % stride !== 0) fail(`${what} inválido`);
  for (const v of value) if (typeof v !== 'number' || !Number.isFinite(v)) fail(`${what} com valor não numérico`);
  return value as number[];
}

export function createMsdfFont(file: FontFile, atlasWidth: number, atlasHeight: number): MsdfFont {
  const count = file.glyphs.length / FONT_GLYPH_STRIDE;
  const glyphData = Float32Array.from(file.glyphs);
  const direct = new Int16Array(DIRECT_LIMIT).fill(-1);
  const extra = new Map<number, number>();
  for (let i = 0; i < count; i++) {
    const code = glyphData[i * FONT_GLYPH_STRIDE] as number;
    if (code < DIRECT_LIMIT) direct[code] = i;
    else extra.set(code, i);
  }
  const kerningPairs = new Map<number, number>();
  for (let k = 0; k < file.kerning.length; k += FONT_KERNING_STRIDE) {
    const first = file.kerning[k] as number;
    const second = file.kerning[k + 1] as number;
    kerningPairs.set(first * 0x10000 + second, file.kerning[k + 2] as number);
  }
  return {
    name: file.name,
    layer: file.layer,
    size: file.size,
    distanceRange: file.distanceRange,
    lineHeight: file.lineHeight,
    base: file.base,
    capHeight: file.capHeight,
    xHeight: file.xHeight,
    atlasWidth,
    atlasHeight,
    glyphData,
    glyphIndex(code: number): number {
      if (code < DIRECT_LIMIT) return code >= 0 ? (direct[code] as number) : -1;
      return extra.get(code) ?? -1;
    },
    kerning(first: number, second: number): number {
      if (kerningPairs.size === 0) return 0;
      return kerningPairs.get(first * 0x10000 + second) ?? 0;
    },
  };
}

function parseFontFile(value: unknown, role: string): FontFile {
  if (typeof value !== 'object' || value === null) fail(`fonte ${role} ausente`);
  const f = value as Record<string, unknown>;
  const file: FontFile = {
    layer: num(f['layer'], `${role}.layer`),
    name: typeof f['name'] === 'string' ? f['name'] : role,
    version: typeof f['version'] === 'string' ? f['version'] : '',
    size: num(f['size'], `${role}.size`),
    distanceRange: num(f['distanceRange'], `${role}.distanceRange`),
    lineHeight: num(f['lineHeight'], `${role}.lineHeight`),
    base: num(f['base'], `${role}.base`),
    capHeight: num(f['capHeight'], `${role}.capHeight`),
    xHeight: num(f['xHeight'], `${role}.xHeight`),
    glyphs: numArray(f['glyphs'], FONT_GLYPH_STRIDE, `${role}.glyphs`),
    kerning: numArray(f['kerning'] ?? [], FONT_KERNING_STRIDE, `${role}.kerning`),
    missing: numArray(f['missing'] ?? [], 1, `${role}.missing`),
  };
  if (file.size <= 0 || file.distanceRange <= 0) fail(`${role}: tamanho ou faixa não positivos`);
  return file;
}

/** Valida o JSON do `fontbake` e monta as fontes. Lança erro com mensagem pt-BR se o pacote estiver quebrado. */
export function parseFontPack(json: unknown): FontPack {
  if (typeof json !== 'object' || json === null) fail('pacote vazio');
  const root = json as Record<string, unknown>;
  if (root['format'] !== FONT_PACK_FORMAT) fail(`formato ${String(root['format'])} (esperado ${FONT_PACK_FORMAT})`);
  const atlasRaw = root['atlas'] as Record<string, unknown> | undefined;
  if (!atlasRaw) fail('atlas ausente');
  const atlas = {
    width: num(atlasRaw['width'], 'atlas.width'),
    height: num(atlasRaw['height'], 'atlas.height'),
    layers: num(atlasRaw['layers'], 'atlas.layers'),
    image: typeof atlasRaw['image'] === 'string' ? atlasRaw['image'] : '',
  };
  const fontsRaw = root['fonts'] as Record<string, unknown> | undefined;
  if (!fontsRaw) fail('fontes ausentes');
  const display = parseFontFile(fontsRaw['display'], 'display');
  const hud = parseFontFile(fontsRaw['hud'], 'hud');
  for (const f of [display, hud]) {
    if (f.layer < 0 || f.layer >= atlas.layers) fail(`camada ${f.layer} fora do atlas`);
  }
  return {
    atlas,
    fonts: {
      display: createMsdfFont(display, atlas.width, atlas.height),
      hud: createMsdfFont(hud, atlas.width, atlas.height),
    },
  };
}

/**
 * Imagem do atlas da UI pronta para o render (sem GL): camadas RGBA8 do mesmo tamanho, fontes primeiro (camada =
 * `FontFile.layer`), páginas de sprites depois. O render sobe como `TEXTURE_2D_ARRAY`.
 */
export interface UiAtlasImage {
  readonly width: number;
  readonly height: number;
  readonly layers: number;
  /** RGBA8, camada após camada (= a tira PNG vertical do fontbake, decodificada). */
  readonly pixels: Uint8Array;
  /** Faixa de distância MSDF (px do atlas) por camada de fonte; 0 nas camadas de sprite. */
  readonly msdfRanges: readonly number[];
  /** Camada da página 0 de sprites (`DrawList.textures` do sprite + isto). */
  readonly spriteBase: number;
}

/** Junta o pacote de fontes e os pixels decodificados da tira PNG (`format.decodePng`) no atlas da UI. */
export function createUiAtlas(pack: FontPack, pixels: Uint8Array): UiAtlasImage {
  const { width, height, layers } = pack.atlas;
  if (pixels.length !== width * height * layers * 4) {
    fail(
      `atlas com ${pixels.length} bytes, esperado ${width * height * layers * 4} (RGBA ${width}×${height}×${layers})`,
    );
  }
  const msdfRanges = new Array<number>(layers).fill(0);
  msdfRanges[pack.fonts.display.layer] = pack.fonts.display.distanceRange;
  msdfRanges[pack.fonts.hud.layer] = pack.fonts.hud.distanceRange;
  return { width, height, layers, pixels, msdfRanges, spriteBase: layers };
}

function resolveGlyph(font: MsdfFont, code: number): number {
  const index = font.glyphIndex(code);
  return index >= 0 ? index : font.glyphIndex(FALLBACK_CODE);
}

// O atlas latino não inclui ™: compor o símbolo com T e M menores, em sobrescrito.
const TRADEMARK_CODE = 0x2122;
const TRADEMARK_SCALE = 0.48;
const TRADEMARK_LETTERS = [0x54, 0x4d] as const;

function trademarkAdvance(font: MsdfFont): number {
  let advance = 0;
  for (const code of TRADEMARK_LETTERS) {
    const index = resolveGlyph(font, code);
    advance += index >= 0 ? (font.glyphData[index * FONT_GLYPH_STRIDE + 7] as number) : font.size * 0.5;
  }
  return advance * TRADEMARK_SCALE;
}

/** Largura do texto em px para fonte de `px` (em) e `tracking` em em. */
export function measureText(font: MsdfFont, text: string, px: number, tracking = 0): number {
  const scale = px / font.size;
  let width = 0;
  let prev = -1;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const index = resolveGlyph(font, code);
    const advance = code === TRADEMARK_CODE && font.glyphIndex(code) < 0
      ? trademarkAdvance(font)
      : index >= 0 ? (font.glyphData[index * FONT_GLYPH_STRIDE + 7] as number) : font.size * 0.5;
    if (prev >= 0) width += font.kerning(prev, code) * scale + tracking * px;
    width += advance * scale;
    prev = code;
  }
  return width;
}

/** Altura da caixa de texto: do topo das maiúsculas ao fim dos descendentes. */
export function textBoxHeight(font: MsdfFont, px: number): number {
  return ((font.capHeight + font.lineHeight - font.base) * px) / font.size;
}

/**
 * Empilha os glifos na DrawList. `capTop` é o topo das maiúsculas; a linha de base fica em `capTop + capHeight`.
 * A origem é arredondada para o pixel (texto mais nítido). Devolve a largura desenhada. Sem alocação.
 */
export function drawText(
  out: DrawList,
  font: MsdfFont,
  text: string,
  x: number,
  capTop: number,
  px: number,
  color: number,
  tracking = 0,
): number {
  const scale = px / font.size;
  const lineTop = Math.round(capTop - (font.base - font.capHeight) * scale);
  const startX = Math.round(x);
  const data = font.glyphData;
  const invW = 1 / font.atlasWidth;
  const invH = 1 / font.atlasHeight;
  let pen = startX;
  let prev = -1;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const index = resolveGlyph(font, code);
    if (prev >= 0) pen += font.kerning(prev, code) * scale + tracking * px;
    prev = code;
    if (code === TRADEMARK_CODE && font.glyphIndex(code) < 0) {
      const miniScale = scale * TRADEMARK_SCALE;
      const miniLineTop = Math.round(capTop - (font.base - font.capHeight) * miniScale - px * 0.18);
      for (const letter of TRADEMARK_LETTERS) {
        const miniIndex = resolveGlyph(font, letter);
        if (miniIndex < 0) { pen += font.size * 0.5 * miniScale; continue; }
        const mg = miniIndex * FONT_GLYPH_STRIDE;
        const mw = data[mg + 3] as number;
        const mh = data[mg + 4] as number;
        if (mw > 0 && mh > 0) {
          const mx = data[mg + 1] as number;
          const my = data[mg + 2] as number;
          pushGlyph(out, pen + (data[mg + 5] as number) * miniScale,
            miniLineTop + (data[mg + 6] as number) * miniScale,
            mw * miniScale, mh * miniScale,
            mx * invW, my * invH, (mx + mw) * invW, (my + mh) * invH,
            color, font.layer);
        }
        pen += (data[mg + 7] as number) * miniScale;
      }
      continue;
    }
    if (index < 0) {
      pen += font.size * 0.5 * scale;
      continue;
    }
    const g = index * FONT_GLYPH_STRIDE;
    const gw = data[g + 3] as number;
    const gh = data[g + 4] as number;
    if (gw > 0 && gh > 0) {
      const gx = data[g + 1] as number;
      const gy = data[g + 2] as number;
      pushGlyph(
        out,
        pen + (data[g + 5] as number) * scale,
        lineTop + (data[g + 6] as number) * scale,
        gw * scale,
        gh * scale,
        gx * invW,
        gy * invH,
        (gx + gw) * invW,
        (gy + gh) * invH,
        color,
        font.layer,
      );
    }
    pen += (data[g + 7] as number) * scale;
  }
  return pen - startX;
}
