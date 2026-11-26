# Plano do M11: as pendências do M10 (26/11/2026)

> Fonte: `docs/ARCHITECTURE.md` §21.9, §21.11 e §21.12 (o "fica para depois" do M10); `docs/GDD.md` §4.1.2 e §4.1.3
> (o Bobo Royale Grande), §4.3.2 e §4.4 (os pickups de arma no mapa), §4.6.4 (a Fazenda, mapa do Zombies e do
> Fortress); `docs/DECISOES.md` #82 a #84. `docs/DECISOES.md` manda sobre este plano. Abrir o M11 foi resposta do
> Erick ("pode seguir com tudo q falta no fica pra depois", #84), que respondeu também a AK1 (os pickups e o Royale
> Grande entram agora) e a AK7 (fechar os poleiros também no Construto e na Base Bobo).

## Objetivo

**Tudo o que o M10 deixou para depois:**

- **Os poleiros de pulo do Construto (66 m) e da Base Bobo (61 m)** e o poço ao lado da escada da torre do Construto,
  que prende o bot que cai. Mudam os goldens com bots nesses dois mapas.
- **Os bots sobem aonde o mapa pede:** os 3 testes de cena em espera (o deque da antena da Lua, o jirau do celeiro da
  Fazenda e a passarela do Galpão).
- **O Fortress na Fazenda:** o mapa foi feito para ele (o gerador na sala), mas nenhum card o oferece lá.
- **Os pickups de arma no mapa** (GDD §4.4): a regra de partida "armas no mapa", estilo arena, com a arma voltando 20 s
  depois de pega; nasce-se de pistola e faca.
- **O Bobo Royale Grande** (GDD §4.1.2): só no PC, alvo de 48 participantes num mapa de ~400 m, se o teto do PC
  aguentar (medido antes de decidir o número).

Fica fora: gerar os mips no carregamento (uns 34 KB da primeira partida). Só entra quando o teto da primeira partida
(1 MB) apertar.

## Critério de pronto

1. **Os mapas:** o `mapc --check` passa sem nenhum `jumpSightTodo` (nenhum mapa marcado) e sem poço que prende; os 3
   testes em espera voltam (sem `skip`).
2. **Os pickups:** a regra valida, a sim e a IA jogam com ela até o fim (golden novo), o amigo online termina igual ao
   host, e ela aparece na Partida personalizada.
3. **O Royale Grande:** o custo medido (sim + IA por tick, loading, memória, rede) cabe no PC de referência; o golden
   novo; escondido ou travado fora do PC.
4. **Os goldens de antes:** só mudam os que jogam nos mapas que mudaram (o Construto e a Base Bobo) ou com a IA nova, cada
   um re-gravado com a nota do motivo.
5. **O portão inteiro verde:** o menu da web ≤ 350 KB, a primeira partida ≤ 1 MB, o Switch no `portcheck`.
6. **Publicado a cada fase verde** (#80 a #82), com a rodada de prints no fechamento.

## Como o trabalho anda (#82)

As 5 frentes rodam ao mesmo tempo, cada uma num agente com a própria cópia do repositório; eu integro uma por vez
(diff da fase, portão, revisão do Opus, docs, commit e publicação). Os goldens re-gravados por uma frente são
conferidos de novo depois de cada junção.

## Fases

1. **Os poleiros e o poço do Construto, os poleiros da Base Bobo** (`construto.ts`, `airbase.ts`): fechar os degraus do
   pulo correndo (como no Canteiro, §21.11) e o poço da escada da torre; tirar as duas marcas `jumpSightTodo`.
2. **Os bots sobem:** o deque da antena da Lua, o jirau da Fazenda e a passarela do Galpão (mapa ou IA).
3. **O Fortress na Fazenda:** o card, a Partida personalizada, o Surpreenda-me e a sala, como o Zombies escolhe o
   mapa; golden novo.
   - **feita em 26/11** (ARCHITECTURE §22.3): o card começa na Fazenda; o Posto na Personalizada e no Surpreenda-me;
     golden `02c04767`.
4. **Os pickups de arma:** a regra na receita, o marcador de pontos no map@1 e nos mapas de TDM/FFA/Domination/Sandbox,
   o sistema na sim (pegar, trocar, voltar em 20 s), a IA que busca, o render, a opção na Personalizada; golden novo.
5. **O Royale Grande:** medir 48 participantes no PC; o mapa de ~400 m gerado por código; o modo (só PC, online só com
   host PC); a zona escalada; a IA; golden novo.
6. **Fechamento:** o portão, a rodada de prints 35, o `CHANGELOG`, a `ARCHITECTURE` (§22) e o `PERF`.

## Perguntas para o Erick (sigo no padrão enquanto ele não responde)

| # | Pergunta | Padrão |
|---|---|---|
| AL1 | **O Royale Grande:** o número de participantes sai da medição no PC de referência (alvo 48); no celular e no Switch ele não aparece. | Assim |
| AL2 | **Os pickups:** uma regra de partida ("armas no mapa") na Partida personalizada, no Sandbox e no Surpreenda-me; com ela todos nascem de pistola e faca e o radial da morte some. Sem card próprio. | Assim |
| AL3 | **O Fortress na Fazenda:** o card do Fortress oferece a Fazenda (o mapa dele no GDD) e o Posto continua escolhível. | Assim |
