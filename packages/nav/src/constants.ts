// Constantes do contrato da navegação (reexportadas pelo `index.ts`). Ficam aqui para a implementação importar valores
// sem ciclo com o `index.ts`.

/** Células por lado de um nó de navegação (1,0 m: um bobo de 0,6 m cabe, e uma porta de 1,0 m tem 1 nó no meio). */
export const NAV_NODE_CELLS = 2;
export const NAV_NODE_SIZE_M = 1;

/** Índice de nó (= span); -1 = nenhum. */
export type NavNode = number;

export const NO_NAV_NODE: NavNode = -1;

/** Tipo de ligação entre nós (a IA decide pular ou agachar pela ligação). */
export const NAV_LINK = { walk: 0, step: 1, jump: 2, drop: 3, crouch: 4 } as const;
export type NavLinkKind = (typeof NAV_LINK)[keyof typeof NAV_LINK];

/**
 * M3 (fase 3d): portões da navegação (janelas com barricada e portas pagas do Bobo Zombies). Uma ligação que atravessa a
 * caixa de um portão fica presa a ele; o bit de quem não passa: `bobo` (o A*, dos bots) e `zombie` (o flow field).
 * Janela: fechada só para os bobos (o zumbi passa e arranca as tábuas). Porta fechada: para os dois.
 */
export const NAV_GATE_BLOCK = { bobo: 1, zombie: 2 } as const;
/** Portões por mapa. */
export const MAX_NAV_GATES = 64;
