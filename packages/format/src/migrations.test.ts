import { describe, expect, it } from 'vitest';
import { MIGRATIONS, migrateDocument, type Migration } from './migrations.ts';

function codes(r: ReturnType<typeof migrateDocument>): string[] {
  return r.ok ? r.warnings.map((w) => w.code) : r.errors.map((e) => e.code);
}

describe('migrateDocument', () => {
  it('nenhuma migração no M0', () => {
    expect(Object.keys(MIGRATIONS)).toEqual([]);
  });

  it('documento na versão atual volta igual, sem cópia e sem aviso', () => {
    const doc = { format: 'boboforces/preset@1', mode: 'warfare.tdm' };
    const r = migrateDocument(doc, 'preset');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toBe(doc);
      expect(r.warnings).toEqual([]);
    }
  });

  it('recusa o que não é documento', () => {
    expect(codes(migrateDocument(null, 'preset'))).toEqual(['doc.notObject']);
    expect(codes(migrateDocument([], 'preset'))).toEqual(['doc.notObject']);
    expect(codes(migrateDocument('x', 'preset'))).toEqual(['doc.notObject']);
  });

  it('recusa format ausente, inválido ou de outro tipo', () => {
    expect(codes(migrateDocument({}, 'preset'))).toEqual(['format.missing']);
    expect(codes(migrateDocument({ format: 'novelo/1' }, 'preset'))).toEqual(['format.invalid']);
    expect(codes(migrateDocument({ format: 'boboforces/preset@0' }, 'preset'))).toEqual(['format.invalid']);
    expect(codes(migrateDocument({ format: 'boboforces/bot@1' }, 'preset'))).toEqual(['format.wrongKind']);
  });

  it('recusa versão maior que a conhecida com código próprio', () => {
    const r = migrateDocument({ format: 'boboforces/bot@2', id: 'x' }, 'bot');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]!.code).toBe('format.newerVersion');
      expect(r.errors[0]!.path).toBe('format');
    }
  });

  it('aplica a cadeia de migrações em ordem, mantendo campos desconhecidos e sem mexer na entrada', () => {
    // Cadeia sintética: @1 renomeia `bots` → `teams`; @2 acrescenta `seed`.
    const chain: Migration[] = [
      (d) => {
        d['teams'] = d['bots'];
        delete d['bots'];
        return d;
      },
      (d) => ({ ...d, seed: 7 }),
    ];
    const input = { format: 'boboforces/preset@1', bots: [{ n: 1 }], extra: { keep: true } };
    const r = migrateDocument(input, 'preset', { migrations: { preset: chain }, currentVersion: 3 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({ format: 'boboforces/preset@3', teams: [{ n: 1 }], extra: { keep: true }, seed: 7 });
    expect(r.warnings.map((w) => w.code)).toEqual(['format.migrated']);
    expect(input).toEqual({ format: 'boboforces/preset@1', bots: [{ n: 1 }], extra: { keep: true } });
    // Começando do meio da cadeia, só os passos que faltam rodam.
    const mid = migrateDocument({ format: 'boboforces/preset@2', teams: [] }, 'preset', {
      migrations: { preset: chain },
      currentVersion: 3,
    });
    expect(mid.ok && mid.value).toEqual({ format: 'boboforces/preset@3', teams: [], seed: 7 });
  });

  it('passo faltando ou migração que lança viram erro, nunca exceção', () => {
    const missing = migrateDocument({ format: 'boboforces/bot@1' }, 'bot', { migrations: {}, currentVersion: 2 });
    expect(codes(missing)).toEqual(['format.migrationMissing']);
    const boom: Migration = () => {
      throw new Error('quebrou');
    };
    const failed = migrateDocument({ format: 'boboforces/bot@1' }, 'bot', {
      migrations: { bot: [boom] },
      currentVersion: 2,
    });
    expect(codes(failed)).toEqual(['format.migrationFailed']);
  });
});
