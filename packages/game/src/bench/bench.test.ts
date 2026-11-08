import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GAME_ASSETS_M1, TEXTURE_ARRAY_BASES, textureStripPaths } from '../assets-m1.ts';
import { parseBenchParams } from './params.ts';
import { formatBenchReport, type BenchReport } from './report.ts';
import { formatT0Line, T0_ITEMS } from './t0.ts';
import { BENCH_DEFAULTS } from './types.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const RUNTIME = JSON.parse(readFileSync(join(ROOT, 'assets-src', 'runtime-assets.json'), 'utf8')) as {
  files: Record<string, string>;
  local: Record<string, string>;
  preload: string[];
  arrays: Record<string, string[]>;
};

describe('bench: parâmetros', () => {
  it('padrão é o critério do Switch na dock e a URL ajusta com limites e avisos', () => {
    expect(parseBenchParams({}).config).toEqual(BENCH_DEFAULTS);
    const { config, warnings } = parseBenchParams({
      bench: '',
      views: '1',
      bots: '99',
      view: '90',
      tod: 'night',
      atlas: '1',
      float: '1',
      route: 'bench:volta',
      hz: '30',
      foo: '1',
    });
    expect(config.views).toBe(1);
    expect(config.bots).toBe(64);
    expect(config.viewDistanceM).toBe(90);
    expect(config.timeOfDay).toBe('night');
    expect(config.textureMode).toBe('atlas');
    expect(config.vertexAttributes).toBe('float');
    expect(config.route).toBe('bench:volta');
    expect(config.simHz).toBe(30);
    expect(config.prints).toBe(false);
    expect(parseBenchParams({ prints: '1' }).config.prints).toBe(true);
    expect(warnings).toContain('parâmetro desconhecido: foo');
    expect(warnings.some((w) => w.startsWith('bots limitado'))).toBe(true);
    expect(parseBenchParams({ route: 'bench:volta', views: '4' }).config.views).toBe(1);
  });
});

describe('bench: relatório e linhas [t0]', () => {
  it('formato fixo em linhas chave=valor', () => {
    const report: BenchReport = {
      version: '0.0.1',
      codename: 'Primeiro Bloco',
      platform: 'switch',
      profile: 'switch34p',
      system: 'HOS 19.0.1 "nx.js"',
      gpu: 'desconhecida',
      screenWidth: 1280,
      screenHeight: 720,
      pixelRatio: 1,
      threeRevision: '187',
      config: BENCH_DEFAULTS,
      effectiveBots: 12,
      mannequins: 6,
      maxDebris: 120,
      loadingMs: {
        total: 3120,
        assets: 410,
        textures: 120,
        mesh: 1290,
        light: 820,
        nav: 150,
        skins: 90,
        figures: 40,
        shaders: 360,
      },
      frames: 18000,
      seconds: 600,
      frameMs: { avg: 33.37, p50: 33.33, p90: 34.1, p99: 38.9, max: 52 },
      slowFrames: { from40: 12, from60: 3, from100: 1, from250: 0, gaps: 0 },
      startupMs: { first: 48, max: 61, stalls: 0, frames: 120 },
      cpuMs: { p50: 21.4, p99: 29.8 },
      gpuMs: null,
      phasesMs: { sim: 3.1, ai: 2.4, render: 12.8, ui: 1.1 },
      simAiMs: {
        simAvg: 3.05,
        simP99: 6,
        simMax: 9,
        aiAvg: 2.38,
        aiP99: 7,
        aiMax: 15,
        ticks: 36000,
        simPerTick: 1.52,
        aiPerTick: 1.19,
      },
      views: [{ drawCalls: 41, triangles: 98000, regions: 9, propGroups: 6, actors: 15, actorDraws: 1 }],
      figureLod: { l0: 10, l1: 2.5, l2: 3 },
      figures: { skins: 10, overflow: 0, templates: 4, bodiesOut: 0 },
      programs: 7,
      memoryMb: { heapMax: 148.2, heapLimit: -1, textures: 3.4, meshes: 18.7 },
      gcPauses: 2,
      warnings: [],
      errors: ['algo "deu" errado'],
    };
    const lines = formatBenchReport(report).split('\n');
    expect(lines[0]).toBe('BoboForces bench 2');
    expect(lines[1]).toBe('versao=0.0.1 codinome="Primeiro Bloco" plataforma=switch perfil=switch34p');
    expect(lines[3]).toMatch(/ hud=1 vm=1 fx=1 atores=1 bots_efetivos=12 manequins=6 detritos=120$/);
    expect(lines).toContain('frame_ms media=33.37 p50=33.33 p90=34.10 p99=38.90 max=52.00');
    expect(lines).toContain('frames_lentos 40a60=12 60a100=3 100a250=1 acima250=0 vaos_1s=0');
    expect(lines).toContain('inicio_ms primeiro=48.00 max=61.00 travadas_inicio=0 frames=120');
    expect(lines).toContain(
      'sim_ia_ms sim_media=3.05 sim_p99=6.00 sim_max=9.00 ia_media=2.38 ia_p99=7.00 ia_max=15.00 ticks=36000' +
        ' sim_por_tick=1.52 ia_por_tick=1.19',
    );
    expect(lines).toContain('gpu_ms -');
    // Porte do boneco (#56): as chaves que o roteiro da web lê (`FIGURE_REPORT_KEYS`), só acrescentadas.
    expect(lines).toContain('vista0 draw=41 tri=98000 regioes=9 props=6 atores=15 bonecos=1');
    expect(lines).toContain('figure_lod l0=10 l1=2.5 l2=3');
    expect(lines).toContain('figuras skins=10 estouro=0 gabaritos=4 corpos_fora=0');
    expect(lines).toContain(
      'loading_ms total=3120 assets=410 texturas=120 malha=1290 luz=820 nav=150 skins=90 figuras=40 shaders=360',
    );
    expect(lines).toContain(`erro "algo 'deu' errado"`);
    expect(lines.at(-1)).toBe('fim');
  });

  it('linha [t0] com campos na ordem e texto entre aspas', () => {
    expect(T0_ITEMS.length).toBe(21);
    expect(formatT0Line(4, 'ok', { camadas_max: 2048, mips: true })).toBe(
      '[t0] item=4 nome=texture-array status=ok camadas_max=2048 mips=1',
    );
    expect(formatT0Line(19, 'falha', { erro: 'decode rejeitou' })).toBe(
      '[t0] item=19 nome=audio status=falha erro="decode rejeitou"',
    );
    expect(() => formatT0Line(1, 'ok', { 'Chave Ruim': 1 })).toThrow('chave inválida');
  });
});

describe('assets do M1', () => {
  it('todo caminho lógico do M1 está cadastrado e as bases dos arrays batem com a tabela', () => {
    for (const path of Object.values(GAME_ASSETS_M1)) expect(RUNTIME.files[path], path).toBeTypeOf('string');
    // Sem assets locais desde a escolha das fontes (#54) e sem a skin de teste de densidade (#51).
    expect(RUNTIME.local).toEqual({});
    expect(RUNTIME.files['skins/densidade32.png']).toBeUndefined();
    // #56: a folha de rostos e as partes do bobo A saíram do jogo e da tabela (passo 5 do porte).
    for (const name of Object.keys(TEXTURE_ARRAY_BASES) as (keyof typeof TEXTURE_ARRAY_BASES)[]) {
      expect(RUNTIME.arrays[name] ?? [], name).toEqual(TEXTURE_ARRAY_BASES[name]);
    }
    expect(Object.keys(RUNTIME.files).filter((p) => p.startsWith('skins/'))).toEqual([]);
    expect(Object.keys(RUNTIME.arrays).sort()).toEqual(Object.keys(TEXTURE_ARRAY_BASES).sort());
    const paths = Object.values(GAME_ASSETS_M1) as string[];
    expect(paths.some((p) => p.startsWith('skins/partes64'))).toBe(false);
    expect(Object.values(TEXTURE_ARRAY_BASES).flat()).not.toContain('skins/modelos64-rostos');
    for (const bases of Object.values(TEXTURE_ARRAY_BASES)) {
      for (const base of bases) {
        for (const path of Object.values(textureStripPaths(base)))
          expect(RUNTIME.files[path], path).toBeTypeOf('string');
      }
    }
  });
});
