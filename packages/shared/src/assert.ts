/** Erro de invariante quebrada. Nunca é "tratado": indica bug. */
export class AssertionError extends Error {
  override name = 'AssertionError';
}

/** Garante uma invariante; com `asserts`, o TypeScript estreita o tipo depois da chamada. */
export function assert(condition: unknown, message = 'assert falhou'): asserts condition {
  if (!condition) throw new AssertionError(message);
}

/** Para `switch` exaustivo em uniões discriminadas: não compila se faltar um caso. */
export function assertNever(value: never, message = 'caso inesperado'): never {
  throw new AssertionError(`${message}: ${String(value)}`);
}

export function unreachable(message = 'código inalcançável'): never {
  throw new AssertionError(message);
}
