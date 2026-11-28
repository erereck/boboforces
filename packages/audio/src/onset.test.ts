import { describe, expect, it } from 'vitest';
import { leadingSilenceSamples } from './onset.ts';

/** M12 (fase 4): o silêncio do começo dos MP3 (o atraso do lamejs), com sinais sintéticos. */

const RATE = 48000;
const ms = (x: number): number => Math.round((x / 1000) * RATE);

/** `leadMs` de silêncio (ou de "pré-eco" de nível `pre`), depois um estalo de pico 0,9 que cai. */
function click(leadMs: number, pre = 0, attackMs = 0): Float32Array {
  const out = new Float32Array(ms(200));
  const lead = ms(leadMs);
  const rise = Math.max(1, ms(attackMs));
  for (let i = 0; i < out.length; i++) {
    const s = i % 2 ? 1 : -1;
    if (i < lead) out[i] = pre * s;
    else out[i] = 0.9 * Math.min(1, (i - lead + 1) / rise) * Math.exp(-(i - lead) / ms(30)) * s;
  }
  return out;
}

describe('o silêncio do começo (M12, fase 4)', () => {
  it('corta até 1 ms antes do ataque', () => {
    expect(leadingSilenceSamples(click(13), RATE, 0.03)).toBe(ms(13) - ms(1));
  });

  it('o pré-eco abaixo de −30 dB do pico não segura o corte; acima dele, é parte do ataque', () => {
    expect(leadingSilenceSamples(click(13, 0.01), RATE, 0.03)).toBe(ms(13) - ms(1));
    expect(leadingSilenceSamples(click(13, 0.05), RATE, 0.03)).toBe(0);
  });

  it('o ataque mole não perde a subida (recua por ela)', () => {
    // A subida de 10 ms a partir de 13 ms: corta até antes dela (onde ainda está abaixo de −30 dB), não até os −20 dB.
    const cut = leadingSilenceSamples(click(13, 0, 10), RATE, 0.03);
    expect(cut).toBeGreaterThan(ms(11));
    expect(cut).toBeLessThan(ms(13));
  });

  it('nunca mais que o teto, e nada quando já começa no ataque ou é mudo', () => {
    expect(leadingSilenceSamples(click(40), RATE, 0.03)).toBe(ms(30));
    expect(leadingSilenceSamples(click(0), RATE, 0.03)).toBe(0);
    expect(leadingSilenceSamples(click(0.5), RATE, 0.03)).toBe(0);
    expect(leadingSilenceSamples(new Float32Array(1000), RATE, 0.03)).toBe(0);
  });
});
