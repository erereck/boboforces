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

/**
 * M8 (fase 5): o ajuste do Diretor de Partida sobre a mira (gameplay.md §6.8: "erro e reação", interpolados entre os
 * níveis da §6.6). Multiplica a reação, o erro, a aquisição e o giro do bot; inteligência, personalidade, regras, recuo
 * e cabeça não mudam. Tudo 1 sem ajuste (o golden não muda).
 */
export interface SkillShift {
  reaction: number;
  aimError: number;
  acquire: number;
  turn: number;
}

type ShiftedKey = 'reactionS' | 'aimErrorDeg' | 'acquireS' | 'turnDegPerS';

const SHIFTED_KEYS: readonly ShiftedKey[] = ['reactionS', 'aimErrorDeg', 'acquireS', 'turnDegPerS'];

const TOP_LEVEL = LEVEL_ORDER.length - 1;

/** O valor da tabela dos 5 níveis numa posição quebrada (0 = Pela vibe … 4 = Tryhard), entre os dois vizinhos. */
function levelValue(key: ShiftedKey, pos: number): number {
  const lo = Math.min(TOP_LEVEL, Math.floor(pos));
  const hi = Math.min(TOP_LEVEL, lo + 1);
  const a = BOT_SKILLS[LEVEL_ORDER[lo]!][key];
  const b = BOT_SKILLS[LEVEL_ORDER[hi]!][key];
  return a + (b - a) * (pos - lo);
}

/**
 * Onde o valor do bot cai na tabela (0..4, o inverso de `levelValue`; a tabela é monótona em cada campo). Fora dela,
 * a ponta mais perto: a mira de um bot da Oficina pior que a do Pela vibe fica no 0.
 */
function levelPos(key: ShiftedKey, v: number): number {
  for (let k = 0; k < TOP_LEVEL; k++) {
    const a = BOT_SKILLS[LEVEL_ORDER[k]!][key];
    const b = BOT_SKILLS[LEVEL_ORDER[k + 1]!][key];
    if ((v - a) * (v - b) <= 0) return a === b ? k : k + (v - a) / (b - a);
  }
  const first = BOT_SKILLS[LEVEL_ORDER[0]!][key];
  const last = BOT_SKILLS[LEVEL_ORDER[TOP_LEVEL]!][key];
  return Math.abs(v - first) < Math.abs(v - last) ? 0 : TOP_LEVEL;
}

/** O multiplicador de um campo: a razão da tabela entre a posição do bot e ela mais `quarters` quartos de nível. */
function shiftOf(key: ShiftedKey, v: number, quarters: number): number {
  const pos = levelPos(key, v);
  const to = Math.max(0, Math.min(TOP_LEVEL, pos + quarters / 4));
  return to === pos ? 1 : levelValue(key, to) / levelValue(key, pos);
}

/**
 * Os multiplicadores de `quarters` quartos de nível (+ = melhor) sobre a mira `skill`: cada campo anda na tabela a
 * partir de onde o valor do bot está nela (num bot de nível, a mira fica exatamente entre os dois níveis; num da
 * Oficina, com a mira de um nível e a inteligência de outro, também vale a mira). Nas pontas da tabela (Pela vibe −,
 * Tryhard +) não há para onde ir: fica 1. Escreve em `out` (sem alocar).
 */
export function skillShift(skill: AimSkill, quarters: number, out: SkillShift): SkillShift {
  if (quarters === 0) {
    out.reaction = 1;
    out.aimError = 1;
    out.acquire = 1;
    out.turn = 1;
    return out;
  }
  out.reaction = shiftOf('reactionS', skill.reactionS, quarters);
  out.aimError = shiftOf('aimErrorDeg', skill.aimErrorDeg, quarters);
  out.acquire = shiftOf('acquireS', skill.acquireS, quarters);
  out.turn = shiftOf('turnDegPerS', skill.turnDegPerS, quarters);
  return out;
}

/** A folga da mira na tabela, em quartos de nível: quanto ela ainda pode melhorar (`up`) e piorar (`down`). */
export interface SkillRoom {
  up: number;
  down: number;
}

/**
 * M8 (fase 5, revisão): a folga de `skill` (o campo com mais folga em cada sentido; um quarto começado conta). O
 * Diretor não passa dela: um Tryhard não fica "+1" no placar sem mudar nada.
 */
export function skillRoom(skill: AimSkill, out: SkillRoom): SkillRoom {
  let lo: number = TOP_LEVEL;
  let hi = 0;
  for (const key of SHIFTED_KEYS) {
    const pos = levelPos(key, skill[key]);
    lo = Math.min(lo, pos);
    hi = Math.max(hi, pos);
  }
  out.up = Math.max(0, Math.ceil((TOP_LEVEL - lo) * 4 - 1e-9));
  out.down = Math.max(0, Math.ceil(hi * 4 - 1e-9));
  return out;
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
