# Multiplayer P2P para FPS web (PC e celular): pesquisa de novembro de 2026

## CONFIRMADO (com fonte)

**Sinalização e transporte**
- **Trystero:** WebRTC P2P com sinalização emprestada de redes que já existem. O padrão é Nostr. Também aceita MQTT, BitTorrent, IPFS, Supabase, Firebase e um ws-relay que você mesmo hospeda. O tráfego do jogo não passa por essas redes: vai direto entre os peers, com criptografia ponta a ponta. TURN se configura em `turnConfig` ou em `rtcConfig.iceServers`. Segundo o README, Nostr é o meio com mais redundância. O README também recomenda separar os jogadores em salas, porque o navegador aguenta poucas conexões WebRTC ao mesmo tempo. https://github.com/dmotz/trystero
- **PeerJS Cloud:** é grátis e vem como padrão. A documentação sugere hospedar seu próprio PeerServer e avisa que o Cloud usa a porta 443. Não há limites oficiais publicados. O FAQ diz que um peer mantém de 5 a 10 conexões com conforto. Há relatos antigos, de 2020, de quedas do 0.peerjs.com. https://peerjs.com/docs · https://peerjs.com/client/faq · https://github.com/peers/peerjs/issues/693
- **Cloudflare TURN (Realtime):**
  - 1.000 GB/mês grátis, divididos com o SFU. Depois disso, US$ 0,05/GB, cobrando só o tráfego que sai da Cloudflare.
  - O STUN em stun.cloudflare.com é grátis e sem limite.
  - As credenciais saem de um endpoint de API e valem por até 48 h. Na prática, gera-se no backend ou num Worker.
  - https://developers.cloudflare.com/realtime/turn/faq/
- **Cloudflare Realtime SFU:** aceita DataChannel de um para muitos, com `ordered:false` e `maxRetransmits:0`. https://developers.cloudflare.com/realtime/sfu/datachannels/
- **Durable Objects no plano Free:**
  - Só a versão com SQLite.
  - 100 mil requests/dia e 13.000 GB-s/dia.
  - Mensagens WebSocket recebidas contam na proporção 20:1.
  - Passou do limite, a operação dá erro. O contador zera às 00:00 UTC.
  - https://developers.cloudflare.com/durable-objects/platform/pricing/
- **Open Relay (Metered):** 20 GB/mês de TURN grátis. Precisa criar conta e usar API key. https://metered.ca/tools/openrelay/
- **Canais:** `ordered:false` com `maxRetransmits:0` funciona como UDP, cada mensagem é enviada uma vez só (RFC 8831). Uma mesma conexão pode ter vários canais. https://jameshfisher.com/2017/01/17/webrtc-datachannel-reliability/ · https://developer.mozilla.org/en-US/docs/Games/Techniques/WebRTC_data_channels
- **Topologia:**
  - Estrela com host escala melhor que mesh, mas o host fica com vantagem de latência.
  - Se o host sair, o jogo acaba ou precisa migrar de host.
  - Mesh funciona bem com 2 a 6 jogadores.
  - https://abratabia.com/multiplayer-web-games/webrtc.php

**Netcode**
- **Gambetta:** o cliente prevê o estado a partir do último estado autoritativo mais os inputs que o servidor ainda não processou (prediction e reconciliação). Os outros jogadores aparecem por interpolação, e o servidor faz lag compensation. https://gabrielgambetta.com/client-side-prediction-server-reconciliation.html
- **Valve (Source):**
  - CS:S e TF2 rodam a 66 ticks.
  - A interpolação padrão é de 100 ms, o que deixa o cliente sobreviver à perda de um snapshot.
  - A lag compensation volta no tempo considerando o atraso de interpolação do cliente.
  - https://developer.valvesoftware.com/wiki/Source_Multiplayer_Networking

**Controles**
- **DeviceOrientation:** só funciona em HTTPS. `requestPermission()` precisa ser chamado dentro de um gesto do usuário, e a existência do método deve ser testada antes. https://developer.mozilla.org/en-US/docs/Web/API/Device_orientation_events/Detecting_device_orientation
  - Segundo a comunidade (não é documentação da Apple): o iOS recusa a permissão sem HTTPS, e o gesto precisa ser `click` ou `touchend`, não `touchstart`. https://yal.cc/js-device-motion/
- **Pointer Lock:**
  - `requestPointerLock()` retorna uma Promise.
  - `{unadjustedMovement:true}` desliga a aceleração do mouse. Suporte: Chrome 88, Firefox 152, Safari 18.4.
  - Não existe no Safari iOS. No Chrome Android existe desde a versão 144.
  - https://w3c.github.io/pointerlock/ · https://github.com/mdn/browser-compat-data (api/Element.json)
- **Gamepad API:**
  - Só em HTTPS.
  - `getGamepads()` mantém os índices fixos e coloca `null` no lugar de um controle desconectado.
  - Iframes precisam de `allow="gamepad"`.
  - No Safari iOS desde a versão 10.3.
  - https://hacks.mozilla.org/2020/07/securing-gamepad-api/ · https://caniuse.com/gamepad

**Pegadinhas do iOS e do Android**
- **WebGL2:** Safari iOS 15 ou mais novo. https://caniuse.com/webgl2
- **WebGPU:** ligado por padrão no Safari 26 / iOS 26. Esta informação vem de fonte secundária. https://appdevelopermagazine.com/webgpu-in-ios-26/
- **Tela cheia no iOS:**
  - `requestFullscreen` funciona só no iPad, não no iPhone.
  - Mostra um botão sobreposto que não dá para esconder, e deslizar para baixo sai da tela cheia. Os dados do MDN chamam isso de "inadequado para jogos".
  - `screen.orientation.lock` não é suportado no Safari nem no iOS. No Chrome Android existe desde a versão 38 e normalmente exige tela cheia.
  - Fonte de ambos: browser-compat-data (api/Element.json, api/ScreenOrientation.json) e https://developer.mozilla.org/en-US/docs/Web/API/ScreenOrientation/lock
- **Web app no iOS 26:** qualquer site adicionado à Tela de Início abre como web app por padrão, mesmo sem manifest. Se houver manifest, os ícones dele são usados. https://heise.de/-10749652
- **Áudio:** o AudioContext só toca depois de criado ou retomado com `resume()` dentro de um gesto do usuário. Isso vale para Safari e Chrome. https://www.mattmontag.com/web/unlock-web-audio-in-safari-for-ios-and-macos
  - O WebKit bug 291892 continua aberto: o áudio fica mudo no web app depois de voltar do segundo plano, e no iOS 26 há relatos de que só toca na primeira abertura. Um único relato diz que o iOS 26.2 beta corrigiu. https://bugs.webkit.org/show_bug.cgi?id=291892
- **Memória:** o WebKit bug 300782, também aberto, descreve páginas WebGL com muitas texturas sendo encerradas e recarregadas em loop. Nenhum aviso nem `webglcontextlost` chega ao JavaScript antes. https://bugs.webkit.org/show_bug.cgi?id=300782

## INFERIDO / OPINIÃO

**Stack recomendada (custo zero ou quase)**
- **Sinalização:** Trystero com Nostr, com MQTT como reserva. É a melhor opção sem servidor. O PeerJS Cloud serve para protótipo, mas não tem garantia de funcionamento.
- **TURN:** só STUN não basta. Uma parte das redes móveis 4G/5G e corporativas usa NAT simétrico, e sem TURN essas conexões falham.
  - Use o TURN da Cloudflare, cuja franquia grátis é grande, com um Worker gratuito só para gerar as credenciais. O Worker é o "servidor mínimo".
  - O Open Relay fica como reserva.
- **Durable Objects:** não use como relay do jogo. Com, por exemplo, 6 jogadores a 20 Hz, a cota diária se esgota em poucas horas. Use só para lobby e sinalização.

**Topologia e limite de jogadores**
- Estrela com host autoritativo.
- Limite prático: de 4 a 6 humanos por host quando o host é celular, e de 8 a 10 quando é PC. O que limita é o upload do host e a CPU de um celular.
- Os bots rodam só no host e são enviados como entidades comuns nos snapshots.

**Netcode**
- Simulação no host a 30–60 Hz. Snapshots a 20–30 Hz no canal unreliable (`ordered:false, maxRetransmits:0`), com delta compression.
- Inputs dos clientes a 30–60 Hz no canal unreliable, repetindo os últimos N inputs em cada pacote para cobrir perdas.
- Canal reliable separado para kills, chat, spawns e mudanças de estado da partida.
- Cliente: prediction só do próprio movimento, reconciliação por número de sequência e interpolação de 100 ms (ou cerca de 2 snapshots).
- Host: hitscan com rewind histórico de uns 200 ms, limitando quanto tempo a compensação pode voltar.
- O host joga com 0 ms. Dá para aceitar ou compensar com um pequeno atraso artificial.

**Convite**
- Gere um código curto de sala (`joinRoom({appId}, codigo)`) e um link com `#sala=XXXX` no hash. O hash não vai para o servidor.

**Reconexão e migração de host**
- **Reconexão:** um ID persistente em `localStorage` e um snapshot completo enviado ao reentrar.
- **Migração:** o host replica periodicamente um snapshot "pesado" para todos. Se ele cair, o peer com o menor ID determinístico assume e os outros se reconectam ao novo host. Espere uns 2 a 5 s de pausa.
- No primeiro lançamento, aceitar "host saiu = fim da partida" já é razoável.

**Controles no celular**
- Joystick virtual na metade esquerda da tela, que aparece onde o dedo toca.
- Arrastar na metade direita para mirar, com sensibilidade ajustável.
- Botão de tiro que também mira enquanto você arrasta.
- Auto-fire opcional, disparando quando o alvo passa pela mira, com um aim-assist leve.
- Gyro como opção, ligado por um botão que chama `requestPermission`. No Android não pede permissão.
- Use `touch-action:none` e Pointer Events.

**Controles no PC e tela dividida**
- Pointer Lock acionado no clique, com reserva caso `unadjustedMovement` seja rejeitado.
- Tela dividida local: um render com 2 a 4 viewports (scissor/viewport), cada `gamepad.index` controlando um jogador e o teclado/mouse como mais um jogador.
- Chame `getGamepads()` a cada frame, porque o Chrome devolve objetos que não se atualizam sozinhos.

**Mobile (opinião)**
- No iPhone não há tela cheia de verdade. Mostre "gire o aparelho" e incentive "Adicionar à Tela de Início" com `display: fullscreen` no manifest.
- Mire em menos de 300 MB de GPU e JS: texturas KTX2/Basis, atlas, sem `display:none` no canvas.
- Use WebGL2 como base e WebGPU como opcional.
- Áudio: um único AudioContext liberado no primeiro toque, retomado em `visibilitychange`, com uma tela de "toque para continuar" como reserva.
- Celulares limitam o FPS e esquentam. Ofereça escala de resolução dinâmica (DPR de 1 a 1,5).