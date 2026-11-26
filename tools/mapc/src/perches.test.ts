import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeMap } from '@boboforces/format';
import { METRICS } from '@boboforces/sim';
import { describe, expect, it } from 'vitest';
import airbase from '../../../assets-src/maps/airbase.ts';
import construto, { TOWER_SCREEN_TOP } from '../../../assets-src/maps/construto.ts';
import type { MapScript } from './api.ts';
import { loadBlockTable } from './blocks.ts';
import { compileMap, type CompileResult } from './compile.ts';
import { loadModelTable } from './models.ts';
import { MAPS_OUT_DIR } from './paths.ts';

/**
 * M11 (fase 1): os poleiros de pulo do Construto e da Base Bobo (a pergunta AK7, "fechar também no Construto e na
 * Base Bobo"). Os dois passavam com `analysis.jumpSightTodo`: do lance da escada da torre do Construto um pulo correndo
 * chegava ao telhado do Bloco Leste (visada de 66 m) e, na Base Bobo, a escalada das pilhas de 1,5 m levava aos
 * quebra-vistas e aos contêineres (61 m). Agora nenhum topo fica só para o pulo correndo (`jump-reach.ts`, com o alcance
 * da sim), não há aviso de visada de pulo e nenhum nó alcançável fica sem volta para os spawns (o poço ao lado da escada
 * da torre prendia o bot que caía nele até o Destravar).
 */

const blocks = loadBlockTable();
const models = loadModelTable();

function compile(script: MapScript): CompileResult {
  return compileMap(script, {
    blocks,
    models,
    requirePrintMarkers: script.id === 'construto',
    maxSightLimitM: script.analysis?.sightLimitM ?? 50,
  });
}

/** Nós da área jogável que os spawns alcançam e de onde não se volta a eles (pelas ligações da navegação). */
function trapped(r: CompileResult): string[] {
  const nav = r.nav;
  const n = nav.nodeCount;
  const fwd = new Uint8Array(n);
  const back = new Uint8Array(n);
  const into: number[][] = Array.from({ length: n }, () => []);
  for (let a = 0; a < n; a++)
    for (let l = nav.linkStart[a]!; l < nav.linkStart[a + 1]!; l++) into[nav.linkTarget[l]!]!.push(a);
  const flood = (mark: Uint8Array, next: (u: number, visit: (w: number) => void) => void): void => {
    const queue: number[] = [];
    for (const s of r.doc.markers.spawns) {
      const i = nav.nearestNode(s.x, s.y, s.z);
      if (i >= 0 && mark[i] === 0) {
        mark[i] = 1;
        queue.push(i);
      }
    }
    for (let q = 0; q < queue.length; q++) {
      next(queue[q]!, (w) => {
        if (mark[w] === 0) {
          mark[w] = 1;
          queue.push(w);
        }
      });
    }
  };
  flood(fwd, (u, visit) => {
    for (let l = nav.linkStart[u]!; l < nav.linkStart[u + 1]!; l++) visit(nav.linkTarget[l]!);
  });
  flood(back, (u, visit) => {
    for (const w of into[u]!) visit(w);
  });
  const area = r.doc.markers.playArea;
  const pos = new Float64Array(3);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    if (fwd[i] === 0 || back[i] === 1) continue;
    nav.nodePosition(i, pos);
    if (pos[0]! < area.minX || pos[0]! > area.maxX || pos[2]! < area.minZ || pos[2]! > area.maxZ) continue;
    out.push(`(${pos[0]}, ${pos[1]}, ${pos[2]})`);
  }
  return out;
}

describe('mapc: os poleiros de pulo do Construto e da Base Bobo (M11, fase 1)', () => {
  for (const script of [construto, airbase]) {
    it(`${script.id}: nenhum topo só do pulo correndo, sem aviso de visada de pulo e sem nó preso`, () => {
      expect(script.analysis?.jumpSightTodo).toBeUndefined();
      const r = compile(script);
      expect(r.errors).toEqual([]);
      expect(r.warnings.filter((w) => w.includes('pulo'))).toEqual([]);
      expect(r.checks.jumpReach.nodes).toBe(0);
      expect(r.checks.jumpReach.tops).toEqual([]);
      expect(r.checks.jumpReach.sight).toBeNull();
      expect(r.checks.sight.max!.distance).toBeLessThanOrEqual(r.doc.meta.maxSightLineM);
      expect(trapped(r)).toEqual([]);
      // O que o `npm run mapc` gravou é o que o script monta hoje.
      const disk = new Uint8Array(readFileSync(join(MAPS_OUT_DIR, `${script.id}.bfmap`)));
      expect(Buffer.from(disk).equals(Buffer.from(r.bytes))).toBe(true);
      expect(decodeMap(disk).id).toBe(script.id);
      // Compila o mapa inteiro: a análise da linha de visão leva dezenas de segundos no Vitest e mais com o portão.
    }, 240_000);
  }

  it('construto: o poço ao lado da escada da torre (x 42–44, z 39–44) virou maciço até o patamar A', () => {
    const r = compile(construto);
    const nav = r.nav;
    const pos = new Float64Array(3);
    const inPit: number[] = [];
    const onTop: number[] = [];
    for (let i = 0; i < nav.nodeCount; i++) {
      nav.nodePosition(i, pos);
      if (pos[0]! < 42 || pos[0]! > 44 || pos[2]! < 39 || pos[2]! > 44) continue;
      if (pos[1]! < 4) inPit.push(pos[1]!);
      else if (pos[1]! === 4) onTop.push(i);
    }
    // Nenhum nó no fundo (era o chão a 1 m, 10 nós presos) e o topo do maciço é andável (ao menos a faixa de 1 m entre a
    // parede da torre e a tela da escada).
    expect(inPit).toEqual([]);
    expect(onTop.length).toBeGreaterThanOrEqual(5);
    // O topo liga andando ao patamar A (z 44–46, 4 m): é chão da navegação, não poleiro.
    const linked = onTop.some((i) => {
      for (let l = nav.linkStart[i]!; l < nav.linkStart[i + 1]!; l++) {
        nav.nodePosition(nav.linkTarget[l]!, pos);
        if (pos[2]! > 44 && pos[1]! === 4) return true;
      }
      return false;
    });
    expect(linked).toBe(true);
    // O fundo do poço não existe mais na grade: a coluna do meio é maciça do chão (1 m) ao patamar (4 m).
    const cell = (m: number): number => Math.floor(m / 0.5);
    for (let y = 1; y < 4; y += 0.5) expect(r.grid.get(cell(43), cell(y), cell(41.5)), `y = ${y}`).not.toBe(0);
  }, 240_000);

  it('construto: as telas do lance da torre têm o topo reto, acima do pulo mais alto dali', () => {
    // O passe de pulos só vê nós da navegação, e a sim deixa pousar por CIMA de tela (o painel não é degrau nem se
    // escala, mas dá pé). A 1ª versão acompanhava os degraus, 2 m acima de cada um, e quem pulava do degrau de cima para
    // baixo pousava nela (revisão). O pulo mais alto dali sai do patamar C (9 m) e leva os pés a 10,0 m: o topo reto
    // fica a 11 m, ao longo do lance todo (os pulos na sim: packages/game/src/scene/tower-jumps.test.ts).
    expect(TOWER_SCREEN_TOP).toBeGreaterThanOrEqual(9 + METRICS.jumpHeight + 0.5);
    const r = compile(construto);
    const cell = (m: number): number => Math.round(m * 2);
    const block = (x: number, y: number, z: number): string | null => {
      const c = r.grid.get(x, y, z);
      return c === 0 ? null : r.doc.blocks[c & 0x3ff]!;
    };
    const top = cell(TOWER_SCREEN_TOP) - 1;
    for (let z = cell(39); z < cell(44); z++) {
      for (const x of [cell(43.5), cell(46)]) {
        expect(block(x, top, z), `(${x / 2}, ${z / 2})`).toBe('fence-wire');
        expect(block(x, top + 1, z), `(${x / 2}, ${z / 2})`).toBeNull();
        // Sem vão do topo para baixo até o degrau (ou o maciço): nenhum degrau da tela fica abaixo do topo.
        for (let y = cell(9); y <= top; y++)
          expect(block(x, y, z), `(${x / 2}, ${y / 2}, ${z / 2})`).toBe('fence-wire');
      }
    }
  }, 240_000);
});
