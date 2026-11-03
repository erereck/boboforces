// Boot da casca web: confere o navegador, cria a platform-web e troca o splash do index.html pela canvas.
// Quem chama é o src/main.ts (integração):
//
//   const boot = bootWeb();
//   if (boot) {
//     try {
//       const game = startGame({ platform: boot.platform, createRenderer: (s) => createRenderer(s, { … }) });
//       boot.setProgress(…);          // durante o loading
//       boot.reveal();                // depois do primeiro frame desenhado
//     } catch (error) {
//       boot.fail(error);             // depois do boot, o script inline do index.html não troca mais o splash
//     }
//   }
import { createLogger } from '@boboforces/shared';
import {
  createWebPlatform,
  WebGl2UnavailableError,
  type WebPlatform,
  type WebPlatformOptions,
} from './platform/index.ts';

/** Estados do splash. `loading` é o normal; os outros viram a página de aviso amigável (index.html). */
export type SplashState = 'loading' | 'webgl2' | 'es' | 'error';

export interface CapabilityEnv {
  /** O script-sonda do index.html rodou (campo privado + bloco `static`, sintaxe ES2022). */
  readonly esSyntax: boolean;
  readonly arrayAt: boolean;
  readonly objectHasOwn: boolean;
  /** `WebGL2RenderingContext` existe. O contexto de verdade ainda pode falhar (GPU bloqueada): a graphics confere. */
  readonly webgl2: boolean;
}

/** Navegador mínimo (DECISOES, "Navegador mínimo"): WebGL2 + ES2022. Devolve o motivo do aviso, ou `null`. */
export function detectUnsupported(env: CapabilityEnv): 'es' | 'webgl2' | null {
  if (!env.esSyntax || !env.arrayAt || !env.objectHasOwn) return 'es';
  if (!env.webgl2) return 'webgl2';
  return null;
}

export function readCapabilityEnv(win: Window): CapabilityEnv {
  return {
    esSyntax: win.__bfEs === 1,
    arrayAt: typeof Array.prototype.at === 'function',
    objectHasOwn: typeof Object.hasOwn === 'function',
    webgl2: typeof (win as Window & { WebGL2RenderingContext?: unknown }).WebGL2RenderingContext === 'function',
  };
}

export interface Splash {
  /** Barra de carregamento, de 0 a 1. */
  setProgress(fraction: number): void;
  /** Liga um estado. Um aviso depois do `hide` põe o splash de volta no DOM (erro com o jogo já na tela). */
  show(state: SplashState): void;
  /** Some com o splash (fade curto, sem fade com "reduzir movimento") e tira ele do DOM. */
  hide(): void;
}

const SPLASH_ID = 'bf-splash';
const HIDE_FALLBACK_MS = 400;

export function getSplash(doc: Document): Splash {
  const root = doc.documentElement;
  /** O splash tirado do DOM pelo `hide`, guardado para a página de erro poder voltar. */
  let detached: HTMLElement | null = null;
  return {
    setProgress(fraction) {
      const p = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));
      const splash = doc.getElementById(SPLASH_ID);
      splash?.style.setProperty('--bf-p', p.toFixed(3));
      splash?.setAttribute('data-progress', '');
    },
    show(state) {
      if (state === 'loading') {
        root.removeAttribute('data-bf');
        return;
      }
      root.setAttribute('data-bf', state);
      const splash = doc.getElementById(SPLASH_ID) ?? detached;
      if (!splash) return;
      // Aviso por cima da canvas: cancela o fade de saída (se ainda estiver no meio) e volta para o DOM.
      splash.classList.remove('bf-out');
      if (!splash.isConnected) doc.body.appendChild(splash);
      detached = null;
    },
    hide() {
      const splash = doc.getElementById(SPLASH_ID);
      if (!splash) return;
      const remove = (): void => {
        // Um aviso ligado durante o fade (`show`) tira a classe: aí o splash fica.
        if (!splash.classList.contains('bf-out')) return;
        splash.remove();
        detached = splash;
      };
      splash.classList.add('bf-out');
      splash.addEventListener('transitionend', remove, { once: true });
      (doc.defaultView ?? window).setTimeout(remove, HIDE_FALLBACK_MS);
    },
  };
}

export interface WebBoot {
  readonly platform: WebPlatform;
  setProgress(fraction: number): void;
  /** Troca o splash pela canvas. Chamar quando o primeiro frame do título já estiver desenhado. */
  reveal(): void;
  /**
   * Falha que para o jogo (asset essencial, shader, exceção no frame): mostra a página "Não deu para carregar", antes
   * ou depois do `reveal` (depois, o splash volta por cima da canvas congelada e o pointer lock é solto).
   */
  fail(error: unknown): void;
}

/**
 * Confere o navegador, cria a plataforma e devolve o controle do splash. Devolve `null` quando o navegador não serve
 * (a página de aviso já está na tela, pelo script inline do index.html ou por aqui) ou quando a plataforma não sobe.
 */
export function bootWeb(options: WebPlatformOptions = {}): WebBoot | null {
  const win = window;
  const doc = document;
  const log = createLogger('boot');
  const splash = getSplash(doc);

  // O script inline do index.html já mostrou o aviso de navegador antigo ou sem WebGL2.
  const early = doc.documentElement.getAttribute('data-bf');
  if (early === 'es' || early === 'webgl2') return null;
  const unsupported = detectUnsupported(readCapabilityEnv(win));
  if (unsupported) {
    splash.show(unsupported);
    return null;
  }

  let platform: WebPlatform;
  try {
    platform = createWebPlatform(options);
  } catch (error) {
    if (error instanceof WebGl2UnavailableError) splash.show('webgl2');
    else {
      log.error('a platform-web não subiu', error);
      splash.show('error');
    }
    return null;
  }
  win.__bfBooted = true;
  // Um erro solto antes do boot (ex.: extensão do navegador) pode ter ligado o aviso "error"; se chegamos aqui, subiu.
  if (early === 'error') splash.show('loading');
  let revealed = false;

  return {
    platform,
    setProgress: splash.setProgress,
    reveal() {
      if (revealed) return;
      revealed = true;
      splash.setProgress(1);
      splash.hide();
    },
    fail(error) {
      log.error(revealed ? 'falha no jogo' : 'falha no carregamento', error);
      if (revealed && doc.pointerLockElement) doc.exitPointerLock();
      splash.show('error');
    },
  };
}
