import type { BenchConfig } from './types.ts';

/**
 * Relatório do bench (texto que a web mostra para COPIAR e o Switch grava no `runtime.log`, linha a linha com o
 * prefixo `[bench] `). Formato de linhas `chave=valor` separadas por espaço, ASCII, sem acento, fácil de ler e de
 * colar no `docs/PERF.md`. Texto livre vai entre aspas duplas (aspas internas viram simples). Números: inteiros como
 * estão, frações com 1 casa (ms com 2), sem `Intl`. Ordem e nomes FIXOS (versão `BENCH_REPORT_VERSION`):
 *
 *   BoboForces bench 2
 *   versao=0.0.1 codinome="Primeiro Bloco" plataforma=switch perfil=switch34p
 *   sistema="..." gpu="..." tela=1280x720 dpr=1 three=187 textura=array atributos=int
 *   cena=construto vistas=4 bots=12 zumbis=0 armados=1 visao=50 hora=day duracao=600 aquecimento=10 rota=- semente=1 hz=60 gpufinish=0
 *     hud=1 vm=1 fx=1 atores=1 bots_efetivos=12 manequins=6 detritos=120          (continuação da mesma linha)
 *   loading_ms total=3120 assets=410 texturas=120 malha=1290 luz=820 nav=150 skins=90 figuras=40 shaders=360
 *   frames=17980 segundos=600.0 fps=29.97
 *   frame_ms media=33.37 p50=33.33 p90=34.10 p99=38.90 max=52.00
 *   frames_lentos 40a60=12 60a100=3 100a250=1 acima250=0 vaos_1s=0
 *   inicio_ms primeiro=48.00 max=61.00 travadas_inicio=0 frames=120
 *   cpu_ms p50=21.40 p99=29.80
 *   gpu_ms -                          (ou: gpu_ms p50=.. p99=.. com gpufinish=1)
 *   fases_ms sim=3.10 ia=2.40 render=12.80 ui=1.10
 *   sim_ia_ms sim_media=3.05 sim_p99=6.00 sim_max=9.00 ia_media=2.38 ia_p99=7.00 ia_max=15.00 ticks=36000 sim_por_tick=1.52 ia_por_tick=1.19
 *   vista0 draw=41 tri=98000 regioes=9 props=6 atores=15 bonecos=1
 *   (uma linha por vista)
 *   figure_lod l0=10.0 l1=2.0 l2=3.0
 *   figuras skins=10 estouro=0 gabaritos=4 corpos_fora=0
 *   programas=7
 *   memoria_mb heap_max=148.2 heap_limite=-1 texturas=3.4 malhas=18.7
 *   gc_pausas=2
 *   avisos=0                          (+ uma linha `aviso "..."` por aviso, até 10)
 *   erros=0                           (+ uma linha `erro "..."` por erro, até 5: os `error:` do three)
 *   fim
 *
 * Versão 2 (verificação do M1): `bots_efetivos` (o motor limita vistas + bots a 64), `manequins` (estáticos do mapa,
 * fora dos bots), `detritos` (teto do perfil), as chaves de bissecção `hud`/`vm`/`fx`/`atores`, `frames_lentos`
 * (histograma acima de 40 ms e os vãos de mais de 1 s, que ficam FORA das estatísticas: HOME, sleep), `inicio_ms` (os
 * primeiros frames da partida, onde aparece a travada de shader) e `sim_ia_ms` (média, cauda e custo por tick; no
 * nx.js o relógio é em ms inteiros, então a mediana sozinha dava 0).
 *
 * Porte do boneco do FutBobo (#56; chaves só ACRESCENTADAS, a versão continua 2; o roteiro da web lê pelos nomes de
 * `FIGURE_REPORT_KEYS`): `bonecos` em cada vista (média dos draws de corpo de bobo), a linha `figure_lod` (bonecos por
 * nível de animação, média por frame), `figuras` no `loading_ms` (tabela de jogo + gabaritos) e a linha `figuras`
 * (skins pintadas, conjuntos que estouraram a reserva e gabaritos).
 */
export const BENCH_REPORT_VERSION = 2;

export interface BenchStats {
  readonly avg: number;
  readonly p50: number;
  readonly p90: number;
  readonly p99: number;
  readonly max: number;
}

export interface BenchViewReport {
  readonly drawCalls: number;
  readonly triangles: number;
  readonly regions: number;
  readonly propGroups: number;
  readonly actors: number;
  /** Draws de corpo de bobo (`ViewStats.actorDraws`; a meta do porte é 1). */
  readonly actorDraws: number;
}

/** Bonecos por nível de animação (média por frame de `RenderStats.figureL0..L2`). */
export interface BenchFigureLod {
  readonly l0: number;
  readonly l1: number;
  readonly l2: number;
}

export interface BenchReport {
  readonly version: string;
  readonly codename: string;
  readonly platform: string;
  /** Perfil efetivo (`switch34p`…). */
  readonly profile: string;
  readonly system: string;
  readonly gpu: string;
  readonly screenWidth: number;
  readonly screenHeight: number;
  readonly pixelRatio: number;
  readonly threeRevision: string;
  readonly config: BenchConfig;
  /** Bots extras de verdade na partida (sem os jogadores locais): `config.bots` limitado pelo motor. */
  readonly effectiveBots: number;
  /** Manequins estáticos do mapa desenhados (a vitrine; os de print só aparecem com a câmera do print). */
  readonly mannequins: number;
  /** Teto de cubinhos de detrito do perfil (`PlatformProfile.maxDebris`). */
  readonly maxDebris: number;
  /** Loading cronometrado (ms): total e fases. */
  readonly loadingMs: {
    readonly total: number;
    readonly assets: number;
    /** Montagem dos 2 texture arrays e subida (`setTextures`, `setModels`). */
    readonly textures: number;
    readonly mesh: number;
    readonly light: number;
    readonly nav: number;
    readonly skins: number;
    /** #56: tabela de jogo + gabaritos dos looks da cena. */
    readonly figures: number;
    readonly shaders: number;
  };
  readonly frames: number;
  readonly seconds: number;
  readonly frameMs: BenchStats;
  /** Frames lentos da medição por faixa (ms) e vãos de mais de 1 s descartados das estatísticas. */
  readonly slowFrames: {
    readonly from40: number;
    readonly from60: number;
    readonly from100: number;
    readonly from250: number;
    readonly gaps: number;
  };
  /** Começo da partida (antes e durante o aquecimento): primeiro frame, maior frame e frames ≥ 100 ms. */
  readonly startupMs: {
    readonly first: number;
    readonly max: number;
    readonly stalls: number;
    readonly frames: number;
  };
  readonly cpuMs: { readonly p50: number; readonly p99: number };
  /** `null` sem `gpuFinish`. */
  readonly gpuMs: { readonly p50: number; readonly p99: number } | null;
  /** Medianas das fases (ms). */
  readonly phasesMs: { readonly sim: number; readonly ai: number; readonly render: number; readonly ui: number };
  /** Sim e IA por frame (média, p99, máximo) e por tick da sim (soma ÷ ticks). */
  readonly simAiMs: {
    readonly simAvg: number;
    readonly simP99: number;
    readonly simMax: number;
    readonly aiAvg: number;
    readonly aiP99: number;
    readonly aiMax: number;
    readonly ticks: number;
    readonly simPerTick: number;
    readonly aiPerTick: number;
  };
  /** Média por vista ao longo da medição. */
  readonly views: readonly BenchViewReport[];
  readonly figureLod: BenchFigureLod;
  /**
   * Skins de boneco pintadas no loading, conjuntos que estouraram a reserva (alarme), gabaritos e o maior número de
   * bonecos que não couberam na malha num frame (alarme: somem da tela).
   */
  readonly figures: {
    readonly skins: number;
    readonly overflow: number;
    readonly templates: number;
    readonly bodiesOut: number;
  };
  readonly programs: number;
  /** MB; -1 = desconhecido. */
  readonly memoryMb: {
    readonly heapMax: number;
    readonly heapLimit: number;
    readonly textures: number;
    readonly meshes: number;
  };
  readonly gcPauses: number;
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
}

function quote(text: string): string {
  return `"${text.replace(/"/g, "'").replace(/[\r\n]+/g, ' ')}"`;
}

function num(n: number, places = 1): string {
  if (!Number.isFinite(n)) return '-';
  return Number.isInteger(n) ? String(n) : n.toFixed(places);
}

const ms = (n: number): string => (Number.isFinite(n) ? n.toFixed(2) : '-');
const bit = (b: boolean): string => (b ? '1' : '0');

/** Monta o texto do relatório (uma string com `\n`; o Switch grava linha a linha com `[bench] `). */
export function formatBenchReport(r: BenchReport): string {
  const c = r.config;
  const s = r.simAiMs;
  const lines = [
    `BoboForces bench ${BENCH_REPORT_VERSION}`,
    `versao=${r.version} codinome=${quote(r.codename)} plataforma=${r.platform} perfil=${r.profile}`,
    `sistema=${quote(r.system)} gpu=${quote(r.gpu)} tela=${r.screenWidth}x${r.screenHeight} dpr=${num(r.pixelRatio, 2)}` +
      ` three=${r.threeRevision} textura=${c.textureMode} atributos=${c.vertexAttributes}`,
    `cena=${c.scene} vistas=${c.views} bots=${c.bots} zumbis=${c.zombies} armados=${bit(c.armed)}` +
      ` visao=${c.viewDistanceM} hora=${c.timeOfDay} duracao=${c.durationS} aquecimento=${c.warmupS}` +
      ` rota=${c.route ?? '-'} semente=${c.seed} hz=${c.simHz} gpufinish=${bit(c.gpuFinish)}` +
      ` hud=${bit(c.hud)} vm=${bit(c.viewmodel)} fx=${bit(c.fx)} atores=${bit(c.actors)}` +
      ` bots_efetivos=${r.effectiveBots} manequins=${r.mannequins} detritos=${r.maxDebris}`,
    `loading_ms total=${num(r.loadingMs.total, 0)} assets=${num(r.loadingMs.assets, 0)}` +
      ` texturas=${num(r.loadingMs.textures, 0)} malha=${num(r.loadingMs.mesh, 0)}` +
      ` luz=${num(r.loadingMs.light, 0)} nav=${num(r.loadingMs.nav, 0)} skins=${num(r.loadingMs.skins, 0)}` +
      ` figuras=${num(r.loadingMs.figures, 0)} shaders=${num(r.loadingMs.shaders, 0)}`,
    `frames=${r.frames} segundos=${r.seconds.toFixed(1)} fps=${r.seconds > 0 ? (r.frames / r.seconds).toFixed(2) : '-'}`,
    `frame_ms media=${ms(r.frameMs.avg)} p50=${ms(r.frameMs.p50)} p90=${ms(r.frameMs.p90)} p99=${ms(r.frameMs.p99)}` +
      ` max=${ms(r.frameMs.max)}`,
    `frames_lentos 40a60=${r.slowFrames.from40} 60a100=${r.slowFrames.from60} 100a250=${r.slowFrames.from100}` +
      ` acima250=${r.slowFrames.from250} vaos_1s=${r.slowFrames.gaps}`,
    `inicio_ms primeiro=${ms(r.startupMs.first)} max=${ms(r.startupMs.max)} travadas_inicio=${r.startupMs.stalls}` +
      ` frames=${r.startupMs.frames}`,
    `cpu_ms p50=${ms(r.cpuMs.p50)} p99=${ms(r.cpuMs.p99)}`,
    r.gpuMs ? `gpu_ms p50=${ms(r.gpuMs.p50)} p99=${ms(r.gpuMs.p99)}` : 'gpu_ms -',
    `fases_ms sim=${ms(r.phasesMs.sim)} ia=${ms(r.phasesMs.ai)} render=${ms(r.phasesMs.render)} ui=${ms(r.phasesMs.ui)}`,
    `sim_ia_ms sim_media=${ms(s.simAvg)} sim_p99=${ms(s.simP99)} sim_max=${ms(s.simMax)} ia_media=${ms(s.aiAvg)}` +
      ` ia_p99=${ms(s.aiP99)} ia_max=${ms(s.aiMax)} ticks=${s.ticks} sim_por_tick=${ms(s.simPerTick)}` +
      ` ia_por_tick=${ms(s.aiPerTick)}`,
    ...r.views.map(
      (v, i) =>
        `vista${i} draw=${num(v.drawCalls)} tri=${num(v.triangles, 0)} regioes=${num(v.regions)}` +
        ` props=${num(v.propGroups)} atores=${num(v.actors)} bonecos=${num(v.actorDraws)}`,
    ),
    `figure_lod l0=${num(r.figureLod.l0)} l1=${num(r.figureLod.l1)} l2=${num(r.figureLod.l2)}`,
    `figuras skins=${r.figures.skins} estouro=${r.figures.overflow} gabaritos=${r.figures.templates}` +
      ` corpos_fora=${r.figures.bodiesOut}`,
    `programas=${r.programs}`,
    `memoria_mb heap_max=${num(r.memoryMb.heapMax)} heap_limite=${num(r.memoryMb.heapLimit)}` +
      ` texturas=${num(r.memoryMb.textures)} malhas=${num(r.memoryMb.meshes)}`,
    `gc_pausas=${r.gcPauses}`,
    `avisos=${r.warnings.length}`,
    ...r.warnings.slice(0, 10).map((w) => `aviso ${quote(w)}`),
    `erros=${r.errors.length}`,
    ...r.errors.slice(0, 5).map((e) => `erro ${quote(e)}`),
    'fim',
  ];
  return lines.join('\n');
}

/** Prefixo das linhas do relatório no `runtime.log` do Switch. */
export const BENCH_LOG_PREFIX = '[bench] ';
