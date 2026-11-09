// M2 (fase 8c): o service worker da web (tecnico.md §19.1), escrito à mão (sem dependência nova). O plugin do
// `vite.config.ts` grava `sw.js` na raiz do `dist` com a versão (hash do conteúdo do build) e a lista do precache.
//
// - Escopo: a pasta do site (`/boboforces/` no GitHub Pages), que é a do `sw.js`.
// - Cache por versão (`boboforces-<versão>`, prefixo próprio: a origem é dividida com o gamebobo). Na ativação, apaga só
//   os caches `boboforces-` de versões antigas.
// - Tudo do site em cache-first. A navegação (o index, com ou sem query) responde com o `./` do cache.
// - A versão nova instala em segundo plano e ESPERA: só ativa quando a página manda `boboforces:apply-update`, e o
//   jogo só manda no título.
// - No install, os arquivos com hash no nome usam o cache HTTP (são imutáveis); os sem hash (`assets/<lógico>`, o
//   index) revalidam com o servidor (`no-cache`), para a versão nova nunca guardar um arquivo velho.

/** Mensagem da página que ativa a versão nova. */
export const APPLY_UPDATE_MESSAGE = 'boboforces:apply-update';
/** Prefixo dos caches (nunca apagar o que não é nosso). */
export const CACHE_PREFIX = 'boboforces-';

/** Nome com hash do Vite (`nome-AbC123_x.js`): imutável. */
export function isHashedFile(path: string): boolean {
  return /-[A-Za-z0-9_-]{8,}\.(?:js|css)$/.test(path);
}

/**
 * Lista do precache a partir dos arquivos do build (caminhos relativos ao `dist`). Fica fora o que é sob demanda ou
 * nunca usado offline: a música (1 MB, carrega depois do menu e entra no cache quando tocar), a página do bench, o
 * próprio `sw.js` e mapas de código.
 */
export function precacheList(files: readonly string[]): string[] {
  const out = ['./'];
  for (const f of [...files].sort()) {
    if (f === 'index.html' || f === 'sw.js' || f.endsWith('.map')) continue;
    if (f.startsWith('bench/') || f.startsWith('assets/music/')) continue;
    out.push(`./${f}`);
  }
  return out;
}

/** Fonte do `sw.js` (JavaScript puro: roda no worker, sem bundler). */
export function serviceWorkerSource(version: string, precache: readonly string[]): string {
  return `// BoboForces: service worker gerado no build (apps/web/scripts/service-worker.ts). Não editar.
'use strict';
const VERSION = ${JSON.stringify(version)};
const PREFIX = ${JSON.stringify(CACHE_PREFIX)};
const CACHE = PREFIX + VERSION;
const PRECACHE = ${JSON.stringify(precache)};
const HASHED = /-[A-Za-z0-9_-]{8,}\\.(?:js|css)$/;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(
        PRECACHE.map((url) => {
          const request = new Request(url, { cache: HASHED.test(url) ? 'default' : 'no-cache' });
          return fetch(request).then((response) => {
            if (!response.ok) throw new Error('precache: ' + url + ' ' + response.status);
            return cache.put(url, response);
          });
        }),
      ),
    ),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === ${JSON.stringify(APPLY_UPDATE_MESSAGE)}) self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  // A navegação para o index (com ou sem query, como o ?bench) responde com o ./ do cache; outras páginas (o /bench/)
  // seguem como qualquer arquivo.
  const index = url.pathname === scope.pathname || url.pathname === scope.pathname + 'index.html';
  event.respondWith(respond(request, request.mode === 'navigate' && index ? new URL('./', scope).href : request));
});

async function respond(request, key) {
  const cache = await caches.open(CACHE);
  // ignoreVary: o import dinâmico de módulo manda Origin, e um Vary: Origin do servidor faria o cache errar.
  const hit = await cache.match(key, { ignoreSearch: typeof key === 'string', ignoreVary: true });
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok && response.type === 'basic' && typeof key !== 'string') await cache.put(key, response.clone());
  return response;
}
`;
}
