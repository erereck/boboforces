import {
  AIM_ASSIST_NAMES,
  CONTROL_DEVICES,
  type ControlDevice,
  type DeviceControls,
  type SettingsDocument,
} from '@boboforces/format';
import {
  AIM_ASSIST_LEVELS,
  applyBindings,
  defaultProfileFor,
  isCtrlBinding,
  isReservedSource,
  KEY_CODES,
  MOUSE_BUTTON,
  PAD_AXIS,
  PAD_BUTTON,
  profileBindings,
  rebind,
  REMAP_ACTIONS,
  TOUCH_CONTROLS,
  type BindingSource,
  type ControlProfile,
  type RemapAction,
} from '@boboforces/input';
import { t, type StringKey, type TabbedRow } from '@boboforces/ui';

/**
 * M2 (fase 4f): os Ajustes (gameplay.md §10.5), lógica pura sobre o `settings@1`. As abas Controles (por dispositivo),
 * Vídeo e Acessibilidade são linhas de opção com passo; Dados e Sobre são montadas pelo `game` (precisam da
 * plataforma). A pausa mostra as 4 primeiras. `applyControls` leva os controles salvos para o perfil do input.
 * Botões (parte 2): uma linha por ação remapeável; confirmar abre a captura (`createBindingCapture`, no `game`).
 */

export const SETTINGS_TABS = ['controls', 'buttons', 'video', 'access', 'data', 'about'] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];
/** As abas que a pausa mostra (Dados e Sobre ficam no menu). */
export const PAUSE_SETTINGS_TABS = ['controls', 'buttons', 'video', 'access'] as const satisfies readonly SettingsTab[];

export const SETTINGS_TAB_LABELS: Readonly<Record<SettingsTab, StringKey>> = {
  controls: 'settings.tab.controls',
  buttons: 'settings.tab.buttons',
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
  // M2 (fase 6b): 1ª ou 3ª pessoa e o ombro (na partida: T e X no teclado, direcional dos lados no controle).
  {
    id: 'view',
    labelKey: 'settings.row.view',
    value: (doc) => t(doc.video.view === 'third' ? 'settings.view.third' : 'settings.view.first'),
    step: (doc) => ({ ...doc, video: { ...doc.video, view: doc.video.view === 'third' ? 'first' : 'third' } }),
  },
  {
    id: 'shoulder',
    labelKey: 'settings.row.shoulder',
    value: (doc) => t(doc.video.shoulder === 'left' ? 'settings.shoulder.left' : 'settings.shoulder.right'),
    step: (doc) => ({ ...doc, video: { ...doc.video, shoulder: doc.video.shoulder === 'left' ? 'right' : 'left' } }),
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

/**
 * As linhas de opção da aba (Controles e Botões começam pela escolha do dispositivo que se está ajustando).
 * `capturing`: a ação cuja linha mostra "Aperte..." enquanto a captura espera.
 */
export function settingsRows(
  tab: SettingsTab,
  doc: SettingsDocument,
  device: ControlDevice,
  capturing: RemapAction | null = null,
): TabbedRow[] {
  const rows: TabbedRow[] = [];
  if (tab === 'controls' || tab === 'buttons') {
    rows.push({
      kind: 'option',
      id: 'device',
      labelKey: 'settings.row.device',
      value: t(`settings.device.${device}` as StringKey),
    });
  }
  if (tab === 'buttons') {
    if (device === 'touch') rows.push({ kind: 'text', id: 'touch', text: t('settings.bind.touch'), dim: true });
    else {
      const profile = boundProfile(doc, device);
      for (const a of REMAP_ACTIONS[device]) {
        rows.push({
          kind: 'value',
          id: `${BIND_ROW_PREFIX}${a}`,
          labelKey: actionLabel(a),
          value: a === capturing ? t('settings.bind.waiting') : bindingsText(profileBindings(profile, a)),
        });
      }
      rows.push({ kind: 'action', id: 'reset', label: { key: 'settings.bind.reset' } });
    }
    return rows;
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
  if (tab === 'buttons' && id === 'reset') return { doc: withDevice(doc, device, { bindings: {} }), device };
  if ((tab === 'controls' || tab === 'buttons') && id === 'device') {
    const i = CONTROL_DEVICES.indexOf(device);
    return { doc, device: CONTROL_DEVICES[(i + d + CONTROL_DEVICES.length) % CONTROL_DEVICES.length]! };
  }
  const row = optionDefs(tab, device).find((r) => r.id === id);
  return { doc: row ? row.step(doc, device, d) : doc, device };
}

/**
 * Os controles salvos de um dispositivo sobre o perfil padrão dele (sensibilidades multiplicam o padrão; os botões
 * salvos trocam os do perfil).
 */
export function applyControls(base: ControlProfile, c: DeviceControls): ControlProfile {
  return {
    ...applyBindings(base, c.bindings),
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

// --- Botões (M2, fase 4f, parte 2) ---

/** As linhas de botão são `row:bind:<ação>`. */
export const BIND_ROW_PREFIX = 'bind:';

/** A ação de uma linha de botão (`bind:<ação>`), ou `null`. */
export function bindRowAction(id: string, device: ControlDevice): RemapAction | null {
  if (device === 'touch' || !id.startsWith(BIND_ROW_PREFIX)) return null;
  const a = id.slice(BIND_ROW_PREFIX.length);
  return (REMAP_ACTIONS[device] as readonly string[]).includes(a) ? (a as RemapAction) : null;
}

export function actionLabel(a: RemapAction): StringKey {
  return `bind.action.${a}` as StringKey;
}

/** O perfil padrão do dispositivo com os botões salvos (só os botões importam aqui). */
function boundProfile(doc: SettingsDocument, device: ControlDevice): ControlProfile {
  return applyBindings(defaultProfileFor(device), doc.controls[device].bindings);
}

/** Os controles de toque com nome na tabela (`touch.*`). */
const TOUCH_LABELS: ReadonlySet<string> = new Set(TOUCH_CONTROLS);

function nameOf(table: Readonly<Record<string, number>>, v: number): string {
  return Object.keys(table).find((k) => table[k] === v) ?? '';
}

/** O nome de uma fonte na tela: letras e números direto; o resto pela tabela (os do controle, pela posição). */
export function bindingLabel(s: BindingSource): string {
  let name: string;
  switch (s.device) {
    case 'key': {
      const code = KEY_CODES[s.key] ?? 'Unknown';
      if (/^Key[A-Z]$/.test(code)) name = code.slice(3);
      else if (/^Digit[0-9]$/.test(code)) name = code.slice(5);
      else if (/^F[0-9]{1,2}$/.test(code)) name = code;
      else name = t(`bind.key.${code}` as StringKey);
      break;
    }
    case 'mouseButton':
      name = t(`bind.mouse.${nameOf(MOUSE_BUTTON, s.button)}` as StringKey);
      break;
    case 'wheel':
      name = t(s.direction > 0 ? 'bind.wheel.down' : 'bind.wheel.up');
      break;
    case 'padButton':
      name = t(`bind.pad.${nameOf(PAD_BUTTON, s.button)}` as StringKey);
      break;
    case 'padAxis':
      name = t(`bind.axis.${nameOf(PAD_AXIS, s.axis)}` as StringKey);
      break;
    case 'touchControl':
      // O nome do botão desenhado na tela ("Recarga").
      name = TOUCH_LABELS.has(s.control) ? t(`touch.${s.control}` as StringKey) : t('bind.touch');
      break;
  }
  return s.hold ? t('settings.bind.hold', { name }) : name;
}

/** O valor da linha: a primeira fonte e "+N" para as outras; "Nenhum" sem nada. */
export function bindingsText(list: readonly BindingSource[]): string {
  if (list.length === 0) return t('settings.bind.none');
  const first = bindingLabel(list[0]!);
  return list.length === 1 ? first : t('settings.bind.more', { name: first, n: list.length - 1 });
}

/**
 * Liga a ação à fonte capturada e devolve o documento novo e o aviso: a troca com outra ação, a ação que ficou sem
 * botão, o Ctrl do navegador ou a recusa (a fonte é da pausa; o documento não muda).
 */
export function rebindSettings(
  doc: SettingsDocument,
  device: ControlDevice,
  action: RemapAction,
  source: BindingSource,
): { doc: SettingsDocument; note: string } {
  if (device === 'touch') return { doc, note: '' };
  const base = defaultProfileFor(device);
  const label = bindingLabel(source);
  if (isReservedSource(base, source)) return { doc, note: t('settings.bind.reserved', { source: label }) };
  const r = rebind(base, doc.controls[device].bindings, action, source);
  const next = withDevice(doc, device, { bindings: r.bindings });
  let note = '';
  if (r.swapped !== null) {
    const other = t(actionLabel(r.swapped));
    note = t(r.orphaned ? 'settings.bind.orphaned' : 'settings.bind.swapped', { source: label, other });
  } else if (isCtrlBinding(source)) note = t('binding.ctrlReserved');
  return { doc: next, note };
}
