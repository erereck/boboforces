// @boboforces/game: fluxo do jogo (boot → título → cena de teste no M0; menu → lobby → partida depois), cola dos
// pacotes e LocalDriver. Só conversa com o mundo pela `Platform` injetada. NUNCA importa `net` (regra 4) e do render
// importa só TIPOS e o subcaminho sem three (`@boboforces/render/data`): o renderer real chega por
// `GameDeps.createRenderer`.
export {
  startGame,
  MENU_READY_MARKER,
  type GameDeps,
  type GameHandle,
  type GameHooks,
  type GameScreen,
} from './game.ts';
export { createNullRenderer } from './null-renderer.ts';
export { createLocalDriver, type LocalDriver, type LocalDriverConfig, type MatchDriver } from './local-driver.ts';
export { GAME_ASSETS, loadGameAssets, parseBlockManifest, type GameAssets } from './assets.ts';
export { createTestScene, pauseScreen, PAUSE_ACTION, testSceneRecipe, type TestScene } from './test-scene.ts';
export { verticalFov, DEFAULT_FOV_DEG } from './camera.ts';
