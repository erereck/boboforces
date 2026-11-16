import type { NetConfig } from '@boboforces/net';

/**
 * O online na web (M5, tecnico.md §13.1): o pacote `net` (protocolo, Trystero, WebRTC) é um chunk próprio, baixado só
 * quando o jogador abre "Online" (fora do orçamento do menu; o `import()` dinâmico só existe na casca, regra 15). Junto,
 * a configuração da rede (`net.json`, sempre da rede, com prazo) e o acerto do relógio pelo cabeçalho `Date` dela: os
 * relays ignoram evento de quem está com a hora muito errada. Sem o arquivo, vale a cópia embutida.
 */

export type NetModule = typeof import('@boboforces/net');

export interface OnlineLoad {
  readonly net: NetModule;
  readonly config: NetConfig;
  /** Quanto o relógio do aparelho está adiantado (+) ou atrasado (−), em ms; `null` = sem cabeçalho legível. */
  readonly clockOffsetMs: number | null;
  /** O `net.json` veio da rede (senão, a cópia embutida). */
  readonly fromNetwork: boolean;
}

/** Prazo do `net.json` (o mesmo do FutBobo): sem resposta, segue com a cópia embutida. */
export const NET_CONFIG_TIMEOUT_MS = 2500;

export type FetchLike = (
  url: string,
  init: { cache: 'no-store'; signal: AbortSignal },
) => Promise<{
  readonly ok: boolean;
  readonly headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}>;

let loading: Promise<OnlineLoad> | null = null;

/** Baixa o chunk e a configuração (uma vez por página; as chamadas seguintes reaproveitam). */
export function loadOnline(fetchLike: FetchLike = fetch, now: () => number = Date.now): Promise<OnlineLoad> {
  loading ??= (async (): Promise<OnlineLoad> => {
    const net = await import('@boboforces/net');
    let config = net.DEFAULT_NET_CONFIG;
    let clockOffsetMs: number | null = null;
    let fromNetwork = false;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), NET_CONFIG_TIMEOUT_MS);
    try {
      const response = await fetchLike('./net.json', { cache: 'no-store', signal: abort.signal });
      if (response.ok) {
        config = net.parseNetConfig(await response.json());
        fromNetwork = true;
        clockOffsetMs = net.clockOffsetFromDate(response.headers.get('date'), now());
        if (clockOffsetMs !== null) net.setClockOffset(clockOffsetMs);
      }
    } catch {
      // Sem rede ou sem o arquivo: a cópia embutida (a sala ainda tenta pelos relays dela).
    } finally {
      clearTimeout(timer);
    }
    return { net, config, clockOffsetMs, fromNetwork };
  })();
  return loading;
}

/** Só testes: esquece o carregamento (o próximo `loadOnline` baixa de novo). */
export function resetOnlineForTests(): void {
  loading = null;
}
