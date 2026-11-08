import { BLOCK_DEFS, PENDING_BLOCK_IDS } from '../../../assets-src/blocks/blocks.ts';
import { BLOCK_TEXTURES } from '../../../assets-src/textures/blocks16.ts';
import { MODEL_MATERIAL_TEXTURES } from '../../../assets-src/textures/modelos64.ts';
import { buildBlockDefsFile, validateBlockDefs } from './blocks.ts';
import { buildContactSheet } from './contact.ts';
import { buildStripAssets, layerGroups, type BuiltStrip, type StripSpec } from './generate.ts';
import { formatJson } from './json.ts';
import { encodePng, type RgbaImage } from './png.ts';

/**
 * O que o texgen grava, por caminho relativo à raiz do repositório (pastas da frente "texturas"):
 * - `assets-src/textures/generated/blocos16.{png,mips.png,json}`: a tira do array de blocos (`layers@1`);
 * - `assets-src/textures/generated/modelos64-materiais.{png,mips.png,json}`: a 1ª tira do array de modelos
 *   (camada branca dos detritos + materiais do cenário em tile 64×64);
 * - `assets-src/textures/generated/blocks/<camada>.png`: cada camada de bloco solta (revisão e diff);
 * - `assets-src/blocks/generated/blocks.json`: as definições `blocks@1`.
 * A folha de contato (`local/m1/texturas.png`) é privada e sai à parte (`buildContactSheet`).
 */
export const TEXGEN_OUTPUT_DIRS = ['assets-src/textures/generated', 'assets-src/blocks/generated'] as const;
export const CONTACT_SHEET_PATH = 'local/m1/texturas.png';

export const BLOCK_STRIP: StripSpec = { array: 'blocos16', file: 'blocos16', recipes: BLOCK_TEXTURES };
export const MODEL_MATERIALS_STRIP: StripSpec = {
  array: 'modelos64',
  file: 'modelos64-materiais',
  recipes: MODEL_MATERIAL_TEXTURES,
};

export interface TexgenBuild {
  readonly blocks: BuiltStrip;
  readonly materials: BuiltStrip;
  /** Caminho relativo à raiz → bytes. */
  readonly files: ReadonlyMap<string, Uint8Array>;
}

const png = (image: RgbaImage): Uint8Array => encodePng(image, { dropOpaqueAlpha: true });
const json = (value: unknown): Uint8Array => new TextEncoder().encode(formatJson(value));

/** Arquivo solto de uma camada (`water#1` vira `water-f1.png`: `#` não é bom em nome de arquivo). */
export function layerFileName(name: string): string {
  return name.replace('#', '-f') + '.png';
}

function stripFiles(files: Map<string, Uint8Array>, strip: BuiltStrip): void {
  const base = `assets-src/textures/generated/${strip.spec.file}`;
  files.set(`${base}.png`, png(strip.level0));
  files.set(`${base}.mips.png`, png(strip.mipsImage));
  files.set(`${base}.json`, json(strip.manifest));
}

/** Gera, valida e codifica tudo (lança com a lista de problemas se algo reprovar). */
export function buildTexgen(): TexgenBuild {
  const blocks = buildStripAssets(BLOCK_STRIP);
  const materials = buildStripAssets(MODEL_MATERIALS_STRIP);
  const problems = validateBlockDefs(BLOCK_DEFS, layerGroups(blocks.layers), PENDING_BLOCK_IDS);
  if (problems.length > 0) throw new Error(`texgen: definições de bloco reprovaram:\n- ${problems.join('\n- ')}`);
  const files = new Map<string, Uint8Array>();
  stripFiles(files, blocks);
  stripFiles(files, materials);
  for (const l of blocks.layers)
    files.set(`assets-src/textures/generated/blocks/${layerFileName(l.name)}`, png(l.image));
  files.set('assets-src/blocks/generated/blocks.json', json(buildBlockDefsFile(BLOCK_DEFS)));
  return { blocks, materials, files };
}

/** PNG da folha de contato. */
export function buildContactSheetPng(build: TexgenBuild): Uint8Array {
  return encodePng(buildContactSheet([build.blocks, build.materials]), { dropOpaqueAlpha: true });
}
