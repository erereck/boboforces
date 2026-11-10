import { describe, expect, it } from 'vitest';
import { keyIndex } from './keys.ts';
import { createMenuInput } from './menu-input.ts';
import { createRawInputState, PAD_BUTTON } from './raw.ts';

const DT = 1 / 60;

function connect(raw: ReturnType<typeof createRawInputState>, i: number): void {
  const p = raw.gamepads[i]!;
  p.connected = true;
  p.id = `pad ${i}`;
}

describe('menus com dono (M3, fase 1b)', () => {
  it('sem dono, qualquer controle navega; com dono, só ele (e o pressedBy lê cada um)', () => {
    const raw = createRawInputState();
    connect(raw, 0);
    connect(raw, 1);
    const menu = createMenuInput('bottom');
    raw.gamepads[1]!.buttons[PAD_BUTTON.faceDown] = 1;
    menu.update(raw, DT);
    expect(menu.pressed('confirm')).toBe(true);
    expect(menu.lastGamepad).toBe(1);

    raw.gamepads[1]!.buttons[PAD_BUTTON.faceDown] = 0;
    menu.update(raw, DT);
    menu.setOwner({ kind: 'gamepad', index: 0 });
    raw.gamepads[1]!.buttons[PAD_BUTTON.dpadLeft] = 1;
    menu.update(raw, DT);
    expect(menu.pressed('left')).toBe(false);
    expect(menu.pressedBy({ kind: 'gamepad', index: 1 }, 'left')).toBe(true);
    expect(menu.pressedBy({ kind: 'gamepad', index: 0 }, 'left')).toBe(false);

    raw.gamepads[0]!.buttons[PAD_BUTTON.faceDown] = 1;
    menu.update(raw, DT);
    expect(menu.pressed('confirm')).toBe(true);
    expect(menu.lastGamepad).toBe(0);
  });

  it('o teclado como P2 não navega o menu do P1, mas o voltar dele chega pelo pressedBy', () => {
    const raw = createRawInputState();
    connect(raw, 0);
    const menu = createMenuInput('right');
    menu.setOwner({ kind: 'gamepad', index: 0 });
    raw.keys[keyIndex('Escape')] = 1;
    menu.update(raw, DT);
    expect(menu.pressed('back')).toBe(false);
    expect(menu.lastDevice).toBe(null);
    expect(menu.pressedBy({ kind: 'keyboardMouse' }, 'back')).toBe(true);
    menu.setOwner(null);
    raw.keys[keyIndex('Escape')] = 0;
    menu.update(raw, DT);
    raw.keys[keyIndex('Escape')] = 1;
    menu.update(raw, DT);
    expect(menu.pressed('back')).toBe(true);
  });
});
