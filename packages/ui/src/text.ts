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

/** Maior quantidade de caracteres que `numberToCodes` escreve (sinal, 16 dígitos, 5 pontos, vírgula e 3 casas). */
export const NUMBER_CODES_MAX = 28;
const DIGITS_SCRATCH = new Uint16Array(NUMBER_CODES_MAX);
const CODE_ZERO = 0x30;
const CODE_DOT = 0x2e;
const CODE_COMMA = 0x2c;
const CODE_MINUS = 0x2d;
/** Travessão: número desconhecido (NaN, infinito). */
export const CODE_UNKNOWN = 0x2014;

/**
 * Escreve o número em códigos de caractere no formato de `formatDecimal` (milhar com ponto, decimal com vírgula), SEM
 * criar string: o HUD e o F2 desenham números que mudam todo frame (regra 11). `minIntDigits` completa com zeros à
 * esquerda (relógio: 2). Valores não finitos viram "—". Casas de 0 a 3; módulo até 1e15. Devolve quantos códigos.
 */
export function numberToCodes(value: number, places: number, out: Uint16Array, minIntDigits = 1): number {
  if (!Number.isFinite(value) || Math.abs(value) >= 1e15) {
    out[0] = CODE_UNKNOWN;
    return 1;
  }
  const decimals = Math.max(0, Math.min(3, Math.trunc(places)));
  const factor = decimals === 0 ? 1 : decimals === 1 ? 10 : decimals === 2 ? 100 : 1000;
  const scaled = Math.round(Math.abs(value) * factor);
  let intPart = Math.floor(scaled / factor);
  let frac = scaled - intPart * factor;
  const s = DIGITS_SCRATCH;
  let p = s.length;
  if (decimals > 0) {
    for (let i = 0; i < decimals; i++) {
      s[--p] = CODE_ZERO + (frac % 10);
      frac = Math.floor(frac / 10);
    }
    s[--p] = CODE_COMMA;
  }
  let digits = 0;
  do {
    if (digits > 0 && digits % 3 === 0) s[--p] = CODE_DOT;
    s[--p] = CODE_ZERO + (intPart % 10);
    intPart = Math.floor(intPart / 10);
    digits++;
  } while (intPart > 0 || digits < minIntDigits);
  if (value < 0 && scaled !== 0) s[--p] = CODE_MINUS;
  const length = s.length - p;
  for (let i = 0; i < length; i++) out[i] = s[p + i] as number;
  return length;
}

/** Copia os códigos de `text` para `out` a partir de `offset` (sem alocar); devolve o novo comprimento. */
export function stringToCodes(text: string, out: Uint16Array, offset = 0): number {
  const n = Math.min(text.length, out.length - offset);
  for (let i = 0; i < n; i++) out[offset + i] = text.charCodeAt(i);
  return offset + n;
}

/**
 * Corta um modelo da tabela nos parâmetros, na ordem dada: `templateParts('hud.ammo', ['clip', 'reserve'])` →
 * `['', ' / ', '']`. Assim o separador continua vindo da tabela e o número é desenhado sem montar string por frame.
 * Chame uma vez (aloca). Parâmetro ausente no modelo é erro de programação (lança).
 */
export function templateParts(key: StringKey, names: readonly string[]): readonly string[] {
  const template: string = STRINGS_PT_BR[key];
  const parts: string[] = [];
  let rest = template;
  for (const name of names) {
    const mark = `{${name}}`;
    const at = rest.indexOf(mark);
    if (at < 0) throw new Error(`texto: ${key} sem {${name}}`);
    parts.push(rest.slice(0, at));
    rest = rest.slice(at + mark.length);
  }
  parts.push(rest);
  return parts;
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
