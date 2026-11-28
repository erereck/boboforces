import { describe, expect, it } from 'vitest';
import { NULL_ENTITY, ROUND, ROUND_PHASE, type SimView } from '@boboforces/sim';
import { DEFAULT_TOUCH_LAYOUT } from '@boboforces/input';
import { createHudModel } from '@boboforces/ui';
import {
  createMatchFeel,
  createTouchBounds,
  createHudFeel,
  detectMoments,
  endBannerIn,
  endSlowFactor,
  feelDamage,
  feelDeath,
  feelEnd,
  feelHit,
  feelKill,
  feelPoints,
  feelScores,
  fillFeelHud,
  HUD_FEEL,
  momentTexts,
  reloadProgress,
  reloadPrompt,
  resultCount,
  showNotice,
  stepMatchFeel,
  stepHudFeel,
  streakTexts,
  touchBounds,
} from './hud-feel.ts';

/** M12 (fase 2): os tempos e os estados da HUD com peso (sem desenho: o que o `scene/match.ts` passa para a HUD). */

const cam = { x: 0, z: 0, yaw: 0 };
const tx = streakTexts();

function fill(f = createHudFeel(), reduce = false) {
  const m = createHudModel();
  m.health = 100;
  m.maxHealth = 100;
  fillFeelHud(m, f, cam, reduce);
  return m;
}

describe('hitmarker e X de abate', () => {
  it('hitmarker: cheio 60 ms, some em 0,2 s (~0,26 s visível); o pop fecha em 50 ms; cinza sem dano', () => {
    const f = createHudFeel();
    feelHit(f, false, false);
    let m = fill(f);
    expect([m.hitMarker, m.headshotMarker, m.hitPop]).toEqual([1, 0, 1]);
    stepHudFeel(f, 0.05);
    m = fill(f);
    expect(m.hitMarker).toBe(1);
    expect(m.hitPop).toBe(0);
    stepHudFeel(f, 0.11);
    expect(fill(f).hitMarker).toBeCloseTo(0.5, 5);
    stepHudFeel(f, 0.11);
    expect(fill(f).hitMarker).toBe(0);
    feelHit(f, true, true);
    m = fill(f);
    expect([m.headshotMarker, m.hitZero]).toEqual([1, true]);
    // Um acerto com dano no mesmo instante não fica cinza.
    feelHit(f, false, false);
    expect(fill(f).hitZero).toBe(false);
    // Reduzir efeitos: sem o pop.
    expect(fill(f, true).hitPop).toBe(0);
  });

  it('X de abate: 0,4 s, começa 1,4× e encolhe em 80 ms; o nome 1,2 s; a batida 150 ms', () => {
    const f = createHudFeel();
    feelKill(f, 10, 'NORMAL BOB', true, 77, true, tx);
    let m = fill(f);
    expect([m.killMarker, m.killScale, m.killHead, m.killName, m.killNameAlpha, m.killsBeat]).toEqual([
      1,
      HUD_FEEL.killScale,
      true,
      'NORMAL BOB',
      1,
      1,
    ]);
    stepHudFeel(f, 0.08);
    m = fill(f);
    expect(m.killScale).toBe(1);
    expect(m.killsBeat).toBeCloseTo(1 - 0.08 / HUD_FEEL.beatS, 5);
    stepHudFeel(f, 0.08);
    expect(fill(f).killsBeat).toBe(0);
    stepHudFeel(f, 0.32);
    m = fill(f);
    expect(m.killMarker).toBe(0);
    expect(m.killNameAlpha).toBe(1);
    stepHudFeel(f, 0.8);
    expect(fill(f).killNameAlpha).toBe(0);
    // Reduzir efeitos: sem a escala nem a batida.
    feelKill(f, 20, 'X', false, 78, true, tx);
    expect([fill(f, true).killScale, fill(f, true).killsBeat]).toEqual([1, 0]);
  });
});

describe('sequências (AM11)', () => {
  it('ABATE DUPLO em 3 s, 3 e 5 SEGUIDOS, NA CABEÇA, e a VINGANÇA vence todas', () => {
    const f = createHudFeel();
    feelKill(f, 0, 'A', false, 1, true, tx);
    expect(f.streak).toBe('');
    feelKill(f, 2, 'B', false, 2, true, tx);
    expect(f.streak).toBe(tx.double);
    feelKill(f, 10, 'C', false, 3, true, tx);
    expect(f.streak).toBe(tx.three);
    feelKill(f, 20, 'D', true, 4, true, tx);
    expect(f.streak).toBe(tx.head);
    feelKill(f, 30, 'E', false, 5, true, tx);
    expect(f.streak).toBe(tx.five);
    // Morreu para o 9: a sequência zera e o 9 vira a vingança.
    feelDeath(f, 9, 100);
    expect(f.run).toBe(0);
    feelKill(f, 40, 'F', true, 9, true, tx);
    expect(f.streak).toBe(tx.revenge);
    expect(f.revenge).toBe(NULL_ENTITY);
    // Cair no vazio (sem matador) não apaga a vingança de antes.
    feelDeath(f, 9, 100);
    feelDeath(f, NULL_ENTITY, 100);
    expect(f.revenge).toBe(9);
  });

  it('fora do Zombies só: com `streaks` falso, nada de texto (o X e o nome continuam)', () => {
    const f = createHudFeel();
    feelKill(f, 0, 'ZUMBI', true, 1, false, tx);
    feelKill(f, 1, 'ZUMBI', true, 2, false, tx);
    expect(f.streak).toBe('');
    expect(fill(f).killMarker).toBe(1);
  });
});

describe('vida e dano', () => {
  it('o rastro escorre em 0,4 s depois do dano; a cura apaga', () => {
    const f = createHudFeel();
    const m = createHudModel();
    m.maxHealth = 100;
    m.health = 100;
    fillFeelHud(m, f, cam, false);
    m.health = 60;
    fillFeelHud(m, f, cam, false);
    expect(m.healthTrail).toBe(100);
    stepHudFeel(f, 0.2);
    fillFeelHud(m, f, cam, false);
    expect(m.healthTrail).toBeCloseTo(80, 5);
    stepHudFeel(f, 0.25);
    fillFeelHud(m, f, cam, false);
    expect(m.healthTrail).toBe(60);
    m.health = 40;
    fillFeelHud(m, f, cam, false);
    m.health = 90;
    fillFeelHud(m, f, cam, false);
    expect(m.healthTrail).toBe(90);
  });

  it('vinheta a ≤ 30% da vida máxima, pulsando ~1 Hz; fixa com Reduzir efeitos', () => {
    const f = createHudFeel();
    const m = createHudModel();
    m.maxHealth = 100;
    m.health = 31;
    fillFeelHud(m, f, cam, false);
    expect(m.lowHealth).toBe(0);
    m.health = 30;
    fillFeelHud(m, f, cam, false);
    const a = m.lowHealth!;
    stepHudFeel(f, 0.5);
    fillFeelHud(m, f, cam, false);
    expect(m.lowHealth).not.toBeCloseTo(a, 2);
    fillFeelHud(m, f, cam, true);
    const fixed = m.lowHealth;
    stepHudFeel(f, 0.3);
    fillFeelHud(m, f, cam, true);
    expect(m.lowHealth).toBe(fixed);
  });

  it('até 4 indicadores pela origem no mundo: o ângulo gira com a vista; o mesmo atacante renova o dele', () => {
    const f = createHudFeel();
    // Atrás (+Z), à esquerda (−X), à direita (+X) e na frente (−Z), de 4 atacantes.
    feelDamage(f, 0, 0, 10, 30, 100, 1);
    feelDamage(f, -10, 0, 0, 10, 100, 2);
    feelDamage(f, 10, 0, 0, 40, 100, 3);
    feelDamage(f, 0, 0, -10, 5, 100, 4);
    let m = fill(f);
    expect(m.damageCount).toBe(4);
    const angles = [...m.damageAngles!];
    expect(Math.abs(angles[0]!)).toBeCloseTo(Math.PI, 5);
    expect(angles[1]).toBeCloseTo(Math.PI / 2, 5);
    expect(angles[2]).toBeCloseTo(-Math.PI / 2, 5);
    expect(angles[3]).toBeCloseTo(0, 5);
    expect(m.damageWeights![2]).toBe(1);
    // A vista gira 90° para a esquerda: o que estava à esquerda fica na frente.
    m = createHudModel();
    m.health = 100;
    fillFeelHud(m, f, { x: 0, z: 0, yaw: Math.PI / 2 }, false);
    expect(m.damageAngles![1]).toBeCloseTo(0, 5);
    // Um 5º atacante toma o lugar do mais velho; o mesmo atacante renova o dele (sem gastar outro).
    stepHudFeel(f, 0.1);
    feelDamage(f, 0, 0, 10, 30, 100, 1);
    feelDamage(f, 5, 0, 5, 30, 100, 5);
    expect(fill(f).damageCount).toBe(4);
    stepHudFeel(f, HUD_FEEL.damageS);
    expect(fill(f).damageCount).toBe(0);
  });
});

describe('pontos que sobem', () => {
  it('a diferença positiva vira um "+N"; em 0,5 s os ganhos se somam; some em 0,8 s', () => {
    const f = createHudFeel();
    feelPoints(f, 500);
    expect(f.gainCount).toBe(0);
    feelPoints(f, 510);
    feelPoints(f, 610);
    expect([f.gainCount, f.gainValue[0]]).toEqual([1, 110]);
    stepHudFeel(f, 0.6);
    feelPoints(f, 910);
    expect([f.gainCount, f.gainValue[0], f.gainValue[1]]).toEqual([2, 300, 110]);
    // Gastar não sobe nada.
    feelPoints(f, 100);
    expect(f.gainCount).toBe(2);
    const m = fill(f);
    expect(m.gainCount).toBe(2);
    expect(m.gainRise![1]!).toBeGreaterThan(m.gainRise![0]!);
    expect(fill(f, true).gainRise![1]).toBe(0);
    stepHudFeel(f, 0.8);
    expect(f.gainCount).toBe(0);
  });
});

describe('a partida: avisos, VALENDO!, placar e fim', () => {
  const view = (over: Partial<SimView['match']>, extra: Partial<SimView> = {}): SimView =>
    ({
      match: { phase: 'playing', countdownTicks: 0, zombieWave: 0, zombieRestTicks: -1, ...over },
      rounds: null,
      strike: null,
      royale: null,
      count: 0,
      ...extra,
    }) as unknown as SimView;
  const texts = momentTexts();

  it('o fim da contagem dá o VALENDO!; a morte súbita vira aviso; a 1ª olhada só guarda', () => {
    const f = createMatchFeel();
    detectMoments(f, view({ phase: 'suddenDeath' }), 60, texts);
    expect(f.noticeAge).toBe(-1);
    const g = createMatchFeel();
    detectMoments(g, view({ phase: 'warmup', countdownTicks: 30 }), 60, texts);
    detectMoments(g, view({ phase: 'playing', countdownTicks: 0 }), 60, texts);
    expect(g.goAge).toBe(0);
    detectMoments(g, view({ phase: 'suddenDeath' }), 60, texts);
    // Com o VALENDO! na tela, o aviso espera.
    expect([g.noticeAge, g.pending]).toEqual([-1, texts.suddenDeath]);
    stepMatchFeel(g, 0.7, false);
    expect([g.notice, g.noticeAge]).toEqual([texts.suddenDeath, 0]);
    stepMatchFeel(g, 1.6, false);
    expect(g.noticeAge).toBe(-1);
  });

  it('Zombies: a onda limpa avisa a próxima; a onda nova dá o VALENDO! e depois "ONDA N"', () => {
    const f = createMatchFeel();
    detectMoments(f, view({ zombieWave: 2, zombieRestTicks: -1 }), 60, texts);
    detectMoments(f, view({ zombieWave: 2, zombieRestTicks: 600 }), 60, texts);
    expect(f.notice).toContain('3');
    stepMatchFeel(f, 2, false);
    detectMoments(f, view({ zombieWave: 3, zombieRestTicks: -1 }), 60, texts);
    expect(f.goAge).toBe(0);
    expect(f.pending).toContain('3');
  });

  it('a rodada que começa e a que acaba (Jugg Fixo)', () => {
    const data = new Int32Array(7);
    const rounds = { data, totalRounds: 4, swapAfter: 0 };
    const f = createMatchFeel();
    data[ROUND.round] = 1;
    data[ROUND.phase] = ROUND_PHASE.buy;
    detectMoments(f, view({}, { rounds } as Partial<SimView>), 60, texts);
    data[ROUND.phase] = ROUND_PHASE.live;
    detectMoments(f, view({}, { rounds } as Partial<SimView>), 60, texts);
    expect(f.notice).toContain('1');
    data[ROUND.phase] = ROUND_PHASE.over;
    data[ROUND.winner] = 1;
    stepMatchFeel(f, 2, false);
    detectMoments(f, view({}, { rounds } as Partial<SimView>), 60, texts);
    expect(f.noticeAge).toBe(0);
  });

  it('o aviso que chega com a contagem na tela espera ela sair', () => {
    const f = createMatchFeel();
    showNotice(f, 'FULANO VIROU O JUGG', true);
    expect(f.noticeAge).toBe(-1);
    stepMatchFeel(f, 0.1, true);
    expect(f.noticeAge).toBe(-1);
    stepMatchFeel(f, 0.1, false);
    expect(f.notice).toBe('FULANO VIROU O JUGG');
  });

  it('o placar que sobe dá a batida de 150 ms (a 1ª olhada só guarda; parada com Reduzir efeitos)', () => {
    const f = createMatchFeel();
    const beat = new Float32Array(4);
    feelScores(f, [3, 4], 2, beat, false);
    expect([...beat]).toEqual([0, 0, 0, 0]);
    feelScores(f, [4, 4], 2, beat, false);
    expect(beat[0]).toBe(1);
    stepMatchFeel(f, 0.1, false);
    feelScores(f, [4, 4], 2, beat, false);
    expect(beat[0]).toBeCloseTo(1 / 3, 3);
    feelScores(f, [5, 4], 2, beat, true);
    expect(beat[0]).toBe(0);
  });

  it('o fim: a câmera lenta ~0,35× por 0,8 s só onde pode, a faixa entra seca, o resultado conta em 0,4 s', () => {
    const f = createMatchFeel();
    expect(endSlowFactor(f, true)).toBe(1);
    feelEnd(f);
    expect(endSlowFactor(f, true)).toBe(HUD_FEEL.endSlowMul);
    expect(endSlowFactor(f, false)).toBe(1);
    expect(endBannerIn(f, false)).toBe(0);
    expect(endBannerIn(f, true)).toBe(1);
    stepMatchFeel(f, 0.9, false);
    expect(endSlowFactor(f, true)).toBe(1);
    expect(endBannerIn(f, false)).toBe(1);
    expect([resultCount(0.2, false), resultCount(0.2, true), resultCount(1, false)]).toEqual([0.5, 1, 1]);
  });
});

describe('toque', () => {
  it('a coluna dos botões de baixo e a faixa dos de cima, na escala do aparelho', () => {
    const b = touchBounds(DEFAULT_TOUCH_LAYOUT, 2, createTouchBounds());
    // A faca (x 300, raio 32) é a mais para dentro; os de cima descem até 56 + 24.
    expect(b.reserve).toBe((300 + 32 + DEFAULT_TOUCH_LAYOUT.hitSlop + 8) * 2);
    expect(b.top).toBe((56 + 24 + DEFAULT_TOUCH_LAYOUT.hitSlop + 8) * 2);
    expect(b.bottom).toBe((208 + 32 + DEFAULT_TOUCH_LAYOUT.hitSlop + 8) * 2);
  });
});

describe('M12 (fase 2, revisão): a barra da recarga', () => {
  it('só com a sim recarregando (a troca de arma no meio apaga); por cartucho, o pente que enche; senão, o tempo', () => {
    expect(reloadProgress(false, false, 0, 30, 10, 2, 11)).toBe(-1);
    expect(reloadProgress(true, false, 0, 30, 10, 2, 11)).toBe(0.5);
    expect(reloadProgress(true, false, 0, 30, 10, 2, 99)).toBe(1);
    // A escopeta (0,5 s por cartucho): com 2 de 8, a barra em 25%, mesmo depois do tempo de um cartucho.
    expect(reloadProgress(true, true, 2, 8, 10, 0.5, 15)).toBe(0.25);
    expect(reloadProgress(true, false, 0, 30, -1, 2, 11)).toBe(0);
  });
});

describe('M12 (fase 2, prints): o "R recarrega"', () => {
  it('pente a ≤ 25% com reserva, parado 0,6 s sem atirar; uma vez por pente; a recarga e a troca de arma rearmam', () => {
    const f = createHudFeel();
    const frame = (dt: number, weapon: number, clip: number, reloading = false, reserve = 90): boolean => {
      stepHudFeel(f, dt);
      return reloadPrompt(f, weapon, clip, 30, reserve, reloading);
    };
    expect(frame(0, 1, 30)).toBe(false);
    // Atirando até 7 (≤ 25% de 30): ainda não (acabou de atirar).
    expect(frame(0.1, 1, 7)).toBe(false);
    expect(frame(0.3, 1, 7)).toBe(false);
    expect(frame(0.35, 1, 7)).toBe(true);
    expect(frame(0.5, 1, 7)).toBe(true);
    // Um tiro com ele na tela: sai e não volta neste pente.
    expect(frame(0.1, 1, 6)).toBe(false);
    expect(frame(1, 1, 6)).toBe(false);
    // A recarga rearma (e enquanto recarrega, nada).
    expect(frame(0.1, 1, 6, true)).toBe(false);
    expect(frame(0.1, 1, 30)).toBe(false);
    expect(frame(0.1, 1, 5)).toBe(false);
    expect(frame(0.7, 1, 5)).toBe(true);
    // Trocar de arma rearma; sem reserva, nunca.
    expect(frame(0.1, 2, 5)).toBe(false);
    expect(frame(0.7, 2, 5)).toBe(true);
    expect(frame(0.7, 3, 5, false, 0)).toBe(false);
    expect(frame(0.7, 3, 5, false, 0)).toBe(false);
  });
});
