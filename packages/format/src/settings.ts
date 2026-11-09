import { DocReader } from './doc-read.ts';
import { formatId, type FormatId } from './format-id.ts';
import { migrateDocument } from './migrations.ts';
import type { ValidationResult } from './validation.ts';

/**
 * M2 (fase 4b): `settings@1` (tecnico.md §14.2; gameplay.md §10.5; arte-ux.md §8): as preferências do aparelho, que
 * não são da partida. Controles por tipo de dispositivo, vídeo e acessibilidade; os volumes entram com o áudio
 * (fase 7). Dado solto: quem aplica no perfil de controle (`ControlProfile` do input) é o `game`.
 */
export const SETTINGS_FORMAT: FormatId = formatId('settings');

/** Assistência de mira (arte-ux.md §8): Desligada, Leve, Média, Forte. */
export const AIM_ASSIST_NAMES = ['off', 'light', 'medium', 'strong'] as const;
export type AimAssistName = (typeof AIM_ASSIST_NAMES)[number];

/** Qualidade gráfica (arte-ux.md §1.12): `auto` = a escolhida na primeira abertura pelo perfil do aparelho. */
export const QUALITY_NAMES = ['auto', 'low', 'medium', 'high'] as const;
export type QualityName = (typeof QUALITY_NAMES)[number];

/** Os três tipos de dispositivo com controles próprios. */
export const CONTROL_DEVICES = ['keyboardMouse', 'gamepad', 'touch'] as const;
export type ControlDevice = (typeof CONTROL_DEVICES)[number];

/** Controles de um tipo de dispositivo. Sensibilidades são multiplicadores sobre o padrão do perfil. */
export interface DeviceControls {
  readonly sensitivity: number;
  readonly sensitivityYMul: number;
  readonly adsMul: number;
  readonly invertY: boolean;
  readonly aimAssist: AimAssistName;
  readonly toggleAds: boolean;
  readonly toggleCrouch: boolean;
  readonly toggleSprint: boolean;
  /** Zonas mortas do analógico (só controle): interna e externa. */
  readonly deadzoneInner: number;
  readonly deadzoneOuter: number;
  /**
   * Trocas de botão (fase 4f): ação → fontes (`"key:KeyQ"`, `"pad:bumperLeft"`…). Só as ações trocadas; o resto é o
   * padrão do perfil.
   */
  readonly bindings: Readonly<Record<string, readonly string[]>>;
}

/** M2 (fase 6b): a câmera do jogador (gameplay.md §3.5): 1ª pessoa (padrão) ou 3ª, de ombro. */
export const VIEW_MODES = ['first', 'third'] as const;
export type ViewMode = (typeof VIEW_MODES)[number];
export const SHOULDERS = ['right', 'left'] as const;
export type Shoulder = (typeof SHOULDERS)[number];

export interface VideoSettings {
  readonly quality: QualityName;
  /** Tamanho da UI (multiplica a escala da referência 1280×720). */
  readonly uiScale: number;
  /** Campo de visão horizontal em graus; `0` = o padrão da plataforma. */
  readonly fovDeg: number;
  /** M2 (fase 6b): 1ª ou 3ª pessoa, e o ombro da 3ª (a regra "Câmera permitida" da partida pode forçar a 1ª). */
  readonly view: ViewMode;
  readonly shoulder: Shoulder;
}

export interface AccessibilitySettings {
  /** Tremor de câmera reduzido (explosões, dano). */
  readonly reduceShake: boolean;
  /** Cores de time para daltônico. */
  readonly colorblindTeams: boolean;
  /** Dicas de 1 linha nas primeiras partidas (gameplay.md §2.5). */
  readonly tips: boolean;
  /** Tamanho do HUD. */
  readonly hudScale: number;
}

export interface SettingsDocument {
  readonly format: FormatId;
  readonly controls: Readonly<Record<ControlDevice, DeviceControls>>;
  readonly video: VideoSettings;
  readonly accessibility: AccessibilitySettings;
}

/** Faixas dos números (o validador limita e avisa). */
export const SETTINGS_RANGES = {
  sensitivity: { min: 0.1, max: 5 },
  sensitivityYMul: { min: 0.25, max: 4 },
  adsMul: { min: 0.1, max: 2 },
  deadzoneInner: { min: 0, max: 0.5 },
  deadzoneOuter: { min: 0.5, max: 1 },
  uiScale: { min: 0.8, max: 1.3 },
  fovDeg: { min: 60, max: 110 },
  hudScale: { min: 0.8, max: 1.3 },
  bindingActions: 64,
  bindingSources: 4,
  bindingLength: 40,
} as const;

function deviceDefaults(aimAssist: AimAssistName): DeviceControls {
  return {
    sensitivity: 1,
    sensitivityYMul: 1,
    adsMul: 1,
    invertY: false,
    aimAssist,
    toggleAds: false,
    toggleCrouch: false,
    toggleSprint: false,
    deadzoneInner: 0.15,
    deadzoneOuter: 0.95,
    bindings: {},
  };
}

/** Padrões (gameplay.md §10.5): assistência Desligada no mouse, Média no controle e no toque. */
export const DEFAULT_SETTINGS: SettingsDocument = {
  format: SETTINGS_FORMAT,
  controls: {
    keyboardMouse: deviceDefaults('off'),
    gamepad: deviceDefaults('medium'),
    touch: deviceDefaults('medium'),
  },
  video: { quality: 'auto', uiScale: 1, fovDeg: 0, view: 'first', shoulder: 'right' },
  accessibility: { reduceShake: false, colorblindTeams: false, tips: true, hudScale: 1 },
};

function readDevice(r: DocReader, src: Record<string, unknown>, path: string, d: DeviceControls): DeviceControls {
  const R = SETTINGS_RANGES;
  const b = r.obj(src, 'bindings', `${path}.bindings`);
  const bindings: Record<string, string[]> = {};
  let n = 0;
  for (const action of Object.keys(b)) {
    if (n === R.bindingActions) {
      r.warn(`${path}.bindings`, 'save.valueClamped', `mais de ${R.bindingActions} ações`);
      break;
    }
    const list = r.strings(b, action, `${path}.bindings.${action}`, R.bindingSources, R.bindingLength);
    bindings[action] = list;
    n++;
  }
  const inner = r.num(
    src,
    'deadzoneInner',
    `${path}.deadzoneInner`,
    d.deadzoneInner,
    R.deadzoneInner.min,
    R.deadzoneInner.max,
  );
  const outer = r.num(
    src,
    'deadzoneOuter',
    `${path}.deadzoneOuter`,
    d.deadzoneOuter,
    R.deadzoneOuter.min,
    R.deadzoneOuter.max,
  );
  return {
    sensitivity: r.num(src, 'sensitivity', `${path}.sensitivity`, d.sensitivity, R.sensitivity.min, R.sensitivity.max),
    sensitivityYMul: r.num(
      src,
      'sensitivityYMul',
      `${path}.sensitivityYMul`,
      d.sensitivityYMul,
      R.sensitivityYMul.min,
      R.sensitivityYMul.max,
    ),
    adsMul: r.num(src, 'adsMul', `${path}.adsMul`, d.adsMul, R.adsMul.min, R.adsMul.max),
    invertY: r.bool(src, 'invertY', `${path}.invertY`, d.invertY),
    aimAssist: r.pick(src, 'aimAssist', `${path}.aimAssist`, d.aimAssist, AIM_ASSIST_NAMES),
    toggleAds: r.bool(src, 'toggleAds', `${path}.toggleAds`, d.toggleAds),
    toggleCrouch: r.bool(src, 'toggleCrouch', `${path}.toggleCrouch`, d.toggleCrouch),
    toggleSprint: r.bool(src, 'toggleSprint', `${path}.toggleSprint`, d.toggleSprint),
    deadzoneInner: inner,
    // A externa nunca fica abaixo da interna + 0,1.
    deadzoneOuter: Math.max(outer, inner + 0.1),
    bindings,
  };
}

/**
 * Valida e completa um `settings@1`: recusa só o que não é objeto ou é de outro tipo (ou de versão mais nova); o
 * resto cai no padrão ou é limitado à faixa, com aviso.
 */
export function validateSettings(input: unknown): ValidationResult<SettingsDocument> {
  const migrated = migrateDocument(input, 'settings');
  if (!migrated.ok) return migrated;
  const doc = migrated.value;
  const r = new DocReader('save.invalidField', 'save.valueClamped');
  r.warnings.push(...migrated.warnings);
  const R = SETTINGS_RANGES;
  const D = DEFAULT_SETTINGS;
  const c = r.obj(doc, 'controls', 'controls');
  const v = r.obj(doc, 'video', 'video');
  const a = r.obj(doc, 'accessibility', 'accessibility');
  const fov = r.num(v, 'fovDeg', 'video.fovDeg', D.video.fovDeg, 0, R.fovDeg.max);
  if (fov !== 0 && fov < R.fovDeg.min) r.warn('video.fovDeg', 'save.valueClamped', `${fov} → ${R.fovDeg.min}`);
  const value: SettingsDocument = {
    format: SETTINGS_FORMAT,
    controls: {
      keyboardMouse: readDevice(
        r,
        r.obj(c, 'keyboardMouse', 'controls.keyboardMouse'),
        'controls.keyboardMouse',
        D.controls.keyboardMouse,
      ),
      gamepad: readDevice(r, r.obj(c, 'gamepad', 'controls.gamepad'), 'controls.gamepad', D.controls.gamepad),
      touch: readDevice(r, r.obj(c, 'touch', 'controls.touch'), 'controls.touch', D.controls.touch),
    },
    video: {
      quality: r.pick(v, 'quality', 'video.quality', D.video.quality, QUALITY_NAMES),
      uiScale: r.num(v, 'uiScale', 'video.uiScale', D.video.uiScale, R.uiScale.min, R.uiScale.max),
      fovDeg: fov === 0 ? 0 : Math.max(fov, R.fovDeg.min),
      view: r.pick(v, 'view', 'video.view', D.video.view, VIEW_MODES),
      shoulder: r.pick(v, 'shoulder', 'video.shoulder', D.video.shoulder, SHOULDERS),
    },
    accessibility: {
      reduceShake: r.bool(a, 'reduceShake', 'accessibility.reduceShake', D.accessibility.reduceShake),
      colorblindTeams: r.bool(a, 'colorblindTeams', 'accessibility.colorblindTeams', D.accessibility.colorblindTeams),
      tips: r.bool(a, 'tips', 'accessibility.tips', D.accessibility.tips),
      hudScale: r.num(
        a,
        'hudScale',
        'accessibility.hudScale',
        D.accessibility.hudScale,
        R.hudScale.min,
        R.hudScale.max,
      ),
    },
  };
  return { ok: true, value, warnings: r.warnings };
}
