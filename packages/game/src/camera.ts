import type { PlatformFeatures } from '@boboforces/platform-api';
import { DEG_TO_RAD } from '@boboforces/shared';

/**
 * FOV padrão por família, HORIZONTAL em 16:9 (gameplay.md §3.5: PC 90; celular e Switch 80). Vira opção do jogador
 * no `settings@1` (M2).
 */
export const DEFAULT_FOV_DEG = { pc: 90, mobile: 80, switch: 80 } as const;

/**
 * Hor+ com limites (tecnico.md §6.8, arte-ux.md §6.6): o FOV vertical é o do FOV horizontal em 16:9 e fica fixo; telas
 * mais largas ganham horizontal até 110° (2P horizontal, 32:9) e as mais estreitas não descem de 80° (2P vertical).
 */
export const HOR_FOV_LIMITS_DEG = { min: 80, max: 110 } as const;

/** Zoom do ADS (decisão #11): o FOV encolhe para esta fração; a transição leva `ADS_BLEND_S`. */
export const ADS_FOV_SCALE = 0.75;
export const ADS_BLEND_S = 0.12;

const REFERENCE_ASPECT = 16 / 9;

/** FOV vertical em radianos para a proporção da viewport. */
export function verticalFov(horizontalFovDeg: number, aspect: number): number {
  const a = aspect > 0 ? aspect : REFERENCE_ASPECT;
  const halfTan = Math.tan((horizontalFovDeg * DEG_TO_RAD) / 2) / REFERENCE_ASPECT;
  const horizontalNow = 2 * Math.atan(halfTan * a);
  const max = HOR_FOV_LIMITS_DEG.max * DEG_TO_RAD;
  const min = Math.min(HOR_FOV_LIMITS_DEG.min, horizontalFovDeg) * DEG_TO_RAD;
  if (horizontalNow > max) return 2 * Math.atan(Math.tan(max / 2) / a);
  if (horizontalNow < min) return 2 * Math.atan(Math.tan(min / 2) / a);
  return 2 * Math.atan(halfTan);
}

export function defaultFovFor(features: PlatformFeatures): number {
  return DEFAULT_FOV_DEG[features.profileHint];
}
