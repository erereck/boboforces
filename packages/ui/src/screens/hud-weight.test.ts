import { describe, expect, it } from 'vitest';
import { createDrawList, DRAW_OP, resetDrawList, type DrawList } from '../draw-list.ts';
import { drawnCommands, syntheticFontPack, syntheticGlyphText, type DrawnCommand } from '../test-fixtures.ts';
import { COLORS, MIN_TEXT, TEAM_COLORS, withAlpha } from '../tokens.ts';
import {
  createHudModel,
  createHudSharedModel,
  drawHud,
  drawHudShared,
  HUD_INTERACT,
  HUD_TOUCH_SIDE,
  layoutHudScreen,
  PRIMARY_LAYOUT,
  type HudModel,
  type HudRect,
} from './hud.ts';
import {
  createKillFeedModel,
  createScoreboardModel,
  drawCenterNotice,
  drawKillFeed,
  drawMatchCountdown,
  drawMatchGo,
  drawScoreboard,
  killFeedHeight,
  createOverlayPlace,
  placeOverlay,
  pushKillFeed,
} from './match-hud.ts';

/** M12 (fase 2): a HUD com peso. O desenho dos campos novos e o layout com todos eles acesos ao mesmo tempo. */

const fonts = syntheticFontPack().fonts;

const SIZES = [
  { width: 640, height: 360, single: MIN_TEXT.switchSplit },
  { width: 667, height: 375, single: MIN_TEXT.phone },
  { width: 1280, height: 720, single: MIN_TEXT.tv },
  { width: 1920, height: 1080, single: MIN_TEXT.tv },
  // 4:3.
  { width: 1024, height: 768, single: MIN_TEXT.tv },
] as const;

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

/** Tudo aceso: o X de abate com o nome e a sequência, o R recarrega, a barra da recarga, os "+N", o rastro e a vinheta,
 * os indicadores de dano, o pente baixo e o aviso de interagir. */
function busyModel(slot = 0): HudModel {
  const m = createHudModel();
  m.health = 24;
  m.maxHealth = 100;
  m.healthTrail = 60;
  m.lowHealth = 1;
  m.clip = 0;
  m.clipSize = 30;
  m.reserve = 90;
  m.kills = 12;
  m.deaths = 3;
  m.playerSlot = slot;
  m.team = 0;
  m.weaponName = 'Rattler';
  m.weaponCategory = 'Fuzil';
  m.grenades = 2;
  m.hitMarker = 1;
  m.hitPop = 1;
  m.killMarker = 1;
  m.killScale = 1.4;
  m.killName = 'NORMAL BOB';
  m.killNameAlpha = 1;
  m.streakText = 'ABATE DUPLO';
  m.streakAlpha = 1;
  m.killsBeat = 1;
  m.reload = 0.4;
  m.reloadKey = 'R';
  m.reloadText = 'recarrega';
  m.points = 1234;
  m.pointsLabel = '$';
  m.gainCount = 2;
  m.gainValues!.set([300, 100]);
  m.gainAlphas!.set([1, 0.5]);
  m.gainRise!.set([0, 0.5]);
  m.damageCount = 4;
  m.damageAngles!.set([0, 1, -2, 3]);
  m.damageAlphas!.set([1, 1, 0.5, 0.2]);
  m.damageWeights!.set([1, 0.2, 0.5, 0]);
  m.interact = HUD_INTERACT.repair;
  return m;
}

describe('M12 (fase 2): layout com tudo aceso', () => {
  for (const size of SIZES) {
    // A tela dividida só de 1280×720 para cima (como os testes da tela de morte: nunca a 640×360 nem no celular).
    for (const count of size.width >= 1280 ? ([1, 2, 4] as const) : ([1, 4] as const)) {
      it(`${size.width}×${size.height}, ${count} vista(s): tudo dentro da vista, plaquinhas sem se tocar, piso do texto`, () => {
        const minTextPx = count >= 3 ? MIN_TEXT.switchSplit : size.single;
        const screen = layoutHudScreen(count, size.width, size.height, { minTextPx });
        screen.views.forEach((view, i) => {
          const list = createDrawList(4096);
          resetDrawList(list, size.width, size.height);
          const m = busyModel(i);
          // No 3–4P o aviso comprido de interagir não cabe na vista estreita (o texto não desce do piso).
          if (count >= 3) m.interact = HUD_INTERACT.none;
          drawHud(list, fonts, m, view);
          const tag = `${size.width}×${size.height}/${count}: vista ${i}`;
          for (const c of drawnCommands(list)) expect(inside(c, screen.rects[i] as HudRect), tag).toBe(true);
          for (const g of drawnCommands(list).filter((c) => c.op === DRAW_OP.glyph)) {
            expect(g.h, tag).toBeGreaterThanOrEqual(minTextPx - 1e-6);
          }
          const ps = plates(list);
          for (let a = 0; a < ps.length; a++) {
            for (let b = a + 1; b < ps.length; b++) expect(overlaps(ps[a]!, ps[b]!), `${tag}: ${a} e ${b}`).toBe(false);
          }
          expect(list.overflow, tag).toBe(0);
        });
      });
    }
  }

  it('toque (640×360 e o celular), destro e canhoto: a munição ao lado da vida, sem o nome da arma, nada se tocando', () => {
    for (const [w, h, min] of [
      [640, 360, MIN_TEXT.phone],
      [844, 390, MIN_TEXT.phone],
      [1334, 750, MIN_TEXT.phone * 2],
    ] as const) {
      const view = layoutHudScreen(1, w, h, { minTextPx: min }).views[0]!;
      for (const side of [HUD_TOUCH_SIDE.rightHanded, HUD_TOUCH_SIDE.leftHanded]) {
        const m = busyModel();
        m.clip = 12;
        m.touchSide = side;
        const list = createDrawList(4096);
        drawHud(list, fonts, m, view);
        const tag = `${w}×${h} ${side === HUD_TOUCH_SIDE.rightHanded ? 'destro' : 'canhoto'}`;
        expect(syntheticGlyphText(list), tag).not.toContain('Rattler');
        // A vida e a munição na mesma faixa de baixo; destro, a munição à direita da vida; canhoto, à esquerda.
        const glyphs = drawnCommands(list).filter((c) => c.op === DRAW_OP.glyph);
        const hp = glyphs.find((g) => g.color === COLORS.perigo && g.y > h / 2)!;
        const ammo = glyphs.filter((g) => g.y > h / 2 && g.color === COLORS.texto && g.h > min * 1.2);
        expect(ammo.length, tag).toBeGreaterThan(0);
        if (side === HUD_TOUCH_SIDE.rightHanded) {
          expect(Math.min(...ammo.map((g) => g.x)), tag).toBeGreaterThan(hp.x);
          expect(Math.max(...ammo.map((g) => g.x)), tag).toBeLessThan(w / 2);
        } else {
          expect(Math.max(...ammo.map((g) => g.x)), tag).toBeLessThan(hp.x);
          expect(Math.min(...ammo.map((g) => g.x)), tag).toBeGreaterThan(w / 2);
        }
        const ps = plates(list);
        for (let a = 0; a < ps.length; a++) {
          for (let b = a + 1; b < ps.length; b++) expect(overlaps(ps[a]!, ps[b]!), `${tag}: ${a} e ${b}`).toBe(false);
        }
      }
    }
  });

  it('toque: a tela de morte fica fora da coluna dos botões (destro à direita, canhoto à esquerda)', () => {
    const names = ['Rattler', 'Pinpoint', 'Buzzer', 'Door Knocker', 'Leafblower', 'Peekaboo', 'Twang', 'Kaboomer'];
    for (const [w, h] of [
      [844, 390],
      [667, 375],
    ] as const) {
      const view = layoutHudScreen(1, w, h, { minTextPx: MIN_TEXT.phone }).views[0]!;
      for (const side of [HUD_TOUCH_SIDE.rightHanded, HUD_TOUCH_SIDE.leftHanded]) {
        const m = busyModel();
        m.dead = true;
        m.respawnS = 2.5;
        m.respawnFrac = 0.8;
        m.deathLabel = 'ABATIDO POR';
        m.deathName = 'Chill Bob';
        m.deathWeapon = 'Rattler';
        m.deathHp = 100;
        m.primaryNames = [...names, 'Bloop', 'Lawnmower'];
        m.primaryCategories = m.primaryNames.map(() => 'Fuzil');
        m.touchSide = side;
        m.touchReserve = 360;
        const list = createDrawList(4096);
        drawHud(list, fonts, m, view);
        const tag = `${w}×${h} ${side}`;
        expect(m.primaryHit.layout, tag).toBe(PRIMARY_LAYOUT.row);
        // O que a tela de morte desenha no meio (as opções e a faixa) não entra na coluna dos botões.
        const mid = drawnCommands(list).filter((c) => c.y > h * 0.25 && c.y + c.h < h * 0.95 && c.h < h * 0.5);
        for (const c of mid) {
          if (side === HUD_TOUCH_SIDE.rightHanded) expect(c.x + c.w, tag).toBeLessThanOrEqual(w - 360 + 0.5);
          else expect(c.x, tag).toBeGreaterThanOrEqual(360 - 0.5);
        }
        // Toda opção tocável.
        expect(m.primaryHit.count, tag).toBe(10);
      }
    }
  });
});

describe('M12 (fase 2): o centro da HUD', () => {
  const view = layoutHudScreen(1, 1280, 720, { minTextPx: MIN_TEXT.tv }).views[0]!;
  const draw = (m: HudModel): DrawnCommand[] => {
    const list = createDrawList(4096);
    drawHud(list, fonts, m, view);
    return drawnCommands(list);
  };
  const quiet = (): HudModel => {
    const m = createHudModel();
    m.health = 100;
    m.clip = 30;
    m.clipSize = 30;
    m.reserve = 90;
    return m;
  };

  it('X de abate: 4 quadrados por braço em perigo (âmbar na cabeça), maior no começo, com contorno escuro', () => {
    const m = quiet();
    m.killMarker = 1;
    m.killScale = 1;
    const red = draw(m).filter((c) => c.color === COLORS.perigo && c.w === c.h);
    expect(red.length).toBe(16);
    m.killHead = true;
    expect(draw(m).filter((c) => c.color === COLORS.acao && c.w === c.h).length).toBe(16);
    m.killHead = false;
    m.killScale = 1.4;
    const big = draw(m).filter((c) => c.color === COLORS.perigo && c.w === c.h);
    const reach = (cs: DrawnCommand[]): number => Math.max(...cs.map((c) => Math.abs(c.x + c.w / 2 - 640)));
    expect(reach(big)).toBeGreaterThan(reach(red) * 1.3);
    expect(draw(m).some((c) => c.color === withAlpha(COLORS.bunker, 0.6) && c.w > c.h - 0.5)).toBe(true);
    m.killMarker = 0;
    expect(draw(m).filter((c) => c.color === COLORS.perigo).length).toBe(0);
  });

  it('hitmarker: o "pop" abre 1 passo; o acerto sem dano é cinza', () => {
    const m = quiet();
    m.hitMarker = 1;
    const reach = (cs: DrawnCommand[], color: number): number =>
      Math.max(...cs.filter((c) => c.color === color && c.w === c.h).map((c) => Math.abs(c.x + c.w / 2 - 640)));
    const closed = reach(draw(m), COLORS.texto);
    m.hitPop = 1;
    expect(reach(draw(m), COLORS.texto)).toBeGreaterThan(closed);
    m.hitZero = true;
    expect(draw(m).filter((c) => c.color === COLORS.textoBaixo && c.w === c.h).length).toBe(12);
  });

  it('o nome da vítima e a sequência embaixo da retícula, e o "R recarrega" embaixo deles', () => {
    const m = quiet();
    m.killName = 'NORMAL BOB';
    m.killNameAlpha = 1;
    m.streakText = 'VINGANÇA';
    m.streakAlpha = 1;
    m.clip = 0;
    m.reloadKey = 'R';
    m.reloadText = 'recarrega';
    const list = createDrawList(4096);
    drawHud(list, fonts, m, view);
    const text = syntheticGlyphText(list);
    expect(text).toContain('NORMALBOB');
    expect(text).toContain('VINGANÇA');
    expect(text).toContain('Rrecarrega');
    expect(text.indexOf('NORMALBOB')).toBeLessThan(text.indexOf('VINGANÇA'));
    const cs = drawnCommands(list).filter((c) => c.op === DRAW_OP.glyph);
    const nameY = Math.min(...cs.filter((c) => c.color === COLORS.texto && c.y > 360).map((c) => c.y));
    expect(nameY).toBeGreaterThan(360);
  });

  it('pente âmbar a ≤ 25%, vermelho vazio; a barra da recarga embaixo da retícula', () => {
    const m = quiet();
    m.clip = 7;
    const ammo = (cs: DrawnCommand[], color: number): number =>
      cs.filter((c) => c.op === DRAW_OP.glyph && c.color === color && c.y > 600).length;
    expect(ammo(draw(m), COLORS.acao)).toBeGreaterThan(0);
    m.clip = 8;
    expect(ammo(draw(m), COLORS.acao)).toBe(0);
    m.reload = 0.5;
    const bar = draw(m).filter((c) => c.op === DRAW_OP.rect && c.color === COLORS.acao && c.y > 360 && c.y < 420);
    expect(bar.length).toBe(1);
  });

  it('vida: o rastro claro do dano e a vinheta blocada (12 retângulos) só com a vida baixa', () => {
    const m = quiet();
    m.health = 20;
    m.healthTrail = 70;
    m.lowHealth = 1;
    const cs = draw(m);
    expect(cs.filter((c) => c.color === withAlpha(COLORS.texto, 0.75)).length).toBe(1);
    const vignette = cs.filter(
      (c) =>
        c.op === DRAW_OP.rect && (c.color & 0xffffff00) === (COLORS.perigo & 0xffffff00) && (c.w >= 1200 || c.h >= 600),
    );
    expect(vignette.length).toBe(12);
    m.lowHealth = 0;
    m.healthTrail = 20;
    const calm = draw(m);
    expect(calm.filter((c) => c.color === withAlpha(COLORS.texto, 0.75)).length).toBe(0);
  });

  it('os "+N" ao lado da plaquinha do alto, em âmbar, e o "$" do BoboStrike', () => {
    const m = quiet();
    m.points = 800;
    m.pointsLabel = '$';
    m.gainCount = 1;
    m.gainValues!.set([300]);
    m.gainAlphas!.set([1]);
    m.gainRise!.set([0]);
    const list = createDrawList(4096);
    drawHud(list, fonts, m, view);
    expect(syntheticGlyphText(list)).toContain('+$300');
  });

  it('fim da partida: a faixa no meio e sem retícula, munição e dica', () => {
    const m = quiet();
    m.endBanner = 'VITÓRIA!';
    m.endBannerColor = COLORS.acao;
    m.endBannerIn = 1;
    m.tipAlpha = 1;
    m.tipKey = 'R';
    m.tipText = 'recarrega';
    const list = createDrawList(4096);
    drawHud(list, fonts, m, view);
    const text = syntheticGlyphText(list);
    expect(text).toContain('VITÓRIA!');
    expect(text).not.toContain('30/90');
    expect(text).not.toContain('recarrega');
    expect(drawnCommands(list).filter((c) => c.color === withAlpha(COLORS.texto, 0.92)).length).toBe(0);
    // A entrada: no começo, apagada.
    m.endBannerIn = 0;
    const start = createDrawList(4096);
    drawHud(start, fonts, m, view);
    expect(drawnCommands(start).some((c) => c.op === DRAW_OP.glyph && (c.color & 0xff) === 0)).toBe(true);
  });

  it('morto: sem a plaquinha da vida, a barra que esvazia embaixo da contagem e "· NA CABEÇA" na faixa', () => {
    const m = quiet();
    m.dead = true;
    m.respawnS = 2.2;
    m.respawnFrac = 0.5;
    m.deathLabel = 'ABATIDO POR';
    m.deathName = 'Normal Bob';
    m.deathWeapon = 'Peekaboo';
    m.deathHp = 80;
    m.deathHead = true;
    const list = createDrawList(4096);
    drawHud(list, fonts, m, view);
    const text = syntheticGlyphText(list);
    expect(text).not.toContain('VIDA');
    expect(text).toContain('NormalBob·Peekaboo·80HP·NACABEÇA');
    const bars = drawnCommands(list).filter((c) => c.op === DRAW_OP.rect && c.color === COLORS.acao && c.h <= 4);
    expect(bars.length).toBe(1);
  });

  it('aliado caído: o chevron em perigo, piscando (apagado no meio do pisca)', () => {
    const m = quiet();
    m.markerCount = 1;
    m.markers[0] = 900;
    m.markers[1] = 300;
    m.markerColor = TEAM_COLORS[0]!;
    m.markerDowned![0] = 1;
    m.markerBlink = 1;
    expect(draw(m).filter((c) => c.color === COLORS.perigo).length).toBe(4);
    m.markerBlink = 0;
    expect(draw(m).filter((c) => c.color === withAlpha(COLORS.perigo, 0.35)).length).toBe(4);
  });
});

describe('M12 (fase 2): o placar do alto', () => {
  it('o traço do seu time, a batida do placar que mudou, o relógio âmbar a 60 s e a plaquinha em `bounds`', () => {
    const lay = layoutHudScreen(1, 1280, 720, { minTextPx: MIN_TEXT.tv });
    const m = createHudSharedModel();
    m.teamCount = 2;
    m.teamScores[0] = 12;
    m.teamScores[1] = 9;
    m.timeLeftS = 45;
    m.ownTeam = 1;
    const bounds = new Float32Array(4);
    const list = createDrawList();
    drawHudShared(list, fonts, m, lay.shared, bounds);
    const cs = drawnCommands(list);
    const teamRects = (list: DrawList): number =>
      drawnCommands(list).filter((c) => c.op === DRAW_OP.rect && c.color === TEAM_COLORS[1]).length;
    expect(cs.filter((c) => c.op === DRAW_OP.glyph && c.color === COLORS.acao).length).toBe(4);
    expect(bounds[2]).toBeGreaterThan(0);
    for (const c of cs) {
      expect(c.x).toBeGreaterThanOrEqual(bounds[0]! - 0.5);
      expect(c.x + c.w).toBeLessThanOrEqual(bounds[0]! + bounds[2]! + 0.5);
    }
    // A batida: o número do time 0 maior.
    const height = (beat: number): number => {
      m.teamBeat![0] = beat;
      const l = createDrawList();
      drawHudShared(l, fonts, m, lay.shared);
      return Math.max(
        ...drawnCommands(l)
          .filter((c) => c.op === DRAW_OP.glyph && c.color === TEAM_COLORS[0])
          .map((c) => c.h),
      );
    };
    expect(height(1)).toBeGreaterThan(height(0));
    // Versus do sofá (sem time): sem o traço (um retângulo a menos na cor do time 1: só o ícone).
    m.ownTeam = -1;
    const l = createDrawList();
    drawHudShared(l, fonts, m, lay.shared);
    expect(teamRects(list) - teamRects(l)).toBe(1);
  });

  it('o rótulo do relógio ("FECHA EM") no Royale, dentro da tela', () => {
    const lay = layoutHudScreen(1, 640, 360, { minTextPx: MIN_TEXT.switchSplit });
    const m = createHudSharedModel();
    m.timeLeftS = 90;
    m.clockLabel = 'FECHA EM';
    const list = createDrawList();
    drawHudShared(list, fonts, m, lay.shared);
    expect(syntheticGlyphText(list)).toContain('FECHAEM1:30');
    for (const c of drawnCommands(list)) expect(c.x + c.w).toBeLessThanOrEqual(640);
  });
});

describe('M12 (fase 2): kill feed, placar do Tab, contagem e avisos', () => {
  it('kill feed: no máximo N linhas, encolhe até caber (nunca abaixo do piso), a sua linha em âmbar, à esquerda no 3–4P', () => {
    const m = createKillFeedModel();
    for (let i = 0; i < 4; i++) {
      pushKillFeed(
        m,
        'Jorge the Immortal',
        TEAM_COLORS[1]!,
        'Lawnmower',
        'Sweaty Bob',
        TEAM_COLORS[0]!,
        false,
        i === 3,
      );
    }
    const list = createDrawList();
    drawKillFeed(list, fonts, m, 1240, 24, 2, MIN_TEXT.switchSplit, 2, 460, true);
    const cs = drawnCommands(list);
    const rows = cs.filter((c) => c.op === DRAW_OP.rect && c.color === COLORS.hudFundo);
    expect(rows.length).toBe(2);
    for (const r of rows) {
      expect(r.x + r.w).toBeLessThanOrEqual(1240.5);
      expect(r.w).toBeLessThanOrEqual(460.5);
    }
    const hs = cs.filter((c) => c.op === DRAW_OP.glyph).map((c) => c.h);
    for (const h of hs) expect(h).toBeGreaterThanOrEqual(MIN_TEXT.switchSplit - 1e-6);
    // Encolheu (o tamanho cheio é 11 × 2 = 22).
    expect(Math.max(...hs)).toBeLessThan(22);
    expect(cs.some((c) => c.color === withAlpha(COLORS.acao, 0.18))).toBe(true);
    expect(cs.some((c) => c.op === DRAW_OP.glyph && c.color === COLORS.acao)).toBe(true);
    const left = createDrawList();
    drawKillFeed(left, fonts, m, 700, 340, 1, MIN_TEXT.switchSplit, 2, 560, true, 0);
    const lrows = drawnCommands(left).filter((c) => c.op === DRAW_OP.rect && c.color === COLORS.hudFundo);
    expect(lrows.length).toBe(2);
    for (const r of lrows) expect(r.x).toBe(700);
    expect(killFeedHeight(fonts, 2, 1, MIN_TEXT.switchSplit)).toBeGreaterThan(0);
  });

  it('kill feed: a linha nova entra de 8 px ao lado (instantânea com Reduzir efeitos)', () => {
    const m = createKillFeedModel();
    pushKillFeed(m, 'Normal Bob', TEAM_COLORS[1]!, 'Rattler', 'P1', TEAM_COLORS[0]!, false);
    const at = (reduce: boolean): DrawnCommand => {
      const list = createDrawList();
      drawKillFeed(list, fonts, m, 1240, 24, 2, MIN_TEXT.tv, 5, Number.POSITIVE_INFINITY, reduce);
      return drawnCommands(list)[0]!;
    };
    m.age[0] = 0.05;
    const moving = at(false);
    const still = at(true);
    expect(moving.x).toBeGreaterThan(still.x);
    expect(moving.color & 0xff).toBeLessThan(still.color & 0xff);
  });

  it('placar do Tab com 24 linhas (o Royale): cabe na tela, abaixo do relógio, com a sua linha', () => {
    const m = createScoreboardModel();
    m.title = 'Bobo Royale';
    m.rowCount = 24;
    for (let r = 0; r < 24; r++) {
      m.name[r] = r === 20 ? 'P1' : 'Normal Bob';
      m.local[r] = r === 20 ? 1 : 0;
      m.dead[r] = r % 3 === 0 ? 1 : 0;
    }
    for (const [w, h, min] of [
      [1280, 720, MIN_TEXT.tv],
      [640, 360, MIN_TEXT.switchSplit],
    ] as const) {
      const list = createDrawList(4096);
      drawScoreboard(list, fonts, m, w, h, min);
      const glyphs = drawnCommands(list).filter((c) => c.op === DRAW_OP.glyph);
      for (const g of glyphs) expect(g.y + g.h, `${w}`).toBeLessThanOrEqual(h + 0.5);
      expect(syntheticGlyphText(list), `${w}`).toContain('P1');
      // O título começa embaixo da plaquinha do relógio (não a cobre).
      expect(Math.min(...glyphs.map((g) => g.y)), `${w}`).toBeGreaterThan(h * 0.08);
    }
  });

  it('contagem: o número entra 1,2 → 1 (parado com Reduzir efeitos); "VALENDO!" e o aviso central dentro da tela', () => {
    const big = (seconds: number, reduce: boolean): number => {
      const list = createDrawList();
      drawMatchCountdown(list, fonts, seconds, '', 1280, 720, MIN_TEXT.tv, '', reduce);
      return Math.max(
        ...drawnCommands(list)
          .filter((c) => c.op === DRAW_OP.glyph)
          .map((c) => c.h),
      );
    };
    expect(big(2.99, false)).toBeGreaterThan(big(2.5, false));
    expect(big(2.99, true)).toBeCloseTo(big(2.5, false), 3);
    const go = createDrawList();
    drawMatchGo(go, fonts, 'VALENDO!', 0.3, 640, 360, MIN_TEXT.switchSplit);
    expect(syntheticGlyphText(go)).toBe('VALENDO!');
    expect(drawnCommands(go).some((c) => c.op === DRAW_OP.glyph && c.color === COLORS.acao)).toBe(true);
    const gone = createDrawList();
    drawMatchGo(gone, fonts, 'VALENDO!', 0.7, 640, 360, MIN_TEXT.switchSplit);
    expect(gone.count).toBe(0);
    for (const [w, h, small] of [
      [1280, 720, false],
      [640, 360, false],
      [1280, 720, true],
    ] as const) {
      const list = createDrawList();
      const text = 'JORGE THE IMMORTAL DA SILVA VIROU O JUGG';
      const hh = drawCenterNotice(
        list,
        fonts,
        text,
        0.5,
        w / 2,
        h * 0.32,
        w - 32,
        w / 640,
        MIN_TEXT.switchSplit,
        small,
      );
      expect(hh).toBeGreaterThan(0);
      for (const c of drawnCommands(list)) {
        expect(c.x, `${w} ${small}`).toBeGreaterThanOrEqual(-0.5);
        expect(c.x + c.w, `${w} ${small}`).toBeLessThanOrEqual(w + 0.5);
      }
      for (const g of drawnCommands(list).filter((c) => c.op === DRAW_OP.glyph)) {
        expect(g.h).toBeGreaterThanOrEqual(MIN_TEXT.switchSplit - 1e-6);
      }
    }
  });
});

describe('M12 (fase 2, revisão): o lugar do kill feed e do aviso, o véu da morte e o placar do sofá', () => {
  /** As plaquinhas da HUD de todas as vistas (um modelo comum) e o placar do alto, com a plaquinha em `bounds`. */
  function screen(count: number, w: number, h: number, teams: number, min: number) {
    const lay = layoutHudScreen(count, w, h, { minTextPx: min });
    const hudList = createDrawList(8192);
    resetDrawList(hudList, w, h);
    lay.views.forEach((view, i) => {
      const m = createHudModel();
      m.health = 100;
      m.clip = 30;
      m.reserve = 90;
      m.kills = 12;
      m.deaths = 3;
      m.playerSlot = i;
      m.grenades = 2;
      m.weaponName = 'Rattler';
      m.weaponCategory = 'Fuzil';
      drawHud(hudList, fonts, m, view);
    });
    const shared = createHudSharedModel();
    shared.teamCount = teams;
    for (let i = 0; i < teams; i++) shared.teamScores[i] = 100 + i;
    shared.timeLeftS = 300;
    shared.suddenDeath = true;
    const bounds = new Float32Array(5);
    const sharedList = createDrawList(2048);
    resetDrawList(sharedList, w, h);
    drawHudShared(sharedList, fonts, shared, lay.shared, bounds);
    return { lay, hudList, sharedList, bounds };
  }
  function feedModel() {
    const feed = createKillFeedModel();
    for (let k = 0; k < 4; k++) {
      pushKillFeed(
        feed,
        'Jorge the Immortal',
        TEAM_COLORS[1]!,
        'Lawnmower',
        'Tryhard Bob',
        TEAM_COLORS[0]!,
        true,
        k === 0,
      );
    }
    for (let k = 0; k < feed.count; k++) feed.age[k] = 1;
    return feed;
  }

  it('o feed e o aviso não cobrem as plaquinhas das vistas nem o placar (1P com 2 e 4 times, 2P, 3P e 4P)', () => {
    for (const [w, h] of [
      [640, 360],
      [1280, 720],
      [1024, 768],
    ] as const) {
      for (const [count, teams] of [
        [1, 2],
        [1, 4],
        [2, 2],
        [3, 2],
        [4, 2],
      ] as const) {
        // A tela dividida a 640×360 (vistas de 320×180 com o piso de 16 px) não tem onde caber (o 4P também não).
        if (count >= 2 && w < 1024) continue;
        const min = count >= 3 ? MIN_TEXT.switchSplit : w >= 1280 ? MIN_TEXT.tv : MIN_TEXT.switchSplit;
        const { lay, hudList, sharedList, bounds } = screen(count, w, h, teams, min);
        const feed = feedModel();
        const p = placeOverlay(createOverlayPlace(), fonts, feed, lay, bounds, 0, w, h, min);
        const fl = createDrawList(2048);
        resetDrawList(fl, w, h);
        drawKillFeed(fl, fonts, feed, p.feedX, p.feedTop, p.feedScale, min, p.feedLines, p.feedMaxW, true, p.feedAlign);
        const nl = createDrawList(2048);
        resetDrawList(nl, w, h);
        drawCenterNotice(
          nl,
          fonts,
          'MORTE SÚBITA',
          0.5,
          p.noticeX,
          p.noticeY,
          p.noticeMaxW,
          p.noticeScale,
          min,
          p.noticeSmall,
          true,
          p.noticeVAlign,
          p.noticeHAlign,
          p.noticeMinX,
        );
        const tag = `${w}×${h} ${count}P ${teams} times`;
        // O placar inteiro (menos o fundo do quadrante livre do 3P).
        const blockers = [...plates(hudList), ...drawnCommands(sharedList).filter((c) => c.color !== COLORS.bunker)];
        for (const list of [fl, nl]) {
          const own = drawnCommands(list).filter((c) => c.op === DRAW_OP.rect && c.color === COLORS.hudFundo);
          expect(own.length, tag).toBeGreaterThan(0);
          for (const c of own) {
            expect(c.x >= -0.5 && c.x + c.w <= w + 0.5 && c.y >= -0.5 && c.y + c.h <= h + 0.5, `${tag}: fora`).toBe(
              true,
            );
            for (const b of blockers) expect(overlaps(c, b), `${tag}: ${c.x},${c.y} sobre ${b.x},${b.y}`).toBe(false);
          }
        }
        // No 3P, o feed fica dentro do quadrante livre.
        if (count === 3) {
          const a = lay.shared;
          for (const c of drawnCommands(fl))
            expect(inside(c, { x: a.x, y: a.y, width: a.width, height: a.height }), tag).toBe(true);
        }
      }
    }
  });

  it('o véu da morte só com `deathVeil` (a câmera de morte e o seletor; o espectador fica limpo)', () => {
    const view = layoutHudScreen(1, 1280, 720, { minTextPx: MIN_TEXT.tv }).views[0]!;
    const veilOf = (veil: number): number => {
      const m = createHudModel();
      m.dead = true;
      m.respawnS = 2;
      m.deathVeil = veil;
      const list = createDrawList();
      drawHud(list, fonts, m, view);
      return drawnCommands(list).filter((c) => c.w >= 1280 && c.h >= 720).length;
    };
    expect(veilOf(1)).toBe(1);
    expect(veilOf(0)).toBe(0);
  });

  it('placar do Tab limitado: todos os jogadores locais ficam (o sofá), no lugar das últimas linhas', () => {
    const m = createScoreboardModel();
    m.title = 'Bobo Royale';
    m.rowCount = 24;
    for (let r = 0; r < 24; r++) {
      m.name[r] = r === 20 ? 'P1' : r === 22 ? 'P2' : 'Normal Bob';
      m.local[r] = r === 20 || r === 22 ? 1 : 0;
    }
    const list = createDrawList(4096);
    drawScoreboard(list, fonts, m, 1280, 720, MIN_TEXT.tv);
    const text = syntheticGlyphText(list);
    expect(text).toContain('P1');
    expect(text).toContain('P2');
    for (const g of drawnCommands(list)) expect(g.y + g.h).toBeLessThanOrEqual(720.5);
  });
});
