// CLI do guard: `npm run guard` (ou `node tools/guard/src/index.ts`) a partir de qualquer pasta.
// Lista `arquivo:linha:coluna [regra] mensagem` e sai com código 1 se houver violação.
// Exceção pontual e justificada: comentário `// guard-allow: <regra> <motivo>` na linha ou na linha de cima.
import { resolve } from 'node:path';
import { formatViolation, runGuard } from './guard.ts';

const root = resolve(import.meta.dirname, '..', '..', '..');
const result = runGuard(root);

for (const v of result.violations) console.log(formatViolation(v));
const extra = result.suppressed ? ` (${result.suppressed} exceção(ões) com guard-allow)` : '';
if (result.violations.length) {
  console.log(`\nguard: ${result.violations.length} violação(ões) em ${result.files} arquivos${extra}.`);
  console.log('Regras: docs/PORTABILIDADE.md. Exceção só com `// guard-allow: <regra> <motivo>`.');
  process.exit(1);
}
console.log(`guard: ok (${result.files} arquivos${extra}).`);
