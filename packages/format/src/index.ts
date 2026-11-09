// @boboforces/format: contratos de dados versionados (boboforces/<tipo>@<n>), IDs de conteúdo, validadores e
// migrações. Puro e determinístico: sem Math.random, Date.now ou performance.now (regra 10).
export * from './version.ts';
export * from './format-id.ts';
export * from './content-ids.ts';
export * from './validation.ts';
export * from './migrations.ts';
export * from './platform-profiles.ts';
export * from './match-recipe.ts';
export * from './bot.ts';
// M2 (fase 4b): os documentos do jogador.
export * from './doc-read.ts';
export * from './settings.ts';
export * from './stats.ts';
// M2 (fase 6c): o Meu Bobo.
export * from './bobo.ts';
export * from './backup.ts';
export * from './presets.ts';
export * from './png.ts';
// M1: manifesto de camadas dos texture arrays, `map@1` (frente mapa-nav) e `model@1` + o boneco do FutBobo (#56;
// frente skins-modelos e o porte).
export * from './layers.ts';
export * from './audio-loop.ts';
export * from './map/index.ts';
export * from './model/index.ts';
