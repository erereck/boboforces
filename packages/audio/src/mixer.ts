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
  AudioNodeLike,
  AudioParamLike,
  AudioSurface,
  GainNodeLike,
  StereoPannerNodeLike,
} from '@boboforces/platform-api';
import type { Disposable } from '@boboforces/shared';
import { leadingSilenceSamples } from './onset.ts';
import { createListenerSet, MAX_DISTANCE_M, spatialize, type SpatialResult } from './spatial.ts';

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
  /**
   * M12 (fase 4): alcance do som com posição (m; padrão `MAX_DISTANCE_M`). Os tiros e as explosões vão mais longe
   * (pela amostra de longe) nos mapas grandes.
   */
  readonly range?: number;
  /**
   * M12 (fase 4, revisão): fora do "duck" do canal (o `duckBus`): o que causa o abafado (o zumbido da explosão colada,
   * a morte) toca por cima dele.
   */
  readonly noDuck?: boolean;
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
  /**
   * M2 (fase 7d): troca o som `name` por um recorte dele (`durationS` a partir de `startS`, em segundos do áudio
   * decodificado), copiando os canais num buffer novo (`createBuffer`). A música usa para tirar o atraso do MP3 e
   * fechar o loop no compasso (manifesto `loop@1`). `false` se o som não existe ou o recorte não cabe.
   */
  crop(name: string, startS: number, durationS: number): boolean;
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
  /**
   * Abaixa a música `db` dB (negativo) em 50 ms e volta em `releaseS` (arte-ux §10.4: −6 dB nas explosões). M12 (fase
   * 4): `holdS` segura o abaixado antes de voltar (as vinhetas de fim de 3 s).
   */
  duckMusic(db: number, releaseS: number, holdS?: number): void;
  /**
   * M12 (fase 4): abaixa um canal `db` dB (negativo) em 50 ms, depois de `delayS` (o golpe que causou passa cheio), e
   * volta em `releaseS`. `music` é o `duckMusic` (só a faixa); `master` não abaixa.
   */
  duckBus(bus: AudioBus, db: number, releaseS: number, delayS?: number): void;
  /** M12 (fase 4): largura do pan dos sons com posição (1 = cheio; arte-ux §10.3: 0,5 com 3–4 jogadores no sofá). */
  setPanWidth(width: number): void;
  /**
   * M12 (fase 4): o ambiente do mapa: até 2 laços (`slot` 0 e 1: o vento e os grilos) em vozes próprias, fora das 24
   * (não roubam nem são roubados), no canal dos efeitos (abaixam com ele). `name` em loop com ganho `gain` em rampa de
   * `fadeS`, na velocidade `rate` (o vento é um laço curto tocado devagar); o mesmo som já tocando só muda o ganho;
   * `null` solta com fade. Som desconhecido: `false`.
   */
  setAmbient(slot: number, name: string | null, gain?: number, fadeS?: number, rate?: number): boolean;
  /**
   * M12 (fase 4): o silêncio do começo do som `name` (s; `leadingSilenceSamples`), até `maxS`, deixando 1 ms antes
   * do ataque. 0 se o som não existe ou já começa no ataque. Só mede: quem corta é o `crop`.
   */
  leadingSilenceS(name: string, maxS: number): number;
  /**
   * M3 (fase 6e): a 2ª camada da música (o Zombies em 2 camadas): `name` em loop junto com a faixa tocando, no mesmo
   * ponto do loop dela (as duas têm o mesmo tamanho), com ganho `gain` em rampa de `fadeS`. Muda só o ganho se já
   * estiver tocando. `null` solta a camada. Sem música, ou som desconhecido: `false`. Trocar ou parar a música
   * solta a camada.
   */
  setMusicLayer(name: string | null, gain?: number, fadeS?: number): boolean;
}

interface Voice {
  readonly panner: StereoPannerNodeLike;
  readonly gain: GainNodeLike;
  source: AudioBufferSourceNodeLike | null;
  /** Canal da voz (índice em `AUDIO_BUSES`; mais 4 = o canal direto, fora do "duck"). */
  bus: number;
  /** M12 (fase 4): quando a fonte atual começa (relógio do contexto; a voz roubada entra 6 ms depois). */
  startAt: number;
  /** M12 (fase 4): a fonte roubada que ainda some na rampa de 5 ms, e quando ela pode ser desligada. */
  fading: AudioBufferSourceNodeLike | null;
  fadeEnd: number;
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

/**
 * M12 (fase 4): a voz roubada some numa rampa de 5 ms e a nova entra 6 ms depois (sem o estalo do corte seco no meio
 * da onda). Sem rampa no runtime (o parâmetro só guarda o valor), o resultado é o de antes: corta e toca.
 */
const STEAL_FADE_S = 0.005;
const STEAL_START_S = 0.006;

/** O `cancelScheduledValues` do Web Audio, quando o runtime tem (o contrato da plataforma não pede). */
type CancelableParam = AudioParamLike & { cancelScheduledValues?: (time: number) => unknown };

/**
 * Segura o parâmetro no valor de agora, sem as rampas que ainda faltavam (um "duck" novo no meio da volta do outro,
 * a voz roubada de novo antes de entrar). Sem `cancelScheduledValues`, as rampas antigas ficam e as novas vêm depois.
 */
function holdParam(p: AudioParamLike, now: number): void {
  const v = p.value;
  (p as CancelableParam).cancelScheduledValues?.(now);
  p.setValueAtTime(v, now);
}

const stopQuietly = (s: AudioBufferSourceNodeLike, when?: number): void => {
  try {
    if (when === undefined) s.stop();
    else s.stop(when);
  } catch {
    // já tinha parado
  }
};
const disconnectQuietly = (n: AudioNodeLike): void => {
  try {
    n.disconnect();
  } catch {
    // já desconectado
  }
};

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
    crop: () => false,
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
    duckBus: () => {},
    setPanWidth: () => {},
    setAmbient: () => false,
    leadingSilenceS: () => 0,
    setMusicLayer: () => false,
    dispose: () => {},
  };
}

/** Uma das 2 vozes da música (crossfade): fonte em loop → ganho do fade → ganho do "duck" → canal da música. */
interface MusicVoice {
  readonly fade: GainNodeLike;
  source: AudioBufferSourceNodeLike | null;
  name: string | null;
  /** Tocando a versão mono (saída mono ligada). */
  mono: boolean;
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
  const MUSIC_BUS = busIndex('music');
  const duck = ctx.createGain();
  duck.connect(buses[MUSIC_BUS]!);
  // M12 (fase 4): o "duck" dos efeitos e da interface (a morte e a explosão colada abaixam os efeitos): as vozes
  // desses canais passam por um ganho próprio antes do canal. As da música (as vinhetas) vão direto: o `duck` da
  // música abaixa só a faixa.
  const outputs: GainNodeLike[] = AUDIO_BUSES.map((bus, i) => {
    if (bus !== 'sfx' && bus !== 'ui') return buses[i]!;
    const g = ctx.createGain();
    g.connect(buses[i]!);
    return g;
  });
  // O "duck" de cada canal ainda valendo (o nível, o fim do abaixado e o fim da volta), para juntar os pedidos.
  const duckLow = new Float64Array(AUDIO_BUSES.length).fill(1);
  const duckHoldEnd = new Float64Array(AUDIO_BUSES.length).fill(-Infinity);
  const duckEnd = new Float64Array(AUDIO_BUSES.length).fill(-Infinity);
  /**
   * Abaixa `g` (o "duck" do canal `k`) para `db` em 50 ms depois de `delayS`, segura `holdS` e volta ao cheio em
   * `releaseS`. Revisão: um "duck" que ainda segura não é encurtado nem raseado por um novo (a explosão logo depois
   * do fim não encurta a vinheta): fica o mais fundo e o que acaba mais tarde.
   */
  const duckParam = (
    k: number,
    g: AudioParamLike,
    db: number,
    releaseS: number,
    holdS: number,
    delayS: number,
  ): void => {
    const now = ctx.currentTime;
    let low = Math.min(1, 10 ** (Math.min(0, db) / 20));
    const at = now + Math.max(0, delayS);
    let hold = at + DUCK_ATTACK_S + Math.max(0, holdS);
    let end = hold + Math.max(0.05, releaseS);
    if (now < duckHoldEnd[k]!) {
      low = Math.min(low, duckLow[k]!);
      hold = Math.max(hold, duckHoldEnd[k]!);
      end = Math.max(end, duckEnd[k]!);
    }
    duckLow[k] = low;
    duckHoldEnd[k] = hold;
    duckEnd[k] = end;
    holdParam(g, now);
    if (at > now) g.setValueAtTime(g.value, at);
    g.linearRampToValueAtTime(low, at + DUCK_ATTACK_S);
    if (hold > at + DUCK_ATTACK_S) g.setValueAtTime(low, hold);
    g.linearRampToValueAtTime(1, end);
  };
  const music: MusicVoice[] = [0, 1].map(() => {
    const fade = ctx.createGain();
    fade.gain.value = 0;
    fade.connect(duck);
    return { fade, source: null, name: null, mono: false };
  });
  let musicActive = -1;
  /** Quando a voz que saiu termina o fade (relógio do contexto); a liberação acontece na próxima chamada ao mixer. */
  const musicReleaseAt = [Infinity, Infinity];
  // M3 (fase 6e): quando cada voz começou (a camada entra no mesmo ponto do loop) e a camada, com o fim do fade dela.
  const musicStartedAt = [0, 0];
  const layer: MusicVoice = { fade: ctx.createGain(), source: null, name: null, mono: false };
  layer.fade.gain.value = 0;
  layer.fade.connect(duck);
  let layerReleaseAt = Infinity;
  /** Solta a camada com fade (a voz sai no próximo `reclaimMusic` depois do fim). */
  const dropLayer = (fadeS: number): void => {
    if (!layer.source || layerReleaseAt !== Infinity) return;
    fadeTo(layer, 0, fadeS);
    layerReleaseAt = ctx.currentTime + fadeS + 0.05;
  };
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
    // M12 (fase 4, revisão): sem as rampas que ainda faltavam (a volta da pausa no meio da saída do ambiente).
    holdParam(g, now);
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
    if (now >= layerReleaseAt) {
      layerReleaseAt = Infinity;
      stopMusicVoice(layer);
    }
    for (let i = 0; i < ambientReleaseAt.length; i++) {
      if (now < ambientReleaseAt[i]!) continue;
      ambientReleaseAt[i] = Infinity;
      if (ambient) stopMusicVoice(ambient[i]!);
    }
  };
  // M12 (fase 4): o ambiente do mapa (o vento e os grilos): 2 laços fora das 24 vozes, no canal dos efeitos, criados
  // só na 1ª vez (o menu não paga os nós).
  let ambient: MusicVoice[] | null = null;
  const ambientReleaseAt = [Infinity, Infinity];
  const ambientVoices = (): MusicVoice[] =>
    (ambient ??= [0, 1].map(() => {
      const fade = ctx.createGain();
      fade.gain.value = 0;
      fade.connect(outputs[busIndex('sfx')]!);
      return { fade, source: null, name: null, mono: false };
    }));

  /** Versões mono das músicas (só com a saída mono ligada; soltas quando ela desliga). */
  const monoMusic = new Map<string, AudioBufferLike>();
  const monoOf = (name: string, b: AudioBufferLike): AudioBufferLike => {
    if (b.numberOfChannels < 2) return b;
    let m = monoMusic.get(name);
    if (m) return m;
    m = ctx.createBuffer(1, b.length, b.sampleRate);
    const out = m.getChannelData(0);
    const l = b.getChannelData(0);
    const r = b.getChannelData(1);
    for (let i = 0; i < out.length; i++) out[i] = (l[i]! + r[i]!) * 0.5;
    monoMusic.set(name, m);
    return m;
  };
  const startMusic = (name: string, fadeS: number): boolean => {
    if (disposed) return false;
    const stereo = sounds.get(name);
    if (!stereo) {
      stats.unknown++;
      return false;
    }
    reclaimMusic(ctx.currentTime);
    const wantMono = mono && stereo.numberOfChannels > 1;
    if (musicActive >= 0 && music[musicActive]!.name === name && music[musicActive]!.mono === wantMono) return true;
    const old = musicActive;
    const next = old === 0 ? 1 : 0;
    const m = music[next]!;
    musicReleaseAt[next] = Infinity;
    stopMusicVoice(m);
    const source = ctx.createBufferSource();
    source.buffer = wantMono ? monoOf(name, stereo) : stereo;
    source.loop = true;
    source.connect(m.fade);
    m.source = source;
    m.name = name;
    m.mono = wantMono;
    m.fade.gain.value = 0;
    fadeTo(m, 1, fadeS);
    source.start();
    musicStartedAt[next] = ctx.currentTime;
    musicActive = next;
    // A camada era da faixa que saiu: sai junto (quem quiser a camada na faixa nova pede de novo).
    dropLayer(fadeS);
    if (old >= 0) {
      fadeTo(music[old]!, 0, fadeS);
      releaseAfter(old, fadeS);
    }
    return true;
  };

  const voices: Voice[] = [];
  for (let i = 0; i < MAX_VOICES; i++) {
    const panner = ctx.createStereoPanner();
    const gain = ctx.createGain();
    panner.connect(gain);
    gain.connect(outputs[1]!);
    const voice: Voice = {
      panner,
      gain,
      source: null,
      bus: 1,
      startAt: 0,
      fading: null,
      fadeEnd: 0,
      priority: 0,
      level: 0,
      endTime: 0,
      serial: 0,
      onEnded: () => release(voice),
    };
    voices.push(voice);
  }

  /** Desliga a fonte roubada que ainda sumia na rampa. */
  const dropFading = (v: Voice): void => {
    const f = v.fading;
    if (!f) return;
    v.fading = null;
    stopQuietly(f);
    disconnectQuietly(f);
  };

  const release = (v: Voice): void => {
    dropFading(v);
    const s = v.source;
    if (!s) return;
    v.source = null;
    s.onended = null;
    stopQuietly(s);
    disconnectQuietly(s);
    stats.activeVoices--;
  };

  /**
   * M12 (fase 4): a voz cedida a um som mais importante: a fonte some numa rampa de 5 ms (sem estalo) e é desligada
   * depois (`reclaim`). A que ainda não tinha começado (roubada de novo no mesmo instante) sai seca: nunca soou.
   */
  const steal = (v: Voice, now: number): void => {
    const s = v.source;
    if (!s) return;
    v.source = null;
    s.onended = null;
    stats.activeVoices--;
    if (v.startAt > now) {
      stopQuietly(s);
      disconnectQuietly(s);
      return;
    }
    dropFading(v);
    const g = v.gain.gain;
    holdParam(g, now);
    g.linearRampToValueAtTime(0, now + STEAL_FADE_S);
    stopQuietly(s, now + STEAL_FADE_S);
    v.fading = s;
    v.fadeEnd = now + STEAL_FADE_S + 0.05;
  };

  /** Recupera vozes cujo som já acabou pelo relógio (o `onended` pode chegar atrasado ou não chegar). */
  const reclaim = (now: number): void => {
    for (let i = 0; i < MAX_VOICES; i++) {
      const v = voices[i]!;
      if (v.fading && v.fadeEnd <= now) dropFading(v);
      if (v.source && v.endTime <= now) release(v);
    }
  };

  /** Voz livre, ou a mais fraca que um som de `priority`/`level` pode tomar; -1 se nenhuma. `stolen` diz se roubou. */
  let stolen = false;
  const pickVoice = (priority: number, level: number, now: number): number => {
    stolen = false;
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
    steal(w, now);
    stolen = true;
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
        spatialize(listeners, opts.x, opts.y ?? 0, opts.z ?? 0, spatial, opts.range ?? MAX_DISTANCE_M);
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
      const index = pickVoice(priority, gain, now);
      if (index < 0) {
        stats.dropped++;
        return -1;
      }
      const v = voices[index]!;
      // A saída: o "duck" do canal, ou o canal direto (`noDuck`, índices depois dos 4).
      const bus = busIndex(opts.bus) + (opts.noDuck === true ? AUDIO_BUSES.length : 0);
      if (bus !== v.bus) {
        // Trocar de canal desliga a saída: a rampa da voz roubada (se houver) corta seca, como antes.
        v.gain.disconnect();
        v.gain.connect(bus < AUDIO_BUSES.length ? outputs[bus]! : buses[bus - AUDIO_BUSES.length]!);
        v.bus = bus;
        dropFading(v);
      }
      const rate = opts.rate ?? 1;
      const panValue = mono ? 0 : pan < -1 ? -1 : pan > 1 ? 1 : pan;
      // M12 (fase 4): na voz roubada, o som novo entra 6 ms depois, quando a rampa da velha já zerou.
      const startAt = stolen && v.fading ? now + STEAL_START_S : now;
      if (startAt > now) {
        v.gain.gain.setValueAtTime(gain, startAt);
        v.panner.pan.setValueAtTime(panValue, startAt);
      } else {
        // A voz roubada há pouco ainda pode ter rampa marcada para a frente: ela sai antes do valor novo.
        if (v.fadeEnd > now) {
          (v.gain.gain as CancelableParam).cancelScheduledValues?.(now);
          (v.panner.pan as CancelableParam).cancelScheduledValues?.(now);
        }
        v.gain.gain.value = gain;
        v.panner.pan.value = panValue;
      }
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      if (rate !== 1) source.playbackRate.value = rate;
      source.connect(v.panner);
      source.onended = v.onEnded;
      v.source = source;
      v.startAt = startAt;
      v.priority = priority;
      v.level = gain;
      v.serial = ++serial;
      v.endTime = startAt + buffer.duration / (rate > 0 ? rate : 1) + 0.05;
      if (startAt > now) source.start(startAt);
      else source.start();
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
      // A música troca de versão (estéreo ↔ mono) com crossfade.
      const playing = musicActive >= 0 ? music[musicActive]!.name : null;
      if (playing !== null) startMusic(playing, MUSIC_FADE_S);
      if (!on) monoMusic.clear();
    },
    crop(name, startS, durationS) {
      const b = sounds.get(name);
      if (!b) return false;
      const rate = b.sampleRate;
      const from = Math.max(0, Math.round(startS * rate));
      const len = Math.round(durationS * rate);
      if (len <= 0 || from + len > b.length) return false;
      const out = ctx.createBuffer(b.numberOfChannels, len, rate);
      for (let c = 0; c < b.numberOfChannels; c++)
        out.getChannelData(c).set(b.getChannelData(c).subarray(from, from + len));
      sounds.set(name, out);
      monoMusic.delete(name);
      return true;
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
    playMusic: (name, fadeS = MUSIC_FADE_S) => startMusic(name, fadeS),
    stopMusic(fadeS = MUSIC_FADE_S) {
      reclaimMusic(ctx.currentTime);
      if (musicActive < 0) return;
      const i = musicActive;
      musicActive = -1;
      fadeTo(music[i]!, 0, fadeS);
      releaseAfter(i, fadeS);
      dropLayer(fadeS);
    },
    setMusicLayer(name, gain = 1, fadeS = MUSIC_FADE_S) {
      if (disposed) return false;
      const now = ctx.currentTime;
      reclaimMusic(now);
      if (name === null) {
        dropLayer(fadeS);
        return true;
      }
      if (musicActive < 0) return false;
      const stereo = sounds.get(name);
      if (!stereo) {
        stats.unknown++;
        return false;
      }
      if (layer.name !== name || !layer.source || layerReleaseAt !== Infinity) {
        stopMusicVoice(layer);
        layerReleaseAt = Infinity;
        const buffer = mono && stereo.numberOfChannels > 1 ? monoOf(name, stereo) : stereo;
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        source.connect(layer.fade);
        layer.source = source;
        layer.name = name;
        layer.fade.gain.value = 0;
        // O mesmo ponto do loop da faixa tocando (o relógio do contexto desde que ela começou).
        const d = buffer.duration;
        const offset = d > 0 ? (now - musicStartedAt[musicActive]!) % d : 0;
        source.start(0, offset > 0 ? offset : 0);
      }
      fadeTo(layer, Math.max(0, Math.min(1, gain)), fadeS);
      return true;
    },
    duckMusic(db, releaseS, holdS = 0) {
      if (disposed) return;
      duckParam(MUSIC_BUS, duck.gain, db, releaseS, holdS, 0);
    },
    duckBus(bus, db, releaseS, delayS = 0) {
      if (disposed) return;
      const k = busIndex(bus);
      if (bus === 'music') duckParam(k, duck.gain, db, releaseS, 0, delayS);
      else if (bus !== 'master') duckParam(k, outputs[k]!.gain, db, releaseS, 0, delayS);
    },
    setPanWidth(width) {
      listeners.panWidth = clamp01(width);
    },
    setAmbient(slot, name, gain = 1, fadeS = 1, rate = 1) {
      if (disposed || slot < 0 || slot >= ambientReleaseAt.length) return false;
      const now = ctx.currentTime;
      reclaimMusic(now);
      if (name === null) {
        const a = ambient?.[slot];
        if (a?.source && ambientReleaseAt[slot] === Infinity) {
          fadeTo(a, 0, fadeS);
          ambientReleaseAt[slot] = now + fadeS + 0.05;
        }
        return true;
      }
      const buffer = sounds.get(name);
      if (!buffer) {
        stats.unknown++;
        return false;
      }
      const a = ambientVoices()[slot]!;
      // Revisão: o mesmo laço ainda saindo (a pausa online e a volta) só volta ao ganho, sem recomeçar seco.
      if (a.name === name && a.source) ambientReleaseAt[slot] = Infinity;
      else {
        stopMusicVoice(a);
        ambientReleaseAt[slot] = Infinity;
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        if (rate !== 1) source.playbackRate.value = rate;
        source.connect(a.fade);
        a.source = source;
        a.name = name;
        a.fade.gain.value = 0;
        source.start();
      }
      fadeTo(a, clamp01(gain), fadeS);
      return true;
    },
    leadingSilenceS(name, maxS) {
      const b = sounds.get(name);
      if (!b || b.length === 0) return 0;
      return leadingSilenceSamples(b.getChannelData(0), b.sampleRate, maxS) / b.sampleRate;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (let i = 0; i < 2; i++) {
        stopMusicVoice(music[i]!);
        music[i]!.fade.disconnect();
      }
      stopMusicVoice(layer);
      layer.fade.disconnect();
      if (ambient)
        for (const a of ambient) {
          stopMusicVoice(a);
          a.fade.disconnect();
        }
      musicActive = -1;
      duck.disconnect();
      for (let i = 0; i < MAX_VOICES; i++) {
        const v = voices[i]!;
        release(v);
        v.panner.disconnect();
        v.gain.disconnect();
      }
      for (let i = 0; i < outputs.length; i++) if (outputs[i] !== buses[i]) outputs[i]!.disconnect();
      for (const b of buses) b.disconnect();
      sounds.clear();
      monoMusic.clear();
    },
  };
}
