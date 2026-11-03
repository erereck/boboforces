import type { PlatformFeatures } from '@boboforces/platform-api';

/** O que a detecção lê do navegador (separado do `window` para dar para testar com dados sintéticos). */
export interface FeatureEnv {
  readonly userAgent: string;
  readonly maxTouchPoints: number;
  /** `navigator.userAgentData.mobile` (só Chromium); `undefined` quando não existe. */
  readonly mobileHint: boolean | undefined;
  matches(mediaQuery: string): boolean;
}

/**
 * Capacidades da web como dados (tecnico.md §16.1 e §17.2). `profileHint` só sugere: o perfil final (Alto, Médio,
 * Leve) sai do micro-bench do loading. Celular = Chromium dizendo `mobile`, user agent de celular, iPad se passando por
 * Mac (toque + "Macintosh") ou ponteiro principal grosso sem nenhum ponteiro fino.
 */
export function computeFeatures(env: FeatureEnv): PlatformFeatures {
  const anyFine = env.matches('(any-pointer: fine)');
  const coarse = env.matches('(pointer: coarse)');
  const uaMobile = env.mobileHint ?? /Android|iPhone|iPad|iPod|Mobile/i.test(env.userAgent);
  const iPadAsMac = /Macintosh/.test(env.userAgent) && env.maxTouchPoints > 1;
  const mobile = uaMobile || iPadAsMac || (coarse && !anyFine);
  return {
    profileHint: mobile ? 'mobile' : 'pc',
    touch: env.maxTouchPoints > 0 || env.matches('(any-pointer: coarse)'),
    // Celular com mouse/teclado bluetooth também conta (any-pointer: fine).
    keyboardMouse: anyFine || !mobile,
    reducedMotion: env.matches('(prefers-reduced-motion: reduce)'),
    // Na web não existe "sair": `exit()` volta ao título (ver platform/index.ts).
    canExit: false,
  };
}

interface NavigatorUaData {
  readonly userAgentData?: { readonly mobile?: boolean };
}

export function readFeatureEnv(win: Window): FeatureEnv {
  const nav = win.navigator;
  return {
    userAgent: nav.userAgent,
    maxTouchPoints: nav.maxTouchPoints || 0,
    mobileHint: (nav as Navigator & NavigatorUaData).userAgentData?.mobile,
    matches: (q) => (typeof win.matchMedia === 'function' ? win.matchMedia(q).matches : false),
  };
}
