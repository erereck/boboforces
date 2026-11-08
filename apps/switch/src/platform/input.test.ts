import { PAD_AXIS, PAD_BUTTON, createRawInputState, keyIndex } from '@boboforces/input';
import { describe, expect, it } from 'vitest';
import type { ControllerInfo } from '@boboforces/platform-api';
import { createSwitchInput, gamepadKind, isCompleteController } from './input.ts';
import { NPAD_STYLE } from './nx.ts';
import { createFakeSwitch, pad } from './testing.ts';

describe('gamepadKind', () => {
  it('reconhece Pro Controller, par de Joy-Con, portátil e Joy-Con avulso (recusado pelo jogo, decisão #32)', () => {
    expect(gamepadKind(NPAD_STYLE.fullKey)).toBe('switchPro');
    expect(gamepadKind(NPAD_STYLE.joyDual)).toBe('joyConPair');
    expect(gamepadKind(NPAD_STYLE.joyDual | NPAD_STYLE.joyLeft | NPAD_STYLE.joyRight)).toBe('joyConPair');
    expect(gamepadKind(NPAD_STYLE.handheld)).toBe('handheld');
    expect(gamepadKind(NPAD_STYLE.joyLeft)).toBe('joyConSingle');
    expect(gamepadKind(NPAD_STYLE.joyRight)).toBe('joyConSingle');
    expect(gamepadKind(0)).toBe('unknown');
  });
});

describe('input do Switch', () => {
  it('copia eixos e botões por posição para o estado bruto e zera os slots vazios', () => {
    const fake = createFakeSwitch();
    fake.pads[0] = pad(0, NPAD_STYLE.fullKey, [PAD_BUTTON.faceRight, PAD_BUTTON.start]);
    fake.pads[2] = pad(2, NPAD_STYLE.joyDual);
    const input = createSwitchInput({ nx: fake.nx, onDisconnect: () => {} });
    const raw = createRawInputState();
    input.poll(raw);
    const p0 = raw.gamepads[0];
    expect(p0?.connected).toBe(true);
    expect(p0?.kind).toBe('switchPro');
    expect(p0?.buttons[PAD_BUTTON.faceRight]).toBe(1); // A do Switch (direita)
    expect(p0?.buttons[PAD_BUTTON.start]).toBe(1); // +
    expect(p0?.buttons[PAD_BUTTON.faceDown]).toBe(0);
    expect(p0?.axes[PAD_AXIS.leftX]).toBe(0.5);
    expect(p0?.axes[PAD_AXIS.rightY]).toBe(1);
    expect(raw.gamepads[1]?.connected).toBe(false);
    expect(raw.gamepads[2]?.kind).toBe('joyConPair');
    expect(raw.surfaceWidth).toBe(1280);
    expect(raw.surfaceHeight).toBe(720);
  });

  it('controle que some avisa a casca (pausa) uma vez só', () => {
    const fake = createFakeSwitch();
    const lost: number[] = [];
    const input = createSwitchInput({ nx: fake.nx, onDisconnect: (i) => lost.push(i) });
    const raw = createRawInputState();
    input.poll(raw);
    fake.pads[0] = null;
    input.poll(raw);
    input.poll(raw);
    expect(lost).toEqual([0]);
    expect(raw.gamepads[0]?.connected).toBe(false);
    expect(raw.gamepads[0]?.buttons.every((v) => v === 0)).toBe(true);
  });

  it('teclado USB entra pelo code e sai pelo dispose', () => {
    const fake = createFakeSwitch();
    const input = createSwitchInput({ nx: fake.nx, onDisconnect: () => {} });
    const raw = createRawInputState();
    fake.dispatch('keydown', { code: 'KeyW' });
    input.poll(raw);
    expect(raw.keys[keyIndex('KeyW')]).toBe(1);
    fake.dispatch('keyup', { code: 'KeyW' });
    input.poll(raw);
    expect(raw.keys[keyIndex('KeyW')]).toBe(0);
    input.dispose();
    fake.dispatch('keydown', { code: 'KeyW' });
    input.poll(raw);
    expect(raw.keys[keyIndex('KeyW')]).toBe(0);
  });
});

describe('describeControllers (item 17 do T0)', () => {
  it('descreve os conectados com styleSet, deviceType, completo e vibração, reaproveitando os objetos', () => {
    const fake = createFakeSwitch();
    fake.pads[0] = { ...pad(0, NPAD_STYLE.handheld), deviceType: 0x3 };
    fake.pads[3] = pad(3, NPAD_STYLE.joyRight);
    const input = createSwitchInput({ nx: fake.nx, onDisconnect: () => {} });
    const out: ControllerInfo[] = [];
    expect(input.describeControllers(out)).toBe(2);
    expect(out).toEqual([
      {
        index: 0,
        id: 'pad-0',
        kind: 'handheld',
        styleSet: NPAD_STYLE.handheld,
        deviceType: 3,
        complete: true,
        canVibrate: false,
      },
      {
        index: 3,
        id: 'pad-3',
        kind: 'joyConSingle',
        styleSet: NPAD_STYLE.joyRight,
        deviceType: -1,
        complete: false,
        canVibrate: false,
      },
    ]);
    const first = out[0];
    fake.pads[3] = null;
    expect(input.describeControllers(out)).toBe(1);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(first); // mesmo objeto: sem alocar por chamada
    expect(isCompleteController('joyConPair')).toBe(true);
    expect(isCompleteController('joyConSingle')).toBe(false);
  });
});
