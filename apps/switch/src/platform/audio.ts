import type { AudioContextLike, AudioSurface } from '@boboforces/platform-api';
import { describeError } from './nx.ts';

/**
 * Áudio do Switch (tecnico.md §12, item 19 do Teste Zero): o `AudioContext` do nx.js (Web Audio sobre o audren, MP3
 * por FFmpeg). Sem política de autoplay: nasce liberado. Criado no primeiro uso (o boot fica mais curto) e retomado
 * na volta do HOME/sleep (`resume`, chamado pela casca no `onResume` do ciclo de vida).
 */
export interface SwitchAudio extends AudioSurface {
  readonly context: AudioContextLike;
  /** `resume()` do contexto; resolve com o estado depois (ou o erro, em texto). */
  resume(): Promise<string>;
}

export function createSwitchAudio(
  AudioContextClass: (new () => unknown) | undefined,
  log: (line: string) => void,
): SwitchAudio | null {
  if (!AudioContextClass) return null;
  let context: AudioContextLike;
  try {
    context = new AudioContextClass() as AudioContextLike;
  } catch (error) {
    log(`áudio indisponível: ${describeError(error)}`);
    return null;
  }
  return {
    context,
    unlocked: true,
    onUnlock: () => () => {},
    resume: () =>
      context.resume().then(
        () => String(context.state),
        (error: unknown) => `erro: ${describeError(error)}`,
      ),
  };
}
