import type { MatchRecipe } from '@boboforces/format';
import type { InputFrame } from '@boboforces/input';
import type { Sim, SimEvent } from '@boboforces/sim';
import { placeHumans, type SeatedRecipe } from './scene/seats.ts';

/**
 * O online visto pelo `game` (M5 fase 4b, tecnico.md §13.1). Decisão menor revisável: o contrato fica aqui e não no
 * `platform-api`, porque ele fala de `Sim`, `SimEvent` e `InputFrame`, que o `platform-api` não enxerga. A casca web o
 * implementa com o `net` (o único que conhece o Trystero) e o entrega à cena no `SceneRequest.online`; no Switch ele
 * não existe (#1) e o `platform.online` continua nulo (regra 18).
 */

/**
 * M5 (fase 7a): os números da rede de uma partida (o F2 e a linha `[rede]` do registro). Contadores desde o começo;
 * quem lê faz a conta por segundo.
 */
export interface OnlineNetStats {
  /** Bytes mandados e recebidos pela partida (os dois canais; o lobby não conta). */
  readonly sentBytes: number;
  readonly receivedBytes: number;
  /** Host: amigos ligados agora. Amigo: 1 (o host). */
  readonly peers: number;
  /** Host: snapshots montados (um por amigo). Amigo: snapshots aplicados. */
  readonly snapshots: number;
  /** Amigo: quantos ticks o que ele mostra está atrás do snapshot mais novo (-1 no host ou antes do 1º). */
  readonly lagTicks: number;
  /** Amigo: reconciliações da predição e as que erraram mais de 10 cm (0 no host). */
  readonly reconciles: number;
  readonly mispredicts: number;
}

/** O lado do host numa partida: a sim é a dele, os amigos mandam entradas e recebem o estado. */
export interface OnlineHostLink {
  /** Lê o que chegou (entradas, acks). Antes dos ticks do frame. */
  receive(): void;
  /** O controlador é de um amigo: escreve a entrada dele e devolve `true`. */
  writeRemoteFrame(controller: number, out: InputFrame): boolean;
  /** Os eventos de um tick (vão aos amigos pelo canal confiável). */
  recordEvents(events: readonly SimEvent[]): void;
  /** Depois dos ticks: o snapshot. */
  afterTicks(): void;
  /** Controladores dos amigos que saíram desde a última chamada (um bot assume cada um); devolve quantos. */
  takeLost(out: number[]): number;
  /**
   * M5 (fase 5a/5b): quem ficou ausente (60 s sem entrada: um bot assume), voltou do AFK ou caiu e voltou desde a
   * última chamada. Cada item é `controlador * 4 + ONLINE_CONTROL.*`; devolve quantos.
   */
  takeControl(out: number[]): number;
  /** M5 (fase 5a): o host foi para segundo plano (`true`) ou voltou: os amigos ficam sabendo na hora. */
  setAway(away: boolean): void;
  /** M5 (fase 7a): os números da rede (vivos: o mesmo objeto, lido quando quiser). */
  readonly stats: OnlineNetStats;
  dispose(): void;
}

/** O lado do cliente: a sim dele só mostra o estado do host (e prediz o próprio boneco). */
export interface OnlineClientLink {
  update(frameSeconds: number): number;
  readonly alpha: number;
  /** M5 (fase 5a): há quantos segundos o host está ausente (0 = presente). */
  readonly hostAbsentS: number;
  /** M5 (fase 5a): a ausência veio do aviso do host (sem ele, só silêncio: pode ser a minha conexão). */
  readonly hostAwayNotified: boolean;
  /** M5 (fase 7a): os números da rede (vivos: o mesmo objeto, lido quando quiser). */
  readonly stats: OnlineNetStats;
  dispose(): void;
}

/**
 * M5 (fase 5a): num PvP, o host ausente por tanto tempo encerra a partida (tecnico.md §13.4): os amigos mostram o
 * resultado do último snapshot, e o host que volta depois disso encerra a dele com o placar daquela hora.
 */
export const HOST_AWAY_END_S = 10;

/** M5 (fase 5a/5b): o que mudou no controle de um amigo (o `takeControl` do host; `controlador * 4 + isto`). */
export const ONLINE_CONTROL = {
  /** 60 s sem entrada: um bot assume. */
  away: 0,
  /** Voltou do AFK: o boneco é dele de novo. */
  back: 1,
  /** Caiu e voltou pelo mesmo aparelho: volta a ser da rede, e o boneco é dele de novo. */
  rejoined: 2,
} as const;

/** A partida segue esperando o host ausente (coop) ou acaba depois de `HOST_AWAY_END_S` (PvP)? */
export function waitsForHost(mode: string): boolean {
  return mode === 'zombies';
}

/** Uma partida online começada (o lobby já decidiu quem é quem). */
export interface OnlineSession {
  readonly role: 'host' | 'client';
  /** Humanos na partida (este aparelho e os amigos). */
  readonly humans: number;
  /** O controlador da sim deste aparelho. */
  readonly localController: number;
  /** Os controladores dos amigos (no host, as entradas deles vêm da rede). */
  readonly remoteControllers: readonly number[];
  /** M5 (fase 4c): o nome de cada humano na sala, pelo controlador (o placar, o kill feed e o resultado usam). */
  readonly names: readonly (string | undefined)[];
  /**
   * M5 (fase 6b): o pool de zumbis da sim do host (o menor teto da sala); a cena do amigo cria a dela com o mesmo número.
   * Ausente = o teto do aparelho.
   */
  readonly zombiePool?: number;
  /** A sala acabou (o host saiu, fui expulso, a conexão caiu): a cena volta ao menu. */
  readonly closed: boolean;
  attachHost(sim: Sim): OnlineHostLink;
  attachClient(
    sim: Sim,
    writeLocalFrame: (out: InputFrame, seq: number) => void,
    onEvents: (events: readonly SimEvent[], sim: Sim) => void,
  ): OnlineClientLink;
}

/**
 * Os jogadores da sala na receita do host: cada um no time que escolheu (0 ou 1; -1 = tanto faz, vai para o lado com
 * menos gente), no lugar de bots do mesmo time, na ordem dos controladores da sim (o time 0 primeiro). `teams` está na
 * ordem dos jogadores (o host primeiro); devolve o controlador de cada um, na mesma ordem.
 */
export function onlineRecipe(recipe: MatchRecipe, teams: readonly number[]): SeatedRecipe {
  const count = [0, 0];
  for (const t of teams) if (t === 0 || t === 1) count[t]!++;
  const sides: (0 | 1)[] = teams.map((t) => {
    if (t === 0 || t === 1) return t;
    const side: 0 | 1 = count[1]! < count[0]! ? 1 : 0;
    count[side]!++;
    return side;
  });
  return placeHumans(recipe, sides);
}

// ---------------------------------------------------------------------------------------------------------------
// M5 (fase 4c): a sala, vista pelas telas do Online. A casca web implementa com o `net` (o Trystero, o lobby e o
// repartidor); o `game` só conhece estes tipos. Nada aqui existe no Switch (#1).
// ---------------------------------------------------------------------------------------------------------------

/** Por que a sala acabou (ou nem abriu). */
export type OnlineRoomEnd =
  'full' | 'locked' | 'update-self' | 'update-friend' | 'mismatch' | 'kicked' | 'host-left' | 'not-found' | 'network';

/** O que cada um escolhe na sala. `team` -1 = tanto faz (o host distribui). */
export interface OnlineRoomChoice {
  readonly name: string;
  readonly team: number;
  /** Está na tela da sala (falso enquanto vê o resultado da partida). */
  readonly ready: boolean;
  /** M5 (fase 6b): o aparelho é um celular (a sala usa o menor teto entre os participantes). */
  readonly mobile?: boolean;
}

export interface OnlineRoomMember extends OnlineRoomChoice {
  /** 0 = o host; 1..3 = os amigos. */
  readonly slot: number;
}

/** O estado da sala, igual para todos (o host manda). */
export interface OnlineRoomView {
  readonly code: string;
  readonly locked: boolean;
  /** O resumo da partida que o host escolheu. */
  readonly summary: string;
  /** A partida escolhida tem times (no FFA e no Bobo Zombies, a escolha do time não vale). */
  readonly teams: boolean;
  readonly playing: boolean;
  readonly members: readonly OnlineRoomMember[];
}

/** Uma partida que o host começou: a receita (o cliente valida antes de entrar), a semente e a sessão. */
export interface OnlineMatchStart {
  readonly recipe: unknown;
  readonly seed: number;
  readonly session: OnlineSession;
}

/** M5 (fase 5b): `reconnecting` = a conexão com o host caiu e o amigo tenta voltar (20 s), no mesmo código. */
export type OnlineRoomStatus = 'connecting' | 'reconnecting' | 'lobby' | 'playing' | 'ended';

export interface OnlineRoom {
  readonly role: 'host' | 'client';
  readonly code: string;
  /**
   * `connecting` (o cliente procurando o host), `reconnecting` (voltando depois de a conexão cair), `lobby`, `playing`
   * (a partida começou) ou `ended` (veja `end`).
   */
  readonly status: OnlineRoomStatus;
  readonly end: OnlineRoomEnd | null;
  /** `null` até o cliente entrar. */
  readonly view: OnlineRoomView | null;
  /** O lugar deste aparelho na sala (0 no host; -1 até o cliente entrar). */
  readonly mySlot: number;
  /** A última partida começada (cada começo é um objeto novo: o `game` lembra qual já abriu). */
  readonly match: OnlineMatchStart | null;
  /** 1x por frame, em qualquer tela: a conexão e o lobby andam também durante a partida. */
  update(): void;
  setChoice(choice: OnlineRoomChoice): void;
  /** Host: o resumo da partida que os amigos veem e se ela tem times. */
  setSummary(text: string, teams: boolean): void;
  setLocked(on: boolean): void;
  kick(slot: number): void;
  /**
   * Host: começa com a receita já com os amigos nos times (`controllers` na ordem de `view.members`). `zombies` (M5
   * fase 6b): o pool de zumbis da sim do host, que vai aos amigos.
   */
  start(recipe: MatchRecipe, seed: number, controllers: readonly number[], zombies: number): OnlineMatchStart;
  /** Host: a partida acabou e a sala volta ao lobby. */
  reopen(): void;
  /** Copia o link da sala (`#sala=XXXXX`); `false` se a área de transferência recusou. */
  copyLink(): Promise<boolean>;
  /** Sai da sala (o host a fecha para todos) e solta a conexão. */
  leave(): void;
  /**
   * M5 (fase 5c), host: alguém foi recusado pela versão desde a última chamada (`friend` = o amigo está desatualizado;
   * `host` = o host é que precisa atualizar); `null` = ninguém.
   */
  takeVersionNotice(): 'friend' | 'host' | null;
}

export interface OnlineRooms {
  /** `snapshotHz` (M5 fase 6b): o ritmo dos snapshots do host (20 Hz no celular; o welcome leva aos amigos). */
  create(choice: OnlineRoomChoice, snapshotHz: number): OnlineRoom;
  /**
   * `deviceId` (M5 fase 5b): o id do aparelho, no perfil do Online. Com ele o host devolve o boneco a quem caiu e volta,
   * e barra quem ele tirou.
   */
  join(code: string, choice: OnlineRoomChoice, deviceId: string): OnlineRoom;
  /** O alfabeto e o tamanho do código (o teclado do jogo filtra por ele). */
  readonly codeAlphabet: string;
  readonly codeLength: number;
  /** O código de um link colado (`…#sala=XXXXX`), ou `null`. */
  codeFromLink(text: string): string | null;
  /**
   * M5 (fase 5b): um id de aparelho novo (16 dígitos hexadecimais) com o sorteio forte da plataforma: dois amigos com o
   * mesmo id seriam um só para o host (barrar um barraria os dois).
   */
  newDeviceId(): string;
}
