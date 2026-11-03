// Orçamentos do render (tecnico.md §6.5, §16.3; regra 8). Só constantes: nada aqui importa three.

/** Teto de programas de shader compilados (regra 8). O F2 e o e2e conferem `stats.programs`. */
export const MAX_SHADER_PROGRAMS = 7;

/** Camadas do array de blocos (mínimo garantido de MAX_ARRAY_TEXTURE_LAYERS no WebGL2). */
export const MAX_BLOCK_LAYERS = 256;

/** Capacidade inicial de atores (64 bots + 4 locais + folga); cresce se o `ActorBuffer` for maior. */
export const INITIAL_ACTOR_CAPACITY = 72;

/** Início da fog como fração do fim (arte-ux.md §1.9: 60/140 no PC, 40/90 no celular, 25/50 no Switch 3–4P). */
export const FOG_START_FRACTION = 0.45;
