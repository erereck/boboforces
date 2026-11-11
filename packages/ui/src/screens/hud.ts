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
  /**
   * M2 (fase 7c): indicador visual de som (arte-ux.md §6.7): até `HUD_SOUND_BLIPS` sons perto (tiros e passos até
   * 20 m), cada um com o ângulo relativo à mira (como `damageAngle`) e a força 0..1. `soundCount` 0 = desligado.
   */
  soundCount: number;
  readonly soundAngle: Float32Array;
  readonly soundAlpha: Float32Array;
  /** Jogador local 0..3 (borda da vista e ícone P1–P4) e time 0..3 (255 = FFA). */
  playerSlot: number;
  team: number;
  /** Abertura da retícula 0..1 (movimento e tiro). */
  spread: number;
  /** Mostrar "Clique para mirar com o mouse" (web, teclado/mouse sem pointer lock). */
  clickToAim: boolean;
  /**
   * M2 (fase 1e): nome da arma na mão ("Rattler") e a categoria ("Fuzil"), já resolvidos na tabela pt-BR uma vez (o
   * `game` guarda as strings; nada é montado por frame). `''` = sem arma.
   */
  weaponName: string;
  weaponCategory: string;
  /** M2: como mostrar a munição (`HUD_AMMO`): nenhuma (faca), só o pente (granada na mão) ou pente / reserva. */
  ammoMode: number;
  /** M2: granadas que sobram no slot (-1 = não mostra: com a granada na mão o número já é o pente). */
  grenades: number;
  /** M2: forma da retícula (`HUD_CROSSHAIR`): cruz, ou ponto (faca, granada, sniper fora da luneta). */
  crosshair: number;
  /** M2: luneta da sniper (0..1; a partir de 0,5 a moldura entra no lugar da retícula). */
  scope: number;
  /**
   * M2 (fase 2c): tela de morte (gameplay.md §5.5). Strings já resolvidas pelo `game` (guardadas por referência):
   * `deathLabel` em cima ("Abatido por"; `''` = sem rótulo), `deathName` (quem matou, ou a causa: "Caiu no vazio"),
   * `deathWeapon` (`''` = não mostra) e `deathHp`, a vida de quem matou (-1 = não mostra).
   */
  deathLabel: string;
  deathName: string;
  deathWeapon: string;
  deathHp: number;
  /** M2 (fecho da fase 3): as regras ativas de quem matou ("500 de vida · só escopeta"; `''` = nenhuma). */
  deathRules: string;
  /**
   * M2 (fase 2c): menu radial da primária do próximo spawn: nomes e categorias (vazio = sem menu, como nas vistas de
   * bot do bench) e a escolhida. No 3–4P vira uma linha só, "« Rattler »".
   */
  primaryNames: readonly string[];
  primaryCategories: readonly string[];
  primarySelected: number;
  /**
   * M3 (fase 2d): Bobo Zombies. `points` ≥ 0 troca a plaquinha do alto para "PONTOS n · ABATES n" (-1 = os outros
   * modos). `downed` (`HUD_DOWNED`) mostra no centro o caído e `downedValue` (segundos até sangrar ou levantar
   * sozinho, ou a porcentagem do reviver). `waitWave`: morto, volta na próxima onda (no lugar do "Renascendo").
   */
  points: number;
  downed: number;
  downedValue: number;
  waitWave: boolean;
  /**
   * M3 (fase 3d): o aviso de interagir embaixo da mira (`HUD_INTERACT`): consertar a janela ou abrir a porta paga por
   * `interactCost` pontos (em vermelho sem `interactAfford`).
   */
  interact: number;
  interactCost: number;
  interactAfford: boolean;
  /** M3 (fase 4a): o nome da arma na parede, já em caixa alta (`HUD_INTERACT.buy`; da tabela, sem criar por quadro). */
  interactName: string;
  /** M2 (fase 2c): mostra a dica da derrota feia ("Tá puxado?") na tela de morte. */
  hardTimeHint: boolean;
  /**
   * M2 (fase 2c): SAÍDA do `drawHud` (o modelo é só leitura, este objeto não): o formato do menu da primária
   * desenhado (`PRIMARY_LAYOUT`) e os retângulos das opções (x, y, largura, altura em px da superfície), para o `game`
   * achar a opção tocada e mover o cursor do jeito certo no próximo quadro.
   */
  readonly primaryHit: PrimaryHit;
  /**
   * M2 (fase 2d): marcadores dos aliados (arte-ux.md §6.7), em cima da cabeça e através das paredes: 2 valores por
   * marcador (x, y em px da superfície, a ponta do chevron) e a cor do time. O `game` projeta; o desenho só pinta.
   */
  readonly markers: Float32Array;
  markerCount: number;
  markerColor: number;
  /**
   * M3 (fase 1d): o jogador local dono de cada marcador (0..3 = P1..P4: o símbolo e a cor dele no lugar do chevron do
   * time); -1 = um bot (o chevron).
   */
  readonly markerSeat: Int8Array;
  /**
   * M2 (fase 3e): avisos dos bots aliados N3 ("inimigo aqui", gameplay.md §6.3): 2 valores por aviso (x, y em px da
   * superfície), desenhados como um losango âmbar através das paredes.
   */
  readonly pings: Float32Array;
  pingCount: number;
  /**
   * M2 (fase 4h): dica de 1 linha das primeiras partidas (gameplay.md §2.5): a tecla ou o botão do dispositivo ativo
   * (desenhado como uma tecla, em âmbar) e o resto do texto ("corre"), já resolvidos pelo `game`; `tipAlpha` 0 = nada.
   */
  tipKey: string;
  tipText: string;
  tipAlpha: number;
}

/** M2 (fase 3e): máximo de avisos do time na vista. */
export const MAX_TEAM_PINGS = 8;

/** M2 (fase 2d): máximo de marcadores de aliado por vista. */
export const MAX_ALLY_MARKERS = 24;

/** M2 (fase 2c): formatos do menu da primária. */
export const PRIMARY_LAYOUT = { none: 0, ring: 1, row: 2, line: 3 } as const;

/** M2 (fase 2c): máximo de opções do menu da primária. */
export const MAX_PRIMARY_OPTIONS = 8;

export interface PrimaryHit {
  layout: number;
  count: number;
  readonly rects: Float32Array;
}

/** Opção do menu da primária sob o ponto (px da superfície, com folga de `slack` px), ou -1. */
export function hitPrimaryOption(hit: PrimaryHit, x: number, y: number, slack = 4): number {
  for (let i = 0; i < hit.count; i++) {
    const o = i * 4;
    const rx = hit.rects[o]!;
    const ry = hit.rects[o + 1]!;
    if (
      x >= rx - slack &&
      x <= rx + hit.rects[o + 2]! + slack &&
      y >= ry - slack &&
      y <= ry + hit.rects[o + 3]! + slack
    ) {
      return i;
    }
  }
  return -1;
}

/** M2: modos da munição no HUD (`HudModel.ammoMode`). */
export const HUD_AMMO = { none: 0, clip: 1, full: 2 } as const;

/** M2: formas da retícula (`HudModel.crosshair`). */
export const HUD_CROSSHAIR = { cross: 0, dot: 1 } as const;

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
    soundCount: 0,
    soundAngle: new Float32Array(HUD_SOUND_BLIPS),
    soundAlpha: new Float32Array(HUD_SOUND_BLIPS),
    playerSlot: 0,
    team: 255,
    spread: 0,
    clickToAim: false,
    weaponName: '',
    weaponCategory: '',
    ammoMode: HUD_AMMO.full,
    grenades: -1,
    crosshair: HUD_CROSSHAIR.cross,
    scope: 0,
    deathLabel: '',
    deathName: '',
    deathWeapon: '',
    deathHp: -1,
    deathRules: '',
    primaryNames: [],
    primaryCategories: [],
    primarySelected: 0,
    points: -1,
    downed: 0,
    downedValue: 0,
    waitWave: false,
    interact: 0,
    interactCost: 0,
    interactAfford: true,
    interactName: '',
    hardTimeHint: false,
    primaryHit: { layout: PRIMARY_LAYOUT.none, count: 0, rects: new Float32Array(MAX_PRIMARY_OPTIONS * 4) },
    markers: new Float32Array(MAX_ALLY_MARKERS * 2),
    markerCount: 0,
    markerColor: COLORS.texto,
    markerSeat: new Int8Array(MAX_ALLY_MARKERS).fill(-1),
    pings: new Float32Array(MAX_TEAM_PINGS * 2),
    pingCount: 0,
    tipKey: '',
    tipText: '',
    tipAlpha: 0,
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
  /** Indicador de som: raio do anel em volta da retícula e lado de cada ponto (px na referência 1280×720). */
  soundRing: 36,
  soundDot: 5,
  /** Borda da vista na cor do jogador (2–4P; arte-ux.md §6.6: 3 px por vista de 640×360). */
  border: 3,
} as const;

/** Quantos sons o indicador visual mostra de uma vez por vista. */
export const HUD_SOUND_BLIPS = 8;

/** Um som no anel: 3 pontos num arco curto na direção dele (frente = cima; positivo = à esquerda, como o yaw). */
function drawSoundBlip(out: DrawList, cx: number, cy: number, angle: number, alpha: number, s: number): void {
  const r = HUD_METRICS.soundRing * s;
  const size = Math.max(2, Math.round(HUD_METRICS.soundDot * s));
  // Contorno escuro como o da retícula: o ponto claro some contra céu e concreto sem ele. Nunca abaixo de 35%.
  const k01 = 0.35 + 0.65 * clamp01(alpha);
  for (let k = -1; k <= 1; k++) {
    const a = angle + k * 0.12;
    const side = k === 0 ? size : Math.max(2, size - 1);
    const x = Math.round(cx - Math.sin(a) * r - side / 2);
    const y = Math.round(cy - Math.cos(a) * r - side / 2);
    pushRect(out, x - 1, y - 1, side + 2, side + 2, withAlpha(COLORS.bunker, 0.6 * k01));
    pushRect(out, x, y, side, side, withAlpha(COLORS.texto, (k === 0 ? 0.95 : 0.7) * k01));
  }
}

/** A plaquinha do alto à esquerda não passa desta fração da largura da vista (o meio é do placar). */
const HUD_CHIP_MAX_FRACTION = 0.36;

/** M3 (fase 2d): o caído na HUD: sangrando (segundos), alguém levantando (%), levantando sozinho (segundos). */
export const HUD_DOWNED = { none: 0, bleeding: 1, reviving: 2, selfUp: 3 } as const;

/** M3 (fase 3d): o aviso de interagir do Bobo Zombies. */
export const HUD_INTERACT = { none: 0, repair: 1, door: 2, buy: 3, buyAmmo: 4, box: 5, boxTake: 6 } as const;

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
  readonly weaponSeparator: string;
  /** M2 (fase 2c): tela de morte. */
  readonly hp: string;
  readonly choose: string;
  readonly hardTime: string;
  readonly cyclePrev: string;
  readonly cycleNext: string;
  readonly suddenDeath: string;
  /** M3 (fase 2d): Bobo Zombies. */
  readonly points: string;
  readonly downed: string;
  readonly reviving: string;
  readonly selfUp: string;
  readonly waitWave: string;
  /** M3 (fase 3d): consertar e `hud.door` cortado em [antes, depois] do preço. */
  readonly repair: string;
  readonly door: readonly string[];
  /** M3 (fase 4a): `hud.buy` cortado em [antes, entre, depois] do nome e do preço; `hud.buyAmmo` como a porta. */
  readonly buy: readonly string[];
  readonly buyAmmo: readonly string[];
  /** M3 (fase 4b): `hud.box` [antes, depois] do preço e `hud.boxTake` [antes, depois] do nome. */
  readonly box: readonly string[];
  readonly boxTake: readonly string[];
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
    weaponSeparator: t('hud.weaponSeparator'),
    hp: ` ${t('death.hp')}`,
    choose: t('death.choose').toUpperCase(),
    hardTime: t('death.hardTime'),
    cyclePrev: t('death.cyclePrev'),
    cycleNext: t('death.cycleNext'),
    suddenDeath: t('hud.suddenDeath').toUpperCase(),
    points: t('hud.points').toUpperCase(),
    downed: t('hud.downed').toUpperCase(),
    reviving: t('hud.reviving').toUpperCase(),
    selfUp: t('hud.selfUp').toUpperCase(),
    waitWave: t('hud.waitWave').toUpperCase(),
    repair: t('hud.repair').toUpperCase(),
    door: templateParts('hud.door', ['cost']).map((p) => p.toUpperCase()),
    buy: templateParts('hud.buy', ['weapon', 'cost']).map((p) => p.toUpperCase()),
    buyAmmo: templateParts('hud.buyAmmo', ['cost']).map((p) => p.toUpperCase()),
    box: templateParts('hud.box', ['cost']).map((p) => p.toUpperCase()),
    boxTake: templateParts('hud.boxTake', ['weapon']).map((p) => p.toUpperCase()),
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

/**
 * Chevron de aliado (ponta para baixo em x, y): 4 fileiras de 7, 5, 3 e 1 `unit`, com sombra de 1 unit. Fora da vista,
 * não desenha.
 */
function drawAllyMarker(out: DrawList, x: number, y: number, unit: number, color: number, view: HudViewport): void {
  const w = unit * 7;
  if (x - w / 2 < view.x || x + w / 2 > view.x + view.width || y - unit * 5 < view.y || y > view.y + view.height)
    return;
  const cx = Math.round(x);
  const top = Math.round(y) - unit * 4;
  const shadow = withAlpha(COLORS.bunker, 0.55);
  for (let k = 0; k < 4; k++) {
    const rw = unit * (7 - 2 * k);
    pushRect(out, cx - rw / 2 - unit / 2, top + k * unit + unit / 2, rw + unit, unit, shadow);
  }
  for (let k = 0; k < 4; k++) {
    const rw = unit * (7 - 2 * k);
    pushRect(out, cx - rw / 2, top + k * unit, rw, unit, color);
  }
}

/**
 * M3 (fase 1d): um jogador local do mesmo time visto por outra vista: o símbolo dele (▲ ● ■ ◆) na cor dele, com sombra,
 * a ponta de baixo em (x, y). Fora da vista, nada.
 */
function drawPlayerMarker(out: DrawList, x: number, y: number, unit: number, seat: number, view: HudViewport): void {
  const size = unit * 7;
  if (x - size / 2 < view.x || x + size / 2 > view.x + view.width || y - size < view.y || y > view.y + view.height)
    return;
  const left = Math.round(x - size / 2);
  const top = Math.round(y) - size;
  paintIcon(out, seat, left + unit / 2, top + unit / 2, size, withAlpha(COLORS.bunker, 0.55));
  paintIcon(out, seat, left, top, size, PLAYER_COLORS[seat] as number);
}

/** Aviso do time (fase 3e): losango âmbar de 7 units com borda escura, centrado em (x, y). Fora da vista, nada. */
function drawPing(out: DrawList, x: number, y: number, unit: number, view: HudViewport): void {
  const r = unit * 3;
  if (x - r < view.x || x + r > view.x + view.width || y - r < view.y || y + r > view.y + view.height) return;
  const cx = Math.round(x);
  const cy = Math.round(y);
  const shadow = withAlpha(COLORS.bunker, 0.6);
  for (let k = -3; k <= 3; k++) {
    const w = (3 - Math.abs(k)) * 2 + 1;
    pushRect(out, cx - (w * unit) / 2 - unit / 2, cy + k * unit - unit / 2, (w + 1) * unit, unit, shadow);
  }
  for (let k = -3; k <= 3; k++) {
    const w = (3 - Math.abs(k)) * 2 + 1;
    pushRect(out, cx - (w * unit) / 2, cy + k * unit - unit / 2, w * unit, unit, COLORS.acao);
  }
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

/** M2: retícula de ponto (faca, granada, sniper fora da luneta), com a mesma sombra da cruz. */
function drawDot(out: DrawList, cx: number, cy: number, size: number): void {
  const x = Math.round(cx - size / 2);
  const y = Math.round(cy - size / 2);
  pushRect(out, x - 1, y - 1, size + 2, size + 2, withAlpha(COLORS.bunker, 0.6));
  pushRect(out, x, y, size, size, withAlpha(COLORS.texto, 0.92));
}

/** M2: granada em "pixels" (corpo, tampa e alavanca), do tamanho `size`, no canto (x, y). */
function drawGrenadeIcon(out: DrawList, x: number, y: number, size: number, color: number): void {
  const body = Math.max(3, Math.round(size * 0.7));
  const cap = Math.max(2, Math.round(size * 0.3));
  const lever = Math.max(1, Math.round(size * 0.15));
  const bx = Math.round(x + (size - body) / 2);
  const by = Math.round(y + size - body);
  pushRect(out, bx, by, body, body, color);
  pushRect(out, Math.round(x + (size - cap) / 2), by - lever, cap, lever, color);
  pushRect(out, bx + body, by - lever, lever, Math.round(body * 0.6), color);
}

/**
 * M2: luneta da sniper (4x). Tudo fora de um círculo blocado (faixas de `step` px, na linguagem blocada do jogo) fica
 * escuro; dentro, a retícula fina que engrossa na borda e um ponto vermelho no centro. Sem alocação; ~170 retângulos
 * numa vista cheia.
 */
function drawScope(out: DrawList, view: HudViewport, scale: number): void {
  const color = COLORS.bunker;
  const x0 = Math.round(view.x);
  const y0 = Math.round(view.y);
  const w = Math.round(view.width);
  const h = Math.round(view.height);
  const cx = x0 + w / 2;
  const cy = y0 + h / 2;
  const r = Math.round(Math.min(w, h) * 0.46);
  const step = Math.max(2, Math.round(4 * scale));
  const top = Math.round(cy - r);
  const bottom = Math.round(cy + r);
  if (top > y0) pushRect(out, x0, y0, w, top - y0, color);
  if (bottom < y0 + h) pushRect(out, x0, bottom, w, y0 + h - bottom, color);
  for (let y = top; y < bottom; y += step) {
    const mid = y + step / 2 - cy;
    const half = Math.sqrt(Math.max(0, r * r - mid * mid));
    const l = Math.round(cx - half);
    const rr = Math.round(cx + half);
    const hh = Math.min(step, bottom - y);
    if (l > x0) pushRect(out, x0, y, l - x0, hh, color);
    if (rr < x0 + w) pushRect(out, rr, y, x0 + w - rr, hh, color);
  }
  const thin = Math.max(1, Math.round(scale * 0.75));
  const thick = thin * 3;
  const inner = Math.round(r * 0.08);
  const outer = Math.round(r * 0.55);
  const px = Math.round(cx);
  const py = Math.round(cy);
  const ht = Math.floor(thin / 2);
  const hk = Math.floor(thick / 2);
  // Fina perto do centro (até `inner` do meio), grossa na metade de fora.
  pushRect(out, px - r, py - ht, r - inner, thin, color);
  pushRect(out, px + inner, py - ht, r - inner, thin, color);
  pushRect(out, px - ht, py - r, thin, r - inner, color);
  pushRect(out, px - ht, py + inner, thin, r - inner, color);
  pushRect(out, px - r, py - hk, r - outer, thick, color);
  pushRect(out, px + outer, py - hk, r - outer, thick, color);
  pushRect(out, px - hk, py + outer, thick, r - outer, color);
  const dot = Math.max(2, thin * 2);
  pushRect(out, px - dot / 2, py - dot / 2, dot, dot, COLORS.perigo);
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

  // M2: a luneta vem antes de tudo: as plaquinhas (vida, munição, abates) e a borda ficam por cima dela.
  const scoped = !model.dead && model.scope >= 0.5;
  if (scoped) drawScope(out, view, s);
  if (multi) drawViewBorder(out, view, Math.max(2, Math.round(M.border * s)), playerColor);
  // M2 (fase 2d): marcadores dos aliados por baixo das plaquinhas (vivo e fora da luneta).
  if (!model.dead && !scoped) {
    const unit = Math.max(2, Math.round(1.5 * s));
    for (let i = 0; i < model.markerCount && i < MAX_ALLY_MARKERS; i++) {
      const x = model.markers[i * 2]!;
      const y = model.markers[i * 2 + 1]!;
      const seat = model.markerSeat[i]!;
      if (seat >= 0) drawPlayerMarker(out, x, y, unit, seat, view);
      else drawAllyMarker(out, x, y, unit, model.markerColor, view);
    }
    for (let i = 0; i < model.pingCount && i < MAX_TEAM_PINGS; i++) {
      drawPing(out, model.pings[i * 2]!, model.pings[i * 2 + 1]!, unit, view);
    }
  }

  // Alto à esquerda: [ícone P1] ABATES n (MORTES n). As mortes só entram se a plaquinha couber no terço esquerdo da
  // vista: o meio do alto é do placar compartilhado (1P) ou do cruzamento central (vista de baixo no 2P).
  {
    const icon = Math.round(capL);
    let w = pad;
    if (multi) w += icon + gap / 2 + textWidth(hud, tx.players[slot] as string, labelPx) + gap * 1.5;
    const zm = model.points >= 0;
    const firstLabel = zm ? tx.points : tx.kills;
    const firstValue = zm ? model.points : model.kills;
    const secondLabel = zm ? tx.kills : tx.deaths;
    const secondValue = zm ? model.kills : model.deaths;
    w += textWidth(hud, firstLabel, labelPx, M.labelTracking) + gap + numberWidth(hud, firstValue, 0, labelPx);
    const deathsW =
      gap * 1.5 +
      textWidth(hud, secondLabel, labelPx, M.labelTracking) +
      gap +
      numberWidth(hud, secondValue, 0, labelPx);
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
    x += paintText(out, hud, firstLabel, x, y, labelPx, COLORS.textoBaixo, M.labelTracking) + gap;
    x += paintNumber(out, hud, firstValue, 0, x, y, labelPx, zm ? COLORS.acao : COLORS.texto);
    if (showDeaths) {
      x += gap * 1.5;
      x += paintText(out, hud, secondLabel, x, y, labelPx, COLORS.textoBaixo, M.labelTracking) + gap;
      paintNumber(out, hud, secondValue, 0, x, y, labelPx, COLORS.texto);
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

  // Embaixo à direita: munição (pente / reserva; no compacto só o pente; a faca não tem; a granada na mão é só o
  // pente). M2: à esquerda dela as granadas que sobram e, em cima, "Rattler · Fuzil" (só no 1–2P). Morto, nada disso
  // (fase 2c: o centro de baixo é da faixa de quem matou).
  if (!model.dead) {
    const mode = model.ammoMode;
    const clip = Math.max(0, Math.trunc(model.clip));
    const reserve = Math.max(0, Math.trunc(model.reserve));
    const clipColor = clip === 0 ? COLORS.perigo : COLORS.texto;
    const sep = tx.ammo[1] as string;
    const h = Math.round(capN + pad * 2);
    let ammoLeft = right + gap;
    if (mode !== HUD_AMMO.none) {
      const withReserve = mode === HUD_AMMO.full && !compact;
      let w = numberWidth(hud, clip, 0, numberPx);
      if (withReserve) w += textWidth(hud, sep, numberPx) + numberWidth(hud, reserve, 0, numberPx);
      const x = right - w - pad * 2;
      const y = bottom - h;
      plate(out, x, y, w + pad * 2, h, s);
      let tx0 = x + pad;
      tx0 += paintNumber(out, hud, clip, 0, tx0, y + pad, numberPx, clipColor);
      if (withReserve) {
        tx0 += paintText(out, hud, sep, tx0, y + pad, numberPx, COLORS.textoBaixo);
        paintNumber(out, hud, reserve, 0, tx0, y + pad, numberPx, COLORS.textoBaixo);
      }
      ammoLeft = x;
    }
    if (!compact && model.grenades >= 0) {
      const count = Math.trunc(model.grenades);
      const icon = Math.max(6, Math.round(capL * 1.2));
      const gw = Math.round(pad + icon + gap / 2 + numberWidth(hud, count, 0, labelPx) + pad);
      const gx = ammoLeft - gap - gw;
      const gy = bottom - h;
      const color = count > 0 ? COLORS.texto : COLORS.textoBaixo;
      plate(out, gx, gy, gw, h, s);
      drawGrenadeIcon(out, gx + pad, gy + Math.round((h - icon) / 2), icon, color);
      paintNumber(out, hud, count, 0, gx + pad + icon + gap / 2, gy + Math.round((h - capL) / 2), labelPx, color);
    }
    if (!compact && model.weaponName !== '') {
      const nameW = textWidth(hud, model.weaponName, labelPx, M.labelTracking);
      const sepW = textWidth(hud, tx.weaponSeparator, labelPx);
      const catW = textWidth(hud, model.weaponCategory, labelPx);
      const lh = Math.round(capL + pad * 2);
      const lx = right - nameW - sepW - catW - pad * 2;
      // Sempre em cima da linha da munição, mesmo sem munição (faca): lá embaixo ficam as granadas, e o nome não pula
      // de lugar na troca de arma.
      const ly = bottom - h - gap - lh;
      plate(out, lx, ly, nameW + sepW + catW + pad * 2, lh, s);
      let px = lx + pad;
      px += paintText(out, hud, model.weaponName, px, ly + pad, labelPx, COLORS.texto, M.labelTracking);
      px += paintText(out, hud, tx.weaponSeparator, px, ly + pad, labelPx, COLORS.textoBaixo);
      paintText(out, hud, model.weaponCategory, px, ly + pad, labelPx, COLORS.textoBaixo);
    }
  }

  // Centro: retícula + hitmarker, ou "Renascendo…" com a contagem.
  if (!model.dead) {
    const thick = Math.max(2, Math.round(M.crossThickness * s));
    const len = Math.max(4, Math.round(M.crossLength * s));
    const crossGap = Math.max(3, Math.round((M.crossGap + M.crossSpread * clamp01(model.spread)) * s));
    if (scoped) {
      // A retícula é a da luneta.
    } else if (model.crosshair === HUD_CROSSHAIR.dot) drawDot(out, cx, cy, Math.max(2, thick + 1));
    else drawCrosshair(out, cx, cy, crossGap, len, thick);
    for (let i = 0; i < model.soundCount; i++)
      drawSoundBlip(out, cx, cy, model.soundAngle[i]!, model.soundAlpha[i]!, s);
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
    if (model.tipAlpha > 0.01 && model.tipKey !== '') {
      // A dica: abaixo do meio (longe da retícula e do "Clique para mirar"), numa plaquinha.
      const a = clamp01(model.tipAlpha);
      const keyW = textWidth(hud, model.tipKey, labelPx);
      const textW = textWidth(hud, model.tipText, labelPx);
      // A tecla: contorno âmbar com respiro de `pad` em volta do nome; a plaquinha tem mais `capPad` por fora.
      const capPad = Math.max(3, Math.round(pad * 0.6));
      const capW = keyW + pad * 2;
      const capH = capL + pad * 2;
      const w = capW + gap * 2 + textW;
      const h = capH + capPad * 2;
      const x = Math.round(cx - w / 2);
      const y = Math.round(view.y + view.height * 0.66);
      pushShape(out, x - capPad * 2, y, w + capPad * 4, h, withAlpha(COLORS.hudFundo, 0.7 * a), Math.round(5 * s));
      const ring = Math.max(1, Math.round(2 * s));
      pushShape(out, x, y + capPad, capW, capH, withAlpha(COLORS.acao, a), 0, ring);
      paintText(out, hud, model.tipKey, x + pad, y + capPad + pad, labelPx, withAlpha(COLORS.acao, a));
      paintText(out, hud, model.tipText, x + capW + gap * 2, y + capPad + pad, labelPx, withAlpha(COLORS.texto, a));
    }
  } else {
    // Morto: a contagem no centro. Com o anel da primária (M2, fase 2c), ela vai em letra de rótulo, numa plaquinha
    // baixa que cabe no meio do anel; sem anel, no título grande de antes.
    const showCount = model.respawnS > 0 && !model.waitWave;
    const count = Math.ceil(model.respawnS);
    const respawning = model.waitWave ? tx.waitWave : tx.respawning;
    const smallH = Math.round(pad * 2 + capL + (showCount ? gap + capN : 0));
    const r =
      model.primaryNames.length > 0 && !compact ? ringRadius(view, hud, smallH, labelPx, numberPx, pad, gap, s) : 0;
    let y: number;
    let h: number;
    if (r > 0) {
      const w = Math.max(textWidth(hud, respawning, labelPx, M.labelTracking), numberWidth(hud, count, 0, numberPx));
      h = smallH;
      y = Math.round(cy - h / 2);
      plate(out, cx - w / 2 - pad * 2, y, w + pad * 4, h, s);
      paintText(out, hud, respawning, cx, y + pad, labelPx, COLORS.texto, M.labelTracking, 0.5);
      if (showCount) paintNumber(out, hud, count, 0, cx, y + pad + capL + gap, numberPx, COLORS.acao, 0.5);
    } else {
      const headPx = Math.max(M.headingPx * s, view.minTextPx);
      const capH = capHeightPx(display, headPx);
      const w = Math.max(textWidth(display, respawning, headPx, 0.02), numberWidth(hud, count, 0, numberPx));
      h = Math.round(pad * 2 + capH + (showCount ? gap + capN : 0));
      y = Math.round(cy - h / 2);
      plate(out, cx - w / 2 - pad * 2, y, w + pad * 4, h, s);
      paintText(out, display, respawning, cx, y + pad, headPx, COLORS.texto, 0.02, 0.5);
      if (showCount) paintNumber(out, hud, count, 0, cx, y + pad + capH + gap, numberPx, COLORS.acao, 0.5);
    }
    // M2 (fase 2c): o menu da primária e, embaixo dele, quem matou e a dica da derrota feia (no alto ficam o placar e
    // os abates). O formato sai do espaço: anel em volta da contagem quando cabe, uma fileira embaixo dela nas vistas
    // baixas e uma linha "« arma »" no 3–4P. Os retângulos das opções vão para `primaryHit` (toque).
    const hit = model.primaryHit;
    hit.layout = PRIMARY_LAYOUT.none;
    hit.count = 0;
    let below = y + h;
    if (model.primaryNames.length > 0) {
      if (r > 0) below = drawPrimaryRing(out, hud, model, tx, cx, cy, r, labelPx, pad, gap, s);
      else if (!compact) below = drawPrimaryRow(out, hud, model, view, cx, below + gap * 2, labelPx, pad, gap, s);
      if (hit.layout === PRIMARY_LAYOUT.none)
        below = drawPrimaryLine(out, hud, model, tx, cx, below + gap, labelPx, pad, s);
    }
    const bannerTop =
      hit.layout === PRIMARY_LAYOUT.ring || hit.layout === PRIMARY_LAYOUT.row
        ? below + gap * 2
        : view.y + view.height * (compact ? 0.18 : 0.14);
    drawDeathBanner(out, hud, model, tx, cx, bannerTop, labelPx, pad, gap, s);
  }

  if (!model.dead && model.downed !== HUD_DOWNED.none) {
    const label =
      model.downed === HUD_DOWNED.reviving ? tx.reviving : model.downed === HUD_DOWNED.selfUp ? tx.selfUp : tx.downed;
    const value = Math.max(0, Math.ceil(model.downedValue));
    const w = Math.max(textWidth(hud, label, labelPx, M.labelTracking), numberWidth(hud, value, 0, numberPx));
    const h = Math.round(pad * 2 + capL + gap + capN);
    const y = Math.round(cy + capN * 2);
    plate(out, cx - w / 2 - pad * 2, y, w + pad * 4, h, s);
    const color = model.downed === HUD_DOWNED.bleeding ? COLORS.perigo : COLORS.ok;
    paintText(out, hud, label, cx, y + pad, labelPx, color, M.labelTracking, 0.5);
    paintNumber(out, hud, value, 0, cx, y + pad + capL + gap, numberPx, COLORS.texto, 0.5);
  }

  if (!model.dead && model.downed === HUD_DOWNED.none && model.interact !== HUD_INTERACT.none) {
    // M3 (fase 3d): consertar a janela / abrir a porta, numa plaquinha embaixo da mira.
    const y = Math.round(cy + capN * 2);
    const h = Math.round(pad * 2 + capL);
    if (model.interact === HUD_INTERACT.repair) {
      const w = textWidth(hud, tx.repair, labelPx, M.labelTracking);
      plate(out, cx - w / 2 - pad * 2, y, w + pad * 4, h, s);
      paintText(out, hud, tx.repair, cx, y + pad, labelPx, COLORS.texto, M.labelTracking, 0.5);
    } else if (model.interact === HUD_INTERACT.boxTake) {
      // Pegar a arma da caixa: [antes, depois] do nome.
      const a = tx.boxTake[0] as string;
      const b = tx.boxTake[1] as string;
      const w =
        textWidth(hud, a, labelPx, M.labelTracking) +
        textWidth(hud, model.interactName, labelPx, M.labelTracking) +
        textWidth(hud, b, labelPx, M.labelTracking);
      plate(out, cx - w / 2 - pad * 2, y, w + pad * 4, h, s);
      let pen = cx - w / 2;
      pen += paintText(out, hud, a, pen, y + pad, labelPx, COLORS.texto, M.labelTracking);
      pen += paintText(out, hud, model.interactName, pen, y + pad, labelPx, COLORS.acao, M.labelTracking);
      paintText(out, hud, b, pen, y + pad, labelPx, COLORS.texto, M.labelTracking);
    } else {
      // Porta, munição, caixa: [antes, depois] do preço; arma: [antes, entre, depois] com o nome no meio.
      const parts =
        model.interact === HUD_INTERACT.door
          ? tx.door
          : model.interact === HUD_INTERACT.buy
            ? tx.buy
            : model.interact === HUD_INTERACT.box
              ? tx.box
              : tx.buyAmmo;
      const named = model.interact === HUD_INTERACT.buy;
      const a = parts[0] as string;
      const mid = named ? model.interactName : '';
      const between = named ? (parts[1] as string) : '';
      const b = parts[named ? 2 : 1] as string;
      const cost = model.interactCost;
      const w =
        textWidth(hud, a, labelPx, M.labelTracking) +
        (named
          ? textWidth(hud, mid, labelPx, M.labelTracking) + textWidth(hud, between, labelPx, M.labelTracking)
          : 0) +
        numberWidth(hud, cost, 0, labelPx) +
        textWidth(hud, b, labelPx, M.labelTracking);
      plate(out, cx - w / 2 - pad * 2, y, w + pad * 4, h, s);
      const color = model.interactAfford ? COLORS.texto : COLORS.perigo;
      let pen = cx - w / 2;
      pen += paintText(out, hud, a, pen, y + pad, labelPx, color, M.labelTracking);
      if (named) {
        pen += paintText(out, hud, mid, pen, y + pad, labelPx, COLORS.acao, M.labelTracking);
        pen += paintText(out, hud, between, pen, y + pad, labelPx, color, M.labelTracking);
      }
      pen += paintNumber(out, hud, cost, 0, pen, y + pad, labelPx, model.interactAfford ? COLORS.acao : COLORS.perigo);
      paintText(out, hud, b, pen, y + pad, labelPx, color, M.labelTracking);
    }
  }

  if (model.damageAmount > 0.01) drawDamage(out, model.damageAngle, model.damageAmount, left, top, right, bottom, s);
}

// --- Tela de morte (M2, fase 2c) ---------------------------------------------------------------------------------

/**
 * Raio do anel da primária numa vista, ou 0 se ele não cabe: até 22% do lado menor, deixando embaixo a faixa de quem
 * matou (com a dica), e em cima o rótulo, o placar e os abates. Menor que `minR`, as opções dos lados (a 60° do alto)
 * encostariam na plaquinha da contagem (`centerH` de altura).
 */
function ringRadius(
  view: HudViewport,
  font: MsdfFont | null,
  centerH: number,
  labelPx: number,
  numberPx: number,
  pad: number,
  gap: number,
  s: number,
): number {
  const capL = capHeightPx(font, labelPx);
  const capS = capHeightPx(font, labelPx * 0.8);
  const itemH = Math.round(pad * 2 + capL + gap * 0.5 + capS);
  // Faixa com rótulo, linha e a dica (reservada sempre: o formato não muda quando ela aparece).
  const bannerH = pad * 2 + capS + gap + capL + gap + capL;
  const cy = view.y + view.height / 2;
  const bottomEdge = view.y + view.height - Math.max(view.insetBottom, HUD_METRICS.marginY * s);
  const topEdge =
    view.y + Math.max(view.insetTop, HUD_METRICS.marginY * s) + capHeightPx(font, numberPx) + pad * 2 + gap;
  const below = bottomEdge - cy - itemH / 2 - gap * 2 - bannerH;
  const above = cy - topEdge - itemH / 2 - gap - (capS + pad * 2);
  const r = Math.min(Math.min(view.height, view.width) * 0.22, below, above);
  // As opções dos lados ficam r/2 acima e abaixo do centro: precisam passar da contagem com meio vão de folga.
  const minR = centerH + itemH + gap;
  return r >= minR ? Math.round(r) : 0;
}

/** Guarda o retângulo da opção `i` em `primaryHit`. */
function noteOption(model: Readonly<HudModel>, i: number, x: number, y: number, w: number, h: number): void {
  const hit = model.primaryHit;
  const o = i * 4;
  if (o + 3 >= hit.rects.length) return;
  hit.rects[o] = x;
  hit.rects[o + 1] = y;
  hit.rects[o + 2] = w;
  hit.rects[o + 3] = h;
  if (i + 1 > hit.count) hit.count = i + 1;
}

/**
 * Faixa de quem matou, centrada em `cx` com o topo em `top` (devolve o y de baixo), com a dica da derrota feia numa
 * 2ª linha em âmbar quando for o caso: o rótulo pequeno ("ABATIDO POR") e a linha "Normal Bob ·
 * Rattler · 64 HP" (ou só a causa, "Caiu no vazio"). Sem alocação: as partes são pintadas uma a uma.
 */
function drawDeathBanner(
  out: DrawList,
  hud: MsdfFont | null,
  model: Readonly<HudModel>,
  tx: HudTexts,
  cx: number,
  top: number,
  labelPx: number,
  pad: number,
  gap: number,
  s: number,
): number {
  if (model.deathName === '') return top;
  const capL = capHeightPx(hud, labelPx);
  const sepW = textWidth(hud, tx.weaponSeparator, labelPx);
  const nameW = textWidth(hud, model.deathName, labelPx, HUD_METRICS.labelTracking);
  const weaponW = model.deathWeapon !== '' ? sepW + textWidth(hud, model.deathWeapon, labelPx) : 0;
  const hp = Math.max(0, Math.ceil(model.deathHp));
  const hpW = model.deathHp >= 0 ? sepW + numberWidth(hud, hp, 0, labelPx) + textWidth(hud, tx.hp, labelPx) : 0;
  const lineW = nameW + weaponW + hpW;
  const labelW = model.deathLabel !== '' ? textWidth(hud, model.deathLabel, labelPx * 0.8, 0.08) : 0;
  const hintW = model.hardTimeHint ? textWidth(hud, tx.hardTime, labelPx) : 0;
  const rulesW = model.deathRules !== '' ? textWidth(hud, model.deathRules, labelPx * 0.8) : 0;
  const w = Math.max(lineW, labelW, hintW, rulesW);
  const h = Math.round(
    pad * 2 +
      capL +
      (labelW > 0 ? gap + capL * 0.8 : 0) +
      (rulesW > 0 ? gap + capL * 0.8 : 0) +
      (hintW > 0 ? gap + capL : 0),
  );
  const y = Math.round(top);
  plate(out, cx - w / 2 - pad * 2, y, w + pad * 4, h, s);
  let ly = y + pad;
  if (labelW > 0) {
    paintText(out, hud, model.deathLabel, cx, ly, labelPx * 0.8, COLORS.textoBaixo, 0.08, 0.5);
    ly += capL * 0.8 + gap;
  }
  let x = cx - lineW / 2;
  x += paintText(out, hud, model.deathName, x, ly, labelPx, COLORS.perigo, HUD_METRICS.labelTracking);
  if (weaponW > 0) {
    x += paintText(out, hud, tx.weaponSeparator, x, ly, labelPx, COLORS.textoBaixo);
    x += paintText(out, hud, model.deathWeapon, x, ly, labelPx, COLORS.texto);
  }
  if (hpW > 0) {
    x += paintText(out, hud, tx.weaponSeparator, x, ly, labelPx, COLORS.textoBaixo);
    x += paintNumber(out, hud, hp, 0, x, ly, labelPx, COLORS.texto);
    paintText(out, hud, tx.hp, x, ly, labelPx, COLORS.textoBaixo);
  }
  ly += capL + gap;
  if (rulesW > 0) {
    paintText(out, hud, model.deathRules, cx, ly, labelPx * 0.8, COLORS.textoBaixo, 0, 0.5);
    ly += capL * 0.8 + gap;
  }
  if (hintW > 0) paintText(out, hud, tx.hardTime, cx, ly, labelPx, COLORS.acao, 0, 0.5);
  return y + h;
}

/**
 * Menu radial da primária (1–2P): as opções num anel de raio `r` em volta da contagem, a 1ª no alto e as outras no
 * sentido horário; a escolhida em âmbar. Em cima do anel, "ARMA DA PRÓXIMA VIDA". Devolve o y de baixo do anel.
 */
function drawPrimaryRing(
  out: DrawList,
  hud: MsdfFont | null,
  model: Readonly<HudModel>,
  tx: HudTexts,
  cx: number,
  cy: number,
  r: number,
  labelPx: number,
  pad: number,
  gap: number,
  s: number,
): number {
  const n = model.primaryNames.length;
  const capL = capHeightPx(hud, labelPx);
  const smallPx = labelPx * 0.8;
  const capS = capHeightPx(hud, smallPx);
  const h = Math.round(pad * 2 + capL + gap * 0.5 + capS);
  let bottom = cy;
  let topY = cy;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const ix = cx + Math.sin(a) * r;
    const iy = cy - Math.cos(a) * r;
    const name = model.primaryNames[i]!;
    const cat = model.primaryCategories[i] ?? '';
    const w = Math.max(textWidth(hud, name, labelPx, HUD_METRICS.labelTracking), textWidth(hud, cat, smallPx));
    const px = Math.round(ix - w / 2 - pad);
    const py = Math.round(iy - h / 2);
    const chosen = i === model.primarySelected;
    if (chosen) pushShape(out, px, py, Math.round(w + pad * 2), h, COLORS.acao, Math.round(5 * s));
    else plate(out, px, py, w + pad * 2, h, s);
    noteOption(model, i, px, py, w + pad * 2, h);
    const fg = chosen ? COLORS.textoSobreAcao : COLORS.texto;
    paintText(out, hud, name, ix, py + pad, labelPx, fg, HUD_METRICS.labelTracking, 0.5);
    paintText(out, hud, cat, ix, py + pad + capL + gap * 0.5, smallPx, chosen ? fg : COLORS.textoBaixo, 0, 0.5);
    if (py + h > bottom) bottom = py + h;
    if (py < topY) topY = py;
  }
  const lw = textWidth(hud, tx.choose, smallPx, 0.08);
  const ly = Math.round(topY - gap - capS - pad * 2);
  plate(out, cx - lw / 2 - pad, ly, lw + pad * 2, capS + pad * 2, s);
  paintText(out, hud, tx.choose, cx, ly + pad, smallPx, COLORS.textoBaixo, 0.08, 0.5);
  model.primaryHit.layout = PRIMARY_LAYOUT.ring;
  return bottom;
}

/**
 * Vistas baixas (640×360, celular): as opções numa fileira centrada embaixo da contagem, só com o nome (sem o
 * espaçamento de rótulo, para caber); a escolhida em
 * âmbar. Se a fileira não couber na largura, não desenha (fica a linha "« arma »"). Devolve o y de baixo.
 */
function drawPrimaryRow(
  out: DrawList,
  hud: MsdfFont | null,
  model: Readonly<HudModel>,
  view: HudViewport,
  cx: number,
  top: number,
  labelPx: number,
  pad: number,
  gap: number,
  s: number,
): number {
  const n = model.primaryNames.length;
  let total = gap * (n - 1);
  for (let i = 0; i < n; i++) total += textWidth(hud, model.primaryNames[i]!, labelPx) + pad * 2;
  if (total > view.width - 2 * Math.max(HUD_METRICS.marginX * s, view.insetLeft, view.insetRight)) return top;
  const capL = capHeightPx(hud, labelPx);
  const h = Math.round(capL + pad * 2);
  const y = Math.round(top);
  let x = cx - total / 2;
  for (let i = 0; i < n; i++) {
    const name = model.primaryNames[i]!;
    const w = textWidth(hud, name, labelPx) + pad * 2;
    const chosen = i === model.primarySelected;
    if (chosen) pushShape(out, Math.round(x), y, Math.round(w), h, COLORS.acao, Math.round(5 * s));
    else plate(out, x, y, w, h, s);
    noteOption(model, i, Math.round(x), y, Math.round(w), h);
    paintText(out, hud, name, x + pad, y + pad, labelPx, chosen ? COLORS.textoSobreAcao : COLORS.texto);
    x += w + gap;
  }
  model.primaryHit.layout = PRIMARY_LAYOUT.row;
  return y + h;
}

/** 3–4P (ou fileira sem espaço): só a escolhida, "« Rattler »", abaixo da contagem. Devolve o y de baixo. */
function drawPrimaryLine(
  out: DrawList,
  hud: MsdfFont | null,
  model: Readonly<HudModel>,
  tx: HudTexts,
  cx: number,
  top: number,
  labelPx: number,
  pad: number,
  s: number,
): number {
  const name = model.primaryNames[model.primarySelected] ?? '';
  const capL = capHeightPx(hud, labelPx);
  const w =
    textWidth(hud, name, labelPx, HUD_METRICS.labelTracking) +
    textWidth(hud, tx.cyclePrev, labelPx) +
    textWidth(hud, tx.cycleNext, labelPx);
  const h = Math.round(capL + pad * 2);
  const y = Math.round(top);
  plate(out, cx - w / 2 - pad, y, w + pad * 2, h, s);
  let x = cx - w / 2;
  x += paintText(out, hud, tx.cyclePrev, x, y + pad, labelPx, COLORS.acao);
  x += paintText(out, hud, name, x, y + pad, labelPx, COLORS.texto, HUD_METRICS.labelTracking);
  paintText(out, hud, tx.cycleNext, x, y + pad, labelPx, COLORS.acao);
  model.primaryHit.layout = PRIMARY_LAYOUT.line;
  return y + h;
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
  /** M2 (fase 2d): morte súbita (uma plaquinha "MORTE SÚBITA" embaixo do placar). */
  suddenDeath: boolean;
  /**
   * M2 (fase 5d): Bobo Training: a linha dos números no lugar do placar ("Precisão 34% · TTK médio 0,8 s…"; `''` = placar
   * normal). O `game` só refaz a string quando os números mudam.
   */
  trainingLine: string;
}

export function createHudSharedModel(): HudSharedModel {
  return { timeLeftS: -1, teamCount: 0, teamScores: [0, 0, 0, 0], suddenDeath: false, trainingLine: '' };
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
  if (model.trainingLine !== '' && area.mode !== 'spare') {
    // Bobo Training: sem placar nem relógio; a linha dos números no lugar.
    const px = hudLabelPx(s, area.minTextPx);
    const w = textWidth(font, model.trainingLine, px) + pad * 2;
    const h = capHeightPx(font, px) + pad * 2;
    const x = Math.round(area.x + (area.width - w) / 2);
    const y =
      area.mode === 'top'
        ? Math.round(area.y + Math.max(area.insetTop, HUD_METRICS.marginY * s))
        : Math.round(area.y + (area.height - h) / 2);
    plate(out, x, y, w, h, s);
    paintText(out, font, model.trainingLine, x + pad, y + pad, px, COLORS.texto);
    return;
  }

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
  if (model.suddenDeath) {
    const px = hudLabelPx(s, area.minTextPx);
    const sw = textWidth(font, tx.suddenDeath, px, HUD_METRICS.labelTracking);
    const sy = Math.round(y + h + gap);
    plate(out, area.x + (area.width - sw) / 2 - pad, sy, sw + pad * 2, capHeightPx(font, px) + pad * 2, s);
    paintText(
      out,
      font,
      tx.suddenDeath,
      area.x + area.width / 2,
      sy + pad,
      px,
      COLORS.perigo,
      HUD_METRICS.labelTracking,
      0.5,
    );
  }
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
