// Ambiente → números dos uniforms, SEM three (testável em Node): LUT 1D do color grading, faixa da fog por vista e as
// cores dos presets em 0..1. Dia, Entardecer e Noite são só isto (tecnico.md §6.4, arte-ux.md §1.7–§1.11).
import type { TimeOfDayParams } from './environment.ts';

/** Largura da LUT 1D de grading (256×1 RGBA8; `bfGrade` em glsl-common.ts lê um canal por cor). */
export const GRADE_LUT_SIZE = 256;

/** Força da tonalização dividida (sombras para o zênite, luzes para o sol) na LUT. [PROPOSTA] até os prints. */
const SPLIT_TONE = 0.08;

/** Canal 0..1 de uma cor 0xRRGGBB (sem conversão sRGB→linear: textura, luz e fog falam o mesmo espaço, como no M0). */
export function channel01(rgb: number, c: 0 | 1 | 2): number {
  return ((rgb >> (16 - 8 * c)) & 0xff) / 255;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Escreve a LUT 1D de grading da hora do dia em `out` (256 × 4 bytes). Cada canal tem a sua curva:
 * - contraste em S (mistura com o smoothstep), com força pelo `gradeContrast`;
 * - a saturação da LUT é APROXIMADA: uma LUT 1D por canal não enxerga a luminância, então `gradeSaturation` só
 *   reforça (> 1) ou alivia (< 1) o mesmo S (a curva por canal afasta os canais entre si nos meios-tons);
 * - tonalização dividida: sombras puxadas para a cor do zênite e luzes para a do sol (noite azulada, entardecer quente).
 * A força total (`gradeStrength`) é o uniform `uGradeStrength`, não entra na LUT.
 */
export function buildGradeLut(p: TimeOfDayParams, out: Uint8Array): Uint8Array {
  const sCurve = Math.max(-1, Math.min(1, (p.gradeContrast - 1) * 4 + (p.gradeSaturation - 1) * 2));
  const shadowTint = hueOffsets(p.zenithColor);
  const lightTint = hueOffsets(p.sunColor);
  for (let i = 0; i < GRADE_LUT_SIZE; i++) {
    const x = i / (GRADE_LUT_SIZE - 1);
    const s = x * x * (3 - 2 * x);
    const base = x + (s - x) * sCurve;
    const shadows = (1 - x) * (1 - x) * x * 4;
    const lights = x * x * (1 - x) * 4;
    for (let c = 0; c < 3; c++) {
      const tint = SPLIT_TONE * (shadows * shadowTint[c]! + lights * lightTint[c]!);
      out[i * 4 + c] = Math.round(clamp01(base + tint) * 255);
    }
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** Matiz de uma cor sem o brilho: canal / maior canal, menos a média (o zênite escuro da noite ainda puxa o azul). */
function hueOffsets(rgb: number): [number, number, number] {
  const r = channel01(rgb, 0);
  const g = channel01(rgb, 1);
  const b = channel01(rgb, 2);
  const max = Math.max(r, g, b, 1e-6);
  const avg = (r + g + b) / 3 / max;
  return [r / max - avg, g / max - avg, b / max - avg];
}

/** Faixa da fog de uma vista em metros. */
export interface FogRange {
  near: number;
  far: number;
}

/**
 * Fog linear da vista: termina no menor entre o plano distante da câmera e o alcance de visão da partida (o que passa
 * do alcance fica 100% na cor do horizonte, nada "pipoca" no plano distante) e começa em `fração × fim`.
 */
export function fogRange(cameraFar: number, viewDistance: number, startFraction: number, out: FogRange): FogRange {
  const far = viewDistance > 0 ? Math.min(cameraFar, viewDistance) : cameraFar;
  out.far = Math.max(0.001, far);
  out.near = out.far * Math.max(0, Math.min(0.99, startFraction));
  return out;
}

/**
 * Bits das camadas-base emissivas de `blocos16` (kind `emissive`: desenhadas com brilho total, arte-ux.md §1.11),
 * no formato do uniform `uEmissiveLayers` (`ivec4[2]` = 256 bits; bit `i & 31` da palavra `i >> 5`).
 */
export function emissiveLayerBits(kinds: readonly { readonly kind: string }[], out: Int32Array): Int32Array {
  out.fill(0);
  const n = Math.min(kinds.length, out.length * 32);
  for (let i = 0; i < n; i++) {
    if (kinds[i]!.kind === 'emissive') out[i >> 5] = (out[i >> 5] ?? 0) | (1 << (i & 31));
  }
  return out;
}
