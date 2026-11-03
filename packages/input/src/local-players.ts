import { keyIndex } from './keys.ts';
import { sameDevice, type DeviceBinding } from './bindings.ts';
import { MAX_GAMEPADS, MAX_TOUCHES, PAD_BUTTON, type RawInputState } from './raw.ts';

/** Jogadores locais (decisão #24): até 4, cada um com um dispositivo. Teclado + mouse contam como UM slot. */
export const MAX_LOCAL_PLAYERS = 4;

export interface LocalSlot {
  readonly index: number;
  /** Dispositivo do slot; `null` = vago. */
  readonly device: DeviceBinding | null;
  /**
   * Controle do slot desconectado: o slot fica RESERVADO (a partida local pausa) até o mesmo controle voltar, ou até
   * outro controle apertar "entrar" na tela "aperte A".
   */
  readonly connected: boolean;
  /** Identificador do controle (texto da Gamepad API/nx.js), para reconhecer a reconexão em outro índice. */
  readonly padId: string;
}

/**
 * Slots locais e a tela "aperte A/Enter para entrar" (tecnico.md §10, gameplay.md §10.6). O `game` cria um
 * `InputMapper` por slot ocupado e chama `mapper.setDevice` quando `update` devolver um slot reatribuído.
 */
export interface LocalPlayers {
  readonly slots: readonly LocalSlot[];
  /** Slots ocupados (inclusive os reservados por desconexão). */
  readonly count: number;
  /** Algum slot está reservado por controle desconectado (a partida local pausa). */
  readonly anyDisconnected: boolean;
  /**
   * 1x por frame: acompanha desconexões e reconexões (o mesmo controle volta ao slot dele, mesmo em outro índice) e,
   * com `allowJoin`, reconhece "entrar" (Enter/Espaço no teclado, botão de baixo, da direita ou Start no controle,
   * toque na tela). Devolve o índice do slot que entrou OU foi reatribuído neste frame, ou -1.
   */
  update(raw: Readonly<RawInputState>, allowJoin: boolean): number;
  /**
   * Põe o dispositivo num slot e devolve o índice. Controle novo prefere um slot reservado por desconexão; senão vai
   * no primeiro vago. -1 se não couber ou se o dispositivo já joga.
   */
  join(device: DeviceBinding, padId?: string): number;
  leave(slot: number): void;
  /** Slot do dispositivo, ou -1. */
  slotOf(device: DeviceBinding): number;
  clear(): void;
}

interface MutableSlot {
  index: number;
  device: DeviceBinding | null;
  connected: boolean;
  padId: string;
}

const JOIN_KEYS = [keyIndex('Enter'), keyIndex('NumpadEnter'), keyIndex('Space')];
const JOIN_PAD_BUTTONS = [PAD_BUTTON.faceDown, PAD_BUTTON.faceRight, PAD_BUTTON.start];
/** Estado anterior do "entrar": teclado, controles 0..7, toque. */
const KEYBOARD_SLOT = 0;
const TOUCH_SLOT = 1 + MAX_GAMEPADS;
/** Dispositivos imutáveis reaproveitados (sem alocar a cada entrada). */
const KEYBOARD: DeviceBinding = { kind: 'keyboardMouse' };
const TOUCH: DeviceBinding = { kind: 'touch' };
const PADS: readonly DeviceBinding[] = Array.from({ length: MAX_GAMEPADS }, (_, index) => ({ kind: 'gamepad', index }));

export function createLocalPlayers(): LocalPlayers {
  const slots: MutableSlot[] = [];
  for (let i = 0; i < MAX_LOCAL_PLAYERS; i++) slots.push({ index: i, device: null, connected: true, padId: '' });
  const joinPrev = new Uint8Array(TOUCH_SLOT + 1);

  function slotOf(device: DeviceBinding): number {
    for (const s of slots) if (s.device !== null && sameDevice(s.device, device)) return s.index;
    return -1;
  }

  function join(device: DeviceBinding, padId = ''): number {
    const existing = slotOf(device);
    if (existing >= 0) {
      // Outro controle no mesmo índice de um slot reservado: ele assume o slot.
      const s = slots[existing]!;
      if (s.connected) return -1;
      s.connected = true;
      s.padId = padId;
      return existing;
    }
    // Controle novo numa tela com slot reservado: assume o primeiro reservado (o jogador trocou de controle).
    if (device.kind === 'gamepad') {
      for (const s of slots) {
        if (s.device?.kind === 'gamepad' && !s.connected) {
          s.device = device;
          s.connected = true;
          s.padId = padId;
          return s.index;
        }
      }
    }
    for (const s of slots) {
      if (s.device === null) {
        s.device = device;
        s.connected = true;
        s.padId = padId;
        return s.index;
      }
    }
    return -1;
  }

  /** Borda de subida do "entrar" para o dispositivo `slot` de `joinPrev`. */
  function edge(slot: number, down: boolean): boolean {
    const was = joinPrev[slot] === 1;
    joinPrev[slot] = down ? 1 : 0;
    return down && !was;
  }

  const api: LocalPlayers = {
    slots,
    get count(): number {
      let n = 0;
      for (const s of slots) if (s.device !== null) n++;
      return n;
    },
    get anyDisconnected(): boolean {
      for (const s of slots) if (s.device !== null && !s.connected) return true;
      return false;
    },
    update(raw, allowJoin): number {
      // Laços por índice: roda todo frame (regra 11, sem iteradores).
      let changed = -1;
      // Desconexões e reconexões (mesmo id de controle, talvez noutro índice).
      for (let si = 0; si < slots.length; si++) {
        const s = slots[si]!;
        if (s.device?.kind !== 'gamepad') continue;
        const pad = raw.gamepads[s.device.index];
        if (s.connected && (!pad || !pad.connected)) s.connected = false;
        else if (!s.connected) {
          for (let i = 0; i < MAX_GAMEPADS; i++) {
            const p = raw.gamepads[i];
            if (!p?.connected || p.id !== s.padId || (slotOf(PADS[i]!) >= 0 && i !== s.device.index)) continue;
            s.device = PADS[i]!;
            s.connected = true;
            changed = s.index;
            break;
          }
        }
      }

      let keyDown = false;
      for (let k = 0; k < JOIN_KEYS.length; k++) if (raw.keys[JOIN_KEYS[k]!]) keyDown = true;
      const keyEdge = edge(KEYBOARD_SLOT, keyDown);
      let touchDown = false;
      for (let i = 0; i < MAX_TOUCHES; i++) if (raw.touches[i]?.active) touchDown = true;
      const touchEdge = edge(TOUCH_SLOT, touchDown);
      if (allowJoin && keyEdge && changed < 0) {
        const s = join(KEYBOARD);
        if (s >= 0) changed = s;
      }
      for (let i = 0; i < MAX_GAMEPADS; i++) {
        const p = raw.gamepads[i];
        let down = false;
        if (p?.connected) {
          for (let b = 0; b < JOIN_PAD_BUTTONS.length; b++)
            if ((p.buttons[JOIN_PAD_BUTTONS[b]!] ?? 0) >= 0.5) down = true;
        }
        if (edge(1 + i, down) && allowJoin && changed < 0) {
          const s = join(PADS[i]!, p!.id);
          if (s >= 0) changed = s;
        }
      }
      if (allowJoin && touchEdge && changed < 0) {
        const s = join(TOUCH);
        if (s >= 0) changed = s;
      }
      return changed;
    },
    join,
    leave(slot): void {
      const s = slots[slot];
      if (!s) return;
      s.device = null;
      s.connected = true;
      s.padId = '';
    },
    slotOf,
    clear(): void {
      for (const s of slots) {
        s.device = null;
        s.connected = true;
        s.padId = '';
      }
    },
  };
  return api;
}
