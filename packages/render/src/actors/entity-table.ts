// Tabela de estado por entidade (endereçamento aberto, sem alocação no laço): o render guarda o estado da animação de
// cada boneco (#56: molas, giro, nascer) mesmo que a ordem no `ActorBuffer` mude entre frames. Sem three. O layout dos
// campos é de quem cria (`ANIM_FIELDS` da animação); o padrão de 6 campos do rig do bobo A saiu no passo 5 do porte.

/** Entidade 0 (manequim) usa o índice no `ActorBuffer` como chave (geração 0xFFFE nunca existe na sim). */
export function actorKey(entity: number, index: number): number {
  return entity !== 0 ? entity >>> 0 : (0xfffe0000 | (index & 0xffff)) >>> 0;
}

export interface EntityTable {
  readonly capacity: number;
  /** Floats por entrada em `state` (o layout é de quem criou). */
  readonly fields: number;
  readonly size: number;
  readonly state: Float32Array;
  /** Índice da entrada (cria com o estado zerado se não existe). -1 só se a tabela lotar de entidades vivas. */
  slot(key: number, frame: number): number;
  /** Esquece entradas não vistas há mais de `maxAge` frames. Chamar 1x por frame (barato: só varre quando enche). */
  sweep(frame: number, maxAge: number): void;
  clear(): void;
}

/**
 * Tabela de estado por entidade com `fields` floats por entrada, no layout de quem criou (#56: a animação dos bonecos).
 * A entrada nova nasce toda zerada. O deslocamento é `slot · fields + campo`.
 */
export function createEntityTable(capacity: number, fields: number): EntityTable {
  if (!Number.isInteger(fields) || fields < 1) throw new Error(`render: campos por entidade inválidos (${fields})`);
  const cap = 1 << Math.ceil(Math.log2(Math.max(16, capacity)));
  const mask = cap - 1;
  let keys = new Uint32Array(cap);
  let seen = new Int32Array(cap);
  let state = new Float32Array(cap * fields);
  // Buffers de troca para a varredura (pré-alocados: nada é criado no laço).
  let keys2 = new Uint32Array(cap);
  let seen2 = new Int32Array(cap);
  let state2 = new Float32Array(cap * fields);
  let size = 0;

  const hash = (key: number): number => Math.imul(key ^ (key >>> 16), 0x45d9f3b) >>> 0;

  function rehash(frame: number, maxAge: number): void {
    keys2.fill(0);
    let kept = 0;
    for (let i = 0; i < cap; i++) {
      const key = keys[i]!;
      if (key === 0 || frame - seen[i]! > maxAge) continue;
      let j = hash(key) & mask;
      while (keys2[j] !== 0) j = (j + 1) & mask;
      keys2[j] = key;
      seen2[j] = seen[i]!;
      for (let f = 0; f < fields; f++) state2[j * fields + f] = state[i * fields + f]!;
      kept++;
    }
    [keys, keys2] = [keys2, keys];
    [seen, seen2] = [seen2, seen];
    [state, state2] = [state2, state];
    size = kept;
  }

  const table: EntityTable = {
    capacity: cap,
    fields,
    get size() {
      return size;
    },
    get state() {
      return state;
    },
    slot(key, frame) {
      const k = key === 0 ? 1 : key >>> 0;
      let j = hash(k) & mask;
      for (let probes = 0; probes < cap; probes++) {
        const existing = keys[j]!;
        if (existing === k) {
          seen[j] = frame;
          return j;
        }
        if (existing === 0) {
          if (size >= (cap * 3) >> 2) {
            // Cheia demais: tira as entradas velhas e procura de novo.
            rehash(frame, 2);
            if (size >= (cap * 3) >> 2) return -1;
            return table.slot(k, frame);
          }
          keys[j] = k;
          seen[j] = frame;
          state.fill(0, j * fields, j * fields + fields);
          size++;
          return j;
        }
        j = (j + 1) & mask;
      }
      return -1;
    },
    sweep(frame, maxAge) {
      if (size >= cap >> 1) rehash(frame, maxAge);
    },
    clear() {
      keys.fill(0);
      size = 0;
    },
  };
  return table;
}
