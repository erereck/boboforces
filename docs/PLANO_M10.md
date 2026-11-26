# Plano do M10: mapas e armas novos (20/11/2026)

> Fonte: `docs/GDD.md` §4.3.3 (o arsenal futuro), §4.6 (os mapas: classes, regras de layout e a lista) e §7 (o
> "M6+": "mais mapas e armas"); `docs/design/gameplay.md` e `docs/design/arte-ux.md` (a densidade, a paleta e a
> diretriz de conteúdo); `docs/DECISOES.md` #19 (conteúdo genérico), #80 a #82. `docs/DECISOES.md` manda sobre este
> plano. Escrito no padrão do #82, com o M9 fechado: abrir o M10 foi resposta do Erick ("Sim, abrir o M10"); o escopo
> é uma decisão menor revisável (pergunta AK1).

## Objetivo

**O que sobrou do "M6+" do roadmap: mais mapas e armas.**

- **Os 5 mapas da lista do GDD (§4.6.4) que ainda não existem:** Porto de Contêineres (TDM, FFA, Domination),
  Canteiro de Obras (TDM, FFA), Galpão de Paintball (Bobo Paintball), Estação Lunar (Bobo Chaos, com gravidade baixa
  de série) e Fazenda à noite (Bobo Zombies e Fortress). Todos médios ou grandes, com a maior linha de visão de até
  50 m (rodam no Switch 3–4P), spawns, nós da IA, navegação, câmeras do Aquário e os modos que servem (Sandbox
  incluso onde couber).
- **5 armas do arsenal futuro (§4.3.3):** o DMR, o revólver e a escopeta automática (convencionais), a besta (o virote
  fica preso no bloco por alguns segundos) e o lança-granadas (projéteis). Com o modelo, os sons, o ícone, a IA, o
  balanceamento pelo robô, o radial, o Gun Game, a loja do BoboStrike e o loot do Royale.
- **As pendências do M9:** a Base Aérea no Sandbox (os times 2 e 3 em cima dos muros), escolher a cor de cada time no
  Sandbox e o som do ricochete.

## Critério de pronto

1. **Cada mapa:** passa no `mapc --check` e nas regras de layout do GDD (§4.6.3: 3 rotas, cobertura a cada 8–12 m,
   spawns que não se veem, travessia de 12–18 s, escada ou rampa em toda área); os bots jogam cada modo dele até o fim
   pela sim headless; o bench do mapa; prints aprovados no padrão.
2. **Cada arma:** o robô de balanceamento a põe na faixa da classe dela (o TTK do GDD §4.3), a IA a usa, e ela aparece
   onde as armas aparecem (o radial, as regras, o Laboratório, o Gun Game, o BoboStrike, o Royale).
3. **Os goldens de antes não mudam**, menos os que sorteiam entre as armas (o Gun Game, o Royale e o Chaos, se a lista
   deles crescer: cada um re-gravado com o motivo).
4. **O portão inteiro verde:** o menu da web ≤ 350 KB, a primeira partida ≤ 1 MB (as texturas novas são poucas), o
   Switch no `portcheck`.
5. **Publicado a cada fase verde** (#80 a #82), com uma rodada de prints a cada duas fases.

## Como o trabalho anda (#82)

As frentes que não mexem nos mesmos arquivos rodam ao mesmo tempo, cada uma num agente com a própria cópia do
repositório; eu integro uma por vez (squash, portão, revisão do Opus, docs, commit e publicação). Os texture arrays
(os blocos e o `modelos64`) têm ordem fixa de tiras: só uma frente por vez mexe neles.

| Onda | Fases | Por que juntas |
|---|---|---|
| 1 | 0 (o kit dos mapas) e 8 (as pendências do M9) | o kit mexe nas texturas; as pendências, no Sandbox e no som |
| 2 | 1 a 5 (um mapa por fase) e 6–7 (as armas) | cada mapa é um arquivo; as armas mexem no `modelos64` depois do kit |
| 3 | 9 (o fechamento) | |

## O que já existe

| Peça | Onde |
|---|---|
| A API de construção de mapas e o compilador | `assets-src/maps/*.ts`, `tools/mapc` (`--check`) |
| As texturas de blocos (16×16) e de modelos (64×64) por script, com a paleta | `assets-src/textures/blocks16.ts`, `modelos64.ts`, `tools/texgen`, `tools/modelgen` |
| A lista de mapas por modo e o registro | `packages/game/src/maps.ts` (`MAP_MODES`), `packages/format/src/content-ids.ts` |
| As armas (dados, códigos só de acrescentar) | `packages/sim/src/config/weapons.ts` |
| O robô de balanceamento | `tools/balance` (`npm run balance`) |
| Os projéteis com balística (foguete, granada, tinta) | `packages/sim/src/systems/projectiles.ts` |
| A gravidade por regra (o modificador Lua) | `packages/sim/src/systems/chaos.ts` |

## Fases

Cada fase termina verde, revisada (um revisor Opus), commitada e publicada.

0. **O kit dos mapas novos:** os blocos e as peças que os 5 mapas pedem (o contêiner e o guindaste do porto, o andaime
   e a viga do canteiro, os infláveis e o piso colorido do galpão, o regolito, o metal e o neon da estação, o celeiro,
   o feno e a cerca da fazenda), na paleta e na densidade de sempre, dentro do orçamento de texturas.
   - **feita em 20/11** (ARCHITECTURE §21.2): 38 blocos e 8 peças; a primeira partida em 941 KB.
1. **Porto de Contêineres** (médio): verticalidade e corredores entre pilhas de contêineres; TDM, FFA, Domination e
   Sandbox.
   - **feita em 25/11** (ARCHITECTURE §21.5): 88 × 71,5 m, visada de 49,65 m, 3 pontos de Domination.
2. **Canteiro de Obras** (médio): andaimes, vigas e o guindaste; TDM, FFA e Sandbox.
   - **feita em 20/11** (ARCHITECTURE §21.3): 72 × 80 m, 3 andares, visada de 47,9 m.
3. **Galpão de Paintball** (médio): interior colorido com infláveis; Bobo Paintball (e TDM).
   - **feita em 26/11** (ARCHITECTURE §21.7): o card do Paintball começa nele; as caixas de spawn fechadas.
4. **Estação Lunar** (médio): a gravidade baixa de série (pergunta AK3), neon; Bobo Chaos (e TDM e FFA).
   - **feita em 26/11** (ARCHITECTURE §21.6): a gravidade do mapa no META; o Chaos joga lá.
5. **Fazenda à noite** (grande): o Bobo Zombies (janelas, portas pagas, armas na parede, caixa, vantagens) e o
   Fortress.
   - **feita em 26/11** (ARCHITECTURE §21.8): 18 janelas, 6 portas, ritmo da Base Abandonada, nenhum poleiro.
6. **As armas convencionais:** o DMR, o revólver e a escopeta automática.
7. **As armas de projétil:** a besta (o virote preso no bloco por alguns segundos, cosmético) e o lança-granadas.
   - **6 e 7 feitas em 20/11** (ARCHITECTURE §21.4): as cinco com modelos, o radial de 10 e o protocolo 13.
8. **As pendências do M9:** a Base Aérea no Sandbox (os pontos dos times 2 e 3 no chão), a cor de cada time no
   Sandbox (uma paleta de cores de time, sem repetir) e o som do ricochete.
   - **feita em 20/11** (ARCHITECTURE §21.1): a Base Aérea no Sandbox, as 8 cores e o assobio sintetizado.
1c. **Os bots sobem escada e o mapc vê os pulos** (achado das revisões dos mapas): o seguidor de caminho com lance reto
    alto, os andares de cima no passeio dos bots e os topos aonde só o pulo correndo leva na medida de visada do mapc.
   - **feita em 26/11** (ARCHITECTURE §21.9): os goldens com bots no Construto e na Base Bobo mudaram (pergunta AK7).
1d. **Os consertos do navegador** (achados nos testes do site na tela virtual): o nome cru dos modos no link de
    preset e os defensores do Domination contados pelo controlador global.
   - **feita em 26/11** (ARCHITECTURE §21.10): os 11 modos com nome na tabela do menu; o terço de cada time defende.
10. **Os poleiros de pulo nos mapas novos** (pergunta AK7): fechar os topos do pulo correndo no Canteiro, na Lua e
    na Fazenda.
   - **feita em 26/11** (ARCHITECTURE §21.11): o Canteiro e a Fazenda sem nenhum; na Lua, a visada de lá abaixo de
     50 m.
9. **Fechamento:** o portão, a rodada de prints final, o `CHANGELOG`, a `ARCHITECTURE` e o `PERF`.
   - **feita em 26/11** (ARCHITECTURE §21.12): a rodada de prints 34 (seções 135 a 141), o `PERF` §1r.

## Perguntas para o Erick (sigo no padrão enquanto ele não responde)

| # | Pergunta | Padrão |
|---|---|---|
| AK1 | **O que entra no M10:** os 5 mapas que faltam da lista do GDD, 5 armas do arsenal futuro (DMR, revólver, escopeta automática, besta e lança-granadas) e as pendências do M9 (a Base Aérea no Sandbox, a cor do time e o som do ricochete). Os pickups de arma no mapa e o Royale Grande ficam para depois. | Assim |
| AK2 | **Os nomes** em inglês bobo, como os outros (provisórios; os IDs não mudam): os mapas Porto (`port`), Canteiro (`construction`), Galpão (`paint-hall`), Estação Lunar (`moonbase`) e Fazenda (`farm`); as armas com apelido como as de hoje (ex.: DMR "Pinpoint", revólver "Hand Cannon", escopeta automática "Leafblower", besta "Twang", lança-granadas "Bloop"). | Assim |
| AK3 | **A Estação Lunar** tem a gravidade baixa (0,35x, a do modificador Lua) em todo modo jogado nela, não só no Chaos. | Em todo modo |
| AK4 | **Os mapas novos no Switch:** todos com a maior linha de visão de até 50 m, para rodar no Switch 3–4P. | Sim |
| AK5 | **O revólver** é uma secundária (escolhida como a pistola, no Laboratório e nas regras); o DMR, a escopeta automática, a besta e o lança-granadas são primárias novas no radial da morte. | Assim |
| AK6 | **A cor do time no Sandbox:** uma paleta de 8 cores de time (as 4 de hoje e mais 4 que não se confundem com o cenário), sem dois times da mesma cor. | Assim |
| AK7 | **Os poleiros de pulo:** o compilador de mapas agora acha os topos aonde só o pulo correndo leva; em 5 mapas (o Construto, a Base Bobo, o Canteiro, a Lua e a Fazenda) a visada de lá passa dos 50 m do Switch. Fechar cada um muda o mapa (e, no Construto e na Base Bobo, os goldens). | Fechar nos mapas novos; o Construto e a Base Bobo ficam marcados |
