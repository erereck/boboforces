import {
  AIM_ASSIST_NAMES,
  CONTROL_DEVICES,
  type ControlDevice,
  type DeviceControls,
  type SettingsDocument,
} from '@boboforces/format';
import { AIM_ASSIST_LEVELS, type ControlProfile } from '@boboforces/input';
import { t, type StringKey, type TabbedRow } from '@boboforces/ui';

/**
 * M2 (fase 4f): os Ajustes (gameplay.md §10.5), lógica pura sobre o `settings@1`. As abas Controles (por dispositivo),
 * Vídeo e Acessibilidade são linhas de opção com passo; Dados e Sobre são montadas pelo `game` (precisam da
 * plataforma). A pausa mostra só as 3 primeiras. `applyControls` leva os controles salvos para o perfil do input.
 */

export const SETTINGS_TABS = ['controls', 'video', 'access', 'data', 'about'] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];
/** As abas que a pausa mostra (Dados e Sobre ficam no menu). */
export const PAUSE_SETTINGS_TABS = ['controls', 'video', 'access'] as const satisfies readonly SettingsTab[];

export const SETTINGS_TAB_LABELS: Readonly<Record<SettingsTab, StringKey>> = {
  controls: 'settings.tab.controls',
  video: 'settings.tab.video',
  access: 'settings.tab.access',
  data: 'settings.tab.data',
  about: 'settings.tab.about',
};

interface OptionDef {
  readonly id: string;
  readonly labelKey: StringKey;
  /** Só para estes dispositivos (as zonas mortas são do controle). */
  readonly devices?: readonly ControlDevice[];
  value(doc: SettingsDocument, device: ControlDevice): string;
  step(doc: SettingsDocument, device: ControlDevice, delta: number): SettingsDocument;
}

const SENS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];
const SENS_Y = [0.5, 0.75, 1, 1.25, 1.5, 2];
const ADS = [0.25, 0.5, 0.75, 1, 1.25, 1.5];
const DEAD_IN = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3];
const DEAD_OUT = [0.8, 0.85, 0.9, 0.95, 1];
/** FOV horizontal; 0 = o padrão da plataforma. */
const FOVS = [0, 60, 65, 70, 75, 80, 85, 90, 95, 100, 105, 110];
const UI_SCALES = [0.8, 0.9, 1, 1.1, 1.2, 1.3];

function stepList(list: readonly number[], current: number, delta: number): number {
  let i = 0;
  for (let k = 1; k < list.length; k++) if (Math.abs(list[k]! - current) < Math.abs(list[i]! - current)) i = k;
  return list[Math.max(0, Math.min(list.length - 1, i + delta))]!;
}

const mult = (v: number): string => t('custom.mult', { n: v });
const onOff = (v: boolean): string => t(v ? 'custom.on' : 'custom.off');
const holdToggle = (v: boolean): string => t(v ? 'settings.toggle' : 'settings.hold');

function withDevice(doc: SettingsDocument, device: ControlDevice, c: Partial<DeviceControls>): SettingsDocument {
  return { ...doc, controls: { ...doc.controls, [device]: { ...doc.controls[device], ...c } } };
}

function control(
  id: string,
  labelKey: StringKey,
  value: (c: DeviceControls) => string,
  step: (c: DeviceControls, delta: number) => Partial<DeviceControls>,
  devices?: readonly ControlDevice[],
): OptionDef {
  return {
    id,
    labelKey,
    ...(devices ? { devices } : {}),
    value: (doc, device) => value(doc.controls[device]),
    step: (doc, device, delta) => withDevice(doc, device, step(doc.controls[device], delta)),
  };
}

const CONTROL_ROWS: readonly OptionDef[] = [
  control(
    'sens',
    'settings.row.sens',
    (c) => mult(c.sensitivity),
    (c, d) => ({ sensitivity: stepList(SENS, c.sensitivity, d) }),
  ),
  control(
    'sensY',
    'settings.row.sensY',
    (c) => mult(c.sensitivityYMul),
    (c, d) => ({
      sensitivityYMul: stepList(SENS_Y, c.sensitivityYMul, d),
    }),
  ),
  control(
    'ads',
    'settings.row.ads',
    (c) => mult(c.adsMul),
    (c, d) => ({ adsMul: stepList(ADS, c.adsMul, d) }),
  ),
  control(
    'invertY',
    'settings.row.invertY',
    (c) => onOff(c.invertY),
    (c) => ({ invertY: !c.invertY }),
  ),
  control(
    'assist',
    'settings.row.assist',
    (c) => t(`settings.assist.${c.aimAssist}` as StringKey),
    (c, d) => {
      const i = AIM_ASSIST_NAMES.indexOf(c.aimAssist);
      return { aimAssist: AIM_ASSIST_NAMES[Math.max(0, Math.min(AIM_ASSIST_NAMES.length - 1, i + d))]! };
    },
  ),
  control(
    'toggleAds',
    'settings.row.toggleAds',
    (c) => holdToggle(c.toggleAds),
    (c) => ({ toggleAds: !c.toggleAds }),
  ),
  control(
    'toggleCrouch',
    'settings.row.toggleCrouch',
    (c) => holdToggle(c.toggleCrouch),
    (c) => ({
      toggleCrouch: !c.toggleCrouch,
    }),
  ),
  control(
    'toggleSprint',
    'settings.row.toggleSprint',
    (c) => holdToggle(c.toggleSprint),
    (c) => ({
      toggleSprint: !c.toggleSprint,
    }),
  ),
  control(
    'deadIn',
    'settings.row.deadIn',
    (c) => t('settings.percent', { n: Math.round(c.deadzoneInner * 100) }),
    (c, d) => ({ deadzoneInner: stepList(DEAD_IN, c.deadzoneInner, d) }),
    ['gamepad'],
  ),
  control(
    'deadOut',
    'settings.row.deadOut',
    (c) => t('settings.percent', { n: Math.round(c.deadzoneOuter * 100) }),
    (c, d) => ({ deadzoneOuter: Math.max(c.deadzoneInner + 0.1, stepList(DEAD_OUT, c.deadzoneOuter, d)) }),
    ['gamepad'],
  ),
];

const VIDEO_ROWS: readonly OptionDef[] = [
  {
    id: 'fov',
    labelKey: 'settings.row.fov',
    value: (doc) => (doc.video.fovDeg === 0 ? t('settings.default') : t('settings.degrees', { n: doc.video.fovDeg })),
    step: (doc, _dev, d) => ({ ...doc, video: { ...doc.video, fovDeg: stepList(FOVS, doc.video.fovDeg, d) } }),
  },
  {
    id: 'uiScale',
    labelKey: 'settings.row.uiScale',
    value: (doc) => mult(doc.video.uiScale),
    step: (doc, _dev, d) => ({ ...doc, video: { ...doc.video, uiScale: stepList(UI_SCALES, doc.video.uiScale, d) } }),
  },
];

const ACCESS_ROWS: readonly OptionDef[] = [
  {
    id: 'shake',
    labelKey: 'settings.row.reduceShake',
    value: (doc) => onOff(doc.accessibility.reduceShake),
    step: (doc) => ({ ...doc, accessibility: { ...doc.accessibility, reduceShake: !doc.accessibility.reduceShake } }),
  },
  {
    id: 'tips',
    labelKey: 'settings.row.tips',
    value: (doc) => onOff(doc.accessibility.tips),
    step: (doc) => ({ ...doc, accessibility: { ...doc.accessibility, tips: !doc.accessibility.tips } }),
  },
];

function optionDefs(tab: SettingsTab, device: ControlDevice): readonly OptionDef[] {
  if (tab === 'controls') return CONTROL_ROWS.filter((r) => !r.devices || r.devices.includes(device));
  if (tab === 'video') return VIDEO_ROWS;
  if (tab === 'access') return ACCESS_ROWS;
  return [];
}

/** As linhas de opção da aba (Controles começa pela escolha do dispositivo que se está ajustando). */
export function settingsRows(tab: SettingsTab, doc: SettingsDocument, device: ControlDevice): TabbedRow[] {
  const rows: TabbedRow[] = [];
  if (tab === 'controls') {
    rows.push({
      kind: 'option',
      id: 'device',
      labelKey: 'settings.row.device',
      value: t(`settings.device.${device}` as StringKey),
    });
  }
  for (const r of optionDefs(tab, device)) {
    rows.push({ kind: 'option', id: r.id, labelKey: r.labelKey, value: r.value(doc, device) });
  }
  return rows;
}

/** Um passo numa linha (`delta` 0 = o confirmar, que avança). A linha `device` troca o dispositivo ajustado. */
export function stepSettings(
  tab: SettingsTab,
  doc: SettingsDocument,
  device: ControlDevice,
  id: string,
  delta: number,
): { doc: SettingsDocument; device: ControlDevice } {
  const d = delta === 0 ? 1 : delta;
  if (tab === 'controls' && id === 'device') {
    const i = CONTROL_DEVICES.indexOf(device);
    return { doc, device: CONTROL_DEVICES[(i + d + CONTROL_DEVICES.length) % CONTROL_DEVICES.length]! };
  }
  const row = optionDefs(tab, device).find((r) => r.id === id);
  return { doc: row ? row.step(doc, device, d) : doc, device };
}

/** Os controles salvos de um dispositivo sobre o perfil padrão dele (sensibilidades multiplicam o padrão). */
export function applyControls(base: ControlProfile, c: DeviceControls): ControlProfile {
  return {
    ...base,
    lookSensitivity: base.lookSensitivity * c.sensitivity,
    lookSensitivityYMul: base.lookSensitivityYMul * c.sensitivityYMul,
    adsSensitivityMul: base.adsSensitivityMul * c.adsMul,
    invertY: c.invertY,
    aimAssist: AIM_ASSIST_LEVELS[c.aimAssist],
    toggleAds: c.toggleAds,
    toggleCrouch: c.toggleCrouch,
    toggleSprint: c.toggleSprint,
    ...(base.device === 'gamepad' ? { deadzoneInner: c.deadzoneInner, deadzoneOuter: c.deadzoneOuter } : {}),
  };
}
