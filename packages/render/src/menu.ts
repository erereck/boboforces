// Subcaminho `@boboforces/render/menu` (integração do M1): o que a web precisa para desenhar o MENU — o renderer só de
// UI e o passe MSDF —, sem puxar o mundo, os atores e os VFX para a carga inicial (o renderer completo vem com a cena,
// por `import()` na casca).
export { createMenuRenderer } from './menu-renderer.ts';
export { createMsdfUiPass, type MsdfUiPass, type MsdfUiPassStats } from './ui/ui-pass.ts';
export type { Renderer, RendererOptions } from './types.ts';
