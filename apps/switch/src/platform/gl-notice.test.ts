import { describe, expect, it } from 'vitest';
import { drawGlNotice, noticeText, wrapNotice, type NoticeGl } from './gl-notice.ts';

describe('aviso pelo WebGL2', () => {
  it('caixa alta sem acento; o que a fonte não tem vira ?', () => {
    expect(noticeText('Não deu: ação + saída/runtime.log')).toBe('NAO DEU: ACAO + SAIDA/RUNTIME.LOG');
    expect(noticeText('€¤')).toBe('??');
  });

  it('quebra por palavra sem passar do limite', () => {
    expect(wrapNotice('APERTE + PARA SAIR', 8)).toEqual(['APERTE +', 'PARA', 'SAIR']);
    expect(wrapNotice('SDMC:/SWITCH/BOBOFORCES', 10)).toEqual(['SDMC:/SWIT', 'CH/BOBOFOR', 'CES']);
  });

  it('desenha só com scissor + clear, dentro da tela, e devolve o estado (scissor desligado)', () => {
    const rects: [number, number, number, number][] = [];
    let scissorOn = false;
    let clears = 0;
    const gl: NoticeGl = {
      bindFramebuffer: () => {},
      viewport: () => {},
      colorMask: () => {},
      enable: () => void (scissorOn = true),
      disable: () => void (scissorOn = false),
      scissor: (x, y, w, h) => void rects.push([x, y, w, h]),
      clearColor: () => {},
      clear: () => void clears++,
    };
    drawGlNotice(gl, 1280, 720, [
      'Falha ao iniciar o BoboForces',
      'Detalhes em sdmc:/switch/boboforces/runtime.log. Aperte + para sair.',
    ]);
    expect(scissorOn).toBe(false);
    expect(clears).toBe(rects.length + 1); // + o fundo, sem scissor
    for (const [x, y, w, h] of rects) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x + w).toBeLessThanOrEqual(1280);
      expect(y + h).toBeLessThanOrEqual(720);
    }
  });
});
