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
  /** M2 (fase 5c): o Ringue, arena pequena de treino. */
  ringue: 'maps/ringue.bfmap',
  /** M3 (fase 3d): o Posto Avançado, mapa pequeno do Bobo Zombies (janelas e porta paga). */
  posto: 'maps/posto.bfmap',
  /** M3 (fase 5a): a Base Abandonada, o mapa do Bobo Zombies (à noite). */
  base: 'maps/base.bfmap',
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

/** M2 (fase 5c): os mapas que a cena carrega, pelo id da receita (`map`); id desconhecido cai no Construto. */
export const MAP_ASSETS: Readonly<Record<string, string>> = {
  construto: GAME_ASSETS_M1.construto,
  ringue: GAME_ASSETS_M1.ringue,
  posto: GAME_ASSETS_M1.posto,
  base: GAME_ASSETS_M1.base,
};
