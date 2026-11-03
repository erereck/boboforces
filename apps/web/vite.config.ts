import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type HtmlTagDescriptor, type Plugin } from 'vite';
import runtimeAssets from '../../assets-src/runtime-assets.json' with { type: 'json' };
import versionJson from '../../version.json' with { type: 'json' };

// Casca web (tecnico.md §19.1).
// - `base: './'`: funciona no GitHub Pages com subcaminho (/boboforces/) e num domínio próprio no futuro.
// - Chunks manuais: `three` (só o render importa) e `core` (os pacotes do jogo); o chunk de entrada fica só com a casca.
//   `net` entra como import dinâmico no M5 e vira chunk próprio sozinho. O Vite põe `modulepreload` dos chunks iniciais
//   no index.html; sem polyfill, porque todo navegador com ES2022 que importa já tem `modulepreload` ou ignora a dica.
// - Servidor só em 127.0.0.1 (nada exposto na rede local sem querer).
// - Sem service worker no M0 (chega no M2 com a tela de "Novidades").
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
  const files: Readonly<Record<string, string>> = runtimeAssets.files;
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
 * `licencas.txt` na raiz do site (CREDITOS.md; MIT e OFL pedem o aviso junto das cópias, e o minificador apaga os
 * cabeçalhos `@license`). Lista cada pacote npm que entrou de fato no bundle, com o LICENSE dele, mais a fonte da UI
 * (OFL). Pacote sem arquivo de licença reprova o build. Até o `tools/credits` (M2) este plugin é a fonte do arquivo.
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
      const sections = [...names].sort().map((name) => {
        const dir = join(repoRoot, 'node_modules', name);
        const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
          version: string;
          license?: string;
        };
        const file = readdirSync(dir).find((f) => /^licen[cs]e(\.(md|txt))?$/i.test(f));
        if (!file) throw new Error(`licencas.txt: ${name} não tem arquivo de licença`);
        const text = readFileSync(join(dir, file), 'utf8').trim();
        return `== ${name} ${pkg.version} (${pkg.license ?? 'ver texto'}) ==\n\n${text}`;
      });
      const ofl = readFileSync(join(repoRoot, 'assets-src', 'fonts', 'OFL.txt'), 'utf8').trim();
      sections.push(`== Barlow Condensed (fonte da UI, convertida para atlas MSDF) ==\n\n${ofl}`);
      const header =
        'BoboForces © EriLab. Todos os direitos reservados.\n' +
        'Este arquivo traz os avisos e as licenças do software e da fonte de terceiros distribuídos com o jogo.';
      this.emitFile({ type: 'asset', fileName: 'licencas.txt', source: `${header}\n\n${sections.join('\n\n')}\n` });
    },
    transformIndexHtml: (): HtmlTagDescriptor[] => [
      { tag: 'link', attrs: { rel: 'license', href: './licencas.txt' }, injectTo: 'head' },
    ],
  };
}

export default defineConfig({
  base: './',
  plugins: [versionInHtml(versionJson.version), gameAssets(), licenseNotices()],
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
        codeSplitting: {
          groups: [
            { name: 'three', test: /[\\/]node_modules[\\/]three[\\/]/, priority: 2 },
            {
              name: 'core',
              test: /[\\/]packages[\\/][^\\/]+[\\/]src[\\/]|[\\/]node_modules[\\/]fflate[\\/]/,
              priority: 1,
            },
          ],
        },
      },
    },
  },
});
