import { describe, expect, it } from 'vitest';
import { detectUnsupported } from '../boot.ts';
import { createWebAssets, isLogicalAssetPath, resolveAssetUrl } from './assets.ts';
import { computeFeatures, type FeatureEnv } from './features.ts';
import { computeBufferSize, type BufferSize, type BufferSizeInput } from './graphics.ts';
import { createStoragePersistence } from './persistence.ts';

function env(userAgent: string, maxTouchPoints: number, queries: string[], mobileHint?: boolean): FeatureEnv {
  return { userAgent, maxTouchPoints, mobileHint, matches: (q) => queries.includes(q) };
}

const WIN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; SM-A155M) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36';
const IPAD_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15';

describe('computeFeatures', () => {
  it('PC com mouse', () => {
    const f = computeFeatures(env(WIN_UA, 0, ['(any-pointer: fine)']));
    expect(f).toEqual({ profileHint: 'pc', touch: false, keyboardMouse: true, reducedMotion: false, canExit: false });
  });
  it('Android', () => {
    const f = computeFeatures(env(ANDROID_UA, 5, ['(pointer: coarse)', '(any-pointer: coarse)'], true));
    expect(f.profileHint).toBe('mobile');
    expect(f.touch).toBe(true);
    expect(f.keyboardMouse).toBe(false);
  });
  it('iPad se passando por Mac conta como celular', () => {
    expect(computeFeatures(env(IPAD_UA, 5, ['(pointer: coarse)'])).profileHint).toBe('mobile');
  });
  it('notebook com tela de toque continua PC', () => {
    const f = computeFeatures(env(WIN_UA, 10, ['(any-pointer: fine)', '(any-pointer: coarse)'], false));
    expect(f.profileHint).toBe('pc');
    expect(f.touch).toBe(true);
    expect(f.keyboardMouse).toBe(true);
  });
  it('lê "reduzir movimento"', () => {
    expect(computeFeatures(env(WIN_UA, 0, ['(prefers-reduced-motion: reduce)'])).reducedMotion).toBe(true);
  });
});

describe('computeBufferSize', () => {
  const base: BufferSizeInput = {
    cssWidth: 1280,
    cssHeight: 720,
    devicePixelRatio: 1,
    maxPixelRatio: 2,
    renderScale: 1,
    devicePixelWidth: undefined,
    devicePixelHeight: undefined,
    maxSize: 16384,
  };
  const out: BufferSize = { width: 0, height: 0, pixelRatio: 0 };

  it('DPR 1 dá o tamanho CSS', () => {
    expect(computeBufferSize(base, out)).toEqual({ width: 1280, height: 720, pixelRatio: 1 });
  });
  it('limita o DPR ao teto do perfil', () => {
    expect(computeBufferSize({ ...base, devicePixelRatio: 3, maxPixelRatio: 1.5 }, out)).toEqual({
      width: 1920,
      height: 1080,
      pixelRatio: 1.5,
    });
  });
  it('usa os px exatos do aparelho quando o DPR não foi limitado', () => {
    const r = computeBufferSize(
      {
        ...base,
        cssWidth: 1536,
        cssHeight: 864.8,
        devicePixelRatio: 1.25,
        devicePixelWidth: 1920,
        devicePixelHeight: 1081,
      },
      out,
    );
    expect([r.width, r.height]).toEqual([1920, 1081]);
  });
  it('ignora os px exatos quando o DPR foi limitado', () => {
    const r = computeBufferSize(
      { ...base, devicePixelRatio: 3, maxPixelRatio: 2, devicePixelWidth: 3840, devicePixelHeight: 2160 },
      out,
    );
    expect([r.width, r.height]).toEqual([2560, 1440]);
  });
  it('ignora px exatos que não batem com CSS × DPR (emulação de DPR do Chromium headless)', () => {
    const r = computeBufferSize(
      { ...base, cssWidth: 667, cssHeight: 375, devicePixelRatio: 2, devicePixelWidth: 667, devicePixelHeight: 375 },
      out,
    );
    expect([r.width, r.height, r.pixelRatio]).toEqual([1334, 750, 2]);
  });
  it('aplica a escala dinâmica', () => {
    const r = computeBufferSize({ ...base, devicePixelRatio: 2, renderScale: 0.5 }, out);
    expect([r.width, r.height, r.pixelRatio]).toEqual([1280, 720, 1]);
  });
  it('encolhe mantendo a proporção acima do maior tamanho da GPU', () => {
    const r = computeBufferSize({ ...base, cssWidth: 8000, cssHeight: 2000, maxSize: 4096 }, out);
    expect([r.width, r.height]).toEqual([4096, 1024]);
  });
  it('nunca dá zero (canvas escondido)', () => {
    const r = computeBufferSize({ ...base, cssWidth: 0, cssHeight: 0 }, out);
    expect([r.width, r.height]).toEqual([1, 1]);
  });
});

describe('assets', () => {
  it('aceita só caminho lógico', () => {
    expect(isLogicalAssetPath('maps/construto.bfmap')).toBe(true);
    expect(isLogicalAssetPath('textures/blocos16.png')).toBe(true);
    for (const bad of ['', '/maps/a', '../a', 'a/../b', 'a//b', 'https://x/a', 'data:a', 'a?b', 'a#b', 'a\\b', './a']) {
      expect(isLogicalAssetPath(bad), bad).toBe(false);
    }
  });

  it('resolve relativo à base do site (subcaminho do Pages)', () => {
    expect(resolveAssetUrl('maps/construto.bfmap', 'https://erereck.github.io/boboforces/')).toBe(
      'https://erereck.github.io/boboforces/maps/construto.bfmap',
    );
    expect(() => resolveAssetUrl('../x', 'https://a/')).toThrow();
  });

  it('carrega bytes e texto, e rejeita status fora de 2xx e falha de rede', async () => {
    const seen: string[] = [];
    const assets = createWebAssets('https://h/boboforces/', async (url) => {
      seen.push(url);
      if (url.endsWith('rede.bin')) throw new TypeError('Failed to fetch');
      if (url.endsWith('faltando.bin')) return new Response('nada', { status: 404 });
      return new Response(new Uint8Array([1, 2, 3]));
    });
    expect([...(await assets.loadBytes('a/b.bin'))]).toEqual([1, 2, 3]);
    expect(await assets.loadText('a/c.txt')).toBe('\u0001\u0002\u0003');
    await expect(assets.loadBytes('faltando.bin')).rejects.toThrow(/HTTP 404/);
    await expect(assets.loadBytes('rede.bin')).rejects.toThrow(/rede/);
    await expect(assets.loadText('/absoluto')).rejects.toThrow(/inválido/);
    expect(seen[0]).toBe('https://h/boboforces/a/b.bin');
  });
});

describe('persistência (navigator.storage.persist)', () => {
  it('não pede fora de um gesto e pede uma vez só dentro de um', async () => {
    let asks = 0;
    const nav = {
      storage: { persisted: async () => false, persist: async () => (asks++, true) },
      userActivation: { isActive: false },
    };
    const p = createStoragePersistence(nav);
    expect(await p.refresh()).toBe(false);
    p.requestIfGesture();
    expect(asks).toBe(0);
    nav.userActivation.isActive = true;
    p.requestIfGesture();
    p.requestIfGesture();
    expect(await p.request()).toBe(true);
    expect(asks).toBe(1);
    expect(p.persisted).toBe(true);
  });

  it('sem a API, fica null', async () => {
    const p = createStoragePersistence({});
    expect(await p.request()).toBeNull();
    expect(p.persisted).toBeNull();
  });
});

describe('detectUnsupported', () => {
  const ok = { esSyntax: true, arrayAt: true, objectHasOwn: true, webgl2: true };
  it('navegador moderno passa', () => expect(detectUnsupported(ok)).toBeNull());
  it('sem a sintaxe ou as funções do ES2022 é "es"', () => {
    expect(detectUnsupported({ ...ok, esSyntax: false })).toBe('es');
    expect(detectUnsupported({ ...ok, objectHasOwn: false })).toBe('es');
  });
  it('sem WebGL2 é "webgl2"', () => expect(detectUnsupported({ ...ok, webgl2: false })).toBe('webgl2'));
  it('ES antigo ganha de WebGL2 (a mensagem certa é atualizar o navegador)', () =>
    expect(detectUnsupported({ ...ok, arrayAt: false, webgl2: false })).toBe('es'));
});
