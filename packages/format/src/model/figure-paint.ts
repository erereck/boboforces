/**
 * Pintor puro da skin do boneco (decisão #56; PLANO do porte §B7, §B9, §B11 e §C3). Frente F2: porte da cabeça do
 * FutBobo (`textures.ts`) e das expressões extras do teste aprovado, a farda da decisão #58 (jaqueta no tecido do look,
 * colete, cinto, colunas de manga, antebraço, coxa e canela, bota de combate; `figure-paint-outfit.ts`), o zumbi, a
 * paleta de 16 amostras e o nível 1 em caixa 2×2, no layout de `figure-layout.ts`.
 *
 * Determinístico (sem `Math.random`/`Date`), sem objeto alocado por chamada quando o chamador reusa os buffers (a vista
 * Int32 do último buffer fica guardada até o `disposeFigurePaint`; buffer novo = 2 vistas) e com as tabelas feitas na
 * 1ª pintura do processo (a máscara de cada camuflado, na 1ª pintura dele). No interpretador (o proxy do Switch) as
 * contas de cor em float (as frações do FutBobo e as misturas dos tons da farda) ainda deixam ~6,5 KB de números em
 * caixa por skin, no loading. Só escreve nas regiões usadas (`FIGURE_PAINT_REGIONS`), sempre opaco; as áreas livres
 * e a reserva do capacete ficam como estavam (o dono do buffer as inicializa uma vez, se quiser a cobertura de alfa
 * cheia na GPU).
 */
import { FACE_EXPRESSIONS } from './bobo.ts';
import { FIGURE_SKIN_BYTES, FIGURE_SKIN_LEVEL1_BYTES, FIGURE_SWATCH } from './figure-layout.ts';
import { figureLockedColor, figureTeamColor, type FigureSkinRecipe } from './figure-look.ts';
import {
  copyGrid,
  EXPRESSION_MOOD,
  FIGURE_GOLD,
  gridOrigin,
  HEAD_COLOR,
  headColorTable,
  luminanceRgb,
  mixRgb,
  paintFaceBase,
  paintFaceMood,
  paintFaceTop,
  paintHeadBack,
  paintHeadBottom,
  paintHeadSide,
  paintHeadTop,
  releasePaintTarget,
  resolveHeadColors,
  setGrid,
  setPaintTarget,
  shadeRgb,
  texel,
} from './figure-paint-head.ts';
import {
  detailRgb,
  ensureOutfitMasks,
  fabricTones,
  paintBootCell,
  paintJacket,
  paintLimbColumns,
  paintVest,
} from './figure-paint-outfit.ts';
import {
  paintZombieFaceTrait,
  paintZombieRags,
  ZOMBIE_FADE,
  ZOMBIE_FADE_TO,
  ZOMBIE_GOO,
  zombieBandage,
  zombieKindSeed,
} from './figure-paint-zombie.ts';

/** Região retangular da skin em texels (canto par: o nível 1 é a mesma região pela metade). */
export interface FigurePaintRegion {
  readonly layer: number;
  readonly u: number;
  readonly v: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Regiões que o pintor escreve (nível 0), todas opacas. Camada 0: paleta + topo + base (0, 0, 48, 16) e os 4 lados +
 * as 8 expressões (0, 16, 64, 48); a (48, 0, 16, 16) fica livre. Camada 1: a cruz do tronco com as quinas de calha
 * (0, 0, 48, 32), canela + bota (48, 0, 16, 12) e as colunas de manga/antebraço/coxa com a calha (48, 12, 12, 12);
 * livres (60, 12, 4, 12), (48, 24, 16, 8) e a reserva do capacete (0, 32, 64, 32).
 */
export const FIGURE_PAINT_REGIONS: readonly FigurePaintRegion[] = [
  { layer: 0, u: 0, v: 0, w: 48, h: 16 },
  { layer: 0, u: 0, v: 16, w: 64, h: 48 },
  { layer: 1, u: 0, v: 0, w: 48, h: 32 },
  { layer: 1, u: 48, v: 0, w: 16, h: 12 },
  { layer: 1, u: 48, v: 12, w: 12, h: 12 },
];

/** Linhas de roupa antes da pele nas colunas de manga, antebraço e coxa: comum (inteiras) e zumbi (rasgadas). */
const LIMB_ROWS_PLAIN = 12;
const ZOMBIE_SLEEVE_ROWS = 9;
const ZOMBIE_FOREARM_ROWS = 6;
const ZOMBIE_THIGH_ROWS = 10;
const CELL = 16;

// --- Vistas Int32 dos buffers (guardadas: o skin-cache passa sempre os mesmos). Int32 e não Uint32: o texel opaco
// (alfa 0xff no byte alto) vira um inteiro pequeno negativo, que o V8 guarda sem caixa (Smi); em Uint32 cada texel
// passaria de 2^30 e alocaria um HeapNumber no interpretador (o proxy do Switch). ---

let lastOut: Uint8Array | null = null;
let lastOutWords: Int32Array | null = null;
let lastLevel1: Uint8Array | null = null;
let lastLevel1Words: Int32Array | null = null;

function words(bytes: Uint8Array, length: number, what: string): Int32Array {
  if (bytes.length < length) throw new Error(`figure-paint: ${what} tem ${bytes.length} bytes, precisa de ${length}`);
  if (bytes.byteOffset % 4 !== 0) throw new Error(`figure-paint: ${what} precisa começar alinhado a 4 bytes`);
  return new Int32Array(bytes.buffer, bytes.byteOffset, length / 4);
}

function outWords(out: Uint8Array): Int32Array {
  if (out !== lastOut || lastOutWords === null) {
    lastOutWords = words(out, FIGURE_SKIN_BYTES, 'out');
    lastOut = out;
  }
  return lastOutWords;
}

function level1Words(level1: Uint8Array): Int32Array {
  if (level1 !== lastLevel1 || lastLevel1Words === null) {
    lastLevel1Words = words(level1, FIGURE_SKIN_LEVEL1_BYTES, 'level1');
    lastLevel1 = level1;
  }
  return lastLevel1Words;
}

/**
 * Solta as vistas dos últimos buffers e o look que o pintor guarda entre chamadas (regra 21): sem isto o módulo
 * prende o último buffer do skin-cache (e o `ArrayBuffer` inteiro, se ele for uma fatia) depois do `dispose()` do
 * dono. O dono chama no `dispose()`; as tabelas de cor e as máscaras (poucos KB) ficam para o processo. Pintar de novo
 * depois funciona (as vistas são refeitas).
 */
export function disposeFigurePaint(): void {
  lastOut = null;
  lastOutWords = null;
  lastLevel1 = null;
  lastLevel1Words = null;
  releasePaintTarget();
}

// quente:
/** As 16 amostras 4×4 da paleta (camada 0, (0, 0, 16, 16)). */
function paintPalette(T: Int32Array, i: number, rgb: number): void {
  const c = texel(rgb);
  const o = 64 * 4 * (i >> 2) + 4 * (i & 3);
  for (let j = 0; j < 4; j++) T.fill(c, o + j * 64, o + j * 64 + 4);
}

/** Nível 1: caixa 2×2 arredondada ((a + b + c + d + 2) >> 2 por canal) nas regiões usadas. */
function paintLevel1(T: Int32Array, L: Int32Array): void {
  for (let r = 0; r < FIGURE_PAINT_REGIONS.length; r++) {
    const g = FIGURE_PAINT_REGIONS[r]!;
    const x0 = g.u >> 1;
    const x1 = (g.u + g.w) >> 1;
    for (let y = g.v >> 1; y < (g.v + g.h) >> 1; y++) {
      let i = g.layer * 4096 + y * 128 + 2 * x0;
      let o = g.layer * 1024 + y * 32 + x0;
      for (let x = x0; x < x1; x++) {
        const a = T[i]!;
        const b = T[i + 1]!;
        const c = T[i + 64]!;
        const d = T[i + 65]!;
        // Dois canais por vez em faixas de 16 bits (soma ≤ 1022, sem vazar para a faixa vizinha).
        const lo = (a & 0xff00ff) + (b & 0xff00ff) + (c & 0xff00ff) + (d & 0xff00ff) + 0x20002;
        const hi =
          ((a >>> 8) & 0xff00ff) + ((b >>> 8) & 0xff00ff) + ((c >>> 8) & 0xff00ff) + ((d >>> 8) & 0xff00ff) + 0x20002;
        L[o] = ((lo >>> 2) & 0xff00ff) | (((hi >>> 2) & 0xff00ff) << 8);
        i += 2;
        o++;
      }
    }
  }
}

/**
 * Pinta as 2 camadas 64×64 RGBA da skin em `out` (`FIGURE_SKIN_BYTES`) e o nível 1 (32×32 por camada) em `level1`
 * (`FIGURE_SKIN_LEVEL1_BYTES`). Saída opaca, só nas `FIGURE_PAINT_REGIONS`. No loading, nunca por quadro. Os dois
 * buffers precisam começar alinhados a 4 bytes. Espera um look normalizado (`normalizeFigureLook`).
 */
export function paintFigureSkin(recipe: FigureSkinRecipe, out: Uint8Array, level1: Uint8Array): void {
  const T = outWords(out);
  const L1 = level1Words(level1);
  const look = recipe.look;
  const o = look.outfit;
  const zombie = look.zombie;
  const teams = recipe.teamColors;
  // Farda efetiva (a mesma do `figureOutfitFor`, sem alocar): com time, colete, luvas, braçadeira e joelheiras do time;
  // as peças do look passam pela trava de cor.
  const tc = figureTeamColor(recipe.team, teams);
  const team = tc >= 0 ? recipe.team : -1;
  const fade = zombie === null ? 0 : ZOMBIE_FADE;
  const jacket = faded(figureLockedColor(o.jacket, teams), fade);
  const pants = faded(figureLockedColor(o.pants, teams), fade);
  const vest = faded(tc >= 0 ? tc : figureLockedColor(o.vest, teams), fade);
  const gloves = tc >= 0 ? tc : figureLockedColor(o.gloves, teams);
  const armband = tc;
  const boots = figureLockedColor(o.boots, teams);
  const accessory = figureLockedColor(look.accessory, teams);
  const seed = zombie === null ? 0 : zombieKindSeed(zombie.kind);

  // Cabeça: as 5 faces fixas na cruz (canto (0, 0), medidas 16³) na semântica do BF.
  setPaintTarget(T, look);
  resolveHeadColors(look, accessory, zombie !== null);
  setGrid(0, 0, 16);
  paintHeadSide(false);
  setGrid(0, 32, 16);
  paintHeadSide(true);
  setGrid(0, 48, 16);
  paintHeadBack();
  setGrid(0, 16, 0);
  paintHeadTop();
  setGrid(0, 32, 0);
  paintHeadBottom();
  // Expressões: a base uma vez, copiada para as 8 células; depois humor (+ traço do zumbi) e o que vai por cima.
  setGrid(0, 0, 32);
  paintFaceBase();
  const base = gridOrigin();
  for (let e = 1; e < FACE_EXPRESSIONS.length; e++) {
    setGrid(0, CELL * (e & 3), 32 + CELL * (e >> 2));
    copyGrid(base);
  }
  for (let e = 0; e < FACE_EXPRESSIONS.length; e++) {
    setGrid(0, CELL * (e & 3), 32 + CELL * (e >> 2));
    paintFaceMood(EXPRESSION_MOOD[e]!);
    if (zombie !== null) paintZombieFaceTrait(zombie.faceStyle, e);
    paintFaceTop();
  }
  // A frente da cruz leva a expressão 0 (cubinho e nível 1; a GPU lê a célula da expressão).
  setGrid(0, 16, 16);
  copyGrid(base);

  // Paleta.
  const c = headColorTable();
  const skin = c[HEAD_COLOR.skin]!;
  const hairTop = c[HEAD_COLOR.hairTop]!;
  const gear = vest >= 0 ? vest : jacket;
  const S = FIGURE_SWATCH;
  paintPalette(T, S.hair, hairTop);
  paintPalette(T, S.hairShade, luminanceRgb(hairTop) < 0.1 ? shadeRgb(hairTop, 30) : shadeRgb(hairTop, -30));
  paintPalette(T, S.beard, c[HEAD_COLOR.beard]!);
  paintPalette(T, S.accessory, accessory);
  paintPalette(T, S.accessoryShade, c[HEAD_COLOR.accessoryShade]!);
  paintPalette(T, S.gold, FIGURE_GOLD);
  paintPalette(T, S.skin, skin);
  paintPalette(T, S.hand, gloves >= 0 ? gloves : shadeRgb(skin, -10));
  paintPalette(T, S.sleeve, jacket);
  paintPalette(T, S.pants, pants);
  paintPalette(T, S.vest, gear);
  paintPalette(T, S.vestShade, detailRgb(gear, 26));
  paintPalette(T, S.boots, boots);
  paintPalette(T, S.hairBase, c[HEAD_COLOR.hair]!);
  paintPalette(T, S.zombieGoo, ZOMBIE_GOO);
  paintPalette(T, S.zombieBandage, zombieBandage(seed, 3));

  // Corpo: jaqueta no tecido, colete por cima, a roupa rasgada do zumbi, as colunas dos membros e a bota.
  ensureOutfitMasks();
  fabricTones(o.fabric, figureLockedColor(o.jacket, teams), ZOMBIE_FADE_TO, fade);
  paintJacket(o.fabric, jacket, pants);
  if (vest >= 0) paintVest(vest, team, texel(detailRgb(jacket, 30)));
  if (zombie !== null) paintZombieRags(seed, skin, zombie.kind === 'chonker');
  // As joelheiras são do colete (o equipamento): sem colete, só a calça.
  if (zombie !== null) {
    paintLimbColumns(
      jacket,
      armband,
      gloves,
      pants,
      vest,
      skin,
      ZOMBIE_SLEEVE_ROWS,
      ZOMBIE_FOREARM_ROWS,
      ZOMBIE_THIGH_ROWS,
    );
  } else
    paintLimbColumns(jacket, armband, gloves, pants, vest, skin, LIMB_ROWS_PLAIN, LIMB_ROWS_PLAIN, LIMB_ROWS_PLAIN);
  paintBootCell(boots);

  paintLevel1(T, L1);
}

/** `rgb` desbotado `fade` para a cor do zumbi (0 = como está); −1 (sem a peça) passa. */
function faded(rgb: number, fade: number): number {
  return rgb < 0 || fade === 0 ? rgb : mixRgb(rgb, ZOMBIE_FADE_TO, fade);
}
// fim-quente
