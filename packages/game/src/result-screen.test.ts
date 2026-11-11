import { COLORS, type ButtonNode, type UiNode } from '@boboforces/ui';
import { describe, expect, it } from 'vitest';
import { RESULT_ACTION, resultScreen, zombiesResultScreen, type ResultScreenData } from './result-screen.ts';

/** M2, fase 5e: os botões do resultado que levam ao Laboratório. */

const base: ResultScreenData = {
  title: 'Derrota',
  titleColor: COLORS.perigo,
  own: 10,
  other: 30,
  mvp: 'Tryhard Bob',
  nemesis: 'Tryhard Bob',
  nemesisKills: 5,
  victim: '',
  victimKills: 0,
  kills: 3,
  accuracy: '20%',
  bestStreak: 1,
  prizes: [],
  level: 'Tryhard',
  canEasier: true,
  canHarder: false,
  focusEasier: true,
};

function find(node: UiNode, id: string): ButtonNode | null {
  if (node.id === id && node.kind === 'button') return node;
  const kids = 'children' in node && node.children ? node.children : [];
  for (const k of kids) {
    const hit = find(k, id);
    if (hit) return hit;
  }
  return null;
}

describe('resultado: pontes do Laboratório', () => {
  it('no Tryhard, "Mais difícil" vira "Abrir Laboratório"; o Nêmesis salva uma vez', () => {
    const plain = resultScreen.build(base);
    expect(find(plain, 'harder')).toMatchObject({ action: RESULT_ACTION.harder, disabled: true });
    expect(find(plain, 'saveWorkshop')).toMatchObject({ disabled: false, text: { key: 'result.saveWorkshop' } });
    const tryhard = resultScreen.build({ ...base, openLab: true, nemesisSaved: true });
    expect(find(tryhard, 'harder')).toMatchObject({ action: RESULT_ACTION.lab, text: { key: 'result.openLab' } });
    expect(find(tryhard, 'harder')!.disabled).toBeFalsy();
    expect(find(tryhard, 'saveWorkshop')).toMatchObject({ disabled: true, text: { key: 'result.nemesisSaved' } });
  });
});

describe('M3 (fase 6a): resultado do Bobo Zombies', () => {
  it('tabela por bobo, sem Nêmesis nem nível; o preset salva uma vez', () => {
    const data = {
      title: 'Caíram na onda 7',
      titleColor: COLORS.perigo,
      config: 'Base Abandonada · 10 ondas · 2 jogadores',
      record: 'Novo recorde! Antes: onda 5',
      newRecord: true,
      rows: [
        { name: 'P1', color: COLORS.acao, points: 4210, kills: 38, headKills: 12, downs: 1, revives: 2 },
        { name: 'P2', color: COLORS.texto, points: 3100, kills: 30, headKills: 5, downs: 2, revives: 1 },
      ],
    };
    const root = zombiesResultScreen.build(data);
    const text = JSON.stringify(root);
    expect(text).toContain('4210');
    expect(text).toContain('Levantou');
    expect(find(root, 'saveWorkshop')).toBeNull();
    expect(find(root, 'harder')).toBeNull();
    expect(find(root, 'again')).toMatchObject({ action: RESULT_ACTION.again, autofocus: true });
    expect(find(root, 'changeRules')).toMatchObject({ action: RESULT_ACTION.changeRules });
    const saved = zombiesResultScreen.build({ ...data, presetSaved: true });
    expect(find(saved, 'savePreset')).toMatchObject({ disabled: true, text: { key: 'result.presetSaved' } });
  });
});
