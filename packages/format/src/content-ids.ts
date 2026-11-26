/**
 * Registro de IDs de conteúdo (tecnico.md §14.5, regra 20). IDs são estáveis, em inglês, e NUNCA mudam nem somem:
 * aposentar exige entrada em `RETIRED_CONTENT_IDS` com o substituto. O teste `content-ids.test.ts` guarda a lista
 * travada: o CI falha se um ID sumir ou mudar de nome, e ID novo precisa entrar também na lista travada.
 *
 * O prefixo de tipo (`weapon:`, `map:`…) existe só aqui e nas mensagens. Nos documentos JSON o campo já diz o tipo e
 * o valor vai sem prefixo (`"mode": "warfare.tdm"`). Exceção: refs de bot (`builtin:<id>`, `embedded:<id>`).
 */
export const CONTENT_KINDS = [
  'mode',
  'map',
  'weapon',
  'block',
  'bot',
  'movement',
  'hat',
  'skin',
  'prop',
  'model',
] as const;

export type ContentKind = (typeof CONTENT_KINDS)[number];

export type ContentId = `${ContentKind}:${string}`;

export function contentId(kind: ContentKind, local: string): ContentId {
  return `${kind}:${local}`;
}

/** `weapon:rifle` → `{ kind: 'weapon', local: 'rifle' }`; `null` se o tipo não existir. */
export function splitContentId(id: string): { kind: ContentKind; local: string } | null {
  const i = id.indexOf(':');
  if (i <= 0 || i === id.length - 1) return null;
  const kind = id.slice(0, i) as ContentKind;
  if (!(CONTENT_KINDS as readonly string[]).includes(kind)) return null;
  return { kind, local: id.slice(i + 1) };
}

/** IDs registrados. Só cresce. (Os já citados no GDD e nos docs de design; cada frente acrescenta os seus.) */
export const CONTENT_IDS: readonly ContentId[] = [
  // Modos (tecnico.md §4.4; o nome exibido vem da tabela de textos)
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
  // Mapas
  'map:construto',
  'map:ringue',
  // M3 (fase 3d): o mapa pequeno do Bobo Zombies com janelas e porta paga (só acrescentado, regra 20)
  'map:posto',
  // M3 (fase 5a): a Base Abandonada, o mapa do Bobo Zombies (só acrescentado, regra 20)
  'map:base',
  // M7 (fase 1): a Base Bobo, o mapa do BoboStrike (só acrescentado, regra 20)
  'map:airbase',
  // M7 (fase 5): a Ilha Tropical, o mapa do Bobo Royale (só acrescentado, regra 20)
  'map:island',
  // M10 (fase 2): o Canteiro de Obras (só acrescentado, regra 20)
  'map:construction',
  // M10 (fase 1): o Porto de Contêineres (só acrescentado, regra 20)
  'map:port',
  // M10 (fase 4): a Estação Lunar, o mapa do Bobo Chaos com a gravidade da Lua de série (só acrescentado, regra 20)
  'map:moonbase',
  // M10 (fase 3): o Galpão de Paintball, o mapa do Bobo Paintball (só acrescentado, regra 20)
  'map:paint-hall',
  // M10 (fase 5): a Fazenda à noite, o 2º mapa do Bobo Zombies (só acrescentado, regra 20)
  'map:farm',
  // Armas (gameplay.md §4.3)
  'weapon:pistol',
  'weapon:smg',
  'weapon:rifle',
  'weapon:shotgun',
  'weapon:sniper',
  'weapon:rocket',
  'weapon:knife',
  'weapon:grenade',
  'weapon:lmg',
  // M10 (fases 6 e 7): as armas novas (só acrescentadas, regra 20). O prefixo antes do `.` é a categoria do fallback
  // (§14.5). As versões publicadas até aqui NÃO aplicam o fallback nas listas de armas (descartam o id que não
  // conhecem: `['rifle.dmr']` vira "todas"); daqui em diante os leitores usam `resolveWeaponId`, e uma arma futura
  // com o mesmo padrão cai na da categoria dela.
  'weapon:rifle.dmr',
  'weapon:pistol.revolver',
  'weapon:shotgun.auto',
  'weapon:sniper.crossbow',
  'weapon:rocket.grenade-launcher',
  // Blocos (o `missing` é o xadrez de fallback)
  'block:missing',
  'block:concrete',
  'block:crate',
  // Blocos do Construto (M1). A forma vai na definição (assets-src/blocks); o sufixo do ID só ajuda a ler.
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
  // M7 (fase 5): a areia da Ilha Tropical (só acrescentado, regra 20)
  'block:sand',
  // M10 (fase 0): o kit dos 5 mapas novos (catálogo em assets-src/blocks/blocks.ts; só acrescentados, regra 20)
  'block:container-red',
  'block:container-blue',
  'block:container-green',
  'block:container-tan',
  'block:container-red-door',
  'block:container-blue-door',
  'block:container-green-door',
  'block:container-tan-door',
  'block:asphalt',
  'block:asphalt-line',
  'block:crane-lattice',
  'block:crane-cable',
  'block:hazard-block',
  'block:scaffold-rail',
  'block:steel-beam',
  'block:steel-column',
  'block:rebar',
  'block:gravel',
  'block:barrier-rail',
  'block:barrier-block',
  'block:cement-bags',
  'block:turf',
  'block:turf-line',
  'block:net',
  'block:regolith',
  'block:station-panel',
  'block:station-floor',
  'block:neon-trim',
  'block:airlock-door',
  'block:barn-wood',
  'block:barn-door-a',
  'block:barn-door-b',
  'block:wood-trim',
  'block:siding',
  'block:hay-bale',
  'block:farmland',
  'block:crops',
  'block:wood-rail-fence',
  // Bots de fábrica (um por nível rápido)
  'bot:vibe-bob',
  'bot:chill-bob',
  'bot:normal-bob',
  'bot:sweaty-bob',
  'bot:tryhard-bob',
  // Perfis de movimento
  'movement:bobo',
  'movement:tactical',
  'movement:arcade',
  'movement:custom',
  // Modelos (.bfmodel) do M1: armas da cena-vitrine e props fora da grade do Construto
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
  // M2 (fase 1c): o resto do arsenal e o foguete em voo (só acrescentados, regra 20)
  'model:smg',
  'model:shotgun',
  'model:rocket',
  'model:knife',
  'model:grenade',
  'model:lmg',
  'model:rocket-shell',
  // M2 (fase 2b): a caixinha de munição de quem morre (só acrescentado, regra 20)
  'model:ammo-box',
  // M3 (fase 3d): a tábua das janelas e a porta paga do Bobo Zombies (só acrescentados, regra 20)
  'model:zombie-plank',
  'model:zombie-door',
  // M3 (fase 4b): a Caixa Misteriosa (só acrescentado, regra 20)
  'model:mystery-box',
  // M3 (fase 4c): as máquinas de vantagem (só acrescentados, regra 20)
  'model:perk-chonky',
  'model:perk-speedy',
  'model:perk-buddy',
  // M3 (fase 4d): a moeda dos pontos em dobro (só acrescentado, regra 20)
  'model:drop-double',
  // M3 (fase 4e): o Desmontador (a arma maravilha) e o raio dele em voo (só acrescentados, regra 20)
  'model:desmontador',
  'model:desmontador-bolt',
  // M3 (fase 5c): o contorno de giz das armas na parede (só acrescentado, regra 20)
  'model:chalk-outline',
  // M6 (fase 3): a Big Brrt, a minigun do Jugg (só acrescentado, regra 20)
  'model:big-brrt',
  // M7 (fase 4): a Boom Box do BoboStrike (só acrescentado, regra 20)
  'model:boom-box',
  // M7 (fase 8): o colete e o kit de cura do Bobo Royale (só acrescentado, regra 20)
  'model:armor-vest',
  'model:medkit',
  // M10 (fase 0): as props do kit dos mapas novos (assets-src/models/map-kit.ts; só acrescentados, regra 20)
  'model:bollard',
  'model:silo',
  'model:tractor',
  'model:hay-roll',
  'model:inflatable-can',
  'model:inflatable-cube',
  'model:inflatable-wedge',
  'model:inflatable-wall',
  // M10 (fases 6 e 7): as armas novas (o id do modelo é o da arma) e os 2 projéteis (só acrescentados, regra 20)
  'model:rifle.dmr',
  'model:pistol.revolver',
  'model:shotgun.auto',
  'model:sniper.crossbow',
  'model:rocket.grenade-launcher',
  'model:crossbow-bolt',
  'model:grenade-launcher-shell',
  // Skins prontas do M1 (3 da cena-vitrine) e o zumbi comum do teste de estresse
  'skin:recruit',
  'skin:mechanic',
  'skin:pilot',
  'skin:zombie',
  // Os 8 visuais do boneco do FutBobo (#56; PLANO do porte §B15), ids descritivos (só acrescentados, regra 20)
  'skin:classico',
  'skin:blackpower',
  'skin:sardento',
  'skin:dreads',
  'skin:bandana',
  'skin:moicano',
  'skin:barbudo',
  'skin:trancas',
  // M2 (fase 6d): as fantasias do Meu Bobo (#62; só acrescentados, regra 20)
  'skin:astronaut',
  'skin:pajamas',
  'skin:cardboard',
  'skin:diver',
  // M3 (fase 5b): os especiais do Bobo Zombies (só acrescentados, regra 20)
  'skin:zombie-sprinter',
  'skin:zombie-chonker',
  'skin:zombie-spitter',
  'skin:zombie-mega',
  // M2 (fase 3a): os bots de fábrica especiais (gameplay.md §6.7; só acrescentados, regra 20)
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

/** IDs aposentados e quem os substitui (vazio no M0). */
export const RETIRED_CONTENT_IDS: readonly { readonly id: ContentId; readonly replacedBy: ContentId }[] = [];

export function isKnownContentId(id: string): boolean {
  return (CONTENT_IDS as readonly string[]).includes(id);
}

/**
 * Forma válida da parte local de um ID: minúsculas, dígitos, `.` e `-`, começando por letra ou dígito. O ponto separa
 * família e variante (`warfare.tdm`; armas: `<categoria>.<variante>`, ex.: `smg.compact`).
 */
export const CONTENT_LOCAL_RE = /^[a-z0-9][a-z0-9.-]{0,47}$/;

export function isValidContentLocal(local: string): boolean {
  return CONTENT_LOCAL_RE.test(local);
}

/** IDs locais (sem prefixo) registrados de um tipo, na ordem do registro (listas da UI). */
export function contentIdsOfKind(kind: ContentKind): string[] {
  const prefix = `${kind}:`;
  const out: string[] = [];
  for (const id of CONTENT_IDS) if (id.startsWith(prefix)) out.push(id.slice(prefix.length));
  return out;
}

/**
 * Política para conteúdo ausente (tecnico.md §14.5):
 * - `refuse`: o documento é recusado (modo, mapa);
 * - `replace`: troca pelo ID `local` (bloco → `missing`, xadrez com colisão de cubo);
 * - `weaponCategory`: arma padrão da mesma categoria (o prefixo antes do `.`), senão `local` (pistola);
 * - `slotDefault`: peça de visual volta ao padrão do slot (`null` no documento);
 * - `drop`: o item some (com aviso no resumo).
 */
export type ContentFallback =
  | { readonly policy: 'refuse' }
  | { readonly policy: 'replace'; readonly local: string }
  | { readonly policy: 'weaponCategory'; readonly local: string }
  | { readonly policy: 'slotDefault' }
  | { readonly policy: 'drop' };

export const CONTENT_FALLBACKS: Readonly<Record<ContentKind, ContentFallback>> = {
  mode: { policy: 'refuse' },
  map: { policy: 'refuse' },
  weapon: { policy: 'weaponCategory', local: 'pistol' },
  block: { policy: 'replace', local: 'missing' },
  bot: { policy: 'replace', local: 'normal-bob' },
  movement: { policy: 'replace', local: 'bobo' },
  hat: { policy: 'slotDefault' },
  skin: { policy: 'slotDefault' },
  prop: { policy: 'drop' },
  model: { policy: 'drop' },
};

/**
 * Como um ID local foi resolvido:
 * - `known`: existe no registro;
 * - `retired`: aposentado, `local` é o substituto;
 * - `fallback`: ausente, `local` é o substituto (`null` = padrão do slot);
 * - `dropped`: ausente, o item deve sumir;
 * - `refused`: ausente e o documento deve ser recusado.
 */
export type ContentResolution =
  | { readonly status: 'known'; readonly local: string }
  | { readonly status: 'retired'; readonly local: string }
  | { readonly status: 'fallback'; readonly local: string | null }
  | { readonly status: 'dropped' }
  | { readonly status: 'refused' };

/** A arma padrão de uma lista de armas que só citava armas desconhecidas (§14.5: "sem categoria conhecida, pistola"). */
export const DEFAULT_WEAPON_LOCAL = 'pistol';

/**
 * M10 (revisão): o id de arma que uma lista de armas guarda (`weapons.allowed`, a escada, as armas do time e as do
 * bot): o conhecido, o substituto do aposentado ou, ausente, a arma da categoria do prefixo (`shotgun.auto` numa versão
 * sem ela vira `shotgun`); sem categoria conhecida, `null` (o leitor descarta, com aviso).
 */
export function resolveWeaponId(local: string): string | null {
  const r = resolveContent('weapon', local);
  if (r.status === 'known' || r.status === 'retired') return r.local;
  if (r.status === 'fallback' && r.local !== null && local.startsWith(`${r.local}.`)) return r.local;
  return null;
}

/** Resolve um ID local (sem prefixo) de um tipo, aplicando aposentadorias e a política de fallback. */
export function resolveContent(kind: ContentKind, local: string): ContentResolution {
  const id = `${kind}:${local}`;
  if (isKnownContentId(id)) return { status: 'known', local };
  for (const retired of RETIRED_CONTENT_IDS) {
    if (retired.id === id) {
      const replacement = splitContentId(retired.replacedBy);
      if (replacement && replacement.kind === kind) return { status: 'retired', local: replacement.local };
    }
  }
  const fallback = CONTENT_FALLBACKS[kind];
  switch (fallback.policy) {
    case 'refuse':
      return { status: 'refused' };
    case 'drop':
      return { status: 'dropped' };
    case 'slotDefault':
      return { status: 'fallback', local: null };
    case 'replace':
      return { status: 'fallback', local: fallback.local };
    case 'weaponCategory': {
      const dot = local.indexOf('.');
      const category = dot > 0 ? local.slice(0, dot) : '';
      if (category !== '' && isKnownContentId(`weapon:${category}`)) return { status: 'fallback', local: category };
      return { status: 'fallback', local: fallback.local };
    }
  }
}
