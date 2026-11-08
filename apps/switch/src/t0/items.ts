// Itens de teste do título no Switch (contrato `GameDeps.testItems`; docs/TESTE_ZERO.md): os presets do bench do
// Teste Zero (tecnico.md §24.1 e §24.3) e as telas de teste da casca (controles, teclado, áudio).
import { BENCH_DEFAULTS, type BenchConfig, type TestItem } from '@boboforces/game';
import { startAudioTest } from './runners/audio.ts';
import { startControllersTest } from './runners/controllers.ts';
import { startKeyboardTest } from './runners/keyboard.ts';
import { labelKey } from './strings.ts';

const bench = (over: Partial<BenchConfig>): BenchConfig => ({ ...BENCH_DEFAULTS, ...over });

/**
 * Presets do bench. Os dois primeiros são os critérios de aprovação; os de estresse procuram a folga (item 12); o
 * plano B mede as rotas de reserva (atlas + atributos float) no mesmo Teste Zero; o de GPU força `gl.finish()` por
 * frame (item 10), por isso fica separado e curto.
 */
export const SWITCH_BENCH_PRESETS = {
  /** Critério 1: dock, 4 vistas, 12 bots armados, visão de 50 m, 10 min (p99 ≤ 40 ms). */
  dock: bench({ views: 4, bots: 12, viewDistanceM: 50, durationS: 600 }),
  /** Critério 2: 1 jogador, 24 bots, visão de 90 m. */
  solo: bench({ views: 1, bots: 24, viewDistanceM: 90, durationS: 300 }),
  /** Estresse: o cenário da dock com 24 zumbis a mais. */
  zombies: bench({ views: 4, bots: 12, zombies: 24, viewDistanceM: 50, durationS: 120 }),
  /** Estresse: 48 bots armados. */
  bots48: bench({ views: 4, bots: 48, viewDistanceM: 50, durationS: 120 }),
  /** Plano B: atlas com padding + atributos em float, no cenário da dock. */
  planB: bench({
    views: 4,
    bots: 12,
    viewDistanceM: 50,
    durationS: 120,
    textureMode: 'atlas',
    vertexAttributes: 'float',
  }),
  /** Tempo de GPU com `gl.finish()` (derruba o FPS; só para ler a GPU). */
  gpu: bench({ views: 4, bots: 12, viewDistanceM: 50, durationS: 60, gpuFinish: true }),
} as const satisfies Readonly<Record<string, BenchConfig>>;

/**
 * Itens do título, na ordem do foco. Rótulos pelas chaves CURTAS `test.item.*` (decisão #54): com a Russo One os
 * textos longos estouravam o botão; acima de 4 itens o título do ui monta a grade de 2 colunas. O detalhe de cada
 * preset (vistas, bots, visão) sai na 1ª linha do relatório do bench no runtime.log.
 */
export function createSwitchTestItems(): readonly TestItem[] {
  const p = SWITCH_BENCH_PRESETS;
  return [
    { id: 'bench-dock', labelKey: 'test.item.benchDock', bench: p.dock },
    { id: 'bench-solo', labelKey: 'test.item.benchSolo', bench: p.solo },
    { id: 'bench-zombies', labelKey: 'test.item.benchZombies', bench: p.zombies },
    { id: 'bench-bots48', labelKey: 'test.item.benchStress', bench: p.bots48 },
    // Chave nova pedida à ui-fontes; até entrar na tabela o botão mostra "Bench".
    { id: 'bench-planb', labelKey: labelKey('test.item.benchPlanB', 'test.item.bench'), bench: p.planB },
    { id: 'bench-gpu', labelKey: 'test.item.benchGpu', bench: p.gpu },
    { id: 'controllers', labelKey: 'test.item.controllers', start: startControllersTest },
    { id: 'keyboard', labelKey: 'test.item.keyboard', start: startKeyboardTest },
    { id: 'audio', labelKey: 'test.item.audio', start: startAudioTest },
  ];
}
