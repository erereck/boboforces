import { describe, expect, it } from 'vitest';
import { STRINGS_PT_BR } from '../strings.pt-BR.ts';
import { COLORS } from '../tokens.ts';
import type { UiNode } from '../tree.ts';
import { titleScreen } from './title.ts';

/**
 * M11 (fase 5, revisão): a partida que o aparelho recusa (o Royale Grande fora do PC) volta ao título com o aviso no
 * lugar do resumo do JOGAR, em destaque e na mesma linha (o título não muda de altura). O texto mora na tabela do menu.
 */
function find(node: UiNode, id: string): UiNode | null {
  if (node.id === id) return node;
  const kids = 'children' in node && node.children ? node.children : [];
  for (const k of kids) {
    const hit = find(k, id);
    if (hit) return hit;
  }
  return null;
}

describe('o aviso do título', () => {
  it('troca o resumo do JOGAR pelo aviso, em destaque; sem aviso, o resumo de sempre', () => {
    const base = { version: '0.0.1', codename: 'Teste', playSummary: 'Times · 4 contra 4 · Construto' };
    expect(find(titleScreen.build(base), 'playSummary')).toMatchObject({
      text: { literal: base.playSummary },
      color: COLORS.textoBaixo,
    });
    const note = STRINGS_PT_BR['title.pcOnly'];
    expect(note).toBe('Este modo só roda no PC.');
    expect(find(titleScreen.build({ ...base, note }), 'playSummary')).toMatchObject({
      text: { literal: note },
      color: COLORS.perigo,
    });
  });
});
