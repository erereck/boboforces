/**
 * `romfs:/licencas.txt` (decisão #54; CREDITOS.md): os avisos e as licenças do que vai de terceiros no RomFS, como o
 * `licencas.txt` da raiz do site. A OFL pede o aviso e a licença junto de cada cópia da fonte (cláusula 2), e vale
 * mesmo no NRO de uso pessoal; o MIT pede o mesmo para o código, e o esbuild só guarda os comentários `@license`.
 * Seções: o runtime do nx.js (o empacotador o põe no NRO/NSP; o `main.js` não o importa) e a fonte que vem no RomFS
 * dele, cada pacote npm que entrou no `main.js` (lido do metafile do esbuild) com o LICENSE dele, e depois o arquivo de
 * licenças das fontes em uso que o fontbake gera. Pacote sem arquivo de licença, ou fonte sem o arquivo gerado,
 * reprova o build. Até o `tools/credits` (M2) este módulo é a fonte do arquivo no Switch; os avisos das bibliotecas
 * que o runtime embute (ver `LICENSES_HEADER`) ficam para ele.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

/** Licenças das fontes em uso (uma seção por fonte + o OFL.txt da família), geradas pelo `npm run fontbake`. */
export const FONT_LICENSES_FILE = 'assets-src/fonts/generated/ui-fonts.licencas.txt';
/** Nome no RomFS (raiz), o mesmo do site. */
export const ROMFS_LICENSES_NAME = 'licencas.txt';

export const LICENSES_HEADER =
  'BoboForces © EriLab. Todos os direitos reservados, exceto o atlas das fontes da UI (assets/fonts/ui-fonts.*), ' +
  'derivado de fontes livres e distribuído sob a SIL Open Font License 1.1 (texto abaixo).\n' +
  'Este arquivo traz os avisos e as licenças do que o jogo põe no RomFS e do runtime do nx.js, que o empacotador ' +
  'acrescenta ao NRO/NSP. O runtime também embute bibliotecas de terceiros (pacotes npm no runtime JS, como ' +
  'web-streams-polyfill, kleur e color-rgba; bibliotecas nativas como mbedtls, zlib, libpng, freetype, harfbuzz e ' +
  'libjpeg), cujos avisos não vêm no pacote npm do nx.js e ainda não estão neste arquivo.';

/** Pacote cujo LICENSE cobre o runtime do nx.js embutido no NRO/NSP (o mesmo MIT do `@nx.js/nro` e do `@nx.js/nsp`). */
export const NXJS_RUNTIME_PACKAGE = '@nx.js/runtime';

/**
 * Aviso da fonte que vem no RomFS do runtime do nx.js (name IDs 0, 5 e 13 do `GeistMono.ttf`). O TTF traz só o aviso e
 * a URL da OFL; o texto inteiro da OFL 1.1 é o mesmo das seções das fontes da UI, mais abaixo.
 */
export const GEIST_MONO_NOTICE =
  '== Geist Mono 1.700 (GeistMono.ttf, no RomFS do runtime do nx.js) (OFL-1.1) ==\n\n' +
  'Copyright 2024 The Geist Project Authors (https://github.com/vercel/geist-font.git). Licenciada sob a SIL Open ' +
  'Font License 1.1; o texto da licença é o mesmo das seções das fontes da UI, mais abaixo.';

const LICENSE_FILE = /^licen[cs]e(\.(md|txt))?$/i;
/** Pasta do pacote na ÚLTIMA `node_modules` do caminho (pacote aninhado vence o de fora). */
const PACKAGE_DIR = /^((?:.*[\\/])?node_modules[\\/](?:@[^\\/]+[\\/])?[^\\/]+)[\\/]/;

/**
 * Pastas dos pacotes npm de onde saiu algum módulo do bundle, sem repetir. `inputs` são as chaves de
 * `metafile.inputs` do esbuild (relativas a `cwd`); os pacotes do workspace chegam pelo caminho real (`packages/…`)
 * e ficam de fora.
 */
export function bundledPackageDirs(inputs: Iterable<string>, cwd: string): string[] {
  const dirs = new Set<string>();
  for (const input of inputs) {
    const match = PACKAGE_DIR.exec(input);
    if (match?.[1]) dirs.add(resolve(cwd, match[1]));
  }
  return [...dirs];
}

export interface LicenseSection {
  readonly name: string;
  readonly version: string;
  readonly license: string;
  readonly text: string;
}

/** Nome, versão e licença do pacote em `dir`, com o texto do LICENSE. Sem arquivo de licença, lança. */
export function readPackageLicense(dir: string): LicenseSection {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
    name?: string;
    version?: string;
    license?: string;
  };
  const name = pkg.name ?? dir;
  const file = readdirSync(dir).find((f) => LICENSE_FILE.test(f));
  if (!file) throw new Error(`${ROMFS_LICENSES_NAME}: ${name} não tem arquivo de licença`);
  return {
    name,
    version: pkg.version ?? '?',
    license: pkg.license ?? 'ver texto',
    text: readFileSync(join(dir, file), 'utf8').trim(),
  };
}

/** Seção do runtime do nx.js: o título diz que é o empacotador que o acrescenta ao NRO/NSP. */
export function runtimeSection(runtime: LicenseSection): string {
  return `== nx.js (runtime embutido no NRO/NSP) ${runtime.version} (${runtime.license}) ==\n\n${runtime.text}`;
}

/**
 * Texto final: cabeçalho, o runtime do nx.js e a Geist Mono do RomFS dele, os pacotes do bundle em ordem de nome (sem
 * repetir nome e versão) e as licenças das fontes.
 */
export function composeLicenses(
  packages: readonly LicenseSection[],
  fontLicenses: string,
  runtime: LicenseSection,
): string {
  const fonts = fontLicenses.trim();
  if (!fonts) throw new Error(`${ROMFS_LICENSES_NAME}: ${FONT_LICENSES_FILE} está vazio (rode npm run fontbake)`);
  const seen = new Set<string>();
  const sections: string[] = [runtimeSection(runtime), GEIST_MONO_NOTICE];
  for (const p of [...packages].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const id = `${p.name}@${p.version}`;
    if (seen.has(id)) continue;
    seen.add(id);
    sections.push(`== ${p.name} ${p.version} (${p.license}) ==\n\n${p.text}`);
  }
  sections.push(fonts);
  return `${LICENSES_HEADER}\n\n${sections.join('\n\n')}\n`;
}

/** Pasta do pacote do runtime do nx.js, resolvida a partir deste módulo (como o `package-nsp.ts` faz com o nsp). */
export function nxjsRuntimeDir(): string {
  return dirname(createRequire(import.meta.url).resolve(`${NXJS_RUNTIME_PACKAGE}/package.json`));
}

/**
 * Monta o `licencas.txt` do RomFS a partir do metafile do esbuild, do pacote do runtime do nx.js e do arquivo gerado
 * pelo fontbake.
 */
export function buildLicenses(
  inputs: Iterable<string>,
  cwd: string,
  rootDir: string,
  runtimeDir: string = nxjsRuntimeDir(),
): string {
  const fontsPath = join(rootDir, FONT_LICENSES_FILE);
  if (!existsSync(fontsPath))
    throw new Error(`${ROMFS_LICENSES_NAME}: falta ${FONT_LICENSES_FILE} (rode npm run fontbake)`);
  const packages = bundledPackageDirs(inputs, cwd).map(readPackageLicense);
  return composeLicenses(packages, readFileSync(fontsPath, 'utf8'), readPackageLicense(runtimeDir));
}
