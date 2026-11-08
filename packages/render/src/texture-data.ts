// Imagem decodificada que os texture arrays recebem (sem three, testável em Node). As imagens chegam já decodificadas
// pelo PNG próprio do `format` (nunca `Image`/`ImageBitmap`/`TextureLoader`: tecnico.md §6.1 e §6.11). A montagem dos
// arrays do M1 é o `assembleTextureArray` (`texture-assets.ts`); as funções de tira do M0 saíram na integração do M1.

/** Imagem RGBA8 (forma de `DecodedImage` do `format`, sem depender do pacote). */
export interface RgbaImageLike {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}
