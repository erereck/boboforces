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
  /**
   * M1: orçamento da IA por tick (unidades de trabalho, regra 10): raios de percepção e nós de A* (fatias de 200 por
   * chamada). [PROPOSTA] até o Teste Zero: Switch e celular com 3/4 do PC (o QuickJS do nx.js interpreta o JS).
   */
  readonly aiRaysPerTick: number;
  readonly aiPathNodesPerTick: number;
  /**
   * Boneco (#56; PLANO do porte §B6): até esta distância (m) de alguma vista, a animação roda inteira todo quadro (L0);
   * além dela, em meia taxa quando `figureHalfRate` (L1). Fora de todas as vistas, só o deslocamento da raiz (L2).
   */
  readonly figureNearM: number;
  readonly figureHalfRate: boolean;
  /** Quantos looks de `FIGURE_BOT_ROTATION` os bots usam (§B15): cada look custa uma skin por time no loading. */
  readonly figureBotLooks: number;
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
    aiRaysPerTick: 16,
    aiPathNodesPerTick: 800,
    figureNearM: 40,
    figureHalfRate: false,
    figureBotLooks: 6,
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
    aiRaysPerTick: 16,
    aiPathNodesPerTick: 800,
    figureNearM: 40,
    figureHalfRate: false,
    figureBotLooks: 6,
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
    aiRaysPerTick: 12,
    aiPathNodesPerTick: 600,
    figureNearM: 20,
    figureHalfRate: true,
    figureBotLooks: 3,
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
    aiRaysPerTick: 12,
    aiPathNodesPerTick: 600,
    figureNearM: 20,
    figureHalfRate: true,
    figureBotLooks: 3,
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
    aiRaysPerTick: 12,
    aiPathNodesPerTick: 600,
    figureNearM: 20,
    figureHalfRate: true,
    figureBotLooks: 3,
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
    aiRaysPerTick: 12,
    aiPathNodesPerTick: 600,
    figureNearM: 20,
    figureHalfRate: true,
    figureBotLooks: 3,
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

/** Menor `figureNearM` aceito: abaixo disso a meia taxa apareceria no corpo a corpo. */
const MIN_FIGURE_NEAR_M = 5;
/** Tamanho de `FIGURE_BOT_ROTATION` (`model/figure-presets.ts`; o teste confere que é o mesmo). */
const MAX_FIGURE_BOT_LOOKS = 11;

/**
 * Confere um perfil (regra 19): coerência das faixas e os tetos do motor. Devolve as mensagens (pt-BR, para log e
 * teste; o jogador nunca as vê); vazio = ok.
 */
export function validatePlatformProfile(profile: PlatformProfile): readonly string[] {
  const out: string[] = [];
  const p = profile;
  const int = (v: number, min: number, max: number): boolean => Number.isInteger(v) && v >= min && v <= max;
  if (!(PLATFORM_PROFILE_IDS as readonly string[]).includes(p.id)) out.push(`perfil desconhecido: ${p.id}`);
  if (!int(p.minViewports, 1, ENGINE_MAX_LOCAL_HUMANS) || !int(p.maxViewports, p.minViewports, ENGINE_MAX_LOCAL_HUMANS))
    out.push(`${p.id}: vistas fora de 1..${ENGINE_MAX_LOCAL_HUMANS} ou mínimo acima do máximo`);
  if (!int(p.maxBots, 0, ENGINE_MAX_BOTS) || !int(p.hostMaxBots, 0, p.maxBots))
    out.push(`${p.id}: bots fora de 0..${ENGINE_MAX_BOTS} ou host acima do teto`);
  if (!int(p.maxZombies, 0, ENGINE_MAX_ZOMBIES) || !int(p.hostMaxZombies, 0, p.maxZombies))
    out.push(`${p.id}: zumbis fora de 0..${ENGINE_MAX_ZOMBIES} ou host acima do teto`);
  if (!(Number.isFinite(p.maxViewDistanceM) && p.maxViewDistanceM > 0)) out.push(`${p.id}: alcance de visão inválido`);
  if (!(p.minPixelRatio > 0 && p.minPixelRatio <= p.maxPixelRatio)) out.push(`${p.id}: faixa de DPR inválida`);
  if (p.family === 'switch' && (p.fixedHeight !== 720 || p.antialias))
    out.push(`${p.id}: o Switch roda em 720p sem MSAA (regra 6)`);
  if (!(Number.isFinite(p.figureNearM) && p.figureNearM >= MIN_FIGURE_NEAR_M && p.figureNearM <= p.maxViewDistanceM))
    out.push(`${p.id}: figureNearM fora de ${MIN_FIGURE_NEAR_M}..${p.maxViewDistanceM} m`);
  if (typeof p.figureHalfRate !== 'boolean') out.push(`${p.id}: figureHalfRate precisa ser booleano`);
  if (!int(p.figureBotLooks, 1, MAX_FIGURE_BOT_LOOKS))
    out.push(`${p.id}: figureBotLooks fora de 1..${MAX_FIGURE_BOT_LOOKS}`);
  return out;
}
