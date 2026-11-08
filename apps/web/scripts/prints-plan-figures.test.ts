import type { RenderStats, ViewStats } from '@boboforces/render';
import { describe, expect, it } from 'vitest';
import {
  ACTOR_DRAWS_PER_VIEW,
  checkActorDraws,
  FIGURE_REPORT_KEYS,
  figureColumns,
  formatFigureColumns,
  parseFigureReport,
  summarizeSamples,
  type FigureSample,
} from './prints-plan-figures.ts';

// Os campos que o bench e o smoke leem existem no contrato do render (passo 2 do porte).
const viewField: keyof ViewStats = 'actorDraws';
const lodFields: readonly (keyof RenderStats)[] = ['figureL0', 'figureL1', 'figureL2'];

/** Relatório no formato de hoje (versão 2, sem as chaves do porte), com 2 vistas. */
const REPORT_TODAY = [
  'BoboForces bench 2',
  'versao=0.0.1 codinome="Primeiro Bloco" plataforma=web perfil=pc',
  'loading_ms total=3120 assets=410 texturas=120 malha=1290 luz=820 nav=150 skins=90 shaders=360',
  'vista0 draw=41 tri=98000 regioes=9 props=6 atores=15',
  'vista1 draw=39 tri=91000 regioes=8 props=5 atores=12',
  'programas=7',
  'erros=0',
  'fim',
].join('\n');

/** O mesmo com as chaves pedidas ao game no passo 5. */
const REPORT_PORTE = REPORT_TODAY.replace('skins=90', 'skins=90 figuras=42')
  .replace('atores=15', 'atores=15 bonecos=1')
  .replace('atores=12', 'atores=12 bonecos=1.5')
  .replace('programas=7', 'figure_lod l0=10.5 l1=3 l2=2.5\nprogramas=7');

describe('colunas do porte no bench (actorDraws, figure_lod, etapa figuras)', () => {
  it('relatório de hoje: nenhuma chave, sem quebrar', () => {
    expect(viewField).toBe('actorDraws');
    expect(lodFields.length).toBe(3);
    expect(parseFigureReport(REPORT_TODAY)).toEqual({ actorDraws: null, lod: null, loadingFiguresMs: null });
    const none = figureColumns(REPORT_TODAY, []);
    expect(none).toMatchObject({ source: 'ausente', actorDraws: [], lod: null, loadingFiguresMs: null });
    expect(formatFigureColumns(none)).toBe(
      'porte_boneco fonte=ausente bonecos=- figure_lod l0=- l1=- l2=- figuras_ms=- amostras=0',
    );
    expect(figureColumns(null, [])).toMatchObject({ source: 'ausente' });
  });

  it('relatório do passo 5: lê bonecos por vista, figure_lod e a etapa figuras', () => {
    expect(FIGURE_REPORT_KEYS).toEqual({ viewDraws: 'bonecos', lodLine: 'figure_lod', loadingStage: 'figuras' });
    expect(parseFigureReport(REPORT_PORTE)).toEqual({
      actorDraws: [1, 1.5],
      lod: { l0: 10.5, l1: 3, l2: 2.5 },
      loadingFiguresMs: 42,
    });
    const c = figureColumns(REPORT_PORTE, [{ views: [9, 9], l0: 9, l1: 9, l2: 9 }]);
    expect(c.source).toBe('relatorio');
    expect(formatFigureColumns(c)).toBe(
      'porte_boneco fonte=relatorio vista0_bonecos=1 vista1_bonecos=1.5 figure_lod l0=10.5 l1=3 l2=2.5 figuras_ms=42 amostras=1',
    );
    // `skins=` não pode ser lido como `figuras=` nem `atores=` como `bonecos=`.
    expect(parseFigureReport('loading_ms total=1 skins=90\nvista0 draw=1 atores=3').loadingFiguresMs).toBeNull();
  });

  it('sem as chaves no relatório, usa a média das amostras do __bfDebug.stats (0 até a F3/F4)', () => {
    const samples: FigureSample[] = [
      { views: [], l0: 0, l1: 0, l2: 0 }, // loading: sem vistas, não conta
      { views: [1, 1], l0: 12, l1: 2, l2: 4 },
      { views: [1, 2], l0: 10, l1: 4, l2: 4 },
    ];
    expect(summarizeSamples(samples)).toEqual({ actorDraws: [1, 1.5], lod: { l0: 11, l1: 3, l2: 4 } });
    const c = figureColumns(REPORT_TODAY, samples);
    expect(c).toMatchObject({ source: 'amostras', actorDraws: [1, 1.5], samples: 3 });
    const zeros = figureColumns(REPORT_TODAY, [{ views: [0], l0: 0, l1: 0, l2: 0 }]);
    expect(formatFigureColumns(zeros)).toBe(
      'porte_boneco fonte=amostras vista0_bonecos=0 figure_lod l0=0 l1=0 l2=0 figuras_ms=- amostras=1',
    );
  });
});

describe('smoke: 1 draw de bobos por vista', () => {
  it('passa com 1 (ou 2 com cadáver) quando há atores, e com 0 sem atores', () => {
    expect(ACTOR_DRAWS_PER_VIEW).toBe(1);
    expect(
      checkActorDraws(
        [
          { actors: 15, actorDraws: 1 },
          { actors: 3, actorDraws: 2 },
          { actors: 0, actorDraws: 0 },
        ],
        'bench 4 vistas',
      ),
    ).toEqual([]);
  });

  it('reprova 0 com atores (o caminho velho, que não mede), 7 draws (bobo A) e campo ausente', () => {
    const problems = checkActorDraws(
      [
        { actors: 15, actorDraws: 0 },
        { actors: 15, actorDraws: 7 },
        { actors: 15, actorDraws: null },
      ],
      'Construto',
    );
    expect(problems).toHaveLength(3);
    expect(problems[0]).toContain('vista 0 com 15 atores e 0 draws de bonecos (esperado 1)');
    expect(problems[1]).toContain('vista 1 com 7 draws');
    expect(problems[2]).toContain('vista 2 sem actorDraws');
  });
});
