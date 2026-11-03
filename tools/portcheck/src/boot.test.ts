import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSwitch } from '../../../apps/switch/scripts/bundle.ts';
import { APPLET_NOTICE, MENU_READY_MARKER, bootBundle, type BootReport } from './boot.ts';
import { NXJS_GLOBALS } from './fake-nx.ts';
import { runPortcheck } from './portcheck.ts';

/**
 * Bundles SINTÉTICOS que imitam a casca do Switch (o bundle real depende do game, que ainda é stub no M0). Usam só
 * a API do nx.js, como o main.js de verdade.
 */
interface ShellScript {
  /** Código rodado no boot, depois do aviso e do log. */
  readonly boot?: string;
  /** Código de cada frame (`n` = número do frame). Sem isso, o "jogo" não agenda frames. */
  readonly frame?: string;
  readonly drawNotice?: boolean;
  readonly blockPlus?: boolean;
}

function shell(s: ShellScript): string {
  return `
    const log = (line) => { Switch.mkdirSync('sdmc:/switch/boboforces'); Switch.appendFileSync('sdmc:/switch/boboforces/runtime.log', line + '\\n'); };
    const gl = screen.getContext('webgl2');
    log('boot gl=' + (gl === null ? 'nenhum' : 'sim'));
    ${s.drawNotice === false ? '' : `screen.getContext('2d').fillText(${JSON.stringify(APPLET_NOTICE)}, 640, 360);`}
    addEventListener('beforeunload', (e) => { ${s.blockPlus ? 'e.preventDefault();' : ''} });
    globalThis.BOBOFORCES_SWITCH = { game: {}, bootError: null };
    ${s.boot ?? ''}
    ${
      s.frame
        ? `let n = 0; const loop = () => { n++; ${s.frame}; requestAnimationFrame(loop); }; requestAnimationFrame(loop);`
        : ''
    }
  `;
}

const boot = (code: string, maxFrames = 120): Promise<BootReport> =>
  bootBundle({
    code,
    filename: 'romfs:/main.js',
    romfs: new Map([['manifest.json', new TextEncoder().encode('{}')]]),
    maxFrames,
  });

describe('boot em node:vm com nx.js falso', () => {
  it('ok: o jogo agenda frames e grava o marcador do menu', async () => {
    const r = await boot(shell({ frame: `if (n === 3) log(${JSON.stringify(`${MENU_READY_MARKER} frame=3`)})` }));
    expect(r.problems).toEqual([]);
    expect(r.status).toBe('ok');
    expect(r.menuReadyFrame).toBe(3);
    expect(r.menuReadyMs).toBe(50);
    expect(r.appletNotice).toBe(true);
    expect(r.plusExits).toBe(true);
    expect(r.runtimeLog).toContain('boot gl=nenhum');
  });

  it('pendente: o game ainda não agenda frames (stub do M0)', async () => {
    const r = await boot(shell({}));
    expect(r.status).toBe('pendente');
    expect(r.framesRequested).toBe(0);
  });

  it('falha: frames sem o marcador do menu, com a instrução para o game', async () => {
    const r = await boot(shell({ frame: 'void n' }), 30);
    expect(r.status).toBe('falha');
    expect(r.problems.join('\n')).toContain(MENU_READY_MARKER);
  });

  it('falha: erro no boot e erro num frame', async () => {
    expect((await boot(shell({ boot: 'throw new Error("quebrou no boot")' }))).bootError).toContain('quebrou no boot');
    const r = await boot(shell({ frame: 'if (n === 2) null.x' }));
    expect(r.status).toBe('falha');
    expect(r.frameErrors[0]).toContain('TypeError');
    expect(r.runtimeLog).not.toContain('menu');
  });

  it('falha: só existem os globais do nx.js (document e self não existem no console)', async () => {
    const r = await boot(shell({ boot: 'document.createElement("canvas")' }));
    expect(r.status).toBe('falha');
    expect(r.bootError).toMatch(/document is not defined/);
    const s = await boot(shell({ boot: 'self.x = 1' }));
    expect(s.bootError).toMatch(/self is not defined/);
  });

  it('falha: qualquer tentativa de rede (fetch http, WebSocket, Switch.connect)', async () => {
    const code = shell({
      boot: `
        fetch('https://exemplo.com/x').catch(() => {});
        try { new WebSocket('wss://relay'); } catch {}
        try { Switch.connect('1.2.3.4:80'); } catch {}
      `,
      frame: `if (n === 1) log(${JSON.stringify(MENU_READY_MARKER)})`,
    });
    const r = await boot(code);
    expect(r.status).toBe('falha');
    expect(r.network).toEqual([
      'fetch(https://exemplo.com/x)',
      'new WebSocket(wss://relay)',
      'Switch.connect(1.2.3.4:80)',
    ]);
  });

  it('romfs: e o SD funcionam como no console; timers andam no relógio falso', async () => {
    const code = shell({
      boot: `
        globalThis.manifest = new TextDecoder().decode(Switch.readFileSync('romfs:/manifest.json'));
        setTimeout(() => log('timer ' + performance.now()), 250);
      `,
      frame: `if (n === 20) log(${JSON.stringify(MENU_READY_MARKER)} + ' ' + (new Uint8Array(Switch.readFileSync('romfs:/manifest.json')) instanceof Uint8Array))`,
    });
    const r = await boot(code);
    expect(r.status).toBe('ok');
    expect(r.runtimeLog).toContain('timer 250');
    expect(r.runtimeLog).toContain(`${MENU_READY_MARKER} true`);
  });

  it('falha: sem GPU tem que desenhar o aviso e deixar o + fechar o app', async () => {
    const marker = { frame: `if (n === 1) log(${JSON.stringify(MENU_READY_MARKER)})` };
    const noNotice = await boot(shell({ ...marker, drawNotice: false }));
    expect(noNotice.problems.join()).toContain(APPLET_NOTICE);
    const blocked = await boot(shell({ ...marker, blockPlus: true }));
    expect(blocked.plusExits).toBe(false);
    expect(blocked.status).toBe('falha');
  });

  it('console.error reprova; Switch.exit() no boot também', async () => {
    const r = await boot(shell({ boot: 'console.error("ruim")', frame: `log(${JSON.stringify(MENU_READY_MARKER)})` }));
    expect(r.problems).toContain('console.error: ruim');
    const e = await boot(shell({ boot: 'Switch.exit()' }));
    expect(e.status).toBe('falha');
    expect(e.exitCalls).toBe(1);
  });

  it('bundle REAL do Switch: varredura limpa e boot até o primeiro frame do menu', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bf-portcheck-'));
    const romfs = join(dir, 'romfs');
    try {
      await buildSwitch({ outDir: romfs });
      const result = await runPortcheck({ romfsDir: romfs, rootDir: resolve(import.meta.dirname, '..', '..', '..') });
      expect(result.findings).toEqual([]);
      expect(result.boot.problems).toEqual([]);
      expect(result.boot.status).toBe('ok');
      expect(result.boot.menuReadyFrame).not.toBeNull();
      expect(result.boot.runtimeLog).toContain(MENU_READY_MARKER);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});

describe('globais do nx.js', () => {
  it('a lista do fake bate com o @nx.js/runtime instalado (atualizar junto com a versão fixada)', () => {
    const require = createRequire(import.meta.url);
    const dts = readFileSync(require.resolve('@nx.js/runtime/dist/index.d.ts'), 'utf8');
    const declared = new Set<string>();
    for (const m of dts.matchAll(/^declare (?:var|const|function|class|let) ([A-Za-z_$][\w$]*)/gm))
      declared.add(m[1] as string);
    expect([...declared].sort()).toEqual([...NXJS_GLOBALS].sort());
  });
});
