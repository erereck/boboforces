import { MODIFIERS, modifiersConflict, type MatchRecipe, type ModifierId } from '@boboforces/format';
import type { NavGrid } from '@boboforces/nav';
import { createRng } from '@boboforces/shared';
import {
  ENTITY_FLAG,
  ENTITY_KIND,
  isOwnerDormant,
  makeEntityId,
  METRICS,
  MOD,
  navMainComponent,
  OWNER,
  ownerReserveSlots,
  ownerSpotNode,
  ownerSpotTaken,
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
  rgba,
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
import { rollBotName } from '../bot-names.ts';
import { teamName } from '../team-names.ts';
import { aquariumSpeedText } from './aquarium.ts';
import { projectToView, type ProjectCamera, type ProjectRect } from './markers.ts';
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
 *   M9 (fase 5b, prints): a cena escolhe antes o nó (`ownerSpawnSpot`): o livre mais perto do ponto mirado, até 4 m,
 *   que a câmera VÊ (sem isso, mirando no pé de uma parede ou no alto de um muro, a sim às vezes punha o bot do outro
 *   lado, fora da vista), e manda o centro dele: o mesmo nó sai primeiro na conta da sim (`ownerSpotNodes`). Nenhum à
 *   vista: volta pelo raio, 1 m de cada vez, para o lado da câmera; nada até 4 m: a recusa da sim ("Sem lugar livre
 *   perto da mira"), sem mandar o comando.
 * - **A resposta:** o evento `owner` da sim vira um aviso curto ("Bot criado: Sergeant Noodle", "Jorge congelado", ou
 *   o motivo da recusa em pt-BR). Com a partida pausada offline, o comando vale no primeiro passo depois de continuar.
 * - **Os congelados** (fase 5b): uma plaquinha "CONGELADO" em cima da cabeça de cada um (`drawFrozenMarks`), em toda
 *   vista (o congelado vai no snapshot: o amigo online também vê), porque o aviso some e o bot parado não diz nada.
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
  /**
   * "Criar bot": o ponto fica tanto antes da parede que o raio bateu (pelo raio, para o lado da câmera), e procura o
   * chão até tanto abaixo (m). Fase 5b: 0,6 m (antes 0,3: o pé da parede caía no meio do nó colado nela).
   */
  wallBackM: 0.6,
  groundDropM: 30,
  /**
   * Fase 5b (prints): o lugar do bot é o nó livre mais perto do ponto mirado, até `spotMaxM` (a sim vai até 8 m), que a
   * câmera vê: o raio da câmera chega sem bater ao peito (`spotChestM` acima dos pés) ou à altura dos olhos de quem
   * nasce ali. Revisão: guarda os `spotPerRound` nós mais perto de cada volta e testa a vista de no máximo
   * `spotSightMax` nós por clique (cada um com até 2 raios).
   */
  spotMaxM: 4,
  spotPerRound: 12,
  spotSightMax: 16,
  spotChestM: 1.1,
  /**
   * Sem nó à vista: volta tanto pelo raio (m), até tantas vezes (o alto de um muro, um telhado fora do alcance); a volta
   * cujo ponto do chão fica a menos de `spotRoundMinM` do da anterior não conta.
   */
  spotBackM: 1,
  spotBacks: 4,
  spotRoundMinM: 0.5,
  /** Revisão: a câmera dentro de um bloco: os raios saem do 1º ponto livre pela mira, de tanto em tanto, até tanto (m). */
  insideStepM: 0.25,
  insideMaxM: 3,
  /**
   * Fase 5b: a plaquinha dos congelados fica acima da cabeça (m acima dos pés, ×tamanho), some além de tanto (m), e no
   * máximo tantas por vista (as mais perto).
   */
  frozenHeightM: 2.35,
  frozenMaxM: 40,
  frozenMaxMarks: 12,
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
 * Os nomes dos bots da reserva do dono (`ownerReserveSlots`: o Normal Bob, nos controladores depois dos da receita).
 * M9 (fase 5b, prints): cada um com um nome bobo diferente (o gerador do "Rolar nome" da Oficina), porque 8 "Normal
 * Bob" deixavam o aviso ("Normal Bob congelado") sem dizer qual. O sorteio sai da semente da receita e da ordem da
 * reserva, longe dos nomes que já estão em `names` antes da reserva: os humanos (revisão: no online, os da sala, os
 * mesmos nos dois lados; offline, os do aparelho) e os bots da receita. O host e o amigo online fazem a mesma conta:
 * os mesmos nomes e, pelo nome (`botLookIndices`), o mesmo look.
 */
export function addReserveNames(names: string[], recipe: MatchRecipe, humans: number, reserve: number): void {
  const slots = ownerReserveSlots(recipe, humans, reserve);
  if (slots.length === 0) return;
  const taken = new Set<string>();
  for (let c = 0; c < slots[0]!.controller; c++) {
    const name = names[c];
    if (name !== undefined) taken.add(name);
  }
  const rng = createRng(recipe.seed).fork('owner-reserve-names');
  for (const slot of slots) {
    const name = rollBotName(rng, taken);
    taken.add(name);
    names[slot.controller] = name;
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
/** A distância (m) até onde o raio do último `ownerGroundPoint` bateu (o `ownerSpawnSpot` lê). */
let aimM = 0;

/**
 * O ponto do chão para o "criar bot" (em `out`: x, y, z dos pés), pelo raio da câmera: onde ele bate no cenário (num
 * chão, ali mesmo; numa parede, `wallBackM` antes dela pelo raio, do lado da câmera, e no chão embaixo). `false` = o
 * raio foi para o céu ou o vazio (ou sai de dentro de um bloco: ver `ownerRayOrigin`). Fase 5b: `back` (m) volta mais
 * tanto pelo raio, para o lado da câmera, e cai no chão embaixo (vindo de um chão também): as outras tentativas do
 * `ownerSpawnSpot`.
 */
export function ownerGroundPoint(
  v: SimView,
  ox: number,
  oy: number,
  oz: number,
  yaw: number,
  pitch: number,
  out: Float64Array,
  back = 0,
): boolean {
  const cp = Math.cos(pitch);
  const dx = -Math.sin(yaw) * cp;
  const dy = Math.sin(pitch);
  const dz = -Math.cos(yaw) * cp;
  const U = OWNER_UI;
  if (!raycastGrid(v.world, v.blocks, ox, oy, oz, dx, dy, dz, U.aimRangeM, BLOCK_FLAG.solid, rayHit, v.colliders)) {
    return false;
  }
  // Revisão: a origem dentro de um bloco (o raio bate a 0 m, sem normal) não acha chão.
  if (rayHit.distance <= 0) return false;
  aimM = rayHit.distance;
  if (back <= 0 && rayHit.normalY > 0.5) {
    out[0] = rayHit.x;
    out[1] = rayHit.y;
    out[2] = rayHit.z;
    return true;
  }
  const d = Math.max(0, rayHit.distance - U.wallBackM - back);
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

/**
 * M9 (fase 5b, revisão): de onde saem os raios do "criar bot" (em `out`). A câmera livre do Aquário atravessa tudo e,
 * dentro de um bloco, a face de dentro não é desenhada (a tela mostra o que está além): os raios saem do primeiro ponto
 * livre pela mira, de `insideStepM` em `insideStepM`, até `insideMaxM`. `false` = ainda dentro (a recusa "Mire no
 * chão"); fora de um bloco, a própria câmera.
 */
export function ownerRayOrigin(
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
  for (let k = 0; k * U.insideStepM <= U.insideMaxM; k++) {
    const t = k * U.insideStepM;
    const x = ox + dx * t;
    const y = oy + dy * t;
    const z = oz + dz * t;
    // Dentro de um bloco, o raio bate a 0 m (as props não contam: o raio sai de dentro delas).
    const inside =
      raycastGrid(v.world, v.blocks, x, y, z, dx, dy, dz, 1e-3, BLOCK_FLAG.solid, rayHit, v.colliders) &&
      rayHit.distance <= 0;
    if (!inside) {
      out[0] = x;
      out[1] = y;
      out[2] = z;
      return true;
    }
  }
  return false;
}

/**
 * O ponto `(tx, ty, tz)` aparece da câmera em `(ox, oy, oz)`? (O raio até ele não bate em nada que tapa a visão: os
 * blocos `blocksSight` e as props.)
 */
export function ownerSees(v: SimView, ox: number, oy: number, oz: number, tx: number, ty: number, tz: number): boolean {
  const dx = tx - ox;
  const dy = ty - oy;
  const dz = tz - oz;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (d < 1e-3) return true;
  return !raycastGrid(
    v.world,
    v.blocks,
    ox,
    oy,
    oz,
    dx / d,
    dy / d,
    dz / d,
    d,
    BLOCK_FLAG.blocksSight,
    rayHit,
    v.colliders,
  );
}

/** Um lugar já mandado num `spawnBot` que a sim ainda não respondeu está em cima de (x, y, z)? (A regra da sim.) */
function pendingAt(pending: Float64Array | null, count: number, x: number, y: number, z: number): boolean {
  if (pending === null) return false;
  const clear2 = OWNER.placeClearM * OWNER.placeClearM;
  for (let k = 0; k < count; k++) {
    const dx = pending[k * 3]! - x;
    const dz = pending[k * 3 + 2]! - z;
    if (dx * dx + dz * dz < clear2 && Math.abs(pending[k * 3 + 1]! - y) < METRICS.bodyHeight) return true;
  }
  return false;
}

/** Rascunho do `ownerSpawnSpot`: os pontos do chão de cada volta, os candidatos de cada uma e os nós já testados. */
const SPOT_ROUNDS = OWNER_UI.spotBacks + 1;
const roundGround = new Float64Array(SPOT_ROUNDS * 3);
const roundNodes = new Int32Array(SPOT_ROUNDS * OWNER_UI.spotPerRound);
const roundD2 = new Float64Array(SPOT_ROUNDS * OWNER_UI.spotPerRound);
const roundCount = new Int32Array(SPOT_ROUNDS);
const spotTested = new Int32Array(SPOT_ROUNDS * OWNER_UI.spotPerRound);
const spotEye = new Float64Array(3);
const spotGround = new Float64Array(3);
const spotAt = new Float64Array(3);

/** Guarda `spotGround` como o ponto da volta `r`; devolve quantas voltas há. */
function addRound(r: number): number {
  roundGround[r * 3] = spotGround[0]!;
  roundGround[r * 3 + 1] = spotGround[1]!;
  roundGround[r * 3 + 2] = spotGround[2]!;
  return r + 1;
}

/** O motivo de um `ownerSpawnSpot` recusado: o raio não achou chão, ou nenhum nó livre à vista perto do ponto. */
export type OwnerSpotFail = 'aimGround' | 'place';

/**
 * M9 (fase 5b, prints): o lugar do "criar bot" (em `out`: x, y, z dos pés), pelo raio da câmera. O ponto do chão
 * (`ownerGroundPoint`) e, com navegação, o nó em pé mais perto dele (até `spotMaxM`, com o filtro da sim:
 * `ownerSpotNode` com o componente principal `main` e a área jogável) que está livre (`ownerSpotTaken`, e fora dos
 * lugares já mandados e sem resposta: `pending`, `pendingCount` trios x, y, z) e que a câmera vê, no peito ou nos olhos
 * de quem nasce ali (`ownerSees`). Nenhum (o alto de um muro, um telhado fora do alcance, fora da área): as voltas pelo
 * raio, `spotBackM` de cada vez para o lado da câmera, caindo no chão embaixo (até `spotBacks`, sem passar da câmera).
 * O centro do nó vai no comando, então a sim põe o bot nele (o nó a distância 0 é o primeiro dela). Sem navegação
 * (testes), o ponto do chão. `null` = achou; senão o motivo.
 *
 * Revisão (o custo de um clique recusado, no Switch sem JIT): os pontos de todas as voltas primeiro (uma volta a menos
 * de `spotRoundMinM` da anterior não conta: da câmera de cima, voltar 1 m anda poucos cm no chão), depois UMA passada
 * pelos nós guarda os `spotPerRound` mais perto de cada volta, e no máximo `spotSightMax` nós ganham o teste de vista
 * (cada um uma vez). Os raios saem de fora do bloco quando a câmera está dentro de um (`ownerRayOrigin`).
 */
export function ownerSpawnSpot(
  v: SimView,
  main: number,
  ox: number,
  oy: number,
  oz: number,
  yaw: number,
  pitch: number,
  out: Float64Array,
  pending: Float64Array | null = null,
  pendingCount = 0,
): OwnerSpotFail | null {
  if (!ownerRayOrigin(v, ox, oy, oz, yaw, pitch, spotEye)) return 'aimGround';
  const ex = spotEye[0]!;
  const ey = spotEye[1]!;
  const ez = spotEye[2]!;
  if (!ownerGroundPoint(v, ex, ey, ez, yaw, pitch, spotGround)) return 'aimGround';
  const nav = v.nav;
  if (nav === null) {
    out[0] = spotGround[0]!;
    out[1] = spotGround[1]!;
    out[2] = spotGround[2]!;
    return null;
  }
  const U = OWNER_UI;
  // Os pontos do chão das voltas (a 1ª é o da mira). As voltas não passam da câmera (`aimM`: até onde o raio bateu).
  let rounds = addRound(0);
  const reach = aimM - U.wallBackM;
  const min2 = U.spotRoundMinM * U.spotRoundMinM;
  for (let k = 1; k <= U.spotBacks; k++) {
    const back = k * U.spotBackM;
    if (back > reach || !ownerGroundPoint(v, ex, ey, ez, yaw, pitch, spotGround, back)) break;
    const o = (rounds - 1) * 3;
    const ddx = spotGround[0]! - roundGround[o]!;
    const ddy = spotGround[1]! - roundGround[o + 1]!;
    const ddz = spotGround[2]! - roundGround[o + 2]!;
    if (ddx * ddx + ddy * ddy + ddz * ddz >= min2) rounds = addRound(rounds);
  }
  // Uma passada pelos nós: os mais perto de cada volta, em ordem (empate: o de índice menor), até `spotMaxM`.
  const per = U.spotPerRound;
  const max2 = U.spotMaxM * U.spotMaxM;
  roundCount.fill(0);
  for (let node = 0; node < nav.nodeCount; node++) {
    if (!ownerSpotNode(nav, main, v.playArea, node, spotAt)) continue;
    for (let r = 0; r < rounds; r++) {
      const o = r * 3;
      const d =
        (spotAt[0]! - roundGround[o]!) ** 2 +
        (spotAt[1]! - roundGround[o + 1]!) ** 2 +
        (spotAt[2]! - roundGround[o + 2]!) ** 2;
      const n = roundCount[r]!;
      const base = r * per;
      if (d > max2 || (n === per && d >= roundD2[base + per - 1]!)) continue;
      let k = n < per ? n : per - 1;
      if (n < per) roundCount[r] = n + 1;
      while (k > 0 && roundD2[base + k - 1]! > d) {
        roundD2[base + k] = roundD2[base + k - 1]!;
        roundNodes[base + k] = roundNodes[base + k - 1]!;
        k--;
      }
      roundD2[base + k] = d;
      roundNodes[base + k] = node;
    }
  }
  // As voltas em ordem: o 1º nó livre e à vista (cada nó testado uma vez; a vista, no máximo `spotSightMax` nós).
  let tested = 0;
  let sights = 0;
  for (let r = 0; r < rounds; r++) {
    for (let k = 0; k < roundCount[r]!; k++) {
      const node = roundNodes[r * per + k]!;
      let seen = false;
      for (let q = 0; q < tested && !seen; q++) seen = spotTested[q] === node;
      if (seen) continue;
      spotTested[tested++] = node;
      nav.nodePosition(node, spotAt, 0);
      const x = spotAt[0]!;
      const y = spotAt[1]!;
      const z = spotAt[2]!;
      if (ownerSpotTaken(v, x, y, z) || pendingAt(pending, pendingCount, x, y, z)) continue;
      if (sights >= U.spotSightMax) return 'place';
      sights++;
      if (!ownerSees(v, ex, ey, ez, x, y + U.spotChestM, z) && !ownerSees(v, ex, ey, ez, x, y + METRICS.eyeHeight, z)) {
        continue;
      }
      out[0] = x;
      out[1] = y;
      out[2] = z;
      return null;
    }
  }
  return 'place';
}

/** O componente principal da navegação (`navMainComponent`), feito uma vez por grade (a conta passa por todos os nós). */
function createMainComponentCache(): (nav: NavGrid | null) => number {
  let last: NavGrid | null = null;
  let main = -1;
  return (nav) => {
    if (nav === null) return -1;
    if (nav !== last) {
      last = nav;
      main = navMainComponent(nav);
    }
    return main;
  };
}

/** A cor da plaquinha dos congelados (gelo: fora da paleta dos times e dos jogadores). */
const FROZEN_COLOR = rgba(0xa8e6ff);
/** Rascunho do `drawFrozenMarks`: os mais perto da vista (o ponto na tela e a profundidade). */
const markX = new Float64Array(OWNER_UI.frozenMaxMarks);
const markY = new Float64Array(OWNER_UI.frozenMaxMarks);
const markD = new Float64Array(OWNER_UI.frozenMaxMarks);
const markAt = new Float64Array(3);

/**
 * M9 (fase 5b, prints): a plaquinha "CONGELADO" (`label`, já resolvido) em cima da cabeça de cada bobo congelado
 * (`SimView.owner.frozen`) na vista (`cam`, `rect` em px da superfície): depois que o aviso some, dá para ver quem
 * parou. Como o balão do emote: a plaquinha do HUD acima da cabeça (`frozenHeightM` × o tamanho desenhado, `scaleOf`),
 * através das paredes, até `frozenMaxM`; fora da vista (ou cortada pela borda dela) não desenha, e o invisível
 * (`hidden[i] === 1`) e o bobo da própria vista (`self`) ficam de fora. Sem alocar.
 *
 * Revisão: o corpo é desenhado entre o tick de antes e o de agora (`alpha`, como o ator): a plaquinha também, senão
 * corre na frente de quem cai ou é empurrado. No máximo `frozenMaxMarks` por vista, os mais perto (a lista da HUD da
 * vista tem teto; a cena desenha na lista da vista, por baixo das plaquinhas dela, como os balões).
 */
export function drawFrozenMarks(
  out: DrawList,
  font: MsdfFont | null,
  v: SimView,
  cam: ProjectCamera,
  rect: ProjectRect,
  minTextPx: number,
  label: string,
  self: number,
  scaleOf: (v: SimView, i: number) => number,
  hidden: Uint8Array | null,
  alpha: number,
): void {
  const owner = v.owner;
  if (font === null || owner === null || label === '') return;
  const U = OWNER_UI;
  const max = U.frozenMaxMarks;
  let n = 0;
  for (let i = 0; i < v.count; i++) {
    if (owner.frozen[i] !== 1 || i === self || v.alive[i] !== 1 || v.kind[i] !== ENTITY_KIND.bobo) continue;
    if ((v.flags[i]! & ENTITY_FLAG.dead) !== 0 || (hidden !== null && hidden[i] === 1)) continue;
    const o = i * 3;
    const x = v.prevPosition[o]! + (v.position[o]! - v.prevPosition[o]!) * alpha;
    const y = v.prevPosition[o + 1]! + (v.position[o + 1]! - v.prevPosition[o + 1]!) * alpha;
    const z = v.prevPosition[o + 2]! + (v.position[o + 2]! - v.prevPosition[o + 2]!) * alpha;
    if (!projectToView(cam, rect, x, y + U.frozenHeightM * scaleOf(v, i), z, markAt)) continue;
    const d = markAt[2]!;
    if (d > U.frozenMaxM || (n === max && d >= markD[max - 1]!)) continue;
    // Os `max` mais perto, em ordem.
    let k = n < max ? n++ : max - 1;
    while (k > 0 && markD[k - 1]! > d) {
      markD[k] = markD[k - 1]!;
      markX[k] = markX[k - 1]!;
      markY[k] = markY[k - 1]!;
      k--;
    }
    markD[k] = d;
    markX[k] = markAt[0]!;
    markY[k] = markAt[1]!;
  }
  if (n === 0) return;
  const scale = Math.min(rect.width / 640, rect.height / 360);
  const px = Math.max(Math.round(10 * scale), minTextPx);
  const pad = Math.max(2, Math.round(px * 0.4));
  const bar = Math.max(2, Math.round(2 * scale));
  const w = Math.round(measureText(font, label, px, 0.06) + pad * 2);
  const h = Math.round(px * 1.45);
  // Os de longe primeiro (o mais perto fica por cima).
  for (let k = n - 1; k >= 0; k--) {
    const left = Math.round(markX[k]! - w / 2);
    const y = Math.round(markY[k]! - h);
    if (left < rect.x || left + w > rect.x + rect.width || y < rect.y || y + h > rect.y + rect.height) continue;
    pushRect(out, left, y, w, h, withAlpha(COLORS.bunker, 0.75));
    pushRect(out, left, y, w, bar, FROZEN_COLOR);
    drawText(out, font, label, left + pad, y + Math.round(px * 0.3), px, FROZEN_COLOR, 0.06);
  }
}

/** Um comando mandado esperando a resposta (o aviso diz o que foi feito). */
interface Sent {
  seq: number;
  tool: number;
  on: boolean;
  value: number;
  /** Revisão: o lugar (pés) de um `spawnBot` mandado (o próximo clique antes da resposta não escolhe o mesmo nó). */
  x: number;
  y: number;
  z: number;
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
  const sent: Sent[] = Array.from({ length: SENT_MAX }, () => ({
    seq: 0,
    tool: -1,
    on: false,
    value: 0,
    x: 0,
    y: 0,
    z: 0,
  }));
  /** Revisão: os lugares dos `spawnBot` mandados e ainda sem resposta (trios x, y, z), para o `ownerSpawnSpot`. */
  const pendingSpots = new Float64Array(SENT_MAX * 3);
  let sentNext = 0;
  const point = new Float64Array(3);
  /** O componente principal da navegação (a conta do lugar do "criar bot" é a da sim). */
  const mainOf = createMainComponentCache();
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
    if (cmd.kind === 'spawnBot') {
      s.x = cmd.x;
      s.y = cmd.y;
      s.z = cmd.z;
    }
    return true;
  }

  /** Os lugares dos `spawnBot` sem resposta em `pendingSpots`; devolve quantos. */
  function collectPending(): number {
    let n = 0;
    for (let k = 0; k < SENT_MAX; k++) {
      const s = sent[k]!;
      if (s.seq === 0 || s.tool !== OWNER_TOOL.spawn) continue;
      pendingSpots[n * 3] = s.x;
      pendingSpots[n * 3 + 1] = s.y;
      pendingSpots[n * 3 + 2] = s.z;
      n++;
    }
    return n;
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
        // Fase 5b: o nó livre à vista perto da mira (sem ele, nada vai à sim). Revisão: fora dos nós já mandados e
        // ainda sem resposta (dois cliques no mesmo tick, fácil na câmera lenta, escolhiam o mesmo nó, e o 2º caía na
        // procura da sim, até 8 m e sem olhar a vista).
        const pending = collectPending();
        const fail = ownerSpawnSpot(v, mainOf(v.nav), ox, oy, oz, yaw, pitch, point, pendingSpots, pending);
        if (fail !== null) {
          say(failText(fail), true);
          cfg.log(`[partida] dono: criar bot recusado (${fail})`);
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
