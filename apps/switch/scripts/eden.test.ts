import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sdmcFromConfig } from './eden.ts';
import { benchFileFromArgs, testConfig } from './prepare-eden.ts';
import { interestingLines, runFinished } from './run-eden.ts';

describe('Eden: SD virtual e config de teste', () => {
  it('lê o sdmc_directory personalizado e cai no padrão sem ele', () => {
    const ini = 'sdmc_directory\\default=false\nsdmc_directory=D:/Eden/sd\n';
    expect(sdmcFromConfig(ini, 'C:\\x\\eden')).toBe('D:\\Eden\\sd');
    expect(sdmcFromConfig('sdmc_directory\\default=true\nsdmc_directory=D:/y\n', 'C:\\x\\eden')).toBe(
      join('C:\\x\\eden', 'sdmc'),
    );
    expect(sdmcFromConfig(null, 'C:\\x\\eden')).toBe(join('C:\\x\\eden', 'sdmc'));
  });

  it('config de teste liga o teclado, desliga atualização e mapeia o A no C', () => {
    const src = [
      'keyboard_enabled\\default=true',
      'keyboard_enabled=false',
      'check_for_updates\\default=true',
      'check_for_updates=true',
      'player_0_button_a="engine:sdl,port:0"',
      'outra=1',
    ].join('\n');
    const out = testConfig(src);
    expect(out).toContain('keyboard_enabled=true');
    expect(out).toContain('check_for_updates=false');
    expect(out).toContain('player_0_button_a="engine:keyboard,code:67,toggle:0"');
    expect(out).toContain('outra=1');
  });

  it('bench automático pelos argumentos', () => {
    expect(benchFileFromArgs(['--bench', 'dock'])).toBe('{"preset":"dock"}\n');
    expect(benchFileFromArgs(['--bench-params', 'views=1&bots=24'])).toBe('{"params":{"views":"1","bots":"24"}}\n');
    expect(benchFileFromArgs([])).toBeNull();
  });
});

describe('Eden: leitura do runtime.log da rodada', () => {
  const log = [
    '2026-11-03T03:59:33.055Z boot BoboForces 0.0.1',
    '2026-11-03T03:59:33.145Z [t0] item=1 nome=webgl2 status=ok',
    '2026-11-03T03:59:35.000Z [boot] menu-ready 1741 ms',
    '2026-11-03T03:59:38.000Z [t0] item=21 nome=intl-decompression status=info',
    '2026-11-03T03:59:38.100Z [t0] item=19 nome=audio status=ok evento=sonda_boot mp3=4',
    '2026-11-03T04:09:38.000Z [bench] fim',
  ].join('\n');

  it('filtra [t0]/[bench]/[boot] sem o carimbo', () => {
    expect(interestingLines(log)).toEqual([
      '[t0] item=1 nome=webgl2 status=ok',
      '[boot] menu-ready 1741 ms',
      '[t0] item=21 nome=intl-decompression status=info',
      '[t0] item=19 nome=audio status=ok evento=sonda_boot mp3=4',
      '[bench] fim',
    ]);
  });

  it('termina com menu + sondas tardias (e o fim do bench quando pedido) ou na falha do boot', () => {
    expect(runFinished(log, false)).toBe(true);
    expect(runFinished(log, true)).toBe(true);
    expect(runFinished(log.replace('[bench] fim', ''), true)).toBe(false);
    expect(runFinished('x [t0] item=1 nome=webgl2 status=falha', false)).toBe(true);
    expect(runFinished('[boot] menu-ready 10 ms', false)).toBe(false);
    expect(runFinished(log.replace(/.*sonda_boot.*\n/, ''), false)).toBe(false);
  });
});
