// M4 (fase 6a, P3): a arte do ícone do HOME, própria e sintética (nada baixado): a cabeça de um bobo em blocos, de
// capacete, com as cores do jogo (pele padrão do boneco, o verde da farda, o âmbar da ação) sobre o fundo do menu, e a
// barrinha âmbar chanfrada do título embaixo. Desenhada numa grade de 32×32 blocos; `npm run icon` (sem argumento)
// grava o `icon.jpg` a partir dela.

/** Uma imagem RGBA (o que o Jimp recebe). */
export interface IconBitmap {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

const GRID = 32;

const BUNKER = 0x0a0d0b;
const CHAPA = 0x121815;
const SKIN = 0xe5aa84;
const SKIN_SHADE = 0xc98f6c;
const HELMET = 0x556b3c;
const HELMET_LIGHT = 0x6b8450;
const HELMET_RIM = 0x3f5030;
const EYE = 0x1a1a1a;
const SHINE = 0xe8ede6;
const MOUTH = 0x7a3b2a;
const AMBER = 0xf2b233;

/** Os blocos (x0, y0, x1, y1 inclusivos, na grade 32×32) na ordem de pintura. */
const BLOCKS: readonly (readonly [number, number, number, number, number])[] = [
  // Fundo e a moldura escura.
  [0, 0, 31, 31, CHAPA],
  [1, 1, 30, 30, BUNKER],
  // A cabeça, com a sombra do lado direito e embaixo.
  [8, 10, 23, 24, SKIN],
  [22, 10, 23, 24, SKIN_SHADE],
  [8, 24, 23, 24, SKIN_SHADE],
  // O capacete: casco, brilho em cima e a aba.
  [9, 5, 22, 11, HELMET],
  [8, 7, 23, 11, HELMET],
  [11, 5, 18, 5, HELMET_LIGHT],
  [10, 6, 13, 6, HELMET_LIGHT],
  [6, 12, 25, 12, HELMET_RIM],
  // Os olhos, com o brilho.
  [11, 15, 12, 17, EYE],
  [19, 15, 20, 17, EYE],
  [11, 15, 11, 15, SHINE],
  [19, 15, 19, 15, SHINE],
  // O sorriso.
  [12, 20, 12, 20, MOUTH],
  [19, 20, 19, 20, MOUTH],
  [13, 21, 18, 21, MOUTH],
  // A barrinha âmbar do título, com o chanfro no canto de cima à direita.
  [8, 27, 22, 28, AMBER],
  [23, 28, 23, 28, AMBER],
];

/** Pinta a arte em `size` × `size` (múltiplo de 32). */
export function drawIconArt(size = 512): IconBitmap {
  if (size % GRID !== 0) throw new Error(`o ícone precisa de um tamanho múltiplo de ${GRID}`);
  const cell = size / GRID;
  const data = new Uint8Array(size * size * 4);
  for (const [x0, y0, x1, y1, rgb] of BLOCKS) {
    for (let y = y0 * cell; y < (y1 + 1) * cell; y++) {
      for (let x = x0 * cell; x < (x1 + 1) * cell; x++) {
        const o = (y * size + x) * 4;
        data[o] = (rgb >> 16) & 0xff;
        data[o + 1] = (rgb >> 8) & 0xff;
        data[o + 2] = rgb & 0xff;
        data[o + 3] = 0xff;
      }
    }
  }
  return { width: size, height: size, data };
}
