// @boboforces/game: fluxo do jogo (boot → título → cena; menu → lobby → partida depois), cola dos pacotes e
// LocalDriver. Só conversa com o mundo pela `Platform` injetada. NUNCA importa `net` (regra 4) e do render importa só
// o subcaminho sem three (`@boboforces/render/data`): o renderer real chega por `GameDeps.createRenderer`. M1: a cena
// (o Construto) fica no subcaminho `@boboforces/game/scene`, que a casca carrega e entrega por `GameDeps.loadScene`.
export {
  startGame,
  MENU_READY_MARKER,
  VITRINE_ITEM_ID,
  type Editors,
  type GameDeps,
  type GameHandle,
  type GameHooks,
  type GameScreen,
} from './game.ts';
export { createNullRenderer } from './null-renderer.ts';
export * from './save-store.ts';
export { createLocalDriver, type LocalDriver, type LocalDriverConfig, type MatchDriver } from './local-driver.ts';
export { GAME_ASSETS, loadGameAssets, type GameAssets } from './assets.ts';
export { pauseScreen, PAUSE_ACTION } from './pause.ts';
export { verticalFov, DEFAULT_FOV_DEG } from './camera.ts';
export * from './scene-api.ts';
// M1: bench, gancho dos prints, itens de teste, linhas [t0] e caminhos dos assets.
export * from './bench/index.ts';
export { GAME_ASSETS_M1, TEXTURE_ARRAY_BASES, textureStripPaths } from './assets-m1.ts';
