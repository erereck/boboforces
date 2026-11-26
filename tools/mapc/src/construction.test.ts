import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeMap } from '@boboforces/format';
import { describe, expect, it } from 'vitest';
import construction from '../../../assets-src/maps/construction.ts';
import { loadBlockTable } from './blocks.ts';
import { compileMap, MAX_BFMAP_BYTES } from './compile.ts';
import { loadModelTable } from './models.ts';
import { MAPS_OUT_DIR } from './paths.ts';

/**
 * M10 (fase 2): o Canteiro de Obras no `mapc` (GDD §4.6.3): sem erro e sem aviso, a maior linha de visão medida até
 * 50 m (Switch 3–4P), os spawns de time e de FFA, a travessia de 12–18 s, a cobertura perto em todo o térreo, nenhum
 * poleiro só de humano e o `.bfmap` gravado em dia. As partidas dos bots, o perfil Tático e a IA subindo aos andares
 * ficam no teste do jogo (packages/game/src/scene/construction-map.test.ts).
 */
describe('mapc: Canteiro de Obras', () => {
  it('compila sem erro nem aviso, com as regras de layout do GDD, e o .bfmap gravado está em dia', () => {
    const r = compileMap(construction, { blocks: loadBlockTable(), models: loadModelTable(), maxSightLimitM: 50 });
    expect(r.errors).toEqual([]);
    // M10 (fase 1c): os topos do pulo correndo (`jump-reach.ts`, com o alcance da sim: ~6 m de vão no mesmo nível) e a
    // linha de visão de lá (85 m, o TODO do mapa) são avisos à parte; o resto continua sem aviso.
    expect(r.warnings.filter((w) => !/^topo alcançável só com pulo correndo|\(TODO do mapa: /.test(w))).toEqual([]);
    expect(r.bytes.length).toBeLessThanOrEqual(MAX_BFMAP_BYTES);
    expect(r.doc.meta.maxSightLineM).toBe(50);
    const sight = r.checks.sight.max!.distance;
    expect(sight).toBeLessThanOrEqual(50);
    // A maior linha não é muito menor que a declarada (senão o mapa estaria fechado demais para a sniper).
    expect(sight).toBeGreaterThan(45);
    const sp = r.checks.spawns;
    expect([sp.tdmA, sp.tdmB, sp.ffa]).toEqual([6, 6, 16]);
    // Travessia correndo até o spawn inimigo mais perto (medida em 20/11: 12,2–13,3 s, média 12,6 s).
    const [tMin, tAvg, tMax] = sp.tdmTravelS;
    expect(tMin).toBeGreaterThanOrEqual(12);
    expect(tAvg).toBeGreaterThanOrEqual(12);
    expect(tMax).toBeLessThanOrEqual(18);
    // Cobertura perto em todo o térreo (GDD: a cada 8–12 m, ou seja, a mais perto a uns 4–6 m).
    expect(r.checks.cover.max).toBeLessThanOrEqual(6);

    // Nenhum poleiro só de humano: nó da navegação que os spawns não alcançam (teto de contêiner, de pilha, de fôrma)
    // dentro da área e perto de um nó alcançável, até 3,7 m no plano subindo no máximo 0,5 m (pulo correndo) ou até
    // 1,2 m subindo no máximo 1,5 m (mantle). Lá a análise da linha de visão não chega.
    const nav = r.nav;
    const area = r.doc.markers.playArea;
    const seen = new Uint8Array(nav.nodeCount);
    const queue: number[] = [];
    for (const s of r.doc.markers.spawns) {
      const n = nav.nearestNode(s.x, s.y, s.z);
      if (n >= 0 && seen[n] === 0) {
        seen[n] = 1;
        queue.push(n);
      }
    }
    for (let q = 0; q < queue.length; q++) {
      const a = queue[q]!;
      for (let l = nav.linkStart[a]!; l < nav.linkStart[a + 1]!; l++) {
        const b = nav.linkTarget[l]!;
        if (seen[b] === 0) {
          seen[b] = 1;
          queue.push(b);
        }
      }
    }
    const pos = new Float64Array(nav.nodeCount * 3);
    for (let n = 0; n < nav.nodeCount; n++) nav.nodePosition(n, pos, n * 3);
    const inArea = (n: number): boolean =>
      pos[n * 3]! >= area.minX &&
      pos[n * 3]! <= area.maxX &&
      pos[n * 3 + 2]! >= area.minZ &&
      pos[n * 3 + 2]! <= area.maxZ;
    const reach: number[] = [];
    for (let n = 0; n < nav.nodeCount; n++) if (seen[n] === 1 && inArea(n)) reach.push(n);
    const perches: string[] = [];
    for (let n = 0; n < nav.nodeCount; n++) {
      if (seen[n] === 1 || !inArea(n)) continue;
      for (const m of reach) {
        const d = Math.hypot(pos[n * 3]! - pos[m * 3]!, pos[n * 3 + 2]! - pos[m * 3 + 2]!);
        const rise = pos[n * 3 + 1]! - pos[m * 3 + 1]!;
        if ((d <= 3.7 && rise <= 0.5) || (d <= 1.2 && rise <= 1.5)) {
          perches.push(`(${pos[n * 3]}, ${pos[n * 3 + 1]}, ${pos[n * 3 + 2]})`);
          break;
        }
      }
    }
    expect(perches).toEqual([]);

    // O que o `npm run mapc` gravou é o que o script monta hoje (o `--check` do CI faz o mesmo para todos).
    const disk = new Uint8Array(readFileSync(join(MAPS_OUT_DIR, 'construction.bfmap')));
    expect(Buffer.from(disk).equals(Buffer.from(r.bytes))).toBe(true);
    expect(decodeMap(disk).id).toBe('construction');
    // Compila o mapa inteiro: a análise da linha de visão leva dezenas de segundos no Vitest e mais com o portão.
  }, 240_000);
});
