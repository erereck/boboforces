// `npm run eden -w @boboforces/switch` (decisão #48: Teste Zero primeiro no Eden). Prepara o Eden SEM tocar na config
// normal do Erick (herdado do MMM):
//   1. `local/eden/eden-test.ini`: cópia da config com teclado ligado, sem busca de atualização e os botões do
//      primeiro controle no teclado (para mirar e andar, um controle de verdade é melhor);
//   2. copia o NRO mais novo de `apps/switch/build/` para o SD virtual: `<sdmc>/switch/boboforces/BoboForces.nro`;
//   3. opcional: `--bench <preset>` ou `--bench-params "views=1&bots=24&view=90"` grava `bench.json` no SD (a casca
//      começa direto no bench na próxima abertura, uma vez só).
// Rode `npm run nro -w @boboforces/switch` antes. Nunca lê nem copia chaves.
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { edenPaths, findEden, SD_BENCH_FILE } from './eden.ts';
import { LOCAL_DIR, OUT_DIR, packageBaseName, readVersion } from './paths.ts';

/** Códigos de tecla do Qt. Botões por posição física do Switch; o + pausa (não sai). */
export const KEYBOARD_MAPPING: Readonly<Record<string, number>> = {
  a: 67, // C
  b: 88, // X
  x: 86, // V
  y: 90, // Z
  l: 81, // Q
  r: 69, // E
  zl: 49, // 1
  zr: 50, // 2
  plus: 77, // M
  minus: 78, // N
  dleft: 16777234,
  dup: 16777235,
  dright: 16777236,
  ddown: 16777237,
};

/** Config de teste a partir da normal (texto do qt-config.ini). */
export function testConfig(source: string): string {
  let config = source;
  const set = (key: string, value: string): void => {
    config = config.replace(new RegExp(`^${key.replace(/\\/g, '\\\\')}=.*$`, 'm'), `${key}=${value}`);
  };
  set('keyboard_enabled\\default', 'false');
  set('keyboard_enabled', 'true');
  set('check_for_updates\\default', 'false');
  set('check_for_updates', 'false');
  for (const [name, code] of Object.entries(KEYBOARD_MAPPING)) {
    set(`player_0_button_${name}`, `"engine:keyboard,code:${code},toggle:0"`);
  }
  return config;
}

/** `{"preset": ...}` ou `{"params": {...}}` a partir dos argumentos (null = sem bench automático). */
export function benchFileFromArgs(argv: readonly string[]): string | null {
  const value = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const preset = value('--bench');
  if (preset) return `${JSON.stringify({ preset })}\n`;
  const params = value('--bench-params');
  if (params) return `${JSON.stringify({ params: Object.fromEntries(new URLSearchParams(params)) })}\n`;
  return null;
}

export interface PrepareResult {
  readonly testConfig: string | null;
  readonly nro: string | null;
  readonly benchFile: string | null;
}

export function prepareEden(argv: readonly string[] = process.argv.slice(2)): PrepareResult {
  const paths = edenPaths();
  let configOut: string | null = null;
  if (existsSync(paths.config)) {
    const dir = join(LOCAL_DIR, 'eden');
    mkdirSync(dir, { recursive: true });
    configOut = join(dir, 'eden-test.ini');
    writeFileSync(configOut, testConfig(readFileSync(paths.config, 'utf8')));
  } else {
    console.warn(`Config do Eden não encontrada em ${paths.config} (abra o Eden uma vez antes).`);
  }

  let nroOut: string | null = null;
  const { version } = readVersion();
  const nro = join(OUT_DIR, `${packageBaseName(version)}.nro`);
  if (existsSync(nro)) {
    mkdirSync(paths.gameDir, { recursive: true });
    copyFileSync(nro, paths.nro);
    nroOut = paths.nro;
  } else {
    console.warn(`NRO não encontrado (${nro}): rode \`npm run nro -w @boboforces/switch\` antes.`);
  }

  let benchOut: string | null = null;
  const bench = benchFileFromArgs(argv);
  if (bench) {
    mkdirSync(paths.gameDir, { recursive: true });
    writeFileSync(paths.benchFile, bench);
    benchOut = paths.benchFile;
  }
  return { testConfig: configOut, nro: nroOut, benchFile: benchOut };
}

if (import.meta.main) {
  const result = prepareEden();
  const paths = edenPaths();
  const mb = (p: string): string => `${(statSync(p).size / 1048576).toFixed(1)} MB`;
  console.log('Eden preparado:');
  if (result.testConfig) console.log(`  config de teste: ${result.testConfig}`);
  if (result.nro) console.log(`  NRO no SD virtual: ${result.nro} (${mb(result.nro)})`);
  if (result.benchFile) console.log(`  bench automático (uma abertura): ${result.benchFile} (${SD_BENCH_FILE})`);
  console.log(`  runtime.log: ${paths.runtimeLog}`);
  const eden = findEden();
  console.log(
    eden
      ? `  Eden: ${eden}`
      : '  Eden: não achei o eden.exe (defina EDEN_EXE ou grave o caminho em local/eden/eden-path.txt)',
  );
  console.log('Para abrir e ler o log sozinho: npm run eden:run -w @boboforces/switch');
}
