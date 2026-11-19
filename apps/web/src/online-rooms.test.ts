import { builtinBotRef, MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import { createMatchSim, ONLINE_CONTROL, onlineRecipe, type OnlineRoom } from '@boboforces/game';
import { buildSyntheticConstruto } from '@boboforces/sim/testing';
import * as net from '@boboforces/net';
import { describe, expect, it } from 'vitest';
import { createWebRooms, JOIN_TIMEOUT_MS, RECONNECT_TIMEOUT_MS, type RoomTransport } from './online-rooms.ts';

/** Um id de aparelho por amigo (16 dígitos hexadecimais). */
const id = (n: number): string => n.toString(16).padStart(16, '0');

const recipe: MatchRecipe = {
  format: MATCH_RECIPE_FORMAT,
  mode: 'warfare.tdm',
  map: 'construto',
  seed: 1,
  teams: [
    { humans: 'all', bots: [{ ref: builtinBotRef('normal'), count: 3 }] },
    { bots: [{ ref: builtinBotRef('normal'), count: 4 }] },
  ],
};

/**
 * Uma "internet" de mentira: cada `connect(code)` é um aparelho novo no loopback; quem está na mesma sala se vê
 * (o `onPeerJoin` dos dois lados, como o Trystero faz), e sair avisa os outros.
 */
function fakeInternet() {
  const loop = net.createLoopback({ seed: 3, latencyMs: 30, jitterMs: 5, loss: 0.02 });
  const rooms = new Map<string, Set<{ id: number; t: RoomTransport }>>();
  let next = 0;
  let clock = 0;
  const copied: string[] = [];
  /** Avisos de saída do transporte, entregues com atraso (o "saí" do lobby chega antes). */
  const lateLeaves: { at: number; run: () => void }[] = [];
  /** Cada conexão, na ordem em que abriu (o `cut` derruba uma pelo número). */
  const conns: { self: { id: number; t: RoomTransport }; members: Set<{ id: number; t: RoomTransport }> }[] = [];
  const connect = (code: string): RoomTransport => {
    const id = next++;
    const members = rooms.get(code) ?? new Set();
    rooms.set(code, members);
    const self = { id, t: null as unknown as RoomTransport };
    const t: RoomTransport = {
      endpoint: loop.endpoint(id),
      onPeerJoin: null,
      onPeerLeave: null,
      update: () => undefined,
      leave: () => {
        members.delete(self);
        const others = [...members];
        lateLeaves.push({ at: clock + 200, run: () => others.forEach((m) => m.t.onPeerLeave?.(id)) });
      },
    };
    self.t = t;
    conns.push({ self, members });
    // O anúncio chega depois (o chamador ainda vai ligar os ganchos).
    queueMicrotask(() => {
      for (const m of members) {
        m.t.onPeerJoin?.(id);
        t.onPeerJoin?.(m.id);
      }
      members.add(self);
    });
    return t;
  };
  let codeSeed = 0;
  let hexSeed = 0;
  const service = createWebRooms({
    net,
    connect,
    now: () => clock,
    random: () => ((codeSeed = (codeSeed * 7 + 3) % 32) + 0.5) / 32,
    linkFor: (code) => `https://jogo.test/${net.roomLinkHash(code)}`,
    copy: (text) => {
      copied.push(text);
      return Promise.resolve(true);
    },
    log: () => undefined,
    randomHex16: () => (++hexSeed).toString(16).padStart(16, '0'),
  });
  const pump = async (frames: number, rooms: readonly OnlineRoom[]): Promise<void> => {
    for (let i = 0; i < frames; i++) {
      // As promessas (sair e entrar de novo na sala, os anúncios) andam a cada quadro.
      await Promise.resolve();
      await Promise.resolve();
      loop.advance(1000 / 60);
      clock += 1000 / 60;
      for (let k = lateLeaves.length - 1; k >= 0; k--) {
        if (lateLeaves[k]!.at <= clock) lateLeaves.splice(k, 1)[0]!.run();
      }
      for (const r of rooms) r.update();
    }
  };
  /** A conexão `n` cai de vez (sem avisar): os dois lados se perdem na hora, como numa queda do wi-fi. */
  const cut = (n: number): void => {
    const c = conns[n]!;
    if (!c.members.delete(c.self)) return;
    for (const m of c.members) {
      m.t.onPeerLeave?.(c.self.id);
      c.self.t.onPeerLeave?.(m.id);
    }
  };
  /**
   * Só o lado da conexão `n` percebe a queda (o celular trocou de rede): o host continua achando que ela está lá até o
   * aviso atrasado de quando ela sair de vez.
   */
  const cutOneSide = (n: number): void => {
    const c = conns[n]!;
    for (const m of c.members) if (m !== c.self) c.self.t.onPeerLeave?.(m.id);
  };
  return { service, pump, copied, cut, cutOneSide, advanceClock: (ms: number) => (clock += ms) };
}

describe('a sala do Online na web (M5 fase 4c)', () => {
  it('cria, entra, escolhe time, começa, volta ao lobby, e quem sai no meio vira bot', async () => {
    const { service, pump, copied } = fakeInternet();
    const host = service.create({ name: 'Erick', team: 0, ready: true }, 30);
    expect(host.code).toMatch(/^[A-Z2-9]{5}$/);
    expect(service.codeFromLink(`#sala=${host.code.toLowerCase()}`)).toBe(host.code);
    host.setSummary('Times · Construto', true);
    const bia = service.join(host.code, { name: 'Bia', team: 1, ready: true }, id(1));
    const caio = service.join(host.code, { name: 'Caio', team: -1, ready: true }, id(2));
    expect(bia.status).toBe('connecting');
    await pump(30, [host, bia, caio]);
    expect([bia.status, caio.status]).toEqual(['lobby', 'lobby']);
    expect(new Set([bia.mySlot, caio.mySlot])).toEqual(new Set([1, 2]));
    expect(host.view!.members.map((m) => m.name).sort()).toEqual(['Bia', 'Caio', 'Erick']);
    expect(bia.view).toEqual(host.view);
    expect(bia.view!.summary).toBe('Times · Construto');
    // O estado só troca de objeto quando muda (a tela refaz por identidade).
    const before = host.view;
    await pump(5, [host, bia, caio]);
    expect(host.view).toBe(before);
    await bia.copyLink();
    expect(copied).toEqual([`https://jogo.test/#sala=${host.code}`]);

    // O host começa: cada um no time que escolheu; os dois recebem o começo.
    const placed = onlineRecipe(
      recipe,
      host.view!.members.map((m) => m.team),
    );
    const started = host.start(placed.recipe, 77, placed.controllers, 0);
    expect(started.session.role).toBe('host');
    expect(started.session.humans).toBe(3);
    await pump(10, [host, bia, caio]);
    for (const c of [bia, caio]) {
      expect(c.status).toBe('playing');
      expect(c.match!.seed).toBe(77);
      expect(c.match!.recipe).toEqual(placed.recipe);
      expect(c.match!.session.role).toBe('client');
      expect(c.match!.session.closed).toBe(false);
    }
    expect(started.session.names.filter(Boolean).sort()).toEqual(['Bia', 'Caio', 'Erick']);
    // Ninguém entra no meio da partida.
    const late = service.join(host.code, { name: 'Davi', team: -1, ready: true }, id(3));
    await pump(20, [host, bia, caio, late]);
    expect([late.status, late.end]).toEqual(['ended', 'locked']);

    // O Caio sai no meio: o "saí" do lobby chega antes do aviso do transporte, e mesmo assim o lugar dele vai para
    // um bot (o link do host entrega o controlador dele uma vez).
    const { map } = buildSyntheticConstruto();
    const link = started.session.attachHost(
      createMatchSim({ recipe: { ...placed.recipe, seed: 77 }, map, humans: 3, writeHumanFrame: () => undefined }),
    );
    const caioSlot = caio.mySlot;
    const caioController = placed.controllers[host.view!.members.findIndex((m) => m.slot === caioSlot)]!;
    caio.leave();
    await pump(4, [host, bia]);
    expect(host.view!.members.map((m) => m.slot)).not.toContain(caioSlot);
    const lost: number[] = [];
    expect(link.takeLost(lost)).toBe(1);
    expect(lost).toEqual([caioController]);
    await pump(20, [host, bia]);
    expect(link.takeLost(lost)).toBe(0);
    link.dispose();

    // Fim: a sala volta ao lobby; a partida do amigo fecha; dá para começar outra.
    host.reopen();
    await pump(10, [host, bia]);
    expect([host.status, bia.status, bia.view!.playing]).toEqual(['lobby', 'lobby', false]);
    expect(bia.match!.session.closed).toBe(true);
    const again = host.start(placed.recipe, 78, [0, 1], 0);
    await pump(10, [host, bia]);
    expect(bia.match!.seed).toBe(78);
    expect(bia.match).not.toBe(started);
    expect(again.session.humans).toBe(2);

    // O host sai: a sala acaba para o amigo.
    host.leave();
    await pump(20, [bia]);
    expect([bia.status, bia.end]).toEqual(['ended', 'host-left']);
  });

  it('expulso, sala cheia, e ninguém respondendo no prazo', async () => {
    const { service, pump, advanceClock } = fakeInternet();
    const host = service.create({ name: '', team: -1, ready: true }, 30);
    const friends = [1, 2, 3, 4].map((i) =>
      service.join(host.code, { name: `F${i}`, team: -1, ready: true }, id(10 + i)),
    );
    await pump(30, [host, ...friends]);
    expect(friends.filter((f) => f.status === 'lobby')).toHaveLength(3);
    const full = friends.find((f) => f.status === 'ended')!;
    expect(full.end).toBe('full');
    const kicked = friends.find((f) => f.mySlot === 2)!;
    host.kick(2);
    await pump(10, [host, ...friends]);
    expect([kicked.status, kicked.end]).toEqual(['ended', 'kicked']);
    // Código sem ninguém do outro lado.
    const lost = service.join('ZZZZZ', { name: 'X', team: -1, ready: true }, id(99));
    await pump(5, [lost]);
    expect(lost.status).toBe('connecting');
    advanceClock(JOIN_TIMEOUT_MS);
    await pump(1, [lost]);
    expect([lost.status, lost.end]).toEqual(['ended', 'not-found']);
  });
});

describe('a queda e a volta (M5 fase 5b)', () => {
  it('quem cai no meio da partida volta pelo mesmo aparelho, para o boneco dele (que estava com um bot)', async () => {
    const { service, pump, cut } = fakeInternet();
    const host = service.create({ name: 'Erick', team: 0, ready: true }, 30);
    const bia = service.join(host.code, { name: 'Bia', team: 1, ready: true }, id(1));
    await pump(30, [host, bia]);
    host.setLocked(true);
    const placed = onlineRecipe(
      recipe,
      host.view!.members.map((m) => m.team),
    );
    // Revisão da fase 6: com o pool de zumbis do host (o começo que volta para quem caiu leva o mesmo).
    const started = host.start(placed.recipe, 7, placed.controllers, 16);
    await pump(10, [host, bia]);
    const first = bia.match!;
    expect(first.session.zombiePool).toBe(16);
    const { map } = buildSyntheticConstruto();
    const link = started.session.attachHost(
      createMatchSim({ recipe: { ...placed.recipe, seed: 7 }, map, humans: 2, writeHumanFrame: () => undefined }),
    );
    const biaController = placed.controllers[1]!;
    // A conexão da Bia cai (conexão 1): ela tenta voltar; o host passa o boneco dela a um bot.
    const statuses = new Set<string>();
    cut(1);
    for (let i = 0; i < 60; i++) {
      await pump(1, [host, bia]);
      statuses.add(bia.status);
    }
    expect(statuses.has('reconnecting')).toBe(true);
    const lost: number[] = [];
    const control: number[] = [];
    // A volta: a sala trancada e jogando aceita o mesmo aparelho; o começo chega de novo, e o boneco volta a ela.
    expect(bia.status).toBe('playing');
    expect(bia.match).not.toBe(first);
    expect(bia.match!.session.localController).toBe(biaController);
    expect(bia.match!.session.zombiePool).toBe(16);
    expect(host.view!.members.map((m) => m.name).sort()).toEqual(['Bia', 'Erick']);
    expect(link.takeLost(lost)).toBe(1);
    expect(lost).toEqual([biaController]);
    expect(link.takeControl(control)).toBe(1);
    expect(control).toEqual([biaController * 4 + ONLINE_CONTROL.rejoined]);
    link.dispose();
  });

  it('a volta chega antes de o host ver a queda: a conexão antiga sai e a nova pega o boneco', async () => {
    const { service, pump, cutOneSide } = fakeInternet();
    const host = service.create({ name: 'Erick', team: 0, ready: true }, 30);
    const bia = service.join(host.code, { name: 'Bia', team: 1, ready: true }, id(1));
    await pump(30, [host, bia]);
    host.setLocked(true);
    const placed = onlineRecipe(
      recipe,
      host.view!.members.map((m) => m.team),
    );
    const started = host.start(placed.recipe, 7, placed.controllers, 0);
    await pump(10, [host, bia]);
    const first = bia.match!;
    const { map } = buildSyntheticConstruto();
    const link = started.session.attachHost(
      createMatchSim({ recipe: { ...placed.recipe, seed: 7 }, map, humans: 2, writeHumanFrame: () => undefined }),
    );
    const c = placed.controllers[1]!;
    cutOneSide(1);
    const statuses = new Set<string>();
    for (let i = 0; i < 60; i++) {
      await pump(1, [host, bia]);
      statuses.add(bia.status);
    }
    // Não ouviu "trancada": voltou jogando, e o host trocou a conexão (saída antes da volta, no mesmo quadro).
    expect(statuses.has('ended')).toBe(false);
    expect(bia.status).toBe('playing');
    expect(bia.match).not.toBe(first);
    const lost: number[] = [];
    const control: number[] = [];
    expect(link.takeLost(lost)).toBe(1);
    expect(lost).toEqual([c]);
    expect(link.takeControl(control)).toBe(1);
    expect(control).toEqual([c * 4 + ONLINE_CONTROL.rejoined]);
    // O aviso atrasado da conexão antiga não tira a nova.
    await pump(30, [host, bia]);
    expect(host.view!.members.map((m) => m.name).sort()).toEqual(['Bia', 'Erick']);
    expect(bia.status).toBe('playing');
    link.dispose();
  });

  it('quem foi tirado não volta naquela sala; o host que fecha a sala não faz ninguém tentar voltar', async () => {
    const { service, pump } = fakeInternet();
    const host = service.create({ name: 'Erick', team: 0, ready: true }, 30);
    const bia = service.join(host.code, { name: 'Bia', team: 1, ready: true }, id(1));
    const caio = service.join(host.code, { name: 'Caio', team: 0, ready: true }, id(2));
    await pump(30, [host, bia, caio]);
    host.kick(bia.mySlot);
    await pump(10, [host, bia, caio]);
    expect([bia.status, bia.end]).toEqual(['ended', 'kicked']);
    const again = service.join(host.code, { name: 'Bia', team: 1, ready: true }, id(1));
    await pump(30, [host, caio, again]);
    expect([again.status, again.end]).toEqual(['ended', 'kicked']);
    // Outro aparelho entra normalmente.
    const other = service.join(host.code, { name: 'Davi', team: 1, ready: true }, id(3));
    await pump(30, [host, caio, other]);
    expect(other.status).toBe('lobby');
    // O host fecha a sala: acaba na hora para os outros, sem "voltando".
    const seen = new Set<string>();
    host.leave();
    for (let i = 0; i < 20; i++) {
      await pump(1, [caio, other]);
      seen.add(caio.status);
    }
    expect(seen.has('reconnecting')).toBe(false);
    expect([caio.status, caio.end]).toEqual(['ended', 'host-left']);
  });

  it('sem o host do outro lado, voltar desiste em 20 s', async () => {
    const { service, pump, cut, advanceClock } = fakeInternet();
    const host = service.create({ name: 'Erick', team: 0, ready: true }, 30);
    const bia = service.join(host.code, { name: 'Bia', team: 1, ready: true }, id(1));
    await pump(30, [host, bia]);
    // O host some sem fechar (a aba travou de vez): a Bia tenta voltar e desiste.
    cut(0);
    await pump(10, [bia]);
    expect(bia.status).toBe('reconnecting');
    advanceClock(RECONNECT_TIMEOUT_MS);
    await pump(2, [bia]);
    expect([bia.status, bia.end]).toEqual(['ended', 'host-left']);
  });
});

describe('o host no celular (M5 fase 6b)', () => {
  it('o celular vai na escolha e aparece na sala; o pool de zumbis do host chega à sessão do amigo', async () => {
    const { service, pump } = fakeInternet();
    const host = service.create({ name: 'Erick', team: 0, ready: true, mobile: true }, 20);
    const bia = service.join(host.code, { name: 'Bia', team: 1, ready: true, mobile: true }, id(1));
    const caio = service.join(host.code, { name: 'Caio', team: -1, ready: true }, id(2));
    await pump(30, [host, bia, caio]);
    const mobileOf = (name: string) => host.view!.members.find((m) => m.name === name)?.mobile === true;
    expect([mobileOf('Erick'), mobileOf('Bia'), mobileOf('Caio')]).toEqual([true, true, false]);
    expect(bia.view).toEqual(host.view);
    const placed = onlineRecipe(
      recipe,
      host.view!.members.map((m) => m.team),
    );
    const started = host.start(placed.recipe, 9, placed.controllers, 16);
    await pump(10, [host, bia, caio]);
    expect(started.session.zombiePool).toBe(16);
    for (const c of [bia, caio]) expect(c.match!.session.zombiePool).toBe(16);
    host.leave();
  });
});
