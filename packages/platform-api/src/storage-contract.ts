import type { Storage } from './index.ts';

/**
 * Contrato do `Storage` que TODA plataforma cumpre, num teste só que as cascas rodam contra a sua implementação
 * (web: `localStorage`; Switch: JSON no SD). Sem vitest aqui: devolve a lista de quebras (vazia = ok), para o
 * pacote continuar puro. `create` abre um Storage novo e vazio.
 */
export async function checkStorageContract(create: () => Storage): Promise<string[]> {
  const problems: string[] = [];
  const expectValue = (what: string, got: unknown, want: unknown): void => {
    if (got !== want) problems.push(`${what}: veio ${JSON.stringify(got)}, esperado ${JSON.stringify(want)}`);
  };
  const s = create();

  expectValue('chave que não existe', s.get('a'), null);
  s.set('a', '1');
  expectValue('leitura antes do flush', s.get('a'), '1');
  expectValue('backup de chave nova', s.getBackup('a'), null);
  await s.flush();
  expectValue('backup depois da 1ª gravação', s.getBackup('a'), null);

  s.set('a', '2');
  await s.flush();
  expectValue('backup depois de mudar', s.getBackup('a'), '1');

  s.set('b', 'x');
  await s.flush();
  expectValue('outra chave mudou: o backup de "a" fica', s.getBackup('a'), '1');

  s.set('a', '2');
  await s.flush();
  expectValue('gravar o mesmo valor não mexe no backup', s.getBackup('a'), '1');

  s.set('a', '3');
  await s.flush();
  expectValue('o backup acompanha a última mudança', s.getBackup('a'), '2');

  s.remove('a');
  await s.flush();
  expectValue('chave removida', s.get('a'), null);
  expectValue('backup de chave removida', s.getBackup('a'), null);
  expectValue('chaves', [...s.keys()].sort().join(','), 'b');
  return problems;
}
