// Rig de REPOUSO dos bonecos (#56, PLANO do porte §D, F3): implementação simples do contrato `FigureRig`
// (`anim/types.ts`, congelado) com a pose da tabela de jogo e o FK do format, sem motor nenhum (sem molas, passada,
// piscada, LOD). Serve aos testes do passe (faixas, compactação, recorte do cabelo, armas, desmonte) e de régua: o
// rig real da F4 (`anim/rig.ts`) com o motor parado tem de dar as mesmas matrizes (E.1, parte do render). Sem three.
import {
  FIGURE_GRIP,
  FIGURE_POSE_SIZE,
  FIGURE_POSTURE_INFO,
  FIGURE_POSTURES,
  FIGURE_PX_M,
  FIGURE_STANCE,
  figureFk,
  figureGamePose,
  figureGripMatrix,
  figureRoot,
  type FigureGameTable,
} from '@boboforces/format';
import { FIGURE_POSE_RESULT, type FigureLodStats, type FigurePoseResult, type FigureRig } from './anim/types.ts';
import { MAT4 } from './math.ts';
import { NO_FIGURE, NO_MODEL, type ActorBuffer } from '../types.ts';

/** Teto do cabelo (m acima dos pés, × escala): em pé e agachado/deslizando (PLANO §B8). */
export const FIGURE_HAIR_CEILING = { stand: 1.99, low: 0.99 } as const;

/** Osso do antebraço D (onde a arma prende) em `FIGURE_BONE`. */
const FOREARM_R = 4;

/**
 * Rig de repouso: ossos = `figureFk(figureGamePose(tabela, postura, pitch), figureRoot(posição, yaw, escala))`; arma =
 * antebraço D × `figureGripMatrix` × S(1/px) (metros, origem no `hand_r` do modelo); expressão = a do `ActorBuffer`; teto
 * do cabelo pela postura. Sempre `computed` (nunca `shifted`).
 */
export function createRestFigureRig(): FigureRig {
  let table: FigureGameTable | null = null;
  const pose = new Float32Array(FIGURE_POSE_SIZE);
  const root = new Float32Array(MAT4);
  const grip = new Float32Array(MAT4);
  const weaponM = new Float32Array(MAT4);
  let expression = 0;
  let ceiling = Infinity;
  let armed = false;
  let posed = 0;
  const stats = { l0: 0, l1: 0, l2: 0 };

  const rig: FigureRig = {
    setTable(next) {
      table = next;
    },
    setLod() {},
    begin() {
      posed = 0;
    },
    pose(actors: ActorBuffer, i: number, out: Float32Array, o: number): FigurePoseResult {
      // quente:
      armed = false;
      const t = table;
      if (!t || actors.figure[i] === NO_FIGURE) return FIGURE_POSE_RESULT.hidden;
      const p = actors.posture[i]!;
      const posture = p < FIGURE_POSTURES ? p : 0;
      const pitch = actors.pitch[i]!;
      const s = actors.scale[i]! > 0 ? actors.scale[i]! : 1;
      const x = actors.position[i * 3]!;
      const y = actors.position[i * 3 + 1]!;
      const z = actors.position[i * 3 + 2]!;
      figureGamePose(t, posture, pitch, pose, 0);
      figureRoot(root, 0, x, y, z, actors.yaw[i]!, s, 0);
      figureFk(pose, 0, root, 0, out, o);
      expression = actors.expression[i]!;
      const stance = FIGURE_POSTURE_INFO[posture * 3]!;
      ceiling = y + s * (stance === FIGURE_STANCE.stand ? FIGURE_HAIR_CEILING.stand : FIGURE_HAIR_CEILING.low);
      if (actors.weapon[i] !== NO_MODEL && FIGURE_POSTURE_INFO[posture * 3 + 1]! !== FIGURE_GRIP.none) {
        figureGripMatrix(t, posture, pitch, grip, 0);
        const f = o + FOREARM_R * MAT4;
        const inv = 1 / FIGURE_PX_M;
        for (let c = 0; c < 3; c++) {
          const g0 = grip[c * 4]!;
          const g1 = grip[c * 4 + 1]!;
          const g2 = grip[c * 4 + 2]!;
          for (let r = 0; r < 3; r++) {
            weaponM[c * 4 + r] = (out[f + r]! * g0 + out[f + 4 + r]! * g1 + out[f + 8 + r]! * g2) * inv;
          }
          weaponM[c * 4 + 3] = 0;
        }
        const g0 = grip[12]!;
        const g1 = grip[13]!;
        const g2 = grip[14]!;
        for (let r = 0; r < 3; r++) {
          weaponM[12 + r] = out[f + r]! * g0 + out[f + 4 + r]! * g1 + out[f + 8 + r]! * g2 + out[f + 12 + r]!;
        }
        weaponM[15] = 1;
        armed = true;
      }
      posed++;
      return FIGURE_POSE_RESULT.computed;
      // fim-quente
    },
    get expression() {
      return expression;
    },
    get hairCeilingY() {
      return ceiling;
    },
    weapon(out, o) {
      if (!armed) return false;
      for (let k = 0; k < MAT4; k++) out[o + k] = weaponM[k]!;
      return true;
    },
    end() {
      stats.l0 = posed;
    },
    get stats(): FigureLodStats {
      return stats;
    },
    dispose() {
      table = null;
    },
  };
  return rig;
}
