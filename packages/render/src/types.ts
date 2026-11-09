// Contrato do render SEM importar three: o `game` (e o NullRenderer) dependem só deste arquivo, por tipo.
// M0: atores, viewports e DrawList. M1 (contrato da etapa de contratos; o caminho do M0 por chunk saiu na integração):
// texturas em 2 arrays com mips, mapa por regiões + grade de luz + props, modelos, atores (o boneco do FutBobo, #56),
// VFX, ambiente por uniforms, viewmodel e HUD por vista, chaves de depuração do Teste Zero e dos prints, estatísticas
// por vista.
import {
  PLAYABLE_PROP_DOSE_VIEW,
  type FigureGameTable,
  type FigureTemplateSet,
  type ModelDocument,
  type PropDoseView,
  type TextureArrayName,
} from '@boboforces/format';
import type { Disposable } from '@boboforces/shared';
import type { DrawList, UiAtlasImage } from '@boboforces/ui';
import type { BlockRegistry, LightGrid, RegionMesh, WorldGrid } from '@boboforces/world';
import type { EnvironmentState } from './environment.ts';
import type { FxQueue } from './fx-queue.ts';

/** Rota das texturas do cenário e dos modelos: `TEXTURE_2D_ARRAY` (padrão) ou atlas com padding (plano B do T0). */
export type TextureMode = 'array' | 'atlas';
/** Leitura do vértice compacto: inteiros (`vertexAttribIPointer`) ou float decodificado no shader (item 5 do T0). */
export type VertexAttributeMode = 'int' | 'float';

export interface RendererOptions {
  /** MSAA nativo do navegador (PC); falso no celular e no Switch (tecnico.md §6.10). */
  readonly antialias?: boolean;
  /** Teto de DPR (PC 2, celular 1,5, Switch 1). */
  readonly maxPixelRatio?: number;
  /**
   * M1: rota das texturas (padrão `array`). Fixa na criação: muda os programas (`#define ATLAS` nos mesmos 7). O
   * bench liga `atlas` para um único Teste Zero medir as duas rotas.
   */
  readonly textureMode?: TextureMode;
  /** M1: leitura dos atributos do vértice compacto (padrão `int`). Fixa na criação (`#define VERTEX_FLOAT`). */
  readonly vertexAttributes?: VertexAttributeMode;
  /** M1: teto de cubinhos de detrito vivos do perfil (`PlatformProfile.maxDebris`; padrão 200). */
  readonly maxDebris?: number;
}

/** Texture array RGBA8 (`TEXTURE_2D_ARRAY`): `blocos16` (16×16) ou `modelos64` (64×64). */
export interface TextureArrayData {
  readonly width: number;
  readonly height: number;
  readonly layers: number;
  /** Nível 0 e mips seguintes (cada um com `layers` camadas RGBA8, camada após camada). Mínimo: o nível 0. */
  readonly levels: readonly Uint8Array[];
}

/** Informação de uma camada (do manifesto `layers@1`), na ordem do array montado. */
export interface TextureLayerInfo {
  readonly name: string;
  readonly kind: 'opaque' | 'cutout' | 'translucent' | 'emissive';
  readonly frames: number;
  readonly cutout: boolean;
}

/**
 * M1: um array montado pelo runtime (`assembleTextureArray`): as tiras de cada ferramenta concatenadas na ordem do
 * `runtime-assets.json`, mais as camadas reservadas (skins compostas, no fim do `modelos64`).
 */
export interface AssembledTextureArray {
  readonly name: TextureArrayName;
  readonly data: TextureArrayData;
  /** Nome → índice da camada (as camadas reservadas não têm nome). */
  readonly layers: ReadonlyMap<string, number>;
  readonly info: readonly TextureLayerInfo[];
  /** Primeira camada reservada e quantas (0 no `blocos16`). */
  readonly reservedStart: number;
  readonly reservedCount: number;
}

/** M1: as texturas do jogo, sobem uma vez no loading (`Renderer.setTextures`). */
export interface RenderTextures {
  readonly blocks: AssembledTextureArray;
  readonly models: AssembledTextureArray;
}

/** M1: uma região de render (2×2×1 chunks) com as até 3 malhas do mesher do world. */
export interface RenderRegion {
  readonly mesh: RegionMesh;
}

/**
 * M1: uma prop fora da grade já resolvida pelo `game` a partir do `.bfmap`: índice do modelo na lista de
 * `setModels`, posição em metros, giro em radianos, escala uniforme e a dose (print 3). A luz a prop amostra sozinha
 * da grade de luz no `setMap` (render-atores).
 */
export interface RenderProp {
  readonly model: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly scale: number;
  /**
   * Marca de autoria do print 3 (`PROP_DOSE` do format: 0 sempre, 1 proposta, 2 dobro). No jogo todas valem (#52); a
   * marca só serve à chave visual `RenderDebug.propDose`.
   */
  readonly dose: number;
}

/**
 * M1: o mapa pronto para o render (montado no loading pelo `game`): regiões, grade de luz de 2 m, props e tamanho.
 * Camada de cada face já resolvida pelo nome; `blockFaceLayers` é para a cor do cubinho no acerto (render-atores lê o
 * texel da camada no ponto).
 */
export interface RenderMap {
  /** Tamanho da grade em células de 0,5 m. */
  readonly sizeX: number;
  readonly sizeY: number;
  readonly sizeZ: number;
  readonly regions: readonly RenderRegion[];
  readonly lightGrid: LightGrid;
  /** Grade e registro (por referência) para os detritos e o desmonte quicarem contra o cenário. */
  readonly grid: WorldGrid;
  readonly blocks: BlockRegistry;
  readonly props: readonly RenderProp[];
  /** Por id local de bloco: 6 camadas (ordem de `FACE`), `blockFaceLayers[id · 6 + face]`. */
  readonly blockFaceLayers: Uint8Array;
}

/**
 * Atores (bobos, zumbis, manequins) em SoA, preenchidos pelo `game` 1x por frame a partir da SimView já interpolada.
 * O render atualiza as matrizes de instância uma vez por frame, não por viewport (tecnico.md §6.6).
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
  /**
   * PRIMEIRA camada da skin em `modelos64` (pintada no loading, `writeModelLayer`): a skin do boneco ocupa
   * `FIGURE_SKIN_LAYERS` (2) camadas seguidas, e cada caixa do gabarito diz qual das duas lê.
   */
  readonly skin: Uint16Array;
  /** Time 0..3 ou 255. */
  readonly team: Uint8Array;
  /** Modelo da arma na mão: índice na lista de `setModels` (M1) ou 255 = nenhuma. */
  readonly weapon: Uint8Array;
  /** Flash de dano 0..1. */
  readonly damageFlash: Float32Array;
  /** Slot local (0..3) dono do ator, para escondê-lo na viewport dele em 1ª pessoa; 255 = ninguém. */
  readonly localSlot: Uint8Array;
  // --- M1 ---
  /** EntityId da sim (0 = manequim): o render guarda estado por entidade (transições de pose, nascer). */
  readonly entity: Uint32Array;
  /** `ACTOR_KIND`. */
  readonly kind: Uint8Array;
  /** Escala uniforme (zumbis Chonker 1,3, Mega 1,8; o pixel continua quadrado). */
  readonly scale: Float32Array;
  /** 3 por ator: céu, sol, emissivo em 0..1, de `sampleLightGrid` no centro do corpo. */
  readonly light: Float32Array;
  /** Progresso da recarga 0..1 (0 = não recarregando) e coice da arma 0..1. */
  readonly reload: Float32Array;
  readonly recoil: Float32Array;
  // --- Boneco do FutBobo (#56, PLANO do porte §C6; o rosto em folha e o passo do bobo A saíram no passo 5) ---
  /** Gabarito em `setFigures`; 255 = não desenha (o padrão de `createActorBuffer`). */
  readonly figure: Uint8Array;
  /** Postura de `figurePostureOf` (a mesma que a sim usa na hitbox). */
  readonly posture: Uint8Array;
  /** Expressão 0..7 (`FACE_EXPRESSION`); a piscada é do render. */
  readonly expression: Uint8Array;
  /** 3 por ator, m/s, da SimView (manequim: 0). */
  readonly velocity: Float32Array;
}

/** `ActorBuffer.figure` sem gabarito: o ator não é desenhado como boneco. */
export const NO_FIGURE = 255;

export const ACTOR_POSE = {
  crouch: 1,
  ads: 2,
  dead: 4,
  sprint: 8,
  airborne: 16,
  /** M1: atirou neste frame (clarão na arma de 3ª pessoa). */
  firing: 32,
  /** M1: acabou de nascer (os ossos caem e se encaixam em 0,4 s, no rig). */
  spawning: 64,
  /** M1: deslizando. */
  sliding: 128,
} as const;

/** M1: tipo de ator (pose e skin). */
export const ACTOR_KIND = { bobo: 0, zombie: 1, mannequin: 2 } as const;

/** Arma "nenhuma" em `ActorBuffer.weapon` e `ViewmodelDesc.model`. */
export const NO_MODEL = 255;

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
    entity: new Uint32Array(capacity),
    kind: new Uint8Array(capacity),
    scale: new Float32Array(capacity).fill(1),
    light: new Float32Array(capacity * 3).fill(1),
    reload: new Float32Array(capacity),
    recoil: new Float32Array(capacity),
    figure: new Uint8Array(capacity).fill(NO_FIGURE),
    posture: new Uint8Array(capacity),
    expression: new Uint8Array(capacity),
    velocity: new Float32Array(capacity * 3),
  };
}

/**
 * M2 (fase 1c): projéteis em voo (foguete, granada), desenhados com o MESMO conjunto instanciado das armas do modelo
 * (programa 4, sem programa novo). Fase 2b: os pickups no chão (a caixinha de munição, modelo `pickup`) vão no mesmo
 * buffer, depois dos projéteis. O `game` preenche a cada frame a partir de `SimView.projectiles` (posição
 * interpolada, orientação pela velocidade, giro da granada). Modelos de `setModels` (`NO_MODEL` = não desenha).
 * Origem do modelo no centro do projétil; a frente (−Z do modelo) vai para `yaw`/`pitch`, e `roll` gira em volta dela.
 */
export interface ProjectileBuffer {
  readonly capacity: number;
  count: number;
  readonly model: Uint8Array;
  /** 3 por projétil (m). */
  readonly position: Float32Array;
  readonly yaw: Float32Array;
  readonly pitch: Float32Array;
  readonly roll: Float32Array;
  /** Luz amostrada da grade (céu, sol, emissivo), 3 por projétil. */
  readonly light: Float32Array;
}

export function createProjectileBuffer(capacity: number): ProjectileBuffer {
  return {
    capacity,
    count: 0,
    model: new Uint8Array(capacity).fill(NO_MODEL),
    position: new Float32Array(capacity * 3),
    yaw: new Float32Array(capacity),
    pitch: new Float32Array(capacity),
    roll: new Float32Array(capacity),
    light: new Float32Array(capacity * 3).fill(1),
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
  /** Plano distante = min(visão da regra, teto do perfil). A fog termina aqui. */
  far: number;
}

/**
 * M1: arma e braços em 1ª pessoa (tecnico.md §6.7, arte-ux.md §3.3), desenhados depois do mundo com a profundidade
 * limpa no scissor da vista e FOV próprio. Mesmo modelo da 3ª pessoa. Os deslocamentos de mola (sway, coice, ADS) o
 * `game` calcula (são do jogador, não do render).
 */
export interface ViewmodelDesc {
  visible: boolean;
  /** Índice do modelo da arma (lista de `setModels`) ou `NO_MODEL`. */
  model: number;
  /** FOV vertical do viewmodel em radianos (padrão 60°, ajuste de 50° a 80°). */
  fovY: number;
  /** Deslocamento da arma no espaço da câmera (m) e giro extra (rad): sway, balanço do passo, coice, ADS. */
  offsetX: number;
  offsetY: number;
  offsetZ: number;
  pitch: number;
  yaw: number;
  roll: number;
  /** Primeira camada da skin do dono (luvas e mangas na cor do time) em `modelos64`, como `ActorBuffer.skin`. */
  skin: number;
  /** Luz amostrada no olho (céu, sol, emissivo 0..1). */
  lightSky: number;
  lightSun: number;
  lightEmissive: number;
  /** Escala da arma na tela: 1 em tela cheia; menor no 3–4P (no máximo 25% da vista). */
  scale: number;
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
  /** Slot local dono da viewport (esconde o próprio corpo em 1ª pessoa); -1 = espectador ou câmera nomeada. */
  localSlot: number;
  thirdPerson: boolean;
  // --- M1 ---
  /** Time de quem olha (0..3; 255 = espectador): aliado ou inimigo do ponto de vista desta vista. */
  team: number;
  readonly viewmodel: ViewmodelDesc;
  /**
   * HUD desta vista, desenhada no fim do laço da vista pelo passe de UI (mesma regra de coordenadas de
   * `drawUi(list, view)`: px da superfície relativos ao canto da vista). `null` = sem HUD (prints).
   */
  hud: DrawList | null;
  /**
   * Clarão de tiro na luz ambiente SÓ desta vista, 0..1 (arte-ux.md §1.8: sobe na viewport que vê o evento a até
   * 30 m; verificação do M1). Soma com o `EnvironmentState.flash` global, que fica para efeito de tela inteira.
   */
  flash: number;
}

export function createViewmodelDesc(): ViewmodelDesc {
  return {
    visible: false,
    model: NO_MODEL,
    fovY: (60 * Math.PI) / 180,
    offsetX: 0,
    offsetY: 0,
    offsetZ: 0,
    pitch: 0,
    yaw: 0,
    roll: 0,
    skin: 0,
    lightSky: 1,
    lightSun: 1,
    lightEmissive: 0,
    scale: 1,
  };
}

/** Uma vista com tudo zerado (o `game` preenche por frame; criar no loading, nunca no laço). */
export function createViewDesc(): ViewDesc {
  return {
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    camera: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, fovY: 1, near: 0.05, far: 90 },
    localSlot: -1,
    thirdPerson: false,
    team: 255,
    viewmodel: createViewmodelDesc(),
    hud: null,
    flash: 0,
  };
}

/**
 * M1: chaves de depuração do Teste Zero e dos prints (runtime; `textureMode` e `vertexAttributes` são de criação,
 * em `RendererOptions`). Tudo por uniform ou por visibilidade: nenhuma chave cria programa novo.
 */
export interface RenderDebug {
  /** Tudo em escala de cinza no fim do shader (print de leitura). Sem contorno de time (decisão #50). */
  grayscale: boolean;
  /**
   * Filtro de minificação dos arrays: `off` = NEAREST puro, sem mip; `nearest` = NEAREST_MIPMAP_LINEAR (padrão,
   * decisão #50); `linear` = LINEAR_MIPMAP_LINEAR.
   */
  mipFilter: MipFilterMode;
  /**
   * Dose de props VISÍVEL. Chave só visual de depuração (A/B de custo no bench): a colisão, a bala, a navegação e a luz
   * usam sempre as props do jogo (`PLAYABLE_PROP_DOSE`, decisão #52). Padrão = `PLAYABLE_PROP_DOSE_VIEW`; abaixo dele
   * o render esconde props que continuam colidindo.
   */
  propDose: PropDoseView;
  /** Esconde o viewmodel (prints de câmera nomeada). */
  hideViewmodel: boolean;
  /** `gl.finish()` no fim do frame para medir GPU (item 10 do T0; custa desempenho, só no bench). */
  gpuFinish: boolean;
}

/** Filtro de minificação dos texture arrays (`RenderDebug.mipFilter`). */
export type MipFilterMode = 'off' | 'nearest' | 'linear';

export function createRenderDebug(): RenderDebug {
  return {
    grayscale: false,
    mipFilter: 'nearest',
    propDose: PLAYABLE_PROP_DOSE_VIEW,
    hideViewmodel: false,
    gpuFinish: false,
  };
}

/** M1: custo de UMA vista no último frame (painel F2 e relatório do bench). */
export interface ViewStats {
  readonly drawCalls: number;
  readonly triangles: number;
  /** Regiões e grupos de props que passaram no culling desta vista. */
  readonly regions: number;
  readonly propGroups: number;
  /** Atores desenhados (sem o escondido). */
  readonly actors: number;
  /** Draw calls dos bonecos nesta vista (#56; 0 até o passe de bonecos medir). */
  readonly actorDraws: number;
}

export interface RenderStats {
  readonly drawCalls: number;
  readonly triangles: number;
  /** Programas de shader compilados (orçamento: ≤ 7, regra 8). */
  readonly programs: number;
  readonly viewports: number;
  readonly textures: number;
  readonly geometries: number;
  /** M1: por vista, na ordem de `renderViews` (vazio fora da partida). */
  readonly views: readonly ViewStats[];
  /** M1: tempo de GPU do último frame em ms com `gpuFinish` (CPU até o `finish` voltar); -1 sem medição. */
  readonly gpuMs: number;
  /**
   * Bonecos (#56) por nível de animação no último frame (PLANO do porte §B6): L0 pose completa todo frame (perto de
   * alguma vista), L1 em frames alternados (longe, com `figureHalfRate`), L2 fora de todas as vistas (só o
   * deslocamento da raiz). 0 até a animação dos bonecos existir.
   */
  readonly figureL0: number;
  readonly figureL1: number;
  readonly figureL2: number;
  /** Bonecos que não couberam na malha "bobos" (72 atores × 44 caixas) no último frame: não são desenhados. */
  readonly figureOverflow: number;
}

/** M1: memória estimada de GPU (bytes enviados), para o F2 e o bench (tecnico.md §16.3). */
export interface RenderMemory {
  readonly textureBytes: number;
  readonly worldMeshBytes: number;
  readonly instanceBytes: number;
  readonly otherBytes: number;
}

/** M1: o que o render descobriu do contexto (relatório do bench e linhas [t0]). */
export interface RenderInfo {
  readonly threeRevision: string;
  readonly textureMode: TextureMode;
  readonly vertexAttributes: VertexAttributeMode;
  /** Limites lidos do GL (MAX_ARRAY_TEXTURE_LAYERS, MAX_TEXTURE_SIZE, MAX_VERTEX_TEXTURE_IMAGE_UNITS…). */
  readonly glLimits: Readonly<Record<string, number>>;
  /** `console.warn` do three capturados desde a criação (item 3 do T0). */
  readonly warnings: readonly string[];
}

export interface Renderer extends Disposable {
  /** Ajusta o drawing buffer (px reais). */
  resize(width: number, height: number, pixelRatio: number): void;
  setActors(actors: ActorBuffer): void;
  /** M2: projéteis em voo do frame (`null` = nenhum). Guarda a referência; as matrizes saem no próximo `renderViews`. */
  setProjectiles(projectiles: ProjectileBuffer | null): void;
  /** Desenha o mundo em 1 a 4 viewports (no M1, com a HUD de cada vista no fim do laço dela). */
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

  // --- M1 ---
  /** Sobe os 2 arrays (com mips) no loading; `null` libera. Vale também para a rota atlas (o render remonta). */
  setTextures(textures: RenderTextures | null): void;
  /**
   * Reescreve k camadas SEGUIDAS de `modelos64` a partir de `firstLayer`: `rgba` tem k × 16.384 bytes (64×64 RGBA8 por
   * camada; uma skin do boneco = `FIGURE_SKIN_LAYERS` camadas, #56). `level1` (opcional, k × 4.096 bytes) é o nível
   * de mip 1 de cada camada já pronto (a skin 64 reempacotada, cópia sem filtro); sem ele o render tira o nível 1 do
   * nível 0. Os níveis seguintes o render gera do nível 1 com cobertura de alfa. A subida é camada por camada
   * (`texSubImage3D` com profundidade 1, o caminho provado no nx.js; no atlas, uma célula por camada e nível) e a cadeia
   * inteira também vai para a cópia da CPU (a cor do cubinho lê o nível 1). Só camadas reservadas (`reservedStart..`).
   * No loading, nunca por frame.
   */
  writeModelLayer(firstLayer: number, rgba: Uint8Array, level1?: Uint8Array): void;
  /** Modelos (`.bfmodel`) que atores, viewmodel e props usam, por índice nesta lista; `null` libera. */
  setModels(models: readonly ModelDocument[] | null): void;
  /** Mapa do M1 (regiões, luz, props); `null` libera tudo dele (regra 21). Chamar depois de texturas e modelos. */
  setMap(map: RenderMap | null): void;
  /** Hora do dia, fog, visão e relógio das animações (uniforms). Pode chamar todo frame (só copia números). */
  setEnvironment(env: EnvironmentState): void;
  /** VFX do frame (clarão, traçante, impacto, cubinhos, desmonte). Consumido no próximo `renderViews`. */
  submitFx(queue: FxQueue): void;
  setDebug(debug: RenderDebug): void;
  /** Compila os 7 programas e desenha 1 frame fora da tela (loading; o Switch não tem compilação paralela). */
  warmup(): void;
  /**
   * Teto de cubinhos de detrito vivos (`PlatformProfile.maxDebris`; verificação do M1): o `game` chama ao criar a
   * partida, porque o perfil só é conhecido na cena (o renderer nasce antes, no boot). Limitado ao pool do render.
   * Sem passes (menu, NullRenderer) não faz nada.
   */
  setDebrisBudget(maxDebris: number): void;
  memory(): RenderMemory;
  readonly info: RenderInfo;

  // --- Boneco do FutBobo (#56, PLANO do porte §C6) ---
  /**
   * No loading, depois das skins: gabaritos da partida (≤ 255; `ActorBuffer.figure` indexa) e a tabela de jogo (o
   * MESMO objeto que a sim recebe em `SimConfig.figureTable`). `null` solta (fim da partida, regra 21). Sem passes
   * (menu, NullRenderer) não faz nada.
   */
  setFigures(templates: FigureTemplateSet | null, table: FigureGameTable | null): void;
  /** Do perfil (`PlatformProfile.figureNearM`, `figureHalfRate`): até onde vai a pose completa e se L1 roda a meia taxa. */
  setFigureLod(nearM: number, halfRate: boolean): void;
}
