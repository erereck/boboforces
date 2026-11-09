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
