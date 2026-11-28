import { fnv1a32 } from '@boboforces/shared';
import { describe, expect, it } from 'vitest';
import {
  AMBIENT_LOOPS,
  GAME_SYNTH_SOUNDS,
  GUNSHOTS,
  SYNTH_SAMPLE_RATE,
  synthGunshot,
  type GunshotName,
} from './index.ts';

/** Hash do PCM em 16 bits (o mesmo arredondamento do `createBuffer` não importa: trava a receita, não o float). */
const pcmHash = (pcm: Float32Array): string => {
  const q = new Int16Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) q[i] = Math.round(pcm[i]! * 32767);
  return fnv1a32(new Uint8Array(q.buffer)).toString(16).padStart(8, '0');
};

/** Cruzamentos de zero por segundo: "brilho" grosseiro do som. */
const zeroCrossings = (pcm: Float32Array): number => {
  let n = 0;
  for (let i = 1; i < pcm.length; i++) if (pcm[i - 1]! < 0 !== pcm[i]! < 0) n++;
  return n / (pcm.length / SYNTH_SAMPLE_RATE);
};

// Sintetizar todos os sons leva ~2 s sozinho, mas passa dos 5 s padrão com a suíte inteira rodando em paralelo.
describe('sons sintetizados do jogo (fase 7a)', { timeout: 30_000 }, () => {
  const names = Object.keys(GAME_SYNTH_SOUNDS);

  it('cobre as 5 armas de fogo (perto e longe) e os sons de partida e interface', () => {
    for (const w of Object.keys(GUNSHOTS)) {
      expect(names).toContain(`tiro-${w}`);
      expect(names).toContain(`tiro-${w}-longe`);
    }
    for (const n of ['foguete', 'faca-golpe', 'ploc', 'contagem-bipe', 'contagem-vai', 'vitoria', 'derrota', 'coracao'])
      expect(names).toContain(n);
  });

  it.each(names)('%s: curto, sem NaN, pico controlado e termina em silêncio', (name) => {
    const pcm = GAME_SYNTH_SOUNDS[name]!();
    const s = pcm.length / SYNTH_SAMPLE_RATE;
    expect(s).toBeGreaterThan(0.05);
    // M3 (fase 6d): a caixa de música dura o giro da Caixa Misteriosa (4 s). M12 (fase 4): as vinhetas, 3 s; os laços
    // do ambiente, até 2 s.
    const long = name === 'caixa-gira' ? 4.01 : name === 'vitoria' || name === 'derrota' ? 3.01 : 1.6;
    expect(s).toBeLessThan(AMBIENT_LOOPS.includes(name) ? 2.01 : long);
    let peak = 0;
    for (let i = 0; i < pcm.length; i++) {
      expect(Number.isFinite(pcm[i]!)).toBe(true);
      peak = Math.max(peak, Math.abs(pcm[i]!));
    }
    expect(peak).toBeGreaterThan(0.5);
    expect(peak).toBeLessThanOrEqual(0.95 + 1e-6);
    // M12 (fase 4): os laços do ambiente emendam o fim no começo (sem o fade).
    if (!AMBIENT_LOOPS.includes(name)) expect(Math.abs(pcm[pcm.length - 1]!)).toBeLessThan(1e-3);
  });

  it('M12 (fase 4): os laços do ambiente emendam sem degrau (o fim continua no começo)', () => {
    for (const name of AMBIENT_LOOPS) {
      const pcm = GAME_SYNTH_SOUNDS[name]!();
      // O passo da emenda (fim → começo) do tamanho dos passos de dentro do som.
      let maxStep = 0;
      for (let i = 1; i < pcm.length; i++) maxStep = Math.max(maxStep, Math.abs(pcm[i]! - pcm[i - 1]!));
      expect(Math.abs(pcm[0]! - pcm[pcm.length - 1]!)).toBeLessThanOrEqual(maxStep + 1e-6);
    }
  });

  it('determinístico: a mesma receita dá o mesmo PCM', () => {
    for (const name of names) expect(pcmHash(GAME_SYNTH_SOUNDS[name]!())).toBe(pcmHash(GAME_SYNTH_SOUNDS[name]!()));
  });

  it('a amostra de longe é mais escura e mais longa que a de perto (GDD §5.10)', () => {
    for (const w of Object.keys(GUNSHOTS) as GunshotName[]) {
      const near = synthGunshot(GUNSHOTS[w]);
      const far = synthGunshot(GUNSHOTS[w], true);
      expect(far.length).toBeGreaterThan(near.length);
      expect(zeroCrossings(far)).toBeLessThan(zeroCrossings(near) * 0.6);
    }
  });

  it('M10 (fase 8): o ricochete é curto e assobia descendo (o começo mais agudo que o fim)', () => {
    const pcm = GAME_SYNTH_SOUNDS['ricochete']!();
    expect(pcm.length / SYNTH_SAMPLE_RATE).toBeLessThan(0.35);
    const third = Math.floor(pcm.length / 3);
    // Pula os 10 ms do estalo (ruído) no começo.
    const start = zeroCrossings(pcm.subarray(Math.round(0.01 * SYNTH_SAMPLE_RATE), third));
    const end = zeroCrossings(pcm.subarray(2 * third));
    expect(start).toBeGreaterThan(end * 1.4);
    expect(end).toBeGreaterThan(2000);
  });

  it('M12 (fase 4): as vinhetas de 3 s, o empate de duas notas e o zunido que cai de tom', () => {
    const sec = (name: string): number => GAME_SYNTH_SOUNDS[name]!().length / SYNTH_SAMPLE_RATE;
    expect(sec('vitoria')).toBeCloseTo(3, 2);
    expect(sec('derrota')).toBeCloseTo(3, 2);
    expect(sec('empate')).toBeGreaterThan(1);
    // O zunido: curto, e o começo mais agudo que o fim (o Doppler de quem passa).
    const whiz = GAME_SYNTH_SOUNDS['zunido']!();
    expect(whiz.length / SYNTH_SAMPLE_RATE).toBeLessThan(0.15);
    const half = Math.floor(whiz.length / 2);
    expect(zeroCrossings(whiz.subarray(0, half))).toBeGreaterThan(zeroCrossings(whiz.subarray(half)) * 1.3);
    // O tique do pente é o mais curto de todos (um clique).
    for (const n of names) expect(sec('tique')).toBeLessThanOrEqual(sec(n));
  });

  it('o sniper é o tiro mais longo e a SMG o mais curto', () => {
    const len = (w: GunshotName): number => synthGunshot(GUNSHOTS[w]).length;
    for (const w of Object.keys(GUNSHOTS) as GunshotName[]) {
      expect(len('sniper')).toBeGreaterThanOrEqual(len(w));
      expect(len('smg')).toBeLessThanOrEqual(len(w));
    }
  });
});
