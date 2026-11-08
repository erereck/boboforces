// Prévia do título do Switch na casca web (`?titulo=switch`), para o print do título com os 9 itens de teste
// (decisão #54: a grade de 2 colunas). O título é do `ui` (sem DOM) e decide tudo pelos dados que recebe: a
// plataforma (`id`, que escolhe o piso de texto da TV e tira o item da cena-vitrine; `canExit`, que põe o "Sair") e os
// itens de teste. Então a prévia não mexe em código compartilhado: a casca web entrega uma plataforma com a cara do
// Switch e os mesmos rótulos de `apps/switch/src/t0/items.ts` (o teste confere que as duas listas andam juntas).
//
// Os itens aqui não fazem nada (sem `bench` e sem `start`) e a prévia não carrega a cena: JOGAR só registra no log.
// É ferramenta de print; nada disso aparece sem a chave na URL.
import type { TestItem } from '@boboforces/game';
import type { Platform, PlatformFeatures } from '@boboforces/platform-api';

/** Chave da URL (`?titulo=switch`); o roteiro dos prints usa a mesma (`SWITCH_TITLE_QUERY`). */
export const TITLE_PREVIEW_PARAM = 'titulo';

/** A URL pede a prévia do título do Switch? */
export function urlAsksForSwitchTitle(search: string): boolean {
  const query = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  return query.get(TITLE_PREVIEW_PARAM)?.trim().toLowerCase() === 'switch';
}

/** Os 9 itens do título do Switch, na ordem do foco: só id e rótulo (`createSwitchTestItems` do apps/switch). */
export const SWITCH_TITLE_ITEMS: readonly TestItem[] = [
  { id: 'bench-dock', labelKey: 'test.item.benchDock' },
  { id: 'bench-solo', labelKey: 'test.item.benchSolo' },
  { id: 'bench-zombies', labelKey: 'test.item.benchZombies' },
  { id: 'bench-bots48', labelKey: 'test.item.benchStress' },
  { id: 'bench-planb', labelKey: 'test.item.benchPlanB' },
  { id: 'bench-gpu', labelKey: 'test.item.benchGpu' },
  { id: 'controllers', labelKey: 'test.item.controllers' },
  { id: 'keyboard', labelKey: 'test.item.keyboard' },
  { id: 'audio', labelKey: 'test.item.audio' },
];

/** As capacidades da platform-switch (`apps/switch/src/platform/index.ts`). */
export const SWITCH_PREVIEW_FEATURES: PlatformFeatures = {
  profileHint: 'switch',
  touch: false,
  keyboardMouse: false,
  reducedMotion: false,
  canExit: true,
};

/**
 * A plataforma da web com a cara do Switch para o título: `id` e capacidades trocados, o resto igual (gráficos,
 * assets, input e o `exit`, que na web recarrega a página e volta para a mesma prévia).
 */
export function asSwitchTitlePlatform<P extends Platform>(platform: P): P {
  return { ...platform, id: 'switch', features: SWITCH_PREVIEW_FEATURES };
}
