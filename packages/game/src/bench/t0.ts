/**
 * Linhas de SONDA do Teste Zero no `runtime.log` (tecnico.md §24.2; docs/TESTE_ZERO.md da frente switch-audio). Uma
 * linha por medição, ASCII, fácil de procurar com `[t0]`:
 *
 *   [t0] item=4 nome=texture-array status=ok camadas_max=2048 mips=1 subimage3d=1
 *   [t0] item=17 nome=controllers status=info indice=0 styleSet=0x4 deviceType=-1 completo=1 vibra=1
 *   [t0] item=19 nome=audio status=falha erro="decodeAudioData rejeitou"
 *
 * Campos fixos na ordem: `item` (1..21), `nome` (o slug de `T0_ITEMS`), `status` (`T0_STATUS`); depois os campos da
 * sonda, `chave=valor` (chave ASCII começando por minúscula, com `_` ou camelCase do nx.js; texto com espaço vai
 * entre aspas). Quem grava: a casca do Switch (itens 1–9, os de GL com `fonte=casca`, e 17–21) e o `game` (só os
 * itens 10–16, no fim de cada bench; sem amostra, `pulado`). No Eden e no console as linhas são as mesmas; o
 * `docs/TESTE_ZERO.md` §7 diz o que anotar.
 */
export const T0_ITEMS = [
  { item: 1, slug: 'webgl2' },
  { item: 2, slug: 'drawing-buffer' },
  { item: 3, slug: 'three-shim' },
  { item: 4, slug: 'texture-array' },
  { item: 5, slug: 'int-attributes' },
  { item: 6, slug: 'vertex-texture' },
  { item: 7, slug: 'offscreen-canvas' },
  { item: 8, slug: 'fontface' },
  { item: 9, slug: 'msaa-blit' },
  { item: 10, slug: 'frame-time' },
  { item: 11, slug: 'render-info' },
  { item: 12, slug: 'sim-ai-cost' },
  { item: 13, slug: 'loading' },
  { item: 14, slug: 'gc-memory' },
  { item: 15, slug: 'shader-stalls' },
  { item: 16, slug: 'thermal' },
  { item: 17, slug: 'controllers' },
  { item: 18, slug: 'keyboard' },
  { item: 19, slug: 'audio' },
  { item: 20, slug: 'lifecycle' },
  { item: 21, slug: 'intl-decompression' },
] as const;

export type T0Item = (typeof T0_ITEMS)[number]['item'];

/** `ok` passou; `falha` não passou (vale o plano B da tabela); `info` só medição; `pulado` não deu para medir. */
export const T0_STATUS = ['ok', 'falha', 'info', 'pulado'] as const;
export type T0Status = (typeof T0_STATUS)[number];

export const T0_LOG_PREFIX = '[t0] ';

const KEY_RE = /^[a-z][a-zA-Z0-9_]{0,31}$/;

function value(v: string | number | boolean): string {
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '-';
  if (v === '') return '""';
  return /[\s="]/.test(v) ? `"${v.replace(/"/g, "'").replace(/[\r\n]+/g, ' ')}"` : v;
}

/** Monta uma linha `[t0] …`. Chave fora do padrão é erro de programação (lança). */
export function formatT0Line(
  item: T0Item,
  status: T0Status,
  fields: Readonly<Record<string, string | number | boolean>> = {},
): string {
  const entry = T0_ITEMS[item - 1]!;
  let line = `${T0_LOG_PREFIX}item=${item} nome=${entry.slug} status=${status}`;
  for (const [key, v] of Object.entries(fields)) {
    if (!KEY_RE.test(key)) throw new Error(`t0: chave inválida "${key}"`);
    line += ` ${key}=${value(v)}`;
  }
  return line;
}
