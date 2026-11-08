import { describe, expect, it } from 'vitest';
import { createDrawList } from './draw-list.ts';
import {
  createDebugPanelModel,
  DEBUG_PANEL_MAX_VIEWS,
  drawDebugPanel,
  drawFontSpecimen,
  drawHud,
  drawTestScreen,
  createHudModel,
  createMsdfFont,
  createTestScreenModel,
  parseFontFile,
  TEST_SCREEN_MAX_LINES,
} from './index.ts';

// Contratos do M1: modelos pré-alocados (sem alocação por frame) e os desenhos já implementados pela frente
// ui-fontes (o detalhe de cada tela está em `screens/*.test.ts`).
describe('telas do M1 (contrato)', () => {
  it('modelos pré-alocados e desenhos sem fontes não lançam', () => {
    const list = createDrawList();
    expect(createDebugPanelModel().views.length).toBe(DEBUG_PANEL_MAX_VIEWS);
    expect(createTestScreenModel().lines.length).toBe(TEST_SCREEN_MAX_LINES);
    const view = {
      x: 0,
      y: 0,
      width: 640,
      height: 360,
      scale: 1,
      minTextPx: 16,
      insetTop: 0,
      insetRight: 0,
      insetBottom: 0,
      insetLeft: 0,
      viewCount: 4,
    };
    expect(() => drawHud(list, null, createHudModel(), view)).not.toThrow();
    const panel = createDebugPanelModel();
    panel.visible = true;
    expect(() => drawDebugPanel(list, null, panel, 1280, 720)).not.toThrow();
    expect(() => drawTestScreen(list, null, createTestScreenModel(), 1280, 720)).not.toThrow();
    expect(() => drawFontSpecimen(list, null, 1280, 720)).not.toThrow();
    expect(list.count).toBeGreaterThan(0);
  });

  it('fontes em uso (decisão #54): FontFile com licença e origem opcionais; folha das fontes no contrato', () => {
    const base = { layer: 0, size: 20, distanceRange: 4, lineHeight: 24, base: 18, capHeight: 14, xHeight: 10 };
    const file = parseFontFile({ ...base, glyphs: [], license: 'OFL-1.1', source: 'Saira Condensed 1.0' }, 'hud');
    expect(file.license).toBe('OFL-1.1');
    expect(file.source).toBe('Saira Condensed 1.0');
    const old = parseFontFile({ ...base, glyphs: [], license: 7 }, 'hud');
    expect('license' in old || 'source' in old).toBe(false);
    // A fonte pronta repassa versão, licença e origem (vazias quando o pacote não traz) para a folha das fontes.
    const font = createMsdfFont({ ...file, version: '1.0' }, 512, 256);
    expect([font.version, font.license, font.source]).toEqual(['1.0', 'OFL-1.1', 'Saira Condensed 1.0']);
    expect([createMsdfFont(old, 512, 256).license, createMsdfFont(old, 512, 256).source]).toEqual(['', '']);
    expect(drawFontSpecimen).toBeTypeOf('function');
  });
});
