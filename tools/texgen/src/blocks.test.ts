import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseLayerManifest } from '@boboforces/format';
import {
  BLOCK_FLAG,
  createMapBlockRegistry,
  parseBlockDefs,
  resolveBlockDefs,
  SHAPE_ID,
  type BlockSourceDef,
} from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { BLOCK_DEFS, PENDING_BLOCK_IDS, STEP_SOUNDS } from '../../../assets-src/blocks/blocks.ts';
import { registeredBlockKeys, validateBlockDefs } from './blocks.ts';
import { buildStripAssets, layerGroups } from './generate.ts';
import { BLOCK_STRIP } from './outputs.ts';

const root = resolve(import.meta.dirname, '../../..');
const strip = buildStripAssets(BLOCK_STRIP);
const groups = layerGroups(strip.layers);
const byKey = (key: string): BlockSourceDef => BLOCK_DEFS.find((d) => d.key === key)!;

describe('definições de bloco (blocks@1)', () => {
  it('passam no contrato e nas regras de camada, variante, quadro e passe', () => {
    expect(validateBlockDefs(BLOCK_DEFS, groups, PENDING_BLOCK_IDS)).toEqual([]);
  });

  it('cobrem todos os block:* registrados; os novos estão na lista de pedidos de registro', () => {
    const keys = BLOCK_DEFS.map((d) => d.key);
    for (const k of registeredBlockKeys()) expect(keys, k).toContain(k);
    const registered = new Set(registeredBlockKeys());
    for (const k of keys) if (!registered.has(k)) expect(PENDING_BLOCK_IDS, k).toContain(k);
  });

  it('materiais de gameplay seguem o GDD §4.6.1', () => {
    const has = (key: string, flag: string): boolean => (byKey(key).flags as readonly string[]).includes(flag);
    // Cerca de arame: bloqueia movimento, deixa passar bala e visão.
    expect(has('fence-wire', 'solid') && !has('fence-wire', 'blocksBullets') && !has('fence-wire', 'blocksSight')).toBe(
      true,
    );
    // Cerca de madeira fechada: bloqueia tudo.
    for (const f of ['solid', 'blocksBullets', 'blocksSight']) expect(has('fence-wood', f), f).toBe(true);
    // Vegetação em cruz: não bloqueia nada.
    for (const k of ['tall-grass', 'flowers', 'bush']) {
      expect(byKey(k).shape).toBe('cross');
      for (const f of ['solid', 'blocksBullets', 'blocksSight', 'walkable']) expect(has(k, f), `${k} ${f}`).toBe(false);
    }
    expect(byKey('water').frames).toBe(4);
    expect(byKey('lamp').emissive).toBeGreaterThan(byKey('exit-sign').emissive);
    for (const d of BLOCK_DEFS) expect(['', ...STEP_SOUNDS], d.key).toContain(d.stepSound);
  });

  it('o letreiro PERIGO cruza as faces para ler certo dos dois lados', () => {
    // FACE: +X, −X, +Y, −Y, +Z, −Z. Visto de +Z a tangente é +X (A à esquerda); visto de −Z, é −X (B à esquerda).
    expect(byKey('danger-sign-a').faces[4]).toBe('danger_sign_a');
    expect(byKey('danger-sign-b').faces[4]).toBe('danger_sign_b');
    expect(byKey('danger-sign-a').faces[5]).toBe('danger_sign_b');
    expect(byKey('danger-sign-b').faces[5]).toBe('danger_sign_a');
    // Ao longo de Z: visto de +X a tangente é −Z (B à esquerda); visto de −X, é +Z (A à esquerda).
    expect(byKey('danger-sign-b').faces[0]).toBe('danger_sign_a');
    expect(byKey('danger-sign-a').faces[1]).toBe('danger_sign_a');
  });

  it('o validador pega face inexistente, variante faltando, quadro errado e passe trocado', () => {
    const base = byKey('concrete');
    const check = (d: BlockSourceDef): string =>
      validateBlockDefs([...BLOCK_DEFS.filter((b) => b.key !== d.key), d], groups, PENDING_BLOCK_IDS).join('\n');
    expect(check({ ...base, faces: ['nada', 'concrete', 'concrete', 'concrete', 'concrete', 'concrete'] })).toMatch(
      /nada/,
    );
    expect(check({ ...base, faces: ['grass_b', 'concrete', 'concrete', 'concrete', 'concrete', 'concrete'] })).toMatch(
      /grass_b/,
    );
    expect(check({ ...base, variants: 5 })).toMatch(/variante/);
    expect(check({ ...byKey('water'), frames: 2 })).toMatch(/quadro/);
    expect(check({ ...byKey('fence-wire'), flags: ['solid'] })).toMatch(/passe opaque/);
    expect(check({ ...byKey('lamp'), flags: ['solid'], emissive: 0 })).toMatch(/emissiva sem a flag/);
    expect(check({ ...byKey('tall-grass'), flags: ['cutout', 'solid'] })).toMatch(/cruz/);
    expect(check({ ...base, key: 'inventado' })).toMatch(/fora de CONTENT_IDS/);
  });

  it('o blocks.json gravado carrega no world: faces resolvem pelo manifesto e o registro monta', () => {
    const doc: unknown = JSON.parse(readFileSync(join(root, 'assets-src/blocks/generated/blocks.json'), 'utf8'));
    const manifest = parseLayerManifest(
      JSON.parse(readFileSync(join(root, 'assets-src/textures/generated/blocos16.json'), 'utf8')),
    );
    const layerIndex = new Map(manifest.layers.map((l, i) => [l.name, i]));
    const missingLayers: string[] = [];
    const defs = resolveBlockDefs(parseBlockDefs(doc), (n) => layerIndex.get(n), missingLayers);
    expect(missingLayers).toEqual([]);
    const table = ['air', ...defs.map((d) => d.key)];
    const missingBlocks: string[] = [];
    const registry = createMapBlockRegistry(table, new Map(defs.map((d) => [d.key, d])), missingBlocks);
    expect(missingBlocks).toEqual([]);
    const water = registry.byKey('water')!;
    expect(water.flags & BLOCK_FLAG.animated).not.toBe(0);
    expect(manifest.layers.slice(water.faces[2], water.faces[2] + 4).map((l) => l.name)).toEqual([
      'water',
      'water#1',
      'water#2',
      'water#3',
    ]);
    const grass = registry.byKey('grass')!;
    expect(manifest.layers[grass.faces[0] + 2]!.name).toBe('grass_side_c');
    expect(registry.shapes[registry.byKey('railing')!.id]).toBe(SHAPE_ID.postRail);
    expect(registry.emissive[registry.byKey('light-panel')!.id]).toBe(14);
  });
});
