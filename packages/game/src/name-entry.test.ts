import { DEBUT_PRESET, type MatchRecipe } from '@boboforces/format';
import { createRawInputState, type MenuInput } from '@boboforces/input';
import type { Platform, TextInputListener, TextInputRequest } from '@boboforces/platform-api';
import { createDrawList } from '@boboforces/ui';
import { describe, expect, it } from 'vitest';
import { stepCustom } from './custom-match.ts';
import type { UiFrame } from './menu.ts';
import { customNameEntry } from './name-entry.ts';

/** M9 (fase 3): o nome do time do Sandbox pela Partida personalizada (o teclado do sistema e o do jogo). */

const LIMITS = { maxBots: 40, maxViewM: 140 };

function fakePlatform(available: boolean) {
  const opened: { request: TextInputRequest; listener: TextInputListener }[] = [];
  let closed = 0;
  const platform = {
    id: 'web',
    textInput: {
      available,
      open: (request: TextInputRequest, listener: TextInputListener) => {
        opened.push({ request, listener });
        return {
          close: () => {
            closed++;
          },
        };
      },
    },
  } as unknown as Platform;
  return { platform, opened, closed: () => closed };
}

describe('o nome do time do Sandbox', () => {
  let r: MatchRecipe = stepCustom('match', DEBUT_PRESET, 'mode', -1, LIMITS);
  r = stepCustom('teams', r, 'teams', 1, LIMITS);
  const raw = createRawInputState();
  const list = createDrawList();
  const ui = {} as UiFrame;
  const menu = {} as MenuInput;

  it('o confirmar na linha do nome abre o teclado do sistema; o nome segue a digitação e o Enter grava', () => {
    const fake = fakePlatform(true);
    let recipe = r;
    const entry = customNameEntry(
      'teamName2',
      0,
      fake.platform,
      false,
      () => recipe,
      (next) => (recipe = next),
    )!;
    expect(entry.system).toBe(true);
    expect(fake.opened[0]!.request).toMatchObject({ initial: '', maxLength: 15, kind: 'name' });
    // O que o atlas não desenha sai; os espaços repetidos viram um; o teto é 15.
    fake.opened[0]!.listener.onChange('Os   Bobões ☺ da Rua e mais', 0);
    expect(recipe.teams[2]!.name).toBe('Os Bobões da Ru');
    expect(entry.frame(menu, raw, ui, list)).toBe('system');
    fake.opened[0]!.listener.onSubmit('Os Bobões');
    expect(recipe.teams[2]!.name).toBe('Os Bobões');
    expect(fake.closed()).toBe(1);
    // Sem nada apertado, acabou.
    expect(entry.frame(menu, raw, ui, list)).toBe('done');
  });

  it('cancelar volta ao nome de antes; gravar vazio volta à cor (sem nome)', () => {
    const fake = fakePlatform(true);
    let recipe: MatchRecipe = { ...r, teams: r.teams.map((tm, i) => (i === 1 ? { ...tm, name: 'Azulões' } : tm)) };
    const entry = customNameEntry(
      'teamName1',
      0,
      fake.platform,
      false,
      () => recipe,
      (next) => (recipe = next),
    )!;
    expect(fake.opened[0]!.request.initial).toBe('Azulões');
    fake.opened[0]!.listener.onChange('Outro', 5);
    fake.opened[0]!.listener.onCancel();
    expect(recipe.teams[1]!.name).toBe('Azulões');
    expect(entry.frame(menu, raw, ui, list)).toBe('done');
    const again = customNameEntry(
      'teamName1',
      0,
      fake.platform,
      false,
      () => recipe,
      (next) => (recipe = next),
    )!;
    fake.opened[1]!.listener.onSubmit('   ');
    // M9 (fase 3, revisão): vazio grava sem nome (o time volta à cor).
    expect(recipe.teams[1]!.name ?? '').toBe('');
    expect(again.frame(menu, raw, ui, list)).toBe('done');
  });

  it('as setas e as outras linhas não abrem nada; sem o teclado do sistema (ou com o controle na web), o do jogo', () => {
    const fake = fakePlatform(true);
    const set = (): void => undefined;
    expect(customNameEntry('teamName2', 1, fake.platform, false, () => r, set)).toBeNull();
    expect(customNameEntry('teamHp2', 0, fake.platform, false, () => r, set)).toBeNull();
    // Um time que a receita não tem (o 3 num Sandbox de 3).
    expect(customNameEntry('teamName3', 0, fake.platform, false, () => r, set)).toBeNull();
    expect(fake.opened).toHaveLength(0);
    const own = customNameEntry('teamName0', 0, fakePlatform(false).platform, false, () => r, set)!;
    expect(own.system).toBe(false);
    const pad = customNameEntry('teamName0', 0, fake.platform, true, () => r, set)!;
    expect(pad.system).toBe(false);
    expect(fake.opened).toHaveLength(0);
  });
});
