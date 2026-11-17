import type { MatchRecipe } from '@boboforces/format';
import type {
  OnlineMatchStart,
  OnlineRoom,
  OnlineRoomChoice,
  OnlineRoomEnd,
  OnlineRooms,
  OnlineRoomStatus,
  OnlineRoomView,
} from '@boboforces/game';
import type { LobbyChoice, LobbyClient, LobbyRejoin, LobbyStart, LobbyState, NetEndpoint } from '@boboforces/net';
import type { NetModule } from './online.ts';
import { createOnlineSession } from './online-session.ts';

/**
 * A sala do Online na web (M5 fase 4c): o contrato `OnlineRooms` do `game` feito com o `net`. Cada sala é um
 * transporte (o Trystero pelos relays Nostr; nos testes, o loopback ou a sinalização local), repartido em lobby e
 * partida; o lobby decide quem entra e quando começa, e cada começo vira uma `OnlineSession` para a cena.
 */

/** O transporte de uma sala: o `NetRoom` do `net` (ou o de mentira dos testes). */
export interface RoomTransport {
  readonly endpoint: NetEndpoint;
  onPeerJoin: ((id: number) => void) | null;
  onPeerLeave: ((id: number) => void) | null;
  update(): void;
  leave(): Promise<void> | void;
}

export interface WebRoomsDeps {
  readonly net: NetModule;
  /** Abre o transporte da sala deste código. */
  connect(code: string): RoomTransport;
  /** Relógio em ms (o prazo de achar o host). */
  readonly now: () => number;
  /** Em [0, 1) (o código da sala novo). */
  readonly random: () => number;
  /** M5 (fase 5b): 16 dígitos hexadecimais do sorteio forte (o id do aparelho). */
  readonly randomHex16: () => string;
  /** O link da sala (`https://…/#sala=XXXXX`). */
  linkFor(code: string): string;
  /** Copia para a área de transferência; `false` se recusou. */
  copy(text: string): Promise<boolean>;
  log(line: string): void;
  /** Prazo para o host responder (padrão `JOIN_TIMEOUT_MS`). */
  readonly joinTimeoutMs?: number;
}

/** Sem resposta do host neste prazo: "ninguém respondeu nesse código". Os relays às vezes levam uns segundos. */
export const JOIN_TIMEOUT_MS = 20_000;
/** M5 (fase 5b): quem perdeu o host sem o "fechei a sala" tenta voltar por este tempo. */
export const RECONNECT_TIMEOUT_MS = 20_000;
/** M5 (fase 5b): voltando, o host ainda com o lugar antigo ("trancada"/"cheia"): a próxima tentativa sai depois disto. */
export const RECONNECT_RETRY_MS = 1500;
/** M5 (fase 5b): o host fecha a sala e espera isto antes de soltar a conexão (o aviso tem que sair). */
export const CLOSE_GRACE_MS = 300;
/** O ritmo da partida online (o welcome leva; tecnico.md §13.3). */
export const ONLINE_HZ = 60;
export const ONLINE_SNAPSHOT_HZ = 30;

const NONE: readonly number[] = [];
const NONE_REJOINED: readonly LobbyRejoin[] = [];

const toLobby = (c: OnlineRoomChoice): LobbyChoice => ({ name: c.name, team: c.team, bobo: null, ready: c.ready });

function toView(s: LobbyState): OnlineRoomView {
  return {
    code: s.code,
    locked: s.locked,
    summary: s.summary,
    teams: s.teams,
    playing: s.playing,
    members: s.members.map((m) => ({ slot: m.slot, name: m.name, team: m.team, ready: m.ready })),
  };
}

export function createWebRooms(deps: WebRoomsDeps): OnlineRooms {
  const { net } = deps;

  /** O que sobra do lado "partida" sem partida ligada (o fim da anterior) vai fora: não chega à próxima. */
  const drain = (ep: NetEndpoint): void => ep.poll(() => undefined);

  function hostRoom(choice: OnlineRoomChoice): OnlineRoom {
    const code = net.newRoomCode(deps.random);
    const transport = deps.connect(code);
    const [lobbyEp, matchEp] = net.createEndpointMux(transport.endpoint, net.isLobbyMessage);
    const lobby = net.createLobbyHost({
      endpoint: lobbyEp,
      code,
      host: toLobby(choice),
      hz: ONLINE_HZ,
      snapshotHz: ONLINE_SNAPSHOT_HZ,
    });
    let status: OnlineRoomStatus = 'lobby';
    let view = toView(lobby.state);
    let match: OnlineMatchStart | null = null;
    let attached = false;
    let closed = false;
    /** Os lugares que saíram durante a partida (um bot assume cada um). */
    const left: number[] = [];
    /** Os lugares na partida em andamento (quem some do lobby enquanto ela roda vai para `left`). */
    const inMatch = new Set<number>();
    /** M5 (fase 5b): quem caiu na partida e voltou (a sessão devolve o controlador). */
    const rejoined: LobbyRejoin[] = [];
    /** M5 (fase 5c): o último aviso de versão para a tela do host. */
    let versionNotice: 'friend' | 'host' | null = null;
    lobby.onVersionReject = (verdict) => {
      deps.log(`[online] sala ${code}: recusado pela versão (${verdict})`);
      versionNotice = verdict === 'update-self' ? 'host' : 'friend';
    };
    lobby.onRejoin = (r) => {
      if (status !== 'playing') return;
      deps.log(`[online] sala ${code}: o lugar ${r.oldSlot} voltou (agora ${r.slot})`);
      // Caiu e voltou na mesma leitura do lobby (a aba do host estava parada): a diferença do estado não viu a saída,
      // então ela entra aqui, antes da volta (a sessão lê as saídas antes das voltas).
      if (inMatch.delete(r.oldSlot)) left.push(r.oldSlot);
      inMatch.add(r.slot);
      rejoined.push(r);
    };
    lobby.onChange = () => {
      view = toView(lobby.state);
      // Pela diferença do estado, e não pelo aviso do transporte: o "saí" do amigo (ou o Tirar) pode chegar antes dele,
      // e aí o peer já não tem lugar para achar.
      if (status !== 'playing') return;
      for (const slot of inMatch) {
        if (!view.members.some((m) => m.slot === slot)) {
          inMatch.delete(slot);
          left.push(slot);
        }
      }
    };
    transport.onPeerLeave = (peer) => lobby.removePeer(peer);
    return {
      role: 'host',
      code,
      get status() {
        return status;
      },
      end: null,
      get view() {
        return view;
      },
      mySlot: 0,
      get match() {
        return match;
      },
      update(): void {
        if (closed) return;
        transport.update();
        lobby.update();
        if (!attached && status !== 'playing') drain(matchEp);
      },
      setChoice: (c) => lobby.setHostChoice(toLobby(c)),
      setSummary: (text, teams) => lobby.setSummary(text, teams),
      setLocked: (on) => lobby.setLocked(on),
      kick: (slot) => lobby.kick(slot),
      start(recipe: MatchRecipe, seed: number, controllers: readonly number[]): OnlineMatchStart {
        // Os jogadores na ordem do estado que a tela mostrou (é nessa ordem que vieram os controladores).
        const start: LobbyStart = {
          recipe,
          seed,
          members: view.members.map((m, i) => ({ ...toLobby(m), slot: m.slot, controller: controllers[i] ?? i })),
        };
        lobby.start(start);
        status = 'playing';
        left.length = 0;
        inMatch.clear();
        // Quem saiu entre a tela e o começo já entra como bot.
        for (const m of view.members) {
          if (m.slot === 0) continue;
          if (lobby.peerOfSlot(m.slot) < 0) left.push(m.slot);
          else inMatch.add(m.slot);
        }
        // O que sobrou da partida anterior no lado "partida" vai fora: uma entrada velha (seq alta) faria o host
        // recusar as novas do amigo.
        drain(matchEp);
        const session = createOnlineSession({
          net,
          role: 'host',
          endpoint: matchEp,
          start,
          mySlot: 0,
          peerOfSlot: (slot) => lobby.peerOfSlot(slot),
          hostPeer: -1,
          welcome: null,
          snapshotHz: ONLINE_SNAPSHOT_HZ,
          isClosed: () => closed,
          // Quase sempre vazias: a mesma lista vazia, sem alocar a cada quadro.
          takeLeftSlots: () => (left.length === 0 ? NONE : left.splice(0)),
          takeRejoined: () => (rejoined.length === 0 ? NONE_REJOINED : rejoined.splice(0)),
          onAttached: (on) => {
            attached = on;
          },
        });
        rejoined.length = 0;
        match = { recipe, seed, session };
        deps.log(`[online] sala ${code}: começou (${start.members.length} jogador(es))`);
        return match;
      },
      reopen(): void {
        if (status !== 'playing') return;
        lobby.reopen();
        status = 'lobby';
      },
      copyLink: () => deps.copy(deps.linkFor(code)),
      takeVersionNotice() {
        const n = versionNotice;
        versionNotice = null;
        return n;
      },
      leave(): void {
        if (closed) return;
        closed = true;
        status = 'ended';
        // De propósito: os amigos não tentam voltar (5b). O aviso sai antes de a conexão fechar.
        lobby.close();
        setTimeout(() => void transport.leave(), CLOSE_GRACE_MS);
      },
    };
  }

  function clientRoom(code: string, choice: OnlineRoomChoice, deviceId: string): OnlineRoom {
    const timeout = deps.joinTimeoutMs ?? JOIN_TIMEOUT_MS;
    let current = choice;
    let status: OnlineRoomStatus = 'connecting';
    let end: OnlineRoomEnd | null = null;
    let view: OnlineRoomView | null = null;
    let lastState: LobbyState | null = null;
    let match: OnlineMatchStart | null = null;
    let lastStart: LobbyStart | null = null;
    let attached = false;
    let closed = false;
    /** Desde quando procura o host (a 1ª vez ou voltando depois de cair). */
    let since = deps.now();
    /** Voltando: a próxima tentativa (depois de ouvir "trancada" ou "cheia" do host que ainda não viu a queda). */
    let retryAt = -1;
    // A conexão de agora (cada volta abre outra, com o mesmo código e o mesmo aparelho).
    let transport!: RoomTransport;
    let matchEp!: NetEndpoint;
    let lc!: LobbyClient;
    const finish = (why: OnlineRoomEnd): void => {
      if (status === 'ended') return;
      status = 'ended';
      end = why;
      closed = true;
      void transport.leave();
    };
    /** M5 (fase 5b): o host sumiu sem fechar a sala: a conexão caiu (a minha ou a dele). Tenta voltar por 20 s. */
    const reconnect = (again = false): void => {
      if (!again) {
        deps.log(`[online] sala ${code}: a conexão com o host caiu, voltando`);
        since = deps.now();
      }
      status = 'reconnecting';
      retryAt = -1;
      const old = transport;
      // O Trystero só entra de novo na mesma sala depois de sair da anterior.
      void Promise.resolve(old.leave()).then(() => {
        if (!closed && status === 'reconnecting') open();
      });
    };
    const onChange = (mine: LobbyClient): void => {
      if (mine !== lc) return;
      if (lc.state !== null && lc.state !== lastState) {
        lastState = lc.state;
        view = toView(lc.state);
      }
      const st = lc.status;
      if (st === 'in') status = 'lobby';
      else if (st === 'started' && lc.start !== null && lc.welcome !== null) {
        status = 'playing';
        if (lc.start !== lastStart) {
          const start = lc.start;
          const welcome = lc.welcome;
          lastStart = start;
          // O que sobrou da partida anterior (um evento velho de tick alto travaria a fila dos novos) vai fora.
          drain(matchEp);
          let session: OnlineMatchStart['session'];
          try {
            session = createOnlineSession({
              net,
              role: 'client',
              endpoint: matchEp,
              start,
              mySlot: welcome.slot,
              peerOfSlot: () => -1,
              hostPeer: lc.host,
              welcome,
              snapshotHz: ONLINE_SNAPSHOT_HZ,
              // A partida acaba para este aparelho quando a sala volta ao lobby, acaba, começa outra ou a conexão cai.
              isClosed: () => closed || mine !== lc || mine.status !== 'started' || mine.start !== start,
              takeLeftSlots: () => [],
              onAttached: (on) => {
                attached = on;
              },
            });
          } catch (error) {
            // O começo não tem o meu lugar (ou veio torto): a sala acaba para mim, o jogo segue.
            deps.log(`[online] começo inválido: ${error instanceof Error ? error.message : String(error)}`);
            finish('mismatch');
            return;
          }
          match = { recipe: start.recipe, seed: start.seed, session };
        }
      } else if (st === 'rejected') {
        // Voltando, "trancada" e "cheia" são o lugar antigo ainda ocupado do lado do host: tenta de novo daqui a pouco.
        if (status === 'reconnecting' && (lc.rejection === 'locked' || lc.rejection === 'full')) {
          retryAt = deps.now() + RECONNECT_RETRY_MS;
          return;
        }
        finish(lc.rejection === null || lc.rejection === 'ok' ? 'mismatch' : lc.rejection);
      } else if (st === 'kicked') finish('kicked');
      else if (st === 'closed' && !closed) {
        if (lc.hostClosed || lc.welcome === null) finish('host-left');
        else reconnect();
      }
    };
    const open = (): void => {
      transport = deps.connect(code);
      const [lobbyEp, m] = net.createEndpointMux(transport.endpoint, net.isLobbyMessage);
      matchEp = m;
      const mine = net.createLobbyClient({ endpoint: lobbyEp, choice: toLobby(current), deviceId });
      lc = mine;
      transport.onPeerJoin = (peer) => mine.addPeer(peer);
      transport.onPeerLeave = (peer) => mine.removePeer(peer);
      mine.onChange = () => onChange(mine);
    };
    open();
    return {
      role: 'client',
      code,
      get status() {
        return status;
      },
      get end() {
        return end;
      },
      get view() {
        return view;
      },
      get mySlot() {
        return lc.welcome?.slot ?? -1;
      },
      get match() {
        return match;
      },
      update(): void {
        if (closed) return;
        transport.update();
        lc.update();
        const waited = deps.now() - since;
        if (status === 'connecting' && waited > timeout) finish('not-found');
        if (status === 'reconnecting' && waited > RECONNECT_TIMEOUT_MS) finish('host-left');
        else if (status === 'reconnecting' && retryAt >= 0 && deps.now() >= retryAt) reconnect(true);
        if (!attached && status !== 'playing') drain(matchEp);
      },
      setChoice: (c) => {
        current = c;
        lc.setChoice(toLobby(c));
      },
      setSummary: () => undefined,
      setLocked: () => undefined,
      kick: () => undefined,
      start(): OnlineMatchStart {
        throw new Error('online: só o host começa a partida');
      },
      reopen: () => undefined,
      copyLink: () => deps.copy(deps.linkFor(code)),
      takeVersionNotice: () => null,
      leave(): void {
        if (closed) return;
        lc.leave();
        closed = true;
        status = 'ended';
        void transport.leave();
      },
    };
  }

  return {
    create: hostRoom,
    join: clientRoom,
    codeAlphabet: net.ROOM_CODE_ALPHABET,
    codeLength: net.ROOM_CODE_LENGTH,
    codeFromLink: (text) => net.parseRoomHash(text),
    newDeviceId: () => deps.randomHex16(),
  };
}
