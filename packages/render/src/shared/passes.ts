// Interface INTERNA entre as frentes "render-mundo" (dona do `renderer.ts`, do laço por vista e dos programas 1, 2, 3
// e 6) e "render-atores" (dona de `src/actors/**` e `src/fx/**`: programa 4 instanciado e programa 5 partículas).
// CONTRATO CONGELADO do M1: nenhuma das duas edita este arquivo; mudança vai em "Pedidos de contrato".
//
// Fluxo de um frame (render-mundo conduz):
//   setActors / submitFx / setEnvironment / setDebug guardam o estado (sem desenhar)
//   renderViews(views):
//     1. uniforms comuns do frame (`SharedUniforms`) ← ambiente
//     1b. (#56, porte do boneco) retângulo, câmera e frustum de TODAS as vistas, copiados em `frame.views` (olho,
//        planos e dono), para a animação escolher o LOD antes de qualquer vista
//     2. actorPass.update(frame) e fxPass.update(frame): animação, matrizes de instância, partículas, detritos —
//        UMA vez por frame (tecnico.md §6.8), nunca por vista
//     3. para cada vista i:
//        a. viewport + scissor; câmera e frustum já prontos do 1b; culling das regiões (render-mundo)
//        b. actorPass.beforeView(v) e fxPass.beforeView(v): culling dos grupos de props, quem esconder (1ª pessoa),
//           uniforms da vista — só uniforms e `visible`, nada de reenviar instâncias (sem contorno de time, #50)
//        c. three.render(scene, camera): céu, opacos de frente para trás, cutout, instanciados, translúcidos,
//           partículas (o three ordena; tudo na MESMA `scene`)
//        d. actorPass.afterView(v): viewmodel (limpa a profundidade no scissor e desenha com FOV próprio)
//        e. fxPass.afterView(v): clarão do viewmodel por cima
//        f. HUD da vista (`view.hud`) pelo passe de UI
//        g. estatísticas da vista (diferença do `three.info`)
//     4. `gl.finish()` se `debug.gpuFinish`
//
// Orçamento de programas (regra 8, ≤ 7): render-mundo 4 (opaco, cutout, translúcido, céu), render-atores 2
// (instanciado, partículas), UI 1. Variantes só por `#define` de criação (`PassContext.defines`). Todo material do
// mundo inclui os trechos de `glsl-common.ts` e usa os objetos de `SharedUniforms` (os mesmos em todos).
import type { FigureGameTable, FigureTemplateSet, ModelDocument } from '@boboforces/format';
import type { Disposable } from '@boboforces/shared';
import type { BlockRegistry, LightGrid, WorldGrid } from '@boboforces/world';
import type {
  Frustum,
  IUniform,
  PerspectiveCamera,
  Scene,
  Texture,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderer,
} from 'three';
import type { FigureLodStats } from '../actors/anim/types.ts';
import { NO_SLOT } from '../actors/layout.ts';
import type { FxQueue } from '../fx-queue.ts';
import type {
  ActorBuffer,
  ProjectileBuffer,
  RenderDebug,
  RenderMap,
  RenderTextures,
  TextureMode,
  VertexAttributeMode,
  ViewDesc,
} from '../types.ts';
import type { GlRect } from '../viewport.ts';

/** Os uniforms de `COMMON_UNIFORM_NAMES` (glsl-common.ts), um objeto `{ value }` só, dividido por todos os materiais. */
export interface SharedUniforms {
  readonly uSunDir: IUniform<Vector3>;
  readonly uSunColor: IUniform<Vector3>;
  readonly uSkyLightColor: IUniform<Vector3>;
  readonly uGroundColor: IUniform<Vector3>;
  readonly uEmissiveColor: IUniform<Vector3>;
  readonly uFogColor: IUniform<Vector3>;
  readonly uSunStrength: IUniform<number>;
  readonly uSkyStrength: IUniform<number>;
  readonly uFogNear: IUniform<number>;
  readonly uFogFar: IUniform<number>;
  readonly uTime: IUniform<number>;
  readonly uFlash: IUniform<number>;
  readonly uWind: IUniform<number>;
  readonly uGrayscale: IUniform<number>;
  readonly uGradeLut: IUniform<Texture | null>;
  readonly uGradeStrength: IUniform<number>;
}

/**
 * Texturas dos 2 arrays na GPU, criadas pela render-mundo (`setTextures`/`writeModelLayer`) e lidas pelos passes:
 * `DataArrayTexture` na rota array, `DataTexture` (atlas) na rota atlas. Os uniforms de atlas seguem
 * `TEXTURE_UNIFORM_NAMES` (glsl-common.ts). O filtro de minificação segue `RenderDebug.mipFilter` (M1: `off` = NEAREST
 * sem mip, `nearest` = NEAREST_MIPMAP_LINEAR, `linear` = LINEAR_MIPMAP_LINEAR; a render-mundo troca nas duas texturas).
 */
export interface SharedTextures {
  readonly blocks: IUniform<Texture | null>;
  readonly blocksAtlas: IUniform<Vector4>;
  readonly blocksAtlasSize: IUniform<Vector2>;
  readonly models: IUniform<Texture | null>;
  readonly modelsAtlas: IUniform<Vector4>;
  readonly modelsAtlasSize: IUniform<Vector2>;
  /**
   * Os dados na CPU (nomes de camada, info e a cadeia de mips COMPLETA de cada array em `data.levels`, os mesmos bytes
   * que subiram) para resolver a camada dos modelos pelo nome e ler o texel do acerto (cor dos cubinhos).
   * `writeModelLayer` também escreve aqui, em todos os níveis das camadas reservadas: o nível 1 de uma camada de skin é
   * a pintura de 16 px/m do quadrante (decisão #51). `null` antes do `setTextures`.
   */
  readonly assets: RenderTextures | null;
}

export interface PassContext {
  readonly three: WebGLRenderer;
  readonly textureMode: TextureMode;
  readonly vertexAttributes: VertexAttributeMode;
  /** `#define`s de criação para os materiais dos passes (`ATLAS`, `VERTEX_FLOAT` conforme as opções). */
  readonly defines: Readonly<Record<string, string>>;
  /** A cena principal: os passes põem os seus objetos aqui (uma vez) e a render-mundo desenha 1x por vista. */
  readonly scene: Scene;
  readonly uniforms: SharedUniforms;
  readonly textures: SharedTextures;
}

/**
 * As vistas do frame, prontas ANTES do `update` dos passes (#56: LOD e visibilidade da animação dos bonecos).
 * Pré-alocado pela render-mundo (nada se aloca por frame). A vista k daqui é a de `ViewContext.index` = k.
 */
export interface FrameViews {
  /** Vistas deste frame (0..4, a ordem de `renderViews`). */
  count: number;
  /** 4 × 3: posição da câmera da vista k em eye[k·3 ..] (m, mundo). */
  readonly eye: Float32Array;
  /**
   * 4 × 24: os 6 planos do frustum da vista k em planes[k·24 + p·4 ..] = (nx, ny, nz, d), na ordem e na convenção
   * do `Frustum` do three (dentro: n·x + d ≥ 0). Vista sem área (não desenhada): planos que rejeitam tudo.
   */
  readonly planes: Float32Array;
  /**
   * 4: slot local dono da vista, cujo corpo ela esconde (`ViewDesc.localSlot` em 1ª pessoa; a mesma regra do
   * `uHideSlot`); 255 (`NO_SLOT`) = câmera livre (espectador, câmera nomeada) ou 3ª pessoa, que mostra o próprio
   * corpo. É "quem a vista esconde", para a regra do L2 ("sem contar a vista do dono"): o alvo da 3ª pessoa conta
   * como visto e fica em L0 pela distância (a câmera fica a poucos metros dele, dentro do `figureNearM`).
   */
  readonly owner: Uint8Array;
}

/** Vistas por frame (tela dividida, tecnico.md §6.8); o `renderer-core.ts` exporta o mesmo número como `MAX_VIEWS`. */
export const FRAME_VIEWS_MAX = 4;
/** Floats por vista em `FrameViews.planes`: 6 planos × (nx, ny, nz, d). */
export const FRAME_VIEW_PLANE_FLOATS = 24;

/**
 * `FrameViews` vazio para FRAME_VIEWS_MAX vistas. Mora aqui, sem three (só tipos dele neste arquivo), para os testes da
 * animação (`actors/anim/**`, puro) e dos passes montarem o `FrameContext`; a render-mundo cria um por renderer.
 */
export function createFrameViews(): FrameViews {
  return {
    count: 0,
    eye: new Float32Array(FRAME_VIEWS_MAX * 3),
    planes: new Float32Array(FRAME_VIEWS_MAX * FRAME_VIEW_PLANE_FLOATS),
    owner: new Uint8Array(FRAME_VIEWS_MAX).fill(NO_SLOT),
  };
}

/** Estado do frame, montado pela render-mundo antes das vistas. */
export interface FrameContext {
  /** Segundos desde o frame anterior (limitado a 0,1) e relógio das animações. */
  readonly dt: number;
  readonly timeS: number;
  readonly debug: Readonly<RenderDebug>;
  /** Mapa atual (grade e registro para os detritos e o desmonte quicarem; grade de luz para props e detritos). */
  readonly world: { readonly grid: WorldGrid; readonly blocks: BlockRegistry; readonly lightGrid: LightGrid } | null;
  /** Câmeras e frustums de todas as vistas deste frame (#56). */
  readonly views: FrameViews;
}

/** Uma vista sendo desenhada. A câmera e o frustum já estão prontos; o viewport e o scissor já foram aplicados. */
export interface ViewContext {
  /** 0..3, na ordem de `renderViews`. */
  readonly index: number;
  readonly view: Readonly<ViewDesc>;
  readonly camera: PerspectiveCamera;
  readonly frustum: Frustum;
  /** Retângulo da vista no drawing buffer (origem embaixo, convenção do GL). */
  readonly rect: Readonly<GlRect>;
  readonly debug: Readonly<RenderDebug>;
}

/** Um passe que vive dentro do laço da render-mundo. */
export interface ScenePass extends Disposable {
  /** Programas que este passe compila (orçamento: atores 1, fx 1). */
  readonly programs: number;
  /** Uma vez por frame, antes de todas as vistas. */
  update(frame: FrameContext): void;
  /** Por vista, antes do render da cena principal: só culling, `visible` e uniforms da vista. */
  beforeView(view: ViewContext): void;
  /** Por vista, depois do render da cena principal (viewmodel, clarão do viewmodel). */
  afterView(view: ViewContext): void;
  /** Força a compilação dos programas do passe (o `warmup` da render-mundo chama antes do frame fora da tela). */
  warmup(): void;
}

/** Programa 4: bonecos (1 draw de caixas instanciadas), armas, props por grupo de 32 m, acessórios e viewmodel. */
export interface ActorPass extends ScenePass {
  setModels(models: readonly ModelDocument[] | null): void;
  /** Props (instâncias por modelo e grupo espacial) e luz delas; `null` libera. */
  setMap(map: RenderMap | null): void;
  /** Guarda a referência; as matrizes são escritas no `update`. */
  setActors(actors: ActorBuffer): void;
  /** M2: projéteis em voo (`null` = nenhum), desenhados nos conjuntos instanciados das armas. */
  setProjectiles(projectiles: ProjectileBuffer | null): void;
  /** Contadores da última vista (estatística por vista). */
  readonly lastViewActors: number;
  readonly lastViewPropGroups: number;
  /** #56: draw calls de corpo de bobo na última vista (`ViewStats.actorDraws`; a malha "bobos" é 1). */
  readonly lastViewActorDraws: number;
  /** #56: bonecos por nível de animação no último frame (`RenderStats.figureL0..L2`). */
  readonly figureLod: FigureLodStats;
  /** #56: bonecos fora da capacidade da malha no último frame (`RenderStats.figureOverflow`). */
  readonly figureOverflow: number;
  /** #56: gabaritos da partida e a tabela de jogo (`Renderer.setFigures`); `null` solta. */
  setFigures(templates: FigureTemplateSet | null, table: FigureGameTable | null): void;
  /** #56: faixa da pose completa e meia taxa do L1 (`Renderer.setFigureLod`). */
  setFigureLod(nearM: number, halfRate: boolean): void;
}

/** Programa 5 (partículas e quads) + cubinhos e desmonte no programa 4 (pool de detritos do perfil). */
export interface FxPass extends ScenePass {
  /** Copia os pedidos do frame (a fila é do `game` e é reaproveitada). */
  submit(queue: FxQueue): void;
  setMap(map: RenderMap | null): void;
  /** Teto de cubinhos vivos (perfil: 500 PC, 200 celular/Switch, 120 Switch 3–4P). */
  setDebrisBudget(maxDebris: number): void;
  /** #56: gabaritos da partida (o desmonte usa as caixas do boneco); `null` solta. */
  setFigures(templates: FigureTemplateSet | null): void;
}

export type ActorPassFactory = (ctx: PassContext) => ActorPass;
export type FxPassFactory = (ctx: PassContext) => FxPass;
