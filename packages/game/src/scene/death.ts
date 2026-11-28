import { type MatchRecipe, resolveBot } from '@boboforces/format';
import { rulesText } from '../bot-card.ts';
import { clamp, lerp, lerpAngle, smoothstep } from '@boboforces/shared';
import {
  ENTITY_KIND,
  entityIndex,
  expandRecipe,
  NULL_ENTITY,
  WEAPON_CODE,
  WEAPON_KILL_PLANE,
  WEAPON_NONE,
  weaponCodeOf,
  type SimView,
  WEAPON_ZONE,
} from '@boboforces/sim';
import { t, type HudModel, type PrimaryHit, type StringKey } from '@boboforces/ui';
import type { DeviceKind, RawInputState } from '@boboforces/input';
import { BLOCK_FLAG, createRayHit, raycastGrid } from '@boboforces/world';

/**
 * M2 (fase 2c): a tela de morte (gameplay.md §5.5; GDD §3.8). Lógica pura, sem DOM e sem alocar por frame: a câmera
 * que vira para quem matou, o cursor do menu radial da primária (movido pelo mesmo giro de mira do mapeador: mouse ou
 * analógico), a faixa "nome · arma · HP" e a dica da derrota feia. O `scene/match.ts` liga isto às vistas.
 */

/**
 * Primárias do menu radial, na ordem do anel (a 1ª no alto, sentido horário). M10 (AK5): as 4 primárias novas entram
 * ao lado da parecida (o DMR depois do fuzil, a escopeta automática depois da pump, a besta depois da sniper, o
 * lança-granadas depois do lança-foguetes); com mais de 8, o anel é o largo da HUD (`PrimaryHit.wide`).
 */
export const PRIMARY_ORDER: readonly number[] = [
  WEAPON_CODE.rifle,
  WEAPON_CODE.dmr,
  WEAPON_CODE.smg,
  WEAPON_CODE.shotgun,
  WEAPON_CODE.autoShotgun,
  WEAPON_CODE.sniper,
  WEAPON_CODE.crossbow,
  WEAPON_CODE.rocket,
  WEAPON_CODE.grenadeLauncher,
  WEAPON_CODE.lmg,
];

/**
 * M9 (fase 3b): as opções do radial que o jogador do time `team` pode pegar (índices em `PRIMARY_ORDER`), pela
 * mesma conta da sim: as armas do time (só no Sandbox) cruzadas com o `weapons.allowed` da partida (sem nada em
 * comum, o da partida); sem lista, todas. Com 0 ou 1 opção, o radial não tem o que escolher.
 */
export function primaryChoices(recipe: MatchRecipe, team: number): number[] {
  const codes = (ids: readonly string[] | undefined): Set<number> | null => {
    if (ids === undefined || ids.length === 0) return null;
    const out = new Set<number>();
    for (const id of ids) {
      const code = weaponCodeOf(id);
      if (code >= 0) out.add(code);
    }
    return out;
  };
  const match = codes(recipe.weapons?.allowed);
  let allowed = recipe.mode === 'sandbox' ? codes(recipe.teams[team]?.weapons) : null;
  if (match !== null) {
    if (allowed === null) allowed = match;
    else {
      const both = new Set([...allowed].filter((c) => match.has(c)));
      allowed = both.size > 0 ? both : match;
    }
  }
  const out: number[] = [];
  for (let i = 0; i < PRIMARY_ORDER.length; i++) if (allowed === null || allowed.has(PRIMARY_ORDER[i]!)) out.push(i);
  return out;
}

export const DEATH_CAM = {
  /** Tempo da virada até quem matou (s) e quanto dura a câmera de morte (gameplay.md §5.5). */
  turnS: 0.5,
  holdS: 1.5,
  /** A câmera sobe isto acima do olho (m), para olhar por cima do corpo se desmontando. */
  riseM: 0.45,
  /** Altura do ponto mirado em quem matou (m acima dos pés): o peito. M9 (fase 1b): vezes a escala dele. */
  chestM: 1.1,
  /**
   * M9 (fase 1b): o corpo maior que o normal (o bot gigante) cabe na tela: a câmera recua no plano, para longe dele,
   * até ficar a `fitM` × escala ÷ tan(meio fov vertical) do eixo dele (a meia altura do corpo com folga), no máximo
   * `maxBackM`. Colado na vítima, o gigante enchia a tela com a perna.
   */
  fitM: 1.2,
  maxBackM: 6,
  /** O recuo para isto antes da parede atrás (m). */
  wallM: 0.3,
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
  /** M12 (fase 2): o golpe foi na cabeça ("· NA CABEÇA" na faixa). */
  headshot: boolean;
  /**
   * M12 (fase 2, playtest): o seletor da primária já aceita entrada. Começa travado: só destrava depois de
   * `DEATH_ARM_S` e com o que estava apertado NA HORA DA MORTE solto (a seta que girava a mira caía no seletor e
   * trocava a arma), ou sozinho em `DEATH_ARM_MAX_S` (revisão: um dedo no joystick ou um gatilho parado em −1 não
   * prendem o seletor).
   */
  armed: boolean;
  /** O que estava apertado na morte (`snapshotHeld`): teclas, botões do mouse, do controle, analógicos e dedos. */
  heldKeys: Uint8Array;
  heldMouse: number;
  readonly heldButtons: Uint8Array;
  readonly heldAxes: Float32Array;
  readonly heldTouches: Float64Array;
  heldKind: DeviceKind;
  heldPad: number;
}

/** M12 (fase 2): o seletor da primária fica travado ao menos este tempo depois da morte (s), além de esperar soltar. */
export const DEATH_ARM_S = 0.35;
/** M12 (fase 2, revisão): e destrava sozinho depois deste tempo (s), mesmo com algo ainda apertado. */
export const DEATH_ARM_MAX_S = 1.5;

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
    headshot: false,
    armed: false,
    heldKeys: new Uint8Array(0),
    heldMouse: 0,
    heldButtons: new Uint8Array(HELD_BUTTONS),
    heldAxes: new Float32Array(HELD_AXES),
    heldTouches: new Float64Array(HELD_TOUCHES).fill(Number.NaN),
    heldKind: 'keyboardMouse',
    heldPad: 0,
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
  headshot = false,
): void {
  st.t = 0;
  st.headshot = headshot;
  st.armed = false;
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

/** Quantos botões, analógicos e dedos o retrato do que estava apertado guarda (os do `RawInputState` cabem). */
const HELD_BUTTONS = 32;
const HELD_AXES = 8;
const HELD_TOUCHES = 10;
/** Botão apertado e analógico fora do centro (acima de qualquer zona morta de controle gasto). */
const HELD_BUTTON = 0.5;
const HELD_AXIS = 0.35;
/** O analógico que andou isto desde a morte foi solto (ou mexido de novo: um gatilho parado em −1 não conta). */
const AXIS_MOVED = 0.3;

/**
 * M12 (fase 2, revisão): guarda o que estava apertado no dispositivo do jogador (`kind`, o controle `pad`) na hora da
 * morte. Sem alocar (fora as teclas, na 1ª vez).
 */
export function snapshotHeld(st: DeathState, raw: Readonly<RawInputState>, kind: DeviceKind, pad: number): void {
  st.heldKind = kind;
  st.heldPad = pad;
  if (st.heldKeys.length !== raw.keys.length) st.heldKeys = new Uint8Array(raw.keys.length);
  st.heldKeys.set(raw.keys);
  st.heldMouse = raw.mouseButtons;
  st.heldButtons.fill(0);
  st.heldAxes.fill(0);
  const p = raw.gamepads[pad];
  if (p !== undefined && p.connected) {
    for (let i = 0; i < p.buttons.length && i < HELD_BUTTONS; i++)
      st.heldButtons[i] = p.buttons[i]! >= HELD_BUTTON ? 1 : 0;
    for (let i = 0; i < p.axes.length && i < HELD_AXES; i++) st.heldAxes[i] = p.axes[i]!;
  }
  st.heldTouches.fill(Number.NaN);
  for (let i = 0, n = 0; i < raw.touches.length && n < HELD_TOUCHES; i++) {
    if (raw.touches[i]!.active) st.heldTouches[n++] = raw.touches[i]!.id;
  }
}

/**
 * M12 (fase 2, revisão): alguma coisa que estava apertada na morte (`snapshotHeld`) continua apertada? Só o que já
 * estava: uma tecla nova, outro dedo ou um gatilho parado não seguram o seletor.
 */
export function stillHeld(st: DeathState, raw: Readonly<RawInputState>): boolean {
  if (st.heldKind === 'touch') {
    for (let i = 0; i < raw.touches.length; i++) {
      const tch = raw.touches[i]!;
      if (!tch.active) continue;
      for (let k = 0; k < HELD_TOUCHES; k++) if (st.heldTouches[k] === tch.id) return true;
    }
    return false;
  }
  if (st.heldKind === 'gamepad') {
    const p = raw.gamepads[st.heldPad];
    if (p === undefined || !p.connected) return false;
    for (let i = 0; i < p.buttons.length && i < HELD_BUTTONS; i++) {
      if (st.heldButtons[i] === 1 && p.buttons[i]! >= HELD_BUTTON) return true;
    }
    for (let i = 0; i < p.axes.length && i < HELD_AXES; i++) {
      const was = st.heldAxes[i]!;
      if (Math.abs(was) >= HELD_AXIS && Math.abs(p.axes[i]! - was) < AXIS_MOVED) return true;
    }
    return false;
  }
  if ((raw.mouseButtons & st.heldMouse) !== 0) return true;
  const keys = st.heldKeys;
  for (let i = 0; i < raw.keys.length && i < keys.length; i++) if (keys[i] === 1 && raw.keys[i] === 1) return true;
  return false;
}

/** O seletor destrava agora? (`DEATH_ARM_S` passou e o que estava apertado foi solto, ou `DEATH_ARM_MAX_S` passou.) */
export function deathArmed(st: DeathState, raw: Readonly<RawInputState>): boolean {
  if (st.t < DEATH_ARM_S) return false;
  return st.t >= DEATH_ARM_MAX_S || !stillHeld(st, raw);
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
 * M10 (revisão): um passo (`step` ±1) nas `count` opções a partir de `pick`, dando a volta; sem escolha ainda (-1), o
 * passo para a frente vai à 1ª e o para trás à última.
 */
export function stepPick(pick: number, step: number, count: number): number {
  if (count <= 0) return -1;
  if (pick < 0) return step > 0 ? 0 : count - 1;
  return (((pick + step) % count) + count) % count;
}

/**
 * M10: a opção do anel que a HUD desenhou no quadro anterior na direção do cursor (x para a direita, y para cima),
 * ou -1 na zona morta. No anel largo (`hit.wide`, mais de 8 opções numa elipse, em ângulos que não são iguais) vale a
 * plaquinha mais perto em ângulo, vista do centro do anel; no redondo, o setor de sempre (`radialIndex`).
 */
export function ringPick(hit: PrimaryHit, x: number, y: number, count: number): number {
  if (!hit.wide || hit.count === 0) return radialIndex(x, y, count);
  if (Math.hypot(x, y) < RADIAL.pick) return -1;
  const want = Math.atan2(x, y);
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < hit.count; i++) {
    const r = hit.rects;
    const ox = r[i * 4]! + r[i * 4 + 2]! / 2 - hit.centerX;
    const oy = hit.centerY - (r[i * 4 + 1]! + r[i * 4 + 3]! / 2);
    let d = Math.abs(Math.atan2(ox, oy) - want);
    if (d > Math.PI) d = Math.PI * 2 - d;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * Mira da câmera de morte (em `out`): parte da mira da morte e vira em `turnS` para o peito de quem matou, seguindo-o
 * enquanto ele existir, um pouco abaixo dele (`liftRad`: ele aparece acima da contagem do centro); sem matador
 * (acidente, queda, o próprio foguete), fica onde estava. M9 (fase 1b): `killerScale` é a escala do corpo de quem
 * matou (o Mini e o gigante; a do desenho): o peito sobe e desce com ela.
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
  killerScale = 1,
): void {
  out.yaw = st.startYaw;
  out.pitch = st.startPitch;
  if (st.killer === st.victim || !isCurrentEntity(view, st.killer)) return;
  const k = entityIndex(st.killer);
  const o = k * 3;
  const dx = lerp(view.prevPosition[o]!, view.position[o]!, alpha) - eyeX;
  const dy = lerp(view.prevPosition[o + 1]!, view.position[o + 1]!, alpha) + DEATH_CAM.chestM * killerScale - eyeY;
  const dz = lerp(view.prevPosition[o + 2]!, view.position[o + 2]!, alpha) - eyeZ;
  const flat = Math.hypot(dx, dz);
  if (flat < 1e-3) return;
  const blend = smoothstep(0, 1, clamp(st.t / DEATH_CAM.turnS, 0, 1));
  out.yaw = lerpAngle(st.startYaw, Math.atan2(-dx, -dz), blend);
  out.pitch = lerp(st.startPitch, Math.atan2(dy, flat) - liftRad, blend);
}

const backHit = createRayHit();

/**
 * M9 (fase 1b): o recuo da câmera de morte, no olho (eyeX, eyeY, eyeZ), para o corpo grande de quem matou caber na
 * tela (`DEATH_CAM.fitM`). Escreve em `out` a direção no plano (unitária, para longe dele) e devolve quanto recuar (m;
 * 0 com escala ≤ 1, sem matador ou já longe), crescendo com a virada (`turnS`) e parando `wallM` antes da parede atrás.
 */
export function deathCamBackoff(
  st: DeathState,
  view: SimView,
  eyeX: number,
  eyeY: number,
  eyeZ: number,
  alpha: number,
  fovY: number,
  killerScale: number,
  out: { x: number; z: number },
): number {
  out.x = 0;
  out.z = 0;
  if (killerScale <= 1 || st.killer === st.victim || !isCurrentEntity(view, st.killer)) return 0;
  const o = entityIndex(st.killer) * 3;
  const dx = eyeX - lerp(view.prevPosition[o]!, view.position[o]!, alpha);
  const dz = eyeZ - lerp(view.prevPosition[o + 2]!, view.position[o + 2]!, alpha);
  const flat = Math.hypot(dx, dz);
  if (flat < 1e-3) return 0;
  const ux = dx / flat;
  const uz = dz / flat;
  out.x = ux;
  out.z = uz;
  const need = (DEATH_CAM.fitM * killerScale) / Math.tan(fovY / 2);
  const blend = smoothstep(0, 1, clamp(st.t / DEATH_CAM.turnS, 0, 1));
  let back = Math.min(DEATH_CAM.maxBackM, Math.max(0, need - flat)) * blend;
  if (back <= 0) return 0;
  const wall = DEATH_CAM.wallM;
  if (
    raycastGrid(view.world, view.blocks, eyeX, eyeY, eyeZ, ux, 0, uz, back + wall, BACK_MASK, backHit, view.colliders)
  )
    back = Math.max(0, backHit.distance - wall);
  return back;
}

/** O que segura o recuo da câmera de morte: bloco sólido ou que tapa a visão. */
const BACK_MASK = BLOCK_FLAG.solid | BLOCK_FLAG.blocksSight;

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
  /** M7 (fase 8): a zona do Bobo Royale. */
  readonly zone: string;
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
    zone: t('death.zone' as StringKey),
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

// M2 (fase 5a): o texto das regras mora no `bot-card` (o menu da Oficina usa o mesmo).
export { rulesText } from '../bot-card.ts';

/**
 * Linha da contagem inicial (gameplay.md §2.2: "Hoje: 6 Jorges"): os bots do outro time (no FFA, todos), agrupados por
 * nome na ordem da receita: "Hoje: 6 × Normal Bob". Sem bot adversário, `''`. Só na criação da partida.
 */
export function countdownLine(
  recipe: MatchRecipe,
  humans: number,
  names: readonly string[],
  me: number | null = null,
): string {
  const ffa = recipe.mode === 'warfare.ffa';
  const counts = new Map<string, number>();
  const slots = expandRecipe(recipe, humans);
  // M9 (fase 3): o seu time é o do jogador 1 (`me`; no Sandbox pode não ser o 0, e no sofá o controlador 0 pode
  // ser outro jogador); sem ele, o do 1º humano; sem humano, o 0.
  const own =
    (me !== null ? slots.find((s) => s.controller === me)?.team : undefined) ??
    slots.find((s) => s.bot === null)?.team ??
    0;
  for (const slot of slots) {
    if (slot.bot === null || (!ffa && slot.team === own)) continue;
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
  // M12 (fase 2): "· NA CABEÇA" só com quem matou (e não foi você mesmo).
  m.deathHead = st.headshot && st.killer !== NULL_ENTITY && st.killer !== st.victim;
  if (st.killer === NULL_ENTITY) {
    m.deathName = st.weapon === WEAPON_KILL_PLANE ? tx.void : st.weapon === WEAPON_ZONE ? tx.zone : tx.fall;
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
