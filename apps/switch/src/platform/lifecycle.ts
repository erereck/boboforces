import type { Lifecycle } from '@boboforces/platform-api';
import type { Unsubscribe } from '@boboforces/shared';

/**
 * Ciclo de vida no Switch (tecnico.md §11.2). O nx.js não tem evento confiável de HOME/sleep nem de dock↔portátil
 * [T0], então a casca detecta por amostragem, uma vez por frame:
 * - mais de 1 s entre o FIM de um frame e o início do seguinte = voltou do HOME ou do sleep → `onPause` e depois
 *   `onResume` (o jogo fica pausado; o "voltou" serve para retomar o áudio). Conta do fim, e não do início, para um
 *   frame que demora sozinho (entrar na partida, montar malhas, compilar shaders) não parecer volta do HOME;
 * - mudança de `Switch.operationMode()` (dock ↔ portátil) → `onPause` (a tela "aperte A" reatribui os slots);
 * - controle desconectado (avisado pelo input) → `onPause`.
 * O `+` do primeiro controle não passa por aqui: ele chega como botão (ação de pausa) e a casca só bloqueia a saída.
 */
export const RESUME_GAP_MS = 1000;
/** De quantos em quantos frames consultar o modo de operação (é uma chamada de serviço do sistema). */
export const OPERATION_MODE_EVERY = 30;

export interface SwitchLifecycle extends Lifecycle {
  /** Chamado pela casca no início de cada frame (relógio da casca, o mesmo do `frameEnd`). */
  frame(nowMs: number): void;
  /** Chamado pela casca no fim de cada frame, depois dos callbacks do jogo. */
  frameEnd(nowMs: number): void;
  /** O input viu um controle sumir. */
  controllerLost(index: number): void;
}

export interface SwitchLifecycleOptions {
  /** `Switch.operationMode()`; lança ou devolve -1 se não der para ler. */
  readonly operationMode: () => number;
  readonly onEvent?: (description: string) => void;
}

function emitter<A extends unknown[]>(): {
  add(listener: (...args: A) => void): Unsubscribe;
  emit(...args: A): void;
} {
  const listeners = new Set<(...args: A) => void>();
  return {
    add(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    emit(...args) {
      for (const l of listeners) l(...args);
    },
  };
}

export function createSwitchLifecycle(opts: SwitchLifecycleOptions): SwitchLifecycle {
  const pause = emitter<[]>();
  const resume = emitter<[]>();
  const visibility = emitter<[boolean]>();
  const readMode = (): number => {
    try {
      return opts.operationMode();
    } catch {
      return -1;
    }
  };
  /** Fim do frame anterior (-1 antes do primeiro). */
  let lastFrameEnd = -1;
  let frames = 0;
  let mode = readMode();

  return {
    onPause: pause.add,
    onResume: resume.add,
    onVisibility: visibility.add,
    setInMatch(inMatch) {
      // No Switch não há aba para fechar nem Wake Lock: o `+` já é interceptado sempre que há jogo na tela.
      void inMatch;
    },
    frame(nowMs) {
      if (lastFrameEnd >= 0 && nowMs - lastFrameEnd > RESUME_GAP_MS) {
        opts.onEvent?.(`ciclo: ${Math.round(nowMs - lastFrameEnd)} ms sem frame (HOME/sleep?): pausa`);
        pause.emit();
        visibility.emit(true);
        resume.emit();
      }
      if (++frames % OPERATION_MODE_EVERY === 0) {
        const now = readMode();
        if (now !== mode) {
          opts.onEvent?.(`ciclo: modo de operação ${mode} → ${now}: pausa`);
          mode = now;
          pause.emit();
        }
      }
    },
    frameEnd(nowMs) {
      lastFrameEnd = nowMs;
    },
    controllerLost(index) {
      opts.onEvent?.(`ciclo: controle ${index + 1} desconectado: pausa`);
      pause.emit();
    },
  };
}
