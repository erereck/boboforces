import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  layoutTree,
  MIN_TEXT,
  moveFocus,
  parseFontPack,
  STRINGS_PT_BR,
  BUTTON,
  TITLE_ACTION_TEST_PREFIX,
  titleScreen,
  type LayoutResult,
  type Rect,
  type UiFonts,
} from '@boboforces/ui';
import { describe, expect, it } from 'vitest';
import { createSwitchTestItems, SWITCH_BENCH_PRESETS } from './items.ts';
import { SWITCH_TEST_STRINGS } from './strings.ts';

const ROOT = resolve(import.meta.dirname, '..', '..', '..', '..');

describe('itens de teste do título no Switch', () => {
  const items = createSwitchTestItems();

  it('9 itens em ordem fixa, ids únicos, presets do bench e telas da casca', () => {
    expect(items.map((i) => i.id)).toEqual([
      'bench-dock',
      'bench-solo',
      'bench-zombies',
      'bench-bots48',
      'bench-planb',
      'bench-gpu',
      'controllers',
      'keyboard',
      'audio',
    ]);
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    const p = SWITCH_BENCH_PRESETS;
    expect(items.slice(0, 6).map((i) => i.bench)).toEqual([p.dock, p.solo, p.zombies, p.bots48, p.planB, p.gpu]);
    for (const item of items.slice(6)) {
      expect(item.bench).toBeUndefined();
      expect(typeof item.start).toBe('function');
    }
  });

  it('rótulos só pelas chaves curtas `test.item.*` da tabela (decisão #54), nunca os textos longos', () => {
    for (const item of items) {
      expect(item.labelKey).toMatch(/^test\.item\./);
      expect(item.labelKey in STRINGS_PT_BR).toBe(true);
    }
    // Plano B: a chave nova quando a tabela tiver, senão o "Bench" genérico.
    const planB = items.find((i) => i.id === 'bench-planb')!;
    expect(planB.labelKey).toBe('test.item.benchPlanB' in STRINGS_PT_BR ? 'test.item.benchPlanB' : 'test.item.bench');
    expect(SWITCH_TEST_STRINGS['test.item.benchPlanB']).toBe('Bench plano B');
  });

  it('bench.json e presets sem chaves de contorno, densidade ou fontes candidatas', () => {
    const allowed = new Set(Object.keys(SWITCH_BENCH_PRESETS.dock));
    for (const preset of Object.values(SWITCH_BENCH_PRESETS)) {
      expect(new Set(Object.keys(preset))).toEqual(allowed);
      expect(Object.keys(preset).filter((k) => /outline|density|densid|contorno|font|candidat/i.test(k))).toEqual([]);
    }
  });
});

/** Fontes do atlas de verdade (o `fonts/ui-fonts.json` do runtime-assets.json), como o Switch carrega. */
function realFonts(): UiFonts {
  const table = JSON.parse(readFileSync(join(ROOT, 'assets-src', 'runtime-assets.json'), 'utf8')) as {
    files: Record<string, string>;
  };
  const file = table.files['fonts/ui-fonts.json'];
  if (!file) throw new Error('runtime-assets.json sem fonts/ui-fonts.json');
  return parseFontPack(JSON.parse(readFileSync(join(ROOT, 'assets-src', file), 'utf8'))).fonts;
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function inside(a: Rect, b: Rect): boolean {
  return a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
}

function rectOf(layout: LayoutResult, id: string): Rect {
  const node = layout.byId.get(id);
  const rect = node ? layout.rects.get(node) : undefined;
  if (!rect) throw new Error(`sem retângulo para "${id}"`);
  return rect;
}

/** Ids alcançáveis só com o D-pad a partir de `start`. */
function reachable(layout: LayoutResult, start: string): Set<string> {
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const id = queue.shift()!;
    for (const dir of ['up', 'down', 'left', 'right'] as const) {
      const next = moveFocus(layout, id, dir);
      if (next && !seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

describe('título do Switch com os 9 itens (atlas real)', () => {
  const fonts = realFonts();
  const extraItems = createSwitchTestItems().map((i) => ({ id: i.id, labelKey: i.labelKey }));
  const root = titleScreen.build({ version: '0.1.0', codename: 'Teste', canExit: true, extraItems });
  // O Switch desenha a 1280×720 com o piso de texto da TV; os outros tamanhos são os do print da web e do ui.
  const cases = [
    { w: 1280, h: 720, minTextPx: MIN_TEXT.tv },
    { w: 640, h: 360, minTextPx: MIN_TEXT.phone },
    { w: 1334, h: 750, minTextPx: MIN_TEXT.phone },
    { w: 1920, h: 1080, minTextPx: MIN_TEXT.phone },
    { w: 1024, h: 768, minTextPx: MIN_TEXT.phone },
  ] as const;

  for (const { w, h, minTextPx } of cases) {
    it(`${w}×${h}: sem sobreposição, rótulos dentro do botão e foco por D-pad em todos`, () => {
      const layout = layoutTree(root, { x: 0, y: 0, w, h }, 1, { fonts, minTextPx });
      const ids = layout.focusable.map((b) => b.id ?? '');
      const testIds = extraItems.map((i) => TITLE_ACTION_TEST_PREFIX + i.id);
      expect(ids.slice(0, 3)).toEqual(['play', 'settings', 'quit']);
      expect(ids.filter((id) => id.startsWith(TITLE_ACTION_TEST_PREFIX)).sort()).toEqual([...testIds].sort());

      // Peça a peça (logo, barra, coluna do menu, rodapé): a grade fica no vão entre o logo e os botões.
      const others = ['logo', 'logoBar', 'buttons', 'credit', 'version'].map((id) => ({
        id,
        rect: rectOf(layout, id),
      }));
      for (const button of layout.focusable) {
        const rect = layout.rects.get(button)!;
        expect(inside(rect, layout.content), `${button.id} fora da área útil`).toBe(true);
        const text = layout.texts.get(button)!;
        expect(
          text.width + 2 * BUTTON.padX * layout.scale,
          `rótulo "${text.text}" (${text.width.toFixed(1)} px) não cabe no botão ${button.id} (${rect.w} px)`,
        ).toBeLessThanOrEqual(rect.w + 0.5);
        for (const other of layout.focusable) {
          if (other !== button)
            expect(overlaps(rect, layout.rects.get(other)!), `${button.id} × ${other.id}`).toBe(false);
        }
        if (!button.id?.startsWith(TITLE_ACTION_TEST_PREFIX)) continue;
        for (const o of others) expect(overlaps(rect, o.rect), `${button.id} × ${o.id}`).toBe(false);
      }

      // Todo item alcançável a partir de JOGAR (foco inicial) e de volta a JOGAR, só com o D-pad.
      expect([...reachable(layout, 'play')].sort()).toEqual([...ids].sort());
      for (const id of testIds) expect(reachable(layout, id).has('play'), `${id} não volta a JOGAR`).toBe(true);
    });
  }
});
