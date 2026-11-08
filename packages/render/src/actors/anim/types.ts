// Contrato da animação dos bonecos do FutBobo (#56, PLANO do porte §B6 e §C7). CONGELADO depois do passo 2: a frente
// F4 implementa em `anim/rig.ts` (motor do FutBobo portado, envelope, LOD L0–L2) e o passe de bonecos (F3) consome.
// Sem three.
import type { FigureGameTable } from '@boboforces/format';
import type { Disposable } from '@boboforces/shared';
import type { FrameContext } from '../../shared/passes.ts';
import type { ActorBuffer } from '../../types.ts';

/**
 * Resultado de `FigureRig.pose`: `hidden` = nada escrito (o ator não é desenhado como boneco); `computed` = as 12
 * matrizes foram recalculadas; `shifted` = só o deslocamento da raiz foi somado ao que já estava em `out` (quadro
 * pulado do L1, ou L2).
 */
export const FIGURE_POSE_RESULT = { hidden: 0, computed: 1, shifted: 2 } as const;
export type FigurePoseResult = (typeof FIGURE_POSE_RESULT)[keyof typeof FIGURE_POSE_RESULT];

/** Bonecos por nível no último frame (`RenderStats.figureL0..L2`). */
export interface FigureLodStats {
  readonly l0: number;
  readonly l1: number;
  readonly l2: number;
}

export interface FigureRig extends Disposable {
  /** A tabela de jogo da partida (a mesma da sim); `null` solta. */
  setTable(table: FigureGameTable | null): void;
  /** Do perfil (`figureNearM`, `figureHalfRate`). */
  setLod(nearM: number, halfRate: boolean): void;
  /** Uma vez por frame, antes dos `pose`: relógio, LOD de cada ator pelas vistas (`frame.views`). */
  begin(frame: FrameContext, actors: ActorBuffer, frameIndex: number): void;
  /**
   * 12 matrizes de osso (mundo) do ator i em out[o .. o+192). `force` = recalcular mesmo em L1/L2 (ator novo na
   * faixa, ou desmonte). Em `shifted`, só soma o deslocamento da raiz ao que já está em `out`. Não olha o bit dead.
   */
  pose(actors: ActorBuffer, i: number, out: Float32Array, o: number, force: boolean): FigurePoseResult;
  /** Do último `pose`: expressão com a piscada (0..7) e teto do cabelo (m, mundo; Infinity = sem teto). */
  readonly expression: number;
  readonly hairCeilingY: number;
  /** Matriz da arma de 3ª pessoa do último `pose` (antebraço D × empunhadura da tabela + recuo e recarga). */
  weapon(out: Float32Array, o: number): boolean;
  /** Uma vez por frame, depois dos `pose` (esquece entidades que sumiram). */
  end(frameIndex: number): void;
  readonly stats: FigureLodStats;
}

// `createFigureRig(capacity: number): FigureRig` é declarada em `anim/index.ts` (stub no passo 2; corpo em
// `anim/rig.ts`, F4).
