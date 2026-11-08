// `model@1` (`.bfmodel`), o boneco do FutBobo (#56) e o que ficou do bobo de caixas (cruz das caixas, expressões,
// zumbis). Tipos e dados = contrato do M1; codificador, decodificador, validador e posicionamento de props são da frente
// "skins-modelos".
//
// Layout do `.bfmodel` (little-endian), todo comprimido com deflate cru:
//   u32 magia `BFMODEL_MAGIC` · u16 versão (1) · u16 nº de modelos · por modelo: u32 tamanho · conteúdo do modelo.
// O conteúdo de cada modelo (caixas e malhas em inteiros, nomes numa tabela de strings) está documentado em
// `codec.ts`. Versão 0 = arquivo provisório (recusado com "rode npm run modelgen").
//
// - `encodeModelPack(pack)` / `decodeModelPack(bytes)`: `codec.ts`.
// - `validateModel(model)`: `validate.ts` (ID registrado, peças com mãe antes da filha, teto de triângulos por tipo,
//   soquetes obrigatórios das armas, UV dentro de 64×64, camadas nomeadas); `validateModelLayers` confere as camadas
//   contra o manifesto de `modelos64`.
// - `paintFigureSkin`: `figure-paint.ts` (as 2 camadas da skin do boneco, pintadas no loading). A composição do
//   `skinparts@2` e a ampliação para 4 camadas do bobo A saíram no passo 5 do porte.
// - `propColliderBoxes` / `propNavCells`: `placement.ts` (colisores da prop posicionada no mapa).
export * from './types.ts';
export * from './bobo.ts';
export * from './codec.ts';
export * from './validate.ts';
export * from './placement.ts';
export * from './figure.ts';
export * from './figure-layout.ts';
export * from './figure-look.ts';
export * from './figure-paint.ts';
export * from './figure-presets.ts';
export * from './figure-template.ts';
export * from './figure-table.ts';
