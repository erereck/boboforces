import type { Lifecycle } from '@boboforces/platform-api';
import type { Unsubscribe } from '@boboforces/shared';

/**
 * Ciclo de vida no Switch (tecnico.md §11.2). O nx.js não tem evento confiável de HOME/sleep nem de dock↔portátil
 * [T0], então a casca detecta por amostragem, uma vez por frame:
 * - mais de 1 s entre o FIM de um frame (ou o PEDIDO do frame seguinte, se veio depois) e o início do seguinte =
 *   voltou do HOME ou do sleep → `onPause` e depois `onResume` (o jogo fica pausado; o "voltou" serve para retomar
 *   o áudio). Conta do fim, e não do início, para um frame que demora sozinho (entrar na partida, montar malhas,
 *   compilar shaders) não parecer volta do HOME; e conta do pedido para o jogo que ficou sem pedir frame esperando
 *   um carregamento assíncrono também não parecer. Com áudio, o relógio do áudio desempata: ele anda numa thread
 *   nativa mesmo com o JS ocupado e PARA com o app suspenso, então um vão em que o áudio andou é "JS ocupado"
 *   (trabalho síncrono fora do frame, visto no Eden no M1: 1,2 s no boot), não HOME [T0: confirmar no console];
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
  /** Chamado quando a casca pede um frame nativo ao nx.js (o vão só conta a partir daí). */
  frameRequested(nowMs: number): void;
  /** O input viu um controle sumir. */
  controllerLost(index: number): void;
}

/** M1: o mesmo evento em dados, para as linhas `[t0] item=20` (e `item=2` na troca de modo). */
export type LifecycleChange =
  | { readonly kind: 'mode'; readonly from: number; readonly to: number }
  | { readonly kind: 'resume'; readonly gapMs: number; readonly audioMs: number }
  /** Vão longo com o relógio do áudio andando: o JS ficou ocupado (não pausa). */
  | { readonly kind: 'busy'; readonly gapMs: number; readonly audioMs: number }
  | { readonly kind: 'controller'; readonly index: number };

export interface SwitchLifecycleOptions {
  /** `Switch.operationMode()`; lança ou devolve -1 se não der para ler. */
  readonly operationMode: () => number;
  readonly onEvent?: (description: string) => void;
  readonly onChange?: (change: LifecycleChange) => void;
  /** Relógio do áudio em segundos (`AudioContext.currentTime`), ou -1 sem áudio. */
  readonly audioClock?: () => number;
}

/** Fração do vão que o relógio do áudio precisa andar para o vão ser "JS ocupado" e não suspensão. */
export const AUDIO_BUSY_FRACTION = 0.5;

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
  /** Último pedido de frame nativo (-1 = nenhum desde o fim do frame anterior). */
  let lastRequest = -1;
  /** Relógio do áudio no fim do frame anterior (s), ou -1. */
  let audioAtEnd = -1;
  const readAudio = (): number => {
    try {
      return opts.audioClock?.() ?? -1;
    } catch {
      return -1;
    }
  };
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
      const since = Math.max(lastFrameEnd, lastRequest);
      if (lastFrameEnd >= 0 && nowMs - since > RESUME_GAP_MS) {
        const gapMs = Math.round(nowMs - since);
        const audioNow = audioAtEnd >= 0 ? readAudio() : -1;
        const audioMs = audioNow >= 0 ? Math.round((audioNow - audioAtEnd) * 1000) : -1;
        if (audioMs >= 0 && audioMs > (nowMs - lastFrameEnd) * AUDIO_BUSY_FRACTION) {
          opts.onEvent?.(`ciclo: ${gapMs} ms sem frame com o áudio andando (${audioMs} ms): JS ocupado, sem pausa`);
          opts.onChange?.({ kind: 'busy', gapMs, audioMs });
        } else {
          opts.onEvent?.(`ciclo: ${gapMs} ms sem frame (HOME/sleep?): pausa`);
          opts.onChange?.({ kind: 'resume', gapMs, audioMs });
          pause.emit();
          visibility.emit(true);
          resume.emit();
        }
      }
      if (++frames % OPERATION_MODE_EVERY === 0) {
        const now = readMode();
        if (now !== mode) {
          opts.onEvent?.(`ciclo: modo de operação ${mode} → ${now}: pausa`);
          opts.onChange?.({ kind: 'mode', from: mode, to: now });
          mode = now;
          pause.emit();
        }
      }
    },
    frameEnd(nowMs) {
      lastFrameEnd = nowMs;
      lastRequest = -1;
      audioAtEnd = opts.audioClock ? readAudio() : -1;
    },
    frameRequested(nowMs) {
      lastRequest = nowMs;
    },
    controllerLost(index) {
      opts.onEvent?.(`ciclo: controle ${index + 1} desconectado: pausa`);
      opts.onChange?.({ kind: 'controller', index });
      pause.emit();
    },
  };
}
