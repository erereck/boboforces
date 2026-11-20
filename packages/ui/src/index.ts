// @boboforces/ui: árvore de UI, layout por âncoras e safe area, foco espacial, texto MSDF e DrawList (sem GL), tokens
// do tema escuro e a tabela de textos pt-BR. Puro (sem DOM): o render desenha a DrawList; a casca nunca desenha UI do
// jogo em DOM (decisão #3).
export * from './strings.pt-BR.ts';
// Refino R3a (#79): a tabela da cena e das telas de edição (só quem a importa a carrega).
export * from './strings-extra.pt-BR.ts';
// M5 (fase 4c): a tabela das telas do Online (só o pedaço do Online a importa).
export * from './strings-online.pt-BR.ts';
// M9 (fase 0): a tabela do Switch (os avisos da casca e as telas de teste; só o Switch e a prévia do título dele).
export * from './strings-switch.pt-BR.ts';
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
export * from './screens/tabbed.ts';
export * from './screens/surprise.ts';
export * from './screens/quick-match.ts';
export * from './screens/modes.ts';
export * from './screens/custom-match.ts';
export * from './screens/news.ts';
export * from './screens/rotate.ts';
export * from './screens/workshop.ts';
// M8 (fase 1): compartilhar por código e por link.
export * from './screens/share.ts';
export * from './screens/lab.ts';
export * from './screens/lab-intro.ts';
export * from './screens/couch.ts';
// M5 (fase 4c): as telas do Online (só o pedaço do Online usa).
export * from './screens/online.ts';
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
