// Contrato do render SEM importar three: o `game` (e o NullRenderer) dependem só deste arquivo, por tipo.
import type { Disposable } from '@boboforces/shared';
import type { DrawList, UiAtlasImage } from '@boboforces/ui';
import type { ChunkMesh } from '@boboforces/world';

export interface RendererOptions {
  /** MSAA nativo do navegador (PC); falso no celular e no Switch (tecnico.md §6.10). */
  readonly antialias?: boolean;
  /** Teto de DPR (PC 2, celular 1,5, Switch 1). */
  readonly maxPixelRatio?: number;
}

/** Texture array RGBA8 (`TEXTURE_2D_ARRAY`): `blocos16` (16×16) ou `modelos64` (64×64). */
export interface TextureArrayData {
  readonly width: number;
  readonly height: number;
  readonly layers: number;
  /** Nível 0 e mips seguintes (cada um com `layers` camadas RGBA8, camada após camada). Mínimo: o nível 0. */
  readonly levels: readonly Uint8Array[];
}

export interface RenderChunk {
  /** Coordenadas do chunk (em chunks). */
  readonly cx: number;
  readonly cy: number;
  readonly cz: number;
  readonly mesh: ChunkMesh;
}

/** Luz e céu da cena: dia, entardecer e noite são só uniforms (tecnico.md §6.4). Cores 0xRRGGBB. */
export interface SkyParams {
  /** Direção PARA o sol (unitária). */
  readonly sunDirX: number;
  readonly sunDirY: number;
  readonly sunDirZ: number;
  readonly sunColor: number;
  readonly skyColor: number;
  readonly emissiveColor: number;
  readonly fogColor: number;
}

export interface RenderWorld {
  readonly blockTextures: TextureArrayData;
  readonly chunks: readonly RenderChunk[];
  readonly sky: SkyParams;
}

/**
 * Atores (bobos, e no M1 armas/props instanciados) em SoA, preenchidos pelo `game` 1x por frame a partir da SimView
 * já interpolada. O render atualiza as matrizes de instância uma vez por frame, não por viewport (tecnico.md §6.6).
 */
export interface ActorBuffer {
  readonly capacity: number;
  count: number;
  /** 3 por ator: pés, em metros. */
  readonly position: Float32Array;
  readonly yaw: Float32Array;
  readonly pitch: Float32Array;
  /** Bits de `ACTOR_POSE`. */
  readonly pose: Uint8Array;
  /** Camada da skin em `modelos64`. */
  readonly skin: Uint16Array;
  /** Time 0..3 ou 255. */
  readonly team: Uint8Array;
  /** Modelo da arma na mão (índice), 255 = nenhuma. */
  readonly weapon: Uint8Array;
  /** Flash de dano 0..1. */
  readonly damageFlash: Float32Array;
  /** Slot local (0..3) dono do ator, para escondê-lo na viewport dele em 1ª pessoa; 255 = ninguém. */
  readonly localSlot: Uint8Array;
}

export const ACTOR_POSE = { crouch: 1, ads: 2, dead: 4, sprint: 8, airborne: 16 } as const;

export function createActorBuffer(capacity: number): ActorBuffer {
  return {
    capacity,
    count: 0,
    position: new Float32Array(capacity * 3),
    yaw: new Float32Array(capacity),
    pitch: new Float32Array(capacity),
    pose: new Uint8Array(capacity),
    skin: new Uint16Array(capacity),
    team: new Uint8Array(capacity),
    weapon: new Uint8Array(capacity),
    damageFlash: new Float32Array(capacity),
    localSlot: new Uint8Array(capacity),
  };
}

/** Câmera de uma viewport (convenção do shared: yaw 0 olha para -Z, pitch + para cima). */
export interface CameraDesc {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  /** FOV vertical em radianos (Hor+ com mínimo, tecnico.md §6.8). */
  fovY: number;
  near: number;
  /** Plano distante = min(visão da regra, teto do perfil). */
  far: number;
}

/**
 * Uma viewport (1 a 4 por frame, scissor no mesmo framebuffer). Retângulo em px do drawing buffer, origem no canto
 * SUPERIOR esquerdo (o render converte para o GL).
 */
export interface ViewDesc {
  x: number;
  y: number;
  width: number;
  height: number;
  readonly camera: CameraDesc;
  /** Slot local dono da viewport (esconde o próprio corpo em 1ª pessoa); -1 = espectador. */
  localSlot: number;
  thirdPerson: boolean;
}

export interface RenderStats {
  readonly drawCalls: number;
  readonly triangles: number;
  /** Programas de shader compilados (orçamento: ≤ 7, regra 8). */
  readonly programs: number;
  readonly viewports: number;
  readonly textures: number;
  readonly geometries: number;
}

export interface Renderer extends Disposable {
  /** Ajusta o drawing buffer (px reais). */
  resize(width: number, height: number, pixelRatio: number): void;
  /** Sobe malhas e texturas do mapa (no loading); `null` limpa e libera tudo (troca de mapa: regra 21). */
  setWorld(world: RenderWorld | null): void;
  setActors(actors: ActorBuffer): void;
  /** Desenha o mundo em 1 a 4 viewports. */
  renderViews(views: readonly ViewDesc[]): void;
  /** Desenha a UI por cima; `viewport` restringe ao retângulo de uma viewport (HUD), senão é a tela toda. */
  drawUi(list: DrawList, viewport?: ViewDesc): void;
  /**
   * Atlas da UI (fontes MSDF + páginas de sprites, `createUiAtlas` do `ui`). `null` libera e a UI passa a desenhar só
   * retângulos. Sem passe de UI (ou no NullRenderer) não faz nada.
   */
  setUiAtlas(atlas: UiAtlasImage | null): void;
  /** Estatísticas do último frame (painel F2). */
  readonly stats: RenderStats;
}
