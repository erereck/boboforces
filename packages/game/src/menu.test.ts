import { createRawInputState, type MenuInput } from '@boboforces/input';
import { titleScreen, uiScale } from '@boboforces/ui';
import { describe, expect, it } from 'vitest';
import { createMenuController, type UiFrame } from './menu.ts';

function frame(width: number, height: number, userScale = 1): UiFrame {
  return { width, height, scale: uiScale(width, height, userScale), userScale, options: {}, revision: 1 };
}

const IDLE = { pressed: () => false } as unknown as MenuInput;

describe('menu', () => {
  it('aplica a escala da referência uma vez só (celular em paisagem, 667×375)', () => {
    const menu = createMenuController();
    menu.setRoot(titleScreen.build({ version: '0.0.1', codename: 'teste' }));
    const ui = frame(667, 375);
    menu.update(IDLE, createRawInputState(), ui);
    expect(menu.layout?.scale).toBeCloseTo(ui.scale, 6);
  });

  it('o tamanho escolhido pelo jogador multiplica a escala', () => {
    const menu = createMenuController();
    menu.setRoot(titleScreen.build({ version: '0.0.1', codename: 'teste' }));
    const ui = frame(1280, 720, 1.25);
    menu.update(IDLE, createRawInputState(), ui);
    expect(menu.layout?.scale).toBeCloseTo(1.25, 6);
  });
});
