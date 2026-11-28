import { DEBUT_PRESET, type MatchRecipe } from '@boboforces/format';
import { createRawInputState, PAD_BUTTON } from '@boboforces/input';
import { describe, expect, it } from 'vitest';
import { createCustomDraft, startButtonHeld } from './menu-memory.ts';

describe('M12 (fase 3, revisão): o rascunho da Personalizada', () => {
  const last: MatchRecipe = DEBUT_PRESET;
  const edited: MatchRecipe = { ...DEBUT_PRESET, map: 'ringue' };

  it('sem mexida, o Voltar não guarda nada (e a aba não sobra)', () => {
    const d = createCustomDraft();
    d.opened(last, 0);
    d.back(last, 0);
    expect(d.recipeOr(last)).toBe(last);
    expect(d.tab).toBe(0);
  });

  it('a receita ou a aba mexida fica; reabrir sem mexer mantém o rascunho; uma partida começada limpa', () => {
    const d = createCustomDraft();
    d.opened(last, 0);
    d.back(edited, 2);
    expect([d.recipeOr(last), d.tab]).toEqual([edited, 2]);
    // Reabre com o rascunho e volta sem mexer: ele fica.
    d.opened(d.recipeOr(last), d.tab);
    d.back(edited, 2);
    expect([d.recipeOr(last), d.tab]).toEqual([edited, 2]);
    // Só a aba mudou: também é mexida.
    const e = createCustomDraft();
    e.opened(last, 0);
    e.back(last, 3);
    expect(e.tab).toBe(3);
    d.clear();
    expect([d.recipeOr(last), d.tab]).toEqual([last, 0]);
  });
});

describe('M12 (fase 3, revisão): o +/Start que começa', () => {
  it('sem sofá, o de qualquer controle; com o sofá, só o do P1 (o teclado do P1 não tem +)', () => {
    const raw = createRawInputState();
    const pad1 = raw.gamepads[1]!;
    pad1.connected = true;
    pad1.buttons[PAD_BUTTON.start] = 1;
    expect(startButtonHeld(raw, null)).toBe(true);
    expect(startButtonHeld(raw, { kind: 'gamepad', index: 1 })).toBe(true);
    expect(startButtonHeld(raw, { kind: 'gamepad', index: 0 })).toBe(false);
    expect(startButtonHeld(raw, { kind: 'keyboardMouse' })).toBe(false);
    pad1.buttons[PAD_BUTTON.start] = 0;
    expect(startButtonHeld(raw, null)).toBe(false);
  });
});
