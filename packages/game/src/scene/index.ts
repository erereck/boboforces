// @boboforces/game/scene: a CENA do M1 (o Construto). Fica num subcaminho próprio porque é a parte pesada do jogo
// (mundo, mesher, luz, navegação, IA, atores, VFX): a web baixa só quando o jogador entra nela (`GameDeps.loadScene`
// com `import()` na casca; tecnico.md §16.4, menu ≤ 350 KB) e o Switch empacota junto (esbuild, um arquivo só).
import type { Scene, SceneHost, SceneModule, SceneRequest } from '../scene-api.ts';
import { FIGURE_SKIN_LAYERS } from '@boboforces/format';
import { drawLoadingScreen, loadingStepIndex, type DrawList, type LoadingModel } from '@boboforces/ui';
import type { ViewDesc } from '@boboforces/render/data';
import { createSceneFigures, type SceneFigures } from './figures.ts';
import { createConstrutoLoader, type LoadingTimes } from './load.ts';
import { createConstrutoMatch, profileFor, sceneRecipe, type ConstrutoMatch } from './match.ts';
import { wardrobeMap } from './wardrobe.ts';

export {
  buildMapNav,
  buildMapWorld,
  buildSimMap,
  propColliderFlags,
  type MapWorld,
  type MapWorldInput,
} from './world.ts';
export { createConstrutoLoader, type ConstrutoLoader, type LoadedConstruto, type LoadingTimes } from './load.ts';
export { aiBudgetFor, profileFor, sceneRecipe, type SceneRecipe } from './match.ts';
export {
  createSceneFigures,
  figureSetKey,
  planFigureSkins,
  type FigureSkinPlan,
  type FigureSkinSet,
  type SceneFigures,
  type SceneFiguresInput,
} from './figures.ts';
export { createCameraPose, poseFromCamera, routeDuration, sampleRoute, type CameraPose } from './route.ts';
export { createSamples, type Samples } from './stats.ts';

/**
 * Trabalho de loading por frame (ms). A tela de loading só precisa andar ~10 vezes por segundo; fatia curta custava um
 * frame inteiro (vsync) a cada 24 ms de trabalho: no Eden, 3,4 s dos 8,3 s do loading eram espera de frame.
 */
const LOADING_BUDGET_MS = 90;
const NO_VIEWS: readonly ViewDesc[] = [];

/**
 * Cria a cena do Construto: loading por etapas nos próprios frames (assets → texturas → luz → malha → navegação →
 * figuras → skins → shaders, cronometrado) e depois a partida (`createConstrutoMatch`). Erro no loading vai para o log e a cena
 * volta ao título.
 */
export function createConstrutoScene(host: SceneHost, request: SceneRequest): Scene {
  const { platform, renderer } = host;
  const views = request.kind === 'bench' && request.bench ? request.bench.views : 1;
  const profile = profileFor(platform.features.profileHint, views, request.bench);
  const recipe = sceneRecipe(request, profile);
  // M2 (fase 5c): o mapa da receita (Construto ou Ringue).
  const loader = createConstrutoLoader(host, recipe.recipe.map);
  const loading: LoadingModel = loader.model;
  let phase: 'loading' | 'running' | 'error' = 'loading';
  let post: 'none' | 'figures' | 'skins' | 'shaders' = 'none';
  let match: ConstrutoMatch | null = null;
  let disposed = false;
  let pausedBeforeLoad = false;
  const times: LoadingTimes = loader.times;
  const startedAt = platform.now();
  /** Bonecos da partida (#56): da etapa "figuras" até o fim da partida (a partida é a dona depois de criada). */
  let figures: SceneFigures | null = null;
  host.log(
    `[cena] ${recipe.recipe.map} (${request.kind}) perfil=${profile.id} vistas=${views} textura=${renderer.info.textureMode}` +
      ` atributos=${renderer.info.vertexAttributes}`,
  );
  if (
    request.bench &&
    (request.bench.textureMode !== renderer.info.textureMode ||
      request.bench.vertexAttributes !== renderer.info.vertexAttributes) &&
    renderer.info.threeRevision !== 'nenhum'
  ) {
    host.log(
      `[cena] aviso: rotas pedidas ${request.bench.textureMode}/${request.bench.vertexAttributes} não aplicadas`,
    );
  }

  function drawLoading(list: DrawList, width: number, height: number, minTextPx: number): void {
    drawLoadingScreen(list, host.fonts, loading, width, height, { minTextPx, safeArea: platform.graphics.safeArea });
    renderer.renderViews(NO_VIEWS);
    renderer.drawUi(list);
  }

  /** O time do jogador 1 na receita (o 1º time que leva humanos); −1 no FFA. */
  function humanTeam(): number {
    const r = recipe.recipe;
    if (r.mode === 'warfare.ffa') return -1;
    const t = r.teams.findIndex((team) => team.humans === 'all' || (team.humans ?? 0) > 0);
    return Math.max(0, t);
  }

  /** O carregado com o mapa do Meu Bobo (o mesmo objeto do começo ao fim: os manequins são lidos dele). */
  let wardrobeLoaded: typeof loader.result | null = null;
  function withWardrobe(l: typeof loader.result): typeof loader.result {
    wardrobeLoaded ??= { ...l, doc: wardrobeMap(l.doc) };
    return wardrobeLoaded;
  }

  function step(): void {
    if (post === 'none') {
      if (!loader.step(LOADING_BUDGET_MS)) return;
      if (loader.phase === 'error') {
        phase = 'error';
        const e = loader.error;
        host.log(`[cena] loading falhou: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
        return;
      }
      for (const w of loader.warnings) host.log(`[cena] aviso: ${w}`);
      post = 'figures';
      // A tela de loading não tem a etapa "figuras" (LOADING_STEPS do ui): ela aparece dentro de "skins".
      loading.current = loadingStepIndex('skins');
      return;
    }
    // M2 (fase 6c): o Meu Bobo põe um manequim e uma câmera no Ringue.
    const loaded = request.kind === 'wardrobe' ? withWardrobe(loader.result) : loader.result;
    if (post === 'figures') {
      // Etapa "figuras" (#56): a tabela de jogo UMA vez (a sim e o render recebem o mesmo objeto) e os gabaritos.
      const t0 = platform.now();
      figures = createSceneFigures({
        profile,
        teamCount: recipe.recipe.teams.length,
        mannequins: loaded.doc.markers.mannequins,
        prints: request.bench?.prints ?? false,
        capacity: Math.floor(loaded.models.reservedCount / FIGURE_SKIN_LAYERS),
        // O editor do Meu Bobo pinta o look a cada mudança (também no Switch); o gancho dos prints, só fora dele.
        onDemand: platform.id !== 'switch' || request.kind === 'wardrobe',
        ...(request.kind === 'wardrobe' ? { botLooks: 1 } : {}),
        // M2 (fase 6c): o Meu Bobo veste o jogador 1, no time dele (sem time no FFA).
        ...(recipe.humans > 0 ? { player: { look: host.bobo.current.look, team: humanTeam() } } : {}),
      });
      times.figures = platform.now() - t0;
      loading.progress[loadingStepIndex('skins')] = 0.3;
      post = 'skins';
      return;
    }
    if (post === 'skins') {
      // Etapa "skins": cada conjunto (look, time) pintado pelo `paintFigureSkin` e subido nas camadas reservadas; depois
      // os gabaritos, a tabela e o LOD do perfil vão para o render (antes do aquecimento).
      const t0 = platform.now();
      const f = figures!;
      f.paintSkins((first, rgba, level1) => renderer.writeModelLayer(first, rgba, level1), loaded.models.reservedStart);
      renderer.setFigures(f.templates, f.table);
      renderer.setFigureLod(profile.figureNearM, profile.figureHalfRate);
      times.skins = platform.now() - t0;
      loading.progress[loadingStepIndex('skins')] = 1;
      loading.ms[loadingStepIndex('skins')] = times.skins + times.figures;
      if (f.plan.overflow.length > 0) {
        host.log(`[cena] aviso: ${f.plan.overflow.length} conjuntos de skin além da reserva vestem o padrão do time`);
      }
      post = 'shaders';
      loading.current = loadingStepIndex('shaders');
      return;
    }
    // Shaders: ambiente da cena e aquecimento (os 7 programas e 1 frame fora da tela), depois de texturas, modelos e
    // mapa; o Switch não compila em paralelo, então isto acontece aqui e não no primeiro frame da partida.
    const t0 = platform.now();
    renderer.warmup();
    times.shaders = platform.now() - t0;
    loading.progress[loadingStepIndex('shaders')] = 1;
    loading.ms[loadingStepIndex('shaders')] = times.shaders;
    times.total = platform.now() - startedAt;
    const ad = loader.assetsDetail;
    host.log(
      `[cena] loading ${Math.round(times.total)} ms: assets ${Math.round(times.assets)} (chegada ` +
        `${Math.round(ad.readMs)}, decodificação ${Math.round(ad.decodeMs)}, ${ad.files} arquivos em ${ad.frames} ` +
        `frames), texturas ` +
        `${Math.round(times.textures)}, luz ${Math.round(times.light)}, malha ${Math.round(times.mesh)}, nav ` +
        `${Math.round(times.nav)}, figuras ${Math.round(times.figures)}, skins ${Math.round(times.skins)}, shaders ` +
        `${Math.round(times.shaders)} · ${loaded.renderMap.regions.length} regiões, ${loaded.nav.nodeCount} nós de ` +
        `navegação, ${figures!.plan.sets.length} skins de boneco, ${figures!.templates.count} gabaritos`,
    );
    const mem = platform.diagnostics.memoryUsage?.() ?? null;
    if (mem) host.log(`[cena] heap depois do loading: ${Math.round(mem.usedHeapBytes / 1e5) / 10} MB`);
    match = createConstrutoMatch({
      host,
      request,
      loaded,
      figures: figures!,
      recipe,
      profile,
      times: { ...times },
      warnings: loader.warnings,
    });
    if (pausedBeforeLoad) match.pause();
    phase = 'running';
  }
  return {
    get phase() {
      return phase;
    },
    get paused(): boolean {
      return match?.paused ?? false;
    },
    get wantsPointerLock(): boolean {
      return match?.wantsPointerLock ?? false;
    },
    get driver() {
      return match?.driver ?? null;
    },
    get debug() {
      return match?.debug ?? null;
    },
    get level() {
      return match?.level ?? request.level ?? 'normal';
    },
    trainingReport() {
      return match?.trainingReport() ?? null;
    },
    nemesisBot() {
      return match?.nemesisBot() ?? null;
    },
    pause(): void {
      if (match) match.pause();
      else pausedBeforeLoad = true;
    },
    frame(dt, raw, menu, ui, list, frameMs) {
      if (disposed) return 'none';
      if (phase === 'loading') {
        try {
          step();
        } catch (error) {
          phase = 'error';
          host.log(`[cena] loading falhou: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
        }
        if (phase === 'loading') {
          drawLoading(list, ui.width, ui.height, ui.options.minTextPx ?? 0);
          return 'none';
        }
      }
      if (phase === 'error' || !match) return 'quit';
      return match.frame(dt, raw, menu, ui, list, frameMs);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      // A partida solta os bonecos dela; sem partida (saiu no meio do loading), solta aqui.
      if (match) match.dispose();
      else figures?.dispose();
      match = null;
      figures = null;
      // Troca de cena: bonecos, mapa, modelos e texturas saem da GPU (regra 21); a próxima cena carrega de novo.
      renderer.setFigures(null, null);
      renderer.setMap(null);
      renderer.setModels(null);
      renderer.setTextures(null);
    },
  };
}

export const SCENE_MODULE: SceneModule = { createScene: createConstrutoScene };
