import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeMap } from '@boboforces/format';
import { buildNavGrid, type NavGridImpl } from '@boboforces/nav';
import { BOBO_NAV_METRICS, METRICS, MOVEMENT_BOBO } from '@boboforces/sim';
import { beforeAll, describe, expect, it } from 'vitest';
import port, { PORT_AREA, PORT_FLOOR, PORT_POINTS } from '../../../assets-src/maps/port.ts';
import { loadBlockTable } from './blocks.ts';
import { compileMap, MAX_BFMAP_BYTES, type CompileResult } from './compile.ts';
import { loadModelTable } from './models.ts';
import { MAPS_OUT_DIR } from './paths.ts';
import { lineOfSight } from './sight.ts';

/**
 * M10 (fase 1): o Porto de Contêineres no `mapc` (GDD §4.6.3): sem erro e sem aviso, a maior linha de visão medida
 * até 50 m (Switch 3–4P), os spawns de time e de FFA, a travessia de 12–18 s, os 3 pontos em cima de nós da
 * navegação principal e o `.bfmap` gravado em dia; e (revisão) nenhum poleiro só de humano, alcançado escalando ou
 * pulando correndo, com vista de mais de 50 m. As partidas dos bots, a subida pelas escadas e a travessia sem pulo
 * ficam no teste do jogo (packages/game/src/scene/port.test.ts).
 */

/** O vão do pulo correndo, de borda a borda, e a subida máxima nele (m), os da revisão do Porto. */
const JUMP_GAP_M = 3.7;
const JUMP_RISE_M = 0.5;

type P3 = [number, number, number];
const key = (q: ArrayLike<number>): string =>
  `${Math.round(q[0]! * 100)}:${Math.round(q[1]! * 100)}:${Math.round(q[2]! * 100)}`;

/** Nós alcançáveis a partir dos spawns, seguindo as ligações no sentido certo, por posição. */
function reachable(nav: NavGridImpl, r: CompileResult): Map<string, P3> {
  const seen = new Uint8Array(nav.nodeCount);
  const queue: number[] = [];
  for (const s of r.doc.markers.spawns) {
    const i = nav.nearestNode(s.x, s.y, s.z);
    if (i >= 0 && seen[i] === 0) {
      seen[i] = 1;
      queue.push(i);
    }
  }
  const out = new Map<string, P3>();
  const p = new Float64Array(3);
  for (let q = 0; q < queue.length; q++) {
    const a = queue[q]!;
    nav.nodePosition(a, p);
    out.set(key(p), [p[0]!, p[1]!, p[2]!]);
    for (let l = nav.linkStart[a]!; l < nav.linkStart[a + 1]!; l++) {
      const b = nav.linkTarget[l]!;
      if (seen[b] === 0) {
        seen[b] = 1;
        queue.push(b);
      }
    }
  }
  return out;
}

/**
 * O que só um humano alcança além da navegação dos bots: escalar borda (o mantle do perfil Bobo, contado como um pulo
 * de até `mantleHeight`) e o pulo correndo sobre um vão de até `JUMP_GAP_M` com até `JUMP_RISE_M` de subida (ou
 * descendo), repetido até fechar. Conservador: o nó pode ficar até 1 m para dentro da borda do piso dele, então conta
 * como pulável tudo até o vão + 2 m entre nós, e não confere parede no meio. Devolve esses nós (na área e acima do plano
 * de morte) e a maior linha de visão, no olho em pé, de algum deles até qualquer nó alcançável.
 */
function humanPerches(r: CompileResult): { perches: P3[]; longest: number; line: number[] } {
  const area = r.doc.markers.playArea;
  const inArea = (p: readonly number[]): boolean =>
    p[0]! >= area.minX && p[0]! <= area.maxX && p[2]! >= area.minZ && p[2]! <= area.maxZ && p[1]! > area.killPlaneY;
  const base = reachable(r.nav, r);
  const climbNav = buildNavGrid(
    { grid: r.grid, blocks: r.registry, colliders: r.colliders },
    { ...BOBO_NAV_METRICS, jumpHeight: Math.max(BOBO_NAV_METRICS.jumpHeight, MOVEMENT_BOBO.mantleHeight) },
  ) as NavGridImpl;
  const human = reachable(climbNav, r);
  const all: P3[] = [];
  const p = new Float64Array(3);
  for (let i = 0; i < climbNav.nodeCount; i++) {
    climbNav.nodePosition(i, p);
    all.push([p[0]!, p[1]!, p[2]!]);
  }
  // Os nós por coluna de 1 m, para achar os vizinhos do pulo.
  const col = (x: number, z: number): number => Math.floor(x) * 4096 + Math.floor(z);
  const cols = new Map<number, number[]>();
  all.forEach((q, i) => {
    const k = col(q[0], q[2]);
    const list = cols.get(k);
    if (list) list.push(i);
    else cols.set(k, [i]);
  });
  const reachM = JUMP_GAP_M + 2;
  const span = Math.ceil(reachM);
  const frontier = [...human.values()];
  while (frontier.length > 0) {
    const a = frontier.pop()!;
    for (let dx = -span; dx <= span; dx++) {
      for (let dz = -span; dz <= span; dz++) {
        for (const i of cols.get(col(a[0] + dx, a[2] + dz)) ?? []) {
          const b = all[i]!;
          const k = key(b);
          if (human.has(k) || !inArea(b)) continue;
          const rise = b[1] - a[1];
          if (rise > JUMP_RISE_M + 1e-6 || rise < -METRICS.safeFallHeight) continue;
          if (Math.hypot(b[0] - a[0], b[2] - a[2]) > reachM + 1e-6) continue;
          human.set(k, b);
          frontier.push(b);
        }
      }
    }
  }
  const perches = [...human.entries()].filter(([k, q]) => inArea(q) && !base.has(k)).map(([, q]) => q);
  const targets = [...human.values()].filter(inArea);
  const eye = METRICS.eyeHeight;
  let longest = 0;
  let line: number[] = [];
  for (const a of perches) {
    for (const b of targets) {
      const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      if (d <= longest) continue;
      if (lineOfSight(r.sight, a[0], a[1] + eye, a[2], b[0], b[1] + eye, b[2])) {
        longest = d;
        line = [a[0], a[1] + eye, a[2], b[0], b[1] + eye, b[2]];
      }
    }
  }
  return { perches, longest, line };
}

describe('mapc: Porto de Contêineres', () => {
  let r: CompileResult;
  // Compila o mapa inteiro uma vez: a análise da linha de visão leva ~40 s no Vitest sozinha e passa de 2 min com o
  // portão.
  beforeAll(() => {
    r = compileMap(port, { blocks: loadBlockTable(), models: loadModelTable(), maxSightLimitM: 50 });
  }, 240_000);

  it('compila sem erro nem aviso, com as regras de layout do GDD, e o .bfmap gravado está em dia', () => {
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.bytes.length).toBeLessThanOrEqual(MAX_BFMAP_BYTES);
    expect(r.doc.meta.maxSightLineM).toBe(50);
    const sight = r.checks.sight.max!.distance;
    expect(sight).toBeLessThanOrEqual(50);
    // A maior linha não é muito menor que a declarada (senão o mapa estaria fechado demais para a sniper).
    expect(sight).toBeGreaterThan(45);
    const sp = r.checks.spawns;
    expect([sp.tdmA, sp.tdmB, sp.ffa]).toEqual([8, 8, 20]);
    // Travessia correndo até o spawn inimigo mais perto (medida em 20/11: 12,0–12,7 s, média 12,4 s).
    const [tMin, tAvg, tMax] = sp.tdmTravelS;
    expect(tAvg).toBeGreaterThanOrEqual(12);
    expect(tMin).toBeGreaterThan(11.5);
    expect(tMax).toBeLessThanOrEqual(18);
    // Cobertura perto em todo o térreo (GDD: a cada 8–12 m, ou seja, a mais perto a uns 4–6 m).
    expect(r.checks.cover.max).toBeLessThanOrEqual(6);
    // Os 3 pontos: cada um em cima de um nó da navegação principal, na altura dele.
    const pos = new Float64Array(3);
    for (const p of Object.values(PORT_POINTS)) {
      const n = r.nav.nearestNode(p.x, p.y, p.z);
      expect(n).toBeGreaterThanOrEqual(0);
      r.nav.nodePosition(n, pos);
      expect(Math.abs(pos[1]! - p.y)).toBeLessThan(0.3);
      expect(r.nav.component[n]).toBe(r.checks.mainComponent);
    }
    expect(r.doc.markers.playArea).toEqual({ ...PORT_AREA, killPlaneY: r.doc.markers.playArea.killPlaneY });
    expect(r.doc.markers.playArea.killPlaneY).toBeLessThan(PORT_FLOOR - 1);
    // O que o `npm run mapc` gravou é o que o script monta hoje (o `--check` do CI faz o mesmo para todos).
    const disk = new Uint8Array(readFileSync(join(MAPS_OUT_DIR, 'port.bfmap')));
    expect(Buffer.from(disk).equals(Buffer.from(r.bytes))).toBe(true);
    expect(decodeMap(disk).id).toBe('port');
  });

  it('nenhum poleiro só de humano (escalando ou pulando correndo) passa dos 50 m de vista nem fica no alto', () => {
    // Revisão (20/11): o caminhão de 1 contêiner a 3,5 m da ponta sul da trilha era alcançável pulando correndo, e de
    // cima dele se via a rua de ponta a ponta (60 m). Hoje sobram só os canos do cais (0,5 m), com 36 m de vista.
    const { perches, longest, line } = humanPerches(r);
    const where = `${perches.length} nós, o mais alto a ${Math.max(0, ...perches.map((q) => q[1]))} m; linha ${line
      .map((v) => v.toFixed(1))
      .join(', ')}`;
    expect(longest, where).toBeLessThanOrEqual(50);
    for (const q of perches) expect(q[1], where).toBeLessThanOrEqual(PORT_FLOOR + 1);
  }, 120_000);
});
