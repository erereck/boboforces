import { MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import { BUTTON, createInputFrame, quantizeAxis, type InputFrame } from '@boboforces/input';
import { yawToU16 } from '@boboforces/shared';
import { describe, expect, it } from 'vitest';
import { ENTITY_FLAG } from './entity.ts';
import { createInputFrames } from './loop.ts';
import { createSim, PREDICT_STATE_SIZE } from './sim.ts';
import { buildSyntheticConstruto } from './testing/index.ts';

const recipe: MatchRecipe = {
  format: MATCH_RECIPE_FORMAT,
  mode: 'warfare.tdm',
  map: 'test',
  seed: 2,
  teams: [{ humans: 1, bots: [] }, { bots: [] }],
};

/** Corre, pula, desliza, agacha e vira: passa por todo estado do movimento. */
function script(t: number, f: InputFrame): void {
  f.yaw = yawToU16(Math.sin(t * 0.013) * 2);
  f.pitch = 0;
  f.moveY = quantizeAxis(t % 240 < 200 ? 1 : -0.5);
  f.moveX = quantizeAxis(Math.sin(t * 0.05));
  let b = t % 120 < 90 ? BUTTON.sprint : 0;
  if (t % 70 === 10 || t % 70 === 11) b |= BUTTON.jump;
  if (t % 130 >= 95 && t % 130 < 105) b |= BUTTON.crouch;
  f.buttons = b;
}

describe('predição do movimento (M5 fase 2b)', () => {
  it('carregar o estado e repetir as entradas dá a mesma posição do step, bit a bit', () => {
    const { map } = buildSyntheticConstruto();
    const host = createSim({ recipe, map, humans: 1 });
    const client = createSim({ recipe, map, humans: 1 });
    const frames = createInputFrames();
    const e = host.controllerEntity(0) & 0xffff;
    for (let t = 0; t < 200; t++) {
      script(t, frames[0]!);
      host.step(frames);
    }
    // O cliente pega o estado do host no tick 200 e segue sozinho com as mesmas entradas.
    const state = new Float64Array(PREDICT_STATE_SIZE);
    host.predict.save(e, state);
    client.predict.load(e, state);
    const f = createInputFrame();
    let slides = 0;
    let jumps = 0;
    for (let t = 200; t < 800; t++) {
      script(t, frames[0]!);
      script(t, f);
      host.step(frames);
      client.predict.step(e, f);
      const hv = host.view();
      const cv = client.view();
      for (let a = 0; a < 3; a++) expect(cv.position[e * 3 + a], `tick ${t}`).toBe(hv.position[e * 3 + a]);
      expect(cv.flags[e]).toBe(hv.flags[e]);
      if ((hv.flags[e]! & ENTITY_FLAG.sliding) !== 0) slides++;
      if (hv.velocity[e * 3 + 1]! > 1) jumps++;
    }
    expect(slides).toBeGreaterThan(10);
    expect(jumps).toBeGreaterThan(10);
    // Sem eventos nem dano no cliente.
    const out: never[] = [];
    client.drainEvents(out);
    expect(out).toEqual([]);
    host.dispose();
    client.dispose();
  });
});
