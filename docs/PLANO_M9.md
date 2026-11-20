# Plano do M9: o Bobo Sandbox e os modificadores de tamanho (20/11/2026)

> Fonte: `docs/GDD.md` §4.1 (o catálogo e a regra de ouro), §4.5.3 (os modificadores) e §7 (o roadmap "M6+");
> `docs/design/gameplay.md` "Bobo Sandbox completo", "Bobo Chaos", §3.6 (a altura livre) e §6.5 (o tamanho por regra);
> `docs/DECISOES.md` #80, #81 e #82 (abrir o M9 com mais agentes). `docs/DECISOES.md` manda sobre este plano.

## Objetivo

**O que sobrou do "M6+" do roadmap** depois do M8 (pergunta Z1):

- **o Bobo Sandbox completo** (`sandbox`): até 4 times, cada um com nome, bots, HP e armas; o objetivo (pontos,
  eliminação ou nenhum, o "brinquedo"); jogar ou só assistir; salvar como Cenário (um preset); e as **Ferramentas do
  Dono** no estilo gmod: criar um bot onde você mira, congelar a IA, trocar o time de um bot, dar uma arma a ele, mudar
  regra ao vivo e a câmera lenta (só offline). No online, só o host usa as ferramentas;
- **os modificadores Mini** (todos 0,5x), **Bots gigantes** (3x) e **Ricochete** (a bala quica 1 vez), fixos na receita
  e na Roleta do Bobo Chaos.

Antes de tudo, **a dieta do menu da web**: ele fechou o M8 em 349,6 de 350 KB, e o Sandbox põe telas e regras novas.

## Critério de pronto

1. **A regra de ouro (GDD §4.1.4) no Sandbox:** os bots jogam com 3 e 4 times e na eliminação; o HUD cabe numa vista
   de 640×360; o estado viaja no snapshot (o online); cabe no Switch (ou fica marcado `switch: não` com o motivo
   medido); quem sai vira bot e quem entra assume um.
2. **Testes:** os modificadores pela sim (a hitbox, o olho, a mira dos bots e o quique) e na Roleta; o Sandbox pela sim
   headless com bots até o fim (golden novo), os comandos do dono por um roteiro gravado (o mesmo hash duas vezes); pela
   rede de mentira, o amigo termina igual ao host. Os goldens de antes não mudam, menos o do Bobo Chaos (a Roleta ganha
   os 3 modificadores novos; pergunta AH8).
3. **O portão inteiro verde:** o menu da web com folga (≤ 335 KB depois da dieta), o Switch passa no `portcheck` e o
   build inteiro cabe no orçamento do `size-check`.
4. **Publicado a cada fase verde** (#80, #81, #82), com uma rodada de prints a cada duas fases.

## Como o trabalho anda (#82)

As frentes que não mexem nos mesmos arquivos rodam **ao mesmo tempo**, cada uma num agente com a sua cópia do
repositório (um worktree com `node_modules` próprio). Eu integro uma por vez: junto no `main`, rodo o portão inteiro,
passo um revisor Opus, corrijo, escrevo os docs, commito e publico. A ordem de integração é a dos números das fases.

| Pista | Fases | Arquivos principais |
|---|---|---|
| A | 0 | `apps/web`, `packages/game` (o que o menu importa), as tabelas de textos |
| B | 1 | `packages/sim` (hitbox, armas, caos), `render`, `ai` (a mira), `net` (o evento do quique) |
| C | 2 | `packages/format` (a receita), `packages/sim` (os times, o objetivo), `ai` |
| depois de C | 3 e 4 juntas | 3: `packages/game` e `ui` (as telas); 4: `sim`, `ai` e `format` (os comandos) |
| depois de 3 e 4 | 5 | a cena (`scene/match.ts`), a pausa e o online |

## O que já existe

| Peça | Onde |
|---|---|
| 4 times no motor (limites, validador, placar por time, IA, rede) | `format/platform-profiles.ts` (`ENGINE_MAX_TEAMS`), `sim/systems/life.ts`, `ai/team.ts` |
| O tamanho por corpo (hitbox, desenho e rede), do Chonker e do chefão | `sim/state.ts` (`bodyScale`), `sim/hitbox.ts` (`testEntity`) |
| A cabeça grande por máscara (o molde dos modificadores de tamanho) | `sim/hitbox.ts` (`setHeadScale`), `sim/systems/chaos.ts` |
| A normal da face no raio da grade (o quique) | `world/src/query.ts` (`RayHit`) |
| A última equipe de pé (o molde da eliminação) | `sim/systems/royale.ts` |
| Assistir só bots, a câmera livre e a velocidade 0,25x–4x (o molde da câmera lenta) | `game/scene/aquarium.ts` |
| Bots dormentes soltos no meio da partida (o molde da reserva do dono) | `sim/sim.ts` e `sim/systems/zombies.ts` (a Horda) |
| O ponto no chão pela mira (o molde do "criar bot onde mira") | `ai/orders.ts` (`orderPoint`), `sim/systems/signals.ts` |
| As páginas da pausa feitas pela cena (o molde do menu do dono) | `game/pause.ts` (`items`), `scene/aquarium.ts` |

## Fases

Cada fase termina verde, revisada (um revisor Opus), commitada e publicada.

0. **A dieta do menu da web** (pista A): os textos que só a partida e os editores usam saem da tabela do menu, o
   `stepLevel` sai da pausa, a tabela de looks sai do boneco padrão, o renderizador nulo sai da web, o relatório e a
   prévia do título viram sob demanda, e a tela de Configurações vira um fluxo do pedaço dos editores. Meta: ≥ 15 KB.
   - **feita em 20/11** (ARCHITECTURE §20.2): 349,6 → 332,3 KB.
1. **Os modificadores Mini, Bots gigantes e Ricochete** (pista B): o tamanho por máscara sem estado novo (a hitbox, o
   olho, a mira dos bots, o desenho e os marcadores; a caixa de colisão e a navegação ficam, e os gigantes evitam teto
   baixo), o quique das balas e dos chumbos com o evento `ricochet` (protocolo 11), as linhas na Partida personalizada,
   a Roleta e os conflitos (Mini com Gigantes, Gigantes com Cabeção, Ricochete com Um tiro mata).
   - **feita em 20/11** (ARCHITECTURE §20.3): o protocolo 11; o golden do Chaos foi para `ae3a48fd`.
2. **O Sandbox na receita e na sim** (pista C): o HP e as armas por time, o bloco `sandbox` com o objetivo (pontos,
   eliminação ou nenhum), o Sandbox como o TDM na regeneração e na munição, os times 2 e 3 longe das bases dos outros,
   e um golden novo com 4 times.
   - **feita em 20/11** (ARCHITECTURE §20.1): o objetivo, as regras por time e as casas dos times 2 e 3; golden
     `35764306`.
3. **O Sandbox no jogo:** o modo na Partida personalizada (a aba Times com até 4 times: nome, bots, HP e armas; o
   objetivo), jogar ou assistir, salvar como Cenário (preset), e o que hoje supõe 2 times (o HUD, o feed, os nomes dos
   times, o placar, o resultado, o sofá e o lobby online).
4. **As Ferramentas do Dono na sim:** a fila de comandos do dono (com o tick em que valem, aplicada num ponto fixo do
   passo, gravável para replay), a reserva de bots dormentes do Sandbox (criar bot num ponto), congelar a IA, trocar o
   time, dar arma e ligar ou desligar um modificador ao vivo; o teste headless por um roteiro de comandos.
5. **As Ferramentas do Dono no jogo:** o menu do dono (uma página da pausa e uma roda para mirar e aplicar), a câmera
   lenta (só offline), o online (só o host manda; os amigos veem pelo snapshot), o sofá (só o jogador 1) e o Switch.
6. **Fechamento:** o portão, a rodada de prints final, o `CHANGELOG`, a `ARCHITECTURE` e o `PERF`.

Rodadas de prints: depois da fase 1 (os modificadores), da fase 3 (o Sandbox) e da fase 5 (as ferramentas).

## Perguntas para o Erick (sigo no padrão enquanto ele não responde)

| # | Pergunta | Padrão |
|---|---|---|
| AH1 | **O que entra no M9:** a dieta do menu, os modificadores Mini, Bots gigantes e Ricochete, e o Bobo Sandbox completo com as Ferramentas do Dono, nessa ordem. | Assim |
| AH2 | **O tamanho (Mini e Gigantes)** muda o desenho, a hitbox, a altura do olho e a mira dos bots; a caixa de colisão fica a mesma (os gigantes não entalam nas portas e a navegação não muda), e os gigantes evitam teto baixo. | Assim |
| AH3 | **O Ricochete:** só as balas (pistola, SMG, fuzis, escopeta e sniper) quicam, 1 vez, com o dano pela distância total; foguete, granada e tinta não quicam. | Assim |
| AH4 | **As cores dos times** ficam fixas pela posição (laranja, azul, verde e roxo) neste marco; o nome que você der ao time aparece no placar e no resultado. | Assim |
| AH5 | **O objetivo do Sandbox:** Pontos (o padrão, como o TDM), Eliminação (sem renascer; vence o último time de pé) e Nenhum (o "brinquedo", que só termina pelo menu). | Pontos |
| AH6 | **As Ferramentas do Dono** só no Sandbox; no online só o host usa; a câmera lenta só offline; no sofá só o jogador 1. | Assim |
| AH7 | **"Criar bot onde mira"** usa uma reserva de bots que o Sandbox separa na largada (8, dentro do teto de bots do aparelho). | 8 |
| AH8 | **A Roleta do Bobo Chaos** passa a sortear o Mini, os Bots gigantes e o Ricochete (o golden do Chaos muda por isso). | Sim |
