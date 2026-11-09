import { DEFAULT_SETTINGS } from '@boboforces/format';
import { AIM_ASSIST_LEVELS, createGamepadProfile, createKeyboardMouseProfile } from '@boboforces/input';
import { describe, expect, it } from 'vitest';
import { createMenuController, followTab } from './menu.ts';
import { applyControls, settingsRows, stepSettings } from './settings-menu.ts';

/** M2, fase 4f: a lógica dos Ajustes e os controles salvos no perfil do input. */

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
