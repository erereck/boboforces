import { describe, expect, it } from 'vitest';
import { createDrawList, DRAW_OP, resetDrawList, type DrawList } from '../draw-list.ts';
import { drawnCommands, syntheticFontPack, syntheticGlyphText, type DrawnCommand } from '../test-fixtures.ts';
import { COLORS, MIN_TEXT, PLAYER_COLORS, TEAM_COLORS, withAlpha } from '../tokens.ts';
import {
  createHudModel,
  createHudSharedModel,
  drawHud,
  drawHudShared,
  HUD_METRICS,
  hudSharedPlateHeight,
  layoutHudScreen,
  type HudModel,
  type HudRect,
} from './hud.ts';

// Fonte sintética: o glifo tem a altura do em (20 px de atlas para em 20), então a altura do quad = px da fonte.
const fonts = syntheticFontPack().fonts;

/** As 4 resoluções de referência da tarefa e o piso de texto de cada contexto (arte-ux.md §6.8). */
const SIZES = [
  { width: 640, height: 360, single: MIN_TEXT.switchSplit },
  { width: 667, height: 375, single: MIN_TEXT.phone },
  { width: 1280, height: 720, single: MIN_TEXT.tv },
  { width: 1920, height: 1080, single: MIN_TEXT.tv },
] as const;

function sampleModel(slot = 0): HudModel {
  const m = createHudModel();
  m.health = 72;
  m.clip = 24;
  m.reserve = 90;
  m.kills = 1234;
  m.deaths = 7;
  m.playerSlot = slot;
  m.team = 0;
  m.spread = 1;
  m.hitMarker = 1;
  return m;
}

function inside(c: DrawnCommand, r: HudRect, tolerance = 0.5): boolean {
  return (
    c.x >= r.x - tolerance &&
    c.y >= r.y - tolerance &&
    c.x + c.w <= r.x + r.width + tolerance &&
    c.y + c.h <= r.y + r.height + tolerance
  );
}

function overlaps(a: DrawnCommand, b: DrawnCommand): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

const plates = (list: DrawList): DrawnCommand[] =>
  drawnCommands(list).filter((c) => c.op === DRAW_OP.rect && c.color === COLORS.hudFundo);
const glyphs = (list: DrawList): DrawnCommand[] => drawnCommands(list).filter((c) => c.op === DRAW_OP.glyph);

describe('HUD por vista: layout nas 4 resoluções e com 1 a 4 vistas', () => {
  for (const size of SIZES) {
    for (const [count, vertical] of [
      [1, false],
      [2, false],
      [2, true],
      [3, false],
      [4, false],
    ] as const) {
      it(`${size.width}×${size.height}, ${count} vista(s)${vertical ? ' lado a lado' : ''}`, () => {
        const minTextPx = count >= 3 ? MIN_TEXT.switchSplit : size.single;
        const screen = layoutHudScreen(count, size.width, size.height, { minTextPx, vertical });
        expect(screen.views.length).toBe(count);
        const shared = createDrawList();
        resetDrawList(shared, size.width, size.height);
        const sharedModel = createHudSharedModel();
        sharedModel.timeLeftS = 165;
        sharedModel.teamCount = 2;
        sharedModel.teamScores[0] = 12;
        sharedModel.teamScores[1] = 9;
        drawHudShared(shared, fonts, sharedModel, screen.shared);
        const sharedPlates = plates(shared);
        if (count !== 3) expect(sharedPlates.length).toBe(1);
        for (const c of drawnCommands(shared)) {
          expect(inside(c, { x: 0, y: 0, width: size.width, height: size.height })).toBe(true);
        }

        screen.views.forEach((view, i) => {
          const list = createDrawList();
          resetDrawList(list, size.width, size.height);
          drawHud(list, fonts, sampleModel(i), view);
          const rect = screen.rects[i] as HudRect;
          // Tudo dentro da própria vista.
          for (const c of drawnCommands(list)) expect(inside(c, rect)).toBe(true);
          // Texto nunca abaixo do piso; números críticos no piso × 1,375 (16 → 22 no 3–4P).
          const gs = glyphs(list);
          expect(gs.length).toBeGreaterThan(0);
          for (const g of gs) expect(g.h).toBeGreaterThanOrEqual(minTextPx - 1e-6);
          // Plaquinhas sem sobreposição entre si nem com o placar compartilhado.
          const ps = plates(list);
          expect(ps.length).toBeGreaterThanOrEqual(3);
          for (let a = 0; a < ps.length; a++) {
            for (let b = a + 1; b < ps.length; b++) expect(overlaps(ps[a]!, ps[b]!)).toBe(false);
            for (const sp of sharedPlates) expect(overlaps(ps[a]!, sp)).toBe(false);
          }
          // Com 2+ vistas, a borda é a cor do jogador da vista.
          const border = drawnCommands(list).filter((c) => c.color === PLAYER_COLORS[i]);
          expect(border.length).toBeGreaterThanOrEqual(count > 1 ? 4 : 0);
        });
      });
    }
  }
});

describe('HUD por vista: conteúdo', () => {
  const view = layoutHudScreen(1, 1280, 720, { minTextPx: MIN_TEXT.tv }).views[0]!;
  const quad = layoutHudScreen(4, 1280, 720, { minTextPx: MIN_TEXT.switchSplit }).views[1]!;

  it('1 vista: abates e mortes, vida com rótulo, munição com reserva (números pt-BR, sem Intl)', () => {
    const list = createDrawList();
    drawHud(list, fonts, sampleModel(), view);
    const text = syntheticGlyphText(list);
    expect(text).toContain('ABATES1.234');
    expect(text).toContain('MORTES7');
    expect(text).toContain('VIDA72');
    expect(text).toContain('24/90');
    expect(text).not.toContain('P1');
  });

  it('3–4P compacto: P2 na cor do jogador, vida só com número, munição só com o pente', () => {
    const list = createDrawList();
    drawHud(list, fonts, sampleModel(1), quad);
    const text = syntheticGlyphText(list);
    expect(text).toContain('P2');
    expect(text).not.toContain('VIDA');
    expect(text).not.toContain('MORTES');
    expect(text).toContain('72');
    expect(text).toContain('24');
    expect(text).not.toContain('/');
    const p2 = drawnCommands(list).filter((c) => c.op === DRAW_OP.glyph && c.color === PLAYER_COLORS[1]);
    expect(p2.length).toBe(2);
    // Ícone ● do P2 (faixas de pixel na cor do jogador) além da borda.
    const icon = drawnCommands(list).filter((c) => c.op === DRAW_OP.rect && c.color === PLAYER_COLORS[1]);
    expect(icon.length).toBe(4 + 5);
  });

  it('vida baixa e pente vazio em perigo; vida cheia em ok', () => {
    const m = sampleModel();
    m.health = 20;
    m.clip = 0;
    const list = createDrawList();
    drawHud(list, fonts, m, view);
    expect(glyphs(list).some((g) => g.color === COLORS.perigo)).toBe(true);
    m.health = 100;
    m.clip = 30;
    const list2 = createDrawList();
    drawHud(list2, fonts, m, view);
    expect(glyphs(list2).some((g) => g.color === COLORS.perigo)).toBe(false);
    expect(drawnCommands(list2).some((c) => c.op === DRAW_OP.rect && c.color === COLORS.ok)).toBe(true);
  });

  it('retícula abre com o spread; hitmarker branco no corpo e âmbar na cabeça', () => {
    const cross = (spread: number, hit: number, head: number): DrawnCommand[] => {
      const m = sampleModel();
      m.spread = spread;
      m.hitMarker = hit;
      m.headshotMarker = head;
      const list = createDrawList();
      drawHud(list, fonts, m, view);
      return drawnCommands(list);
    };
    const cx = 640;
    const armRight = (cs: DrawnCommand[]) =>
      Math.min(...cs.filter((c) => c.color === withAlpha(COLORS.texto, 0.92) && c.x > cx).map((c) => c.x));
    expect(armRight(cross(1, 0, 0))).toBeGreaterThan(armRight(cross(0, 0, 0)));
    expect(cross(0, 1, 0).filter((c) => c.color === COLORS.texto && c.w === c.h).length).toBe(12);
    expect(cross(0, 1, 1).filter((c) => c.color === COLORS.acao && c.w === c.h).length).toBe(12);
    expect(cross(0, 0, 0).filter((c) => c.color === COLORS.acao).length).toBe(0);
  });

  it('morto: sem retícula, "RENASCENDO…" e a contagem', () => {
    const m = sampleModel();
    m.dead = true;
    m.respawnS = 2.2;
    const list = createDrawList();
    drawHud(list, fonts, m, view);
    const text = syntheticGlyphText(list);
    expect(text).toContain('RENASCENDO…3');
    expect(drawnCommands(list).filter((c) => c.color === withAlpha(COLORS.texto, 0.92)).length).toBe(0);
  });

  it('dano direcional na borda certa (positivo = à esquerda, como o yaw)', () => {
    const side = (angle: number): DrawnCommand => {
      const m = sampleModel();
      m.damageAngle = angle;
      m.damageAmount = 1;
      const list = createDrawList();
      drawHud(list, fonts, m, view);
      const bars = drawnCommands(list).filter((c) => c.color === withAlpha(COLORS.perigo, 0.9));
      expect(bars.length).toBe(1);
      return bars[0]!;
    };
    expect(side(0).y).toBeLessThan(100);
    expect(side(Math.PI).y).toBeGreaterThan(600);
    expect(side(Math.PI / 2).x).toBeLessThan(100);
    expect(side(-Math.PI / 2).x).toBeGreaterThan(1100);
  });

  it('"Clique para mirar" sob a retícula; sem fontes, só formas (não lança)', () => {
    const m = sampleModel();
    m.clickToAim = true;
    const list = createDrawList();
    drawHud(list, fonts, m, view);
    expect(syntheticGlyphText(list)).toContain('Cliqueparamirar');
    const bare = createDrawList();
    drawHud(bare, null, m, view);
    expect(glyphs(bare).length).toBe(0);
    expect(plates(bare).length).toBeGreaterThanOrEqual(3);
  });
});

describe('placar e tempo compartilhados', () => {
  it('1P no topo; 2P e 4P no cruzamento central; 3P no quadrante livre', () => {
    const one = layoutHudScreen(1, 1280, 720, { minTextPx: 22 });
    expect(one.shared.mode).toBe('top');
    const two = layoutHudScreen(2, 1280, 720, { minTextPx: 16 });
    expect(two.shared.mode).toBe('center');
    expect(two.rects).toEqual([
      { x: 0, y: 0, width: 1280, height: 360 },
      { x: 0, y: 360, width: 1280, height: 360 },
    ]);
    const vertical = layoutHudScreen(2, 1280, 720, { minTextPx: 16, vertical: true });
    expect(vertical.rects[1]).toEqual({ x: 640, y: 0, width: 640, height: 720 });
    const three = layoutHudScreen(3, 1280, 720, { minTextPx: 16 });
    expect(three.shared).toMatchObject({ mode: 'spare', x: 640, y: 360, width: 640, height: 360 });
    const four = layoutHudScreen(4, 1280, 720, { minTextPx: 16 });
    expect(four.views.map((v) => v.scale)).toEqual([1, 1, 1, 1]);
    // Folga do centro só nas bordas internas.
    const clearance = Math.ceil(hudSharedPlateHeight(1, 16) / 2) + HUD_METRICS.marginY;
    expect(four.views[0]).toMatchObject({ insetTop: 0, insetBottom: clearance, insetRight: 0 });
    expect(four.views[3]).toMatchObject({ insetTop: clearance, insetBottom: 0 });
  });

  it('times com ícone e cor, relógio m:ss da tabela; sem conteúdo, nada (fora o fundo do 3P)', () => {
    const screen = layoutHudScreen(4, 1280, 720, { minTextPx: 16 });
    const model = createHudSharedModel();
    model.timeLeftS = 65.2;
    model.teamCount = 2;
    model.teamScores[0] = 3;
    model.teamScores[1] = 14;
    const list = createDrawList();
    drawHudShared(list, fonts, model, screen.shared);
    expect(syntheticGlyphText(list)).toBe('31:0614');
    expect(glyphs(list).filter((g) => g.color === TEAM_COLORS[1]).length).toBe(2);
    const empty = createDrawList();
    drawHudShared(empty, fonts, createHudSharedModel(), screen.shared);
    expect(empty.count).toBe(0);
    const spare = createDrawList();
    drawHudShared(spare, fonts, createHudSharedModel(), layoutHudScreen(3, 1280, 720, { minTextPx: 16 }).shared);
    expect(drawnCommands(spare).map((c) => c.color)).toEqual([COLORS.bunker]);
  });

  it('vistas locais (ViewDesc.hud): origem 0,0 e mesmo tamanho', () => {
    const screen = layoutHudScreen(4, 1920, 1080, { minTextPx: 16, viewLocal: true });
    expect(screen.views[3]).toMatchObject({ x: 0, y: 0, width: 960, height: 540, scale: 1.5 });
    expect(screen.rects[3]).toEqual({ x: 960, y: 540, width: 960, height: 540 });
  });
});
