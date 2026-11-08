# Plano do M1: Cena-vitrine + Teste Zero (02/11/2026)

> Fonte: `docs/GDD.md` §4.6, §5.1–§5.8 e §7; `docs/design/tecnico.md` §5, §6, §8, §15, §16 e §24;
> `docs/design/arte-ux.md` (Construto, skins, armas, VFX, prints). `docs/DECISOES.md` manda sobre este plano
> (decisões #46–#49 tomadas no início do M1).

## Objetivo

Uma cena só responde às duas perguntas do M1: **"está bonito?"** (prints que o Erick aprova) e **"o Switch aguenta?"**
(Teste Zero medido no Eden e no console). A cena é o **Construto com bobos e bots**: mundo completo, assets gerados por
script, bobos de caixas com skins, armas, VFX, Dia/Entardecer/Noite, 1 a 4 vistas, HUD mínimo e o painel F2. A mesma
cena vira o **`/bench`** da web e o **NRO de teste** do Switch.

O M1 ainda **não é o jogo**: não tem modos, menus completos nem Laboratório (isso é o M2).

## Critério de pronto (GDD §7, tecnico.md §24.3)

1. **Prints aprovados pelo Erick:** (1) Dia, Entardecer e Noite; (2) densidade de textura, com bobo e parede a 1 m e
   3 m; (3) peças fora da grade em três doses (só blocos, proposta, dobro); (4) leitura de bobos a 5, 15, 30 e 50 m em
   640×360, com e sem contorno, também em cinza; (5) filtro de mipmap no chão ao longe. Mais o print das **fontes**
   candidatas (decisão #46).
2. **Switch na dock** com 4 vistas, 12 bots armados e visão de 50 m: **30 fps estáveis por 10 min** (p99 ≤ 40 ms).
3. Switch 1P com 24 bots e visão de 90 m a 30 fps; heap < 200 MB; loading do Construto ≤ 4 s.
4. three funcionando com o shim no nx.js; texture array **ou** atlas de plano B validado.
5. PC de referência (i5-12450H + RTX 2050) a 60 fps com 4 vistas e 24 bots; Redmi Note 13 (Android de entrada) a
   30 fps com 1 vista e 12 bots; Galaxy A36 medido como referência.
6. Resultados e tetos revistos em `docs/PERF.md`.

E, como no M0: `npm run check`, builds, `portcheck --strict`, `balance`, `smoke:web` e golden verdes.

## O que entra

| Área | Entrega |
|---|---|
| `world` | Catálogo de formas na célula (laje, degrau, rampas 1:1 e 1:2 com quinas, painel fino, poste + travessa, cruz) com orientação; `BlockDef` com flags; regiões de render 2×2×1 chunks; greedy meshing por textura com AO 0fps e troca da diagonal; vértice compacto de 12 bytes; luz em canais (céu e emissivo por flood fill, sol por varredura); grade de luz de 2 m para atores; colisão e DDA com as formas |
| `format` | `map@1` (`.bfmap`) e `model@1` (`.bfmodel`) com validadores; registro de IDs de blocos, modelos e mapas |
| `nav` | Grade 2,5D a partir do mundo (degrau, rampa, laje), A* com orçamento por frame; validação de spawns alcançáveis |
| `sim` + `ai` | Movimento sobre as formas; spawns do mapa; bots N0 (A* + fuzil hitscan); zumbis de estresse (perseguem e batem); eventos de acerto com ponto e material (para a cor dos cubinhos); 24 e 48 bots; golden novo |
| `render` | Os 7 programas (opaco, cutout, translúcido, instanciado, partículas, céu, UI); `blocos16` e `modelos64` como `TEXTURE_2D_ARRAY` com mips e `NEAREST_MIPMAP_LINEAR`; **atlas de plano B e atributos em float atrás de chave**, para um só Teste Zero medir as duas rotas; bobos instanciados com skins compostas (6 partes + rosto no M1; depois do port do boneco do FutBobo, #56: 1 draw por vista e skins de 2 camadas); armas, props por grupo de 32 m, detritos e morte que desmonta; viewmodel; céu, fog, LUT e hora do dia por uniform; 1 a 4 vistas com culling por vista; estatísticas por vista; aquecimento de shaders |
| `ui` + `game` | Construto como cena; loading cronometrado; HUD mínimo por vista (640×360 de referência); painel F2 (frame CPU/GPU, p50/p99, draw calls, triângulos, programas, heap, bots); modo bench com roteiro de câmera e relatório; tela de comparação de fontes |
| tools | `texgen` (paleta mestra de 64 cores + ~40 camadas de bloco + mips com cobertura de alfa), `skingen` (partes 64×64, folha de rostos 8×8, zumbi; no port #56 virou a prévia do pintor de skins), `modelgen` (`.bfmodel`: pistola, fuzil, sniper, barril, caixa d'água, jipe, holofote, cilindros, lona, gerador, árvore), `mapc` (API `box`/`ramp`/`fence`/`prop`/`spawn`… → `.bfmap`, com validações) e `scripts/prints.ts` (prints automáticos no Edge) |
| `audio` | Mixer mínimo (Context, BufferSource, Gain, StereoPanner) só para o item 19 do Teste Zero; o áudio de verdade é do M2 |
| `apps/web` | `/bench` por parâmetros de URL, relatório para copiar, prints |
| `apps/switch` | NRO do Teste Zero; sondas dos 21 itens do checklist (tecnico.md §24.2) gravando no `runtime.log`; tela "aperte A" com os 4 controles; teste de teclado e de áudio; ciclo de vida; preparo do Eden |
| docs | `docs/TESTE_ZERO.md` (passo a passo para o Erick no Eden e no console), `PERF.md`, `CREDITOS.md` (fontes, Kenney), `DEPENDENCIAS.md`, `ARCHITECTURE.md`, CHANGELOG |

## Escolhas do Claude neste plano (revisáveis)

- **Plano B já pronto:** o atlas com padding e a decodificação dos atributos em float entram no M1 atrás de uma chave
  do bench. Assim um único Teste Zero no console mede as duas rotas, em vez de pedir uma segunda rodada ao Erick.
- **Tela dividida só no bench:** as 4 vistas seguem 4 jogadores locais (bots no lugar dos humanos, ou controles reais
  na tela de teste do Switch). O lobby "aperte A" de verdade é do M3.
- **Pré-malha no build só se o loading passar de 4 s** no Teste Zero (tecnico.md §6.2).
- **Sem modos e sem menus novos** além do necessário para abrir a cena, o bench e as telas de teste.
- **Sons CC0 da Kenney** convertidos para MP3 por ferramenta local (a conversão fica registrada em `DEPENDENCIAS.md`
  se precisar de dependência nova de ferramenta).

## Como vai ser feito

Em dois workflows, com revisão minha entre eles:

1. **Contratos + frentes em paralelo.** Um agente fixa os contratos novos (formas e células, `map@1`, `model@1`, skins,
   API do render para mundo, atores, props, VFX e vistas, `nav`, estatísticas do bench, formato do `runtime.log`) e
   a matriz de quem é dono de quê. Depois as frentes trabalham em paralelo, cada uma só nas suas pastas: mundo;
   texturas; skins e modelos; mapa + navegação; sim + IA; render do mundo; render dos atores e VFX; UI, fontes e HUD;
   Switch, áudio e Teste Zero.
2. **Integração + prints + verificação.** A integração monta o Construto no `game`, liga bench, F2 e prints e roda
   tudo; revisores independentes conferem critérios, portabilidade, bugs, desempenho e arte (lendo os prints); um
   agente corrige o que for confirmado.

Depois disso vêm as etapas que dependem do Erick: aprovar os prints e rodar o Teste Zero.

## O que precisa do Erick

- **Aprovar os prints** (os 5 conjuntos e as fontes). O que for reprovado volta para ajuste.
- **Teste Zero:** primeiro no Eden deste PC, depois no console (NRO pelo hbmenu segurando R num jogo). O
  `docs/TESTE_ZERO.md` traz o passo a passo e o que anotar; o jogo grava tudo no `runtime.log` do SD.
- **Celulares:** abrir o `/bench` publicado no Galaxy A36 e no Redmi Note 13 e copiar o relatório.
- **Commits e push:** só com o pedido dele, como sempre.

## Fora do M1

Modos, partida de verdade, menus completos, Laboratório, 8 armas, perfis de movimento, 3ª pessoa, áudio completo e
música (M2); lobby local, Zombies e flow field (M3); port completo do Switch (M4); rede (M5).
