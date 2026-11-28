# Plano do M12: o refino (26/11/2026)

> Pedido do Erick (#85): "quero q tu faça agr uma etapa de refinação, o maximo das pequenas coisas que mudam tudo".
> Fonte: um levantamento com oito agentes lendo o código por área (o tiro, o movimento e a câmera, a HUD, os menus, o
> som, o visual, os bots e as pendências pequenas dos marcos anteriores) e um jogando no Edge headless, no mudo. O GDD
> (§4.2, §5.5, §5.6, §5.10, §5.11) e o `docs/design/arte-ux.md` já prometiam boa parte disto. `docs/DECISOES.md` manda
> sobre este plano.

## Objetivo

**Refinar o que já existe**, sem modo, mapa ou arma novos: as pequenas coisas que fazem o jogo parecer acabado. O
levantamento achou o jogo bem servido no que é difícil (a sim do movimento, a interpolação, a mira crua, o boneco do
FutBobo, as molas, o desmonte, os cubinhos da cor do texel, o som espacial) e fraco no que é pequeno:

- **A câmera e a arma na mão** são a posição interpolada mais a altura do olho: sem balanço, sem mergulho no pouso,
  sem FOV de velocidade, com o degrau da escada saltando a cada tick; a arma não reage ao giro nem à corrida, troca e
  recarrega sem se mexer, e o coice é o mesmo dente de serra em todas.
- **A HUD** não confirma o abate na mira, não mostra a recarga, não avisa o pente baixo, não tem vinheta de vida baixa
  nem fecho de partida, e esconde a munição debaixo do botão de pulo no celular.
- **Os menus** têm dois destaques ao mesmo tempo (o primário sem foco parece focado), nenhuma das entradas animadas
  prometidas, um "Sair da partida" sem confirmação e um resultado que o pulo ou o agachar pulam sem querer.
- **O som** tem um defeito (o cooldown do próprio tiro cala uns 40% dos tiros do inimigo com a mesma arma), nenhuma
  variação entre tiros, a parede só baixa o volume, e os modos do M6 ao M11 têm objetivos mudos.
- **O visual** tem bonecos que patinam no strafe, a noite em preto puro, props e armas no chão sem sombra.
- **Os bots** miram em quem acabou de nascer, seguem o alvo pelas costas em 360°, atiram no vidro e usam foguete no
  nível Pela vibe.

## Critério de pronto

1. **Cada frente** entrega o que a lista dela marca como feito, com teste quando a lógica é pura (a câmera, o som, a
   HUD, a IA) e print quando é visual.
2. **Os goldens:** só mudam os da IA e da sim (a frente dos bots e o deslize no pouso), cada um re-gravado com a nota
   do motivo; as frentes de câmera, HUD, menus, som e visual não mudam nenhum.
3. **O portão inteiro verde:** o menu da web ≤ 350 KB, a primeira partida ≤ 1 MB, o Switch no `portcheck`, os 7
   programas de shader.
4. **"Reduzir efeitos" vale para tudo que é novo:** tremor, balanço, vinheta pulsante, entradas animadas e clarões.
5. **Publicado a cada fase verde** (#80 a #82), com a rodada de prints no fechamento.

## Como o trabalho anda (#82)

As frentes rodam ao mesmo tempo, cada uma num agente com a própria cópia do repositório; eu integro uma por vez (diff
da fase, portão, revisão do Opus, docs, commit e publicação). Como quase tudo passa por `game/src/scene/match.ts`, cada
frente põe a lógica num módulo próprio e deixa na cena só a cola. A fase 0 (este plano e o ajudante de movimento da UI,
`ui/src/motion.ts`) entra antes, para as frentes de HUD e de menus usarem o mesmo.

## Fases

0. **O plano e o ajudante de movimento da UI** (`enterProgress`, `enterSlidePx`, `fadeCommands` sobre a DrawList).
1. **A câmera e a arma na mão:** degrau e escalada suaves; pouso com peso; FOV de velocidade; balanço da cabeça no
   passo do som; a arma com molas (atraso no giro, inclinação no strafe, pose de corrida, coice por arma, ADS com
   curva); troca, recarga e faca animadas na 1ª pessoa; o clarão ilumina a arma; tremor por trauma; o recuo
   interpolado a 144 Hz; a 3ª pessoa sem estalos; cápsulas; vibração no tiro e no abate; luvas na cor do P1–P4 no FFA.
   - **feita em 27/11** (ARCHITECTURE §23.1): os 17 itens e o solavanco do dano; a revisão achou o degrau do cliente online; nenhum golden mudou.
2. **A HUD da partida:** o X de abate com o nome da vítima; o hitmarker com peso; a vida com rastro, vinheta e até 4
   indicadores de dano que giram com a vista; a munição (pouca, vazia, barra de recarga, no lugar certo no toque); a
   sua linha no kill feed; o placar com o seu time; avisos centrais de momento; a contagem com "VALENDO!"; os "+N" de
   pontos; as sequências em texto; a tela de morte; o aliado caído marcado; o kill feed no 3–4P; o fim da partida com
   faixa e respiro; o resultado em cascata, com 0,5 s de trava e o B no Sair.
   - **feita em 27/11** (ARCHITECTURE §23.2): os 15 itens e os 9 do playtest (a arma que trocava sozinha na morte, a ZONA e o toque que cobriam a HUD, o Tab do Royale); nenhum golden mudou.
3. **Os menus e o fluxo:** um destaque por tela; as entradas secas; o "Sair da partida" em dois apertos; o loading com
   o nome do mapa, o resumo e dicas que giram; toda tecla responde ("Abrindo…", erro sem rede, som de erro); a linha
   de ajuda do Mais modos; a Oficina que segue o foco; o +/Start começa; lembrar a última escolha; os nomes iguais em
   cada tela; a Fortaleza com o mapa no nome; o Surpreenda-me com o Royale Grande no PC; o logo em blocos.
   - **feita em 27/11** (ARCHITECTURE §23.3): os 14 itens e os 6 do playtest (o Esc da pausa, a Personalizada do Training, o foco, o logo em blocos igual ao da abertura); nenhum golden mudou.
4. **O som:** o cooldown que calava o inimigo; a variação de tom; a parede que abafa; o dano com lado e o coração que
   acelera; o foley das armas em tempos; o zunido da bala; o abate que sobe de tom e o colete que quebra; passos e
   pouso; os sons dos objetivos (Boom Box, pontos, zona, rodadas, ping); vinhetas de 3 s e o empate; o abafado na
   morte e na explosão colada; o roubo de voz sem estalo; o hitmarker sem "plic" no dano zero; o tique do pente.
   - **feita em 27/11** (ARCHITECTURE §23.4): os 17 itens (o cooldown que calava o inimigo, a variação, a parede, o foley, o zunido, os objetivos, as vinhetas, o abafado, o ambiente); nenhum golden mudou.
5. **O visual:** o strafe sem patinar; a noite legível; a sombra-blob nas props e no que está no chão; a explosão com
   marca e clarão; o pó no pouso e no deslize; o headshot com confete; o Meu Bobo vivo; o aquecimento que desenha de
   verdade e a cortina de entrada.
   - **feita em 27/11** (ARCHITECTURE §23.5): o strafe, a noite, as sombras, a explosão, o pó, o headshot, a cortina e o Meu Bobo; o bloom ficou de fora; nenhum golden mudou.
6. **A mira, o toque e o movimento:** a sensibilidade do ADS pelo zoom; o toque que mira segurando o ADS e o joystick
   que segue o dedo; a assistência de mira que acompanha quem anda de lado; o deslize no pouso (sim, golden e
   protocolo); a correção do online sem estalo.
   - **feita em 27/11** (ARCHITECTURE §23.6): o ADS pelo zoom, o toque, a assistência honesta, o deslize no pouso (protocolo 15) e a correção do online; a quina ficou de fora.
7. **Os bots:** respeitar a proteção de spawn; o alvo também pelo cone; a reação que varia e aparece; olhar para a
   ameaça e para o canto; o mato que esconde; não atirar no vidro; a mira que deriva e atrasa; revidar quem bate;
   rajadas; o Pela vibe sem foguete; aliados que seguem em vaga; zumbis que cercam; sem fila indiana; o passeio que
   vai ao tiroteio; o Laboratório e o card que dizem a verdade; comemoração muda; o índice de lugares no loading; o
   spawn do FFA perto da ação.
   - **7a feita em 27/11** (ARCHITECTURE §23.7): os bots percebem e miram (os 13 itens); os 20 goldens com soldados re-gravados sobre a fase 6; o balance em ordem.
   - **os mips no carregamento, feitos em 28/11** (ARCHITECTURE §23.9): a primeira partida de 992,1 para 935,9 KB, byte a byte igual; abriu espaço para a 7b.
   - **7b feita em 28/11** (ARCHITECTURE §23.8): os bots em grupo, os zumbis que cercam, o spawn (FFA perto da ação, olhando o lado aberto), os nomes numerados e o índice de lugares no loading.
8. **Fechamento:** o portão, a rodada de prints 36, os consertos que ela achar, o `CHANGELOG`, a `ARCHITECTURE` (§23)
   e o `PERF`.

## Perguntas para o Erick (sigo no padrão enquanto ele não responde)

| # | Pergunta | Padrão |
|---|---|---|
| AM1 | **"Reduzir tremor" vira "Reduzir efeitos"** como no GDD §5.5: zera o tremor (hoje deixa 25%), tira o balanço, a vinheta pulsante e as entradas animadas, e limita os clarões a 3 por segundo. | Assim |
| AM2 | **Um destaque por tela:** o botão primário sem foco fica só com o contorno âmbar (hoje fica cheio e parece focado); só o botão com o foco fica cheio. Muda o visual de todas as telas. | Assim |
| AM3 | **Os nomes das telas:** a mesma tela se chama "Mais regras", "Personalizada" e "Mudar regras", e o botão LABORATÓRIO abre a OFICINA. Usar um nome só para cada. | Unificar |
| AM4 | **O TESTES no título público da web** (leva à Cena-vitrine; a R3b o deixou lá). | Deixar como está |
| AM5 | **O spawn do FFA perto da ação:** entre os pontos seguros (sem linha de visão e a mais de 20 m), os 3 com o inimigo mais perto próximo de 35 m, em vez dos 3 mais longe (GDD §4.2.4). | Assim |
| AM6 | **Os bots trocam de arma entre vidas** (30% ao morrer, puxando pela personalidade). Desfaz a primária fixa da partida. | Ainda não |
| AM7 | **A noite mais legível:** um piso de luz absoluto (hoje boa parte da casa da Fazenda à noite fica preto puro). | Assim |
| AM8 | **O logo em blocos** (#43, nunca feito: o título usa texto): letras de blocos com bisel e a faixa laranja das placas, desenhadas pela UI. | Fazer e mostrar no print |
| AM9 | **O fim da partida:** a faixa VITÓRIA/DERROTA e uma câmera lenta de 0,8 s no último abate (só offline). | Assim |
| AM10 | **O toque:** o ADS passa a alternar por padrão (só em instalações novas) e o joystick segue o dedo. | Assim |
| AM11 | **As sequências em texto** ("ABATE DUPLO", "3 SEGUIDOS", "VINGANÇA", "NA CABEÇA"), secas, sem voz. | Assim |
