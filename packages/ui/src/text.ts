import { STRINGS_PT_BR, type StringKey } from './strings.pt-BR.ts';

/**
 * Texto e números sem `Intl`/`toLocaleString` (regra 13: o nx.js não garante ICU, e o resultado varia por aparelho).
 * Formato pt-BR: milhar com ponto, decimal com vírgula.
 */

export type TextParams = Readonly<Record<string, string | number>>;

/** Inteiro com separador de milhar: 1234567 → "1.234.567". */
export function formatInt(n: number): string {
  const v = Math.trunc(n);
  const digits = String(Math.abs(v));
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += '.';
    out += digits[i];
  }
  return v < 0 ? `-${out}` : out;
}

/** Decimal com vírgula e casas fixas: (1.5, 1) → "1,5". */
export function formatDecimal(n: number, places: number): string {
  const factor = 10 ** places;
  const rounded = Math.round(Math.abs(n) * factor);
  const intPart = Math.floor(rounded / factor);
  const sign = n < 0 && rounded !== 0 ? '-' : '';
  if (places <= 0) return sign + formatInt(intPart);
  const frac = String(rounded % factor).padStart(places, '0');
  return `${sign}${formatInt(intPart)},${frac}`;
}

/** Número com 2 dígitos ("07"), para relógios. */
export function pad2(n: number): string {
  return String(Math.trunc(n)).padStart(2, '0');
}

/** Busca a chave na tabela e troca `{param}`; números passam por `formatInt`/`formatDecimal`. */
export function t(key: StringKey, params?: TextParams): string {
  const template: string = STRINGS_PT_BR[key];
  if (!params) return template;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name: string) => {
    const value = params[name];
    if (value === undefined) return match;
    if (typeof value === 'number') return Number.isInteger(value) ? formatInt(value) : formatDecimal(value, 1);
    return value;
  });
}
