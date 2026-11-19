import {
  decodeShareCode,
  encodeShareCode,
  importShareCode,
  RECIPE_RANGES,
  validateMatchRecipe,
  shareCodeFromHash,
  shareKindOf,
  shareLinkHash,
  type BotDocument,
  type MatchRecipe,
  type RecipeLimits,
  type ShareKind,
  type SquadDocument,
  type ValidationIssue,
} from '@boboforces/format';
import type { MenuInput, RawInputState } from '@boboforces/input';
import type { Platform, TextInputSession } from '@boboforces/platform-api';
import type { Rng } from '@boboforces/shared';
import { SHARE_ACTION, shareScreen, t, type DrawList, type ShareMode, type StringKey } from '@boboforces/ui';
import { botCardLines, botDisplayName, copyName, newBotId } from './bot-card.ts';
import { newSquadId } from './workshop.ts';
import {
  SURPRISE_LINES,
  surpriseCodeIsNewer,
  surpriseDetails,
  surpriseFromCode,
  surpriseLineText,
  surpriseRecipe,
} from './surprise.ts';
import { presetName } from './custom-match.ts';
import { rollBotName } from './lab.ts';
import { createMenuController, type UiFrame } from './menu.ts';
import { presetLines } from './presets-ui.ts';
import type { SaveStore } from './save-store.ts';

/**
 * M8 (fase 1): compartilhar e receber bots e presets por código e por link (GDD §4.8), no pedaço dos editores (o menu
 * da web está no teto de 350 KB): o `game` só abre e fecha a tela. Só na web: o Switch não cola texto nem tem rede e
 * segue com os arquivos do SD (pergunta Z2).
 */
export interface ShareFlowDeps {
  readonly platform: Platform;
  readonly save: SaveStore;
  /** O teto do aparelho (o preset recebido corta nele, regra 19). */
  readonly limits: RecipeLimits;
  /** O link inteiro de um hash (`#bot=…`), montado pela casca da web; `null` = sem link. */
  readonly linkFor: ((hash: string) => string) | null;
  readonly rng: Rng;
  readonly factoryBots: readonly BotDocument[];
  /** Joga o preset recebido (o `game` troca de tela). */
  play(preset: MatchRecipe): void;
}

/** O que a tela deixou ao fechar: o bot salvo (para a Oficina mostrar) e o aviso. */
export type ShareOutcome =
  { readonly open: true } | { readonly open: false; readonly savedBot: string | null; readonly note: string };

export interface ShareFlow {
  /** Mostra o código do bot, do esquadrão ou do preset escolhido (Copiar código, Copiar link, Colar um código). */
  openExport(kind: 'bot' | 'squad' | 'preset', doc: BotDocument | SquadDocument | MatchRecipe, name: string): void;
  /** Espera um código colado. */
  openPaste(): void;
  /** Abre um código que já chegou (o link). */
  openCode(code: string): void;
  /** O jeito da tela agora (os testes). */
  readonly mode: ShareMode;
  /** Um botão da tela (o `frame` chama pelo menu; os testes, direto). */
  act(action: string): void;
  /** 1x por frame com a tela aberta (desenha em `list`). */
  frame(menu: MenuInput, raw: Readonly<RawInputState>, ui: UiFrame, list: DrawList): ShareOutcome;
}

const OPEN: ShareOutcome = { open: true };

/** O teto do campo de colar (o código tem até 4.000; espaços e quebras de linha no meio também entram). */
const PASTE_MAX_CHARS = 8000;

function anyInputHeld(raw: Readonly<RawInputState>): boolean {
  if (raw.mouseButtons !== 0) return true;
  for (let k = 0; k < raw.keys.length; k++) if (raw.keys[k] === 1) return true;
  for (const pad of raw.gamepads) {
    if (!pad.connected) continue;
    for (let b = 0; b < pad.buttons.length; b++) if (pad.buttons[b]! >= 0.5) return true;
  }
  return false;
}

/** O resumo do que mudou: uma linha por tipo de aviso (o texto do `issue.*`), sem repetir. */
export function issueLines(issues: readonly ValidationIssue[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of issues) {
    if (seen.has(w.code)) continue;
    seen.add(w.code);
    out.push(t(`issue.${w.code}` as StringKey));
  }
  return out;
}

/** Dá para copiar e colar aqui? (a web; o Switch segue com os arquivos do SD) */
export function shareAvailable(platform: Platform): { readonly copy: boolean; readonly paste: boolean } {
  const web = platform.id !== 'switch';
  return { copy: web && platform.clipboard !== undefined, paste: web && platform.textInput.available };
}

export function createShareFlow(deps: ShareFlowDeps): ShareFlow {
  const { platform, save } = deps;
  const menu = createMenuController();
  const can = shareAvailable(platform);
  let mode: ShareMode = 'export';
  let title = '';
  let lines: string[] = [];
  let note = '';
  /** O código do que se mostra (`null` = grande demais). */
  let exportCode: string | null = null;
  let exportName = '';
  let exportKind: 'bot' | 'squad' | 'preset' = 'bot';
  let fromExport = false;
  let receivedBot: BotDocument | null = null;
  let receivedPreset: MatchRecipe | null = null;
  let receivedSquad: SquadDocument | null = null;
  /** A partida recebida já foi salva (o botão Salvar some: cada aperto faria outra cópia). */
  let presetSaved = false;
  let typing: TextInputSession | null = null;
  let hold = false;
  let result: ShareOutcome | null = null;

  function rebuild(): void {
    menu.setRoot(
      shareScreen.build({
        mode,
        title,
        lines,
        note,
        canCopy: can.copy && (mode !== 'export' || exportCode !== null),
        // O esquadrão não tem link (GDD §4.8: só o bot e o preset); o código basta.
        canLink: deps.linkFor !== null && !(mode === 'export' && exportKind === 'squad'),
        canPaste: can.paste,
        ...(presetSaved ? { saved: true } : {}),
      }),
    );
  }

  function close(savedBot: string | null, closingNote: string): void {
    typing?.close();
    typing = null;
    result = { open: false, savedBot, note: closingNote };
  }

  function showExport(): void {
    mode = 'export';
    title = t(
      exportKind === 'bot' ? 'share.exportBot' : exportKind === 'squad' ? 'share.exportSquad' : 'share.exportPreset',
      { name: exportName },
    );
    lines =
      exportCode === null
        ? [t('share.tooLong')]
        : [
            t('share.exportSize', { n: exportCode.length }),
            t(
              exportKind === 'bot'
                ? 'share.exportHintBot'
                : exportKind === 'squad'
                  ? 'share.exportHintSquad'
                  : 'share.exportHintPreset',
            ),
          ];
    rebuild();
  }

  function copy(text: string, okKey: StringKey): void {
    const clip = platform.clipboard;
    if (clip === undefined) return;
    void clip.writeText(text).then((ok) => {
      note = t(ok ? okKey : 'share.copyFailed');
      rebuild();
    });
  }

  function endTyping(): void {
    typing?.close();
    typing = null;
    hold = true;
  }

  function openPaste(): void {
    fromExport = mode === 'export' && title !== '';
    mode = 'paste';
    title = t('share.pasteTitle');
    lines = [t('share.pasteHint')];
    note = '';
    rebuild();
    if (!can.paste) {
      showError([t('share.pasteUnavailable')]);
      return;
    }
    typing = platform.textInput.open(
      { initial: '', maxLength: PASTE_MAX_CHARS, kind: 'code' },
      {
        onChange: (value) => {
          // Colado inteiro de uma vez: abre sem esperar o Enter.
          if (value.length > 8 && decodeShareCode(value).ok) {
            endTyping();
            openCode(value);
            return;
          }
          lines = [t('share.pasteHint'), t('share.pasteCount', { n: value.length })];
          rebuild();
        },
        onSubmit: (value) => {
          endTyping();
          openCode(value);
        },
        onCancel: () => {
          endTyping();
          back();
        },
      },
    );
    if (typing === null) showError([t('share.pasteUnavailable')]);
  }

  function showError(errorLines: string[]): void {
    mode = 'error';
    title = t('share.errorTitle');
    lines = errorLines;
    rebuild();
  }

  function openCode(text: string): void {
    receivedBot = null;
    receivedPreset = null;
    receivedSquad = null;
    presetSaved = false;
    note = '';
    // Colaram o link inteiro (o "Copiar link" desta tela): o código está no hash.
    const at = text.indexOf('#');
    const code = at >= 0 ? (shareCodeFromHash(text.slice(at).trim()) ?? text) : text;
    // M8 (fase 3): o código do Surpreenda-me é o sorteio em si (quem lê a tabela dele é o `surprise.ts`).
    if (shareKindOf(code) === 'surprise') {
      const decoded = decodeShareCode(code);
      const roll = decoded.ok ? surpriseFromCode(decoded.doc) : null;
      const checked = roll !== null ? validateMatchRecipe(surpriseRecipe(roll), deps.limits) : null;
      if (roll === null || checked === null || !checked.ok) {
        const key = !decoded.ok
          ? (`share.error.${decoded.error}` as StringKey)
          : surpriseCodeIsNewer(decoded.doc)
            ? 'share.error.surpriseNewer'
            : 'share.error.invalid';
        showError([t(key)]);
        return;
      }
      receivedPreset = checked.value;
      mode = 'preset';
      title = t('share.receivedSurprise');
      lines = [
        ...SURPRISE_LINES.map((line) => `${t(`surprise.line.${line}` as StringKey)}: ${surpriseLineText(roll, line)}`),
        ...(surpriseDetails(roll) !== '' ? [surpriseDetails(roll)] : []),
        ...issueLines(checked.warnings),
      ];
      rebuild();
      return;
    }
    const r = importShareCode(code, deps.limits);
    if (!r.ok) {
      showError([t(`share.error.${r.error}` as StringKey), ...issueLines(r.issues)]);
      return;
    }
    if (r.kind === 'bot') {
      receivedBot = r.bot;
      mode = 'bot';
      title = t('share.receivedBot', { name: r.bot.name || t('share.unnamed') });
      lines = [...botCardLines(r.bot), ...issueLines(r.warnings)];
    } else if (r.kind === 'squad') {
      receivedSquad = r.squad;
      mode = 'squad';
      title = t('share.receivedSquad', { name: r.squad.name || t('share.unnamed') });
      const names = new Map(
        (r.squad.embeddedBots ?? []).map((b) => [`embedded:${b.id}`, b.name || t('share.unnamed')]),
      );
      lines = [
        ...r.squad.bots.map((e) =>
          t('squad.line', {
            n: e.count,
            name: names.get(e.ref) ?? t(`bot.name.${e.ref.slice(e.ref.indexOf(':') + 1)}` as StringKey),
          }),
        ),
        ...issueLines(r.warnings),
      ];
    } else {
      receivedPreset = r.preset;
      mode = 'preset';
      title = t('share.receivedPreset', { name: r.preset.name || t('share.unnamed') });
      lines = [...presetLines(r.preset), ...issueLines(r.warnings)];
    }
    rebuild();
  }

  /** O bot recebido como um bot seu: id novo; sem nome (barrado), um do gerador; nome repetido, "Jorge 2". */
  function asOwnBot(bot: BotDocument): BotDocument {
    const ids = new Set([...save.bots.map((b) => b.id), ...deps.factoryBots.map((b) => b.id)]);
    const names = new Set([...save.bots, ...deps.factoryBots].map(botDisplayName));
    const base = bot.name !== '' ? bot.name : rollBotName(deps.rng, names);
    return { ...bot, id: newBotId(deps.rng, ids), name: names.has(base) ? copyName(base, names) : base };
  }

  function saveReceivedBot(bot: BotDocument): void {
    const doc = asOwnBot(bot);
    if (save.saveBot(doc)) close(doc.id, t('share.savedBot', { name: doc.name }));
    else {
      note = t('workshop.full', { n: save.bots.length });
      rebuild();
    }
  }

  /**
   * M8 (fase 2): o esquadrão recebido: os bots dele entram na Oficina (ids novos, as entradas apontam para eles) e ele
   * vira um esquadrão seu. Sem lugar para todos, nada entra.
   */
  function saveReceivedSquad(squad: SquadDocument): void {
    // Só os bots que alguma entrada usa, uma vez cada (um código feito à mão pode repetir ou sobrar).
    const used = new Set(squad.bots.map((e) => e.ref));
    const embedded = (squad.embeddedBots ?? []).filter(
      (b, i, all) => used.has(`embedded:${b.id}`) && all.findIndex((x) => x.id === b.id) === i,
    );
    const map = new Map<string, string>();
    const saved: string[] = [];
    /** Sem lugar (a Oficina ou os esquadrões cheios): os bots que já entraram saem de novo. */
    const undo = (): void => {
      for (const id of saved) save.deleteBot(id);
    };
    for (const b of embedded) {
      const own = asOwnBot(b);
      if (save.saveBot(own)) saved.push(own.id);
      else {
        undo();
        note = t('workshop.full', { n: save.bots.length });
        rebuild();
        return;
      }
      map.set(`embedded:${b.id}`, `embedded:${own.id}`);
    }
    const taken = new Set(save.squads.map((q) => q.name));
    const base = squad.name !== '' ? squad.name : t('squad.defaultName', { n: save.squads.length + 1 });
    const { embeddedBots: _gone, ...rest } = squad;
    const own: SquadDocument = {
      ...rest,
      id: newSquadId(deps.rng, save.squads),
      name: taken.has(base) ? copyName(base, taken) : base,
      bots: squad.bots.map((e) => ({ ...e, ref: (map.get(e.ref) ?? e.ref) as SquadDocument['bots'][number]['ref'] })),
    };
    if (save.saveSquad(own)) close(own.id, t('squad.saved', { name: own.name }));
    else {
      undo();
      note = t('squad.full', { n: save.squads.length });
      rebuild();
    }
  }

  function saveReceivedPreset(preset: MatchRecipe): void {
    const taken = (n: string): boolean => save.presets.saved.some((p) => p.name === n);
    const wanted = preset.name !== undefined && preset.name !== '' ? preset.name : t('share.presetDefaultName');
    // O sufixo (" 2") cabe no teto do nome: corta antes, como o "Jorge 2" dos bots.
    const base = Array.from(wanted)
      .slice(0, RECIPE_RANGES.nameMaxLength - 4)
      .join('')
      .trimEnd();
    const name = taken(wanted) ? presetName(base, taken) : wanted;
    const ok = save.savePreset({ ...preset, name, seed: 0 });
    presetSaved = ok;
    note = ok ? t('custom.saved', { name }) : t('custom.full');
    rebuild();
  }

  function back(): void {
    if (mode === 'paste' && fromExport) {
      note = '';
      showExport();
      return;
    }
    close(null, '');
  }

  function action(a: string): void {
    if (a === SHARE_ACTION.back) back();
    else if (a === SHARE_ACTION.copyCode && exportCode !== null) copy(exportCode, 'share.copied');
    else if (a === SHARE_ACTION.copyLink && exportCode !== null && deps.linkFor !== null) {
      const hash = shareLinkHash(exportCode);
      if (hash !== null) copy(deps.linkFor(hash), 'share.linkCopied');
    } else if (a === SHARE_ACTION.paste) openPaste();
    else if (a === SHARE_ACTION.save && receivedBot !== null) saveReceivedBot(receivedBot);
    else if (a === SHARE_ACTION.save && receivedSquad !== null) saveReceivedSquad(receivedSquad);
    else if (a === SHARE_ACTION.save && receivedPreset !== null && !presetSaved) saveReceivedPreset(receivedPreset);
    else if (a === SHARE_ACTION.play && receivedPreset !== null) {
      const preset = receivedPreset;
      close(null, '');
      deps.play(preset);
    }
  }

  return {
    get mode(): ShareMode {
      return mode;
    },
    act: action,
    openExport(kind, doc, name) {
      result = null;
      exportKind = kind;
      exportName = name;
      const enc = encodeShareCode(kind satisfies ShareKind, doc);
      exportCode = enc.ok ? enc.code : null;
      note = '';
      fromExport = false;
      showExport();
      menu.focus(exportCode !== null && can.copy ? 'copyCode' : 'back');
    },
    openPaste() {
      result = null;
      mode = 'error';
      title = '';
      openPaste();
    },
    openCode(code) {
      result = null;
      fromExport = false;
      openCode(code);
    },
    frame(input, raw, ui, list) {
      if (hold && !anyInputHeld(raw)) hold = false;
      if (result === null && !hold) {
        // Digitando (o campo escondido), o menu ainda anda: o Voltar pelo mouse, pelo toque e pelo B do controle (as
        // teclas do campo não chegam ao `raw`). Só o Voltar vale aqui.
        const nav = menu.update(input, raw, ui);
        if (typing !== null) {
          if (nav.back || nav.activated === SHARE_ACTION.back) {
            endTyping();
            back();
          }
        } else if (nav.back) back();
        else if (nav.activated !== null) action(nav.activated);
      }
      if (result !== null) {
        const r = result;
        result = null;
        return r;
      }
      menu.draw(list, ui);
      return OPEN;
    },
  };
}
