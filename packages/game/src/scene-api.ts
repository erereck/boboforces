// Costura entre o núcleo do jogo (menus, fluxo; `@boboforces/game`) e a CENA (Construto: loading, partida local,
// bench, prints; `@boboforces/game/scene`). Integração do M1: a cena (mundo, mesher, atores, VFX, navegação, IA) é a
// parte pesada do código, e o menu da web tem 350 KB de orçamento (tecnico.md §16.4). Então a web só baixa a cena
// quando o jogador entra nela: a casca passa `GameDeps.loadScene`, que faz o `import()` (regra 15: `import()` só em
// `apps/web`); o Switch empacota tudo num arquivo e devolve o módulo direto. Aqui só TIPOS (nada pesa no menu).
import type { DeviceKind, MenuConfirmConvention, MenuInput, RawInputState } from '@boboforces/input';
import type { GraphicsSurface, Platform } from '@boboforces/platform-api';
import type { Renderer, TextureMode, VertexAttributeMode } from '@boboforces/render/data';
import type { Disposable } from '@boboforces/shared';
import type { DrawList, UiAtlasImage, UiFonts } from '@boboforces/ui';
import type { BenchConfig, GameDebugApi } from './bench/types.ts';
import type { LocalDriver } from './local-driver.ts';
import type { UiFrame } from './menu.ts';

/** Rotas de criação do renderer (fixas na criação: mudam os programas; tecnico.md §24.1, Teste Zero). */
export interface RendererRoutes {
  readonly textureMode: TextureMode;
  readonly vertexAttributes: VertexAttributeMode;
}

export const DEFAULT_RENDERER_ROUTES: RendererRoutes = { textureMode: 'array', vertexAttributes: 'int' };

/** Fábrica de renderer da casca. `routes` ausente = as do bench pedido na criação, ou o padrão (array, inteiros). */
export type RendererFactory = (surface: GraphicsSurface, routes?: RendererRoutes) => Renderer;

/** Como se entrou na cena. */
export type SceneKind = 'play' | 'vitrine' | 'bench';

export interface SceneRequest {
  /**
   * `play` (JOGAR): o Construto em Bobo Warfare TDM, o jogador e bots N0; `vitrine` (Cena-vitrine): o Construto só
   * para andar, sem bots; `bench`: a configuração de `bench` (jogadores locais pilotados por bot, roteiro, relatório).
   */
  readonly kind: SceneKind;
  readonly bench: BenchConfig | null;
  /** Avisos que a casca já tinha (parâmetros da URL, `GameDeps.benchWarnings`): entram no relatório. */
  readonly benchWarnings: readonly string[];
  readonly seed: number;
  readonly convention: MenuConfirmConvention;
  /** Dispositivo que entrou (o mesmo segue jogando); `null` = o padrão da plataforma. */
  readonly device: DeviceKind | null;
  readonly gamepad: number;
}

/** O que o núcleo empresta para a cena. */
export interface SceneHost {
  readonly platform: Platform;
  readonly renderer: Renderer;
  /** Fontes e atlas da UI do menu (os mesmos da partida e da folha das fontes em uso, #54). */
  readonly fonts: UiFonts | null;
  readonly uiAtlas: UiAtlasImage | null;
  log(line: string): void;
  /** Relatório do bench pronto (`formatBenchReport`); o núcleo repassa para `GameHooks.onBenchReport`. */
  benchReport(text: string): void;
}

export type SceneSignal = 'none' | 'quit';

/** A cena viva: carrega por etapas dentro dos próprios frames, depois roda a partida. */
export interface Scene extends Disposable {
  readonly phase: 'loading' | 'running' | 'error';
  readonly paused: boolean;
  /** Jogando no teclado/mouse: a casca web pede o pointer lock. */
  readonly wantsPointerLock: boolean;
  /** Partida em andamento (testes, F2, `window.__bfDebug.simTick`); `null` durante o loading. */
  readonly driver: LocalDriver | null;
  /** Gancho dos prints (`GameHandle.debug`): não nulo quando o Construto carregou. */
  readonly debug: GameDebugApi | null;
  /** Pausa vinda da plataforma (pointer lock perdido, aba oculta, HOME). */
  pause(): void;
  /**
   * 1x por frame, depois do poll e do `menu.update`: loading (uma fatia), ou sim + render + HUD. Desenha a UI em
   * `list` (já zerada) e chama `drawUi`. `quit` = voltar ao título.
   */
  frame(
    dt: number,
    raw: Readonly<RawInputState>,
    menu: MenuInput,
    ui: UiFrame,
    list: DrawList,
    /** Intervalo cru do frame em ms (sem o limite de 0,1 s do `dt`): o bench e o F2 medem este. */
    frameMs?: number,
  ): SceneSignal;
}

export interface SceneModule {
  createScene(host: SceneHost, request: SceneRequest): Scene;
}

/**
 * O que `GameDeps.loadScene` entrega. `createRenderer`, quando vem, é a fábrica do renderer COMPLETO (web: o do menu
 * só desenha UI, para o three do mundo, dos atores e dos VFX ficar fora da carga inicial); o núcleo troca o renderer
 * uma vez, ao entrar na primeira cena.
 */
export interface SceneBundle {
  readonly module: SceneModule;
  readonly createRenderer?: RendererFactory;
}
