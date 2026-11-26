import { weaponDef } from '@boboforces/sim';

/**
 * M11 (fase 4, revisão): o slot que o mapeador do humano passa a pedir depois do evento `weapon`/`switch` da sim (a sim
 * pôs uma arma na mão: a troca de slot sozinha, a arma do mapa, o loot do Royale, a compra do BoboStrike, a troca por
 * abate, o dono). O evento traz o CÓDIGO da arma, não o slot: o slot é o da arma (`WeaponDef.slot`); sem arma conhecida,
 * o da mão na view. Antes, o código ia direto para o mapeador (que limita a 0..3): a SMG (código 2) levava a mão para a
 * faca e o resto, para a granada.
 */
export function switchedSlot(weapon: number, viewSlot: number): number {
  return weaponDef(weapon)?.slot ?? viewSlot;
}
