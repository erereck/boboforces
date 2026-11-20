import { DEBUT_PRESET, RECIPE_RANGES, TEAM_COLOR_COUNT, type MatchRecipe } from '@boboforces/format';
import { STRINGS_ONLINE_PT_BR, TEAM_COLORS, TEAM_PALETTE } from '@boboforces/ui';
import { describe, expect, it } from 'vitest';
import { figureTeamColors } from './scene/figures.ts';
import { colorName, teamColor, teamColorIndex, teamColorTable } from './team-colors.ts';
import { teamColorName, teamName } from './team-names.ts';

/** M10 (fase 8): a cor de cada time na partida (pergunta AK6). */

const bots = [{ ref: 'builtin:normal-bob' as const, count: 1 }];
const sandbox = (colors: (number | undefined)[]): MatchRecipe => ({
  ...DEBUT_PRESET,
  mode: 'sandbox',
  teams: colors.map((color) => ({ bots, ...(color !== undefined ? { color } : {}) })),
});

describe('M10 (fase 8): a paleta e a tabela das cores de time', () => {
  it('8 cores (as 4 de sempre primeiro, na ordem), todas diferentes e com nome', () => {
    expect(TEAM_PALETTE).toHaveLength(TEAM_COLOR_COUNT);
    expect(RECIPE_RANGES.teamColor).toEqual({ min: 0, max: TEAM_PALETTE.length - 1 });
    expect(TEAM_PALETTE.slice(0, 4)).toEqual(TEAM_COLORS);
    expect(new Set(TEAM_PALETTE).size).toBe(TEAM_PALETTE.length);
    expect(TEAM_PALETTE.map((_, i) => colorName(i))).toEqual([
      'Laranja',
      'Azul',
      'Verde',
      'Roxo',
      'Vermelho',
      'Amarelo',
      'Rosa',
      'Ciano',
    ]);
    // A sala online tem o nome de cada cor também.
    expect(TEAM_PALETTE.map((_, i) => (STRINGS_ONLINE_PT_BR as Record<string, string>)[`online.team.${i}`])).toEqual(
      TEAM_PALETTE.map((_, i) => colorName(i)),
    );
  });

  it('sem cor (e fora do Sandbox), a da posição: tudo como antes', () => {
    expect(teamColorTable(DEBUT_PRESET)).toEqual(TEAM_COLORS);
    expect(teamColorTable(sandbox([undefined, undefined, undefined]))).toEqual(TEAM_COLORS);
    // A cor na receita de outro modo não vale.
    const tdm = { ...sandbox([4, 5]), mode: 'warfare.tdm' };
    expect(teamColorTable(tdm)).toEqual(TEAM_COLORS);
    expect([teamName(tdm, 0), teamColorName(tdm, 1)]).toEqual(['Laranja', 'Azul']);
    // Fora dos times, o Laranja.
    expect([teamColorIndex(DEBUT_PRESET, -1), teamColorIndex(DEBUT_PRESET, 9)]).toEqual([0, 0]);
  });

  it('no Sandbox, a escolhida: a tabela, o nome da cor e as skins', () => {
    const r = sandbox([4, undefined, 7, 0]);
    expect([0, 1, 2, 3].map((i) => teamColorIndex(r, i))).toEqual([4, 1, 7, 0]);
    expect(teamColorTable(r)).toEqual([TEAM_PALETTE[4], TEAM_PALETTE[1], TEAM_PALETTE[7], TEAM_PALETTE[0]]);
    expect(teamColor(r, 2)).toBe(TEAM_PALETTE[7]);
    // O nome do time sem nome segue a cor ("Time Vermelho").
    expect([0, 1, 2, 3].map((i) => teamName(r, i))).toEqual(['Vermelho', 'Azul', 'Ciano', 'Laranja']);
    // O nome digitado ganha da cor.
    expect(teamName({ ...r, teams: r.teams.map((tm, i) => (i === 0 ? { ...tm, name: 'Os Bobões' } : tm)) }, 0)).toBe(
      'Os Bobões',
    );
    // As skins: o colete de cada time na cor da tabela (RGB); sem a tabela, as da posição.
    expect(figureTeamColors(4, teamColorTable(r))).toEqual([0xe8283c, 0x2e8bff, 0x2ee6f0, 0xff7a1a]);
    expect(figureTeamColors(2)).toEqual([0xff7a1a, 0x2e8bff]);
    expect(figureTeamColors(1, teamColorTable(r))).toEqual([0xe8283c, 0x2e8bff]);
  });
});
