/**
 * Bancada de materiais (GDD §5.8, arte-ux.md §5.2): vidro e água rasa, translúcidos, só para prints e medição (o
 * Construto jogável do M2 não tem vidro nem água). E o xadrez do `missing`, o fallback de bloco desconhecido.
 */
import type { LayerRecipe } from '../../../tools/texgen/src/paint.ts';

/** Vidro: caixilho opaco de 1 px e vidraça azulada quase transparente com dois reflexos em diagonal. */
const glass: LayerRecipe = {
  name: 'glass',
  kind: 'translucent',
  material: 'modular',
  draw(p) {
    const a = p.ramp('aco');
    const shine = p.tone('placa', 3);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.pxa(x, y, a[3]!, 64);
    for (let y = 1; y < 15; y++) {
      for (let x = 1; x < 15; x++) {
        const s = x + y;
        if (s === 9 || s === 10) p.pxa(x, y, shine, 150);
        else if (s === 13) p.pxa(x, y, shine, 110);
      }
    }
    p.hline(0, 0, 16, a[3]!);
    p.vline(0, 1, 15, a[3]!);
    p.hline(1, 15, 15, a[1]!);
    p.vline(15, 1, 14, a[1]!);
  },
};

/**
 * Água rasa animada (4 quadros a 4 qps): fundo azulado translúcido, manchas mais fundas e marolas que andam 4 px na
 * diagonal por quadro (o ciclo fecha em 16 px, seamless).
 */
const water: LayerRecipe = {
  name: 'water',
  kind: 'translucent',
  material: 'continuo',
  frames: 4,
  draw(p, _variant, frame) {
    const a = p.ramp('aco');
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.pxa(x, y, a[2]!, 150);
    for (let i = 0; i < 4; i++) {
      const x = p.rng.int(0, 16);
      const y = p.rng.int(0, 16);
      for (let k = 0; k < 6; k++) p.pxa(x + (k % 3), y + Math.floor(k / 3), a[1]!, 175);
    }
    const shift = frame * 4;
    for (let i = 0; i < 4; i++) {
      const x = p.rng.int(0, 16) + shift;
      const y = p.rng.int(0, 16) + shift;
      p.pxa(x, y, a[3]!, 205);
      p.pxa(x + 1, y, a[3]!, 205);
      p.pxa(x + 2, y + 1, a[3]!, 205);
      p.pxa(x + 1, y + 1, p.tone('emissivo', 0), 225);
    }
  },
};

/** Xadrez de 8 px roxo e preto: bloco sem definição (fallback de conteúdo). Só ele usa cor de time e preto puro. */
const missing: LayerRecipe = {
  name: 'missing',
  kind: 'opaque',
  material: 'debug',
  draw(p) {
    const a = p.tone('time', 3);
    const b = p.tone('neutro', 0);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.px(x, y, ((x >> 3) + (y >> 3)) % 2 === 0 ? a : b);
  },
};

export const BENCH_TEXTURES: readonly LayerRecipe[] = [glass, water, missing];
