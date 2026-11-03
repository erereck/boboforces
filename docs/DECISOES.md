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
| Texturas pixel-art | Blocos e skins em `TEXTURE_2D_ARRAY` (WebGL2 core) com nearest; atlas com padding como plano B se o Teste Zero reprovar no nx.js. Skins de bobo em 64×64 px. |
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
| Fontes | Duas fontes OFL (uma display pesada e uma condensada para o HUD), até 120 KB no total, aprovadas por print. |
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
