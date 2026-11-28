import { DRAW_FLOATS_PER_COMMAND, pushRect, pushShape, type DrawList } from '../draw-list.ts';
import type { MsdfFont, UiFonts } from '../font.ts';
import { enterSlidePx, fadeCommands } from '../motion.ts';
import {
  capHeightPx,
  fitTextPx,
  numberWidth,
  paintBar,
  paintIcon,
  paintNumber,
  paintText,
  textWidth,
} from '../paint.ts';
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
  /** M3 (fase 4c): as vantagens do jogador (bits na ordem chonky, speedy, buddy), em plaquinhas em cima da vida. */
  perks: number;
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
   * M5 (fase 5d): balões de emote em cima dos bobos ("Boa!"): 2 valores por balão (x, y em px da superfície, a base
   * dele) e o texto, já resolvido pelo `game`.
   */
  readonly bubbles: Float32Array;
  readonly bubbleText: string[];
  bubbleCount: number;
  /**
   * M6 (fase 1): os pontos do Domination no mundo (2 valores por ponto: x, y em px da superfície, em cima do anel), a
   * letra de cada um (o índice do ponto) e o dono (-1 = neutro).
   */
  readonly pointMarks: Float32Array;
  readonly pointMarkIndex: Int8Array;
  readonly pointMarkOwner: Int8Array;
  pointMarkCount: number;
  /** M6 (fase 2): `points` é o nível do Gun Game (o rótulo diz NÍVEL). */
  pointsIsLevel: boolean;
  /**
   * M7 (fase 4): o BoboStrike. `pointsLabel` troca o rótulo dos pontos (o dinheiro: "$"); `waitText` o "Volta na
   * próxima onda" de quem morreu; `centerLabel` e `centerValue` uma plaquinha no meio ("PLANTANDO 2"); `buyTitle`
   * (não vazio) abre o anel da compra vivo, com as opções em `primaryNames` e os preços em `primaryCategories`.
   */
  pointsLabel: string;
  waitText: string;
  centerLabel: string;
  centerValue: number;
  buyTitle: string;
  /**
   * M6 (fase 3): o marcador do Jugg (x, y em px da superfície; o `game` põe na borda da vista quando ele está fora: o
   * Jugg aparece sempre), ligado por `juggMarkOn`.
   */
  readonly juggMark: Float32Array;
  juggMarkOn: boolean;
  /** M6 (fase 6a): o rótulo da plaquinha (`''` = JUGG); o Fortress usa a mesma para o gerador. */
  juggMarkLabel: string;
  /**
   * M2 (fase 4h): dica de 1 linha das primeiras partidas (gameplay.md §2.5): a tecla ou o botão do dispositivo ativo
   * (desenhado como uma tecla, em âmbar) e o resto do texto ("corre"), já resolvidos pelo `game`; `tipAlpha` 0 = nada.
   */
  tipKey: string;
  tipText: string;
  tipAlpha: number;
  /**
   * M4 (fase 4a): glifo genérico do botão de face no lugar do nome (0 baixo, 1 direita, 2 esquerda, 3 cima; -1 = o
   * texto de `tipKey`): os 4 botões em cruz, o da vez aceso. Vale para qualquer controle, sem letra nem marca.
   */
  tipGlyph: number;
  /** Refino R2 (#79): o pavio da granada cozinhando na mão (0..1, o que falta; -1 = nenhuma). */
  cook: number;
  /**
   * Refino R2 (#79): o arco da granada que vai sair (x, y em px da superfície, 2 por ponto; o último é onde ela vai
   * estar quando o pavio acabar). O `game` prevê e projeta; o desenho só pinta.
   */
  readonly arc: Float32Array;
  arcCount: number;
  /**
   * Refino R2 (#79): granadas vivas perto (dos outros): ângulo relativo à mira (como `damageAngle`) e a força 0..1 (mais
   * perto = mais forte), desenhadas num anel em volta da mira.
   */
  nadeCount: number;
  readonly nadeAngle: Float32Array;
  readonly nadeAlpha: Float32Array;
  // --- M12 (fase 2): a HUD com peso (campos opcionais; o `game` preenche pelo `scene/hud-feel.ts`, já com os tempos e o
  // "Reduzir efeitos" aplicados: aqui é só desenho). Sem eles, a HUD de antes. ---
  /** O "pop" do hitmarker (1 = aberto 1 passo a mais; volta a 0 em 50 ms) e o X cinza do acerto sem dano. */
  hitPop?: number;
  hitZero?: boolean;
  /**
   * O X de abate: alfa 0..1 (0 = nenhum), a escala (começa em 1,4 e encolhe a 1) e se foi na cabeça (âmbar; senão,
   * `perigo`). Embaixo da retícula, o nome da vítima (`killName`, alfa `killNameAlpha`) e a sequência (`streakText`,
   * "ABATE DUPLO", alfa `streakAlpha`), já em caixa alta.
   */
  killMarker?: number;
  killScale?: number;
  killHead?: boolean;
  killName?: string;
  killNameAlpha?: number;
  streakText?: string;
  streakAlpha?: number;
  /** A batida do número de ABATES (0..1: 1 = o começo, o número maior). */
  killsBeat?: number;
  /** O rastro claro da vida: a vida de onde a barra escorre (≤ `health` = sem rastro). */
  healthTrail?: number;
  /** A vinheta blocada da vida baixa (0 = nenhuma; 0..1 = a força, já com o pulso). */
  lowHealth?: number;
  /** Até `HUD_DAMAGE_ARCS` indicadores de dano perto da mira: o ângulo (como `damageAngle`), o alfa e a espessura 0..1. */
  damageCount?: number;
  readonly damageAngles?: Float32Array;
  readonly damageAlphas?: Float32Array;
  readonly damageWeights?: Float32Array;
  /** O tamanho do pente (a ≤ 25% dele o pente fica âmbar); 0 = não sabe. */
  clipSize?: number;
  /** A recarga, 0..1 (< 0 = nenhuma): a barra embaixo da retícula, no lugar da do pavio. */
  reload?: number;
  /** "R recarrega" embaixo da retícula (pente vazio com reserva): a tecla, o glifo (como `tipGlyph`) e o texto. */
  reloadKey?: string;
  reloadGlyph?: number;
  reloadText?: string;
  /**
   * No toque (`HUD_TOUCH_SIDE`): a munição vai para o lado da vida e o nome da arma some (o botão ARMA já diz); e a
   * coluna dos botões de toque (px da superfície, da borda direita; no canhoto, da esquerda), que a tela de morte evita.
   */
  touchSide?: number;
  touchReserve?: number;
  /** Os "+N" dos pontos ao lado da plaquinha do alto: quantos, o valor, o alfa e a subida (0..1). */
  gainCount?: number;
  readonly gainValues?: Float32Array;
  readonly gainAlphas?: Float32Array;
  readonly gainRise?: Float32Array;
  /**
   * A faixa do fim da partida ("VITÓRIA!"), a cor e a entrada (0..1); `''` = nenhuma. Com ela, a retícula, a munição,
   * as dicas e os avisos do centro saem.
   */
  endBanner?: string;
  endBannerColor?: number;
  endBannerIn?: number;
  /** Morto: o que falta do renascer (1 → 0), a barra que esvazia embaixo da contagem; < 0 = nenhuma. */
  respawnFrac?: number;
  /** Morto: o golpe foi na cabeça ("· NA CABEÇA" na faixa de quem matou). */
  deathHead?: boolean;
  /** Morto: a cena escurece (0..1) só com a câmera de morte e o seletor na tela (o espectador fica limpo). */
  deathVeil?: number;
  /** Aliado caído (Zombies, Royale), 1 por marcador: o chevron em `perigo`, piscando por `markerBlink` (0..1). */
  readonly markerDowned?: Uint8Array;
  markerBlink?: number;
}

/** M12 (fase 2): indicadores de dano por vista e "+N" de pontos ao mesmo tempo. */
export const HUD_DAMAGE_ARCS = 4;
export const HUD_GAINS = 3;
/** M12 (fase 2): onde a munição fica no toque (`HudModel.touchSide`): destro, ao lado direito da vida; canhoto, espelhado. */
export const HUD_TOUCH_SIDE = { none: 0, rightHanded: 1, leftHanded: 2 } as const;

/** M2 (fase 3e): máximo de avisos do time na vista. */
export const MAX_TEAM_PINGS = 8;
/** M5 (fase 5d): balões de emote por vista. */
export const MAX_EMOTE_BUBBLES = 8;
/** M6 (fase 1): pontos do Domination no HUD (o mesmo teto da sim, `DOMINATION.maxPoints`). */
export const MAX_CONTROL_POINTS = 5;
/** Refino R2 (#79): pontos do arco da granada e avisos de granada perto por vista. */
export const MAX_GRENADE_ARC = 48;
export const MAX_GRENADE_WARNINGS = 4;

/** M2 (fase 2d): máximo de marcadores de aliado por vista. */
export const MAX_ALLY_MARKERS = 24;

/** M2 (fase 2c): formatos do menu da primária. */
export const PRIMARY_LAYOUT = { none: 0, ring: 1, row: 2, line: 3 } as const;

/**
 * M2 (fase 2c): máximo de opções do menu da primária. M10: 16 (as 10 primárias do radial da morte e os 13 itens da
 * loja do BoboStrike).
 */
export const MAX_PRIMARY_OPTIONS = 16;

/**
 * M10: até tantas opções o anel é um círculo (o de sempre); com mais, ele abre numa elipse larga (`PrimaryHit.wide`),
 * e a fileira quebra em até `MAX_PRIMARY_ROWS` linhas.
 */
export const RING_ROUND_MAX = 8;
export const MAX_PRIMARY_ROWS = 3;

export interface PrimaryHit {
  layout: number;
  count: number;
  readonly rects: Float32Array;
  /**
   * M10: o anel desenhado é o largo (mais de `RING_ROUND_MAX` opções, numa elipse, em ângulos que não são iguais): o
   * cursor do radial escolhe a opção cuja plaquinha está na direção dele, a partir do centro do anel
   * (`centerX`, `centerY`, px da superfície). No anel redondo, `wide` é falso e vale o ângulo de sempre.
   */
  wide: boolean;
  centerX: number;
  centerY: number;
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
    perks: 0,
    hardTimeHint: false,
    primaryHit: {
      layout: PRIMARY_LAYOUT.none,
      count: 0,
      rects: new Float32Array(MAX_PRIMARY_OPTIONS * 4),
      wide: false,
      centerX: 0,
      centerY: 0,
    },
    markers: new Float32Array(MAX_ALLY_MARKERS * 2),
    markerCount: 0,
    markerColor: COLORS.texto,
    markerSeat: new Int8Array(MAX_ALLY_MARKERS).fill(-1),
    pings: new Float32Array(MAX_TEAM_PINGS * 2),
    pingCount: 0,
    bubbles: new Float32Array(MAX_EMOTE_BUBBLES * 2),
    bubbleText: new Array<string>(MAX_EMOTE_BUBBLES).fill(''),
    bubbleCount: 0,
    pointMarks: new Float32Array(MAX_CONTROL_POINTS * 2),
    pointMarkIndex: new Int8Array(MAX_CONTROL_POINTS),
    pointMarkOwner: new Int8Array(MAX_CONTROL_POINTS).fill(-1),
    pointMarkCount: 0,
    pointsIsLevel: false,
    pointsLabel: '',
    waitText: '',
    centerLabel: '',
    centerValue: 0,
    buyTitle: '',
    juggMark: new Float32Array(2),
    juggMarkOn: false,
    juggMarkLabel: '',
    tipKey: '',
    tipText: '',
    tipAlpha: 0,
    tipGlyph: -1,
    cook: -1,
    arc: new Float32Array(MAX_GRENADE_ARC * 2),
    arcCount: 0,
    nadeCount: 0,
    nadeAngle: new Float32Array(MAX_GRENADE_WARNINGS),
    nadeAlpha: new Float32Array(MAX_GRENADE_WARNINGS),
    hitPop: 0,
    hitZero: false,
    killMarker: 0,
    killScale: 1,
    killHead: false,
    killName: '',
    killNameAlpha: 0,
    streakText: '',
    streakAlpha: 0,
    killsBeat: 0,
    healthTrail: -1,
    lowHealth: 0,
    damageCount: 0,
    damageAngles: new Float32Array(HUD_DAMAGE_ARCS),
    damageAlphas: new Float32Array(HUD_DAMAGE_ARCS),
    damageWeights: new Float32Array(HUD_DAMAGE_ARCS),
    clipSize: 0,
    reload: -1,
    reloadKey: '',
    reloadGlyph: -1,
    reloadText: '',
    touchSide: HUD_TOUCH_SIDE.none,
    touchReserve: 0,
    gainCount: 0,
    gainValues: new Float32Array(HUD_GAINS),
    gainAlphas: new Float32Array(HUD_GAINS),
    gainRise: new Float32Array(HUD_GAINS),
    endBanner: '',
    endBannerColor: COLORS.texto,
    endBannerIn: 1,
    respawnFrac: -1,
    deathHead: false,
    deathVeil: 0,
    markerDowned: new Uint8Array(MAX_ALLY_MARKERS),
    markerBlink: 1,
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
  /** M12 (fase 2): os indicadores de dano ficam a esta fração do anel do som (entre o som e o aviso de granada). */
  damageRing: 1.5,
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

/** M3 (fase 4c): a cor de cada vantagem (Chonky Cola, Speedy Soda, Buddy Brew) nas plaquinhas. */
const PERK_COLORS: readonly number[] = [COLORS.perigo, TEAM_COLORS[2]!, TEAM_COLORS[1]!];

/** M3 (fase 3d): o aviso de interagir do Bobo Zombies. */
/** M7 (fase 4): `text` = o aviso em `interactName` (plantar e desarmar a Boom Box). */
export const HUD_INTERACT = { none: 0, repair: 1, door: 2, buy: 3, buyAmmo: 4, box: 5, boxTake: 6, text: 7 } as const;

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
  /** M3 (fase 4c): a inicial de cada vantagem (C, S, B). */
  readonly perkLetters: readonly string[];
  /** M6 (fase 1): a letra de cada ponto do Domination. */
  readonly pointLetters: readonly string[];
  /** M6 (fase 2): o nível do Gun Game no lugar dos pontos. */
  readonly level: string;
  /** M6 (fase 3): a plaquinha em cima do Jugg. */
  readonly jugg: string;
  /** M12 (fase 2): "NA CABEÇA" (a faixa de quem matou) e o "+" dos pontos que sobem. */
  readonly head: string;
  readonly plus: string;
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
    perkLetters: [t('perk.chonky'), t('perk.speedy'), t('perk.buddy')].map((n) => n.slice(0, 1).toUpperCase()),
    pointLetters: [...t('hud.pointLetters')],
    level: t('hud.level').toUpperCase(),
    jugg: t('hud.jugg').toUpperCase(),
    head: t('hud.streak.head').toUpperCase(),
    plus: '+',
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
/** M5 (fase 5d): o balão de um emote, com a base em (x, y): a plaquinha do HUD e o texto em âmbar. */
function drawBubble(
  out: DrawList,
  hud: MsdfFont | null,
  text: string,
  x: number,
  y: number,
  px: number,
  scale: number,
  view: HudViewport,
): void {
  if (hud === null || text === '') return;
  const pad = hudPad(scale);
  const w = Math.round(textWidth(hud, text, px) + pad * 2);
  const h = Math.round(capHeightPx(hud, px) + pad * 2);
  const left = Math.round(x - w / 2);
  const top = Math.round(y - h);
  if (left < view.x || left + w > view.x + view.width || top < view.y || y > view.y + view.height) return;
  plate(out, left, top, w, h, scale);
  paintText(out, hud, text, left + pad, top + pad, px, COLORS.acao);
}

/**
 * A cor do dono de um ponto (neutro: o texto apagado). M10 (fase 8): os pontos (Domination) e a plaquinha do Jugg
 * nunca são do Sandbox, então a cor da posição é a da partida (a escolha de cor só existe lá).
 */
function pointColor(owner: number): number {
  return owner >= 0 && owner < TEAM_COLORS.length ? TEAM_COLORS[owner]! : COLORS.textoBaixo;
}

/**
 * M6 (fase 1): a letra de um ponto do Domination no mundo (em cima do anel), na cor do dono. Fora da vista, nada (o
 * placar do alto mostra todos).
 */
function drawPointMark(
  out: DrawList,
  hud: MsdfFont | null,
  letter: string,
  owner: number,
  x: number,
  y: number,
  px: number,
  scale: number,
  view: HudViewport,
): void {
  if (hud === null || letter === '') return;
  const pad = hudPad(scale);
  const h = Math.round(capHeightPx(hud, px) + pad * 2);
  const w = Math.max(h, Math.round(textWidth(hud, letter, px) + pad * 2));
  const left = Math.round(x - w / 2);
  const top = Math.round(y - h / 2);
  if (left < view.x || left + w > view.x + view.width || top < view.y || top + h > view.y + view.height) return;
  plate(out, left, top, w, h, scale);
  pushRect(
    out,
    left,
    top + h - Math.max(2, Math.round(3 * scale)),
    w,
    Math.max(2, Math.round(3 * scale)),
    pointColor(owner),
  );
  paintText(out, hud, letter, left + w / 2, top + pad, px, pointColor(owner), 0, 0.5);
}

/**
 * M6 (fase 3): a plaquinha JUGG em cima do Jugg, na cor do time dele. Ao contrário das letras dos pontos, nunca some:
 * fica presa dentro da vista (o `game` já põe na borda quando ele está fora). M12 (fase 2, playtest): presa também
 * entre `minTop` e `maxBottom` (fora das faixas das plaquinhas de cima e de baixo: a "ZONA" do Royale ficava por cima da
 * munição) e entre `minLeft` e `maxRight`.
 */
function drawJuggMark(
  out: DrawList,
  hud: MsdfFont | null,
  label: string,
  x: number,
  y: number,
  px: number,
  scale: number,
  minLeft: number,
  maxRight: number,
  minTop: number,
  maxBottom: number,
): void {
  if (hud === null || label === '') return;
  const pad = hudPad(scale);
  const h = Math.round(capHeightPx(hud, px) + pad * 2);
  const w = Math.max(h, Math.round(textWidth(hud, label, px) + pad * 2));
  const left = Math.round(Math.max(minLeft, Math.min(x - w / 2, maxRight - w)));
  const top = Math.round(Math.max(minTop, Math.min(y - h / 2, maxBottom - h)));
  plate(out, left, top, w, h, scale);
  const bar = Math.max(2, Math.round(3 * scale));
  pushRect(out, left, top + h - bar, w, bar, pointColor(1));
  paintText(out, hud, label, left + w / 2, top + pad, px, pointColor(1), 0, 0.5);
}

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

/**
 * Hitmarker em X feito de "pixels" (a linguagem blocada do jogo): branco no corpo, âmbar na cabeça. M12 (fase 2):
 * `count` quadrados por braço (o X de abate tem 4).
 */
function drawHitMarker(
  out: DrawList,
  cx: number,
  cy: number,
  from: number,
  step: number,
  color: number,
  count = 3,
): void {
  const x = Math.round(cx);
  const y = Math.round(cy);
  const half = Math.floor(step / 2);
  // M12 (fase 2, playtest): contorno escuro por baixo (o X claro sumia contra o céu e o concreto), no alfa do X.
  const shadow = withAlpha(COLORS.bunker, 0.6 * ((color & 0xff) / 255));
  for (let k = 0; k < count; k++) {
    const o = from + k * step;
    pushRect(out, x - o - half - 1, y - o - half - 1, step + 2, step + 2, shadow);
    pushRect(out, x + o - half - 1, y - o - half - 1, step + 2, step + 2, shadow);
    pushRect(out, x - o - half - 1, y + o - half - 1, step + 2, step + 2, shadow);
    pushRect(out, x + o - half - 1, y + o - half - 1, step + 2, step + 2, shadow);
  }
  for (let k = 0; k < count; k++) {
    const o = from + k * step;
    pushRect(out, x - o - half, y - o - half, step, step, color);
    pushRect(out, x + o - half, y - o - half, step, step, color);
    pushRect(out, x - o - half, y + o - half, step, step, color);
    pushRect(out, x + o - half, y + o - half, step, step, color);
  }
}

/**
 * M12 (fase 2): escala os comandos `[from, list.count)` já desenhados em volta de (cx, cy) por `k` (a batida de um
 * número, o X de abate que encolhe, o número da contagem). Sem redesenhar e sem alocar; `k` = 1 não faz nada.
 */
export function scaleCommands(list: DrawList, from: number, cx: number, cy: number, k: number): void {
  if (k === 1) return;
  for (let i = from < 0 ? 0 : from; i < list.count; i++) {
    const g = i * DRAW_FLOATS_PER_COMMAND;
    list.geom[g] = cx + ((list.geom[g] ?? 0) - cx) * k;
    list.geom[g + 1] = cy + ((list.geom[g + 1] ?? 0) - cy) * k;
    list.geom[g + 2] = (list.geom[g + 2] ?? 0) * k;
    list.geom[g + 3] = (list.geom[g + 3] ?? 0) * k;
  }
}

/** M12 (fase 2): a força de cada uma das 3 faixas da vinheta da vida baixa, de fora para dentro. */
const VIGNETTE_ALPHA: readonly number[] = [0.34, 0.2, 0.09];

/**
 * M12 (fase 2): a vinheta blocada da vida baixa: 3 molduras em `perigo` por dentro da vista, cada uma mais fraca que a
 * de fora (12 retângulos, sem gradiente: a linguagem blocada do jogo).
 */
function drawVignette(out: DrawList, view: HudViewport, s: number, a: number): void {
  const band = Math.max(3, Math.round(6 * s));
  const x = Math.round(view.x);
  const y = Math.round(view.y);
  const w = Math.round(view.width);
  const h = Math.round(view.height);
  for (let k = 0; k < VIGNETTE_ALPHA.length; k++) {
    const o = k * band;
    const inner = h - 2 * o - 2 * band;
    if (inner <= 0 || w - 2 * o <= 0) break;
    const color = withAlpha(COLORS.perigo, a * VIGNETTE_ALPHA[k]!);
    pushRect(out, x + o, y + o, w - 2 * o, band, color);
    pushRect(out, x + o, y + h - o - band, w - 2 * o, band, color);
    pushRect(out, x + o, y + o + band, band, inner, color);
    pushRect(out, x + w - o - band, y + o + band, band, inner, color);
  }
}

/**
 * M12 (fase 2): um indicador de dano: um arco blocado de 7 quadrados a 1,5× o anel do som, na direção de onde veio o
 * dano (frente = cima; positivo = à esquerda, como o yaw), mais grosso com mais dano (`weight` 0..1).
 */
function drawDamageArc(
  out: DrawList,
  cx: number,
  cy: number,
  angle: number,
  alpha: number,
  weight: number,
  s: number,
): void {
  const a01 = clamp01(alpha);
  if (a01 <= 0.01) return;
  const r = HUD_METRICS.soundRing * s * HUD_METRICS.damageRing;
  const side = Math.max(2, Math.round((2.5 + 3.5 * clamp01(weight)) * s));
  for (let k = -3; k <= 3; k++) {
    const a = angle + k * 0.11;
    const x = Math.round(cx - Math.sin(a) * r - side / 2);
    const y = Math.round(cy - Math.cos(a) * r - side / 2);
    // As pontas mais fracas: o arco afina sem gradiente.
    const edge = k === -3 || k === 3 ? 0.5 : 1;
    pushRect(out, x - 1, y - 1, side + 2, side + 2, withAlpha(COLORS.bunker, 0.5 * a01 * edge));
    pushRect(out, x, y, side, side, withAlpha(COLORS.perigo, 0.95 * a01 * edge));
  }
}

/**
 * A tecla desenhada (contorno âmbar com o nome ou o glifo do botão de face) e o texto, numa plaquinha centrada em `cx`
 * com o topo em `y` (a dica de 1 linha; M12: o "R recarrega" embaixo da retícula). Devolve a altura.
 */
function drawKeyPrompt(
  out: DrawList,
  hud: MsdfFont | null,
  key: string,
  glyphIndex: number,
  text: string,
  cx: number,
  y: number,
  labelPx: number,
  capL: number,
  pad: number,
  gap: number,
  s: number,
  a: number,
): number {
  const glyph = glyphIndex >= 0 && glyphIndex < 4;
  const keyW = glyph ? capL : textWidth(hud, key, labelPx);
  const textW = textWidth(hud, text, labelPx);
  // A tecla: contorno âmbar com respiro de `pad` em volta do nome; a plaquinha tem mais `capPad` por fora.
  const capPad = Math.max(3, Math.round(pad * 0.6));
  const capW = keyW + pad * 2;
  const capH = capL + pad * 2;
  const w = capW + gap * 2 + textW;
  const h = capH + capPad * 2;
  const x = Math.round(cx - w / 2);
  pushShape(out, x - capPad * 2, y, w + capPad * 4, h, withAlpha(COLORS.hudFundo, 0.7 * a), Math.round(5 * s));
  const ring = Math.max(1, Math.round(2 * s));
  pushShape(out, x, y + capPad, capW, capH, withAlpha(COLORS.acao, a), 0, ring);
  // O glifo ocupa o miolo inteiro da tecla (o texto deixa `pad` de respiro; o glifo, metade).
  if (glyph) drawFaceGlyph(out, x + pad / 2, y + capPad + pad / 2, capL + pad, glyphIndex, a);
  else paintText(out, hud, key, x + pad, y + capPad + pad, labelPx, withAlpha(COLORS.acao, a));
  paintText(out, hud, text, x + capW + gap * 2, y + capPad + pad, labelPx, withAlpha(COLORS.texto, a));
  return h;
}

/**
 * M12 (fase 2): uma linha curta embaixo da retícula (o nome da vítima, a sequência), numa plaquinha centrada em `cx`
 * com o topo em `y`. Devolve a altura.
 */
function drawCenterLine(
  out: DrawList,
  hud: MsdfFont | null,
  text: string,
  cx: number,
  y: number,
  px: number,
  pad: number,
  s: number,
  color: number,
  a: number,
): number {
  const w = textWidth(hud, text, px, HUD_METRICS.labelTracking);
  const h = Math.round(capHeightPx(hud, px) + pad * 2);
  pushShape(
    out,
    Math.round(cx - w / 2 - pad),
    Math.round(y),
    Math.round(w + pad * 2),
    h,
    withAlpha(COLORS.hudFundo, 0.7 * a),
    Math.round(5 * s),
  );
  paintText(out, hud, text, cx, Math.round(y) + pad, px, withAlpha(color, a), HUD_METRICS.labelTracking, 0.5);
  return h;
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
 * jogador no 2–4P; dano direcional perto da mira; "Renascendo…" com a contagem quando morto. No 3–4P (compacto) a vida
 * fica só com número e barra fina e a munição só com o pente. Sem fontes (`null`), só as formas. Sem alocação. M12
 * (fase 2): o X de abate, o hitmarker com peso, a vida com rastro e vinheta, até 4 indicadores de dano, a munição baixa
 * e a recarga, os "+N", a tela de morte limpa e a faixa do fim (os campos opcionais do `HudModel`).
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
  // M12 (fase 2): o fim da partida (a faixa no centro; a retícula, a munição e as dicas saem) e o toque.
  const ended = (model.endBanner ?? '') !== '';
  const touch = model.touchSide ?? HUD_TOUCH_SIDE.none;
  const barH = Math.max(2, Math.round((compact ? M.compactBarHeight : M.barHeight) * s));
  const healthH = Math.round(pad + (compact ? 0 : capL + pad) + capN + pad + barH + pad);
  const chipH = Math.round(capL + pad * 2);

  // M2: a luneta vem antes de tudo: as plaquinhas (vida, munição, abates) e a borda ficam por cima dela.
  const scoped = !model.dead && !ended && model.scope >= 0.5;
  if (scoped) drawScope(out, view, s);
  // M12 (fase 2, playtest): morto, a cena escurece um pouco (as opções e a faixa leem por cima dela).
  const veil = model.deathVeil ?? 0;
  if (model.dead && !ended && veil > 0) {
    pushRect(
      out,
      Math.round(view.x),
      Math.round(view.y),
      Math.round(view.width),
      Math.round(view.height),
      withAlpha(COLORS.bunker, 0.35 * clamp01(veil)),
    );
  }
  // M12 (fase 2): a vinheta da vida baixa, por baixo da borda e das plaquinhas.
  const low = model.lowHealth ?? 0;
  if (!model.dead && low > 0.01) drawVignette(out, view, s, clamp01(low));
  if (multi) drawViewBorder(out, view, Math.max(2, Math.round(M.border * s)), playerColor);
  // M2 (fase 2d): marcadores dos aliados por baixo das plaquinhas (vivo e fora da luneta).
  if (!model.dead && !scoped) {
    const unit = Math.max(2, Math.round(1.5 * s));
    const downed = model.markerDowned;
    // M12 (fase 2): o aliado caído em `perigo`, piscando (o `game` já limita a 3 clarões por segundo).
    const downColor = withAlpha(COLORS.perigo, 0.35 + 0.65 * clamp01(model.markerBlink ?? 1));
    for (let i = 0; i < model.markerCount && i < MAX_ALLY_MARKERS; i++) {
      const x = model.markers[i * 2]!;
      const y = model.markers[i * 2 + 1]!;
      const seat = model.markerSeat[i]!;
      if (downed !== undefined && downed[i] === 1) drawAllyMarker(out, x, y, unit, downColor, view);
      else if (seat >= 0) drawPlayerMarker(out, x, y, unit, seat, view);
      else drawAllyMarker(out, x, y, unit, model.markerColor, view);
    }
    for (let i = 0; i < model.pingCount && i < MAX_TEAM_PINGS; i++) {
      drawPing(out, model.pings[i * 2]!, model.pings[i * 2 + 1]!, unit, view);
    }
    for (let i = 0; i < model.bubbleCount && i < MAX_EMOTE_BUBBLES; i++) {
      drawBubble(out, hud, model.bubbleText[i]!, model.bubbles[i * 2]!, model.bubbles[i * 2 + 1]!, labelPx, s, view);
    }
    const letters = hudTexts().pointLetters;
    for (let i = 0; i < model.pointMarkCount && i < MAX_CONTROL_POINTS; i++) {
      drawPointMark(
        out,
        hud,
        letters[model.pointMarkIndex[i]!] ?? '',
        model.pointMarkOwner[i]!,
        model.pointMarks[i * 2]!,
        model.pointMarks[i * 2 + 1]!,
        labelPx,
        s,
        view,
      );
    }
    if (model.juggMarkOn) {
      const label = model.juggMarkLabel !== '' ? model.juggMarkLabel : hudTexts().jugg;
      // Entre a faixa de cima (a plaquinha dos abates) e a de baixo (vida e munição).
      drawJuggMark(
        out,
        hud,
        label,
        model.juggMark[0]!,
        model.juggMark[1]!,
        labelPx,
        s,
        left,
        right,
        top + chipH + gap,
        bottom - healthH - gap,
      );
    }
  }

  // Alto à esquerda: [ícone P1] ABATES n (MORTES n). As mortes só entram se a plaquinha couber no terço esquerdo da
  // vista: o meio do alto é do placar compartilhado (1P) ou do cruzamento central (vista de baixo no 2P).
  {
    const icon = Math.round(capL);
    let w = pad;
    if (multi) w += icon + gap / 2 + textWidth(hud, tx.players[slot] as string, labelPx) + gap * 1.5;
    const zm = model.points >= 0;
    const firstLabel = zm
      ? model.pointsLabel !== ''
        ? model.pointsLabel
        : model.pointsIsLevel
          ? tx.level
          : tx.points
      : tx.kills;
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
    const h = chipH;
    plate(out, left, top, w, h, s);
    let x = left + pad;
    const y = top + pad;
    if (multi) {
      paintIcon(out, slot, x, y, icon, playerColor);
      x += icon + gap / 2;
      x += paintText(out, hud, tx.players[slot] as string, x, y, labelPx, playerColor) + gap * 1.5;
    }
    // M12 (fase 2): a batida do número de ABATES no abate (escala em volta do meio dele).
    const beat = 1 + 0.35 * clamp01(model.killsBeat ?? 0);
    x += paintText(out, hud, firstLabel, x, y, labelPx, COLORS.textoBaixo, M.labelTracking) + gap;
    const n0 = out.count;
    const w0 = paintNumber(out, hud, firstValue, 0, x, y, labelPx, zm ? COLORS.acao : COLORS.texto);
    if (!zm) scaleCommands(out, n0, x + w0 / 2, y + capL / 2, beat);
    x += w0;
    if (showDeaths) {
      x += gap * 1.5;
      x += paintText(out, hud, secondLabel, x, y, labelPx, COLORS.textoBaixo, M.labelTracking) + gap;
      const n1 = out.count;
      const w1 = paintNumber(out, hud, secondValue, 0, x, y, labelPx, COLORS.texto);
      if (zm) scaleCommands(out, n1, x + w1 / 2, y + capL / 2, beat);
    }
    // M12 (fase 2): os "+N" dos pontos (Zombies, BoboStrike) ao lado da plaquinha, subindo e sumindo; sem espaço ao
    // lado (o placar do alto é do meio), embaixo dela. No 3–4P, um por vez.
    const gains = Math.min(model.gainCount ?? 0, compact ? 1 : HUD_GAINS);
    if (gains > 0 && model.gainValues && model.gainAlphas && model.gainRise) {
      let gx = left + w + gap;
      let gy = top;
      const money = model.pointsLabel;
      for (let i = 0; i < gains; i++) {
        const value = Math.max(0, Math.round(model.gainValues[i]!));
        const a = clamp01(model.gainAlphas[i]!);
        if (a <= 0.01) continue;
        const gw = Math.round(
          pad * 2 +
            textWidth(hud, tx.plus, labelPx) +
            textWidth(hud, money, labelPx) +
            numberWidth(hud, value, 0, labelPx),
        );
        if (i === 0 && gx + gw > view.x + view.width * GAIN_MAX_FRACTION) {
          gx = left;
          gy = top + h + gap;
        }
        const ry = Math.round(gy - clamp01(model.gainRise[i]!) * GAIN_RISE_PX * s);
        pushShape(out, Math.round(gx), ry, gw, h, withAlpha(COLORS.hudFundo, 0.7 * a), Math.round(5 * s));
        let pen = gx + pad;
        const color = withAlpha(COLORS.acao, a);
        pen += paintText(out, hud, tx.plus, pen, ry + pad, labelPx, color);
        if (money !== '') pen += paintText(out, hud, money, pen, ry + pad, labelPx, color);
        paintNumber(out, hud, value, 0, pen, ry + pad, labelPx, color);
        gx += gw + gap;
      }
    }
  }

  // Embaixo à esquerda: vida (rótulo, número e barra; no compacto só número e barra fina). M12 (fase 2): some com o
  // jogador morto (a "VIDA 0" e as vantagens); no toque canhoto, embaixo à direita (o lado livre dos botões).
  const hpInnerW = Math.max(
    Math.round(M.healthWidth * s * (compact ? 0.6 : 1)),
    numberWidth(hud, Math.max(0, Math.ceil(model.health)), 0, numberPx),
    compact ? 0 : textWidth(hud, tx.health, labelPx, M.labelTracking),
  );
  const hpW = hpInnerW + pad * 2;
  const hpX = touch === HUD_TOUCH_SIDE.leftHanded ? right - hpW : left;
  if (!model.dead) {
    const hp = Math.max(0, Math.ceil(model.health));
    const frac = model.maxHealth > 0 ? clamp01(hp / model.maxHealth) : 0;
    const lowHp = frac <= 0.35;
    const h = healthH;
    const y = bottom - h;
    plate(out, hpX, y, hpW, h, s);
    let ty = y + pad;
    if (!compact) {
      paintText(out, hud, tx.health, hpX + pad, ty, labelPx, COLORS.textoBaixo, M.labelTracking);
      ty += capL + pad;
    }
    paintNumber(out, hud, hp, 0, hpX + pad, ty, numberPx, lowHp ? COLORS.perigo : COLORS.texto);
    const by = ty + capN + pad;
    paintBar(out, hpX + pad, by, hpInnerW, barH, frac, COLORS.linha, lowHp ? COLORS.perigo : COLORS.ok);
    // M12 (fase 2): o rastro claro do dano, da vida de agora até a de antes do golpe (escorre em 0,4 s).
    const trail = model.healthTrail ?? -1;
    if (trail > hp && model.maxHealth > 0) {
      const bx = hpX + pad;
      const x0 = Math.round(bx + hpInnerW * frac);
      const x1 = Math.round(bx + hpInnerW * clamp01(trail / model.maxHealth));
      const y0 = Math.round(by);
      if (x1 > x0)
        pushRect(out, x0, y0, x1 - x0, Math.max(1, Math.round(by + barH) - y0), withAlpha(COLORS.texto, 0.75));
    }
    // M3 (fase 4c): as vantagens, em plaquinhas quadradas com a inicial na cor de cada uma, em cima da vida.
    if (model.perks !== 0) {
      const size = Math.round(capL + pad * 2);
      let bx = hpX;
      for (let k = 0; k < PERK_COLORS.length; k++) {
        if ((model.perks & (1 << k)) === 0) continue;
        plate(out, bx, y - gap - size, size, size, s);
        paintText(
          out,
          hud,
          tx.perkLetters[k] as string,
          bx + size / 2,
          y - gap - size + pad,
          labelPx,
          PERK_COLORS[k]!,
          0,
          0.5,
        );
        bx += size + gap;
      }
    }
  }

  // Embaixo à direita: munição (pente / reserva; no compacto só o pente; a faca não tem; a granada na mão é só o
  // pente). M2: à esquerda dela as granadas que sobram e, em cima, "Rattler · Fuzil" (só no 1–2P). Morto, nada disso
  // (fase 2c: o centro de baixo é da faixa de quem matou). M12 (fase 2): no fim da partida, também não; no toque, ao
  // lado da vida (o PULO cobria a munição), sem o nome da arma; o pente âmbar a ≤ 25% e vermelho vazio.
  if (!model.dead && !ended) {
    const mode = model.ammoMode;
    const clip = Math.max(0, Math.trunc(model.clip));
    const reserve = Math.max(0, Math.trunc(model.reserve));
    const size = model.clipSize ?? 0;
    const clipColor = clip === 0 ? COLORS.perigo : size > 0 && clip * 4 <= size ? COLORS.acao : COLORS.texto;
    const sep = tx.ammo[1] as string;
    const h = Math.round(capN + pad * 2);
    const y = bottom - h;
    // Para onde a fileira (munição, granadas) cresce: da direita para a esquerda (o normal e o canhoto) ou ao contrário.
    const toRight = touch === HUD_TOUCH_SIDE.rightHanded;
    let edge =
      touch === HUD_TOUCH_SIDE.none ? right : touch === HUD_TOUCH_SIDE.rightHanded ? hpX + hpW + gap : hpX - gap;
    if (mode !== HUD_AMMO.none) {
      const withReserve = mode === HUD_AMMO.full && !compact;
      let w = numberWidth(hud, clip, 0, numberPx);
      if (withReserve) w += textWidth(hud, sep, numberPx) + numberWidth(hud, reserve, 0, numberPx);
      const x = toRight ? edge : edge - w - pad * 2;
      plate(out, x, y, w + pad * 2, h, s);
      let tx0 = x + pad;
      tx0 += paintNumber(out, hud, clip, 0, tx0, y + pad, numberPx, clipColor);
      if (withReserve) {
        tx0 += paintText(out, hud, sep, tx0, y + pad, numberPx, COLORS.textoBaixo);
        paintNumber(out, hud, reserve, 0, tx0, y + pad, numberPx, COLORS.textoBaixo);
      }
      edge = toRight ? x + w + pad * 2 + gap : x - gap;
    }
    if (!compact && model.grenades >= 0) {
      const count = Math.trunc(model.grenades);
      const icon = Math.max(6, Math.round(capL * 1.2));
      const gw = Math.round(pad + icon + gap / 2 + numberWidth(hud, count, 0, labelPx) + pad);
      const gx = toRight ? edge : edge - gw;
      const color = count > 0 ? COLORS.texto : COLORS.textoBaixo;
      plate(out, gx, y, gw, h, s);
      drawGrenadeIcon(out, gx + pad, y + Math.round((h - icon) / 2), icon, color);
      paintNumber(out, hud, count, 0, gx + pad + icon + gap / 2, y + Math.round((h - capL) / 2), labelPx, color);
    }
    if (!compact && touch === HUD_TOUCH_SIDE.none && model.weaponName !== '') {
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

  // M12 (fase 2): o topo da faixa das plaquinhas de baixo (vida, vantagens, munição, nome da arma) e a altura da
  // plaquinha do meio (caído / plantando, ou o aviso de interagir): o que empilha embaixo da retícula fica acima delas.
  let bandTop = bottom;
  if (!model.dead) {
    bandTop = Math.min(bandTop, bottom - healthH - (model.perks !== 0 ? gap + chipH : 0));
    if (!ended) {
      const ammoH = Math.round(capN + pad * 2);
      if (model.ammoMode !== HUD_AMMO.none || (!compact && model.grenades >= 0))
        bandTop = Math.min(bandTop, bottom - ammoH);
      if (!compact && touch === HUD_TOUCH_SIDE.none && model.weaponName !== '') {
        bandTop = Math.min(bandTop, bottom - ammoH - gap - chipH);
      }
    }
  }
  const centerH =
    model.dead || ended
      ? 0
      : model.downed !== HUD_DOWNED.none || model.centerLabel !== ''
        ? Math.round(pad * 2 + capL + gap + capN)
        : model.interact !== HUD_INTERACT.none
          ? chipH
          : 0;
  // Centro: retícula + hitmarker, ou "Renascendo…" com a contagem; M12: ou a faixa do fim da partida.
  /** O que vai embaixo da retícula empilha a partir daqui (a barra da recarga, o nome da vítima, a sequência…). */
  let below = Math.round(cy + capN * 2);
  if (ended) {
    drawEndBanner(out, display, model, view, s, compact, pad);
  } else if (!model.dead) {
    const thick = Math.max(2, Math.round(M.crossThickness * s));
    const len = Math.max(4, Math.round(M.crossLength * s));
    const crossGap = Math.max(3, Math.round((M.crossGap + M.crossSpread * clamp01(model.spread)) * s));
    if (scoped) {
      // A retícula é a da luneta.
    } else if (model.crosshair === HUD_CROSSHAIR.dot) drawDot(out, cx, cy, Math.max(2, thick + 1));
    else drawCrosshair(out, cx, cy, crossGap, len, thick);
    for (let i = 0; i < model.soundCount; i++)
      drawSoundBlip(out, cx, cy, model.soundAngle[i]!, model.soundAlpha[i]!, s);
    // Refino R2 (#79): granada perto: um círculo vermelho com contorno no anel de fora, na direção dela.
    for (let i = 0; i < model.nadeCount && i < MAX_GRENADE_WARNINGS; i++) {
      const a = model.nadeAngle[i]!;
      const r = HUD_METRICS.soundRing * s * 1.9;
      const size = Math.max(8, Math.round(7 * s));
      const x = Math.round(cx - Math.sin(a) * r - size / 2);
      const y = Math.round(cy - Math.cos(a) * r - size / 2);
      const k = 0.45 + 0.55 * clamp01(model.nadeAlpha[i]!);
      paintIcon(out, 1, x - 1, y - 1, size + 2, withAlpha(COLORS.bunker, 0.7 * k));
      paintIcon(out, 1, x, y, size, withAlpha(COLORS.perigo, k));
    }
    // Refino R2 (#79): o arco da granada e o pavio. M12 (fase 2, playtest): os pontos maiores, com contorno escuro (os
    // de 2 px sumiam na parede clara), e no fim a marca de onde ela cai (o anel âmbar com o miolo).
    if (!scoped && model.arcCount > 0) {
      const n = Math.min(model.arcCount, MAX_GRENADE_ARC);
      const dotS = Math.max(3, Math.round(2.2 * s));
      for (let i = 0; i < n - 1; i++) {
        const x = Math.round(model.arc[i * 2]! - dotS / 2);
        const y = Math.round(model.arc[i * 2 + 1]! - dotS / 2);
        const a = 0.95 - (0.45 * i) / n;
        pushRect(out, x - 1, y - 1, dotS + 2, dotS + 2, withAlpha(COLORS.bunker, 0.65 * a));
        pushRect(out, x, y, dotS, dotS, withAlpha(COLORS.texto, a));
      }
      const end = Math.max(8, Math.round(7 * s));
      const ring = Math.max(2, Math.round(s));
      const ex = Math.round(model.arc[(n - 1) * 2]! - end / 2);
      const ey = Math.round(model.arc[(n - 1) * 2 + 1]! - end / 2);
      pushShape(out, ex - 1, ey - 1, end + 2, end + 2, withAlpha(COLORS.bunker, 0.7), 0, ring + 2);
      pushShape(out, ex, ey, end, end, COLORS.acao, 0, ring);
      const core = Math.max(2, Math.round(end * 0.3));
      pushRect(out, Math.round(ex + (end - core) / 2), Math.round(ey + (end - core) / 2), core, core, COLORS.acao);
    }
    below = Math.round(cy + crossGap + len + gap);
    // O pavio da granada ou (M12) a recarga: a barra fina logo embaixo da retícula.
    const reload = model.reload ?? -1;
    if (model.cook >= 0 || reload >= 0) {
      const w = Math.round(34 * s);
      const h = Math.max(3, Math.round(2.5 * s));
      pushRect(out, Math.round(cx - w / 2), below, w, h, withAlpha(COLORS.bunker, 0.7));
      if (model.cook >= 0) {
        const fuse = clamp01(model.cook);
        pushRect(
          out,
          Math.round(cx - w / 2),
          below,
          Math.round(w * fuse),
          h,
          fuse < 0.35 ? COLORS.perigo : COLORS.acao,
        );
      } else pushRect(out, Math.round(cx - w / 2), below, Math.round(w * clamp01(reload)), h, COLORS.acao);
      below += h + gap;
    }
    const marker = Math.max(model.hitMarker, model.headshotMarker);
    if (marker > 0.01) {
      const step = Math.max(2, Math.round(M.hitStep * s));
      // M12 (fase 2): o "pop" abre o X 1 passo no começo; o acerto sem dano (proteção, fim da partida) é cinza.
      const pop = Math.round(clamp01(model.hitPop ?? 0) * step);
      const base = model.hitZero ? COLORS.textoBaixo : model.headshotMarker > 0.01 ? COLORS.acao : COLORS.texto;
      drawHitMarker(out, cx, cy, crossGap + step + pop, step, withAlpha(base, clamp01(marker)));
    }
    // M12 (fase 2): o X de abate, maior e em `perigo` (âmbar na cabeça), que encolhe de 1,4 a 1.
    const kill = model.killMarker ?? 0;
    if (kill > 0.01) {
      const step = Math.max(3, Math.round(M.hitStep * 1.5 * s));
      const n0 = out.count;
      const color = withAlpha(model.killHead ? COLORS.acao : COLORS.perigo, clamp01(kill));
      drawHitMarker(out, cx, cy, crossGap + step, step, color, 4);
      scaleCommands(out, n0, Math.round(cx), Math.round(cy), Math.max(1, model.killScale ?? 1));
    }
    // M12 (fase 2): embaixo da retícula empilham o "Clique para mirar", o "R recarrega", o nome da vítima e a sequência
    // ("ABATE DUPLO"), cada um só se couber acima da plaquinha do meio (interagir, plantar, caído), da dica e das
    // plaquinhas de baixo (a vista baixa do 2P a 640×360 fica só com o X).
    const lineH = Math.round(capL + pad * 2);
    const tipOn = model.tipAlpha > 0.01 && (model.tipKey !== '' || model.tipGlyph >= 0);
    const tipY = Math.round(view.y + view.height * 0.66);
    let stackLimit = (tipOn ? Math.min(bandTop, tipY) : bandTop) - gap;
    if (centerH > 0) stackLimit -= centerH + gap;
    if (model.clickToAim && below + gap + lineH <= stackLimit) {
      const w = textWidth(hud, tx.clickToAim, labelPx);
      const y = below + gap;
      plate(out, cx - w / 2 - pad, y, w + pad * 2, capL + pad * 2, s);
      paintText(out, hud, tx.clickToAim, cx, y + pad, labelPx, COLORS.texto, 0, 0.5);
      below = y + lineH + gap;
    }
    const rKey = model.reloadKey ?? '';
    const rGlyph = model.reloadGlyph ?? -1;
    const promptH = lineH + Math.max(3, Math.round(pad * 0.6)) * 2;
    if ((rKey !== '' || rGlyph >= 0) && (model.reloadText ?? '') !== '' && below + gap / 2 + promptH <= stackLimit) {
      below +=
        drawKeyPrompt(out, hud, rKey, rGlyph, model.reloadText!, cx, below + gap / 2, labelPx, capL, pad, gap, s, 1) +
        gap;
    }
    const nameA = model.killNameAlpha ?? 0;
    if (nameA > 0.01 && (model.killName ?? '') !== '' && below + lineH <= stackLimit) {
      below += drawCenterLine(out, hud, model.killName!, cx, below, labelPx, pad, s, COLORS.texto, nameA) + gap / 2;
    }
    const streakA = model.streakAlpha ?? 0;
    if (streakA > 0.01 && (model.streakText ?? '') !== '' && below + lineH <= stackLimit) {
      below += drawCenterLine(out, hud, model.streakText!, cx, below, labelPx, pad, s, COLORS.acao, streakA) + gap / 2;
    }
    if (tipOn) {
      // A dica: abaixo do meio (longe da retícula e do "Clique para mirar"), numa plaquinha.
      drawKeyPrompt(
        out,
        hud,
        model.tipKey,
        model.tipGlyph,
        model.tipText,
        cx,
        tipY,
        labelPx,
        capL,
        pad,
        gap,
        s,
        clamp01(model.tipAlpha),
      );
    }
    // A plaquinha do meio: embaixo do que empilhou, mas sempre acima das plaquinhas de baixo.
    // (Nunca por cima do que já empilhou: sem espaço, encosta na faixa de baixo.)
    below = Math.max(below, Math.min(Math.max(below, Math.round(cy + capN * 2)), Math.round(bandTop - gap - centerH)));
  } else {
    // Morto: a contagem no centro. Com o anel da primária (M2, fase 2c), ela vai em letra de rótulo, numa plaquinha
    // baixa que cabe no meio do anel; sem anel, no título grande de antes. M12 (fase 2, playtest): no toque, tudo no
    // espaço livre dos botões; o anel só até 8 opções (mais que isso, a fileira compacta embaixo da contagem: o anel
    // largo espalhava 10 nomes pela cena).
    const reserveW = touch !== HUD_TOUCH_SIDE.none ? Math.max(0, model.touchReserve ?? 0) : 0;
    const fx0 = view.x + (touch === HUD_TOUCH_SIDE.leftHanded ? reserveW : 0);
    const fx1 = view.x + view.width - (touch === HUD_TOUCH_SIDE.rightHanded ? reserveW : 0);
    const dcx = (fx0 + fx1) / 2;
    const freeW = fx1 - fx0;
    const showCount = model.respawnS > 0 && !model.waitWave;
    const count = Math.ceil(model.respawnS);
    const respawning = model.waitWave ? (model.waitText !== '' ? model.waitText : tx.waitWave) : tx.respawning;
    const smallH = Math.round(pad * 2 + capL + (showCount ? gap + capN : 0));
    const options = model.primaryNames.length;
    const r0 =
      options > 0 && options <= RING_ROUND_MAX && !compact && reserveW === 0
        ? ringRadius(view, hud, smallH, labelPx, numberPx, pad, gap, s, options)
        : 0;
    const r = r0;
    let y: number;
    let h: number;
    let pw: number;
    if (r > 0) {
      const w = Math.max(textWidth(hud, respawning, labelPx, M.labelTracking), numberWidth(hud, count, 0, numberPx));
      h = smallH;
      y = Math.round(cy - h / 2);
      pw = w + pad * 4;
      plate(out, dcx - pw / 2, y, pw, h, s);
      paintText(out, hud, respawning, dcx, y + pad, labelPx, COLORS.texto, M.labelTracking, 0.5);
      if (showCount) paintNumber(out, hud, count, 0, dcx, y + pad + capL + gap, numberPx, COLORS.acao, 0.5);
    } else {
      const headPx = fitTextPx(
        display,
        respawning,
        Math.max(M.headingPx * s, view.minTextPx),
        0.02,
        freeW - pad * 8,
        view.minTextPx,
      );
      const capH = capHeightPx(display, headPx);
      const w = Math.max(textWidth(display, respawning, headPx, 0.02), numberWidth(hud, count, 0, numberPx));
      h = Math.round(pad * 2 + capH + (showCount ? gap + capN : 0));
      // No toque, a contagem sobe (a faixa de quem matou fica no alto e a fileira em até 5 linhas embaixo dela).
      y = Math.round((reserveW > 0 ? view.y + view.height * 0.38 : cy) - h / 2);
      pw = w + pad * 4;
      plate(out, dcx - pw / 2, y, pw, h, s);
      paintText(out, display, respawning, dcx, y + pad, headPx, COLORS.texto, 0.02, 0.5);
      if (showCount) paintNumber(out, hud, count, 0, dcx, y + pad + capH + gap, numberPx, COLORS.acao, 0.5);
    }
    // M12 (fase 2): a barra que esvazia com o renascer, no pé da plaquinha da contagem (dentro do respiro de baixo).
    const respawnFrac = model.respawnFrac ?? -1;
    if (showCount && respawnFrac >= 0) {
      const bh = Math.max(2, Math.round(1.5 * s));
      const bw = Math.round(pw - pad * 2);
      const bx = Math.round(dcx - bw / 2);
      const by = Math.round(y + h - pad / 2 - bh / 2);
      pushRect(out, bx, by, bw, bh, withAlpha(COLORS.linha, 0.9));
      pushRect(out, bx, by, Math.round(bw * clamp01(respawnFrac)), bh, COLORS.acao);
    }
    // M2 (fase 2c): o menu da primária e, embaixo dele, quem matou e a dica da derrota feia (no alto ficam o placar e
    // os abates). O formato sai do espaço: anel em volta da contagem quando cabe, uma fileira embaixo dela nas vistas
    // baixas e uma linha "« arma »" no 3–4P. Os retângulos das opções vão para `primaryHit` (toque).
    const hit = model.primaryHit;
    hit.layout = PRIMARY_LAYOUT.none;
    hit.count = 0;
    hit.wide = false;
    let below2 = y + h;
    if (options > 0) {
      if (r > 0) below2 = drawPrimaryRing(out, hud, model, tx, dcx, cy, r, r, options, labelPx, pad, gap, s);
      else if (!compact) {
        // No toque a faixa de quem matou vai para o alto (embaixo do placar): a fileira tem até 5 linhas no espaço livre.
        const rows = reserveW > 0 ? MAX_PRIMARY_ROWS + 2 : MAX_PRIMARY_ROWS;
        below2 = drawPrimaryRow(
          out,
          hud,
          model,
          view,
          dcx,
          below2 + gap * 2,
          labelPx,
          pad,
          gap,
          s,
          false,
          reserveW > 0 ? 0 : -1,
          freeW,
          rows,
        );
      }
      if (hit.layout === PRIMARY_LAYOUT.none)
        below2 = drawPrimaryLine(out, hud, model, tx, dcx, below2 + gap, labelPx, pad, s);
    }
    const bannerTop =
      reserveW === 0 && (hit.layout === PRIMARY_LAYOUT.ring || hit.layout === PRIMARY_LAYOUT.row)
        ? below2 + gap * 2
        : view.y + view.height * (compact ? 0.18 : 0.14);
    drawDeathBanner(out, hud, model, tx, dcx, bannerTop, labelPx, pad, gap, s);
  }

  // M7 (fase 4): o anel da compra do BoboStrike (vivo, na compra), como o da primária da tela de morte.
  if (!model.dead && !ended && model.buyTitle !== '' && model.primaryNames.length > 0) {
    const ringH = Math.round(pad * 2 + capL);
    const n = Math.min(model.primaryNames.length, MAX_PRIMARY_OPTIONS);
    const r = ringRadius(view, hud, ringH, labelPx, numberPx, pad, gap, s, n);
    // M10: os 13 itens da loja abrem o anel numa elipse. Revisão: sem espaço para ela (a vista pequena, o 2–4P), a
    // fileira em linhas com o preço embaixo do nome e, sem espaço nem para ela, a linha "« item preço »": todo item da
    // loja aparece em todo formato (o `game` anda passo a passo fora do anel). Até 8 opções (a roda das ordens), o anel
    // redondo ou nada, como antes.
    const rx = r > 0 ? ringHalfWidth(model, view, hud, r, labelPx, pad, gap, s) : 0;
    const hit = model.primaryHit;
    hit.layout = PRIMARY_LAYOUT.none;
    hit.count = 0;
    hit.wide = false;
    if (rx > 0) drawPrimaryRing(out, hud, model, tx, cx, cy, r, rx, n, labelPx, pad, gap, s, model.buyTitle);
    else if (n > RING_ROUND_MAX) {
      const smallPx = labelPx * 0.8;
      const capS = capHeightPx(hud, smallPx);
      const titleH = Math.round(capS + pad * 2);
      // Acima do meio (na compra o bobo está parado: a mira não precisa da tela), deixando embaixo as plaquinhas de vida
      // e munição.
      const titleY = Math.round(view.y + view.height * 0.26);
      const top = titleY + titleH + gap;
      const reserve = capN + pad * 2 + gap;
      if (!compact) drawPrimaryRow(out, hud, model, view, cx, top, labelPx, pad, gap, s, true, reserve);
      if (hit.layout === PRIMARY_LAYOUT.none) drawPrimaryLine(out, hud, model, tx, cx, top, labelPx, pad, s, true);
      const lw = textWidth(hud, model.buyTitle, smallPx, 0.08);
      plate(out, cx - lw / 2 - pad, titleY, lw + pad * 2, titleH, s);
      paintText(out, hud, model.buyTitle, cx, titleY + pad, smallPx, COLORS.textoBaixo, 0.08, 0.5);
    }
  }
  // M7 (fase 4): plantando ou desarmando, no meio (o rótulo e os segundos que faltam). M12: embaixo do que já empilhou
  // embaixo da retícula.
  if (!model.dead && !ended && model.downed === HUD_DOWNED.none && model.centerLabel !== '') {
    const value = Math.max(0, Math.ceil(model.centerValue));
    const w = Math.max(
      textWidth(hud, model.centerLabel, labelPx, M.labelTracking),
      numberWidth(hud, value, 0, numberPx),
    );
    const h = Math.round(pad * 2 + capL + gap + capN);
    const y = below;
    plate(out, cx - w / 2 - pad * 2, y, w + pad * 4, h, s);
    paintText(out, hud, model.centerLabel, cx, y + pad, labelPx, COLORS.acao, M.labelTracking, 0.5);
    paintNumber(out, hud, value, 0, cx, y + pad + capL + gap, numberPx, COLORS.texto, 0.5);
  }

  if (!model.dead && !ended && model.downed !== HUD_DOWNED.none) {
    const label =
      model.downed === HUD_DOWNED.reviving ? tx.reviving : model.downed === HUD_DOWNED.selfUp ? tx.selfUp : tx.downed;
    const value = Math.max(0, Math.ceil(model.downedValue));
    const w = Math.max(textWidth(hud, label, labelPx, M.labelTracking), numberWidth(hud, value, 0, numberPx));
    const h = Math.round(pad * 2 + capL + gap + capN);
    const y = below;
    plate(out, cx - w / 2 - pad * 2, y, w + pad * 4, h, s);
    const color = model.downed === HUD_DOWNED.bleeding ? COLORS.perigo : COLORS.ok;
    paintText(out, hud, label, cx, y + pad, labelPx, color, M.labelTracking, 0.5);
    paintNumber(out, hud, value, 0, cx, y + pad + capL + gap, numberPx, COLORS.texto, 0.5);
  }

  if (
    !model.dead &&
    !ended &&
    model.downed === HUD_DOWNED.none &&
    model.centerLabel === '' &&
    model.interact !== HUD_INTERACT.none
  ) {
    // M3 (fase 3d): consertar a janela / abrir a porta, numa plaquinha embaixo da mira.
    const y = below;
    const h = Math.round(pad * 2 + capL);
    if (model.interact === HUD_INTERACT.repair || model.interact === HUD_INTERACT.text) {
      const label = model.interact === HUD_INTERACT.text ? model.interactName : tx.repair;
      const w = textWidth(hud, label, labelPx, M.labelTracking);
      plate(out, cx - w / 2 - pad * 2, y, w + pad * 4, h, s);
      paintText(out, hud, label, cx, y + pad, labelPx, COLORS.texto, M.labelTracking, 0.5);
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

  // M12 (fase 2): até 4 indicadores de dano perto da mira, girando com a vista (a origem fica no mundo); sem a lista,
  // o indicador único de antes (`damageAngle`), no mesmo desenho.
  if (!model.dead && !ended) {
    const n = Math.min(model.damageCount ?? 0, HUD_DAMAGE_ARCS);
    if (n > 0 && model.damageAngles && model.damageAlphas && model.damageWeights) {
      for (let i = 0; i < n; i++) {
        drawDamageArc(out, cx, cy, model.damageAngles[i]!, model.damageAlphas[i]!, model.damageWeights[i]!, s);
      }
    } else if (model.damageAmount > 0.01) drawDamageArc(out, cx, cy, model.damageAngle, model.damageAmount, 0.5, s);
  }
}

/** M12 (fase 2): os "+N" ficam à direita da plaquinha do alto até esta fração da vista (depois, embaixo dela). */
const GAIN_MAX_FRACTION = 0.4;
/** M12 (fase 2): quanto o "+N" sobe (px de referência) enquanto some. */
const GAIN_RISE_PX = 8;

/**
 * M12 (fase 2): a faixa do fim da partida ("VITÓRIA!", "DERROTA"…): uma faixa escura de lado a lado no meio da vista,
 * com dois traços na cor do resultado e o texto grande na fonte display; entra seca (`endBannerIn`: alfa e 8 px).
 */
function drawEndBanner(
  out: DrawList,
  display: MsdfFont | null,
  model: Readonly<HudModel>,
  view: HudViewport,
  s: number,
  compact: boolean,
  pad: number,
): void {
  const text = model.endBanner ?? '';
  const color = model.endBannerColor ?? COLORS.texto;
  const px0 = Math.max(HUD_METRICS.headingPx * s * (compact ? 1.4 : 2.2), view.minTextPx * 1.5);
  const px = fitTextPx(display, text, px0, 0.02, view.width - pad * 8, view.minTextPx);
  const capH = capHeightPx(display, px);
  const h = Math.round(capH + pad * 4);
  const x = Math.round(view.x);
  const w = Math.round(view.width);
  const y = Math.round(view.y + view.height / 2 - h / 2);
  const p = clamp01(model.endBannerIn ?? 1);
  const n0 = out.count;
  pushRect(out, x, y, w, h, COLORS.hudFundo);
  const line = Math.max(2, Math.round(1.5 * s));
  pushRect(out, x, y, w, line, color);
  pushRect(out, x, y + h - line, w, line, color);
  paintText(out, display, text, view.x + view.width / 2, y + pad * 2, px, color, 0.02, 0.5);
  if (p < 1) fadeCommands(out, n0, p, 0, enterSlidePx(p) * s);
}

// --- Tela de morte (M2, fase 2c) ---------------------------------------------------------------------------------

/**
 * Raio do anel da primária numa vista, ou 0 se ele não cabe: até 22% do lado menor, deixando embaixo a faixa de quem
 * matou (com a dica), e em cima o rótulo, o placar e os abates. Menor que `minR`, as opções dos lados (a 60° do alto)
 * encostariam na plaquinha da contagem (`centerH` de altura). M10: com mais de `RING_ROUND_MAX` opções (a elipse
 * larga), até 30% do lado menor: as opções dos lados se empilham e pedem altura.
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
  count: number,
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
  const r = Math.min(Math.min(view.height, view.width) * (count > RING_ROUND_MAX ? 0.3 : 0.22), below, above);
  // As opções dos lados ficam r/2 acima e abaixo do centro: precisam passar da contagem com meio vão de folga.
  const minR = centerH + itemH + gap;
  return r >= minR ? Math.round(r) : 0;
}

/** M10: rascunho das larguras das opções (o anel largo e a fileira em linhas; sem alocar por quadro). */
const optionW = new Float64Array(MAX_PRIMARY_OPTIONS);

/** Largura da plaquinha da opção `i` do anel (o nome com espaçamento de rótulo, ou a categoria embaixo). */
function ringItemWidth(
  model: Readonly<HudModel>,
  font: MsdfFont | null,
  i: number,
  labelPx: number,
  pad: number,
): number {
  const name = model.primaryNames[i]!;
  const cat = model.primaryCategories[i] ?? '';
  return (
    Math.max(textWidth(font, name, labelPx, HUD_METRICS.labelTracking), textWidth(font, cat, labelPx * 0.8)) + pad * 2
  );
}

/**
 * M10: o meio-eixo horizontal do anel de altura `r`: o próprio `r` (o círculo) até `RING_ROUND_MAX` opções; com mais, o
 * do anel largo (`fitWideRing`); 0 = não cabe.
 */
function ringHalfWidth(
  model: Readonly<HudModel>,
  view: HudViewport,
  font: MsdfFont | null,
  r: number,
  labelPx: number,
  pad: number,
  gap: number,
  s: number,
): number {
  return model.primaryNames.length <= RING_ROUND_MAX ? r : fitWideRing(model, view, font, r, labelPx, pad, gap, s);
}

/** M10: o ângulo de cada opção no anel largo (a partir do alto, no sentido horário), de `fitWideRing`. */
const ringAngle = new Float64Array(MAX_PRIMARY_OPTIONS);
/** Passo da procura do ângulo de cada opção no anel largo (rad: 1°). */
const RING_SCAN_STEP = Math.PI / 180;

/** As plaquinhas das opções `i` e `j` nos ângulos `a` e `b` da elipse (`rx`, `ry`) se tocam (com o vão `gap`)? */
function ringClash(
  i: number,
  j: number,
  a: number,
  b: number,
  rx: number,
  ry: number,
  h: number,
  gap: number,
): boolean {
  const dx = Math.abs(Math.sin(a) - Math.sin(b)) * rx;
  const dy = Math.abs(Math.cos(a) - Math.cos(b)) * ry;
  return dx < (optionW[i]! + optionW[j]!) / 2 + gap && dy < h + gap;
}

/** Nenhum par de opções do anel largo (nos ângulos de `ringAngle`) se toca? */
function ringClear(n: number, rx: number, ry: number, h: number, gap: number): boolean {
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) if (ringClash(i, j, ringAngle[i]!, ringAngle[j]!, rx, ry, h, gap)) return false;
  }
  return true;
}

/**
 * Arruma as `n` opções na elipse (`rx`, `ry`) em `ringAngle`: a 1ª no alto e cada uma no 1º ângulo, de grau em grau,
 * em que não toca a anterior, mais `extra` (rad). Cabe se a última não toca a 1ª na volta e nenhum par se toca.
 */
function packRing(n: number, rx: number, ry: number, h: number, gap: number, extra: number): boolean {
  const TAU = Math.PI * 2;
  ringAngle[0] = 0;
  for (let k = 1; k < n; k++) {
    let a = ringAngle[k - 1]! + RING_SCAN_STEP;
    while (a < TAU && ringClash(k - 1, k, ringAngle[k - 1]!, a, rx, ry, h, gap)) a += RING_SCAN_STEP;
    a += extra;
    if (a >= TAU) return false;
    ringAngle[k] = a;
  }
  return !ringClash(n - 1, 0, ringAngle[n - 1]!, TAU, rx, ry, h, gap) && ringClear(n, rx, ry, h, gap);
}

/**
 * Cache do anel largo: a mesma lista (as mesmas referências) na mesma vista e na mesma fonte não refaz a conta a cada
 * quadro. A chave são números (sem montar texto por quadro) e as referências da lista e da fonte.
 */
let wideNames: readonly string[] | null = null;
let wideCats: readonly string[] | null = null;
let wideFont: MsdfFont | null = null;
const WIDE_KEY_FIELDS = 10;
const wideKey = new Float64Array(WIDE_KEY_FIELDS);
let wideRx = 0;

/** Grava o campo `i` da chave do cache do anel largo; devolve `same` e se o campo já era este. */
function wideKeyPut(i: number, v: number, same: boolean): boolean {
  const was = wideKey[i] === v;
  wideKey[i] = v;
  return same && was;
}

/**
 * M10: o anel largo (mais de `RING_ROUND_MAX` opções): uma elipse da altura `r` e da maior largura que cabe na vista
 * (até 3 vezes a altura). As opções não ficam em ângulos iguais (as dos lados se empilham, as de cima e de baixo
 * ficam lado a lado): `packRing`, com o maior vão extra igual entre elas que ainda cabe (por bissecção), para a volta
 * ficar repartida. Devolve a largura (o meio-eixo horizontal), com os ângulos em `ringAngle`, ou 0 se não couber (a
 * tela de morte cai na fileira ou na linha; a loja do BoboStrike não mostra o anel). O cursor escolhe pela direção da
 * plaquinha (`PrimaryHit.wide`).
 */
function fitWideRing(
  model: Readonly<HudModel>,
  view: HudViewport,
  font: MsdfFont | null,
  r: number,
  labelPx: number,
  pad: number,
  gap: number,
  s: number,
): number {
  const n = model.primaryNames.length;
  if (n > MAX_PRIMARY_OPTIONS) return 0;
  // M10 (revisão): a chave leva a fonte (a referência) e a escala da margem, além da vista e dos tamanhos.
  let same = wideKeyPut(0, n, true);
  same = wideKeyPut(1, view.width, same);
  same = wideKeyPut(2, view.height, same);
  same = wideKeyPut(3, view.insetLeft, same);
  same = wideKeyPut(4, view.insetRight, same);
  same = wideKeyPut(5, r, same);
  same = wideKeyPut(6, labelPx, same);
  same = wideKeyPut(7, pad, same);
  same = wideKeyPut(8, gap, same);
  same = wideKeyPut(9, s, same);
  same = same && font === wideFont && model.primaryNames === wideNames && model.primaryCategories === wideCats;
  if (same) return wideRx;
  const capL = capHeightPx(font, labelPx);
  const capS = capHeightPx(font, labelPx * 0.8);
  const h = Math.round(pad * 2 + capL + gap * 0.5 + capS);
  let maxW = 0;
  for (let i = 0; i < n; i++) {
    optionW[i] = ringItemWidth(model, font, i, labelPx, pad);
    if (optionW[i]! > maxW) maxW = optionW[i]!;
  }
  const margin = Math.max(HUD_METRICS.marginX * s, view.insetLeft, view.insetRight);
  let rx = Math.min(r * 3, view.width / 2 - margin - maxW / 2);
  if (rx < r || !packRing(n, rx, r, h, gap, 0)) rx = 0;
  else {
    // O maior vão extra (até uma fatia igual da volta) com que tudo ainda cabe.
    let lo = 0;
    let hi = (Math.PI * 2) / n;
    for (let it = 0; it < 10; it++) {
      const mid = (lo + hi) / 2;
      if (packRing(n, rx, r, h, gap, mid)) lo = mid;
      else hi = mid;
    }
    packRing(n, rx, r, h, gap, lo);
  }
  wideNames = model.primaryNames;
  wideCats = model.primaryCategories;
  wideFont = font;
  wideRx = rx;
  return rx;
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
  // M12 (fase 2): "· NA CABEÇA" no fim da linha, em âmbar.
  const headW = model.deathHead === true ? sepW + textWidth(hud, tx.head, labelPx, HUD_METRICS.labelTracking) : 0;
  const lineW = nameW + weaponW + hpW + headW;
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
    x += paintText(out, hud, tx.hp, x, ly, labelPx, COLORS.textoBaixo);
  }
  if (headW > 0) {
    x += paintText(out, hud, tx.weaponSeparator, x, ly, labelPx, COLORS.textoBaixo);
    paintText(out, hud, tx.head, x, ly, labelPx, COLORS.acao, HUD_METRICS.labelTracking);
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
 * sentido horário; a escolhida em âmbar. Em cima do anel, "ARMA DA PRÓXIMA VIDA". Devolve o y de baixo do anel. M10:
 * com mais de 8 opções, o anel largo: a elipse de meio-eixo `rx`, nos ângulos de `fitWideRing` (o centro vai para o
 * `primaryHit`, para o cursor escolher pela direção). Desenha as `count` primeiras (a loja na vista pequena: as 8).
 */
function drawPrimaryRing(
  out: DrawList,
  hud: MsdfFont | null,
  model: Readonly<HudModel>,
  tx: HudTexts,
  cx: number,
  cy: number,
  r: number,
  rx: number,
  count: number,
  labelPx: number,
  pad: number,
  gap: number,
  s: number,
  title: string = tx.choose,
): number {
  const n = Math.min(count, model.primaryNames.length, MAX_PRIMARY_OPTIONS);
  const capL = capHeightPx(hud, labelPx);
  const smallPx = labelPx * 0.8;
  const capS = capHeightPx(hud, smallPx);
  const h = Math.round(pad * 2 + capL + gap * 0.5 + capS);
  let bottom = cy;
  let topY = cy;
  const wide = n > RING_ROUND_MAX;
  model.primaryHit.wide = wide;
  model.primaryHit.centerX = cx;
  model.primaryHit.centerY = cy;
  for (let i = 0; i < n; i++) {
    const a = wide ? ringAngle[i]! : (i / n) * Math.PI * 2;
    const ix = cx + Math.sin(a) * rx;
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
  const lw = textWidth(hud, title, smallPx, 0.08);
  const ly = Math.round(topY - gap - capS - pad * 2);
  plate(out, cx - lw / 2 - pad, ly, lw + pad * 2, capS + pad * 2, s);
  paintText(out, hud, title, cx, ly + pad, smallPx, COLORS.textoBaixo, 0.08, 0.5);
  model.primaryHit.layout = PRIMARY_LAYOUT.ring;
  return bottom;
}

/**
 * Vistas baixas (640×360, celular): as opções numa fileira centrada embaixo da contagem, só com o nome (sem o
 * espaçamento de rótulo, para caber); a escolhida em
 * âmbar. Se a fileira não couber na largura, não desenha (fica a linha "« arma »"). Devolve o y de baixo. M10 (revisão):
 * `cats` põe a categoria (o preço, na loja do BoboStrike) embaixo do nome, em letra menor.
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
  cats = false,
  reserveBelow = -1,
  /** M12 (fase 2): a largura livre (no toque, sem a coluna dos botões); < 0 = a vista inteira. */
  freeW = -1,
  /** M12 (fase 2): até quantas linhas (no toque, com a faixa de quem matou no alto, cabem mais). */
  maxRows: number = MAX_PRIMARY_ROWS,
): number {
  const n = Math.min(model.primaryNames.length, MAX_PRIMARY_OPTIONS);
  const smallPx = labelPx * 0.8;
  let total = gap * (n - 1);
  for (let i = 0; i < n; i++) {
    const nameW = textWidth(hud, model.primaryNames[i]!, labelPx);
    optionW[i] = (cats ? Math.max(nameW, textWidth(hud, model.primaryCategories[i] ?? '', smallPx)) : nameW) + pad * 2;
    total += optionW[i]!;
  }
  const avail =
    (freeW >= 0 ? freeW : view.width) - 2 * Math.max(HUD_METRICS.marginX * s, view.insetLeft, view.insetRight);
  const capL = capHeightPx(hud, labelPx);
  const capCat = cats ? capHeightPx(hud, smallPx) : 0;
  const h = Math.round(capL + pad * 2 + (cats ? gap * 0.5 + capCat : 0));
  // M10: sem caber numa linha (as 10 primárias no 640×360), quebra em até `MAX_PRIMARY_ROWS` linhas iguais (a ordem
  // segue da esquerda para a direita, linha a linha), se couberem acima da faixa de quem matou; senão, a linha "« »".
  let rows = 1;
  let per = n;
  if (total > avail) {
    rows = 0;
    for (let k = 2; k <= maxRows && rows === 0; k++) {
      const p = Math.ceil(n / k);
      let fits = true;
      for (let first = 0; first < n && fits; first += p) fits = rowWidth(first, Math.min(n, first + p), gap) <= avail;
      if (fits) {
        rows = k;
        per = p;
      }
    }
    const capS = capHeightPx(hud, labelPx * 0.8);
    // Embaixo, a faixa de quem matou (com a dica); a loja (revisão) diz quanto reservar.
    const bannerH = reserveBelow >= 0 ? reserveBelow : pad * 2 + capS + gap + capL + gap + capL;
    const bottomEdge = view.y + view.height - Math.max(view.insetBottom, HUD_METRICS.marginY * s);
    if (rows === 0 || top + rows * h + (rows - 1) * gap + gap * 2 + bannerH > bottomEdge) return top;
  }
  let y = Math.round(top);
  for (let first = 0; first < n; first += per) {
    const last = Math.min(n, first + per);
    let x = cx - rowWidth(first, last, gap) / 2;
    for (let i = first; i < last; i++) {
      const name = model.primaryNames[i]!;
      const w = optionW[i]!;
      const chosen = i === model.primarySelected;
      if (chosen) pushShape(out, Math.round(x), y, Math.round(w), h, COLORS.acao, Math.round(5 * s));
      else plate(out, x, y, w, h, s);
      noteOption(model, i, Math.round(x), y, Math.round(w), h);
      paintText(out, hud, name, x + pad, y + pad, labelPx, chosen ? COLORS.textoSobreAcao : COLORS.texto);
      if (cats) {
        const cat = model.primaryCategories[i] ?? '';
        const catY = y + pad + capL + gap * 0.5;
        paintText(out, hud, cat, x + pad, catY, smallPx, chosen ? COLORS.textoSobreAcao : COLORS.textoBaixo);
      }
      x += w + gap;
    }
    if (last < n) y += h + Math.round(gap);
  }
  model.primaryHit.layout = PRIMARY_LAYOUT.row;
  return y + h;
}

/** M10: largura de uma linha da fileira (as opções de `first` até antes de `last`, com os vãos). */
function rowWidth(first: number, last: number, gap: number): number {
  let w = gap * (last - first - 1);
  for (let i = first; i < last; i++) w += optionW[i]!;
  return w;
}

/**
 * 3–4P (ou fileira sem espaço): só a escolhida, "« Rattler »", abaixo da contagem. Devolve o y de baixo. M10 (revisão):
 * `cats` põe a categoria (o preço, na loja) depois do nome; sem escolha ainda (-1, a loja recém-aberta), mostra a 1ª
 * opção apagada.
 */
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
  cats = false,
): number {
  const sel = model.primarySelected;
  const shown = sel < 0 ? 0 : sel;
  const name = model.primaryNames[shown] ?? '';
  const cat = cats ? (model.primaryCategories[shown] ?? '') : '';
  const capL = capHeightPx(hud, labelPx);
  const space = cat !== '' ? Math.round(labelPx * 0.4) : 0;
  const w =
    textWidth(hud, name, labelPx, HUD_METRICS.labelTracking) +
    (cat !== '' ? space + textWidth(hud, cat, labelPx) : 0) +
    textWidth(hud, tx.cyclePrev, labelPx) +
    textWidth(hud, tx.cycleNext, labelPx);
  const h = Math.round(capL + pad * 2);
  const y = Math.round(top);
  plate(out, cx - w / 2 - pad, y, w + pad * 2, h, s);
  let x = cx - w / 2;
  x += paintText(out, hud, tx.cyclePrev, x, y + pad, labelPx, COLORS.acao);
  const fg = sel < 0 ? COLORS.textoBaixo : COLORS.texto;
  x += paintText(out, hud, name, x, y + pad, labelPx, fg, HUD_METRICS.labelTracking);
  if (cat !== '') x += space + paintText(out, hud, cat, x + space, y + pad, labelPx, COLORS.textoBaixo);
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
  /**
   * M10 (fase 8): a cor de cada time (0..3, RGBA) na partida: a do `TEAM_COLORS`, ou a que o Sandbox escolheu. O `game`
   * preenche uma vez.
   */
  readonly teamColors: number[];
  /** M2 (fase 2d): morte súbita (uma plaquinha "MORTE SÚBITA" embaixo do placar). */
  suddenDeath: boolean;
  /**
   * M2 (fase 5d): Bobo Training: a linha dos números no lugar do placar ("Precisão 34% · TTK médio 0,8 s…"; `''` = placar
   * normal). O `game` só refaz a string quando os números mudam.
   */
  trainingLine: string;
  /** M3 (fase 7a): o minimapa ocupa o quadrante livre (o placar sobe para o alto, no tamanho normal). */
  spareMap: boolean;
  /**
   * M6 (fase 1): os pontos do Domination embaixo do placar (0 = sem pontos): o dono de cada um (-1 = neutro) e o
   * progresso (-1, do time 1, a +1, do time 0).
   */
  points: number;
  readonly pointOwner: Int8Array;
  readonly pointProgress: Float32Array;
  /**
   * M6 (fase 4): a linha dos modificadores embaixo do placar (`''` = nenhum): os ligados ("LUA · VAMPIRO") ou, no aviso
   * da Roleta (`modsWarn`), o que sai e o que entra. O `game` só refaz a string quando a máscara muda.
   */
  modsLine: string;
  modsWarn: boolean;
  /**
   * M12 (fase 2): o seu time (um traço de 2 px na cor dele embaixo do placar dele; -1 = nenhum, como no versus do sofá)
   * e a batida de cada placar que mudou (0..1, por time).
   */
  ownTeam?: number;
  readonly teamBeat?: Float32Array;
  /** M12 (fase 2, playtest): o rótulo curto antes do relógio ("FECHA EM", no Royale); `''` = só o relógio. */
  clockLabel?: string;
}

export function createHudSharedModel(): HudSharedModel {
  return {
    timeLeftS: -1,
    teamCount: 0,
    teamScores: [0, 0, 0, 0],
    teamColors: TEAM_COLORS.slice(0, 4),
    suddenDeath: false,
    trainingLine: '',
    modsLine: '',
    modsWarn: false,
    spareMap: false,
    points: 0,
    pointOwner: new Int8Array(MAX_CONTROL_POINTS).fill(-1),
    pointProgress: new Float32Array(MAX_CONTROL_POINTS),
    ownTeam: -1,
    teamBeat: new Float32Array(4),
    clockLabel: '',
  };
}

/**
 * M6 (fase 1): a fileira dos pontos do Domination, centrada em `cx` a partir de `y`: uma plaquinha por ponto com a
 * letra na cor do dono e, embaixo, a barra da captura (a fração e a cor de quem está ganhando o ponto). Devolve a
 * altura usada.
 */
function paintPointsRow(
  out: DrawList,
  font: MsdfFont | null,
  model: Readonly<HudSharedModel>,
  cx: number,
  y: number,
  s: number,
  minTextPx: number,
): number {
  const n = Math.min(model.points, MAX_CONTROL_POINTS);
  if (n <= 0) return 0;
  const letters = hudTexts().pointLetters;
  const px = hudLabelPx(s, minTextPx);
  const pad = hudPad(s);
  const cell = Math.round(capHeightPx(font, px) + pad * 2);
  const gap = Math.max(3, Math.round(HUD_METRICS.gap * s));
  const bar = Math.max(2, Math.round(3 * s));
  const total = n * cell + (n - 1) * gap;
  let x = Math.round(cx - total / 2);
  for (let i = 0; i < n; i++) {
    const owner = model.pointOwner[i]!;
    const p = model.pointProgress[i]!;
    plate(out, x, y, cell, cell + bar + 1, s);
    paintText(out, font, letters[i] ?? '', x + cell / 2, y + pad, px, pointColor(owner), 0, 0.5);
    // A barra: o tamanho da posse (|p|) na cor de quem tem a vantagem; cheia e do dono = a cor dele inteira.
    const frac = p > 0 ? p : -p;
    if (frac > 0.001) {
      const team = p > 0 ? 0 : 1;
      pushRect(out, x, y + cell, Math.max(1, Math.round(cell * frac)), bar, pointColor(team));
    }
    x += cell + gap;
  }
  return cell + bar + 1;
}

/**
 * M3 (fase 7a): a faixa do alto do quadrante livre que o placar ocupa quando o minimapa está lá (px; 0 = sem placar):
 * o minimapa desenha embaixo dela.
 */
export function hudSpareTopBand(area: HudSharedArea, model: Readonly<HudSharedModel>): number {
  if (model.timeLeftS < 0 && model.teamCount <= 0) return 0;
  const s = area.scale > 0 ? area.scale : 1;
  return hudSharedPlateHeight(s, area.minTextPx) + Math.max(3, Math.round(HUD_METRICS.gap * s)) * 2;
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
  labelPx: number,
): number {
  let w = 0;
  const teams = Math.max(0, Math.min(4, Math.trunc(model.teamCount)));
  for (let i = 0; i < teams; i++) {
    w += icon + gap / 2 + numberWidth(font, model.teamScores[i] ?? 0, 0, numberPx);
  }
  if (model.timeLeftS >= 0) {
    const total = Math.ceil(model.timeLeftS);
    const label = model.clockLabel ?? '';
    if (label !== '') w += textWidth(font, label, labelPx, HUD_METRICS.labelTracking) + gap;
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

/**
 * Placar e tempo numa linha: metade dos times, o relógio, a outra metade. Devolve a largura. M12 (fase 2): o seu time
 * com o traço embaixo, o placar que mudou com a batida, o relógio âmbar a 60 s e vermelho a 10 s.
 */
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
  s: number,
  labelPx: number,
): number {
  const teams = Math.max(0, Math.min(4, Math.trunc(model.teamCount)));
  const hasTime = model.timeLeftS >= 0;
  const leftTeams = hasTime ? Math.ceil(teams / 2) : teams;
  let pen = x;
  for (let i = 0; i < leftTeams; i++) {
    pen += paintTeamScore(out, font, model, i, pen, capTop, numberPx, icon, gap, s);
    if (hasTime || i < teams - 1) pen += gap * 2;
  }
  if (hasTime) {
    const total = Math.ceil(model.timeLeftS);
    const color = total <= 10 ? COLORS.perigo : total <= 60 ? COLORS.acao : COLORS.texto;
    const label = model.clockLabel ?? '';
    if (label !== '') {
      const lpx = labelPx;
      const capN = capHeightPx(font, numberPx);
      const capS = capHeightPx(font, lpx);
      pen += paintText(out, font, label, pen, capTop + capN - capS, lpx, COLORS.textoBaixo, HUD_METRICS.labelTracking);
      pen += gap;
    }
    pen += paintText(out, font, tx.time[0] as string, pen, capTop, numberPx, color);
    pen += paintNumber(out, font, Math.floor(total / 60), 0, pen, capTop, numberPx, color);
    pen += paintText(out, font, tx.time[1] as string, pen, capTop, numberPx, color);
    pen += paintNumber(out, font, total % 60, 0, pen, capTop, numberPx, color, 0, 2);
    pen += paintText(out, font, tx.time[2] as string, pen, capTop, numberPx, color);
  }
  for (let i = leftTeams; i < teams; i++) {
    pen += gap * 2;
    pen += paintTeamScore(out, font, model, i, pen, capTop, numberPx, icon, gap, s);
  }
  return pen - x;
}

/**
 * Ícone + placar de um time, na cor do time. Devolve a largura. M12 (fase 2): o número que mudou dá uma batida (escala
 * em volta do meio dele) e o seu time ganha um traço de 2 px embaixo, na cor dele.
 */
function paintTeamScore(
  out: DrawList,
  font: MsdfFont | null,
  model: Readonly<HudSharedModel>,
  team: number,
  x: number,
  capTop: number,
  numberPx: number,
  icon: number,
  gap: number,
  s: number,
): number {
  const score = model.teamScores[team] ?? 0;
  const color = model.teamColors[team] ?? COLORS.texto;
  const capN = capHeightPx(font, numberPx);
  paintIcon(out, team, x, capTop + (capN - icon) / 2, icon, color);
  const n0 = out.count;
  const nx = x + icon + gap / 2;
  const nw = paintNumber(out, font, score, 0, nx, capTop, numberPx, color);
  const beat = model.teamBeat?.[team] ?? 0;
  if (beat > 0.001) scaleCommands(out, n0, nx + nw / 2, capTop + capN / 2, 1 + 0.3 * clamp01(beat));
  const w = icon + gap / 2 + nw;
  if (model.ownTeam === team) {
    const th = Math.max(2, Math.round(s));
    pushRect(out, Math.round(x), Math.round(capTop + capN + Math.max(1, Math.round(s))), Math.round(w), th, color);
  }
  return w;
}

/** M6 (fase 4): as duas metades da linha dos modificadores quando ela não cabe (refeitas só quando a linha muda). */
let modsSplitOf = '';
let modsSplitA = '';
let modsSplitB = '';
const MODS_SEPARATOR = ' · ';

function splitModsLine(line: string): void {
  if (line === modsSplitOf) return;
  modsSplitOf = line;
  // O separador (ou, no aviso, o espaço) mais perto do meio.
  const mid = line.length / 2;
  let best = -1;
  let bestLen = 0;
  for (const sep of [MODS_SEPARATOR, ', ', ' ']) {
    for (let i = line.indexOf(sep); i >= 0; i = line.indexOf(sep, i + 1)) {
      if (best < 0 || Math.abs(i - mid) < Math.abs(best - mid)) {
        best = i;
        bestLen = sep.length;
      }
    }
    if (best >= 0) break;
  }
  if (best < 0) {
    modsSplitA = line;
    modsSplitB = '';
    return;
  }
  // A vírgula do aviso fica na 1ª metade.
  modsSplitA = line.slice(0, line[best] === ',' ? best + 1 : best);
  modsSplitB = line.slice(best + bestLen);
}

/**
 * M6 (fase 4): a linha dos modificadores centrada em `cx`, a partir de `top` (em duas linhas quando passa de `maxW`);
 * devolve a altura usada (0 sem linha). O aviso da Roleta vai em destaque.
 */
function drawModsLine(
  out: DrawList,
  font: MsdfFont | null,
  model: Readonly<HudSharedModel>,
  cx: number,
  top: number,
  s: number,
  minTextPx: number,
  maxW: number,
): number {
  if (model.modsLine === '') return 0;
  const pad = hudPad(s);
  const px = hudLabelPx(s, minTextPx);
  const color = model.modsWarn ? COLORS.acao : COLORS.texto;
  const lineH = Math.round(capHeightPx(font, px) + pad * 2);
  const one = (text: string, y: number): void => {
    const w = textWidth(font, text, px, HUD_METRICS.labelTracking);
    plate(out, Math.round(cx - w / 2 - pad), y, Math.round(w + pad * 2), lineH, s);
    paintText(out, font, text, cx, y + pad, px, color, HUD_METRICS.labelTracking, 0.5);
  };
  if (textWidth(font, model.modsLine, px, HUD_METRICS.labelTracking) + pad * 2 <= maxW) {
    one(model.modsLine, Math.round(top));
    return lineH;
  }
  splitModsLine(model.modsLine);
  one(modsSplitA, Math.round(top));
  if (modsSplitB === '') return lineH;
  one(modsSplitB, Math.round(top + lineH));
  return lineH * 2;
}

/**
 * Desenha o placar e o tempo na área compartilhada (ver `layoutHudScreen`). Sem relógio e sem times, só o fundo do
 * quadrante livre (3P). Sem alocação. M12 (fase 2): `bounds` recebe o retângulo da plaquinha do placar (x, y, largura,
 * altura; largura 0 = nenhuma no alto nem no centro), para o kill feed não passar dela; com 5 posições, a 5ª é o pé de
 * tudo o que vem embaixo dela.
 */
export function drawHudShared(
  out: DrawList,
  fonts: UiFonts | null,
  model: Readonly<HudSharedModel>,
  area: HudSharedArea,
  bounds?: Float32Array,
): void {
  if (bounds !== undefined) bounds.fill(0);
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
    drawModsLine(out, font, model, area.x + area.width / 2, y + h + gap, s, area.minTextPx, area.width - pad * 2);
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
    if (!hasContent) {
      // M6 (fase 6a): o Bobo Zombies (sem relógio nem placar) mostra a linha da onda (com o gerador) no quadrante.
      let top = area.y + gap;
      if (model.trainingLine !== '') {
        const px = hudLabelPx(s, area.minTextPx);
        const w = textWidth(font, model.trainingLine, px) + pad * 2;
        const h = capHeightPx(font, px) + pad * 2;
        const x = Math.round(area.x + (area.width - w) / 2);
        plate(out, x, Math.round(top), w, h, s);
        paintText(out, font, model.trainingLine, x + pad, Math.round(top) + pad, px, COLORS.texto);
        top += h + gap;
      }
      drawModsLine(out, font, model, area.x + area.width / 2, top, s, area.minTextPx, area.width - pad * 2);
      return;
    }
    if (model.spareMap) {
      // M3 (fase 7a): com o minimapa embaixo, o placar no alto do quadrante, no tamanho normal.
      const numberPx = hudNumberPx(s, area.minTextPx);
      const capN = capHeightPx(font, numberPx);
      const icon = Math.round(capN * 0.8);
      const w = sharedContentWidth(font, model, numberPx, icon, gap, tx, hudLabelPx(s, area.minTextPx)) + pad * 2;
      const h = hudSharedPlateHeight(s, area.minTextPx);
      const x = Math.round(area.x + (area.width - w) / 2);
      const y = Math.round(area.y + gap);
      plate(out, x, y, w, h, s);
      paintSharedLine(
        out,
        font,
        model,
        x + pad,
        y + (h - capN) / 2,
        numberPx,
        icon,
        gap,
        tx,
        s,
        hudLabelPx(s, area.minTextPx),
      );
      drawModsLine(out, font, model, area.x + area.width / 2, y + h + gap, s, area.minTextPx, area.width - pad * 2);
      return;
    }
    // Quadrante livre: o mesmo placar, em dobro, centrado.
    const numberPx = hudNumberPx(s, area.minTextPx) * 2;
    const icon = Math.round(capHeightPx(font, numberPx) * 0.8);
    const w = sharedContentWidth(font, model, numberPx, icon, gap, tx, hudLabelPx(s, area.minTextPx));
    const capN = capHeightPx(font, numberPx);
    const x = area.x + (area.width - w) / 2;
    paintSharedLine(
      out,
      font,
      model,
      x,
      area.y + (area.height - capN) / 2,
      numberPx,
      icon,
      gap,
      tx,
      s,
      hudLabelPx(s, area.minTextPx),
    );
    const below3 = area.y + (area.height + capN) / 2 + gap;
    drawModsLine(out, font, model, area.x + area.width / 2, below3, s, area.minTextPx, area.width - pad * 2);
    return;
  }
  if (!hasContent) {
    // M6 (fase 4): sem relógio e sem placar (FFA sem tempo), só a linha dos modificadores, no lugar do placar.
    const top =
      area.mode === 'top'
        ? area.y + Math.max(area.insetTop, HUD_METRICS.marginY * s)
        : area.y + area.height / 2 - (capHeightPx(font, hudLabelPx(s, area.minTextPx)) / 2 + pad);
    drawModsLine(out, font, model, area.x + area.width / 2, top, s, area.minTextPx, area.width - pad * 2);
    return;
  }
  const numberPx = hudNumberPx(s, area.minTextPx);
  const capN = capHeightPx(font, numberPx);
  const icon = Math.round(capN * 0.8);
  const w = sharedContentWidth(font, model, numberPx, icon, gap, tx, hudLabelPx(s, area.minTextPx)) + pad * 2;
  const h = hudSharedPlateHeight(s, area.minTextPx);
  const x = Math.round(area.x + (area.width - w) / 2);
  const y =
    area.mode === 'top'
      ? Math.round(area.y + Math.max(area.insetTop, HUD_METRICS.marginY * s))
      : Math.round(area.y + (area.height - h) / 2);
  plate(out, x, y, w, h, s);
  if (bounds !== undefined) {
    bounds[0] = x;
    bounds[1] = y;
    bounds[2] = Math.round(w);
    bounds[3] = h;
  }
  paintSharedLine(
    out,
    font,
    model,
    x + pad,
    y + (h - capN) / 2,
    numberPx,
    icon,
    gap,
    tx,
    s,
    hudLabelPx(s, area.minTextPx),
  );
  // M6 (fase 1): os pontos do Domination embaixo do placar (a morte súbita vai embaixo deles).
  const rowH = paintPointsRow(out, font, model, area.x + area.width / 2, Math.round(y + h + gap), s, area.minTextPx);
  let below = Math.round(y + h + gap + (rowH > 0 ? rowH + gap : 0));
  if (model.suddenDeath) {
    const px = hudLabelPx(s, area.minTextPx);
    const sw = textWidth(font, tx.suddenDeath, px, HUD_METRICS.labelTracking);
    const sy = below;
    below += Math.round(capHeightPx(font, px) + pad * 2 + gap);
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
  const modsH = drawModsLine(out, font, model, area.x + area.width / 2, below, s, area.minTextPx, area.width - pad * 2);
  // M12 (fase 2, revisão): o pé de tudo o que vem embaixo da plaquinha (os pontos, a morte súbita, os modificadores).
  if (bounds !== undefined && bounds.length > 4) bounds[4] = below + modsH;
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

/** Deslocamento (x, y) de cada botão de face na cruz: baixo, direita, esquerda, cima. */
const FACE_OFFSETS = [0, 1, 1, 0, -1, 0, 0, -1] as const;

/**
 * M4 (fase 4a): o glifo genérico do botão de face num quadrado de lado `size`: 4 quadradinhos em cruz, o `active`
 * aceso e os outros apagados (a mesma posição em qualquer controle; sem letra e sem desenho de marca). Apagado é
 * cheio e fraco, não contorno: no tamanho da dica, o contorno de 1–2 px vira borrão.
 */
function drawFaceGlyph(out: DrawList, x: number, y: number, size: number, active: number, a: number): void {
  const q = Math.max(3, Math.round(size * 0.3));
  const o = Math.round(size * 0.33);
  const cx = x + size / 2;
  const cy = y + size / 2;
  for (let i = 0; i < 4; i++) {
    const bx = Math.round(cx + FACE_OFFSETS[i * 2]! * o - q / 2);
    const by = Math.round(cy + FACE_OFFSETS[i * 2 + 1]! * o - q / 2);
    pushShape(out, bx, by, q, q, withAlpha(COLORS.acao, i === active ? a : a * 0.3), 0);
  }
}
