import { fnv1a32 } from '@boboforces/shared';
import { describe, expect, it } from 'vitest';
import { GAME_SYNTH_SOUNDS, GUNSHOTS, SYNTH_SAMPLE_RATE, synthGunshot, type GunshotName } from './index.ts';

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

describe('sons sintetizados do jogo (fase 7a)', () => {
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
    expect(s).toBeLessThan(1.6);
    let peak = 0;
    for (let i = 0; i < pcm.length; i++) {
      expect(Number.isFinite(pcm[i]!)).toBe(true);
      peak = Math.max(peak, Math.abs(pcm[i]!));
    }
    expect(peak).toBeGreaterThan(0.5);
    expect(peak).toBeLessThanOrEqual(0.95 + 1e-6);
    expect(Math.abs(pcm[pcm.length - 1]!)).toBeLessThan(1e-3);
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

  it('o sniper é o tiro mais longo e a SMG o mais curto', () => {
    const len = (w: GunshotName): number => synthGunshot(GUNSHOTS[w]).length;
    for (const w of Object.keys(GUNSHOTS) as GunshotName[]) {
      expect(len('sniper')).toBeGreaterThanOrEqual(len(w));
      expect(len('smg')).toBeLessThanOrEqual(len(w));
    }
  });
});
