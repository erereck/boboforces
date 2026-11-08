import { pushRect, pushShape, type DrawList } from '../draw-list.ts';
import type { MsdfFont, UiFonts } from '../font.ts';
import { capHeightPx, fitTextPx, paintText, textWidth } from '../paint.ts';
import { t } from '../text.ts';
import { BUTTON, CHAMFER, COLORS, SCREEN_MARGIN, TYPE, uiScale } from '../tokens.ts';
import {
  createHudModel,
  createHudSharedModel,
  drawHud,
  drawHudShared,
  type HudModel,
  type HudSharedArea,
  type HudSharedModel,
  type HudViewport,
} from './hud.ts';

/** Cores de mentira do "mundo" atrás do HUD de amostra (céu e chão do Construto): o HUD nunca aparece sobre o preto. */
const MOCK_SKY = 0x8fc3e8ff;
const MOCK_GROUND = 0x8c8370ff;

interface SpecimenTexts {
  readonly title: string;
  readonly logo: string;
  readonly accents: string;
  readonly play: string;
  readonly quickMatch: string;
  readonly settings: string;
  readonly display: string;
  readonly hud: string;
  readonly sample: string;
  readonly digits: string;
}

let cachedTexts: SpecimenTexts | null = null;

function specimenTexts(): SpecimenTexts {
  if (cachedTexts) return cachedTexts;
  cachedTexts = {
    title: t('fontSpecimen.title').toUpperCase(),
    logo: t('title.logo'),
    accents: t('fontSpecimen.accents').toUpperCase(),
    play: t('menu.play').toUpperCase(),
    quickMatch: t('menu.quickMatch').toUpperCase(),
    settings: t('menu.settings').toUpperCase(),
    display: t('fontSpecimen.display').toUpperCase(),
    hud: t('fontSpecimen.hud').toUpperCase(),
    sample: t('fontSpecimen.sample'),
    digits: t('fontSpecimen.digits'),
  };
  return cachedTexts;
}

/** Linha de origem por fonte, montada só quando a fonte muda (troca de atlas): sem alocação por frame. */
interface SourceLine {
  font: MsdfFont | null;
  text: string;
}

const sourceLines: { display: SourceLine; hud: SourceLine } = {
  display: { font: null, text: '' },
  hud: { font: null, text: '' },
};

function sourceLine(line: SourceLine, font: MsdfFont | null): string {
  if (line.font === font && font !== null) return line.text;
  line.font = font;
  if (!font) line.text = '';
  else if (font.source === '') line.text = font.name;
  else line.text = t('fontSpecimen.source', { name: font.name, source: font.source, license: font.license || '?' });
  return line.text;
}

/** Estado de amostra (pré-alocado uma vez): o mesmo em todo print. */
let sample: { hud: HudModel; shared: HudSharedModel } | null = null;

function sampleState(): { hud: HudModel; shared: HudSharedModel } {
  if (sample) return sample;
  const hud = createHudModel();
  hud.health = 72;
  hud.clip = 24;
  hud.reserve = 90;
  hud.kills = 12;
  hud.deaths = 3;
  hud.hitMarker = 1;
  hud.spread = 0.25;
  hud.damageAngle = Math.PI / 2;
  hud.damageAmount = 0.8;
  hud.playerSlot = 0;
  hud.team = 0;
  const shared = createHudSharedModel();
  shared.timeLeftS = 165;
  shared.teamCount = 2;
  shared.teamScores[0] = 12;
  shared.teamScores[1] = 9;
  sample = { hud, shared };
  return sample;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const mockView: Mutable<HudViewport> = {
  x: 0,
  y: 0,
  width: 640,
  height: 360,
  scale: 1,
  minTextPx: 16,
  insetTop: 0,
  insetRight: 0,
  insetBottom: 0,
  insetLeft: 0,
  // 1P: a combinação real do placar no alto (`mode: 'top'`); com 2 vistas o rótulo P1 encostava no placar a 640×360.
  viewCount: 1,
};

const mockShared: Mutable<HudSharedArea> = {
  mode: 'top',
  x: 0,
  y: 0,
  width: 640,
  height: 360,
  scale: 1,
  minTextPx: 16,
  insetTop: 0,
};

/** Botão de amostra (mesma linguagem do `drawTree`): primário focado ou secundário. */
function paintButton(
  out: DrawList,
  font: MsdfFont | null,
  label: string,
  x: number,
  y: number,
  w: number,
  h: number,
  s: number,
  primary: boolean,
): void {
  const chamfer = Math.round(CHAMFER.button * s);
  if (primary) {
    pushShape(out, x, y, w, h, COLORS.acao, chamfer);
    const ring = Math.max(2, Math.round(BUTTON.focusStroke * s));
    const d = Math.max(2, Math.round(BUTTON.focusGap * s)) + ring;
    pushShape(out, x - d, y - d, w + d * 2, h + d * 2, COLORS.acao, chamfer + d * (2 - Math.SQRT2), ring);
  } else {
    pushShape(out, x, y, w, h, COLORS.chapa, chamfer);
    pushShape(out, x, y, w, h, COLORS.linhaForte, chamfer, Math.max(1, Math.round(BUTTON.stroke * s)));
  }
  const inner = w - BUTTON.padX * s * 2;
  const px = fitTextPx(font, label, Math.max(TYPE.button.size * s, 10), TYPE.button.tracking, inner);
  const capH = capHeightPx(font, px);
  const color = primary ? COLORS.textoSobreAcao : COLORS.texto;
  paintText(out, font, label, x + w / 2, y + (h - capH) / 2, px, color, TYPE.button.tracking, 0.5);
}

/**
 * Folha das fontes EM USO (decisão #54: Russo One no display, só caixa alta; Saira Condensed SemiBold no HUD), em
 * tela cheia de `width`×`height` px da superfície, com o atlas `fonts/ui-fonts.*` de sempre: cabeçalho com a origem de
 * cada fonte (`MsdfFont.name`/`source`/`license`, texto pela chave `fontSpecimen.source`, regra 13), logotipo, título
 * com acentos (a costura do acento composto aparece em tamanho grande), botões, HUD de amostra sobre um "mundo" de
 * mentira, texto corrido e os algarismos nas duas fontes. `fonts` `null` desenha só os retângulos. Sem alocação depois
 * do primeiro frame. Substitui a comparação das candidatas; o `game` abre pelo gancho `showFontSpecimen`.
 */
export function drawFontSpecimen(out: DrawList, fonts: UiFonts | null, width: number, height: number): void {
  const tx = specimenTexts();
  const display = fonts?.display ?? null;
  const hud = fonts?.hud ?? null;
  const s = uiScale(width, height);
  const left = Math.round(SCREEN_MARGIN.x * s);
  const right = Math.round(width - SCREEN_MARGIN.x * s);
  const top = Math.round(SCREEN_MARGIN.y * s);
  const bottom = Math.round(height - SCREEN_MARGIN.y * s);
  const gap = Math.max(4, Math.round(16 * s));
  const maxW = right - left;
  pushRect(out, 0, 0, Math.round(width), Math.round(height), COLORS.bunker);

  // Cabeçalho: título da tela e a origem de cada fonte (nome derivado, fonte de origem e licença).
  const labelPx = Math.max(TYPE.label.size * s, 12);
  const capL = capHeightPx(hud, labelPx);
  let y = top;
  paintText(out, hud, tx.title, left, y, labelPx, COLORS.textoBaixo, TYPE.label.tracking);
  y += Math.round(capL + gap * 0.75);
  const roleW = Math.ceil(
    Math.max(
      textWidth(hud, tx.display, labelPx, TYPE.label.tracking),
      textWidth(hud, tx.hud, labelPx, TYPE.label.tracking),
    ) +
      gap / 2,
  );
  for (let role = 0; role < 2; role++) {
    const font = role === 0 ? display : hud;
    const label = role === 0 ? tx.display : tx.hud;
    const line = sourceLine(role === 0 ? sourceLines.display : sourceLines.hud, font);
    paintText(out, hud, label, left, y, labelPx, COLORS.textoBaixo, TYPE.label.tracking);
    const linePx = fitTextPx(hud, line, labelPx, 0, maxW - roleW);
    paintText(out, hud, line, left + roleW, y + capL - capHeightPx(hud, linePx), linePx, COLORS.texto);
    y += Math.round(capL + gap * 0.75);
  }
  y += Math.round(gap * 0.75);

  // Logotipo em texto (o logo em blocos é outra coisa) no tamanho do título, encolhido só se não couber.
  const logoPx = fitTextPx(display, tx.logo, TYPE.logo.size * s, TYPE.logo.tracking, maxW);
  paintText(out, display, tx.logo, left, y, logoPx, COLORS.texto, TYPE.logo.tracking);
  y += Math.round(capHeightPx(display, logoPx) + gap);
  const barH = Math.max(3, Math.round(10 * s));
  pushShape(out, left, y, Math.round(176 * s), barH, COLORS.acao, Math.round(12 * s));
  y += barH + gap * 2;

  // Título com acentos compostos em caixa alta (a display só tem caixa alta).
  const accentsPx = fitTextPx(display, tx.accents, TYPE.title.size * s, TYPE.title.tracking, maxW);
  paintText(out, display, tx.accents, left, y, accentsPx, COLORS.texto, TYPE.title.tracking);
  y += Math.round(capHeightPx(display, accentsPx) + gap * 1.5);

  // Rodapé: texto corrido com acentos e os algarismos nas duas fontes.
  const bodyPx = Math.max(TYPE.body.size * s, 12);
  const capB = capHeightPx(hud, bodyPx);
  const digitsY = bottom - capB;
  const sampleY = digitsY - capB - gap;
  paintText(out, hud, tx.sample, left, sampleY, fitTextPx(hud, tx.sample, bodyPx, 0, maxW), COLORS.texto);
  let dx = left;
  dx += paintText(out, display, tx.digits, dx, digitsY, bodyPx, COLORS.texto, 0.02) + gap * 2;
  paintText(out, hud, tx.digits, dx, digitsY, bodyPx, COLORS.textoBaixo, 0.02);

  // Meio: botões à esquerda, HUD de amostra à direita (16:9, perto do tamanho de uma vista do 4P em 720p).
  const areaBottom = sampleY - gap * 1.5;
  const buttonW = Math.min(Math.round(380 * s), Math.round(maxW * 0.4));
  const buttonGap = Math.round(14 * s);
  const buttonH = Math.max(
    1,
    Math.min(Math.round(BUTTON.height * s), Math.floor((areaBottom - y - buttonGap * 2) / 3)),
  );
  paintButton(out, display, tx.play, left, y, buttonW, buttonH, s, true);
  paintButton(out, display, tx.quickMatch, left, y + buttonH + buttonGap, buttonW, buttonH, s, false);
  paintButton(out, display, tx.settings, left, y + (buttonH + buttonGap) * 2, buttonW, buttonH, s, false);
  const mockLeft = left + buttonW + gap * 3;
  let mockW = right - mockLeft;
  let mockH = Math.round((mockW * 9) / 16);
  if (mockH > areaBottom - y) {
    mockH = Math.max(0, areaBottom - y);
    mockW = Math.round((mockH * 16) / 9);
  }
  if (mockW <= 0 || mockH <= 0) return;
  const mockX = right - mockW;
  const skyH = Math.round(mockH * 0.55);
  pushRect(out, mockX, y, mockW, skyH, MOCK_SKY);
  pushRect(out, mockX, y + skyH, mockW, mockH - skyH, MOCK_GROUND);
  const state = sampleState();
  mockView.x = mockX;
  mockView.y = y;
  mockView.width = mockW;
  mockView.height = mockH;
  mockView.scale = Math.min(mockW / 640, mockH / 360);
  mockView.minTextPx = 16 * Math.min(1, s * 1.5);
  drawHud(out, fonts, state.hud, mockView);
  mockShared.x = mockX;
  mockShared.y = y;
  mockShared.width = mockW;
  mockShared.height = mockH;
  mockShared.scale = mockView.scale;
  mockShared.minTextPx = mockView.minTextPx;
  drawHudShared(out, fonts, state.shared, mockShared);
}
