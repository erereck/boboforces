import { PLATFORM_PROFILE_IDS, TIMES_OF_DAY, type PlatformProfileId, type TimeOfDay } from '@boboforces/format';
import { BENCH_DEFAULTS, BENCH_PARAMS, type BenchConfig, type BenchScene } from './types.ts';

/** Faixas aceitas (fora delas o valor é limitado e vira aviso). Visão: 20 m até o teto do PC (140 m). */
export const BENCH_RANGES = {
  bots: { min: 0, max: 64 },
  zombies: { min: 0, max: 64 },
  viewDistanceM: { min: 20, max: 140 },
  durationS: { min: 5, max: 3600 },
  warmupS: { min: 0, max: 120 },
} as const;

export interface ParsedBench {
  readonly config: BenchConfig;
  /** Avisos legíveis (pt-BR) para o relatório: parâmetro desconhecido, valor limitado, valor inválido. */
  readonly warnings: readonly string[];
}

/**
 * Lê os parâmetros do bench (a web passa a query da URL como dicionário; o Switch monta o mesmo dicionário). Chave
 * ausente = padrão de `BENCH_DEFAULTS`. Nunca lança.
 */
export function parseBenchParams(params: Readonly<Record<string, string>>): ParsedBench {
  const warnings: string[] = [];
  const known = new Set<string>(Object.values(BENCH_PARAMS));
  for (const key of Object.keys(params)) {
    if (key !== 'bench' && !known.has(key)) warnings.push(`parâmetro desconhecido: ${key}`);
  }
  const get = (k: keyof BenchConfig): string | undefined => params[BENCH_PARAMS[k]];
  const int = (k: keyof typeof BENCH_RANGES, fallback: number): number => {
    const raw = get(k);
    if (raw === undefined) return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      warnings.push(`${BENCH_PARAMS[k]} inválido: ${raw}`);
      return fallback;
    }
    const { min, max } = BENCH_RANGES[k];
    const v = Math.round(n);
    if (v < min || v > max) warnings.push(`${BENCH_PARAMS[k]} limitado a ${min}..${max}`);
    return Math.min(max, Math.max(min, v));
  };
  const flag = (k: keyof BenchConfig, fallback: boolean): boolean => {
    const raw = get(k);
    if (raw === undefined) return fallback;
    if (raw === '1' || raw === '' || raw === 'true') return true;
    if (raw === '0' || raw === 'false') return false;
    warnings.push(`${BENCH_PARAMS[k]} inválido: ${raw}`);
    return fallback;
  };
  const oneOf = <T extends string>(k: keyof BenchConfig, list: readonly T[], fallback: T): T => {
    const raw = get(k);
    if (raw === undefined) return fallback;
    if ((list as readonly string[]).includes(raw)) return raw as T;
    warnings.push(`${BENCH_PARAMS[k]} inválido: ${raw}`);
    return fallback;
  };

  const viewsRaw = get('views');
  let views = BENCH_DEFAULTS.views;
  if (viewsRaw !== undefined) {
    const n = Math.round(Number(viewsRaw));
    if (n >= 1 && n <= 4) views = n as BenchConfig['views'];
    else warnings.push(`views inválido: ${viewsRaw}`);
  }
  const routeRaw = get('route');
  const route = routeRaw === undefined || routeRaw === '' || routeRaw === '-' ? BENCH_DEFAULTS.route : routeRaw;
  if (route !== null && views !== 1) {
    warnings.push('rota de câmera usa 1 vista só');
    views = 1;
  }
  const seedRaw = get('seed');
  let seed = BENCH_DEFAULTS.seed;
  if (seedRaw !== undefined) {
    const n = Number(seedRaw);
    if (Number.isInteger(n) && n >= 0 && n <= 0xffffffff) seed = n;
    else warnings.push(`seed inválido: ${seedRaw}`);
  }
  const hz = oneOf('simHz', ['60', '30'], String(BENCH_DEFAULTS.simHz) as '60' | '30');

  const config: BenchConfig = {
    scene: oneOf<BenchScene>('scene', ['construto', 'vitrine'], BENCH_DEFAULTS.scene),
    views,
    bots: int('bots', BENCH_DEFAULTS.bots),
    zombies: int('zombies', BENCH_DEFAULTS.zombies),
    armed: flag('armed', BENCH_DEFAULTS.armed),
    viewDistanceM: int('viewDistanceM', BENCH_DEFAULTS.viewDistanceM),
    timeOfDay: oneOf<TimeOfDay>('timeOfDay', TIMES_OF_DAY, BENCH_DEFAULTS.timeOfDay),
    durationS: int('durationS', BENCH_DEFAULTS.durationS),
    warmupS: int('warmupS', BENCH_DEFAULTS.warmupS),
    route,
    textureMode: flag('textureMode', false) ? 'atlas' : 'array',
    vertexAttributes: flag('vertexAttributes', false) ? 'float' : 'int',
    seed,
    profile: oneOf<PlatformProfileId | 'auto'>('profile', ['auto', ...PLATFORM_PROFILE_IDS], BENCH_DEFAULTS.profile),
    gpuFinish: flag('gpuFinish', BENCH_DEFAULTS.gpuFinish),
    simHz: hz === '30' ? 30 : 60,
    hud: flag('hud', BENCH_DEFAULTS.hud),
    viewmodel: flag('viewmodel', BENCH_DEFAULTS.viewmodel),
    fx: flag('fx', BENCH_DEFAULTS.fx),
    actors: flag('actors', BENCH_DEFAULTS.actors),
    prints: flag('prints', BENCH_DEFAULTS.prints),
  };
  return { config, warnings };
}
