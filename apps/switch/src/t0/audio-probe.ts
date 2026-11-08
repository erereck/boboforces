// Item 19 sem o jogador (sonda tardia do boot): decodifica os 4 MP3 do romfs, sintetiza os sons de código e pede uma
// rajada acima do teto de vozes com o MASTER EM ZERO (nada sai no alto-falante). Dá os números do áudio no Eden e no
// console mesmo antes de alguém abrir a tela "Teste de áudio" (que toca de verdade e mede pan e resume).
import { createMixer, MAX_VOICES, SOUND_PRIORITY, SYNTH_SAMPLE_RATE, SYNTH_SOUNDS } from '@boboforces/audio';
import type { Platform } from '@boboforces/platform-api';
import { errorText, ms2, type T0Logger } from './log.ts';
import { BURST_PLAYS, T0_AUDIO_FILES } from './runners/audio.ts';

export async function probeAudioSilently(log: T0Logger, platform: Platform): Promise<void> {
  const surface = platform.audio;
  const mixer = createMixer(surface);
  if (!mixer.available || !mixer.context) {
    log(19, 'falha', { evento: 'sonda_boot', erro: 'sem AudioContext' });
    return;
  }
  try {
    mixer.setBusVolume('master', 0);
    const now = (): number => platform.now();
    let decoded = 0;
    let decodeMs = 0;
    const failures: string[] = [];
    for (const [name, path] of Object.entries(T0_AUDIO_FILES)) {
      try {
        const bytes = await platform.assets.loadBytes(path);
        const t0 = now();
        await mixer.decode(name, bytes);
        decodeMs += now() - t0;
        decoded++;
      } catch (error) {
        failures.push(`${name}: ${errorText(error)}`);
      }
    }
    let synth = 0;
    for (const [name, make] of Object.entries(SYNTH_SOUNDS)) {
      try {
        mixer.synthesize(name, make(), SYNTH_SAMPLE_RATE);
        synth++;
      } catch (error) {
        failures.push(`${name}: ${errorText(error)}`);
      }
    }
    let burstMs = -1;
    if (decoded > 0) {
      mixer.resetStats();
      const t0 = now();
      for (let i = 0; i < BURST_PLAYS; i++) {
        mixer.play(i % 2 ? 't0-tiro' : 't0-passo', {
          bus: 'sfx',
          pan: (i / (BURST_PLAYS - 1)) * 2 - 1,
          priority: i % 2 ? SOUND_PRIORITY.shot : SOUND_PRIORITY.step,
        });
      }
      burstMs = now() - t0;
    }
    const s = mixer.stats;
    const ok = decoded === Object.keys(T0_AUDIO_FILES).length && synth === Object.keys(SYNTH_SOUNDS).length;
    log(19, ok && s.peakVoices >= MAX_VOICES ? 'ok' : 'falha', {
      evento: 'sonda_boot',
      estado: String(mixer.context.state),
      taxa: mixer.context.sampleRate,
      mp3: decoded,
      decode_ms: ms2(decodeMs),
      sinteticos: synth,
      vozes_pico: s.peakVoices,
      roubados: s.stolen,
      descartados: s.dropped,
      rajada_ms: ms2(burstMs),
      ...(failures.length ? { erro: failures.join('; ') } : {}),
    });
  } finally {
    mixer.stopAll();
    mixer.dispose();
  }
}
