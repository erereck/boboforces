import { PROTOCOL_VERSION } from './protocol.ts';

/**
 * A configuração da rede (tecnico.md §13.2): `apps/web/public/net.json`, publicado junto com o jogo, deixa trocar os
 * relays e o STUN/TURN sem lançar versão nova. A cópia embutida (`DEFAULT_NET_CONFIG`) é IGUAL ao arquivo (o teste
 * confere) e vale quando o arquivo não vem.
 */
export interface NetIceServer {
  readonly urls: string | readonly string[];
  readonly username?: string;
  readonly credential?: string;
}

export interface NetConfig {
  readonly version: 1;
  /** O protocolo que está no ar (o handshake recusa versões diferentes; isto só explica a recusa). */
  readonly protocolVersion: number;
  /** Relays Nostr fixos. */
  readonly relays: readonly string[];
  /** STUN e, quando decidido, TURN (O3 do PLANO_M5: só STUN até a fase 7). */
  readonly iceServers: readonly NetIceServer[];
}

/**
 * Os relays que o FutBobo mediu em 01/11/2026: 4 rodadas de ida e volta de um evento efêmero no formato do Trystero e
 * uma rajada de 12 eventos, sem AUTH, operadores e hospedagens diferentes (`relay.layer.systems` ficou de fora: bane o
 * IP depois de ~7 eventos, e num CGNAT o IP é de muita gente).
 */
export const DEFAULT_NET_CONFIG: NetConfig = {
  version: 1,
  protocolVersion: PROTOCOL_VERSION,
  relays: [
    'wss://nos.lol',
    'wss://relay.nostr.dev.br',
    'wss://nostr.red5d.dev',
    'wss://nostr.rblb.it',
    'wss://relay.agentry.com',
    'wss://relay.piazza.today',
    'wss://0x-nostr-relay.fly.dev',
    'wss://relay.ditto.pub',
    'wss://relay.grigic.org',
    'wss://nostr-pub.wellorder.net',
    'wss://relay.primal.net',
  ],
  iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }],
};

const isString = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 200;
const isIceUrl = (u: unknown): u is string => isString(u) && /^(stun|turns?):/.test(u);

function parseIce(v: unknown): NetIceServer | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  const urls = o['urls'];
  let parsed: string | readonly string[];
  if (isIceUrl(urls)) parsed = urls;
  else if (Array.isArray(urls) && urls.length > 0 && urls.length <= 8 && urls.every(isIceUrl)) parsed = urls;
  else return null;
  const username = o['username'];
  const credential = o['credential'];
  return {
    urls: parsed,
    ...(isString(username) ? { username } : {}),
    ...(isString(credential) ? { credential } : {}),
  };
}

/**
 * Lê o `net.json` (veio da rede: não é confiável). Campo estragado volta ao padrão; relay só `wss://`; até 32 relays e
 * 8 servidores ICE.
 */
export function parseNetConfig(json: unknown): NetConfig {
  if (typeof json !== 'object' || json === null) return DEFAULT_NET_CONFIG;
  const o = json as Record<string, unknown>;
  if (o['version'] !== 1) return DEFAULT_NET_CONFIG;
  const rawRelays = o['relays'];
  const relays = Array.isArray(rawRelays)
    ? rawRelays.filter((r): r is string => isString(r) && r.startsWith('wss://')).slice(0, 32)
    : [];
  const rawIce = o['iceServers'];
  const ice = Array.isArray(rawIce)
    ? rawIce
        .map(parseIce)
        .filter((s): s is NetIceServer => s !== null)
        .slice(0, 8)
    : [];
  const protocol = o['protocolVersion'];
  return {
    version: 1,
    protocolVersion:
      typeof protocol === 'number' && Number.isInteger(protocol) && protocol > 0
        ? protocol
        : DEFAULT_NET_CONFIG.protocolVersion,
    relays: relays.length > 0 ? relays : DEFAULT_NET_CONFIG.relays,
    iceServers: ice.length > 0 ? ice : DEFAULT_NET_CONFIG.iceServers,
  };
}

/**
 * Quanto o relógio deste aparelho está adiantado (+) ou atrasado (−) em ms, pelo cabeçalho `Date` da resposta do
 * `net.json`: os relays ignoram evento com a hora muito errada, e a estratégia desconta (`setClockOffset`). `null` =
 * sem cabeçalho legível. O cabeçalho tem resolução de 1 s: desvio menor que 1,5 s vira 0.
 */
export function clockOffsetFromDate(dateHeader: string | null, nowMs: number): number | null {
  if (dateHeader === null) return null;
  const server = Date.parse(dateHeader);
  if (!Number.isFinite(server)) return null;
  const ahead = nowMs - server;
  return Math.abs(ahead) < 1500 ? 0 : ahead;
}
