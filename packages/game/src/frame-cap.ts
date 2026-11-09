/**
 * M2 (fase 6e): o limitador de quadros (arte-ux.md §7.3: 30 FPS para poupar bateria e calor no celular). O laço do
 * `game` pula o quadro do `requestFrame` que chega cedo demais; a sim anda pelo tempo real (passo fixo), então nada
 * fica mais lento, só desenhado menos vezes.
 */

/** Folga: o vsync não chega exatamente a cada 33,3 ms (a 60 Hz, o 2º quadro chega com 33,2 ms). */
export const FPS_CAP_SLACK_MS = 4;

/** O quadro em `nowMs` deve ser pulado com o limite `cap` (60 = sem limite; `lastMs` < 0 = o primeiro)? */
export function skipCappedFrame(cap: number, lastMs: number, nowMs: number): boolean {
  if (cap >= 60 || lastMs < 0) return false;
  return nowMs - lastMs < 1000 / cap - FPS_CAP_SLACK_MS;
}
