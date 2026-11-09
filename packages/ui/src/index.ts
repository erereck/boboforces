// @boboforces/ui: árvore de UI, layout por âncoras e safe area, foco espacial, texto MSDF e DrawList (sem GL), tokens
// do tema escuro e a tabela de textos pt-BR. Puro (sem DOM): o render desenha a DrawList; a casca nunca desenha UI do
// jogo em DOM (decisão #3).
export * from './strings.pt-BR.ts';
export * from './text.ts';
export * from './tokens.ts';
export * from './draw-list.ts';
export * from './font.ts';
export * from './tree.ts';
export * from './layout.ts';
export * from './focus.ts';
export * from './draw.ts';
export * from './screens/title.ts';
export * from './screens/settings.ts';
export * from './screens/main-menu.ts';
export * from './screens/surprise.ts';
export * from './screens/quick-match.ts';
export * from './screens/modes.ts';
export * from './screens/custom-match.ts';
// M1 (contratos; desenho da frente ui-fontes): HUD por vista, painel F2 e tela genérica de teste.
export * from './screens/hud.ts';
export * from './screens/debug-panel.ts';
// M2 (fase 2d): kill feed, placar do Tab e contagem inicial.
export * from './screens/match-hud.ts';
export * from './screens/test-screen.ts';
// Escolhas dos prints (decisão #54; contrato, desenho da frente ui-fontes): a folha das fontes em uso, que substitui a
// comparação das candidatas.
export * from './screens/font-specimen.ts';
// M1 (frente ui-fontes): tela de loading por etapas e os pincéis sem alocação (texto, números, ícones, barras).
export * from './screens/loading.ts';
export * from './paint.ts';
