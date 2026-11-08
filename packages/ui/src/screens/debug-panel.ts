import { DRAW_FLOATS_PER_COMMAND, pushShape, type DrawList } from '../draw-list.ts';
import type { MsdfFont, UiFonts } from '../font.ts';
import { paintNumber, paintText } from '../paint.ts';
import { t, templateParts } from '../text.ts';
import { COLORS, UI_REFERENCE, withAlpha } from '../tokens.ts';

/**
 * Painel F2 do M1 (tecnico.md §24.2 itens 10–15; PLANO_M1 "ui + game"): frame CPU/GPU, p50/p99, fases (sim, IA,
 * render, UI), draw calls e triângulos por vista, programas, heap, memória de GPU estimada, bots e zumbis. CONTRATO;
 * desenho da frente "ui-fontes". O `game` preenche (struct mutável, sem alocar) e o painel desenha por cima de tudo.
 * Rótulos pela tabela pt-BR; números sem `Intl`; nomes técnicos (perfil, rota) como literal.
 */
export interface DebugViewLine {
  drawCalls: number;
  triangles: number;
  regions: number;
  propGroups: number;
  actors: number;
}

export const DEBUG_PANEL_MAX_VIEWS = 4;

/** Teto de programas de shader (regra 8): acima disso o número fica vermelho. */
export const DEBUG_MAX_PROGRAMS = 7;

export interface DebugPanelModel {
  visible: boolean;
  fps: number;
  /** Tempo de frame (ms): mediana, p99 e pior da janela de 2 s. */
  frameP50: number;
  frameP99: number;
  frameMax: number;
  /** CPU do frame (ms) e GPU (ms, só com `gpuFinish`; -1 sem medição). */
  cpuMs: number;
  gpuMs: number;
  /** Fases do frame (ms). */
  simMs: number;
  aiMs: number;
  renderMs: number;
  uiMs: number;
  drawCalls: number;
  triangles: number;
  programs: number;
  readonly views: DebugViewLine[];
  viewCount: number;
  /** Memória (MB; -1 = desconhecida). */
  heapMb: number;
  heapLimitMb: number;
  textureMb: number;
  meshMb: number;
  /** Frames acima de 2× o alvo sem trabalho que explique (pausas de GC prováveis) desde o começo da cena. */
  gcPauses: number;
  bots: number;
  zombies: number;
  simHz: number;
  tick: number;
  /** Literais técnicos: perfil (`switch34p`), rota de textura (`array`/`atlas`) e de atributos (`int`/`float`). */
  profile: string;
  textureMode: string;
  vertexAttributes: string;
  // --- acréscimos da frente ui-fontes (compatíveis: o `game` cria o modelo por `createDebugPanelModel`) ---
  /** Distância de visão da partida (m; -1 = desconhecida). */
  viewDistanceM: number;
  /** `gl.finish()` por frame ligado (rodada de medição de GPU, item 10 do T0). */
  gpuFinish: boolean;
}

export function createDebugPanelModel(): DebugPanelModel {
  const views: DebugViewLine[] = [];
  for (let i = 0; i < DEBUG_PANEL_MAX_VIEWS; i++) {
    views.push({ drawCalls: 0, triangles: 0, regions: 0, propGroups: 0, actors: 0 });
  }
  return {
    visible: false,
    fps: 0,
    frameP50: 0,
    frameP99: 0,
    frameMax: 0,
    cpuMs: 0,
    gpuMs: -1,
    simMs: 0,
    aiMs: 0,
    renderMs: 0,
    uiMs: 0,
    drawCalls: 0,
    triangles: 0,
    programs: 0,
    views,
    viewCount: 0,
    heapMb: -1,
    heapLimitMb: -1,
    textureMb: -1,
    meshMb: -1,
    gcPauses: 0,
    bots: 0,
    zombies: 0,
    simHz: 60,
    tick: 0,
    profile: '',
    textureMode: 'array',
    vertexAttributes: 'int',
    viewDistanceM: -1,
    gpuFinish: false,
  };
}

/** Medidas do painel em px de referência (1280×720). Piso de 12 px: é ferramenta, não texto de sofá. */
export const DEBUG_PANEL_METRICS = { textPx: 16, minTextPx: 12, margin: 8, pad: 10, lineFactor: 1.5 } as const;

interface PanelTexts {
  readonly title: string;
  readonly fps: string;
  readonly frame: string;
  readonly p50: string;
  readonly p99: string;
  readonly max: string;
  readonly ms: string;
  readonly cpu: string;
  readonly gpu: string;
  readonly sim: string;
  readonly ai: string;
  readonly render: string;
  readonly ui: string;
  readonly drawCalls: string;
  readonly triangles: string;
  readonly programs: string;
  readonly views: readonly string[];
  readonly draw: string;
  readonly tri: string;
  readonly regions: string;
  readonly props: string;
  readonly actors: string;
  readonly heap: string;
  readonly textures: string;
  readonly meshes: string;
  readonly mb: string;
  readonly gc: string;
  readonly bots: string;
  readonly zombies: string;
  readonly viewDistance: string;
  readonly meters: string;
  readonly hz: string;
  readonly tick: string;
  readonly profile: string;
  readonly textureMode: string;
  readonly vertexAttributes: string;
  readonly gpuFinish: string;
  readonly on: string;
  readonly off: string;
  readonly unknown: string;
  readonly slash: string;
}

let cachedTexts: PanelTexts | null = null;

function panelTexts(): PanelTexts {
  if (cachedTexts) return cachedTexts;
  cachedTexts = {
    title: t('debug.title').toUpperCase(),
    fps: t('debug.fps'),
    frame: t('debug.frame'),
    p50: t('debug.p50'),
    p99: t('debug.p99'),
    max: t('debug.max'),
    ms: t('debug.ms'),
    cpu: t('debug.cpu'),
    gpu: t('debug.gpu'),
    sim: t('debug.sim'),
    ai: t('debug.ai'),
    render: t('debug.render'),
    ui: t('debug.ui'),
    drawCalls: t('debug.drawCalls'),
    triangles: t('debug.triangles'),
    programs: t('debug.programs'),
    views: [1, 2, 3, 4].map((n) => t('debug.view', { n })),
    draw: t('debug.draw'),
    tri: t('debug.tri'),
    regions: t('debug.regions'),
    props: t('debug.props'),
    actors: t('debug.actors'),
    heap: t('debug.heap'),
    textures: t('debug.textures'),
    meshes: t('debug.meshes'),
    mb: t('debug.mb'),
    gc: t('debug.gcPauses'),
    bots: t('debug.bots'),
    zombies: t('debug.zombies'),
    viewDistance: t('debug.viewDistance'),
    meters: t('debug.meters'),
    hz: t('debug.hz'),
    tick: t('debug.tick'),
    profile: t('debug.profile'),
    textureMode: t('debug.textureMode'),
    vertexAttributes: t('debug.vertexAttributes'),
    gpuFinish: t('debug.gpuFinish'),
    on: t('debug.on'),
    off: t('debug.off'),
    unknown: t('debug.unknown'),
    slash: (templateParts('hud.ammo', ['clip', 'reserve'])[1] as string).trim(),
  };
  return cachedTexts;
}

/** Caneta do painel: escreve da esquerda para a direita, linha a linha, e guarda a largura máxima. Sem alocar. */
const pen = {
  out: null as DrawList | null,
  font: null as MsdfFont | null,
  px: 12,
  x0: 0,
  x: 0,
  y: 0,
  line: 18,
  gap: 6,
  maxX: 0,
};

/**
 * Avança a caneta pela largura desenhada + meio vão, sempre em px inteiros: a posição fica pequena e inteira (no V8,
 * número quebrado passado a função vira objeto no heap; no QuickJS do Switch não, mas não custa).
 */
function advance(width: number): void {
  pen.x = (Math.ceil(pen.x + width) + (pen.gap >> 1)) | 0;
}

function penLabel(text: string): void {
  advance(paintText(pen.out as DrawList, pen.font, text, pen.x, pen.y, pen.px, COLORS.textoBaixo));
}

function penLiteral(text: string, color: number = COLORS.texto): void {
  advance(paintText(pen.out as DrawList, pen.font, text, pen.x, pen.y, pen.px, color));
}

/** Número (ou "—" se negativo, quando `unknownBelowZero`). */
function penNumber(value: number, places: number, color: number = COLORS.texto, unknownBelowZero = false): void {
  if (unknownBelowZero && value < 0) {
    penLiteral(panelTexts().unknown, color);
    return;
  }
  advance(paintNumber(pen.out as DrawList, pen.font, value, places, pen.x, pen.y, pen.px, color));
}

/** Fecha um grupo (rótulo + valores) com um vão maior. */
function penGroup(): void {
  pen.x += pen.gap + (pen.gap >> 1);
}

function penNewline(): void {
  if (pen.x > pen.maxX) pen.maxX = pen.x;
  pen.x = pen.x0;
  pen.y += pen.line;
}

/**
 * Desenha o painel no canto superior esquerdo de `width`×`height` (px da superfície). Invisível, não desenha nada.
 * Fundo no nível 3 a 92%, rótulos `textoBaixo`, valores `texto`, título âmbar; programas acima do teto em `perigo`.
 * O fundo é empilhado antes e tem o tamanho corrigido no fim (uma passada só). Sem alocação.
 */
export function drawDebugPanel(
  out: DrawList,
  fonts: UiFonts | null,
  model: Readonly<DebugPanelModel>,
  width: number,
  height: number,
): void {
  if (!model.visible) return;
  const tx = panelTexts();
  const D = DEBUG_PANEL_METRICS;
  const scale = Math.min(width / UI_REFERENCE.width, height / UI_REFERENCE.height);
  const px = Math.max(Math.round(D.textPx * scale), D.minTextPx);
  const margin = Math.max(4, Math.round(D.margin * scale));
  const padding = Math.max(6, Math.round(D.pad * scale));
  pen.out = out;
  pen.font = fonts?.hud ?? null;
  pen.px = px;
  pen.gap = Math.max(4, Math.round(px * 0.45));
  pen.line = Math.round(px * D.lineFactor);
  pen.x0 = margin + padding;
  pen.x = pen.x0;
  pen.y = margin + padding;
  pen.maxX = 0;

  const bgIndex = out.count;
  pushShape(out, margin, margin, 1, 1, withAlpha(COLORS.chapaTopo, 0.92), Math.max(4, Math.round(10 * scale)));

  advance(paintText(out, pen.font, tx.title, pen.x, pen.y, px, COLORS.acao, 0.12));
  penNewline();

  penLabel(tx.fps);
  penNumber(model.fps, 1);
  penGroup();
  penLabel(tx.frame);
  penLabel(tx.p50);
  penNumber(model.frameP50, 2);
  penLabel(tx.p99);
  penNumber(model.frameP99, 2);
  penLabel(tx.max);
  penNumber(model.frameMax, 2);
  penLabel(tx.ms);
  penNewline();

  penLabel(tx.cpu);
  penNumber(model.cpuMs, 2);
  penLabel(tx.ms);
  penGroup();
  penLabel(tx.gpu);
  penNumber(model.gpuMs, 2, COLORS.texto, true);
  penLabel(tx.ms);
  penNewline();

  penLabel(tx.sim);
  penNumber(model.simMs, 2);
  penGroup();
  penLabel(tx.ai);
  penNumber(model.aiMs, 2);
  penGroup();
  penLabel(tx.render);
  penNumber(model.renderMs, 2);
  penGroup();
  penLabel(tx.ui);
  penNumber(model.uiMs, 2);
  penLabel(tx.ms);
  penNewline();

  penLabel(tx.drawCalls);
  penNumber(model.drawCalls, 0);
  penGroup();
  penLabel(tx.triangles);
  penNumber(model.triangles, 0);
  penGroup();
  penLabel(tx.programs);
  penNumber(model.programs, 0, model.programs > DEBUG_MAX_PROGRAMS ? COLORS.perigo : COLORS.texto);
  penNewline();

  const views = Math.max(0, Math.min(DEBUG_PANEL_MAX_VIEWS, Math.trunc(model.viewCount), model.views.length));
  for (let i = 0; i < views; i++) {
    const v = model.views[i] as DebugViewLine;
    penLiteral(tx.views[i] as string, COLORS.acao);
    penLabel(tx.draw);
    penNumber(v.drawCalls, 0);
    penLabel(tx.tri);
    penNumber(v.triangles, 0);
    penLabel(tx.regions);
    penNumber(v.regions, 0);
    penLabel(tx.props);
    penNumber(v.propGroups, 0);
    penLabel(tx.actors);
    penNumber(v.actors, 0);
    penNewline();
  }

  penLabel(tx.heap);
  penNumber(model.heapMb, 1, COLORS.texto, true);
  penLiteral(tx.slash, COLORS.textoBaixo);
  penNumber(model.heapLimitMb, 0, COLORS.texto, true);
  penLabel(tx.mb);
  penGroup();
  penLabel(tx.textures);
  penNumber(model.textureMb, 1, COLORS.texto, true);
  penLabel(tx.mb);
  penGroup();
  penLabel(tx.meshes);
  penNumber(model.meshMb, 1, COLORS.texto, true);
  penLabel(tx.mb);
  penNewline();

  penLabel(tx.gc);
  penNumber(model.gcPauses, 0);
  penGroup();
  penLabel(tx.bots);
  penNumber(model.bots, 0);
  penGroup();
  penLabel(tx.zombies);
  penNumber(model.zombies, 0);
  penGroup();
  penLabel(tx.viewDistance);
  penNumber(model.viewDistanceM, 0, COLORS.texto, true);
  penLabel(tx.meters);
  penNewline();

  penLabel(tx.sim);
  penNumber(model.simHz, 0);
  penLabel(tx.hz);
  penGroup();
  penLabel(tx.tick);
  penNumber(model.tick, 0);
  penNewline();

  penLabel(tx.profile);
  penLiteral(model.profile === '' ? tx.unknown : model.profile);
  penGroup();
  penLabel(tx.textureMode);
  penLiteral(model.textureMode);
  penGroup();
  penLabel(tx.vertexAttributes);
  penLiteral(model.vertexAttributes);
  penGroup();
  penLabel(tx.gpuFinish);
  penLiteral(model.gpuFinish ? tx.on : tx.off, model.gpuFinish ? COLORS.acao : COLORS.texto);
  penNewline();

  // Fundo: agora que o conteúdo foi medido, acerta o tamanho do primeiro comando (o vão final sai da conta).
  if (bgIndex < out.count) {
    const g = bgIndex * DRAW_FLOATS_PER_COMMAND;
    const panelW = Math.round(pen.maxX - (pen.gap >> 1) + padding - margin);
    const panelH = Math.round(pen.y - pen.line + px + padding - margin);
    out.geom[g + 2] = Math.min(panelW, width - margin * 2);
    out.geom[g + 3] = Math.min(panelH, height - margin * 2);
  }
  pen.out = null;
  pen.font = null;
}
