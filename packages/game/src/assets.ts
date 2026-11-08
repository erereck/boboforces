import { decodePng } from '@boboforces/format';
import type { Assets } from '@boboforces/platform-api';
import { createUiAtlas, parseFontPack, type FontPack, type UiAtlasImage } from '@boboforces/ui';

/**
 * Caminhos LÓGICOS dos assets do boot (regra 3): só as fontes da UI (o menu). A casca resolve: web
 * `<base>/assets/<caminho>`, Switch `romfs:/assets/<caminho>`. De onde cada um sai no build está em
 * `assets-src/runtime-assets.json`; os da cena (Construto, texturas, modelos, skins) estão em `assets-m1.ts` e chegam
 * no loading da cena.
 */
export const GAME_ASSETS = {
  fontsJson: 'fonts/ui-fonts.json',
  fontsPng: 'fonts/ui-fonts.png',
} as const;

export interface GameAssets {
  readonly fonts: FontPack;
  /** Atlas da UI (fontes MSDF) para `Renderer.setUiAtlas`. */
  readonly uiAtlas: UiAtlasImage;
}

/**
 * Carrega as fontes e o atlas da UI pela `platform.assets`, em paralelo, e decodifica o PNG com o decodificador próprio
 * do `format` (nada de `Image`/`TextureLoader`, tecnico.md §6.1). `onProgress` vai de 0 a 1.
 */
export async function loadGameAssets(assets: Assets, onProgress?: (fraction: number) => void): Promise<GameAssets> {
  let done = 0;
  const total = 2;
  const track = <T>(p: Promise<T>): Promise<T> =>
    p.then((value) => {
      done++;
      onProgress?.(done / total);
      return value;
    });
  const [fontsText, fontsPng] = await Promise.all([
    track(assets.loadText(GAME_ASSETS.fontsJson)),
    track(assets.loadBytes(GAME_ASSETS.fontsPng)),
  ]);
  const fonts = parseFontPack(JSON.parse(fontsText) as unknown);
  const uiAtlas = createUiAtlas(fonts, decodePng(fontsPng).data);
  return { fonts, uiAtlas };
}
