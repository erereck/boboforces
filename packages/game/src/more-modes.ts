import { builtinBotRef, MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import { modesScreen, type ModeCard, type UiNode } from '@boboforces/ui';
import { FORTRESS_MAPS } from './maps.ts';

/**
 * M6 (fase 0): a página "Mais modos" (o card dos Modos que entrou no lugar do Bobo Training). Mora no pedaço dos
 * editores, fora do menu da web (o menu está no teto de 350 KB): os cards, os textos (tabela extra) e a receita de cada
 * modo. Cada card começa direto, como o Bobo Zombies dos Modos; a Partida personalizada ajusta.
 */
export const MORE_MODE_CARDS: readonly ModeCard[] = [
  { id: 'training', nameKey: 'mode.name.training', descKey: 'mode.desc.training' },
  { id: 'warfare.domination', nameKey: 'mode.name.domination', descKey: 'mode.desc.domination' },
  // M6 (fase 2): os presets de festa.
  { id: 'gunGame', nameKey: 'mode.name.gunGame', descKey: 'mode.desc.gunGame' },
  { id: 'infection', nameKey: 'mode.name.infection', descKey: 'mode.desc.infection' },
  // M6 (fase 3).
  { id: 'juggernaut', nameKey: 'mode.name.juggernaut', descKey: 'mode.desc.juggernaut' },
  // M6 (fase 4).
  { id: 'chaos', nameKey: 'mode.name.chaos', descKey: 'mode.desc.chaos' },
  // M6 (fase 5).
  { id: 'paintball', nameKey: 'mode.name.paintball', descKey: 'mode.desc.paintball' },
  // M6 (fase 6a).
  { id: 'zombiesFortress', nameKey: 'mode.name.zombiesFortress', descKey: 'mode.desc.zombiesFortress' },
  // M6 (fase 6b).
  { id: 'zombiesArmed', nameKey: 'mode.name.zombiesArmed', descKey: 'mode.desc.zombiesArmed' },
  // M7 (fase 0).
  { id: 'juggernautFixed', nameKey: 'mode.name.juggernautFixed', descKey: 'mode.desc.juggernautFixed' },
  // M7 (fase 4).
  { id: 'strike', nameKey: 'mode.name.strike', descKey: 'mode.desc.strike' },
  // M7 (fase 8).
  { id: 'royale', nameKey: 'mode.name.royale', descKey: 'mode.desc.royale' },
];

/** M7 (fase 9): a ação do botão do Aquário na linha do título. */
export const MORE_WATCH_ACTION = 'more:watch';

/**
 * M11 (fase 5): os cards do aparelho: no PC, o card do Bobo Royale ganha o botão "Grande" (o Royale Grande, 48 no
 * Arquipélago; GDD §4.1.3: só PC). No celular e no Switch ele não aparece.
 */
export function moreModeCards(pc: boolean): readonly ModeCard[] {
  if (!pc) return MORE_MODE_CARDS;
  return MORE_MODE_CARDS.map((c) =>
    c.id === 'royale' ? { ...c, extra: { id: 'royaleGrande', textKey: 'mode.extra.royaleGrande' } } : c,
  );
}

/**
 * M7 (fase 9): a página com o liga/desliga do Aquário: ligado, o card escolhido começa só com bots, para assistir (o
 * Bobo Training continua sendo jogado). M11 (fase 5): `pc` = o aparelho é um PC (o botão do Royale Grande).
 */
export function moreModesRoot(watch: boolean, pc = false): UiNode {
  return modesScreen.build({
    modes: moreModeCards(pc),
    titleKey: 'modes.more.title',
    headingExtra: {
      kind: 'button',
      id: 'watch',
      text: { key: watch ? 'modes.watch.on' : 'modes.watch.off' },
      action: MORE_WATCH_ACTION,
      variant: watch ? 'primary' : 'secondary',
    },
  });
}

/** M6 (fase 2): a escada do Gun Game (GDD: 7 níveis com o arsenal do M2; a faca por último). */
export const GUN_GAME_LADDER = ['rifle', 'smg', 'shotgun', 'lmg', 'sniper', 'pistol', 'knife'] as const;

/** A receita de um card (o Bobo Training tem a dele, no `training.ts`); `null` = não é um card desta página. */
export function moreModePreset(id: string): MatchRecipe | null {
  const normal = builtinBotRef('normal');
  switch (id) {
    case 'warfare.domination':
      // GDD §4.1.2: 3 pontos, 200 pontos ou 10 min; 4 contra 4 no Construto (o único mapa com os pontos marcados).
      return {
        format: MATCH_RECIPE_FORMAT,
        mode: 'warfare.domination',
        map: 'construto',
        seed: 0,
        match: { timeLimitS: 600, scoreLimit: 200 },
        teams: [{ humans: 'all', bots: [{ ref: normal, count: 3 }] }, { bots: [{ ref: normal, count: 4 }] }],
      };
    case 'gunGame':
      // Todos contra todos com a escada; a reserva infinita (só a arma do nível na mão); até alguém fechar (10 min).
      return {
        format: MATCH_RECIPE_FORMAT,
        name: 'Gun Game',
        mode: 'warfare.ffa',
        map: 'construto',
        seed: 0,
        match: { timeLimitS: 600, scoreLimit: 0 },
        weapons: { ladder: [...GUN_GAME_LADDER], ammo: 'infiniteReserve' },
        teams: [{ humans: 'all', bots: [{ ref: normal, count: 7 }] }],
      };
    case 'infection':
      // Os Times com todo mundo de sobrevivente (o 1º infectado é sorteado na largada); 3 min.
      return {
        format: MATCH_RECIPE_FORMAT,
        name: 'Infection',
        mode: 'warfare.tdm',
        map: 'construto',
        seed: 0,
        match: { timeLimitS: 180, scoreLimit: 0 },
        infection: {},
        teams: [{ humans: 'all', bots: [{ ref: normal, count: 7 }] }, { bots: [] }],
      };
    case 'juggernaut':
      // A variante Rodízio (GDD §4.1.2): todos caçam (o time 0) e um sorteado começa Jugg (o time 1); 150 pontos (1 por
      // segundo de Jugg) ou 10 min.
      return {
        format: MATCH_RECIPE_FORMAT,
        name: 'Juggernaut',
        mode: 'juggernaut',
        map: 'construto',
        seed: 0,
        match: { timeLimitS: 600, scoreLimit: 150 },
        teams: [{ humans: 'all', bots: [{ ref: normal, count: 7 }] }, { bots: [] }],
      };
    case 'chaos':
      // Os Times de sempre (4 contra 4) com a Roleta: 3 modificadores, 1 troca por minuto; 50 abates ou 10 min. M10
      // (fase 4): na Estação Lunar, o mapa do Chaos no GDD (§4.6.4), com a gravidade da Lua de série.
      return {
        format: MATCH_RECIPE_FORMAT,
        name: 'Bobo Chaos',
        mode: 'warfare.tdm',
        map: 'moonbase',
        seed: 0,
        match: { timeLimitS: 600, scoreLimit: 50 },
        chaos: {},
        teams: [{ humans: 'all', bots: [{ ref: normal, count: 3 }] }, { bots: [{ ref: normal, count: 4 }] }],
      };
    case 'paintball':
      // GDD §4.1.2: 1 acerto derruba (configurável 1–3 no bloco), renasce em 1 s, 50 abates ou 5 min; 4 contra 4. M10
      // (fase 3): no Galpão de Paintball, o mapa dele.
      return {
        format: MATCH_RECIPE_FORMAT,
        name: 'Bobo Paintball',
        mode: 'paintball',
        map: 'paint-hall',
        seed: 0,
        match: { timeLimitS: 300, scoreLimit: 50 },
        players: { respawnS: 1 },
        weapons: { ammo: 'infiniteReserve' },
        paintball: {},
        teams: [{ humans: 'all', bots: [{ ref: normal, count: 3 }] }, { bots: [{ ref: normal, count: 4 }] }],
      };
    case 'zombiesFortress':
      // GDD §4.1.5: o Bobo Zombies com o gerador a defender (a Curta, 10 ondas). M11 (fase 3): na Fazenda à noite, o
      // mapa dele no GDD (§4.6.4), com o gerador na sala; o Posto Avançado (o do M6) segue na Partida personalizada, nos
      // recentes e no Surpreenda-me, como o Posto e o Construto do card do Bobo Zombies.
      return {
        format: MATCH_RECIPE_FORMAT,
        name: 'Bobo Zombies: Fortaleza',
        mode: 'zombies',
        map: FORTRESS_MAPS[0],
        seed: 0,
        match: { timeLimitS: 0, scoreLimit: 0 },
        zombies: { variant: 'fortress' },
        teams: [{ humans: 'all', bots: [] }],
      };
    case 'strike':
      // GDD §4.1.2: o BoboStrike 5 contra 5 na Base Bobo (MR12); você e 4 bots contra 5.
      return {
        format: MATCH_RECIPE_FORMAT,
        name: 'BoboStrike',
        mode: 'strike',
        map: 'airbase',
        seed: 0,
        teams: [{ humans: 'all', bots: [{ ref: normal, count: 4 }] }, { bots: [{ ref: normal, count: 5 }] }],
      };
    case 'royale':
      // GDD §4.6.4: o Bobo Royale Mini solo na Ilha Tropical, 24 participantes (você e 23 bots; o teto de bots do
      // aparelho corta no celular e no Switch com 2 ou mais, pergunta Y5).
      return {
        format: MATCH_RECIPE_FORMAT,
        name: 'Bobo Royale',
        mode: 'royale.mini',
        map: 'island',
        seed: 0,
        royale: { squad: 'solo' },
        teams: [{ humans: 'all', bots: [{ ref: normal, count: 23 }] }],
      };
    case 'royaleGrande':
      // M11 (fase 5): o Bobo Royale Grande solo no Arquipélago, 48 participantes (você e 47 bots; só no PC, onde o
      // `royaleGrandeMaxParticipants` do perfil vale 48: nos outros aparelhos a receita é recusada).
      return {
        format: MATCH_RECIPE_FORMAT,
        name: 'Bobo Royale Grande',
        mode: 'royale.grande',
        map: 'archipelago',
        seed: 0,
        royale: { squad: 'solo' },
        teams: [{ humans: 'all', bots: [{ ref: normal, count: 47 }] }],
      };
    case 'juggernautFixed':
      // GDD §4.1.2: a variante Fixo (rodadas de 3 min com rodízio, o "1 contra 3" do sofá) no Construto; com os 3 bots,
      // são 4 rodadas (quem entra no sofá toma o lugar de um bot).
      return {
        format: MATCH_RECIPE_FORMAT,
        name: 'Juggernaut Fixo',
        mode: 'juggernaut',
        map: 'construto',
        seed: 0,
        match: { timeLimitS: 0, scoreLimit: 0 },
        juggernaut: { variant: 'fixed' },
        teams: [{ humans: 'all', bots: [{ ref: normal, count: 3 }] }, { bots: [] }],
      };
    case 'zombiesArmed':
      // GDD §4.1.5: o Bobo Zombies com ondas de soldados (a IA do Warfare) na Base Abandonada, com as janelas abertas. A
      // horda são 12 bots do time 1: os 6 Chill entram primeiro (a horda reusa os de índice menor), os Normal aparecem
      // quando a onda deixa mais soldados em jogo; 2 bots Normal de apoio (no Switch e no celular, a horda cai para 10).
      return {
        format: MATCH_RECIPE_FORMAT,
        name: 'Bobo Zombies: Horda Armada',
        mode: 'zombies',
        map: 'base',
        seed: 0,
        match: { timeLimitS: 0, scoreLimit: 0 },
        zombies: { variant: 'armed' },
        teams: [
          { humans: 'all', bots: [{ ref: normal, count: 2 }] },
          {
            bots: [
              { ref: builtinBotRef('chill'), count: 6 },
              { ref: normal, count: 6 },
            ],
          },
        ],
      };
    default:
      return null;
  }
}
