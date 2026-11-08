/**
 * Regra 23 nos assets em tempo de execução (`assets-src/runtime-assets.json`, a tabela que a web serve e o Switch
 * copia para o RomFS): só PNG, MP3, JSON de manifesto e binários próprios (`.bfmap`, `.bfmodel`), com a MESMA extensão
 * no caminho lógico e no arquivo gerado (a web escolhe o Content-Type pela extensão do lógico), e todo `preload`
 * cadastrado em `files`. Um OGG, WAV, KTX ou JPEG entrando por engano reprova aqui, antes de chegar no Switch.
 */
import { extname, posix } from 'node:path';
import type { Violation } from './check.ts';
import { RULE_HELP, RUNTIME_ASSET_EXTENSIONS } from './rules.ts';

export const RUNTIME_ASSETS_PATH = 'assets-src/runtime-assets.json';

/** Extensão em minúsculas; `.mips.png` conta como `.png`. */
function extOf(path: string): string {
  return extname(posix.basename(path)).toLowerCase();
}

/** Linha (1-based) da primeira ocorrência de `"texto"` no JSON, para o relatório apontar o lugar. */
function lineOf(source: string, text: string): number {
  const at = source.indexOf(JSON.stringify(text));
  return at < 0 ? 1 : source.slice(0, at).split('\n').length;
}

export function checkRuntimeAssets(source: string, rel: string = RUNTIME_ASSETS_PATH): Violation[] {
  const out: Violation[] = [];
  const report = (text: string, what: string): void => {
    out.push({
      file: rel,
      line: lineOf(source, text),
      col: 1,
      rule: 'asset-format',
      message: `${what}: ${RULE_HELP['asset-format']}`,
    });
  };
  let json: unknown;
  try {
    json = JSON.parse(source);
  } catch (error) {
    out.push({
      file: rel,
      line: 1,
      col: 1,
      rule: 'asset-format',
      message: `JSON inválido (${String(error instanceof Error ? error.message : error)})`,
    });
    return out;
  }
  const doc = (typeof json === 'object' && json !== null ? json : {}) as {
    files?: unknown;
    local?: unknown;
    preload?: unknown;
  };
  const files = (typeof doc.files === 'object' && doc.files !== null ? doc.files : {}) as Record<string, unknown>;
  // `local`: assets só da máquina do Erick (fontes candidatas); mesma regra 23 dos `files`.
  const local = (typeof doc.local === 'object' && doc.local !== null ? doc.local : {}) as Record<string, unknown>;
  for (const [logical, target] of [...Object.entries(files), ...Object.entries(local)]) {
    if (typeof target !== 'string') {
      report(logical, `'${logical}' sem arquivo de origem`);
      continue;
    }
    const a = extOf(logical);
    const b = extOf(target);
    if (!RUNTIME_ASSET_EXTENSIONS.has(a)) report(logical, `'${logical}' (${a || 'sem extensão'})`);
    else if (!RUNTIME_ASSET_EXTENSIONS.has(b)) report(logical, `'${logical}' → '${target}' (${b || 'sem extensão'})`);
    else if (a !== b) report(logical, `'${logical}' → '${target}' (extensões diferentes)`);
  }
  for (const logical of Array.isArray(doc.preload) ? (doc.preload as unknown[]) : []) {
    if (typeof logical !== 'string' || !Object.hasOwn(files, logical)) {
      report(String(logical), `preload '${String(logical)}' não está em files`);
    }
  }
  return out;
}
