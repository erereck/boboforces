import { validateMatchRecipe, type MatchRecipe } from '@boboforces/format';
import type { Platform } from '@boboforces/platform-api';
import { createRng } from '@boboforces/shared';
import { TABBED_ROW_PREFIX } from '@boboforces/ui';
import { describe, expect, it } from 'vitest';
import { STORAGE_RECIPE_LIMITS } from './save-store.ts';
import {
  createSurpriseFlow,
  rollSurprise,
  SURPRISE_FLOW_ACTION,
  SURPRISE_LINES,
  surpriseCodeDoc,
  surpriseDetails,
  surpriseFromCode,
  surpriseLineText,
  surpriseRecipe,
  type SurpriseLine,
} from './surprise.ts';

const none = new Set<SurpriseLine>();
const total = (r: MatchRecipe, team: number): number => (r.teams[team]?.bots ?? []).reduce((n, b) => n + b.count, 0);

describe('M8 (fase 3): o sorteio do Surpreenda-me', () => {
  it('a mesma semente dá o mesmo sorteio; 400 sorteios dão receitas válidas e passam por vários modos', () => {
    expect(rollSurprise(42, null, none)).toEqual(rollSurprise(42, null, none));
    const modes = new Set<string>();
    for (let seed = 1; seed <= 400; seed++) {
      const roll = rollSurprise(seed, null, none);
      modes.add(roll.mode);
      const r = validateMatchRecipe(surpriseRecipe(roll), STORAGE_RECIPE_LIMITS);
      expect(r.ok, `${seed} ${roll.mode}`).toBe(true);
      for (const line of SURPRISE_LINES) expect(surpriseLineText(roll, line)).not.toBe('');
    }
    expect(modes.size).toBeGreaterThanOrEqual(12);
  });

  it('o cadeado segura a linha no "Rolar de novo"; o mapa travado que não vale para o modo novo muda', () => {
    const first = rollSurprise(7, null, none);
    const locks = new Set<SurpriseLine>(['mode', 'enemies']);
    for (let seed = 100; seed < 140; seed++) {
      const next = rollSurprise(seed, first, locks);
      expect(next.mode).toBe(first.mode);
      expect(next.level).toBe(first.level);
      expect(next.stars).toEqual(first.stars);
    }
    // O mapa travado num Times; o modo novo (o Royale, só na ilha) ganha o mapa dele.
    const tdm = { ...first, mode: 'warfare.tdm', map: 'ringue' };
    let found = false;
    for (let seed = 1; seed < 400 && !found; seed++) {
      const next = rollSurprise(seed, tdm, new Set<SurpriseLine>(['map']));
      if (next.mode === 'royale') {
        expect(next.map).toBe('island');
        found = true;
      } else if (next.mode === 'warfare.tdm') expect(next.map).toBe('ringue');
    }
    expect(found).toBe(true);
  });

  it('as estrelas entram no lugar de bots do time adversário (o time não cresce)', () => {
    const roll = {
      ...rollSurprise(1, null, none),
      mode: 'warfare.tdm',
      size: 5,
      stars: ['jorge-the-immortal', 'camper-carl'],
    };
    const plain = surpriseRecipe({ ...roll, stars: [] });
    const starry = surpriseRecipe(roll);
    expect(total(starry, 1)).toBe(total(plain, 1));
    expect(starry.teams[1]!.bots.map((b) => b.ref)).toContain('builtin:jorge-the-immortal');
    expect(starry.teams[1]!.bots.map((b) => b.ref)).toContain('builtin:camper-carl');
  });

  it('a arma fixa e os modificadores só nos modos de regra livre', () => {
    const base = rollSurprise(3, null, none);
    const tdm = surpriseRecipe({ ...base, mode: 'warfare.tdm', weapon: 'sniper', mods: ['lowGravity'] });
    expect(tdm.weapons?.allowed).toEqual(['sniper']);
    expect(tdm.modifiers).toEqual(['lowGravity']);
    const gun = surpriseRecipe({ ...base, mode: 'gunGame', weapon: 'sniper', mods: ['lowGravity'] });
    expect(gun.weapons?.allowed).toBeUndefined();
    expect(gun.modifiers).toBeUndefined();
  });

  it('o código guarda o sorteio; o de outra versão ou com modo que não existe é recusado', () => {
    const roll = rollSurprise(9, null, none);
    expect(surpriseFromCode(JSON.parse(JSON.stringify(surpriseCodeDoc(roll))))).toEqual(roll);
    expect(surpriseFromCode({ ...surpriseCodeDoc(roll), v: 99 })).toBeNull();
    expect(surpriseFromCode({ ...surpriseCodeDoc(roll), mode: 'sandbox' })).toBeNull();
    // Campos estragados caem no padrão (o mapa do modo, sem arma, sem estrela de fora).
    const fixed = surpriseFromCode({
      ...surpriseCodeDoc({ ...roll, mode: 'warfare.tdm' }),
      map: 'lua',
      weapon: 'laser',
      stars: ['x'],
    });
    expect(fixed).toMatchObject({ mode: 'warfare.tdm', map: 'construto', weapon: '', stars: [] });
  });
});

describe('M8 (fase 3): a tela do Surpreenda-me', () => {
  const platform = { id: 'web', clipboard: { writeText: async () => true } } as unknown as Platform;

  it('a linha apertada trava; o "Rolar de novo" muda as outras; Jogar devolve a receita', () => {
    const flow = createSurpriseFlow({ platform, rng: createRng(5) });
    flow.open();
    const mode = flow.roll.mode;
    flow.act(TABBED_ROW_PREFIX + 'mode');
    expect(flow.locks.has('mode')).toBe(true);
    for (let k = 0; k < 10; k++) flow.act(SURPRISE_FLOW_ACTION.reroll);
    expect(flow.roll.mode).toBe(mode);
    flow.act(TABBED_ROW_PREFIX + 'mode');
    expect(flow.locks.has('mode')).toBe(false);
    const out = flow.act(SURPRISE_FLOW_ACTION.play);
    expect(out.kind).toBe('play');
    // O nome do card fica ("Gun Game"); sem nome (os Times, o FFA, o Zombies), "Surpreenda-me".
    expect(out.kind === 'play' && out.recipe.name).toBeTruthy();
    expect(flow.act(SURPRISE_FLOW_ACTION.back).kind).toBe('back');
  });

  it('tudo travado: o "Rolar de novo" solta tudo', () => {
    const flow = createSurpriseFlow({ platform, rng: createRng(6) });
    flow.open();
    for (const line of SURPRISE_LINES) flow.act(TABBED_ROW_PREFIX + line);
    expect(flow.locks.size).toBe(SURPRISE_LINES.length);
    flow.act(SURPRISE_FLOW_ACTION.reroll);
    expect(flow.locks.size).toBe(0);
  });
});

describe('M8 (fase 3, revisão): o que o card diz é o que se joga', () => {
  const base = rollSurprise(11, null, none);

  it('os Times no Ringue cabem nos 7 bots (4 contra 4) e o card diz o tamanho de verdade', () => {
    const roll = { ...base, mode: 'warfare.tdm', map: 'ringue', size: 6, stars: [], mods: [], weapon: '' };
    const r = surpriseRecipe(roll);
    expect(total(r, 0) + total(r, 1)).toBeLessThanOrEqual(7);
    expect(surpriseDetails(roll)).toContain('4 contra 4');
  });

  it('a Infection não ganha estrela (o time dela é o dos infectados); o Zombies não mostra nível', () => {
    const inf = { ...base, mode: 'infection', stars: ['jorge-the-immortal'] };
    expect(surpriseLineText(inf, 'enemies')).not.toContain('Jorge');
    expect(surpriseLineText({ ...base, mode: 'zombies' }, 'enemies')).toBe('Os do modo');
    // O nome do card fica.
    expect(surpriseRecipe({ ...base, mode: 'gunGame' }).name).toBe('Gun Game');
  });

  it('com uma arma só, o "troca a arma no abate" sai', () => {
    const roll = { ...base, mode: 'warfare.tdm', weapon: 'sniper', mods: ['swapOnKill', 'lowGravity'] as const };
    const r = surpriseRecipe({ ...roll, mods: [...roll.mods] });
    expect(r.modifiers).toEqual(['lowGravity']);
  });

  it('direita trava, esquerda solta (segurar não pisca)', () => {
    const flow = createSurpriseFlow({
      platform: { id: 'web', clipboard: { writeText: async () => true } } as unknown as Platform,
      rng: createRng(8),
    });
    flow.open();
    flow.act(TABBED_ROW_PREFIX + 'map', 1);
    flow.act(TABBED_ROW_PREFIX + 'map', 1);
    expect(flow.locks.has('map')).toBe(true);
    flow.act(TABBED_ROW_PREFIX + 'map', -1);
    flow.act(TABBED_ROW_PREFIX + 'map', -1);
    expect(flow.locks.has('map')).toBe(false);
  });
});
