# BoboForces: GDD técnico de arquitetura e portabilidade para Switch

> **Status:** v1 após a Fase 1 (02/11/2026). `docs/DECISOES.md` manda sobre este texto: se algo aqui contradisser a tabela, vale a tabela. Se este documento divergir de `gameplay.md` ou `arte-ux.md`, desempata o GDD 9.2 (coluna "Adotado").
>
> **Marcações usadas no texto:**
> - **[DECIDIDO #n]**: decisão do Erick, linha *n* da tabela de `DECISOES.md`.
> - **[PADRÃO]**: decisão menor tomada pelo Claude (seção "Decisões menores" de `DECISOES.md` ou escolha técnica deste documento). Revisável pelo Erick.
> - **[T0]**: número ou comportamento que só se confirma no Teste Zero (marco M1) e fica registrado em `docs/PERF.md`.
> - Sem marcação: detalhe de implementação que decorre das decisões acima.

---

## 0. Resumo

- **Um código só, com duas cascas.** Todo o jogo fica em pacotes TypeScript compartilhados que não sabem que existem DOM, rede ou Switch. `apps/web` e `apps/switch` só implementam a interface `Platform`: gráficos, assets, save, controles, áudio, ciclo de vida e sair. [PADRÃO]
- **Stack:** TypeScript strict e three.js, usando só o `WebGLRenderer`, em WebGL2 puro e sem extensões; nx.js no Switch. O three fica isolado no pacote `render`: se falhar no Switch, só o render muda (plano B: renderer WebGL2 próprio). [DECIDIDO #2]
- **Visual blocado pixel-art, na linha de Block Strike e Pixel Gun 3D.** [DECIDIDO #5, #45]
  - Cenário de blocos texturizados numa grade de 0,5 m, com 16×16 px por face (32 px/m) e filtro nearest. [DECIDIDO #6]
  - Peças fora da grade (rampas, cilindros, cercas, vegetação em cruz, props low-poly texturizados) sempre que forem mais leves ou mais bonitas. [DECIDIDO #7]
  - Bonecos e armas são modelos de caixas com textura pixel-art; skins de bobo em 64×64. [DECIDIDO #7, PADRÃO]
- **Render do cenário:** chunks de 32³ células, greedy meshing por textura com repetição no shader, texturas em `TEXTURE_2D_ARRAY` com índice de camada, AO por vértice e luz em canais separados (AO, sol, céu, emissivo). Sem shadow map e sem pós-processamento. [PADRÃO]
- **Cenário estático:** nada é destruído; só detritos cosméticos (cubinhos) voam. Nenhuma malha é refeita durante a partida. [DECIDIDO #4]
- **Personagens:** um `InstancedMesh` por parte rígida, com a skin escolhida por um índice de camada por instância. Um bobo inteiro custa cerca de 150 triângulos. [PADRÃO]
- **Física, colisão e navegação próprias**, em JS puro contra a grade (AABB varrido + DDA; grade 2,5D com A* + flow field). Nada de WASM no caminho crítico. [PADRÃO]
- **UI do jogo toda desenhada em WebGL** com texto MSDF, igual na web e no Switch e navegável por controle. DOM só no splash e num input escondido [DECIDIDO #3]; como exceção técnica da casca, fora da UI, um input de arquivo e um link de download para backup e relatório [PADRÃO] (seção 9).
- **Bots e humanos produzem o mesmo `InputFrame`.** A IA tem LOD e orçamento em unidades de trabalho, o que a mantém determinística.
- **Online só na web:** até 4 humanos, host autoritativo, Trystero com relays Nostr. O bundle do Switch não contém nenhum byte de rede. [DECIDIDO #1, #25]
- **No máximo 7 programas de shader:** blocos opacos, cutout, translúcido, instanciado, partículas, céu e UI. [PADRÃO]
- **Marcos:** M0 Fundação → M1 Cena-vitrine + Teste Zero na mesma cena → M2 MVP web solo → M3 Sofá → M4 Port do Switch → M5 Online P2P → M6+ modos de festa e conteúdo. [DECIDIDO #28]

---

## 1. Princípios de arquitetura

1. **Simulação separada da renderização.** É a regra do novelo e do gamebobo: "o 3D só lê o estado". A sim nunca chama render, áudio ou UI; ela só emite eventos.
2. **Regras do `novelo/CLAUDE.md` adotadas** [PADRÃO]:
   - passo fixo;
   - RNG com semente;
   - entrada como ações gravadas;
   - debug no F2;
   - `dispose()` total;
   - constantes em config;
   - saves versionados com migração.
3. **O Switch é o alvo mais restrito, e tudo é projetado para ele desde o dia 1** [DECIDIDO #1]. O código compartilhado é escrito para ele. A web ganha os extras por cima: online, toque, pointer lock e resolução dinâmica.
4. **Plataforma por injeção.** O código compartilhado só conversa com `Platform`, nunca com globais do navegador ou do nx.js.
5. **Todo modo é jogável sozinho com bots, em local e, quando fizer sentido, via P2P.** Requisito técnico: nenhum modo pode depender de `net`.
6. **Dados antes de código.** Armas, bots, modos, regras, perfis de movimento, blocos, modelos e perfis de desempenho são dados versionados e validados.
7. **Uma tabela de métricas manda sobre arte e técnica** (seção 7.1). Altura do bobo, degrau, coberturas e portas saem dela. [PADRÃO]
8. **Orçamentos são medidos, não estimados:** painel F2, bench headless, size-check no CI e Teste Zero.

---

## 2. Stack e alternativas

### 2.1 Escolhas

| Camada | Escolha | Justificativa | Plano B |
|---|---|---|---|
| Linguagem | TypeScript strict no padrão do VNbobo (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `erasableSyntaxOnly`) [PADRÃO] | Tipos compartilhados entre sim, rede, save e tools. O Node 24 roda os `.ts` das tools direto, como no novelo. | — |
| Render | three.js com `WebGLRenderer` (WebGL2), versão exata sem `^` [DECIDIDO #2] | Cerca de 86 KB gzip no build completo, menos com tree-shaking. Tela dividida por scissor é caminho documentado. O Erick já usa three (gamebobo 0.180, futbobo 0.186.1). | Renderer WebGL2 próprio e fino, viável porque usamos só 7 programas próprios |
| Runtime do Switch | nx.js (V8 + WebGL2 via EGL/Mesa/nouveau, em application mode) [DECIDIDO #2] | Mesmo JS da web. O Erick já tem o pipeline NRO/NSP do MMM. | Brewser, fork com mais DOM que declara rodar demos de three.js |
| Física e colisão | Própria: AABB varrido + DDA na grade de blocos, mais caixas e rampas das peças fora da grade [PADRÃO] | O mundo é uma grade. Custo mínimo, determinística, 0 KB de WASM. | — |
| Navegação | Própria: grade 2,5D + A* + flow field, pré-calculada no build [PADRÃO] | JS puro, barata e já casada com a grade. | navcat (JS, navmesh serializada) |
| Texturas | `TEXTURE_2D_ARRAY` (núcleo do WebGL2) com filtro nearest, para blocos e para skins/armas/props [PADRÃO] | Cada camada repete sozinha (wrap REPEAT) e tem mips próprios, sem sangrar vizinhas. Casa com o greedy meshing por textura. | Atlas 2D com padding e `textureGrad`, se o Teste Zero reprovar o array no nx.js |
| UI do jogo | Toolkit próprio em WebGL: MSDF, sprites, layout simples e foco [DECIDIDO #3] | Lição do MMM: os menus HTML tiveram que ser refeitos em canvas com DOM falso (`dom.js`, `menu.js`). | — |
| Rede (só web) | Trystero com relays Nostr (como no futbobo) + DataChannel não confiável [DECIDIDO #25, PADRÃO] | Já usado no futbobo (0.26), sem servidor de jogo. | ws-relay próprio |
| Compressão de assets | RLE + deflate (fflate) [PADRÃO] | Host estático não garante compressão de binários próprios, e `DecompressionStream` não está confirmado no nx.js. O MMM creator já usa fflate. | — |
| Bundler | Vite na web, esbuild no Switch | Padrão do gamebobo/VNbobo e do MMM | — |
| Testes | Vitest com projetos por pacote + playwright-core no Edge [PADRÃO] | Padrão do VNbobo | `node --test`, como no gamebobo |
| Áudio | Web Audio, só o subconjunto comum: Context, BufferSource, Gain, StereoPanner | É o que o nx.js oferece. | — |

### 2.2 Alternativas descartadas

- **Godot 4:** runtime web pesado demais para jogar em até 5 s no PC e 10 s no celular; no Switch só via ports; perde o pipeline JS do MMM.
- **Shallot e WebGPU:** sem caminho para o Switch.
- **PlayCanvas:** ótima na web, sem caminho para Switch.
- **Babylon.js:** maior e mais acoplada ao DOM.
- **Rapier e Jolt (WASM):** custo de download e de integração sem ganho num mundo de grade. Sem Worker no nx.js, também não haveria física em paralelo.
- **recast-navigation (WASM):** só valeria para reconstruir navmesh em runtime, e o cenário é estático.
- **Loaders prontos de modelo do three (GLTF e afins):** dependem de DOM ou de `TextureLoader` e trazem peso sem ganho. Todos os assets saem de scripts próprios em formatos próprios (seção 15).

### 2.3 Política de versões

- **Versões exatas, sem `^`** [PADRÃO].
  - Toda dependência nova entra em `docs/DEPENDENCIAS.md` e em `docs/CREDITOS.md` (seção 22).
  - Ela só é aceita se o build do Switch passar no `portcheck` (seção 21).
- **three.js:**
  - versão fixada no M0;
  - atualizar só em PR dedicado, rodando o bench e a cena do Teste Zero;
  - nunca usar `WebGPURenderer` nem TSL.
- **`@nx.js/*`:**
  - fixar a versão do dia do Teste Zero (hoje 1.0.0-beta.7; o MMM está na beta.6);
  - antes do port (M4), migrar para a 1.0 estável se ela já existir.
- **Node 24+**, para rodar `.ts` direto nas tools.

---

## 3. Estrutura do repositório (monorepo) [PADRÃO]

```
boboforces/
├─ package.json            # npm workspaces: packages/*, apps/*, tools/*
├─ tsconfig.base.json      # strict no estilo VNbobo
├─ version.json            # version, codename, releasedAt, formats { save, preset, bot, map, protocol }
├─ CHANGELOG.md · CLAUDE.md · README.md ("Todos os direitos reservados")
├─ docs/  DECISOES.md · GDD.md · ARCHITECTURE.md · PORTABILIDADE.md · PERF.md · DEPENDENCIAS.md · CREDITOS.md · PROMPTS.md
├─ .interface-design/system.md
├─ packages/
│  ├─ shared/        math, RNG com semente, pools, ring buffers, bitpack, log  (zero deps)
│  ├─ format/        schemas, validadores, migrações, decodificador PNG, IDs de conteúdo
│  ├─ world/         grade de blocos, catálogo de formas, chunks, RLE, DDA, colisão, luz, mesher (só gera arrays)
│  ├─ nav/           grade 2,5D, A*, flow field, pontos táticos, portas que abrem e fecham
│  ├─ sim/           mundo ECS-lite, sistemas, movimento, armas, dano, regras, modos
│  ├─ ai/            cérebros de bot (utility), modelo de mira, percepção, blackboard, diretor
│  ├─ input/         ações, InputFrame, perfis de controle, entrada local 1-4, assistência de mira
│  ├─ ui/            árvore de UI, layout, foco, telas -> DrawList (sem GL); tabela de textos pt-BR
│  ├─ audio/         mixer sobre o subconjunto comum de Web Audio, síntese de efeitos
│  ├─ render/        ÚNICO pacote que importa three: chunks, texture arrays, instâncias, fx, viewports, DrawList
│  ├─ game/          fluxo (boot -> menu -> lobby -> partida), cola dos pacotes, LocalDriver
│  ├─ platform-api/  só tipos: Platform, Storage, Assets, Files, OnlineService, TextInput, Lifecycle, Diagnostics
│  └─ net/           SÓ WEB: transporte, snapshots, predição, lobby (implementa OnlineService)
├─ apps/
│  ├─ web/           Vite, index.html com splash inline, platform-web, service worker, manifest
│  └─ switch/        esbuild -> romfs/main.js, platform-switch, scripts NRO/NSP herdados do MMM
├─ tools/  texgen · skingen · modelgen · mapc · mapview · fontbake · logo · credits · assetcheck · balance · bench · size-check · portcheck
├─ assets-src/       scripts de textura, modelo e mapa (TS), fontes OFL, sons CC0; o gerado vai para build/
└─ local/            privado e fora do git (padrão do novelo): config do Eden, chaves, logs
```

**Grafo de dependências** (versão estendida da regra do gamebobo, `data → engine → features → app`):

- `shared → format → world → nav → sim → ai → {input, ui, audio, render} → game → apps/*`
- `net` depende de `sim`, `format` e `platform-api`. Só `apps/web` importa `net`.

**Como isso é garantido (não fica só no papel):**

1. Os pacotes puros (`shared`, `format`, `world`, `nav`, `sim`, `ai`, `input`, `ui`) compilam com `"lib": ["ES2023"]`, **sem `DOM`**.
   - Qualquer `window`, `document`, `localStorage`, `fetch` ou `HTMLElement` vira erro de tipo.
   - Eles rodam em Node puro nos testes.
2. `render`, `audio`, `game` e `net` têm a lib DOM (por causa dos tipos do three e do WebRTC), mas o ESLint aplica duas regras:
   - `no-restricted-globals`: `document`, `window`, `localStorage`, `navigator`, `location`, `Worker`, `RTCPeerConnection`, `WebSocket`. No `net` vale a mesma lista, exceto `RTCPeerConnection` e `WebSocket`, que só ele pode usar; o armazenamento do `net` passa por `platform.storage`, como em todo o resto;
   - `no-restricted-imports`: three só em `render`, trystero só em `net`, `net` só em `apps/web`.
3. `tools/portcheck` faz o build do `apps/switch`, varre o bundle atrás de identificadores proibidos e dá boot no `game` em `node:vm` com globais falsos do nx.js. É a evolução do `test/platform.test.mjs` do MMM.

**Convenções** [PADRÃO]:

- Identificadores em inglês; docs, comentários e textos de UI em pt-BR.
- Prettier com printWidth 120 e aspas simples.
- Todo texto de interface sai da tabela de chaves `strings.pt-BR.ts`, desde o primeiro dia. Só pt-BR [DECIDIDO #14].
- Nada de commit ou push sem pedido do Erick; `docs/DECISOES.md` só muda com resposta dele; fixtures sintéticas; relatório ao final de cada entrega.

---

## 4. Simulação

### 4.1 Modelo: ECS-lite próprio (sem biblioteca)

- **Estrutura:**
  - mundo com componentes "quentes" em typed arrays (SoA), com capacidade fixa;
  - `EntityId` = índice + geração;
  - sistemas são funções puras numa ordem fixa.
- **Por que assim:**
  - zero GC no laço quente (pausa de GC é risco real no Switch);
  - snapshot e delta para a rede viram cópia de arrays;
  - a ordem fica determinística;
  - cerca de 300 a 500 linhas. Uma biblioteca como bitECS seria dependência sem ganho nessa escala.
- **Componentes quentes:** Transform (posição, velocidade, yaw, pitch), Body (AABB, flags de chão), Health, WeaponState, Team, Controller (slot humano ou id de bot), Projectile, Pickup, Trigger, Door (estado de portas e barricadas).
- **Dados frios** (perfil do bot, nomes, aparência) ficam em objetos comuns, referenciados por índice.
- **Capacidades do motor:**
  - 1.024 entidades;
  - humanos: até 4 (locais, ou remotos no online) [DECIDIDO #1, #25];
  - bots: **64**, limitado pelo teto do perfil da plataforma (seção 16.1) [PADRÃO];
  - projéteis: 512;
  - pickups: 256.
- **Ordem fixa dos sistemas por tick:**
  - (0) a IA gera os InputFrames dos bots;
  - (1) aplicar InputFrames;
  - (2) movimento e colisão;
  - (3) armas;
  - (4) projéteis;
  - (5) dano e morte;
  - (6) regras do modo;
  - (7) spawns, ondas, portas e zona;
  - (8) Diretor de Partida (M6+, desligado por padrão);
  - (9) emitir eventos.

### 4.2 Passo fixo

- **`SIM_HZ = 60`** [PADRÃO]. No Switch cai para 30 se o Teste Zero exigir [T0].
  - Todas as velocidades ficam em unidades/s, e os timers são convertidos para ticks ao carregar.
  - Assim o Switch pode usar `SIM_HZ = 30` sem rebalancear os dados.
- **Laço:**
  - acumulador com no máximo 4 passos por frame;
  - frame limitado a 0,1 s (também protege a volta de HOME, sleep e aba oculta);
  - o render interpola o estado anterior e o atual com `alpha`.
- **Câmera:**
  - yaw e pitch são aplicados em todo frame de render, sem esperar o tick;
  - entram no próximo InputFrame como **ângulos absolutos**;
  - a mira não ganha latência mesmo com tick de 30 Hz.
- **Pausa:** solo e local pausam a sim. Online PvP nunca pausa. Online coop pausa quando o host pausa ou vai para segundo plano (seção 13.4). [PADRÃO]
- **Aceleração do Aquário (M6+):** limitada pelo teto de 4 passos por frame. Até 4x no PC (60 fps de render com sim a 60 Hz) e 2x no Switch (30 fps de render já gastam 2 passos por frame). [PADRÃO]

### 4.3 Determinismo: na medida certa

- **Necessário** dentro da mesma build e plataforma, para:
  - testes golden;
  - robô de balanceamento;
  - "Surpreenda-me" por semente;
  - reprodução de bugs (replay de debug no F2).
- **Não necessário:**
  - para o netcode, porque o host envia snapshots;
  - entre plataformas: `Math.sin`/`cos` podem variar entre motores JS, então nada pode depender disso.
- **Regras:**
  - RNG com semente, um fluxo por domínio (`rng.match`, `rng.bot[i]`, `rng.loot`), com mulberry32/sfc32 como no gamebobo;
  - proibido `Math.random`, `Date.now` e `performance.now` em `sim`, `ai`, `nav` e `format`;
  - iteração por índice;
  - nada de async dentro do passo;
  - orçamentos de IA em **unidades de trabalho** (nós de A*, raios), nunca em ms.
- **Replay de debug** = receita + semente + versão + sequência de InputFrames humanos. Os bots são re-simulados. Replays são ferramenta de debug (F2), não recurso do jogador, e ficam inválidos quando a versão muda [PADRÃO].

### 4.4 Fronteira da sim

```ts
interface Sim {
  readonly tick: number;
  step(inputs: ReadonlyArray<InputFrame | null>): void; // exatamente 1 tick
  view(): SimView;                                      // leitura para render/ui/ai/input
  drainEvents(out: SimEvent[]): void;                   // tiro, acerto, morte, som, decal, porta, onda
  writeSnapshot(w: BitWriter, baseline?: SnapshotRef): void;
  readSnapshot(r: BitReader): void;
}
```

- **Cosméticos ficam fora da sim:** detritos (cubinhos), o bobo se desmontando, partículas, cápsulas de bala e decals. Eles têm RNG próprio e não são sincronizados.
- **Modos são dados + ganchos:**
  - forma: `ModeDef { id, teams, winRules, economy?, waves?, zone?, capabilities: { online, maxLocal: 4, minHumans: 0 }, hooks: { onTick, onKill, onRoundEnd } }`;
  - `minHumans: 0` em todo modo, para que seja jogável só com bots (inclusive no Aquário, M6+).
  - IDs estáveis em inglês; o nome exibido vem da tabela de textos: `warfare.tdm`, `warfare.ffa`, `warfare.domination` (Bobo Warfare), `strike` (BoboStrike), `royale.mini` (Bobo Royale), `paintball` (Bobo Paintball), `zombies` (Bobo Zombies), `sandbox` (Bobo Sandbox), `juggernaut` (Bobo Juggernaut), `chaos` (Bobo Chaos), `training` (Bobo Training). [DECIDIDO #15]
- **A receita de partida (`MatchRecipe`, seção 14.2) é a única entrada da sim.** Menu, preset, "Surpreenda-me", "Partida Rápida" e lobby online geram a mesma receita.

### 4.5 Anti-frustração na sim [PADRÃO]

- **Morte abaixo do mapa:** plano de morte 10 m abaixo do menor bloco do mapa; limites do mundo são paredes invisíveis declaradas no mapa.
- **Botão "destravar"** (menu de pausa): teleporta o jogador ao nó de navegação livre mais próximo. Offline, na hora; no online PvP, 3 s parado e vulnerável, com recarga de 30 s (regra da `gameplay.md` 11). No online, o host executa.
- **Bot ou zumbi parado há 8 s sem progresso** no caminho: é teleportado ao nó de navegação mais próximo, fora da visão dos humanos.
- **Último zumbi da onda** corre até os jogadores e ganha marcador.
- **Rounds do BoboStrike** (M6+) têm limite de tempo.

---

## 5. Mundo de blocos

### 5.1 Grade e densidade de textura

| Item | Valor | Marcação |
|---|---|---|
| Célula da grade de construção, colisão e navegação | **0,5 m** | [DECIDIDO #6] |
| Textura por face de bloco | **16×16 px** (32 px/m), filtro nearest | [DECIDIDO #6] |
| Menor passo das formas e dos props | 1/16 de célula = 3,125 cm = 1 texel do cenário | [PADRÃO] |
| Chunk de dados | 32³ células = 16×16×16 m | [PADRÃO] |
| Região de render (mapas estáticos) | 2×2×1 chunks = 32×32×16 m, numa malha só por programa | [PADRÃO][T0] |
| Skins de bobo | 64×64 px com camada externa; 16 px/m no boneco | [PADRÃO] |
| Armas e props | textura pixel-art a 32 px/m, a mesma densidade do cenário | [PADRÃO] |

- A densidade do bobo (16 px/m, cabeça de 8×8 px por face) é metade da do cenário. É intencional: o boneco lê melhor numa viewport de 640×360 e a skin cabe em 64×64. A aprovação final vem pelos prints da cena-vitrine (M1) [DECIDIDO #6].
- O cenário é **estático** [DECIDIDO #4]: a grade é carregada uma vez, a malha é montada no loading e nunca mais muda durante a partida. Portas e barricadas do Zombies são entidades com colisor próprio (seção 7.3), não edições da grade.

### 5.2 Célula e catálogo de formas

- **Célula = `u16`:** `blockId` (10 bits, até 1.024 tipos) + orientação (2 bits de giro em Y + 1 bit de inversão vertical) + 3 bits reservados.
- **`BlockDef` (dados, em `format`)** guarda forma, camada de textura por face, flags e som de passo:
  - flags: sólido, cutout, translúcido, emissivo, bloqueia bala, bloqueia visão, andável, variação de cor, animado (N quadros);
  - IDs estáveis (`block:concrete`, `block:crate`…) que nunca mudam (seção 14.5).
- **Catálogo de formas dentro da célula** (vai na malha do chunk, sem draw call extra):

| Forma | Uso | Programa | Colisão | Navegação |
|---|---|---|---|---|
| Cubo | paredes, chão, caixotes | opaco | célula cheia | chão andável |
| Laje (meio bloco) e degrau | escadas, bordas, mesas | opaco | 1 ou 2 caixas | andável |
| Rampa 1:1 e 1:2, quinas de rampa | rampas e telhados | opaco | plano inclinado (altura do piso por posição) | andável |
| Painel fino | cerca de tela, grade, vidro fino | cutout ou translúcido | caixa fina | bloqueia |
| Poste + travessa | cerca de madeira, corrimão | opaco ou cutout | caixas finas | bloqueia |
| Cruz | grama alta, flores, arbustos | cutout | nenhuma | não bloqueia |

- **Props fora da grade** (cilindros de qualquer uso, inclusive canos e colunas; barris, postes redondos, árvores low-poly, caixas d'água, tendas, jipe, holofote, gerador): modelos low-poly com textura pixel-art nas camadas 64×64 de `modelos64` (32 px/m), desenhados pelo programa instanciado (seção 6.6). Cada prop declara colisão (lista de caixas; cilindro vira caixa envolvente), se bloqueia bala e quais células de navegação ocupa. Não existe colisor cilíndrico: a colisão de peças fora da grade é só caixa ou rampa [PADRÃO: Física e navegação; DECIDIDO #7].
- **Quando usar o quê** (regra única, igual em `arte-ux.md` 1.4 e no GDD 5.2) [PADRÃO]: forma de catálogo quando a peça cabe na célula e repete muito (fica na malha do chunk, custo zero de draw call); prop quando tem silhueta própria, é redondo ou é grande. Cilindro nunca vai para o chunk: um de 12 lados estoura a tabela de 32 normais do vértice compacto (6.2). A quantidade de peças fora da grade é aprovada por prints na cena-vitrine [DECIDIDO #6].

### 5.3 Chunks e memória

- **Em memória:** chunk vazio ou uniforme guarda só 1 valor; os outros ficam descompactados em `Uint16Array(32768)` (64 KB) para consulta rápida de colisão.
- **Luz por célula** (calculada no loading, seção 6.4): 1 byte (céu 4 bits + emissivo 4 bits) + 1 bit de sol, só nos chunks não vazios.
- **Estimativas:**

| Mapa | Dimensão | Células | Chunks (não vazios, estimado) | Memória da grade |
|---|---|---|---|---|
| Arena pequena | 40×40×16 m | 80×80×32 | 9 (~7) | ≤ 0,5 MB |
| Construto (arena média) | grade de 80×80×24 m (área jogável ~72×72 m e até 12 m de altura) | 160×160×48 | 50 (~30) | ≤ 2 MB |
| Bobo Royale Mini | ~200×200×32 m | 400×400×64 | 338 (~150) | ≤ 10 MB |

- O Royale Mini de ~200 m em todas as plataformas [DECIDIDO #35] cabe com folga na grade de 0,5 m. A memória que pesa é a malha (seção 16.3).

---

## 6. Renderer e tela dividida

### 6.1 Texturas: arrays, filtro e mips [PADRÃO]

- **Dois `TEXTURE_2D_ARRAY` RGBA8** (núcleo do WebGL2, `DataArrayTexture` no three):

| Array | Tamanho da camada | Camadas | Conteúdo | Memória com mips |
|---|---|---|---|---|
| Blocos (`blocos16`) | 16×16 | até 256 (mínimo garantido de `MAX_ARRAY_TEXTURE_LAYERS`) | faces de bloco, formas do catálogo | ≈ 350 KB |
| Modelos (`modelos64`) | 64×64 | até 128, subindo se o T0 deixar | armas, acessórios 3D, props fora da grade, partes de skin, skins compostas dos bobos, folha de rostos, camada branca dos detritos | ≈ 2,7 MB |

- Os nomes `blocos16` e `modelos64` são os mesmos da `arte-ux.md` 1.6.

- **Filtro:** magnificação `NEAREST`; minificação `NEAREST_MIPMAP_LINEAR`, para o pixel-art não cintilar ao longe. Sem anisotropia (não existe sem extensão).
- **Repetição:** wrap `REPEAT` dentro da camada. É isso que deixa o greedy meshing juntar faces de vários blocos num quad só, com a textura repetindo a cada 0,5 m.
- **Mips:** gerados pelo `tools/texgen` e enviados nível a nível. Nas camadas cutout, o mip preserva a cobertura do alfa, para a folhagem não sumir ao longe. Camadas opacas podem usar `generateMipmap` como atalho.
- **Decodificação:** as imagens chegam como PNG [PADRÃO] e são decodificadas pelo próprio jogo (decodificador PNG em `format`, sobre o inflate do fflate) direto para `Uint8Array`. Assim os arrays não dependem de `Image`, `ImageBitmap`, `OffscreenCanvas` nem `getImageData`.
- **Texturas animadas** (água, telas, lava de brinquedo): o bloco declara N quadros em camadas seguidas e o shader soma `floor(tempo × fps) mod N` à camada.
- **Plano B, se o Teste Zero reprovar o array no nx.js** [T0]:
  - atlas 2D com células de 16×16 e 4 px de padding (blocos) e de 64×64 (modelos);
  - repetição feita no shader com `fract()` e `textureGrad`, para o mip não quebrar na emenda;
  - no máximo 2 níveis de mip;
  - a troca fica atrás de um `#define ATLAS` nos mesmos 7 programas.

### 6.2 Mesher: greedy meshing por textura [PADRÃO]

- **Mesher próprio**, que só gera arrays (pacote `world`), com AO por vértice (método 0fps) e troca da diagonal do quad quando o AO pede.
- **Só funde faces com:** a mesma camada de textura, o mesmo AO nos 4 cantos e os mesmos canais de luz. A cor nunca vem do bake (seção 6.4), para não quebrar a fusão.
- **UV no shader, não no vértice:** `uv = vec2(dot(p, T), dot(p, B)) × 2`, com a tangente `T` e a bitangente `B` vindas de uma tabela de até 32 normais (6 eixos, 4 diagonais das cruzes, rampas 1:1 e 1:2). Funciona igual para quads fundidos e para as faces inclinadas das rampas, sem esticar a textura.
- **Formas do catálogo** entram na mesma malha, com vértices no passo de 1/16 de célula.
- **Malha por região e por programa:** cada região de 32×32×16 m gera até 3 malhas (opaca, cutout, translúcida).
- **Quando:** no cliente, durante o loading, de forma fatiada (download menor, JIT rápido). No Switch, opção de pré-malhar no build se o loading do Construto passar de 4 s [T0].
- **Sem remesh durante a partida** [DECIDIDO #4].

### 6.3 Vértice compacto do cenário: 12 bytes [PADRÃO]

| Bytes | Campo |
|---|---|
| 0–5 | Posição local em 3×u16, no passo de 1/16 de célula (1 texel) |
| 6 | Normal (5 bits, índice da tabela) + AO (2 bits) + variação de cor ligada (1 bit) |
| 7 | Camada da textura (u8) |
| 8 | Luz do céu (4 bits) + luz do sol (4 bits) |
| 9 | Emissivo (4 bits) + flags (4 bits: animado, balança com vento) |
| 10–11 | Reservado |

- O formato padrão do three com posição, normal, UV e cor em float daria cerca de 44 bytes.
- Os campos são lidos como inteiros (`vertexAttribIPointer`, `gpuType: IntType` no three) ou como float com decodificação no shader. Qual dos dois funciona no nx.js é item do Teste Zero [T0].

### 6.4 Luz em canais [PADRÃO]

- **Canais separados por vértice:** AO, céu, sol e emissivo.
  - **Céu:** flood fill a partir do céu aberto (0–15), que deixa interiores mais escuros.
  - **Sol:** visibilidade do sol por varredura na direção do sol declarada pelo mapa (1 bit por célula, suavizado nos vértices).
  - **Emissivo:** flood fill a partir de blocos emissivos (lâmpadas, letreiros), que é o que acende a noite.
  - Tudo calculado no loading, junto com a malha.
- **Cor final:** `albedo × variação × (AO × (céu × corCéu + sol × max(N·L, 0) × corSol) + emissivo × corEmissiva)`, seguida de fog linear.
  - `N·L` sai da normal da tabela, no shader. Por isso **dia, entardecer e noite** são só uniforms (cor do sol, do céu, do emissivo e da fog), sem refazer nada.
- **Variação de cor:** hash da posição do bloco no shader (±3% de brilho), só em blocos que pedem. Nunca no bake.
- **Personagens, props instanciados e objetos dinâmicos:** amostram uma grade de luz ambiente (células de 2 m com céu, sol e emissivo), derivada da luz por célula, e usam a normal da própria malha para o `N·L`. Um bobo dentro de prédio fica mais escuro sem luz dinâmica.
- **Props emissivos** (holofote, gerador ligado) declaram no `.bfmap` uma fonte de luz que entra no flood fill do emissivo.
- **Sombra de personagem:** blob, um quad radial no programa de partículas.

### 6.5 Programas de shader: no máximo 7 [PADRÃO]

| # | Programa | Usado em |
|---|---|---|
| 1 | Blocos opacos | malha opaca das regiões |
| 2 | Blocos cutout (`discard` com alfa < 0,5) | cercas, grades, folhas, vegetação em cruz |
| 3 | Translúcido | vidro e água, malha separada por região, desenhada depois e ordenada por região (sem ordenar triângulos) |
| 4 | Instanciado | partes e quad de rosto dos bobos, armas, acessórios, props fora da grade, detritos (cor sólida por instância), viewmodel (alfa por `discard` para a camada externa da skin) |
| 5 | Partículas e quads | fumaça, faíscas, clarão, traçante, confete, sombra blob, decals de tiro e de tinta |
| 6 | Céu | gradiente, disco do sol e nuvens pixeladas; a fog usa a cor do horizonte |
| 7 | UI | texto MSDF e sprites |

- Todos com `RawShaderMaterial`/`ShaderMaterial` e fog própria por uniform, para o cache de programas do three não criar variantes. O F2 e o e2e conferem `renderer.info.programs.length ≤ 7`.
- **Compilados e aquecidos na tela de loading** (desenha 1 frame fora da tela), porque o Switch não tem `KHR_parallel_shader_compile`.
- **Proibidos:** EffectComposer, render targets float/half-float, shadow map, texturas comprimidas, anisotropia, luzes dinâmicas do three e leitura de textura no vertex shader.
- **Casco invertido para contorno de time:** fora do orçamento base, porque somaria ~7 draw calls por viewport; avaliado no M1 por print + medição (`arte-ux.md` 2.6). Se entrar, usa o próprio programa instanciado, sem programa novo. Sem ele, a separação vem da luz e do bevel de 1 px dos materiais modulares (`arte-ux.md` 1.3); materiais contínuos não têm borda, e as skins têm contorno interno só onde uma peça termina.

### 6.6 Personagens, armas, props e detritos

- **Bobo de caixas** [DECIDIDO #7, #18]: 6 partes rígidas (cabeça, tronco, 2 braços, 2 pernas), cada uma com uma caixa interna e uma externa (chapéu, cabelo, roupa) na mesma geometria, mais um **quad de rosto** rente à frente da cabeça (7ª parte).
  - Cerca de 150 triângulos por bobo (6 partes × 2 caixas × 12, mais o quad do rosto), sem a arma.
  - Layout da skin 64×64: o da `arte-ux.md` 2.2, só com camada interna e externa (o rosto não fica na skin). A forma final das caixas de tronco e membros é decidida no M1 por print (GDD 9.1); fixos só 1,5 m de altura e cabeça de 0,5 m (8×8×8 px).
- **Um `InstancedMesh` por parte** [PADRÃO]: 7 draw calls para todos os bobos em cada viewport (6 partes + rosto), mais 1 por modelo de arma visível e 1 por tipo de acessório 3D visível.
  - **Atributos por instância:** matriz, camada da skin no array de modelos, luz amostrada (céu, sol, emissivo), flash de dano, cor de contorno (só se o casco for aprovado no M1) e, no quad do rosto, estilo e expressão.
  - **Rosto e expressões:** o quad do rosto lê a **folha de rostos** (uma camada 64×64 de `modelos64`: 8 estilos × 8 expressões). Estilo e expressão deslocam a UV no vertex shader, só com conta sobre o atributo, sem ler textura no vertex shader [PADRÃO: Render de personagens]. Trocar expressão não recompõe a skin.
  - **Nada de textura de ossos:** a técnica de malha única com matrizes numa textura de dados está descartada.
- **Skins compostas no loading:** base + cabelo + chapéu + roupa com padrão e cores + cor do time, montadas em JS sobre `Uint8Array` e enviadas para uma camada do array de modelos (`texSubImage3D`). O rosto fica fora da skin.
  - Bots com a mesma aparência dividem a camada. Zumbis usam poucas skins.
  - Teto: 64 camadas de skin na web e no Switch, a confirmar [T0].
- **Animação procedural:** seno no andar, rotação com a mira, recuo, agachar, squash no pouso.
- **As matrizes de instância são atualizadas uma vez por frame, não por viewport.** Com 64 bots × 7 partes × 64 B, são cerca de 29 KB por frame.
- **Esconder o próprio corpo em 1ª pessoa:** antes de desenhar a viewport do jogador *i*, as instâncias dele recebem escala zero (7 uploads pequenos) e voltam depois. Em 3ª pessoa nada é escondido.
- **Armas:** modelos de caixas com textura a 32 px/m, sem marcas reais [DECIDIDO #10]. **Um modelo só** serve ao viewmodel e à 3ª pessoa: até 600 triângulos, a maioria abaixo de 300 (GDD 5.5, `arte-ux.md` 3.2).
- **Props fora da grade (estáticos):** `InstancedMesh` por tipo, dividido em grupos espaciais de 32 m para o culling funcionar, com textura nas camadas de `modelos64`. Meta de até 15 draw calls de props por viewport, 8 no Switch 3–4P [T0].
- **Morte cartunesca** [DECIDIDO #9]: as 6 partes viram corpos Verlet contra a grade (o bobo "se desmonta") e somem em 4 s, mais cubinhos e confete.
  - **Detritos:** pool de cubinhos no programa instanciado, com **cor sólida por instância** que a CPU lê no texel atingido (bloco, skin ou prop) no ponto do acerto. O cubinho não amostra textura: usa a camada branca de `modelos64` multiplicada pela cor. Mesmo pipeline da `arte-ux.md` 4.1. Tamanho do pool por perfil (seção 16.1).
  - **Opção de sangue** nas configurações: cubinhos e manchas vermelhas, pelos mesmos pools.
- **Bobos-zumbi** [DECIDIDO #31]: o mesmo boneco com skins esverdeadas e pose curvada nas matrizes das partes.

### 6.7 Câmera, ADS e viewmodel

- **1ª pessoa por padrão e 3ª pessoa opcional** [DECIDIDO #12]. A 3ª pessoa usa um braço de câmera com DDA contra a grade para não atravessar parede.
- **Zoom (ADS) em todas as armas** [DECIDIDO #11]: muda o FOV da viewport e a sensibilidade; uma regra de partida desliga.
- **Viewmodel** (arma e braços em 1ª pessoa): desenhado por viewport depois do mundo, com `clear` de profundidade restrito ao scissor e FOV próprio, pelo programa instanciado.

### 6.8 Tela dividida (1 a 4 viewports)

- **Um canvas/framebuffer.** Para cada viewport:
  1. `setViewport` + `setScissor` + `setScissorTest(true)`;
  2. culling das regiões e grupos de props contra o frustum daquela câmera;
  3. céu e mundo (opacos de frente para trás, depois cutout, depois translúcidos);
  4. personagens, detritos e partículas;
  5. viewmodel;
  6. HUD (DrawList em câmera ortográfica).
- **Layouts** [PADRÃO]:
  - 1 jogador: tela cheia;
  - 2 jogadores: divisão horizontal (cima/baixo), com opção vertical;
  - 3 jogadores: 2×2, com o 4º quadrante mostrando placar e minimapa;
  - 4 jogadores: 2×2.
  - Teclado+mouse contam como 1 slot. O detalhe visual fica com a frente de Arte e UX.
- **FOV:** Hor+ com limites. Dois jogadores na horizontal dão 32:9, então o FOV vertical tem um mínimo.
- **Trabalho feito uma vez por frame:** animação, instâncias e partículas.
- **Trabalho feito por viewport:** só culling, uniforms e draw.
- **Opacos de frente para trás**, porque o nouveau não tem Zcull. O three já ordena por profundidade quando o programa é o mesmo; conferir com `renderer.info` no T0.

### 6.9 Distância de visão [PADRÃO]

- **O alcance é regra da partida**, igual para humanos e bots (é também o alcance de percepção dos bots). O perfil da plataforma só define o **teto**:

| Perfil | Teto de visão |
|---|---|
| PC | 140 m |
| Celular | 90 m |
| Switch 1P | 90 m |
| Switch 2P | 70 m |
| Switch 3–4P | 50 m |

- O plano distante da câmera e o fim da fog ficam em `min(regra, teto)`.
- **Mapas declaram a maior linha de visão.** Se ela passar do teto do perfil em uso, o lobby avisa ("visão limitada a 50 m neste modo de tela").
- **Online com aparelhos diferentes:** a partida usa o menor teto entre os participantes, para ninguém enxergar mais longe que o outro.
- Qualidade Leve e economia de bateria podem baixar a visão abaixo do teto, nunca acima (seção 17).
- É o principal regulador de custo: com 4 viewports o que escala é CPU e vértices, não pixels.

### 6.10 Resolução e anti-aliasing [PADRÃO]

- **PC:** `antialias: true` (MSAA nativo do navegador), DPR até 2, escala dinâmica.
- **Celular:** sem AA, DPR de 1 a 1,5, escala dinâmica.
- **Escala dinâmica (web):** resolução = DPR × `renderScale`, reavaliada a cada 2 s pelo p90 do tempo de frame contra o alvo, com histerese de ±10% e degraus de 0,1.
- **Switch:** **720p fixo, sem AA**, até o Teste Zero aprovar algo melhor [T0].
  - Sem escala dinâmica, porque ela exigiria render target + blit.
  - Candidato a teste: FBO multisample RGBA8 2× com `blitFramebuffer` (núcleo do WebGL2), só se sobrar GPU.
  - A qualidade se ajusta pelo perfil: visão, detritos, partículas e bots.

### 6.11 three.js no nx.js (hipótese a validar no T0)

```ts
const gl = screen.getContext('webgl2'); // null fora do application mode
const canvas = { width: screen.width, height: screen.height, clientWidth: screen.width, clientHeight: screen.height,
  style: {}, addEventListener() {}, removeEventListener() {}, getContext: () => gl };
const renderer = new WebGLRenderer({ canvas: canvas as any, context: gl, antialias: false });
```

- **Nunca usar `TextureLoader` nem `ImageLoader`**, porque eles usam `document`. As texturas vêm do decodificador PNG próprio, como `DataArrayTexture` ou `DataTexture`.
- **No T0, registrar todo `console.warn`** de extensão ausente.

---

## 7. Física e colisão

### 7.1 Tabela de métricas (config única) [PADRÃO]

| Métrica | Valor | Em células de 0,5 m |
|---|---|---|
| Altura do bobo (cabeçudo, ~3 cabeças) [DECIDIDO #18] | 1,5 m | 3 |
| Altura do olho | 1,3 m | — |
| Agachado / olho agachado | 0,95 m / 0,8 m | ~2 |
| Cabeça | ~0,5 m | 1 |
| AABB de movimento | 0,6 × 1,5 × 0,6 m (0,95 m agachado) | — |
| Degrau automático | 0,5 m | 1 |
| Pulo padrão | 1,0 m | 2 |
| Cobertura baixa (esconde agachado) | 1,0 m | 2 |
| Cobertura alta (esconde em pé) | ≥ 1,75 m | 4 |
| Porta | 1,0 × 2,0 m | 2 × 4 |
| Corredor mínimo | 1,0 m | 2 |

### 7.2 Movimento e tiro

- **Personagem:**
  - AABB varrida eixo a eixo contra a grade, no estilo Minecraft, considerando as caixas das formas do catálogo e dos props;
  - em rampa, a altura do piso vem do plano da forma, para subir e descer liso;
  - degrau automático de 0,5 m;
  - coyote time e buffer de pulo como parâmetros.
- **Movimento é dado** [DECIDIDO #8]: `MovementProfile { walk, sprint, crouch, accel, airControl, friction, jump, gravity, slide?, wallJump?, doubleJump?, bhop? }`.
  - Padrão arcade rápido (correr, pular, deslizar); regras de partida ligam bhop, wall jump, pulo duplo ou deixam mais lento e tático.
  - Regras como gravidade lunar multiplicam esses valores.
- **Hitscan:**
  1. DDA na grade até o primeiro sólido que bloqueia bala (testando a forma dentro da célula e os colisores de props), o que define a distância máxima;
  2. raio contra as hitboxes das entidades: cabeça, tronco e membros, como caixas orientadas pelo yaw.
  - As entidades ficam num hash espacial uniforme de 4 m.
  - No MVP, todo bloco sólido bloqueia bala, sem penetração.
- **Headshot** (dado por arma, calibrado pelo robô de balanceamento): padrão **1,5x**; sniper **2,0x**; escopeta **1,25x**. A cabeça de 0,5 m é um alvo grande, por isso o padrão é menor que o de FPS comum. [DECIDIDO #18, PADRÃO]
- **Projéteis** (granada e foguete no MVP; paintball no M6+):
  - balística própria por tick;
  - segmento varrido com DDA + teste de hitbox;
  - quique simples para granada.
- **Explosão:** esfera + raio de oclusão até cada alvo. Não altera o cenário [DECIDIDO #4].

### 7.3 Colisores dinâmicos

- **Portas que abrem áreas e barricadas do Zombies** [DECIDIDO #30]: entidades com AABB e estado (fechada, aberta, quebrada, reconstruída).
- A colisão consulta a grade e depois a lista curta de colisores dinâmicos, indexada pelo hash espacial.
- A navegação tem links ligados a cada porta (seção 8.1); abrir a porta só liga o link, sem recalcular nada.
- Decals de tinta do Bobo Paintball (M6+) são cosméticos, com teto por perfil, e não mexem em colisão. [PADRÃO]

---

## 8. Navegação e IA de bots

### 8.1 Navegação [PADRÃO]

- **Grade 2,5D sobre a grade de 0,5 m.**
  - Cada coluna pode ter vários "spans" andáveis: piso sólido (ou rampa, laje, degrau) embaixo e 1,5 m livres em cima (0,95 m para spans só agachado).
  - **Nós nos cantos da grade:** cada nó representa um quadrado de 2×2 células (1,0 × 1,0 m). Um bobo de 0,6 m cabe nele, e uma porta de 1,0 m tem exatamente um nó no meio.
  - Conexões: degrau de até 0,5 m andando; até 1,0 m com pulo; queda de até 3 m.
  - Props marcam como bloqueados os nós que ocupam.
- **Pré-calculada no build** (`tools/mapc`) e enviada junto com o mapa. Como o cenário é estático, não existe reparo em runtime; portas só ligam e desligam links.
- **A\*:**
  - heurística octile;
  - fila de pedidos com orçamento de nós por tick;
  - caminho suavizado por linha de visada.
- **Flow field multi-fonte** (Dijkstra a partir de todos os humanos) para hordas do Zombies: 1 campo compartilhado, reconstruído em fatias.
- **Pontos táticos bakeados:** cobertura baixa e alta, emboscada, 2 ou 3 rotas de flanco entre áreas, pontos altos e pontos de sniper.
- **Desvio entre bots:** separação pelo hash espacial, sem RVO.

### 8.2 Arquitetura da IA (base do Laboratório)

- **Cada bot é um `BotProfile`** (dados) que gera `InputFrame` igual a um humano. Mesmas regras e mesmo código de movimento, com justiça e replays de graça.
- **Quatro eixos independentes + visual** [DECIDIDO #29], que viram blocos separados do perfil: `intelligence` (inteligência tática), `skill` (habilidade mecânica), `personality` e `rules` (regras e vantagens), mais `look`.
- **Três camadas de execução:**
  1. **Decisão (utility AI),** a 1–10 Hz conforme o LOD.
     - Ações: atacar, cobertura, flanquear, emboscar, recuar, recarregar, pegar item, seguir aliado, objetivo do modo.
     - Pesos vêm da personalidade.
     - A inteligência tática liga ou desliga ações e define o uso de informação do time.
  2. **Execução,** a cada tick: máquina de estados curta + steering (seguir caminho, strafe, pulo, agachar).
  3. **Mira e tiro (modelo de habilidade):** tempo de reação, velocidade de giro, erro gaussiano por distância e movimento do alvo, atraso de rastreio, controle de recuo, preferência por cabeça, disciplina de rajada e chance de erro.
- **Dificuldade rápida em 5 níveis** [DECIDIDO #21]: Pela vibe, De boa, Normal, Suado, Tryhard. Cada nível é um preset dos 4 eixos guardado em dados (IDs `vibe`, `chill`, `normal`, `sweaty`, `tryhard`). A primeira partida usa De boa. O robô de balanceamento garante a ordem no CI.
- **Bots sem falas** [DECIDIDO #34]. Intenção e humor aparecem só pela expressão do rosto e pela postura.
- **Time:**
  - blackboard por time, com últimas posições conhecidas (com decaimento), rotas reservadas e avisos internos com atraso;
  - "comunicar" significa usar esse blackboard, sem texto nem voz.
- **"Aprende padrões":** mapa de calor por partida (células de 4 m, valor em config) de onde os humanos aparecem e matam. Barato e determinístico.
- **Diretor de Partida (M6+)** [PADRÃO]: sistema da sim, desligado por padrão e sempre visível no placar quando ligado. Lê estatísticas em amostras de 10 s numa janela de 3 min e ajusta no máximo a cada 30 s, dentro dos limites escolhidos. Nunca dá wallhack nem mexe no que o jogador definiu.
- **Percepção:**
  - cone + distância (alcance de visão da partida) + raio DDA de oclusão até a cabeça e o tronco do alvo;
  - audição por eventos de som;
  - memória curta.

### 8.3 LOD de IA e orçamento por frame

| Nível | Quem | Decisão | Percepção | Caminho | Mira |
|---|---|---|---|---|---|
| A | Engajado ou a até 25 m de um observador | 10 Hz | 10 Hz, até 4 raios | Replaneja até 2 vezes/s | Por tick |
| B | 25 a 60 m, ou fora de vista | 4 Hz | 4 Hz, até 2 raios | 0,5 vez/s | Simplificada |
| C | Acima de 60 m sem humano perto (Bobo Royale) | 1 Hz | Só distância | Rota por waypoints | Combate bot×bot resolvido por probabilidade |

- **Observadores** são as câmeras dos humanos ou do espectador.
- **Os bots ficam em baldes** (`id % N`), para espalhar as decisões entre os ticks.
- **Orçamento em unidades por tick,** definido pelo perfil. Para o Switch com 3–4 jogadores (12 bots armados ou 24 zumbis):
  - até 3 decisões de utility;
  - até 12 raios de percepção;
  - até 800 nós de A*;
  - até 3.000 células de flow field;
  - meta: IA em até 3 ms por frame [T0].
- **Zumbi é mais barato que soldado:** inteligência mínima, segue o flow field compartilhado e não usa cobertura. Por isso o teto do Switch 3–4P é "12 armados ou 24 zumbis".

---

## 9. UI: WebGL no jogo, DOM só na casca web

- **Toda a UI do jogo é WebGL** [DECIDIDO #3], com o mesmo código na web e no Switch: menus, Laboratório, lobby, HUD, pausa e telas de erro.
  - Motivo: no MMM foi preciso um DOM falso e um `menu.js` que até fazia parse de `innerHTML`.
- **Visual todo escuro, na linha do futbobo, com tokens próprios** [DECIDIDO #22]. Os tokens vêm de `.interface-design/system.md` e viram constantes em `ui/tokens.ts`.
- **`ui` (pacote puro, testável em Node):**
  - telas como funções `estado → árvore`;
  - layout simples (linhas, colunas, âncoras, safe area);
  - foco espacial automático (o vizinho mais próximo na direção), com exceções declaradas;
  - a saída é uma `DrawList`, que o `render` desenha em 1 ou 2 draw calls por viewport.
- **Texto MSDF** [PADRÃO]:
  - atlas gerado no build (`tools/fontbake`) com Latin-1 + Latin Extended-A, que cobre o pt-BR;
  - duas fontes OFL (uma display pesada e uma condensada para o HUD), até 120 KB de fonte no total, aprovadas por print;
  - sem `FontFace` e sem fontes de sistema; nada de fontes da Microsoft (regra do novelo);
  - Canvas 2D com `OffscreenCanvas` só como plano B, validado no Teste Zero [T0].
- **Widgets:**
  - botão, toggle, slider;
  - stepper ◀ valor ▶, melhor no controle do que slider;
  - abas, lista/grade, card, campo de texto, modal, toast;
  - barra de dicas com os glifos do dispositivo ativo.
- **Glifos de botão genéricos** desenhados pelo jogo (posição e cor do botão), sem logos de marcas [PADRÃO].
- **Escala da UI:**
  - referência de 1280×720, escalada por `min(w/1280, h/720)` × o tamanho de UI escolhido;
  - HUD com referência de 640×360 por viewport;
  - alvos de toque com pelo menos 44 px (convenção da EriLab).
- **Entrada de texto** (`platform.textInput`):
  - teclado virtual próprio no canvas, que funciona com controle em qualquer plataforma;
  - na web, um `<input>` escondido abre o teclado nativo do celular e recebe digitação no PC;
  - no Switch, o teclado do sistema se o nx.js expuser [T0]; senão, o teclado próprio.
  - Nenhum campo de texto é obrigatório: nomes podem sair de um gerador.
- **DOM permitido só em `apps/web`, em quatro usos** (mesma lista no GDD 6.6 e na `arte-ux.md` 6.1):
  - splash inline no `index.html`, que também vira a página de aviso sem WebGL2 [DECIDIDO #3];
  - o `<input>` escondido para digitar texto [DECIDIDO #3];
  - um `<input type=file>` escondido para importar backup [PADRÃO: exceção técnica da casca, fora da UI; registrada no `DECISOES.md` como "DOM na web (exceção da #3)"];
  - um link de download (Blob) para exportar backup e baixar o relatório [PADRÃO: idem].
  - Os dois últimos ficam atrás de uma API de plataforma (`platform.files.pick()` e `platform.files.save()`); no Switch, a mesma API lê e grava no SD. O código compartilhado nunca toca no DOM.
  - APIs do navegador (pointer lock, tela cheia, giroscópio, áudio, clipboard, wake lock, `prefers-reduced-motion`) são chamadas pela casca, sem desenhar UI em DOM.
- **Logo** [DECIDIDO #43]: logotipo BOBOFORCES em blocos com textura pixel-art, sem mascote e sem slogan [DECIDIDO #44]. O `tools/logo` gera as letras como grade de blocos (o menu desenha em 3D com o mesmo mesher) e os ícones 2D (favicon, PWA e o JPEG 256×256 do Switch).
- **Acessibilidade mínima:** tamanho do texto, paletas de time para daltonismo, reduzir movimento e tremor de tela, indicador visual de som.
- **Painel F2,** desenhado no canvas:
  - FPS e ms por fase;
  - draw calls, triângulos e programas por viewport;
  - bots por nível de LOD;
  - heap e maior pausa de GC;
  - RTT e perda;
  - botões "exportar replay" e "copiar relatório".
  - No Switch abre segurando ZL+ZR+−.

---

## 10. Input abstrato

**Fluxo:** dispositivo → adaptador da plataforma → estado bruto → perfil de controle → ações → `InputFrame`. O código compartilhado nunca lê teclas.

```ts
interface InputFrame { seq: number /*u16*/; buttons: number /*u32*/; moveX: number /*i8*/; moveY: number /*i8*/;
  yaw: number /*u16 absoluto*/; pitch: number /*i16 absoluto*/ } // cerca de 10 bytes
```

- **Ações de jogo:** atirar, mirar (ADS), pular, agachar/deslizar, correr, recarregar, usar, corpo a corpo, granada, próxima e anterior arma, slots 1 a 4, ping, emote, placar, pausa.
- **Ações de menu** são um conjunto à parte: navegar, confirmar, voltar, aba ±, secundária.
- **Dispositivos:**
  - **Teclado + mouse (web):**
    - Pointer Lock com `unadjustedMovement`; se o navegador recusar, cai para o modo normal;
    - **agachar no C**, não no Ctrl, por causa do Ctrl+W [PADRÃO]. Se o jogador remapear para Ctrl, o jogo avisa.
  - **Toque (web):**
    - joystick que nasce onde o dedo toca, na metade esquerda;
    - arrastar na metade direita para mirar;
    - botão de tiro que também mira;
    - tiro automático opcional;
    - nenhum controle a menos de 24 px da borda (gestos do sistema), a mesma margem da `arte-ux.md` 7.3.
  - **Gamepads 0 a 7:** web e Switch.
  - **Giroscópio:** só no celular web, opcional e desligado por padrão, com permissão pedida num gesto [PADRÃO].
- **Gamepad:**
  - zona morta radial interna de 0,15 e externa de 0,95;
  - curva com expoente ~2;
  - aceleração na borda depois de 0,3 s;
  - tudo configurável por jogador;
  - `getGamepads()` lido a cada frame.
- **Assistência de mira** (gamepad e toque):
  - desaceleração perto do alvo + magnetismo leve, de 0 a 100%;
  - calculada no cliente sobre o estado interpolado, antes de virar `InputFrame`;
  - a regra da partida pode desligar; no online, o host decide e o lobby mostra.
- **Até 4 jogadores locais** [DECIDIDO #24]:
  - tela "aperte A/Enter para entrar": cada dispositivo vira um slot de 1 a 4, e teclado+mouse contam como um slot;
  - controle desconectado pausa a partida local; o slot fica reservado até reconectar.
- **Switch:**
  - **controle completo por jogador: par de Joy-Con ou Pro Controller** [DECIDIDO #32]. Joy-Con sozinho não é suportado; se o `styleSet` indicar um Joy-Con avulso, o jogo pede para usar o par ou um Pro Controller;
  - `+` abre a pausa, interceptando `beforeunload` com `preventDefault` como no MMM;
  - sair só pelo menu (`platform.exit()`); HOME é do sistema;
  - confirmar e voltar seguem a convenção Nintendo;
  - vibração via `vibrationActuator` de cada controle;
  - sem giroscópio: a API não expõe.

---

## 11. Pegadinhas de plataforma e ciclo de vida

### 11.1 Navegador [PADRÃO]

| Pegadinha | O que acontece | Tratamento |
|---|---|---|
| Ctrl+W, Ctrl+T, Ctrl+N | Atalhos reservados; a página não consegue bloquear | Agachar no C; aviso ao remapear para Ctrl; `beforeunload` pede confirmação só durante a partida |
| Esc com pointer lock | O Esc tira o lock e o `keydown` não chega à página | A pausa vem do `pointerlockchange` (lock perdido): solo e local pausam, online abre o menu sem pausar a sim. O Chrome recusa um novo `requestPointerLock` por ~1 s depois da saída: o botão "Continuar" espera e tenta de novo |
| Voltar do navegador, botões laterais do mouse, gesto de voltar no Android, deslize da borda no iOS | A página navega para trás | `history.pushState` ao entrar na partida; `popstate` abre a pausa e empurra o estado de novo; `preventDefault` nos botões 3 e 4 do mouse; `overscroll-behavior: none` |
| Aba oculta ou app em segundo plano | rAF para, timers desaceleram, o iOS suspende a página | `visibilitychange`: solo e local pausam e o áudio suspende; online segue a seção 13.4; na volta, o acumulador já limita o frame a 0,1 s |
| Fechar ou recarregar no meio | Perde a partida | `beforeunload` só durante a partida; o save faz flush em `pagehide` |
| Menu de contexto, seleção, pinça, duplo toque | Atrapalham o jogo | `contextmenu` bloqueado no canvas; `user-select: none`; `touch-action: none`; `gesturestart` bloqueado no iOS |
| Tela cheia | Não existe no iPhone; no Android exige gesto | Android: `requestFullscreen({ navigationUI: 'hide' })` no primeiro toque; iPhone: dica de "Adicionar à Tela de Início" |
| Retrato | Layout quebra | Sempre paisagem, com aviso "Gire o celular" desenhado em WebGL |
| Áudio bloqueado | Política de autoplay; WebKit bug 291892 | Desbloqueio no primeiro gesto; `resume()` na volta; tela "toque para continuar" de reserva |
| Contexto WebGL perdido | Reset de GPU ou falta de memória no iOS | `webglcontextlost` com `preventDefault`, pausa, recria tudo a partir dos dados em CPU (texturas e malhas são regeneráveis); sem retorno em 5 s, recarrega mantendo o save |
| Atualização do service worker | Versão nova no meio da partida | Só aplica no menu, com a tela de "Novidades" |
| Gamepad API | Só aparece depois de um botão apertado; objetos não se atualizam sozinhos no Chrome | "Aperte um botão para ativar o controle"; `getGamepads()` a cada frame |
| Origem compartilhada no GitHub Pages | `erereck.github.io` é a mesma origem do gamebobo: `localStorage`, IndexedDB e caches são divididos | Chaves com prefixo `boboforces:`, banco IndexedDB `boboforces`, service worker com escopo `/boboforces/`, caches com prefixo, nunca `localStorage.clear()` |
| Tela apagando no celular | O sistema escurece e apaga a tela no meio da partida | Wake Lock (`navigator.wakeLock`) durante a partida, quando existir |

### 11.2 Switch [PADRÃO]

- **Application mode obrigatório:** no applet, `getContext('webgl2')` retorna `null`. O jogo mostra uma mensagem em Canvas 2D: "Abra segurando R ou instale o NSP".
- **Dock ↔ portátil no meio da partida:** pausa automática e tela "aperte A" para reatribuir os slots (Joy-Cons encaixados ou soltos mudam de índice e de estilo).
  - Detecção por evento ou consulta do modo de operação, se o nx.js expuser; senão, pela mudança de `styleSet` e de índices dos controles [T0].
  - A CPU é a mesma nos dois modos, mas a GPU do portátil é bem mais lenta (cerca de 307 MHz contra 768 MHz na dock). Se o T0 mostrar a GPU no limite, o perfil portátil reduz detritos e partículas automaticamente, sem mexer nos tetos de bots e de visão.
- **Reconexão de controle:** desconectar pausa; o slot e as configurações do jogador ficam reservados; ao reconectar, a tela "aperte A" devolve o slot (automático quando só há um vago).
- **HOME e sleep:** o sistema suspende o app.
  - Na volta, detectada por evento se existir [T0] ou por um intervalo de frame acima de 1 s: pausa automática, `audioContext.resume()` e acumulador limitado a 0,1 s.
  - Saves já são gravados com debounce de 250 ms e no momento da pausa, então a suspensão não perde nada.
- **Bateria:** se `navigator.getBattery()` existir no nx.js [T0], o HUD mostra um aviso discreto abaixo de 15% no modo portátil.
- **`+` pausa; só se sai pelo menu.**
- **Memória:** `[memory] heap_limit` ajustado depois do T0.

---

## 12. Áudio

- **Mixer próprio**, usando só AudioContext, BufferSource, Gain e StereoPanner.
  - Proibidos: PannerNode, Oscillator, AudioWorklet, HTMLAudioElement e MediaElementSource.
- **"3D" próprio:**
  - atenuação por distância + pan estéreo;
  - com 1 jogador local, o pan segue a orientação dele;
  - **com 2 a 4 locais, cada som usa o ouvinte local mais próximo**, com o volume e o pan dele [PADRÃO];
  - opção de **saída mono** e **indicador visual de som** no HUD para compensar o som dividido na TV.
- **Mixagem:**
  - até 24 vozes, por prioridade;
  - canais master, efeitos, música e UI.
- **Formato:** MP3, que decodifica nos navegadores e no FFmpeg do nx.js [PADRÃO].
- **Efeitos sonoros** [DECIDIDO #39]: CC0 (ex.: Kenney) com crédito + sons sintetizados em código.
  - A síntese gera PCM em JS e preenche um `AudioBuffer` no boot (`createBuffer`, a confirmar no nx.js [T0]).
  - Se `createBuffer` não existir no nx.js, os sons sintetizados são renderizados no build e entram como MP3.
- **Música** [DECIDIDO #38]: CC0 provisória, trocada depois.
  - Desligada por padrão durante a partida; toca no menu, entre ondas e nos resultados [PADRÃO].
  - Faixas em loop de até ~90 s, uma decodificada por vez (~35 MB em estéreo a 48 kHz depois de decodificada), liberada ao trocar. Entra em segundo plano, depois do menu.
- **Web:**
  - um único AudioContext, liberado no primeiro toque;
  - `resume()` em `visibilitychange`;
  - tela "toque para continuar" de reserva, por causa do WebKit bug 291892.

---

## 13. Rede (P2P host-autoritativo, só web)

### 13.1 Como o Switch fica isolado

- **`OnlineService`:**
  - a interface fica em `platform-api` e a implementação em `net`;
  - só `apps/web` injeta em `platform.online`.
- **No Switch** [DECIDIDO #1]:
  - `platform.online = null` e `features.online = false`;
  - os menus online simplesmente não aparecem.
- **`MatchDriver`:**
  - `game` só conhece essa interface;
  - `LocalDriver` (1 a 4 jogadores locais) fica em `game`;
  - `HostDriver` e `ClientDriver` ficam em `net`.
- **Build do Switch:**
  - usa `define: { __ONLINE__: false }`;
  - o `portcheck` falha se o bundle tiver `RTCPeerConnection`, `trystero` ou `WebSocket`.
- **Na web, o chunk de rede só carrega quando o jogador abre "Online".** Ele fica fora do orçamento do menu.

### 13.2 Topologia e transporte

- **Estrela com host autoritativo, até 4 humanos** [DECIDIDO #25]. Os bots rodam só no host e viajam nos snapshots como entidades comuns.
- **Sinalização:** Trystero com relays Nostr, como no futbobo. A lista de relays fica em `public/net.json`, junto com o TURN e o `protocolVersion`.
- **Acesso só por código ou link entre amigos, sem salas públicas** [PADRÃO]:
  - código de sala de 5 caracteres, sem caracteres ambíguos;
  - link no formato `#sala=XXXXX`; o hash não chega a nenhum servidor.
- **Dois canais:**
  - confiável e ordenado: lobby, eventos de partida, pings e emotes;
  - não confiável (`ordered:false, maxRetransmits:0`): inputs e snapshots.
  - O canal não confiável seria criado como `negotiated` sobre as `RTCPeerConnection` que o Trystero expõe (a verificar na versão fixada).
  - Se não der, vai tudo no canal do Trystero, com snapshots a 20 Hz.
- **NAT e TURN** [PADRÃO]:
  - no protótipo, só STUN (`stun.cloudflare.com`);
  - **antes de abrir o online, decidir o TURN:** Cloudflare com credenciais geradas por um Worker grátis (exige conta do Erick), Open Relay como reserva. Sem TURN, parte das redes 4G com NAT simétrico não conecta.
- **Mensagens de até 1.100 bytes.** Um snapshot maior é dividido por prioridade de entidade.

### 13.3 Netcode

- **Host:**
  - simula no `SIM_HZ`;
  - envia snapshots a 30 Hz quando o host é PC e a 20 Hz quando é celular;
  - usa delta contra a última baseline que cada cliente confirmou;
  - quantiza posição em 1 cm e ângulos em 16 bits.
- **Inputs do cliente:** enviados a cada tick, com os 3 anteriores repetidos para cobrir perda.
- **Cliente:**
  - prediz só o próprio movimento, com o mesmo código da `sim`;
  - reconcilia por `seq`;
  - interpola o resto com 100 ms de atraso.
- **Lag compensation:** histórico de hitboxes de 200 ms em ring buffer, com rewind limitado a 200 ms. O host joga com 0 ms, o que é aceitável entre amigos.
- **Bobo Royale (M6+):** entidades distantes recebem atualização a 5–10 Hz.
- **Banda estimada:**
  - 44 entidades (4 humanos + 40 bots) × ~12 B × 30 Hz ≈ 16 KB/s por cliente;
  - um host com 3 clientes sobe ≈ 48 KB/s.
- **Reconexão:** ID persistente via `platform.storage` (chave `boboforces:net.peerId`) + snapshot completo na volta.
- **Sem migração de host na v1:** "host saiu = fim da partida", com tela de resultado [PADRÃO].
- **Versões:** o handshake carrega `protocolVersion`, a versão do jogo e um hash do conteúdo que afeta a sim (registro de IDs e tabelas de armas e regras).
  - `protocolVersion` ou hash diferentes: quem está na versão mais antiga vê "Atualize a página", e o service worker procura a versão nova na hora; o outro vê "Seu amigo precisa atualizar".
- **Online + jogadores locais no mesmo aparelho:** fora da v1. A arquitetura já aceita vários slots por peer.

### 13.4 Host em segundo plano e host no celular [PADRÃO]

- **Host vai para segundo plano** (`visibilitychange` oculto):
  - o host manda um aviso "host ausente" pelo canal confiável, se ainda der tempo;
  - os clientes também detectam sozinhos: 3 s sem snapshot contam como host ausente (o iOS pode suspender antes de mandar o aviso);
  - **coop:** a partida pausa para todos, com faixa "O host saiu do jogo por um instante";
  - **PvP:** contagem de 10 s; se o host não voltar, a partida acaba com a tela de resultado do último snapshot.
- **Cliente vai para segundo plano:** o boneco dele fica parado; depois de 60 s sem input, um bot assume a vaga até ele voltar.
- **Aviso no lobby** quando o host é celular: "Você é o host: não troque de app durante a partida". Wake Lock ligado durante a partida.
- **Teto de bots com host no celular: 8.** Snapshots a 20 Hz.
- **Orçamento de CPU do host no celular** (30 fps, 33,3 ms, 3 clientes, 8 bots):

| Fase | ms |
|---|---|
| Sim (inclui inputs dos clientes) | 2,5 |
| IA | 1,0 |
| Rede (delta, serialização, envio para 3 clientes) | 2,0 |
| Render CPU (1 viewport) | 10,0 |
| Input + UI | 1,0 |
| Margem (GC, picos, aquecimento do aparelho) | 16,8 |

### 13.5 Sala, comunicação e privacidade [PADRÃO]

- **Host pode expulsar e travar a sala.** Sem salas públicas.
- **Comunicação:** pings e emotes; sem chat de texto livre.
- **Nomes:** até 16 caracteres, com filtro simples local.
- **Aviso curto de privacidade** na tela Online: jogar online conecta o aparelho direto ao dos amigos, e eles podem ver o IP. Revisar antes de abrir o online (seção 26).

---

## 14. Save, presets e formatos

### 14.1 Interface `Storage` e onde grava

- **Interface `Storage`:**
  - leitura síncrona;
  - escrita com debounce de 250 ms, flush ao pausar e ao sair, e cópia de backup (padrão do MMM).
- **Web** [PADRÃO]: `localStorage` para preferências, presets, bots e estatísticas; IndexedDB para replays de debug.
- **Switch** [PADRÃO]: JSON no SD em `sdmc:/switch/boboforces/` (`save.json` + `save.backup.json`), como no MMM, sem tela de escolha de perfil (`startupUserAccount 0`).
- **Sem progressão:** o save guarda só configurações, presets, bots, estatísticas e recordes [DECIDIDO #16].

### 14.2 Documentos

Todo documento tem campo `format: "boboforces/<tipo>@<n>"`, cadeia de migrações, validador escrito à mão em `format` e fixtures sintéticas nos testes [PADRÃO].

| Documento | Conteúdo | Escopo |
|---|---|---|
| `settings@1` | Vídeo (qualidade, escala, limitador, FOV), áudio (mono, volumes), acessibilidade e controles por slot (bindings, sensibilidade, Y invertido, zonas mortas, assistência) | Por aparelho |
| `preset@1` | Receitas com nome, "última partida" e favoritos; bots personalizados vão embutidos | Por aparelho, compartilhável |
| `bot@1` | Bots salvos do Laboratório | Por aparelho, compartilhável |
| `stats@1` | Estatísticas e recordes | Por aparelho |
| `backup@1` | Tudo acima num arquivo só | Exportar/importar |
| `replay@1` | Receita + semente + versão + inputs (só debug) | Web: IndexedDB; Switch: SD |

**Forma da receita de partida** (`MatchRecipe`; o preset é a receita com nome). O esquema único de `preset@1` é o da `gameplay.md` 10.4, que tem o exemplo completo (com um `bot@1` embutido). Campos de topo:

```json
{ "format": "boboforces/preset@1", "name": "...", "mode": "warfare.tdm", "map": "construto",
  "match":   { "timeLimitS": 600, "scoreLimit": 75, "viewDistanceM": 50 },
  "players": { "hp": 100, "regen": "default", "respawnS": 3, "movement": "bobo", "camera": "any" },
  "weapons": { "loadout": "free", "ammo": "normal", "damageMul": 1, "ads": true },
  "teams":   [ { "name": "...", "humans": "all", "bots": [ { "ref": "builtin:chill-bob", "count": 5 } ] } ],
  "embeddedBots": [], "director": { "enabled": false }, "modifiers": [], "seed": 1234 }
```

- **`embeddedBots`:** lista de `bot@1` completos (até 16), referenciados nos times por `embedded:<id>`.
- **Refs de bot:** `builtin:<id do bot de fábrica>` (os 5 níveis são `vibe-bob`, `chill-bob`, `normal-bob`, `sweaty-bob` e `tryhard-bob`, derivados dos IDs de nível `vibe`, `chill`, `normal`, `sweaty`, `tryhard`) ou `embedded:<id>` de um bot em `embeddedBots`.
- **Perfil de movimento:** IDs `bobo` (padrão), `tactical`, `arcade` e `custom`.
- **BotProfile:** `{ format: "boboforces/bot@1", id, name, intelligence{}, skill{}, personality{}, rules{}, look{} }`, no formato da `gameplay.md` 6.7.
- **`look` único** (bot e perfil do jogador): `{ skin, skinTone, face, hair, hairColor, hat, hat3d, outfit, pattern, colors: [2], back }`. Cobre a customização do GDD 4.7.2: skin pronta, tom de pele, rosto, cabelo e cor, chapéu de camada externa ou acessório 3D, roupa com padrão e 2 cores, acessório de costas.
- **Receita acima do teto da plataforma** (por exemplo, 30 bots no Switch 4P): o validador corta no teto e avisa.
- **Versões dos formatos ficam no `version.json`:** `formats { save, preset, bot, map, protocol }`.

### 14.3 Códigos e links (Oficina, M6+)

- **Bot:** código `BF1-` + base64url(deflate(JSON)); link `#bot=`.
- **Preset:** código `BFP1-` + base64url(deflate(JSON)); link `#p=`.
- Teto de 4.000 caracteres por código e de 64 KB por arquivo importado; até 16 bots embutidos por preset; todo import valida, migra e limita valores (clamp).
- **Switch:** sem rede e sem colar texto; importa e exporta arquivos `.json` em `sdmc:/switch/boboforces/oficina/`.
- Os formatos existem desde o M2 (bots e presets salvos localmente); o compartilhamento chega com a Oficina no M6+ [DECIDIDO #29].

### 14.4 Persistência na web [PADRÃO]

- **`navigator.storage.persist()`** chamado no primeiro "Salvar" de bot ou preset (num gesto do jogador, para o Firefox não perguntar no boot). O resultado aparece no relatório.
- **Safari apaga dados de sites não instalados após ~7 dias sem uso:** no iOS, depois do primeiro bot salvo, uma dica sugere "Adicionar à Tela de Início" (web app fica isento) e exportar um backup.
- **Exportar/Importar backup:**
  - exportar baixa `boboforces-backup-AAAA-MM-DD.json` (`boboforces/backup@1`) pelo link de download da casca (`platform.files.save()`);
  - importar usa o `<input type=file>` escondido (`platform.files.pick()`), valida, migra, mostra um resumo ("12 bots, 5 presets") e pergunta "Juntar" ou "Substituir".
  - Esses dois elementos DOM são a exceção técnica da casca listada na seção 9 [PADRÃO].
- **Duas abas abertas:**
  - a aba que abre primeiro segura o lock `boboforces-save` (`navigator.locks`, com reserva via `BroadcastChannel`);
  - a segunda aba mostra "O BoboForces já está aberto em outra aba" com o botão "Usar aqui", que avisa a primeira para soltar o save e ir para uma tela parada;
  - assim nunca há duas abas gravando o mesmo save.
- **Limite do `localStorage`:** ~5 MB por origem, dividido com o gamebobo (seção 11.1). Bots e presets são pequenos; replays nunca vão para o `localStorage`.

### 14.5 Compatibilidade entre versões e plataformas [PADRÃO]

O Switch é atualizado raramente, e um preset feito numa web mais nova pode citar conteúdo que o Switch não tem.

- **IDs de conteúdo estáveis**, em inglês, que nunca mudam: `weapon:rifle`, `map:construto`, `mode:warfare.tdm`, `block:concrete`, `hat:bucket`.
  - Ficam num registro em `format/content-ids.ts`. O CI falha se um ID some ou muda de nome; aposentar exige entrada na lista de aposentados, com o substituto.
  - **O prefixo de tipo (`mode:`, `map:`, `weapon:`…) existe só no registro e nas mensagens.** Nos documentos JSON o campo já diz o tipo, e o valor guardado vai sem prefixo: `"mode": "warfare.tdm"`, `"map": "construto"`, `"weapons": ["shotgun"]`. As refs de bot são a exceção, porque misturam origens: `builtin:<id>` e `embedded:<id>` (14.2). Igual no GDD 4.8.
- **Campos desconhecidos são ignorados** (e mantidos ao regravar, quando possível).
- **Versão maior que a conhecida é recusada** com mensagem: "Este bot foi feito numa versão mais nova do BoboForces. Atualize o jogo."
- **Versão menor** passa pela cadeia de migrações.
- **Conteúdo ausente cai em fallback:**

| Ausente | Fallback |
|---|---|
| Arma | Arma padrão da mesma categoria; sem categoria conhecida, pistola |
| Peça de visual do `look` (skin pronta, tom de pele, rosto, cabelo, chapéu, chapéu 3D, roupa, padrão, costas) | Padrão do slot |
| Regra | Ignorada, com aviso no resumo |
| Bloco num mapa | Textura `block:missing` (xadrez) com colisão de cubo |
| Mapa | Preset recusado, oferecendo trocar para o Construto |
| Modo | Preset recusado com mensagem |

- **Resumo do import:** o jogo mostra o que caiu em fallback.
- **Online:** handshake com `protocolVersion` e hash de conteúdo (seção 13.3).

---

## 15. Pipeline de assets

O Claude gera todos os assets por script (blocos, texturas pixel-art, modelos de caixas, props, skins e mapas); o Erick aprova por prints [DECIDIDO #13]. O editor de mapas é só ferramenta interna, nunca para jogadores [DECIDIDO #36].

### 15.1 Ferramentas

| Ferramenta | Entrada | Saída |
|---|---|---|
| `tools/texgen` | Scripts TS de textura: paletas, ruído com semente, pixel-art escrita como texto ASCII para as peças-chave | PNGs em tira vertical (16×16·N e 64×64·M), mips, manifesto `camada → nome` |
| `tools/skingen` | Biblioteca de partes de skin (rostos, cabelos, chapéus, padrões, roupas de time, skins de zumbi) | PNG das partes no layout 64×64 + tabela de regiões. A composição final de cada bobo acontece no jogo |
| `tools/modelgen` | Modelos em TS como listas de caixas (origem, tamanho e UV em texels, pivô) ou primitivas low-poly paramétricas (cilindro de N lados, árvore, barril) | `.bfmodel` |
| `tools/mapc` | Mapas escritos como scripts TS com uma API de construção (`box`, `ramp`, `fence`, `prop`, `spawn`, `door`…) | `.bfmap` com grade, props, marcadores, navegação e pontos táticos |
| `tools/mapview` | `.bfmap` | Visualizador e editor interno no navegador (marcadores, nós de IA, câmeras), só em desenvolvimento |
| `tools/fontbake` | Fontes OFL | Atlas MSDF (PNG) + métricas |
| `tools/logo` | Letras em grade de blocos | Dados do logo 3D + favicon, ícones do PWA e `icon.jpg` 256×256 do Switch |
| `tools/assetcheck` | Tudo acima | Validações (seção 15.3) |
| `tools/credits` | `package-lock.json`, manifesto de assets externos | Confere `docs/CREDITOS.md` e gera `licencas.txt` (seção 22) |

### 15.2 Formatos [PADRÃO]

- **Binários próprios em RLE + deflate (fflate), PNG para imagens, MP3 para áudio.** Brotli e gzip só como compressão de transporte do host.
- **`.bfmap`** (`map@1`), todo comprimido com deflate:
  - cabeçalho (magic, versão, dimensões em células, tamanho da célula);
  - tabela de blocos usados (ID estável → índice local);
  - tabela de chunks e chunks em RLE de `u16`;
  - instâncias de props (tipo, posição em texels, giro, escala);
  - entidades e marcadores: spawns, objetivos (inclusive pontos de Domination), zona, portas, barricadas, armas na parede, caixa misteriosa, câmeras;
  - navegação 2,5D + links de porta + pontos táticos;
  - luz: direção do sol, preset de hora do dia e fontes de luz dos props emissivos (a malha e a luz por célula são montadas no loading, 15.4);
  - metadados: nome, modos suportados, `players { min, ideal, max }`, maior linha de visão e teto de bots por perfil.
- **`.bfmodel`** (`model@1`): caixas ou malha low-poly compacta (posição, normal, UV), pivôs, pontos de encaixe (mão, cabeça, costas) e camadas de textura usadas.
- **Skins:** PNG 64×64; partes de skin no layout comum.
- **Blocos:** `blocks.json` (definições com IDs estáveis) compilado para tabela binária no build.
- **Textos:** `strings.pt-BR.ts`.

### 15.3 Validações (no build e no CI)

- Toda camada de bloco tem 16×16; toda camada de modelo tem 64×64; nenhum array passa de 256 (blocos) ou 128 (modelos) camadas.
- Spawns alcançáveis pela navegação; cada modo declarado tem os marcadores de que precisa.
- Portas têm 1,0 m de largura (2 células) e corredores pelo menos 1,0 m.
- A maior linha de visão declarada confere com a medida pelo `mapc`.
- Teto de tamanho por mapa (download e memória).
- Todo ID novo entra no registro de IDs; nenhum some.

### 15.4 Carregamento

- **Web:** a grade chega comprimida e a malha, a luz e a navegação de portas são montadas no cliente, fatiadas, durante a tela de loading.
- **Switch:** igual por padrão, com pré-malha no build se o T0 mostrar loading acima de 4 s.
- **Saída do build:**
  - nomes com hash;
  - `assets.json` com tamanho e sha256, usado pelo service worker e pelo verify do Switch (como o `source-manifest.json` do MMM).

---

## 16. Orçamentos de desempenho e download

### 16.1 Perfis de plataforma (dados, valores iniciais) [PADRÃO]

Os tetos começam conservadores e **sobem com as medições**; cada mudança é registrada em `docs/PERF.md`.

| Perfil | Viewports | Teto de bots armados | Zumbis simultâneos | Teto de visão | Resolução | Detritos | AA | Alvo |
|---|---|---|---|---|---|---|---|---|
| PC | 1–2 | 40 | 60 | 140 m | DPR até 2, escala dinâmica | 500 | MSAA nativo | 60 fps |
| PC em tela dividida | 3–4 | 24 | 40 | 140 m | DPR até 2, escala dinâmica | 500 | MSAA nativo | 60 fps |
| Celular | 1 | 12 (host P2P: 8) | 24 (host P2P: 16) | 90 m | DPR 1–1,5, escala dinâmica | 200 | Não | 30 estável (60 se der, limitador 30/60) |
| Switch 1P | 1 | 24 | 30 | 90 m | 720p fixo | 200 | Não | 30 mínimo |
| Switch 2P | 2 | 16 | 24 | 70 m | 720p fixo | 200 | Não | 30 mínimo |
| Switch 3–4P | 3–4 | 12 | 24 | 50 m | 720p fixo | 120 | Não | **30 mínimo com 4 jogadores** |

- **Capacidade do motor:** 64 bots.
- Os tetos de bots e de zumbis são os mesmos da `gameplay.md` 6.11 e do GDD 2.1; o bench confirma os zumbis fora do Switch 3–4P.
- **Bobo Royale Mini:** 24 participantes em todas as plataformas [DECIDIDO #35], sustentados pelo LOD C (bots longe resolvem combate por probabilidade). O bench do modo, no M6+, confirma isso no Switch 4P e no celular antes do lançamento do modo.

### 16.2 CPU por frame: Switch dock, 4 jogadores, 12 bots armados, 30 fps (33,3 ms)

| Fase | ms |
|---|---|
| Input + UI | 1,5 |
| Sim (2 ticks a 60 Hz) | 4,0 |
| IA | 3,0 |
| Animação, instâncias, detritos e partículas | 1,5 |
| Render CPU (culling + submissão de 4 viewports) | 14,0 |
| Áudio | 0,5 |
| Margem (GC, picos) | 8,8 |

**Outros alvos:**
- PC a 60 fps com 1 viewport e 40 bots: sim 2, IA 2, render 4, UI 0,5, sobra ~8 ms.
- Celular a 30 fps com 1 viewport e 12 bots: sim 2, IA 1,5, render 10, UI 1, sobra ~18 ms.
- Host P2P no celular: seção 13.4.

### 16.3 GPU e memória [T0]

| Item | PC (por viewport) | Celular | Switch 1–2P (por viewport) | Switch 3–4P (por viewport) | Total por frame |
|---|---|---|---|---|---|
| Draw calls | ≤ 150 | ≤ 80 | ≤ 60 | ≤ 45 | PC ≤ 500; Switch ≤ 200 |
| Triângulos visíveis | ≤ 400 mil | ≤ 150 mil | ≤ 200 mil | ≤ 120 mil | Switch ≤ 500 mil |
| Programas de shader | — | — | — | — | 7 |

| Item | Limite total |
|---|---|
| Texturas (arrays de blocos e de modelos, UI, partículas) | ≤ 8 MB |
| Malhas do mapa na GPU | ≤ 40 MB |
| Memória de GPU | < 150 MB |
| Heap JS | < 200 MB |
| Memória total no celular | < 300 MB |

- **Custo de personagens é baixo:** 40 bobos × (~150 do corpo + até 600 da arma, a maioria abaixo de 300) ≈ 18 a 30 mil triângulos, pouco perto do teto de 400 mil por viewport no PC.
- **Draw calls no Switch 3–4P (≤ 45 por viewport, orçamento base):** mundo ~17, props instanciados ≤ 8, bobos 7, armas e acessórios no mundo ≤ 3, viewmodel 1, VFX ≤ 6 (inclui o pool de cubinhos), céu 2. O casco de contorno fica fora dessa conta (6.5).
- **Zero alocação por frame** nos laços quentes.
- **Pausa de GC de no máximo 5 ms,** medida no F2 numa sessão de 20 minutos.

### 16.4 Download e tempo (web)

| Etapa | Orçamento (comprimido) | Alvo (boa conexão, cache vazio) |
|---|---|---|
| HTML + splash inline | ≤ 15 KB | Primeiro pixel em menos de 0,5 s |
| Menu interativo (core + three com tree-shaking + atlas MSDF + texturas de UI) | ≤ 350 KB | PC ≤ 2 s; celular ≤ 4 s |
| Primeira partida (+ Construto ≤ 300 KB + texturas de blocos e skins ≤ 150 KB + sons essenciais ≤ 150 KB) | ≤ 1 MB acumulado | PC ≤ 5 s; celular ≤ 10 s |
| Rede (Trystero + net), sob demanda | ≤ 80 KB | Ao abrir Online |
| Jogo completo (mapas, músicas), sob demanda | ≤ 15 MB | Segundo plano |
| Visita repetida (service worker) | ~0 KB | Menu em ≤ 1 s |

- **Switch:**
  - do boot ao menu em até 4 s;
  - romfs até 60 MB (o runtime sozinho dá cerca de 56 MB no NRO, como no MMM).
- **O CI reprova o build se o orçamento de download estourar.**

---

## 17. Aparelhos de referência e qualidade na primeira abertura [PADRÃO]

### 17.1 Aparelhos de referência

| Classe | Exemplo | Meta |
|---|---|---|
| PC de referência | Notebook com GPU integrada (classe Intel Iris Xe ou Radeon Vega 8), 1080p | 60 fps com 1 viewport e 40 bots; 60 fps com 4 viewports e 24 bots (teto do PC em tela dividida 3–4P, 16.1) |
| Android de entrada | 4 GB de RAM, classe Mali-G52/G57 (ex.: Galaxy A15, Redmi 13) | 30 fps com 12 bots e visão de 90 m, na qualidade Leve |
| Celular médio | Classe Galaxy A35/A55 | 30 fps estáveis na qualidade Média; 60 com limitador se der |
| Celular do Erick | Modelo registrado em `docs/PERF.md` | Checklist manual a cada marco |
| iPhone | iPhone 12 ou mais novo, iOS 17+ | Funciona com limitações conhecidas [DECIDIDO #26] |
| Switch | O console do Erick, dock e portátil | Seção 24 |

- Os modelos exatos ficam em `docs/PERF.md` quando os aparelhos estiverem na mão.
- O e2e automático roda no Edge; Safari/WebKit é coberto pelo checklist manual quando houver um iPhone disponível.

### 17.2 Qualidade escolhida na primeira abertura

1. **Leitura do aparelho:** `gl.RENDERER`/`VENDOR` (mais `WEBGL_debug_renderer_info` na casca web, se existir), `hardwareConcurrency`, `deviceMemory`, tamanho da tela, `MAX_TEXTURE_SIZE`.
2. **Micro-bench de ~3 s no loading:** a cena do fundo do menu (Construto) com o perfil do aparelho, medindo o p90 do frame, mais 120 ticks de sim com 12 bots.
3. **Escolha:** Alto, Médio ou Leve. Mexe em escala de resolução, detritos, partículas e, no Leve, pode baixar a visão abaixo do teto.
4. **Lista de GPUs fracas** conhecidas em config, versionada, para cair direto no Leve.
5. O jogador muda a qualidade a qualquer momento; a escolha automática não volta a rodar depois que ele mexe.

### 17.3 Limitador e economia de bateria

- **Limitador 30/60 FPS:** 60 por padrão no PC, 30 por padrão no celular na qualidade Leve. Implementado pulando frames do rAF conforme a taxa medida da tela (funciona em telas de 90 e 120 Hz).
- **Economia de bateria (celular):** 30 fps, escala 0,75, partículas e detritos mínimos, visão até 60 m, sem vibração. Sugerida uma vez quando `getBattery()` indicar menos de 20% descarregando (onde existir).
- **Reavaliação:** se o p90 ficar acima do alvo por 10 s já na escala mínima, um toast sugere baixar a qualidade.

---

## 18. Diagnóstico sem coleta [DECIDIDO #42]

Nenhum dado sai do aparelho automaticamente. O jogador decide se manda o relatório para o Erick.

- **Web: botão "Copiar relatório"** em Ajustes › Sobre, na tela de erro e no F2.
  - Copia via `navigator.clipboard.writeText`. Se falhar (por exemplo, quando o clique veio do controle), mostra o texto num painel com a opção "Baixar relatório (.txt)", que usa o link de download da casca (`platform.files.save()`, seção 9).
- **Switch: `runtime.log`** em `sdmc:/switch/boboforces/runtime.log`, com rotação em 1 MB (`runtime.old.log`). O botão "Salvar relatório" grava `relatorio-AAAA-MM-DD.txt` na mesma pasta.
- **Conteúdo do relatório:** versão, codinome e hash do build; plataforma, navegador e sistema; tela e DPR; GPU e limites WebGL; perfil e qualidade (escala, limitador, visão); desempenho da última partida (p50/p90 do frame, bots, viewports); versões dos formatos e se `storage.persist` foi concedido; últimos 20 erros com pilha.
  - **Nunca inclui** nomes, códigos de bot ou preset, IP ou salas.
- **Captura de erros:** `error` e `unhandledrejection` num ring buffer; o laço principal fica num `try/catch` que leva à tela "Algo deu errado" com "Copiar relatório" e "Voltar ao menu".

---

## 19. Build e deploy

### 19.1 Web

- **Vite:**
  - `target: es2022` e `base: './'` (funciona no Pages com subcaminho e num domínio próprio no futuro);
  - chunks manuais: `three`, `core` e `net` (lazy).
- **`index.html`:** splash inline (SVG + CSS) e `modulepreload` do core.
- **Service worker** (vite-plugin-pwa/Workbox, como no VNbobo):
  - escopo `/boboforces/`;
  - precache de casca, core, Construto e UI;
  - cache-first nos assets com hash;
  - atualização aplicada só no menu, com a tela curta de "Novidades" (como no futbobo) [PADRÃO].
- **Manifest:** `display: fullscreen`, `orientation: landscape`, `lang: pt-BR`. Instalar como app pelo navegador é opcional; não existe APK [DECIDIDO #37].
- **Deploy** [DECIDIDO #40]: GitHub Actions → GitHub Pages em `erereck.github.io/boboforces`, como no gamebobo e no futbobo.
  - Passos: `npm ci`, typecheck, lint, test, build, size-check, credits e publicação de `dist`.
  - Domínio próprio fica para depois, se o Erick quiser.
- **Navegador mínimo** [PADRÃO]: WebGL2 + ES2022. Abaixo disso, página de aviso amigável.

### 19.2 Switch (esqueleto desde o M0; o port é o M4)

- **`apps/switch/scripts/build.mjs`**, herdado do MMM:
  - esbuild de `src/main.ts` para `romfs/main.js` (esm, es2022, sourcemap), com `define { __PLATFORM__: 'switch', __ONLINE__: false }`;
  - copia os assets da variante Switch;
  - grava um manifesto com sha256 e o commit.
- **Empacotamento (só local):**
  - `npm run nro` chama `nxjs-nro --fat`;
  - `npm run nsp -- -k <fora do repo>/prod.keys` chama o `package-nsp.mjs` do MMM, mantendo o hack do `buffer.slice` no NACP;
  - mais `prepare-icon.mjs` (JPEG de 256×256), `verify-nro/nsp` e config do Eden em `local/`.
  - As chaves nunca entram no repositório.
- **NACP:** título "BoboForces", autor "EriLab", versão vinda do `version.json`, title ID no padrão do MMM fixado no M0 e `startupUserAccount 0`.
- **Uso pessoal** [DECIDIDO #33]: NRO e NSP são gerados só na máquina do Erick. O CI compila o bundle do Switch e roda o `portcheck`, mas **não gera nem guarda NRO/NSP** como artefato (num repositório público, artefato de CI seria download público). As instruções de instalação ficam em `apps/switch/README.md`, para o próprio Erick.
- **Runtime:** `beforeunload` bloqueado; `runtime.log` no SD; `[memory] heap_limit` ajustado no T0.

---

## 20. Testes e CI

- **Unitários (Vitest, por pacote):**
  - RLE, catálogo de formas e mesher (contagem de quads por camada de textura, AO, troca de diagonal);
  - decodificador PNG e composição de skin;
  - DDA e colisão (quinas, degrau de 0,5 m, rampas, colisores dinâmicos);
  - navegação (nós de canto, links de pulo de 1,0 m, portas), A* e flow field;
  - bitpack, InputFrame e delta de snapshot;
  - migrações, validadores e compatibilidade (campo desconhecido, versão maior recusada, fallback de conteúdo, registro de IDs);
  - layout e foco da UI.
- **Golden de determinismo:** Bobo Warfare TDM com 8 bots, semente 42, 3.600 ticks, comparando o hash do estado. Bugs com replay viram testes.
- **Robô de balanceamento** (`tools/balance`, como o `balance.mjs` do gamebobo):
  - milhares de partidas bot contra bot, headless;
  - TTK e K/D por nível rápido, garantindo a ordem Pela vibe < De boa < Normal < Suado < Tryhard;
  - calibra os multiplicadores de headshot por arma.
- **Bench headless:** ms por tick de sim + IA com 12, 24, 40 e 64 bots. Regressão acima de 20% gera aviso.
- **Rede:** loopback em memória com 100 ms de latência, 20 ms de jitter e 5% de perda. Verifica convergência, acertos registrados, erro de predição limitado e as regras de host ausente.
- **E2E web** (playwright-core + Edge):
  - boot até o menu, medindo o tempo;
  - Partida Rápida de 10 s;
  - zero erros no console;
  - `renderer.info.programs.length ≤ 7`;
  - telas de 667×375 e 1280×720;
  - backup: exportar e importar ida e volta;
  - duas abas: a segunda não grava.
- **Portabilidade:** build do Switch + `portcheck` + boot do `game` em `node:vm` com um `NullRenderer`, até o primeiro frame do menu.
- **Dispositivos (manual, por marco)** [PADRÃO]: celular do Erick, Android de entrada (4 GB) e, do M1 em diante, o Switch real. Resultados em `docs/PERF.md`.
- **Workflows:**
  - `ci.yml` em todo PR: install, typecheck, lint, Prettier, test, build web, size-check, credits, build do Switch e portcheck;
  - e2e no PR ou à noite;
  - `deploy.yml` na `main`.
- **Checklist de entrega** (estende o do gamebobo):
  - test, build, jogar;
  - 375/667 px;
  - balance;
  - portcheck verde;
  - F2 sem regressão de orçamento.

---

## 21. REGRAS DE OURO DE PORTABILIDADE

Proibido no código compartilhado. Fica em `docs/PORTABILIDADE.md` e no `CLAUDE.md`.

**Plataforma**
1. **Sem DOM:** nada de `document`, `window.*`, `HTMLElement`, `HTMLCanvasElement`, CSS, `innerHTML`, `DOMParser` ou `new Image()` direto. Os pacotes puros nem compilam se isso aparecer.
2. **Sem armazenamento direto:** nada de `localStorage`, `sessionStorage` ou `indexedDB`. Tudo passa por `platform.storage`.
3. **Sem `fetch` nem URLs:** assets são pedidos por caminho lógico (`maps/construto.bfmap`) via `platform.assets`.
4. **Sem rede fora de `net`:** nada de `RTCPeerConnection`, `WebSocket` ou Trystero. `sim`, `game` e `ui` nunca importam `net`.
5. **Sem threads:** nada de `Worker`, `SharedArrayBuffer`, `Atomics` ou WASM com threads.

**Gráficos e áudio**

6. **WebGL2 puro:**
   - sem `getExtension` (exceto o diagnóstico da casca web);
   - sem WebGL1;
   - sem MSAA no framebuffer padrão do Switch;
   - sem render target float ou half-float;
   - sem EffectComposer;
   - sem texturas comprimidas (KTX2/Basis);
   - sem anisotropia;
   - sem timer query;
   - sem leitura de textura no vertex shader;
   - só `WebGLRenderer`.
   - `TEXTURE_2D_ARRAY` e atributos inteiros são núcleo do WebGL2 e permitidos, com o atlas de plano B pronto atrás de um `#define`.
7. **three.js só em `render`.** Nada de `TextureLoader`, `ImageLoader`, `FontLoader`, `CSS2D`/`CSS3DRenderer`, `OrbitControls` ou qualquer coisa que leia eventos do DOM.
8. **No máximo 7 programas de shader.**
9. **Áudio só pelo mixer:** nada de `PannerNode`, `OscillatorNode`, `AudioWorklet`, `HTMLAudioElement` ou `MediaElementSource`.

**Simulação e memória**

10. **Tempo e acaso:** sem `Math.random`, `Date.now` ou `performance.now` em `sim`, `ai`, `nav` e `format`. Usar o tick e o RNG com semente.
11. **Sem alocação no laço quente:** nada de vetores, arrays ou closures novos por frame. Usar pools e objetos de rascunho.

**Entrada, texto e tela**

12. **Input só por ações.**
    - Eventos de teclado, ponteiro e toque só nos adaptadores de `apps/*`.
    - Todo fluxo tem que ser jogável só com D-pad + A/B.
    - Nada pode exigir hover, mouse, toque ou giroscópio.
13. **Texto:**
    - sempre pela tabela de textos pt-BR + MSDF;
    - sem fonte de sistema;
    - sem `toLocaleString`/`Intl`: a formatação de números é própria.
14. **Entrada de texto** só por `platform.textInput`, com o teclado próprio de reserva.
15. **Sem `eval` nem `new Function`.** `import()` dinâmico só em `apps/web`.
16. **Sair e pausar:** `+` pausa; sair só por `platform.exit()`. Nunca depender de Esc, Home ou do voltar do navegador.
17. **Nunca assumir proporção, DPR ou resolução.**
    - UI por âncoras e safe area.
    - Testar em 640×360 (um viewport de 4 jogadores), 1280×720 e 667×375.

**Modos, dados e dependências**

18. **Todo modo roda com `platform.online === null`** e com zero humanos remotos.
19. **Toda receita e todo perfil passam pelo validador** e respeitam o teto da plataforma.
20. **IDs de conteúdo nunca mudam.** Aposentar um ID exige substituto no registro.
21. **Caches com limite** e `dispose()` total ao trocar de mapa.
22. **Dependência nova** só se passar no `portcheck` e estiver em `DEPENDENCIAS.md` e `CREDITOS.md` com versão exata.
23. **Formatos de asset:** só PNG, MP3 e binários próprios com RLE + deflate.

---

## 22. Licenças e créditos [DECIDIDO #41]

- **Repositório público, sem licença aberta:** todos os direitos reservados. Não há arquivo LICENSE concedendo uso; o README diz "© EriLab. Todos os direitos reservados." O GitHub Pages grátis exige repositório público, e isso está ok.
- **Assets gerados pelo Claude** fazem parte do projeto, com os mesmos direitos.
- **`docs/CREDITOS.md`** lista todo terceiro: nome, versão, licença, autor, link e onde é usado (web, Switch ou só ferramenta). Entradas previstas:

| Item | Licença (conferir na versão fixada) | Onde |
|---|---|---|
| three.js | MIT | web e Switch |
| Trystero | MIT | só web |
| fflate | MIT | web, Switch e tools |
| nx.js (runtime e pacotes de build) | MIT | só Switch |
| Fontes display e HUD | SIL OFL 1.1 | web e Switch (atlas MSDF derivado) |
| Efeitos sonoros (ex.: Kenney) | CC0, com crédito mesmo assim [DECIDIDO #39] | web e Switch |
| Música provisória | CC0 [DECIDIDO #38] | web e Switch |
| Vite, esbuild, Vitest, playwright-core, ESLint, Prettier, vite-plugin-pwa | MIT/Apache-2.0 | só ferramentas |

- **Avisos obrigatórios distribuídos junto:** MIT e OFL pedem o texto da licença nas cópias. O `tools/credits` gera `licencas.txt` (servido em `/boboforces/licencas.txt` e embutido no romfs), e a tela Ajustes › Sobre › Créditos lê esse arquivo.
- **CI:** o `tools/credits` falha se uma dependência de produção ou um asset externo não tiver entrada em `CREDITOS.md`.
- **Marcas:** armas sem marcas reais [DECIDIDO #10]; glifos de botão genéricos, sem logos de Nintendo, Xbox ou PlayStation [PADRÃO]; nenhum asset com marca, bandeira ou exército real [DECIDIDO #19].

---

## 23. Roadmap técnico (ordem e critério de saída; tamanho P, M ou G) [DECIDIDO #28]

| Marco | Conteúdo técnico | Critério de saída |
|---|---|---|
| **M0 Fundação** (P) | Monorepo, tsconfig, guardas de lint e lib, CI, `version.json`, CHANGELOG, `CLAUDE.md`, `CREDITOS.md`/`DEPENDENCIAS.md`; `platform-api`; sim headless (passo fixo, RNG, ECS-lite, InputFrame, colisão AABB + DDA, perfil de movimento Bobo); robô de balanceamento rodando duelos de fuzil; input abstrato (teclado/mouse, gamepad, toque → ações); render base (three com shim, 1 chunk texturizado com texture array, câmera); UI WebGL base (MSDF, foco, 1 tela, tokens escuros); gerador de texturas com paleta e validador (base do `texgen`); deploy no Pages com splash; `apps/switch` stub com esbuild + teste em vm | CI verde; a URL publicada abre o splash em menos de 1 s; a sim roda 3.600 ticks headless com hash estável; o bundle do Switch passa no `portcheck` |
| **M1 Cena-vitrine + Teste Zero** (M) | `world` completo (formas, chunks, mesher por textura, AO, luz em canais); `texgen`, `skingen`, `modelgen`, `mapc`; Construto como cena-vitrine (blocos, peças fora da grade, props); bobos de caixas com skins e armas; bots burros (A* + hitscan); 1 a 4 viewports; HUD MSDF mínimo; F2. A **mesma cena** vira `/bench` na web e NSP de teste no Switch real | Prints aprovados pelo Erick (densidade de textura e peças fora da grade); critérios do Teste Zero (seção 24) |
| **M2 MVP web solo** (G) | Movimento arcade e perfis; 8 armas (pistola, SMG, fuzil, escopeta, sniper, lança-foguetes, faca, granada); hitscan + foguete e granada; Bobo Warfare TDM e FFA; Bobo Training; Surpreenda-me simples; Laboratório núcleo forte (5 níveis + sliders dos 4 eixos + salvar bots); Construto + 1 arena pequena; menus WebGL; Partida Rápida; settings, presets, estatísticas; teclado/mouse, gamepad e toque; LOD de IA; service worker e Novidades; Copiar relatório; backup; qualidade na primeira abertura | Orçamentos da 16.4 cumpridos; golden e balance no CI (5 níveis em ordem); PC de referência a 60 fps com 40 bots; Android de entrada a 30 fps com 12 bots; checkpoint Switch com o MVP num NSP (1 a 2 h de jogo) |
| **M3 Sofá** (M/G) | Entrada local de 1 a 4; tela dividida na web com controles; áudio pelo ouvinte mais próximo + mono; Bobo Zombies estilo CoD (ondas, pontos, armas na parede, barricadas, portas, caixa misteriosa, reviver, chefões); flow field; colisores dinâmicos; mapa de Zombies. É o ensaio do Switch no PC | 4 gamepads no PC dentro do orçamento; checkpoint Switch com 4 controles reais e Zombies a 30 fps |
| **M4 Port do Switch** (M) | `platform-switch` completo; save no SD com backup; NACP, ícone e title ID; menus sem online; ciclo de vida (dock/portátil, HOME/sleep, reconexão, bateria); `runtime.log`; verify; Eden + hardware; Teste Zero 2 com o jogo inteiro. 100% offline, uso pessoal | 4 jogadores em Bobo Zombies a 30 fps por 20 min na dock e no portátil, sem crash e com heap estável; NSP instalado no console do Erick |
| **M5 Online P2P** (G) | Lobby com código e link; host autoritativo; predição e reconciliação; lag compensation; `protocolVersion` e hash de conteúdo; regras de host ausente; expulsar e travar sala; pings e emotes; TURN decidido; aviso de privacidade | Loopback no CI; teste real entre 4G e wi-fi com 4 humanos + bots; host no celular com 8 bots a 30 fps |
| **M6+ Festa e conteúdo** (G) | BoboStrike, Bobo Paintball, Domination, Bobo Juggernaut, Bobo Sandbox completo, Oficina com códigos (`BF1-`/`BFP1-`, `#bot=`/`#p=`), Diretor de Partida, Aquário, Bobo Chaos, Bobo Royale Mini 24 (LOD C), mais mapas e armas | Cada modo com golden e bench; checkpoint Switch para o que for ao console |

**Por que o Teste Zero vem no M1, mesmo com o port no M4** [DECIDIDO #23]:
- Uma reprovação muda decisões caras: renderer (three ou próprio), texture array ou atlas, tamanho das regiões de render, `SIM_HZ` e tetos de bots.
- O custo é de cerca de 1 semana, e o Erick já tem Switch desbloqueado e o pipeline NRO/NSP do MMM.
- A mesma cena serve às duas perguntas do M1: "o visual está bonito?" (prints) e "o Switch aguenta?" (medição).

---

## 24. Teste Zero

### 24.1 A cena

Uma cena só, a cena-vitrine do Construto, com números realistas:

| Item | Valor |
|---|---|
| Mapa | Construto: área jogável de ~72×72 m e até 12 m de altura numa grade de 80×80×24 m, 3 níveis, com blocos, formas do catálogo na malha do chunk (rampas, lajes, cercas, vegetação em cruz) e props instanciados (cilindros, barris, caixas d'água, jipe, holofote); a bancada de materiais com vidro e água fica fora da área jogável (`arte-ux.md` 5.2) |
| Texturas | ~40 camadas de bloco, ~20 de modelo, skins compostas para todos os bobos |
| Bobos | 4 humanos + 12 bots armados (Switch 3–4P); variação com 24 bots (Switch 1P) e teste de estresse com 24 zumbis e com 48 bots, para achar a folga |
| Efeitos | Tiros hitscan, detritos no pool do perfil, partículas, HUD MSDF |
| Visão | 50 m (3–4P) e 90 m (1P) |
| Meta de render por viewport | 3–4P: ≤ 45 draw calls e ≤ 120 mil triângulos; 1P: ≤ 60 draw calls e ≤ 200 mil triângulos |

### 24.2 Checklist do que medir no Switch real (e no Eden, como referência)

| # | Item | Como medir | Se falhar |
|---|---|---|---|
| 1 | `getContext('webgl2')` no application mode e no applet | Boot nos dois modos | Mensagem "segure R" (já prevista) |
| 2 | `drawingBufferWidth/Height` na dock e no portátil | Log no boot | Ajustar perfil (720p assumido) |
| 3 | three.js sobe com o shim; quais `console.warn` aparecem | Log | Renderer WebGL2 próprio |
| 4 | **`TEXTURE_2D_ARRAY`**: criar 16×16×256 e 64×64×128 RGBA8 com mips, nearest/`NEAREST_MIPMAP_LINEAR`, wrap REPEAT dentro da camada, `MAX_ARRAY_TEXTURE_LAYERS`, `texSubImage3D` de skin em runtime | Cena de teste + print comparado com o PC | Atlas com padding e `textureGrad` |
| 5 | Atributos inteiros (`vertexAttribIPointer`) e atributos u8/u16 | Malha do chunk aparece igual ao PC | Decodificar como float no shader |
| 6 | Leitura de textura no vertex shader (`MAX_VERTEX_TEXTURE_IMAGE_UNITS`) | Teste mínimo | Informativo: o plano não depende disso |
| 7 | `OffscreenCanvas` 2D → `texImage2D` | Textura de teste | Informativo: plano B do texto |
| 8 | `FontFace` via `fonts.add()` desenhando em `OffscreenCanvas` | Texto de teste | Informativo: o MSDF não depende disso |
| 9 | FBO multisample (`renderbufferStorageMultisample`) + `blitFramebuffer` | Cena com AA 2× e custo medido | Switch segue sem AA |
| 10 | Tempo de frame: CPU com `performance.now`, GPU forçando `gl.finish()` em modo diagnóstico | F2 | Ajustar perfil |
| 11 | `renderer.info` por viewport (draw calls, triângulos, programas ≤ 7) | F2 | Regiões maiores, menos grupos de props |
| 12 | Custo de sim + IA com 12 armados, 24 zumbis, 24 e 48 bots | F2 e bench | `SIM_HZ` 30; orçamento de IA menor |
| 13 | Loading do Construto (malha, luz) e alocações do mesher | Cronômetro + heap | Pré-malhar no build |
| 14 | Pausas de GC e memória ao longo de 20 min | F2 + `runtime.log` | Pools; `heap_limit` |
| 15 | Travadas de compilação de shader | Primeiro frame e troca de cena | Aquecimento mais completo |
| 16 | Temperatura e clock: frame time depois de 10 min, na dock e no portátil | F2 | Perfil portátil mais leve |
| 17 | **4 controles completos** (pares de Joy-Con e Pro Controllers): `styleSet`, `deviceType`, ordem dos índices, rumble por controle, `+` bloqueado, Joy-Con avulso detectado | Tela "aperte A" de teste | Ajustar o adaptador de controle |
| 18 | **Teclado do sistema** no nx.js para entrada de texto | Chamada de teste | Teclado próprio no canvas |
| 19 | **Áudio:** `decodeAudioData` de MP3 do romfs, 24 vozes simultâneas, latência do tiro, `createBuffer` para sons sintetizados, StereoPanner, `resume()` depois do HOME | Cena com tiros + log | Sons sintetizados no build; menos vozes |
| 20 | Ciclo de vida: troca dock/portátil no meio, volta do HOME e do sleep, `navigator.getBattery()` | Teste manual com log | Detecção por intervalo de frame e por `styleSet` |
| 21 | `Intl` e `DecompressionStream` | Log | Informativo: as regras já evitam depender deles |

### 24.3 Critério de aprovação

- **Switch na dock com 4 viewports, 12 bots armados e visão de 50 m: 30 fps estáveis por 10 minutos** (p99 do frame até 40 ms).
- Switch 1P com 24 bots e visão de 90 m a 30 fps.
- Heap abaixo de 200 MB; loading do Construto em até 4 s.
- three.js funcionando com o shim; texture array funcionando ou atlas de plano B validado.
- PC de referência a 60 fps com 4 viewports e 24 bots; Android de entrada a 30 fps com 1 viewport e 12 bots.
- Prints aprovados pelo Erick.

### 24.4 Se reprovar, tentar nesta ordem

1. Ajustar o perfil do Switch: detritos, partículas, regiões de render, `SIM_HZ` de 30. Cortar visão ou tetos abaixo dos valores iniciais exige registro em `DECISOES.md`.
2. Trocar o texture array pelo atlas com padding, se o problema for o array.
3. Modo 3–4P de baixo custo: viewmodel simplificado, menos props por viewport, HUD mínimo. Os 4 jogadores continuam obrigatórios.
4. Trocar o three.js por um renderer WebGL2 próprio, só no pacote `render`.
5. Avaliar o Brewser.

---

## 25. Riscos técnicos e mitigação

| Risco | Mitigação |
|---|---|
| three.js não sobe ou rende mal no nx.js (Mesa/nouveau, uma thread do A57) | Teste Zero no M1; render isolado; plano B com renderer próprio |
| `TEXTURE_2D_ARRAY` ou atributos inteiros falham no nx.js | Item do T0; atlas com padding atrás de `#define`; decodificação em float |
| CPU estoura com 4 viewports e bots | LOD de IA; teto de visão por perfil; `SIM_HZ` 30 no Switch; tetos conservadores que só sobem com medição |
| nx.js em beta muda a API | Versão fixa; build do Switch no CI desde o M0; checkpoint a cada marco |
| Controles no Switch (pares, índices e estilos sem documentação) | Item 17 do T0; tela "aperte A" para reatribuir; Joy-Con avulso recusado com mensagem |
| GPU do portátil bem mais lenta que a da dock | Medição nos dois modos; perfil portátil reduz detritos e partículas |
| iOS: sem tela cheia, áudio mudo ao voltar, página encerrada por memória, dados apagados em 7 dias | Menos de 300 MB; recriar recursos após perda de contexto; `resume` do áudio; dica de "Adicionar à Tela de Início" e backup |
| Host P2P congela em segundo plano | Regras da 13.4: coop pausa, PvP encerra em 10 s; detecção por silêncio de snapshot |
| NAT simétrico no 4G | TURN decidido antes de abrir o online |
| Pausas de GC | ECS em typed arrays, pools, mesher e composição de skin sem alocação no laço |
| Travadas de compilação de shader | No máximo 7 programas, compilados no loading |
| Dados novos da web chegam a um Switch antigo | IDs estáveis, recusa de versão maior, fallback de conteúdo |
| Escopo enorme | Marcos com critério de saída; MVP enxuto (M2); modos de festa só no M6+ |

---

## 26. Pendências

O que continua aberto de verdade:

1. **Densidade de textura e peças fora da grade:** 32 px/m no cenário, 16 px/m nos bobos e a quantidade de rampas, cercas, cilindros e props aprovadas pelo Erick por prints da cena-vitrine (M1).
2. **Itens a validar no Teste Zero** (seção 24.2), principalmente three.js com shim, `TEXTURE_2D_ARRAY`, atributos inteiros, teclado do sistema, áudio, 4 controles completos e o ciclo de vida. Os resultados vão para `docs/PERF.md`, e os tetos de bots e de visão sobem conforme as medições.
3. **Antes de abrir o online (M5):** decidir o TURN (Cloudflare com Worker exige conta do Erick; Open Relay como reserva), confirmar se o Trystero na versão fixada expõe as `RTCPeerConnection` e revisar o aviso de privacidade, inclusive as obrigações do ECA Digital (Lei 15.211/2025) para um jogo que crianças acessam.
4. **Aparelhos de referência:** registrar em `docs/PERF.md` os modelos exatos do celular do Erick e do Android de entrada.
5. **Versão do nx.js para o port (M4):** migrar para a 1.0 estável se ela já existir.
