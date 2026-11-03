/**
 * Conjunto de glifos da UI (tecnico.md §9): Latin-1 + Latin Extended-A, que cobre o pt-BR com folga, mais a
 * pontuação tipográfica que a tabela de textos usa (reticências, travessões, aspas curvas, marcador, euro).
 */

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let c = from; c <= to; c++) out.push(c);
  return out;
}

/** Pontuação geral usada nos textos (U+2013 – U+2026) e o euro. */
const EXTRA = [0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2026, 0x20ac];

/** Códigos pedidos ao gerador, em ordem. ASCII imprimível, Latin-1 (sem controles), Latin Extended-A e extras. */
export const UI_CODEPOINTS: readonly number[] = [
  ...range(0x20, 0x7e),
  ...range(0xa0, 0xff),
  ...range(0x100, 0x17f),
  ...EXTRA,
];

export function codepointsToString(codes: readonly number[]): string {
  return String.fromCharCode(...codes);
}

/** Letra minúscula que tem maiúscula própria (a, ã, ß, ÿ, ž…): a forma em caixa alta é outro glifo. */
export function isLowercaseLetter(code: number): boolean {
  const ch = String.fromCharCode(code);
  return ch.toUpperCase() !== ch;
}

/**
 * Glifos por papel. A `display` só desenha caixa alta (todos os estilos dela em `TYPE` têm `uppercase`, e os números
 * não têm caixa): sem as minúsculas, o atlas encolhe e a carga inicial cabe no orçamento (tecnico.md §16.4). A `hud`
 * leva tudo, porque é a fonte de leitura.
 */
export function codepointsForRole(role: 'display' | 'hud'): readonly number[] {
  return role === 'display' ? UI_CODEPOINTS.filter((c) => !isLowercaseLetter(c)) : UI_CODEPOINTS;
}
