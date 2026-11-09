import { describe, expect, it } from 'vitest';
import {
  createListenerSet,
  createMixer,
  distanceGain,
  MAX_DISTANCE_M,
  MAX_VOICES,
  nearestListener,
  REF_DISTANCE_M,
  SOUND_PRIORITY,
  spatialize,
  stereoPan,
  SYNTH_SOUNDS,
  SYNTH_SAMPLE_RATE,
  synthBeep,
  synthNoiseBurst,
} from './index.ts';
import { createFakeAudioContext, type FakeAudioContext } from './testing.ts';

const surface = (ctx: FakeAudioContext) => ({ context: ctx, unlocked: true, onUnlock: () => () => {} });
/** "MP3" sintético: o contexto falso lê o primeiro byte como duração em décimos de segundo. */
const mp3 = (tenths: number) => new Uint8Array([tenths, 0xff, 0xfb, 0x90]);

describe('música (M2, fase 7d)', () => {
  it('toca em loop numa voz própria, não recomeça a mesma faixa e faz crossfade na troca', async () => {
    const ctx = createFakeAudioContext();
    const mixer = createMixer(surface(ctx));
    expect(mixer.playMusic('menu')).toBe(false);
    await mixer.decode('menu', mp3(20));
    await mixer.decode('outra', mp3(20));
    const before = ctx.sources.length;
    expect(mixer.playMusic('menu')).toBe(true);
    const first = ctx.sources[before]!;
    expect([first.loop, first.started, mixer.music]).toEqual([true, true, 'menu']);
    expect(mixer.playMusic('menu')).toBe(true);
    expect(ctx.sources.length).toBe(before + 1);
    expect(mixer.playMusic('outra', 0.5)).toBe(true);
    expect(mixer.music).toBe('outra');
    // A velha sai no fim do fade, na próxima chamada ao mixer.
    expect(first.stopped).toBe(false);
    (ctx as { currentTime: number }).currentTime = 1;
    mixer.stopMusic(0.2);
    expect(first.stopped).toBe(true);
    expect(mixer.music).toBe(null);
    (ctx as { currentTime: number }).currentTime = 2;
    mixer.playMusic('menu');
    expect(ctx.sources[before + 1]!.stopped).toBe(true);
    // A música não ocupa voz de efeito e o "duck" volta ao cheio.
    expect(mixer.stats.activeVoices).toBe(0);
    mixer.duckMusic(-6, 0.8);
    mixer.dispose();
  });

  it('sem áudio, nada toca e nada quebra', () => {
    const mixer = createMixer(null);
    expect(mixer.playMusic('menu')).toBe(false);
    mixer.stopMusic();
    mixer.duckMusic(-6, 1);
    expect(mixer.music).toBe(null);
  });
});

describe('espacialização', () => {
  it('volume cheio até a distância de referência, cai depois e zera no alcance máximo', () => {
    expect(distanceGain(0)).toBe(1);
    expect(distanceGain(REF_DISTANCE_M)).toBe(1);
    expect(distanceGain(REF_DISTANCE_M * 2)).toBeCloseTo(0.5, 5);
    expect(distanceGain(30)).toBeLessThan(distanceGain(10));
    expect(distanceGain(MAX_DISTANCE_M - 0.01)).toBeGreaterThan(0);
    expect(distanceGain(MAX_DISTANCE_M - 0.01)).toBeLessThan(0.001);
    expect(distanceGain(MAX_DISTANCE_M)).toBe(0);
    expect(distanceGain(Number.NaN)).toBe(1);
  });

  it('pan segue a convenção de eixos do jogo (yaw 0 olha para -Z, direita = +X)', () => {
    expect(stereoPan(5, 0, 0)).toBeCloseTo(1, 6); // à direita
    expect(stereoPan(-5, 0, 0)).toBeCloseTo(-1, 6); // à esquerda
    expect(stereoPan(0, -5, 0)).toBeCloseTo(0, 6); // à frente
    // Virado 90° para a esquerda (yaw +π/2 olha para -X): o som em -X fica à frente e o em -Z fica à direita.
    expect(stereoPan(-5, 0, Math.PI / 2)).toBeCloseTo(0, 6);
    expect(stereoPan(0, -5, Math.PI / 2)).toBeCloseTo(1, 6);
    expect(stereoPan(0.5, 0, 0)).toBeCloseTo(0.5, 6); // perto: puxa para o centro
    expect(stereoPan(0, 0, 0)).toBe(0);
  });

  it('tela dividida: cada som usa o ouvinte local mais próximo', () => {
    const set = createListenerSet(4);
    set.count = 2;
    set.x[1] = 40;
    expect(nearestListener(set, 2, 0, 0)).toBe(0);
    expect(nearestListener(set, 38, 0, 0)).toBe(1);
    const out = { gain: 0, pan: 0, listener: -1, distance: 0 };
    spatialize(set, 44, 0, 0, out);
    expect(out.listener).toBe(1);
    expect(out.distance).toBeCloseTo(4, 6);
    expect(out.gain).toBeCloseTo(0.5, 5);
    expect(out.pan).toBeCloseTo(1, 6);
  });
});

describe('síntese', () => {
  it('é determinística, cabe em [-1, 1] e respeita a duração', () => {
    const a = synthNoiseBurst({ durationS: 0.2, seed: 7 });
    const b = synthNoiseBurst({ durationS: 0.2, seed: 7 });
    expect(a.length).toBe(Math.round(0.2 * SYNTH_SAMPLE_RATE));
    expect(Buffer.compare(Buffer.from(a.buffer), Buffer.from(b.buffer))).toBe(0);
    expect(
      Buffer.compare(Buffer.from(a.buffer), Buffer.from(synthNoiseBurst({ durationS: 0.2, seed: 8 }).buffer)),
    ).not.toBe(0);
    const beep = synthBeep({ frequencyHz: 440, durationS: 0.1, peak: 0.5 });
    let max = 0;
    for (const s of [...a, ...beep]) max = Math.max(max, Math.abs(s));
    expect(max).toBeLessThanOrEqual(0.8 + 1e-6);
    expect(Math.abs(beep[0]!)).toBeLessThan(0.01); // ataque sem estalo
    for (const make of Object.values(SYNTH_SOUNDS)) expect(make().length).toBeGreaterThan(1000);
  });
});

describe('mixer', () => {
  it('sem contexto é mudo e nunca lança no play', async () => {
    const mixer = createMixer(null);
    expect(mixer.available).toBe(false);
    expect(mixer.play('t0-tiro', { bus: 'sfx' })).toBe(-1);
    await expect(mixer.decode('x', mp3(2))).rejects.toThrow('áudio indisponível');
    await mixer.resume();
    mixer.dispose();
  });

  it('monta o grafo uma vez: 24 vozes (panner + gain), canais, master e a música (duck + 2 fades); tocar só cria o BufferSource', async () => {
    const ctx = createFakeAudioContext();
    const mixer = createMixer(surface(ctx));
    expect(ctx.created.panner).toBe(MAX_VOICES);
    expect(ctx.created.gain).toBe(MAX_VOICES + 4 + 3); // vozes + master + sfx + music + ui + duck e 2 fades da música
    const info = await mixer.decode('t0-tiro', mp3(3));
    expect(info.durationS).toBeCloseTo(0.3, 3);
    expect(mixer.has('t0-tiro')).toBe(true);
    const before = { ...ctx.created };
    expect(mixer.play('t0-tiro', { bus: 'sfx', pan: -0.5 })).toBe(0);
    expect(ctx.created.source).toBe(before.source + 1);
    expect(ctx.created.gain).toBe(before.gain);
    expect(ctx.created.panner).toBe(before.panner);
    const src = ctx.sources.at(-1)!;
    expect(src.started).toBe(true);
    expect(src.outputs[0]!.kind).toBe('panner');
    expect((src.outputs[0] as unknown as { pan: { value: number } }).pan.value).toBe(-0.5);
    expect(mixer.stats.activeVoices).toBe(1);
    src.end();
    expect(mixer.stats.activeVoices).toBe(0);
    expect(mixer.play('nao-existe', { bus: 'sfx' })).toBe(-1);
    expect(mixer.stats.unknown).toBe(1);
  });

  it('teto de 24 vozes por prioridade: o som fraco cede, o mais fraco não toma voz de um forte', async () => {
    const ctx = createFakeAudioContext();
    const mixer = createMixer(surface(ctx));
    await mixer.decode('s', mp3(10));
    for (let i = 0; i < MAX_VOICES; i++)
      expect(mixer.play('s', { bus: 'sfx', priority: SOUND_PRIORITY.step, volume: 0.5 })).toBeGreaterThanOrEqual(0);
    expect(mixer.stats.activeVoices).toBe(MAX_VOICES);
    // Mais um passo, mais fraco: não toca.
    expect(mixer.play('s', { bus: 'sfx', priority: SOUND_PRIORITY.step, volume: 0.1 })).toBe(-1);
    expect(mixer.stats.dropped).toBe(1);
    // Um tiro toma a voz do passo mais velho.
    expect(mixer.play('s', { bus: 'sfx', priority: SOUND_PRIORITY.shot })).toBe(0);
    expect(mixer.stats.stolen).toBe(1);
    expect(ctx.sources[0]!.stopped).toBe(true);
    expect(mixer.stats.activeVoices).toBe(MAX_VOICES);
    expect(mixer.stats.peakVoices).toBe(MAX_VOICES);
    // A fonte roubada já não libera a voz se o onended chegar atrasado.
    ctx.sources[0]!.end();
    expect(mixer.stats.activeVoices).toBe(MAX_VOICES);
  });

  it('recupera vozes pelo relógio mesmo sem onended', async () => {
    const ctx = createFakeAudioContext();
    const mixer = createMixer(surface(ctx));
    await mixer.decode('s', mp3(1));
    for (let i = 0; i < MAX_VOICES; i++) mixer.play('s', { bus: 'ui', priority: SOUND_PRIORITY.ui });
    ctx.currentTime = 1;
    expect(mixer.play('s', { bus: 'ui', priority: SOUND_PRIORITY.step })).toBe(0);
    expect(mixer.stats.activeVoices).toBe(1);
    expect(mixer.stats.stolen).toBe(0);
  });

  it('posição: atenua pela distância, pan pelo ouvinte e não gasta voz fora do alcance; mono centraliza', async () => {
    const ctx = createFakeAudioContext();
    const mixer = createMixer(surface(ctx));
    await mixer.decode('s', mp3(5));
    mixer.setListener(0, 0, 0, 0, 0);
    const v = mixer.play('s', { bus: 'sfx', x: 2 * REF_DISTANCE_M, y: 0, z: 0 });
    const panner = ctx.sources.at(-1)!.outputs[0] as unknown as {
      pan: { value: number };
      outputs: { gain: { value: number } }[];
    };
    expect(v).toBe(0);
    expect(panner.pan.value).toBeCloseTo(1, 6);
    expect(panner.outputs[0]!.gain.value).toBeCloseTo(0.5, 5);
    expect(mixer.play('s', { bus: 'sfx', x: MAX_DISTANCE_M + 1 })).toBe(-1);
    mixer.setMono(true);
    mixer.play('s', { bus: 'sfx', x: -10, z: 0 });
    expect((ctx.sources.at(-1)!.outputs[0] as unknown as { pan: { value: number } }).pan.value).toBe(0);
  });

  it('sintetiza com createBuffer e acusa runtime sem ele', () => {
    const ctx = createFakeAudioContext();
    const mixer = createMixer(surface(ctx));
    const pcm = SYNTH_SOUNDS['sintetico-bip']();
    const info = mixer.synthesize('bip', pcm, SYNTH_SAMPLE_RATE);
    expect(info.channels).toBe(1);
    expect(info.durationS).toBeCloseTo(pcm.length / SYNTH_SAMPLE_RATE, 6);
    expect(mixer.play('bip', { bus: 'ui', priority: SOUND_PRIORITY.ui })).toBe(0);
    ctx.withoutCreateBuffer();
    expect(() => mixer.synthesize('x', pcm, SYNTH_SAMPLE_RATE)).toThrow('createBuffer');
  });

  it('canais, suspend/resume e dispose', async () => {
    const ctx = createFakeAudioContext();
    const mixer = createMixer(surface(ctx));
    mixer.setBusVolume('ui', 2);
    mixer.setBusVolume('master', 0.25);
    await mixer.suspend();
    expect(ctx.state).toBe('suspended');
    await mixer.resume();
    expect(ctx.state).toBe('running');
    await mixer.decode('s', mp3(5));
    mixer.play('s', { bus: 'ui' });
    mixer.dispose();
    expect(ctx.sources[0]!.stopped).toBe(true);
    expect(mixer.play('s', { bus: 'ui' })).toBe(-1);
  });
});
