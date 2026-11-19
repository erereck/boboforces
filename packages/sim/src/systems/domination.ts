import { assert } from '@boboforces/shared';
import { MAX_TEAMS } from '../constants.ts';
import type { SimContext } from '../context.ts';
import { ENTITY_FLAG, ENTITY_KIND } from '../entity.ts';

/**
 * M6 (fase 1): o Bobo Warfare Domination (GDD §4.1.2). 3 pontos (os do mapa); captura em 5 s com 1 jogador, até
 * 2,5 s com 3 ou mais; cada ponto dominado rende 1 ponto por segundo ao time; vence quem chegar à meta (200) ou estiver
 * na frente no fim do tempo (10 min). Os abates não contam no placar do time.
 *
 * O progresso vai de -1 (do time 1) a +1 (do time 0): o ponto do outro time primeiro volta a neutro (0) e só depois
 * vira seu, então tomar um ponto sozinho leva o dobro de capturar um neutro. Com os dois times em cima, nada anda.
 * Sem ninguém, o ponto volta devagar ao estado do dono (cheio se tem dono, neutro se não tem).
 */
export const DOMINATION = {
  /** Segundos para capturar com 1, 2 e 3+ bobos do mesmo time em cima. */
  captureS: [5, 3.75, 2.5],
  /** Quanto acima ou abaixo do centro do anel ainda conta como "em cima" (m). */
  heightM: 2.5,
  /** Sem ninguém em cima, o progresso volta ao do dono nesta velocidade (fração por segundo). */
  settlePerS: 0.1,
  /** A meta e o tempo padrão (a receita do card usa os mesmos). */
  scoreLimit: 200,
  timeLimitS: 600,
  /** Pontos de controle no máximo (o snapshot e o HUD reservam isto). */
  maxPoints: 5,
} as const;

/** Um ponto de controle do mapa (o centro do anel nos pés e o raio, m). */
export interface ControlPointDef {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly radius: number;
}

/** Os pontos para o HUD, a IA e o render (SOMENTE LEITURA fora da sim; o cliente online escreve pelo snapshot). */
export interface ControlPointsView {
  readonly count: number;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  readonly radius: Float32Array;
  /** O dono de cada ponto (-1 = neutro). */
  readonly owner: Int8Array;
  /** -1 (do time 1) a +1 (do time 0). */
  readonly progress: Float32Array;
}

/** O estado dos pontos (o mesmo objeto é a view: o snapshot e a rede escrevem aqui). */
export class ControlPoints implements ControlPointsView {
  readonly count: number;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  readonly radius: Float32Array;
  readonly owner: Int8Array;
  readonly progress: Float32Array;
  /** Ticks de pontos acumulados por time (cada `hz` vira 1 ponto no placar). */
  readonly scoreTicks = new Int32Array(MAX_TEAMS);
  /** Rascunho: bobos de cada time em cima do ponto da vez. */
  readonly onPoint = new Int32Array(MAX_TEAMS);

  constructor(points: readonly ControlPointDef[]) {
    assert(points.length > 0 && points.length <= DOMINATION.maxPoints, 'sim: 1 a 5 pontos de controle');
    const n = points.length;
    this.count = n;
    this.x = new Float32Array(n);
    this.y = new Float32Array(n);
    this.z = new Float32Array(n);
    this.radius = new Float32Array(n);
    this.owner = new Int8Array(n).fill(-1);
    this.progress = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const p = points[i]!;
      assert(
        Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z) && p.radius > 0,
        `sim: ponto de controle ${i} inválido`,
      );
      this.x[i] = p.x;
      this.y[i] = p.y;
      this.z[i] = p.z;
      this.radius[i] = p.radius;
    }
  }
}

/** A velocidade da captura (fração do caminho de 0 a 1 por tick) com `n` bobos do mesmo time em cima. */
function captureRate(n: number, hz: number): number {
  const s = DOMINATION.captureS[Math.min(n, DOMINATION.captureS.length) - 1]!;
  return 1 / (s * hz);
}

/** Passo do Domination (entre o dano e as regras do placar): captura, posse e pontos. */
export function dominationSystem(ctx: SimContext): void {
  const cp = ctx.domination;
  if (cp === null) return;
  const m = ctx.match;
  if (m.phase !== 'playing' && m.phase !== 'suddenDeath') return;
  const s = ctx.s;
  const hz = ctx.hz;
  for (let i = 0; i < cp.count; i++) {
    const on = cp.onPoint;
    on.fill(0);
    const px = cp.x[i]!;
    const py = cp.y[i]!;
    const pz = cp.z[i]!;
    const r2 = cp.radius[i]! * cp.radius[i]!;
    for (let e = 0; e < s.count; e++) {
      if (s.alive[e] !== 1 || s.kind[e] !== ENTITY_KIND.bobo) continue;
      if ((s.flags[e]! & (ENTITY_FLAG.dead | ENTITY_FLAG.downed)) !== 0) continue;
      const team = s.team[e]!;
      if (team > 1) continue;
      const dy = s.position[e * 3 + 1]! - py;
      if (dy > DOMINATION.heightM || dy < -DOMINATION.heightM) continue;
      const dx = s.position[e * 3]! - px;
      const dz = s.position[e * 3 + 2]! - pz;
      if (dx * dx + dz * dz <= r2) on[team]!++;
    }
    const a = on[0]!;
    const b = on[1]!;
    const before = cp.progress[i]!;
    let p = before;
    if (a > 0 && b === 0) p = Math.min(1, p + captureRate(a, hz));
    else if (b > 0 && a === 0) p = Math.max(-1, p - captureRate(b, hz));
    else if (a === 0 && b === 0) {
      // Sem ninguém: volta ao estado do dono.
      const rest = cp.owner[i] === 0 ? 1 : cp.owner[i] === 1 ? -1 : 0;
      const step = DOMINATION.settlePerS / hz;
      p = p < rest ? Math.min(rest, p + step) : Math.max(rest, p - step);
    }
    cp.progress[i] = p;
    // A posse: cheio é do time; o dono perde o ponto quando o progresso cruza o neutro.
    const owner = cp.owner[i]!;
    if (owner !== 0 && p >= 1) {
      cp.owner[i] = 0;
      ctx.events.point(ctx.tick, i, 0, 'captured');
    } else if (owner !== 1 && p <= -1) {
      cp.owner[i] = 1;
      ctx.events.point(ctx.tick, i, 1, 'captured');
    } else if ((owner === 0 && p <= 0 && before > 0) || (owner === 1 && p >= 0 && before < 0)) {
      cp.owner[i] = -1;
      ctx.events.point(ctx.tick, i, owner, 'neutralized');
    }
  }
  // Os pontos: cada ponto dominado rende 1 por segundo ao time dono.
  for (let i = 0; i < cp.count; i++) {
    const owner = cp.owner[i]!;
    if (owner < 0) continue;
    cp.scoreTicks[owner] = cp.scoreTicks[owner]! + 1;
    if (cp.scoreTicks[owner]! >= hz) {
      cp.scoreTicks[owner] = cp.scoreTicks[owner]! - hz;
      m.teamScore[owner] = m.teamScore[owner]! + 1;
    }
  }
}
