import { checkStorageContract } from '@boboforces/platform-api/testing';
import { describe, expect, it } from 'vitest';
import { createSdStorage } from './storage.ts';
import { createFakeSwitch } from './testing.ts';

const DIR = 'sdmc:/switch/boboforces';
const PRIMARY = `${DIR}/save.json`;
const BACKUP = `${DIR}/save.backup.json`;

function storageOn(fake = createFakeSwitch()) {
  const problems: string[] = [];
  const storage = createSdStorage({
    fs: fake.nx.Switch,
    dir: DIR,
    setTimeout: fake.nx.setTimeout,
    clearTimeout: fake.nx.clearTimeout,
    onProblem: (m) => problems.push(m),
  });
  return { fake, storage, problems };
}

describe('save no SD', () => {
  it('grava com debounce de 250 ms e relê numa nova abertura', () => {
    const { fake, storage } = storageOn();
    storage.set('settings', '{"format":"boboforces/settings@1"}');
    storage.set('bots', '[]');
    fake.advance(249);
    expect(fake.files.has(PRIMARY)).toBe(false);
    fake.advance(250);
    expect(JSON.parse(fake.text(PRIMARY) ?? '')).toEqual({
      bots: '[]',
      settings: '{"format":"boboforces/settings@1"}',
    });
    const reopened = storageOn(fake).storage;
    expect(reopened.loadedFrom).toBe('primary');
    expect(reopened.get('bots')).toBe('[]');
    expect(reopened.keys().sort()).toEqual(['bots', 'settings']);
  });

  it('flush grava na hora e o save anterior vira backup', async () => {
    const { fake, storage } = storageOn();
    storage.set('a', '1');
    await storage.flush();
    storage.set('a', '2');
    storage.remove('nada');
    await storage.flush();
    expect(JSON.parse(fake.text(PRIMARY) ?? '')).toEqual({ a: '2' });
    expect(JSON.parse(fake.text(BACKUP) ?? '')).toEqual({ a: '1' });
  });

  it('save principal corrompido: abre pelo backup, avisa, e o corrompido nunca vira backup', () => {
    const fake = createFakeSwitch({ files: { [PRIMARY]: '{quebrado', [BACKUP]: '{"a":"1","n":2}' } });
    const { storage, problems } = storageOn(fake);
    expect(storage.loadedFrom).toBe('backup');
    expect(storage.get('a')).toBe('1');
    expect(storage.get('n')).toBeNull(); // só valores de texto
    expect(problems[0]).toContain('backup');
    storage.set('b', '2');
    storage.flushSync();
    expect(JSON.parse(fake.text(BACKUP) ?? '')).toEqual({ a: '1', n: 2 });
    expect(JSON.parse(fake.text(PRIMARY) ?? '')).toEqual({ a: '1', b: '2' });
  });

  it('cumpre o contrato do Storage (o mesmo teste da web), com o desfazer por chave sobrevivendo a reabrir', async () => {
    expect(await checkStorageContract(() => storageOn().storage)).toEqual([]);
    const { fake, storage } = storageOn();
    storage.set('a', '1');
    storage.set('b', '1');
    await storage.flush();
    storage.set('a', '2');
    await storage.flush();
    storage.set('b', '2');
    await storage.flush();
    // O save.backup.json é a gravação anterior inteira (recuperação); o desfazer de "a" continua no 1.
    expect(JSON.parse(fake.text(BACKUP) ?? '')).toEqual({ a: '2', b: '1' });
    const reopened = storageOn(fake).storage;
    expect(reopened.getBackup('a')).toBe('1');
    expect(reopened.getBackup('b')).toBe('1');
  });

  it('sem save começa vazio; falha de escrita vira aviso e não lança', () => {
    const fake = createFakeSwitch();
    const { storage, problems } = storageOn(fake);
    expect(storage.loadedFrom).toBe('none');
    fake.nx.Switch.writeFileSync = () => {
      throw new Error('SD cheio');
    };
    storage.set('a', '1');
    expect(() => storage.flushSync()).not.toThrow();
    expect(problems.join()).toContain('SD cheio');
  });
});

describe('cópia diária do save (M4, fase 2b)', () => {
  const DIR = 'sdmc:/switch/boboforces';
  const open = (fake: ReturnType<typeof createFakeSwitch>, today: string | null) =>
    createSdStorage({
      fs: fake.nx.Switch,
      dir: DIR,
      setTimeout: (cb, ms) => setTimeout(cb, ms),
      clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      onProblem: () => {},
      today: () => today,
    });

  it('a 1ª abertura do dia copia o save; ficam as 3 mais recentes; sem relógio ou sem save, nada', () => {
    const fake = createFakeSwitch({ files: { [`${DIR}/save.json`]: '{"a":"1"}' } });
    for (const day of ['2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16']) open(fake, day);
    const backups = [...fake.files.keys()].filter((k) => k.startsWith(`${DIR}/backup/`)).sort();
    expect(backups).toEqual([
      `${DIR}/backup/save-2026-11-14.json`,
      `${DIR}/backup/save-2026-11-15.json`,
      `${DIR}/backup/save-2026-11-16.json`,
    ]);
    expect(fake.text(`${DIR}/backup/save-2026-11-16.json`)).toBe('{"a":"1"}');
    // A 2ª abertura do mesmo dia não regrava (a cópia é a do começo do dia).
    fake.nx.Switch.writeFileSync(`${DIR}/save.json`, '{"a":"2"}');
    open(fake, '2026-11-16');
    expect(fake.text(`${DIR}/backup/save-2026-11-16.json`)).toBe('{"a":"1"}');
    const none = createFakeSwitch({ files: { [`${DIR}/save.json`]: '{"a":"1"}' } });
    open(none, null);
    open(createFakeSwitch(), '2026-11-16');
    expect([...none.files.keys()].some((k) => k.includes('/backup/'))).toBe(false);
  });
});
