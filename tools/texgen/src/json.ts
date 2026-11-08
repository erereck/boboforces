/**
 * JSON no formato que o Prettier do repositório deixa (printWidth 120): objeto sempre aberto, uma chave por linha;
 * array de valores simples numa linha só quando cabe, senão um item por linha; array com objeto, sempre aberto. Assim
 * os `.json` gerados passam no `format:check` sem rodar o Prettier no gerador.
 */
export const JSON_PRINT_WIDTH = 120;

type Json = string | number | boolean | null | readonly Json[] | { readonly [key: string]: Json | undefined };

function isPrimitive(v: Json): v is string | number | boolean | null {
  return v === null || typeof v !== 'object';
}

function printValue(value: Json, indent: string, prefixLength: number, suffix: string): string {
  if (isPrimitive(value)) return JSON.stringify(value);
  const inner = indent + '  ';
  if (Array.isArray(value)) {
    const items = value as readonly Json[];
    if (items.length === 0) return '[]';
    if (items.every(isPrimitive)) {
      const flat = '[' + items.map((v) => JSON.stringify(v)).join(', ') + ']';
      if (prefixLength + flat.length + suffix.length <= JSON_PRINT_WIDTH) return flat;
    }
    const lines = items.map((v, i) => {
      const comma = i < items.length - 1 ? ',' : '';
      return inner + printValue(v, inner, inner.length, comma) + comma;
    });
    return '[\n' + lines.join('\n') + '\n' + indent + ']';
  }
  const entries = Object.entries(value as { readonly [key: string]: Json | undefined }).filter(
    (e): e is [string, Json] => e[1] !== undefined,
  );
  if (entries.length === 0) return '{}';
  const lines = entries.map(([k, v], i) => {
    const comma = i < entries.length - 1 ? ',' : '';
    const key = JSON.stringify(k) + ': ';
    return inner + key + printValue(v, inner, inner.length + key.length, comma) + comma;
  });
  return '{\n' + lines.join('\n') + '\n' + indent + '}';
}

/** Texto JSON com quebra de linha no fim. */
export function formatJson(value: unknown): string {
  return printValue(value as Json, '', 0, '') + '\n';
}
