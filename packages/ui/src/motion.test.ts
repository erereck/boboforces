import { describe, expect, it } from 'vitest';
import { createDrawList, pushRect, resetDrawList } from './draw-list.ts';
import { enterProgress, enterSlidePx, fadeCommands } from './motion.ts';
import { MOTION } from './tokens.ts';

describe('movimento da UI', () => {
  it('a entrada vai de 0 a 1 em MOTION.enterMs, com ease-out', () => {
    expect(enterProgress(-5)).toBe(0);
    expect(enterProgress(0)).toBe(0);
    expect(enterProgress(MOTION.enterMs)).toBe(1);
    expect(enterProgress(MOTION.enterMs * 2)).toBe(1);
    // Ease-out: na metade do tempo já passou bem da metade.
    expect(enterProgress(MOTION.enterMs / 2)).toBeGreaterThan(0.8);
    expect(enterProgress(10, MOTION.enterMs, true)).toBe(1);
  });

  it('o deslize some no fim', () => {
    expect(enterSlidePx(0)).toBe(MOTION.slidePx);
    expect(enterSlidePx(1)).toBe(0);
    expect(enterSlidePx(2)).toBe(0);
  });

  it('esmaece e desloca só os comandos a partir de from', () => {
    const list = createDrawList(8);
    resetDrawList(list, 100, 100);
    pushRect(list, 1, 2, 3, 4, 0x112233ff);
    const from = list.count;
    pushRect(list, 10, 20, 5, 5, 0xaabbcc80);
    fadeCommands(list, from, 0.5, 0, 8);
    expect(list.colors[0]).toBe(0x112233ff);
    expect(list.geom[1]).toBe(2);
    expect(list.colors[1]).toBe(0xaabbcc40);
    expect(list.geom[8]).toBe(10);
    expect(list.geom[9]).toBe(28);
  });
});
