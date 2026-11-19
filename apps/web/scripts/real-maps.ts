// Os mapas de verdade no Node (M5 fase 7a): o `.bfmap` gerado, os blocos e os modelos de `assets-src/`, montados como a
// cena monta (`buildMapWorld` → `buildMapNav` → `buildSimMap`). Para o bench de rede e os testes da sala que jogam pela
// rede de mentira; nada daqui vai para o jogo.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeMap, decodeModelPack, parseLayerManifest } from '@boboforces/format';
import { buildMapNav, buildMapWorld, buildSimMap } from '@boboforces/game/scene';
import type { SimMap } from '@boboforces/sim';
import { parseBlockDefs } from '@boboforces/world';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const RUNTIME = JSON.parse(readFileSync(join(ROOT, 'assets-src', 'runtime-assets.json'), 'utf8')) as {
  files: Record<string, string>;
};
const asset = (logical: string): Uint8Array =>
  new Uint8Array(readFileSync(join(ROOT, 'assets-src', RUNTIME.files[logical]!)));
const text = (logical: string): string => new TextDecoder().decode(asset(logical));

const maps = new Map<string, SimMap>();

/** O mapa `id` (`construto`, `ringue`, `posto`, `base`) pronto para a sim, montado uma vez por processo. */
export function loadRealMap(id: string): SimMap {
  const known = maps.get(id);
  if (known) return known;
  const manifest = parseLayerManifest(JSON.parse(text('textures/blocos16.json')) as unknown);
  const layers = new Map(manifest.layers.map((l, i) => [l.name, i] as const));
  const world = buildMapWorld({
    map: decodeMap(asset(`maps/${id}.bfmap`)),
    blockDefs: parseBlockDefs(JSON.parse(text('blocks/blocks.json')) as unknown),
    blockLayer: (name) => layers.get(name),
    models: decodeModelPack(asset('models/modelos.bfmodel')).models,
  });
  const map = buildSimMap(world, buildMapNav(world));
  maps.set(id, map);
  return map;
}
