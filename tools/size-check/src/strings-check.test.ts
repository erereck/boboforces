import { describe, expect, it } from 'vitest';
import { LATE_KEYS_ALLOWED, lateKeys, lateKeysIn } from './strings-check.ts';

describe('chaves de texto tardias no JS do menu (M9, fase 0)', () => {
  it('acha a chave da tabela extra citada no JS, em aspas simples, duplas ou crase', () => {
    expect(lateKeys()).toContain('hud.ammo');
    expect(lateKeysIn('a="hud.ammo";', ['hud.ammo'])).toEqual(['hud.ammo']);
    expect(lateKeysIn("t('hud.ammo')", ['hud.ammo'])).toEqual(['hud.ammo']);
    expect(lateKeysIn('t(`hud.ammo`)', ['hud.ammo'])).toEqual(['hud.ammo']);
    // Pedaço de outra chave não conta.
    expect(lateKeysIn('"hud.ammo.max"', ['hud.ammo'])).toEqual([]);
  });

  it('as exceções existem numa tabela tardia e não acusam', () => {
    const late = new Set(lateKeys());
    for (const key of LATE_KEYS_ALLOWED) {
      expect(late.has(key), key).toBe(true);
      expect(lateKeysIn(`"${key}"`)).toEqual([]);
    }
  });
});
