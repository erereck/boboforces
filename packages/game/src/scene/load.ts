import {
  decodeMap,
  decodeModelPack,
  decodePng,
  parseLayerManifest,
  SKIN_LAYER_RESERVE,
  type MapDocument,
  type ModelDocument,
  type TextureArrayName,
} from '@boboforces/format';
import type { NavGrid } from '@boboforces/nav';
import {
  assembleTextureArray,
  type AssembledTextureArray,
  type RenderMap,
  type RenderProp,
  type RenderRegion,
  type TextureStrip,
} from '@boboforces/render/data';
import type { SimMap } from '@boboforces/sim';
import {
  buildLightGrid,
  buildRegionMesh,
  createLightJob,
  parseBlockDefs,
  regionCounts,
  type BlockSourceDef,
  type LightField,
  type LightGrid,
  type LightJob,
} from '@boboforces/world';
import { createLoadingModel, loadingStepIndex, type LoadingModel, type LoadingStep } from '@boboforces/ui';
import { GAME_ASSETS_M1, TEXTURE_ARRAY_BASES, textureStripPaths } from '../assets-m1.ts';
import type { SceneHost } from '../scene-api.ts';
import { buildMapNav, buildMapWorld, buildSimMap, type MapWorld } from './world.ts';

/**
 * Loading do Construto por etapas (integração do M1; tecnico.md §6.2 e §24.3: ≤ 4 s no Switch), DENTRO dos frames:
 * cada frame roda uma fatia de no máximo `budgetMs` e a tela de loading (`drawLoadingScreen`) mostra o progresso.
 * Ordem: assets (platform.assets, em paralelo; PNG e binários decodificados aqui) → texturas (`assembleTextureArray`
 * nos 2 arrays, na ordem do `runtime-assets.json`; `setTextures` e `setModels`) → luz (grade, registro, colisores das
 * props do jogo (`isPlayableProp`), `createLightJob` fatiado) → malha (`buildRegionMesh` região por região, cada uma
 * com buffers PRÓPRIOS: o render guarda as malhas depois do `setMap`, então nada de `reuse`; o mesher não é
 * reentrante, uma região por vez) → navegação (`buildNavGrid` só com as props `blocksNav`; `simMapFromMarkers`) → figuras
 * e skins do boneco (#56, no `scene/index.ts`) → shaders (`warmup` depois de texturas, modelos e mapa). Cada etapa é
 * cronometrada (relatório do bench, item 13 do T0).
 */

/** Tudo o que o loading produz (a partida e o render usam). */
export interface LoadedConstruto {
  readonly doc: MapDocument;
  readonly world: MapWorld;
  readonly nav: NavGrid;
  readonly simMap: SimMap;
  readonly light: LightField;
  readonly lightGrid: LightGrid;
  readonly renderMap: RenderMap;
  readonly blocks: AssembledTextureArray;
  readonly models: AssembledTextureArray;
  readonly modelDocs: readonly ModelDocument[];
  /** Prop do `.bfmap` → índice em `renderMap.props` (-1 = modelo ausente). */
  readonly propRenderIndex: Int32Array;
}

/** Tempo por etapa (ms), no formato do relatório do bench. */
export interface LoadingTimes {
  total: number;
  assets: number;
  textures: number;
  mesh: number;
  light: number;
  nav: number;
  skins: number;
  /** #56: tabela de jogo do boneco (uma vez) + gabaritos dos looks da cena (a etapa "figuras", antes das skins). */
  figures: number;
  shaders: number;
}

interface RawFiles {
  blocksJson: string;
  map: Uint8Array;
  models: Uint8Array;
  strips: Record<TextureArrayName, { png: Uint8Array; mips: Uint8Array; json: string }[]>;
}

type Phase = 'assets' | 'textures' | 'light' | 'mesh' | 'nav' | 'done' | 'error';

/**
 * Detalhe da etapa de assets para o log do Teste Zero. No Eden (03/11): ~1,2 s = chegada dos arquivos ~0,55 s com só
 * 2 frames no meio (ler os do RomFS — hoje 12, sem as skins do bobo de caixas — leva < 10 ms; o resto é um frame longo
 * fora do código do jogo) + decodificação ~0,65 s. O console diz se é igual.
 */
export interface AssetsDetail {
  /** Do início do loading até o último arquivo chegar (ms; -1 = ainda não chegou). */
  readonly readMs: number;
  /** PNG, mapa, modelos e JSON (ms). */
  readonly decodeMs: number;
  /** Frames da etapa (chamadas de `step` até decodificar). */
  readonly frames: number;
  readonly files: number;
}

export interface ConstrutoLoader {
  readonly model: LoadingModel;
  readonly times: LoadingTimes;
  readonly assetsDetail: AssetsDetail;
  readonly phase: Phase;
  readonly error: unknown;
  /** Avisos de conteúdo (fallback) para o log e o relatório. */
  readonly warnings: readonly string[];
  /** Roda até `budgetMs` de trabalho. `true` quando terminou (com `result` pronto ou com erro). */
  step(budgetMs: number): boolean;
  /** Pronto quando `phase === 'done'` (antes, lança). */
  readonly result: LoadedConstruto;
}

/** Fatia do job de luz (células visitadas por chamada; o laço segue até o orçamento de tempo do frame). */
const LIGHT_SLICE = 40_000;

export function createConstrutoLoader(host: SceneHost): ConstrutoLoader {
  const { platform, renderer } = host;
  const now = (): number => platform.now();
  const model = createLoadingModel();
  model.mapName = 'Construto';
  const times: LoadingTimes = {
    total: 0,
    assets: 0,
    textures: 0,
    mesh: 0,
    light: 0,
    nav: 0,
    skins: 0,
    figures: 0,
    shaders: 0,
  };
  const warnings: string[] = [];
  const startedAt = now();
  let phase: Phase = 'assets';
  let error: unknown = null;
  let files: RawFiles | null = null;
  let filesDone = 0;
  let filesTotal = 0;
  let readMs = -1;
  let decodeMs = 0;
  let assetFrames = 0;

  // --- estado entre etapas ---
  let doc: MapDocument | null = null;
  let modelDocs: readonly ModelDocument[] = [];
  let blockDefs: readonly BlockSourceDef[] = [];
  let blocksArray: AssembledTextureArray | null = null;
  let modelsArray: AssembledTextureArray | null = null;
  let stripsDecoded: Record<TextureArrayName, TextureStrip[]> | null = null;
  let world: MapWorld | null = null;
  let lightJob: LightJob | null = null;
  let light: LightField | null = null;
  let lightGrid: LightGrid | null = null;
  const regions: RenderRegion[] = [];
  let regionCursor = 0;
  let regionTotal = 0;
  let regionDims = { x: 0, y: 0, z: 0 };
  let renderMap: RenderMap | null = null;
  let propRenderIndex = new Int32Array(0);
  let result: LoadedConstruto | null = null;

  const mark = (step: LoadingStep, progress: number): void => {
    const i = loadingStepIndex(step);
    model.current = i;
    model.progress[i] = Math.max(0, Math.min(1, progress));
  };
  const finished = (): boolean => phase === 'done' || phase === 'error';
  const finish = (step: LoadingStep, ms: number): void => {
    const i = loadingStepIndex(step);
    model.progress[i] = 1;
    model.ms[i] = ms;
  };

  // Assets em paralelo pela platform.assets (regra 3: só caminho lógico).
  const track = <T>(p: Promise<T>): Promise<T> => {
    filesTotal++;
    return p.then((v) => {
      filesDone++;
      return v;
    });
  };
  const a = platform.assets;
  const stripLoads = (name: TextureArrayName) =>
    Promise.all(
      TEXTURE_ARRAY_BASES[name].map((base) => {
        const p = textureStripPaths(base);
        return Promise.all([track(a.loadBytes(p.png)), track(a.loadBytes(p.mips)), track(a.loadText(p.json))]).then(
          ([png, mips, json]) => ({ png, mips, json }),
        );
      }),
    );
  Promise.all([
    track(a.loadText(GAME_ASSETS_M1.blocks)),
    track(a.loadBytes(GAME_ASSETS_M1.construto)),
    track(a.loadBytes(GAME_ASSETS_M1.models)),
    stripLoads('blocos16'),
    stripLoads('modelos64'),
  ]).then(
    ([blocksJson, map, models, blocos16, modelos64]) => {
      readMs = now() - startedAt;
      files = { blocksJson, map, models, strips: { blocos16, modelos64 } };
    },
    (e: unknown) => {
      if (phase === 'assets') {
        error = e;
        phase = 'error';
      }
    },
  );

  function decodeAssets(f: RawFiles): void {
    blockDefs = parseBlockDefs(JSON.parse(f.blocksJson) as unknown);
    doc = decodeMap(f.map);
    modelDocs = decodeModelPack(f.models).models;
    const decodeStrips = (name: TextureArrayName): TextureStrip[] =>
      f.strips[name].map((s) => {
        const manifest = parseLayerManifest(JSON.parse(s.json) as unknown);
        return { manifest, level0: decodePng(s.png), mips: manifest.mipLevels > 1 ? decodePng(s.mips) : null };
      });
    stripsDecoded = { blocos16: decodeStrips('blocos16'), modelos64: decodeStrips('modelos64') };
  }

  function stepTextures(): void {
    const t0 = now();
    mark('textures', 0);
    const strips = stripsDecoded!;
    blocksArray = assembleTextureArray('blocos16', strips.blocos16, 0);
    modelsArray = assembleTextureArray('modelos64', strips.modelos64, SKIN_LAYER_RESERVE);
    stripsDecoded = null;
    renderer.setTextures({ blocks: blocksArray, models: modelsArray });
    renderer.setModels(modelDocs);
    times.textures = now() - t0;
    finish('textures', times.textures);
    phase = 'light';
  }

  function startLight(): void {
    const layers = blocksArray!.layers;
    world = buildMapWorld({
      map: doc!,
      blockDefs,
      blockLayer: (name) => layers.get(name),
      models: modelDocs,
    });
    for (const k of world.missingBlocks) warnings.push(`bloco sem definição: ${k}`);
    for (const k of world.missingLayers) warnings.push(`camada sem textura: ${k}`);
    for (const k of world.missingModels) warnings.push(`modelo ausente no pacote: ${k}`);
    const [sx, sy, sz] = doc!.light.sunDir;
    lightJob = createLightJob(world.grid, world.registry, {
      sunDirX: sx,
      sunDirY: sy,
      sunDirZ: sz,
      emitters: doc!.light.emitters,
    });
  }

  function stepLight(deadline: number): void {
    const t0 = now();
    if (lightJob === null) startLight();
    const job = lightJob!;
    while (!job.done && now() < deadline) job.step(LIGHT_SLICE);
    mark('light', job.progress);
    times.light += now() - t0;
    if (!job.done) return;
    light = job.result;
    lightGrid = buildLightGrid(light);
    lightJob = null;
    finish('light', times.light);
    regionDims = regionCounts(world!.grid);
    regionTotal = regionDims.x * regionDims.y * regionDims.z;
    regionCursor = 0;
    phase = 'mesh';
  }

  function buildRenderMap(): RenderMap {
    const w = world!;
    const registry = w.registry;
    const faceLayers = new Uint8Array(registry.size * 6);
    for (let id = 0; id < registry.size; id++) {
      const faces = registry.get(id).faces;
      for (let f = 0; f < 6; f++) faceLayers[id * 6 + f] = faces[f]! & 0xff;
    }
    const props: RenderProp[] = [];
    propRenderIndex = new Int32Array(doc!.props.length).fill(-1);
    doc!.props.forEach((p, i) => {
      const mi = w.modelIndex.get(p.model);
      if (mi === undefined) return;
      propRenderIndex[i] = props.length;
      props.push({
        model: mi,
        x: p.x / 32,
        y: p.y / 32,
        z: p.z / 32,
        yaw: (p.yaw / 256) * Math.PI * 2,
        scale: p.scale / 16,
        dose: p.dose,
      });
    });
    return {
      sizeX: w.grid.sizeX,
      sizeY: w.grid.sizeY,
      sizeZ: w.grid.sizeZ,
      regions,
      lightGrid: lightGrid!,
      grid: w.grid,
      blocks: registry,
      props,
      blockFaceLayers: faceLayers,
    };
  }

  function stepMesh(deadline: number): void {
    const t0 = now();
    const w = world!;
    const { x: rxN, z: rzN } = regionDims;
    while (regionCursor < regionTotal && now() < deadline) {
      const i = regionCursor++;
      const rx = i % rxN;
      const rz = Math.floor(i / rxN) % rzN;
      const ry = Math.floor(i / (rxN * rzN));
      // Buffers próprios por região (sem `reuse`): o render guarda as malhas até o próximo `setMap`.
      const mesh = buildRegionMesh(w.grid, w.registry, light, rx, ry, rz);
      if (mesh.opaque.indexCount + mesh.cutout.indexCount + mesh.translucent.indexCount > 0) regions.push({ mesh });
    }
    mark('mesh', regionTotal > 0 ? regionCursor / regionTotal : 1);
    if (regionCursor < regionTotal) {
      times.mesh += now() - t0;
      return;
    }
    renderMap = buildRenderMap();
    renderer.setMap(renderMap);
    times.mesh += now() - t0;
    finish('mesh', times.mesh);
    phase = 'nav';
  }

  function stepNav(): void {
    const t0 = now();
    mark('nav', 0);
    const nav = buildMapNav(world!);
    const simMap = buildSimMap(world!, nav);
    times.nav = now() - t0;
    finish('nav', times.nav);
    result = {
      doc: doc!,
      world: world!,
      nav,
      simMap,
      light: light!,
      lightGrid: lightGrid!,
      renderMap: renderMap!,
      blocks: blocksArray!,
      models: modelsArray!,
      modelDocs,
      propRenderIndex,
    };
    phase = 'done';
  }

  return {
    model,
    times,
    get assetsDetail(): AssetsDetail {
      return { readMs, decodeMs, frames: assetFrames, files: filesTotal };
    },
    get phase() {
      return phase;
    },
    get error() {
      return error;
    },
    warnings,
    step(budgetMs: number): boolean {
      if (phase === 'done' || phase === 'error') return true;
      const deadline = now() + budgetMs;
      try {
        if (phase === 'assets') {
          assetFrames++;
          mark('assets', filesTotal > 0 ? filesDone / filesTotal : 0);
          if (files === null) return false;
          const d0 = now();
          decodeAssets(files);
          decodeMs = now() - d0;
          files = null;
          times.assets = now() - startedAt;
          finish('assets', times.assets);
          phase = 'textures';
          return false;
        }
        if (phase === 'textures') stepTextures();
        if (phase === 'light' && now() < deadline) stepLight(deadline);
        if (phase === 'mesh' && now() < deadline) stepMesh(deadline);
        if (phase === 'nav' && now() < deadline) stepNav();
      } catch (e) {
        error = e;
        phase = 'error';
      }
      times.total = now() - startedAt;
      return finished();
    },
    get result(): LoadedConstruto {
      if (!result) throw new Error('loading: o Construto ainda não carregou');
      return result;
    },
  };
}
