import { NAV_NODE_SIZE_M, NO_NAV_NODE, type NavGridImpl } from '@boboforces/nav';
import { METRICS, MOVEMENT_BOBO, type MovementProfile } from '@boboforces/sim';
import { BLOCK_SIZE } from '@boboforces/world';

/**
 * M10 (fase 1c): topos que só o HUMANO alcança, com pulo correndo de um nó alcançável. A navegação só liga colunas
 * vizinhas (degrau, pulo parado de `jumpHeight`, queda): o vão de 3 a 5 m entre dois telhados, ou a borda de 1,0 a
 * 1,5 m que só a escalada no ar (mantle) vence, não têm ligação, e a medida da maior linha de visão (≤ 50 m, a regra do
 * Switch) não via esses poleiros. Este passe acha os nós andáveis fora do alcance da navegação aonde um pulo correndo
 * chega, com os números do perfil de movimento (o mesmo código da sim, `systems/movement.ts`):
 *
 * - decolagem a `sprint` m/s (a aceleração de 60 m/s² chega lá em ~0,4 m: cabe num nó) e o controle no ar
 *   (`airControl`) só vira a direção: no ar o bobo não passa da velocidade que tinha (sem bhop no perfil Bobo);
 * - velocidade vertical `sqrt(2·gravity·jump)`; o pulo pode sair até `coyoteS` depois de deixar a borda (os pés caem
 *   `gravity·coyote²/2` nesse tempo);
 * - no ar, o degrau vira escalada: a caixa sobe uma borda até `min(stepHeight, mantleHeight − jump)` acima dos pés (a
 *   folga de 5 cm do tick fica de fora: aqui é o alcance, não o arredondamento);
 * - a caixa (0,6 m) se apoia na borda de onde sai e na de onde chega: o centro voa o vão menos a largura dela.
 *
 * Conferido contra a sim (`jump-reach.test.ts`, pulando no fim do coyote): vão entre bordas de 6,0 m no mesmo nível,
 * 5,5 m subindo 0,5 m, 4,5 m subindo 1,0 m e 7,5 m descendo 2,0 m (a conta dá 5,97, 5,47, 4,79 e 7,40).
 *
 * O deslize do perfil (começa a 8 m/s) pularia mais longe; fica de fora (a pergunta é o pulo correndo). A passagem do
 * corpo é checada pela grade (blocos com colisão entre o degrau e a cabeça, ao longo da reta); as props não entram (a
 * conta erra para o lado de achar poleiro, como a linha de visão do `mapc` erra para o lado de ver).
 */
export interface JumpProfile {
  /** Velocidade no plano na decolagem (m/s). */
  readonly speed: number;
  /** Velocidade vertical do pulo (m/s), gravidade (m/s²) e altura do pulo (m). */
  readonly jumpSpeed: number;
  readonly gravity: number;
  readonly jumpHeight: number;
  /** Escalada no ar: borda até esta altura acima dos pés (m). */
  readonly airStep: number;
  /** Tempo de coyote (s). */
  readonly coyoteS: number;
  /** Meia largura e altura da caixa (m). */
  readonly radius: number;
  readonly height: number;
  /** Maior queda aceita no pulo (m): a sem dano. */
  readonly maxDrop: number;
}

/**
 * O alcance do perfil `p` num mapa de gravidade `mapGravity` (`MapMeta.gravity`, M10 fase 4: a Estação Lunar). A conta
 * da sim (`mapGravityProfile`): a gravidade multiplica, o pulo abaixo de 1 sobe `jump / g` (a velocidade dele fica) e a
 * queda não machuca; aqui a maior queda aceita vira a de mesma velocidade de impacto que a segura (`safeFallHeight / g`).
 */
export function jumpProfile(p: MovementProfile = MOVEMENT_BOBO, mapGravity = 1): JumpProfile {
  const gravity = p.gravity * mapGravity;
  const jump = mapGravity < 1 ? p.jump / mapGravity : p.jump;
  return {
    speed: p.sprint,
    jumpSpeed: Math.sqrt(2 * gravity * jump),
    gravity,
    jumpHeight: jump,
    airStep: Math.max(0, Math.min(METRICS.stepHeight, p.mantleHeight - jump)),
    coyoteS: p.coyoteS,
    radius: METRICS.aabbWidth / 2,
    height: METRICS.aabbHeight,
    maxDrop: METRICS.safeFallHeight / Math.min(1, mapGravity),
  };
}

/**
 * Maior avanço do centro no plano (m) num pulo correndo que chega `rise` m acima do piso da decolagem (negativo =
 * abaixo): o último instante em que os pés ainda estão a `airStep` da borda de chegada, com ou sem o coyote (o melhor
 * dos dois). −1 = alto demais (acima do pulo + escalada).
 */
export function jumpTravelM(j: JumpProfile, rise: number): number {
  let best = -1;
  for (const c of [0, j.coyoteS]) {
    // Pés ao pular: caíram g·c²/2 no coyote; depois sobem até o ápice e descem até `rise - airStep`.
    const need = rise - j.airStep + (j.gravity * c * c) / 2;
    const disc = j.jumpSpeed * j.jumpSpeed - 2 * j.gravity * need;
    if (disc < 0) continue;
    const t = c + (j.jumpSpeed + Math.sqrt(disc)) / j.gravity;
    best = Math.max(best, j.speed * t);
  }
  return best;
}

/** Distância no plano entre os quadrados de apoio de dois nós (o nó de 1 m alargado pela meia caixa dos dois lados). */
export function supportGap(dx: number, dz: number, radius: number): number {
  const reach = NAV_NODE_SIZE_M + 2 * radius;
  return Math.hypot(Math.max(0, Math.abs(dx) - reach), Math.max(0, Math.abs(dz) - reach));
}

/** Um lugar (topo) alcançável só com pulo: o nó onde o pulo chega, de onde ele sai e quantos nós o lugar tem. */
export interface JumpTop {
  readonly at: readonly [number, number, number];
  readonly from: readonly [number, number, number];
  readonly nodes: number;
}

export interface JumpReach {
  /** 1 = nó alcançável só com pulo correndo (ou andando a partir de um deles). */
  readonly mark: Uint8Array;
  readonly count: number;
  readonly tops: readonly JumpTop[];
}

export interface JumpReachInput {
  readonly nav: NavGridImpl;
  /** Nós alcançáveis pela navegação (a partir dos spawns, no sentido das ligações). */
  readonly reachable: Uint8Array;
  /** O nó entra na conta (dentro da área jogável). */
  readonly inArea: (node: number) => boolean;
  /** A célula (índices da grade) tem colisão. */
  readonly collides: (x: number, y: number, z: number) => boolean;
  readonly profile?: JumpProfile;
}

/** Rodadas de pulo encadeado (de um poleiro para outro). */
const MAX_ROUNDS = 8;

export function findJumpReach(input: JumpReachInput): JumpReach {
  const { nav, reachable, inArea, collides } = input;
  const j = input.profile ?? jumpProfile();
  const n = nav.nodeCount;
  const mark = new Uint8Array(n);
  const tops: JumpTop[] = [];
  const pos = new Float64Array(3);
  const posA = new Float64Array(3);
  const reachRadius = Math.ceil((jumpTravelM(j, -j.maxDrop) + NAV_NODE_SIZE_M + 2 * j.radius) / NAV_NODE_SIZE_M);
  const ok = (a: number): boolean => reachable[a] === 1 || mark[a] === 1;

  // A reta do centro de A ao de B: o corpo passa entre o degrau e a cabeça, acima do piso mais alto dos dois.
  const clear = (ax: number, az: number, bx: number, bz: number, floor: number): boolean => {
    const lo = Math.floor((floor + j.airStep + 0.05) / BLOCK_SIZE);
    const hi = Math.floor((floor + j.height - 0.05) / BLOCK_SIZE);
    const len = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(len / 0.25));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const cx = Math.floor((ax + (bx - ax) * t) / BLOCK_SIZE);
      const cz = Math.floor((az + (bz - az) * t) / BLOCK_SIZE);
      for (let cy = lo; cy <= hi; cy++) if (collides(cx, cy, cz)) return false;
    }
    return true;
  };

  /** Um pulo de algum nó alcançável chega em `b`? Devolve o nó de decolagem ou -1. */
  const takeoff = (b: number): number => {
    nav.nodePosition(b, pos);
    const col = nav.nodeColumn[b]!;
    const bi = col % nav.columnsX;
    const bk = (col - bi) / nav.columnsX;
    for (let dk = -reachRadius; dk <= reachRadius; dk++) {
      const k = bk + dk;
      if (k < 0 || k >= nav.columnsZ) continue;
      for (let di = -reachRadius; di <= reachRadius; di++) {
        const i = bi + di;
        if (i < 0 || i >= nav.columnsX) continue;
        const c = i + k * nav.columnsX;
        for (let a = nav.columnStart[c]!; a < nav.columnStart[c + 1]!; a++) {
          // A decolagem também é dentro da área jogável (fora dela a sim põe parede invisível).
          if (!ok(a) || !inArea(a)) continue;
          nav.nodePosition(a, posA);
          const rise = pos[1]! - posA[1]!;
          if (rise < -j.maxDrop) continue;
          const travel = jumpTravelM(j, rise);
          if (travel < 0 || supportGap(pos[0]! - posA[0]!, pos[2]! - posA[2]!, j.radius) > travel) continue;
          if (!clear(posA[0]!, posA[2]!, pos[0]!, pos[2]!, Math.max(pos[1]!, posA[1]!))) continue;
          return a;
        }
      }
    }
    return NO_NAV_NODE;
  };

  let count = 0;
  const queue: number[] = [];
  for (let round = 0; round < MAX_ROUNDS; round++) {
    let found = 0;
    for (let b = 0; b < n; b++) {
      if (ok(b) || !inArea(b)) continue;
      const a = takeoff(b);
      if (a === NO_NAV_NODE) continue;
      // Novo lugar: o nó do pouso e tudo o que se alcança andando (ou caindo) dele, fora do que já contava.
      nav.nodePosition(a, posA);
      nav.nodePosition(b, pos);
      mark[b] = 1;
      queue.length = 0;
      queue.push(b);
      let nodes = 0;
      for (let q = 0; q < queue.length; q++) {
        const u = queue[q]!;
        if (inArea(u)) nodes++;
        for (let l = nav.linkStart[u]!; l < nav.linkStart[u + 1]!; l++) {
          const w = nav.linkTarget[l]!;
          if (ok(w)) continue;
          mark[w] = 1;
          queue.push(w);
        }
      }
      count += nodes;
      found++;
      tops.push({ at: [pos[0]!, pos[1]!, pos[2]!], from: [posA[0]!, posA[1]!, posA[2]!], nodes });
    }
    if (found === 0) break;
  }
  return { mark, count, tops };
}
