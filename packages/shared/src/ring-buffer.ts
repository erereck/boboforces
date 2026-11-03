import { assert } from './assert.ts';

/**
 * Fila circular de capacidade fixa: ao encher, `push` sobrescreve o mais antigo (e o devolve, para voltar a um pool).
 * Usos: histórico de hitboxes da lag compensation, últimos erros do relatório, amostras de frame do F2, inputs repetidos.
 */
export class RingBuffer<T> {
  readonly capacity: number;
  private readonly items: (T | undefined)[];
  private head = 0; // posição do mais antigo
  private count = 0;

  constructor(capacity: number) {
    assert(capacity > 0, 'RingBuffer: capacidade precisa ser positiva');
    this.capacity = capacity;
    this.items = new Array<T | undefined>(capacity).fill(undefined);
  }

  get length(): number {
    return this.count;
  }

  get full(): boolean {
    return this.count === this.capacity;
  }

  /** Acrescenta no fim. Se estava cheio, devolve o item mais antigo que saiu; senão, `undefined`. */
  push(item: T): T | undefined {
    if (this.count < this.capacity) {
      this.items[(this.head + this.count) % this.capacity] = item;
      this.count++;
      return undefined;
    }
    const evicted = this.items[this.head];
    this.items[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    return evicted;
  }

  /** Remove e devolve o mais antigo. */
  shift(): T | undefined {
    if (this.count === 0) return undefined;
    const item = this.items[this.head];
    this.items[this.head] = undefined;
    this.head = (this.head + 1) % this.capacity;
    this.count--;
    return item;
  }

  /** `i = 0` é o mais antigo; `i = length - 1`, o mais novo. */
  get(i: number): T {
    assert(i >= 0 && i < this.count, `RingBuffer: índice ${i} fora de [0, ${this.count})`);
    return this.items[(this.head + i) % this.capacity] as T;
  }

  /** O mais novo, ou `undefined` se vazio. */
  latest(): T | undefined {
    return this.count === 0 ? undefined : this.items[(this.head + this.count - 1) % this.capacity];
  }

  /** O mais antigo, ou `undefined` se vazio. */
  oldest(): T | undefined {
    return this.count === 0 ? undefined : this.items[this.head];
  }

  clear(): void {
    this.items.fill(undefined);
    this.head = 0;
    this.count = 0;
  }

  /** Do mais antigo ao mais novo, sem alocar. */
  forEach(fn: (item: T, index: number) => void): void {
    for (let i = 0; i < this.count; i++) fn(this.items[(this.head + i) % this.capacity] as T, i);
  }

  /** Cópia em array (aloca; só para debug, relatório e testes). */
  toArray(): T[] {
    const out: T[] = [];
    this.forEach((item) => out.push(item));
    return out;
  }
}
