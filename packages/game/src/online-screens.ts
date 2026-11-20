/**
 * M5 (fase 4c): as telas do Online num pedaço à parte (`@boboforces/game/online`), fora do menu da web (tecnico.md
 * §16.4: menu ≤ 350 KB). Regra 15: o `import()` fica no `apps/web`, que entrega este módulo junto com a sala de
 * verdade (`OnlineRooms`, feita com o `net`) por `GameDeps.loadOnline`. O Switch nunca carrega (#1).
 *
 * O fluxo: o aviso de privacidade na 1ª vez → a casa (o nome, Criar sala, Entrar com código) → a sala (os 4 lugares, o
 * time, e para o host Começar, Escolher partida, Trancar e Tirar) → a partida (a cena de sempre, com a sessão online)
 * → de volta à sala. M5 (fase 6a): o Escolher partida abre a "Partida da sala" (os cards dos modos do online). O nome e o aviso lido ficam no perfil `online@1`, numa chave própria do storage.
 */
import {
  DEFAULT_ONLINE_PROFILE,
  ONLINE_PROFILE_FORMAT,
  ONLINE_PROFILE_RANGES,
  presetBotCounts,
  validateOnlineProfile,
  type MatchRecipe,
  type OnlineProfileDocument,
} from '@boboforces/format';
import type { MenuInput, RawInputState } from '@boboforces/input';
import type { Platform, TextInputSession } from '@boboforces/platform-api';
import { isFfaMode } from '@boboforces/sim';
import {
  COLORS,
  MODES_ACTION,
  MODES_PREFIX,
  ONLINE_ACTION,
  onlineHomeScreen,
  onlineJoinScreen,
  onlineMatchScreen,
  onlinePrivacyScreen,
  onlineRoomScreen,
  onlineStatusScreen,
  registerStrings,
  STRINGS_ONLINE_PT_BR,
  t,
  TEAM_COLORS,
  type DrawList,
  type MenuNavigation,
  type OnlineRoomMemberRow,
  type StringKey,
} from '@boboforces/ui';
import { createMenuController, type UiFrame } from './menu.ts';
import { cleanHudText, cleanTypedName } from './names.ts';
import {
  onlineRecipe,
  type OnlineMatchStart,
  type OnlineRoom,
  type OnlineRoomEnd,
  type OnlineRooms,
  type OnlineSession,
} from './online-api.ts';
import { ownerReserveFor } from './owner-reserve.ts';
import {
  capRoomRecipe,
  hostSnapshotHz,
  ROOM_MODES,
  roomLimits,
  roomPreset,
  type RoomLimits,
  type RoomMode,
} from './online-presets.ts';
import type { KeyboardResult, OnscreenKeyboard, OnscreenKeyboardOptions } from './onscreen-keyboard.ts';

registerStrings(STRINGS_ONLINE_PT_BR);

/** A versão do aviso de privacidade: subiu, o aviso aparece de novo para todo mundo. */
export const ONLINE_PRIVACY_VERSION = 1;
/** A chave do perfil `online@1` no storage. */
export const ONLINE_PROFILE_KEY = 'online';

/** O que o `game` dá às telas do Online. */
export interface OnlineFlowDeps {
  readonly platform: Platform;
  readonly rooms: OnlineRooms;
  log(line: string): void;
  /** A partida com que a sala nasce (o último preset jogado, fora o treino). */
  initialRecipe(): MatchRecipe;
  /** "Times · De boa · 4 contra 4 · Construto". */
  summary(recipe: MatchRecipe): string;
  /** A Partida personalizada para o host; volta com a receita escolhida (`null` = Voltar, sem mudar). */
  pickMatch(recipe: MatchRecipe, done: (recipe: MatchRecipe | null) => void): void;
  /** M5 (fase 6a): o sorteio do Surpreenda-me (o mesmo do jogo sozinho), no aparelho do host. */
  surprise(): MatchRecipe;
  /** Entra na partida (a cena, com a sessão online). */
  play(recipe: MatchRecipe, seed: number, session: OnlineSession): void;
  /** Sai do Online (o título). */
  exit(): void;
  /** Valida a receita que veio do host (regra 19); `null` = não abre aqui. */
  checkRecipe(recipe: unknown): MatchRecipe | null;
  /** A semente de cada partida que o host começa. */
  seed(): number;
  /** O último dispositivo dos menus (no controle, digitar é pelo teclado do jogo). */
  lastDevice(): string | null;
  /**
   * O teclado do jogo (vem do pedaço dos editores, que o `game` carrega logo depois do menu); `null` = ainda não
   * chegou (digita pelo sistema, se houver). Importar direto daqui faria dele um pedaço comum com os editores.
   */
  createKeyboard(options: OnscreenKeyboardOptions): OnscreenKeyboard | null;
}

export interface OnlineFlow {
  /**
   * Abre o Online pelo título (o aviso na 1ª vez). M5 (fase 4d): com `link` (o `#sala=XXXXX` da URL), cai no Entrar
   * com o código já posto (depois do aviso, se for a 1ª vez); um link sem código válido abre a casa.
   */
  open(link?: string): void;
  /** 1x por frame, em qualquer tela: a sala anda também durante a partida. */
  tick(): void;
  /** O frame da tela do Online: navega e desenha em `list`. */
  frame(menu: MenuInput, raw: Readonly<RawInputState>, ui: UiFrame, list: DrawList): void;
  /** Voltou da partida: `left` = saiu pela pausa (o amigo sai da sala; o host volta todos ao lobby). */
  afterMatch(left: boolean): void;
  /** A sala de agora (o F2 e os testes). */
  readonly room: OnlineRoom | null;
  dispose(): void;
}

type Page = 'privacy' | 'home' | 'join' | 'status' | 'room' | 'match';

const END_TEXT: Readonly<Record<OnlineRoomEnd, StringKey>> = {
  full: 'online.end.full',
  locked: 'online.end.locked',
  'update-self': 'online.end.updateSelf',
  'update-friend': 'online.end.updateFriend',
  mismatch: 'online.end.mismatch',
  kicked: 'online.end.kicked',
  'host-left': 'online.end.hostLeft',
  'not-found': 'online.end.notFound',
  network: 'online.end.network',
};

/** Alguma tecla, botão do mouse ou do controle ainda apertado (o aperto que fechou o teclado não vale no menu). */
function anyHeld(raw: Readonly<RawInputState>): boolean {
  if (raw.mouseButtons !== 0) return true;
  for (let k = 0; k < raw.keys.length; k++) if (raw.keys[k] === 1) return true;
  for (const pad of raw.gamepads) {
    if (!pad.connected) continue;
    for (let b = 0; b < pad.buttons.length; b++) if (pad.buttons[b]! >= 0.5) return true;
  }
  return false;
}

export function loadOnlineProfile(platform: Platform): OnlineProfileDocument {
  const text = platform.storage.get(ONLINE_PROFILE_KEY);
  if (text === null) return DEFAULT_ONLINE_PROFILE;
  try {
    const r = validateOnlineProfile(JSON.parse(text));
    return r.ok ? r.value : DEFAULT_ONLINE_PROFILE;
  } catch {
    return DEFAULT_ONLINE_PROFILE;
  }
}

/** O nome na sala: o filtro do atlas (o que chega de um amigo também passa por ele) e o teto de 16. */
export function cleanRoomName(text: string): string {
  return cleanTypedName(text, ONLINE_PROFILE_RANGES.nameLength);
}

/** A partida tem times (a escolha do time vale)? No FFA, no treino e nos modos de um time, não. */
export function recipeHasTeams(recipe: MatchRecipe): boolean {
  // M6 (fase 3): no Juggernaut todos começam caçando (o Jugg é sorteado). Fase 6b: o Bobo Zombies é cooperativo (na
  // Horda armada o time 1 é só de bots).
  return (
    recipe.mode !== 'training' &&
    recipe.mode !== 'juggernaut' &&
    recipe.mode !== 'zombies' &&
    !isFfaMode(recipe.mode) &&
    recipe.teams.length >= 2
  );
}

/** M9 (fase 3): quantos times a escolha anda (0 = sem times; o Sandbox vai a 4). */
export function recipeTeamCount(recipe: MatchRecipe): number {
  return recipeHasTeams(recipe) ? Math.max(2, Math.min(4, recipe.teams.length)) : 0;
}

/** O time na sala: -1 (tanto faz) → 0 → 1 → -1. M9 (fase 3): com `count` times, até o `count - 1` (o Sandbox). */
export function stepTeam(team: number, delta: number, count = 2): number {
  const n = Math.max(2, Math.min(4, count)) + 1;
  const i = Math.max(0, Math.min(n - 1, team + 1));
  return ((i + (delta < 0 ? n - 1 : 1)) % n) - 1;
}

/** O nome do time na sala (a cor: o amigo não tem a receita); fora dos times da partida, "tanto faz". */
function teamLabel(team: number, count = 2): string {
  return t(team >= 0 && team < count ? (`online.team.${team}` as StringKey) : 'online.team.any');
}

export function createOnlineFlow(deps: OnlineFlowDeps): OnlineFlow {
  const { platform, rooms } = deps;
  /** M5 (fase 6b): este aparelho é um celular (host com teto menor, snapshots a 20 Hz e o aviso na sala). */
  const mobile = platform.features.profileHint === 'mobile';
  const menu = createMenuController();
  let profile = loadOnlineProfile(platform);
  let page: Page = 'home';
  let note = '';
  let statusText = '';
  let statusBusy = false;
  /** M5 (fase 5c): a sala acabou por versão antiga deste lado: a tela oferece Atualizar (e a procura começa). */
  let offerUpdate = false;
  let updateReady = false;
  let room: OnlineRoom | null = null;
  let team = -1;
  let ready = true;
  /** O host: a partida da sala (a Partida personalizada muda). */
  let recipe: MatchRecipe = deps.initialRecipe();
  /** M5 (fase 6a): o card da Partida da sala escolhido por último (o foco volta nele). */
  let lastCard: RoomMode = ROOM_MODES[0];
  /** M5 (fase 6b): o resumo que os amigos já receberam (muda também quando um celular entra ou sai). */
  let sentSummary = '';
  let summaryView: unknown = null;
  /** M5 (fase 4d): o código do link, esperando o aviso de privacidade ser lido. */
  let linkCode: string | null = null;
  /** A partida que este aparelho já abriu (o cliente não reabre a mesma). */
  let entered: OnlineMatchStart | null = null;
  let inMatch = false;
  let code = '';
  // Digitando (o nome ou o código): pelo sistema ou pelo teclado do jogo; `hold` espera soltar tudo depois.
  let typing: TextInputSession | null = null;
  let keyboard: OnscreenKeyboard | null = null;
  let keyboardFor: 'name' | 'code' | null = null;
  let typingFrom = '';
  /** O nome enquanto é digitado pelo teclado do sistema (a tela acompanha; `null` = não está digitando). */
  let nameDraft: string | null = null;
  let hold = false;
  /** A tela precisa ser refeita (o estado mudou ou chegou outro estado da sala). */
  let dirty = true;
  let builtView: unknown = null;

  /**
   * M5 (fase 5b): o id deste aparelho (sorteado na 1ª vez e guardado no perfil): o host devolve o boneco a quem cai e
   * volta, e barra quem ele tirou.
   */
  function deviceId(): string {
    if (profile.id === '') saveProfile({ ...profile, id: rooms.newDeviceId() });
    return profile.id;
  }

  function saveProfile(next: OnlineProfileDocument): void {
    profile = next;
    platform.storage.set(ONLINE_PROFILE_KEY, JSON.stringify({ ...next, format: ONLINE_PROFILE_FORMAT }));
  }

  const choice = () => ({ name: profile.name, team, ready, mobile });

  /** M5 (fase 6b): o teto da sala de agora (o do host e, com um celular entre os amigos, o do celular). */
  function limits(r: OnlineRoom): RoomLimits {
    const friends = r.view?.members ?? [];
    return roomLimits(
      platform.features.profileHint,
      friends.some((m) => m.slot !== 0 && m.mobile === true),
    );
  }

  /**
   * A partida que a sala vai jogar: a escolhida, dentro do teto, com os jogadores de agora nos times (é o que o
   * Começar monta). O resumo sai daqui: no X1 com 4, "2 contra 2", e não "1 contra 1".
   */
  function playedRecipe(r: OnlineRoom): MatchRecipe {
    const members = r.view?.members ?? [];
    return onlineRecipe(capRoomRecipe(recipe, limits(r)), members.length > 0 ? members.map((m) => m.team) : [team])
      .recipe;
  }

  /** O teto da sala tirou bots da partida escolhida (o host vê o aviso; só baixar a visão não conta). */
  function botsCut(r: OnlineRoom): boolean {
    const total = (x: MatchRecipe): number => presetBotCounts(x).reduce((a, b) => a + b, 0);
    return total(capRoomRecipe(recipe, limits(r))) < total(recipe);
  }

  /** Host: manda o resumo aos amigos quando ele muda (a partida nova, o teto ou os times da sala). */
  function publishSummary(r: OnlineRoom): void {
    summaryView = r.view;
    const text = deps.summary(playedRecipe(r));
    if (text === sentSummary) return;
    sentSummary = text;
    r.setSummary(text, recipeHasTeams(recipe), Math.max(2, recipeTeamCount(recipe)));
  }

  /** M9 (fase 3): quantos times a escolha anda: o host sabe pela receita; o amigo, pelo que o host mandou. */
  function teamCountOf(r: OnlineRoom): number {
    return r.role === 'host' ? Math.max(2, recipeTeamCount(recipe)) : (r.view?.teamCount ?? 2);
  }

  function rebuild(): void {
    dirty = true;
  }

  function go(next: Page, focus: string | null = null): void {
    page = next;
    rebuild();
    if (focus !== null) menu.focus(focus);
  }

  function showStatus(text: string, busy: boolean): void {
    statusText = text;
    statusBusy = busy;
    offerUpdate = false;
    go('status');
  }

  /** A sala acabou (ou eu saí): solta tudo e mostra o motivo. */
  function closeRoom(reason: string | null): void {
    room?.leave();
    room = null;
    entered = null;
    inMatch = false;
    if (reason === null) {
      note = '';
      go('home');
    } else showStatus(reason, false);
  }

  // --- digitar ---

  function codeFrom(text: string): string {
    const hash = text.indexOf('#');
    if (hash >= 0) {
      const fromLink = rooms.codeFromLink(text.slice(hash));
      if (fromLink !== null) return fromLink;
    }
    let out = '';
    for (const ch of text.toUpperCase()) if (rooms.codeAlphabet.includes(ch)) out += ch;
    return out.slice(0, rooms.codeLength);
  }

  const codeReady = (): boolean => code.length === rooms.codeLength;

  function endTyping(): void {
    typing?.close();
    typing = null;
    keyboard = null;
    keyboardFor = null;
    nameDraft = null;
    hold = true;
    note = '';
    rebuild();
  }

  function finishName(value: string): void {
    const name = cleanRoomName(value).trim();
    if (name !== profile.name) saveProfile({ ...profile, name });
    endTyping();
  }

  function finishCode(value: string, submit: boolean): void {
    code = codeFrom(value);
    endTyping();
    if (submit && codeReady()) joinRoom();
  }

  function startTyping(what: 'name' | 'code'): void {
    if (typing !== null || keyboard !== null) return;
    typingFrom = what === 'name' ? profile.name : code;
    // O teclado do jogo quando não há o do sistema, quando ele não abre, ou digitando com o controle.
    const options: OnscreenKeyboardOptions = {
      title: t(what === 'name' ? 'online.nameKeyboard' : 'online.join.keyboard'),
      initial: typingFrom,
      maxLength: what === 'name' ? ONLINE_PROFILE_RANGES.nameLength : rooms.codeLength,
      clean: what === 'name' ? cleanRoomName : codeFrom,
      onChange: (value) => {
        if (what === 'code') {
          code = value;
          rebuild();
        }
      },
    };
    const own = !platform.textInput.available || deps.lastDevice() === 'gamepad';
    if (own) {
      // Sem o teclado do jogo (o pedaço dos editores ainda não chegou), o do sistema não serve no controle (sem Enter
      // nem Esc, o jogador ficaria preso nele): nada abre, e o próximo aperto tenta de novo.
      const kb = deps.createKeyboard(options);
      if (kb === null) return;
      hold = true;
      keyboardFor = what;
      keyboard = kb;
      return;
    }
    typing = platform.textInput.open(
      what === 'name'
        ? { initial: profile.name, maxLength: ONLINE_PROFILE_RANGES.nameLength, kind: 'name' }
        : // Cabe um link colado inteiro (o código sai do `#sala=`).
          { initial: code, maxLength: 200, kind: 'code' },
      {
        // A tela acompanha o que se digita (o campo do sistema fica escondido).
        onChange: (value) => {
          if (what === 'code') code = codeFrom(value);
          else nameDraft = cleanRoomName(value);
          rebuild();
        },
        onSubmit: (value) => (what === 'name' ? finishName(value) : finishCode(value, true)),
        onCancel: () => (what === 'name' ? finishName(typingFrom) : finishCode(typingFrom, false)),
      },
    );
    if (typing !== null) {
      note = t('online.typing');
      if (what === 'name') nameDraft = profile.name;
      rebuild();
      return;
    }
    // O sistema não abriu: o teclado do jogo.
    const kb = deps.createKeyboard(options);
    if (kb !== null) {
      hold = true;
      keyboardFor = what;
      keyboard = kb;
    }
  }

  function keyboardDone(result: KeyboardResult): void {
    const kb = keyboard!;
    if (keyboardFor === 'name') finishName(result === 'submit' ? kb.value : typingFrom);
    else finishCode(result === 'submit' ? kb.value : typingFrom, result === 'submit');
  }

  // --- a sala ---

  /** M5 (fase 6a): a partida nova da sala (os amigos veem o resumo). */
  function useRecipe(r: OnlineRoom, picked: MatchRecipe, card: RoomMode): void {
    recipe = picked;
    lastCard = card;
    sentSummary = '';
    publishSummary(r);
    deps.log(`[online] partida da sala: ${card} (${recipe.mode}, ${recipe.map})`);
  }

  function createRoom(): void {
    recipe = deps.initialRecipe();
    lastCard = ROOM_MODES[0];
    team = -1;
    ready = true;
    room = rooms.create(choice(), hostSnapshotHz(mobile));
    sentSummary = '';
    publishSummary(room);
    deps.log(`[online] sala ${room.code} criada (snapshots a ${hostSnapshotHz(mobile)} Hz)`);
    note = '';
    go('room', 'start');
  }

  function joinRoom(): void {
    if (!codeReady()) {
      note = t('online.join.invalid');
      rebuild();
      return;
    }
    team = -1;
    ready = true;
    room = rooms.join(code, choice(), deviceId());
    deps.log(`[online] entrando na sala ${code}`);
    note = '';
    showStatus(t('online.status.joining', { code }), true);
  }

  function setChoice(): void {
    room?.setChoice(choice());
    rebuild();
  }

  /** O Entrar com o código já posto (o do link): o foco no Entrar, um aperto e pronto. */
  function openJoin(fromLink: string): void {
    linkCode = null;
    code = fromLink;
    note = '';
    go('join', 'go');
  }

  function startMatch(r: OnlineRoom): void {
    const view = r.view;
    if (view === null || r.status !== 'lobby') return;
    // Quem ainda está no resultado da partida anterior fica de fora até voltar: senão entraria parado (e as entradas
    // velhas dele, ainda a caminho, confundiriam a partida nova). O host vê quem está faltando.
    const away = view.members.find((m) => m.slot !== 0 && !m.ready);
    if (away !== undefined) {
      note = t('online.room.waitAway', { name: memberName(away) });
      rebuild();
      return;
    }
    const lim = limits(r);
    const placed = onlineRecipe(
      capRoomRecipe(recipe, lim),
      view.members.map((m) => m.team),
    );
    const seed = deps.seed() >>> 0;
    // M9 (fase 5): no Sandbox, a reserva do dono (no teto de bots da sala) vai aos amigos junto com o começo.
    const owner = ownerReserveFor(placed.recipe, view.members.length, lim.maxBots) ?? undefined;
    const match = r.start(placed.recipe, seed, placed.controllers, lim.maxZombies, owner);
    deps.log(
      `[online] partida ${placed.recipe.mode} com ${view.members.length} jogador(es), semente ${seed}, até ${lim.maxBots} bots e ${lim.maxZombies} zumbis`,
    );
    enter(match, placed.recipe);
  }

  function enter(match: OnlineMatchStart, matchRecipe: MatchRecipe): void {
    entered = match;
    inMatch = true;
    ready = false;
    room?.setChoice(choice());
    deps.play(matchRecipe, match.seed, match.session);
  }

  /** As transições que a sala pede (só com a tela do Online na frente). */
  function follow(): void {
    const r = room;
    if (r === null) return;
    if (r.status === 'ended') {
      deps.log(`[online] sala ${r.code} acabou: ${r.end ?? '?'}`);
      closeRoom(t(END_TEXT[r.end ?? 'network']));
      // M5 (fase 5c): versão antiga deste lado: procura a nova agora e oferece Atualizar.
      if (r.end === 'update-self') {
        offerUpdate = true;
        platform.updates?.check?.();
      }
      return;
    }
    // M5 (fase 5c): o host fica sabendo de quem foi recusado pela versão.
    const notice = r.takeVersionNotice();
    if (notice !== null) {
      deps.log(
        `[online] aviso de versão: ${notice === 'friend' ? 'o amigo está desatualizado' : 'o host está desatualizado'}`,
      );
      note = t(notice === 'friend' ? 'online.room.friendOutdated' : 'online.room.hostOutdated');
      if (notice === 'host') platform.updates?.check?.();
      rebuild();
    }
    // M5 (fase 5b): a conexão caiu: "voltando à sala" (a partida, se estava nela, já fechou).
    if (r.status === 'reconnecting') {
      const text = t('online.status.reconnecting', { code: r.code });
      if (page !== 'status' || statusText !== text) {
        deps.log(`[online] voltando à sala ${r.code}`);
        showStatus(text, true);
      }
      return;
    }
    if (page === 'status' && statusBusy && r.status !== 'connecting') {
      deps.log(`[online] na sala ${r.code} (lugar ${r.mySlot})`);
      go('room', 'team');
    }
    if (r.role === 'client' && r.status === 'playing' && r.match !== null && r.match !== entered && !inMatch) {
      const checked = deps.checkRecipe(r.match.recipe);
      if (checked === null) {
        deps.log('[online] a receita do host não abre aqui');
        closeRoom(t('online.end.badRecipe'));
        return;
      }
      enter(r.match, checked);
      return;
    }
    if (page === 'room' && r.status === 'lobby' && !ready) {
      ready = true;
      setChoice();
    }
    // M5 (fase 6b): um celular entrou ou saiu: o teto (e o resumo) da sala pode mudar.
    if (r.role === 'host' && r.view !== summaryView) publishSummary(r);
  }

  // --- as telas ---

  /** O nome na sala (veio de outro aparelho: passa pelo filtro do atlas); vazio, o padrão da tabela. */
  function memberName(m: { readonly slot: number; readonly name: string }): string {
    return (
      cleanRoomName(m.name).trim() ||
      (m.slot === 0 ? t('online.room.hostName') : t('online.room.friendName', { n: m.slot }))
    );
  }

  function roomRows(r: OnlineRoom): OnlineRoomMemberRow[] {
    const view = r.view;
    if (view === null) return [];
    const count = teamCountOf(r);
    return view.members.map((m) => {
      const name = memberName(m);
      const you = m.slot === r.mySlot;
      return {
        slot: m.slot,
        name,
        you,
        team: view.teams ? teamLabel(m.team, count) : '',
        teamColor: view.teams && m.team >= 0 && m.team < count ? TEAM_COLORS[m.team]! : COLORS.texto,
        status:
          m.slot === 0
            ? t('online.room.host')
            : you
              ? t('online.room.you')
              : !m.ready && view.playing === false
                ? t('online.room.away')
                : '',
        kickable: m.slot !== 0,
      };
    });
  }

  function build(): void {
    // O estado da sala é trocado inteiro a cada mudança (o mesmo objeto = nada mudou).
    const view = room?.view ?? null;
    if (!dirty && view === builtView) return;
    dirty = false;
    builtView = view;
    if (page === 'privacy') menu.setRoot(onlinePrivacyScreen.build({}));
    else if (page === 'home') menu.setRoot(onlineHomeScreen.build({ name: nameDraft ?? profile.name, note }));
    else if (page === 'match') menu.setRoot(onlineMatchScreen.build(null));
    else if (page === 'join') {
      menu.setRoot(onlineJoinScreen.build({ code, length: rooms.codeLength, ready: codeReady(), note }));
    } else if (page === 'status') {
      const updates = platform.updates;
      menu.setRoot(
        onlineStatusScreen.build({
          message: statusText,
          busy: statusBusy,
          ...(offerUpdate
            ? updates !== undefined
              ? {
                  detail: t(updateReady ? 'online.update.ready' : 'online.update.searching'),
                  update: { ready: updateReady },
                }
              : { detail: t('online.update.reload') }
            : {}),
        }),
      );
    } else if (room !== null) {
      const view = room.view;
      const host = room.role === 'host';
      // M5 (fase 6b): o host no celular (o aviso) e a partida cortada pelo teto da sala.
      const hints: string[] = [];
      if (host && mobile) hints.push(t('online.room.phoneHost'));
      if (host && botsCut(room)) hints.push(t('online.room.capped', { n: limits(room).maxBots }));
      menu.setRoot(
        onlineRoomScreen.build({
          code: room.code,
          // O resumo do host veio de outro aparelho: só o que o atlas desenha.
          summary: host ? deps.summary(playedRecipe(room)) : cleanHudText(view?.summary ?? '', 80),
          hints,
          host,
          members: roomRows(room),
          team: (host ? recipeHasTeams(recipe) : (view?.teams ?? true)) ? teamLabel(team, teamCountOf(room)) : null,
          locked: view?.locked ?? false,
          note: note !== '' ? note : view?.locked ? t('online.room.locked') : '',
        }),
      );
    }
  }

  function act(nav: MenuNavigation): void {
    const a = nav.activated;
    if (page === 'privacy') {
      if (a === ONLINE_ACTION.ok) {
        if (profile.privacy < ONLINE_PRIVACY_VERSION) saveProfile({ ...profile, privacy: ONLINE_PRIVACY_VERSION });
        if (linkCode !== null) openJoin(linkCode);
        else go('home', 'create');
      } else if (nav.back || a === ONLINE_ACTION.back) {
        linkCode = null;
        if (profile.privacy >= ONLINE_PRIVACY_VERSION) go('home', 'privacy');
        else deps.exit();
      }
    } else if (page === 'home') {
      if (nav.back || a === ONLINE_ACTION.back) deps.exit();
      else if (a === ONLINE_ACTION.name) startTyping('name');
      else if (a === ONLINE_ACTION.create) createRoom();
      else if (a === ONLINE_ACTION.privacy) go('privacy', 'ok');
      else if (a === ONLINE_ACTION.join) {
        note = '';
        go('join', 'type');
        startTyping('code');
      }
    } else if (page === 'join') {
      if (nav.back || a === ONLINE_ACTION.back) {
        note = '';
        go('home', 'join');
      } else if (a === ONLINE_ACTION.type) startTyping('code');
      else if (a === ONLINE_ACTION.go) joinRoom();
    } else if (page === 'status') {
      if (a === ONLINE_ACTION.update && updateReady) {
        deps.log('[online] atualizando para a versão nova');
        platform.updates?.apply();
      } else if (statusBusy && (nav.back || a === ONLINE_ACTION.cancel)) closeRoom(null);
      else if (!statusBusy && (nav.back || a === ONLINE_ACTION.ok)) {
        note = '';
        go('home', 'create');
      }
    } else if (page === 'match') {
      const r = room;
      if (r === null) return;
      if (nav.back || a === MODES_ACTION.back) go('room', ONLINE_ACTION.match);
      else if (a !== null && a.startsWith(MODES_PREFIX)) {
        const card = a.slice(MODES_PREFIX.length) as RoomMode;
        if (card === 'custom') {
          deps.pickMatch(recipe, (picked) => {
            if (picked === null) {
              go('match', a);
              return;
            }
            useRecipe(r, picked, card);
            go('room', ONLINE_ACTION.start);
          });
        } else if ((ROOM_MODES as readonly string[]).includes(card)) {
          useRecipe(r, card === 'surprise' ? deps.surprise() : roomPreset(card), card);
          go('room', ONLINE_ACTION.start);
        }
      }
    } else if (room !== null) {
      const r = room;
      // Voltar não sai da sala (o host fecharia para todos sem querer): o foco vai para o Sair da sala.
      if (nav.back) menu.focus('leave');
      else if (a === ONLINE_ACTION.leave) closeRoom(null);
      else if (a === ONLINE_ACTION.team) {
        team = stepTeam(team, nav.delta === 0 ? 1 : nav.delta, teamCountOf(r));
        setChoice();
      } else if (a === ONLINE_ACTION.copy) {
        void r.copyLink().then((ok) => {
          note = ok ? t('online.room.copied') : t('online.room.copyFailed', { code: r.code });
          rebuild();
        });
      } else if (r.role === 'host') {
        if (a === ONLINE_ACTION.start) startMatch(r);
        else if (a === ONLINE_ACTION.lock) r.setLocked(!(r.view?.locked ?? false));
        else if (a === ONLINE_ACTION.match) go('match', MODES_PREFIX + lastCard);
        else if (a !== null && a.startsWith(ONLINE_ACTION.kickPrefix)) {
          r.kick(Number(a.slice(ONLINE_ACTION.kickPrefix.length)));
          menu.focus('start');
        }
      }
    }
  }

  return {
    get room(): OnlineRoom | null {
      return room;
    },
    open(link): void {
      note = '';
      const fromLink = link === undefined ? null : rooms.codeFromLink(link);
      if (link !== undefined) deps.log(`[online] link da sala ${fromLink === null ? 'sem código válido' : fromLink}`);
      if (room !== null) go('room');
      else if (profile.privacy < ONLINE_PRIVACY_VERSION) {
        linkCode = fromLink;
        go('privacy', 'ok');
      } else if (fromLink !== null) openJoin(fromLink);
      else go('home', 'create');
    },
    tick(): void {
      room?.update();
    },
    frame(input, raw, ui, list): void {
      follow();
      // M5 (fase 5c): a versão nova chegou enquanto a tela oferece Atualizar.
      const ready = platform.updates?.ready === true;
      if (offerUpdate && ready !== updateReady) {
        updateReady = ready;
        rebuild();
        // O foco vai para o Atualizar (o OK continua ali do lado).
        if (ready) menu.focus(ONLINE_ACTION.update);
      }
      if (inMatch) return;
      build();
      if (hold && !anyHeld(raw)) hold = false;
      const kb = keyboard;
      if (kb !== null) {
        if (hold) kb.draw(list, ui);
        else {
          const result = kb.frame(input, raw, ui, list);
          if (result !== 'open') keyboardDone(result);
        }
        if (keyboard !== null) return;
        build();
      }
      if (typing === null && !hold) act(menu.update(input, raw, ui));
      if (inMatch) return;
      build();
      menu.draw(list, ui);
    },
    afterMatch(left): void {
      inMatch = false;
      const r = room;
      if (r === null) return;
      if (left && r.role === 'client') {
        deps.log(`[online] saiu da sala ${r.code} no meio da partida`);
        closeRoom(t('online.end.left'));
        return;
      }
      if (r.role === 'host') r.reopen();
      go('room', r.role === 'host' ? 'start' : 'team');
    },
    dispose(): void {
      typing?.close();
      typing = null;
      room?.leave();
      room = null;
    },
  };
}

// M5 (fase 6a): as partidas da sala (o teste da web joga cada uma pela rede de mentira).
export { ROOM_MODES, roomPreset, type RoomMode, type RoomPresetMode } from './online-presets.ts';
