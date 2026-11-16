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
  dispose(): void;
}

/** O lado do cliente: a sim dele só mostra o estado do host (e prediz o próprio boneco). */
export interface OnlineClientLink {
  update(frameSeconds: number): number;
  readonly alpha: number;
  dispose(): void;
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
