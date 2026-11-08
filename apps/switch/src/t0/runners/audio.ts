// Item 19 do Teste Zero (tecnico.md §24.2): `decodeAudioData` dos MP3 do romfs (sons CC0 da Kenney), sons
// sintetizados com `createBuffer`, 24 vozes simultâneas (rajada no R), StereoPanner (esquerda/direita no D-pad),
// latência (a que o contexto informa + o custo do `play` em JS) e `resume()` na volta do HOME. Tudo em linhas
// `[t0] item=19` no runtime.log; a tela mostra o mesmo. O mixer é o de `@boboforces/audio` (o mesmo do jogo no M2).
import {
  createMixer,
  MAX_VOICES,
  SOUND_PRIORITY,
  SYNTH_SAMPLE_RATE,
  SYNTH_SOUNDS,
  type Mixer,
} from '@boboforces/audio';
import { GAME_ASSETS_M1, type TestItemContext, type TestRunner } from '@boboforces/game';
import { PAD_AXIS, PAD_BUTTON, type RawInputState } from '@boboforces/input';
import type { TestScreenModel } from '@boboforces/ui';
import { createT0Logger, errorText, ms2 } from '../log.ts';
import { optionalKey } from '../strings.ts';
import { createButtonEdges, createLineBook } from './common.ts';

const TITLE = optionalKey('test.audio');
const HINT = optionalKey('test.audio.hint');

/** Os 4 MP3 do T0 (nome no mixer → caminho lógico). */
export const T0_AUDIO_FILES = {
  't0-tiro': GAME_ASSETS_M1.audioShot,
  't0-impacto': GAME_ASSETS_M1.audioImpact,
  't0-passo': GAME_ASSETS_M1.audioStep,
  't0-ui': GAME_ASSETS_M1.audioUi,
} as const;

/** Sons pedidos na rajada do R: acima do teto, para ver o roubo de voz por prioridade. */
export const BURST_PLAYS = MAX_VOICES + 6;

/** Linhas fixas da tela. */
const LINE = { context: 0, decode: 1, synth: 5, voices: 7, pan: 8, latency: 9, resume: 10 } as const;

/** Campos extras do AudioContext que o contrato não exige (o nx.js e o navegador têm). */
interface LatencyInfo {
  readonly baseLatency?: number;
  readonly outputLatency?: number;
}

export function startAudioTest(ctx: TestItemContext): TestRunner {
  const log = createT0Logger(ctx.log);
  const { platform } = ctx;
  const now = (): number => platform.now();
  const book = createLineBook();
  const edges = createButtonEdges();
  const mixer: Mixer = createMixer(platform.audio);
  let disposed = false;
  let ready = false;
  let shotsTimed = 0;
  let playUsTotal = 0;
  // Passo do relógio do áudio (s): menor avanço positivo do `currentTime` visto entre frames.
  let lastClock = -1;
  let clockStep = Infinity;
  let clockSamples = 0;
  let clockLogged = false;
  let lastVoices = -1;

  if (!mixer.available || !mixer.context) {
    log(19, 'falha', { erro: 'sem AudioContext' });
    book.set(LINE.context, optionalKey('test.line.noAudio'), '', 'fail');
  } else {
    const c = mixer.context;
    const lat = c as unknown as LatencyInfo;
    log(19, 'info', {
      evento: 'contexto',
      estado: String(c.state),
      taxa: c.sampleRate,
      latencia_base_ms: typeof lat.baseLatency === 'number' ? ms2(lat.baseLatency * 1000) : '-',
      latencia_saida_ms: typeof lat.outputLatency === 'number' ? ms2(lat.outputLatency * 1000) : '-',
      createBuffer: typeof c.createBuffer === 'function',
      stereoPanner: typeof c.createStereoPanner === 'function',
    });
    book.set(LINE.context, null, `${String(c.state)} ${c.sampleRate} Hz`, c.state === 'running' ? 'ok' : 'wait');
    book.set(
      LINE.latency,
      optionalKey('test.line.latency'),
      typeof lat.outputLatency === 'number' ? `${ms2(lat.outputLatency * 1000)} ms` : '-',
      'info',
    );
    void load();
  }

  async function load(): Promise<void> {
    let line: number = LINE.decode;
    let decodeOk = 0;
    for (const [name, path] of Object.entries(T0_AUDIO_FILES)) {
      const row = line++;
      book.set(row, optionalKey('test.line.decode'), name, 'wait');
      try {
        const bytes = await platform.assets.loadBytes(path);
        const t0 = now();
        const info = await mixer.decode(name, bytes);
        if (disposed) return;
        const ms = now() - t0;
        decodeOk++;
        log(19, 'ok', {
          evento: 'decode',
          arquivo: name,
          bytes: bytes.length,
          ms: ms2(ms),
          duracao_ms: ms2(info.durationS * 1000),
          taxa: info.sampleRate,
          canais: info.channels,
        });
        book.set(
          row,
          optionalKey('test.line.decode'),
          `${name} ${ms2(info.durationS * 1000)} ms (${ms2(ms)} ms)`,
          'ok',
        );
      } catch (error) {
        if (disposed) return;
        log(19, 'falha', { evento: 'decode', arquivo: name, erro: errorText(error) });
        book.set(row, optionalKey('test.line.decode'), `${name} ${errorText(error)}`, 'fail');
      }
    }
    let synthOk = 0;
    for (const [name, make] of Object.entries(SYNTH_SOUNDS)) {
      try {
        const t0 = now();
        const pcm = make();
        const info = mixer.synthesize(name, pcm, SYNTH_SAMPLE_RATE);
        synthOk++;
        log(19, 'ok', { evento: 'sintetico', nome: name, ms: ms2(now() - t0), duracao_ms: ms2(info.durationS * 1000) });
      } catch (error) {
        log(19, 'falha', { evento: 'sintetico', nome: name, erro: errorText(error) });
      }
    }
    const synthCount = Object.keys(SYNTH_SOUNDS).length;
    book.set(
      LINE.synth,
      optionalKey('test.line.synth'),
      `${synthOk} / ${synthCount}`,
      synthOk === synthCount ? 'ok' : 'fail',
    );
    log(19, decodeOk === 4 && synthOk === synthCount ? 'ok' : 'falha', {
      evento: 'carregado',
      mp3: decodeOk,
      sinteticos: synthOk,
    });
    ready = true;
  }

  const playTimed = (name: string, pan: number, priority: number): number => {
    const t0 = now();
    const voice = mixer.play(name, { bus: 'sfx', pan, priority });
    const us = (now() - t0) * 1000;
    if (voice >= 0 && shotsTimed < 64) {
      shotsTimed++;
      playUsTotal += us;
      if (shotsTimed === 1 || shotsTimed === 16) {
        log(19, 'info', { evento: 'tiro', play_us_medio: Math.round(playUsTotal / shotsTimed), amostras: shotsTimed });
      }
    }
    return voice;
  };

  const panTest = (side: -1 | 1): void => {
    mixer.play('t0-ui', { bus: 'ui', pan: side, priority: SOUND_PRIORITY.ui });
    log(19, 'info', { evento: 'pan', lado: side < 0 ? 'esquerda' : 'direita' });
    book.set(LINE.pan, optionalKey('test.line.pan'), side < 0 ? '-1' : '+1', 'ok');
  };

  const unsubscribeResume = platform.lifecycle.onResume(() => {
    if (!mixer.available) return;
    const before = String(mixer.context?.state);
    const t0 = now();
    void mixer.resume().then(() => {
      if (disposed) return;
      const after = String(mixer.context?.state);
      log(19, after === 'running' ? 'ok' : 'falha', {
        evento: 'resume',
        antes: before,
        depois: after,
        ms: ms2(now() - t0),
      });
      book.set(
        LINE.resume,
        optionalKey('test.line.resume'),
        `${before} > ${after}`,
        after === 'running' ? 'ok' : 'fail',
      );
    });
  });

  return {
    finished: false,
    update(raw: Readonly<RawInputState>) {
      edges.update(raw);
      const c = mixer.context;
      if (c) {
        const t = c.currentTime;
        if (lastClock >= 0 && t > lastClock) {
          clockStep = Math.min(clockStep, t - lastClock);
          clockSamples++;
        }
        lastClock = t;
        if (!clockLogged && clockSamples >= 60) {
          clockLogged = true;
          log(19, 'info', { evento: 'relogio', passo_ms: ms2(clockStep * 1000), estado: String(c.state) });
        }
      }
      if (!ready) return;
      const pad0 = raw.gamepads[0];
      const stickPan = pad0 ? (pad0.axes[PAD_AXIS.leftX] ?? 0) : 0;
      if (edges.anyPressed(PAD_BUTTON.faceRight) >= 0) playTimed('t0-tiro', stickPan, SOUND_PRIORITY.shot);
      // Botões por POSIÇÃO (`PAD_BUTTON`): no Switch o X é o de cima (`faceUp`) e o Y o da esquerda (`faceLeft`).
      if (edges.anyPressed(PAD_BUTTON.faceUp) >= 0)
        mixer.play('t0-impacto', { bus: 'sfx', pan: stickPan, priority: SOUND_PRIORITY.impact });
      if (edges.anyPressed(PAD_BUTTON.faceLeft) >= 0)
        mixer.play('t0-passo', { bus: 'sfx', pan: stickPan, priority: SOUND_PRIORITY.step });
      if (edges.anyPressed(PAD_BUTTON.dpadUp) >= 0) mixer.play('t0-ui', { bus: 'ui', priority: SOUND_PRIORITY.ui });
      if (edges.anyPressed(PAD_BUTTON.bumperLeft) >= 0) {
        mixer.play('sintetico-bip', { bus: 'ui', priority: SOUND_PRIORITY.ui });
        mixer.play('sintetico-tiro', { bus: 'sfx', priority: SOUND_PRIORITY.shot });
        log(19, 'info', { evento: 'sinteticos_tocados' });
      }
      if (edges.anyPressed(PAD_BUTTON.dpadLeft) >= 0) panTest(-1);
      if (edges.anyPressed(PAD_BUTTON.dpadRight) >= 0) panTest(1);
      if (edges.anyPressed(PAD_BUTTON.bumperRight) >= 0) {
        mixer.resetStats();
        const t0 = now();
        // Rajada espalhada no estéreo, com prioridades misturadas: o teto de 24 tem que segurar e roubar certo.
        for (let i = 0; i < BURST_PLAYS; i++) {
          const name = i % 3 === 0 ? 't0-tiro' : i % 3 === 1 ? 't0-impacto' : 't0-passo';
          const priority =
            i % 3 === 0 ? SOUND_PRIORITY.shot : i % 3 === 1 ? SOUND_PRIORITY.impact : SOUND_PRIORITY.step;
          mixer.play(name, { bus: 'sfx', pan: (i / (BURST_PLAYS - 1)) * 2 - 1, priority });
        }
        const s = mixer.stats;
        log(19, s.peakVoices >= MAX_VOICES ? 'ok' : 'falha', {
          evento: 'rajada',
          pedidos: BURST_PLAYS,
          vozes_pico: s.peakVoices,
          tocados: s.played,
          roubados: s.stolen,
          descartados: s.dropped,
          ms: ms2(now() - t0),
        });
      }
      const voices = mixer.stats.activeVoices;
      if (voices !== lastVoices) {
        lastVoices = voices;
        book.set(LINE.voices, optionalKey('test.line.voices'), `${voices} / ${MAX_VOICES}`, 'info');
      }
    },
    describe(out: TestScreenModel) {
      book.describe(out, TITLE, HINT);
    },
    dispose() {
      disposed = true;
      unsubscribeResume();
      mixer.dispose();
    },
  };
}
