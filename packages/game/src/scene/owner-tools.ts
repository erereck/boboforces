import { MODIFIERS, modifiersConflict, resolveBot, type MatchRecipe, type ModifierId } from '@boboforces/format';
import {
  ENTITY_KIND,
  isOwnerDormant,
  makeEntityId,
  MOD,
  ownerReserveSlots,
  type OwnerCommand,
  type OwnerEvent,
  type OwnerFail,
  type SimView,
} from '@boboforces/sim';
import {
  COLORS,
  drawText,
  measureText,
  pushRect,
  t,
  withAlpha,
  type ButtonNode,
  type DrawList,
  type MenuNavigation,
  type MsdfFont,
  type StringKey,
  type TextContent,
  type UiNode,
} from '@boboforces/ui';
import { BLOCK_FLAG, createRayHit, raycastGrid } from '@boboforces/world';
import { teamName } from '../team-names.ts';
import { aquariumSpeedText } from './aquarium.ts';
import { crosshairTarget } from './third-person.ts';

/**
 * M9 (fase 5): as Ferramentas do Dono no jogo (gameplay.md "Bobo Sandbox completo", estilo gmod; PLANO_M9 AH6 e
 * AH7). Só no Sandbox, só para quem manda na partida (offline, o P1 do sofá ou o host online):
 *
 * - **A página:** "Ferramentas do Dono", um botão compacto no canto de cima da pausa do P1 (no D-pad, para cima do
 *   Continuar; também no Aquário). Criar bot (◀ time ▶), Trocar de time (◀ time ▶), Dar arma (◀ primária ▶),
 *   Congelar / soltar e Tirar da partida lado a lado, os Modificadores (outra página: os 15 em 3 colunas, o ligado
 *   aceso) e a Câmera lenta (cada aperto: 1×, 0,5×, 0,25×; só offline e fora do Aquário assistindo, que tem a
 *   velocidade dele). Sem rolagem (o toque não rola listas): no máximo 5 linhas, com o Voltar compacto no canto.
 *   Esquerda e direita trocam o valor; confirmar ARMA a ferramenta e fecha a pausa.
 * - **A ferramenta armada:** uma faixa embaixo do meio diz qual é ("CRIAR BOT · LARANJA") e os botões do dispositivo
 *   ("Mouse esquerdo: aplicar · Mouse direito: cancelar"; no controle, os gatilhos; no toque, Tiro e Mira). Enquanto armada,
 *   o tiro aplica a ferramenta no que a câmera mira (o tiro e a mira do bobo ficam de fora) e ela continua armada até
 *   ser cancelada: a mira (ADS) cancela, e a pausa também (abre direto nesta página, com o foco na ferramenta).
 * - **O alvo:** o bobo sob a retícula pelo raio da câmera (`crosshairTarget`; na câmera livre do Aquário, do meio da
 *   tela); "criar bot" usa o ponto do chão onde o raio bate (a sim procura o nó livre mais perto, até 8 m).
 * - **A resposta:** o evento `owner` da sim vira um aviso curto ("Bot criado: Normal Bob", "Jorge congelado", ou o
 *   motivo da recusa em pt-BR). Com a partida pausada offline, o comando vale no primeiro passo depois de continuar.
 */

/** As ferramentas de mirar (a ordem da página). */
export const OWNER_TOOL = { spawn: 0, freeze: 1, team: 2, weapon: 3, remove: 4 } as const;
export type OwnerTool = (typeof OWNER_TOOL)[keyof typeof OWNER_TOOL];
/** Nenhuma ferramenta armada. */
export const OWNER_NO_TOOL = -1;

/** As velocidades da câmera lenta (a 1ª é a normal). */
export const OWNER_SLOW_SPEEDS = [1, 0.5, 0.25] as const;

/** As ações da página (`ButtonNode.action`). */
export const OWNER_ACTION = {
  spawn: 'own.spawn',
  freeze: 'own.freeze',
  team: 'own.team',
  weapon: 'own.weapon',
  remove: 'own.remove',
  mods: 'own.mods',
  slow: 'own.slow',
  back: 'own.back',
  /** `own.mod:<id>`: liga ou desliga o modificador. */
  modPrefix: 'own.mod:',
} as const;

/** Os ids dos itens de cada ferramenta (o foco volta para a última usada). */
const TOOL_IDS = ['own-spawn', 'own-freeze', 'own-team', 'own-weapon', 'own-remove'] as const;
const TOOL_KEYS: readonly StringKey[] = ['owner.spawn', 'owner.freeze', 'owner.team', 'owner.weapon', 'owner.remove'];
const TOOL_ACTIONS = [
  OWNER_ACTION.spawn,
  OWNER_ACTION.freeze,
  OWNER_ACTION.team,
  OWNER_ACTION.weapon,
  OWNER_ACTION.remove,
] as const;

/** Os modificadores da página: todos menos o Arcade (o perfil sai da receita; a sim recusa ao vivo). */
export const OWNER_LIVE_MODIFIERS: readonly ModifierId[] = MODIFIERS.filter((id) => id !== 'arcade');

export const OWNER_UI = {
  /** Alcance do raio da ferramenta (m). */
  aimRangeM: 120,
  /** "Criar bot": o ponto fica tanto antes da parede que o raio bateu, e procura o chão até tanto abaixo (m). */
  wallBackM: 0.3,
  groundDropM: 30,
  /** O aviso fica tanto tempo (s) e some no último. */
  noticeS: 2.5,
  noticeFadeS: 0.5,
  /**
   * As medidas das páginas (px de referência). Sem rolagem (o toque não rola uma lista): no celular os alvos de toque
   * crescem, então cada página tem no máximo 5 linhas de botões, e o Voltar fica no canto de cima (compacto).
   * A área do valor dos times cabe o nome mais largo que o Sandbox aceita (15 "M", como o `CUSTOM_NAME_VALUE_WIDTH`).
   */
  pageWidth: 900,
  rowGap: 12,
  valueWidth: 280,
  teamValueWidth: 420,
  /** Os modificadores em 3 colunas (5 linhas para os 15). */
  modColumns: 3,
  modWidth: 370,
} as const;

/** O que a página das ferramentas mostra (textos já resolvidos). */
export interface OwnerPageState {
  /** Os valores das linhas de opção: o time do "criar bot", o do "trocar de time" e a arma. */
  readonly spawnTeam: string;
  readonly team: string;
  readonly weapon: string;
  /** A câmera lenta ("0,5×"), ou `null` sem ela (online, Aquário assistindo, que tem a velocidade dele). */
  readonly slow: string | null;
  /** Bots fora de jogo (a reserva e os tirados): quantos o "criar bot" ainda pode trazer. */
  readonly reserve: number;
  /** O item com o foco inicial (o da última ferramenta). */
  readonly focus: string;
  readonly help: string;
}

/** O que a página dos modificadores mostra. */
export interface OwnerModsState {
  /** Ligado agora (ou pedido e ainda não aplicado), na ordem de `OWNER_LIVE_MODIFIERS`. */
  readonly on: readonly boolean[];
  readonly focus: string;
  readonly help: string;
}

/** Um botão da página (`extra`: o valor de uma linha de opção, a largura, o destaque de ligado). */
function ownerButton(
  id: string,
  text: TextContent,
  action: string,
  focus: string,
  extra: Partial<Omit<ButtonNode, 'kind' | 'id' | 'text' | 'action'>> = {},
): UiNode {
  return {
    kind: 'button',
    id,
    text,
    action,
    variant: 'secondary',
    ...extra,
    ...(id === focus ? { autofocus: true } : {}),
  } as UiNode;
}

function caption(id: string, text: TextContent, color: number): UiNode {
  return { kind: 'text', id, text, style: 'caption', color, textAlign: 'center' };
}

/** Uma linha com botões lado a lado (o D-pad anda nas duas direções). */
function buttonRow(id: string, children: readonly UiNode[]): UiNode {
  return { kind: 'row', id, gap: OWNER_UI.rowGap, children };
}

/**
 * A página (véu sobre a partida, como a pausa): o Voltar compacto no canto de cima (o toque também volta; no D-pad,
 * o voltar do controle), o título, a linha de baixo dele, as linhas de botões e a frase de ajuda.
 */
function ownerPage(
  title: StringKey,
  sub: TextContent | null,
  rows: readonly UiNode[],
  help: string,
  focus: string,
  width: number,
): UiNode {
  return {
    kind: 'box',
    id: 'root',
    color: COLORS.veu,
    children: [
      {
        ...ownerButton('own-back', { key: 'menu.back' }, OWNER_ACTION.back, focus, { compact: true }),
        anchor: 'topLeft',
      },
      {
        kind: 'column',
        id: 'main',
        anchor: 'center',
        align: 'stretch',
        width,
        gap: 10,
        children: [
          {
            kind: 'text',
            id: 'title',
            text: { key: title },
            style: 'heading',
            color: COLORS.texto,
            textAlign: 'center',
          },
          ...(sub !== null ? [caption('sub', sub, COLORS.textoBaixo)] : []),
          { kind: 'box', height: 4 },
          ...rows,
          { kind: 'box', height: 2 },
          caption('help', { literal: help }, COLORS.texto),
        ],
      },
    ],
  } as UiNode;
}

/**
 * A página das ferramentas: as 3 linhas de opção (criar bot e trocar de time com o time, dar arma com a arma;
 * esquerda e direita trocam o valor, confirmar arma), Congelar e Tirar lado a lado, e Modificadores com a Câmera lenta
 * (cada aperto passa para a próxima velocidade, como a do Aquário).
 */
export function ownerToolsScreen(s: OwnerPageState): UiNode {
  const f = s.focus;
  const U = OWNER_UI;
  const half = (U.pageWidth - U.rowGap) / 2;
  const team = (value: string): Partial<ButtonNode> => ({ value: { literal: value }, valueWidth: U.teamValueWidth });
  return ownerPage(
    'owner.title',
    { key: 'owner.reserve', params: { n: s.reserve } },
    [
      ownerButton('own-spawn', { key: 'owner.spawn' }, OWNER_ACTION.spawn, f, team(s.spawnTeam)),
      ownerButton('own-team', { key: 'owner.team' }, OWNER_ACTION.team, f, team(s.team)),
      ownerButton('own-weapon', { key: 'owner.weapon' }, OWNER_ACTION.weapon, f, {
        value: { literal: s.weapon },
        valueWidth: U.valueWidth,
      }),
      buttonRow('own-row-bot', [
        ownerButton('own-freeze', { key: 'owner.freeze' }, OWNER_ACTION.freeze, f, { width: half }),
        ownerButton('own-remove', { key: 'owner.remove' }, OWNER_ACTION.remove, f, { width: half }),
      ]),
      buttonRow('own-row-rules', [
        ownerButton('own-mods', { key: 'owner.mods' }, OWNER_ACTION.mods, f, {
          width: s.slow !== null ? half : U.pageWidth,
        }),
        ...(s.slow !== null
          ? [
              ownerButton('own-slow', { key: 'owner.slow', params: { speed: s.slow } }, OWNER_ACTION.slow, f, {
                width: half,
              }),
            ]
          : []),
      ]),
    ],
    s.help,
    f,
    U.pageWidth,
  );
}

/** A página dos modificadores: os 15 em 3 colunas, o ligado aceso (confirmar liga ou desliga na hora). */
export function ownerModsScreen(s: OwnerModsState): UiNode {
  const U = OWNER_UI;
  const rows: UiNode[] = [];
  for (let i = 0; i < OWNER_LIVE_MODIFIERS.length; i += U.modColumns) {
    const cells = OWNER_LIVE_MODIFIERS.slice(i, i + U.modColumns).map((id, k) =>
      ownerButton(`own-mod-${id}`, { key: `mod.${id}` as StringKey }, OWNER_ACTION.modPrefix + id, s.focus, {
        width: U.modWidth,
        compact: true,
        variant: s.on[i + k] ? 'primary' : 'secondary',
      }),
    );
    rows.push(buttonRow(`own-mods-${i / U.modColumns}`, cells));
  }
  const width = U.modColumns * U.modWidth + (U.modColumns - 1) * U.rowGap;
  return ownerPage('owner.mods.title', null, rows, s.help, s.focus, width);
}

/** A frase de ajuda do item com o foco na página das ferramentas (`''` = nenhuma). */
export function ownerHelp(focusedId: string | null): string {
  switch (focusedId) {
    case 'own-spawn':
      return t('owner.help.spawn');
    case 'own-freeze':
      return t('owner.help.freeze');
    case 'own-team':
      return t('owner.help.team');
    case 'own-weapon':
      return t('owner.help.weapon');
    case 'own-remove':
      return t('owner.help.remove');
    case 'own-mods':
      return t('owner.help.mods');
    case 'own-slow':
      return t('owner.help.slow');
    case 'own-back':
      return t('owner.help.back');
    default:
      return focusedId !== null && focusedId.startsWith('own-mod-') ? t('owner.help.mod') : '';
  }
}

/**
 * Os nomes dos bots da reserva do dono (`ownerReserveSlots`: o Normal Bob, nos controladores depois dos da receita),
 * como os da receita (`controllerNames`). O host e o amigo online fazem a mesma conta: os mesmos nomes e, pelo nome, o
 * mesmo look.
 */
export function addReserveNames(names: string[], recipe: MatchRecipe, humans: number, reserve: number): void {
  for (const slot of ownerReserveSlots(recipe, humans, reserve)) {
    if (slot.bot === null) continue;
    names[slot.controller] = t(`bot.name.${resolveBot(recipe, slot.bot).id}` as StringKey);
  }
}

/** O bobo está fora de jogo pelo dono (a reserva, ou tirado)? Sem as ferramentas, nunca. */
export function ownerHidden(v: SimView, i: number): boolean {
  return v.owner !== null && isOwnerDormant(v, i);
}

/** Quantos bobos estão fora de jogo pelo dono (o que o "criar bot" ainda pode trazer). */
export function ownerDormantCount(v: SimView): number {
  let n = 0;
  for (let i = 0; i < v.count; i++) if (v.alive[i] === 1 && v.kind[i] === ENTITY_KIND.bobo && ownerHidden(v, i)) n++;
  return n;
}

const rayHit = createRayHit();

/**
 * O ponto do chão para o "criar bot" (em `out`: x, y, z dos pés), pelo raio da câmera: onde ele bate no cenário (num
 * chão, ali mesmo; numa parede, um pouco antes dela e no chão embaixo). `false` = o raio foi para o céu ou o vazio.
 */
export function ownerGroundPoint(
  v: SimView,
  ox: number,
  oy: number,
  oz: number,
  yaw: number,
  pitch: number,
  out: Float64Array,
): boolean {
  const cp = Math.cos(pitch);
  const dx = -Math.sin(yaw) * cp;
  const dy = Math.sin(pitch);
  const dz = -Math.cos(yaw) * cp;
  const U = OWNER_UI;
  if (!raycastGrid(v.world, v.blocks, ox, oy, oz, dx, dy, dz, U.aimRangeM, BLOCK_FLAG.solid, rayHit, v.colliders)) {
    return false;
  }
  if (rayHit.normalY > 0.5) {
    out[0] = rayHit.x;
    out[1] = rayHit.y;
    out[2] = rayHit.z;
    return true;
  }
  const d = Math.max(0, rayHit.distance - U.wallBackM);
  const px = ox + dx * d;
  const py = oy + dy * d;
  const pz = oz + dz * d;
  if (!raycastGrid(v.world, v.blocks, px, py, pz, 0, -1, 0, U.groundDropM, BLOCK_FLAG.solid, rayHit, v.colliders)) {
    return false;
  }
  out[0] = px;
  out[1] = py - rayHit.distance;
  out[2] = pz;
  return true;
}

/** Um comando mandado esperando a resposta (o aviso diz o que foi feito). */
interface Sent {
  seq: number;
  tool: number;
  on: boolean;
  value: number;
}

const SENT_MAX = 32;

export interface OwnerToolsConfig {
  readonly recipe: MatchRecipe;
  /** Manda o comando (`SceneDriver.command`): o número dele, ou -1. */
  readonly command: (cmd: OwnerCommand) => number;
  readonly view: () => SimView;
  /** O nome de um bobo (índice) para o aviso. */
  readonly nameOf: (v: SimView, i: number) => string;
  /** As primárias do "dar arma" (códigos, na ordem do radial) e o nome de cada código. */
  readonly primaries: readonly number[];
  readonly weaponNames: readonly string[];
  /** A câmera lenta vale (offline, fora do Aquário assistindo). */
  readonly slowAllowed: boolean;
  readonly log: (line: string) => void;
  /**
   * M9 (fase 5, revisão): o log do replay da partida encheu (`OWNER_LOG_MAX` comandos): o driver recusa os comandos
   * novos, e o aviso diz isso (e não "comandos demais de uma vez").
   */
  readonly logFull?: () => boolean;
}

/** M9 (fase 5, revisão): as recusas que nascem na cena (antes da sim), com o texto `owner.fail.<motivo>`. */
export type OwnerLocalFail = 'aimBot' | 'aimGround' | 'busy' | 'full' | 'dead';

/** O que a página pediu (`OwnerTools.action`). */
export type OwnerPageResult = 'none' | 'rebuild' | 'resume' | 'back';

export interface OwnerTools {
  /** A ferramenta armada (`OWNER_TOOL`), ou `OWNER_NO_TOOL`. */
  readonly armed: number;
  /** A câmera lenta agora (1 = normal). */
  readonly slow: number;
  /** A página aberta: as ferramentas ou os modificadores. */
  readonly page: 'tools' | 'mods';
  /** O aviso agora (`''` = nenhum) e a opacidade dele. */
  readonly notice: string;
  readonly noticeAlpha: number;
  /** Abre a página das ferramentas (a pausa entra nela). */
  openTools(): void;
  /** Monta a página aberta; `focusedId` é o foco de agora (a frase de ajuda é dele). */
  build(focusedId: string | null): UiNode;
  /** Uma navegação da página aberta. */
  action(nav: MenuNavigation): OwnerPageResult;
  /**
   * O tiro com a ferramenta armada, pelo raio da câmera (origem, rumo e inclinação). `self` = o bobo de quem usa (-1
   * assistindo); `local(c)` = o controlador é de um jogador deste aparelho (não é alvo, mesmo pilotando um bot).
   */
  apply(
    v: SimView,
    ox: number,
    oy: number,
    oz: number,
    yaw: number,
    pitch: number,
    self: number,
    local: (controller: number) => boolean,
  ): void;
  /** Desarma (a mira, a pausa). */
  cancel(): void;
  /** M9 (fase 5, revisão): uma recusa da cena (o jogador fora de jogo, ...): só o aviso. */
  fail(reason: OwnerLocalFail): void;
  /** A resposta da sim a um comando (o evento `owner`, no host). */
  onEvent(ev: OwnerEvent, v: SimView): void;
  /**
   * M9 (fase 5, revisão): chegou resposta desde a última chamada (a página aberta refaz: no online a sim anda com a
   * pausa aberta, e um modificador recusado apaga).
   */
  takeChanged(): boolean;
  /** O relógio do aviso (s do render). */
  update(dt: number): void;
  /**
   * A faixa da ferramenta armada e o aviso, embaixo do meio da vista do P1 (`x`, `y`, `w`, `h` em px da superfície).
   * `hint` = os botões do dispositivo; `crosshair` = desenha uma cruz no meio (a câmera livre do Aquário não tem HUD);
   * `maxBottom` = a faixa termina acima disto (a do Aquário embaixo; `Infinity` = sem limite).
   */
  draw(
    out: DrawList,
    font: MsdfFont | null,
    x: number,
    y: number,
    w: number,
    h: number,
    minTextPx: number,
    hint: string,
    crosshair: boolean,
    maxBottom?: number,
  ): void;
}

export function createOwnerTools(cfg: OwnerToolsConfig): OwnerTools {
  /** O nome de cada time (o que o Sandbox deu, ou a cor: AH4), o mesmo do placar. */
  const teamNames = cfg.recipe.teams.map((_, i) => teamName(cfg.recipe, i));
  const teams = teamNames.length;
  let armed: number = OWNER_NO_TOOL;
  let page: 'tools' | 'mods' = 'tools';
  /** O time do "criar bot" e o do "trocar de time" (índices) e a arma (índice em `primaries`). */
  let spawnTeam = 0;
  let toTeam = Math.min(1, teams - 1);
  let weapon = 0;
  let slowIndex = 0;
  /** O último item usado na página (o foco volta para ele). */
  let lastTool = 'own-spawn';
  let lastMod = `own-mod-${OWNER_LIVE_MODIFIERS[0]!}`;
  let notice = '';
  let noticeS = 0;
  let noticeFail = false;
  /** Os modificadores pedidos e ainda sem resposta: a página mostra o pedido (offline, a sim está pausada). */
  let modsPending = 0;
  let modsWant = 0;
  const sent: Sent[] = Array.from({ length: SENT_MAX }, () => ({ seq: 0, tool: -1, on: false, value: 0 }));
  let sentNext = 0;
  const point = new Float64Array(3);
  // A faixa (refeita só quando a ferramenta ou o valor mudam: comparando os números, sem montar texto por quadro).
  let label = '';
  let labelTool = OWNER_NO_TOOL;
  let labelValue = -1;
  /** Chegou resposta desde o último `takeChanged`. */
  let changed = false;

  const say = (text: string, fail: boolean): void => {
    notice = text;
    noticeS = OWNER_UI.noticeS;
    noticeFail = fail;
  };
  const failText = (reason: OwnerFail | OwnerLocalFail): string => t(`owner.fail.${reason}` as StringKey);

  /** A máscara ativa dos modificadores (0 sem o estado deles). */
  const liveMask = (): number => cfg.view().chaos?.masks[0] ?? 0;
  const shownMask = (): number => (modsPending > 0 ? modsWant : liveMask());

  function send(cmd: OwnerCommand, tool: number, on: boolean, value: number): boolean {
    const seq = cfg.command(cmd);
    if (seq < 0) {
      say(failText(cfg.logFull?.() === true ? 'full' : 'busy'), true);
      return false;
    }
    const s = sent[sentNext]!;
    sentNext = (sentNext + 1) % SENT_MAX;
    s.seq = seq;
    s.tool = tool;
    s.on = on;
    s.value = value;
    return true;
  }

  function toggleMod(i: number): void {
    const id = OWNER_LIVE_MODIFIERS[i];
    if (id === undefined) return;
    const bit = MOD[id];
    const mask = shownMask();
    const on = (mask & bit) === 0;
    let want = on ? mask | bit : mask & ~bit;
    // Ligar desliga o par que conflita (o que a sim vai fazer): a página já mostra assim.
    if (on) for (const other of MODIFIERS) if (other !== id && modifiersConflict(id, other)) want &= ~MOD[other];
    if (!send({ kind: 'setModifier', modifier: id, on }, -2, on, i)) return;
    modsWant = want;
    modsPending++;
    cfg.log(`[partida] dono: ${on ? 'liga' : 'desliga'} ${id}`);
  }

  function arm(tool: number): void {
    armed = tool;
    lastTool = TOOL_IDS[tool] ?? lastTool;
    cfg.log(`[partida] dono: armou ${TOOL_ACTIONS[tool] ?? '?'}`);
  }

  /** O índice do valor da ferramenta (o time, a arma; -1 sem valor): o que a faixa compara. */
  function valueIndex(tool: number): number {
    if (tool === OWNER_TOOL.spawn) return spawnTeam;
    if (tool === OWNER_TOOL.team) return toTeam;
    if (tool === OWNER_TOOL.weapon) return weapon;
    return -1;
  }

  function valueOf(tool: number): string {
    if (tool === OWNER_TOOL.spawn) return teamNames[spawnTeam]!;
    if (tool === OWNER_TOOL.team) return teamNames[toTeam]!;
    if (tool === OWNER_TOOL.weapon) return cfg.weaponNames[cfg.primaries[weapon]!] ?? '';
    return '';
  }

  const cycle = (i: number, n: number, d: number): number => (((i + (d === 0 ? 1 : d)) % n) + n) % n;

  return {
    get armed(): number {
      return armed;
    },
    get slow(): number {
      return cfg.slowAllowed ? OWNER_SLOW_SPEEDS[slowIndex]! : 1;
    },
    get page() {
      return page;
    },
    get notice(): string {
      return noticeS > 0 ? notice : '';
    },
    get noticeAlpha(): number {
      return Math.min(1, noticeS / OWNER_UI.noticeFadeS);
    },
    openTools(): void {
      page = 'tools';
    },
    build(focusedId) {
      if (page === 'mods') {
        const mask = shownMask();
        return ownerModsScreen({
          on: OWNER_LIVE_MODIFIERS.map((id) => (mask & MOD[id]) !== 0),
          focus: lastMod,
          help: ownerHelp(focusedId ?? lastMod),
        });
      }
      return ownerToolsScreen({
        spawnTeam: teamNames[spawnTeam]!,
        team: teamNames[toTeam]!,
        weapon: cfg.weaponNames[cfg.primaries[weapon]!] ?? '',
        slow: cfg.slowAllowed ? aquariumSpeedText(OWNER_SLOW_SPEEDS[slowIndex]!) : null,
        reserve: ownerDormantCount(cfg.view()),
        focus: lastTool,
        help: ownerHelp(focusedId ?? lastTool),
      });
    },
    action(nav) {
      const a = nav.activated;
      if (page === 'mods') {
        if (nav.back || a === OWNER_ACTION.back) {
          page = 'tools';
          return 'rebuild';
        }
        if (a !== null && a.startsWith(OWNER_ACTION.modPrefix)) {
          const id = a.slice(OWNER_ACTION.modPrefix.length) as ModifierId;
          lastMod = `own-mod-${id}`;
          toggleMod(OWNER_LIVE_MODIFIERS.indexOf(id));
          return 'rebuild';
        }
        return 'none';
      }
      if (nav.back || a === OWNER_ACTION.back) return 'back';
      if (a === null) return 'none';
      const d = nav.delta;
      if (a === OWNER_ACTION.mods) {
        page = 'mods';
        lastTool = 'own-mods';
        return 'rebuild';
      }
      if (a === OWNER_ACTION.slow) {
        lastTool = 'own-slow';
        slowIndex = cycle(slowIndex, OWNER_SLOW_SPEEDS.length, d);
        cfg.log(`[partida] dono: câmera lenta ${aquariumSpeedText(OWNER_SLOW_SPEEDS[slowIndex]!)}`);
        return 'rebuild';
      }
      // Nas linhas de opção, esquerda e direita trocam o valor (a página fica); confirmar arma.
      if (d !== 0) {
        if (a === OWNER_ACTION.spawn) {
          spawnTeam = cycle(spawnTeam, teams, d);
          lastTool = 'own-spawn';
        } else if (a === OWNER_ACTION.team) {
          toTeam = cycle(toTeam, teams, d);
          lastTool = 'own-team';
        } else if (a === OWNER_ACTION.weapon) {
          weapon = cycle(weapon, cfg.primaries.length, d);
          lastTool = 'own-weapon';
        }
        return 'rebuild';
      }
      const tool = (TOOL_ACTIONS as readonly string[]).indexOf(a);
      if (tool < 0) return 'none';
      arm(tool);
      return 'resume';
    },
    apply(v, ox, oy, oz, yaw, pitch, self, local) {
      const tool = armed;
      if (tool === OWNER_NO_TOOL) return;
      if (tool === OWNER_TOOL.spawn) {
        if (!ownerGroundPoint(v, ox, oy, oz, yaw, pitch, point)) {
          say(failText('aimGround'), true);
          return;
        }
        // Virado para quem criou.
        const face = Math.atan2(-(ox - point[0]!), -(oz - point[2]!));
        const cmd: OwnerCommand = {
          kind: 'spawnBot',
          team: spawnTeam,
          x: point[0]!,
          y: point[1]!,
          z: point[2]!,
          yaw: face,
        };
        if (send(cmd, tool, true, spawnTeam)) cfg.log(`[partida] dono: criar bot no time ${spawnTeam}`);
        return;
      }
      const j = crosshairTarget(v, self, ox, oy, oz, ox, oy, oz, yaw, pitch, OWNER_UI.aimRangeM);
      if (j < 0 || v.kind[j] !== ENTITY_KIND.bobo) {
        say(failText('aimBot'), true);
        return;
      }
      // Um jogador deste aparelho (o sofá, o Aquário pilotando) não é alvo, mesmo no lugar de um bot.
      if (local(v.controller[j]!)) {
        say(failText('human'), true);
        return;
      }
      const entity = makeEntityId(j, v.generation[j]!);
      let cmd: OwnerCommand;
      let on = true;
      let value = 0;
      if (tool === OWNER_TOOL.freeze) {
        on = v.owner?.frozen[j] !== 1;
        cmd = { kind: 'freeze', entity, on };
      } else if (tool === OWNER_TOOL.team) {
        value = toTeam;
        cmd = { kind: 'setTeam', entity, team: toTeam };
      } else if (tool === OWNER_TOOL.weapon) {
        value = cfg.primaries[weapon]!;
        cmd = { kind: 'giveWeapon', entity, weapon: value };
      } else cmd = { kind: 'remove', entity };
      if (send(cmd, tool, on, value)) cfg.log(`[partida] dono: ${cmd.kind} em ${cfg.nameOf(v, j)}`);
    },
    cancel(): void {
      if (armed === OWNER_NO_TOOL) return;
      armed = OWNER_NO_TOOL;
      cfg.log('[partida] dono: desarmou');
    },
    fail(reason) {
      say(failText(reason), true);
    },
    takeChanged(): boolean {
      const was = changed;
      changed = false;
      return was;
    },
    onEvent(ev, v) {
      let s: Sent | null = null;
      for (let k = 0; k < SENT_MAX; k++) if (sent[k]!.seq === ev.seq) s = sent[k]!;
      if (s === null) return;
      s.seq = 0;
      changed = true;
      cfg.log(`[partida] dono: ${ev.command} ${ev.ok ? 'ok' : ev.reason}`);
      if (ev.command === 'setModifier') {
        modsPending = Math.max(0, modsPending - 1);
        const id = OWNER_LIVE_MODIFIERS[s.value] ?? 'mini';
        const mod = t(`mod.${id}` as StringKey);
        say(ev.ok ? t(s.on ? 'owner.done.modOn' : 'owner.done.modOff', { mod }) : failText(ev.reason), !ev.ok);
        return;
      }
      if (!ev.ok) {
        say(failText(ev.reason), true);
        return;
      }
      const i = ev.entity & 0xffff;
      const name = i < v.count ? cfg.nameOf(v, i) : '';
      switch (ev.command) {
        case 'spawnBot':
          say(t('owner.done.spawnBot', { name }), false);
          break;
        case 'freeze':
          say(t(s.on ? 'owner.done.freezeOn' : 'owner.done.freezeOff', { name }), false);
          break;
        case 'setTeam':
          say(t('owner.done.setTeam', { name, team: teamNames[s.value] ?? '' }), false);
          break;
        case 'giveWeapon':
          say(t('owner.done.giveWeapon', { name, weapon: cfg.weaponNames[s.value] ?? '' }), false);
          break;
        case 'remove':
          say(t('owner.done.remove', { name }), false);
          break;
        default:
          break;
      }
    },
    update(dt) {
      if (noticeS > 0) noticeS = Math.max(0, noticeS - dt);
    },
    draw(out, font, x, y, w, h, minTextPx, hint, crosshair, maxBottom = Number.POSITIVE_INFINITY) {
      if (font === null) return;
      const scale = Math.min(w / 640, h / 360);
      const cx = x + w / 2;
      if (crosshair && armed !== OWNER_NO_TOOL) {
        const arm = Math.max(4, Math.round(6 * scale));
        const thick = Math.max(2, Math.round(2 * scale));
        pushRect(out, Math.round(cx - arm), Math.round(y + h / 2 - thick / 2), arm * 2, thick, COLORS.acao);
        pushRect(out, Math.round(cx - thick / 2), Math.round(y + h / 2 - arm), thick, arm * 2, COLORS.acao);
      }
      const px = Math.max(Math.round(14 * scale), minTextPx);
      const hintPx = Math.max(Math.round(11 * scale), minTextPx);
      const pad = Math.round(px * 0.5);
      const h1 = Math.round(px * 1.7);
      const h2 = hint === '' ? 0 : Math.round(hintPx * 1.7);
      let top = Math.round(y + h * 0.76);
      // M9 (fase 5, revisão): acima da faixa do Aquário (ela fica embaixo, no meio).
      const height = armed !== OWNER_NO_TOOL ? h1 + h2 : h1;
      if (top + height > maxBottom) top = Math.round(maxBottom - height - Math.max(2, 4 * scale));
      if (armed !== OWNER_NO_TOOL) {
        const vi = valueIndex(armed);
        if (armed !== labelTool || vi !== labelValue) {
          labelTool = armed;
          labelValue = vi;
          const tool = t(TOOL_KEYS[armed]!);
          const value = valueOf(armed);
          label = (value === '' ? tool : t('owner.armed', { tool, value })).toUpperCase();
        }
        const w1 = measureText(font, label, px, 0.06) + pad * 2;
        const x1 = Math.round(cx - w1 / 2);
        pushRect(out, x1, top, w1, h1, withAlpha(COLORS.bunker, 0.85));
        pushRect(out, x1, top, w1, Math.max(2, Math.round(2 * scale)), COLORS.acao);
        drawText(out, font, label, x1 + pad, top + px * 0.42, px, COLORS.acao, 0.06);
        if (hint !== '') {
          const w2 = measureText(font, hint, hintPx, 0.02) + pad * 2;
          const x2 = Math.round(cx - w2 / 2);
          pushRect(out, x2, top + h1, w2, h2, withAlpha(COLORS.bunker, 0.7));
          drawText(out, font, hint, x2 + pad, top + h1 + hintPx * 0.42, hintPx, COLORS.textoBaixo, 0.02);
        }
      }
      if (noticeS <= 0 || notice === '') return;
      const a = Math.min(1, noticeS / OWNER_UI.noticeFadeS);
      const w3 = measureText(font, notice, px, 0.02) + pad * 2;
      const h3 = h1;
      // Com a faixa, o aviso vai em cima dela.
      if (armed !== OWNER_NO_TOOL) top -= h3 + Math.round(4 * scale);
      const x3 = Math.round(cx - w3 / 2);
      pushRect(out, x3, top, w3, h3, withAlpha(COLORS.bunker, 0.85 * a));
      pushRect(
        out,
        x3,
        top,
        Math.max(2, Math.round(3 * scale)),
        h3,
        withAlpha(noticeFail ? COLORS.perigo : COLORS.acao, a),
      );
      drawText(out, font, notice, x3 + pad, top + px * 0.42, px, withAlpha(COLORS.texto, a), 0.02);
    },
  };
}
