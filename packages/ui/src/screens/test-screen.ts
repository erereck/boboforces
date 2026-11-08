import { popClip, pushClip, pushRect, pushShape, type DrawList } from '../draw-list.ts';
import type { MsdfFont, UiFonts } from '../font.ts';
import { capHeightPx, paintIcon, paintText, textWidth } from '../paint.ts';
import type { StringKey } from '../strings.pt-BR.ts';
import { t } from '../text.ts';
import { CHAMFER, COLORS, MIN_TEXT, PLAYER_COLORS, SCREEN_MARGIN, TYPE, uiScale } from '../tokens.ts';

/**
 * Tela genérica de TESTE do M1 (Switch: "aperte A" com os 4 controles, teclado do sistema e áudio; tecnico.md §24.2
 * itens 17–19). A casca (apps/switch) faz a sonda e descreve o que mostrar neste modelo; o `game` desenha com a UI do
 * jogo (sem DOM no game). CONTRATO; desenho da frente "ui-fontes".
 */
export type TestLineStatus = 'ok' | 'fail' | 'info' | 'wait';

export interface TestScreenLine {
  /** Rótulo pela tabela pt-BR (`null` = só o literal). */
  key: StringKey | null;
  /** Dado técnico (índice, styleSet em hex, latência em ms): literal, como no relatório. */
  literal: string;
  status: TestLineStatus;
  /**
   * Acréscimo da frente ui-fontes (opcional, compatível): vaga de jogador 0..3 da linha (tela "aperte A"). Com ela, a
   * linha ganha o ícone e o "P1–P4" na cor do jogador. Ausente ou fora de 0..3 = sem vaga.
   */
  slot?: number;
}

export const TEST_SCREEN_MAX_LINES = 24;

export interface TestScreenModel {
  titleKey: StringKey | null;
  /** Dica do rodapé (ex.: "Segure + e − para voltar"). */
  hintKey: StringKey | null;
  readonly lines: TestScreenLine[];
  lineCount: number;
}

export function createTestScreenModel(): TestScreenModel {
  const lines: TestScreenLine[] = [];
  for (let i = 0; i < TEST_SCREEN_MAX_LINES; i++) lines.push({ key: null, literal: '', status: 'info' });
  return { titleKey: null, hintKey: null, lines, lineCount: 0 };
}

/**
 * O que a tela "aperte A" mostra de um controle (item 17 do T0). O `ControllerInfo` da platform-api cabe aqui; o `ui`
 * não importa a platform-api, por isso o tipo estrutural.
 */
export interface TestControllerInfo {
  readonly index: number;
  readonly styleSet: number;
  readonly deviceType: number;
  readonly complete: boolean;
  readonly canVibrate: boolean;
}

/** Literal técnico de um controle, no estilo das linhas `[t0]`: `indice=0 styleSet=0x3 deviceType=-1 vibra=1`. */
export function controllerLiteral(info: TestControllerInfo): string {
  const style = info.styleSet < 0 ? '-1' : `0x${info.styleSet.toString(16)}`;
  return `indice=${info.index} styleSet=${style} deviceType=${info.deviceType} vibra=${info.canVibrate ? 1 : 0}`;
}

/**
 * Preenche uma linha da tela "aperte A": vaga do jogador (ícone e cor), estado (controle incompleto = falha; entrou =
 * pronto; senão "Aperte A", aguardando) e o literal técnico. Monta string: chame quando o controle muda, não por frame.
 */
export function fillControllerLine(
  line: TestScreenLine,
  info: TestControllerInfo,
  slot: number,
  joined: boolean,
): void {
  line.slot = slot;
  line.literal = controllerLiteral(info);
  if (!info.complete) {
    line.key = 'test.controllers.incomplete';
    line.status = 'fail';
  } else if (joined) {
    line.key = 'test.controllers.ready';
    line.status = 'ok';
  } else {
    line.key = 'test.controllers.pressA';
    line.status = 'wait';
  }
}

/** Medidas em px de referência (1280×720). Linhas em até 3 colunas quando não cabem numa só. */
export const TEST_SCREEN_METRICS = { lineFactor: 1.75, columnGap: 32, chipPad: 10, gap: 14, maxColumns: 3 } as const;

interface TestTexts {
  readonly status: Readonly<Record<TestLineStatus, string>>;
  readonly players: readonly string[];
}

let cachedTexts: TestTexts | null = null;

function testTexts(): TestTexts {
  if (cachedTexts) return cachedTexts;
  cachedTexts = {
    status: {
      ok: t('test.status.ok').toUpperCase(),
      fail: t('test.status.fail').toUpperCase(),
      info: t('test.status.info').toUpperCase(),
      wait: t('test.status.wait').toUpperCase(),
    },
    players: [1, 2, 3, 4].map((n) => t('hud.player', { n })),
  };
  return cachedTexts;
}

const STATUS_ORDER: readonly TestLineStatus[] = ['ok', 'fail', 'info', 'wait'];
const titleCache: { key: StringKey | null; text: string } = { key: null, text: '' };

function statusFill(status: TestLineStatus): number {
  switch (status) {
    case 'ok':
      return COLORS.ok;
    case 'fail':
      return COLORS.perigo;
    case 'wait':
      return COLORS.acao;
    case 'info':
      return COLORS.chapaAlta;
  }
}

/**
 * Desenha a tela de teste em `width`×`height`: título com a barra âmbar, as linhas (selo de status colorido, vaga do
 * jogador quando houver, rótulo e dado técnico) em colunas que cabem na tela, e a dica no rodapé. Cada linha é
 * recortada na própria coluna (dado longo não invade a vizinha). Sem alocação.
 */
export function drawTestScreen(
  out: DrawList,
  fonts: UiFonts | null,
  model: Readonly<TestScreenModel>,
  width: number,
  height: number,
): void {
  const tx = testTexts();
  const M = TEST_SCREEN_METRICS;
  const s = uiScale(width, height);
  const display: MsdfFont | null = fonts?.display ?? null;
  const hud: MsdfFont | null = fonts?.hud ?? null;
  const floor = MIN_TEXT.phone;
  const headingPx = Math.max(TYPE.heading.size * s, floor);
  const bodyPx = Math.max(TYPE.body.size * s, floor);
  const labelPx = Math.max(TYPE.label.size * s * 0.85, floor);
  const captionPx = Math.max(TYPE.caption.size * s, floor);
  const left = Math.round(SCREEN_MARGIN.x * s);
  const right = Math.round(width - SCREEN_MARGIN.x * s);
  const top = Math.round(SCREEN_MARGIN.y * s);
  const bottom = Math.round(height - SCREEN_MARGIN.y * s);
  const gap = Math.max(4, Math.round(M.gap * s));

  pushRect(out, 0, 0, Math.round(width), Math.round(height), COLORS.bunker);

  // Título + barra âmbar (a "fita" das telas).
  let y = top;
  if (model.titleKey !== null) {
    // Caixa alta guardada: o título só vira string nova quando a chave muda.
    if (model.titleKey !== titleCache.key) {
      titleCache.key = model.titleKey;
      titleCache.text = t(model.titleKey).toUpperCase();
    }
    paintText(out, display, titleCache.text, left, y, headingPx, COLORS.texto, TYPE.heading.tracking);
    y += Math.round(capHeightPx(display, headingPx) + gap);
  }
  pushShape(
    out,
    left,
    y,
    Math.round(120 * s),
    Math.max(3, Math.round(8 * s)),
    COLORS.acao,
    Math.round(CHAMFER.card * s),
  );
  y += Math.max(3, Math.round(8 * s)) + gap * 2;

  // Rodapé.
  const capC = capHeightPx(hud, captionPx);
  const hintY = Math.round(bottom - capC);
  if (model.hintKey !== null) paintText(out, hud, t(model.hintKey), left, hintY, captionPx, COLORS.textoBaixo, 0.02);

  // Linhas em colunas.
  const count = Math.max(0, Math.min(Math.trunc(model.lineCount), model.lines.length));
  if (count === 0) return;
  const areaTop = y;
  const areaBottom = hintY - gap * 2;
  const lineH = Math.max(Math.round(bodyPx * M.lineFactor), Math.round(labelPx + gap));
  const rowsPerColumn = Math.max(1, Math.floor((areaBottom - areaTop) / lineH));
  const columns = Math.min(M.maxColumns, Math.ceil(count / rowsPerColumn));
  const columnGap = Math.round(M.columnGap * s);
  const columnW = Math.floor((right - left - columnGap * (columns - 1)) / columns);
  const chipPad = Math.max(4, Math.round(M.chipPad * s));
  let chipW = 0;
  for (let i = 0; i < STATUS_ORDER.length; i++) {
    chipW = Math.max(chipW, textWidth(hud, tx.status[STATUS_ORDER[i] as TestLineStatus], labelPx, 0.1));
  }
  chipW = Math.round(chipW + chipPad * 2);
  const capL = capHeightPx(hud, labelPx);
  const capB = capHeightPx(hud, bodyPx);
  const chipH = Math.round(capL + chipPad);
  const icon = Math.round(capB);

  for (let i = 0; i < count; i++) {
    const line = model.lines[i] as TestScreenLine;
    const column = Math.floor(i / rowsPerColumn);
    if (column >= columns) break;
    const row = i - column * rowsPerColumn;
    const x = left + column * (columnW + columnGap);
    const rowY = areaTop + row * lineH;
    pushClip(out, x, rowY, columnW, lineH);
    const chipY = Math.round(rowY + (capB - chipH) / 2);
    const fill = statusFill(line.status);
    pushShape(out, x, chipY, chipW, chipH, fill, Math.max(2, Math.round(6 * s)));
    // Info é neutro (sem cor de status): a borda separa o selo do fundo.
    if (line.status === 'info') {
      pushShape(
        out,
        x,
        chipY,
        chipW,
        chipH,
        COLORS.linhaForte,
        Math.max(2, Math.round(6 * s)),
        Math.max(1, Math.round(s)),
      );
    }
    paintText(
      out,
      hud,
      tx.status[line.status],
      x + chipW / 2,
      chipY + (chipH - capL) / 2,
      labelPx,
      line.status === 'info' ? COLORS.textoBaixo : COLORS.textoSobreAcao,
      0.1,
      0.5,
    );
    let pen = x + chipW + gap;
    const slot = line.slot;
    if (slot !== undefined && slot >= 0 && slot < 4) {
      const color = PLAYER_COLORS[slot] as number;
      paintIcon(out, slot, pen, rowY, icon, color);
      pen += icon + gap / 2;
      pen += paintText(out, display, tx.players[slot] as string, pen, rowY, bodyPx, color) + gap;
    }
    if (line.key !== null) pen += paintText(out, hud, t(line.key), pen, rowY, bodyPx, COLORS.texto) + gap;
    if (line.literal !== '') paintText(out, hud, line.literal, pen, rowY, bodyPx, COLORS.textoBaixo);
    popClip(out);
  }
}
