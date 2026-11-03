import { MAX_FRAME_SECONDS, MAX_STEPS_PER_FRAME, SIM_HZ } from './constants.ts';

/**
 * Folga do acumulador, em fração de tick. Com o frame igual ao tick (60 Hz) ou múltiplo dele (Switch a 30 fps), o
 * jitter normal do relógio (rAF em 0,1 ms, vsync) deixa o acumulador oscilando em volta da fronteira e a conta vira
 * 0/1/2 ticks por frame no lugar de 1. Até 2% de um inteiro, o frame conta como o inteiro: o acumulador fica levemente
 * negativo e o próximo frame compensa. Diferença de ritmo de verdade (59,94 Hz, 144 Hz) passa direto.
 */
const SNAP_TICKS = 0.02;

/**
 * Acumulador do passo fixo (tecnico.md §4.2): o laço de render chama `advance(segundosDoFrame)` e roda `sim.step()`
 * tantas vezes quanto o retorno; o render interpola com `alpha`. Frame limitado a 0,1 s e no máximo 4 passos.
 * Só o driver (game) usa: a sim em si não sabe de tempo real.
 */
export class FixedStep {
  readonly hz: number;
  readonly dt: number;
  private accumulator = 0;
  private lastAlpha = 0;

  constructor(hz: number = SIM_HZ) {
    this.hz = hz;
    this.dt = 1 / hz;
  }

  /** Acumula o tempo do frame e devolve quantos ticks rodar agora (0..MAX_STEPS_PER_FRAME). */
  advance(frameSeconds: number): number {
    const frame = frameSeconds > MAX_FRAME_SECONDS ? MAX_FRAME_SECONDS : frameSeconds < 0 ? 0 : frameSeconds;
    this.accumulator += frame;
    const ticks = this.accumulator / this.dt;
    let steps = Math.floor(ticks);
    if (ticks - steps > 1 - SNAP_TICKS) steps++;
    if (steps > MAX_STEPS_PER_FRAME) {
      steps = MAX_STEPS_PER_FRAME;
      // Descarta o excesso: melhor a sim ficar mais lenta que entrar em espiral.
      this.accumulator = 0;
    } else {
      this.accumulator -= steps * this.dt;
    }
    // Com a folga o acumulador pode ficar um fio abaixo de zero: o render não extrapola para trás.
    this.lastAlpha = this.accumulator > 0 ? this.accumulator / this.dt : 0;
    return steps;
  }

  /** Fração [0, 1) entre o tick anterior e o atual, para interpolar o render. */
  get alpha(): number {
    return this.lastAlpha;
  }

  reset(): void {
    this.accumulator = 0;
    this.lastAlpha = 0;
  }
}
