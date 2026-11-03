import { assert } from './assert.ts';

/**
 * Pool de objetos para o laço quente (regra 11: nada de alocação por frame).
 * Pré-aloca `capacity` itens; se esgotar, cria mais e conta em `misses` (o F2 mostra, e o perfil ajusta o tamanho).
 */
export class Pool<T> {
  private readonly free: T[] = [];
  private top = 0;
  private created = 0;
  /** Quantas vezes o pool precisou criar item além da capacidade inicial. */
  misses = 0;

  private readonly create: () => T;
  private readonly reset: (item: T) => void;

  constructor(create: () => T, reset: (item: T) => void, capacity: number) {
    assert(capacity >= 0, 'Pool: capacidade negativa');
    this.create = create;
    this.reset = reset;
    for (let i = 0; i < capacity; i++) this.free.push(create());
    this.top = capacity;
    this.created = capacity;
  }

  /** Pega um item limpo (já passou por `reset` ao ser devolvido, ou é novo). */
  acquire(): T {
    if (this.top > 0) {
      this.top--;
      return this.free[this.top] as T;
    }
    this.misses++;
    this.created++;
    return this.create();
  }

  /** Devolve um item; `reset` roda aqui, para o próximo `acquire` já sair limpo. */
  release(item: T): void {
    this.reset(item);
    this.free[this.top] = item;
    this.top++;
  }

  /** Itens prontos para `acquire` sem criar nada. */
  get available(): number {
    return this.top;
  }

  /** Total de itens criados por este pool. */
  get size(): number {
    return this.created;
  }
}

/**
 * Alocador de índices em [0, capacity) com lista livre em typed array (sem alocação depois de criado).
 * Base para slots de entidade, vozes de áudio e instâncias. A geração dos IDs (EntityId) fica na sim.
 */
export class IndexAllocator {
  readonly capacity: number;
  private readonly stack: Int32Array;
  private readonly inUse: Uint8Array;
  private top: number;

  constructor(capacity: number) {
    assert(capacity > 0, 'IndexAllocator: capacidade precisa ser positiva');
    this.capacity = capacity;
    this.stack = new Int32Array(capacity);
    this.inUse = new Uint8Array(capacity);
    // Índices baixos saem primeiro (a pilha guarda do maior para o menor).
    for (let i = 0; i < capacity; i++) this.stack[i] = capacity - 1 - i;
    this.top = capacity;
  }

  /** Próximo índice livre, ou -1 se estiver cheio. */
  alloc(): number {
    if (this.top === 0) return -1;
    this.top--;
    const index = this.stack[this.top]!;
    this.inUse[index] = 1;
    return index;
  }

  free(index: number): void {
    assert(
      index >= 0 && index < this.capacity && this.inUse[index] === 1,
      `IndexAllocator: índice ${index} não alocado`,
    );
    this.inUse[index] = 0;
    this.stack[this.top] = index;
    this.top++;
  }

  isUsed(index: number): boolean {
    return this.inUse[index] === 1;
  }

  get used(): number {
    return this.capacity - this.top;
  }

  /** Libera tudo e volta à ordem inicial (índices baixos primeiro). */
  clear(): void {
    this.inUse.fill(0);
    for (let i = 0; i < this.capacity; i++) this.stack[i] = this.capacity - 1 - i;
    this.top = this.capacity;
  }
}
