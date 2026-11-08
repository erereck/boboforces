import { createFigureGameTable, FIGURE_ENVELOPE_PX } from '@boboforces/format';
import { describe, expect, it } from 'vitest';
import { FIGURE_MOTION } from './motion-config.ts';
import { createSyntheticFigureTable, ENVELOPE_SCRIPTS, EXTRA_SCRIPTS, measureEnvelope } from './rig-harness.ts';

// E.2 (PLANO §E): o motor a 60 Hz nos roteiros, contra o motor parado no mesmo ActorBuffer. Cabeça e tronco (centro
// das caixas): em regime, média de 0,3 s ≤ 1 px; no transitório, pico ≤ 2 px e no máximo 0,3 s seguidos acima de
// 1 px. Mãos e pés são relatados (o braço E na recarga e a passada saem da caixa de propósito, §B4). A recarga entrou
// no E.2 com a decisão 4 da §I (`reloadNeckX` 0,17).
const E = FIGURE_ENVELOPE_PX;

describe('E.2: envelope cosmético da animação', () => {
  const tables = [
    ['tabela de jogo', createFigureGameTable()],
    ['tabela sintética (armadas diferentes)', createSyntheticFigureTable()],
  ] as const;
  // 60 Hz é o critério do PLANO; 30 Hz (L1 e tela dividida) e 144 Hz (monitor do PC) porque as molas integram com o
  // passo do quadro e a resposta muda com a taxa (a 144 Hz já fica perto do limite contínuo).
  for (const hz of [60, 30, 144]) {
    for (const [tname, table] of tables) {
      for (const script of ENVELOPE_SCRIPTS) {
        it(`${hz} Hz, ${tname}: ${script.name}`, () => {
          const m = measureEnvelope(table, FIGURE_MOTION, script, hz);
          expect(m.headPeak).toBeLessThanOrEqual(E.peak);
          expect(m.torsoPeak).toBeLessThanOrEqual(E.peak);
          expect(m.headRegime).toBeLessThanOrEqual(E.regime);
          expect(m.torsoRegime).toBeLessThanOrEqual(E.regime);
          expect(m.headOverS).toBeLessThanOrEqual(E.peakMaxS);
          expect(m.torsoOverS).toBeLessThanOrEqual(E.peakMaxS);
          expect(Number.isFinite(m.handPeak) && Number.isFinite(m.footPeak)).toBe(true);
        });
      }
    }
  }

  it('roteiros fora do E.2 (giro, diagonal e ré, zumbi): medidos, sem NaN e no envelope', () => {
    for (const script of EXTRA_SCRIPTS) {
      const m = measureEnvelope(tables[0][1], FIGURE_MOTION, script);
      for (const v of Object.values(m)) expect(Number.isFinite(v)).toBe(true);
      expect(Math.max(m.headPeak, m.torsoPeak)).toBeLessThanOrEqual(E.peak);
      expect(Math.max(m.headRegime, m.torsoRegime)).toBeLessThanOrEqual(E.regime);
    }
  });
});
