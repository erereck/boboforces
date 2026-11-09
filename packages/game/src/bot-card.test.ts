import { BUILTIN_BOTS, levelBot } from '@boboforces/format';
import { createRng } from '@boboforces/shared';
import { WEAPONS } from '@boboforces/sim';
import { describe, expect, it } from 'vitest';
import {
  botCardLines,
  botDisplayName,
  botLevelOf,
  copyName,
  isBuiltinBot,
  newBotId,
  WEAPON_CATEGORY,
} from './bot-card.ts';

/** M2, fase 5a: o card do bot na Oficina (sem a sim no pedaço do menu). */

describe('card do bot', () => {
  it('a categoria das armas é a da tabela da sim', () => {
    for (const w of WEAPONS) expect(WEAPON_CATEGORY[w.id], w.id).toBe(w.category);
    expect(Object.keys(WEAPON_CATEGORY).sort()).toEqual(WEAPONS.map((w) => w.id).sort());
  });

  it('o card mostra a habilidade, a cabeça, a mira e as regras; os de fábrica têm nome da tabela', () => {
    const jorge = BUILTIN_BOTS['jorge-the-immortal']!;
    expect(isBuiltinBot(jorge)).toBe(true);
    expect(botDisplayName(jorge)).toBe('Jorge the Immortal');
    expect(botCardLines(jorge)).toEqual([
      'Habilidade: Pela vibe',
      'Inteligência N0 · Kamikaze',
      'Reação 900 ms · erro 6° · cabeça 5%',
      'Regras: 500 de vida · só escopeta',
    ]);
    expect(botCardLines(BUILTIN_BOTS['normal-bob']!).at(-1)).toBe('Sem regra especial');
    // Uma cópia salva não é de fábrica: o nome é o dela.
    const copy = { ...jorge, id: 'abc123', name: 'Jorge 2' };
    expect(isBuiltinBot(copy)).toBe(false);
    expect(botDisplayName(copy)).toBe('Jorge 2');
    expect(botLevelOf({ ...copy, skill: { ...copy.skill, reactionMs: 333 } })).toBeNull();
    expect(botLevelOf(levelBot('sweaty'))).toBe('sweaty');
  });

  it('id novo fora dos usados e nome da cópia com número, no tamanho máximo', () => {
    const rng = createRng(7);
    const taken = new Set<string>();
    for (let i = 0; i < 50; i++) taken.add(newBotId(rng, taken));
    expect(taken.size).toBe(50);
    expect(copyName('Jorge', new Set(['Jorge 2']))).toBe('Jorge 3');
    const long = copyName('Sergeant Noodle the Great', new Set());
    expect(long.length).toBeLessThanOrEqual(24);
    expect(long.endsWith(' 2')).toBe(true);
  });
});
