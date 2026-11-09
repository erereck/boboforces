import { describe, expect, it } from 'vitest';
import { createTips, createTipSignals, stepTips, TIP_RULES, tipAlpha, type TipId } from './tips.ts';

/** M2, fase 4h: as dicas de 1 linha (quando aparecem, por quanto tempo, cada uma 1 vez). */

const all = (_id: TipId): boolean => true;
const run = (st: ReturnType<typeof createTips>, sig: ReturnType<typeof createTipSignals>, s: number, can = all) => {
  const out: TipId[] = [];
  for (let t = 0; t < s; t += 0.1) {
    const id = stepTips(st, sig, 0.1, can);
    if (id !== null) out.push(id);
  }
  return out;
};

describe('dicas de 1 linha', () => {
  it('andar 5 s sem correr mostra a do correr; correr 1,5 s, a do agachar; cada uma 1 vez, com folga entre elas', () => {
    const st = createTips(true, []);
    const sig = createTipSignals();
    sig.alive = true;
    sig.moving = true;
    expect(run(st, sig, 4.8)).toEqual([]);
    expect(run(st, sig, 0.4)).toEqual(['sprint']);
    expect(tipAlpha(st)).toBe(1);
    // Correndo logo depois: a do agachar espera a dica sair e a folga passar.
    sig.sprinting = true;
    expect(run(st, sig, TIP_RULES.showS + TIP_RULES.gapS - 0.5)).toEqual([]);
    expect(run(st, sig, 1)).toEqual(['slide']);
    // Andando de novo: a do correr não volta.
    sig.sprinting = false;
    expect(run(st, sig, 20)).toEqual([]);
    expect(st.pending.has('sprint')).toBe(false);
  });

  it('pente vazio passa na frente; o inimigo longe precisa de meio segundo; sem tecla no dispositivo, espera', () => {
    const st = createTips(true, ['sprint']);
    const sig = createTipSignals();
    sig.alive = true;
    sig.farEnemy = true;
    sig.magEmpty = true;
    expect(run(st, sig, 0.2)).toEqual(['reload']);
    sig.magEmpty = false;
    // Some aos poucos no fim (o último meio segundo).
    run(st, sig, TIP_RULES.showS - 0.3);
    expect(tipAlpha(st)).toBeGreaterThan(0);
    expect(tipAlpha(st)).toBeLessThan(1);
    // Sem botão de ADS (ex.: toque sem a mira), a dica fica para quando houver.
    expect(run(st, sig, TIP_RULES.gapS + 2, (id) => id !== 'ads')).toEqual([]);
    expect(run(st, sig, 1)).toEqual(['ads']);
  });

  it('desligadas (3ª partida, "Dicas" desligado ou 2 jogadores): nenhuma; morto não conta', () => {
    const off = createTips(false, []);
    const sig = createTipSignals();
    sig.alive = true;
    sig.magEmpty = true;
    expect(run(off, sig, 10)).toEqual([]);
    const dead = createTips(true, []);
    sig.alive = false;
    expect(run(dead, sig, 10)).toEqual([]);
  });
});
