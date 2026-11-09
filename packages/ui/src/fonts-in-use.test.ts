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
import type { TabbedRow } from './screens/tabbed.ts';
import { titleScreen, type TitleExtraItem } from './screens/title.ts';
import { STRINGS_PT_BR, type StringKey } from './strings.pt-BR.ts';
import { t } from './text.ts';
import { drawnCommands } from './test-fixtures.ts';
import { mainMenuScreen } from './screens/main-menu.ts';
import { modesScreen } from './screens/modes.ts';
import { NEWS_ITEMS, newsScreen } from './screens/news.ts';
import { rotateScreen } from './screens/rotate.ts';
import { workshopScreen } from './screens/workshop.ts';
import { quickMatchScreen } from './screens/quick-match.ts';
import { surpriseScreen } from './screens/surprise.ts';
import { customMatchScreen } from './screens/custom-match.ts';
import { BUTTON, BUTTON_COMPACT, MIN_TEXT, MIN_TOUCH_TARGET, OPTION } from './tokens.ts';
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

/**
 * Alcance pelo D-pad com rolagem (M2, fase 4e): como o menu, refaz o layout a cada foco (a janela da lista anda junto) e
 * anda a partir dali.
 */
function reachableScrolling(tree: UiNode, t: Target, start: string): Set<string> {
  const scrollState = new Map<string, number>();
  const at = (id: string): LayoutResult =>
    layoutTree(tree, { x: 0, y: 0, w: t.w, h: t.h }, 1, {
      fonts,
      minTextPx: t.minTextPx,
      minTarget: t.minTarget,
      focusedId: id,
      scrollState,
    });
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    const l = at(id);
    for (const dir of ['up', 'down', 'left', 'right'] as const) {
      const next = moveFocus(l, id, dir);
      if (next !== null && !seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

/** M2 (fase 4f): as 6 abas dos Ajustes com os rótulos e os valores mais longos. */
const SETTINGS_TABS_FIXTURE = [
  'settings.tab.controls',
  'settings.tab.buttons',
  'settings.tab.video',
  'settings.tab.access',
  'settings.tab.data',
  'settings.tab.about',
] as const;
function settingsFixtures(): UiNode[] {
  const option = (id: string, labelKey: StringKey, value: string) => ({ kind: 'option' as const, id, labelKey, value });
  const rows = [
    [
      option('device', 'settings.row.device', 'Teclado e mouse'),
      option('sens', 'settings.row.sens', '×2,5'),
      option('sensY', 'settings.row.sensY', '×1,25'),
      option('ads', 'settings.row.ads', '×0,75'),
      option('invertY', 'settings.row.invertY', 'Desligado'),
      option('assist', 'settings.row.assist', 'Desligada'),
      option('toggleAds', 'settings.row.toggleAds', 'Alternar'),
      option('toggleCrouch', 'settings.row.toggleCrouch', 'Alternar'),
      option('toggleSprint', 'settings.row.toggleSprint', 'Alternar'),
      option('deadIn', 'settings.row.deadIn', '30%'),
      option('deadOut', 'settings.row.deadOut', '100%'),
    ],
    bindingFixtureRows(),
    [option('fov', 'settings.row.fov', 'Padrão'), option('uiScale', 'settings.row.uiScale', '×1,3')],
    [option('shake', 'settings.row.reduceShake', 'Desligado'), option('tips', 'settings.row.tips', 'Desligado')],
    [
      { kind: 'text' as const, id: 'w', text: t('settings.data.warning'), dim: true },
      { kind: 'text' as const, id: 'w2', text: t('settings.data.warning2'), dim: true },
      { kind: 'action' as const, id: 'export', label: { key: 'settings.data.export' as const } },
      { kind: 'action' as const, id: 'import', label: { key: 'settings.data.import' as const } },
      { kind: 'text' as const, id: 'found', text: t('settings.data.found', { presets: 200, bots: 500 }) },
      { kind: 'action' as const, id: 'merge', label: { key: 'settings.data.merge' as const } },
      {
        kind: 'action' as const,
        id: 'replace',
        label: { key: 'settings.data.replace' as const },
        variant: 'danger' as const,
      },
    ],
    [
      { kind: 'text' as const, id: 'v', text: 'v0.0.1 · Primeiro Bloco' },
      { kind: 'text' as const, id: 'f', text: t('settings.about.fonts'), dim: true },
      { kind: 'text' as const, id: 'f2', text: t('settings.about.fonts2'), dim: true },
      { kind: 'text' as const, id: 'three', text: t('settings.about.three'), dim: true },
      { kind: 'action' as const, id: 'copy', label: { key: 'settings.about.copy' as const } },
    ],
  ];
  return rows.map((r, tab) =>
    settingsScreen.build({
      tabs: SETTINGS_TABS_FIXTURE,
      tab,
      rows: r,
      // Na aba Botões, o aviso mais longo da troca.
      note:
        tab === 1
          ? t('settings.bind.orphaned', { source: longestBindName(), other: t('bind.action.lastWeapon') })
          : t('settings.data.exported', { name: 'boboforces-backup-2026-11-09.json' }),
    }),
  );
}

/** Os nomes das teclas e dos botões (`bind.*`, menos as ações), o mais longo com "(segurar)" e "+1". */
function bindNames(): string[] {
  const keys = (Object.keys(STRINGS_PT_BR) as StringKey[]).filter(
    (k) => k.startsWith('bind.') && !k.startsWith('bind.action.'),
  );
  return keys.map((k) => t(k));
}
function longestBindName(): string {
  return bindNames().reduce((a, b) => (b.length > a.length ? b : a));
}
/** A aba Botões com todas as ações (rótulos) e todos os nomes (valores), cada um numa linha. */
function bindingFixtureRows(): TabbedRow[] {
  const actions = (Object.keys(STRINGS_PT_BR) as StringKey[]).filter((k) => k.startsWith('bind.action.'));
  const longest = longestBindName();
  const values = [
    ...bindNames(),
    // Só o Interagir do controle segura (o botão da esquerda); +N só vem das listas de fábrica (Shift, agachar).
    t('settings.bind.hold', { name: t('bind.pad.faceLeft') }),
    t('settings.bind.more', { name: t('bind.pad.faceRight'), n: 1 }),
    t('settings.bind.more', { name: t('bind.key.ShiftLeft'), n: 1 }),
    t('settings.bind.waiting'),
    t('settings.bind.none'),
  ];
  const rows: TabbedRow[] = [
    { kind: 'option', id: 'device', labelKey: 'settings.row.device', value: 'Teclado e mouse' },
  ];
  const n = Math.max(actions.length, values.length);
  for (let i = 0; i < n; i++) {
    rows.push({
      kind: 'value',
      id: `bind:${i}`,
      labelKey: actions[i % actions.length]!,
      value: values[i % values.length]!,
    });
  }
  rows.push({ kind: 'action', id: 'reset', label: { key: 'settings.bind.reset' } });
  rows.push({ kind: 'text', id: 'touch', text: t('settings.bind.touch'), dim: true });
  return rows;
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
    // M2 (fase 5a): todo texto desenhado (até o literal, como o nome de um bot) existe na fonte em que sai: a display só
    // tem maiúsculas, e uma minúscula nela vira "?".
    for (const resolved of [text, layout.values.get(node)]) {
      if (!resolved) continue;
      const font = fonts[resolved.font];
      const missing = [...resolved.text.replace(/./gu, (ch) => COMPOSED_CHARS[ch] ?? ch)].filter(
        (ch) => font.glyphIndex(ch.codePointAt(0)!) < 0,
      );
      expect(missing, `${t.name}: "${resolved.text}" na ${resolved.font}`).toEqual([]);
    }
    if (node.kind === 'button' && text) {
      // Linha de opção (M2, fase 4a): o rótulo divide o botão com a área do valor; o valor cabe entre as setas.
      const valueW = node.value !== undefined ? (node.valueWidth ?? OPTION.valueWidth) * layout.scale : 0;
      const padX = node.compact ? BUTTON_COMPACT.padX : BUTTON.padX;
      const room = r.w - 2 * padX * layout.scale - (valueW > 0 ? valueW + 16 * layout.scale : 0);
      const value = layout.values.get(node);
      if (value) {
        // Só leitura (M2, fase 4f): sem setas, o valor tem a área inteira.
        const between = node.valueOnly ? valueW : valueW - 2 * OPTION.arrow * layout.scale;
        expect(
          value.width,
          `${t.name}: valor "${value.text}" ${value.width.toFixed(1)} px em ${between.toFixed(1)}`,
        ).toBeLessThanOrEqual(between);
      }
      expect(
        text.width,
        `${t.name}: "${text.text}" ${text.width.toFixed(1)} px em ${room.toFixed(1)}`,
      ).toBeLessThanOrEqual(room);
      expect(text.height).toBeLessThanOrEqual(r.h);
      expect(Math.min(r.w, r.h), `${t.name}: ${node.id ?? ''} ${r.w}×${r.h}`).toBeGreaterThanOrEqual(t.minTarget);
      expect(text.px).toBeGreaterThanOrEqual(t.minTextPx);
    }
    // Dentro de uma coluna com rolagem, o que está fora da janela é recortado: só a largura conta.
    const clipped = layout.clips.has(node);
    if (node.kind === 'text' && text && clipped) {
      const clip = layout.clips.get(node)!;
      expect(r.x + text.width, `${t.name}: "${text.text}"`).toBeLessThanOrEqual(clip.x + clip.w + 0.5);
    }
    if (node.kind === 'text' && text && !clipped) {
      expect(r.x, `${t.name}: ${node.id ?? text.text}`).toBeGreaterThanOrEqual(c.x - 0.5);
      expect(r.x + text.width, `${t.name}: "${text.text}"`).toBeLessThanOrEqual(c.x + c.w + 0.5);
      // 1 px de folga, como nos botões: a posição e a altura arredondam separadas (coluna ancorada embaixo).
      expect(r.y + r.h, `${t.name}: ${node.id ?? text.text}`).toBeLessThanOrEqual(c.y + c.h + 1);
      expect(r.y, `${t.name}: ${node.id ?? text.text}`).toBeGreaterThanOrEqual(c.y - 0.5);
      expect(text.px).toBeGreaterThanOrEqual(t.minTextPx);
    }
    if (node.kind === 'button' && !clipped) {
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

  it('menus da fase 4 (menu principal, Novidades, Partida Rápida, Modos, Surpreenda-me): cabem nos 6 alvos e no Switch', () => {
    const screens: UiNode[] = [
      mainMenuScreen.build({ items: ['quickMatch', 'modes', 'lab', 'settings', 'news'] }),
      // M2 (fase 4g): Novidades com os 5 itens e o aviso de migração.
      newsScreen.build({
        version: '0.0.1',
        codename: 'Primeiro Bloco',
        items: NEWS_ITEMS,
        migrated: t('news.migrated', { n: 12 }),
      }),
      quickMatchScreen.build({
        // Os valores mais longos de cada linha.
        values: ['Todos contra todos', 'Construto', 'Pela vibe', '6 contra 6', 'Sem limite'],
        groups: [
          {
            id: 'recent',
            titleKey: 'quick.recent',
            items: [{ label: '12 bots Pela vibe', caption: 'Todos contra todos · 10 min ou 25 abates' }],
          },
          {
            id: 'factory',
            titleKey: 'quick.factory',
            items: [{ label: 'Sexta do Jorge', caption: 'Times · 10 min ou 75 abates' }],
          },
        ],
      }),
      modesScreen.build({
        modes: [
          { id: 'warfare.tdm', nameKey: 'mode.name.warfare.tdm', descKey: 'mode.desc.warfare.tdm' },
          { id: 'warfare.ffa', nameKey: 'mode.name.warfare.ffa', descKey: 'mode.desc.warfare.ffa' },
        ],
      }),
      customMatchScreen.build({
        tabs: [
          'custom.tab.match',
          'custom.tab.players',
          'custom.tab.weapons',
          'custom.tab.bots',
          'custom.tab.mods',
          'custom.tab.hud',
        ],
        tab: 4,
        // Os rótulos e os valores mais longos.
        rows: [
          { id: 'a', labelKey: 'custom.row.allyMarkers', value: 'Desligado' },
          { id: 'b', labelKey: 'custom.row.enemies', value: 'Jorge the Immortal' },
          { id: 'c', labelKey: 'custom.row.ammo', value: 'Reserva infinita' },
          { id: 'd', labelKey: 'custom.row.allowed', value: 'Só metralhadora' },
          { id: 'e', labelKey: 'custom.row.regen', value: 'Desligada' },
          { id: 'f', labelKey: 'custom.row.friendlyFire', value: 'Desligado' },
          { id: 'g', labelKey: 'custom.row.headshotOnly', value: 'Ligado' },
          { id: 'h', labelKey: 'custom.row.selfDamage', value: 'Ligado' },
        ],
        summary: 'Todos contra todos · Pela vibe · 12 bobos · Construto',
        note: 'Salvo como Todos contra todos 12 bots Pela vibe 2',
      }),
      surpriseScreen.build({
        lines: ['Bobo Warfare: Todos contra todos', 'Construto', 'Pela vibe', '10 bobos', '10 min ou 25 abates'],
      }),
    ];
    for (const t of [...WEB_TARGETS, ...SWITCH_TARGETS.slice(0, 2)]) {
      for (const tree of screens) {
        const layout = layoutFor(tree, t);
        expectNoOverflow(layout, t);
        expect(reachableScrolling(tree, t, layout.focusable[0]!.id!).size, `${t.name}: foco`).toBe(
          layout.focusable.length,
        );
        // A fileira do canto (COMEÇAR) não encosta na lista nem nos atalhos.
        const rectOfId = (id: string): Rect | null => {
          const n = layout.byId.get(id);
          return n ? (layout.rects.get(n) ?? null) : null;
        };
        const corner = rectOfId('buttons');
        for (const other of ['rows', 'options', 'shortcutsPanel']) {
          const r = rectOfId(other);
          if (corner && r) expect(overlaps(corner, r), `${t.name}: buttons × ${other}`).toBe(false);
        }
      }
    }
  });

  it('Oficina (M2, fase 5a): o pior card (nome longo, todas as regras) cabe e não encosta no Voltar', () => {
    const names = ['Sergeant Noodle the Grea', 'Jorge the Immortal 2', 'Tryhard Bob'];
    const tree = workshopScreen.build({
      groups: [
        { id: 'fav', titleKey: 'workshop.favorites', items: [{ id: 'a', label: names[0]! }], empty: '' },
        { id: 'mine', titleKey: 'workshop.mine', items: [], empty: t('workshop.empty') },
        {
          id: 'factory',
          titleKey: 'workshop.factory',
          items: names.map((label, i) => ({ id: `f${i}`, label })),
          empty: '',
        },
      ],
      selected: 'a',
      name: names[0]!,
      // As linhas do card de um bot com todas as regras (o `bot-card` agrupa em até 40 caracteres).
      lines: [
        'Habilidade: ajustada',
        'Inteligência N4 · Estrategista',
        'Reação 1200 ms · erro 10° · cabeça 100%',
        'Regras: 1000 de vida · dano ×0,25 ·',
        'velocidade ×0,5 ·',
        'só lança-foguetes, metralhadora ·',
        'munição infinita ·',
        'imune a tiro na cabeça ·',
        'explode ao morrer',
      ],
      note: t('workshop.deleteAsk', { name: names[0]! }),
      canEdit: true,
      canDelete: true,
      favorite: true,
      confirmDelete: true,
    });
    for (const target of [...WEB_TARGETS, ...SWITCH_TARGETS.slice(0, 2)]) {
      const layout = layoutFor(tree, target);
      expectNoOverflow(layout, target);
      expect(reachableScrolling(tree, target, layout.focusable[0]!.id!).size, `${target.name}: foco`).toBe(
        layout.focusable.length,
      );
      const rectOf = (id: string): Rect => layout.rects.get(layout.byId.get(id)!)!;
      expect(overlaps(rectOf('buttons'), rectOf('card')), `${target.name}: Voltar × card`).toBe(false);
      expect(overlaps(rectOf('bots'), rectOf('card')), `${target.name}: lista × card`).toBe(false);
    }
  });

  it('Gire o celular (M2, fase 4h): cabe no celular em retrato', () => {
    const portrait = [
      web('celular em retrato 750×1334 (DPR 2)', 750, 1334, 2, true),
      web('celular em retrato 360×640', 360, 640, 1, true),
    ];
    for (const target of portrait) expectNoOverflow(layoutFor(rotateScreen.build(null), target), target);
  });

  it('ajustes (as 6 abas): cabem nos 6 alvos da web e no Switch, alcançáveis pelo D-pad', () => {
    for (const target of [...WEB_TARGETS, ...SWITCH_TARGETS.slice(0, 2)]) {
      for (const tree of settingsFixtures()) {
        const layout = layoutFor(tree, target);
        expectNoOverflow(layout, target);
        expect(reachableScrolling(tree, target, layout.focusable[0]!.id!).size, `${target.name}: foco`).toBe(
          layout.focusable.length,
        );
      }
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
