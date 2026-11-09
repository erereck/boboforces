import { type BotRules, type MatchRecipe, resolveBot } from '@boboforces/format';
import { clamp, lerp, lerpAngle, smoothstep } from '@boboforces/shared';
import {
  ENTITY_KIND,
  entityIndex,
  expandRecipe,
  NULL_ENTITY,
  WEAPON_CODE,
  WEAPON_KILL_PLANE,
  WEAPON_NONE,
  WEAPONS,
  type SimView,
} from '@boboforces/sim';
import { t, type HudModel, type StringKey } from '@boboforces/ui';

/**
 * M2 (fase 2c): a tela de morte (gameplay.md §5.5; GDD §3.8). Lógica pura, sem DOM e sem alocar por frame: a câmera
 * que vira para quem matou, o cursor do menu radial da primária (movido pelo mesmo giro de mira do mapeador: mouse ou
 * analógico), a faixa "nome · arma · HP" e a dica da derrota feia. O `scene/match.ts` liga isto às vistas.
 */

/** Primárias do menu radial, na ordem do anel (a 1ª no alto, sentido horário). */
export const PRIMARY_ORDER: readonly number[] = [
  WEAPON_CODE.rifle,
  WEAPON_CODE.smg,
  WEAPON_CODE.shotgun,
  WEAPON_CODE.sniper,
  WEAPON_CODE.rocket,
  WEAPON_CODE.lmg,
];

export const DEATH_CAM = {
  /** Tempo da virada até quem matou (s) e quanto dura a câmera de morte (gameplay.md §5.5). */
  turnS: 0.5,
  holdS: 1.5,
  /** A câmera sobe isto acima do olho (m), para olhar por cima do corpo se desmontando. */
  riseM: 0.45,
  /** Altura do ponto mirado em quem matou (m acima dos pés): o peito. */
  chestM: 1.1,
  /**
   * Quem matou aparece acima do centro, nesta fração da meia altura da tela: no centro fica a contagem do respawn,
   * que o cobriria.
   */
  killerLift: 0.25,
} as const;

export const RADIAL = {
  /** Cursor por radiano de giro de mira: ~10° de mouse levam o cursor até a borda. */
  gain: 6,
  /** Zona morta do cursor (fração do raio): dentro dela, a escolha não muda. */
  pick: 0.6,
  /** Fileira e linha (vistas baixas, 3–4P): giro horizontal que passa uma opção (cursor, como o `gain`). */
  step: 0.5,
} as const;

/** Derrota feia (GDD §3.8): 5 mortes seguidas sem abate, ou perdendo por 50% ou mais da metade da partida em diante. */
export const HARD_TIME = { deathsWithoutKill: 5, losingFraction: 0.5, progress: 0.5 } as const;

/** Estado da morte de uma vista. */
export interface DeathState {
  /** Segundos desde a morte; -1 = vivo. */
  t: number;
  killer: number;
  victim: number;
  weapon: number;
  /** Mira da câmera no instante da morte (a virada parte dela). */
  startYaw: number;
  startPitch: number;
  /** Cursor do radial (x para a direita, y para cima; dentro do círculo de raio 1). */
  cursorX: number;
  cursorY: number;
  /** Mostra "Tá puxado?" nesta morte. */
  hint: boolean;
}

export function createDeathState(): DeathState {
  return {
    t: -1,
    killer: NULL_ENTITY,
    victim: NULL_ENTITY,
    weapon: WEAPON_NONE,
    startYaw: 0,
    startPitch: 0,
    cursorX: 0,
    cursorY: 0,
    hint: false,
  };
}

/** Começa a morte: quem matou, com o quê, e a mira da câmera agora. */
export function beginDeath(
  st: DeathState,
  victim: number,
  killer: number,
  weapon: number,
  yaw: number,
  pitch: number,
): void {
  st.t = 0;
  st.victim = victim;
  st.killer = killer;
  st.weapon = weapon;
  st.startYaw = yaw;
  st.startPitch = pitch;
  st.cursorX = 0;
  st.cursorY = 0;
  st.hint = false;
}

export function endDeath(st: DeathState): void {
  st.t = -1;
  st.hint = false;
}

/** A entidade deste id ainda existe na vista (mesma geração)? */
export function isCurrentEntity(view: SimView, id: number): boolean {
  if (id === NULL_ENTITY) return false;
  const i = entityIndex(id);
  return i < view.count && view.alive[i] === 1 && view.generation[i] === id >>> 16;
}

/**
 * Soma o giro de mira do quadro (yaw positivo = para a esquerda, pitch positivo = para cima) ao cursor do radial e o
 * mantém no círculo de raio 1.
 */
export function moveRadialCursor(st: DeathState, dyaw: number, dpitch: number): void {
  st.cursorX -= dyaw * RADIAL.gain;
  st.cursorY += dpitch * RADIAL.gain;
  const len = Math.hypot(st.cursorX, st.cursorY);
  if (len > 1) {
    st.cursorX /= len;
    st.cursorY /= len;
  }
}

/**
 * Fileira e linha: soma o giro horizontal ao cursor e devolve quantas opções andar (+1 para a direita, -1 para a
 * esquerda, 0 = nenhuma); a cada passo o cursor volta a zero.
 */
export function stepCursor(st: DeathState, dyaw: number): number {
  st.cursorX -= dyaw * RADIAL.gain;
  st.cursorY = 0;
  if (st.cursorX >= RADIAL.step) {
    st.cursorX = 0;
    return 1;
  }
  if (st.cursorX <= -RADIAL.step) {
    st.cursorX = 0;
    return -1;
  }
  return 0;
}

/** Opção do anel para onde o cursor aponta (0 = alto, sentido horário), ou -1 dentro da zona morta. */
export function radialIndex(x: number, y: number, count: number): number {
  if (count <= 0 || Math.hypot(x, y) < RADIAL.pick) return -1;
  let a = Math.atan2(x, y);
  if (a < 0) a += Math.PI * 2;
  return Math.round(a / ((Math.PI * 2) / count)) % count;
}

/**
 * Mira da câmera de morte (em `out`): parte da mira da morte e vira em `turnS` para o peito de quem matou, seguindo-o
 * enquanto ele existir, um pouco abaixo dele (`liftRad`: ele aparece acima da contagem do centro); sem matador
 * (acidente, queda, o próprio foguete), fica onde estava.
 */
export function deathCamAngles(
  st: DeathState,
  view: SimView,
  eyeX: number,
  eyeY: number,
  eyeZ: number,
  alpha: number,
  liftRad: number,
  out: { yaw: number; pitch: number },
): void {
  out.yaw = st.startYaw;
  out.pitch = st.startPitch;
  if (st.killer === st.victim || !isCurrentEntity(view, st.killer)) return;
  const k = entityIndex(st.killer);
  const o = k * 3;
  const dx = lerp(view.prevPosition[o]!, view.position[o]!, alpha) - eyeX;
  const dy = lerp(view.prevPosition[o + 1]!, view.position[o + 1]!, alpha) + DEATH_CAM.chestM - eyeY;
  const dz = lerp(view.prevPosition[o + 2]!, view.position[o + 2]!, alpha) - eyeZ;
  const flat = Math.hypot(dx, dz);
  if (flat < 1e-3) return;
  const blend = smoothstep(0, 1, clamp(st.t / DEATH_CAM.turnS, 0, 1));
  out.yaw = lerpAngle(st.startYaw, Math.atan2(-dx, -dz), blend);
  out.pitch = lerp(st.startPitch, Math.atan2(dy, flat) - liftRad, blend);
}

/**
 * Perdendo feio (GDD §3.8)? Só da metade da partida em diante (do tempo ou da meta, o que estiver mais adiantado). No
 * TDM, o time de `e` tem metade ou menos dos pontos do melhor adversário; no FFA, `e` tem metade ou menos dos abates do
 * líder.
 */
export function losingBadly(view: SimView, e: number, ffa: boolean, totalTicks: number, scoreLimit: number): boolean {
  const m = view.match;
  let leader = 0;
  let own = 0;
  if (ffa) {
    own = view.kills[e]!;
    for (let j = 0; j < view.count; j++) {
      if (j === e || view.alive[j] === 0 || view.kind[j] !== ENTITY_KIND.bobo) continue;
      if (view.kills[j]! > leader) leader = view.kills[j]!;
    }
  } else {
    const team = view.team[e]!;
    own = m.teamScore[team] ?? 0;
    for (let tIdx = 0; tIdx < m.teamScore.length; tIdx++) {
      if (tIdx !== team && m.teamScore[tIdx]! > leader) leader = m.teamScore[tIdx]!;
    }
  }
  const timeProgress = totalTicks > 0 && m.ticksLeft >= 0 ? 1 - m.ticksLeft / totalTicks : 0;
  const scoreProgress = scoreLimit > 0 ? Math.max(leader, own) / scoreLimit : 0;
  if (Math.max(timeProgress, scoreProgress) < HARD_TIME.progress) return false;
  return leader > 0 && own <= leader * HARD_TIME.losingFraction;
}

/** Textos da faixa, resolvidos uma vez (o desenho por frame não cria string). */
export interface DeathTexts {
  readonly killedBy: string;
  readonly self: string;
  readonly void: string;
  readonly fall: string;
  readonly pushedVoid: string;
  readonly bite: string;
  readonly zombie: string;
}

export function deathTexts(): DeathTexts {
  return {
    killedBy: t('death.killedBy').toUpperCase(),
    self: t('death.self'),
    void: t('death.void'),
    fall: t('death.fall'),
    pushedVoid: t('death.pushedVoid'),
    bite: t('death.bite'),
    zombie: t('zombie.name'),
  };
}

/**
 * Nome de cada controlador da receita: "P1"… para humanos; os bots de fábrica pela tabela de textos ("Normal Bob",
 * "Jorge the Immortal"), os embutidos pelo nome do documento. Só na criação da partida.
 */
export function controllerNames(recipe: MatchRecipe, humans: number): string[] {
  const out: string[] = [];
  for (const slot of expandRecipe(recipe, humans)) {
    if (slot.bot === null) out[slot.controller] = t('hud.player', { n: slot.controller + 1 });
    else if (slot.bot.startsWith('builtin:'))
      out[slot.controller] = t(`bot.name.${resolveBot(recipe, slot.bot).id}` as StringKey);
    else out[slot.controller] = resolveBot(recipe, slot.bot).name || t('bot.name.normal-bob');
  }
  return out;
}

/**
 * M2 (fecho da fase 3): as regras ativas de cada controlador (GDD §6.5: "toda regra ativa aparece no card do bot, no
 * placar e na tela de morte"), em texto: "500 de vida · só escopeta". Só as regras que a sim aplica (vida, dano,
 * velocidade, armas, munição, imune a tiro na cabeça, explode ao morrer); humanos e bots sem regra, `''`. Só na criação
 * da partida.
 */
export function controllerRules(recipe: MatchRecipe, humans: number): string[] {
  const out: string[] = [];
  for (const slot of expandRecipe(recipe, humans)) {
    out[slot.controller] = slot.bot === null ? '' : rulesText(resolveBot(recipe, slot.bot).rules);
  }
  return out;
}

/** O texto das regras de um bot (`''` sem nenhuma). */
export function rulesText(r: BotRules): string {
  const tags: string[] = [];
  if (r.hp !== 100) tags.push(t('rule.hp', { n: r.hp }));
  if (r.damageMult !== 1) tags.push(t('rule.damage', { n: r.damageMult }));
  if (r.speed !== 1) tags.push(t('rule.speed', { n: r.speed }));
  if (r.weapons.length > 0) {
    const list = r.weapons.map((id) => {
      const def = WEAPONS.find((w) => w.id === id);
      const name = def ? t(`weapon.category.${def.category}` as StringKey) : id;
      // "só escopeta", mas "só SMG".
      return name === name.toUpperCase() ? name : name.toLowerCase();
    });
    tags.push(t('rule.only', { list: list.join(t('rule.listSeparator')) }));
  }
  if (r.ammo === 'infiniteClip') tags.push(t('rule.infiniteClip'));
  else if (r.ammo === 'infiniteReserve') tags.push(t('rule.infiniteReserve'));
  if (r.headshotImmune) tags.push(t('rule.headshotImmune'));
  if (r.explodeOnDeath) tags.push(t('rule.explodeOnDeath'));
  return tags.join(t('rule.separator'));
}

/**
 * Linha da contagem inicial (gameplay.md §2.2: "Hoje: 6 Jorges"): os bots do outro time (no FFA, todos), agrupados por
 * nome na ordem da receita: "Hoje: 6 × Normal Bob". Sem bot adversário, `''`. Só na criação da partida.
 */
export function countdownLine(recipe: MatchRecipe, humans: number, names: readonly string[]): string {
  const ffa = recipe.mode === 'warfare.ffa';
  const counts = new Map<string, number>();
  for (const slot of expandRecipe(recipe, humans)) {
    if (slot.bot === null || (!ffa && slot.team === 0)) continue;
    const name = names[slot.controller] ?? '';
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  if (counts.size === 0) return '';
  const groups = [...counts].map(([name, n]) => t('countdown.group', { n, name }));
  return t('countdown.today', { list: groups.join(t('countdown.separator')) });
}

/**
 * Preenche a faixa da tela de morte no modelo da HUD: com matador, "ABATIDO POR" + "nome · arma · HP"; sem, só a
 * causa ("Caiu no vazio", "Queda"); o próprio foguete, "Foi você mesmo · Kaboomer".
 */
export function fillDeathBanner(
  m: HudModel,
  st: DeathState,
  view: SimView,
  names: readonly string[],
  weaponNames: readonly string[],
  tx: DeathTexts,
  rules: readonly string[] = [],
): void {
  m.deathRules = '';
  m.deathLabel = '';
  m.deathWeapon = '';
  m.deathHp = -1;
  if (st.killer === NULL_ENTITY) {
    m.deathName = st.weapon === WEAPON_KILL_PLANE ? tx.void : tx.fall;
    return;
  }
  if (st.killer === st.victim) {
    m.deathName = tx.self;
    m.deathWeapon = weaponNames[st.weapon] ?? '';
    return;
  }
  const k = entityIndex(st.killer);
  const zombie = k < view.count && view.kind[k] === ENTITY_KIND.zombie;
  m.deathLabel = tx.killedBy;
  m.deathName = zombie ? tx.zombie : (names[view.controller[k]!] ?? tx.zombie);
  m.deathWeapon =
    st.weapon === WEAPON_KILL_PLANE
      ? tx.pushedVoid
      : st.weapon === WEAPON_NONE
        ? tx.bite
        : (weaponNames[st.weapon] ?? '');
  m.deathHp = isCurrentEntity(view, st.killer) ? Math.max(0, view.health[k]!) : 0;
  if (!zombie) m.deathRules = rules[view.controller[k]!] ?? '';
}
