/**
 * M10 (fase 0): as camadas da Estação Lunar (PLANO_M10 fase 4). No fim da tira: as de antes não mudam de lugar. O
 * vidro das janelas é o `glass` / `glass-pane` de sempre (programa translúcido); o neon é a camada emissiva.
 *
 * - `regolith` (contínuo, 3 variantes): o chão cinza da lua (variante b com uma craterinha, c com pedrinhas).
 * - `station_panel` (2 variantes): o painel cinza médio da estação (bevel, sulco e rebites; b com a grelha).
 * - `station_floor`: o piso escuro de placas com o quadro em relevo.
 * - `neon_trim` (emissiva): a faixa de neon branco-quente numa calha escura (a camada inteira acende; a calha fica
 *   escura). Nem ciano nem amarelo: as cores de time Ciano e Amarelo não podem sumir na frente dela.
 * - `airlock_door`: a porta pesada da eclusa (nervuras horizontais e a fresta das folhas). O batente zebrado é o
 *   `hazard-block` (a camada `railing`).
 */
import type { LayerRecipe, Paint } from '../../../tools/texgen/src/paint.ts';

/** Regolito: cinza médio, manchas ±1 tom e pó claro em pares de 2 px. */
function paintRegolith(p: Paint, variant: number): void {
  const c = p.ramp('concreto');
  p.fill(c[3]!);
  p.blotches(5, c[2]!);
  p.blotches(2, c[4]!, 2, 2);
  for (let i = 0; i < 3; i++) p.hline(p.rng.int(0, 16), p.rng.int(0, 16), 2, c[2]!);
  if (variant === 1) {
    // Craterinha de 7 px: a parede de cima fica na sombra, a de baixo pega a luz, o fundo um tom abaixo.
    const cx = p.rng.int(4, 12);
    const cy = p.rng.int(4, 12);
    for (let y = -4; y <= 4; y++) {
      for (let x = -4; x <= 4; x++) {
        const d = Math.hypot(x, y);
        if (d < 2.2) p.px(cx + x, cy + y, c[2]!);
        else if (d < 3.6) p.px(cx + x, cy + y, y < 0 ? c[1]! : y > 0 ? c[4]! : c[2]!);
      }
    }
  } else if (variant === 2) {
    for (let i = 0; i < 3; i++) {
      const x = p.rng.int(0, 16);
      const y = p.rng.int(0, 16);
      p.hline(x, y, 2, c[4]!);
      p.hline(x, y + 1, 2, c[1]!);
    }
  }
}

const regolith: LayerRecipe = {
  name: 'regolith',
  kind: 'opaque',
  material: 'continuo',
  variants: 3,
  draw: paintRegolith,
};

/**
 * Painel da estação: cinza médio (`placa[0]`, não o branco: a parede fica em valores médios para o bobo de qualquer
 * time se destacar, arte-ux §5.5), bevel, sulco no meio e rebites (variante b: grelha de ventilação).
 */
function paintStationPanel(p: Paint, variant: number): void {
  const pl = p.ramp('placa');
  const c = p.ramp('concreto');
  p.fill(pl[0]!);
  p.blotches(2, c[4]!, 2, 2);
  p.bevel(0, 0, 16, 16, pl[1]!, c[3]!);
  if (variant === 1) {
    for (let y = 4; y < 12; y += 2) {
      p.hline(4, y, 8, c[3]!);
      p.hline(4, y + 1, 8, pl[1]!);
    }
  } else {
    p.hline(2, 7, 12, c[3]!);
    p.hline(2, 8, 12, pl[1]!);
  }
  for (const [x, y] of [
    [2, 2],
    [13, 2],
    [2, 13],
    [13, 13],
  ] as const) {
    p.px(x, y, c[4]!);
  }
}

const stationPanel: LayerRecipe = {
  name: 'station_panel',
  kind: 'opaque',
  material: 'modular',
  variants: 2,
  draw: paintStationPanel,
};

/** Piso da estação: placa escura de aço com bevel, quadro em relevo e parafusos nos cantos. */
const stationFloor: LayerRecipe = {
  name: 'station_floor',
  kind: 'opaque',
  material: 'modular',
  draw(p) {
    const a = p.ramp('aco');
    p.fill(a[1]!);
    p.blotches(2, a[0]!, 2, 2);
    p.bevel(0, 0, 16, 16, a[2]!, a[0]!);
    p.hline(4, 4, 8, a[2]!);
    p.vline(4, 5, 7, a[2]!);
    p.hline(4, 11, 8, a[0]!);
    p.vline(11, 4, 7, a[0]!);
    for (const [x, y] of [
      [2, 2],
      [13, 2],
      [2, 13],
      [13, 13],
    ] as const) {
      p.px(x, y, a[3]!);
    }
  },
};

/**
 * Neon branco-quente numa calha escura de aço: brilho (`emissivo[2]`), miolo branco e as bordas da calha. Nada de
 * ciano: o time Ciano não pode sumir na frente da faixa.
 */
const neonTrim: LayerRecipe = {
  name: 'neon_trim',
  kind: 'emissive',
  material: 'sinal',
  draw(p) {
    const a = p.ramp('aco');
    p.fill(a[1]!);
    p.hline(0, 0, 16, a[2]!);
    p.hline(0, 15, 16, a[0]!);
    p.hline(0, 5, 16, a[2]!);
    p.hline(0, 6, 16, p.tone('emissivo', 2));
    p.hline(0, 7, 16, p.tone('neutro', 1));
    p.hline(0, 8, 16, p.tone('neutro', 1));
    p.hline(0, 9, 16, p.tone('emissivo', 2));
    p.hline(0, 10, 16, a[0]!);
    for (const x of [1, 14]) {
      p.px(x, 2, a[2]!);
      p.px(x, 13, a[2]!);
    }
  },
};

/** Porta da eclusa: aço com nervuras horizontais a cada 4 px, a fresta das folhas na esquerda e dois parafusos. */
const airlockDoor: LayerRecipe = {
  name: 'airlock_door',
  kind: 'opaque',
  material: 'modular',
  draw(p) {
    const a = p.ramp('aco');
    p.fill(a[2]!);
    for (let y = 0; y < 16; y += 4) {
      p.hline(1, y, 15, a[3]!);
      p.hline(1, y + 3, 15, a[1]!);
    }
    p.vline(0, 0, 16, a[0]!);
    p.vline(1, 0, 16, a[3]!);
    p.px(12, 6, a[3]!);
    p.px(12, 10, a[3]!);
  },
};

export const MOON_TEXTURES: readonly LayerRecipe[] = [regolith, stationPanel, stationFloor, neonTrim, airlockDoor];
