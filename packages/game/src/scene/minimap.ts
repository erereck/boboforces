// M3 (fase 7a): o minimapa do quadrante livre (tela dividida de 3; PLANO_M3 "Tela dividida"; rodada 14, K7). Só
// retângulos da UI (nenhum caminho novo no render): a planta sai da grade uma vez (paredes a 1–1,5 m do chão, juntadas
// em retângulos) e das props; por cima, a cada quadro, as portas fechadas, a Caixa Misteriosa, os zumbis, os aliados e
// os jogadores locais na cor de cada um. Norte para cima (o −z do mundo, para onde a câmera olha com yaw 0), fixo.
import { COLORS, pushRect, type DrawList } from '@boboforces/ui';
import {
  BLOCK_FLAG,
  cellBlock,
  CELLS_PER_METER,
  type BlockRegistry,
  type StaticColliders,
  type WorldGrid,
} from '@boboforces/world';
import { BOX, ENTITY_FLAG, ENTITY_KIND, type SimView } from '@boboforces/sim';

/** Números do minimapa (revisáveis). */
export const MINIMAP = {
  /** Parede = bloco que tapa a vista entre `wallFromM` e `wallToM` acima do chão do mapa. */
  wallFromM: 1,
  wallToM: 1.5,
  /** Props a partir desta altura entram na planta. */
  propMinM: 0.9,
  /** Teto de retângulos da planta (paredes e props), para a lista de desenho do quadro. */
  maxRects: 420,
  /** Margem dentro do quadrante (fração do lado menor). */
  marginFrac: 0.06,
  /** Tamanho dos pontos (px de referência 640×360, multiplicado pela escala da HUD). */
  playerPx: 5,
  allyPx: 3.5,
  zombiePx: 2.5,
  colors: {
    floor: 0x1d2530ff,
    wall: 0x8c97a6ff,
    prop: 0x5b6573ff,
    door: 0xf2b134ff,
    box: 0xe9eef5ff,
    zombie: 0x7bd36aff,
    ally: 0xc9d3e0ff,
    outline: 0x0b0f14ff,
  },
} as const;

/** A planta do mapa em metros: os limites e os retângulos (x0, z0, x1, z1) das paredes e das props. */
export interface MinimapPlan {
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
  readonly rects: Float32Array;
  /** Quantos retângulos são paredes (os primeiros); o resto até `count` são props. */
  readonly walls: number;
  readonly count: number;
}

const solidAt = (world: WorldGrid, blocks: BlockRegistry, x: number, y: number, z: number): boolean => {
  if (!world.inBounds(x, y, z)) return false;
  const b = cellBlock(world.get(x, y, z));
  return b !== 0 && (blocks.flags[b]! & (BLOCK_FLAG.solid | BLOCK_FLAG.blocksSight)) !== 0;
};

/** O chão do mapa (célula y do bloco mais alto mais comum), por amostra de 1 coluna a cada 4×4. */
function groundCell(world: WorldGrid, blocks: BlockRegistry, x0: number, z0: number, x1: number, z1: number): number {
  const hist = new Uint32Array(world.sizeY + 1);
  for (let z = z0; z < z1; z += 4) {
    for (let x = x0; x < x1; x += 4) {
      for (let y = world.sizeY - 1; y >= 0; y--) {
        if (solidAt(world, blocks, x, y, z)) {
          hist[y + 1]!++;
          break;
        }
      }
    }
  }
  let best = 0;
  for (let i = 1; i < hist.length; i++) if (hist[i]! > hist[best]!) best = i;
  // O índice guarda "y do bloco + 1": é a célula onde ficam os pés.
  return best;
}

/**
 * A planta, uma vez por partida: as colunas com bloco que tapa a vista entre 1 e 1,5 m acima do chão viram parede, e
 * as paredes se juntam em retângulos (uma passada em linhas e o crescimento para baixo, como o mesher guloso); as props
 * (as caixas de colisão do mapa, sem janelas e portas) com 0,9 m ou mais entram por cima. Corta no teto de retângulos.
 */
export function buildMinimapPlan(
  world: WorldGrid,
  blocks: BlockRegistry,
  area: { readonly minX: number; readonly minZ: number; readonly maxX: number; readonly maxZ: number } | null,
  colliders: StaticColliders | null,
): MinimapPlan {
  const c = CELLS_PER_METER;
  const minX = area?.minX ?? 0;
  const minZ = area?.minZ ?? 0;
  const maxX = area?.maxX ?? world.sizeX / c;
  const maxZ = area?.maxZ ?? world.sizeZ / c;
  const x0 = Math.max(0, Math.floor(minX * c));
  const z0 = Math.max(0, Math.floor(minZ * c));
  const x1 = Math.min(world.sizeX, Math.ceil(maxX * c));
  const z1 = Math.min(world.sizeZ, Math.ceil(maxZ * c));
  const w = Math.max(0, x1 - x0);
  const h = Math.max(0, z1 - z0);
  const ground = groundCell(world, blocks, x0, z0, x1, z1);
  const yFrom = ground + Math.round(MINIMAP.wallFromM * c);
  const yTo = ground + Math.round(MINIMAP.wallToM * c);
  const wall = new Uint8Array(w * h);
  for (let z = 0; z < h; z++) {
    for (let x = 0; x < w; x++) {
      for (let y = yFrom; y <= yTo; y++) {
        if (solidAt(world, blocks, x0 + x, y, z0 + z)) {
          wall[z * w + x] = 1;
          break;
        }
      }
    }
  }
  const rects = new Float32Array(MINIMAP.maxRects * 4);
  let count = 0;
  // Guloso: a corrida mais longa na linha, crescendo para baixo enquanto a linha de baixo tem a mesma corrida inteira.
  for (let z = 0; z < h && count < MINIMAP.maxRects; z++) {
    for (let x = 0; x < w && count < MINIMAP.maxRects;) {
      if (wall[z * w + x] !== 1) {
        x++;
        continue;
      }
      let xe = x;
      while (xe < w && wall[z * w + xe] === 1) xe++;
      let ze = z + 1;
      for (; ze < h; ze++) {
        let full = true;
        for (let k = x; k < xe && full; k++) full = wall[ze * w + k] === 1;
        if (!full) break;
      }
      for (let zz = z; zz < ze; zz++) wall.fill(2, zz * w + x, zz * w + xe);
      rects.set([(x0 + x) / c, (z0 + z) / c, (x0 + xe) / c, (z0 + ze) / c], count * 4);
      count++;
      x = xe;
    }
  }
  const walls = count;
  if (colliders !== null) {
    const groundM = ground / c;
    for (let i = 0; i < colliders.count && count < MINIMAP.maxRects; i++) {
      // Janelas e portas (dono -1) ficam de fora: as portas são desenhadas pelo estado.
      if (colliders.owner[i]! < 0) continue;
      const o = i * 6;
      const b = colliders.boxes;
      if (b[o + 4]! - Math.max(groundM, b[o + 1]!) < MINIMAP.propMinM) continue;
      if (b[o + 3]! < minX || b[o]! > maxX || b[o + 5]! < minZ || b[o + 2]! > maxZ) continue;
      rects.set([b[o]!, b[o + 2]!, b[o + 3]!, b[o + 5]!], count * 4);
      count++;
    }
  }
  return { minX, minZ, maxX, maxZ, rects, walls, count };
}

/** Onde desenhar e quem é quem (índices de entidade dos locais e a cor de cada um). */
export interface MinimapFrame {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Escala da HUD (px de referência 640×360 → px da superfície). */
  readonly scale: number;
  readonly locals: readonly number[];
  readonly localColors: readonly number[];
  /** Time dos aliados que aparecem (o dos locais; -1 = nenhum: FFA). */
  readonly allyTeam: number;
  /** Bobo Zombies: os zumbis aparecem. */
  readonly zombies: boolean;
}

/** Desenha o minimapa centrado na área (sem alocar: os pontos saem direto da vista). */
export function drawMinimap(list: DrawList, plan: MinimapPlan, v: SimView, f: MinimapFrame): void {
  const spanX = Math.max(1, plan.maxX - plan.minX);
  const spanZ = Math.max(1, plan.maxZ - plan.minZ);
  const margin = Math.min(f.width, f.height) * MINIMAP.marginFrac;
  const k = Math.min((f.width - margin * 2) / spanX, (f.height - margin * 2) / spanZ);
  if (!(k > 0)) return;
  const ox = f.x + (f.width - spanX * k) / 2 - plan.minX * k;
  const oy = f.y + (f.height - spanZ * k) / 2 - plan.minZ * k;
  const C = MINIMAP.colors;
  pushRect(list, ox + plan.minX * k, oy + plan.minZ * k, spanX * k, spanZ * k, C.floor);
  const r = plan.rects;
  for (let i = 0; i < plan.count; i++) {
    const o = i * 4;
    const x = ox + r[o]! * k;
    const y = oy + r[o + 1]! * k;
    // Uma parede fina ainda aparece (pelo menos 1 px).
    const w = Math.max(1, (r[o + 2]! - r[o]!) * k);
    const h = Math.max(1, (r[o + 3]! - r[o + 1]!) * k);
    pushRect(list, x, y, w, h, i < plan.walls ? C.wall : C.prop);
  }
  const mo = v.mapObjects;
  if (mo !== null) {
    for (let d = 0; d < mo.doors; d++) {
      if (mo.doorOpen[d] === 1) continue;
      const o = d * 6;
      const b = mo.doorBox;
      pushRect(
        list,
        ox + b[o]! * k,
        oy + b[o + 2]! * k,
        Math.max(2, (b[o + 3]! - b[o]!) * k),
        Math.max(2, (b[o + 5]! - b[o + 2]!) * k),
        C.door,
      );
    }
    if (mo.boxSpots > 0) {
      const at = mo.boxState[BOX.active]!;
      if (at >= 0 && at < mo.boxSpots) dot(list, ox + mo.boxX[at]! * k, oy + mo.boxZ[at]! * k, 4 * f.scale, C.box);
    }
  }
  const s = f.scale;
  for (let i = 0; i < v.count; i++) {
    if (v.alive[i] !== 1 || v.flags[i]! & ENTITY_FLAG.dead) continue;
    const kind = v.kind[i];
    const px = ox + v.position[i * 3]! * k;
    const pz = oy + v.position[i * 3 + 2]! * k;
    if (kind === ENTITY_KIND.zombie) {
      if (f.zombies) dot(list, px, pz, MINIMAP.zombiePx * s, C.zombie);
    } else if (kind === ENTITY_KIND.bobo && f.allyTeam >= 0 && v.team[i] === f.allyTeam && !f.locals.includes(i)) {
      dot(list, px, pz, MINIMAP.allyPx * s, C.ally);
    }
  }
  // Os locais por cima de tudo, com contorno e um risquinho para onde olham.
  for (let p = 0; p < f.locals.length; p++) {
    const i = f.locals[p]!;
    if (i < 0 || i >= v.count || v.alive[i] !== 1 || v.flags[i]! & ENTITY_FLAG.dead) continue;
    const px = ox + v.position[i * 3]! * k;
    const pz = oy + v.position[i * 3 + 2]! * k;
    const size = MINIMAP.playerPx * s;
    dot(list, px, pz, size + 2 * s, C.outline);
    dot(list, px, pz, size, f.localColors[p] ?? COLORS.texto);
    const yaw = v.yaw[i]!;
    dot(list, px - Math.sin(yaw) * size, pz - Math.cos(yaw) * size, size * 0.45, f.localColors[p] ?? COLORS.texto);
  }
}

function dot(list: DrawList, x: number, y: number, size: number, color: number): void {
  pushRect(
    list,
    Math.round(x - size / 2),
    Math.round(y - size / 2),
    Math.max(1, Math.round(size)),
    Math.max(1, Math.round(size)),
    color,
  );
}
