import { MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import { BitReader, BitWriter } from '@boboforces/shared';
import { describe, expect, it } from 'vitest';
import type { PointEvent, SimEvent } from './events.ts';
import { createInputFrames } from './loop.ts';
import { createSim, type SimMap } from './sim.ts';
import { DOMINATION, type ControlPointDef } from './systems/domination.ts';
import { buildSyntheticConstruto } from './testing/index.ts';

/**
 * M6 (fase 1): o Domination na sim. Dois humanos parados no spawn (um de cada time); os pontos são postos onde eles
 * nasceram (a mesma semente dá os mesmos spawns), então dá para medir a captura, a posse e os pontos sem andar.
 */
const recipe = (scoreLimit: number): MatchRecipe => ({
  format: MATCH_RECIPE_FORMAT,
  mode: 'warfare.domination',
  map: 'test',
  seed: 11,
  match: { timeLimitS: 0, scoreLimit },
  teams: [
    { humans: 1, bots: [] },
    { humans: 1, bots: [] },
  ],
});

/** Onde os 2 humanos nasceram (pés). */
function spawnFeet(map: SimMap): [number, number, number][] {
  const sim = createSim({ recipe: recipe(200), map, humans: 2 });
  const frames = createInputFrames();
  for (let i = 0; i < 3; i++) sim.step(frames);
  const v = sim.view();
  const out: [number, number, number][] = [];
  for (const c of [0, 1]) {
    const e = sim.controllerEntity(c) & 0xffff;
    out.push([v.position[e * 3]!, v.position[e * 3 + 1]!, v.position[e * 3 + 2]!]);
  }
  sim.dispose();
  return out;
}

describe('Domination na sim (M6 fase 1)', () => {
  it('captura em 5 s com 1 bobo, cada ponto dominado rende 1 por segundo e o ponto vazio fica neutro', () => {
    const { map } = buildSyntheticConstruto();
    const [a, b] = spawnFeet(map);
    const points: ControlPointDef[] = [
      { x: a![0], y: a![1], z: a![2], radius: 2 },
      { x: b![0], y: b![1], z: b![2], radius: 2 },
      // Longe dos dois: ninguém.
      { x: (a![0] + b![0]) / 2 + 40, y: a![1], z: (a![2] + b![2]) / 2, radius: 2 },
    ];
    const sim = createSim({ recipe: recipe(200), map: { ...map, controlPoints: points }, humans: 2 });
    const frames = createInputFrames();
    const cp = sim.view().controlPoints!;
    expect(cp.count).toBe(3);
    const events: SimEvent[] = [];
    const captured: PointEvent[] = [];
    const steps = (n: number): void => {
      for (let i = 0; i < n; i++) {
        sim.step(frames);
        events.length = 0;
        sim.drainEvents(events);
        for (const e of events) if (e.type === 'point') captured.push({ ...e });
      }
    };
    const capS = DOMINATION.captureS[0];
    steps(Math.round(capS * sim.hz) - 5);
    expect([...cp.owner]).toEqual([-1, -1, -1]);
    steps(10);
    expect([...cp.owner]).toEqual([0, 1, -1]);
    expect(cp.progress[0]).toBe(1);
    expect(cp.progress[1]).toBe(-1);
    expect(captured.map((e) => [e.index, e.team, e.action])).toEqual([
      [0, 0, 'captured'],
      [1, 1, 'captured'],
    ]);
    // 10 s depois: 10 pontos para cada time (os abates não contam no Domination).
    const before = [...sim.view().match.teamScore].slice(0, 2);
    steps(10 * sim.hz);
    const after = [...sim.view().match.teamScore].slice(0, 2);
    expect(after[0]! - before[0]!).toBe(10);
    expect(after[1]! - before[1]!).toBe(10);
    sim.dispose();
  });

  it('com os dois times em cima, nada anda; a meta acaba a partida com o vencedor', () => {
    const { map } = buildSyntheticConstruto();
    const [a, b] = spawnFeet(map);
    // Um ponto grande que pega os dois humanos: disputado.
    const both: ControlPointDef = {
      x: (a![0] + b![0]) / 2,
      y: a![1],
      z: (a![2] + b![2]) / 2,
      radius: Math.hypot(a![0] - b![0], a![2] - b![2]),
    };
    const contested = createSim({ recipe: recipe(200), map: { ...map, controlPoints: [both] }, humans: 2 });
    const frames = createInputFrames();
    for (let i = 0; i < 10 * contested.hz; i++) contested.step(frames);
    expect(contested.view().controlPoints!.progress[0]).toBe(0);
    expect(contested.view().controlPoints!.owner[0]).toBe(-1);
    contested.dispose();
    // Só o ponto do time 0, meta 5: 5 s de captura e 5 s de pontos, vitória do time 0.
    const sim = createSim({
      recipe: recipe(5),
      map: { ...map, controlPoints: [{ x: a![0], y: a![1], z: a![2], radius: 2 }] },
      humans: 2,
    });
    for (let i = 0; i < 11 * sim.hz && sim.view().match.phase !== 'ended'; i++) sim.step(frames);
    expect(sim.view().match.phase).toBe('ended');
    expect(sim.view().match.winnerTeam).toBe(0);
    expect(sim.view().match.teamScore[0]).toBe(5);
    sim.dispose();
  });

  it('fora do modo (TDM) ou sem pontos no mapa, nada de pontos; o estado entra no hash e no snapshot', () => {
    const { map } = buildSyntheticConstruto();
    const [a] = spawnFeet(map);
    const withPoints: SimMap = { ...map, controlPoints: [{ x: a![0], y: a![1], z: a![2], radius: 2 }] };
    const tdm = createSim({ recipe: { ...recipe(200), mode: 'warfare.tdm' }, map: withPoints, humans: 2 });
    expect(tdm.view().controlPoints).toBeNull();
    tdm.dispose();
    const noPoints = createSim({ recipe: recipe(200), map, humans: 2 });
    expect(noPoints.view().controlPoints).toBeNull();
    noPoints.dispose();
    // O snapshot leva a posse e o progresso: outra sim lê e fica igual (inclusive o hash).
    const frames = createInputFrames();
    const one = createSim({ recipe: recipe(200), map: withPoints, humans: 2 });
    for (let i = 0; i < 3 * one.hz; i++) one.step(frames);
    expect(one.view().controlPoints!.progress[0]).toBeGreaterThan(0.5);
    const two = createSim({ recipe: recipe(200), map: withPoints, humans: 2 });
    const w = new BitWriter(64 * 1024);
    one.writeSnapshot(w);
    two.readSnapshot(new BitReader(w.bytes()));
    expect(two.view().controlPoints!.progress[0]).toBe(one.view().controlPoints!.progress[0]);
    expect(two.stateHash()).toEqual(one.stateHash());
    one.dispose();
    two.dispose();
  });
});
