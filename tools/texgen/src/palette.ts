/**
 * Paleta mestra de 64 cores (arte-ux.md §1.3), em rampas do escuro para o claro. Toda textura usa só estas cores; o
 * validador reprova qualquer outra.
 *
 * Regras que a paleta segue (e que os testes conferem):
 * - **hue shift**: o tom escuro de cada rampa puxa para azul/roxo e o claro para amarelo (sol quente, sombra fria);
 * - **reserva de saturação**: rampas de cenário até ~60% (HSV); acentos de sinalização até ~70%; os 75–100% ficam para
 *   times, itens e VFX;
 * - cores de time e de jogador ficam FORA das rampas do cenário, para parede nunca parecer inimigo;
 * - preto puro só em pupilas e frestas: o "preto" do cenário é o tom mais escuro da rampa.
 *
 * Cores em 0xRRGGBB. Mudar uma cor aqui muda toda textura que a usa (regenere com `npm run texgen`).
 */

export type RampUse = 'cenario' | 'acento' | 'bobo' | 'emissivo' | 'neutro' | 'time';

export interface Ramp {
  readonly name: RampName;
  readonly use: RampUse;
  /** Do mais escuro para o mais claro. */
  readonly colors: readonly number[];
}

export const RAMPS = [
  { name: 'concreto', use: 'cenario', colors: [0x2c2f3b, 0x454955, 0x60636b, 0x7d7f82, 0x9c9c98, 0xbdbbb2] },
  { name: 'placa', use: 'cenario', colors: [0xa6a7a5, 0xc9c8c0, 0xe2e0d6] },
  { name: 'metal', use: 'cenario', colors: [0x1e2829, 0x2c3a33, 0x3f5140, 0x586a4b, 0x758558] },
  { name: 'aco', use: 'cenario', colors: [0x2a2e3e, 0x5a6072, 0x8f949e] },
  { name: 'madeira', use: 'cenario', colors: [0x2d1f2b, 0x4a2e2e, 0x6b4332, 0x8e5c3a, 0xb07a48, 0xd09e62] },
  { name: 'lona', use: 'cenario', colors: [0x3b382f, 0x6a6349, 0x9c936c] },
  { name: 'terra', use: 'cenario', colors: [0x2a1d26, 0x4b3330, 0x6e4937, 0x936647] },
  { name: 'grama', use: 'cenario', colors: [0x1b2b2b, 0x26432f, 0x375e33, 0x4f7a3a, 0x6e9444, 0x93ad57] },
  { name: 'areia', use: 'cenario', colors: [0xa08a62, 0xc2ab7c, 0xdccb98] },
  { name: 'tijolo', use: 'cenario', colors: [0x3b1f2c, 0x5e2a30, 0x823a35, 0xa4513f, 0xc06e50] },
  { name: 'laranja', use: 'acento', colors: [0x5e3027, 0x9a4f30, 0xc4723f, 0xe0985a] },
  { name: 'amarelo', use: 'acento', colors: [0x7d6230, 0xb8913f, 0xdcbc5a] },
  { name: 'pele', use: 'bobo', colors: [0x5b3b36, 0x8f5e4b, 0xc48a68, 0xe6b78f] },
  { name: 'emissivo', use: 'emissivo', colors: [0x9ee8ff, 0xffd56b, 0xfff1b8] },
  { name: 'neutro', use: 'neutro', colors: [0x000000, 0xffffff] },
  // Times A–D (os mesmos hex de TEAM_COLORS no ui/theme.ts).
  { name: 'time', use: 'time', colors: [0xff7a1a, 0x2e8bff, 0x3ddc97, 0xa66bff] },
] as const satisfies readonly { name: string; use: RampUse; colors: readonly number[] }[];

export type RampName = (typeof RAMPS)[number]['name'];

/** As 64 cores, rampa após rampa (o índice é estável enquanto a ordem das rampas não mudar). */
export const PALETTE: readonly number[] = RAMPS.flatMap((r) => r.colors);

const PALETTE_SET: ReadonlySet<number> = new Set(PALETTE);

export function inPalette(rgb: number): boolean {
  return PALETTE_SET.has(rgb);
}

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
