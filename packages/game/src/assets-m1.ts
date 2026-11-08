import type { TextureArrayName } from '@boboforces/format';

/**
 * Caminhos LÓGICOS dos assets do M1 (regra 3), todos cadastrados em `assets-src/runtime-assets.json` (contrato da
 * etapa de contratos; quem gera cada arquivo está no docs/ARCHITECTURE.md §M1). O loading da integração usa estes.
 *
 * Texture arrays: cada BASE expande em `<base>.png` (nível 0), `<base>.mips.png` (níveis 1..n) e `<base>.json`
 * (manifesto `layers@1`); a ordem das bases é a ordem das tiras no array (a mesma de `arrays` no runtime-assets.json).
 *
 * #56 (porte do boneco do FutBobo): a folha de rostos do bobo A (`skins/modelos64-rostos`) e a biblioteca de partes
 * (`partes64`) saíram do jogo e do runtime-assets.json no passo 5; o rosto e as expressões estão na skin de 2 camadas
 * que o `paintFigureSkin` pinta no loading.
 */
export const TEXTURE_ARRAY_BASES: Readonly<Record<TextureArrayName, readonly string[]>> = {
  blocos16: ['textures/blocos16'],
  modelos64: ['textures/modelos64-materiais', 'models/modelos64-modelos'],
};

export const GAME_ASSETS_M1 = {
  /** Definições de bloco (`blocks@1`, faces por nome; frente texturas). */
  blocks: 'blocks/blocks.json',
  /** Pacote de modelos (`model@1`; frente skins-modelos). */
  models: 'models/modelos.bfmodel',
  /** O Construto (`map@1`; frente mapa-nav). */
  construto: 'maps/construto.bfmap',
  /** Sons do teste de áudio do T0 (item 19; MP3 convertidos dos CC0 da Kenney; frente switch-audio). */
  audioShot: 'audio/t0-tiro.mp3',
  audioImpact: 'audio/t0-impacto.mp3',
  audioStep: 'audio/t0-passo.mp3',
  audioUi: 'audio/t0-ui.mp3',
} as const;

/** Os 3 arquivos de uma base de texture array. */
export function textureStripPaths(base: string): {
  readonly png: string;
  readonly mips: string;
  readonly json: string;
} {
  return { png: `${base}.png`, mips: `${base}.mips.png`, json: `${base}.json` };
}
