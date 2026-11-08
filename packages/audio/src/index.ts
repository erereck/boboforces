// @boboforces/audio: mixer próprio sobre o subconjunto comum de Web Audio (Context, BufferSource, Gain, StereoPanner;
// regra 9) e síntese de efeitos em PCM. Puro: o contexto chega opaco por `platform.audio` e vira `AudioContextLike`
// (platform-api); `null` = sem som, e o jogo tem que rodar assim. M1: o mínimo para o item 19 do Teste Zero (MP3 do
// romfs, 24 vozes, pan, sons sintetizados); o áudio de verdade (eventos da sim, música) é do M2.
export {
  createMixer,
  AUDIO_BUSES,
  MAX_VOICES,
  MAX_LISTENERS,
  SOUND_PRIORITY,
  type AudioBus,
  type Mixer,
  type MixerStats,
  type PlayOptions,
  type SoundInfo,
} from './mixer.ts';
export {
  distanceGain,
  stereoPan,
  nearestListener,
  spatialize,
  createListenerSet,
  REF_DISTANCE_M,
  MAX_DISTANCE_M,
  ROLLOFF,
  type ListenerSet,
  type SpatialResult,
} from './spatial.ts';
export {
  synthBeep,
  synthNoiseBurst,
  SYNTH_SOUNDS,
  SYNTH_SAMPLE_RATE,
  type BeepOptions,
  type NoiseBurstOptions,
  type SynthSoundName,
} from './synth.ts';
