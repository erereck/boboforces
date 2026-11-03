import type { Assets } from '@boboforces/platform-api';

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Caminho lógico válido (regra 3): relativo, com `/`, sem `..`, sem esquema (`http:`, `data:`), sem `?`/`#` e sem
 * barra invertida. Ex.: `maps/construto.bfmap`.
 */
export function isLogicalAssetPath(path: string): boolean {
  if (path.length === 0 || path.length > 512) return false;
  if (path.startsWith('/') || path.includes('\\') || /[?#:]/.test(path)) return false;
  return path.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..');
}

/** Monta a URL do asset relativa à base do site (o `base: './'` do Vite; funciona em /boboforces/ no Pages). */
export function resolveAssetUrl(path: string, baseUrl: string): string {
  if (!isLogicalAssetPath(path)) throw new Error(`Assets: caminho lógico inválido "${path}"`);
  return new URL(path, baseUrl).href;
}

/**
 * `Assets` por `fetch` relativo à base. Resposta fora de 2xx rejeita com o caminho e o status, para o relatório.
 * `cache: 'default'`: os arquivos com hash ficam no cache HTTP; o service worker (M2) assume o cache-first.
 */
export function createWebAssets(baseUrl: string, fetchFn: FetchLike): Assets {
  async function get(path: string): Promise<Response> {
    const url = resolveAssetUrl(path, baseUrl);
    let response: Response;
    try {
      response = await fetchFn(url, { credentials: 'same-origin', cache: 'default' });
    } catch (error) {
      throw new Error(`Assets: falha de rede em "${path}"`, { cause: error });
    }
    if (!response.ok) throw new Error(`Assets: "${path}" respondeu HTTP ${response.status}`);
    return response;
  }
  return {
    async loadBytes(path) {
      const response = await get(path);
      return new Uint8Array(await response.arrayBuffer());
    },
    async loadText(path) {
      const response = await get(path);
      return response.text();
    },
  };
}
