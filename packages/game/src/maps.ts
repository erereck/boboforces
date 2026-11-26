import { t, type StringKey } from '@boboforces/ui';

/**
 * M2 (fase 5c): os mapas dos menus e os modos de cada um (os mesmos do `meta.modes` do `.bfmap`, conferidos no teste:
 * o menu não carrega mapa). O Ringue é pequeno: TDM até 4 contra 4 (X1, 2v2) e o Bobo Training; FFA não.
 */
export const MENU_MAPS = [
  'construto',
  'ringue',
  'posto',
  'base',
  'airbase',
  'island',
  'construction',
  'port',
  'moonbase',
] as const;
export type MenuMap = (typeof MENU_MAPS)[number];

// M9 (fase 3): o Bobo Sandbox nos mapas com casa no chão para os times 2 e 3 (o Construto e o Ringue). M10 (fase 8):
// também a Base Bobo, agora que a casa deles prefere os nós no chão das bases (antes, 3 dos 4 pontos caíam em cima dos
// quebra-vistas de 2,5 m das rotas oeste e leste).
export const MAP_MODES: Readonly<Record<MenuMap, readonly string[]>> = {
  construto: ['warfare.tdm', 'warfare.ffa', 'warfare.domination', 'zombies', 'sandbox'],
  ringue: ['warfare.tdm', 'training', 'sandbox'],
  // M3 (fase 3d): o Posto Avançado é só do Bobo Zombies (janelas e porta paga).
  posto: ['zombies'],
  // M3 (fase 5a): a Base Abandonada, o mapa do Bobo Zombies.
  base: ['zombies'],
  // M7 (fase 1): a Base Bobo, o mapa do BoboStrike (2 sites); também joga TDM e (M10, fase 8) o Sandbox.
  airbase: ['strike', 'warfare.tdm', 'sandbox'],
  // M7 (fase 5): a Ilha Tropical, o mapa do Bobo Royale Mini (~200 m; aberta demais para os outros modos).
  island: ['royale.mini'],
  // M10 (fase 2): o Canteiro de Obras (TDM, FFA e o Sandbox; as casas dos times 2 e 3 caem no chão das rotas de fora).
  construction: ['warfare.tdm', 'warfare.ffa', 'sandbox'],
  // M10 (fase 1): o Porto de Contêineres (médio, espelhado; 3 pontos e casa no chão para os times 2 e 3 do Sandbox).
  port: ['warfare.tdm', 'warfare.ffa', 'warfare.domination', 'sandbox'],
  // M10 (fase 4): a Estação Lunar (a gravidade da Lua em todo modo); o Bobo Chaos é o card dos Times com a Roleta nela.
  moonbase: ['warfare.tdm', 'warfare.ffa', 'sandbox'],
};

/**
 * M10 (fase 4, revisão): a gravidade de série dos mapas que têm uma (o `meta.gravity` do `.bfmap`, conferido no teste:
 * o menu não carrega mapa). A Partida personalizada mostra a gravidade que vale e o Surpreenda-me não sorteia lá a Lua
 * (não muda nada) nem o Arcade (a sim desliga num mapa de gravidade baixa, `resolveMapMovementProfile`).
 */
export const MAP_GRAVITY: Readonly<Partial<Record<MenuMap, number>>> = { moonbase: 0.35 };

export function mapGravity(map: string): number {
  return MAP_GRAVITY[map as MenuMap] ?? 1;
}

/** Teto de bots do mapa (o do aparelho vale por cima): o Ringue cabe 8 bobos; a Base Bobo, 10 (5 contra 5). */
const MAP_BOT_CAP: Readonly<Partial<Record<MenuMap, number>>> = { ringue: 7, airbase: 9 };

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
