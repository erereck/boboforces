import { builtinBot, encodeShareCode, type BotDocument, type MatchRecipe } from '@boboforces/format';
import type { Platform, Storage } from '@boboforces/platform-api';
import { createRng } from '@boboforces/shared';
import { createRawInputState, type MenuInput } from '@boboforces/input';
import {
  createDrawList,
  resetDrawList,
  SHARE_ACTION,
  TABBED_ROW_PREFIX,
  WORKSHOP_ACTION,
  WORKSHOP_BOT_PREFIX,
} from '@boboforces/ui';
import { describe, expect, it } from 'vitest';
import type { UiFrame } from './menu.ts';
import { customRows, stepCustom } from './custom-match.ts';
import { createSaveStore, libraryCapsFor } from './save-store.ts';
import { createShareFlow, type ShareFlow } from './share.ts';
import { createWorkshopFlow, squadForShare } from './workshop.ts';

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

const platform = {
  id: 'web',
  clipboard: { writeText: async () => true },
  textInput: { available: false, open: () => null },
} as unknown as Platform;

function setup() {
  const save = createSaveStore(memoryStorage(), libraryCapsFor('web'));
  const factoryBots = [builtinBot('normal-bob')!, builtinBot('jorge-the-immortal')!];
  const rng = createRng(3);
  let share: ShareFlow | null = null;
  const getShare = (): ShareFlow =>
    (share ??= createShareFlow({
      platform,
      save,
      limits: { maxBots: 40, maxLocalHumans: 4, maxViewDistanceM: 150 },
      linkFor: null,
      rng,
      factoryBots,
      play: () => undefined,
    }));
  const flow = createWorkshopFlow({ platform, save, rng, factoryBots, share: getShare, usesGamepad: () => false });
  flow.open();
  return { save, flow, getShare, factoryBots };
}

const row = (id: string): string => TABBED_ROW_PREFIX + id;

describe('M8 (fase 2): os esquadrões na Oficina', () => {
  it('cria um esquadrão: o "Novo esquadrão", o bot e quantos, e salva', () => {
    const { save, flow } = setup();
    flow.act(`${WORKSHOP_BOT_PREFIX}squads:+new`);
    expect(flow.mode).toBe('squad');
    // A 1ª entrada (4 Normal Bob) vira Jorge; mais um tipo (1 Normal Bob) e o 2º com 3.
    flow.act(row('bot0'), 1);
    flow.act(row('add'));
    flow.act(row('count1'), 2);
    flow.act('squadSave');
    expect(flow.mode).toBe('list');
    expect(save.squads).toHaveLength(1);
    const q = save.squads[0]!;
    expect(q.name).toBe('Esquadrão 1');
    expect(q.bots).toEqual([
      { ref: 'builtin:jorge-the-immortal', count: 4 },
      { ref: 'builtin:normal-bob', count: 3 },
    ]);
    expect(flow.selected).toBe(q.id);
  });

  it('o "–" no 1 tira o bot; sem bot, não salva; Voltar com mudança pede confirmação', () => {
    const { save, flow } = setup();
    flow.act(`${WORKSHOP_BOT_PREFIX}squads:+new`);
    flow.act(row('count0'), -4);
    flow.act('squadSave');
    expect(flow.mode).toBe('squad');
    expect(save.squads).toHaveLength(0);
    flow.act(WORKSHOP_ACTION.back);
    expect(flow.mode).toBe('squad');
    flow.act(WORKSHOP_ACTION.back);
    expect(flow.mode).toBe('list');
  });

  it('duplicar, apagar com confirmação e Editar um bot leva ao Laboratório', () => {
    const { save, flow } = setup();
    flow.act(`${WORKSHOP_BOT_PREFIX}squads:+new`);
    flow.act('squadSave');
    const id = save.squads[0]!.id;
    flow.act(WORKSHOP_ACTION.duplicate);
    expect(save.squads.map((q) => q.name)).toEqual(['Esquadrão 1', 'Esquadrão 1 2']);
    flow.act(`${WORKSHOP_BOT_PREFIX}squads:${id}`);
    flow.act(WORKSHOP_ACTION.delete);
    expect(save.squads).toHaveLength(2);
    flow.act(WORKSHOP_ACTION.delete);
    expect(save.squads).toHaveLength(1);
    flow.act(`${WORKSHOP_BOT_PREFIX}factory:jorge-the-immortal`);
    expect(flow.act(WORKSHOP_ACTION.edit)).toMatchObject({ kind: 'lab', bot: { id: 'jorge-the-immortal' } });
  });

  it('o código do esquadrão leva os bots da Oficina; quem recebe ganha os bots e o esquadrão (refs novas)', () => {
    const a = setup();
    const mine: BotDocument = { ...builtinBot('jorge-the-immortal')!, id: 'abc123', name: 'Jorge do Bairro' };
    a.save.saveBot(mine);
    const squad = {
      format: 'boboforces/squad@1' as const,
      id: 'qabc',
      name: 'The Jorges',
      bots: [
        { ref: 'embedded:abc123' as const, count: 5 },
        { ref: 'builtin:normal-bob' as const, count: 1 },
      ],
    };
    const shared = squadForShare(squad, a.save.bots);
    expect(shared.embeddedBots?.map((b) => b.id)).toEqual(['abc123']);
    const enc = encodeShareCode('squad', shared);
    if (!enc.ok) throw new Error('código');
    expect(enc.code.startsWith('BFS1-')).toBe(true);
    const b = setup();
    const share = b.getShare();
    share.openCode(enc.code);
    expect(share.mode).toBe('squad');
    share.act(SHARE_ACTION.save);
    expect(b.save.bots).toHaveLength(1);
    expect(b.save.squads).toHaveLength(1);
    const got = b.save.squads[0]!;
    expect(got.name).toBe('The Jorges');
    expect(got.bots[0]!.ref).toBe(`embedded:${b.save.bots[0]!.id}`);
    expect(got.bots[1]!.ref).toBe('builtin:normal-bob');
    expect(got.embeddedBots).toBeUndefined();
  });

  it('na Partida personalizada, o esquadrão entra como escolha do bot do time; o total mexe na última entrada', () => {
    const { save } = setup();
    save.saveSquad({
      format: 'boboforces/squad@1',
      id: 'qjorges',
      name: 'The Jorges',
      bots: [
        { ref: 'builtin:jorge-the-immortal', count: 2 },
        { ref: 'builtin:normal-bob', count: 2 },
      ],
    });
    const limits = { maxBots: 24, maxViewM: 150, savedBots: save.bots, squads: save.squads };
    let r: MatchRecipe = {
      format: 'boboforces/preset@1',
      mode: 'warfare.tdm',
      map: 'construto',
      seed: 0,
      teams: [
        { humans: 'all', bots: [{ ref: 'builtin:chill-bob', count: 3 }] },
        { bots: [{ ref: 'builtin:normal-bob', count: 4 }] },
      ],
    };
    // Anda as escolhas do bot inimigo até o esquadrão (os de fábrica, os da Oficina e, no fim, os esquadrões).
    for (let k = 0; k < 40 && (r.teams[1]?.bots.length ?? 0) < 2; k++) r = stepCustom('bots', r, 'bot1', 1, limits);
    expect(r.teams[1]!.bots).toEqual([
      { ref: 'builtin:jorge-the-immortal', count: 2 },
      { ref: 'builtin:normal-bob', count: 2 },
    ]);
    expect(
      customRows('bots', r)
        .find((x) => x.id === 'bot1')!
        .value(r),
    ).toContain('+1');
    r = stepCustom('bots', r, 'count1', 1, limits);
    expect(r.teams[1]!.bots).toEqual([
      { ref: 'builtin:jorge-the-immortal', count: 2 },
      { ref: 'builtin:normal-bob', count: 3 },
    ]);
    r = stepCustom('bots', r, 'count1', -1, limits);
    r = stepCustom('bots', r, 'count1', -1, limits);
    r = stepCustom('bots', r, 'count1', -1, limits);
    expect(r.teams[1]!.bots).toEqual([{ ref: 'builtin:jorge-the-immortal', count: 2 }]);
  });
});

describe('M8 (fase 2, revisão): os casos de borda dos esquadrões', () => {
  it('no código, o bot da Oficina que sumiu vira o Normal Bob; o id do esquadrão não repete', () => {
    const squad = {
      format: 'boboforces/squad@1' as const,
      id: 'qabc',
      name: 'X',
      bots: [{ ref: 'embedded:sumiu' as const, count: 2 }],
    };
    expect(squadForShare(squad, []).bots).toEqual([{ ref: 'builtin:normal-bob', count: 2 }]);
    expect(squadForShare(squad, []).embeddedBots).toBeUndefined();
  });

  it('a Partida personalizada só oferece esquadrões de 2 ou mais bots, sem cópias, e mostra o nome', () => {
    const { save } = setup();
    const two = [
      { ref: 'builtin:jorge-the-immortal' as const, count: 2 },
      { ref: 'builtin:normal-bob' as const, count: 2 },
    ];
    save.saveSquad({
      format: 'boboforces/squad@1',
      id: 'qone',
      name: 'Só um',
      bots: [{ ref: 'builtin:normal-bob', count: 4 }],
    });
    save.saveSquad({ format: 'boboforces/squad@1', id: 'qtwo', name: 'The Jorges', bots: two });
    save.saveSquad({ format: 'boboforces/squad@1', id: 'qcopy', name: 'The Jorges 2', bots: two });
    const limits = { maxBots: 24, maxViewM: 150, savedBots: save.bots, squads: save.squads };
    let r: MatchRecipe = {
      format: 'boboforces/preset@1',
      mode: 'warfare.tdm',
      map: 'construto',
      seed: 0,
      teams: [
        { humans: 'all', bots: [{ ref: 'builtin:chill-bob', count: 3 }] },
        { bots: [{ ref: 'builtin:normal-bob', count: 4 }] },
      ],
    };
    const seen = new Set<string>();
    for (let k = 0; k < 40; k++) {
      r = stepCustom('bots', r, 'bot1', 1, limits);
      seen.add(
        customRows('bots', r)
          .find((x) => x.id === 'bot1')!
          .value(r, limits),
      );
    }
    expect(seen.has('Esquadrão The Jorges')).toBe(true);
    expect([...seen].filter((v) => v.startsWith('Esquadrão'))).toEqual(['Esquadrão The Jorges']);
  });
});

describe('M12 (fase 3): a Oficina segue o foco', () => {
  it('o foco num bot da lista o escolhe (sem confirmar); o "Novo esquadrão" só abre no confirmar', () => {
    const { flow, factoryBots } = setup();
    const list = createDrawList(8192);
    const ui: UiFrame = { width: 1280, height: 720, scale: 1, userScale: 1, options: {}, revision: 1 };
    const raw = createRawInputState();
    const press = (action: string): MenuInput => ({ pressed: (x: string) => x === action }) as unknown as MenuInput;
    const idle = press('');
    resetDrawList(list, 1280, 720);
    flow.frame(idle, raw, ui, list);
    expect(flow.selected).toBe(factoryBots[0]!.id);
    // Para baixo até o próximo bot de fábrica: ele vira o escolhido no mesmo quadro.
    for (let i = 0; i < 8 && flow.selected === factoryBots[0]!.id; i++) {
      resetDrawList(list, 1280, 720);
      flow.frame(press('down'), raw, ui, list);
    }
    expect(flow.selected).toBe(factoryBots[1]!.id);
    expect(flow.mode).toBe('list');
  });
});
