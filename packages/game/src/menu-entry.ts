import { DRAW_FLOATS_PER_COMMAND, enterProgress, enterSlidePx, fadeCommands, type DrawList } from '@boboforces/ui';

/**
 * M12 (fase 3, GDD §5.6): as "entradas secas" das telas de menu e da pausa, pelo ajudante `ui/src/motion.ts`. Quando a
 * tela (a `key`) muda, os comandos que ela desenhou sobem de 8 px a 0 e a opacidade vai de 0 a 1 em 150 ms (ease-out).
 * O fundo que cobre o alvo inteiro (o `bunker` dos menus, o véu da pausa) fica de fora: só os comandos entram, sem a
 * tela piscar. Com "Reduzir efeitos" (`reduceShake`) ou o `prefers-reduced-motion` da plataforma, a entrada é
 * instantânea. Zero alocação por frame: a chave é comparada por identidade (uma string fixa ou um objeto da tela).
 */
export interface MenuEntry {
  /**
   * Depois de a tela desenhar os comandos `[from, list.count)`: reinicia a entrada se `key` mudou desde o último quadro
   * e aplica o progresso. `frameMs` é o tempo do quadro (o mesmo relógio do jogo); `scale` é a escala da UI (o deslize
   * de 8 px é de referência, como o resto do layout).
   */
  apply(list: DrawList, from: number, key: unknown, frameMs: number, reduce: boolean, scale?: number): void;
  /** Sem tela de menu neste quadro (partida, loading): a próxima tela entra do zero. */
  clear(): void;
}

/** O primeiro comando a partir de `from` que não é um retângulo do alvo inteiro (o fundo da tela). */
export function firstContentCommand(list: DrawList, from: number): number {
  let i = from;
  while (i < list.count) {
    const g = i * DRAW_FLOATS_PER_COMMAND;
    const full =
      list.geom[g]! <= 0 &&
      list.geom[g + 1]! <= 0 &&
      list.geom[g + 2]! >= list.width &&
      list.geom[g + 3]! >= list.height;
    if (!full) break;
    i++;
  }
  return i;
}

export function createMenuEntry(): MenuEntry {
  let key: unknown = undefined;
  let elapsed = 0;
  return {
    apply(list, from, next, frameMs, reduce, scale = 1) {
      if (next !== key) {
        key = next;
        elapsed = 0;
      } else elapsed += frameMs;
      const p = enterProgress(elapsed, undefined, reduce);
      if (p >= 1) return;
      fadeCommands(list, firstContentCommand(list, from), p, 0, enterSlidePx(p) * scale);
    },
    clear() {
      key = undefined;
    },
  };
}
