# Changelog

Formato das versões lançadas (padrão gamebobo): `## X.Y.Z — Codinome — AAAA-MM-DD`. MAJOR = save ou conceito
incompatível; MINOR = sistema jogável novo; PATCH = correção. Versão, codinome e versões de formato ficam no
`version.json`. Pedidos de origem em `docs/PROMPTS.md`.

## [Não lançado] — 0.0.1 — Primeiro Bloco

### M12: o refino

- **Plano** em `docs/PLANO_M12.md` (#85): uma etapa só de refino do que já existe, achado por um levantamento com
  agentes lendo o código e jogando: a câmera e a arma na mão, a HUD, os menus, o som, o visual, a mira e o toque, e os
  bots, em frentes paralelas. Entrou junto o ajudante das entradas animadas da interface (`ui/src/motion.ts`).
  Perguntas AM1–AM11 no padrão.
- **A câmera e a arma na mão (fase 1):** a escada não salta mais, o pouso afunda a vista, correr e deslizar abrem o
  campo de visão, a cabeça balança no ritmo dos passos, a arma atrasa no giro, inclina de lado, abaixa na corrida,
  coiceia diferente em cada arma, sobe na troca, gira na recarga soltando o pente, estoca com a faca e acende com o
  clarão, cápsulas douradas pulam a cada tiro, levar dano dá um solavanco, o controle vibra no tiro e no abate, as
  luvas ficam na sua cor no FFA e no Royale, e "Reduzir efeitos" tira tudo isso.
- **A mira, o toque e o movimento (fase 6):** no ADS a sensibilidade acompanha o zoom de cada arma (a luneta não
  dispara mais na tela), no celular o ADS alterna, o polegar continua mirando no PULO e no ADS e o joystick vem atrás
  do dedo, a assistência de mira acompanha quem anda de lado sem puxar da cabeça para o peito e trava suave no Forte,
  pular correndo e segurar o agachar perto do chão sai deslizando, e no online a correção do próprio boneco desliza em
  vez de dar um tranco. O online foi para o protocolo 15.
- **O som (fase 4):** o seu tiro não cala mais o do inimigo, cada tiro e cada impacto soam um pouco diferentes, a
  parede abafa, o dano vem do lado de onde veio e o coração acelera com a vida baixa, a escopeta e a sniper engatilham
  e a recarga longa tem os seus estalos, a bala inimiga que passa perto zune, o plic e o abate sobem de tom na
  sequência, o pente avisa que está acabando e o colete quebra com som, correr pisa mais forte, a Boom Box bipa cada vez
  mais rápido e os pontos, a zona, as rodadas, a Roleta e o ping têm som, a vitória e a derrota ganharam vinhetas de
  3 s (e o empate a dele), o mundo abafa quando você morre ou leva uma explosão colada, o vento e os grilos tocam
  baixinho no mapa e os sons começam sem o atrasinho do MP3.
- **A HUD da partida (fase 2):** o X de abate com o nome de quem caiu e as sequências ("ABATE DUPLO", "VINGANÇA"), o
  hitmarker que dá para ver, a vida com rastro e vinheta quando está baixa, até 4 avisos de dano que giram com você, a
  munição que avisa quando acaba (com a barra de recarga e o "R recarrega") e que não fica mais embaixo do botão de
  pulo no celular, a sua linha destacada no kill feed, o placar com o seu time, avisos grandes de momento, a contagem
  com "VALENDO!", os pontos que sobem, uma tela de morte limpa em que a arma escolhida é a que nasce (e a seta segurada
  não escolhe mais por você), o colega caído marcado, a zona do Royale que não cobre a vida, o fim com faixa e câmera
  lenta, e um resultado que não some com o pulo da partida.
- **O visual (fase 5):** os bonecos correm de lado com as pernas viradas para onde vão em vez de patinar, a noite
  deixou de ter cantos em preto puro, armas, caixinhas, pinheiros e props ganharam sombra no chão (e a dos bonecos
  aparece de verdade), a explosão deixa marca chamuscada e levanta poeira com um clarão de verdade, pousos fortes e
  deslizes soltam pó do chão, o tiro na cabeça faz a cabeça voar com confete, a partida entra atrás de uma cortina, e o
  Meu Bobo respira, pisca e se monta de novo a cada peça trocada.
- **Os menus e o fluxo (fase 3):** um destaque só por tela, entradas secas nos menus e na pausa, "Sair da partida" em
  dois apertos e o Esc que volta um nível, o loading com o mapa, o resumo da partida e dicas que giram, toda tecla com
  resposta (Abrindo…, sem conexão, som na borda e no começar), a linha de ajuda da Mais modos, a Oficina que segue o
  foco, o +/Start que começa, a última escolha lembrada, "Personalizada" e "Oficina" com um nome só, "Reduzir efeitos",
  a Fortaleza com o mapa no nome, o Royale Grande no Surpreenda-me do PC e o logo em blocos no título, o mesmo da
  abertura.
- **Os bots percebem e miram como gente (fase 7a):** não miram em quem acabou de nascer, perdem você de vista quando
  você sai do campo de visão deles e levam um tempo visível para reagir, olham para de onde levaram tiro e para os
  cantos por onde você sumiu, não te enxergam agachado no capim alto, não descarregam o pente no vidro (e atrás de um
  muro baixo miram na cabeça), erram de um jeito que deriva e atrasa quando você troca de lado, revidam quem bate
  neles, atiram em rajadas de longe, não andam em fila indiana e vão atrás do barulho de tiroteio; o Pela vibe e o De
  boa não usam mais foguete, e o cone, o alcance, a audição e o conhecimento do Laboratório passaram a valer.
- **Download menor:** a primeira partida no navegador baixa uns 56 KB a menos, porque as versões reduzidas das
  texturas (as que o jogo usa ao longe) agora são calculadas no carregamento, idênticas às de antes, sem deixar o
  loading mais lento.

### M11: as pendências do M10 (fechado em 26/11/2026)

- **Plano** em `docs/PLANO_M11.md` (#84): os poleiros de pulo e o poço do Construto, os poleiros da Base Bobo, os
  bots que sobem aonde os 3 testes em espera pedem, o Fortress na Fazenda, os pickups de arma no mapa e o Bobo Royale
  Grande, em frentes paralelas. Perguntas AL1–AL3 no padrão.
- **O Fortress na Fazenda (fase 3):** o card da Fortaleza agora começa na Fazenda à noite, o mapa dele no GDD, com o
  gerador na sala da casa. O Posto Avançado continua na Partida personalizada (a linha Mapa troca de mapa sem perder o
  gerador), e o Surpreenda-me sorteia a Fortaleza nos dois mapas. Um golden novo acompanha o Fortress na Fazenda.
- **Os bots sobem aonde o mapa pede (fase 2):** o passeio dos bots escolhe um lugar alto (o deque, a passarela, o
  jirau, o 1º andar) em vez de um andar inteiro, e eles agora vão ao deque da antena da Estação Lunar (7 de 8
  sementes, antes 2) e à passarela do Galpão (8 de 8, antes 3). Os três testes em espera voltaram; nove goldens foram
  re-gravados.
- **O Bobo Royale Grande (fase 5):** o Royale de 48 participantes, só no PC, no Arquipélago (um mapa novo de 400 m: a
  ilha grande com a vila e 4 ilhas ligadas por baixios, com o farol, o porto, a fazenda e o acampamento), com a zona de
  6 fases (~12 min). Está no botão "Grande" do card do Bobo Royale (Mais modos) e na sala online com o host no PC (em
  duplas); o Aquário assiste. No celular e no Switch o botão não aparece, e um link ou um recente dele é recusado com
  aviso.
- **As armas no mapa (fase 4):** a regra "Primária: No mapa" (Partida personalizada, Surpreenda-me e presets): todo
  mundo nasce de pistola, faca e granadas e pega as armas espalhadas pelo mapa (passando por cima; a mesma arma enche a
  munição, outra se troca no Usar); a arma pega volta ao lugar 20 s depois, e o lugar vazio fica marcado com giz. Vale
  nos Times, no FFA, no Domination, no Sandbox e no Juggernaut; 61 armas em 7 mapas (o foguete, a sniper e o
  lança-granadas no meio). Os bots vão buscar as armas pesando o perigo. De quebra, a mão não vai mais para a granada
  depois de pegar uma arma do chão (também no Royale e no BoboStrike). O online foi para o protocolo 14.
- **Os poleiros de pulo do Construto e da Base Bobo (fase 1):** os lugares altos aonde só um pulo correndo levava (e
  aonde os bots e os zumbis não chegavam) foram fechados nos dois mapas. No Construto, a escada da torre ganhou tela
  dos dois lados (do alto dela se pulava para o telhado do Bloco Leste, com vista de 66 m), o poço ao lado dela, que
  prendia quem caía, virou maciço, e algumas pilhas de caixote e coberturas mudaram de altura ou ganharam degrau. Na
  Base Bobo, as pilhas de caixote que se escalavam foram para 2 m. Nenhum mapa fica mais marcado; os goldens com bots
  nos dois mapas mudaram.
- **Os consertos achados nos prints:** o gerador do Fortress aparece no chão (desde o M6, só a plaquinha aparecia); o
  botão "Grande" do Bobo Royale não cobre mais o nome do card; a vista geral do Arquipélago não sai mais cinza.
- **Fechamento do M11 (fase 6):** o portão verde, a rodada de prints 35 (os poleiros, as armas no mapa, o Royale
  Grande e o Fortress na Fazenda) e o custo medido (o Royale Grande no PERF §1s; o resto no ruído do M10). Os goldens
  com bots no Construto e na Base Bobo mudaram (os poleiros e o passeio por lugar); entraram três novos.

### M10: mapas e armas novos (fechado em 26/11/2026)

- **Plano** em `docs/PLANO_M10.md` (#83): os 5 mapas que faltam da lista do GDD (Porto de Contêineres, Canteiro de
  Obras, Galpão de Paintball, Estação Lunar e Fazenda à noite), 5 armas do arsenal futuro (DMR, revólver, escopeta
  automática, besta e lança-granadas) e as pendências do M9, em ondas paralelas. Perguntas AK1–AK6 no padrão.
- **O kit dos mapas novos (fase 0):** 38 blocos e 8 peças novos para os 5 mapas (contêineres, guindaste, asfalto,
  andaime, vigas, brita, grama sintética, rede, infláveis, regolito, painéis da estação, neon, celeiro, feno, milho,
  silo e trator), na paleta de sempre; os vermelhos e os amarelos ficaram escuros e foscos para não se confundirem
  com as cores de time. Ainda sem mapa: eles chegam nas fases 1 a 5.
- **O Canteiro de Obras (fase 2):** um prédio em obra de 3 andares com andaimes, vigas e o guindaste, para TDM, FFA e
  Sandbox; três rotas (o pátio de materiais, o prédio e o pátio do guindaste), seis subidas para o 1º andar.
- **As armas novas (fases 6 e 7):** o DMR "Pinpoint" (com luneta), o revólver "Hand Cannon" (secundária, no lugar da
  pistola), a escopeta automática "Leafblower", a besta "Twang" (o virote fica cravado na parede) e o lança-granadas
  "Bloop" (granada em arco que explode no contato). Estão no radial da morte (agora com 10 primárias), nas regras de
  arma, no Laboratório, na loja do BoboStrike e nas escadas de Gun Game feitas à mão; os bots usam todas quando uma regra
  dá. O online foi para o protocolo 13.
- **O Porto de Contêineres (fase 1):** um porto espelhado com pilhas de contêineres, o cais, o navio, o guindaste e o
  armazém, para TDM, FFA, Domination (3 pontos) e Sandbox; três rotas e a trilha por cima dos contêineres.
- **A Estação Lunar (fase 4):** uma base na Lua com a gravidade baixa em todo modo jogado nela (pulos de quase 3 m e
  sem dano de queda): o regolito com a cratera, a estação com o átrio e as passarelas, e a antena. TDM, FFA, Sandbox e o
  Bobo Chaos, que agora joga lá.
- **O Galpão de Paintball (fase 3):** um galpão coberto e colorido com infláveis, passarelas, a torre do juiz e a ponte
  rolante, espelhado, para o Bobo Paintball (o card do modo agora começa nele), o TDM e o Sandbox; as caixas de spawn
  ficam fechadas para tiro de fora.
- **A Fazenda à noite (fase 5):** o 2º mapa do Bobo Zombies (e do Fortress): a casa, o terreiro, o galpão, o celeiro com
  o jirau e o pátio dos silos, com 18 janelas, 6 portas pagas, armas na parede, a Caixa Misteriosa e 3 vantagens; os
  zumbis chegam no ritmo da Base Abandonada e não há lugar alto onde eles não alcancem.
- **Os bots sobem escada (fase 1c):** os bots passaram a subir escadas retas altas (antes, um lance de mais de 2,5 m os
  fazia desistir da rota: a torre do Construto, os mezaninos do Porto, o andar de cima da Lua) e sobem aos andares de
  cima de vez em quando. Os goldens com bots no Construto e na Base Bobo mudaram por isso. O compilador de mapas agora
  mede também os lugares aonde só um pulo correndo leva.
- **Os consertos do navegador:** o link de uma partida do Paintball (e de outros 5 modos) mostrava o nome do modo
  como código ("mode.paintball") até a partida carregar; agora todo modo tem o nome desde o menu. No Domination, os
  bots que ficam defendendo um ponto eram escolhidos de um jeito que dava mais defensores a um time no 5 contra 5;
  agora cada time tem a mesma parte (o golden do Domination mudou por isso).
- **Os poleiros de pulo (fase 10):** no Canteiro, na Estação Lunar e na Fazenda, os lugares altos aonde só um pulo
  correndo levava (de onde se via o mapa todo, e na Fazenda onde o zumbi não chegava) foram fechados: um pilar mais
  alto e uma tela na escada do andaime no Canteiro, muros e rochas mais altos na Lua, e o trator e os rolos de feno
  saíram dos campos da Fazenda.
- **Fechamento do M10 (fase 9):** o portão verde, a rodada de prints 34 (os 5 mapas e as 5 armas) e o custo de cada
  mapa novo medido (no ruído do Construto). Dos goldens de antes, só mudaram os que têm bots no Construto e na Base
  Bobo (os bots passaram a subir escada) e o do Domination (os defensores por time).
- **As pendências do M9 (fase 8):** a Base Aérea entrou no Sandbox (os times 2 e 3 nascem no chão, não mais em cima
  dos muros); no Sandbox, cada time pode escolher a cor entre 8 (as 4 de sempre e Vermelho, Amarelo, Rosa e Ciano),
  sem repetir, e o nome padrão do time segue a cor; e o ricochete ganhou o som dele (um "piiiu" sintetizado).

### M9: o Bobo Sandbox e os modificadores de tamanho (fechado em 20/11/2026)

- **Plano** em `docs/PLANO_M9.md` (#82): a dieta do menu da web, os modificadores Mini, Bots gigantes e Ricochete, o
  Bobo Sandbox completo e as Ferramentas do Dono. As frentes independentes andam ao mesmo tempo, cada uma num agente
  com a sua cópia do repositório. Perguntas AH1–AH8 no padrão.
- **A dieta do menu da web (fase 0):** o menu que abre o jogo ficou 18 KB menor (de 349,6 para 332,3 KB): os textos
  que só a partida e os editores usam, a tela de Configurações e o backup passaram a chegar junto com os editores,
  logo depois do título. Nada muda para quem joga.
- **Os modificadores Mini, Bots gigantes e Ricochete (fase 1):** no Mini, todo mundo fica com metade do tamanho (o
  alvo e a altura do olho junto); nos Bots gigantes, os bots ficam 3 vezes maiores, e debaixo de teto baixo o olho e a
  mira deles param no teto; no Ricochete, a bala e o chumbo da escopeta quicam 1 vez no cenário, com o dano pela
  distância toda. Ligam na Partida personalizada e caem na Roleta do Bobo Chaos. O online foi para o protocolo 11: quem
  estiver com a versão antiga precisa atualizar para entrar na sala.
- **Os gigantes debaixo do teto (fase 1b, pelos prints):** o gigante encolhe debaixo de teto baixo (e cresce de volta
  ao sair), em vez de atravessar a laje; a câmera da morte enquadra o gigante inteiro; o gigante colado em você não
  cobre mais a tela; o clarão do tiro acompanha o tamanho de quem atira; e o traço do ricochete ficou mais grosso e
  dura mais, para dar para ver.
- **O Sandbox na receita e na sim (fase 2):** cada time pode ter o próprio HP e as próprias armas, e o Sandbox tem o
  objetivo: Pontos (como o TDM), Eliminação (ninguém renasce; vence o último time de pé) ou Nenhum (o "brinquedo", que
  só termina pelo menu). Com 3 ou 4 times, os times sem base no mapa ganham uma casa longe das outras. Ainda sem tela:
  ela chega na fase 3.
- **O Sandbox no jogo (fase 3):** na Partida personalizada, o modo Sandbox (o último da linha Modo): a aba Times
  com 2 a 4 times, cada um com nome (o teclado do aparelho), bots, vida (1 a 1000) e armas (todas ou uma só), e qual
  é o seu time; a linha Objetivo (Pontos, Eliminação ou Nenhum); "Salvar Cenário" e o "Assistir". No Construto e no
  Ringue. O HUD, o placar do Tab, o resultado, o sofá e a sala online agora entendem até 4 times, com os nomes; na
  eliminação, quem cai fica "Fora até o fim da partida" e assiste um aliado vivo.
- **O Sandbox pelos prints (fase 3b):** na eliminação, o menu da arma da próxima vida some (não há próxima vida); nos
  outros objetivos (e em qualquer modo com a lista de armas da partida), ele só oferece as armas que o seu time pode
  pegar. O resultado põe o placar de quem venceu primeiro ("Lagartixas venceu · 4 × 2"), e a linha do nome do time
  não mostra mais setas que não faziam nada.
- **As Ferramentas do Dono na sim (fase 4):** criar um bot num ponto, tirar um bot da partida, congelar a IA dele,
  trocar o time, dar uma arma e ligar ou desligar um modificador no meio da partida, como comandos que valem no começo
  do próximo passo (gravados, para o replay). Ainda sem tela: o menu do dono chega na fase 5.
- **As Ferramentas do Dono no jogo (fase 5):** no Sandbox, o botão "Ferramentas do Dono" no canto da pausa abre a
  página: Criar bot (com o time), Trocar de time, Dar arma, Congelar/soltar, Tirar da partida, os Modificadores
  (liga e desliga no meio da partida) e a Câmera lenta (1×, 0,5× e 0,25×, só offline). A ferramenta escolhida fica
  armada na mira: o tiro aplica (o clique esquerdo, o gatilho direito, o botão Tiro) e a mira cancela. O jogo separa
  8 bots de reserva para o "Criar bot". No online, só o host usa, e o amigo vê tudo acontecer; o protocolo foi para 12.
- **Fechamento (fase 6):** dos goldens de antes, só o do Bobo Chaos mudou (a Roleta ganhou 3 modificadores); o
  Sandbox ganhou o dele. O protocolo do online foi a 12 e o snapshot da sim a 20 (só com as Ferramentas do Dono); o
  menu da web ficou em 332,9 KB (de 349,6). As rodadas de prints 32 e 33 mostram tudo, com as perguntas AH1–AH8 (do
  plano), AI1–AI4 e AJ1–AJ3.
- **As Ferramentas do Dono pelos prints (fase 5b):** o bot criado nasce num lugar que você vê, perto da mira (antes,
  às vezes, longe ou atrás de uma parede); o bot congelado ganha a plaquinha "CONGELADO" em cima da cabeça; os bots da
  reserva ganham nomes bobos diferentes; e o HUD sai de trás das páginas do dono.

### M8: compartilhar, o Diretor e o Arcade (fechado em 20/11/2026)

- **Plano** em `docs/PLANO_M8.md` (P-004, no padrão do #81): os códigos e os links da Oficina (bot e preset), os
  esquadrões, o Surpreenda-me completo (com o cadeado e a semente), o Nêmesis com memória, o Diretor de Partida, as
  ordens aos bots aliados e o perfil Arcade. O Bobo Sandbox e os modificadores Mini, Bots gigantes e Ricochete ficam
  para o M9. Perguntas Z1–Z6 no padrão.
- **O código comum (fase 0):** o formato dos códigos de compartilhar (o bot `BF1-`, o preset `BFP1-`, o esquadrão
  `BFS1-` e a semente `BFR1-`, até 4.000 caracteres) e dos links `#bot=` e `#p=`, a importação que valida e corta no
  teto do aparelho, e um filtro simples de nomes (pt-BR e inglês) para o que vem de outro aparelho. As armas das regras
  de um bot agora só aceitam armas que existem. Ainda sem tela: os botões chegam na fase 1.
- **A Oficina com códigos (fase 1, só na web):** o botão Compartilhar no card da Oficina e na Partida personalizada
  copia o código (`BF1-…` para o bot, `BFP1-…` para a partida) ou o link; "Colar um código" e o link aberto mostram o
  que veio (e o que mudou para caber no aparelho) antes de salvar o bot na Oficina ou jogar e salvar a partida.
- **Esquadrões (fase 2):** na Oficina, o grupo Esquadrões e o "+ Novo esquadrão": um nome e até 8 bots com quantos de
  cada ("The Jorges": 6 Jorges). Na Partida personalizada, um esquadrão vira o bot de um time. Compartilhar um esquadrão
  dá um código `BFS1-…` que leva os bots dele junto. Os esquadrões entram no backup.
- **O Surpreenda-me completo (fase 3):** sorteia entre os 14 modos, o mapa, as armas (às vezes uma só), até 3
  modificadores, o nível e até 2 bots estrela no time adversário. Cada linha tem cadeado: travada, o "Rolar de novo"
  não mexe nela. "Copiar código" dá um `BFR1-…` que, colado, joga a mesma partida.
- **O Nêmesis com memória (fase 4):** o bot que mais te pegou vira o seu rival entre partidas. Quando ele volta, a
  contagem do começo avisa ("Seu Nêmesis voltou: Jorge · te pegou 7, você 3"); no resultado, a rivalidade inteira.
- **O Diretor de Partida (fase 5):** na aba Bots da Partida personalizada, Relax, Equilibrado ou Desafio. A cada 30 s ele
  olha como você está indo nos últimos 3 min e mexe só na mira dos bots, 1/4 de nível por vez e até 1 nível; o placar
  mostra o ajuste ("Diretor: bots –½"). Desligado por padrão.
- **As ordens aos bots aliados (fase 6):** segure o aviso (o botão do meio do mouse, o D-pad de cima; no celular, o
  botão Ordens) e escolha na roda: Vem comigo, Segura aqui, Ataca ali ou Me cobre (Me revive no Zombies). Os bots
  N2 ou mais espertos obedecem conforme a lealdade, que o Laboratório agora mostra; a tela diz quantos obedeceram. O
  seu aviso também chama os bots espertos do time.
- **O perfil Arcade (fase 7):** mais rápido, pulo de 1,3 m com pulo duplo, bunny hop (+5% por pulo até 12 m/s),
  wall jump uma vez por parede, deslize que mantém o momento, atirar correndo e sem dano de queda. Na Partida
  personalizada, como perfil de movimento ou como modificador; os bots não fazem bunny hop nem wall jump.
- **Fechamento (fase 8):** os goldens de antes não mudaram no M8 (nem o Diretor, nem as ordens, nem o Arcade mexem na
  partida sem estar ligados), e o Arcade ganhou o golden dele; o protocolo do online foi a 10 e o snapshot da sim a 19; o menu da web ficou em
  349,6 KB (o teto é 350). As rodadas de prints 29 a 31 mostram tudo, com as perguntas AE1–AG4.

### M7: BoboStrike e Bobo Royale Mini (fechado em 19/11/2026)

- **Plano** em `docs/PLANO_M7.md` (decisão #81): o motor de rodadas (com o Juggernaut Fixo), o BoboStrike na Base
  Bobo, o Bobo Royale Mini na Ilha Tropical (24 participantes, loot, zona e o LOD C da IA) e o Aquário. O Bobo Sandbox
  completo fica para depois. Perguntas Y1–Y6 no padrão.
- **Rodadas e o Jugg Fixo (fase 0):** o card Jugg Fixo na página Mais modos (no Construto): rodadas de 3 min em que
  cada um é o Jugg uma vez, pela ordem (os humanos primeiro). A rodada começa com 3 s de largada parada; o Jugg que cai
  entrega a rodada aos caçadores e o que aguenta o tempo leva a dele; cada segundo de Jugg vale 1 ponto e, no fim, vence
  quem tem mais. No alto, "Rodada 2 de 4 · 2:31". A página Mais modos ficou mais junta para caber 4 linhas no celular
  (o Voltar vai para a última linha quando ela tem lugar).
- **Base Bobo (fase 1):** o mapa do BoboStrike, de dia: o hangar (site A, com metade do teto e luminárias) no noroeste,
  o pátio de carga (site B, a céu aberto, com contêineres) no nordeste, a pista no sul (onde os atacantes nascem) e o
  pátio dos defensores no norte, atrás de um QG. Três rotas (oeste, meio com a torre de controle, leste) e corredores
  curtos do meio para os sites; quebra-vistas em zigue-zague para nenhuma linha passar de 50 m. Já joga TDM (Partida
  rápida e personalizada).
- **BoboStrike na sim (fase 2, ainda sem card):** as rodadas MR12 (troca de lado na 6ª, vence quem fizer 7), a Boom Box
  (um atacante sorteado leva; largada ao morrer; plantar no site segurando o usar por 3 s; explode em 40 s; desarmar em
  7 s, ou 5 s com o kit), a compra nos 15 s da largada (pistola grátis; SMG e escopeta 1.200; fuzil 2.700; sniper
  4.500; colete 650 ou 1.000; granada 300; kit 400), a economia em faixas (vitória 3.000; derrota 1.900 mais 500 por
  derrota seguida, até 3.400; abate e plantar 300) e o colete (absorve metade do dano fora da cabeça). Quem sobrevive
  guarda o que tem; quem morreu volta só de pistola. Também pela rede.
- **A IA do BoboStrike (fase 3):** os bots compram pelo dinheiro (fuzil quando sobra para o colete, senão SMG; colete;
  kit na defesa; granada), os atacantes vão todos ao site sorteado da rodada e o portador planta; com a bomba no chão,
  o atacante mais perto vai buscar; os defensores se dividem pelos dois sites e, com a bomba plantada, vão todos a
  ela e o mais perto desarma.
- **BoboStrike (fase 4):** o card na página Mais modos (5 contra 5 na Base Bobo). Na compra, o anel com os 8 itens e os
  preços abre no meio da tela: a mira move o cursor e o tiro compra (no toque, tocar no item). No alto, o placar das
  rodadas e o relógio da rodada (o da bomba, depois de plantada), com "Rodada 3 · Compra", "Boom Box no A!" ou quem
  venceu embaixo; o dinheiro no lugar dos pontos. O portador no site vê "Segure usar: plantar"; o defensor perto da
  bomba, "Segure usar: desarmar"; plantando ou desarmando, os segundos que faltam no meio. A Boom Box (um rádio de
  brinquedo vermelho) aparece no chão e tem a plaquinha através das paredes (a largada só para o ataque). Quem morre
  vê a câmera de morte e, depois de 3 s, assiste um aliado vivo até a próxima rodada.
- **Ilha Tropical (fase 5):** o mapa do Bobo Royale Mini (~200 × 200 m, de dia): o mar raso em volta, a praia de
  areia, o morro com o farol ao norte, a vila de 10 casas em volta da praça, o píer e as barracas na praia, estradas de
  terra e 140 árvores; 52 pontos de loot e 41 largadas. Só joga o Royale (que chega na fase 6); por enquanto aparece no
  bench. O download do mapa é de 28 KB.
- **Bobo Royale na sim (fase 6, ainda sem card):** até 24 participantes em solo, duplas ou quartetos, sem respawn. Cada
  esquadrão começa num canto diferente da ilha, só de pistola; no chão há armas em 3 raridades (a rara e a épica com
  pente maior e menos recuo, o mesmo dano), coletes de 50 e 100, kits de cura e munição. Passar por cima pega; com a
  primária ocupada, o usar troca. Segurar o usar 3 s usa um kit (+60). A zona fecha em 5 fases (~8 min) e fere quem
  fica fora (2 a 40 HP/s). Em grupo, quem cai pode ser levantado pelo aliado. Vence o último esquadrão. Também pela
  rede.
- **A IA do Royale (fase 7):** os bots looteiam (a arma melhor, trocando no usar; o colete; os kits; a munição), vão
  para dentro da zona quando ela vai fechar, se curam escondidos e levantam o colega caído. No começo evitam briga e o
  item que outro bot já está pegando; com a zona fechando, ficam mais agressivos e vão atrás de onde ouviram tiro. Os
  bots longe de todo humano pensam menos (1 vez por segundo).
- **Bobo Royale (fase 8):** o card na página Mais modos (você e 23 bots na Ilha Tropical) e, na partida da sala, o
  Royale em duplas. A zona é uma parede translúcida que fecha; no alto, o relógio dela e quantos estão vivos; fora
  dela, a marca ZONA na borda da tela. As armas raras e épicas brilham no chão (azul e roxo) e têm o nome com a
  raridade; o colete e o kit de cura têm modelo próprio. O colete e os kits aparecem no lugar dos pontos; com uma arma
  no pé, "Usar: trocar por…". No fim, a colocação ("3º de 24").
- **Aquário (fase 9):** assistir uma partida só de bots em qualquer modo: o botão "Aquário" na página Mais modos e o
  "Assistir" da Partida personalizada. A câmera segue um bot (3ª pessoa), fica nos olhos dele, voa livre ou olha de
  cima; a roda troca o bobo, o Tab liga a lista grande. Na pausa, a velocidade (de 0,25× a 4× no PC; até 2× no celular e
  no Switch) e "Assumir o bobo": você entra no lugar dele, com a vida e a arma, e "Largar o bobo" devolve à IA. No fim,
  quem venceu, sem os seus números.
- **Fechamento do M7 (fase 10):** o portão verde, a rodada de prints 27 e o custo de cada card medido: o Royale com 24
  bots custa 0,05 ms por tick de sim + IA no PC (o TDM de referência, 0,04), o BoboStrike o mesmo que o TDM e o Jugg
  Fixo menos; no Eden, o Royale com 24 roda a 57–58 fps. O menu da web continua dentro do teto (348,4 de 350 KB).

### M6: modos de festa (planejado em 19/11/2026)

- **Plano** em `docs/PLANO_M6.md`: Domination, Gun Game e Infection, Juggernaut, os modificadores e o Bobo Chaos,
  Paintball e as variantes do Bobo Zombies (Armed Horde e Fortress), cada um sozinho com bots, no sofá, no online e no
  Switch. BoboStrike e Bobo Royale ficam para o M7. Perguntas U1–U6 no padrão.
- **Mais modos (fase 0):** nos Modos, o card do Bobo Training virou "Mais modos", a página dos modos novos (o Training é
  o primeiro card de lá). Ela mora fora do menu da web, que está no teto.
- **Domination (fase 1):** 3 pontos no Construto; captura em 5 s sozinho e em 2,5 s com 3; cada ponto rende 1 ponto
  por segundo; 200 pontos ou 10 min. Os bots jogam o objetivo: atacam os pontos do outro time, acodem o seu e um em
  cada três defende. No alto, as letras A, B e C na cor do dono com a barra da captura; em cima de cada anel, a letra; no
  kill feed, "Laranja capturou Ponto B". Também pela Partida personalizada e pela sala do Online (o protocolo subiu
  para 3). De quebra: os textos da Partida personalizada e da página nova ficavam crus antes da primeira partida no
  site (o empacotador descartava o registro da tabela), e agora não ficam.
- **Gun Game e Infection (fase 2):** nos cards da página Mais modos. No **Gun Game**, cada um só tem a arma do nível
  (fuzil, SMG, escopeta, metralhadora, sniper, pistola e faca); cada abate sobe um nível e troca a arma na hora, morrer
  pela faca desce um, e quem abate com a faca vence; o HUD mostra o NÍVEL. No **Infection**, um sorteado começa
  infectado (faca, mais rápido, a cara de bobo-zumbi), quem morre vira infectado, e o placar mostra quantos há de cada
  lado: os infectados vencem se não sobrar ninguém, os sobreviventes se aguentarem 3 min. Os bots jogam os dois.
- **Juggernaut (fase 3):** no card da página Mais modos (a variante Rodízio). Um sorteado começa como o Jugg: vida de 300
  por caçador (no mínimo 1000), mais lento, sem o dano extra na cabeça e com a **Big Brrt**, a minigun só dele (15 de
  dano, 1200 tiros por minuto, superaquece em 6 s de fogo e esfria parada; modelo e som novos). Quem dá o golpe final
  vira o próximo Jugg, e cada segundo de Jugg vale 1 ponto: vence quem chegar a 150 (ou quem tiver mais em 10 min). O
  Jugg aparece sempre na tela (a plaquinha JUGG vai para a borda quando ele está fora da vista) e o kill feed avisa
  quem virou o Jugg. Os bots caçam o Jugg em grupo, e o bot Jugg avança.
- **Bobo Chaos e os modificadores (fase 4a):** o card **Bobo Chaos** na página Mais modos (Times 4 contra 4 com a
  Roleta): 3 modificadores sorteados, e a cada minuto um sai e outro entra, com o aviso 5 s antes ("ROLETA: SAI
  PRESSA, ENTRA TUDO EXPLODE"). Os ligados aparecem embaixo do placar. São 9: **Lua** (gravidade 0,35x, sem dano de
  queda),
  **gravidade pesada** (1,8x: cai mais rápido, o pulo é o mesmo), **Pressa** (1,5x), **só na cabeça**, **um tiro mata**, **munição infinita** (sem
  recarga), **Vampiro** (o dano que você causa volta como vida), **Tudo explode** (quem morre explode: 60 de dano em
  3 m) e **troca de arma por abate**. A aba Modificadores da Partida personalizada liga cada um em qualquer modo, e a
  Roleta também. Online, a Roleta chega igual para todos (protocolo 4: quem está com o jogo velho vê "Atualize a
  página").
- **Mais 3 modificadores (fase 4b):** **Cabeção** (a cabeça de todo mundo, e o acerto nela, em dobro), **Invisíveis**
  (ninguém aparece, só por 1 s depois de atirar; os bots também não veem quem não atirou, a não ser de pertinho) e
  **Festa** (cada acerto solta confete). Entram na Roleta do Bobo Chaos e na aba Modificadores da Personalizada.
- **Bobo Paintball (fase 5):** o card na página Mais modos (4 contra 4 no Construto). Um acerto de tinta derruba
  (de 1 a 3 pela receita, no bloco `paintball`), renasce em 1 s, 50 abates ou 5 min. A primária escolhida vira a de tinta: o
  **Marcador** (automático), o **Pump** (no lugar da escopeta) e a **Sniper de tinta**, com a bola visível em voo e
  caindo com a distância; no lugar da granada, o **Balde de tinta**, que espirra em 3 m. Cada estouro deixa uma mancha
  na cor do time no chão ou na parede (até 96 no PC, 48 no celular e 32 no Switch; a mais velha some). Os bots
  adiantam a mira pela bola e pela queda.
- **Bobo Zombies: Fortaleza (fase 6a):** o card na página Mais modos (no Posto Avançado). Um gerador ao lado de onde os
  humanos nascem, com 4.000 de vida: metade dos zumbis vai nele, e cada um colado tira 20 por segundo (o chefão, 80).
  Segurar o usar perto conserta (60 por segundo). O gerador no zero perde a partida. A vida dele aparece na linha da
  onda ("Gerador 72%") e a plaquinha GERADOR fica sempre na tela. A página Mais modos passou a ter 3 colunas (são 9
  cards), com as frases mais curtas.
- **Bobo Zombies: Horda Armada (fase 6b):** o card na página Mais modos (na Base Abandonada). As ondas são de soldados
  com a IA do Warfare (12 bots: os 6 Chill entram primeiro, os Normal quando a onda deixa mais gente em jogo), contra
  você e 2 bots de apoio. As janelas ficam abertas (sem tábua): a horda entra por elas. A onda tem metade dos zumbis
  da onda normal (no mínimo 2), entra aos poucos (de 2 em jogo na 1ª onda a 6 na 10ª) e cada soldado tem 10% a mais
  de vida por onda; as armas da horda liberam com as ondas (SMG e fuzil, depois escopeta, metralhadora e sniper; a
  granada da 3ª onda em diante).
  Pontos, abates, drops, a loja e os perks valem como no Bobo Zombies; o Carpinteiro vira Munição Máxima. O Bobo
  Zombies deixou de ter escolha de time (no sofá e no online, todo humano fica do mesmo lado), e o recorde de onda é
  separado por variante.
- **Fechamento do M6 (fase 7):** o portão verde, a rodada de prints 23 e o custo de cada modo medido: nenhum modo novo
  pesa mais na sim + IA que o TDM ou o Bobo Zombies de antes (o mais caro, a Fortaleza, fica em 0,05 ms por tick no PC).

### M5: online P2P (planejado em 16/11/2026)

- **Plano** em `docs/PLANO_M5.md`: até 4 amigos na mesma partida pela web, cada um no seu aparelho, com os bots do
  host, sala por código ou link, sem servidor de jogo e sem conta. O Switch continua sem rede. Perguntas O1–O6 no
  padrão.
- **O protocolo, ainda sem rede (fase 1):** o pacote `net` com o handshake de versões (quem está na mais antiga vê
  "atualize"), o snapshot com delta e as entradas do cliente com as 3 anteriores repetidas. Numa rede de mentira com
  80 ms e 5% de perda, uma partida inteira entre o host e 3 clientes termina igual nos 4; o host manda ~6 KB/s para
  cada cliente com 8 bots. Nada disso aparece no jogo até a sala (fase 4).
- **Eventos (fase 2a):** tiros, acertos, mortes, sons e compras do host chegam ao cliente pelo canal confiável e saem
  junto com o boneco na tela (~8 KB/s por cliente com 8 bots, contando os snapshots).
- **Predição e interpolação (fases 2b e 2c):** o próprio boneco anda na hora, com o mesmo código do host, e se acerta a
  cada snapshot (erra mais de 10 cm em menos de 1% das vezes, fora o respawn); os outros aparecem 100 ms atrás, a 2 cm
  de onde o host os tinha.
- **O tiro no que você vê (fase 2d):** o host volta no tempo até o que o cliente via quando atirou (até 350 ms): a 80 ms
  de rede, mirando num boneco andando de lado, o cliente acerta 25 de 25 tiros (1 de 25 sem isso).
- **A rede de verdade (fase 3):** o Trystero (o mesmo do FutBobo, com as correções dele para o relógio do celular) e a
  sala por WebRTC, com um canal rápido que pode perder (entradas e snapshots) e um que não perde (eventos). Duas abas do
  Edge conectam em ~1 s e jogam uma partida inteira com o mesmo resultado. O online só baixa quando você abrir "Online"
  (a tela é a próxima fase).
- **A sala (fases 4a e 4b):** código de 5 letras e números (sem 0, O, 1 e I) e o link `#sala=`; o host recusa sala
  cheia, trancada ou com versão diferente, tira quem quiser e começa. Na partida, cada um joga no time que escolheu e
  quem sai vira bot.
- **As telas do Online (fase 4c):** o botão Online no título, o aviso de privacidade na primeira vez (texto ainda em
  revisão), o seu nome, Criar sala, Entrar com código (dá para colar o link inteiro) e a sala: os 4 lugares, o seu
  time, Copiar link e, para o host, Começar, Escolher partida (a Partida personalizada de sempre), Trancar e Tirar. Na
  partida os amigos aparecem com o nome deles, e no fim todo mundo volta à sala para a próxima. No celular, a
  Cena-vitrine saiu do título para o Online caber.
- **O link da sala (fase 4d):** quem abre o link que o host copiou cai direto no Entrar, com o código já posto.
- **Quando alguém some (fase 5a):** se o host sai da tela, os amigos veem "O host saiu do jogo"; no Bobo Zombies a
  partida espera, nos outros modos ela acaba em 10 s com o placar daquela hora. Quem fica 60 s parado (ou com a aba
  escondida) dá a vaga a um bot até voltar.
- **A queda e a volta (fase 5b):** se a conexão de um amigo cai no meio da partida, ele volta sozinho em até 20 s
  ("A conexão caiu: voltando à sala") e pega o boneco dele de volta, que estava com um bot. Quem o host tirou não
  volta naquela sala. Quando o host fecha a sala, ela acaba na hora para todos.
- **Versões diferentes (fase 5c):** quem está com o jogo desatualizado vê o botão Atualizar acender quando a versão
  nova chega; o host fica sabendo quando um amigo com outra versão tenta entrar.
- **Ping e emotes (fase 5d):** o botão do meio do mouse (ou o direcional para cima) marca onde você está mirando
  para o seu time; o B (ou o direcional para baixo) mostra um balão em cima do seu bobo: "Boa!", "Valeu!", "Bora!" ou
  "Ops!", um a cada aperto. Vale no online e no sofá.
- **A partida da sala (fase 6a):** o Escolher partida do host abre os cards da sala: Times, Todos contra todos, X1
  (1 contra 1 no Ringue), Bobo Zombies (todos juntos contra as ondas), Surpreenda-me e Personalizada. Cada amigo toma
  o lugar de um bot do time que escolheu. Pela rede de mentira, com os mapas de verdade, cada modo termina igual no
  host e no amigo. De quebra, os 6 cards dos Modos voltaram a caber: o "Partida personalizada" estourava o botão em
  1280×720 e, no celular, o título entrava na margem de cima (agora é "Personalizada", com os cards mais justos).
- **O host no celular (fase 6b):** quem cria a sala no celular joga com até 8 bots (16 zumbis), manda os snapshots a
  20 Hz (26% menos dados para cada amigo) e vê na sala "Você é o host: não troque de app durante a partida". Com um
  amigo no celular, a sala usa o teto do celular (12 bots, 24 zumbis, 90 m de visão): a partida escolhida perde bots
  do lado maior, e o host vê o aviso.
- **A prova dos modos (fase 6c):** as duas abas do Edge jogam o X1 no Ringue e depois o Bobo Zombies na Base
  Abandonada, escolhidos nos cards da sala, e voltam à sala entre um e outro. As descrições dos cards ficaram mais
  curtas: as do X1 e do Surpreenda-me passavam do card, e no Switch 4:3 as do Bobo Zombies e do Training também.
- **A rede à vista (fase 7a):** no online, o F2 ganhou a linha da rede: no host, o tempo da rede por quadro, o que
  sobe para cada amigo e os snapshots por segundo; no amigo, o que desce e sobe, o atraso e as predições erradas. A cada
  30 s de partida, uma linha `[rede]` com as médias vai para o "Copiar relatório" (é por ela que os números do teste
  com amigos chegam). E o `npm run bench:rede` mede o host com 8 e com 40 bots e o Bobo Zombies: no PC, a rede do host
  fica abaixo de 0,5 ms por quadro.
- **O roteiro do teste com amigos (fase 7b):** `docs/ROTEIRO_M5.md`, com o host no PC e no celular, cada modo, as
  quedas e o que mandar no fim. Para testar sem abrir o Online a todo mundo, o botão fica escondido no site: aparece
  com `?online` no endereço (o aparelho lembra) e para quem abre o link de uma sala.
- **A rodada 20 de prints (fase 7c):** a partida da sala, o Bobo Zombies online, o host no celular, a faixa do host
  ausente, ping e emote, a rede no F2 e os Modos mais justos, com as perguntas T1–T5 (como testar com os amigos, o X1,
  o menor teto da sala, os 20 Hz e o que vem depois).
- **O Online no ar (decisão #80, 19/11):** o botão Online aparece no título para todo mundo. Ainda sem TURN: parte das
  conexões 4G pode não entrar.
- **A prova (fase 4e):** duas abas do Edge, pelo teclado como um jogador, vão do título à sala, jogam pela rede e
  voltam à sala; pelos relays de verdade, o amigo entra em ~4 s.

### M4: o porte do Switch (planejado em 16/11/2026)

- **Plano** em `docs/PLANO_M4.md`: a LOCAL EDITION (abre direto no lobby "aperte A"), o save e os arquivos no SD
  (backup à vista e a pasta `oficina/`), o ciclo de vida, glifos genéricos e um teclado na tela próprio, o loading e o
  aquecimento que o Teste Zero deixou, o ícone e o NSP, e o Teste Zero 2 com o jogo inteiro no console. Perguntas
  P1–P9 no padrão.
- **LOCAL EDITION (fase 1):** no Switch o jogo abre direto no lobby "aperte A", sem título: o primeiro que apertar A é
  o P1; dali saem COMEÇAR, Modos, Surpreenda-me, Meu Bobo, Laboratório, Ajustes e Sair (com confirmação), e toda tela
  volta para ele com os mesmos jogadores.
- **Save e arquivos no SD (fase 2):** uma cópia do save por dia em `backup/` no cartão (ficam as 3 últimas) e a pasta
  `oficina/`: bots e presets feitos no PC entram na biblioteca do Switch ao abrir o jogo, sem duplicar nem passar
  por cima do que você mudou lá.
- **Ciclo de vida (fase 3):** a pausa ganhou a página **Jogadores**, que abre sozinha quando um controle cai e, no
  Switch, depois de trocar dock e portátil, do HOME e do sleep: A num controle livre fica no lugar de quem caiu (ou
  entra na partida), B no controle do P2 ao P4 sai do sofá, e a partida espera pausada. No Switch, a pausa mostra a
  bateria e a partida avisa uma vez abaixo de 20% sem carregar.
- **Teclado do jogo e glifo do botão (fase 4):** o nome do bot no Laboratório se digita só com o controle, num
  teclado na tela (letras, números e acentos; L apaga, R maiúsculas, B cancela) quando não há teclado do sistema, quando
  ele não abre, ou na web quando você está no controle. Nas dicas da partida, o botão aparece como uma cruz com o botão
  certo aceso, em vez do nome escrito.
- **Desempenho (fase 5):** o loading agora desenha uma vez cada efeito e cada boneco fora da tela, para o 1º tiro da
  partida não travar no console (+0,1 s de loading no Eden). No Switch, o "plano B" de render, que derrubou o console no
  Teste Zero, saiu.
- **Bench de 20 min (fase 7b):** na tela Testes do Switch, o "Bench 20 min" (Bobo Zombies na Base, 4 vistas), com a
  tendência do heap no relatório.
- **Preparação do console (fase 7):** no Switch, o heap vai para o `runtime.log` a cada minuto de partida, e o
  `docs/ROTEIRO_M4.md` junta o que testar quando o console voltar.
- **Ícone (fase 6a):** o NRO ganhou ícone próprio, um bobo de capacete em blocos (era o ícone padrão do nx.js).

### Refino antes do M4 (rodada 17 publicada em 16/11/2026)

Plano em `docs/PLANO_REFINO.md` (pedido do Erick, #79).

- **R1, atirar andando mais arcade:** o gatilho corta a corrida e o tiro sai quase na hora; a mira quase não abre
  andando e abre menos no ar; mirando anda mais rápido; no controle, correr alterna com o L3 e solta ao parar; a
  retícula não pulsa mais a cada passo. Goldens novos: Warfare `34edbf41`, Zombies `b4b81b30` e `d7ff9e30`.
- **R2, a granada:** o G (RB no controle, o botão do toque) agora joga granada de qualquer arma: segura para cozinhar,
  solta para jogar (antes o botão não fazia nada). Enquanto cozinha, a granada aparece na mão, o pavio na tela e o
  arco de onde ela vai cair. As granadas dos outros perto aparecem num anel em volta da mira. Dica nova nas primeiras
  partidas.
- **R3, menus mais claros (parte 1):** o título agora mostra tudo: JOGAR e, embaixo, Modos, Sofá, Meu Bobo,
  Laboratório e Ajustes (sai o "Mudar" e o menu do meio). Os Modos reúnem os jeitos de começar: Times, Todos contra
  todos, Bobo Zombies, Bobo Training, Surpreenda-me e Partida personalizada. A Novidades foi para Ajustes → Sobre, e
  os itens de teste ganharam uma tela própria.
- **R3, Ajustes mais claros (parte 2):** embaixo das linhas aparece uma frase dizendo o que a opção com o foco faz. A
  aba Vídeo virou Tela e junta tudo o que se vê: câmera (primeira ou terceira pessoa), ombro, campo de visão, tela
  dividida, qualidade, quadros e tamanho dos menus. O indicador de som foi para a Acessibilidade. As abas não passam
  mais da borda em celular pequeno.
- **R4, pausa e arma:** na pausa, "Ajustar desafio" virou Dificuldade e "Destravar" virou Estou preso, com uma frase
  explicando cada item. A arma em primeira pessoa ficou menor (jogando sozinho ou em dois), para não esconder quem
  vem pela direita; a mira continua no centro. No resultado, sem ninguém pontuar não há mais MVP. A Partida
  personalizada também explica cada regra embaixo das linhas.

### M3 Sofá e Bobo Zombies (fechado em 16/11/2026, #78)

Plano em `docs/PLANO_M3.md`. Publicado no Pages em 11/11/2026 (até a fase 7e), antes do roteiro com controles e do
checkpoint do Switch.

- **Fase 2a, o Bobo Zombies na sim:** ondas pela fórmula do GDD (quantidade, vida, quem corre), intervalo entre elas,
  o último zumbi correndo e marcado, vitória na última onda e derrota com todos mortos. O golden não mudou.
- **Fase 2b, pontos:** 500 no começo, 10 por acerto em zumbi, 60 por abate (100 na cabeça, 130 de faca), × a
  economia da partida.
- **Fase 2c, caído e reviver:** o bobo cai em vez de morrer, rasteja só com a pistola e sangra 30 s; o colega levanta
  segurando o usar por 3 s; sozinho, 3 "levanta sozinho" por partida; todos caídos = derrota.
- **Fase 2d, o Bobo Zombies no jogo:** card nos Modos (no Construto por enquanto), a onda e os zumbis no alto, os
  pontos na plaquinha, o aviso de caído e o resultado com a onda alcançada.
- **Fase 2e:** golden do Bobo Zombies (`eea4c1c8`) e o robô das ondas: 4 bots Normal chegam em média à onda 3,7, 1 bot
  à onda 2 (antes da IA de apoio da fase 3).
- **Fase 3a, caídos e apoio:** os zumbis ignoram quem está caído; os bots recuam atirando e levantam os colegas. Com 4
  bots, a onda média foi de 3,7 para 4,3.
- **Fase 3b, especiais e chefão:** Sprinter (rápido), Chonker (maior, explode em gosma ao morrer), Spitter (cospe de
  longe) e o Mega Bobo a cada 5 ondas (1,8× maior, 3000 de vida por humano); a hitbox cresce com o corpo.
- **Fase 3c, flow field:** os zumbis seguem um campo de direções compartilhado até o bobo de pé mais perto (com 60
  zumbis, metade do custo do A* por zumbi); o zumbi enroscado num canto volta a um ponto de nascer depois de 8 s.
- **Fase 3d, parte 1 (janelas e portas na sim):** janelas com 6 tábuas (o zumbi arranca 1 a cada 1,5 s, o chefão todas;
  segurar o usar de dentro repõe, 10 pontos por tábua até 50 por onda) e portas pagas que abrem colisão e caminho; os
  bots de apoio consertam janela quando não tem zumbi à vista. Ainda sem mapa nem desenho.
- **Fase 3d, parte 2 (o Posto Avançado):** mapa pequeno do Bobo Zombies (nome provisório) com 6 janelas e uma porta
  paga de 750 pontos; as tábuas e a porta aparecem no jogo, e o HUD avisa "Segure Interagir para consertar" e o preço da
  porta. O card do Bobo Zombies nos Modos agora abre nele.
- **Fase 3e, medição:** com 4 bots, a onda média é 4,0 no Construto e no Posto; golden novo do Bobo Zombies no Posto.
  Fecha a fase 3 (IA do Zombies).
- **Fase 4a, armas na parede:** no Bobo Zombies o humano nasce de pistola; armas na parede (no Posto: Buzzer,
  Door Knocker, Rattler e Lawnmower) com o aviso de compra no HUD; a mesma arma de novo recarrega pela metade do preço.
- **Fase 4b, Caixa Misteriosa:** 950 pontos, gira e oferece uma arma aleatória por 10 s; de vez em quando sai o ursinho,
  devolve os pontos e a caixa muda de lugar (3 posições no Posto).
- **Fase 4c, vantagens:** máquinas de Chonky Cola (vida 150), Speedy Soda (recarga rápida) e Buddy Brew (levanta o
  colega rápido); perdidas ao cair; as que você tem aparecem em cima da vida.
- **Fase 4d, drops:** 2% dos zumbis deixam um drop (até 4 por onda): munição cheia, bomba, pontos em dobro, insta-kill
  ou carpinteiro; o HUD anuncia e mostra o tempo que sobra.
- **Fase 4e, o Desmontador:** a arma maravilha (nome provisório), uma pistola de raio que só sai da Caixa Misteriosa
  (~5% por giro): um raio verde que estoura e desmonta os zumbis em volta. Fecha a fase 4 (economia).
- **Fase 5a, a Base Abandonada:** o mapa do Bobo Zombies, à noite: QG, Refeitório, Pátio com a torre de rádio e Garagem
  com o jipe, ligados por portas pagas, com janelas, armas na parede, a caixa e as vantagens. Agora é ela que abre no
  card do Bobo Zombies. Os zumbis não usam mais uma sala fechada como atalho.
- **Fase 5b, os zumbis por tipo:** o Sprinter de agasalho e faixa na testa, o Chonker de colete de obra com a barriga
  de gosma, o Spitter de capa de chuva e o Mega Bobo de farda de oficial: cada especial com a roupa e o rosto dele.
- **Fase 5c, leitura à noite:** contorno de giz nas armas da parede, a Caixa Misteriosa clara no escuro, a gosma do
  Chonker em cubinhos verdes e faíscas verdes no raio do Desmontador.
- **Fase 5d, rodada 14 dos prints:** o Bobo Zombies (Base Abandonada, janelas e portas, compras, os zumbis por tipo,
  leitura à noite), com as perguntas K1–K7. Fecha a fase 5.
- **Fase 6a, resultado e recordes do Bobo Zombies:** tela de resultado própria, com a onda, a configuração, o recorde
  de onda (por mapa, regras e número de jogadores) e uma linha por bobo do time (pontos, abates, na cabeça, quantas
  vezes caiu e quantos levantou). A aba Dados mostra a melhor onda. O Zombies não mexe mais nos recordes de abates e
  de sequência.
- **Fase 6b, a Partida personalizada do Bobo Zombies:** o modo da Partida personalizada vai de Times a Todos contra
  todos e ao Zombies. Com o Zombies, as abas mostram as regras do modo: duração, quantidade, velocidade e vida dos
  zumbis, especiais, chefão, pontos, "levanta sozinho" e de 0 a 3 bots de apoio. "Mudar regras" no resultado do
  Zombies abre essa tela.
- **Fase 6c, presets de fábrica do Bobo Zombies:** Sofá Zombies (10 ondas; 3 bots de apoio que saem quando mais gente
  entra no sofá) e Zombies Relâmpago (5 ondas), na Partida Rápida e na tela do sofá.
- **Fase 6d, os sons do Bobo Zombies:** gemidos dos zumbis (o Sprinter mais agudo, o Chonker mais grave), o rugido do
  Mega Bobo, a gosma e o cuspe, tábuas arrancadas e repostas, a porta paga, a compra e o "sem pontos", a caixa de
  música da Caixa Misteriosa e o ursinho, a vantagem, os drops, o sino do começo da onda e a vinheta do fim, e o som de
  quem levantou.
- **Fase 6e, a música do Bobo Zombies:** duas camadas provisórias compostas em código, uma marcha de brinquedo
  assombrada. A calma toca entre as ondas. Durante a onda, com "Música na partida" ligada, a horda entra por cima
  conforme os zumbis chegam perto (e enche com o chefão). No resultado volta a música do menu.
- **Fase 6f, rodada 15 dos prints:** o resultado, a Partida personalizada e os presets do Bobo Zombies, com os sons e a
  música para ouvir, e as perguntas L1–L6. Fecha a fase 6.
- **Fase 7a, minimapa:** na tela dividida de 3, o quadrante livre mostra o mapa visto de cima, com as portas
  fechadas, a caixa, os zumbis, os aliados e cada jogador na sua cor; o placar sobe para o alto do quadrante.
- **Fase 7b, bench com 4 vistas:** o bench ganhou o Bobo Zombies na Base (`scene=zombies`). Na RTX 2050, as 4 vistas
  ficam em 60 fps com 40 zumbis vivos e também com 24 bots no Construto.
- **Fase 7c, as 10 ondas do começo ao fim:** um robô leva partidas da Base até a vitória na 10ª onda, com os
  especiais e os dois chefões, sem travar. No caminho: os bots de apoio ficavam só na faca lá pela onda 8 (não compram
  munição); agora, no Bobo Zombies, eles não gastam a reserva. Goldens do modo novos: Construto `dd27cd5e`, Posto
  `62251b7e`.
- **Fase 7d, portão e roteiro:** o portão inteiro do marco verde (testes, builds, portcheck estrito, size-check, smoke
  da web e balance) e o `docs/ROTEIRO_M3.md` com o teste de controles no PC e o checkpoint do Switch.
- **Fase 7e, rodada 16 dos prints:** o Bobo Zombies no sofá com 2, 3 e 4 e o minimapa, com as perguntas M1–M4, e o
  NRO do M3. Falta o roteiro com controles de verdade e o Switch com 4 controles.

- **Fase 1a, assentos na partida:** cada jogador local tem um dispositivo e um lado (com o P1 ou contra); os humanos
  tomam o lugar de bots do próprio time, e os times mantêm o tamanho.
- **Fase 1b, a tela "Jogar no sofá":** no menu principal; até 4 jogadores, cada um com o seu controle (o teclado conta
  como um). Cada um entra com o A, escolhe o lado e sai com o voltar; o P1 escolhe a partida e começa. No Switch, o
  mesmo caminho substitui o teste do sofá automático.
- **Fase 1c, entrar no meio e sair:** numa partida do sofá, segurar A por 1 s num controle livre entra no lugar de um
  bot (a tela se divide); o + de cada jogador abre a pausa dele, com Sair do sofá (um bot assume). Controle
  desconectado pausa e avisa até voltar.
- **Fase 1d, as vistas:** o colega de time local aparece com o símbolo e a cor dele em cima da cabeça; o radial da arma
  vale para todos; com 2 jogadores, dá para dividir lado a lado (Ajustes → Vídeo → Sofá com 2).
- **Telas de edição fora do menu:** Partida personalizada, Laboratório e Oficina chegam num pedaço à parte, logo depois
  do menu (o menu baixou 4,3 KB).
- **Fase 1e, por jogador:** cada jogador 2–4 ajusta a mira e o Y invertido na tela do sofá, pelo próprio controle; os
  controles vibram com dano, morte e explosão perto (Ajustes → Acessibilidade → Vibração).

### M2 MVP web solo (em construção)

Plano em `docs/PLANO_M2.md`; escolhas do Erick nas #61 (nomes como estão), #62 (Meu Bobo militar + fantasias bobas),
#63 (Kenney + música de menu CC0) e #64 (partida primeiro).

- **Fase 1a, as 8 armas na sim:** pistola, SMG, fuzil, escopeta, sniper, lança-foguetes, faca e granada (mais a LMG de
  reserva) com os números da `gameplay.md` §4.3, num código estável por arma. Cada bobo nasce com primária, pistola,
  faca e 2 granadas, com munição por slot. A primária do próximo spawn vai no `InputFrame.primary`.
  - Escopeta com 8 chumbos somados por alvo e recarga por cartucho; faca a 2 m (100 pelas costas); sniper que espalha
    muito sem zoom; ADS com tempo de entrada e zoom por arma; padrão fixo de recuo.
  - 12 testes novos de armas. Golden `81150d3b` (era `cb50303f`): o estado mudou e o recuo do fuzil ganhou o padrão
    (`ARCHITECTURE.md` §12).
- **Fase 1b, projéteis e explosões na sim:** o foguete voa reto e explode no contato (120 no acerto direto, área de
  100 → 0 em 4 m). A granada quica, explode no pavio de 2,5 s e dá para cozinhar; se o pavio acabar na mão, explode
  ali. Explosões respeitam paredes e tiram 50% de quem lançou. 7 testes novos. Golden `28969b8b`, com o mesmo combate:
  só o estado ganhou o pool de projéteis.
- **Fase 1c, armas na tela:** modelos da SMG, da escopeta, do lança-foguetes, da faca, da granada, da LMG e do foguete
  em voo. Foguetes e granadas em voo, explosão com clarão, fogo, faíscas, fumaça e cubinhos, rastro do foguete e tremor
  de câmera. O zoom do ADS é o da arma (sniper 4x, com o viewmodel escondido na luneta). Nenhum programa de shader novo.
  O bench aceita `weapons=` (`mix` dá armas variadas aos bots), e o relatório diz `armas=`.
- **Fase 1d, a IA usa as armas:** cada bot sorteia a primária pela semente (fuzil, SMG, escopeta, LMG, sniper ou
  foguete) e usa cada uma do jeito dela.
  - Chega perto com a escopeta e a SMG e fica longe com a sniper.
  - A sniper só atira com a luneta; o foguete mira no pé, adiantado.
  - Troca para a pistola sem munição ou com o alvo perto demais para o foguete e a sniper, e para a faca colado.
  - 6 testes novos. O balance segue em ordem. Golden `b66afdf7`. O bench continua no fuzil por padrão.
- **Fase 1e, HUD das armas:** "Rattler · Fuzil" em cima da munição e as granadas ao lado. A faca não mostra munição e a
  granada na mão mostra quantas sobram. Mira em ponto para faca, granada e sniper, e cruz que abre com a dispersão da
  arma. Luneta blocada da sniper com retícula e ponto vermelho, com as plaquinhas por cima. Correções: o foguete não
  tapa mais a câmera de quem atira, e a sniper e o clarão da explosão ficaram menores. 4 testes novos de HUD.
- **Fase 1f, prints das armas (rodada 5):** `npm run prints -- --so rodada5` gera 12 cenas: o arsenal em linha (de
  frente, a 3/4 e mirando), três pares a 1 m e a vista do jogador com HUD, uma por primária. O gancho de debug ganhou
  `setViewmodelVisible`, e o lança-foguetes, a LMG e a sniper ficaram menores e mais para o lado na mão. Explosão e
  luneta vão como capturas ao vivo. Aprovada no padrão (#65), o que fecha a fase 1.
- **Fase 2a, regras da partida na sim:**
  - **Contagem de 3 s** (fase `warmup`): dá para olhar em volta, mas não andar nem atirar, e o relógio fica parado.
    O padrão da sim é sem contagem; a partida liga a contagem junto com a HUD dela (2d).
  - **Morte súbita:** empate no fim abre 60 s, e o primeiro abate que desempata encerra. **Vencedor do FFA** é o bobo.
  - **Assistências:** 25 de dano ou mais nos últimos 10 s. O plano de morte credita o abate a quem feriu a vítima nos
    5 s antes; sem ninguém, é acidente.
  - **Spawn pontuado:** no FFA, longe (mais de 20 m) e fora da vista dos inimigos; no TDM, o ponto do time com menos
    inimigos à vista.
  - 11 testes novos. Golden `b26c3ec1`, com o mesmo combate (só o estado mudou); balance igual.
- **Fase 2b, caixinha de munição e Destravar:**
  - **Caixinha:** quem morre no Bobo Warfare deixa uma lata de munição oliva, que cai até o chão, gira devagar, pisca
    nos últimos 3 s e some em 20 s. Quem passa por cima ganha 1 pente da primária e da pistola e 1 granada, até o
    máximo de cada; com tudo cheio, ela fica. Modelo novo `model:ammo-box`, desenhado no mesmo conjunto instanciado
    das armas (sem programa de shader novo).
  - **Destravar:** botão novo do frame. Leva o bobo ao nó de navegação livre mais perto, a pelo menos 2 m; o bot
    escolhe um nó fora da vista dos humanos e, na 3ª vez na mesma vida, renasce num spawn. O ponto vai para o log de
    avisos (o relatório do F2). O humano ganha a opção na pausa (2e).
  - **Bot parado:** 8 s sem andar 2 m nem chegar 1 m mais perto do objetivo, fora de combate, aperta Destravar.
  - **HUD:** com a faca, o nome da arma ficava em cima do ícone das granadas; agora fica sempre na mesma altura.
  - 9 testes novos. Golden `d0ba0eca` (os bots pegaram 4 caixinhas e não precisaram do Destravar); balance igual.
- **Fase 2c, tela de morte:**
  - **Câmera de morte:** sobe um pouco e vira em meio segundo para quem matou, com ele acima da contagem; sem
    matador, fica onde estava.
  - **Faixa:** "ABATIDO POR Normal Bob · Rattler · 57 HP" (os bots usam o nome do nível, #61, até os bots de fábrica
    da fase 3), ou só a causa: "Caiu no vazio", "Queda", "Foi você mesmo".
  - **Menu da primária** em volta de "RENASCENDO… 3": anel com as 6 primárias quando cabe (1280×720 e o celular
    deitado), fileira nas vistas baixas e "« arma »" no 3–4P. Escolhe pela direção do mouse ou do analógico, pela roda
    ou pelos botões de troca de arma, ou tocando. A escolha vai no `InputFrame.primary` e vale no próximo spawn.
  - **"Tá puxado? Pausa » Ajustar desafio"** na faixa, 1 vez por partida, depois de 5 mortes seguidas sem abate ou
    perdendo por 50% da metade da partida em diante.
  - Morto, a HUD esconde a munição e o nome da arma. 17 testes novos. A sim só passou a mostrar
    `SimView.respawnTicks`: o golden não mudou.
- **Fase 2d, HUD da partida:**
  - **O JOGAR segue o GDD:** TDM com 75 abates ou 10 min, e contagem de 3 s ("3", "Hoje: 6 × Normal Bob"), em que
    dá para olhar em volta mas não andar.
  - **Placar no alto com o relógio** e "MORTE SÚBITA" embaixo dele na prorrogação.
  - **Kill feed** no canto de cima à direita: "Normal Bob Rattler P1" nas cores dos times, a arma em âmbar no tiro de
    cabeça, até 5 linhas por 6 s.
  - **Placar no Tab** (Select no controle): uma tabela por time com abates, mortes e assistências; a sua linha em
    âmbar.
  - **Marcadores dos aliados:** chevron na cor do time em cima da cabeça, através das paredes, até 80 m.
  - O indicador direcional de dano já existia desde o M1. A faixa listrada no limite fica para o primeiro mapa aberto
    (o Construto é fechado por paredes).
  - 9 testes novos.
- **Fase 2e, pausa e resultado:**
  - **Pausa completa:** Continuar · Ajustar desafio · Ajustes · Destravar · Sair. "Ajustar desafio" troca na hora o
    nível dos bots adversários (os 5 níveis rápidos). "Ajustes" abre a tela de ajustes, que por enquanto está vazia.
    "Destravar" leva você ao ponto livre mais perto.
  - **Resultado** 2,5 s depois do fim: vitória, derrota ou empate e o placar; o nível dos bots; MVP; Nêmesis (com
    "Salvar na Oficina", desligado até a fase 5); Freguês; abates, precisão e maior sequência; e até 3 prêmios bobos,
    um por bobo (Mira torta, Kamikaze, Mais covarde, Garçom das assistências, Imortal de verdade).
  - **Botões do resultado:** De novo, Mais fácil, Mais difícil e Sair (Mudar regras e Salvar preset desligados até a
    fase 4). Depois de uma derrota feia, o foco começa em "Mais fácil". Os botões recarregam o JOGAR com semente nova
    e o nível um passo abaixo ou acima.
  - Com o resultado na tela, a HUD sai.
  - 7 testes novos.
- **Fase 2f, prints da rodada 6:** página com capturas ao vivo (`local/m2/montar-pagina-r6.mjs`) da tela de morte,
  da HUD da partida, da pausa, do resultado e da caixinha, com as perguntas B1–B6. Aprovada no padrão (#66), o que fecha
  a fase 2.
- **Fase 3a, o `bot@1`:**
  - **O formato do bot** com os 4 eixos do Laboratório: habilidade, inteligência (o nível e os comportamentos), personalidade e regras. O validador limita cada valor à faixa, com aviso.
  - **Os 12 bots de fábrica:** os 5 níveis e Jorge the Immortal, Camper Carl, Knife Ninja, Scaredy Sam, Hunter
    Hank, Buddy e Goofy Gus.
  - **A receita valida os bots embutidos.** A IA passa a ler o bot pelo documento, e os bots de nível sorteiam a
    personalidade da mistura (50% Equilibrado, 20% Rusher, 15% Camper e 15% Estrategista).
  - Os nomes saem da tabela de textos.
  - O golden não mudou.
  - 6 testes novos.
- **Fase 3b, regras por bot na sim:**
  - Vida própria (o Jorge tem 500), multiplicador de dano e velocidade.
  - Munição infinita (no pente ou na reserva).
  - Armas permitidas: o que não está na lista sai do loadout (Knife Ninja só com faca, Jorge só com a Door Knocker).
  - Imunidade a tiro de cabeça e explosão ao morrer.
  - O golden não mudou. 8 testes novos.
- **Fase 3c, inteligência N1:**
  - O bot sabe de onde tomou dano e vira para lá.
  - A partir do N1, decide pela personalidade se corre para uma cobertura: um ponto perto, do lado oposto, fora da vista
    de quem atirou. Lá fica agachado um tempo (mais com paciência), recarrega e atira de lá. Com o pente vazio no meio
    do tiroteio, também busca cobertura para recarregar.
  - Patrulhando, olha para os lados de tempos em tempos.
  - O balance segue em ordem. Golden `c3f257c6`: menos tiros, porque os bots se escondem.
  - 1 teste novo, que falha sem a cobertura.
- **Fase 3d, inteligência N2:**
  - **Segura o ângulo:** quando o alvo some, fica um tempo mirando onde ele sumiu (mais tempo com paciência).
  - **Flanqueia:** passa por um ponto de lado antes de voltar à caça.
  - **Recua:** com a vida baixa, foge para longe e fora da vista e espera regenerar.
  - **Joga granada** em quem se escondeu a 7–25 m: troca de arma, mira o arco certo, cozinha o que o voo deixa e
    solta.
  - O balance segue em ordem. Golden `856785f5` (8 granadas em 60 s).
  - 2 testes novos (o da granada falha sem o uso de granada).
- **Fases 3e e 3f, inteligência N3 e N4:**
  - **N3, o time:**
    - Quem vê um inimigo avisa o time; os aliados sem pista vão atrás do aviso, e o humano aliado vê um losango âmbar
      no lugar.
    - Os bots andam em dupla ou trio, seguindo o objetivo de um líder.
    - No cerco, cada um flanqueia para o lado do seu número.
  - **N4, o leitor:** aprende na partida, num mapa de calor de 4 m que esquece pela metade a cada minuto, onde os
    humanos ficam e de onde matam. Com isso:
    - vai caçar lá e pré-mira lá;
    - joga granada lá;
    - evita passear onde o time dele morreu;
    - às vezes finge recuar para emboscar.
  - Os bots do golden (Normal, N2) não mudam. O balance segue em ordem.
  - 3 testes novos.
- **Fase 3g, personalidades e bots de fábrica:**
  - **As 10 personalidades se veem em jogo** (gameplay.md §6.4):
    - Rusher corre até o contato, atira andando e pula muito;
    - Lunático troca de intenção a cada 2–5 s e às vezes atira pro alto;
    - Covarde mantém distância, foge com 60% de vida gritando por ajuda e às vezes finge de morto;
    - Camper segura um ponto alto, agachado, até 2 abates ou até ser descoberto;
    - Estrategista flanqueia mais e anda com o time;
    - Kamikaze persegue o humano e, com granada, se explode;
    - Caçador persegue o humano com mais abates;
    - Suporte segue o humano aliado, vigia as costas dele e vai atrás de quem atirou nele;
    - Palhaço dança depois do abate;
    - todos dão pulinhos conforme a bobeira.
  - **Loadout restrito:** a IA usa só a arma que tem (Knife Ninja na faca, Jorge na escopeta, Carl na sniper, que
    agora atira de perto quando não há outra arma).
  - **Bots de fábrica no JOGAR:** com `?bots=fabrica` na URL, os 6 especiais jogam contra você e o Buddy no seu time,
    até os menus da fase 4.
  - **Golden e balance:** o golden muda para `5ee925a0`; o balance segue em ordem. 12 testes novos.
- **Fase 3h, assistência de mira:**
  - **Fricção:** no controle e no toque, a mira desacelera perto de um inimigo à vista: 25% no Leve, 40% no Médio e
    60% no Forte, mais no centro do alvo.
  - **Ímã leve:** mexendo a mira ou andando, ela é puxada de leve para o alvo.
  - **Trava do Forte:** no Forte, apertar o ADS trava a mira no alvo.
  - **Escopo:** o mouse continua sem assistência. A mira assistida vai gravada no `InputFrame`, então o replay não
    muda.
  - **Golden e balance:** o golden fica igual (`5ee925a0`) e o balance segue em ordem. A fase 3 (IA) está completa.
- **Fecho da fase 3 (conferido nos prints):**
  - **Regras à vista** (GDD §6.5):
    - o placar ganha embaixo de cada time a lista dos bots com regra ("Jorge the Immortal: 500 de vida · só
      escopeta");
    - a tela de morte mostra as regras de quem te matou.
  - **Avisos do time:** avisos quase no mesmo ponto da tela viram um losango só.
  - **`?nivel=` na URL:** escolhe o nível do primeiro JOGAR (`?nivel=suado`), até os menus da fase 4.
- **Prints da rodada 7:** página com capturas ao vivo (`local/m2/montar-pagina-r7.mjs`) do aviso do time, dos bots de
  fábrica e das regras no placar e na tela de morte, com as perguntas C1–C6. Aprovada no padrão (#67), o que fecha a
  fase 3.
- **Fase 4a, peças de UI dos menus:**
  - linha de opção ("NÍVEL ◀ Normal ▶"): esquerda e direita mudam o valor, e as setas respondem ao toque e ao mouse;
    serve de seletor, alternador e passo numérico;
  - abas (Q/E, LB/RB) com o sublinhado âmbar na selecionada;
  - coluna com rolagem que segue o foco, recortada, com barrinha;
  - tudo navegável só com o D-pad. 13 testes novos.
- **Fase 4b, dados e save:**
  - **Formatos novos:** `settings@1` (controles por dispositivo, vídeo, acessibilidade), `stats@1` (totais,
    recordes, dicas vistas, última Novidades vista), a biblioteca de presets (5 últimos, até 200 salvos com nome único,
    6 favoritos) e o `backup@1` com tudo junto.
  - **Leitura tolerante:** o campo estragado cai no padrão e o número fora da faixa é limitado, sempre com aviso.
  - **Save do jogador:** sobre o storage da plataforma; exporta e importa o backup, juntando ou substituindo. Já é
    criado ao abrir o jogo; as telas que o usam chegam nas próximas subfases.
  - 12 testes novos.
- **Fase 4c, título, menu principal e partida de estreia:**
  - **Título:**
    - JOGAR mostra embaixo o que vai jogar ("Times · De boa · 4 contra 4 · Construto");
    - Surpreenda-me e Mudar substituem o Ajustes, que foi para o menu principal.
  - **JOGAR:** joga o último preset. Na primeira vez é a partida de estreia: TDM 4v4 no Construto, você com 3 aliados,
    todos no De boa, 5 min ou 30 abates (#21).
  - **Surpreenda-me:** sorteia modo, nível, tamanho e duração num card, com Jogar, Rolar de novo e Voltar.
  - **Resultado:** De novo, Mais fácil e Mais difícil trocam o nível dos bots de nível do preset, e ele vira o último.
  - **Foco:** de volta da partida, o foco fica no JOGAR.
  - **Menu principal:** por enquanto, Ajustes e Voltar (a Partida Rápida e os Modos chegam na 4d).
  - 7 testes novos.
- **Fase 4d, Partida Rápida e Modos:**
  - **Partida Rápida:** modo, mapa, nível, bots e duração em linhas de opção, com COMEÇAR fixo no canto (já com o
    foco). Abre como a última partida estava; o tamanho para no teto de bots do aparelho; trocar o modo mantém a
    quantidade de bobos. A meta de abates segue a duração (TDM 10 min = 75).
  - **Atalhos:** à direita, numa coluna com rolagem: as últimas 5, os favoritos e os prontos (Vibe, Tryhard, Sexta do
    Jorge).
  - **Modos:** um card por modo (Times, Todos contra todos), com uma frase; escolher abre a Partida Rápida com ele.
  - **Menu principal:** Partida Rápida, Modos e Ajustes.
  - **Correções:** botão medido pelo texto agora arredonda para cima (o 640×360 cortava 0,4 px do "ROLAR DE NOVO"), e a
    área do valor da linha de opção foi para 320 px (cabia só "Times", não "Todos contra todos").
  - 8 testes novos, com as telas da fase 4 no teste de estouro de texto com o atlas real (6 alvos e o Switch).
- **Fase 4e (parte 1), regras da partida:**
  - **Formato:** o preset ganha os modificadores de arma do M2 (gameplay.md §4.5):
    - dano de 0,25× a 5×;
    - só cabeça conta e um tiro mata;
    - munição (normal, reserva infinita, pente infinito);
    - ADS, recuo e espalhamento ligados ou não;
    - fogo amigo (desligado, metade, inteiro) e autodano;
    - sniper mata no corpo;
    - armas permitidas e assistência de mira permitida.
  - **Jogadores e tela:** os jogadores ganham regeneração (desligada, lenta, padrão, rápida), proteção de spawn,
    gravidade e dano de queda; a tela da partida pode tirar o kill feed, o hitmarker e os marcadores dos aliados.
  - **Na sim:** com fogo amigo, a bala, a faca e a explosão acertam o aliado, e o abate de aliado não conta. Gravidade
    menor faz o pulo subir mais.
  - **Bots:** atiram com a sniper mesmo sem ADS na partida.
  - **Golden e testes:** com os padrões, nada muda (golden igual). 9 testes novos.
- **Fase 4e (parte 2), Partida personalizada:**
  - **Abas:** Partida, Jogadores, Armas, Bots, Modificadores e Tela, em botões compactos, trocadas também com Q/E e
    LB/RB.
  - **Linhas:** as regras de cada aba em linhas de opção numa lista com rolagem; o resumo do preset fica embaixo do
    título.
  - **Botões:** Voltar, Salvar preset e COMEÇAR no canto.
  - **Aba Bots:** escolhe o bot de cada time (os 5 níveis e os 7 especiais de fábrica) e a quantidade, até o teto do
    aparelho.
  - **Salvar preset:** usa um nome gerado ("Times 4×4 De boa"; repetido, " 2").
  - **Entradas:** pela Partida Rápida ("Mais regras") e pelo resultado, onde "Mudar regras" e "Salvar preset" agora
    funcionam (salvo, o botão vira "Preset salvo").
  - **Fim dos parâmetros de desenvolvimento:** `?bots=fabrica` e `?nivel=` saem da web; a aba Bots faz o mesmo.
  - **UI:**
    - botão compacto;
    - um item recortado fora da janela só é vizinho de quem já está na mesma lista (de fora, entra-se pelos itens à
      vista);
    - as opções da Partida Rápida também rolam nas telas pequenas.
  - **Teste de estouro:** confere também que a fileira do canto não encosta nas listas, e o alcance pelo D-pad refaz o
    layout a cada foco, como o menu.
  - 7 testes novos.
- **Fase 4f (parte 1), Ajustes:**
  - **Abas:** Controles, Vídeo, Acessibilidade, Dados e Sobre, no mesmo molde de abas da Partida personalizada (trocar
    de aba leva o foco junto).
  - **Controles:** cada dispositivo tem os seus (a linha "Ajustando" troca entre teclado e mouse, controle e toque):
    sensibilidade, sensibilidade vertical, sensibilidade na mira, Y invertido, assistência de mira (Desligada, Leve,
    Média, Forte), alternar ou segurar para mira, agachar e correr, e as zonas mortas (só no controle).
  - **Vídeo:** campo de visão (padrão da plataforma ou 60° a 110°) e tamanho dos menus (×0,8 a ×1,3).
  - **Acessibilidade:** reduzir tremor (as explosões tremem 1/4) e dicas ligadas ou não.
  - **Dados:** exportar o backup num arquivo `.json` e importar, juntando ou substituindo, com o aviso de que limpar o
    navegador apaga tudo.
  - **Sobre:** versão, créditos, fontes, three.js e "Copiar relatório" (#42).
  - **Na partida:** a pausa tem Controles, Vídeo e Acessibilidade, que valem na hora; a partida lê os ajustes salvos.
  - **Ficam para depois:** qualidade gráfica (com o item Web), cores para daltônico e tamanho do HUD (fase 6), volumes
    (fase 7) e o remapeamento (parte 2).
  - 7 testes novos.
- **Fase 4f (parte 2), remapeamento:**
  - **Aba Botões** nos Ajustes e na pausa: uma linha por ação (andar, atirar, mirar, pular, agachar, correr,
    recarregar, interagir, faca, granada, trocar de arma, armas 1 a 4, ping, emote, placar), para o teclado e mouse e
    para o controle. No toque, os botões ficam na tela da partida.
  - **Trocar um botão:** confirmar na linha e apertar a tecla ou o botão novo; Esc ou + cancela.
  - **Conflitos:** se o botão novo já era de outra ação, as duas trocam; quando não há o que trocar, a outra fica sem
    botão, com aviso.
  - **O que não muda:** a pausa (Esc, P e +) e os menus. Ligar uma ação ao Ctrl mostra o aviso do navegador.
  - **Restaurar padrão** devolve os botões de fábrica do dispositivo.
  - **Nomes:** o controle aparece pela posição, sem marcas ("Botão de baixo", "Ombro direito"); as teclas de símbolo
    seguem o ABNT2.
  - 8 testes novos.
- **Fase 4g, estatísticas e Novidades:**
  - **Estatísticas:** cada partida terminada soma no save os números do jogador 1: partidas, vitórias, derrotas,
    empates, abates, mortes, assistências, tiros, acertos, tiros na cabeça e tempo de jogo. Os prints e o bench não
    contam.
  - **Recordes:** mais abates numa partida e maior sequência. Quando a partida bate um deles, o título "Seus números" do
    resultado vira "Recorde de abates!" (ou de sequência, ou "Dois recordes!"), em âmbar. A primeira partida só marca a
    base.
  - **Onde ver:** a aba Dados dos Ajustes mostra os totais, a precisão, os tiros na cabeça, o tempo de jogo e os
    recordes.
  - **Novidades:** versão, codinome e 5 itens de 1 linha. Aparece uma vez, antes do título, para quem já jogava e
    atualizou; quem instala do zero vai direto ao título. Fica também no menu principal. Se o save veio de um formato
    antigo, uma linha avisa quantos itens foram atualizados.
  - **Menu principal:** Partida Rápida, Modos, Ajustes e Novidades.
  - 5 testes novos.
- **Fase 4h, onboarding opcional:**
  - **Dicas de 1 linha** nas 2 primeiras partidas, sem pausar, cada uma no máximo uma vez:
    - andar 5 s sem correr: "Shift esquerdo corre";
    - correr 1,5 s: a do agachar e deslizar;
    - mirar num inimigo a mais de 20 m sem o ADS: a da mira com zoom;
    - pente vazio: a do recarregar.
  - **A tecla da dica** é a que o jogador usa de verdade, remapeamento incluído: aparece desenhada (contorno âmbar) e
    troca na hora se o dispositivo mudar (teclado, controle ou toque). Ação sem botão no dispositivo espera.
  - **Quando aparece:** só com 1 jogador e com "Dicas" ligado nos Ajustes.
  - **Gire o celular:** no celular em retrato, um aviso cobre tudo e a partida pausa; some quando o aparelho deita.
  - **Correção:** com o celular em retrato desde o boot, o splash da web não saía.
  - **Fica para a fase 5:** a calibração da sensibilidade (3 alvos) e o card "Conheça o Laboratório".
  - 6 testes novos.
- **Fase 4i, prints da rodada 8:** 16 capturas ao vivo da fase 4 (título, Surpreenda-me, menu principal, Partida
  Rápida, Modos, Partida personalizada, Ajustes com a aba Botões e a pausa, Dados, Sobre, Novidades, resultado com
  recorde, dica e "Gire o celular") e as perguntas D1–D8, publicadas como versão 9 da página das rodadas. O gancho dos
  prints ganha `showResult(previewRecord)`, que mostra o título de recorde sem gravar nada.
- **Fase 5a, Oficina:**
  - **Menu principal:** ganha "Laboratório", que abre na Oficina. A coluna dos itens rola nas telas pequenas.
  - **Biblioteca:** os favoritos, os seus bots e os 12 de fábrica, numa lista à esquerda.
  - **Card do bot:** habilidade (o nível rápido ou "ajustada"), inteligência e personalidade, os números de mira e toda
    regra ativa, em linhas curtas.
  - **Ações:** duplicar (a cópia vai para os seus bots com o nome "Jorge the Immortal 2"), favoritar (até 6) e apagar,
    com confirmação; os de fábrica não se apagam. O teto é de 500 bots na web e 100 no Switch.
  - **Teste de estouro:** confere também que todo texto desenhado existe na fonte em que sai (a display só tem
    maiúsculas).
  - 5 testes novos.
- **Fase 5b (parte 1), Laboratório:**
  - **Editar** na Oficina abre o Laboratório. Um bot de fábrica vira uma cópia nova (o original fica); um dos seus é
    editado no lugar.
  - **Abas:** Habilidade (o nível rápido em cima, que preenche habilidade e inteligência, e os 10 números de mira),
    Inteligência (o nível N0–N4 liga os comportamentos dele; depois, cada um liga e desliga), Personalidade (a base
    preenche os pesos), Regras (vida, dano, velocidade, munição, armas, imune à cabeça, explode ao morrer, visão,
    audição e conhecimento) e Nome.
  - **Nome:** "Rolar nome" dá um nome bobo em inglês ("Private Burrito"); com teclado, confirmar no nome abre a
    digitação.
  - **Salvar** volta à Oficina com o bot escolhido. Voltar com mudanças pede confirmação.
  - **Regras à vista:** o card, o placar e a tela de morte passam a mostrar também visão, alcance, audição e
    conhecimento.
  - **Abas:** de qualquer aba, "baixo" vai para a primeira linha (a aba da ponta caía nos botões do canto).
  - 6 testes novos.
- **Fase 5b (parte 2), seus bots na partida:** a aba Bots da Partida personalizada passa a oferecer também os bots da
  Oficina, depois dos de fábrica. O escolhido vai embutido no preset (`embedded:<id>`), que continua jogável mesmo se
  o bot sair da Oficina; quando nenhum time usa mais, sai do preset. 1 teste novo.
- **Fase 5c, Ringue:**
  - **O mapa:** arena pequena de treino, com 36×36 m de área jogável.
    - No meio, o ringue: um tablado de 10×10 m, com cordas e uma entrada em cada lado.
    - Coberturas espelhadas para o X1: os times nascem atrás de um abrigo de 2,5 m e não se veem ao nascer.
    - No norte, 5 baias de tiro com toldo.
    - A faixa listrada amarela marca o limite da área (a parede invisível), com corrimão logo fora.
  - **Modos:** TDM pequeno (X1 e 2v2, até 8 bobos) e o Bobo Training (fase 5d). FFA não, porque numa arena desse
    tamanho os nascimentos se veem.
  - **Nos menus:** a Partida Rápida e a Partida personalizada passam a escolher o mapa entre os que têm o modo. Trocar
    para FFA volta ao Construto, e os bots são cortados no teto do Ringue.
  - **Cena:** a partida carrega o mapa da receita.
  - 4 testes novos.
- **Fase 5d, Bobo Training:**
  - **Entrada:** o Modos ganha o card "Bobo Training" (os cards agora em grade de 2 colunas), que começa direto no
    Ringue.
  - **Alvos:** a personalidade nova Alvo não ataca. Paciente, fica parada; impaciente, anda de lado, indo e voltando. Os
    alvos de fábrica são Dummy Dan (parado) e Dashing Dave (andando), e no Laboratório dá para fazer os seus.
  - **Regras:** sem placar e sem fim (sai-se pela pausa), com as regras de Warfare (regeneração, caixinha) e respawn
    de 1 s. Os bots nascem espalhados pelos pontos sem time do mapa.
  - **HUD:** no lugar do placar, a linha "Precisão · TTK médio · Na cabeça · Abates". O TTK conta do primeiro acerto
    seu até o seu abate.
  - **Fica para depois:** a skin de treino dos alvos (arte).
  - 2 testes novos; golden igual.
- **Fase 5e, pontes do Laboratório:**
  - **Testar** (no Laboratório, entre Voltar e Salvar) abre o Bobo Training com o bot, sem salvar. Ao sair, você volta
    ao editor com "Testado: o bot acertou 18% · você 5/2 · TTK médio 0,9 s".
  - **Salvar na Oficina** (resultado): o Nêmesis vai para os seus bots, e o botão vira "Salvo na Oficina".
  - **Abrir Laboratório:** no Tryhard, "Mais difícil" vira "Abrir Laboratório" e leva à Oficina.
  - **Conheça o Laboratório:** ao sair da 1ª partida terminada, uma vez, aparece um card com o Jorge the Immortal, os 4
    eixos e as opções Testar, Abrir Laboratório e Agora não.
  - 3 testes novos.
- **Rodada 9 de prints (antes da 5f):** 13 capturas da fase 5 até a 5e (Oficina, Laboratório, Ringue, Bobo Training,
  Testar, resultado no Tryhard e o card do Laboratório) e as perguntas E1–E6, publicadas como versão 10 da página das
  rodadas, junto com a rodada 8 (D1–D8), que ainda esperava resposta.
- **Fase 5f, Calibrar mira:**
  - **Onde:** no Bobo Training, a pausa troca "Ajustar desafio" por "Calibrar mira" ("Pular calibração" enquanto
    calibra); nos Ajustes, em Controles, "Calibrar mira" abre o treino já calibrando (começa no fim da contagem).
  - **Como funciona:** 3 alvos aparecem um de cada vez (um losango âmbar na tela, a 40°, 55° e 85° de onde você
    olhava). Você mira e atira.
  - **O que mede:** se a mira passou do alvo ou se parou antes dele.
    - Passou duas vezes ou mais: a sensibilidade cai para ×0,85 da atual.
    - Parou antes duas vezes ou mais: sobe para ×1,2.
    - Senão, fica como está.
    - O ajuste vale na hora, e a página do resultado tem OK e Desfazer.
  - **Correção:** a pausa nascia com o estado padrão (sem o da partida) até ser reaberta.
  - **Fica para depois:** a calibração na contagem estendida da 1ª partida (gameplay.md §2.5).
  - 3 testes novos.
- **Respostas das rodadas 8 e 9 (#68, #69):** tudo aprovado no padrão, com dois ajustes.
  - O preset pronto "Sexta do Jorge" virou **Imortais**: o nome antigo saiu engraçado demais e fora do tom.
  - Em **tela dividida**, as estatísticas somam todos os jogadores locais. O recorde de abates e o de sequência
    continuam sendo do melhor jogador da partida.
  - 2 testes novos.
- **Fase 6a, perfis de movimento:**
  - **Tático** (estilo CS): andar a 4,0 m/s e correr a 5,5 m/s, pulo de 0,8 m, escala até 1,0 m e não desliza.
    Aterrissar freia e a mira erra mais andando ou no ar.
  - **Personalizado:** o Bobo com velocidade de 0,5× a 2× e pulo de 0,5× a 3×, mais a gravidade e o dano de queda que
    já existiam.
  - Na Partida personalizada, a aba Jogadores começa com a linha **Movimento**.
  - **Correções:**
    - a escalada no ar não alcançava a altura do perfil: o Bobo não subia 1,5 m nem o Tático 1,0 m;
    - Gravidade e Dano mostravam ×0,25 como "×0,3".
  - 4 testes novos; golden igual.
- **Fase 6b, 3ª pessoa:**
  - **Câmera de ombro:** o T (teclado) ou o direcional direita (controle) troca entre 1ª e 3ª pessoa; o X ou o
    direcional esquerda troca o ombro. A escolha fica salva nos Ajustes (aba Vídeo).
  - Você vê o próprio bobo inteiro, com a arma na mão. Na luneta e de costas para a parede, a vista volta à 1ª pessoa.
  - **A mira:** o tiro sai do olho do bobo e vai para onde a câmera mira. Se o caminho do olho estiver tapado, a bala
    acerta a parede: não dá para atirar escondido atrás da cobertura.
  - Na Partida personalizada, a regra **Câmera** (Livre ou Só primeira pessoa).
  - 6 testes novos.
- **Fase 6c, Meu Bobo:**
  - **Onde:** no menu principal, entre o Laboratório e os Ajustes. O editor abre no Ringue, com o seu bobo girando no
    meio do tablado e o painel à direita.
  - **Abas:**
    - **Pronto:** os 11 visuais da farda, a prévia com o colete de cada time e "Sortear um bobo";
    - **Rosto:** pele (10 tons e 4 cores fantasia), rosto, sobrancelha, barba, marca e olhos;
    - **Cabelo:** os 34 cortes do FutBobo e 20 cores;
    - **Acessórios:** faixa, tiara, bandana ou boné, óculos, brincos e a cor deles;
    - **Roupa:** estampa (lisa ou os camuflados), jaqueta, calça, colete, botas e luvas.
  - As cores aparecem num quadradinho ao lado do nome.
  - Cada mudança vale na hora e fica salva. O jogador 1 entra nas partidas com o seu bobo, com o colete do time por
    cima.
  - O backup leva o Meu Bobo junto.
  - 4 testes novos.
- **Fase 6d, fantasias:**
  - Quatro visuais prontos novos no Meu Bobo: **Astronauta**, **Pijama**, **Robô de papelão** e **Mergulhador**.
  - Cada um tem tecido próprio: traje espacial com painéis, listrado e papelão com fita adesiva. O mergulhador usa a
    máscara.
  - Os bots continuam de farda. Capacete e outros acessórios 3D ainda não entraram.
- **Fase 6e, toque completo:**
  - **Botões novos:** **Faca** (ao lado de Arma) e **Vista** (1ª/3ª pessoa, ao lado da pausa).
  - **Correr:** empurre o joystick até a borda, para a frente.
  - **Nos Ajustes, para o toque:** **Atirar sozinho** (dispara quando a mira passa num inimigo à vista) e
    **Canhoto** (espelha os botões e o joystick).
  - **Em Vídeo:** **Limite de quadros** de 60 ou 30 por segundo, para poupar bateria.
  - **Fantasma dos dedos:** nas 2 primeiras partidas no celular, dois dedos mostram onde arrastar para andar e para
    mirar, até você fazer os dois.
  - 4 testes novos.
- **Rodada 10 de prints:** 26 capturas da calibração da mira e da fase 6 (perfis, 3ª pessoa, Meu Bobo, fantasias e
  toque) e as perguntas F1–F7, publicadas como versão 11 da página das rodadas.
- **Fase 7a, banco de sons:**
  - **52 sons:** 33 em MP3, de 3 pacotes CC0 da Kenney (Impact, Sci-Fi e o Interface Sounds, novo), e 19
    sintetizados em código.
  - **Sintetizados:** os tiros das 5 armas de fogo, cada um com a versão de perto e a de longe; o foguete, a faca, o
    "PLOC" do headshot, os bipes da contagem, o coração da vida baixa, as vinhetas de vitória e derrota e o deslize.
  - **Da Kenney:** interface, hitmarker, abate, dano, recarga, granada, explosão (perto e longe), impactos e passos
    por material, pulo, pouso e caixinha de munição.
  - Os MP3 somam 83 KB, dentro dos 150 KB de sons da primeira partida; os sintetizados não baixam nada.
  - O banco guarda volume, canal, prioridade e cooldown de cada som. Créditos no `CREDITOS.md`.
  - 13 testes novos.
- **Fase 7b, sons da partida:** a partida agora tem som.
  - **Armas:** tiros (com a versão de longe a mais de 30 m), foguete, faca, granada, explosões, recarga e troca de
    arma.
  - **No mundo:** impactos por material e passos dos bots mais próximos, pelo chão que eles pisam.
  - **Para você:** hitmarker, headshot, abate, dano, morte, o coração quando a vida está baixa e a contagem 3-2-1.
  - **Mixagem:** atrás de parede o som fica mais baixo. A sua arma e o dano em você têm prioridade sobre o resto.
  - **F2:** mostra as vozes de áudio tocando.
  - 13 testes novos.
- **Fase 7c, interface e Ajustes de áudio:**
  - **Menus com som:** andar, confirmar, voltar e trocar valor.
  - **Aba Áudio nos Ajustes** (também na pausa): volume geral, efeitos, música e interface; música na partida, saída
    mono e indicador de som.
  - **Indicador de som:** quando ligado, tiros e passos até 20 m aparecem como pontos num anel em volta da retícula,
    na direção de onde vieram.
  - 8 testes novos.
- **Fase 7d, tocador de música:**
  - **Onde toca:** nos menus e no resultado. Na partida, só com o Ajuste "Música na partida".
  - **Troca de faixa:** em crossfade.
  - **Explosões:** a música abaixa 6 dB.
  - 4 testes novos.
- **Música do menu:** "Toy Soldiers", de Zane Little Music (CC0), baixada com o OK do Erick.
  - Toca em loop de 85 s (48 compassos) no título, nos menus e no resultado.
  - A emenda fica no compasso, sem estalo.
  - Baixa 1 MB só depois do menu.
  - Com a saída mono ligada, toca em mono.
  - 10 testes novos.
- **Rodada 11 de prints:** os 52 sons para ouvir, a aba Áudio, o indicador de som e o F2 com as vozes. São as
  perguntas G1–G6, publicadas na versão 12 da página das rodadas junto com a rodada 10. A G6 é o OK do download da
  música do menu.
- **Fase 8a, visual dos bots pelo nome:** o look de cada bot na rotação sai do hash do nome. O mesmo bot veste o mesmo
  look em qualquer partida; bots repetidos (o mesmo bot de fábrica várias vezes) seguem a rotação e não saem iguais. 3
  testes novos.
- **Fase 8b, qualidade na primeira abertura:** linha "Qualidade" na aba Vídeo (Automática, Leve, Média, Alta).
  - Muda a resolução na hora e os detritos na próxima partida (arte-ux.md §1.12).
  - A Automática lê o aparelho uma vez (GPU, núcleos, memória e uma lista de GPUs fracas) e guarda o nível no save.
  - Na partida, se mais de 10% dos quadros dos primeiros 10 s passam do alvo, ela baixa um nível para as próximas.
  - No Switch só os detritos mudam (720p fixo). 8 testes novos.
- **Fase 8c, service worker:** o site abre e joga sem rede depois da primeira visita.
  - O `sw.js` é gerado no build e guarda casca, código, Construto, Ringue e sons num cache da versão.
  - A versão nova baixa em segundo plano e só é aplicada no título, nunca no meio da partida. A página recarrega
    gravando o save antes.
  - Sem dependência nova. 7 testes novos.
- **Fase 8d, portão e medições:**
  - `npm run check` verde (1.623 testes), `size-check`, `smoke:web`, `portcheck --strict` e balance ok.
  - No PC, 60 fps com 40 bots na GPU integrada.
- **Fase 8e:** roteiro do celular e do checkpoint no Switch para o Erick (`docs/ROTEIRO_M2.md`).
- **Rodada 12 de prints:** a qualidade, o teste do sofá e o roteiro do celular e do Switch, com as perguntas H1–H3
  (H3: publicar), na versão 14 da página das rodadas, junto com as rodadas 10 e 11.
- **Teclado no Switch (pedido do Erick, #73):** o teclado USB joga no Switch, com a mira nas setas, o tiro no Ctrl
  direito ou no F e a mira (ADS) no Shift direito ou no Z; usa a assistência de mira do controle. Mouse não dá (o nx.js
  não lê mouse USB). No PC, as setas também miram.
- **Rodadas 10 a 12 aprovadas no padrão** (#70–#72); o M2 foi publicado com o OK do Erick.
- **Teste do sofá no Switch (pedido do Erick, antes do M3):** cada controle completo conectado vira um jogador local
  em tela dividida no JOGAR e na Partida Rápida, de 2 a 4.
  - Par de Joy-Con, Pro ou portátil; a ordem segue o número do controle.
  - Cada jogador tem a própria mira, com assistência, a própria vista e a própria HUD. Qualquer `+` pausa.
  - O Bobo Training continua de 1 jogador.
  - **Ainda não tem:** o "aperte A", entrar no meio e o radial da arma para os jogadores 2–4 (eles renascem com o
    fuzil); a 3ª pessoa, o resultado e a vibração seguem só o jogador 1.
  - A web continua com 1 jogador.

### M1 Cena-vitrine + Teste Zero (concluído em 08/11/2026, #60)

**Parte 1: contratos e frentes em paralelo**

- Contratos do M1 (`docs/ARCHITECTURE.md` §9): formas na célula, `map@1` (`.bfmap`), `model@1` (`.bfmodel`), skins,
  manifesto `layers@1` dos texture arrays, render do mundo, dos atores, dos VFX e das vistas, `nav`, bench e linhas
  `[t0]` do `runtime.log`.
- world: formas do catálogo na colisão e no raio (rampa lisa, degrau, laje andável, painel e poste que bloqueiam, cruz
  sem colisão), colisores de props, luz em canais (céu por flood fill, sol por varredura, emissivo) com grade de 2 m,
  mesher por região 2×2×1 com greedy por textura, AO 0fps com troca da diagonal e vértice de 12 bytes.
- texgen do M1: paleta mestra revista (64 cores, rampas de material de 4–6 tons), 38 texturas de bloco em 62 camadas com
  variantes e água animada, mips com cobertura de alfa, tira `modelos64-materiais` e 44 blocos `blocks@1`.
- skingen e modelgen geram skins, rostos, armas e props do Construto; `model@1` com codec e validador.
- Construto `map@1` compilado pelo mapc: codificador/decodificador e validador do `.bfmap`; navegação 2,5D com A*
  fatiado; maior linha de visão medida de 47,75 m; vista de cima para revisão.
- sim/ia M1: formas e props, zumbis de estresse, acerto com parte e direção, bots N0 com A* e orçamento.
- render-mundo do M1: texture arrays com mips e atlas de plano B, vértice de 12 bytes (inteiro ou float), céu
  procedural, hora do dia por uniforms, 1 a 4 vistas com culling e estatísticas por vista, aquecimento e memória.
- Bobos instanciados com skins compostas, armas, props por grupo de 32 m, viewmodel, desmonte e VFX.
- HUD por vista, painel F2, loading por etapas, telas de teste do Switch e comparação de fontes (Russo One, Chakra
  Petch, Saira Condensed).
- Teste Zero: sondas no runtime.log, telas de controles, teclado e áudio, mixer de 24 vozes, sons CC0 da Kenney, NRO
  rodando no Eden.
- web: bench por URL (`?bench`, `/bench/`, apelidos pt-BR), relatório para a área de transferência,
  `window.__bfDebug.print`; prints automáticos com folha de contato; smoke abre o Construto e o bench de 4 vistas;
  size-check por grupo; guard com `import-tooling` e `asset-format`.

**Parte 2: integração**

- O Construto de verdade no `game` (`@boboforces/game/scene`): loading por etapas dentro dos frames e cronometrado
  (assets → texturas → luz → malha → navegação → skins → shaders; ~0,5 s no Edge do PC de referência), partida local
  com bots N0 na navegação real e zumbis de estresse, 1 a 4 vistas (no bench, bots no lugar dos humanos), HUD por vista,
  viewmodel, atores interpolados com a luz da grade de 2 m, eventos da sim virando VFX (clarão, traçante, impacto em
  bloco, prop e bobo, desmonte), Dia/Entardecer/Noite por uniforms e fog pela visão do perfil.
- JOGAR abre o Construto em Bobo Warfare TDM (6 × 6 com bots N0); "Cena-vitrine" no título da web anda no Construto
  sem bots; no Switch, os itens de teste do título (6 presets do bench, Controles, Teclado, Áudio) funcionam.
- Painel F2 (frame CPU/GPU, p50/p99, fases, draw calls e triângulos por vista, programas, heap, bots, visão), bench com
  roteiro de câmera e relatório (`onBenchReport`; no Switch vai para o `runtime.log` com `[bench]`) e as sondas
  `[t0]` do jogo (itens 10–16). Gancho dos prints completo: 43 prints (mip em 3 versões, skin de densidade dobrada,
  comparação de fontes por combinação).
- Contratos: `mipFilter` com `off`, skin de teste de densidade dobrada (`skinDensityTest`, `skins/densidade32.png`),
  `showFontCompare(on, combo?)`, `benchWarnings`, orçamento da IA pelo perfil, `SimView.playArea`, `onended` do
  `AudioContextLike`, cor do acerto em prop pelo `ImpactEvent.prop`, renderer só de UI para o menu
  (`@boboforces/render/menu`) e `GameDeps.loadScene`. Membros do M0 removidos (`setWorld`, caixas, `buildChunkMesh`,
  cena de teste). Detalhes em `docs/ARCHITECTURE.md` §8.
- Menu da web de volta ao orçamento: 364,9 → **315,9 KB** de 350 KB (a cena e o renderer completo vêm por `import()` ao
  entrar no Construto); primeira partida 519,3 KB de 1 MB.
- IDs de conteúdo novos (só acrescentados): `block:concrete-stripe`, `block:cinder-block`, `block:canvas`,
  `block:led-strip`, `block:exit-sign`, `block:danger-sign-a`, `block:danger-sign-b` e `model:crate-large`.
- Fontes candidatas (decisão #46): TTF e `OFL.txt` no repositório; o atlas gerado fica fora do git e do build publicado
  (`npm run fontbake -- candidatas`, seção `local` do `runtime-assets.json`).
- **Golden** passa para o Construto real (`.bfmap` + `nav`): `bf9caca1` (Construto sintético) → **`a15e05de`**
  (8 bots, semente 42, 3.600 ticks: 26 abates, 208 tiros). Motivo: o golden agora prova o mapa, as props, a colisão e a
  navegação de verdade, pelo mesmo caminho do loading do jogo (`packages/game/src/scene/golden.test.ts`).
- CI: geradores de assets em dia (`npm run assets:check`) e o smoke do Construto; scripts `bench:sim` e `bench:nav`.
- Testes: 934 → 913 com a saída dos membros do M0 (o `mesh.test.ts` do mesher antigo, com 16 casos, o golden sintético
  da IA e os casos do céu e das caixas do M0); a verificação levou a 922.
- **Eden:** o Construto roda no NRO. Correções de shader achadas lá (o recompilador do Eden derrubava o app): hash de
  célula só com float (sem `IMUL`), sem `return` antecipado nos programas instanciado e de partículas, sem índice
  dinâmico em array de uniform; o `render.test.ts` confere. Loading no Eden 5,8 s (meta 4 s) e picos de 200–550 ms no
  `renderViews` ficam para o Teste Zero no console. O bench grava `[bench] pico …` e o rastro dos 3 primeiros frames.

**Parte 3: medições e documentos**

- **Céu corrigido:** o Entardecer e a Noite saíam com o céu em chiado nos prints (estrelas em ~99% das células e nuvens
  em ruído; de dia as nuvens sumiam). Causa: o hash só de float da parte 2 deixava os bits baixos do `bfHash` quase
  sempre em zero. Agora cada byte sai dos bits altos de um `bfHashF` de semente própria (sem multiplicação inteira:
  segue valendo no Eden, conferido no NRO); teste `render/src/shared/hash-bits.test.ts`. Os 43 prints foram refeitos.
- `npm run bench` ganhou `--gpu-alto` (GPU dedicada no notebook híbrido: sem ela o Edge fica na Intel UHD mesmo pedindo
  `high-performance`) e `--sem-vsync` (mede a folga acima do teto da tela); o nome do relatório diz as duas.
- **PC de referência** (i5-12450H + RTX 2050, Edge 156 com janela): 4 vistas e 24 bots sem perder nenhum vsync (p99
  18,9 ms; o Edge com janela fica em 56 fps até numa página vazia) e **485 fps sem vsync**: critério 5 ok na RTX. Na
  Intel UHD, que é o que o Edge usa sem configurar, 49,6 fps (p90 35 ms). Preset da dock por 10 min: p99 18,8 ms, máx
  19,9, heap 44 MB. 1 vista, 24 bots, 90 m: 1.112 fps sem vsync. As 4 rotas (array/atlas × int/float) custam o mesmo.
- **Eden** (NRO de 58 MB): 4 vistas/12 bots, 1 vista/24 bots e o plano B rodam sem erro, 7 programas, heap 43–44 MB;
  loading 6,0–6,3 s e os mesmos picos de `render` (degraus de ~250 ms, em ~45% dos frames), iguais nas 3 rodadas.
- Gerados conferidos: `npm run assets` sem mudança nenhuma, `assets:check` em dia, `audioconv` byte a byte igual,
  `fontbake -- candidatas` (atlas local de 571 KB). Golden `a15e05de` e `balance` mantidos.
- Docs: `PERF.md` (custos de cada frente, rodadas do PC e do Eden, tabela do Teste Zero item a item), `TESTE_ZERO.md`
  (rótulos reais do título, tempo do bench no Eden, seção 11), `CREDITOS.md` (versões, links e arquivos usados) e
  `DEPENDENCIAS.md` (lamejs só no `audioconv`, LGPL, fora do jogo).

**Parte 4: verificação (corretor do M1, a partir dos revisores de critérios, bugs, desempenho e arte)**

- **Print de leitura (critério 1, item 4):** os 4 pares de manequins estavam na mesma visada e o de 5 m tapava os de
  30 e 50 m em todos os prints. Agora é UM par (time A e time B) no fim da estrada do norte, com as 4 câmeras na mesma
  reta a 5, 15, 30 e 50 m dele; atrás do par, uma parede de teste a 24 m; à esquerda, uma sebe de 1,5 m no limite da
  grade (o terço esquerdo do quadro era o fim do mundo). O contorno sai com 2 px (o do 3–4P: a vista de 640×360) e o
  jogo só desenha os manequins de print com a câmera deles (bench e JOGAR ficam só com os 6 da vitrine).
- **Print de densidade:** um contraforte de tijolo no MESMO plano da frente da cabeça do manequim, com as câmeras a
  1 m e 3 m desse plano (antes o muro ficava 1,25 m atrás e o print exagerava o pixel do bobo).
- **Sombra-blob** aparece (a borda do `smoothstep` estava invertida e o fragmento sempre caía no discard).
- **Galpão:** o fundo saía preto puro no Dia. Painéis baixos embutidos nas paredes, uma faixa luminosa no piso do
  corredor do meio [PROPOSTA] e um piso de 1 nível de céu na luz comum dos shaders (nada fica preto puro).
- Vitrine: o zumbi em pé (o agachado passou para o mecânico); o painel da fachada embutido acima do portão.
- **Clarão de tiro por vista** (arte-ux §1.8): antes um tiro clareava as 4 vistas.
- **Teto de detritos do perfil** chega ao render (antes todo perfil usava 200; o `switch34p` pede 120 e o PC 500).
- **Switch, telas de teste:** X e Y estavam trocados no teste de controles e no de áudio (os botões são por posição);
  com o `bench.json`, as sondas tardias rodam depois do relatório (inflavam o loading do Eden em 0,2–0,5 s).
- **Bench, relatório versão 2:** `bots_efetivos`, `manequins`, `detritos`, `frames_lentos` (40–60, 60–100, 100–250,
  250+ ms e os vãos de mais de 1 s, fora das estatísticas), `inicio_ms` (os primeiros frames) e `sim_ia_ms` (média,
  p99, máximo e custo por tick: no nx.js o relógio é em ms inteiros e a mediana dava 0). `erros=` passa a contar os
  erros do three. Picos: o pior frame acima de 1,5× o alvo em cada janela (duração/20), com `frame_ms`. Chaves de
  bissecção `hud`, `vm`, `fx` e `actors`.
- **Sondas `[t0]` do jogo:** sem amostra saem `pulado` (antes `ok` com zeros); o item 11 confere a meta por vista; o 15
  mede os primeiros 120 frames da partida; o 16 compara o 1º minuto com os últimos 60 s POR TEMPO (antes, as últimas
  14.400 amostras); o 12 traz o total de bots de verdade.
- Tela de loading na ordem do loader (luz antes da malha); "Relatório gravado no runtime.log · B volta" e "B interrompe
  o bench." na tela do Switch; as alocações por frame que restavam no laço da partida saíram (regra 11).
- Shaders: o último índice dinâmico em array de uniform (`uEmissiveLayers`) saiu e o teste vale para qualquer uniform.
- **Golden** `a15e05de` → **`b452f553`** (18 abates, 228 tiros): o mapa mudou (sebe, estrada e fecho na borda,
  painéis do galpão, contraforte no pátio, painel da fachada).
- **PC** (RTX 2050, 4 vistas, 24 bots, 60 s): 60,0 fps, p99 17,2 ms, nenhum frame acima de 40 ms, loading 570 ms.
- **Eden** (NRO novo, dock encurtada em 30 s): 58,5 fps, p99 46 ms, nenhum frame ≥ 100 ms: os picos de 250/500 ms
  sumiram. A/B com o índice dinâmico, as sondas tardias e a sombra-blob antiga deram o mesmo: a causa não está isolada.
  Loading 5,3–5,5 s (6,2 s com as sondas por cima). O console decide.
- Docs: `TESTE_ZERO.md` (itens 4, 5 e 9 só no boot; capturas no console; ciclo de vida numa partida JOGAR, não no
  bench; o "B volta" no fim do bench; item 16 também no portátil; bissecção; seção 12 dos celulares), `PERF.md`
  (rodada nova, tetos por perfil no §6, loading limpo do Eden ~5,8 s) e `ARCHITECTURE.md` (§8 e §10).

**Parte 5: depois da verificação (antes do Teste Zero no console)**

- **Número de setor no chão (arte-8):** os marcadores mostravam um algarismo de 1 a 4 sorteado por célula. Agora são
  9 blocos (`sector-marker-1` … `-9`), um por setor da planta 3×3, de 1 (noroeste) a 9 (sudeste); `blocos16` com 67
  camadas. O ID `block:sector-marker` nunca saiu num commit, então foi trocado, não aposentado. Golden `b452f553`
  igual (mesmas flags). Os 43 prints são de antes: neles os números ainda são os sorteados.
- **Bench abre a cena depois de um frame do título** (como JOGAR no menu): o loading do bench deixou de pagar o
  primeiro desenho da UI. No Eden, na mesma build: 5,3–5,5 → 5,0–5,2 s.
- **Diagnóstico para o console:** a linha `[cena] loading` separa a chegada dos arquivos da decodificação; as linhas
  `[bench] pico` trazem o heap no pico e na amostra de 1 s (coleta do V8 × espera do GL). No Eden, ler os 18 arquivos
  do RomFS leva menos de 10 ms; a decodificação, ~0,65 s; e os picos voltaram (6 fps), quase todos espera de GL.
- Correção nos docs: o nx.js 1.0.0-beta.7 roda V8, não QuickJS (o `Switch.memoryUsage()` é o `HeapStatistics` do V8).

**Parte 6: escolhas dos prints (decisões #50–#54, 03/11/2026)**

O Erick viu os prints da cena-vitrine e escolheu; o plano (`local/desenho-escolhas/PLANO.md`) rodou em 4 passos: a #52
sozinha, os contratos, 8 frentes em paralelo e a integração.

- **Luzes, sem contorno e filtro (#50):** Dia, Entardecer e Noite aprovados como estão, chão ao longe em
  `NEAREST_MIPMAP_LINEAR`. O contorno de time saiu inteiro: casco, desvio do shader, uniforms só dele
  (`RenderDebug.outline`/`outlinePx`, `GameDebugApi.setOutline`). Os bobos caem de 13 para 7 `InstancedMesh` por
  conjunto e o programa 4 de 9 para 2 uniforms próprios.
- **Bobos a 32 px/m (#51):** a pintura continua 64×64 (`composeSkin`); no loading o `expandSkin` (Scale2x face a face +
  grão de ±5%, o visual do print 2, por menos da metade do custo da skin de teste) amplia para 4 camadas 64×64 por
  skin, com o nível 1 = a pintura sem filtro. Layout da pintura por quadrante de 32×32, `skinparts@2` em ladrilhos
  (o `@1` é recusado com "rode npm run assets"; `partes64.png` 8,6 → 4,7 KB e decodificação ~3× mais rápida),
  `writeModelLayer(primeira, k camadas, nível 1)` em laço com profundidade 1, reserva de 64 camadas = 16 skins, cor do
  cubinho no nível 1, atlas do plano B com 3 níveis no `modelos64`. Saiu a skin de teste (`density.ts`,
  `densidade32.png`, `setSkinDensityTest`). O rosto fica na folha 8×8 (pergunta do M2).
- **Dose dobro jogável (#52):** as 7 props do dobro colidem, param bala, tapam a visão dos bots, entram na navegação e
  acendem luz (`isPlayableProp`; a chave `propDose` ficou só visual, para A/B de custo no bench). O barril do dobro foi
  0,3 m para oeste (religa um nó ilhado). O teto de grupos de props corta pela distância à superfície do grupo.
  **Golden, ponto de controle 1 (intermediário): `00f01aac`** (20 abates, 275 tiros, 10×10; com o barril no lugar
  antigo daria `8578936f`).
- **Bobos mais altos (#53), variante A = 1,625 m:** tronco 8×10×5, braços 3×9×3, pernas 4×8×4 px de pintura (cabeça
  8×8×8); corpo e AABB 1,625 m, olho 1,425 m. Agachado com a pose do format (`BOBO_CROUCH_POSE`,
  `crouchedPartBounds`): topo em 0,95 m, cabeça afundada 3 px, tronco a 36,9°; o rig do render e a hitbox da sim usam a
  mesma pose, e a hitbox agachada são caixas ORIENTADAS (a envolvente acertava ar em 7,9% dos tiros). Régua de
  métricas `print:altura` no Construto (porta, muro de 1,5 m, cobertura de 1,0 m, manequins `altura:em-pe` e
  `altura:agachado`, desenhados só com essa câmera); EYE das câmeras do mapa vem do METRICS; o `mapc` conta o nó em pé
  com 4 células e avisa "visto sem ver" (25 nós). Luz do ator e centro do corpo nos VFX pelo `bodyHeight/2`. As
  variantes B (1,75 m) e "antes" (1,5 m) só existem como prints numa cópia descartável.
- **Fontes (#54):** Russo One (display, "BoboForces Display") e Saira Condensed SemiBold (HUD, "BoboForces HUD"),
  nomes derivados sem o Reserved Font Name, com a guarda no fontbake; atlas de 119,5 KB baixados (era 141,1 KB com a
  Barlow), teto de 120 KB lido como PNG + JSON em gzip (decisão menor revisável). `licencas.txt` com as fontes em uso
  na web e no romfs do Switch. A comparação das candidatas virou a folha das fontes em uso (`showFontSpecimen`); o
  título do Switch ganhou a grade de 2 colunas com rótulos curtos. Saíram a Barlow, a Chakra Petch, as candidatas e a
  seção `local` do `runtime-assets.json`.
- **Prints:** roteiro de 43 → 26 PNGs (saem doses, mip, contorno e candidatas; entram altura, folha das fontes, HUD
  visível, títulos da web e do Switch e uma leitura com o atlas).
- **Golden, ponto de controle 2 (FINAL): `cf65a778`** (22 abates, 359 tiros, 13×9; igual com `--jitless`). Duas
  causas: a #53 (corpo, AABB e olho novos mudam colisão, visão dos bots e hitbox em pé) leva `00f01aac` → `4346c24a` no
  mesmo mapa; a régua tira 9 nós de navegação fora da área (7.174 → 7.165) e o passeio dos bots sorteia pelo número de
  nós, o que leva a `cf65a778`. A hitbox agachada não muda o golden (os bots Normal não agacham).
- Docs: `ARCHITECTURE.md` (§7, §8 com os contratos antes → depois e as pendências, §9 e §10), `arte-ux.md` (§1.2,
  §1.5, §1.6, §2.1, §2.2, §2.6–§2.8, §5.2, §6.2, §13), `tecnico.md` (§6.1, §6.5, §6.6, §7.1, §7.2, §8, §9, §16.3,
  §16.4, §22), `gameplay.md` §3.1, `CREDITOS.md` §3, `PERF.md` §1d, `TESTE_ZERO.md` §5 e `.interface-design/system.md`.
- **Correção da revisão (03/11/2026):**
  - O manequim `altura:agachado` saía EM PÉ no print oficial da régua: com a cena congelada o `dt` do rig é 0 e a
    transição de agachar não andava. Quem não é entidade da sim (`entity` 0) entra direto na pose; testes novos no
    `rig.test.ts` (agachado com `dt` 0 e manequim de pé que herda o índice de um agachado).
  - Régua sem paralaxe: plano z = 78,5 com a face de fora da cabeça dos manequins no plano das paredes, câmera a
    2,25 m (32 px por 12,5 cm em 1280×720, conferido nos três prints: topo do boné em y = 224 / 192 / 160 para
    1,5 / 1,625 / 1,75 m), fundo de concreto liso e cobertura de parede de teste (as marcas de 12,5/25/50 cm no plano).
  - `bfAtlasCorner` sem `mod` e com +0,5 na divisão: a conta antiga errava a linha na Intel UHD (ANGLE) com 7 e 13
    colunas; teste em float32 com a divisão 1–2 ULP abaixo. Rota do atlas no Eden: 59,1 fps, 7 programas, 0 erros.
  - Marcadores de setor: o 6 e o 9 ganharam um sublinhado (girado 180°, o 6 era o 9); teste de giro no texgen e o
    conjunto de prints 9 (`print:setores-norte`, `-sul` e `-4-5`, novas no `PRINT_CAMERAS`).
  - Fontes: o GitHub Pages não serve gzip -9 (+4,8% no JSON das fontes do M0); size-check e fontbake medem o JSON no
    nível 4 e o kerning começa em 0,25 px (1.357 → 1.120 pares, PNG igual): 119.605 B, folga de 395 B. Guarda do RFN
    com aspas simples e par casado, e falha fechada quando a declaração existe sem nome legível
    (`FontSpec.reservedNames`). Teste do título com o alvo de toque de verdade (e um alvo 640×360 com toque).
  - `licencas.txt` do Switch com o runtime do nx.js (MIT) e a Geist Mono (OFL) do RomFS dele; o cabeçalho diz o que
    ainda falta (as bibliotecas que o runtime embute).
  - Numeração dos prints na arte-ux §5.2 igual à do roteiro (6 fontes, 7 altura, 8 título, 9 setores).
  - **Golden: `372dcaea`** (22 abates, 231 tiros, 8×14; igual com `--jitless`): a régua tirou 4 nós fora da área
    (7.165 → 7.161) e o passeio sorteia pelo número de nós.

**Parte 7: port do boneco do FutBobo (decisões #55 e #56, 04–07/11/2026)**

O bobo do jogo passou a ser o boneco do FutBobo, com 1,75 m (4 cabeças, 32 px, cabeça de 0,4375 m). O bobo A (6 partes,
7 draws) saiu do código e dos assets. Plano, relatórios das frentes e medições em `local/futbobo-port/` (privado);
números com data e método no `docs/PERF.md` §1e; contratos no `docs/ARCHITECTURE.md` §8 e §11.

- **Altura B (passo 1, ponto de controle CP1):** `bodyHeight` 1,75, `eyeHeight` 1,55, `aabbHeight` 1,75 e `headSize`
  0,4375; as 5 aberturas do Construto (3 seteiras da cabine, a janela da guarita e a do 1º andar do prédio 1) de 1,5 para
  2,0 m. O "visto sem ver" do mapc caiu de 25 para 10 nós (faixa 1,55–1,81 m) e a pendência da lona de 1,5 m fechou.
- **format:** `figure*.ts` (FK afim de 12 ossos, pose de 34 chaves, 22 posturas, tabela de jogo com `slack` e `bulge`,
  IK, empunhaduras, cabelo de 34 cortes, gabaritos, `FigureLook`, 12 presets, pintor de 2 camadas em pixel art).
  `platform-profiles` ganhou `figureNearM`, `figureHalfRate` e `figureBotLooks`; 8 `skin:*` novos; mapa com pose
  `slide`, fila `linha:1..8`, `close:1|5`, `altura:deslizando` e as câmeras `print:linha-*`, `print:close-1m` e
  `print:altura-45` (o `.bfmap` continua `map@1`, com 10.214 B).
- **sim e IA:** 12 hitboxes por osso, lidas da tabela de jogo por postura × pitch (raio com a pose em cache: 0,18–0,39 µs
  com JIT); cabeça presa ao olho; agachado P4f com teto de hitbox de 0,97 m (era 0,95); a cabeça agachada só levanta (o
  agachado atrás de cobertura de 1,0 m não leva tiro além de 7 m em todo pitch); braços cortados a 0,75 m do eixo (muro e
  lona); IA mira a parte visível da caixa (teto de 2 miras por tick). `HitEvent.bodyPart` = `FigurePart` 0..11.
- **render:** 1 draw de bonecos por vista (R4c: cubo instanciado no programa 4, uma instância por caixa, 4ª linha da
  matriz com expressão e flash, `boundingSphere` fixa), sem programa, atributo ou uniform novo (7 programas); motor de
  animação com envelope medido, molas, LOD L0/L1/L2 e arma pela moldura da mira; desmonte em 6 grupos de ossos; viewmodel
  com os braços do boneco; `FrameViews` com a vista do dono (`uHideSlot`). Skins de 2 camadas (32 vagas na reserva de 64;
  Switch 10 skins, PC 19).
- **game e web:** etapa "figuras" no loading, `ActorBuffer` com `figure`, `posture`, `expression` e `velocity`, ganchos dos
  prints (`setMannequins`, `setFigureClip`), relatório do bench com `bonecos=`, `figure_lod` e `figuras=`; roteiro `rodada3`
  com 99 prints e 16 perguntas; `smoke:web` e `size-check` com as travas ligadas (`REQUIRE_ACTOR_DRAWS`, `RETIRED_ASSETS_FAIL`).
- **guard:** regra de laço quente (regra 11): alocação proibida entre `// quente:` e `// fim-quente`, e as regiões são
  obrigatórias em `figureFk`, `figureHitBoxes`, `figureGamePose`, `paintFigureSkin`, `rayVsBobo`, `anim/rig.ts` e
  `figure-instances.ts`.
- **Eden:** o emulador adia as instâncias N−1 de um draw instanciado e as desenha com o estado do draw seguinte (bonecos
  truncados; o caminho antigo também saía quebrado). Nenhuma opção da config corrige; contorno "F" (o mesmo draw sem
  instâncias com 1 primitiva logo depois de cada draw instanciado de 2 ou mais), ligado só por detecção a cada boot
  (`applyInstancingFix`, `apps/switch/src/main.ts`): sondas das figuras 20/108 → 108/108, custo dentro do ruído. No console
  a detecção deve dar "normal" (falta testar).
- **Golden:** **CP1 `079f5850`** (só a altura B e as 5 aberturas; o mapa e as métricas mudam o passeio e os tiros) e
  **CP2 `cb50303f`** (22 abates, 334 tiros, placar 8×14; igual com e sem JIT), que muda por causa das hitboxes por osso e
  da tabela de jogo (`9324de80`), da mira da IA e das métricas B; o corte dos braços e a cabeça que só levanta não mexeram
  nele (os bots Normal do golden não agacham). Antes do port: `372dcaea`.
- **Balance** (semente 42, 3.000 duelos): precisão 3,4 / 7,9 / 16,9 / 31,0 / 37,5% → 3,2 / 7,2 / 15,6 / 28,6 / 35,5%;
  headshot 35,4 / 46,4 / 57,6 / 55,7 / 66,1% → 41,7 / 39,0 / 44,5 / 46,4 / 59,4%; TTK 1,60 / 2,13 / 1,21 / 0,52 / 0,29 s →
  2,72 / 2,31 / 1,57 / 0,66 / 0,35 s. Ordem dos 5 níveis ok; par mais apertado 84,4%. Os multiplicadores de headshot ficam.
- **Saíram:** `skins/partes64.{png,json}` e a tira `skins/modelos64-rostos` (as camadas `faces` e `faces_zombie` nunca
  são reusadas), `format/model/skin*.ts`, `render/actors/{rig,bobo-geometry}.ts`, `fx/dismember.ts`, o gerador antigo do
  `skingen` e `assets-src/skins/`; `HITBOXES`, `aimPointHeight` e `crouchedPitch` da sim; `ActorBuffer.face`,
  `faceLayer`, `walkPhase` e `walkAmount`; a `skinparts` foi para os formatos aposentados. `npm run assets` agora é
  texgen → modelgen → mapc; script novo `npm run skingen:figuras` (prévia do pintor em `local/skins/`).
- **Tamanho:** primeira partida 533,0 → 518,5 KB, build 554,1 → 539,5 KB, menu 294,7 KB (motor, pintor e tabela fora do
  chunk do menu).
- **Roupa militar (#58):** saiu o uniforme de futebol (camisa, estampas, número, escudo, meião e chuteira; `figure-glyphs`
  e `figure-paint-shirt` apagados): `FigureOutfit` (tecido liso, woodland, deserto, urbano, noturno ou com graxa;
  jaqueta, calça, colete, botas e luvas) no lugar do `FigureKit`, `figureOutfitFor` com o colete de time e o ícone ▲ ● ■
  ◆, braçadeira, luvas e joelheiras do time (38,1–39,0% da frente na cor do time); membros em colunas, bota de combate,
  12 looks de farda e o roteiro `rodada4` com as perguntas R1–R4. Rodada 4 aprovada como está (#59).
- **Crédito do menu (commits do Erick de 03/11, depois do M0):** "EriLab™ / Erick Luiz". As fontes do M1 não têm o ™: o
  `drawText` o compõe com T e M a 0,48 em sobrescrito, escrevendo direto na lista como os outros glifos (sem alocação).
  `COMPOSED_CHARS` diz aos testes de cobertura (ui e fontbake) que o ™ conta como "TM".
- **Celulares (critério 5 do M1):** no site publicado, 1 vista e 12 bots por 3 min: Galaxy A36 a 60,00 fps e Galaxy A04s
  (no lugar do Redmi Note 13; Exynos 850, mais fraco) a 59,91 fps, p99 16,8 ms nos dois (`PERF.md`). Rodados em pé.
- **Console, 1ª tentativa (Teste Zero):** segurando R o jogo caía no boot (2168-0002) sem nenhuma linha no
  `runtime.log`: defeito do nx.js 1.0.0-beta.7 com o Sparkplug do V8 no JIT (issue #424 do nx.js). O build do Switch
  grava `romfs:/nxjs.ini` com `[v8] flags = --no-sparkplug` (`TESTE_ZERO.md` §8b); o Eden segue subindo igual.
- **Teste Zero no console** (`TESTE_ZERO.md` §8c, `PERF.md` §1b e §4): com o `nxjs.ini` o jogo abre segurando R.
  - Dock, 4 vistas e 12 bots por 10 min: **59,57 fps, p99 18 ms**. 1P com 24 bots no portátil: **57,55 fps**.
  - Zumbis: 58,84 fps. 48 bots: 59,21 fps. Heap máximo de 43,7 MB. GPU a 15 ms por frame na dock.
  - O loading reprova na 1ª cena depois do boot (4,98–5,04 s, com o JIT frio); da 2ª cena em diante fica em
    1,45–3,15 s.
  - O item 15 reprova (4–6 travadas nos primeiros 120 frames).
  - O bench do plano B fechou o jogo ~1 s depois de começar. Não reprova o Teste Zero, porque o array passou.
  - **Decisão #60:** o loading fica como está e o **M1 fecha**. A pré-malha, o aquecimento e a queda do plano B vão
    para uma rodada só de otimização, mais adiante.
- **Relógio do bench:** "Aquecendo" e "Medindo" mostram quanto falta da fase (" · faltam m:ss", `test.bench.timeLeft`),
  desenhado sem string por frame como o relógio do HUD; vale na web e no Switch. Pedido do Erick ao rodar no celular.
- **Pendente:** tabela de jogo no Eden (259 ms; meta ≤ 75, plano B = tabela gerada no build), skins no Eden (237 ms; meta
  180), emote no `ActorBuffer` (M2) e escala do zumbi na hitbox (M3). Para a rodada de otimização (#60): pré-malha e
  navegação no `.bfmap` (loading da 1ª cena no console), aquecimento mais completo dos shaders (item 15) e a queda do
  plano B no console.

### M0 Fundação (publicado em erereck.github.io/boboforces, P-002)

**Etapa 1: esqueleto e contratos**

- Monorepo com npm workspaces (`packages/*`, `apps/*`, `tools/*`), Node 24+, TypeScript 7 strict no padrão do VNbobo,
  Vitest com um projeto por pacote, Prettier (120, aspas simples), `scripts/typecheck.ts` em paralelo.
- Pacotes: `shared`, `format`, `platform-api`, `input`, `world`, `nav`, `sim`, `ai`, `ui`, `audio`, `render`, `game`.
  Os puros compilam sem DOM e sem Node (`tsconfig.src.json`).
- Apps: `apps/web` (Vite, `base: './'`) e `apps/switch` (esbuild, NACP com title ID `01E1AB0B0B0F0000`).
- Tools (esqueleto): `texgen`, `fontbake`, `balance`, `guard`, `portcheck`, `size-check`.
- `shared` completo e testado: math sem alocação (vec3, ângulos, quantização u16/i16), RNG sfc32 com fluxos por
  domínio (`fork`), `Pool`, `IndexAllocator`, `RingBuffer`, `BitWriter`/`BitReader`, hash FNV-1a + `StateHasher`,
  `assert` e log com anel de erros recentes.
- Contratos: `Platform` e peças; `RawInputState`, ações, `InputFrame` (88 bits); grade/célula/chunk/registro de blocos,
  DDA, AABB e `buildChunkMesh`; `Sim`, `SimView`, `SimEvent`, `EntityId`, métricas canônicas e perfil Bobo, `FixedStep`;
  `MatchRecipe@1`, ids de formato e de conteúdo; `UiNode`, `DrawList`, tema escuro, `strings.pt-BR.ts`; `Renderer`;
  `startGame` com `NullRenderer`.
- Versões fixadas: three 0.187.0, fflate 0.8.3, vite 8.3.5, vitest 5.1.0, esbuild 0.28.2, prettier 3.9.10,
  typescript 7.0.2, @nx.js/* 1.0.0-beta.7, msdf-bmfont-xml 2.8.0, playwright-core 1.64.1.
- Docs: `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/PORTABILIDADE.md`, `docs/PERF.md`, `docs/DEPENDENCIAS.md`,
  `docs/PROMPTS.md`, `version.json`.

**Etapa 2: frentes em paralelo**

- `world`: DDA (`raycastGrid`), AABB varrida com degrau de 0,5 m, formato RLE + deflate, arena de teste e greedy
  meshing por textura (vértice de 12 bytes). `sim`: movimento do perfil Bobo, fuzil hitscan com recuo, dano por parte,
  morte, respawn, regras do Warfare, snapshot e hash. `ai`: bot mínimo (percepção, mira com erro e recuo, 5 níveis).
  Golden: 8 bots, semente 42, 3.600 ticks, hash `f991a92c`. `tools/balance`: 3.000 duelos, ordem dos 5 níveis.
- `format`: validador da `MatchRecipe@1` (tetos da plataforma, fallbacks, campos desconhecidos mantidos), migrações,
  perfis de plataforma, PNG próprio (decodificador e codificador). `input`: mapeador (zona morta radial, curva,
  aceleração na borda, toque), slots locais, menu por qualquer dispositivo; adaptadores web (teclado, pointer lock,
  Gamepad API, toque).
- `render`: three só aqui; blocos em `TEXTURE_2D_ARRAY`, atores instanciados, 1 a 4 viewports por scissor, céu por
  uniforms. `tools/texgen`: paleta mestra e as 8 primeiras texturas 16×16. `ui`: layout por âncoras, foco espacial,
  texto MSDF (Barlow Condensed provisória), título e Ajustes; `tools/fontbake`.
- `apps/switch`: platform-switch completa (save no SD com backup, `runtime.log`, aviso sem GPU), scripts NRO/NSP;
  `tools/guard`, `tools/portcheck`, `tools/size-check`, CI e deploy do Pages. `apps/web`: splash inline, avisos de
  navegador, platform-web.

**Etapa 3: integração**

- `game`: boot (assets pela `platform.assets`) → título WebGL → JOGAR → cena de teste (jogador em 1ª pessoa no
  teclado/mouse com pointer lock, controle ou toque, trocando pelo último dispositivo usado; 4 bots; atores em
  caixas; HUD com vida, abates, munição e retícula em MSDF) → pausa (pointer lock perdido, aba oculta, P/Esc, Start/+,
  botão de toque) → volta ao título. `LocalDriver` com passo fixo e interpolação; com o NullRenderer roda igual.
- Cascas: `apps/web/src/main.ts` (boot depois do primeiro pixel, pointer lock no clique, gancho `window.__bfDebug`) e
  `apps/switch/src/main.ts` (textos pela tabela pt-BR, "Sair" no título). Assets por caminho lógico
  (`assets-src/runtime-assets.json`): Vite serve/emite e faz preload; o build do Switch copia para o RomFS.
- Contratos: `Renderer.setUiAtlas`, `@boboforces/render/data` (sem three), `GraphicsSurface.safeArea`,
  `GameDeps.hooks` (ver `docs/ARCHITECTURE.md` §8). Textos para todos os `ISSUE_CODES` e `binding.ctrlReserved`.
- Atlas da UI 21% menor (display só caixa alta, PNG RGB): 170 → 134 KB, carga inicial 375 → 338 KB (orçamento 350).
- CI: portcheck `--strict` (boot até o menu) e `npm run balance`; teste do bundle REAL do Switch no portcheck.
  `npm run smoke:web`: build no Edge headless (splash, título, cena, pausa, programas ≤ 7, zero erros).
- Dependências de workspace declaradas: `fflate` no `world`, `@boboforces/ui` e `@boboforces/format` no
  `fontbake`, `@boboforces/ui` no `apps/switch`. Nenhuma dependência externa nova.

**Etapa 4: correções da revisão independente**

- Golden `f991a92c` → `e3f37a6e` (mudança intencional na sim e na IA, motivos abaixo). `npm run balance` segue com a
  ordem dos 5 níveis.
- `sim` independente do passo (o Switch pode cair para 30 Hz sem rebalancear): `createSim({ hz })` e `Sim.hz`; atrito
  exponencial exato (`friction` 16 → 18,5 para manter ~0,25 s até parar, agora ~0,26 m deslizando a 30 e a 60 Hz);
  deslocamento no plano integrado sem erro de passo; cadência das armas em segundos com o resto do tick passando para o
  tiro seguinte (antes 700/min virava 600/min a 30 Hz). A IA e o `LocalDriver` recebem o mesmo `hz`.
- Degrau para baixo: no chão, o bobo gruda para descer degraus de até 0,5 m (antes ficava ~0,4 s no ar numa escada de 3
  degraus, com dispersão de pulo, evento de pouso e a IA sem poder pular).
- Respawn: morto exatamente `respawnS` (180 ticks em vez de 179) e pelo menos 1 tick com `respawnS = 0` (antes morria e
  renascia no mesmo tick, sem a IA nem o render verem a morte).
- IA: o orçamento de 4 raios da percepção vai para os inimigos mais próximos no cone, não para os de índice menor.
- Passo fixo com folga de 2% de tick: frame igual ao tick (ou múltiplo) roda sempre 1 (ou 2) ticks, em vez de 0/1/2 com
  o jitter do relógio. O `game` mede o frame pelo timestamp do rAF.
- `game` compila sem a lib DOM (importa do render só `@boboforces/render/data`); câmera com o mesmo limite de pitch da
  sim (mira a 89° + recuo não vira mais a imagem).
- Guard: colchete, cast, alias, desestruturação e `Reflect.get` da raiz global; escopo por bloco nas declarações;
  regra 10 por lista branca (`Math` só com as funções puras); `toLocaleUpperCase/LowerCase`; `.constructor(…)` e
  `setTimeout` com texto; `import()` não literal até em `apps/web`; `import.meta` fora das cascas; mais globais do
  navegador; float/half-float e textura comprimida do three. Teste de workspaces: todo projeto do Vitest roda os
  seus testes (a raiz não usa mais `passWithNoTests`; `audio` e `nav` ganharam teste).
- Portcheck: `fetch` é rede no bundle do Switch; acha nomes proibidos pela raiz global e entre colchetes.
- `render`: atores sem faixa de upload e UI com faixa fixa (sem objeto novo por frame no `addUpdateRange` do three);
  teste de shaders cobre todos os exportados (UI incluída, `texelFetch`).
- Switch: aviso de falha no boot COM GPU sai pelo próprio WebGL2 (fonte bitmap 5×7 com scissor + clear), porque o
  canvas já é WebGL2 e não dá 2D; HOME/sleep detectado pelo vão a partir do FIM do frame (entrar na partida não pausa
  mais); exportar grava em `exportar/` (não sobrescreve `save.json` nem o log).
- `Storage.getBackup(key)` no contrato da Platform, por chave nas duas plataformas (Switch: `save.previous.json`),
  com um teste de contrato único rodado pelas duas cascas.
- Web: erro depois do menu também mostra a página "Não deu para carregar" (o splash volta por cima da canvas).
- CI: `smoke:web` no navegador (Edge headless; também em 667×375). Deploy do Pages só depois do CI passar
  (`workflow_run`), sem pular formatação, build do Switch, portcheck e balanceamento.

**Etapa 5: conferência final**

- UI: o menu aplicava a escala de referência duas vezes (`layoutTree` recebia a escala final no lugar do tamanho
  escolhido pelo jogador). Em 1280×720 não aparecia; em 667×375 os botões encolhiam e o texto passava por cima deles.
  `UiFrame` ganhou `userScale` (1 no M0).
- Web: os px exatos do aparelho (`device-pixel-content-box`) só valem se baterem com CSS × DPR. A emulação de DPR do
  Chromium headless informa o box sem escalar e o canvas saía em 1x num aparelho 2x.
- Antes da publicação (auditoria de segredos, licenças, CI e higiene): o build da web gera `licencas.txt` com o
  LICENSE de cada pacote npm que entrou no bundle (three, fflate) e a OFL da Barlow, linkado no `index.html`
  (`rel=license`); `.gitignore` ignora qualquer `*.keys`; README, README do Switch, PROMPTS, CREDITOS e DEPENDENCIAS
  atualizados (status do M0, Node 24+, dependências indiretas do nx.js usadas pelos scripts locais).
- Publicado: commit `b01de7b` em `erereck/boboforces` (público), CI verde no primeiro push (Edge do runner, sem
  fallback) e deploy do Pages ok. Splash na URL publicada em 432 ms (primeira visita): os 4 critérios de pronto do M0
  estão cumpridos. `smoke:web` ganhou `--url` para medir um site publicado.
