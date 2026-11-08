/**
 * Aparência do boneco do FutBobo (decisão #56; PLANO do porte §B7, §B15 e §C3). CONTRATO dos tipos; o normalizador, a
 * farda efetiva (com o equipamento do time), a trava de cor e a chave da skin são da frente F2 (pintura). Cores em RGB
 * (`0xRRGGBB`); índices de rosto e cabelo nas listas do FutBobo (`app/player-appearance.ts`), na mesma ordem.
 *
 * Roupa militar (decisão #58): sai o uniforme de futebol (camisa, número, escudo, meião e chuteira); o boneco veste uma
 * farda (jaqueta e calça, lisa ou camuflada), colete, luvas e botas de combate. O formato serve ao editor "Meu Bobo" do
 * M2: o jogador escolhe o tecido e as cores de cada peça, e o save versionado guarda o look como está aqui.
 *
 * Sem `version` dentro do look: a versão vai no id do formato. Por isso o normalizador faz SÓ clamp, sem o ramo legado
 * do `normalizePlayerAppearance` do FutBobo (com ele, os 8 visuais do teste mudariam; estudo de pintura §2.2).
 */
import { ZOMBIE_KINDS, type ZombieKind } from './bobo.ts';

/**
 * Tecidos da farda (o padrão que vai no tronco; os membros ficam no tom principal). Ordem fixa: o índice vai no save do
 * editor. Liso, os 4 camuflados (woodland, deserto, urbano cinza, noturno) e o liso manchado de graxa do mecânico.
 */
export const FIGURE_FABRIC = { plain: 0, woodland: 1, desert: 2, urban: 3, night: 4, grease: 5 } as const;
export type FigureFabric = (typeof FIGURE_FABRIC)[keyof typeof FIGURE_FABRIC];
/** Quantos tecidos existem (o normalizador clampa em 0..n − 1). */
export const FIGURE_FABRICS = 6;

/**
 * A farda do look (fora de time; com time, `figureOutfitFor` troca o colete e as luvas pelos do time). `vest` e `gloves`
 * aceitam −1 = sem a peça.
 */
export interface FigureOutfit {
  /** Índice de `FIGURE_FABRIC` (0..5). */
  readonly fabric: number;
  /** 0xRRGGBB: tom principal do tecido (jaqueta e mangas; os camuflados tiram os outros tons dele). */
  readonly jacket: number;
  /** 0xRRGGBB: calça. */
  readonly pants: number;
  /** 0xRRGGBB do colete e das joelheiras (o "equipamento"); −1 = sem colete. */
  readonly vest: number;
  /** 0xRRGGBB das botas de combate. */
  readonly boots: number;
  /** 0xRRGGBB das luvas; −1 = mão nua. */
  readonly gloves: number;
}

export interface FigureZombie {
  readonly kind: ZombieKind;
  /** 0..7. */
  readonly faceStyle: number;
}

export interface FigureLook {
  /** RGB. */
  readonly skinTone: number;
  readonly hair: number;
  /** Topo do cabelo (o "Descolorido" do FutBobo tem o topo claro); igual a `hair` nos outros cortes. */
  readonly hairTop: number;
  readonly eyes: number;
  /** 0..33 (`HAIR_STYLE_NAMES`). */
  readonly hairStyle: number;
  /** 0..10 (`FACE_NAMES`). */
  readonly face: number;
  /** 0..4 (`BROW_NAMES`). */
  readonly brow: number;
  /** 0..11 (`BEARD_NAMES`). */
  readonly beard: number;
  /** 0..5 (`FACE_MARK_NAMES`). */
  readonly faceMark: number;
  /** 0..4 (`HEADWEAR_NAMES`; o capacete fica para a rodada 3). */
  readonly headwear: number;
  /** 0..3 (`EYEWEAR_NAMES`). */
  readonly eyewear: number;
  /** 0..3 (`EARRING_NAMES`). */
  readonly earrings: number;
  /** RGB: faixa, bandana, boné, armação e pintura. */
  readonly accessory: number;
  readonly outfit: FigureOutfit;
  readonly zombie: FigureZombie | null;
  /** Ids de `.bfmodel` sem prefixo (acessórios 3D; ficam do bobo A). */
  readonly hat3d?: string;
  readonly back?: string;
}

export interface FigureSkinRecipe {
  readonly look: FigureLook;
  /** −1 ou 255 = sem time (farda do look); 0..3 = time (colete, ícone, braçadeira, luvas e joelheiras do time). */
  readonly team: number;
  /** Cores dos times da partida (a cor do time e a trava de cor das peças do look). */
  readonly teamColors: readonly number[];
}

// Tamanho das listas do FutBobo (`player-appearance.ts`); o índice é clampado em 0..n − 1.
const HAIR_STYLES = 34;
const FACES = 11;
const BROWS = 5;
const BEARDS = 12;
const FACE_MARKS = 6;
const HEADWEARS = 5;
const EYEWEARS = 4;
const EARRINGS = 4;
const ZOMBIE_FACE_STYLES = 8;
const RGB_MAX = 0xffffff;
/** "Descolorido" (corte 11): o FutBobo pinta o topo em `#eee5c9` (`resolveLook`, `textures.ts:83`). */
const BLEACHED_STYLE = 11;
const BLEACHED_TOP = 0xeee5c9;

/**
 * Padrão do normalizador: o `DEFAULT_PLAYER_APPEARANCE` do FutBobo (pele 2, cabelo 0, olhos 0, Franja, Confiante,
 * sobrancelha Reta, liso, acessório branco) com as cores resolvidas em RGB. Farda lisa verde-oliva, calça mais escura,
 * colete ranger, luvas e botas pretas: o soldado genérico (o bot excedente veste este look no colete do próprio time).
 */
export const FIGURE_LOOK_DEFAULT: FigureLook = {
  skinTone: 0xe5aa84,
  hair: 0x12110f,
  hairTop: 0x12110f,
  eyes: 0x111816,
  hairStyle: 1,
  face: 1,
  brow: 1,
  beard: 0,
  faceMark: 0,
  headwear: 0,
  eyewear: 0,
  earrings: 0,
  accessory: 0xf4f4f2,
  outfit: { fabric: 0, jacket: 0x68704e, pants: 0x4f5540, vest: 0x464c37, boots: 0x1c1c1a, gloves: 0x262622 },
  zombie: null,
};

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Índice inteiro em [min, max]; ausente ou não finito = o padrão. */
function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  if (!isFiniteNumber(v)) return fallback;
  const r = Math.round(v);
  return r < min ? min : r > max ? max : r;
}

function clampRgb(v: unknown, fallback: number): number {
  return clampInt(v, 0, RGB_MAX, fallback);
}

/** RGB ou −1 (sem a peça): abaixo de 0 vira −1. */
function clampRgbOrNone(v: unknown, fallback: number): number {
  return clampInt(v, -1, RGB_MAX, fallback);
}

function normalizeOutfit(raw: unknown): FigureOutfit {
  const d = FIGURE_LOOK_DEFAULT.outfit;
  const k = typeof raw === 'object' && raw !== null ? (raw as Readonly<Record<string, unknown>>) : {};
  return {
    fabric: clampInt(k['fabric'], 0, FIGURE_FABRICS - 1, d.fabric),
    jacket: clampRgb(k['jacket'], d.jacket),
    pants: clampRgb(k['pants'], d.pants),
    vest: clampRgbOrNone(k['vest'], d.vest),
    boots: clampRgb(k['boots'], d.boots),
    gloves: clampRgbOrNone(k['gloves'], d.gloves),
  };
}

function normalizeZombie(raw: unknown): FigureZombie | null {
  if (raw === undefined) return FIGURE_LOOK_DEFAULT.zombie;
  if (typeof raw !== 'object' || raw === null) return null;
  const z = raw as Readonly<Record<string, unknown>>;
  const kind = z['kind'];
  return {
    kind: (ZOMBIE_KINDS as readonly unknown[]).includes(kind) ? (kind as ZombieKind) : 'common',
    faceStyle: clampInt(z['faceStyle'], 0, ZOMBIE_FACE_STYLES - 1, 0),
  };
}

/**
 * Normaliza uma aparência vinda de save, preset ou receita: índice arredondado e clampado na faixa da lista, RGB em
 * 0..0xffffff (colete e luvas em −1..0xffffff, −1 = sem a peça), campo ausente ou inválido = `FIGURE_LOOK_DEFAULT`.
 * SÓ clamp: sem o ramo legado do `version` do FutBobo. Sem topo próprio, o topo do cabelo é o cabelo, menos no
 * "Descolorido" (`#eee5c9`, como o `resolveLook`). Ids de acessório 3D só ficam se forem string não vazia (o loading
 * confere o registro).
 */
export function normalizeFigureLook(raw: Partial<FigureLook>): FigureLook {
  // Save corrompido (JSON com `null` ou um número no lugar do look) vira o padrão em vez de lançar.
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Readonly<Record<string, unknown>>;
  const d = FIGURE_LOOK_DEFAULT;
  const hair = clampRgb(r['hair'], d.hair);
  const hairStyle = clampInt(r['hairStyle'], 0, HAIR_STYLES - 1, d.hairStyle);
  const look = {
    skinTone: clampRgb(r['skinTone'], d.skinTone),
    hair,
    // O topo do padrão nunca entra aqui: pintaria outro tom por cima do cabelo escolhido.
    hairTop: clampRgb(r['hairTop'], hairStyle === BLEACHED_STYLE ? BLEACHED_TOP : hair),
    eyes: clampRgb(r['eyes'], d.eyes),
    hairStyle,
    face: clampInt(r['face'], 0, FACES - 1, d.face),
    brow: clampInt(r['brow'], 0, BROWS - 1, d.brow),
    beard: clampInt(r['beard'], 0, BEARDS - 1, d.beard),
    faceMark: clampInt(r['faceMark'], 0, FACE_MARKS - 1, d.faceMark),
    headwear: clampInt(r['headwear'], 0, HEADWEARS - 1, d.headwear),
    eyewear: clampInt(r['eyewear'], 0, EYEWEARS - 1, d.eyewear),
    earrings: clampInt(r['earrings'], 0, EARRINGS - 1, d.earrings),
    accessory: clampRgb(r['accessory'], d.accessory),
    outfit: normalizeOutfit(r['outfit']),
    zombie: normalizeZombie(r['zombie']),
  };
  const hat3d = r['hat3d'];
  const back = r['back'];
  // exactOptionalPropertyTypes: a chave só existe com valor.
  return {
    ...look,
    ...(typeof hat3d === 'string' && hat3d !== '' ? { hat3d } : {}),
    ...(typeof back === 'string' && back !== '' ? { back } : {}),
  };
}

// --- Cor de time, trava e farda efetiva ---

/** Abaixo disto (redmean) uma cor se confunde com a de um time (`MIN_KIT_DISTANCE` do FutBobo, `kits.ts:13`). */
export const FIGURE_TEAM_COLOR_MIN_DISTANCE = 92;
/** As duas cores da trava (PLANO §B7): a preta da chuteira do FutBobo e o branco do acessório. */
export const FIGURE_LOCK_DARK = 0x141414;
export const FIGURE_LOCK_LIGHT = 0xf4f4f2;

/** Distância perceptual "redmean" entre duas cores RGB (a `kitDistance` do FutBobo, `kits.ts:24-34`). */
export function figureColorDistance(a: number, b: number): number {
  const ar = (a >> 16) & 255;
  const br = (b >> 16) & 255;
  const meanRed = (ar + br) / 2;
  const dr = ar - br;
  const dg = ((a >> 8) & 255) - ((b >> 8) & 255);
  const db = (a & 255) - (b & 255);
  return Math.sqrt((2 + meanRed / 256) * dr * dr + 4 * dg * dg + (2 + (255 - meanRed) / 256) * db * db);
}

function nearAnyTeam(rgb: number, teamColors: readonly number[]): boolean {
  for (let i = 0; i < teamColors.length; i++) {
    if (figureColorDistance(rgb, teamColors[i]!) < FIGURE_TEAM_COLOR_MIN_DISTANCE) return true;
  }
  return false;
}

/**
 * Trava de cor (PLANO §B7; #58): uma peça do look (acessório, jaqueta, calça, colete, luvas ou botas) a menos de 92
 * (redmean) de um time da partida vira `#141414`; se o preto também se confundir com um time (time preto), vira
 * `#f4f4f2`. Sem times, a cor passa; −1 (sem a peça) passa. Sem alocação.
 */
export function figureLockedColor(rgb: number, teamColors: readonly number[]): number {
  if (rgb < 0 || !nearAnyTeam(rgb, teamColors)) return rgb;
  return nearAnyTeam(FIGURE_LOCK_DARK, teamColors) ? FIGURE_LOCK_LIGHT : FIGURE_LOCK_DARK;
}

/** Cor do time `team` na partida, ou −1 sem time (−1, 255 ou fora de `teamColors`). */
export function figureTeamColor(team: number, teamColors: readonly number[]): number {
  if (!Number.isInteger(team) || team < 0 || team === 255 || team >= teamColors.length) return -1;
  return teamColors[team]! & RGB_MAX;
}

/**
 * Farda efetiva da skin (#58; PLANO §B7). Com time: o colete (e as joelheiras) e as luvas na cor do time, mesmo num
 * look sem colete ou sem luva; o pintor põe por cima a braçadeira e o ícone do time (▲ ● ■ ◆). Sem time (−1 ou 255):
 * as peças do look. Jaqueta, calça, botas e as peças do look passam pela trava de cor contra os times da partida (a cor
 * de um time só aparece em quem é dele). No loading, nunca por quadro (aloca o objeto de saída; o mesmo objeto do look
 * quando nada muda).
 */
export function figureOutfitFor(look: FigureLook, team: number, teamColors: readonly number[]): FigureOutfit {
  const o = look.outfit;
  const tc = figureTeamColor(team, teamColors);
  const jacket = figureLockedColor(o.jacket, teamColors);
  const pants = figureLockedColor(o.pants, teamColors);
  const boots = figureLockedColor(o.boots, teamColors);
  const vest = tc >= 0 ? tc : figureLockedColor(o.vest, teamColors);
  const gloves = tc >= 0 ? tc : figureLockedColor(o.gloves, teamColors);
  if (jacket === o.jacket && pants === o.pants && boots === o.boots && vest === o.vest && gloves === o.gloves) return o;
  return { fabric: o.fabric, jacket, pants, vest, boots, gloves };
}

function hex6(rgb: number): string {
  return rgb < 0 ? '-' : (rgb & RGB_MAX).toString(16).padStart(6, '0');
}

/**
 * Chave estável de tudo que pinta a skin (cache de skins): o look sem os acessórios 3D (não pintam), com a farda
 * efetiva (time e trava), o time (o ícone) e o acessório travado. Duas receitas com a mesma chave pintam os mesmos
 * bytes. Espera um look normalizado. No loading, nunca por quadro.
 */
export function figureSkinKey(recipe: FigureSkinRecipe): string {
  const l = recipe.look;
  const o = figureOutfitFor(l, recipe.team, recipe.teamColors);
  const team = figureTeamColor(recipe.team, recipe.teamColors) < 0 ? -1 : recipe.team;
  const acc = figureLockedColor(l.accessory, recipe.teamColors);
  const z = l.zombie === null ? '-' : `${l.zombie.kind}.${l.zombie.faceStyle}`;
  return (
    `fig2:${hex6(l.skinTone)}.${hex6(l.hair)}.${hex6(l.hairTop)}.${hex6(l.eyes)}` +
    `:${l.hairStyle}.${l.face}.${l.brow}.${l.beard}.${l.faceMark}.${l.headwear}.${l.eyewear}.${l.earrings}` +
    `:${hex6(acc)}:${o.fabric}.${hex6(o.jacket)}.${hex6(o.pants)}.${hex6(o.vest)}.${hex6(o.boots)}.${hex6(o.gloves)}` +
    `:${team}:${z}`
  );
}
