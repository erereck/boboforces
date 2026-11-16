import { describe, expect, it } from 'vitest';
import { BATTERY_REFRESH_MS, createBatteryReader } from './battery.ts';

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('bateria (M4, fase 3)', () => {
  it('guarda a última leitura e pede outra a cada 30 s', async () => {
    let clock = 0;
    let calls = 0;
    let level = 0.64;
    const reader = createBatteryReader(
      () => {
        calls++;
        return Promise.resolve({ level, charging: false });
      },
      () => clock,
    );
    expect(reader.read()).toBeNull();
    await flush();
    expect(reader.read()).toEqual({ level: 0.64, charging: false });
    expect(calls).toBe(1);
    level = 0.18;
    clock += BATTERY_REFRESH_MS - 1;
    reader.read();
    expect(calls).toBe(1);
    clock += 1;
    expect(reader.read()).toEqual({ level: 0.64, charging: false });
    await flush();
    expect(calls).toBe(2);
    expect(reader.read()).toEqual({ level: 0.18, charging: false });
  });

  it('sem getBattery ou com erro (Eden), devolve null e para de perguntar', async () => {
    expect(createBatteryReader(undefined, () => 0).read()).toBeNull();
    let clock = 0;
    let calls = 0;
    const lines: string[] = [];
    const reader = createBatteryReader(
      () => {
        calls++;
        return Promise.reject(new Error('psm'));
      },
      () => clock,
      (l) => lines.push(l),
    );
    await flush();
    clock += BATTERY_REFRESH_MS * 3;
    expect(reader.read()).toBeNull();
    await flush();
    expect(calls).toBe(1);
    expect(lines).toEqual(['bateria: sem leitura (psm); a pausa fica sem ela']);
  });

  it('ler o nível lança (Eden: sem o serviço psm): falha tratada, sem promessa rejeitada solta', async () => {
    const lines: string[] = [];
    const manager = {
      get level(): number {
        throw new Error('psmGetRawBatteryChargePercentage failed');
      },
      charging: false,
    };
    const reader = createBatteryReader(
      () => Promise.resolve(manager),
      () => 0,
      (l) => lines.push(l),
    );
    await flush();
    expect(reader.read()).toBeNull();
    expect(lines).toEqual(['bateria: sem leitura (psmGetRawBatteryChargePercentage failed); a pausa fica sem ela']);
  });

  it('nível fora de 0–1 vira null', async () => {
    const reader = createBatteryReader(
      () => Promise.resolve({ level: Number.NaN, charging: true }),
      () => 0,
    );
    await flush();
    expect(reader.read()).toBeNull();
  });
});
