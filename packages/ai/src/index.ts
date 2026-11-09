// @boboforces/ai: cérebros de bot. Cada bot gera um InputFrame igual ao de um humano (mesmas regras, replays de graça).
// Puro e determinístico: RNG com semente (um fluxo por bot: `rng.fork('bot', i)`), orçamento em unidades de trabalho.
// M1 (frente sim-ia): soldados N0 com percepção por orçamento de raios, LOD por distância aos humanos, rota pelo A* do
// `nav` com fila e seguidor de caminho, e zumbis de estresse que perseguem e batem.
export * from './skill.ts';
export * from './config.ts';
export * from './paths.ts';
export * from './director.ts';
export * from './headless.ts';
export * from './weapons.ts';
