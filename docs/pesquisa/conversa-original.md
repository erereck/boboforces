# Conversa original sobre o BoboForces (ChatGPT, compartilhada pelo Erick)

Fonte: https://chatgpt.com/share/6ae8e385-46ec-83e8-a482-7f73989ac280 (lida em 02/11/2026).
A página mostra só as 7 últimas mensagens; as 3 primeiras foram recuperadas dos dados embutidos na página.
As mensagens do Erick estão literais. As do assistente estão resumidas: são **sugestões**, não decisões.
As decisões valem só como estão em `docs/DECISOES.md`.

## 1. Erick: a ideia

> próximo game bobo web da erilab acho q vai ser um boboforces ou algo do gênero, um jogo de tiro offline (e com online p2p) onde vc simplesmente mata bots que vc mesmo pode configurar dificuldade e configurar mais um monte de coisas nas IAs dele, com vários modos de gameplay, como battle royale, cod, cs, big paintball (Roblox), etc, com possibilidade de criar um x1 ou mais com amigos P2P e um modo cooperativo de matar bots juntos, ideia vem de quando eu jogava mapas assim no gmod pq eu n gosto de competitivo pq estressa enquanto offline faz o efeito contrário, e poder configurar o desafio deixa vc poder escolher entre tryhardar ou só jogar dando tiro pela vibe, oq acha

## 2. Assistente: "um FPS em que o jogador é o próprio game designer da partida"

- Não compete com CS/CoD: resolve "quero a experiência de FPS multiplayer sem enfrentar humanos". "Você decide o quanto quer sofrer."
- **Laboratório de IA** com eixos separados: inteligência tática (burro, flanqueia, comunica, embosca, aprende padrões), habilidade mecânica (precisão, reação, recoil, movimento, headshot, frequência de erro), personalidade (covarde, suicida, camper, estrategista, lunático), regras/vantagens (500 HP, munição infinita, velocidade, visão limitada, armas, habilidades). Separar inteligência de habilidade.
- **Modos**: Bobo Warfare (TDM, Domination, FFA), BoboStrike (bomba, economia, rounds), Bobo Royale (dezenas de bots, loot, zona), Bobo Paintball, Bobo Survival (ondas), Bobo Sandbox. Assistir partida só entre IAs e entrar a qualquer momento.
- **Diretor de Partida** adaptativo, sempre opcional.
- Sozinho, cooperativo (4 amigos vs 40 bots, defender base, invadir prédio), competitivo privado (X1 sniper, 2v2 com bots completando, BR privado). Humanos e bots no mesmo time.
- P2P com WebRTC DataChannels, host autoritativo simulando os bots; sinalização e às vezes TURN.
- Ideias: **Oficina de Bots** (configs em JSON, ex. "Jorge, o Imortal"), **Simulador de guerras** (facções), **Modo Caos** (gravidade lunar, tudo explode, troca de arma por kill).
- Alerta de escopo: começar com arena 3D, 1 mapa, 6 armas, TDM + FFA e bots profundamente configuráveis. IA divertida antes de sofisticada.
- Slogan sugerido: "Seu jogo. Suas regras. Seus inimigos." (o Erick decidiu não ter slogan, DECISOES #44).
- Pergunta deixada: movimento realista ou arcade? (respondida em DECISOES #8).

## 3. Erick: Switch e tela dividida

> tava pensando aqui e ja vou projetar ele pensando no port pra switch com multiplayer local, pra ser um game extremamente rapido pra so puxar do nada pra jogar com 4 jogadores tela dividida num modo tipo zombies por exemplo

## 4. Assistente: identidade de jogo de festa

- Quatro prioridades: Zombies como modo principal do local (ondas, compra de armas, barricadas, reviver, chefões; 10 min ou infinito); tela dividida real (2 horizontal, 4 em 2×2, câmera/HUD/config por jogador, simulação compartilhada); visual leve priorizando 4 câmeras; entrar instantâneo (um botão pra entrar, outro pra começar, presets, drop-in assumindo bots).
- Port não pode ser reflexão tardia: separar lógica de render, input e rede.
- Metas (não medidas): 30 FPS com 4 jogadores no Switch, resolução adaptativa, IA num sistema único, controles completos (Joy-Con sozinho não é ideal), tudo offline.
- Primeiro protótipo no Switch: 4 câmeras, 4 controles, 1 mapa, 10 bots.
- Multiplayer híbrido (4 vs 30 bots, 2v2 com 8 bots por time, BR com 20 bots, Juggernaut 1 vs 3, fortaleza) e botão **"Surpreenda-me"**.
- Regra de ouro: todo modo jogável sozinho com bots, localmente e via P2P quando fizer sentido.

## 5. Erick: velocidade, Switch, engine

> eu quero q ele seja mt rapido, tipo no pc vc so coloca o site e ja configura rapidao, cell tb, soq a versao do switch é muito importante, tu acha q vale a pena usar godot mesmo? ele exporta pra web? eu perguntei pra um amigo e falaram de uma engine nova chamada shallot, da uma olhada nela, boboforces é um projeto mt grande ent tem q ser bem feito

## 6. Assistente: comparação de engines

- **Godot 4**: exporta para web (WebGL2, sem threads desde 4.3), GDScript (C# não exporta para web), runtime pesado para abrir rápido; Switch sem rota oficial.
- **Godot 3.5 + port homebrew** (Stary2001): gera .nro, mas base de 2023 e sem garantia para 4 câmeras.
- **Shallot** (Dylan Ebert, TypeScript, WebGPU, MIT): interessante, mas depende de WebGPU e não tem caminho para Switch. Descartado.
- **PlayCanvas**: ótimo para web e celular, sem rota para Switch.
- Arquitetura: núcleo de gameplay separado de render, controles e rede. Metas: PC jogável em ≤5 s, celular em ≤10 s, menu antes dos mapas, Switch 30 FPS com 4 jogadores, partida em 2–3 interações.
- Sugeriu um teste de viabilidade no Switch antes de escolher.

## 7. Erick: nx.js

> ultima coisa, dê uma olhada no nx.js, eu usei ele pro port de mmmweb, q é um jogo infinitamnete mais simples, mas é bom conferir

## 8. Assistente: nx.js vira candidato principal

- nx.js (TooTallNate): WebGL2 com GPU (OpenGL ES 3), V8, WASM, Web Audio, Gamepad API (até 8 controles, eventos de conexão), empacota .nro/.nsp. O + do 1º controle fecha o app por padrão, mas dá para interceptar.
- Sem DOM completo: three.js precisa de camada de compatibilidade. Brewser (fork) relata demos three.js/GLTF no Tegra X1.
- Rede: TCP/UDP/WebSocket, sem RTCPeerConnection documentado.
- Riscos: WebGL2 sem extensões; exige application mode (não funciona pelo Álbum); custo de 4 câmeras; UI precisa ser desenhada no jogo.
- Ranking: **three.js + TypeScript + nx.js** primeiro; Godot 3.5 alternativa; Shallot não.
- "Teste Zero": 4 jogadores locais, 30 bots, 1 mapa low-poly, ≥30 FPS.

## 9. Erick: Switch offline

> o switch nao vai ter online nem p2p nem nada, vai ser 100% offline e so com multiplayer local / solo, online vai ser pro cell e pc somente

## 10. Assistente: estrutura final

- Web (PC + celular): solo, P2P, coop online, X1, partidas personalizadas. Switch: 100% offline, solo, local até 4, Zombies, X1, bots.
- Core em TypeScript (bots, física, armas, mapas, modos, regras) + Browser (three.js + WebRTC + mouse/teclado/toque) + Switch (three.js no nx.js + controles locais). O Switch não carrega nada de rede.
- Menu sugerido "LOCAL EDITION": Zombies, Combate livre, Versus, Sandbox, **Partida Rápida** (últimas configs), "Pressione A para entrar • Até 4 controles".
- UI desenhada dentro da renderização (não DOM). Primeiro protótipo já com 4 jogadores em tela dividida.
