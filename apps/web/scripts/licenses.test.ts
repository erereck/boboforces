import { describe, expect, it } from 'vitest';
import { checkFontNotices, composeLicenseNotices, LICENSE_HEADER, UI_FONT_NOTICES_PATH } from './licenses.ts';

/** Arquivo de licenças sintético, no formato que o fontbake grava (uma seção por fonte em uso). */
const FONTS = [
  '== Fonte X Display: atlas MSDF derivado de Fonte X 1.0 (SIL OFL 1.1) ==',
  '',
  'Copyright (c) 2026, Autora X, with Reserved Font Name "X"',
  'This Font Software is licensed under the SIL Open Font License, Version 1.1.',
  '',
  '== Fonte Y HUD: atlas MSDF derivado de Fonte Y 2.0 (SIL OFL 1.1) ==',
  '',
  'Copyright (c) 2026, Autor Y, with reserved font name "Y"',
  'This Font Software is licensed under the SIL Open Font License, Version 1.1.',
].join('\r\n');

describe('licencas.txt', () => {
  it('cabeçalho abre a exceção OFL para o atlas de fontes', () => {
    expect(LICENSE_HEADER).toContain('Todos os direitos reservados, exceto o atlas de fontes');
    expect(LICENSE_HEADER).toContain('assets/fonts/ui-fonts.png e assets/fonts/ui-fonts.json');
    expect(LICENSE_HEADER).toContain('SIL Open Font License 1.1');
  });

  it('junta cabeçalho, pacotes na ordem dada e as seções das fontes', () => {
    const text = composeLicenseNotices(
      [
        { name: 'a', version: '1.0.0', license: 'MIT', text: '  MIT do a\n' },
        { name: '@b/c', version: '2.0.0', license: null, text: 'texto do c' },
      ],
      FONTS,
    );
    expect(
      text.startsWith(`${LICENSE_HEADER}\n\n== a 1.0.0 (MIT) ==\n\nMIT do a\n\n== @b/c 2.0.0 (ver texto) ==`),
    ).toBe(true);
    expect(text.indexOf('== Fonte X Display')).toBeGreaterThan(text.indexOf('texto do c'));
    expect(text.indexOf('== Fonte Y HUD')).toBeGreaterThan(text.indexOf('== Fonte X Display'));
    expect(text).not.toContain('\r');
    expect(text.endsWith('Version 1.1.\n')).toBe(true);
  });

  it('reprova o arquivo das fontes sem seção, sem copyright ou sem a OFL', () => {
    expect(checkFontNotices(FONTS)).toContain('== Fonte Y HUD');
    expect(() => checkFontNotices('')).toThrow(UI_FONT_NOTICES_PATH);
    expect(() => checkFontNotices('Copyright X\nSIL Open Font License')).toThrow('seção');
    expect(() => checkFontNotices(FONTS.replace('Copyright (c) 2026, Autor Y', 'Autor Y'))).toThrow(
      'sem o aviso de copyright na seção "Fonte Y HUD',
    );
    expect(() => checkFontNotices(FONTS.replace(/Open Font License/g, 'Outra Licença'))).toThrow(
      'sem a SIL Open Font License',
    );
    expect(() => checkFontNotices(FONTS)).not.toThrow();
  });
});
