// M1: o SUBCONJUNTO COMUM de Web Audio que o jogo usa (regra 9; tecnico.md §12, item 19 do Teste Zero), como tipos
// estruturais SEM a lib DOM. O `AudioContext` do navegador e o do nx.js cabem nestas interfaces; o `audio` faz
// `surface.context as AudioContextLike` e nunca toca em nada fora daqui (sem PannerNode, filtros, OscillatorNode,
// MediaElement nem AudioWorklet: o nx.js não tem). Só tipos.

export interface AudioParamLike {
  value: number;
  setValueAtTime(value: number, startTime: number): unknown;
  linearRampToValueAtTime(value: number, endTime: number): unknown;
}

export interface AudioNodeLike {
  connect(destination: AudioNodeLike): unknown;
  disconnect(): void;
}

export interface AudioBufferLike {
  readonly sampleRate: number;
  readonly length: number;
  readonly duration: number;
  readonly numberOfChannels: number;
  getChannelData(channel: number): Float32Array;
}

export interface AudioBufferSourceNodeLike extends AudioNodeLike {
  buffer: AudioBufferLike | null;
  loop: boolean;
  readonly playbackRate: AudioParamLike;
  start(when?: number, offset?: number, duration?: number): void;
  stop(when?: number): void;
  /**
   * Fim da reprodução. O parâmetro é `never` (M1, pedido da frente switch-audio): o `(ev: Event) => any` do
   * `AudioContext` do DOM cabe no tipo, e quem atribui pode usar um handler sem parâmetro.
   */
  onended: ((ev: never) => unknown) | null;
}

export interface GainNodeLike extends AudioNodeLike {
  readonly gain: AudioParamLike;
}

export interface StereoPannerNodeLike extends AudioNodeLike {
  /** -1 (esquerda) a 1 (direita). */
  readonly pan: AudioParamLike;
}

export type AudioContextStateLike = 'suspended' | 'running' | 'closed';

export interface AudioContextLike {
  readonly state: AudioContextStateLike | string;
  readonly sampleRate: number;
  /** Segundos desde a criação do contexto (relógio do áudio; a sim nunca lê). */
  readonly currentTime: number;
  readonly destination: AudioNodeLike;
  createBufferSource(): AudioBufferSourceNodeLike;
  createGain(): GainNodeLike;
  createStereoPanner(): StereoPannerNodeLike;
  /** Buffer para sons sintetizados em código (PCM preenchido em `getChannelData`). */
  createBuffer(channels: number, length: number, sampleRate: number): AudioBufferLike;
  /** Decodifica MP3 (único formato de áudio do jogo, regra 23). O `ArrayBuffer` pode ser consumido. */
  decodeAudioData(data: ArrayBuffer): Promise<AudioBufferLike>;
  resume(): Promise<void>;
  suspend(): Promise<void>;
}
