// Casca do Switch (nx.js, application mode). O esbuild (`scripts/build.ts`) gera `romfs/main.js` com
// `__PLATFORM__ = 'switch'` e `__ONLINE__ = false`; o portcheck varre esse bundle e dá boot nele em `node:vm` com
// globais falsos do nx.js. Sem WebGL2 (applet, ou o vm do portcheck) o jogo sobe com o NullRenderer e a tela mostra
// o aviso de abrir em modo aplicativo.
import { startGame, type GameHandle } from '@boboforces/game';
import { createMsdfUiPass, createRenderer } from '@boboforces/render';
import { t } from '@boboforces/ui';
import { createSwitchShell, describeBuild, describeError, type SwitchShell } from './platform/index.ts';

declare const __PLATFORM__: string;
declare const __ONLINE__: boolean;

// Textos da casca fora da UI do jogo, pela tabela pt-BR. Sem GPU o aviso sai em Canvas 2D; com GPU (falha no boot) sai
// pelo próprio WebGL2, numa fonte bitmap mínima (o canvas já é WebGL2 e não aceita um contexto 2D).
const NOTICE_NO_GPU = [t('switch.needApplicationMode'), t('switch.pressPlusToExit')];
const NOTICE_BOOT_FAILED = [t('switch.bootFailed'), t('switch.bootFailedHint')];

/** O que a casca deixa no global para depuração (nxlink) e para o portcheck, como o `MMM_SWITCH` do MMM. */
export interface SwitchDebugHandle {
  readonly shell: SwitchShell;
  readonly game: GameHandle | null;
  readonly bootError: string | null;
}

const shell = createSwitchShell();
shell.log(
  `boot BoboForces ${describeBuild(shell.build)} · ${__PLATFORM__} · online ${__ONLINE__ ? 'sim' : 'não'} · ` +
    `GPU ${shell.hasGpu ? 'WebGL2' : 'ausente (applet?)'}`,
);
if (!shell.hasGpu) shell.showNotice(NOTICE_NO_GPU);

let game: GameHandle | null = null;
let bootError: string | null = null;
try {
  game = startGame({
    platform: shell.platform,
    // Switch: 720p fixo, sem AA e DPR 1 (tecnico.md §6.10). Nada de `setAnimationLoop` (o nx.js não declara `self`):
    // o laço é o `platform.requestFrame` do game.
    createRenderer: shell.hasGpu
      ? (surface) => createRenderer(surface, { antialias: false, maxPixelRatio: 1 }, (three) => createMsdfUiPass(three))
      : null,
    hooks: {
      onError: (error) => {
        // O game já gravou o erro no runtime.log; sem GPU o aviso de boot já está na tela.
        if (shell.hasGpu) shell.showNotice(NOTICE_BOOT_FAILED);
        bootError ??= describeError(error);
      },
    },
  });
} catch (error) {
  bootError = describeError(error);
  shell.log(`FALHA NO BOOT ${bootError}`);
  shell.showNotice(NOTICE_BOOT_FAILED);
}

const debug: SwitchDebugHandle = {
  shell,
  get game() {
    return game;
  },
  get bootError() {
    return bootError;
  },
};
(globalThis as { BOBOFORCES_SWITCH?: SwitchDebugHandle }).BOBOFORCES_SWITCH = debug;
