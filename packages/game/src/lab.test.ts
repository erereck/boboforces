import { BOT_RANGES, BUILTIN_BOTS, levelBot } from '@boboforces/format';
import { createRng } from '@boboforces/shared';
import { describe, expect, it } from 'vitest';
import { botLevelOf, rulesText } from './bot-card.ts';
import { cleanBotName, LAB_TABS, labRows, labSummary, rollBotName, stepLab } from './lab.ts';

/** M2, fase 5b: o Laboratório (o editor de um bot, lógica pura). */

const jorge = BUILTIN_BOTS['jorge-the-immortal']!;

describe('Laboratório', () => {
  it('o nível rápido preenche habilidade e inteligência; a personalidade e as regras ficam', () => {
    const tuned = stepLab('skill', jorge, 'reaction', -1);
    expect(tuned.skill.reactionMs).toBeLessThan(jorge.skill.reactionMs);
    expect(botLevelOf(tuned)).toBeNull();
    expect(labRows('skill', tuned, true)[0]).toMatchObject({ id: 'level', value: 'ajustada' });
    // Ajustada → +1 cai no primeiro nível; daí anda.
    const vibe = stepLab('skill', tuned, 'level', 1);
    expect(botLevelOf(vibe)).toBe('vibe');
    const sweaty = stepLab('skill', stepLab('skill', stepLab('skill', vibe, 'level', 1), 'level', 1), 'level', 1);
    expect(botLevelOf(sweaty)).toBe('sweaty');
    expect(sweaty.intelligence).toEqual(levelBot('sweaty').intelligence);
    expect(sweaty.personality).toEqual(jorge.personality);
    expect(sweaty.rules).toEqual(jorge.rules);
  });

  it('inteligência: o nível liga os comportamentos dele; cada um liga e desliga depois', () => {
    const n3 = stepLab('mind', stepLab('mind', stepLab('mind', jorge, 'mindLevel', 1), 'mindLevel', 1), 'mindLevel', 1);
    expect(n3.intelligence).toMatchObject({ level: 3, useCover: true, flank: true, callouts: true, learn: false });
    const noFlank = stepLab('mind', n3, 'flank', 0);
    expect(noFlank.intelligence.flank).toBe(false);
    expect(noFlank.intelligence.level).toBe(3);
    expect(stepLab('mind', n3, 'mindLevel', 5).intelligence.level).toBe(BOT_RANGES.intelligence.max);
  });

  it('personalidade base, regras de arma e de percepção (todas à vista no card)', () => {
    const rusher = stepLab('persona', jorge, 'preset', -5);
    expect(rusher.personality.preset).not.toBe(jorge.personality.preset);
    const blind = stepLab('rules', stepLab('rules', jorge, 'vision', -1), 'knowledge', 2);
    expect(rulesText(blind.rules)).toBe('500 de vida · só escopeta · visão 90° · vê através das paredes');
    // Armas: a escolha anda pela lista (todas, uma só…).
    expect(stepLab('rules', jorge, 'weapons', 1).rules.weapons).not.toEqual(jorge.rules.weapons);
    for (const tab of LAB_TABS) expect(labRows(tab, jorge, true).length, tab).toBeGreaterThan(0);
    expect(labSummary(jorge)).toBe('Jorge the Immortal · Kamikaze · N0');
  });

  it('nome: rolar dá um nome bobo novo; o digitado fica só com o que o atlas desenha', () => {
    const rng = createRng(3);
    const taken = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const name = rollBotName(rng, taken);
      expect(name.length).toBeLessThanOrEqual(BOT_RANGES.nameMaxLength);
      expect(taken.has(name)).toBe(false);
      taken.add(name);
    }
    expect(cleanBotName('  Jorge   😀 Júnior <3 the Great and Powerful')).toBe('Jorge Júnior 3 the Great');
    expect(labRows('name', jorge, false).map((r) => r.id)).toEqual(['name', 'roll', 'noKeyboard']);
  });
});
