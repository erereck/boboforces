// M1: ambiente da cena por uniforms (tecnico.md §6.4 e §6.9, arte-ux.md §1.8–§1.11). Sem three: o `game` monta o
// estado e chama `Renderer.setEnvironment` (pode ser todo frame). Dia, Entardecer e Noite são SÓ uniforms sobre a mesma
// malha. Os valores dos presets são [PROPOSTA] da frente "render-mundo" até os prints do M1 (print 1).
import type { TimeOfDay } from '@boboforces/format';
import { FOG_START_FRACTION } from './limits.ts';

/** Cores 0xRRGGBB, sem conversão sRGB→linear (texturas, luz e fog falam o mesmo espaço, como no M0). */
export interface TimeOfDayParams {
  readonly sunColor: number;
  /** Céu no zênite e no horizonte (o domo é um gradiente de 3 cores; a fog usa a do horizonte). */
  readonly zenithColor: number;
  readonly horizonColor: number;
  /** Cor de baixo do domo e do hemisfério de luz que vem do chão. */
  readonly groundColor: number;
  /** Cor da luz de céu nos blocos (multiplica o canal céu). */
  readonly skyLightColor: number;
  readonly emissiveColor: number;
  /** Intensidades: sol (N·L) e céu. */
  readonly sunStrength: number;
  readonly skyStrength: number;
  /** Estrelas (0 de dia, 1 à noite) e lua no lugar do sol. */
  readonly stars: number;
  /** Color grading (LUT 1D de 256 px gerada da curva): força 0..1, saturação e contraste. */
  readonly gradeStrength: number;
  readonly gradeSaturation: number;
  readonly gradeContrast: number;
}

export const TIME_OF_DAY_PRESETS: Readonly<Record<TimeOfDay, TimeOfDayParams>> = {
  day: {
    sunColor: 0xffe7c2,
    zenithColor: 0x6f9fd8,
    horizonColor: 0xc6d8ea,
    groundColor: 0x7e8a80,
    skyLightColor: 0xb4cbe8,
    emissiveColor: 0xffd56b,
    sunStrength: 0.55,
    skyStrength: 0.85,
    stars: 0,
    gradeStrength: 0.3,
    gradeSaturation: 1.05,
    gradeContrast: 1.05,
  },
  dusk: {
    sunColor: 0xffa860,
    zenithColor: 0x4b4f86,
    horizonColor: 0xd9a383,
    groundColor: 0x5d5560,
    skyLightColor: 0x8a86b0,
    emissiveColor: 0xffd56b,
    sunStrength: 0.6,
    skyStrength: 0.7,
    stars: 0.2,
    gradeStrength: 0.5,
    gradeSaturation: 1.1,
    gradeContrast: 1.05,
  },
  night: {
    sunColor: 0x46557a,
    zenithColor: 0x0a0f1e,
    horizonColor: 0x141a2a,
    groundColor: 0x161c28,
    // Lua fraca e céu azulado: escuro, mas o bobo ainda lê na sombra (os emissivos acendem o resto).
    skyLightColor: 0x4a5a80,
    emissiveColor: 0xffd56b,
    sunStrength: 0.35,
    skyStrength: 0.7,
    stars: 1,
    gradeStrength: 0.5,
    gradeSaturation: 0.9,
    gradeContrast: 1.1,
  },
};

/**
 * Estado do ambiente (struct mutável: criar uma vez com `createEnvironment` e mudar campos; nada de objeto novo por
 * frame). A direção do sol é do MAPA (a sombra do cenário foi calculada com ela); a hora do dia só troca cores.
 */
export interface EnvironmentState {
  timeOfDay: TimeOfDay;
  /** Direção PARA o sol (unitária, do `.bfmap`). À noite vira a direção da lua. */
  sunDirX: number;
  sunDirY: number;
  sunDirZ: number;
  /** Alcance de visão da partida em metros (= fim da fog = plano distante): min(regra, teto do perfil). */
  viewDistanceM: number;
  /** Início da fog como fração do alcance (padrão `FOG_START_FRACTION`). */
  fogStartFraction: number;
  /** Relógio das animações em segundos (nuvens, vento, texturas animadas, emissivos pulsando). Só cresce. */
  timeS: number;
  /** Luz ambiente extra 0..1 do clarão de tiro (por 80 ms, arte-ux.md §1.8); o `game` decai. */
  flash: number;
  /** Força do vento na vegetação 0..1 (0 no perfil leve). */
  wind: number;
}

export function createEnvironment(): EnvironmentState {
  return {
    timeOfDay: 'day',
    sunDirX: 0.45 / Math.hypot(0.45, 0.8, 0.3),
    sunDirY: 0.8 / Math.hypot(0.45, 0.8, 0.3),
    sunDirZ: 0.3 / Math.hypot(0.45, 0.8, 0.3),
    viewDistanceM: 90,
    fogStartFraction: FOG_START_FRACTION,
    timeS: 0,
    flash: 0,
    wind: 1,
  };
}
