import type { NavMetrics } from '@boboforces/nav';
import { METRICS } from './metrics.ts';

/**
 * Medidas do bobo para a navegação (o nav não importa a sim). Derivadas da tabela canônica: mudou lá, muda aqui.
 * Queda máxima da IA: 3 m (tecnico.md §8.1).
 */
export const BOBO_NAV_METRICS: NavMetrics = {
  height: METRICS.aabbHeight,
  crouchHeight: METRICS.aabbCrouchHeight,
  radius: METRICS.aabbWidth / 2,
  stepHeight: METRICS.stepHeight,
  jumpHeight: METRICS.jumpHeight,
  maxDrop: 3,
};
