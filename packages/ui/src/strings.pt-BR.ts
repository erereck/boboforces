import type { ExtraStringKey } from './strings-extra.pt-BR.ts';
import type { OnlineStringKey } from './strings-online.pt-BR.ts';
import type { SwitchStringKey } from './strings-switch.pt-BR.ts';

/**
 * TABELA DE TEXTOS (decisão #14, regra 13). Todo texto de interface sai daqui, desde o primeiro dia.
 * Chaves estáveis em inglês com ponto (`area.item`); valores em pt-BR. Parâmetros entre chaves: `{name}`.
 * Nomes bobos de modos/armas/bots ficam em inglês (decisão #15); o resto da interface é pt-BR.
 * M9 (fase 0): esta é a tabela do MENU (o que aparece antes de qualquer outro pedaço chegar: título, Modos, Partida
 * Rápida, sofá, Novidades, loading). O resto mora nas tabelas que chegam depois (`strings-extra.pt-BR.ts`, com a cena
 * e os editores; `strings-online.pt-BR.ts`; `strings-switch.pt-BR.ts`, só no Switch): o menu da web tem teto de 350 KB.
 */
export const STRINGS_PT_BR = {
  /** Logotipo provisório em texto MSDF (o logo em blocos chega com o tools/logo). Grafia do logo: caixa alta. */
  'title.logo': 'BOBOFORCES',
  'title.credit': 'EriLab™ / Erick Luiz',
  'title.version': 'v{version} · {codename}',
  /** M1 (integração): item do título na web para andar no Construto sem bots (decisão 7 da integração). */
  'title.vitrine': 'Cena-vitrine',

  'menu.play': 'Jogar',
  'menu.settings': 'Ajustes',
  'menu.quit': 'Sair',
  'menu.modes': 'Modos',
  // Refino R3b (#79): no título, na grade de 2 colunas.
  'menu.couchShort': 'Sofá',
  // M5 (fase 4c): o botão do título que abre o Online (o resto dos textos chega com o pedaço dele).
  'menu.online': 'Online',
  'couch.title': 'Sofá',
  'couch.pitch': 'Até 4 jogadores na mesma tela, cada um com o seu controle (o teclado conta como um).',
  'couch.player': 'P{n}',
  'couch.join': 'Aperte A para entrar',
  'couch.joinKeys': 'ou Enter no teclado',
  'couch.p1': 'Escolhe a partida',
  'couch.side.with': 'Com o P1',
  'couch.side.against': 'Contra o P1',
  'couch.hint.side': 'Esquerda e direita: lado',
  'couch.hint.leave': 'Voltar: sai',
  'couch.tune': 'Mira {sens}× · {y}',
  'couch.tune.normal': 'Y normal',
  'couch.tune.inverted': 'Y invertido',
  'couch.hint.tune': 'Ombros: mira · Cima: Y',
  'couch.disconnected': 'Controle desconectado',
  'couch.device.keyboard': 'Teclado e mouse',
  'couch.device.keyboardOnly': 'Teclado',
  'couch.device.pad': 'Controle {n}',
  'couch.device.touch': 'Toque',
  'couch.match': 'Partida',
  'couch.start': 'Começar',
  // M4 (fase 1): o lobby da LOCAL EDITION (a casa do Switch).
  'lobby.pitch': 'Aperte A para entrar: até 4 no sofá, cada um com o seu controle.',
  'lobby.quitArmed': 'Aperte Sair de novo para fechar o jogo.',
  'menu.news': 'Novidades',
  // M2 (fase 4g): Novidades (codinome e até 5 itens de 1 linha, arte-ux.md §6.12).
  'news.version': 'Versão {version} · {codename}',
  'news.migrated': '{n} itens do save foram atualizados para o formato novo.',
  'news.ok': 'OK',
  'news.item.1': '8 armas, com granadas e lança-foguetes.',
  'news.item.2': 'Bots com 10 personalidades e jogo em time.',
  'news.item.3': 'Partida Rápida, Modos e Partida personalizada.',
  'news.item.4': 'Ajustes por dispositivo e botões remapeáveis.',
  'news.item.5': 'Estatísticas e recordes no fim das partidas.',
  'title.surprise': 'Surpreenda-me',
  // Resumo de um preset (título, sorteio, Partida Rápida).
  'summary.separator': ' · ',
  /** M8 (fase 5): no resumo (e no lobby online, pergunta Z4), o Diretor de Partida ligado. */
  'summary.director': 'Diretor ligado',
  'summary.teams': '{a} contra {b}',
  'summary.teamsShort': '{a}×{b}',
  'summary.ffa': '{n} bobos',
  'summary.timeOrScore': '{min} min ou {n} abates',
  'summary.time': '{min} min',
  'summary.score': 'até {n} abates',
  // M2 (fase 4d): Partida Rápida, Modos e presets de fábrica.
  'quick.title': 'Partida Rápida',
  'quick.mode': 'Modo',
  'quick.map': 'Mapa',
  'quick.level': 'Nível',
  'quick.size': 'Bots',
  'quick.minutes': 'Duração',
  'quick.bots': '{n} bots',
  'quick.noTime': 'Sem limite',
  'quick.start': 'Começar',
  'quick.shortcuts': 'Atalhos',
  'quick.recent': 'Últimas',
  'quick.favorites': 'Favoritos',
  'quick.factory': 'Prontos',
  'modes.title': 'Modos',
  'mode.name.warfare.tdm': 'Times',
  'mode.name.warfare.ffa': 'Todos contra todos',
  'mode.desc.warfare.tdm': 'Dois times; vence quem abater mais.',
  'mode.desc.warfare.ffa': 'Cada um por si, sem aliados.',
  // Refino R3b (#79): os dois cards novos dos Modos.
  'mode.desc.surprise': 'Modo, mapa e regras sorteados.',
  'mode.desc.custom': 'Todas as regras; salve como preset.',
  // M5 (fase 6a): o nome no card ("Partida personalizada" estourava o botão do card em 1280×720).
  'mode.name.custom': 'Personalizada',
  'preset.name.vibe': 'Vibe',
  'preset.name.tryhard': 'Tryhard',
  'preset.name.immortals': 'Imortais',
  // M3 (fase 6c): os presets de fábrica do Bobo Zombies.
  'preset.name.couchZombies': 'Sofá Zombies',
  'preset.name.zombiesBlitz': 'Zombies Relâmpago',
  // M2 (fase 4e): Partida personalizada.
  'menu.custom': 'Mais regras',
  'menu.back': 'Voltar',
  // M2 (fase 5a): a Oficina (biblioteca dos bots).
  'menu.lab': 'Laboratório',
  /**
   * M2 (fase 6c): o Meu Bobo (GDD §4.7.2). Os nomes de rosto e cabelo são os do FutBobo (`player-appearance.ts`),
   * na ordem dos índices do `FigureLook`.
   */
  'menu.bobo': 'Meu Bobo',
  // M6 (fase 0): o card que abre a página dos modos novos (o Bobo Training foi para lá).
  'mode.name.more': 'Mais modos',
  'mode.desc.more': 'Training, Domination e os de festa.',

  /** Tela de loading (etapas cronometradas no bench: `loading_ms`). */
  'loading.title': 'Carregando',
  'loading.step.assets': 'Arquivos',
  'loading.step.textures': 'Texturas',
  'loading.step.mesh': 'Malha',
  'loading.step.light': 'Luz',
  'loading.step.nav': 'Navegação',
  'loading.step.skins': 'Skins',
  'loading.step.shaders': 'Shaders',
  'loading.waiting': 'Na fila',
  'loading.percent': '{value}%',
  'loading.ms': '{value} ms',
  'loading.tip.coward': 'Bot covarde foge quando você recarrega.',

  /**
   * Os itens de teste do título (tecnico.md §24.2 itens 17–19), com os rótulos curtos da decisão #54: o Switch e a
   * prévia do título dele na web. As telas de teste em si estão na `strings-switch.pt-BR.ts` (M9, fase 0).
   */
  'title.tests': 'Testes',
  'test.item.bench': 'Bench',
  'test.item.benchDock': 'Bench 4P',
  'test.item.benchSolo': 'Bench 1P',
  'test.item.benchZombies': 'Bench zumbis',
  'test.item.benchStress': 'Bench 48 bots',
  'test.item.benchGpu': 'Bench GPU',
  'test.item.benchZombies20': 'Bench 20 min',
  'test.item.controllers': 'Controles',
  'test.item.keyboard': 'Teclado',
  'test.item.audio': 'Áudio',

  'level.vibe': 'Pela vibe',
  'level.chill': 'De boa',
  'level.normal': 'Normal',
  'level.sweaty': 'Suado',
  'level.tryhard': 'Tryhard',
  'mode.short.warfare.tdm': 'Times',
  'mode.short.warfare.ffa': 'Todos contra todos',
  'mode.short.warfare.domination': 'Domination',
  'map.construto': 'Construto',
  'map.ringue': 'Ringue',
  // M3 (fase 3d): o mapa pequeno do Bobo Zombies (nome provisório).
  'map.posto': 'Posto Avançado',
  // M3 (fase 5a): o mapa do Bobo Zombies (nome provisório, pergunta I1).
  'map.base': 'Base Abandonada',
  'map.airbase': 'Base Bobo',
  'map.island': 'Ilha Tropical',
  'mode.short.zombies': 'Zombies',
  'mode.name.zombies': 'Bobo Zombies',
  'mode.desc.zombies': 'Ondas de zumbis. Caiu? O colega levanta.',
  'summary.zombieWaves': '{n} ondas',
  'summary.zombieEndless': 'Sem fim',

  'device.rotatePhone': 'Gire o celular',
  'device.rotateHint': 'O BoboForces se joga com o celular deitado.',
  // M9 (fase 0, revisão): citadas pelo JS do menu (o size-check confere), então moram aqui.
  'lab.keyboardTitle': 'Nome do bot',
  'custom.saved': 'Salvo como {name}',
  'custom.full': 'A lista de presets está cheia: apague um para salvar outro.',
  'workshop.full': 'A Oficina está cheia ({n} bots).',
  'lab.seconds': '{n} s',
  'lab.test': 'Testar',
  'labIntro.title': 'Conheça o Laboratório',
  'labIntro.pitch': 'Monte bots nos 4 eixos: habilidade, inteligência, personalidade e regras.',
  'labIntro.later': 'Agora não',
  'lab.tested': 'Testado: o bot acertou {accuracy} · você {kills}/{deaths} · TTK médio {ttk}',
  'lab.saved': '{name} foi salvo na Oficina.',
  'lab.discardAsk': 'Mudanças sem salvar: aperte Voltar de novo para descartar.',
  'lab.typing': 'Digite o nome e aperte Enter (Esc desfaz).',
  'bot.card.skill': 'Habilidade: {level}',
  'bot.card.customSkill': 'ajustada',
  'bot.card.mind': 'Inteligência N{n} · {persona}',
  'bot.card.aim': 'Reação {reaction} ms · erro {error}° · cabeça {head}%',
  'bot.card.rulesLabel': 'Regras:',
  'bot.card.noRules': 'Sem regra especial',
  'rule.vision': 'visão {n}°',
  'rule.visionRange': 'alcance ×{n}',
  'rule.hearing': 'audição ×{n}',
  'rule.separator': ' · ',
  'rule.hp': '{n} de vida',
  'rule.damage': 'dano ×{n}',
  'rule.speed': 'velocidade ×{n}',
  'rule.only': 'só {list}',
  'rule.listSeparator': ', ',
  'rule.infiniteClip': 'pente infinito',
  'rule.infiniteReserve': 'munição infinita',
  'rule.headshotImmune': 'imune a tiro na cabeça',
  'rule.explodeOnDeath': 'explode ao morrer',
  'result.openLab': 'Abrir Laboratório',
  'mode.zombies': 'Bobo Zombies',
  // M9 (fase 3, revisão): também citadas pelo JS do menu (o Cenário, o teclado do nome do time, o sofá).
  'custom.scenario': 'Cenário',
  'custom.savedScenario': 'Cenário salvo: {name}',
  'custom.typing': 'Digite o nome do time e aperte Enter (Esc desfaz).',
  'mode.short.sandbox': 'Sandbox',
  'feed.teamName.0': 'Laranja',
  'feed.teamName.1': 'Azul',
  'feed.teamName.2': 'Verde',
  'feed.teamName.3': 'Roxo',
  // M10 (fase 8): as 4 cores de time a mais do Sandbox (pergunta AK6).
  'feed.teamName.4': 'Vermelho',
  'feed.teamName.5': 'Amarelo',
  'feed.teamName.6': 'Rosa',
  'feed.teamName.7': 'Ciano',
} as const satisfies Readonly<Record<string, string>>;

/**
 * As chaves das quatro tabelas: a do menu (esta), a que chega com a cena e os editores (`strings-extra.pt-BR.ts`), a
 * do Online (`strings-online.pt-BR.ts`, M5) e a do Switch (`strings-switch.pt-BR.ts`, M9).
 */
export type StringKey = keyof typeof STRINGS_PT_BR | ExtraStringKey | OnlineStringKey | SwitchStringKey;
