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
  'map:ringue',
  'map:posto',
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
  'block:concrete-slab',
  'block:concrete-step',
  'block:concrete-ramp',
  'block:concrete-ramp-half-low',
  'block:concrete-ramp-half-high',
  'block:concrete-ramp-corner-in',
  'block:concrete-ramp-corner-out',
  'block:test-floor',
  'block:test-floor-stripe',
  'block:sector-marker-1',
  'block:sector-marker-2',
  'block:sector-marker-3',
  'block:sector-marker-4',
  'block:sector-marker-5',
  'block:sector-marker-6',
  'block:sector-marker-7',
  'block:sector-marker-8',
  'block:sector-marker-9',
  'block:test-wall',
  'block:metal-panel',
  'block:metal-roof-ramp',
  'block:metal-roof-ramp-corner-in',
  'block:metal-roof-ramp-corner-out',
  'block:brick',
  'block:plank',
  'block:plank-slab',
  'block:grass',
  'block:dirt',
  'block:log',
  'block:leaves',
  'block:tall-grass',
  'block:flowers',
  'block:bush',
  'block:fence-wire',
  'block:fence-wood',
  'block:railing',
  'block:grate-slab',
  'block:light-panel',
  'block:lamp',
  'block:glass',
  'block:glass-pane',
  'block:water',
  // Blocos do Construto pedidos pela frente texturas na integração do M1 (só acrescentados, regra 20)
  'block:concrete-stripe',
  'block:cinder-block',
  'block:canvas',
  'block:led-strip',
  'block:exit-sign',
  'block:danger-sign-a',
  'block:danger-sign-b',
  'bot:vibe-bob',
  'bot:chill-bob',
  'bot:normal-bob',
  'bot:sweaty-bob',
  'bot:tryhard-bob',
  'movement:bobo',
  'movement:tactical',
  'movement:arcade',
  'movement:custom',
  'model:pistol',
  'model:rifle',
  'model:sniper',
  'model:barrel',
  'model:water-tank',
  'model:jeep',
  'model:floodlight',
  'model:pipe',
  'model:column',
  'model:tarp',
  'model:generator',
  'model:tree',
  'model:sandbags',
  // Caixote grande (frente skins-modelos; registrado na integração do M1)
  'model:crate-large',
  'model:smg',
  'model:shotgun',
  'model:rocket',
  'model:knife',
  'model:grenade',
  'model:lmg',
  'model:rocket-shell',
  'model:ammo-box',
  'model:zombie-plank',
  'model:zombie-door',
  'model:mystery-box',
  'model:perk-chonky',
  'model:perk-speedy',
  'model:perk-buddy',
  'model:drop-double',
  'skin:recruit',
  'skin:mechanic',
  'skin:pilot',
  'skin:zombie',
  'skin:classico',
  'skin:blackpower',
  'skin:sardento',
  'skin:dreads',
  'skin:bandana',
  'skin:moicano',
  'skin:barbudo',
  'skin:trancas',
  'skin:astronaut',
  'skin:pajamas',
  'skin:cardboard',
  'skin:diver',
  'bot:jorge-the-immortal',
  'bot:camper-carl',
  'bot:knife-ninja',
  'bot:scaredy-sam',
  'bot:hunter-hank',
  'bot:buddy',
  'bot:goofy-gus',
  'bot:training-dummy',
  'bot:training-runner',
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
    expect(contentIdsOfKind('map')).toEqual(['construto', 'ringue', 'posto']);
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
