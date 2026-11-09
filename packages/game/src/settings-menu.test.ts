import { DEFAULT_SETTINGS } from '@boboforces/format';
import {
  AIM_ASSIST_LEVELS,
  createGamepadProfile,
  createKeyboardMouseProfile,
  key,
  KEY_CODES,
  keyIndex,
  MOUSE_BUTTON,
  pad,
  PAD_AXIS,
  PAD_BUTTON,
  REMAP_ACTIONS,
  wheel,
  type BindingSource,
} from '@boboforces/input';
import { STRINGS_PT_BR, type StringKey } from '@boboforces/ui';
import { describe, expect, it } from 'vitest';
import { createMenuController, followTab } from './menu.ts';
import {
  actionLabel,
  applyControls,
  bindingLabel,
  bindingsText,
  bindRowAction,
  rebindSettings,
  settingsRows,
  stepSettings,
} from './settings-menu.ts';

/** M2, fase 4f: a lógica dos Ajustes e os controles salvos no perfil do input. */

describe('Ajustes: botões (parte 2)', () => {
  it('toda tecla, botão, eixo e ação tem nome na tabela', () => {
    const sources: BindingSource[] = [wheel(1), wheel(-1)];
    for (let k = 0; k < KEY_CODES.length; k++) sources.push({ device: 'key', key: k });
    for (const b of Object.values(MOUSE_BUTTON)) sources.push({ device: 'mouseButton', button: b });
    for (const b of Object.values(PAD_BUTTON)) sources.push({ device: 'padButton', button: b });
    for (const a of Object.values(PAD_AXIS)) sources.push({ device: 'padAxis', axis: a, direction: 1 });
    for (const s of sources) {
      const label = bindingLabel(s);
      expect(typeof label, JSON.stringify(s)).toBe('string');
      expect(label.length, JSON.stringify(s)).toBeGreaterThan(0);
    }
    expect(bindingLabel(key('KeyQ'))).toBe('Q');
    expect(bindingLabel(key('Digit7'))).toBe('7');
    expect(bindingLabel(key('F5'))).toBe('F5');
    expect(bindingLabel(key('Space'))).toBe('Espaço');
    expect(bindingLabel(pad('faceLeft', true))).toBe('Botão da esquerda (segurar)');
    expect(bindingsText([key('ShiftLeft'), key('ShiftRight')])).toBe('Shift esquerdo +1');
    expect(bindingsText([])).toBe('Nenhum');
    for (const a of [...REMAP_ACTIONS.keyboardMouse, ...REMAP_ACTIONS.gamepad]) {
      expect(STRINGS_PT_BR[actionLabel(a) as StringKey], a).toBeTruthy();
    }
  });

  it('a aba Botões lista as ações do dispositivo; no toque, só o aviso; Restaurar padrão limpa', () => {
    const kb = settingsRows('buttons', DEFAULT_SETTINGS, 'keyboardMouse', 'jump');
    expect(kb[0]!.id).toBe('device');
    expect(kb.filter((r) => r.kind === 'value')).toHaveLength(REMAP_ACTIONS.keyboardMouse.length);
    const jump = kb.find((r) => r.id === 'bind:jump');
    expect(jump?.kind === 'value' ? jump.value : '').toBe('Aperte...');
    const fire = kb.find((r) => r.id === 'bind:fire');
    expect(fire?.kind === 'value' ? fire.value : '').toBe('Mouse esquerdo');
    expect(kb.at(-1)!.id).toBe('reset');
    const touch = settingsRows('buttons', DEFAULT_SETTINGS, 'touch');
    expect(touch.map((r) => r.kind)).toEqual(['option', 'text']);
    expect(bindRowAction('bind:jump', 'gamepad')).toBe('jump');
    expect(bindRowAction('bind:forward', 'gamepad')).toBeNull();
    expect(bindRowAction('bind:jump', 'touch')).toBeNull();
    const bound = rebindSettings(DEFAULT_SETTINGS, 'keyboardMouse', 'jump', key('KeyF')).doc;
    const reset = stepSettings('buttons', bound, 'keyboardMouse', 'reset', 0).doc;
    expect(reset.controls.keyboardMouse.bindings).toEqual({});
  });

  it('remapear avisa a troca, a ação sem botão, o Ctrl e recusa a pausa; o perfil da partida usa os botões', () => {
    const swap = rebindSettings(DEFAULT_SETTINGS, 'keyboardMouse', 'grenade', key('KeyQ'));
    expect(swap.note).toBe('Q era de Última arma usada: trocados.');
    const orphan = rebindSettings(DEFAULT_SETTINGS, 'gamepad', 'prevWeapon', pad('faceUp'));
    expect(orphan.note).toBe('Botão de cima era de Próxima arma, que ficou sem botão.');
    const ctrl = rebindSettings(DEFAULT_SETTINGS, 'keyboardMouse', 'crouch', key('ControlLeft'));
    expect(ctrl.note).toContain('Ctrl');
    const paused = rebindSettings(DEFAULT_SETTINGS, 'keyboardMouse', 'jump', key('KeyP'));
    expect(paused.doc).toBe(DEFAULT_SETTINGS);
    expect(paused.note).toBe('P é da pausa. Escolha outro.');
    const p = applyControls(createKeyboardMouseProfile(), swap.doc.controls.keyboardMouse);
    expect(p.game.grenade).toEqual([{ device: 'key', key: keyIndex('KeyQ') }]);
    expect(p.game.lastWeapon).toEqual([key('KeyG')]);
  });
});

describe('Ajustes', () => {
  it('Controles começa pelo dispositivo; as zonas mortas só aparecem no controle', () => {
    const kb = settingsRows('controls', DEFAULT_SETTINGS, 'keyboardMouse').map((r) => r.id);
    const pad = settingsRows('controls', DEFAULT_SETTINGS, 'gamepad').map((r) => r.id);
    expect(kb[0]).toBe('device');
    expect(kb).not.toContain('deadIn');
    expect(pad).toContain('deadIn');
    expect(pad).toContain('deadOut');
  });

  it('os passos mudam só o dispositivo ajustado; a linha "Ajustando" troca o dispositivo', () => {
    let doc = DEFAULT_SETTINGS;
    let device = 'gamepad' as const as 'keyboardMouse' | 'gamepad' | 'touch';
    ({ doc, device } = stepSettings('controls', doc, device, 'sens', 1));
    ({ doc, device } = stepSettings('controls', doc, device, 'assist', 1));
    ({ doc, device } = stepSettings('controls', doc, device, 'toggleAds', 0));
    expect(doc.controls.gamepad.sensitivity).toBe(1.25);
    expect(doc.controls.gamepad.aimAssist).toBe('strong');
    expect(doc.controls.gamepad.toggleAds).toBe(true);
    expect(doc.controls.keyboardMouse).toEqual(DEFAULT_SETTINGS.controls.keyboardMouse);
    // A assistência para no Forte; a linha do dispositivo dá a volta.
    expect(stepSettings('controls', doc, device, 'assist', 1).doc.controls.gamepad.aimAssist).toBe('strong');
    expect(stepSettings('controls', doc, 'touch', 'device', 1).device).toBe('keyboardMouse');
    // Vídeo e acessibilidade.
    const fov = stepSettings('video', doc, device, 'fov', 1).doc;
    expect(fov.video.fovDeg).toBe(60);
    const shake = stepSettings('access', doc, device, 'shake', 0).doc;
    expect(shake.accessibility.reduceShake).toBe(true);
  });

  it('os controles salvos vão para o perfil: sensibilidades multiplicam, assistência pelo nível, zonas só no controle', () => {
    const pad = createGamepadProfile('bottom');
    const c = { ...DEFAULT_SETTINGS.controls.gamepad, sensitivity: 2, aimAssist: 'light' as const, deadzoneInner: 0.3 };
    const p = applyControls(pad, c);
    expect(p.lookSensitivity).toBeCloseTo(pad.lookSensitivity * 2, 9);
    expect(p.aimAssist).toBe(AIM_ASSIST_LEVELS.light);
    expect(p.deadzoneInner).toBe(0.3);
    const kb = createKeyboardMouseProfile();
    const k = applyControls(kb, { ...DEFAULT_SETTINGS.controls.keyboardMouse, deadzoneInner: 0.3, invertY: true });
    expect(k.deadzoneInner).toBe(kb.deadzoneInner);
    expect(k.invertY).toBe(true);
    expect(k.aimAssist).toBe(0);
  });

  it('trocar de aba leva o foco de uma linha ou aba para a aba nova; um botão de baixo fica', () => {
    const menu = createMenuController();
    menu.focus('row:sens');
    followTab(menu, 3);
    expect(menu.focusedId).toBe('tab:3');
    followTab(menu, 4);
    expect(menu.focusedId).toBe('tab:4');
    menu.focus('back');
    followTab(menu, 0);
    expect(menu.focusedId).toBe('back');
  });
});
