// Orçamentos de download da web (tecnico.md §16.4), em bytes TRANSFERIDOS: texto (HTML, JS, CSS, JSON, SVG) medido em
// gzip nível 9, que é o que o GitHub Pages serve (o Brotli de outros hosts só melhora); binários (PNG, MP3, formatos
// próprios já em deflate) medidos crus. 1 KB = 1000 bytes, como no relatório do Vite.

export const KB = 1000;
export const MB = 1000 * KB;

export type BudgetId = 'html' | 'initial' | 'total' | 'largest';

export interface Budget {
  readonly id: BudgetId;
  readonly label: string;
  readonly limit: number;
  /** De onde vem o número. */
  readonly source: string;
}

export const BUDGETS: readonly Budget[] = [
  { id: 'html', label: 'HTML + splash inline', limit: 15 * KB, source: 'tecnico.md §16.4 (primeiro pixel < 0,5 s)' },
  {
    id: 'initial',
    label: 'Carga inicial (HTML + JS/CSS até o menu)',
    limit: 350 * KB,
    source: 'tecnico.md §16.4 (menu interativo: core + three + atlas MSDF + texturas de UI)',
  },
  { id: 'total', label: 'Build inteiro', limit: 15 * MB, source: 'tecnico.md §16.4 (jogo completo)' },
  {
    id: 'largest',
    label: 'Maior arquivo',
    limit: 1 * MB,
    // Nenhum arquivo sozinho pode estourar a primeira partida (1 MB acumulado). Música (.mp3) é sob demanda e fica
    // de fora desta conta; ela continua contando no total.
    source: 'tecnico.md §16.4 (primeira partida ≤ 1 MB acumulado)',
  },
];

/** Extensões que ficam de fora do "maior arquivo" (baixadas sob demanda, em segundo plano). */
export const LARGEST_EXCLUDED_EXTENSIONS: readonly string[] = ['.mp3'];
