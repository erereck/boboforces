// `npm run online:web` (M5 fase 4e): o Online de ponta a ponta pelo jogo de verdade, no Edge headless. O build servido
// pelo `vite preview` e duas abas no mesmo Edge:
//   1. o host abre o título, vai em Online, lê o aviso e cria a sala (pelo teclado, como um jogador);
//   2. o amigo abre o link da sala (`#sala=XXXXX`) e cai direto no Entrar; entra;
//   3. o host escolhe o X1 nos cards da sala (M5 fase 6c) e começa; os dois jogam no Ringue pela rede (WebRTC de verdade
//      entre as abas) por alguns segundos;
//   4. o host sai pela pausa: os dois voltam à sala; o host escolhe o Bobo Zombies e começa de novo, na Base Abandonada;
//   5. o host sai pela pausa outra vez, sai da sala e o amigo vê "o host saiu".
// Sem relay nenhum por padrão (`?sinal=local`: as abas se acham por um BroadcastChannel). `--relays`: a mesma rodada
// pelos relays Nostr de verdade da `net.json` (só a sinalização efêmera, como o jogo faz). `--prints`: as capturas de cada
// tela em `local/m5/prints/` (1280×720, mais uma passada do host num celular de 667×375 com toque), com o Escolher
// partida, a pausa e o resultado do amigo no caminho. Relatório em `local/m5/online-web.json`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { launchEdge, REPO_ROOT, startPreview, waitForTitle, type PageWindow } from './edge.ts';

/** Segundos do X1 (`--partida 40`: o bastante para a linha `[rede]` de 30 s sair no registro). */
const playArg = process.argv.indexOf('--partida');
const PLAY_S = playArg > 0 ? Math.max(5, Number(process.argv[playArg + 1]) || 10) : 10;
/** A 2ª partida (o Bobo Zombies): só o bastante para os dois estarem jogando. */
const ZOMBIES_S = 4;
const STEP_TIMEOUT_MS = 30_000;
const relays = process.argv.includes('--relays');
const printsDir = process.argv.includes('--prints') ? join(REPO_ROOT, 'local', 'm5', 'prints') : null;
/** O perfil do Online já gravado (`online@1`), para cada aba ter o seu nome nas capturas. */
const profile = (name: string, privacy: number): string =>
  JSON.stringify({ format: 'boboforces/online@1', name, privacy });

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

/** Espera o jogo desenhar `count` quadros (a aba na frente). */
async function frames(page: Page, count: number): Promise<void> {
  const now = (): Promise<number> => page.evaluate(() => (window as unknown as PageWindow).__bfDebug?.frames ?? 0);
  const target = (await now()) + count;
  for (let i = 0; i < 200 && (await now()) < target; i++) await page.waitForTimeout(16);
}

/**
 * Abre a pausa. A aba que foi para trás já volta pausada (o navegador avisa que ela sumiu e o jogo pausa; no online a
 * partida não para): aí o Esc fecharia a pausa em vez de abrir.
 */
async function openPause(page: Page): Promise<void> {
  await page.bringToFront();
  await frames(page, 3);
  if (!(await page.evaluate(() => (window as unknown as PageWindow).__bfDebug?.paused ?? false)))
    await tap(page, 'Escape');
}

/** Os logs do jogo de uma aba (os últimos `n`). */
const logOf = (page: Page, n: number): Promise<readonly string[]> =>
  page.evaluate((count) => (window as unknown as PageWindow).__bfDebug?.log?.(count) ?? [], n);

/**
 * M5 (fase 6c): da sala (o foco no Começar), o host abre o Escolher partida e anda nos cards até o que quer (`keys`,
 * a partir do foco que a tela dá) e confirma; volta à sala com o foco no Começar.
 */
async function pickRoomMatch(page: Page, keys: readonly string[], card: string, print: string | null): Promise<void> {
  await tap(page, 'ArrowDown');
  await tap(page, 'Enter');
  if (print !== null) await shot(page, print);
  for (const key of keys) await tap(page, key);
  await tap(page, 'Enter');
  const start = Date.now();
  while (!(await logOf(page, 6)).some((l) => l.includes(`[online] partida da sala: ${card} `))) {
    if (Date.now() - start > STEP_TIMEOUT_MS)
      throw new Error(`esperando o card ${card}: ${(await logOf(page, 6)).join(' | ')}`);
    await page.waitForTimeout(100);
  }
}

/** Uma captura (só com `--prints`). */
async function shot(page: Page, name: string): Promise<void> {
  if (printsDir === null) return;
  await page.bringToFront();
  // A aba aberta direto no Online (pelo link) ainda pode estar com o splash saindo.
  await page.waitForFunction(() => document.getElementById('bf-splash') === null, undefined, { timeout: 10_000 });
  await frames(page, 4);
  await page.screenshot({ path: join(printsDir, `${name}.png`) });
}

/** O celular (só com `--prints`): o título sem a Cena-vitrine, o aviso e a sala do host, pela sinalização local. */
async function phonePass(browser: Browser, url: string): Promise<void> {
  const context = await browser.newContext({
    viewport: { width: 667, height: 375 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; SM-A366B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  });
  const phone = await context.newPage();
  await phone.goto(`${url}?sinal=local`);
  await waitForTitle(phone);
  await phone.evaluate((p) => localStorage.setItem('boboforces:online', p), profile('Erick', 0));
  await shot(phone, 'celular-titulo');
  for (const key of ['ArrowDown', 'ArrowRight', 'Enter']) await tap(phone, key);
  await until(phone, 'o Online no celular', (s) => s.screen === 'online');
  await shot(phone, 'celular-aviso');
  await tap(phone, 'Enter');
  await shot(phone, 'celular-casa');
  await tap(phone, 'Enter');
  await until(phone, 'a sala no celular', (s) => s.online?.status === 'lobby');
  await shot(phone, 'celular-sala');
  await context.close();
}

async function main(): Promise<number> {
  const server = await startPreview();
  const { browser } = await launchEdge();
  const failures: string[] = [];
  const steps: Record<string, unknown> = {};
  if (printsDir !== null) mkdirSync(printsDir, { recursive: true });
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
    // Os nomes da sala: o do host aqui (o aviso ainda por ler); o do amigo antes de abrir o link.
    await host.evaluate((p) => localStorage.setItem('boboforces:online', p), profile('Erick', 0));
    await shot(host, 'titulo');
    for (const key of ['ArrowDown', 'ArrowRight', 'Enter']) await tap(host, key);
    await until(host, 'a tela do Online', (s) => s.screen === 'online');
    await shot(host, 'aviso');
    await tap(host, 'Enter');
    await shot(host, 'casa');
    await tap(host, 'Enter');
    const created = await until(host, 'a sala criada', (s) => s.online?.status === 'lobby');
    const code = created.online!.code;
    steps['sala'] = code;
    await shot(host, 'sala-host-sozinho');
    if (printsDir !== null) {
      // Escolher partida: os cards da sala; a Personalizada (embaixo, à direita) com "Usar na sala"; Voltar não muda
      // nada e volta aos cards; Voltar de novo, à sala.
      await tap(host, 'ArrowDown');
      await tap(host, 'Enter');
      for (const key of ['ArrowDown', 'ArrowDown', 'ArrowRight', 'Enter']) await tap(host, key);
      await until(host, 'a Partida personalizada', (s) => s.screen === 'custom');
      await shot(host, 'escolher-partida');
      await tap(host, 'Escape');
      await until(host, 'os cards de novo', (s) => s.screen === 'online');
      await tap(host, 'Escape');
      await tap(host, 'ArrowUp');
    }
    // M5 (fase 6c): o X1 (o 3º card, embaixo do Times), antes de o amigo chegar.
    await pickRoomMatch(host, ['ArrowDown'], 'x1', 'partida-da-sala');

    // 2. O amigo: o link da sala abre direto no Entrar.
    await host.evaluate((p) => localStorage.setItem('boboforces:online', p), profile('Bia', 1));
    const joinStart = Date.now();
    await friend.goto(`${server.url}${query}#sala=${code}`);
    await until(friend, 'o Entrar com o código do link', (s) => s.screen === 'online');
    await shot(friend, 'entrar-pelo-link');
    await tap(friend, 'Enter');
    await shot(friend, 'procurando');
    await until(friend, 'entrar na sala', (s) => s.online?.status === 'lobby');
    await until(host, 'o amigo na sala', (s) => (s.online?.members ?? 0) === 2);
    steps['entrouMs'] = Date.now() - joinStart;
    // A Bia escolhe o azul (tanto faz → laranja → azul).
    await tap(friend, 'ArrowRight');
    await tap(friend, 'ArrowRight');
    await shot(friend, 'sala-amigo');
    await shot(host, 'sala-host');

    // 3. O host começa o X1; os dois na partida pela rede, no Ringue.
    await tap(host, 'Enter');
    await until(host, 'a partida do host', (s) => s.screen === 'scene' && s.simTick > 0);
    await until(friend, 'a partida do amigo', (s) => s.screen === 'scene' && s.simTick > 0);
    await host.waitForTimeout(PLAY_S * 1000);
    const [h, f] = [await snap(host), await snap(friend)];
    await shot(host, 'partida-host');
    await shot(friend, 'partida-amigo');
    if (printsDir !== null) {
      // M5 (fase 7a): o F2 com a linha da rede, no host e no amigo (aperta, captura, fecha).
      for (const [page, name] of [
        [host, 'f2-host'],
        [friend, 'f2-amigo'],
      ] as const) {
        await tap(page, 'F2');
        await frames(page, 70);
        await shot(page, name);
        await tap(page, 'F2');
      }
    }
    steps['ticks'] = { host: h.simTick, amigo: f.simTick };
    // O amigo mostra o host 100 ms atrás (6 ticks) mais o caminho da rede entre as abas.
    if (Math.abs(h.simTick - f.simTick) > 30) failures.push(`o amigo está longe do host: ${h.simTick} × ${f.simTick}`);
    if (h.simTick < PLAY_S * 50) failures.push(`a partida do host andou pouco: ${h.simTick} ticks em ${PLAY_S} s`);
    if (!(await logOf(host, 30)).some((l) => l.includes('[online] partida warfare.tdm com 2 jogador(es)')))
      failures.push('o host não começou o X1 (TDM com 2 jogadores)');

    if (printsDir !== null) {
      // A pausa do amigo (sem o Ajustar desafio; a partida não para) e o resultado online dele, que volta à sala antes
      // do host (e espera lá).
      await openPause(friend);
      await shot(friend, 'pausa-amigo');
      await tap(friend, 'Escape');
      await friend.evaluate(() => (window as unknown as PageWindow).__bfDebug?.print?.showResult());
      await shot(friend, 'resultado-amigo');
      await tap(friend, 'Enter');
      await until(friend, 'o amigo esperando na sala', (s) => s.screen === 'online');
      await shot(friend, 'sala-amigo-esperando');
    }
    // 4. O host sai pela pausa (Continuar, Ajustar desafio, Ajustes, Destravar, Sair): os dois voltam à sala.
    await openPause(host);
    await shot(host, 'pausa-host');
    for (let i = 0; i < 4; i++) await tap(host, 'ArrowDown');
    await tap(host, 'Enter');
    await until(host, 'o host de volta à sala', (s) => s.screen === 'online' && s.online?.status === 'lobby');
    await until(friend, 'o amigo de volta à sala', (s) => s.screen === 'online' && s.online?.status === 'lobby');
    await shot(host, 'sala-de-volta');

    // 5. M5 (fase 6c): o Bobo Zombies (do lado do X1, onde o foco volta), na Base Abandonada, com o pool do host.
    await pickRoomMatch(host, ['ArrowRight'], 'zombies', null);
    await shot(friend, 'sala-amigo-zombies');
    await tap(host, 'Enter');
    const zStart = Date.now();
    await until(host, 'o Bobo Zombies do host', (s) => s.screen === 'scene' && s.simTick > 0);
    await until(friend, 'o Bobo Zombies do amigo', (s) => s.screen === 'scene' && s.simTick > 0);
    steps['zombiesMs'] = Date.now() - zStart;
    await host.waitForTimeout(ZOMBIES_S * 1000);
    const [hz, fz] = [await snap(host), await snap(friend)];
    await shot(friend, 'zombies-amigo');
    steps['ticksZombies'] = { host: hz.simTick, amigo: fz.simTick };
    if (Math.abs(hz.simTick - fz.simTick) > 30)
      failures.push(`no Zombies, o amigo está longe do host: ${hz.simTick} × ${fz.simTick}`);
    if (!(await logOf(host, 30)).some((l) => l.includes('[online] partida zombies com 2 jogador(es)')))
      failures.push('o host não começou o Bobo Zombies');
    await openPause(host);
    for (let i = 0; i < 4; i++) await tap(host, 'ArrowDown');
    await tap(host, 'Enter');
    await until(host, 'o host de volta à sala (Zombies)', (s) => s.screen === 'online' && s.online?.status === 'lobby');
    await until(
      friend,
      'o amigo de volta à sala (Zombies)',
      (s) => s.screen === 'online' && s.online?.status === 'lobby',
    );

    // O host sai da sala (Voltar põe o foco no Sair da sala): ela acaba para o amigo.
    await tap(host, 'Escape');
    await tap(host, 'Enter');
    await until(friend, 'o aviso de que o host saiu', (s) => s.online === null || s.online.end === 'host-left');
    await shot(friend, 'host-saiu');
    steps['fim'] = 'ok';
    if (printsDir !== null) await phonePass(browser, server.url);
    const logs = await Promise.all(
      [host, friend].map((p) => p.evaluate(() => (window as unknown as PageWindow).__bfDebug?.log?.(30) ?? [])),
    );
    steps['logs'] = { host: logs[0], amigo: logs[1] };
    // M5 (fase 7a): as linhas `[rede]` de cada aba (saem a cada 30 s de partida; com `--partida 40`, uma no X1).
    const rede = await Promise.all(
      [host, friend].map(async (p) => (await logOf(p, 400)).filter((l) => l.includes('[rede]'))),
    );
    steps['rede'] = { host: rede[0], amigo: rede[1] };
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
