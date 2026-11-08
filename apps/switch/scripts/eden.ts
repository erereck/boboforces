/**
 * Caminhos do Eden (emulador, só na máquina do Erick; decisão #48: o Teste Zero roda primeiro no Eden): a config
 * normal fica em `%APPDATA%/eden/config/qt-config.ini` (nunca editada por nós), o SD virtual em `sdmc_directory`
 * dessa config (padrão `%APPDATA%/eden/sdmc`) e o executável onde o Erick descompactou (EDEN_EXE, `local/eden/
 * eden-path.txt` ou os lugares de costume). Nada aqui lê chaves.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { LOCAL_DIR } from './paths.ts';

/** Pasta do jogo no SD (a mesma `SD_DIR` da casca, sem o `sdmc:`). */
export const SD_GAME_DIR = ['switch', 'boboforces'] as const;
/** Nome do NRO no SD (README: `sdmc:/switch/boboforces/BoboForces.nro`). */
export const SD_NRO_NAME = 'BoboForces.nro';
/** Bench automático lido pela casca no boot (one-shot; ver `apps/switch/src/t0/auto-bench.ts`). */
export const SD_BENCH_FILE = 'bench.json';

export function edenAppData(env: NodeJS.ProcessEnv = process.env): string {
  const appData = env['APPDATA'];
  if (!appData) throw new Error('APPDATA não definido (os scripts do Eden são para o Windows do Erick).');
  return join(appData, 'eden');
}

/** `sdmc_directory=` da config do Eden (com `\default=false`), senão o padrão. */
export function sdmcFromConfig(configText: string | null, appDataEden: string): string {
  if (configText) {
    const custom = /^sdmc_directory\\default=false$/m.test(configText);
    const m = /^sdmc_directory=(.+)$/m.exec(configText);
    if (custom && m?.[1]?.trim()) return m[1].trim().replace(/\//g, '\\');
  }
  return join(appDataEden, 'sdmc');
}

export interface EdenPaths {
  readonly appData: string;
  readonly config: string;
  readonly sdmc: string;
  /** `<sdmc>/switch/boboforces` */
  readonly gameDir: string;
  readonly nro: string;
  readonly runtimeLog: string;
  readonly benchFile: string;
}

export function edenPaths(env: NodeJS.ProcessEnv = process.env): EdenPaths {
  const appData = edenAppData(env);
  const config = join(appData, 'config', 'qt-config.ini');
  const sdmc = sdmcFromConfig(existsSync(config) ? readFileSync(config, 'utf8') : null, appData);
  const gameDir = join(sdmc, ...SD_GAME_DIR);
  return {
    appData,
    config,
    sdmc,
    gameDir,
    nro: join(gameDir, SD_NRO_NAME),
    runtimeLog: join(gameDir, 'runtime.log'),
    benchFile: join(gameDir, SD_BENCH_FILE),
  };
}

/** Onde procurar o `eden.exe`, em ordem. */
export function edenCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const out: string[] = [];
  if (env['EDEN_EXE']) out.push(env['EDEN_EXE']);
  const saved = join(LOCAL_DIR, 'eden', 'eden-path.txt');
  if (existsSync(saved)) out.push(readFileSync(saved, 'utf8').trim());
  const home = env['USERPROFILE'] ?? homedir();
  for (const base of [join(home, '3D Objects', 'Emuladores'), join(home, 'Downloads'), join(home, 'Desktop')]) {
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base)) {
      if (!/^eden/i.test(entry)) continue;
      const exe = join(base, entry, 'eden.exe');
      if (existsSync(exe)) out.push(exe);
    }
  }
  return out;
}

/** O primeiro `eden.exe` que existe (o mais novo, se houver vários na mesma pasta de busca). */
export function findEden(env: NodeJS.ProcessEnv = process.env): string | null {
  const found = edenCandidates(env).filter((p) => p && existsSync(p));
  if (!found.length) return null;
  const [first, ...rest] = found;
  // EDEN_EXE e o caminho salvo vencem; entre os achados por busca, o mais recente.
  if (env['EDEN_EXE'] || existsSync(join(LOCAL_DIR, 'eden', 'eden-path.txt'))) return first!;
  return [first!, ...rest].sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]!;
}
