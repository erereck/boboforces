import type { Sim } from './sim.ts';
import type { OwnerCommand } from './systems/owner.ts';

/**
 * M9 (fase 4): o roteiro dos comandos do dono (a base do `replay@1`). Cada entrada diz o tick da sim em que o comando
 * entra na fila (`sim.tick` antes do `step`): ele vale no começo desse passo. Gravar (`OwnerLog`) e tocar
 * (`createOwnerScript`) com a mesma sim, a mesma receita e as mesmas entradas dá o mesmo hash. Objetos simples (dá
 * para guardar em JSON).
 */
export interface OwnerScriptEntry {
  readonly tick: number;
  readonly cmd: OwnerCommand;
}

export interface OwnerScript {
  /**
   * Antes de cada `step`: enfileira os comandos do tick atual (e os atrasados, se o roteiro entrou tarde). Devolve
   * quantos.
   */
  feed(sim: Sim): number;
  /** Todos já foram para a fila. */
  readonly done: boolean;
}

/** Toca um roteiro: as entradas em ordem de tick (no empate, a ordem da lista). */
export function createOwnerScript(entries: readonly OwnerScriptEntry[]): OwnerScript {
  const list = entries
    .map((entry, i) => ({ entry, i }))
    .sort((a, b) => a.entry.tick - b.entry.tick || a.i - b.i)
    .map((x) => x.entry);
  let next = 0;
  return {
    feed(sim): number {
      let n = 0;
      while (next < list.length && list[next]!.tick <= sim.tick) {
        sim.command(list[next]!.cmd);
        next++;
        n++;
      }
      return n;
    },
    get done(): boolean {
      return next >= list.length;
    },
  };
}

/** Teto padrão do `OwnerLog` (comandos numa partida; o resto é descartado e contado). */
export const OWNER_LOG_MAX = 4096;

/**
 * Grava os comandos aceitos com o tick em que valem (para o replay). Com limite (regra 21): cheio, `record` recusa e
 * conta em `dropped`. Quem grava para replay (o `LocalDriver`) confere `full` ANTES de mandar o comando e recusa o
 * comando novo (-1): assim o replay nunca perde um comando que valeu na partida.
 */
export class OwnerLog {
  readonly entries: OwnerScriptEntry[] = [];
  readonly max: number;
  /** Comandos que passaram do teto (não gravados). */
  dropped = 0;

  constructor(max: number = OWNER_LOG_MAX) {
    this.max = max;
  }

  get full(): boolean {
    return this.entries.length >= this.max;
  }

  /** Grava; `false` = cheio (não gravou). */
  record(tick: number, cmd: OwnerCommand): boolean {
    if (this.full) {
      this.dropped++;
      return false;
    }
    this.entries.push({ tick, cmd: { ...cmd } });
    return true;
  }

  clear(): void {
    this.entries.length = 0;
    this.dropped = 0;
  }
}
