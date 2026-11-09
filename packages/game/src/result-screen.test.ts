import { COLORS, type ButtonNode, type UiNode } from '@boboforces/ui';
import { describe, expect, it } from 'vitest';
import { RESULT_ACTION, resultScreen, type ResultScreenData } from './result-screen.ts';

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
