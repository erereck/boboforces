/**
 * Ações abstratas (tecnico.md §10). Dispositivo → adaptador → estado bruto → perfil → AÇÕES → InputFrame.
 * Bots e humanos produzem o mesmo InputFrame; a sim só enxerga os bits de `BUTTON`.
 */

/**
 * Ações que viajam no InputFrame (a sim enxerga). O bit de cada uma é FIXO: nunca reordenar nem reaproveitar um bit
 * (quebra replays e o protocolo). Ação nova entra no próximo bit livre.
 */
export const BUTTON = {
  fire: 1 << 0,
  ads: 1 << 1,
  jump: 1 << 2,
  /** Agachar; correndo, vira deslizar (perfil Bobo). */
  crouch: 1 << 3,
  sprint: 1 << 4,
  reload: 1 << 5,
  use: 1 << 6,
  melee: 1 << 7,
  grenade: 1 << 8,
  ping: 1 << 9,
  emote: 1 << 10,
  /**
   * M2 (fase 2b): Destravar (GDD §3.8). A sim leva o bobo ao nó de navegação livre mais próximo. O humano aperta pela
   * pausa; a IA, depois de 8 s sem progresso na rota.
   */
  unstuck: 1 << 11,
} as const;

export type FrameButton = keyof typeof BUTTON;

export const FRAME_BUTTONS = Object.keys(BUTTON) as readonly FrameButton[];

/**
 * M2 (fase 2b): botões do frame que só vêm de um menu (o Destravar da pausa), sem atalho no teclado nem no controle.
 * O `game` liga o bit por um tick quando a opção é escolhida.
 */
export const MENU_ONLY_FRAME_BUTTONS: readonly FrameButton[] = ['unstuck'];

/** Bits reservados para os botões no fio (InputFrame serializado). */
export const FRAME_BUTTON_BITS = 16;

/**
 * Ações de jogo que ficam no cliente: a troca de arma vira o campo absoluto `InputFrame.weapon`; placar e pausa são
 * locais (pausa sempre por `pause`, nunca por Esc/Home/voltar do navegador: regra 16). `lastWeapon` volta para a arma
 * usada antes (o Q do teclado, arte-ux.md §7.1). Ação nova entra no FIM da lista.
 */
export const LOCAL_GAME_ACTIONS = [
  'nextWeapon',
  'prevWeapon',
  'slot1',
  'slot2',
  'slot3',
  'slot4',
  'scoreboard',
  'pause',
  'lastWeapon',
] as const;

export type LocalGameAction = (typeof LOCAL_GAME_ACTIONS)[number];

export type GameAction = FrameButton | LocalGameAction;

export const GAME_ACTIONS: readonly GameAction[] = [...FRAME_BUTTONS, ...LOCAL_GAME_ACTIONS];

/** Índice de cada ação de jogo em `GAME_ACTIONS` (estado em typed arrays, sem busca por texto no laço). */
export const GAME_ACTION_INDEX = Object.fromEntries(GAME_ACTIONS.map((a, i) => [a, i])) as Readonly<
  Record<GameAction, number>
>;

/** Slots de arma que o `InputFrame.weapon` endereça (primária, pistola, faca, granada). */
export const WEAPON_SLOT_COUNT = 4;

/** Direções de movimento digital (teclas, D-pad). O analógico entra direto como vetor. */
export const MOVE_DIRECTIONS = ['forward', 'back', 'left', 'right'] as const;

export type MoveDirection = (typeof MOVE_DIRECTIONS)[number];

/**
 * Ações de menu: conjunto à parte. Todo fluxo precisa funcionar só com D-pad + confirmar/voltar (regra 12).
 * `secondary` é a ação extra da tela (ex.: "editar"); abas com `tabPrev`/`tabNext`.
 */
export const MENU_ACTIONS = [
  'up',
  'down',
  'left',
  'right',
  'confirm',
  'back',
  'tabPrev',
  'tabNext',
  'secondary',
] as const;

export type MenuAction = (typeof MENU_ACTIONS)[number];

export const MENU_ACTION_INDEX = Object.fromEntries(MENU_ACTIONS.map((a, i) => [a, i])) as Readonly<
  Record<MenuAction, number>
>;

/**
 * Onde fica o "confirmar" no controle (arte-ux.md §7.2), sem nome de marca: `bottom` = botão de baixo confirma e o da
 * direita volta (padrão da web); `right` = o da direita confirma e o de baixo volta (convenção do Switch).
 */
export type MenuConfirmConvention = 'bottom' | 'right';

export function confirmConventionFor(platform: 'web' | 'switch'): MenuConfirmConvention {
  return platform === 'switch' ? 'right' : 'bottom';
}
