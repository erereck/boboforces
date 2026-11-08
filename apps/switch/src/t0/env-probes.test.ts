import { describe, expect, it } from 'vitest';
import { captureConsole, modeName } from './boot.ts';
import { DECOMPRESSION_SAMPLES, probeBattery, probeFontFace, probeIntlAndDecompression } from './env-probes.ts';
import { controllerModel, createT0Logger, hex } from './log.ts';

function capture() {
  const lines: string[] = [];
  return { lines, log: createT0Logger((l) => lines.push(l)) };
}

describe('item 21: Intl e DecompressionStream', () => {
  it('com os globais do Node (que o nx.js também tem): os três formatos descomprimem', async () => {
    const { lines, log } = capture();
    await probeIntlAndDecompression(log, { Intl, DecompressionStream });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[t0\] item=21 nome=intl-decompression status=info intl=1 numero_ptbr=/);
    expect(lines[0]).toContain('decompression=1 gzip=ok deflate=ok deflate_raw=ok decompression_ok=1');
    expect(Object.keys(DECOMPRESSION_SAMPLES)).toEqual(['gzip', 'deflate', 'deflate-raw']);
  });

  it('sem Intl e sem DecompressionStream: informa sem lançar', async () => {
    const { lines, log } = capture();
    await probeIntlAndDecompression(log, {});
    expect(lines[0]).toBe(
      '[t0] item=21 nome=intl-decompression status=info intl=0 datas=0 decompression=0 decompression_ok=0',
    );
  });
});

describe('item 8: FontFace + texto em OffscreenCanvas', () => {
  it('conta os pixels pintados com a fonte do sistema', () => {
    const { lines, log } = capture();
    class Offscreen {
      getContext() {
        return {
          font: '',
          fillStyle: '',
          textBaseline: '',
          fillText() {},
          measureText: (s: string) => ({ width: s.length * 12.4 }),
          getImageData: () => ({ data: new Uint8Array([0, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 128]) }),
        };
      }
    }
    probeFontFace(
      log,
      { FontFace: class {}, fonts: { add() {}, check: () => true, size: 2 }, OffscreenCanvas: Offscreen },
      () => 0,
    );
    expect(lines[0]).toBe(
      '[t0] item=8 nome=fontface status=info fontface=1 fonts_add=1 fonts_qtd=2 system_ui=1 offscreen=1 ' +
        'largura_texto=124 pixels_pintados=2 ms=0',
    );
  });

  it('sem OffscreenCanvas é falha (informativa)', () => {
    const { lines, log } = capture();
    probeFontFace(log, {}, () => 0);
    expect(lines[0]).toBe('[t0] item=8 nome=fontface status=falha fontface=0 fonts_add=0 fonts_qtd=-1 offscreen=0');
  });
});

describe('item 20: bateria', () => {
  it('nível em % e carregando; sem getBattery é falha', async () => {
    const { lines, log } = capture();
    await probeBattery(log, () => Promise.resolve({ level: 0.734, charging: false }), 'boot', 'portatil');
    await probeBattery(log, undefined, 'boot', 'dock');
    await probeBattery(log, () => Promise.reject(new Error('sem serviço')), 'troca_de_modo', 'dock');
    expect(lines).toEqual([
      '[t0] item=20 nome=lifecycle status=info evento=boot modo=portatil bateria=1 nivel=73 carregando=0',
      '[t0] item=20 nome=lifecycle status=falha evento=boot bateria=0',
      '[t0] item=20 nome=lifecycle status=falha evento=troca_de_modo bateria=1 erro="sem serviço"',
    ]);
  });
});

describe('utilidades das sondas', () => {
  it('modo, hex, modelo do controle sem número de série e chave inválida que não derruba', () => {
    expect([modeName(0), modeName(1), modeName(-1)]).toEqual(['portatil', 'dock', 'desconhecido']);
    expect([hex(0x1f), hex(-1)]).toEqual(['0x1f', '-1']);
    expect(controllerModel('Nintendo Switch Pro Controller (XAW10012345678)')).toBe('Nintendo Switch Pro Controller');
    expect(controllerModel('switch-gamepad-2')).toBe('switch-gamepad-2');
    const { lines, log } = capture();
    log(1, 'ok', { 'Chave Ruim': 1 });
    expect(lines[0]).toMatch(/^\[t0\] item=1 status=falha erro="linha inválida/);
  });

  it('captureConsole copia warn/error para o log, chama o original e respeita o teto', () => {
    const seen: string[] = [];
    const fakeConsole = {
      warn: (...a: unknown[]) => void seen.push(`w:${a.join(' ')}`),
      error: (...a: unknown[]) => void seen.push(`e:${a.join(' ')}`),
    };
    const log: string[] = [];
    const cap = captureConsole(fakeConsole, (l) => log.push(l), 2);
    fakeConsole.warn('THREE.WebGLRenderer:', { a: 1 });
    fakeConsole.error(new Error('ruim'));
    fakeConsole.warn('terceiro');
    expect(seen).toEqual(['w:THREE.WebGLRenderer: [object Object]', 'e:Error: ruim', 'w:terceiro']);
    expect(log).toEqual([
      '[console.warn] THREE.WebGLRenderer: {"a":1}',
      '[console.error] ruim',
      '[console] limite de 2 linhas atingido; o resto fica só no console',
    ]);
    expect(cap.count()).toBe(2);
    cap.restore();
    fakeConsole.warn('depois');
    expect(log).toHaveLength(3);
  });
});
