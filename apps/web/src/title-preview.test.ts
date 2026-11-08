import type { Platform } from '@boboforces/platform-api';
import { describe, expect, it } from 'vitest';
// Só no teste: a lista de verdade do Switch, para a prévia não se descolar dela.
import { createSwitchTestItems } from '../../switch/src/t0/items.ts';
import {
  asSwitchTitlePlatform,
  SWITCH_PREVIEW_FEATURES,
  SWITCH_TITLE_ITEMS,
  urlAsksForSwitchTitle,
} from './title-preview.ts';

describe('prévia do título do Switch', () => {
  it('só com `titulo=switch` na URL (com ou sem `?`, qualquer caixa)', () => {
    expect(urlAsksForSwitchTitle('?titulo=switch')).toBe(true);
    expect(urlAsksForSwitchTitle('titulo=Switch&x=1')).toBe(true);
    expect(urlAsksForSwitchTitle('?bench&titulo=switch')).toBe(true);
    expect(urlAsksForSwitchTitle('')).toBe(false);
    expect(urlAsksForSwitchTitle('?titulo')).toBe(false);
    expect(urlAsksForSwitchTitle('?titulo=web')).toBe(false);
    expect(urlAsksForSwitchTitle('?bench')).toBe(false);
  });

  it('os mesmos 9 itens do Switch, na mesma ordem e com os mesmos rótulos, sem fazer nada', () => {
    const real = createSwitchTestItems().map((item) => ({ id: item.id, labelKey: item.labelKey }));
    expect(SWITCH_TITLE_ITEMS.map((item) => ({ id: item.id, labelKey: item.labelKey }))).toEqual(real);
    expect(SWITCH_TITLE_ITEMS.length).toBe(9);
    for (const item of SWITCH_TITLE_ITEMS) {
      expect(item.bench, item.id).toBeUndefined();
      expect(item.start, item.id).toBeUndefined();
    }
  });

  it('a plataforma ganha a cara do Switch e o resto continua o da web', () => {
    const graphics = {} as Platform['graphics'];
    const web = {
      id: 'web',
      features: { profileHint: 'pc', touch: false, keyboardMouse: true, reducedMotion: false, canExit: false },
      graphics,
      online: null,
    } as unknown as Platform;
    const preview = asSwitchTitlePlatform(web);
    expect(preview.id).toBe('switch');
    expect(preview.features).toEqual(SWITCH_PREVIEW_FEATURES);
    expect(preview.features.canExit).toBe(true);
    expect(preview.graphics).toBe(graphics);
    expect(web.id).toBe('web');
    expect(web.features.canExit).toBe(false);
  });
});
