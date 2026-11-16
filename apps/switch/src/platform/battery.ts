import type { NxBattery } from './nx.ts';

/**
 * M4 (fase 3): a bateria para a pausa e o aviso de 20% (P5). O `navigator.getBattery()` do nx.js é assíncrono e o jogo
 * lê no frame, então a casca guarda a última leitura e pede outra a cada 30 s. No console ele devolve o nível (logs do
 * M1: `nivel=88 carregando=1`); no Eden falha (não há o serviço `psm`) e a casca para de perguntar.
 */
export const BATTERY_REFRESH_MS = 30_000;

export interface BatteryLevel {
  /** De 0 a 1. */
  readonly level: number;
  readonly charging: boolean;
}

export interface BatteryReader {
  /** A última leitura (`null` antes da primeira ou sem bateria); pede outra se a guardada tem mais de 30 s. */
  read(): BatteryLevel | null;
}

export function createBatteryReader(
  getBattery: (() => Promise<NxBattery>) | undefined,
  now: () => number,
  log?: (line: string) => void,
): BatteryReader {
  let last: BatteryLevel | null = null;
  let askedAt = Number.NEGATIVE_INFINITY;
  let pending = false;
  let failed = false;
  const ask = (): void => {
    if (getBattery === undefined || pending || failed) return;
    pending = true;
    askedAt = now();
    let request: Promise<NxBattery>;
    try {
      request = getBattery();
    } catch (error) {
      request = Promise.reject(error);
    }
    const fail = (error: unknown): void => {
      pending = false;
      failed = true;
      log?.(`bateria: sem leitura (${error instanceof Error ? error.message : String(error)}); a pausa fica sem ela`);
    };
    request.then((b) => {
      // No Eden a promessa resolve, mas ler `level` lança (o serviço `psm` não existe): conta como falha, e nada
      // escapa como promessa rejeitada sem tratamento (que derrubava o boot).
      try {
        const level = Number(b.level);
        const charging = b.charging === true;
        pending = false;
        last = Number.isFinite(level) && level >= 0 && level <= 1 ? { level, charging } : null;
      } catch (error) {
        fail(error);
      }
    }, fail);
  };
  ask();
  return {
    read() {
      if (now() - askedAt >= BATTERY_REFRESH_MS) ask();
      return last;
    },
  };
}
