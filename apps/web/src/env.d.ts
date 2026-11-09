// Globais da casca web. As constantes `__BF_*` vêm do `define` do vite.config.ts (lidas do version.json e do git);
// nos testes do Vitest elas não existem, por isso todo uso passa por `typeof` (ver platform/build-info.ts).
declare const __BF_VERSION__: string;
declare const __BF_CODENAME__: string;
declare const __BF_BUILD__: string;

/** Marcadores que o script inline do index.html deixa no `window` antes de qualquer módulo rodar. */
interface Window {
  /** Erros capturados antes da platform-web existir (até 20). A diagnostics adota e zera. */
  __bfErr?: string[] | undefined;
  /** A diagnostics já assumiu a captura de erros: o script inline para de guardar. */
  __bfCaptured?: boolean;
  /** O boot terminou de criar a plataforma: dali em diante, erro de carga é com a integração (`boot.fail`). */
  __bfBooted?: boolean;
  /** 1 quando o navegador entendeu a sonda de sintaxe ES2022 (campo privado + bloco static). */
  __bfEs?: number;
  /**
   * Gancho de depuração da casca (estado do jogo, estatísticas do render, gancho dos prints e relatório do bench), lido
   * pelo teste de fumaça, pelos prints e pelo bench do PC.
   */
  __bfDebug?: import('./debug-hook.ts').WebDebugHook;
}

/** O `import.meta.env` do Vite, só o que a casca lê (fase 8c: o service worker só no build de produção). */
interface ImportMetaEnv {
  readonly PROD: boolean;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
