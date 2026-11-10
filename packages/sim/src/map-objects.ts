import { NAV_GATE_BLOCK, type NavGrid } from '@boboforces/nav';
import { assert } from '@boboforces/shared';
import { COLLIDER_FLAG, COLLIDER_STRIDE, createStaticColliders, type StaticColliders } from '@boboforces/world';
import { ZOMBIE_BARRICADES } from './config/zombie.ts';

/**
 * M3 (fase 3d): as entidades do mapa do Bobo Zombies (GDD §4.1.5, gameplay.md §8.7): **janelas com barricada** (6
 * tábuas) e **portas pagas**. Não são cenário: têm estado (tábuas, aberta), que vai no snapshot e no hash, e mudam a
 * colisão e a navegação.
 *
 * - **Colisão:** a sim monta dois conjuntos de caixas a partir das props do mapa. O dos bobos (\`SimContext.colliders\`,
 *   também o dos tiros e da visão) tem as portas fechadas e as janelas (que bobo não atravessa; tiro e visão passam).
 *   O dos zumbis (\`zombieColliders\`) tem as portas fechadas e as tábuas (a janela fecha enquanto sobra tábua). Mudar o
 *   estado só troca os bits \`solid\` (o hash espacial é o mesmo: janelas e portas não se mexem).
 * - **Navegação:** cada janela e cada porta é um portão do \`nav\` (as janelas primeiro). Janela: fechada para os
 *   bobos; porta fechada: para os dois; porta aberta: para ninguém.
 */

/** Janelas com barricada e portas pagas por mapa. */
export const MAX_BARRICADES = 32;
export const MAX_DOORS = 16;

/** Lado de fora da janela (de onde os zumbis vêm): +X, -X, +Z, -Z. */
export type BarricadeOutside = 0 | 1 | 2 | 3;

/** Janela com barricada: o vão no chão, em metros, centrado em (x, z), pés em y, largura no plano da parede. */
export interface BarricadeDef {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly outside: BarricadeOutside;
  readonly width: number;
  /** Altura do vão (m); ausente = \`ZOMBIE_BARRICADES.heightM\`. */
  readonly height?: number;
}

/** Porta paga (ou escombro): a caixa que fecha a passagem, em metros, e o preço em pontos. */
export interface DoorDef {
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly maxZ: number;
  readonly cost: number;
}

const OUTSIDE_NX = [1, -1, 0, 0] as const;
const OUTSIDE_NZ = [0, 0, 1, -1] as const;
const DOOR_FLAGS = COLLIDER_FLAG.solid | COLLIDER_FLAG.blocksBullets | COLLIDER_FLAG.blocksSight;

export class MapObjects {
  readonly barricades: number;
  readonly doors: number;
  /** Janelas: centro do vão (pés), normal para fora, meia largura e altura. */
  readonly bx: Float32Array;
  readonly by: Float32Array;
  readonly bz: Float32Array;
  readonly bnx: Float32Array;
  readonly bnz: Float32Array;
  readonly bhw: Float32Array;
  readonly bh: Float32Array;
  /** Portas: caixa (6 por porta) e preço. */
  readonly doorBox: Float32Array;
  readonly doorCost: Int32Array;
  // --- Estado (snapshot e hash) ---
  /** Tábuas de cada janela (0..6). */
  readonly planks: Uint8Array;
  /** Ticks até o zumbi arrancar a próxima tábua (0 = ninguém arrancando). */
  readonly tearTicks: Int32Array;
  /** Ticks segurando o usar no conserto em andamento e quem conserta (\`EntityId\`; NULL = ninguém). */
  readonly repairTicks: Int32Array;
  readonly repairer: Uint32Array;
  /** 1 = porta aberta (comprada). */
  readonly doorOpen: Uint8Array;
  // --- Colisão e navegação ---
  /** Conjunto dos bobos (props + portas + janelas) e o dos zumbis (props + portas + tábuas). */
  readonly boboColliders: StaticColliders;
  readonly zombieColliders: StaticColliders;
  private readonly base: number;
  private readonly nav: NavGrid | null;

  constructor(
    props: StaticColliders | null,
    nav: NavGrid | null,
    barricades: readonly BarricadeDef[],
    doors: readonly DoorDef[],
  ) {
    const nb = barricades.length;
    const nd = doors.length;
    assert(nb <= MAX_BARRICADES && nd <= MAX_DOORS, `sim: até ${MAX_BARRICADES} janelas e ${MAX_DOORS} portas`);
    this.barricades = nb;
    this.doors = nd;
    this.bx = new Float32Array(nb);
    this.by = new Float32Array(nb);
    this.bz = new Float32Array(nb);
    this.bnx = new Float32Array(nb);
    this.bnz = new Float32Array(nb);
    this.bhw = new Float32Array(nb);
    this.bh = new Float32Array(nb);
    this.doorBox = new Float32Array(nd * 6);
    this.doorCost = new Int32Array(nd);
    this.planks = new Uint8Array(nb);
    this.tearTicks = new Int32Array(nb);
    this.repairTicks = new Int32Array(nb);
    this.repairer = new Uint32Array(nb);
    this.doorOpen = new Uint8Array(nd);
    // Caixas dos portões (janelas, depois portas): a mesma caixa vai para a colisão e para a navegação.
    const gates = new Float32Array((nb + nd) * 6);
    barricades.forEach((b, i) => {
      assert(
        Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.z) && b.width > 0,
        `sim: janela ${i} inválida`,
      );
      const nx = OUTSIDE_NX[b.outside];
      const nz = OUTSIDE_NZ[b.outside];
      const hw = b.width / 2;
      const h = b.height ?? ZOMBIE_BARRICADES.heightM;
      this.bx[i] = b.x;
      this.by[i] = b.y;
      this.bz[i] = b.z;
      this.bnx[i] = nx;
      this.bnz[i] = nz;
      this.bhw[i] = hw;
      this.bh[i] = h;
      // Tangente = normal girada 90° no plano: a caixa tem a largura na tangente e a espessura das tábuas na normal.
      const t = ZOMBIE_BARRICADES.thicknessM / 2;
      const ex = nx !== 0 ? t : hw;
      const ez = nz !== 0 ? t : hw;
      gates.set([b.x - ex, b.y, b.z - ez, b.x + ex, b.y + h, b.z + ez], i * 6);
    });
    doors.forEach((d, i) => {
      assert(d.minX < d.maxX && d.minY < d.maxY && d.minZ < d.maxZ, `sim: porta ${i} com caixa vazia`);
      assert(Number.isInteger(d.cost) && d.cost >= 0, `sim: porta ${i} com preço inválido`);
      const box = [d.minX, d.minY, d.minZ, d.maxX, d.maxY, d.maxZ];
      this.doorBox.set(box, i * 6);
      this.doorCost[i] = d.cost;
      gates.set(box, (nb + i) * 6);
    });
    // Os dois conjuntos: as props primeiro (mesmos índices do mapa: o \`ImpactEvent.prop\` continua valendo), depois um
    // colisor por janela e por porta.
    const base = props?.count ?? 0;
    this.base = base;
    const total = base + nb + nd;
    const boxes = new Float32Array(total * COLLIDER_STRIDE);
    const flags = new Uint8Array(total);
    const owner = new Int32Array(total).fill(-1);
    if (props !== null) {
      boxes.set(props.boxes.subarray(0, base * COLLIDER_STRIDE));
      flags.set(props.flags.subarray(0, base));
      owner.set(props.owner.subarray(0, base));
    }
    boxes.set(gates, base * COLLIDER_STRIDE);
    this.boboColliders = createStaticColliders({ boxes, flags: flags.slice(), owner, count: total });
    this.zombieColliders = createStaticColliders({ boxes, flags: flags.slice(), owner, count: total });
    this.nav = nav;
    if (nav !== null) nav.assignGates(gates, nb + nd);
    this.reset();
  }

  /** Estado do começo da partida: janelas com todas as tábuas e portas fechadas. */
  reset(): void {
    this.planks.fill(ZOMBIE_BARRICADES.planks);
    this.tearTicks.fill(0);
    this.repairTicks.fill(0);
    this.repairer.fill(0);
    this.doorOpen.fill(0);
    this.sync();
  }

  /** Aplica tábuas e portas na colisão e na navegação (depois de mudar o estado ou de ler um snapshot). */
  sync(): void {
    for (let i = 0; i < this.barricades; i++) this.syncBarricade(i);
    for (let d = 0; d < this.doors; d++) this.syncDoor(d);
  }

  syncBarricade(i: number): void {
    const k = this.base + i;
    // Bobo nunca atravessa a janela (tiro e visão passam); o zumbi, só sem tábua.
    this.boboColliders.flags[k] = COLLIDER_FLAG.solid;
    this.zombieColliders.flags[k] = this.planks[i]! > 0 ? COLLIDER_FLAG.solid : 0;
    this.nav?.setGateBlock(i, NAV_GATE_BLOCK.bobo);
  }

  syncDoor(d: number): void {
    const k = this.base + this.barricades + d;
    const open = this.doorOpen[d] === 1;
    this.boboColliders.flags[k] = open ? 0 : DOOR_FLAGS;
    this.zombieColliders.flags[k] = open ? 0 : DOOR_FLAGS;
    this.nav?.setGateBlock(this.barricades + d, open ? 0 : NAV_GATE_BLOCK.bobo | NAV_GATE_BLOCK.zombie);
  }

  /** Distância no plano de (x, z) até a caixa da porta \`d\` (0 dentro dela). */
  doorDistance(d: number, x: number, z: number): number {
    const o = d * 6;
    const dx = Math.max(this.doorBox[o]! - x, 0, x - this.doorBox[o + 3]!);
    const dz = Math.max(this.doorBox[o + 2]! - z, 0, z - this.doorBox[o + 5]!);
    return Math.sqrt(dx * dx + dz * dz);
  }
}
