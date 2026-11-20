/**
 * Definições dos blocos (`blocks@1`, contrato em packages/world/src/block-source.ts): fonte da verdade em texto. O
 * `tools/texgen` valida estas definições contra as camadas de `blocos16` e grava `generated/blocks.json`, que o
 * loading lê (`parseBlockDefs` → `resolveBlockDefs` → `createMapBlockRegistry`) e o `mapc` consulta.
 *
 * - `key`: ID de conteúdo estável SEM prefixo (`concrete` = `block:concrete`), registrado em `CONTENT_IDS`. Nunca
 *   renomeie nem apague: bloco aposentado vai para `RETIRED_CONTENT_IDS` (tecnico.md §14.5).
 * - `faces`: NOME da camada base por face, na ordem +X, −X, +Y, −Y, +Z, −Z. Rampas usam a de +Y na face inclinada
 *   (−Y se invertidas); a cruz usa a de +X.
 * - `variants`/`frames`: toda face aponta um grupo do texgen com pelo menos `variants` variantes e exatamente `frames`
 *   quadros (camada final = base + variante·quadros + quadro).
 * - Flags (GDD §4.6.1): sólido bloqueia movimento; cerca de arame deixa passar bala e visão; cerca de madeira fechada
 *   bloqueia tudo; vegetação em cruz não bloqueia nada (o "atrapalha a detecção" é da IA), menos o milharal do M10,
 *   que tapa a visão; grade de passarela é chão que deixa passar bala e visão.
 * - `stepSound`: id do som de passo (o áudio de verdade é do M2; ids em `STEP_SOUNDS`). Vazio = não dá para pisar.
 */
import type { BlockFlagName, BlockShape, BlockSourceDef } from '@boboforces/world';
import { CONTAINER_COLORS } from '../textures/blocos16/porto.ts';

/** Sons de passo usados pelos blocos (a frente de áudio do M2 grava um conjunto por id). */
export const STEP_SOUNDS = [
  'concrete',
  'metal',
  'wood',
  'grass',
  'dirt',
  'leaves',
  'canvas',
  'glass',
  'water',
] as const;
type StepSound = (typeof STEP_SOUNDS)[number] | '';

type Faces = BlockSourceDef['faces'];

/** Mesma camada nas 6 faces. */
const all = (layer: string): Faces => [layer, layer, layer, layer, layer, layer];
/** Laterais, topo e base. */
const sides = (side: string, top: string, bottom: string = top): Faces => [side, side, top, bottom, side, side];

/** Bloco cheio comum: sólido, para bala e visão, dá para pisar. */
const SOLID: readonly BlockFlagName[] = ['solid', 'blocksBullets', 'blocksSight', 'walkable'];

interface Def {
  readonly key: string;
  readonly shape: BlockShape;
  readonly faces: Faces;
  readonly flags: readonly BlockFlagName[];
  readonly stepSound: StepSound;
  readonly variants?: number;
  readonly frames?: number;
  readonly emissive?: number;
}

const def = (d: Def): BlockSourceDef => ({
  key: d.key,
  shape: d.shape,
  faces: d.faces,
  flags: [...d.flags],
  emissive: d.emissive ?? 0,
  frames: d.frames ?? 1,
  variants: d.variants ?? 1,
  stepSound: d.stepSound,
});

/** Setores do Construto (3×3, numerados de noroeste a sudeste, linha a linha). */
const SECTOR_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

const CONCRETE_FLAGS: readonly BlockFlagName[] = [...SOLID, 'colorVariation', 'randomUv'];
const MODULAR_FLAGS: readonly BlockFlagName[] = [...SOLID, 'colorVariation'];

/** Formas de concreto (laje, rampas…) com o concreto contínuo de 4 variantes. */
const concreteShape = (key: string, shape: BlockShape): BlockSourceDef =>
  def({ key, shape, faces: all('concrete'), flags: CONCRETE_FLAGS, variants: 4, stepSound: 'concrete' });

/** Rampas de telhado: chapa ondulada na face inclinada (e embaixo, o forro do galpão), painel oliva nos lados. */
const roofShape = (key: string, shape: BlockShape): BlockSourceDef =>
  def({
    key,
    shape,
    faces: ['metal', 'metal', 'metal_roof', 'metal_roof', 'metal', 'metal'],
    flags: SOLID,
    stepSound: 'metal',
  });

// ---------------------------------------------------------------------------------------------------------------
// M10 (fase 0): o kit dos 5 mapas novos. Camadas em assets-src/textures/blocos16/{porto,canteiro,paintball,lua,
// fazenda}.ts; as montagens (contêiner, guindaste, porta de celeiro) em assets-src/maps/kit.ts. Blocos são a base
// (greedy, custo zero de draw call); o que é redondo ou fora da grade é prop (assets-src/models/map-kit.ts).

/** Cores dos contêineres (`container-<cor>` e `container-<cor>-door`), as mesmas das camadas (porto.ts). */
export const CONTAINER_COLOR_KEYS: readonly string[] = CONTAINER_COLORS.map((c) => c.key);

/**
 * PORTO DE CONTÊINERES:
 * - `container-<cor>` (cubo 0,5 m, chapa corrugada nas 6 faces): o corpo do contêiner de 6 × 2,5 × 2,5 m (12 × 5 × 5
 *   blocos) ou de 12 m; vermelho, azul-aço, verde-oliva e bege.
 * - `container-<cor>-door`: a ponta com a porta nas faces ±Z da forma canônica (giro 1 para a porta olhar para ±X);
 *   as faces ±X e o topo são a chapa do corpo, então a última fatia do contêiner é toda deste bloco.
 * - `asphalt` (contínuo, 3 variantes) e `asphalt-line` (faixa amarela no topo, asfalto nos lados).
 * - `crane-lattice` (cutout, sólido e andável, deixa passar bala e visão como a grade): mastro, lança e pernas.
 * - `crane-cable` (painel fino cutout, sem colisão): o cabo que desce da lança até o caixote (`crate`).
 * - `hazard-block` (o zebrado amarelo e grafite do `railing` num cubo): borda do cais, batente da eclusa, obra.
 * - A água do cais é a `water` de sempre (laje translúcida, sem colisão), mas NÃO como o mar da Ilha (raso e andável,
 *   água sobre areia): sem natação, o fundo fica a mais de 3 m abaixo do cais (a queda máxima da navegação,
 *   `BOBO_NAV_METRICS.maxDrop`; senão os bots ganham ligação de queda para dentro do mar) e o plano de morte fica
 *   entre a água e o fundo. Montagem segura: `harborWater` em assets-src/maps/kit.ts.
 */
const M10_PORT_BLOCKS: readonly BlockSourceDef[] = [
  ...CONTAINER_COLOR_KEYS.map((c) =>
    def({
      key: `container-${c}`,
      shape: 'cube',
      faces: all(`container_${c}`),
      flags: MODULAR_FLAGS,
      stepSound: 'metal',
    }),
  ),
  ...CONTAINER_COLOR_KEYS.map((c) => {
    const body = `container_${c}`;
    const door = `container_${c}_door`;
    return def({
      key: `container-${c}-door`,
      shape: 'cube',
      faces: [body, body, body, body, door, door],
      flags: MODULAR_FLAGS,
      stepSound: 'metal',
    });
  }),
  def({
    key: 'asphalt',
    shape: 'cube',
    faces: all('asphalt'),
    flags: CONCRETE_FLAGS,
    variants: 3,
    stepSound: 'concrete',
  }),
  def({
    key: 'asphalt-line',
    shape: 'cube',
    faces: sides('asphalt', 'asphalt_line', 'asphalt'),
    flags: MODULAR_FLAGS,
    stepSound: 'concrete',
  }),
  def({
    key: 'crane-lattice',
    shape: 'cube',
    faces: all('crane_lattice'),
    flags: ['solid', 'cutout', 'walkable'],
    stepSound: 'metal',
  }),
  def({ key: 'crane-cable', shape: 'panel', faces: all('crane_cable'), flags: ['cutout'], stepSound: 'metal' }),
  def({ key: 'hazard-block', shape: 'cube', faces: all('railing'), flags: MODULAR_FLAGS, stepSound: 'concrete' }),
];

/**
 * CANTEIRO DE OBRAS:
 * - `scaffold-rail` (poste + travessa, tubo galvanizado): guarda-corpo do andaime com `fence`; empilhado em Y vira o
 *   quadro em escada do andaime tubular. A plataforma é a `grate-slab` (ou a `plank-slab`).
 * - `steel-beam` (viga I deitada, abas em cima e embaixo nas 4 laterais) e `steel-column` (viga de pé): primer zarcão.
 * - `rebar` (cruz cutout, sem colisão): os ferros de espera em cima da coluna ou da laje de concreto por terminar.
 * - `gravel` (contínuo, 3 variantes): o chão de brita.
 * - `barrier-rail` (poste + travessa zebrado laranja e branco) e `barrier-block` (cubo zebrado): barreiras de obra.
 * - `cement-bags` (cubo: sacos sobre o palete nas laterais, sacos no topo): cobertura baixa de 0,5 ou 1 m.
 * - O guindaste da obra é o mesmo `crane-lattice` + `crane-cable` + `crate` do porto.
 */
const M10_CONSTRUCTION_BLOCKS: readonly BlockSourceDef[] = [
  def({ key: 'scaffold-rail', shape: 'postRail', faces: all('scaffold_pipe'), flags: ['solid'], stepSound: 'metal' }),
  def({
    key: 'steel-beam',
    shape: 'cube',
    faces: sides('steel_beam', 'steel_plate'),
    flags: MODULAR_FLAGS,
    stepSound: 'metal',
  }),
  def({
    key: 'steel-column',
    shape: 'cube',
    faces: sides('steel_column', 'steel_plate'),
    flags: MODULAR_FLAGS,
    stepSound: 'metal',
  }),
  def({ key: 'rebar', shape: 'cross', faces: all('rebar'), flags: ['cutout'], stepSound: '' }),
  def({ key: 'gravel', shape: 'cube', faces: all('gravel'), flags: CONCRETE_FLAGS, variants: 3, stepSound: 'dirt' }),
  def({ key: 'barrier-rail', shape: 'postRail', faces: all('barrier_stripe'), flags: ['solid'], stepSound: 'wood' }),
  def({
    key: 'barrier-block',
    shape: 'cube',
    faces: all('barrier_stripe'),
    flags: MODULAR_FLAGS,
    stepSound: 'concrete',
  }),
  def({
    key: 'cement-bags',
    shape: 'cube',
    faces: sides('cement_bags', 'cement_bags_top'),
    flags: MODULAR_FLAGS,
    stepSound: 'canvas',
  }),
];

/**
 * GALPÃO DE PAINTBALL (o colorido vem dos infláveis, props `inflatable-*`):
 * - `turf` (contínuo, 3 variantes): grama sintética do campo; `turf-line`: a linha branca (topo; lados de grama).
 * - `net` (painel fino cutout): a rede em volta do campo; bloqueia o movimento e deixa passar bala e visão, como a
 *   cerca de arame (GDD §4.6.1).
 * - As paredes, o teto e a luz do galpão são os de sempre (`metal-panel`, `metal-roof-ramp`, `cinder-block`,
 *   `light-panel`, `lamp`).
 */
const M10_PAINTBALL_BLOCKS: readonly BlockSourceDef[] = [
  def({ key: 'turf', shape: 'cube', faces: all('turf'), flags: CONCRETE_FLAGS, variants: 3, stepSound: 'grass' }),
  def({
    key: 'turf-line',
    shape: 'cube',
    faces: sides('turf', 'turf_line', 'turf'),
    flags: MODULAR_FLAGS,
    stepSound: 'grass',
  }),
  def({ key: 'net', shape: 'panel', faces: all('net'), flags: ['solid', 'cutout'], stepSound: 'canvas' }),
];

/**
 * ESTAÇÃO LUNAR:
 * - `regolith` (contínuo, 3 variantes; a b com uma craterinha): o chão de fora.
 * - `station-panel` (2 variantes: lisa e com grelha) e `station-floor` (piso escuro no topo, painel nos lados).
 * - `neon-trim` (emissivo 10): a faixa de neon ciano nas laterais (topo e base de painel).
 * - `airlock-door` (porta pesada nas laterais): eclusa fechada; o batente é o `hazard-block`, a janela é o
 *   `glass-pane`.
 */
const M10_MOON_BLOCKS: readonly BlockSourceDef[] = [
  def({
    key: 'regolith',
    shape: 'cube',
    faces: all('regolith'),
    flags: CONCRETE_FLAGS,
    variants: 3,
    stepSound: 'dirt',
  }),
  def({
    key: 'station-panel',
    shape: 'cube',
    faces: all('station_panel'),
    flags: MODULAR_FLAGS,
    variants: 2,
    stepSound: 'metal',
  }),
  def({
    key: 'station-floor',
    shape: 'cube',
    faces: sides('station_panel', 'station_floor', 'station_panel'),
    flags: MODULAR_FLAGS,
    stepSound: 'metal',
  }),
  def({
    key: 'neon-trim',
    shape: 'cube',
    faces: sides('neon_trim', 'station_panel'),
    flags: [...SOLID, 'emissive'],
    emissive: 10,
    stepSound: 'metal',
  }),
  def({
    key: 'airlock-door',
    shape: 'cube',
    faces: sides('airlock_door', 'station_panel'),
    flags: MODULAR_FLAGS,
    stepSound: 'metal',
  }),
];

/**
 * FAZENDA À NOITE:
 * - `barn-wood` (tábuas vermelhas) e `barn-door-a` / `barn-door-b` (a mão-francesa "\" e "/"): em xadrez A/B, cada
 *   2×2 forma o X; as faces cruzam como as do PERIGO para ler certo dos dois lados (A no menor x ou z na fileira de
 *   cima). Montagem: `barnDoor` em assets-src/maps/kit.ts.
 * - `wood-trim` (tábua branca: batentes, cantos e molduras) e `siding` (o lambri creme da casa).
 * - `hay-bale` (fardo: palha nas laterais e no topo).
 * - `farmland` (terra arada no topo, terra nos lados) e `crops` (milharal em cruz cutout, sem balanço para empilhar
 *   2 a 4 blocos de altura). O milharal TAPA A VISÃO (`blocksSight`, nos dois planos da cruz) e deixa passar bala: o
 *   milho alto esconde o bobo em pé do jogador, então esconde dos bots também (a penalidade de detecção da vegetação
 *   do GDD §4.6.1 não existe na IA). Tudo o que consulta `blocksSight` passa a contar o milharal (a visão dos bots, o
 *   minimapa, o som abafado atrás de parede).
 * - `wood-rail-fence` (poste + travessa de tábua): a cerca de pasto (a fechada é a `fence-wood`).
 */
const M10_FARM_BLOCKS: readonly BlockSourceDef[] = [
  def({ key: 'barn-wood', shape: 'cube', faces: all('barn_wood'), flags: MODULAR_FLAGS, stepSound: 'wood' }),
  def({
    key: 'barn-door-a',
    shape: 'cube',
    faces: ['barn_door_b', 'barn_door_a', 'barn_wood', 'barn_wood', 'barn_door_a', 'barn_door_b'],
    flags: MODULAR_FLAGS,
    stepSound: 'wood',
  }),
  def({
    key: 'barn-door-b',
    shape: 'cube',
    faces: ['barn_door_a', 'barn_door_b', 'barn_wood', 'barn_wood', 'barn_door_b', 'barn_door_a'],
    flags: MODULAR_FLAGS,
    stepSound: 'wood',
  }),
  def({ key: 'wood-trim', shape: 'cube', faces: all('wood_trim'), flags: MODULAR_FLAGS, stepSound: 'wood' }),
  def({ key: 'siding', shape: 'cube', faces: all('siding'), flags: MODULAR_FLAGS, stepSound: 'wood' }),
  def({
    key: 'hay-bale',
    shape: 'cube',
    faces: sides('hay_bale', 'hay_bale_top'),
    flags: MODULAR_FLAGS,
    stepSound: 'grass',
  }),
  def({
    key: 'farmland',
    shape: 'cube',
    faces: sides('dirt', 'farmland', 'dirt'),
    flags: MODULAR_FLAGS,
    stepSound: 'dirt',
  }),
  def({
    key: 'crops',
    shape: 'cross',
    faces: all('crops'),
    flags: ['cutout', 'blocksSight', 'colorVariation'],
    variants: 2,
    stepSound: '',
  }),
  def({ key: 'wood-rail-fence', shape: 'postRail', faces: all('wood'), flags: ['solid'], stepSound: 'wood' }),
];

/**
 * Todos os blocos, na ordem do registro de conteúdo. Os da lista `PENDING_BLOCK_IDS` ainda não estão em
 * `CONTENT_IDS` (pedido para a integração registrar).
 */
export const BLOCK_DEFS: readonly BlockSourceDef[] = [
  // Xadrez de fallback (bloco desconhecido no mapa).
  def({ key: 'missing', shape: 'cube', faces: all('missing'), flags: SOLID, stepSound: 'concrete' }),
  def({
    key: 'concrete',
    shape: 'cube',
    faces: all('concrete'),
    flags: CONCRETE_FLAGS,
    variants: 4,
    stepSound: 'concrete',
  }),
  def({ key: 'crate', shape: 'cube', faces: sides('crate', 'crate_top'), flags: MODULAR_FLAGS, stepSound: 'wood' }),
  concreteShape('concrete-slab', 'slab'),
  // Degrau com piso antiderrapante (sem direção: serve em qualquer giro).
  def({
    key: 'concrete-step',
    shape: 'step',
    faces: sides('concrete', 'anti_slip', 'concrete'),
    flags: MODULAR_FLAGS,
    stepSound: 'concrete',
  }),
  concreteShape('concrete-ramp', 'ramp'),
  concreteShape('concrete-ramp-half-low', 'rampHalfLow'),
  concreteShape('concrete-ramp-half-high', 'rampHalfHigh'),
  concreteShape('concrete-ramp-corner-in', 'rampCornerIn'),
  concreteShape('concrete-ramp-corner-out', 'rampCornerOut'),
  // Chão do Construto: placa de teste em cima, concreto nas bordas (mezanino e beirais).
  def({
    key: 'test-floor',
    shape: 'cube',
    faces: sides('concrete', 'test_floor', 'concrete'),
    flags: MODULAR_FLAGS,
    variants: 3,
    stepSound: 'concrete',
  }),
  // Faixa amarela de circulação: uma fileira destes blocos, em X ou em Z.
  def({
    key: 'test-floor-stripe',
    shape: 'cube',
    faces: sides('concrete', 'test_floor_stripe', 'concrete'),
    flags: MODULAR_FLAGS,
    variants: 2,
    stepSound: 'concrete',
  }),
  // Número do setor 1–9 (a cada 4 m no chão): um bloco por setor, porque a variante sorteada pela célula não sabe o
  // setor (arte-8).
  ...SECTOR_NUMBERS.map((n) =>
    def({
      key: `sector-marker-${n}`,
      shape: 'cube',
      faces: sides('concrete', `sector_marker_${n}`, 'concrete'),
      flags: MODULAR_FLAGS,
      stepSound: 'concrete',
    }),
  ),
  def({
    key: 'test-wall',
    shape: 'cube',
    faces: sides('test_wall', 'concrete'),
    flags: MODULAR_FLAGS,
    stepSound: 'concrete',
  }),
  // Painel verde-oliva nas laterais, chapa xadrez em cima (piso de mezanino e de passarela fechada).
  def({ key: 'metal-panel', shape: 'cube', faces: sides('metal', 'checker_plate'), flags: SOLID, stepSound: 'metal' }),
  roofShape('metal-roof-ramp', 'ramp'),
  roofShape('metal-roof-ramp-corner-in', 'rampCornerIn'),
  roofShape('metal-roof-ramp-corner-out', 'rampCornerOut'),
  def({ key: 'brick', shape: 'cube', faces: all('brick'), flags: MODULAR_FLAGS, stepSound: 'concrete' }),
  def({ key: 'plank', shape: 'cube', faces: all('wood'), flags: MODULAR_FLAGS, stepSound: 'wood' }),
  def({ key: 'plank-slab', shape: 'slab', faces: all('wood'), flags: MODULAR_FLAGS, stepSound: 'wood' }),
  def({
    key: 'grass',
    shape: 'cube',
    faces: sides('grass_side', 'grass', 'dirt'),
    flags: MODULAR_FLAGS,
    variants: 3,
    stepSound: 'grass',
  }),
  def({ key: 'dirt', shape: 'cube', faces: all('dirt'), flags: CONCRETE_FLAGS, variants: 3, stepSound: 'dirt' }),
  def({ key: 'log', shape: 'cube', faces: sides('log', 'log_top'), flags: MODULAR_FLAGS, stepSound: 'wood' }),
  // Copa das árvores de bloco: dá para subir, para a visão dos bots e deixa a bala passar pelos furos.
  def({
    key: 'leaves',
    shape: 'cube',
    faces: all('leaves'),
    flags: ['solid', 'cutout', 'walkable', 'blocksSight', 'colorVariation'],
    variants: 2,
    stepSound: 'leaves',
  }),
  def({
    key: 'tall-grass',
    shape: 'cross',
    faces: all('tall_grass'),
    flags: ['cutout', 'swaysInWind', 'colorVariation'],
    variants: 3,
    stepSound: '',
  }),
  def({
    key: 'flowers',
    shape: 'cross',
    faces: all('flowers'),
    flags: ['cutout', 'swaysInWind'],
    variants: 3,
    stepSound: '',
  }),
  def({
    key: 'bush',
    shape: 'cross',
    faces: all('bush'),
    flags: ['cutout', 'swaysInWind', 'colorVariation'],
    variants: 2,
    stepSound: '',
  }),
  def({ key: 'fence-wire', shape: 'panel', faces: all('fence_wire'), flags: ['solid', 'cutout'], stepSound: 'metal' }),
  def({
    key: 'fence-wood',
    shape: 'panel',
    faces: all('fence_wood'),
    flags: ['solid', 'blocksBullets', 'blocksSight'],
    stepSound: 'wood',
  }),
  def({ key: 'railing', shape: 'postRail', faces: all('railing'), flags: ['solid'], stepSound: 'metal' }),
  def({
    key: 'grate-slab',
    shape: 'slab',
    faces: all('grate'),
    flags: ['solid', 'cutout', 'walkable'],
    stepSound: 'metal',
  }),
  def({
    key: 'light-panel',
    shape: 'cube',
    faces: all('light_panel'),
    flags: [...SOLID, 'emissive'],
    emissive: 14,
    stepSound: 'metal',
  }),
  def({
    key: 'lamp',
    shape: 'cube',
    faces: all('lamp'),
    flags: [...SOLID, 'emissive'],
    emissive: 15,
    stepSound: 'metal',
  }),
  // Bancada de materiais (fora da área jogável): vidro e água rasa.
  def({
    key: 'glass',
    shape: 'cube',
    faces: all('glass'),
    flags: ['solid', 'translucent', 'blocksBullets', 'walkable'],
    stepSound: 'glass',
  }),
  def({
    key: 'glass-pane',
    shape: 'panel',
    faces: all('glass'),
    flags: ['solid', 'translucent', 'blocksBullets'],
    stepSound: 'glass',
  }),
  def({
    key: 'water',
    shape: 'slab',
    faces: all('water'),
    flags: ['translucent', 'animated'],
    frames: 4,
    stepSound: 'water',
  }),

  // --- Pedidos de registro (ainda fora de CONTENT_IDS) ---
  def({
    key: 'concrete-stripe',
    shape: 'cube',
    faces: sides('concrete_stripe', 'concrete'),
    flags: MODULAR_FLAGS,
    stepSound: 'concrete',
  }),
  def({ key: 'cinder-block', shape: 'cube', faces: all('cinder_block'), flags: MODULAR_FLAGS, stepSound: 'concrete' }),
  def({ key: 'canvas', shape: 'cube', faces: all('canvas'), flags: MODULAR_FLAGS, stepSound: 'canvas' }),
  def({
    key: 'led-strip',
    shape: 'cube',
    faces: sides('led_strip', 'concrete'),
    flags: [...SOLID, 'emissive'],
    emissive: 11,
    stepSound: 'concrete',
  }),
  def({
    key: 'exit-sign',
    shape: 'cube',
    faces: sides('exit_sign', 'metal'),
    flags: [...SOLID, 'emissive'],
    emissive: 9,
    stepSound: 'metal',
  }),
  // "PERIGO" em dois blocos: A no menor x (ou z), B no maior. As faces cruzam para ler certo dos dois lados.
  def({
    key: 'danger-sign-a',
    shape: 'cube',
    faces: ['danger_sign_b', 'danger_sign_a', 'concrete', 'concrete', 'danger_sign_a', 'danger_sign_b'],
    flags: SOLID,
    stepSound: 'concrete',
  }),
  def({
    key: 'danger-sign-b',
    shape: 'cube',
    faces: ['danger_sign_a', 'danger_sign_b', 'concrete', 'concrete', 'danger_sign_b', 'danger_sign_a'],
    flags: SOLID,
    stepSound: 'concrete',
  }),
  // M7 (fase 5): a areia da praia da Ilha Tropical.
  def({ key: 'sand', shape: 'cube', faces: all('sand'), flags: CONCRETE_FLAGS, variants: 3, stepSound: 'dirt' }),
  // M10 (fase 0): o kit dos 5 mapas novos (catálogo nos comentários de cada grupo, acima).
  ...M10_PORT_BLOCKS,
  ...M10_CONSTRUCTION_BLOCKS,
  ...M10_PAINTBALL_BLOCKS,
  ...M10_MOON_BLOCKS,
  ...M10_FARM_BLOCKS,
];

/** Blocos novos desta frente que a integração precisa registrar em `CONTENT_IDS` (`block:<key>`). */
export const PENDING_BLOCK_IDS: readonly string[] = [
  'concrete-stripe',
  'cinder-block',
  'canvas',
  'led-strip',
  'exit-sign',
  'danger-sign-a',
  'danger-sign-b',
];
