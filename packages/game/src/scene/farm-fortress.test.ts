import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHeadlessMatch } from '@boboforces/ai';
import { builtinBotRef, decodeMap, decodeModelPack, parseLayerManifest, type MatchRecipe } from '@boboforces/format';
import { BUTTON } from '@boboforces/input';
import { FORTRESS, type SimEvent, type SimMap, type SpawnPoint } from '@boboforces/sim';
import { parseBlockDefs } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { moreModePreset } from '../more-modes.ts';
import { buildMapNav, buildMapWorld, buildSimMap } from './world.ts';

/**
 * M11 (fase 3): o Bobo Zombies Fortress na Fazenda à noite (o card da Fortaleza começa nela), na sim headless com o
 * mapa de verdade (o `.bfmap` do `mapc`, montado pelo caminho do loading): o gerador na sala, o conserto, a vitória, a
 * derrota pelo gerador, o caído e o reviver. O golden fica em `golden.test.ts`.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const RUNTIME = JSON.parse(readFileSync(join(ROOT, 'assets-src', 'runtime-assets.json'), 'utf8')) as {
  files: Record<string, string>;
};
const asset = (logical: string): Uint8Array =>
  new Uint8Array(readFileSync(join(ROOT, 'assets-src', RUNTIME.files[logical] as string)));
const text = (logical: string): string => new TextDecoder().decode(asset(logical));

function loadFarm(): SimMap {
  const manifest = parseLayerManifest(JSON.parse(text('textures/blocos16.json')) as unknown);
  const layers = new Map(manifest.layers.map((l, i) => [l.name, i] as const));
  const world = buildMapWorld({
    map: decodeMap(asset('maps/farm.bfmap')),
    blockDefs: parseBlockDefs(JSON.parse(text('blocks/blocks.json')) as unknown),
    blockLayer: (name) => layers.get(name),
    models: decodeModelPack(asset('models/modelos.bfmodel')).models,
  });
  return buildSimMap(world, buildMapNav(world));
}

/** A receita do card com 4 bots Normal de apoio no lugar do jogador (e as regras do Zombies por cima). */
function withSupport(seed: number, zombies: MatchRecipe['zombies'] = {}): MatchRecipe {
  const card = moreModePreset('zombiesFortress')!;
  return {
    ...card,
    seed,
    zombies: { ...card.zombies, ...zombies },
    teams: [{ bots: [{ ref: builtinBotRef('normal'), count: 4 }] }],
  };
}

/** A sala da casa (x 50..68, z 74..88), por dentro das paredes de 0,5 m. */
const inLivingRoom = (x: number, z: number): boolean => x > 50.5 && x < 68 && z > 74.5 && z < 88;

interface Run {
  wave: number;
  winner: number;
  phase: string;
  hp: number;
  low: number;
  downs: number;
  revives: number;
  selfRevives: number;
  seconds: number;
}

function countDowns(run: Run): (events: readonly SimEvent[]) => void {
  return (events) => {
    for (const ev of events) {
      if (ev.type !== 'down') continue;
      if (ev.action === 'down') run.downs++;
      else if (ev.action === 'revive') run.revives++;
      else run.selfRevives++;
    }
  };
}

/** Até o fim da partida (ou `maxS` de jogo). */
function play(recipe: MatchRecipe, humans: number, maxS: number, map = loadFarm()): Run {
  const run: Run = {
    wave: 0,
    winner: 0,
    phase: '',
    hp: 0,
    low: Infinity,
    downs: 0,
    revives: 0,
    selfRevives: 0,
    seconds: 0,
  };
  const match = createHeadlessMatch({ recipe, map, humans, zombies: 24, onEvents: countDowns(run) });
  const v = match.sim.view();
  let t = 0;
  for (; t < maxS * match.sim.hz && v.match.phase !== 'ended'; t++) {
    match.step();
    run.low = Math.min(run.low, v.fortress!.hp[0]!);
  }
  run.wave = v.match.zombieWave;
  run.winner = v.match.winnerTeam;
  run.phase = v.match.phase;
  run.hp = Math.round(v.fortress!.hp[0]!);
  run.low = Math.round(run.low);
  run.seconds = Math.round(t / match.sim.hz);
  match.dispose();
  return run;
}

describe('M11 (fase 3): o Fortress na Fazenda à noite', () => {
  it('o card da Fortaleza joga aqui: o gerador nasce na sala, com a vida cheia', () => {
    const recipe = moreModePreset('zombiesFortress')!;
    expect([recipe.map, recipe.zombies?.variant]).toEqual(['farm', 'fortress']);
    const match = createHeadlessMatch({ recipe: withSupport(1), map: loadFarm(), humans: 0, zombies: 0 });
    const f = match.sim.view().fortress!;
    expect(inLivingRoom(f.x, f.z), `gerador em (${f.x}, ${f.z})`).toBe(true);
    expect(f.y).toBe(1);
    expect(f.hp[0]).toBe(FORTRESS.hp);
    match.dispose();
  }, 60_000);

  it('o conserto: segurando o usar ao lado do gerador, a vida volta (60 por segundo)', () => {
    const map = loadFarm();
    // Um bobo só, nascendo no meio da sala: o gerador nasce a 1,5 m dele (o conserto alcança 2,2 m).
    const spawns: SpawnPoint[] = [
      { x: 58.5, y: 1, z: 80.5, yaw: 0, team: 0 },
      ...map.spawns.filter((s) => s.team === -1),
    ];
    let use = false;
    const match = createHeadlessMatch({
      recipe: { ...moreModePreset('zombiesFortress')!, seed: 1 },
      map: { ...map, spawns },
      humans: 1,
      zombies: 0,
      writeHumans: (frames) => {
        const f = frames[0]!;
        f.moveX = 0;
        f.moveY = 0;
        f.buttons = use ? BUTTON.use : 0;
      },
    });
    const v = match.sim.view();
    const f = v.fortress!;
    expect(inLivingRoom(f.x, f.z), `gerador em (${f.x}, ${f.z})`).toBe(true);
    for (let t = 0; t < 10 * match.sim.hz && v.match.phase !== 'playing'; t++) match.step();
    expect(v.match.phase).toBe('playing');
    // Sem zumbi (o pool vazio): parado sem o usar, a vida não muda; com o usar, 5 s levam 300 (até o teto).
    f.hp[0] = 1000;
    for (let t = 0; t < 2 * match.sim.hz; t++) match.step();
    expect(f.hp[0]).toBe(1000);
    use = true;
    for (let t = 0; t < 5 * match.sim.hz; t++) match.step();
    expect(f.hp[0]!).toBeCloseTo(1000 + FORTRESS.repairPerS * 5, 0);
    match.dispose();
  }, 60_000);

  it('a vitória: 4 bots de apoio passam 2 ondas e o gerador fica de pé', () => {
    for (const seed of [1, 2, 3]) {
      const r = play(withSupport(seed, { waves: 2 }), 0, 300);
      const msg = `semente ${seed}: ${JSON.stringify(r)}`;
      console.log(`[farm fortress] vitória ${msg}`);
      expect([r.phase, r.winner, r.wave], msg).toEqual(['ended', 0, 2]);
      expect(r.hp, msg).toBeGreaterThan(0);
    }
  }, 180_000);

  it('a derrota pelo gerador: com o bobo parado (levanta sozinho sem limite), a horda derruba o gerador', () => {
    // O bobo cai e levanta sozinho (a partida não acaba por ele), e os zumbis que não estão nele vão no gerador.
    const r = play({ ...withSupport(5, { waves: 0, selfRevives: -1 }), teams: [{ humans: 'all', bots: [] }] }, 1, 600);
    const msg = JSON.stringify(r);
    console.log(`[farm fortress] derrota pelo gerador ${msg}`);
    expect([r.phase, r.winner, r.hp], msg).toEqual(['ended', -1, 0]);
    expect(r.downs, msg).toBeGreaterThan(0);
    expect(r.selfRevives, msg).toBeGreaterThan(0);
  }, 120_000);

  it('o caído e o reviver: os bots caem, levantam o colega, e a partida acaba quando ninguém fica de pé', () => {
    // A Curta inteira (10 ondas), como o card: os bots não compram portas nem armas e caem entre a onda 4 e a 5.
    let revives = 0;
    for (const seed of [1, 2, 3]) {
      const r = play(withSupport(seed), 0, 900);
      const msg = `semente ${seed}: ${JSON.stringify(r)}`;
      console.log(`[farm fortress] até o fim ${msg}`);
      expect([r.phase, r.winner], msg).toEqual(['ended', -1]);
      // Acabou pelos bobos (todos caídos), não pelo gerador; a horda passou pelo gerador.
      expect(r.hp, msg).toBeGreaterThan(0);
      expect(r.low, msg).toBeLessThan(FORTRESS.hp);
      expect(r.wave, msg).toBeGreaterThanOrEqual(3);
      expect(r.downs, msg).toBeGreaterThan(4);
      revives += r.revives;
    }
    expect(revives).toBeGreaterThan(0);
  }, 300_000);
});
