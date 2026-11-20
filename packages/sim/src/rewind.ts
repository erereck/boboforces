import { MAX_CONTROLLERS_WITH_ZOMBIES, MAX_ENTITIES } from './constants.ts';
import type { SimState } from './state.ts';

/** Ticks guardados (a 60 Hz, 400 ms: cobre o teto do rewind, `REWIND_MAX_S`, com folga). */
export const REWIND_HISTORY = 24;

/**
 * Teto da volta do tiro: 200 ms de rede (o ida e volta do tecnico.md §13.3) mais os 100 ms da interpolação do cliente e
 * ~50 ms da fila de entradas do host. Medido no loopback a 80 ms de ida: o tiro precisa voltar 300 ms (18 ticks).
 */
export const REWIND_MAX_S = 0.35;

/**
 * M5 (fase 2d, só o host online): o "tiro no que eu vi" (tecnico.md §13.3). O cliente vê os outros ~100 ms atrás mais
 * a ida e a volta da rede; o host guarda a posição, a mira e as flags de cada corpo nos últimos ticks e, no tiro
 * hitscan de um jogador remoto, testa cada alvo onde ele estava no tick que o cliente mostrava. Desligado (sem
 * histórico) fora do host online: o golden e o Switch não mudam. M9 (revisão da fase 1b): guarda também a escala dos
 * modificadores de cada corpo (`SimState.chaosScale`): o gigante apertado debaixo de teto é testado no tamanho que
 * tinha naquele tick, e não no de agora (saindo da laje, a cabeça de agora atravessava o teto onde ele estava).
 */
export class RewindState {
  /** Quantos ticks voltar no tiro de cada controlador (0 = o presente). */
  readonly byController = new Int16Array(MAX_CONTROLLERS_WITH_ZOMBIES);
  private readonly pos = new Float64Array(REWIND_HISTORY * MAX_ENTITIES * 3);
  private readonly yaw = new Float64Array(REWIND_HISTORY * MAX_ENTITIES);
  private readonly pitch = new Float64Array(REWIND_HISTORY * MAX_ENTITIES);
  private readonly flags = new Uint32Array(REWIND_HISTORY * MAX_ENTITIES);
  private readonly scale = new Float32Array(REWIND_HISTORY * MAX_ENTITIES);
  private readonly ticks = new Int32Array(REWIND_HISTORY).fill(-1);
  private readonly counts = new Int32Array(REWIND_HISTORY);
  private readonly saved = new Float64Array(6);
  private slot = 0;
  /** Ticks voltados no tiro em andamento (0 = nenhum). */
  active = 0;
  /** O tick para onde voltou (a chave do cache das caixas do boneco). */
  tick = 0;
  /** Tiros que voltaram no tempo (o F2 e os testes). */
  rewound = 0;

  /**
   * Guarda o estado do fim do tick `tick` (a numeração dos snapshots: o tick depois do `step`), com a escala dos
   * modificadores já refeita para ele (o `updateChaosScales` do fim do `step` roda antes).
   */
  record(s: SimState, tick: number): void {
    const k = tick % REWIND_HISTORY;
    const n = s.count;
    this.ticks[k] = tick;
    this.counts[k] = n;
    this.pos.set(s.position.subarray(0, n * 3), k * MAX_ENTITIES * 3);
    this.yaw.set(s.yaw.subarray(0, n), k * MAX_ENTITIES);
    this.pitch.set(s.pitch.subarray(0, n), k * MAX_ENTITIES);
    this.flags.set(s.flags.subarray(0, n), k * MAX_ENTITIES);
    this.scale.set(s.chaosScale.subarray(0, n), k * MAX_ENTITIES);
  }

  /** Antes do tiro de `e` no tick `now`: quanto voltar (0 se o controlador não pediu ou o tick já saiu da fila). */
  select(s: SimState, e: number, now: number): void {
    this.active = 0;
    const c = s.controller[e]!;
    if (c < 0 || c >= this.byController.length) return;
    const back = this.byController[c]!;
    if (back <= 0) return;
    const target = now - back;
    const k = target % REWIND_HISTORY;
    if (target < 0 || this.ticks[k] !== target) return;
    this.slot = k;
    this.tick = target;
    this.active = back;
    this.rewound++;
  }

  /** O corpo `j` existia no tick para onde voltou. */
  has(j: number): boolean {
    return j < this.counts[this.slot]!;
  }

  /** As flags de `j` naquele tick (a postura do boneco: agachado, deslizando). */
  flagsOf(j: number): number {
    return this.flags[this.slot * MAX_ENTITIES + j]!;
  }

  /** Põe `j` onde estava, no tamanho que tinha (guarda o presente); `swapOut` desfaz. Um corpo por vez. */
  swapIn(s: SimState, j: number): void {
    const o = this.slot * MAX_ENTITIES + j;
    const j3 = j * 3;
    this.saved[0] = s.position[j3]!;
    this.saved[1] = s.position[j3 + 1]!;
    this.saved[2] = s.position[j3 + 2]!;
    this.saved[3] = s.yaw[j]!;
    this.saved[4] = s.pitch[j]!;
    this.saved[5] = s.chaosScale[j]!;
    s.position[j3] = this.pos[o * 3]!;
    s.position[j3 + 1] = this.pos[o * 3 + 1]!;
    s.position[j3 + 2] = this.pos[o * 3 + 2]!;
    s.yaw[j] = this.yaw[o]!;
    s.pitch[j] = this.pitch[o]!;
    s.chaosScale[j] = this.scale[o]!;
  }

  swapOut(s: SimState, j: number): void {
    const j3 = j * 3;
    s.position[j3] = this.saved[0]!;
    s.position[j3 + 1] = this.saved[1]!;
    s.position[j3 + 2] = this.saved[2]!;
    s.yaw[j] = this.saved[3]!;
    s.pitch[j] = this.saved[4]!;
    s.chaosScale[j] = this.saved[5]!;
  }
}
