# BOBOFORCES: GDD, frente Gameplay e Conteúdo

> **Status:** v1 após a Fase 1 (02/11/2026).
> - **Fonte da verdade:** `docs/DECISOES.md`. Se este texto contradisser a tabela, vale a tabela. Se divergir de `tecnico.md` ou `arte-ux.md`, desempata o GDD 9.2 (coluna "Adotado").
> - **[DECIDIDO #n]** é decisão do Erick (n = linha da tabela do DECISOES.md).
> - **[PADRÃO]** é decisão menor do Claude: as da tabela de decisões menores do DECISOES.md e as que esta frente fixa para fechar lacunas. O Erick pode revisar qualquer uma.
> - **Sem marca:** detalhe de design desta frente. Os números são valores iniciais, calibrados pelo robô de balanceamento (6.13) e pelo Teste Zero (M1).
> - **Unidades:** metros e segundos. A grade de construção é de **0,5 m** (1 bloco); medidas de mapa aparecem também em blocos.

---

## 0. Ponto de partida

| Item | Marca |
|---|---|
| Web (PC + celular): solo contra bots, tela dividida local (também no PC, com controles) e online P2P até 4 humanos | [DECIDIDO #1, #24, #25] |
| Switch homebrew: 100% offline, solo + local até 4 em tela dividida; produzido depois, mas projetado desde o dia 1 | [DECIDIDO #1] |
| Visual blocado pixel-art na linha de Block Strike / Pixel Gun 3D: bonecos e armas de caixas texturizadas, cenário de blocos numa grade de 0,5 m, peças fora da grade quando forem mais leves ou mais bonitas | [DECIDIDO #5, #6, #7, #45] |
| Cenário estático: nada é destruído, só detritos cosméticos (cubinhos) | [DECIDIDO #4] |
| Movimentação arcade configurável | [DECIDIDO #8] |
| Violência cartunesca por padrão, sangue como opção | [DECIDIDO #9] |
| Armas baseadas em reais, com nome e visual próprios; zoom (ADS) em todas, desligável por regra | [DECIDIDO #10, #11] |
| 1ª pessoa por padrão, 3ª pessoa opcional | [DECIDIDO #12] |
| Só pt-BR; nomes de modos, armas e bots em inglês bobo | [DECIDIDO #14, #15] |
| Sem progressão: tudo liberado sempre; bobo customizável; bobo cabeçudo (~3 cabeças) | [DECIDIDO #16, #17, #18] |
| Militar cartunesco genérico; mapa 1 = Construto | [DECIDIDO #19, #20] |
| Dificuldade rápida em 5 níveis; Laboratório com núcleo forte no MVP | [DECIDIDO #21, #29] |
| MVP = TDM + FFA + Training + Surpreenda-me simples; ordem MVP → Sofá → Switch → Online | [DECIDIDO #27, #28] |
| Bobo Zombies estilo CoD, com bobos-zumbi cartoon | [DECIDIDO #30, #31] |
| Switch: controle completo por jogador; só uso pessoal | [DECIDIDO #32, #33] |
| Bots sem falas | [DECIDIDO #34] |
| Bobo Royale Mini (24) primeiro | [DECIDIDO #35] |
| Editor de mapas só interno | [DECIDIDO #36] |
| Bots com muitos parâmetros; vários modos (BR, estilo CoD, estilo CS, paintball); X1 e coop com amigos; humanos e bots no mesmo time | conversa original |

---

## 1. Pilares e fantasia do jogador

### 1.1 Fantasia
**"Eu sou o dono do servidor."** É o gmod de antigamente: você escolhe o mapa, os inimigos, o jeito deles e as regras. Depois entra para dar tiro do jeito que quiser, pela vibe ou suando. Ninguém te julga, e não tem ranking nem estranho xingando.

### 1.2 Pilares
Cada pilar vem com um teste para decidir features.

1. **Você é o game designer da partida.** Toda regra de jogo é configurável, sempre com um bom padrão.
   - Teste: "isso pode virar opção de partida personalizada?" Se for regra, deve poder.
2. **Estresse zero por padrão.**
   - Não tem ranking nem punição por sair. O solo pausa de verdade, e a revanche sai em 1 toque.
   - O Tryhard é escolha do jogador, nunca imposto.
   - Teste: "isso pune o jogador relax?" Se pune, vira opção desligada por padrão.
3. **Do clique ao tiro em segundos.**
   - JOGAR em 1 interação; partida nova configurada em até 3.
   - Partidas de 5 a 10 min. Nenhum tutorial obrigatório (o primeiro minuto da 2.5 é todo pulável).
   - Teste: "isso adiciona uma tela obrigatória?" Se adiciona, corta ou deixa opcional.
4. **Bots com nome e jeito.** A IA é divertida e legível antes de ser sofisticada.
   - O bot erra de um jeito engraçado e ganha de um jeito justo.
   - Vantagem escondida não existe: só vale se você ligar, e aparece no card do bot.
   - Bots não falam [DECIDIDO #34]: o jeito aparece no movimento, nas escolhas e em ícones.
5. **Junto no sofá ou pelo link.** Humanos e bots jogam no mesmo time. Todo modo funciona solo, local e online quando faz sentido (regra de ouro, 7.5).
6. **Brinquedo bonito que reage.** Cada tiro, impacto, morte e explosão gera feedback: cubinhos com a cor e a textura do alvo, faíscas, confete. A execução fica com a frente de arte.

### 1.3 O que BoboForces não é
- Competitivo ranqueado.
- Matchmaking ou sala pública com estranhos [PADRÃO: online só por código ou link].
- Jogo de progressão ou desbloqueio [DECIDIDO #16].
- Campanha com história.
- Loja, moedas ou passe de batalha.
- Simulador militar realista [DECIDIDO #19].

### 1.4 Sessões-alvo
| Sessão | Quem | Duração | Exemplo |
|---|---|---|---|
| Vibe | solo | 5–15 min | JOGAR: TDM contra bots De boa, muita kill |
| Desafio | solo | 15–40 min | "Jorge the Immortal" ×8 no nível Suado, repetindo até vencer |
| Sofá | 2–4 local | 10–30 min | Bobo Zombies 10 ondas, ou 4 humanos contra 12 bots |
| Link | 2–4 online | 10–60 min | X1 sniper, 2v2 com 8 bots por time, coop 4 contra 40 (host no PC) |
| Aquário (M6+) | solo/local | livre | Assistir bots se matando e entrar no meio |

---

## 2. Loop de partida

### 2.1 Sessão (macro)
1. Abrir. Metas da frente técnica (`tecnico.md` 16.4): menu em até 2 s no PC e 4 s no celular; primeira partida em até 5 s no PC e 10 s no celular.
2. Escolher um caminho:
   - **JOGAR**: repete o último preset, 1 interação. Na primeira vez, é a partida de estreia (2.5).
   - **Partida Rápida**: modo, mapa e nível (3 escolhas, cada uma já com padrão).
   - **Surpreenda-me**: 1 interação mais "Jogar".
   - **Personalizar**: abas completas (seção 10).
3. Jogar a partida (5 a 10 min).
4. Ver o resultado.
5. Seguir com De novo (revanche), Mais fácil, Mais difícil, Mudar regras, Salvar preset, Salvar nêmesis ou Sair.

### 2.2 Partida (meso)
- **Contagem:** 3 s, com a câmera mostrando o mapa e os nomes dos bots inimigos ("Hoje: 6 Jorges").
- **Jogo:** até a meta ou até o tempo acabar. Empate em TDM ou FFA leva a 60 s de morte súbita: a próxima kill vence.
- **Pausa** (offline): Continuar · Ajustar desafio · Ajustes · Destravar · Sair. "Ajustar desafio" muda o nível dos bots no meio da partida.
- **Resultado:** precisa ser lido em até 10 s.
  - Vencedor e placar.
  - **MVP** (humano ou bot).
  - **Nêmesis**: o bot que mais te matou, com botão "Salvar na Oficina".
  - **Freguês**: quem você mais matou.
  - 3 números pessoais: kills, precisão e maior sequência.
- **Botões do resultado:**
  - **De novo:** mesma configuração, nova seed. Foco padrão, exceto depois de derrota feia (11).
  - **Mais fácil / Mais difícil:** move o nível rápido 1 passo e já reinicia a partida.
  - Mudar regras, Salvar preset, Sair.

### 2.3 Combate (micro)
- **Sequência:** spawn, deslocamento até o contato, troca de tiros, kill ou morte, respawn.
- **Metas de ritmo:**
  - Do spawn ao primeiro contato: 5–10 s num mapa médio com 12 participantes.
  - Em TDM solo padrão, 1 encontro a cada 10–15 s.
  - TTK das automáticas sem errar, no corpo: 0,28–0,45 s.
  - Respawn: 3 s.
- **Alavancas de ritmo:** tamanho do mapa, número de bots, agressividade (personalidade) e distância de spawn.
- **Recompensa por kill:** hitmarker, som, cubinhos com a cor do alvo, kill feed. Bots não falam [DECIDIDO #34].

### 2.4 Fora da partida (meta)
- **Laboratório:** cria ou ajusta um bot, aperta **Testar** (Bobo Training em até 2 s), volta, salva e usa num preset.
- **Recordes e estatísticas locais** (seção 9). Nada libera nada [DECIDIDO #16].
- **Meu Bobo:** customização do personagem, toda liberada [DECIDIDO #17].

### 2.5 O primeiro minuto (onboarding opcional) [PADRÃO]
Nenhuma etapa é obrigatória; todas têm "Pular" ou somem sozinhas.

| Momento | O que acontece |
|---|---|
| Abrir pela 1ª vez | O jogo detecta o dispositivo pelo **primeiro input** (mouse/teclado, toque ou controle) e escolhe layout de controles, glifos de botão, assistência de mira (mouse: Desligada; controle e toque: Média) e o texto das dicas. No celular, aviso "Gire o celular" se estiver em retrato. |
| JOGAR (1 interação) | **Partida de estreia:** Bobo Warfare TDM no Construto, 4v4 (você + 3 bots aliados contra 4 bots), todos no nível **De boa**, 5 min ou 30 kills. |
| Contagem estendida (só na 1ª vez) | **Calibrar a sensibilidade em ~10 s:** 3 alvos aparecem espalhados no Construto. O jogador mira e atira; o jogo mede se ele passa do alvo ou não chega, sugere a sensibilidade e mostra "Ajustei sua mira" com "Desfazer". Botão "Pular" sempre visível. Dá para refazer em Ajustes ou no Bobo Training. |
| Primeiras 2 partidas | **Dicas de 1 linha** com os glifos do dispositivo ativo, no contexto, cada uma no máximo 1 vez, sem pausar: ficar 5 s sem correr → "Shift corre"; correr perto de cobertura → "C agacha; correndo, desliza"; inimigo a mais de 20 m → "Botão direito mira com zoom"; pente vazio → "R recarrega". No controle e no toque, o mesmo texto com o glifo certo. Desligável em Ajustes. |
| Fim da 1ª partida | Resultado normal + card opcional **"Conheça o Laboratório"**: mostra Jorge the Immortal com os 4 eixos e o botão **Testar** (arena em até 2 s). "Agora não" fecha e não volta. |
| Troca de dispositivo | Se surgir outro tipo de input (ex.: controle conectado), o jogo troca os glifos e as dicas na hora. |

No Switch, o lobby "aperte A" já é a tela inicial (seção 12); a calibração e as dicas são as mesmas, por slot.

---

## 3. Corpo e movimentação

### 3.1 Métricas do bobo: tabela única [PADRÃO]
Esta tabela fica num arquivo de configuração e **manda sobre arte e técnica**: modelo, colisão, câmera, navegação e mapas leem os mesmos números.

| Medida | Valor | Em blocos (0,5 m) | Marca |
|---|---|---|---|
| Proporção | cabeçudo, 4 cabeças: o boneco do FutBobo em escala uniforme (1 px = 7/128 m; 32 px = 1,75 m; cabeça de 8 px) | — | [DECIDIDO #18, #55, #56] |
| Altura em pé | 1,75 m (era 1,625 m e antes 1,5 m) | 3½; o vão livre pede 4 | [DECIDIDO #55; valor = variante B] |
| Olho em pé | 1,55 m (corpo − 0,2 m; era 1,425 m e antes 1,3 m) | — | [PADRÃO] |
| Agachado (altura / olho) | 0,95 m / 0,8 m | ~2 | [PADRÃO] |
| Cabeça | 0,4375 m (cubo de 8 px do FutBobo; era 0,5 m) | ~1 | [DECIDIDO #56] |
| AABB de movimento | 0,6 × 1,75 × 0,6 m (0,95 agachado) | — | [PADRÃO] |
| Degrau automático | 0,5 m | 1 | [PADRÃO] |
| Pulo padrão (perfil Bobo) | 1,0 m | 2 | [PADRÃO] |
| Cobertura baixa | 1,0 m (esconde o bobo agachado; em pé, atira por cima) | 2 | [PADRÃO] |
| Cobertura alta | ≥ 1,75 m (esconde o bobo em pé) | 4 (2,0 m) na grade, ou peça fora da grade | [PADRÃO] |
| Porta | 1,0 × 2,0 m | 2 × 4 | [PADRÃO] |
| Corredor mínimo | 1,0 m; confortável 1,5–2,0 m | 2; 3–4 | [PADRÃO] |
| Pé-direito mínimo | 2,0 m; 3,0 m onde se espera pulo | 4; 6 | [PADRÃO] |
| Andar de prédio | 3,0 m | 6 | [PADRÃO] |
| Queda sem dano | até 5 m | 10 | [PADRÃO] |
| Skin | pixel art pintada direto em 2 camadas 64×64 (cabeça, expressões e paleta; tronco e listras), ~36,6 texels/m; cabelo e acessórios são caixas na cabeça | — | [PADRÃO, #51; #56] |

**Hitboxes** (12 caixas orientadas, uma por osso, lidas da tabela de pose do boneco; "o que você vê é o que acerta"). Decisões menores do port do boneco do FutBobo, **revisáveis**: o Erick decide na rodada 3 de prints.

| Parte (osso) | Caixa (L × A × P, px) | Metros | Categoria e dano |
|---|---|---|---|
| Cabeça | 8 × 8 × 8 | 0,4375 × 0,4375 × 0,4375 | cabeça: multiplicador da arma (5.1) |
| Tronco | 8 × 12 × 4 | 0,4375 × 0,656 × 0,219 | tronco 1,0x |
| Braço D e E (manga) | 4 × 5,2 × 4 | 0,219 × 0,284 × 0,219 | braço 0,8x |
| Antebraço + mão D e E (uma caixa só) | 3,8 × 6,8 × 3,8 | 0,208 × 0,372 × 0,208 | braço 0,8x |
| Coxa D e E | 4,25 × 5,6 × 4,3 | 0,232 × 0,306 × 0,235 | perna 0,8x |
| Canela D e E | 3,75 × 4,9 × 3,75 | 0,205 × 0,268 × 0,205 | perna 0,8x |
| Chuteira D e E | 4,05 × 2,7 × 5,25 | 0,221 × 0,148 × 0,287 | perna 0,8x |

- A camada de cabelo e os acessórios (caixas na cabeça) **nunca são hitbox**, e têm limite de volume para não esconder a cabeça. O cabelo tem **teto de jogo por recorte**: 1,99 m em pé e 0,99 m agachado ou deslizando (em pé só o afro gigante e o moicano espetado passam do teto). A aba do boné pode entrar numa parede encostada, como em todo FPS.
- **Uma tabela só:** as caixas são as do `arte-ux.md` 2.1 (`format/src/model/figure*.ts`; as do bobo A, `bobo.ts`, saíram). A tabela tem **22 posturas** (em pé 10, agachado 7, deslizando 4 e o zumbi) × **5 pitches** (−1,2; −0,6; 0; 0,6; 1,2); a sim interpola centros e R, reortonormaliza e soma a folga entre as amostras, e a **fase larga** (raio no plano e topo por postura) só descarta o que não pode acertar. A sim troca a postura no tick; o render mistura em 120 ms. Cada tiro lê a caixa da pose daquele tick (cache por entidade por tick); medido 0,18–0,39 µs por raio com JIT (meta ≤ 0,6).
- **Cabeça presa ao olho:** o tronco não leva o pitch, a cabeça gira no máximo 0,6 rad em pé, o pescoço desliza até 1,5 px para compensar e braços e arma levam o resto. **Agachado e deslizando a cabeça só levanta** (pitch em [0; +0,1]): é o que faz o "agachado atrás da cobertura de 1,0 m não leva tiro além de 7 m" valer em todo pitch (alcance máximo de exposição 6,81 m com giro ±45° e atirador ±30°; medido 0 acerto em 7–30 m, 3 sementes × 10 mil tiros).
- **Agachado P4f (#55):** topo da hitbox **0,97 m no máximo** (era 0,95) em qualquer pitch e empunhadura (medido 0,95978 m; 0,94013 m com o pitch para baixo; a fase larga mede 0,9698 e não conta). O texto "nenhum tiro horizontal acima de 0,95 m acerta o agachado" vira **0,97 m**; a cobertura baixa de 1,0 m deixa 3 cm de folga. Em pé o teto é 1,81 m (medido 1,80375 m, sniper em ADS com o pitch 0,47). Deslizando, topo 0,94875 m.
- **Braço através de muro e lona:** as hitboxes de braço (manga e antebraço, D e E) são cortadas a **0,75 m do eixo** da entidade no plano horizontal (um quadrado alinhado ao mundo = a AABB crescida de 0,45 m; `ARM_HIT_CUT_M`). A arma e a mão aparecem do outro lado de um muro fino ou de uma lona, mas ali não levam tiro: com um muro de 1 bloco (0,5 m), 0 de 2.000 tiros acertam (sem o corte, 100%). O visual continua igual. O `mapc` mede os dois: o braço visual atravessa barreira em 1.256 nós do Construto (1.213 em pé com a sniper, 1.256 agachado), a hitbox em **15** (14 da cerca de tábua e 1 quina de rampa); a cabeça em pé (0,409 m do centro), o tronco agachado e as coxas também saem da AABB e passam pela cerca de 6,25 cm. O corte vale para o zumbi também.
- **Fora da regra "visual ⊂ hitbox + 1 px", de propósito** (medido e relatado): passada das pernas, braço E na recarga, pernas no ar, transitórios do envelope de até 2 px e o giro preguiçoso das pernas (até 0,35 rad). Concordância entre a sim e o visual (raios): 99,53% nas amostras e 99,37% entre elas, 99,68% por categoria, 0 casos de cabeça visual sem acerto na sim; por osso o piso é 99,2% (a caixa única de antebraço + mão).
- **Headshot:** os multiplicadores ficam (padrão 1,5x, sniper 2,0x, escopeta 1,25x; braço e perna 0,8x). Com a cabeça de 0,4375 m e a hitbox por osso, o robô de balanceamento (semente 42, 3.000 duelos por par) mede, **contra o bobo A**:

| Nível | Precisão (A → agora) | Headshot (A → agora) | TTK (A → agora) |
|---|---|---|---|
| Pela vibe | 3,4% → 3,2% | 35,4% → 41,7% | 1,60 s → 2,72 s |
| De boa | 7,9% → 7,2% | 46,4% → 39,0% | 2,13 s → 2,31 s |
| Normal | 16,9% → 15,6% | 57,6% → 44,5% | 1,21 s → 1,57 s |
| Suado | 31,0% → 28,6% | 55,7% → 46,4% | 0,52 s → 0,66 s |
| Tryhard | 37,5% → 35,5% | 66,1% → 59,4% | 0,29 s → 0,35 s |

  Os 5 níveis seguem em ordem e o par mais apertado (De boa × Pela vibe) é 84,4% (85,7% no bobo A). O headshot do Normal cai 13 pontos e o TTK sobe 20–30% (o plano previa −3 a −11 pontos e +8–16%); o Tryhard fica em 59,4% (o critério era 60%). A IA mira na parte VISÍVEL da caixa (teto de 2 miras desse tipo por tick), o que dá cabeça em 100% e tronco em 97,2% dos raios no ponto mirado, e custa 8,4 pontos de headshot ao Normal; mirando o centro da caixa o headshot do Normal seria 52,9% e o E.5 geométrico reprovaria. Pergunta G3 (multiplicadores) e a escolha mira visível × centro ficam com o Erick.
- **Em aberto:** a escala do Chonker e do Mega na hitbox (M3); o emote no `ActorBuffer` (M2).
- Escadas de blocos funcionam pelo degrau automático, com suavização da câmera. Rampas (peças fora da grade) de até 45° são andáveis.

### 3.2 Princípio
- Existe **um conjunto único de parâmetros**. Os "perfis" são presets desse conjunto [DECIDIDO #8].
- O perfil é uma **regra da partida**, igual para todos. No online, o host escolhe.
- O padrão é o perfil **Bobo**: rápido e gostoso, com correr, pular e deslizar. Regras ligam bhop, wall jump e pulo duplo, ou deixam tudo mais lento e tático.

### 3.3 Perfis
| Parâmetro | Tático (estilo CS) | **Bobo** (padrão) | Arcade (bhop/wall jump) |
|---|---|---|---|
| Andar | 4,0 m/s | 4,8 m/s | 5,5 m/s |
| Correr (sprint, sem limite de fôlego) | 5,5 m/s, não atira | 6,8 m/s, não atira; voltar a atirar leva 0,15 s | 8,0 m/s, atira correndo (spread de "no ar") |
| Agachado | 2,0 m/s | 2,4 m/s | 3,0 m/s |
| Altura do pulo | 0,8 m | 1,0 m | 1,3 m + pulo duplo |
| Slide | não | sim: 0,7 s, começa a 8 m/s, recarga de 1 s | sim, mantém o momento |
| Bunny hop | não (aterrissar freia) | não (velocidade no ar limitada) | sim: +5% por pulo encadeado, teto de 12 m/s |
| Wall jump | não | não | sim (1 por parede) |
| Escalar borda (mantle) | até 1,0 m (2 blocos) | até 1,5 m (3 blocos) | até 2,0 m (4 blocos) |
| Penalidade de precisão em movimento | alta | média | baixa |
| Dano de queda | sim | sim | não |

### 3.4 Regras comuns
- **Blocos e peças especiais:**
  - Escada de mão: escalável a 3 m/s.
  - Água: fora do M2. Se um mapa tiver, é só área lenta (0,5x).
- **Multiplicador de spread por estado:**

  | Parado | Andando | Agachado | No ar | Sprint |
  |---|---|---|---|---|
  | 1,0 | 1,5 | 0,8 | 2,5 | não atira (Arcade: 2,5) |

- **ADS (mirar com zoom) em todas as armas** [DECIDIDO #11]:
  - Leva 0,2–0,35 s conforme a arma.
  - Movimento a 0,6x durante o ADS.
  - Spread de 0,3x.
  - A regra "ADS desligado" deixa todas no quadril; a sniper perde o zoom e fica com o spread de quadril do fuzil.
- **Perfil "Personalizado":**
  - Velocidade 0,5–2x, gravidade 0,3–2x, pulo 0,5–3x, dano de queda on/off.
  - Pulo duplo, bhop e wall jump on/off chegam com o Arcade (M6+).

### 3.5 Câmera [DECIDIDO #12]
- **1ª pessoa por padrão; 3ª pessoa opcional**, por jogador.
- **3ª pessoa:** câmera de ombro (troca de ombro num botão), com colisão contra o cenário. O tiro sai do olho do bobo: a mira usa o raio da câmera, e se o caminho do olho até o ponto mirado estiver bloqueado, a bala acerta o bloqueio. Assim a 3ª pessoa não atira por trás de parede.
- **Regra "Câmera permitida"** [PADRÃO]: "1ª e 3ª" (padrão) ou "só 1ª". No online, o host escolhe e todos veem no lobby.
- **FOV por jogador** [PADRÃO]: PC 70–110 (padrão 90); celular e Switch 70–100 (padrão 80). Na tela dividida, cada vista tem o FOV do seu jogador.
- Viewmodel (arma na mão) só na 1ª pessoa.
- **Marco:** 1ª pessoa desde o M1; 3ª pessoa no M2 [PADRÃO].

### 3.6 Restrições que o movimento impõe a mapas e bots
- **Todo mapa precisa ser 100% atravessável no perfil Tático**, o mais restrito: nenhum obstáculo obrigatório acima de 1,0 m sem escada ou rampa. Atalhos que só o Bobo ou o Arcade alcançam são bônus.
- A navegação dos bots (grade 2,5D com A* + flow field [PADRÃO]) lê os parâmetros do perfil ativo: altura de pulo e de mantle definem quais ligações da rota valem.
- A navegação guarda a **altura livre** de cada célula. Bot com regra de tamanho maior que 1x só usa células onde cabe.
- **No M2, bots usam** andar, correr, agachar, pular, mantle e slide. Não fazem bhop nem wall jump.
- Bots a partir do nível **Suado** fazem strafe e pulo de esquiva em combate.
- **Marcos:** perfil Bobo no M0 (a sim headless e o robô de balanceamento precisam dele), testado na cena do Teste Zero no M1; Tático e Personalizado no M2 (são só números); Arcade completo no M6+, junto com o Bobo Chaos [PADRÃO].

---

## 4. Armas

### 4.1 Princípios
- **Base real, nome e visual próprios** [DECIDIDO #10]: silhueta reconhecível de fuzil, SMG, escopeta, sniper; nenhuma marca ou nome comercial. Modelo de caixas com textura pixel-art [DECIDIDO #7].
- **Nomes em inglês bobo** [DECIDIDO #15]; a categoria aparece em pt-BR na interface ("Rattler · Fuzil").
- **Leitura:** cada arma tem 1 papel claro e 1 fraqueza clara.
- **Hitscan vs. projétil:**
  - Balas são hitscan: raio por DDA na grade de blocos, mais as caixas e rampas das peças fora da grade, mais as hitboxes dos bobos [PADRÃO].
  - Foguete, granada, tinta e futuras bestas são projéteis.
- **Equidade:** humanos e bots usam as mesmas armas com os mesmos números. Qualquer diferença vem de uma Regra explícita (6.5).
- **Recoil:** padrão fixo por arma, que dá para aprender, mais um ruído pequeno. O bot "aprende" o padrão conforme o parâmetro Controle de recoil.
- **Manuseio:**
  - Troca de arma em 0,4 s.
  - No Bobo Warfare você carrega primária, pistola, faca e 2 granadas.
- **Munição:**
  - Pente + reserva de 3 pentes.
  - No Bobo Warfare, quem morre deixa uma "caixinha de munição".
  - Munição infinita existe como regra.
- **Bot primeiro:** nenhuma arma entra no jogo sem o bot saber quando usá-la (alcance preferido e situação).

### 4.2 Categorias
| Categoria | Papel | Fraqueza | Marco |
|---|---|---|---|
| Pistola | secundária confiável | dano baixo | M2 |
| SMG | curta distância, mobilidade | perde dano longe | M2 |
| Fuzil de assalto | versátil, média distância | nada se destaca | M1 (Teste Zero) / M2 |
| Escopeta | mata de perto | inútil a mais de 15 m | M2 |
| Sniper | longa distância, 1 tiro na cabeça | lenta, fraca sem zoom | M2 |
| Explosivo (lança-foguetes) | dano em área, tira gente da cobertura | lento, causa autodano | M2 |
| Corpo a corpo (faca) | finalização, humilhação boba | alcance de 2 m | M2 |
| Arremessável (granada) | tira gente da cobertura | 2 por vida | M2 |
| LMG | supressão | lenta pra mirar e recarregar | reserva do M2 / M6+ |
| DMR | semi-auto de média e longa | pune quem erra | M6+ |
| Especiais | armas de modo (tinta, minigun, arma maravilha) | só no modo dela | com o modo |

### 4.3 Arsenal do M2: 8 armas [PADRÃO]
Pistola, SMG, fuzil, escopeta, sniper, lança-foguetes, faca e granada. A LMG é a reserva se o explosivo atrasar. Os nomes são [PADRÃO] para o Erick aprovar ou trocar; os IDs internos (`pistol`, `smg`...) nunca mudam. HP base 100.

**Headshot** [PADRÃO]: padrão **1,5x**; sniper **2,0x**; escopeta **1,25x**. A cabeça do bobo cabeçudo é grande (0,5 m), por isso os multiplicadores são baixos. Calibrado pelo robô de balanceamento.

| Arma (ID) | Nome | Dano no corpo | Mult. cabeça | Cadência | Pente | Recarga | Alcance / queda | Tiros p/ matar (corpo / cabeça) |
|---|---|---|---|---|---|---|---|---|
| Pistola (`pistol`) | Pop Gun | 25 | 1,5x | semi, até 400/min | 12 | 1,3 s | 100% até 25 m, cai para 15 aos 40 m | 4 / 3 |
| SMG (`smg`) | Buzzer | 20 | 1,5x | 850/min | 30 | 1,8 s | 100% até 12 m, cai para 12 aos 25 m | 5 / 4 |
| Fuzil (`rifle`) | Rattler | 28 | 1,5x | 600/min | 30 | 2,2 s | 100% até 35 m, cai para 20 aos 60 m | 4 / 3 |
| Escopeta pump (`shotgun`) | Door Knocker | 8 chumbos × 14 | 1,25x | 70/min | 6 | 0,5 s por cartucho | 100% até 8 m, chega a 0 aos 20 m | 1 de perto |
| Sniper de ferrolho (`sniper`) | Peekaboo | 95 | 2,0x | 45/min | 5 | 3,0 s | sem queda; zoom 4x; sem zoom o spread é enorme | 2 / 1 |
| Lança-foguetes (`rocket`) | Kaboomer | 120 direto; área de 100 → 0 em 4 m | n/a | 1 tiro, 2,8 s | 1 (+3) | 2,8 s | projétil a 35 m/s; autodano de 50% | 1 |
| Faca (`knife`) | Butter Knife | 55 de frente; 100 pelas costas | n/a | 0,5 s por golpe | n/a | n/a | 2 m | 2 / 1 pelas costas |
| Granada (`grenade`) | Pineapple | 110 no centro, chega a 0 em 5 m | n/a | 2 por vida | n/a | n/a | pavio de 2,5 s, dá para "cozinhar", quica | n/a |
| LMG, reserva (`lmg`) | Lawnmower | 22 | 1,5x | 700/min | 100 | 4,5 s | 100% até 30 m, cai para 15 aos 55 m | 5 / 4 |

**TTK sem errar (corpo):**
- Fuzil: 0,30 s (cabeça: 0,20 s).
- SMG: 0,28 s até 12 m e cerca de 0,56 s aos 25 m.
- Pistola: 0,45 s no ritmo máximo.

**Decisões de balanceamento:**
- A sniper tira 95 no corpo de propósito: o tiro no corpo não mata sozinho, para a sniper não massacrar o jogador relax. A regra "Sniper mata no corpo" liga o contrário.
- O explosivo pede projétil, dano em área, autodano e a decisão do bot de usar. Se atrasar, a LMG entra no lugar e o lança-foguetes vai para o M6+.

### 4.4 Como o jogador consegue armas
- **Loadout livre** [PADRÃO]: a primária é escolhida num menu radial na tela de morte e vale a partir do próximo spawn.
- **Opções de regra:**
  - **Fixo:** todos com a mesma arma.
  - **Aleatório:** muda a cada vida.
  - **Pickups no mapa:** estilo arena, com a arma reaparecendo após 20 s (M6+).
  - **Escada:** troca de arma por kill (é o Gun Game, M6+).

### 4.5 Modificadores de arma (regras de partida, valem em qualquer modo)
| Modificador | Valores | Marco |
|---|---|---|
| Multiplicador de dano | 0,25x a 5x | M2 |
| Só headshot conta | on/off | M2 |
| Um tiro mata | on/off | M2 |
| Munição | normal / reserva infinita / pente infinito | M2 |
| ADS | on/off [DECIDIDO #11] | M2 |
| Armas permitidas | lista | M2 |
| Loadout | ver 4.4 | M2 (livre, fixo, aleatório) |
| Recoil | on/off | M2 |
| Spread | on/off | M2 |
| Fogo amigo | off / 50% / 100% | M2 |
| Autodano | on/off | M2 |
| Hitmarker | on/off | M2 |
| Sniper mata no corpo | on/off | M2 |
| Explosivos bobos | tudo que morre explode: 60 de dano em raio de 3 m | M6+ |
| Velocidade de projétil | 0,5x a 2x | M6+ |

**Attachments** (miras, silenciador): fora do M2 [PADRÃO]. Se entrarem, vêm como variantes simples de cada arma, não como um "gunsmith" completo.

### 4.6 Arsenal futuro (backlog M6+, sem compromisso)
- **Armas convencionais:** LMG (se não entrou no M2), DMR, revólver, escopeta automática.
- **Projéteis e lançadores:** besta (o virote fica preso no bloco por alguns segundos, como decal) e lança-granadas.
- **Armas de modo:**
  - Minigun do Bobo Juggernaut ("Big Brrt").
  - Marcadores de tinta: automático, pump, sniper e granada-balde (Bobo Paintball).
  - Arma maravilha do Bobo Zombies, por exemplo um raio que desmonta o zumbi em cubinhos.
  - Arma de confete ou bolha (Bobo Chaos).
- **Corpo a corpo:** martelo e pá.
- **Equipamentos:** fumaça, flash, mina, torreta automática (Zombies), kit médico e escudo.

---

## 5. Vida, dano, headshot e respawn

### 5.1 Base
- **HP:** 100.
- **Zonas de dano:** cabeça (multiplicador da arma: padrão 1,5x, sniper 2,0x, escopeta 1,25x [PADRÃO]), tronco 1,0x, braços e pernas 0,8x.
- **Hitboxes:** as 6 caixas do boneco (3.1). O que você vê é o que acerta.
- **Assistência:** conta quem causou 25 ou mais de dano na vítima nos últimos 10 s.
- **Queda:** a partir de 5 m, 12 HP por metro a mais. Pode ser desligada.
- **Explosão:** autodano de 50%.
- **Fogo amigo:** desligado por padrão.

### 5.2 Padrões por família de modo
| | Bobo Warfare / Paintball | BoboStrike | Bobo Royale | Bobo Zombies |
|---|---|---|---|---|
| Regeneração | espera 5 s, depois 25 HP/s | não | não (kits) | espera 4 s, depois 20 HP/s |
| Colete | não | 50 ou 100, absorve 50% (tronco e membros) | 50/100 encontrado no chão | não |
| Respawn | 3 s (configurável 0–15 s) | não no round | não (em grupo: reviver) | caído, depois reviver; morto volta na onda seguinte |
| Proteção de spawn | 1,5 s ou até atirar | n/a | n/a | n/a |

### 5.3 Spawns
- **TDM:** spawn na zona do time, escolhendo o ponto com menos inimigos à vista.
- **FFA:** pontuação por ponto de spawn. O ponto precisa estar sem linha de visão de inimigo e a mais de 20 m dele; escolhe-se o melhor entre os 3 com maior nota.
- **Segurança:** se o bobo nascer dentro de bloco sólido (erro de mapa), a colisão o empurra para a célula livre mais próxima e o F2 registra o ponto.

### 5.4 Caído e reviver (Bobo Zombies, coop e Royale em grupo) — M3
- Fica 30 s no chão, rastejando a 1 m/s, só com a pistola.
- Reviver: segurar o botão 3 s perto do caído [DECIDIDO #30].
- **Solo:** 3 "levanta sozinho" por partida (configurável de 0 a infinito).
- O bot aliado com personalidade **Suporte** revive.
- Se todos caem, é derrota.

### 5.5 Morte
- **Câmera de morte de 1,5 s** olhando quem te matou, com nome, arma e HP restante. Exemplo: "Jorge the Immortal · Door Knocker · 340 HP".
- **Corpo** [DECIDIDO #9]: o bobo se desmonta em cubinhos e confete, sem sangue. A opção "Sangue" nas configurações (por jogador, só muda o que ele vê) troca o confete por cubinhos vermelhos. No Bobo Paintball, tinta.
- **Detritos:** cubinhos com a cor e a textura da parte atingida, com teto de quantidade por plataforma (frente técnica).
- **Indicador direcional de dano:** sempre ligado. Compensa o áudio sem 3D no Switch (seção 12).

### 5.6 Pausa
- **Solo:** pausa real. Pausa automática quando o pointer lock é perdido (o Esc o solta) ou a aba fica oculta [PADRÃO].
- **Local:** qualquer jogador pausa para todos (a simulação é compartilhada).
- **Online, PvP:** sem pausa.
- **Online, coop:** o host pode pausar para todos; se o host for para segundo plano, o coop pausa sozinho [PADRÃO].

---

## 6. Bots: o Laboratório de IA

### 6.1 Princípio: 4 eixos independentes, mais o visual
**Bot = Inteligência + Habilidade + Personalidade + Regras + Visual e nome** [DECIDIDO #29]

| Eixo | Pergunta que responde |
|---|---|
| Inteligência | o quanto ele pensa |
| Habilidade | o quanto ele acerta |
| Personalidade | o que ele prefere fazer |
| Regras | que vantagem ou desvantagem ele tem |

Qualquer combinação vale: "gênio que não acerta nada", "burro que nunca erra", "covarde imortal".

**A personalidade só se expressa dentro do que a inteligência permite.** Um Estrategista no N0 é um bot burro que gosta de objetivo.

### 6.2 Habilidade mecânica
| Parâmetro | Faixa | Efeito |
|---|---|---|
| Tempo de reação | 100–1200 ms | entre ver o alvo e começar a mirar |
| Erro de mira | 0,2°–10° | desvio em torno do ponto mirado, depois de "fechar" a mira |
| Aquisição | 0–1,5 s | tempo para o erro cair do inicial (3x) ao mínimo; o bot erra os primeiros tiros e vai fechando |
| Velocidade de giro | 90–900 °/s | quanto ele vira para pegar quem flanqueou |
| Controle de recoil | 0–100% | quanto do padrão de recoil ele compensa |
| Preferência por cabeça | 0–100% | chance de mirar na cabeça e não no tronco |
| Disciplina de tiro | rajada curta ↔ segura o gatilho | controle vs. spam |
| Movimento em combate | parado / strafe / strafe + pulo/agacha | dificuldade de ser acertado |
| Uso de granada | 0–100% | frequência |
| Troca de alvo | 0,2–2 s | tempo para mudar de alvo |

O erro precisa ser **legível**: tracer e impacto mostram a bala passando perto ("quase"). Assim o jogador entende que o bot é ruim e não que o jogo está bugado.

### 6.3 Inteligência: níveis cumulativos
| Nível | Nome | Faz |
|---|---|---|
| N0 | Zumbi | vai pela rota até o alvo mais próximo e atira quando vê; ignora cobertura |
| N1 | Básico | procura cobertura quando toma dano, recarrega protegido, investiga sons, patrulha |
| N2 | Esperto | flanqueia (pega outra rota se a direta tem inimigo), segura ângulos, recua com HP baixo, joga granada em cobertura, joga o objetivo |
| N3 | Time | compartilha o que viu com o time (e mostra um ícone de ping para os humanos aliados), avança em dupla ou trio, embosca em pontos marcados no mapa, faz cerco dividindo as rotas |
| N4 | Leitor | aprende seu padrão **na partida**, evita rotas onde morreu, finge recuar |

**Como o N4 aprende:**
- Monta um mapa de calor em células de **4 m** [PADRÃO]: onde você fica e de onde você mata.
- Pré-mira e joga granada nessas células.
- A memória decai em 2 min.

**Modo avançado:** liga e desliga cada comportamento individualmente: cobertura, flanquear, recuar, granadas, comunicar com o time, emboscar, aprender, jogar o objetivo.

**Memória entre partidas:** só para o Nêmesis, no M6+.

**Percepção (padrão, alterável por Regras):**
- Visão: cone de 120°. **Alcance = alcance de visão da partida**, o mesmo dos humanos [PADRÃO]; nunca passa do teto do perfil (8.3) sem uma Regra visível.
- Linha de visão checada 5–10 vezes por segundo por bot, com os bots escalonados entre frames.
- Vegetação alta (peça em cruz) não bloqueia bala, mas reduz pela metade a chance de detecção de quem está atrás dela.
- **Audição:**

  | Fonte | Alcance |
  |---|---|
  | Tiro | 50 m |
  | Passo correndo | 15 m |
  | Passo andando | 6 m |
  | Agachado | 0 |

- O bot sempre sabe a direção de onde tomou dano.

### 6.4 Personalidade: pesos de decisão
**Pesos:** agressividade, cautela, paciência, lealdade ao time, foco no alvo, mobilidade, distância preferida (m), apego ao objetivo e bobeira (chance de ação boba).

| Personalidade | Agress. | Cautela | Paciência | Distância | Comportamento visível |
|---|---|---|---|---|---|
| Equilibrado | 0,5 | 0,5 | 0,5 | 20 m | padrão |
| Rusher | 0,9 | 0,1 | 0,2 | 6 m | corre pro contato, atira andando, pula muito |
| Lunático | 0,8 | 0,0 | 0,0 | aleatória | troca de intenção a cada 2–5 s, pula, atira pro alto |
| Covarde | 0,2 | 0,9 | 0,6 | 35 m | foge com HP < 60%, manda ping de ajuda, às vezes finge de morto |
| Camper | 0,3 | 0,7 | 0,95 | 40 m | escolhe um ponto com visão e espera; muda após 2 kills ou quando é descoberto |
| Estrategista | 0,5 | 0,6 | 0,7 | 25 m | prioriza o objetivo, espera o time, flanqueia (precisa de N2+) |
| Kamikaze | 1,0 | 0,0 | 0,0 | 0 m | menor caminho até você; com explosivo, se explode |
| Caçador | 0,8 | 0,3 | 0,4 | 15 m | escolhe 1 alvo (padrão: o humano com mais kills) e persegue pelo mapa |
| Suporte | 0,4 | 0,6 | 0,6 | 15 m | segue o humano aliado, cobre, revive, divide munição |
| Palhaço | 0,5 | 0,3 | 0,3 | 15 m | dancinha depois da kill, pulinhos; no resto joga normal |

### 6.5 Regras e vantagens (por bot ou por time)
| Regra | Faixa |
|---|---|
| HP | 1–1000 |
| Colete | 0–200 |
| Multiplicador de dano | 0,25x–5x |
| Velocidade | 0,5x–2x |
| Tamanho | 0,5x–3x (a hitbox acompanha; a navegação respeita a altura livre, 3.6) |
| Regeneração | off / lenta / padrão / rápida |
| Munição | normal / reserva infinita / pente infinito |
| Armas | lista permitida / arma fixa / aleatória |
| Visão | cone 60–360°; alcance de 10 m até o alcance da partida (passar dele é vantagem explícita, "Olho de águia") |
| Audição | 0x–2x |
| Conhecimento | normal / área aproximada (raio de 15 m, atualizada a cada 10 s) / wallhack total |
| Vidas | infinitas / N / 1 |
| Imune a headshot | sim/não |
| Explode ao morrer | sim/não |
| Chefão | barra de vida no topo, nome em destaque |

**Toda regra ativa aparece no card do bot**, no placar e na tela de morte. É o pilar 4: nada escondido.

### 6.6 Dificuldade rápida: 5 níveis [DECIDIDO #21]
É para quem não quer abrir o Laboratório. Cada nível preenche os 4 eixos; o detalhe fica no Laboratório. Os nomes são da interface em pt-BR.

| Nível | Reação | Erro mín. | Aquisição | Giro | Recoil | Cabeça | Inteligência | Movimento em combate |
|---|---|---|---|---|---|---|---|---|
| Pela vibe | 900 ms | 6° | 1,2 s | 150°/s | 10% | 5% | N0 | parado |
| De boa | 650 ms | 3,5° | 0,9 s | 220°/s | 30% | 10% | N1 | parado ou strafe leve |
| Normal | 450 ms | 2° | 0,6 s | 320°/s | 50% | 20% | N2 | strafe |
| Suado | 300 ms | 1° | 0,35 s | 500°/s | 75% | 40% | N3 | strafe + pulo/agacha |
| Tryhard | 180 ms | 0,4° | 0,2 s | 800°/s | 95% | 65% | N4 | strafe + pulo/agacha |

- **Nenhum nível tem vantagem de regra** (HP, wallhack). Quem quer mais que o Tryhard abre o Laboratório.
- A personalidade padrão dos níveis é uma **mistura**: 50% Equilibrado, 20% Rusher, 15% Camper, 15% Estrategista. Pode ser trocada.
- **Primeira partida em De boa**, em todas as plataformas [PADRÃO].
- Os botões "Mais fácil" e "Mais difícil" do resultado andam 1 nível. No Tryhard, "Mais difícil" vira "Abrir Laboratório"; no Pela vibe, "Mais fácil" oferece a regra "alvos maiores" e +1 aliado.

### 6.7 Oficina de Bots e Laboratório
- **Laboratório (M2)** [DECIDIDO #29]: os 5 níveis + sliders dos 4 eixos + salvar. Edita um bot por vez.
- **Oficina (M2, local):** a biblioteca de bots salvos (listar, duplicar, apagar, favoritar). Códigos e links de compartilhar chegam no M6+.
- **Bots de fábrica** (nomes em inglês bobo [DECIDIDO #15]; os nomes são [PADRÃO]):

  | Bot | Como é |
  |---|---|
  | Vibe Bob, Chill Bob, Normal Bob, Sweaty Bob, Tryhard Bob | os 5 níveis rápidos, prontos para usar e editar |
  | Jorge the Immortal | 500 HP, Door Knocker, Kamikaze, N0, erro alto |
  | Camper Carl | Peekaboo, Camper, N2 |
  | Knife Ninja | só faca, velocidade 1,4x, Rusher |
  | Scaredy Sam | Covarde, N2 |
  | Hunter Hank | Caçador (persegue o humano com mais kills), N3 |
  | Buddy | Suporte: segue, cobre e revive |
  | Goofy Gus | Palhaço |

- **Seus bots:** sem limite prático na web (teto técnico de 500); 100 no Switch.
- **Criar:**
  - Partir de um bot da biblioteca e ajustar os eixos.
  - Nome: botão "rolar nome" (gerador de nomes bobos em inglês, ex.: "Private Pickles", "Sergeant Noodle") ou digitação (seção 10.8).
  - Visual: o mesmo sistema do bobo do jogador (chapéu, cabelo, cor, rosto, padrão) e arma favorita.
- **Testar:** abre o Bobo Training (1v1 ou 1vN) em até 2 s. Ao voltar, mostra precisão do bot, seu K/D e TTK médio.
- **Salvar o nêmesis** direto da tela de resultado (M2).
- **Esquadrões (M6+):** grupo nomeado de bots (ex.: "The Jorges", 6 bots), reaproveitável em presets. É a base do Bobo War Sim.
- **Compartilhar (M6+, "Oficina com códigos"):**
  - Código de texto `BF1-...`: JSON compactado (deflate) em base64url, uns 300–500 caracteres. Link `#bot=...` [PADRÃO].
  - No M2, bots e presets já saem no "Exportar backup" em arquivo; no M4, o Switch importa e exporta JSON na pasta do save no SD [PADRÃO].
  - Todo import valida, limita valores (clamp) aos tetos da plataforma e migra versões antigas (10.8).
- **Formato** [PADRÃO]: chaves em inglês e textos em pt-BR; campo `format: "boboforces/<tipo>@<n>"`; versionado, com migração. Campos desconhecidos são ignorados, versão maior é recusada com mensagem, conteúdo ausente cai em fallback, IDs de conteúdo nunca mudam.
- **`look` único** para bots e para o perfil do jogador (o mesmo do `tecnico.md` 14.2): `{ skin, skinTone, face, hair, hairColor, hat, hat3d, outfit, pattern, colors[2], back }`. `skin` é a skin pronta (atalho), `hat` o chapéu de camada externa, `hat3d` o acessório 3D de cabeça, `back` o acessório de costas; `null` = nenhum.

```json
{
  "format": "boboforces/bot@1",
  "id": "b7f3c2",
  "name": "Jorge the Immortal",
  "look": { "skin": null, "skinTone": "tan", "face": "grin", "hair": "none", "hairColor": "#3b2a1a", "hat": "bucket", "hat3d": null,
            "outfit": "fatigues", "pattern": "plain", "colors": ["#ff5d3a", "#5a6b3c"], "back": null },
  "skill": { "reactionMs": 700, "aimErrorDeg": 5, "acquireS": 1.0, "turnDegS": 200, "recoilControl": 0.2, "headPref": 0.05, "grenadeUse": 0, "combatMove": "none" },
  "intelligence": { "level": 0, "useCover": false, "flank": false, "retreat": false, "grenades": false, "callouts": false, "ambush": false, "learn": false, "playObjective": true },
  "personality": { "preset": "kamikaze", "aggression": 1.0, "caution": 0.0, "patience": 0.0, "preferredRangeM": 3, "silliness": 0.4 },
  "rules": { "hp": 500, "speed": 0.9, "size": 1.0, "ammo": "infinite", "weapons": ["shotgun"], "headshotImmune": false }
}
```

### 6.8 Diretor de Partida (M6+)
Inspirado no "AI Director" do Left 4 Dead. **Desligado por padrão e sempre visível no placar quando ligado** [PADRÃO].

- **Objetivos e alvos de K/D:**

  | Objetivo | K/D alvo dos humanos |
  |---|---|
  | Relax | 2–3 |
  | Equilibrado | 1–1,5 |
  | Desafio | 0,7–1 |

  Também há o modo **Personalizado**, com os sliders da proposta original: precisão, inteligência tática, agressividade, quantidade de bots de 2 a 40 (respeitando os tetos da plataforma) e a faixa de ajuste.
- **O que mede** [PADRÃO]: janela móvel de 3 min, amostrada a cada 10 s: K/D dos humanos, tempo médio de vida, dano tomado por encontro e sequências.
- **O que ajusta (só bots, nunca humanos):**
  - Erro e reação.
  - Agressividade.
  - Número de bots ativos e ritmo de spawn.
  - Distância de spawn.
  - No Bobo Zombies: ritmo da horda, especiais e drops.
- **Limites:**
  - 1 ajuste a cada 30 s, de no máximo 1/4 de nível (os parâmetros são interpolados entre os níveis da 6.6).
  - Faixa de ±1 nível em volta do nível escolhido.
  - Nunca mexe em inteligência, personalidade ou regras que o jogador definiu.
  - Nunca dá wallhack.
- **Coop e local:** usa a média do grupo.
- **Online PvP:** só afeta bots.
- **Transparência:** um ícone no placar mostra o ajuste atual, por exemplo "Diretor: bots −½".

### 6.9 Aquário: assistir só IAs e entrar no meio (M6+)
- Qualquer modo pode começar com 0 humanos.
- **Câmeras:** livre (voo), seguir bot (3ª pessoa), olhos do bot (1ª pessoa), visão tática de cima.
- **Velocidade** [PADRÃO]: 0,25x até 4x no PC, até 2x no celular e no Switch. Só offline; no online fica 1x.
- **Overlay de IA (opcional):**
  - Intenção atual num ícone ("flanqueando", "com medo"), linha de visão e rota. Ícones, não falas.
  - A câmera livre e o overlay existem desde o M1 como ferramenta de debug (F2, convenção EriLab); o Aquário é a versão para o jogador.
- **Entrar:**
  - **Assumir bot:** pega posição, HP e arma dele. O bot volta quando você sai.
  - **Entrar no time X:** cria uma vaga nova.
  - No local, cada controle assume um bot diferente.
- Replays ficam só como ferramenta de debug (F2) [PADRÃO].

### 6.10 Ordens para bots aliados (M6+)
- **Roda com 4 ordens:** Vem comigo, Segura aqui, Ataca ali (ping) e Me cobre / Me revive.
- Bots N0 e N1 ignoram. Bots N2 ou mais obedecem, de acordo com a lealdade.
- O ping também aparece para os humanos do time.

### 6.11 Tetos de bots por plataforma [PADRÃO]
Valores iniciais por perfil, lidos de configuração. Começam conservadores e **sobem com as medições** do Teste Zero (M1) e dos marcos seguintes.

| Perfil | Bots armados | Zumbis simultâneos |
|---|---|---|
| Web PC | 40 | 60 |
| Web PC em tela dividida 3–4P | 24 | 40 |
| Web celular | 12 | 24 |
| Host online no celular | 8 | 16 |
| Switch, 1 jogador | 24 | 30 |
| Switch, 2 jogadores | 16 | 24 |
| Switch, 3–4 jogadores | 12 | 24 |
| Capacidade do motor | 64 | 64 |

- Bobo Royale Mini: 24 participantes [DECIDIDO #35] (ver Pendências para celular e Switch 2P+).
- **LOD de IA:** bots longe de todos os humanos decidem com frequência menor.
- **Zumbi é mais barato que soldado:** é N0, segue um flow field compartilhado e não usa cobertura. Por isso o Bobo Zombies é o modo-chave do sofá e do Switch.

### 6.12 Equidade
- Sem uma Regra que diga o contrário, o bot não vê através de parede e não sabe onde você está sem ver ou ouvir.
- Alcance de visão é o mesmo para humanos e bots.
- Em times mistos, o placar marca quem é bot.
- No online, os bots rodam só no host.

### 6.13 Balanceamento
É um robô de balanceamento no estilo do `scripts/balance.mjs` do gamebobo: duelos bot contra bot na sim headless (M0), sem tela e com seed fixa. Ele calibra:
- **TTK** de cada par de armas e os **multiplicadores de headshot**.
- **Níveis:** o "Normal" deve vencer uns 50% contra o bot "Humano de referência"; um jogador médio deve ter K/D entre 1,5 e 2 contra "De boa".
- **Mapas:** mapa de calor de mortes, tempo até o contato e vantagem de spawn.

---

## 7. Modos

### 7.1 Modo é dado, não código novo
**Modo = Objetivo + Times + Spawns + Economia + Loadout + Regras padrão + Requisitos de mapa + Suporte de IA.**

Variantes e modos de festa (Bobo Paintball, Bobo Chaos, Bobo Juggernaut, Surpreenda-me, Gun Game) são presets montados sobre esses blocos. Ficam baratos depois que o Bobo Warfare existe.

**Nomes** [DECIDIDO #15]: Bobo Warfare (TDM, FFA, Domination), BoboStrike, Bobo Royale, Bobo Paintball, Bobo Zombies, Bobo Sandbox, Bobo Juggernaut, Bobo Chaos, Bobo Training. Na interface em pt-BR: Surpreenda-me, Partida Rápida, Laboratório, Aquário.

**Escala de complexidade:**

| Nível | Significa |
|---|---|
| P | só regras e dados sobre sistemas que já existem |
| M | 1 sistema novo |
| G | vários sistemas + IA de objetivo nova |
| GG | mapa ou tecnologia nova + vários sistemas |

### 7.2 Marcos [DECIDIDO #23, #27, #28]
| Marco | Nome | Gameplay incluído |
|---|---|---|
| M0 | Fundação | monorepo, sim headless a 60 Hz com seed, input abstrato (ações por jogador), render base, UI WebGL base, deploy. Colisão AABB + DDA, perfil Bobo, robô de balanceamento rodando duelos de fuzil |
| M1 | Cena-vitrine + Teste Zero (mesma cena) | o Construto com bobos e bots: prints do visual blocado pixel-art para o Erick aprovar densidade de textura e peças fora da grade; a mesma cena no Switch real com 4 telas e bots burros (N0) medindo FPS e memória. Gameplay mínimo para a cena andar: perfil Bobo, fuzil hitscan, respawn, morte em cubinhos, métricas do bobo (3.1) testadas em portas e coberturas |
| M2 | MVP web solo | Bobo Warfare TDM e FFA, Bobo Training, Surpreenda-me simples, Laboratório com núcleo forte, Construto + 1 arena pequena, 8 armas. Também: JOGAR, Partida Rápida, presets locais, Mais fácil/Mais difícil, regras básicas, perfis Bobo, Tático e Personalizado, 1ª e 3ª pessoa, onboarding (2.5), anti-frustração (11), PC e celular |
| M3 | Sofá | tela dividida local na web com controles (até 4; teclado e mouse = 1 slot), lobby "aperte A", entrar no meio; Bobo Zombies estilo CoD + mapa de Zombies; caído e reviver; bots Suporte |
| M4 | Port do Switch | nx.js, 100% offline, uso pessoal: LOCAL EDITION com tudo que existe até o M3 (seção 12); bots e presets por arquivo no SD |
| M5 | Online P2P | até 4 humanos, host autoritativo, só por código ou link: TDM, FFA, X1, Surpreenda-me e Bobo Zombies coop; bot assume quem sai; controles do host (10.7) |
| M6+ | Modos de festa e conteúdo | BoboStrike, Bobo Paintball, Domination, Bobo Juggernaut, Bobo Sandbox completo, Oficina com códigos, Diretor de Partida, Aquário, Bobo Chaos, Bobo Royale Mini (24), mais mapas e armas. Também: Gun Game e Infection (presets), variantes do Zombies, perfil Arcade, ordens aos bots, esquadrões, Nêmesis com memória |

### 7.3 Matriz de disponibilidade
Cada célula diz **em que marco** a combinação passa a existir. "Local web" é tela dividida no PC com controles [DECIDIDO #24]. M0 e M1 não têm modo para o jogador: só a cena do Construto com bots, para o Teste Zero. No Switch, cada modo M6+ entra quando couber no orçamento (regra de ouro, item 4).

| Modo | Solo web | Local web (2–4) | Online P2P (até 4) | Switch solo | Switch local (2–4) | Complex. |
|---|---|---|---|---|---|---|
| Bobo Warfare TDM | M2 | M3 | M5 | M4 | M4 | P |
| Bobo Warfare FFA (inclui X1) | M2 | M3 | M5 | M4 | M4 | P |
| Bobo Training (treino e Testar bot) | M2 | não | não | M4 | não | P |
| Surpreenda-me | M2 (simples) | M3 | M5 (host sorteia) | M4 | M4 | P |
| Bobo Zombies (clássico) | M3 | M3 | M5 (coop) | M4 | M4 (modo principal) | G |
| Bobo Warfare Domination | M6+ | M6+ | M6+ | M6+ | M6+ | M |
| Bobo Juggernaut | M6+ | M6+ | M6+ | M6+ | M6+ | P |
| BoboStrike | M6+ | M6+ | M6+ | M6+ | M6+ | G |
| Bobo Paintball | M6+ | M6+ | M6+ | M6+ | M6+ | M |
| Bobo Chaos (Roleta) | M6+ | M6+ | M6+ | M6+ | M6+ | P |
| Gun Game (preset) | M6+ | M6+ | M6+ | M6+ | M6+ | P |
| Infection (preset) | M6+ | M6+ | M6+ | M6+ | M6+ | P |
| Bobo Zombies: Armed Horde | M6+ | M6+ | M6+ | M6+ | M6+ | P |
| Bobo Zombies: Fortress | M6+ | M6+ | M6+ | M6+ | M6+ | M |
| Bobo Sandbox completo | M6+ | M6+ | M6+ (só o host usa as ferramentas) | M6+ | M6+ | M |
| Aquário (espectador) | M6+ | M6+ | M6+ (espectador, 1x) | M6+ | M6+ | M |
| Bobo Royale Mini (24) | M6+ | M6+ (até 2, a validar) | M6+ | M6+ (a validar) | a validar | GG |
| Bobo Royale Grande | depois do Mini, só PC | não | só com host PC | não | não | GG |
| Bobo War Sim (backlog) | M6+ | M6+ | só assistir | a validar | a validar | G |

### 7.4 Regras por modo

#### Bobo Warfare TDM (M2)
- **Regras:** 2 times. Vence quem chegar a 75 kills, ou quem tiver mais kills ao fim de 10 min. Empate leva a morte súbita.
- **Tamanho:** padrão 6v6 no PC, 4v4 no celular. Vai de 1v1 a 20v20, dentro do teto da plataforma.
- **Humanos:**
  - Solo: 1.
  - Local: até 4. No mesmo time é coop contra bots; em times opostos é versus.
  - Online: até 4 [DECIDIDO #25].
  - Bots completam os times.
- **IA:** qualquer nível serve.
- **Presets prontos:**
  - "4 vs 40": coop online contra 40 bots, só com host no PC (a tela dividida 3–4P no PC tem teto de 24, 6.11).
  - "2v2 + bots": 2 humanos e 8 bots por time.
- **Switch:** padrão local de 4 humanos contra 12 bots.

#### Bobo Warfare FFA (M2)
- **Regras:** todos contra todos, 8 participantes. Vence quem chegar a 30 kills ou quem tiver mais ao fim de 8 min. Spawn pontuado (5.3).
- **Preset "X1 Sniper":** 2 humanos, só Peekaboo, arena pequena, 15 kills.
- **Preset "X1 livre":** igual, com todas as armas.

#### Bobo Training (M2)
- Arena pequena com alvos fixos e móveis (alvos são bonecos de caixas com skin de treino).
- Bots do Laboratório aparecem em loop (de 1 a N). É onde o **Testar** do Laboratório cai.
- Mostra precisão, TTK médio e % de cabeça. Sem placar.
- Tem a estação "Calibrar mira" (a mesma da 2.5).

#### Surpreenda-me (M2 simples, cresce depois)
- **O que sorteia:**
  - Um modo compatível com a plataforma e o número de humanos (no M2: TDM ou FFA).
  - Um mapa compatível com o modo.
  - Armas: livre, fixa ou aleatória.
  - 0 a 1 modificador no M2 (até 3 depois).
  - Inimigos: um nível rápido mais 0 a 2 bots "estrela" com personalidade forte.
- **Card:** 1 linha por item, com "Rolar de novo" (infinito) e **Jogar**. Cadeado por linha (travar e sortear só o resto) no M6+.
- **Seed:** compartilhável como código no M6+. No local, o P1 sorteia; no online, o host.
- **Cresce sozinho:** cada modo novo entra no sorteio quando for lançado.

#### Bobo Zombies (M3) [DECIDIDO #30, #31]
Estilo CoD Zombies, com **bobos-zumbi cartoon**: mesmo estilo dos bobos, curvados, esverdeados, engraçados.
- **Pontos:**
  - Acerto: 10. Kill: 60. Kill na cabeça: 100. Kill de faca: 130.
  - Consertar uma tábua: 10, até 50 por onda.
- **Compras:**
  - Armas na parede: 500–1500.
  - Portas e escombros: 750–1250. Abrem áreas novas.
  - **Caixa Misteriosa:** 950, arma aleatória, que pode incluir a arma maravilha. Muda de lugar entre 3 posições.
  - **Vantagens** (vida 150, recarga rápida, reviver rápido): 1500–3000. Nomes provisórios em inglês bobo: Chonky Cola, Speedy Soda, Buddy Brew [PADRÃO].
- **Ondas:**
  - Total de zumbis = (6 + 4 × onda) × (1 + 0,5 × (humanos − 1)).
  - Simultâneos: limitados pelo teto da plataforma (6.11).
  - HP do zumbi: 100 na onda 1, +60 por onda até a 10, depois ×1,1 por onda.
  - Velocidade: andando até a onda 4, misto da 5 à 9, correndo da 10 em diante.
- **Especiais** (nomes [PADRÃO]):
  - Sprinter: rápido, pouco HP.
  - Chonker: explode em gosma verde de cubinhos ao morrer, 40 de dano em 3 m.
  - Spitter: projétil lento.
  - **Chefão** a cada 5 ondas: Mega Bobo, um bobo-zumbi gigante com 3000 × humanos de HP, que arranca barricadas inteiras.
- **Barricadas:** janelas com 6 tábuas. O zumbi arranca 1 tábua a cada 1,5 s. Segurar o botão repõe. Tábuas e portas pagas são **entidades com estado**, não cenário (8.7).
- **Drops:** chance de 2% por kill, no máximo 4 por onda.
  - Munição cheia.
  - Bomba (mata todos na área).
  - Pontos em dobro por 30 s.
  - Insta-kill por 30 s.
  - Carpinteiro (repõe todas as tábuas).
- **Duração:**
  - **Relâmpago:** 5 ondas.
  - **Curta** (padrão): 10 ondas, uns 12–15 min, terminando em fuga ou vitória.
  - **Infinita.**
- **Humanos e aliados:** 1–4. Bots Suporte opcionais completam até 4.
- **Configuração:**
  - Quantidade 0,5x–3x, velocidade, multiplicador de HP.
  - Especiais on/off, chefões on/off.
  - Multiplicador da economia e "levanta sozinho" no solo.
- **Último zumbi:** corre até os jogadores e ganha marcador (11).
- **Variantes (M6+):**
  - **Armed Horde:** ondas de bots soldados, reaproveita a IA do Bobo Warfare.
  - **Fortress:** defender um gerador ou base com HP enquanto os inimigos tentam destruí-lo (o gerador é entidade; o cenário segue estático).
- **Switch:** é o modo principal da LOCAL EDITION.
- **Recordes:** onda máxima por mapa e configuração (seção 9).

#### Bobo Warfare Domination (M6+)
- **Regras:** 3 pontos (A, B, C).
  - Captura em 5 s com 1 jogador, até 2,5 s com 3 ou mais.
  - Cada ponto controlado rende 1 ponto por segundo.
  - Vence quem chegar a 200, ou ao fim de 10 min.
- **IA:** escolher ponto conforme a personalidade (Estrategista vai no menos defendido, Camper segura o ponto).
  - N2: ataca o ponto.
  - N3: divide o time entre os pontos.
- **Mapa:** o Construto já vem com os 3 pontos marcados desde o M2.

#### BoboStrike (bomba, estilo CS) (M6+)
- **Times:** Atacantes e Defensores, só com cor e ícone de time (8.9). A "bomba" é a **Boom Box**, um explosivo de brinquedo [PADRÃO].
- **Regras:**
  - 5v5, rounds de 1:45 (o tempo acabou, os defensores vencem).
  - Boom Box: 40 s depois de plantada. Desarme em 7 s (5 s com kit).
  - 15 s de compra no começo de cada round.
  - **MR12:** troca de lado no round 6, vence quem fizer 7.
  - Sem respawn no round. Quem morre assiste ou assume um bot aliado vivo (configurável).
- **Economia simplificada** [PADRÃO]: faixas fixas de dinheiro.
  - Vitória: 3000. Derrota: 1900, +500 por derrota seguida, até 3400. Kill: 300. Plantar: 300.
  - Preços: pistola grátis; SMG e escopeta 1200; fuzil 2700; sniper 4500; colete 650 (50) ou 1000 (100); granada 300; kit de desarme 400.
- **IA (G):**
  - Atacantes: escolher site, plantar e defender a Boom Box.
  - Defensores: rotacionar e retomar.
  - Todos: economizar quando o round está perdido.
  - Anti-travamento: com 30 s restantes, os atacantes vão direto ao site mais próximo (11).
- **Mapa:** 2 sites e 3 rotas.

#### Bobo Royale (M6+) [DECIDIDO #35]
- **Mini (primeiro):** 24 participantes, mapa de ~200 × 200 m (~400 blocos de lado), 8–10 min, em todas as plataformas.
- **Grande (depois, só PC):** participantes e tamanho definidos por medição (alvo inicial: 48 em ~400 m). Só entra se o teto do PC subir.
- **Loot no chão:** armas em 3 raridades que melhoram recoil e pente, **sem aumentar dano**; coletes 50/100; kits.
- **Zona:** 5 fases, dano de 2 / 5 / 10 / 20 / 40 HP/s.
- **Formatos:** solo, duplas e quartetos. Em grupo dá para reviver.
- **IA:** lootear, ir para a zona, se curar e terceirizar luta alheia (3rd party).
- **Online:** até 4 humanos, mais bots.

#### Bobo Paintball (M6+)
- **Regras:**
  - Times. 1 tiro mata (configurável de 1 a 3).
  - Respawn de 1 s.
  - Vence quem chegar a 50 kills, ou ao fim de 5 min.
- **Armas:** marcadores de tinta, com projétil visível a 60 m/s e gravidade leve.
- **Visual:** sem sangue; a tinta mancha jogadores e cenário em **decal, com teto** de manchas [PADRÃO]. O cenário não muda.
- **Público:** é o modo mais "pra todo mundo".

#### Bobo Sandbox completo (M6+)
- **Base:** no M2, a "Partida personalizada" (aba Avançado, 10.1) já cobre 2 times com regras próprias.
- **Completo:**
  - Até 4 times, cada um com nome, cor, número de bots, nível ou bots específicos, armas e HP.
  - Objetivo: eliminação, pontos ou nenhum ("brinquedo").
  - Jogar ou só assistir. Salvar como Cenário, que é um preset.
  - **Ferramentas do Dono** (estilo gmod): criar um bot onde você está mirando; congelar a IA; trocar o time de um bot; dar uma arma a ele; mudar regra ao vivo; câmera lenta (só offline).
  - No online, só o host usa as ferramentas.

#### Bobo Juggernaut (M6+)
- **O Juggernaut:**
  - HP = 300 × oponentes, mínimo de 1000.
  - Headshot sem multiplicador.
  - Minigun "Big Brrt": dano 15, 1200 tiros/min, pente infinito, superaquece após 6 s de fogo contínuo.
  - Velocidade 0,75x. Aparece sempre no radar.
- **Variante Fixo:**
  - Rodadas de 3 min. O Jugg vence se sobreviver ou fizer X kills.
  - Rodízio entre rodadas para todo mundo ser o Jugg uma vez.
  - É o "1 vs 3" do sofá.
- **Variante Rodízio:** quem dá o golpe final vira o Jugg. Pontos por segundo como Jugg; vence quem chegar a 150.
- **IA do bot Juggernaut:** Rusher e Caçador.

#### Bobo Chaos (M6+)
Todo modificador também pode ser ligado em qualquer outro modo. O Bobo Chaos é um preset com 3 modificadores, e a **Roleta** troca 1 deles a cada 60 s, com aviso 5 s antes.

**Modificadores:**
- Gravidade: lunar (0,35x) ou pesada (1,8x).
- Cabeção: cabeça e hitbox da cabeça 2x maiores.
- Mini: todos com 0,5x de tamanho.
- Tudo explode.
- Troca de arma por kill.
- Só headshot. Um tiro mata. Munição infinita sem recarga.
- Velocidade 1,5x.
- Arcade: bhop, wall jump e pulo duplo.
- Vampiro: dano causado cura.
- Ricochete: a bala ricocheteia 1 vez.
- Invisíveis, exceto quando atiram.
- Bots gigantes (3x; a navegação respeita a altura livre).
- Festa: confete em tudo.

**Combinações proibidas:** o sorteio evita pares que quebram a partida, como "invisíveis" com "um tiro mata" no FFA.

#### Gun Game (preset, M6+)
- Uma sequência de armas; a última é a faca.
- Morrer pela faca rebaixa 1 nível.
- Com o arsenal do M2 é uma "escada curta" de 7 níveis.

#### Infection (preset, M6+)
- 1 infectado no começo. Quem morre vira infectado (bobo-zumbi).
- Os sobreviventes vencem se aguentarem 3 min.
- Reaproveita a IA de zumbi.

#### Bobo War Sim (backlog M6+, sem compromisso; nome provisório [PADRÃO])
- 2 a 6 facções de bots (esquadrões da Oficina), cada uma com uma "doutrina" (personalidade média) e só cor e ícone como identidade.
- Disputam território num mapa grande. Você assiste ou entra.

### 7.5 Regra de ouro
> **Todo modo é jogável sozinho com bots, roda em tela dividida local e vai para o online quando faz sentido.**

Nenhum modo é lançado sem passar neste checklist:
1. Funciona com 1 humano. **Os bots jogam o objetivo**, não só matam: plantam, capturam, revivem, consertam barricada.
2. Declara `maxLocal` (até 4), e o HUD do modo cabe numa vista de 640×360.
3. Declara `p2p: sim / não / máx. N` (N ≤ 4). Se sim, o estado do objetivo é replicável e os bots rodam no host.
4. Declara limites por plataforma e cabe no orçamento do Switch (720p, 30 FPS com 4 jogadores), ou fica marcado como `switch: não` (justificado).
5. Humano que sai é substituído por um bot. Humano que entra assume um bot.
6. Tem um preset padrão jogável em até 3 interações.
7. Tem saída para os travamentos da seção 11 (objetivo que não anda, último inimigo escondido).

---

## 8. Mapas

### 8.1 Grade e peças [DECIDIDO #5, #6, #7]
- **Grade de construção de 0,5 m.** Colisão (AABB + DDA) e navegação (grade 2,5D) usam a mesma grade [PADRÃO].
- **Peças fora da grade** (rampas, cilindros, cercas, vegetação em cruz, props low-poly com textura pixel-art) são liberadas quando forem mais leves ou mais bonitas. Para o gameplay, cada peça declara:

  | Propriedade | Valores |
  |---|---|
  | Colisão de movimento | caixa / rampa / nenhuma |
  | Bloqueia bala | sim / não |
  | Bloqueia visão de bot | sim / parcial (reduz detecção) / não |
  | Andável | sim (rampas até 45°) / não |

  A navegação marca as células que a peça ocupa, e a colisão usa caixas e rampas simples, nunca a malha.
- **Materiais de referência:**

  | Material | Movimento | Bala | Visão de bot |
  |---|---|---|---|
  | Bloco sólido | bloqueia | bloqueia | bloqueia |
  | Cerca de arame (cutout) | bloqueia | passa | passa |
  | Cerca de madeira fechada | bloqueia | bloqueia | bloqueia |
  | Vegetação baixa (até 0,5 m) | passa | passa | passa |
  | Vegetação alta (cruz) | passa | passa | parcial |
  | Escada de mão | escalável a 3 m/s | passa | passa |

- **Sem penetração de bala** no M2: o que bloqueia, bloqueia. Mapas do M2 não usam vidro. A bancada de materiais da cena-vitrine (vidro e água rasa, só para prints e medição) fica fora da área jogável do Construto (`arte-ux.md` 5.2).
- **Render das peças** (frente técnica): formas do catálogo (rampas, lajes, cercas, cruz) vão na malha do chunk; cilindros, barris e demais props vão instanciados. A colisão de todas é caixa, rampa ou nenhuma; cilindro vira caixa envolvente.
- **Legibilidade:** material que não bloqueia bala tem visual claramente vazado (cutout ou cruz).

### 8.2 Classes de tamanho
| Classe | Área jogável | Em blocos | Participantes ideais | Uso |
|---|---|---|---|---|
| Arena pequena | 30×30 a 40×40 m | 60–80 | 2–6 | X1, 2v2, Bobo Training, Juggernaut 1v3 |
| Média | 60×60 a 90×90 m | 120–180 | 8–16 | TDM, FFA, Domination, Paintball, BoboStrike |
| Grande | 100×100 a 160×160 m | 200–320 | 16–40 | Bobo Zombies (áreas que abrem), TDM grande, Fortress |
| Royale Mini | ~200×200 m | ~400 | 24 | Bobo Royale Mini |
| Royale Grande | a medir (só PC) | — | alvo 48 | Bobo Royale Grande |

Altura típica: até 3 níveis (chão, 1º andar, telhado), andares de 3 m, altura total de 10 a 16 m.

### 8.3 Regras de layout (mapas médios)
- 3 rotas principais (esquerda, meio, direita).
- Cobertura a cada 8–12 m de caminho, misturando baixa (1,0 m) e alta (≥ 1,75 m).
- **Linhas de visão e alcance de visão** [PADRÃO]:
  - O alcance de visão é **regra da partida**, igual para humanos e bots. O perfil da plataforma só define o teto:

    | Perfil | Teto de visão |
    |---|---|
    | PC | 140 m |
    | Celular | 90 m |
    | Switch 1P | 90 m |
    | Switch 2P | 70 m |
    | Switch 3–4P | 50 m |

  - Padrão da partida: o menor entre o teto do perfil e a maior linha de visão do mapa. No online, vale o menor teto entre os participantes.
  - **Todo mapa declara sua maior linha de visão.** Mapas que rodam no Switch 3–4P (todos os do M2 e M3) mantêm a maior linha de visão em até 50 m; mapas só de PC podem ir até 140 m.
  - No máximo 1 ou 2 corredores longos por mapa, para a sniper existir sem dominar.
- Spawns:
  - TDM: pelo menos 6 por time.
  - FFA: pelo menos 16 espalhados.
  - Nenhum spawn visível de um spawn inimigo.
- Travessia de um spawn ao outro: 12–18 s correndo.
- Toda área tem escada ou rampa. Mantle só cria atalho, nunca é o único caminho (3.6).
- Limite do mundo: parede invisível marcada com faixa listrada; plano de morte abaixo do mapa (11).

### 8.4 Anotações de jogo no arquivo do mapa
- Spawns por time e de FFA.
- Objetivos: pontos de Domination, sites, zona do Royale, janelas, portas pagas, armas na parede e posições da Caixa Misteriosa.
- Nós de IA: cobertura alta e baixa, pontos de sniper, emboscadas, pontos de patrulha.
- Navegação pré-calculada, com altura livre por célula e ligações liga/desliga (portas pagas).
- Pickups, plano de morte, limites e câmeras do Aquário.
- Declarações: `modes`, `players { min, ideal, max }`, maior linha de visão (m) e um teto de bots por plataforma.

### 8.5 Mapas e temas
Todos genéricos, sem nacionalidade e dentro da diretriz de conteúdo (8.9) [DECIDIDO #19].

| Mapa | Classe | Modos naturais | Marco |
|---|---|---|---|
| **Construto**: sala de teste gigante (homenagem ao gmod, sem copiar o mapa), piso de blocos quadriculados, prédios de teste, rampas, cercas, caixotes | média | TDM, FFA (pontos de Domination já marcados), cena-vitrine, Teste Zero | M1 / M2 [DECIDIDO #20] |
| **Ringue** (nome provisório): arena pequena de treino com alvos e estandes | pequena | X1, Bobo Training, Testar | M2 [PADRÃO] |
| **Base Abandonada** (noite): base militar cartunesca com janelas para barricar e áreas que abrem por portas pagas | grande | Bobo Zombies | M3 [PADRÃO] |
| Base Bobo: base militar cartunesca diurna, 2 sites | média | BoboStrike, TDM | M6+ |
| Porto de Contêineres: verticalidade e corredores | média | TDM, FFA, Domination | M6+ |
| Galpão de Paintball: interior colorido com infláveis | média | Bobo Paintball | M6+ |
| Canteiro de Obras: andaimes e verticalidade | média | TDM, FFA | M6+ |
| Estação Lunar: gravidade baixa de série | média | Bobo Chaos | M6+ |
| Fazenda à noite | grande | Bobo Zombies, Fortress | M6+ |
| Ilha Tropical | Royale Mini | Bobo Royale Mini | M6+ |

### 8.6 Quantidade por marco
| Marco | Mapas |
|---|---|
| M1 | Construto (cena-vitrine e Teste Zero na mesma cena) |
| M2 | Construto + Ringue |
| M3 | + Base Abandonada (Zombies) |
| M4 | os 3 no Switch |
| M5 | nenhum novo obrigatório |
| M6+ | um mapa por modo novo (BoboStrike com 2 sites, Paintball, Royale Mini) + extras |

### 8.7 Cenário estático [DECIDIDO #4]
- **Nada do cenário é destruído.** Mapa, colisão e navegação nunca mudam por tiro ou explosão.
- Tiros e explosões soltam **cubinhos cosméticos** com a cor e a textura do bloco atingido, e deixam marcas temporárias (decal) com teto de quantidade.
- **Exceções controladas, que são entidades e não cenário:** tábuas das barricadas e portas pagas do Bobo Zombies, gerador do Fortress. A navegação as trata como ligações liga/desliga.
- Ganhos: navegação pré-calculada, sincronização online trivial, orçamento do Switch previsível.

### 8.8 Editor interno [DECIDIDO #13, #36]
- **Só ferramenta interna, nunca para jogadores.** O Claude gera blocos, texturas e peças por script. Cada mapa é um **script TS** com uma API de construção (`box`, `ramp`, `fence`, `prop`, `spawn`, `door`…), compilado pelo `mapc` (`tecnico.md` 15.1). O editor no navegador (`mapview`) só ajusta marcadores, nós de IA e câmeras.
- Formato próprio em RLE + deflate [PADRÃO].
- O Erick aprova por prints.
- **Online:** todos jogam com os mapas do próprio build. Versão diferente entre host e convidado pede para recarregar (frente técnica).

### 8.9 Diretriz de conteúdo sensível [PADRÃO, com #9, #10, #19, #31, #34]
Vale para mapas, armas, nomes, textos e skins.

| Tema | Regra |
|---|---|
| Lugares | nada de lugares reais, escolas, hospitais, templos ou prédios de governo reais; cenários genéricos (bases, galpões, portos, canteiros, ilhas, estações) |
| Símbolos | nada de bandeiras, exércitos, uniformes ou insígnias reais, nem símbolos políticos, religiosos ou de ódio; times e facções usam só cor e ícone geométrico (▲ ● ■ ◆) |
| Marcas | armas sem marca nem nome comercial [#10]; nenhuma marca real em placas, props ou skins |
| Violência | cartunesca por padrão; sangue só por opção, em cubinhos, sem desmembramento além do "desmontar" [#9]; sem tortura, execução ou alvo civil |
| BoboStrike | atacantes e defensores sem identidade real; a bomba é a Boom Box de brinquedo |
| Zumbis | cartoon e engraçados, sem horror gráfico [#31] |
| Texto | tom "bobo, nunca maldoso": mensagens de morte curtas ("Jorge te bobou"), prêmios e zoeiras só com bots; neutro com humanos; bots sem falas [#34] |
| Temas fora | drogas, álcool, conteúdo sexual, guerras e atentados reais |
| Skins | catálogo fechado de peças (chapéu, cabelo, cor, rosto, padrão); sem upload de imagem |

---

## 9. Progressão: nenhuma [DECIDIDO #16]

- **Tudo liberado sempre:** armas, modos, mapas, regras, Laboratório e todas as peças do bobo [DECIDIDO #17]. Isso protege o pilar 1.
- **Só estatísticas e recordes locais:**
  - Onda máxima no Bobo Zombies por mapa e configuração.
  - Kills por arma, maior sequência, precisão média.
  - Bot que mais te derrotou e bot que você mais derrotou.
  - Melhor resultado em cada preset de fábrica do tipo desafio (ex.: "Imortais").
  - Horas jogadas.
- Nada disso libera nada.
- **Fora:** moeda, loja, loot box, passe, XP, nível de perfil e anúncio. O projeto é gratuito e não comercial.
- **Onde fica salvo** [PADRÃO]: na web, `localStorage` com `navigator.storage.persist()` e "Exportar/Importar backup" em arquivo; no Switch, JSON no SD com backup.

### 9.1 Meu Bobo [DECIDIDO #17]
- Customização completa desde o início: chapéu, cabelo, cor, rosto e padrão, sobre a skin pixel-art 64×64 com camada externa.
- **Regras de gameplay:**
  - O time é sempre legível, qualquer que seja a customização: marca de cor do time no tronco e ícone de time (detalhe com a frente de arte).
  - Acessórios não aumentam a hitbox (3.1).
  - Bots usam o mesmo sistema de visual.
- **No online:** cada jogador envia o próprio visual (IDs das peças e cor).

---

## 10. Configuração de partida e presets

### 10.1 Três profundidades
| Nível | Contém |
|---|---|
| Rápido (Partida Rápida) | modo, mapa, nível (Pela vibe → Tryhard), quantidade de bots |
| Avançado ("Partida personalizada") | abas Partida, Jogadores, Armas, Bots, Modificadores, Tela |
| Laboratório | um bot por vez, nos 4 eixos (seção 6) |

**Restrições de interface que valem para todas as telas** (UI toda em WebGL [DECIDIDO #3]):
- Navegável 100% por controle (exigência do Switch) e por toque (alvos de 44 px).
- Nenhum campo de texto obrigatório: nomes saem de gerador. Digitar é opcional.

### 10.2 Camadas de configuração
Da mais geral para a mais específica. Cada camada sobrescreve a anterior:
1. Padrão do modo.
2. Preset.
3. Time (exemplo: time vermelho com 500 HP).
4. Bot individual.
5. Diretor (M6+): ajuste dinâmico, limitado, só em bots.

Por fim, tudo passa pelo **clamp aos tetos da plataforma** (bots, visão).

### 10.3 Catálogo de regras de partida
- **Partida:** modo, mapa, tempo limite (off ou 3–30 min), meta (kills, pontos, ondas, rounds), número de times (2 no M2; até 4 no Bobo Sandbox), tamanho dos times, fogo amigo, morte súbita, **alcance de visão** (até o teto do perfil).
- **Jogadores:** HP (25–1000), regeneração, respawn (0–15 s ou nenhum), proteção de spawn, perfil de movimento, gravidade, dano de queda, "levanta sozinho", **câmera permitida** (1ª e 3ª / só 1ª).
- **Armas:** loadout, armas permitidas, munição, multiplicador de dano, só headshot, um tiro mata, ADS on/off, recoil, spread, autodano, assistência de mira permitida (padrão: permitida, e aparece no lobby online [PADRÃO]).
- **Bots:**
  - Quantidade por time; nível rápido ou bots salvos.
  - Mistura por porcentagem (exemplo: 70% Normal Bob e 30% Jorge).
  - "Bots completam times"; "bot assume quem sai". Diretor no M6+.
- **Modificadores:** os básicos no M2 (4.5 e gravidade); a lista do Bobo Chaos no M6+.
- **Tela da partida:** radar, kill feed, nome sobre o inimigo (desligar deixa mais difícil), hitmarker.

### 10.4 Presets
- **De fábrica**, uns 8 (nomes provisórios): Vibe, Tryhard, X1 Sniper, 2v2 + bots, 4 vs 40, Sofá Zombies, Imortais, Paintball Relâmpago. Cada um só aparece quando o modo dele existe.
- **Do jogador** [PADRÃO]:
  - Os **5 últimos** ficam salvos automaticamente; o último é o que o JOGAR usa.
  - Até **6 favoritos** viram atalhos no menu.
  - Presets salvos: até 200 na web, 50 no Switch.
- **Compartilhar (M6+):** código `BFP1-...` e link `#p=...` (o hash não vai para o servidor). Os bots personalizados vão **embutidos** no preset, para quem recebe não precisar tê-los. Antes disso: backup em arquivo (M2) e SD (M4).
- **Formato** [PADRÃO]: é o esquema único de `preset@1` (o `tecnico.md` 14.2 cita só os campos de topo). Refs de bot: `builtin:<id do bot de fábrica>` (os 5 níveis são `vibe-bob`, `chill-bob`, `normal-bob`, `sweaty-bob`, `tryhard-bob`) ou `embedded:<id>` de um bot em `embeddedBots`. Perfis de movimento: `bobo`, `tactical`, `arcade`, `custom`. Os valores guardam o ID sem o prefixo de tipo (`"mode": "warfare.tdm"`, não `"mode:warfare.tdm"`).

```json
{
  "format": "boboforces/preset@1",
  "name": "Imortais",
  "mode": "warfare.tdm",
  "map": "construto",
  "match": { "timeLimitS": 600, "scoreLimit": 75, "viewDistanceM": 50 },
  "players": { "hp": 100, "regen": "default", "respawnS": 3, "movement": "bobo", "camera": "any" },
  "weapons": { "loadout": "free", "ammo": "normal", "damageMul": 1, "ads": true },
  "teams": [
    { "name": "Humanos", "humans": "all", "bots": [{ "ref": "builtin:normal-bob", "count": 5 }] },
    { "name": "Jorges", "bots": [{ "ref": "embedded:b7f3c2", "count": 8 }] }
  ],
  "embeddedBots": [
    {
      "format": "boboforces/bot@1",
      "id": "b7f3c2",
      "name": "Jorge the Immortal",
      "look": { "skin": null, "skinTone": "tan", "face": "grin", "hair": "none", "hairColor": "#3b2a1a", "hat": "bucket", "hat3d": null,
                "outfit": "fatigues", "pattern": "plain", "colors": ["#ff5d3a", "#5a6b3c"], "back": null },
      "skill": { "reactionMs": 700, "aimErrorDeg": 5, "acquireS": 1.0, "turnDegS": 200, "recoilControl": 0.2, "headPref": 0.05, "grenadeUse": 0, "combatMove": "none" },
      "intelligence": { "level": 0, "useCover": false, "flank": false, "retreat": false, "grenades": false, "callouts": false, "ambush": false, "learn": false, "playObjective": true },
      "personality": { "preset": "kamikaze", "aggression": 1.0, "caution": 0.0, "patience": 0.0, "preferredRangeM": 3, "silliness": 0.4 },
      "rules": { "hp": 500, "speed": 0.9, "size": 1.0, "ammo": "infinite", "weapons": ["shotgun"], "headshotImmune": false }
    }
  ],
  "director": { "enabled": false },
  "modifiers": ["lowGravity"],
  "seed": 48213
}
```

Num celular (teto 12), esse preset é cortado para caber, e a tela avisa o que mudou.

### 10.5 Configurações por jogador (não são da partida)
- Sensibilidade separada para mouse, analógico e toque; multiplicador no ADS.
- Inverter o eixo Y. FOV (3.5).
- **Assistência de mira:** Desligada / Leve / Média / Forte. Padrões: mouse Desligada, controle Média, toque Média.
- Atirar sozinho no toque. Giroscópio no celular, opcional e desligado [PADRÃO].
- Alternar ou segurar para mirar, agachar e correr.
- **Teclado:** agachar no **C** (não no Ctrl, por causa do Ctrl+W) [PADRÃO]; tudo remapeável.
- Câmera 1ª ou 3ª pessoa (se a regra permitir).
- **Violência:** cartunesca (padrão) ou sangue [DECIDIDO #9].
- Mira: cor e forma. Tamanho do HUD. Vibração.
- Cores de time com modo daltônico. Reduzir tremor de câmera.
- Áudio: saída mono e indicador visual de som [PADRÃO].
- Esconder nomes alheios (10.8).
- Dicas de 1 linha on/off (2.5).
- **No local:** cada jogador escolhe um perfil salvo, com tudo isso guardado nele.

### 10.6 Entrada rápida no local (M3; mesmo código na web e no Switch)
- **Lobby:** "Aperte A para entrar" (até 4). Teclado e mouse contam como 1 slot [PADRÃO]. O P1 escolhe o preset ou o modo; os outros escolhem time e perfil; Start inicia.
- **Entrar no meio:** segurar A por 1 s num controle livre.
  - O jogador entra no time com menos humanos e assume um bot.
  - A tela se redivide [PADRÃO]:

    | Jogadores | Divisão |
    |---|---|
    | 1 | tela cheia |
    | 2 | horizontal, cima e baixo (opção vertical) |
    | 3 | 2×2, com o 4º quadrante mostrando placar e minimapa |
    | 4 | 2×2 |

- **Sair:** pausa, depois Sair. Um bot assume o lugar.
- **Kill feed** [PADRÃO]: 4 linhas por vista com 1–2 jogadores; 2 linhas compartilhadas no centro com 3–4.

### 10.7 Sala online (M5): fluxo e controles do host
Rede fica com a frente técnica. Online só na web; até 4 humanos [DECIDIDO #25]; host autoritativo; só por código ou link entre amigos, sem salas públicas e sem chat de texto livre [PADRÃO].

**Fluxo:**
1. O host cria a sala e recebe um código e um link.
2. Os convidados entram no lobby (aviso curto de privacidade na primeira vez).
3. O host configura, e todos veem a configuração, inclusive câmera permitida, assistência de mira e alcance de visão.
4. Cada um escolhe time e loadout; o visual do bobo vai junto.
5. O host inicia.

**Controles do host** [PADRÃO]:

| Controle | Regra |
|---|---|
| Expulsar | tira o jogador; ele não volta naquela sala |
| Travar sala | ninguém novo entra, nem com o código |
| Mudar regras | só no lobby, entre partidas |
| Pausar | só no coop; PvP não pausa |
| Bots | o host define quantidade, nível e "bot assume quem sai"; os bots rodam só no host |
| AFK | 60 s sem input: um bot assume a vaga e o jogador vira espectador; ao mexer, volta assumindo um bot do time |

**Quedas e segundo plano** [PADRÃO]:
- Convidado que cai: um bot assume; se voltar na mesma partida, assume um bot do time.
- Host em segundo plano: o coop pausa; o PvP encerra depois de 10 s, com resultado parcial.
- Host saiu = fim da partida (sem migração de host na v1). Para trocar de host, outro jogador cria uma sala nova.
- Host no celular: teto de 8 bots.
- **Comunicação:** pings e emotes. Nada de texto livre além dos nomes.

### 10.8 Nomes, compartilhamento e moderação [PADRÃO]
Nomes de bot, preset e jogador são texto livre que chega a outras pessoas por código, link, arquivo e online.

- **Tamanho:** nome de jogador até 16 caracteres; nome de bot e de preset até 24.
- **Caracteres:** só o que a fonte do jogo tem (Latin-1 com acentos, números, espaço e pontuação básica). O resto é removido.
- **Filtro simples local:** lista de palavras barradas em pt-BR e inglês, comparando sem acento, sem maiúsculas, sem espaço e com troca de números por letras (ex.: "0" por "o"). Nome barrado vira um nome do gerador. Vale ao digitar, ao importar e ao entrar numa sala.
- **Esconder nomes alheios** (por jogador): nomes de humanos e bots vindos de fora aparecem como nomes gerados localmente.
- **Códigos e arquivos recebidos:**
  - Validação de esquema e clamp aos tetos da plataforma.
  - Teto de tamanho: código até 4.000 caracteres; arquivo até 64 KB; até 16 bots embutidos por preset.
  - Campos desconhecidos ignorados; versão maior recusada com mensagem; conteúdo ausente (mapa, arma, modo) cai em fallback com aviso.
- **Mapas:** nunca são recebidos de outros jogadores (não existem mapas de jogador [DECIDIDO #36]).
- **Online:** o host expulsa; não há chat livre para moderar.

---

## 11. Anti-frustração [PADRÃO]
Toda partida tem saída para os travamentos comuns, sem depender de sair e voltar.

| Problema | Regra |
|---|---|
| Cair abaixo do mapa | Plano de morte 10 m abaixo do ponto mais baixo do mapa. Se alguém causou dano nos últimos 5 s, a kill é dele; senão, é "acidente" e não dá ponto a ninguém nem tira do jogador. Vale para bots e zumbis. |
| Sair do mapa | Parede invisível no limite, marcada com faixa listrada. |
| Preso no cenário | **"Destravar"** na pausa leva ao nó de navegação livre mais próximo. Offline, na hora. No online PvP, 3 s parado e vulnerável, com recarga de 30 s. Se a colisão detectar o bobo dentro de bloco sólido, empurra para fora sozinha. |
| Bot ou zumbi parado | **8 s sem progresso na rota:** teleporte ao nó de navegação mais próximo, fora da vista dos humanos quando possível. Na 3ª vez, respawn. O F2 registra o ponto para corrigir o mapa. |
| Último zumbi | Quando sobra 1 zumbi (ou até 3 por mais de 30 s), eles correm até o humano mais próximo e ganham marcador através de paredes. |
| BoboStrike sem plantar | Round com limite de 1:45 (defensores vencem no tempo). Com 30 s restantes, bots atacantes vão direto ao site mais próximo. Boom Box largada no chão ganha marcador para o time. |
| Partida sem fim | Todo modo tem tempo limite padrão. Bobo Zombies Infinito só com escolha explícita. |
| Derrota feia | Offline (solo e local): depois de 5 mortes seguidas sem kill, ou placar perdendo por 50% ou mais na metade do tempo, a tela de morte mostra 1 linha: "Tá puxado? Pausa → Ajustar desafio" (no máximo 1 vez por partida, desligável). No resultado de uma derrota feia, o foco padrão vai para **Mais fácil** em vez de De novo. No online, não aparece. |
| Spawn kill | Proteção de 1,5 s e spawn pontuado (5.3). |
| Saída sem querer (web) | Pausa automática quando o pointer lock cai ou a aba some; confirmação antes de fechar a aba no meio da partida. |

---

## 12. Switch: projetado desde já [DECIDIDO #1, #32, #33]

- **100% offline.** Todos os modos funcionam porque os bots completam a partida. Nenhum modo depende de mais de 4 humanos.
- **Controle completo por jogador:** par de Joy-Con ou Pro Controller [DECIDIDO #32]. Joy-Con sozinho não é suportado.
- **Desempenho** [PADRÃO]: 720p fixo sem AA até o Teste Zero aprovar algo melhor; 30 FPS mínimo com 4 jogadores; sim a 60 Hz, ou 30 Hz se o Teste Zero exigir (todos os números de gameplay estão em unidades por segundo).
- **Mira sem giroscópio:**
  - A assistência de mira (fricção e leve magnetismo) é um sistema central, construído no M2 para o controle e o toque.
  - O Switch reaproveita o mesmo sistema.
- **Áudio** [PADRÃO]: cada som usa o ouvinte local mais próximo; opção de saída mono; indicador visual de som.
  - Indicador direcional de dano sempre ligado.
  - Nenhuma mecânica pode depender só de ouvir a direção.
- **HUD em 640×360 por vista:**
  - Mira, HP, munição, objetivo, kill feed (10.6) e indicador de dano.
  - Pouco texto, ícones grandes.
- **Botões** [PADRÃO]:
  - **+** = pausa (o fechamento padrão é interceptado; só se sai pelo menu).
  - **−** = placar.
  - Vibração por jogador: dano tomado, tiro de arma pesada, caído.
  - Glifos genéricos desenhados pelo jogo (posição e cor), sem logos de marcas.
- **Ciclo de vida** [PADRÃO]: pausa automática ao trocar entre dock e portátil, ao desconectar um controle ou ao voltar do HOME. Os slots são reatribuídos na tela "aperte A".
- **Tetos de bots** por número de jogadores (6.11). Visão: 90 / 70 / 50 m (8.3).
- **LOCAL EDITION (M4):** o lobby "aperte A" é a tela inicial. Lista do lobby (a mesma da `arte-ux.md` 6.5):
  - Bobo Zombies (1–4).
  - Bobo Warfare (TDM, FFA, X1, 2v2), com 1–4 humanos + bots.
  - Bobo Training.
  - Surpreenda-me.
  - COMEÇAR (último preset).
  - Bobo Sandbox e os modos M6+ entram quando existirem e couberem no orçamento.
- **Oficina offline:**
  - Nome por gerador; teclado do sistema só se o Teste Zero confirmar que funciona no nx.js.
  - Bots e presets entram e saem como JSON na pasta do save no SD (`sdmc:/switch/boboforces/`).
- **Uso pessoal, sem publicar build** [DECIDIDO #33]. Diagnóstico em `runtime.log` no SD.

## 13. Celular [DECIDIDO #26, #37]
- **PC primeiro.** O celular funciona desde o M2 e é refinado depois. Android e PC primeiro; iPhone/iPad funciona com limitações conhecidas. Só navegador, sem APK.
- **Tetos:** 12 bots; 8 se for host online (6.11). Padrão de time 4v4.
- **Visão:** teto de 90 m.
- **Controles:** toque, atirar sozinho opcional, assistência de mira Média por padrão, giroscópio opcional e desligado. Sempre em paisagem, com aviso "Gire o celular" [PADRÃO].
- **Partidas padrão** 20–30% mais curtas (exemplo: TDM com 50 kills ou 7 min) [PADRÃO].
- **Primeira partida:** a mesma da 2.5, em De boa.
- **Interface:** mesmas telas da web, com alvos de 44 px. Nada de digitação obrigatória.
- Limitador de 30/60 FPS [PADRÃO].

---

## 14. Resumo por marco

**M2, MVP web solo (PC e celular)** [DECIDIDO #27, #29]:
- **Modos:** Bobo Warfare TDM e FFA (com o preset X1 pronto para o online), Bobo Training, Surpreenda-me simples.
- **Conteúdo:** Construto + Ringue; 8 armas (pistola, SMG, fuzil, escopeta, sniper, lança-foguetes, faca, granada); perfis Bobo, Tático e Personalizado; 1ª e 3ª pessoa.
- **Bots:** Laboratório com núcleo forte (5 níveis, sliders dos 4 eixos, salvar); Oficina local; ~12 bots de fábrica; salvar nêmesis.
- **Configuração:** JOGAR, Partida Rápida, presets locais (5 últimos + 6 favoritos), Mais fácil e Mais difícil, regras básicas (4.5, gravidade, câmera, visão), backup em arquivo.
- **Primeiro minuto e anti-frustração:** seções 2.5 e 11.
- **Fora do M2:** tela dividida e Bobo Zombies (M3), Switch (M4), online (M5); Diretor, Aquário, códigos, Domination e demais modos (M6+).

**Depois:** M3 Sofá, M4 Port do Switch, M5 Online P2P, M6+ modos de festa e conteúdo (tabela 7.2).

## 15. Fora do escopo
- Ranqueada, matchmaking e salas públicas.
- Chat de voz e chat de texto livre.
- Anti-cheat, que não faz sentido sem competição.
- Campanha com história.
- Loja e monetização.
- Progressão e desbloqueios [DECIDIDO #16].
- Editor de mapas para jogadores [DECIDIDO #36].
- Destruição de cenário [DECIDIDO #4].
- Online no Switch e publicação do build do Switch [DECIDIDO #1, #33].
- APK [DECIDIDO #37].
- Outros idiomas: só pt-BR, com os textos numa tabela de chaves desde o primeiro dia [DECIDIDO #14].
- Falas de bots [DECIDIDO #34].
- Migração de host na v1.
- Mods com script.

## 16. Pendências
Só o que continua aberto de verdade.

| Pendência | Quando fecha | O que muda no gameplay |
|---|---|---|
| Densidade de textura e quantidade de peças fora da grade, aprovadas pelo Erick por prints da cena-vitrine | M1 | nada nas métricas (3.1); pode mudar a forma final das caixas do bobo e quais peças os mapas usam |
| Teste Zero no Switch real (4 telas, bots burros): FPS e memória, tetos de bots e zumbis, sim a 60 ou 30 Hz, visão de 50 m no 3–4P, HUD legível em 640×360, par de Joy-Con lido como 1 controle, teclado do sistema no nx.js | M1 | tetos da 6.11, visão da 8.3, nomes no Switch (gerador ou teclado) |
| Calibração pelo robô de balanceamento: headshot (1,5x / 2,0x / 1,25x), TTK, sniper com 95 no corpo, os 5 níveis | M0–M2 | números das seções 4, 5 e 6.6 |
| TURN antes de abrir o online (protótipo só com STUN) e o aviso de privacidade | antes do M5 | nada; só a confiabilidade das salas |
| Bobo Royale Mini (24) no celular (teto 12) e no Switch 2P+ (tetos 16 e 12) | M6+, com medição | depende de LOD de IA; se não couber, reduzir os participantes nesses perfis exige nova decisão do Erick registrada no `DECISOES.md` (#35) |
| Nomes desta frente marcados [PADRÃO]: armas, bots de fábrica, zumbis especiais, vantagens, mapas Ringue e Base Abandonada | antes do M2 | só texto; os IDs internos não mudam |
