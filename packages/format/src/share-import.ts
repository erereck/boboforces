import { validateBot, type BotDocument } from './bot.ts';
import { validateMatchRecipe, type MatchRecipe, type TeamRecipe } from './match-recipe.ts';
import { normalizeFigureLook, type FigureLook } from './model/figure-look.ts';
import { isNameAllowed } from './name-filter.ts';
import { decodeShareCode, type ShareDecodeError, type ShareKind } from './share-code.ts';
import { issue, type RecipeLimits, type ValidationIssue } from './validation.ts';

/** GDD §4.8: até 16 bots embutidos por preset. */
export const SHARE_MAX_EMBEDDED_BOTS = 16;

/**
 * O que um código colado (ou um link) virou: o bot ou o preset já validados (com o teto do aparelho, regra 19) e o
 * resumo do que mudou (os avisos do validador e os nomes que o filtro barrou: o nome barrado fica vazio e quem chama
 * dá um nome do gerador). Recusado: o motivo do código (`ShareDecodeError`), o tipo que esta tela não abre (`kind`)
 * ou o documento que não valida (`invalid`, com os problemas).
 */
export type ShareImport =
  | {
      readonly ok: true;
      readonly kind: 'bot';
      readonly bot: BotDocument;
      readonly warnings: readonly ValidationIssue[];
    }
  | {
      readonly ok: true;
      readonly kind: 'preset';
      readonly preset: MatchRecipe;
      readonly warnings: readonly ValidationIssue[];
    }
  | {
      readonly ok: false;
      readonly error: ShareDecodeError | 'kind' | 'invalid';
      readonly issues: readonly ValidationIssue[];
    };

/** O id de um bot que veio de fora tem no máximo isto (o `embedded:<id>` dos presets aponta para ele). */
export const SHARE_MAX_BOT_ID = 48;

/** O id cabe? (o `look` e o `id` passam pelo validador como vieram: o import põe os tetos). */
function botIdOk(bot: BotDocument): boolean {
  return bot.id.length <= SHARE_MAX_BOT_ID;
}

/**
 * O bot que veio de fora: o nome passa no filtro (se não, vazio, com o aviso) e o `look` vira um visual normalizado (o
 * validador deixa passar qualquer JSON nele; o que vem de um código é de estranho).
 */
function filterBot(bot: BotDocument, path: string, warnings: ValidationIssue[]): BotDocument {
  const look =
    typeof bot.look === 'object' && bot.look !== null && !Array.isArray(bot.look)
      ? normalizeFigureLook(bot.look as Partial<FigureLook>)
      : null;
  if (isNameAllowed(bot.name)) return { ...bot, look };
  warnings.push(issue(path, 'name.blocked'));
  return { ...bot, name: '', look };
}

/** M8 (fase 0): abre um código de bot ou de preset (os esquadrões e a semente têm o deles). */
export function importShareCode(text: string, limits: RecipeLimits): ShareImport {
  const decoded = decodeShareCode(text);
  if (!decoded.ok) return { ok: false, error: decoded.error, issues: [] };
  return importShareDoc(decoded.kind, decoded.doc, limits);
}

/** O mesmo, com o documento já aberto (o link e o código passam por aqui). */
export function importShareDoc(kind: ShareKind, doc: unknown, limits: RecipeLimits): ShareImport {
  if (kind === 'bot') {
    const r = validateBot(doc);
    if (!r.ok) return { ok: false, error: 'invalid', issues: r.errors };
    if (!botIdOk(r.value)) return { ok: false, error: 'invalid', issues: [issue('id', 'bot.invalidField')] };
    const warnings = [...r.warnings];
    return { ok: true, kind: 'bot', bot: filterBot(r.value, 'name', warnings), warnings };
  }
  if (kind === 'preset') {
    const embedded = (doc as { embeddedBots?: unknown } | null)?.embeddedBots;
    if (Array.isArray(embedded) && embedded.length > SHARE_MAX_EMBEDDED_BOTS) {
      const detail = `${embedded.length} > ${SHARE_MAX_EMBEDDED_BOTS}`;
      return { ok: false, error: 'invalid', issues: [issue('embeddedBots', 'recipe.tooManyBotEntries', detail)] };
    }
    const r = validateMatchRecipe(doc, limits);
    if (!r.ok) return { ok: false, error: 'invalid', issues: r.errors };
    // De novo depois da validação (uma migração futura pode mudar o campo de lugar).
    const valid = r.value.embeddedBots ?? [];
    if (valid.length > SHARE_MAX_EMBEDDED_BOTS) {
      const detail = `${valid.length} > ${SHARE_MAX_EMBEDDED_BOTS}`;
      return { ok: false, error: 'invalid', issues: [issue('embeddedBots', 'recipe.tooManyBotEntries', detail)] };
    }
    const longId = valid.findIndex((b) => !botIdOk(b));
    if (longId >= 0)
      return { ok: false, error: 'invalid', issues: [issue(`embeddedBots[${longId}].id`, 'bot.invalidField')] };
    const warnings = [...r.warnings];
    let preset: MatchRecipe = r.value;
    if (preset.name !== undefined && !isNameAllowed(preset.name)) {
      warnings.push(issue('name', 'name.blocked'));
      const { name: _name, ...rest } = preset;
      preset = rest;
    }
    const teams = preset.teams.map((t, i): TeamRecipe => {
      if (t.name === undefined || isNameAllowed(t.name)) return t;
      warnings.push(issue(`teams[${i}].name`, 'name.blocked'));
      const { name: _name, ...rest } = t;
      return rest;
    });
    const bots = preset.embeddedBots?.map((b, i) => filterBot(b, `embeddedBots[${i}].name`, warnings));
    preset = { ...preset, teams, ...(bots !== undefined ? { embeddedBots: bots } : {}) };
    return { ok: true, kind: 'preset', preset, warnings };
  }
  return { ok: false, error: 'kind', issues: [] };
}
