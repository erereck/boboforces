// @boboforces/platform-api: SÓ TIPOS (mais 2 constantes). É a única porta do código compartilhado para o mundo:
// apps/web e apps/switch implementam `Platform`; o resto do jogo nunca toca em globais do navegador ou do nx.js
// (tecnico.md §1.4 e §21). Nada de tipos DOM aqui: canvas, contexto GL e AudioContext são `unknown` e só o pacote que
// os usa (render, audio) faz o cast.
import type { GamepadKind, RawInputState } from '@boboforces/input';
import type { Unsubscribe } from '@boboforces/shared';

export type * from './audio.ts';

export type PlatformId = 'web' | 'switch';

/** Prefixo de toda chave de armazenamento (a origem do GitHub Pages é dividida com o gamebobo, tecnico.md §11.1). */
export const STORAGE_PREFIX = 'boboforces:';

/** Atraso padrão da escrita com debounce do `Storage` (tecnico.md §14.1). */
export const STORAGE_DEBOUNCE_MS = 250;

/** Margens seguras em px reais (recorte da tela, notch, cantos arredondados, barra de gestos). */
export interface SafeAreaInsets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/**
 * Superfície de desenho WebGL2 já criada pela casca. Web: `<canvas>` + `getContext('webgl2')`. Switch: `screen` do
 * nx.js + shim de canvas (tecnico.md §6.11). `width`/`height` mudam com o resize (a implementação usa getters).
 */
export interface GraphicsSurface {
  readonly kind: 'webgl2';
  /** `WebGL2RenderingContext`, opaco: só `render` faz o cast. */
  readonly context: unknown;
  /** `HTMLCanvasElement` (web) ou o shim de canvas (Switch), opaco: só `render` faz o cast. */
  readonly canvas: unknown;
  /** Tamanho do drawing buffer em px reais. */
  readonly width: number;
  readonly height: number;
  /** px reais por px de layout (DPR × escala de render na web; 1 no Switch). */
  readonly pixelRatio: number;
  /**
   * Margens seguras em px reais, para a UI ancorar longe do notch e dos cantos (web: `env(safe-area-inset-*)`; zeros
   * no PC e no Switch). Atualiza junto com o resize.
   */
  readonly safeArea: SafeAreaInsets;
  /** Chamado quando o drawing buffer muda de tamanho (janela, rotação, dock/portátil). */
  onResize(listener: (width: number, height: number, pixelRatio: number) => void): Unsubscribe;
}

/**
 * Armazenamento chave → texto, com prefixo `boboforces:` aplicado pela implementação (as chaves aqui são lógicas, sem
 * prefixo). Leitura síncrona; escrita com debounce de 250 ms, flush ao pausar/sair e cópia de backup (padrão do MMM).
 * Web: `localStorage`. Switch: JSON no SD (`sdmc:/switch/boboforces/`).
 */
export interface Storage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  /** Chaves lógicas existentes (sem o prefixo). */
  keys(): string[];
  /**
   * Versão anterior de uma chave: o valor que ela tinha antes da última gravação que MUDOU o valor (o debounce junta
   * vários `set` numa gravação), ou `null` se ela nunca mudou ou foi removida. É o "desfazer" da tela de backup (M2).
   * Web: `<chave>~bak` no localStorage. Switch: `save.previous.json` no SD (o `save.backup.json` continua sendo o
   * save inteiro da gravação anterior, para recuperar um `save.json` corrompido). Teste único das duas:
   * `checkStorageContract` em `@boboforces/platform-api/testing`.
   */
  getBackup(key: string): string | null;
  /** Grava agora o que estiver pendente no debounce. */
  flush(): Promise<void>;
}

/**
 * Assets por caminho LÓGICO (ex.: `maps/construto.bfmap`, `textures/blocos16.png`), nunca URL (regra 3).
 * Web: relativo à base do site. Switch: `romfs:/`. Erro de leitura rejeita a promessa.
 */
export interface Assets {
  loadBytes(path: string): Promise<Uint8Array>;
  loadText(path: string): Promise<string>;
}

export interface PickedFile {
  readonly name: string;
  readonly bytes: Uint8Array;
}

/**
 * Importar/exportar arquivos do jogador (backup, relatório). Web: `<input type=file>` escondido + link com Blob
 * (exceção técnica da casca, DECISOES "DOM na web"). Switch: leitura/escrita no SD. `null` se a plataforma não tiver.
 */
export interface Files {
  /** Abre o seletor; `null` se o jogador cancelar. `accept`: extensões como `.json`. */
  pick(accept: readonly string[]): Promise<PickedFile | null>;
  /** Salva/baixa um arquivo; `false` se não deu. */
  save(name: string, data: Uint8Array | string, mimeType: string): Promise<boolean>;
}

export type TextInputKind = 'name' | 'code' | 'text';

export interface TextInputRequest {
  readonly initial: string;
  readonly maxLength: number;
  readonly kind: TextInputKind;
}

export interface TextInputListener {
  onChange(value: string, caret: number): void;
  onSubmit(value: string): void;
  onCancel(): void;
}

export interface TextInputSession {
  close(): void;
}

/**
 * Entrada de texto (regra 14). Web: `<input>` escondido (teclado nativo no celular, digitação no PC). Switch: teclado
 * do sistema se o nx.js expuser [T0]. Quando `open` devolve `null`, o jogo usa o teclado virtual próprio no canvas.
 */
export interface TextInput {
  /** Existe teclado nativo/físico utilizável agora. */
  readonly available: boolean;
  open(request: TextInputRequest, listener: TextInputListener): TextInputSession | null;
}

/**
 * Ciclo de vida da casca. `onPause`: o sistema pediu pausa (pointer lock perdido, HOME, dock↔portátil, controle
 * desconectado, aba oculta). `onResume`: voltou. `onVisibility`: página/app visível ou não (áudio suspende).
 */
export interface Lifecycle {
  onPause(listener: () => void): Unsubscribe;
  onResume(listener: () => void): Unsubscribe;
  onVisibility(listener: (visible: boolean) => void): Unsubscribe;
  /** Liga/desliga a confirmação ao fechar a aba (só durante a partida) e o Wake Lock. Sem efeito no Switch. */
  setInMatch(inMatch: boolean): void;
}

/** Parte do relatório que só a plataforma sabe (tecnico.md §18). Nunca inclui nomes, códigos, IP ou salas. */
export interface PlatformReport {
  readonly platform: PlatformId;
  /** Navegador/sistema (user agent na web; versão do sistema e do nx.js no Switch). */
  readonly system: string;
  readonly screen: { readonly width: number; readonly height: number; readonly pixelRatio: number };
  /** Renderer da GPU (WEBGL_debug_renderer_info só na casca web) ou "desconhecida". */
  readonly gpu: string;
  /** Limites WebGL relevantes (MAX_TEXTURE_SIZE, MAX_ARRAY_TEXTURE_LAYERS…). */
  readonly glLimits: Readonly<Record<string, number>>;
  /** Resultado de `navigator.storage.persist()`; `null` se não se aplica. */
  readonly storagePersisted: boolean | null;
  readonly extra: Readonly<Record<string, string>>;
}

/** M1: memória do processo JS (F2, bench, item 14 do T0), em bytes. */
export interface MemoryUsage {
  readonly usedHeapBytes: number;
  /** Teto do heap (Switch: `heapSizeLimit`; web: `jsHeapSizeLimit` quando existir), ou -1. */
  readonly heapLimitBytes: number;
}

export interface Diagnostics {
  collectReport(): Promise<PlatformReport>;
  /** Linha para o log persistente (Switch: `runtime.log` com rotação em 1 MB; web: memória). */
  appendLog(line: string): void;
  /**
   * M1 (opcional até as cascas implementarem): heap agora. Web: `performance.memory` (Chromium) ou `null`;
   * Switch: `Switch.memoryUsage()`. Barato: o F2 chama 1x por segundo.
   */
  memoryUsage?(): MemoryUsage | null;
  /**
   * M1 (opcional): linhas do log desde o boot (web: o buffer em memória; Switch: o `runtime.log` da sessão), para o
   * relatório do bench e o "Copiar relatório".
   */
  recentLog?(maxLines: number): readonly string[];
}

/**
 * M1: descritor de um controle conectado, como a casca o vê (item 17 do T0: 4 controles completos, pares de Joy-Con e
 * Pro Controllers, Joy-Con avulso recusado). Nada de nome de marca na UI: `kind` escolhe os glifos genéricos.
 */
export interface ControllerInfo {
  /** Índice do controle no `RawInputState.gamepads`. */
  readonly index: number;
  /** Identificador bruto (texto da Gamepad API ou do nx.js). Só diagnóstico (`[t0]`), nunca na UI. */
  readonly id: string;
  readonly kind: GamepadKind;
  /** Switch: `Gamepad.styleSet` (bits `HidNpadStyleTag` do libnx); -1 fora do Switch. */
  readonly styleSet: number;
  /** Switch: `deviceType` (bits `HidDeviceTypeBits`) quando o nx.js expuser; -1 senão. */
  readonly deviceType: number;
  /** Controle completo (par de Joy-Con, Pro, portátil, ou padrão na web); `false` = Joy-Con avulso (decisão #32). */
  readonly complete: boolean;
  readonly canVibrate: boolean;
}

/**
 * Fonte do estado bruto de input. A casca acumula eventos e entrega tudo de uma vez, 1x por frame. Web:
 * `createWebInputSource` em `apps/web/src/input` (teclado, mouse com pointer lock, Gamepad API, toque). Switch: Gamepad
 * do nx.js (só controles). O jogo só lê `RawInputState` e passa pelo mapeador de `@boboforces/input`.
 */
export interface RawInputSource {
  /**
   * Copia o estado atual para `out` (pré-alocado com `createRawInputState`, sem alocar) e zera os acumuladores
   * (mouse, roda). Tecla, botão ou toque que desceu e subiu desde o último poll aparece apertado/ativo neste poll e
   * solto no próximo: cliques rápidos não se perdem. Preenche também `surfaceWidth`/`surfaceHeight`/`pixelRatio`
   * (px reais) e, na web, o ponteiro absoluto (`pointerX`/`pointerY`/`pointerInside`) para a UI.
   */
  poll(out: RawInputState): void;
  /** Vibração por controle (`vibrationActuator`); intensidades em [0, 1]. Sem suporte, não faz nada. */
  vibrate(gamepadIndex: number, strong: number, weak: number, durationMs: number): void;
  /**
   * M1 (opcional até as cascas implementarem): descreve os controles conectados em `out` (sem alocar no frame: o
   * array é do chamador e é reescrito) e devolve quantos. Tela "aperte A" do T0 e glifos.
   */
  describeControllers?(out: ControllerInfo[]): number;
}

/**
 * Áudio: o `AudioContext` criado pela casca (web: liberado no primeiro gesto; Switch: o do nx.js). Opaco: só `audio`
 * faz o cast, para `AudioContextLike` (M1, `audio.ts`: o subconjunto comum Context, BufferSource, Gain,
 * StereoPanner, `createBuffer` e `decodeAudioData` de MP3; regra 9).
 */
export interface AudioSurface {
  readonly context: unknown;
  /** `true` quando o contexto já pode tocar (política de autoplay da web). */
  readonly unlocked: boolean;
  onUnlock(listener: () => void): Unsubscribe;
}

/**
 * Serviço online (M5, só web): implementado em `packages/net` e injetado só por `apps/web`. No Switch é sempre `null`
 * (decisão #1). Todo modo roda com `platform.online === null` (regra 18). Por enquanto só o marcador.
 */
export interface OnlineService {
  readonly protocolVersion: number;
}

/** Capacidades da plataforma (dados, não detecção espalhada pelo código). */
export interface PlatformFeatures {
  /** Perfil-base de desempenho sugerido (o jogo escolhe o perfil final em config). */
  readonly profileHint: 'pc' | 'mobile' | 'switch';
  readonly touch: boolean;
  readonly keyboardMouse: boolean;
  /** Valor inicial da opção "Reduzir efeitos" (`prefers-reduced-motion` na web). */
  readonly reducedMotion: boolean;
  /** `exit()` faz algo (Switch); na web não existe sair. */
  readonly canExit: boolean;
}

export interface Platform {
  readonly id: PlatformId;
  readonly features: PlatformFeatures;
  readonly graphics: GraphicsSurface;
  readonly storage: Storage;
  readonly assets: Assets;
  readonly files: Files | null;
  readonly textInput: TextInput;
  readonly lifecycle: Lifecycle;
  readonly diagnostics: Diagnostics;
  readonly input: RawInputSource;
  /** `null` quando não há áudio (ex.: boot do portcheck em `node:vm`). */
  readonly audio: AudioSurface | null;
  /** `null` no Switch e sempre que o online não estiver carregado. */
  readonly online: OnlineService | null;
  /**
   * Relógio de parede em ms, monotônico. Só para o laço de frames (acumulador do passo fixo) e para medições do F2.
   * A sim NUNCA lê relógio: ela conta ticks (regra 10).
   */
  now(): number;
  /** Agenda o próximo frame (requestAnimationFrame na web e no nx.js). O `game` não usa o global diretamente. */
  requestFrame(callback: (nowMs: number) => void): number;
  cancelFrame(handle: number): void;
  /** Sai do jogo (Switch). Na web não faz nada; só o menu chama (regra 16). */
  exit(): void;
}
