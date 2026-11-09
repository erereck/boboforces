import { join, resolve } from 'node:path';

/**
 * Caminhos do mapc (contrato do M1; frente "mapa-nav"). Fontes: um script TS por mapa em `assets-src/maps/`
 * (`construto.ts`) usando a API de `api.ts`. Saída: `assets-src/maps/generated/<id>.bfmap` (`map@1`). O mapc lê as
 * definições de bloco (`assets-src/blocks/generated/blocks.json`) e os modelos (`assets-src/models/generated/`) para
 * validar IDs, colisores e navegação, por isso roda DEPOIS de texgen, skingen e modelgen (`npm run assets`).
 */
export const ROOT = resolve(import.meta.dirname, '../../..');
export const MAPS_SOURCE_DIR = join(ROOT, 'assets-src', 'maps');
export const MAPS_OUT_DIR = join(MAPS_SOURCE_DIR, 'generated');
export const MAP_IDS = ['construto', 'ringue'] as const;
