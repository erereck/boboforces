// `npm run rtc:web` (M5 fase 3): o teste de verdade do WebRTC no Edge, sem relay nenhum. Monta `rtc-harness.ts` com o
// esbuild, serve em 127.0.0.1 e abre duas abas no mesmo Edge (host e cliente). Elas se acham pela sinalização local
// (BroadcastChannel), conectam por WebRTC (candidatos do próprio aparelho) e jogam uma TDM de 20 s com 6 bots. Passa
// se: os dois canais abriram (o não confiável sem cair no reserva), a partida acabou nas duas abas com o mesmo
// vencedor, placar, abates e mortes, e a predição e os eventos chegaram. Relatório em `local/m5/rtc-web.json`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { launchEdge, REPO_ROOT, serveHtml } from './edge.ts';
import type { RtcResult } from './rtc-harness.ts';

const here = dirname(fileURLToPath(import.meta.url));
const TIMEOUT_MS = 90_000;

async function main(): Promise<number> {
  const bundle = await build({
    entryPoints: [join(here, 'rtc-harness.ts')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    write: false,
    logLevel: 'error',
  });
  const js = bundle.outputFiles[0]!.text.replaceAll('</script', '<\\/script');
  const server = await serveHtml(
    `<!doctype html><meta charset="utf-8"><title>rtc</title><script type="module">${js}</script>`,
  );
  const { browser } = await launchEdge();
  const failures: string[] = [];
  let results: RtcResult[] = [];
  try {
    const context = await browser.newContext();
    const pages = await Promise.all(['host', 'cliente'].map(() => context.newPage()));
    for (const page of pages) page.on('pageerror', (e) => failures.push(`erro na página: ${e.message}`));
    await pages[0]!.goto(`${server.url}?papel=host`);
    await pages[1]!.goto(`${server.url}?papel=cliente`);
    const start = Date.now();
    for (;;) {
      results = await Promise.all(pages.map((p) => p.evaluate(() => window.__rtc ?? null))).then((r) =>
        r.filter((x): x is RtcResult => x !== null),
      );
      if (results.length === 2 || Date.now() - start > TIMEOUT_MS) break;
      await new Promise((done) => setTimeout(done, 500));
    }
    const logs = await Promise.all(pages.map((p) => p.evaluate(() => window.__rtcLog ?? [])));
    if (results.length < 2) failures.push(`não terminou em ${TIMEOUT_MS / 1000} s: ${JSON.stringify(logs)}`);
    const [host, client] = [results.find((r) => r.papel === 'host'), results.find((r) => r.papel === 'cliente')];
    if (host && client) {
      for (const r of [host, client]) {
        if (r.error) failures.push(`${r.papel}: ${r.error}`);
        if (r.phase !== 'ended') failures.push(`${r.papel}: a partida não acabou (${r.phase})`);
        if (r.unreliable.join() !== 'open') failures.push(`${r.papel}: canal não confiável ${r.unreliable.join()}`);
        if (r.sent.fallback > 0) failures.push(`${r.papel}: ${r.sent.fallback} mensagens foram pelo reserva`);
      }
      if (host.winnerTeam !== client.winnerTeam) failures.push('vencedor diferente');
      if (host.teamScore.join() !== client.teamScore.join()) failures.push('placar diferente');
      if (host.kills.join() !== client.kills.join() || host.deaths.join() !== client.deaths.join()) {
        failures.push('abates ou mortes diferentes');
      }
      const c = client.client;
      if (!c || c.snapshots < 400) failures.push(`cliente: poucos snapshots (${c?.snapshots})`);
      if (!c || c.events < 50) failures.push(`cliente: poucos eventos (${c?.events})`);
      if (c && c.mispredicts > c.reconciles * 0.02) failures.push(`cliente: predição errou ${c.mispredicts} vezes`);
    }
    mkdirSync(join(REPO_ROOT, 'local', 'm5'), { recursive: true });
    writeFileSync(
      join(REPO_ROOT, 'local', 'm5', 'rtc-web.json'),
      JSON.stringify({ results, logs, failures }, null, 2) + '\n',
    );
    for (const r of results) {
      console.log(
        `${r.papel}: conectou em ${r.connectMs} ms · ${r.phase} · placar ${r.teamScore.join('-')} · canal ` +
          `${r.unreliable.join()} · enviadas ${r.sent.reliable} confiáveis, ${r.sent.unreliable} não confiáveis` +
          (r.client
            ? ` · ${r.client.snapshots} snapshots, ${r.client.events} eventos, predição ${r.client.errorMeanCm.toFixed(
                2,
              )} cm (${r.client.mispredicts} acima de 10 cm em ${r.client.reconciles}), atraso ${r.client.renderLag.toFixed(1)} ticks`
            : ''),
      );
    }
  } finally {
    await browser.close();
    await server.close();
  }
  for (const f of failures) console.error(`FALHA ${f}`);
  console.log(failures.length === 0 ? 'rtc:web ok' : `rtc:web: ${failures.length} falha(s)`);
  return failures.length === 0 ? 0 : 1;
}

process.exitCode = await main();
