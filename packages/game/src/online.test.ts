import { builtinBotRef, MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import { BUTTON, type InputFrame } from '@boboforces/input';
import type { Sim, SimEvent } from '@boboforces/sim';
import { buildSyntheticConstruto } from '@boboforces/sim/testing';
import { describe, expect, it } from 'vitest';
import type { OnlineClientLink, OnlineHostLink, OnlineSession } from './online-api.ts';
import { onlineRecipe } from './online-api.ts';
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
});

/** Um online de mentira que anota o que a cena pediu. */
function fakeOnline(role: 'host' | 'client'): {
  session: OnlineSession;
  calls: string[];
  lost: number[];
  close: () => void;
} {
  const calls: string[] = [];
  const lost: number[] = [];
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
        update: () => {
          write(f, 1);
          calls.push(`client-update:${sim.tick}`);
          return 1;
        },
        alpha: 0.5,
        dispose: () => calls.push('client-dispose'),
      };
      return link;
    },
  };
  return { session, calls, lost, close: () => (closed = true) };
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
