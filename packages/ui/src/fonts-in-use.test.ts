import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDrawList, DRAW_OP, resetDrawList, type DrawList } from './draw-list.ts';
import { moveFocus } from './focus.ts';
import { COMPOSED_CHARS, parseFontPack, type MsdfFont } from './font.ts';
import { layoutTree, type LayoutResult } from './layout.ts';
import { drawFontSpecimen } from './screens/font-specimen.ts';
import { createLoadingModel, drawLoadingScreen } from './screens/loading.ts';
import { settingsScreen } from './screens/settings.ts';
import { titleScreen, type TitleExtraItem } from './screens/title.ts';
import { STRINGS_PT_BR } from './strings.pt-BR.ts';
import { drawnCommands } from './test-fixtures.ts';
import { BUTTON, MIN_TEXT, MIN_TOUCH_TARGET } from './tokens.ts';
import type { Rect, UiNode } from './tree.ts';

// Testes com o atlas REAL das fontes em uso (decisão #54), lido de assets-src pelo caminho lógico do runtime-assets:
// cobertura de glifos da tabela pt-BR e estouro de texto nas telas de layout. Rode `npm run fontbake` se o atlas mudar.

const ROOT = resolve(import.meta.dirname, '..', '..', '..');
const RUNTIME = JSON.parse(readFileSync(join(ROOT, 'assets-src', 'runtime-assets.json'), 'utf8')) as {
  files: Record<string, string>;
};
const RAW = JSON.parse(
  readFileSync(join(ROOT, 'assets-src', RUNTIME.files['fonts/ui-fonts.json'] as string), 'utf8'),
) as { fonts: Record<string, { missing: number[] }> };
const pack = parseFontPack(RAW);
const fonts = pack.fonts;

function glyphCodes(font: MsdfFont): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i < font.glyphData.length; i += 8) out.add(font.glyphData[i] as number);
  return out;
}

describe('atlas em uso: fontes, licença e métricas', () => {
  it('nomes derivados sem o RFN, licença OFL e origem com versão', () => {
    expect([fonts.display.name, fonts.hud.name]).toEqual(['BoboForces Display', 'BoboForces HUD']);
    for (const f of [fonts.display, fonts.hud]) {
      expect(f.name).not.toMatch(/russo|saira/i);
      expect(f.license).toBe('OFL-1.1');
      expect(f.source).toContain(f.version);
    }
    expect(fonts.display.source).toMatch(/^Russo One /);
    expect(fonts.hud.source).toMatch(/^Saira Condensed SemiBold /);
    expect(RAW.fonts['display']?.missing).toEqual([]);
    expect(RAW.fonts['hud']?.missing).toEqual([]);
  });

  it('altura de maiúscula do OS/2 e linha normalizada pela descida real (caixa do hud sem os 0,439 em do hhea)', () => {
    expect(fonts.display.capHeight / fonts.display.size).toBeCloseTo(0.7, 3);
    expect(fonts.hud.capHeight / fonts.hud.size).toBeCloseTo(0.688, 3);
    for (const f of [fonts.display, fonts.hud]) {
      const descent = (f.lineHeight - f.base) / f.size;
      expect(descent).toBeGreaterThan(0.1);
      expect(descent).toBeLessThan(0.3);
    }
  });

  it('cobertura: todo caractere da tabela na hud e a caixa alta da tabela inteira na display (nenhum "?")', () => {
    const hud = glyphCodes(fonts.hud);
    const display = glyphCodes(fonts.display);
    const outHud = new Set<string>();
    const outDisplay = new Set<string>();
    for (const raw of Object.values(STRINGS_PT_BR)) {
      // O ™ não está no atlas: o drawText o compõe com T e M, que precisam estar nas duas fontes.
      const text = raw.replace(/./gu, (ch) => COMPOSED_CHARS[ch] ?? ch);
      for (const ch of text) if (!hud.has(ch.charCodeAt(0))) outHud.add(ch);
      for (const ch of text.toUpperCase()) if (!display.has(ch.charCodeAt(0))) outDisplay.add(ch);
    }
    expect([...outHud]).toEqual([]);
    expect([...outDisplay]).toEqual([]);
    // A display é só caixa alta: nenhuma minúscula no atlas.
    for (const code of display) expect(String.fromCharCode(code).toUpperCase()).toBe(String.fromCharCode(code));
  });
});

/** Uma tela de layout num alvo: tamanho, piso de texto e alvo mínimo (toque). */
interface Target {
  readonly name: string;
  readonly w: number;
  readonly h: number;
  readonly minTextPx: number;
  readonly minTarget: number;
}

/** Como o `game.ts` monta as opções da UI: com toque, alvo mínimo de 44 px CSS (× DPR); sem toque, nenhum. */
const web = (name: string, w: number, h: number, pixelRatio = 1, touch = false): Target => ({
  name,
  w,
  h,
  minTextPx: MIN_TEXT.phone * pixelRatio,
  minTarget: touch ? MIN_TOUCH_TARGET * Math.max(1, pixelRatio) : 0,
});

/**
 * Os 6 alvos do desenho: 16:9 em 3 escalas, o celular 1334×750 com DPR 2 (toque), o 640×360 com toque e DPR 1 (o
 * tamanho em px CSS do celular deitado) e um 4:3.
 */
const WEB_TARGETS: readonly Target[] = [
  web('web 1280×720', 1280, 720),
  web('web 640×360', 640, 360),
  web('celular 1334×750 (DPR 2)', 1334, 750, 2, true),
  web('toque 640×360 (DPR 1)', 640, 360, 1, true),
  web('web 1920×1080', 1920, 1080),
  web('web 4:3 1024×768', 1024, 768),
];

/** Switch: piso da TV/dock (22) em portátil e dock; o 4:3 entra como prova da grade em outra proporção. */
const SWITCH_TARGETS: readonly Target[] = [
  { name: 'Switch 1280×720', w: 1280, h: 720, minTextPx: MIN_TEXT.tv, minTarget: 0 },
  { name: 'Switch dock 1920×1080', w: 1920, h: 1080, minTextPx: MIN_TEXT.tv, minTarget: 0 },
  { name: 'Switch 4:3 960×720', w: 960, h: 720, minTextPx: MIN_TEXT.tv, minTarget: 0 },
  { name: '1334×750 (piso da TV)', w: 1334, h: 750, minTextPx: MIN_TEXT.tv, minTarget: 0 },
  { name: '640×360 (piso do celular)', w: 640, h: 360, minTextPx: MIN_TEXT.phone, minTarget: 0 },
];

const VITRINE: readonly TitleExtraItem[] = [{ id: 'vitrine', labelKey: 'title.vitrine' }];
const SWITCH_ITEMS: readonly TitleExtraItem[] = [
  { id: 'bench-dock', labelKey: 'test.item.benchDock' },
  { id: 'bench-solo', labelKey: 'test.item.benchSolo' },
  { id: 'bench-zombies', labelKey: 'test.item.benchZombies' },
  { id: 'bench-bots48', labelKey: 'test.item.benchStress' },
  { id: 'bench-planb', labelKey: 'test.item.benchPlanB' },
  { id: 'bench-gpu', labelKey: 'test.item.benchGpu' },
  { id: 'controllers', labelKey: 'test.item.controllers' },
  { id: 'keyboard', labelKey: 'test.item.keyboard' },
  { id: 'audio', labelKey: 'test.item.audio' },
];

function layoutFor(root: UiNode, t: Target): LayoutResult {
  return layoutTree(root, { x: 0, y: 0, w: t.w, h: t.h }, 1, {
    fonts,
    minTextPx: t.minTextPx,
    minTarget: t.minTarget,
  });
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Ids focáveis que o D-pad alcança a partir de `start`. */
function reachable(layout: LayoutResult, start: string): Set<string> {
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length > 0) {
    const id = queue.shift() as string;
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

/**
 * Sem estouro: texto de botão cabe na largura menos o respiro (2·padX·escala) e dentro da altura; texto solto cabe na
 * área útil; botão com pelo menos o alvo mínimo. Devolve as larguras medidas (para a mensagem de erro ser útil).
 */
function expectNoOverflow(layout: LayoutResult, t: Target): void {
  const c = layout.content;
  for (const node of layout.order) {
    const r = layout.rects.get(node) as Rect;
    const text = layout.texts.get(node);
    if (node.kind === 'button' && text) {
      const room = r.w - 2 * BUTTON.padX * layout.scale;
      expect(
        text.width,
        `${t.name}: "${text.text}" ${text.width.toFixed(1)} px em ${room.toFixed(1)}`,
      ).toBeLessThanOrEqual(room);
      expect(text.height).toBeLessThanOrEqual(r.h);
      expect(Math.min(r.w, r.h), `${t.name}: ${node.id ?? ''} ${r.w}×${r.h}`).toBeGreaterThanOrEqual(t.minTarget);
      expect(text.px).toBeGreaterThanOrEqual(t.minTextPx);
    }
    if (node.kind === 'text' && text) {
      expect(r.x, `${t.name}: ${node.id ?? text.text}`).toBeGreaterThanOrEqual(c.x - 0.5);
      expect(r.x + text.width, `${t.name}: "${text.text}"`).toBeLessThanOrEqual(c.x + c.w + 0.5);
      expect(r.y + r.h).toBeLessThanOrEqual(c.y + c.h + 0.5);
      expect(r.y).toBeGreaterThanOrEqual(c.y - 0.5);
      expect(text.px).toBeGreaterThanOrEqual(t.minTextPx);
    }
    if (node.kind === 'button') {
      // 1 px de folga: o layout arredonda cada retângulo para o pixel (330 × 0,75 = 247,5 → 248).
      const where = `${t.name}: ${node.id ?? ''}`;
      expect(r.x, where).toBeGreaterThanOrEqual(c.x - 1);
      expect(r.x + r.w, where).toBeLessThanOrEqual(c.x + c.w + 1);
      expect(r.y, where).toBeGreaterThanOrEqual(c.y - 1);
      expect(r.y + r.h, where).toBeLessThanOrEqual(c.y + c.h + 1);
    }
  }
}

/** Itens de teste não encostam no logotipo, nos botões do menu nem no rodapé. */
function expectTestsClear(layout: LayoutResult, t: Target): void {
  const rect = (id: string) => layout.rects.get(layout.byId.get(id) as UiNode) as Rect;
  const tests = rect('tests');
  const logo = rect('logo');
  const logoText = layout.texts.get(layout.byId.get('logo') as UiNode);
  // O retângulo do texto do logo vai até a largura medida (o nó não tem largura fixa).
  const logoInk = { ...logo, w: Math.ceil(logoText?.width ?? logo.w) };
  for (const [id, r] of [
    ['logo', logoInk],
    ['logoBar', rect('logoBar')],
    ['buttons', rect('buttons')],
    ['credit', rect('credit')],
    ['version', rect('version')],
  ] as const) {
    expect(overlaps(tests, r), `${t.name}: itens de teste × ${id}`).toBe(false);
  }
}

describe('estouro de texto com o atlas real', () => {
  it('título da web (Cena-vitrine): 1280×720, 640×360 (com e sem toque), celular, 1920×1080 e 4:3, foco por D-pad', () => {
    for (const t of WEB_TARGETS) {
      const layout = layoutFor(
        titleScreen.build({ version: '0.1.0', codename: 'Primeiro Bloco', extraItems: VITRINE }),
        t,
      );
      expectNoOverflow(layout, t);
      expectTestsClear(layout, t);
      expect(reachable(layout, 'play').size, t.name).toBe(layout.focusable.length);
    }
  });

  it('título do Switch (9 itens + Sair): grade sem sobreposição e todos os itens alcançáveis pelo D-pad', () => {
    for (const t of SWITCH_TARGETS) {
      const layout = layoutFor(
        titleScreen.build({ version: '0.1.0', codename: 'Primeiro Bloco', canExit: true, extraItems: SWITCH_ITEMS }),
        t,
      );
      expectNoOverflow(layout, t);
      expectTestsClear(layout, t);
      const ids = layout.focusable.map((b) => b.id as string);
      expect(ids.length).toBe(13);
      expect([...reachable(layout, 'play')].sort(), t.name).toEqual([...ids].sort());
      for (const id of ids) expect(reachable(layout, id).has('play'), `${t.name}: ${id} → JOGAR`).toBe(true);
    }
  });

  it('ajustes: cabe nos 6 alvos da web e no Switch', () => {
    for (const t of [...WEB_TARGETS, ...SWITCH_TARGETS.slice(0, 2)]) {
      expectNoOverflow(layoutFor(settingsScreen.build(null), t), t);
    }
  });
});

function list(w: number, h: number): DrawList {
  const l = createDrawList(8192);
  resetDrawList(l, w, h);
  return l;
}

/** Comandos dentro da superfície (o que está num recorte vale pelo recorte). */
function expectInside(l: DrawList, w: number, h: number, name: string): void {
  let depth = 0;
  for (const c of drawnCommands(l)) {
    if (c.op === DRAW_OP.clipPop) {
      depth--;
      continue;
    }
    if (depth > 0) continue;
    if (c.op === DRAW_OP.clipPush) depth++;
    expect(c.x, name).toBeGreaterThanOrEqual(-0.5);
    expect(c.y, name).toBeGreaterThanOrEqual(-0.5);
    expect(c.x + c.w, name).toBeLessThanOrEqual(w + 0.5);
    expect(c.y + c.h, name).toBeLessThanOrEqual(h + 0.5);
  }
}

describe('telas desenhadas direto com o atlas real', () => {
  it('loading: o nome do mapa cabe (encolhe se for longo) nos 6 alvos', () => {
    const m = createLoadingModel();
    for (const name of ['Construto', 'Construto do Bobo: Edição Estendida do Fim de Semana']) {
      m.mapName = name;
      for (const t of WEB_TARGETS) {
        const l = list(t.w, t.h);
        drawLoadingScreen(l, fonts, m, t.w, t.h, { minTextPx: t.minTextPx });
        expectInside(l, t.w, t.h, `${t.name}: ${name}`);
      }
    }
  });

  it('folha das fontes cabe em 1280×720, 640×360 e nos outros alvos', () => {
    for (const t of WEB_TARGETS) {
      const l = list(t.w, t.h);
      drawFontSpecimen(l, fonts, t.w, t.h);
      expectInside(l, t.w, t.h, t.name);
      expect(l.overflow).toBe(0);
    }
  });
});
