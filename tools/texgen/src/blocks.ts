import { CONTENT_IDS } from '@boboforces/format';
import { BLOCK_DEFS_FORMAT, parseBlockDefs, type BlockSourceDef } from '@boboforces/world';
import type { LayerGroup } from './generate.ts';

/** Documento `blocks@1` (o que vai para `assets-src/blocks/generated/blocks.json`). */
export interface BlockDefsFile {
  readonly format: typeof BLOCK_DEFS_FORMAT;
  readonly blocks: readonly BlockSourceDef[];
}

/** IDs de bloco registrados no `format` (sem prefixo), na ordem do registro. */
export function registeredBlockKeys(): string[] {
  return CONTENT_IDS.filter((id) => id.startsWith('block:')).map((id) => id.slice('block:'.length));
}

/**
 * Confere as definições de bloco contra o contrato (`parseBlockDefs`) e contra as camadas de `blocos16`. Devolve a
 * lista de problemas em pt-BR (vazia = ok):
 * - toda face aponta a camada BASE de um grupo que existe (nada de `grass_b` ou `water#1` direto);
 * - o grupo tem pelo menos `variants` variantes e exatamente `frames` quadros (a conta do shader é
 *   base + variante·quadros + quadro);
 * - o tipo da camada bate com o passe do bloco: cutout só em bloco `cutout`, translúcida só em `translucent`,
 *   emissiva só em bloco `emissive` (e bloco emissivo tem pelo menos uma face emissiva);
 * - flags coerentes com a forma (cruz não é sólida nem andável; `cutout` e `translucent` não andam juntas);
 * - o ID está registrado em `CONTENT_IDS` ou na lista de pendentes; todo `block:*` registrado tem definição.
 */
export function validateBlockDefs(
  defs: readonly BlockSourceDef[],
  groups: ReadonlyMap<string, LayerGroup>,
  pending: readonly string[],
): string[] {
  const problems: string[] = [];
  try {
    parseBlockDefs({ format: BLOCK_DEFS_FORMAT, blocks: defs });
  } catch (e) {
    problems.push((e as Error).message);
  }
  const registered = new Set(registeredBlockKeys());
  const pendingSet = new Set(pending);
  for (const d of defs) {
    const where = `bloco "${d.key}"`;
    if (!registered.has(d.key) && !pendingSet.has(d.key)) {
      problems.push(`${where}: ID fora de CONTENT_IDS e da lista de pendentes`);
    }
    const flags = new Set(d.flags);
    const pass = flags.has('translucent') ? 'translucent' : flags.has('cutout') ? 'cutout' : 'opaque';
    if (flags.has('translucent') && flags.has('cutout')) problems.push(`${where}: cutout e translucent juntos`);
    if (d.shape === 'cross' && (flags.has('solid') || flags.has('walkable'))) {
      problems.push(`${where}: cruz não pode ser sólida nem andável`);
    }
    if ((d.shape === 'panel' || d.shape === 'postRail') && flags.has('walkable')) {
      problems.push(`${where}: ${d.shape} não é andável`);
    }
    if (flags.has('walkable') && !flags.has('solid')) problems.push(`${where}: andável sem ser sólido`);
    if (d.frames > 1 && !flags.has('animated')) problems.push(`${where}: ${d.frames} quadros sem a flag animated`);
    let emissiveFaces = 0;
    d.faces.forEach((face, i) => {
      const g = groups.get(face);
      if (!g) {
        problems.push(`${where}: face ${i} aponta "${face}", que não é a base de nenhuma camada de blocos16`);
        return;
      }
      if (g.variants < d.variants) {
        problems.push(`${where}: face ${i} ("${face}") tem ${g.variants} variante(s), o bloco pede ${d.variants}`);
      }
      if (g.frames !== d.frames) {
        problems.push(`${where}: face ${i} ("${face}") tem ${g.frames} quadro(s), o bloco declara ${d.frames}`);
      }
      if (g.kind === 'emissive') emissiveFaces++;
      const layerPass = g.kind === 'emissive' ? 'opaque' : g.kind;
      if (layerPass !== pass) {
        problems.push(`${where}: face ${i} ("${face}") é ${g.kind}, mas o bloco vai no passe ${pass}`);
      }
    });
    if (emissiveFaces > 0 && !flags.has('emissive')) problems.push(`${where}: camada emissiva sem a flag emissive`);
    if (flags.has('emissive') && emissiveFaces === 0) problems.push(`${where}: emissivo sem nenhuma face emissiva`);
  }
  const defined = new Set(defs.map((d) => d.key));
  for (const key of registered) if (!defined.has(key)) problems.push(`block:${key} registrado e sem definição`);
  return problems;
}

/** Monta o documento `blocks@1`. */
export function buildBlockDefsFile(defs: readonly BlockSourceDef[]): BlockDefsFile {
  return { format: BLOCK_DEFS_FORMAT, blocks: defs };
}
