// Texto do `licencas.txt` do build web (plugin `licenseNotices` do vite.config.ts; CREDITOS.md). Puro, para o teste
// conferir o cabeçalho e a guarda das fontes sem rodar o build.
//
// Fontes (decisão #54): o atlas `fonts/ui-fonts.*` é uma versão modificada de fontes OFL 1.1 (cláusula 2: cada cópia
// leva o aviso de copyright e a licença; cláusula 5: o derivado continua OFL). Quem sabe quais fontes estão em uso é
// o fontbake, que grava `assets-src/fonts/generated/ui-fonts.licencas.txt` com uma seção por fonte
// (`== BoboForces Display: atlas MSDF derivado de Russo One 1.001 (SIL OFL 1.1) ==` + o OFL.txt da família); o build
// só confere e anexa.

/** O arquivo gerado pelo fontbake, relativo à raiz do repositório. */
export const UI_FONT_NOTICES_PATH = 'assets-src/fonts/generated/ui-fonts.licencas.txt';

/** Cabeçalho: os direitos reservados do jogo e a exceção do atlas de fontes, que é OFL 1.1. */
export const LICENSE_HEADER =
  'BoboForces © EriLab. Todos os direitos reservados, exceto o atlas de fontes da interface\n' +
  '(assets/fonts/ui-fonts.png e assets/fonts/ui-fonts.json): ele é uma versão modificada de fontes livres e continua\n' +
  'sob a SIL Open Font License 1.1, com o aviso de copyright e o texto da licença de cada fonte nas seções abaixo.\n' +
  'Este arquivo traz os avisos e as licenças do software e das fontes de terceiros distribuídos com o jogo.';

export interface PackageNotice {
  readonly name: string;
  readonly version: string;
  readonly license: string | null;
  /** Texto do arquivo de licença do pacote. */
  readonly text: string;
}

export function packageSection(notice: PackageNotice): string {
  return `== ${notice.name} ${notice.version} (${notice.license ?? 'ver texto'}) ==\n\n${notice.text.trim()}`;
}

const SECTION_TITLE = /^== (.+) ==$/gm;

/**
 * Confere o arquivo de licenças das fontes e devolve o texto: pelo menos uma seção, e cada seção com o aviso de
 * copyright e a SIL Open Font License. Lança com a dica de regerar (o build não sai com o atlas sem a licença).
 */
export function checkFontNotices(text: string): string {
  const body = text.replace(/\r\n/g, '\n').trim();
  const titles = [...body.matchAll(SECTION_TITLE)];
  const fail = (why: string): never => {
    throw new Error(`licencas.txt: ${UI_FONT_NOTICES_PATH} ${why} (rode "npm run fontbake")`);
  };
  if (titles.length === 0 || titles[0]!.index !== 0) fail('não começa por uma seção "== … =="');
  titles.forEach((title, i) => {
    const end = titles[i + 1]?.index ?? body.length;
    const section = body.slice(title.index, end);
    if (!/copyright/i.test(section)) fail(`sem o aviso de copyright na seção "${title[1]}"`);
    if (!/open font license/i.test(section)) fail(`sem a SIL Open Font License na seção "${title[1]}"`);
  });
  return body;
}

/** O `licencas.txt` inteiro: cabeçalho, pacotes npm do bundle (na ordem dada) e as fontes. */
export function composeLicenseNotices(packages: readonly PackageNotice[], fontNotices: string): string {
  const sections = [...packages.map(packageSection), checkFontNotices(fontNotices)];
  return `${LICENSE_HEADER}\n\n${sections.join('\n\n')}\n`;
}
