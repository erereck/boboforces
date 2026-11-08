import { PLAYABLE_PROP_DOSE } from '@boboforces/format';
import { ARM_HIT_CUT_M } from '@boboforces/sim';
import type { LimbThroughStats } from './checks.ts';
import type { CompileResult } from './compile.ts';

const kb = (n: number): string => `${(n / 1024).toFixed(1)} KB`;

/**
 * Linha da medida de membro através de barreira (J-M4): alcance, nós por postura e o que foi atravessado. `source` diz
 * de onde vem o alcance (o visual = as caixas da tabela de jogo; a hitbox = elas com o corte de braço da sim).
 */
function limb(name: string, source: string, t: LimbThroughStats): string {
  const reach = Object.entries(t.reachByStance)
    .map(([k, v]) => `${k} ${v.toFixed(2)}`)
    .join(', ');
  const stances = Object.entries(t.bulletsByStance)
    .map(([k, v]) => `${k} ${v}`)
    .join(', ');
  const by = Object.entries(t.by)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v}`)
    .join(', ');
  return (
    `${name} através de barreira (ponta até ${reach} m do centro, ${source}): ${t.bullets} nós com algo que ` +
    `para bala${stances ? ` (${stances})` : ''}, ${t.sightOnly} só com algo que tapa a visão${by ? `; ${by}` : ''}`
  );
}
const ms = (n: number): string => `${n.toFixed(n < 1 ? 3 : 1)} ms`;
const m = (n: number): string => `${n.toFixed(2)} m`;

/** Relatório legível do `mapc` (pt-BR), para o terminal e para o relatório da frente. */
export function formatReport(r: CompileResult): string {
  const s = r.stats;
  const c = r.checks;
  const lines: string[] = [];
  lines.push(`mapa ${r.id}: ${r.grid.sizeX}×${r.grid.sizeY}×${r.grid.sizeZ} células`);
  lines.push(`  arquivo: ${kb(s.bytes)} comprimido (${kb(s.rawBytes)} cru), ${s.blockTypes} tipos de bloco`);
  lines.push(
    `  grade: ${s.cells} células não vazias; ${s.chunks} chunks com bloco (${s.denseChunks} densos = ` +
      `${kb(s.gridMemoryBytes)} na memória)`,
  );
  // A dose é marca de autoria (print 3); entram no jogo as de dose ≤ `PLAYABLE_PROP_DOSE` (o dobro, #52).
  const playable = s.props.reduce((sum, n, dose) => (dose <= PLAYABLE_PROP_DOSE ? sum + n : sum), 0);
  lines.push(
    `  props: ${playable} no jogo (${s.props[0]} sempre + ${s.props[1]} proposta + ${s.props[2]} do dobro); ` +
      `${s.emitters} fontes de luz`,
  );
  const l = s.navLinks;
  lines.push(
    `  navegação: ${s.navNodes} nós (${c.playableNodes} jogáveis), ${s.navComponents} componentes; ligações ` +
      `walk ${l.walk}, step ${l.step}, jump ${l.jump}, drop ${l.drop}, crouch ${l.crouch}; montagem ${ms(s.navBuildMs)}`,
  );
  const sp = c.spawns;
  lines.push(`  spawns: ${sp.count} (TDM A ${sp.tdmA}, TDM B ${sp.tdmB}, FFA ${sp.ffa})`);
  lines.push(
    `  A* entre spawns: ${sp.astarPairs} buscas, média ${ms(sp.astarMeanMs)}, p99 ${ms(sp.astarP99Ms)}, máx ` +
      `${ms(sp.astarMaxMs)}`,
  );
  const [tMin, tAvg, tMax] = sp.tdmTravelS;
  lines.push(
    `  travessia TDM (correndo, até o spawn inimigo mais perto): ${tMin.toFixed(1)}–${tMax.toFixed(1)} s (média ${tAvg.toFixed(1)} s)`,
  );
  lines.push(
    `  cobertura (nós do térreo até o obstáculo de ≥ 1 m mais perto): mediana ${m(c.cover.median)}, p95 ` +
      `${m(c.cover.p95)}, máx ${m(c.cover.max)} (${c.cover.nodes} nós)`,
  );
  const max = c.sight.max;
  lines.push(
    `  maior linha de visão: medida ${max ? m(max.distance) : '—'} (declarada ${r.doc.meta.maxSightLineM} m); ` +
      `${c.sight.nodes} nós, ${c.sight.rays} raios, ${ms(s.sightMs)}`,
  );
  for (const line of c.sight.longest.slice(0, 5)) {
    const p = (v: readonly number[]): string => `(${v.map((x) => x.toFixed(1)).join(', ')})`;
    lines.push(`    ${m(line.distance)}: ${p(line.a)} → ${p(line.b)}`);
  }
  lines.push(
    `  cobertura rente à hitbox: ${c.lowCover} nós com cobertura de topo rente ao agachado, ${c.highCover} com ` +
      `cobertura alta abaixo da cabeça em pé; visto sem ver ${c.seenWithoutSeeing}`,
  );
  // Visual (o que aparece do outro lado) × hitbox (o que leva tiro de lá: braço cortado a `ARM_HIT_CUT_M`).
  const visual = 'visual: caixas da tabela de jogo, sem a arma';
  const hit = `hitbox: braço cortado a ${ARM_HIT_CUT_M.toFixed(2)} m do eixo`;
  lines.push(`  ${limb('braço armado', visual, c.armThrough)}`);
  lines.push(`  ${limb('braço armado', hit, c.armHitThrough)}`);
  lines.push(`  ${limb('corpo no deslize', visual, c.slideThrough)}`);
  lines.push(`  ${limb('corpo no deslize', hit, c.slideHitThrough)}`);
  lines.push(`  compilação: ${ms(s.compileMs)}`);
  for (const w of r.warnings) lines.push(`  aviso: ${w}`);
  for (const e of r.errors) lines.push(`  ERRO: ${e}`);
  return lines.join('\n');
}
