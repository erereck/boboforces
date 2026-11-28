import { builtinBotRef, DEBUT_PRESET, type MatchRecipe } from '@boboforces/format';
import {
  createDrawList,
  MOTION,
  pushRect,
  registerStrings,
  resetDrawList,
  STRINGS_EXTRA_PT_BR,
  t,
} from '@boboforces/ui';
import { describe, expect, it } from 'vitest';
import { modesCardFor } from './game.ts';
import { createMenuEntry, firstContentCommand } from './menu-entry.ts';
import { fortressName, MORE_MODE_CARDS, moreCardFor, moreModePreset, moreModesHelp } from './more-modes.ts';
import { createQuitGuard, PAUSE_ACTION, pauseHelp, pauseScreen } from './pause.ts';
import { trainingPreset } from './training.ts';
import { stepCustom } from './custom-match.ts';

registerStrings(STRINGS_EXTRA_PT_BR);

/** Uma tela de teste: o fundo da tela inteira e um botão. */
function screen(list: ReturnType<typeof createDrawList>): void {
  resetDrawList(list, 1280, 720);
  pushRect(list, 0, 0, 1280, 720, 0x0a0d0bff);
  pushRect(list, 100, 200, 300, 60, 0xf2b233ff);
}

describe('M12 (fase 3): as entradas secas dos menus', () => {
  it('o fundo da tela fica; os comandos sobem 8 px e aparecem em 150 ms', () => {
    const list = createDrawList(16);
    const entry = createMenuEntry();
    screen(list);
    expect(firstContentCommand(list, 0)).toBe(1);
    entry.apply(list, 0, 'modes', 16, false);
    // 1º quadro da tela: invisível e 8 px abaixo; o fundo, inteiro.
    expect(list.colors[0]).toBe(0x0a0d0bff);
    expect(list.colors[1]! & 0xff).toBe(0);
    expect(list.geom[8 + 1]).toBe(200 + MOTION.slidePx);
    // No meio: parte do caminho.
    screen(list);
    entry.apply(list, 0, 'modes', MOTION.enterMs / 2, false);
    expect(list.colors[1]! & 0xff).toBeGreaterThan(128);
    expect(list.geom[8 + 1]).toBeGreaterThan(200);
    expect(list.geom[8 + 1]).toBeLessThan(200 + MOTION.slidePx);
    // No fim: como desenhado.
    screen(list);
    entry.apply(list, 0, 'modes', MOTION.enterMs, false);
    expect(list.colors[1]).toBe(0xf2b233ff);
    expect(list.geom[8 + 1]).toBe(200);
    // A mesma tela não entra de novo; outra entra; depois de `clear`, a mesma entra de novo.
    screen(list);
    entry.apply(list, 0, 'modes', 16, false);
    expect(list.colors[1]).toBe(0xf2b233ff);
    screen(list);
    entry.apply(list, 0, 'quick', 16, false);
    expect(list.colors[1]! & 0xff).toBe(0);
    entry.clear();
    screen(list);
    entry.apply(list, 0, 'quick', 16, false);
    expect(list.colors[1]! & 0xff).toBe(0);
  });

  it('revisão: o deslize acompanha a escala da UI (os 8 px são de referência)', () => {
    const list = createDrawList(16);
    const entry = createMenuEntry();
    screen(list);
    entry.apply(list, 0, 'modes', 0, false, 0.5);
    expect(list.geom[8 + 1]).toBe(200 + MOTION.slidePx * 0.5);
  });

  it('com Reduzir efeitos (ou o reduced-motion da plataforma), a entrada é instantânea', () => {
    const list = createDrawList(16);
    const entry = createMenuEntry();
    screen(list);
    entry.apply(list, 0, 'title', 0, true);
    expect(list.colors[1]).toBe(0xf2b233ff);
    expect(list.geom[8 + 1]).toBe(200);
  });
});

describe('M12 (fase 3): o Sair da partida em dois apertos', () => {
  it('o 1º arma, o 2º sai; outra ação, o voltar ou o foco fora do Sair desarmam', () => {
    const g = createQuitGuard();
    expect(g.step(PAUSE_ACTION.quit, false, 'quit')).toBe('armed');
    expect(g.armed).toBe(true);
    expect(g.step(null, false, 'quit')).toBe('none');
    expect(g.step(PAUSE_ACTION.quit, false, 'quit')).toBe('quit');
    expect(g.armed).toBe(false);
    g.step(PAUSE_ACTION.quit, false, 'quit');
    expect(g.step(null, false, 'unstuck')).toBe('disarmed');
    g.step(PAUSE_ACTION.quit, false, 'quit');
    expect(g.step(null, true, 'quit')).toBe('disarmed');
    g.step(PAUSE_ACTION.quit, false, 'quit');
    expect(g.step(PAUSE_ACTION.resume, false, 'resume')).toBe('disarmed');
    g.step(PAUSE_ACTION.quit, false, 'quit');
    g.reset();
    expect(g.armed).toBe(false);
  });

  it('armado, a frase do Sair vira "Aperte de novo para sair", em vermelho', () => {
    expect(pauseHelp('quit', { challenge: true, quitArmed: true })).toBe('Aperte de novo para sair.');
    expect(pauseHelp('quit', { challenge: true })).toBe('Volta ao menu; esta partida não conta.');
    const tree = JSON.stringify(pauseScreen.build({ challenge: true, quitArmed: true, help: 'x' }));
    expect(tree).toContain('"id":"help"');
  });
});

describe('M12 (fase 3): os cards da última partida e a linha de ajuda da Mais modos', () => {
  const normal = builtinBotRef('normal');
  it('cada card da Mais modos se acha pela receita dele', () => {
    for (const card of MORE_MODE_CARDS) {
      const r = card.id === 'training' ? trainingPreset() : moreModePreset(card.id)!;
      expect(moreCardFor(r), card.id).toBe(card.id);
      expect(modesCardFor(r), card.id).toBe('more');
    }
    expect(moreCardFor(moreModePreset('royaleGrande')!)).toBe('royaleGrande');
    expect(moreCardFor(DEBUT_PRESET)).toBeNull();
    expect(modesCardFor(DEBUT_PRESET)).toBe(DEBUT_PRESET.mode);
    const ffa: MatchRecipe = {
      ...DEBUT_PRESET,
      mode: 'warfare.ffa',
      teams: [{ humans: 'all', bots: [{ ref: normal, count: 5 }] }],
    };
    expect(modesCardFor(ffa)).toBe('warfare.ffa');
    expect(modesCardFor({ ...DEBUT_PRESET, mode: 'zombies', map: 'base' })).toBe('zombies');
  });

  it('a linha diz o resumo do card com o foco; no Aquário, o que ele faz; no toque, a descrição junto', () => {
    expect(moreModesHelp(false, 'mode:warfare.domination')).toContain('Domination');
    expect(moreModesHelp(false, 'mode:training')).toContain('Training');
    expect(moreModesHelp(true, 'watch')).toBe('Ligado: só bots jogam; você assiste.');
    expect(moreModesHelp(false, 'watch')).toContain('Desligado');
    expect(moreModesHelp(false, 'back')).toBe('');
    expect(moreModesHelp(false, 'mode:strike', true)).toMatch(/^Plante ou desarme a bomba\. /);
  });

  it('revisão: começa pelo nome do card; o Infection e o Juggernaut são "N bobos", não "N contra 0"', () => {
    const name = (id: string): string => t(MORE_MODE_CARDS.find((c) => c.id === id)!.nameKey);
    for (const card of MORE_MODE_CARDS) {
      const line = moreModesHelp(false, `mode:${card.id}`);
      expect(line.startsWith(`${name(card.id)} · `), line).toBe(true);
      expect(line, card.id).not.toMatch(/contra 0/);
    }
    expect(moreModesHelp(false, 'mode:infection')).toContain('8 bobos');
    expect(moreModesHelp(false, 'mode:juggernaut')).toContain('8 bobos');
    expect(moreModesHelp(false, 'mode:juggernautFixed')).toContain('4 bobos');
    expect(moreModesHelp(false, 'mode:chaos')).toMatch(/^Bobo Chaos · /);
    expect(moreModesHelp(false, 'mode:gunGame')).toMatch(/^Gun Game · /);
    expect(moreModesHelp(false, 'mode:royaleGrande')).toMatch(/^Bobo Royale Grande · /);
    expect(moreModesHelp(false, 'mode:warfare.domination')).toContain('4 contra 4');
  });

  it('a Fortaleza leva o mapa no nome, também quando a Personalizada troca o mapa', () => {
    const card = moreModePreset('zombiesFortress')!;
    expect(card.name).toBe('Fortaleza: Fazenda');
    expect(fortressName('posto')).toBe('Fortaleza: Posto Avançado');
    const limits = { maxBots: 15, maxViewM: 140 };
    let r = card;
    for (let i = 0; i < 4; i++) {
      r = stepCustom('match', r, 'map', 1, limits);
      expect(r.name).toBe(fortressName(r.map));
    }
    // O nome de antes do M12 também troca; um nome escolhido pelo jogador fica.
    expect(stepCustom('match', { ...card, name: 'Bobo Zombies: Fortaleza' }, 'map', 1, limits).name).toMatch(
      /^Fortaleza: /,
    );
    expect(stepCustom('match', { ...card, name: 'Minha' }, 'map', 1, limits).name).toBe('Minha');
  });
});
