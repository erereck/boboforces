# Roteiro do fechamento do M3: sofá e Bobo Zombies (11/11/2026)

> Para o Erick seguir. Critérios 1 a 4 do `PLANO_M3.md`: 4 controles no PC, o Bobo Zombies de 10 ondas solo e com 4,
> o checkpoint do Switch com 4 controles e o Zombies a 30 fps, e os prints. O que dá para medir sem você está no
> `PERF.md` §2 (4 vistas a 60 fps na RTX 2050 com 40 zumbis e com 24 bots) e no `ARCHITECTURE.md` §13.34 (o robô
> vence as 10 ondas com regras leves). Anote ao lado de cada item: **ok**, **estranho** (com uma frase) ou **quebrou**.
> No fim, mande o relatório (web: Ajustes › Sobre › Copiar relatório; Switch: `sdmc:/switch/boboforces/runtime.log`).

## 1. PC (web) com controles

Antes: `npm run build` e `npm run preview -w @boboforces/web` (ou o site, depois de publicado). O teclado e o mouse
contam como um jogador; os outros entram por controle.

| # | O que fazer | O que esperar |
|---|---|---|
| 1 | Mudar › Jogar no sofá; cada controle aperta A (o teclado, Enter) | Os cartões P1 ▲, P2 ●, P3 ■, P4 ◆ na cor de cada um |
| 2 | O P1 troca a Partida até **Sofá Zombies** e começa | Base Abandonada à noite, uma vista por jogador; com 3, o minimapa no 4º quadrante |
| 3 | Jogar o Zombies com 2, 3 e 4 | Pontos, armas na parede, portas, caixa, vantagens, consertar janela; os bots de apoio só completam até 4 |
| 4 | Cair e ser levantado por um amigo (segurar Interagir perto) | 3 s para levantar; o "levantou" toca para os dois |
| 5 | Entrar no meio segurando A num controle livre; sair pela pausa | A tela se redivide; um bot assume quem sai |
| 6 | Desconectar um controle no meio | Pausa e espera ele voltar |
| 7 | Jogar até o fim (ou até caírem todos) | Resultado do Zombies com a linha de cada um, o recorde e Mudar regras |
| 8 | Mudar regras: trocar duração, quantidade, velocidade; COMEÇAR | A partida segue as regras; o recorde é outro (outra configuração) |
| 9 | Ajustes › Áudio: ligar "Música na partida" e jogar uma onda | A camada da horda entra conforme os zumbis chegam perto |
| 10 | Solo: Modos › Bobo Zombies, tentar as 10 ondas | Os especiais aparecem; o Mega Bobo nas ondas 5 e 10; anote até onde chegou e o que pareceu fácil ou difícil |

## 2. Switch: checkpoint com 4 controles e o Zombies a 30 fps

Build: o NRO mais novo que mandei (`BoboForces.nro` → `sdmc:/switch/boboforces/BoboForces.nro`, abrir pelo homebrew
menu **segurando R**).

| # | O que fazer | O que esperar |
|---|---|---|
| 1 | Na dock, Mudar › Jogar no sofá; 4 controles apertam A | 4 cartões; o P1 escolhe **Sofá Zombies** |
| 2 | Jogar o Zombies com 4 por 10 min | Fluido (30 fps ou mais); 4 vistas; som de cada um pelo ouvinte mais perto |
| 3 | Jogar com 3 | O minimapa no 4º quadrante |
| 4 | Tirar da dock no meio | Pausa sozinho; no portátil, 1 vista só se estiver sozinho |
| 5 | HOME e voltar; dormir e acordar | Pausa e volta sem perder a partida nem a música |
| 6 | **Bench do Zombies:** pôr em `sdmc:/switch/boboforces/bench.json` o texto `{"params":{"scene":"zombies","views":4,"duration":120}}` e abrir | O jogo começa direto no bench (4 vistas de bots na Base, a horda cheia) e grava o relatório no `runtime.log` (procure `fps=` e `zumbis_vivos`). O arquivo é lido uma vez |
| 7 | Solo, no portátil, 10 ondas (ou o quanto der) | Sem fechar sozinho nem travar; anote se esquentar |
| 8 | Mandar o `runtime.log` | Tem o boot, o loading, o bench e qualquer erro |

O que ainda é risco conhecido: o loading da 1ª cena perto de 5 s (#60) e o atraso do decodificador de MP3 do nx.js
nas emendas das músicas (as do Zombies foram medidas no Edge).

## 3. Prints e publicação (só com o seu OK)

As rodadas 14 e 15 (K, L) e a 16 (o fechamento) estão na página das rodadas. Publicar = push dos commits do M3 para o
`erereck/boboforces` e deploy pelo GitHub Actions no Pages; quem já jogou recebe a versão nova pelo service worker.
