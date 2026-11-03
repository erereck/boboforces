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
