# Plano do M7: BoboStrike e Bobo Royale Mini (19/11/2026)

> Fonte: `docs/GDD.md` §4.1 (o catálogo e a regra de ouro), §4.6.4 (os mapas) e `docs/design/gameplay.md` ("BoboStrike",
> "Bobo Royale", §5.2 e a anti-frustração); `docs/DECISOES.md` #35 (o Royale Mini com 24), #80 e #81 (seguir publicando
> e passando de fase no padrão). `docs/DECISOES.md` manda sobre este plano. Escrito no padrão, com o M6 fechado
> (`PLANO_M6.md`, pergunta U2).

## Objetivo

**Os dois modos grandes que o M6 deixou de fora**, cada um jogável sozinho com bots, no sofá, no online e no Switch:

- **BoboStrike** (G): a bomba estilo CS, com rodadas, economia e um mapa novo de 2 sites;
- **Bobo Royale Mini** (GG): 24 participantes num mapa de ~200 m, com loot, zona e o LOD C da IA.

De quebra, o motor de **rodadas** (que destrava o Juggernaut **Fixo**) e o **Aquário** (assistir só bots e entrar no
meio), que os dois modos pedem para quem morre.

## Critério de pronto

1. **A regra de ouro (GDD §4.1.4) em cada modo:**
   - os bots jogam o objetivo (plantam e desarmam, looteiam e fogem da zona), não só matam;
   - o HUD do modo cabe numa vista de 640×360;
   - o estado do objetivo viaja no snapshot (o online);
   - cabe no Switch (720p, 30 fps com 4 jogadores), ou fica marcado `switch: não` com o motivo medido;
   - quem sai vira bot e quem entra assume um.
2. **Testes:** cada modo pela sim headless com bots até o fim, com o hash estável (golden); pela rede de mentira, o
   amigo termina igual ao host; o bench de cada mapa novo.
3. **O portão inteiro verde:** o menu da web continua ≤ 350 KB, o Switch passa no `portcheck` e o build inteiro cabe
   no orçamento do `size-check`.
4. **Publicado a cada fase verde** (#80, #81), com uma rodada de prints a cada duas fases.

## O que já existe

| Peça | Onde |
|---|---|
| Os IDs `mode:strike`, `mode:royale.mini` e `mode:sandbox` | `packages/format/src/content-ids.ts` |
| Os marcadores do mapa (spawns por time, pontos com raio, câmeras) e o `mapc` | `packages/format/src/map/`, `tools/mapc` |
| O caído e o reviver (Bobo Zombies) | `packages/sim/src/systems/life.ts`, `zombies.ts` |
| As armas no chão e a caixinha de munição (pickups), a compra na parede | `packages/sim/src/systems/pickups.ts`, `shop.ts` |
| O radial da tela de morte (escolher a primária) | `packages/ui/src/screens/` e a cena |
| O LOD A/B da IA, o quadro do time, o A\* com orçamento e o flow field | `packages/ai/src` |
| O snapshot com grupos por modo e o `PROTOCOL_VERSION` | `packages/net/src/schema.ts`, `protocol.ts` |
| A página Mais modos (cards fora do menu) | `packages/game/src/more-modes.ts` |

## Fases

Uma de cada vez; cada fase termina verde, revisada (um revisor Opus), commitada e publicada.

0. **Rodadas na sim** (o motor genérico):
   - a fase da rodada (compra → valendo → fim), o placar de rodadas, a troca de lado na metade e "vence quem fizer N";
   - sem respawn na rodada quando a regra pede (a câmera de quem morre assistir um aliado vivo vem com o BoboStrike, na
     fase 4);
   - o primeiro uso: o **Juggernaut Fixo** (rodadas de 3 min com rodízio do Jugg; o "1 contra 3" do sofá), num card.
   - **feita em 19/11** (ARCHITECTURE §18.1): o card Jugg Fixo na página Mais modos.
1. **Base Bobo** (mapa `airbase`, média, ~64 × 64 m, de dia):
   - base militar cartunesca com hangar e pista; **2 sites** (A e B) e **3 rotas**; spawns de atacantes e defensores;
   - o marcador novo `bombSites` (o centro e o raio de cada site), os nós de IA, as câmeras e o teto de bots;
   - também joga TDM (vira opção na Partida rápida e na personalizada).
2. **BoboStrike na sim:**
   - a **Boom Box**: um atacante nasce com ela; largada ao morrer (com marcador para o time); plantar segurando o
     usar dentro do site; explode 40 s depois; desarmar em 7 s (5 s com kit);
   - o fim da rodada: um time eliminado, a explosão, o desarme ou o tempo (1:45; no tempo, os defensores vencem);
   - **MR12**: troca de lado na rodada 6, vence quem fizer 7;
   - a **economia** em faixas fixas (vitória 3000; derrota 1900 +500 por derrota seguida até 3400; abate 300; plantar
     300) e a **compra** nos 15 s do começo da rodada (pistola grátis; SMG e escopeta 1200; fuzil 2700; sniper 4500;
     colete 650 ou 1000; granada 300; kit 400);
   - o **colete** (50 ou 100, absorve 50% do dano no tronco e nos membros), sem regeneração.
3. **A IA do BoboStrike:**
   - atacantes: escolher o site, o portador planta, os outros escoltam e seguram o site;
   - defensores: se dividir nos sites, rotacionar ao ouvir a bomba e retomar; desarmar;
   - todos: comprar pelo dinheiro e economizar quando não dá; com 30 s restantes, os atacantes vão direto ao site.
4. **HUD e telas do BoboStrike:** o dinheiro, a rodada e o placar, a bomba (plantada, o tempo, o desarme), o
   **radial de compra** (D-pad e mouse), o card na página Mais modos, o online e a rodada de prints.
5. **Ilha Tropical** (mapa `island`, Royale Mini, ~200 × 200 m):
   - praia, vila genérica, morro e farol; pontos de loot; a memória (só os chunks não vazios), o tempo de loading e o
     orçamento de download (≤ 10 MB) e o bench no Switch.
6. **Bobo Royale Mini na sim:**
   - 24 participantes, sem respawn, solo, duplas e quartetos (em grupo, o caído e o reviver do Zombies);
   - o **loot no chão**: armas em 3 raridades que melhoram recoil e pente, **sem mais dano**; coletes 50/100; kits de
     cura (sem regeneração);
   - a **zona** em 5 fases, com dano de 2 / 5 / 10 / 20 / 40 HP/s; vence o último time vivo.
7. **A IA do Royale e o LOD C:** lootear, ir para a zona, se curar e entrar na luta alheia (3rd party); os bots a mais
   de 60 m de todo humano pensam a 1 Hz, andam por waypoints e resolvem a luta entre eles por probabilidade; o
   snapshot manda as entidades longe a 5–10 Hz.
8. **HUD e telas do Royale:** os vivos, o tempo da zona, a zona no minimapa e a **parede translúcida** (dentro do teto
   de 7 programas de shader), o card, o online, os prints e o bench (24 no celular e no Switch 2P+, pergunta Y5).
9. **Aquário:** assistir uma partida só de bots, com a câmera livre e a lista de jogadores grande, e entrar no meio
   (assumindo um bot), em qualquer modo; a aceleração até 4x no PC e 2x no Switch.
10. **Fechamento:** o portão, a rodada de prints final, o `CHANGELOG`, a `ARCHITECTURE` e o `PERF`.

## Perguntas para o Erick (sigo no padrão enquanto ele não responde)

| # | Pergunta | Padrão |
|---|---|---|
| Y1 | **A ordem das fases:** rodadas (com o Juggernaut Fixo) → BoboStrike → Bobo Royale Mini → Aquário. | Essa |
| Y2 | **O mapa do BoboStrike** é a Base Bobo (`airbase`), ~64 m, de dia, que também joga TDM. | Sim |
| Y3 | **Quem morre no BoboStrike** assiste um aliado vivo até a próxima rodada; assumir um bot aliado vivo fica como opção da partida. | Assistir |
| Y4 | **A Boom Box:** plantar leva 3 s segurando o usar (o GDD não diz); a explosão mata a até 10 m e fere até 20 m. | Assim |
| Y5 | **O Royale no celular e no Switch 2P+** (tetos de bots 12 e 16): 24 se o bench com o LOD C deixar; se não, vale o teto do aparelho até a sua resposta (a #35 pede a sua decisão para reduzir). | Assim |
| Y6 | **O Bobo Sandbox completo** (as Ferramentas do Dono pedem telas e regras ao vivo) fica para depois do M7; o Aquário entra. | Sim |

## Riscos

- **O menu no teto** (347,9 de 350 KB): os cards e os textos novos vão para o pedaço dos editores, como no M6. Se o
  validador da receita (que mora no menu) precisar de blocos novos (`strike`, `royale`), abrir espaço antes.
- **O pacote de modelos** está com 31 das 32 camadas: a Boom Box, o colete, o kit e as caixas de loot pedem arte. Juntar
  camadas (ou um segundo atlas) antes de pôr modelos novos.
- **O Royale no Switch e no celular:** a malha de um mapa de 200 m, os 24 participantes e a IA. O LOD C e o bench dizem
  se cabe; o que não couber fica marcado e vai como pergunta (Y5).
- **A parede da zona:** o render tem no máximo 7 programas de shader (regra 8); ela precisa reaproveitar um programa.
- **O protocolo:** o estado de cada modo entra no fim do esquema do snapshot e sobe o `PROTOCOL_VERSION`.
- **Os goldens:** mudam só com a sim do modo novo; os do Warfare, do Zombies e do M6 continuam os mesmos.

## Fora do M7

O Bobo Sandbox completo e as Ferramentas do Dono (Y6); o Royale Grande (só PC, depois do Mini); o Diretor de Partida;
a Oficina com códigos; os mapas extras do GDD §4.6.4; os modificadores que ficaram do M6 (W2).
