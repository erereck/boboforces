import { clamp, degToRad, pitchToI16, wrapAngle, yawToU16 } from '@boboforces/shared';
import {
  BUTTON,
  FRAME_BUTTONS,
  GAME_ACTION_INDEX,
  GAME_ACTIONS,
  MENU_ACTION_INDEX,
  MENU_ACTIONS,
  MOVE_DIRECTIONS,
  WEAPON_SLOT_COUNT,
  type GameAction,
  type MenuAction,
} from './actions.ts';
import { TOUCH_CONTROLS, type BindingSource, type DeviceBinding, type TouchControlId } from './bindings.ts';
import { quantizeAxis, type InputFrame } from './frame.ts';
import type { ControlProfile } from './profiles.ts';
import { GAMEPAD_AXES, GAMEPAD_BUTTONS, MAX_TOUCHES, PAD_AXIS, type RawGamepad, type RawInputState } from './raw.ts';
import { edgeAcceleration, shapeStick } from './stick.ts';
import { hitTouchButton, inJoystickHalf, inTouchEdgeMargin, touchControlIndex } from './touch.ts';

/** Pitch máximo da mira (89°): evita a câmera virar no polo; cabe com folga no i16 do InputFrame. */
export const MAX_PITCH = degToRad(89);

/** Auto-repetição das direções no menu: espera inicial e intervalo, em segundos. */
export const MENU_REPEAT_DELAY_S = 0.4;
export const MENU_REPEAT_INTERVAL_S = 0.1;

/** Estado do joystick de toque, para a UI desenhar (px reais da superfície). */
export interface TouchJoystickState {
  readonly active: boolean;
  readonly baseX: number;
  readonly baseY: number;
  readonly knobX: number;
  readonly knobY: number;
}

/**
 * Mapeador de UM slot local: lê o estado bruto, aplica o perfil e produz ações e InputFrames.
 * Não importa `sim` (input fica abaixo da sim no grafo): a assistência de mira entra como `aimScale` e o `game`
 * calcula os alvos.
 *
 * Determinístico: a mesma sequência de `(raw, dt)` produz os mesmos frames (sem relógio, sem acaso). Sem alocação em
 * `update`/`writeFrame`: o perfil é compilado em typed arrays no `setProfile`.
 */
export interface InputMapper {
  readonly device: DeviceBinding;
  readonly profile: ControlProfile;
  /** Mira atual em radianos (yaw em [-π, π), pitch em ±`MAX_PITCH`), aplicada na câmera em TODO frame de render. */
  readonly yaw: number;
  readonly pitch: number;
  /** Movimento atual em [-1, 1] (módulo ≤ 1), antes da quantização. */
  readonly moveX: number;
  readonly moveY: number;
  /** Slot de arma desejado (0..`WEAPON_SLOT_COUNT`-1). */
  readonly weapon: number;
  /** M2: primária do próximo spawn (código + 1; 0 = manter). */
  readonly primary: number;
  /** Houve qualquer input deste dispositivo no último `update` (tela "aperte A", troca de glifos). */
  readonly active: boolean;
  /** O dispositivo está presente (controle desconectado = `false`; teclado e toque sempre `true`). */
  readonly connected: boolean;
  /** Joystick de toque (só no dispositivo `touch`). */
  readonly touchJoystick: TouchJoystickState;
  /**
   * Lê o estado bruto (1x por frame de render) e integra a mira. `aimScale` multiplica a sensibilidade (a
   * desaceleração da assistência de mira); o multiplicador do ADS do perfil já é aplicado aqui dentro.
   */
  update(raw: Readonly<RawInputState>, dtSeconds: number, aimScale?: number): void;
  /** A ação de jogo está segurada agora (com alternância, o estado alternado). */
  isDown(action: GameAction): boolean;
  /** A ação de jogo foi apertada neste frame (borda de descida). */
  wasPressed(action: GameAction): boolean;
  /** A ação de menu disparou neste frame (borda, com auto-repetição nas direções). */
  menuPressed(action: MenuAction): boolean;
  /** Algum dedo segura este controle de toque (para a UI acender o botão). */
  isTouchControlDown(control: TouchControlId): boolean;
  /**
   * Preenche o InputFrame do próximo tick (botões, movimento quantizado, ângulos absolutos, arma desejada). Um botão
   * apertado e solto entre dois ticks ainda aparece no frame seguinte (cliques rápidos não se perdem).
   */
  writeFrame(out: InputFrame, seq: number): void;
  /** Força a mira (spawn, teleporte, "destravar"). */
  setAngles(yaw: number, pitch: number): void;
  /** Sincroniza a arma desejada com a sim (troca automática, respawn): sem isso o próximo aperto não mudaria nada. */
  setWeapon(slot: number): void;
  /**
   * M2: primária do próximo spawn (código da arma + 1; 0 = manter). Vai em todo `InputFrame.primary` até mudar de
   * novo; o menu radial da tela de morte chama.
   */
  setPrimary(codePlusOne: number): void;
  setProfile(profile: ControlProfile): void;
  /** Troca o dispositivo do slot (reconexão do controle em outro índice). Zera toques, alternâncias e travas. */
  setDevice(device: DeviceBinding): void;
}

// Fonte compilada: tipo de dispositivo.
const SRC_KEY = 0;
const SRC_MOUSE = 1;
const SRC_WHEEL = 2;
const SRC_PAD_BUTTON = 3;
const SRC_PAD_AXIS = 4;
const SRC_TOUCH = 5;
// Alvo compilado.
const TGT_GAME = 0;
const TGT_MENU = 1;
const TGT_MOVE = 2;
// Papel de um dedo.
const ROLE_NONE = 0;
const ROLE_IGNORED = 1;
const ROLE_JOYSTICK = 2;
const ROLE_LOOK = 3;
const ROLE_BUTTON = 4;

const GAME_COUNT = GAME_ACTIONS.length;
const MENU_COUNT = MENU_ACTIONS.length;
const MOVE_COUNT = MOVE_DIRECTIONS.length;
const MOVE_FORWARD = 0;
const MOVE_BACK = 1;
const MOVE_LEFT = 2;
const MOVE_RIGHT = 3;
/** As 4 primeiras ações de menu são as direções (`up`, `down`, `left`, `right`): só elas repetem. */
const MENU_DIRECTION_COUNT = 4;

const A_ADS = GAME_ACTION_INDEX.ads;
const A_CROUCH = GAME_ACTION_INDEX.crouch;
const A_SPRINT = GAME_ACTION_INDEX.sprint;
const A_NEXT = GAME_ACTION_INDEX.nextWeapon;
const A_PREV = GAME_ACTION_INDEX.prevWeapon;
const A_LAST = GAME_ACTION_INDEX.lastWeapon;
const A_SLOT = [GAME_ACTION_INDEX.slot1, GAME_ACTION_INDEX.slot2, GAME_ACTION_INDEX.slot3, GAME_ACTION_INDEX.slot4];
/** Bit de `BUTTON` de cada ação de jogo (0 para as locais). */
const ACTION_BIT = new Uint32Array(GAME_COUNT);
for (const b of FRAME_BUTTONS) ACTION_BIT[GAME_ACTION_INDEX[b]] = BUTTON[b];

const ZERO_PAD: RawGamepad = {
  connected: false,
  id: '',
  kind: 'unknown',
  axes: new Float32Array(GAMEPAD_AXES),
  buttons: new Float32Array(GAMEPAD_BUTTONS),
};

function sourceCode(s: BindingSource): [device: number, code: number, dir: number] {
  switch (s.device) {
    case 'key':
      return [SRC_KEY, s.key, 1];
    case 'mouseButton':
      return [SRC_MOUSE, s.button, 1];
    case 'wheel':
      return [SRC_WHEEL, 0, s.direction];
    case 'padButton':
      return [SRC_PAD_BUTTON, s.button, 1];
    case 'padAxis':
      return [SRC_PAD_AXIS, s.axis, s.direction];
    case 'touchControl':
      return [SRC_TOUCH, touchControlIndex(s.control), 1];
  }
}

/** Ligações do perfil em arrays planos (uma linha por fonte). */
interface CompiledBindings {
  readonly count: number;
  readonly target: Uint8Array;
  readonly index: Uint8Array;
  readonly device: Uint8Array;
  readonly code: Int16Array;
  readonly dir: Int8Array;
  readonly hold: Uint8Array;
  /** Segundos segurando (fontes com `hold`). */
  readonly held: Float32Array;
}

function compile(profile: ControlProfile): CompiledBindings {
  const rows: [number, number, BindingSource][] = [];
  GAME_ACTIONS.forEach((a, i) => profile.game[a]?.forEach((s) => rows.push([TGT_GAME, i, s])));
  MENU_ACTIONS.forEach((a, i) => profile.menu[a]?.forEach((s) => rows.push([TGT_MENU, i, s])));
  MOVE_DIRECTIONS.forEach((d, i) => profile.move[d]?.forEach((s) => rows.push([TGT_MOVE, i, s])));
  const n = rows.length;
  const c: CompiledBindings = {
    count: n,
    target: new Uint8Array(n),
    index: new Uint8Array(n),
    device: new Uint8Array(n),
    code: new Int16Array(n),
    dir: new Int8Array(n),
    hold: new Uint8Array(n),
    held: new Float32Array(n),
  };
  rows.forEach(([target, index, s], r) => {
    const [device, code, dir] = sourceCode(s);
    c.target[r] = target;
    c.index[r] = index;
    c.device[r] = device;
    c.code[r] = code;
    c.dir[r] = dir;
    c.hold[r] = s.hold === true ? 1 : 0;
  });
  return c;
}

export function createInputMapper(device: DeviceBinding, profile: ControlProfile): InputMapper {
  return new Mapper(device, profile);
}

class Mapper implements InputMapper {
  device: DeviceBinding;
  profile: ControlProfile;
  yaw = 0;
  pitch = 0;
  moveX = 0;
  moveY = 0;
  weapon = 0;
  primary = 0;
  active = false;
  connected = true;
  readonly touchJoystick = { active: false, baseX: 0, baseY: 0, knobX: 0, knobY: 0 };

  private bindings: CompiledBindings;
  private toggleMask = new Uint8Array(GAME_COUNT);

  // Valores de fonte acumulados por alvo no frame (máximo entre as fontes).
  private readonly gameValue = new Float32Array(GAME_COUNT);
  private readonly gamePulse = new Uint8Array(GAME_COUNT);
  private readonly menuValue = new Float32Array(MENU_COUNT);
  private readonly moveValue = new Float32Array(MOVE_COUNT);

  // Estado das ações de jogo.
  private readonly physicalPrev = new Uint8Array(GAME_COUNT);
  private readonly toggled = new Uint8Array(GAME_COUNT);
  private readonly down = new Uint8Array(GAME_COUNT);
  private readonly pressed = new Uint8Array(GAME_COUNT);
  private previousWeapon = 0;
  /** Bits de `BUTTON` vistos desde o último `writeFrame` (latch) e os segurados agora. */
  private latchBits = 0;
  private downBits = 0;

  // Estado do menu.
  private readonly menuDown = new Uint8Array(MENU_COUNT);
  private readonly menuFired = new Uint8Array(MENU_COUNT);
  private readonly menuRepeat = new Float32Array(MENU_COUNT);

  // Mira no stick.
  private edgeTime = 0;
  private readonly stickOut = new Float64Array(2);

  // Toque: um registro por posição de `RawInputState.touches`.
  private readonly touchId = new Int32Array(MAX_TOUCHES).fill(-1);
  private readonly touchRole = new Uint8Array(MAX_TOUCHES);
  private readonly touchButton = new Int8Array(MAX_TOUCHES);
  private readonly touchAims = new Uint8Array(MAX_TOUCHES);
  private readonly touchLastX = new Float32Array(MAX_TOUCHES);
  private readonly touchLastY = new Float32Array(MAX_TOUCHES);
  private readonly touchControlDown = new Uint8Array(TOUCH_CONTROLS.length);
  private joystickMoveX = 0;
  private joystickMoveY = 0;
  private touchLookX = 0;
  private touchLookY = 0;

  constructor(device: DeviceBinding, profile: ControlProfile) {
    this.device = device;
    this.profile = profile;
    this.bindings = compile(profile);
    this.applyToggles();
  }

  setProfile(profile: ControlProfile): void {
    this.profile = profile;
    this.bindings = compile(profile);
    this.applyToggles();
    this.toggled.fill(0);
  }

  setDevice(device: DeviceBinding): void {
    this.device = device;
    this.toggled.fill(0);
    this.physicalPrev.fill(0);
    this.bindings.held.fill(0);
    this.releaseAllTouches();
  }

  setAngles(yaw: number, pitch: number): void {
    this.yaw = wrapAngle(yaw);
    this.pitch = clamp(pitch, -MAX_PITCH, MAX_PITCH);
  }

  setWeapon(slot: number): void {
    const s = clamp(Math.floor(slot), 0, WEAPON_SLOT_COUNT - 1);
    if (s !== this.weapon) {
      this.previousWeapon = this.weapon;
      this.weapon = s;
    }
  }

  setPrimary(codePlusOne: number): void {
    this.primary = clamp(Math.floor(codePlusOne), 0, 255);
  }

  isDown(action: GameAction): boolean {
    return this.down[GAME_ACTION_INDEX[action]] === 1;
  }

  wasPressed(action: GameAction): boolean {
    return this.pressed[GAME_ACTION_INDEX[action]] === 1;
  }

  menuPressed(action: MenuAction): boolean {
    return this.menuFired[MENU_ACTION_INDEX[action]] === 1;
  }

  isTouchControlDown(control: TouchControlId): boolean {
    return this.touchControlDown[touchControlIndex(control)] === 1;
  }

  writeFrame(out: InputFrame, seq: number): void {
    out.seq = seq & 0xffff;
    out.buttons = (this.latchBits | this.downBits) & 0xffff;
    out.moveX = quantizeAxis(this.moveX);
    out.moveY = quantizeAxis(this.moveY);
    out.yaw = yawToU16(this.yaw);
    out.pitch = pitchToI16(this.pitch);
    out.weapon = this.weapon & 0xff;
    out.primary = this.primary & 0xff;
    this.latchBits = 0;
  }

  update(raw: Readonly<RawInputState>, dtSeconds: number, aimScale = 1): void {
    const dt = dtSeconds > 0 ? dtSeconds : 0;
    const p = this.profile;
    const pad = this.device.kind === 'gamepad' ? (raw.gamepads[this.device.index] ?? ZERO_PAD) : ZERO_PAD;
    this.connected = this.device.kind !== 'gamepad' || pad.connected;

    if (this.device.kind === 'touch') this.updateTouches(raw);
    this.gatherSources(raw, pad, dt);
    this.updateGameActions();
    this.updateWeapon();
    this.updateMenu(dt);
    this.updateMove(pad);
    this.updateLook(raw, pad, dt, aimScale);

    this.active = this.detectActivity(raw, pad, p.pressThreshold, p.deadzoneInner);
  }

  // --- etapas do update ---

  private applyToggles(): void {
    const p = this.profile;
    this.toggleMask.fill(0);
    if (p.toggleAds) this.toggleMask[A_ADS] = 1;
    if (p.toggleCrouch) this.toggleMask[A_CROUCH] = 1;
    if (p.toggleSprint) this.toggleMask[A_SPRINT] = 1;
  }

  /** Valor de cada fonte (0..1) acumulado no alvo, com travas de "segurar". */
  private gatherSources(raw: Readonly<RawInputState>, pad: RawGamepad, dt: number): void {
    this.gameValue.fill(0);
    this.gamePulse.fill(0);
    this.menuValue.fill(0);
    this.moveValue.fill(0);
    const b = this.bindings;
    const kind = this.device.kind;
    const threshold = this.profile.pressThreshold;
    for (let r = 0; r < b.count; r++) {
      const dev = b.device[r]!;
      const code = b.code[r]!;
      let v = 0;
      let pulse = false;
      if (dev === SRC_KEY) {
        if (kind === 'keyboardMouse') v = raw.keys[code] ? 1 : 0;
      } else if (dev === SRC_MOUSE) {
        if (kind === 'keyboardMouse') v = (raw.mouseButtons & code) !== 0 ? 1 : 0;
      } else if (dev === SRC_WHEEL) {
        if (kind === 'keyboardMouse' && raw.wheel * b.dir[r]! > 0) {
          v = 1;
          pulse = true;
        }
      } else if (dev === SRC_PAD_BUTTON) {
        if (kind === 'gamepad') v = pad.buttons[code] ?? 0;
      } else if (dev === SRC_PAD_AXIS) {
        if (kind === 'gamepad') v = Math.max(0, (pad.axes[code] ?? 0) * b.dir[r]!);
      } else if (dev === SRC_TOUCH) {
        if (kind === 'touch' && code >= 0) v = this.touchControlDown[code]!;
      }
      if (b.hold[r]) {
        if (v >= threshold) {
          b.held[r]! += dt;
          if (b.held[r]! < this.profile.holdS) v = 0;
        } else {
          b.held[r] = 0;
          v = 0;
        }
      }
      const idx = b.index[r]!;
      const tgt = b.target[r]!;
      if (tgt === TGT_GAME) {
        if (v > this.gameValue[idx]!) this.gameValue[idx] = v;
        if (pulse) this.gamePulse[idx] = 1;
      } else if (tgt === TGT_MENU) {
        if (v > this.menuValue[idx]!) this.menuValue[idx] = v;
      } else if (v > this.moveValue[idx]!) this.moveValue[idx] = v;
    }
  }

  private updateGameActions(): void {
    const threshold = this.profile.pressThreshold;
    let bits = 0;
    for (let a = 0; a < GAME_COUNT; a++) {
      const pulse = this.gamePulse[a] === 1;
      const physical = this.gameValue[a]! >= threshold;
      const physicalPressed = pulse || (physical && this.physicalPrev[a] === 0);
      this.physicalPrev[a] = physical && !pulse ? 1 : 0;
      let down: boolean;
      if (this.toggleMask[a] === 1) {
        if (physicalPressed) this.toggled[a] = this.toggled[a] === 1 ? 0 : 1;
        down = this.toggled[a] === 1;
      } else down = physical;
      this.pressed[a] = (down && this.down[a] === 0) || (pulse && this.toggleMask[a] === 0) ? 1 : 0;
      this.down[a] = down ? 1 : 0;
      if (down) bits |= ACTION_BIT[a]!;
    }
    this.downBits = bits;
    this.latchBits |= bits;
  }

  private updateWeapon(): void {
    for (let s = 0; s < WEAPON_SLOT_COUNT; s++) {
      if (this.pressed[A_SLOT[s]!] === 1) {
        this.setWeapon(s);
        return;
      }
    }
    if (this.pressed[A_NEXT] === 1) this.setWeapon((this.weapon + 1) % WEAPON_SLOT_COUNT);
    else if (this.pressed[A_PREV] === 1) this.setWeapon((this.weapon + WEAPON_SLOT_COUNT - 1) % WEAPON_SLOT_COUNT);
    else if (this.pressed[A_LAST] === 1) this.setWeapon(this.previousWeapon);
  }

  private updateMenu(dt: number): void {
    const threshold = this.profile.pressThreshold;
    for (let m = 0; m < MENU_COUNT; m++) {
      const down = this.menuValue[m]! >= threshold;
      let fired = false;
      if (down && this.menuDown[m] === 0) {
        fired = true;
        this.menuRepeat[m] = MENU_REPEAT_DELAY_S;
      } else if (down && m < MENU_DIRECTION_COUNT) {
        this.menuRepeat[m]! -= dt;
        if (this.menuRepeat[m]! <= 0) {
          fired = true;
          this.menuRepeat[m]! += MENU_REPEAT_INTERVAL_S;
          // Frame muito longo não dispara uma rajada: no máximo 1 repetição por update.
          if (this.menuRepeat[m]! <= 0) this.menuRepeat[m] = MENU_REPEAT_INTERVAL_S;
        }
      }
      this.menuDown[m] = down ? 1 : 0;
      this.menuFired[m] = fired ? 1 : 0;
    }
  }

  private updateMove(pad: RawGamepad): void {
    const p = this.profile;
    let x = this.moveValue[MOVE_RIGHT]! - this.moveValue[MOVE_LEFT]!;
    let y = this.moveValue[MOVE_FORWARD]! - this.moveValue[MOVE_BACK]!;
    if (this.device.kind === 'gamepad' && p.moveStick !== null) {
      const ax = p.moveStick === 'left' ? PAD_AXIS.leftX : PAD_AXIS.rightX;
      const ay = p.moveStick === 'left' ? PAD_AXIS.leftY : PAD_AXIS.rightY;
      // Movimento é linear depois da zona morta (a curva é só da mira). Y do stick é para baixo.
      shapeStick(pad.axes[ax] ?? 0, pad.axes[ay] ?? 0, p.deadzoneInner, p.deadzoneOuter, 1, this.stickOut);
      x += this.stickOut[0]!;
      y -= this.stickOut[1]!;
    } else if (this.device.kind === 'touch') {
      x += this.joystickMoveX;
      y += this.joystickMoveY;
    }
    // Diagonal digital (e soma de fontes) limitada ao círculo unitário: andar na diagonal não é mais rápido.
    const len2 = x * x + y * y;
    if (len2 > 1) {
      const k = 1 / Math.sqrt(len2);
      x *= k;
      y *= k;
    }
    this.moveX = x;
    this.moveY = y;
  }

  private updateLook(raw: Readonly<RawInputState>, pad: RawGamepad, dt: number, aimScale: number): void {
    const p = this.profile;
    const scale = aimScale * (this.down[A_ADS] === 1 ? p.adsSensitivityMul : 1);
    const ySign = p.invertY ? -1 : 1;
    let dYaw = 0;
    let dPitch = 0;
    if (this.device.kind === 'keyboardMouse') {
      // Sem pointer lock o mouse é cursor de menu: não gira a câmera.
      if (raw.pointerLocked) {
        const s = p.lookSensitivity * scale;
        dYaw = -raw.mouseDX * s;
        dPitch = -raw.mouseDY * s * p.lookSensitivityYMul * ySign;
      }
    } else if (this.device.kind === 'gamepad') {
      if (p.lookStick !== null) {
        const ax = p.lookStick === 'right' ? PAD_AXIS.rightX : PAD_AXIS.leftX;
        const ay = p.lookStick === 'right' ? PAD_AXIS.rightY : PAD_AXIS.leftY;
        const out = this.stickOut;
        const mag = shapeStick(
          pad.axes[ax] ?? 0,
          pad.axes[ay] ?? 0,
          p.deadzoneInner,
          p.deadzoneOuter,
          p.curveExponent,
          out,
        );
        this.edgeTime = mag >= 1 ? this.edgeTime + dt : 0;
        const accel = edgeAcceleration(this.edgeTime, p.edgeAccelDelayS, p.edgeAccelRampS, p.edgeAccelMul);
        const rate = p.lookSensitivity * scale * dt;
        dYaw = -out[0]! * rate * accel;
        dPitch = -out[1]! * rate * p.lookSensitivityYMul * ySign;
      }
    } else {
      const pr = raw.pixelRatio > 0 ? raw.pixelRatio : 1;
      const s = (p.lookSensitivity * scale) / pr;
      dYaw = -this.touchLookX * s;
      dPitch = -this.touchLookY * s * p.lookSensitivityYMul * ySign;
    }
    if (dYaw !== 0) this.yaw = wrapAngle(this.yaw + dYaw);
    if (dPitch !== 0) this.pitch = clamp(this.pitch + dPitch, -MAX_PITCH, MAX_PITCH);
  }

  /** Classifica dedos novos, solta os que saíram e calcula joystick, arrasto de mira e botões apertados. */
  private updateTouches(raw: Readonly<RawInputState>): void {
    const layout = this.profile.touch;
    const w = raw.surfaceWidth;
    const h = raw.surfaceHeight;
    const pr = raw.pixelRatio > 0 ? raw.pixelRatio : 1;
    this.touchControlDown.fill(0);
    this.joystickMoveX = 0;
    this.joystickMoveY = 0;
    this.touchLookX = 0;
    this.touchLookY = 0;
    const js = this.touchJoystick;
    js.active = false;
    if (layout === null) return;
    let joystickTaken = false;
    for (let i = 0; i < MAX_TOUCHES; i++) {
      if (this.touchRole[i] === ROLE_JOYSTICK && raw.touches[i]?.active && raw.touches[i]!.id === this.touchId[i]) {
        joystickTaken = true;
      }
    }
    for (let i = 0; i < MAX_TOUCHES; i++) {
      const t = raw.touches[i];
      if (!t || !t.active) {
        this.touchId[i] = -1;
        this.touchRole[i] = ROLE_NONE;
        continue;
      }
      if (this.touchId[i] !== t.id) {
        // Dedo novo: decide o papel pelo ponto onde ele ENCOSTOU.
        this.touchId[i] = t.id;
        this.touchLastX[i] = t.startX;
        this.touchLastY[i] = t.startY;
        this.touchAims[i] = 0;
        if (inTouchEdgeMargin(layout, t.startX, t.startY, w, h, pr)) this.touchRole[i] = ROLE_IGNORED;
        else {
          const hit = hitTouchButton(layout, t.startX, t.startY, w, h, pr);
          if (hit >= 0) {
            this.touchRole[i] = ROLE_BUTTON;
            this.touchButton[i] = touchControlIndex(layout.buttons[hit]!.control);
            this.touchAims[i] = layout.buttons[hit]!.aims ? 1 : 0;
          } else if (inJoystickHalf(layout, t.startX, w)) {
            this.touchRole[i] = joystickTaken ? ROLE_IGNORED : ROLE_JOYSTICK;
            joystickTaken = true;
          } else this.touchRole[i] = ROLE_LOOK;
        }
      }
      const role = this.touchRole[i];
      if (role === ROLE_BUTTON) this.touchControlDown[this.touchButton[i]!] = 1;
      if (role === ROLE_LOOK || (role === ROLE_BUTTON && this.touchAims[i] === 1)) {
        this.touchLookX += t.x - this.touchLastX[i]!;
        this.touchLookY += t.y - this.touchLastY[i]!;
      }
      this.touchLastX[i] = t.x;
      this.touchLastY[i] = t.y;
      if (role === ROLE_JOYSTICK) {
        const radius = layout.joystickRadius * pr;
        const dead = layout.joystickDeadzone * pr;
        const dx = t.x - t.startX;
        const dy = t.y - t.startY;
        const len = Math.sqrt(dx * dx + dy * dy);
        js.active = true;
        js.baseX = t.startX;
        js.baseY = t.startY;
        const k = len > radius ? radius / len : 1;
        js.knobX = t.startX + dx * k;
        js.knobY = t.startY + dy * k;
        if (len > dead) {
          const m = Math.min(1, (len - dead) / (radius - dead)) / len;
          this.joystickMoveX = dx * m;
          this.joystickMoveY = -dy * m;
        }
      }
    }
  }

  private releaseAllTouches(): void {
    this.touchId.fill(-1);
    this.touchRole.fill(ROLE_NONE);
    this.touchControlDown.fill(0);
    this.touchJoystick.active = false;
    this.joystickMoveX = 0;
    this.joystickMoveY = 0;
  }

  private detectActivity(raw: Readonly<RawInputState>, pad: RawGamepad, threshold: number, inner: number): boolean {
    const kind = this.device.kind;
    if (kind === 'keyboardMouse') {
      if (raw.mouseButtons !== 0 || raw.wheel !== 0 || raw.mouseDX !== 0 || raw.mouseDY !== 0) return true;
      for (let k = 1; k < raw.keys.length; k++) if (raw.keys[k] !== 0) return true;
      return false;
    }
    if (kind === 'gamepad') {
      if (!pad.connected) return false;
      for (let b = 0; b < pad.buttons.length; b++) if (pad.buttons[b]! >= threshold) return true;
      for (let a = 0; a < pad.axes.length; a++) if (Math.abs(pad.axes[a]!) > inner) return true;
      return false;
    }
    for (let i = 0; i < MAX_TOUCHES; i++) if (raw.touches[i]?.active) return true;
    return false;
  }
}
