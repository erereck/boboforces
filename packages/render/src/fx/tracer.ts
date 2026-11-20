import { TRACER_STYLE, type TracerStyle } from '../fx-queue.ts';

/** O visual de um estilo de traçante (`FxPass`): largura (m), vida (s) pelo comprimento, cauda (m) e cor. */
export interface TracerLook {
  /** Meia largura do quad (m). */
  readonly size: number;
  /** A vida é o comprimento ÷ `speed` (m/s), entre `minLife` e `maxLife` (s): a cabeça vai do início ao fim nela. */
  readonly speed: number;
  readonly minLife: number;
  readonly maxLife: number;
  /** Comprimento da cauda atrás da cabeça (m). */
  readonly tail: number;
  readonly color: number;
  readonly alpha: number;
}

/**
 * Os estilos de `TRACER_STYLE`. O de sempre não muda. M9 (fase 1b): o do Ricochete tinha a mesma largura (2,5 cm) e o
 * quique curto (poucos metros até o alvo) vivia 40 ms, um quadro e meio: ninguém via. Agora tem o dobro da largura,
 * a cor mais clara e opaca, a cauda mais longa e pelo menos 0,12 s.
 */
export const TRACER_LOOK: Readonly<Record<TracerStyle, TracerLook>> = {
  [TRACER_STYLE.normal]: {
    size: 0.025,
    speed: 320,
    minLife: 0.04,
    maxLife: 0.3,
    tail: 2.6,
    color: 0xffeb99,
    alpha: 0.85,
  },
  [TRACER_STYLE.ricochet]: {
    size: 0.05,
    speed: 160,
    minLife: 0.12,
    maxLife: 0.35,
    tail: 4,
    color: 0xfff6c8,
    alpha: 1,
  },
};

/** O estilo do número guardado no pedido (qualquer outro valor vira o de sempre). */
export function tracerLookOf(style: number): TracerLook {
  return style === TRACER_STYLE.ricochet ? TRACER_LOOK[TRACER_STYLE.ricochet] : TRACER_LOOK[TRACER_STYLE.normal];
}

/** Vida (s) do traçante de `len` metros no estilo `look`. */
export function tracerLife(look: TracerLook, len: number): number {
  return Math.min(look.maxLife, Math.max(look.minLife, len / look.speed));
}
