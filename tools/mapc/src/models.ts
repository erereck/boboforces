import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeModelPack, MODEL_FLAG, type ModelCollider, type ModelLight } from '@boboforces/format';
import { ROOT } from './paths.ts';

/**
 * O que o `mapc` precisa dos modelos: caixas de colisão (texels, espaço do modelo, pivô na base), flags, luz e se
 * ocupa nós de navegação. A fonte da verdade é o `models/generated/modelos.bfmodel` da frente "skins-modelos"
 * (`npm run modelgen` roda antes). Enquanto ele é provisório (ou o decodificador ainda é stub), vale a tabela RESERVA
 * com medidas aproximadas, com aviso. Muda a validação e as fontes de luz do `.bfmap` (as posições vêm do modelo).
 */
export const MODELS_PACK = join(ROOT, 'assets-src', 'models', 'generated', 'modelos.bfmodel');

export interface PropModelInfo {
  readonly colliders: readonly ModelCollider[];
  readonly flags: number;
  readonly light: ModelLight | null;
  readonly blocksNav: boolean;
}

export interface ModelTable {
  readonly models: ReadonlyMap<string, PropModelInfo>;
  readonly source: 'modelos.bfmodel' | 'reserva';
  readonly warnings: readonly string[];
}

const F = MODEL_FLAG;
const COVER = F.blocksBullets | F.blocksSight;
const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): ModelCollider => ({
  min: [x0, y0, z0],
  max: [x1, y1, z1],
});

/** Medidas em texels (32 por metro), pivô no centro da base, frente para -Z. */
const RESERVE: Readonly<Record<string, PropModelInfo>> = {
  pistol: { colliders: [], flags: 0, light: null, blocksNav: false },
  rifle: { colliders: [], flags: 0, light: null, blocksNav: false },
  sniper: { colliders: [], flags: 0, light: null, blocksNav: false },
  // Barril de 0,6 × 0,9 m.
  barrel: {
    colliders: [box(-10, 0, -10, 10, 29, 10)],
    flags: COVER | F.walkable | F.blobShadow,
    light: null,
    blocksNav: true,
  },
  // Caixa d'água de 2,5 m de diâmetro sobre pés, 4 m no total.
  'water-tank': { colliders: [box(-40, 0, -40, 40, 128, 40)], flags: COVER, light: null, blocksNav: true },
  // Jipe de 1,8 × 1,6 × 3,6 m.
  jeep: { colliders: [box(-29, 0, -58, 29, 51, 58)], flags: COVER, light: null, blocksNav: true },
  // Holofote: poste de 3 m com a lâmpada no alto, virada para -Z.
  floodlight: {
    colliders: [box(-8, 0, -8, 8, 100, 8)],
    flags: F.blocksBullets | F.emissive,
    light: { position: [0, 96, -10], level: 14 },
    blocksNav: true,
  },
  // Cano deitado de 0,5 m de diâmetro e 4 m ao longo de X (dá para passar por cima: não ocupa nó).
  pipe: { colliders: [box(-64, 0, -8, 64, 16, 8)], flags: COVER | F.walkable, light: null, blocksNav: false },
  // Coluna cilíndrica de 0,8 m × 3 m.
  column: { colliders: [box(-13, 0, -13, 13, 96, 13)], flags: COVER, light: null, blocksNav: true },
  // Tenda de lona de 3 × 2 × 3 m.
  tarp: {
    colliders: [box(-48, 0, -48, 48, 64, 48)],
    flags: F.blocksSight | F.swaysInWind,
    light: null,
    blocksNav: true,
  },
  // Gerador de 1,2 × 1 × 0,8 m, com luz fraca de painel.
  generator: {
    colliders: [box(-19, 0, -13, 19, 32, 13)],
    flags: COVER | F.emissive | F.blobShadow,
    light: { position: [0, 28, -14], level: 6 },
    blocksNav: true,
  },
  // Árvore low-poly: só o tronco colide.
  tree: { colliders: [box(-8, 0, -8, 8, 96, 8)], flags: F.blocksBullets | F.swaysInWind, light: null, blocksNav: true },
  // Sacos de areia de 2 × 0,8 × 0,6 m (cobertura baixa).
  sandbags: { colliders: [box(-32, 0, -10, 32, 26, 10)], flags: COVER | F.walkable, light: null, blocksNav: true },
};

export function loadModelTable(path = MODELS_PACK): ModelTable {
  const warnings: string[] = [];
  if (existsSync(path)) {
    try {
      const pack = decodeModelPack(new Uint8Array(readFileSync(path)));
      const models = new Map<string, PropModelInfo>();
      for (const m of pack.models) {
        models.set(m.id, { colliders: m.colliders, flags: m.flags, light: m.light, blocksNav: m.blocksNav });
      }
      return { models, source: 'modelos.bfmodel', warnings };
    } catch (e) {
      warnings.push(
        `modelos.bfmodel ainda não é lido (${(e as Error).message}): colisores e luzes das props vieram da tabela ` +
          'reserva do mapc (rode "npm run assets" quando o modelgen gerar o pacote).',
      );
    }
  }
  return { models: new Map(Object.entries(RESERVE)), source: 'reserva', warnings };
}
