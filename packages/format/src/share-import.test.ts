import { describe, expect, it } from 'vitest';
import { builtinBot, levelBot, type BotDocument } from './bot.ts';
import { MATCH_RECIPE_FORMAT, type MatchRecipe } from './match-recipe.ts';
import { encodeShareCode } from './share-code.ts';
import { importShareCode, SHARE_MAX_EMBEDDED_BOTS } from './share-import.ts';
import type { RecipeLimits } from './validation.ts';

const limits: RecipeLimits = { maxBots: 40, maxLocalHumans: 4, maxViewDistanceM: 150 };

function code(kind: 'bot' | 'preset' | 'squad', doc: unknown): string {
  const r = encodeShareCode(kind, doc);
  if (!r.ok) throw new Error('código grande demais');
  return r.code;
}

const jorge: BotDocument = { ...builtinBot('jorge-the-immortal')!, id: 'meu-jorge', name: 'Jorge do Bairro' };

function preset(bots: BotDocument[], name = 'Festa'): MatchRecipe {
  return {
    format: MATCH_RECIPE_FORMAT,
    name,
    mode: 'warfare.tdm',
    map: 'construto',
    seed: 0,
    teams: [
      { humans: 'all', bots: bots.map((b) => ({ ref: `embedded:${b.id}`, count: 1 })) },
      { name: 'Os Bobos', bots: [{ ref: 'builtin:normal-bob', count: 2 }] },
    ],
    embeddedBots: bots,
  };
}

describe('M8 (fase 0): importar um código', () => {
  it('o bot volta validado, sem aviso', () => {
    const r = importShareCode(code('bot', jorge), limits);
    expect(r).toMatchObject({ ok: true, kind: 'bot', bot: { id: 'meu-jorge', name: 'Jorge do Bairro' } });
    expect(r.ok && r.warnings).toEqual([]);
  });

  it('o nome barrado fica vazio, com o aviso (no bot, no preset, no time e nos embutidos)', () => {
    const bad = importShareCode(code('bot', { ...jorge, name: 'Porra Bob' }), limits);
    expect(bad).toMatchObject({ ok: true, bot: { name: '' }, warnings: [{ code: 'name.blocked', path: 'name' }] });
    const p = preset([{ ...jorge, name: 'Fuck' }], 'Merda');
    const withTeam = { ...p, teams: [p.teams[0]!, { ...p.teams[1]!, name: 'P u t a' }] };
    const r = importShareCode(code('preset', withTeam), limits);
    expect(r.ok).toBe(true);
    if (!r.ok || r.kind !== 'preset') return;
    expect(r.preset.name).toBeUndefined();
    expect(r.preset.teams[1]!.name).toBeUndefined();
    expect(r.preset.embeddedBots![0]!.name).toBe('');
    expect(r.warnings.filter((w) => w.code === 'name.blocked').map((w) => w.path)).toEqual([
      'name',
      'teams[1].name',
      'embeddedBots[0].name',
    ]);
  });

  it('o preset vai pelo teto do aparelho (avisa) e recusa mais de 16 embutidos', () => {
    const many = { ...preset([jorge]), teams: [{ humans: 'all', bots: [{ ref: 'builtin:normal-bob', count: 60 }] }] };
    const r = importShareCode(code('preset', many), { ...limits, maxBots: 12 });
    expect(r.ok).toBe(true);
    expect(r.ok && r.warnings.some((w) => w.code === 'recipe.botsOverPlatformCap')).toBe(true);
    const bots = Array.from({ length: SHARE_MAX_EMBEDDED_BOTS + 1 }, (_, i) => ({
      ...levelBot('normal'),
      id: `b${i}`,
    }));
    expect(importShareCode(code('preset', preset(bots)), limits)).toMatchObject({ ok: false, error: 'invalid' });
  });

  it('recusa o documento que não valida, o tipo que não é bot nem preset e o código quebrado', () => {
    expect(importShareCode(code('bot', { format: 'boboforces/bot@9' }), limits)).toMatchObject({
      ok: false,
      error: 'invalid',
    });
    expect(importShareCode(code('squad', { a: 1 }), limits)).toEqual({ ok: false, error: 'kind', issues: [] });
    expect(importShareCode('BF1-!!!', limits)).toEqual({ ok: false, error: 'base64', issues: [] });
  });
});

describe('M8 (fase 0, revisão): o que vem de fora', () => {
  it('as armas das regras do bot só com ids conhecidos (um texto qualquer não chega ao card)', () => {
    const weird = { ...jorge, rules: { ...jorge.rules, weapons: ['fuck you', 'shotgun'] } };
    const r = importShareCode(code('bot', weird), limits);
    expect(r.ok && r.kind === 'bot' && r.bot.rules.weapons).toEqual(['shotgun']);
    expect(r.ok && r.warnings.map((w) => w.code)).toContain('content.missingWeapon');
  });

  it('o look vira um visual normalizado; o id longo demais recusa', () => {
    const r = importShareCode(code('bot', { ...jorge, look: { hair: 'x', lixo: [[[[1]]]] } }), limits);
    expect(r.ok && r.kind === 'bot' && typeof r.bot.look).toBe('object');
    expect(r.ok && r.kind === 'bot' && (r.bot.look as Record<string, unknown>)['lixo']).toBeUndefined();
    expect(importShareCode(code('bot', { ...jorge, id: 'x'.repeat(60) }), limits)).toMatchObject({
      ok: false,
      error: 'invalid',
    });
  });
});

describe('M8 (fase 1): o tamanho dos códigos', () => {
  it('um preset com 16 bots embutidos cabe bem nos 4.000 caracteres (o LZ77 junta o que se repete)', () => {
    const bots = Array.from({ length: SHARE_MAX_EMBEDDED_BOTS }, (_, i) => ({
      ...builtinBot(i % 2 === 0 ? 'jorge-the-immortal' : 'normal-bob')!,
      id: `meu-bot-${i}`,
      name: `Bot do Fulano ${i}`,
    }));
    const c = code('preset', preset(bots));
    expect(c.length).toBeLessThan(3000);
    expect(importShareCode(c, limits)).toMatchObject({ ok: true, kind: 'preset' });
  });
});

describe('M8 (fase 1, revisão): os nomes de fora só com o que a fonte desenha', () => {
  it('tira controles, quebras de linha e marcas de direção; o que sobra vazio vira o nome do gerador', () => {
    const r = importShareCode(code('bot', { ...jorge, name: 'Jorge\n‮Bob\u0007 ☃' }), limits);
    expect(r.ok && r.kind === 'bot' && r.bot.name).toBe('Jorge Bob');
    const empty = importShareCode(code('bot', { ...jorge, name: '‮\u0007☃' }), limits);
    expect(empty.ok && empty.kind === 'bot' && empty.bot.name).toBe('');
    const p = importShareCode(code('preset', { ...preset([jorge], 'Festa\u0000 do Bob') }), limits);
    expect(p.ok && p.kind === 'preset' && p.preset.name).toBe('Festa do Bob');
  });
});
