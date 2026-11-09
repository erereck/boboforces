import {
  BOBO_FORMAT,
  FIGURE_FABRICS,
  FIGURE_PRESETS,
  normalizeBoboLook,
  type BoboDocument,
  type FigureLook,
  type FigureOutfit,
  type FigurePresetId,
} from '@boboforces/format';
import type { Rng } from '@boboforces/shared';
import { t, type StringKey, type TabbedRow } from '@boboforces/ui';

/**
 * M2 (fase 6c): o editor do Meu Bobo (GDD §4.7.2; arte-ux.md §2.4): as abas, as linhas e o passo de cada uma sobre o
 * `bobo@1`. Puro (a cena desenha e grava). As listas de rosto e cabelo são as do FutBobo, na mesma ordem dos índices
 * do `FigureLook`; as cores de pele, cabelo, olhos e acessório também. A roupa usa uma paleta própria, militar.
 */
export const BOBO_TABS = ['ready', 'face', 'hair', 'extras', 'outfit'] as const;
export type BoboTab = (typeof BOBO_TABS)[number];

export const BOBO_TAB_KEYS: Readonly<Record<BoboTab, StringKey>> = {
  ready: 'bobo.tab.ready',
  face: 'bobo.tab.face',
  hair: 'bobo.tab.hair',
  extras: 'bobo.tab.extras',
  outfit: 'bobo.tab.outfit',
};

/** Pele: os 10 tons do FutBobo e as 4 cores fantasia do GDD (verde, azul, roxo, cinza-pedra). */
export const SKIN_TONES: readonly number[] = [
  0xf6d9c0, 0xedbf9d, 0xe5aa84, 0xd99b73, 0xcc8965, 0xbd7b58, 0x985d43, 0x714633, 0x4b3027, 0x321f1a, 0x6fae5a,
  0x5b8fd4, 0x8e6bc4, 0x8d918c,
];
/** Os 10 primeiros são tons de pele; os 4 últimos, fantasia. */
export const SKIN_NATURAL = 10;
export const HAIR_COLORS: readonly number[] = [
  0x12110f, 0x28201b, 0x473023, 0x69422a, 0x925d36, 0xbd8654, 0xd3b17d, 0xded8cc, 0x8c2525, 0x23426b, 0x8d4aa3,
  0xf1eee5, 0xe7c79b, 0xcf6f38, 0x6f1738, 0xe05a9d, 0x2a9db0, 0x3e8050, 0xed8b28, 0x9aa8c4,
];
export const EYE_COLORS: readonly number[] = [
  0x111816, 0x35251d, 0x31505b, 0x49633c, 0x765139, 0x7c8f98, 0x5c3f76, 0x1f6a74, 0x9a742d, 0x9eb4cf,
];
export const ACCESSORY_COLORS: readonly number[] = [
  0xf4f4f2, 0x151515, 0xd7263d, 0x1f5fd1, 0xffd23f, 0x1f9e5a, 0xff6fb5, 0xff7a1a, 0x7b3fd1, 0xc9a227,
];
/** A roupa: tons militares e alguns civis, longe das cores de time (a trava de cor da pintura cuida do resto). */
export const CLOTH_COLORS: readonly number[] = [
  0x5d6b40, 0x3f4f2c, 0x8a7f55, 0xb9a77a, 0x5a4430, 0x6b6f6c, 0x34383a, 0x1c1c1a, 0x26324a, 0xe8e6df, 0x5c2430,
  0xcbbd9b,
];

/** Quantos itens tem cada lista do rosto e da cabeça (as do FutBobo; o normalizador do `format` limita igual). */
export const BOBO_COUNTS = {
  hairStyle: 34,
  face: 11,
  brow: 5,
  beard: 12,
  faceMark: 6,
  headwear: 5,
  eyewear: 4,
  earrings: 4,
} as const;

/** Os visuais prontos (a farda; o zumbi não). A fase 6d acrescenta as fantasias. */
export const READY_LOOKS: readonly FigurePresetId[] = [
  'recruit',
  'mechanic',
  'pilot',
  'classico',
  'blackpower',
  'sardento',
  'dreads',
  'bandana',
  'moicano',
  'barbudo',
  'trancas',
];

/** A prévia: sem time (a farda do look) ou com o colete de um time. */
export const BOBO_PREVIEWS = [-1, 0, 1] as const;

const NONE = -1;

function cycle(n: number, i: number, d: number): number {
  return (((i + d) % n) + n) % n;
}

/** Índice da cor na paleta; fora dela, a mais parecida (o look de um preset pode ter um tom que não está na lista). */
export function nearestColor(palette: readonly number[], rgb: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const c = palette[i]!;
    const dr = ((c >> 16) & 255) - ((rgb >> 16) & 255);
    const dg = ((c >> 8) & 255) - ((rgb >> 8) & 255);
    const db = (c & 255) - (rgb & 255);
    const d = dr * dr + dg * dg + db * db;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Passo numa paleta com "nenhum" na frente (colete e luvas): −1 → 0 → … → n − 1 → −1. */
function stepOptional(palette: readonly number[], rgb: number, d: number): number {
  const i = rgb === NONE ? -1 : nearestColor(palette, rgb);
  const next = cycle(palette.length + 1, i + 1, d) - 1;
  return next < 0 ? NONE : palette[next]!;
}

function stepColor(palette: readonly number[], rgb: number, d: number): number {
  return palette[cycle(palette.length, nearestColor(palette, rgb), d)]!;
}

/** O look com a roupa trocada (e normalizado). */
function withOutfit(look: FigureLook, o: Partial<FigureOutfit>): FigureLook {
  return { ...look, outfit: { ...look.outfit, ...o } };
}

function readyName(id: string): string {
  return (READY_LOOKS as readonly string[]).includes(id) ? t(`bobo.ready.${id}` as StringKey) : t('bobo.custom');
}

/** O visual pronto do documento é o look dele sem mudança nenhuma? */
export function isPristine(doc: BoboDocument): boolean {
  const base = (READY_LOOKS as readonly string[]).includes(doc.preset)
    ? FIGURE_PRESETS[doc.preset as FigurePresetId]
    : null;
  return base !== null && JSON.stringify(base) === JSON.stringify(doc.look);
}

/** A linha de baixo do título: "Recruta" ou "Recruta, editado". */
export function boboSummary(doc: BoboDocument): string {
  const name = readyName(doc.preset);
  return isPristine(doc) || !(READY_LOOKS as readonly string[]).includes(doc.preset)
    ? name
    : t('bobo.edited', { name });
}

function colorName(palette: readonly number[], rgb: number): string {
  return t('bobo.color', { n: nearestColor(palette, rgb) + 1 });
}

function option(id: string, labelKey: StringKey, value: string, swatch?: number): TabbedRow {
  return { kind: 'option', id, labelKey, value, ...(swatch !== undefined ? { swatch } : {}) };
}

/** As linhas de uma aba. `preview`: o time da prévia (−1 sem time). */
export function boboRows(tab: BoboTab, doc: BoboDocument, preview: number): readonly TabbedRow[] {
  const l = doc.look;
  const o = l.outfit;
  switch (tab) {
    case 'ready':
      return [
        option('preset', 'bobo.row.preset', readyName(doc.preset)),
        option('preview', 'bobo.row.preview', t(`bobo.preview.${preview < 0 ? 'none' : preview}` as StringKey)),
        { kind: 'action', id: 'random', label: { key: 'bobo.row.random' } },
      ];
    case 'face': {
      const skin = nearestColor(SKIN_TONES, l.skinTone);
      return [
        option(
          'skin',
          'bobo.row.skin',
          skin < SKIN_NATURAL
            ? t('bobo.skin', { n: skin + 1 })
            : t(`bobo.skin.fantasy.${skin - SKIN_NATURAL}` as StringKey),
          l.skinTone,
        ),
        option('face', 'bobo.row.face', t(`bobo.face.${l.face}` as StringKey)),
        option('brow', 'bobo.row.brow', t(`bobo.brow.${l.brow}` as StringKey)),
        option('beard', 'bobo.row.beard', t(`bobo.beard.${l.beard}` as StringKey)),
        option('mark', 'bobo.row.mark', t(`bobo.mark.${l.faceMark}` as StringKey)),
        option('eyes', 'bobo.row.eyes', colorName(EYE_COLORS, l.eyes), l.eyes),
      ];
    }
    case 'hair':
      return [
        option('hairStyle', 'bobo.row.hairStyle', t(`bobo.hair.${l.hairStyle}` as StringKey)),
        option('hairColor', 'bobo.row.hairColor', colorName(HAIR_COLORS, l.hair), l.hair),
      ];
    case 'extras':
      return [
        option('headwear', 'bobo.row.headwear', t(`bobo.headwear.${l.headwear}` as StringKey)),
        option('eyewear', 'bobo.row.eyewear', t(`bobo.eyewear.${l.eyewear}` as StringKey)),
        option('earrings', 'bobo.row.earrings', t(`bobo.earrings.${l.earrings}` as StringKey)),
        option('accessory', 'bobo.row.accessory', colorName(ACCESSORY_COLORS, l.accessory), l.accessory),
      ];
    case 'outfit': {
      const cloth = (rgb: number, none: StringKey | null): string =>
        rgb === NONE && none !== null ? t(none) : t(`bobo.cloth.${nearestColor(CLOTH_COLORS, rgb)}` as StringKey);
      const sw = (rgb: number): number | undefined => (rgb === NONE ? undefined : rgb);
      return [
        option('fabric', 'bobo.row.fabric', t(`bobo.fabric.${o.fabric}` as StringKey)),
        option('jacket', 'bobo.row.jacket', cloth(o.jacket, null), o.jacket),
        option('pants', 'bobo.row.pants', cloth(o.pants, null), o.pants),
        option('vest', 'bobo.row.vest', cloth(o.vest, 'bobo.noVest'), sw(o.vest)),
        option('boots', 'bobo.row.boots', cloth(o.boots, null), o.boots),
        option('gloves', 'bobo.row.gloves', cloth(o.gloves, 'bobo.noGloves'), sw(o.gloves)),
      ];
    }
  }
}

/** Um passo na linha `id` (`delta` 0 = confirmar, que avança). O visual pronto troca o look inteiro. */
export function stepBobo(tab: BoboTab, doc: BoboDocument, id: string, delta: number): BoboDocument {
  const d = delta === 0 ? 1 : delta;
  const l = doc.look;
  const o = l.outfit;
  const C = BOBO_COUNTS;
  let look: FigureLook = l;
  switch (id) {
    case 'preset': {
      const i = READY_LOOKS.indexOf(doc.preset as FigurePresetId);
      const next = READY_LOOKS[cycle(READY_LOOKS.length, i < 0 ? -1 : i, i < 0 && d < 0 ? 0 : d)]!;
      return { format: BOBO_FORMAT, look: FIGURE_PRESETS[next], preset: next };
    }
    case 'skin':
      look = { ...l, skinTone: stepColor(SKIN_TONES, l.skinTone, d) };
      break;
    case 'face':
      look = { ...l, face: cycle(C.face, l.face, d) };
      break;
    case 'brow':
      look = { ...l, brow: cycle(C.brow, l.brow, d) };
      break;
    case 'beard':
      look = { ...l, beard: cycle(C.beard, l.beard, d) };
      break;
    case 'mark':
      look = { ...l, faceMark: cycle(C.faceMark, l.faceMark, d) };
      break;
    case 'eyes':
      look = { ...l, eyes: stepColor(EYE_COLORS, l.eyes, d) };
      break;
    case 'hairStyle': {
      const hairStyle = cycle(C.hairStyle, l.hairStyle, d);
      // O topo do cabelo sai do normalizador (o "Descolorido" tem o topo claro): sem ele aqui, recalcula.
      look = normalizeBoboLook({ ...l, hairStyle, hairTop: undefined });
      break;
    }
    case 'hairColor': {
      const hair = stepColor(HAIR_COLORS, l.hair, d);
      look = normalizeBoboLook({ ...l, hair, hairTop: undefined });
      break;
    }
    case 'headwear':
      look = { ...l, headwear: cycle(C.headwear, l.headwear, d) };
      break;
    case 'eyewear':
      look = { ...l, eyewear: cycle(C.eyewear, l.eyewear, d) };
      break;
    case 'earrings':
      look = { ...l, earrings: cycle(C.earrings, l.earrings, d) };
      break;
    case 'accessory':
      look = { ...l, accessory: stepColor(ACCESSORY_COLORS, l.accessory, d) };
      break;
    case 'fabric':
      look = withOutfit(l, { fabric: cycle(FIGURE_FABRICS, o.fabric, d) });
      break;
    case 'jacket':
      look = withOutfit(l, { jacket: stepColor(CLOTH_COLORS, o.jacket, d) });
      break;
    case 'pants':
      look = withOutfit(l, { pants: stepColor(CLOTH_COLORS, o.pants, d) });
      break;
    case 'vest':
      look = withOutfit(l, { vest: stepOptional(CLOTH_COLORS, o.vest, d) });
      break;
    case 'boots':
      look = withOutfit(l, { boots: stepColor(CLOTH_COLORS, o.boots, d) });
      break;
    case 'gloves':
      look = withOutfit(l, { gloves: stepOptional(CLOTH_COLORS, o.gloves, d) });
      break;
    default:
      return doc;
  }
  return { ...doc, look: normalizeBoboLook(look) };
}

/** A prévia seguinte (sem time → time 1 → time 2). */
export function stepPreview(preview: number, delta: number): number {
  const i = (BOBO_PREVIEWS as readonly number[]).indexOf(preview);
  return BOBO_PREVIEWS[cycle(BOBO_PREVIEWS.length, Math.max(0, i), delta === 0 ? 1 : delta)]!;
}

/**
 * "Aleatório": um bobo sorteado do zero (a pele quase sempre natural; colete e luvas às vezes não), guardando o visual
 * pronto de onde saiu só como referência ("editado").
 */
export function randomBobo(doc: BoboDocument, rng: Rng): BoboDocument {
  const C = BOBO_COUNTS;
  const pick = (n: number): number => rng.int(0, n);
  const color = (p: readonly number[]): number => p[pick(p.length)]!;
  const skin = rng.next() < 0.9 ? SKIN_TONES[pick(SKIN_NATURAL)]! : SKIN_TONES[SKIN_NATURAL + pick(4)]!;
  const look = normalizeBoboLook({
    skinTone: skin,
    hair: color(HAIR_COLORS),
    eyes: color(EYE_COLORS),
    hairStyle: pick(C.hairStyle),
    face: pick(C.face),
    brow: pick(C.brow),
    beard: rng.next() < 0.5 ? 0 : pick(C.beard),
    faceMark: rng.next() < 0.7 ? 0 : pick(C.faceMark),
    headwear: rng.next() < 0.6 ? 0 : pick(C.headwear),
    eyewear: rng.next() < 0.7 ? 0 : pick(C.eyewear),
    earrings: rng.next() < 0.8 ? 0 : pick(C.earrings),
    accessory: color(ACCESSORY_COLORS),
    outfit: {
      fabric: pick(FIGURE_FABRICS),
      jacket: color(CLOTH_COLORS),
      pants: color(CLOTH_COLORS),
      vest: rng.next() < 0.25 ? NONE : color(CLOTH_COLORS),
      boots: color(CLOTH_COLORS),
      gloves: rng.next() < 0.3 ? NONE : color(CLOTH_COLORS),
    },
  });
  return { format: BOBO_FORMAT, look, preset: doc.preset };
}
