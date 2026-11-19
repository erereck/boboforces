import type { DirectorGoal } from '@boboforces/format';
import type { SimView } from '@boboforces/sim';
import { AI_DIRECTOR } from './config.ts';

/**
 * M8 (fase 5): o Diretor de Partida (gameplay.md §6.8). Lê o placar dos humanos (os controladores marcados em
 * `isHuman`, somados: no sofá vale o grupo) a cada `sampleS` segundos de sim e guarda os totais num anel; a cada
 * `adjustSamples` amostras compara o K/D da janela (até `windowSamples` amostras para trás; no começo, desde a linha
 * de base) com a faixa do objetivo e muda o ajuste em 1/4 de nível, dentro da folga dos bots (até ±`maxQuarters`). Só
 * lê a `SimView` nos ticks da sim: determinístico.
 */
export class MatchDirector {
  readonly goal: DirectorGoal;
  /** O ajuste de agora em quartos de nível (+ = bots melhores). */
  shift = 0;
  /** Quem é humano agora, por controlador (o diretor dos bots atualiza; 1 = conta). */
  private readonly isHuman: Uint8Array;
  private readonly sampleTicks: number;
  /** Os totais de abates e mortes dos humanos em cada amostra (anel de `windowSamples + 1`). */
  private readonly kills: Float64Array;
  private readonly deaths: Float64Array;
  private samples = 0;
  private lastTick = -1;
  /** Os totais quando a janela recomeçou (`rebase`): a amostra "antes da primeira". */
  private baseKills = 0;
  private baseDeaths = 0;
  /** A folga de agora (quartos de nível): até onde os bots ainda podem melhorar e piorar. */
  private up: number = AI_DIRECTOR.maxQuarters;
  private down: number = AI_DIRECTOR.maxQuarters;
  private sumKills = 0;
  private sumDeaths = 0;

  constructor(goal: DirectorGoal, hz: number, isHuman: Uint8Array) {
    this.goal = goal;
    this.isHuman = isHuman;
    this.sampleTicks = Math.max(1, Math.round(AI_DIRECTOR.sampleS * hz));
    this.kills = new Float64Array(AI_DIRECTOR.windowSamples + 1);
    this.deaths = new Float64Array(AI_DIRECTOR.windowSamples + 1);
  }

  /** Soma o placar de quem é humano agora (em `sumKills` e `sumDeaths`). */
  private total(view: SimView): void {
    let k = 0;
    let d = 0;
    for (let e = 0; e < view.count; e++) {
      const c = view.controller[e]!;
      if (c < 0 || c >= this.isHuman.length || this.isHuman[c] !== 1) continue;
      k += view.kills[e]!;
      d += view.deaths[e]!;
    }
    this.sumKills = k;
    this.sumDeaths = d;
  }

  /**
   * Quem conta mudou (alguém entrou, saiu ou assumiu um bot): a janela recomeça dos totais de agora, para o placar de
   * quem chegou ou saiu não virar um salto no K/D. O ajuste fica.
   */
  rebase(view: SimView): void {
    this.total(view);
    this.baseKills = this.sumKills;
    this.baseDeaths = this.sumDeaths;
    this.samples = 0;
  }

  /**
   * A folga dos bots que mudam (o diretor dos bots calcula pela mira deles): o ajuste não passa dela, para o placar
   * não mostrar um ajuste que não faz nada (um Tryhard "+1"). Devolve `true` se o ajuste teve de encolher.
   */
  setRange(up: number, down: number): boolean {
    this.up = up;
    this.down = down;
    const next = Math.max(-down, Math.min(up, this.shift));
    if (next === this.shift) return false;
    this.shift = next;
    return true;
  }

  /** A cada tick da sim: devolve `true` quando o ajuste mudou (o diretor dos bots reaplica a mira). */
  update(view: SimView): boolean {
    const tick = view.tick;
    if (tick <= 0 || tick % this.sampleTicks !== 0 || tick === this.lastTick) return false;
    this.lastTick = tick;
    this.total(view);
    const k = this.sumKills;
    const d = this.sumDeaths;
    const size = this.kills.length;
    const n = this.samples;
    this.kills[n % size] = k;
    this.deaths[n % size] = d;
    this.samples = n + 1;
    if (this.samples % AI_DIRECTOR.adjustSamples !== 0) return false;
    // A amostra de `windowSamples` atrás (ainda no anel); antes dela existir, a linha de base.
    const old = n - AI_DIRECTOR.windowSamples;
    // Um placar que voltou (a entidade do humano trocou) não dá número negativo.
    const kills = Math.max(0, k - (old >= 0 ? this.kills[old % size]! : this.baseKills));
    const deaths = Math.max(0, d - (old >= 0 ? this.deaths[old % size]! : this.baseDeaths));
    if (kills + deaths < AI_DIRECTOR.minEvents) return false;
    const kd = kills / Math.max(1, deaths);
    const target = AI_DIRECTOR.targets[this.goal];
    const next =
      kd > target.max
        ? Math.min(this.up, this.shift + 1)
        : kd < target.min
          ? Math.max(-this.down, this.shift - 1)
          : this.shift;
    if (next === this.shift) return false;
    this.shift = next;
    return true;
  }
}
