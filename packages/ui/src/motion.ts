// Movimento da UI (M12, refino): as "entradas secas" do tokens (`MOTION`, 120 a 180 ms, ease-out, 8 px) aplicadas
// por cima de comandos já desenhados na DrawList. Quem desenha guarda `list.count` antes de um bloco e, depois de
// desenhar, chama `fadeCommands` com o progresso da entrada: nada é redesenhado nem alocado. Com "Reduzir efeitos"
// (ou o `prefers-reduced-motion` da plataforma) a entrada é instantânea: `enterProgress(..., reduce = true)` dá 1.
import { DRAW_FLOATS_PER_COMMAND, type DrawList } from './draw-list.ts';
import { MOTION } from './tokens.ts';

/**
 * Progresso de uma entrada (0..1) com ease-out cúbico. `elapsedMs` ≤ 0 = ainda não começou (0); ≥ `durationMs` = 1.
 * `reduce` (Reduzir efeitos) devolve 1 sempre.
 */
export function enterProgress(elapsedMs: number, durationMs: number = MOTION.enterMs, reduce = false): number {
  if (reduce || durationMs <= 0 || elapsedMs >= durationMs) return 1;
  if (elapsedMs <= 0) return 0;
  const t = 1 - elapsedMs / durationMs;
  return 1 - t * t * t;
}

/** Deslocamento (px de referência) que acompanha o progresso: `MOTION.slidePx` no começo, 0 no fim. */
export function enterSlidePx(progress: number, slidePx: number = MOTION.slidePx): number {
  return (1 - (progress < 0 ? 0 : progress > 1 ? 1 : progress)) * slidePx;
}

/**
 * Multiplica o alfa e desloca os comandos `[from, list.count)` já desenhados. `alpha` em 0..1 (1 = sem mudança); `dx` e
 * `dy` em px do alvo. Vale para todos os tipos de comando (o recorte anda junto com o que recorta).
 */
export function fadeCommands(list: DrawList, from: number, alpha: number, dx = 0, dy = 0): void {
  const a = alpha <= 0 ? 0 : alpha >= 1 ? 1 : alpha;
  const end = list.count;
  for (let i = from < 0 ? 0 : from; i < end; i++) {
    if (a < 1) {
      const c = list.colors[i] ?? 0;
      list.colors[i] = ((c & 0xffffff00) | Math.round((c & 0xff) * a)) >>> 0;
    }
    if (dx !== 0 || dy !== 0) {
      const g = i * DRAW_FLOATS_PER_COMMAND;
      list.geom[g] = (list.geom[g] ?? 0) + dx;
      list.geom[g + 1] = (list.geom[g + 1] ?? 0) + dy;
    }
  }
}
