import { GAME_CODENAME, GAME_VERSION, type BackupDocument, type ControlDevice } from '@boboforces/format';
import {
  createBindingCapture,
  type CaptureResult,
  type MenuInput,
  type RawInputState,
  type RemapAction,
} from '@boboforces/input';
import type { Platform } from '@boboforces/platform-api';
import type { Renderer } from '@boboforces/render/data';
import { decodeUtf8 } from '@boboforces/shared';
import {
  SETTINGS_ACTION,
  SETTINGS_ROW_PREFIX,
  SETTINGS_TAB_PREFIX,
  settingsScreen,
  t,
  type DrawList,
  type TabbedRow,
} from '@boboforces/ui';
import { createMenuController, followTab, type UiFrame } from './menu.ts';
import { applyBackup, exportBackup, readBackup } from './save-backup.ts';
import type { SaveStore } from './save-store.ts';
import {
  actionLabel,
  bindRowAction,
  rebindSettings,
  SETTINGS_TAB_LABELS,
  SETTINGS_TABS,
  settingsHelp,
  settingsRows,
  stepSettings,
} from './settings-menu.ts';
import { statsLines } from './stats-lines.ts';

/**
 * M2 (fase 4f): os Ajustes do menu (gameplay.md §10.5): as abas de opção (`settings-menu.ts`), a captura do botão novo
 * (aba Botões), Dados (estatísticas e o backup em arquivo) e Sobre (versão, créditos, relatório e a Novidades).
 * M9 (fase 0): a tela inteira mora no pedaço dos editores (antes no `game.ts`; o menu da web estava no teto de 350 KB),
 * como a Oficina; o `game` só abre, desenha e segue o que ela pede (voltar, a Novidades, Calibrar mira).
 */
export interface SettingsDeps {
  readonly platform: Platform;
  readonly save: SaveStore;
  /** O renderer em uso agora (o relatório lê as estatísticas dele; na web ele troca na 1ª cena). */
  renderer(): Renderer;
  /** Uma linha no registro da plataforma (o relatório que não deu para copiar vai para lá). */
  log(line: string): void;
  /** O backup foi aplicado: o título refaz o resumo do JOGAR. */
  imported(): void;
}

/** O que o frame pede ao `game`: seguir aberto, voltar ao título, abrir a Novidades ou o Calibrar mira. */
export type SettingsOutcome = 'open' | 'back' | 'news' | 'calibrate';

export interface SettingsFlow {
  /** Abre na 1ª aba, ajustando o dispositivo do último aperto (`null` = o mesmo da última vez). */
  open(lastDevice: ControlDevice | null): void;
  /** 1x por frame com os Ajustes abertos (desenha em `list`, inclusive no frame em que pede para sair). */
  frame(menu: MenuInput, raw: Readonly<RawInputState>, ui: UiFrame, list: DrawList): SettingsOutcome;
}

export function createSettingsFlow(deps: SettingsDeps): SettingsFlow {
  const { platform, save } = deps;
  const menu = createMenuController();
  let tab = 0;
  let device: ControlDevice = platform.id === 'switch' ? 'gamepad' : 'keyboardMouse';
  let note = '';
  /** O backup lido do arquivo, esperando "Juntar" ou "Substituir". */
  let pendingBackup: BackupDocument | null = null;
  /** Refino R3c: o foco com que a tela foi montada (a frase de ajuda é dele). */
  let helpFocus: string | null = null;
  /** M2 (fase 4f, parte 2): a captura do novo botão de uma ação (aba Botões). */
  const capture = createBindingCapture();
  let capturing: RemapAction | null = null;

  function dataRows(): TabbedRow[] {
    // M2 (fase 4g): as estatísticas e os recordes do aparelho em cima.
    const stats: TabbedRow[] = statsLines(save.stats).map((text, i) => ({ kind: 'text', id: `stats${i}`, text }));
    if (platform.files === null) {
      return [...stats, { kind: 'text', id: 'none', text: t('settings.data.none'), dim: true }];
    }
    const rows: TabbedRow[] = [
      ...stats,
      { kind: 'text', id: 'warning', text: t('settings.data.warning'), dim: true },
      { kind: 'text', id: 'warning2', text: t('settings.data.warning2'), dim: true },
      { kind: 'action', id: 'export', label: { key: 'settings.data.export' } },
      { kind: 'action', id: 'import', label: { key: 'settings.data.import' } },
    ];
    if (pendingBackup !== null) {
      rows.push(
        {
          kind: 'text',
          id: 'found',
          text: t('settings.data.found', {
            presets: pendingBackup.presets.saved.length,
            bots: pendingBackup.bots.length,
          }),
        },
        { kind: 'action', id: 'merge', label: { key: 'settings.data.merge' } },
        { kind: 'action', id: 'replace', label: { key: 'settings.data.replace' }, variant: 'danger' },
        { kind: 'action', id: 'cancel', label: { key: 'settings.data.cancel' } },
      );
    }
    return rows;
  }

  function aboutRows(): TabbedRow[] {
    return [
      { kind: 'text', id: 'version', text: t('title.version', { version: GAME_VERSION, codename: GAME_CODENAME }) },
      { kind: 'text', id: 'credit', text: t('title.credit') },
      { kind: 'text', id: 'fonts', text: t('settings.about.fonts'), dim: true },
      { kind: 'text', id: 'fonts2', text: t('settings.about.fonts2'), dim: true },
      { kind: 'text', id: 'three', text: t('settings.about.three'), dim: true },
      { kind: 'action', id: 'copy', label: { key: 'settings.about.copy' } },
      // Refino R3b (#79): a Novidades mora aqui (saiu do menu principal).
      { kind: 'action', id: 'news', label: { key: 'menu.news' } },
    ];
  }

  function rebuild(): void {
    const id = SETTINGS_TABS[tab]!;
    helpFocus = menu.focusedId;
    menu.setRoot(
      settingsScreen.build({
        tabs: SETTINGS_TABS.map((s) => SETTINGS_TAB_LABELS[s]),
        tab,
        rows:
          id === 'data'
            ? dataRows()
            : id === 'about'
              ? aboutRows()
              : id === 'controls'
                ? [
                    ...settingsRows(id, save.settings, device, capturing, platform.features.keyboardMouse),
                    // M2 (fase 5f): abre o Bobo Training já calibrando a mira.
                    { kind: 'action', id: 'calibrate', label: { key: 'settings.row.calibrate' } },
                  ]
                : settingsRows(id, save.settings, device, capturing, platform.features.keyboardMouse),
        note,
        help: settingsHelp(SETTINGS_TABS, id, helpFocus, device),
      }),
    );
  }

  /** Fim da captura: liga a fonte nova (com o aviso de troca, se houver) ou cancela. */
  function finishCapture(result: CaptureResult): void {
    if (capturing === null || result === 'none') return;
    if (result === 'cancel') note = '';
    else {
      const next = rebindSettings(save.settings, device, capturing, result, platform.features.keyboardMouse);
      if (next.doc !== save.settings) save.setSettings(next.doc);
      note = next.note;
    }
    capturing = null;
    rebuild();
  }

  /** Texto do relatório (#42): versão, plataforma, render e as últimas linhas do registro. */
  function reportText(): string {
    const renderer = deps.renderer();
    const stats = renderer.stats;
    return [
      `BoboForces ${GAME_VERSION} (${GAME_CODENAME})`,
      `plataforma: ${platform.id} · perfil: ${platform.features.profileHint}`,
      `render: ${renderer.info.textureMode} · programas ${stats.programs} · draw calls ${stats.drawCalls}`,
      'registro:',
      ...(platform.diagnostics.recentLog?.(40) ?? []),
    ].join('\n');
  }

  /** As linhas de ação de Dados e Sobre; `news` pede a Novidades ao `game`. */
  function dataAction(id: string): SettingsOutcome {
    const show = (text: string): void => {
      note = text;
      rebuild();
    };
    if (id === 'export' && platform.files !== null) {
      const date = new Date().toISOString();
      const name = `boboforces-backup-${date.slice(0, 10)}.json`;
      void platform.files
        .save(name, exportBackup(save, date, GAME_VERSION), 'application/json')
        .then((ok) => show(ok ? t('settings.data.exported', { name }) : t('settings.data.exportFailed')));
    } else if (id === 'import' && platform.files !== null) {
      void platform.files.pick(['.json']).then((file) => {
        if (file === null) return;
        const read = readBackup(save, decodeUtf8(file.bytes));
        pendingBackup = read.ok ? read.value : null;
        show(read.ok ? '' : t('settings.data.invalid'));
      });
    } else if ((id === 'merge' || id === 'replace') && pendingBackup !== null) {
      applyBackup(save, pendingBackup, id);
      pendingBackup = null;
      deps.imported();
      show(t('settings.data.imported'));
    } else if (id === 'cancel') {
      pendingBackup = null;
      show('');
    } else if (id === 'news') {
      return 'news';
    } else if (id === 'copy') {
      const text = reportText();
      const clip = platform.clipboard;
      if (clip === undefined) {
        deps.log(text);
        show(t('settings.about.copyFailed'));
      } else {
        void clip.writeText(text).then((ok) => {
          if (!ok) deps.log(text);
          show(t(ok ? 'settings.about.copied' : 'settings.about.copyFailed'));
        });
      }
    }
    return 'open';
  }

  return {
    open(lastDevice) {
      tab = 0;
      capture.stop();
      capturing = null;
      note = '';
      pendingBackup = null;
      if (lastDevice !== null) device = lastDevice;
      rebuild();
    },
    frame(input, raw, ui, list) {
      // Capturando um botão (e esperando soltar tudo depois): o menu não anda.
      if (capture.active) {
        finishCapture(capture.update(raw));
        menu.draw(list, ui);
        return 'open';
      }
      const nav = menu.update(input, raw, ui);
      const a = nav.activated;
      let outcome: SettingsOutcome = 'open';
      if (nav.tab !== 0) {
        tab = (tab + nav.tab + SETTINGS_TABS.length) % SETTINGS_TABS.length;
        followTab(menu, tab);
        note = '';
        rebuild();
      } else if (nav.back || a === SETTINGS_ACTION.back) outcome = 'back';
      else if (a !== null && a.startsWith(SETTINGS_TAB_PREFIX)) {
        tab = Number(a.slice(SETTINGS_TAB_PREFIX.length));
        note = '';
        rebuild();
      } else if (a !== null && a.startsWith(SETTINGS_ROW_PREFIX)) {
        const id = a.slice(SETTINGS_ROW_PREFIX.length);
        const current = SETTINGS_TABS[tab]!;
        const bind = current === 'buttons' ? bindRowAction(id, device) : null;
        if (current === 'data' || current === 'about') outcome = dataAction(id);
        else if (current === 'controls' && id === 'calibrate') outcome = 'calibrate';
        else if (bind !== null) {
          capturing = bind;
          capture.start(raw, device === 'gamepad' ? 'gamepad' : 'keyboardMouse');
          note = t('settings.bind.press', { action: t(actionLabel(bind)) });
          rebuild();
        } else {
          const next = stepSettings(current, save.settings, device, id, nav.delta);
          device = next.device;
          if (next.doc !== save.settings) save.setSettings(next.doc);
          note = current === 'buttons' && id === 'reset' ? t('settings.bind.resetDone') : '';
          rebuild();
        }
      }
      // Refino R3c: a frase de ajuda segue o foco.
      if (outcome === 'open' && menu.focusedId !== helpFocus) rebuild();
      // Como antes: o frame que sai ainda desenha os Ajustes (a próxima tela desenha no frame seguinte).
      menu.draw(list, ui);
      return outcome;
    },
  };
}
