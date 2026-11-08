// Quadro dos bonecos do FutBobo (#56, PLANO do porte §B6, §B8 e §B10), sem three: põe cada ator na sua faixa
// (`figure-instances.ts`), chama o rig (`FigureRig`, contrato congelado em `anim/types.ts`) direto nas 12 matrizes de
// osso, copia o osso para as caixas extras (mãos, cabelo), recorta o cabelo no teto, escreve a 4ª linha (luz, expressão
// e clarão) de toda caixa e guarda a matriz da arma do ator. O passe dos atores só sobe os buffers e desenha.
import {
  FIGURE_BONES,
  FIGURE_BOX_FIELD,
  FIGURE_BOX_FLAG,
  FIGURE_BOX_STRIDE,
  FIGURE_MAX_BOXES,
  type FigureGameTable,
  type FigureTemplateSet,
} from '@boboforces/format';
import { FIGURE_POSE_RESULT, type FigureRig } from './anim/types.ts';
import { actorKey } from './entity-table.ts';
import { createFigureInstances, type FigureInstances } from './figure-instances.ts';
import { MAT4 } from './math.ts';
import type { FrameContext } from '../shared/passes.ts';
import { ACTOR_KIND, ACTOR_POSE, NO_FIGURE, NO_MODEL, type ActorBuffer } from '../types.ts';

const F = FIGURE_BOX_FIELD;
const BLOCK = FIGURE_MAX_BOXES * FIGURE_BOX_STRIDE;
/**
 * Chave do k-ésimo manequim (entidade 0) na ordem do `ActorBuffer`: a ORDEM entre os manequins, não o índice. O `game`
 * escreve os manequins depois das entidades vivas e tira os mortos, então o índice muda a cada morte e renascimento; com
 * ele na chave o prefixo era refeito (e todo ator posava com `force`) em cada um desses quadros. Geração 0xFFFE nunca
 * existe na sim (o mesmo espaço do `actorKey` da entidade 0).
 */
const MANNEQUIN_KEY = 0xfffe0000;

/**
 * Faixa vertical de cada caixa de cabelo no espaço do osso da cabeça (px), calculada uma vez por gabarito: o centro
 * mais a meia altura da caixa girada (Rx·Rz). `NaN` = caixa que não é cabelo (nunca recorta).
 */
export interface FigureHairSpans {
  readonly bottom: Float32Array;
  readonly top: Float32Array;
}

export function figureHairSpans(templates: FigureTemplateSet): FigureHairSpans {
  const n = templates.count * FIGURE_MAX_BOXES;
  const bottom = new Float32Array(n).fill(NaN);
  const top = new Float32Array(n).fill(NaN);
  for (let t = 0; t < templates.count; t++) {
    const len = templates.length[t]!;
    for (let k = 0; k < len; k++) {
      const b = t * BLOCK + k * FIGURE_BOX_STRIDE;
      const box = templates.boxes;
      if ((Math.round(box[b + F.flags]!) & FIGURE_BOX_FLAG.hair) === 0) continue;
      const cx = Math.cos(box[b + F.rotX]!);
      const sx = Math.sin(box[b + F.rotX]!);
      const cz = Math.cos(box[b + F.rotZ]!);
      const sz = Math.sin(box[b + F.rotZ]!);
      // Linha y de R = Rx·Rz: (cos X·sen Z, cos X·cos Z, −sen X).
      const half =
        0.5 * (Math.abs(cx * sz) * box[b + F.sx]! + Math.abs(cx * cz) * box[b + F.sy]! + Math.abs(sx) * box[b + F.sz]!);
      bottom[t * FIGURE_MAX_BOXES + k] = box[b + F.cy]! - half;
      top[t * FIGURE_MAX_BOXES + k] = box[b + F.cy]! + half;
    }
  }
  return { bottom, top };
}

/**
 * Recorte do cabelo pelo teto (PLANO §B8): a matriz da caixa (a do osso da cabeça, já copiada em m[o ..]) encolhe no y
 * do osso a partir da base da caixa, `col1 *= s` e `t += (1 − s)·base·col1`, com s = clamp((teto − base)/(topo −
 * base)). O teto (m, mundo) vira y local do osso pela coluna y da cabeça (cabeça reta: exato). Caixa toda acima do teto
 * some (matriz zero, triângulos degenerados). Devolve s (1 = intacta).
 */
export function clipHairBox(m: Float32Array, o: number, bottom: number, top: number, ceilingY: number): number {
  // quente:
  const c1y = m[o + 5]!;
  if (!(c1y > 1e-9) || !(ceilingY < Infinity)) return 1;
  const local = (ceilingY - m[o + 13]!) / c1y;
  if (local >= top) return 1;
  if (local <= bottom) {
    for (let k = 0; k < 15; k++) if ((k & 3) !== 3) m[o + k] = 0;
    return 0;
  }
  const s = (local - bottom) / (top - bottom);
  const c1x = m[o + 4]!;
  const c1z = m[o + 6]!;
  const k = (1 - s) * bottom;
  m[o + 12] = m[o + 12]! + k * c1x;
  m[o + 13] = m[o + 13]! + k * c1y;
  m[o + 14] = m[o + 14]! + k * c1z;
  m[o + 4] = c1x * s;
  m[o + 5] = c1y * s;
  m[o + 6] = c1z * s;
  return s;
  // fim-quente
}

/** Hash barato da linha do manequim no `ActorBuffer` (posição, giro, postura, gabarito, skin, luz, arma, rosto). */
export function mannequinHash(a: ActorBuffer, i: number): number {
  // quente:
  let h = a.position[i * 3]! * 3.1 + a.position[i * 3 + 1]! * 5.7 + a.position[i * 3 + 2]! * 7.3;
  h = h * 1.0001 + a.yaw[i]! * 11.1 + a.pitch[i]! * 13.7 + a.scale[i]! * 17.3;
  h = h * 1.0001 + a.posture[i]! * 19 + a.figure[i]! * 23 + a.skin[i]! * 29 + a.weapon[i]! * 31;
  h = h * 1.0001 + a.light[i * 3]! * 37 + a.light[i * 3 + 1]! * 41 + a.light[i * 3 + 2]! * 43;
  h = h * 1.0001 + a.expression[i]! * 47 + a.team[i]! * 53 + a.damageFlash[i]! * 59;
  return h;
  // fim-quente
}

export interface FigureFrameStats {
  /** Bonecos desenhados no último quadro (manequins incluídos) e caixas (instâncias). */
  readonly figures: number;
  readonly boxes: number;
  /** Bonecos que o rig devolveu `hidden` (faixa zerada). */
  readonly hidden: number;
}

export interface FigureFrame {
  readonly instances: FigureInstances;
  /** Gabaritos e tabela da partida (`setFigures`); `null` solta. */
  setFigures(templates: FigureTemplateSet | null, table: FigureGameTable | null): void;
  /** true quando há gabaritos (o caminho novo está ligado). */
  readonly active: boolean;
  /** O ator vai pelo caminho novo (tem gabarito, não está morto). */
  drawable(a: ActorBuffer, i: number): boolean;
  /**
   * Um quadro: coloca, posa e termina as caixas. `frameIndex` sobe 1 por quadro. Depois: `instances.actorRecord[i]`
   * (−1 = não desenhado como boneco), `recWeapon`/`recArmed` por registro e as faixas de upload.
   */
  update(frame: FrameContext, a: ActorBuffer, frameIndex: number): void;
  readonly stats: FigureFrameStats;
}

/** Quadro dos bonecos com o rig dado (o real da F4 no passe; o de repouso nos testes). */
export function createFigureFrame(rig: FigureRig, instances: FigureInstances = createFigureInstances()): FigureFrame {
  let templates: FigureTemplateSet | null = null;
  let spans: FigureHairSpans | null = null;
  const stats = { figures: 0, boxes: 0, hidden: 0 };

  function finish(a: ActorBuffer, i: number, r: number, expression: number, ceiling: number): void {
    // quente:
    const t = templates;
    const sp = spans;
    if (!t || !sp) return;
    const m = instances.matrices;
    const start = instances.recStart[r]!;
    const n = instances.recBoxes[r]!;
    const tpl = instances.recTemplate[r]!;
    const base = tpl * BLOCK;
    // Caixas extras: cópia da parte afim do osso (a 4ª linha vem logo abaixo). Desenrolado: no interpretador do
    // console cada volta de laço e cada chamada pesam (bancada jitless da F3).
    for (let k = FIGURE_BONES; k < n; k++) {
      const bone = t.boxes[base + k * FIGURE_BOX_STRIDE + F.bone]!;
      const src = (start + bone) * MAT4;
      const dst = (start + k) * MAT4;
      m[dst] = m[src]!;
      m[dst + 1] = m[src + 1]!;
      m[dst + 2] = m[src + 2]!;
      m[dst + 4] = m[src + 4]!;
      m[dst + 5] = m[src + 5]!;
      m[dst + 6] = m[src + 6]!;
      m[dst + 8] = m[src + 8]!;
      m[dst + 9] = m[src + 9]!;
      m[dst + 10] = m[src + 10]!;
      m[dst + 12] = m[src + 12]!;
      m[dst + 13] = m[src + 13]!;
      m[dst + 14] = m[src + 14]!;
      const bottom = sp.bottom[tpl * FIGURE_MAX_BOXES + k]!;
      if (bottom === bottom) clipHairBox(m, dst, bottom, sp.top[tpl * FIGURE_MAX_BOXES + k]!, ceiling);
    }
    // 4ª linha de toda caixa: o mesmo que `writeFigureRow4`, escrito aqui (uma chamada por caixa pesaria).
    const sky = a.light[i * 3]!;
    const sun = a.light[i * 3 + 1]!;
    const emissive = a.light[i * 3 + 2]!;
    const flash = a.damageFlash[i]!;
    const w = 2 * expression + (flash > 0 ? (flash < 1 ? flash : 1) : 0);
    for (let o = start * MAT4, end = (start + n) * MAT4; o < end; o += MAT4) {
      m[o + 3] = sky;
      m[o + 7] = sun;
      m[o + 11] = emissive;
      m[o + 15] = w;
    }
    // fim-quente
  }

  function hide(r: number): void {
    const start = instances.recStart[r]!;
    const n = instances.recBoxes[r]!;
    instances.matrices.fill(0, start * MAT4, (start + n) * MAT4);
    instances.recArmed[r] = 0;
    instances.recForce[r] = 1;
  }

  const frameApi: FigureFrame = {
    instances,
    setFigures(nextTemplates, table) {
      templates = nextTemplates;
      spans = nextTemplates ? figureHairSpans(nextTemplates) : null;
      instances.setTemplates(nextTemplates);
      rig.setTable(table);
    },
    get active() {
      return templates !== null;
    },
    drawable(a, i) {
      const t = templates;
      return t !== null && a.figure[i]! !== NO_FIGURE && a.figure[i]! < t.count && (a.pose[i]! & ACTOR_POSE.dead) === 0;
    },
    update(frame, a, frameIndex) {
      // quente:
      stats.figures = 0;
      stats.boxes = 0;
      stats.hidden = 0;
      instances.begin(frameIndex, a.count);
      if (!templates) {
        instances.end();
        return;
      }
      let mannequins = 0;
      for (let i = 0; i < a.count; i++) {
        const entity = a.entity[i]!;
        // Conta todo manequim, desenhável ou não: um que some não muda a chave dos outros.
        const key = entity === 0 ? (MANNEQUIN_KEY | (mannequins++ & 0xffff)) >>> 0 : actorKey(entity, i);
        if (!frameApi.drawable(a, i)) continue;
        const mannequin = a.kind[i] === ACTOR_KIND.mannequin || entity === 0;
        instances.place(
          i,
          key,
          mannequin,
          a.figure[i]!,
          a.skin[i]!,
          a.localSlot[i]!,
          mannequin ? mannequinHash(a, i) : 0,
        );
      }
      instances.end();
      rig.begin(frame, a, frameIndex);
      const m = instances.matrices;
      for (let i = 0; i < a.count; i++) {
        const r = instances.actorRecord[i]!;
        if (r < 0) continue;
        stats.figures++;
        stats.boxes += instances.recBoxes[r]!;
        const fresh = instances.actorFresh[i] === 1;
        // Manequim: só posa quando o prefixo muda (o resto do tempo as matrizes dele ficam paradas, sem upload).
        if (instances.actorMannequin[i] === 1 && !fresh) continue;
        const force = fresh || instances.recForce[r] === 1;
        const result = rig.pose(a, i, m, instances.recStart[r]! * MAT4, force);
        if (result === FIGURE_POSE_RESULT.hidden) {
          hide(r);
          stats.hidden++;
          continue;
        }
        instances.recForce[r] = 0;
        finish(a, i, r, rig.expression, rig.hairCeilingY);
        instances.recArmed[r] = a.weapon[i] !== NO_MODEL && rig.weapon(instances.recWeapon, r * MAT4) ? 1 : 0;
      }
      rig.end(frameIndex);
      // fim-quente
    },
    get stats(): FigureFrameStats {
      return stats;
    },
  };
  return frameApi;
}
