# Desempenho: medições e tetos

> Orçamentos são medidos, não estimados (tecnico.md §1.8). Este arquivo guarda as **medições** (painel F2, bench
> headless, size-check, Teste Zero) e o **histórico dos tetos** por perfil. Os orçamentos-alvo estão em
> `docs/design/tecnico.md` §16; não copie os números de lá para cá, registre o que foi medido.
>
> Estado: primeiras medições do M0 (02/11/2026, integração). O Teste Zero (M1) traz as do Switch real.

## Como registrar

- Uma linha por medição, a mais nova no topo da tabela da seção.
- Sempre com: data, versão/codinome + commit (ou "local"), aparelho, cena e configuração (viewports, bots, perfil).
- Mudança de teto de perfil vai na seção "Histórico dos tetos", com o motivo e a medição que justificou.
- Itens marcados [T0] no tecnico.md são confirmados aqui.

## 1. Sim + IA headless (bench)

Golden: Bobo Warfare TDM, 8 bots, semente 42, 3.600 ticks.

| Data | Build | Máquina | Bots | ms/tick sim (p50/p90) | ms/tick IA (p50/p90) | Hash golden | Observação |
|---|---|---|---|---|---|---|---|
| 02/11/2026 | 0.0.1 local (revisão do M0) | i5-12450H, Node 26.7 | 8 | — | — | `e3f37a6e` | 36.000 ticks depois do aquecimento em 314 ms (8,7 µs/tick sim + IA). **Alocação no laço quente (regra 11) ainda existe:** 16 GCs menores (total 3,5 ms, maior 0,65 ms) e heap +3,3 MB nesses 36.000 ticks; vem de doubles encaixotados em funções numéricas não inlinadas, não de arrays/closures no fonte. Acompanhar no F2 e no Teste Zero (pausa de GC ≤ 5 ms) antes de mexer (tecnico.md §16.3) |
| 02/11/2026 | 0.0.1 local (revisão do M0) | i5-12450H, Node 26.7 | 8 | — | — | `a1a14dc9` (30 Hz) | mesma partida com `hz: 30`: 50 × 51 abates e 1.608 × 1.562 tiros em 60 s (60 × 30 Hz), 36 ms para 1.800 ticks |
| 02/11/2026 | 0.0.1 local | i5-12450H, Node 26.7 | 8 | 0,004 / 0,010 | 0,006 / 0,013 | `f991a92c` | 3.600 ticks em ~49 ms (0,014 ms/tick com IA), 2ª execução (JIT aquecido) |
| 02/11/2026 | 0.0.1 local | i5-12450H, Node 26.7 | 2 (duelo) | — | — | — | `npm run balance`: 3.000 duelos em 1,9 s, ordem dos 5 níveis ok |

## 2. Frame no aparelho (painel F2)

| Data | Build | Aparelho | Cena | Viewports | Bots | FPS p50/p90 | ms sim / IA / render / UI | Draw calls (por viewport) | Triângulos | Programas | Heap / maior pausa de GC | Observação |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 02/11/2026 | 0.0.1 local | PC, Edge 156 headless (ANGLE), 1280×720 DPR 1 | título | 0 | 0 | — | — | 1 (UI) | — | 1 | — | `smoke:web`; sem painel F2 ainda |
| 02/11/2026 | 0.0.1 local | PC, Edge 156 headless (ANGLE), 1280×720 DPR 1 | cena de teste (arena 64×16×64 células) | 1 | 4 | — | — | 7 (4 malhas de chunk + 2 instanciados + 1 UI) | — | 3 | — | `smoke:web`; teto 7 (regra 8) |

## 3. Download e tempo (web, size-check e e2e)

| Data | Build | HTML + splash | Menu interativo | Primeira partida | Tempo até o splash | Tempo até o menu (PC / celular) | Observação |
|---|---|---|---|---|---|---|---|
| 02/11/2026 | 0.0.1 local (revisão do M0) | — | — | — | 176 ms (FCP); 632 ms com `CI=1` (SwiftShader) | 561 ms / — | `smoke:web` em 127.0.0.1, agora também em 667×375. **A URL publicada (critério 2 do M0) ainda não existe**: falta o repositório e o push (P-002) |
| 02/11/2026 | 0.0.1 local | 3,8 KB | 338,3 KB | 340,2 KB (build inteiro) | 160 ms (FCP) | 547 ms / — | `size-check` + `smoke:web` (vite preview em 127.0.0.1, Edge headless, cache vazio). Menu = HTML + JS (three 131 KB, core 54 KB, casca 10 KB) + atlas MSDF (134 KB + 7 KB) |
| 02/11/2026 | 0.0.1 local | 3,8 KB | 375,2 KB | — | 2.088 ms (FCP) | — | antes dos ajustes: atlas RGBA com minúsculas na display (170 KB) estourava os 350 KB; criar o contexto WebGL2 antes do primeiro pixel segurava o splash |

## 4. Switch (Eden e hardware)

| Data | Build | Onde (Eden / dock / portátil) | Cena | Jogadores | Bots | FPS mínimo | Boot até o menu | Heap | romfs | Observação |
|---|---|---|---|---|---|---|---|---|---|---|
| 02/11/2026 | 0.0.1 local | portcheck (node:vm, sem GPU, NullRenderer) | título | — | — | — | frame 1 (17 ms simulados) | — | main.js 1.415 KB + 4 assets | não é o Switch real: prova o boot do bundle com os globais do nx.js |

## 5. Teste Zero (M1)

Checklist e critério de aprovação em tecnico.md §24. Resultado de cada item aqui, com print/arquivo em `local/` (fora
do git) quando houver.

| Item (tecnico.md §24.2) | Resultado | Data | Observação |
|---|---|---|---|
| | | | |

## 6. Histórico dos tetos por perfil

Valores iniciais em tecnico.md §16.1 (conservadores). Registre só as mudanças.

| Data | Perfil | O que mudou (de → para) | Medição que justificou |
|---|---|---|---|
| | | | |
