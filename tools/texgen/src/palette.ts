/**
 * Paleta mestra de 64 cores (arte-ux.md §1.3, GDD §5.3), em rampas do escuro para o claro. Toda textura do jogo
 * (blocos, materiais dos modelos, skins) usa só estas cores; o validador reprova qualquer outra.
 *
 * Regras que a paleta segue (e que os testes conferem):
 * - **rampas de material** (`cenario` e `bobo`) com 4 a 6 tons; acentos de sinalização com 3 ou 4;
 * - **hue shift**: o tom escuro de cada rampa de cenário puxa para azul/roxo e o claro para amarelo (sol quente,
 *   sombra fria);
 * - **reserva de saturação**: cenário até ~60% (HSV); acentos (laranja de segurança, amarelo de sinalização) até ~70%;
 *   o vivo de verdade fica para times, itens e VFX;
 * - **Construto neutro** (GDD §5.8): cinza (`concreto`, `placa`, `aco`), laranja de segurança e verde-oliva (`metal`,
 *   `lona`) mandam no mapa; grama, terra e madeira ficam na borda;
 * - cores de time ficam FORA das rampas do cenário, para parede nunca parecer inimigo (só o `missing` usa uma);
 * - preto puro só em pupilas e frestas: o "preto" do cenário é o tom mais escuro da rampa.
 *
 * Use sempre `ramp(nome)[tom]`, nunca o índice cru de `PALETTE` (o M1 mudou o tamanho de algumas rampas).
 * Cores em 0xRRGGBB. Mudar uma cor aqui muda toda textura que a usa (regenere com `npm run assets`).
 */

export type RampUse = 'cenario' | 'acento' | 'bobo' | 'emissivo' | 'neutro' | 'time';

export interface Ramp {
  readonly name: RampName;
  readonly use: RampUse;
  /** Do mais escuro para o mais claro. */
  readonly colors: readonly number[];
}

export const RAMPS = [
  // Concreto frio: paredes, lajes, rampas e a argamassa.
  { name: 'concreto', use: 'cenario', colors: [0x2c2f3b, 0x454955, 0x60636b, 0x7d7f82, 0x9c9c98] },
  // Placas de teste do Construto (cinza-claro morno).
  { name: 'placa', use: 'cenario', colors: [0xa3a5a6, 0xbdbbb2, 0xcfcdc3, 0xe4e1d5] },
  // Verde-oliva pintado: painéis, caixotes militares, jipe.
  { name: 'metal', use: 'cenario', colors: [0x1e2829, 0x2c3a33, 0x3f5140, 0x586a4b, 0x758558] },
  // Aço azulado: chapa xadrez, telhado, grade, vidro e água da bancada.
  { name: 'aco', use: 'cenario', colors: [0x2a2e3e, 0x474d5f, 0x6a7183, 0x959aa3] },
  { name: 'madeira', use: 'cenario', colors: [0x2d1f2b, 0x6b4332, 0x8e5c3a, 0xb07a48, 0xd09e62] },
  // Lona verde-oliva (tendas, sacos, capas).
  { name: 'lona', use: 'cenario', colors: [0x363a2d, 0x515839, 0x6e7548, 0x8e935e] },
  { name: 'terra', use: 'cenario', colors: [0x2a1d26, 0x4b3330, 0x6e4937, 0x936647] },
  { name: 'grama', use: 'cenario', colors: [0x26432f, 0x375e33, 0x4f7a3a, 0x6e9444, 0x93ad57] },
  { name: 'areia', use: 'cenario', colors: [0x7d6a4c, 0xa08a62, 0xc2ab7c, 0xdccb98] },
  { name: 'tijolo', use: 'cenario', colors: [0x5e2a30, 0x823a35, 0xa4513f, 0xc06e50] },
  // Laranja de segurança e amarelo de sinalização (faixas, réguas, corrimão, placas).
  { name: 'laranja', use: 'acento', colors: [0x5e3027, 0x9a4f30, 0xc4723f, 0xe0985a] },
  { name: 'amarelo', use: 'acento', colors: [0x7d6230, 0xb8913f, 0xdcbc5a] },
  { name: 'pele', use: 'bobo', colors: [0x5b3b36, 0x8f5e4b, 0xc48a68, 0xe6b78f] },
  { name: 'emissivo', use: 'emissivo', colors: [0x9ee8ff, 0xffd56b, 0xfff1b8] },
  { name: 'neutro', use: 'neutro', colors: [0x000000, 0xffffff] },
  // Times A–D (os mesmos hex de TEAM_COLORS no ui/theme.ts).
  { name: 'time', use: 'time', colors: [0xff7a1a, 0x2e8bff, 0x3ddc97, 0xa66bff] },
] as const satisfies readonly { name: string; use: RampUse; colors: readonly number[] }[];

export type RampName = (typeof RAMPS)[number]['name'];

/** As 64 cores, rampa após rampa. */
export const PALETTE: readonly number[] = RAMPS.flatMap((r) => r.colors);

const PALETTE_SET: ReadonlySet<number> = new Set(PALETTE);

export function inPalette(rgb: number): boolean {
  return PALETTE_SET.has(rgb);
}

/** Cores de time (reservadas: o cenário não usa). */
export const TEAM_COLOR_SET: ReadonlySet<number> = new Set(
  RAMPS.filter((r) => r.use === 'time').flatMap((r) => r.colors),
);

const BY_NAME: ReadonlyMap<string, readonly number[]> = new Map(RAMPS.map((r) => [r.name, r.colors]));

/** Cores de uma rampa (do escuro para o claro). */
export function ramp(name: RampName): readonly number[] {
  return BY_NAME.get(name)!;
}

/** Saturação HSV (0..1) de 0xRRGGBB. */
export function saturation(rgb: number): number {
  const r = (rgb >> 16) & 0xff;
  const g = (rgb >> 8) & 0xff;
  const b = rgb & 0xff;
  const max = Math.max(r, g, b);
  return max === 0 ? 0 : (max - Math.min(r, g, b)) / max;
}

/** Luminância relativa aproximada (0..1), para ordenar rampas. */
export function luma(rgb: number): number {
  return (0.2126 * ((rgb >> 16) & 0xff) + 0.7152 * ((rgb >> 8) & 0xff) + 0.0722 * (rgb & 0xff)) / 255;
}

/** Matiz HSV em graus (0..360); cinza puro dá 0. */
export function hue(rgb: number): number {
  const r = ((rgb >> 16) & 0xff) / 255;
  const g = ((rgb >> 8) & 0xff) / 255;
  const b = (rgb & 0xff) / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

/** `#rrggbb` (mensagens e folha de contato). */
export function hex(rgb: number): string {
  return '#' + rgb.toString(16).padStart(6, '0');
}
