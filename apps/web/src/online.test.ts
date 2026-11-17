import * as net from '@boboforces/net';
import { DEFAULT_NET_CONFIG } from '@boboforces/net';
import * as rtc from '@boboforces/net/rtc';
import { afterEach, describe, expect, it } from 'vitest';
import { loadOnline, resetOnlineForTests, type FetchLike } from './online.ts';

const server = Date.UTC(2026, 10, 16, 12, 0, 0);

function respond(body: unknown, date: string | null): FetchLike {
  return () =>
    Promise.resolve({
      ok: true,
      headers: { get: (name: string) => (name.toLowerCase() === 'date' ? date : null) },
      json: () => Promise.resolve(body),
    });
}

describe('carregar o online (M5 fase 3)', () => {
  afterEach(() => resetOnlineForTests());

  it('baixa o chunk e o net.json, acerta o relógio pelo Date e reaproveita na 2ª vez', async () => {
    const custom = { version: 1, protocolVersion: 1, relays: ['wss://um.example'], iceServers: [] };
    const fetchLike = respond(custom, new Date(server).toUTCString());
    const a = await loadOnline(net, rtc, fetchLike, () => server + 25_000);
    expect(a.fromNetwork).toBe(true);
    expect(a.config.relays).toEqual(['wss://um.example']);
    expect(a.config.iceServers).toBe(DEFAULT_NET_CONFIG.iceServers);
    expect(a.clockOffsetMs).toBe(25_000);
    expect(typeof a.rtc.joinNostrRoom).toBe('function');
    expect(await loadOnline(net, rtc, fetchLike)).toBe(a);
  });

  it('sem rede: a cópia embutida', async () => {
    const offline: FetchLike = () => Promise.reject(new Error('sem rede'));
    const a = await loadOnline(net, rtc, offline);
    expect(a.fromNetwork).toBe(false);
    expect(a.config).toBe(DEFAULT_NET_CONFIG);
    expect(a.clockOffsetMs).toBeNull();
  });
});
