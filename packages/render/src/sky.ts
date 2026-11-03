// Presets de luz (sem three). Dia, entardecer e noite são só uniforms (tecnico.md §6.4); o mapa escolhe o preset e a
// direção do sol. Valores [PROPOSTA] até os prints da cena-vitrine (M1): sol quente, céu azulado (arte-ux.md §1.1).
import type { SkyParams } from './types.ts';

function sunDir(x: number, y: number, z: number): { sunDirX: number; sunDirY: number; sunDirZ: number } {
  const len = Math.hypot(x, y, z);
  return { sunDirX: x / len, sunDirY: y / len, sunDirZ: z / len };
}

export const SKY_PRESETS = {
  day: {
    ...sunDir(0.45, 0.8, 0.3),
    sunColor: 0xffe7c2,
    skyColor: 0xb4cbe8,
    emissiveColor: 0xffd56b,
    fogColor: 0xc6d8ea,
  },
  dusk: {
    ...sunDir(-0.8, 0.25, 0.2),
    sunColor: 0xffa860,
    skyColor: 0x8a86b0,
    emissiveColor: 0xffd56b,
    fogColor: 0xd9a383,
  },
  night: {
    ...sunDir(0.2, 0.7, -0.6),
    sunColor: 0x46557a,
    skyColor: 0x34405e,
    emissiveColor: 0xffd56b,
    fogColor: 0x141a2a,
  },
} as const satisfies Readonly<Record<string, SkyParams>>;

export type SkyPresetName = keyof typeof SKY_PRESETS;
