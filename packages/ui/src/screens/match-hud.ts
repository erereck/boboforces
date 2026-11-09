import { pushRect, pushShape, type DrawList } from '../draw-list.ts';
import type { MsdfFont, UiFonts } from '../font.ts';
import { capHeightPx, numberWidth, paintNumber, paintText, textWidth } from '../paint.ts';
import { t } from '../text.ts';
import { COLORS, TEAM_COLORS, withAlpha } from '../tokens.ts';
import { HUD_METRICS, hudLabelPx, hudNumberPx } from './hud.ts';

/**
 * M2 (fase 2d): o que a partida desenha por cima das vistas, uma vez por quadro, em px da superfície: o kill feed, o
 * placar do Tab e a contagem inicial. Modelos mutáveis e pré-alocados (o `game` preenche; strings por referência,
 * números pintados sem montar texto). Sem DOM e sem alocar por quadro.
 */

// --- Kill feed ---------------------------------------------------------------------------------------------------

/** Linhas no kill feed e por quanto tempo cada uma fica (a última 1 s apagando). */
export const KILL_FEED_MAX = 5;
export const KILL_FEED_SHOW_S = 6;

export interface KillFeedModel {
  count: number;
  /** Da mais nova (0) para a mais velha. `killer` vazio = sem matador (a "arma" é a causa: "Caiu no vazio"). */
  readonly killer: string[];
  readonly weapon: string[];
  readonly victim: string[];
  readonly killerColor: number[];
  readonly victimColor: number[];
  readonly headshot: boolean[];
  readonly age: number[];
}

export function createKillFeedModel(): KillFeedModel {
  const n = KILL_FEED_MAX;
  return {
    count: 0,
    killer: new Array<string>(n).fill(''),
    weapon: new Array<string>(n).fill(''),
    victim: new Array<string>(n).fill(''),
    killerColor: new Array<number>(n).fill(COLORS.texto),
    victimColor: new Array<number>(n).fill(COLORS.texto),
    headshot: new Array<boolean>(n).fill(false),
    age: new Array<number>(n).fill(0),
  };
}

/** Põe uma morte no alto do feed (a mais velha sai se estiver cheio). */
export function pushKillFeed(
  m: KillFeedModel,
  killer: string,
  killerColor: number,
  weapon: string,
  victim: string,
  victimColor: number,
  headshot: boolean,
): void {
  const last = Math.min(m.count, KILL_FEED_MAX - 1);
  for (let i = last; i > 0; i--) {
    m.killer[i] = m.killer[i - 1]!;
    m.weapon[i] = m.weapon[i - 1]!;
    m.victim[i] = m.victim[i - 1]!;
    m.killerColor[i] = m.killerColor[i - 1]!;
    m.victimColor[i] = m.victimColor[i - 1]!;
    m.headshot[i] = m.headshot[i - 1]!;
    m.age[i] = m.age[i - 1]!;
  }
  m.killer[0] = killer;
  m.weapon[0] = weapon;
  m.victim[0] = victim;
  m.killerColor[0] = killerColor;
  m.victimColor[0] = victimColor;
  m.headshot[0] = headshot;
  m.age[0] = 0;
  m.count = Math.min(m.count + 1, KILL_FEED_MAX);
}

/** Envelhece as linhas e tira as que passaram do tempo (as mais velhas ficam no fim). */
export function ageKillFeed(m: KillFeedModel, dt: number): void {
  for (let i = 0; i < m.count; i++) m.age[i] = m.age[i]! + dt;
  while (m.count > 0 && m.age[m.count - 1]! >= KILL_FEED_SHOW_S) m.count--;
}

/**
 * Desenha o feed alinhado à direita em `right`, a partir de `top`: "Matador  arma  Vítima" (a arma em âmbar no tiro de
 * cabeça; sem matador, "Vítima  causa"). `scale` e `minTextPx` como os da HUD da vista.
 */
export function drawKillFeed(
  out: DrawList,
  fonts: UiFonts | null,
  m: Readonly<KillFeedModel>,
  right: number,
  top: number,
  scale: number,
  minTextPx: number,
): void {
  if (m.count === 0) return;
  const font: MsdfFont | null = fonts?.hud ?? null;
  const px = hudLabelPx(scale, minTextPx);
  const pad = Math.max(3, Math.round(HUD_METRICS.pad * scale));
  const gap = Math.max(3, Math.round(HUD_METRICS.gap * scale));
  const cap = capHeightPx(font, px);
  const h = Math.round(cap + pad * 2);
  let y = Math.round(top);
  for (let i = 0; i < m.count; i++) {
    const fade = Math.min(1, KILL_FEED_SHOW_S - m.age[i]!);
    const killer = m.killer[i]!;
    const kw = killer !== '' ? textWidth(font, killer, px) + gap : 0;
    const ww = textWidth(font, m.weapon[i]!, px);
    const vw = textWidth(font, m.victim[i]!, px);
    const w = kw + ww + gap + vw;
    const x = Math.round(right - w - pad * 2);
    pushShape(out, x, y, Math.round(w + pad * 2), h, withAlpha(COLORS.hudFundo, 0.7 * fade), Math.round(4 * scale));
    let tx = x + pad;
    if (killer !== '') {
      tx += paintText(out, font, killer, tx, y + pad, px, withAlpha(m.killerColor[i]!, fade)) + gap;
      tx += paintText(
        out,
        font,
        m.weapon[i]!,
        tx,
        y + pad,
        px,
        withAlpha(m.headshot[i] ? COLORS.acao : COLORS.textoBaixo, fade),
      );
      paintText(out, font, m.victim[i]!, tx + gap, y + pad, px, withAlpha(m.victimColor[i]!, fade));
    } else {
      tx += paintText(out, font, m.victim[i]!, tx, y + pad, px, withAlpha(m.victimColor[i]!, fade)) + gap;
      paintText(out, font, m.weapon[i]!, tx, y + pad, px, withAlpha(COLORS.textoBaixo, fade));
    }
    y += h + Math.round(gap / 2);
  }
}

// --- Placar do Tab -----------------------------------------------------------------------------------------------

/** Linhas do placar (o motor vai até 64 bots + 4 humanos; o placar mostra até 40). */
export const SCOREBOARD_MAX_ROWS = 40;

export interface ScoreboardModel {
  /** Nome do modo ("Bobo Warfare: Times"), por referência. */
  title: string;
  /** 0 = FFA (uma lista só); 2 = TDM. */
  teamCount: number;
  readonly teamScores: number[];
  rowCount: number;
  /** Por linha, já na ordem de exibição (o `game` ordena: abates, depois menos mortes). */
  readonly name: string[];
  readonly team: Uint8Array;
  readonly kills: Uint16Array;
  readonly deaths: Uint16Array;
  readonly assists: Uint16Array;
  /** 1 = é você (linha destacada). */
  readonly local: Uint8Array;
  /** 1 = morto agora (nome apagado). */
  readonly dead: Uint8Array;
  /**
   * M2 (fecho da fase 3): as regras ativas dos bots (GDD §6.5), uma linha por bot diferente ("Jorge the Immortal: 500
   * de vida · só escopeta"), desenhadas embaixo da tabela do time delas (`ruleTeam`; no FFA, embaixo da lista). Fixas
   * na partida: o `game` preenche uma vez.
   */
  readonly ruleLines: string[];
  readonly ruleTeam: Uint8Array;
  ruleCount: number;
}

export function createScoreboardModel(): ScoreboardModel {
  const n = SCOREBOARD_MAX_ROWS;
  return {
    title: '',
    teamCount: 0,
    teamScores: [0, 0, 0, 0],
    rowCount: 0,
    name: new Array<string>(n).fill(''),
    team: new Uint8Array(n),
    kills: new Uint16Array(n),
    deaths: new Uint16Array(n),
    assists: new Uint16Array(n),
    local: new Uint8Array(n),
    dead: new Uint8Array(n),
    ruleLines: new Array<string>(n).fill(''),
    ruleTeam: new Uint8Array(n),
    ruleCount: 0,
  };
}

interface ScoreboardTexts {
  readonly kills: string;
  readonly deaths: string;
  readonly assists: string;
  readonly player: string;
}

let scoreTexts: ScoreboardTexts | null = null;

function scoreboardTexts(): ScoreboardTexts {
  scoreTexts ??= {
    kills: t('scoreboard.kills').toUpperCase(),
    deaths: t('scoreboard.deaths').toUpperCase(),
    assists: t('scoreboard.assists').toUpperCase(),
    player: t('scoreboard.player').toUpperCase(),
  };
  return scoreTexts;
}

/**
 * Placar do Tab (ou Select) por cima de tudo, centrado na superfície: o título e, no TDM, uma tabela por time com a
 * cor e os pontos do time (lado a lado se couber, senão uma embaixo da outra); no FFA, uma tabela só. Colunas: nome,
 * abates, mortes e assistências; a sua linha em âmbar.
 */
export function drawScoreboard(
  out: DrawList,
  fonts: UiFonts | null,
  m: Readonly<ScoreboardModel>,
  width: number,
  height: number,
  minTextPx: number,
): void {
  const tx = scoreboardTexts();
  const font: MsdfFont | null = fonts?.hud ?? null;
  const s = Math.min(width / 640, height / 360);
  const px = hudLabelPx(s, minTextPx);
  const titlePx = hudNumberPx(s, minTextPx) * 0.8;
  const pad = Math.max(3, Math.round(HUD_METRICS.pad * s));
  const gap = Math.max(3, Math.round(HUD_METRICS.gap * s));
  const cap = capHeightPx(font, px);
  const rowH = Math.round(cap + pad * 1.4);
  // Coluna da largura do maior título (ou de 999), com o espaçamento do título.
  const numW = Math.max(
    numberWidth(font, 999, 0, px),
    textWidth(font, tx.kills, px * 0.85, 0.08),
    textWidth(font, tx.deaths, px * 0.85, 0.08),
    textWidth(font, tx.assists, px * 0.85, 0.08),
  );
  const nameW = Math.round(Math.max(textWidth(font, tx.player, px * 0.85), px * 9));
  const tableW = nameW + numW * 3 + gap * 4 + pad * 2;
  const tables = m.teamCount > 0 ? m.teamCount : 1;
  const sideBySide = tables === 1 || tableW * tables + gap * 2 * (tables - 1) <= width - pad * 4;
  let maxRows = 0;
  for (let tIdx = 0; tIdx < tables; tIdx++) {
    let n = 0;
    for (let r = 0; r < m.rowCount; r++) if (tables === 1 || m.team[r] === tIdx) n++;
    if (n > maxRows) maxRows = n;
  }
  const tableH = rowH * (maxRows + 1) + pad * 2 + gap;
  // Legenda das regras: a maior entre os times (lado a lado) ou a de cada um (empilhados).
  const rulePx = px * 0.8;
  const ruleCap = capHeightPx(font, rulePx);
  const ruleH = Math.round(ruleCap + gap);
  // A placa da legenda: o respiro da tabela (`pad`) em cima e embaixo das linhas.
  const plateH = (n: number): number => Math.round(pad * 2 + (n - 1) * ruleH + ruleCap);
  const footer = (n: number): number => (n > 0 ? gap + plateH(n) : 0);
  const titleCap = capHeightPx(font, titlePx);
  const totalW = sideBySide ? tableW * tables + gap * 2 * (tables - 1) : tableW;
  const baseH = titleCap + gap * 2 + (sideBySide ? tableH : tableH * tables + gap * (tables - 1));
  // Quantas linhas de legenda cabem por tabela no que sobra da tela (numa tela pequena com o placar cheio, as de baixo
  // ficam de fora; a tela de morte ainda mostra as regras de quem matou).
  const spare = height - pad * 2 - baseH;
  let ruleLimit = 0;
  for (let tIdx = 0; tIdx < tables; tIdx++) ruleLimit = Math.max(ruleLimit, rulesOf(m, tables, tIdx));
  while (ruleLimit > 0 && (sideBySide ? footer(ruleLimit) : tables * footer(ruleLimit)) > spare) ruleLimit--;
  const shown = (tIdx: number): number => Math.min(ruleLimit, rulesOf(m, tables, tIdx));
  let legendH = 0;
  for (let tIdx = 0; tIdx < tables; tIdx++) {
    legendH = sideBySide ? Math.max(legendH, footer(shown(tIdx))) : legendH + footer(shown(tIdx));
  }
  const totalH = baseH + legendH;
  const x0 = Math.round((width - totalW) / 2);
  let y0 = Math.round(Math.max(pad, (height - totalH) / 2));
  pushRect(out, 0, 0, width, height, withAlpha(COLORS.bunker, 0.45));
  paintText(out, font, m.title, width / 2, y0, titlePx, COLORS.texto, 0.04, 0.5);
  y0 += Math.round(titleCap + gap * 2);
  let stackY = y0;
  for (let tIdx = 0; tIdx < tables; tIdx++) {
    const tx0 = sideBySide ? x0 + tIdx * (tableW + gap * 2) : x0;
    const ty0 = sideBySide ? y0 : stackY;
    stackY += tableH + gap + footer(shown(tIdx));
    const color = tables > 1 ? (TEAM_COLORS[tIdx] as number) : COLORS.acao;
    pushShape(out, tx0, ty0, tableW, tableH, COLORS.hudFundo, Math.round(5 * s));
    pushRect(out, tx0, ty0, tableW, Math.max(2, Math.round(2 * s)), color);
    // Cabeçalho: os pontos do time (TDM) e os nomes das colunas.
    const hy = ty0 + pad;
    if (tables > 1) paintNumber(out, font, m.teamScores[tIdx] ?? 0, 0, tx0 + pad, hy, px, color);
    else paintText(out, font, tx.player, tx0 + pad, hy, px * 0.85, COLORS.textoBaixo, 0.08);
    const colX = (k: number): number => tx0 + pad + nameW + gap + k * (numW + gap) + numW;
    paintText(out, font, tx.kills, colX(0), hy, px * 0.85, COLORS.textoBaixo, 0.08, 1);
    paintText(out, font, tx.deaths, colX(1), hy, px * 0.85, COLORS.textoBaixo, 0.08, 1);
    paintText(out, font, tx.assists, colX(2), hy, px * 0.85, COLORS.textoBaixo, 0.08, 1);
    let ry = hy + rowH + gap;
    for (let r = 0; r < m.rowCount; r++) {
      if (tables > 1 && m.team[r] !== tIdx) continue;
      if (m.local[r] === 1) pushRect(out, tx0 + 2, ry - pad * 0.5, tableW - 4, rowH, withAlpha(COLORS.acao, 0.18));
      const fg = m.dead[r] === 1 ? COLORS.textoBaixo : m.local[r] === 1 ? COLORS.acao : COLORS.texto;
      paintText(out, font, m.name[r]!, tx0 + pad, ry, px, fg);
      paintNumber(out, font, m.kills[r]!, 0, colX(0), ry, px, fg, 1);
      paintNumber(out, font, m.deaths[r]!, 0, colX(1), ry, px, COLORS.textoBaixo, 1);
      paintNumber(out, font, m.assists[r]!, 0, colX(2), ry, px, COLORS.textoBaixo, 1);
      ry += rowH;
    }
    const own = shown(tIdx);
    // A legenda vai numa placa como a da tabela (o texto baixo não fica direto sobre a cena).
    if (own > 0) pushShape(out, tx0, ty0 + tableH + gap, tableW, plateH(own), COLORS.hudFundo, Math.round(5 * s));
    let fy = ty0 + tableH + gap + pad;
    let drawn = 0;
    for (let k = 0; k < m.ruleCount && drawn < own; k++) {
      if (tables > 1 && m.ruleTeam[k] !== tIdx) continue;
      drawn++;
      paintText(out, font, m.ruleLines[k]!, tx0 + pad, fy, rulePx, COLORS.textoBaixo);
      fy += ruleH;
    }
  }
}

/** Quantas linhas de regra vão embaixo da tabela `tIdx` (com uma tabela só, todas). */
function rulesOf(m: Readonly<ScoreboardModel>, tables: number, tIdx: number): number {
  let n = 0;
  for (let k = 0; k < m.ruleCount; k++) if (tables === 1 || m.ruleTeam[k] === tIdx) n++;
  return n;
}

// --- Contagem inicial ----------------------------------------------------------------------------------------------

/**
 * Contagem antes da partida (gameplay.md §2.2): o número grande no centro e, embaixo, quem vem pela frente ("Hoje: 6 ×
 * Normal Bob"). `seconds` já arredondado para cima pelo `game`.
 */
export function drawMatchCountdown(
  out: DrawList,
  fonts: UiFonts | null,
  seconds: number,
  line: string,
  width: number,
  height: number,
  minTextPx: number,
): void {
  const s = Math.min(width / 640, height / 360);
  const display: MsdfFont | null = fonts?.display ?? null;
  const hud: MsdfFont | null = fonts?.hud ?? null;
  const bigPx = Math.max(hudNumberPx(s, minTextPx) * 3, minTextPx);
  const px = hudLabelPx(s, minTextPx) * 1.2;
  const pad = Math.max(3, Math.round(HUD_METRICS.pad * s));
  const gap = Math.max(3, Math.round(HUD_METRICS.gap * s));
  const capBig = capHeightPx(display, bigPx);
  const cap = capHeightPx(hud, px);
  const n = Math.max(1, Math.ceil(seconds));
  const lineW = line !== '' ? textWidth(hud, line, px) : 0;
  const w = Math.max(numberWidth(display, n, 0, bigPx), lineW) + pad * 4;
  const h = capBig + (lineW > 0 ? gap * 2 + cap : 0) + pad * 4;
  const x = Math.round((width - w) / 2);
  const y = Math.round(height * 0.32 - h / 2);
  pushShape(out, x, y, Math.round(w), Math.round(h), COLORS.hudFundo, Math.round(6 * s));
  paintNumber(out, display, n, 0, width / 2, y + pad * 2, bigPx, COLORS.acao, 0.5);
  if (lineW > 0) paintText(out, hud, line, width / 2, y + pad * 2 + capBig + gap * 2, px, COLORS.texto, 0, 0.5);
}
