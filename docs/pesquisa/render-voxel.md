> **Pesquisa histórica (02/11/2026).** Feita quando a premissa era voxel puro (MagicaVoxel, micro-voxels, `.vox`). A direção mudou para blocos com textura pixel-art na linha de Block Strike / Pixel Gun 3D (`docs/DECISOES.md` #5–#7 e #45). Continua valendo para meshing, AO, luz, orçamentos e carregamento; o que vale para arte e pipeline está em `docs/design/arte-ux.md` e `docs/design/tecnico.md`.

**Resposta curta:** recomendo um mapa estático em chunks com greedy meshing e luz/AO "bakeados" em vertex color, props .vox instanciados, personagens de partes rígidas e nenhum pós-processamento. Também colisão e navegação próprias contra a grade voxel, sem física em WASM. Não encontrei confirmação de que three.js rode no nx.js nem de quanto ele rende lá: esse é o maior risco e vale um protótipo na primeira semana.

## CONFIRMADO (com fonte)

- **C1. nx.js:** agora usa V8 e suporta WASM e WebGL2 sobre OpenGL ES 3 real ([README](https://github.com/TooTallNate/nx.js)). O WebGL2 vem por EGL + Mesa/nouveau. O modo applet roda sem JIT por padrão; o modo application mantém JIT ([v1.0.0-beta.4](https://github.com/TooTallNate/nx.js/releases/tag/v1.0.0-beta.4)).
- **C2. GPU do Tegra X1:** Maxwell, 256 núcleos, 768 MHz na dock e cerca de 307 MHz no portátil ([Chips and Cheese](https://chipsandcheese.com/p/nintendo-switchs-igpu-maxwell-nerfed-edition)).
- **C3. VOXLoader (branch dev):**
  - Faz greedy meshing que funde faces só pela cor e remove faces internas.
  - Usa vertex colors com `MeshStandardMaterial` e lê nTRN/nGRP/nSHP.
  - Não calcula AO nem emissivo, e o `VOXMesh` está deprecado.
  - Fontes: [código](https://github.com/mrdoob/three.js/blob/dev/examples/jsm/loaders/VOXLoader.js), [docs](https://threejs.org/docs/pages/VOXLoader.html).
- **C4. AO por vértice:** `ao = (s1&&s2) ? 0 : 3-(s1+s2+canto)`, com troca da diagonal do quad para a interpolação ficar certa. O greedy só pode fundir faces com o mesmo AO nos 4 vértices, e o custo é pequeno ([0fps](https://0fps.net/2013/07/03/ambient-occlusion-for-minecraft-like-worlds/)).
- **C5. EffectComposer:** cria por padrão um render target `HalfFloatType` ([código](https://github.com/mrdoob/three.js/blob/dev/examples/jsm/postprocessing/EffectComposer.js)). Em WebGL2 sem EXT_color_buffer_(half_)float, renderizar nele falha em silêncio ([PR #33114](https://github.com/mrdoob/three.js/pull/33114)).
- **C6. BatchedMesh:** sem WEBGL_multi_draw, cai para um loop de `drawArrays` ([PR #27178](https://github.com/mrdoob/three.js/pull/27178)).
- **C7. Tela dividida:** um canvas só, chamando `setViewport` + `setScissor` antes de cada render ([exemplo](https://github.com/mrdoob/three.js/blob/master/examples/webgl_multiple_elements.html), [fórum](https://discourse.threejs.org/t/render-multiple-views/57999)).
- **C8. Tamanho do three.js:** o build WebGL completo tem cerca de 86 KB minificado + gzip na r181dev ([PR #32154](https://github.com/mrdoob/three.js/pull/32154)).
- **C9. Rapier:** o pacote `-compat` embute o WASM em base64 ([rapier.js](https://github.com/dimforge/rapier.js)). Dá cerca de 816 KB gzip segundo um site de terceiros, número não oficial ([DepScope](https://depscope.dev/pkg/npm/@dimforge/rapier3d-compat)).
- **C10. Navegação:**
  - recast-navigation-js é Recast/Detour em WASM, com helpers para three ([README](https://cdn.jsdelivr.net/npm/@recast-navigation/three@0.43.1/README.md)).
  - navcat é JS puro, tree-shakeable e serializa em JSON. Os próprios autores admitem que o recast é mais rápido em runtime ([navcat](https://gittrend.io/repo/isaac-mason/navcat)).
- **C11. Teardown:**
  - Sincroniza a rede por determinismo, sem enviar voxels ([80.lv](https://80.lv/articles/teardown-developer-breaks-down-multiplayer-and-voxel-destruction-tech)).
  - Comprime os níveis com RLE ([PCGH](https://www.pcgameshardware.de/Teardown-Spiel-73677/Specials/PC-Game-Test-Benchmark-Voxel-Dynamic-Destruction-1394545/2/)).
- **C12. three-mesh-bvh:** acelera raycast e shapecast em malhas de triângulos ([docs](https://gkjohnson.github.io/tools/docs/three-mesh-bvh/)).
- **C13. Entrega dos arquivos:** Brotli comprime melhor que gzip, e arquivos com hash podem usar `Cache-Control: immutable` ([gist](https://gist.github.com/Calinou/fc0fe1003c95380054f0084f9476e476)).

## INFERIDO / OPINIÃO

**1) Mundo**
- **Recomendado:** um mapa estático em chunks de 32³, com greedy meshing e AO no seu próprio mesher (C4). O VOXLoader funde faces só pela cor e quebraria o AO (C3).
- Props .vox repetidos vão em `InstancedMesh`, uma draw call por tipo.
- **Rede:** basta enviar o ID do mapa. Bots usam a grade fixa.
- **Destruição total:**
  - Exige refazer a malha dos chunks atingidos, no máximo 1–2 por frame.
  - As edições viram eventos determinísticos, como no Teardown (C11).
  - A navegação precisa ser invalidada. A* em grade aguenta isso; navmesh exige reconstruir tiles.
- **Meio-termo:** props quebráveis que viram gibs, sem mudar colisão nem navegação.

**2) Iluminação**
- **Cenário:** "bakear" no vertex color a cor da paleta × AO × (hemisfério + N·L de um sol fixo).
  - Só existem 6 normais, então o sol fixo pode ser calculado na hora de gerar a malha.
  - Sombras do cenário saem de raycast na grade, também na geração.
  - Renderizar com `MeshBasicMaterial({vertexColors})` + fog linear, o shader mais barato possível.
- **Objetos dinâmicos:** `MeshLambertMaterial` + Hemisphere + Directional, sem shadow map.
  - Sombras de blob: um quad radial instanciado, mais o AO do chão.
- **Pós-processamento:** evitar o EffectComposer (C5). Se usar, forçar `UnsignedByteType`.
- **Color grading:** fazer dentro do shader via `onBeforeCompile` (curva/LUT 1D de 256 px), com zero passes extras.
- **Outline:** escurecer as bordas no bake, ou casco invertido só em personagens e armas.
- **WebGL2 sem extensões:** isso já elimina texturas comprimidas, render targets float e filtro anisotrópico. Voxel com vertex color não precisa de nenhum deles.

**3) Personagens**
- **Partes rígidas:** cabeça, tronco, braços, pernas e arma, animadas proceduralmente (seno para andar, rotação para mirar).
  - Um `InstancedMesh` por parte dá cerca de 7 draw calls para todos os bots em cada viewport.
- **Skinning:** deforma os voxels (fica feio) e custa uma draw call por bot.
- **Morte:**
  - As partes viram corpos simples com Verlet e colisão contra a grade.
  - Gibs são um pool de 300–500 cubinhos instanciados, com física balística própria.

**4) Pipeline**
- Exportar do MagicaVoxel e converter com um script Node no build para um formato próprio:
  - Paleta de 256 cores + voxels em RLE + Brotli.
- **Opção A, malhar no cliente:** rápido com JIT. No Switch, rodar como application para ter JIT (C1).
- **Opção B, pré-malhar:**
  - Posição em Int16/Uint8, normal como índice 0–5, cor + AO em Uint8.
  - Fica em cerca de 8–12 bytes por vértice, em vez de ~36.
- O VOXLoader serve para protótipo, trocando o material.
- Geração procedural para terreno, árvores e variação de cor na paleta. É isso que dá o "capricho".

**5) Orçamentos**

Alvo: 30 fps com 4 viewports no Switch e em celular médio; 60 fps com 1–2 viewports.

| Item | Por viewport | Total |
|---|---|---|
| Draw calls | ≤ 40–60 | ≤ 200 |
| Triângulos visíveis | ≤ 100–150k | ≤ 500k |
| Texturas | — | < 2 MB (paleta, blob, LUT) |
| Memória GPU | — | < 150 MB |
| Heap JS | — | < 200 MB |
| Programas de shader | — | ≤ 5 |

- Em 720p, cada viewport fica com 640×360. No celular, usar `pixelRatio` 1.
- O que escala com 4 viewports é CPU e vértices, não pixels. Por isso: culling por chunk e fog curta servindo como plano distante.
- Medir com `renderer.info`.
- **Risco não verificado:** o desempenho do Mesa/nouveau em relação ao driver nativo do Switch (C1, C2). Prototipar cedo.

**6) Bibliotecas**
- **Colisão:** AABB varrido contra a grade, no estilo Minecraft, + DDA para hitscan.
  - three-mesh-bvh (C12) é desnecessário no mundo voxel.
  - Rapier (C9) é pesado demais para a meta de carregamento.
- **Navegação:**
  - A* em grade 2,5D (célula andável = sólido embaixo + 2 vazios em cima), com flow field compartilhado entre bots.
  - Para crowd: navcat com navmesh gerado offline e serializado (C10), sem WASM.
  - recast-navigation-js só se precisar reconstruir navmesh em runtime.

**7) Carregamento rápido**
- three.js com tree-shaking fica abaixo dos ~86 KB gzip do build completo (C8).
- **Meta inicial:** < 1 MB em Brotli, com 300–400 KB de JS e 100–300 KB do primeiro mapa.
- **Cache:** arquivos com hash + `immutable` + service worker com precache (C13).
- **Ordem de carga:** menu → mapa atual → sons e outros mapas em segundo plano.
- Aquecer os shaders na tela de loading.
- **Switch:** tudo dentro do pacote (romfs), carregando cada mapa sob demanda.