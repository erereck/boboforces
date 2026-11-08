import {
  createFigureGameTable,
  FIGURE_BONE,
  FIGURE_BONES,
  FIGURE_GRIP,
  FIGURE_HIT_FIELD,
  FIGURE_HIT_STRIDE,
  FIGURE_MAX_TOP_M,
  FIGURE_MODE,
  FIGURE_PITCH_SAMPLES,
  FIGURE_POSTURE_INFO,
  FIGURE_POSTURES,
  FIGURE_STANCE,
  figureHitBoxes,
  figurePosture,
  type FigureGameTable,
} from '@boboforces/format';
import { ARM_HIT_CUT_M, METRICS } from '@boboforces/sim';

/** Uma altura da ponta (m acima do piso) e o alcance nela (m do centro do boneco, na direção que mais sai). */
export interface LimbTip {
  readonly h: number;
  readonly reachM: number;
}

/**
 * Sonda de membro (J-M4, risco 14 do PLANO do porte) numa postura: o corpo de altura `bodyTop` encosta a AABB na
 * barreira e a ponta vai até `reachM` do centro em cada altura `h` das `tips`. Ver `measureLimbThrough` (checks.ts).
 */
export interface LimbStance {
  readonly name: string;
  /** Só nos nós em que dá para ficar em pé (`clearance` 1). */
  readonly standOnly: boolean;
  readonly bodyTop: number;
  /** Só as alturas em que o membro passa da face da AABB (alcance > meia largura). */
  readonly tips: readonly LimbTip[];
}

export interface LimbProbe {
  /** Maior alcance das pontas (m do centro). */
  readonly reachM: number;
  readonly stances: readonly LimbStance[];
}

/**
 * As sondas do relatório do `mapc`, cada uma em duas medidas (decisão 1 da §I do PLANO do porte): VISUAL = as caixas
 * da tabela de jogo inteiras (o envelope do que aparece, sem a arma), e HITBOX = o que a sim acerta, com as caixas de
 * braço cortadas a `ARM_HIT_CUT_M` do eixo.
 */
export interface LimbProbes {
  /** Braços (ossos 2..5) com arma, em pé e agachado: visual. */
  readonly arm: LimbProbe;
  /** Corpo inteiro no deslize "carrinho" (os pés à frente, a nuca atrás): visual. */
  readonly slide: LimbProbe;
  /** `arm` na hitbox da sim (todo osso dela é braço, então todo o alcance fica ≤ `ARM_HIT_CUT_M`). */
  readonly armHit: LimbProbe;
  /** `slide` na hitbox da sim (só os braços cortados; pernas, tronco e cabeça como no visual). */
  readonly slideHit: LimbProbe;
}

/** Que posturas e ossos da tabela de jogo viram uma `LimbStance`. */
export interface LimbSpec {
  readonly name: string;
  readonly standOnly: boolean;
  readonly bodyTop: number;
  readonly postures: readonly number[];
  readonly bones: readonly number[];
  /**
   * Corte da hitbox (`ARM_HIT_CUT_M` da sim): o alcance destes ossos fica em no máximo `reachM`. A sim corta num
   * QUADRADO alinhado ao mundo (|Δx|, |Δz| ≤ corte); contra barreira alinhada a um eixo, o que conta é o alcance ao
   * longo dele, e o máximo disso em qualquer yaw de um ponto a `r` do eixo, já cortado, é min(r, corte) (exato até
   * r = corte·√2, 1,06 m; além disso o ponto nunca entra no corte e a conta fica conservadora).
   */
  readonly cut?: { readonly bones: readonly number[]; readonly reachM: number };
}

/** Faixa de altura do perfil (m): a ponta é medida no meio de cada faixa com o maior alcance dela. */
export const LIMB_BIN_M = 0.1;
/** Passo do pitch na varredura (rad): a tabela interpola entre as 5 amostras e soma a folga, então varre-se o meio. */
export const LIMB_PITCH_STEP = 0.01;
const BINS = Math.ceil(FIGURE_MAX_TOP_M / LIMB_BIN_M) + 1;
const HF = FIGURE_HIT_FIELD;

/**
 * Perfil de alcance das hitboxes da tabela de jogo (a mesma que a sim usa para o tiro), por faixa de altura: para cada
 * postura de `spec.postures`, pitch de −1,2 a 1,2 (passo `LIMB_PITCH_STEP`) e osso de `spec.bones`, os vértices da
 * caixa cortada pela faixa (quinas dentro dela e cruzamentos das 12 arestas com os planos da faixa) e o maior raio no
 * plano (x, z) deles. É o alcance em QUALQUER direção (o boneco gira no yaw e a AABB não), exato para a caixa (o raio é
 * convexo, então o máximo cai num vértice). Faixas sem nada além da face da AABB ficam de fora. Com `spec.cut`, o raio
 * dos ossos cortados para no corte (a hitbox da sim).
 */
export function limbProbeFromTable(table: FigureGameTable, specs: readonly LimbSpec[]): LimbProbe {
  const boxes = new Float64Array(FIGURE_BONES * FIGURE_HIT_STRIDE);
  const qx = new Float64Array(8);
  const qy = new Float64Array(8);
  const qz = new Float64Array(8);
  const half = METRICS.aabbWidth / 2;
  const pitchMin = FIGURE_PITCH_SAMPLES[0];
  const pitchMax = FIGURE_PITCH_SAMPLES[FIGURE_PITCH_SAMPLES.length - 1]!;
  const steps = Math.round((pitchMax - pitchMin) / LIMB_PITCH_STEP);
  let reachAll = 0;
  const stances = specs.map((spec): LimbStance => {
    const reach = new Float64Array(BINS);
    let cap = Infinity;
    const put = (bin: number, x: number, z: number): void => {
      if (bin < 0 || bin >= BINS) return; // abaixo do piso (o braço agachado mirando para baixo) ou acima de tudo
      const r = Math.min(Math.hypot(x, z), cap);
      if (r > reach[bin]!) reach[bin] = r;
    };
    for (const posture of spec.postures) {
      for (let s = 0; s <= steps; s++) {
        figureHitBoxes(table, posture, s === steps ? pitchMax : pitchMin + s * LIMB_PITCH_STEP, boxes, 0);
        for (const bone of spec.bones) {
          cap = spec.cut !== undefined && spec.cut.bones.includes(bone) ? spec.cut.reachM : Infinity;
          const d = bone * FIGURE_HIT_STRIDE;
          // Quinas: c + R·(±hx, ±hy, ±hz), com R linha-maior; o bit 0 é x, o 1 é y e o 2 é z.
          for (let k = 0; k < 8; k++) {
            const lx = (k & 1 ? 1 : -1) * boxes[d + HF.hx]!;
            const ly = (k & 2 ? 1 : -1) * boxes[d + HF.hy]!;
            const lz = (k & 4 ? 1 : -1) * boxes[d + HF.hz]!;
            qx[k] = boxes[d + HF.cx]! + boxes[d + HF.r00]! * lx + boxes[d + HF.r01]! * ly + boxes[d + HF.r02]! * lz;
            qy[k] = boxes[d + HF.cy]! + boxes[d + HF.r10]! * lx + boxes[d + HF.r11]! * ly + boxes[d + HF.r12]! * lz;
            qz[k] = boxes[d + HF.cz]! + boxes[d + HF.r20]! * lx + boxes[d + HF.r21]! * ly + boxes[d + HF.r22]! * lz;
            put(Math.floor(qy[k]! / LIMB_BIN_M), qx[k]!, qz[k]!);
          }
          // Arestas (quinas que diferem num bit) cruzando os planos y = j·faixa: o ponto vale para as duas faixas.
          for (let a = 0; a < 8; a++) {
            for (let bit = 1; bit < 8; bit <<= 1) {
              if (a & bit) continue;
              const b = a | bit;
              const ya = qy[a]!;
              const yb = qy[b]!;
              if (ya === yb) continue;
              const lo = Math.min(ya, yb);
              const hi = Math.max(ya, yb);
              for (let j = Math.ceil(lo / LIMB_BIN_M); j * LIMB_BIN_M <= hi; j++) {
                const t = (j * LIMB_BIN_M - ya) / (yb - ya);
                const x = qx[a]! + (qx[b]! - qx[a]!) * t;
                const z = qz[a]! + (qz[b]! - qz[a]!) * t;
                put(j - 1, x, z);
                put(j, x, z);
              }
            }
          }
        }
      }
    }
    const tips: LimbTip[] = [];
    for (let k = 0; k < BINS; k++) {
      if (reach[k]! <= half) continue;
      tips.push({ h: (k + 0.5) * LIMB_BIN_M, reachM: reach[k]! });
      reachAll = Math.max(reachAll, reach[k]!);
    }
    return { name: spec.name, standOnly: spec.standOnly, bodyTop: spec.bodyTop, tips };
  });
  return { reachM: reachAll, stances };
}

/** Posturas da tabela com o `stance` dado (e com arma, se `armed`), sem o zumbi. */
function posturesOf(stance: number, armed: boolean): number[] {
  const zombie = figurePosture(FIGURE_STANCE.stand, FIGURE_GRIP.none, FIGURE_MODE.base, true);
  const out: number[] = [];
  for (let p = 0; p < FIGURE_POSTURES; p++) {
    const grip = FIGURE_POSTURE_INFO[p * 3 + 1]!;
    if (p === zombie || FIGURE_POSTURE_INFO[p * 3] !== stance) continue;
    if (armed && grip === FIGURE_GRIP.none) continue;
    out.push(p);
  }
  return out;
}

const ARM_BONES = [FIGURE_BONE.upperArmR, FIGURE_BONE.upperArmL, FIGURE_BONE.forearmR, FIGURE_BONE.forearmL];
const ALL_BONES = Array.from({ length: FIGURE_BONES }, (_, i) => i);

/** O corte das hitboxes de braço da sim (decisão 1 da §I do PLANO do porte). */
const ARM_HIT_CUT = { bones: ARM_BONES, reachM: ARM_HIT_CUT_M } as const;

/**
 * As sondas do `mapc` montadas sobre uma tabela de jogo (braço armado; corpo no deslize, com e sem arma), no visual e
 * na hitbox da sim.
 */
export function figureLimbProbesFrom(table: FigureGameTable): LimbProbes {
  const arm = (cut: LimbSpec['cut']): LimbSpec[] => [
    {
      name: 'stand',
      standOnly: true,
      bodyTop: METRICS.aabbHeight,
      postures: posturesOf(FIGURE_STANCE.stand, true),
      bones: ARM_BONES,
      ...(cut !== undefined ? { cut } : {}),
    },
    {
      name: 'crouch',
      standOnly: false,
      bodyTop: METRICS.aabbCrouchHeight,
      postures: posturesOf(FIGURE_STANCE.crouch, true),
      bones: ARM_BONES,
      ...(cut !== undefined ? { cut } : {}),
    },
  ];
  const slide = (cut: LimbSpec['cut']): LimbSpec[] => [
    {
      name: 'slide',
      standOnly: false,
      bodyTop: METRICS.aabbCrouchHeight,
      postures: posturesOf(FIGURE_STANCE.slide, false),
      bones: ALL_BONES,
      ...(cut !== undefined ? { cut } : {}),
    },
  ];
  return {
    arm: limbProbeFromTable(table, arm(undefined)),
    slide: limbProbeFromTable(table, slide(undefined)),
    armHit: limbProbeFromTable(table, arm(ARM_HIT_CUT)),
    slideHit: limbProbeFromTable(table, slide(ARM_HIT_CUT)),
  };
}

let cached: LimbProbes | undefined;

/**
 * As sondas da tabela de jogo real (`createFigureGameTable`, a da frente "figura"), montadas uma vez por processo:
 * a medida segue a tabela sem número copiado (o 0,74 m do PLANO §B4 era o fuzil em pé no FK do desenho).
 */
export function figureLimbProbes(): LimbProbes {
  cached ??= figureLimbProbesFrom(createFigureGameTable());
  return cached;
}
