// `npm run online:web` (M5 fase 4e): o Online de ponta a ponta pelo jogo de verdade, no Edge headless. O build servido
// pelo `vite preview` e duas abas no mesmo Edge:
//   1. o host abre o título, vai em Online, lê o aviso e cria a sala (pelo teclado, como um jogador);
//   2. o amigo abre o link da sala (`#sala=XXXXX`) e cai direto no Entrar; entra;
//   3. o host começa; os dois jogam pela rede (WebRTC de verdade entre as abas) por alguns segundos;
//   4. o host sai pela pausa: os dois voltam à sala; o host sai da sala e o amigo vê "o host saiu".
// Sem relay nenhum por padrão (`?sinal=local`: as abas se acham por um BroadcastChannel). `--relays`: a mesma rodada
// pelos relays Nostr de verdade da `net.json` (só a sinalização efêmera, como o jogo faz). Relatório em
// `local/m5/online-web.json`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Page } from 'playwright-core';
import { launchEdge, REPO_ROOT, startPreview, waitForTitle, type PageWindow } from './edge.ts';

const PLAY_S = 10;
const STEP_TIMEOUT_MS = 30_000;
const relays = process.argv.includes('--relays');

interface OnlineState {
  readonly code: string;
  readonly role: string;
  readonly status: string;
  readonly end: string | null;
  readonly mySlot: number;
  readonly members: number;
}

interface Snapshot {
  readonly screen: string;
  readonly simTick: number;
  readonly online: OnlineState | null;
}

type OnlineWindow = PageWindow & {
  readonly __bfDebug?: PageWindow['__bfDebug'] & { readonly online?: OnlineState | null };
};

const snap = (page: Page): Promise<Snapshot> =>
  page.evaluate(() => {
    const d = (window as unknown as OnlineWindow).__bfDebug;
    return { screen: d?.screen ?? '?', simTick: d?.simTick ?? -1, online: d?.online ?? null };
  });

async function until(page: Page, what: string, test: (s: Snapshot) => boolean): Promise<Snapshot> {
  const start = Date.now();
  for (;;) {
    const s = await snap(page);
    if (test(s)) return s;
    if (Date.now() - start > STEP_TIMEOUT_MS) {
      const log = await page.evaluate(() => (window as unknown as PageWindow).__bfDebug?.log?.(12) ?? []);
      throw new Error(`esperando ${what}: ${JSON.stringify(s)}\n    ${log.join('\n    ')}`);
    }
    await page.waitForTimeout(100);
  }
}

/** Um toque de tecla com o jogo vendo a borda (o menu lê o estado a cada quadro). */
async function tap(page: Page, key: string): Promise<void> {
  // A aba de trás roda devagar (o navegador segura os quadros dela): quem recebe a tecla vem para a frente, e a tecla
  // fica apertada até o jogo ver alguns quadros.
  await page.bringToFront();
  const frames = (): Promise<number> => page.evaluate(() => (window as unknown as PageWindow).__bfDebug?.frames ?? 0);
  const wait = async (count: number): Promise<void> => {
    const target = (await frames()) + count;
    for (let i = 0; i < 100 && (await frames()) < target; i++) await page.waitForTimeout(16);
  };
  await page.keyboard.down(key);
  await wait(3);
  await page.keyboard.up(key);
  await wait(3);
}

async function main(): Promise<number> {
  const server = await startPreview();
  const { browser } = await launchEdge();
  const failures: string[] = [];
  const steps: Record<string, unknown> = {};
  const query = relays ? '' : '?sinal=local';
  try {
    // Um contexto só: o BroadcastChannel da sinalização local não atravessa contextos (e o aviso já lido vale nos dois).
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const [host, friend] = [await context.newPage(), await context.newPage()];
    for (const [name, page] of [
      ['host', host],
      ['amigo', friend],
    ] as const) {
      page.on('pageerror', (e) => failures.push(`${name}: erro na página: ${e.message}`));
    }

    // 1. O host: título → Online (Modos | Online na 1ª fileira da grade) → aviso → Criar sala.
    await host.goto(`${server.url}${query}`);
    await waitForTitle(host);
    for (const key of ['ArrowDown', 'ArrowRight', 'Enter']) await tap(host, key);
    await until(host, 'a tela do Online', (s) => s.screen === 'online');
    await tap(host, 'Enter');
    await tap(host, 'Enter');
    const created = await until(host, 'a sala criada', (s) => s.online?.status === 'lobby');
    const code = created.online!.code;
    steps['sala'] = code;

    // 2. O amigo: o link da sala abre direto no Entrar.
    const joinStart = Date.now();
    await friend.goto(`${server.url}${query}#sala=${code}`);
    await until(friend, 'o Entrar com o código do link', (s) => s.screen === 'online');
    await tap(friend, 'Enter');
    await until(friend, 'entrar na sala', (s) => s.online?.status === 'lobby');
    await until(host, 'o amigo na sala', (s) => (s.online?.members ?? 0) === 2);
    steps['entrouMs'] = Date.now() - joinStart;

    // 3. O host começa; os dois na partida pela rede.
    await tap(host, 'Enter');
    await until(host, 'a partida do host', (s) => s.screen === 'scene' && s.simTick > 0);
    await until(friend, 'a partida do amigo', (s) => s.screen === 'scene' && s.simTick > 0);
    await host.waitForTimeout(PLAY_S * 1000);
    const [h, f] = [await snap(host), await snap(friend)];
    steps['ticks'] = { host: h.simTick, amigo: f.simTick };
    // O amigo mostra o host 100 ms atrás (6 ticks) mais o caminho da rede entre as abas.
    if (Math.abs(h.simTick - f.simTick) > 30) failures.push(`o amigo está longe do host: ${h.simTick} × ${f.simTick}`);
    if (h.simTick < PLAY_S * 50) failures.push(`a partida do host andou pouco: ${h.simTick} ticks em ${PLAY_S} s`);

    // 4. O host sai pela pausa (Continuar, Ajustar desafio, Ajustes, Destravar, Sair): os dois voltam à sala.
    await tap(host, 'Escape');
    for (let i = 0; i < 4; i++) await tap(host, 'ArrowDown');
    await tap(host, 'Enter');
    await until(host, 'o host de volta à sala', (s) => s.screen === 'online' && s.online?.status === 'lobby');
    await until(friend, 'o amigo de volta à sala', (s) => s.screen === 'online' && s.online?.status === 'lobby');
    // O host sai da sala (Voltar põe o foco no Sair da sala): ela acaba para o amigo.
    await tap(host, 'Escape');
    await tap(host, 'Enter');
    await until(friend, 'o aviso de que o host saiu', (s) => s.online === null || s.online.end === 'host-left');
    steps['fim'] = 'ok';
    const logs = await Promise.all(
      [host, friend].map((p) => p.evaluate(() => (window as unknown as PageWindow).__bfDebug?.log?.(30) ?? [])),
    );
    steps['logs'] = { host: logs[0], amigo: logs[1] };
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
    // O que estava na tela de cada aba quando parou.
    for (const [i, page] of browser
      .contexts()
      .flatMap((c) => c.pages())
      .entries()) {
      await page
        .screenshot({ path: join(REPO_ROOT, 'local', 'm5', `online-web-falha-${i}.png`) })
        .catch(() => undefined);
    }
  } finally {
    await browser.close();
    await server.close();
  }
  const out = join(REPO_ROOT, 'local', 'm5', relays ? 'online-web-relays.json' : 'online-web.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ relays, steps, failures }, null, 2));
  console.log(
    `online:web${relays ? ' (relays de verdade)' : ''}: ${JSON.stringify(steps, (k, v) => (k === 'logs' ? undefined : v))}`,
  );
  for (const f of failures) console.error(`  falha: ${f}`);
  console.log(failures.length === 0 ? 'online:web ok' : `online:web falhou (${failures.length})`);
  return failures.length === 0 ? 0 : 1;
}

process.exitCode = await main();
