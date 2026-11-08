/**
 * Licença das fontes da UI (SIL OFL 1.1; decisão #54). O atlas MSDF é uma "Modified Version" pela definição da OFL
 * (subconjunto de glifos + campo de distância), então:
 * - cláusula 2: cada cópia leva o aviso de copyright e a licença. O fontbake grava
 *   `assets-src/fonts/generated/ui-fonts.licencas.txt` (uma seção por fonte em uso + o OFL.txt da família, que já começa
 *   com o copyright) e a casca anexa no `licencas.txt` do build;
 * - cláusula 3: o nome do derivado não pode usar o Reserved Font Name. O `name` do JSON é um nome derivado fixo e o
 *   fontbake reprova se ele contiver algum RFN declarado no name ID 0 ou no cabeçalho do OFL.txt (sem diferenciar
 *   caixa: a Saira escreve "reserved font name" em minúsculas). Aspas retas ou curvas, duplas ou simples; se a
 *   declaração existe e o nome não sai (sem aspas), a guarda falha fechada e pede `FontSpec.reservedNames`.
 * O JSON leva só `license` e uma origem curta (`source`); o copyright fica no arquivo de licenças.
 */

/** Identificador SPDX gravado em `FontFile.license`. */
export const FONT_LICENSE = 'OFL-1.1';

/** Arquivo auxiliar gerado ao lado do atlas (não é asset do jogo). */
export const LICENSE_FILE_NAME = 'ui-fonts.licencas.txt';

/**
 * Um nome entre aspas, com o PAR casado: retas duplas, curvas duplas, retas simples (a Adobe escreve 'Source') ou curvas
 * simples. Par casado para um apóstrofo dentro de aspas duplas ("Bob's Sans") não cortar o nome.
 */
const QUOTED_NAME = String.raw`"[^"\n]{1,64}"|“[^”\n]{1,64}”|'[^'\n]{1,64}'|‘[^’\n]{1,64}’`;
const QUOTED = /"([^"\n]{1,64})"|“([^”\n]{1,64})”|'([^'\n]{1,64})'|‘([^’\n]{1,64})’/g;

/**
 * Cláusula do RFN (singular ou plural) seguida de um ou mais nomes entre aspas. O espaço (ou dois-pontos) antes da aspa
 * evita confundir com a definição da própria licença (`"Reserved Font Name" refers to…`). Um nome SEM aspas depois de
 * outros entre aspas (`"Alfa" and Beta`) escapa da extração; o caso só sem aspas é pego por `RFN_DECLARATION`.
 */
const RFN_CLAUSE = new RegExp(
  String.raw`reserved\s+font\s+names?(?:\s+|\s*:\s*)((?:(?:${QUOTED_NAME})(?:\s*(?:,|and|&)\s*)?)+)`,
  'gi',
);

/**
 * Declaração de RFN, com ou sem aspas no nome. Fica de fora o termo citado na própria licença: a definição entre aspas
 * (`"Reserved Font Name" refers to…`) e a cláusula 3 (`…may use the Reserved Font Name(s) unless…`).
 */
const RFN_DECLARATION = /(?<!["“'‘]|\bthe\s)reserved\s+font\s+names?(?!\s*\(s\)|["”'’])/i;

/** Cabeçalho de um OFL.txt: as linhas de copyright antes do texto da licença (onde a família declara o RFN). */
export function oflHeader(oflText: string): string {
  const at = oflText.search(/this\s+font\s+software\s+is\s+licensed/i);
  return at >= 0 ? oflText.slice(0, at) : oflText;
}

/** Reserved Font Names declarados num texto de copyright/licença OFL, sem repetição, na ordem em que aparecem. */
export function reservedFontNames(text: string): string[] {
  const out: string[] = [];
  for (const clause of text.matchAll(RFN_CLAUSE)) {
    for (const quoted of (clause[1] ?? '').matchAll(QUOTED)) {
      const name = (quoted[1] ?? quoted[2] ?? quoted[3] ?? quoted[4] ?? '').trim();
      if (name !== '' && !out.some((n) => n.toLowerCase() === name.toLowerCase())) out.push(name);
    }
  }
  return out;
}

/** Se o texto declara algum Reserved Font Name (mesmo num formato que `reservedFontNames` não sabe ler). */
export function declaresReservedFontName(text: string): boolean {
  return RFN_DECLARATION.test(text);
}

/**
 * RFNs que a guarda usa: os extraídos do texto mais os declarados à mão (`FontSpec.reservedNames`). Falha FECHADA: se o
 * texto declara RFN e nada foi extraído nem declarado à mão, lança em vez de deixar a guarda passar com lista vazia.
 */
export function resolveReservedNames(text: string, manual: readonly string[] = [], origin = 'a fonte'): string[] {
  const out = reservedFontNames(text);
  const extra = manual.map((n) => n.trim()).filter((n) => n !== '');
  if (out.length === 0 && extra.length === 0 && declaresReservedFontName(text)) {
    throw new Error(
      `fontbake: ${origin} declara Reserved Font Name num formato que o fontbake não lê (sem aspas?); ` +
        'declare o nome à mão em FontSpec.reservedNames (spec.ts)',
    );
  }
  for (const name of extra) if (!out.some((n) => n.toLowerCase() === name.toLowerCase())) out.push(name);
  return out;
}

/** Lança se o nome derivado contém algum RFN (sem diferenciar caixa). `origin` só entra na mensagem. */
export function assertDerivedName(derived: string, reserved: readonly string[], origin: string): void {
  const lower = derived.toLowerCase();
  for (const rfn of reserved) {
    if (lower.includes(rfn.toLowerCase())) {
      throw new Error(
        `fontbake: o nome "${derived}" usa o Reserved Font Name "${rfn}" de ${origin} (OFL 1.1, cláusula 3); ` +
          'escolha um nome derivado sem ele',
      );
    }
  }
}

export interface LicenseSectionInput {
  /** Nome do derivado (`FontFile.name`). */
  readonly derivedName: string;
  /** Fonte de origem e versão (`FontFile.source`), ex.: "Russo One 1.001". */
  readonly source: string;
  /** OFL.txt da família, na íntegra (começa com o copyright e a declaração do RFN). */
  readonly oflText: string;
}

/** Uma seção do arquivo de licenças: cabeçalho e o OFL.txt da família. */
export function licenseSection(input: LicenseSectionInput): string {
  const header = `== ${input.derivedName}: atlas MSDF derivado de ${input.source} (SIL OFL 1.1) ==`;
  return `${header}\n\n${input.oflText.replace(/\r\n?/g, '\n').trim()}\n`;
}

/** Junta as seções (uma por fonte em uso) num texto só, separadas por linha em branco. */
export function licenseFile(sections: readonly string[]): string {
  return sections.join('\n');
}
