import { FONT_PACK_FORMAT, type FontFile, type FontPackFile, type FontRole } from '@boboforces/ui';

/**
 * Converte a saída JSON do msdf-bmfont-xml (BMFont/Hiero) no pacote compacto que a UI lê (`boboforces/ui-fonts@1`,
 * `packages/ui/src/font.ts`): números planos em vez de objetos (o JSON fica ~4x menor), kerning sem pares
 * irrelevantes, altura de maiúscula e altura-x exatas (OS/2) e a altura da linha pela descida real dos glifos.
 */

export { FONT_PACK_FORMAT };

/**
 * Kerning abaixo disso (px do atlas) é descartado: não muda nada na tela. Era 0,2; em 0,25 saem 237 pares do HUD
 * (entre 0,2 e 0,25 px, 1/80 de em) e o JSON cai ~0,8 KB em gzip, a folga que faltava no teto de 120 KB (o PNG não
 * muda).
 */
export const MIN_KERNING = 0.25;

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
  /** Nome do derivado (sem o Reserved Font Name). */
  readonly name: string;
  /** Versão da fonte de origem (name ID 5). */
  readonly version: string;
  /** Códigos pedidos que a fonte não tem. */
  readonly missing: readonly number[];
  /**
   * Altura de maiúscula e altura-x em em, do OS/2 da fonte. Sem elas (OS/2 antigo), mede o `H` e o `x` do atlas, que
   * o gerador arredonda para px inteiros.
   */
  readonly capHeightEm?: number | null;
  readonly xHeightEm?: number | null;
  /** `OFL-1.1` e a origem curta (família e versão) para `FontFile.license`/`source`. */
  readonly license?: string;
  readonly source?: string;
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** Margem do campo em volta de cada glifo no atlas (o gerador usa metade da faixa). */
function glyphPad(bm: BmFontJson): number {
  return bm.distanceField.distanceRange >> 1;
}

/** Altura do topo do glifo `code` até a linha de base, em px do atlas (`null` se o glifo não existir). */
function heightAboveBase(bm: BmFontJson, code: number): number | null {
  const c = bm.chars.find((ch) => ch.id === code);
  if (!c || c.height === 0) return null;
  return bm.common.base - (c.yoffset + glyphPad(bm));
}

/**
 * Quanto o glifo mais fundo desce abaixo da linha de base, em px do atlas (≥ 0), medido nos glifos ENTREGUES. O
 * `lineHeight` do gerador vem do hhea/OS/2 (a Saira declara 0,439 em de descida para a família inteira; os glifos
 * Latin-1 descem 0,20 em): com ele, toda caixa de texto no estilo hud ficaria ~25% mais alta.
 */
export function measuredDescent(bm: BmFontJson): number {
  const pad = glyphPad(bm);
  let deepest = 0;
  for (const c of bm.chars) {
    if (c.width === 0 || c.height === 0) continue;
    deepest = Math.max(deepest, c.yoffset + c.height - pad - bm.common.base);
  }
  return deepest;
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
  const base = bm.common.base;
  const capHeight = meta.capHeightEm != null ? meta.capHeightEm * size : (heightAboveBase(bm, 0x48) ?? size * 0.7);
  const xHeight = meta.xHeightEm != null ? meta.xHeightEm * size : (heightAboveBase(bm, 0x78) ?? size * 0.5);
  return {
    layer: meta.layer,
    name: meta.name,
    version: meta.version,
    ...(meta.license !== undefined ? { license: meta.license } : {}),
    ...(meta.source !== undefined ? { source: meta.source } : {}),
    size,
    distanceRange: bm.distanceField.distanceRange,
    lineHeight: round3(base + measuredDescent(bm)),
    base: round3(base),
    capHeight: round3(capHeight),
    xHeight: round3(xHeight),
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
