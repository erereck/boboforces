import { MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import type { InputFrame } from '@boboforces/input';
import { createInputFrames, createSim, createSimLoop, type Sim } from '@boboforces/sim';
import { buildSyntheticConstruto } from '@boboforces/sim/testing';
import { describe, expect, it } from 'vitest';
import { createClientDriver, RECONCILE_SMOOTH } from './client.ts';
import { createHostDriver, createNetHost, type NetMatchDriver } from './host.ts';
import { createLoopback } from './transport.ts';

/** M12 (fase 6): a correção do próprio boneco no online some em τ 0,1 s em vez de estalar; acima de 1 m, salta. */

const { map } = buildSyntheticConstruto({ nav: false });
const recipe: MatchRecipe = {
  format: MATCH_RECIPE_FORMAT,
  mode: 'warfare.tdm',
  map: 'test',
  seed: 5,
  teams: [
    { humans: 1, bots: [] },
    { humans: 1, bots: [] },
  ],
};

const idle = (out: InputFrame): void => {
  out.buttons = 0;
  out.moveX = 0;
  out.moveY = 0;
};

function hostInner(write: (slot: number, out: InputFrame) => void): NetMatchDriver & { sim: Sim } {
  const sim = createSim({ recipe, map, humans: 2 });
  const loop = createSimLoop({
    sim,
    frames: createInputFrames(),
    beforeTick: (_s, f) => {
      for (let h = 0; h < 2; h++) write(h, f[h]!);
    },
  });
  return { sim, alpha: 0, update: (s) => loop.frame(s), dispose: () => sim.dispose() };
}

describe('a correção do online sem estalo (M12 fase 6)', () => {
  it('o erro da predição vira deslocamento de render que some em τ; teleporte salta; a predição fica exata', () => {
    const net = createLoopback({ seed: 3, latencyMs: 0, jitterMs: 0, loss: 0, duplicate: 0 });
    let netHost: ReturnType<typeof createNetHost> | null = null;
    const inner = hostInner((slot, out) => (slot === 0 ? idle(out) : netHost!.writeRemoteFrame(slot, out)));
    netHost = createNetHost({ sim: inner.sim, endpoint: net.endpoint(0), snapshotHz: 30 });
    const host = createHostDriver(netHost, inner);
    netHost.addClient(1, 1);
    const client = createClientDriver({
      sim: createSim({ recipe, map, humans: 2 }),
      endpoint: net.endpoint(1),
      host: 0,
      writeLocalFrame: idle,
    });
    const frame = 1 / 60;
    const run = (n: number, each?: () => void): void => {
      for (let i = 0; i < n; i++) {
        net.advance(frame * 1000);
        host.update(frame);
        client.update(frame);
        each?.();
      }
    };
    run(60);
    const own = client.ownEntity;
    expect(own).toBeGreaterThanOrEqual(0);
    expect([...client.ownOffset]).toEqual([0, 0, 0]);
    const cv = client.sim.view();
    const hostE = inner.sim.controllerEntity(1) & 0xffff;
    const teleports0 = client.stats.teleports;

    /**
     * O host empurra o boneco do amigo `d` m em x (o que a predição não sabia); devolve o maior passo que o amigo viu
     * num quadro (o boneco anda sempre para o mesmo lado e chega em 0,75 s; o deslocamento nunca passa do teto).
     */
    const push = (d: number): number => {
      const start = cv.position[own * 3]!;
      inner.sim.view().position[hostE * 3] = inner.sim.view().position[hostE * 3]! + d;
      inner.sim.view().prevPosition[hostE * 3] = inner.sim.view().prevPosition[hostE * 3]! + d;
      let prev = start;
      let maxStep = 0;
      run(45, () => {
        const x = cv.position[own * 3]!;
        expect(x).toBeGreaterThanOrEqual(prev - 1e-9);
        expect(Math.hypot(...client.ownOffset)).toBeLessThanOrEqual(RECONCILE_SMOOTH.maxM + 1e-9);
        maxStep = Math.max(maxStep, x - prev);
        prev = x;
      });
      // Em 0,75 s já chegou (o que sobra do deslocamento é menos de 1 mm; abaixo de 0,1 mm zera).
      expect(prev).toBeCloseTo(start + d, 3);
      expect(Math.hypot(...client.ownOffset)).toBeLessThan(1e-3);
      run(15);
      expect([...client.ownOffset]).toEqual([0, 0, 0]);
      return maxStep;
    };
    const fraction = 1 - Math.exp(-frame / RECONCILE_SMOOTH.tauS);
    // 10 cm (o erro comum): desliza inteiro, cada quadro anda só uma fração do que falta (τ 0,1 s a 60 Hz: ~15%).
    const small = push(0.1);
    expect(small).toBeLessThan(0.1 * fraction + 0.005);
    expect(small).toBeGreaterThan(0.005);
    // Revisão: 40 cm: o que passa dos 15 cm salta na hora (a câmera de 1ª pessoa fica perto do olho do host) e o resto
    // desliza.
    const big = push(0.4);
    expect(big).toBeGreaterThan(0.4 - RECONCILE_SMOOTH.maxM - 0.01);
    expect(big).toBeLessThan(0.4 - RECONCILE_SMOOTH.maxM + RECONCILE_SMOOTH.maxM * fraction + 0.01);
    // Erro de predição (medido e suavizado), não teleporte.
    expect(client.stats.teleports).toBe(teleports0);
    expect(client.stats.mispredicts).toBeGreaterThanOrEqual(1);

    // Teleporte (3 m, como um respawn): salta na hora, sem deslizar o caminho todo.
    const x1 = cv.position[own * 3]!;
    inner.sim.view().position[hostE * 3] = inner.sim.view().position[hostE * 3]! + 3;
    inner.sim.view().prevPosition[hostE * 3] = inner.sim.view().prevPosition[hostE * 3]! + 3;
    run(4);
    expect(cv.position[own * 3]!).toBeCloseTo(x1 + 3, 3);
    expect([...client.ownOffset]).toEqual([0, 0, 0]);
    client.dispose();
    host.dispose();
  });
});
