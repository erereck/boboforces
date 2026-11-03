import { createRawInputState } from '@boboforces/input';
import { describe, expect, it } from 'vitest';
import { isLogicalAssetPath } from './assets.ts';
import { safeFileName } from './files.ts';
import { createFrameScheduler } from './frames.ts';
import { createSwitchShell } from './index.ts';
import { createFakeSwitch } from './testing.ts';

const DIR = 'sdmc:/switch/boboforces';
const shellOn = (fake = createFakeSwitch({ gpu: true })) => ({
  fake,
  shell: createSwitchShell({ nx: fake.nx, timestamp: () => 't' }),
});

describe('casca do Switch', () => {
  it('implementa a Platform do Switch: sem online, 720p, pode sair', () => {
    const { shell } = shellOn();
    const p = shell.platform;
    expect(p.id).toBe('switch');
    expect(p.online).toBeNull();
    expect(p.features).toEqual({
      profileHint: 'switch',
      touch: false,
      keyboardMouse: false,
      reducedMotion: false,
      canExit: true,
    });
    expect([p.graphics.width, p.graphics.height, p.graphics.pixelRatio]).toEqual([1280, 720, 1]);
    expect(p.graphics.context).not.toBeNull();
    expect(p.textInput.available).toBe(false);
    expect(p.audio).toBeNull(); // sem AudioContext no fake
  });

  it('com GPU, o + do 1º controle (beforeunload) é cancelado: o + pausa e só se sai pelo menu', () => {
    const { fake, shell } = shellOn();
    expect(fake.dispatch('beforeunload')).toBe(true);
    shell.platform.storage.set('a', '1');
    shell.platform.exit();
    expect(fake.exits.count).toBe(1);
    expect(fake.text(`${DIR}/save.json`)).toBe('{"a":"1"}'); // flush antes de sair
    expect(fake.dispatch('beforeunload')).toBe(false); // saindo: não cancela mais
  });

  it('sem GPU (applet): desenha o aviso em 2D e o + fecha o app', () => {
    const { fake, shell } = shellOn(createFakeSwitch({ gpu: false }));
    expect(shell.hasGpu).toBe(false);
    expect(shell.platform.graphics.context).toBeNull();
    expect(shell.platform.graphics.canvas).toBeNull();
    expect(shell.showNotice(['Abra segurando R ou instale o NSP', 'Aperte + para sair.'])).toBe(true);
    expect(fake.drawn).toEqual(['Abra segurando R ou instale o NSP', 'Aperte + para sair.']);
    expect(fake.dispatch('beforeunload')).toBe(false);
  });

  it('com GPU e falha no boot: o aviso sai pelo WebGL2 (o canvas não dá 2D) e é redesenhado a cada frame', () => {
    const { fake, shell } = shellOn();
    expect(shell.hasGpu).toBe(true);
    expect(fake.nx.screen.getContext('2d')).toBeNull(); // um tipo de contexto por canvas
    const lines = ['Falha ao iniciar o BoboForces', 'Detalhes em sdmc:/switch/boboforces/runtime.log.'];
    expect(shell.showNotice(lines)).toBe(true);
    expect(fake.drawn).toEqual([]);
    const first = fake.glClears.count;
    expect(first).toBeGreaterThan(100); // fundo, faixa e um clear por trecho aceso de cada glyph
    fake.frame(16);
    fake.frame(32);
    expect(fake.glClears.count).toBe(first * 3);
    expect(fake.dispatch('beforeunload')).toBe(false); // com aviso na tela, o + fecha o app
  });

  it('sem nenhum contexto o aviso não sai, e isso fica no log', () => {
    const fake = createFakeSwitch({ gpu: false });
    const { shell } = shellOn(fake);
    (fake.nx.screen as { getContext(id: string): unknown }).getContext = () => null;
    expect(shell.showNotice(['x'])).toBe(false);
    expect(fake.text(`${DIR}/runtime.log`)).toContain('aviso não desenhado: x');
  });

  it('o shim de canvas entrega o contexto WebGL2 e tamanho fixo ao three', () => {
    const { shell } = shellOn();
    const canvas = shell.platform.graphics.canvas as {
      width: number;
      clientHeight: number;
      style: object;
      getContext(id: string): unknown;
    };
    expect(canvas.width).toBe(1280);
    expect(canvas.clientHeight).toBe(720);
    expect(canvas.style).toEqual({});
    expect(canvas.getContext('webgl2')).toBe(shell.platform.graphics.context);
  });

  it('erros e promessas rejeitadas vão para o runtime.log; unload grava o save', () => {
    const { fake, shell } = shellOn();
    fake.dispatch('error', { error: new Error('falhou') });
    fake.dispatch('unhandledrejection', { reason: 'motivo' });
    shell.platform.storage.set('k', 'v');
    fake.dispatch('unload');
    const log = fake.text(`${DIR}/runtime.log`) ?? '';
    expect(log).toContain('ERRO Error: falhou');
    expect(log).toContain('PROMESSA REJEITADA motivo');
    expect(log).toContain('app encerrado');
    expect(fake.text(`${DIR}/save.json`)).toBe('{"k":"v"}');
  });

  it('lê o manifesto do build no RomFS', () => {
    const manifest = {
      name: 'BoboForces',
      version: '0.0.1',
      codename: 'Primeiro Bloco',
      commit: 'abcdef123',
      dirty: true,
    };
    const fake = createFakeSwitch({ gpu: true, files: { 'romfs:/manifest.json': JSON.stringify(manifest) } });
    expect(shellOn(fake).shell.build?.version).toBe('0.0.1');
    expect(shellOn().shell.build).toBeNull();
  });
});

describe('ciclo de vida', () => {
  it('frame atrasado (volta do HOME/sleep) pausa e depois avisa a volta; troca dock↔portátil pausa', () => {
    const { fake, shell } = shellOn();
    const events: string[] = [];
    shell.platform.lifecycle.onPause(() => events.push('pausa'));
    shell.platform.lifecycle.onResume(() => events.push('volta'));
    const loop = (t: number): void => void shell.platform.requestFrame(loop);
    shell.platform.requestFrame(loop);
    let t = 0;
    for (let i = 0; i < 5; i++) fake.frame((t += 16));
    expect(events).toEqual([]);
    fake.frame((t += 5000));
    expect(events).toEqual(['pausa', 'volta']);
    fake.setOperationMode(0);
    for (let i = 0; i < 30; i++) fake.frame((t += 16));
    expect(events).toEqual(['pausa', 'volta', 'pausa']);
    expect(fake.text(`${DIR}/runtime.log`)).toContain('modo de operação 1 → 0');
  });

  it('um frame que demora sozinho (entrar na partida) não conta como volta do HOME', () => {
    const { fake, shell } = shellOn();
    let pauses = 0;
    shell.platform.lifecycle.onPause(() => pauses++);
    let slow = false;
    let t = 0;
    const loop = (): void => {
      // Carregamento síncrono de 1,5 s dentro do frame (createTestScene + malhas + compile no console).
      if (slow) fake.advance((t += 1500));
      slow = false;
      shell.platform.requestFrame(loop);
    };
    shell.platform.requestFrame(loop);
    for (let i = 0; i < 3; i++) fake.frame((t += 16));
    slow = true;
    fake.frame((t += 16));
    for (let i = 0; i < 3; i++) fake.frame((t += 16));
    expect(pauses).toBe(0);
    expect(fake.text(`${DIR}/runtime.log`) ?? '').not.toContain('HOME/sleep');
  });

  it('controle desconectado pausa e grava o save', () => {
    const { fake, shell } = shellOn();
    let pauses = 0;
    shell.platform.lifecycle.onPause(() => pauses++);
    shell.platform.storage.set('a', '1');
    const raw = createRawInputState();
    shell.platform.input.poll(raw);
    fake.pads[0] = null;
    shell.platform.input.poll(raw);
    expect(pauses).toBe(1);
    expect(fake.text(`${DIR}/save.json`)).toBe('{"a":"1"}');
  });
});

describe('frames sem alocação', () => {
  it('roda os callbacks do frame e cancela pelo handle', () => {
    const native: ((t: number) => void)[] = [];
    const ticks: number[] = [];
    const frames = createFrameScheduler({
      requestAnimationFrame: (cb) => native.push(cb),
      beforeFrame: (t) => ticks.push(t),
    });
    const ran: string[] = [];
    frames.request(() => ran.push('a'));
    const b = frames.request(() => ran.push('b'));
    frames.cancel(b);
    expect(native).toHaveLength(1); // um único pedido nativo por frame
    native.shift()?.(16);
    expect(ran).toEqual(['a']);
    expect(ticks).toEqual([16]);
  });
});

describe('caminhos', () => {
  it('assets só por caminho lógico', () => {
    expect(isLogicalAssetPath('maps/construto.bfmap')).toBe(true);
    for (const bad of ['/maps/x', '../x', 'maps/../x', 'romfs:/x', 'a//b', 'https://x', '']) {
      expect(isLogicalAssetPath(bad)).toBe(false);
    }
  });

  it('assets saem de romfs:/assets/ e arquivo ausente rejeita', async () => {
    const fake = createFakeSwitch({ gpu: true, files: { 'romfs:/assets/strings/ok.txt': 'olá' } });
    const { shell } = shellOn(fake);
    await expect(shell.platform.assets.loadText('strings/ok.txt')).resolves.toBe('olá');
    await expect(shell.platform.assets.loadBytes('nada.bin')).rejects.toThrow('não existe');
    await expect(shell.platform.assets.loadBytes('../save.json')).rejects.toThrow('inválido');
  });

  it('exportar grava em exportar/ com nome seguro; importar pega o mais recente de importar/', async () => {
    const { fake, shell } = shellOn();
    const files = shell.platform.files;
    expect(await files?.save('../relatório 1.txt', 'oi', 'text/plain')).toBe(true);
    expect(fake.text(`${DIR}/exportar/relat-rio-1.txt`)).toBe('oi');
    // Um export com o nome do save não encosta no save ativo (nem no log).
    shell.platform.storage.set('a', '1');
    shell.storage.flushSync();
    expect(await files?.save('save.json', '{"x":"lixo"}', 'application/json')).toBe(true);
    expect(await files?.save('runtime.log', 'lixo', 'text/plain')).toBe(true);
    expect(fake.text(`${DIR}/save.json`)).toBe('{"a":"1"}');
    expect(fake.text(`${DIR}/runtime.log`) ?? '').not.toContain('lixo');
    expect(fake.text(`${DIR}/exportar/save.json`)).toBe('{"x":"lixo"}');
    expect(safeFileName('a/b\\..c')).toBe('c');
    fake.nx.Switch.writeFileSync(`${DIR}/importar/velho.json`, '1');
    fake.advance(10);
    fake.nx.Switch.writeFileSync(`${DIR}/importar/novo.json`, '2');
    fake.nx.Switch.writeFileSync(`${DIR}/importar/foto.png`, '3');
    const picked = await files?.pick(['.json']);
    expect(picked?.name).toBe('novo.json');
    expect(new TextDecoder().decode(picked?.bytes)).toBe('2');
    expect(await files?.pick(['.bfbot'])).toBeNull();
  });
});
