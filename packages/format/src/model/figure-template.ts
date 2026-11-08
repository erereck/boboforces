/**
 * Gabarito de caixas de cada aparência (decisão #56; PLANO do porte §B2, §B8 e §C3). Dona: frente F1. O gabarito é a
 * lista de caixas (`FIGURE_BOX_FIELD`, px no espaço do osso) que o render instancia por bobo: as 14 do corpo e o cabelo
 * e os acessórios do look (até `FIGURE_MAX_BOXES`). Montado no loading, nunca por quadro.
 */
import { FIGURE_BODY_BOXES, FIGURE_BOX_STRIDE, FIGURE_MAX_BOXES } from './figure.ts';
import { figureHairBoxes } from './figure-hair.ts';
import type { FigureLook } from './figure-look.ts';

// O cabelo sai pelo pacote junto do gabarito (o índice do `format` exporta este arquivo).
export * from './figure-hair.ts';

export interface FigureTemplateSet {
  readonly count: number;
  /** count × FIGURE_MAX_BOXES × FIGURE_BOX_STRIDE; o gabarito i começa em i × FIGURE_MAX_BOXES × FIGURE_BOX_STRIDE. */
  readonly boxes: Float32Array;
  /** Caixas de cada gabarito (≤ FIGURE_MAX_BOXES). */
  readonly length: Uint8Array;
}

/** Caixas do corpo (as 12 primárias, a mão D e a mão E). */
const BODY_BOX_COUNT = FIGURE_BODY_BOXES.length / FIGURE_BOX_STRIDE;
/** Teto de gabaritos por partida: `ActorBuffer.figure` é u8 e 255 é `NO_FIGURE` (não desenha), então 0..254. */
const MAX_TEMPLATES = 255;

/**
 * Gabarito de um look em out[o ..] (`o` em floats); devolve o número de caixas (14 do corpo + 0 a 28 de cabelo, ≤
 * `FIGURE_MAX_BOXES`). O corpo é o mesmo para todo look, zumbi inclusive: manga, antebraço, coxa e canela leem as colunas
 * da farda (#58), e a skin de cada look pinta nelas o que ele veste (a braçadeira do time, o punho da luva, a joelheira,
 * a roupa rasgada do zumbi com a barra de pele no fim, PLANO §B11).
 */
export function buildFigureTemplate(look: FigureLook, out: Float32Array, o: number): number {
  out.set(FIGURE_BODY_BOXES, o);
  const count = BODY_BOX_COUNT + figureHairBoxes(look, out, o + BODY_BOX_COUNT * FIGURE_BOX_STRIDE);
  if (count > FIGURE_MAX_BOXES) throw new Error(`figure: gabarito com ${count} caixas passa de ${FIGURE_MAX_BOXES}`);
  return count;
}

/**
 * Gabaritos dos looks da partida: aloca uma vez (no loading) e monta cada um no seu bloco de FIGURE_MAX_BOXES. No máximo
 * 255 (o índice 255 é `NO_FIGURE` no `ActorBuffer`): passou disso, lança no loading em vez de sumir com o bobo.
 */
export function createFigureTemplateSet(looks: readonly FigureLook[]): FigureTemplateSet {
  const count = looks.length;
  if (count > MAX_TEMPLATES) {
    throw new Error(`figure: ${count} gabaritos passam do teto de ${MAX_TEMPLATES} (o índice 255 é NO_FIGURE)`);
  }
  const block = FIGURE_MAX_BOXES * FIGURE_BOX_STRIDE;
  const boxes = new Float32Array(count * block);
  const length = new Uint8Array(count);
  for (let i = 0; i < count; i++) length[i] = buildFigureTemplate(looks[i]!, boxes, i * block);
  return { count, boxes, length };
}
