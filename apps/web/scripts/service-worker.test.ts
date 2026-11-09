import { Script } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { APPLY_UPDATE } from '../src/platform/updates.ts';
import { APPLY_UPDATE_MESSAGE, isHashedFile, precacheList, serviceWorkerSource } from './service-worker.ts';

describe('service worker (fase 8c)', () => {
  it('precache: o index como ./, sem a música, o bench, o próprio sw e mapas de código', () => {
    const list = precacheList([
      'sw.js',
      'index.html',
      'assets/index-AbCdEf12.js',
      'assets/index-AbCdEf12.js.map',
      'assets/music/menu.mp3',
      'assets/maps/construto.bfmap',
      'bench/index.html',
      'licencas.txt',
    ]);
    expect(list).toEqual(['./', './assets/index-AbCdEf12.js', './assets/maps/construto.bfmap', './licencas.txt']);
  });

  it('só os nomes com hash do Vite contam como imutáveis', () => {
    expect(isHashedFile('./assets/scene-B3x_9kLq.js')).toBe(true);
    expect(isHashedFile('./assets/maps/construto.bfmap')).toBe(false);
    expect(isHashedFile('./assets/fonts/ui-fonts.png')).toBe(false);
  });

  it('a fonte gerada é JavaScript válido, com a versão, o prefixo e a mensagem da página', () => {
    const src = serviceWorkerSource('abc123', ['./', './assets/a-12345678.js']);
    expect(() => new Script(src)).not.toThrow();
    expect(src).toContain('"abc123"');
    expect(src).toContain('"boboforces-"');
    expect(src).toContain(JSON.stringify(APPLY_UPDATE_MESSAGE));
    expect(APPLY_UPDATE).toBe(APPLY_UPDATE_MESSAGE);
  });
});
