import type { PlatformFeatures } from '@boboforces/platform-api';
import type { Disposable } from '@boboforces/shared';

interface FullscreenOptionsWithUi extends FullscreenOptions {
  readonly navigationUI?: 'hide' | 'show' | 'auto';
}
interface LockableOrientation {
  lock?(orientation: 'landscape'): Promise<void>;
}

/**
 * Pegadinhas do navegador que a casca resolve sozinha (tecnico.md §11.1). O resto da lista mora onde faz sentido:
 * menu de contexto do canvas na graphics, Esc/voltar/aba oculta na lifecycle, botões 3 e 4 do mouse no adaptador de
 * input, seleção/pinça/overscroll no CSS do index.html.
 * - `gesturestart` bloqueado (pinça do Safari no iOS, que ignora `touch-action`);
 * - no celular, o primeiro toque pede tela cheia sem a barra de navegação e tenta travar em paisagem (só funciona em
 *   tela cheia; no iPhone não existe e a dica "Adicionar à Tela de Início" fica com o jogo).
 */
export function installShellGuards(win: Window, features: PlatformFeatures): Disposable {
  const doc = win.document;
  let fullscreenTried = false;

  function onGestureStart(event: Event): void {
    event.preventDefault();
  }

  function onFirstTouch(event: PointerEvent): void {
    if (event.pointerType !== 'touch' || fullscreenTried) return;
    fullscreenTried = true;
    doc.removeEventListener('pointerdown', onFirstTouch, true);
    const root = doc.documentElement;
    const installed = typeof win.matchMedia === 'function' && win.matchMedia('(display-mode: fullscreen)').matches;
    if (installed || doc.fullscreenElement || typeof root.requestFullscreen !== 'function') return;
    const options: FullscreenOptionsWithUi = { navigationUI: 'hide' };
    root.requestFullscreen(options).then(
      () => {
        const orientation = win.screen.orientation as (ScreenOrientation & LockableOrientation) | undefined;
        orientation?.lock?.('landscape').catch(() => {});
      },
      () => {},
    );
  }

  doc.addEventListener('gesturestart', onGestureStart);
  if (features.profileHint === 'mobile') doc.addEventListener('pointerdown', onFirstTouch, true);

  return {
    dispose() {
      doc.removeEventListener('gesturestart', onGestureStart);
      doc.removeEventListener('pointerdown', onFirstTouch, true);
    },
  };
}
