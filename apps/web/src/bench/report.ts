// Relatório do bench na casca web (tecnico.md §18; decisão #42: nada sai do aparelho sozinho). O jogo entrega o texto
// pronto (`GameHooks.onBenchReport`) e desenha a tela dele em WebGL; a casca só cuida da área de transferência e do
// download, sem UI em DOM (decisão #3):
//   1. ao chegar, tenta copiar na hora (o Chromium aceita `clipboard.writeText` sem gesto com a aba em foco);
//   2. se não deu, o próximo toque, clique ou tecla copia (o gesto libera o clipboard no Safari e no Firefox);
//   3. se o clipboard recusar mesmo no gesto, baixa `relatorio-bench-….txt` pelo link da casca (`platform.files.save`);
//   4. atalhos a qualquer momento: `C` (ou Ctrl+C) copia de novo, `B` baixa o .txt.
// O resultado vai para o título da aba, para o log da plataforma e para `window.__bfDebug.benchDelivery`.
import type { Unsubscribe } from '@boboforces/shared';

/** Como o relatório saiu. */
export type ReportDelivery = 'copiado' | 'baixado' | 'falhou';

export interface ReportSinkEnv {
  /** `navigator.clipboard.writeText`; `null` quando o navegador não tem (http, WebView antigo). */
  readonly writeClipboard: ((text: string) => Promise<void>) | null;
  /** `platform.files.save` (link com Blob). */
  readonly save: (name: string, data: string, mimeType: string) => Promise<boolean>;
  /** Linha para o log da plataforma (`diagnostics.appendLog`). */
  readonly log: (line: string) => void;
  /** Avisa o resultado sem UI em DOM (título da aba). */
  readonly notify: (delivery: ReportDelivery) => void;
  /** Versão do jogo e relógio de parede, para o nome do arquivo. */
  readonly version: string;
  readonly now: () => Date;
}

export interface BenchReportSink {
  readonly text: string | null;
  readonly delivery: ReportDelivery | null;
  /** O próximo gesto (toque, clique, tecla) copia: a cópia automática não deu. */
  readonly waitingGesture: boolean;
  /** Chegou o relatório: guarda e tenta copiar sem gesto (`null` = ficou esperando o gesto). */
  receive(text: string): Promise<ReportDelivery | null>;
  /** Copia (chamar dentro de um gesto); se o clipboard recusar, baixa o .txt. */
  copy(): Promise<ReportDelivery>;
  /** Baixa o .txt. */
  download(): Promise<ReportDelivery>;
}

const two = (n: number): string => String(n).padStart(2, '0');

/** `relatorio-bench-0.0.1-2026-11-03-0042.txt` (hora local: é o nome que o Erick vê na pasta de downloads). */
export function benchReportFileName(version: string, when: Date): string {
  const date = `${when.getFullYear()}-${two(when.getMonth() + 1)}-${two(when.getDate())}`;
  const time = `${two(when.getHours())}${two(when.getMinutes())}`;
  return `relatorio-bench-${version.replace(/[^0-9A-Za-z.-]/g, '_')}-${date}-${time}.txt`;
}

export function createBenchReportSink(env: ReportSinkEnv): BenchReportSink {
  let text: string | null = null;
  let delivery: ReportDelivery | null = null;
  let waitingGesture = false;

  function finish(result: ReportDelivery): ReportDelivery {
    delivery = result;
    const what =
      result === 'copiado'
        ? 'relatório copiado para a área de transferência'
        : result === 'baixado'
          ? 'relatório baixado (.txt)'
          : 'não deu para copiar nem baixar o relatório';
    env.log(`[bench] ${what}`);
    env.notify(result);
    return result;
  }

  async function tryClipboard(value: string): Promise<boolean> {
    if (!env.writeClipboard) return false;
    try {
      await env.writeClipboard(value);
      return true;
    } catch {
      return false;
    }
  }

  async function download(): Promise<ReportDelivery> {
    if (text === null) return 'falhou';
    waitingGesture = false;
    let ok = false;
    try {
      ok = await env.save(benchReportFileName(env.version, env.now()), text, 'text/plain;charset=utf-8');
    } catch {
      ok = false;
    }
    return finish(ok ? 'baixado' : 'falhou');
  }

  return {
    get text() {
      return text;
    },
    get delivery() {
      return delivery;
    },
    get waitingGesture() {
      return waitingGesture;
    },
    async receive(report) {
      text = report;
      delivery = null;
      waitingGesture = false;
      if (await tryClipboard(report)) return finish('copiado');
      // Sem gesto o navegador costuma recusar: não baixa sozinho (seria um download surpresa); espera o toque.
      waitingGesture = true;
      env.log('[bench] toque na tela ou aperte C para copiar o relatório (B baixa o .txt)');
      return null;
    },
    async copy() {
      if (text === null) return 'falhou';
      waitingGesture = false;
      if (await tryClipboard(text)) return finish('copiado');
      return download();
    },
    download,
  };
}

/** O que os atalhos olham num evento (o `KeyboardEvent`/`PointerEvent` real, ou um objeto nos testes). */
interface ShortcutEvent {
  readonly code?: string;
  readonly repeat?: boolean;
  readonly altKey?: boolean;
  readonly metaKey?: boolean;
  readonly target?: EventTarget | null;
  preventDefault?(): void;
}

type Host = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

function isTextTarget(t: EventTarget | null | undefined): boolean {
  const el = t as { tagName?: unknown; isContentEditable?: unknown } | null | undefined;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable === true;
}

/**
 * Liga os atalhos do relatório: `keydown` em `keys` (a janela) e `pointerup` em `surface` (a canvas). Só agem depois
 * que o relatório chegou. Devolve o desligamento.
 */
export function installBenchReportShortcuts(sink: BenchReportSink, keys: Host, surface: Host): Unsubscribe {
  const onKey = (raw: Event): void => {
    const e = raw as Event & ShortcutEvent;
    if (sink.text === null || e.repeat || e.altKey || e.metaKey || isTextTarget(e.target)) return;
    if (e.code === 'KeyC') {
      e.preventDefault?.();
      void sink.copy();
    } else if (e.code === 'KeyB') {
      e.preventDefault?.();
      void sink.download();
    } else if (sink.waitingGesture) {
      void sink.copy();
    }
  };
  const onPointer = (): void => {
    if (sink.text !== null && sink.waitingGesture) void sink.copy();
  };
  keys.addEventListener('keydown', onKey);
  surface.addEventListener('pointerup', onPointer);
  return () => {
    keys.removeEventListener('keydown', onKey);
    surface.removeEventListener('pointerup', onPointer);
  };
}
