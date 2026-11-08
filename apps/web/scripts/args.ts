// Argumentos e carimbos de data dos scripts de navegador da web (sem dependências, para os testes não carregarem o
// Vite nem o playwright-core).

/**
 * Argumentos `--chave valor` e `--bandeira` (sem valor quando o próximo começa com `--` ou acabou). Chaves repetidas:
 * vale a última.
 */
export function parseArgs(argv: readonly string[]): Map<string, string | true> {
  const out = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith('--') || arg.length === 2) continue;
    const eq = arg.indexOf('=');
    if (eq > 2) {
      out.set(arg.slice(2, eq), arg.slice(eq + 1));
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out.set(arg.slice(2), next);
      i++;
    } else out.set(arg.slice(2), true);
  }
  return out;
}

/** `AAAA-MM-DD-HHMM` na hora local (nome de pasta e de arquivo legível). */
export function stamp(when: Date): string {
  const two = (n: number): string => String(n).padStart(2, '0');
  return (
    `${when.getFullYear()}-${two(when.getMonth() + 1)}-${two(when.getDate())}` +
    `-${two(when.getHours())}${two(when.getMinutes())}`
  );
}
