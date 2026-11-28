import { pushRect, pushShape, type DrawList } from '../draw-list.ts';
import type { MsdfFont, UiFonts } from '../font.ts';
import { enterProgress, enterSlidePx, fadeCommands } from '../motion.ts';
import { capHeightPx, fitTextPx, numberWidth, paintNumber, paintText, textWidth } from '../paint.ts';
import { t } from '../text.ts';
import { COLORS, MOTION, TEAM_COLORS, withAlpha } from '../tokens.ts';
import {
  HUD_METRICS,
  hudLabelPx,
  hudNumberPx,
  hudSharedPlateHeight,
  scaleCommands,
  type HudScreenLayout,
} from './hud.ts';

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
  /** M12 (fase 2): a linha é sua (um jogador local matou ou morreu): fundo âmbar a 18% e a arma em âmbar. */
  readonly mine?: boolean[];
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
    mine: new Array<boolean>(n).fill(false),
  };
}

/** Põe uma morte no alto do feed (a mais velha sai se estiver cheio). M12 (fase 2): `mine` = a linha é sua. */
export function pushKillFeed(
  m: KillFeedModel,
  killer: string,
  killerColor: number,
  weapon: string,
  victim: string,
  victimColor: number,
  headshot: boolean,
  mine = false,
): void {
  const last = Math.min(m.count, KILL_FEED_MAX - 1);
  const own = m.mine;
  for (let i = last; i > 0; i--) {
    m.killer[i] = m.killer[i - 1]!;
    m.weapon[i] = m.weapon[i - 1]!;
    m.victim[i] = m.victim[i - 1]!;
    m.killerColor[i] = m.killerColor[i - 1]!;
    m.victimColor[i] = m.victimColor[i - 1]!;
    m.headshot[i] = m.headshot[i - 1]!;
    m.age[i] = m.age[i - 1]!;
    if (own !== undefined) own[i] = own[i - 1]!;
  }
  m.killer[0] = killer;
  m.weapon[0] = weapon;
  m.victim[0] = victim;
  m.killerColor[0] = killerColor;
  m.victimColor[0] = victimColor;
  m.headshot[0] = headshot;
  m.age[0] = 0;
  if (own !== undefined) own[0] = mine;
  m.count = Math.min(m.count + 1, KILL_FEED_MAX);
}

/** Envelhece as linhas e tira as que passaram do tempo (as mais velhas ficam no fim). */
export function ageKillFeed(m: KillFeedModel, dt: number): void {
  for (let i = 0; i < m.count; i++) m.age[i] = m.age[i]! + dt;
  while (m.count > 0 && m.age[m.count - 1]! >= KILL_FEED_SHOW_S) m.count--;
}

/** M12 (fase 2): a largura só do texto da linha `i` do feed em `px` (sem os vãos e o respiro). */
function feedTextWidth(font: MsdfFont | null, m: Readonly<KillFeedModel>, i: number, px: number): number {
  return textWidth(font, m.killer[i]!, px) + textWidth(font, m.weapon[i]!, px) + textWidth(font, m.victim[i]!, px);
}

/**
 * Desenha o feed a partir de `top`: "Matador  arma  Vítima" (sem matador, "Vítima  causa"). `scale` e `minTextPx` como
 * os da HUD da vista. M12 (fase 2): alinhado à direita em `x` (`align` 1) ou à esquerda (0, o cruzamento do 3–4P);
 * no máximo `maxLines` linhas e `maxWidth` px (o texto encolhe até o piso para não passar da plaquinha do placar); a
 * sua linha com fundo âmbar a 18% e a arma em âmbar (uma regra só: nas outras, cinza); o tiro na cabeça, um quadradinho
 * âmbar antes da vítima; a linha nova entra com 8 px em 150 ms (instantânea com `reduce`).
 */
export function drawKillFeed(
  out: DrawList,
  fonts: UiFonts | null,
  m: Readonly<KillFeedModel>,
  x: number,
  top: number,
  scale: number,
  minTextPx: number,
  maxLines: number = KILL_FEED_MAX,
  maxWidth = Number.POSITIVE_INFINITY,
  reduce = false,
  align: 0 | 1 = 1,
): void {
  const n = Math.min(m.count, Math.max(0, maxLines));
  if (n === 0) return;
  const font: MsdfFont | null = fonts?.hud ?? null;
  const px0 = hudLabelPx(scale, minTextPx);
  const pad = Math.max(3, Math.round(HUD_METRICS.pad * scale));
  const gap = Math.max(3, Math.round(HUD_METRICS.gap * scale));
  // A linha mais comprida cabe em `maxWidth` (o texto escala com o tamanho; os vãos e o respiro, não).
  let px = px0;
  if (maxWidth < Number.POSITIVE_INFINITY) {
    let widest = 0;
    for (let i = 0; i < n; i++) widest = Math.max(widest, feedTextWidth(font, m, i, px0));
    const room = maxWidth - pad * 2 - gap * 3;
    if (widest > room && widest > 0) px = Math.max(Math.min(minTextPx, px0), (px0 * Math.max(0, room)) / widest);
  }
  const cap = capHeightPx(font, px);
  const h = Math.round(cap + pad * 2);
  const pip = Math.max(2, Math.round(cap * 0.45));
  const own = m.mine;
  let y = Math.round(top);
  for (let i = 0; i < n; i++) {
    const fade = Math.min(1, KILL_FEED_SHOW_S - m.age[i]!);
    const mine = own !== undefined && own[i] === true;
    const head = m.headshot[i] === true;
    const killer = m.killer[i]!;
    const kw = killer !== '' ? textWidth(font, killer, px) + gap : 0;
    const ww = textWidth(font, m.weapon[i]!, px);
    const vw = textWidth(font, m.victim[i]!, px) + (head && killer !== '' ? pip + gap / 2 : 0);
    const w = kw + ww + gap + vw;
    const lx = Math.round(align === 1 ? x - w - pad * 2 : x);
    const n0 = out.count;
    pushShape(out, lx, y, Math.round(w + pad * 2), h, withAlpha(COLORS.hudFundo, 0.7 * fade), Math.round(4 * scale));
    if (mine) {
      pushShape(out, lx, y, Math.round(w + pad * 2), h, withAlpha(COLORS.acao, 0.18 * fade), Math.round(4 * scale));
    }
    const weaponColor = withAlpha(mine ? COLORS.acao : COLORS.textoBaixo, fade);
    let tx = lx + pad;
    if (killer !== '') {
      tx += paintText(out, font, killer, tx, y + pad, px, withAlpha(m.killerColor[i]!, fade)) + gap;
      tx += paintText(out, font, m.weapon[i]!, tx, y + pad, px, weaponColor) + gap;
      if (head) {
        pushRect(out, Math.round(tx), Math.round(y + pad + (cap - pip) / 2), pip, pip, withAlpha(COLORS.acao, fade));
        tx += pip + gap / 2;
      }
      paintText(out, font, m.victim[i]!, tx, y + pad, px, withAlpha(m.victimColor[i]!, fade));
    } else {
      tx += paintText(out, font, m.victim[i]!, tx, y + pad, px, withAlpha(m.victimColor[i]!, fade)) + gap;
      paintText(out, font, m.weapon[i]!, tx, y + pad, px, weaponColor);
    }
    const p = enterProgress(m.age[i]! * 1000, MOTION.enterMs, reduce);
    if (p < 1) fadeCommands(out, n0, p, enterSlidePx(p) * scale * (align === 1 ? 1 : -1), 0);
    y += h + Math.round(gap / 2);
  }
}

/** M12 (fase 2): a altura de `lines` linhas do feed (o `game` centra as 2 do 3–4P no cruzamento). */
export function killFeedHeight(fonts: UiFonts | null, lines: number, scale: number, minTextPx: number): number {
  if (lines <= 0) return 0;
  const font: MsdfFont | null = fonts?.hud ?? null;
  const pad = Math.max(3, Math.round(HUD_METRICS.pad * scale));
  const gap = Math.max(3, Math.round(HUD_METRICS.gap * scale));
  const h = Math.round(capHeightPx(font, hudLabelPx(scale, minTextPx)) + pad * 2);
  return lines * h + (lines - 1) * Math.round(gap / 2);
}

// --- Placar do Tab -----------------------------------------------------------------------------------------------

/** Linhas do placar (o motor vai até 64 bots + 4 humanos; o placar mostra até 40). */
export const SCOREBOARD_MAX_ROWS = 40;

export interface ScoreboardModel {
  /** Nome do modo ("Bobo Warfare: Times"), por referência. */
  title: string;
  /** M8 (fase 5): a linha embaixo do título ("Diretor: bots –½"); `''` = sem a linha. */
  note: string;
  /** 0 = FFA (uma lista só); 2 = TDM. M9 (fase 3): até 4 (o Sandbox). */
  teamCount: number;
  readonly teamScores: number[];
  /**
   * M9 (fase 3): o nome de cada time no cabeçalho da tabela dele, depois dos pontos (o do Sandbox, ou o da cor; `''` =
   * sem nome). Encolhe para caber na coluna dos nomes. O `game` preenche uma vez.
   */
  readonly teamNames: string[];
  /** M10 (fase 8): a cor de cada time (RGBA): a do `TEAM_COLORS`, ou a que o Sandbox escolheu. O `game` preenche uma vez. */
  readonly teamColors: number[];
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
    note: '',
    teamCount: 0,
    teamScores: [0, 0, 0, 0],
    teamNames: ['', '', '', ''],
    teamColors: TEAM_COLORS.slice(0, 4),
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
  const teamTables = m.teamCount > 0 ? m.teamCount : 1;
  // Legenda das regras: a maior entre os times (lado a lado) ou a de cada um (empilhados).
  const rulePx = px * 0.8;
  const ruleCap = capHeightPx(font, rulePx);
  const ruleH = Math.round(ruleCap + gap);
  // A placa da legenda: o respiro da tabela (`pad`) em cima e embaixo das linhas.
  const plateH = (n: number): number => Math.round(pad * 2 + (n - 1) * ruleH + ruleCap);
  const footer = (n: number): number => (n > 0 ? gap + plateH(n) : 0);
  const titleCap = capHeightPx(font, titlePx);
  // Uma tabela por time: lado a lado se couber, senão empilhadas. M9 (fase 3): 3 ou 4 tabelas (o Sandbox) vão numa grade
  // de 2 colunas; se nem assim couberem na altura (a tela pequena), uma lista só, com a cor do time em cada linha e os
  // pontos dos times no cabeçalho (`merged`).
  let tables = teamTables;
  let maxRows = 0;
  let tableH = 0;
  let cols = 1;
  let gridRows = 1;
  let tablesH = 0;
  for (;;) {
    maxRows = 0;
    for (let tIdx = 0; tIdx < tables; tIdx++) {
      let n = 0;
      for (let r = 0; r < m.rowCount; r++) if (tables === 1 || m.team[r] === tIdx) n++;
      if (n > maxRows) maxRows = n;
    }
    tableH = rowH * (maxRows + 1) + pad * 2 + gap;
    const sideBySide = tables === 1 || tableW * tables + gap * 2 * (tables - 1) <= width - pad * 4;
    cols = sideBySide ? tables : tables > 2 && tableW * 2 + gap * 2 <= width - pad * 4 ? 2 : 1;
    gridRows = Math.ceil(tables / cols);
    tablesH = titleCap + gap * 2 + tableH * gridRows + gap * (gridRows - 1);
    if (tables > 2 && tablesH > height - pad * 2) tables = 1;
    else break;
  }
  // M12 (fase 2, playtest): o placar não cobre o relógio (começa embaixo da plaquinha do alto) e, com mais linhas do que
  // cabem (os 24 bobos do Royale), mostra as primeiras e a sua.
  const topReserve = Math.round(hudSharedPlateHeight(s, minTextPx) + HUD_METRICS.marginY * s + gap);
  const roomH = height - pad * 2 - topReserve;
  let rowLimit = maxRows;
  if (tablesH > roomH && maxRows > 1) {
    const perTable = (roomH - titleCap - gap * 2 - gap * (gridRows - 1)) / gridRows;
    rowLimit = Math.max(1, Math.min(maxRows, Math.floor((perTable - pad * 2 - gap) / rowH) - 1));
    tableH = rowH * (rowLimit + 1) + pad * 2 + gap;
    tablesH = titleCap + gap * 2 + tableH * gridRows + gap * (gridRows - 1);
  }
  const merged = tables === 1 && teamTables > 1;
  const totalW = tableW * cols + gap * 2 * (cols - 1);
  // M8 (fase 5): a linha do Diretor de Partida embaixo do título; sem espaço (o placar cheio numa tela pequena), na
  // ponta direita da linha do título.
  const noteLine = m.note !== '' ? Math.round(ruleCap + gap) : 0;
  const noteH = tablesH + noteLine <= height - pad * 2 ? noteLine : 0;
  const baseH = tablesH + noteH;
  // Quantas linhas de legenda cabem por tabela no que sobra da tela (numa tela pequena com o placar cheio, as de baixo
  // ficam de fora; a tela de morte ainda mostra as regras de quem matou).
  const spare = height - pad * 2 - baseH;
  let ruleLimit = 0;
  for (let tIdx = 0; tIdx < tables; tIdx++) ruleLimit = Math.max(ruleLimit, rulesOf(m, tables, tIdx));
  while (ruleLimit > 0 && gridRows * footer(ruleLimit) > spare) ruleLimit--;
  const shown = (tIdx: number): number => Math.min(ruleLimit, rulesOf(m, tables, tIdx));
  // A legenda de uma fileira da grade: a maior entre as tabelas dela.
  const rowFooter = (row: number): number => {
    let f = 0;
    for (let tIdx = row * cols; tIdx < Math.min(tables, (row + 1) * cols); tIdx++) f = Math.max(f, footer(shown(tIdx)));
    return f;
  };
  let legendH = 0;
  for (let row = 0; row < gridRows; row++) legendH += rowFooter(row);
  const totalH = baseH + legendH;
  const x0 = Math.round((width - totalW) / 2);
  let y0 = Math.round(Math.max(pad, (height - totalH) / 2));
  if (y0 < topReserve && topReserve + totalH + pad <= height) y0 = topReserve;
  pushRect(out, 0, 0, width, height, withAlpha(COLORS.bunker, 0.45));
  if (m.note !== '' && noteH === 0) {
    // Na mesma linha: o título à esquerda e o aviso à direita, na largura das tabelas (ou na que os dois pedem).
    const want = textWidth(font, m.title, titlePx, 0.04) + gap * 2 + textWidth(font, m.note, rulePx, 0.04);
    const span = Math.min(width - pad * 2, Math.max(totalW, want));
    const left = Math.round((width - span) / 2);
    paintText(out, font, m.title, left, y0, titlePx, COLORS.texto, 0.04);
    paintText(out, font, m.note, left + span, y0 + titleCap - ruleCap, rulePx, COLORS.acao, 0.04, 1);
  } else paintText(out, font, m.title, width / 2, y0, titlePx, COLORS.texto, 0.04, 0.5);
  y0 += Math.round(titleCap + gap * 2);
  if (noteH > 0) {
    paintText(out, font, m.note, width / 2, y0, rulePx, COLORS.acao, 0.04, 0.5);
    y0 += noteH;
  }
  let stackY = y0;
  for (let tIdx = 0; tIdx < tables; tIdx++) {
    const col = tIdx % cols;
    const tx0 = x0 + col * (tableW + gap * 2);
    const ty0 = stackY;
    // A fileira seguinte começa depois da tabela mais a maior legenda desta fileira.
    if (col === cols - 1 || tIdx === tables - 1) stackY += tableH + gap + rowFooter(Math.floor(tIdx / cols));
    const color = tables > 1 ? (m.teamColors[tIdx] ?? COLORS.texto) : COLORS.acao;
    pushShape(out, tx0, ty0, tableW, tableH, COLORS.hudFundo, Math.round(5 * s));
    pushRect(out, tx0, ty0, tableW, Math.max(2, Math.round(2 * s)), color);
    // Cabeçalho: os pontos do time (TDM) e os nomes das colunas.
    const hy = ty0 + pad;
    if (tables > 1) {
      const scoreW = paintNumber(out, font, m.teamScores[tIdx] ?? 0, 0, tx0 + pad, hy, px, color);
      // M9 (fase 3): o nome do time depois dos pontos, encolhido para caber na coluna dos nomes.
      const name = m.teamNames[tIdx] ?? '';
      if (name !== '') {
        const room = nameW - scoreW - gap;
        const namePx = fitTextPx(font, name, px * 0.85, 0, room, px * 0.55);
        paintText(out, font, name, tx0 + pad + scoreW + gap, hy + cap - capHeightPx(font, namePx), namePx, color);
      }
    } else if (merged) {
      // M9 (fase 3): a lista só dos times: os pontos de cada time, na cor dele, no lugar do "JOGADOR".
      let pen = tx0 + pad;
      for (let k = 0; k < teamTables; k++) {
        pen += paintNumber(out, font, m.teamScores[k] ?? 0, 0, pen, hy, px, m.teamColors[k] ?? COLORS.texto) + gap * 2;
      }
    } else paintText(out, font, tx.player, tx0 + pad, hy, px * 0.85, COLORS.textoBaixo, 0.08);
    const colX = (k: number): number => tx0 + pad + nameW + gap + k * (numW + gap) + numW;
    paintText(out, font, tx.kills, colX(0), hy, px * 0.85, COLORS.textoBaixo, 0.08, 1);
    paintText(out, font, tx.deaths, colX(1), hy, px * 0.85, COLORS.textoBaixo, 0.08, 1);
    paintText(out, font, tx.assists, colX(2), hy, px * 0.85, COLORS.textoBaixo, 0.08, 1);
    let ry = hy + rowH + gap;
    // M12 (fase 2): as linhas dos jogadores locais que passam do limite entram no lugar das últimas que cabem (revisão:
    // todos eles, no sofá). `top` = quantas linhas de cima ficam: o limite menos os locais que sobram embaixo dele.
    let top = rowLimit;
    for (let pass = 0; pass < 4; pass++) {
      let beyond = 0;
      for (let r = 0, k = 0; r < m.rowCount; r++) {
        if (tables > 1 && m.team[r] !== tIdx) continue;
        if (m.local[r] === 1 && k >= top) beyond++;
        k++;
      }
      const next = Math.max(0, rowLimit - beyond);
      if (next === top) break;
      top = next;
    }
    for (let r = 0, k = -1; r < m.rowCount; r++) {
      if (tables > 1 && m.team[r] !== tIdx) continue;
      k++;
      const fits = k < top || m.local[r] === 1;
      if (!fits) continue;
      if (m.local[r] === 1) pushRect(out, tx0 + 2, ry - pad * 0.5, tableW - 4, rowH, withAlpha(COLORS.acao, 0.18));
      // M9 (fase 3): na lista só, a cor do time na ponta da linha.
      if (merged)
        pushRect(out, tx0 + 2, ry, Math.max(2, Math.round(2 * s)), cap, m.teamColors[m.team[r]!] ?? COLORS.texto);
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

/**
 * M8 (fase 5): o ajuste do Diretor em quartos de nível como o placar mostra: "+¼", "–½", "+1", "±0" (o travessão – e
 * as frações ¼ ½ ¾ estão na fonte do HUD).
 */
export function directorShiftText(quarters: number): string {
  if (quarters === 0) return '±0';
  const a = Math.abs(quarters);
  const whole = Math.floor(a / 4);
  const frac = ['', '¼', '½', '¾'][a % 4]!;
  return (quarters > 0 ? '+' : '–') + (whole > 0 ? String(whole) : '') + frac;
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
  /** M8 (fase 4): uma 2ª linha em âmbar (o "Seu Nêmesis voltou"); `''` = nenhuma. */
  extra = '',
  /** M12 (fase 2): "Reduzir efeitos" (o número entra sem a escala). */
  reduce = false,
  /** M12 (fase 2, playtest): a altura do centro da plaquinha (fração da tela; no toque, mais baixo que as dicas). */
  centerFrac = COUNTDOWN_CENTER,
): void {
  const s = Math.min(width / 640, height / 360);
  const display: MsdfFont | null = fonts?.display ?? null;
  const hud: MsdfFont | null = fonts?.hud ?? null;
  const bigPx = Math.max(hudNumberPx(s, minTextPx) * 3, minTextPx);
  const pad = Math.max(3, Math.round(HUD_METRICS.pad * s));
  const gap = Math.max(3, Math.round(HUD_METRICS.gap * s));
  // M8 (fase 4): a linha mais comprida cabe na tela (encolhe até o piso de texto).
  const px0 = hudLabelPx(s, minTextPx) * 1.2;
  const widest = Math.max(line !== '' ? textWidth(hud, line, px0) : 0, extra !== '' ? textWidth(hud, extra, px0) : 0);
  const px = widest > width - pad * 8 ? Math.max(minTextPx, (px0 * (width - pad * 8)) / widest) : px0;
  const capBig = capHeightPx(display, bigPx);
  const cap = capHeightPx(hud, px);
  const n = Math.max(1, Math.ceil(seconds));
  const lineW = line !== '' ? textWidth(hud, line, px) : 0;
  const extraW = extra !== '' ? textWidth(hud, extra, px) : 0;
  const w = Math.max(numberWidth(display, n, 0, bigPx), lineW, extraW) + pad * 4;
  const h = capBig + (lineW > 0 ? gap * 2 + cap : 0) + (extraW > 0 ? gap * 2 + cap : 0) + pad * 4;
  const x = Math.round((width - w) / 2);
  const y = Math.round(height * centerFrac - h / 2);
  pushShape(out, x, y, Math.round(w), Math.round(h), COLORS.hudFundo, Math.round(6 * s));
  // M12 (fase 2): cada segundo entra com escala 1,2 → 1 em 150 ms (o tempo dentro do segundo sai de `seconds`).
  const n0 = out.count;
  paintNumber(out, display, n, 0, width / 2, y + pad * 2, bigPx, COLORS.acao, 0.5);
  const into = Math.max(0, n - seconds) * 1000;
  scaleCommands(
    out,
    n0,
    width / 2,
    y + pad * 2 + capBig / 2,
    1 + 0.2 * (1 - enterProgress(into, MOTION.enterMs, reduce)),
  );
  let ty = y + pad * 2 + capBig + gap * 2;
  if (lineW > 0) {
    paintText(out, hud, line, width / 2, ty, px, COLORS.texto, 0, 0.5);
    ty += cap + gap * 2;
  }
  if (extraW > 0) paintText(out, hud, extra, width / 2, ty, px, COLORS.acao, 0, 0.5);
}

/** M12 (fase 2): o centro da plaquinha da contagem, do "VALENDO!" e do aviso central no 1P (fração da altura). */
export const COUNTDOWN_CENTER = 0.32;
/** M12 (fase 2): quanto tempo o "VALENDO!" e o aviso central ficam (s) e quanto o aviso leva para sumir no fim. */
export const GO_SHOW_S = 0.6;
export const NOTICE_SHOW_S = 1.5;
const NOTICE_FADE_S = 0.2;

/**
 * M12 (fase 2): o "VALENDO!" depois do fim da contagem (a da partida e a da onda do Zombies), em âmbar na fonte display,
 * no lugar do número, por `GO_SHOW_S`; entra com a escala 1,2 → 1 em 150 ms (sem ela com `reduce`).
 */
export function drawMatchGo(
  out: DrawList,
  fonts: UiFonts | null,
  text: string,
  ageS: number,
  width: number,
  height: number,
  minTextPx: number,
  reduce = false,
  centerFrac = COUNTDOWN_CENTER,
): void {
  if (text === '' || ageS < 0 || ageS >= GO_SHOW_S) return;
  const s = Math.min(width / 640, height / 360);
  const display: MsdfFont | null = fonts?.display ?? null;
  const pad = Math.max(3, Math.round(HUD_METRICS.pad * s));
  const px = fitTextPx(
    display,
    text,
    Math.max(hudNumberPx(s, minTextPx) * 2, minTextPx),
    0.02,
    width - pad * 8,
    minTextPx,
  );
  const cap = capHeightPx(display, px);
  const w = textWidth(display, text, px, 0.02) + pad * 4;
  const h = cap + pad * 4;
  const x = Math.round((width - w) / 2);
  const y = Math.round(height * centerFrac - h / 2);
  const n0 = out.count;
  pushShape(out, x, y, Math.round(w), Math.round(h), COLORS.hudFundo, Math.round(6 * s));
  paintText(out, display, text, width / 2, y + pad * 2, px, COLORS.acao, 0.02, 0.5);
  scaleCommands(out, n0, width / 2, y + h / 2, 1 + 0.2 * (1 - enterProgress(ageS * 1000, MOTION.enterMs, reduce)));
}

/**
 * M12 (fase 2): o aviso central de um momento da partida (MORTE SÚBITA, a onda, a rodada, a Boom Box, a zona, o Jugg
 * novo), na fonte display, por `NOTICE_SHOW_S`: entra seco (150 ms, 8 px; instantâneo com `reduce`) e some nos
 * últimos 0,2 s. Centrado em `cx` e, no alto, em `cy` (`valign` 0,5 = o meio; 0 = o topo), no máximo `maxW` de largura;
 * `small` = o do 3–4P (no cruzamento). Devolve a altura (0 = nada).
 */
export function drawCenterNotice(
  out: DrawList,
  fonts: UiFonts | null,
  text: string,
  ageS: number,
  cx: number,
  cy: number,
  maxW: number,
  scale: number,
  minTextPx: number,
  small = false,
  reduce = false,
  valign = 0.5,
  /** Revisão: 0,5 = centrado em `cx`; 1 = a borda direita em `cx` (à esquerda do placar do cruzamento). */
  halign = 0.5,
  /** Revisão: a borda esquerda nunca antes disto (o aviso comprido no piso do texto não sai da tela). */
  minLeft = 0,
): number {
  if (text === '' || ageS < 0 || ageS >= NOTICE_SHOW_S) return 0;
  const pad = Math.max(3, Math.round(HUD_METRICS.pad * scale));
  const px0 = small ? hudLabelPx(scale, minTextPx) * 1.2 : Math.max(hudNumberPx(scale, minTextPx) * 1.3, minTextPx);
  // A fonte display (larga); sem caber nem no piso (o aviso comprido num espaço pequeno), a do HUD (estreita).
  let display: MsdfFont | null = fonts?.display ?? null;
  let px = fitTextPx(display, text, px0, 0.04, maxW - pad * 4, minTextPx);
  if (textWidth(display, text, px, 0.04) > maxW - pad * 4 && fonts !== null) {
    display = fonts.hud;
    px = fitTextPx(display, text, px0, 0.04, maxW - pad * 4, minTextPx);
  }
  const cap = capHeightPx(display, px);
  const w = textWidth(display, text, px, 0.04) + pad * 4;
  const h = Math.round(cap + pad * 3);
  const x = Math.round(Math.max(minLeft, cx - w * halign));
  const y = Math.round(cy - h * valign);
  const n0 = out.count;
  pushShape(out, x, y, Math.round(w), h, COLORS.hudFundo, Math.round(6 * scale));
  const line = Math.max(2, Math.round(1.5 * scale));
  pushRect(out, x, y + h - line, Math.round(w), line, COLORS.acao);
  paintText(out, display, text, x + w / 2, y + Math.round(pad * 1.5), px, COLORS.texto, 0.04, 0.5);
  const p = enterProgress(ageS * 1000, MOTION.enterMs, reduce);
  const out01 = Math.min(1, (NOTICE_SHOW_S - ageS) / NOTICE_FADE_S);
  const a = Math.min(p, out01);
  if (a < 1) fadeCommands(out, n0, a, 0, enterSlidePx(p) * scale);
  return h;
}

/** M12 (fase 2, revisão): onde vão o kill feed e o aviso central neste quadro (o `game` desenha com estes números). */
export interface OverlayPlace {
  feedX: number;
  feedTop: number;
  feedLines: number;
  feedMaxW: number;
  feedAlign: 0 | 1;
  feedScale: number;
  noticeX: number;
  noticeY: number;
  noticeMaxW: number;
  noticeHAlign: number;
  noticeVAlign: number;
  noticeSmall: boolean;
  noticeScale: number;
  noticeMinX: number;
}

export function createOverlayPlace(): OverlayPlace {
  return {
    feedX: 0,
    feedTop: 0,
    feedLines: KILL_FEED_MAX,
    feedMaxW: Number.POSITIVE_INFINITY,
    feedAlign: 1,
    feedScale: 1,
    noticeX: 0,
    noticeY: 0,
    noticeMaxW: 0,
    noticeHAlign: 0.5,
    noticeVAlign: 0.5,
    noticeSmall: false,
    noticeScale: 1,
    noticeMinX: 0,
  };
}

/** A largura que a linha mais comprida do feed pede em `px` (com o respiro, os vãos e o quadradinho da cabeça). */
function feedWidthAt(
  font: MsdfFont | null,
  m: Readonly<KillFeedModel>,
  lines: number,
  px: number,
  scale: number,
): number {
  const pad = Math.max(3, Math.round(HUD_METRICS.pad * scale));
  const gap = Math.max(3, Math.round(HUD_METRICS.gap * scale));
  let widest = 0;
  for (let i = 0; i < Math.min(m.count, lines); i++) widest = Math.max(widest, feedTextWidth(font, m, i, px));
  return widest + pad * 2 + gap * 3 + capHeightPx(font, px);
}

/**
 * M12 (fase 2, revisão): o lugar do kill feed e do aviso central, pelo layout das vistas e pela plaquinha do placar
 * (`plate`: x, y, largura, altura e o pé de tudo o que vem embaixo dela, de `drawHudShared`; largura 0 = nenhuma).
 * - 1P: o feed no alto à direita, sem passar da plaquinha; se nem no piso do texto ele cabe ao lado dela (o placar de 4
 *   times), desce para baixo do bloco do placar. O aviso no meio, a 32% da altura.
 * - 2P e 4P: o feed (1–2P no alto à direita; 4P em 2 linhas à direita da plaquinha do cruzamento) e o aviso menor à
 *   esquerda da plaquinha, dentro da faixa do cruzamento.
 * - 3P: os dois dentro do quadrante livre: o aviso no alto (embaixo do placar, `spareTop`) e o feed no pé.
 * `touchTop`/`touchBottom` (px): no toque destro, o feed fica entre os botões de cima e os de baixo.
 */
export function placeOverlay(
  out: OverlayPlace,
  fonts: UiFonts | null,
  feed: Readonly<KillFeedModel>,
  lay: HudScreenLayout,
  plate: Float32Array,
  spareTop: number,
  width: number,
  height: number,
  minTextPx: number,
  touchTop = 0,
  touchBottom = 0,
): OverlayPlace {
  const font: MsdfFont | null = fonts?.hud ?? null;
  const hs = Math.min(width / 640, height / 360);
  const v0 = lay.views[0]!;
  const vs = v0.scale;
  const area = lay.shared;
  const views = lay.views.length;
  const hasPlate = plate[2]! > 0;
  const plateLeft = plate[0]!;
  const plateRight = plate[0]! + plate[2]!;
  const blockBottom = Math.max(plate[1]! + plate[3]!, plate.length > 4 ? plate[4]! : 0);
  out.noticeMinX = HUD_METRICS.marginX * (views >= 2 ? vs : hs);
  if (area.mode === 'spare') {
    const gap = Math.max(3, Math.round(HUD_METRICS.gap * vs));
    out.feedScale = vs;
    out.feedAlign = 1;
    out.feedLines = 2;
    out.feedX = area.x + area.width - gap;
    out.feedMaxW = area.width - gap * 2;
    out.feedTop = area.y + area.height - killFeedHeight(fonts, Math.min(2, feed.count), vs, minTextPx) - gap;
    out.noticeX = area.x + area.width / 2;
    out.noticeY = area.y + spareTop + gap;
    out.noticeMaxW = area.width - gap * 2;
    out.noticeHAlign = 0.5;
    out.noticeVAlign = 0;
    out.noticeSmall = true;
    out.noticeScale = vs;
    out.noticeMinX = area.x + gap;
    return out;
  }
  if (views >= 3) {
    const gap = Math.max(3, Math.round(HUD_METRICS.gap * vs));
    out.feedScale = vs;
    out.feedAlign = 0;
    out.feedLines = 2;
    out.feedX = hasPlate ? plateRight + gap : width / 2 + gap;
    out.feedMaxW = width - out.feedX - gap;
    out.feedTop = height / 2 - killFeedHeight(fonts, Math.min(2, feed.count), vs, minTextPx) / 2;
  } else {
    const gap = Math.max(3, Math.round(HUD_METRICS.gap * hs));
    const right = width - Math.max(v0.insetRight, HUD_METRICS.marginX * hs);
    let top = Math.max(v0.insetTop, HUD_METRICS.marginY * hs, touchTop);
    let maxW = area.mode === 'top' && hasPlate ? right - plateRight - gap : width * 0.45;
    if (area.mode === 'top' && hasPlate && feed.count > 0) {
      const floor = Math.min(minTextPx, hudLabelPx(hs, minTextPx));
      if (feedWidthAt(font, feed, KILL_FEED_MAX, floor, hs) > maxW) {
        top = Math.max(top, blockBottom + gap);
        maxW = right - width / 2;
      }
    }
    let lines = KILL_FEED_MAX;
    if (touchBottom > 0) {
      const line = killFeedHeight(fonts, 2, hs, minTextPx) - killFeedHeight(fonts, 1, hs, minTextPx);
      lines = Math.max(1, Math.min(KILL_FEED_MAX, Math.floor((height - touchBottom - top) / Math.max(1, line))));
    }
    out.feedScale = hs;
    out.feedAlign = 1;
    out.feedLines = lines;
    out.feedX = right;
    out.feedTop = top;
    out.feedMaxW = maxW;
  }
  if (views === 1) {
    out.noticeX = width / 2;
    out.noticeY = height * COUNTDOWN_CENTER;
    out.noticeMaxW = width - 32 * hs;
    out.noticeHAlign = 0.5;
    out.noticeVAlign = 0.5;
    out.noticeSmall = false;
    out.noticeScale = hs;
    return out;
  }
  // 2P e 4P: no cruzamento, à esquerda da plaquinha do placar (sem ela, no meio), menor.
  const gap = Math.max(3, Math.round(HUD_METRICS.gap * vs));
  const margin = HUD_METRICS.marginX * vs;
  out.noticeSmall = true;
  out.noticeScale = vs;
  out.noticeVAlign = 0.5;
  out.noticeY = hasPlate ? plate[1]! + plate[3]! / 2 : height / 2;
  if (hasPlate) {
    out.noticeX = plateLeft - gap;
    out.noticeHAlign = 1;
    out.noticeMaxW = Math.min(plateLeft - gap - margin, width * 0.3);
  } else {
    out.noticeX = width / 2;
    out.noticeHAlign = 0.5;
    out.noticeMaxW = width * 0.4;
  }
  return out;
}
