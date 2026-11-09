import { describe, expect, it } from 'vitest';
import { barSamples, cutLoop, findOffset, loopSamples, parseMusicTable, readMusicTable, wrapPad } from './music.ts';
import { MUSIC_TABLE } from './paths.ts';

/** M2, fase 7d: a música do menu em loop. */

describe('audioconv: música', () => {
  it('a tabela de verdade: a "Toy Soldiers", CC0, 48 compassos a 135 BPM a partir de uma cabeça de compasso', () => {
    const [t] = readMusicTable(MUSIC_TABLE);
    expect(t).toMatchObject({ out: 'menu', title: 'Toy Soldiers', author: 'Zane Little Music', bpm: 135, bars: 48 });
    // 135 BPM a 44,1 kHz: compasso de exatamente 78.400 amostras; o loop, 85,333 s.
    expect(barSamples(t!)).toBe(78_400);
    expect(loopSamples(t!) / t!.sampleRate).toBeCloseTo(85.3333, 3);
    expect(t!.source.startsWith('local/')).toBe(true);
  });

  it('recusa o que não é CC0 e nome de saída estranho', () => {
    const base = {
      out: 'menu',
      title: 't',
      author: 'a',
      url: 'u',
      license: 'CC-BY 4.0',
      sha256: 'x',
      downloaded: 'd',
      source: 's',
      bpm: 120,
      bars: 8,
      startSample: 0,
      sampleRate: 44100,
      crossfadeS: 0.1,
      kbps: 96,
    };
    expect(() => parseMusicTable(JSON.stringify({ tracks: [base] }))).toThrow(/CC0/);
    expect(() => parseMusicTable(JSON.stringify({ tracks: [{ ...base, license: 'CC0', out: 'Menu!' }] }))).toThrow(
      /saída/,
    );
  });

  it('num sinal periódico, o loop recortado com crossfade é igual ao original e emenda sem degrau', () => {
    const period = 400;
    const signal = new Float32Array(period * 50);
    for (let i = 0; i < signal.length; i++) signal[i] = Math.sin((2 * Math.PI * i) / period) * 0.8;
    const loop = cutLoop(signal, period * 3, period * 20, 250);
    for (let i = 0; i < loop.length; i++) expect(loop[i]).toBeCloseTo(signal[period * 3 + i]!, 5);
    // Emenda: do último para o primeiro, o passo é do tamanho de um passo comum da onda.
    const typical = Math.abs(signal[1]! - signal[0]!);
    expect(Math.abs(loop[0]! - loop[loop.length - 1]!)).toBeLessThan(typical * 1.5);
  });

  it('o crossfade mistura o começo com o que vinha depois do fim (ganho igual, sem calombo)', () => {
    const signal = new Float32Array(100);
    signal.fill(1, 0, 60);
    signal.fill(0, 60);
    // Loop de 40 a partir de 10: o que vem depois do fim (50..) é 1 até 59 e 0 depois.
    const loop = cutLoop(signal, 10, 40, 20);
    // Os dois lados valem 1 nos primeiros 10: a soma fica em 1. Depois, só o começo (0 do lado de depois do fim).
    for (let i = 0; i < 10; i++) expect(loop[i]).toBeCloseTo(1, 6);
    expect(loop[19]).toBeCloseTo(0.975, 6);
    expect(loop[20]).toBe(1);
    expect(() => cutLoop(signal, 50, 40, 20)).toThrow(/fim/);
  });

  it('a folga circular põe o fim do loop antes e o começo depois', () => {
    const loop = new Float32Array([1, 2, 3, 4, 5]);
    expect(Array.from(wrapPad(loop, 2))).toEqual([4, 5, 1, 2, 3, 4, 5, 1, 2]);
    expect(() => wrapPad(loop, 6)).toThrow(/folga/);
  });

  it('acha o atraso do decodificador pela correlação', () => {
    const ref = new Float32Array(2000);
    for (let i = 0; i < ref.length; i++) ref[i] = Math.sin(i * 0.37) + Math.sin(i * 0.051) * 0.5;
    const shifted = new Float32Array(3000);
    shifted.set(ref, 777);
    const r = findOffset(ref, shifted, 1200, 600);
    expect(r.offset).toBe(777);
    expect(r.correlation).toBeCloseTo(1, 6);
  });
});
