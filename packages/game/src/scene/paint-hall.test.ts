import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHeadlessMatch } from '@boboforces/ai';
import {
  builtinBotRef,
  decodeMap,
  decodeModelPack,
  MATCH_RECIPE_FORMAT,
  parseLayerManifest,
  type MatchRecipe,
} from '@boboforces/format';
import { ENTITY_FLAG, ENTITY_KIND, type SimEvent } from '@boboforces/sim';
import { BLOCK_FLAG, boxIntersectsWorld, createRayHit, parseBlockDefs, raycastGrid } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { MAP_MODES, mapsForMode } from '../maps.ts';
import { moreModePreset } from '../more-modes.ts';
import { buildMapNav, buildMapWorld, buildSimMap, type MapWorld } from './world.ts';

/**
 * M10 (fase 3): o Galpão de Paintball (`paint-hall`) de verdade, montado pelo caminho do loading. Confere os spawns
 * (espelhados no meio, longe um do outro) e joga cada modo dele com bots pela sim headless: o Bobo Paintball até o fim
 * (50 abates ou 3 min), os Times 3 min e o Sandbox 2 min com 4 times. Ninguém fica parado: cada bot anda pelo campo e o
 * Destravar quase não aparece.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const RUNTIME = JSON.parse(readFileSync(join(ROOT, 'assets-src', 'runtime-assets.json'), 'utf8')) as {
  files: Record<string, string>;
};
const asset = (logical: string): Uint8Array =>
  new Uint8Array(readFileSync(join(ROOT, 'assets-src', RUNTIME.files[logical] as string)));
const text = (logical: string): string => new TextDecoder().decode(asset(logical));

const doc = decodeMap(asset('maps/paint-hall.bfmap'));

function loadWorld(): MapWorld {
  const manifest = parseLayerManifest(JSON.parse(text('textures/blocos16.json')) as unknown);
  const layers = new Map(manifest.layers.map((l, i) => [l.name, i] as const));
  return buildMapWorld({
    map: doc,
    blockDefs: parseBlockDefs(JSON.parse(text('blocks/blocks.json')) as unknown),
    blockLayer: (name) => layers.get(name),
    models: decodeModelPack(asset('models/modelos.bfmodel')).models,
  });
}

function loadMap() {
  const world = loadWorld();
  return buildSimMap(world, buildMapNav(world));
}

interface Surface {
  readonly x: number;
  readonly z: number;
  /** O piso (pés), em m. */
  readonly h: number;
}

/**
 * Revisão (o Galpão): os pisos aonde GENTE chega, não só o bot. Toda superfície em que a caixa de 0,6 × 1,75 m do
 * bobo cabe em pé com algo sólido logo embaixo (bloco ou prop; grade de 0,5 m, pés de 1 a 13 m), e o alcance a partir
 * do chão: o pulo de 1 m mais o degrau de 0,5 m sobem até 1,5 m, e o alcance no plano cai com a subida (2 m subindo
 * mais de 1 m, 3 m até 1 m, 3,5 m até 0,5 m, 4,5 m no plano ou descendo), com o arco livre na altura do mais alto.
 */
function humanReach(world: MapWorld): Surface[] {
  const box = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
  const hits = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): boolean => {
    box.minX = x0;
    box.minY = y0;
    box.minZ = z0;
    box.maxX = x1;
    box.maxY = y1;
    box.maxZ = z1;
    return boxIntersectsWorld(world.grid, world.registry, box, world.colliders);
  };
  const R = 0.3;
  const area = doc.markers.playArea;
  const all: Surface[] = [];
  for (let x = area.minX + 0.25; x < area.maxX; x += 0.5) {
    for (let z = area.minZ + 0.25; z < area.maxZ; z += 0.5) {
      for (let h = 1; h <= 13; h += 0.25) {
        if (hits(x - R, h + 0.02, z - R, x + R, h + 1.75, z + R)) continue;
        if (hits(x - R, h - 0.1, z - R, x + R, h, z + R)) all.push({ x, z, h });
      }
    }
  }
  const cols = new Map<string, number[]>();
  all.forEach((s, i) => {
    const k = `${s.x},${s.z}`;
    const list = cols.get(k);
    if (list) list.push(i);
    else cols.set(k, [i]);
  });
  const reach = (rise: number): number => (rise > 1 ? 2 : rise > 0.5 ? 3 : rise > 0 ? 3.5 : 4.5);
  const seen = new Uint8Array(all.length);
  const queue: number[] = [];
  all.forEach((s, i) => {
    if (s.h === 1) {
      seen[i] = 1;
      queue.push(i);
    }
  });
  for (let q = 0; q < queue.length; q++) {
    const s = all[queue[q]!]!;
    for (let dx = -4.5; dx <= 4.5; dx += 0.5) {
      for (let dz = -4.5; dz <= 4.5; dz += 0.5) {
        const d = Math.hypot(dx, dz);
        for (const j of cols.get(`${s.x + dx},${s.z + dz}`) ?? []) {
          const t = all[j]!;
          const rise = t.h - s.h;
          if (seen[j] === 1 || rise > 1.5 + 1e-6 || d > reach(rise)) continue;
          // O arco: a caixa do bobo livre na altura do mais alto dos dois, ao longo do pulo.
          const y = Math.max(s.h, t.h) + 0.05;
          const n = Math.ceil(d / 0.25);
          let ok = true;
          for (let k = 1; k < n && ok && !(d <= 0.75 && rise <= 0.5); k++) {
            const f = k / n;
            ok = !hits(s.x + dx * f - R, y, s.z + dz * f - R, s.x + dx * f + R, y + 1.75, s.z + dz * f + R);
          }
          if (!ok) continue;
          seen[j] = 1;
          queue.push(j);
        }
      }
    }
  }
  return all.filter((_, i) => seen[i] === 1);
}

interface Played {
  readonly phase: string;
  readonly ticks: number;
  readonly score: readonly number[];
  readonly kills: number;
  readonly unstucks: number;
  /** Caminho andado por bobo (m, somado a cada 1 s, sem contar o salto do renascimento). */
  readonly walked: readonly number[];
}

/** Joga a receita até acabar (ou `maxS` segundos de sim) e mede abates, Destravar e o quanto cada bobo andou. */
function play(recipe: MatchRecipe, maxS: number): Played {
  const map = loadMap();
  let kills = 0;
  let unstucks = 0;
  const onEvents = (events: readonly SimEvent[]): void => {
    for (const e of events) {
      if (e.type === 'kill') kills++;
      else if (e.type === 'unstuck') unstucks++;
    }
  };
  const match = createHeadlessMatch({ recipe, map, humans: 0, onEvents });
  const hz = match.sim.hz;
  const last = new Map<number, [number, number]>();
  const walked = new Map<number, number>();
  let t = 0;
  for (; t < maxS * hz && match.sim.view().match.phase !== 'ended'; t++) {
    match.step();
    if (t % hz !== 0) continue;
    const v = match.sim.view();
    for (let e = 0; e < v.count; e++) {
      if (v.kind[e] !== ENTITY_KIND.bobo) continue;
      const x = v.position[e * 3]!;
      const z = v.position[e * 3 + 2]!;
      const prev = last.get(e);
      const dead = (v.flags[e]! & ENTITY_FLAG.dead) !== 0;
      // Um passo de mais de 12 m em 1 s é o renascimento (não conta).
      if (prev && !dead) {
        const d = Math.hypot(x - prev[0], z - prev[1]);
        if (d < 12) walked.set(e, (walked.get(e) ?? 0) + d);
      }
      last.set(e, [x, z]);
    }
  }
  const v = match.sim.view();
  const out: Played = {
    phase: v.match.phase,
    ticks: t,
    score: [...v.match.teamScore.slice(0, 4)],
    kills,
    unstucks,
    walked: [...walked.values()].map((d) => Math.round(d)),
  };
  match.dispose();
  return out;
}

const normal = builtinBotRef('normal');

describe('Galpão de Paintball (M10, fase 3)', () => {
  it('o .bfmap: os modos, a linha de visão, os jogadores e os spawns espelhados e longe', () => {
    expect([...doc.meta.modes].sort()).toEqual(['paintball', 'sandbox', 'warfare.tdm']);
    expect([...MAP_MODES['paint-hall']].sort()).toEqual(['paintball', 'sandbox', 'warfare.tdm']);
    expect(mapsForMode('paintball')).toEqual(['paint-hall']);
    expect(doc.meta.maxSightLineM).toBeLessThanOrEqual(50);
    expect(doc.meta.players.max).toBeGreaterThanOrEqual(doc.meta.players.ideal);
    // Média (60×60 a 90×90 m): 64 × 84 m.
    const area = doc.markers.playArea;
    expect(area.maxX - area.minX).toBe(64);
    expect(area.maxZ - area.minZ).toBe(84);
    const a = doc.markers.spawns.filter((s) => s.team === 0);
    const b = doc.markers.spawns.filter((s) => s.team === 1);
    expect(a.length).toBeGreaterThanOrEqual(6);
    expect(b.length).toBe(a.length);
    const mid = (area.minZ + area.maxZ) / 2;
    for (const s of a) {
      // Cada spawn do time 0 tem o gêmeo do time 1 espelhado no meio (z' = 2·meio − z), no chão.
      expect(b.some((t) => Math.abs(t.x - s.x) < 1e-6 && Math.abs(t.z - (2 * mid - s.z)) < 1e-6)).toBe(true);
      expect(s.y).toBe(1);
      for (const t of b) expect(Math.hypot(s.x - t.x, s.z - t.z)).toBeGreaterThan(60);
    }
    // O card do Bobo Paintball começa aqui.
    expect(moreModePreset('paintball')!.map).toBe('paint-hall');
    // Revisão (item 5): as props viram um grupo instanciado por modelo e célula de 32 m no render, e o Switch 3–4P
    // desenha até 8 grupos por vista: o galpão inteiro tem 8 (2 modelos × 2 × 2 células), então nenhum some.
    const groups = new Set(
      doc.props.map((pr) => `${pr.model}:${Math.floor(pr.x / 32 / 32)}:${Math.floor(pr.z / 32 / 32)}`),
    );
    expect(groups.size).toBeLessThanOrEqual(8);
  });

  it('o maior pedaço da navegação é o chão dos spawns (o telhado é dividido pelas aberturas do lanternim)', () => {
    const nav = loadMap().nav!;
    // O mesmo critério do `navMainComponent` da sim (o Destravar e a casa do Sandbox usam ele).
    const counts = new Map<number, number>();
    for (let n = 0; n < nav.nodeCount; n++) {
      if (nav.clearance[n] === 1) counts.set(nav.component[n]!, (counts.get(nav.component[n]!) ?? 0) + 1);
    }
    const main = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]![0];
    for (const s of doc.markers.spawns) expect(nav.component[nav.nearestNode(s.x, s.y, s.z)]).toBe(main);
  });

  describe('revisão: o que GENTE alcança pulando (não só o bot)', () => {
    const world = loadWorld();
    const reached = humanReach(world);
    const area = doc.markers.playArea;
    const hit = createRayHit();
    const clear = (a: readonly number[], b: readonly number[], mask: number, props: boolean): boolean => {
      const dx = b[0]! - a[0]!;
      const dy = b[1]! - a[1]!;
      const dz = b[2]! - a[2]!;
      const d = Math.hypot(dx, dy, dz);
      return !raycastGrid(
        world.grid,
        world.registry,
        a[0]!,
        a[1]!,
        a[2]!,
        dx / d,
        dy / d,
        dz / d,
        d,
        mask,
        hit,
        props ? world.colliders : null,
      );
    };

    it('nenhum lugar fora de um box vê (e acerta) os spawns dele: o tapume e as divisórias vão até o teto', () => {
      // O tapume do norte fica em z [minZ + 9, minZ + 9,5) e o do sul em [maxZ − 9,5, maxZ − 9).
      const outside = (team: number, s: Surface): boolean =>
        team === 0 ? s.z > area.minZ + 9.5 : s.z < area.maxZ - 9.5;
      const seen: string[] = [];
      for (const team of [0, 1]) {
        const spawns = doc.markers.spawns.filter((sp) => sp.team === team);
        for (const s of reached) {
          if (!outside(team, s)) continue;
          const eye = [s.x, s.h + 1.55, s.z];
          for (const sp of spawns) {
            for (const ty of [1.2, 1.55]) {
              const t = [sp.x, sp.y + ty, sp.z];
              if (clear(eye, t, BLOCK_FLAG.blocksBullets, true) && clear(eye, t, BLOCK_FLAG.blocksSight, true)) {
                seen.push(`(${s.x}, ${s.h}, ${s.z}) → spawn (${sp.x}, ${sp.z})`);
              }
            }
          }
        }
      }
      expect(seen.slice(0, 10), `${seen.length} linhas`).toEqual([]);
    }, 120_000);

    it('de nenhum poleiro alcançável se vê além de 50 m (só bloco tapa, como no mapc)', () => {
      // Os poleiros (acima do chão) a cada 1 m, contra o chão da navegação a cada 2 m e contra os outros poleiros.
      const perches = reached.filter((s) => s.h > 1 && (s.x * 2) % 2 === 0.5 && (s.z * 2) % 2 === 0.5);
      const nav = loadMap().nav!;
      const p = new Float64Array(3);
      const targets: number[][] = perches.map((s) => [s.x, s.h + 1.55, s.z]);
      for (let n = 0; n < nav.nodeCount; n++) {
        if (nav.clearance[n] !== 1) continue;
        nav.nodePosition(n, p);
        if (p[1]! > 2.1 || Math.round(p[0]! - 0.5) % 2 !== 0 || Math.round(p[2]! - 0.5) % 2 !== 0) continue;
        targets.push([p[0]!, p[1]! + 1.55, p[2]!]);
      }
      const long: string[] = [];
      let highest = 0;
      for (const s of perches) {
        highest = Math.max(highest, s.h);
        const eye = [s.x, s.h + 1.55, s.z];
        for (const t of targets) {
          const d = Math.hypot(t[0]! - eye[0]!, t[1]! - eye[1]!, t[2]! - eye[2]!);
          if (d > 50 && clear(eye, t, BLOCK_FLAG.blocksSight, false)) long.push(`(${eye}) → (${t}) ${d.toFixed(1)} m`);
        }
      }
      // Medido na revisão: o mais alto é a passarela (pés a 3,75 m) e a escada dela (4 m); nada passa de 50 m.
      expect(highest).toBeLessThanOrEqual(4);
      expect(long.slice(0, 10), `${long.length} linhas`).toEqual([]);
    }, 120_000);
  });

  // A escada reta de 2,75 m da passarela: o seguidor de caminho perdia o degrau até o M10 (fase 1c). Depois dela o bot
  // subia, mas o passeio quase não ia lá: a passarela (piso a 3,75 m, 2,75 m acima do chão) caía na mesma faixa de 3 m
  // do chão no sorteio por andar e só o sorteio uniforme por nó a escolhia (nesta semente, 7 amostras, a 1ª aos 76 s; 3
  // de 8 sementes). M11 (fase 2): o passeio sorteia por lugar (piso plano), e as duas metades da passarela são lugares
  // altos: 84 amostras nesta semente, a 1ª aos 5 s (8 de 8 sementes).
  it('os bots sobem na passarela', () => {
    const recipe: MatchRecipe = {
      format: MATCH_RECIPE_FORMAT,
      mode: 'warfare.tdm',
      map: 'paint-hall',
      seed: 42,
      match: { timeLimitS: 180, scoreLimit: 75 },
      teams: [
        { bots: [{ ref: builtinBotRef('normal'), count: 4 }] },
        { bots: [{ ref: builtinBotRef('normal'), count: 4 }] },
      ],
    };
    const map = loadMap();
    const match = createHeadlessMatch({ recipe, map, humans: 0 });
    let onCatwalk = 0;
    for (let t = 0; t < 180 * match.sim.hz; t++) {
      match.step();
      if (t % 15 !== 0) continue;
      const v = match.sim.view();
      for (let e = 0; e < v.count; e++) {
        if (v.kind[e] === ENTITY_KIND.bobo && v.position[e * 3]! < 7 && v.position[e * 3 + 1]! > 3) onCatwalk++;
      }
    }
    match.dispose();
    console.log(`[galpão] passarela: ${onCatwalk} amostras`);
    expect(onCatwalk).toBeGreaterThan(0);
  }, 120_000);

  it('Bobo Paintball: 4 contra 4 até 50 abates ou 3 min, todo mundo jogando', () => {
    const base = moreModePreset('paintball')!;
    const recipe: MatchRecipe = {
      ...base,
      seed: 42,
      match: { ...base.match, timeLimitS: 180 },
      teams: [{ bots: [{ ref: normal, count: 4 }] }, { bots: [{ ref: normal, count: 4 }] }],
    };
    const r = play(recipe, 190);
    const msg = JSON.stringify(r);
    console.log(`[galpão] paintball ${msg}`);
    expect(r.phase, msg).toBe('ended');
    expect(r.score[0]! + r.score[1]!, msg).toBeGreaterThan(20);
    expect(r.walked.length, msg).toBe(8);
    expect(Math.min(...r.walked), msg).toBeGreaterThan(40);
    expect(r.unstucks, msg).toBeLessThan(8);
  }, 120_000);

  it('Times (TDM): 4 contra 4 por 3 min, com abates e sem bot parado', () => {
    const recipe: MatchRecipe = {
      format: MATCH_RECIPE_FORMAT,
      mode: 'warfare.tdm',
      map: 'paint-hall',
      seed: 42,
      match: { timeLimitS: 180, scoreLimit: 75 },
      teams: [{ bots: [{ ref: normal, count: 4 }] }, { bots: [{ ref: normal, count: 4 }] }],
    };
    const r = play(recipe, 190);
    const msg = JSON.stringify(r);
    console.log(`[galpão] tdm ${msg}`);
    expect(r.phase, msg).toBe('ended');
    expect(r.kills, msg).toBeGreaterThan(8);
    expect(r.walked.length, msg).toBe(8);
    expect(Math.min(...r.walked), msg).toBeGreaterThan(40);
    expect(r.unstucks, msg).toBeLessThan(8);
  }, 120_000);

  it('Sandbox: 4 times de 2 bots por 2 min (os times 2 e 3 nos lados do meio-campo, no chão)', () => {
    const bots = [{ ref: normal, count: 2 }];
    const recipe: MatchRecipe = {
      format: MATCH_RECIPE_FORMAT,
      mode: 'sandbox',
      map: 'paint-hall',
      seed: 7,
      match: { timeLimitS: 120, scoreLimit: 75 },
      teams: [{ bots }, { bots }, { bots }, { bots }],
    };
    const r = play(recipe, 130);
    const msg = JSON.stringify(r);
    console.log(`[galpão] sandbox ${msg}`);
    expect(r.phase, msg).toBe('ended');
    expect(r.kills, msg).toBeGreaterThan(4);
    expect(r.walked.length, msg).toBe(8);
    expect(Math.min(...r.walked), msg).toBeGreaterThan(20);
    expect(r.unstucks, msg).toBeLessThan(8);
  }, 120_000);
});
