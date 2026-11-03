import type { FontFile, FontPackFile, FontRole } from '@boboforces/ui';

/**
 * Converte a saída JSON do msdf-bmfont-xml (BMFont/Hiero) no pacote compacto que a UI lê (`boboforces/ui-fonts@1`,
 * `packages/ui/src/font.ts`): números planos em vez de objetos (o JSON fica ~4x menor), kerning sem pares
 * irrelevantes e as medidas de topo de maiúscula e altura-x que o layout usa.
 */

export const FONT_PACK_FORMAT = 'boboforces/ui-fonts@1';

/** Kerning abaixo disso (px do atlas) é descartado: não muda nada na tela. */
export const MIN_KERNING = 0.2;

export interface BmChar {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  xoffset: number;
  yoffset: number;
  xadvance: number;
  page: number;
}

export interface BmFontJson {
  pages: string[];
  chars: BmChar[];
  info: { face: string; size: number };
  common: { lineHeight: number; base: number; scaleW: number; scaleH: number; pages: number };
  distanceField: { fieldType: string; distanceRange: number };
  kernings: { first: number; second: number; amount: number }[];
}

export interface FontMeta {
  readonly layer: number;
  readonly name: string;
  readonly version: string;
  /** Códigos pedidos que a fonte não tem. */
  readonly missing: readonly number[];
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Altura do topo do glifo `code` até a linha de base, em px do atlas (`null` se o glifo não existir). */
function heightAboveBase(bm: BmFontJson, code: number): number | null {
  const c = bm.chars.find((ch) => ch.id === code);
  if (!c || c.height === 0) return null;
  const pad = bm.distanceField.distanceRange >> 1;
  return bm.common.base - (c.yoffset + pad);
}

export function toFontFile(bm: BmFontJson, meta: FontMeta): FontFile {
  if (bm.common.pages !== 1) {
    throw new Error(
      `fontbake: ${meta.name} precisou de ${bm.common.pages} páginas; aumente o atlas ou reduza o tamanho`,
    );
  }
  const chars = [...bm.chars].sort((a, b) => a.id - b.id);
  const glyphs: number[] = [];
  for (const c of chars) {
    glyphs.push(c.id, c.x, c.y, c.width, c.height, c.xoffset, c.yoffset, round2(c.xadvance));
  }
  const known = new Set(chars.map((c) => c.id));
  const kerning: number[] = [];
  const pairs = [...bm.kernings].sort((a, b) => a.first - b.first || a.second - b.second);
  for (const k of pairs) {
    if (Math.abs(k.amount) < MIN_KERNING || !known.has(k.first) || !known.has(k.second)) continue;
    kerning.push(k.first, k.second, round2(k.amount));
  }
  const size = bm.info.size;
  return {
    layer: meta.layer,
    name: meta.name,
    version: meta.version,
    size,
    distanceRange: bm.distanceField.distanceRange,
    lineHeight: round2(bm.common.lineHeight),
    base: round2(bm.common.base),
    capHeight: round2(heightAboveBase(bm, 0x48) ?? size * 0.7),
    xHeight: round2(heightAboveBase(bm, 0x78) ?? size * 0.5),
    glyphs,
    kerning,
    missing: [...meta.missing],
  };
}

export function buildFontPack(
  fonts: Readonly<Record<FontRole, FontFile>>,
  atlas: { width: number; height: number; layers: number; image: string },
): FontPackFile {
  return { format: FONT_PACK_FORMAT, atlas, fonts };
}

/**
 * JSON compacto e estável (diff legível no git): uma chave por linha, e os vetores de números quebrados a cada
 * glifo/par em vez de um número por linha.
 */
export function stringifyFontPack(pack: FontPackFile): string {
  const lines: string[] = [
    '{',
    `  "format": ${JSON.stringify(pack.format)},`,
    `  "atlas": ${JSON.stringify(pack.atlas)},`,
  ];
  lines.push('  "fonts": {');
  const roles = Object.keys(pack.fonts) as FontRole[];
  roles.forEach((role, ri) => {
    const f = pack.fonts[role];
    lines.push(`    ${JSON.stringify(role)}: {`);
    const scalar = { ...f, glyphs: undefined, kerning: undefined, missing: undefined };
    for (const [k, v] of Object.entries(scalar))
      if (v !== undefined) lines.push(`      ${JSON.stringify(k)}: ${JSON.stringify(v)},`);
    lines.push(`      "missing": ${JSON.stringify(f.missing)},`);
    const rows = (values: readonly number[], stride: number) => {
      const out: string[] = [];
      for (let i = 0; i < values.length; i += stride) out.push(values.slice(i, i + stride).join(','));
      return out.length ? `[\n        ${out.join(',\n        ')}\n      ]` : '[]';
    };
    lines.push(`      "glyphs": ${rows(f.glyphs, 8)},`);
    lines.push(`      "kerning": ${rows(f.kerning, 3)}`);
    lines.push(`    }${ri < roles.length - 1 ? ',' : ''}`);
  });
  lines.push('  }', '}');
  return lines.join('\n') + '\n';
}
