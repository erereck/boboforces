import { DocReader } from './doc-read.ts';
import { formatId, type FormatId } from './format-id.ts';
import { migrateDocument } from './migrations.ts';
import { normalizeFigureLook, type FigureLook } from './model/figure-look.ts';
import { FIGURE_PRESETS } from './model/figure-presets.ts';
import type { ValidationResult } from './validation.ts';

/**
 * M2 (fase 6c): `bobo@1`, o "Meu Bobo" (GDD §4.7.2; #17, #58): a aparência do jogador, salva para sempre e tudo liberado
 * desde o início (#16). Guarda o look inteiro (o mesmo formato que pinta a skin, `FigureLook`) e o visual pronto de onde
 * ele saiu (para o editor mostrar "Recruta" ou "Recruta, editado"). Nunca é zumbi.
 */
export const BOBO_FORMAT: FormatId = formatId('bobo');

export interface BoboDocument {
  readonly format: FormatId;
  readonly look: FigureLook;
  /** Id do visual pronto (`recruit`…) de onde o look saiu; `''` = nenhum. */
  readonly preset: string;
}

export const BOBO_RANGES = { presetLength: 32 } as const;

/** Sem nada salvo: o recruta, o visual que o jogador 1 já usava (o 1º da fila dos bots). */
export const DEFAULT_BOBO: BoboDocument = { format: BOBO_FORMAT, look: FIGURE_PRESETS.recruit, preset: 'recruit' };

/** O look do jogador, normalizado e nunca zumbi. */
export function normalizeBoboLook(raw: unknown): FigureLook {
  const look = normalizeFigureLook((typeof raw === 'object' && raw !== null ? raw : {}) as Partial<FigureLook>);
  return look.zombie === null ? look : { ...look, zombie: null };
}

/**
 * Valida um `bobo@1`: recusa só o que não é objeto ou é de outro tipo (ou de versão mais nova); o look passa pelo
 * normalizador (índices e cores limitados às listas, campo ausente = o do padrão) e sai sem zumbi.
 */
export function validateBobo(input: unknown): ValidationResult<BoboDocument> {
  const migrated = migrateDocument(input, 'bobo');
  if (!migrated.ok) return migrated;
  const doc = migrated.value;
  const r = new DocReader('save.invalidField', 'save.valueClamped');
  r.warnings.push(...migrated.warnings);
  const rawLook = doc['look'];
  const bad = rawLook !== undefined && (typeof rawLook !== 'object' || rawLook === null || Array.isArray(rawLook));
  if (bad) r.warn('look', 'save.invalidField');
  // Sem look (ou estragado): o recruta, com o id dele.
  const fallback = rawLook === undefined || bad;
  const look = fallback ? DEFAULT_BOBO.look : normalizeBoboLook(rawLook);
  return {
    ok: true,
    value: {
      format: BOBO_FORMAT,
      look,
      preset: r.str(doc, 'preset', 'preset', fallback ? DEFAULT_BOBO.preset : '', BOBO_RANGES.presetLength),
    },
    warnings: r.warnings,
  };
}
