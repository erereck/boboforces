// Colunas do boneco do FutBobo (decisão #56; PLANO do porte §A, §D linha da F7 e §E portão) para os scripts de
// navegador: draws de bonecos por vista (`ViewStats.actorDraws`), bonecos por nível de animação (`RenderStats.figureL0`
// .. `figureL2`) e a etapa "figuras" do loading. Puro (sem navegador): o `scripts/bench.ts` e o `scripts/smoke-web.ts`
// usam. O nome segue o dos arquivos do roteiro (a frente web-ferramentas é dona de `prints-plan*.ts`).
//
// Até o passo 5 o game não preenche nada disso (`actorDraws` e `figureL*` ficam 0; o relatório do bench não tem as
// chaves): tudo aqui aceita 0 ou ausente sem quebrar.

/**
 * PEDIDO DE FORMATO ao relatório do bench do game (`packages/game/src/bench/report.ts`, passo 5), lido daqui:
 * - `vista<i> … atores=15 bonecos=1` (média dos draws de bonecos da vista);
 * - uma linha `figure_lod l0=<média> l1=<média> l2=<média>` (bonecos por nível, média por quadro);
 * - `loading_ms … skins=90 figuras=40 …` (a etapa da tabela de jogo + gabaritos).
 */
export const FIGURE_REPORT_KEYS = { viewDraws: 'bonecos', lodLine: 'figure_lod', loadingStage: 'figuras' } as const;

/** Meta do porte: 1 draw de bobos por vista (todos os bobos, zumbis e manequins), mais 1 com cadáver no desmonte. */
export const ACTOR_DRAWS_PER_VIEW = 1;
export const ACTOR_DRAWS_CORPSE_EXTRA = 1;

export interface FigureLod {
  readonly l0: number;
  readonly l1: number;
  readonly l2: number;
}

/** Uma amostra do `__bfDebug.stats` durante o bench (`actorDraws` de cada vista e os níveis de LOD). */
export interface FigureSample {
  readonly views: readonly number[];
  readonly l0: number;
  readonly l1: number;
  readonly l2: number;
}

export interface FigureColumns {
  /** De onde vieram os números: o relatório do game, as amostras do script, ou nada (antes do passo 5). */
  readonly source: 'relatorio' | 'amostras' | 'ausente';
  /** Média de draws de bonecos por vista. */
  readonly actorDraws: readonly number[];
  readonly lod: FigureLod | null;
  /** Etapa "figuras" do loading (ms); `null` sem a chave no relatório. */
  readonly loadingFiguresMs: number | null;
  readonly samples: number;
}

const numberAfter = (line: string, key: string): number | null => {
  const m = new RegExp(`(?:^|\\s)${key}=(-?\\d+(?:\\.\\d+)?)(?:\\s|$)`).exec(line);
  return m ? Number(m[1]) : null;
};

/** Lê as chaves do porte no texto do relatório (`null` em cada uma que não estiver lá). */
export function parseFigureReport(report: string): {
  readonly actorDraws: number[] | null;
  readonly lod: FigureLod | null;
  readonly loadingFiguresMs: number | null;
} {
  const lines = report.split(/\r?\n/);
  const views = lines.filter((l) => /^vista\d+\s/.test(l)).map((l) => numberAfter(l, FIGURE_REPORT_KEYS.viewDraws));
  const actorDraws = views.length > 0 && views.every((v) => v !== null) ? (views as number[]) : null;
  const lodLine = lines.find((l) => l.startsWith(`${FIGURE_REPORT_KEYS.lodLine} `));
  let lod: FigureLod | null = null;
  if (lodLine) {
    const [l0, l1, l2] = ['l0', 'l1', 'l2'].map((k) => numberAfter(lodLine, k));
    if (l0 !== null && l0 !== undefined && l1 !== null && l1 !== undefined && l2 !== null && l2 !== undefined) {
      lod = { l0, l1, l2 };
    }
  }
  const loading = lines.find((l) => l.startsWith('loading_ms '));
  const loadingFiguresMs = loading ? numberAfter(loading, FIGURE_REPORT_KEYS.loadingStage) : null;
  return { actorDraws, lod, loadingFiguresMs };
}

/** Médias das amostras (vistas com o maior número de vistas visto; amostra sem vista não conta). */
export function summarizeSamples(samples: readonly FigureSample[]): {
  readonly actorDraws: number[];
  readonly lod: FigureLod | null;
} {
  const used = samples.filter((s) => s.views.length > 0);
  if (used.length === 0) return { actorDraws: [], lod: null };
  const viewCount = Math.max(...used.map((s) => s.views.length));
  const actorDraws = Array.from({ length: viewCount }, (_, i) => {
    const values = used.map((s) => s.views[i]).filter((v): v is number => typeof v === 'number');
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  });
  const mean = (pick: (s: FigureSample) => number): number => used.reduce((a, s) => a + pick(s), 0) / used.length;
  return { actorDraws, lod: { l0: mean((s) => s.l0), l1: mean((s) => s.l1), l2: mean((s) => s.l2) } };
}

/**
 * As colunas do porte: o relatório do game manda quando traz as chaves (passo 5 em diante); senão as amostras do
 * script (`__bfDebug.stats`, que já tem os campos e fica em 0 até a F3/F4); senão nada.
 */
export function figureColumns(report: string | null, samples: readonly FigureSample[]): FigureColumns {
  const parsed = report !== null ? parseFigureReport(report) : { actorDraws: null, lod: null, loadingFiguresMs: null };
  const sampled = summarizeSamples(samples);
  const fromReport = parsed.actorDraws !== null || parsed.lod !== null;
  if (fromReport) {
    return {
      source: 'relatorio',
      actorDraws: parsed.actorDraws ?? sampled.actorDraws,
      lod: parsed.lod ?? sampled.lod,
      loadingFiguresMs: parsed.loadingFiguresMs,
      samples: samples.length,
    };
  }
  const any = sampled.actorDraws.length > 0;
  return {
    source: any ? 'amostras' : 'ausente',
    actorDraws: sampled.actorDraws,
    lod: sampled.lod,
    loadingFiguresMs: parsed.loadingFiguresMs,
    samples: samples.length,
  };
}

const fixed = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** Uma linha no estilo do relatório (`chave=valor`, ASCII), para o console e o PERF.md. */
export function formatFigureColumns(c: FigureColumns): string {
  const views = c.actorDraws.map((d, i) => `vista${i}_bonecos=${fixed(d)}`).join(' ') || 'bonecos=-';
  const lod = c.lod ? `l0=${fixed(c.lod.l0)} l1=${fixed(c.lod.l1)} l2=${fixed(c.lod.l2)}` : 'l0=- l1=- l2=-';
  const loading = c.loadingFiguresMs === null ? '-' : fixed(c.loadingFiguresMs);
  return `porte_boneco fonte=${c.source} ${views} figure_lod ${lod} figuras_ms=${loading} amostras=${c.samples}`;
}

/** Uma vista como o smoke a lê: atores desenhados e draws de bonecos (`null` = o game ainda não tem o campo). */
export interface ViewActorStats {
  readonly actors: number;
  readonly actorDraws: number | null;
}

/**
 * Confere "1 draw de bobos por vista" (PLANO do porte §E, portão): com atores na vista, entre 1 e 1 + o do desmonte;
 * sem atores, no máximo isso. Devolve os problemas (vazio = ok).
 */
export function checkActorDraws(views: readonly ViewActorStats[], label: string): string[] {
  const max = ACTOR_DRAWS_PER_VIEW + ACTOR_DRAWS_CORPSE_EXTRA;
  const out: string[] = [];
  views.forEach((v, i) => {
    if (v.actorDraws === null) {
      out.push(`${label}: vista ${i} sem actorDraws nas estatísticas (o game ainda não mede os draws de bonecos)`);
    } else if (v.actors > 0 && v.actorDraws < ACTOR_DRAWS_PER_VIEW) {
      out.push(
        `${label}: vista ${i} com ${v.actors} atores e ${v.actorDraws} draws de bonecos (esperado ${ACTOR_DRAWS_PER_VIEW})`,
      );
    } else if (v.actorDraws > max) {
      out.push(
        `${label}: vista ${i} com ${v.actorDraws} draws de bonecos (esperado ${ACTOR_DRAWS_PER_VIEW}, +1 com cadáver)`,
      );
    }
  });
  return out;
}
