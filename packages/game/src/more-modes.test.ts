import { validateMatchRecipe } from '@boboforces/format';
import { describe, expect, it } from 'vitest';
import { MAP_MODES, type MenuMap } from './maps.ts';
import { MORE_MODE_CARDS, moreModePreset } from './more-modes.ts';
import { STORAGE_RECIPE_LIMITS } from './save-store.ts';

/** M7 (fase 8): cada card da página Mais modos tem uma receita válida (o BoboStrike e o Royale, no mapa deles). */
describe('os cards da página Mais modos', () => {
  it('cada receita passa no validador (o Bobo Training tem a tela dele)', () => {
    for (const card of MORE_MODE_CARDS) {
      if (card.id === 'training') continue;
      const r = moreModePreset(card.id);
      expect(r, card.id).not.toBeNull();
      const v = validateMatchRecipe(r, STORAGE_RECIPE_LIMITS);
      expect(v.ok, card.id).toBe(true);
      // Os modos de mapa próprio (os de festa jogam no Construto sem estar no meta.modes dele).
      if (r!.mode === 'strike' || r!.mode === 'royale.mini') {
        expect(MAP_MODES[r!.map as MenuMap], card.id).toContain(r!.mode);
      }
    }
  });

  it('o Bobo Royale: solo na Ilha Tropical, 24 participantes', () => {
    const r = moreModePreset('royale')!;
    expect(r.mode).toBe('royale.mini');
    expect(r.map).toBe('island');
    expect(r.royale).toEqual({ squad: 'solo' });
    expect(r.teams[0]!.bots[0]!.count + 1).toBe(24);
  });
});
