/**
 * Passo fixo e capacidades do motor (tecnico.md §4.1 e §4.2). Humanos, bots e times vêm do `format` (ENGINE_MAX_*),
 * que é quem valida as receitas: sim e validador nunca divergem.
 */
import { ENGINE_MAX_BOTS, ENGINE_MAX_LOCAL_HUMANS, ENGINE_MAX_TEAMS, ENGINE_MAX_ZOMBIES } from '@boboforces/format';

/** Ticks por segundo. No Switch pode cair para 30 se o Teste Zero exigir [T0]: todo dado é em unidades/s. */
export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;
/** Teto de passos por frame de render (também limita a aceleração do Aquário). */
export const MAX_STEPS_PER_FRAME = 4;
/** Frame mais longo considerado (protege a volta de HOME, sleep e aba oculta). */
export const MAX_FRAME_SECONDS = 0.1;

/** Capacidades fixas (typed arrays são alocadas uma vez). */
export const MAX_ENTITIES = 1024;
export const MAX_HUMANS = ENGINE_MAX_LOCAL_HUMANS;
export const MAX_BOTS = ENGINE_MAX_BOTS;
export const MAX_PROJECTILES = 512;
export const MAX_PICKUPS = 256;
export const MAX_TEAMS = ENGINE_MAX_TEAMS;

/**
 * Controladores: índice no array de inputs de `Sim.step`. 0..3 = humanos (locais ou remotos), 4..67 = bots, na ordem
 * de expansão da receita (times em ordem, depois cada `bots[]` em ordem, `count` vezes).
 */
export const BOT_CONTROLLER_BASE = MAX_HUMANS;
export const MAX_CONTROLLERS = MAX_HUMANS + MAX_BOTS;

/**
 * M1: zumbis do teste de estresse (`SimConfig.zombies`). Controladores `ZOMBIE_CONTROLLER_BASE`.. (68..131), DEPOIS
 * de humanos e bots, para os índices dos bots (e o golden) não mudarem. O array de `step(inputs)` cresce até
 * `MAX_CONTROLLERS_WITH_ZOMBIES` só quando há zumbi (`Sim.controllerCount`).
 */
export const MAX_ZOMBIES = ENGINE_MAX_ZOMBIES;
export const ZOMBIE_CONTROLLER_BASE = MAX_CONTROLLERS;
export const MAX_CONTROLLERS_WITH_ZOMBIES = MAX_CONTROLLERS + MAX_ZOMBIES;

/** Converte segundos de dado em ticks (arredonda para o tick mais próximo, mínimo 0). */
export function secondsToTicks(seconds: number, hz: number = SIM_HZ): number {
  return Math.max(0, Math.round(seconds * hz));
}
