// Casca do Switch (nx.js, application mode). O esbuild (`scripts/build.ts`) gera `romfs/main.js` com
// `__PLATFORM__ = 'switch'` e `__ONLINE__ = false`; o portcheck varre esse bundle e dá boot nele em `node:vm` com
// globais falsos do nx.js. Sem WebGL2 (applet, ou o vm do portcheck) o jogo sobe com o NullRenderer e a tela mostra
// o aviso de abrir em modo aplicativo.
//
// M1 (Teste Zero, docs/TESTE_ZERO.md): antes do renderer, as sondas de plataforma e de GL gravam linhas `[t0]` no
// runtime.log; o título ganha os itens de teste (presets do bench, controles, teclado, áudio) e o relatório do bench
// vai para o log linha a linha com `[bench] `.
import { BENCH_LOG_PREFIX, startGame, type GameHandle, type RendererRoutes } from '@boboforces/game';
import { SCENE_MODULE } from '@boboforces/game/scene';
import { createMsdfUiPass, createRenderer, type Renderer } from '@boboforces/render';
import type { GraphicsSurface } from '@boboforces/platform-api';
import { t } from '@boboforces/ui';
import { createSwitchShell, describeBuild, describeError, SD_DIR, type SwitchShell } from './platform/index.ts';
import { readAutoBench } from './t0/auto-bench.ts';
import { captureConsole, LATE_PROBES_DELAY_MS, runBootProbes, runLateProbes } from './t0/boot.ts';
import { applyInstancingFix } from './t0/gl-probes.ts';
import { createSwitchTestItems } from './t0/items.ts';
import { errorText, ms2 } from './t0/log.ts';

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
// Instanciamento adiado do Eden (gl-probes.ts): a cada boot, antes das sondas e do three. No console a detecção dá
// "normal" e o contexto fica intocado.
const bootGl = shell.platform.graphics.context as WebGL2RenderingContext | null;
if (bootGl) shell.log(applyInstancingFix(bootGl));
const consoleCapture = captureConsole(shell.nx.probes?.['console'], shell.log);
const probeEnv = {
  nx: shell.nx,
  gl: shell.platform.graphics.context,
  log: shell.log,
  now: () => shell.platform.now(),
  marker: {
    fs: shell.nx.Switch,
    dir: SD_DIR,
    build: shell.build ? `${shell.build.version} ${(shell.build.files['main.js'] ?? '?').slice(0, 16)}` : null,
  },
};
const probes = runBootProbes(probeEnv);
if (!shell.hasGpu) shell.showNotice(NOTICE_NO_GPU);

/** Renderer com o item 3 do T0: o three sobe com o shim? Quantos avisos de console saíram na criação? */
function createSwitchRenderer(surface: GraphicsSurface, routes?: RendererRoutes): Renderer {
  const before = consoleCapture.count();
  const t0 = shell.platform.now();
  try {
    // Switch: 720p fixo, sem AA e DPR 1 (tecnico.md §6.10). Nada de `setAnimationLoop` (o nx.js não declara `self`):
    // o laço é o `platform.requestFrame` do game.
    // As rotas do Teste Zero (plano B: atlas + float) chegam do bench; o game recria o renderer quando mudam.
    const renderer = createRenderer(surface, { antialias: false, maxPixelRatio: 1, ...(routes ?? {}) }, (three) =>
      createMsdfUiPass(three),
    );
    let three = '-';
    let threeWarnings = -1;
    try {
      three = renderer.info.threeRevision;
      threeWarnings = renderer.info.warnings.length;
    } catch {
      // `info` ainda é stub de outra frente: o item 3 sai sem esses campos
    }
    probes.t0(3, 'ok', {
      fonte: 'casca',
      ms: ms2(shell.platform.now() - t0),
      three,
      avisos_three: threeWarnings,
      avisos_console: consoleCapture.count() - before,
    });
    return renderer;
  } catch (error) {
    probes.t0(3, 'falha', { fonte: 'casca', erro: errorText(error), avisos_console: consoleCapture.count() - before });
    throw error;
  }
}

// `sdmc:/switch/boboforces/bench.json` (one-shot) começa direto no bench: Eden sem controle, rodadas repetidas.
const autoBench = shell.hasGpu ? readAutoBench(shell.nx.Switch, SD_DIR, shell.log) : undefined;

let game: GameHandle | null = null;
let bootError: string | null = null;
let lateProbesStarted = false;
try {
  game = startGame({
    platform: shell.platform,
    createRenderer: shell.hasGpu ? createSwitchRenderer : null,
    testItems: createSwitchTestItems(),
    // Um arquivo só (esbuild): a cena já está no bundle.
    loadScene: () => Promise.resolve({ module: SCENE_MODULE }),
    ...(autoBench ? { bench: autoBench } : {}),
    hooks: {
      onError: (error) => {
        // O game já gravou o erro no runtime.log; sem GPU o aviso de boot já está na tela.
        if (shell.hasGpu) shell.showNotice(NOTICE_BOOT_FAILED);
        bootError ??= describeError(error);
      },
      onBenchReport: (text) => {
        for (const line of text.split('\n')) shell.log(`${BENCH_LOG_PREFIX}${line}`);
        if (autoBench) startLateProbes();
      },
    },
  });
} catch (error) {
  bootError = describeError(error);
  shell.log(`FALHA NO BOOT ${bootError}`);
  shell.showNotice(NOTICE_BOOT_FAILED);
}

/**
 * Sondas tardias (8, 19 em silêncio, 20, 21). Sem bench automático, com o menu já na tela. Com o `bench.json`, só
 * depois do relatório: no meio do loading do Construto elas inflavam o `loading_ms` (0,2–0,5 s no Eden) e o
 * `decode_ms` do item 19 (verificação do M1).
 */
function startLateProbes(): void {
  if (lateProbesStarted) return;
  lateProbesStarted = true;
  runLateProbes(probeEnv, probes.t0, shell.platform).catch((error: unknown) =>
    shell.log(`[t0] sondas tardias: ${describeError(error)}`),
  );
}
if (!autoBench) shell.nx.setTimeout(startLateProbes, LATE_PROBES_DELAY_MS);

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
