// @boboforces/input: ações, InputFrame, estado bruto padronizado, perfis de controle, mapeador, slots locais e
// navegação de menu. Puro (sem DOM): os eventos do navegador ficam nos adaptadores de apps/web; os do nx.js, em
// apps/switch. Fluxo: dispositivo → adaptador → RawInputState → perfil → ações → InputFrame (tecnico.md §10).
export * from './keys.ts';
export * from './raw.ts';
export * from './actions.ts';
export * from './frame.ts';
export * from './bindings.ts';
export * from './stick.ts';
export * from './touch.ts';
export * from './profiles.ts';
export * from './mapper.ts';
export * from './local-players.ts';
export * from './menu-input.ts';
export * from './remap.ts';
