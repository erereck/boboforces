import { describe, expect, it } from 'vitest';
import {
  CONTENT_FALLBACKS,
  CONTENT_IDS,
  CONTENT_KINDS,
  contentIdsOfKind,
  isKnownContentId,
  isValidContentLocal,
  resolveContent,
  RETIRED_CONTENT_IDS,
  splitContentId,
} from './content-ids.ts';

/**
 * Lista TRAVADA (regra 20). Só cresce: ID novo no registro entra aqui também. Se um ID daqui sumir do registro sem
 * estar em `RETIRED_CONTENT_IDS` com substituto, o CI falha.
 */
const LOCKED_IDS = [
  'mode:warfare.tdm',
  'mode:warfare.ffa',
  'mode:warfare.domination',
  'mode:strike',
  'mode:royale.mini',
  'mode:paintball',
  'mode:zombies',
  'mode:sandbox',
  'mode:juggernaut',
  'mode:chaos',
  'mode:training',
  'map:construto',
  'weapon:pistol',
  'weapon:smg',
  'weapon:rifle',
  'weapon:shotgun',
  'weapon:sniper',
  'weapon:rocket',
  'weapon:knife',
  'weapon:grenade',
  'weapon:lmg',
  'block:missing',
  'block:concrete',
  'block:crate',
  'bot:vibe-bob',
  'bot:chill-bob',
  'bot:normal-bob',
  'bot:sweaty-bob',
  'bot:tryhard-bob',
  'movement:bobo',
  'movement:tactical',
  'movement:arcade',
  'movement:custom',
];

describe('registro de IDs de conteúdo', () => {
  it('nenhum ID travado some nem muda de nome', () => {
    const retired = new Set<string>(RETIRED_CONTENT_IDS.map((r) => r.id));
    for (const id of LOCKED_IDS) {
      expect(isKnownContentId(id) || retired.has(id), `ID ${id} sumiu sem aposentadoria`).toBe(true);
    }
  });

  it('todo ID do registro está travado (ID novo entra também na lista travada)', () => {
    for (const id of CONTENT_IDS) expect(LOCKED_IDS, `registre ${id} em LOCKED_IDS`).toContain(id);
  });

  it('IDs bem formados, sem duplicata, com tipo conhecido', () => {
    expect(new Set(CONTENT_IDS).size).toBe(CONTENT_IDS.length);
    for (const id of CONTENT_IDS) {
      const parts = splitContentId(id);
      expect(parts).not.toBeNull();
      expect(isValidContentLocal(parts!.local), id).toBe(true);
    }
  });

  it('aposentados têm substituto registrado e não continuam ativos', () => {
    for (const r of RETIRED_CONTENT_IDS) {
      expect(isKnownContentId(r.id)).toBe(false);
      expect(isKnownContentId(r.replacedBy)).toBe(true);
    }
  });

  it('todo tipo tem política de fallback', () => {
    for (const kind of CONTENT_KINDS) expect(CONTENT_FALLBACKS[kind]).toBeDefined();
  });

  it('lista os IDs locais de um tipo, na ordem do registro', () => {
    expect(contentIdsOfKind('map')).toEqual(['construto']);
    expect(contentIdsOfKind('bot')[0]).toBe('vibe-bob');
    expect(contentIdsOfKind('prop')).toEqual([]);
  });

  it('valida a parte local', () => {
    expect(isValidContentLocal('warfare.tdm')).toBe(true);
    expect(isValidContentLocal('normal-bob')).toBe(true);
    expect(isValidContentLocal('')).toBe(false);
    expect(isValidContentLocal('Rifle')).toBe(false);
    expect(isValidContentLocal('.rifle')).toBe(false);
    expect(isValidContentLocal('a b')).toBe(false);
  });
});

describe('fallback de conteúdo (tecnico.md §14.5)', () => {
  it('conhecido passa direto', () => {
    expect(resolveContent('weapon', 'rifle')).toEqual({ status: 'known', local: 'rifle' });
  });

  it('modo e mapa ausentes recusam', () => {
    expect(resolveContent('mode', 'warfare.ctf')).toEqual({ status: 'refused' });
    expect(resolveContent('map', 'lua')).toEqual({ status: 'refused' });
  });

  it('arma ausente cai na padrão da categoria, senão na pistola', () => {
    expect(resolveContent('weapon', 'smg.compact')).toEqual({ status: 'fallback', local: 'smg' });
    expect(resolveContent('weapon', 'minigun')).toEqual({ status: 'fallback', local: 'pistol' });
    expect(resolveContent('weapon', 'dmr.long')).toEqual({ status: 'fallback', local: 'pistol' });
  });

  it('bloco vira o xadrez, bot vira o Normal, visual volta ao padrão do slot, prop some', () => {
    expect(resolveContent('block', 'neon')).toEqual({ status: 'fallback', local: 'missing' });
    expect(resolveContent('bot', 'jorge-bob')).toEqual({ status: 'fallback', local: 'normal-bob' });
    expect(resolveContent('movement', 'moon')).toEqual({ status: 'fallback', local: 'bobo' });
    expect(resolveContent('hat', 'crown')).toEqual({ status: 'fallback', local: null });
    expect(resolveContent('prop', 'barrel')).toEqual({ status: 'dropped' });
  });
});
