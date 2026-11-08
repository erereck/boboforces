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
 *   bloqueia tudo; vegetação em cruz não bloqueia nada (o "atrapalha a detecção" é da IA); grade de passarela é chão
 *   que deixa passar bala e visão.
 * - `stepSound`: id do som de passo (o áudio de verdade é do M2; ids em `STEP_SOUNDS`). Vazio = não dá para pisar.
 */
import type { BlockFlagName, BlockShape, BlockSourceDef } from '@boboforces/world';

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
