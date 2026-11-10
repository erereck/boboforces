import { describe, expect, it } from 'vitest';
import type { UiNode } from '../tree.ts';
import { couchScreen, type CouchState } from './couch.ts';

function find(node: UiNode, id: string): UiNode | null {
  if (node.id === id) return node;
  const children = 'children' in node ? (node.children ?? []) : [];
  for (const c of children) {
    const hit = find(c, id);
    if (hit) return hit;
  }
  return null;
}

function keyOf(node: UiNode | null): string | null {
  if (node === null || node.kind !== 'text' || !('key' in node.text)) return null;
  return node.text.key;
}

describe('tela do sofá (M3, fase 1b)', () => {
  const state: CouchState = {
    seats: [
      { device: 'Teclado e mouse', side: null, disconnected: false },
      { device: 'Controle 2', side: 1, disconnected: false },
      { device: null, side: null, disconnected: false },
      { device: 'Controle 4', side: 0, disconnected: true },
    ],
    match: 'Times · Normal · 6 contra 6 · Construto',
    keyboardFree: false,
  };
  const root = couchScreen.build(state);

  it('um cartão por assento, com símbolo e cor do jogador', () => {
    for (let k = 0; k < 4; k++) {
      const icon = find(root, `seat${k}Icon`);
      expect(icon?.kind === 'box' ? icon.icon : -1).toBe(k);
    }
  });

  it('o P1 escolhe a partida; os outros mostram o lado, a ajuda ou o aviso de controle desconectado', () => {
    expect(keyOf(find(root, 'seat0Role'))).toBe('couch.p1');
    expect(keyOf(find(root, 'seat1Side'))).toBe('couch.side.against');
    expect(keyOf(find(root, 'seat1HintSide'))).toBe('couch.hint.side');
    expect(keyOf(find(root, 'seat2Join'))).toBe('couch.join');
    // Com o teclado já num assento, o vago não lembra do Enter.
    expect(find(root, 'seat2Keys')).toBeNull();
    expect(keyOf(find(root, 'seat3Lost'))).toBe('couch.disconnected');
  });

  it('o Começar abre com o foco; a partida é uma linha de opção', () => {
    const start = find(root, 'start');
    expect(start?.kind === 'button' && start.autofocus).toBe(true);
    const match = find(root, 'match');
    expect(match?.kind === 'button' && match.value !== undefined).toBe(true);
  });
});
