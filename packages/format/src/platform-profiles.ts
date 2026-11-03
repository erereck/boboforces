import type { RecipeLimits } from './validation.ts';

/**
 * Perfis de plataforma (tecnico.md §16.1, gameplay.md §6.11) como DADOS. Os tetos começam conservadores e sobem com as
 * medições do Teste Zero; toda mudança aqui é registrada em `docs/PERF.md`.
 */

/** Capacidade do motor (tecnico.md §4.1). Os perfis nunca passam disso. A `sim` tem as mesmas constantes. */
export const ENGINE_MAX_BOTS = 64;
export const ENGINE_MAX_ZOMBIES = 64;
export const ENGINE_MAX_LOCAL_HUMANS = 4;
export const ENGINE_MAX_TEAMS = 4;

export const PLATFORM_PROFILE_IDS = ['pc', 'pcSplit', 'mobile', 'switch1p', 'switch2p', 'switch34p'] as const;

export type PlatformProfileId = (typeof PLATFORM_PROFILE_IDS)[number];

/** Família do aparelho (a mesma dica de `PlatformFeatures.profileHint`). */
export type PlatformFamily = 'pc' | 'mobile' | 'switch';

export interface PlatformProfile {
  readonly id: PlatformProfileId;
  readonly family: PlatformFamily;
  /** Faixa de vistas locais (jogadores na tela) que usa este perfil. */
  readonly minViewports: number;
  readonly maxViewports: number;
  /** Teto de bots armados. */
  readonly maxBots: number;
  /** Teto de bots quando este aparelho é host online (P2P). */
  readonly hostMaxBots: number;
  readonly maxZombies: number;
  readonly hostMaxZombies: number;
  /** Teto do alcance de visão; a regra da partida escolhe abaixo disso. */
  readonly maxViewDistanceM: number;
  /** Faixa de DPR do render (escala dinâmica entre os dois quando `dynamicResolution`). */
  readonly minPixelRatio: number;
  readonly maxPixelRatio: number;
  readonly dynamicResolution: boolean;
  /** Altura fixa do render em px (720 no Switch); `null` = segue a janela. */
  readonly fixedHeight: number | null;
  /** Detritos cosméticos vivos ao mesmo tempo. */
  readonly maxDebris: number;
  /** MSAA nativo do framebuffer padrão (nunca no Switch, regra 6). */
  readonly antialias: boolean;
  /** Alvo de FPS (o mínimo aceitável no Switch). */
  readonly targetFps: number;
}

export const PLATFORM_PROFILES: Readonly<Record<PlatformProfileId, PlatformProfile>> = {
  pc: {
    id: 'pc',
    family: 'pc',
    minViewports: 1,
    maxViewports: 2,
    maxBots: 40,
    hostMaxBots: 40,
    maxZombies: 60,
    hostMaxZombies: 60,
    maxViewDistanceM: 140,
    minPixelRatio: 0.5,
    maxPixelRatio: 2,
    dynamicResolution: true,
    fixedHeight: null,
    maxDebris: 500,
    antialias: true,
    targetFps: 60,
  },
  pcSplit: {
    id: 'pcSplit',
    family: 'pc',
    minViewports: 3,
    maxViewports: 4,
    maxBots: 24,
    hostMaxBots: 24,
    maxZombies: 40,
    hostMaxZombies: 40,
    maxViewDistanceM: 140,
    minPixelRatio: 0.5,
    maxPixelRatio: 2,
    dynamicResolution: true,
    fixedHeight: null,
    maxDebris: 500,
    antialias: true,
    targetFps: 60,
  },
  mobile: {
    id: 'mobile',
    family: 'mobile',
    minViewports: 1,
    maxViewports: 1,
    maxBots: 12,
    hostMaxBots: 8,
    maxZombies: 24,
    hostMaxZombies: 16,
    maxViewDistanceM: 90,
    minPixelRatio: 1,
    maxPixelRatio: 1.5,
    dynamicResolution: true,
    fixedHeight: null,
    maxDebris: 200,
    antialias: false,
    targetFps: 30,
  },
  switch1p: {
    id: 'switch1p',
    family: 'switch',
    minViewports: 1,
    maxViewports: 1,
    maxBots: 24,
    hostMaxBots: 24,
    maxZombies: 30,
    hostMaxZombies: 30,
    maxViewDistanceM: 90,
    minPixelRatio: 1,
    maxPixelRatio: 1,
    dynamicResolution: false,
    fixedHeight: 720,
    maxDebris: 200,
    antialias: false,
    targetFps: 30,
  },
  switch2p: {
    id: 'switch2p',
    family: 'switch',
    minViewports: 2,
    maxViewports: 2,
    maxBots: 16,
    hostMaxBots: 16,
    maxZombies: 24,
    hostMaxZombies: 24,
    maxViewDistanceM: 70,
    minPixelRatio: 1,
    maxPixelRatio: 1,
    dynamicResolution: false,
    fixedHeight: 720,
    maxDebris: 200,
    antialias: false,
    targetFps: 30,
  },
  switch34p: {
    id: 'switch34p',
    family: 'switch',
    minViewports: 3,
    maxViewports: 4,
    maxBots: 12,
    hostMaxBots: 12,
    maxZombies: 24,
    hostMaxZombies: 24,
    maxViewDistanceM: 50,
    minPixelRatio: 1,
    maxPixelRatio: 1,
    dynamicResolution: false,
    fixedHeight: 720,
    maxDebris: 120,
    antialias: false,
    targetFps: 30,
  },
};

/** Perfil para a família e o número de jogadores locais na tela (1 a 4; fora disso, limitado). */
export function selectPlatformProfile(family: PlatformFamily, localPlayers: number): PlatformProfile {
  const n = Math.max(1, Math.min(ENGINE_MAX_LOCAL_HUMANS, Math.floor(localPlayers)));
  if (family === 'mobile') return PLATFORM_PROFILES.mobile;
  if (family === 'switch') {
    return n === 1 ? PLATFORM_PROFILES.switch1p : n === 2 ? PLATFORM_PROFILES.switch2p : PLATFORM_PROFILES.switch34p;
  }
  return n <= 2 ? PLATFORM_PROFILES.pc : PLATFORM_PROFILES.pcSplit;
}

export interface RecipeLimitsOptions {
  /** Este aparelho hospeda uma sala online (teto menor no celular). */
  readonly onlineHost?: boolean;
}

/**
 * Tetos que `validateMatchRecipe` aplica para um perfil (sempre dentro da capacidade do motor). Humanos locais: até 4
 * em PC e Switch (tela dividida, decisões #1 e #24); 1 no celular, que não tem tela dividida. O número de vistas do
 * perfil NÃO limita a receita: um preset salvo com 2 slots humanos por time continua válido com 1 jogador na tela.
 */
export function recipeLimitsFor(profile: PlatformProfile, options: RecipeLimitsOptions = {}): RecipeLimits {
  const bots = options.onlineHost === true ? profile.hostMaxBots : profile.maxBots;
  return {
    maxBots: Math.min(ENGINE_MAX_BOTS, bots),
    maxLocalHumans: profile.family === 'mobile' ? 1 : ENGINE_MAX_LOCAL_HUMANS,
    maxViewDistanceM: profile.maxViewDistanceM,
  };
}
