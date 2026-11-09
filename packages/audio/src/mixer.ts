// Mixer mínimo do M1 (tecnico.md §12, item 19 do Teste Zero). Só o subconjunto comum de Web Audio (regra 9):
// Context, BufferSource, Gain e StereoPanner. O contexto chega opaco por `platform.audio` e vira `AudioContextLike`;
// sem contexto (`null`) o mixer existe e não faz nada, porque todo modo roda sem som.
//
// Grafo, montado UMA vez no início (sem nó novo por som além do BufferSource, que no Web Audio é de uso único):
//
//   BufferSource → StereoPanner(voz) → Gain(voz) → Gain(canal) → Gain(master) → destination
//
// Os 24 pares panner + gain das vozes são pré-alocados; tocar um som só cria o BufferSource e reaproveita a voz.
import type {
  AudioBufferLike,
  AudioBufferSourceNodeLike,
  AudioContextLike,
  AudioSurface,
  GainNodeLike,
  StereoPannerNodeLike,
} from '@boboforces/platform-api';
import type { Disposable } from '@boboforces/shared';
import { createListenerSet, spatialize, type SpatialResult } from './spatial.ts';

/** Canais do mixer. `master` é o volume geral; os outros três somam nele. */
export const AUDIO_BUSES = ['master', 'sfx', 'music', 'ui'] as const;
export type AudioBus = (typeof AUDIO_BUSES)[number];

/** Teto de vozes simultâneas (tecnico.md §12). Acima disso a de menor prioridade cede ou o som novo não toca. */
export const MAX_VOICES = 24;
/** Ouvintes locais (tela dividida até 4). */
export const MAX_LISTENERS = 4;

/** Prioridades sugeridas (maior = mais importante). */
export const SOUND_PRIORITY = { ambient: 0, step: 1, impact: 2, shot: 3, ui: 4 } as const;

export interface PlayOptions {
  readonly bus: AudioBus;
  /** Volume do som em [0, 1] (antes de distância e canais). Padrão 1. */
  readonly volume?: number;
  /** Posição no mundo (m). Sem `x`, o som é 2D (UI, primeira pessoa): sem atenuação e com `pan`. */
  readonly x?: number;
  readonly y?: number;
  readonly z?: number;
  /** Pan fixo em [-1, 1] para som 2D (o teste do T0 usa). Ignorado com posição. */
  readonly pan?: number;
  /** Prioridade para o teto de vozes (`SOUND_PRIORITY`). Padrão 1. */
  readonly priority?: number;
  /** Velocidade de reprodução (1 = normal); varia o tom de passos repetidos. */
  readonly rate?: number;
}

export interface SoundInfo {
  readonly name: string;
  readonly durationS: number;
  readonly sampleRate: number;
  readonly channels: number;
}

/** Contadores do mixer (F2 e linhas `[t0]`). */
export interface MixerStats {
  /** Vozes tocando agora. */
  readonly activeVoices: number;
  /** Maior número de vozes simultâneas desde o último `resetStats`. */
  readonly peakVoices: number;
  readonly played: number;
  /** Vozes tomadas de um som mais fraco. */
  readonly stolen: number;
  /** Sons que não tocaram: todas as vozes ocupadas por sons mais importantes, som desconhecido ou fora do alcance. */
  readonly dropped: number;
  readonly unknown: number;
}

export interface Mixer extends Disposable {
  /** Há contexto de áudio (sem ele tudo é silêncio, sem erro). */
  readonly available: boolean;
  /** O contexto (para diagnóstico: estado, latência), ou `null`. */
  readonly context: AudioContextLike | null;
  readonly stats: MixerStats;
  /** Decodifica um MP3 (regra 23) e guarda com `name`. Copia os bytes (o `decodeAudioData` consome o buffer). */
  decode(name: string, bytes: Uint8Array): Promise<SoundInfo>;
  /** Guarda PCM mono gerado em código (`createBuffer`). Lança se o contexto não tiver `createBuffer`. */
  synthesize(name: string, pcm: Float32Array, sampleRate: number): SoundInfo;
  has(name: string): boolean;
  /** Ouvinte local `slot` (0..3): posição dos olhos (m) e yaw do jogo. */
  setListener(slot: number, x: number, y: number, z: number, yaw: number): void;
  /** Quantos ouvintes locais valem (1 a 4): cada som usa o mais próximo. */
  setListenerCount(count: number): void;
  /** Toca e devolve o índice da voz (0..23), ou -1 se não tocou. Não aloca além do BufferSource. */
  play(sound: string, options: PlayOptions): number;
  /** Para todas as vozes (troca de cena, pausa longa). */
  stopAll(): void;
  setBusVolume(bus: AudioBus, volume: number): void;
  /** Saída mono (opção de acessibilidade): pan sempre no centro. */
  setMono(mono: boolean): void;
  suspend(): Promise<void>;
  /** `resume()` do contexto (volta do HOME, primeiro toque na web). Resolve mesmo se falhar. */
  resume(): Promise<void>;
  resetStats(): void;
  /**
   * M2 (fase 7d): música em loop numa voz própria, fora das 24 (não rouba efeito nem é roubada), no canal `music`.
   * Troca de faixa com crossfade de `fadeS`. A mesma faixa já tocando não recomeça. Som desconhecido: `false`.
   */
  playMusic(name: string, fadeS?: number): boolean;
  /** Para a música com fade (a voz é liberada no fim do fade). */
  stopMusic(fadeS?: number): void;
  /** A faixa tocando, ou `null`. */
  readonly music: string | null;
  /** Abaixa a música `db` dB (negativo) em 50 ms e volta em `releaseS` (arte-ux §10.4: −6 dB nas explosões). */
  duckMusic(db: number, releaseS: number): void;
}

interface Voice {
  readonly panner: StereoPannerNodeLike;
  readonly gain: GainNodeLike;
  source: AudioBufferSourceNodeLike | null;
  bus: number;
  priority: number;
  /** Ganho efetivo (volume × distância): desempate de prioridade. */
  level: number;
  /** Fim previsto no relógio do contexto (s); a voz é recuperada mesmo se o `onended` não vier. */
  endTime: number;
  /** Ordem de início (a mais velha cede primeiro no empate). */
  serial: number;
  /** `onended` da voz, criado uma vez (a fonte velha perde o handler no `release`, então o evento é sempre da atual). */
  onEnded: () => void;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Mixer sobre o `AudioSurface` da plataforma; `null` (ou superfície sem contexto) = mixer mudo. */
export function createMixer(surface: AudioSurface | null): Mixer {
  const ctx = (surface?.context ?? null) as AudioContextLike | null;
  return ctx ? createLiveMixer(ctx) : createSilentMixer();
}

function createSilentMixer(): Mixer {
  const stats = { activeVoices: 0, peakVoices: 0, played: 0, stolen: 0, dropped: 0, unknown: 0 };
  return {
    available: false,
    context: null,
    stats,
    decode: (name) => Promise.reject(new Error(`áudio indisponível: ${name} não decodificado`)),
    synthesize: (name) => {
      throw new Error(`áudio indisponível: ${name} não sintetizado`);
    },
    has: () => false,
    setListener: () => {},
    setListenerCount: () => {},
    play: () => {
      stats.dropped++;
      return -1;
    },
    stopAll: () => {},
    setBusVolume: () => {},
    setMono: () => {},
    suspend: () => Promise.resolve(),
    resume: () => Promise.resolve(),
    resetStats: () => {
      stats.peakVoices = 0;
      stats.played = 0;
      stats.stolen = 0;
      stats.dropped = 0;
      stats.unknown = 0;
    },
    playMusic: () => false,
    stopMusic: () => {},
    music: null,
    duckMusic: () => {},
    dispose: () => {},
  };
}

/** Uma das 2 vozes da música (crossfade): fonte em loop → ganho do fade → ganho do "duck" → canal da música. */
interface MusicVoice {
  readonly fade: GainNodeLike;
  source: AudioBufferSourceNodeLike | null;
  name: string | null;
}

/** Fade padrão da música (s). */
const MUSIC_FADE_S = 0.8;
/** Ataque do "duck" (s). */
const DUCK_ATTACK_S = 0.05;

function createLiveMixer(ctx: AudioContextLike): Mixer {
  const sounds = new Map<string, AudioBufferLike>();
  const listeners = createListenerSet(MAX_LISTENERS);
  const spatial: SpatialResult = { gain: 0, pan: 0, listener: 0, distance: 0 };
  const stats = { activeVoices: 0, peakVoices: 0, played: 0, stolen: 0, dropped: 0, unknown: 0 };
  let mono = false;
  let serial = 0;
  let disposed = false;

  const master = ctx.createGain();
  master.connect(ctx.destination);
  // Índices iguais aos de AUDIO_BUSES; o 0 (master) toca direto no master.
  const buses: GainNodeLike[] = AUDIO_BUSES.map((bus) => {
    if (bus === 'master') return master;
    const g = ctx.createGain();
    g.connect(master);
    return g;
  });
  const busIndex = (bus: AudioBus): number => {
    const i = AUDIO_BUSES.indexOf(bus);
    return i < 0 ? 1 : i;
  };

  // M2 (fase 7d): a música, com 2 vozes para o crossfade, sobre um ganho de "duck" comum.
  const duck = ctx.createGain();
  duck.connect(buses[busIndex('music')]!);
  const music: MusicVoice[] = [0, 1].map(() => {
    const fade = ctx.createGain();
    fade.gain.value = 0;
    fade.connect(duck);
    return { fade, source: null, name: null };
  });
  let musicActive = -1;
  /** Quando a voz que saiu termina o fade (relógio do contexto); a liberação acontece na próxima chamada ao mixer. */
  const musicReleaseAt = [Infinity, Infinity];
  const stopMusicVoice = (m: MusicVoice): void => {
    const src = m.source;
    m.source = null;
    m.name = null;
    if (!src) return;
    try {
      src.stop();
    } catch {
      // já tinha parado
    }
    try {
      src.disconnect();
    } catch {
      // já desconectado
    }
  };
  const fadeTo = (m: MusicVoice, target: number, fadeS: number): void => {
    const now = ctx.currentTime;
    const g = m.fade.gain;
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(target, now + Math.max(0.01, fadeS));
  };
  /** Marca a voz `i` para soltar depois do fade (sem timer: o pacote não depende do runtime). */
  const releaseAfter = (i: number, fadeS: number): void => {
    musicReleaseAt[i] = ctx.currentTime + fadeS + 0.05;
  };
  /** Solta as vozes da música que já terminaram o fade (chamado no `play` e nas chamadas da música). */
  const reclaimMusic = (now: number): void => {
    for (let i = 0; i < 2; i++) {
      if (i === musicActive || now < musicReleaseAt[i]!) continue;
      musicReleaseAt[i] = Infinity;
      stopMusicVoice(music[i]!);
    }
  };

  const voices: Voice[] = [];
  for (let i = 0; i < MAX_VOICES; i++) {
    const panner = ctx.createStereoPanner();
    const gain = ctx.createGain();
    panner.connect(gain);
    gain.connect(buses[1]!);
    const voice: Voice = {
      panner,
      gain,
      source: null,
      bus: 1,
      priority: 0,
      level: 0,
      endTime: 0,
      serial: 0,
      onEnded: () => release(voice),
    };
    voices.push(voice);
  }

  const release = (v: Voice): void => {
    const s = v.source;
    if (!s) return;
    v.source = null;
    s.onended = null;
    try {
      s.stop();
    } catch {
      // já tinha parado
    }
    try {
      s.disconnect();
    } catch {
      // já desconectado
    }
    stats.activeVoices--;
  };

  /** Recupera vozes cujo som já acabou pelo relógio (o `onended` pode chegar atrasado ou não chegar). */
  const reclaim = (now: number): void => {
    for (let i = 0; i < MAX_VOICES; i++) {
      const v = voices[i]!;
      if (v.source && v.endTime <= now) release(v);
    }
  };

  /** Voz livre, ou a mais fraca que um som de `priority`/`level` pode tomar; -1 se nenhuma. */
  const pickVoice = (priority: number, level: number): number => {
    let victim = -1;
    for (let i = 0; i < MAX_VOICES; i++) {
      const v = voices[i]!;
      if (!v.source) return i;
      if (victim < 0) {
        victim = i;
        continue;
      }
      const w = voices[victim]!;
      if (
        v.priority < w.priority ||
        (v.priority === w.priority && (v.level < w.level || (v.level === w.level && v.serial < w.serial)))
      )
        victim = i;
    }
    if (victim < 0) return -1;
    const w = voices[victim]!;
    if (w.priority > priority || (w.priority === priority && w.level > level)) return -1;
    release(w);
    stats.stolen++;
    return victim;
  };

  const info = (name: string, b: AudioBufferLike): SoundInfo => ({
    name,
    durationS: b.duration,
    sampleRate: b.sampleRate,
    channels: b.numberOfChannels,
  });

  return {
    available: true,
    context: ctx,
    stats,
    async decode(name, bytes) {
      // Cópia própria: o decodeAudioData do navegador "desliga" o ArrayBuffer recebido.
      const copy = bytes.slice().buffer as ArrayBuffer;
      const buffer = await ctx.decodeAudioData(copy);
      sounds.set(name, buffer);
      return info(name, buffer);
    },
    synthesize(name, pcm, sampleRate) {
      if (typeof ctx.createBuffer !== 'function') throw new Error('createBuffer ausente no contexto de áudio');
      const buffer = ctx.createBuffer(1, pcm.length, sampleRate);
      buffer.getChannelData(0).set(pcm);
      sounds.set(name, buffer);
      return info(name, buffer);
    },
    has: (name) => sounds.has(name),
    setListener(slot, x, y, z, yaw) {
      if (slot < 0 || slot >= MAX_LISTENERS) return;
      listeners.x[slot] = x;
      listeners.y[slot] = y;
      listeners.z[slot] = z;
      listeners.yaw[slot] = yaw;
    },
    setListenerCount(count) {
      listeners.count = Math.max(1, Math.min(MAX_LISTENERS, Math.floor(count)));
    },
    play(sound, opts) {
      if (disposed) return -1;
      const buffer = sounds.get(sound);
      if (!buffer) {
        stats.unknown++;
        stats.dropped++;
        return -1;
      }
      let gain = clamp01(opts.volume ?? 1);
      let pan = opts.pan ?? 0;
      if (opts.x !== undefined) {
        spatialize(listeners, opts.x, opts.y ?? 0, opts.z ?? 0, spatial);
        gain *= spatial.gain;
        pan = spatial.pan;
      }
      if (gain <= 0) {
        stats.dropped++;
        return -1;
      }
      const now = ctx.currentTime;
      reclaim(now);
      reclaimMusic(now);
      const priority = opts.priority ?? SOUND_PRIORITY.step;
      const index = pickVoice(priority, gain);
      if (index < 0) {
        stats.dropped++;
        return -1;
      }
      const v = voices[index]!;
      const bus = busIndex(opts.bus);
      if (bus !== v.bus) {
        v.gain.disconnect();
        v.gain.connect(buses[bus]!);
        v.bus = bus;
      }
      const rate = opts.rate ?? 1;
      v.gain.gain.value = gain;
      v.panner.pan.value = mono ? 0 : pan < -1 ? -1 : pan > 1 ? 1 : pan;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      if (rate !== 1) source.playbackRate.value = rate;
      source.connect(v.panner);
      source.onended = v.onEnded;
      v.source = source;
      v.priority = priority;
      v.level = gain;
      v.serial = ++serial;
      v.endTime = now + buffer.duration / (rate > 0 ? rate : 1) + 0.05;
      source.start();
      stats.played++;
      stats.activeVoices++;
      if (stats.activeVoices > stats.peakVoices) stats.peakVoices = stats.activeVoices;
      return index;
    },
    stopAll() {
      for (let i = 0; i < MAX_VOICES; i++) release(voices[i]!);
    },
    setBusVolume(bus, volume) {
      buses[busIndex(bus)]!.gain.value = clamp01(volume);
    },
    setMono(on) {
      mono = on;
      if (on) for (let i = 0; i < MAX_VOICES; i++) voices[i]!.panner.pan.value = 0;
    },
    suspend: () => ctx.suspend().catch(() => {}),
    resume: () => ctx.resume().catch(() => {}),
    resetStats() {
      stats.peakVoices = stats.activeVoices;
      stats.played = 0;
      stats.stolen = 0;
      stats.dropped = 0;
      stats.unknown = 0;
    },
    get music() {
      return musicActive >= 0 ? music[musicActive]!.name : null;
    },
    playMusic(name, fadeS = MUSIC_FADE_S) {
      if (disposed) return false;
      const buffer = sounds.get(name);
      if (!buffer) {
        stats.unknown++;
        return false;
      }
      reclaimMusic(ctx.currentTime);
      if (musicActive >= 0 && music[musicActive]!.name === name) return true;
      const old = musicActive;
      const next = old === 0 ? 1 : 0;
      const m = music[next]!;
      musicReleaseAt[next] = Infinity;
      stopMusicVoice(m);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(m.fade);
      m.source = source;
      m.name = name;
      m.fade.gain.value = 0;
      fadeTo(m, 1, fadeS);
      source.start();
      musicActive = next;
      if (old >= 0) {
        fadeTo(music[old]!, 0, fadeS);
        releaseAfter(old, fadeS);
      }
      return true;
    },
    stopMusic(fadeS = MUSIC_FADE_S) {
      reclaimMusic(ctx.currentTime);
      if (musicActive < 0) return;
      const i = musicActive;
      musicActive = -1;
      fadeTo(music[i]!, 0, fadeS);
      releaseAfter(i, fadeS);
    },
    duckMusic(db, releaseS) {
      if (disposed) return;
      const now = ctx.currentTime;
      const low = Math.min(1, 10 ** (Math.min(0, db) / 20));
      const g = duck.gain;
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(low, now + DUCK_ATTACK_S);
      g.linearRampToValueAtTime(1, now + DUCK_ATTACK_S + Math.max(0.05, releaseS));
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (let i = 0; i < 2; i++) {
        stopMusicVoice(music[i]!);
        music[i]!.fade.disconnect();
      }
      musicActive = -1;
      duck.disconnect();
      for (let i = 0; i < MAX_VOICES; i++) {
        const v = voices[i]!;
        release(v);
        v.panner.disconnect();
        v.gain.disconnect();
      }
      for (const b of buses) b.disconnect();
      sounds.clear();
    },
  };
}
