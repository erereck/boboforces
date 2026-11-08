import { join, resolve } from 'node:path';

/**
 * Caminhos do modelgen (contrato do M1; frente "skins-modelos"). Fontes em TS em `assets-src/models/` (listas de
 * caixas com UV em texels e primitivas low-poly paramétricas). Saídas em `assets-src/models/generated/`:
 * - `modelos.bfmodel`: pacote `model@1` com todos os modelos do M1 (`model:*` do registro de conteúdo);
 * - `modelos64-modelos.png` + `.mips.png` + `.json` (`layers@1`, array `modelos64`, source `modelgen`): as camadas de
 *   textura dos modelos, referenciadas por NOME nos `.bfmodel`.
 */
export const ROOT = resolve(import.meta.dirname, '../../..');
export const MODELS_SOURCE_DIR = join(ROOT, 'assets-src', 'models');
export const MODELS_OUT_DIR = join(MODELS_SOURCE_DIR, 'generated');
export const MODELGEN_OUTPUTS = {
  pack: 'modelos.bfmodel',
  layersPng: 'modelos64-modelos.png',
  layersMips: 'modelos64-modelos.mips.png',
  layersJson: 'modelos64-modelos.json',
} as const;
