# BOBOFORCES

FPS bobo da EriLab com visual blocado pixel-art, na linha de Block Strike e Pixel Gun 3D. Você configura os bots (quantos, quão espertos, quão certeiros, com que personalidade e com que vantagens) e joga sozinho, com até 4 pessoas em tela dividida ou com até 4 humanos online por link. Sem ranking, sem progressão, sem estresse: o desafio é você quem escolhe.

- **Web** (PC e celular): solo, tela dividida local no PC e online P2P. Vai ficar em `erereck.github.io/boboforces`.
- **Switch homebrew** (nx.js): 100% offline, solo e local até 4, só para uso pessoal.

## Status

**M0 (Fundação) integrado (02/11/2026).** Na web, o jogo sobe até a tela de título e uma cena de teste (você e 1 bot
contra 3 bots, ainda em caixas), com HUD e pausa. Ainda não é jogável de verdade: isso começa no M2. Requer Node.js
24 ou mais novo (`npm install`, `npm run check`; `npm run dev -w @boboforces/web` para rodar local). Regras para agentes em [`CLAUDE.md`](CLAUDE.md) e
arquitetura em [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Documentos

| Documento | Para que serve |
|---|---|
| [`docs/DECISOES.md`](docs/DECISOES.md) | As decisões do Erick e as decisões menores do Claude. **Manda sobre todos os outros textos.** |
| [`docs/GDD.md`](docs/GDD.md) | Documento-mestre: o jogo inteiro, plataformas, conteúdo, arte, técnica, roadmap, riscos e pendências. **Comece por aqui.** |
| [`docs/design/gameplay.md`](docs/design/gameplay.md) | Regras, números, armas, bots e Laboratório, modos, mapas, presets. |
| [`docs/design/tecnico.md`](docs/design/tecnico.md) | Arquitetura, render, rede, save, orçamentos, Teste Zero e as regras de ouro de portabilidade. |
| [`docs/design/arte-ux.md`](docs/design/arte-ux.md) | Direção de arte, bobos, UI, controles, áudio e marca. |
| [`docs/CREDITOS.md`](docs/CREDITOS.md) | Licenças de terceiros planejadas e a nota de direitos do projeto. |
| [`docs/pesquisa/`](docs/pesquisa/) | Material de apoio: a conversa original, as convenções da EriLab, o port do MMM para nx.js, nx.js no Switch, render de blocos e P2P/celular. **`render-voxel.md` é histórica:** as recomendações de props `.vox`, exportação do MagicaVoxel, luz e AO em cor por vértice e Brotli foram superadas pelas decisões #5–#7 e #45 e pelas decisões menores de Formatos e de Luz do cenário. Vale o que está nos documentos de design. |

Os outros arquivos (`CLAUDE.md`, `CHANGELOG.md`, `version.json`, `docs/ARCHITECTURE.md`, `docs/PORTABILIDADE.md`, `docs/PERF.md`, `docs/DEPENDENCIAS.md`, `docs/PROMPTS.md` e `.interface-design/system.md`) nasceram no M0.

## Roadmap

M0 Fundação → M1 Cena-vitrine + Teste Zero (mesma cena) → M2 MVP web solo → M3 Sofá (tela dividida + Bobo Zombies) → M4 Port do Switch → M5 Online P2P → M6+ Modos de festa e conteúdo. Detalhes e critérios de pronto em [`docs/GDD.md` §7](docs/GDD.md#7-roadmap).

## Licença

© EriLab. Todos os direitos reservados. O repositório é público, mas não tem licença aberta (decisão #41): ver o código não dá permissão para copiar, modificar ou redistribuir. Licenças de terceiros em [`docs/CREDITOS.md`](docs/CREDITOS.md).
