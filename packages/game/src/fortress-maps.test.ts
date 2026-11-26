import { validateMatchRecipe, type MatchRecipe } from '@boboforces/format';
import { describe, expect, it } from 'vitest';
import { customRowViews, stepCustom, type CustomLimits } from './custom-match.ts';
import { FORTRESS_MAPS, MAP_MODES, type MenuMap } from './maps.ts';
import { moreModePreset } from './more-modes.ts';
import { STORAGE_RECIPE_LIMITS } from './save-store.ts';
import { rollSurprise, surpriseCodeDoc, surpriseFromCode, surpriseRecipe, type SurpriseLine } from './surprise.ts';

/**
 * M11 (fase 3): o Fortress na Fazenda à noite por todos os caminhos onde o Bobo Zombies escolhe mapa: o card da
 * Fortaleza começa nela (o mapa do GDD), a Partida personalizada troca para o Posto (e volta) sem perder a variante, e o
 * Surpreenda-me sorteia entre os dois.
 */

const LIMITS: CustomLimits = { maxBots: 15, maxViewM: 140 };
const none = new Set<SurpriseLine>();

describe('M11 (fase 3): os mapas do Fortress', () => {
  it('a Fazenda primeiro, depois o Posto; os dois são mapas do Bobo Zombies', () => {
    expect([...FORTRESS_MAPS]).toEqual(['farm', 'posto']);
    for (const m of FORTRESS_MAPS) expect(MAP_MODES[m as MenuMap]).toContain('zombies');
  });

  it('o card da Fortaleza começa na Fazenda, com o gerador, e a receita valida', () => {
    const r = moreModePreset('zombiesFortress')!;
    expect(r).toMatchObject({ mode: 'zombies', map: 'farm', zombies: { variant: 'fortress' } });
    expect(validateMatchRecipe(r, STORAGE_RECIPE_LIMITS).ok).toBe(true);
    // O Posto (o mapa do M6) também valida com a variante.
    expect(validateMatchRecipe({ ...r, map: 'posto' }, STORAGE_RECIPE_LIMITS).ok).toBe(true);
  });

  it('a Partida personalizada: a linha Mapa leva a Fortaleza ao Posto e de volta à Fazenda, com a variante', () => {
    const card = moreModePreset('zombiesFortress')!;
    const mapRow = (r: MatchRecipe): string =>
      customRowViews('match', r, LIMITS).find((row) => row.id === 'map')!.value;
    expect(mapRow(card)).toBe('Fazenda');
    // A linha passa pelos mapas do Bobo Zombies (o Construto, o Posto, a Base e a Fazenda) sem tirar o gerador.
    const seen: string[] = [];
    let r = card;
    for (let i = 0; i < 4; i++) {
      r = stepCustom('match', r, 'map', 1, LIMITS);
      seen.push(r.map);
      expect(r.zombies?.variant, r.map).toBe('fortress');
      expect(validateMatchRecipe(r, STORAGE_RECIPE_LIMITS).ok, r.map).toBe(true);
    }
    expect(seen).toContain('posto');
    expect(seen.at(-1)).toBe('farm');
    const posto = stepCustom('match', stepCustom('match', card, 'map', -1, LIMITS), 'map', -1, LIMITS);
    expect([posto.map, posto.zombies?.variant, mapRow(posto)]).toEqual(['posto', 'fortress', 'Posto Avançado']);
  });

  it('o Surpreenda-me sorteia a Fortaleza na Fazenda e no Posto (a receita válida, com o gerador)', () => {
    const maps = new Map<string, number>();
    for (let seed = 1; seed <= 4000; seed++) {
      const roll = rollSurprise(seed, null, none);
      if (roll.mode !== 'zombiesFortress') continue;
      maps.set(roll.map, (maps.get(roll.map) ?? 0) + 1);
      const r = surpriseRecipe(roll);
      expect([r.map, r.zombies?.variant]).toEqual([roll.map, 'fortress']);
      expect(validateMatchRecipe(r, STORAGE_RECIPE_LIMITS).ok, `${seed}`).toBe(true);
    }
    expect([...maps.keys()].sort()).toEqual(['farm', 'posto']);
    // O mapa travado fica no "Rolar de novo" com o modo travado.
    const first = { ...rollSurprise(1, null, none), mode: 'zombiesFortress', map: 'posto' };
    const locks = new Set<SurpriseLine>(['mode', 'map']);
    for (let seed = 2; seed < 20; seed++) expect(rollSurprise(seed, first, locks).map).toBe('posto');
  });

  it('o código do Surpreenda-me: a Fortaleza no Posto (os códigos de antes) e na Fazenda voltam iguais', () => {
    const base = { ...rollSurprise(3, null, none), mode: 'zombiesFortress' };
    for (const map of ['posto', 'farm']) {
      const roll = { ...base, map };
      expect(surpriseFromCode(JSON.parse(JSON.stringify(surpriseCodeDoc(roll))))).toEqual(roll);
    }
    // Um mapa que não é da Fortaleza cai no primeiro (a Fazenda).
    expect(surpriseFromCode({ ...surpriseCodeDoc({ ...base, map: 'construto' }) })?.map).toBe('farm');
  });
});
