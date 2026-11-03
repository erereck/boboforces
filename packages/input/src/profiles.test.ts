import { describe, expect, it } from 'vitest';
import { GAME_ACTION_INDEX, GAME_ACTIONS, MENU_ACTIONS, confirmConventionFor } from './actions.ts';
import { key, TOUCH_CONTROLS, type BindingSource } from './bindings.ts';
import { keyIndex } from './keys.ts';
import {
  createGamepadProfile,
  createKeyboardMouseProfile,
  createTouchProfile,
  defaultProfileFor,
  profileWarnings,
} from './profiles.ts';
import { PAD_BUTTON } from './raw.ts';
import { DEFAULT_TOUCH_LAYOUT, hitTouchButton, layoutTouchButtons } from './touch.ts';

const keyOf = (s: BindingSource | undefined) => (s && s.device === 'key' ? s.key : -1);

describe('perfil de teclado e mouse', () => {
  const p = createKeyboardMouseProfile();

  it('segue a arte-ux.md §7.1', () => {
    expect(p.move.forward?.map(keyOf)).toEqual([keyIndex('KeyW')]);
    expect(p.move.left?.map(keyOf)).toEqual([keyIndex('KeyA')]);
    expect(p.game.crouch?.map(keyOf)).toEqual([keyIndex('KeyC')]);
    expect(p.game.sprint?.map(keyOf)).toContain(keyIndex('ShiftLeft'));
    expect(p.game.jump?.map(keyOf)).toEqual([keyIndex('Space')]);
    expect(p.game.reload?.map(keyOf)).toEqual([keyIndex('KeyR')]);
    expect(p.game.ads).toEqual([{ device: 'mouseButton', button: 2 }]);
    expect(p.game.slot4?.map(keyOf)).toEqual([keyIndex('Digit4')]);
  });

  it('nenhum perfil padrão liga Ctrl a nada; ligar dá aviso', () => {
    for (const d of ['keyboardMouse', 'gamepad', 'touch'] as const)
      expect(profileWarnings(defaultProfileFor(d))).toEqual([]);
    const ctrl = { ...p, game: { ...p.game, crouch: [key('ControlLeft')] } };
    expect(profileWarnings(ctrl)).toEqual([{ action: 'crouch', code: 'binding.ctrlReserved' }]);
  });

  it('pausa existe em todo perfil (regra 16: + / botão de pausa, nunca só Esc)', () => {
    expect(createGamepadProfile().game.pause).toEqual([{ device: 'padButton', button: PAD_BUTTON.start }]);
    expect(createTouchProfile().game.pause).toEqual([{ device: 'touchControl', control: 'pause' }]);
    expect(p.game.pause?.length).toBeGreaterThan(0);
  });
});

describe('perfil de controle', () => {
  it('menu completo por D-pad + confirmar/voltar (regra 12)', () => {
    for (const conv of ['bottom', 'right'] as const) {
      const g = createGamepadProfile(conv);
      for (const m of MENU_ACTIONS) expect(g.menu[m]?.length, `${conv}.${m}`).toBeGreaterThan(0);
    }
    expect(confirmConventionFor('switch')).toBe('right');
    expect(confirmConventionFor('web')).toBe('bottom');
  });

  it('todas as ações de jogo que viajam no frame têm botão no controle', () => {
    const g = createGamepadProfile();
    for (const a of GAME_ACTIONS.slice(0, GAME_ACTION_INDEX.nextWeapon))
      expect(g.game[a]?.length, a).toBeGreaterThan(0);
  });
});

describe('layout de toque (arte-ux.md §7.3)', () => {
  it('em 667×375, todo botão fica na metade direita, ≥ 24 px da borda e ≥ 12 px dos outros', () => {
    for (const pr of [1, 2, 3]) {
      const w = 667 * pr;
      const h = 375 * pr;
      const rects = layoutTouchButtons(DEFAULT_TOUCH_LAYOUT, w, h, pr);
      for (const r of rects) {
        expect(r.x - r.radius, r.control).toBeGreaterThan(w / 2);
        expect(Math.min(r.x - r.radius, w - r.x - r.radius, r.y - r.radius, h - r.y - r.radius)).toBeGreaterThanOrEqual(
          24 * pr,
        );
        expect(r.radius * 2).toBeGreaterThanOrEqual((r.control === 'pause' ? 44 : 64) * pr);
      }
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i]!;
          const b = rects[j]!;
          const gap = Math.hypot(a.x - b.x, a.y - b.y) - a.radius - b.radius;
          expect(gap, `${a.control}/${b.control}`).toBeGreaterThanOrEqual(12 * pr - 1e-9);
        }
      }
    }
  });

  it('cada controle de toque aparece uma vez e o acerto acha o botão certo', () => {
    const controls = DEFAULT_TOUCH_LAYOUT.buttons.map((b) => b.control);
    expect(new Set(controls).size).toBe(controls.length);
    expect([...controls].sort()).toEqual([...TOUCH_CONTROLS].sort());
    const rects = layoutTouchButtons(DEFAULT_TOUCH_LAYOUT, 1280, 720, 1);
    rects.forEach((r, i) => expect(hitTouchButton(DEFAULT_TOUCH_LAYOUT, r.x, r.y, 1280, 720, 1)).toBe(i));
    expect(hitTouchButton(DEFAULT_TOUCH_LAYOUT, 640, 360, 1280, 720, 1)).toBe(-1);
  });
});
