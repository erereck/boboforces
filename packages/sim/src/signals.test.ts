import { MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import { BUTTON, ORDER, withOrder } from '@boboforces/input';
import { pitchToI16 } from '@boboforces/shared';
import { describe, expect, it } from 'vitest';
import type { SignalEvent, SimEvent } from './events.ts';
import { createInputFrames } from './loop.ts';
import { createSim } from './sim.ts';
import { PING_RANGE_M, SIGNAL_COOLDOWN_S, SIGNAL_KIND } from './systems/signals.ts';
import { buildSyntheticConstruto } from './testing/index.ts';

const recipe: MatchRecipe = {
  format: MATCH_RECIPE_FORMAT,
  mode: 'warfare.tdm',
  map: 'test',
  seed: 3,
  teams: [
    { humans: 1, bots: [] },
    { humans: 0, bots: [] },
  ],
};

describe('ping e emotes (M5 fase 5d)', () => {
  it('o ping bate onde a mira olha (o chão, olhando para baixo); segurar não repete; o emote passa de 1 a 4', () => {
    const { map } = buildSyntheticConstruto();
    const sim = createSim({ recipe, map, humans: 1, countdownS: 0 });
    const frames = createInputFrames();
    const f = frames[0]!;
    const out: SimEvent[] = [];
    const signals = (): SignalEvent[] => {
      out.length = 0;
      sim.drainEvents(out);
      return out.filter((e): e is SignalEvent => e.type === 'signal').map((e) => ({ ...e }));
    };
    const step = (buttons: number, n = 1): SignalEvent[] => {
      const got: SignalEvent[] = [];
      for (let i = 0; i < n; i++) {
        f.buttons = buttons;
        sim.step(frames);
        got.push(...signals());
      }
      return got;
    };
    step(0, 5);
    const me = sim.controllerEntity(0);
    const e = me & 0xffff;
    const v = sim.view();
    const feetY = v.position[e * 3 + 1]!;
    // Olhando quase para baixo: o ping cai no chão, perto dos pés.
    f.pitch = pitchToI16(-1.2);
    const [ping] = step(BUTTON.ping);
    expect(ping).toMatchObject({ entity: me, kind: SIGNAL_KIND.ping });
    expect(Math.abs(ping!.y - feetY)).toBeLessThan(0.6);
    expect(Math.hypot(ping!.x - v.position[e * 3]!, ping!.z - v.position[e * 3 + 2]!)).toBeLessThan(3);
    // Segurando o botão: nada de novo. Soltar e apertar antes do intervalo: nada; depois dele, sai.
    expect(step(BUTTON.ping, 10)).toEqual([]);
    step(0);
    expect(step(BUTTON.ping)).toEqual([]);
    step(0, Math.round(SIGNAL_COOLDOWN_S * sim.hz));
    expect(step(BUTTON.ping).map((s) => s.kind)).toEqual([SIGNAL_KIND.ping]);
    // Olhando para o céu, sem nada no caminho: o ping fica no fim do alcance.
    f.pitch = pitchToI16(1.5);
    step(0, Math.round(SIGNAL_COOLDOWN_S * sim.hz) + 1);
    const [sky] = step(BUTTON.ping);
    expect(sky!.y - feetY).toBeGreaterThan(PING_RANGE_M * 0.9);
    // O emote: cada aperto o próximo (1, 2, 3, 4 e de volta ao 1), acima da cabeça.
    const kinds: number[] = [];
    for (let i = 0; i < 5; i++) {
      step(0, Math.round(SIGNAL_COOLDOWN_S * sim.hz) + 1);
      const [emote] = step(BUTTON.emote);
      kinds.push(emote!.kind);
      expect(emote!.y).toBeGreaterThan(feetY + 1.5);
    }
    expect(kinds).toEqual([1, 2, 3, 4, 1]);
    sim.dispose();
  });

  it('M8 (fase 6): a ordem da roda sai na borda: o balão em cima de quem mandou e, no Ataca ali, o ping onde a mira bate', () => {
    const { map } = buildSyntheticConstruto();
    const sim = createSim({ recipe, map, humans: 1, countdownS: 0 });
    const frames = createInputFrames();
    const f = frames[0]!;
    const out: SimEvent[] = [];
    const step = (buttons: number, n = 1): SignalEvent[] => {
      const got: SignalEvent[] = [];
      for (let i = 0; i < n; i++) {
        f.buttons = buttons;
        sim.step(frames);
        out.length = 0;
        sim.drainEvents(out);
        for (const ev of out) if (ev.type === 'signal') got.push({ ...ev });
      }
      return got;
    };
    step(0, 5);
    const feetY = sim.view().position[(sim.controllerEntity(0) & 0xffff) * 3 + 1]!;
    // O aviso apertado logo antes não segura a ordem (a espera dela é à parte).
    expect(step(BUTTON.ping).map((s) => s.kind)).toEqual([SIGNAL_KIND.ping]);
    // Segurada por vários ticks (o jogo segura o valor), sai uma vez só.
    const follow = step(withOrder(0, ORDER.follow), 6);
    expect(follow.map((s) => s.kind)).toEqual([SIGNAL_KIND.firstOrder]);
    expect(follow[0]!.y).toBeGreaterThan(feetY + 1.5);
    step(0, Math.round(SIGNAL_COOLDOWN_S * sim.hz) + 1);
    f.pitch = pitchToI16(-1.2);
    const attack = step(withOrder(0, ORDER.attack));
    expect(attack.map((s) => s.kind)).toEqual([SIGNAL_KIND.ping, SIGNAL_KIND.firstOrder + ORDER.attack - 1]);
    expect(Math.abs(attack[0]!.y - feetY)).toBeLessThan(0.6);
    sim.dispose();
  });
});
