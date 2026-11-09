import { FORMAT_VERSIONS } from './version.ts';

/**
 * Todo documento tem `format: "boboforces/<tipo>@<n>"` (tecnico.md §14.2), com cadeia de migrações e validador.
 * Versão maior que a conhecida é recusada; menor passa pelas migrações; campos desconhecidos são ignorados.
 */
export const FORMAT_KINDS = [
  'settings',
  'preset',
  'bot',
  'stats',
  // M2 (fase 6c): o Meu Bobo (a aparência do jogador).
  'bobo',
  'backup',
  'replay',
  'map',
  'model',
  // M1: arquivos internos de build (não são documentos do jogador, mas levam o mesmo carimbo de versão)
  'blocks',
  'layers',
] as const;

export type FormatKind = (typeof FORMAT_KINDS)[number];

/**
 * Tipos aposentados: o nome nunca é reusado por outro formato (um arquivo velho nunca passa por um novo). `skinparts`
 * (@1 e @2) era a biblioteca de partes da skin do bobo A (`skins/partes64.*`), aposentada pelo boneco do FutBobo (#56,
 * passo 5 do porte): a skin é pintada no loading pelo `paintFigureSkin`.
 */
export const RETIRED_FORMAT_KINDS = ['skinparts'] as const;

export type FormatId = `boboforces/${FormatKind}@${number}`;

/** Versão atual de cada tipo, derivada do `version.json` (settings/stats/bobo/backup/replay seguem `formats.save`). */
export const CURRENT_FORMAT_VERSION: Readonly<Record<FormatKind, number>> = {
  settings: FORMAT_VERSIONS.save,
  stats: FORMAT_VERSIONS.save,
  bobo: FORMAT_VERSIONS.save,
  backup: FORMAT_VERSIONS.save,
  replay: FORMAT_VERSIONS.save,
  preset: FORMAT_VERSIONS.preset,
  bot: FORMAT_VERSIONS.bot,
  map: FORMAT_VERSIONS.map,
  model: 1,
  blocks: 1,
  layers: 1,
};

export function formatId(kind: FormatKind, version: number = CURRENT_FORMAT_VERSION[kind]): FormatId {
  return `boboforces/${kind}@${version}`;
}

const FORMAT_RE = /^boboforces\/([a-z]+)@([1-9][0-9]{0,5})$/;

/** Lê `boboforces/<tipo>@<n>`; `null` se não for um id de formato conhecido do BoboForces. */
export function parseFormatId(value: unknown): { kind: FormatKind; version: number } | null {
  if (typeof value !== 'string') return null;
  const m = FORMAT_RE.exec(value);
  if (!m) return null;
  const kind = m[1] as FormatKind;
  if (!(FORMAT_KINDS as readonly string[]).includes(kind)) return null;
  return { kind, version: Number(m[2]) };
}
