# Plano do M8: compartilhar, o Diretor e o Arcade (19/11/2026)

> Fonte: `docs/GDD.md` §3.3 (o Surpreenda-me), §4.2.2 (o perfil Arcade), §4.4.3 e §4.4.4 (a Oficina, os esquadrões, o
> Nêmesis, as ordens e o Diretor de Partida), §4.8 (os códigos) e §7 (o roadmap "M6+"); `docs/design/gameplay.md`
> §3.3, §6.6 a §6.10 e "Surpreenda-me"; `docs/design/tecnico.md` §14.3. `docs/DECISOES.md` manda sobre este plano.
> Escrito no padrão do #80 e do #81 ("pode seguindo sem parar"), com o M7 fechado: abrir o M8 é uma decisão menor
> revisável até a resposta do Erick (pergunta Z1).

## Objetivo

**O que sobrou do "M6+" do roadmap**, menos o Bobo Sandbox:

- **compartilhar:** a Oficina com códigos e links (o bot `BF1-` / `#bot=`, o preset `BFP1-` / `#p=`), os
  **esquadrões** (grupos de bots com nome) e o **Surpreenda-me** completo (todos os modos, o cadeado por linha e a
  semente como código);
- **os bots em volta do jogador:** o **Nêmesis com memória** entre partidas, o **Diretor de Partida** (ajusta só os
  bots para manter a partida no nível escolhido) e as **ordens aos bots aliados** (a roda);
- **o perfil Arcade completo** (pulo duplo, bunny hop, wall jump, slide com momento, sem dano de queda), que também
  vira o modificador Arcade.

O **Bobo Sandbox completo** (as Ferramentas do Dono pedem comandos do dono na sim) e os modificadores **Mini**, **Bots
gigantes** e **Ricochete** ficam para o M9 (pergunta Z1).

## Critério de pronto

1. **Cada peça sozinha com bots, no sofá, no online e no Switch,** ou marcada `switch: não` / `online: não` com o
   motivo (os códigos e os links são da web: o Switch não cola texto e segue com os arquivos do SD, tecnico.md §14.3).
2. **Testes:** os códigos vão e voltam (bot, preset, esquadrão, semente) e recusam o que passa do limite, o que não
   valida e a "bomba" de inflate; o Diretor e as ordens pela sim headless com bots; o Arcade com o golden do perfil Bobo
   e do Tático sem mudar e um golden novo com o Arcade; pela rede de mentira, o amigo termina igual ao host.
3. **O portão inteiro verde:** o menu da web continua ≤ 350 KB (o que é novo mora nos pedaços dos editores e da cena),
   o Switch passa no `portcheck` e o build inteiro cabe no orçamento do `size-check`.
4. **Publicado a cada fase verde** (#80, #81), com uma rodada de prints a cada duas fases.

## O que já existe

| Peça | Onde |
|---|---|
| O `fflate` (deflate e inflate com teto, anti-bomba) | `packages/format/src/model/codec.ts`, `map/codec.ts` |
| Os validadores de bot e de receita (com `embeddedBots`) e o backup | `packages/format/src/bot.ts`, `match-recipe.ts`, `backup.ts` |
| A importação da Oficina pelo SD (Switch) e o backup da web | `packages/game/src/workshop-files.ts`, `save-store.ts` |
| O link da sala (`#sala=`) lido uma vez na casca e limpo da barra | `apps/web/src/main.ts`, `packages/net/src/room-code.ts` |
| O relatório que já apaga `#bot=` e `#p=` | `apps/web/src/platform/diagnostics.ts` |
| O Surpreenda-me simples (TDM ou FFA no Construto) | `packages/game/src/presets-ui.ts` (`rollSurprise`), `ui/src/screens/surprise.ts` |
| O Nêmesis do resultado e o "Salvar na Oficina" | `packages/game/src/scene/result.ts`, `result-screen.ts`, `game.ts` (`saveNemesis`) |
| O nível dos bots ao vivo (o "Ajustar desafio") | `packages/ai/src/director.ts` (`setLevel`), `soldier.ts` (`SoldierBrain.setLevel`) |
| O ping humano, o quadro do time e o bot Suporte | `packages/sim/src/systems/signals.ts`, `ai/src/team.ts`, `ai/src/persona.ts` |
| Os campos do Arcade no perfil de movimento (ainda sem uso) | `packages/sim/src/config/movement.ts` (`bhop`, `wallJump`, `doubleJump`) |
| O radial da tela de morte (o molde da roda de ordens) | `packages/game/src/scene/death.ts` e a cena |

## Fases

Uma de cada vez; cada fase termina verde, revisada (um revisor Opus), commitada e publicada.

0. **O código comum** (`packages/format`): base64url, o envelope `BF1-` / `BFP1-` (e os dos esquadrões e da semente)
   sobre o JSON com deflate, o inflate com teto (anti-bomba), o limite de 4.000 caracteres e o resumo do que caiu em
   fallback; o filtro de nomes também na importação.
   - **feita em 19/11** (ARCHITECTURE §19.1): o formato, os links, a importação e o filtro de nomes (ainda sem tela).
1. **A Oficina com códigos:** "Copiar código" no bot e no preset (a área de transferência da web), "Colar código" (o
   campo de texto escondido da web) com o resumo antes de salvar, e os links `#bot=` / `#p=` (lidos uma vez na casca,
   como o `#sala=`, e limpos da barra). No Switch, os arquivos do SD como hoje.
2. **Os esquadrões:** o formato `squad@1` (nome e bots, até 16 entradas), a lista e o editor na Oficina, o uso nos
   times da Partida personalizada (o preset leva os bots expandidos, para quem recebe não precisar do esquadrão), o
   backup e o código.
3. **O Surpreenda-me completo:** o sorteio de todos os modos com card (a regra de cada um), os mapas de cada modo, as
   armas, 0 a 3 modificadores e 0 a 2 bots "estrela"; o **cadeado** por linha (navegável no D-pad e no toque) e a
   **semente** como código (com a versão da tabela do sorteio). A tela sai do pedaço do menu.
4. **O Nêmesis com memória:** o bot que mais te matou fica guardado (quem é, quantas vezes te pegou, quantas você o
   pegou de volta); quando ele volta numa partida, a contagem do começo avisa ("Seu Nêmesis voltou") e o resultado
   mostra o placar da rivalidade. Sem mudar a IA (pergunta Z3).
5. **O Diretor de Partida:** o bloco `director` da receita (desligado, Relax, Equilibrado, Desafio); mede os humanos
   numa janela de 3 min (a cada 10 s, nos ticks da sim) e ajusta só os bots, no máximo 1/4 de nível a cada 30 s e
   dentro de ±1 nível (a mira dos bots entre dois níveis); o ícone no placar ("Diretor: bots −½"); na Partida
   personalizada e na pausa. No online, só o host (pergunta Z4).
6. **As ordens aos bots aliados:** a roda (Vem comigo, Segura aqui, Ataca ali, Me cobre / Me revive) num botão; o N0 e o
   N1 ignoram, do N2 para cima obedecem pela **lealdade** (um campo novo da personalidade, com o padrão de cada preset);
   o ping dos humanos também passa a valer para os bots. A ordem viaja na rede (`PROTOCOL_VERSION`).
7. **O perfil Arcade:** a tabela do GDD §4.2.2 (andar 5,5 e correr 8,0 m/s, pulo 1,3 m com pulo duplo, bunny hop de
   +5% por pulo até 12 m/s, wall jump uma vez por parede, slide que mantém o momento, mantle até 2 m, sem dano de
   queda, atira correndo com o espalhamento "no ar"); o modificador Arcade; os bots não fazem bunny hop nem wall jump
   (gameplay.md §3.6). O estado novo entra no snapshot e na predição do cliente.
8. **Fechamento:** o portão, a rodada de prints final, o `CHANGELOG`, a `ARCHITECTURE` e o `PERF`.

## Perguntas para o Erick (sigo no padrão enquanto ele não responde)

| # | Pergunta | Padrão |
|---|---|---|
| Z1 | **O que entra no M8:** compartilhar (códigos, esquadrões, Surpreenda-me), o Nêmesis com memória, o Diretor, as ordens e o Arcade; o **Bobo Sandbox** e os modificadores **Mini**, **Bots gigantes** e **Ricochete** ficam para o M9. | Assim |
| Z2 | **Os códigos e os links são só da web:** o Switch não cola texto (nem tem rede) e segue com os arquivos `.json` do SD; o código de um bot criado no Switch sai pelo backup no SD. | Assim |
| Z3 | **O que o Nêmesis lembra:** quem é, quantas vezes te pegou e quantas você o pegou; quando ele volta, a contagem do começo avisa e o resultado mostra a rivalidade. A IA não muda (um Nêmesis que "te persegue" mudaria a partida e os goldens). | Assim |
| Z4 | **O Diretor no online:** só o host liga e só os bots mudam; o ícone aparece no placar do host (os clientes veem "Diretor ligado" no lobby). | Assim |
| Z5 | **Código grande demais** (um preset com 16 bots embutidos pode passar dos 4.000 caracteres): recusar com a mensagem "Grande demais para código: use o backup". | Assim |
| Z6 | **A lealdade** (quanto o bot obedece a ordem): Suporte e Leal 100%, Normal 70%, Rusher e Palhaço 40%, Covarde 50% (no "Ataca ali") e Camper 30% (no "Vem comigo"); o Laboratório ganha o slider. | Assim |
