import { DocReader } from './doc-read.ts';
import { formatId, type FormatId } from './format-id.ts';
import { migrateDocument } from './migrations.ts';
import type { ValidationResult } from './validation.ts';

/**
 * M5 (fase 4c): `online@1`, o perfil do online deste aparelho: o nome que os amigos veem na sala e a versão do aviso
 * de privacidade que o jogador já leu (o aviso volta quando o texto muda). Fica numa chave própria do storage, lida e
 * escrita só pelas telas do Online (fora do menu da web); o Switch nunca grava (#1).
 */
export const ONLINE_PROFILE_FORMAT: FormatId = formatId('online');

export interface OnlineProfileDocument {
  readonly format: FormatId;
  /** `''` = ainda sem nome (a sala mostra "Host" ou "Amigo N"). */
  readonly name: string;
  /** A versão do aviso de privacidade já lida; 0 = nunca leu. */
  readonly privacy: number;
  /**
   * M5 (fase 5b): o id deste aparelho na sala (16 dígitos hexadecimais, sorteado na 1ª vez; `''` = ainda não). O host
   * o reconhece quando alguém cai e volta.
   */
  readonly id: string;
}

/** O nome cabe em 16 caracteres (o teto da sala, tecnico.md §13.5). */
export const ONLINE_PROFILE_RANGES = { nameLength: 16, privacyMax: 1000 } as const;

export const DEFAULT_ONLINE_PROFILE: OnlineProfileDocument = {
  format: ONLINE_PROFILE_FORMAT,
  name: '',
  privacy: 0,
  id: '',
};

const validId = (id: string): string => (/^[0-9a-f]{16}$/.test(id) ? id : '');

/** Valida um `online@1`: o nome é cortado no teto e a versão do aviso fica entre 0 e o máximo. */
export function validateOnlineProfile(input: unknown): ValidationResult<OnlineProfileDocument> {
  const migrated = migrateDocument(input, 'online');
  if (!migrated.ok) return migrated;
  const doc = migrated.value;
  const r = new DocReader('save.invalidField', 'save.valueClamped');
  r.warnings.push(...migrated.warnings);
  return {
    ok: true,
    value: {
      format: ONLINE_PROFILE_FORMAT,
      name: r.str(doc, 'name', 'name', '', ONLINE_PROFILE_RANGES.nameLength),
      privacy: Math.round(r.num(doc, 'privacy', 'privacy', 0, 0, ONLINE_PROFILE_RANGES.privacyMax)),
      id: validId(r.str(doc, 'id', 'id', '', 16)),
    },
    warnings: r.warnings,
  };
}
