import {
  isPlayableProp,
  MODEL_FLAG,
  propCollidersToWorld,
  type MapDocument,
  type MapProp,
  type ModelDocument,
} from '@boboforces/format';
import { buildNavGrid, type NavGrid } from '@boboforces/nav';
import { BOBO_NAV_METRICS, simMapFromMarkers, type SimMap } from '@boboforces/sim';
import {
  COLLIDER_FLAG,
  COLLIDER_STRIDE,
  createMapBlockRegistry,
  createStaticColliders,
  gridFromMapGrid,
  resolveBlockDefs,
  type BlockDefInput,
  type BlockRegistry,
  type BlockSourceDef,
  type StaticColliders,
  type WorldGrid,
} from '@boboforces/world';

/**
 * O mundo de um `.bfmap` SEM render (integração do M1): grade, registro de blocos, colisores das props do jogo
 * (`isPlayableProp`: dose ≤ `PLAYABLE_PROP_DOSE`, o dobro da #52) e a navegação. O MESMO caminho do loading do jogo,
 * do golden e do `mapc` (`tools/mapc/src/compile.ts`): as caixas das props saem do `propCollidersToWorld` do format e a
 * navegação vê só as props com `blocksNav`. Puro e determinístico (o golden roda isto no Node).
 */
export interface MapWorldInput {
  readonly map: MapDocument;
  /** `blocks/blocks.json` já lido (`parseBlockDefs`). */
  readonly blockDefs: readonly BlockSourceDef[];
  /** Camada do `blocos16` pelo NOME (manifesto montado); `undefined` = não existe (cai na 0 e vai para `missing`). */
  readonly blockLayer: (name: string) => number | undefined;
  /** Modelos do `.bfmodel`, na ordem do pacote (o índice é o do `Renderer.setModels`). */
  readonly models: readonly ModelDocument[];
}

export interface MapWorld {
  readonly map: MapDocument;
  readonly grid: WorldGrid;
  readonly registry: BlockRegistry;
  /** Todas as caixas das props do jogo (colisão, bala, visão dos bots). `owner` = índice da prop no mapa. */
  readonly colliders: StaticColliders;
  /** Só as das props com `blocksNav` (a navegação). */
  readonly navColliders: StaticColliders;
  /** ID do modelo → índice em `models`. */
  readonly modelIndex: ReadonlyMap<string, number>;
  /** Avisos de conteúdo (fallback): blocos sem definição, camadas sem textura, modelos sem pacote. */
  readonly missingBlocks: readonly string[];
  readonly missingLayers: readonly string[];
  readonly missingModels: readonly string[];
}

/** Bits de colisão de uma prop pelas flags do modelo (os mesmos do `mapc`). */
export function propColliderFlags(model: ModelDocument): number {
  return (
    COLLIDER_FLAG.solid |
    ((model.flags & MODEL_FLAG.blocksBullets) !== 0 ? COLLIDER_FLAG.blocksBullets : 0) |
    ((model.flags & MODEL_FLAG.blocksSight) !== 0 ? COLLIDER_FLAG.blocksSight : 0) |
    ((model.flags & MODEL_FLAG.walkable) !== 0 ? COLLIDER_FLAG.walkable : 0)
  );
}

interface ColliderLists {
  boxes: number[];
  flags: number[];
  owner: number[];
}

function toColliders(list: ColliderLists): StaticColliders {
  const count = list.flags.length;
  return createStaticColliders({
    boxes: Float32Array.from(list.boxes),
    flags: Uint8Array.from(list.flags),
    owner: Int32Array.from(list.owner),
    count,
  });
}

/** Monta grade, registro e colisores (no loading; aloca). */
export function buildMapWorld(input: MapWorldInput): MapWorld {
  const { map, models } = input;
  const missingLayers: string[] = [];
  const resolved = resolveBlockDefs(input.blockDefs, input.blockLayer, missingLayers);
  const defs = new Map<string, BlockDefInput>();
  for (const def of resolved) defs.set(def.key, def);
  const missingBlocks: string[] = [];
  const registry = createMapBlockRegistry(map.blocks, defs, missingBlocks);
  const grid = gridFromMapGrid(map.grid);

  const modelIndex = new Map<string, number>();
  models.forEach((m, i) => modelIndex.set(m.id, i));
  const all: ColliderLists = { boxes: [], flags: [], owner: [] };
  const nav: ColliderLists = { boxes: [], flags: [], owner: [] };
  const missingModels = new Set<string>();
  const scratch = new Float64Array(COLLIDER_STRIDE * 16);
  map.props.forEach((prop: MapProp, index) => {
    const mi = modelIndex.get(prop.model);
    if (mi === undefined) {
      missingModels.add(prop.model);
      return;
    }
    // Só as props do jogo (decisão #52: o dobro) colidem e entram na navegação; o mesmo filtro do `mapc`. A chave
    // `propDose` do render é só visual e nunca muda isto.
    if (!isPlayableProp(prop)) return;
    const model = models[mi]!;
    if (model.colliders.length === 0) return;
    const out = model.colliders.length <= 16 ? scratch : new Float64Array(model.colliders.length * COLLIDER_STRIDE);
    const count = propCollidersToWorld(prop, model.colliders, out);
    const flags = propColliderFlags(model);
    for (let b = 0; b < count; b++) {
      for (let k = 0; k < COLLIDER_STRIDE; k++) all.boxes.push(out[b * COLLIDER_STRIDE + k]!);
      all.flags.push(flags);
      all.owner.push(index);
      if (model.blocksNav) {
        for (let k = 0; k < COLLIDER_STRIDE; k++) nav.boxes.push(out[b * COLLIDER_STRIDE + k]!);
        nav.flags.push(flags);
        nav.owner.push(index);
      }
    }
  });
  return {
    map,
    grid,
    registry,
    colliders: toColliders(all),
    navColliders: toColliders(nav),
    modelIndex,
    missingBlocks,
    missingLayers: [...new Set(missingLayers)],
    missingModels: [...missingModels],
  };
}

/** Navegação 2,5D do mapa (no loading; ~40–90 ms no PC para o Construto). */
export function buildMapNav(world: MapWorld): NavGrid {
  return buildNavGrid({ grid: world.grid, blocks: world.registry, colliders: world.navColliders }, BOBO_NAV_METRICS);
}

/** `SimMap` da partida: spawns e área jogável dos marcadores, colisores e navegação. */
export function buildSimMap(world: MapWorld, nav: NavGrid | null): SimMap {
  return simMapFromMarkers({
    grid: world.grid,
    blocks: world.registry,
    markers: world.map.markers,
    colliders: world.colliders,
    nav,
  });
}
