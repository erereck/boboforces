// Costura com o passe de UI (programa 7, tecnico.md §6.5), que mora em `src/ui/` (frente da UI). O renderer base não
// sabe desenhar a DrawList: ele só posiciona viewport e scissor e chama o passe injetado em `createRenderer`.
import type { Disposable } from '@boboforces/shared';
import type { DrawList, UiAtlasImage } from '@boboforces/ui';
import type { WebGLRenderer } from 'three';

/** Onde a UI vai ser desenhada (viewport e scissor já aplicados pelo renderer antes de `draw`). */
export interface UiTarget {
  /** Retângulo no drawing buffer, em px reais, origem no canto INFERIOR esquerdo (convenção do GL). */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /**
   * px do drawing buffer por px da DrawList (< 1 quando o render limita o DPR). A DrawList fala em px da superfície;
   * um recorte (`clipPush`) vira scissor multiplicando por esta escala.
   */
  readonly scale: number;
}

export interface UiPass extends Disposable {
  /** Desenha a lista inteira no alvo (1 ou 2 draw calls por viewport). */
  draw(list: DrawList, target: UiTarget): void;
  /** Troca o atlas (fontes + sprites); o renderer repassa `Renderer.setUiAtlas`. Opcional: passe sem atlas ignora. */
  setAtlas?(atlas: UiAtlasImage | null): void;
}

/** Cria o passe de UI sobre o `WebGLRenderer` do render (mesmo contexto GL, mesmo cache de programas). */
export type UiPassFactory = (three: WebGLRenderer) => UiPass;
