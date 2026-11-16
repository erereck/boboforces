import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BOT_RANGES } from '@boboforces/format';
import { BUTTON_COMPACT, layoutTree, MIN_TEXT, moveFocus, parseFontPack, type LayoutResult } from '@boboforces/ui';
import { describe, expect, it } from 'vitest';
import { cleanBotName } from './lab.ts';
import { KEYBOARD_PAGES, keyboardStep, keyboardTree, type KeyboardState } from './onscreen-keyboard.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const RUNTIME = JSON.parse(readFileSync(join(ROOT, 'assets-src', 'runtime-assets.json'), 'utf8')) as {
  files: Record<string, string>;
};
const fonts = parseFontPack(
  JSON.parse(readFileSync(join(ROOT, 'assets-src', RUNTIME.files['fonts/ui-fonts.json']!), 'utf8')),
).fonts;

const base: KeyboardState = { title: 'Nome do bot', value: '', maxLength: 24, page: 'letters', upper: true };

/** Digita uma sequência de ações a partir de `state`. */
function type(state: KeyboardState, actions: readonly string[]): KeyboardState {
  let s = state;
  for (const a of actions) {
    const next = keyboardStep(s, a, cleanBotName);
    if (next === 'submit') throw new Error('submit no meio');
    s = next;
  }
  return s;
}

describe('teclado do jogo (M4, fase 4d)', () => {
  it('digita, a maiúscula vale para uma letra, apagar tudo volta a maiúscula, OK grava', () => {
    let s = type(base, ['key:j', 'key:o', 'key:r', 'key:g', 'key:e', 'space', 'shift', 'key:b']);
    expect(s.value).toBe('Jorge B');
    expect(s.upper).toBe(false);
    s = type(s, ['erase', 'erase', 'erase']);
    expect(s.value).toBe('Jorg');
    s = type(s, ['erase', 'erase', 'erase', 'erase', 'erase']);
    expect([s.value, s.upper]).toEqual(['', true]);
    s = type(s, ['page', 'key:é', 'page', 'key:z']);
    expect(s.value).toBe('Éz');
    expect(keyboardStep(s, 'ok', cleanBotName)).toBe('submit');
  });

  it('não passa do limite nem aceita o que o nome não aceita (espaço no começo, dois espaços)', () => {
    const full = { ...base, value: 'a'.repeat(BOT_RANGES.nameMaxLength), upper: false };
    expect(keyboardStep(full, 'key:b', cleanBotName)).toBe(full);
    expect(type(base, ['space']).value).toBe('');
    expect(type({ ...base, upper: false }, ['key:a', 'space', 'space', 'key:b']).value).toBe('a b');
  });

  it('toda tecla (as duas páginas, minúscula e maiúscula) passa no filtro do nome e existe na fonte', () => {
    const glyphs = new Set<number>();
    for (const font of [fonts.hud, fonts.display]) {
      for (let i = 0; i < font.glyphData.length; i += 8) glyphs.add(font.glyphData[i]!);
    }
    for (const rows of Object.values(KEYBOARD_PAGES)) {
      for (const ch of rows.join('')) {
        for (const c of [ch, ch.toUpperCase()]) {
          expect(cleanBotName(`a${c}`), c).toBe(`a${c}`);
          expect(glyphs.has(c.codePointAt(0)!), `glifo ${c}`).toBe(true);
        }
      }
    }
  });

  const TARGETS = [
    { name: 'web 640×360', w: 640, h: 360, minTextPx: MIN_TEXT.phone },
    { name: 'Switch 1280×720', w: 1280, h: 720, minTextPx: MIN_TEXT.tv },
    { name: 'web 4:3 1024×768', w: 1024, h: 768, minTextPx: MIN_TEXT.phone },
    { name: 'web 1920×1080', w: 1920, h: 1080, minTextPx: MIN_TEXT.phone },
  ];

  it('cabe nas telas (rótulos nas teclas, tudo dentro) e o D-pad anda pelas linhas', () => {
    for (const t of TARGETS) {
      for (const state of [
        { ...base, value: 'W'.repeat(24), upper: false },
        { ...base, page: 'accents' as const, upper: true },
      ]) {
        const layout: LayoutResult = layoutTree(keyboardTree(state), { x: 0, y: 0, w: t.w, h: t.h }, 1, {
          fonts,
          minTextPx: t.minTextPx,
          minTarget: 0,
        });
        const c = layout.content;
        for (const node of layout.order) {
          const r = layout.rects.get(node)!;
          const text = layout.texts.get(node);
          if (!text) continue;
          expect(text.px, `${t.name}: ${text.text}`).toBeGreaterThanOrEqual(t.minTextPx);
          if (node.kind === 'button') {
            expect(text.width, `${t.name}: "${text.text}"`).toBeLessThanOrEqual(
              r.w - 2 * BUTTON_COMPACT.padX * layout.scale,
            );
          }
          const mid = r.x + r.w / 2;
          expect(mid - text.width / 2, `${t.name}: "${text.text}"`).toBeGreaterThanOrEqual(c.x - 0.5);
          expect(mid + text.width / 2, `${t.name}: "${text.text}"`).toBeLessThanOrEqual(c.x + c.w + 0.5);
          expect(r.y + r.h, `${t.name}: "${text.text}"`).toBeLessThanOrEqual(c.y + c.h + 1);
        }
        // Só com o D-pad: de cima a baixo pela 1ª coluna até a linha de controle, e pela linha toda.
        const rows = KEYBOARD_PAGES[state.page].length;
        let id = 'k-0-0';
        for (let r = 1; r < rows; r++) {
          id = moveFocus(layout, id, 'down')!;
          expect(id, t.name).toBe(`k-${r}-0`);
        }
        expect(moveFocus(layout, id, 'down'), t.name).toBe('shift');
        let at = 'k-0-0';
        for (let col = 1; col < 10; col++) at = moveFocus(layout, at, 'right')!;
        expect(at, t.name).toBe('k-0-9');
        expect(moveFocus(layout, 'shift', 'right'), t.name).toBe('page');
        expect(moveFocus(layout, 'page', 'right'), t.name).toBe('erase');
        expect(moveFocus(layout, 'shift', 'down'), t.name).toBe('space');
        expect(moveFocus(layout, 'space', 'right'), t.name).toBe('ok');
      }
    }
    expect(BUTTON_COMPACT.height).toBeGreaterThanOrEqual(44);
  });
});
