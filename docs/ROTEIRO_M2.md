# Roteiro do fechamento do M2: celular e Switch (09/11/2026)

> Para o Erick seguir. Critérios 5 e 6 do `PLANO_M2.md` (checklist manual no celular e checkpoint no Switch); o resto
> do critério está medido no `PERF.md`. Anote ao lado de cada item: **ok**, **estranho** (com uma frase) ou **quebrou**.
> No fim, mande o relatório (celular: Ajustes › Sobre › Copiar relatório; Switch: `sdmc:/switch/boboforces/runtime.log`).

## 1. Celular (Galaxy A36 e, se der, o A04s do seu amigo)

Antes: o site publicado tem que estar na versão nova (o deploy espera o seu OK). Abra pelo navegador de sempre (Brave
ou Chrome), deitado.

| # | O que fazer | O que esperar |
|---|---|---|
| 1 | Abrir o site pela primeira vez, com Wi-Fi | Splash e título em até 4 s. Em pé: aviso "Gire o celular" |
| 2 | Ajustes › Vídeo › Qualidade | "Automática: Média" no A36. O A04s deve dar "Automática: Leve" pela memória (o Brave esconde a GPU) |
| 3 | Tocar em JOGAR | Partida em até 10 s; os dedos-fantasma mostram as zonas nas primeiras partidas |
| 4 | Andar, mirar, atirar, ADS, recarregar, trocar de arma, faca, granada (segurar e soltar) | Tudo pelo toque, sem botão escondido atrás do dedo |
| 5 | Morrer de propósito | Câmera de morte; tocar numa arma do radial escolhe a do próximo spawn |
| 6 | Pausa (botão do canto) › Ajustar desafio › Mais fácil | Os adversários mudam de nível; Continuar volta para a partida |
| 7 | Jogar até o fim (ou Sair da partida) | Resultado com MVP, Nêmesis, prêmios bobos e os botões De novo, Mais fácil, Mais difícil, Mudar regras |
| 8 | Partida Rápida › Bobo Training › Ringue | Alvos e o relatório de precisão no fim |
| 9 | Laboratório: criar um bot, mudar a habilidade, "Testar no Bobo Training" | Abre o treino em até 2 s com o bot novo |
| 10 | Meu Bobo: trocar cor, cabelo, uma fantasia | O boneco muda na hora; volta salvo depois de fechar o site |
| 11 | Ajustes › Áudio: baixar a Música; Ajustes › Vídeo: Limite de quadros 30 | Música do título mais baixa; o celular esquenta menos |
| 12 | Fechar o navegador, ligar o **modo avião**, abrir o site de novo | Abre e joga sem internet (o service worker guardou tudo; só a música pode faltar se nunca tocou) |
| 13 | Ajustes › Sobre › Copiar relatório | Cola o texto aqui no chat |
| 14 | **A04s (Android de entrada):** abrir `…/boboforces/bench/?views=1&bots=12&duration=180` | Relatório com **30 fps ou mais** (critério 4); copie e mande |

## 2. Switch: checkpoint de 1 a 2 h de jogo solo

Build: `apps/switch/build/BoboForces-0.0.1.nro` (copiar para `sdmc:/switch/boboforces/BoboForces.nro` e abrir pelo
homebrew menu **segurando R**), ou o NSP, se você preferir gerar com as suas chaves (`npm run nsp -w @boboforces/switch
-- -k <caminho do prod.keys>`).

| # | O que fazer | O que esperar |
|---|---|---|
| 1 | Abrir na dock | Menu em até 4 s; a música começa no título |
| 2 | Deixar o título tocando por 2 min | A volta do loop (aos 85 s) sem estalo nem pulo |
| 3 | JOGAR (TDM 6v6) | Loading da 1ª cena perto de 5 s (conhecido, #60); da 2ª em diante, mais rápido |
| 4 | Jogar com cada arma | Sons de tiro, passos, explosões, hitmarker; nada mudo nem estourado |
| 5 | Tirar da dock no meio da partida | Pausa sozinho; continua no portátil |
| 6 | HOME e voltar; pôr para dormir e acordar | Pausa e volta sem perder a partida nem o som |
| 7 | `+` | Pausa (nunca fecha o jogo); sair só pelo menu |
| 8 | Laboratório: dar nome a um bot | Abre o teclado do sistema |
| 9 | Partida Rápida: FFA, Bobo Training, Ringue | Todos abrem e terminam |
| 10 | Jogar 1 a 2 h, como der | Sem fechar sozinho, sem travar; anote se esquentar muito |
| 11 | **Sofá (opcional):** Mudar → Jogar no sofá; cada amigo aperta A no controle dele, escolhe o lado (esquerda e direita) e o P1 começa | Uma vista por jogador; B tira o jogador; sair da partida volta para a tela do sofá |
| 12 | **Teclado USB (opcional, #73):** na dock, plugar um teclado e jogar | WASD anda, as **setas miram**, **Ctrl direito** ou **F** atira, **Shift direito** ou **Z** mira; Enter e Esc nos menus; mexer no controle volta para ele |
| 13 | Mandar o `runtime.log` | Tem o boot, os sons (`[audio]`), o loading e qualquer erro |

O que ainda é risco conhecido: o atraso do decodificador de MP3 do nx.js (a emenda da música foi medida no Edge) e o
tempo de sintetizar os 19 sons (se passar de ~1 s no loading, eles viram MP3 no RomFS).

## 3. Publicação (só com o seu OK)

Push dos commits do M2 para o `erereck/boboforces` e deploy pelo GitHub Actions no Pages (`erereck.github.io/boboforces`).
Quem já jogou recebe a versão nova pelo service worker, no título, com a tela de Novidades.
