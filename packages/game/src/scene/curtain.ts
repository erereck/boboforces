// M12 (fase 5, item 7, ARCHITECTURE §23.5): a entrada da partida sem tranco. O loading acaba e a cena ainda passa
// `prerollFrames` quadros desenhando de verdade SEM dar passo na sim (o 1º uso de cada buffer, textura e caminho do JIT
// cai aqui, atrás de uma cortina preta), e depois a cortina sai do preto em `fadeS` (instantânea com "Reduzir
// efeitos"). A pré-rodada tem também um teto em TEMPO (`prerollMaxS`, com o dt de cada quadro preso em `prerollDtMaxS`:
// o 1º quadro carrega o fim do loading): numa máquina lenta (o smoke a ~2 fps) ela não come segundos. Puro: sem
// relógio, sem DOM.

export const CURTAIN = {
  /** Quadros da pré-rodada (o console levava 4–6 quadros de mais de 100 ms nos 120 primeiros). */
  prerollFrames: 20,
  /** Teto da pré-rodada em tempo de jogo (s) e o dt máximo que um quadro conta para ele (s). */
  prerollMaxS: 0.5,
  prerollDtMaxS: 0.25,
  /** A saída do preto (s). */
  fadeS: 0.3,
} as const;

export interface Curtain {
  /** Ainda na pré-rodada: a sim não anda e a tela fica preta. */
  readonly prerolling: boolean;
  /** A cortina acabou (pré-rodada e saída do preto): os prints e o "pronto" esperam por isto. */
  readonly done: boolean;
  /**
   * Um quadro desenhado: anda a pré-rodada (um quadro) ou a saída do preto (`dt`) e devolve o alfa da cortina, 0..1
   * (0 = sem cortina). `reduced` ("Reduzir efeitos"): sai do preto de uma vez quando a pré-rodada acaba.
   */
  frame(dt: number, reduced: boolean): number;
}

export function createCurtain(prerollFrames: number = CURTAIN.prerollFrames, fadeS: number = CURTAIN.fadeS): Curtain {
  let left = Math.max(0, Math.floor(prerollFrames));
  let prerollT = 0;
  let t = 0;
  let done = false;
  return {
    get prerolling() {
      return left > 0;
    },
    get done() {
      return done;
    },
    frame(dt, reduced) {
      const step = dt > 0 ? (dt < CURTAIN.prerollDtMaxS ? dt : CURTAIN.prerollDtMaxS) : 0;
      if (left > 0) {
        left--;
        prerollT += step;
        if (prerollT >= CURTAIN.prerollMaxS) left = 0;
        return 1;
      }
      if (done) return 0;
      if (reduced || !(fadeS > 0)) {
        done = true;
        return 0;
      }
      t += step;
      if (t >= fadeS) {
        done = true;
        return 0;
      }
      return 1 - t / fadeS;
    },
  };
}
