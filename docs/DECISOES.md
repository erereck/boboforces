# Decisões do projeto (respostas do Erick, 02/11/2026)

Este arquivo registra as decisões de produto do BoboForces, tiradas da conversa original
(`docs/pesquisa/conversa-original.md`) e das perguntas da Fase 1 (estruturação).
Ele manda sobre qualquer outro documento: se um texto em `docs/design/` contradisser esta tabela, vale a tabela.
Toda mudança de rumo deve ser anotada aqui.

| # | Tema | Decisão |
|---|---|---|
| 1 | Plataformas | **Web** (PC + celular): solo contra bots, tela dividida local e online P2P. **Switch homebrew** (desbloqueado, OLED): **100% offline**, solo + multiplayer local até 4 em tela dividida, sem rede nenhuma. O Switch é **produzido depois**, mas tudo é projetado para ele desde o dia 1. |
| 2 | Engine | **three.js + TypeScript** na web e **nx.js** no Switch. O three fica isolado no pacote de render: se falhar no Switch, só o render muda (plano B: renderer WebGL2 próprio). |
| 3 | Interface | **Toda a UI é desenhada pelo jogo em WebGL** (menus, Laboratório de bots, HUD), inclusive na web, sem React. DOM só no splash de carregamento e num input escondido para digitar texto. |
| 4 | Cenário | **Estático.** O cenário não é destruído; só detritos cosméticos (cubinhos) voam nos tiros e nas mortes. |
| 5 | Direção de arte | **Blocado com pixel-art, na linha de Block Strike e Pixel Gun 3D** (revisto em 02/11/2026, ver #45): bonecos e armas feitos de caixas com textura pixel-art, cenário de blocos texturizados, cores vivas, sol quente e AO suave. Tom de brinquedo tático. |
| 6 | Grade e texturas | **Grade de construção de 0,5 m**, blocos com textura de 16×16 px por face (32 px/m), filtro nearest. Densidade e quantidade de peças fora da grade são aprovadas pelo Erick por prints na cena-vitrine (M1). |
| 7 | Fora da grade | **Liberado** quando ficar mais leve ou mais bonito: rampas, cilindros, cercas, vegetação em cruz, props low-poly com textura pixel-art. Bonecos e armas são modelos de caixas, não micro-voxels. |
| 8 | Movimentação | **Arcade configurável**: padrão rápido e gostoso (correr, pular, deslizar); regras de partida ligam bhop, wall jump, pulo duplo ou deixam mais lento/tático. |
| 9 | Violência | **Configurável**: padrão cartunesco (o bobo se desmonta em blocos/confete, sem sangue); opção nas configurações liga sangue em cubinhos vermelhos. |
| 10 | Armas | **Baseadas em armas reais** (fuzil, SMG, sniper, escopeta…) com **nomes e visual próprios**, sem marcas registradas. |
| 11 | Mira (ADS) | **Zoom em todas as armas**; uma regra de partida desliga. |
| 12 | Câmera | **1ª pessoa por padrão + 3ª pessoa opcional.** |
| 13 | Quem faz os assets | **O Claude gera tudo** (modelos de caixas, blocos e texturas pixel-art gerados por script); o Erick aprova por prints. |
| 14 | Idioma | **Só pt-BR** (textos numa tabela de chaves desde o primeiro dia, para traduzir se um dia quiser). |
| 15 | Nomes | **Nomes bobos em inglês** para modos, armas e bots (Bobo Warfare, BoboStrike, Bobo Royale…). O resto da interface é pt-BR. |
| 16 | Progressão | **Nenhuma: tudo liberado sempre.** Só estatísticas e recordes. |
| 17 | Personagem | **Bobo customizável** (chapéu, cabelo, cor, rosto, padrão), tudo liberado desde o início. |
| 18 | Proporção | **Cabeçudo, ~3 cabeças de altura.** Headshot calibrado para a cabeça grande. |
| 19 | Tom do mundo | **Militar cartunesco genérico**, sem nacionalidade (nada de lugares, bandeiras ou exércitos reais). |
| 20 | Mapa 1 | **Construto** (sala de teste, homenagem ao gmod): TDM/FFA, cena-vitrine e testes de desempenho. |
| 21 | Dificuldade rápida | **5 níveis**: Pela vibe, De boa, Normal, Suado, Tryhard. O detalhe fica no Laboratório. |
| 22 | Visual da UI | **Tudo escuro** (linha do futbobo): editorial escuro, sério, estilo militar. |
| 23 | Teste Zero | **Testar cedo no Switch real**: a cena-vitrine (Construto), 4 telas, bots, medindo FPS/memória, antes de produzir conteúdo. |
| 24 | Tela dividida na web | **Sim, também no PC** com controles (mesmo código do Switch). |
| 25 | Online P2P | **Até 4 humanos** (só web). |
| 26 | Celular | **PC primeiro.** Celular funciona desde o MVP e é refinado depois. **Android e PC primeiro**; iPhone/iPad funciona com limitações conhecidas. |
| 27 | MVP (1º lançamento web) | **TDM + FFA + Treino**, com um Surpreenda-me simples. Zombies chega no marco do sofá. |
| 28 | Ordem dos marcos | **MVP web → Local (tela dividida + Zombies) → Switch → Online P2P.** |
| 29 | Laboratório no MVP | **Núcleo forte**: 5 níveis rápidos + sliders dos 4 eixos (inteligência, habilidade, personalidade, regras) + salvar bots. Compartilhar por código e Diretor de Partida vêm depois. |
| 30 | Zombies | **Estilo CoD Zombies**: ondas, pontos por acerto, armas na parede, barricadas, portas que abrem áreas, caixa misteriosa, reviver, chefões. |
| 31 | Inimigos do Zombies | **Bobos-zumbi cartoon** (mesmo estilo dos bobos, curvados, esverdeados, engraçados). |
| 32 | Controles no Switch | **Controle completo por jogador** (par de Joy-Con ou Pro Controller). Joy-Con sozinho não é suportado. |
| 33 | Distribuição do Switch | **Só uso pessoal** (não publicar build). |
| 34 | Falas dos bots | **Sem falas.** |
| 35 | Battle Royale | **Mini (24 participantes) primeiro**, mapa de ~200 m em todas as plataformas; Grande só no PC, depois. |
| 36 | Editor de mapas | **Só ferramenta interna** (nunca para jogadores). |
| 37 | Android | **Só navegador** (sem APK). |
| 38 | Música | **CC0 provisória**, trocada depois. |
| 39 | Efeitos sonoros | **CC0 (ex.: Kenney) com crédito + sons sintetizados em código.** |
| 40 | Hospedagem | **GitHub Pages** (`erereck.github.io/boboforces`); domínio próprio depois, se quiser. |
| 41 | Licença | **Repositório público, sem licença aberta** (todos os direitos reservados). Licenças de terceiros listadas em `docs/CREDITOS.md`. |
| 42 | Telemetria | **Nenhuma coleta.** Botão "Copiar relatório" (versão, GPU, perfil, últimos erros) na web e `runtime.log` no SD do Switch. |
| 43 | Logo | **Só logotipo em blocos** (letras BOBOFORCES blocadas com textura pixel-art), sem mascote. |
| 44 | Slogan | **Sem slogan.** |
| 45 | Liberdade de estilo (02/11/2026) | "Voxel" é **referência de estilo, não limite**: o visual alvo é o de Block Strike / Pixel Gun 3D. O Claude pode tomar decisões fora disso **quando for mais otimizado ou visualmente mais agradável**, registrando a escolha aqui ou nos docs de design. |
| 46 | Fontes candidatas (02/11/2026, início do M1) | Pode baixar do `google/fonts` as candidatas OFL **Russo One, Chakra Petch e Saira Condensed** (além da Barlow Condensed) para os prints de comparação. A escolha das 2 finais continua sendo do Erick, por print. |
| 47 | Áudio do Teste Zero (02/11/2026) | Pode baixar sons **CC0 da Kenney** para o teste de áudio do Switch (MP3 do romfs, vozes, latência), com crédito no `CREDITOS.md`. |
| 48 | Como rodar o Teste Zero (02/11/2026) | **Primeiro no Eden** (no PC do Erick, como referência), **depois no console pelo NRO** no hbmenu, aberto segurando R num jogo (modo aplicativo, sem chaves). |
| 49 | Aparelhos de referência (02/11/2026) | PC: o notebook do Erick (**i5-12450H + RTX 2050**, 16 GB). Celulares: **Samsung Galaxy A36** e **Xiaomi Redmi Note 13** (este faz o papel de "Android de entrada"). Fecha a pendência 8 do GDD §9.1. |
| 50 | Prints do M1: luz, contorno e filtro (03/11/2026) | **Aprovados:** Dia, Entardecer e Noite como estão; **sem contorno de time**; chão ao longe com **`NEAREST_MIPMAP_LINEAR`**. |
| 51 | Densidade dos bobos (03/11/2026) | **Skin dobrada: 32 px/m**, a mesma densidade do cenário (antes 16 px/m, skin 64×64). Escolhida no print 2, que mostrava a skin de teste ampliada (Scale2x + grão). Atualiza a #6. |
| 52 | Dose de props (03/11/2026) | **Dobro:** o mapa jogável leva todas as peças fora da grade do print 3 (as fixas, as da proposta e as do dobro), também na colisão, na navegação e na luz. |
| 53 | Altura dos bobos (03/11/2026) | **Um pouco mais altos** (ajuste pedido no print de leitura): crescem na vertical e continuam cabeçudos. O valor exato é proposta do Claude e volta para um print novo. Atualiza a #18 (1,5 m, ~3 cabeças). |
| 54 | Fontes (03/11/2026) | **Russo One** nos títulos e **Saira Condensed** no HUD e nos textos de leitura (OFL 1.1). Fecha a #46. |
| 55 | Prints do M1, rodada 2 (04/11/2026) | **Altura B: 1,75 m**, com olho a 1,55 m; fecha o valor da #53. Agachado com os **braços ao longo do tronco**. Marcadores de setor com **sublinhado no 6 e no 9**. Aprovados como estão: leitura dos bobos, skin a 32 px/m, vitrine, fontes no jogo e telas de título. Aceito o **teto de 120 KB em gzip nível 4** para as fontes. |
| 56 | Boneco do FutBobo (04/11/2026) | **O bobo passa a ser o boneco inteiro do FutBobo.** Pode ser modificado no que for preciso para ficar leve e rodar no Switch, desde que continue "bem parecido como está hoje". As expressões "mirando" e "morto" do teste ficam **como estão**. O capacete por cima ficou **sem escolha** e volta numa rodada de prints. Atualiza a #18 e a #51 no que o boneco mudar. |
| 57 | Prints do M1, rodada 3 (07/11/2026) | Todos os padrões do port aceitos: **sem capacete**; a **proporção do FutBobo** (cabeça de 0,4375 m); **headshot mantido** (1,5 / 2,0 / 1,25) com a cabeça menor; agachado **P4f**; **cabelo recortado** no teto de 0,99 m agachado / 1,99 m em pé; **molas no envelope**; **cabeça presa ao olho**; visuais dos bots por perfil (3 no Switch, 6 no PC); sem grão na roupa; **zumbi do FutBobo**; deslize **"carrinho"**; andar de lado e de ré do FutBobo; antebraço como no FutBobo; braço armado com dano de braço (0,8×); comemorações e tiques no **M2**, com o contrato de emote. A resposta da camisa (G9) foi substituída pela #58. |
| 58 | Roupa e personalização (07/11/2026) | **Sai o uniforme de futebol** (camisa de time, número, escudo e chuteira): os bobos vestem **roupas que fazem sentido numa guerra ou tiroteio**. Do FutBobo ficam **o esqueleto, as animações e o visual geral**; o resto pode mudar. **Personalização de personagem por jogador, salva para sempre**; os **bots podem ser bonecos genéricos**. |
| 59 | Prints do M1, rodada 4 (08/11/2026) | **Farda aprovada como está** ("gostei demais do resultado"): jaqueta lisa ou camuflada, gola, cinto, botas de combate e os 12 looks; **colete de time com cor e ícone** ▲ ● ■ ◆ no peito e nas costas (sem time, a placa menor na cor do look); **luvas, braçadeira e joelheiras na cor do time**; **camuflado só no tronco**, mangas e calça no tom principal. Fecha a roupa da #58. |

## Decisões menores tomadas pelo Claude com os padrões (revisáveis pelo Erick)

Saíram da revisão de completude da Fase 1. Se discordar de alguma, é só dizer.

| Tema | Decisão adotada |
|---|---|
| Repositório | Monorepo com npm workspaces (`packages/*`, `apps/web`, `apps/switch`, `tools/*`). Evita a divergência web/Switch que aconteceu no MMM. |
| TypeScript | Strict no nível do VNbobo (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `erasableSyntaxOnly`). Pacotes puros sem a lib DOM; Node 24+ para rodar as tools em `.ts` direto. |
| Versionamento | Estilo gamebobo: `version.json`, CHANGELOG com codinome e `docs/PROMPTS.md`. O `version.json` também guarda as versões de formato (save, preset, bot, mapa, protocolo). |
| Dependências | Liberadas com versão exata (sem `^`), registradas em `docs/DEPENDENCIAS.md` e aprovadas no "portcheck" do Switch. |
| Colaboração | Como no VNbobo: nada de commit ou push sem pedido do Erick, `DECISOES.md` só muda com resposta dele, fixtures sintéticas, painel de debug no F2, `dispose()` total, relatório ao final. |
| DOM na web (exceção da #3) | Além do splash e do input de texto, a casca web usa um `<input type=file>` escondido para importar backup e um link com Blob para baixar backup/relatório, atrás de `platform.files.pick()/save()`. Nada disso faz parte da UI do jogo; no Switch vira leitura/escrita no SD. |
| Navegador mínimo | WebGL2 + ES2022. Abaixo disso, página de aviso amigável. |
| Tick da simulação | 60 Hz com dados em unidades por segundo e render interpolado. No Switch cai para 30 Hz se o Teste Zero exigir. |
| Física e navegação | Colisão própria (AABB varrido + DDA na grade de blocos, mais caixas/rampas para peças fora da grade) e navegação em grade 2,5D com A* + flow field. Sem Rapier e sem WASM no caminho crítico. |
| Métricas de gameplay | Uma tabela única em config manda sobre arte e técnica (altura do bobo cabeçudo, degrau automático, coberturas e portas como múltiplos da grade de 0,5 m). Headshot por arma, calibrado por robô de balanceamento. |
| Texturas pixel-art | Blocos e skins em `TEXTURE_2D_ARRAY` (WebGL2 core) com nearest; atlas com padding como plano B se o Teste Zero reprovar no nx.js. Skins de bobo a 32 px/m (#51): pintadas em 64×64 e ampliadas no loading para 4 camadas 64×64. |
| Tetos de bots | Por perfil de plataforma, em config. Começa conservador e sobe com as medições do Teste Zero. Capacidade do motor: 64 bots. |
| Distância de visão | Regra da partida, igual para humanos e bots; o perfil da plataforma só define o teto. Mapas declaram a maior linha de visão. |
| Texto da UI | Atlas MSDF gerado no build a partir de fonte OFL, sem depender de `FontFace`. Canvas 2D só como plano B, validado no Teste Zero. |
| Shaders | No máximo 7 programas (blocos opacos, blocos cutout para cercas/folhas, translúcido, instanciado para personagens e props, partículas, céu, UI), compilados e aquecidos no carregamento. |
| Luz do cenário | Canais separados no vértice (AO, sol, céu, emissivo); dia/entardecer/noite por uniforms. Ruído de cor no shader, nunca no bake, para não quebrar o greedy meshing. |
| Render de personagens | Um `InstancedMesh` por parte rígida, sem depender de leitura de textura no vertex shader. |
| AA e resolução | PC com antialias nativo; celular sem AA e com escala dinâmica; Switch 720p fixo sem AA até o Teste Zero aprovar algo melhor. |
| Formatos | Binários próprios em RLE + deflate (fflate), PNG para imagens, MP3 como áudio. Brotli/gzip só como compressão de transporte. |
| Áudio em tela dividida | Cada som usa o ouvinte local mais próximo. Opção de saída mono; indicador visual de som. |
| Save no Switch | JSON no SD (`sdmc:/switch/boboforces/`) com backup, como no MMM. |
| Save na web | `localStorage` para preferências, presets e bots; IndexedDB para replays de debug. `navigator.storage.persist()` + "Exportar/Importar backup" em arquivo. |
| Formatos e códigos | Campo `format: "boboforces/<tipo>@<n>"` com migrações e validador. Campos desconhecidos ignorados, versão maior recusada com mensagem, conteúdo ausente cai em fallback, IDs de conteúdo nunca mudam. |
| Convenções de código | Identificadores em inglês; textos, docs e comentários em pt-BR; Prettier com printWidth 120 e aspas simples. |
| Tela dividida | Teclado+mouse contam como 1 slot. Com 2 jogadores, divisão horizontal (opção vertical); com 3, o 4º quadrante mostra placar e minimapa. |
| Celular | Sempre em paisagem, com aviso "Gire o celular". Giroscópio opcional e desligado por padrão. Limitador 30/60 FPS. |
| Teclado e mouse | Agachar no C (não no Ctrl, por causa do Ctrl+W). Pausa automática quando o pointer lock é perdido ou a aba some no solo. |
| Online: acesso | Só por código ou link entre amigos, sem salas públicas. Host pode expulsar e travar a sala. Sem migração de host na v1 ("host saiu = fim"). |
| Online: limites | Até 4 humanos (decisão 25). Host no celular tem teto de bots menor. Host em segundo plano: coop pausa, PvP encerra depois de 10 s. |
| Online: comunicação | Pings e emotes; sem chat de texto livre na v1. Nomes com até 16 caracteres e filtro simples local. |
| Online: TURN | Protótipo só com STUN. Antes de abrir o online, decidir TURN (Cloudflare com Worker grátis exige conta do Erick; Open Relay como reserva). |
| Diretor de Partida | Desligado por padrão e sempre visível no placar quando ligado. Nunca dá wallhack nem mexe no que o jogador definiu. |
| Armas do MVP | Pistola, SMG, fuzil, escopeta, sniper, lança-foguetes, faca e granada (LMG de reserva). Loadout livre por padrão. |
| Mapas do MVP | Construto (arena média, TDM/FFA, pontos de Domination já marcados) + 1 arena pequena para X1 e Treino. |
| Diretriz de conteúdo | Sem escolas, hospitais, lugares reais, bandeiras, exércitos ou marcas reais. |
| Modos de festa | Economia do BoboStrike simplificada. Paintball com manchas de tinta em decal, com teto. Infection e Gun Game entram como presets. |
| Música na partida | Desligada por padrão durante a partida; toca no menu, entre ondas e nos resultados. |
| Fontes | Duas fontes OFL (uma display pesada e uma condensada para o HUD), até 120 KB no total, aprovadas por print: Russo One e Saira Condensed (#54). |
| Grafia | BOBOFORCES no logo, BoboForces no texto, `boboforces` em URL e pastas. Title ID do Switch no padrão do MMM, fixado no M0. |
| Anti-frustração | Morte abaixo do mapa, botão "destravar", bot parado há 8 s sem progresso é teleportado ao nó de navegação mais próximo, último zumbi corre até os jogadores e ganha marcador, limite de tempo nos rounds do BoboStrike. |
| Switch: ciclo de vida | Pausa automática ao trocar dock/portátil, ao desconectar controle ou ao voltar do HOME. Slots reatribuídos na tela "aperte A". O + pausa; só se sai pelo menu. |
| Glifos de botões | Glifos genéricos desenhados pelo jogo (posição e cor), sem logos de marcas. |
| Novidades | Tela curta de "Novidades" como no futbobo. O service worker só aplica atualização no menu. |
| Replays e Aquário | Replays são ferramenta de debug (F2). Aceleração do modo espectador limitada pela plataforma (até 4x no PC, 2x no Switch). |
| Testes de dispositivo | Vitest + playwright-core no Edge no CI, mais checklist manual por marco no celular do Erick e num Android de entrada (4 GB). |

## Ordem de trabalho (roadmap)

M0 Fundação → M1 Cena-vitrine + Teste Zero (mesma cena) → M2 MVP web solo (TDM, FFA, Treino) →
M3 Sofá (tela dividida local + Zombies) → M4 Port do Switch → M5 Online P2P → M6+ Modos de festa e conteúdo.

Detalhes em `docs/GDD.md` §Roadmap.
