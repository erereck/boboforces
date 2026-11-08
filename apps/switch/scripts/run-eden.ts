// `npm run eden:run -w @boboforces/switch [-- --seconds 60] [--bench dock]`: prepara o Eden (NRO no SD virtual), abre
// o NRO pelo `eden.exe -g`, espera as linhas do Teste Zero no runtime.log do SD virtual, fecha o Eden e guarda a parte
// nova do log em `local/eden/runtime-<data>.log` (pasta privada). Mostra no terminal as linhas `[t0]`, `[bench]` e
// `[boot]`. Uso local, decisão #48; o console de verdade continua sendo o teste que vale.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { edenPaths, findEden } from './eden.ts';
import { LOCAL_DIR, ROOT_DIR } from './paths.ts';
import { prepareEden } from './prepare-eden.ts';

/** Linhas que interessam no resumo. */
export function interestingLines(log: string): string[] {
  return log
    .split('\n')
    .map((l) => l.replace(/^\S+ /, '')) // tira o carimbo
    .filter((l) => /^\[(t0|bench|boot|console\.\w+)\]|ERRO|FALHA|PROMESSA/.test(l));
}

/** O que a rodada esperou ver: menu pronto, as sondas tardias (21 e a de áudio, 19) e, com bench, a linha `fim`. */
export function runFinished(log: string, withBench: boolean): boolean {
  if (/FALHA NO BOOT|\[t0\] item=1 nome=webgl2 status=falha/.test(log)) return true;
  const probes =
    log.includes('[boot] menu-ready') &&
    log.includes('[t0] item=21 ') &&
    /\[t0\] item=19 \S+ \S+ evento=sonda_boot/.test(log);
  return withBench ? probes && /\[bench\] fim\b/.test(log) : probes;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const secondsArg = argv.indexOf('--seconds');
  const withBench = argv.includes('--bench') || argv.includes('--bench-params');
  const seconds = secondsArg >= 0 ? Number(argv[secondsArg + 1]) : withBench ? 900 : 60;
  const eden = findEden();
  if (!eden) {
    console.error('eden.exe não encontrado: defina EDEN_EXE ou grave o caminho em local/eden/eden-path.txt.');
    process.exit(1);
  }
  const prepared = prepareEden(argv);
  if (!prepared.nro) process.exit(1);
  const paths = edenPaths();
  const offset = existsSync(paths.runtimeLog) ? statSync(paths.runtimeLog).size : 0;
  const readNew = (): string => {
    if (!existsSync(paths.runtimeLog)) return '';
    const all = readFileSync(paths.runtimeLog);
    // O log roda em 1 MB: se encolheu, a sessão nova começou no arquivo novo.
    return all.subarray(all.length >= offset ? offset : 0).toString('utf8');
  };

  console.log(`Abrindo ${relative(ROOT_DIR, prepared.nro)} no ${eden} (até ${seconds} s)…`);
  const child = spawn(eden, ['-g', prepared.nro], { stdio: 'ignore', windowsHide: false });
  const started = Date.now();
  let log = '';
  let exited = false;
  child.on('exit', () => (exited = true));
  while (Date.now() - started < seconds * 1000 && !exited) {
    await sleep(1000);
    log = readNew();
    if (runFinished(log, withBench)) {
      await sleep(2000); // deixa as últimas linhas chegarem
      log = readNew();
      break;
    }
  }
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  if (!exited && child.pid) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });

  const outDir = join(LOCAL_DIR, 'eden');
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = join(outDir, `runtime-${stamp}.log`);
  writeFileSync(outPath, log);
  console.log(`Eden ${exited ? 'fechou sozinho' : 'fechado pelo script'} depois de ${elapsed} s.`);
  console.log(`Log desta rodada: ${relative(ROOT_DIR, outPath)} (${log.length} bytes)`);
  const lines = interestingLines(log);
  if (!lines.length)
    console.log('Nenhuma linha [t0]/[boot] nova: o NRO abriu? Veja o log do Eden em %APPDATA%\\eden\\log.');
  for (const l of lines) console.log(`  ${l}`);
}

if (import.meta.main) await main();
