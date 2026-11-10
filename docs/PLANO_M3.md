# Plano do M3: Sofá e Bobo Zombies (09/11/2026)

> Fonte: `docs/GDD.md` §3.6, §4.1.5 e §7; `docs/design/gameplay.md` §5.4, §6.11 e "Bobo Zombies (M3)";
> `docs/design/tecnico.md` §10 e §24; `docs/design/arte-ux.md`. `docs/DECISOES.md` manda sobre este plano. O M2 foi
> publicado em 09/11/2026 (#72); o roteiro do celular e o checkpoint do Switch dele correm em paralelo, com o Erick.

## Objetivo

**Jogar junto no mesmo sofá.** Até 4 jogadores locais na web, com controles (o teclado e o mouse contam como um slot),
entrando pela tela "aperte A", em tela dividida, e o **Bobo Zombies** estilo CoD: ondas, pontos, armas na parede,
barricadas, portas, Caixa Misteriosa, vantagens, caído e reviver, especiais e o chefão, num mapa próprio (Base
Abandonada, à noite). É o ensaio do Switch no PC: tudo o que entra aqui vai para o console no M4.

O M2 deixou pronta a base: as 8 armas, TDM/FFA completos, IA N1–N4, menus, Laboratório, Meu Bobo, áudio, a tela
dividida da cena (1 a 4 vistas, `pcSplit` e `switch34p`), o `LocalPlayers` do input (slots, reserva por desconexão) e o
teste do sofá no Switch (um humano por controle, sem lobby).

## Critério de pronto (GDD §7)

1. **4 controles no PC** dentro do orçamento (`pcSplit`: 24 bots armados ou 40 zumbis, `gameplay.md` §6.11).
2. **Bobo Zombies de 10 ondas** jogável solo e com 4, do começo ao fim, com especiais e o chefão.
3. **Checkpoint no Switch** com 4 controles reais e o Zombies a 30 fps (o NRO do M3).
4. **Prints aprovados pelo Erick**: lobby, tela dividida 2–4P, zumbis, Base Abandonada, compras e HUD do Zombies.
5. Como nos marcos anteriores: `npm run check`, builds, `portcheck --strict`, `smoke:web`, golden e balance verdes;
   menu ≤ 350 KB (o Zombies entra no chunk da cena, não no menu).

## O que entra

| Área | Entrega |
|---|---|
| Sofá (`input`, `game`, `ui`) | Tela "aperte A" (até 4; teclado e mouse = 1 slot) com perfil por slot (nome, cor, sensibilidade, assistência, inverter Y, botões); o P1 escolhe o modo e os outros o time; entrar no meio segurando A por 1 s (entra no time com menos humanos, assume um bot); sair pela pausa (um bot assume); controle desconectado pausa e reserva o slot |
| Tela dividida (`game`, `render`, `ui`) | Layouts 1 / 2 (cima e baixo; lado a lado como opção) / 3 (2×2 com placar e minimapa no 4º) / 4; borda e anel no chão na cor do jogador (P1 ▲, P2 ●, P3 ■, P4 ◆); HUD 3–4P; radial da arma para todos; resultado e estatísticas somando os locais (#68) |
| Áudio no sofá (`audio`, `game`) | Cada som usa o ouvinte local mais perto; volume "meus sons" por jogador; vibração por controle |
| Zombies na sim (`sim`) | Entidade zumbi (N0, mais barata que o soldado), ondas pela fórmula do GDD, pontos, caído e reviver (30 s, rastejando com a pistola, 3 s para levantar), "levanta sozinho" no solo, último zumbi com marcador, derrota com todos caídos, durações Relâmpago/Curta/Infinita |
| Entidades do mapa (`sim`, `world`) | Barricadas de 6 tábuas, portas e escombros pagos, armas na parede, Caixa Misteriosa (3 posições), máquinas de vantagem; tudo entidade com estado (não cenário) |
| Navegação (`nav`, `ai`) | Flow field compartilhado até os humanos, com colisores dinâmicos (portas que abrem, barricadas); zumbis entrando pelas janelas; especiais (Sprinter, Chonker, Spitter) e o chefão Mega Bobo; bots Suporte completando até 4 (atiram, consertam, revivem) |
| Economia | Pontos (acerto 10, kill 60, cabeça 100, faca 130, tábua 10 até 50 por onda), preços, drops (munição, bomba, pontos em dobro, insta-kill, carpinteiro; 2% e até 4 por onda), vantagens (Chonky Cola, Speedy Soda, Buddy Brew) e a arma maravilha |
| Mapa (`assets-src/maps`, `mapc`) | **Base Abandonada** (noite): base militar cartunesca, janelas para barricar, áreas que abrem por portas pagas, holofotes na cerca; visão até 50 m (roda no Switch 3–4P) |
| Arte | Bobos-zumbi (esverdeados, curvados, engraçados; variantes dos especiais e o gigante), gosma de cubinhos, tábuas, portas, caixa, máquinas, contorno de giz das armas na parede, iluminação noturna |
| Dados e menus | `MatchRecipe` do Zombies (quantidade 0,5–3×, velocidade, HP, especiais e chefões, economia, "levanta sozinho"), presets de fábrica, recorde de onda por mapa e configuração, cards no Partida Rápida |
| Áudio do Zombies | Sons dos zumbis, das compras e das ondas; música de Zombies em camadas (o download pede o OK do Erick) |

## Fases

Uma de cada vez, nesta ordem; cada fase termina verde e commitada; as visuais terminam com prints para o Erick.

1. **Sofá:** a tela "aperte A" e os slots no lugar do teste do sofá, perfis por slot, entrar no meio, sair, desconectar,
   tela dividida com identificação, HUD 3–4P, radial para todos, áudio e vibração por jogador. Vale para TDM, FFA e
   treino desde já.
2. **Zombies na sim:** zumbi, ondas, pontos, dano, caído e reviver, derrota e vitória, num mapa de teste (o Construto
   fechado), com golden e um robô de balanceamento das ondas.
3. **Navegação e IA dos zumbis:** flow field com colisores dinâmicos, barricadas e janelas, especiais e o chefão; bots
   Suporte.
4. **Economia:** compras na parede, portas, Caixa Misteriosa, vantagens, drops e a arma maravilha; HUD de pontos e de
   compra.
5. **Base Abandonada:** o mapa, a noite e a arte dos zumbis e das peças; prints.
6. **Menus, dados e áudio do Zombies:** receita, presets, configuração, recordes; sons e a música em camadas.
7. **Fechamento:** bench com 4 controles no PC, NRO com 4 controles e o Zombies no Switch, roteiro, prints e
   publicação (com o OK do Erick).

## Fase 1 em detalhe: sofá

- **1a. Assentos na partida** (feita em 09/11/2026, ARCHITECTURE §13.1): `SceneRequest.seats` (dispositivo e time
  de cada jogador local, até 4) no lugar do `localPads` do teste do sofá. A partida cria um mapeador por assento (controle ou teclado), cada humano no time do
  seu assento (a receita ganha os `humans` por time) e o P1 também fica preso ao dispositivo dele. O Switch continua
  automático (um assento por controle completo) até a 1b.
- **1b. Tela "Jogar no sofá"** (feita em 09/11/2026, ARCHITECTURE §13.2): entrada no menu principal (no título, o JOGAR continua solo, para ninguém virar P2 sem
  querer ao pegar outro controle). Quatro cartões: "Aperte A para entrar" (Enter no teclado); entrou, mostra P1 ▲, P2 ●,
  P3 ■ ou P4 ◆ na cor do jogador, o dispositivo e o time (cada um troca o seu com ◀ ▶); B sai. O P1 escolhe a partida
  (o preset do JOGAR, com troca entre os prontos) e o Start (ou COMEÇAR) inicia. Enquanto houver sofá, só o P1 navega
  nos menus. No Switch o teste do sofá automático sai e entra esta tela.
- **1c. Na partida** (feita em 09/11/2026, ARCHITECTURE §13.3; só nas partidas da tela do sofá): entrar no meio segurando A por 1 s num controle livre (assume um bot do time com menos humanos; a
  tela se redivide); sair pela pausa (um bot assume); controle desconectado pausa e reserva o assento até ele voltar;
  pausa, tela de morte e radial da arma em cada vista.
- **1d. Vistas** (feita em 09/11/2026, ARCHITECTURE §13.4: o anel virou marcador em cima da cabeça; o minimapa ficou
  para a fase 5): borda e símbolo na cor do jogador, anel no chão sob cada humano local, 2 jogadores lado a lado como
  opção (Ajustes → Tela), placar e minimapa no 4º quadrante com 3 jogadores.
- **1e. Por jogador** (feita em 09/11/2026, ARCHITECTURE §13.6; nome e cor fixos por número, volume "meus sons" para
  depois): perfil local por assento (nome, cor, sensibilidade, assistência, inverter Y), vibração por
  controle, cada som pelo ouvinte local mais perto e o volume "meus sons".
- **1f. Rodada 13 de prints** (lobby e tela dividida 2–4P), publicada para o Erick revisar.

## Perguntas para o Erick (sigo no padrão enquanto ele não responde)

| # | Pergunta | Padrão |
|---|---|---|
| I1 | **Nomes provisórios do M3** (pendência 5 do GDD): Sprinter, Chonker, Spitter, Mega Bobo; Chonky Cola, Speedy Soda, Buddy Brew; Base Abandonada; a arma maravilha ("Desmontador", raio que desmonta o zumbi em cubinhos) | Ficam como estão (IDs internos estáveis) |
| I2 | **Ordem do M3** | Sofá primeiro (é menor, aproveita o teste do sofá e o Zombies já nasce com 4 jogadores) |
| I3 | **Música do Zombies** | Procurar uma faixa CC0 com camadas (ou duas faixas que se somem) e pedir o OK do download com nome, origem e tamanho na fase 6 |
| I4 | **Teclado e mouse na tela dividida da web** | 1 slot, como na tabela do DECISOES; os outros com controle |

## Escolhas do Claude neste plano (revisáveis)

- **A tela "aperte A" substitui o teste do sofá:** o Switch passa a usar o mesmo lobby da web, e o teste do sofá some.
- **Mapa de teste antes da Base Abandonada:** a sim e a IA dos zumbis nascem no Construto (fechado por paredes), para
  o mapa não travar a lógica.
- **Zumbi = bobo com outra figura e outra IA:** reaproveita corpo, hitboxes e o boneco do FutBobo (curvado pela pose),
  sem um esqueleto novo; o chefão é o mesmo boneco em escala.
- **Trabalho econômico** (pedido do Erick): fase por fase, direto na sessão; subagente só para tarefa mecânica ou
  revisão de escopo fechado.

## O que precisa do Erick

- As perguntas I1–I4 (sigo no padrão).
- O OK para cada download (sons e música do Zombies), com nome, origem e tamanho.
- Aprovar os prints ao fim das fases visuais.
- No fechamento: o Switch com 4 controles e o OK para push e deploy.

## Fora do M3

Port completo do Switch com a LOCAL EDITION, save no SD e o resto do M4; online (M5); Armed Horde, Fortress e os modos
de festa (M6+); a rodada de otimização (#60, quando o Erick quiser).
