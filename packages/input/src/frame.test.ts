import { BitReader, BitWriter, pitchToI16, yawToU16 } from '@boboforces/shared';
import { describe, expect, it } from 'vitest';
import { BUTTON, FRAME_BUTTON_BITS, FRAME_BUTTONS, GAME_ACTIONS } from './actions.ts';
import {
  createInputFrame,
  dequantizeAxis,
  hasButton,
  INPUT_FRAME_BITS,
  quantizeAxis,
  readInputFrame,
  writeInputFrame,
} from './frame.ts';
import { KEY_COUNT, keyIndex } from './keys.ts';
import { createRawInputState, MAX_GAMEPADS } from './raw.ts';

describe('InputFrame', () => {
  it('serializa em 12 bytes, ida e volta', () => {
    const f = createInputFrame();
    f.seq = 65535;
    f.buttons = BUTTON.fire | BUTTON.jump | BUTTON.emote;
    f.moveX = -127;
    f.moveY = 127;
    f.yaw = yawToU16(1.25);
    f.pitch = pitchToI16(-0.7);
    f.weapon = 3;
    f.primary = 6;
    const w = new BitWriter(16);
    writeInputFrame(w, f);
    expect(w.bitLength).toBe(INPUT_FRAME_BITS);
    expect(w.byteLength).toBe(12);
    const back = readInputFrame(new BitReader(w.bytes()), createInputFrame());
    expect(back).toEqual(f);
    expect(hasButton(back, BUTTON.jump)).toBe(true);
    expect(hasButton(back, BUTTON.ads)).toBe(false);
  });

  it('quantiza eixos em i8', () => {
    expect(quantizeAxis(1)).toBe(127);
    expect(quantizeAxis(-2)).toBe(-127);
    expect(quantizeAxis(0)).toBe(0);
    expect(dequantizeAxis(quantizeAxis(0.5))).toBeCloseTo(0.5, 2);
  });

  it('bits dos botões são únicos e cabem no fio', () => {
    const bits = FRAME_BUTTONS.map((b) => BUTTON[b]);
    expect(new Set(bits).size).toBe(bits.length);
    for (const bit of bits) expect(bit).toBeLessThan(2 ** FRAME_BUTTON_BITS);
    expect(GAME_ACTIONS).toContain('pause');
  });
});

describe('estado bruto', () => {
  it('é pré-alocado e mapeia KeyboardEvent.code', () => {
    const raw = createRawInputState();
    expect(raw.keys.length).toBe(KEY_COUNT);
    expect(raw.gamepads.length).toBe(MAX_GAMEPADS);
    expect(keyIndex('KeyC')).toBeGreaterThan(0);
    expect(keyIndex('NaoExiste')).toBe(0);
  });
});
