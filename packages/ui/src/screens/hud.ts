import { pushRect, pushShape, type DrawList } from '../draw-list.ts';
import type { MsdfFont, UiFonts } from '../font.ts';
import { capHeightPx, numberWidth, paintBar, paintIcon, paintNumber, paintText, textWidth } from '../paint.ts';
import { t, templateParts } from '../text.ts';
import { COLORS, HUD_REFERENCE, PLAYER_COLORS, TEAM_COLORS, withAlpha } from '../tokens.ts';
import type { Insets } from '../tree.ts';

/**
 * HUD do M1, POR VISTA (arte-ux.md §6.6–§6.8; referência de 640×360 por vista). CONTRATO; desenho da frente
 * "ui-fontes". O `game` preenche o modelo 1x por frame a partir da SimView (sem alocar: struct mutável) e chama
 * `drawHud` com a `DrawList` da vista (`ViewDesc.hud`). Texto só pela tabela pt-BR e números sem `Intl`.
 */
export interface HudModel {
  health: number;
  maxHealth: number;
  clip: number;
  reserve: number;
  kills: number;
  deaths: number;
  dead: boolean;
  /** Segundos até renascer (morto). */
  respawnS: number;
  /** 0..1: retícula acende (corpo) e cabeça (amarelo); quem decai é o `game`. */
  hitMarker: number;
  headshotMarker: number;
  /**
   * Indicador de dano direcional: ângulo relativo à mira (rad, 0 = frente; positivo = à esquerda, como o yaw) e
   * intensidade 0..1.
   */
  damageAngle: number;
  damageAmount: number;
  /** Jogador local 0..3 (borda da vista e ícone P1–P4) e time 0..3 (255 = FFA). */
  playerSlot: number;
  team: number;
  /** Abertura da retícula 0..1 (movimento e tiro). */
  spread: number;
  /** Mostrar "Clique para mirar com o mouse" (web, teclado/mouse sem pointer lock). */
  clickToAim: boolean;
}

export function createHudModel(): HudModel {
  return {
    health: 0,
    maxHealth: 100,
    clip: 0,
    reserve: 0,
    kills: 0,
    deaths: 0,
    dead: false,
    respawnS: 0,
    hitMarker: 0,
    headshotMarker: 0,
    damageAngle: 0,
    damageAmount: 0,
    playerSlot: 0,
    team: 255,
    spread: 0,
    clickToAim: false,
  };
}

/** Retângulo da vista em px da superfície, escala e piso de texto (arte-ux.md §6.8). */
export interface HudViewport {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** min(largura/640, altura/360). */
  readonly scale: number;
  /** Piso do texto em px reais (22 na TV; 16 por vista no 3–4P). */
  readonly minTextPx: number;
  /** Margens seguras dentro da vista (px). */
  readonly insetTop: number;
  readonly insetRight: number;
  readonly insetBottom: number;
  readonly insetLeft: number;
  /** Quantas vistas há (no 3–4P o placar e o tempo vão para o cruzamento central, desenhado à parte). */
  readonly viewCount: number;
}

/**
 * Medidas do HUD em px da referência de 640×360 POR VISTA (uma vista cheia em 1280×720 tem escala 2). Os pisos de
 * texto vêm de `HudViewport.minTextPx`; números críticos usam o piso × `criticalFactor` (arte-ux.md §6.8: 16 → 22 no
 * 3–4P, 22 → 30 na TV).
 */
export const HUD_METRICS = {
  marginX: 16,
  marginY: 12,
  pad: 6,
  gap: 6,
  chamfer: 5,
  labelPx: 11,
  numberPx: 22,
  headingPx: 20,
  labelTracking: 0.14,
  criticalFactor: 1.375,
  healthWidth: 104,
  barHeight: 3,
  compactBarHeight: 2,
  crossLength: 6,
  crossThickness: 1.25,
  crossGap: 4,
  /** Quanto a retícula abre com `spread` = 1. */
  crossSpread: 10,
  /** Lado dos "pixels" do hitmarker em X. */
  hitStep: 2,
  damageLength: 64,
  damageThickness: 4,
  /** Borda da vista na cor do jogador (2–4P; arte-ux.md §6.6: 3 px por vista de 640×360). */
  border: 3,
} as const;

/** A plaquinha do alto à esquerda não passa desta fração da largura da vista (o meio é do placar). */
const HUD_CHIP_MAX_FRACTION = 0.36;

interface HudTexts {
  readonly health: string;
  readonly kills: string;
  readonly deaths: string;
  readonly respawning: string;
  readonly clickToAim: string;
  readonly players: readonly string[];
  /** `hud.ammo` cortado em [antes, entre, depois] de pente e reserva. */
  readonly ammo: readonly string[];
  /** `hud.timeLeft` cortado em [antes, entre, depois] de minutos e segundos. */
  readonly time: readonly string[];
}

let cachedTexts: HudTexts | null = null;

/** Textos do HUD resolvidos uma vez (caixa alta onde o estilo pede): o desenho por frame não cria string. */
function hudTexts(): HudTexts {
  if (cachedTexts) return cachedTexts;
  cachedTexts = {
    health: t('hud.health').toUpperCase(),
    kills: t('hud.kills').toUpperCase(),
    deaths: t('hud.deaths').toUpperCase(),
    respawning: t('hud.respawning').toUpperCase(),
    clickToAim: t('hud.clickToAim'),
    players: [1, 2, 3, 4].map((n) => t('hud.player', { n })),
    ammo: templateParts('hud.ammo', ['clip', 'reserve']),
    time: templateParts('hud.timeLeft', ['minutes', 'seconds']),
  };
  return cachedTexts;
}

const clamp01 = (v: number): number => (v > 0 ? (v < 1 ? v : 1) : 0);

function viewScale(view: HudViewport): number {
  if (view.scale > 0) return view.scale;
  return Math.min(view.width / HUD_REFERENCE.width, view.height / HUD_REFERENCE.height);
}

/** Tamanho do texto comum de uma vista (px reais). */
export function hudLabelPx(scale: number, minTextPx: number): number {
  return Math.max(HUD_METRICS.labelPx * scale, minTextPx);
}

/** Tamanho dos números críticos (vida, munição, placar) de uma vista (px reais). */
export function hudNumberPx(scale: number, minTextPx: number): number {
  return Math.max(HUD_METRICS.numberPx * scale, minTextPx * HUD_METRICS.criticalFactor);
}

function hudPad(scale: number): number {
  return Math.max(3, Math.round(HUD_METRICS.pad * scale));
}

/** Plaquinha do HUD (fundo `hudFundo`, chanfro da assinatura). */
function plate(out: DrawList, x: number, y: number, w: number, h: number, scale: number): void {
  pushShape(out, Math.round(x), Math.round(y), Math.round(w), Math.round(h), COLORS.hudFundo, Math.round(5 * scale));
}

function drawCrosshair(out: DrawList, cx: number, cy: number, gap: number, len: number, thick: number): void {
  const color = withAlpha(COLORS.texto, 0.92);
  const shadow = withAlpha(COLORS.bunker, 0.6);
  const x = Math.round(cx);
  const y = Math.round(cy);
  const h = Math.floor(thick / 2);
  // Sombra de 1 px por baixo: a retícula aparece sobre o céu claro e sobre o piso.
  pushRect(out, x - gap - len - 1, y - h - 1, len + 2, thick + 2, shadow);
  pushRect(out, x + gap - 1, y - h - 1, len + 2, thick + 2, shadow);
  pushRect(out, x - h - 1, y - gap - len - 1, thick + 2, len + 2, shadow);
  pushRect(out, x - h - 1, y + gap - 1, thick + 2, len + 2, shadow);
  pushRect(out, x - gap - len, y - h, len, thick, color);
  pushRect(out, x + gap, y - h, len, thick, color);
  pushRect(out, x - h, y - gap - len, thick, len, color);
  pushRect(out, x - h, y + gap, thick, len, color);
}

/** Hitmarker em X feito de "pixels" (a linguagem blocada do jogo): branco no corpo, âmbar na cabeça. */
function drawHitMarker(out: DrawList, cx: number, cy: number, from: number, step: number, color: number): void {
  const x = Math.round(cx);
  const y = Math.round(cy);
  const half = Math.floor(step / 2);
  for (let k = 0; k < 3; k++) {
    const o = from + k * step;
    pushRect(out, x - o - half, y - o - half, step, step, color);
    pushRect(out, x + o - half, y - o - half, step, step, color);
    pushRect(out, x - o - half, y + o - half, step, step, color);
    pushRect(out, x + o - half, y + o - half, step, step, color);
  }
}

/** Barra de dano na borda da área útil, na direção de onde veio o tiro. */
function drawDamage(
  out: DrawList,
  angle: number,
  amount: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
  scale: number,
): void {
  // Tela: frente = cima, esquerda = esquerda (ângulo positivo = à esquerda, como o yaw).
  const dx = -Math.sin(angle);
  const dy = -Math.cos(angle);
  const hw = (right - left) / 2;
  const hh = (bottom - top) / 2;
  const mx = left + hw;
  const my = top + hh;
  const th = Math.max(3, Math.round(HUD_METRICS.damageThickness * scale));
  const color = withAlpha(COLORS.perigo, 0.9 * clamp01(amount));
  if (Math.abs(dx) * hh > Math.abs(dy) * hw) {
    const len = Math.min(Math.round(HUD_METRICS.damageLength * scale), bottom - top);
    const py = my + (dy * hw) / Math.abs(dx);
    const y = Math.max(top, Math.min(bottom - len, py - len / 2));
    pushRect(out, Math.round(dx > 0 ? right - th : left), Math.round(y), th, len, color);
  } else {
    const len = Math.min(Math.round(HUD_METRICS.damageLength * scale), right - left);
    const px = mx + (dx * hh) / Math.abs(dy);
    const x = Math.max(left, Math.min(right - len, px - len / 2));
    pushRect(out, Math.round(x), Math.round(dy > 0 ? bottom - th : top), len, th, color);
  }
}

/** Borda da vista na cor do jogador, por dentro do retângulo (2–4P). */
function drawViewBorder(out: DrawList, view: HudViewport, width: number, color: number): void {
  const x = Math.round(view.x);
  const y = Math.round(view.y);
  const w = Math.round(view.width);
  const h = Math.round(view.height);
  pushRect(out, x, y, w, width, color);
  pushRect(out, x, y + h - width, w, width, color);
  pushRect(out, x, y + width, width, h - width * 2, color);
  pushRect(out, x + w - width, y + width, width, h - width * 2, color);
}

/**
 * Desenha o HUD de uma vista (arte-ux.md §6.7): retícula que abre com `spread` e hitmarker em X; vida embaixo à
 * esquerda; munição embaixo à direita; abates (e mortes, 1–2P) no alto à esquerda, com o rótulo P1–P4 na cor do
 * jogador no 2–4P; dano direcional nas bordas; "Renascendo…" com a contagem quando morto. No 3–4P (compacto) a vida
 * fica só com número e barra fina e a munição só com o pente. Sem fontes (`null`), só as formas. Sem alocação.
 */
export function drawHud(out: DrawList, fonts: UiFonts | null, model: Readonly<HudModel>, view: HudViewport): void {
  const M = HUD_METRICS;
  const tx = hudTexts();
  const s = viewScale(view);
  const multi = view.viewCount > 1;
  const compact = view.viewCount >= 3;
  const hud: MsdfFont | null = fonts?.hud ?? null;
  const display: MsdfFont | null = fonts?.display ?? null;
  const labelPx = hudLabelPx(s, view.minTextPx);
  const numberPx = hudNumberPx(s, view.minTextPx);
  const pad = hudPad(s);
  const gap = Math.max(3, Math.round(M.gap * s));
  const capL = capHeightPx(hud, labelPx);
  const capN = capHeightPx(hud, numberPx);
  const slot = ((Math.trunc(model.playerSlot) % 4) + 4) % 4;
  const playerColor = PLAYER_COLORS[slot] as number;

  const left = Math.round(view.x + Math.max(view.insetLeft, M.marginX * s));
  const right = Math.round(view.x + view.width - Math.max(view.insetRight, M.marginX * s));
  const top = Math.round(view.y + Math.max(view.insetTop, M.marginY * s));
  const bottom = Math.round(view.y + view.height - Math.max(view.insetBottom, M.marginY * s));
  const cx = view.x + view.width / 2;
  const cy = view.y + view.height / 2;

  if (multi) drawViewBorder(out, view, Math.max(2, Math.round(M.border * s)), playerColor);

  // Alto à esquerda: [ícone P1] ABATES n (MORTES n). As mortes só entram se a plaquinha couber no terço esquerdo da
  // vista: o meio do alto é do placar compartilhado (1P) ou do cruzamento central (vista de baixo no 2P).
  {
    const icon = Math.round(capL);
    let w = pad;
    if (multi) w += icon + gap / 2 + textWidth(hud, tx.players[slot] as string, labelPx) + gap * 1.5;
    w += textWidth(hud, tx.kills, labelPx, M.labelTracking) + gap + numberWidth(hud, model.kills, 0, labelPx);
    const deathsW =
      gap * 1.5 +
      textWidth(hud, tx.deaths, labelPx, M.labelTracking) +
      gap +
      numberWidth(hud, model.deaths, 0, labelPx);
    const showDeaths = !compact && left + w + deathsW + pad <= view.x + view.width * HUD_CHIP_MAX_FRACTION;
    if (showDeaths) w += deathsW;
    w += pad;
    const h = Math.round(capL + pad * 2);
    plate(out, left, top, w, h, s);
    let x = left + pad;
    const y = top + pad;
    if (multi) {
      paintIcon(out, slot, x, y, icon, playerColor);
      x += icon + gap / 2;
      x += paintText(out, hud, tx.players[slot] as string, x, y, labelPx, playerColor) + gap * 1.5;
    }
    x += paintText(out, hud, tx.kills, x, y, labelPx, COLORS.textoBaixo, M.labelTracking) + gap;
    x += paintNumber(out, hud, model.kills, 0, x, y, labelPx, COLORS.texto);
    if (showDeaths) {
      x += gap * 1.5;
      x += paintText(out, hud, tx.deaths, x, y, labelPx, COLORS.textoBaixo, M.labelTracking) + gap;
      paintNumber(out, hud, model.deaths, 0, x, y, labelPx, COLORS.texto);
    }
  }

  // Embaixo à esquerda: vida (rótulo, número e barra; no compacto só número e barra fina).
  {
    const hp = Math.max(0, Math.ceil(model.health));
    const frac = model.maxHealth > 0 ? clamp01(hp / model.maxHealth) : 0;
    const low = frac <= 0.35;
    const barH = Math.max(2, Math.round((compact ? M.compactBarHeight : M.barHeight) * s));
    const labelW = compact ? 0 : textWidth(hud, tx.health, labelPx, M.labelTracking);
    const innerW = Math.max(
      Math.round(M.healthWidth * s * (compact ? 0.6 : 1)),
      numberWidth(hud, hp, 0, numberPx),
      labelW,
    );
    const h = Math.round(pad + (compact ? 0 : capL + pad) + capN + pad + barH + pad);
    const y = bottom - h;
    plate(out, left, y, innerW + pad * 2, h, s);
    let ty = y + pad;
    if (!compact) {
      paintText(out, hud, tx.health, left + pad, ty, labelPx, COLORS.textoBaixo, M.labelTracking);
      ty += capL + pad;
    }
    paintNumber(out, hud, hp, 0, left + pad, ty, numberPx, low ? COLORS.perigo : COLORS.texto);
    paintBar(out, left + pad, ty + capN + pad, innerW, barH, frac, COLORS.linha, low ? COLORS.perigo : COLORS.ok);
  }

  // Embaixo à direita: munição (pente / reserva; no compacto só o pente).
  {
    const clip = Math.max(0, Math.trunc(model.clip));
    const reserve = Math.max(0, Math.trunc(model.reserve));
    const clipColor = clip === 0 ? COLORS.perigo : COLORS.texto;
    const sep = tx.ammo[1] as string;
    let w = numberWidth(hud, clip, 0, numberPx);
    if (!compact) w += textWidth(hud, sep, numberPx) + numberWidth(hud, reserve, 0, numberPx);
    const h = Math.round(capN + pad * 2);
    const x = right - w - pad * 2;
    const y = bottom - h;
    plate(out, x, y, w + pad * 2, h, s);
    let tx0 = x + pad;
    tx0 += paintNumber(out, hud, clip, 0, tx0, y + pad, numberPx, clipColor);
    if (!compact) {
      tx0 += paintText(out, hud, sep, tx0, y + pad, numberPx, COLORS.textoBaixo);
      paintNumber(out, hud, reserve, 0, tx0, y + pad, numberPx, COLORS.textoBaixo);
    }
  }

  // Centro: retícula + hitmarker, ou "Renascendo…" com a contagem.
  if (!model.dead) {
    const thick = Math.max(2, Math.round(M.crossThickness * s));
    const len = Math.max(4, Math.round(M.crossLength * s));
    const crossGap = Math.max(3, Math.round((M.crossGap + M.crossSpread * clamp01(model.spread)) * s));
    drawCrosshair(out, cx, cy, crossGap, len, thick);
    const marker = Math.max(model.hitMarker, model.headshotMarker);
    if (marker > 0.01) {
      const step = Math.max(2, Math.round(M.hitStep * s));
      const color = withAlpha(model.headshotMarker > 0.01 ? COLORS.acao : COLORS.texto, clamp01(marker));
      drawHitMarker(out, cx, cy, crossGap + step, step, color);
    }
    if (model.clickToAim) {
      const w = textWidth(hud, tx.clickToAim, labelPx);
      const y = Math.round(cy + crossGap + len + gap * 2);
      plate(out, cx - w / 2 - pad, y, w + pad * 2, capL + pad * 2, s);
      paintText(out, hud, tx.clickToAim, cx, y + pad, labelPx, COLORS.texto, 0, 0.5);
    }
  } else {
    const headPx = Math.max(M.headingPx * s, view.minTextPx);
    const capH = capHeightPx(display, headPx);
    const showCount = model.respawnS > 0;
    const count = Math.ceil(model.respawnS);
    const w = Math.max(textWidth(display, tx.respawning, headPx, 0.02), numberWidth(hud, count, 0, numberPx));
    const h = Math.round(pad * 2 + capH + (showCount ? gap + capN : 0));
    const y = Math.round(cy - h / 2);
    plate(out, cx - w / 2 - pad * 2, y, w + pad * 4, h, s);
    paintText(out, display, tx.respawning, cx, y + pad, headPx, COLORS.texto, 0.02, 0.5);
    if (showCount) paintNumber(out, hud, count, 0, cx, y + pad + capH + gap, numberPx, COLORS.acao, 0.5);
  }

  if (model.damageAmount > 0.01) drawDamage(out, model.damageAngle, model.damageAmount, left, top, right, bottom, s);
}

// --- Informação compartilhada (placar e tempo) -------------------------------------------------------------------

/**
 * Placar e tempo, desenhados UMA vez por frame (arte-ux.md §6.6): no topo da vista com 1 jogador, no cruzamento
 * central com 2 e 4, e no 4º quadrante (livre) com 3. Struct mutável, sem alocar: o `game` preenche.
 */
export interface HudSharedModel {
  /** Segundos que faltam (< 0 = sem relógio). */
  timeLeftS: number;
  /** Times no placar (0 = sem placar: FFA ou bench). */
  teamCount: number;
  /** Placar por time (0..3). */
  readonly teamScores: number[];
}

export function createHudSharedModel(): HudSharedModel {
  return { timeLeftS: -1, teamCount: 0, teamScores: [0, 0, 0, 0] };
}

export type HudSharedMode = 'top' | 'center' | 'spare';

/** Onde vai a informação compartilhada (px da superfície). */
export interface HudSharedArea {
  readonly mode: HudSharedMode;
  /** `top`: a vista única; `center`: a superfície inteira; `spare`: o quadrante livre do 3P. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  readonly minTextPx: number;
  /** Margem segura no alto (modo `top`). */
  readonly insetTop: number;
}

/** Altura da plaquinha central (fixa pelo tamanho dos números, não pela fonte: o layout das vistas reserva espaço). */
export function hudSharedPlateHeight(scale: number, minTextPx: number): number {
  return Math.round(hudNumberPx(scale, minTextPx) * 0.8 + hudPad(scale) * 2);
}

function sharedContentWidth(
  font: MsdfFont | null,
  model: Readonly<HudSharedModel>,
  numberPx: number,
  icon: number,
  gap: number,
  tx: HudTexts,
): number {
  let w = 0;
  const teams = Math.max(0, Math.min(4, Math.trunc(model.teamCount)));
  for (let i = 0; i < teams; i++) {
    w += icon + gap / 2 + numberWidth(font, model.teamScores[i] ?? 0, 0, numberPx);
  }
  if (model.timeLeftS >= 0) {
    const total = Math.ceil(model.timeLeftS);
    w += textWidth(font, tx.time[0] as string, numberPx) + numberWidth(font, Math.floor(total / 60), 0, numberPx);
    w += textWidth(font, tx.time[1] as string, numberPx) + numberWidth(font, total % 60, 0, numberPx, 2);
    w += textWidth(font, tx.time[2] as string, numberPx);
    // Um vão entre cada time e o relógio.
    w += teams * gap * 2;
  } else if (teams > 1) {
    w += (teams - 1) * gap * 2;
  }
  return w;
}

/** Placar e tempo numa linha: metade dos times, o relógio, a outra metade. Devolve a largura. */
function paintSharedLine(
  out: DrawList,
  font: MsdfFont | null,
  model: Readonly<HudSharedModel>,
  x: number,
  capTop: number,
  numberPx: number,
  icon: number,
  gap: number,
  tx: HudTexts,
): number {
  const teams = Math.max(0, Math.min(4, Math.trunc(model.teamCount)));
  const hasTime = model.timeLeftS >= 0;
  const leftTeams = hasTime ? Math.ceil(teams / 2) : teams;
  let pen = x;
  for (let i = 0; i < leftTeams; i++) {
    pen += paintTeamScore(out, font, i, model.teamScores[i] ?? 0, pen, capTop, numberPx, icon, gap);
    if (hasTime || i < teams - 1) pen += gap * 2;
  }
  if (hasTime) {
    const total = Math.ceil(model.timeLeftS);
    const color = total <= 10 ? COLORS.perigo : COLORS.texto;
    pen += paintText(out, font, tx.time[0] as string, pen, capTop, numberPx, color);
    pen += paintNumber(out, font, Math.floor(total / 60), 0, pen, capTop, numberPx, color);
    pen += paintText(out, font, tx.time[1] as string, pen, capTop, numberPx, color);
    pen += paintNumber(out, font, total % 60, 0, pen, capTop, numberPx, color, 0, 2);
    pen += paintText(out, font, tx.time[2] as string, pen, capTop, numberPx, color);
  }
  for (let i = leftTeams; i < teams; i++) {
    pen += gap * 2;
    pen += paintTeamScore(out, font, i, model.teamScores[i] ?? 0, pen, capTop, numberPx, icon, gap);
  }
  return pen - x;
}

/** Ícone + placar de um time, na cor do time. Devolve a largura. */
function paintTeamScore(
  out: DrawList,
  font: MsdfFont | null,
  team: number,
  score: number,
  x: number,
  capTop: number,
  numberPx: number,
  icon: number,
  gap: number,
): number {
  const color = TEAM_COLORS[team] as number;
  const capN = capHeightPx(font, numberPx);
  paintIcon(out, team, x, capTop + (capN - icon) / 2, icon, color);
  return icon + gap / 2 + paintNumber(out, font, score, 0, x + icon + gap / 2, capTop, numberPx, color);
}

/**
 * Desenha o placar e o tempo na área compartilhada (ver `layoutHudScreen`). Sem relógio e sem times, só o fundo do
 * quadrante livre (3P). Sem alocação.
 */
export function drawHudShared(
  out: DrawList,
  fonts: UiFonts | null,
  model: Readonly<HudSharedModel>,
  area: HudSharedArea,
): void {
  const tx = hudTexts();
  const font: MsdfFont | null = fonts?.hud ?? null;
  const s = area.scale > 0 ? area.scale : 1;
  const pad = hudPad(s);
  const gap = Math.max(3, Math.round(HUD_METRICS.gap * s));
  const hasContent = model.timeLeftS >= 0 || model.teamCount > 0;

  if (area.mode === 'spare') {
    pushRect(
      out,
      Math.round(area.x),
      Math.round(area.y),
      Math.round(area.width),
      Math.round(area.height),
      COLORS.bunker,
    );
    if (!hasContent) return;
    // Quadrante livre: o mesmo placar, em dobro, centrado.
    const numberPx = hudNumberPx(s, area.minTextPx) * 2;
    const icon = Math.round(capHeightPx(font, numberPx) * 0.8);
    const w = sharedContentWidth(font, model, numberPx, icon, gap, tx);
    const capN = capHeightPx(font, numberPx);
    const x = area.x + (area.width - w) / 2;
    paintSharedLine(out, font, model, x, area.y + (area.height - capN) / 2, numberPx, icon, gap, tx);
    return;
  }
  if (!hasContent) return;
  const numberPx = hudNumberPx(s, area.minTextPx);
  const capN = capHeightPx(font, numberPx);
  const icon = Math.round(capN * 0.8);
  const w = sharedContentWidth(font, model, numberPx, icon, gap, tx) + pad * 2;
  const h = hudSharedPlateHeight(s, area.minTextPx);
  const x = Math.round(area.x + (area.width - w) / 2);
  const y =
    area.mode === 'top'
      ? Math.round(area.y + Math.max(area.insetTop, HUD_METRICS.marginY * s))
      : Math.round(area.y + (area.height - h) / 2);
  plate(out, x, y, w, h, s);
  paintSharedLine(out, font, model, x + pad, y + (h - capN) / 2, numberPx, icon, gap, tx);
}

// --- Divisão da tela (1 a 4 vistas) --------------------------------------------------------------------------------

export interface HudScreenOptions {
  /** Piso do texto em px reais (`MIN_TEXT`; no celular, × pixelRatio). */
  readonly minTextPx: number;
  /** Safe area da superfície (px reais): só as bordas externas das vistas recebem. */
  readonly safeArea?: Insets;
  /** 2 jogadores lado a lado (8:9) em vez de cima/baixo (32:9). */
  readonly vertical?: boolean;
  /** Vistas com origem no próprio canto (`ViewDesc.hud`); padrão: px da superfície (uma `DrawList` só). */
  readonly viewLocal?: boolean;
}

export interface HudRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface HudScreenLayout {
  /** Uma por vista, prontas para `drawHud`. */
  readonly views: readonly HudViewport[];
  /** Retângulos das vistas em px da superfície (também com `viewLocal`): os mesmos da `ViewDesc`. */
  readonly rects: readonly HudRect[];
  /** Onde `drawHudShared` desenha (sempre em px da superfície). */
  readonly shared: HudSharedArea;
}

/**
 * Divide a superfície em 1 a 4 vistas (tecnico.md §6.8: 1 cheia; 2 cima/baixo ou lado a lado; 3 e 4 em 2×2, com o
 * 4º quadrante livre no 3P) e monta o `HudViewport` de cada uma: escala pela referência de 640×360, safe area só nas
 * bordas externas e, no 4P, folga na borda interna para a plaquinha do cruzamento central. Roda no resize (aloca).
 */
export function layoutHudScreen(
  viewCount: number,
  width: number,
  height: number,
  options: HudScreenOptions,
): HudScreenLayout {
  const count = Math.max(1, Math.min(4, Math.trunc(viewCount)));
  const safe = options.safeArea ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const hx = Math.round(width / 2);
  const hy = Math.round(height / 2);
  const rects: HudRect[] = [];
  if (count === 1) rects.push({ x: 0, y: 0, width, height });
  else if (count === 2 && options.vertical) {
    rects.push({ x: 0, y: 0, width: hx, height }, { x: hx, y: 0, width: width - hx, height });
  } else if (count === 2) {
    rects.push({ x: 0, y: 0, width, height: hy }, { x: 0, y: hy, width, height: height - hy });
  } else {
    rects.push(
      { x: 0, y: 0, width: hx, height: hy },
      { x: hx, y: 0, width: width - hx, height: hy },
      { x: 0, y: hy, width: hx, height: height - hy },
    );
    if (count === 4) rects.push({ x: hx, y: hy, width: width - hx, height: height - hy });
  }
  const scaleOf = (r: HudRect): number => Math.min(r.width / HUD_REFERENCE.width, r.height / HUD_REFERENCE.height);
  const views: HudViewport[] = rects.map((r) => {
    const scale = scaleOf(r);
    const outerTop = r.y <= 0;
    const outerLeft = r.x <= 0;
    const outerBottom = r.y + r.height >= height;
    const outerRight = r.x + r.width >= width;
    // 4P e 2P cima/baixo: a plaquinha do centro encosta nas bordas internas de cima e de baixo (em vista estreita ela
    // pegaria o rótulo P1–P4 ou a vida). No 2P lado a lado ela fica no meio da altura, longe dos cantos.
    const centerPlate = count === 4 || (count === 2 && !options.vertical);
    const clearance = centerPlate
      ? Math.ceil(hudSharedPlateHeight(scale, options.minTextPx) / 2) + HUD_METRICS.marginY * scale
      : 0;
    return {
      x: options.viewLocal ? 0 : r.x,
      y: options.viewLocal ? 0 : r.y,
      width: r.width,
      height: r.height,
      scale,
      minTextPx: options.minTextPx,
      insetTop: outerTop ? safe.top : clearance,
      insetRight: outerRight ? safe.right : 0,
      insetBottom: outerBottom ? safe.bottom : clearance,
      insetLeft: outerLeft ? safe.left : 0,
      viewCount: count,
    };
  });
  const first = rects[0] as HudRect;
  const shared: HudSharedArea =
    count === 1
      ? { mode: 'top', ...first, scale: scaleOf(first), minTextPx: options.minTextPx, insetTop: safe.top }
      : count === 3
        ? {
            mode: 'spare',
            x: hx,
            y: hy,
            width: width - hx,
            height: height - hy,
            scale: scaleOf(first),
            minTextPx: options.minTextPx,
            insetTop: 0,
          }
        : {
            mode: 'center',
            x: 0,
            y: 0,
            width,
            height,
            scale: scaleOf(first),
            minTextPx: options.minTextPx,
            insetTop: 0,
          };
  return { views, rects, shared };
}
