import { validateMatchRecipe } from '@boboforces/format';
import type { UiNode } from '@boboforces/ui';
import { describe, expect, it } from 'vitest';
import { MAP_MODES, type MenuMap } from './maps.ts';
import { MORE_MODE_CARDS, MORE_WATCH_ACTION, moreModePreset, moreModesRoot } from './more-modes.ts';
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

  it('M10 (fase 4): o Bobo Chaos nos Times da Estação Lunar, com a Roleta', () => {
    const r = moreModePreset('chaos')!;
    expect(r.map).toBe('moonbase');
    expect(r.chaos).toEqual({});
    expect(MAP_MODES[r.map as MenuMap]).toContain(r.mode);
  });

  it('o Bobo Royale: solo na Ilha Tropical, 24 participantes', () => {
    const r = moreModePreset('royale')!;
    expect(r.mode).toBe('royale.mini');
    expect(r.map).toBe('island');
    expect(r.royale).toEqual({ squad: 'solo' });
    expect(r.teams[0]!.bots[0]!.count + 1).toBe(24);
  });
});

describe('M7 (fase 9): o Aquário na página Mais modos', () => {
  const button = (node: UiNode, id: string): UiNode | null => {
    if (node.id === id) return node;
    const kids = 'children' in node && node.children ? node.children : [];
    for (const k of kids) {
      const hit = button(k, id);
      if (hit) return hit;
    }
    return null;
  };

  it('o botão na linha do título liga e desliga (o ligado em destaque)', () => {
    expect(button(moreModesRoot(false), 'watch')).toMatchObject({
      action: MORE_WATCH_ACTION,
      variant: 'secondary',
      text: { key: 'modes.watch.off' },
    });
    expect(button(moreModesRoot(true), 'watch')).toMatchObject({ variant: 'primary', text: { key: 'modes.watch.on' } });
    // Os 12 cards continuam lá.
    expect(button(moreModesRoot(true), 'mode:royale')).not.toBeNull();
  });
});
