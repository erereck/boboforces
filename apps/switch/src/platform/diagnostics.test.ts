import { describe, expect, it } from 'vitest';
import { createSwitchDiagnostics } from './diagnostics.ts';
import { createFakeSwitch } from './testing.ts';

const DIR = 'sdmc:/switch/boboforces';

function diagnosticsOn(gpu: boolean, rotateBytes?: number) {
  const fake = createFakeSwitch({ gpu });
  const diagnostics = createSwitchDiagnostics({
    fs: fake.nx.Switch,
    sw: fake.nx.Switch,
    dir: DIR,
    gl: fake.nx.screen.getContext('webgl2'),
    screen: fake.nx.screen,
    timestamp: () => '2026-11-02T12:00:00Z',
    ...(rotateBytes === undefined ? {} : { rotateBytes }),
  });
  return { fake, diagnostics };
}

describe('runtime.log', () => {
  it('acrescenta linhas com carimbo e indenta as quebras de linha (pilhas)', () => {
    const { fake, diagnostics } = diagnosticsOn(true);
    diagnostics.appendLog('boot');
    diagnostics.appendLog('ERRO x\n    at y');
    expect(fake.text(`${DIR}/runtime.log`)).toBe(
      '2026-11-02T12:00:00Z boot\n2026-11-02T12:00:00Z ERRO x\n      at y\n',
    );
  });

  it('roda o log para runtime.old.log ao passar do limite', () => {
    const { fake, diagnostics } = diagnosticsOn(true, 60);
    diagnostics.appendLog('primeira linha do log');
    diagnostics.appendLog('segunda linha do log');
    diagnostics.appendLog('terceira linha do log');
    expect(fake.text(`${DIR}/runtime.old.log`)).toContain('segunda');
    expect(fake.text(`${DIR}/runtime.log`)).toBe('2026-11-02T12:00:00Z terceira linha do log\n');
  });

  it('SD com problema: o log desiste em silêncio, sem quebrar o jogo', () => {
    const { fake, diagnostics } = diagnosticsOn(true);
    fake.nx.Switch.appendFileSync = () => {
      throw new Error('sem SD');
    };
    expect(() => diagnostics.appendLog('x')).not.toThrow();
  });
});

describe('relatório da plataforma', () => {
  it('com GPU: sistema, GPU e limites WebGL, sem nada pessoal', async () => {
    const report = await diagnosticsOn(true).diagnostics.collectReport();
    expect(report.platform).toBe('switch');
    expect(report.system).toBe('Horizon 20.0.0 · nx.js 1.0.0-beta.7 · Atmosphère 1.9.0');
    expect(report.gpu).toBe('NVIDIA Tegra X1 (falsa)');
    expect(report.glLimits).toEqual({ MAX_TEXTURE_SIZE: 16384 });
    expect(report.extra['modoAplicativo']).toBe('sim');
    expect(report.extra['modoOperacao']).toBe('dock');
    expect(report.storagePersisted).toBeNull();
  });

  it('sem GPU: GPU desconhecida e fora do modo aplicativo', async () => {
    const report = await diagnosticsOn(false).diagnostics.collectReport();
    expect(report.gpu).toBe('desconhecida');
    expect(report.glLimits).toEqual({});
    expect(report.extra['modoAplicativo']).toBe('não');
  });
});
