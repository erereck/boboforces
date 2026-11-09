import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type HtmlTagDescriptor, type Plugin } from 'vite';
import runtimeAssets from '../../assets-src/runtime-assets.json' with { type: 'json' };
import versionJson from '../../version.json' with { type: 'json' };
import { composeLicenseNotices, UI_FONT_NOTICES_PATH, type PackageNotice } from './scripts/licenses.ts';
import { precacheList, serviceWorkerSource } from './scripts/service-worker.ts';

// Casca web (tecnico.md §19.1).
// - `base: './'`: funciona no GitHub Pages com subcaminho (/boboforces/) e num domínio próprio no futuro.
// - Chunks: `three` (só o render importa) num grupo fixo; o menu (casca + núcleo do jogo) no fecho estático e a cena
//   (`src/scene.ts`: mundo, IA, renderer completo) num chunk carregado por `import()` ao entrar no Construto.
//   `net` entra como import dinâmico no M5 e vira chunk próprio sozinho. O Vite põe `modulepreload` dos chunks iniciais
//   no index.html; sem polyfill, porque todo navegador com ES2022 que importa já tem `modulepreload` ou ignora a dica.
// - Servidor só em 127.0.0.1 (nada exposto na rede local sem querer).
// - Service worker (M2, fase 8c): `sw.js` gerado no fim do build (`scripts/service-worker.ts`); a página só registra
//   no build de produção.
// - Assets do jogo (`assets-src/runtime-assets.json`) servidos em `assets/<caminho lógico>`: middleware no dev,
//   arquivos emitidos no build. Os do menu ganham `<link rel=preload as=fetch>` (baixam junto com o JS e entram na
//   conta da carga inicial do size-check).

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

/** Hash curto do commit para o relatório; `dev` sem git ou antes do primeiro commit. */
function buildId(): string {
  try {
    const out = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim() || 'dev';
  } catch {
    return 'dev';
  }
}

/** Troca `%BF_VERSION%` no index.html (rodapé do splash) pela versão do version.json. */
function versionInHtml(version: string): Plugin {
  return {
    name: 'boboforces:version-html',
    transformIndexHtml: (html) => html.replaceAll('%BF_VERSION%', version),
  };
}

const ASSET_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.json': 'application/json',
  '.mp3': 'audio/mpeg',
};

/** Assets do jogo por caminho lógico (regra 3): a mesma tabela que o build do Switch copia para o RomFS. */
function gameAssets(): Plugin {
  // `local`: gerados só sob demanda na máquina do Erick; entram se existirem. O CI não gera, então o build publicado
  // sai sem eles. Vazio desde a decisão #54 (o `{}` do JSON não dá tipo às entradas, daí a anotação).
  const localTable: Readonly<Record<string, string>> = runtimeAssets.local;
  const local: Readonly<Record<string, string>> = Object.fromEntries(
    Object.entries(localTable).filter(([, file]) => existsSync(join(repoRoot, 'assets-src', file))),
  );
  const files: Readonly<Record<string, string>> = { ...runtimeAssets.files, ...local };
  const source = (logical: string): string => join(repoRoot, 'assets-src', files[logical] as string);
  const typeOf = (logical: string): string =>
    ASSET_TYPES[logical.slice(logical.lastIndexOf('.'))] ?? 'application/octet-stream';
  return {
    name: 'boboforces:game-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const match = /^\/assets\/([^?#]+)/.exec(req.url ?? '');
        const logical = match?.[1] ? decodeURIComponent(match[1]) : '';
        if (!Object.hasOwn(files, logical)) {
          next();
          return;
        }
        res.setHeader('Content-Type', typeOf(logical));
        res.end(readFileSync(source(logical)));
      });
    },
    generateBundle() {
      for (const logical of Object.keys(files)) {
        this.emitFile({ type: 'asset', fileName: `assets/${logical}`, source: readFileSync(source(logical)) });
      }
    },
    transformIndexHtml(): HtmlTagDescriptor[] {
      return runtimeAssets.preload.map((logical) => ({
        tag: 'link',
        // `crossorigin` (anônimo) casa com o modo do fetch da platform-web: o navegador reaproveita o download.
        attrs: { rel: 'preload', as: 'fetch', href: `./assets/${logical}`, crossorigin: true },
        injectTo: 'head',
      }));
    },
  };
}

/**
 * `/bench/` (PLANO_M1: "o `/bench` da web", para o Erick abrir no celular): página mínima que redireciona para
 * `../?bench&<parâmetros>`, preservando a query. Funciona no GitHub Pages (sem servidor) e no `vite preview`; no dev,
 * um middleware faz o mesmo. Fica fora da carga inicial e da primeira partida (só conta no build inteiro).
 */
const BENCH_REDIRECT_HTML =
  '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="robots" content="noindex">' +
  '<title>BoboForces bench</title><script>var q=location.search.slice(1);' +
  "location.replace('../?bench'+(q?'&'+q:'')+location.hash)</script>" +
  '<noscript>Abra <a href="../?bench">../?bench</a>.</noscript></html>\n';

function benchRedirect(): Plugin {
  return {
    name: 'boboforces:bench-redirect',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const match = /^\/bench\/?(?:\?([^#]*))?$/.exec(req.url ?? '');
        if (!match) {
          next();
          return;
        }
        const query = match[1] ?? '';
        res.statusCode = 302;
        res.setHeader('Location', `/?bench${query ? `&${query}` : ''}`);
        res.end();
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'bench/index.html', source: BENCH_REDIRECT_HTML });
    },
  };
}

/**
 * `licencas.txt` na raiz do site (CREDITOS.md; MIT e OFL pedem o aviso junto das cópias, e o minificador apaga os
 * cabeçalhos `@license`). Lista cada pacote npm que entrou de fato no bundle, com o LICENSE dele, mais as fontes da UI
 * em uso (decisão #54), lidas do arquivo que o fontbake gera; o cabeçalho abre a exceção OFL do atlas `fonts/ui-fonts.*`
 * (`scripts/licenses.ts`). Pacote sem arquivo de licença, ou fonte sem aviso e licença, reprova o build. Até o
 * `tools/credits` (M2) este plugin é a fonte do arquivo.
 */
function licenseNotices(): Plugin {
  const packagePattern = /[\\/]node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)[\\/]/;
  return {
    name: 'boboforces:licencas',
    generateBundle(_options, bundle) {
      const names = new Set<string>();
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue;
        for (const id of output.moduleIds) {
          const name = packagePattern.exec(id)?.[1];
          if (name) names.add(name.replace('\\', '/'));
        }
      }
      const packages = [...names].sort().map((name): PackageNotice => {
        const dir = join(repoRoot, 'node_modules', name);
        const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
          version: string;
          license?: string;
        };
        const file = readdirSync(dir).find((f) => /^licen[cs]e(\.(md|txt))?$/i.test(f));
        if (!file) throw new Error(`licencas.txt: ${name} não tem arquivo de licença`);
        return {
          name,
          version: pkg.version,
          license: pkg.license ?? null,
          text: readFileSync(join(dir, file), 'utf8'),
        };
      });
      const fontNotices = join(repoRoot, UI_FONT_NOTICES_PATH);
      if (!existsSync(fontNotices)) {
        throw new Error(`licencas.txt: falta ${UI_FONT_NOTICES_PATH} (rode "npm run fontbake")`);
      }
      const source = composeLicenseNotices(packages, readFileSync(fontNotices, 'utf8'));
      this.emitFile({ type: 'asset', fileName: 'licencas.txt', source });
    },
    transformIndexHtml: (): HtmlTagDescriptor[] => [
      { tag: 'link', attrs: { rel: 'license', href: './licencas.txt' }, injectTo: 'head' },
    ],
  };
}

/**
 * M2 (fase 8c): grava `sw.js` depois de todos os outros plugins (`enforce: 'post'`), com a lista do precache e a
 * versão = hash do conteúdo de todo o build (mudou um byte de qualquer arquivo, o navegador vê um `sw.js` novo).
 */
function serviceWorker(): Plugin {
  return {
    name: 'boboforces:service-worker',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const hash = createHash('sha256');
      // O código do próprio worker também conta: mudou a lógica, o cache é outro.
      hash.update(serviceWorkerSource('', []));
      const names = Object.keys(bundle).sort();
      for (const name of names) {
        const out = bundle[name]!;
        hash.update(name);
        hash.update(out.type === 'chunk' ? out.code : out.source);
      }
      const version = hash.digest('hex').slice(0, 16);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: serviceWorkerSource(version, precacheList(names)) });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [versionInHtml(versionJson.version), gameAssets(), benchRedirect(), licenseNotices(), serviceWorker()],
  define: {
    __BF_VERSION__: JSON.stringify(versionJson.version),
    __BF_CODENAME__: JSON.stringify(versionJson.codename),
    __BF_BUILD__: JSON.stringify(buildId()),
  },
  server: { host: '127.0.0.1', port: 5173 },
  preview: { host: '127.0.0.1', port: 4173 },
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    modulePreload: { polyfill: false },
    // O three com tree-shaking passa dos 500 kB crus do aviso padrão. Quem reprova tamanho é o size-check (gzip,
    // tecnico.md §16.4); este limite só tira o aviso repetido do log do build.
    chunkSizeWarningLimit: 800,
    rolldownOptions: {
      output: {
        // Só o three tem grupo fixo (cache longo). O resto se divide pelo grafo: o fecho estático do `main.ts` (menu)
        // e o chunk da cena (`src/scene.ts`, por `import()`: mundo, IA, renderer completo). Um grupo "core" com todos
        // os pacotes puxaria a cena para a carga inicial (integração do M1, tecnico.md §16.4).
        codeSplitting: {
          groups: [{ name: 'three', test: /[\\/]node_modules[\\/]three[\\/]/, priority: 2 }],
        },
      },
    },
  },
});
