import {
  SQUAD_FORMAT,
  SQUAD_LIMITS,
  squadSize,
  type BotDocument,
  type BotRef,
  type SquadDocument,
} from '@boboforces/format';
import type { MenuInput, RawInputState } from '@boboforces/input';
import type { Platform, TextInputSession } from '@boboforces/platform-api';
import type { Rng } from '@boboforces/shared';
import {
  buildTabbed,
  t,
  TABBED_ROW_PREFIX,
  WORKSHOP_ACTION,
  WORKSHOP_BOT_PREFIX,
  workshopScreen,
  type DrawList,
  type MenuNavigation,
  type StringKey,
  type TabbedRow,
} from '@boboforces/ui';
import { botCardLines, botDisplayName, copyName, isBuiltinBot, newBotId } from './bot-card.ts';
import { createMenuController, type UiFrame } from './menu.ts';
import { cleanTypedName } from './names.ts';
import { createOnscreenKeyboard, type OnscreenKeyboard } from './onscreen-keyboard.ts';
import type { SaveStore } from './save-store.ts';
import type { ShareFlow } from './share.ts';

/**
 * M8 (fase 2): a Oficina inteira no pedaço dos editores (o menu da web está no teto de 350 KB; antes ela morava no
 * `game.ts`): a biblioteca dos bots (favoritos, os seus e os de fábrica) e dos **esquadrões**, o card do escolhido e as
 * ações (Editar, Duplicar, Favoritar, Apagar, Compartilhar), o compartilhar (a tela de códigos, por cima) e o editor de
 * esquadrões (o nome e até 8 bots com quantos de cada). Editar um bot volta para o `game`, que abre o Laboratório.
 */
export interface WorkshopDeps {
  readonly platform: Platform;
  readonly save: SaveStore;
  readonly rng: Rng;
  readonly factoryBots: readonly BotDocument[];
  /** A tela de compartilhar (a mesma da Partida personalizada; o `game` cria). */
  share(): ShareFlow;
  /** O último aperto foi num controle (na web, o teclado do sistema não aparece: o do jogo no lugar). */
  usesGamepad(): boolean;
}

export type WorkshopOutcome =
  { readonly kind: 'open' } | { readonly kind: 'back' } | { readonly kind: 'lab'; readonly bot: BotDocument };

export interface WorkshopFlow {
  /** Abre a lista (com `select`, no bot ou esquadrão dele; `note` é o aviso de uma linha). */
  open(select?: string | null, note?: string): void;
  /** O jeito da tela agora e o escolhido (os testes). */
  readonly mode: 'list' | 'share' | 'squad';
  readonly selected: string;
  /** Um botão (`delta` nas linhas de opção; o `frame` chama pelo menu, os testes direto). */
  act(action: string, delta?: number): WorkshopOutcome;
  /** 1x por frame com a Oficina aberta (desenha em `list`). */
  frame(menu: MenuInput, raw: Readonly<RawInputState>, ui: UiFrame, list: DrawList): WorkshopOutcome;
}

const OPEN: WorkshopOutcome = { kind: 'open' };
const BACK: WorkshopOutcome = { kind: 'back' };
/** O item "Novo esquadrão" no fim do grupo dos esquadrões. */
const NEW_SQUAD = '+new';
const SQUADS_GROUP = 'squads';
const EMBEDDED = 'embedded:';

function anyInputHeld(raw: Readonly<RawInputState>): boolean {
  if (raw.mouseButtons !== 0) return true;
  for (let k = 0; k < raw.keys.length; k++) if (raw.keys[k] === 1) return true;
  for (const pad of raw.gamepads) {
    if (!pad.connected) continue;
    for (let b = 0; b < pad.buttons.length; b++) if (pad.buttons[b]! >= 0.5) return true;
  }
  return false;
}

const cleanSquadName = (text: string): string => cleanTypedName(text, SQUAD_LIMITS.nameLength);

/** O esquadrão com os bots da Oficina que ele usa embutidos (o código leva junto: quem recebe não tem esses bots). */
export function squadForShare(squad: SquadDocument, bots: readonly BotDocument[]): SquadDocument {
  const docs: BotDocument[] = [];
  const entries = squad.bots.map((e) => {
    if (!e.ref.startsWith(EMBEDDED)) return e;
    const doc = bots.find((b) => b.id === e.ref.slice(EMBEDDED.length));
    // O bot que saiu da Oficina vira o Normal Bob (como no jogo): quem recebe não tem como achar.
    if (!doc) return { ...e, ref: 'builtin:normal-bob' as BotRef };
    if (!docs.includes(doc)) docs.push(doc);
    return e;
  });
  const { embeddedBots: _old, ...rest } = squad;
  return docs.length > 0 ? { ...rest, bots: entries, embeddedBots: docs } : { ...rest, bots: entries };
}

/** M8 (fase 2, revisão): um id de esquadrão livre ("q" + 6 hexas; o teste de colisão é sem o "q"). */
export function newSquadId(rng: Rng, squads: readonly SquadDocument[]): string {
  return 'q' + newBotId(rng, new Set(squads.map((q) => q.id.slice(1))));
}

export function createWorkshopFlow(deps: WorkshopDeps): WorkshopFlow {
  const { platform, save, factoryBots } = deps;
  const menu = createMenuController();
  type Mode = 'list' | 'share' | 'squad';
  let mode: Mode = 'list';
  let selected = factoryBots[0]!.id;
  let note = '';
  /** O bot ou esquadrão esperando o "Confirmar" do Apagar. */
  let confirm: string | null = null;
  let pending: WorkshopOutcome | null = null;
  // O editor de esquadrões.
  let draft: SquadDocument | null = null;
  let draftDirty = false;
  let draftDiscard = false;
  let typing: TextInputSession | null = null;
  let keyboard: OnscreenKeyboard | null = null;
  let typingFrom = '';
  /** Se o rascunho tinha mudança antes de digitar (cancelar volta a isso, e o Voltar não pede confirmação à toa). */
  let typingDirty = false;
  /** O foco da lista antes de abrir o editor (o Voltar devolve). */
  let listFocus: string | null = null;
  let hold = false;

  const findBot = (id: string): BotDocument | null =>
    save.bots.find((b) => b.id === id) ?? factoryBots.find((b) => b.id === id) ?? null;
  const findSquad = (id: string): SquadDocument | null => save.squads.find((q) => q.id === id) ?? null;

  /** O nome de um bot da entrada (o da Oficina que sumiu: o Normal Bob, como no jogo). */
  function refName(ref: BotRef): string {
    if (ref.startsWith(EMBEDDED)) {
      const doc = save.bots.find((b) => b.id === ref.slice(EMBEDDED.length));
      return doc ? botDisplayName(doc) : t('bot.name.normal-bob');
    }
    return t(`bot.name.${ref.slice('builtin:'.length)}` as StringKey);
  }

  function squadLines(q: SquadDocument): string[] {
    return [
      ...q.bots.map((e) => t('squad.line', { n: e.count, name: refName(e.ref) })),
      t('squad.total', { n: squadSize(q) }),
    ];
  }

  function rebuildList(): void {
    const item = (b: BotDocument): { id: string; label: string } => ({ id: b.id, label: botDisplayName(b) });
    const favorites = save.presets.botFavorites.map(findBot).filter((b): b is BotDocument => b !== null);
    const squad = findSquad(selected);
    const bot = squad === null ? (findBot(selected) ?? factoryBots[0]!) : null;
    selected = squad?.id ?? bot!.id;
    menu.setRoot(
      workshopScreen.build({
        groups: [
          { id: 'fav', titleKey: 'workshop.favorites', items: favorites.map(item), empty: '' },
          { id: 'mine', titleKey: 'workshop.mine', items: save.bots.map(item), empty: t('workshop.empty') },
          {
            id: SQUADS_GROUP,
            titleKey: 'workshop.squads',
            items: [
              ...save.squads.map((q) => ({ id: q.id, label: q.name || t('squad.unnamed') })),
              { id: NEW_SQUAD, label: t('squad.new') },
            ],
            empty: '',
          },
          { id: 'factory', titleKey: 'workshop.factory', items: factoryBots.map(item), empty: '' },
        ],
        selected,
        name: squad !== null ? squad.name || t('squad.unnamed') : botDisplayName(bot!),
        lines: squad !== null ? squadLines(squad) : botCardLines(bot!),
        note,
        canEdit: true,
        canDelete: squad !== null || !isBuiltinBot(bot!),
        favorite: bot !== null && save.presets.botFavorites.includes(bot.id),
        confirmDelete: confirm === selected,
        share: platform.id !== 'switch' && platform.clipboard !== undefined,
        ...(squad !== null ? { squad: true } : {}),
      }),
    );
  }

  /** Escolhe o bot ou esquadrão `id` e põe o foco nele (no grupo dele). */
  function focusItem(id: string): void {
    selected = id;
    rebuildList();
    const group = findSquad(id) !== null ? SQUADS_GROUP : save.bots.some((b) => b.id === id) ? 'mine' : 'factory';
    menu.focus(`${WORKSHOP_BOT_PREFIX}${group}:${id}`);
  }

  // --- o editor de esquadrões ---

  function botChoices(): BotRef[] {
    return [...factoryBots.map((b): BotRef => `builtin:${b.id}`), ...save.bots.map((b): BotRef => `embedded:${b.id}`)];
  }

  function rebuildSquad(): void {
    const q = draft!;
    const rows: TabbedRow[] = [
      { kind: 'option', id: 'name', labelKey: 'squad.row.name', value: q.name || t('squad.unnamed') },
    ];
    q.bots.forEach((e, i) => {
      rows.push({ kind: 'option', id: `bot${i}`, labelKey: 'squad.row.bot', value: refName(e.ref) });
      rows.push({ kind: 'option', id: `count${i}`, labelKey: 'squad.row.count', value: String(e.count) });
    });
    if (q.bots.length < SQUAD_LIMITS.entries) rows.push({ kind: 'action', id: 'add', label: { key: 'squad.add' } });
    menu.setRoot(
      buildTabbed({
        titleKey: 'squad.title',
        tabs: [],
        tab: 0,
        rows,
        summary: t('squad.total', { n: squadSize(q) }),
        note,
        buttons: [
          { id: WORKSHOP_ACTION.back, labelKey: 'menu.back', variant: 'secondary' },
          { id: 'squadSave', labelKey: 'squad.save', variant: 'primary', autofocus: true },
        ],
      }),
    );
  }

  function openSquad(q: SquadDocument): void {
    listFocus = menu.focusedId;
    draft = q;
    draftDirty = false;
    draftDiscard = false;
    note = '';
    mode = 'squad';
    menu.focus(null);
    rebuildSquad();
  }

  function newSquad(): SquadDocument {
    return {
      format: SQUAD_FORMAT,
      id: newSquadId(deps.rng, save.squads),
      name: t('squad.defaultName', { n: save.squads.length + 1 }),
      bots: [{ ref: 'builtin:normal-bob', count: 4 }],
    };
  }

  function endTyping(): void {
    typing?.close();
    typing = null;
    keyboard = null;
    hold = true;
  }

  function startTyping(): void {
    if (draft === null || typing !== null || keyboard !== null) return;
    typingFrom = draft.name;
    typingDirty = draftDirty;
    const own = !platform.textInput.available || (deps.usesGamepad() && platform.id !== 'switch');
    const set = (name: string): void => {
      draft = { ...draft!, name };
      draftDirty = true;
      rebuildSquad();
    };
    if (!own) {
      typing = platform.textInput.open(
        { initial: draft.name, maxLength: SQUAD_LIMITS.nameLength, kind: 'name' },
        {
          onChange: (value) => set(cleanSquadName(value)),
          onSubmit: (value) => {
            set(cleanSquadName(value).trim() || typingFrom);
            endTyping();
          },
          onCancel: () => {
            set(typingFrom);
            draftDirty = typingDirty;
            endTyping();
          },
        },
      );
      if (typing !== null) return;
    }
    hold = true;
    keyboard = createOnscreenKeyboard({
      title: t('squad.keyboardTitle'),
      initial: draft.name,
      maxLength: SQUAD_LIMITS.nameLength,
      clean: cleanSquadName,
      onChange: (value) => set(value),
    });
  }

  function stepSquad(id: string, delta: number): void {
    const q = draft!;
    const bots = q.bots.slice();
    if (id === 'name') {
      startTyping();
      return;
    }
    if (id === 'add') bots.push({ ref: 'builtin:normal-bob', count: 1 });
    else if (id.startsWith('bot')) {
      const i = Number(id.slice(3));
      const choices = botChoices();
      const at = Math.max(0, choices.indexOf(bots[i]!.ref));
      const d = delta === 0 ? 1 : delta;
      bots[i] = { ...bots[i]!, ref: choices[(at + d + choices.length) % choices.length]! };
    } else if (id.startsWith('count')) {
      const i = Number(id.slice(5));
      const n = bots[i]!.count + (delta === 0 ? 1 : delta);
      // Abaixo de 1, a entrada sai (o "–" no 1 tira o bot do esquadrão).
      if (n < 1) bots.splice(i, 1);
      else bots[i] = { ...bots[i]!, count: Math.min(SQUAD_LIMITS.count, n) };
    }
    draft = { ...q, bots };
    draftDirty = true;
    draftDiscard = false;
    note = '';
    rebuildSquad();
  }

  function squadAction(nav: MenuNavigation): void {
    const a = nav.activated;
    if (nav.back || a === WORKSHOP_ACTION.back) {
      if (draftDirty && !draftDiscard) {
        draftDiscard = true;
        note = t('lab.discardAsk');
        rebuildSquad();
        return;
      }
      note = '';
      mode = 'list';
      rebuildList();
      if (listFocus !== null) menu.focus(listFocus);
      return;
    }
    if (a === 'squadSave') {
      const q = draft!;
      if (q.bots.length === 0) {
        note = t('squad.emptyNote');
        rebuildSquad();
        return;
      }
      const named = q.name.trim() !== '' ? q : { ...q, name: t('squad.defaultName', { n: save.squads.length + 1 }) };
      if (!save.saveSquad(named)) {
        note = t('squad.full', { n: save.squads.length });
        rebuildSquad();
        return;
      }
      selected = named.id;
      note = t('squad.saved', { name: named.name });
      mode = 'list';
      rebuildList();
      menu.focus(`${WORKSHOP_BOT_PREFIX}${SQUADS_GROUP}:${named.id}`);
      return;
    }
    if (a !== null && a.startsWith(TABBED_ROW_PREFIX)) stepSquad(a.slice(TABBED_ROW_PREFIX.length), nav.delta);
  }

  // --- a lista ---

  function listAction(a: string): void {
    if (a.startsWith(WORKSHOP_BOT_PREFIX)) {
      // `bot:<grupo>:<id>`
      const id = a.slice(a.indexOf(':', WORKSHOP_BOT_PREFIX.length) + 1);
      note = '';
      confirm = null;
      if (id === NEW_SQUAD) {
        openSquad(newSquad());
        return;
      }
      selected = id;
      rebuildList();
      return;
    }
    const squad = findSquad(selected);
    const bot = squad === null ? findBot(selected) : null;
    if (a === WORKSHOP_ACTION.edit) {
      if (squad !== null) openSquad(squad);
      else if (bot !== null) pending = { kind: 'lab', bot };
      return;
    }
    if (a === WORKSHOP_ACTION.share) {
      const share = deps.share();
      if (squad !== null) share.openExport('squad', squadForShare(squad, save.bots), squad.name);
      else if (bot !== null) share.openExport('bot', bot, botDisplayName(bot));
      else return;
      mode = 'share';
      return;
    }
    if (a === WORKSHOP_ACTION.duplicate) {
      if (squad !== null) {
        const names = new Set(save.squads.map((q) => q.name));
        const copy: SquadDocument = {
          ...squad,
          id: newSquadId(deps.rng, save.squads),
          name: copyName(squad.name, names),
        };
        if (save.saveSquad(copy)) {
          selected = copy.id;
          note = t('workshop.duplicated', { name: copy.name });
          menu.focus(`${WORKSHOP_BOT_PREFIX}${SQUADS_GROUP}:${copy.id}`);
        } else note = t('squad.full', { n: save.squads.length });
      } else if (bot !== null) {
        const ids = new Set([...save.bots.map((b) => b.id), ...factoryBots.map((b) => b.id)]);
        const names = new Set([...save.bots, ...factoryBots].map(botDisplayName));
        const copy: BotDocument = { ...bot, id: newBotId(deps.rng, ids), name: copyName(botDisplayName(bot), names) };
        if (save.saveBot(copy)) {
          selected = copy.id;
          note = t('workshop.duplicated', { name: copy.name });
          menu.focus(`${WORKSHOP_BOT_PREFIX}mine:${copy.id}`);
        } else note = t('workshop.full', { n: save.bots.length });
      }
      confirm = null;
    } else if (a === WORKSHOP_ACTION.favorite && bot !== null) {
      const on = !save.presets.botFavorites.includes(bot.id);
      note = save.setBotFavorite(bot.id, on) ? '' : t('workshop.favoritesFull');
    } else if (a === WORKSHOP_ACTION.delete && (squad !== null || (bot !== null && !isBuiltinBot(bot)))) {
      const name = squad !== null ? squad.name : bot!.name;
      if (confirm === selected) {
        if (squad !== null) save.deleteSquad(squad.id);
        else save.deleteBot(bot!.id);
        note = t('workshop.deleted', { name });
        confirm = null;
        selected = save.bots[0]?.id ?? factoryBots[0]!.id;
      } else {
        confirm = selected;
        note = t('workshop.deleteAsk', { name });
      }
    }
    rebuildList();
  }

  return {
    get mode() {
      return mode;
    },
    get selected() {
      return selected;
    },
    act(a, delta = 0) {
      if (mode === 'squad') squadAction({ focusedId: null, activated: a, back: false, delta, tab: 0 });
      else if (a === WORKSHOP_ACTION.back) return BACK;
      else listAction(a);
      const r = pending ?? OPEN;
      pending = null;
      return r;
    },
    open(select = null, openNote = '') {
      endTyping();
      hold = false;
      mode = 'list';
      draft = null;
      pending = null;
      confirm = null;
      note = openNote;
      if (select !== null) focusItem(select);
      else rebuildList();
    },
    frame(input, raw, ui, list) {
      if (mode === 'share') {
        const r = deps.share().frame(input, raw, ui, list);
        if (r.open) return OPEN;
        // Fechou o compartilhar: o bot ou esquadrão recebido aparece escolhido, e o aperto que fechou não vale de novo
        // aqui (espera soltar tudo).
        mode = 'list';
        note = r.note;
        hold = true;
        if (r.savedBot !== null) focusItem(r.savedBot);
        else rebuildList();
        menu.draw(list, ui);
        return OPEN;
      }
      if (hold && !anyInputHeld(raw)) hold = false;
      if (mode === 'squad' && keyboard !== null) {
        const kb = keyboard;
        const r = hold ? (kb.draw(list, ui), 'open') : kb.frame(input, raw, ui, list);
        if (r !== 'open') {
          draft = { ...draft!, name: r === 'submit' ? kb.value.trim() || typingFrom : typingFrom };
          if (r === 'cancel') draftDirty = typingDirty;
          endTyping();
          rebuildSquad();
        }
        return OPEN;
      }
      if (typing === null && !hold) {
        const nav = menu.update(input, raw, ui);
        if (mode === 'squad') squadAction(nav);
        else if (nav.back || nav.activated === WORKSHOP_ACTION.back) return BACK;
        else if (nav.activated !== null) listAction(nav.activated);
      }
      if (pending !== null) {
        const r = pending;
        pending = null;
        return r;
      }
      // O Compartilhar foi apertado agora: a Oficina ainda desenha neste frame (a tela dele, a partir do próximo).
      menu.draw(list, ui);
      return OPEN;
    },
  };
}
