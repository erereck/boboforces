import { builtinBotRef, MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import { BUTTON, type InputFrame } from '@boboforces/input';
import { expandRecipe, type Sim, type SimEvent } from '@boboforces/sim';
import { buildSyntheticConstruto } from '@boboforces/sim/testing';
import { describe, expect, it } from 'vitest';
import type { OnlineClientLink, OnlineHostLink, OnlineSession } from './online-api.ts';
import { ONLINE_CONTROL, onlineRecipe } from './online-api.ts';
import { recipeTeamCount, stepTeam } from './online-screens.ts';
import { sceneRecipe } from './scene/match.ts';
import { createSceneDriver } from './scene/scene-driver.ts';
import { PLATFORM_PROFILES } from '@boboforces/format';
import type { SceneRequest } from './scene-api.ts';

const tdm: MatchRecipe = {
  format: MATCH_RECIPE_FORMAT,
  mode: 'warfare.tdm',
  map: 'test',
  seed: 5,
  teams: [
    { humans: 'all', bots: [{ ref: builtinBotRef('normal'), count: 5 }] },
    { bots: [{ ref: builtinBotRef('normal'), count: 6 }] },
  ],
};

describe('a receita da sala (M5 fase 4b)', () => {
  it('cada um no time que escolheu, no lugar de bots; "tanto faz" vai para o lado com menos gente', () => {
    const r = onlineRecipe(tdm, [0, 1, -1, -1]);
    // Times 0 e 1 com 2 humanos cada, 6 bobos por time como antes; o time 0 tem os primeiros controladores.
    expect(r.recipe.teams.map((t) => [t.humans, t.bots.reduce((n, b) => n + b.count, 0)])).toEqual([
      [2, 4],
      [2, 4],
    ]);
    expect(r.controllers).toEqual([0, 2, 1, 3]);
    // O host pode jogar no time 1.
    expect(onlineRecipe(tdm, [1, 0]).controllers).toEqual([1, 0]);
    // FFA: todo mundo no mesmo "time".
    const ffa = onlineRecipe({ ...tdm, mode: 'warfare.ffa', teams: [{ humans: 'all', bots: [] }] }, [1, 0, -1]);
    expect(ffa.controllers).toEqual([0, 1, 2]);
    expect(ffa.recipe.teams[0]!.humans).toBe(3);
  });

  it('M9 (fase 3): a escolha do time na sala anda pelos times da partida (o Sandbox vai ao Roxo)', () => {
    const walk = (count: number, delta: number): number[] => {
      const seen: number[] = [];
      let team = -1;
      for (let i = 0; i < count + 1; i++) seen.push((team = stepTeam(team, delta, count)));
      return seen;
    };
    expect(walk(2, 1)).toEqual([0, 1, -1]);
    expect(walk(4, 1)).toEqual([0, 1, 2, 3, -1]);
    expect(walk(4, -1)).toEqual([3, 2, 1, 0, -1]);
    // Sem o número, os 2 de sempre.
    expect(stepTeam(1, 1)).toBe(-1);
    const sandbox: MatchRecipe = { ...tdm, mode: 'sandbox', teams: [...tdm.teams, { bots: [] }, { bots: [] }] };
    expect([recipeTeamCount(tdm), recipeTeamCount(sandbox), recipeTeamCount({ ...tdm, mode: 'warfare.ffa' })]).toEqual([
      2, 4, 0,
    ]);
  });
});

/** Um online de mentira que anota o que a cena pediu. */
function fakeOnline(role: 'host' | 'client'): {
  session: OnlineSession;
  calls: string[];
  lost: number[];
  control: number[];
  absent: { s: number };
  close: () => void;
} {
  const calls: string[] = [];
  const lost: number[] = [];
  const control: number[] = [];
  const absent = { s: 0 };
  let closed = false;
  const hostLink: OnlineHostLink = {
    receive: () => calls.push('receive'),
    writeRemoteFrame: (c, out) => {
      calls.push(`remote:${c}`);
      out.buttons = BUTTON.jump;
      return true;
    },
    recordEvents: (events) => {
      if (events.length > 0) calls.push('events');
    },
    afterTicks: () => calls.push('after'),
    takeLost: (out) => {
      out.length = 0;
      out.push(...lost.splice(0));
      return out.length;
    },
    takeControl: (out) => {
      out.length = 0;
      out.push(...control.splice(0));
      return out.length;
    },
    setAway: (on) => calls.push(`away:${on}`),
    stats: { sentBytes: 0, receivedBytes: 0, peers: 1, snapshots: 0, lagTicks: -1, reconciles: 0, mispredicts: 0 },
    dispose: () => calls.push('dispose'),
  };
  const session: OnlineSession = {
    role,
    humans: 2,
    localController: role === 'host' ? 0 : 1,
    remoteControllers: role === 'host' ? [1] : [0],
    names: ['Erick', 'Bia'],
    get closed() {
      return closed;
    },
    attachHost: () => hostLink,
    attachClient: (sim: Sim, write: (out: InputFrame, seq: number) => void) => {
      const f: InputFrame = { seq: 0, buttons: 0, moveX: 0, moveY: 0, yaw: 0, pitch: 0, weapon: 0, primary: 0 };
      const link: OnlineClientLink = {
        stats: { sentBytes: 0, receivedBytes: 0, peers: 1, snapshots: 0, lagTicks: -1, reconciles: 0, mispredicts: 0 },
        update: () => {
          write(f, 1);
          calls.push(`client-update:${sim.tick}`);
          return 1;
        },
        alpha: 0.5,
        get hostAbsentS() {
          return absent.s;
        },
        hostAwayNotified: false,
        dispose: () => calls.push('client-dispose'),
      };
      return link;
    },
  };
  return { session, calls, lost, control, absent, close: () => (closed = true) };
}

describe('a receita da cena online (M5 fase 4b)', () => {
  it('o cliente num celular usa a receita do host inteira (não corta bots) e joga com o controlador dele', () => {
    const big = onlineRecipe(
      {
        ...tdm,
        map: 'construto',
        teams: [
          { humans: 'all', bots: [{ ref: builtinBotRef('normal'), count: 10 }] },
          { bots: [{ ref: builtinBotRef('normal'), count: 11 }] },
        ],
      },
      [0, 1, 0, 1],
    );
    const fake = fakeOnline('client');
    const request: SceneRequest = {
      kind: 'play',
      bench: null,
      benchWarnings: [],
      seed: 99,
      convention: undefined as unknown as SceneRequest['convention'],
      device: null,
      gamepad: 0,
      recipe: big.recipe,
      online: { ...fake.session, humans: 4, localController: 2 },
    };
    const r = sceneRecipe(request, PLATFORM_PROFILES.mobile);
    const bots = r.recipe.teams.reduce((n, t) => n + t.bots.reduce((k, b) => k + b.count, 0), 0);
    expect(bots).toBe(18);
    expect(PLATFORM_PROFILES.mobile.maxBots).toBeLessThan(18);
    expect([r.humans, r.seatControllers, r.recipe.seed]).toEqual([4, [2], 99]);
  });

  it('M9 (fase 3): o Sandbox de 4 times passa pela cena: o sofá (P1 no Verde) e a sala (um em cada time)', () => {
    const normal = [{ ref: builtinBotRef('normal'), count: 3 }];
    const sandbox: MatchRecipe = {
      ...tdm,
      mode: 'sandbox',
      map: 'construto',
      sandbox: { objective: 'elimination' },
      teams: [
        { name: 'Laranjada', bots: normal },
        { bots: normal },
        { humans: 'all', hp: 200, bots: normal },
        { weapons: ['sniper'], bots: normal },
      ],
    };
    const base = {
      kind: 'play',
      bench: null,
      benchWarnings: [],
      seed: 5,
      convention: undefined as unknown as SceneRequest['convention'],
      device: null,
      gamepad: 0,
      recipe: sandbox,
    } as const;
    const pad = (index: number, side: number) => ({ device: { kind: 'gamepad' as const, index }, side });
    // O sofá: P1 no Verde (o time dos humanos), P2 um time depois (o Roxo), P3 dois (o Laranja).
    const couch = sceneRecipe({ ...base, seats: [pad(0, 0), pad(1, 1), pad(2, 2)] }, PLATFORM_PROFILES.pc);
    expect(couch.recipe.teams.map((tm) => tm.humans)).toEqual([1, 0, 1, 1]);
    expect(couch.recipe.teams[2]!.hp).toBe(200);
    expect(couch.recipe.sandbox).toEqual({ objective: 'elimination' });
    expect(couch.humans).toBe(3);
    const slots = expandRecipe(couch.recipe, couch.humans);
    expect(couch.seatControllers.map((c) => slots.find((s) => s.controller === c)!.team)).toEqual([2, 3, 0]);
    // A sala: o host no Roxo e os amigos nos outros (a receita do host vai como está).
    const fake = fakeOnline('host');
    const room = onlineRecipe(sandbox, [3, 0, 1, 2]);
    const online = sceneRecipe(
      { ...base, recipe: room.recipe, online: { ...fake.session, humans: 4, localController: room.controllers[0]! } },
      PLATFORM_PROFILES.pc,
    );
    expect(online.recipe.teams.map((tm) => tm.humans)).toEqual([1, 1, 1, 1]);
    expect(expandRecipe(online.recipe, 4).find((s) => s.controller === online.seatControllers[0])!.team).toBe(3);
  });
});

describe('o driver da cena online (M5 fase 4b)', () => {
  // Sem navegação: o `LocalDriver` usa a do jogo, e a de teste do mapa sintético é outra (os bots andam reto).
  const { map } = buildSyntheticConstruto();
  const recipe = onlineRecipe(tdm, [0, 1]).recipe;

  it('host: o amigo lê da rede, eventos e snapshot vão para o link, e quem sai vira bot', () => {
    const fake = fakeOnline('host');
    const local: number[] = [];
    const events: SimEvent['type'][] = [];
    const d = createSceneDriver(
      {
        recipe,
        map,
        humans: 2,
        writeHumanFrame: (slot) => local.push(slot),
        onEvents: (evs) => events.push(...evs.map((e) => e.type)),
      },
      fake.session,
    );
    expect(d.director).not.toBeNull();
    expect(d.online).toBe(true);
    for (let i = 0; i < 30; i++) d.update(1 / 60);
    expect(local.every((s) => s === 0)).toBe(true);
    expect(fake.calls.filter((c) => c === 'remote:1').length).toBeGreaterThanOrEqual(29);
    expect(fake.calls.filter((c) => c === 'after').length).toBeGreaterThanOrEqual(29);
    expect(fake.calls).toContain('events');
    expect(events).toContain('spawn');
    // O amigo saiu: a entrada dele não vem mais da rede (um bot assume).
    fake.lost.push(1);
    const before = fake.calls.length;
    for (let i = 0; i < 10; i++) d.update(1 / 60);
    expect(fake.calls.slice(before).filter((c) => c === 'remote:1')).toEqual([]);
    d.dispose();
    expect(fake.calls).toContain('dispose');
  });

  it('cliente: sem diretor; a entrada local sai com o controlador dele; a sala fechada para a partida', () => {
    const fake = fakeOnline('client');
    const local: number[] = [];
    const d = createSceneDriver({ recipe, map, humans: 2, writeHumanFrame: (slot) => local.push(slot) }, fake.session);
    expect(d.director).toBeNull();
    expect(d.alpha).toBe(0.5);
    d.update(1 / 60);
    expect(local).toEqual([1]);
    expect(d.sim.view().count).toBeGreaterThan(0);
    fake.close();
    expect(d.closed).toBe(true);
    expect(d.update(1 / 60)).toBe(0);
    d.dispose();
    expect(fake.calls).toContain('client-dispose');
  });
});

describe('as ausências na cena (M5 fase 5a)', () => {
  const { map } = buildSyntheticConstruto();
  const recipe = onlineRecipe(tdm, [0, 1]).recipe;

  it('AFK: o bot assume a vaga do amigo e a devolve quando ele volta', () => {
    const fake = fakeOnline('host');
    const d = createSceneDriver({ recipe, map, humans: 2, writeHumanFrame: () => undefined }, fake.session);
    for (let i = 0; i < 10; i++) d.update(1 / 60);
    const remoteCalls = (): number => fake.calls.filter((c) => c === 'remote:1').length;
    // Foi embora (AFK): a entrada dele não é mais lida (o bot joga).
    fake.control.push(1 * 4 + ONLINE_CONTROL.away);
    d.update(1 / 60);
    const away = remoteCalls();
    for (let i = 0; i < 10; i++) d.update(1 / 60);
    expect(remoteCalls()).toBe(away);
    // Voltou: a entrada dele volta a ser lida.
    fake.control.push(1 * 4 + ONLINE_CONTROL.back);
    for (let i = 0; i < 10; i++) d.update(1 / 60);
    expect(remoteCalls()).toBeGreaterThan(away + 5);
    d.dispose();
  });

  it('o host que some avisa e volta; num PvP, depois de 10 s a partida acaba; no coop e antes disso, não', () => {
    const run = (mode: string, goneMs: number): { calls: string[]; phase: string } => {
      const fake = fakeOnline('host');
      const r = mode === 'zombies' ? { ...recipe, mode } : recipe;
      const d = createSceneDriver({ recipe: r, map, humans: 2, writeHumanFrame: () => undefined }, fake.session);
      for (let i = 0; i < 5; i++) d.update(1 / 60);
      d.setHidden(true, 1000);
      d.setHidden(true, 1500);
      d.setHidden(false, 1000 + goneMs);
      d.update(1 / 60);
      const phase = d.sim.view().match.phase;
      d.dispose();
      return { calls: fake.calls.filter((c) => c.startsWith('away:')), phase };
    };
    const long = run('warfare.tdm', 10_500);
    expect(long.calls).toEqual(['away:true', 'away:false']);
    expect(long.phase).toBe('ended');
    expect(run('warfare.tdm', 9_000).phase).not.toBe('ended');
    expect(run('zombies', 60_000).phase).not.toBe('ended');
  });

  it('o cliente mostra há quanto tempo o host está ausente; solo e sofá, nunca', () => {
    const fake = fakeOnline('client');
    const d = createSceneDriver({ recipe, map, humans: 2, writeHumanFrame: () => undefined }, fake.session);
    expect(d.hostAbsentS).toBe(0);
    fake.absent.s = 4.5;
    expect(d.hostAbsentS).toBe(4.5);
    d.setHidden(true, 0);
    d.dispose();
    const local = createSceneDriver({ recipe, map, humans: 1, writeHumanFrame: () => undefined });
    expect(local.hostAbsentS).toBe(0);
    local.setHidden(true, 0);
    local.dispose();
  });
});
