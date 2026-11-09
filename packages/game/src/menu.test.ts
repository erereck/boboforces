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

describe('menu: peças da fase 4a', () => {
  const press = (action: string): MenuInput => ({ pressed: (a: string) => a === action }) as unknown as MenuInput;
  const items = Array.from({ length: 20 }, (_, i) => ({
    kind: 'button' as const,
    id: `i${i}`,
    text: { literal: `item ${i}` },
    action: `act:${i}`,
    width: 400,
    height: 60,
  }));

  it('abas pedem a troca; a coluna com rolagem acompanha o foco descendo pelo D-pad', () => {
    const menu = createMenuController();
    menu.setRoot({
      kind: 'box',
      children: [{ kind: 'column', id: 'lista', scroll: true, height: 400, gap: 10, children: items }],
    });
    const ui = frame(1280, 720);
    const raw = createRawInputState();
    expect(menu.update(press('tabNext'), raw, ui).tab).toBe(1);
    for (let i = 0; i < 12; i++) menu.update(press('down'), raw, ui);
    expect(menu.focusedId).toBe('i12');
    menu.update(IDLE, raw, ui);
    const l = menu.layout!;
    const win = l.scrolls[0]!.rect;
    const r = l.rects.get(l.byId.get('i12')!)!;
    expect(r.y).toBeGreaterThanOrEqual(win.y);
    expect(r.y + r.h).toBeLessThanOrEqual(win.y + win.h);
  });

  it('o clique na seta de uma linha de opção muda o valor (delta), no rótulo só confirma', () => {
    const menu = createMenuController();
    menu.setRoot({
      kind: 'box',
      children: [
        {
          kind: 'button',
          id: 'nivel',
          text: { literal: 'Nível' },
          action: 'nivel',
          value: { literal: 'Normal' },
          width: 640,
        },
      ],
    });
    const ui = frame(1280, 720);
    const raw = createRawInputState();
    menu.update(IDLE, raw, ui);
    const l = menu.layout!;
    const r = l.rects.get(l.byId.get('nivel')!)!;
    const click = (x: number): { activated: string | null; delta: number } => {
      raw.pointerInside = true;
      raw.pointerX = x;
      raw.pointerY = r.y + r.h / 2;
      raw.mouseButtons = 1;
      menu.update(IDLE, raw, ui);
      raw.mouseButtons = 0;
      const nav = menu.update(IDLE, raw, ui);
      return { activated: nav.activated, delta: nav.delta };
    };
    expect(click(r.x + r.w - 20)).toEqual({ activated: 'nivel', delta: 1 });
    expect(click(r.x + 20)).toEqual({ activated: 'nivel', delta: 0 });
  });
});
