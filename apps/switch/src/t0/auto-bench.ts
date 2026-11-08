// Bench automático no boot (Teste Zero no Eden sem controle e rodadas repetidas no console): se existir
// `sdmc:/switch/boboforces/bench.json`, a casca lê, renomeia para `bench.usado.json` (vale UMA abertura) e passa o
// `BenchConfig` em `GameDeps.bench`. Formatos aceitos:
//   { "preset": "dock" }                              um dos `SWITCH_BENCH_PRESETS`
//   { "params": { "views": "1", "bots": "24", "view": "90" } }   os mesmos nomes da URL da web (`BENCH_PARAMS`)
// `npm run eden -w @boboforces/switch -- --bench dock` grava o arquivo no SD virtual do Eden.
import { parseBenchParams, type BenchConfig } from '@boboforces/game';
import type { NxFs } from '../platform/nx.ts';
import { errorText } from './log.ts';
import { SWITCH_BENCH_PRESETS } from './items.ts';

export const AUTO_BENCH_FILE = 'bench.json';
export const AUTO_BENCH_USED = 'bench.usado.json';

export function readAutoBench(
  fs: Pick<NxFs, 'readFileSync' | 'renameSync' | 'removeSync'>,
  dir: string,
  log: (line: string) => void,
): BenchConfig | undefined {
  const path = `${dir}/${AUTO_BENCH_FILE}`;
  let buffer: ArrayBuffer | null = null;
  try {
    buffer = fs.readFileSync(path);
  } catch {
    buffer = null;
  }
  if (!buffer) return undefined;
  // One-shot: some antes de interpretar, para um arquivo ruim não travar todo boot.
  try {
    try {
      fs.removeSync(`${dir}/${AUTO_BENCH_USED}`);
    } catch {
      // não havia
    }
    fs.renameSync(path, `${dir}/${AUTO_BENCH_USED}`);
  } catch (error) {
    log(`[bench] automático ignorado: não deu para renomear ${AUTO_BENCH_FILE} (${errorText(error)})`);
    return undefined;
  }
  try {
    const doc = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer))) as {
      preset?: unknown;
      params?: Record<string, unknown>;
    };
    if (typeof doc.preset === 'string') {
      const preset = (SWITCH_BENCH_PRESETS as Readonly<Record<string, BenchConfig>>)[doc.preset];
      if (!preset) {
        log(`[bench] automático ignorado: preset desconhecido "${doc.preset}"`);
        return undefined;
      }
      log(`[bench] automático: preset=${doc.preset}`);
      return preset;
    }
    if (doc.params && typeof doc.params === 'object') {
      const params: Record<string, string> = {};
      for (const [k, v] of Object.entries(doc.params)) params[k] = String(v);
      const { config, warnings } = parseBenchParams(params);
      log(
        `[bench] automático: params ${Object.entries(params)
          .map(([k, v]) => `${k}=${v}`)
          .join(' ')}`,
      );
      for (const w of warnings) log(`[bench] aviso: ${w}`);
      return config;
    }
    log('[bench] automático ignorado: use {"preset": "..."} ou {"params": {...}}');
  } catch (error) {
    log(`[bench] automático ignorado: JSON inválido (${errorText(error)})`);
  }
  return undefined;
}
