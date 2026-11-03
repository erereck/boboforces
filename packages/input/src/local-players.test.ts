import { describe, expect, it } from 'vitest';
import { keyIndex } from './keys.ts';
import { createLocalPlayers, MAX_LOCAL_PLAYERS } from './local-players.ts';
import { createMenuInput } from './menu-input.ts';
import { createRawInputState, PAD_AXIS, PAD_BUTTON, type RawInputState } from './raw.ts';

function connect(raw: RawInputState, index: number, id: string): void {
  raw.gamepads[index]!.connected = true;
  raw.gamepads[index]!.id = id;
}

function tapA(lp: ReturnType<typeof createLocalPlayers>, raw: RawInputState, index: number): number {
  raw.gamepads[index]!.buttons[PAD_BUTTON.faceDown] = 1;
  const joined = lp.update(raw, true);
  raw.gamepads[index]!.buttons[PAD_BUTTON.faceDown] = 0;
  lp.update(raw, true);
  return joined;
}

describe('jogadores locais (até 4)', () => {
  it('Enter entra com teclado+mouse como UM slot; cada controle é um slot', () => {
    const raw = createRawInputState();
    const lp = createLocalPlayers();
    raw.keys[keyIndex('Enter')] = 1;
    expect(lp.update(raw, true)).toBe(0);
    expect(lp.update(raw, true)).toBe(-1); // segurar não entra de novo
    raw.keys[keyIndex('Enter')] = 0;
    lp.update(raw, true);
    raw.keys[keyIndex('Space')] = 1;
    expect(lp.update(raw, true)).toBe(-1); // o teclado já joga
    expect(lp.slots[0]!.device).toEqual({ kind: 'keyboardMouse' });
    connect(raw, 2, 'pad-b');
    expect(tapA(lp, raw, 2)).toBe(1);
    expect(lp.slots[1]!.device).toEqual({ kind: 'gamepad', index: 2 });
    expect(lp.count).toBe(2);
  });

  it('não passa de 4 e não entra sem allowJoin', () => {
    const raw = createRawInputState();
    const lp = createLocalPlayers();
    for (let i = 0; i < 6; i++) connect(raw, i, `pad-${i}`);
    raw.gamepads[0]!.buttons[PAD_BUTTON.start] = 1;
    expect(lp.update(raw, false)).toBe(-1);
    raw.gamepads[0]!.buttons[PAD_BUTTON.start] = 0;
    lp.update(raw, false);
    for (let i = 0; i < 6; i++) tapA(lp, raw, i);
    expect(lp.count).toBe(MAX_LOCAL_PLAYERS);
    expect(lp.slotOf({ kind: 'gamepad', index: 4 })).toBe(-1);
  });

  it('controle desconectado reserva o slot; o mesmo controle volta ao slot mesmo em outro índice', () => {
    const raw = createRawInputState();
    const lp = createLocalPlayers();
    connect(raw, 0, 'pad-a');
    connect(raw, 1, 'pad-b');
    tapA(lp, raw, 0);
    tapA(lp, raw, 1);
    raw.gamepads[1]!.connected = false;
    lp.update(raw, false);
    expect(lp.anyDisconnected).toBe(true);
    expect(lp.slots[1]!.connected).toBe(false);
    expect(lp.count).toBe(2);
    connect(raw, 3, 'pad-b');
    expect(lp.update(raw, false)).toBe(1);
    expect(lp.slots[1]!.device).toEqual({ kind: 'gamepad', index: 3 });
    expect(lp.anyDisconnected).toBe(false);
  });

  it('outro controle apertando A assume o slot reservado', () => {
    const raw = createRawInputState();
    const lp = createLocalPlayers();
    connect(raw, 0, 'pad-a');
    tapA(lp, raw, 0);
    raw.gamepads[0]!.connected = false;
    lp.update(raw, true);
    connect(raw, 5, 'pad-novo');
    expect(tapA(lp, raw, 5)).toBe(0);
    expect(lp.slots[0]!.device).toEqual({ kind: 'gamepad', index: 5 });
    lp.leave(0);
    expect(lp.count).toBe(0);
  });

  it('toque entra como um slot', () => {
    const raw = createRawInputState();
    const lp = createLocalPlayers();
    raw.touches[0]!.active = true;
    expect(lp.update(raw, true)).toBe(0);
    expect(lp.slots[0]!.device).toEqual({ kind: 'touch' });
    lp.clear();
    expect(lp.count).toBe(0);
  });
});

describe('menu por qualquer dispositivo', () => {
  it('teclado ou qualquer controle navega e o último dispositivo é lembrado', () => {
    const raw = createRawInputState();
    const menu = createMenuInput();
    menu.update(raw, 1 / 60);
    expect(menu.lastDevice).toBeNull();
    raw.keys[keyIndex('ArrowDown')] = 1;
    menu.update(raw, 1 / 60);
    expect(menu.pressed('down')).toBe(true);
    expect(menu.lastDevice).toBe('keyboardMouse');
    raw.keys[keyIndex('ArrowDown')] = 0;
    connect(raw, 6, 'pad');
    raw.gamepads[6]!.axes[PAD_AXIS.leftY] = -1;
    menu.update(raw, 1 / 60);
    expect(menu.pressed('up')).toBe(true);
    expect(menu.pressed('down')).toBe(false);
    expect(menu.lastDevice).toBe('gamepad');
    expect(menu.lastGamepad).toBe(6);
  });

  it('convenção do Switch: o botão da direita confirma', () => {
    const raw = createRawInputState();
    const menu = createMenuInput('right');
    connect(raw, 0, 'pad');
    raw.gamepads[0]!.buttons[PAD_BUTTON.faceRight] = 1;
    menu.update(raw, 1 / 60);
    expect(menu.pressed('confirm')).toBe(true);
    expect(menu.pressed('back')).toBe(false);
  });
});
