# Plano do M6: modos de festa (19/11/2026)

> Fonte: `docs/GDD.md` §4.1 (o catálogo de modos, a matriz de disponibilidade e a regra de ouro) e §4.5.3 (os
> modificadores); `docs/DECISOES.md` #28 (a ordem dos marcos) e #80 (seguir publicando e passando de fase no padrão).
> `docs/DECISOES.md` manda sobre este plano. Escrito no padrão da T5 da rodada 20, com o M5 no ar esperando o teste com
> amigos (fase 8 do `PLANO_M5.md`).

## Objetivo

**Os modos de festa que só pedem regras e dados sobre o que já existe** (os "P" e "M" da matriz do GDD §4.1.3), cada um
jogável sozinho com bots, no sofá, no online e no Switch:

- Bobo Warfare **Domination**;
- **Gun Game** e **Infection**;
- Bobo **Juggernaut**;
- os **modificadores** e o Bobo **Chaos** (a Roleta);
- Bobo **Paintball**;
- Bobo Zombies **Armed Horde** e **Fortress**.

O BoboStrike (G: mapa de 2 sites, economia e IA de bomba) e o Bobo Royale Mini (GG: mapa de 200 m e 24 participantes)
ficam para o M7, com plano próprio (pergunta U2).

## Critério de pronto

1. **A regra de ouro (GDD §4.1.4) em cada modo:**
   - os bots jogam o objetivo (capturam, sobem na escada, caçam o Jugg), não só matam;
   - o HUD do modo cabe numa vista de 640×360;
   - o estado do objetivo viaja no snapshot (o online);
   - cabe no Switch (720p, 30 fps com 4 jogadores);
   - quem sai vira bot e quem entra assume um.
2. **Testes:** cada modo pela sim headless com bots até o fim, com o hash estável; pela rede de mentira, o amigo termina
   igual ao host.
3. **O portão inteiro verde:** o menu da web continua ≤ 350 KB e o Switch passa no `portcheck`.
4. **Publicado a cada fase verde** (#80), com uma rodada de prints a cada duas fases.

## O que já existe

| Peça | Onde |
|---|---|
| A receita com `mode` e as regras da Partida personalizada (HP, armas permitidas, munição, um tiro mata, gravidade) | `packages/format/src/match-recipe.ts`, `packages/sim/src/systems/*` |
| Os IDs dos modos (`mode:warfare.domination`, `mode:juggernaut`, `mode:chaos`, `mode:paintball`) | `packages/format/src/content-ids.ts` |
| Os 3 pontos de Domination do Construto (marcados desde o M2) | `assets-src/maps/construto.ts` |
| O quadro do time da IA (avisos, objetivos, calor) e o flow field dos zumbis | `packages/ai/src/team.ts`, `packages/nav` |
| O snapshot com grupos por modo (o do Bobo Zombies entra só no modo dele) | `packages/net/src/schema.ts` |
| Os cards dos Modos e da sala | `packages/ui/src/screens/modes.ts`, `screens/online.ts` |

## Fases

Uma de cada vez; cada fase termina verde, commitada e publicada (#80). Cada uma traz o modo na sim, a IA do
objetivo, o HUD, o card, o online e a conferência no Switch (o orçamento pelo bench; o console confere quando voltar).

0. **A casa dos modos novos, fora do menu:**
   - o menu da web está a 0,5 KB do teto (349,5 de 350). Os cards novos e os textos deles vão para o pedaço dos
     editores, que o jogo pede logo depois do menu, como a Partida personalizada;
   - nos Modos, um card **Festa** abre a página dos modos de festa. Na sala do Online, os mesmos cards;
   - a receita passa a aceitar os modos novos, e o validador e as migrações, os campos deles.
   - **feita em 19/11** (ARCHITECTURE §17.1): o card do Bobo Training virou "Mais modos" (o Training é o 1º card de
     lá).
1. **Domination:**
   - 3 pontos: captura em 5 s com 1 jogador e até 2,5 s com 3+; cada ponto rende 1 ponto/s; 200 pontos ou 10 min;
   - a IA divide o time entre os pontos (atacar o que não é nosso, defender o que é), pelo quadro do time;
   - o HUD mostra A, B e C com a cor de quem tem e o progresso da captura; o anel no chão do Construto acende na cor do
     dono;
   - os pontos viajam no snapshot.
   - **feita em 19/11** (ARCHITECTURE §17.2). O anel do chão ainda não muda de cor (o HUD e a letra em cima do anel
     mostram o dono); a sala do Online chega ao Domination pela Personalizada.
2. **Gun Game e Infection** (presets sobre o FFA e o TDM):
   - **Gun Game:** a escada de 7 armas, a última é a faca; morrer pela faca rebaixa 1 nível;
   - **Infection:** 1 infectado no começo; quem morre vira infectado (time zumbi, faca e 1,2x de velocidade, a cara de
     bobo-zumbi); os sobreviventes vencem se aguentarem 3 min.
   - **feita em 19/11** (ARCHITECTURE §17.3): os dois nos cards da página Mais modos.
3. **Juggernaut:**
   - o Jugg tem HP de 300 × oponentes (mínimo 1000), headshot sem multiplicador, velocidade 0,75x e aparece sempre no
     radar;
   - a **Big Brrt**, a minigun só dele: arma nova, com modelo e som (U3);
   - variantes **Fixo** (rodadas de 3 min, rodízio, o "1 vs 3" do sofá) e **Rodízio** (quem dá o golpe final vira o
     Jugg; 150 pontos);
   - a IA caça o Jugg em grupo, e o Jugg avança.
   - **feita em 19/11** (ARCHITECTURE §17.4): a variante Rodízio, no card da página Mais modos. A variante Fixo (rodadas
     de 3 min com rodízio) espera as rodadas, que chegam com o BoboStrike (M7).
4. **Os modificadores e o Bobo Chaos:**
   - a lista do GDD §4.5.3, cada um ligável em qualquer modo pela Partida personalizada;
   - o **Chaos**: 3 modificadores sorteados, e a Roleta troca 1 a cada 60 s, com aviso 5 s antes. O sorteio evita
     combinações que quebram a partida.
   - **4a feita em 19/11** (ARCHITECTURE §17.5): a Roleta e o card do Bobo Chaos, com 9 modificadores (Lua, gravidade
     pesada, Pressa, só na cabeça, um tiro mata, munição infinita, Vampiro, Tudo explode e troca de arma por abate),
     ligáveis em qualquer modo pela aba Modificadores da Personalizada.
   - **4b feita em 19/11** (ARCHITECTURE §17.6): Cabeção, Invisíveis (menos quando atiram) e Festa (confete), na
     Roleta e na Personalizada (12 modificadores). Ficam para depois: Mini e Bots gigantes (a sim já escala as hitboxes
     de um corpo, `bodyScale`, mas a caixa de colisão, a câmera e a navegação não), Arcade (bhop, wall jump e pulo
     duplo: movimento novo) e Ricochete (o tiro que quica).
5. **Paintball:**
   - 1 tiro mata (configurável 1–3), respawn de 1 s, 50 abates ou 5 min;
   - os marcadores com o projétil visível;
   - as manchas de tinta em decal, com teto por plataforma (U6); o cenário não muda.
   - **feita em 19/11** (ARCHITECTURE §17.7). As 4 armas de tinta usam os modelos do arsenal (SMG, escopeta, sniper e
     granada) até a arte delas: o pacote de modelos está com 31 das 32 camadas.
6. **Bobo Zombies: Armed Horde e Fortress:**
   - **Armed Horde:** as ondas são de bots soldados, com a IA do Warfare;
   - **Fortress:** um gerador com HP (entidade, não cenário) que os zumbis atacam e os humanos defendem.
7. **Fechamento:** o portão, a rodada de prints final, o `CHANGELOG`, a `ARCHITECTURE` e o `PERF`.

## Perguntas para o Erick (sigo no padrão enquanto ele não responde)

| # | Pergunta | Padrão |
|---|---|---|
| U1 | **A ordem das fases:** Domination → Gun Game e Infection → Juggernaut → Chaos → Paintball → as variantes do Zombies. | Essa |
| U2 | **BoboStrike e Bobo Royale para o M7** (mapa novo, economia e IA de objetivo grande), com plano próprio. | Sim |
| U3 | **A Big Brrt** é uma arma nova, só do Jugg (o modelo no modelgen, o som sintetizado), fora do loadout e da escada. | Sim |
| U4 | **O infectado** é do time zumbi, com a faca, 1,2x de velocidade e a cara de bobo-zumbi (a skin que já existe). | Sim |
| U5 | **Publicar cada fase pronta** (#80) e uma rodada de prints a cada duas fases. | Sim |
| U6 | **Manchas do Paintball:** até 96 no PC, 48 no celular e 32 no Switch; a mais velha some. | Assim |

## Riscos

- **O menu no teto:** cada texto novo no menu pesa. Por isso a fase 0 leva os cards e os textos dos modos novos para
  o pedaço dos editores. Na fase 4a o menu chegou a 349,5 de 350 KB (o validador da receita mora no menu e ganhou os
  blocos `modifiers` e `chaos`): a próxima coisa que entrar no validador precisa abrir espaço antes. Antes do
  Paintball, os textos dos editores saíram do menu (347,8 KB).
- **O protocolo:** o estado de cada modo entra no fim do esquema do snapshot e sobe o `PROTOCOL_VERSION`. Quem está com
  o jogo velho vê "Atualize a página", como já acontece.
- **O Switch:** a IA de objetivo e as manchas pesam. Cada modo passa pelo bench; o que não couber fica marcado
  `switch: não` com o motivo (regra de ouro, item 4).
- **Os goldens:** mudam só com a sim do modo novo. Os do Warfare e do Zombies continuam os mesmos.

## Fora do M6

BoboStrike e Bobo Royale (M7); o Bobo Sandbox completo e o Aquário (o espectador), que vão junto com o Royale porque os
três pedem a câmera livre e a lista de jogadores grande; mapas novos; o Diretor de Partida; a Oficina com códigos.
