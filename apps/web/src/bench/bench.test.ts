import { BENCH_DEFAULTS, type GameHandle } from '@boboforces/game';
import { describe, expect, it } from 'vitest';
import { createDebugHook } from '../debug-hook.ts';
import { rendererOptionsFor, urlAsksForBench } from './options.ts';
import {
  benchReportFileName,
  createBenchReportSink,
  installBenchReportShortcuts,
  type ReportDelivery,
  type ReportSinkEnv,
} from './report.ts';
import { createBenchShell } from './shell.ts';
import { benchParamsFromSearch, readBenchFromUrl } from './url.ts';

describe('bench pela URL', () => {
  it('sem `bench` abre o título normal', () => {
    expect(readBenchFromUrl('')).toBeNull();
    expect(readBenchFromUrl('?views=4&bots=12')).toBeNull();
  });

  it('só `?bench` dá o padrão (critério do Switch na dock)', () => {
    expect(readBenchFromUrl('?bench')).toEqual({ config: BENCH_DEFAULTS, warnings: [] });
    expect(readBenchFromUrl('bench')?.config).toEqual(BENCH_DEFAULTS);
  });

  it('nomes canônicos do contrato (BENCH_PARAMS)', () => {
    const parsed = readBenchFromUrl('?bench&views=2&bots=24&view=90&tod=dusk&duration=60&atlas=1&float=1&gpu=1&hz=30');
    expect(parsed?.warnings).toEqual([]);
    expect(parsed?.config).toMatchObject({
      views: 2,
      bots: 24,
      viewDistanceM: 90,
      timeOfDay: 'dusk',
      durationS: 60,
      textureMode: 'atlas',
      vertexAttributes: 'float',
      gpuFinish: true,
      simHz: 30,
    });
  });

  it('apelidos em pt-BR, com acento e maiúscula, e a hora do dia em português', () => {
    const parsed = readBenchFromUrl('?bench&vistas=4&bots=24&visao=50&hora=noite&dur=60&atlas=1&float=1');
    expect(parsed?.warnings).toEqual([]);
    expect(parsed?.config).toMatchObject({
      views: 4,
      bots: 24,
      viewDistanceM: 50,
      timeOfDay: 'night',
      durationS: 60,
      textureMode: 'atlas',
      vertexAttributes: 'float',
    });
    const accents = readBenchFromUrl(`?Bench&${encodeURIComponent('Visão')}=70&HORA=Entardecer&duração=30&zumbis=8`);
    expect(accents?.config).toMatchObject({ viewDistanceM: 70, timeOfDay: 'dusk', durationS: 30, zombies: 8 });
    expect(readBenchFromUrl('?bench&cena=vitrine&rota=bench:volta&semente=7&aquecimento=0')?.config).toMatchObject({
      scene: 'vitrine',
      route: 'bench:volta',
      views: 1,
      seed: 7,
      warmupS: 0,
    });
  });

  it('repetido vale o primeiro; desconhecido e fora da faixa viram aviso (sem lançar)', () => {
    const parsed = readBenchFromUrl('?bench&vistas=2&views=4&bots=999&foo=1&hora=madrugada');
    expect(parsed?.config.views).toBe(2);
    expect(parsed?.config.bots).toBe(64);
    expect(parsed?.config.timeOfDay).toBe('day');
    expect(parsed?.warnings).toContain('parâmetro repetido: views (vale o primeiro)');
    expect(parsed?.warnings).toContain('parâmetro desconhecido: foo');
    expect(parsed?.warnings.some((w) => w.startsWith('bots limitado'))).toBe(true);
    expect(parsed?.warnings).toContain('tod inválido: madrugada');
  });

  it('dicionário canônico para o parse do game', () => {
    expect(benchParamsFromSearch('?bench&vistas=3&visao=60')?.params).toEqual({ bench: '', views: '3', view: '60' });
  });

  it('o teste barato do chunk de entrada concorda com a leitura completa', () => {
    const cases = [
      '',
      '?',
      '?bench',
      'bench',
      '?BENCH=1',
      '?views=4&bench',
      '?bench&vistas=2',
      '?benchmark=1',
      '?xbench',
    ];
    for (const search of cases) expect(urlAsksForBench(search), search).toBe(readBenchFromUrl(search) !== null);
  });

  it('casca do bench: nula sem bench; com bench traz a configuração, os avisos e o relatório', async () => {
    expect(createBenchShell('?views=4', fakeEnv('ok'))).toBeNull();
    const shell = createBenchShell('?bench&vistas=1&foo=2', fakeEnv('ok'))!;
    expect(shell.config.views).toBe(1);
    expect(shell.warnings).toEqual(['parâmetro desconhecido: foo']);
    expect(await shell.report.receive('x')).toBe('copiado');
  });
});

describe('opções do renderer', () => {
  const surface = { antialias: true, maxPixelRatio: 2 };
  it('fora do bench só antialias e DPR da plataforma', () => {
    expect(rendererOptionsFor(surface, null)).toEqual({ antialias: true, maxPixelRatio: 2 });
  });
  it('no bench, as rotas do Teste Zero', () => {
    const config = readBenchFromUrl('?bench&atlas=1&float=1')!.config;
    expect(rendererOptionsFor(surface, config)).toEqual({
      antialias: true,
      maxPixelRatio: 2,
      textureMode: 'atlas',
      vertexAttributes: 'float',
    });
  });
});

interface FakeEnv extends ReportSinkEnv {
  readonly clipboard: string[];
  readonly saved: { name: string; data: string; mimeType: string }[];
  readonly lines: string[];
  readonly notified: ReportDelivery[];
}

function fakeEnv(clipboard: 'ok' | 'recusa' | 'sem', saveOk = true): FakeEnv {
  const copied: string[] = [];
  const saved: { name: string; data: string; mimeType: string }[] = [];
  const lines: string[] = [];
  const notified: ReportDelivery[] = [];
  return {
    clipboard: copied,
    saved,
    lines,
    notified,
    writeClipboard:
      clipboard === 'sem'
        ? null
        : (text) => {
            if (clipboard === 'recusa') return Promise.reject(new Error('NotAllowedError'));
            copied.push(text);
            return Promise.resolve();
          },
    save: (name, data, mimeType) => {
      saved.push({ name, data, mimeType });
      return Promise.resolve(saveOk);
    },
    log: (line) => lines.push(line),
    notify: (d) => notified.push(d),
    version: '0.0.1',
    now: () => new Date(2026, 10, 3, 0, 42, 7),
  };
}

const REPORT = 'BoboForces bench 1\nversao=0.0.1\nfim';

describe('relatório do bench', () => {
  it('nome do arquivo legível, com versão, data e hora local', () => {
    expect(benchReportFileName('0.0.1', new Date(2026, 10, 3, 0, 42))).toBe(
      'relatorio-bench-0.0.1-2026-11-03-0042.txt',
    );
    expect(benchReportFileName('1.0 beta/2', new Date(2027, 0, 9, 13, 5))).toBe(
      'relatorio-bench-1.0_beta_2-2027-01-09-1305.txt',
    );
  });

  it('copia sozinho quando o navegador deixa', async () => {
    const env = fakeEnv('ok');
    const sink = createBenchReportSink(env);
    expect(await sink.receive(REPORT)).toBe('copiado');
    expect(env.clipboard).toEqual([REPORT]);
    expect(sink.delivery).toBe('copiado');
    expect(sink.waitingGesture).toBe(false);
    expect(env.notified).toEqual(['copiado']);
    expect(env.lines.at(-1)).toBe('[bench] relatório copiado para a área de transferência');
  });

  it('sem gesto e recusado: espera o gesto; no gesto, recusado de novo, baixa o .txt', async () => {
    const env = fakeEnv('recusa');
    const sink = createBenchReportSink(env);
    expect(await sink.receive(REPORT)).toBeNull();
    expect(sink.waitingGesture).toBe(true);
    expect(env.saved).toEqual([]);
    expect(await sink.copy()).toBe('baixado');
    expect(env.saved).toEqual([
      { name: 'relatorio-bench-0.0.1-2026-11-03-0042.txt', data: REPORT, mimeType: 'text/plain;charset=utf-8' },
    ]);
    expect(sink.waitingGesture).toBe(false);
  });

  it('sem clipboard e sem download: falhou, sem lançar', async () => {
    const env = fakeEnv('sem', false);
    const sink = createBenchReportSink(env);
    expect(await sink.copy()).toBe('falhou');
    await sink.receive(REPORT);
    expect(await sink.copy()).toBe('falhou');
    expect(env.notified).toEqual(['falhou']);
  });

  it('atalhos: nada antes do relatório; C copia, B baixa, toque copia quando está esperando', async () => {
    const env = fakeEnv('recusa');
    const sink = createBenchReportSink(env);
    // Hosts falsos: o handler recebe objetos simples (o `target` de um Event do Node é só leitura).
    const host = () => {
      const listeners = new Map<string, (e: Event) => void>();
      return {
        addEventListener: (type: string, fn: EventListenerOrEventListenerObject | null) =>
          listeners.set(type, fn as (e: Event) => void),
        removeEventListener: (type: string) => listeners.delete(type),
        fire: (type: string, e: object) => listeners.get(type)?.(e as Event),
      };
    };
    const keys = host();
    const surface = host();
    const off = installBenchReportShortcuts(sink, keys, surface);
    const key = (code: string, extra: Record<string, unknown> = {}): void => keys.fire('keydown', { code, ...extra });
    const tap = (): void => surface.fire('pointerup', {});
    const tick = (): Promise<void> => new Promise((done) => setTimeout(done, 0));

    key('KeyC');
    await tick();
    expect(env.saved.length).toBe(0);

    await sink.receive(REPORT);
    tap();
    await tick();
    expect(env.saved.length).toBe(1); // o toque tentou copiar e caiu no download
    tap();
    await tick();
    expect(env.saved.length).toBe(1); // já não está esperando: o toque seguinte não faz nada

    key('KeyB');
    await tick();
    expect(env.saved.length).toBe(2);
    key('KeyC', { target: { tagName: 'INPUT' } });
    key('KeyC', { repeat: true });
    await tick();
    expect(env.saved.length).toBe(2);
    key('KeyC');
    await tick();
    expect(env.saved.length).toBe(3);

    off();
    key('KeyB');
    await tick();
    expect(env.saved.length).toBe(3);
  });
});

describe('gancho window.__bfDebug', () => {
  it('lê o jogo na hora: `print` acompanha `GameHandle.debug` e o relatório aparece quando chega', async () => {
    let debug: GameHandle['debug'] = null;
    const game = {
      screen: 'scene',
      paused: false,
      frames: 10,
      match: null,
      renderer: { stats: { programs: 6 } },
      get debug() {
        return debug;
      },
    } as unknown as GameHandle;
    const sink = createBenchReportSink(fakeEnv('ok'));
    const hook = createDebugHook({
      game,
      bench: BENCH_DEFAULTS,
      benchWarnings: ['parâmetro desconhecido: foo'],
      report: sink,
      memory: () => ({ usedHeapBytes: 1, heapLimitBytes: -1 }),
      recentLog: (n) => ['a', 'b', 'c'].slice(-n),
    });
    expect(hook.print).toBeNull();
    expect(hook.simTick).toBe(-1);
    expect(hook.stats.programs).toBe(6);
    debug = { readyForPrint: true } as unknown as NonNullable<GameHandle['debug']>;
    expect(hook.print?.readyForPrint).toBe(true);
    expect(hook.benchReport).toBeNull();
    await sink.receive(REPORT);
    expect(hook.benchReport).toBe(REPORT);
    expect(hook.benchDelivery).toBe('copiado');
    expect(hook.log(2)).toEqual(['b', 'c']);
    expect(hook.memory()?.usedHeapBytes).toBe(1);
  });
});
