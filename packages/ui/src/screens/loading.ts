import { pushRect, type DrawList } from '../draw-list.ts';
import type { MsdfFont, UiFonts } from '../font.ts';
import { capHeightPx, fitTextPx, numberWidth, paintBar, paintNumber, paintText, textWidth } from '../paint.ts';
import type { StringKey } from '../strings.pt-BR.ts';
import { t, templateParts } from '../text.ts';
import { COLORS, MIN_TEXT, SCREEN_MARGIN, TYPE, uiScale } from '../tokens.ts';
import type { Insets } from '../tree.ts';

/**
 * Tela de LOADING do M1 (PLANO_M1 "loading cronometrado"; tecnico.md §15.4 e §24.2 item 13): o nome do mapa, a barra
 * total e uma barra por etapa (arquivos, texturas, luz, malha, navegação, skins, shaders: a ordem em que o loader do
 * `game` roda, a luz antes da malha), com o tempo de cada etapa já concluída — o mesmo cronômetro que vai para a linha
 * `loading_ms` do bench. Struct mutável: o `game` escreve o progresso entre as fatias do loading (sem alocar) e
 * desenha 1 frame por fatia.
 */
export const LOADING_STEPS = ['assets', 'textures', 'light', 'mesh', 'nav', 'skins', 'shaders'] as const;
export type LoadingStep = (typeof LOADING_STEPS)[number];

const STEP_KEYS: Readonly<Record<LoadingStep, StringKey>> = {
  assets: 'loading.step.assets',
  textures: 'loading.step.textures',
  mesh: 'loading.step.mesh',
  light: 'loading.step.light',
  nav: 'loading.step.nav',
  skins: 'loading.step.skins',
  shaders: 'loading.step.shaders',
};

/**
 * Peso inicial de cada etapa na barra total (ms estimados para o Switch, tecnico.md §24.1). O `game` pode trocar pelos
 * tempos medidos no último loading, para a barra andar no ritmo real.
 */
export const LOADING_DEFAULT_WEIGHTS: Readonly<Record<LoadingStep, number>> = {
  assets: 410,
  textures: 300,
  mesh: 1290,
  light: 820,
  nav: 150,
  skins: 90,
  shaders: 360,
};

export interface LoadingModel {
  /** Nome do mapa (literal do `map@1`, ex.: "Construto"); vazio = só "Carregando". */
  mapName: string;
  /** Progresso 0..1 de cada etapa, na ordem de `LOADING_STEPS`. */
  readonly progress: Float32Array;
  /** Peso de cada etapa na barra total. */
  readonly weights: Float32Array;
  /** Tempo de cada etapa concluída (ms; < 0 = ainda não terminou). */
  readonly ms: Float32Array;
  /** Etapa em andamento (índice em `LOADING_STEPS`; -1 = nenhuma). */
  current: number;
  /** Dica de uma linha no rodapé (arte-ux.md §6.9); `null` = sem dica. */
  tipKey: StringKey | null;
}

export function createLoadingModel(): LoadingModel {
  const n = LOADING_STEPS.length;
  const weights = new Float32Array(n);
  for (let i = 0; i < n; i++) weights[i] = LOADING_DEFAULT_WEIGHTS[LOADING_STEPS[i] as LoadingStep];
  return {
    mapName: '',
    progress: new Float32Array(n),
    weights,
    ms: new Float32Array(n).fill(-1),
    current: -1,
    tipKey: 'loading.tip.coward',
  };
}

/** Índice da etapa em `LOADING_STEPS`. */
export function loadingStepIndex(step: LoadingStep): number {
  return LOADING_STEPS.indexOf(step);
}

/** Fração total 0..1 (média dos progressos ponderada pelos pesos). */
export function loadingFraction(model: Readonly<LoadingModel>): number {
  let total = 0;
  let done = 0;
  for (let i = 0; i < model.weights.length; i++) {
    const w = Math.max(0, model.weights[i] as number);
    total += w;
    done += w * Math.min(1, Math.max(0, model.progress[i] as number));
  }
  return total > 0 ? done / total : 0;
}

export interface LoadingScreenOptions {
  /** Piso do texto em px reais (`MIN_TEXT`; padrão: o do celular). */
  readonly minTextPx?: number;
  readonly safeArea?: Insets;
}

/** Medidas em px de referência (1280×720). */
export const LOADING_METRICS = { barWidth: 520, barHeight: 10, stepBarWidth: 220, stepBarHeight: 4, gap: 16 } as const;

interface LoadingTexts {
  readonly title: string;
  readonly steps: readonly string[];
  readonly waiting: string;
  readonly percent: readonly string[];
  readonly ms: readonly string[];
}

let cachedTexts: LoadingTexts | null = null;

function loadingTexts(): LoadingTexts {
  if (cachedTexts) return cachedTexts;
  cachedTexts = {
    title: t('loading.title').toUpperCase(),
    steps: LOADING_STEPS.map((s) => t(STEP_KEYS[s])),
    waiting: t('loading.waiting'),
    percent: templateParts('loading.percent', ['value']),
    ms: templateParts('loading.ms', ['value']),
  };
  return cachedTexts;
}

const mapCache = { source: '', text: '' };

/**
 * Desenha a tela de loading em `width`×`height`, composta à esquerda como os menus (a direita fica para o fundo):
 * rótulo CARREGANDO, nome do mapa, barra total âmbar com a porcentagem e a lista das etapas (concluída: tempo em ms;
 * em andamento: barra; na fila: "Na fila"). Dica no rodapé. Sem alocação (o nome do mapa só vira caixa alta quando
 * muda).
 */
export function drawLoadingScreen(
  out: DrawList,
  fonts: UiFonts | null,
  model: Readonly<LoadingModel>,
  width: number,
  height: number,
  options: LoadingScreenOptions = {},
): void {
  const tx = loadingTexts();
  const L = LOADING_METRICS;
  const s = uiScale(width, height);
  const floor = options.minTextPx ?? MIN_TEXT.phone;
  const safe = options.safeArea;
  const display: MsdfFont | null = fonts?.display ?? null;
  const hud: MsdfFont | null = fonts?.hud ?? null;
  const left = Math.round(Math.max(SCREEN_MARGIN.x * s, safe?.left ?? 0));
  const right = Math.round(width - Math.max(SCREEN_MARGIN.x * s, safe?.right ?? 0));
  const top = Math.round(Math.max(SCREEN_MARGIN.y * s, safe?.top ?? 0));
  const bottom = Math.round(height - Math.max(SCREEN_MARGIN.y * s, safe?.bottom ?? 0));
  const gap = Math.max(4, Math.round(L.gap * s));
  const labelPx = Math.max(TYPE.label.size * s, floor);
  const titlePx = Math.max(TYPE.title.size * s, floor);
  const bodyPx = Math.max(TYPE.caption.size * s, floor);
  const capL = capHeightPx(hud, labelPx);
  const capB = capHeightPx(hud, bodyPx);
  const maxW = right - left;

  pushRect(out, 0, 0, Math.round(width), Math.round(height), COLORS.bunker);

  // Bloco de cima: CARREGANDO, nome do mapa, barra total e porcentagem.
  let y = top;
  paintText(out, hud, tx.title, left, y, labelPx, COLORS.textoBaixo, TYPE.label.tracking);
  y += Math.round(capL + gap);
  if (model.mapName !== '') {
    if (model.mapName !== mapCache.source) {
      mapCache.source = model.mapName;
      mapCache.text = model.mapName.toUpperCase();
    }
    // Nome longo (mapas do M2 não têm limite) encolhe para caber na largura útil, até o piso de leitura.
    const namePx = fitTextPx(display, mapCache.text, titlePx, TYPE.title.tracking, maxW, floor);
    paintText(out, display, mapCache.text, left, y, namePx, COLORS.texto, TYPE.title.tracking);
    y += Math.round(capHeightPx(display, namePx) + gap * 1.5);
  }
  const fraction = loadingFraction(model);
  const barW = Math.min(Math.round(L.barWidth * s), maxW);
  const barH = Math.max(4, Math.round(L.barHeight * s));
  paintBar(out, left, y, barW, barH, fraction, COLORS.linha, COLORS.acao);
  const percent = Math.floor(fraction * 100);
  let px = left + barW + gap;
  const percentW =
    textWidth(hud, tx.percent[0] as string, bodyPx) +
    numberWidth(hud, percent, 0, bodyPx) +
    textWidth(hud, tx.percent[1] as string, bodyPx);
  if (px + percentW > right) px = left;
  const percentY = px === left ? y + barH + gap / 2 : y + (barH - capB) / 2;
  px += paintText(out, hud, tx.percent[0] as string, px, percentY, bodyPx, COLORS.texto);
  px += paintNumber(out, hud, percent, 0, px, percentY, bodyPx, COLORS.texto);
  paintText(out, hud, tx.percent[1] as string, px, percentY, bodyPx, COLORS.texto);
  y = Math.round(Math.max(y + barH, percentY + capB) + gap * 2);

  // Etapas: rótulo | barra (em andamento) ou tempo (concluída) ou "Na fila".
  let labelColW = 0;
  for (let i = 0; i < tx.steps.length; i++)
    labelColW = Math.max(labelColW, textWidth(hud, tx.steps[i] as string, bodyPx));
  labelColW = Math.round(labelColW + gap * 1.5);
  const stepBarW = Math.max(0, Math.min(Math.round(L.stepBarWidth * s), maxW - labelColW));
  const stepBarH = Math.max(2, Math.round(L.stepBarHeight * s));
  const rowH = Math.round(capB + gap * 0.9);
  const capC = capB;
  const tipY = bottom - capC;
  const rowsBottom = model.tipKey !== null ? tipY - gap : bottom;
  for (let i = 0; i < LOADING_STEPS.length; i++) {
    if (y + capB > rowsBottom) break;
    const progress = Math.min(1, Math.max(0, model.progress[i] as number));
    const ms = model.ms[i] as number;
    const done = ms >= 0 || progress >= 1;
    const active = !done && (i === model.current || progress > 0);
    paintText(out, hud, tx.steps[i] as string, left, y, bodyPx, done || active ? COLORS.texto : COLORS.textoBaixo);
    const vx = left + labelColW;
    if (done && ms >= 0) {
      let x = vx;
      x += paintText(out, hud, tx.ms[0] as string, x, y, bodyPx, COLORS.ok);
      x += paintNumber(out, hud, Math.round(ms), 0, x, y, bodyPx, COLORS.ok);
      paintText(out, hud, tx.ms[1] as string, x, y, bodyPx, COLORS.ok);
    } else if (done) {
      paintBar(out, vx, y + (capB - stepBarH) / 2, stepBarW, stepBarH, 1, COLORS.linha, COLORS.ok);
    } else if (active) {
      paintBar(out, vx, y + (capB - stepBarH) / 2, stepBarW, stepBarH, progress, COLORS.linha, COLORS.acao);
    } else {
      paintText(out, hud, tx.waiting, vx, y, bodyPx, COLORS.textoBaixo);
    }
    y += rowH;
  }

  if (model.tipKey !== null) paintText(out, hud, t(model.tipKey), left, tipY, bodyPx, COLORS.textoBaixo);
}
