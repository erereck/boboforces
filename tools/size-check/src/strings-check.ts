// M9 (fase 0, revisão): a tabela de textos do menu da web ficou só com o que o menu mostra antes de a cena ou os
// editores chegarem (e registrarem a tabela extra). Uma chave das outras tabelas escrita no JS do menu apareceria crua
// na tela (o `t()` devolve a própria chave), e só na web de produção: os testes registram todas as tabelas. Esta
// checagem procura, no JS da carga inicial, as chaves que não moram na tabela do menu; as exceções abaixo só aparecem
// depois do registro (conferidas na revisão da fase 0 do M9). Chaves montadas em pedaços (`bot.name.${id}`) escapam.
import { STRINGS_EXTRA_PT_BR, STRINGS_ONLINE_PT_BR, STRINGS_PT_BR, STRINGS_SWITCH_PT_BR } from '@boboforces/ui';

/** Chaves de fora da tabela do menu que o JS do menu pode citar (só desenhadas depois do registro da tabela extra). */
export const LATE_KEYS_ALLOWED: ReadonlySet<string> = new Set([
  // A volta do Laboratório (depois de uma partida: a cena já registrou a extra).
  'result.noAccuracy',
  'settings.percent',
  // Só na tela de teste do Switch, que registra as tabelas no boot.
  'hud.player',
  'test.status.ok',
  'test.status.fail',
  'test.status.info',
  'test.status.wait',
]);

/** As chaves das tabelas que o menu da web não tem no boot. */
export function lateKeys(): readonly string[] {
  const menu = STRINGS_PT_BR as Readonly<Record<string, string>>;
  const out: string[] = [];
  for (const table of [STRINGS_EXTRA_PT_BR, STRINGS_ONLINE_PT_BR, STRINGS_SWITCH_PT_BR]) {
    for (const key of Object.keys(table)) if (!(key in menu)) out.push(key);
  }
  return out;
}

/** As chaves "tardias" citadas literalmente (entre aspas ou crases) no JS, fora das exceções. */
export function lateKeysIn(js: string, keys: readonly string[] = lateKeys()): string[] {
  const found: string[] = [];
  for (const key of keys) {
    if (LATE_KEYS_ALLOWED.has(key)) continue;
    if (js.includes(`"${key}"`) || js.includes(`'${key}'`) || js.includes(`\`${key}\``)) found.push(key);
  }
  return found;
}
