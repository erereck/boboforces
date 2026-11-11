// M1: tipos do bench, do gancho de depuração dos prints e dos itens de teste do título. CONTRATO da etapa de contratos;
// quem liga tudo no `game` é a integração do M1. Puro (sem DOM): a web lê a URL e o Switch o menu de título, e os dois
// entregam um `BenchConfig` pronto.
import type { FigureLook, PlatformProfileId, PropDoseView, TimeOfDay } from '@boboforces/format';
import type { RawInputState } from '@boboforces/input';
import type { Platform } from '@boboforces/platform-api';
import type { MipFilterMode, TextureMode, VertexAttributeMode } from '@boboforces/render/data';
import type { Disposable } from '@boboforces/shared';
import type { StringKey, TestScreenModel } from '@boboforces/ui';

/**
 * Cena do bench: o Construto inteiro, o canto de 32×32 m da cena-vitrine (arte-ux.md §5.2) ou, desde o M3 (fase 7b),
 * o Bobo Zombies na Base Abandonada (`zombies`: as vistas são bots de apoio; o pool no teto de zumbis do perfil).
 */
export type BenchScene = 'construto' | 'vitrine' | 'zombies';

/**
 * Uma rodada do bench (tecnico.md §24.1). A mesma cena vira o `/bench` da web e o NRO de teste do Switch.
 * - `views` 1–4: com `route` `null`, cada vista segue um "jogador local" pilotado por bot (os humanos do bench são
 *   bots no lugar dos humanos; no Switch, a tela de controles pode pôr controles reais);
 * - `route`: rota de câmera nomeada do mapa (`bench:volta`): 1 vista só, câmera determinística (medições
 *   comparáveis entre aparelhos);
 * - `bots`: bots armados (0..64) além dos jogadores locais; `zombies`: zumbis do estresse (0..64);
 * - `textureMode`/`vertexAttributes`: as duas rotas do Teste Zero (array × atlas; inteiro × float);
 * - `durationS` medidos DEPOIS de `warmupS` (o aquecimento não entra nas estatísticas).
 */
export interface BenchConfig {
  readonly scene: BenchScene;
  readonly views: 1 | 2 | 3 | 4;
  readonly bots: number;
  readonly zombies: number;
  readonly armed: boolean;
  readonly viewDistanceM: number;
  readonly timeOfDay: TimeOfDay;
  readonly durationS: number;
  readonly warmupS: number;
  readonly route: string | null;
  readonly textureMode: TextureMode;
  readonly vertexAttributes: VertexAttributeMode;
  readonly seed: number;
  /** Perfil de plataforma (tetos, detritos); `auto` = o da plataforma com `views` jogadores locais. */
  readonly profile: PlatformProfileId | 'auto';
  /** `gl.finish()` por frame para medir GPU (item 10 do T0; derruba o FPS, então é uma rodada à parte). */
  readonly gpuFinish: boolean;
  /** Ticks da sim (60 padrão; 30 é a alavanca do Switch, tecnico.md §24.4). */
  readonly simHz: 30 | 60;
  /**
   * Chaves de BISSECÇÃO dos picos (verificação do M1; padrão tudo ligado): `hud` (HUD das vistas e texto do bench),
   * `viewmodel` (arma na mão), `fx` (VFX: tiro, impacto, detrito, morte) e `actors` (bobos, manequins e sombras).
   * Desligar uma por rodada mostra de onde vem um custo (TESTE_ZERO §10). A sim e a IA rodam iguais.
   */
  readonly hud: boolean;
  readonly viewmodel: boolean;
  readonly fx: boolean;
  readonly actors: boolean;
  /**
   * Rodada de prints (#56, PLANO do porte §B16): o loading compõe também as skins da fila (os 12 looks nos times A e
   * B) para os manequins `linha:*` e `close:*`. Fora dos prints fica desligado (a reserva é da partida).
   */
  readonly prints: boolean;
  /**
   * M2 (fase 1): primária dos bots e do jogador no bench: `rifle` (padrão, o critério do M1), o ID de uma primária
   * (`smg`, `shotgun`, `sniper`, `rocket`, `lmg`) ou `mix` (em rodízio por controlador). Mede o custo do arsenal
   * (explosões, chumbos) e serve aos prints.
   */
  readonly weapons: string;
}

/** Padrão: o critério do Switch na dock (4 vistas, 12 bots armados, visão de 50 m, 10 min). */
export const BENCH_DEFAULTS: BenchConfig = {
  scene: 'construto',
  views: 4,
  bots: 12,
  zombies: 0,
  armed: true,
  viewDistanceM: 50,
  timeOfDay: 'day',
  durationS: 600,
  warmupS: 10,
  route: null,
  textureMode: 'array',
  vertexAttributes: 'int',
  seed: 1,
  profile: 'auto',
  gpuFinish: false,
  simHz: 60,
  hud: true,
  viewmodel: true,
  fx: true,
  actors: true,
  prints: false,
  weapons: 'rifle',
};

/**
 * Nomes dos parâmetros (URL da web: `?bench&views=4&bots=12&view=50&duration=600`; o Switch monta o mesmo
 * dicionário no menu de bench). Booleanos: `1`/`0`. Valor fora da faixa é limitado e vira aviso no relatório.
 */
export const BENCH_PARAMS = {
  scene: 'scene',
  views: 'views',
  bots: 'bots',
  zombies: 'zombies',
  armed: 'armed',
  viewDistanceM: 'view',
  timeOfDay: 'tod',
  durationS: 'duration',
  warmupS: 'warmup',
  route: 'route',
  textureMode: 'atlas',
  vertexAttributes: 'float',
  seed: 'seed',
  profile: 'profile',
  gpuFinish: 'gpu',
  simHz: 'hz',
  hud: 'hud',
  viewmodel: 'vm',
  fx: 'fx',
  actors: 'actors',
  prints: 'prints',
  weapons: 'weapons',
} as const satisfies Readonly<Record<keyof BenchConfig, string>>;

// --- Gancho de depuração dos prints (window.__bfDebug.print na web; scripts/prints.ts) ---

/**
 * O que o `game` expõe para os prints automáticos e para o console (`GameHandle.debug`). A web pendura em
 * `window.__bfDebug.print`; o `scripts/prints.ts` (Edge headless) usa: escolhe a câmera nomeada, ajusta, espera
 * `whenReady` e tira o screenshot. Nada disso existe no Switch (lá o bench é pelo menu).
 */
export interface GameDebugApi {
  /** Cena carregada, shaders aquecidos e frames estáveis desde a última mudança (o print pode sair). */
  readonly readyForPrint: boolean;
  /** Câmeras nomeadas do mapa atual (`print:*`, `bench:*`). */
  readonly cameras: readonly string[];
  /** Fixa a vista 0 numa câmera nomeada (`null` volta ao jogador). `false` se o nome não existe. */
  setCamera(name: string | null): boolean;
  setTimeOfDay(timeOfDay: TimeOfDay): void;
  /**
   * Dose de props VISÍVEL (`RenderDebug.propDose`). Só visual: a colisão, a bala, a navegação e a luz são sempre as do
   * jogo (`PLAYABLE_PROP_DOSE`, decisão #52). Serve para o A/B de custo das props; abaixo da dose do jogo esconde props
   * que continuam colidindo.
   */
  setPropDose(dose: PropDoseView): void;
  setGrayscale(on: boolean): void;
  /**
   * Filtro de minificação: `off` = NEAREST sem mip, `nearest` = NEAREST_MIPMAP_LINEAR (padrão, decisão #50),
   * `linear` = LINEAR_MIPMAP_LINEAR.
   */
  setMipFilter(filter: MipFilterMode): void;
  setHudVisible(visible: boolean): void;
  setViewmodelVisible(visible: boolean): void;
  /** Congela sim, IA e animações (o relógio do ambiente para): o print sai igual em toda rodada. */
  setFrozen(frozen: boolean): void;
  /**
   * Mostra a folha das fontes EM USO (decisão #54: Russo One no display, Saira Condensed no HUD) em tela cheia, com o
   * atlas `fonts/ui-fonts.*` de sempre (`drawFontSpecimen` do ui).
   */
  showFontSpecimen(on: boolean): void;
  /** Resolve quando as mudanças pendentes já estão na tela e mais `frames` frames (padrão 3) foram desenhados. */
  whenReady(frames?: number): Promise<void>;
  /**
   * M2 (fase 2e): abre a tela de resultado agora, com os números do momento (prints e conferência; a partida segue
   * rodando por trás, como depois do fim). Só no JOGAR; nas outras cenas não faz nada. Não grava estatística.
   * M2 (fase 4i): `previewRecord` mostra o título de recorde no print, sem gravar nada.
   */
  showResult(previewRecord?: 'kills' | 'streak' | 'both'): void;
  /**
   * Rodada 3 do porte do boneco (#56; pedido da F7 em `apps/web/scripts/prints-plan.ts`, `FigurePrintHook`): troca
   * aparência, time, pose, arma, mira, expressão e giro dos manequins nomeados. A lista SUBSTITUI a anterior (quem não
   * está nela volta ao mapa; `[]` volta todos). Os de print continuam só com a câmera deles. Looks fora da cena são
   * compostos sob demanda (fora do Switch; sem vaga, o padrão do próprio time). Precedência: `expression` substitui a
   * da câmera `print:linha-expressoes`; `turnDeg` SOMA ao giro da câmera da fila. `false` se um nome ou look não existe
   * (aí nada muda).
   */
  setMannequins(overrides: readonly MannequinOverride[]): boolean;
  /**
   * Posa um manequim pelo motor de animação: zera o estado do boneco, alimenta o clipe por `frame` + o preparo, um
   * passo de `dtS` por frame desenhado (fixo, sem o relógio), e o deixa parado nesse quadro com a cena congelada. O
   * manequim não sai do lugar: velocidade, postura e eventos entram só no rig. `whenReady` espera o clipe acabar.
   * `null` desliga. `false` se o manequim ou o clipe não existe.
   */
  setFigureClip(clip: FigureClipFrame | null): boolean;
}

/** Pose de manequim (`MapMannequin.pose`): `aim` = em pé mirando (ADS); `slide` = o deslize "carrinho". */
export type MannequinPose = 'stand' | 'crouch' | 'aim' | 'slide';

/** Ajuste de um manequim nomeado (`setMannequins`; campo omitido = o do mapa). */
export interface MannequinOverride {
  /** Manequim nomeado do mapa (`altura:em-pe`, `linha:3`, `close:1`, `densidade`…). */
  readonly name: string;
  /** `skin:<preset>` (ou o id sem prefixo) ou `padrao` (`FIGURE_LOOK_DEFAULT`). */
  readonly look?: string;
  /** −1 sem time (farda do look); 0 = time A; 1 = time B. */
  readonly team?: number;
  /** M2 (fase 6c): o look inteiro (o Meu Bobo), com `look` como id dele. */
  readonly lookData?: FigureLook;
  readonly pose?: MannequinPose;
  /** Modelo de arma sem prefixo (`rifle`, `pistol`, `sniper`; `''` sem arma). */
  readonly weapon?: string;
  /** Mira em rad (+ = para cima), limitada a −1,2..1,2 (`FIGURE_PITCH_SAMPLES`). */
  readonly pitch?: number;
  /** 0..7 (`FACE_EXPRESSIONS`). */
  readonly expression?: number;
  /** Giro em graus somado ao yaw do mapa e ao da câmera da fila. */
  readonly turnDeg?: number;
  /** Corte do FutBobo (0..33) e chapéu (0..4) por cima do look. */
  readonly hairStyle?: number;
  readonly headwear?: number;
}

/** Clipes do motor de animação (`setFigureClip`; o roteiro de cada um está em `scene/figure-clip.ts`). */
export type FigureClipName = 'start' | 'stop' | 'strafe' | 'jump' | 'land' | 'hit' | 'walk' | 'sidestep' | 'backpedal';

/** Um manequim posado pelo clipe, no quadro `frame` contado a `dtS` fixo desde o evento. */
export interface FigureClipFrame {
  readonly mannequin: string;
  readonly clip: FigureClipName;
  readonly frame: number;
  readonly dtS: number;
}

// --- Itens de teste do título (Switch: Bench, Teste de controles "aperte A", Teclado, Áudio) ---

/** Contexto que o `game` passa ao iniciar um item de teste da casca. */
export interface TestItemContext {
  readonly platform: Platform;
  /** Grava no log da plataforma (`runtime.log` no Switch); use `formatT0Line` para as sondas. */
  log(line: string): void;
}

/**
 * Teste conduzido pela casca e desenhado pelo jogo (tela genérica `TestScreenModel` do ui; sem DOM no game). O `game`
 * chama `update` e `describe` todo frame enquanto a tela está aberta e fecha quando `finished` (ou no "voltar").
 */
export interface TestRunner extends Disposable {
  update(raw: Readonly<RawInputState>, dtS: number): void;
  describe(out: TestScreenModel): void;
  readonly finished: boolean;
}

/**
 * Item extra no título (`GameDeps.testItems`). Com `bench`, o `game` roda o bench com essa configuração; com `start`,
 * abre a tela de teste da casca. O Switch passa: `bench` (Bench), `controllers` ("aperte A" com os 4 controles),
 * `keyboard` (teclado do sistema) e `audio` (MP3 do romfs, 24 vozes, latência).
 */
export interface TestItem {
  readonly id: string;
  readonly labelKey: StringKey;
  readonly bench?: BenchConfig;
  start?(ctx: TestItemContext): TestRunner;
}
