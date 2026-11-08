// Cena da sonda T4 do Eden (#56): conferida em Node, sem GL. A casca do Switch desenha a mesma cena com o programa 4
// REAL e compara os pixels lidos com estas amostras (gêmeo do VS); no Edge passa 108/108 nas duas rotas.
import { describe, expect, it } from 'vitest';
import { checkFigureProbe, createFigureProbeScene, figureProbeTexel } from './figure-probe.ts';
import { INSTANCE_FLOATS } from './layout.ts';
import { MAT4 } from './math.ts';

describe('cena da sonda T4 das figuras', () => {
  const scene = createFigureProbeScene();

  it('25 caixas (8 rostos, cruz, paleta, coluna, mini-cruz, giro, luz, clarão, escondidos) + 7 props do caminho de hoje', () => {
    expect(scene.draws.map((d) => [d.name, d.instances])).toEqual([
      ['caixas', 25],
      ['hoje', 7],
    ]);
    for (const d of scene.draws) {
      expect(d.matrices.length).toBe(d.instances * MAT4);
      expect(d.data.length).toBe(d.instances * INSTANCE_FLOATS);
    }
    // Props: 4ª linha 0 0 0 1 (o caminho de hoje); caixas: 4ª linha com luz e expressão.
    const props = scene.draws[1]!.matrices;
    for (let i = 0; i < 7; i++)
      expect([...props.slice(i * 16 + 3, i * 16 + 16).filter((_, k) => k % 4 === 0)]).toEqual([0, 0, 0, 1]);
    expect(scene.samples.length).toBe(108);
    for (const s of scene.samples) {
      expect(s.x >= 0 && s.x < scene.width && s.y >= 0 && s.y < scene.height, s.name).toBe(true);
    }
    // Cada célula tem amostras de uma caixa só.
    const byCell = new Map<number, Set<string>>();
    for (const s of scene.samples) {
      const cell = Math.floor(s.y / scene.cell) * (scene.width / scene.cell) + Math.floor(s.x / scene.cell);
      byCell.set(cell, (byCell.get(cell) ?? new Set()).add(s.name));
    }
    for (const names of byCell.values()) expect(names.size).toBe(1);
    expect(scene.texels.length).toBe(scene.layers * scene.layerSize * scene.layerSize * 4);
    expect([...scene.texels.slice(0, 4)]).toEqual(figureProbeTexel(0, 0, 0));
  });

  it('confere: imagem certa passa; vazia reprova com a 1ª falha, as caixas erradas e as células', () => {
    const right = new Uint8Array(scene.width * scene.height * 4);
    for (const s of scene.samples) right.set(s.rgba, (Math.floor(s.y) * scene.width + Math.floor(s.x)) * 4);
    const ok = checkFigureProbe(scene, right);
    expect([ok.ok, ok.total, ok.firstFail, ok.failed]).toEqual([108, 108, '', '']);
    const empty = checkFigureProbe(scene, new Uint8Array(right.length));
    // Só os 2 escondidos (slot e camada externa) passam com a tela vazia.
    expect(empty.ok).toBe(2);
    expect(empty.firstFail).toMatch(/^rosto-0@/);
    expect(empty.failed.split('+')).toContain('hoje-6');
    expect(empty.cells).toBe('0'.repeat(32));
  });
});
