// Instâncias dos bonecos do FutBobo (#56, PLANO do porte §B10): UMA `InstancedMesh` "bobos" do cubo unitário, com uma
// instância por CAIXA (14 do corpo + cabelo, ≤ `FIGURE_MAX_BOXES` por boneco). Aqui fica só a política dos buffers,
// sem three:
//
// - prefixo estático: os manequins (entidade 0), escritos quando o prefixo muda (loading) e de novo só se o hash barato
//   da linha de um deles no `ActorBuffer` mudar; o upload de matrizes por quadro começa DEPOIS dele;
// - depois, uma faixa ESTÁVEL por ator, `[início, início + caixas)`: as 12 primeiras são os ossos (o rig escreve direto
//   nelas) e as outras são cópias do osso (mãos, cabelo);
// - a compactação só roda em evento (ator sai ou troca de gabarito) e move as matrizes JUNTO com os dados
//   (`copyWithin`): quem está em L2 ou no quadro pulado do L1 continua com as próprias matrizes (o rig só soma o
//   deslocamento da raiz), nunca com as de outro;
// - dados (camada, UV, centro, tamanho, giro, slot) só no quadro de evento; matrizes todo quadro, num upload só.
//
// Quem sai deixa as 12 matrizes de osso do último quadro no "cemitério" (16 entradas): o desmonte nasce delas com a
// dobra do cotovelo e do joelho (§B13), mesmo que o ator já tenha saído do `ActorBuffer`.
import { FIGURE_BONES, FIGURE_BOX_STRIDE, FIGURE_MAX_BOXES, type FigureTemplateSet } from '@boboforces/format';
import { writeFigureBoxData } from './figure-cube.ts';
import { INSTANCE_FLOATS } from './layout.ts';
import { MAT4 } from './math.ts';

/** Atores (manequins incluídos) que cabem na malha "bobos". */
export const FIGURE_ACTORS_MAX = 72;
/** Instâncias da malha "bobos": 72 × 44 = 3.168. */
export const FIGURE_INSTANCES_MAX = FIGURE_ACTORS_MAX * FIGURE_MAX_BOXES;
/** Entradas do cemitério (as 12 matrizes de osso de quem saiu). */
export const FIGURE_GRAVE_SIZE = 16;
/** Floats das 12 matrizes de osso de um boneco. */
export const FIGURE_BONE_FLOATS = FIGURE_BONES * MAT4;

const NONE = -1;

export interface FigureInstances {
  /** Instâncias que cabem (`FIGURE_INSTANCES_MAX`). */
  readonly capacity: number;
  /** 16 floats por instância, coluna-maior; a 4ª linha leva luz e expressão (`writeFigureRow4`). */
  readonly matrices: Float32Array;
  /** 16 floats por instância (`FIGURE_INST`). */
  readonly data: Float32Array;
  /** Instâncias em uso: [0, prefixEnd) manequins, [prefixEnd, count) faixas dos atores. */
  readonly count: number;
  readonly prefixEnd: number;
  /** Por registro (estável enquanto o ator vive): início da faixa, caixas, gabarito e a matriz da arma (16 floats). */
  readonly recStart: Int32Array;
  readonly recBoxes: Uint8Array;
  readonly recTemplate: Uint8Array;
  readonly recWeapon: Float32Array;
  /** 1 se a arma do registro foi escrita no último `pose` (manequins: na última vez que posaram). */
  readonly recArmed: Uint8Array;
  /** 1 = o próximo `pose` do registro vai com `force` (o rig devolveu `hidden` e a faixa ficou zerada). */
  readonly recForce: Uint8Array;
  /** Por ator do `ActorBuffer` (índice do quadro): registro (−1 = não desenhado) e "posar com `force`". */
  readonly actorRecord: Int16Array;
  readonly actorFresh: Uint8Array;
  /** 1 se o ator é manequim (prefixo): só posa quando `actorFresh`. */
  readonly actorMannequin: Uint8Array;
  /** Neste quadro: prefixo refeito (os manequins posam; o upload de matrizes começa em 0). */
  readonly prefixDirty: boolean;
  /** Faixa de dados a subir neste quadro, em instâncias (−1 = nada). */
  readonly dataFirst: number;
  readonly dataLast: number;
  /** Atores que não couberam no último quadro (estouro da capacidade). */
  readonly overflow: number;
  /** Contadores desde a criação: eventos (entra, sai, troca) e compactações (faixas movidas). */
  readonly events: number;
  readonly compactions: number;
  /** Cemitério: chave (entidade), 12 matrizes de osso, gabarito e skin de quem saiu, mais o nº do quadro. */
  readonly graveKey: Uint32Array;
  readonly graveBones: Float32Array;
  readonly graveTemplate: Uint8Array;
  readonly graveSkin: Uint16Array;

  /** Gabaritos da partida (troca = esquece tudo). */
  setTemplates(templates: FigureTemplateSet | null): void;
  /** Começo da colocação do quadro (`actorCount` = atores no `ActorBuffer`). */
  begin(frame: number, actorCount: number): void;
  /**
   * Põe o ator `i` (chave estável `key`; manequim no prefixo) com o gabarito, a 1ª camada da skin e o slot local.
   * `hash` só vale para manequim (mudou: o prefixo posa de novo). Devolve o registro ou −1 (sem gabarito, cheio).
   */
  place(i: number, key: number, mannequin: boolean, template: number, skin: number, slot: number, hash: number): number;
  /** Fim da colocação: saídas, compactação, prefixo e dados. Depois disso `recStart` e `actorRecord` valem. */
  end(): void;
  /** Cemitério: entrada mais nova da entidade, ou −1. */
  findGrave(key: number): number;
  /** Esquece faixas, registros e cemitério (troca de mapa ou de gabaritos). */
  clear(): void;
}

/**
 * Buffers e faixas da malha "bobos". `actors` = registros (manequins incluídos), `boxes` = caixas por boneco.
 * Aloca tudo aqui (no loading); `begin`/`place`/`end` não alocam.
 */
export function createFigureInstances(actors = FIGURE_ACTORS_MAX, boxes = FIGURE_MAX_BOXES): FigureInstances {
  const capacity = actors * boxes;
  const matrices = new Float32Array(capacity * MAT4);
  const data = new Float32Array(capacity * INSTANCE_FLOATS);
  const recs = actors;
  const recStart = new Int32Array(recs).fill(NONE);
  const recBoxes = new Uint8Array(recs);
  const recTemplate = new Uint8Array(recs);
  const recSkin = new Uint16Array(recs);
  const recSlot = new Uint8Array(recs);
  const recKey = new Uint32Array(recs);
  const recSeen = new Int32Array(recs).fill(-1);
  const recActive = new Uint8Array(recs);
  const recMannequin = new Uint8Array(recs);
  const recHash = new Float64Array(recs);
  const recNew = new Uint8Array(recs);
  const recData = new Uint8Array(recs);
  const recActor = new Int32Array(recs).fill(NONE);
  const recWeapon = new Float32Array(recs * MAT4);
  const recArmed = new Uint8Array(recs);
  const recForce = new Uint8Array(recs);
  const free = new Int16Array(recs);
  let freeLen = 0;
  /** Atores em ordem de faixa (sem os manequins) e os manequins em ordem de prefixo. */
  const order = new Int16Array(recs);
  let orderLen = 0;
  const order2 = new Int16Array(recs);
  const mannequins = new Int16Array(recs);
  let mannequinLen = 0;
  let actorRecord = new Int16Array(FIGURE_ACTORS_MAX * 4).fill(NONE);
  let actorFresh = new Uint8Array(FIGURE_ACTORS_MAX * 4);
  let actorMannequin = new Uint8Array(FIGURE_ACTORS_MAX * 4);
  /** Registro do ator i no quadro anterior (atalho da busca pela chave). */
  let lastRecord = new Int16Array(FIGURE_ACTORS_MAX * 4).fill(NONE);
  const graveKey = new Uint32Array(FIGURE_GRAVE_SIZE);
  const graveBones = new Float32Array(FIGURE_GRAVE_SIZE * FIGURE_BONE_FLOATS);
  const graveTemplate = new Uint8Array(FIGURE_GRAVE_SIZE);
  const graveSkin = new Uint16Array(FIGURE_GRAVE_SIZE);
  let graveNext = 0;

  let templates: FigureTemplateSet | null = null;
  let frame = 0;
  let actorCount = 0;
  let count = 0;
  let prefixEnd = 0;
  let prefixDirty = false;
  let prefixChanged = false;
  let dataFirst = NONE;
  let dataLast = NONE;
  let overflow = 0;
  let events = 0;
  let compactions = 0;

  function reset(): void {
    recStart.fill(NONE);
    recActive.fill(0);
    recSeen.fill(-1);
    recActor.fill(NONE);
    recArmed.fill(0);
    freeLen = 0;
    for (let r = recs - 1; r >= 0; r--) free[freeLen++] = r;
    orderLen = 0;
    mannequinLen = 0;
    count = 0;
    prefixEnd = 0;
    prefixChanged = true;
    lastRecord.fill(NONE);
    graveKey.fill(0);
    graveNext = 0;
  }
  reset();

  function markData(first: number, last: number): void {
    if (last < first) return;
    if (dataFirst < 0 || first < dataFirst) dataFirst = first;
    if (last > dataLast) dataLast = last;
  }

  function writeData(r: number): void {
    const t = templates;
    if (!t) return;
    const start = recStart[r]!;
    const n = recBoxes[r]!;
    const base = recTemplate[r]! * FIGURE_MAX_BOXES * FIGURE_BOX_STRIDE;
    for (let k = 0; k < n; k++) {
      writeFigureBoxData(
        data,
        (start + k) * INSTANCE_FLOATS,
        t.boxes,
        base + k * FIGURE_BOX_STRIDE,
        recSkin[r]!,
        recSlot[r]!,
      );
    }
    markData(start, start + n - 1);
  }

  function bury(r: number): void {
    const start = recStart[r]!;
    if (start < 0 || recMannequin[r] === 1) return;
    const g = graveNext;
    graveNext = (g + 1) % FIGURE_GRAVE_SIZE;
    graveKey[g] = recKey[r]!;
    graveTemplate[g] = recTemplate[r]!;
    graveSkin[g] = recSkin[r]!;
    const src = start * MAT4;
    const dst = g * FIGURE_BONE_FLOATS;
    for (let k = 0; k < FIGURE_BONE_FLOATS; k++) graveBones[dst + k] = matrices[src + k]!;
  }

  function release(r: number): void {
    recActive[r] = 0;
    recStart[r] = NONE;
    recActor[r] = NONE;
    recArmed[r] = 0;
    free[freeLen++] = r;
  }

  function grow(n: number): void {
    if (n <= actorRecord.length) return;
    const size = Math.max(n, actorRecord.length * 2);
    actorRecord = new Int16Array(size).fill(NONE);
    actorFresh = new Uint8Array(size);
    actorMannequin = new Uint8Array(size);
    const last = new Int16Array(size).fill(NONE);
    last.set(lastRecord);
    lastRecord = last;
  }

  const inst: FigureInstances = {
    capacity,
    matrices,
    data,
    get count() {
      return count;
    },
    get prefixEnd() {
      return prefixEnd;
    },
    recStart,
    recBoxes,
    recTemplate,
    recWeapon,
    recArmed,
    recForce,
    get actorRecord() {
      return actorRecord;
    },
    get actorFresh() {
      return actorFresh;
    },
    get actorMannequin() {
      return actorMannequin;
    },
    get prefixDirty() {
      return prefixDirty;
    },
    get dataFirst() {
      return dataFirst;
    },
    get dataLast() {
      return dataLast;
    },
    get overflow() {
      return overflow;
    },
    get events() {
      return events;
    },
    get compactions() {
      return compactions;
    },
    graveKey,
    graveBones,
    graveTemplate,
    graveSkin,

    setTemplates(next) {
      templates = next;
      reset();
    },

    begin(f, n) {
      frame = f;
      actorCount = n;
      grow(n);
      for (let i = 0; i < n; i++) {
        actorRecord[i] = NONE;
        actorFresh[i] = 0;
        actorMannequin[i] = 0;
      }
      prefixDirty = false;
      dataFirst = NONE;
      dataLast = NONE;
      overflow = 0;
    },

    place(i, key, mannequin, template, skin, slot, hash) {
      // quente:
      const t = templates;
      if (!t || template >= t.count) return NONE;
      const k = key >>> 0;
      const isM = mannequin ? 1 : 0;
      let r = lastRecord[i]!;
      if (r < 0 || recActive[r] === 0 || recKey[r] !== k || recMannequin[r] !== isM) {
        r = NONE;
        for (let q = 0; q < recs; q++) {
          if (recActive[q] === 1 && recKey[q] === k && recMannequin[q] === isM) {
            r = q;
            break;
          }
        }
      }
      if (r >= 0 && recSeen[r] === frame) return NONE;
      const boxes = t.length[template]!;
      if (r < 0) {
        if (freeLen === 0) {
          overflow++;
          return NONE;
        }
        r = free[--freeLen]!;
        recActive[r] = 1;
        recKey[r] = k;
        recMannequin[r] = isM;
        recStart[r] = NONE;
        recNew[r] = 1;
        recData[r] = 1;
        recTemplate[r] = template;
        recBoxes[r] = boxes;
        recSkin[r] = skin;
        recSlot[r] = slot;
        recHash[r] = hash;
        recArmed[r] = 0;
        recForce[r] = 0;
        events++;
        if (isM === 1) prefixChanged = true;
      } else if (recTemplate[r] !== template || recBoxes[r] !== boxes) {
        // Outro gabarito: a faixa muda de tamanho, então sai e entra de novo no fim (pose com `force`).
        recTemplate[r] = template;
        recBoxes[r] = boxes;
        recSkin[r] = skin;
        recSlot[r] = slot;
        recNew[r] = 1;
        recData[r] = 1;
        events++;
        if (isM === 1) prefixChanged = true;
      } else if (recSkin[r] !== skin || recSlot[r] !== slot) {
        recSkin[r] = skin;
        recSlot[r] = slot;
        recData[r] = 1;
        events++;
        if (isM === 1) prefixDirty = true;
      }
      if (isM === 1 && recHash[r] !== hash) {
        recHash[r] = hash;
        prefixDirty = true;
      }
      recSeen[r] = frame;
      recActor[r] = i;
      lastRecord[i] = r;
      actorRecord[i] = r;
      actorMannequin[i] = isM;
      return r;
      // fim-quente
    },

    end() {
      // Saídas: quem não foi visto neste quadro deixa as matrizes de osso no cemitério e libera o registro.
      let removed = false;
      for (let r = 0; r < recs; r++) {
        if (recActive[r] !== 1 || recSeen[r] === frame) continue;
        bury(r);
        if (recMannequin[r] === 1) prefixChanged = true;
        else removed = true;
        release(r);
        events++;
      }
      // Ordem nova dos atores (os que continuam, na ordem das faixas; os que mudaram de gabarito vão para o fim).
      let n2 = 0;
      for (let q = 0; q < orderLen; q++) {
        const r = order[q]!;
        if (recActive[r] === 1 && recMannequin[r] === 0 && recNew[r] === 0) order2[n2++] = r;
        else if (recActive[r] === 1 && recMannequin[r] === 0) removed = true;
      }

      if (prefixChanged) {
        // Prefixo novo (loading, ou manequim que entra/sai): tudo é refeito, e todo ator posa com `force`.
        prefixChanged = false;
        prefixDirty = true;
        mannequinLen = 0;
        let start = 0;
        for (let r = 0; r < recs; r++) {
          if (recActive[r] !== 1 || recMannequin[r] !== 1) continue;
          if (start + recBoxes[r]! > capacity) {
            overflow++;
            release(r);
            continue;
          }
          mannequins[mannequinLen++] = r;
          recStart[r] = start;
          recNew[r] = 0;
          recData[r] = 0;
          start += recBoxes[r]!;
        }
        prefixEnd = start;
        orderLen = 0;
        for (let q = 0; q < n2; q++) {
          const r = order2[q]!;
          recNew[r] = 1;
        }
        // Os que já tinham faixa entram na ordem antiga, e os novos depois.
        for (let q = 0; q < n2; q++) order[orderLen++] = order2[q]!;
        for (let r = 0; r < recs; r++) {
          if (recActive[r] === 1 && recMannequin[r] === 0 && recNew[r] === 1 && !inOrder(r)) order[orderLen++] = r;
        }
        count = prefixEnd;
        let w = 0;
        for (let q = 0; q < orderLen; q++) {
          const r = order[q]!;
          if (count + recBoxes[r]! > capacity) {
            overflow++;
            release(r);
            continue;
          }
          order[w++] = r;
          recStart[r] = count;
          recData[r] = 1;
          count += recBoxes[r]!;
        }
        orderLen = w;
        for (let q = 0; q < mannequinLen; q++) writeData(mannequins[q]!);
      } else {
        // Compactação (só em evento): as faixas que continuam descem, matrizes e dados juntos.
        let start = prefixEnd;
        if (removed) {
          for (let q = 0; q < n2; q++) {
            const r = order2[q]!;
            const from = recStart[r]!;
            const n = recBoxes[r]!;
            if (from !== start) {
              matrices.copyWithin(start * MAT4, from * MAT4, (from + n) * MAT4);
              data.copyWithin(start * INSTANCE_FLOATS, from * INSTANCE_FLOATS, (from + n) * INSTANCE_FLOATS);
              recStart[r] = start;
              markData(start, start + n - 1);
              compactions++;
            }
            start += n;
          }
        } else {
          for (let q = 0; q < n2; q++) start += recBoxes[order2[q]!]!;
        }
        for (let q = 0; q < n2; q++) order[q] = order2[q]!;
        orderLen = n2;
        // Os novos (e os que trocaram de gabarito) entram no fim.
        for (let r = 0; r < recs; r++) {
          if (recActive[r] !== 1 || recMannequin[r] !== 0 || recNew[r] !== 1) continue;
          if (start + recBoxes[r]! > capacity) {
            overflow++;
            release(r);
            continue;
          }
          recStart[r] = start;
          recData[r] = 1;
          order[orderLen++] = r;
          start += recBoxes[r]!;
        }
        count = start;
      }

      // Dados do evento e o "posar com force" de quem ganhou faixa nova; manequins posam quando o prefixo muda.
      for (let r = 0; r < recs; r++) {
        if (recActive[r] !== 1) continue;
        const i = recActor[r]!;
        if (recMannequin[r] === 1) {
          if (recData[r] === 1) writeData(r);
          recData[r] = 0;
          if (i >= 0 && i < actorCount && prefixDirty) actorFresh[i] = 1;
          continue;
        }
        if (recData[r] === 1) writeData(r);
        if (recNew[r] === 1 && i >= 0 && i < actorCount) actorFresh[i] = 1;
        recData[r] = 0;
        recNew[r] = 0;
      }
      // Quem foi solto por falta de espaço não desenha neste quadro.
      for (let i = 0; i < actorCount; i++) {
        const r = actorRecord[i]!;
        if (r >= 0 && recActive[r] !== 1) actorRecord[i] = NONE;
      }
      if (prefixDirty) markData(0, prefixEnd - 1);
    },

    findGrave(key) {
      const k = key >>> 0;
      for (let d = 1; d <= FIGURE_GRAVE_SIZE; d++) {
        const g = (graveNext - d + FIGURE_GRAVE_SIZE) % FIGURE_GRAVE_SIZE;
        if (graveKey[g] === k && k !== 0) return g;
      }
      return NONE;
    },

    clear() {
      reset();
    },
  };

  function inOrder(r: number): boolean {
    for (let q = 0; q < orderLen; q++) if (order[q] === r) return true;
    return false;
  }

  return inst;
}
