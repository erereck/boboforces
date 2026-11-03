import { builtinBotRef, MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import { hashToHex } from '@boboforces/shared';
import { buildTestArena } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { createHeadlessMatch } from './headless.ts';

/**
 * TESTE GOLDEN (critério 3 do M0): 8 bots (4×4) na arena de teste, semente 42, 3.600 ticks (1 min a 60 Hz). O hash do
 * estado precisa ser igual em duas execuções e igual ao valor gravado.
 *
 * Se uma mudança INTENCIONAL na sim, na IA, no RNG ou na arena mudar o hash, atualize `GOLDEN_HASH` no mesmo commit e
 * diga no CHANGELOG o motivo. Mudança sem querer é bug de determinismo.
 */
const GOLDEN_HASH = 'e3f37a6e';
const GOLDEN_TICKS = 3600;

const recipe: MatchRecipe = {
  format: MATCH_RECIPE_FORMAT,
  mode: 'warfare.tdm',
  map: 'test-arena',
  seed: 42,
  teams: [
    { bots: [{ ref: builtinBotRef('normal'), count: 4 }] },
    { bots: [{ ref: builtinBotRef('normal'), count: 4 }] },
  ],
};

function runGolden(): { hash: string; kills: number; shots: number; teamScore: number[] } {
  let kills = 0;
  let shots = 0;
  const match = createHeadlessMatch({
    recipe,
    map: buildTestArena(),
    humans: 0,
    onEvents: (events) => {
      for (const ev of events) {
        if (ev.type === 'kill') kills++;
        else if (ev.type === 'shot') shots++;
      }
    },
  });
  match.run(GOLDEN_TICKS);
  const hash = hashToHex(match.sim.stateHash());
  const teamScore = Array.from(match.sim.view().match.teamScore);
  match.dispose();
  return { hash, kills, shots, teamScore };
}

describe('golden: 8 bots, semente 42, 3.600 ticks', () => {
  it('hash estável entre execuções e igual ao gravado', () => {
    const a = runGolden();
    const b = runGolden();
    expect(b.hash).toBe(a.hash);
    // A partida precisa ter combate de verdade, senão o golden não prova nada.
    expect(a.shots).toBeGreaterThan(100);
    expect(a.kills).toBeGreaterThan(4);
    expect(a.teamScore[0]! + a.teamScore[1]!).toBe(a.kills);
    expect(a.hash).toBe(GOLDEN_HASH);
  });
});
