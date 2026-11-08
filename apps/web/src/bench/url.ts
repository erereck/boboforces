// Bench pela URL da web (tecnico.md §24.1; PLANO_M1 "apps/web"). Os nomes canônicos são os de `BENCH_PARAMS` do game
// (`?bench&views=4&bots=12&view=50&duration=600`, o mesmo dicionário que o Switch monta no menu); a casca aceita também
// apelidos em pt-BR (`?bench&vistas=4&visao=50&hora=noite&dur=60`) e traduz antes de chamar `parseBenchParams`, que
// valida, limita e devolve os avisos. Sem a chave `bench`, a página abre o título normal.
import { BENCH_PARAMS, parseBenchParams, type ParsedBench } from '@boboforces/game';

/** Apelido pt-BR (minúsculo, sem acento) → nome canônico de `BENCH_PARAMS`. */
export const BENCH_PARAM_ALIASES: Readonly<Record<string, string>> = {
  cena: BENCH_PARAMS.scene,
  vistas: BENCH_PARAMS.views,
  zumbis: BENCH_PARAMS.zombies,
  armados: BENCH_PARAMS.armed,
  visao: BENCH_PARAMS.viewDistanceM,
  hora: BENCH_PARAMS.timeOfDay,
  dur: BENCH_PARAMS.durationS,
  duracao: BENCH_PARAMS.durationS,
  aquecimento: BENCH_PARAMS.warmupS,
  rota: BENCH_PARAMS.route,
  semente: BENCH_PARAMS.seed,
  perfil: BENCH_PARAMS.profile,
  atores: BENCH_PARAMS.actors,
  arma: BENCH_PARAMS.viewmodel,
};

/** Hora do dia em pt-BR → valor de `TimeOfDay`. */
export const TIME_OF_DAY_ALIASES: Readonly<Record<string, string>> = {
  dia: 'day',
  entardecer: 'dusk',
  tarde: 'dusk',
  noite: 'night',
};

/** Minúsculo e sem acento (`Visão` → `visao`), para o apelido digitado à mão no celular. */
function fold(text: string): string {
  // Marcas combinantes (U+0300..U+036F) saem depois do NFD: 'ã' vira 'a' + til, e o til cai.
  let out = '';
  for (const ch of text.trim().toLowerCase().normalize('NFD')) {
    const code = ch.charCodeAt(0);
    if (code < 0x300 || code > 0x36f) out += ch;
  }
  return out;
}

export interface BenchUrlParams {
  /** Dicionário com os nomes canônicos, pronto para `parseBenchParams`. */
  readonly params: Readonly<Record<string, string>>;
  /** Avisos da tradução (chave repetida). */
  readonly warnings: readonly string[];
}

/**
 * Traduz a query (`location.search`, com ou sem `?`) para o dicionário canônico. `null` quando não há `bench`. Chave
 * repetida (inclusive apelido + canônico) vale a primeira e vira aviso.
 */
export function benchParamsFromSearch(search: string): BenchUrlParams | null {
  const query = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  let hasBench = false;
  for (const key of query.keys()) if (fold(key) === 'bench') hasBench = true;
  if (!hasBench) return null;
  const params: Record<string, string> = {};
  const warnings: string[] = [];
  for (const [rawKey, rawValue] of query) {
    const key = fold(rawKey);
    if (key === '') continue;
    const name = BENCH_PARAM_ALIASES[key] ?? key;
    let value = rawValue.trim();
    if (name === BENCH_PARAMS.timeOfDay) value = TIME_OF_DAY_ALIASES[fold(value)] ?? value;
    if (Object.hasOwn(params, name)) {
      warnings.push(`parâmetro repetido: ${rawKey} (vale o primeiro)`);
      continue;
    }
    params[name] = value;
  }
  return { params, warnings };
}

/** Lê o bench da URL: `null` sem `?bench`; senão a configuração e os avisos (tradução + validação do game). */
export function readBenchFromUrl(search: string): ParsedBench | null {
  const read = benchParamsFromSearch(search);
  if (!read) return null;
  const parsed = parseBenchParams(read.params);
  return { config: parsed.config, warnings: [...read.warnings, ...parsed.warnings] };
}
