import {
  builtinBot,
  encodeShareCode,
  MATCH_RECIPE_FORMAT,
  type BotDocument,
  type MatchRecipe,
} from '@boboforces/format';
import type { Platform, Storage, TextInputListener } from '@boboforces/platform-api';
import { createRng } from '@boboforces/shared';
import { SHARE_ACTION } from '@boboforces/ui';
import { describe, expect, it } from 'vitest';
import { createSaveStore, libraryCapsFor } from './save-store.ts';
import { createShareFlow, shareAvailable } from './share.ts';

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get: (k) => data.get(k) ?? null,
    set: (k, v) => void data.set(k, v),
    remove: (k) => void data.delete(k),
    keys: () => [...data.keys()],
    getBackup: () => null,
    flush: async () => {},
  };
}

interface Fake {
  readonly platform: Platform;
  readonly copied: string[];
  listener: TextInputListener | null;
}

function fakePlatform(id: 'web' | 'switch' = 'web'): Fake {
  const fake: Fake = {
    copied: [],
    listener: null,
    platform: {
      id,
      clipboard: {
        writeText: async (text: string) => {
          fake.copied.push(text);
          return true;
        },
      },
      textInput: {
        available: true,
        open: (_req: unknown, listener: TextInputListener) => {
          fake.listener = listener;
          return { close: () => undefined };
        },
      },
    } as unknown as Platform,
  };
  return fake;
}

function setup(id: 'web' | 'switch' = 'web') {
  const fake = fakePlatform(id);
  const save = createSaveStore(memoryStorage(), libraryCapsFor('web'));
  const played: MatchRecipe[] = [];
  const flow = createShareFlow({
    platform: fake.platform,
    save,
    limits: { maxBots: 40, maxLocalHumans: 4, maxViewDistanceM: 150 },
    linkFor: (hash) => 'https://exemplo.test/jogo/' + hash,
    rng: createRng(7),
    factoryBots: [builtinBot('normal-bob')!],
    play: (p) => played.push(p),
  });
  return { fake, save, played, flow };
}

const jorge: BotDocument = { ...builtinBot('jorge-the-immortal')!, id: 'meu-jorge', name: 'Jorge do Bairro' };
const festa: MatchRecipe = {
  format: MATCH_RECIPE_FORMAT,
  name: 'Festa',
  mode: 'warfare.tdm',
  map: 'construto',
  seed: 0,
  teams: [
    { humans: 'all', bots: [{ ref: 'builtin:chill-bob', count: 2 }] },
    { bots: [{ ref: 'builtin:normal-bob', count: 3 }] },
  ],
};
const codeOf = (kind: 'bot' | 'preset', doc: unknown): string => {
  const r = encodeShareCode(kind, doc);
  if (!r.ok) throw new Error('código');
  return r.code;
};
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('M8 (fase 1): compartilhar', () => {
  it('copia o código e o link do bot (o link sem o prefixo)', async () => {
    const { fake, flow } = setup();
    flow.openExport('bot', jorge, 'Jorge do Bairro');
    expect(flow.mode).toBe('export');
    flow.act(SHARE_ACTION.copyCode);
    flow.act(SHARE_ACTION.copyLink);
    await tick();
    expect(fake.copied[0]!.startsWith('BF1-')).toBe(true);
    expect(fake.copied[1]).toBe('https://exemplo.test/jogo/#bot=' + fake.copied[0]!.slice(4));
  });

  it('o bot recebido vira um bot seu (id novo; nome barrado ganha um do gerador)', () => {
    const { save, flow } = setup();
    flow.openCode(codeOf('bot', jorge));
    expect(flow.mode).toBe('bot');
    flow.act(SHARE_ACTION.save);
    expect(save.bots).toHaveLength(1);
    expect(save.bots[0]!.name).toBe('Jorge do Bairro');
    expect(save.bots[0]!.id).not.toBe('meu-jorge');
    flow.openCode(codeOf('bot', { ...jorge, name: 'Porra Bob' }));
    flow.act(SHARE_ACTION.save);
    expect(save.bots).toHaveLength(2);
    expect(save.bots[1]!.name).not.toBe('');
    expect(save.bots[1]!.name.toLowerCase()).not.toContain('porra');
  });

  it('a partida recebida joga ou salva; o código quebrado mostra o erro', () => {
    const { save, played, flow } = setup();
    flow.openCode(codeOf('preset', festa));
    expect(flow.mode).toBe('preset');
    flow.act(SHARE_ACTION.save);
    expect(save.presets.saved.map((p) => p.name)).toContain('Festa');
    flow.act(SHARE_ACTION.play);
    expect(played).toHaveLength(1);
    expect(played[0]!.mode).toBe('warfare.tdm');
    flow.openCode('isso não é código');
    expect(flow.mode).toBe('error');
  });

  it('colar: o código colado inteiro abre sem esperar o Enter', () => {
    const { fake, flow } = setup();
    flow.openPaste();
    expect(flow.mode).toBe('paste');
    fake.listener!.onChange('BF1', 3);
    expect(flow.mode).toBe('paste');
    fake.listener!.onChange(codeOf('bot', jorge), 0);
    expect(flow.mode).toBe('bot');
  });

  it('no Switch não há copiar nem colar (os arquivos do SD)', () => {
    expect(shareAvailable(fakePlatform('switch').platform)).toEqual({ copy: false, paste: false });
    expect(shareAvailable(fakePlatform('web').platform)).toEqual({ copy: true, paste: true });
  });
});

describe('M8 (fase 1, revisão): o resto do fluxo', () => {
  it('o link colado no lugar do código abre igual; a partida salva só uma vez', () => {
    const { save, flow } = setup();
    flow.openCode('https://exemplo.test/jogo/#p=' + codeOf('preset', festa).slice(5));
    expect(flow.mode).toBe('preset');
    flow.act(SHARE_ACTION.save);
    flow.act(SHARE_ACTION.save);
    expect(save.presets.saved.filter((p) => (p.name ?? '').startsWith('Festa'))).toHaveLength(1);
  });
});
