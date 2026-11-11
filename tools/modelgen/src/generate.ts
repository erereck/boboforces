import {
  contentIdsOfKind,
  encodeModelPack,
  encodePng,
  isKnownContentId,
  modelTriangleCount,
  TEXTURE_ARRAYS,
  validateModelPack,
  type ModelPack,
} from '@boboforces/format';
import { createPickupLayers, PICKUP_RECIPES } from '../../../assets-src/models/pickups.ts';
import { PROP_RECIPES } from '../../../assets-src/models/props.ts';
import { WEAPON_RECIPES } from '../../../assets-src/models/weapons.ts';
import { tone } from '../../skingen/src/palette.ts';
import {
  buildMipStrip,
  buildStrip,
  layerManifestJson,
  validateLayer,
  type StripLayer,
} from '../../skingen/src/strip.ts';
import { LayerCanvas, type BuiltModel } from './builder.ts';
import { MODELGEN_OUTPUTS } from './paths.ts';

/** Faixa de caixas por arma (arte-ux.md §3.2). */
export const WEAPON_BOX_RANGE = { min: 6, max: 20 } as const;

export interface ModelsBuild {
  /** Modelos que entram no pacote (ID registrado), na ordem das receitas. */
  readonly models: readonly BuiltModel[];
  /** Modelos prontos cujo ID ainda não está no registro de conteúdo (ficam fora do pacote, só na folha de contato). */
  readonly pending: readonly BuiltModel[];
  /** Camadas usadas pelos modelos do pacote, na ordem do primeiro uso. */
  readonly layers: readonly StripLayer[];
  readonly pack: ModelPack;
}

export function buildModels(): ModelsBuild {
  const glow = new LayerCanvas('mdl_glow', 'emissive', tone('emissivo', 1));
  // M3 (fase 5c): a camada dos modelos pequenos do Bobo Zombies (orçamento de 32 camadas).
  const pickupLayers = createPickupLayers();
  const all: BuiltModel[] = [
    ...WEAPON_RECIPES.map((r) => r()),
    ...PROP_RECIPES.map((r) => r({ glow })),
    ...PICKUP_RECIPES.map((r) => r(pickupLayers)),
  ];
  // Pacote na ordem do registro de conteúdo: o M2 acrescentou armas no FIM do registro, então os índices das props do
  // M1 não mudam (e a ordem das camadas segue a dos modelos).
  const order = contentIdsOfKind('model');
  const models = all
    .filter((m) => isKnownContentId(`model:${m.doc.id}`))
    .sort((x, y) => order.indexOf(x.doc.id) - order.indexOf(y.doc.id));
  const pending = all.filter((m) => !models.includes(m));
  const canvases: LayerCanvas[] = [];
  for (const m of models) for (const l of m.layers) if (!canvases.includes(l)) canvases.push(l);
  for (const l of canvases) l.dilate();
  for (const m of pending) for (const l of m.layers) if (!canvases.includes(l)) l.dilate();
  const layers: StripLayer[] = canvases.map((l) => ({
    name: l.name,
    kind: l.kind,
    cutout: l.kind === 'cutout',
    image: l.image,
  }));
  return { models, pending, layers, pack: { models: models.map((m) => m.doc) } };
}

/**
 * Regras do modelgen além do `validateModelPack` do format: camada existe na tira, camada válida (paleta mestra, 64×64,
 * alfa 0/255), arma com 6 a 20 caixas, nomes de camada únicos, teto de camadas do `modelos64` respeitado.
 */
export function validateModels(build: ModelsBuild): string[] {
  const names = new Set(build.layers.map((l) => l.name));
  const problems = [...validateModelPack(build.pack, names)];
  if (names.size !== build.layers.length) problems.push('camadas com nome repetido');
  problems.push(...build.layers.flatMap((l) => validateLayer(l, TEXTURE_ARRAYS.modelos64.layerSize)));
  for (const m of build.pack.models) {
    if (m.kind !== 'weapon') continue;
    const boxes = m.parts.reduce((n, p) => n + p.boxes.length, 0);
    if (boxes < WEAPON_BOX_RANGE.min || boxes > WEAPON_BOX_RANGE.max) {
      problems.push(`model:${m.id}: ${boxes} caixas (arma usa ${WEAPON_BOX_RANGE.min} a ${WEAPON_BOX_RANGE.max})`);
    }
  }
  if (build.layers.length > TEXTURE_ARRAYS.modelos64.maxLayers / 4) {
    problems.push(
      `${build.layers.length} camadas de modelo (orçamento do M1: ${TEXTURE_ARRAYS.modelos64.maxLayers / 4})`,
    );
  }
  return problems;
}

/** Resumo por modelo (para o log e a folha de contato). */
export function modelSummary(m: BuiltModel): string {
  const boxes = m.doc.parts.reduce((n, p) => n + p.boxes.length, 0);
  const meshes = m.doc.parts.reduce((n, p) => n + p.meshes.length, 0);
  return `${m.doc.id}: ${modelTriangleCount(m.doc)} tri, ${boxes} caixas, ${meshes} malhas, ${m.doc.parts.length} peças`;
}

/** Tudo o que o modelgen grava em `assets-src/models/generated/`. Lança se a validação reprovar. */
export function buildModelOutputs(): { files: Map<string, Uint8Array>; build: ModelsBuild } {
  const build = buildModels();
  const problems = validateModels(build);
  if (problems.length > 0) throw new Error(`modelgen: validação reprovou:\n- ${problems.join('\n- ')}`);
  const spec = TEXTURE_ARRAYS.modelos64;
  const files = new Map<string, Uint8Array>();
  files.set(MODELGEN_OUTPUTS.pack, encodeModelPack(build.pack));
  files.set(MODELGEN_OUTPUTS.layersPng, encodePng(buildStrip(build.layers, spec.layerSize)));
  files.set(MODELGEN_OUTPUTS.layersMips, encodePng(buildMipStrip(build.layers, spec.layerSize, spec.mipLevels)));
  files.set(
    MODELGEN_OUTPUTS.layersJson,
    new TextEncoder().encode(layerManifestJson('modelos64', 'modelgen', build.layers)),
  );
  return { files, build };
}
