import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHeadlessMatch, createSteer, NAV_PATH_API, PathFollower, PathService } from '@boboforces/ai';
import {
  builtinBotRef,
  decodeMap,
  decodeModelPack,
  MATCH_RECIPE_FORMAT,
  parseLayerManifest,
  type MatchRecipe,
} from '@boboforces/format';
import { BUTTON } from '@boboforces/input';
import {
  createFlowField,
  createNavPath,
  findPath,
  NAV_GATE_BLOCK,
  NO_NAV_NODE,
  type NavGrid,
  type NavGridImpl,
} from '@boboforces/nav';
import { ENTITY_FLAG, ENTITY_KIND, type SimMap, type SpawnPoint } from '@boboforces/sim';
import { isCellSolid, parseBlockDefs } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
// O passe de pulos do `mapc` (só no teste: as ferramentas não entram no jogo).
import { findJumpReach } from '../../../../tools/mapc/src/jump-reach.ts';
import { buildMapNav, buildMapWorld, buildSimMap } from './world.ts';

/**
 * M10 (fase 5): a Fazenda à noite (`assets-src/maps/farm.ts`) de verdade: o `.bfmap` do `mapc`, os blocos e os modelos,
 * montados pelo caminho do loading (`buildMapWorld` → `buildMapNav` → `buildSimMap`). Confere as entidades do Bobo
 * Zombies, que as portas pagas abrem as áreas certas (os portões da navegação dos bobos) e que as ondas andam na sim
 * headless (os zumbis chegam às janelas e arrancam tábuas; o Fortress vai até o fim).
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

/** O piso do térreo da Fazenda (m; o `G` do script do mapa). */
const G_FARM = 1;

function zombiesRecipe(seed: number, fortress = false): MatchRecipe {
  return {
    format: MATCH_RECIPE_FORMAT,
    mode: 'zombies',
    map: 'farm',
    seed,
    ...(fortress ? { zombies: { variant: 'fortress' as const } } : {}),
    teams: [{ bots: [{ ref: builtinBotRef('normal'), count: 4 }] }],
  };
}

/** O bobo anda (A* com os portões) de `from` até o ponto (x, y, z)? */
function walks(nav: NavGrid, from: number, x: number, y: number, z: number): boolean {
  const to = nav.nearestNode(x, y, z);
  expect(to, `nó em (${x}, ${y}, ${z})`).not.toBe(NO_NAV_NODE);
  const path = createNavPath(nav, 1024);
  let status = findPath(nav, from, to, path, 100_000);
  while (status === 'pending') status = findPath(nav, from, to, path, 100_000);
  return status === 'found';
}

describe('a Fazenda à noite (M10, fase 5)', () => {
  it('100 m de área, o Bobo Zombies e as entidades dele', () => {
    const doc = decodeMap(asset('maps/farm.bfmap'));
    const area = doc.markers.playArea;
    expect(area.maxX - area.minX).toBe(100);
    expect(area.maxZ - area.minZ).toBe(100);
    expect(doc.meta.maxSightLineM).toBe(50);
    expect([...doc.meta.modes]).toEqual(['zombies']);
    const m = doc.markers;
    expect(m.barricades).toHaveLength(18);
    expect(m.paidDoors).toHaveLength(6);
    for (const d of m.paidDoors!) expect(d.cost >= 750 && d.cost <= 1250, `porta de ${d.cost}`).toBe(true);
    expect(m.wallBuys).toHaveLength(6);
    for (const w of m.wallBuys!) expect(w.cost >= 500 && w.cost <= 1500, `${w.weapon} de ${w.cost}`).toBe(true);
    expect(m.boxSpots).toHaveLength(3);
    expect(new Set(m.perkMachines!.map((q) => q.perk))).toEqual(new Set(['chonky', 'speedy', 'buddy']));
    for (const q of m.perkMachines!) expect(q.cost >= 1500 && q.cost <= 3000).toBe(true);
    expect(m.spawns.filter((s) => s.team === 0)).toHaveLength(4);
    expect(m.spawns.filter((s) => s.team === -1).length).toBeGreaterThanOrEqual(8);
  }, 30_000);

  it('o ritmo: com as portas fechadas, a rota dos zumbis até a casa é curta como a da Base (média ≤ 40 m)', () => {
    const map = loadFarm();
    // As portas fechadas são o estado do começo da partida (a sim prende os portões ao criar).
    const match = createHeadlessMatch({ recipe: zombiesRecipe(1), map, humans: 0 });
    const nav = map.nav!;
    const flow = createFlowField(nav);
    flow.begin();
    for (const s of map.spawns) if (s.team === 0) flow.addSource(nav.nearestNode(s.x, s.y, s.z));
    flow.run(1e9);
    const costs = map.spawns.filter((s) => s.team === -1).map((s) => flow.distance(nav.nearestNode(s.x, s.y, s.z)));
    const mean = costs.reduce((a, b) => a + b, 0) / costs.length;
    const msg = `rotas ${costs.map((d) => d.toFixed(0)).join(', ')} m; média ${mean.toFixed(1)} m`;
    console.log(`[farm] ${msg}`);
    expect(mean, msg).toBeLessThanOrEqual(40);
    expect(Math.max(...costs), msg).toBeLessThanOrEqual(65);
    match.dispose();
  }, 60_000);

  it('as portas pagas abrem as áreas: a casa, o terreiro, o galpão, o celeiro (e o jirau) e o pátio dos silos', () => {
    const map = loadFarm();
    // A sim prende as janelas e as portas aos portões da navegação (fechadas no começo).
    const match = createHeadlessMatch({ recipe: zombiesRecipe(1), map, humans: 0 });
    const nav = map.nav!;
    const gate = (d: number): number => map.barricades!.length + d;
    const setDoor = (d: number, open: boolean): void =>
      nav.setGateBlock(gate(d), open ? 0 : NAV_GATE_BLOCK.bobo | NAV_GATE_BLOCK.zombie);
    const casa = map.spawns.find((s) => s.team === 0)!;
    const from = nav.nearestNode(casa.x, casa.y, casa.z);
    const G = casa.y;
    const reach = (): Record<string, boolean> => ({
      terreiro: walks(nav, from, 63, G, 60),
      galpao: walks(nav, from, 35, G, 78),
      celeiro: walks(nav, from, 60, G, 48),
      jirau: walks(nav, from, 62, G + 3, 31),
      silos: walks(nav, from, 80, G, 40),
    });
    const none = { terreiro: false, galpao: false, celeiro: false, jirau: false, silos: false };
    // Tudo fechado: a casa (as janelas não deixam o bobo sair).
    expect(reach()).toEqual(none);
    // A porta do galpão (1000) e a volta do galpão ao terreiro (750).
    setDoor(1, true);
    expect(reach()).toEqual({ ...none, galpao: true });
    setDoor(2, true);
    expect(reach()).toEqual({ ...none, galpao: true, terreiro: true });
    // Celeiro → silos sozinha não leva a nenhum dos dois; terreiro → silos (1000) leva aos dois.
    setDoor(5, true);
    expect(reach()).toEqual({ ...none, galpao: true, terreiro: true });
    setDoor(4, true);
    expect(reach()).toEqual({ terreiro: true, galpao: true, celeiro: true, jirau: true, silos: true });
    // De novo, pelo outro lado: só a dos fundos (750) e o portão do celeiro (1250).
    for (let d = 0; d < 6; d++) setDoor(d, d === 0 || d === 3);
    expect(reach()).toEqual({ ...none, terreiro: true, celeiro: true, jirau: true });
    match.dispose();
  }, 60_000);

  it('Bobo Zombies com 4 bots de apoio: os zumbis chegam às janelas e as ondas andam', () => {
    const map = loadFarm();
    let tears = 0;
    let kills = 0;
    let unstucks = 0;
    const match = createHeadlessMatch({
      recipe: zombiesRecipe(1),
      map,
      humans: 0,
      zombies: 24,
      onEvents: (events) => {
        for (const ev of events) {
          if (ev.type === 'barricade' && ev.action !== 'repair') tears++;
          else if (ev.type === 'kill') kills++;
          else if (ev.type === 'unstuck') unstucks++;
        }
      },
    });
    const v = match.sim.view();
    for (let t = 0; t < 60 * 60 * 8 && v.match.phase !== 'ended' && v.match.zombieWave < 5; t++) match.step();
    const msg = `onda ${v.match.zombieWave}, ${kills} abates, ${tears} tábuas, ${unstucks} Destravar`;
    console.log(`[farm] ${msg}`);
    expect(v.match.zombieWave, msg).toBeGreaterThanOrEqual(4);
    expect(tears, msg).toBeGreaterThan(10);
    expect(kills, msg).toBeGreaterThan(40);
    expect(unstucks, msg).toBeLessThanOrEqual(6);
    match.dispose();
  }, 120_000);

  it('Fortress: os zumbis vão no gerador da sala e a partida acaba', () => {
    const map = loadFarm();
    const match = createHeadlessMatch({ recipe: zombiesRecipe(2, true), map, humans: 0, zombies: 24 });
    const v = match.sim.view();
    const f = v.fortress!;
    // O gerador fica na casa (o spawn dos bobos mais perto do meio deles).
    expect(f.x > 50.5 && f.x < 68 && f.z > 74.5 && f.z < 88, `gerador em (${f.x}, ${f.z})`).toBe(true);
    let low = Infinity;
    for (let t = 0; t < 60 * 60 * 12 && v.match.phase !== 'ended'; t++) {
      match.step();
      low = Math.min(low, f.hp[0]!);
    }
    const msg = `onda ${v.match.zombieWave}, gerador no mínimo ${Math.round(low)}, fase ${v.match.phase}`;
    console.log(`[farm fortress] ${msg}`);
    expect(v.match.phase, msg).toBe('ended');
    expect(low, msg).toBeLessThan(4000);
    match.dispose();
  }, 180_000);
});

/**
 * Alcance horizontal (m) do pulo do bobo correndo para subir `rise` m (negativo = descer): 2,6 m para 1,5 m, 3,7 m para
 * 1 m e 4,3 m para 0,5 m (medidos na sim pela revisão da fase 5); no plano e nas quedas, com folga (a queda alonga o
 * voo). Acima de 1,55 m (o mantle), nada.
 */
const LEAP: readonly (readonly [number, number])[] = [
  [-2, 6],
  [-1, 5.5],
  [0, 4.8],
  [0.5, 4.3],
  [1, 3.7],
  [1.5, 2.6],
  [1.55, 2.5],
];

/** O nó (pelas posições `X`, `Z`) fica dentro da área jogável do mapa (fora dela a sim põe parede invisível)? */
function inPlayArea(map: SimMap, X: Float64Array, Z: Float64Array): (node: number) => boolean {
  const a = map.playArea!;
  return (k) => X[k]! >= a.minX && X[k]! <= a.maxX && Z[k]! >= a.minZ && Z[k]! <= a.maxZ;
}

function leapReach(rise: number): number {
  if (rise > LEAP[LEAP.length - 1]![0]) return -1;
  if (rise <= LEAP[0]![0]) return LEAP[0]![1];
  for (let i = 1; i < LEAP.length; i++) {
    const [r0, d0] = LEAP[i - 1]!;
    const [r1, d1] = LEAP[i]!;
    if (rise <= r1) return d0 + ((d1 - d0) * (rise - r0)) / (r1 - r0);
  }
  return -1;
}

describe('a Fazenda (M10, fase 5, revisão): sem poleiro', () => {
  it('todo nó que o bobo alcança (andando, escalando até 1,55 m ou pulando correndo) o zumbi alcança ou golpeia', () => {
    const map = loadFarm();
    // A sim prende as janelas, as portas e as máquinas aos portões; aqui todas as portas foram compradas.
    const match = createHeadlessMatch({ recipe: zombiesRecipe(1), map, humans: 0 });
    const nav = map.nav as NavGridImpl;
    const nb = map.barricades!.length;
    const nd = map.doors!.length;
    for (let d = 0; d < nd; d++) nav.setGateBlock(nb + d, 0);
    const n = nav.nodeCount;
    const X = new Float64Array(n);
    const Z = new Float64Array(n);
    const Y = nav.floorY;
    const p = new Float64Array(3);
    for (let i = 0; i < n; i++) {
      nav.nodePosition(i, p);
      X[i] = p[0]!;
      Z[i] = p[2]!;
    }
    const near = (a: number, radius: number, visit: (b: number) => void): void => {
      const ci = Math.floor(X[a]!);
      const ck = Math.floor(Z[a]!);
      const r = Math.ceil(radius);
      for (let k = Math.max(0, ck - r); k <= Math.min(nav.columnsZ - 1, ck + r); k++) {
        for (let i = Math.max(0, ci - r); i <= Math.min(nav.columnsX - 1, ci + r); i++) {
          const col = i + k * nav.columnsX;
          for (let b = nav.columnStart[col]!; b < nav.columnStart[col + 1]!; b++) visit(b);
        }
      }
    };
    // Os zumbis: as ligações da navegação, entrando pelas janelas e passando pelas portas (as máquinas fecham).
    const zombie = new Uint8Array(n);
    const zq: number[] = [];
    for (const s of map.spawns) {
      const k = nav.nearestNode(s.x, s.y, s.z);
      if (s.team === -1 && k !== NO_NAV_NODE && zombie[k] === 0) {
        zombie[k] = 1;
        zq.push(k);
      }
    }
    for (let q = 0; q < zq.length; q++) {
      const a = zq[q]!;
      for (let l = nav.linkStart[a]!; l < nav.linkStart[a + 1]!; l++) {
        const b = nav.linkTarget[l]!;
        if (nav.linkGate[l]! >= nb + nd || zombie[b] === 1) continue;
        zombie[b] = 1;
        zq.push(b);
      }
    }
    // O bobo: as ligações com os portões dele (a janela fecha) e os pulos de nó a nó sem parede no caminho (o corpo
    // passa 1 m acima do piso mais alto; a tábua da janela conta como parede).
    const windows = map.barricades!.map((w) => {
      const half = w.width / 2;
      const acrossX = w.outside === 0 || w.outside === 1;
      return {
        x0: acrossX ? w.x - 0.3 : w.x - half,
        x1: acrossX ? w.x + 0.3 : w.x + half,
        z0: acrossX ? w.z - half : w.z - 0.3,
        z1: acrossX ? w.z + half : w.z + 0.3,
        y0: w.y,
        y1: w.y + (w.height ?? 2),
      };
    });
    const wall = (x: number, y: number, z: number): boolean => {
      if (isCellSolid(map.grid, map.blocks, Math.floor(x * 2), Math.floor(y * 2), Math.floor(z * 2))) return true;
      for (const w of windows)
        if (x >= w.x0 && x <= w.x1 && z >= w.z0 && z <= w.z1 && y >= w.y0 && y <= w.y1) return true;
      return false;
    };
    const clear = (a: number, b: number): boolean => {
      const y = Math.max(Y[a]!, Y[b]!) + 1;
      const steps = Math.max(1, Math.ceil(Math.hypot(X[b]! - X[a]!, Z[b]! - Z[a]!) / 0.25));
      for (let s = 1; s < steps; s++) {
        const t = s / steps;
        if (wall(X[a]! + (X[b]! - X[a]!) * t, y, Z[a]! + (Z[b]! - Z[a]!) * t)) return false;
      }
      return true;
    };
    const bobo = new Uint8Array(n);
    const hq: number[] = [];
    for (const s of map.spawns) {
      const k = nav.nearestNode(s.x, s.y, s.z);
      if (s.team === 0 && k !== NO_NAV_NODE && bobo[k] === 0) {
        bobo[k] = 1;
        hq.push(k);
      }
    }
    for (let q = 0; q < hq.length; q++) {
      const a = hq[q]!;
      for (let l = nav.linkStart[a]!; l < nav.linkStart[a + 1]!; l++) {
        const g = nav.linkGate[l]!;
        const b = nav.linkTarget[l]!;
        if ((g >= 0 && (nav.gateBlock[g]! & NAV_GATE_BLOCK.bobo) !== 0) || bobo[b] === 1) continue;
        bobo[b] = 1;
        hq.push(b);
      }
      near(a, 6, (b) => {
        if (bobo[b] === 1) return;
        const reach = leapReach(Y[b]! - Y[a]!);
        if (reach < 0 || Math.hypot(X[b]! - X[a]!, Z[b]! - Z[a]!) > reach || !clear(a, b)) return;
        bobo[b] = 1;
        hq.push(b);
      });
    }
    // M10 (fase 10): por cima, o passe de pulos do `mapc` (`jump-reach.ts`: o pulo correndo com os números da sim, do
    // apoio de uma borda ao da outra, que vai mais longe que a tabela acima) a partir de tudo o que o bobo já alcança;
    // a tábua da janela conta como parede. O que ele achar entra na conta dos poleiros.
    const jumps = findJumpReach({
      nav,
      reachable: bobo,
      inArea: inPlayArea(map, X, Z),
      collides: (x, y, z) => wall((x + 0.5) / 2, (y + 0.5) / 2, (z + 0.5) / 2),
    });
    for (let k = 0; k < n; k++) if (jumps.mark[k] === 1) bobo[k] = 1;
    // Poleiro: o bobo alcança, o zumbi não, e nenhum zumbi num nó a até 1,5 m fica a menos de 1 m de altura dele (a IA
    // do zumbi só golpeia "no mesmo andar", |dy| < 1; a sim aceita até 1 m).
    const perches: string[] = [];
    for (let h = 0; h < n; h++) {
      if (bobo[h] === 0 || zombie[h] === 1) continue;
      let hit = false;
      near(h, 2, (z) => {
        if (zombie[z] === 1 && Math.hypot(X[z]! - X[h]!, Z[z]! - Z[h]!) <= 1.5 && Math.abs(Y[h]! - Y[z]!) < 0.999)
          hit = true;
      });
      if (!hit) perches.push(`(${X[h]}, ${Y[h]!.toFixed(2)}, ${Z[h]})`);
    }
    // Os poleiros que a revisão achou (topos das pilhas de 2 m) nem são alcançáveis.
    const tops: readonly (readonly [string, number, number, number])[] = [
      ['fardo grande do terreiro', 55, G_FARM + 2, 66],
      ['fardo da janela do terreiro', 55, G_FARM + 2, 57.5],
      ['lenha do terreiro', 71, G_FARM + 2, 69],
      ['caixotes do galpão', 31.5, G_FARM + 2, 70],
      ['carroça do galpão', 39.5, G_FARM + 2, 79],
      ['fardos do pátio (raia leste)', 90.5, G_FARM + 2, 51],
      ['fardos do pátio (porta do terreiro)', 81, G_FARM + 2, 61],
    ];
    for (const [name, x, y, z] of tops) {
      const k = nav.nearestNode(x, y, z);
      if (k !== NO_NAV_NODE && Math.abs(Y[k]! - y) < 0.3) expect(bobo[k], name).toBe(0);
    }
    const reached = bobo.reduce((s, v) => s + v, 0);
    console.log(
      `[farm] ${reached} nós que o bobo alcança (todas as portas compradas; ${jumps.count} só com o pulo correndo), ` +
        `${perches.length} poleiros`,
    );
    expect(perches, perches.slice(0, 20).join(' ')).toEqual([]);
    match.dispose();
  }, 120_000);

  it('nem dos campos: nenhum topo só de pulo correndo no mapa (o passe do mapc, com as janelas abertas)', () => {
    // M10 (fase 10): os campos são dos zumbis (o bobo não passa da janela), mas a Horda armada (`zombies.variant:
    // 'armed'`, que roda em qualquer mapa do Bobo Zombies) abre as janelas. Topo aonde só o pulo correndo leva é lugar
    // aonde o zumbi não chega nem golpeia (ele só sobe 1 m) e de onde a visada passa por cima das cercas vivas: o passe
    // do `mapc`, a partir de todos os spawns e com tudo aberto, não acha nenhum (antes, o trator e os rolos de feno dos
    // campos eram o degrau para as cercas vivas e as pilhas: 368 nós e uma visada de 106 m).
    const map = loadFarm();
    // Sem partida: as ligações valem todas (portas compradas, janelas abertas).
    const nav = map.nav as NavGridImpl;
    const n = nav.nodeCount;
    const X = new Float64Array(n);
    const Z = new Float64Array(n);
    const p = new Float64Array(3);
    for (let i = 0; i < n; i++) {
      nav.nodePosition(i, p);
      X[i] = p[0]!;
      Z[i] = p[2]!;
    }
    const reachable = new Uint8Array(n);
    const queue: number[] = [];
    for (const s of map.spawns) {
      const k = nav.nearestNode(s.x, s.y, s.z);
      if (k !== NO_NAV_NODE && reachable[k] === 0) {
        reachable[k] = 1;
        queue.push(k);
      }
    }
    for (let q = 0; q < queue.length; q++) {
      const a = queue[q]!;
      for (let l = nav.linkStart[a]!; l < nav.linkStart[a + 1]!; l++) {
        const b = nav.linkTarget[l]!;
        if (reachable[b] === 0) {
          reachable[b] = 1;
          queue.push(b);
        }
      }
    }
    const jumps = findJumpReach({
      nav,
      reachable,
      inArea: inPlayArea(map, X, Z),
      collides: (x, y, z) => isCellSolid(map.grid, map.blocks, x, y, z),
    });
    const where = jumps.tops.map((t) => `(${t.at.join(', ')}) de (${t.from.join(', ')})`);
    expect(jumps.count, where.slice(0, 10).join(' ')).toBe(0);
  }, 60_000);

  /** Um bobo parado em (x, y, z), sem atirar, com a horda: em quantos segundos ele leva o 1º golpe (Infinity = não). */
  function idleHit(x: number, y: number, z: number, maxS: number): number {
    const map = loadFarm();
    const spawns: SpawnPoint[] = [{ x, y, z, yaw: 0, team: 0 }, ...map.spawns.filter((s) => s.team === -1)];
    const match = createHeadlessMatch({
      recipe: {
        format: MATCH_RECIPE_FORMAT,
        mode: 'zombies',
        map: 'farm',
        seed: 3,
        teams: [{ humans: 'all', bots: [] }],
      },
      map: { ...map, spawns },
      humans: 1,
      zombies: 24,
    });
    const v = match.sim.view();
    const e = match.sim.controllerEntity(0) & 0xffff;
    const hp = v.health[e]!;
    let at = Infinity;
    for (let t = 0; t < maxS * match.sim.hz && at === Infinity; t++) {
      match.step();
      if (v.health[e]! < hp || (v.flags[e]! & ENTITY_FLAG.downed) !== 0) at = t / match.sim.hz;
    }
    match.dispose();
    return at;
  }

  // Os pontos altos de verdade (o zumbi chega neles ou bate de baixo): o jirau (pela escada), o fardo de 1 m do celeiro,
  // o bocal do poço e a bancada da cozinha (encostada na parede do terreiro). Parado ali, o bobo apanha.
  for (const [name, x, y, z] of [
    ['jirau do celeiro', 62, G_FARM + 3, 31.5],
    ['fardo de 1 m do celeiro', 63.5, G_FARM + 1, 45],
    ['bocal do poço', 62, G_FARM + 1, 59],
    ['bancada da cozinha', 65.5, G_FARM + 0.5, 75],
  ] as const) {
    it(`parado no ${name}, o bobo leva golpe de zumbi`, () => {
      const s = idleHit(x, y, z, 150);
      console.log(`[farm] ${name}: 1º golpe em ${s.toFixed(1)} s`);
      expect(s, name).toBeLessThan(150);
    }, 120_000);
  }
});

describe('a Fazenda (M10, fase 5, revisão): a IA sobe ao jirau', () => {
  // A escada reta de 3 m do jirau esbarrava no erro do seguidor de rota dos bots (o apoio perto do pé da escada não
  // subia para seguir ou levantar o colega): a suavização junta o lance num segmento só (pé → topo) e o bot, no pé,
  // ficava mais de 2,5 m abaixo do ponto de chegada, "caía" e pedia a mesma rota para sempre. Consertado no M10 (fase
  // 1c: `AI_PATH.fellM` contra a ponta de baixo do segmento); o teste ficou desligado até o M11 (fase 2).
  it('o seguidor de rota dos bots sobe do chão do celeiro ao jirau em até 30 s', () => {
    const map = loadFarm();
    const spawns: SpawnPoint[] = [
      { x: 60, y: G_FARM, z: 48, yaw: 0, team: 0 },
      ...map.spawns.filter((s) => s.team === -1),
    ];
    const follower = new PathFollower(0);
    const service = new PathService(NAV_PATH_API, [follower]);
    service.bind(map.nav ?? null);
    const steer = createSteer();
    const [gx, gy, gz] = [62, G_FARM + 3, 31.5];
    let me = -1;
    let tick = 0;
    let reached = Infinity;
    const match = createHeadlessMatch({
      recipe: {
        format: MATCH_RECIPE_FORMAT,
        mode: 'zombies',
        map: 'farm',
        seed: 1,
        teams: [{ humans: 'all', bots: [] }],
      },
      map: { ...map, spawns },
      humans: 1,
      zombies: 0,
      writeHumans: (frames, sim) => {
        const v = sim.view();
        if (me < 0) for (let e = 0; e < v.count; e++) if (v.kind[e] === ENTITY_KIND.bobo) me = e;
        const x = v.position[me * 3]!;
        const y = v.position[me * 3 + 1]!;
        const z = v.position[me * 3 + 2]!;
        if (reached === Infinity && Math.hypot(x - gx, z - gz) < 1.5 && Math.abs(y - gy) < 0.3) reached = tick / sim.hz;
        service.want(follower, x, y, z, gx, gy, gz, tick, 30);
        service.service();
        const f = frames[0]!;
        f.moveX = 0;
        f.moveY = 0;
        f.buttons = 0;
        if (service.steer(follower, x, y, z, true, steer)) {
          f.yaw = Math.round((Math.atan2(-steer.x, -steer.z) / (Math.PI * 2)) * 65536) & 0xffff;
          f.moveY = 127;
          if (steer.jump) f.buttons |= BUTTON.jump;
        }
        tick++;
      },
    });
    for (let t = 0; t < 30 * match.sim.hz && reached === Infinity; t++) match.step();
    match.dispose();
    console.log(`[farm] o seguidor chega ao jirau em ${reached.toFixed(1)} s`);
    expect(reached).toBeLessThan(30);
  }, 60_000);
});
