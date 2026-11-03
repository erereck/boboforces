// Backend da UI no render: DrawList → 1 draw call por viewport (frente e). O `Renderer` usa `createUiPass` no
// `drawUi`; o `game` monta o atlas com `uiAtlasFromFontPack` e entrega ao renderer.
export * from './ui-batch.ts';
export * from './ui-shader.ts';
export * from './ui-pass.ts';
