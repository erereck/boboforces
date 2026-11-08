/**
 * `model@1` (`.bfmodel`): armas, props fora da grade, acessórios 3D e pickups (tecnico.md §6.6 e §15.2, arte-ux.md
 * §1.4 e §3.2). CONTRATO DO M1; codificador, decodificador e validador são da frente "skins-modelos".
 *
 * Unidades: TEXELS de 32 px/m (1 texel = 3,125 cm), a mesma densidade do cenário (decisão #6). Eixos do modelo: Y
 * para cima e a FRENTE para -Z (o cano da arma aponta para -Z; o jipe anda para -Z), igual à câmera.
 * Texturas: camadas de 64×64 do array `modelos64`, referenciadas por NOME (o índice é resolvido no loading pelo
 * manifesto de camadas, como nos blocos).
 *
 * Um arquivo `.bfmodel` é um PACOTE com 1..N documentos (o M1 tem um só, `models/modelos.bfmodel`, com tudo).
 */
export const MODEL_FORMAT = 'boboforces/model@1';
/** Bytes 0..3 depois do inflate: "BFMD" em little-endian. */
export const BFMODEL_MAGIC = 0x444d4642;
export const BFMODEL_VERSION = 1;
/** Versão 0 = arquivo PROVISÓRIO da etapa de contratos; o decodificador recusa com "rode npm run modelgen". */
export const BFMODEL_PLACEHOLDER_VERSION = 0;

export const MODEL_TEXELS_PER_METER = 32;
/** Teto de triângulos por modelo (arma até 600; props até 300; arte-ux.md §1.4 e §3.2). */
export const MAX_MODEL_TRIANGLES = 600;
export const MAX_MODEL_PARTS = 16;

export type ModelKind = 'weapon' | 'prop' | 'accessory' | 'pickup';

/** Soquetes de arma (identificadores em inglês; o validador reprova arma sem `hand_r`, `muzzle` e `sight`). */
export const WEAPON_SOCKETS = ['hand_r', 'hand_l', 'muzzle', 'mag', 'sight'] as const;
export type WeaponSocket = (typeof WEAPON_SOCKETS)[number];
export const REQUIRED_WEAPON_SOCKETS: readonly WeaponSocket[] = ['hand_r', 'muzzle', 'sight'];

/** Bits de `ModelDocument.flags`. */
export const MODEL_FLAG = {
  /** As caixas de colisão também param bala. */
  blocksBullets: 1 << 0,
  /** As caixas de colisão bloqueiam a visão dos bots (sim/parcial/não: `blocksSight` + `partialSight`). */
  blocksSight: 1 << 1,
  partialSight: 1 << 2,
  /** Dá para andar em cima (topo das caixas conta como chão). */
  walkable: 1 << 3,
  /** Usa a camada emissiva e ganha bloom falso (holofote, gerador ligado). */
  emissive: 1 << 4,
  /** Desenha sombra-blob no chão (props baixas e dinâmicas). */
  blobShadow: 1 << 5,
  /** Balança com o vento no vertex shader (árvore, lona). */
  swaysInWind: 1 << 6,
} as const;

/** Vetor em texels (pode ter meio texel: a camada externa é meio pixel maior por lado). */
export type TexelVec3 = readonly [x: number, y: number, z: number];

/**
 * Caixa texturizada à moda das skins: tamanho em texels e UV no layout em cruz (6 faces) a partir de `uv` na camada,
 * EXATAMENTE o `boxCrossRects(u, v, w, h, d)` de `bobo.ts` (com os eixos de `SKIN_FACE_AXES`): linha de cima = topo
 * (w×d) e base (w×d) a partir de u+d; linha de baixo = +X (d×h), frente −Z (w×h), −X (d×h) e trás +Z (w×h), a partir
 * de u e v+d. A cruz ocupa (2d + 2w) × (d + h) e precisa caber na camada de 64×64.
 */
export interface ModelBox {
  /** Canto mínimo, em texels, no espaço da peça (relativo ao pivô da peça). */
  readonly origin: TexelVec3;
  /** Tamanho em texels (inteiros ≥ 0; 0 = plano, ex.: lona). */
  readonly size: TexelVec3;
  /** Canto superior esquerdo da cruz de UV na camada, em texels (0..64). */
  readonly uv: readonly [u: number, v: number];
  /** Nome da camada em `modelos64`. */
  readonly layer: string;
  /** Inflar a caixa (texels por lado) sem mudar a UV: camada externa, ex.: 0,5. */
  readonly inflate: number;
  /** Espelha a UV em X (braço esquerdo, peça simétrica). */
  readonly mirror: boolean;
}

/**
 * Malha low-poly compacta (cilindros de 8/12 lados, árvore, lona): posições em texels (i16), normais em i8
 * normalizadas (×127), UV em texels da camada (u8, 0..64), triângulos u16. Uma camada por malha.
 * Convenções do `modelgen`: posições no espaço da PEÇA (relativas ao pivô, como a origem das caixas); triângulos
 * anti-horários vistos de fora (a face da frente do three) e normal chapada por face; superfície que se vê dos dois
 * lados (lona) vem com as faces duplicadas, então o material pode ficar só com a frente.
 */
export interface ModelMesh {
  readonly positions: Int16Array;
  readonly normals: Int8Array;
  readonly uvs: Uint8Array;
  readonly indices: Uint16Array;
  readonly layer: string;
}

/** Peça rígida animável (corpo, pente, ferrolho, luneta; ou o modelo inteiro numa prop). */
export interface ModelPart {
  /** Nome em inglês (`body`, `mag`, `bolt`, `scope`, `wheel_fl`…). */
  readonly name: string;
  /** Índice da peça mãe (-1 = raiz). Mãe sempre antes da filha. */
  readonly parent: number;
  /** Pivô no espaço da mãe (texels). */
  readonly pivot: TexelVec3;
  readonly boxes: readonly ModelBox[];
  readonly meshes: readonly ModelMesh[];
}

/** Ponto de encaixe: posição no espaço da peça e direção (unitária) para onde aponta. */
export interface ModelSocket {
  readonly name: string;
  readonly part: number;
  readonly position: TexelVec3;
  readonly direction: TexelVec3;
}

/** Caixa de colisão (texels, espaço do modelo inteiro, sem giro): a prop vira caixas alinhadas no mapa. */
export interface ModelCollider {
  readonly min: TexelVec3;
  readonly max: TexelVec3;
}

/** Fonte de luz da prop (entra no flood fill do emissivo pelo `.bfmap`). */
export interface ModelLight {
  /** Posição da fonte no espaço do modelo (texels). */
  readonly position: TexelVec3;
  /** Nível 1..15. */
  readonly level: number;
}

export interface ModelDocument {
  readonly format: typeof MODEL_FORMAT;
  /** ID local (`rifle` = `model:rifle`). */
  readonly id: string;
  readonly kind: ModelKind;
  /** Bits de `MODEL_FLAG`. */
  readonly flags: number;
  readonly parts: readonly ModelPart[];
  readonly sockets: readonly ModelSocket[];
  readonly colliders: readonly ModelCollider[];
  readonly light: ModelLight | null;
  /**
   * Cor sólida (0xRRGGBB) dos cubinhos quando o tiro acerta a prop (a CPU não amostra a malha da prop: usa esta, com
   * variação de ±1 tom no render).
   */
  readonly debrisColor: number;
  /** Ocupa nós de navegação (props baixas que dá para pular por cima não ocupam). */
  readonly blocksNav: boolean;
}

/** Conteúdo de um `.bfmodel`. */
export interface ModelPack {
  readonly models: readonly ModelDocument[];
}
