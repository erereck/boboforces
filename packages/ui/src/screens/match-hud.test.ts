import { describe, expect, it } from 'vitest';
import { createDrawList, DRAW_OP } from '../draw-list.ts';
import { drawnCommands, syntheticFontPack, syntheticGlyphText } from '../test-fixtures.ts';
import { COLORS, MIN_TEXT, TEAM_COLORS } from '../tokens.ts';
import { createHudSharedModel, drawHudShared, layoutHudScreen } from './hud.ts';
import {
  ageKillFeed,
  createKillFeedModel,
  createScoreboardModel,
  drawKillFeed,
  drawMatchCountdown,
  drawScoreboard,
  directorShiftText,
  KILL_FEED_MAX,
  KILL_FEED_SHOW_S,
  pushKillFeed,
} from './match-hud.ts';

/** M2, fase 2d: kill feed, placar do Tab, contagem inicial e o aviso de morte súbita. */

const fonts = syntheticFontPack().fonts;
const W = 1280;
const H = 720;

function within(list: ReturnType<typeof createDrawList>, w: number, h: number): void {
  for (const c of drawnCommands(list)) {
    expect(c.x >= -0.5 && c.y >= -0.5 && c.x + c.w <= w + 0.5 && c.y + c.h <= h + 0.5, `${c.x},${c.y}`).toBe(true);
  }
}

describe('kill feed', () => {
  it('a mais nova em cima, no máximo 5, e cada linha some depois de 6 s', () => {
    const m = createKillFeedModel();
    for (let i = 0; i < 7; i++) pushKillFeed(m, `K${i}`, TEAM_COLORS[0]!, 'Rattler', `V${i}`, TEAM_COLORS[1]!, false);
    expect(m.count).toBe(KILL_FEED_MAX);
    expect([m.killer[0], m.killer[4]]).toEqual(['K6', 'K2']);
    ageKillFeed(m, 1);
    pushKillFeed(m, 'Nova', COLORS.texto, 'Kaboomer', 'Alvo', COLORS.texto, true);
    ageKillFeed(m, KILL_FEED_SHOW_S - 1);
    // As velhas passaram de 6 s; a nova tem 5 s.
    expect([m.count, m.killer[0]]).toEqual([1, 'Nova']);
    ageKillFeed(m, 1);
    expect(m.count).toBe(0);
  });

  it('alinhado à direita, dentro da tela; tiro de cabeça com a arma em âmbar; sem matador, vítima e causa', () => {
    const m = createKillFeedModel();
    pushKillFeed(m, 'Normal Bob', TEAM_COLORS[1]!, 'Peekaboo', 'P1', TEAM_COLORS[0]!, true);
    pushKillFeed(m, '', COLORS.texto, 'Caiu no vazio', 'Sweaty Bob', TEAM_COLORS[1]!, false);
    const list = createDrawList();
    drawKillFeed(list, fonts, m, W - 32, 24, 2, MIN_TEXT.tv);
    within(list, W, H);
    const text = syntheticGlyphText(list);
    expect(text).toContain('SweatyBobCaiunovazio');
    expect(text).toContain('NormalBobPeekabooP1');
    expect(drawnCommands(list).some((c) => c.op === DRAW_OP.glyph && c.color === COLORS.acao)).toBe(true);
  });
});

describe('placar do Tab', () => {
  function sample(teams: number): ReturnType<typeof createScoreboardModel> {
    const m = createScoreboardModel();
    m.title = 'Bobo Warfare: Times';
    m.teamCount = teams;
    m.teamScores[0] = 12;
    m.teamScores[1] = 9;
    m.rowCount = 12;
    for (let r = 0; r < 12; r++) {
      m.name[r] = r === 0 ? 'P1' : 'Normal Bob';
      m.team[r] = r % 2;
      m.kills[r] = 12 - r;
      m.deaths[r] = r;
      m.assists[r] = 1;
      m.local[r] = r === 0 ? 1 : 0;
    }
    return m;
  }

  it('TDM: duas tabelas lado a lado com a cor e os pontos do time; a sua linha em âmbar; tudo dentro da tela', () => {
    for (const [w, h, min] of [
      [1280, 720, MIN_TEXT.tv],
      [667, 375, MIN_TEXT.phone],
      [640, 360, MIN_TEXT.switchSplit],
    ] as const) {
      const list = createDrawList();
      drawScoreboard(list, fonts, sample(2), w, h, min);
      within(list, w, h);
      const cs = drawnCommands(list);
      expect(cs.some((c) => c.op !== DRAW_OP.glyph && c.color === TEAM_COLORS[0])).toBe(true);
      expect(cs.some((c) => c.op !== DRAW_OP.glyph && c.color === TEAM_COLORS[1])).toBe(true);
      expect(cs.some((c) => c.op === DRAW_OP.glyph && c.color === COLORS.acao)).toBe(true);
    }
    const text = syntheticGlyphText(
      (() => {
        const l = createDrawList();
        drawScoreboard(l, fonts, sample(2), W, H, MIN_TEXT.tv);
        return l;
      })(),
    );
    expect(text).toContain('BoboWarfare:Times');
    expect(text).toContain('ABATES');
    expect(text).toContain('P1');
  });

  it('as regras dos bots (GDD §6.5) ficam embaixo da tabela do time delas, dentro da tela', () => {
    for (const [w, h, min] of [
      [1280, 720, MIN_TEXT.tv],
      [640, 360, MIN_TEXT.switchSplit],
    ] as const) {
      const m = sample(2);
      m.ruleLines[0] = 'Jorge the Immortal: 500 de vida · só escopeta';
      m.ruleTeam[0] = 1;
      m.ruleLines[1] = 'Knife Ninja: velocidade ×1,4 · só faca';
      m.ruleTeam[1] = 1;
      m.ruleCount = 2;
      const list = createDrawList();
      drawScoreboard(list, fonts, m, w, h, min);
      within(list, w, h);
      const text = syntheticGlyphText(list);
      // No 640×360 com 6 linhas por time não sobra espaço: a legenda sai (a tela de morte ainda mostra as regras).
      if (w === 640) continue;
      expect(text).toContain('JorgetheImmortal:500devida·sóescopeta');
      expect(text.slice(text.indexOf('Jorge')), 'legenda').toContain('KnifeNinja:velocidade');
      // Sem regras, nada de legenda.
      const plain = createDrawList();
      drawScoreboard(plain, fonts, sample(2), w, h, min);
      expect(syntheticGlyphText(plain)).not.toContain('500devida');
    }
  });

  it('M8 (fase 5): a linha do Diretor embaixo do título, em âmbar, sem empurrar nada para fora da tela', () => {
    expect([0, 1, 2, 3, 4, -1, -2, -3, -4].map(directorShiftText)).toEqual([
      '±0',
      '+¼',
      '+½',
      '+¾',
      '+1',
      '–¼',
      '–½',
      '–¾',
      '–1',
    ]);
    for (const [w, h, min] of [
      [1280, 720, MIN_TEXT.tv],
      [640, 360, MIN_TEXT.switchSplit],
    ] as const) {
      const m = sample(2);
      m.note = 'Diretor: bots –½';
      const list = createDrawList();
      drawScoreboard(list, fonts, m, w, h, min);
      within(list, w, h);
      const text = syntheticGlyphText(list);
      // A fonte sintética não tem o – nem o ½ (a do HUD tem: Latin-1 e a pontuação extra).
      expect(text).toContain('Diretor:bots');
      // Embaixo do título (no 640×360 com o placar cheio, na ponta da linha dele) e antes da 1ª tabela.
      expect(text.indexOf('Diretor')).toBeGreaterThan(text.indexOf('Times'));
      expect(text.indexOf('Diretor')).toBeLessThan(text.indexOf('ABATES'));
      const glyphs = drawnCommands(list).filter((c) => c.op === DRAW_OP.glyph);
      // O cabeçalho das tabelas (texto baixo) marca onde acaba a parte de cima.
      const top = Math.min(...glyphs.filter((c) => c.color === COLORS.textoBaixo).map((c) => c.y));
      const title = glyphs.filter((c) => c.color === COLORS.texto && c.y < top);
      const note = glyphs.filter((c) => c.color === COLORS.acao && c.y < top);
      expect(note.length).toBeGreaterThan(0);
      // O aviso não encosta no título.
      const titleRight = Math.max(...title.map((c) => c.x + c.w));
      const noteLeft = Math.min(...note.map((c) => c.x));
      const noteTop = Math.min(...note.map((c) => c.y));
      const titleBottom = Math.max(...title.map((c) => c.y + c.h));
      expect(noteLeft > titleRight || noteTop >= titleBottom, `${w}: ${noteLeft} ${titleRight}`).toBe(true);
    }
  });

  it('M9 (fase 3): o Sandbox com 4 times, cada tabela com a cor, os pontos e o nome do time, tudo dentro da tela', () => {
    const names = ['Os Bobões da Rua', 'Azul', 'Verde', 'MMMMMMMMMMMMMMMM'];
    for (const [w, h, min] of [
      [1280, 720, MIN_TEXT.tv],
      [667, 375, MIN_TEXT.phone],
      [640, 360, MIN_TEXT.switchSplit],
    ] as const) {
      const m = createScoreboardModel();
      m.title = 'Bobo Sandbox';
      m.teamCount = 4;
      m.rowCount = 12;
      for (let tIdx = 0; tIdx < 4; tIdx++) {
        m.teamScores[tIdx] = 10 + tIdx;
        m.teamNames[tIdx] = names[tIdx]!;
      }
      for (let r = 0; r < 12; r++) {
        m.name[r] = r === 0 ? 'P1' : 'Normal Bob';
        m.team[r] = r % 4;
        m.kills[r] = 12 - r;
      }
      const list = createDrawList();
      drawScoreboard(list, fonts, m, w, h, min);
      const bottom = Math.max(...drawnCommands(list).map((c) => c.y + c.h));
      expect(bottom, `${w}×${h}`).toBeLessThanOrEqual(h + 0.5);
      within(list, w, h);
      const cs = drawnCommands(list);
      for (let tIdx = 0; tIdx < 4; tIdx++) {
        expect(
          cs.some((c) => c.op !== DRAW_OP.glyph && c.color === TEAM_COLORS[tIdx]),
          `${w}: time ${tIdx}`,
        ).toBe(true);
      }
      const text = syntheticGlyphText(list);
      const tablesDrawn = cs.filter((c) => c.op !== DRAW_OP.glyph && c.color === COLORS.hudFundo).length;
      if (w === 640) {
        // Na tela pequena, 4 tabelas não cabem nem em grade: uma lista só, os pontos dos times no cabeçalho.
        expect(tablesDrawn).toBe(1);
        expect(text).toContain('BoboSandbox10111213ABATES');
        continue;
      }
      // Em grade de 2 colunas (empilhadas, passariam da altura).
      expect(tablesDrawn).toBe(4);
      expect(text).toContain('10OsBobõesdaRua');
      expect(text).toContain('12Verde');
      // Os pontos e o nome (na cor do time) não entram na coluna dos abates, nem o nome comprido (encolhe).
      const glyphs = cs.filter((c) => c.op === DRAW_OP.glyph);
      for (let tIdx = 0; tIdx < 4; tIdx++) {
        const own = glyphs.filter((c) => c.color === TEAM_COLORS[tIdx]);
        const left = Math.min(...own.map((c) => c.x));
        const top = Math.min(...own.map((c) => c.y));
        const titles = glyphs.filter(
          (c) => c.color === COLORS.textoBaixo && c.x > left && Math.abs(c.y - top) < 4 * (w / 640),
        );
        expect(titles.length, `${w}: time ${tIdx}`).toBeGreaterThan(0);
        expect(Math.max(...own.map((c) => c.x + c.w)), `${w}: time ${tIdx}`).toBeLessThan(
          Math.min(...titles.map((c) => c.x)),
        );
      }
    }
  });

  it('os títulos das colunas não se encostam', () => {
    const list = createDrawList();
    drawScoreboard(list, fonts, sample(2), W, H, MIN_TEXT.tv);
    const cs = drawnCommands(list).filter((c) => c.op === DRAW_OP.glyph && c.color === COLORS.textoBaixo);
    // Os títulos são a 1ª fileira de glifos em texto baixo de cada tabela: nenhum glifo de um entra no do vizinho.
    const row = cs.filter((c) => Math.abs(c.y - cs[0]!.y) < 1).sort((a, b) => a.x - b.x);
    for (let i = 1; i < row.length; i++) expect(row[i]!.x).toBeGreaterThanOrEqual(row[i - 1]!.x + row[i - 1]!.w - 0.5);
  });
});

describe('contagem inicial e morte súbita', () => {
  it('número grande e a linha de quem vem pela frente, dentro da tela', () => {
    const list = createDrawList();
    drawMatchCountdown(list, fonts, 2.3, 'Hoje: 6 × Normal Bob', W, H, MIN_TEXT.tv);
    within(list, W, H);
    const text = syntheticGlyphText(list);
    expect(text).toContain('3');
    expect(text).toContain('Hoje:6');
  });

  it('M8 (fase 4): a 2ª linha do Nêmesis, comprida, encolhe para caber em 640×360', () => {
    const list = createDrawList();
    const extra = 'Seu Nêmesis voltou: Jorge the Immortal da Silva · te pegou 120, você 45';
    drawMatchCountdown(list, fonts, 2.3, 'Hoje: 6 × Normal Bob e 2 × Camper Carl', 640, 360, MIN_TEXT.phone, extra);
    within(list, 640, 360);
    expect(syntheticGlyphText(list)).toContain('SeuNêmesisvoltou');
  });

  it('M9 (fase 3): o placar do alto com os 4 times do Sandbox e o relógio cabe em 640×360 e no sofá de 4', () => {
    for (const [w, h, views] of [
      [640, 360, 1],
      [1280, 720, 4],
    ] as const) {
      const lay = layoutHudScreen(views, w, h, { minTextPx: MIN_TEXT.switchSplit });
      const m = createHudSharedModel();
      m.teamCount = 4;
      for (let i = 0; i < 4; i++) m.teamScores[i] = 100 + i;
      m.timeLeftS = 599;
      const list = createDrawList();
      drawHudShared(list, fonts, m, lay.shared);
      within(list, w, h);
      const cs = drawnCommands(list);
      for (let i = 0; i < 4; i++)
        expect(
          cs.some((c) => c.color === TEAM_COLORS[i]),
          `${w}: time ${i}`,
        ).toBe(true);
      expect(syntheticGlyphText(list)).toContain('9:59');
    }
  });

  it('o placar compartilhado ganha "MORTE SÚBITA" embaixo, com o relógio', () => {
    const lay = layoutHudScreen(1, W, H, { minTextPx: MIN_TEXT.tv });
    const m = createHudSharedModel();
    m.teamCount = 2;
    m.teamScores[0] = 30;
    m.teamScores[1] = 30;
    m.timeLeftS = 42;
    m.suddenDeath = true;
    const list = createDrawList();
    drawHudShared(list, fonts, m, lay.shared);
    within(list, W, H);
    const text = syntheticGlyphText(list);
    expect(text).toContain('MORTESÚBITA');
    expect(text).toContain('0:42');
  });
});
