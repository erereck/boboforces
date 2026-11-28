// M12 (fase 5, ARCHITECTURE §23.5): o peso visual da partida que a cena decide (o render só desenha). O clarão das
// vistas (o do tiro e o da explosão, que agora segura ~150 ms com ganho ~1, no teto de 3 clarões por segundo com
// "Reduzir efeitos") e o pó do chão (o pouso forte e o deslize a cada 0,1 s). Puro: sem DOM, sem relógio, sem
// alocação por quadro (os rascunhos crescem só quando a capacidade da sim cresce).

export const VISUAL_FX = {
  /** O clarão do tiro (arte-ux.md §1.8): ganho, alcance e queda (s, de 1 a 0). */
  shotFlashGain: 0.35,
  flashRangeM: 30,
  flashDecayS: 0.08,
  /** M12: a explosão clareia como um clarão de verdade: ganho ~1, segura `explosionFlashHoldS` antes de cair. */
  explosionFlashGain: 1,
  explosionFlashHoldS: 0.15,
  /** "Reduzir efeitos": no máximo 3 clarões por segundo em cada vista (um novo antes disso é ignorado). */
  reducedFlashGapS: 1 / 3,
  /** O pó do pouso: nada abaixo de `landDustMinSpeed` (m/s de queda; o pulo no plano pousa a ~4,5) e cheio em `..Full`. */
  landDustMinSpeed: 6,
  landDustFullSpeed: 11,
  /**
   * O pó do deslize: um a cada `slideDustEveryS` s (o dobro com "Reduzir efeitos"), com esta força (0..1); no
   * deslize o render solta só a nuvem e 1 cubinho (o anel de detritos do Switch é de 120–200).
   */
  slideDustEveryS: 0.1,
  slideDustStrength: 0.45,
} as const;

/** Força do pó do pouso (0 = nenhum) pela velocidade de queda do evento `move`/`land`. */
export function landDustStrength(fallSpeed: number): number {
  const F = VISUAL_FX;
  if (!(fallSpeed >= F.landDustMinSpeed)) return 0;
  const k = (fallSpeed - F.landDustMinSpeed) / (F.landDustFullSpeed - F.landDustMinSpeed);
  return 0.4 + 0.6 * (k < 1 ? k : 1);
}

/**
 * O clarão de cada vista (o valor fica no slot da cena; aqui o "segurar" e o teto do "Reduzir efeitos"). `bump` soma um
 * clarão e devolve o novo valor; `decay` faz ele cair (depois de segurar).
 */
export interface ViewFlashes {
  bump(view: number, current: number, gain: number, holdS: number, nowS: number, reduced: boolean): number;
  decay(view: number, current: number, dt: number): number;
  reset(): void;
}

export function createViewFlashes(views = 8): ViewFlashes {
  const hold = new Float64Array(views);
  const lastAt = new Float64Array(views).fill(-1e9);
  return {
    bump(view, current, gain, holdS, nowS, reduced) {
      if (!(gain > 0)) return current;
      const inside = view >= 0 && view < views;
      if (inside && reduced && nowS - lastAt[view]! < VISUAL_FX.reducedFlashGapS) return current;
      if (inside) {
        lastAt[view] = nowS;
        // O segurar é proporcional à contribuição (a explosão longe quase não segura).
        const h = holdS * (gain < 1 ? gain : 1);
        if (h > hold[view]!) hold[view] = h;
      }
      const next = current + gain;
      return next < 1 ? next : 1;
    },
    decay(view, current, dt) {
      if (view >= 0 && view < views && hold[view]! > 0) {
        hold[view] = hold[view]! - dt;
        return current;
      }
      const next = current - dt / VISUAL_FX.flashDecayS;
      return next > 0 ? next : 0;
    },
    reset() {
      hold.fill(0);
      lastAt.fill(-1e9);
    },
  };
}

/** O relógio do pó do deslize por entidade (índice da sim): `step` diz quando soltar um. */
export interface SlideDust {
  /** `reduced` ("Reduzir efeitos"): metade dos pós (um a cada 2 × `slideDustEveryS`). */
  step(entity: number, sliding: boolean, dt: number, reduced?: boolean): boolean;
}

export function createSlideDust(capacity = 64): SlideDust {
  let timer = new Float32Array(Math.max(1, capacity));
  return {
    step(entity, sliding, dt, reduced = false) {
      if (entity < 0) return false;
      if (entity >= timer.length) {
        // Só quando a sim cresce (raro): o resto do tempo, sem alocação.
        const next = new Float32Array(Math.max(entity + 1, timer.length * 2));
        next.set(timer);
        timer = next;
      }
      if (!sliding) {
        // O 1º pó sai logo no começo do deslize.
        timer[entity] = 0;
        return false;
      }
      if (!(dt > 0)) return false;
      const t = timer[entity]! - dt;
      if (t > 0) {
        timer[entity] = t;
        return false;
      }
      const every = reduced ? 2 * VISUAL_FX.slideDustEveryS : VISUAL_FX.slideDustEveryS;
      timer[entity] = t + every > 0 ? t + every : every;
      return true;
    },
  };
}
