import { describe, expect, it } from 'vitest';
import { createDrawList, DRAW_OP, resetDrawList, type DrawList } from '../draw-list.ts';
import { drawnCommands, syntheticFontPack, syntheticGlyphText, type DrawnCommand } from '../test-fixtures.ts';
import { COLORS, MIN_TEXT, PLAYER_COLORS, TEAM_COLORS, withAlpha } from '../tokens.ts';
import {
  createHudModel,
  createHudSharedModel,
  drawHud,
  HUD_AMMO,
  HUD_CROSSHAIR,
  drawHudShared,
  hitPrimaryOption,
  PRIMARY_LAYOUT,
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
  // M2: a arma na mão e as granadas (as plaquinhas novas entram no teste de layout das 4 resoluções).
  m.weaponName = 'Rattler';
  m.weaponCategory = 'Fuzil';
  m.grenades = 2;
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

  it('marcador de jogador local (M3, fase 1d): o símbolo na cor dele no lugar do chevron do time', () => {
    const bot = sampleModel();
    bot.markerCount = 1;
    bot.markers[0] = 640;
    bot.markers[1] = 300;
    bot.markerColor = TEAM_COLORS[0]!;
    bot.markerSeat[0] = -1;
    const local = sampleModel();
    local.markerCount = 1;
    local.markers[0] = 640;
    local.markers[1] = 300;
    local.markerColor = TEAM_COLORS[0]!;
    local.markerSeat[0] = 2;
    const count = (m: HudModel, color: number): number => {
      const list = createDrawList();
      drawHud(list, fonts, m, view);
      return drawnCommands(list).filter((c) => c.op === DRAW_OP.rect && c.color === color).length;
    };
    expect(count(bot, PLAYER_COLORS[2]!)).toBe(0);
    expect(count(local, PLAYER_COLORS[2]!)).toBeGreaterThan(0);
    expect(count(local, TEAM_COLORS[0]!)).toBeLessThan(count(bot, TEAM_COLORS[0]!));
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
      // Sem o ícone da granada (o corpo dele é um quadrado claro, como os do hitmarker).
      m.grenades = -1;
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

  it('M2: nome · categoria em cima da munição e as granadas ao lado (1–2P); no compacto, só o pente', () => {
    const list = createDrawList();
    drawHud(list, fonts, sampleModel(), view);
    const text = syntheticGlyphText(list);
    expect(text).toContain('Rattler·Fuzil');
    expect(text).toContain('24/90');
    const quadList = createDrawList();
    drawHud(quadList, fonts, sampleModel(1), quad);
    expect(syntheticGlyphText(quadList)).not.toContain('Rattler');
  });

  it('M2: faca sem munição; granada na mão só com o pente; ponto no lugar da cruz', () => {
    const m = sampleModel();
    m.weaponName = 'Butter Knife';
    m.weaponCategory = 'Faca';
    m.ammoMode = HUD_AMMO.none;
    m.crosshair = HUD_CROSSHAIR.dot;
    const list = createDrawList();
    drawHud(list, fonts, m, view);
    const text = syntheticGlyphText(list);
    expect(text).toContain('ButterKnife·Faca');
    expect(text).not.toContain('24');
    // Fase 2b: sem a munição, o nome fica onde estava (em cima) e não cobre a plaquinha das granadas.
    const ps = plates(list);
    for (let a = 0; a < ps.length; a++) {
      for (let b = a + 1; b < ps.length; b++) expect(overlaps(ps[a]!, ps[b]!), `plaquinhas ${a} e ${b}`).toBe(false);
    }
    // O ponto: um quadrado claro só, no centro.
    const light = drawnCommands(list).filter((c) => c.color === withAlpha(COLORS.texto, 0.92));
    expect(light.length).toBe(1);
    expect(light[0]!.w).toBe(light[0]!.h);
    m.ammoMode = HUD_AMMO.clip;
    m.clip = 2;
    m.grenades = -1;
    const list2 = createDrawList();
    drawHud(list2, fonts, m, view);
    expect(syntheticGlyphText(list2)).not.toContain('/');
  });

  it('M2: luneta escurece fora do círculo, sem a cruz, com o ponto vermelho no meio e tudo dentro da vista', () => {
    const m = sampleModel();
    m.scope = 1;
    m.hitMarker = 0;
    const list = createDrawList();
    drawHud(list, fonts, m, view);
    const cs = drawnCommands(list);
    expect(cs.filter((c) => c.color === withAlpha(COLORS.texto, 0.92)).length).toBe(0);
    const dark = cs.filter((c) => c.op === DRAW_OP.rect && c.color === COLORS.bunker);
    expect(dark.length).toBeGreaterThan(60);
    expect(cs.some((c) => c.color === COLORS.perigo)).toBe(true);
    for (const c of cs) expect(inside(c, { x: 0, y: 0, width: 1280, height: 720 })).toBe(true);
    expect(list.overflow).toBe(0);
    // A luneta sai antes das plaquinhas: vida, munição e abates ficam por cima dela.
    const firstDark = cs.findIndex((c) => c.op === DRAW_OP.rect && c.color === COLORS.bunker);
    const firstPlate = cs.findIndex((c) => c.op === DRAW_OP.rect && c.color === COLORS.hudFundo);
    expect(firstPlate).toBeGreaterThan(firstDark);
    expect(plates(list).length).toBeGreaterThanOrEqual(3);
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

  it('M2 (fase 4h): a dica de 1 linha: a tecla em âmbar e o texto, dentro da vista, sem encostar nas plaquinhas', () => {
    for (const size of SIZES) {
      const v = layoutHudScreen(1, size.width, size.height, { minTextPx: size.single }).views[0]!;
      const m = sampleModel();
      m.tipKey = 'Clique no analógico esq.';
      m.tipText = 'agacha; correndo, desliza';
      m.tipAlpha = 1;
      const list = createDrawList();
      drawHud(list, fonts, m, v);
      // A fonte sintética não desenha o espaço.
      expect(syntheticGlyphText(list)).toContain('Cliquenoanalógicoesq.agacha;correndo,desliza');
      const tipGlyphs = glyphs(list).filter((c) => c.color === COLORS.acao);
      expect(tipGlyphs.length).toBeGreaterThan(0);
      for (const c of drawnCommands(list)) expect(inside(c, v), `${size.width}×${size.height}`).toBe(true);
      // A plaquinha da dica (fundo com 0,7 de alfa, a mesma cor) não encosta nas outras.
      const all = plates(list);
      const tipPlate = all.reduce((a, b) =>
        b.y > a.y && b.x > v.x + v.width * 0.2 && b.x < v.x + v.width * 0.5 ? b : a,
      );
      for (const p of all)
        if (p !== tipPlate) expect(overlaps(p, tipPlate), `${size.width}×${size.height}`).toBe(false);
    }
    // Sem alfa, nada.
    const m = sampleModel();
    m.tipKey = 'C';
    m.tipText = 'agacha';
    const list = createDrawList();
    drawHud(list, fonts, m, view);
    expect(syntheticGlyphText(list)).not.toContain('agacha');
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

describe('tela de morte (M2, fase 2c)', () => {
  const view = layoutHudScreen(1, 1280, 720, { minTextPx: MIN_TEXT.tv }).views[0]!;
  const quad = layoutHudScreen(4, 1280, 720, { minTextPx: MIN_TEXT.switchSplit }).views[1]!;
  const NAMES = ['Rattler', 'Buzzer', 'Door Knocker', 'Peekaboo', 'Kaboomer', 'Lawnmower'];
  const CATS = ['Fuzil', 'SMG', 'Escopeta', 'Sniper', 'Lança-foguetes', 'Metralhadora'];

  function deadModel(): HudModel {
    const m = sampleModel();
    m.dead = true;
    m.respawnS = 2.4;
    m.hitMarker = 0;
    m.deathLabel = 'ABATIDO POR';
    m.deathName = 'Normal Bob';
    m.deathWeapon = 'Door Knocker';
    m.deathHp = 64;
    m.primaryNames = NAMES;
    m.primaryCategories = CATS;
    m.primarySelected = 2;
    return m;
  }

  it('faixa de quem matou, contagem e o anel das 6 primárias, com a escolhida em âmbar e nada se tocando', () => {
    const list = createDrawList();
    drawHud(list, fonts, deadModel(), view);
    const text = syntheticGlyphText(list);
    for (const part of ['ABATIDOPOR', 'NormalBob·DoorKnocker·64HP', 'RENASCENDO', '3', 'ARMADAPRÓXIMAVIDA']) {
      expect(text, part).toContain(part);
    }
    for (const name of NAMES) expect(text).toContain(name.replace(' ', ''));
    // De cima para baixo: o rótulo do anel, o anel e, embaixo dele, a faixa de quem matou.
    expect(text.indexOf('ARMADAPRÓXIMAVIDA')).toBeLessThan(text.indexOf('ABATIDOPOR'));
    const cs = drawnCommands(list);
    const chosen = cs.filter((c) => c.op !== DRAW_OP.glyph && c.color === COLORS.acao);
    expect(chosen.length).toBe(1);
    for (const c of cs) expect(inside(c, { x: 0, y: 0, width: 1280, height: 720 })).toBe(true);
    // O anel fica em volta do centro, e as plaquinhas do anel não se tocam (nem tocam a escolhida).
    const ring = [...plates(list), ...chosen].filter((p) => Math.hypot(p.x + p.w / 2 - 640, p.y + p.h / 2 - 360) > 150);
    expect(ring.length).toBeGreaterThanOrEqual(6);
    for (let a = 0; a < ring.length; a++) {
      for (let b = a + 1; b < ring.length; b++) expect(overlaps(ring[a]!, ring[b]!)).toBe(false);
    }
  });

  // 1 vista nas 4 resoluções; 2 vistas só de 1280×720 para cima (a tela dividida é do PC e do Switch, nunca a 640×360
  // nem no celular).
  it('1 vista nas 4 resoluções e 2 vistas a 720p+, com a dica: tudo dentro da vista e nada se tocando', () => {
    for (const size of SIZES) {
      for (const count of size.width >= 1280 ? [1, 2] : [1]) {
        const lay = layoutHudScreen(count, size.width, size.height, { minTextPx: size.single });
        const v = lay.views[0]!;
        const m = deadModel();
        m.hardTimeHint = true;
        const list = createDrawList();
        drawHud(list, fonts, m, v);
        const tag = `${size.width}×${size.height}, ${count} vista(s)`;
        const cs = drawnCommands(list);
        for (const c of cs) expect(inside(c, v), tag).toBe(true);
        const boxes = [...plates(list), ...cs.filter((c) => c.op !== DRAW_OP.glyph && c.color === COLORS.acao)];
        for (let i = 0; i < boxes.length; i++) {
          for (let j = i + 1; j < boxes.length; j++) {
            expect(overlaps(boxes[i]!, boxes[j]!), `${tag}: ${i} e ${j}`).toBe(false);
          }
        }
      }
    }
  });

  it('sem matador: só a causa; com a derrota feia, a dica embaixo', () => {
    const m = deadModel();
    m.deathLabel = '';
    m.deathName = 'Caiu no vazio';
    m.deathWeapon = '';
    m.deathHp = -1;
    m.hardTimeHint = true;
    const list = createDrawList();
    drawHud(list, fonts, m, view);
    const text = syntheticGlyphText(list);
    expect(text).toContain('Caiunovazio');
    expect(text).not.toContain('ABATIDO');
    expect(text).not.toContain('HP');
    // A fonte sintética do teste não tem o » (a real tem: Latin-1).
    expect(text).toMatch(/Tápuxado\?Pausa.Ajustardesafio/);
  });

  it('vista de bot (sem opções): sem anel; no 3–4P o seletor vira uma linha', () => {
    const bot = deadModel();
    bot.primaryNames = [];
    const list = createDrawList();
    drawHud(list, fonts, bot, view);
    expect(syntheticGlyphText(list)).not.toContain('ARMADAPRÓXIMA');
    const small = createDrawList();
    drawHud(small, fonts, deadModel(), quad);
    const text = syntheticGlyphText(small);
    expect(text).toMatch(/.DoorKnocker./);
    expect(text).not.toContain('Kaboomer');
    for (const c of drawnCommands(small)) expect(inside(c, quad)).toBe(true);
  });

  it('formato pelo espaço: anel a 1280×720, fileira a 640×360, linha no 3–4P; o toque acha a opção pelo retângulo', () => {
    const at = (w: number, h: number, count: number, min: number): HudModel => {
      const m = deadModel();
      drawHud(createDrawList(), fonts, m, layoutHudScreen(count, w, h, { minTextPx: min }).views[count >= 3 ? 1 : 0]!);
      return m;
    };
    const big = at(1280, 720, 1, MIN_TEXT.tv);
    expect([big.primaryHit.layout, big.primaryHit.count]).toEqual([PRIMARY_LAYOUT.ring, 6]);
    const small = at(640, 360, 1, MIN_TEXT.switchSplit);
    expect([small.primaryHit.layout, small.primaryHit.count]).toEqual([PRIMARY_LAYOUT.row, 6]);
    const tiny = at(1280, 720, 4, MIN_TEXT.switchSplit);
    expect([tiny.primaryHit.layout, tiny.primaryHit.count]).toEqual([PRIMARY_LAYOUT.line, 0]);
    for (const m of [big, small]) {
      for (let i = 0; i < 6; i++) {
        const r = m.primaryHit.rects;
        expect(hitPrimaryOption(m.primaryHit, r[i * 4]! + r[i * 4 + 2]! / 2, r[i * 4 + 1]! + r[i * 4 + 3]! / 2)).toBe(
          i,
        );
      }
    }
    expect(hitPrimaryOption(big.primaryHit, 640, 360)).toBe(-1);
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
