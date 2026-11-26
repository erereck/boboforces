import { CONTENT_IDS, DEBUT_PRESET, splitContentId, type MatchRecipe } from '@boboforces/format';
import { describe, expect, it, vi } from 'vitest';

/**
 * M10: o nome de TODO modo da lista travada (`CONTENT_IDS`) com só a tabela do menu, como na web no boot (a tabela
 * extra chega com a cena ou com as telas de edição). As chaves são montadas com o id (`mode.${recipe.mode}`,
 * `mode.short.${recipe.mode}`), então o size-check não as vê: o `#p=` de um preset do Paintball mostrava
 * "mode.paintball" na partida recebida e o JOGAR, "mode.short.paintball".
 */
describe('M10: o nome de todo modo, só com a tabela do menu', () => {
  const modes = CONTENT_IDS.flatMap((id) => {
    const split = splitContentId(id);
    return split !== null && split.kind === 'mode' ? [split.local] : [];
  });

  it('a lista de modos é a travada (o teste não passa vazio)', () => {
    expect(modes).toContain('paintball');
    expect(modes).toContain('warfare.tdm');
    expect(modes.length).toBeGreaterThanOrEqual(11);
  });

  it('o resumo do JOGAR, o atalho e as linhas da partida recebida não devolvem chave crua', async () => {
    // Uma cópia nova dos módulos: o `setupFiles` registrou a tabela extra na cópia de sempre, não nesta.
    vi.resetModules();
    const ui = await import('@boboforces/ui');
    const presets = await import('./presets-ui.ts');
    // Prova de que só a tabela do menu vale aqui: uma chave da extra volta crua.
    expect(ui.t('mode.name.paintball')).toBe('mode.name.paintball');
    const menu = ui.STRINGS_PT_BR as Readonly<Record<string, string>>;
    const missing = modes.flatMap((m) => [`mode.${m}`, `mode.short.${m}`]).filter((key) => !(key in menu));
    expect(missing).toEqual([]);
    const raw = /\bmode\.[a-z]/;
    for (const mode of modes) {
      const recipe: MatchRecipe = { ...DEBUT_PRESET, mode };
      // A partida recebida (`share.ts`): a 1ª linha é o nome do modo.
      const lines = presets.presetLines(recipe);
      expect(lines[0], mode).toBe(menu[`mode.${mode}`]);
      expect(lines.join(' | '), mode).not.toMatch(raw);
      // O resumo do JOGAR no título e o atalho da Partida Rápida: o nome curto.
      const summary = presets.presetSummary(recipe);
      expect(summary.startsWith(menu[`mode.short.${mode}`]!), `${mode}: ${summary}`).toBe(true);
      expect(summary, mode).not.toMatch(raw);
      expect(presets.presetShortcut(recipe).caption, mode).not.toMatch(raw);
    }
  });
});
