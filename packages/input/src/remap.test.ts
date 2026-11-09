import { describe, expect, it } from 'vitest';
import { key, mouse, pad, padAxis, touch, wheel } from './bindings.ts';
import { keyIndex } from './keys.ts';
import { createGamepadProfile, createKeyboardMouseProfile, createTouchProfile } from './profiles.ts';
import { createRawInputState, MOUSE_BUTTON, PAD_BUTTON } from './raw.ts';
import {
  applyBindings,
  createBindingCapture,
  decodeBinding,
  encodeBinding,
  isReservedSource,
  profileBindings,
  rebind,
  REMAP_ACTIONS,
} from './remap.ts';

/** M2 (fase 4f): remapeamento: o texto do save, a aplicação no perfil, a troca e a captura. */

describe('remapeamento', () => {
  it('cada fonte vai e volta pelo texto do save; texto estranho vira null', () => {
    const sources = [
      key('KeyQ'),
      key('Space'),
      mouse('middle'),
      wheel(1),
      wheel(-1),
      pad('faceLeft', true),
      pad('bumperRight'),
      padAxis('leftY', -1),
      touch('fire'),
    ];
    for (const s of sources) expect(decodeBinding(encodeBinding(s))).toEqual(s);
    expect(encodeBinding(key('KeyQ'))).toBe('key:KeyQ');
    expect(encodeBinding(pad('faceLeft', true))).toBe('pad:faceLeft:hold');
    for (const bad of [
      '',
      'key:Nada',
      'key:Unknown',
      'mouse:toString',
      'pad:faceDown:x',
      'axis:leftY',
      'x:y',
      'key:KeyQ:1',
    ]) {
      expect(decodeBinding(bad), bad).toBeNull();
    }
  });

  it('os botões salvos trocam a lista inteira; fonte de outro dispositivo é ignorada; o toque não muda', () => {
    const kb = createKeyboardMouseProfile();
    const p = applyBindings(kb, { jump: ['key:KeyF', 'pad:faceDown'], forward: ['key:ArrowUp'], pause: ['key:KeyJ'] });
    expect(profileBindings(p, 'jump')).toEqual([key('KeyF')]);
    expect(p.move.forward).toEqual([key('ArrowUp')]);
    // A pausa não é remapeável.
    expect(p.game.pause).toEqual(kb.game.pause);
    expect(applyBindings(kb, {})).toBe(kb);
    const t = createTouchProfile();
    expect(applyBindings(t, { fire: ['key:KeyF'] })).toBe(t);
    expect(REMAP_ACTIONS.gamepad).not.toContain('forward');
  });

  it('a fonte de outra ação troca de lugar; quem fica sem nada recebe as antigas; o save guarda só a diferença', () => {
    const kb = createKeyboardMouseProfile();
    // Q era da "Última arma": ela fica com o G antigo da granada.
    const r = rebind(kb, {}, 'grenade', key('KeyQ'));
    expect(r.swapped).toBe('lastWeapon');
    expect(r.orphaned).toBe(false);
    expect(r.bindings).toEqual({ grenade: ['key:KeyQ'], lastWeapon: ['key:KeyG'] });
    // Volta ao padrão: o save esvazia.
    const back = rebind(kb, r.bindings, 'grenade', key('KeyG'));
    expect(back.bindings).toEqual({});
    // Correr tem dois Shift: perde um e segue com o outro (sem troca).
    const s = rebind(kb, {}, 'jump', key('ShiftLeft'));
    expect(s.bindings).toEqual({ jump: ['key:ShiftLeft'], sprint: ['key:ShiftRight'] });
    // No controle, ação sem botão que pega o de outra deixa a outra sem botão.
    const gp = createGamepadProfile();
    const o = rebind(gp, {}, 'prevWeapon', pad('faceUp'));
    expect(o.swapped).toBe('nextWeapon');
    expect(o.orphaned).toBe(true);
    expect(profileBindings(applyBindings(gp, o.bindings), 'nextWeapon')).toEqual([]);
    expect(isReservedSource(kb, key('KeyP'))).toBe(true);
    expect(isReservedSource(gp, pad('start'))).toBe(true);
    expect(isReservedSource(kb, key('KeyF'))).toBe(false);
  });

  it('a captura ignora o que já estava apertado, cancela no Esc e segura o menu até tudo ser solto', () => {
    const raw = createRawInputState();
    const cap = createBindingCapture();
    const enter = keyIndex('Enter');
    raw.keys[enter] = 1;
    cap.start(raw, 'keyboardMouse');
    expect(cap.update(raw)).toBe('none');
    raw.keys[enter] = 0;
    expect(cap.update(raw)).toBe('none');
    raw.keys[enter] = 1;
    expect(cap.update(raw)).toEqual(key('Enter'));
    expect(cap.active).toBe(true);
    expect(cap.update(raw)).toBe('none');
    raw.keys[enter] = 0;
    cap.update(raw);
    expect(cap.active).toBe(false);
    // Mouse e cancelar.
    cap.start(raw, 'keyboardMouse');
    raw.mouseButtons = MOUSE_BUTTON.right;
    expect(cap.update(raw)).toEqual(mouse('right'));
    raw.mouseButtons = 0;
    cap.update(raw);
    cap.start(raw, 'keyboardMouse');
    raw.keys[keyIndex('Escape')] = 1;
    expect(cap.update(raw)).toBe('cancel');
    raw.keys[keyIndex('Escape')] = 0;
    cap.update(raw);
    // Controle: o + cancela; o botão de cima é capturado.
    const p = raw.gamepads[0]!;
    p.connected = true;
    cap.start(raw, 'gamepad');
    p.buttons[PAD_BUTTON.faceUp] = 1;
    expect(cap.update(raw)).toEqual(pad('faceUp'));
    p.buttons[PAD_BUTTON.faceUp] = 0;
    cap.update(raw);
    cap.start(raw, 'gamepad');
    p.buttons[PAD_BUTTON.start] = 1;
    expect(cap.update(raw)).toBe('cancel');
  });
});
