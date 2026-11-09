import type { PlatformFamily, PlatformProfile } from './platform-profiles.ts';
import type { VideoSettings } from './settings.ts';

/**
 * M2 (fase 8b): os níveis de qualidade (arte-ux.md §1.12) e a escolha automática da primeira abertura (tecnico.md
 * §17.2). Dados e funções puras: quem aplica na casca (resolução) e no render (detritos) é o `game`.
 */
export const QUALITY_LEVELS = ['low', 'medium', 'high'] as const;
export type QualityLevel = (typeof QUALITY_LEVELS)[number];

export interface QualityKnobs {
  /** Teto do DPR do drawing buffer (nunca acima do perfil). */
  readonly maxPixelRatio: number;
  /** Escala de render sobre o DPR (1 = nativa). */
  readonly renderScale: number;
  /** Cubinhos de detrito vivos (nunca acima do perfil). */
  readonly maxDebris: number;
}

/**
 * Tabela da arte-ux.md §1.12 (Alto, Médio, Leve), sem a escala dinâmica (fica para a rodada de otimização, #60): o Leve
 * fica no meio da faixa de 0,75–1,0. O perfil do aparelho é sempre o teto; no Switch (720p fixo) só os detritos mudam.
 */
export const QUALITY_TABLE: Readonly<
  Record<QualityLevel, { readonly pixelRatioCap: number; readonly renderScale: number; readonly debrisCap: number }>
> = {
  high: { pixelRatioCap: 4, renderScale: 1, debrisCap: 500 },
  medium: { pixelRatioCap: 1.5, renderScale: 1, debrisCap: 200 },
  low: { pixelRatioCap: 1, renderScale: 0.85, debrisCap: 200 },
};

export function qualityKnobs(profile: PlatformProfile, level: QualityLevel): QualityKnobs {
  const row = QUALITY_TABLE[level];
  const fixed = profile.family === 'switch';
  return {
    maxPixelRatio: fixed ? profile.maxPixelRatio : Math.min(profile.maxPixelRatio, row.pixelRatioCap),
    renderScale: fixed ? 1 : row.renderScale,
    maxDebris: Math.min(profile.maxDebris, row.debrisCap),
  };
}

/**
 * GPUs que caem direto no Leve (tecnico.md §17.2, item 4). Lista versionada: mudou, registra no `PERF.md`. Casam com o
 * texto do `WEBGL_debug_renderer_info` (o Brave e o Safari escondem: aí só contam núcleos e memória).
 */
export const WEAK_GPU_LIST_VERSION = 1;
export const WEAK_GPU_PATTERNS: readonly RegExp[] = [
  // Render por software: nada de GPU.
  /swiftshader|llvmpipe|softpipe|software/i,
  // Celular de entrada (tecnico.md §17.1: classe Mali-G52/G57).
  /mali-(?:4\d\d|t\d+|g31|g51|g52|g57|g68)\b/i,
  /adreno[^0-9]*(?:[2-5]\d\d|60\d|61[0-2])\b/i,
  /powervr/i,
  // Intel antigo (HD Graphics sem "UHD" nem "Iris", e GMA).
  /intel.*\bgma\b/i,
  /intel(?!.*(?:uhd|iris|arc)).*hd graphics/i,
];

/** GPUs integradas de PC que ficam no Médio (a referência do PC é uma Iris Xe ou Vega 8: tecnico.md §17.1). */
const INTEGRATED_PC_GPU = /intel(?!.*\barc\b)|radeon\(tm\) graphics|vega \d+ graphics/i;

/** O que a escolha automática lê do aparelho (`PlatformReport`); 0 = desconhecido. */
export interface DeviceSample {
  readonly family: PlatformFamily;
  readonly gpu: string;
  readonly cores: number;
  readonly memoryGb: number;
}

export function isWeakGpu(gpu: string): boolean {
  for (const re of WEAK_GPU_PATTERNS) if (re.test(gpu)) return true;
  return false;
}

/**
 * Escolha da primeira abertura (tecnico.md §17.2): a leitura do aparelho decide o nível de partida. O micro-bench vem
 * depois, na primeira partida (`shouldLowerQuality`), que baixa um nível se os quadros não aguentarem.
 */
export function guessQuality(d: DeviceSample): QualityLevel {
  if (d.family === 'switch') return 'high';
  if (isWeakGpu(d.gpu)) return 'low';
  const fewCores = d.cores > 0 && d.cores <= (d.family === 'mobile' ? 4 : 2);
  const littleMemory = d.memoryGb > 0 && d.memoryGb <= (d.family === 'mobile' ? 4 : 2);
  if (fewCores || littleMemory) return 'low';
  if (d.family === 'mobile') return 'medium';
  return INTEGRATED_PC_GPU.test(d.gpu) ? 'medium' : 'high';
}

/** Nível sem leitura do aparelho (antes da escolha automática terminar). */
export function defaultQuality(family: PlatformFamily): QualityLevel {
  return family === 'mobile' ? 'medium' : 'high';
}

/** O nível que vale: o escolhido pelo jogador, ou o automático, ou o padrão da família. */
export function effectiveQuality(video: VideoSettings, family: PlatformFamily): QualityLevel {
  if (video.quality !== 'auto') return video.quality;
  return video.autoQuality !== 'none' ? video.autoQuality : defaultQuality(family);
}

export function lowerQuality(level: QualityLevel): QualityLevel {
  return level === 'high' ? 'medium' : 'low';
}

/**
 * Reavaliação da primeira partida (tecnico.md §17.2, item 2, e §17.3): janela de quadros depois da contagem. Baixa um
 * nível quando mais de 10% dos quadros passam de 1,5× o tempo do alvo do perfil (o p90 acima do alvo).
 */
export const QUALITY_PROBE = {
  /** Segundos de partida medidos (depois da contagem). */
  windowS: 10,
  /** Fração de quadros lentos que reprova (p90). */
  slowFraction: 0.1,
  /** Quadro lento = acima de `slowFactor` × (1000 / alvo do perfil) ms. */
  slowFactor: 1.5,
} as const;

export function shouldLowerQuality(frames: number, slowFrames: number): boolean {
  return frames > 0 && slowFrames / frames > QUALITY_PROBE.slowFraction;
}
