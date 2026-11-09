import { LEVEL_ORDER, LEVEL_SKILLS, type BotLevel, type BotSkill } from '@boboforces/format';

/**
 * Movimento em combate (gameplay.md §6.2): parado, strafe leve (metade do tempo), strafe, ou strafe com agachadas e
 * pulinhos de esquiva (a partir do Suado, §3.6).
 */
export type CombatMove = 'none' | 'light' | 'strafe' | 'strafeDodge';

/**
 * Habilidade mecânica do bot (eixo "habilidade" do Laboratório, gameplay.md §6.2), mais o nível de inteligência e o
 * movimento em combate, que o M0 já usa. Os outros eixos (personalidade, regras) e os parâmetros que o M0 ainda não
 * usa (disciplina de tiro, granada, troca de alvo) entram no M2 sem mudar estes campos.
 */
export interface AimSkill {
  /** Entre ver o alvo e começar a mirar, s. */
  readonly reactionS: number;
  /** Erro de mira mínimo depois de "fechar" a mira, graus (desvio padrão do erro gaussiano). */
  readonly aimErrorDeg: number;
  /** Tempo para o erro cair do inicial (3x) ao mínimo, s. */
  readonly acquireS: number;
  /** Velocidade de giro da mira, graus/s. */
  readonly turnDegPerS: number;
  /** Quanto do recuo acumulado o bot compensa (0..1). */
  readonly recoilControl: number;
  /** Chance de mirar na cabeça em vez do tronco, por engajamento (0..1). */
  readonly headPreference: number;
  /** Nível de inteligência N0..N4 (gameplay.md §6.3). No M0 só informa; o comportamento é o do N0. */
  readonly intelligence: number;
  readonly combatMove: CombatMove;
}

/**
 * Os 5 níveis rápidos (decisão #21, tabela da gameplay.md §6.6). Nenhum nível tem vantagem de regra; a diferença é só
 * habilidade (e inteligência a partir do M2). O robô de balanceamento (`npm run balance`) garante a ordem.
 */
export const BOT_SKILLS: Readonly<Record<BotLevel, AimSkill>> = {
  vibe: {
    reactionS: 0.9,
    aimErrorDeg: 6,
    acquireS: 1.2,
    turnDegPerS: 150,
    recoilControl: 0.1,
    headPreference: 0.05,
    intelligence: 0,
    combatMove: 'none',
  },
  chill: {
    reactionS: 0.65,
    aimErrorDeg: 3.5,
    acquireS: 0.9,
    turnDegPerS: 220,
    recoilControl: 0.3,
    headPreference: 0.1,
    intelligence: 1,
    combatMove: 'light',
  },
  normal: {
    reactionS: 0.45,
    aimErrorDeg: 2,
    acquireS: 0.6,
    turnDegPerS: 320,
    recoilControl: 0.5,
    headPreference: 0.2,
    intelligence: 2,
    combatMove: 'strafe',
  },
  sweaty: {
    reactionS: 0.3,
    aimErrorDeg: 1,
    acquireS: 0.35,
    turnDegPerS: 500,
    recoilControl: 0.75,
    headPreference: 0.4,
    intelligence: 3,
    combatMove: 'strafeDodge',
  },
  tryhard: {
    reactionS: 0.18,
    aimErrorDeg: 0.4,
    acquireS: 0.2,
    turnDegPerS: 800,
    recoilControl: 0.95,
    headPreference: 0.65,
    intelligence: 4,
    combatMove: 'strafeDodge',
  },
};

/** Nível rápido → parâmetros de habilidade (preset dos eixos, gameplay.md §6.6). */
export function aimSkillForLevel(level: BotLevel): AimSkill {
  return BOT_SKILLS[level];
}

/**
 * M2 (fase 3a): a habilidade de um `bot@1` (ms → s) com o nível de inteligência dele. Para os 5 níveis rápidos dá
 * exatamente a `BOT_SKILLS` (o teste confere), então os bots de nível jogam igual.
 */
export function aimSkillFromBot(s: BotSkill, intelligence: number): AimSkill {
  return {
    reactionS: s.reactionMs / 1000,
    aimErrorDeg: s.aimErrorDeg,
    acquireS: s.acquireS,
    turnDegPerS: s.turnDegS,
    recoilControl: s.recoilControl,
    headPreference: s.headPref,
    intelligence,
    combatMove: s.combatMove,
  };
}

/** A tabela do format (`LEVEL_SKILLS`) tem que bater com a `BOT_SKILLS` (uma fonte da verdade por enquanto). */
export function levelSkillsMatch(): boolean {
  return LEVEL_ORDER.every((level, i) => {
    const a = aimSkillFromBot(LEVEL_SKILLS[level], i);
    const b = BOT_SKILLS[level];
    return (Object.keys(b) as (keyof AimSkill)[]).every(
      (k) => Math.abs(Number(a[k]) - Number(b[k])) < 1e-9 || a[k] === b[k],
    );
  });
}
