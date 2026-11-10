import { t, type StringKey } from '@boboforces/ui';

/**
 * M2 (fase 5c): os mapas dos menus e os modos de cada um (os mesmos do `meta.modes` do `.bfmap`, conferidos no teste:
 * o menu não carrega mapa). O Ringue é pequeno: TDM até 4 contra 4 (X1, 2v2) e o Bobo Training; FFA não.
 */
export const MENU_MAPS = ['construto', 'ringue', 'posto'] as const;
export type MenuMap = (typeof MENU_MAPS)[number];

export const MAP_MODES: Readonly<Record<MenuMap, readonly string[]>> = {
  construto: ['warfare.tdm', 'warfare.ffa', 'zombies'],
  ringue: ['warfare.tdm', 'training'],
  // M3 (fase 3d): o Posto Avançado é só do Bobo Zombies (janelas e porta paga).
  posto: ['zombies'],
};

/** Teto de bots do mapa (o do aparelho vale por cima): o Ringue cabe 8 bobos. */
const MAP_BOT_CAP: Readonly<Partial<Record<MenuMap, number>>> = { ringue: 7 };

export function mapsForMode(mode: string): MenuMap[] {
  return MENU_MAPS.filter((m) => MAP_MODES[m].includes(mode));
}

/** O mapa vale para o modo? Se não, o primeiro que vale (o Construto). */
export function mapForMode(map: string, mode: string): MenuMap {
  const ok = mapsForMode(mode);
  return (ok as readonly string[]).includes(map) ? (map as MenuMap) : (ok[0] ?? 'construto');
}

export function mapBotCap(map: string, maxBots: number): number {
  return Math.min(maxBots, MAP_BOT_CAP[map as MenuMap] ?? maxBots);
}

export function mapName(map: string): string {
  return (MENU_MAPS as readonly string[]).includes(map) ? t(`map.${map}` as StringKey) : map;
}
