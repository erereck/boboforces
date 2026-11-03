// @boboforces/ai: cérebros de bot. Cada bot gera um InputFrame igual ao de um humano (mesmas regras, replays de graça).
// Puro e determinístico: RNG com semente (um fluxo por bot: `rng.fork('bot', i)`), orçamento em unidades de trabalho.
// M0 (frente b): bot mínimo para o golden e o robô de balanceamento: anda até o alvo e atira com o modelo de mira.
export * from './skill.ts';
export * from './director.ts';
export * from './headless.ts';
