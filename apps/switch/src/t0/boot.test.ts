import { createFakeAudioContext } from '@boboforces/audio/testing';
import { describe, expect, it } from 'vitest';
import { createSwitchShell } from '../platform/index.ts';
import { createFakeSwitch } from '../platform/testing.ts';
import { readAutoBench } from './auto-bench.ts';
import { GL_PROBES_MARKER, runBootProbes, runLateProbes } from './boot.ts';
import { SWITCH_BENCH_PRESETS } from './items.ts';

const DIR = 'sdmc:/switch/boboforces';

describe('sondas do boot', () => {
  it('sem GPU (applet): item 1 informativo, GL pulado; as tardias rodam (bateria, Intl, DecompressionStream)', async () => {
    const fake = createFakeSwitch({ gpu: false, battery: { level: 0.2, charging: false } });
    const lines: string[] = [];
    const env = { nx: fake.nx, gl: null, log: (l: string) => lines.push(l), now: () => 0 };
    const probes = runBootProbes(env);
    expect(lines[0]).toContain('[t0] item=1 nome=webgl2 status=info modo_aplicativo=0 applet_tipo=2 webgl2=0');
    expect(lines.filter((l) => l.includes('motivo=sem_webgl2'))).toHaveLength(5);
    await runLateProbes(env, probes.t0);
    expect(lines).toContain('[t0] item=8 nome=fontface status=pulado motivo=applet');
    expect(lines).toContain(
      '[t0] item=20 nome=lifecycle status=info evento=boot modo=dock bateria=1 nivel=20 carregando=0',
    );
    expect(lines.at(-1)).toContain('[t0] item=21 nome=intl-decompression status=info intl=1');
  });

  it('com GPU, as sondas de GL rodam uma vez por build e modo (marca no SD)', () => {
    const fake = createFakeSwitch({ gpu: true });
    const gl = fake.nx.screen.getContext('webgl2');
    const lines: string[] = [];
    const env = {
      nx: fake.nx,
      gl,
      log: (l: string) => lines.push(l),
      now: () => 0,
      marker: { fs: fake.nx.Switch, dir: DIR, build: '0.0.1 abc' },
    };
    // O WebGL2 falso da casca é mínimo: as sondas falham por falta de métodos, mas sem derrubar o boot.
    runBootProbes(env);
    expect(lines.some((l) => l.startsWith('[t0] sondas de GL da casca em'))).toBe(true);
    expect(fake.text(`${DIR}/${GL_PROBES_MARKER}`)).toBe('0.0.1 abc dock\n');
    lines.length = 0;
    runBootProbes(env);
    expect(lines.filter((l) => l.includes('motivo=ja_medido_neste_build modo=dock'))).toHaveLength(5);
    // Outro modo (portátil) mede de novo.
    fake.setOperationMode(0);
    lines.length = 0;
    runBootProbes(env);
    expect(lines.some((l) => l.includes('ja_medido'))).toBe(false);
  });
});

describe('bench automático (bench.json no SD, uma abertura)', () => {
  it('preset, params com os nomes da URL, e o arquivo vira bench.usado.json', () => {
    const fake = createFakeSwitch({ files: { [`${DIR}/bench.json`]: '{"preset": "solo"}' } });
    const log: string[] = [];
    expect(readAutoBench(fake.nx.Switch, DIR, (l) => log.push(l))).toEqual(SWITCH_BENCH_PRESETS.solo);
    expect(fake.text(`${DIR}/bench.json`)).toBeNull();
    expect(fake.text(`${DIR}/bench.usado.json`)).toBe('{"preset": "solo"}');
    expect(readAutoBench(fake.nx.Switch, DIR, (l) => log.push(l))).toBeUndefined();
    fake.files.set(`${DIR}/bench.json`, new TextEncoder().encode('{"params": {"views": 1, "bots": 99, "view": "90"}}'));
    const config = readAutoBench(fake.nx.Switch, DIR, (l) => log.push(l));
    expect(config).toMatchObject({ views: 1, bots: 64, viewDistanceM: 90 });
    expect(log).toContain('[bench] aviso: bots limitado a 0..64');
    fake.files.set(`${DIR}/bench.json`, new TextEncoder().encode('{"preset": "nao-existe"}'));
    expect(readAutoBench(fake.nx.Switch, DIR, (l) => log.push(l))).toBeUndefined();
    expect(log.at(-1)).toBe('[bench] automático ignorado: preset desconhecido "nao-existe"');
  });

  it('chaves que saíram com as escolhas do M1 (contorno, densidade) só viram aviso, sem mudar o bench', () => {
    const json = '{"params": {"views": 1, "outline": "1", "density": "2"}}';
    const fake = createFakeSwitch({ files: { [`${DIR}/bench.json`]: json } });
    const log: string[] = [];
    expect(readAutoBench(fake.nx.Switch, DIR, (l) => log.push(l))).toMatchObject({ views: 1 });
    expect(log).toContain('[bench] aviso: parâmetro desconhecido: outline');
    expect(log).toContain('[bench] aviso: parâmetro desconhecido: density');
  });
});

describe('ciclo de vida: vão contado do pedido do frame', () => {
  it('o jogo que fica sem pedir frame esperando um carregamento não vira volta do HOME', () => {
    const fake = createFakeSwitch({ gpu: true });
    const shell = createSwitchShell({ nx: fake.nx, timestamp: () => 't' });
    let pauses = 0;
    shell.platform.lifecycle.onPause(() => pauses++);
    shell.platform.requestFrame(() => {});
    fake.frame(0);
    // 2 s sem pedir frame (carregando), depois pede e o frame vem logo.
    fake.advance(2000);
    shell.platform.requestFrame(() => {});
    fake.frame(2016);
    expect(pauses).toBe(0);
    // Com o frame já pedido, 2 s sem frame é HOME/sleep.
    shell.platform.requestFrame(() => {});
    fake.frame(4100);
    expect(pauses).toBe(1);
  });

  it('com áudio: vão em que o relógio do áudio andou é "JS ocupado" (sem pausa); áudio parado é HOME', () => {
    const audio = createFakeAudioContext();
    const fake = createFakeSwitch({ gpu: true, audioContext: audio });
    const shell = createSwitchShell({ nx: fake.nx, timestamp: () => 't' });
    let pauses = 0;
    shell.platform.lifecycle.onPause(() => pauses++);
    const frame = (now: number): void => {
      shell.platform.requestFrame(() => {});
      fake.frame(now);
    };
    frame(0);
    shell.platform.requestFrame(() => {});
    audio.currentTime = 1.9; // o áudio andou 1,9 s enquanto o JS travou 2 s
    fake.frame(2000);
    expect(pauses).toBe(0);
    frame(2016);
    shell.platform.requestFrame(() => {});
    fake.frame(5000); // áudio parado: app suspenso
    expect(pauses).toBe(1);
    const log = fake.text(`${DIR}/runtime.log`) ?? '';
    expect(log).toContain('[t0] item=20 nome=lifecycle status=info evento=js_ocupado vao_ms=2000 audio_ms=1900');
    expect(log).toMatch(/evento=volta_home_ou_sleep vao_ms=2984 audio_ms=0/);
  });
});
