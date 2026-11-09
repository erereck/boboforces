import { FACE_EXPRESSIONS, FIGURE_PRESETS, FIGURE_SKIN_LAYERS } from '@boboforces/format';
import { describe, expect, it } from 'vitest';
import {
  figureTris,
  paintPreviewSkin,
  PREVIEW_LOOKS,
  previewTemplate,
  referenceFigureTris,
  restBones,
} from './figure-preview.ts';

describe('prévia do pintor do boneco (figuras)', () => {
  it('as 16 aparências prontas (12 e as 4 fantasias), cada uma uma vez', () => {
    expect([...PREVIEW_LOOKS].sort()).toEqual(Object.keys(FIGURE_PRESETS).sort());
  });

  it('a skin da prévia tem as 2 camadas 64×64 e o nível 1 32×32', () => {
    const skin = paintPreviewSkin({ look: FIGURE_PRESETS.recruit, team: -1, teamColors: [] });
    expect(skin.layers).toHaveLength(FIGURE_SKIN_LAYERS);
    expect(skin.level1).toHaveLength(FIGURE_SKIN_LAYERS);
    for (const l of skin.layers) expect([l.width, l.height, l.data.length]).toEqual([64, 64, 64 * 64 * 4]);
    for (const l of skin.level1) expect([l.width, l.height, l.data.length]).toEqual([32, 32, 32 * 32 * 4]);
  });

  it('a prévia usa o gabarito da F1 de verdade (o recuo para as 14 caixas do corpo não esconde um erro)', () => {
    // O clássico tem cabelo em caixa no FutBobo: sem as caixas dele a prévia estaria no recuo do `catch`.
    const t = previewTemplate(FIGURE_PRESETS.classico);
    expect(t.hair).toBe(true);
    expect(t.count).toBeGreaterThan(14);
  });

  it('o boneco de referência (escala do modelgen) mede 1,75 m, sola em 0, olhando para −Z', () => {
    const tris = referenceFigureTris('recruit');
    // 14 caixas do corpo × 6 faces × 2 triângulos (mais o cabelo, quando a F1 entregar).
    expect(tris.length).toBeGreaterThanOrEqual(14 * 12);
    let minY = Infinity;
    let maxY = -Infinity;
    let maxX = 0;
    for (const t of tris) {
      for (const p of t.p) {
        minY = Math.min(minY, p[1]);
        maxY = Math.max(maxY, p[1]);
        maxX = Math.max(maxX, Math.abs(p[0]));
      }
    }
    expect(minY).toBeCloseTo(0, 5);
    // O recruta é Raspado (sem caixa de cabelo acima da cabeça): o topo é o da cabeça.
    expect(maxY).toBeCloseTo(1.75, 4);
    // Braços em ARM_REST: 17,9 px de lado a lado (±0,49 m).
    expect(maxX).toBeLessThan(0.5);
    expect(maxX).toBeGreaterThan(0.45);
  });

  it('a frente da cabeça lê a célula de cada expressão e fica no −Z', () => {
    const look = FIGURE_PRESETS.classico;
    const skin = paintPreviewSkin({ look, team: -1, teamColors: [] });
    const bones = restBones(0);
    // A frente da cabeça (caixa 0, face 5 = triângulos 10 e 11): UV dentro da célula e z < 0.
    for (let e = 0; e < FACE_EXPRESSIONS.length; e++) {
      const tris = figureTris(skin, look, e, bones);
      const u0 = 16 * (e & 3);
      const v0 = 32 + 16 * (e >> 2);
      for (const t of [tris[10]!, tris[11]!]) {
        for (const [u, v] of t.uv) {
          expect(u, `expressão ${e}`).toBeGreaterThanOrEqual(u0);
          expect(u, `expressão ${e}`).toBeLessThanOrEqual(u0 + 16);
          expect(v, `expressão ${e}`).toBeGreaterThanOrEqual(v0);
          expect(v, `expressão ${e}`).toBeLessThanOrEqual(v0 + 16);
        }
        for (const p of t.p) expect(p[2]).toBeLessThan(0);
      }
    }
  });
});
