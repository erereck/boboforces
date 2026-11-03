import { decodePng } from '@boboforces/format';
import type { Assets } from '@boboforces/platform-api';
import { textureArrayFromStrip, type TextureArrayData } from '@boboforces/render/data';
import { createUiAtlas, parseFontPack, type FontPack, type UiAtlasImage } from '@boboforces/ui';

/**
 * Caminhos LÓGICOS dos assets do M0 (regra 3). A casca resolve: web `<base>/assets/<caminho>`, Switch
 * `romfs:/assets/<caminho>`. De onde cada um sai no build está em `assets-src/runtime-assets.json`.
 */
export const GAME_ASSETS = {
  fontsJson: 'fonts/ui-fonts.json',
  fontsPng: 'fonts/ui-fonts.png',
  blocksJson: 'textures/blocos16.json',
  blocksPng: 'textures/blocos16.png',
} as const;

/** Manifesto do array `blocos16` gerado pelo `tools/texgen` (camadas na ordem da tira). */
export interface BlockTextureManifest {
  readonly name: string;
  readonly layerWidth: number;
  readonly layerHeight: number;
  readonly layers: readonly { readonly name: string; readonly kind: string }[];
}

export interface GameAssets {
  readonly fonts: FontPack;
  /** Atlas da UI (fontes MSDF) para `Renderer.setUiAtlas`. */
  readonly uiAtlas: UiAtlasImage;
  readonly blockTextures: TextureArrayData;
  /** Nome da camada → índice no `blocos16` (os blocos são montados pelo nome, nunca pelo número). */
  readonly blockLayers: ReadonlyMap<string, number>;
}

function fail(message: string): never {
  throw new Error(`assets: ${message}`);
}

/** Valida o JSON do texgen e devolve o mapa nome → camada. */
export function parseBlockManifest(json: unknown): { manifest: BlockTextureManifest; layers: Map<string, number> } {
  if (typeof json !== 'object' || json === null) fail('manifesto de blocos vazio');
  const m = json as Record<string, unknown>;
  const layerWidth = m['layerWidth'];
  const layerHeight = m['layerHeight'];
  const list = m['layers'];
  if (typeof layerWidth !== 'number' || typeof layerHeight !== 'number' || !Array.isArray(list)) {
    fail('manifesto de blocos sem layerWidth/layerHeight/layers');
  }
  const layers = new Map<string, number>();
  const out: { name: string; kind: string }[] = [];
  list.forEach((entry: unknown, i) => {
    const e = entry as Record<string, unknown> | null;
    const name = e?.['name'];
    if (typeof name !== 'string' || name.length === 0) fail(`camada ${i} sem nome`);
    if (layers.has(name)) fail(`camada "${name}" repetida`);
    layers.set(name, i);
    out.push({ name, kind: typeof e?.['kind'] === 'string' ? e['kind'] : 'opaque' });
  });
  const name = typeof m['name'] === 'string' ? m['name'] : 'blocos16';
  return { manifest: { name, layerWidth, layerHeight, layers: out }, layers };
}

/**
 * Carrega fontes, atlas da UI e o array de blocos pela `platform.assets`, em paralelo, e decodifica os PNG com o
 * decodificador próprio do `format` (nada de `Image`/`TextureLoader`, tecnico.md §6.1). `onProgress` vai de 0 a 1.
 */
export async function loadGameAssets(assets: Assets, onProgress?: (fraction: number) => void): Promise<GameAssets> {
  let done = 0;
  const total = 4;
  const track = <T>(p: Promise<T>): Promise<T> =>
    p.then((value) => {
      done++;
      onProgress?.(done / total);
      return value;
    });
  const [fontsText, fontsPng, blocksText, blocksPng] = await Promise.all([
    track(assets.loadText(GAME_ASSETS.fontsJson)),
    track(assets.loadBytes(GAME_ASSETS.fontsPng)),
    track(assets.loadText(GAME_ASSETS.blocksJson)),
    track(assets.loadBytes(GAME_ASSETS.blocksPng)),
  ]);

  const fonts = parseFontPack(JSON.parse(fontsText) as unknown);
  const uiAtlas = createUiAtlas(fonts, decodePng(fontsPng).data);

  const { manifest, layers } = parseBlockManifest(JSON.parse(blocksText) as unknown);
  const strip = decodePng(blocksPng);
  const blockTextures = textureArrayFromStrip(strip, manifest.layerWidth, manifest.layerHeight);
  if (blockTextures.layers !== manifest.layers.length) {
    fail(`blocos16 com ${blockTextures.layers} camadas na imagem e ${manifest.layers.length} no manifesto`);
  }
  return { fonts, uiAtlas, blockTextures, blockLayers: layers };
}
