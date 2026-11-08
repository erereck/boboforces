import { createFakeAudioContext } from '@boboforces/audio/testing';
import { BENCH_DEFAULTS, type TestItemContext, type TestRunner } from '@boboforces/game';
import { createRawInputState, PAD_BUTTON } from '@boboforces/input';
import { createTestScreenModel } from '@boboforces/ui';
import { describe, expect, it } from 'vitest';
import { createSwitchShell } from '../../platform/index.ts';
import { NPAD_STYLE } from '../../platform/nx.ts';
import { createFakeKeyboard, createFakeSwitch, pad, type FakeSwitch } from '../../platform/testing.ts';
import { createSwitchTestItems, SWITCH_BENCH_PRESETS } from '../items.ts';
import { startAudioTest, T0_AUDIO_FILES } from './audio.ts';
import { startControllersTest } from './controllers.ts';
import { startKeyboardTest } from './keyboard.ts';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function setup(fake: FakeSwitch) {
  const shell = createSwitchShell({ nx: fake.nx, timestamp: () => 't' });
  const lines: string[] = [];
  const ctx: TestItemContext = { platform: shell.platform, log: (l) => lines.push(l) };
  const raw = createRawInputState();
  const model = createTestScreenModel();
  /** Um frame: estado dos controles falsos → raw → runner. */
  const frame = (runner: TestRunner): void => {
    shell.platform.input.poll(raw);
    runner.update(raw, 1 / 60);
    runner.describe(model);
  };
  return { shell, lines, ctx, raw, model, frame };
}

describe('itens de teste do título no Switch', () => {
  it('presets do bench seguem os critérios do Teste Zero e os 3 testes da casca têm start', () => {
    const items = createSwitchTestItems();
    expect(items.map((i) => i.id)).toEqual([
      'bench-dock',
      'bench-solo',
      'bench-zombies',
      'bench-bots48',
      'bench-planb',
      'bench-gpu',
      'controllers',
      'keyboard',
      'audio',
    ]);
    expect(SWITCH_BENCH_PRESETS.dock).toEqual(BENCH_DEFAULTS); // padrão do contrato = critério da dock
    expect(SWITCH_BENCH_PRESETS.solo).toMatchObject({ views: 1, bots: 24, viewDistanceM: 90 });
    expect(SWITCH_BENCH_PRESETS.zombies.zombies).toBe(24);
    expect(SWITCH_BENCH_PRESETS.bots48.bots).toBe(48);
    expect(SWITCH_BENCH_PRESETS.planB).toMatchObject({ textureMode: 'atlas', vertexAttributes: 'float' });
    expect(SWITCH_BENCH_PRESETS.gpu.gpuFinish).toBe(true);
    for (const item of items) {
      expect(typeof item.labelKey).toBe('string');
      expect(!!item.bench !== !!item.start).toBe(true);
    }
  });
});

describe('teste de controles (item 17)', () => {
  it('lista os controles, dá slot no A, vibra no X, recusa Joy-Con avulso e registra o +', () => {
    const fake = createFakeSwitch({ gpu: true });
    fake.pads[0] = { ...pad(0, NPAD_STYLE.handheld), deviceType: 0x4 };
    fake.pads[1] = { ...pad(1, NPAD_STYLE.joyLeft), deviceType: 0x8 };
    fake.pads[2] = pad(2, NPAD_STYLE.fullKey);
    const env = setup(fake);
    const runner = startControllersTest(env.ctx);
    env.frame(runner);
    expect(env.lines).toContain('[t0] item=17 nome=controllers status=info evento=mudanca controles=3 indices=0_1_2');
    expect(env.lines).toContain(
      '[t0] item=17 nome=controllers status=falha evento=conectado indice=1 modelo=pad-1 tipo=joyConSingle ' +
        'styleSet=0x8 deviceType=0x8 completo=0 vibra=0',
    );
    expect(env.model.lineCount).toBe(4);
    expect(env.model.lines[1]!.literal).toBe('#1 handheld styleSet=0x2 deviceType=0x4');
    expect(env.model.lines[2]!.status).toBe('fail');
    // A no controle 3 (índice 2) → jogador 1; A no avulso → recusado.
    fake.pads[2] = pad(2, NPAD_STYLE.fullKey, [PAD_BUTTON.faceRight]);
    fake.pads[1] = pad(1, NPAD_STYLE.joyLeft, [PAD_BUTTON.faceRight]);
    env.frame(runner);
    expect(env.lines).toContain(
      '[t0] item=17 nome=controllers status=ok evento=entrou jogador=1 indice=2 tipo=switchPro',
    );
    expect(env.lines).toContain(
      '[t0] item=17 nome=controllers status=falha evento=recusado indice=1 tipo=joyConSingle',
    );
    expect(env.model.lines[3]!.literal).toBe('#3 switchPro styleSet=0x1 deviceType=-1 P1');
    expect(env.model.lines[0]!.literal).toBe('1 / 4');
    // Segurar A não entra de novo; X (o botão de CIMA, `faceUp`) vibra; + fica registrado.
    fake.pads[2] = pad(2, NPAD_STYLE.fullKey, [PAD_BUTTON.faceRight, PAD_BUTTON.faceUp, PAD_BUTTON.start]);
    env.frame(runner);
    expect(env.lines.filter((l) => l.includes('evento=entrou'))).toHaveLength(1);
    expect(env.lines).toContain('[t0] item=17 nome=controllers status=falha evento=vibra indice=2 vibra=0');
    expect(env.lines).toContain('[t0] item=17 nome=controllers status=ok evento=mais_bloqueado indice=2');
    // Desconectar: perde o slot e loga a mudança.
    fake.pads[2] = null;
    env.frame(runner);
    expect(env.lines).toContain('[t0] item=17 nome=controllers status=info evento=mudanca controles=2 indices=0_1');
    expect(env.model.lines[0]!.literal).toBe('0 / 4');
    runner.dispose();
    expect(env.lines.at(-1)).toBe('[t0] item=17 nome=controllers status=info evento=fim jogadores=0');
  });

  it('o primeiro frame não conta o A que abriu a tela', () => {
    const fake = createFakeSwitch({ gpu: true });
    fake.pads[0] = pad(0, NPAD_STYLE.fullKey, [PAD_BUTTON.faceRight]);
    const env = setup(fake);
    const runner = startControllersTest(env.ctx);
    env.frame(runner);
    expect(env.lines.some((l) => l.includes('evento=entrou'))).toBe(false);
  });
});

describe('teste de teclado (item 18)', () => {
  it('abre o teclado do sistema, mostra o texto e loga só o tamanho; o OK do nx.js (esconde antes do submit) conta', async () => {
    const kb = createFakeKeyboard();
    const fake = createFakeSwitch({ gpu: true, virtualKeyboard: kb });
    const env = setup(fake);
    expect(env.shell.platform.textInput.available).toBe(true);
    const runner = startKeyboardTest(env.ctx);
    expect(kb.shown).toBe(1);
    kb.typeText('Bo');
    kb.typeText('bo');
    env.frame(runner);
    expect(env.model.lines[1]!.literal).toBe('Bobo');
    kb.submit();
    await tick();
    expect(env.lines.some((l) => /status=ok evento=confirmou tamanho=4 mudancas=2/.test(l))).toBe(true);
    expect(env.lines.some((l) => l.includes('Bobo'))).toBe(false); // o conteúdo nunca vai para o log
    expect(env.lines.some((l) => l.includes('cancelou'))).toBe(false);
    // A reabre; cancelar (B do teclado) vira onCancel.
    fake.pads[0] = pad(0, NPAD_STYLE.fullKey, [PAD_BUTTON.faceRight]);
    env.frame(runner);
    expect(kb.shown).toBe(2);
    kb.cancel();
    await tick();
    expect(env.lines.at(-1)).toBe('[t0] item=18 nome=keyboard status=info evento=cancelou mudancas=0');
    runner.dispose();
  });

  it('sem teclado do sistema: falha e o jogo usa o teclado próprio', () => {
    const env = setup(createFakeSwitch({ gpu: true }));
    expect(env.shell.platform.textInput.available).toBe(false);
    const runner = startKeyboardTest(env.ctx);
    expect(env.lines).toEqual(['[t0] item=18 nome=keyboard status=falha disponivel=0']);
    env.frame(runner);
    expect(env.model.lines[0]!.status).toBe('fail');
  });
});

describe('teste de áudio (item 19)', () => {
  const mp3 = (tenths: number): Uint8Array => new Uint8Array([tenths, 0xff, 0xfb, 0x90]);
  const romfs = Object.fromEntries(
    Object.entries(T0_AUDIO_FILES).map(([, path], i) => [`romfs:/assets/${path}`, mp3(i + 2)]),
  );

  it('decodifica os 4 MP3, sintetiza, toca, pan, rajada com 24 vozes e resume na volta do HOME', async () => {
    const audio = createFakeAudioContext();
    const fake = createFakeSwitch({ gpu: true, audioContext: audio, bytes: romfs });
    const env = setup(fake);
    const runner = startAudioTest(env.ctx);
    expect(env.lines[0]).toMatch(/^\[t0\] item=19 nome=audio status=info evento=contexto estado=running taxa=48000 /);
    for (let i = 0; i < 10; i++) await tick();
    const decodes = env.lines.filter((l) => l.includes('evento=decode'));
    expect(decodes).toHaveLength(4);
    expect(decodes.every((l) => l.includes('status=ok'))).toBe(true);
    expect(env.lines.filter((l) => l.includes('evento=sintetico') && l.includes('status=ok'))).toHaveLength(2);
    expect(env.lines).toContain('[t0] item=19 nome=audio status=ok evento=carregado mp3=4 sinteticos=2');
    env.frame(runner);
    fake.pads[0] = pad(0, NPAD_STYLE.fullKey, [PAD_BUTTON.faceRight, PAD_BUTTON.dpadLeft]);
    env.frame(runner);
    expect(env.lines.some((l) => l.includes('evento=tiro play_us_medio='))).toBe(true);
    expect(env.lines).toContain('[t0] item=19 nome=audio status=info evento=pan lado=esquerda');
    fake.pads[0] = pad(0, NPAD_STYLE.fullKey, [PAD_BUTTON.bumperRight]);
    env.frame(runner);
    const burst = env.lines.find((l) => l.includes('evento=rajada'))!;
    expect(burst).toMatch(/status=ok evento=rajada pedidos=30 vozes_pico=24 tocados=\d+ roubados=\d+ descartados=\d+/);
    // Volta do HOME: o ciclo de vida da casca (vão > 1 s entre frames) dispara o resume do mixer e o da casca.
    audio.state = 'suspended';
    env.shell.platform.requestFrame(() => {});
    fake.frame(100);
    env.shell.platform.requestFrame(() => {});
    fake.frame(5000);
    for (let i = 0; i < 5; i++) await tick();
    // A casca retoma primeiro (ciclo de vida) e o teste confere o estado depois.
    expect(fake.text('sdmc:/switch/boboforces/runtime.log')).toContain(
      '[t0] item=19 nome=audio status=ok evento=resume_casca antes=suspended depois=running',
    );
    expect(env.lines.some((l) => /item=19 .*status=ok evento=resume antes=[a-z]+ depois=running/.test(l))).toBe(true);
    runner.dispose();
  });

  it('sem AudioContext: falha clara e a tela mostra "sem áudio"', () => {
    const env = setup(createFakeSwitch({ gpu: true }));
    const runner = startAudioTest(env.ctx);
    expect(env.lines).toEqual(['[t0] item=19 nome=audio status=falha erro="sem AudioContext"']);
    env.frame(runner);
    expect(env.model.lines[0]!.status).toBe('fail');
    runner.dispose();
  });

  it('MP3 que não decodifica vira falha com o nome do arquivo', async () => {
    const audio = createFakeAudioContext();
    audio.failDecode = true;
    const env = setup(createFakeSwitch({ gpu: true, audioContext: audio, bytes: romfs }));
    const runner = startAudioTest(env.ctx);
    for (let i = 0; i < 10; i++) await tick();
    expect(env.lines).toContain(
      '[t0] item=19 nome=audio status=falha evento=decode arquivo=t0-tiro erro="decodeAudioData rejeitou"',
    );
    expect(env.lines.some((l) => l.includes('status=falha evento=carregado mp3=0'))).toBe(true);
    runner.dispose();
  });
});
