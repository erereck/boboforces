import type {
  BoboDocument,
  BotDocument,
  BotLevel,
  MatchRecipe,
  SettingsDocument,
  StatsDocument,
} from '@boboforces/format';
// Costura entre o núcleo do jogo (menus, fluxo; `@boboforces/game`) e a CENA (Construto: loading, partida local,
// bench, prints; `@boboforces/game/scene`). Integração do M1: a cena (mundo, mesher, atores, VFX, navegação, IA) é a
// parte pesada do código, e o menu da web tem 350 KB de orçamento (tecnico.md §16.4). Então a web só baixa a cena
// quando o jogador entra nela: a casca passa `GameDeps.loadScene`, que faz o `import()` (regra 15: `import()` só em
// `apps/web`); o Switch empacota tudo num arquivo e devolve o módulo direto. Aqui só TIPOS (nada pesa no menu).
import type { Mixer } from '@boboforces/audio';
import type { DeviceKind, MenuConfirmConvention, MenuInput, RawInputState } from '@boboforces/input';
import type { GraphicsSurface, Platform } from '@boboforces/platform-api';
import type { Renderer, TextureMode, VertexAttributeMode } from '@boboforces/render/data';
import type { Disposable } from '@boboforces/shared';
import type { DrawList, UiAtlasImage, UiFonts } from '@boboforces/ui';
import type { BenchConfig, GameDebugApi } from './bench/types.ts';
import type { LocalSeat } from './scene/seats.ts';
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
/** M2 (fase 6c): `wardrobe` = o editor do Meu Bobo (o bobo num pedestal no Ringue, sem partida). */
export type SceneKind = 'play' | 'vitrine' | 'bench' | 'wardrobe';

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
  /** M2 (fase 2e): nível rápido dos bots do JOGAR (padrão `normal`); o resultado sobe e desce um passo. */
  readonly level?: BotLevel;
  /**
   * M2 (fase 4c): a receita do JOGAR (o preset: o último jogado, a partida de estreia, o sorteio do Surpreenda-me).
   * Com ela, `level` não vale; a semente da partida é `seed`, e o corte ao aparelho é o da cena.
   */
  readonly recipe?: MatchRecipe;
  /** M2 (fase 5f): começa com a calibração da mira (o "Calibrar mira" dos Ajustes abre o Bobo Training assim). */
  readonly calibrate?: boolean;
  /**
   * M3 (fase 1a): os jogadores locais do sofá, um por assento (o 1º é o P1), em tela dividida. Com 2 ou mais, cada um
   * fica preso ao dispositivo do seu assento; vazio ou ausente = 1 jogador, que segue o último dispositivo usado.
   */
  readonly seats?: readonly LocalSeat[];
}

/**
 * M2 (fase 7b): o áudio do jogo. O mixer é um só, criado no boot pelo núcleo (a interface toca nele); os MP3 do banco
 * carregam depois do menu, em segundo plano. A cena sintetiza o resto no loading e toca os sons da partida.
 */
export interface SceneAudio {
  readonly mixer: Mixer;
  /** Resolve quando os MP3 do banco terminaram de carregar (com ou sem erro; nunca rejeita). */
  readonly files: Promise<void>;
}

/** M2 (fase 4f): os ajustes do jogador, lidos na hora e gravados pelo núcleo. */
export interface SceneSettings {
  readonly current: SettingsDocument;
  save(doc: SettingsDocument): void;
}

/**
 * M2 (fase 4g): o que uma partida terminada soma no `stats@1`. Rodada 8 (D5): em tela dividida, os números de todos os
 * jogadores locais somados; os recordes olham o melhor deles (`bestKills`, `bestStreak`).
 */
export interface MatchRecord {
  readonly outcome: 'win' | 'loss' | 'draw';
  readonly kills: number;
  readonly deaths: number;
  readonly assists: number;
  readonly shots: number;
  readonly hits: number;
  readonly headshots: number;
  /** Os abates do melhor jogador local (o recorde de abates é individual). */
  readonly bestKills: number;
  readonly bestStreak: number;
  /** Tempo jogado (s). */
  readonly playTimeS: number;
  /** M3 (fase 6a): Bobo Zombies: a chave da configuração (`zombieRecordKey`) e a onda alcançada. */
  readonly zombies?: { readonly key: string; readonly wave: number };
}

/** Os recordes que a partida bateu (a primeira partida só marca a base: não bate nada). */
export interface RecordBreaks {
  readonly mostKills: boolean;
  readonly bestStreak: boolean;
  /** M3 (fase 6a): passou a onda máxima desta configuração (a primeira partida nela só marca a base). */
  readonly zombieWave: boolean;
}

/** M2 (fase 6c): o Meu Bobo: a partida veste o jogador 1 com ele; o editor muda e grava. */
export interface SceneBobo {
  readonly current: BoboDocument;
  save(doc: BoboDocument): void;
}

/** M2 (fase 4g): as estatísticas do aparelho; a cena entrega a partida no fim e o núcleo grava. */
export interface SceneStats {
  /** M2 (fase 4h): o documento atual (as dicas olham as partidas terminadas e as já vistas). */
  readonly current: StatsDocument;
  record(match: MatchRecord): RecordBreaks;
  /** M2 (fase 4h): a dica `id` apareceu (não volta mais). */
  tipSeen(id: string): void;
}

/** O que o núcleo empresta para a cena. */
export interface SceneHost {
  readonly platform: Platform;
  readonly renderer: Renderer;
  /** Fontes e atlas da UI do menu (os mesmos da partida e da folha das fontes em uso, #54). */
  readonly fonts: UiFonts | null;
  readonly uiAtlas: UiAtlasImage | null;
  log(line: string): void;
  /** M2 (fase 4f): os ajustes do jogador (a pausa mostra e muda; o save é do núcleo). */
  readonly settings: SceneSettings;
  /** M2 (fase 4g): grava a partida no fim (só partidas de verdade: nem bench, nem os prints). */
  readonly stats: SceneStats;
  /** M2 (fase 6c): o Meu Bobo. */
  readonly bobo: SceneBobo;
  /** M2 (fase 7b): o mixer e os sons do banco. */
  readonly audio: SceneAudio;
  /** Relatório do bench pronto (`formatBenchReport`); o núcleo repassa para `GameHooks.onBenchReport`. */
  benchReport(text: string): void;
}

/**
 * O que a cena pede ao núcleo: `quit` volta ao título; M2 (fase 2e): `again` (De novo), `easier` e `harder` (Mais
 * fácil / Mais difícil) recarregam o JOGAR com o nível de `Scene.level` (um passo abaixo ou acima).
 */
/** M2 (fase 4e): `rules` = Mudar regras (abre a Partida personalizada com o preset); `save` = Salvar preset. */
/** M2 (fase 5e): `nemesis` = Salvar na Oficina (o Nêmesis do resultado); `lab` = Abrir Laboratório (no Tryhard). */
export type SceneSignal = 'none' | 'quit' | 'again' | 'easier' | 'harder' | 'rules' | 'save' | 'nemesis' | 'lab';

/** M2 (fase 5e): o que o Testar do Laboratório mostra na volta do Bobo Training. */
export interface TrainingReport {
  /** Precisão dos bots testados (os que não são Alvo), em %; -1 sem tiro. */
  readonly botAccuracy: number;
  readonly kills: number;
  readonly deaths: number;
  /** TTK médio (s); -1 sem abate. */
  readonly ttkS: number;
}

/** A cena viva: carrega por etapas dentro dos próprios frames, depois roda a partida. */
export interface Scene extends Disposable {
  readonly phase: 'loading' | 'running' | 'error';
  readonly paused: boolean;
  /** Jogando no teclado/mouse: a casca web pede o pointer lock. */
  readonly wantsPointerLock: boolean;
  /** M2 (fase 7d): a cena quer a música do menu agora (o resultado; GDD §5.10). Fora disso, só com o Ajuste. */
  readonly wantsMusic?: boolean;
  /** M3 (fase 6e): a cena toca a própria música agora (o Bobo Zombies); o núcleo não mexe nela. */
  readonly ownsMusic?: boolean;
  /** Partida em andamento (testes, F2, `window.__bfDebug.simTick`); `null` durante o loading. */
  readonly driver: LocalDriver | null;
  /** Gancho dos prints (`GameHandle.debug`): não nulo quando o Construto carregou. */
  readonly debug: GameDebugApi | null;
  /** M2 (fase 2e): nível rápido dos bots adversários agora (o da receita, ou o do "Ajustar desafio"). */
  readonly level: BotLevel;
  /** Pausa vinda da plataforma (pointer lock perdido, aba oculta, HOME). */
  pause(): void;
  /** M2 (fase 5e): os números do Bobo Training (`null` fora dele ou antes de a partida existir). */
  trainingReport(): TrainingReport | null;
  /** M2 (fase 5e): o bot Nêmesis do resultado (quem mais te matou), para salvar na Oficina; `null` se não há. */
  nemesisBot(): BotDocument | null;
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
