import type { Assets } from '@boboforces/platform-api';
import type { NxFs } from './nx.ts';

/**
 * Assets por caminho lógico (regra 3) lidos do RomFS: `maps/construto.bfmap` → `romfs:/assets/maps/construto.bfmap`.
 * Caminho inválido (absoluto, com protocolo, com `..`) é erro de programação e rejeita na hora.
 */
const LOGICAL_PATH = /^[A-Za-z0-9_-][A-Za-z0-9_.\-/]*$/;

export function isLogicalAssetPath(path: string): boolean {
  return LOGICAL_PATH.test(path) && !path.split('/').some((part) => part === '..' || part === '.' || part === '');
}

export function createRomfsAssets(fs: Pick<NxFs, 'readFile'>, base: string): Assets {
  const decoder = new TextDecoder();
  const loadBytes = async (path: string): Promise<Uint8Array> => {
    if (!isLogicalAssetPath(path)) throw new Error(`asset: caminho lógico inválido "${path}"`);
    let buffer: ArrayBuffer | null;
    try {
      buffer = await fs.readFile(base + path);
    } catch (error) {
      throw new Error(`asset: falha ao ler ${base}${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!buffer) throw new Error(`asset: ${base}${path} não existe`);
    return new Uint8Array(buffer);
  };
  return {
    loadBytes,
    async loadText(path) {
      return decoder.decode(await loadBytes(path));
    },
  };
}
