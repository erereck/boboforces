// Contexto de áudio FALSO para testes (`@boboforces/audio/testing`): implementa o `AudioContextLike` da platform-api
// com nós que só registram o que aconteceu. Dados sintéticos; usado pelos testes do mixer e da casca do Switch.
import type {
  AudioBufferLike,
  AudioBufferSourceNodeLike,
  AudioContextLike,
  AudioNodeLike,
  AudioParamLike,
  GainNodeLike,
  StereoPannerNodeLike,
} from '@boboforces/platform-api';

export interface FakeNode extends AudioNodeLike {
  readonly kind: 'gain' | 'panner' | 'source' | 'destination';
  readonly outputs: FakeNode[];
}

export interface FakeSource extends AudioBufferSourceNodeLike, FakeNode {
  started: boolean;
  stopped: boolean;
  /** M3 (fase 6e): de onde (s) a fonte começou (`start(when, offset)`). */
  startOffset: number;
  /** Dispara o `onended` como o navegador faria ao fim do som. */
  end(): void;
}

export interface FakeAudioContext extends AudioContextLike {
  currentTime: number;
  state: 'suspended' | 'running' | 'closed';
  readonly sources: FakeSource[];
  readonly created: { gain: number; panner: number; source: number; buffer: number };
  /** Bytes recebidos pelo `decodeAudioData` (o primeiro byte vira a duração em décimos de segundo). */
  readonly decoded: number[];
  /** Faz o `decodeAudioData` rejeitar (MP3 inválido). */
  failDecode: boolean;
  /** Remove o `createBuffer` (simula um runtime sem ele). */
  withoutCreateBuffer(): void;
}

function param(initial: number): AudioParamLike {
  return {
    value: initial,
    setValueAtTime(v: number) {
      this.value = v;
      return this;
    },
    linearRampToValueAtTime(v: number) {
      this.value = v;
      return this;
    },
  };
}

function node<K extends FakeNode['kind']>(kind: K): FakeNode & { kind: K } {
  const outputs: FakeNode[] = [];
  return {
    kind,
    outputs,
    connect(destination: AudioNodeLike) {
      outputs.push(destination as FakeNode);
      return destination;
    },
    disconnect() {
      outputs.length = 0;
    },
  };
}

export function fakeBuffer(channels: number, length: number, sampleRate: number): AudioBufferLike {
  const data = Array.from({ length: channels }, () => new Float32Array(length));
  return {
    sampleRate,
    length,
    duration: length / sampleRate,
    numberOfChannels: channels,
    getChannelData: (c: number) => {
      const d = data[c];
      if (!d) throw new RangeError(`canal ${c} não existe`);
      return d;
    },
  };
}

export function createFakeAudioContext(sampleRate = 48000): FakeAudioContext {
  const sources: FakeSource[] = [];
  const created = { gain: 0, panner: 0, source: 0, buffer: 0 };
  const decoded: number[] = [];
  const ctx: FakeAudioContext = {
    currentTime: 0,
    state: 'running',
    sampleRate,
    destination: node('destination'),
    sources,
    created,
    decoded,
    failDecode: false,
    createGain(): GainNodeLike {
      created.gain++;
      return { ...node('gain'), gain: param(1) };
    },
    createStereoPanner(): StereoPannerNodeLike {
      created.panner++;
      return { ...node('panner'), pan: param(0) };
    },
    createBufferSource(): AudioBufferSourceNodeLike {
      created.source++;
      const s: FakeSource = {
        ...node('source'),
        buffer: null,
        loop: false,
        playbackRate: param(1),
        onended: null,
        started: false,
        stopped: false,
        startOffset: 0,
        start(_when?: number, offset?: number) {
          s.started = true;
          s.startOffset = offset ?? 0;
        },
        stop() {
          s.stopped = true;
        },
        end() {
          // O handler do mixer não usa o evento (o contrato é `(ev: never) => unknown`, para o do DOM caber).
          (s.onended as (() => unknown) | null)?.();
        },
      };
      sources.push(s);
      return s;
    },
    createBuffer(channels: number, length: number, rate: number) {
      created.buffer++;
      return fakeBuffer(channels, length, rate);
    },
    decodeAudioData(data: ArrayBuffer) {
      const bytes = new Uint8Array(data);
      decoded.push(bytes.length);
      if (ctx.failDecode || bytes.length === 0) return Promise.reject(new Error('decodeAudioData rejeitou'));
      const tenths = bytes[0] ?? 1;
      return Promise.resolve(fakeBuffer(1, Math.round((tenths / 10) * 44100), 44100));
    },
    resume() {
      ctx.state = 'running';
      return Promise.resolve();
    },
    suspend() {
      ctx.state = 'suspended';
      return Promise.resolve();
    },
    withoutCreateBuffer() {
      (ctx as { createBuffer?: unknown }).createBuffer = undefined;
    },
  };
  return ctx;
}
