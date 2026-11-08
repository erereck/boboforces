import { resolve } from 'node:path';

/**
 * Raiz do repositório para o skingen, que virou só a prévia do pintor do boneco do FutBobo (#56, PLANO do porte §B19:
 * `figuras.ts` grava em `local/skins/`, privado). O gerador antigo (biblioteca `partes64` e folhas de rostos em
 * `assets-src/skins/generated/`) saiu no passo 5 do porte.
 */
export const ROOT = resolve(import.meta.dirname, '../../..');
