# BOBOFORCES — GDD · Frente: Direção de arte blocada pixel-art, UX, Áudio e Marca

> **Status:** v1 após a Fase 1 (02/11/2026). `docs/DECISOES.md` manda sobre este texto. Se este documento divergir de `gameplay.md` ou `tecnico.md`, desempata o GDD 9.2 (coluna "Adotado").
>
> **Legenda**
> - **[DECIDIDO #n]**: decisão do Erick, linha `n` da tabela de `DECISOES.md`.
> - **[PADRÃO]**: decisão menor do Claude registrada em `DECISOES.md` (revisável pelo Erick).
> - **[PROPOSTA]**: detalhe desta frente, valor inicial. Pode mudar por print aprovado ou por medição, sem nova rodada de perguntas. As escolhas de arte fora do voxel puro usam a liberdade da #45.
> - **[TZ]**: só se confirma no Teste Zero (M1, Switch real).
> - **[C]**: confirmado na pesquisa (`docs/pesquisa/`).

**Pior caso que dimensiona tudo:** Switch na dock, 720p fixo sem AA [PADRÃO], 4 jogadores, cada viewport com 640×360, 30 FPS mínimo, 12 bots armados ou 24 zumbis [PADRÃO], visão de até 50 m. Tudo o que está abaixo precisa caber nesse caso. PC e celular recebem mais detalhe pelo perfil de qualidade, nunca um visual diferente.

---

## 0. Princípios da frente [PROPOSTA]
1. **Primeiro legível, depois bonito.** Numa viewport de 640×360, o jogador sabe em menos de 0,5 s quem é aliado, quem é inimigo e o que está atirando nele.
2. **Pixel consistente por família.** Cenário, props, armas e bobos têm 32 px/m (os bobos desde o port #56: 1 px do boneco = 5,47 cm, pintado direto a 2 texels por px (36,6 texels/m) em 2 camadas, e o rosto a 16 × 16 px na própria skin; antes, na #51, pintura a 16 px/m ampliada no loading). Nenhuma textura estica; peça nova respeita a densidade da sua família.
3. **Bloco é a base, não a prisão.** O mundo é de blocos de 0,5 m; peças fora da grade entram quando ficam mais leves ou mais bonitas [DECIDIDO #7, #45].
4. **Sem pós-processamento.** Nada de EffectComposer, bloom ou SSAO: render target float falha em silêncio sem extensões [C]. O capricho sai da textura, da luz por vértice e de sprites aditivos.
5. **A mesma UI em todo lugar.** Menus, Laboratório e HUD são desenhados pelo jogo em WebGL [DECIDIDO #3].
6. **Humor bobo, nunca maldoso.** A piada é com o bot, não com o jogador humano.
7. **Entrar rápido.** Quem volta ao jogo começa a jogar em 1 interação. Quem escolhe outro modo, em no máximo 3.

---

## 1. Direção de arte blocada pixel-art

### 1.1 Pilar visual [DECIDIDO #5, #19]
Visual **blocado com pixel-art, na linha de Block Strike e Pixel Gun 3D**: bonecos e armas feitos de caixas com textura pixel-art, cenário de blocos texturizados, cores vivas, sol quente e AO suave. O tom é de **brinquedo tático**: militar cartunesco genérico, sem nacionalidade. "Voxel" é referência de estilo, não limite [DECIDIDO #45].

Regras do pilar [PROPOSTA]:
- **Reserva de saturação.** O cenário fica em até cerca de 60% de saturação (HSV). A faixa de 75% a 100% fica para times, inimigos, itens pegáveis e VFX.
- **Contraste de valor.** O bobo tem pelo menos 25% de diferença de luminância em relação ao fundo médio do mapa. Confere-se com print em escala de cinza.
- **Silhuetas grandes e simples.** Detalhe miúdo só na textura, nunca em geometria pequena.
- **Sol quente, sombra fria.** As rampas de cor das texturas fazem *hue shift*: tons claros puxam para amarelo, tons escuros para azul/roxo. A luz do motor repete a regra (sol âmbar, céu azulado).

### 1.2 Grade e densidade de textura [DECIDIDO #6]
| Família | Densidade | Tamanho da textura | Observação |
|---|---|---|---|
| Cenário (blocos e formas do catálogo: laje, degrau, rampas, painel fino, cerca, cruz) | **32 px/m** | **16×16 px por face de bloco de 0,5 m** | filtro nearest; UV em unidades de mundo, então rampa e cerca têm o mesmo pixel do bloco |
| Bobos e bobos-zumbi | **~36,6 texels/m** [DECIDIDO #51; #56] (2 texels por px do boneco; 1 px = 5,47 cm; família dos 32 px/m) | pintura direta em **2 camadas 64×64** por skin (`paintFigureSkin`) | o pixel do boneco passou a ser o da farda em pixel art Nearest (#58), sem Scale2x nem grão (o `expandSkin` e a pintura 64×64 de 4 camadas, #51, saíram no port); rosto 16×16 na própria skin |
| Armas (mundo e viewmodel) | **32 px/m** [PROPOSTA] | 64×64 por arma | o mesmo modelo serve em 1ª pessoa e na mão dos outros |
| Props fora da grade (cilindros, barris, jipe, holofote, árvores low-poly), acessórios 3D e props dinâmicos (pickups, caixa misteriosa, armas na parede) | 32 px/m [PROPOSTA] | camadas 64×64 por modelo | no array `modelos64` (ver 1.6); material do cenário que um prop usa entra como tile 64×64 do mesmo material |

A densidade e a quantidade de peças fora da grade são **aprovadas pelo Erick por prints na cena-vitrine (M1)** [DECIDIDO #6]. Se o print pedir, a primeira alavanca é a densidade dos bonecos (skin 64×64 com cabeça de 8 px), não a do cenário. **Resultado dos prints (03/11/2026):** os bonecos dobraram para 32 px/m (#51) e o mapa leva a dose dobro de peças fora da grade (#52); o cenário ficou como estava.

### 1.3 Regras de pixel-art [PROPOSTA]
**Paleta**
- Uma **paleta mestra de 64 cores**, organizada em rampas de 4 a 6 tons por material (concreto, metal pintado, madeira, lona, terra, grama, areia, pele, tecidos, cores de time, emissivos). Toda textura usa só cores dessa paleta; o gerador de texturas falha o build se aparecer cor fora dela.
- Cores de time e de jogador local ficam **fora** das rampas do cenário (ver 6.2), para nunca confundir parede com inimigo.
- Preto puro (`#000`) só em pupilas e frestas; o "preto" do jogo é o tom mais escuro de cada rampa.

**Sombreado pintado**
- Leve: no máximo ±1 tom da rampa, luz pintada vindo de cima. O volume grosso vem da luz do motor (AO, sol, céu), não da textura.
- **Materiais contínuos** (grama, terra, areia, concreto liso, água) são *seamless*: sem borda pintada, para a repetição do greedy meshing não desenhar uma grade no chão.
- **Materiais modulares** (caixote, painel metálico, tijolo, tábua, azulejo militar) têm **bevel pintado de 1 px**: +1 tom na borda de cima e da esquerda, −1 tom na de baixo e da direita. A grade de 0,5 m aparece de propósito, como em Block Strike.

**Contorno**
- Cenário não tem contorno preto: com 32 px/m, contorno escuro em toda borda vira ruído em 640×360.
- Skins e armas têm **contorno interno de 1 px** no tom mais escuro da rampa, só onde uma peça de roupa ou de arma termina (gola, cinto, bota, ferrolho). Não contornar a borda da caixa inteira, que já é separada pela luz.
- O contorno de time (um casco desenhado pelo motor) saiu no print de leitura [DECIDIDO #50]: a leitura vem do colete de time, dos marcadores (2.7) e da luz.

**Ruído e dithering**
- Nada de xadrez de dithering: em 640×360 vira moiré. Textura de material usa **manchas de 2 a 3 px**.
- Pelo menos 3 variantes por material contínuo (ex.: `grama_a/b/c`), sorteadas no shader por célula (ver 1.6).

**Texto e símbolos**
- Nenhum texto de interface fica em textura. No cenário, só pictogramas e palavras curtas em pt-BR de sinalização genérica ("PERIGO", "SAÍDA", números de setor). Nunca marcas, nomes de lugares reais, bandeiras ou insígnias de exércitos reais [DECIDIDO #19].

### 1.4 Peças fora da grade [DECIDIDO #7]
Uma peça fora da grade entra quando cumpre **(a)** menos triângulos ou draw calls que o equivalente em blocos, ou **(b)** silhueta claramente melhor onde o jogador olha de perto (diagonal grande, forma redonda, transparência), **e (c)** a colisão dela vira caixas ou rampas que a navegação em grade entende [PADRÃO].

**Regra única de render** [PADRÃO, igual em `tecnico.md` 5.2 e no GDD 5.2]:
- **Formas do catálogo** (cabem na célula e repetem muito: laje, degrau, rampas 1:1 e 1:2, painel fino, poste + travessa, cruz) vão **na malha do chunk**, com camadas 16×16 de `blocos16` e UV em unidades de mundo. Custo zero de draw call.
- **Props** (silhueta própria, forma redonda ou tamanho grande: cilindros, barris, caixas d'água, jipe, holofote, gerador, antena, árvores low-poly, tendas, sacos de areia arredondados) vão no **programa instanciado**, um `InstancedMesh` por tipo em grupos espaciais, com camadas 64×64 de `modelos64` a 32 px/m. Teto: até 15 draw calls de props por viewport, 8 no Switch 3–4P [T0].
- O motivo de o cilindro não ir para o chunk: o vértice compacto de 12 bytes tem uma tabela de até 32 normais (`tecnico.md` 6.2), e um cilindro de 12 lados estoura essa tabela.

| Peça | Quando usar | Geometria [PROPOSTA] | Colisão e navegação |
|---|---|---|---|
| Rampa 1:1 e 1:2 (cunha) | rotas principais com subida, telhados, acesso de veículo | forma do catálogo, 2 a 4 triângulos por bloco, na malha do chunk | rampa na grade; a navegação trata como escada contínua |
| Meio-bloco (laje de 0,25 m) | degraus, bancadas, beirais | forma do catálogo: caixa de 0,5×0,25×0,5 m | caixa; degrau automático cobre |
| Cerca, grade, corrimão (cutout) | parapeitos e divisórias que deixam ver através | forma do catálogo (painel fino ou poste + travessa), 2 quads por bloco, alpha test | caixa fina; se bloqueia bala é regra do material (frente de gameplay) |
| Vegetação em cruz | grama alta, arbusto, flores, mato de borda | forma do catálogo: 2 quads cruzados, cutout, balanço no vertex shader | sem colisão |
| Telhado inclinado | coberturas de prédio | rampas do catálogo | rampa |
| Cilindro de 8 ou 12 lados | canos, tanques, colunas, barris, troncos | prop instanciado, até 48 triângulos por metro | caixa envolvente (ou lista de caixas) na grade |
| Lona e tenda | tendas, toldos | prop instanciado, planos com espessura de 1 px de textura | caixa ou rampa conforme a altura |
| Prop low-poly texturizado | jipe, holofote, antena, gerador, sacos de areia arredondados, árvore low-poly | prop instanciado, até 300 triângulos | caixas simples; fica estático no mapa |

- **Base continua sendo bloco:** pelo menos ~80% da superfície visível de um mapa é bloco; as peças fora da grade são tempero [PROPOSTA, aprovar por print no M1].
- Rotação livre só no visual; a colisão sempre volta para caixas e rampas alinhadas à grade. Não existe colisor cilíndrico [PADRÃO: Física e navegação].

### 1.5 Métricas de level design
As medidas de movimento e corpo vêm da tabela única de config, que manda sobre arte e técnica [PADRÃO].

| Métrica | Metros | Blocos de 0,5 m |
|---|---|---|
| Bobo em pé / agachado (AABB 0,6 × altura × 0,6) [#53, #55] | 1,75 / 0,95 | 3½ (o vão livre pede 4) / ~2 |
| Olho em pé / agachado (câmera) [#53, #55] | 1,55 / 0,8 | — |
| Cabeça do bobo (cubo de 8 px do FutBobo) | 0,4375 | ~1 |
| Degrau que o bobo sobe sem pular | 0,5 | 1 |
| Altura alcançada no pulo padrão | 1,0 | 2 |
| Cobertura baixa (esconde agachado) | 1,0 | 2 |
| Cobertura alta (esconde em pé) | ≥ 1,75 (na prática 2,0) | 4 |
| Porta (largura × altura) | 1,0 × 2,0 | 2 × 4 |
| Corredor mínimo (confortável) | 1,0 (1,5–2,0) | 2 (3–4) |
| Rota principal [PROPOSTA] | 4–6 | 8–12 |
| Grade dos prefabs modulares [PROPOSTA] | 4,0 | 8 |
| Pé-direito de interior [PROPOSTA] | 3,0 | 6 |

Com 0,5 m, a cobertura alta "de verdade" é 2,0 m (4 blocos); 1,75 m só existe com meio-bloco. Cada mapa declara sua maior linha de visão [PADRÃO].

**Bobo de 1,75 m (#53 e #55; port em 07/11/2026):** a altura não é múltiplo da célula (3½). O `mapc` conta o nó "em pé" com `ceil(1,75 / 0,5)` = 4 células livres e avisa "visto sem ver" quando um nó jogável fica ao lado de parede com topo entre o olho (1,55 m) e o maior topo de hitbox em pé (1,81 m): o bobo aparece por cima sem ver nada. É aviso, não erro: no Construto são **10 nós** (eram 25 com o bobo A de 1,625 m); as 5 aberturas (3 seteiras da cabine, a janela da guarita e a do 1º andar do prédio 1) subiram de 1,5 para 2,0 m e a pendência da lona de 1,5 m fechou. Aviso novo: cobertura alta com topo em [1,75; 1,81) m, 8 nós (parapeito de 1,75 m em x 26–32, z 49,5–50), decisão de mapa do Erick. Regra de mapa [PROPOSTA]: muro de 1,5 m só onde não se luta. A régua `print:altura` (fora da área jogável, ao sul do perímetro) mostra porta 1,0 × 2,0 m, muro de 1,5 m e cobertura de 1,0 m com os manequins `altura:em-pe` e `altura:agachado`.

### 1.6 Texturas na GPU [PADRÃO]
- **Dois `TEXTURE_2D_ARRAY`** (núcleo do WebGL2), com índice de camada por vértice ou por instância (mesmos nomes em `tecnico.md` 6.1):
  - `blocos16`: camadas de 16×16 px para blocos e formas do catálogo. Até 256 camadas (o mínimo garantido de `MAX_ARRAY_TEXTURE_LAYERS`).
  - `modelos64`: camadas de 64×64 px para skins de bobo e zumbi, armas, acessórios 3D, props fora da grade, props dinâmicos (a folha de rostos saiu no port: o rosto é pintado na skin). Até 128 camadas (~2,7 MB com mips), subindo se o Teste Zero deixar [T0]. Cada skin de bobo ocupa **2 camadas seguidas** (camada 0 = cabeça, expressões e paleta; camada 1 = tronco, listras e reserva do capacete; port #56); a reserva do fim do array tem 64 camadas = 32 skins (o M1 usa 10 no Switch e 19 no PC), e o array fica com 88 de 128 camadas.
- **Filtro:** `NEAREST` na ampliação; na redução, `NEAREST_MIPMAP_LINEAR` com mipmaps gerados no build [DECIDIDO #50]. Sem mipmap, chão e parede cintilam ao longe; com ele, borram um pouco, e a fog esconde. Aprovado no print 5.
- **Mips da skin:** o nível 1 de cada camada é a pintura 64×64 original reempacotada por quadrante (cópia sem filtro: a mesma densidade de 16 px/m de antes); os níveis 2..6 saem do nível 1 com cobertura de alfa.
- **Mipmap de cutout** (folha, cerca, camada externa da skin): o gerador preserva a cobertura do alfa em cada nível, para a cerca não sumir de longe.
- **Greedy meshing por textura:** o mesher funde faces com a mesma camada, a mesma orientação e a mesma luz nos 4 vértices (AO, sol, céu, emissivo). O vértice não guarda UV: o **UV é calculado no shader a partir da posição de mundo** (`tecnico.md` 6.2), com `REPEAT` dentro da camada, sem `fract()` e sem costura de mipmap. Vale igual para quads fundidos e para as faces inclinadas das rampas.
- **Variantes no shader:** a camada final é `base + hash(célula) % nVariantes`, calculada no fragment shader pela posição de mundo (recuada meio texel pela normal). Uma parede de grama com 3 variantes continua sendo **um quad só**. Materiais marcados também podem girar ou espelhar o UV por célula.
- **Ruído de cor** de ±3% de valor por célula, também no shader, nunca no bake [PADRÃO].
- **Plano B**, se o Teste Zero reprovar o array no nx.js [TZ]: atlas com padding de 2 px por tile, `fract()` no UV e `textureGrad` com as derivadas do UV contínuo, para não aparecer costura. No atlas, `blocos16` leva 2 níveis de mip e `modelos64` 3 (o 3º coube no padding de 4 px).
- Imagens em **PNG** [PADRÃO]; nada de textura comprimida (sem extensões no Switch [C]).

### 1.7 Os 10 ingredientes do "blocado bonitão" [PROPOSTA]
Quase tudo é calculado no loading ou no shader, então custa quase nada por frame.
1. **AO por vértice**, com a fórmula da 0fps e troca da diagonal do quad [C].
2. **Sol fixo por mapa**, com sombra do cenário calculada por raycast na grade no loading (pré-malha no build só se o Teste Zero pedir).
3. **Luz de céu** por flood-fill (0 a 15): interiores escurecem sozinhos.
4. **Luz dos emissivos** por flood-fill (0 a 15), com tom por mapa: lâmpadas, painéis, holofotes.
5. **Variantes de textura e ruído de cor no shader** (ver 1.6).
6. **Bevel pintado** nos materiais modulares (ver 1.3), que dá o recorte de brinquedo sem geometria.
7. **Céu em gradiente e fog com a cor do horizonte.** O mapa se dissolve no céu.
8. **Color grading por LUT 1D** de 256 px dentro do shader, sem passe extra.
9. **Detritos em cubinhos** com a cor/textura do que foi atingido (ver 4.1).
10. **Microanimação:** vegetação em cruz balançando (seno no vertex shader), nuvens andando, emissivos pulsando devagar.

### 1.8 Iluminação [PADRÃO]
**Cenário**
- Cada vértice guarda canais separados no layout de bits do `tecnico.md` 6.3: céu (4 bits), sol (4 bits), emissivo (4 bits) e AO (2 bits).
- O shader segue a fórmula do `tecnico.md` 6.4: `cor = textura × variação × (AO × (céu×corCéu + sol×max(N·L, 0)×corSol) + emissivo×corEmissivo)`, depois fog e LUT. O AO escurece só céu e sol; a luz dos emissivos não passa pelo AO.
- Céu, sol e emissivo são uniforms: **Dia, Entardecer e Noite usam a mesma malha**, sem refazer nada.
- As formas do catálogo usam a tabela de normais do vértice compacto (eixos, diagonais da cruz, rampas), então a rampa recebe o N·L certo. Props instanciados usam a normal da própria malha e a luz amostrada por instância, como os objetos dinâmicos [PROPOSTA].

**Objetos dinâmicos e props instanciados** (bobos, armas, pickups, props fora da grade) [PROPOSTA]
- A CPU amostra uma **grade de luz de 2 m** (céu, sol e emissivo, derivada da luz por célula) na posição de cada objeto e passa o valor como atributo de instância. O bobo escurece ao entrar num prédio, sem shadow map. A comparação com 1 m fica para os prints do M1.
- Sombra própria: **sombra-blob** (quad radial instanciado). O jogo não tem nenhum shadow map.

**Clarão de tiro e explosão** [PROPOSTA]
- A luz ambiente da viewport que vê o evento a até 30 m sobe por 80 ms, proporcional à distância. Nenhuma luz dinâmica de verdade.

### 1.9 Céu, nuvens, fog e alcance de visão
- **Céu:** domo com gradiente de 3 cores (zênite, horizonte, chão), disco do sol ou da lua e estrelas por ruído à noite. Sem skybox em textura [PROPOSTA].
- **Nuvens blocadas:** uma camada de lajes achatadas, numa malha só que desliza por uniform e é tingida pela fog [PROPOSTA].
- **Anel de silhueta:** uma malha baixa de morros ou de base distante por mapa, para o mundo não terminar no vazio [PROPOSTA].
- **Fog:** linear, na cor do horizonte.
- **O alcance de visão é regra da partida**, igual para humanos e bots; o perfil só define o teto [PADRÃO]. No online, o host define e todos veem igual.

| Perfil | Teto de visão (fim da fog) | Início da fog padrão [PROPOSTA] |
|---|---|---|
| PC | **140 m** | 60 m |
| Celular | **90 m** | 40 m |
| Switch 1P | **90 m** | 40 m |
| Switch 2P | **70 m** | 30 m |
| Switch 3–4P | **50 m** | 25 m |

Conta de legibilidade: com FOV vertical de ~59° numa viewport de 360 px de altura, um bobo de 1,75 m (#55) ocupa ~18 px a 30 m e ~11 px a 50 m (conta; era ~17 e ~10 px com 1,625 m). Por isso o teto do 3–4P é 50 m, e além de 35 m inimigos em linha de visão ganham marcador (ver 2.7). Corredores de sniper respeitam o teto do perfil mais restrito em que o mapa roda [PADRÃO].

### 1.10 Programas de shader: no máximo 7 [PADRÃO]
| # | Programa | Textura | Usado em |
|---|---|---|---|
| 1 | Blocos opacos | `blocos16` | malha opaca dos chunks: blocos e formas do catálogo (laje, degrau, rampas, poste + travessa) |
| 2 | Blocos cutout (alpha test) | `blocos16` | folhas, cercas, grades, vegetação em cruz |
| 3 | Translúcido | `blocos16` | vidro e água em camada separada, ordenada de trás para frente; parede da zona do Royale |
| 4 | Instanciado | `modelos64` | caixas dos bonecos (R4c, 1 draw por vista; alpha test na reserva do capacete), acessórios, armas no mundo e viewmodel, pickups, **props fora da grade** (estáticos, por tipo e grupo espacial) e **cubinhos de detrito** (cor sólida por instância, sem amostrar textura); sem casco de contorno (#50) |
| 5 | Partículas | atlas de sprites | clarão, traçante, fumaça, decals (marca de tiro, tinta, respingo) e sombra-blob |
| 6 | Céu | — | domo, sol/lua, estrelas, nuvens |
| 7 | UI | atlas MSDF + sprites | menus, Laboratório, HUD |

- Metal, vidro e plástico vêm da textura e da paleta. Sem PBR e sem mapa de ambiente.
- Os 7 programas são **compilados e aquecidos na tela de carregamento** (desenha 1 frame fora da tela): sem `KHR_parallel_shader_compile`, compilar shader trava o frame [TZ].

### 1.11 Emissivos e noite [PROPOSTA]
- Camadas de `blocos16` marcadas como emissivas são desenhadas com brilho total e alimentam o flood-fill de luz. Props emissivos (holofote, gerador ligado) usam uma camada emissiva de `modelos64` e declaram no mapa uma fonte de luz que entra no mesmo flood-fill.
- **Bloom falso:** sprite aditivo de brilho sobre as luzes importantes, até 32 por viewport.
- Cada mapa tem **Dia, Entardecer e Noite**, só com uniforms e LUT. Noite é o padrão do mapa de Bobo Zombies.

### 1.12 Serrilhado e perfis de qualidade
**Serrilhado [PADRÃO]**
- PC: `antialias` nativo do navegador.
- Celular: sem AA, com escala de resolução dinâmica.
- Switch: **720p fixo, sem AA e sem escala dinâmica**, até o Teste Zero aprovar algo melhor (FBO multisample com blit é o candidato) [TZ].
- Pixel-art com nearest serrilha por natureza, e isso faz parte do estilo. A fog e a reserva de saturação seguram a leitura.

| Ajuste [PROPOSTA] | Alto (PC) | Médio (celular bom) | Leve (celular fraco) | Switch |
|---|---|---|---|---|
| Escala de resolução | 1,0 até o DPR | 1,0–1,5, dinâmica | 0,75–1,0, dinâmica | 720p fixo |
| AA | nativo | não | não | não, até o TZ |
| Cubinhos de detrito (pool, igual a `tecnico.md` 16.1) | 500 | 200 | 200 | 200 (120 no 3–4P) |
| Nuvens / vento na vegetação / LUT | sim / sim / sim | sim / sim / sim | sim / não / sim | sim / não / sim |
| Camada externa e acessórios do bobo até | 60 m | 40 m | 25 m | 25 m |
| Limitador de FPS | 60 por padrão, livre como opção | 30/60 [PADRÃO] | 30/60 [PADRÃO] | 30 |

### 1.13 Referências
Servem só como direção; nada é copiado.
- **Block Strike / Pixel Gun 3D:** o alvo direto: caixas texturizadas, skins pixel-art, FPS rápido no celular.
- **Minecraft:** skin com camada externa e leitura de bloco a 16 px por face.
- **Crossy Road:** cor viva e charme de brinquedo.
- **Splatoon / Big Paintball (Roblox):** cor de time como identidade.
- **Mapas de bots do Garry's Mod:** a origem da ideia (sandbox, bots, caos) e do Construto.
- **Krunker.io:** FPS web que abre na hora.

---

## 2. Os bobos

### 2.1 Forma e proporção [DECIDIDO #18, #55, #56]
O bobo é o **boneco do FutBobo** [DECIDIDO #56], com **1,75 m** no total (altura B, #55; antes o bobo A de 1,625 m e, antes dele, 1,5 m). É **cabeçudo, 4 cabeças**: a escala é uniforme, **1 px = 7/128 m (5,47 cm)**, 32 px = 1,75 m, cabeça de 8 px = **0,4375 m**, ombro a ombro 16 px = 0,875 m (a mesma largura do bobo A). Esqueleto de **12 ossos** com uma caixa primária por osso, mais as mãos, e 14 caixas no corpo (cabelo e acessórios entram por cima). Quadril 12 px + tronco 12 px + cabeça 8 px = 32 px. Os detalhes abaixo são **decisões menores revisáveis** (o Erick decide na rodada 3 de prints).

| Osso (caixa) | Caixa (L × A × P, px) | Metros | Observação |
|---|---|---|---|
| Cabeça | 8 × 8 × 8 | 0,4375 × 0,4375 × 0,4375 | rosto na face da frente (2.3); cabelo e acessórios em caixas à parte (2.2) |
| Tronco | 8 × 12 × 4 | 0,4375 × 0,656 × 0,219 | farda em pixel art: jaqueta, cinto e colete (2.2) |
| Braço (×2), manga | 4 × 5,2 × 4 | 0,219 × 0,284 × 0,219 | |
| Antebraço (×2) | 3,6 × 5 × 3,6 | 0,197 × 0,273 × 0,197 | mais a mão 3,8 × 2,2 × 3,8 (0,208 × 0,120 × 0,208) |
| Coxa (×2) | 4,25 × 5,6 × 4,3 | 0,232 × 0,306 × 0,235 | |
| Canela (×2) | 3,75 × 4,9 × 3,75 | 0,205 × 0,268 × 0,205 | |
| Chuteira (×2) | 4,05 × 2,7 × 5,25 | 0,221 × 0,148 × 0,287 | a sola desceu 0,1 px em relação ao FutBobo (o boneco flutuava 5,5 mm) |

- O **olho** fica a **1,55 m** (corpo − 0,2 m), dentro das linhas 7 e 8 do rosto pintado (1,504–1,559 m). Em pé, em repouso, o boneco mede 17,9 px de lado a lado com os braços ao longo do corpo (±0,49 m).
- **Hitboxes:** **12 caixas orientadas, uma por osso** (o antebraço e a mão viram uma caixa só, 3,8 × 6,8 × 3,8 px), lidas da mesma tabela de pose que o render usa: o que se vê é o que se acerta, por construção. A tabela tem 22 posturas (em pé, agachado, deslizando e o zumbi, cada uma por empunhadura e modo) × 5 pitches; a sim interpola e reortonormaliza. Categorias: cabeça, tronco, braço (4 caixas) e perna (6 caixas). Iguais para bots e humanos. AABB de movimento 0,6 × 1,75 × 0,6 m (0,95 agachado) [PADRÃO].
  - **Topo da hitbox** (varredura medida): em pé 1,80375 m (teto 1,81, `FIGURE_MAX_TOP_M`); agachado **0,95978 m** e deslizando 0,94875 m, ambos abaixo do teto de **0,97 m** (`FIGURE_CROUCH_TOP_M`). O texto antigo "nenhum tiro horizontal acima de 0,95 m acerta o agachado" vira 0,97 m, e a cobertura baixa de 1,0 m deixa 3 cm de folga.
  - **Cabeça presa ao olho:** o tronco não leva o pitch da mira; em pé a cabeça gira no máximo 0,6 rad e o pescoço desliza até 1,5 px para compensar; agachado e deslizando a cabeça **só levanta** (pitch em [0; +0,1] rad, o lado que não sobe a quina de trás), e os braços e a arma levam o resto. Medido: o centro da cabeça fica a 0,759 px do eixo do olho em pé e 0,000 px agachado; no deslize 6,47 px e no zumbi 6,84 px, aceitos e relatados (o deslize dura 0,7 s e o zumbi não tem câmera).
  - **Braço através de muro e lona:** as hitboxes de braço (D e E) são cortadas a 0,75 m do eixo da entidade no plano horizontal (a AABB crescida de 0,45 m). A arma e a mão podem aparecer do outro lado de um muro fino ou de uma lona, mas ali não levam tiro. No Construto, o braço visual atravessa barreira em 1.256 nós de navegação; com o corte, só 15 (14 da cerca de tábua e 1 quina de rampa).
  - **Headshot:** os multiplicadores ficam (padrão **1,5x**, sniper **2,0x**, escopeta **1,25x**; braço e perna 0,8x), calibrados pelo robô de balanceamento. Com a cabeça de 0,4375 m, o headshot do nível Normal cai 13 pontos e o TTK sobe 20–30% contra o bobo A (números no `gameplay.md` §3.1); a pergunta G3 da rodada 3 mostra o balance.
- **Agachado P4f** (a pose escolhida, fechada no FK do FutBobo): pernas a −2,0944 rad no quadril e 2,7053 no joelho, pé plano (−0,6109), tronco inclinado 0,65 rad, pescoço afundado 4 px, braços ao longo do tronco (#55). Topo da cabeça em 0,940 m (o cabelo é cortado no teto de 0,99 m, 2.2), meia faixa z de 0,286 m (folga de 1,4 cm na AABB de ±0,30) e centro da cabeça a 0,722 m, que é o olho agachado. Prova: print de perfil `print:altura`, com o manequim agachado atrás da cobertura de 1,0 m; há também o deslize e a vista `print:altura-45`.
- **Deslize "carrinho"** (postura própria): tronco deitado para trás, uma perna esticada à frente; topo 0,928 m; a faixa z vai a ±0,654 m (os pés passam da AABB, como em todo deslize de FPS) e o centro da cabeça fica 0,414 m atrás do eixo do olho.
- **Diferenças conscientes em relação ao FutBobo** (sem pergunta; seguem junto dos prints como registro; decisões menores revisáveis):
  1. farda em pixel art Nearest (#58), no lugar do uniforme de futebol em vetor linear do FutBobo (a maior mudança visual);
  2. sem sombra projetada da cabeça no peito, sem especular nem metal: ouro e braçadeira são tom de paleta;
  3. sola 0,1 px maior;
  4. membros lisos, por amostra de paleta, como no FutBobo;
  5. molas dentro do envelope (2.5), giro preguiçoso só nas pernas e até 0,35 rad;
  6. cabeça presa ao olho;
  7. meia taxa de pose além de 20 m no Switch;
  8. comemorações e tiques só no M2;
  9. recarga: o braço E sai da hitbox, como antes.

### 2.2 Skin: pintor de 2 camadas, pixel art [PADRÃO, #51; port #56; farda #58]
- A skin de cada bobo é **pintada em runtime** (JS puro, sem canvas) por `paintFigureSkin`, direto em **2 camadas 64×64 seguidas** de `modelos64` (2 texels por px do boneco = 36,6 texels/m na cabeça e no tronco, na família dos 32 px/m do cenário). Cada aparência ocupa 32 KB (nível 0) + 8 KB (nível 1, caixa 2×2); a reserva de 64 camadas cabe **32 skins** (eram 16). Tudo no loading; no Switch, TODA aparência da partida é pintada no loading.

| Camada | Região (u, v, w, h) | Conteúdo |
|---|---|---|
| 0 | paleta (0, 0, 16, 16) | 16 amostras 4×4: cabelo, sombra do cabelo, barba, acessório, sombra do acessório, ouro, pele, mão (a luva, ou pele −10 de mão nua), manga, calça, colete, sombra do colete, bota, cabelo-base, gosma e curativo de zumbi |
| 0 | cruz da cabeça 16³, canto (0, 0) | topo, base, direita, frente, esquerda e costas da cabeça |
| 0 | expressões, (16·(e mod 4), 32 + 16·⌊e/4⌋), 16 × 16 | as 8 expressões (2.3); a frente da cruz leva a expressão 0 |
| 1 | tronco, cruz 16 × 24 × 8 em (0, 0, 48, 32) | jaqueta no tecido do look, colete, cinto e cós da calça, em pixel art 16 × 24 |
| 1 | canela (48, 0, 4, 10), bota (52, 0, 12, 12) | joelheira, calça e a barra presa na bota; bota de combate (mini-cruz) |
| 1 | colunas da farda (48–60, 12) | manga (braçadeira), antebraço (punho da luva) e coxa; o zumbi pinta nelas a roupa rasgada, com a barra de pele no fim |
| 1 | reserva do capacete (0, 32, 64, 32) | cruz de uma casca 16³, para a rodada 3 |

- **Membros** leem colunas de 4 texels (uma cor por linha nas 4 faces, lisas como os membros do FutBobo); **mão, cabelo e acessórios** leem amostras da paleta; só a cabeça, o tronco e a bota têm pintura de verdade. Todo canto de região é par e as colunas são alinhadas a 4: o mip fica limpo até o nível 2.
- **Farda [DECIDIDO #58, #59]:** saiu o uniforme de futebol (camisa, estampas, gola em V, escudo, números, meião e chuteira). O look veste uma **farda** (`FigureOutfit`: tecido, jaqueta, calça, colete, botas e luvas; colete e luvas aceitam "sem"): jaqueta no tronco, **lisa ou camuflada** (woodland, deserto, urbano cinza, noturno, e o liso com graxa do mecânico), com os tons das manchas tirados da cor principal e as máscaras por hash (sem `Math.random`); gola mais escura, fecho no meio e as lapelas dos bolsos do peito; **cinto** com fivela; mangas compridas e calça no tom principal (o camuflado vai **só no tronco**, #59); a **barra da calça presa na bota**; **bota de combate** preta ou marrom, sola mais escura e o cadarço numa linha (sem a biqueira). O **colete do look** (sem time) é uma placa menor, com 2 porta-carregadores e uma tira de velcro, e o camuflado aparece em volta; as **joelheiras** são do colete. Os 12 looks prontos: recruta woodland, mecânico de macacão cinza-oliva com graxa (sem colete, mão nua), piloto de macacão de voo verde-sálvia (sem colete, luva de couro), zumbi de woodland velho, e os 8 visuais do FutBobo com o rosto e o cabelo do teste e fardas variadas (urbano, deserto, liso oliva, woodland, noturno, deserto claro, urbano claro, liso areia). Grão desligado.
- **Cabeça:** igual à do FutBobo texel a texel (conferido em 2.311 aparências, 8,28 milhões de texels).
- **Cabelo e acessórios** são caixas na cabeça (0 a 28; os 34 cortes do FutBobo, faixa, tiara, bandana, boné, barba longa e brincos) e **nunca são hitbox** (a aba do boné entra numa parede encostada, como em todo FPS). **Teto de jogo por recorte:** a caixa de cabelo é cortada no teto de 1,99 m em pé e 0,99 m agachado ou deslizando (recorte na matriz da caixa; a que fica toda acima do teto some). Em pé só o afro gigante e o moicano espetado são cortados; agachado, os 26 cortes que passam de 1,0 m ficam com o topo plano a 0,99 m [PROPOSTA; pergunta G5, com o print dos 3 cabelos agachados].
- **Cor de time** (`figureOutfitFor`): com time, o **colete de time** cobre o tronco (placa de frente e de costas nas linhas 2..18, alças, faixa lateral, 3 porta-carregadores e o cinto de guarnição) na cor do time, com o **ícone ▲ ● ■ ◆** (times 0..3) de 5 × 5 na tinta legível num painel 7 × 7 mais escuro, no peito e nas costas; **braçadeira** na manga, **luvas** (também na 1ª pessoa) e **joelheiras** do time; jaqueta, calça e botas continuam as do look. A cor do time cobre **38,1–39,0% da frente** (■ 38,1%, ● 38,4%, ▲ e ◆ 39,0%; projeção do protótipo de pintura, 1.356 t, os 12 looks nos 4 times), acima dos 35% desta seção; na projeção de verdade, com o cabelo, fica em 32,8–38,2% (a barba longa cobre o painel e o afro aumenta a silhueta). **Trava de cor:** acessório, jaqueta, calça, colete, luvas ou botas do look a menos de 92 (redmean) da cor de um time da partida vira `#141414` ou `#f4f4f2`.
- Bots com a mesma aparência e o mesmo time dividem a skin. Estouro da reserva: o excedente veste o look padrão do próprio time, nunca o de outro.

### 2.3 Rosto e expressões [PROPOSTA]
- O rosto é a **face da frente do cubo da cabeça**, pintada em **16 × 16 px** na camada 0 da skin (o texel do rosto é o da skin, não 2× como na folha 8 × 8 do bobo A). O vertex shader desloca a UV da face da frente para a célula da expressão, só com conta, sem ler textura no vertex shader [PADRÃO: Render de personagens]. Trocar de expressão não recompõe a skin nem sobe dados; a expressão vai na 4ª linha da matriz da instância.
- As **8 expressões** (a ordem de `FACE_EXPRESSIONS`, nomes do FutBobo entre parênteses): neutro (normal), mirando (mirando), bravo (grit), assustado (surpreso), dor (triste), comemorando (grito), dormindo (piscada) e morto. "Mirando" e "morto" vêm das expressões extras do FutBobo, como estão. O rig pisca (0,13 s a cada 1,8 a 5,4 s) só com a expressão neutra; os manequins não piscam.
- **A expressão mostra a personalidade do bot sem nenhum texto** (bots não falam [DECIDIDO #34]): o covarde fica assustado ao recarregar ou fugir, o lunático passa a partida bravo, o camper aparece dormindo quando ninguém passa.

### 2.4 Customização [DECIDIDO #16, #17]
Tudo liberado desde o início, sem progressão, sem cosmético por desafio e sem loja. Só estatísticas e recordes.

| Camada | Opções do kit do MVP [PROPOSTA] |
|---|---|
| Skin pronta (atalho que preenche tudo) | 12 skins: recruta, sargento, piloto, mecânico, socorrista (sem cruz vermelha), cozinheiro de quartel, espião de terno, astronauta, apicultor, mergulhador, pijama, robô de papelão |
| Tom de pele | 8 tons + 4 cores fantasia (verde, azul, roxo, cinza-pedra) |
| Rosto (estilo) | 8 estilos de rosto pintados na camada 0 da skin |
| Cabelo (caixas na cabeça) | 34 cortes do FutBobo, com cor livre na rampa de cabelo |
| Chapéu | 8 de camada externa (boné, gorro, bandana, capacete justo…) + 4 acessórios 3D de caixa (capacete com viseira, chapéu de aba, boina alta, antena) |
| Roupa (tronco, braços, pernas) | 6 peças × padrão (liso, listras, xadrez, camuflado, bolinhas) × 2 cores |
| Acessório de costas (3D) | 4: mochila, rádio, tanque de oxigênio, capa |

- **Cor de time por cima da customização** (modos com time, #58): o **colete de time** com o ícone ▲ ● ■ ◆, a braçadeira, as luvas e as joelheiras na cor do time, por cima da farda do look (2.2). A customização nunca cobre essas zonas. Meta: a cor do time ocupa pelo menos 35% da silhueta vista de frente (medido: 38,1–39,0%) [PROPOSTA].
- Fora de time (FFA), cada bobo usa as próprias cores; o marcador de inimigo resolve a leitura.
- **Bots usam o mesmo editor** (eixo "visual" do Laboratório, ao lado dos 4 eixos: inteligência, habilidade, personalidade e regras). Se ninguém mexer, a aparência sai do hash do nome: "Jorge the Immortal" é sempre o mesmo bigodudo. Nomes de bots de fábrica são bobos em inglês [DECIDIDO #15].
- Em **3ª pessoa** [DECIDIDO #12] o jogador vê o próprio bobo inteiro, então a customização aparece também para quem a fez.

### 2.5 Animação procedural, sem esqueleto deformável [PROPOSTA]
| Ação | Como |
|---|---|
| Andar / correr | seno nas pernas e nos braços, com frequência ligada à velocidade |
| Deslizar [DECIDIDO #8] | tronco inclinado para trás, uma perna à frente, poeira de cubinhos |
| Pulo / pulo duplo / wall jump (regras de partida) | squash curto na decolagem e no pouso; no pulo duplo, pernas encolhem; no wall jump, braço estica para a parede |
| Mirar | a cabeça fica presa ao olho: o tronco não leva o pitch, a cabeça gira até 0,6 rad em pé (0,1 agachada) e os braços e a arma levam o resto |
| Agachar | postura P4f de 2.1, com transição de 120 ms (a sim troca no tick e o render mistura) |
| Recarregar | o braço desce e o pente sai como peça separada |
| Levar dano | tranco de 80 ms, piscada branca de 1 frame e expressão "dor" |
| Morrer | ver 4.6: as partes se soltam e quicam; somem em 4 s |
| Nascer | as partes caem do alto e se encaixam em 0,4 s |
| Emotes (depois do MVP) | as 42 comemorações e os 7 tiques do FutBobo (M2, com o contrato de emote no `ActorBuffer`); 4 poses fixas no online |

Por cima da pose base entram as camadas do FutBobo (respiração, passada, molas, freada, achatamento, tranco de dano e piscada), dentro de um **envelope medido**: cabeça e tronco ficam a no máximo **1 px da pose base em regime** (média de 0,3 s) e **2 px no pico** (até 0,3 s), para a pose continuar sendo a hitbox. Os ganhos finais ficaram abaixo dos iniciais do plano (o envelope manda): mola de arranque ±0,072 rad (FutBobo ±0,3), balanço lateral ±0,036 (±0,25), inclinação na curva ±0,04, achatamento −9%..+7%, coice do tiro 1,6. Passa a 30, 60 e 144 Hz (pior regime 0,98 px a 240 Hz; pico 1,86 px, "arrancar e parar"). Medido no centro das caixas: nas quinas da cabeça o pico vai a 2,2 px e o regime a 1,2 px. Giro preguiçoso: a raiz segue o yaw da sim e as pernas atrasam até 0,35 rad. Recarga: `reloadNeckX` 0,17 (era 0,35) e a respiração some durante ela, para a cabeça ficar a 0,68 px da base. Arma de 3ª pessoa: o cano fica na mira em todo pitch (a orientação vem da moldura da mira); a mão E pode ficar até 1,53 px fora da telha com o motor ligado e 1,63 px no deslize com a sniper (aceito e relatado).

### 2.6 Render dos bobos [PADRÃO]
- **Um `InstancedMesh` para todos os bonecos (R4c):** **1 draw por vista** para bonecos, zumbis e manequins (eram ~7), mais 1 por modelo de arma e por tipo de acessório 3D visível, no programa 4: um cubo unitário instanciado, **uma instância por caixa** (14 do corpo + 0 a 28 de cabelo; média de 17,75 nos 8 visuais do teste). Não depende de leitura de textura no vertex shader e não cria programa, atributo nem uniform.
- Cada caixa tem 24 vértices e 12 triângulos: **boneco completo ≈ 213 triângulos** em média (conta), sem a arma. Não há LOD de malha. O **LOD do rig** (2.5) alterna a taxa de pose além de `figureNearM` (20 m no Switch e no celular, com meia taxa; 40 m no PC) e congela o que está fora das vistas. A camada externa de capacete (reserva da rodada 3) some além da distância do perfil.
- Atributos por instância: matriz do osso (3 × 4, px → mundo), a 4ª linha (céu, sol, emissivo, expressão + flash) todo quadro; camada, UV da caixa, centro, tamanho e giro da ponta do cabelo só em evento.
- **Sombra:** o blob do programa 5, 0,875 m × escala; não há a sombra projetada da cabeça no peito.
- **Desmonte:** 6 grupos de ossos (cabeça com cabelo, tronco, braços e pernas) viram corpos Verlet, com a dobra do cotovelo e do joelho; os cubinhos do acerto usam o texel da caixa atingida.
- **Sem contorno de time** [DECIDIDO #50]: o casco invertido (faces de trás, 1 px de tela, 2 px no 3–4P) foi medido e mostrado no print de leitura e saiu inteiro do motor (geometria, desvio no shader e uniforms só dele). Os bonecos ficam em 1 `InstancedMesh` (fora a sombra).

### 2.7 Legibilidade em tela pequena [PROPOSTA]
| Elemento | Regra |
|---|---|
| Aliado | chevron e nome sobre a cabeça, sempre visíveis (inclusive através de parede), na cor do time |
| Inimigo | chevron só com linha de visão; além de 35 m no 3–4P, ou de 60 m em tela cheia, vira um ponto de 6 px sobre a cabeça |
| Contorno | não há (#50): o colete de time (≥ 35% da frente) e os marcadores fazem a leitura |
| Humano ou bot | plaquinha com ícone de controle (humano) ou de chip (bot), mais o ícone da personalidade |
| Jogador local (tela dividida) | anel no chão e borda da viewport na cor do jogador: P1 ▲, P2 ●, P3 ■, P4 ◆ (cores em 6.2) |
| Bobos-zumbi | silhueta e paleta próprias (ver 2.8), sem depender da cor de time |

"Marcadores de inimigo: sempre / com visão / nunca" é regra da partida; quem quer suar desliga.

### 2.8 Bobos-zumbi [DECIDIDO #31]
Mesmo boneco do FutBobo (as mesmas 14 caixas e a mesma tabela de pose, na postura 21), **curvado, esverdeado e engraçado**, nunca assustador.
- **Pose:** postura própria da tabela: tronco inclinado 0,35 rad (20°) para a frente, braços esticados à frente (−1,47 rad), pescoço −0,2; passada a 60% e cabeça balançando (`neckZ` 0,15·sen(fase)). A hitbox segue a curvatura.
- **Skin:** pele verde-acinzentada `0x8fae74` (rampa própria, fora das cores de time), branco do olho `#dcbc5a`, farda (woodland velho) 35% desbotada para `#8a8a86`, com a barra da jaqueta em dente e furos por hash no tronco (manga, antebraço e coxa rasgados nas colunas da farda, com a barra de pele no fim), mão nua, **remendos e curativos coloridos** no lugar de feridas. Sem vísceras, sem osso exposto.
- **Rostos próprios**, as 8 expressões pintadas na própria skin (camada 0): olho em espiral, olho caído, língua de fora, boca de "uuuh", costurado e dentes (lógica de `faces.ts` do FutBobo). No M1 só existe o `common`, com 1 estilo.
- **Tipos** [PROPOSTA; nomes em inglês bobo, #15, como em `gameplay.md` 7.4]: **comum**; **Sprinter** (skin de agasalho, anda curvado e rápido); **Chonker** (escala uniforme 1,3x, capacete de obra, barriga de gosma verde); **Spitter** (skin e pose próprias: bochechas cheias, inclinado para trás ao cuspir o projétil lento); chefão **Mega Bobo** (escala 1,8x, com placa de "chefe" pendurada). A escala é uniforme, então o pixel cresce junto e continua quadrado.
- Ao morrer, o zumbi desmonta como os bobos (ver 4.6).
- **Pendência do M3 (#53, #55):** o Chonker de escala 1,3x sobre o boneco de 1,75 m fica com 2,28 m visuais (conta; era 2,11 m sobre o bobo A e 1,95 m antes), acima da porta de 2,0 m (1,1x ainda dá 1,93 m). Rever a escala ou a porta dos mapas de Zombies. A escala é uniforme na raiz do render e da tabela, mas a hitbox do Chonker e do Mega ainda não escala (pedido de contrato aberto, M3).

---

## 3. Armas: caixas texturizadas

### 3.1 Estilo [DECIDIDO #10, #11, #15]
- **Baseadas em armas reais** (pistola, SMG, fuzil, escopeta, sniper…) com **nomes bobos em inglês e visual próprio**, sem marca registrada. Os nomes ficam na tabela de armas da frente de gameplay.
- Cada classe tem uma **silhueta que se reconhece em 1 segundo** e uma **faixa de destaque** de cor própria na textura [PROPOSTA].
- **Arsenal do MVP** [PADRÃO]: pistola, SMG, fuzil, escopeta, sniper, lança-foguetes, faca e granada (LMG de reserva).
- **Zoom (ADS) em todas as armas**; uma regra de partida desliga [DECIDIDO #11].
- **Bobo Paintball** usa os mesmos modelos com camadas de textura "brinquedo de tinta" (cores vivas, tanque de bolinhas), sem modelo novo [PROPOSTA].

### 3.2 Construção [PROPOSTA]
- **6 a 20 caixas** por arma, com textura 64×64 a 32 px/m (ver 1.2); cano pode ser um cilindro de 8 lados. Teto de **600 triângulos** por arma; a maioria fica abaixo de 300.
- **Peças separadas** para animar: corpo, pente, ferrolho/cão e acessório (luneta, bandoleira).
- **Soquetes** declarados no arquivo do modelo: `hand_r`, `hand_l`, `muzzle`, `mag`, `sight` (identificadores em inglês [PADRÃO]). O validador falha o build se faltar um obrigatório.
- **Mãos:** luvas de caixa na cor do time (ou do jogador no FFA), para você reconhecer seu time na própria tela.
- O mesmo modelo serve no mundo (escala real) e na 1ª pessoa.

### 3.3 Render e animação [PROPOSTA]
**Render**
- Passo próprio, depois do mundo, com a profundidade limpa: a arma nunca atravessa parede. Usa o programa instanciado (ver 1.10).
- FOV de viewmodel separado: padrão 60°, ajuste de 50° a 80°.
- No 3–4P, o viewmodel encolhe até ocupar no máximo 25% da viewport.
- Em **3ª pessoa** não há viewmodel: a arma aparece na mão do bobo, na escala do mundo.

**Animação** por molas, com parâmetros em JSON por arma:
- balanço ao andar e atraso ao girar (sway);
- coice;
- recarga: a arma inclina e o pente cai como peça física (vira cubinho de detrito ao tocar o chão);
- mira (ADS) com zoom de FOV.

**Opções:** modo canhoto (espelha), esconder viewmodel, reduzir balanço.

### 3.4 Retícula e feedback [PROPOSTA]
- **Retícula por arma**, que abre com movimento e com tiro.
- **Hitmarker:** branco no corpo, amarelo na cabeça, X maior na kill.
- **Indicador de dano direcional** na borda da tela.
- Retícula customizável: forma, cor, tamanho e contorno.

---

## 4. VFX

### 4.1 Tabela de efeitos [PROPOSTA]
| Efeito | Construção | Pool |
|---|---|---|
| Clarão do cano | sprite aditivo de 2 frames, brilho na arma e aumento da luz ambiente | por viewport |
| Traçante | quad aditivo esticado, 1 a cada 3 tiros (todos na SMG e no fuzil) | 128 |
| Impacto no cenário | 4 a 8 **cubinhos com a cor do texel atingido** (a CPU lê o pixel da textura 16×16 no ponto do acerto), nuvem de poeira e marca de tiro | cubinhos compartilhados: 200 a 500 (ver 1.12) |
| Marca de tiro | decal em quad instanciado, some em 20 s | 256 |
| Acerto em bobo | cubinhos com a cor do texel da skin atingido; resto depende da violência (ver 4.6) | pool de cubinhos |
| Explosão | esfera de cubinhos que cresce e some em 0,3 s, fumaça de cubos cinza subindo por 1,5 s, clarão e tremor de câmera | pools existentes |
| Granada / foguete | rastro de fumaça em cubos | pools existentes |
| Nascer | partes do bobo caindo e se encaixando (ver 2.5) | — |
| Zona do Bobo Royale | parede translúcida com faixas correndo no shader | 1 draw call |
| Tinta do Bobo Paintball | splat em decal na cor do time, com teto [PADRÃO] | 256 |
| Cápsula de bala | cubinho dourado com física balística, some em 2 s | pool de cubinhos |

- Cubinhos têm de 5 a 10 cm, **cor sólida por instância** (lida pela CPU no texel atingido) e luz amostrada, desenhados pelo programa instanciado (1.10) sem amostrar textura: com esse tamanho, textura não apareceria. É assim que o detrito leva "a cor/textura do alvo". Mesmo pipeline em `tecnico.md` 6.6.
- **Orçamento:** até 6 draw calls de VFX por viewport. Todos os pools são pré-alocados, sem alocação por frame.

### 4.2 Cenário estático [DECIDIDO #4]
- **O cenário não é destruído.** Paredes, vidros, caixas e placas ficam inteiros; o tiro só solta cubinhos cosméticos e deixa marca temporária.
- Como nada muda, chunks, colisão e navegação nunca são refeitos em partida.
- As barricadas e portas do Bobo Zombies são **entidades do modo** (tábuas que os zumbis arrancam e o jogador repõe), não cenário.

### 4.3 Câmera [PROPOSTA]
Tremor por evento, com teto e slider global de 0 a 100% (padrão 60%). Sem motion blur e sem aberração cromática.

### 4.4 Feedback de kill [PROPOSTA]
- **Kill:** som "PLOC", ícone no centro da tela por 200 ms e entrada no killfeed.
- **Headshot:** o chapéu ou o capacete voa como peça física, mais um "poof" de confete.

### 4.5 Reduzir efeitos [PROPOSTA]
A opção "Reduzir efeitos" corta o tremor, limita os clarões a no máximo 3 por segundo e reduz os cubinhos pela metade.

### 4.6 Violência configurável [DECIDIDO #9]
| Nível | Acerto | Morte |
|---|---|---|
| **Cartunesco (padrão)** | cubinhos na cor da roupa | o bobo **se desmonta**: as 6 partes se soltam e quicam, com "poof" de confete em cubinhos; tudo some em 4 s |
| Com sangue (opção nos ajustes) | cubinhos vermelhos e respingo em decal temporário | igual, com cubinhos vermelhos e uma mancha no chão que some em 10 s |

- Nenhum nível tem desmembramento detalhado, vísceras ou osso. Os bobos-zumbi seguem a mesma tabela.
- No online, cada jogador vê o próprio nível; é ajuste local, não regra da partida [PROPOSTA].
- Motivo do padrão: o site é público e crianças vão jogar.

---

## 5. Mapas e temas visuais

### 5.1 Construto, o mapa 1 [DECIDIDO #20]
Sala de teste, homenagem ao gmod sem copiar o mapa. Serve para Bobo Warfare TDM e FFA, cena-vitrine e testes de desempenho; já vem com os pontos de Domination marcados [PADRÃO].

Proposta visual [PROPOSTA]:
- **Área jogável de ~72×72 m** e até 12 m de altura (3 níveis: chão, mezanino, telhados), **dentro de uma grade de 80×80×24 m** (com a borda externa e folga de altura). É o mesmo tamanho do `tecnico.md` 5.3 e 24.1 e do GDD 4.6.4. Maior linha de visão declarada: **50 m**, para rodar igual no Switch 3–4P.
- **Chão de placas de teste** cinza-claro com a grade de 0,5 m pintada (material modular, bevel de 1 px) e faixas amarelas de circulação; a cada 4 m, um bloco com número de setor.
- **Paredes de teste** em concreto e painel laranja com réguas de medida (1 m, 2 m), que ajudam a ler distância e altura.
- **Prédios de teste**: cubos de concreto com portas de 1,0 × 2,0 m e janelas, um galpão fechado (luz de céu e emissivos no interior), uma torre de 8 m com escada e rampa 1:2, passarelas de grade cutout.
- **Borda externa** de grama e terra com mato em cruz e árvores de bloco, morros no anel de silhueta.
- **Props militares genéricos**: caixotes, sacos de areia, barris cilíndricos, holofotes, um jipe low-poly, tendas de lona, cubos de medida de 1 m.
- Paleta neutra (cinza, laranja de segurança, verde-oliva) para que times e VFX dominem a saturação.

### 5.2 Cena-vitrine (M1) [PROPOSTA]
Um canto de ~32×32 m do Construto que contém **todas as famílias de arte** de uma vez. É a mesma cena do Teste Zero [DECIDIDO #23].

| Família | O que aparece na cena |
|---|---|
| Blocos contínuos | grama (3 variantes), terra, concreto liso, água rasa (na bancada de materiais) |
| Blocos modulares | placas de teste, caixotes, painel metálico, tijolo |
| Formas do catálogo (no chunk) | rampa 1:2, laje, cerca cutout, mato em cruz |
| Props instanciados | tanque e canos cilíndricos, barris, lona de tenda, sacos de areia arredondados, jipe low-poly, holofote |
| Translúcido e emissivo | janela de vidro (na bancada de materiais), painel luminoso, emissivo do holofote |
| Interior e exterior | metade dentro do galpão, metade a céu aberto |
| Bobos | 6: 3 skins prontas, 2 com colete de time (A e B), 1 bobo-zumbi |
| Armas e VFX | pistola, fuzil e sniper em viewmodel; tiro, impacto, detrito e morte cartunesca |
| Luz | Dia, Entardecer e Noite |

**Bancada de materiais:** o vidro e a água rasa só existem numa bancada de teste **fora da área jogável** do Construto (atrás do limite do mapa, visível para os prints e para a medição). O Construto jogável do M2 segue a regra da `gameplay.md` 8.1 e 3.4: sem vidro e sem água [PADRÃO].

**Prints para o Erick aprovar** (sempre da mesma câmera fixa):
1. Dia, Entardecer e Noite, em 1280×720.
2. **Densidade de textura:** bobo e parede de perto (1 m e 3 m) com skin 64×64 e com uma skin de teste de densidade dobrada, para confirmar o pixel do boneco 2× maior que o do cenário. **Escolhida a dobrada (#51)**; o print agora reconfirma o grão do `expandSkin`.
3. **Peças fora da grade:** a mesma vista em três versões: só blocos, com a quantidade proposta e com o dobro. **Escolhido o dobro (#52)**: as 33 props do Construto colidem, param bala, tapam a visão dos bots, entram na navegação e acendem luz. A chave `propDose` ficou só visual, para A/B de custo no bench; o conjunto saiu dos prints.
4. **Leitura:** bobos a 5, 15, 30 e 50 m numa viewport de 640×360, com e sem contorno de time, também em escala de cinza. **Sem contorno (#50)**; bobos um pouco mais altos (#53). Fica a leitura em cor e cinza, mais uma a 50 m com o atlas do plano B.
5. **Filtro:** `NEAREST_MIPMAP_LINEAR` contra `LINEAR_MIPMAP_LINEAR` no chão ao longe. **Aprovado o `NEAREST_MIPMAP_LINEAR` (#50)**; as três luzes também.
6. **Fontes (#54):** a folha das fontes em uso e o HUD visível, em 1280×720 e 640×360.
7. **Altura (novo, #53):** a régua `print:altura` de perfil (porta, muro de 1,5 m, cobertura de 1,0 m, um manequim em pé e um agachado), em 1280×720 e 640×360, com as variantes A (1,625 m, o bobo antigo), B (1,75 m, a escolhida #55, no código) e o "antes" (1,5 m). Depois do port a régua ganhou o manequim `altura:deslizando` e a vista `print:altura-45`. As faces da frente das paredes e a face de fora da cabeça dos manequins ficam no mesmo plano, sem paralaxe, e o fundo é liso.
8. **Título:** a tela de título da web em 1280×720 e 640×360 e a do Switch (com os 9 itens de teste) em 1280×720.
9. **Números de setor (novo, revisão):** na altura do olho, o 9 da passagem leste do muro meio | sul visto do sul e o 6 logo ao norte visto do norte (girado 180°), mais o 4 e o 5 lado a lado, em 1280×720. O marcador fica no chão e é lido de qualquer lado: o 6 e o 9 levam um sublinhado que marca o lado de baixo do número [PROPOSTA, para o Erick conferir].

Os números seguem os do roteiro (`apps/web/scripts/prints-plan.ts`) e os nomes dos arquivos (`6-fontes-*`, `7-altura-*`, `8-titulo-*`); o 3 (doses) e o 5 (mip) ficam aposentados para os nomes continuarem comparáveis entre rodadas.

**Aceite:** prints aprovados; PC com GPU integrada a 60 FPS; Android de entrada (4 GB) a pelo menos 30 FPS; a mesma cena no Switch real com 4 viewports e bots burros a pelo menos 30 FPS, com memória medida [DECIDIDO #23].

### 5.3 Mapas do MVP e cardápio de temas
**MVP** [PADRÃO]: Construto (arena média) + 1 arena pequena para X1, Bobo Training e o Testar do Laboratório: o **Ringue** (nome provisório), arena de treino de ~36×36 m com alvos e estandes, com o mesmo kit do Construto [PROPOSTA].

**Cardápio para depois do MVP** [PROPOSTA, nomes provisórios]. Todos seguem o tom militar cartunesco genérico [DECIDIDO #19] e a diretriz de 5.4.

| Tema | Clima visual | Modos naturais | Assinatura |
|---|---|---|---|
| Base Abandonada (noite) | base militar cartunesca cercada, com janelas para barricar e áreas que abrem por portas pagas: refeitório, garagem, torre de rádio | Bobo Zombies (M3) | holofotes varrendo a cerca |
| Base Bobo | base militar cartunesca com hangar e pista | Bobo Warfare, BoboStrike | avião de carga de caixas |
| Galpão de Paintball | interior com infláveis coloridos e luz de galpão | Bobo Paintball, TDM, FFA | obstáculos infláveis |
| Canteiro de Obras | andaimes, guindaste, vigas (verticalidade) | TDM, FFA, Domination | guindaste com caixote pendurado |
| Ilha Tropical | praia, vila genérica, morro, farol | Bobo Royale Mini 24 (mapa de ~200 m) [DECIDIDO #35] | farol |
| Estação Lunar | baixa gravidade, neon | Bobo Chaos | a Terra no céu |

Cada tema tem 1 a 3 conjuntos de camadas de bloco próprios, presets de céu, fog e LUT para Dia, Entardecer e Noite, e 2 ou 3 props-assinatura. Com grade de 0,5 m, o mapa de ~200 m do Royale Mini cabe no celular (~400×400×64 blocos, só chunks não vazios na memória) [PROPOSTA].

### 5.4 Diretriz de conteúdo sensível [PADRÃO]
Vale para mapas, skins, armas, nomes gerados e textos.
- **Nada de:** escolas, hospitais, templos, lugares reais (cidades, bairros, monumentos), bandeiras, exércitos, uniformes ou insígnias reais, marcas reais (inclusive de armas).
- **Também fora** [PROPOSTA]: símbolos políticos, religiosos ou de ódio; o emblema da Cruz Vermelha (é protegido; o socorrista usa outro símbolo); civis como alvo (não existem NPCs civis); zumbis grotescos.
- Placas do cenário: pictogramas e palavras genéricas em pt-BR (ver 1.3).
- Nomes que chegam de outras pessoas: nome de jogador até 16 caracteres; nome de bot e de preset até 24 (`gameplay.md` 10.8); filtro simples local [PADRÃO]. A sala não tem nome, só um código de 5 caracteres.
- Toda arte nova passa por este checklist junto com os prints de aprovação.

### 5.5 Regras de legibilidade dos mapas [PROPOSTA]
- Paredes e chão em valores médios e com pouca saturação.
- A cobertura tem um tom diferente do chão, para o jogador ver de longe onde se esconder.
- Rotas principais são mais claras que os becos.
- Pontos de interesse (ponto de Domination, bombsite, caixa misteriosa, arma na parede, barricada) levam **emissivo e ícone**, sem depender só de cor.
- Material que não bloqueia bala (se a frente de gameplay criar algum) tem visual claramente diferente (cutout ou translúcido).

### 5.6 Fundo do menu: modo vitrine [PROPOSTA]
- O título mostra uma partida de verdade entre bots no Construto, que só carrega **depois** que o menu já está interativo.
- No celular fraco e no Switch, o fundo é uma cena parada com bobos posando.

### 5.7 Construção dos mapas
- **Kit modular** em grade de 4 m (8 blocos): paredes, portas, janelas, escadas, rampas e telhados que encaixam entre si [PROPOSTA].
- **Montagem:** cada mapa é um **script TS** com a API de construção (`box`, `ramp`, `fence`, `prop`, `spawn`, `door`…), compilado pelo `tools/mapc` (`tecnico.md` 15.1). O **editor interno** (`tools/mapview`) só ajusta marcadores, nós de IA e câmeras; é ferramenta de desenvolvimento, nunca para jogadores [DECIDIDO #36].
- **Decoração procedural** com semente: mato em cruz, sujeira (variantes de camada), árvores de bloco [PROPOSTA].
- **Build:** o `mapc` grava o `.bfmap` em binário próprio com RLE + deflate (fflate) [PADRÃO]: grade, instâncias de props, marcadores e navegação. **A malha dos chunks e a luz (AO, sol, céu, emissivo) são montadas no loading**, no cliente; pré-malha no build só se o Teste Zero pedir (`tecnico.md` 6.2 e 15.4).
- Contas desta frente usam chunk de 32³ blocos (16 m de lado); o número final é da frente técnica.

---

## 6. UI e menus

### 6.1 Arquitetura [DECIDIDO #3]
**Renderização**
- Menus, Laboratório e HUD são desenhados pelo jogo em **WebGL**, também na web, sem React e sem DOM no fluxo. É o programa 7 (ver 1.10).
- **Texto em MSDF** [PADRÃO]: atlas gerado no build a partir das fontes OFL, com Latin-1 + Latin Extended-A (cobre o pt-BR), sem depender de `FontFace`. Canvas 2D num `OffscreenCanvas` é só plano B, validado no Teste Zero [TZ].
- Painéis, botões e barras são quads com cantos em SDF no mesmo programa: 1 ou 2 draw calls por viewport.

**Layout** [PROPOSTA]
- **Espaço lógico de 1280×720**, com âncoras e área segura, escalado para a janela. É a saída do Switch [PADRÃO: 720p fixo].

**Navegação**
- Toda tela funciona com **controle, mouse e toque**.
- O foco visível é um contorno de 2 px na cor "ação" mais o chanfro aceso (ver 6.2) [PROPOSTA].

**DOM na web: só na casca, em quatro usos** (mesma lista no GDD 6.6 e no `tecnico.md` 9)
- A casca de carregamento (logo e barra de progresso, até 15 KB), que também vira a página de aviso sem WebGL2 [DECIDIDO #3].
- Um `<input>` escondido para digitar nome, código ou texto do Laboratório [DECIDIDO #3].
- Um `<input type=file>` escondido para importar backup [PADRÃO: exceção técnica da casca, fora da UI; registrada no `DECISOES.md` como "DOM na web (exceção da #3)"].
- Um link de download (Blob) para exportar backup e baixar o relatório [PADRÃO: idem].

**No Switch:** teclado na tela desenhado pelo jogo, mais um botão de "nome aleatório". Se o nx.js expuser o teclado do sistema, ele vira opção [TZ].

### 6.2 Design system: tudo escuro [DECIDIDO #22]
Linha do futbobo (editorial escuro, sério, estilo militar), com **tokens próprios** do BoboForces. O arquivo `.interface-design/system.md` segue o padrão EriLab: Direção, Assinaturas, Tokens, Tipografia, Movimento e Componentes.

**Direção:** painel de comando de um quartel de brinquedo. O mundo é colorido; a interface é escura e contida, para nunca competir com o jogo.

**Assinaturas** [PROPOSTA]
- **Chanfro de 45°** (6 px) no canto superior direito de cards e botões, como placa militar.
- **Faixa zebrada** (âmbar e escuro, diagonal) só em avisos e no botão de sair da partida.
- Rótulos de seção em caixa alta condensada com espaçamento largo.
- O logotipo em blocos (ver 11.2) é o único elemento "pixel-art" da interface; ícones são pictogramas simples de traço reto.

**Tokens** [PROPOSTA]

| Token | Hex | Uso |
|---|---|---|
| `bunker` | `#0A0D0B` | fundo das telas |
| `chapa` | `#121815` | cards e painéis |
| `chapa-alta` | `#1A221D` | elementos elevados, item com foco |
| `linha` | `#2A352E` | bordas de 1 px e divisórias |
| `texto` | `#E8EDE6` | texto principal |
| `texto-baixo` | `#9DA89F` | texto secundário |
| `acao` | `#F2B233` | botão primário, foco, seleção |
| `perigo` | `#EF5B4C` | vida baixa, avisos, sair |
| `ok` | `#6FCF7A` | confirmação, pronto |
| `hud-fundo` | `#0A0D0B` a 70% | fundo das plaquinhas do HUD |
| Times A / B / C / D | `#FF7A1A` ▲ / `#2E8BFF` ● / `#3DDC97` ■ / `#A66BFF` ◆ | sempre com o ícone |
| P1 / P2 / P3 / P4 | `#FFD23F` ▲ / `#3FE0FF` ● / `#FF6FB5` ■ / `#B8F03C` ◆ | jogadores locais |

Laranja contra azul é o par mais seguro para daltonismo vermelho-verde; C e D sempre aparecem com ícone e com o padrão no colete. Os modos daltônicos (ver 8) trocam esses hex sem mexer em malha: a cor do time vem de uniform e da skin composta.

**Tipografia** [DECIDIDO #54]
- Duas fontes OFL, até 120 KB no total, aprovadas por print: **Russo One** (display: títulos e botões, só caixa alta) e **Saira Condensed SemiBold** (HUD, rótulos e textos de leitura).
- No jogo vai só o atlas MSDF `fonts/ui-fonts.{png,json}`, com nomes derivados SEM o Reserved Font Name: **"BoboForces Display"** (Russo One 1.001 a 22 px, 118 glifos: ASCII sem minúsculas, À–Þ, ¡ª«°·º»¿, NBSP e os extras) e **"BoboForces HUD"** (Saira Condensed SemiBold 0.072 a 20 px, Latin-1 + extras, 200 glifos, camada em 7 bits por canal). Altura de maiúscula e de x vêm do OS/2; a linha é base + a descida medida nos glifos entregues. O fontbake reprova nome derivado que contenha um RFN (name ID 0 e cabeçalho do `OFL.txt`).
- **Teto de 120 KB, como lido [decisão menor revisável, não está na DECISOES]:** bytes BAIXADOS do atlas, PNG cru + JSON em gzip, o critério do `size-check` (sub-orçamento "Fontes" dentro do menu), com o JSON medido no gzip nível 4, um limite de cima do que o GitHub Pages serve (ele não serve gzip -9: +4,8% no JSON das fontes do M0). Medido: 111.895 + 7.710 = **119.605 B** (folga calibrada de 395 B; kerning a partir de 0,25 px). Os TTF de origem (135,2 KB) não vão no build. Reserva se apertar: HUD em 6 bits por canal (−5,9 KB).
- A tela de comparação das candidatas virou a **folha das fontes em uso** (`drawFontSpecimen`, gancho `showFontSpecimen`): origem de cada fonte, logo, título com acentos, botões, HUD de amostra, texto corrido e algarismos.
- No título do Switch, com mais de 4 itens de teste, a coluna vira uma grade de 2 colunas (330 px, botões de 48 px) embaixo à direita, acima da versão; os rótulos usam as chaves curtas `test.item.*`. O nome do mapa no loading encolhe para caber, sem descer do piso de leitura.

**Movimento** [PROPOSTA]
- Entradas curtas e secas: 120 a 180 ms, ease-out, deslizando 8 px. Nada de mola de brinquedo.
- Nada de animação no HUD além do pulso de dano.
- Respeita a opção "Reduzir efeitos". Na web, a casca lê `prefers-reduced-motion` e o repassa via `Platform` como valor inicial desse ajuste; o pacote `ui` só lê o ajuste.

### 6.3 Fluxo de telas na web [PROPOSTA]
Mesmo fluxo do GDD 3.4.
```
Casca HTML (logo + barra) → TÍTULO
TÍTULO: [ JOGAR ] (mostra o último preset) · [Surpreenda-me] · [Mudar]
  │ o clique em JOGAR destrava o áudio e pede o pointer lock
  ├─ JOGAR → Carregando (meta ≤ 2 s com cache) → PARTIDA
  ├─ Surpreenda-me → card do sorteio (Rolar de novo · Jogar) → PARTIDA
  └─ Mudar → MENU PRINCIPAL
MENU PRINCIPAL: Partida Rápida · Modos · Laboratório · Meu Bobo · Ajustes · Novidades
  (+ Online no M5; + Aquário no M6+)
  Partida Rápida → modo, mapa, nível, bots → COMEÇAR
  Modos → grade de cards (ícone + até 7 palavras) → CONFIGURAR PARTIDA → COMEÇAR
  Laboratório → Oficina (biblioteca de bots) → editor (4 eixos + visual) → Testar (Bobo Training no Ringue) · Salvar
  Online (M5) → Criar sala | Entrar com código | Link → LOBBY DA SALA
PARTIDA → Pausa (Continuar · Ajustar desafio · Ajustes · Destravar · Sair)
        → RESULTADO: [De novo] (foco padrão) · Mais fácil · Mais difícil · Mudar regras · Salvar preset · Sair
```
Cada item de menu só aparece quando o marco dele chega; nada de botão "em breve". Depois de uma derrota feia, o foco do resultado vai para **Mais fácil** (`gameplay.md` 11).

**Configurar partida** tem 3 camadas, que se abrem conforme o jogador quer mais controle:
1. **Rápido:** modo, mapa, dificuldade rápida, quantidade de bots e duração. A dificuldade tem 5 níveis: *Pela vibe · De boa · Normal · Suado · Tryhard* [DECIDIDO #21].
2. **Regras:** mutadores (vida, munição, gravidade, movimento, marcadores, alcance de visão, ADS…).
3. **Laboratório:** sliders dos 4 eixos (inteligência, habilidade, personalidade, regras) mais o visual, **um bot por vez**; cada time recebe bots por quantidade ou por mistura em porcentagem, e as regras podem valer para o time inteiro ou para um bot (esquadrões só no M6+) [DECIDIDO #29].

O botão COMEÇAR fica fixo no canto nas três camadas.

**Ajustar desafio na pausa:** muda a dificuldade dos bots no meio da partida. No offline, sempre. No online, abrir o menu não pausa nada; só o host pode pausar (e só no coop) e só ele ajusta o desafio.

**Resultados:** estatísticas, recordes e até 3 **prêmios bobos** ("Mais covarde", "Imortal de verdade", "Mira torta"). Sem XP e sem desbloqueio [DECIDIDO #16]. No online, os prêmios zoam só bots ou são neutros para humanos.

### 6.4 Partida Rápida e presets [PROPOSTA]
| Situação | Interações até o primeiro tiro |
|---|---|
| Web, jogador que volta | **1** (JOGAR usa o último preset) |
| Web, primeira vez | **1** (partida de estreia: Bobo Warfare TDM 4v4 no Construto, você + 3 bots aliados contra 4 bots, todos em **De boa**, 5 min ou 30 kills) |
| Web, outro modo | **3** (Mudar → card → COMEÇAR) |
| Surpreenda-me | **2** (botão → confirmar o sorteio) |
| Switch | **2** (P1 aperta A no lobby → + ou A em COMEÇAR) |
| Revanche | **1** (De novo) |

- A primeira partida é sempre em **De boa** [DECIDIDO #21].
- Um preset guarda modo, mapa, variação (dia/entardecer/noite), regras, times e bots, condição de vitória e seed.
- Os 5 últimos ficam salvos sozinhos; até 200 presets salvos na web e 50 no Switch; até 6 favoritos viram atalhos na Partida Rápida (GDD 4.8).
- Formato `format: 'boboforces/preset@1'`, versionado e com migração [PADRÃO].
- **Compartilhar** (Oficina com códigos, M6+): código `BFP1-…` ou link `#p=` para preset, `BF1-…` ou `#bot=` para bot [PADRÃO]. O hash não vai para o servidor.
- No Switch, presets e bots entram e saem como JSON em `sdmc:/switch/boboforces/` [PADRÃO]: o que foi criado no PC chega pelo cartão SD.

### 6.5 Switch "LOCAL EDITION": o lobby é a tela inicial [PROPOSTA]
```
BOBOFORCES  LOCAL EDITION
┌ P1 ▲ ───┐┌ P2 ● ───┐┌ P3 ■ ───┐┌ P4 ◆ ───┐
│ Erick   ││ A para  ││ A para  ││ A para  │
│ [ctrl]  ││ entrar  ││ entrar  ││ entrar  │
└─────────┘└─────────┘└─────────┘└─────────┘
ÚLTIMA: Bobo Zombies · Base Abandonada · Noite · 24 zumbis · Suado
[ + COMEÇAR ]  [ Y Modos ]  [ X Surpreenda-me ]
Pressione A para entrar · Até 4 controles
```

**Abertura e slots**
- Abre direto no lobby, sem tela de título. A marca fica no topo.
- Cada slot tem perfil local (nome, cor, sensibilidade, mira assistida, inverter Y, botões), escolhido pelo próprio controle.
- **Controle completo por jogador**: par de Joy-Con ou Pro Controller [DECIDIDO #32]. O slot mostra o glifo genérico do controle detectado (ver 6.11).
- Só o P1 navega nos menus globais. B tira o jogador do slot.

**Ciclo de vida** [PADRÃO]
- \+ começa a partida e, durante ela, pausa todo mundo (a simulação é compartilhada). O + do 1º controle fecharia o app: o jogo intercepta com `beforeunload` [C]. Sair só pela opção "Sair do jogo".
- Pausa automática ao trocar dock/portátil, ao desconectar um controle ou ao voltar do HOME. Os slots são reatribuídos na tela "aperte A".

**Entrar no meio da partida:** segurar A por 1 s num controle livre abre "Entrar como P3?". Confirmando, o jogador assume um bot do time.

**Modos do lobby** (mesma lista em `gameplay.md` 12): Bobo Zombies · Bobo Warfare (TDM, FFA, X1, 2v2) · Bobo Training · Surpreenda-me · COMEÇAR (último preset). **Nada de online aparece no Switch**: 100% offline [DECIDIDO #1].

### 6.6 Tela dividida [PADRÃO]
| Jogadores | Layout | Viewport (em 1280×720) |
|---|---|---|
| 1 | tela cheia | 1280×720 |
| 2 | horizontal (cima/baixo); vertical como opção | 1280×360 ou 640×720 |
| 3 | 2×2; o 4º quadrante mostra placar e minimapa | 640×360 |
| 4 | 2×2 | 640×360 |

- Também **na web do PC** com controles [DECIDIDO #24]; teclado e mouse contam como 1 slot.
- Cada viewport tem uma borda de 3 px na cor do jogador [PROPOSTA].
- **Informação compartilhada** (onda, tempo, placar) é desenhada uma vez só, no cruzamento central [PROPOSTA].
- O HUD de cada viewport é escalado por `min(vw/1280, vh/720)`, com piso para o texto não ficar abaixo do mínimo de 6.8 [PROPOSTA].
- **2P horizontal** (32:9 por viewport): mantém o FOV vertical e limita o horizontal a 110°. **2P vertical** (8:9): mantém o FOV horizontal em 80° [PROPOSTA].

### 6.7 HUD [PROPOSTA]
| Elemento | Posição | 1 viewport | 3–4P |
|---|---|---|---|
| Retícula e hitmarker | centro | sim | sim |
| Vida (barra e número) | canto inferior esquerdo | sim | só o número e uma barra fina |
| Munição (pente/reserva) e arma | canto inferior direito | sim | só o pente |
| Granadas | junto da munição | ícones | 1 ícone |
| Killfeed | canto superior direito: 4 linhas, 4 s | sim | 2 linhas compartilhadas no cruzamento central (`gameplay.md` 10.6); cada viewport mostra só as próprias kills sob a retícula |
| Placar e tempo | topo, no centro | sim | no centro compartilhado |
| Dano direcional | bordas | sim | sim |
| Indicador visual de som | anel em volta da retícula | opcional | opcional |
| Avisos ("Segure X para reviver") | abaixo da retícula | sim | sim, em 1 linha |
| Minimapa | canto superior esquerdo, opcional | depois do MVP | no 4º quadrante do 3P [PADRÃO] |

Extras por modo: **Bobo Zombies** (onda, pontos, preço do item na mira), **Bobo Royale** (vivos, tempo da zona), **BoboStrike** (dinheiro, round, bomba), **Domination** (estado dos pontos com ícone e letra).

### 6.8 Legibilidade no celular e na TV [PROPOSTA]
| Contexto | Texto mínimo | Números críticos | Alvo de toque |
|---|---|---|---|
| Celular (CSS px; paisagem ~844×390) | 13 px | 22 px | 44 px nos menus (regra EriLab); 64 a 80 px nos controles da partida |
| TV / Switch na dock, tela cheia (px em 720p) | 22 px | 32 px | — |
| Switch 3–4P, por viewport | 16 px | 22 px | — |
| Switch portátil | 18 px | 26 px | — |

- O MSDF mantém o texto nítido em qualquer escala; os mínimos acima valem depois da escala do HUD.
- Na TV, margem de segurança de 5%. No celular, `viewport-fit=cover` e safe-area.
- No celular, sempre em **paisagem**, com o aviso "Gire o celular" [PADRÃO].
- iPhone/iPad funciona com limitações conhecidas [DECIDIDO #26]: sem tela cheia de verdade no iPhone [C]; o jogo sugere "Adicionar à Tela de Início" (`display: fullscreen` no manifest).

### 6.9 Texto e tom [PROPOSTA]
- Botão com até 3 palavras; título com até 7 (regra do gamebobo).
- Dicas de carregamento em 1 linha: "Bot covarde foge quando você recarrega."
- Mensagem de morte curta: "Jorge the Immortal te bobou."
- Sem parede de texto: "Se precisa de parágrafo, a mecânica está mal desenhada" (VISION do gamebobo).
- O humor é com o bot, nunca com o jogador humano.

### 6.10 Onboarding visual e dicas por dispositivo [PROPOSTA]
Nada de tutorial obrigatório. O jogo ensina na hora, com uma linha e o botão certo. É a mesma sequência do GDD 3.1 e da `gameplay.md` 2.5.
- **Detecção do dispositivo:** o último tipo de entrada usado (mouse/teclado, toque ou controle) escolhe o layout do HUD, os glifos das dicas e os padrões iniciais (mira assistida Média no toque e no controle, desligada no mouse). Se o jogador trocar de dispositivo, glifos e dicas mudam na hora.
- **Primeira partida:** a partida de estreia de 6.4 (Bobo Warfare TDM 4v4 no Construto, todos em **De boa**).
- **Calibrar mira (~10 s), na contagem da 1ª partida:** 3 alvos aparecem no Construto; o jogo mede se o jogador passa do alvo ou não chega, sugere a sensibilidade e mostra "Ajustei sua mira" com "Desfazer". "Pular" sempre visível; dá para refazer em Ajustes e no Bobo Training.
- **Celular, primeira vez:** 3 s de "fantasma" dos dedos mostrando as zonas (metade esquerda move, metade direita mira, botão ATIRAR).
- **Dicas contextuais** de 1 linha com o glifo do dispositivo ativo, nas 2 primeiras partidas, **cada uma no máximo 1 vez** e sem pausar: "Shift corre", "C agacha; correndo, desliza", "Botão direito mira com zoom", "R recarrega" (no controle e no toque, o mesmo texto com o glifo certo). Desligáveis em Ajustes. A derrota feia tem a própria linha, da anti-frustração (`gameplay.md` 11).
- **Apresentar o Laboratório:** no fim da 1ª partida, um card opcional "Conheça o Laboratório" mostra Jorge the Immortal com os 4 eixos e o botão **Testar** (Bobo Training no Ringue, em até 2 s). "Agora não" fecha e não volta.
- **Switch:** o lobby já é o tutorial (glifos de "A para entrar", "+ para começar"); a primeira partida mostra "Segure A para entrar no meio" para os controles livres.

### 6.11 Glifos de botão [PADRÃO]
- Glifos **genéricos desenhados pelo jogo**, por posição e cor, **sem logos de marcas**.
- **Botões de face:** um losango de 4 círculos com o botão da vez aceso. Dentro dele aparece a letra quando o controle é de uma família que imprime letras (A/B/X/Y na posição certa de cada família); controles de outras famílias e genéricos mostram só posição e cor. Nunca usar os símbolos △ ○ × □ nem nomes de marca.
- **Ombros e gatilhos:** silhuetas de ombro (retângulo fino) e gatilho (forma curva), com o lado indicado pela posição; no Switch, com as letras L, R, ZL e ZR.
- **Analógicos:** círculo com seta; clique do analógico com um ponto central.
- **Teclado:** tecla desenhada com a letra; **mouse:** silhueta com o botão aceso; **toque:** o ícone do próprio botão da tela.

### 6.12 Novidades, dados e relatório
- **Tela de Novidades** [PADRÃO], como no futbobo ("sem parede de patch note"): codinome da versão e até 5 itens de 1 linha. Aparece uma vez depois de atualizar e fica no menu.
- O service worker só aplica atualização no menu [PADRÃO]. Quando bots ou presets salvos forem migrados de formato, a Novidades avisa em 1 linha ("3 bots atualizados para o formato novo").
- **Ajustes › Dados** [PADRÃO]: "Exportar backup" e "Importar backup" em arquivo, com aviso de que limpar os dados do navegador apaga bots e presets.
- **Ajustes › Sobre** [DECIDIDO #42]: botão "Copiar relatório" (versão, GPU, perfil, últimos erros). No Switch, o mesmo conteúdo vai para `runtime.log` no SD. Nenhuma coleta.
- **Online (M5)** [PROPOSTA]: as telas de criar e entrar em sala mostram um aviso de privacidade de 1 linha (a conexão P2P mostra seu IP para quem está na sala), com link para o texto completo. Sem chat livre; só pings e emotes [PADRÃO].

---

## 7. Controles
Toda entrada passa por uma camada de **ações** gravável, remapeável e separada por jogador (regra EriLab de entrada como ações gravadas).

### 7.1 PC: teclado e mouse [PADRÃO + PROPOSTA]
| Ação | Tecla |
|---|---|
| Mover / mirar | WASD / mouse |
| Atirar / mirar (ADS) | botão esquerdo / botão direito |
| Pular | Espaço |
| Agachar (correndo: deslizar) | **C** [PADRÃO]; Ctrl fica livre para não virar Ctrl+W |
| Correr | Shift |
| Recarregar | R |
| Armas do loadout / arma anterior | 1–4 / Q |
| Granada / interagir / faca | G / E / V |
| Placar / pausa | Tab / Esc |
| Debug | F2 |

- O pointer lock é pedido no clique, com `unadjustedMovement`; se o navegador recusar, cai para o modo normal [C].
- O Esc é engolido pelo pointer lock: a pausa vem do evento `pointerlockchange` [PADRÃO]. No solo, a partida também pausa quando a aba fica oculta [PADRÃO].
- Fechar a aba no meio da partida pede confirmação (`beforeunload`) [PROPOSTA].

### 7.2 Controle na web e no Switch [PROPOSTA]
Os botões são definidos pela **posição** no controle, não pela letra.

| Ação | Botão |
|---|---|
| Mover / mirar | analógico esquerdo / analógico direito |
| Atirar / mirar (ADS) | gatilho direito / gatilho esquerdo |
| Granada / faca | ombro direito / ombro esquerdo |
| Pular | botão de baixo |
| Agachar / deslizar | botão da direita (ou clicar o analógico direito) |
| Recarregar; interagir segurando | botão da esquerda |
| Trocar de arma | botão de cima |
| Correr | clicar o analógico esquerdo (ou opção "sempre correr") |
| Direcional | ping e emotes |
| Botões de menu (− / +, Select / Start) | placar / pausa |

- **Confirmar e voltar dependem da família do controle:** no Switch, confirmar é o botão da direita e voltar o de baixo; nas demais famílias, confirmar é o de baixo. O glifo (6.11) sempre mostra a posição certa.
- **Analógicos:** zona morta de 0,15 e curva exponencial; aceleração de giro na borda; sensibilidade X/Y separada; inverter Y.
- **Vibração:** no Switch, `vibrationActuator.playEffect('dual-rumble')` por controle [C]; na web, onde o navegador suportar.
- No Switch, cada jogador usa **controle completo** (par de Joy-Con ou Pro Controller) [DECIDIDO #32].

### 7.3 Toque no celular [PROPOSTA]
**Layout**
- **Metade esquerda:** analógico virtual que aparece onde o dedo toca (raio de 60 px, zona morta de 8 px).
- **Metade direita:** arrastar para mirar. O botão ATIRAR, de 80 px, também mira enquanto o dedo arrasta.
- **Botões:** pular, agachar, recarregar, granada e ADS, com pelo menos 64 px, 12 px de espaço entre eles e 40% de opacidade. Para trocar de arma, toca-se no ícone dela.
- Margem morta de 24 px nas bordas (o mesmo valor do `tecnico.md` 10), para o gesto de voltar e o deslize da borda (Android e iOS) não tirarem o jogador da partida; se o jogo perder o foco, pausa no solo.

**Opções**
- **Atirar sozinho**: dispara quando a retícula passa sobre o inimigo.
- Mira assistida (ver 8).
- **Giroscópio**: opcional e **desligado por padrão** [PADRÃO]; o botão chama `requestPermission` dentro de um clique [C].
- Layout para canhoto.
- **Limitador 30/60 FPS** [PADRÃO], com 30 como economia de bateria e calor.
- Editor de layout (arrastar, escalar, opacidade): depois do MVP.

**Técnico:** `touch-action: none` e Pointer Events. No Android, vibração por `navigator.vibrate`. Só navegador, sem APK [DECIDIDO #37].

---

## 8. Acessibilidade [PROPOSTA]
| Área | Opções |
|---|---|
| Daltonismo | Padrão, Protanopia, Deuteranopia e Tritanopia: cada modo troca as cores de time (uniform e skin composta), sem custo de desempenho. Cor de inimigo escolhível entre 6. Times sempre com ícone (▲ ● ■ ◆) e colete com padrão. |
| Contorno | não há: o casco de contorno saiu no M1 (#50, ver 2.6) |
| Mira assistida | Desligada, Leve, Média ou Forte: a mira desacelera 25%, 40% ou 60% perto do alvo e puxa de leve; no Forte, trava ao mirar. O host do online pode limitar. |
| Câmera | 1ª ou 3ª pessoa [DECIDIDO #12]; FOV (PC 70–110, padrão 90; celular e Switch 70–100, padrão 80); FOV do viewmodel; tremor 0–100%; balanço ao andar; esconder viewmodel |
| Sensibilidade | separada para mouse, controle, toque e giroscópio; multiplicador de ADS; inverter Y |
| Botões | tudo remapeável; segurar ou alternar para correr, agachar e ADS |
| Texto e HUD | tamanho 100%, 125% ou 150%; opacidade do HUD; HUD de alto contraste; retícula customizável |
| Áudio | **indicador visual de som** (direção de tiros e passos até 20 m); **saída mono** [PADRÃO]; volume por canal; volume por jogador local no sofá |
| Fotossensibilidade | "Reduzir efeitos": no máximo 3 clarões por segundo e sem tremor |
| Violência | Cartunesco ou Com sangue (ver 4.6) |
| Desafio | a premissa do jogo: de "Pela vibe" a "Tryhard", com "alvos maiores" como regra e pausa a qualquer momento no offline |

---

## 9. Idioma [DECIDIDO #14, #15]
- **Só pt-BR.** Todos os textos ficam numa tabela de chaves (`strings.pt-BR.ts`, o mesmo arquivo do `tecnico.md` 3 e 15.2) desde o primeiro dia, para traduzir se um dia quiser.
- **Nomes de modos, armas e bots em inglês bobo** (Bobo Warfare, BoboStrike, Bobo Royale, Bobo Paintball, Bobo Zombies, Bobo Sandbox, Bobo Juggernaut, Bobo Chaos, Bobo Training). O resto da interface é pt-BR: "Surpreenda-me", "Partida Rápida", "Laboratório", "Aquário".
- Identificadores em inglês; textos, docs e comentários em pt-BR [PADRÃO].
- Atlas MSDF com Latin-1 + Latin Extended-A, para todos os acentos.
- Nenhum texto de interface fica gravado em textura. Placas do cenário são pictogramas ou palavras genéricas em pt-BR.

---

## 10. Áudio

### 10.1 Restrições
**nx.js**
- Tem AudioContext, AudioBufferSource, Gain e StereoPanner. **Não aparecem PannerNode, Oscillator nem filtros** [C].
- Decodifica MP3 via FFmpeg [C]. O formato único de áudio do jogo é **MP3** [PADRÃO].

**Web**
- O áudio só começa depois de um gesto do usuário [C]; o clique em JOGAR resolve.
- O áudio é retomado no `visibilitychange`. No iOS, há uma tela "toque para continuar" de reserva, por causa do bug do WebKit [C].

### 10.2 Espacialização própria, o mesmo código nas 3 plataformas [PROPOSTA]
- **Base:** volume por distância (curva por categoria de som) e pan estéreo pelo ângulo.
- **Duas amostras por arma, perto e longe**, trocadas além de 30 m. Fazem o papel do filtro passa-baixa que não existe no nx.js.
- **Oclusão barata:** −6 dB quando há parede entre a fonte e o ouvinte (DDA na grade de blocos), recalculado a 10 Hz.

### 10.3 Áudio no sofá
O som da TV é um só para até 4 pessoas.
- **Cada som usa o ouvinte local mais próximo**, com o volume e o pan desse jogador [PADRÃO].
- **Saída mono** como opção global [PADRÃO]. Com 3–4 jogadores, o pan cai para 50% por padrão, porque pan cheio confunde quem está do outro lado do sofá [PROPOSTA].
- **Volume por jogador local** [PROPOSTA]: cada perfil de slot tem o slider "meus sons" (minha arma, dano em mim, meus hitmarkers), para quem acha o próprio tiro alto demais sem baixar o dos outros.
- Com 3–4 jogadores, os sons "da própria arma" perdem 3 dB, para quatro armas tocando não virarem parede de ruído [PROPOSTA].
- A **vibração por controle** e o **indicador visual de som** por viewport compensam a direção que se perde [PADRÃO].
- No lobby, cada slot que entra toca um tom diferente (P1 a P4).

### 10.4 Mixagem e limites [PROPOSTA]
- **Canais:** Master, Música, Efeitos e UI. Não há canal de voz: os bots não falam [DECIDIDO #34].
- **No máximo 24 vozes simultâneas**, nesta prioridade: sua arma > dano em você > inimigos perto > aliados > ambiente.
- **Cooldown por som:** 12 bots atirando não viram 12 tiros tocando juntos.
- Só os passos dos 4 bots mais próximos de cada ouvinte tocam.
- A música abaixa 6 dB nas explosões.

### 10.5 Efeitos sonoros: cerca de 40 no MVP [DECIDIDO #39]
**CC0 de terceiros (ex.: Kenney) com crédito + sons sintetizados em código.** A síntese gera PCM em JS (no build ou no carregamento) direto num AudioBuffer, sem depender de Oscillator.

| Grupo | Itens [PROPOSTA] |
|---|---|
| Armas (8) | tiro de perto, tiro de longe, recarga, sem munição, troca; faca e granada com os seus |
| Impactos | um por família de material: concreto, madeira, metal, terra, vidro, bobo |
| Movimento | passos por material × andar/correr, pouso, deslize |
| Feedback | hitmarker "plic", headshot "PLOC", kill, levar dano, vida baixa |
| Mundo | explosão, porta, compra e início de onda (Bobo Zombies), grunhido cartoon de zumbi |
| UI | navegar, confirmar, voltar, entrar no lobby (tom por jogador) |

- MP3 mono, até 1,5 MB no total.
- A primeira partida na web traz só os **sons essenciais** (UI, 1 arma, impactos e passos), até 150 KB (`tecnico.md` 16.4); o resto carrega em segundo plano.
- Cada material de bloco declara sua família de som (passo e impacto).

### 10.6 Música [DECIDIDO #38]
- **CC0 provisória**, trocada depois.
- **Desligada por padrão durante a partida**, com opção de ligar; toca no menu, entre ondas e nos resultados [PADRÃO].
- Faixas [PROPOSTA]: tema do menu em loop de 60 a 90 s; Bobo Zombies em 2 camadas sincronizadas que se misturam pela intensidade da onda; vinhetas de vitória e derrota de 3 a 5 s. Clima: marcha de brinquedo, percussão militar leve.
- 90 s em estéreo a 96 kbps dão ~1,1 MB por faixa; a música sempre carrega depois do menu.

### 10.7 Sem falas [DECIDIDO #34]
Os bots não falam: sem voz, sem balão de texto, sem sílabas inventadas. A personalidade aparece na **expressão do rosto** (2.3), no comportamento e no ícone de personalidade da plaquinha.

---

## 11. Marca

### 11.1 Nome [PADRÃO]
- **BOBOFORCES** no logo; **BoboForces** no texto; **boboforces** em URL, repositório e pastas.
- O NACP do Switch usa o mesmo nome.

### 11.2 Logo: só logotipo em blocos [DECIDIDO #43]
- As letras **BOBOFORCES** são feitas de **blocos com textura pixel-art** (placas de teste do Construto com faixa laranja de segurança), desenhadas pelo próprio motor na tela de título, com a mesma luz e AO do mundo. Sem mascote.
- Derivados gerados no build [PROPOSTA], com um renderizador ortográfico simples em Node (como o `prepare-icon.mjs` do MMM [C]):
  - SVG de retângulos para a casca HTML e o favicon (monograma "BF" em blocos);
  - ícones do PWA em 192 e 512 (maskable);
  - ícone do Switch em JPEG 256×256;
  - imagem de compartilhamento 1200×630 (só logo e cena, sem frase).
- **Sem slogan** [DECIDIDO #44]: título, manifest e imagem de compartilhamento levam só o nome e "um jogo bobo da EriLab".

### 11.3 Tom [DECIDIDO #19]
- Bobo, nunca maldoso. A piada é com o bot.
- Militar cartunesco genérico; uniformes e facções fictícios com cara de brinquedo. Diretriz completa em 5.4.

### 11.4 EriLab
- **Web:** rodapé do título com "um jogo bobo da EriLab"; painel "Outros jogos", como no futbobo; `author` e `publisher` EriLab nos metadados [C]. Hospedagem em GitHub Pages, `erereck.github.io/boboforces` [DECIDIDO #40].
- **Switch:** EriLab como publisher no NACP e nos créditos; title ID no padrão do MMM, fixado no M0 [PADRÃO]. Build **só para uso pessoal**, não publicado [DECIDIDO #33].
- Repositório público, **sem licença aberta** [DECIDIDO #41]. Licenças de terceiros (fontes OFL, SFX e música CC0, bibliotecas) e o crédito ao Claude ficam em `docs/CREDITOS.md`.
- Jogo gratuito e não comercial, com aviso de conteúdo como no gamebobo.

---

## 12. Produção dos assets [DECIDIDO #13]
**O Claude gera tudo por script; o Erick aprova por prints.** Nada é modelado à mão: modelos, texturas e mapas nascem de fontes em texto versionadas no repositório.

| Categoria | Como o script gera [PROPOSTA] | O que o Erick aprova |
|---|---|---|
| Texturas de bloco 16×16 | gerador em TS com a paleta mestra e as regras de 1.3 (manchas, bevel, variantes por semente) | prints da cena-vitrine |
| Kit modular, formas do catálogo e mapas | scripts TS com a API de construção do `mapc` (`box`, `ramp`, `fence`, `prop`…) | prints e passeio na cena |
| Skins, rostos e roupas | pixel-art em texto (cada caractere é um índice da paleta) + composição por partes | folha com todas as skins prontas, de frente e de costas |
| Armas | DSL de caixas + textura 64×64 em texto | silhueta lateral em 32 px de largura (teste de "reconhece em 1 s") e viewmodel |
| Props low-poly (cilindros, barris, jipe…) e acessórios 3D | listas de caixas e primitivas paramétricas em TS (`modelgen`) | prints |
| Logo em blocos | DSL de blocos | print da tela de título |
| VFX | código + atlas pequeno | gravação curta |
| SFX / música | CC0 com crédito + síntese em código / CC0 provisória | escuta |

**Pipeline** [PROPOSTA]
1. **Fonte da verdade em texto**, em `assets-src/`: pixel-art como grade de caracteres com paleta, modelos como listas de caixas em TS e mapas como scripts TS (`tecnico.md` 15.1). Diff legível no git; nada de binário editado à mão.
2. **Build** nas ferramentas de `tools/*` (`texgen`, `modelgen`, `mapc`; o `skingen` virou a prévia do pintor de skins): gera as folhas PNG das camadas dos arrays, os modelos em formato compacto e os mapas em RLE + deflate [PADRÃO]. A malha e a luz dos mapas são montadas no loading (5.7).
3. **Validador no `npm test`:** cor fora da paleta mestra; tamanho de camada (16×16 ou 64×64); densidade de texel (UV contra tamanho no mundo, ±5%); soquetes obrigatórios das armas; teto de triângulos; IDs de conteúdo estáveis.
4. **Prints automáticos** da cena-vitrine (playwright-core no Edge, câmeras fixas, Dia/Entardecer/Noite, 1280×720 e 640×360), salvos por versão para comparar antes/depois.
5. **Documentos:** este `docs/design/arte-ux.md`, mantido vivo, e `.interface-design/system.md` (criado no M0).

**Limite honesto:** o script gera e mostra, mas **o gosto final é do Erick**. Toda arte nova passa por prints de Dia, Entardecer e Noite e pelo checklist de 5.4.

---

## 13. Orçamentos consolidados [PROPOSTA]
Valem para o pior caso: Switch 3–4P ou celular médio. A medição do Teste Zero manda.

| Item | Por viewport | Total |
|---|---|---|
| Draw calls (orçamento base, Switch 3–4P) | **até 45** (`tecnico.md` 16.3): mundo ~17 (opaco, cutout, translúcido), props instanciados ≤ 8, bobos 7 (6 partes + rosto), armas e acessórios no mundo ≤ 3, viewmodel 1, VFX ≤ 6 (inclui o pool de cubinhos), céu 2 | Switch até 200, mais a UI |
| Contorno de time | não entrou (#50): 0 draw calls | — |
| Triângulos visíveis | até 120 mil | até 500 mil |
| Bobo / bobo-zumbi | ~150 triângulos (até ~250 com acessórios) | — |
| Arma (mundo e viewmodel) | até 600 triângulos (a maioria abaixo de 300) | — |
| Prop fora da grade (instanciado) | até 300 triângulos | — |
| Programas de shader | — | **7** [PADRÃO] |
| Texturas na GPU | — | `blocos16` ~350 KB com mips; `modelos64` até ~2,7 MB com mips (128 camadas, sobe se o T0 deixar); MSDF, sprites e LUT ~2 MB; total < 8 MB |
| Texturas no download (primeira partida) | — | texturas de blocos e skins até 150 KB em PNG (`tecnico.md` 16.4) |
| Áudio | — | SFX até 1,5 MB; sons essenciais da primeira partida até 150 KB; música sob demanda |
| Fontes | — | até 120 KB [PADRÃO], lidos como bytes baixados do atlas MSDF (PNG + JSON em gzip, o JSON no nível 4, calibrado pelo GitHub Pages; decisão menor revisável, 6.2): medido 119,6 KB. Os TTF não vão no build |
| Carga inicial da web | — | menu interativo em até ~350 KB; primeira partida em até ~1 MB acumulado: Construto (`.bfmap`) até 300 KB + texturas de blocos e skins até 150 KB + sons essenciais até 150 KB (`tecnico.md` 16.4) |
| Memória | — | GPU < 150 MB; heap JS < 200 MB |

---

## 14. Marcos desta frente
Numeração única do projeto. Cada marco lista só a parte de arte, UX, áudio e marca.

| Marco | Entrega desta frente |
|---|---|
| **M0 Fundação** | render base com `TEXTURE_2D_ARRAY` (programas de blocos, instanciado, céu e UI); UI WebGL base com MSDF e tokens escuros; gerador de texturas com paleta mestra; validador; prints automáticos |
| **M1 Cena-vitrine + Teste Zero** (mesma cena) | cena de 5.2 com bobos e bots; prints do visual blocado pixel-art aprovados pelo Erick (densidade de textura e peças fora da grade); a mesma cena no Switch real com 4 telas e bots burros, medindo FPS e memória |
| **M2 MVP web solo** | Construto completo + Ringue; bobo com kit de customização e 12 skins prontas; 8 armas; ~40 SFX; música CC0 de menu; fluxo completo da web (título, Partida Rápida, Modos, Configurar partida, Laboratório núcleo forte, Meu Bobo, Ajustes, Novidades, Resultados); onboarding e dicas; Bobo Warfare TDM e FFA, Bobo Training, Surpreenda-me simples |
| **M3 Sofá** | tela dividida na web com controles; HUD 3–4P; áudio no sofá; bobos-zumbi em 5 tipos (comum + Sprinter, Chonker, Spitter e o chefão Mega Bobo); mapa de Zombies (Base Abandonada); música de Zombies em camadas |
| **M4 Port do Switch** | lobby LOCAL EDITION; glifos genéricos; teclado na tela; ciclo de vida; ícone e NACP; perfil de qualidade do Switch (offline, uso pessoal) |
| **M5 Online P2P** | telas de sala (criar, código, link), lobby da sala, aviso de privacidade, pings e emotes, plaquinhas humano/bot |
| **M6+ Festa e conteúdo** | temas do cardápio de 5.3; telas da Oficina com códigos; Aquário; Diretor de Partida no placar; arte de BoboStrike, Bobo Paintball, Domination, Bobo Juggernaut, Bobo Sandbox completo, Bobo Chaos e Bobo Royale Mini 24 |

---

## 15. Riscos desta frente
1. **Pixel-art gerada por script com cara genérica.** Mitigação: paleta mestra, regras de 1.3, cena-vitrine como primeiro entregável de arte e prints comparativos por versão.
2. **Legibilidade no 3–4P** (bobos com 10 a 16 px). Mitigação: reserva de saturação, colete, braçadeira e luvas na cor do time (#58), marcadores e teto de visão de 50 m (o contorno saiu, #50; os bobos cresceram para 1,625 m, #53, e para 1,75 m, #55).
3. **Nearest com mipmap** pode cintilar ou borrar ao longe. Mitigação: A/B de filtro nos prints.
4. **Texture array no nx.js** ainda não confirmado. Mitigação: atlas com padding e `textureGrad` (1.6).
5. **Pixel do boneco 2× maior que o do cenário** pode destoar. Mitigação: print de densidade no M1; a alavanca é a skin, não o cenário.
6. **Agachado de 0,95 m com pernas rígidas.** Mitigação: pose validada por print de perfil ao lado da cobertura de 1,0 m.
7. **Alpha test** (cutout, camada externa) pode pesar no Maxwell com nouveau. Mitigação: medir no Teste Zero; desligar a camada externa a partir de 25 m.
8. **UI 100% WebGL:** na web, leitor de tela quase não funciona e digitar é chato. Mitigação: input DOM escondido na web e teclado na tela no Switch.
9. **Áudio sem filtro e sem panner** no Switch. Mitigação: amostras de perto e de longe e indicador visual de som.

---

## 16. Pendências
Só o que continua aberto de verdade.
1. **Prints da cena-vitrine (M1)** para o Erick aprovar: densidade de textura (cenário 32 px/m, bobos 16 px/m), dose de peças fora da grade, filtro de mipmap, contorno de time (entra ou não, fora do orçamento base), forma das caixas de tronco e membros, grade de luz de 2 m contra 1 m, paleta mestra e as três luzes. **Feito (03/11/2026):** luzes e `NEAREST_MIPMAP_LINEAR` aprovados e sem contorno (#50), bobos a 32 px/m (#51), dose dobro (#52), bobos mais altos (#53, volta para um print de altura).
2. **Fontes:** escolher as duas OFL por print. **Feito:** Russo One + Saira Condensed (#54, ver 6.2).
3. **Teste Zero** [TZ]: `TEXTURE_2D_ARRAY` com `REPEAT` por camada; custo do alpha test; MSDF (e Canvas 2D como plano B); FBO multisample com blit para AA no Switch; compilação dos 7 programas no carregamento; teclado do sistema no nx.js; StereoPanner e MP3 no nx.js; memória da cena com 4 telas e 12 bots armados ou 24 zumbis.
4. **TURN antes de abrir o online (M5)** [PADRÃO]: a escolha do provedor entra no texto do aviso de privacidade.
5. **Nomes finais:** armas e bots de fábrica (tabela da frente de gameplay) e mapas do cardápio de 5.3.
