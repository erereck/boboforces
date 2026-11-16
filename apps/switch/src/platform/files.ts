import type { Files, PickedFile } from '@boboforces/platform-api';
import type { NxFs } from './nx.ts';

/**
 * Importar/exportar no Switch = ler e gravar no SD (DECISOES "DOM na web"; tecnico.md §9). Não há seletor de
 * arquivos: `save` grava em `sdmc:/switch/boboforces/exportar/<nome>` e `pick` importa o arquivo MAIS RECENTE de
 * `sdmc:/switch/boboforces/importar/` com uma das extensões pedidas (instrução no README do Switch).
 *
 * Exportar fica numa subpasta própria: na raiz moram `save.json`, `save.backup.json`, `runtime.log`… e um export
 * com o mesmo nome sobrescreveria o save ativo ou o log.
 */
export const IMPORT_SUBDIR = 'importar';
export const EXPORT_SUBDIR = 'exportar';
/** M4 (fase 2c): bots e presets feitos no PC (GDD §4.8: `sdmc:/switch/boboforces/oficina/`). */
export const WORKSHOP_SUBDIR = 'oficina';
/** Teto de um arquivo da oficina (GDD §4.8); maior que isso nem é lido. */
const WORKSHOP_MAX_BYTES = 64 * 1024;
/** No máximo tantos arquivos por abertura (a biblioteca do Switch cabe nisso com folga). */
const WORKSHOP_MAX_FILES = 200;

const decoder = new TextDecoder();

/**
 * M4 (fase 2c): os `.json` da pasta `oficina/`, em ordem de nome, como texto (o `game` valida e importa). Arquivo
 * grande demais fica de fora com uma linha no registro; pasta ausente = nenhum arquivo.
 */
export function readWorkshopFiles(
  fs: NxFs,
  dir: string,
  log: (line: string) => void,
): { readonly name: string; readonly text: string }[] {
  const folder = `${dir}/${WORKSHOP_SUBDIR}`;
  const out: { name: string; text: string }[] = [];
  try {
    const names = (fs.readDirSync(folder) ?? []).filter((n) => n.toLowerCase().endsWith('.json')).sort();
    for (const name of names.slice(0, WORKSHOP_MAX_FILES)) {
      const size = fs.statSync(`${folder}/${name}`)?.size ?? 0;
      if (size > WORKSHOP_MAX_BYTES) {
        log(`oficina: ${name} ignorado (maior que 64 KB)`);
        continue;
      }
      const bytes = fs.readFileSync(`${folder}/${name}`);
      if (bytes) out.push({ name, text: decoder.decode(bytes) });
    }
  } catch {
    // Sem a pasta (ou SD sem leitura): nenhum arquivo.
  }
  return out;
}

/** Nome de arquivo seguro para o SD: só o nome (sem pastas), com caracteres simples. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[.-]+/, '');
  return cleaned.slice(0, 96) || 'arquivo';
}

export function createSdFiles(fs: NxFs, dir: string): Files {
  return {
    pick(accept) {
      const importDir = `${dir}/${IMPORT_SUBDIR}`;
      try {
        const names = fs.readDirSync(importDir) ?? [];
        const wanted = accept.map((ext) => ext.toLowerCase());
        let best: { name: string; mtime: number } | null = null;
        for (const name of names) {
          const lower = name.toLowerCase();
          if (wanted.length && !wanted.some((ext) => lower.endsWith(ext))) continue;
          const stat = fs.statSync(`${importDir}/${name}`);
          if (!stat) continue;
          if (!best || stat.mtime > best.mtime || (stat.mtime === best.mtime && name > best.name)) {
            best = { name, mtime: stat.mtime };
          }
        }
        if (!best) return Promise.resolve(null);
        const bytes = fs.readFileSync(`${importDir}/${best.name}`);
        const picked: PickedFile | null = bytes ? { name: best.name, bytes: new Uint8Array(bytes) } : null;
        return Promise.resolve(picked);
      } catch {
        return Promise.resolve(null);
      }
    },
    save(name, data, mimeType) {
      void mimeType;
      try {
        const exportDir = `${dir}/${EXPORT_SUBDIR}`;
        fs.mkdirSync(dir);
        fs.mkdirSync(exportDir);
        fs.writeFileSync(`${exportDir}/${safeFileName(name)}`, data);
        return Promise.resolve(true);
      } catch {
        return Promise.resolve(false);
      }
    },
  };
}
