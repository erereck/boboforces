// Bonecos do FutBobo na cena (#56, PLANO do porte §B15 e §D passo 5): as aparências da partida, a tabela de jogo, os
// gabaritos e as skins de 2 camadas. Tudo no loading (etapas "figuras" e "skins"); a partida só consulta tabelas
// prontas por frame (regra 11). O gancho dos prints pode pedir looks fora da cena (só fora do Switch).
//
// Aparências: a rotação dos bots (`FIGURE_BOT_ROTATION`, as `figureBotLooks` primeiras do perfil) × os times da partida
// (sem time, A, B…) + o zumbi; os manequins do mapa e, com o pedido de prints, a fila (os 11 da rotação + o padrão nos
// times A e B). Cada (look, time) é um CONJUNTO = uma skin. Sobrando conjunto além da reserva (32 skins de
// `FIGURE_SKIN_LAYERS` camadas), o excedente veste o look padrão do PRÓPRIO time (nunca o colete de outro time) e conta
// como alarme no relatório.
import {
  createFigureGameTable,
  createFigureTemplateSet,
  disposeFigurePaint,
  FIGURE_BOT_ROTATION,
  FIGURE_LOOK_DEFAULT,
  FIGURE_PRESETS,
  FIGURE_SKIN_LAYERS,
  normalizeFigureLook,
  paintFigureSkin,
  type FigureGameTable,
  type FigureLook,
  type FigurePresetId,
  type FigureTemplateSet,
  type MapMannequin,
  type PlatformProfile,
} from '@boboforces/format';
import { createFigureSkinCache, type FigureSkinCache } from '@boboforces/render/data';
import { fnv1a32String } from '@boboforces/shared';
import { TEAM_COLORS } from '@boboforces/ui';

/** Id do look padrão (`FIGURE_LOOK_DEFAULT`): o do bot excedente e o 12º da fila dos prints. */
export const FIGURE_DEFAULT_LOOK = 'padrao';
/** Times por conjunto: −1 (sem time) e 0..3 (`slot = time + 1`). */
export const FIGURE_TEAM_SLOTS = 5;
/** O zumbi (`skin:zombie`): look próprio, sempre sem time. */
export const FIGURE_ZOMBIE_LOOK: FigurePresetId = 'zombie';

/**
 * M3 (fase 5b): o look de cada `ZOMBIE_TYPE` da sim (o que anda e o que corre são o comum; depois Sprinter, Chonker,
 * Spitter e o chefão). Só no Bobo Zombies (`SceneFiguresInput.zombieKinds`); fora dele, todo zumbi é o comum.
 */
export const FIGURE_ZOMBIE_TYPE_LOOKS: readonly FigurePresetId[] = [
  'zombie',
  'zombie',
  'zombie-sprinter',
  'zombie-chonker',
  'zombie-spitter',
  'zombie-mega',
];
/** M2 (fase 6c): o look do Meu Bobo (o jogador 1), um id que não é de preset. */
export const FIGURE_PLAYER_LOOK = 'jogador';

/** Um conjunto pedido: look (id de `FIGURE_PRESETS`, `padrao` ou um id de look montado pelo gancho) e time. */
export interface FigureSkinSet {
  readonly look: string;
  readonly team: number;
}

export interface FigureSkinPlan {
  /** Conjuntos que viram skin (distintos, na ordem do pedido; os padrões reservados no fim, se houve estouro). */
  readonly sets: readonly FigureSkinSet[];
  /** `look|time` pedido → índice em `sets` (o excedente aponta para o padrão do próprio time). */
  readonly redirect: ReadonlyMap<string, number>;
  /** Conjuntos pedidos que não couberam (alarme). */
  readonly overflow: readonly string[];
}

export function figureSetKey(look: string, team: number): string {
  return `${look}|${team}`;
}

/**
 * Plano das skins: cada conjunto distinto ganha uma skin enquanto couber em `capacity`. Passou: reserva o padrão de
 * cada time presente (o do próprio time) e corta o resto pela ordem do pedido (o que vem primeiro fica: zumbi, depois
 * a rotação, depois manequins e prints). Puro (sem pintar nada).
 */
export function planFigureSkins(requested: readonly FigureSkinSet[], capacity: number): FigureSkinPlan {
  const distinct: FigureSkinSet[] = [];
  const seen = new Set<string>();
  for (const s of requested) {
    const key = figureSetKey(s.look, s.team);
    if (seen.has(key)) continue;
    seen.add(key);
    distinct.push(s);
  }
  const redirect = new Map<string, number>();
  if (distinct.length <= capacity) {
    distinct.forEach((s, i) => redirect.set(figureSetKey(s.look, s.team), i));
    return { sets: distinct, redirect, overflow: [] };
  }
  const teams: number[] = [];
  for (const s of distinct) if (!teams.includes(s.team)) teams.push(s.team);
  const budget = capacity - teams.length;
  if (budget < 0) throw new Error(`skins: ${teams.length} times não cabem em ${capacity} skins`);
  const chosen: FigureSkinSet[] = [];
  const overflow: string[] = [];
  const excess: FigureSkinSet[] = [];
  for (const s of distinct) {
    if (s.look === FIGURE_DEFAULT_LOOK) continue;
    if (chosen.length < budget) chosen.push(s);
    else excess.push(s);
  }
  const sets: FigureSkinSet[] = [...chosen, ...teams.map((team) => ({ look: FIGURE_DEFAULT_LOOK, team }))];
  sets.forEach((s, i) => redirect.set(figureSetKey(s.look, s.team), i));
  for (const s of excess) {
    const key = figureSetKey(s.look, s.team);
    overflow.push(key);
    redirect.set(key, redirect.get(figureSetKey(FIGURE_DEFAULT_LOOK, s.team))!);
  }
  return { sets, redirect, overflow };
}

/** Look de um id de preset (`recruit`, com ou sem o prefixo `skin:`) ou do padrão; `null` = id desconhecido. */
export function figureLookById(id: string): FigureLook | null {
  const bare = id.startsWith('skin:') ? id.slice('skin:'.length) : id;
  if (bare === FIGURE_DEFAULT_LOOK) return FIGURE_LOOK_DEFAULT;
  return Object.hasOwn(FIGURE_PRESETS, bare) ? FIGURE_PRESETS[bare as FigurePresetId] : null;
}

/** Id sem o prefixo `skin:` (o `MapMannequin.look` já vem sem). */
export function bareLookId(id: string): string {
  return id.startsWith('skin:') ? id.slice('skin:'.length) : id;
}

/**
 * M2 (fase 8a): o look de cada controlador na rotação dos bots (GDD §4.7.2, #58: visual genérico que sai do hash do
 * nome). O mesmo bot veste o mesmo look em qualquer partida; bots com o mesmo nome (o mesmo bot de fábrica repetido)
 * seguem a rotação a partir dele, para não saírem iguais.
 */
export function botLookIndices(names: readonly (string | undefined)[], looks: number): Uint8Array {
  const n = Math.max(1, Math.floor(looks));
  const out = new Uint8Array(names.length);
  const seen = new Map<string, number>();
  for (let c = 0; c < names.length; c++) {
    const name = names[c] ?? '';
    const k = seen.get(name) ?? 0;
    seen.set(name, k + 1);
    out[c] = (fnv1a32String(name) + k) % n;
  }
  return out;
}

/** Cores dos times da partida em RGB (`0xRRGGBB`; o `TEAM_COLORS` do ui é RGBA). */
export function figureTeamColors(teamCount: number): number[] {
  const n = Math.max(2, Math.min(TEAM_COLORS.length, teamCount));
  return TEAM_COLORS.slice(0, n).map((rgba) => rgba >>> 8);
}

export interface SceneFiguresInput {
  /** M3 (fase 5b): pinta os especiais do Bobo Zombies (uma skin por tipo); fora do modo, só o zumbi comum. */
  readonly zombieKinds?: boolean;
  readonly profile: PlatformProfile;
  /** Times da partida (os coletes A e B existem mesmo no FFA da vitrine: no mínimo 2). */
  readonly teamCount: number;
  readonly mannequins: readonly MapMannequin[];
  /** Pedido de prints no loading (`BenchConfig.prints`): compõe a fila (12 looks nos times A e B). */
  readonly prints: boolean;
  /** Skins que cabem na reserva (`reservedCount / FIGURE_SKIN_LAYERS`). */
  readonly capacity: number;
  /** Looks fora da cena compostos sob demanda pelo gancho dos prints (web; nunca no Switch). */
  readonly onDemand: boolean;
  /** Tabela já montada (testes reaproveitam); ausente = monta aqui (a etapa "figuras"). */
  readonly table?: FigureGameTable;
  /**
   * M2 (fase 6c): o Meu Bobo e o time do jogador 1 (−1 sem time). Entra logo depois do zumbi no plano: nunca fica sem
   * skin. Ausente = o jogador veste o 1º da rotação (o recruta), como até a fase 6b.
   */
  readonly player?: { readonly look: FigureLook; readonly team: number };
  /**
   * M2 (fase 6c): quantos looks da rotação dos bots entram (ausente = `figureBotLooks` do perfil). O Meu Bobo não tem
   * bots: 1, e as vagas ficam para as skins sob demanda do editor.
   */
  readonly botLooks?: number;
  /** Só testes: rotação no lugar de `FIGURE_BOT_ROTATION` (id e look), sem o corte do perfil. */
  readonly rotation?: readonly (readonly [id: string, look: FigureLook])[];
}

/** Gabarito e skin de um conjunto já resolvido. */
export interface FigureSlot {
  readonly figure: number;
  readonly skin: number;
  /** O conjunto efetivo (o padrão do time quando o pedido estourou). */
  readonly look: string;
  readonly team: number;
}

export interface SceneFigures {
  /** A tabela de jogo da partida: o MESMO objeto vai para `SimConfig.figureTable` e `Renderer.setFigures`. */
  readonly table: FigureGameTable;
  /** Gabaritos atuais (o gancho dos prints pode montar de novo com looks a mais). */
  readonly templates: FigureTemplateSet;
  readonly plan: FigureSkinPlan;
  readonly teamColors: readonly number[];
  /** Looks da rotação dos bots desta partida (`figureBotLooks` do perfil). */
  readonly botLooks: number;
  /** Gabarito e skin do bot com o preset p da rotação no time `team` (−1 = sem time). Sem alocação. */
  botFigure(p: number, team: number): number;
  botSkin(p: number, team: number): number;
  /** M2 (fase 6c): gabarito e skin do jogador 1 no time `team` (o Meu Bobo; noutro time, o 1º da rotação). */
  playerFigure(team: number): number;
  playerSkin(team: number): number;
  readonly zombieFigure: number;
  readonly zombieSkin: number;
  /** M3 (fase 5b): gabarito e skin do zumbi do tipo `type` (`ZOMBIE_TYPE`; sem as variantes, o comum). */
  zombieFigureOf(type: number): number;
  zombieSkinOf(type: number): number;
  /** Skins pintadas (`paintSkins`) e o cache delas; `null` antes da etapa "skins". */
  readonly cache: FigureSkinCache | null;
  /** 1ª camada da skin de cada conjunto de `plan.sets` (mesma ordem; vazio antes da etapa "skins"). */
  readonly setSkins: readonly number[];
  /** Etapa "skins": pinta os conjuntos do plano (`paintFigureSkin`) a partir de `firstLayer`. */
  paintSkins(write: (firstLayer: number, rgba: Uint8Array, level1: Uint8Array) => void, firstLayer: number): void;
  /**
   * Gabarito e skin de (look, time) no loading ou no gancho dos prints (aloca): o conjunto do plano; senão, com
   * `onDemand`, pinta agora (e acrescenta o gabarito do look); senão o padrão do próprio time. `templatesChanged` diz
   * se os gabaritos foram montados de novo (o chamador repassa ao render). `null` = sem skin nenhuma (antes das skins).
   */
  resolve(lookId: string, look: FigureLook, team: number): FigureSlot | null;
  /** Solta as skins pedidas sob demanda pelo gancho (a lista de manequins mudou). */
  releaseOnDemand(): void;
  /**
   * M2 (fase 6c): o look do id passa a ser `look` (o Meu Bobo sendo editado): o gabarito é refeito no mesmo índice e
   * as skins sob demanda desse id são soltas (a próxima `resolve` pinta de novo). Id sem gabarito ainda: só guarda.
   */
  restyle(lookId: string, look: FigureLook): void;
  /** Gabaritos mudaram desde a última leitura (o gancho dos prints acrescentou um look). */
  takeTemplatesChanged(): boolean;
  /** Fim da partida: solta o cache de skins e o pintor (regra 21); a tabela e os gabaritos saem com a partida. */
  dispose(): void;
}

/**
 * Etapa "figuras" do loading: tabela de jogo (uma vez), plano das skins e gabaritos dos looks da cena. As skins saem na
 * etapa seguinte (`paintSkins`).
 */
export function createSceneFigures(input: SceneFiguresInput): SceneFigures {
  const table = input.table ?? createFigureGameTable();
  const teamColors = figureTeamColors(input.teamCount);
  // Sem time (FFA, vitrine) e cada time da partida (no mínimo A e B: os coletes da vitrine).
  const teams = [-1, ...teamColors.map((_, t) => t)];

  const rotation: readonly (readonly [string, FigureLook])[] =
    input.rotation ??
    FIGURE_BOT_ROTATION.slice(
      0,
      Math.max(1, Math.min(FIGURE_BOT_ROTATION.length, input.botLooks ?? input.profile.figureBotLooks)),
    ).map((id) => [id, FIGURE_PRESETS[id]] as const);
  const botLooks = rotation.length;
  /** Look de cada id conhecido nesta partida (presets, padrão, rotação de teste e os montados pelo gancho). */
  const lookById = new Map<string, FigureLook>();
  for (const [id, look] of rotation) lookById.set(id, look);
  lookById.set(FIGURE_ZOMBIE_LOOK, FIGURE_PRESETS.zombie);
  // M3 (fase 5b): os especiais do Bobo Zombies (logo depois do comum na prioridade do plano).
  const zombieKinds = input.zombieKinds === true ? FIGURE_ZOMBIE_TYPE_LOOKS.slice(2) : [];
  for (const id of zombieKinds) lookById.set(id, FIGURE_PRESETS[id]);
  lookById.set(FIGURE_DEFAULT_LOOK, FIGURE_LOOK_DEFAULT);
  if (input.player) lookById.set(FIGURE_PLAYER_LOOK, normalizeFigureLook(input.player.look));

  // Pedido na ordem de prioridade: zumbi, rotação × times, manequins do mapa e a fila dos prints.
  const requested: FigureSkinSet[] = [
    { look: FIGURE_ZOMBIE_LOOK, team: -1 },
    ...zombieKinds.map((look) => ({ look, team: -1 })),
  ];
  if (input.player) requested.push({ look: FIGURE_PLAYER_LOOK, team: input.player.team });
  for (const [id] of rotation) for (const team of teams) requested.push({ look: id, team });
  for (const m of input.mannequins) {
    const id = m.zombie ? FIGURE_ZOMBIE_LOOK : bareLookId(m.look);
    const look = figureLookById(id);
    if (!look) continue;
    lookById.set(id, look);
    requested.push({ look: id, team: m.zombie ? -1 : m.team });
  }
  if (input.prints) {
    for (const id of [...FIGURE_BOT_ROTATION, FIGURE_DEFAULT_LOOK]) {
      lookById.set(id, figureLookById(id)!);
      for (const team of [0, 1]) requested.push({ look: id, team });
    }
  }
  const plan = planFigureSkins(requested, input.capacity);

  // Gabaritos: um por look dos conjuntos efetivos (o time só muda a skin).
  const templateLooks: FigureLook[] = [];
  const templateOf = new Map<string, number>();
  const addTemplate = (id: string): number => {
    const known = templateOf.get(id);
    if (known !== undefined) return known;
    const look = lookById.get(id);
    if (!look) throw new Error(`figuras: look sem dado: ${id}`);
    templateOf.set(id, templateLooks.length);
    templateLooks.push(look);
    return templateLooks.length - 1;
  };
  for (const s of plan.sets) addTemplate(s.look);
  let templates = createFigureTemplateSet(templateLooks);
  let templatesChanged = false;

  // Tabelas da partida por (preset da rotação, time): gabarito e skin (preenchidas no `paintSkins`).
  const botFigures = new Uint8Array(botLooks * FIGURE_TEAM_SLOTS);
  const botSkins = new Uint16Array(botLooks * FIGURE_TEAM_SLOTS);
  const playerFigures = new Uint8Array(FIGURE_TEAM_SLOTS);
  const playerSkins = new Uint16Array(FIGURE_TEAM_SLOTS);
  let zombieFigure = 0;
  let zombieSkin = 0;
  /** M3 (fase 5b): por `ZOMBIE_TYPE` (o comum onde não há variante). */
  const zombieFigures = new Uint8Array(FIGURE_ZOMBIE_TYPE_LOOKS.length);
  const zombieSkins = new Uint16Array(FIGURE_ZOMBIE_TYPE_LOOKS.length);
  let cache: FigureSkinCache | null = null;
  /** Skin (1ª camada) de cada conjunto pintado, pela chave `look|time`. */
  const skinOfSet = new Map<string, number>();
  const setSkins: number[] = [];
  /** Conjuntos pintados sob demanda pelo gancho (soltos no `releaseOnDemand`). */
  const onDemand = new Map<string, number>();
  let disposed = false;

  const slotOf = (team: number): number => (team >= 0 && team < FIGURE_TEAM_SLOTS - 1 ? team + 1 : 0);

  function recipe(look: FigureLook, team: number) {
    return { look, team, teamColors };
  }

  function planned(lookId: string, team: number): FigureSlot | null {
    const index = plan.redirect.get(figureSetKey(lookId, team));
    if (index === undefined) return null;
    const s = plan.sets[index]!;
    const skin = skinOfSet.get(figureSetKey(s.look, s.team));
    if (skin === undefined) return null;
    return { figure: templateOf.get(s.look)!, skin, look: s.look, team: s.team };
  }

  /**
   * Sem vaga: o padrão do próprio time. O `padrao|time` só entra no plano com estouro ou prints, então antes do zumbi
   * vem a 1ª aparência da rotação (o recruta), que está sempre no plano (ou redirecionada para o padrão do time).
   */
  function defaultOf(team: number): FigureSlot | null {
    const first = rotation[0]![0];
    return (
      planned(FIGURE_DEFAULT_LOOK, team) ??
      planned(first, team) ??
      planned(FIGURE_DEFAULT_LOOK, -1) ??
      planned(first, -1) ??
      planned(FIGURE_ZOMBIE_LOOK, -1)
    );
  }

  const api: SceneFigures = {
    table,
    get templates() {
      return templates;
    },
    plan,
    teamColors,
    botLooks,
    botFigure: (p, team) => botFigures[(p % botLooks) * FIGURE_TEAM_SLOTS + slotOf(team)]!,
    botSkin: (p, team) => botSkins[(p % botLooks) * FIGURE_TEAM_SLOTS + slotOf(team)]!,
    playerFigure: (team) => playerFigures[slotOf(team)]!,
    playerSkin: (team) => playerSkins[slotOf(team)]!,
    get zombieFigure() {
      return zombieFigure;
    },
    get zombieSkin() {
      return zombieSkin;
    },
    zombieFigureOf: (type) => zombieFigures[type] ?? zombieFigure,
    zombieSkinOf: (type) => zombieSkins[type] ?? zombieSkin,
    get cache() {
      return cache;
    },
    setSkins,
    paintSkins(write, firstLayer) {
      if (disposed) throw new Error('figuras: paintSkins depois do dispose');
      if (cache) return;
      cache = createFigureSkinCache({
        firstLayer,
        count: input.capacity * FIGURE_SKIN_LAYERS,
        paint: paintFigureSkin,
        release: disposeFigurePaint,
        write,
      });
      for (const s of plan.sets) {
        const skin = cache.acquire(recipe(lookById.get(s.look)!, s.team));
        skinOfSet.set(figureSetKey(s.look, s.team), skin);
        setSkins.push(skin);
      }
      for (let p = 0; p < botLooks; p++) {
        for (let slot = 0; slot < FIGURE_TEAM_SLOTS; slot++) {
          const team = slot - 1;
          // Time fora da partida (2 e 3 num TDM de 2): o look sem time, para nunca vestir o colete de outro time.
          const r = planned(rotation[p]![0], team) ?? planned(rotation[p]![0], -1) ?? defaultOf(team);
          botFigures[p * FIGURE_TEAM_SLOTS + slot] = r ? r.figure : 0;
          botSkins[p * FIGURE_TEAM_SLOTS + slot] = r ? r.skin : 0;
        }
      }
      // O jogador 1: o Meu Bobo no time dele; noutro time (não acontece numa partida normal), o do bot 0.
      for (let slot = 0; slot < FIGURE_TEAM_SLOTS; slot++) {
        const r = input.player ? planned(FIGURE_PLAYER_LOOK, slot - 1) : null;
        playerFigures[slot] = r ? r.figure : botFigures[slot]!;
        playerSkins[slot] = r ? r.skin : botSkins[slot]!;
      }
      const z = planned(FIGURE_ZOMBIE_LOOK, -1);
      zombieFigure = z ? z.figure : 0;
      zombieSkin = z ? z.skin : 0;
      FIGURE_ZOMBIE_TYPE_LOOKS.forEach((id, type) => {
        const r = zombieKinds.includes(id) ? planned(id, -1) : null;
        zombieFigures[type] = r ? r.figure : zombieFigure;
        zombieSkins[type] = r ? r.skin : zombieSkin;
      });
    },
    resolve(lookId, look, team) {
      if (!cache || disposed) return null;
      const known = planned(lookId, team);
      if (known) return known;
      const key = figureSetKey(lookId, team);
      const extra = onDemand.get(key);
      if (extra !== undefined) return { figure: templateOf.get(lookId)!, skin: extra, look: lookId, team };
      // Sob demanda só com vaga de verdade: os conjuntos do plano e os do gancho seguram uma skin cada.
      if (input.onDemand && plan.sets.length + onDemand.size < cache.slots) {
        lookById.set(lookId, normalizeFigureLook(look));
        const before = templateLooks.length;
        const figure = addTemplate(lookId);
        if (templateLooks.length !== before) {
          templates = createFigureTemplateSet(templateLooks);
          templatesChanged = true;
        }
        const skin = cache.acquire(recipe(lookById.get(lookId)!, team));
        onDemand.set(key, skin);
        return { figure, skin, look: lookId, team };
      }
      return defaultOf(team);
    },
    releaseOnDemand() {
      if (!cache) return;
      for (const skin of onDemand.values()) cache.release(skin);
      onDemand.clear();
    },
    restyle(lookId, look) {
      if (disposed) return;
      const clean = normalizeFigureLook(look);
      lookById.set(lookId, clean);
      const index = templateOf.get(lookId);
      if (index !== undefined) {
        templateLooks[index] = clean;
        templates = createFigureTemplateSet(templateLooks);
        templatesChanged = true;
      }
      if (!cache) return;
      for (const [key, skin] of onDemand) {
        if (!key.startsWith(`${lookId}|`)) continue;
        cache.release(skin);
        onDemand.delete(key);
      }
    },
    takeTemplatesChanged() {
      const changed = templatesChanged;
      templatesChanged = false;
      return changed;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cache?.dispose();
      cache = null;
      skinOfSet.clear();
      setSkins.length = 0;
      onDemand.clear();
    },
  };
  return api;
}
