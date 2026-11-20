import { builtinBotRef, MATCH_RECIPE_FORMAT } from '@boboforces/format';
import { createSim } from '@boboforces/sim';
import { buildTestArena } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { createClientDriver } from './client.ts';
import { createNetHost } from './host.ts';
import type { NetEndpoint } from './transport.ts';

/**
 * M9 (fase 4, revisão): a sim com as Ferramentas do Dono ainda não vai para o online (o layout muda e o protocolo não
 * leva a opção ao cliente): o host e o cliente recusam na criação, antes de tocar no transporte.
 */
describe('as Ferramentas do Dono e o online', () => {
  it('host e cliente recusam uma sim com o dono', () => {
    const sim = createSim({
      recipe: {
        format: MATCH_RECIPE_FORMAT,
        mode: 'warfare.tdm',
        map: 'test',
        seed: 1,
        teams: [{ humans: 1, bots: [{ ref: builtinBotRef('normal'), count: 1 }] }, { bots: [] }],
      },
      map: buildTestArena(),
      humans: 1,
      owner: { reserve: 1 },
    });
    const endpoint = {} as unknown as NetEndpoint;
    expect(() => createNetHost({ sim, endpoint, snapshotHz: 30 })).toThrow(/Ferramentas do Dono/);
    expect(() => createClientDriver({ sim, endpoint, host: 0, writeLocalFrame: () => {} })).toThrow(
      /Ferramentas do Dono/,
    );
    sim.dispose();
  });
});
