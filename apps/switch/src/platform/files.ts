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
