// Ajudantes do motor de animação portados do FutBobo (`character.ts:764-1023`), escalares e sem alocação: o V8 inlina
// estas funções pequenas no laço do rig. Sem three, sem `Math.random` nem relógio (E.17).
import { FIGURE_JOINT } from '@boboforces/format';
import { mix32 } from '@boboforces/shared';

export const TAU = Math.PI * 2;

/** `c + (t − c)(1 − e^(−rate·dt))`: segue o alvo do mesmo jeito em qualquer dt (`character.ts:764`). */
export function approach(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

/** Ângulo em (−π, π]. */
export function wrapPi(a: number): number {
  return a - TAU * Math.round(a / TAU);
}

/** Fase em [0, 2π) (as fases crescem sem fim; o float32 da tabela pede o valor pequeno). */
export function wrapPhase(a: number): number {
  return a - TAU * Math.floor(a / TAU);
}

/**
 * Trilha `[t0, v0, t1, v1, …]` com smoothstep entre as chaves; antes da 1ª devolve v0 e depois da última o último v
 * (`sampleTrack`, `character.ts:796-808`).
 */
export function sampleTrack(track: readonly number[], t: number): number {
  const count = track.length;
  if (t <= track[0]!) return track[1]!;
  for (let i = 2; i < count; i += 2) {
    const ti = track[i]!;
    if (t <= ti) {
      const t0 = track[i - 2]!;
      const v0 = track[i - 1]!;
      const k = (t - t0) / (ti - t0);
      return v0 + (track[i + 1]! - v0) * (k * k * (3 - 2 * k));
    }
  }
  return track[count - 1]!;
}

const THIGH = FIGURE_JOINT.thigh;
const SHIN = FIGURE_JOINT.shin;
const LEG = THIGH + SHIN;

/**
 * Quanto o quadril desce (px) com a perna nesses ângulos e a chuteira plana no chão (`legDrop`,
 * `character.ts:1010-1014`, com as juntas do `FIGURE_JOINT`): `legDrop(0, 0, 0)` = 0.
 */
export function legDrop(hipX: number, hipZ: number, knee: number): number {
  const cz = Math.cos(hipZ);
  const cx = Math.cos(hipX);
  return LEG - (THIGH * cz * cx + SHIN * (Math.cos(knee) * cz * cx - Math.sin(knee) * Math.sin(hipX)));
}

/**
 * Pé plano do FutBobo (`character.ts:4127-4134`): a canela vezes o peso, shin·(1 − smooth((|shin| − 0,7)/0,6))·
 * (1 − 0,55·run). Com a canela perto da vertical (o caso comum) é só shin·(1 − 0,55·run); a partir de 1,3 rad, 0.
 */
export function flatShin(shin: number, run: number): number {
  // quente:
  const a = shin < 0 ? -shin : shin;
  if (a <= 0.7) return shin * (1 - 0.55 * run);
  if (a >= 1.3) return 0;
  const x = (a - 0.7) / 0.6;
  return shin * (1 - x * x * (3 - 2 * x)) * (1 - 0.55 * run);
  // fim-quente
}

/** Hash sem estado de (chave, n) em [0, 1): constantes por boneco e o sorteio da n-ésima piscada. */
export function hash01(key: number, n: number): number {
  return mix32((key ^ Math.imul(n + 1, 0x9e3779b9)) >>> 0) / 4294967296;
}
