// Onde cada módulo de código foi parar no build (porte do boneco do FutBobo, decisão #56; PLANO do porte §B19 e risco
// 16): o motor de animação, o pintor e a tabela de jogo só servem à partida e NÃO podem cair no chunk do menu (a carga
// inicial). O JS minificado não diz de que módulo veio cada trecho; os sourcemaps dizem (`sources`). O CLI mede com os
// mapas do próprio dist quando existem, ou faz um build à parte com `--sourcemap hidden` numa pasta temporária (os
// chunks saem iguais: o modo `hidden` não escreve o comentário `sourceMappingURL`).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MENU_FORBIDDEN_MODULES } from './budgets.ts';
import type { DistReport } from './measure.ts';

/** Fontes de um sourcemap (v3), com `/` e o `sourceRoot` aplicado. Mapa quebrado = lista vazia. */
export function sourcesOf(mapText: string): string[] {
  let map: { sources?: unknown; sourceRoot?: unknown };
  try {
    map = JSON.parse(mapText) as { sources?: unknown; sourceRoot?: unknown };
  } catch {
    return [];
  }
  const root =
    typeof map.sourceRoot === 'string' && map.sourceRoot !== '' ? `${map.sourceRoot.replace(/\/?$/, '/')}` : '';
  const list = Array.isArray(map.sources) ? map.sources : [];
  return list.filter((s): s is string => typeof s === 'string').map((s) => `${root}${s}`.replace(/\\/g, '/'));
}

export interface ForbiddenPlacement {
  readonly label: string;
  /** Chunks JS (caminho no dist) que contêm algum módulo do grupo; vazio = fora do build (ou ainda não existe). */
  readonly chunks: readonly string[];
  /** Os que são da carga inicial: precisa ficar vazio. */
  readonly initialChunks: readonly string[];
  /** Módulos do grupo achados nos chunks iniciais (para o relatório). */
  readonly initialModules: readonly string[];
}

export interface ModuleCheck {
  /** JS do dist cujo sourcemap foi lido. */
  readonly mapped: readonly string[];
  /** JS da carga inicial SEM sourcemap: a checagem não vale para eles. */
  readonly unmapped: readonly string[];
  readonly placements: readonly ForbiddenPlacement[];
  /** Tudo certo: todo JS inicial tem mapa e nenhum módulo proibido caiu nele. */
  readonly ok: boolean;
}

/**
 * Lê os sourcemaps (`<chunk>.js.map`) dos JS do dist e diz onde caiu cada grupo de `MENU_FORBIDDEN_MODULES`. `dist`
 * é a pasta com os mapas (o próprio dist ou o build à parte); `report` é a medição dela.
 */
export function checkMenuModules(
  dist: string,
  report: DistReport,
  forbidden: readonly { readonly label: string; readonly test: RegExp }[] = MENU_FORBIDDEN_MODULES,
): ModuleCheck {
  const initial = new Set(report.initial.map((f) => f.path));
  const sources = new Map<string, readonly string[]>();
  const unmapped: string[] = [];
  for (const file of report.files) {
    if (!/\.m?js$/.test(file.path)) continue;
    const mapPath = join(dist, `${file.path}.map`);
    if (existsSync(mapPath)) sources.set(file.path, sourcesOf(readFileSync(mapPath, 'utf8')));
    else if (initial.has(file.path)) unmapped.push(file.path);
  }
  const placements = forbidden.map((group): ForbiddenPlacement => {
    const chunks: string[] = [];
    const initialModules: string[] = [];
    for (const [chunk, list] of sources) {
      const hits = list.filter((s) => group.test.test(s));
      if (hits.length === 0) continue;
      chunks.push(chunk);
      if (initial.has(chunk)) initialModules.push(...hits);
    }
    return { label: group.label, chunks, initialChunks: chunks.filter((c) => initial.has(c)), initialModules };
  });
  return {
    mapped: [...sources.keys()],
    unmapped,
    placements,
    ok: unmapped.length === 0 && placements.every((p) => p.initialChunks.length === 0),
  };
}

/** Texto do relatório: um grupo por linha, com o chunk onde caiu. */
export function formatModuleCheck(check: ModuleCheck): string {
  const lines = ['', '  Módulos do boneco fora do chunk do menu (#56):'];
  for (const p of check.placements) {
    const status = (p.initialChunks.length > 0 ? 'NO MENU' : 'ok').padEnd(8);
    const where =
      p.initialChunks.length > 0
        ? `no menu: ${p.initialChunks.join(', ')} (${p.initialModules.join(', ')})`
        : p.chunks.length > 0
          ? `em ${p.chunks.join(', ')}`
          : 'fora do build (não existe ou não é usado ainda)';
    lines.push(`  ${status} ${p.label}: ${where}`);
  }
  if (check.unmapped.length > 0) {
    lines.push(`  SEM MAPA  JS da carga inicial sem sourcemap: ${check.unmapped.join(', ')} (a checagem não vale)`);
  }
  return lines.join('\n');
}
