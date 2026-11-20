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
  // Os bits 12 a 14 são da ordem aos bots (`ORDER_SHIFT`); o próximo botão entra no 15.
} as const;

/**
 * M8 (fase 6): a ordem aos bots aliados (gameplay.md §6.10) viaja nos bits 12 a 14 do campo de botões, fora da
 * `BUTTON` (não tem tecla: sai da roda das ordens): 0 = nenhuma, 1 a 4 = as de `ORDER`. A sim e a IA agem na borda
 * (quando o valor muda para uma ordem), como no aviso; o `game` segura o valor alguns ticks (a rede pode perder um).
 */
export const ORDER = { none: 0, follow: 1, hold: 2, attack: 3, cover: 4 } as const;
export type OrderKind = (typeof ORDER)[keyof typeof ORDER];
export const ORDER_SHIFT = 12;
export const ORDER_MASK = 0b111 << ORDER_SHIFT;
/** As 4 ordens na ordem da roda (no alto e no sentido horário): Vem comigo, Segura aqui, Me cobre, Ataca ali. */
export const ORDER_WHEEL: readonly OrderKind[] = [ORDER.follow, ORDER.hold, ORDER.cover, ORDER.attack];

/** A ordem do campo de botões (0 = nenhuma). */
export function frameOrder(buttons: number): number {
  return (buttons & ORDER_MASK) >> ORDER_SHIFT;
}

/** O campo de botões com a ordem `order` (0 tira). */
export function withOrder(buttons: number, order: number): number {
  return (buttons & ~ORDER_MASK) | ((order & 0b111) << ORDER_SHIFT);
}

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
 * usada antes (o Q do teclado, arte-ux.md §7.1). M2 (fase 6b): `camera` troca 1ª/3ª pessoa e `shoulder` o ombro da 3ª
 * pessoa (gameplay.md §3.5). Ação nova entra no FIM da lista.
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
  'camera',
  'shoulder',
  // M8 (fase 6): segurar o aviso abre a roda das ordens aos bots aliados (no toque, um botão).
  'orders',
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

/** Direções da mira por teclas (as setas; sem mouse, como no teclado USB do Switch). */
export const LOOK_DIRECTIONS = ['left', 'right', 'up', 'down'] as const;

export type LookDirection = (typeof LOOK_DIRECTIONS)[number];

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
