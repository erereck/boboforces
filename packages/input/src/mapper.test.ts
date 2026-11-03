import { BitWriter, i16ToPitch, u16ToYaw } from '@boboforces/shared';
import { describe, expect, it } from 'vitest';
import { BUTTON } from './actions.ts';
import { createInputFrame, writeInputFrame, type InputFrame } from './frame.ts';
import { keyIndex, type KeyCode } from './keys.ts';
import { createInputMapper, MAX_PITCH, MENU_REPEAT_DELAY_S, MENU_REPEAT_INTERVAL_S } from './mapper.ts';
import {
  createGamepadProfile,
  createKeyboardMouseProfile,
  createTouchProfile,
  type ControlProfile,
} from './profiles.ts';
import { createRawInputState, MOUSE_BUTTON, PAD_AXIS, PAD_BUTTON, type RawInputState } from './raw.ts';

const DT = 1 / 60;

function kbm(profile: ControlProfile = createKeyboardMouseProfile()) {
  return createInputMapper({ kind: 'keyboardMouse' }, profile);
}

function press(raw: RawInputState, ...codes: KeyCode[]): void {
  for (const c of codes) raw.keys[keyIndex(c)] = 1;
}

function release(raw: RawInputState, ...codes: KeyCode[]): void {
  for (const c of codes) raw.keys[keyIndex(c)] = 0;
}

function frameOf(m: ReturnType<typeof kbm>, seq = 0): InputFrame {
  const f = createInputFrame();
  m.writeFrame(f, seq);
  return f;
}

describe('teclado e mouse', () => {
  it('WASD vira movimento quantizado em i8, diagonal normalizada', () => {
    const raw = createRawInputState();
    const m = kbm();
    press(raw, 'KeyW');
    m.update(raw, DT);
    expect(frameOf(m)).toMatchObject({ moveX: 0, moveY: 127 });
    press(raw, 'KeyD');
    m.update(raw, DT);
    // 1/√2 · 127 = 89,8 → 90: andar na diagonal não é mais rápido.
    expect(frameOf(m)).toMatchObject({ moveX: 90, moveY: 90 });
    press(raw, 'KeyA');
    m.update(raw, DT);
    expect(frameOf(m)).toMatchObject({ moveX: 0, moveY: 127 });
    release(raw, 'KeyW', 'KeyD', 'KeyA');
    press(raw, 'KeyS');
    m.update(raw, DT);
    expect(frameOf(m)).toMatchObject({ moveX: 0, moveY: -127 });
  });

  it('botões do frame: clique esquerdo atira, direito mira, Shift corre, C agacha', () => {
    const raw = createRawInputState();
    const m = kbm();
    raw.mouseButtons = MOUSE_BUTTON.left | MOUSE_BUTTON.right;
    press(raw, 'ShiftLeft', 'KeyC', 'Space', 'KeyR');
    m.update(raw, DT);
    const f = frameOf(m);
    expect(f.buttons).toBe(BUTTON.fire | BUTTON.ads | BUTTON.sprint | BUTTON.crouch | BUTTON.jump | BUTTON.reload);
    expect(m.isDown('crouch')).toBe(true);
    expect(m.wasPressed('jump')).toBe(true);
    m.update(raw, DT);
    expect(m.wasPressed('jump')).toBe(false);
    expect(m.isDown('jump')).toBe(true);
  });

  it('Ctrl NUNCA agacha (nem nada) no perfil padrão', () => {
    const raw = createRawInputState();
    const m = kbm();
    press(raw, 'ControlLeft', 'ControlRight');
    m.update(raw, DT);
    expect(frameOf(m).buttons).toBe(0);
    expect(m.isDown('crouch')).toBe(false);
  });

  it('toque rápido entre dois ticks não se perde (latch até o próximo writeFrame)', () => {
    const raw = createRawInputState();
    const m = kbm();
    press(raw, 'Space');
    m.update(raw, DT / 3);
    release(raw, 'Space');
    m.update(raw, DT / 3);
    const f = frameOf(m, 1);
    expect(f.buttons & BUTTON.jump).toBe(BUTTON.jump);
    expect(frameOf(m, 2).buttons & BUTTON.jump).toBe(0);
  });

  it('mouse gira a câmera só com pointer lock; yaw positivo é para a esquerda', () => {
    const raw = createRawInputState();
    const m = kbm();
    raw.mouseDX = 100;
    raw.mouseDY = -50;
    m.update(raw, DT);
    expect(m.yaw).toBe(0);
    raw.pointerLocked = true;
    m.update(raw, DT);
    const sens = createKeyboardMouseProfile().lookSensitivity;
    expect(m.yaw).toBeCloseTo(-100 * sens, 9);
    expect(m.pitch).toBeCloseTo(50 * sens, 9);
  });

  it('Y invertido, multiplicador do ADS e aimScale da assistência', () => {
    const raw = createRawInputState();
    raw.pointerLocked = true;
    raw.mouseDY = 10;
    const sens = createKeyboardMouseProfile().lookSensitivity;
    const inv = kbm({ ...createKeyboardMouseProfile(), invertY: true });
    inv.update(raw, DT);
    expect(inv.pitch).toBeCloseTo(10 * sens, 9);

    const ads = kbm();
    raw.mouseDY = 0;
    raw.mouseDX = 10;
    raw.mouseButtons = MOUSE_BUTTON.right;
    ads.update(raw, DT, 0.5);
    expect(ads.yaw).toBeCloseTo(-10 * sens * 0.7 * 0.5, 9);
  });

  it('pitch para no limite e yaw dá a volta', () => {
    const raw = createRawInputState();
    raw.pointerLocked = true;
    const m = kbm();
    raw.mouseDY = -1e6;
    m.update(raw, DT);
    expect(m.pitch).toBe(MAX_PITCH);
    m.setAngles(3.1, 0);
    raw.mouseDY = 0;
    raw.mouseDX = -100;
    m.update(raw, DT);
    expect(m.yaw).toBeLessThan(-3);
    const f = frameOf(m);
    expect(u16ToYaw(f.yaw)).toBeCloseTo(m.yaw + 2 * Math.PI, 3);
    expect(i16ToPitch(f.pitch)).toBeCloseTo(0, 6);
  });

  it('armas: 1-4 absolutas, roda cicla (um passo por frame), Q volta para a anterior', () => {
    const raw = createRawInputState();
    const m = kbm();
    press(raw, 'Digit3');
    m.update(raw, DT);
    expect(m.weapon).toBe(2);
    release(raw, 'Digit3');
    raw.wheel = 1;
    m.update(raw, DT);
    expect(m.weapon).toBe(3);
    m.update(raw, DT);
    expect(m.weapon).toBe(0);
    raw.wheel = -1;
    m.update(raw, DT);
    expect(m.weapon).toBe(3);
    raw.wheel = 0;
    press(raw, 'KeyQ');
    m.update(raw, DT);
    expect(m.weapon).toBe(0);
    m.update(raw, DT);
    expect(m.weapon).toBe(0);
    m.setWeapon(1);
    expect(frameOf(m).weapon).toBe(1);
  });

  it('alternância de agachar e de mirar', () => {
    const raw = createRawInputState();
    const m = kbm({ ...createKeyboardMouseProfile(), toggleCrouch: true });
    press(raw, 'KeyC');
    m.update(raw, DT);
    release(raw, 'KeyC');
    m.update(raw, DT);
    expect(m.isDown('crouch')).toBe(true);
    press(raw, 'KeyC');
    m.update(raw, DT);
    expect(m.isDown('crouch')).toBe(false);
  });

  it('menu: setas e Enter, com auto-repetição só nas direções', () => {
    const raw = createRawInputState();
    const m = kbm();
    press(raw, 'ArrowDown', 'Enter');
    m.update(raw, DT);
    expect(m.menuPressed('down')).toBe(true);
    expect(m.menuPressed('confirm')).toBe(true);
    let downs = 0;
    let confirms = 0;
    const frames = Math.round((MENU_REPEAT_DELAY_S + 3 * MENU_REPEAT_INTERVAL_S) / DT) + 1;
    for (let i = 0; i < frames; i++) {
      m.update(raw, DT);
      if (m.menuPressed('down')) downs++;
      if (m.menuPressed('confirm')) confirms++;
    }
    expect(downs).toBe(4);
    expect(confirms).toBe(0);
  });

  it('detecta atividade (tela "aperte Enter")', () => {
    const raw = createRawInputState();
    const m = kbm();
    m.update(raw, DT);
    expect(m.active).toBe(false);
    press(raw, 'KeyK');
    m.update(raw, DT);
    expect(m.active).toBe(true);
  });
});

describe('controle', () => {
  function pad(profile: ControlProfile = createGamepadProfile()) {
    return createInputMapper({ kind: 'gamepad', index: 1 }, profile);
  }

  function rawWithPad(): RawInputState {
    const raw = createRawInputState();
    raw.gamepads[1]!.connected = true;
    raw.gamepads[1]!.id = 'controle sintético';
    return raw;
  }

  it('lê só o controle do slot; desconectado não age', () => {
    const raw = createRawInputState();
    raw.gamepads[0]!.connected = true;
    raw.gamepads[0]!.buttons[PAD_BUTTON.faceDown] = 1;
    const m = pad();
    m.update(raw, DT);
    expect(m.connected).toBe(false);
    expect(m.isDown('jump')).toBe(false);
    raw.gamepads[1]!.connected = true;
    raw.gamepads[1]!.buttons[PAD_BUTTON.faceDown] = 1;
    m.update(raw, DT);
    expect(m.connected).toBe(true);
    expect(m.isDown('jump')).toBe(true);
  });

  it('zona morta radial e movimento linear depois dela; stick para cima = frente', () => {
    const raw = rawWithPad();
    const m = pad();
    raw.gamepads[1]!.axes[PAD_AXIS.leftX] = 0.1;
    raw.gamepads[1]!.axes[PAD_AXIS.leftY] = -0.1;
    m.update(raw, DT);
    expect(frameOf(m)).toMatchObject({ moveX: 0, moveY: 0 });
    raw.gamepads[1]!.axes[PAD_AXIS.leftX] = 0;
    raw.gamepads[1]!.axes[PAD_AXIS.leftY] = -1;
    m.update(raw, DT);
    expect(frameOf(m)).toMatchObject({ moveX: 0, moveY: 127 });
    raw.gamepads[1]!.axes[PAD_AXIS.leftY] = -0.55; // meio da faixa útil (0,15..0,95)
    m.update(raw, DT);
    expect(frameOf(m).moveY).toBe(64);
  });

  it('mira: curva ~2 e aceleração na borda depois de 0,3 s', () => {
    const raw = rawWithPad();
    const p = createGamepadProfile();
    const half = pad();
    raw.gamepads[1]!.axes[PAD_AXIS.rightX] = 0.55;
    half.update(raw, 1);
    expect(half.yaw).toBeCloseTo(-p.lookSensitivity * 0.25, 6);

    const edge = pad();
    raw.gamepads[1]!.axes[PAD_AXIS.rightX] = 1;
    const rates: number[] = [];
    let last = 0;
    for (let i = 0; i < 60; i++) {
      edge.update(raw, DT);
      rates.push((last - edge.yaw) / DT);
      last = edge.yaw;
    }
    expect(rates[5]).toBeCloseTo(p.lookSensitivity, 6);
    expect(rates[59]).toBeCloseTo(p.lookSensitivity * p.edgeAccelMul, 6);
  });

  it('gatilho analógico vale como botão a partir do limiar', () => {
    const raw = rawWithPad();
    const m = pad();
    raw.gamepads[1]!.buttons[PAD_BUTTON.triggerRight] = 0.3;
    m.update(raw, DT);
    expect(m.isDown('fire')).toBe(false);
    raw.gamepads[1]!.buttons[PAD_BUTTON.triggerRight] = 0.6;
    m.update(raw, DT);
    expect(frameOf(m).buttons & BUTTON.fire).toBe(BUTTON.fire);
  });

  it('botão da esquerda recarrega no toque e interage segurando', () => {
    const raw = rawWithPad();
    const m = pad();
    raw.gamepads[1]!.buttons[PAD_BUTTON.faceLeft] = 1;
    m.update(raw, DT);
    expect(m.isDown('reload')).toBe(true);
    expect(m.isDown('use')).toBe(false);
    for (let i = 0; i < 20; i++) m.update(raw, DT);
    expect(m.isDown('use')).toBe(true);
  });

  it('confirmar/voltar seguem a convenção (baixo na web, direita no Switch); pular é sempre o de baixo', () => {
    const raw = rawWithPad();
    raw.gamepads[1]!.buttons[PAD_BUTTON.faceDown] = 1;
    const web = pad(createGamepadProfile('bottom'));
    const sw = pad(createGamepadProfile('right'));
    web.update(raw, DT);
    sw.update(raw, DT);
    expect(web.menuPressed('confirm')).toBe(true);
    expect(sw.menuPressed('back')).toBe(true);
    expect(sw.menuPressed('confirm')).toBe(false);
    expect(web.isDown('jump') && sw.isDown('jump')).toBe(true);
  });

  it('D-pad e analógico esquerdo navegam o menu', () => {
    const raw = rawWithPad();
    const m = pad();
    raw.gamepads[1]!.axes[PAD_AXIS.leftX] = 0.9;
    m.update(raw, DT);
    expect(m.menuPressed('right')).toBe(true);
    raw.gamepads[1]!.axes[PAD_AXIS.leftX] = 0;
    raw.gamepads[1]!.buttons[PAD_BUTTON.dpadUp] = 1;
    m.update(raw, DT);
    expect(m.menuPressed('up')).toBe(true);
    expect(m.menuPressed('right')).toBe(false);
  });
});

describe('toque', () => {
  function touchRaw(): RawInputState {
    const raw = createRawInputState();
    raw.surfaceWidth = 1334;
    raw.surfaceHeight = 750;
    raw.pixelRatio = 2;
    return raw;
  }

  function finger(raw: RawInputState, slot: number, id: number, x: number, y: number, startX = x, startY = y): void {
    Object.assign(raw.touches[slot]!, { active: true, id, x, y, startX, startY });
  }

  it('joystick nasce onde o dedo encosta na metade esquerda', () => {
    const raw = touchRaw();
    const m = createInputMapper({ kind: 'touch' }, createTouchProfile());
    finger(raw, 0, 7, 300, 500);
    m.update(raw, DT);
    expect(m.touchJoystick).toMatchObject({ active: true, baseX: 300, baseY: 500 });
    expect(frameOf(m)).toMatchObject({ moveX: 0, moveY: 0 });
    // Raio 60 px de layout × DPR 2 = 120 px reais: arrastar 120 para cima = frente total.
    finger(raw, 0, 7, 300, 380, 300, 500);
    m.update(raw, DT);
    expect(frameOf(m)).toMatchObject({ moveX: 0, moveY: 127 });
    finger(raw, 0, 7, 600, 500, 300, 500);
    m.update(raw, DT);
    expect(frameOf(m)).toMatchObject({ moveX: 127, moveY: 0 });
    expect(m.touchJoystick.knobX).toBe(420);
    raw.touches[0]!.active = false;
    m.update(raw, DT);
    expect(m.touchJoystick.active).toBe(false);
    expect(frameOf(m).moveX).toBe(0);
  });

  it('arrastar na metade direita mira (em px de layout)', () => {
    const raw = touchRaw();
    const p = createTouchProfile();
    const m = createInputMapper({ kind: 'touch' }, p);
    finger(raw, 0, 1, 900, 300);
    m.update(raw, DT);
    finger(raw, 0, 1, 940, 300, 900, 300);
    m.update(raw, DT);
    expect(m.yaw).toBeCloseTo(-20 * p.lookSensitivity, 6);
  });

  it('botão de tiro atira e também mira enquanto o dedo arrasta', () => {
    const raw = touchRaw();
    const m = createInputMapper({ kind: 'touch' }, createTouchProfile());
    // Tiro: centro a (140, 100) px de layout do canto inferior direito.
    const fx = 1334 - 140 * 2;
    const fy = 750 - 100 * 2;
    finger(raw, 3, 9, fx, fy);
    m.update(raw, DT);
    expect(m.isDown('fire')).toBe(true);
    expect(m.isTouchControlDown('fire')).toBe(true);
    finger(raw, 3, 9, fx - 30, fy, fx, fy);
    m.update(raw, DT);
    expect(m.yaw).toBeGreaterThan(0);
    expect(frameOf(m).buttons & BUTTON.fire).toBe(BUTTON.fire);
  });

  it('toque na margem morta da borda é ignorado; pausa tem botão próprio', () => {
    const raw = touchRaw();
    const m = createInputMapper({ kind: 'touch' }, createTouchProfile());
    finger(raw, 0, 1, 10, 400);
    m.update(raw, DT);
    expect(m.touchJoystick.active).toBe(false);
    finger(raw, 1, 2, 1334 - 112, 112);
    m.update(raw, DT);
    expect(m.wasPressed('pause')).toBe(true);
  });

  it('canhoto espelha: joystick na metade direita', () => {
    const raw = touchRaw();
    const base = createTouchProfile();
    const m = createInputMapper({ kind: 'touch' }, createTouchProfile({ ...base.touch!, leftHanded: true }));
    finger(raw, 0, 1, 1000, 400);
    m.update(raw, DT);
    expect(m.touchJoystick.active).toBe(true);
  });
});

describe('determinismo', () => {
  it('a mesma sequência de estados brutos dá os mesmos bytes de InputFrame', () => {
    function run(): Uint8Array {
      const raw = createRawInputState();
      raw.pointerLocked = true;
      raw.gamepads[0]!.connected = true;
      const a = kbm();
      const b = createInputMapper({ kind: 'gamepad', index: 0 }, createGamepadProfile());
      const w = new BitWriter(240 * 2 * 11);
      const f = createInputFrame();
      let x = 12345;
      for (let tick = 0; tick < 240; tick++) {
        // Pseudoaleatório fixo (LCG) só para variar o estado bruto.
        x = (Math.imul(x, 1103515245) + 12345) >>> 0;
        raw.keys[keyIndex('KeyW')] = x & 1;
        raw.keys[keyIndex('KeyA')] = (x >>> 1) & 1;
        raw.mouseButtons = (x >>> 2) & 3;
        raw.mouseDX = ((x >>> 4) & 31) - 16;
        raw.mouseDY = ((x >>> 9) & 15) - 8;
        raw.gamepads[0]!.axes[PAD_AXIS.rightX] = (((x >>> 13) & 255) - 128) / 128;
        raw.gamepads[0]!.buttons[PAD_BUTTON.triggerRight] = ((x >>> 21) & 7) / 7;
        a.update(raw, DT);
        b.update(raw, DT);
        a.writeFrame(f, tick);
        writeInputFrame(w, f);
        b.writeFrame(f, tick);
        writeInputFrame(w, f);
      }
      return w.bytes();
    }
    expect(run()).toEqual(run());
  });

  it('seq dá a volta em u16', () => {
    const m = kbm();
    expect(frameOf(m, 65536 + 5).seq).toBe(5);
  });
});
