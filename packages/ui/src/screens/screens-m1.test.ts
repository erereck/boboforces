import { describe, expect, it } from 'vitest';
import { createDrawList, DRAW_OP, resetDrawList, type DrawList } from '../draw-list.ts';
import { moveFocus } from '../focus.ts';
import { parseFontPack } from '../font.ts';
import { layoutTree } from '../layout.ts';
import type { StringKey } from '../strings.pt-BR.ts';
import { t } from '../text.ts';
import {
  drawnCommands,
  syntheticFontFile,
  syntheticFontPack,
  syntheticFontPackFile,
  syntheticGlyphText,
  type DrawnCommand,
} from '../test-fixtures.ts';
import { COLORS, MIN_TEXT, PLAYER_COLORS } from '../tokens.ts';
import type { Rect } from '../tree.ts';
import { createDebugPanelModel, DEBUG_PANEL_METRICS, drawDebugPanel } from './debug-panel.ts';
import { drawFontSpecimen } from './font-specimen.ts';
import { createLoadingModel, drawLoadingScreen, loadingFraction, loadingStepIndex, LOADING_STEPS } from './loading.ts';
import {
  controllerLiteral,
  createTestScreenModel,
  drawTestScreen,
  fillControllerLine,
  TEST_SCREEN_MAX_LINES,
} from './test-screen.ts';
import { TITLE_ACTION_TEST_PREFIX, titleScreen } from './title.ts';

const fonts = syntheticFontPack().fonts;

const SIZES = [
  [640, 360],
  [667, 375],
  [1280, 720],
  [1920, 1080],
] as const;

function list(width: number, height: number): DrawList {
  const l = createDrawList(8192);
  resetDrawList(l, width, height);
  return l;
}

/** Comandos dentro da superfície; o que está dentro de um recorte vale pelo recorte (o render corta o quad). */
function expectInside(l: DrawList, width: number, height: number): void {
  let depth = 0;
  for (const c of drawnCommands(l)) {
    if (c.op === DRAW_OP.clipPop) {
      depth--;
      continue;
    }
    if (depth > 0) continue;
    if (c.op === DRAW_OP.clipPush) depth++;
    expect(c.x).toBeGreaterThanOrEqual(-0.5);
    expect(c.y).toBeGreaterThanOrEqual(-0.5);
    expect(c.x + c.w).toBeLessThanOrEqual(width + 0.5);
    expect(c.y + c.h).toBeLessThanOrEqual(height + 0.5);
  }
}

const glyphs = (l: DrawList): DrawnCommand[] => drawnCommands(l).filter((c) => c.op === DRAW_OP.glyph);

describe('painel F2', () => {
  function sampleModel() {
    const m = createDebugPanelModel();
    m.visible = true;
    m.fps = 29.97;
    m.frameP50 = 33.33;
    m.frameP99 = 38.9;
    m.frameMax = 52;
    m.cpuMs = 21.4;
    m.simMs = 3.1;
    m.aiMs = 2.4;
    m.renderMs = 12.8;
    m.uiMs = 1.1;
    m.drawCalls = 164;
    m.triangles = 392000;
    m.programs = 7;
    m.viewCount = 4;
    m.views.forEach((v, i) => {
      v.drawCalls = 41 + i;
      v.triangles = 98000;
      v.regions = 9;
      v.propGroups = 6;
      v.actors = 15;
    });
    m.heapMb = 148.2;
    m.textureMb = 3.4;
    m.meshMb = 18.7;
    m.gcPauses = 2;
    m.bots = 12;
    m.viewDistanceM = 50;
    m.tick = 36000;
    m.profile = 'switch34p';
    return m;
  }

  it('invisível não desenha nada', () => {
    const l = list(1280, 720);
    drawDebugPanel(l, fonts, createDebugPanelModel(), 1280, 720);
    expect(l.count).toBe(0);
  });

  it('mostra frame, fases, vistas, memória, cena e as chaves do Teste Zero (números pt-BR)', () => {
    const l = list(1280, 720);
    drawDebugPanel(l, fonts, sampleModel(), 1280, 720);
    const text = syntheticGlyphText(l);
    expect(text).toContain('FPS30,0');
    expect(text).toContain('p5033,33');
    expect(text).toContain('p9938,90');
    expect(text).toContain('GPU—ms');
    expect(text).toContain('Triângulos392.000');
    expect(text).toContain('V4draw44');
    expect(text).toContain('Heap148,2/—MB');
    expect(text).toContain('Visão50m');
    expect(text).toContain('Tick36.000');
    expect(text).toContain('Perfilswitch34p');
    expect(text).toContain('Texturaarray');
    expect(text).toContain('Atributosint');
    expect(text).toContain('gl.finishdesligado');
  });

  it('programas acima de 7 em perigo; fundo cobre o conteúdo e cabe na tela nas 4 resoluções', () => {
    const m = sampleModel();
    m.programs = 9;
    for (const [w, h] of SIZES) {
      const l = list(w, h);
      drawDebugPanel(l, fonts, m, w, h);
      expectInside(l, w, h);
      const cmds = drawnCommands(l);
      const bg = cmds[0]!;
      for (const g of glyphs(l)) {
        expect(g.h).toBeGreaterThanOrEqual(DEBUG_PANEL_METRICS.minTextPx);
        expect(g.x + g.w).toBeLessThanOrEqual(bg.x + bg.w + 0.5);
        expect(g.y + g.h).toBeLessThanOrEqual(bg.y + bg.h + 0.5);
      }
      expect(glyphs(l).some((g) => g.color === COLORS.perigo)).toBe(true);
    }
  });
});

describe('tela de teste (Switch: controles, teclado, áudio)', () => {
  it('24 linhas cabem (em colunas) nas 4 resoluções, com texto acima do piso', () => {
    const m = createTestScreenModel();
    m.titleKey = 'test.controllers.title';
    m.hintKey = 'test.controllers.hint';
    m.lineCount = TEST_SCREEN_MAX_LINES;
    m.lines.forEach((line, i) => {
      line.key = 'test.controllers.pressA';
      line.literal = `indice=${i} styleSet=0x4 deviceType=-1`;
      line.status = (['ok', 'fail', 'info', 'wait'] as const)[i % 4]!;
    });
    for (const [w, h] of SIZES) {
      const l = list(w, h);
      drawTestScreen(l, fonts, m, w, h);
      expectInside(l, w, h);
      for (const g of glyphs(l)) expect(g.h).toBeGreaterThanOrEqual(MIN_TEXT.phone);
      // 24 recortes (um por linha) e todos dentro da tela.
      expect(drawnCommands(l).filter((c) => c.op === DRAW_OP.clipPush).length).toBe(24);
    }
  });

  it('selos de status coloridos, vaga P1–P4 na cor do jogador e textos da tabela', () => {
    const m = createTestScreenModel();
    m.titleKey = 'test.controllers.title';
    m.hintKey = 'test.controllers.hint';
    m.lineCount = 2;
    m.lines[0]!.key = 'test.controllers.ready';
    m.lines[0]!.literal = 'indice=0';
    m.lines[0]!.status = 'ok';
    m.lines[0]!.slot = 2;
    m.lines[1]!.key = 'test.controllers.incomplete';
    m.lines[1]!.status = 'fail';
    const l = list(1280, 720);
    drawTestScreen(l, fonts, m, 1280, 720);
    const text = syntheticGlyphText(l);
    expect(text).toContain('TESTEDECONTROLES');
    expect(text).toContain('OKP3Prontoindice=0');
    expect(text).toContain('FALHAControleincompleto');
    // Dica da casca do Switch (integração do M1: o texto pedido pela frente switch-audio).
    expect(text).toContain('Aentra·Xvibra·Bvolta');
    const cmds = drawnCommands(l);
    expect(cmds.some((c) => c.op === DRAW_OP.rect && c.color === COLORS.ok)).toBe(true);
    expect(cmds.some((c) => c.op === DRAW_OP.rect && c.color === COLORS.perigo)).toBe(true);
    expect(cmds.filter((c) => c.op === DRAW_OP.glyph && c.color === PLAYER_COLORS[2]).length).toBe(2);
  });
});

describe('linha de controle da tela "aperte A"', () => {
  it('estado, vaga e literal técnico (índice, estilo e tipo)', () => {
    const m = createTestScreenModel();
    const line = m.lines[0]!;
    const pro = { index: 1, styleSet: 0x1, deviceType: -1, complete: true, canVibrate: true };
    fillControllerLine(line, pro, 1, false);
    expect(line).toMatchObject({ key: 'test.controllers.pressA', status: 'wait', slot: 1 });
    expect(line.literal).toBe('indice=1 styleSet=0x1 deviceType=-1 vibra=1');
    fillControllerLine(line, pro, 1, true);
    expect(line).toMatchObject({ key: 'test.controllers.ready', status: 'ok' });
    fillControllerLine(line, { ...pro, complete: false, styleSet: 0x8, canVibrate: false }, 2, true);
    expect(line).toMatchObject({ key: 'test.controllers.incomplete', status: 'fail', slot: 2 });
    expect(controllerLiteral({ ...pro, styleSet: -1 })).toBe('indice=1 styleSet=-1 deviceType=-1 vibra=1');
  });
});

describe('tela de loading', () => {
  it('fração ponderada pelos pesos das etapas', () => {
    const m = createLoadingModel();
    expect(loadingFraction(m)).toBe(0);
    m.progress.fill(1);
    expect(loadingFraction(m)).toBeCloseTo(1);
    m.progress.fill(0);
    m.weights.fill(1);
    m.progress[loadingStepIndex('mesh')] = 1;
    expect(loadingFraction(m)).toBeCloseTo(1 / LOADING_STEPS.length);
  });

  it('concluída mostra ms, em andamento mostra barra, na fila mostra "Na fila"; cabe nas 4 resoluções', () => {
    const m = createLoadingModel();
    m.mapName = 'Construto';
    m.progress[0] = 1;
    m.ms[0] = 412;
    m.progress[1] = 1;
    m.ms[1] = 287.6;
    m.progress[2] = 0.5;
    m.current = 2;
    for (const [w, h] of SIZES) {
      const l = list(w, h);
      drawLoadingScreen(l, fonts, m, w, h, { minTextPx: w >= 1280 ? MIN_TEXT.tv : MIN_TEXT.phone });
      expectInside(l, w, h);
      for (const g of glyphs(l)) expect(g.h).toBeGreaterThanOrEqual(w >= 1280 ? MIN_TEXT.tv : MIN_TEXT.phone);
      const text = syntheticGlyphText(l);
      expect(text).toContain('CARREGANDO');
      expect(text).toContain('CONSTRUTO');
      expect(text).toContain('Arquivos412ms');
      expect(text).toContain('Texturas288ms');
      // A ordem da tela é a do loader (luz antes da malha): nada "Na fila" ACIMA da etapa em andamento.
      expect(text).toContain('Texturas288msLuzMalhaNafila');
      expect(text).toContain(`${Math.floor(loadingFraction(m) * 100)}%`);
      // Barra da luz pela metade, em âmbar.
      const amber = drawnCommands(l).filter((c) => c.op === DRAW_OP.rect && c.color === COLORS.acao);
      expect(amber.length).toBe(2);
    }
  });
});

describe('tela de loading: nome do mapa longo', () => {
  it('encolhe para caber na largura útil, sem descer do piso', () => {
    const m = createLoadingModel();
    m.mapName = 'Construto do Bobo com um nome bem comprido que não cabe';
    for (const [w, h] of SIZES) {
      const floor = w >= 1280 ? MIN_TEXT.tv : MIN_TEXT.phone;
      const l = list(w, h);
      drawLoadingScreen(l, fonts, m, w, h, { minTextPx: floor });
      expectInside(l, w, h);
      for (const g of glyphs(l)) expect(g.h).toBeGreaterThanOrEqual(floor);
      expect(syntheticGlyphText(l)).toContain('CONSTRUTODOBOBOCOMUMNOMEBEMCOMPRIDOQUENÃOCABE');
    }
  });
});

describe('folha das fontes em uso (decisão #54)', () => {
  const withSource = parseFontPack(
    JSON.parse(
      JSON.stringify({
        ...syntheticFontPackFile(),
        fonts: {
          display: { ...syntheticFontFile(0), name: 'Derivada D', license: 'OFL-1.1', source: 'Origem D 1.0' },
          hud: { ...syntheticFontFile(1), name: 'Derivada H', license: 'OFL-1.1', source: 'Origem H 2.5' },
        },
      }),
    ),
  ).fonts;

  it('cabe nas 4 resoluções e em 4:3, só com as duas camadas do ui-fonts, com tudo o que o print confere', () => {
    for (const [w, h] of [...SIZES, [1024, 768]] as const) {
      const l = list(w, h);
      drawFontSpecimen(l, withSource, w, h);
      expectInside(l, w, h);
      expect(l.overflow).toBe(0);
      const gs = glyphs(l);
      expect(gs.length).toBeGreaterThan(50);
      expect(new Set(gs.map((g) => g.texture))).toEqual(new Set([0, 1]));
      const text = syntheticGlyphText(l);
      expect(text).toContain('FONTESEMUSO');
      expect(text).toContain('DISPLAYDerivadaD:derivadadeOrigemD1.0(OFL-1.1)');
      expect(text).toContain('HUDDerivadaH:derivadadeOrigemH2.5(OFL-1.1)');
      expect(text).toContain('BOBOFORCES');
      expect(text).toContain('AÇÃO,MUNIÇÃOEÁUDIO');
      expect(text).toContain('JOGAR');
      expect(text).toContain('PARTIDARÁPIDA');
      expect(text).toContain('AJUSTES');
      expect(text).toContain('VIDA72');
      expect(text).toContain('24/90');
      expect(text).toContain('2:45');
      expect(text).toContain('0123456789');
    }
  });

  it('botões, título com acentos e HUD de amostra não se cruzam nem invadem o rodapé', () => {
    for (const [w, h] of SIZES) {
      const l = list(w, h);
      drawFontSpecimen(l, withSource, w, h);
      const cmds = drawnCommands(l);
      const sky = cmds.find((c) => c.op === DRAW_OP.rect && c.color === 0x8fc3e8ff);
      // O preenchimento do JOGAR (a faixa do logo também é âmbar, mas bem mais achatada).
      const play = cmds.find((c) => c.op === DRAW_OP.rect && c.color === COLORS.acao && c.w / c.h < 10);
      expect(sky).toBeDefined();
      expect(play).toBeDefined();
      // O HUD de amostra fica à direita dos botões.
      expect(sky!.x).toBeGreaterThan(play!.x + play!.w);
      // Texto corrido e algarismos (desenhados logo antes dos botões) ficam abaixo de tudo do meio.
      const before = cmds.slice(0, play!.index).filter((c) => c.op === DRAW_OP.glyph);
      const footer = before.slice(-(t('fontSpecimen.sample').replace(/ /g, '').length + 20));
      const middle = cmds.slice(play!.index);
      const middleBottom = Math.max(...middle.map((c) => c.y + c.h));
      for (const g of footer) expect(g.y).toBeGreaterThanOrEqual(middleBottom);
    }
  });

  it('pacote antigo sem origem mostra só o nome; sem fontes desenha só as formas, sem lançar', () => {
    const l = list(1280, 720);
    drawFontSpecimen(l, fonts, 1280, 720);
    const text = syntheticGlyphText(l);
    expect(text).toContain('DISPLAYSintética0');
    expect(text).not.toContain('derivada');
    const empty = list(1280, 720);
    expect(() => drawFontSpecimen(empty, null, 1280, 720)).not.toThrow();
    expect(glyphs(empty).length).toBe(0);
    expect(empty.count).toBeGreaterThan(0);
  });
});

/** Ids focáveis que o D-pad alcança a partir de `start` (busca em largura pelas 4 direções). */
function reachable(layout: ReturnType<typeof layoutTree>, start: string): Set<string> {
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const dir of ['up', 'down', 'left', 'right'] as const) {
      const next = moveFocus(layout, id, dir);
      if (next !== null && !seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

describe('título com itens de teste', () => {
  const four = [
    { id: 'bench', labelKey: 'test.item.bench' },
    { id: 'controllers', labelKey: 'test.item.controllers' },
    { id: 'keyboard', labelKey: 'test.item.keyboard' },
    { id: 'audio', labelKey: 'test.item.audio' },
  ] as const;
  /** Os 9 itens do Switch com os rótulos curtos (`test.item.*`). */
  const nine = [
    { id: 'bench-dock', labelKey: 'test.item.benchDock' },
    { id: 'bench-solo', labelKey: 'test.item.benchSolo' },
    { id: 'bench-zombies', labelKey: 'test.item.benchZombies' },
    { id: 'bench-bots48', labelKey: 'test.item.benchStress' },
    { id: 'bench-planb', labelKey: 'test.item.benchPlanB' },
    { id: 'bench-gpu', labelKey: 'test.item.benchGpu' },
    { id: 'controllers', labelKey: 'test.item.controllers' },
    { id: 'keyboard', labelKey: 'test.item.keyboard' },
    { id: 'audio', labelKey: 'test.item.audio' },
  ] as const;

  function title(items: readonly { id: string; labelKey: StringKey }[], w: number, h: number) {
    return layoutTree(
      titleScreen.build({ version: '0.1.0', codename: 'Teste', canExit: true, extraItems: items }),
      { x: 0, y: 0, w, h },
      1,
      { fonts, minTextPx: w >= 1280 ? MIN_TEXT.tv : MIN_TEXT.phone },
    );
  }

  it('até 4 itens: coluna única de 330 px à direita, `test:<id>`, sem tirar o foco de JOGAR', () => {
    for (const [w, h] of SIZES) {
      const layout = title(four, w, h);
      expect(layout.focusable.map((b) => b.id)).toEqual([
        'play',
        'settings',
        'quit',
        'test:bench',
        'test:controllers',
        'test:keyboard',
        'test:audio',
      ]);
      const tests = layout.rects.get(layout.byId.get('tests')!)!;
      const buttons = layout.rects.get(layout.byId.get('buttons')!)!;
      expect(tests.w).toBe(Math.round(330 * layout.scale));
      for (const id of ['test:bench', 'test:audio']) expect(layout.rects.get(layout.byId.get(id)!)!.w).toBe(tests.w);
      expect(overlaps(tests, buttons)).toBe(false);
      expect(tests.x + tests.w).toBeLessThanOrEqual(layout.content.x + layout.content.w);
      expect(moveFocus(layout, 'play', 'right')?.startsWith(TITLE_ACTION_TEST_PREFIX)).toBe(true);
      expect(reachable(layout, 'play').size).toBe(layout.focusable.length);
    }
  });

  it('9 itens (Switch): grade de 2 colunas embaixo à direita, acima da versão, alcançável pelo D-pad', () => {
    for (const [w, h] of [...SIZES, [1024, 768]] as const) {
      const layout = title(nine, w, h);
      const rect = (id: string) => layout.rects.get(layout.byId.get(id)!)!;
      const ids = layout.focusable.map((b) => b.id!);
      expect(ids.slice(0, 3)).toEqual(['play', 'settings', 'quit']);
      expect(ids.slice(3)).toEqual(nine.map((i) => `test:${i.id}`));
      const cells = nine.map((i) => rect(`test:${i.id}`));
      // Duas colunas: ímpares à esquerda, pares à direita, linhas de 2.
      expect(new Set(cells.map((c) => c.x)).size).toBe(2);
      expect(cells[1]!.y).toBe(cells[0]!.y);
      expect(cells[2]!.y).toBeGreaterThan(cells[0]!.y);
      const grid = rect('tests');
      const version = rect('version');
      expect(grid.y + grid.h).toBeLessThanOrEqual(version.y);
      expect(grid.x + grid.w).toBeLessThanOrEqual(layout.content.x + layout.content.w);
      for (const id of ['logo', 'logoBar', 'buttons', 'credit', 'version'])
        expect(overlaps(grid, rect(id))).toBe(false);
      for (const c of cells) expect(c.h).toBe(Math.round(48 * layout.scale));
      // Todos alcançáveis a partir de JOGAR, e de qualquer item de teste se volta a JOGAR.
      expect([...reachable(layout, 'play')].sort()).toEqual([...ids].sort());
      for (const id of ids.slice(3)) expect(reachable(layout, id).has('play')).toBe(true);
    }
  });

  it('sem itens, o título do M0 fica igual', () => {
    const layout = layoutTree(titleScreen.build({ version: '0.1.0', codename: 'Teste' }), {
      x: 0,
      y: 0,
      w: 1280,
      h: 720,
    });
    expect(layout.byId.has('tests')).toBe(false);
    expect(layout.focusable.map((b) => b.id)).toEqual(['play', 'settings']);
  });
});
