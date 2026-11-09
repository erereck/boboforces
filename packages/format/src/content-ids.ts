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
