import { BitReader, BitWriter } from '@boboforces/shared';
import {
  checkHello,
  localHello,
  MAX_MESSAGE_BYTES,
  MSG,
  readHello,
  readReject,
  readWelcome,
  REJECT_REASON,
  writeHello,
  writeReject,
  writeWelcome,
  type HelloVerdict,
  type NetHello,
  type NetWelcome,
} from './protocol.ts';
import type { NetEndpoint } from './transport.ts';

/**
 * O lobby da sala (M5 fase 4a): quem entra, quem é quem, os times e o começo. Tudo pelo canal confiável; o host
 * decide (o slot de cada um, quem entra, quando começa) e manda o estado inteiro a todos a cada mudança (é pequeno).
 * As mensagens do lobby são JSON (poucas e raras); o que chega de um amigo é validado. O Trystero liga todo mundo
 * com todo mundo na sala: o cliente manda o "oi" a cada amigo que aparece e só o host responde.
 */

/** Até 4 humanos na partida (#25). */
export const MAX_ROOM_PLAYERS = 4;
/** Nome de até 16 caracteres (tecnico.md §13.5). */
export const MAX_NAME_CHARS = 16;
/** O Meu Bobo viaja como o documento `bobo@1` (texto); mais que isto é recusado. */
export const MAX_BOBO_CHARS = 4096;
/** O resumo da partida que o host escolheu (para a tela do lobby). */
export const MAX_SUMMARY_CHARS = 80;

/** Mensagens do lobby (o 1º byte). As da partida são snapshot, input e events. */
export const LOBBY_MSG = {
  lobby: MSG.lobby,
  choice: MSG.choice,
  start: MSG.start,
  kick: MSG.kick,
  leave: MSG.leave,
  /** M5 (fase 5b): o host fechou a sala de propósito. */
  close: MSG.close,
} as const;

/** O tipo é do lobby (o handshake inclusive)? O repartidor (`createEndpointMux`) usa. */
export function isLobbyMessage(type: number): boolean {
  return (
    type === MSG.hello ||
    type === MSG.welcome ||
    type === MSG.reject ||
    (type >= LOBBY_MSG.lobby && type <= LOBBY_MSG.leave) ||
    type === LOBBY_MSG.close
  );
}

/** O que cada um escolhe no lobby. `team` -1 = tanto faz (o host distribui). */
export interface LobbyChoice {
  readonly name: string;
  readonly team: number;
  readonly bobo: string | null;
  readonly ready: boolean;
}

export interface LobbyMember extends LobbyChoice {
  /** 0 = o host; 1..3 = os amigos, na ordem em que entraram. */
  readonly slot: number;
}

export interface LobbyState {
  readonly code: string;
  readonly locked: boolean;
  readonly summary: string;
  /** M5 (fase 4c): a partida escolhida tem times (a escolha do time só vale aí). */
  readonly teams: boolean;
  /** M5 (fase 4c): a partida está rolando; ao voltar a `false`, quem estava nela volta ao lobby. */
  readonly playing: boolean;
  readonly members: readonly LobbyMember[];
}

/** Um jogador no começo: o controlador da partida (o host monta a receita) e o resto da escolha dele. */
export interface LobbyStartMember extends LobbyMember {
  readonly controller: number;
}

/** O começo: a receita (o `game` valida), a semente e os jogadores. */
export interface LobbyStart {
  readonly recipe: unknown;
  readonly seed: number;
  readonly members: readonly LobbyStartMember[];
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Mensagem JSON do lobby: o tipo e o texto em UTF-8. */
export function encodeLobbyMessage(type: number, payload: unknown): Uint8Array {
  const text = encoder.encode(JSON.stringify(payload));
  const out = new Uint8Array(1 + text.length);
  out[0] = type;
  out.set(text, 1);
  return out;
}

/** Lê o corpo JSON (o tipo já é conhecido); `undefined` = estragado. */
export function decodeLobbyPayload(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(decoder.decode(bytes.subarray(1))) as unknown;
  } catch {
    return undefined;
  }
}

function cleanName(v: unknown, fallback: string): string {
  if (typeof v !== 'string') return fallback;
  // Espaços e quebras de linha juntos viram um espaço (antes: senão "a\nb" colaria); depois, sem controle nenhum.
  const s = v
    .replace(/\s+/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  return s.length === 0 ? fallback : [...s].slice(0, MAX_NAME_CHARS).join('');
}

/** A escolha que veio de um amigo (não confiável). */
export function parseLobbyChoice(v: unknown, fallbackName: string): LobbyChoice | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  const team = o['team'];
  const bobo = o['bobo'];
  return {
    name: cleanName(o['name'], fallbackName),
    team: typeof team === 'number' && Number.isInteger(team) && team >= -1 && team <= 3 ? team : -1,
    bobo: typeof bobo === 'string' && bobo.length <= MAX_BOBO_CHARS ? bobo : null,
    ready: o['ready'] === true,
  };
}

function parseMember(v: unknown): LobbyMember | null {
  const c = parseLobbyChoice(v, 'Bobo');
  if (c === null) return null;
  const slot = (v as Record<string, unknown>)['slot'];
  if (typeof slot !== 'number' || !Number.isInteger(slot) || slot < 0 || slot >= MAX_ROOM_PLAYERS) return null;
  return { ...c, slot };
}

/** O estado da sala que o host mandou (o cliente confere tudo). */
export function parseLobbyState(v: unknown): LobbyState | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  const members = o['members'];
  if (typeof o['code'] !== 'string' || !Array.isArray(members) || members.length > MAX_ROOM_PLAYERS) return null;
  const parsed = members.map(parseMember);
  if (parsed.some((m) => m === null)) return null;
  const summary = o['summary'];
  return {
    code: o['code'].slice(0, 8),
    locked: o['locked'] === true,
    summary: typeof summary === 'string' ? summary.slice(0, MAX_SUMMARY_CHARS) : '',
    teams: o['teams'] !== false,
    playing: o['playing'] === true,
    members: parsed as LobbyMember[],
  };
}

/** O começo que o host mandou. */
export function parseLobbyStart(v: unknown): LobbyStart | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  const seed = o['seed'];
  const members = o['members'];
  if (typeof seed !== 'number' || !Number.isInteger(seed) || !Array.isArray(members)) return null;
  if (members.length === 0 || members.length > MAX_ROOM_PLAYERS) return null;
  const out: LobbyStartMember[] = [];
  for (const m of members) {
    const base = parseMember(m);
    const controller = (m as Record<string, unknown>)['controller'];
    if (base === null || typeof controller !== 'number' || !Number.isInteger(controller) || controller < 0) {
      return null;
    }
    out.push({ ...base, controller });
  }
  return { recipe: o['recipe'], seed, members: out };
}

// ---------------------------------------------------------------------------------------------------------------
// Host
// ---------------------------------------------------------------------------------------------------------------

export interface LobbyHostConfig {
  /** O endpoint do lobby (o lado "lobby" do repartidor). */
  readonly endpoint: NetEndpoint;
  readonly code: string;
  readonly host: LobbyChoice;
  readonly hello?: NetHello;
  /** Ritmo da partida que vai no welcome. */
  readonly hz: number;
  readonly snapshotHz: number;
}

export interface LobbyHost {
  readonly state: LobbyState;
  /** Já começou (quem chegar agora é recusado como sala travada). */
  readonly started: boolean;
  /** O peer (endpoint) de um slot remoto, ou -1. */
  peerOfSlot(slot: number): number;
  /** Lê o lobby e manda o estado se mudou. A cada frame. */
  update(): void;
  setHostChoice(choice: LobbyChoice): void;
  setSummary(text: string, teams?: boolean): void;
  setLocked(on: boolean): void;
  /** Tira um amigo da sala (ele recebe o aviso). */
  kick(slot: number): void;
  /** O transporte disse que o peer saiu. */
  removePeer(peer: number): void;
  /** Manda o começo a todos (o `game` montou a receita e os controladores). */
  start(start: LobbyStart): void;
  /**
   * M5 (fase 4c): a partida acabou e a sala volta ao lobby (dá para começar outra; quem chegar agora entra). Os amigos
   * ficam "fora da sala" (`ready` falso) até voltarem do resultado.
   */
  reopen(): void;
  /** Mudou o estado (alguém entrou, saiu ou escolheu). */
  onChange: (() => void) | null;
  /**
   * M5 (fase 5b): quem caiu no meio da partida voltou (o mesmo aparelho): o lugar novo dele, o de antes e o peer. A
   * casca devolve o controlador dele (estava com um bot); o começo, com o lugar novo, já foi a ele.
   */
  onRejoin: ((rejoin: LobbyRejoin) => void) | null;
  /** M5 (fase 5b): fecha a sala de propósito (os amigos não tentam voltar). */
  close(): void;
  /**
   * M5 (fase 5c): alguém foi recusado pela versão; o veredito visto deste lado (`update-friend` = o amigo está na mais
   * antiga; `update-self` = o host é que precisa atualizar; `mismatch` = mesma versão com conteúdo diferente).
   */
  onVersionReject: ((verdict: HelloVerdict) => void) | null;
}

/** M5 (fase 5b): quem caiu na partida e voltou. */
export interface LobbyRejoin {
  readonly slot: number;
  readonly oldSlot: number;
  readonly peer: number;
}

export function createLobbyHost(config: LobbyHostConfig): LobbyHost {
  const { endpoint, code } = config;
  const hello = config.hello ?? localHello();
  const reader = new BitReader(new Uint8Array(0));
  const reply = new BitWriter(MAX_MESSAGE_BYTES);
  const peers = new Map<number, number>(); // slot → peer
  let host: LobbyMember = { ...config.host, slot: 0 };
  let members: LobbyMember[] = [host];
  let locked = false;
  let summary = '';
  let teams = true;
  let started = false;
  let dirty = true;
  /** M5 (fase 5b): o id do aparelho de cada lugar, quem caiu na partida em andamento (por id) e quem foi tirado. */
  const idOfSlot = new Map<number, string>();
  const dropped = new Map<string, LobbyMember>();
  const banned = new Set<string>();
  let lastStart: LobbyStart | null = null;

  const state = (): LobbyState => ({ code, locked, summary, teams, playing: started, members });
  const broadcast = (): void => {
    const bytes = encodeLobbyMessage(LOBBY_MSG.lobby, state());
    for (const peer of peers.values()) endpoint.send(peer, 'reliable', bytes);
  };
  const slotOfPeer = (peer: number): number => {
    for (const [slot, p] of peers) if (p === peer) return slot;
    return -1;
  };
  const remove = (slot: number): void => {
    // Na partida, quem sai fica lembrado pelo aparelho: se voltar, o boneco é dele de novo.
    const id = idOfSlot.get(slot);
    const member = members.find((m) => m.slot === slot);
    if (started && id !== undefined && member !== undefined) dropped.set(id, member);
    idOfSlot.delete(slot);
    peers.delete(slot);
    members = members.filter((m) => m.slot !== slot);
    dirty = true;
  };
  const firstFreeSlot = (prefer: number): number => {
    if (prefer > 0 && prefer < MAX_ROOM_PLAYERS && !peers.has(prefer)) return prefer;
    for (let k = 1; k < MAX_ROOM_PLAYERS; k++) if (!peers.has(k)) return k;
    return -1;
  };
  const answer = (peer: number, theirs: NetHello): void => {
    reply.reset();
    const slot = slotOfPeer(peer);
    const id = theirs.deviceId ?? '';
    const back = slot < 0 && started && id !== '' ? dropped.get(id) : undefined;
    const verdict = checkHello(hello, theirs);
    if (verdict !== 'ok') {
      writeReject(reply, REJECT_REASON.version, hello);
      api.onVersionReject?.(verdict);
    } else if (slot < 0 && id !== '' && banned.has(id)) {
      writeReject(reply, REJECT_REASON.kicked, hello);
    } else if (back !== undefined) {
      // M5 (fase 5b): caiu no meio da partida e voltou: entra mesmo com a sala trancada ou jogando, de volta ao boneco
      // dele (o começo vai junto, com o lugar novo no lugar do antigo).
      const s = firstFreeSlot(back.slot);
      if (s < 0) {
        writeReject(reply, REJECT_REASON.full, hello);
      } else {
        dropped.delete(id);
        idOfSlot.set(s, id);
        peers.set(s, peer);
        members = [...members, { ...back, slot: s, ready: false }].sort((a, b) => a.slot - b.slot);
        dirty = true;
        writeWelcome(reply, { slot: s, hz: config.hz, snapshotHz: config.snapshotHz });
        endpoint.send(peer, 'reliable', reply.bytes());
        if (lastStart !== null) {
          const start: LobbyStart = {
            ...lastStart,
            members: lastStart.members.map((m) => (m.slot === back.slot ? { ...m, slot: s } : m)),
          };
          lastStart = start;
          endpoint.send(peer, 'reliable', encodeLobbyMessage(LOBBY_MSG.start, start));
        }
        api.onRejoin?.({ slot: s, oldSlot: back.slot, peer });
        return;
      }
    } else if (slot < 0 && (locked || started)) {
      writeReject(reply, REJECT_REASON.locked, hello);
    } else {
      let s = slot;
      if (s < 0) {
        for (let k = 1; k < MAX_ROOM_PLAYERS && s < 0; k++) if (!peers.has(k)) s = k;
      }
      if (s < 0) {
        writeReject(reply, REJECT_REASON.full, hello);
      } else {
        if (slot < 0) {
          peers.set(s, peer);
          if (id !== '') idOfSlot.set(s, id);
          members = [...members, { name: `Amigo ${s}`, team: -1, bobo: null, ready: false, slot: s }].sort(
            (a, b) => a.slot - b.slot,
          );
          dirty = true;
        }
        writeWelcome(reply, { slot: s, hz: config.hz, snapshotHz: config.snapshotHz });
      }
    }
    endpoint.send(peer, 'reliable', reply.bytes());
  };

  const onMessage = (from: number, channel: string, bytes: Uint8Array): void => {
    if (channel !== 'reliable' || bytes.length === 0) return;
    const type = bytes[0]!;
    if (type === MSG.hello) {
      try {
        reader.reset(bytes);
        reader.readBits(8);
        answer(from, readHello(reader));
      } catch {
        // Oi estragado: ignorado.
      }
      return;
    }
    const slot = slotOfPeer(from);
    if (slot < 0) return;
    if (type === LOBBY_MSG.choice && !started) {
      const choice = parseLobbyChoice(decodeLobbyPayload(bytes), `Amigo ${slot}`);
      if (choice === null) return;
      members = members.map((m) => (m.slot === slot ? { ...choice, slot } : m));
      dirty = true;
    } else if (type === LOBBY_MSG.leave) {
      remove(slot);
    }
  };

  const api: LobbyHost = {
    get state(): LobbyState {
      return state();
    },
    get started(): boolean {
      return started;
    },
    onChange: null,
    onRejoin: null,
    onVersionReject: null,
    peerOfSlot: (slot) => peers.get(slot) ?? -1,
    update(): void {
      endpoint.poll(onMessage);
      if (!dirty) return;
      dirty = false;
      broadcast();
      api.onChange?.();
    },
    setHostChoice(choice): void {
      host = { ...choice, name: cleanName(choice.name, 'Host'), slot: 0 };
      members = members.map((m) => (m.slot === 0 ? host : m));
      dirty = true;
    },
    setSummary(text, withTeams = true): void {
      summary = text.slice(0, MAX_SUMMARY_CHARS);
      teams = withTeams;
      dirty = true;
    },
    setLocked(on): void {
      locked = on;
      dirty = true;
    },
    kick(slot): void {
      const peer = peers.get(slot);
      if (peer === undefined) return;
      endpoint.send(peer, 'reliable', encodeLobbyMessage(LOBBY_MSG.kick, {}));
      // Tirado não volta naquela sala (GDD §3.7): o aparelho fica barrado, e não lembrado como quem caiu.
      const id = idOfSlot.get(slot);
      remove(slot);
      if (id !== undefined) {
        banned.add(id);
        dropped.delete(id);
      }
    },
    close(): void {
      const bytes = encodeLobbyMessage(LOBBY_MSG.close, {});
      for (const peer of peers.values()) endpoint.send(peer, 'reliable', bytes);
    },
    removePeer(peer): void {
      const slot = slotOfPeer(peer);
      if (slot >= 0) remove(slot);
    },
    start(s): void {
      started = true;
      lastStart = s;
      dropped.clear();
      const bytes = encodeLobbyMessage(LOBBY_MSG.start, s);
      for (const peer of peers.values()) endpoint.send(peer, 'reliable', bytes);
      dirty = true;
    },
    reopen(): void {
      if (!started) return;
      started = false;
      // De volta ao lobby, quem caiu entra como qualquer um.
      dropped.clear();
      lastStart = null;
      members = members.map((m) => (m.slot === 0 ? m : { ...m, ready: false }));
      dirty = true;
    },
  };
  return api;
}

// ---------------------------------------------------------------------------------------------------------------
// Cliente
// ---------------------------------------------------------------------------------------------------------------

/** `connecting` até o host responder; `in` no lobby; `started` com o começo (volta a `in` no fim); o resto acabou. */
export type LobbyClientStatus = 'connecting' | 'in' | 'rejected' | 'kicked' | 'started' | 'closed';

export interface LobbyClientConfig {
  readonly endpoint: NetEndpoint;
  readonly choice: LobbyChoice;
  readonly hello?: NetHello;
  /** M5 (fase 5b): o id do aparelho (vai no hello; o host reconhece quem volta e quem tirou). */
  readonly deviceId?: string;
}

export interface LobbyClient {
  readonly status: LobbyClientStatus;
  /** O peer do host (-1 até o welcome). */
  readonly host: number;
  readonly welcome: NetWelcome | null;
  readonly state: LobbyState | null;
  readonly start: LobbyStart | null;
  /** Por que o host recusou: sala cheia, travada, quem já foi tirado dela ou o veredito de versão deste lado. */
  readonly rejection: HelloVerdict | 'full' | 'locked' | 'kicked' | null;
  /** M5 (fase 5b): o host fechou a sala de propósito (`closed` sem isto = a conexão caiu). */
  readonly hostClosed: boolean;
  /** Um amigo apareceu na sala: manda o oi (só o host responde). */
  addPeer(peer: number): void;
  /** Um amigo saiu; se foi o host, a sala acabou ("host saiu = fim"). */
  removePeer(peer: number): void;
  update(): void;
  setChoice(choice: LobbyChoice): void;
  leave(): void;
  onChange: (() => void) | null;
}

export function createLobbyClient(config: LobbyClientConfig): LobbyClient {
  const { endpoint } = config;
  const base = config.hello ?? localHello();
  const hello: NetHello = config.deviceId !== undefined ? { ...base, deviceId: config.deviceId } : base;
  const reader = new BitReader(new Uint8Array(0));
  const out = new BitWriter(MAX_MESSAGE_BYTES);
  let status: LobbyClientStatus = 'connecting';
  let hostClosed = false;
  let host = -1;
  let welcome: NetWelcome | null = null;
  let state: LobbyState | null = null;
  let start: LobbyStart | null = null;
  let rejection: LobbyClient['rejection'] = null;
  let choice = config.choice;
  let changed = false;

  const sendChoice = (): void => {
    if (host >= 0) endpoint.send(host, 'reliable', encodeLobbyMessage(LOBBY_MSG.choice, choice));
  };

  const onMessage = (from: number, channel: string, bytes: Uint8Array): void => {
    if (channel !== 'reliable' || bytes.length === 0) return;
    const type = bytes[0]!;
    if (type === MSG.welcome && status === 'connecting') {
      reader.reset(bytes);
      reader.readBits(8);
      welcome = readWelcome(reader);
      host = from;
      status = 'in';
      sendChoice();
      changed = true;
      return;
    }
    if (type === MSG.reject && status === 'connecting') {
      reader.reset(bytes);
      reader.readBits(8);
      const r = readReject(reader);
      rejection =
        r.reason === REJECT_REASON.full
          ? 'full'
          : r.reason === REJECT_REASON.locked
            ? 'locked'
            : r.reason === REJECT_REASON.kicked
              ? 'kicked'
              : checkHello(hello, r.host);
      status = 'rejected';
      changed = true;
      return;
    }
    if (from !== host) return;
    if (type === LOBBY_MSG.lobby) {
      const s = parseLobbyState(decodeLobbyPayload(bytes));
      if (s !== null) {
        state = s;
        changed = true;
        if (status === 'started' && !s.playing) {
          status = 'in';
          start = null;
          sendChoice();
        }
      }
    } else if (type === LOBBY_MSG.start && status === 'in') {
      const s = parseLobbyStart(decodeLobbyPayload(bytes));
      if (s !== null) {
        start = s;
        status = 'started';
        changed = true;
      }
    } else if (type === LOBBY_MSG.kick) {
      status = 'kicked';
      changed = true;
    } else if (type === LOBBY_MSG.close) {
      hostClosed = true;
      status = 'closed';
      changed = true;
    }
  };

  const api: LobbyClient = {
    get status(): LobbyClientStatus {
      return status;
    },
    get host(): number {
      return host;
    },
    get welcome(): NetWelcome | null {
      return welcome;
    },
    get state(): LobbyState | null {
      return state;
    },
    get start(): LobbyStart | null {
      return start;
    },
    get rejection(): LobbyClient['rejection'] {
      return rejection;
    },
    get hostClosed(): boolean {
      return hostClosed;
    },
    onChange: null,
    addPeer(peer): void {
      if (status !== 'connecting') return;
      out.reset();
      writeHello(out, hello);
      endpoint.send(peer, 'reliable', out.bytes());
    },
    removePeer(peer): void {
      if (peer !== host || status === 'closed') return;
      status = 'closed';
      changed = true;
    },
    update(): void {
      // Mensagens estragadas de um amigo não derrubam o frame.
      endpoint.poll((from, channel, bytes) => {
        try {
          onMessage(from, channel, bytes);
        } catch {
          // ignorada
        }
      });
      if (!changed) return;
      changed = false;
      api.onChange?.();
    },
    setChoice(c): void {
      choice = c;
      sendChoice();
    },
    leave(): void {
      if (host >= 0 && status !== 'closed') endpoint.send(host, 'reliable', encodeLobbyMessage(LOBBY_MSG.leave, {}));
      status = 'closed';
    },
  };
  return api;
}
