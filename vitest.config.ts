import { defineConfig } from 'vitest/config';

// Um projeto do Vitest por pacote/app/tool: cada pasta tem o seu `vitest.config.ts` (defineProject) com nome e
// ambiente. Para rodar só um: `npx vitest run --project sim` (o nome é o do pacote sem o escopo).
// Sem `passWithNoTests`: todo projeto tem pelo menos um teste (os stubs do M0 também), e o teste de workspaces do
// guard confere isso, para um glob que deixar de casar (teste renomeado para .spec.ts, pasta movida) não sumir calado.
export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*', 'tools/*'],
  },
});
