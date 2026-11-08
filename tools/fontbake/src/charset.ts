/**
 * Conjuntos de glifos da UI por papel (decisão #54; tecnico.md §9, decisão menor revisável). O pt-BR inteiro cabe no
 * Latin-1: o Latin Extended-A saiu (a Barlow provisória já não o tinha, e com ele o atlas passava do teto de 120 KB).
 */

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let c = from; c <= to; c++) out.push(c);
  return out;
}

/** Pontuação geral usada nos textos (– — ‘ ’ “ ” • …) e o euro. */
export const EXTRA_CODEPOINTS: readonly number[] = [
  0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2026, 0x20ac,
];

/** HUD (leitura, rótulos, números): ASCII imprimível + Latin-1 sem controles + `EXTRA_CODEPOINTS` (200 códigos). */
export const HUD_CODEPOINTS: readonly number[] = [...range(0x20, 0x7e), ...range(0xa0, 0xff), ...EXTRA_CODEPOINTS];

/** Letra minúscula que tem maiúscula própria (a, ã, ß, ÿ…): a forma em caixa alta é outro glifo. */
export function isLowercaseLetter(code: number): boolean {
  const ch = String.fromCharCode(code);
  return ch.toUpperCase() !== ch;
}

/** Pontuação de Latin-1 que a display desenha (¡ ª « ° · º » ¿ e o espaço sem quebra); os outros símbolos ficam no HUD. */
const DISPLAY_LATIN1_PUNCTUATION = [0xa0, 0xa1, 0xaa, 0xab, 0xb0, 0xb7, 0xba, 0xbb, 0xbf];

/**
 * Display (títulos e botões): só caixa alta, porque todos os estilos dela em `TYPE` têm `uppercase` e os usos fora do
 * layout também sobem a caixa. ASCII sem minúsculas, À–Þ, a pontuação acima e `EXTRA_CODEPOINTS` (118 códigos).
 * Símbolos como © ® ± ² ¼ ficam só no HUD: texto digitado pelo jogador vai na fonte hud.
 */
export const DISPLAY_CODEPOINTS: readonly number[] = [
  ...range(0x20, 0x7e),
  ...DISPLAY_LATIN1_PUNCTUATION,
  ...range(0xc0, 0xde),
  ...EXTRA_CODEPOINTS,
].filter((c) => !isLowercaseLetter(c));

export function codepointsToString(codes: readonly number[]): string {
  return String.fromCharCode(...codes);
}

/** Glifos pedidos ao gerador para o papel, em ordem. */
export function codepointsForRole(role: 'display' | 'hud'): readonly number[] {
  return role === 'display' ? DISPLAY_CODEPOINTS : HUD_CODEPOINTS;
}
