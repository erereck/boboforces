// @boboforces/audio: mixer próprio sobre o subconjunto comum de Web Audio (AudioContext, BufferSource, Gain,
// StereoPanner; regra 9) e síntese de efeitos em PCM. Fora do M0: entra no M2. O contexto chega opaco por
// `platform.audio` (null = sem som, e o jogo tem que rodar assim).
import type { AudioSurface } from '@boboforces/platform-api';
import type { Disposable } from '@boboforces/shared';

export type AudioBus = 'master' | 'sfx' | 'music' | 'ui';

export interface PlayOptions {
  readonly bus: AudioBus;
  readonly volume?: number;
  /** Posição no mundo (m); sem posição = som 2D (UI). */
  readonly x?: number;
  readonly y?: number;
  readonly z?: number;
  /** Prioridade para o teto de 24 vozes. */
  readonly priority?: number;
}

export interface Mixer extends Disposable {
  /** Ouvintes locais (1 a 4): cada som usa o mais próximo (tecnico.md §12). */
  setListener(slot: number, x: number, y: number, z: number, yaw: number): void;
  setListenerCount(count: number): void;
  play(sound: string, options: PlayOptions): void;
  setBusVolume(bus: AudioBus, volume: number): void;
  setMono(mono: boolean): void;
  suspend(): void;
  resume(): void;
}

export function createMixer(surface: AudioSurface | null): Mixer {
  void surface;
  throw new Error('M2: áudio ainda não implementado');
}
